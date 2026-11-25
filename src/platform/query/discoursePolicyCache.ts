import { skipToken, useQuery, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { isRecord } from '@/domain/forum/html';
import type { RepliesResponse, Reply, TopicDetail } from '@/domain/forum/models';
import type { NotificationDetail } from '@/domain/notifications/models';
import { forumWriteReceiptKeys } from './serverState';

type PolicyAccount = { identityKey: string; sessionEpoch: number };
type PolicyReceipt = Pick<DiscoursePostPolicy, 'postId' | 'version' | 'accepted'>;
type PolicyRecord =
  { phase: 'awaiting-readback'; receipt: PolicyReceipt } | { phase: 'observed'; policy: DiscoursePostPolicy };
type PolicyState = Readonly<Record<string, PolicyRecord>>;
const emptyPolicyState: PolicyState = {};

export function useDiscoursePolicyState(account?: PolicyAccount) {
  return (
    useQuery<PolicyState>({
      queryKey: forumWriteReceiptKeys.discoursePolicy(account),
      queryFn: skipToken,
      subscribed: Boolean(account)
    }).data ?? emptyPolicyState
  );
}

export function selectDiscoursePolicyWriteBlock(state: PolicyState | undefined, policy: DiscoursePostPolicy) {
  const current = state?.[policy.postId];
  if (!current) return undefined;
  if (current.phase === 'awaiting-readback') return current.receipt;
  const observed = current.policy;
  return observed.version !== policy.version ||
    observed.accepted !== policy.accepted ||
    observed.canAccept !== policy.canAccept ||
    observed.canRevoke !== policy.canRevoke
    ? observed
    : undefined;
}

export function readDiscoursePolicyWriteBlock(
  client: QueryClient,
  account: PolicyAccount,
  policy: DiscoursePostPolicy
) {
  return selectDiscoursePolicyWriteBlock(
    client.getQueryData<PolicyState>(forumWriteReceiptKeys.discoursePolicy(account)),
    policy
  );
}

export function recordDiscoursePolicyReceipt(client: QueryClient, account: PolicyAccount, receipt: PolicyReceipt) {
  client.setQueryData<PolicyState>(forumWriteReceiptKeys.discoursePolicy(account), (previous) => ({
    ...previous,
    [receipt.postId]: { phase: 'awaiting-readback', receipt }
  }));
}

export function captureDiscoursePolicyRead(
  client: QueryClient,
  account: PolicyAccount,
  topicId: string,
  projectFreshPolicy = false
) {
  const queryKey = forumWriteReceiptKeys.discoursePolicy(account);
  const atStart = client.getQueryData<PolicyState>(queryKey);
  return <T extends { policy?: DiscoursePostPolicy }>(item: T): T => {
    const policy = item.policy;
    if (!policy) return item;
    const current = client.getQueryData<PolicyState>(queryKey)?.[policy.postId];
    if (current !== atStart?.[policy.postId]) {
      if (current?.phase !== 'observed') return item;
      // Both the visible query and other entry caches must respect the newer readback.
      return { ...item, policy: current.policy.version === policy.version ? current.policy : undefined };
    }
    if (
      current?.phase === 'awaiting-readback' &&
      current.receipt.version === policy.version &&
      current.receipt.accepted !== policy.accepted
    ) {
      return item;
    }
    if (current) {
      client.setQueryData<PolicyState>(queryKey, (previous) => ({
        ...previous,
        [policy.postId]: { phase: 'observed', policy }
      }));
    }
    if (current || projectFreshPolicy) syncDiscoursePolicyCaches(client, { ...account, topicId, policy });
    return item;
  };
}

/** Project an authoritative private read into existing caches for the same account and policy version. */
export function syncDiscoursePolicyCaches(
  queryClient: QueryClient,
  { topicId, identityKey, sessionEpoch, policy }: PolicyAccount & { topicId: string; policy: DiscoursePostPolicy }
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
  queryClient.setQueriesData<NotificationDetail>(
    {
      queryKey: ['forum', 'linuxdo', 'notifications', 'detail'],
      predicate: ({ queryKey }) =>
        isRecord(queryKey[4]) && queryKey[4].identityKey === identityKey && queryKey[4].sessionEpoch === sessionEpoch
    },
    (detail) => {
      const target = detail?.notification.target;
      return detail && (target?.type === 'topic' || target?.type === 'topic-post') && target.topicId === topicId
        ? updatePolicy(detail)
        : detail;
    }
  );
}
