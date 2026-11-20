import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) || null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    })
  }
}));

import {
  advanceNotificationDelivery,
  clearNotificationSourceForContentDisable,
  confirmDisabledNotificationDismissal,
  defaultNotificationState,
  loadNotificationState,
  normalizeNotificationState,
  recordNotificationDelivery,
  recordNotificationSnapshot,
  saveNotificationState,
  setGlobalNotificationIntent,
  setSourceNotificationIntent
} from './notificationStore';
import { notificationSources } from '@/domain/forum/sourceCatalog';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';

beforeEach(() => storage.clear());

describe('notification delivery state', () => {
  it('rejects invalid stored JSON and blocks writes without exposing the saved value', async () => {
    storage.set('wz.notifications.v1', 'PRIVATE_CORRUPT_JSON');
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    try {
      await expect(loadNotificationState()).rejects.toThrow('通知存储格式损坏');
      await expect(setGlobalNotificationIntent(true)).rejects.toThrow('通知存储格式损坏');
    } finally {
      setDiagnosticWriter(null);
    }
    expect(storage.get('wz.notifications.v1')).toBe('PRIVATE_CORRUPT_JSON');
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ operation: 'notification-state-load', outcome: 'failure', reason: 'invalid_response' })
    );
    expect(lines.join('')).not.toContain('PRIVATE_CORRUPT_JSON');
  });
  it('enables every notification-capable source on first opt-in', async () => {
    const state = await setGlobalNotificationIntent(true);

    expect(notificationSources.map((source) => state.sources[source].intentEnabled)).toEqual(
      notificationSources.map(() => true)
    );
  });

  it('leaves the saved unread state intact if authority changes during the queued read', async () => {
    await recordNotificationSnapshot('nodeseek', 'nodeseek:7', 2, '2026-08-03');
    const reading = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(async (key) => {
      reading.resolve();
      await release.promise;
      return storage.get(key) || null;
    });
    const writes = vi.mocked(AsyncStorage.setItem).mock.calls.length;
    let canCommit = true;
    const old = recordNotificationSnapshot('nodeseek', 'nodeseek:7', 97, '2026-08-04', () => canCommit);
    try {
      await reading.promise;
      canCommit = false;
      release.resolve();
      expect((await old).sources.nodeseek.unreadCount).toBe(2);
      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
    } finally {
      release.resolve();
      await old;
    }
  });

  it('builds a silent baseline, delivers only new ids, and caps retained ids at 200', () => {
    const baseline = advanceNotificationDelivery(undefined, 'nodeseek:7', ['a', 'b']);
    expect(baseline.newIds).toEqual([]);
    expect(baseline.state).toMatchObject({ identityKey: 'nodeseek:7', baselineReady: true, deliveredIds: ['a', 'b'] });

    const next = advanceNotificationDelivery(baseline.state, 'nodeseek:7', [
      'c',
      'a',
      ...Array.from({ length: 205 }, (_, index) => `old-${index}`)
    ]);
    expect(next.newIds[0]).toBe('c');
    expect(next.state.deliveredIds).toHaveLength(200);
    expect(advanceNotificationDelivery(next.state, 'nodeseek:7', ['c', 'a']).newIds).toEqual([]);
  });

  it('silently resets the baseline when the account identity changes', () => {
    const previous = advanceNotificationDelivery(undefined, 'nodeseek:7', ['a']).state;
    const changed = advanceNotificationDelivery(previous, 'nodeseek:8', ['fresh-for-account-8']);

    expect(changed.newIds).toEqual([]);
    expect(changed.state).toMatchObject({
      identityKey: 'nodeseek:8',
      deliveredIds: ['fresh-for-account-8'],
      baselineReady: true
    });
  });

  it.each([
    { identityKey: 'nodeseek:7', retainedId: 'message:101' },
    { identityKey: 'nodeseek:7', retainedId: 'reply-to-me:fallback:legacy' },
    { identityKey: 'linuxdo:7', retainedId: 'message:fallback:legacy' }
  ])('keeps the existing delivery baseline for $identityKey and $retainedId', ({ identityKey, retainedId }) => {
    const previous = advanceNotificationDelivery(undefined, identityKey, [retainedId]).state;
    const advanced = advanceNotificationDelivery(previous, identityKey, [retainedId, 'new']);
    expect(advanced.newIds).toEqual(['new']);
    expect(advanced.state.deliveredIds).toEqual([retainedId, 'new']);
  });

  it('drops message content and credentials from persisted state', () => {
    const normalized = normalizeNotificationState({
      globalEnabled: true,
      sources: {
        nodeseek: {
          intentEnabled: true,
          identityKey: 'nodeseek:7',
          deliveredIds: ['public-id'],
          preview: 'private body',
          cookie: 'secret',
          token: 'secret'
        }
      }
    });

    expect(JSON.stringify(normalized)).toContain('public-id');
    expect(JSON.stringify(normalized)).not.toMatch(/private body|cookie|token|secret/);
  });

  it('rebuilds a silent baseline after global notifications are re-enabled', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.hasOptedIn = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    await saveNotificationState(state);

    const disabled = await setGlobalNotificationIntent(false);
    const reenabled = await setGlobalNotificationIntent(true);

    expect(disabled.sources.nodeseek).toMatchObject({ baselineReady: false, deliveredIds: [] });
    expect(reenabled.sources.nodeseek.intentEnabled).toBe(true);
    expect(advanceNotificationDelivery(reenabled.sources.nodeseek, 'nodeseek:7', ['while-disabled']).newIds).toEqual(
      []
    );
  });

  it('clears delivery state for a disabled content source without changing its notification intent or identity', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      lastSuccessAt: '2026-08-03T00:00:00Z',
      unreadCount: 3,
      notificationIdentifier: 'android-id'
    };
    await saveNotificationState(state);

    const disabled = await clearNotificationSourceForContentDisable('nodeseek');

    expect(disabled.sources.nodeseek).toEqual({
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: false,
      deliveredIds: []
    });
    expect(advanceNotificationDelivery(disabled.sources.nodeseek, 'nodeseek:7', ['while-disabled']).newIds).toEqual([]);
  });

  it.each(['global', 'source'] as const)(
    'keeps the disabled %s baseline clear when an old delivery rolls back',
    async (scope) => {
      const state = defaultNotificationState();
      state.globalEnabled = true;
      state.hasOptedIn = true;
      state.sources.nodeseek = {
        intentEnabled: true,
        identityKey: 'nodeseek:7',
        baselineReady: true,
        deliveredIds: ['old'],
        notificationIdentifier: 'old-id'
      };
      await saveNotificationState(state);
      const delivered = await recordNotificationDelivery(
        'nodeseek',
        'nodeseek:7',
        ['new'],
        { lastSuccessAt: '2026-11-20T00:00:00Z' },
        { expectedNewIds: ['new'], previousIdentifier: 'old-id', notificationIdentifier: 'staged-id' }
      );
      expect(delivered.committed).toBe(true);
      const setEnabled =
        scope === 'global'
          ? setGlobalNotificationIntent
          : (enabled: boolean) => setSourceNotificationIntent('nodeseek', enabled);
      await setEnabled(false);
      await delivered.rollback();
      expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
        baselineReady: false,
        deliveredIds: [],
        notificationIdentifier: 'staged-id'
      });
      await setEnabled(true);
      await delivered.rollback();
      expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
        baselineReady: false,
        deliveredIds: []
      });
    }
  );

  it.each(['current', 'identity changed', 'slot changed'] as const)(
    'clears a disabled digest only for the matching persisted owner: %s',
    async (owner) => {
      const state = defaultNotificationState();
      state.hasOptedIn = true;
      state.sources.nodeseek = {
        intentEnabled: true,
        identityKey: owner === 'identity changed' ? 'nodeseek:8' : 'nodeseek:7',
        baselineReady: false,
        deliveredIds: [],
        notificationIdentifier: owner === 'slot changed' ? 'new-id' : 'old-id'
      };
      await saveNotificationState(state);
      await confirmDisabledNotificationDismissal('nodeseek', 'nodeseek:7', 'old-id');
      expect((await loadNotificationState()).sources.nodeseek.notificationIdentifier).toBe(
        owner === 'current' ? undefined : state.sources.nodeseek.notificationIdentifier
      );
    }
  );

  it('does not record or deliver after the user disables the source during a background run', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = false;
    state.sources.nodeseek = {
      intentEnabled: false,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    await saveNotificationState(state);

    const result = await recordNotificationDelivery('nodeseek', 'nodeseek:7', ['new'], {
      lastSuccessAt: '2026-08-03T00:00:00Z'
    });

    expect(result.newIds).toEqual([]);
    expect(result.state.sources.nodeseek.deliveredIds).toEqual(['old']);
  });

  it('releases a failed delivery so the same remote id remains retryable', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    await saveNotificationState(state);

    const first = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['new'],
      { lastSuccessAt: '2026-08-03T00:00:00Z' },
      { expectedNewIds: ['new'], previousIdentifier: undefined, notificationIdentifier: 'staged-id' }
    );
    await first.rollback();
    const retried = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['new'],
      { lastSuccessAt: '2026-08-03T00:01:00Z' },
      { expectedNewIds: ['new'], previousIdentifier: undefined, notificationIdentifier: 'staged-id' }
    );

    expect(first.committed).toBe(true);
    expect(first.newIds).toEqual(['new']);
    expect(retried.committed).toBe(true);
    expect(retried.newIds).toEqual(['new']);
  });

  it('atomically commits delivered ids with the native-acked identifier', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'old-id'
    };
    await saveNotificationState(state);

    const committed = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['new'],
      { lastSuccessAt: '2026-08-03T00:01:00Z' },
      {
        expectedNewIds: ['new'],
        previousIdentifier: 'old-id',
        notificationIdentifier: 'staged-id'
      }
    );

    expect(committed.committed).toBe(true);
    expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
      deliveredIds: ['new', 'old'],
      notificationIdentifier: 'staged-id'
    });

    await committed.rollback();
    expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
      deliveredIds: ['old'],
      notificationIdentifier: 'old-id'
    });
  });

  it.each([
    ['全局已关闭', false, true, 'nodeseek:7'],
    ['来源已关闭', true, false, 'nodeseek:7'],
    ['账号已变化', true, true, 'nodeseek:8']
  ])(
    'keeps the notification identifier cleared when %s',
    async (_scenario, globalEnabled, intentEnabled, identityKey) => {
      const state = defaultNotificationState();
      state.globalEnabled = globalEnabled;
      state.sources.nodeseek = {
        ...state.sources.nodeseek,
        intentEnabled,
        identityKey,
        baselineReady: true,
        deliveredIds: ['old']
      };
      await saveNotificationState(state);

      const committed = await recordNotificationDelivery(
        'nodeseek',
        'nodeseek:7',
        ['new'],
        { lastSuccessAt: '2026-08-03T00:00:00Z' },
        { expectedNewIds: ['new'], previousIdentifier: undefined, notificationIdentifier: 'stale-id' }
      );
      const updated = await loadNotificationState();

      expect(committed.committed).toBe(false);
      expect(updated.sources.nodeseek.notificationIdentifier).toBeUndefined();
    }
  );

  it('does not let a stale compound rollback overwrite a newer delivery', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'old-id'
    };
    await saveNotificationState(state);

    const first = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['one'],
      { lastSuccessAt: '2026-08-03T00:00:00Z' },
      { expectedNewIds: ['one'], previousIdentifier: 'old-id', notificationIdentifier: 'staged-a' }
    );
    const second = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['two', 'one'],
      { lastSuccessAt: '2026-08-03T00:01:00Z' },
      { expectedNewIds: ['two'], previousIdentifier: 'staged-a', notificationIdentifier: 'staged-b' }
    );

    await first.rollback();
    expect(first.committed).toBe(true);
    expect(second.committed).toBe(true);
    expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
      deliveredIds: ['two', 'one', 'old'],
      notificationIdentifier: 'staged-b'
    });
  });

  it.each(['expected ids', 'previous identifier'] as const)(
    'returns computed ids without compensation when the %s do not match',
    async (mismatch) => {
      const state = defaultNotificationState();
      state.globalEnabled = true;
      state.sources.nodeseek = {
        ...state.sources.nodeseek,
        intentEnabled: true,
        identityKey: 'nodeseek:7',
        baselineReady: true,
        deliveredIds: ['old'],
        notificationIdentifier: 'old-id'
      };
      await saveNotificationState(state);

      const declined = await recordNotificationDelivery(
        'nodeseek',
        'nodeseek:7',
        ['new', 'old'],
        { lastSuccessAt: '2026-08-03T00:01:00Z' },
        {
          expectedNewIds: mismatch === 'expected ids' ? ['other'] : ['new'],
          previousIdentifier: mismatch === 'previous identifier' ? 'other-id' : 'old-id',
          notificationIdentifier: 'staged-id'
        }
      );
      const reads = vi.mocked(AsyncStorage.getItem).mock.calls.length;
      const writes = vi.mocked(AsyncStorage.setItem).mock.calls.length;

      expect(declined.newIds).toEqual(['new']);
      expect(declined.committed).toBe(false);
      expect(declined.state).toEqual(state);
      expect(await declined.rollback()).toBe(declined.state);
      expect(AsyncStorage.getItem).toHaveBeenCalledTimes(reads);
      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
      expect(await loadNotificationState()).toEqual(state);
    }
  );

  it('allows repeated compensation while the same notification identifier remains current', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'same-id'
    };
    await saveNotificationState(state);
    const first = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['one'],
      { lastSuccessAt: '2026-08-03T00:00:00Z' },
      { expectedNewIds: ['one'], previousIdentifier: 'same-id', notificationIdentifier: 'same-id' }
    );
    await first.rollback();
    const second = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['two'],
      { lastSuccessAt: '2026-08-03T00:01:00Z' },
      { expectedNewIds: ['two'], previousIdentifier: 'same-id', notificationIdentifier: 'same-id' }
    );
    expect((await loadNotificationState()).sources.nodeseek.deliveredIds).toEqual(['two', 'old']);

    await first.rollback();

    expect(first.committed).toBe(true);
    expect(second.committed).toBe(true);
    expect((await loadNotificationState()).sources.nodeseek).toMatchObject({
      deliveredIds: ['old'],
      notificationIdentifier: 'same-id'
    });
  });

  it('commits a silent baseline without creating a compensation operation', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = { ...state.sources.nodeseek, intentEnabled: true, identityKey: 'nodeseek:7' };
    await saveNotificationState(state);

    const recorded = await recordNotificationDelivery('nodeseek', 'nodeseek:7', ['baseline'], {
      lastSuccessAt: '2026-08-03T00:00:00Z'
    });
    const writes = vi.mocked(AsyncStorage.setItem).mock.calls.length;

    expect(recorded.committed).toBe(true);
    expect(recorded.newIds).toEqual([]);
    expect(recorded.state.sources.nodeseek).toMatchObject({ baselineReady: true, deliveredIds: ['baseline'] });
    expect(await recorded.rollback()).toBe(recorded.state);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
  });

  it('rejects a failed durable commit and leaves the same delivery retryable', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    await saveNotificationState(state);
    const failure = new Error('storage unavailable');
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(failure);
    const record = () =>
      recordNotificationDelivery(
        'nodeseek',
        'nodeseek:7',
        ['new'],
        { lastSuccessAt: '2026-08-03T00:00:00Z' },
        { expectedNewIds: ['new'], previousIdentifier: undefined, notificationIdentifier: 'staged-id' }
      );

    await expect(record()).rejects.toBe(failure);
    expect(await loadNotificationState()).toEqual(state);
    expect(await record()).toMatchObject({ committed: true, newIds: ['new'] });
    expect((await loadNotificationState()).sources.nodeseek.notificationIdentifier).toBe('staged-id');
  });

  it('restores the exact pre-commit watermark when rollback follows 200-id truncation', async () => {
    const state = defaultNotificationState();
    const previousIds = Array.from({ length: 200 }, (_, index) => `old-${index}`);
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: previousIds,
      notificationIdentifier: 'old-id'
    };
    await saveNotificationState(state);

    const committed = await recordNotificationDelivery(
      'nodeseek',
      'nodeseek:7',
      ['new', ...previousIds],
      { lastSuccessAt: '2026-08-03T00:01:00Z' },
      { expectedNewIds: ['new'], previousIdentifier: 'old-id', notificationIdentifier: 'staged-id' }
    );
    await committed.rollback();

    expect((await loadNotificationState()).sources.nodeseek.deliveredIds).toEqual(previousIds);
  });
});
