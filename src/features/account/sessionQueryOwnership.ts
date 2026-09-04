import type { QueryClient } from '@tanstack/react-query';
import type { FeedSource, Source } from '@/domain/forum/models';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { appQueryClient } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';

export function resetForumSourceQueries(source: Source, client: QueryClient = appQueryClient) {
  const affectedSources: FeedSource[] = [source, 'all'];
  for (const affectedSource of affectedSources) {
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === 'forum' && query.queryKey[1] === affectedSource
    };
    void client.cancelQueries(filters);
    client.removeQueries(filters);
  }
}

export function cancelForumSourceQueries(
  source: Source,
  client: QueryClient = appQueryClient,
  includeAggregate = true
) {
  return client.cancelQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'forum' && (queryKey[1] === source || (includeAggregate && queryKey[1] === 'all'))
  });
}

export function removeUnconfirmedForumSourceQueries(source: Source, client: QueryClient = appQueryClient) {
  client.removeQueries({
    predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === source
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
