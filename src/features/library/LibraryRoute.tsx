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

export { LibraryRouteRuntimeProvider, type LibraryRouteRuntimeValue } from './LibraryRouteRuntime';

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
  const pages = useInfiniteQuery({
    queryKey: ['reader-library', collection, runtime.enabledSources.join('|'), source, category],
    enabled: active && runtime.reader.loaded,
    initialPageParam: undefined as ReaderPageRequest['after'],
    queryFn: ({ pageParam }) =>
      queryReaderPage({ collection, sources: runtime.enabledSources, source, category, after: pageParam }),
    getNextPageParam: (last) => last.next,
    staleTime: Infinity,
    retry: false
  });
  const records = useMemo(() => pages.data?.pages.flatMap((page) => page.records) ?? [], [pages.data]);
  const readingAttempts = useRef(new Set<string>());
  const readingScope = runtime.readingGateway?.reading?.scope();
  useEffect(() => {
    if (!active || !readingScope || !runtime.readingGateway || collection === 'followedUsers') return;
    const ids = (records as TopicRecord[]).flatMap(({ topic }) => {
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
  const favoriteRecords = libraryTab === 'favorites' ? (records as TopicRecord[]) : [];
  const historyRecords = libraryTab === 'history' ? (records as TopicRecord[]) : [];
  const followedUsers = libraryTab === 'users' ? (records as FollowedUserRecord[]) : [];
  const loadMore = useCallback(() => {
    if (active && pages.hasNextPage && !pages.isFetching) void pages.fetchNextPage();
  }, [active, pages]);
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
