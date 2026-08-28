import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { ToastAndroid } from 'react-native';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import {
  clearNotificationSourceForContentDisable,
  defaultNotificationState,
  loadNotificationState,
  recordNotificationDelivery,
  recordNotificationSnapshot,
  resetNotificationSourceIdentity,
  setGlobalNotificationIntent,
  setSourceNotificationIntent
} from '@/platform/notifications/notificationStore';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import {
  dismissSourceNotification,
  dismissSourceNotificationExact,
  notificationPermissionGranted,
  presentSourceNotification,
  requestNotificationPermission,
  reconcileSourceNotificationSlots,
  syncNotificationBackgroundRegistration
} from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import { QueryTestWrapper } from '../QueryTestWrapper';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined)
  }
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  getLastNotificationResponseAsync: jest.fn(async () => null)
}));

jest.mock('@/platform/notifications/notificationSystem', () => ({
  dismissSourceNotification: jest.fn(async () => undefined),
  dismissSourceNotificationExact: jest.fn(async () => undefined),
  notificationPermissionGranted: jest.fn(async () => false),
  openNotificationSystemSettings: jest.fn(async () => undefined),
  presentSourceNotification: jest.fn(async (_source: string, _digest: unknown, identifier: string) => identifier),
  requestNotificationPermission: jest.fn(async () => false),
  reconcileSourceNotificationSlots: jest.fn(async () => undefined),
  syncNotificationBackgroundRegistration: jest.fn(async () => false)
}));

jest.mock('@/platform/notifications/notificationWorker', () => ({
  runNotificationBackgroundWorker: jest.fn(async () => ({
    status: 'success',
    delivered: 0,
    failedSources: 0,
    timedOut: false
  }))
}));

const mockContentDisableReleases: (() => void)[] = [];

jest.mock('@/platform/notifications/notificationStore', () => {
  const actual = jest.requireActual<typeof import('@/platform/notifications/notificationStore')>(
    '@/platform/notifications/notificationStore'
  );
  return {
    ...actual,
    clearNotificationSourceForContentDisable: jest.fn(
      (...args: Parameters<typeof actual.clearNotificationSourceForContentDisable>) =>
        new Promise<Awaited<ReturnType<typeof actual.clearNotificationSourceForContentDisable>>>((resolve, reject) => {
          mockContentDisableReleases.push(() => {
            void actual.clearNotificationSourceForContentDisable(...args).then(resolve, reject);
          });
        })
    ),
    loadNotificationState: jest.fn(actual.loadNotificationState),
    recordNotificationDelivery: jest.fn(actual.recordNotificationDelivery),
    recordNotificationSnapshot: jest.fn(actual.recordNotificationSnapshot),
    resetNotificationSourceIdentity: jest.fn(actual.resetNotificationSourceIdentity),
    setGlobalNotificationIntent: jest.fn(actual.setGlobalNotificationIntent),
    setSourceNotificationIntent: jest.fn(actual.setSourceNotificationIntent)
  };
});

function notificationResponse(source: string, identifier: string, date: number): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date,
      request: {
        identifier,
        content: {
          title: null,
          subtitle: null,
          body: null,
          data: { source },
          categoryIdentifier: null,
          sound: null
        },
        trigger: null
      }
    }
  };
}

function nodeSeekSessions(identityTrust: 'confirmed' | 'unknown' | 'none', userId = '42') {
  const sessions = createSiteSessionViewModels(
    createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'nodeseek',
          id: userId,
          username: 'alice',
          url: `https://www.nodeseek.com/space/${userId}`,
          topics: []
        }
      }
    })
  );
  return {
    ...sessions,
    nodeseek: {
      ...sessions.nodeseek,
      canWrite: identityTrust === 'confirmed',
      identityTrust
    }
  };
}

function nodeSeekAndLinuxDoSessions() {
  const sessions = createSiteSessionViewModels(
    createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'nodeseek',
          id: '42',
          username: 'alice',
          url: 'https://www.nodeseek.com/space/42',
          topics: []
        }
      },
      linuxdo: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'linuxdo',
          id: '84',
          username: 'bob',
          url: 'https://linux.do/u/bob',
          topics: []
        }
      }
    })
  );
  return {
    ...sessions,
    nodeseek: { ...sessions.nodeseek, canWrite: true, identityTrust: 'confirmed' as const },
    linuxdo: { ...sessions.linuxdo, canWrite: true, identityTrust: 'confirmed' as const }
  };
}

