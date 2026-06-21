import { describe, expect, it, vi } from 'vitest';

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  parseLinuxDoDocumentCookie: vi.fn(() => ({})),
  summarizeLinuxDoCookies: vi.fn(() => ({ names: [] }))
}));

import { runSingleTopicAction } from './topicActionHelpers';

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
});
