import { QueryClient } from '@tanstack/react-query';
import type { SourceSearchFilter } from '@/searchFilters';
import { isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';
import type { FeedSource, Source } from '@/domain/forum/models';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';

export type ForumIdentityBarrierSource = SessionSource;

function sessionEpochKey(source: FeedSource, epochs: ForumSessionEpochs) {
  if (source === 'all') {
    return epochs;
  }
  return isSessionSource(source) ? epochs[source] : 0;
}

function identityBarrierKey(source: FeedSource, barriers: readonly ForumIdentityBarrierSource[] = []) {
  return source === 'all' ? [...new Set(barriers)].sort() : [];
}

export const forumQueryKeys = {
  all: ['forum'] as const,
  source: (source: FeedSource) => ['forum', source] as const,
  categories: (
    source: FeedSource,
    scope: ForumSessionEpochs = initialForumSessionEpochs,
    identityBarriers: readonly ForumIdentityBarrierSource[] = []
  ) =>
    [
      'forum',
      source,
      'categories',
      {
        identityBarriers: identityBarrierKey(source, identityBarriers),
        sessionEpoch: sessionEpochKey(source, scope)
      }
    ] as const,
  feed: ({
    category,
    feedFilter,
    identityBarriers,
    scope,
    source
  }: {
    category?: string;
    feedFilter?: string;
    identityBarriers?: readonly ForumIdentityBarrierSource[];
    scope: ForumSessionEpochs;
    source: FeedSource;
  }) =>
    [
      'forum',
      source,
      'feed',
      {
        category: category || null,
        identityBarriers: identityBarrierKey(source, identityBarriers),
        sessionEpoch: sessionEpochKey(source, scope),
        feedFilter: feedFilter || null
      }
    ] as const,
  search: ({
    authenticated,
    filter,
    query,
    scope,
    sort,
    source
  }: {
    authenticated?: boolean;
    filter?: SourceSearchFilter;
    query: string;
    scope: ForumSessionEpochs;
    sort: string;
    source: Source;
  }) =>
    [
      'forum',
      source,
      'search',
      {
        authenticated: source === 'linuxdo' && authenticated === true,
        sessionEpoch: sessionEpochKey(source, scope),
        filter: filter || null,
        query,
        sort
      }
    ] as const,
  searchTags: ({
    categoryId,
    query,
    scope,
    selectedTags,
    source
  }: {
    categoryId?: string;
    query: string;
    scope: ForumSessionEpochs;
    selectedTags: string[];
    source: Source;
  }) =>
    [
      'forum',
      source,
      'search-tags',
      {
        categoryId: categoryId || null,
        sessionEpoch: sessionEpochKey(source, scope),
        query,
        selectedTags
      }
    ] as const,
  searchUsers: ({
    categoryId,
    scope,
    source,
    term
  }: {
    categoryId?: string;
    scope: ForumSessionEpochs;
    source: Source;
    term: string;
  }) =>
    [
      'forum',
      source,
      'search-users',
      {
        categoryId: categoryId || null,
        sessionEpoch: sessionEpochKey(source, scope),
        term
      }
    ] as const,
  semanticSearch: (query: string, scope: ForumSessionEpochs) =>
    ['forum', 'linuxdo', 'semantic-search', { sessionEpoch: scope.linuxdo, query }] as const,
  topic: ({ scope, source, topicId }: { scope: ForumSessionEpochs; source: Source; topicId: string }) =>
    [
      'forum',
      source,
      'topic',
      {
        sessionEpoch: sessionEpochKey(source, scope),
        topicId
      }
    ] as const,
  replies: (topicQueryKey: readonly unknown[]) => [...topicQueryKey, 'replies'] as const,
  replyRefresh: (repliesQueryKey: readonly unknown[], page: number, offset: number | null, limit: number) =>
    [...repliesQueryKey, 'refresh', { limit, offset, page }] as const,
  reply: ({
    postNumber,
    scope,
    source,
    topicId
  }: {
    postNumber: number;
    scope: ForumSessionEpochs;
    source: Source;
    topicId: string;
  }) =>
    [
      'forum',
      source,
      'topic-reply',
      {
        sessionEpoch: sessionEpochKey(source, scope),
        postNumber,
        topicId
      }
    ] as const,
  user: ({ scope, source, userId }: { scope: ForumSessionEpochs; source: Source; userId: string }) =>
    [
      'forum',
      source,
      'user',
      {
        sessionEpoch: sessionEpochKey(source, scope),
        userId
      }
    ] as const,
  userResolution: ({ scope, username }: { scope: ForumSessionEpochs; username: string }) =>
    [
      'forum',
      'nodeseek',
      'user-resolution',
      {
        sessionEpoch: scope.nodeseek,
        username: username.trim()
      }
    ] as const,
  userLane: (userKey: readonly unknown[], lane: 'topics' | 'replies') => [...userKey, lane] as const,
  accountStatus: ({ sessionEpochs, source }: { sessionEpochs: ForumSessionEpochs; source: Source }) =>
    ['forum', source, 'account-status', { sessionEpoch: sessionEpochKey(source, sessionEpochs) }] as const,
  accountStatusProbe: ({
    sessionEpochs,
    generation,
    source
  }: {
    sessionEpochs: ForumSessionEpochs;
    generation: number;
    source: Source;
  }) =>
    [
      'forum',
      source,
      'account-status-probe',
      {
        sessionEpoch: sessionEpochKey(source, sessionEpochs),
        generation
      }
    ] as const,
  level: (source: Source) => ['forum', source, 'level'] as const,
  levelProfile: ({ sessionEpochs, source }: { sessionEpochs: ForumSessionEpochs; source: Source }) =>
    ['forum', source, 'level', { sessionEpoch: sessionEpochKey(source, sessionEpochs) }] as const
};

export const forumMutationKeys = {
  topic: (source: Source, topicId: string) => ['forum', source, 'mutation', 'topic', topicId] as const
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
