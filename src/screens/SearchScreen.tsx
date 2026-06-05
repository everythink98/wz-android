import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react-native';
import type { FeedSource, Source, Topic } from '../types';
import { topicKey } from '../readerData';
import type { SearchSort } from '../feedLogic';
import { linuxDoExternalSearchItems } from '../appUtils';
import {
  buildSearchListItems,
  filterSearchGroupsByCategory,
  filterSearchResultsByCategory,
  searchCategoryOptions,
  type SearchGroup,
  type SearchListItem
} from '../searchListItems';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '../topicListItemState';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail, TOUCH_HIT_SLOP } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

export type SearchScope = 'remote' | 'local';

export function SearchScreen({
  busy,
  query,
  recentSearches,
  topicStateIndex,
  results,
  searchGroups,
  scope,
  searchSource,
  sort,
  scrollToTopSignal,
  styles,
  theme,
  onOpenExternalUrl,
  onOpenTopic,
  onLoadMoreSearchSource,
  onRemoveRecentSearch,
  onQueryChange,
  onRetrySearchSource,
  onScopeChange,
  onSearch,
  onSearchSourceChange,
  onSortChange
}: {
  busy: boolean;
  query: string;
  recentSearches: string[];
  topicStateIndex: TopicListItemStateIndex;
  results: Topic[];
  searchGroups: SearchGroup[];
  scope: SearchScope;
  searchSource: FeedSource;
  sort: SearchSort;
  scrollToTopSignal: number;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenExternalUrl: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onLoadMoreSearchSource: (source: Source, page: number) => void;
  onRemoveRecentSearch: (query: string) => void;
  onQueryChange: (value: string) => void;
  onRetrySearchSource: (source: Source) => void;
  onScopeChange: (scope: SearchScope) => void;
  onSearch: () => void;
  onSearchSourceChange: (source: FeedSource) => void;
  onSortChange: (sort: SearchSort) => void;
}) {
  const listRef = useRef<FlashListRef<SearchListItem> | null>(null);
  const renderTopicCard = useCallback((item: Topic) => (
    <MemoizedTopicCard
      highlightQuery={query}
      readerState={getTopicListItemStateFromIndex(topicStateIndex, item)}
      styles={styles}
      theme={theme}
      topic={item}
      onOpenTopic={onOpenTopic}
    />
  ), [onOpenTopic, query, styles, theme, topicStateIndex]);
  const [searchCategoryFilter, setSearchCategoryFilter] = useState('all');
  const [expandedSearchGroups, setExpandedSearchGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setSearchCategoryFilter('all');
  }, [query, scope, searchSource, sort]);
  useEffect(() => {
    setExpandedSearchGroups((current) => {
      const next = { ...current };
      for (const group of searchGroups) {
        if (next[group.source] === undefined) {
          next[group.source] = true;
        }
      }
      for (const source of Object.keys(next)) {
        if (!searchGroups.some((group) => group.source === source)) {
          delete next[source];
        }
      }
      return next;
    });
  }, [searchGroups]);
  const toggleSearchGroup = useCallback((source: Source, expanded: boolean) => {
    setExpandedSearchGroups((current) => ({
      ...current,
      [source]: expanded
    }));
  }, []);
  const searchCategoryItems = useMemo(() => searchCategoryOptions(results), [results]);
  useEffect(() => {
    if (searchCategoryFilter !== 'all' && !searchCategoryItems.some((item) => item.value === searchCategoryFilter)) {
      setSearchCategoryFilter('all');
    }
  }, [searchCategoryFilter, searchCategoryItems]);
  const filteredSearchResults = useMemo(() => filterSearchResultsByCategory(results, searchCategoryFilter), [results, searchCategoryFilter]);
  const visibleSearchGroups = useMemo(() => filterSearchGroupsByCategory(searchGroups, searchCategoryFilter), [searchCategoryFilter, searchGroups]);
  const linuxDoExternalItems = useMemo(() => (
    scope === 'remote' && (searchSource === 'all' || searchSource === 'linuxdo')
      ? linuxDoExternalSearchItems(query)
      : []
  ), [query, scope, searchSource]);
  const showRemoteGroups = scope === 'remote' && query.trim().length > 0;
  const showSearchSort = scope === 'remote' && searchSource === 'v2ex';
  const listItems = useMemo(() => buildSearchListItems({
    busy,
    expandedGroups: expandedSearchGroups,
    filteredResults: filteredSearchResults,
    groups: visibleSearchGroups,
    query,
    remote: showRemoteGroups
  }), [busy, expandedSearchGroups, filteredSearchResults, query, showRemoteGroups, visibleSearchGroups]);
  const renderSearchListItem = useCallback<ListRenderItem<SearchListItem>>(({ item }) => {
    if (item.type === 'topic') {
      return renderTopicCard(item.topic);
    }
    if (item.type === 'groupHeader') {
      const Chevron = item.expanded ? ChevronUp : ChevronDown;
      return (
        <Pressable
          accessibilityLabel={item.expanded ? `收起${item.group.label}搜索结果` : `展开${item.group.label}搜索结果`}
          accessibilityRole="button"
          accessibilityState={{ expanded: item.expanded }}
          android_ripple={androidRipple(theme.primarySoft)}
          hitSlop={TOUCH_HIT_SLOP}
          style={styles.searchGroupHeader}
          onPress={() => toggleSearchGroup(item.group.source, !item.expanded)}
        >
          <View style={styles.searchGroupTitleRow}>
            <Text style={styles.searchGroupTitleText}>{item.group.label}</Text>
            <Text style={styles.searchGroupMetaText}>{item.meta}</Text>
          </View>
          <Chevron size={17} color={theme.muted} strokeWidth={1.8} style={styles.searchGroupChevron} />
        </Pressable>
      );
    }
    if (item.type === 'groupError') {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{item.group.error}</Text>
          <AppButton label={`重试 ${item.group.label}`} variant="ghost" styles={styles} disabled={busy} onPress={() => onRetrySearchSource(item.group.source)} />
        </View>
      );
    }
    if (item.type === 'groupLoading') {
      return <LoadingState text={`${item.group.label} 搜索中...`} styles={styles} theme={theme} />;
    }
    if (item.type === 'groupEmpty') {
      return <EmptyText text="这个来源没有结果" styles={styles} />;
    }
    if (item.type === 'groupLoadMore') {
      return (
        <AppButton
          label={item.group.loadingMore ? '加载中...' : `加载更多 ${item.group.label}`}
          variant="ghost"
          styles={styles}
          disabled={busy || item.group.loadingMore}
          onPress={() => onLoadMoreSearchSource(item.group.source, item.page)}
        />
      );
    }
    return <EmptyText text={item.text} styles={styles} />;
  }, [busy, onLoadMoreSearchSource, onRetrySearchSource, renderTopicCard, styles, theme, toggleSearchGroup]);
  const keySearchListItem = useCallback((item: SearchListItem) => {
    if (item.type === 'topic') {
      return `topic:${item.groupSource || item.topic.source}:${topicKey(item.topic)}`;
    }
    if (item.type === 'groupHeader') {
      return `${item.group.source}:header`;
    }
    if (item.type === 'empty') {
      return 'empty';
    }
    return `${item.group.source}:${item.type}`;
  }, []);
  useEffect(() => {
    if (scrollToTopSignal > 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [scrollToTopSignal]);

  const header = (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>搜索</Text>
        {busy ? <ActivityIndicator color={theme.primary} /> : null}
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={query}
          onChangeText={onQueryChange}
          placeholder="输入关键词"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={onSearch}
        />
        {query ? <IconButton icon={X} label="清空" styles={styles} theme={theme} onPress={() => onQueryChange('')} /> : null}
        <IconButton icon={Search} label="搜索" styles={styles} theme={theme} disabled={busy} onPress={onSearch} />
      </View>
      <PillRail
        items={[
          { value: 'remote', label: '全网' },
          { value: 'local', label: '本地' }
        ]}
        value={scope}
        styles={styles}
        onChange={(value) => onScopeChange(value as SearchScope)}
      />
      <PillRail
        items={[
          { value: 'all', label: '全部' },
          { value: 'v2ex', label: 'V2EX' },
          { value: 'linuxdo', label: 'linux.do' },
          { value: 'nodeseek', label: 'NodeSeek' },
          { value: 'yaohuo', label: '妖火' }
        ]}
        value={searchSource}
        styles={styles}
        onChange={(value) => onSearchSourceChange(value as FeedSource)}
      />
      {showSearchSort ? (
        <PillRail
          items={[
            { value: 'relevance', label: '相关' },
            { value: 'time', label: '按时间' }
          ]}
          value={sort}
          styles={styles}
          onChange={(value) => onSortChange(value as SearchSort)}
        />
      ) : null}
      {searchCategoryItems.length ? (
        <PillRail
          items={[{ value: 'all', label: '分类全部' }, ...searchCategoryItems]}
          value={searchCategoryFilter}
          styles={styles}
          onChange={setSearchCategoryFilter}
        />
      ) : null}
      {linuxDoExternalItems.length ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>linux.do 老帖</Text>
          <View style={styles.actions}>
            {linuxDoExternalItems.map((item) => (
              <AppButton key={item.url} compact label={item.label} styles={styles} onPress={() => onOpenExternalUrl(item.url)} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.stack}>
      {recentSearches.length ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>最近搜索</Text>
          <View style={styles.chipWrap}>
            {recentSearches.map((item) => (
              <View key={item} style={styles.removableChipShell}>
                <Pressable accessibilityRole="button" style={[styles.removableChip, styles.removableChipPadded]} onPress={() => onQueryChange(item)}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.pillText, styles.removableChipText]}>{item}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除最近搜索 ${item}`}
                  hitSlop={14}
                  style={styles.removableChipClose}
                  onPress={() => onRemoveRecentSearch(item)}
                >
                  <X size={12} color={theme.muted} strokeWidth={2.2} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlashList
      ref={listRef}
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={listItems}
      keyExtractor={keySearchListItem}
      getItemType={(item) => item.type}
      keyboardShouldPersistTaps="handled"
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={showRemoteGroups ? null : busy && query.trim()
        ? <LoadingState text="正在搜索..." styles={styles} theme={theme} />
        : <EmptyText text={query.trim() ? '暂无搜索结果' : '输入关键词后开始搜索'} styles={styles} />}
      renderItem={renderSearchListItem}
    />
  );
}
