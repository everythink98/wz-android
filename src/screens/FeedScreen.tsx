import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlatList, PanResponder, Text, View, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ChevronUp, RefreshCw } from 'lucide-react-native';
import type { Category, FeedSource, Topic } from '../types';
import { topicKey, type ReaderData } from '../readerData';
import { feedCategoryItems, feedReadingFilterItems, feedSourceItems, shouldUseReadingFilter } from '../feedCategoryRail';
import { shouldLoadMoreFeedFromScroll, shouldShowFeedFloatingActions } from '../feedFloatingActions';
import type { ReadingFilter } from '../feedLogic';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, FloatingIconButton, LoadingState, PillRail } from '../components/AppControls';
import { MemoizedTopicCard, type TopicSwipeActionConfig } from '../components/TopicCard';
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
  styles,
  theme,
  onCategoryChange,
  onFeedSourceChange,
  onLoadMore,
  onOpenTopic,
  onReadingFilterChange,
  onRefresh,
  onToggleFavorite
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
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCategoryChange: (categoryId: string) => void;
  onFeedSourceChange: (source: FeedSource) => void;
  onLoadMore: () => void;
  onOpenTopic: (topic: Topic) => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onRefresh: () => void;
  onToggleFavorite: (topic: Topic) => void;
}) {
  const listRef = useRef<FlatList<Topic>>(null);
  const requestedFeedPageRef = useRef<number | null>(null);
  const pendingScrollOffsetRef = useRef<number | null>(null);
  const scrollStorageKey = useMemo(() => feedScrollStorageKey(feedSource, categoryFilter, readingFilter), [categoryFilter, feedSource, readingFilter]);
  const [showFloatingActions, setShowFloatingActions] = useState(false);
  const [scrollRestoreReady, setScrollRestoreReady] = useState(false);
  const [rowSwipeActive, setRowSwipeActive] = useState(false);
  const [swipeOpenKey, setSwipeOpenKey] = useState<string | undefined>();

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
    pendingScrollOffsetRef.current = null;
    setScrollRestoreReady(false);
    let active = true;
    AsyncStorage.getItem(scrollStorageKey)
      .then((value) => {
        if (!active) {
          return;
        }
        const offset = Number(value || 0);
        if (Number.isFinite(offset) && offset > 0) {
          pendingScrollOffsetRef.current = offset;
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
  }, [scrollStorageKey]);

  const restoreFeedScrollPosition = useCallback(() => {
    const offset = pendingScrollOffsetRef.current;
    if (scrollRestoreReady && offset && feedItems.length) {
      pendingScrollOffsetRef.current = null;
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset, animated: false }));
    }
  }, [feedItems.length, scrollRestoreReady]);

  useEffect(() => {
    restoreFeedScrollPosition();
  }, [restoreFeedScrollPosition]);

  useEffect(() => {
    setSwipeOpenKey(undefined);
    setRowSwipeActive(false);
  }, [categoryFilter, feedSource, readingFilter]);

  const scrollToTop = useCallback(() => {
    setSwipeOpenKey(undefined);
    setRowSwipeActive(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setShowFloatingActions(false);
  }, []);
  const switchFeedSourceBySwipe = useCallback((direction: 1 | -1) => {
    const index = feedSourceItems.findIndex((item) => item.value === feedSource);
    const next = feedSourceItems[index + direction];
    if (next) {
      setSwipeOpenKey(undefined);
      setRowSwipeActive(false);
      onFeedSourceChange(next.value);
    }
  }, [feedSource, onFeedSourceChange]);
  const pagePanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      !rowSwipeActive
      && Math.abs(gesture.dx) >= 52
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.8
    ),
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) < 72 && Math.abs(gesture.vx) < 0.45) {
        return;
      }
      switchFeedSourceBySwipe(gesture.dx < 0 ? 1 : -1);
    }
  }), [rowSwipeActive, switchFeedSourceBySwipe]);
  const favoriteSwipeAction = useMemo<TopicSwipeActionConfig>(() => ({
    kind: 'favorite',
    onPress: onToggleFavorite
  }), [onToggleFavorite]);

  const renderTopicItem = useCallback<ListRenderItem<Topic>>(({ item: topic }) => (
    <MemoizedTopicCard
      readerState={getTopicListItemState(readerData, topic, topicListStateInput)}
      styles={styles}
      theme={theme}
      topic={topic}
      onOpenTopic={onOpenTopic}
      swipeAction={favoriteSwipeAction}
      swipeOpenKey={swipeOpenKey}
      onSwipeActiveChange={setRowSwipeActive}
      onSwipeClose={() => setSwipeOpenKey((current) => current === topicKey(topic) ? undefined : current)}
      onSwipeOpen={setSwipeOpenKey}
    />
  ), [favoriteSwipeAction, onOpenTopic, readerData, styles, swipeOpenKey, theme, topicListStateInput]);
  const categoryItems = useMemo(
    () => feedCategoryItems(categories, feedSource),
    [categories, feedSource]
  );

  const header = (
    <View style={styles.stack}>
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
          styles={styles}
          onChange={(value) => onReadingFilterChange(value as ReadingFilter)}
        />
      ) : (
        <PillRail
          items={categoryItems}
          value={categoryFilter}
          styles={styles}
          onChange={onCategoryChange}
        />
      )}
    </View>
  );
  const feedEmptyText = readingFilter !== 'all' || Boolean(categoryFilter) || feedSource !== 'all'
    ? '当前筛选没有匹配主题'
    : '暂无主题';

  return (
    <View style={styles.content} {...pagePanResponder.panHandlers}>
      <FlatList
        ref={listRef}
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        data={feedItems}
        keyExtractor={topicKey}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!rowSwipeActive}
        onScrollBeginDrag={() => {
          setSwipeOpenKey(undefined);
          setRowSwipeActive(false);
        }}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onMomentumScrollEnd={saveFeedScrollPosition}
        onScrollEndDrag={saveFeedScrollPosition}
        onContentSizeChange={restoreFeedScrollPosition}
        onEndReachedThreshold={0.6}
        onEndReached={requestFeedLoadMore}
        {...FEED_LIST_PERFORMANCE_PROPS}
        ListHeaderComponent={header}
        ListEmptyComponent={busy ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : <EmptyText text={feedEmptyText} styles={styles} />}
        ListFooterComponent={feedHasMore ? (
          <AppButton
            label={loadingMore ? '正在加载...' : `加载第 ${feedPage + 1} 页`}
            styles={styles}
            disabled={busy || loadingMore}
            onPress={requestFeedLoadMore}
          />
        ) : feedItems.length > 0 && !busy ? (
          <Text style={styles.endOfListText}>已经到底了</Text>
        ) : null}
        renderItem={renderTopicItem}
      />
      {showFloatingActions ? (
        <View style={styles.feedFloatingActions}>
          <FloatingIconButton icon={RefreshCw} label="刷新" styles={styles} theme={theme} loading={refreshing} disabled={refreshing} onPress={onRefresh} />
          <FloatingIconButton icon={ChevronUp} label="回到顶部" styles={styles} theme={theme} onPress={scrollToTop} />
        </View>
      ) : null}
    </View>
  );
}
