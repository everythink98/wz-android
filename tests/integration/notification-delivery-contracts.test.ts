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
  recordNotificationSnapshot,
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
import type { ForumNotification, NotificationPage } from '@/domain/notifications/models';

beforeEach(() => {
  vi.resetAllMocks();
  native.storage.clear();
  native.write.mockImplementation(async (key, value) => {
    native.storage.set(key, value);
  });
});

describe('notification delivery settlement', () => {
  const item = (id: string): ForumNotification => ({
    source: 'nodeseek',
    id,
    kind: 'reply',
    actor: { name: '甲' },
    title: '回复',
    createdAt: null,
    unread: true,
    target: { type: 'information' }
  });
  async function delivery(pages: NotificationPage[], baselineReady = false) {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady
    };
    await saveNotificationState(state);
    const presentDigest = vi.fn(async (_source, _digest, identifier) => identifier);
    const listPage = vi.fn(async (_source, _access, _signal, cursor?: string | null) => pages[Number(cursor) || 0]);
    const run = () =>
      runNotificationBackgroundWorker({
        sources: ['nodeseek'],
        sourceAllowed: () => true,
        network: {
          restoreProxy: async () => undefined,
          probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
          listPage
        },
        store: {
          load: loadNotificationState,
          record: recordNotificationDelivery,
          clearForContentDisable: clearNotificationSourceForContentDisable
        },
        system: {
          permissionGranted: async () => true,
          reconcileDigests: async () => undefined,
          presentDigest,
          dismissDigest: async () => undefined
        }
      });
    return { run, presentDigest, listPage };
  }

  it.each(['invalid', 'partial'] as const)(
    'keeps the initial baseline untouched after a %s scan, then quietly accepts the first complete scan',
    async (quality) => {
      const pages: NotificationPage[] = [
        { items: quality === 'partial' ? [item('old')] : [], cursor: null, hasMore: false, quality }
      ];
      const worker = await delivery(pages);
      expect(await worker.run()).toMatchObject({ failedSources: 1, delivered: 0 });
      expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
        baselineReady: false,
        deliveredIds: []
      });
      expect((await loadNotificationState()).sources.nodeseek.lastSuccessAt).toBeUndefined();
      pages[0] = { items: [item('old')], cursor: null, hasMore: false, quality: 'complete' };
      await worker.run();
      expect(worker.presentDigest).not.toHaveBeenCalled();
      pages[0].items.push(item('new'));
      expect(await worker.run()).toMatchObject({ delivered: 1, failedSources: 0 });
      expect(worker.presentDigest).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects the entire source scan if a later page is partial', async () => {
    const worker = await delivery(
      [
        { items: [item('a')], cursor: '1', hasMore: true, quality: 'complete' },
        { items: [item('b')], cursor: null, hasMore: false, quality: 'partial' }
      ],
      true
    );
    expect(await worker.run()).toMatchObject({ failedSources: 1, delivered: 0 });
    expect((await loadNotificationState()).sources.nodeseek.deliveredIds).toEqual([]);
    expect(worker.presentDigest).not.toHaveBeenCalled();
  });

  it('keeps a legacy private-message baseline through a partial scan and silently replaces it only after a complete scan', async () => {
    const message = (id: string): ForumNotification => ({
      ...item(id),
      kind: 'private-message',
      target: { type: 'private-conversation', conversationId: '9' }
    });
    const pages: NotificationPage[] = [
      { items: [message('message:101'), item('reply-to-me:50')], cursor: null, hasMore: false, quality: 'partial' }
    ];
    const worker = await delivery(pages, true);
    const initial = await loadNotificationState();
    initial.hasOptedIn = true;
    initial.sources.nodeseek = {
      ...initial.sources.nodeseek,
      deliveredIds: ['message:fallback:legacy', 'reply-to-me:50'],
      unreadCount: 3,
      notificationIdentifier: 'previous-digest',
      lastSuccessAt: '2026-09-18T00:00:00.000Z'
    };
    initial.sources.linuxdo = {
      intentEnabled: true,
      identityKey: 'linuxdo:8',
      baselineReady: true,
      deliveredIds: ['202'],
      unreadCount: 1
    };
    const previous = await saveNotificationState(initial);
    native.write.mockClear();

    expect(await worker.run()).toMatchObject({ failedSources: 1, delivered: 0 });
    expect(await loadNotificationState()).toEqual(previous);
    expect(native.write).not.toHaveBeenCalled();
    expect(worker.presentDigest).not.toHaveBeenCalled();

    pages[0].quality = 'complete';
    expect(await worker.run()).toMatchObject({ failedSources: 0, delivered: 0 });
    expect(worker.presentDigest).not.toHaveBeenCalled();
    const rebuilt = await loadNotificationState();
    expect(rebuilt).toMatchObject({ globalEnabled: true, hasOptedIn: true });
    expect(rebuilt.sources.nodeseek).toMatchObject({
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['message:101', 'reply-to-me:50'],
      unreadCount: 3,
      notificationIdentifier: 'previous-digest'
    });
    expect(rebuilt.sources.linuxdo).toEqual(previous.sources.linuxdo);
    expect(rebuilt.sources.yaohuo).toEqual(previous.sources.yaohuo);

    pages[0].items[0] = message('message:102');
    expect(await worker.run()).toMatchObject({ failedSources: 0, delivered: 1 });
    expect(await worker.run()).toMatchObject({ failedSources: 0, delivered: 0 });
    expect(worker.presentDigest).toHaveBeenCalledTimes(1);
    expect((await loadNotificationState()).sources.nodeseek.deliveredIds).toEqual([
      'message:102',
      'reply-to-me:50',
      'message:101'
    ]);
  });

  it('deduplicates overlapping pages before computing the digest and delivered count', async () => {
    const worker = await delivery(
      [
        { items: [item('a')], cursor: '1', hasMore: true, quality: 'complete' },
        { items: [item('a'), item('b')], cursor: null, hasMore: false, quality: 'complete' }
      ],
      true
    );
    expect(await worker.run()).toMatchObject({ delivered: 2 });
    expect(worker.presentDigest.mock.calls[0][1].body).toContain('另有 1 条');
    expect((await loadNotificationState()).sources.nodeseek.deliveredIds.sort()).toEqual(['a', 'b']);
  });

  it('keeps the raw scan budget when every row repeats an earlier identity', async () => {
    const worker = await delivery(
      [
        { items: Array.from({ length: 30 }, () => item('a')), cursor: '1', hasMore: true, quality: 'complete' },
        { items: Array.from({ length: 30 }, () => item('a')), cursor: '2', hasMore: true, quality: 'complete' }
      ],
      true
    );
    expect(await worker.run()).toMatchObject({ delivered: 1 });
    expect(worker.listPage).toHaveBeenCalledTimes(2);
  });

  it('accepts a legitimate empty page as a complete initial baseline', async () => {
    const worker = await delivery([{ items: [], cursor: null, hasMore: false, quality: 'complete' }]);
    expect(await worker.run()).toMatchObject({ failedSources: 0 });
    expect((await loadNotificationState()).sources.nodeseek.baselineReady).toBe(true);
  });

  it.each([
    { total: 80, scanned: 60, unread: true },
    { total: 1, scanned: 20, unread: false }
  ])(
    'preserves authoritative unread total $total after scanning $scanned items',
    async ({ total, scanned, unread }) => {
      const identityKey = 'nodeseek:7';
      const state = defaultNotificationState();
      state.globalEnabled = true;
      state.sources.nodeseek = { ...state.sources.nodeseek, intentEnabled: true, identityKey };
      await saveNotificationState(state);
      await recordNotificationSnapshot('nodeseek', identityKey, total, '2026-09-16T00:00:00.000Z');
      const result = await runNotificationBackgroundWorker({
        sources: ['nodeseek'],
        sourceAllowed: () => true,
        network: {
          restoreProxy: async () => undefined,
          probeAccess: async () => ({ identityKey, userId: '7' }),
          listPage: async () => ({
            quality: 'complete' as const,
            items: Array.from({ length: scanned }, (_, index) => ({
              source: 'nodeseek' as const,
              id: String(index),
              kind: 'reply' as const,
              actor: { name: '甲' },
              title: '回复',
              createdAt: null,
              unread,
              target: { type: 'information' as const }
            })),
            cursor: scanned === 60 ? 'next' : null,
            hasMore: scanned === 60
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
      });
      expect(result.status).toBe('success');
      expect((await loadNotificationState()).sources.nodeseek.unreadCount).toBe(total);
    }
  );

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
          quality: 'complete' as const,
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
