import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Topic, UserReference, FeedSource } from '@/domain/forum/models';
import type { LibraryTab } from '@/domain/forum/feed';

import { normalizeUserReference } from '@/domain/forum/userNavigation';

import type { FollowedUserRecord, TopicRecord } from '@/domain/reader/readerData';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import type { LibraryListItem } from './libraryScreenItems';
import { LibraryScreen } from './LibraryScreen';
import { useInfiniteQuery } from '@tanstack/react-query';
import { queryReaderPage } from '@/platform/storage/readerDataStore';
import type { ReaderPageRequest } from '@/domain/reader/readerRecordState';

import { useReaderDataActionsController } from './useReaderDataActionsController';
import { useLibraryRouteRuntime } from './LibraryRouteRuntime';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

export { LibraryRouteRuntimeProvider, type LibraryRouteRuntimeValue } from './LibraryRouteRuntime';

function useCollectionPages(request: Omit<ReaderPageRequest, 'after'>, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ['reader-library', request.collection, request.sources.join('|'), request.source, request.category],
    enabled,
    initialPageParam: undefined as ReaderPageRequest['after'],
    queryFn: ({ pageParam }) => queryReaderPage({ ...request, after: pageParam }),
    getNextPageParam: (last) => last.next,
    staleTime: Infinity,
    retry: false
  });
  const records = useMemo(() => query.data?.pages.flatMap((page) => page.records) ?? [], [query.data]);
  return { query, records };
}

export function LibraryRoute() {
  const runtime = useLibraryRouteRuntime();
  const active = useIsFocused();
  const navigation = useNavigation();
  const listRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  useScrollToTop(listRef);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const actions = useReaderDataActionsController({
    commitReaderData: runtime.reader.commit,
    readerDataRef: runtime.reader.dataRef
  });
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const collection = libraryTab === 'users' ? 'followedUsers' : libraryTab;
  const source = sourceFilter === 'all' || runtime.enabledSources.includes(sourceFilter) ? sourceFilter : 'all';
  const category = source === sourceFilter ? categoryFilter : 'all';
  const requestFor = (candidate: ReaderPageRequest['collection']) => ({
    collection: candidate,
    sources: runtime.enabledSources,
    source: candidate === collection ? source : ('all' as const),
    category: candidate === collection ? category : 'all'
  });
  const favorites = useCollectionPages(
    requestFor('favorites'),
    active && runtime.reader.loaded && collection === 'favorites'
  );
  const history = useCollectionPages(
    requestFor('history'),
    active && runtime.reader.loaded && collection === 'history'
  );
  const users = useCollectionPages(
    requestFor('followedUsers'),
    active && runtime.reader.loaded && collection === 'followedUsers'
  );
  const { query: pages, records } = libraryTab === 'favorites' ? favorites : libraryTab === 'history' ? history : users;
  const currentTabRef = useCommittedRef(active ? libraryTab : undefined);
  const readingAttempts = useRef(new Set<string>());
  const readingScope = runtime.readingGateway?.reading?.scope();
  useEffect(() => {
    if (!active || !readingScope || !runtime.readingGateway || collection === 'followedUsers') return;
    const ids = records.flatMap((record) => {
      if (!('topic' in record)) return [];
      const { topic } = record;
      const key = `${readingScope}:${topic.id}`;
      if (
        topic.source !== 'linuxdo' ||
        topic.isPrivateMessage ||
        runtime.reader.data.history[`linuxdo:${topic.id}`] ||
        readingAttempts.current.has(key)
      )
        return [];
      readingAttempts.current.add(key);
      return [topic.id];
    });
    if (!ids.length) return;
    // Returning only republishes local records; previously attempted IDs never trigger a return fetch.
    void runtime.readingGateway.getReadingBatch(ids).catch(() => undefined);
  }, [active, collection, readingScope, records, runtime.readingGateway, runtime.reader.data.history]);
  const favoriteRecords = useMemo(
    () => favorites.records.filter((record): record is TopicRecord => 'topic' in record),
    [favorites.records]
  );
  const historyRecords = useMemo(
    () => history.records.filter((record): record is TopicRecord => 'topic' in record),
    [history.records]
  );
  const followedUsers = useMemo(
    () => users.records.filter((record): record is FollowedUserRecord => 'user' in record),
    [users.records]
  );
  const loadMore = useCallback(
    (tab: LibraryTab) => {
      if (tab !== libraryTab || currentTabRef.current !== tab) return;
      if (pages.hasNextPage && !pages.isFetching) void pages.fetchNextPage();
    },
    [currentTabRef, libraryTab, pages]
  );
  const openTopic = useCallback(
    (topic: Topic) => navigation.dispatch(StackActions.push('Topic', { topic })),
    [navigation]
  );
  const openUser = useCallback(
    (user: UserReference) => {
      const normalized = normalizeUserReference(user);
      if (!normalized) {
        runtime.notify('用户信息不完整');
        return;
      }
      navigation.dispatch(StackActions.push('User', { user: normalized }));
    },
    [navigation, runtime]
  );
  const openContentSourceSettings = useCallback(() => navigation.dispatch(manageContentSourcesAction()), [navigation]);

  return (
    <LibraryScreen
      active={active}
      categories={runtime.categories}
      enabledSources={runtime.enabledSources}
      favoriteRecords={favoriteRecords}
      followedUsers={followedUsers}
      historyRecords={historyRecords}
      libraryTab={libraryTab}
      loaded={runtime.reader.loaded && !pages.isPending}
      sourceFilter={sourceFilter}
      categoryFilter={categoryFilter}
      onSourceFilter={setSourceFilter}
      onCategoryFilter={setCategoryFilter}
      total={pages.data?.pages[0]?.total ?? 0}
      visibleTotal={pages.data?.pages[0]?.visibleTotal ?? 0}
      error={pages.isError}
      onRetry={() => {
        void pages.refetch();
      }}
      onLoadMore={loadMore}
      scrollRef={listRef}
      topicStateIndex={runtime.topicStateIndex}
      onClearHistory={actions.clearHistory}
      onManageContentSources={openContentSourceSettings}
      onOpenTopic={openTopic}
      onOpenUser={openUser}
      onRemove={actions.removeLibraryTopic}
      onRemoveUser={actions.removeFollowedUser}
      onTabChange={setLibraryTab}
    />
  );
}
