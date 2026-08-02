import { createSearchStyles, type SearchStyles } from './styles';
import { SearchFilterSheet } from './SearchFilterSheet';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem, type ViewToken } from '@shopify/flash-list';
import { ChevronDown, ChevronRight, History, Search, SlidersHorizontal, X } from 'lucide-react-native';
import type {
  Category,
  DiscourseTagOption,
  DiscourseUserOption,
  FeedSource,
  Source,
  SourceErrorInfo,
  Topic
} from '@/domain/forum/models';
import { aggregateSearchSources, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { topicKey } from '@/domain/reader/readerData';
import { feedSourceItems } from '@/domain/forum/feedOptions';
import { buildSearchListItems, searchGroupEmptyText, type SearchGroup, type SearchListItem } from './listItems';
import type { LinuxDoAiSearchState } from './aiSearch';
import {
  searchFilterForSource,
  searchFilterSummary,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOUCH_HIT_SLOP } from '@/ui/controls/pressFeedback';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import type { SearchSessionNoticeItem } from '@/domain/session/siteSessionPrompts';
import { searchSessionNoticeLightTone } from '@/domain/session/siteSessionPrompts';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';

const SEARCH_PAGINATION_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 0,
  waitForInteraction: true
};

function SearchInputField({
  busy,
  query,
  styles,
  theme,
  onQueryChange,
  onSearch
}: {
  busy: boolean;
  query: string;
  styles: SearchStyles;
  theme: ReaderTheme;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
}) {
  const submitDisabled = busy || !query.trim();
  const submitSearch = () => {
    if (!submitDisabled) {
      onSearch();
    }
  };
  return (
    <View style={styles.searchInputShell}>
      <Search size={18} color={theme.muted} strokeWidth={1.9} style={styles.searchInputIcon} />
      <TextInput
        testID="search-query"
        accessibilityLabel="搜索关键词"
        style={styles.searchInput}
        value={query}
        onChangeText={onQueryChange}
        placeholder="输入关键词"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={submitSearch}
      />
      {query ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清空搜索关键词"
          android_ripple={androidRipple(theme.primarySoft, true)}
          hitSlop={TOUCH_HIT_SLOP}
          style={styles.searchInlineButton}
          onPress={() => onQueryChange('')}
        >
          <X size={16} color={theme.muted} strokeWidth={2.2} />
        </Pressable>
      ) : null}
      <Pressable
        testID="search-submit"
        accessibilityRole="button"
        accessibilityLabel="提交搜索"
        accessibilityState={{ disabled: submitDisabled }}
        android_ripple={androidRipple(theme.primarySoft, true)}
        disabled={submitDisabled}
        hitSlop={TOUCH_HIT_SLOP}
        style={[styles.searchInlineButton, styles.searchSubmitInlineButton, submitDisabled && styles.buttonDisabled]}
        onPress={submitSearch}
      >
        <Search size={17} color={theme.primary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function SearchFilterEntry({
  summary,
  styles,
  theme,
  onPress
}: {
  summary: string;
  styles: SearchStyles;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const active = summary !== '默认';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开搜索筛选，当前${summary}`}
      accessibilityState={{ selected: active }}
      android_ripple={androidRipple(theme.primarySoft)}
      style={[styles.searchFilterEntry, active && styles.searchFilterEntryActive]}
      onPress={onPress}
    >
      <View style={styles.searchFilterEntryIcon}>
        <SlidersHorizontal size={17} color={theme.primary} strokeWidth={1.9} />
      </View>
      <Text style={styles.searchFilterEntryText}>筛选</Text>
      <Text
        numberOfLines={1}
        style={[styles.searchFilterEntrySummary, active && styles.searchFilterEntrySummaryActive]}
      >
        {summary}
      </Text>
      <ChevronDown size={16} color={theme.muted} strokeWidth={1.7} />
    </Pressable>
  );
}

function LinuxDoAiControl({
  state,
  styles,
  theme,
  onRetry,
  onToggle
}: {
  state: LinuxDoAiSearchState;
  styles: SearchStyles;
  theme: ReaderTheme;
  onRetry: () => void;
  onToggle: () => void;
}) {
  const disabled = state.status !== 'ready';
  const statusText =
    state.status === 'loading'
      ? 'AI 结果加载中'
      : state.status === 'ready'
        ? `${state.count} 条 AI 结果`
        : state.message || '';
  return (
    <View style={styles.searchFilterEntry}>
      <View style={styles.searchFilterEntryIcon}>
        <Text style={styles.searchFilterOptionTextActive}>✦</Text>
      </View>
      <Text style={styles.searchFilterEntryText}>AI 搜索</Text>
      <Text numberOfLines={1} style={styles.searchFilterEntrySummary}>
        {statusText}
      </Text>
      {state.status === 'loading' ? <ActivityIndicator size="small" color={theme.primary} /> : null}
      {state.status === 'error' ? <AppButton compact label="重试 AI 搜索" variant="ghost" onPress={onRetry} /> : null}
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="AI 搜索"
        accessibilityState={{ checked: state.enabled, disabled }}
        disabled={disabled}
        android_ripple={androidRipple(theme.primarySoft)}
        style={[
          styles.searchFilterOption,
          state.enabled && styles.searchFilterOptionActive,
          disabled && styles.buttonDisabled
        ]}
        onPress={onToggle}
      >
        <Text style={[styles.searchFilterOptionText, state.enabled && styles.searchFilterOptionTextActive]}>
          {state.enabled ? '开启' : '关闭'}
        </Text>
      </Pressable>
    </View>
  );
}

export const SearchScreen = memo(function SearchScreen({
  busy,
  categories,
  sessionEpochs,
  requestsEnabled,
  query,
  recentSearches,
  topicStateIndex,
  searchFilters,
  searchGroups,
  linuxDoAiState,
  linuxDoAiVisible,
  identityChecking = false,
  identityError,
  searchSessionNotices,
  searchSource,
  submittedQuery,
  scrollRef,
  onOpenTopic,
  onLoadMoreSearchSource,
  onCheckLinuxDoStatus,
  onRemoveRecentSearch,
  onQueryChange,
  onRetrySearchSource,
  onRetryIdentity,
  onRetryLinuxDoAiSearch,
  onSearch,
  onSearchFilterApply,
  onSearchDiscourseTags,
  onSearchDiscourseUsers,
  onToggleLinuxDoAiSearch,
  onSearchSourceChange
}: {
  busy: boolean;
  categories: Category[];
  sessionEpochs: ForumSessionEpochs;
  requestsEnabled: boolean;
  query: string;
  recentSearches: string[];
  topicStateIndex: TopicListItemStateIndex;
  searchFilters: SearchFilterState;
  searchGroups: SearchGroup[];
  linuxDoAiState: LinuxDoAiSearchState;
  linuxDoAiVisible: boolean;
  identityChecking?: boolean;
  identityError?: SourceErrorInfo;
  searchSessionNotices: SearchSessionNoticeItem[];
  searchSource: FeedSource;
  submittedQuery: string;
  scrollRef?: RefObject<FlashListRef<SearchListItem> | null>;
  onOpenTopic: (topic: Topic) => void;
  onLoadMoreSearchSource: (source: Source, page: number) => void;
  onCheckLinuxDoStatus?: () => void;
  onRemoveRecentSearch: (query: string) => void;
  onQueryChange: (value: string) => void;
  onRetrySearchSource: (source: Source) => void;
  onRetryIdentity?: () => void;
  onRetryLinuxDoAiSearch: () => void;
  onSearch: (queryOverride?: string) => void;
  onSearchFilterApply: (source: Source, filter: SourceSearchFilter) => void;
  onSearchDiscourseTags: (options: {
    source?: DiscourseSource;
    query: string;
    categoryId?: string;
    selectedTags: string[];
    signal?: AbortSignal;
  }) => Promise<DiscourseTagOption[]>;
  onSearchDiscourseUsers: (options: {
    source?: DiscourseSource;
    term: string;
    categoryId?: string;
    signal?: AbortSignal;
  }) => Promise<DiscourseUserOption[]>;
  onToggleLinuxDoAiSearch: () => void;
  onSearchSourceChange: (source: FeedSource) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createSearchStyles);
  const internalListRef = useRef<FlashListRef<SearchListItem> | null>(null);
  const listRef = scrollRef || internalListRef;
  const autoLoadArmedRef = useRef(false);
  const pendingAutoLoadRef = useRef<{ source: Source; page: number; previousItemCount: number } | null>(null);
  const paginationStateRef = useRef<{
    busy: boolean;
    groups: SearchGroup[];
    onLoadMore: (source: Source, page: number) => void;
  }>({
    busy: true,
    groups: [],
    onLoadMore: onLoadMoreSearchSource
  });
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [completedPagination, setCompletedPagination] = useState<{
    context: string;
    source: Source;
    page: number;
    previousItemCount: number;
  } | null>(null);
  const openFilterSheet = useCallback(() => setFilterSheetVisible(true), []);
  const closeFilterSheet = useCallback(() => setFilterSheetVisible(false), []);
  const resetPaginationFeedback = useCallback(() => {
    autoLoadArmedRef.current = false;
    pendingAutoLoadRef.current = null;
    setCompletedPagination(null);
  }, []);
  const scrollSearchToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  const submitSearch = useCallback(
    (queryOverride?: string) => {
      const nextQuery = (queryOverride ?? query).trim();
      if (busy || !nextQuery) {
        return;
      }
      resetPaginationFeedback();
      Keyboard.dismiss();
      scrollSearchToTop();
      if (queryOverride === undefined) {
        onSearch();
      } else {
        onSearch(nextQuery);
      }
    },
    [busy, onSearch, query, resetPaginationFeedback, scrollSearchToTop]
  );
  const changeSearchSource = useCallback(
    (value: string) => {
      resetPaginationFeedback();
      scrollSearchToTop();
      onSearchSourceChange(value as FeedSource);
    },
    [onSearchSourceChange, resetPaginationFeedback, scrollSearchToTop]
  );
  const applySearchFilter = useCallback(
    (source: Source, filter: SourceSearchFilter) => {
      resetPaginationFeedback();
      scrollSearchToTop();
      onSearchFilterApply(source, filter);
    },
    [onSearchFilterApply, resetPaginationFeedback, scrollSearchToTop]
  );
  const renderTopicCard = useCallback(
    (item: Topic, testID?: string) => (
      <MemoizedTopicCard
        highlightQuery={query}
        readerState={getTopicListItemStateFromIndex(topicStateIndex, item)}
        testID={testID}
        topic={item}
        onOpenTopic={onOpenTopic}
      />
    ),
    [onOpenTopic, query, styles, theme, topicStateIndex]
  );
  useEffect(() => {
    if (searchSource === 'all') {
      setFilterSheetVisible(false);
    }
  }, [searchSource]);
  const visibleSearchGroups = searchGroups;
  const paginationBusy = busy || visibleSearchGroups.some((group) => group.loading || group.loadingMore);
  const paginationContext = `${submittedQuery}\u0000${searchSource}`;
  useLayoutEffect(() => {
    autoLoadArmedRef.current = false;
    pendingAutoLoadRef.current = null;
    setCompletedPagination(null);
  }, [paginationContext]);
  useLayoutEffect(() => {
    const pendingAutoLoad = pendingAutoLoadRef.current;
    if (pendingAutoLoad) {
      const pendingGroup = visibleSearchGroups.find((group) => group.source === pendingAutoLoad.source);
      const paginationCompleted = Boolean(
        pendingGroup &&
        !pendingGroup.error &&
        !pendingGroup.loadingMore &&
        (!pendingGroup.hasMore || pendingGroup.nextPage !== pendingAutoLoad.page)
      );
      if (paginationCompleted) {
        setCompletedPagination({
          context: paginationContext,
          source: pendingAutoLoad.source,
          page: pendingAutoLoad.page,
          previousItemCount: pendingAutoLoad.previousItemCount
        });
      }
      if (!pendingGroup || pendingGroup.error || paginationCompleted) {
        pendingAutoLoadRef.current = null;
      }
    }
    paginationStateRef.current = {
      busy: paginationBusy,
      groups: visibleSearchGroups,
      onLoadMore: onLoadMoreSearchSource
    };
  }, [onLoadMoreSearchSource, paginationBusy, paginationContext, visibleSearchGroups]);
  const searchTerm = query.trim();
  const hasInputValue = query.length > 0;
  const hasSearchTerm = searchTerm.length > 0;
  const hasSubmittedQuery = hasSearchTerm && submittedQuery === searchTerm;
  const showSearchGroups = hasSubmittedQuery && visibleSearchGroups.length > 0;
  const showIdleRecentSearches = !hasInputValue && recentSearches.length > 0;
  const searchFilterEntrySummary =
    searchSource !== 'all'
      ? searchFilterSummary(
          searchSource as Source,
          searchFilterForSource(searchFilters, searchSource as Source),
          categories
        )
      : '';
  const listItems = useMemo(() => {
    if (!showSearchGroups) {
      return [];
    }
    const items = buildSearchListItems({
      groups: visibleSearchGroups,
      mode: searchSource === 'all' ? 'overview' : 'source'
    });
    if (!completedPagination || completedPagination.context !== paginationContext || searchSource === 'all') {
      return items;
    }
    const completedGroup = visibleSearchGroups.find((group) => group.source === completedPagination.source);
    if (!completedGroup) {
      return items;
    }
    let completedTopicCount = 0;
    const insertionIndex = items.findIndex((item) => {
      if (item.type !== 'topic' || item.groupSource !== completedPagination.source) {
        return false;
      }
      completedTopicCount += 1;
      return completedTopicCount === completedPagination.previousItemCount;
    });
    const pageStatus = { type: 'groupPageStatus' as const, group: completedGroup, page: completedPagination.page };
    const pageStatusIndex = insertionIndex >= 0 ? insertionIndex + 1 : items.length;
    return [...items.slice(0, pageStatusIndex), pageStatus, ...items.slice(pageStatusIndex)];
  }, [completedPagination, paginationContext, searchSource, showSearchGroups, visibleSearchGroups]);
  const expectedSearchSources = searchSource === 'all' ? aggregateSearchSources : [searchSource];
  const searchGroupsSettled = expectedSearchSources.every((source) => {
    const group = visibleSearchGroups.find((candidate) => candidate.source === source);
    return Boolean(group && group.settled !== false && !group.loading && !group.loadingMore);
  });
  const searchSettled = Boolean(identityError) || searchGroupsSettled;
  const searchBusy = !identityError && busy;
  const completedSearchAccessibilityLabel = identityError
    ? '搜索结果，L 站访问状态检查失败'
    : !searchGroupsSettled
      ? '搜索结果，等待来源结算'
      : visibleSearchGroups.some((group) => group.items.length > 0)
        ? '搜索结果，已完成，有可打开结果'
        : visibleSearchGroups.length > 0 && visibleSearchGroups.every((group) => !group.loading)
          ? '搜索结果，已完成，结构化回退'
          : '搜索结果，已完成，缺少结构化结果';
  const handleSearchScrollBeginDrag = useCallback(() => {
    const state = paginationStateRef.current;
    autoLoadArmedRef.current = false;
    if (state.busy || pendingAutoLoadRef.current) {
      return;
    }
    autoLoadArmedRef.current = true;
    listRef.current?.recordInteraction();
    listRef.current?.recomputeViewableItems();
  }, []);
  const handleSearchViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<SearchListItem>[] }) => {
      if (!autoLoadArmedRef.current) {
        return;
      }
      const state = paginationStateRef.current;
      if (state.busy || pendingAutoLoadRef.current) {
        autoLoadArmedRef.current = false;
        return;
      }
      const orderedItems = [...viewableItems].sort(
        (left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER)
      );
      for (const token of orderedItems) {
        if (!token.isViewable || token.item.type !== 'groupLoadMore') {
          continue;
        }
        const { group, page } = token.item;
        const currentGroup = state.groups.find((candidate) => candidate.source === group.source);
        if (
          !currentGroup ||
          currentGroup.error ||
          currentGroup.loading ||
          currentGroup.loadingMore ||
          !currentGroup.hasMore ||
          currentGroup.nextPage !== page
        ) {
          continue;
        }
        autoLoadArmedRef.current = false;
        pendingAutoLoadRef.current = {
          source: group.source,
          page,
          previousItemCount: currentGroup.items.length
        };
        state.onLoadMore(group.source, page);
        return;
      }
    },
    []
  );
  useLayoutEffect(() => {
    autoLoadArmedRef.current = false;
  }, [query, searchSource, submittedQuery]);
  const renderSearchListItem = useCallback<ListRenderItem<SearchListItem>>(
    ({ item }) => {
      if (item.type === 'topic') {
        return renderTopicCard(item.topic);
      }
      if (item.type === 'groupHeader') {
        const canOpenSource = item.group.items.length > 0;
        return (
          <Pressable
            testID={`search-overview-source-${item.group.source}`}
            accessibilityLabel={`查看 ${item.group.label} 全部搜索结果`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canOpenSource }}
            android_ripple={androidRipple(theme.primarySoft)}
            disabled={!canOpenSource}
            style={styles.searchGroupHeader}
            onPress={() => changeSearchSource(item.group.source)}
          >
            <View style={styles.searchGroupTitleRow}>
              <Text style={styles.searchGroupTitleText}>{item.group.label}</Text>
              <Text style={styles.searchGroupMetaText}>{item.meta}</Text>
            </View>
            {canOpenSource ? (
              <View style={styles.searchGroupAction}>
                <Text style={styles.searchGroupActionText}>查看全部</Text>
                <ChevronRight size={16} color={theme.primary} strokeWidth={1.8} style={styles.searchGroupChevron} />
              </View>
            ) : null}
          </Pressable>
        );
      }
      if (item.type === 'groupError') {
        const paginationError = Boolean(item.group.nextPage);
        const retryPage = paginationError ? item.group.nextPage : null;
        return (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{item.group.error}</Text>
            <AppButton
              label={paginationError ? `重试加载 ${item.group.label}` : `重试 ${item.group.label}`}
              variant="ghost"
              disabled={busy || (paginationError && !retryPage)}
              onPress={() => {
                if (paginationError) {
                  if (retryPage) {
                    onLoadMoreSearchSource(item.group.source, retryPage);
                  }
                  return;
                }
                onRetrySearchSource(item.group.source);
              }}
            />
          </View>
        );
      }
      if (item.type === 'groupAuthNotice') {
        const authNotice = item.group.authNotice;
        if (!authNotice) {
          return null;
        }
        const noticeBoxStyle =
          authNotice.tone === 'danger'
            ? styles.authNoticeBoxDanger
            : authNotice.tone === 'warning'
              ? styles.authNoticeBoxWarning
              : styles.authNoticeBoxNeutral;
        const noticeTextStyle =
          authNotice.tone === 'danger'
            ? styles.authNoticeTextDanger
            : authNotice.tone === 'warning'
              ? styles.authNoticeTextWarning
              : styles.authNoticeTextNeutral;
        return (
          <View style={[styles.authNoticeBox, noticeBoxStyle]}>
            <Text style={[styles.authNoticeText, noticeTextStyle]}>{authNotice.message}</Text>
          </View>
        );
      }
      if (item.type === 'groupLoading') {
        return <LoadingState text={`${item.group.label} 搜索中...`} />;
      }
      if (item.type === 'groupEmpty') {
        return (
          <View>
            <EmptyText text={searchGroupEmptyText(item.group)} />
          </View>
        );
      }
      if (item.type === 'groupLoadMore') {
        return (
          <View
            accessible
            accessibilityLabel={
              item.group.loadingMore ? `正在加载更多 ${item.group.label}` : `继续下滑加载更多 ${item.group.label}`
            }
            accessibilityLiveRegion={item.group.loadingMore ? 'polite' : 'none'}
            accessibilityState={{ busy: Boolean(item.group.loadingMore) }}
            testID={`search-load-more-${item.group.source}-page-${item.page}`}
            style={[styles.button, styles.buttonGhost]}
          >
            {item.group.loadingMore ? (
              <ActivityIndicator
                testID={`search-load-more-spinner-${item.group.source}`}
                size="small"
                color={theme.primary}
              />
            ) : null}
            <Text style={styles.buttonText}>
              {item.group.loadingMore ? `正在加载更多 ${item.group.label}` : `继续下滑加载更多 ${item.group.label}`}
            </Text>
          </View>
        );
      }
      if (item.type === 'groupPageStatus') {
        return (
          <View
            accessible
            accessibilityLabel={`${item.group.label} 已载入 ${item.group.items.length} 条`}
            accessibilityLiveRegion="polite"
            testID={`search-page-loaded-${item.group.source}-page-${item.page}`}
            style={styles.searchPaginationStatus}
          >
            <Text style={styles.meta}>{`已载入 ${item.group.items.length} 条`}</Text>
          </View>
        );
      }
      return null;
    },
    [busy, changeSearchSource, onLoadMoreSearchSource, onRetrySearchSource, renderTopicCard, styles, theme]
  );
  const keySearchListItem = useCallback((item: SearchListItem) => {
    if (item.type === 'topic') {
      return `topic:${item.groupSource || item.topic.source}:${topicKey(item.topic)}`;
    }
    if (item.type === 'groupHeader') {
      return `${item.group.source}:header`;
    }
    if (item.type === 'groupLoadMore') {
      return `${item.group.source}:${item.type}:${item.page}`;
    }
    if (item.type === 'groupPageStatus') {
      return `${item.group.source}:${item.type}:${item.page}`;
    }
    return `${item.group.source}:${item.type}`;
  }, []);
  const header = useMemo(
    () => (
      <View style={styles.stack}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>搜索</Text>
          {busy ? <ActivityIndicator color={theme.primary} /> : null}
        </View>
        <SearchInputField
          busy={busy}
          query={query}
          styles={styles}
          theme={theme}
          onQueryChange={onQueryChange}
          onSearch={() => submitSearch()}
        />
        <PillRail
          variant="tabs"
          items={feedSourceItems}
          value={searchSource}
          testIDPrefix="search-source"
          onChange={changeSearchSource}
        />
        {identityChecking ? <LoadingState text="正在确认 L 站访问状态" /> : null}
        {identityError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{identityError.message}</Text>
            <View style={styles.actions}>
              {onRetryIdentity ? <AppButton label="重试检测" onPress={onRetryIdentity} /> : null}
              {searchSource === 'linuxdo' && onCheckLinuxDoStatus ? (
                <AppButton label="检查 L 站状态" variant="ghost" onPress={onCheckLinuxDoStatus} />
              ) : null}
            </View>
          </View>
        ) : null}
        {searchSessionNotices.length ? (
          <View style={styles.searchSessionStatusBar}>
            {searchSessionNotices.map((item) => {
              const chipStyle =
                item.notice.tone === 'danger'
                  ? styles.searchSessionStatusChipDanger
                  : item.notice.tone === 'warning'
                    ? styles.searchSessionStatusChipWarning
                    : styles.searchSessionStatusChipNeutral;
              const lightTone = searchSessionNoticeLightTone(item.notice);
              const dotStyle =
                lightTone === 'success'
                  ? styles.searchSessionStatusDotSuccess
                  : lightTone === 'danger'
                    ? styles.searchSessionStatusDotDanger
                    : lightTone === 'warning'
                      ? styles.searchSessionStatusDotWarning
                      : styles.searchSessionStatusDotNeutral;
              const textStyle =
                item.notice.tone === 'danger'
                  ? styles.searchSessionStatusTextDanger
                  : item.notice.tone === 'warning'
                    ? styles.searchSessionStatusTextWarning
                    : styles.searchSessionStatusTextNeutral;
              return (
                <View
                  key={item.source}
                  accessible
                  accessibilityLabel={`${item.label}：${item.notice.message}`}
                  style={[styles.searchSessionStatusChip, chipStyle]}
                >
                  <View style={[styles.searchSessionStatusDot, dotStyle]} />
                  <Text style={styles.searchSessionStatusSource}>{item.label}</Text>
                  <Text numberOfLines={2} style={[styles.searchSessionStatusText, textStyle]}>
                    {item.notice.message}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
        {searchSource !== 'all' ? (
          <SearchFilterEntry
            summary={searchFilterEntrySummary}
            styles={styles}
            theme={theme}
            onPress={openFilterSheet}
          />
        ) : null}
        {linuxDoAiVisible ? (
          <LinuxDoAiControl
            state={linuxDoAiState}
            styles={styles}
            theme={theme}
            onRetry={onRetryLinuxDoAiSearch}
            onToggle={onToggleLinuxDoAiSearch}
          />
        ) : null}
        {showIdleRecentSearches ? (
          <View style={styles.stack}>
            <Text style={styles.meta}>最近搜索</Text>
            <View style={styles.recentSearchList}>
              {recentSearches.map((item, index) => (
                <View key={item} style={[styles.removableChipShell, index > 0 && styles.removableChipShellDivided]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`搜索最近记录 ${item}`}
                    accessibilityState={{ disabled: busy }}
                    android_ripple={androidRipple(theme.primarySoft)}
                    disabled={busy}
                    style={[styles.removableChip, busy && styles.buttonDisabled]}
                    onPress={() => submitSearch(item)}
                  >
                    <History size={17} color={theme.muted} strokeWidth={1.9} style={styles.removableChipIcon} />
                    <Text numberOfLines={2} ellipsizeMode="tail" style={styles.removableChipText}>
                      {item}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`删除最近搜索 ${item}`}
                    android_ripple={androidRipple(theme.primarySoft, true)}
                    style={styles.removableChipClose}
                    onPress={() => onRemoveRecentSearch(item)}
                  >
                    <X size={16} color={theme.muted} strokeWidth={2.2} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    ),
    [
      busy,
      changeSearchSource,
      hasInputValue,
      hasSearchTerm,
      hasSubmittedQuery,
      linuxDoAiState,
      linuxDoAiVisible,
      identityChecking,
      identityError,
      onCheckLinuxDoStatus,
      onQueryChange,
      onRemoveRecentSearch,
      onRetryLinuxDoAiSearch,
      onRetryIdentity,
      onToggleLinuxDoAiSearch,
      openFilterSheet,
      query,
      recentSearches,
      searchFilterEntrySummary,
      searchSessionNotices,
      searchSource,
      showIdleRecentSearches,
      styles,
      submitSearch,
      theme
    ]
  );

  return (
    <View style={styles.content}>
      <FlashList
        ref={listRef}
        accessibilityLabel={hasSubmittedQuery && !searchBusy ? completedSearchAccessibilityLabel : '搜索结果'}
        accessibilityLiveRegion={hasSubmittedQuery ? 'polite' : 'none'}
        accessibilityState={{ busy: hasSubmittedQuery && (searchBusy || !searchSettled) }}
        testID={
          hasSubmittedQuery && !searchBusy && searchSettled
            ? searchSource === 'all'
              ? 'search-all-sources-settled'
              : 'search-complete'
            : undefined
        }
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        data={listItems}
        keyExtractor={keySearchListItem}
        getItemType={(item) => item.type}
        keyboardShouldPersistTaps="handled"
        {...TOPIC_LIST_PERFORMANCE_PROPS}
        onScrollBeginDrag={handleSearchScrollBeginDrag}
        onViewableItemsChanged={handleSearchViewableItemsChanged}
        viewabilityConfig={SEARCH_PAGINATION_VIEWABILITY_CONFIG}
        ListHeaderComponent={header}
        ListFooterComponent={null}
        ListEmptyComponent={
          showSearchGroups || identityError ? null : searchBusy && hasSubmittedQuery ? (
            <LoadingState text="正在搜索..." />
          ) : !hasInputValue ? (
            showIdleRecentSearches ? null : (
              <EmptyText text="输入关键词后开始搜索" />
            )
          ) : !hasSearchTerm ? (
            <EmptyText text="输入关键词后开始搜索" />
          ) : !hasSubmittedQuery ? (
            <EmptyText text="按键盘上的搜索键开始" />
          ) : (
            <EmptyText text="暂无搜索结果" />
          )
        }
        renderItem={renderSearchListItem}
      />
      {searchSource !== 'all' ? (
        <SearchFilterSheet
          categories={categories}
          sessionEpochs={sessionEpochs}
          requestsEnabled={requestsEnabled}
          source={searchSource as Source}
          searchFilters={searchFilters}
          styles={styles}
          theme={theme}
          visible={filterSheetVisible}
          onSearchDiscourseTags={onSearchDiscourseTags}
          onSearchDiscourseUsers={onSearchDiscourseUsers}
          onApply={applySearchFilter}
          onClose={closeFilterSheet}
        />
      ) : null}
    </View>
  );
});
