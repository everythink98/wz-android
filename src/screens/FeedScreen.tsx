import { createRef, memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Modal, Pressable, RefreshControl, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { TabView } from 'react-native-tab-view';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type { Category, FeedSource, SourceErrorInfo, SourceFeedFilter, SourceLoadOutcomeKind, Topic } from '../types';
import { topicKey } from '../readerData';
import { feedCategoryItems, feedFilterLabel, feedFilterMenuGroupsFor, feedReadingFilterItems, feedSourceItems, shouldUseFeedFilter, shouldUseReadingFilter } from '../feedCategoryRail';
import { shouldAllowFeedAutoLoadRequest, shouldLoadMoreFeedFromScroll, shouldShowFeedFloatingActions } from '../feedFloatingActions';
import type { ReadingFilter } from '../feedLogic';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, FloatingIconButton, LoadingState, PillRail, TOUCH_HIT_SLOP, triggerPressFeedback } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { FEED_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';
import { useCommittedRef } from '../app/useCommittedRef';

const AUTO_LOAD_SCROLL_STEP = 80;
const FEED_PAGER_ROUTES = feedSourceItems.map((item) => ({ key: item.value, title: item.label }));
function renderEmptyTabBar() {
  return null;
}

export const FeedScreen = memo(function FeedScreen({
  busy,
  categories,
  categoryFilter,
  feedHasMore,
  feedItems,
  feedScenePreviews = {},
  feedOutcomeKind,
  feedPage,
  feedFilter,
  feedSource,
  identityChecking = false,
  identityError,
  loadMoreFailureSignal,
  loadingMore,
  topicStateIndex,
  readingFilter,
  refreshing,
  scrollToTopSignal,
  styles,
  theme,
  onCategoryChange,
  onFeedFilterChange,
  onFeedSourceChange,
  onLoadMore,
  onOpenTopic,
  onCheckLinuxDoStatus,
  onRetryIdentity,
  onReadingFilterChange,
  onRefresh
}: {
  busy: boolean;
  categories: Category[];
  categoryFilter: string;
  feedHasMore: boolean;
  feedItems: Topic[];
  feedScenePreviews?: Partial<Record<FeedSource, Topic[]>>;
  feedOutcomeKind?: SourceLoadOutcomeKind;
  feedPage: number;
  feedFilter?: SourceFeedFilter;
  feedSource: FeedSource;
  identityChecking?: boolean;
  identityError?: SourceErrorInfo;
  loadMoreFailureSignal: number;
  loadingMore: boolean;
  topicStateIndex: TopicListItemStateIndex;
  readingFilter: ReadingFilter;
  refreshing: boolean;
  scrollToTopSignal: number;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCategoryChange: (categoryId: string) => void;
  onFeedFilterChange: (filter: SourceFeedFilter) => void;
  onFeedSourceChange: (source: FeedSource) => void;
  onLoadMore: () => void;
  onOpenTopic: (topic: Topic) => void;
  onCheckLinuxDoStatus?: () => void;
  onRetryIdentity?: () => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onRefresh: () => void;
}) {
  const [listRefs] = useState(() => Object.fromEntries(
    feedSourceItems.map((item) => [item.value, createRef<FlashListRef<Topic>>()])
  ) as Record<FeedSource, RefObject<FlashListRef<Topic> | null>>);
  const { width: pagerWidth } = useWindowDimensions();
  const requestedFeedPageRef = useRef<number | null>(null);
  const lastAutoLoadMoreOffsetRef = useRef<number | null>(null);
  const autoLoadPausedAfterFailureRef = useRef(false);
  const pendingScrollTopSourcesRef = useRef(new Set<FeedSource>());
  const [showFloatingActions, setShowFloatingActions] = useState(false);
  const activeFeedSourceIndex = Math.max(0, feedSourceItems.findIndex((item) => item.value === feedSource));
  const [pagerIndex, setPagerIndex] = useState(activeFeedSourceIndex);
  const [settledSceneIndex, setSettledSceneIndex] = useState(activeFeedSourceIndex);
  const activeFeedSourceRef = useCommittedRef(feedSource);
  const pendingSourceResetFramesRef = useRef<Partial<Record<FeedSource, number>>>({});
  const pendingSourceIndexRef = useRef<number | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const secondaryRailResetKey = feedSource;
  const feedNavigationState = useMemo(() => ({ index: pagerIndex, routes: FEED_PAGER_ROUTES }), [pagerIndex]);
  const feedInitialLayout = useMemo(() => ({ width: pagerWidth }), [pagerWidth]);
  const showFeedFilter = shouldUseFeedFilter(feedSource, categoryFilter);
  const activeFeedFilterLabel = feedFilterLabel(feedSource, feedFilter);
  const activeFeedFilterMenuGroups = showFeedFilter ? feedFilterMenuGroupsFor(feedSource) : [];

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

  const scrollFeedSourceToTop = useCallback((source: FeedSource, animated = true) => {
    const list = listRefs[source].current;
    if (list) {
      list.scrollToOffset({ offset: 0, animated });
      pendingScrollTopSourcesRef.current.delete(source);
    } else {
      pendingScrollTopSourcesRef.current.add(source);
    }
    if (source === feedSource) {
      setShowFloatingActions(false);
    }
  }, [feedSource, listRefs]);

  const scrollFeedToTop = useCallback((animated = true) => {
    scrollFeedSourceToTop(feedSource, animated);
  }, [feedSource, scrollFeedSourceToTop]);

  const resetInactiveFeedSourceAfterSettledFrame = useCallback((source: FeedSource) => {
    const pendingFrame = pendingSourceResetFramesRef.current[source];
    if (pendingFrame !== undefined) {
      cancelAnimationFrame(pendingFrame);
    }
    pendingSourceResetFramesRef.current[source] = requestAnimationFrame(() => {
      delete pendingSourceResetFramesRef.current[source];
      if (activeFeedSourceRef.current !== source) {
        scrollFeedSourceToTop(source, false);
      }
    });
  }, [scrollFeedSourceToTop]);

  useEffect(() => () => {
    Object.values(pendingSourceResetFramesRef.current).forEach((frame) => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    });
  }, []);

  const completePendingFeedScrollReset = useCallback((source: FeedSource) => {
    if (pendingScrollTopSourcesRef.current.has(source)) {
      scrollFeedSourceToTop(source, false);
    }
  }, [scrollFeedSourceToTop]);

  const commitFeedSelectionChange = useCallback((commit: () => void) => {
    const source = feedSource;
    scrollFeedSourceToTop(source, false);
    commit();
    requestAnimationFrame(() => scrollFeedSourceToTop(source, false));
  }, [feedSource, scrollFeedSourceToTop]);

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
    if (scrollToTopSignal > 0) {
      scrollFeedToTop();
    }
  }, [scrollFeedToTop, scrollToTopSignal]);

  useEffect(() => {
    setPagerIndex((current) => current === activeFeedSourceIndex ? current : activeFeedSourceIndex);
    setSettledSceneIndex((current) => current === activeFeedSourceIndex ? current : activeFeedSourceIndex);
    pendingSourceIndexRef.current = null;
  }, [activeFeedSourceIndex]);

  const changeFeedSourceAtIndex = useCallback((index: number) => {
    const next = feedSourceItems[index];
    if (!next || index === pagerIndex && pendingSourceIndexRef.current === null) {
      return;
    }
    pendingSourceIndexRef.current = index;
    setPagerIndex(index);
  }, [pagerIndex]);
  const settleFeedSource = useCallback(() => {
    const index = pendingSourceIndexRef.current;
    pendingSourceIndexRef.current = null;
    if (index === null) {
      return;
    }
    const next = feedSourceItems[index];
    if (!next) {
      return;
    }
    setSettledSceneIndex(index);
    if (next.value !== feedSource) {
      activeFeedSourceRef.current = next.value;
      onFeedSourceChange(next.value);
      resetInactiveFeedSourceAfterSettledFrame(feedSource);
    }
  }, [feedSource, onFeedSourceChange, resetInactiveFeedSourceAfterSettledFrame]);
  const changeFeedSourceValue = useCallback((value: string) => {
    changeFeedSourceAtIndex(feedSourceItems.findIndex((item) => item.value === value));
  }, [changeFeedSourceAtIndex]);
  const changeReadingFilter = useCallback((value: string) => {
    const next = value as ReadingFilter;
    if (next !== readingFilter) {
      commitFeedSelectionChange(() => onReadingFilterChange(next));
    }
  }, [commitFeedSelectionChange, onReadingFilterChange, readingFilter]);
  const changeCategoryFilter = useCallback((value: string) => {
    if (value !== categoryFilter) {
      commitFeedSelectionChange(() => onCategoryChange(value));
    }
  }, [categoryFilter, commitFeedSelectionChange, onCategoryChange]);
  const toggleFeedFilterMenu = useCallback(() => {
    triggerPressFeedback();
    setFilterMenuOpen((current) => !current);
  }, []);
  const closeFeedFilterMenu = useCallback(() => {
    setFilterMenuOpen(false);
  }, []);
  const changeFeedFilter = useCallback((value: SourceFeedFilter) => {
    triggerPressFeedback();
    setFilterMenuOpen(false);
    if (value !== feedFilter) {
      commitFeedSelectionChange(() => onFeedFilterChange(value));
    }
  }, [commitFeedSelectionChange, feedFilter, onFeedFilterChange]);
  const scrollFeedToTopPress = useCallback(() => {
    scrollFeedToTop();
  }, [scrollFeedToTop]);

  const renderTopicItem = useCallback<ListRenderItem<Topic>>(({ index, item: topic }) => (
    <MemoizedTopicCard
      feedLayout
      readerState={getTopicListItemStateFromIndex(topicStateIndex, topic)}
      styles={styles}
      testID={index === 0 ? 'feed-topic-first' : undefined}
      theme={theme}
      topic={topic}
      onOpenTopic={onOpenTopic}
    />
  ), [onOpenTopic, styles, theme, topicStateIndex]);
  const renderTopicSeparator = useCallback(() => <View style={styles.topicListSeparator} />, [styles]);
  const categoryItems = useMemo(
    () => feedCategoryItems(categories, feedSource),
    [categories, feedSource]
  );
  const renderFeedFilterItem = useCallback((item: { value: SourceFeedFilter; label: string }, last: boolean) => {
    const active = item.value === feedFilter;
    return (
      <Pressable
        key={item.value}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        hitSlop={TOUCH_HIT_SLOP}
        style={[styles.topicMenuItem, styles.linuxDoFilterMenuItem, active && styles.linuxDoFilterMenuItemActive, last && styles.topicMenuItemLast]}
        onPress={() => changeFeedFilter(item.value)}
      >
        <Text style={[styles.topicMenuItemText, styles.linuxDoFilterMenuItemText, active && styles.linuxDoFilterMenuItemTextActive]}>{item.label}</Text>
      </Pressable>
    );
  }, [changeFeedFilter, feedFilter, styles]);
  const feedFilterMenu = filterMenuOpen ? (
    <Modal transparent animationType="fade" visible={filterMenuOpen} onRequestClose={closeFeedFilterMenu}>
      <View style={styles.topicMenuLayer}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭列表筛选菜单" style={styles.topicMenuDismissLayer} onPress={closeFeedFilterMenu} />
        <View style={styles.linuxDoFilterMenu}>
          {activeFeedFilterMenuGroups.map((group, groupIndex) => (
            <View key={group.title || `group-${groupIndex}`}>
              {group.title ? <Text style={styles.linuxDoFilterMenuSectionText}>{group.title}</Text> : null}
              {group.items.map((item, itemIndex) => renderFeedFilterItem(
                item,
                groupIndex === activeFeedFilterMenuGroups.length - 1 && itemIndex === group.items.length - 1
              ))}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  ) : null;
  const feedEmptyText = readingFilter !== 'all' || Boolean(categoryFilter) || feedSource !== 'all'
    ? '当前筛选没有匹配主题'
    : '暂无主题';
  const renderFeedScene = useCallback(({ route }: { route: { key: string } }) => {
    const routeIndex = feedSourceItems.findIndex((item) => item.value === route.key);
    const routeSource = feedSourceItems[routeIndex]?.value;
    const inMaterializedWindow = Math.abs(routeIndex - settledSceneIndex) <= 1;
    if (!routeSource || !inMaterializedWindow) {
      return (
        <View style={styles.content}>
          <LoadingState text="正在读取主题..." styles={styles} theme={theme} />
        </View>
      );
    }
    const live = routeSource === feedSource && routeIndex === settledSceneIndex;
    const previewItems = feedScenePreviews[routeSource];
    if (!live && previewItems === undefined) {
      return (
        <View style={styles.content}>
          <LoadingState text="正在读取主题..." styles={styles} theme={theme} />
        </View>
      );
    }
    const sceneItems = live ? feedItems : previewItems || [];
    const identityNotice = identityError ? (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{identityError.message}</Text>
        <View style={styles.actions}>
          <AppButton label="重试检测" styles={styles} onPress={onRetryIdentity || onRefresh} />
          {feedSource === 'linuxdo' && onCheckLinuxDoStatus
            ? <AppButton label="检查 L 站状态" variant="ghost" styles={styles} onPress={onCheckLinuxDoStatus} />
            : null}
        </View>
      </View>
    ) : identityChecking ? (
      <LoadingState text="正在确认 L 站访问状态" styles={styles} theme={theme} />
    ) : null;
    const sceneEmptyText = routeSource === 'all' && readingFilter === 'all'
      ? '暂无主题'
      : '当前筛选没有匹配主题';
    return (
      <FlashList
        testID={live
          ? !busy && feedOutcomeKind
            ? `feed-outcome-${feedOutcomeKind}-${feedSource}-${feedFilter ?? 'default'}`
            : undefined
          : `feed-preview-${routeSource}`}
        ref={listRefs[routeSource]}
        style={styles.content}
        contentContainerStyle={styles.feedListContentInner}
        data={sceneItems}
        keyExtractor={topicKey}
        keyboardShouldPersistTaps="handled"
        pointerEvents={live ? 'auto' : 'none'}
        accessibilityElementsHidden={!live}
        importantForAccessibility={live ? 'auto' : 'no-hide-descendants'}
        scrollEnabled={live}
        refreshControl={!live || busy && feedItems.length === 0 ? undefined : (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
          />
        )}
        onScroll={live ? handleScroll : undefined}
        onScrollBeginDrag={live ? handleScrollBeginDrag : undefined}
        scrollEventThrottle={64}
        onContentSizeChange={live ? () => completePendingFeedScrollReset(routeSource) : undefined}
        {...FEED_LIST_PERFORMANCE_PROPS}
        ListHeaderComponent={live ? identityNotice : null}
        ListEmptyComponent={live && identityNotice ? null : live && busy
          ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} />
          : <EmptyText text={live ? feedEmptyText : sceneEmptyText} styles={styles} />}
        ListFooterComponent={!live ? null : feedHasMore ? (
          <AppButton
            label={loadingMore ? '正在加载...' : `加载第 ${feedPage + 1} 页`}
            styles={styles}
            disabled={busy || loadingMore}
            onPress={() => requestFeedLoadMore('button')}
          />
        ) : sceneItems.length > 0 && !busy ? (
          <Text style={styles.endOfListText}>已经到底了</Text>
        ) : null}
        ItemSeparatorComponent={renderTopicSeparator}
        renderItem={renderTopicItem}
      />
    );
  }, [
    busy,
    categoryFilter,
    completePendingFeedScrollReset,
    feedEmptyText,
    feedFilter,
    feedHasMore,
    feedItems,
    feedScenePreviews,
    feedOutcomeKind,
    feedPage,
    feedSource,
    identityChecking,
    identityError,
    handleScroll,
    handleScrollBeginDrag,
    loadingMore,
    listRefs,
    onCheckLinuxDoStatus,
    onRefresh,
    onRetryIdentity,
    settledSceneIndex,
    refreshing,
    readingFilter,
    renderTopicItem,
    renderTopicSeparator,
    requestFeedLoadMore,
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
          testIDPrefix="feed-source"
          styles={styles}
          onChange={changeFeedSourceValue}
        />
        {shouldUseReadingFilter(feedSource) ? (
          <PillRail
            variant="subtabs"
            items={feedReadingFilterItems}
            value={readingFilter}
            resetScrollKey={secondaryRailResetKey}
            styles={styles}
            onChange={changeReadingFilter}
          />
        ) : showFeedFilter ? (
          <View style={styles.feedSecondaryRow}>
            <View style={styles.feedCategoryRailSlot}>
              <PillRail
                variant="subtabs"
                items={categoryItems}
                value={categoryFilter}
                resetScrollKey={secondaryRailResetKey}
                styles={styles}
                onChange={changeCategoryFilter}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="列表筛选"
              accessibilityState={{ expanded: filterMenuOpen }}
              hitSlop={TOUCH_HIT_SLOP}
              style={({ pressed }) => [styles.linuxDoFilterButton, pressed && styles.linuxDoFilterButtonPressed]}
              onPress={toggleFeedFilterMenu}
            >
              <Text style={styles.linuxDoFilterButtonText} numberOfLines={1}>{activeFeedFilterLabel}</Text>
              <ChevronDown size={14} color={theme.primary} strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : (
          <PillRail
            variant="subtabs"
            items={categoryItems}
            value={categoryFilter}
            resetScrollKey={secondaryRailResetKey}
            styles={styles}
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
        renderScene={renderFeedScene}
        renderTabBar={renderEmptyTabBar}
        onIndexChange={changeFeedSourceAtIndex}
        onSwipeEnd={settleFeedSource}
      />
      {showFloatingActions ? (
        <View style={styles.feedFloatingActions}>
          <FloatingIconButton icon={ChevronUp} label="回到顶部" styles={styles} theme={theme} onPress={scrollFeedToTopPress} />
        </View>
      ) : null}
    </View>
  );
});
