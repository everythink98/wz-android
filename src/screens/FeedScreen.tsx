import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { TabView } from 'react-native-tab-view';
import { ChevronUp } from 'lucide-react-native';
import type { Category, FeedSource, Topic } from '../types';
import { topicKey, type ReaderData } from '../readerData';
import { feedCategoryItems, feedReadingFilterItems, feedSourceItems, shouldUseReadingFilter } from '../feedCategoryRail';
import { shouldAllowFeedAutoLoadRequest, shouldLoadMoreFeedFromScroll, shouldShowFeedFloatingActions } from '../feedFloatingActions';
import type { ReadingFilter } from '../feedLogic';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, FloatingIconButton, LoadingState, PillRail } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { FEED_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

const AUTO_LOAD_SCROLL_STEP = 80;

export function FeedScreen({
  busy,
  categories,
  categoryFilter,
  feedHasMore,
  feedItems,
  feedPage,
  feedSource,
  loadMoreFailureSignal,
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
  loadMoreFailureSignal: number;
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
  const listRefs = useRef<Partial<Record<FeedSource, FlashListRef<Topic> | null>>>({});
  const requestedFeedPageRef = useRef<number | null>(null);
  const lastAutoLoadMoreOffsetRef = useRef<number | null>(null);
  const autoLoadPausedAfterFailureRef = useRef(false);
  const pendingScrollTopRef = useRef<Partial<Record<FeedSource, boolean>>>({});
  const [showFloatingActions, setShowFloatingActions] = useState(false);
  const activeIndex = Math.max(0, feedSourceItems.findIndex((item) => item.value === feedSource));
  const secondaryRailResetKey = feedSource;

  const requestFeedLoadMore = useCallback((source: 'button' | 'scroll' = 'button', offsetY = 0) => {
    if (!feedHasMore || busy || loadingMore) {
      return;
    }
    if (source === 'scroll') {
      if (!shouldAllowFeedAutoLoadRequest({
        pausedAfterFailure: autoLoadPausedAfterFailureRef.current,
        lastOffset: lastAutoLoadMoreOffsetRef.current,
        offsetY,
        minStep: AUTO_LOAD_SCROLL_STEP
      })) {
        return;
      }
    }
    const nextPage = feedPage + 1;
    if (requestedFeedPageRef.current === nextPage) {
      return;
    }
    requestedFeedPageRef.current = nextPage;
    if (source === 'button') {
      autoLoadPausedAfterFailureRef.current = false;
    }
    if (source === 'scroll') {
      lastAutoLoadMoreOffsetRef.current = offsetY;
    }
    onLoadMore();
  }, [busy, feedHasMore, feedPage, loadingMore, onLoadMore]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = Math.max(0, event.nativeEvent.contentOffset.y);
    const nextVisible = shouldShowFeedFloatingActions(offsetY);
    setShowFloatingActions((current) => current === nextVisible ? current : nextVisible);
    if (shouldLoadMoreFeedFromScroll(event.nativeEvent)) {
      requestFeedLoadMore('scroll', offsetY);
    }
  }, [requestFeedLoadMore]);

  const handleScrollBeginDrag = useCallback(() => {
    autoLoadPausedAfterFailureRef.current = false;
  }, []);

  useEffect(() => {
    if (!busy && !loadingMore) {
      requestedFeedPageRef.current = null;
    }
  }, [busy, loadingMore]);

  useEffect(() => {
    if (loadMoreFailureSignal > 0) {
      autoLoadPausedAfterFailureRef.current = true;
      lastAutoLoadMoreOffsetRef.current = null;
    }
  }, [loadMoreFailureSignal]);

  const scrollFeedToTop = useCallback((source: FeedSource = feedSource, animated = true) => {
    const listRef = listRefs.current[source];
    if (listRef) {
      listRef.scrollToOffset({ offset: 0, animated });
      pendingScrollTopRef.current[source] = false;
    } else {
      pendingScrollTopRef.current[source] = true;
    }
    setShowFloatingActions(false);
  }, [feedSource]);

  const completePendingFeedScrollReset = useCallback(() => {
    if (pendingScrollTopRef.current[feedSource]) {
      scrollFeedToTop(feedSource, false);
    }
  }, [feedSource, scrollFeedToTop]);

  useEffect(() => {
    requestedFeedPageRef.current = null;
    lastAutoLoadMoreOffsetRef.current = null;
    autoLoadPausedAfterFailureRef.current = false;
    pendingScrollTopRef.current[feedSource] = true;
    scrollFeedToTop(feedSource, false);
  }, [categoryFilter, feedSource, readingFilter, scrollFeedToTop]);

  useEffect(() => {
    if (scrollToTopSignal > 0) {
      scrollFeedToTop();
    }
  }, [scrollFeedToTop, scrollToTopSignal]);

  const handleFeedPageChange = useCallback((index: number) => {
    const next = feedSourceItems[index];
    if (!next || next.value === feedSource) {
      return;
    }
    pendingScrollTopRef.current[next.value] = true;
    scrollFeedToTop(next.value, false);
    onFeedSourceChange(next.value);
  }, [feedSource, onFeedSourceChange, scrollFeedToTop]);

  const renderTopicItem = useCallback<ListRenderItem<Topic>>(({ item: topic }) => (
    <MemoizedTopicCard
      readerState={getTopicListItemState(readerData, topic, topicListStateInput)}
      styles={styles}
      theme={theme}
      topic={topic}
      onOpenTopic={onOpenTopic}
    />
  ), [onOpenTopic, readerData, styles, theme, topicListStateInput]);
  const renderTopicSeparator = useCallback(() => <View style={styles.topicListSeparator} />, [styles]);
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
      <FlashList
        ref={(ref) => {
          listRefs.current[routeSource] = ref;
        }}
        style={styles.content}
        contentContainerStyle={styles.feedListContentInner}
        data={feedItems}
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
        onScrollBeginDrag={active ? handleScrollBeginDrag : undefined}
        scrollEventThrottle={64}
        onContentSizeChange={active ? completePendingFeedScrollReset : undefined}
        {...FEED_LIST_PERFORMANCE_PROPS}
        ListEmptyComponent={active && busy ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : <EmptyText text={active ? feedEmptyText : ''} styles={styles} />}
        ListFooterComponent={active && feedHasMore ? (
          <AppButton
            label={loadingMore ? '正在加载...' : `加载第 ${feedPage + 1} 页`}
            styles={styles}
            disabled={busy || loadingMore}
            onPress={() => requestFeedLoadMore('button')}
          />
        ) : active && feedItems.length > 0 && !busy ? (
          <Text style={styles.endOfListText}>已经到底了</Text>
        ) : null}
        ItemSeparatorComponent={active ? renderTopicSeparator : undefined}
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
    handleScrollBeginDrag,
    loadingMore,
    onRefresh,
    refreshing,
    renderTopicItem,
    renderTopicSeparator,
    requestFeedLoadMore,
    completePendingFeedScrollReset,
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
            variant="subtabs"
            items={feedReadingFilterItems}
            value={readingFilter}
            resetScrollKey={secondaryRailResetKey}
            styles={styles}
            onChange={(value) => onReadingFilterChange(value as ReadingFilter)}
          />
        ) : (
          <PillRail
            variant="subtabs"
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
          <FloatingIconButton icon={ChevronUp} label="回到顶部" styles={styles} theme={theme} onPress={() => scrollFeedToTop()} />
        </View>
      ) : null}
    </View>
  );
}
