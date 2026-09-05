import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  write: vi.fn(async (_key: string, _value: string) => undefined),
  channel: vi.fn(async () => undefined),
  present: vi.fn(async (identifier: string) => identifier),
  dismiss: vi.fn(async (_identifier: string) => undefined)
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => native.storage.get(key) ?? null,
    setItem: native.write
  }
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: { NotificationDigestModule: { present: native.present, dismiss: native.dismiss } }
}));
vi.mock('expo-background-task', () => ({}));
vi.mock('expo-task-manager', () => ({}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default' },
  AndroidNotificationVisibility: { PRIVATE: 'private' },
  getPermissionsAsync: async () => ({ granted: true }),
  setNotificationChannelAsync: native.channel
}));

import {
  clearNotificationSourceForContentDisable,
  defaultNotificationState,
  loadNotificationState,
  recordNotificationDelivery,
  saveNotificationState
} from '@/platform/notifications/notificationStore';
import {
  dismissSourceNotificationExact,
  notificationPermissionGranted,
  presentSourceNotification,
  reconcileSourceNotificationSlots
} from '@/platform/notifications/notificationSystem';
import {
  runNotificationBackgroundWorker,
  type NotificationWorkerDependencies
} from '@/platform/notifications/notificationWorker';

beforeEach(() => {
  vi.resetAllMocks();
  native.storage.clear();
  native.write.mockImplementation(async (key, value) => {
    native.storage.set(key, value);
  });
});

describe('notification delivery settlement', () => {
  it.each([
    'reconciliation',
    'failed reconciliation',
    'channel creation',
    'native presentation',
    'previous digest dismissal',
    'baseline write'
  ])('holds the identity lane through delayed %s after a bounded deadline', async (stage) => {
    vi.useFakeTimers();
    const identityKey = `nodeseek:${stage}`;
    const base = `wz-message-nodeseek-${encodeURIComponent(identityKey)}`;
    const staged = `${base}-a`;
    const previous = stage === 'baseline write' ? undefined : `${base}-b`;
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      intentEnabled: true,
      identityKey,
      baselineReady: stage !== 'baseline write',
      deliveredIds: ['old'],
      notificationIdentifier: previous
    };
    await saveNotificationState(state);
    const visible = new Set(previous ? [previous] : []);
    const events: string[] = [];
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const cleanupEntered = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    const latePresentation = stage === 'channel creation' || stage === 'native presentation';
    const block = async () => {
      entered.resolve();
      await release.promise;
    };
    native.channel.mockImplementation(async () => {
      if (stage === 'channel creation') await block();
    });
    native.present.mockImplementation(async (identifier) => {
      if (stage === 'native presentation') await block();
      visible.add(identifier);
      events.push(`present:${identifier}`);
      return identifier;
    });
    native.dismiss.mockImplementation(async (identifier) => {
      if (stage === 'failed reconciliation' && identifier === base) throw new Error('native cancel failed');
      if (
        (stage === 'reconciliation' && identifier === base) ||
        (stage === 'failed reconciliation' && identifier === staged) ||
        (stage === 'previous digest dismissal' && identifier === previous)
      ) {
        await block();
      }
      if (latePresentation && identifier === staged && visible.has(staged)) {
        cleanupEntered.resolve();
        await releaseCleanup.promise;
      }
      visible.delete(identifier);
      events.push(`dismiss:${identifier}`);
    });
    if (stage === 'baseline write') {
      native.write.mockImplementation(async (key, value) => {
        await block();
        native.storage.set(key, value);
      });
    }
    const settlements: Promise<void>[] = [];
    let drained = false;
    const dependencies: NotificationWorkerDependencies = {
      sources: ['nodeseek'],
      sourceAllowed: () => true,
      deadlineMs: 10,
      captureDeliverySettlement: (settlement) => {
        settlements.push(settlement);
      },
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey, userId: stage }),
        listPage: async () => ({
          items: [
            {
              source: 'nodeseek',
              id: 'new',
              kind: 'reply',
              actor: { name: '甲' },
              title: '新回复',
              createdAt: null,
              unread: true,
              target: { type: 'information' }
            }
          ],
          cursor: null,
          hasMore: false
        })
      },
      store: {
        load: loadNotificationState,
        record: recordNotificationDelivery,
        clearForContentDisable: clearNotificationSourceForContentDisable
      },
      system: {
        permissionGranted: notificationPermissionGranted,
        reconcileDigests: reconcileSourceNotificationSlots,
        presentDigest: presentSourceNotification,
        dismissDigest: (_source, identifier) => dismissSourceNotificationExact(identifier)
      }
    };
    const first = runNotificationBackgroundWorker(dependencies);
    let second: ReturnType<typeof runNotificationBackgroundWorker> | undefined;
    try {
      await entered.promise;
      const drain = settlements[0]!.then(() => {
        drained = true;
      });
      await vi.advanceTimersByTimeAsync(10);
      await expect(first).resolves.toMatchObject({ status: 'failed', reason: 'deadline' });
      expect(drained).toBe(false);
      const nativeCalls = native.dismiss.mock.calls.length;
      second = runNotificationBackgroundWorker(dependencies);
      await vi.advanceTimersByTimeAsync(10);
      await expect(second).resolves.toMatchObject({ status: 'failed', reason: 'deadline' });
      expect(native.dismiss).toHaveBeenCalledTimes(nativeCalls);

      release.resolve();
      if (latePresentation) {
        await cleanupEntered.promise;
        expect(drained).toBe(false);
        expect(visible.has(staged)).toBe(true);
        releaseCleanup.resolve();
      }
      await Promise.all([...settlements, drain]);
      const persisted = (await loadNotificationState()).sources.nodeseek;
      if (stage === 'previous digest dismissal') {
        expect(visible).toEqual(new Set([staged]));
        expect(persisted).toMatchObject({ notificationIdentifier: staged, deliveredIds: ['new', 'old'] });
      } else if (stage === 'baseline write') {
        expect(visible).toEqual(new Set());
        expect(persisted).toMatchObject({ baselineReady: true, deliveredIds: ['new'] });
      } else {
        expect(visible).toEqual(new Set([previous]));
        expect(persisted).toEqual(state.sources.nodeseek);
        if (latePresentation) expect(events.slice(-2)).toEqual([`present:${staged}`, `dismiss:${staged}`]);
      }
    } finally {
      release.resolve();
      releaseCleanup.resolve();
      await vi.runAllTimersAsync();
      await Promise.all([first, second, ...settlements]);
      vi.useRealTimers();
    }
  });
});
