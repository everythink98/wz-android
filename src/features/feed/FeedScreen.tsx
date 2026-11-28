import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { createFeedStyles } from './styles';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SetStateAction
} from 'react';
import {
  Animated as NativeAnimated,
  I18nManager,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { RefreshControl, ScrollView } from 'react-native-gesture-handler';
import { TabBar, TabView, type TabBarProps } from 'react-native-tab-view';
import { ChevronDown, SquarePen } from 'lucide-react-native';
import Animated from 'react-native-reanimated';
import { useScrollActionVisibility } from '@/ui/hooks/useScrollActionVisibility';
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
import { shouldLoadMoreFeedFromScroll } from './floatingActions';
import { createFeedPageRequests } from './feedPageRequests';
import type { ReadingFilter } from '@/domain/forum/feed';
import type { TopicListItemStateSource } from '@/domain/forum/topicListItemState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton, FloatingIconButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState, RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';
import { TopicListCard, TopicListPlaceholder, TopicListSeparator } from '@/ui/topic/TopicCard';
import { FEED_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { sourceLabel } from '@/domain/forum/presentation';
import { isFeedFilterSource } from '@/domain/forum/sourceCatalog';
import { NavigationBackdropTarget, NavigationGlass } from '@/ui/navigation/NavigationGlass';
import { LoadingCover } from '@/ui/controls/ContentLoadingPlaceholder';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';

const AUTO_LOAD_SCROLL_STEP = 80;
const FeedPager = memo(TabView);
const FeedListPlaceholder = memo(TopicListPlaceholder);
const FeedRouteFocused = createContext(true);

export const FeedScreen = memo(function FeedScreen({
  active = true,
  busy,
  categories,
  categoryFilter,
  feedHasMore,
  feedManualContinuation,
  feedItems,
  feedOutcomeKind,
  feedPage,
  feedFilter,
  feedFilters,
  feedSource,
  isRouteFocused,
  enabledFeedSources,
  failedFeedSources,
  loadMoreFailureSignal,
  loadMoreErrorMessage,
  loadingMore,
  topicStateIndex,
  readingFilter,
  refreshing,
  scrollRef,
  onCategoryChange,
  onCreateTopic,
  onFeedFilterChange,
  onFeedSourceChange,
  onInitialContentReady,
  onManageContentSources,
  onLoadMore,
  onOpenTopic,
  onReadingFilterChange,
  onRefresh
}: {
  active?: boolean;
  busy: boolean;
  categories: Category[];
  categoryFilter: string;
  feedHasMore: boolean;
  feedManualContinuation?: boolean;
  feedItems: Topic[];
  feedOutcomeKind?: SourceLoadOutcomeKind;
  feedPage: number;
  feedFilter?: SourceFeedFilter;
  feedFilters: Readonly<FeedFilterState>;
  feedSource: FeedSource;
  isRouteFocused?: () => boolean;
  enabledFeedSources: readonly Source[];
  failedFeedSources?: readonly Source[];
  loadMoreFailureSignal: number;
  loadMoreErrorMessage?: string;
  loadingMore: boolean;
  topicStateIndex: TopicListItemStateSource;
  readingFilter: ReadingFilter;
  refreshing: boolean;
  scrollRef?: RefObject<FlashListRef<Topic> | null>;
  onCategoryChange: (categoryId: string) => void;
  onCreateTopic?: () => void;
  onFeedFilterChange: (filter: SourceFeedFilter) => void;
  onFeedSourceChange: (source: FeedSource) => void;
  onInitialContentReady?: () => void;
  onManageContentSources: () => void;
  onLoadMore: () => void | Promise<unknown>;
  onOpenTopic: (topic: Topic) => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onRefresh: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createFeedStyles);
  const bottomBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const screenActive = active;
  const [feedBackdrop, setFeedBackdrop] = useState<{ source: FeedSource; view: View } | null>(null);
  const backdropView = feedBackdrop?.source === feedSource ? feedBackdrop.view : null;
  const setBackdropView = useCallback(
    (update: SetStateAction<View | null>) => {
      setFeedBackdrop((current) => {
        const previous = current?.source === feedSource ? current.view : null;
        const view = typeof update === 'function' ? update(previous) : update;
        if (view === previous) return current;
        return view ? { source: feedSource, view } : null;
      });
    },
    [feedSource]
  );
  const [sourceHeaderHeight, setSourceHeaderHeight] = useState(
    styles.feedFixedHeader.paddingTop + styles.feedSourceTab.minHeight
  );
  const [secondaryHeaderHeight, setSecondaryHeaderHeight] = useState(48);
  const internalListRef = useRef<FlashListRef<Topic>>(null);
  const listRef = scrollRef || internalListRef;
  const { width: pagerWidth, height: pagerHeight } = useWindowDimensions();
  const [pageRequests] = useState(createFeedPageRequests);
  const {
    hidden: createActionHidden,
    animatedStyle: createActionAnimation,
    onScroll: updateCreateActionForScroll,
    reset: resetCreateAction
  } = useScrollActionVisibility({
    active,
    resetKey: `${feedSource}:${feedFilter}:${categoryFilter}:${readingFilter}`
  });
  const enabledFeedSourceItems = useMemo(
    () => [
      { value: 'all' as const, label: '全部' },
      ...enabledFeedSources.map((source) => ({ value: source, label: sourceLabel(source) }))
    ],
    [enabledFeedSources]
  );
  const allSourcesDisabled = enabledFeedSources.length === 0;
  const initialContentPhaseRef = useRef<'awaiting-list' | 'awaiting-terminal' | 'reported'>('awaiting-list');
  const initialContentTerminal = !busy && (allSourcesDisabled || Boolean(feedOutcomeKind));
  const reportInitialContentReady = useCallback(() => {
    if (initialContentPhaseRef.current === 'reported') return;
    initialContentPhaseRef.current = 'reported';
    recordStartupPhase(
      allSourcesDisabled
        ? 'feed-empty'
        : feedItems.length
          ? 'feed-content'
          : feedOutcomeKind === 'error' || feedOutcomeKind === 'auth'
            ? 'feed-error'
            : 'feed-empty'
    );
    recordStartupPhase('feed-terminal');
    onInitialContentReady?.();
  }, [allSourcesDisabled, feedItems.length, feedOutcomeKind, onInitialContentReady]);
  const handleInitialListLoad = useCallback(() => {
    if (initialContentPhaseRef.current === 'awaiting-list') initialContentPhaseRef.current = 'awaiting-terminal';
    if (!allSourcesDisabled && feedItems.length && !initialContentTerminal) recordStartupPhase('feed-content');
    if (initialContentTerminal) reportInitialContentReady();
  }, [allSourcesDisabled, feedItems.length, initialContentTerminal, reportInitialContentReady]);
  useEffect(() => {
    if (initialContentPhaseRef.current !== 'awaiting-list' && initialContentTerminal) reportInitialContentReady();
  }, [initialContentTerminal, reportInitialContentReady]);
  const visibleFeedItems = useMemo(() => (allSourcesDisabled ? [] : feedItems), [allSourcesDisabled, feedItems]);
  const waitingForTopics = busy && visibleFeedItems.length === 0;
  const sourceList = useMemo(() => ({ source: feedSource, mounted: false, painted: false }), [feedSource]);
  const showList = !waitingForTopics || sourceList.mounted;
  useLayoutEffect(() => {
    if (showList) sourceList.mounted = true;
  }, [showList, sourceList]);
  const batch = useMemo(() => ({ sourceList, waitingForTopics }), [sourceList, waitingForTopics]);
  const currentBatch = useCommittedRef(batch);
  const [paintedBatch, setPaintedBatch] = useState<typeof batch>();
  const showLoadingCover = waitingForTopics || (visibleFeedItems.length > 0 && paintedBatch !== batch);
  const onFeedListLoad = useCallback(() => {
    if (currentBatch.current.sourceList !== sourceList) return;
    sourceList.painted = true;
    if (currentBatch.current === batch) setPaintedBatch(batch);
    handleInitialListLoad();
  }, [batch, currentBatch, handleInitialListLoad, sourceList]);
  const onFeedRowsLayout = useCallback(() => {
    if (sourceList.painted && currentBatch.current === batch && listRef.current?.getLayout(0)?.isHeightMeasured) {
      setPaintedBatch(batch);
    }
  }, [batch, currentBatch, listRef, sourceList]);
  const activeFeedSourceIndex = Math.max(
    0,
    enabledFeedSourceItems.findIndex((item) => item.value === feedSource)
  );
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const feedNavigationState = useMemo(
    () => ({
      index: activeFeedSourceIndex,
      routes: enabledFeedSourceItems.map((item, index) => ({
        key: item.value,
        title: item.label,
        accessibilityLabel: `${item.label}${index === activeFeedSourceIndex ? '，已选择' : ''}`,
        testID: `feed-source-${item.value}`
      }))
    }),
    [activeFeedSourceIndex, enabledFeedSourceItems]
  );
  const feedInitialLayout = useMemo(() => ({ width: pagerWidth }), [pagerWidth]);
  const showFeedFilter = shouldUseFeedFilter(feedSource, categoryFilter);
  if (filterMenuOpen && (!screenActive || !showFeedFilter)) setFilterMenuOpen(false);
  const activeFeedFilterMenuGroups = showFeedFilter ? feedFilterMenuGroupsFor(feedSource) : [];
  const feedTabOptions = useMemo(() => ({ labelStyle: styles.feedSourceLabel }), [styles.feedSourceLabel]);
  const canChangeFeedSelection = useLatestCallback(() => screenActive && isRouteFocused?.() !== false);
  const requestFeedLoadMore = useCallback(
    (source: 'button' | 'scroll' = 'button', offsetY = 0) => {
      if (!feedHasMore || busy || refreshing || loadingMore || (source === 'scroll' && feedManualContinuation)) {
        return;
      }
      const request = pageRequests.begin(feedPage + 1, source, offsetY, AUTO_LOAD_SCROLL_STEP);
      if (!request) return;
      const settle = (failed: boolean) => pageRequests.settle(request, failed);
      void Promise.resolve(onLoadMore()).then(
        (outcome) => settle(outcome === 'failed'),
        () => settle(true)
      );
    },
    [busy, feedHasMore, feedManualContinuation, feedPage, loadingMore, onLoadMore, pageRequests, refreshing]
  );

  const handleScroll = useLatestCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = Math.max(0, event.nativeEvent.contentOffset.y);
    updateCreateActionForScroll(event);
    if (shouldLoadMoreFeedFromScroll(event.nativeEvent)) {
      requestFeedLoadMore('scroll', offsetY);
    }
  });

  const handleScrollBeginDrag = useCallback(() => {
    pageRequests.dragged();
  }, [pageRequests]);

  useEffect(() => {
    if (!busy && !loadingMore) {
      pageRequests.observedIdle();
    }
  }, [busy, loadingMore, pageRequests]);

  useEffect(() => {
    if (loadMoreFailureSignal > 0) {
      pageRequests.failureObserved();
    }
  }, [loadMoreFailureSignal, pageRequests]);

  const scrollFeedToTop = useCallback(
    (animated = true) => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
      resetCreateAction();
    },
    [listRef, resetCreateAction]
  );

  const commitFeedSelectionChange = useCallback(
    (commit: () => void) => {
      if (!canChangeFeedSelection()) return;
      scrollFeedToTop(false);
      commit();
      requestAnimationFrame(() => scrollFeedToTop(false));
    },
    [canChangeFeedSelection, scrollFeedToTop]
  );

  useEffect(() => {
    pageRequests.reset();
  }, [categoryFilter, feedFilter, feedSource, readingFilter, pageRequests]);

  const changeFeedSourceValue = useCallback(
    (value: string) => {
      const next = enabledFeedSourceItems.find((item) => item.value === value);
      if (!next || next.value === feedSource) {
        return;
      }
      setFilterMenuOpen(false);
      onFeedSourceChange(next.value);
    },
    [enabledFeedSourceItems, feedSource, onFeedSourceChange]
  );
  const changeFeedSourceFromPager = useCallback(
    (index: number) => {
      const next = enabledFeedSourceItems[index];
      if (next) {
        changeFeedSourceValue(next.value);
      }
    },
    [changeFeedSourceValue, enabledFeedSourceItems]
  );
  const changeReadingFilter = useCallback(
    (value: string) => {
      const next = value as ReadingFilter;
      if (next !== readingFilter) {
        commitFeedSelectionChange(() => onReadingFilterChange(next));
      }
    },
    [commitFeedSelectionChange, onReadingFilterChange, readingFilter]
  );
  const changeCategoryFilter = useCallback(
    (value: string) => {
      if (value !== categoryFilter) {
        commitFeedSelectionChange(() => onCategoryChange(value));
      }
    },
    [categoryFilter, commitFeedSelectionChange, onCategoryChange]
  );
  const toggleFeedFilterMenu = useCallback(() => {
    setFilterMenuOpen((current) => !current);
  }, []);
  const closeFeedFilterMenu = useCallback(() => {
    setFilterMenuOpen(false);
  }, []);
  const changeFeedFilter = useCallback(
    (value: SourceFeedFilter) => {
      if (!canChangeFeedSelection()) return;
      setFilterMenuOpen(false);
      if (value !== feedFilter) {
        commitFeedSelectionChange(() => onFeedFilterChange(value));
      }
    },
    [canChangeFeedSelection, commitFeedSelectionChange, feedFilter, onFeedFilterChange]
  );
  const renderTopicItem = useCallback<ListRenderItem<Topic>>(
    ({ index, item: topic }) => (
      <TopicListCard
        topicStateIndex={topicStateIndex}
        showPinned
        showSource={feedSource === 'all'}
        testID={index === 0 ? 'feed-topic-first' : undefined}
        topic={topic}
        onOpenTopic={onOpenTopic}
      />
    ),
    [feedSource, onOpenTopic, topicStateIndex]
  );
  const renderFeedFilterItem = useCallback(
    (item: { value: SourceFeedFilter; label: string }, last: boolean) => {
      const active = item.value === feedFilter;
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
    [changeFeedFilter, feedFilter]
  );
  const feedFilterMenu = filterMenuOpen ? (
    <PopupMenu
      accessibilityLabel="关闭列表筛选菜单"
      scrollable
      placementStyle={[styles.linuxDoFilterMenu, { top: sourceHeaderHeight + secondaryHeaderHeight }]}
      visible
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
    ({ route }: { route: { key: string } }) => (
      <View
        testID="feed-loading-scene"
        style={[styles.content, { paddingTop: sourceHeaderHeight + secondaryHeaderHeight }]}
      >
        <FeedRouteFocused.Consumer>
          {(focused) => (
            <FeedListPlaceholder
              label="加载中"
              animating={focused && route.key === feedSource}
              fillHeight={pagerHeight - sourceHeaderHeight - secondaryHeaderHeight}
            />
          )}
        </FeedRouteFocused.Consumer>
      </View>
    ),
    [styles, sourceHeaderHeight, secondaryHeaderHeight, feedSource, pagerHeight]
  );
  const renderFeedContent = useCallback(
    ({ route }: { route: { key: string } }) => {
      const activeSource = route.key === feedSource;
      const loadingScene = renderFeedLoadingScene({ route });
      return (
        <View style={styles.content}>
          {activeSource && showList ? (
            <FlashList
              renderScrollComponent={ScrollView}
              nativeID="wz-retained-feed-scroll"
              testID={
                !busy && feedOutcomeKind
                  ? `feed-outcome-${feedOutcomeKind}-${feedSource}-${feedFilter ?? 'default'}`
                  : undefined
              }
              ref={listRef}
              accessibilityElementsHidden={showLoadingCover}
              importantForAccessibility={showLoadingCover ? 'no-hide-descendants' : 'auto'}
              pointerEvents={showLoadingCover ? 'none' : 'auto'}
              style={styles.content}
              contentContainerStyle={[
                styles.feedListContentInner,
                {
                  paddingTop: sourceHeaderHeight + secondaryHeaderHeight,
                  paddingBottom: Math.max(96, bottomBarHeight + 16)
                }
              ]}
              data={visibleFeedItems}
              keyExtractor={topicKey}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={false}
              refreshControl={
                allSourcesDisabled ? undefined : (
                  <RefreshControl
                    enabled={!busy || visibleFeedItems.length > 0}
                    refreshing={refreshing && !busy}
                    onRefresh={onRefresh}
                    colors={[theme.primary]}
                    tintColor={theme.primary}
                    progressViewOffset={sourceHeaderHeight + secondaryHeaderHeight}
                  />
                )
              }
              onScroll={handleScroll}
              onLoad={onFeedListLoad}
              onCommitLayoutEffect={showLoadingCover && visibleFeedItems.length ? onFeedRowsLayout : undefined}
              onScrollBeginDrag={handleScrollBeginDrag}
              scrollEventThrottle={64}
              {...FEED_LIST_PERFORMANCE_PROPS}
              ListHeaderComponent={
                feedSource === 'all' && failedFeedSources?.length ? (
                  <View style={styles.feedListFooter}>
                    {failedFeedSources.map((source) => (
                      <AppButton
                        key={source}
                        compact
                        variant="ghost"
                        label={`前往 ${sourceLabel(source)} 重试`}
                        onPress={() => {
                          if (canChangeFeedSelection()) changeFeedSourceValue(source);
                        }}
                      />
                    ))}
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View testID="feed-empty-state" onLayout={handleInitialListLoad}>
                  {allSourcesDisabled ? (
                    <RecoverableEmptyState
                      message="尚未启用内容源"
                      actionLabel="前往更多管理"
                      onAction={onManageContentSources}
                    />
                  ) : feedOutcomeKind === 'error' || feedOutcomeKind === 'auth' ? (
                    <RecoverableEmptyState
                      message={feedOutcomeKind === 'auth' ? '需要登录或验证，请完成后重试。' : '主题读取失败，请重试。'}
                      actionLabel="重试"
                      onAction={onRefresh}
                    />
                  ) : (
                    <EmptyText text={feedEmptyText} />
                  )}
                </View>
              }
              ListFooterComponent={
                feedHasMore ? (
                  <View style={styles.feedListFooter}>
                    {loadMoreErrorMessage && !loadingMore && !refreshing ? (
                      <Text accessibilityLiveRegion="polite" style={styles.pageErrorText}>
                        {loadMoreErrorMessage}
                      </Text>
                    ) : null}
                    <AppButton
                      compact
                      variant="ghost"
                      label={
                        loadingMore
                          ? '加载更多中'
                          : `${loadMoreFailureSignal ? '重试加载' : '加载'}第 ${feedPage + 1} 页`
                      }
                      loading={loadingMore}
                      disabled={busy || refreshing || loadingMore}
                      onPress={() => requestFeedLoadMore('button')}
                    />
                  </View>
                ) : visibleFeedItems.length > 0 && !busy && !refreshing ? (
                  feedOutcomeKind ? (
                    <Text testID="feed-end-of-list" style={styles.endOfListText}>
                      已经到底了
                    </Text>
                  ) : feedSource === 'all' ? (
                    <FeedRouteFocused.Consumer>
                      {(focused) => <LoadingState compact text="加载其他来源" animating={focused} />}
                    </FeedRouteFocused.Consumer>
                  ) : null
                ) : null
              }
              ItemSeparatorComponent={TopicListSeparator}
              renderItem={renderTopicItem}
            />
          ) : null}
          <FeedRouteFocused.Consumer>
            {(focused) => (
              <LoadingCover
                visible={!activeSource || showLoadingCover}
                active={focused && activeSource}
                style={styles.content}
              >
                {loadingScene}
              </LoadingCover>
            )}
          </FeedRouteFocused.Consumer>
        </View>
      );
    },
    [
      busy,
      bottomBarHeight,
      allSourcesDisabled,
      canChangeFeedSelection,
      changeFeedSourceValue,
      failedFeedSources,
      feedEmptyText,
      feedFilter,
      feedHasMore,
      feedOutcomeKind,
      feedPage,
      feedSource,
      handleScroll,
      handleScrollBeginDrag,
      listRef,
      loadMoreErrorMessage,
      loadMoreFailureSignal,
      loadingMore,
      handleInitialListLoad,
      onFeedListLoad,
      onFeedRowsLayout,
      showList,
      showLoadingCover,
      onManageContentSources,
      onRefresh,
      refreshing,
      renderFeedLoadingScene,
      renderTopicItem,
      requestFeedLoadMore,
      styles,
      sourceHeaderHeight,
      secondaryHeaderHeight,
      theme,
      visibleFeedItems
    ]
  );

  const renderFeedScene = useCallback(
    ({ route }: { route: { key: string } }) => {
      const content = renderFeedContent({ route });
      return (
        <FeedRouteFocused.Consumer>
          {(focused) => (
            <NavigationBackdropTarget active={focused && route.key === feedSource} setLocalTarget={setBackdropView}>
              {content}
            </NavigationBackdropTarget>
          )}
        </FeedRouteFocused.Consumer>
      );
    },
    [feedSource, renderFeedContent, setBackdropView]
  );

  const renderCategoryRail = useCallback(
    ({ value: routeSource }: { value: FeedSource }) => {
      const active = routeSource === feedSource;
      const routeCategory = active ? categoryFilter : '';
      const routeFilter = active
        ? feedFilter
        : routeSource !== 'all' && isFeedFilterSource(routeSource)
          ? feedFilters[routeSource]
          : undefined;
      const routeShowsFilter = shouldUseFeedFilter(routeSource, routeCategory);
      const categoryItems = feedCategoryItems(categories, routeSource);
      return (
        <View
          key={routeSource}
          testID={`feed-secondary-${routeSource}`}
          style={[styles.feedSecondaryHeader, { width: pagerWidth }]}
          onLayout={(event) => {
            if (active) setSecondaryHeaderHeight(event.nativeEvent.layout.height);
          }}
          pointerEvents={active ? 'auto' : 'none'}
          accessibilityElementsHidden={!active}
          importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
        >
          {shouldUseReadingFilter(routeSource) ? (
            <PillRail
              variant="subtabs"
              disabled={!active}
              items={feedReadingFilterItems}
              value={readingFilter}
              onChange={(value) => {
                if (active) changeReadingFilter(value);
              }}
            />
          ) : (
            <View style={routeShowsFilter ? styles.feedSecondaryRow : undefined}>
              <View style={routeShowsFilter ? styles.feedCategoryRailSlot : undefined}>
                <PillRail
                  variant="subtabs"
                  disabled={!active}
                  items={categoryItems}
                  value={routeCategory}
                  resetScrollKey={Number(active)}
                  onChange={(value) => {
                    if (active) changeCategoryFilter(value);
                  }}
                />
              </View>
              {routeShowsFilter ? (
                <Pressable
                  testID={active ? 'feed-list-filter' : undefined}
                  accessibilityRole="button"
                  accessibilityLabel="列表筛选"
                  accessibilityValue={{ text: feedFilterLabel(routeSource, routeFilter) }}
                  accessibilityState={{ disabled: !active, expanded: active && filterMenuOpen }}
                  disabled={!active}
                  style={styles.linuxDoFilterButton}
                  onPress={() => {
                    if (active) toggleFeedFilterMenu();
                  }}
                >
                  <Text style={styles.linuxDoFilterButtonText} numberOfLines={1}>
                    {feedFilterLabel(routeSource, routeFilter)}
                  </Text>
                  <ChevronDown
                    accessible={false}
                    size={14}
                    color={styles.linuxDoFilterButtonText.color}
                    strokeWidth={1.8}
                  />
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      );
    },
    [
      feedSource,
      categoryFilter,
      feedFilter,
      feedFilters,
      categories,
      styles,
      pagerWidth,
      readingFilter,
      changeReadingFilter,
      changeCategoryFilter,
      filterMenuOpen,
      toggleFeedFilterMenu
    ]
  );

  const renderFeedTabBar = useCallback(
    (props: TabBarProps<{ key: string }>) => (
      <>
        <View
          testID="feed-primary-header"
          style={styles.feedFixedHeader}
          onLayout={(event) => setSourceHeaderHeight(event.nativeEvent.layout.height)}
        >
          <TabBar
            {...props}
            onTabPress={({ preventDefault }) => {
              if (!canChangeFeedSelection()) preventDefault();
            }}
            scrollEnabled
            gap={22}
            activeColor={theme.primary}
            inactiveColor={theme.muted}
            pressColor="transparent"
            pressOpacity={1}
            style={styles.feedSourceBar}
            tabStyle={styles.feedSourceTab}
            indicatorStyle={styles.feedSourceIndicator}
            contentContainerStyle={styles.feedSourceRail}
          />
        </View>
        <View testID="feed-category-viewport" style={[styles.feedCategoryViewport, { top: sourceHeaderHeight }]}>
          <NativeAnimated.View
            testID="feed-category-track"
            style={[
              styles.feedCategoryTrack,
              {
                width: enabledFeedSourceItems.length * pagerWidth,
                transform: [
                  { translateX: NativeAnimated.multiply(props.position, I18nManager.isRTL ? pagerWidth : -pagerWidth) }
                ]
              }
            ]}
          >
            {enabledFeedSourceItems.map(renderCategoryRail)}
          </NativeAnimated.View>
        </View>
      </>
    ),
    [canChangeFeedSelection, enabledFeedSourceItems, pagerWidth, renderCategoryRail, sourceHeaderHeight, styles, theme]
  );

  const onPageLayout = useStartupPageLayout();
  return (
    <View style={styles.content} onLayout={onPageLayout}>
      {feedFilterMenu}
      <FeedRouteFocused.Provider value={screenActive}>
        <FeedPager
          animationEnabled={false}
          style={styles.feedPager}
          initialLayout={feedInitialLayout}
          lazy
          lazyPreloadDistance={1}
          renderLazyPlaceholder={renderFeedLoadingScene}
          navigationState={feedNavigationState}
          commonOptions={feedTabOptions}
          renderScene={renderFeedScene}
          renderTabBar={renderFeedTabBar}
          onSwipeStart={closeFeedFilterMenu}
          onIndexChange={changeFeedSourceFromPager}
        />
      </FeedRouteFocused.Provider>
      {onCreateTopic && feedSource !== 'v2ex' ? (
        <Animated.View
          testID="feed-create-topic-action"
          needsOffscreenAlphaCompositing
          style={[
            styles.feedFloatingActions,
            { bottom: Math.max(styles.feedFloatingActions.bottom, bottomBarHeight + 16) },
            createActionAnimation
          ]}
          pointerEvents={createActionHidden ? 'none' : 'box-none'}
          accessibilityElementsHidden={createActionHidden}
          importantForAccessibility={createActionHidden ? 'no-hide-descendants' : 'auto'}
        >
          <FloatingIconButton
            backdrop={<NavigationGlass accent backdropView={backdropView} cropToViewport pauseWhenHidden />}
            icon={SquarePen}
            label="发帖"
            disabled={createActionHidden}
            onPress={onCreateTopic}
          />
        </Animated.View>
      ) : null}
    </View>
  );
});