function runtimeOptions(
  openSource = jest.fn(() => true),
  sessions = createSiteSessionViewModels(createSiteSessionStates()),
  enabledNotificationSources: readonly NotificationSource[] = []
) {
  const privateAccessAllowed = (source: NotificationSource, identityKey: string) => {
    const session = sessions[source];
    const userId = String(session.currentUser?.id || '').trim();
    return session.isLoggedIn && session.identityTrust === 'confirmed' && `${source}:${userId}` === identityKey;
  };
  return {
    appActive: false,
    contentSourcesReady: true,
    enabledNotificationSources,
    fetcher: jest.fn(),
    getLinuxDoUserAgent: jest.fn(() => 'linux.do'),
    getNodeSeekUserAgent: jest.fn(() => 'NodeSeek'),
    onSessionExpired: jest.fn(),
    openSource,
    privateAccessAllowed,
    remoteReady: true,
    sessionEpochs: initialForumSessionEpochs,
    sessions
  };
}

async function settleStartedRuntimeTasks(unmount = true) {
  if (unmount) await cleanup();
  await act(async () => {
    let settledCount = -1;
    while (true) {
      const tasks = [
        ...jest.mocked(clearNotificationSourceForContentDisable).mock.results,
        ...jest.mocked(loadNotificationState).mock.results,
        ...jest.mocked(recordNotificationDelivery).mock.results,
        ...jest.mocked(recordNotificationSnapshot).mock.results,
        ...jest.mocked(resetNotificationSourceIdentity).mock.results,
        ...jest.mocked(setGlobalNotificationIntent).mock.results,
        ...jest.mocked(setSourceNotificationIntent).mock.results,
        ...jest.mocked(dismissSourceNotification).mock.results,
        ...jest.mocked(runNotificationBackgroundWorker).mock.results,
        ...jest.mocked(syncNotificationBackgroundRegistration).mock.results
      ].map(({ value }) => Promise.resolve(value));
      mockContentDisableReleases.splice(0).forEach((release) => release());
      const stable = tasks.length === settledCount;
      settledCount = tasks.length;
      await Promise.allSettled(tasks);
      if (stable) break;
    }
  });
}

