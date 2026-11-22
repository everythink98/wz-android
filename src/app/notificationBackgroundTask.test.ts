import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationSources, sourceCatalog, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { AccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import {
  defaultNotificationState,
  loadNotificationState,
  NOTIFICATION_STORAGE_KEY,
  saveNotificationState
} from '@/platform/notifications/notificationStore';
import type {
  NotificationWorkerDependencies,
  runNotificationBackgroundWorker
} from '@/platform/notifications/notificationWorker';
import { markAccountSessionHandoffPending, saveAccountSessionSnapshot } from '@/platform/storage/accountSessionStore';
import { withReaderSettings } from '@/platform/storage/readerDataStore';
import type { NotificationAdapter } from '@/sources/notificationAdapter';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  task: undefined as undefined | (() => Promise<unknown>),
  dismissBroad: vi.fn(async () => undefined),
  dismissExact: vi.fn(async () => undefined),
  loadReaderSettings: vi.fn(),
  listPage: vi.fn<NotificationAdapter['listPage']>(),
  probeAccess: vi.fn<NotificationWorkerDependencies['network']['probeAccess']>(),
  presentDigest: vi.fn<NotificationWorkerDependencies['system']['presentDigest']>(),
  reconcile: vi.fn(async () => undefined),
  runWorker: vi.fn<typeof runNotificationBackgroundWorker>()
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mocks.storage.set(key, value);
    })
  }
}));
vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Failed: 'failed', Success: 'success' }
}));
vi.mock('expo-task-manager', () => ({
  isTaskDefined: vi.fn(() => false),
  defineTask: vi.fn((_name: string, task: () => Promise<unknown>) => {
    mocks.task = task;
  })
}));
vi.mock('@/platform/network/networkProxy', () => ({
  enabledNetworkProxyProfile: vi.fn(() => null),
  applyNetworkProxy: vi.fn(),
  loadNetworkProxyState: vi.fn(async () => ({ enabled: false }))
}));
vi.mock('@/sources/notificationAdapters', () => ({
  notificationAdapters: {
    linuxdo: { listPage: mocks.listPage },
    nodeseek: { listPage: mocks.listPage },
    yaohuo: { listPage: mocks.listPage }
  }
}));
vi.mock('@/sources/notificationBackgroundAccess', () => ({ probeBackgroundNotificationAccess: mocks.probeAccess }));
vi.mock('@/platform/notifications/notificationSystem', () => ({
  NOTIFICATION_BACKGROUND_TASK: 'wz-message-notifications',
  dismissSourceNotification: mocks.dismissBroad,
  dismissSourceNotificationExact: mocks.dismissExact,
  notificationPermissionGranted: vi.fn(async () => true),
  presentSourceNotification: mocks.presentDigest,
  reconcileSourceNotificationSlots: mocks.reconcile
}));
vi.mock('@/platform/notifications/notificationWorker', () => ({
  runNotificationBackgroundWorker: mocks.runWorker
}));
vi.mock('@/platform/storage/readerDataStore', () => ({
  withReaderSettings: vi.fn((run: (read: typeof mocks.loadReaderSettings) => Promise<unknown>) =>
    run(mocks.loadReaderSettings)
  )
}));

import './notificationBackgroundTask';

