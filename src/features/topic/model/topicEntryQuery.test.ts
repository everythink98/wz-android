import { hashKey, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ForumReadPlan } from '@/domain/forum/readPlan';
import type { Topic } from '@/domain/forum/models';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { createAppQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { createTopicEntryPrefetch } from './topicEntryQuery';

const topic: Topic = {
  source: 'linuxdo',
  id: '123',
  title: 'Fixture',
  author: 'fixture',
  createdAt: '2026-01-01T00:00:00Z',
  url: 'https://linux.do/t/topic/123'
};
const plan: ForumReadPlan = {
  source: 'linuxdo',
  operation: 'topic',
  state: 'ready',
  lane: 'authenticated',
  transport: 'managed-session',
  cacheScope: 'authenticated:0'
};
const sessionEpochs = initialForumSessionEpochs;
const queryKey = forumQueryKeys.topic({
  source: topic.source,
  topicId: topic.id,
  scope: sessionEpochs,
  readPlanScope: plan.cacheScope
});

describe('topic entry prefetch', () => {
  it('records one visit and leaves a fast failure for the admitted observer to display', async () => {
    const client = createAppQueryClient();
    const prefetch = createTopicEntryPrefetch(client);
    const readGateway = {
      getReadPlan: () => plan,
      getTopic: vi.fn(async () => {
        throw new Error('Fixture failed');
      })
    };
    try {
      prefetch.start({ routeKey: 'topic-entry', topic, sessionEpochs, readGateway });
      await vi.waitFor(() => expect(client.getQueryState(queryKey)?.status).toBe('error'));
      expect(readGateway.getTopic).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: topic.id, trackVisit: true }),
        expect.objectContaining({ plan })
      );
      const visit = prefetch.getVisit('topic-entry', hashKey(queryKey));
      expect(visit?.settled).toBe(true);
      expect(prefetch.getVisit('topic-entry', 'different-permission')).toBeUndefined();
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn: readGateway.getTopic,
        retryOnMount: visit ? false : undefined
      });
      const unsubscribe = observer.subscribe(() => undefined);
      expect(observer.getCurrentResult().status).toBe('error');
      expect(readGateway.getTopic).toHaveBeenCalledTimes(1);
      unsubscribe();
    } finally {
      client.clear();
    }
  });

  it('aborts its transport only after the last staged entry for the same query leaves', async () => {
    const client = createAppQueryClient();
    const prefetch = createTopicEntryPrefetch(client);
    let transportSignal: AbortSignal | undefined;
    const readGateway = {
      getReadPlan: () => plan,
      getTopic: vi.fn(({ signal }: { signal?: AbortSignal }) => {
        transportSignal = signal;
        return new Promise<never>((_, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        );
      })
    };
    try {
      prefetch.start({ routeKey: 'first', topic, sessionEpochs, readGateway });
      prefetch.start({ routeKey: 'second', topic, sessionEpochs, readGateway });
      expect(readGateway.getTopic).toHaveBeenCalledTimes(1);
      prefetch.discardRemoved((key) => key === 'second');
      expect(transportSignal?.aborted).toBe(false);
      prefetch.discardRemoved(() => false);
      await vi.waitFor(() => expect(transportSignal?.aborted).toBe(true));
    } finally {
      client.clear();
    }
  });
});
