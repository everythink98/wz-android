import { describe, expect, it, vi } from 'vitest';

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  parseLinuxDoDocumentCookie: vi.fn(() => ({})),
  summarizeLinuxDoCookies: vi.fn(() => ({ names: [] }))
}));

import { runOptimisticActionQueue, shareTopicWithClipboardFallback } from './topicActionHelpers';
import type { OptimisticActionState } from '../topicActionState';

describe('topic action helpers', () => {
  it('REG-TOPIC-017 consumes a clipboard fallback failure and tells the user', async () => {
    const notify = vi.fn();

    await expect(shareTopicWithClipboardFallback({
      copy: async () => { throw new Error('clipboard unavailable'); },
      notify,
      share: async () => { throw new Error('share unavailable'); }
    })).resolves.toBe(false);

    expect(notify).toHaveBeenCalledWith('分享失败，且无法复制链接，请重试。');
  });

  it('does not let an expired optimistic queue clear a newer owner state', async () => {
    const key = 'nodeseek:1:100:like';
    const optimisticActions = {
      current: {
        [key]: {
          confirmed: false,
          displayed: true,
          desired: true,
          inFlight: true,
          inFlightTarget: true,
          ownerKey: 'old'
        }
      } as Record<string, OptimisticActionState>
    };
    const setOptimisticActionState = vi.fn((stateKey: string, state?: OptimisticActionState) => {
      const next = { ...optimisticActions.current };
      if (state) {
        next[stateKey] = state;
      } else {
        delete next[stateKey];
      }
      optimisticActions.current = next;
    });
    let resolveSend: (value: boolean) => void = () => undefined;

    const queue = runOptimisticActionQueue({
      key,
      requestOwner: 'old',
      ownerKey: 'old',
      applyDisplayed: vi.fn(),
      isCurrentRequest: () => false,
      notify: vi.fn(),
      optimisticActions,
      sendDesired: () => new Promise<boolean>((resolve) => {
        resolveSend = resolve;
      }),
      setOptimisticActionState,
      successMessage: () => '已提交'
    });

    optimisticActions.current = {
      [key]: {
        confirmed: false,
        displayed: false,
        desired: false,
        inFlight: true,
        inFlightTarget: false,
        ownerKey: 'new'
      }
    };
    resolveSend(true);
    await queue;

    expect(optimisticActions.current[key]?.ownerKey).toBe('new');
  });
});
