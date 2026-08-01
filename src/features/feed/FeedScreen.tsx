import type { FeedStyles } from './styles';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
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
  SourceErrorInfo,
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
  feedSourceItems,
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
import { type ReaderTheme } from '@/ui/theme/tokens';
import {
  AppButton,
  EmptyText,
  FloatingIconButton,
  LoadingState,
  PillRail,
  TOUCH_HIT_SLOP,
  triggerPressFeedback
} from '@/ui/controls/AppControls';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { FEED_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { isFeedFilterSource } from '@/domain/forum/sourceCatalog';

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
  feedOutcomeKind,
  feedPage,
  feedFilter,
  feedFilters,
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
  feedOutcomeKind?: SourceLoadOutcomeKind;
  feedPage: number;
  feedFilter?: SourceFeedFilter;
  feedFilters: FeedFilterState;
  feedSource: FeedSource;
  identityChecking?: boolean;
  identityError?: SourceErrorInfo;
  loadMoreFailureSignal: number;
  loadingMore: boolean;
  topicStateIndex: TopicListItemStateIndex;
  readingFilter: ReadingFilter;
  refreshing: boolean;
  scrollToTopSignal: number;
  styles: FeedStyles;
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
  const listRef = useRef<FlashListRef<Topic>>(null);
  const { width: pagerWidth } = useWindowDimensions();
  const requestedFeedPageRef = useRef<number | null>(null);
  const lastAutoLoadMoreOffsetRef = useRef<number | null>(null);
  const autoLoadPausedAfterFailureRef = useRef(false);
  const [showFloatingActions, setShowFloatingActions] = useState(false);
  const activeFeedSourceIndex = Math.max(
    0,
    feedSourceItems.findIndex((item) => item.value === feedSource)
  );
  const [pagerIndex, setPagerIndex] = useState(activeFeedSourceIndex);
  const visualFeedSource = feedSourceItems[pagerIndex]?.value || feedSource;
  const visualCategoryFilter = visualFeedSource === feedSource ? categoryFilter : '';
  const visualFeedFilter =
    visualFeedSource !== 'all' && isFeedFilterSource(visualFeedSource) ? feedFilters[visualFeedSource] : undefined;
  const sourceSelectionPending = visualFeedSource !== feedSource;
  const pendingSourceIndexRef = useRef<number | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const secondaryRailResetKey = visualFeedSource;
  const feedNavigationState = useMemo(() => ({ index: pagerIndex, routes: FEED_PAGER_ROUTES }), [pagerIndex]);
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

  const scrollFeedToTop = useCallback((animated = true) => {
    listRef.current?.scrollToOffset({ offset: 0, animated });
    setShowFloatingActions(false);
  }, []);

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
    if (scrollToTopSignal > 0) {
      scrollFeedToTop();
    }
  }, [scrollFeedToTop, scrollToTopSignal]);

  useEffect(() => {
    setPagerIndex((current) => (current === activeFeedSourceIndex ? current : activeFeedSourceIndex));
    pendingSourceIndexRef.current = null;
  }, [activeFeedSourceIndex]);

  const changeFeedSourceAtIndex = useCallback(
    (index: number) => {
      const next = feedSourceItems[index];
      if (!next || (index === pagerIndex && pendingSourceIndexRef.current === null)) {
        return;
      }
      pendingSourceIndexRef.current = index;
      setFilterMenuOpen(false);
      setPagerIndex(index);
    },
    [pagerIndex]
  );
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
    if (next.value !== feedSource) {
      onFeedSourceChange(next.value);
    }
  }, [feedSource, onFeedSourceChange]);
  const changeFeedSourceValue = useCallback(
    (value: string) => {
      changeFeedSourceAtIndex(feedSourceItems.findIndex((item) => item.value === value));
    },
    [changeFeedSourceAtIndex]
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
        styles={styles}
        testID={index === 0 ? 'feed-topic-first' : undefined}
        theme={theme}
        topic={topic}
        onOpenTopic={onOpenTopic}
      />
    ),
    [onOpenTopic, styles, theme, topicStateIndex]
  );
  const renderTopicSeparator = useCallback(() => <View style={styles.topicListSeparator} />, [styles]);
  const categoryItems = useMemo(() => feedCategoryItems(categories, visualFeedSource), [categories, visualFeedSource]);
  const renderFeedFilterItem = useCallback(
    (item: { value: SourceFeedFilter; label: string }, last: boolean) => {
      const active = item.value === visualFeedFilter;
      return (
        <Pressable
          key={item.value}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          hitSlop={TOUCH_HIT_SLOP}
          style={[
            styles.topicMenuItem,
            styles.linuxDoFilterMenuItem,
            active && styles.linuxDoFilterMenuItemActive,
            last && styles.topicMenuItemLast
          ]}
          onPress={() => changeFeedFilter(item.value)}
        >
          <Text
            style={[
              styles.topicMenuItemText,
              styles.linuxDoFilterMenuItemText,
              active && styles.linuxDoFilterMenuItemTextActive
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      );
    },
    [changeFeedFilter, styles, visualFeedFilter]
  );
  const feedFilterMenu = filterMenuOpen ? (
    <Modal transparent animationType="fade" visible={filterMenuOpen} onRequestClose={closeFeedFilterMenu}>
      <View style={styles.topicMenuLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭列表筛选菜单"
          style={styles.topicMenuDismissLayer}
          onPress={closeFeedFilterMenu}
        />
        <View style={styles.linuxDoFilterMenu}>
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
        </View>
      </View>
    </Modal>
  ) : null;
  const feedEmptyText =
    readingFilter !== 'all' || Boolean(categoryFilter) || feedSource !== 'all' ? '当前筛选没有匹配主题' : '暂无主题';
  const renderFeedLoadingScene = useCallback(
    () => (
      <View style={styles.content}>
        <LoadingState text="正在读取主题..." styles={styles} theme={theme} />
      </View>
    ),
    [styles, theme]
  );
  const renderFeedScene = useCallback(
    ({ route }: { route: { key: string } }) => {
      const routeSource = feedSourceItems.find((item) => item.value === route.key)?.value;
      if (!routeSource || routeSource !== feedSource) {
        return renderFeedLoadingScene();
      }
      if (feedItems.length === 0 && !identityError && (busy || identityChecking)) {
        return (
          <View style={styles.content}>
            <LoadingState
              text={identityChecking ? '正在确认 L 站访问状态' : '正在读取主题...'}
              styles={styles}
              theme={theme}
            />
          </View>
        );
      }
      const identityNotice = identityError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{identityError.message}</Text>
          <View style={styles.actions}>
            <AppButton label="重试检测" styles={styles} onPress={onRetryIdentity || onRefresh} />
            {feedSource === 'linuxdo' && onCheckLinuxDoStatus ? (
              <AppButton label="检查 L 站状态" variant="ghost" styles={styles} onPress={onCheckLinuxDoStatus} />
            ) : null}
          </View>
        </View>
      ) : identityChecking ? (
        <LoadingState text="正在确认 L 站访问状态" styles={styles} theme={theme} />
      ) : null;
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
          data={feedItems}
          keyExtractor={topicKey}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            busy && feedItems.length === 0 ? undefined : (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[theme.primary]}
                tintColor={theme.primary}
              />
            )
          }
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          scrollEventThrottle={64}
          {...FEED_LIST_PERFORMANCE_PROPS}
          ListHeaderComponent={identityNotice}
          ListEmptyComponent={
            identityNotice ? null : busy ? (
              <LoadingState text="正在读取主题..." styles={styles} theme={theme} />
            ) : (
              <EmptyText text={feedEmptyText} styles={styles} />
            )
          }
          ListFooterComponent={
            feedHasMore ? (
              <AppButton
                label={loadingMore ? '正在加载...' : `加载第 ${feedPage + 1} 页`}
                styles={styles}
                disabled={busy || loadingMore}
                onPress={() => requestFeedLoadMore('button')}
              />
            ) : feedItems.length > 0 && !busy ? (
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
      feedEmptyText,
      feedFilter,
      feedHasMore,
      feedItems,
      feedOutcomeKind,
      feedPage,
      feedSource,
      identityChecking,
      identityError,
      handleScroll,
      handleScrollBeginDrag,
      loadingMore,
      onCheckLinuxDoStatus,
      onRefresh,
      onRetryIdentity,
      refreshing,
      renderFeedLoadingScene,
      renderTopicItem,
      renderTopicSeparator,
      requestFeedLoadMore,
      styles,
      theme
    ]
  );

  return (
    <View style={styles.content}>
      <View style={styles.feedFixedHeader}>
        <PillRail
          variant="tabs"
          items={feedSourceItems}
          value={visualFeedSource}
          testIDPrefix="feed-source"
          styles={styles}
          onChange={changeFeedSourceValue}
        />
        {shouldUseReadingFilter(visualFeedSource) ? (
          <PillRail
            disabled={sourceSelectionPending}
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
                disabled={sourceSelectionPending}
                variant="subtabs"
                items={categoryItems}
                value={visualCategoryFilter}
                resetScrollKey={secondaryRailResetKey}
                styles={styles}
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
        renderLazyPlaceholder={renderFeedLoadingScene}
        renderScene={renderFeedScene}
        renderTabBar={renderEmptyTabBar}
        onIndexChange={changeFeedSourceAtIndex}
        onSwipeEnd={settleFeedSource}
      />
      {showFloatingActions ? (
        <View style={styles.feedFloatingActions}>
          <FloatingIconButton
            icon={ChevronUp}
            label="回到顶部"
            styles={styles}
            theme={theme}
            onPress={scrollFeedToTopPress}
          />
        </View>
      ) : null}
    </View>
  );
});
