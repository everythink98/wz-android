import { hashKey, QueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import type { SourceSearchFilter } from '@/domain/forum/searchFilters';
import { isSessionSource, type DiscourseSource, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { FeedSource, ReplyOrder, Source } from '@/domain/forum/models';
import type { ReaderPageRequest } from '@/domain/reader/readerRecordState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from './sessionEpochs';

function sessionEpochKey(source: FeedSource, epochs: ForumSessionEpochs) {
  if (source === 'all') {
    return epochs;
  }
  return isSessionSource(source) ? epochs[source] : 0;
}

const libraryQueryRoot = ['reader-library'] as const;
const libraryCollectionKey = (collection: ReaderPageRequest['collection']) =>
  [...libraryQueryRoot, collection] as const;
const librarySourceSetKey = (sources: readonly Source[]) => sources.slice().sort().join('|');

export const readerLibraryQueryKeys = {
  all: libraryQueryRoot,
  collection: libraryCollectionKey,
  categories: (collection: ReaderPageRequest['collection'], sources: readonly Source[]) =>
    [...libraryCollectionKey(collection), 'categories', librarySourceSetKey(sources)] as const,
  page: ({ collection, sources, source, category }: Omit<ReaderPageRequest, 'after'>) =>
    [...libraryCollectionKey(collection), librarySourceSetKey(sources), source, category] as const
};

export const accountQueryKeys = {
  all: ['account'] as const,
  snapshot: (source: Source) => ['account', source, 'snapshot'] as const
};

type AccountDataSource = import('@/domain/session/siteSessionState').SessionSite;
type AccountDataKind = 'overview' | 'attendance' | 'credits' | 'stardust-credits' | 'ldc-account' | 'ldc-transactions';

const accountDataPrefix = (source: AccountDataSource, kind: AccountDataKind) =>
  ['forum', source, 'account-data', kind] as const;
const levelProfilePrefix = (source: Source) => ['forum', source, 'level'] as const;

// Pending writes must survive the cleanup of site read caches.
const writeReceiptRootKey = ['forum-write-receipts'] as const;
const writeReceiptSourceKey = (source: Source) => [...writeReceiptRootKey, source] as const;

export const forumWriteReceiptKeys = {
  source: writeReceiptSourceKey,
  nodeSeekPoll: (scope: { identityKey: string; sessionEpoch: number; pollId: string; kind: 'vote' | 'lock' }) =>
    [...writeReceiptSourceKey('nodeseek'), 'poll', scope] as const,
  discoursePolicy: (account?: { identityKey: string; sessionEpoch: number }) =>
    [
      ...writeReceiptSourceKey('linuxdo'),
      'policy',
      account ? { identityKey: account.identityKey, sessionEpoch: account.sessionEpoch } : null
    ] as const
};

export const forumQueryKeys = {
  all: ['forum'] as const,
  source: (source: FeedSource) => ['forum', source] as const,
  v2exNodeDirectory: ['forum', 'v2ex', 'node-directory'] as const,
  searchAuthorLabels: (sessionEpoch: number, readPlanScope: string) =>
    ['forum', 'linuxdo', 'search-author-labels', { sessionEpoch, readPlanScope }] as const,
  accountDataPrefix,
  accountData: ({
    source,
    kind,
    userId,
    sessionEpoch,
    readPlanScope
  }: {
    source: AccountDataSource;
    kind: AccountDataKind;
    userId: string;
    sessionEpoch: number;
    readPlanScope: string;
  }) => [...accountDataPrefix(source, kind), { userId, sessionEpoch, readPlanScope }] as const,
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
    source
  }: {
    categoryId?: string;
    query: string;
    readPlanScope?: string;
    scope: ForumSessionEpochs;
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
        query
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
  replies: (topicQueryKey: readonly unknown[], order: ReplyOrder, readPlanScope?: string, windowOwner?: string) =>
    [
      ...topicQueryKey,
      'replies',
      { order, ...(readPlanScope ? { readPlanScope } : {}), ...(windowOwner ? { windowOwner } : {}) }
    ] as const,
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
  interactionConfig: (sessionEpoch: number) => ['forum', 'linuxdo', 'interaction-config', { sessionEpoch }] as const,
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
    sessionEpoch,
    source
  }: {
    identityKey: string;
    notificationId: string;
    sessionEpoch: number;
    source: NotificationSource;
  }) => ['forum', source, 'notifications', 'detail', { identityKey, notificationId, sessionEpoch }] as const,
  notificationSnapshot: ({
    identityKey,
    sessionEpoch,
    source
  }: {
    identityKey: string;
    sessionEpoch: number;
    source: NotificationSource;
  }) => ['forum', source, 'notifications', 'snapshot', { identityKey, sessionEpoch }] as const,
  level: (source: Source) => ['forum', source, 'level'] as const,
  levelProfilePrefix,
  levelProfile: ({ sessionEpochs, source }: { sessionEpochs: ForumSessionEpochs; source: Source }) =>
    [...levelProfilePrefix(source), { sessionEpoch: sessionEpochKey(source, sessionEpochs) }] as const
};

export const forumMutationKeys = {
  topic: (source: Source, topicId: string) => ['forum', source, 'mutation', 'topic', topicId] as const
};

export function forumReplyWindowKeys(queryClient: QueryClient, topicKey: QueryKey, readPlanScope: string): QueryKey[] {
  return (['oldest', 'newest'] as const).flatMap((order): QueryKey[] => {
    const shared = forumQueryKeys.replies(topicKey, order, readPlanScope);
    return [
      shared,
      ...queryClient
        .getQueryCache()
        .findAll({
          queryKey: shared,
          predicate: ({ queryKey, queryHash }) => {
            if (queryKey.length !== shared.length) return false;
            const options = queryKey.at(-1);
            if (!options || typeof options !== 'object' || !('windowOwner' in options)) return false;
            return (
              typeof options.windowOwner === 'string' &&
              queryHash === hashKey(forumQueryKeys.replies(topicKey, order, readPlanScope, options.windowOwner))
            );
          }
        })
        .map(({ queryKey }) => queryKey)
    ];
  });
}

export function createAppQueryClient() {
  const client = new QueryClient({
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
  client.setQueryDefaults(writeReceiptRootKey, { gcTime: Infinity });
  return client;
}

export const appQueryClient = createAppQueryClient();

export function keepFirstQueryPage<Page, Cursor>(previous: InfiniteData<Page, Cursor> | undefined) {
  return previous ? { pages: previous.pages.slice(0, 1), pageParams: previous.pageParams.slice(0, 1) } : previous;
}
