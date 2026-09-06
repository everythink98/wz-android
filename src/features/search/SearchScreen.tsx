import { createSearchStyles, type SearchStyles } from './styles';
import { SearchFilterSheet } from './SearchFilterSheet';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem, type ViewToken } from '@shopify/flash-list';
import { ChevronRight, History, Search, X } from 'lucide-react-native';
import type {
  Category,
  DiscourseTagOption,
  DiscourseUserOption,
  FeedSource,
  Source,
  Topic
} from '@/domain/forum/models';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import { topicKey } from '@/domain/reader/readerData';
import { sourceLabel } from '@/domain/forum/presentation';
import { buildSearchListItems, searchGroupEmptyText, type SearchGroup, type SearchListItem } from './listItems';
import type { LinuxDoAiSearchState } from './aiSearch';
import {
  searchFilterForSource,
  searchFilterSummary,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from '@/ui/controls/ButtonControls';
import { AuthNoticeBox, EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
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
  searchCandidateReadPlanScopes,
  query,
  recentSearches,
  topicStateIndex,
  searchFilters,
  searchGroups,
  expectedSearchSources,
  externalSearchSources = [],
  linuxDoAiState,
  linuxDoAiVisible,
  searchSource,
  submittedQuery,
  scrollRef,
  onOpenExternalSearch = () => undefined,
  onOpenTopic,
  onManageContentSources,
  onLoadMoreSearchSource,
  onRemoveRecentSearch,
  onQueryChange,
  onRetrySearchSource,
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
  searchCandidateReadPlanScopes: { tags: string; users: string };
  query: string;
  recentSearches: string[];
  topicStateIndex: TopicListItemStateIndex;
  searchFilters: SearchFilterState;
  searchGroups: SearchGroup[];
  expectedSearchSources: readonly Source[];
  externalSearchSources?: readonly Source[];
  linuxDoAiState: LinuxDoAiSearchState;
  linuxDoAiVisible: boolean;
  searchSource: FeedSource;
  submittedQuery: string;
  scrollRef?: RefObject<FlashListRef<SearchListItem> | null>;
  onOpenExternalSearch?: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onManageContentSources: () => void;
  onLoadMoreSearchSource: (source: Source, page: number) => void;
  onRemoveRecentSearch: (query: string) => void;
  onQueryChange: (value: string) => void;
  onRetrySearchSource: (source: Source) => void;
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
  const { settings, styles, theme } = useReaderThemeStyles(createSearchStyles);
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
  const [completedPagination, setCompletedPagination] = useState<{
    context: string;
    source: Source;
    page: number;
    previousItemCount: number;
  } | null>(null);
  const enabledSearchSourceItems = useMemo(
    () => [
      { value: 'all' as const, label: '全部' },
      ...expectedSearchSources.map((source) => ({ value: source, label: sourceLabel(source) }))
    ],
    [expectedSearchSources]
  );
  const allSourcesDisabled = expectedSearchSources.length === 0;
  const visibleSearchSource =
    searchSource === 'all' || expectedSearchSources.includes(searchSource) ? searchSource : 'all';
  const externalSearchSelected =
    visibleSearchSource !== 'all' && externalSearchSources.includes(visibleSearchSource as Source);
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
      if (value !== 'all' && !expectedSearchSources.includes(value as Source)) return;
      resetPaginationFeedback();
      scrollSearchToTop();
      onSearchSourceChange(value as FeedSource);
    },
    [expectedSearchSources, onSearchSourceChange, resetPaginationFeedback, scrollSearchToTop]
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
  const visibleSearchGroups = useMemo(
    () =>
      visibleSearchSource === 'all'
        ? expectedSearchSources.flatMap((source) => {
            const group = searchGroups.find((candidate) => candidate.source === source);
            return group ? [group] : [];
          })
        : searchGroups.filter((group) => group.source === visibleSearchSource),
    [expectedSearchSources, searchGroups, visibleSearchSource]
  );
  const paginationBusy = busy || visibleSearchGroups.some((group) => group.loading || group.loadingMore);
  const paginationContext = `${submittedQuery}\u0000${visibleSearchSource}`;
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
  const showIdleRecentSearches = !allSourcesDisabled && !hasInputValue && recentSearches.length > 0;
  const searchFilterEntrySummary =
    visibleSearchSource !== 'all'
      ? searchFilterSummary(
          visibleSearchSource as Source,
          searchFilterForSource(searchFilters, visibleSearchSource as Source),
          categories
        )
      : '';
  const listItems = useMemo(() => {
    if (showIdleRecentSearches) {
      return [
        { type: 'recentHeader' as const },
        ...recentSearches.map((recentQuery) => ({ type: 'recentSearch' as const, query: recentQuery }))
      ];
    }
    if (!showSearchGroups) {
      return [];
    }
    const items = buildSearchListItems({
      groups: visibleSearchGroups,
      mode: visibleSearchSource === 'all' ? 'overview' : 'source'
    });
    if (!completedPagination || completedPagination.context !== paginationContext || visibleSearchSource === 'all') {
      return items;
    }
    const completedGroup = visibleSearchGroups.find((group) => group.source === completedPagination.source);
    if (!completedGroup) {
      return items;
    }
    let completedTopicCount = 0;
    let insertionIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item?.type !== 'topic' || item.groupSource !== completedPagination.source) continue;
      completedTopicCount += 1;
      if (completedTopicCount !== completedPagination.previousItemCount) continue;
      insertionIndex = index;
      break;
    }
    const pageStatus = { type: 'groupPageStatus' as const, group: completedGroup, page: completedPagination.page };
    const pageStatusIndex = insertionIndex >= 0 ? insertionIndex + 1 : items.length;
    return [...items.slice(0, pageStatusIndex), pageStatus, ...items.slice(pageStatusIndex)];
  }, [
    completedPagination,
    paginationContext,
    recentSearches,
    showIdleRecentSearches,
    showSearchGroups,
    visibleSearchGroups,
    visibleSearchSource
  ]);
  const settledSearchSources = visibleSearchSource === 'all' ? expectedSearchSources : [visibleSearchSource];
  const searchGroupsSettled = settledSearchSources.every((source) => {
    const group = visibleSearchGroups.find((candidate) => candidate.source === source);
    return Boolean(group && group.settled !== false && !group.loading && !group.loadingMore);
  });
  const searchSettled = searchGroupsSettled;
  const searchBusy = busy;
  const completedSearchAccessibilityLabel = allSourcesDisabled
    ? '搜索结果，尚未启用内容源'
    : !searchGroupsSettled
      ? '搜索结果，等待来源结算'
      : visibleSearchGroups.some((group) => group.items.length > 0 || group.externalSearchUrl)
        ? visibleSearchGroups.some((group) => group.externalSearchUrl)
          ? '搜索结果，已完成，有可打开入口'
          : '搜索结果，已完成，有可打开结果'
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
  }, [query, submittedQuery, visibleSearchSource]);
  const renderSearchListItem = useCallback<ListRenderItem<SearchListItem>>(
    ({ index, item }) => {
      if (item.type === 'recentHeader') {
        return <Text style={styles.meta}>最近搜索</Text>;
      }
      if (item.type === 'recentSearch') {
        const first = index === 1;
        const last = index === recentSearches.length;
        return (
          <View
            style={[
              styles.recentSearchItem,
              first && styles.recentSearchItemFirst,
              !first && styles.recentSearchItemJoined,
              last && styles.recentSearchItemLast,
              styles.removableChipShell
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`搜索最近记录 ${item.query}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.removableChip, busy && styles.buttonDisabled]}
              onPress={() => submitSearch(item.query)}
            >
              <History size={17} color={theme.muted} strokeWidth={1.9} style={styles.removableChipIcon} />
              <Text numberOfLines={2} ellipsizeMode="tail" style={styles.removableChipText}>
                {item.query}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`删除最近搜索 ${item.query}`}
              style={styles.removableChipClose}
              onPress={() => onRemoveRecentSearch(item.query)}
            >
              <X size={16} color={theme.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
        );
      }
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
      if (item.type === 'externalSearch') {
        return (
          <View style={styles.searchFilterEntry}>
            <View style={styles.searchFilterEntryIcon}>
              <Search size={17} color={theme.primary} strokeWidth={1.9} />
            </View>
            <Text style={styles.searchFilterEntrySummary}>打开主题后，可从浏览器菜单选择“在阅坛中打开当前主题”</Text>
            <AppButton
              compact
              label={visibleSearchSource === 'all' ? '去 Google 搜索' : '再次去 Google 搜索'}
              testID={`search-external-${item.group.source}`}
              onPress={() => onOpenExternalSearch(item.url)}
            />
          </View>
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
        return <AuthNoticeBox notice={authNotice} />;
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
    [
      busy,
      changeSearchSource,
      onLoadMoreSearchSource,
      onOpenExternalSearch,
      onRemoveRecentSearch,
      onRetrySearchSource,
      recentSearches.length,
      renderTopicCard,
      styles,
      submitSearch,
      theme,
      visibleSearchSource
    ]
  );
  const keySearchListItem = useCallback((item: SearchListItem) => {
    if (item.type === 'recentHeader') {
      return 'recent:header';
    }
    if (item.type === 'recentSearch') {
      return `recent:${item.query}`;
    }
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
  const renderSearchListSeparator = useCallback(
    ({ leadingItem, trailingItem }: { leadingItem: SearchListItem; trailingItem: SearchListItem }) =>
      leadingItem.type === 'recentSearch' && trailingItem.type === 'recentSearch' ? null : (
        <View style={styles.listSeparator} />
      ),
    [styles]
  );
  const header = useMemo(
    () => (
      <View style={[styles.stack, styles.listHeader]}>
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
          compactTabs
          variant="tabs"
          items={enabledSearchSourceItems}
          value={visibleSearchSource}
          testIDPrefix="search-source"
          onChange={changeSearchSource}
        />
        {visibleSearchSource !== 'all' && !externalSearchSelected ? (
          <SearchFilterSheet
            categories={categories}
            readPlanScopes={searchCandidateReadPlanScopes}
            sessionEpochs={sessionEpochs}
            requestsEnabled={requestsEnabled}
            source={visibleSearchSource as Source}
            searchFilters={searchFilters}
            summary={searchFilterEntrySummary}
            styles={styles}
            theme={theme}
            onSearchDiscourseTags={onSearchDiscourseTags}
            onSearchDiscourseUsers={onSearchDiscourseUsers}
            onApply={applySearchFilter}
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
      </View>
    ),
    [
      applySearchFilter,
      busy,
      categories,
      changeSearchSource,
      enabledSearchSourceItems,
      externalSearchSelected,
      expectedSearchSources,
      hasInputValue,
      hasSearchTerm,
      hasSubmittedQuery,
      linuxDoAiState,
      linuxDoAiVisible,
      onQueryChange,
      onRetryLinuxDoAiSearch,
      onToggleLinuxDoAiSearch,
      onSearchDiscourseTags,
      onSearchDiscourseUsers,
      query,
      requestsEnabled,
      searchCandidateReadPlanScopes,
      searchFilters,
      searchFilterEntrySummary,
      sessionEpochs,
      styles,
      submitSearch,
      theme,
      visibleSearchSource
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
            ? visibleSearchSource === 'all'
              ? 'search-all-sources-settled'
              : 'search-complete'
            : undefined
        }
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        data={listItems}
        extraData={settings}
        keyExtractor={keySearchListItem}
        getItemType={(item) => item.type}
        ItemSeparatorComponent={renderSearchListSeparator}
        keyboardShouldPersistTaps="handled"
        {...TOPIC_LIST_PERFORMANCE_PROPS}
        onScrollBeginDrag={handleSearchScrollBeginDrag}
        onViewableItemsChanged={handleSearchViewableItemsChanged}
        viewabilityConfig={SEARCH_PAGINATION_VIEWABILITY_CONFIG}
        ListHeaderComponent={header}
        ListFooterComponent={null}
        ListEmptyComponent={
          allSourcesDisabled ? (
            <View>
              <EmptyText text="尚未启用内容源" />
              <AppButton label="前往更多管理" onPress={onManageContentSources} />
            </View>
          ) : showSearchGroups ? null : searchBusy && hasSubmittedQuery ? (
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
    </View>
  );
});
