import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View, type ListRenderItem } from 'react-native';
import { Search, X } from 'lucide-react-native';
import type { FeedSource, Source, Topic } from '../types';
import { topicKey, type ReaderData } from '../readerData';
import type { SearchSort } from '../feedLogic';
import { linuxDoExternalSearchItems, sourceLabel } from '../appUtils';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, ExpandablePanel, IconButton, LoadingState, PillRail } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

export type SearchScope = 'remote' | 'local';

export type SearchGroup = {
  source: Source;
  label: string;
  items: Topic[];
  error?: string;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  nextPage?: number | null;
};

function searchResultCategoryKey(item: Topic) {
  const category = item.categoryId || item.category?.replace(/^#/, '');
  return category ? `${item.source}:${category}` : '';
}

export function SearchScreen({
  busy,
  query,
  recentSearches,
  readerData,
  topicListStateInput,
  results,
  searchGroups,
  scope,
  searchSource,
  sort,
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
  readerData: ReaderData;
  topicListStateInput: NormalizedTopicListStateInput;
  results: Topic[];
  searchGroups: SearchGroup[];
  scope: SearchScope;
  searchSource: FeedSource;
  sort: SearchSort;
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
  const renderTopicItem = useCallback<ListRenderItem<Topic>>(({ item }) => (
    <MemoizedTopicCard
      highlightQuery={query}
      readerState={getTopicListItemState(readerData, item, topicListStateInput)}
      styles={styles}
      theme={theme}
      topic={item}
      onOpenTopic={onOpenTopic}
    />
  ), [onOpenTopic, query, readerData, styles, theme, topicListStateInput]);
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
  const searchCategoryOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const item of results) {
      const key = searchResultCategoryKey(item);
      if (!key || !item.category) {
        continue;
      }
      const current = counts.get(key);
      counts.set(key, {
        label: `${sourceLabel(item.source)} · ${item.category}`,
        count: (current?.count || 0) + 1
      });
    }
    return [...counts.entries()].map(([value, item]) => ({
      value,
      label: `${item.label} ${item.count}`
    }));
  }, [results]);
  useEffect(() => {
    if (searchCategoryFilter !== 'all' && !searchCategoryOptions.some((item) => item.value === searchCategoryFilter)) {
      setSearchCategoryFilter('all');
    }
  }, [searchCategoryFilter, searchCategoryOptions]);
  const filteredSearchResults = useMemo(() => (
    searchCategoryFilter === 'all'
      ? results
      : results.filter((item) => searchResultCategoryKey(item) === searchCategoryFilter)
  ), [results, searchCategoryFilter]);
  const visibleSearchGroups = useMemo(() => searchGroups.map((group) => ({
    ...group,
    items: searchCategoryFilter === 'all'
      ? group.items
      : group.items.filter((item) => searchResultCategoryKey(item) === searchCategoryFilter)
  })), [searchCategoryFilter, searchGroups]);
  const renderedSearchGroups = useMemo(() => visibleSearchGroups.map((group) => (
    <ExpandablePanel
      defaultExpanded
      key={group.source}
      title={group.label}
      meta={group.loading ? '搜索中' : group.error ? '读取失败' : `${group.items.length} 条${group.hasMore ? ' · 可继续加载' : ''}`}
      expanded={expandedSearchGroups[group.source] ?? true}
      styles={styles}
      theme={theme}
      onExpandedChange={(expanded) => toggleSearchGroup(group.source, expanded)}
    >
      {group.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{group.error}</Text>
          <AppButton label={`重试 ${group.label}`} variant="ghost" styles={styles} onPress={() => onRetrySearchSource(group.source)} />
        </View>
      ) : null}
      {group.loading ? <LoadingState text={`${group.label} 搜索中...`} styles={styles} theme={theme} /> : null}
      {group.items.map((item) => (
        <MemoizedTopicCard
          key={topicKey(item)}
          highlightQuery={query}
          readerState={getTopicListItemState(readerData, item, topicListStateInput)}
          styles={styles}
          theme={theme}
          topic={item}
          onOpenTopic={onOpenTopic}
        />
      ))}
      {!group.loading && !group.error && !group.items.length ? <EmptyText text="这个来源没有结果" styles={styles} /> : null}
      {!group.loading && !group.error && group.hasMore && group.nextPage ? (
        <AppButton
          label={group.loadingMore ? '加载中...' : `加载更多 ${group.label}`}
          variant="ghost"
          styles={styles}
          disabled={busy || group.loadingMore}
          onPress={() => onLoadMoreSearchSource(group.source, group.nextPage || 1)}
        />
      ) : null}
    </ExpandablePanel>
  )), [busy, expandedSearchGroups, onLoadMoreSearchSource, onOpenTopic, onRetrySearchSource, query, readerData, styles, theme, toggleSearchGroup, topicListStateInput, visibleSearchGroups]);
  const linuxDoExternalItems = useMemo(() => (
    scope === 'remote' && (searchSource === 'all' || searchSource === 'linuxdo')
      ? linuxDoExternalSearchItems(query)
      : []
  ), [query, scope, searchSource]);
  const showRemoteGroups = scope === 'remote' && query.trim().length > 0;
  const showSearchSort = scope === 'remote' && searchSource === 'v2ex';

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
      {searchCategoryOptions.length ? (
        <PillRail
          items={[{ value: 'all', label: '分类全部' }, ...searchCategoryOptions]}
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
      {showRemoteGroups ? (
        <View style={styles.stack}>
          {visibleSearchGroups.length ? renderedSearchGroups : <EmptyText text={busy ? '正在搜索...' : '暂无搜索结果'} styles={styles} />}
        </View>
      ) : null}
      {recentSearches.length ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>最近搜索</Text>
          <View style={styles.chipWrap}>
            {recentSearches.map((item) => (
              <View key={item} style={styles.removableChipShell}>
                <Pressable accessibilityRole="button" style={[styles.removableChip, styles.removableChipPadded]} onPress={() => onQueryChange(item)}>
                  <Text style={styles.pillText}>{item}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除最近搜索 ${item}`}
                  hitSlop={8}
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
    <FlatList
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={showRemoteGroups ? [] : filteredSearchResults}
      keyExtractor={topicKey}
      keyboardShouldPersistTaps="handled"
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={showRemoteGroups ? null : busy && query.trim()
        ? <LoadingState text="正在搜索..." styles={styles} theme={theme} />
        : <EmptyText text={query.trim() ? '暂无搜索结果' : '输入关键词后开始搜索'} styles={styles} />}
      renderItem={renderTopicItem}
    />
  );
}
