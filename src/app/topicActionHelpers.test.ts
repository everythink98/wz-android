import { describe, expect, it, vi } from 'vitest';

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  parseLinuxDoDocumentCookie: vi.fn(() => ({})),
  summarizeLinuxDoCookies: vi.fn(() => ({ names: [] }))
}));

import { runOptimisticActionQueue, runSingleTopicAction } from './topicActionHelpers';
import type { OptimisticActionState } from '../topicActionState';

describe('topic action helpers', () => {
  it('skips duplicate non-idempotent topic actions while one is pending', async () => {
    const pendingActions = { current: {} as Record<string, true> };
    let resolveFirst: (value: string) => void = () => undefined;
    const first = runSingleTopicAction({
      key: 'reply:nodeseek:1',
      pendingActions,
      task: () => new Promise<string>((resolve) => {
        resolveFirst = resolve;
      })
    });
    const duplicateTask = vi.fn(async () => 'duplicate');
    const notifyDuplicate = vi.fn();

    const duplicate = await runSingleTopicAction({
      key: 'reply:nodeseek:1',
      notifyDuplicate,
      pendingActions,
      task: duplicateTask
    });
    resolveFirst('saved');

    await expect(first).resolves.toBe('saved');
    expect(duplicate).toBeUndefined();
    expect(duplicateTask).not.toHaveBeenCalled();
    expect(notifyDuplicate).toHaveBeenCalledTimes(1);
    await expect(runSingleTopicAction({
      key: 'reply:nodeseek:1',
      pendingActions,
      task: async () => 'next'
    })).resolves.toBe('next');
  });

  it('clears pending non-idempotent actions after failure', async () => {
    const pendingActions = { current: {} as Record<string, true> };

    await expect(runSingleTopicAction({
      key: 'vote:linuxdo:1',
      pendingActions,
      task: async () => {
        throw new Error('failed');
      }
    })).rejects.toThrow('failed');

    await expect(runSingleTopicAction({
      key: 'vote:linuxdo:1',
      pendingActions,
      task: async () => 'retry'
    })).resolves.toBe('retry');
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