beforeEach(() => {
  mocks.storage.clear();
  vi.mocked(AsyncStorage.getItem)
    .mockReset()
    .mockImplementation(async (key) => mocks.storage.get(key) ?? null);
  mocks.loadReaderSettings.mockReset();
  vi.mocked(withReaderSettings).mockClear();
  mocks.listPage.mockReset();
  mocks.probeAccess.mockReset();
  mocks.presentDigest.mockReset().mockImplementation(async (_source, _digest, identifier) => identifier);
  mocks.reconcile.mockClear();
  mocks.dismissExact.mockClear();
  mocks.runWorker.mockReset().mockResolvedValue({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
});

describe('notification background task content-source allowlist', () => {
  it.each(['open', 'read'])(
    'times out a delayed settings %s and closes the connection without starting delivery',
    async (stage) => {
      vi.useFakeTimers();
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const close = vi.fn();
      const read = vi.fn(async () => {
        if (stage === 'read') await blocked;
        return createEmptyReaderData().settings;
      });
      vi.mocked(withReaderSettings).mockImplementationOnce(async (run) => {
        if (stage === 'open') await blocked;
        try {
          return await run(read);
        } finally {
          close();
        }
      });
      let result: unknown = 'pending';
      const task = mocks.task!().then((value) => {
        result = value;
      });
      try {
        await vi.advanceTimersByTimeAsync(50_000);
        expect(result).toBe('failed');
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(read).toHaveBeenCalledTimes(stage === 'open' ? 0 : 1);
        expect(close).toHaveBeenCalledOnce();
        expect(mocks.runWorker).not.toHaveBeenCalled();
      } finally {
        release();
        await task;
        vi.useRealTimers();
      }
    }
  );

  it('uses the remaining task budget for the worker and rejects a late identity probe', async () => {
    await prepareBackgroundDelivery('nodeseek');
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.loadReaderSettings.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40_000));
      return {};
    });
    mocks.probeAccess.mockImplementationOnce(async () => {
      await blocked;
      return { identityKey: 'nodeseek:7', userId: '7' };
    });
    let result: unknown = 'pending';
    const task = mocks.task!().then((value) => {
      result = value;
    });
    try {
      await vi.advanceTimersByTimeAsync(49_999);
      expect(mocks.probeAccess).toHaveBeenCalledOnce();
      expect(result).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toBe('failed');
      expect(mocks.probeAccess.mock.calls[0]?.[1].aborted).toBe(true);
    } finally {
      release();
      await task;
      vi.useRealTimers();
    }
    expect(mocks.listPage).not.toHaveBeenCalled();
    expect(mocks.presentDigest).not.toHaveBeenCalled();
  });

  it('records task-entry failure before the worker starts', async () => {
    mocks.loadReaderSettings.mockRejectedValueOnce(new Error('storage PRIVATE_SETTINGS'));
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    try {
      await expect(mocks.task?.()).rejects.toThrow('PRIVATE_SETTINGS');
    } finally {
      setDiagnosticWriter(null);
    }
    expect(mocks.runWorker).not.toHaveBeenCalled();
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        operation: 'notification-background-task',
        phase: 'finish',
        outcome: 'failure',
        reason: 'storage_error'
      })
    );
    expect(lines.join('')).not.toContain('PRIVATE_SETTINGS');
  });
  it('loads preferences for each invocation and rechecks them through the worker current-source gate', async () => {
    mocks.loadReaderSettings
      .mockResolvedValueOnce({
        contentSources: [
          { source: 'nodeseek', enabled: true },
          { source: 'linuxdo', enabled: false }
        ]
      })
      .mockResolvedValueOnce({ contentSources: [{ source: 'nodeseek', enabled: false }] })
      .mockResolvedValueOnce({ contentSources: [{ source: 'linuxdo', enabled: true }] });

    mocks.runWorker.mockImplementationOnce(async (dependencies) => {
      expect(await dependencies.sourceAllowed('nodeseek')).toBe(false);
      return { status: 'success', delivered: 0, failedSources: 0, timedOut: false };
    });
    await expect(mocks.task?.()).resolves.toBe('success');
    const firstDependencies = mocks.runWorker.mock.calls[0]![0];
    expect(firstDependencies.sources).toEqual(['nodeseek', 'yaohuo']);
    await firstDependencies.system.dismissDigest('nodeseek', 'wz-message-nodeseek-nodeseek%3A7-a');
    expect(mocks.dismissExact).toHaveBeenCalledWith('wz-message-nodeseek-nodeseek%3A7-a');
    expect(mocks.dismissBroad).not.toHaveBeenCalled();
    await firstDependencies.system.reconcileDigests('nodeseek', 'nodeseek:7', 'wz-message-nodeseek-nodeseek%3A7-a');
    expect(mocks.reconcile).toHaveBeenCalledWith('nodeseek', 'nodeseek:7', 'wz-message-nodeseek-nodeseek%3A7-a');

    await expect(mocks.task?.()).resolves.toBe('success');
    expect(mocks.runWorker.mock.calls[1]![0].sources).toEqual(['linuxdo', 'nodeseek', 'yaohuo']);
    expect(mocks.loadReaderSettings).toHaveBeenCalledTimes(3);
    expect(withReaderSettings).toHaveBeenCalledTimes(2);
  });
});

