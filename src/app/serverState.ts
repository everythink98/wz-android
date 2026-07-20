import { QueryClient } from '@tanstack/react-query';
import type { FeedSource, Source } from '../types';

export type ForumSourceResetReason =
  | 'session-updated'
  | 'login-detected'
  | 'login-expired'
  | 'cleared'
  | 'session-changed';
export type ForumSourceResetEvent = {
  source: Source;
  reason: ForumSourceResetReason;
  preserveRecoveryKey?: string;
};

const forumSourceResetListeners = new Set<(event: ForumSourceResetEvent) => void>();

export const forumQueryKeys = {
  all: ['forum'] as const,
  source: (source: FeedSource) => ['forum', source] as const,
  categories: (source: FeedSource) => ['forum', source, 'categories'] as const,
  feed: (source: FeedSource, requestKey: string) => ['forum', source, 'feed', requestKey] as const,
  feedPage: (source: FeedSource, requestKey: string, page: number, cursor?: string) => (
    ['forum', source, 'feed', requestKey, page, cursor || null] as const
  ),
  search: (source: Source, requestKey: string) => ['forum', source, 'search', requestKey] as const,
  searchTags: (source: Source, requestKey: string) => ['forum', source, 'search-tags', requestKey] as const,
  searchUsers: (source: Source, requestKey: string) => ['forum', source, 'search-users', requestKey] as const,
  semanticSearch: (source: Source, requestKey: string) => ['forum', source, 'semantic-search', requestKey] as const,
  topic: (source: Source, topicId: string) => ['forum', source, 'topic', topicId] as const,
  replies: (source: Source, topicId: string) => ['forum', source, 'topic', topicId, 'replies'] as const,
  replyPage: (source: Source, topicId: string, page: number | null | undefined, offset: number | null | undefined) => (
    ['forum', source, 'topic', topicId, 'replies', page ?? null, offset ?? null] as const
  ),
  reply: (source: Source, topicId: string, replyId: string) => ['forum', source, 'topic', topicId, 'reply', replyId] as const,
  user: (source: Source, userId: string) => ['forum', source, 'user', userId] as const,
  userPage: (source: Source, userId: string, lane: 'topics' | 'replies', cursor: string) => (
    ['forum', source, 'user', userId, lane, cursor] as const
  ),
  account: (source: Source) => ['forum', source, 'account'] as const,
  accountStatus: (source: Source, generation: number, lane: 'login' | 'profile' | 'authorization') => (
    ['forum', source, 'account', generation, lane] as const
  ),
  authorization: (source: Source) => ['forum', source, 'authorization'] as const,
  authorizationCheck: (source: Source, generation: number) => ['forum', source, 'authorization', generation] as const,
  level: (source: Source) => ['forum', source, 'level'] as const,
  levelProfile: (source: Source, generation: number) => ['forum', source, 'level', generation] as const
};

export const forumMutationKeys = {
  topicAction: (source: Source, topicId: string, actionKey: string) => (
    ['forum', source, 'mutation', 'topic', topicId, actionKey] as const
  )
};

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity
      },
      mutations: {
        retry: false
      }
    }
  });
}

export const appQueryClient = createAppQueryClient();

export function subscribeForumSourceResets(listener: (event: ForumSourceResetEvent) => void) {
  forumSourceResetListeners.add(listener);
  return () => {
    forumSourceResetListeners.delete(listener);
  };
}

export function resetForumSourceQueries(
  source: Source,
  client = appQueryClient,
  reason: ForumSourceResetReason = 'session-changed',
  preserveRecoveryKey?: string
) {
  const affectedSources: FeedSource[] = [source, 'all'];
  for (const affectedSource of affectedSources) {
    void client.cancelQueries({ queryKey: forumQueryKeys.source(affectedSource) });
    client.removeQueries({ queryKey: forumQueryKeys.source(affectedSource) });
  }
  const event = {
    source,
    reason,
    ...(preserveRecoveryKey ? { preserveRecoveryKey } : {})
  } satisfies ForumSourceResetEvent;
  forumSourceResetListeners.forEach((listener) => listener(event));
}