describe('notification runtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appQueryClient.clear();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(null);
    jest.mocked(notificationPermissionGranted).mockResolvedValue(false);
    jest.mocked(requestNotificationPermission).mockResolvedValue(false);
    jest.mocked(presentSourceNotification).mockImplementation(async (_source, _digest, identifier) => identifier);
    jest.mocked(runNotificationBackgroundWorker).mockResolvedValue({
      status: 'success',
      delivered: 0,
      failedSources: 0,
      timedOut: false
    });
    jest.mocked(syncNotificationBackgroundRegistration).mockResolvedValue(false);
  });

  it('does not read credentials or start notification work before content-source settings are ready', async () => {
    let contentSourcesReady = false;
    const stored = defaultNotificationState();
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 0, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );

    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          ),
          appActive: true,
          contentSourcesReady,
          enabledNotificationSources: ['nodeseek'],
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    expect(hook.result.current.ready).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(runNotificationBackgroundWorker).not.toHaveBeenCalled();
    expect(syncNotificationBackgroundRegistration).not.toHaveBeenCalled();
    expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    contentSourcesReady = true;
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled();
    await settleStartedRuntimeTasks();
  });

  it('clears disabled content-source delivery state while preserving notification intent and trusted identity', async () => {
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known'],
      lastSuccessAt: '2026-08-03T00:00:00Z',
      unreadCount: 4,
      notificationIdentifier: 'android-id'
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });

    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          ),
          enabledNotificationSources: []
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await settleStartedRuntimeTasks(false);
    await waitFor(() =>
      expect(hook.result.current.state.sources.nodeseek).toEqual({
        intentEnabled: true,
        identityKey: 'nodeseek:42',
        baselineReady: false,
        deliveredIds: []
      })
    );
    expect(hook.result.current.activeSources).toEqual([]);
    expect(hook.result.current.unreadTotal).toBe(0);
    expect(dismissSourceNotification).toHaveBeenCalledWith('nodeseek', 'android-id', 'nodeseek:42');
    await settleStartedRuntimeTasks();
  });

  it('cancels the previous aggregate notification owner without aborting the new enabled-set owner', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    let enabledNotificationSources: readonly NotificationSource[] = ['nodeseek'];
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          ),
          enabledNotificationSources
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await waitFor(() => expect(syncNotificationBackgroundRegistration).toHaveBeenCalled());

    const oldKey = forumQueryKeys.notificationList({
      source: 'all',
      identityKey: hook.result.current.identitySignature,
      unreadOnly: false
    });
    const newKey = forumQueryKeys.notificationList({ source: 'all', identityKey: ':', unreadOnly: false });
    appQueryClient.setQueryData(oldKey, 'old-owner');
    appQueryClient.setQueryData(newKey, 'new-owner');
    const canceledKeys: (readonly unknown[])[] = [];
    const cancelQueries = jest.spyOn(appQueryClient, 'cancelQueries').mockImplementation(async (filters = {}) => {
      canceledKeys.push(
        ...appQueryClient
          .getQueryCache()
          .findAll(filters)
          .map((query) => query.queryKey)
      );
    });

    try {
      enabledNotificationSources = [];
      await act(async () => {
        hook.rerender({});
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(cancelQueries).toHaveBeenCalled();
      expect(canceledKeys).toContainEqual(oldKey);
      expect(canceledKeys).not.toContainEqual(newKey);
      expect(appQueryClient.getQueryData(newKey)).toBe('new-owner');
      await settleStartedRuntimeTasks();
    } finally {
      cancelQueries.mockRestore();
    }
  });

  it('updates source presentation order without canceling queries, probing, or resyncing background work', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    stored.sources.linuxdo.identityKey = 'linuxdo:84';
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    let enabledNotificationSources: readonly NotificationSource[] = ['nodeseek', 'linuxdo'];
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekAndLinuxDoSessions()
          ),
          enabledNotificationSources
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.activeSources).toEqual(['nodeseek', 'linuxdo']));
    await waitFor(() => expect(syncNotificationBackgroundRegistration).toHaveBeenCalled());
    await settleStartedRuntimeTasks(false);
    const cancelQueries = jest.spyOn(appQueryClient, 'cancelQueries');
    const removeQueries = jest.spyOn(appQueryClient, 'removeQueries');
    const dismissCount = jest.mocked(dismissSourceNotification).mock.calls.length;
    const workerCount = jest.mocked(runNotificationBackgroundWorker).mock.calls.length;
    const registrationCount = jest.mocked(syncNotificationBackgroundRegistration).mock.calls.length;

    enabledNotificationSources = ['linuxdo', 'nodeseek'];
    await act(async () => hook.rerender({}));

    expect(hook.result.current.enabledNotificationSources).toEqual(['linuxdo', 'nodeseek']);
    expect(hook.result.current.activeSources).toEqual(['linuxdo', 'nodeseek']);
    expect(cancelQueries).not.toHaveBeenCalled();
    expect(removeQueries).not.toHaveBeenCalled();
    expect(dismissSourceNotification).toHaveBeenCalledTimes(dismissCount);
    expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(workerCount);
    expect(syncNotificationBackgroundRegistration).toHaveBeenCalledTimes(registrationCount);
    cancelQueries.mockRestore();
    removeQueries.mockRestore();
    await settleStartedRuntimeTasks();
  });

  it('reads only the newly added source without rereading a stable sibling', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    stored.sources.linuxdo.identityKey = 'linuxdo:84';
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    const fetcher = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.includes('nodeseek')
            ? { atMe: 0, reply: 1, message: 0 }
            : { total_rows_notifications: 2, notifications: [] }
        ),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    let enabledNotificationSources: readonly NotificationSource[] = ['nodeseek'];
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekAndLinuxDoSessions()
          ),
          appActive: true,
          enabledNotificationSources,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.unreadTotal).toBe(1));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await settleStartedRuntimeTasks(false);
    enabledNotificationSources = ['nodeseek', 'linuxdo'];
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(hook.result.current.activeSources).toContain('linuxdo'));
    await waitFor(() => expect(hook.result.current.snapshotErrors).toEqual({}));
    await waitFor(() => expect(hook.result.current.unreadTotal).toBe(3));

    expect(fetcher).toHaveBeenCalledTimes(2);
    await settleStartedRuntimeTasks();
  });

  it('runs one source read and one persistence per ready, resume, and explicit refresh event', async () => {
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    stored.sources.nodeseek.intentEnabled = true;
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    let appActive = true;
    let remoteReady = false;
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed'),
            ['nodeseek']
          ),
          appActive,
          fetcher,
          remoteReady
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(hook.result.current.activeSources).toEqual(['nodeseek']));
    expect(fetcher).not.toHaveBeenCalled();

    remoteReady = true;
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(1));
    await act(async () => hook.rerender({}));
    expect(recordNotificationSnapshot).toHaveBeenCalledTimes(1);

    appActive = false;
    await act(async () => hook.rerender({}));
    appActive = true;
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(2));

    const snapshotErrors = hook.result.current.snapshotErrors;
    await act(async () => hook.result.current.refreshSnapshots());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalledTimes(3));
    expect(hook.result.current.snapshotErrors).toBe(snapshotErrors);
    await settleStartedRuntimeTasks();
  });

  it('does not replay a cached snapshot when an identity returns before its refetch completes', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    let blockNextFetch = false;
    let releaseReturningIdentity: (() => void) | undefined;
    const response = () =>
      new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    const fetcher = jest.fn(async () => {
      if (blockNextFetch) {
        blockNextFetch = false;
        await new Promise<void>((resolve) => {
          releaseReturningIdentity = resolve;
        });
      }
      return response();
    });
    let sessions = nodeSeekSessions('confirmed', '42');
    let remoteReady = false;
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            sessions,
            ['nodeseek']
          ),
          appActive: true,
          fetcher,
          remoteReady
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(hook.result.current.activeSources).toEqual(['nodeseek']));
    remoteReady = true;
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await waitFor(() => expect(hook.result.current.snapshotErrors).toEqual({}));
    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(1));
    sessions = nodeSeekSessions('confirmed', '84');
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(2));

    const previousFetchCount = fetcher.mock.calls.length;
    blockNextFetch = true;
    sessions = nodeSeekSessions('confirmed', '42');
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(previousFetchCount + 1));
    expect(recordNotificationSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => releaseReturningIdentity?.());
    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(3));
    await settleStartedRuntimeTasks();
  });

  it('waits for identity reset before reading and persisting its first snapshot', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    let fetchCount = 0;
    const fetcher = jest.fn(async () => {
      fetchCount += 1;
      const total = fetchCount === 1 ? 1 : 5;
      return new Response(JSON.stringify({ atMe: 0, reply: total, message: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    let sessions = nodeSeekSessions('confirmed', '42');
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            sessions,
            ['nodeseek']
          ),
          appActive: true,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(1));
    let releaseDismissal!: () => void;
    const dismissalBlocked = new Promise<void>((resolve) => {
      releaseDismissal = resolve;
    });
    let dismissalStarted!: () => void;
    const dismissalDidStart = new Promise<void>((resolve) => {
      dismissalStarted = resolve;
    });
    jest.mocked(dismissSourceNotification).mockImplementationOnce(async () => {
      dismissalStarted();
      await dismissalBlocked;
    });

    sessions = nodeSeekSessions('confirmed', '84');
    await act(async () => hook.rerender({}));
    await dismissalDidStart;
    await act(async () => Promise.resolve());

    expect(fetcher).toHaveBeenCalledTimes(1);
    releaseDismissal();
    await act(async () => dismissalBlocked);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(recordNotificationSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(JSON.parse(persisted).sources.nodeseek).toEqual(
        expect.objectContaining({
          identityKey: 'nodeseek:84',
          unreadCount: 5
        })
      )
    );
    await settleStartedRuntimeTasks();
  });

  it('keeps a rapidly re-enabled source operationally paused until its disable cleanup finishes', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old'],
      unreadCount: 4,
      notificationIdentifier: 'node-digest'
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    let enabledNotificationSources: readonly NotificationSource[] = ['nodeseek'];
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          ),
          appActive: true,
          enabledNotificationSources,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalled());
    const firstWorker = jest.mocked(runNotificationBackgroundWorker).mock.calls[0]![0];
    fetcher.mockClear();
    jest.mocked(runNotificationBackgroundWorker).mockClear();
    jest.mocked(syncNotificationBackgroundRegistration).mockClear();
    const snapshotErrors = hook.result.current.snapshotErrors;

    let finishDismiss!: () => void;
    const dismissPending = new Promise<void>((resolve) => {
      finishDismiss = resolve;
    });
    jest.mocked(dismissSourceNotification).mockImplementation(async (source) => {
      if (source === 'nodeseek') await dismissPending;
    });

    enabledNotificationSources = [];
    await act(async () => hook.rerender({}));
    expect(hook.result.current.unreadTotal).toBe(0);
    await waitFor(() =>
      expect(dismissSourceNotification).toHaveBeenCalledWith('nodeseek', 'node-digest', 'nodeseek:42')
    );
    await expect(firstWorker.sourceAllowed('nodeseek')).resolves.toBe(false);
    expect(hook.result.current.activeSources).not.toContain('nodeseek');
    expect(hook.result.current.snapshotErrors).toBe(snapshotErrors);

    enabledNotificationSources = ['nodeseek'];
    await act(async () => hook.rerender({}));

    expect(hook.result.current.activeSources).not.toContain('nodeseek');
    expect(fetcher).not.toHaveBeenCalled();
    expect(runNotificationBackgroundWorker).not.toHaveBeenCalled();

    await act(async () => finishDismiss());
    await settleStartedRuntimeTasks(false);
    await waitFor(() => expect(hook.result.current.activeSources).toContain('nodeseek'));
    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.deliveredIds).toEqual([]));
    await settleStartedRuntimeTasks();
  });

  it('keeps a failed disable cleanup fail-closed and retries it after another explicit source change', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.identityKey = 'nodeseek:42';
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    let enabledNotificationSources: readonly NotificationSource[] = ['nodeseek'];
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          ),
          enabledNotificationSources
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.activeSources).toContain('nodeseek'));

    jest
      .mocked(dismissSourceNotification)
      .mockRejectedValueOnce(new Error('dismiss failed'))
      .mockResolvedValue(undefined);
    enabledNotificationSources = [];
    await act(async () => hook.rerender({}));
    await settleStartedRuntimeTasks(false);

    await waitFor(() => expect(hook.result.current.snapshotErrors.nodeseek).toBe('dismiss failed'));
    expect(hook.result.current.activeSources).not.toContain('nodeseek');

    enabledNotificationSources = ['nodeseek'];
    await act(async () => hook.rerender({}));
    await settleStartedRuntimeTasks(false);

    await waitFor(() =>
      expect(
        jest.mocked(dismissSourceNotification).mock.calls.filter(([source]) => source === 'nodeseek')
      ).toHaveLength(2)
    );
    await waitFor(() => expect(hook.result.current.activeSources).toContain('nodeseek'));
    expect(hook.result.current.snapshotErrors.nodeseek).toBeUndefined();
    await settleStartedRuntimeTasks();
  });

  it('keeps stored unread state without showing a native foreground toast', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.unreadCount = 1;
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);

    try {
      const hook = await renderHook(
        () =>
          useNotificationsRuntime({
            ...runtimeOptions(),
            enabledNotificationSources: ['nodeseek']
          }),
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(hook.result.current.unreadTotal).toBe(1));
      expect(toast).not.toHaveBeenCalled();
      await settleStartedRuntimeTasks();
    } finally {
      toast.mockRestore();
    }
  });

  it('keeps identity keys stable when the session container changes without an identity change', async () => {
    let sessions = createSiteSessionViewModels(createSiteSessionStates());
    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            sessions
          )
        ),
      { wrapper: QueryTestWrapper }
    );
    const firstIdentityKeys = hook.result.current.identityKeys;

    sessions = createSiteSessionViewModels(createSiteSessionStates());
    await act(async () => {
      hook.rerender({});
    });

    expect(hook.result.current.identityKeys).toBe(firstIdentityKeys);
    await settleStartedRuntimeTasks();
  });

  it('opens a warm Android notification response once and clears it', async () => {
    const openSource = jest.fn(() => true);
    await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(openSource),
          enabledNotificationSources: ['nodeseek']
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1));
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]![0];
    const response = notificationResponse('nodeseek', 'warm-nodeseek', 1);

    await act(async () => {
      listener(response);
      listener(response);
    });

    expect(openSource).toHaveBeenCalledTimes(1);
    expect(openSource).toHaveBeenCalledWith('nodeseek');
    await waitFor(() => expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
    await settleStartedRuntimeTasks();
  });

  it('opens a cold Android notification response once and clears duplicate delivery', async () => {
    const response = notificationResponse('linuxdo', 'cold-linuxdo', 2);
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(response);
    const openSource = jest.fn(() => true);
    await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(openSource),
          enabledNotificationSources: ['linuxdo']
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(openSource).toHaveBeenCalledWith('linuxdo'));
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]![0];
    await act(async () => listener(response));

    expect(openSource).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
    await settleStartedRuntimeTasks();
  });

  it.each(['warm', 'cold'] as const)(
    'clears a %s response for a disabled content source without opening it',
    async (kind) => {
      const response = notificationResponse('nodeseek', `${kind}-disabled`, 3);
      if (kind === 'cold') jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(response);
      const openSource = jest.fn(() => true);

      await renderHook(
        () =>
          useNotificationsRuntime({
            ...runtimeOptions(openSource),
            enabledNotificationSources: ['linuxdo']
          }),
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1));
      if (kind === 'warm') {
        const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]![0];
        await act(async () => listener(response));
      }

      await waitFor(() => expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
      expect(openSource).not.toHaveBeenCalled();
      await settleStartedRuntimeTasks();
    }
  );

  it('drops a deferred notification response when its source is disabled before navigation becomes ready', async () => {
    const openSource = jest.fn(() => false);
    let enabledNotificationSources: readonly NotificationSource[] = ['nodeseek'];
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(openSource),
          enabledNotificationSources
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1));
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]![0];
    await act(async () => listener(notificationResponse('nodeseek', 'deferred-disabled', 4)));
    expect(openSource).toHaveBeenCalledTimes(1);

    enabledNotificationSources = [];
    await act(async () => hook.rerender({}));
    await act(async () => hook.result.current.onNavigationReady());
    expect(openSource).toHaveBeenCalledTimes(1);

    enabledNotificationSources = ['nodeseek'];
    await act(async () => hook.rerender({}));
    await act(async () => hook.result.current.onNavigationReady());
    expect(openSource).toHaveBeenCalledTimes(1);
    await settleStartedRuntimeTasks();
  });

  it('keeps first opt-in intent but leaves background disabled when Android permission is denied', async () => {
    const hook = await renderHook(() => useNotificationsRuntime(runtimeOptions()), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    await act(async () => {
      await hook.result.current.setGlobalEnabled(true);
    });

    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toMatchObject({ globalEnabled: true, hasOptedIn: true });
    expect(hook.result.current.permission).toBe('denied');
    expect(hook.result.current.backgroundEnabled).toBe(false);
    expect(syncNotificationBackgroundRegistration).toHaveBeenLastCalledWith(
      expect.objectContaining({ globalEnabled: true, hasOptedIn: true }),
      false,
      []
    );
    await settleStartedRuntimeTasks();
  });

  it.each(['unknown'] as const)(
    'retains the trusted identity, cache, and delivery watermark while identity is %s',
    async (identityTrust) => {
      const stored = defaultNotificationState();
      stored.sources.nodeseek = {
        intentEnabled: true,
        identityKey: 'nodeseek:42',
        baselineReady: true,
        deliveredIds: ['reply:known']
      };
      let persisted = JSON.stringify(stored);
      jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
      jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
        persisted = value;
      });
      const notificationCache = { items: ['cached'] };
      appQueryClient.setQueryData(forumQueryKeys.notifications('nodeseek'), notificationCache);
      const fetcher = jest.fn();

      const hook = await renderHook(
        () =>
          useNotificationsRuntime({
            ...runtimeOptions(
              jest.fn(() => true),
              nodeSeekSessions(identityTrust),
              ['nodeseek']
            ),
            fetcher
          }),
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(hook.result.current.identityKeys.nodeseek).toBe('nodeseek:42'));
      expect(hook.result.current.activeSources).not.toContain('nodeseek');
      expect(hook.result.current.state.sources.nodeseek.deliveredIds).toEqual(['reply:known']);
      expect(appQueryClient.getQueryData(forumQueryKeys.notifications('nodeseek'))).toBe(notificationCache);
      expect(dismissSourceNotification).not.toHaveBeenCalledWith('nodeseek', expect.anything(), expect.anything());
      expect(fetcher).not.toHaveBeenCalled();
      await settleStartedRuntimeTasks();
    }
  );

  it('refreshes and persists current unread before running shared delivery', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );

    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed'),
            ['nodeseek']
          ),
          appActive: true,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalled());
    await waitFor(() => expect(hook.result.current.unreadTotal).toBe(1));
    await waitFor(() => expect(JSON.parse(persisted).sources.nodeseek.unreadCount).toBe(1));
    expect(runNotificationBackgroundWorker).toHaveBeenCalledWith(expect.objectContaining({ sources: ['nodeseek'] }));
    const dependencies = jest.mocked(runNotificationBackgroundWorker).mock.calls[0]![0];
    jest.mocked(dismissSourceNotification).mockClear();
    await dependencies.system.presentDigest(
      'nodeseek',
      {
        title: 'NodeSeek',
        body: 'Alice 回复了你的主题',
        data: { source: 'nodeseek' }
      },
      'wz-message-nodeseek-nodeseek%3A42'
    );
    expect(presentSourceNotification).toHaveBeenCalledTimes(1);
    await dependencies.system.dismissDigest('nodeseek', 'wz-message-nodeseek-nodeseek%3A42');
    expect(dismissSourceNotificationExact).toHaveBeenCalledWith('wz-message-nodeseek-nodeseek%3A42');
    expect(dismissSourceNotification).not.toHaveBeenCalled();
    await dependencies.system.reconcileDigests('nodeseek', 'nodeseek:42', 'wz-message-nodeseek-nodeseek%3A42');
    expect(reconcileSourceNotificationSlots).toHaveBeenCalledWith(
      'nodeseek',
      'nodeseek:42',
      'wz-message-nodeseek-nodeseek%3A42'
    );
    await settleStartedRuntimeTasks();
  });

  it('gives the foreground worker a canonical private-access predicate', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old']
    };
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    let snapshot: SessionRuntimeSnapshot = {
      source: 'nodeseek',
      authenticated: true,
      authSurfaceOpen: false,
      identityKey: 'nodeseek:42',
      identityTrust: 'confirmed',
      sessionEpoch: 1,
      sourceEnabled: true
    };
    const privateAccessAllowed = jest.fn((_source: NotificationSource, identityKey: string) => {
      return (
        snapshot.sourceEnabled !== false &&
        snapshot.authenticated &&
        !snapshot.authSurfaceOpen &&
        snapshot.identityTrust === 'confirmed' &&
        snapshot.identityKey === identityKey
      );
    });
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );

    await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed'),
            ['nodeseek']
          ),
          appActive: true,
          fetcher,
          privateAccessAllowed
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalled());
    const dependencies = jest.mocked(runNotificationBackgroundWorker).mock.calls[0]![0];
    expect(dependencies.privateAccessAllowed).toBeDefined();
    await expect(dependencies.privateAccessAllowed?.('nodeseek', 'nodeseek:42')).resolves.toBe(true);

    snapshot = { ...snapshot, identityTrust: 'unknown' };
    await expect(dependencies.privateAccessAllowed?.('nodeseek', 'nodeseek:42')).resolves.toBe(false);
    snapshot = { ...snapshot, identityTrust: 'confirmed', authSurfaceOpen: true };
    await expect(dependencies.privateAccessAllowed?.('nodeseek', 'nodeseek:42')).resolves.toBe(false);
    snapshot = { ...snapshot, authSurfaceOpen: false, identityKey: 'nodeseek:84' };
    await expect(dependencies.privateAccessAllowed?.('nodeseek', 'nodeseek:42')).resolves.toBe(false);
    snapshot = { ...snapshot, identityKey: 'nodeseek:42', authenticated: false };
    await expect(dependencies.privateAccessAllowed?.('nodeseek', 'nodeseek:42')).resolves.toBe(false);
    snapshot = { ...snapshot, authenticated: true, sourceEnabled: false };
    await expect(dependencies.privateAccessAllowed?.('nodeseek', 'nodeseek:42')).resolves.toBe(false);
    await settleStartedRuntimeTasks();
  });

  it('does not suppress foreground delivery when snapshot persistence fails', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old']
    };
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );

    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed'),
            ['nodeseek']
          ),
          appActive: true,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() =>
      expect(runNotificationBackgroundWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: ['nodeseek']
        })
      )
    );
    await waitFor(() => expect(hook.result.current.unreadTotal).toBe(1));
    await settleStartedRuntimeTasks();
  });

  it('still presents an Android notification while the message center is visible', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old']
    };
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    const appActive = true;
    const options = runtimeOptions(
      jest.fn(() => true),
      nodeSeekSessions('confirmed'),
      ['nodeseek']
    );
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...options,
          appActive,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalled());
    const dependencies = jest.mocked(runNotificationBackgroundWorker).mock.calls[0]![0];
    await act(async () => {
      hook.result.current.setCenterVisible(true);
    });

    await expect(
      dependencies.system.presentDigest(
        'nodeseek',
        {
          title: 'NodeSeek',
          body: 'Alice 回复了你的主题',
          data: { source: 'nodeseek' }
        },
        'wz-message-nodeseek-nodeseek%3A42'
      )
    ).resolves.toBe('wz-message-nodeseek-nodeseek%3A42');
    expect(presentSourceNotification).toHaveBeenCalledTimes(1);
    await settleStartedRuntimeTasks();
  });

  it('clears the previous account watermark after a confirmed account switch', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known'],
      unreadCount: 7
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    appQueryClient.setQueryData(forumQueryKeys.notifications('nodeseek'), { items: ['cached'] });

    let sessions = nodeSeekSessions('confirmed');
    const seenUnreadTotals: number[] = [];
    const hook = await renderHook(
      () => {
        const runtime = useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            sessions,
            ['nodeseek']
          )
        );
        seenUnreadTotals.push(runtime.unreadTotal);
        return runtime;
      },
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    seenUnreadTotals.length = 0;
    sessions = nodeSeekSessions('confirmed', '84');
    await act(async () => hook.rerender({}));

    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.identityKey).toBe('nodeseek:84'));
    expect(hook.result.current.identityKeys.nodeseek).toBe('nodeseek:84');
    expect(seenUnreadTotals).not.toContain(7);
    expect(hook.result.current.state.sources.nodeseek.deliveredIds).toEqual([]);
    expect(appQueryClient.getQueryData(forumQueryKeys.notifications('nodeseek'))).toBeUndefined();
    await settleStartedRuntimeTasks();
  });

  it('lets only the latest account reconciliation persist its identity', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    let releaseDismissal!: () => void;
    const dismissalBlocked = new Promise<void>((resolve) => {
      releaseDismissal = resolve;
    });
    let dismissalStarted!: () => void;
    const dismissalDidStart = new Promise<void>((resolve) => {
      dismissalStarted = resolve;
    });
    jest.mocked(dismissSourceNotification).mockImplementationOnce(async () => {
      dismissalStarted();
      await dismissalBlocked;
    });

    let sessions = nodeSeekSessions('confirmed', '42');
    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            sessions,
            ['nodeseek']
          )
        ),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    sessions = nodeSeekSessions('confirmed', '84');
    await act(async () => hook.rerender({}));
    await dismissalDidStart;
    sessions = nodeSeekSessions('confirmed', '126');
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.identityKey).toBe('nodeseek:126'));

    releaseDismissal();
    await act(async () => dismissalBlocked);
    await settleStartedRuntimeTasks();

    expect(JSON.parse(persisted).sources.nodeseek.identityKey).toBe('nodeseek:126');
  });

  it('clears the previous account watermark after an explicit logout', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    appQueryClient.setQueryData(forumQueryKeys.notifications('nodeseek'), { items: ['cached'] });
    const aggregateKey = forumQueryKeys.notificationList({
      source: 'all',
      identityKey: 'nodeseek:42',
      unreadOnly: false
    });
    appQueryClient.setQueryData(aggregateKey, { items: ['private aggregate row'] });

    let sessions = nodeSeekSessions('confirmed');
    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            sessions,
            ['nodeseek']
          )
        ),
      { wrapper: QueryTestWrapper }
    );
    sessions = createSiteSessionViewModels(createSiteSessionStates());
    await act(async () => hook.rerender({}));

    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.identityKey).toBeUndefined());
    expect(hook.result.current.state.sources.nodeseek.deliveredIds).toEqual([]);
    expect(appQueryClient.getQueryData(forumQueryKeys.notifications('nodeseek'))).toBeUndefined();
    expect(appQueryClient.getQueryData(aggregateKey)).toBeUndefined();
    await settleStartedRuntimeTasks();
  });
});
