import { ActivityIndicator, Searchbar } from 'react-native-paper';
import { AppSwitch } from '@/ui/controls/InputControls';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { createSearchStyles, type SearchStyles } from './styles';
import type { SearchFilterPlacement } from './SearchFilterSheet';
import {
  Fragment,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type RefObject
} from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import {
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  requireNativeComponent,
  type ColorValue,
  type ViewProps
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem, type ViewToken } from '@shopify/flash-list';
import { ChevronRight, ExternalLink, History, Search, Sparkles, X } from 'lucide-react-native';
import type { FeedSource, Source, Topic } from '@/domain/forum/models';
import { topicKey } from '@/domain/reader/readerData';
import { sourceLabel } from '@/domain/forum/presentation';
import {
  buildSearchListItems,
  searchGroupEmptyText,
  searchGroupRetryPage,
  type SearchGroup,
  type SearchListItem
} from './listItems';
import type { LinuxDoAiSearchState } from './aiSearch';
import { type SourceSearchFilter } from '@/domain/forum/searchFilters';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { AuthNoticeBox, EmptyText, LoadingState, RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { ContentLoadingPlaceholder } from '@/ui/controls/ContentLoadingPlaceholder';
import { PillRail } from '@/ui/controls/SelectionControls';
import { MemoizedTopicCard, TopicListSeparator } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';

type SearchPageAttempt = {
  phase: 'awaiting' | 'settled';
  permission: 'unarmed' | 'armed';
  source: Source;
  page: number;
  previousItemCount: number;
};

type SearchPageAuthority = { phase: 'empty'; permission: 'unarmed' | 'armed' } | SearchPageAttempt;

type SearchPageFeedback =
  'none' | { phase: 'completed'; context: string; source: Source; page: number; previousItemCount: number };

const SEARCH_PAGINATION_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 0,
  waitForInteraction: true
};
const NativeRecentIcon = requireNativeComponent<ViewProps & { icon: 'history' | 'close'; color: ColorValue }>(
  'WzSearchHistoryIcon'
);

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
  const inputRef = useRef<ComponentRef<typeof Searchbar>>(null);
  const submitDisabled = busy || !query.trim();
  const submitSearch = () => {
    if (!submitDisabled) onSearch();
  };
  return (
    <Searchbar
      ref={inputRef}
      testID="search-query"
      accessibilityLabel="搜索关键词"
      searchAccessibilityLabel="聚焦搜索关键词"
      icon={() => <Search size={18} color={theme.muted} strokeWidth={1.9} accessible={false} />}
      clearIcon={() => null}
      style={styles.searchInputShell}
      inputStyle={styles.searchInput}
      value={query}
      onChange={recordUserInteraction}
      onChangeText={onQueryChange}
      placeholder="输入关键词"
      placeholderTextColor={theme.muted}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      onSubmitEditing={submitSearch}
      onIconPress={() => {
        recordUserInteraction();
        inputRef.current?.focus();
      }}
      right={() => (
        <View style={styles.searchInputActions}>
          {query ? (
            <IconButton
              label="清空搜索关键词"
              icon={X}
              iconSize={18}
              iconOnly
              ghost
              onPress={() => onQueryChange('')}
            />
          ) : null}
          <View style={styles.searchSubmitSlot}>
            <AppButton
              testID="search-submit"
              accessibilityLabel="提交搜索"
              size="lg"
              label="搜索"
              variant="ghost"
              disabled={submitDisabled}
              onPress={submitSearch}
            />
          </View>
        </View>
      )}
    />
  );
}
function LinuxDoAiControl({
  active,
  state,
  styles,
  theme,
  onRetry,
  onToggle
}: {
  active: boolean;
  state: LinuxDoAiSearchState;
  styles: SearchStyles;
  theme: ReaderTheme;
  onRetry: () => void;
  onToggle: () => void;
}) {
  const disabled = state.status !== 'ready';
  const statusText =
    state.status === 'loading'
      ? '加载中'
      : state.status === 'ready'
        ? `${state.count} 条 AI 结果`
        : state.message || '';
  return (
    <View style={styles.searchFilterTrigger}>
      <View style={styles.searchFilterEntryIcon}>
        {state.status === 'loading' ? (
          <ActivityIndicator animating={active} size={16} color={theme.primary} />
        ) : (
          <Sparkles size={16} color={theme.primary} strokeWidth={1.8} accessible={false} />
        )}
      </View>
      <Text style={styles.searchFilterEntryText}>AI 搜索</Text>
      <Text numberOfLines={1} style={styles.searchFilterEntrySummary}>
        {statusText}
      </Text>
      {state.status === 'error' ? (
        <AppButton compact label="重试" accessibilityLabel="重试 AI 搜索" onPress={onRetry} />
      ) : (
        <AppSwitch
          accessibilityLabel="AI 搜索"
          accessibilityState={{ checked: state.enabled, disabled }}
          disabled={disabled}
          value={state.enabled}
          onValueChange={onToggle}
        />
      )}
    </View>
  );
}