async function prepareBackgroundDelivery(source: NotificationSource) {
  const worker = await vi.importActual<typeof import('@/platform/notifications/notificationWorker')>(
    '@/platform/notifications/notificationWorker'
  );
  mocks.runWorker.mockImplementation(worker.runNotificationBackgroundWorker);
  mocks.loadReaderSettings.mockResolvedValue({});
  const snapshot: AccountSessionSnapshot = {
    site: source,
    status: 'logged-in',
    cookieSummary: [],
    isVerifying: false,
    identityTrust: 'confirmed',
    currentUser: { source, id: '7', username: 'fixture-user', url: sourceCatalog[source].baseUrl }
  };
  await saveAccountSessionSnapshot(snapshot);
  const state = defaultNotificationState();
  state.globalEnabled = true;
  state.sources[source] = {
    intentEnabled: true,
    identityKey: `${source}:7`,
    baselineReady: true,
    deliveredIds: ['previous']
  };
  await saveNotificationState(state);
  mocks.probeAccess.mockResolvedValue({ identityKey: `${source}:7`, userId: '7' });
  mocks.listPage.mockResolvedValue({
    quality: 'complete',
    hasMore: false,
    cursor: null,
    items: [
      {
        source,
        id: 'new-reply',
        kind: 'reply',
        actor: { name: 'fixture-actor' },
        title: 'fixture-reply',
        createdAt: null,
        unread: true,
        target: { type: 'information' }
      }
    ]
  });
  return snapshot;
}

describe('notification background task account handoff', () => {
  it('fails closed with malformed notification storage even when the account is confirmed', async () => {
    await prepareBackgroundDelivery('nodeseek');
    const corrupted = '{"version":1,"globalEnabled":true,"sources":';
    mocks.storage.set(NOTIFICATION_STORAGE_KEY, corrupted);
    await expect(mocks.task?.()).rejects.toThrow('通知存储格式损坏');
    expect(mocks.storage.get(NOTIFICATION_STORAGE_KEY)).toBe(corrupted);
    expect(mocks.probeAccess).not.toHaveBeenCalled();
    expect(mocks.listPage).not.toHaveBeenCalled();
    expect(mocks.presentDigest).not.toHaveBeenCalled();
  });

  it.each(notificationSources)('delivers %s only after its durable account identity is confirmed', async (source) => {
    await prepareBackgroundDelivery(source);
    await expect(mocks.task?.()).resolves.toBe('success');
    expect(mocks.listPage).toHaveBeenCalledOnce();
    expect(mocks.presentDigest).toHaveBeenCalledOnce();
    expect((await loadNotificationState()).sources[source].deliveredIds).toEqual(['new-reply', 'previous']);
  });

  it.each(notificationSources)(
    'preserves %s delivery state when a handoff starts during the identity probe, then resumes',
    async (source) => {
      const snapshot = await prepareBackgroundDelivery(source);
      const previous = (await loadNotificationState()).sources[source];
      mocks.probeAccess.mockImplementationOnce(async () => {
        await markAccountSessionHandoffPending(source);
        return { identityKey: `${source}:7`, userId: '7' };
      });
      await expect(mocks.task?.()).resolves.toBe('success');
      expect(mocks.listPage).not.toHaveBeenCalled();
      expect(mocks.presentDigest).not.toHaveBeenCalled();
      expect((await loadNotificationState()).sources[source]).toEqual(previous);

      await saveAccountSessionSnapshot(snapshot, () => true);
      await expect(mocks.task?.()).resolves.toBe('success');
      expect(mocks.listPage).toHaveBeenCalledOnce();
      expect(mocks.presentDigest).toHaveBeenCalledOnce();
      expect((await loadNotificationState()).sources[source].deliveredIds).toEqual(['new-reply', 'previous']);
    }
  );

  it.each(['missing', 'anonymous', 'mismatched', 'pending', 'invalid', 'unreadable'] as const)(
    'blocks private work without changing notification data when the stored account is %s',
    async (state) => {
      const source = 'nodeseek';
      const snapshot = await prepareBackgroundDelivery(source);
      const previous = await loadNotificationState();
      const accountKey = `account-session.v1.${source}`;
      if (state === 'missing') mocks.storage.delete(accountKey);
      if (state === 'anonymous') {
        await saveAccountSessionSnapshot({
          site: source,
          status: 'anonymous',
          cookieSummary: [],
          isVerifying: false,
          identityTrust: 'none'
        });
      }
      if (state === 'mismatched') {
        await saveAccountSessionSnapshot({ ...snapshot, currentUser: { ...snapshot.currentUser!, id: '8' } });
      }
      if (state === 'pending') await markAccountSessionHandoffPending(source);
      if (state === 'invalid') mocks.storage.set(accountKey, '{');
      if (state === 'unreadable') {
        vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => {
          if (key === accountKey) throw new Error('storage unavailable');
          return mocks.storage.get(key) ?? null;
        });
      }

      await expect(mocks.task?.()).resolves.toBe('success');
      expect(mocks.probeAccess).not.toHaveBeenCalled();
      expect(mocks.listPage).not.toHaveBeenCalled();
      expect(mocks.presentDigest).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(await loadNotificationState()).toEqual(previous);
    }
  );
});
