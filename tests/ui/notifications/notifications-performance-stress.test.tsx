import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import type { Fetcher } from '@/platform/network/request';
import {
  defaultNotificationState,
  loadNotificationState,
  NOTIFICATION_STORAGE_KEY
} from '@/platform/notifications/notificationStore';
import { presentSourceNotification } from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import { appQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { projectTestAccountSessions } from '../../helpers/accountSessions';
import { QueryTestWrapper } from '../QueryTestWrapper';

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponse: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null)
}));

jest.mock('@/platform/notifications/notificationSystem', () => ({
  dismissSourceNotification: jest.fn(async () => undefined),
  dismissSourceNotificationExact: jest.fn(async () => undefined),
  notificationPermissionGranted: jest.fn(async () => true),
  openNotificationSystemSettings: jest.fn(async () => undefined),
  presentSourceNotification: jest.fn(async (_source: string, _digest: unknown, identifier: string) => identifier),
  requestNotificationPermission: jest.fn(async () => true),
  reconcileSourceNotificationSlots: jest.fn(async () => undefined),
  syncNotificationBackgroundRegistration: jest.fn(async () => true)
}));

let mockWorkerActive = 0;
let mockWorkerPeak = 0;
jest.mock('@/platform/notifications/notificationWorker', () => {
  const actual = jest.requireActual<typeof import('@/platform/notifications/notificationWorker')>(
    '@/platform/notifications/notificationWorker'
  );
  return {
    ...actual,
    runNotificationBackgroundWorker: jest.fn(
      async (...args: Parameters<typeof actual.runNotificationBackgroundWorker>) => {
        mockWorkerPeak = Math.max(mockWorkerPeak, ++mockWorkerActive);
        try {
          return await actual.runNotificationBackgroundWorker(...args);
        } finally {
          mockWorkerActive -= 1;
        }
      }
    )
  };
});

const releases = new Set<() => void>();
const response = (value: unknown) =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: 200 });

function heldResponse(value: unknown) {
  let release!: () => void;
  const promise = new Promise<Response>((resolve) => {
    release = () => {
      releases.delete(release);
      resolve(response(value));
    };
  });
  releases.add(release);
  return { promise, release };
}

function listResponse(url: string, id: number) {
  return {
    list: url.includes('/reply-to-me/')
      ? [{ id, post_id: 7, commenter_id: 9, commenter_name: `actor-${id}`, post_title: `private-title-${id}` }]
      : [],
    hasMore: false
  };
}

function optionsFor(
  fetcher: Fetcher,
  userId = '42',
  source: NotificationSource = 'nodeseek'
): Parameters<typeof useNotificationsRuntime>[0] {
  const sessions = projectTestAccountSessions(
    createSiteSessionStates({
      [source]: {
        site: source,
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source,
          id: userId,
          username: 'alice',
          url: `https://account.invalid/${source}/${userId}`
        }
      }
    })
  );
  return {
    appActive: true,
    contentSourcesReady: true,
    enabledNotificationSources: [source],
    fetcher,
    getLinuxDoUserAgent: () => 'linux.do',
    getNodeSeekUserAgent: () => 'NodeSeek',
    onSessionExpired: jest.fn(),
    openSource: () => true,
    privateAccessAllowed: (candidate, identityKey) => candidate === source && identityKey === `${source}:${userId}`,
    remoteReady: true,
    sessionEpochs: initialForumSessionEpochs,
    sessions
  };
}

async function settleWorkers() {
  await act(async () => {
    let count = -1;
    while (count !== jest.mocked(runNotificationBackgroundWorker).mock.results.length) {
      count = jest.mocked(runNotificationBackgroundWorker).mock.results.length;
      await Promise.all(jest.mocked(runNotificationBackgroundWorker).mock.results.map(({ value }) => value));
      await jest.advanceTimersByTimeAsync(0);
    }
  });
}

