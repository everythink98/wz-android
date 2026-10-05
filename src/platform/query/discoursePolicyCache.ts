import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { isRecord } from '@/domain/forum/html';
import type { RepliesResponse, Reply, TopicDetail } from '@/domain/forum/models';

/** Project an authoritative private read into existing caches for the same account and policy version. */
export function syncDiscoursePolicyCaches(
  queryClient: QueryClient,
  { topicId, sessionEpoch, policy }: { topicId: string; sessionEpoch: number; policy: DiscoursePostPolicy }
) {
  const readPlanScope = `authenticated:${sessionEpoch}`;
  const matchesScope = (key: QueryKey) =>
    key[0] === 'forum' &&
    key[1] === 'linuxdo' &&
    isRecord(key[3]) &&
    key[3].topicId === topicId &&
    key[3].sessionEpoch === sessionEpoch &&
    key[3].readPlanScope === readPlanScope;
  const updatePolicy = <T extends { policy?: DiscoursePostPolicy }>(item: T): T =>
    item.policy?.postId === policy.postId && item.policy.version === policy.version ? { ...item, policy } : item;
  queryClient.setQueriesData<TopicDetail>(
    { predicate: ({ queryKey }) => queryKey.length === 4 && queryKey[2] === 'topic' && matchesScope(queryKey) },
    (detail) => detail && { ...updatePolicy(detail), replies: detail.replies.map(updatePolicy) }
  );
  queryClient.setQueriesData<Reply>(
    { predicate: ({ queryKey }) => queryKey.length === 4 && queryKey[2] === 'topic-reply' && matchesScope(queryKey) },
    (reply) => reply && updatePolicy(reply)
  );
  queryClient.setQueriesData<InfiniteData<RepliesResponse>>(
    {
      predicate: ({ queryKey }) =>
        queryKey.length === 6 &&
        queryKey[2] === 'topic' &&
        queryKey[4] === 'replies' &&
        matchesScope(queryKey) &&
        isRecord(queryKey[5]) &&
        queryKey[5].readPlanScope === readPlanScope
    },
    (data) => data && { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(updatePolicy) })) }
  );
}
