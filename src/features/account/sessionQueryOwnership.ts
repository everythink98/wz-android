import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { FeedSource, Source } from '@/domain/forum/models';
import type { SessionSite, SiteSessionEvent } from '@/domain/session/siteSessionState';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';

type ForumQueryInvalidatingSessionEvent = Extract<
  SiteSessionEvent,
  { type: 'session-updated' | 'login-detected' | 'login-expired' | 'cleared' }
>;

export function siteSessionEventInvalidatesForumQueries(
  event: SiteSessionEvent
): event is ForumQueryInvalidatingSessionEvent {
  return (
    event.type === 'session-updated' ||
    event.type === 'login-detected' ||
    event.type === 'login-expired' ||
    event.type === 'cleared'
  );
}

export function resetForumSourceQueries(
  source: Source,
  client: QueryClient = appQueryClient,
  preserveRecoveryQueryKey?: QueryKey
) {
  const preservedQuery = preserveRecoveryQueryKey
    ? client.getQueryCache().find({ queryKey: preserveRecoveryQueryKey, exact: true })
    : undefined;
  const isObservedAccountStatus = Boolean(
    preservedQuery?.queryKey[2] === 'account-status' && preservedQuery.getObserversCount() > 0
  );
  const canPreserve = Boolean(
    preservedQuery &&
    (preservedQuery.isActive() || isObservedAccountStatus) &&
    preservedQuery.queryKey[0] === 'forum' &&
    (preservedQuery.queryKey[1] === source || preservedQuery.queryKey[1] === 'all')
  );
  const affectedSources: FeedSource[] = [source, 'all'];
  for (const affectedSource of affectedSources) {
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === 'forum' &&
        query.queryKey[1] === affectedSource &&
        (!canPreserve || query !== preservedQuery)
    };
    void client.resetQueries({
      predicate: (query) => filters.predicate(query) && query.queryKey[2] === 'account-status'
    });
    void client.cancelQueries(filters);
    client.removeQueries(filters);
  }
  return canPreserve;
}

export function cancelForumSourceQueries(source: Source, client: QueryClient = appQueryClient) {
  return client.cancelQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'forum' &&
      (queryKey[1] === source || queryKey[1] === 'all') &&
      queryKey[2] !== 'account-status' &&
      queryKey[2] !== 'account-status-probe'
  });
}

export function removeUnconfirmedForumSourceQueries(source: Source, client: QueryClient = appQueryClient) {
  client.removeQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'forum' &&
      queryKey[1] === source &&
      queryKey[2] !== 'account-status' &&
      queryKey[2] !== 'account-status-probe'
  });
}

export function forumSessionEpochsAfterSourceChange(
  currentEpochs: ForumSessionEpochs,
  source: SessionSite
): ForumSessionEpochs {
  return {
    ...currentEpochs,
    [source]: currentEpochs[source] + 1
  };
}

export function commitExpiredAccountStatusQuery(
  source: SessionSite,
  currentEpochs: ForumSessionEpochs,
  recoveryQueryKey: QueryKey,
  client: QueryClient = appQueryClient
) {
  const committedData = client.getQueryData(recoveryQueryKey);
  const isExpiredResult = Boolean(
    committedData &&
    typeof committedData === 'object' &&
    'session' in committedData &&
    committedData.session &&
    typeof committedData.session === 'object' &&
    'status' in committedData.session &&
    committedData.session.status === 'expired'
  );
  if (!isExpiredResult) {
    resetForumSourceQueries(source, client, recoveryQueryKey);
    return forumSessionEpochsAfterSourceChange(currentEpochs, source);
  }
  return commitChangedAccountStatusQuery(source, currentEpochs, recoveryQueryKey, client);
}

export function commitChangedAccountStatusQuery(
  source: SessionSite,
  currentEpochs: ForumSessionEpochs,
  recoveryQueryKey: QueryKey,
  client: QueryClient = appQueryClient
) {
  const committedData = client.getQueryData(recoveryQueryKey);
  resetForumSourceQueries(source, client);
  const nextEpochs = forumSessionEpochsAfterSourceChange(currentEpochs, source);
  if (committedData !== undefined) {
    client.setQueryData(
      forumQueryKeys.accountStatus({
        sessionEpochs: nextEpochs,
        source
      }),
      committedData
    );
  }
  return nextEpochs;
}
