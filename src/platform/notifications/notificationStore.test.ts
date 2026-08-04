import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  defaultNotificationState,
  initialNotificationOptInSources,
  normalizeNotificationState,
  recordNotificationDelivery,
  saveNotificationState,
  setGlobalNotificationIntent,
  setNotificationIdentifier
} from './notificationStore';

beforeEach(() => storage.clear());

describe('notification delivery state', () => {
  it('keeps first opt-in limited to the four launch notification sources', () => {
    expect(initialNotificationOptInSources).toEqual(['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi']);
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
      lastSuccessAt: '2026-08-03T00:00:00Z',
      unreadCount: 1
    });

    expect(result.newIds).toEqual([]);
    expect(result.state.sources.nodeseek.deliveredIds).toEqual(['old']);
  });

  it('[REG-NOTIFY-008] releases a failed delivery so the same remote id remains retryable', async () => {
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

    const first = await recordNotificationDelivery('nodeseek', 'nodeseek:7', ['new'], {
      lastSuccessAt: '2026-08-03T00:00:00Z',
      unreadCount: 1
    });
    await first.rollback();
    const retried = await recordNotificationDelivery('nodeseek', 'nodeseek:7', ['new'], {
      lastSuccessAt: '2026-08-03T00:01:00Z',
      unreadCount: 1
    });

    expect(first.newIds).toEqual(['new']);
    expect(retried.newIds).toEqual(['new']);
  });

  it.each([
    ['全局已关闭', false, true, 'nodeseek:7'],
    ['来源已关闭', true, false, 'nodeseek:7'],
    ['账号已变化', true, true, 'nodeseek:8']
  ])(
    '[REG-NOTIFY-009] keeps the notification identifier cleared when %s',
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

      const updated = await setNotificationIdentifier('nodeseek', 'nodeseek:7', 'stale-id');

      expect(updated.sources.nodeseek.notificationIdentifier).toBeUndefined();
    }
  );
});
