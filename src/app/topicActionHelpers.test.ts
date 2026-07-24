import { describe, expect, it, vi } from 'vitest';

import { shareTopicWithClipboardFallback } from './topicActionHelpers';

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
});
