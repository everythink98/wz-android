import type { QueryClient } from '@tanstack/react-query';
import type { Source } from '@/domain/forum/models';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { appQueryClient, forumQueryKeys, forumWriteReceiptKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';

export function resetForumSourceQueries(source: Source, client: QueryClient = appQueryClient) {
  const keys = [forumQueryKeys.source(source), forumQueryKeys.source('all'), forumWriteReceiptKeys.source(source)];
  for (const queryKey of keys) {
    void client.cancelQueries({ queryKey });
    client.removeQueries({ queryKey });
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
  client.removeQueries({ queryKey: forumQueryKeys.source(source) });
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
