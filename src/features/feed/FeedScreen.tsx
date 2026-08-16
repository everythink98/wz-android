import { createFeedStyles } from './styles';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Pressable,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { TabView } from 'react-native-tab-view';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type {
  Category,
  FeedFilterState,
  FeedSource,
  Source,
  SourceFeedFilter,
  SourceLoadOutcomeKind,
  Topic
} from '@/domain/forum/models';
import { topicKey } from '@/domain/reader/readerData';
import {
  feedCategoryItems,
  feedFilterLabel,
  feedFilterMenuGroupsFor,
  feedReadingFilterItems,
  shouldUseFeedFilter,
  shouldUseReadingFilter
} from '@/domain/forum/feedOptions';
import {
  shouldAllowFeedAutoLoadRequest,
  shouldLoadMoreFeedFromScroll,
  shouldShowFeedFloatingActions
} from './floatingActions';
import type { ReadingFilter } from '@/domain/forum/feed';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton, FloatingIconButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOUCH_HIT_SLOP, triggerPressFeedback } from '@/ui/controls/pressFeedback';
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { FEED_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { isFeedFilterSource } from '@/domain/forum/sourceCatalog';
import { sourceLabel } from '@/domain/forum/presentation';

const AUTO_LOAD_SCROLL_STEP = 80;
function renderEmptyTabBar() {
  return null;
}

export const FeedScreen = memo(function FeedScreen({
  busy,
  categories,
  categoryFilter,
  feedHasMore,
  feedItems,
  feedOutcomeKind,
  feedPage,
  feedFilter,
  feedFilters,
  feedSource,
  enabledFeedSources,
  loadMoreFailureSignal,
  loadingMore,
  topicStateIndex,
  readingFilter,
  refreshing,
  scrollRef,
  onCategoryChange,
  onFeedFilterChange,
  onFeedSourceChange,
  onInitialContentReady,
  onManageContentSources,
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
  feedOutcomeKind?: SourceLoadOutcomeKind;
  feedPage: number;
  feedFilter?: SourceFeedFilter;
  feedFilters: FeedFilterState;
  feedSource: FeedSource;
  enabledFeedSources: readonly Source[];
  loadMoreFailureSignal: number;
  loadingMore: boolean;
  topicStateIndex: TopicListItemStateIndex;
  readingFilter: ReadingFilter;
  refreshing: boolean;
  scrollRef?: RefObject<FlashListRef<Topic> | null>;
  onCategoryChange: (categoryId: string) => void;
  onFeedFilterChange: (filter: SourceFeedFilter) => void;
  onFeedSourceChange: (source: FeedSource) => void;
  onInitialContentReady?: () => void;
  onManageContentSources: () => void;
  onLoadMore: () => void;
  onOpenTopic: (topic: Topic) => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onRefresh: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createFeedStyles);
  const internalListRef = useRef<FlashListRef<Topic>>(null);
  const listRef = scrollRef || internalListRef;
  const { width: pagerWidth } = useWindowDimensions();
  const requestedFeedPageRef = useRef<number | null>(null);
  const lastAutoLoadMoreOffsetRef = useRef<number | null>(null);
  const autoLoadPausedAfterFailureRef = useRef(false);
  const [showFloatingActions, setShowFloatingActions] = useState(false);
  const enabledFeedSourceItems = useMemo(
    () => [
      { value: 'all' as const, label: '全部' },
      ...enabledFeedSources.map((source) => ({ value: source, label: sourceLabel(source) }))
    ],
    [enabledFeedSources]
  );
  const allSourcesDisabled = enabledFeedSources.length === 0;
  const initialListLoadedRef = useRef(false);
  const initialContentReadyReportedRef = useRef(false);
  const initialContentTerminal = !busy && (allSourcesDisabled || Boolean(feedOutcomeKind));
  const reportInitialContentReady = useCallback(() => {
    if (initialContentReadyReportedRef.current) return;
    initialContentReadyReportedRef.current = true;
    onInitialContentReady?.();
  }, [onInitialContentReady]);
  const handleInitialListLoad = useCallback(() => {
    initialListLoadedRef.current = true;
    if (initialContentTerminal) reportInitialContentReady();
  }, [initialContentTerminal, reportInitialContentReady]);
  useEffect(() => {
    if (initialListLoadedRef.current && initialContentTerminal) reportInitialContentReady();
  }, [initialContentTerminal, reportInitialContentReady]);
  const visibleFeedItems = useMemo(() => (allSourcesDisabled ? [] : feedItems), [allSourcesDisabled, feedItems]);
  const activeFeedSourceIndex = Math.max(
    0,
    enabledFeedSourceItems.findIndex((item) => item.value === feedSource)
  );
  const [pagerIndex, setPagerIndex] = useState(activeFeedSourceIndex);
  const visualFeedSource = enabledFeedSourceItems[pagerIndex]?.value || feedSource;
  const visualCategoryFilter = visualFeedSource === feedSource ? categoryFilter : '';
  const visualFeedFilter =
    visualFeedSource !== 'all' && isFeedFilterSource(visualFeedSource) ? feedFilters[visualFeedSource] : undefined;
  const sourceSelectionPending = visualFeedSource !== feedSource;
  const pendingSourceIndexRef = useRef<number | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const secondaryRailResetKey = visualFeedSource;
  const feedNavigationState = useMemo(
    () => ({
      index: pagerIndex,
      routes: enabledFeedSourceItems.map((item) => ({ key: item.value, title: item.label }))
    }),
    [enabledFeedSourceItems, pagerIndex]
  );
  const feedInitialLayout = useMemo(() => ({ width: pagerWidth }), [pagerWidth]);
  const showFeedFilter = shouldUseFeedFilter(visualFeedSource, visualCategoryFilter);
  const activeFeedFilterLabel = feedFilterLabel(visualFeedSource, visualFeedFilter);
  const activeFeedFilterMenuGroups = showFeedFilter ? feedFilterMenuGroupsFor(visualFeedSource) : [];

  const requestFeedLoadMore = useCallback(
    (source: 'button' | 'scroll' = 'button', offsetY = 0) => {
      if (!feedHasMore || busy || loadingMore) {
        return;
      }
      if (source === 'scroll') {
        if (
          !shouldAllowFeedAutoLoadRequest({
            pausedAfterFailure: autoLoadPausedAfterFailureRef.current,
            lastOffset: lastAutoLoadMoreOffsetRef.current,
            offsetY,
            minStep: AUTO_LOAD_SCROLL_STEP
          })
        ) {
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
    },
    [busy, feedHasMore, feedPage, loadingMore, onLoadMore]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = Math.max(0, event.nativeEvent.contentOffset.y);
      const nextVisible = shouldShowFeedFloatingActions(offsetY);
      setShowFloatingActions((current) => (current === nextVisible ? current : nextVisible));
      if (shouldLoadMoreFeedFromScroll(event.nativeEvent)) {
        requestFeedLoadMore('scroll', offsetY);
      }
    },
    [requestFeedLoadMore]
  );

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

  const scrollFeedToTop = useCallback(
    (animated = true) => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
      setShowFloatingActions(false);
    },
    [listRef]
  );

  const commitFeedSelectionChange = useCallback(
    (commit: () => void) => {
      scrollFeedToTop(false);
      commit();
      requestAnimationFrame(() => scrollFeedToTop(false));
    },
    [scrollFeedToTop]
  );

  useEffect(() => {
    requestedFeedPageRef.current = null;
    lastAutoLoadMoreOffsetRef.current = null;
    autoLoadPausedAfterFailureRef.current = false;
  }, [categoryFilter, feedFilter, feedSource, readingFilter]);

  useEffect(() => {
    if (!showFeedFilter) {
      setFilterMenuOpen(false);
    }
  }, [showFeedFilter]);

  useEffect(() => {
    setPagerIndex((current) => (current === activeFeedSourceIndex ? current : activeFeedSourceIndex));
    pendingSourceIndexRef.current = null;
  }, [activeFeedSourceIndex]);

  const changeFeedSourceAtIndex = useCallback(
    (index: number) => {
      const next = enabledFeedSourceItems[index];
      if (!next || (index === pagerIndex && pendingSourceIndexRef.current === null)) {
        return;
      }
      pendingSourceIndexRef.current = index;
      setFilterMenuOpen(false);
      setPagerIndex(index);
    },
    [enabledFeedSourceItems, pagerIndex]
  );
  const settleFeedSource = useCallback(() => {
    const index = pendingSourceIndexRef.current;
    pendingSourceIndexRef.current = null;
    if (index === null) {
      return;
    }
    const next = enabledFeedSourceItems[index];
    if (!next) {
      return;
    }
    if (next.value !== feedSource) {
      onFeedSourceChange(next.value);
    }
  }, [enabledFeedSourceItems, feedSource, onFeedSourceChange]);
  const changeFeedSourceValue = useCallback(
    (value: string) => {
      changeFeedSourceAtIndex(enabledFeedSourceItems.findIndex((item) => item.value === value));
    },
    [changeFeedSourceAtIndex, enabledFeedSourceItems]
  );
  const changeReadingFilter = useCallback(
    (value: string) => {
      if (sourceSelectionPending) {
        return;
      }
      const next = value as ReadingFilter;
      if (next !== readingFilter) {
        commitFeedSelectionChange(() => onReadingFilterChange(next));
      }
    },
    [commitFeedSelectionChange, onReadingFilterChange, readingFilter, sourceSelectionPending]
  );
  const changeCategoryFilter = useCallback(
    (value: string) => {
      if (sourceSelectionPending) {
        return;
      }
      if (value !== categoryFilter) {
        commitFeedSelectionChange(() => onCategoryChange(value));
      }
    },
    [categoryFilter, commitFeedSelectionChange, onCategoryChange, sourceSelectionPending]
  );
  const toggleFeedFilterMenu = useCallback(() => {
    if (sourceSelectionPending) {
      return;
    }
    triggerPressFeedback();
    setFilterMenuOpen((current) => !current);
  }, [sourceSelectionPending]);
  const closeFeedFilterMenu = useCallback(() => {
    setFilterMenuOpen(false);
  }, []);
  const changeFeedFilter = useCallback(
    (value: SourceFeedFilter) => {
      if (sourceSelectionPending) {
        return;
      }
      triggerPressFeedback();
      setFilterMenuOpen(false);
      if (value !== feedFilter) {
        commitFeedSelectionChange(() => onFeedFilterChange(value));
      }
    },
    [commitFeedSelectionChange, feedFilter, onFeedFilterChange, sourceSelectionPending]
  );
  const scrollFeedToTopPress = useCallback(() => {
    scrollFeedToTop();
  }, [scrollFeedToTop]);

  const renderTopicItem = useCallback<ListRenderItem<Topic>>(
    ({ index, item: topic }) => (
      <MemoizedTopicCard
        readerState={getTopicListItemStateFromIndex(topicStateIndex, topic)}
        testID={index === 0 ? 'feed-topic-first' : undefined}
        topic={topic}
        onOpenTopic={onOpenTopic}
      />
    ),
    [onOpenTopic, topicStateIndex]
  );
  const renderTopicSeparator = useCallback(() => <View style={styles.topicListSeparator} />, [styles]);
  const categoryItems = useMemo(() => feedCategoryItems(categories, visualFeedSource), [categories, visualFeedSource]);
  const renderFeedFilterItem = useCallback(
    (item: { value: SourceFeedFilter; label: string }, last: boolean) => {
      const active = item.value === visualFeedFilter;
      return (
        <PopupMenuItem
          key={item.value}
          compact
          label={item.label}
          last={last}
          selected={active}
          onPress={() => changeFeedFilter(item.value)}
        />
      );
    },
    [changeFeedFilter, visualFeedFilter]
  );
  const feedFilterMenu = filterMenuOpen ? (
    <PopupMenu
      accessibilityLabel="关闭列表筛选菜单"
      placementStyle={styles.linuxDoFilterMenu}
      visible={filterMenuOpen}
      onRequestClose={closeFeedFilterMenu}
    >
      {activeFeedFilterMenuGroups.map((group, groupIndex) => (
        <View key={group.title || `group-${groupIndex}`}>
          {group.title ? <Text style={styles.linuxDoFilterMenuSectionText}>{group.title}</Text> : null}
          {group.items.map((item, itemIndex) =>
            renderFeedFilterItem(
              item,
              groupIndex === activeFeedFilterMenuGroups.length - 1 && itemIndex === group.items.length - 1
            )
          )}
        </View>
      ))}
    </PopupMenu>
  ) : null;
  const feedEmptyText =
    readingFilter !== 'all' || Boolean(categoryFilter) || feedSource !== 'all' ? '当前筛选没有匹配主题' : '暂无主题';
  const renderFeedLoadingScene = useCallback(
    () => (
      <View style={styles.content}>
        <LoadingState text="正在读取主题..." />
      </View>
    ),
    [styles]
  );
  const renderFeedScene = useCallback(
    ({ route }: { route: { key: string } }) => {
      const routeSource = enabledFeedSourceItems.find((item) => item.value === route.key)?.value;
      if (!routeSource || routeSource !== feedSource) {
        return renderFeedLoadingScene();
      }
      if (visibleFeedItems.length === 0 && busy) {
        return (
          <View style={styles.content}>
            <LoadingState text="正在读取主题..." />
          </View>
        );
      }
      return (
        <FlashList
          testID={
            !busy && feedOutcomeKind
              ? `feed-outcome-${feedOutcomeKind}-${feedSource}-${feedFilter ?? 'default'}`
              : undefined
          }
          ref={listRef}
          style={styles.content}
          contentContainerStyle={styles.feedListContentInner}
          data={visibleFeedItems}
          keyExtractor={topicKey}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            allSourcesDisabled || (busy && visibleFeedItems.length === 0) ? undefined : (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[theme.primary]}
                tintColor={theme.primary}
              />
            )
          }
          onScroll={handleScroll}
          onLoad={handleInitialListLoad}
          onScrollBeginDrag={handleScrollBeginDrag}
          scrollEventThrottle={64}
          {...FEED_LIST_PERFORMANCE_PROPS}
          ListEmptyComponent={
            busy ? (
              <LoadingState text="正在读取主题..." />
            ) : allSourcesDisabled ? (
              <View>
                <EmptyText text="尚未启用内容源" />
                <View style={styles.actions}>
                  <AppButton label="前往更多管理" onPress={onManageContentSources} />
                </View>
              </View>
            ) : (
              <EmptyText text={feedEmptyText} />
            )
          }
          ListFooterComponent={
            feedHasMore ? (
              <AppButton
                label={loadingMore ? '正在加载...' : `加载第 ${feedPage + 1} 页`}
                disabled={busy || loadingMore}
                onPress={() => requestFeedLoadMore('button')}
              />
            ) : visibleFeedItems.length > 0 && !busy ? (
              <Text style={styles.endOfListText}>已经到底了</Text>
            ) : null
          }
          ItemSeparatorComponent={renderTopicSeparator}
          renderItem={renderTopicItem}
        />
      );
    },
    [
      busy,
      allSourcesDisabled,
      enabledFeedSourceItems,
      feedEmptyText,
      feedFilter,
      feedHasMore,
      feedOutcomeKind,
      feedPage,
      feedSource,
      handleScroll,
      handleScrollBeginDrag,
      listRef,
      loadingMore,
      handleInitialListLoad,
      onManageContentSources,
      onRefresh,
      refreshing,
      renderFeedLoadingScene,
      renderTopicItem,
      renderTopicSeparator,
      requestFeedLoadMore,
      styles,
      theme,
      visibleFeedItems
    ]
  );

  return (
    <View style={styles.content}>
      <View style={styles.feedFixedHeader}>
        <PillRail
          compactTabs
          variant="tabs"
          items={enabledFeedSourceItems}
          value={visualFeedSource}
          testIDPrefix="feed-source"
          onChange={changeFeedSourceValue}
        />
        {shouldUseReadingFilter(visualFeedSource) ? (
          <PillRail
            disabled={sourceSelectionPending}
            variant="subtabs"
            items={feedReadingFilterItems}
            value={readingFilter}
            resetScrollKey={secondaryRailResetKey}
            onChange={changeReadingFilter}
          />
        ) : showFeedFilter ? (
          <View style={styles.feedSecondaryRow}>
            <View style={styles.feedCategoryRailSlot}>
              <PillRail
                disabled={sourceSelectionPending}
                variant="subtabs"
                items={categoryItems}
                value={visualCategoryFilter}
                resetScrollKey={secondaryRailResetKey}
                onChange={changeCategoryFilter}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="列表筛选"
              accessibilityState={
                sourceSelectionPending ? { disabled: true, expanded: filterMenuOpen } : { expanded: filterMenuOpen }
              }
              disabled={sourceSelectionPending || undefined}
              hitSlop={TOUCH_HIT_SLOP}
              style={({ pressed }) => [styles.linuxDoFilterButton, pressed && styles.linuxDoFilterButtonPressed]}
              onPress={toggleFeedFilterMenu}
            >
              <Text style={styles.linuxDoFilterButtonText} numberOfLines={1}>
                {activeFeedFilterLabel}
              </Text>
              <ChevronDown size={14} color={theme.primary} strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : (
          <PillRail
            disabled={sourceSelectionPending}
            variant="subtabs"
            items={categoryItems}
            value={visualCategoryFilter}
            resetScrollKey={secondaryRailResetKey}
            onChange={changeCategoryFilter}
          />
        )}
      </View>
      {feedFilterMenu}
      <TabView
        style={styles.feedPager}
        initialLayout={feedInitialLayout}
        lazy
        lazyPreloadDistance={1}
        navigationState={feedNavigationState}
        renderLazyPlaceholder={renderFeedLoadingScene}
        renderScene={renderFeedScene}
        renderTabBar={renderEmptyTabBar}
        onIndexChange={changeFeedSourceAtIndex}
        onSwipeEnd={settleFeedSource}
      />
      {showFloatingActions ? (
        <View style={styles.feedFloatingActions}>
          <FloatingIconButton icon={ChevronUp} label="回到顶部" onPress={scrollFeedToTopPress} />
        </View>
      ) : null}
    </View>
  );
});