async function expectDetached(requestCount: () => number) {
  const count = requestCount();
  await act(async () => jest.advanceTimersByTimeAsync(600_000));
  expect(requestCount()).toBe(count);
  expect(mockWorkerActive).toBe(0);
  expect(releases.size).toBe(0);
  for (const { value } of jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.results) {
    expect(value.remove).toHaveBeenCalledTimes(1);
  }
  expect(
    appQueryClient
      .getQueryCache()
      .getAll()
      .every((query) => query.getObserversCount() === 0)
  ).toBe(true);
  expect(appQueryClient.isFetching()).toBe(0);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockWorkerActive = 0;
  mockWorkerPeak = 0;
  await AsyncStorage.clear();
  const stored = defaultNotificationState();
  stored.globalEnabled = true;
  stored.hasOptedIn = true;
  stored.sources.nodeseek = { ...stored.sources.nodeseek, intentEnabled: true, identityKey: 'nodeseek:42' };
  await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(stored));
});

afterEach(async () => {
  await cleanup();
  releases.forEach((release) => release());
  await settleWorkers();
  jest.useRealTimers();
});

describe('notification runtime repeated lifecycle pressure', () => {
  it.each(['linuxdo', 'yaohuo'] as const)(
    'preserves %s protocol counts and delivery IDs through 20 slow scans and four identity changes',
    async (source) => {
      const stored = await loadNotificationState();
      stored.sources[source] = { ...stored.sources[source], intentEnabled: true, identityKey: `${source}:42` };
      await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(stored));
      let id = 0;
      let holdAfter = 0;
      // Shapes match the existing Discourse and Yaohuo adapter fixtures; all parsing stays in production.
      const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (input) => {
        const url = new URL(input);
        if (source === 'linuxdo') {
          expect(url.origin + url.pathname).toBe('https://linux.do/notifications');
          expect(url.searchParams.get('offset')).toBe('0');
          expect(url.searchParams.get('limit')).toBe('60');
          if (url.searchParams.get('filter') === 'unread') {
            return response({ notifications: [], total_rows_notifications: 50 + id });
          }
          expect(url.searchParams.get('filter')).toBe('all');
          const payload = {
            total_rows_notifications: 4,
            notifications: [
              { id: id * 10 + 1, notification_type: 2, read: false, acting_user_name: `actor-${id}` },
              { id: id * 10 + 2, notification_type: 6, read: false, acting_user_name: `actor-${id}` },
              { id: id * 10 + 3, notification_type: 2, read: true, acting_user_name: 'already-read' },
              { id: id * 10 + 4, notification_type: 5, read: false, acting_user_name: 'reaction-only' }
            ]
          };
          return --holdAfter === 0 ? heldResponse(payload).promise : response(payload);
        }
        expect(url.origin + url.pathname).toBe('https://www.yaohuo.me/bbs/messagelist.aspx');
        expect(url.searchParams.get('types')).toBe('0');
        const page = Number(url.searchParams.get('page'));
        expect([1, 2]).toContain(page);
        const row = (suffix: number, unread: boolean, actor = `actor-${id}`) =>
          `<div class="listmms">${unread ? '<img src="/NetImages/new.gif">' : ''}` +
          `<a href="/bbs/messagelist_view.aspx?id=${id * 10 + suffix}">private-title</a> 来自${actor} [刚刚]</div>`;
        const payload =
          (page === 1 ? row(1, true) + row(3, false) : row(1, true) + row(2, true) + row(4, true, '系统')) +
          `<div class="showpage">${page}/2 页</div>`;
        return page === 2 && --holdAfter === 0 ? heldResponse(payload).promise : response(payload);
      });
      let options = optionsFor(fetcher, '42', source);
      const hook = await renderHook(() => useNotificationsRuntime(options), { wrapper: QueryTestWrapper });
      await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(1));
      await settleWorkers();
      expect(presentSourceNotification).not.toHaveBeenCalled();
      let expectedIds = ['1', '2'];
      let expectedWorkers = 1;

      for (let cycle = 1; cycle <= 20; cycle += 1) {
        id = cycle * 10;
        // Yaohuo's first page-2 request belongs to the snapshot, the second to the delivery scan.
        holdAfter = source === 'linuxdo' ? 1 : 2;
        await act(async () => hook.result.current.refreshSnapshots());
        await waitFor(() => expect(releases.size).toBe(1));
        expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(++expectedWorkers);
        if (cycle % 5 === 0) {
          id += 1;
          options = optionsFor(fetcher, String(42 + cycle), source);
          await act(async () => hook.rerender({}));
          await waitFor(() => expect(hook.result.current.identityKeys[source]).toBe(`${source}:${42 + cycle}`));
          expectedIds = [];
          expectedWorkers += 1;
        }
        await act(async () => releases.forEach((release) => release()));
        await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(expectedWorkers));
        await settleWorkers();
        expectedIds = [String(id * 10 + 1), String(id * 10 + 2), ...expectedIds];
        const unreadCount = source === 'linuxdo' ? 50 + id : 3;
        expect(hook.result.current.unreadTotal).toBe(unreadCount);
        expect((await loadNotificationState()).sources[source]).toMatchObject({
          identityKey: `${source}:${42 + Math.floor(cycle / 5) * 5}`,
          unreadCount,
          deliveredIds: expectedIds,
          baselineReady: true
        });
        expect(presentSourceNotification).toHaveBeenCalledTimes(cycle - Math.floor(cycle / 5));
        if (cycle % 5 !== 0) {
          expect(presentSourceNotification).toHaveBeenLastCalledWith(
            source,
            {
              title: source === 'linuxdo' ? 'linux.do' : '妖火',
              body: `actor-${id}${source === 'linuxdo' ? '回复了你的主题' : '发来了私信'}，另有 1 条新互动`,
              data: { source }
            },
            expect.stringContaining(encodeURIComponent(`${source}:${42 + Math.floor(cycle / 5) * 5}`))
          );
        }
        expect(mockWorkerPeak).toBe(1);
      }
      expect(fetcher).toHaveBeenCalledTimes(source === 'linuxdo' ? 50 : 100);
      expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(25);
      await hook.unmount();
      await expectDetached(() => fetcher.mock.calls.length);
    }
  );

  it('coalesces 192 refreshes across 24 foreground cycles while real delivery reads are slow', async () => {
    let id = 0;
    let holdLists = true;
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
      if (url.endsWith('/unread-count')) return response({ atMe: 0, reply: id, message: 0 });
      const payload = listResponse(url, id);
      return holdLists ? heldResponse(payload).promise : response(payload);
    });
    let options = { ...optionsFor(fetcher), appActive: false };
    const hook = await renderHook(() => useNotificationsRuntime(options), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(fetcher).not.toHaveBeenCalled();

    for (id = 1; id <= 24; id += 1) {
      holdLists = true;
      options = { ...options, appActive: true };
      await act(async () => hook.rerender({}));
      await waitFor(() => expect(releases.size).toBe(3));
      expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(id * 2 - 1);
      for (let refresh = 0; refresh < 8; refresh += 1) {
        await act(async () => hook.result.current.refreshSnapshots());
        await act(async () => jest.advanceTimersByTimeAsync(0));
      }
      expect(releases.size).toBe(3);
      expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(id * 2 - 1);
      holdLists = false;
      await act(async () => releases.forEach((release) => release()));
      await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(id * 2));
      await settleWorkers();
      expect(mockWorkerPeak).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(id * 15);
      expect(hook.result.current.unreadTotal).toBe(id);
      const saved = (await loadNotificationState()).sources.nodeseek;
      expect(saved.deliveredIds).toEqual(Array.from({ length: id }, (_, index) => `reply-to-me:${id - index}`));
      expect(saved.unreadCount).toBe(id);
      expect(presentSourceNotification).toHaveBeenCalledTimes(id - 1);
      if (id > 1) {
        expect(presentSourceNotification).toHaveBeenLastCalledWith(
          'nodeseek',
          { title: 'NodeSeek', body: `actor-${id}回复了你的主题`, data: { source: 'nodeseek' } },
          expect.stringContaining('nodeseek%3A42')
        );
      }
      options = { ...options, appActive: false };
      await act(async () => hook.rerender({}));
      await act(async () => jest.advanceTimersByTimeAsync(300_001));
      expect(fetcher).toHaveBeenCalledTimes(id * 15);
    }
    await hook.unmount();
    await expectDetached(() => fetcher.mock.calls.length);
  });

  it('rejects late snapshots through 12 identity changes and source disable cycles, then releases its observers', async () => {
    const pending: { signal: AbortSignal; release: () => void }[] = [];
    let holdSnapshots = false;
    let total = 1;
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url, init) => {
      if (!url.endsWith('/unread-count')) return response(listResponse(url, total));
      if (!holdSnapshots) return response({ atMe: 0, reply: total, message: 0 });
      const held = heldResponse({ atMe: 0, reply: 99_999, message: 0 });
      pending.push({ signal: init!.signal!, release: held.release });
      // Deliberately allow an aborted transport to finish: the real query/gateway must reject its late payload.
      return held.promise;
    });
    let options = optionsFor(fetcher);
    const hook = await renderHook(() => useNotificationsRuntime(options), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(1));
    await settleWorkers();

    for (let cycle = 1; cycle <= 12; cycle += 1) {
      holdSnapshots = true;
      let refresh!: Promise<unknown>;
      await act(async () => {
        refresh = hook.result.current.refreshSnapshots();
      });
      await waitFor(() => expect(pending).toHaveLength(cycle * 2 - 1));
      const previousIdentity = pending.at(-1)!;
      total = cycle + 1;
      holdSnapshots = false;
      options = optionsFor(fetcher, String(42 + cycle));
      await act(async () => hook.rerender({}));
      await waitFor(() => expect(previousIdentity.signal.aborted).toBe(true));
      await act(async () => {
        previousIdentity.release();
        await refresh;
      });
      await waitFor(() => expect(hook.result.current.unreadTotal).toBe(total));
      await settleWorkers();
      expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
        identityKey: `nodeseek:${42 + cycle}`,
        unreadCount: total,
        deliveredIds: [`reply-to-me:${total}`]
      });

      holdSnapshots = true;
      await act(async () => {
        refresh = hook.result.current.refreshSnapshots();
      });
      await waitFor(() => expect(pending).toHaveLength(cycle * 2));
      const disabledSource = pending.at(-1)!;
      options = { ...options, enabledNotificationSources: [] };
      await act(async () => hook.rerender({}));
      await waitFor(() => expect(disabledSource.signal.aborted).toBe(true));
      await act(async () => {
        disabledSource.release();
        await refresh;
      });
      await waitFor(() => expect(hook.result.current.state.sources.nodeseek.baselineReady).toBe(false));
      expect(hook.result.current.activeSources).toEqual([]);
      expect(hook.result.current.unreadTotal).toBe(0);
      expect((await loadNotificationState()).sources.nodeseek.deliveredIds).toEqual([]);
      holdSnapshots = false;
      options = { ...options, enabledNotificationSources: ['nodeseek'] };
      await act(async () => hook.rerender({}));
      await waitFor(() => expect(hook.result.current.unreadTotal).toBe(total));
      await settleWorkers();
      expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
        identityKey: `nodeseek:${42 + cycle}`,
        unreadCount: total,
        deliveredIds: [`reply-to-me:${total}`]
      });
      expect(presentSourceNotification).not.toHaveBeenCalled();
      expect(mockWorkerPeak).toBe(1);
    }
    holdSnapshots = true;
    let finalRefresh!: Promise<unknown>;
    await act(async () => {
      finalRefresh = hook.result.current.refreshSnapshots();
    });
    await waitFor(() => expect(pending).toHaveLength(25));
    const savedBeforeUnmount = await loadNotificationState();
    await hook.unmount();
    expect(pending.at(-1)!.signal.aborted).toBe(true);
    await act(async () => {
      pending.at(-1)!.release();
      await finalRefresh;
    });
    await settleWorkers();
    expect(await loadNotificationState()).toEqual(savedBeforeUnmount);
    expect(presentSourceNotification).not.toHaveBeenCalled();
    expect(pending.every(({ signal }) => signal.aborted)).toBe(true);
    expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(25);
    expect(fetcher).toHaveBeenCalledTimes(125);
    await expectDetached(() => fetcher.mock.calls.length);
  });

  it('discards 13 stale real worker batches after repeated identity changes, source cleanup, and unmount', async () => {
    let id = 1;
    let holdLists = false;
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
      if (url.endsWith('/unread-count')) return response({ atMe: 0, reply: id, message: 0 });
      const payload = listResponse(url, id);
      return holdLists ? heldResponse(payload).promise : response(payload);
    });
    let options = optionsFor(fetcher);
    const hook = await renderHook(() => useNotificationsRuntime(options), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(1));
    await settleWorkers();

    for (let cycle = 1; cycle <= 12; cycle += 1) {
      id += 1;
      holdLists = true;
      await act(async () => hook.result.current.refreshSnapshots());
      await waitFor(() => expect(releases.size).toBe(3));
      const staleWorker = jest.mocked(runNotificationBackgroundWorker).mock.results.at(-1)!.value;
      if (cycle % 2 === 1) {
        options = optionsFor(fetcher, String(100 + cycle));
        await act(async () => hook.rerender({}));
      } else {
        options = { ...options, enabledNotificationSources: [] };
        await act(async () => hook.rerender({}));
        await waitFor(() => expect(hook.result.current.state.sources.nodeseek.baselineReady).toBe(false));
        options = { ...options, enabledNotificationSources: ['nodeseek'] };
        await act(async () => hook.rerender({}));
      }
      await waitFor(() => expect(hook.result.current.unreadTotal).toBe(id));
      await act(async () => jest.advanceTimersByTimeAsync(0));
      expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(cycle * 2);
      expect(releases.size).toBe(3);
      holdLists = false;
      await act(async () => releases.forEach((release) => release()));
      await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(cycle * 2 + 1));
      await settleWorkers();
      expect(await staleWorker).toMatchObject({ status: 'success', delivered: 0, failedSources: 0 });
      expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
        identityKey: `nodeseek:${100 + (cycle % 2 ? cycle : cycle - 1)}`,
        deliveredIds: [`reply-to-me:${id}`],
        unreadCount: id,
        baselineReady: true
      });
      expect(presentSourceNotification).not.toHaveBeenCalled();
      expect(mockWorkerPeak).toBe(1);
    }
    id += 1;
    holdLists = true;
    await act(async () => hook.result.current.refreshSnapshots());
    await waitFor(() => expect(releases.size).toBe(3));
    const finalWorker = jest.mocked(runNotificationBackgroundWorker).mock.results.at(-1)!.value;
    const savedBeforeUnmount = await loadNotificationState();
    await hook.unmount();
    await act(async () => releases.forEach((release) => release()));
    await settleWorkers();
    expect(await finalWorker).toMatchObject({ status: 'success', delivered: 0, failedSources: 0 });
    expect(await loadNotificationState()).toEqual(savedBeforeUnmount);
    expect(presentSourceNotification).not.toHaveBeenCalled();
    expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(26);
    expect(fetcher).toHaveBeenCalledTimes(104);
    await expectDetached(() => fetcher.mock.calls.length);
  });
});
