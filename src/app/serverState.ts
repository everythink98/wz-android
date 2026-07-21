import { QueryClient } from '@tanstack/react-query';
import type { SourceSearchFilter } from '../searchFilters';
import type { FeedSource, Source } from '../types';

export type ForumCredentialScope = Readonly<{
  linuxdo: number;
  nodeseek: number;
  xiaoyinsi: number;
  yaohuo: number;
}>;

export const emptyForumCredentialScope: ForumCredentialScope = {
  linuxdo: 0,
  nodeseek: 0,
  xiaoyinsi: 0,
  yaohuo: 0
};

function credentialKey(source: FeedSource, scope: ForumCredentialScope) {
  if (source === 'all') {
    return scope;
  }
  return source === 'v2ex' ? 0 : scope[source];
}

export const forumQueryKeys = {
  all: ['forum'] as const,
  source: (source: FeedSource) => ['forum', source] as const,
  categories: (source: FeedSource, scope: ForumCredentialScope = emptyForumCredentialScope) => (
    ['forum', source, 'categories', credentialKey(source, scope)] as const
  ),
  feed: ({
    category,
    feedFilter,
    scope,
    source
  }: {
    category?: string;
    feedFilter?: string;
    scope: ForumCredentialScope;
    source: FeedSource;
  }) => ['forum', source, 'feed', {
    category: category || null,
    credential: credentialKey(source, scope),
    feedFilter: feedFilter || null
  }] as const,
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
    scope: ForumCredentialScope;
    sort: string;
    source: Source;
  }) => ['forum', source, 'search', {
    authenticated: source === 'linuxdo' && authenticated === true,
    credential: credentialKey(source, scope),
    filter: filter || null,
    query,
    sort
  }] as const,
  searchTags: ({
    categoryId,
    query,
    scope,
    selectedTags,
    source
  }: {
    categoryId?: string;
    query: string;
    scope: ForumCredentialScope;
    selectedTags: string[];
    source: Source;
  }) => ['forum', source, 'search-tags', {
    categoryId: categoryId || null,
    credential: credentialKey(source, scope),
    query,
    selectedTags
  }] as const,
  searchUsers: ({
    categoryId,
    scope,
    source,
    term
  }: {
    categoryId?: string;
    scope: ForumCredentialScope;
    source: Source;
    term: string;
  }) => ['forum', source, 'search-users', {
    categoryId: categoryId || null,
    credential: credentialKey(source, scope),
    term
  }] as const,
  semanticSearch: (query: string, scope: ForumCredentialScope) => (
    ['forum', 'linuxdo', 'semantic-search', { credential: scope.linuxdo, query }] as const
  ),
  topic: ({
    scope,
    source,
    topicId
  }: {
    scope: ForumCredentialScope;
    source: Source;
    topicId: string;
  }) => ['forum', source, 'topic', {
    credential: credentialKey(source, scope),
    topicId
  }] as const,
  replies: (topicQueryKey: readonly unknown[]) => [...topicQueryKey, 'replies'] as const,
  reply: ({
    postNumber,
    scope,
    source,
    topicId
  }: {
    postNumber: number;
    scope: ForumCredentialScope;
    source: Source;
    topicId: string;
  }) => ['forum', source, 'topic-reply', {
    credential: credentialKey(source, scope),
    postNumber,
    topicId
  }] as const,
  user: ({
    scope,
    source,
    userId,
    username
  }: {
    scope: ForumCredentialScope;
    source: Source;
    userId: string;
    username: string;
  }) => ['forum', source, 'user', {
    credential: credentialKey(source, scope),
    userId,
    username
  }] as const,
  userLane: (userKey: readonly unknown[], lane: 'topics' | 'replies') => [...userKey, lane] as const,
  accountStatus: ({
    credentialScope,
    source
  }: {
    credentialScope: ForumCredentialScope;
    source: Source;
  }) => ['forum', source, 'account-status', { credential: credentialKey(source, credentialScope) }] as const,
  level: (source: Source) => ['forum', source, 'level'] as const,
  levelProfile: ({
    credentialScope,
    source
  }: {
    credentialScope: ForumCredentialScope;
    source: Source;
  }) => ['forum', source, 'level', { credential: credentialKey(source, credentialScope) }] as const
};

export const forumMutationKeys = {
  topic: (source: Source, topicId: string) => (
    ['forum', source, 'mutation', 'topic', topicId] as const
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
