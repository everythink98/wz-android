import { describe, expect, it, vi } from 'vitest';
import type { Topic } from '@/domain/forum/models';
import { verifyLinuxDoTopic } from './topicVerification';

const topic: Topic = {
  source: 'linuxdo',
  id: '42',
  title: 'Topic',
  author: 'alice',
  url: 'https://linux.do/t/42',
  createdAt: '2026-07-29T00:00:00.000Z',
  replyCount: 0
};

describe('Topic verification policy', () => {
  it('[REG-LINUXDO-007] opens identity verification instead of retrying a query that has not started', async () => {
    const refreshTopic = vi.fn(async () => undefined);
    const showVerification = vi.fn(async () => true);

    await expect(
      verifyLinuxDoTopic({
        identityPending: true,
        refreshTopic,
        selectedTopic: topic,
        showVerification,
        topicDetail: null
      })
    ).resolves.toBe('verification');

    expect(refreshTopic).not.toHaveBeenCalled();
    expect(showVerification).toHaveBeenCalledTimes(1);
  });
});
