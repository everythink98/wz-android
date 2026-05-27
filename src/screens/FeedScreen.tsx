import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlatList, RefreshControl, Text, View, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { TabView } from 'react-native-tab-view';
import { ChevronUp, RefreshCw } from 'lucide-react-native';
import type { Category, FeedSource, Topic } from '../types';
import { topicKey, type ReaderData } from '../readerData';
import { feedCategoryItems, feedReadingFilterItems, feedSourceItems, shouldUseReadingFilter } from '../feedCategoryRail';
import { shouldLoadMoreFeedFromScroll, shouldShowFeedFloatingActions } from '../feedFloatingActions';
import type { ReadingFilter } from '../feedLogic';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, FloatingIconButton, LoadingState, PillRail } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { FEED_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

const FEED_SCROLL_STORAGE_PREFIX = 'reader-feed-scroll';

function feedScrollStorageKey(source: FeedSource, category: string, readingFilter: ReadingFilter) {
  return `${FEED_SCROLL_STORAGE_PREFIX}:${source}:${category || 'all'}:${readingFilter}`;
}

export function FeedScreen({
  busy,
  categories,
  categoryFilter,
  feedHasMore,
  feedItems,
  feedPage,
  feedSource,
  loadingMore,
  readerData,
  topicListStateInput,
  readingFilter,
  refreshing,
  scrollToTopSignal,
  styles,
  theme,
  onCategoryChange,
  onFeedSourceChange,
  onLoadMore,
  onOpenTopic,
  onReadingFilterChange,
  onRefresh
}: {
  busy: boolean;
  categories: Category[];
  categoryFilter: string;
  feedHasMore: boolean;
  feedItems: Topic[];
  feedPage: number;
  feedSource: FeedSource;
  loadingMore: boolean;
  readerData: ReaderData;
  topicListStateInput: NormalizedTopicListStateInput;
  readingFilter: ReadingFilter;
  refreshing: boolean;
  scrollToTopSignal: number;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCategoryChange: (categoryId: string) => void;
  onFeedSourceChange: (source: FeedSource) => void;
  onLoadMore: () => void;
  onOpenTopic: (topic: Topic) => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onRefresh: () => void;
}) {
  const listRefs = useRef<Partial<Record<FeedSource, FlatList<Topic> | null>>>({});
  const requestedFeedPageRef = useRef<number | null>(null);
  const pendingScrollOffsetRef = useRef<Partial<Record<FeedSource, number | null>>>({});
  const scrollStorageKey = useMemo(() => feedScrollStorageKey(feedSource, categoryFilter, readingFilter), [categoryFilter, feedSource, readingFilter]);
  const [showFloatingActions, setShowFloatingActions] = useState(false);
  const [scrollRestoreReady, setScrollRestoreReady] = useState(false);
  const activeIndex = Math.max(0, feedSourceItems.findIndex((item) => item.value === feedSource));
  const secondaryRailResetKey = feedSource;

  const requestFeedLoadMore = useCallback(() => {
    if (!feedHasMore || busy || loadingMore) {
      return;
    }
    const nextPage = feedPage + 1;
    if (requestedFeedPageRef.current === nextPage) {
      return;
    }
    requestedFeedPageRef.current = nextPage;
    onLoadMore();
  }, [busy, feedHasMore, feedPage, loadingMore, onLoadMore]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextVisible = shouldShowFeedFloatingActions(event.nativeEvent.contentOffset.y);
    setShowFloatingActions((current) => current === nextVisible ? current : nextVisible);
    if (shouldLoadMoreFeedFromScroll(event.nativeEvent)) {
      requestFeedLoadMore();
    }
  }, [requestFeedLoadMore]);

  const saveFeedScrollPosition = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, Math.round(event.nativeEvent.contentOffset.y));
    void AsyncStorage.setItem(scrollStorageKey, String(offset)).catch(() => undefined);
  }, [scrollStorageKey]);

  useEffect(() => {
    if (!busy && !loadingMore) {
      requestedFeedPageRef.current = null;
    }
  }, [busy, loadingMore]);

  useEffect(() => {
    requestedFeedPageRef.current = null;
    setShowFloatingActions(false);
    pendingScrollOffsetRef.current[feedSource] = null;
    setScrollRestoreReady(false);
    let active = true;
    AsyncStorage.getItem(scrollStorageKey)
      .then((value) => {
        if (!active) {
          return;
        }
        const offset = Number(value || 0);
        if (Number.isFinite(offset) && offset > 0) {
          pendingScrollOffsetRef.current[feedSource] = offset;
        }
      })
      .catch(() => undefined)
      .then(() => {
        if (active) {
          setScrollRestoreReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [feedSource, scrollStorageKey]);

  const restoreFeedScrollPosition = useCallback(() => {
    const offset = pendingScrollOffsetRef.current[feedSource];
    if (scrollRestoreReady && offset && feedItems.length) {
      pendingScrollOffsetRef.current[feedSource] = null;
      requestAnimationFrame(() => listRefs.current[feedSource]?.scrollToOffset({ offset, animated: false }));
    }
  }, [feedItems.length, feedSource, scrollRestoreReady]);

  useEffect(() => {
    restoreFeedScrollPosition();
  }, [restoreFeedScrollPosition]);

  const scrollToFeedTop = useCallback((source: FeedSource = feedSource) => {
    listRefs.current[source]?.scrollToOffset({ offset: 0, animated: true });
    setShowFloatingActions(false);
  }, [feedSource]);

  const onRefreshPress = useCallback(() => {
    scrollToFeedTop();
    onRefresh();
  }, [onRefresh, scrollToFeedTop]);

  useEffect(() => {
    if (scrollToTopSignal > 0) {
      scrollToFeedTop();
    }
  }, [scrollToFeedTop, scrollToTopSignal]);

  const handleFeedPageChange = useCallback((index: number) => {
    const next = feedSourceItems[index];
    if (!next || next.value === feedSource) {
      return;
    }
    scrollToFeedTop(next.value);
    onFeedSourceChange(next.value);
  }, [feedSource, onFeedSourceChange, scrollToFeedTop]);

  const renderTopicItem = useCallback<ListRenderItem<Topic>>(({ item: topic }) => (
    <MemoizedTopicCard
      readerState={getTopicListItemState(readerData, topic, topicListStateInput)}
      styles={styles}
      theme={theme}
      topic={topic}
      onOpenTopic={onOpenTopic}
    />
  ), [onOpenTopic, readerData, styles, theme, topicListStateInput]);
  const categoryItems = useMemo(
    () => feedCategoryItems(categories, feedSource),
    [categories, feedSource]
  );
  const feedEmptyText = readingFilter !== 'all' || Boolean(categoryFilter) || feedSource !== 'all'
    ? '当前筛选没有匹配主题'
    : '暂无主题';

  const renderFeedList = useCallback(({ route }: { route: { key: string } }) => {
    const routeSource = route.key as FeedSource;
    const active = routeSource === feedSource;
    return (
      <FlatList
        ref={(ref) => {
          listRefs.current[routeSource] = ref;
        }}
        style={styles.content}
        contentContainerStyle={styles.feedListContentInner}
        data={active ? feedItems : []}
        keyExtractor={topicKey}
        keyboardShouldPersistTaps="handled"
        refreshControl={active ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
          />
        ) : undefined}
        onScroll={active ? handleScroll : undefined}
        scrollEventThrottle={64}
        onMomentumScrollEnd={active ? saveFeedScrollPosition : undefined}
        onScrollEndDrag={active ? saveFeedScrollPosition : undefined}
        onContentSizeChange={active ? restoreFeedScrollPosition : undefined}
        onEndReachedThreshold={0.6}
        onEndReached={active ? requestFeedLoadMore : undefined}
        {...FEED_LIST_PERFORMANCE_PROPS}
        ListEmptyComponent={active && busy ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : <EmptyText text={active ? feedEmptyText : ''} styles={styles} />}
        ListFooterComponent={active && feedHasMore ? (
          <AppButton
            label={loadingMore ? '正在加载...' : `加载第 ${feedPage + 1} 页`}
            styles={styles}
            disabled={busy || loadingMore}
            onPress={requestFeedLoadMore}
          />
        ) : active && feedItems.length > 0 && !busy ? (
          <Text style={styles.endOfListText}>已经到底了</Text>
        ) : null}
        renderItem={renderTopicItem}
      />
    );
  }, [
    busy,
    feedEmptyText,
    feedHasMore,
    feedItems,
    feedPage,
    feedSource,
    handleScroll,
    loadingMore,
    onRefresh,
    refreshing,
    renderTopicItem,
    requestFeedLoadMore,
    restoreFeedScrollPosition,
    saveFeedScrollPosition,
    styles,
    theme
  ]);

  return (
    <View style={styles.content}>
      <View style={styles.feedFixedHeader}>
        <PillRail
          variant="tabs"
          items={feedSourceItems}
          value={feedSource}
          styles={styles}
          onChange={(value) => onFeedSourceChange(value as FeedSource)}
        />
        {shouldUseReadingFilter(feedSource) ? (
          <PillRail
            items={feedReadingFilterItems}
            value={readingFilter}
            resetScrollKey={secondaryRailResetKey}
            styles={styles}
            onChange={(value) => onReadingFilterChange(value as ReadingFilter)}
          />
        ) : (
          <PillRail
            items={categoryItems}
            value={categoryFilter}
            resetScrollKey={secondaryRailResetKey}
            styles={styles}
            onChange={onCategoryChange}
          />
        )}
      </View>
      <TabView
        style={styles.feedPager}
        navigationState={{ index: activeIndex, routes: feedSourceItems.map((item) => ({ key: item.value, title: item.label })) }}
        renderScene={renderFeedList}
        renderTabBar={() => null}
        onIndexChange={handleFeedPageChange}
      />
      {showFloatingActions ? (
        <View style={styles.feedFloatingActions}>
          <FloatingIconButton icon={RefreshCw} label="刷新" styles={styles} theme={theme} loading={refreshing} disabled={refreshing} onPress={onRefreshPress} />
          <FloatingIconButton icon={ChevronUp} label="回到顶部" styles={styles} theme={theme} onPress={() => scrollToFeedTop()} />
        </View>
      ) : null}
    </View>
  );
}