export const SearchScreen = memo(function SearchScreen({
  active = true,
  isRouteFocused,
  busy,
  renderFilters,
  query,
  readScope,
  recentSearches,
  topicStateIndex,
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
  onToggleLinuxDoAiSearch,
  onSearchSourceChange
}: {
  active?: boolean;
  isRouteFocused?: () => boolean;
  busy: boolean;
  renderFilters: (placement: SearchFilterPlacement) => ReactNode;
  query: string;
  readScope: string;
  recentSearches: string[];
  topicStateIndex: TopicListItemStateIndex;
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
  onLoadMoreSearchSource: (source: Source, page: number) => void | Promise<unknown>;
  onRemoveRecentSearch: (query: string) => void;
  onQueryChange: (value: string) => void;
  onRetrySearchSource: (source: Source) => void;
  onRetryLinuxDoAiSearch: () => void;
  onSearch: (queryOverride?: string) => void;
  onSearchFilterApply: (source: Source, filter: SourceSearchFilter) => void;
  onToggleLinuxDoAiSearch: () => void;
  onSearchSourceChange: (source: FeedSource) => void;
}) {
  const { settings, styles, theme } = useReaderThemeStyles(createSearchStyles);
  const internalListRef = useRef<FlashListRef<SearchListItem> | null>(null);
  const bottomBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const listRef = scrollRef || internalListRef;
  const pageAuthority = useRef<SearchPageAuthority>({ phase: 'empty', permission: 'unarmed' });
  const paginationStateRef = useRef<{
    busy: boolean;
    groups: SearchGroup[];
    onLoadMore: (source: Source, page: number) => void | Promise<unknown>;
  }>({
    busy: true,
    groups: [],
    onLoadMore: onLoadMoreSearchSource
  });
  const [completedPagination, setCompletedPagination] = useState<SearchPageFeedback>('none');
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
  const filterSource =
    visibleSearchSource !== 'all' && !externalSearchSources.includes(visibleSearchSource) ? visibleSearchSource : null;
  const resetPaginationFeedback = useCallback(() => {
    pageAuthority.current = { phase: 'empty', permission: 'unarmed' };
    setCompletedPagination('none');
  }, []);
  const scrollSearchToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  const submitSearch = useCallback(
    (queryOverride?: string) => {
      const nextQuery = (queryOverride ?? query).trim();
      if (isRouteFocused?.() === false || busy || !nextQuery) {
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
    [busy, isRouteFocused, onSearch, query, resetPaginationFeedback, scrollSearchToTop]
  );
  const changeSearchSource = useCallback(
    (value: string) => {
      if (isRouteFocused?.() === false || value === visibleSearchSource) return;
      if (value !== 'all' && !expectedSearchSources.includes(value as Source)) return;
      resetPaginationFeedback();
      scrollSearchToTop();
      onSearchSourceChange(value as FeedSource);
    },
    [
      expectedSearchSources,
      isRouteFocused,
      onSearchSourceChange,
      resetPaginationFeedback,
      scrollSearchToTop,
      visibleSearchSource
    ]
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
      <View style={styles.searchTopicRow}>
        <MemoizedTopicCard
          highlightQuery={query}
          readerState={getTopicListItemStateFromIndex(topicStateIndex, item)}
          showSource={visibleSearchSource === 'all'}
          testID={testID}
          topic={item}
          onOpenTopic={onOpenTopic}
        />
      </View>
    ),
    [onOpenTopic, query, styles, topicStateIndex, visibleSearchSource]
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
  useLayoutEffect(() => {
    pageAuthority.current = { phase: 'empty', permission: 'unarmed' };
    setCompletedPagination('none');
  }, [readScope]);
  useLayoutEffect(() => {
    const pendingAutoLoad = pageAuthority.current;
    if (pendingAutoLoad.phase !== 'empty') {
      const pendingGroup = visibleSearchGroups.find((group) => group.source === pendingAutoLoad.source);
      const paginationCompleted = Boolean(
        pendingGroup &&
        !pendingGroup.error &&
        !pendingGroup.loadingMore &&
        (!pendingGroup.hasMore || pendingGroup.nextPage !== pendingAutoLoad.page)
      );
      if (paginationCompleted) {
        setCompletedPagination({
          phase: 'completed',
          context: readScope,
          source: pendingAutoLoad.source,
          page: pendingAutoLoad.page,
          previousItemCount: pendingAutoLoad.previousItemCount
        });
      }
      if (!pendingGroup || pendingGroup.error || paginationCompleted) {
        pageAuthority.current = { phase: 'empty', permission: pageAuthority.current.permission };
      }
    }
    paginationStateRef.current = {
      busy: paginationBusy,
      groups: visibleSearchGroups,
      onLoadMore: onLoadMoreSearchSource
    };
  }, [onLoadMoreSearchSource, paginationBusy, readScope, visibleSearchGroups]);
  const searchTerm = query.trim();
  const hasInputValue = query.length > 0;
  const hasSearchTerm = searchTerm.length > 0;
  const hasSubmittedQuery = hasSearchTerm && submittedQuery === searchTerm;
  const showSearchGroups = hasSubmittedQuery && visibleSearchGroups.length > 0;
  const showIdleRecentSearches = !allSourcesDisabled && !hasInputValue && recentSearches.length > 0;
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
    if (completedPagination === 'none' || completedPagination.context !== readScope || visibleSearchSource === 'all') {
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
    readScope,
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
    pageAuthority.current.permission = 'unarmed';
    if (state.busy || pageAuthority.current.phase === 'awaiting') {
      return;
    }
    pageAuthority.current.permission = 'armed';
    listRef.current?.recordInteraction();
    listRef.current?.recomputeViewableItems();
  }, []);
  const handleSearchViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<SearchListItem>[] }) => {
      if (pageAuthority.current.permission !== 'armed') {
        return;
      }
      const state = paginationStateRef.current;
      if (state.busy || pageAuthority.current.phase === 'awaiting') {
        pageAuthority.current.permission = 'unarmed';
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
        pageAuthority.current.permission = 'unarmed';
        const pendingAutoLoad: SearchPageAttempt = {
          source: group.source,
          page,
          previousItemCount: currentGroup.items.length,
          phase: 'awaiting',
          permission: pageAuthority.current.permission
        };
        pageAuthority.current = pendingAutoLoad;
        const settle = () => {
          // Keep page feedback until Query commits; only settle this request's lock.
          pendingAutoLoad.phase = 'settled';
        };
        void Promise.resolve(state.onLoadMore(group.source, page)).then(settle, settle);
        return;
      }
    },
    []
  );
  useLayoutEffect(() => {
    pageAuthority.current.permission = 'unarmed';
  }, [query]);
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
              {Platform.OS === 'android' ? (
                <NativeRecentIcon
                  icon="history"
                  color={theme.muted}
                  accessible={false}
                  style={{ width: 17, height: 17, flexShrink: 0 }}
                />
              ) : (
                <History size={17} color={theme.muted} strokeWidth={1.9} style={styles.removableChipIcon} />
              )}
              <Text numberOfLines={2} ellipsizeMode="tail" style={styles.removableChipText}>
                {item.query}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`删除最近搜索 ${item.query}`}
              style={styles.removableChipClose}
              onPress={() => {
                if (isRouteFocused?.() !== false) onRemoveRecentSearch(item.query);
              }}
            >
              {Platform.OS === 'android' ? (
                <NativeRecentIcon
                  icon="close"
                  color={theme.muted}
                  accessible={false}
                  style={{ width: 16, height: 16 }}
                />
              ) : (
                <X size={16} color={theme.muted} strokeWidth={2.2} />
              )}
            </Pressable>
          </View>
        );
      }
      if (item.type === 'topic') {
        return renderTopicCard(item.topic);
      }
      if (item.type === 'groupHeader') {
        const canOpenSource = item.group.items.length > 0 || Boolean(item.group.hasMore && item.group.nextPage);
        return (
          <Pressable
            testID={`search-overview-source-${item.group.source}`}
            accessibilityLabel={`查看 ${item.group.label} 全部搜索结果`}
            accessibilityValue={{ text: item.meta }}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canOpenSource, busy: Boolean(item.group.loading) }}
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
        const overview = visibleSearchSource === 'all';
        return (
          <View style={overview ? styles.searchFilterEntry : styles.sectionHeader}>
            {overview ? <Text style={[styles.searchFilterEntryText, styles.flex]}>{item.group.label}</Text> : null}
            <AppButton
              compact
              icon={ExternalLink}
              label={overview ? '去 Google 搜索' : '再次去 Google 搜索'}
              accessibilityLabel={`在 Google 搜索 ${item.group.label}`}
              testID={`search-external-${item.group.source}`}
              onPress={() => onOpenExternalSearch(item.url)}
            />
          </View>
        );
      }
      if (item.type === 'groupError') {
        const retryPage = searchGroupRetryPage(item.group);
        return (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{item.group.error}</Text>
            <AppButton
              label={retryPage ? `重试加载 ${item.group.label}` : `重试 ${item.group.label}`}
              variant="ghost"
              disabled={busy}
              onPress={() => {
                if (retryPage) {
                  onLoadMoreSearchSource(item.group.source, retryPage);
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
        const text = item.group.items.length ? '刷新中' : `${item.group.label} 搜索中`;
        return active && visibleSearchSource !== 'all' && !item.group.items.length ? (
          <ContentLoadingPlaceholder layout="list" text={text} />
        ) : (
          <LoadingState compact text={text} animating={active} />
        );
      }
      if (item.type === 'groupEmpty') {
        const nextPage = item.group.hasMore && !item.group.error ? item.group.nextPage : null;
        return (
          <View>
            <EmptyText text={searchGroupEmptyText(item.group)} />
            {visibleSearchSource !== 'all' && nextPage ? (
              <AppButton
                label={`继续搜索 ${item.group.label}`}
                variant="ghost"
                disabled={busy || item.group.loadingMore}
                onPress={() => onLoadMoreSearchSource(item.group.source, nextPage)}
              />
            ) : null}
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
      isRouteFocused,
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
    ({ leadingItem, trailingItem }: { leadingItem: SearchListItem; trailingItem: SearchListItem }) => {
      if (leadingItem.type === 'topic' && trailingItem.type === 'topic') return <TopicListSeparator />;
      if (leadingItem.type === 'recentSearch' && trailingItem.type === 'recentSearch') return null;
      return <View style={styles.listSeparator} />;
    },
    [styles]
  );
  const aiControlActive = linuxDoAiVisible && active;
  const filterEntry = useMemo(
    () =>
      filterSource && (
        <Fragment key={filterSource}>
          {renderFilters({ source: filterSource, onApply: applySearchFilter, styles, theme })}
        </Fragment>
      ),
    [applySearchFilter, filterSource, renderFilters, styles, theme]
  );
  const header = useMemo(
    () => (
      <View style={[styles.stack, styles.listHeader]}>
        <SearchInputField
          busy={busy}
          query={query}
          styles={styles}
          theme={theme}
          onQueryChange={onQueryChange}
          onSearch={() => submitSearch()}
        />
        <View style={styles.searchScopeBar}>
          <PillRail
            compactTabs
            variant="tabs"
            items={enabledSearchSourceItems}
            value={visibleSearchSource}
            testIDPrefix="search-source"
            onChange={changeSearchSource}
          />
          {filterEntry}
          {linuxDoAiVisible ? (
            <LinuxDoAiControl
              active={aiControlActive}
              state={linuxDoAiState}
              styles={styles}
              theme={theme}
              onRetry={onRetryLinuxDoAiSearch}
              onToggle={onToggleLinuxDoAiSearch}
            />
          ) : null}
        </View>
      </View>
    ),
    [
      aiControlActive,
      busy,
      changeSearchSource,
      enabledSearchSourceItems,
      linuxDoAiState,
      linuxDoAiVisible,
      onQueryChange,
      onRetryLinuxDoAiSearch,
      onToggleLinuxDoAiSearch,
      query,
      filterEntry,
      styles,
      submitSearch,
      theme,
      visibleSearchSource
    ]
  );

  const onPageLayout = useStartupPageLayout();
  return (
    <View style={styles.content} onLayout={onPageLayout}>
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
        contentContainerStyle={[styles.contentInner, { paddingBottom: Math.max(96, bottomBarHeight + 16) }]}
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
            <RecoverableEmptyState
              message="尚未启用内容源"
              actionLabel="前往更多管理"
              onAction={onManageContentSources}
            />
          ) : showSearchGroups ? null : searchBusy && hasSubmittedQuery ? (
            <ContentLoadingPlaceholder layout="list" text="搜索中" />
          ) : !hasSubmittedQuery ? null : (
            <EmptyText text="暂无搜索结果" />
          )
        }
        renderItem={renderSearchListItem}
      />
    </View>
  );
});
