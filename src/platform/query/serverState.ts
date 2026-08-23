import { QueryClient } from '@tanstack/react-query';
import type { SourceSearchFilter } from '@/domain/forum/searchFilters';
import { isSessionSource, type DiscourseSource, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { FeedSource, ReplyOrder, Source } from '@/domain/forum/models';
import { initialForumSessionEpochs, type ForumSessionEpochs } from './sessionEpochs';

function sessionEpochKey(source: FeedSource, epochs: ForumSessionEpochs) {
  if (source === 'all') {
    return epochs;
  }
  return isSessionSource(source) ? epochs[source] : 0;
}

export const accountQueryKeys = {
  all: ['account'] as const,
  snapshot: (source: Source) => ['account', source, 'snapshot'] as const
};

export const forumQueryKeys = {
  all: ['forum'] as const,
  source: (source: FeedSource) => ['forum', source] as const,
  categories: (
    source: FeedSource,
    scope: ForumSessionEpochs = initialForumSessionEpochs,
    enabledSourcesKey?: string,
    readPlanScope?: string
  ) =>
    [
      'forum',
      source,
      'categories',
      {
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        ...(source === 'all' && enabledSourcesKey !== undefined ? { enabledSources: enabledSourcesKey } : {})
      }
    ] as const,
  feed: ({
    category,
    feedFilter,
    enabledSourcesKey,
    readPlanScope,
    scope,
    source
  }: {
    category?: string;
    feedFilter?: string;
    enabledSourcesKey?: string;
    readPlanScope?: string;
    scope: ForumSessionEpochs;
    source: FeedSource;
  }) =>
    [
      'forum',
      source,
      'feed',
      {
        category: category || null,
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        feedFilter: feedFilter || null,
        ...(source === 'all' && enabledSourcesKey !== undefined ? { enabledSources: enabledSourcesKey } : {})
      }
    ] as const,
  search: ({
    filter,
    lane,
    query,
    readPlanScope,
    scope,
    sort,
    source
  }: {
    filter?: SourceSearchFilter;
    lane: 'pages' | 'preview';
    query: string;
    readPlanScope?: string;
    scope: ForumSessionEpochs;
    sort: string;
    source: Source;
  }) =>
    [
      'forum',
      source,
      'search',
      {
        lane,
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        filter: filter || null,
        query,
        sort
      }
    ] as const,
  searchTags: ({
    categoryId,
    query,
    readPlanScope,
    scope,
    selectedTags,
    source
  }: {
    categoryId?: string;
    query: string;
    readPlanScope?: string;
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
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        query,
        selectedTags
      }
    ] as const,
  searchUsers: ({
    categoryId,
    readPlanScope,
    scope,
    source,
    term
  }: {
    categoryId?: string;
    readPlanScope?: string;
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
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        term
      }
    ] as const,
  semanticSearch: (query: string, scope: ForumSessionEpochs, readPlanScope?: string) =>
    [
      'forum',
      'linuxdo',
      'semantic-search',
      { ...(readPlanScope ? { readPlanScope } : {}), sessionEpoch: scope.linuxdo, query }
    ] as const,
  topic: ({
    readPlanScope,
    scope,
    source,
    topicId
  }: {
    readPlanScope?: string;
    scope: ForumSessionEpochs;
    source: Source;
    topicId: string;
  }) =>
    [
      'forum',
      source,
      'topic',
      {
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        topicId
      }
    ] as const,
  replies: (topicQueryKey: readonly unknown[], order: ReplyOrder, readPlanScope?: string) =>
    [...topicQueryKey, 'replies', { order, ...(readPlanScope ? { readPlanScope } : {}) }] as const,
  replyRefresh: (repliesQueryKey: readonly unknown[], page: number, offset: number | null, limit: number) =>
    [...repliesQueryKey, 'refresh', { limit, offset, page }] as const,
  reply: ({
    postNumber,
    readPlanScope,
    scope,
    source,
    topicId
  }: {
    postNumber: number;
    readPlanScope?: string;
    scope: ForumSessionEpochs;
    source: Source;
    topicId: string;
  }) =>
    [
      'forum',
      source,
      'topic-reply',
      {
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        postNumber,
        topicId
      }
    ] as const,
  user: ({
    readPlanScope,
    scope,
    source,
    userId
  }: {
    readPlanScope?: string;
    scope: ForumSessionEpochs;
    source: Source;
    userId: string;
  }) =>
    [
      'forum',
      source,
      'user',
      {
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: sessionEpochKey(source, scope),
        userId
      }
    ] as const,
  userResolution: ({
    readPlanScope,
    scope,
    username
  }: {
    readPlanScope?: string;
    scope: ForumSessionEpochs;
    username: string;
  }) =>
    [
      'forum',
      'nodeseek',
      'user-resolution',
      {
        ...(readPlanScope ? { readPlanScope } : {}),
        sessionEpoch: scope.nodeseek,
        username: username.trim()
      }
    ] as const,
  userLane: (userKey: readonly unknown[], lane: 'topics' | 'replies') => [...userKey, lane] as const,
  emojiUrls: (source: DiscourseSource | null) => ['forum', source || 'none', 'emoji-urls'] as const,
  notifications: (source: NotificationSource | 'all') => ['forum', source, 'notifications'] as const,
  notificationList: ({
    categoryId,
    identityKey,
    source,
    unreadOnly
  }: {
    categoryId?: string | null;
    identityKey: string;
    source: NotificationSource | 'all';
    unreadOnly: boolean;
  }) =>
    ['forum', source, 'notifications', 'list', { categoryId: categoryId || null, identityKey, unreadOnly }] as const,
  notificationCategories: ({ identityKey, source }: { identityKey: string; source: NotificationSource | 'all' }) =>
    ['forum', source, 'notifications', 'categories', { identityKey }] as const,
  notificationDetail: ({
    identityKey,
    notificationId,
    source
  }: {
    identityKey: string;
    notificationId: string;
    source: NotificationSource;
  }) => ['forum', source, 'notifications', 'detail', { identityKey, notificationId }] as const,
  notificationSnapshot: ({ identityKey, source }: { identityKey: string; source: NotificationSource }) =>
    ['forum', source, 'notifications', 'snapshot', { identityKey }] as const,
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
