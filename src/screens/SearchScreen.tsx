import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from 'lucide-react-native';
import type { Category, FeedSource, Source, Topic } from '../types';
import { topicKey } from '../readerData';
import { linuxDoExternalSearchItems, sourceLabel } from '../appUtils';
import { feedSourceItems } from '../feedCategoryRail';
import {
  buildSearchListItems,
  type SearchGroup,
  type SearchListItem
} from '../searchListItems';
import {
  defaultSearchFilterForSource,
  searchFilterForSource,
  searchFilterSummary,
  searchTimeRangeItems,
  type SearchFilterState,
  type SourceSearchFilter
} from '../searchFilters';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '../topicListItemState';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, LoadingState, PillRail, TOUCH_HIT_SLOP } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

function sourceCategories(categories: Category[], source: Source) {
  return categories.filter((category) => category.source === source);
}

function categoryOptions(categories: Category[], source: Source) {
  const allLabel = source === 'yaohuo' ? '全部版块' : source === 'v2ex' ? '不限节点' : '全部分类';
  const allValue = source === 'yaohuo' ? '0' : '';
  return [
    { value: allValue, label: allLabel },
    ...sourceCategories(categories, source).map((category) => ({ value: category.id, label: category.name }))
  ];
}

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
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
}) {
  return (
    <View style={styles.searchInputShell}>
      <Search size={18} color={theme.muted} strokeWidth={1.9} style={styles.searchInputIcon} />
      <TextInput
        accessibilityLabel="搜索关键词"
        style={styles.searchInput}
        value={query}
        onChangeText={onQueryChange}
        placeholder="输入关键词"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSearch}
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
        accessibilityRole="button"
        accessibilityLabel="提交搜索"
        accessibilityState={{ disabled: busy }}
        android_ripple={androidRipple(theme.primarySoft, true)}
        disabled={busy}
        hitSlop={TOUCH_HIT_SLOP}
        style={[styles.searchInlineButton, styles.searchSubmitInlineButton, busy && styles.buttonDisabled]}
        onPress={onSearch}
      >
        <Search size={17} color={theme.primary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function FilterChoiceGroup({
  horizontal = false,
  items,
  title,
  value,
  styles,
  theme,
  onChange
}: {
  horizontal?: boolean;
  items: Array<{ value: string; label: string }>;
  title: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onChange: (value: string) => void;
}) {
  const options = items.map((item) => {
    const selected = value === item.value;
    return (
      <Pressable
        key={`${title}-${item.value}-${item.label}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
        onPress={() => onChange(item.value)}
      >
        <Text numberOfLines={1} style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}>{item.label}</Text>
      </Pressable>
    );
  });

  return (
    <View style={styles.searchFilterField}>
      <Text style={styles.searchFilterLabel}>{title}</Text>
      {horizontal ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilterOptionRow}>
          {options}
        </ScrollView>
      ) : (
        <View style={styles.searchFilterOptionWrap}>
          {options}
        </View>
      )}
    </View>
  );
}

function FilterTextField({
  label,
  placeholder,
  value,
  styles,
  theme,
  onChange
}: {
  label: string;
  placeholder: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.searchFilterField}>
      <Text style={styles.searchFilterLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function SearchFilterSheet({
  categories,
  source,
  searchFilters,
  styles,
  theme,
  visible,
  onApply,
  onClose
}: {
  categories: Category[];
  source: Source;
  searchFilters: SearchFilterState;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  visible: boolean;
  onApply: (source: Source, filter: SourceSearchFilter) => void;
  onClose: () => void;
}) {
  const [draftFilter, setDraftFilter] = useState<SourceSearchFilter>(() => searchFilterForSource(searchFilters, source));
  const [v2exMoreVisible, setV2exMoreVisible] = useState(false);
  const linuxDoCategoryItems = useMemo(() => categoryOptions(categories, 'linuxdo'), [categories]);
  const nodeSeekCategoryItems = useMemo(() => categoryOptions(categories, 'nodeseek'), [categories]);
  const yaohuoCategoryItems = useMemo(() => categoryOptions(categories, 'yaohuo'), [categories]);

  useEffect(() => {
    if (visible) {
      setDraftFilter({ ...searchFilterForSource(searchFilters, source) });
      setV2exMoreVisible(false);
    }
  }, [searchFilters, source, visible]);

  const updateDraft = useCallback((partial: Partial<SourceSearchFilter>) => {
    setDraftFilter((current) => ({ ...current, ...partial } as SourceSearchFilter));
  }, []);

  const resetDraft = useCallback(() => {
    setDraftFilter(defaultSearchFilterForSource(source));
  }, [source]);

  const applyDraft = useCallback(() => {
    onApply(source, draftFilter);
    onClose();
  }, [draftFilter, onApply, onClose, source]);
  const V2exMoreChevron = v2exMoreVisible ? ChevronUp : ChevronDown;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'android' ? 'height' : 'padding'} style={styles.searchFilterModalRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭筛选" style={styles.searchFilterBackdrop} onPress={onClose} />
        <View style={styles.searchFilterSheet}>
          <View style={styles.searchFilterHandle} />
          <View style={styles.searchFilterHeader}>
            <View style={styles.flex}>
              <Text style={styles.searchFilterTitle}>筛选</Text>
              <Text style={styles.meta}>{sourceLabel(source)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭筛选"
              hitSlop={TOUCH_HIT_SLOP}
              style={styles.searchInlineButton}
              onPress={onClose}
            >
              <X size={18} color={theme.muted} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView style={styles.searchFilterBody} contentContainerStyle={styles.searchFilterBodyInner} keyboardShouldPersistTaps="handled">
            {draftFilter.source === 'v2ex' ? (
              <>
                <FilterChoiceGroup
                  title="排序"
                  value={draftFilter.sort}
                  items={[
                    { value: 'relevance', label: '相关' },
                    { value: 'time', label: '按时间' }
                  ]}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ sort: value as typeof draftFilter.sort })}
                />
                <FilterChoiceGroup
                  title="时间"
                  value={draftFilter.timeRange}
                  items={searchTimeRangeItems}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ timeRange: value as typeof draftFilter.timeRange })}
                />
                <FilterTextField label="节点" placeholder="例如 qna / jobs" value={draftFilter.node} styles={styles} theme={theme} onChange={(value) => updateDraft({ node: value })} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={v2exMoreVisible ? '收起 V2EX 更多筛选' : '展开 V2EX 更多筛选'}
                  accessibilityState={{ expanded: v2exMoreVisible }}
                  android_ripple={androidRipple(theme.primarySoft)}
                  style={styles.searchFilterMoreButton}
                  onPress={() => setV2exMoreVisible((current) => !current)}
                >
                  <Text style={styles.searchFilterMoreText}>更多筛选</Text>
                  <V2exMoreChevron size={16} color={theme.muted} strokeWidth={1.8} />
                </Pressable>
                {v2exMoreVisible ? (
                  <>
                    <FilterTextField label="作者" placeholder="V2EX 用户名" value={draftFilter.username} styles={styles} theme={theme} onChange={(value) => updateDraft({ username: value })} />
                    <FilterChoiceGroup
                      title="关键词关系"
                      value={draftFilter.operator}
                      items={[
                        { value: 'or', label: '任一关键词' },
                        { value: 'and', label: '全部关键词' }
                      ]}
                      styles={styles}
                      theme={theme}
                      onChange={(value) => updateDraft({ operator: value as typeof draftFilter.operator })}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            {draftFilter.source === 'linuxdo' ? (
              <>
                <FilterChoiceGroup
                  title="搜索范围"
                  value={draftFilter.scope}
                  items={[
                    { value: 'all', label: '全文' },
                    { value: 'title', label: '标题' }
                  ]}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ scope: value as typeof draftFilter.scope })}
                />
                <FilterChoiceGroup
                  horizontal={linuxDoCategoryItems.length > 8}
                  title="分类"
                  value={draftFilter.category}
                  items={linuxDoCategoryItems}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ category: value })}
                />
                <FilterTextField label="标签" placeholder="例如 人工智能" value={draftFilter.tags} styles={styles} theme={theme} onChange={(value) => updateDraft({ tags: value })} />
                <FilterChoiceGroup
                  title="时间"
                  value={draftFilter.timeRange}
                  items={searchTimeRangeItems}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ timeRange: value as typeof draftFilter.timeRange })}
                />
                <FilterChoiceGroup
                  title="排序"
                  value={draftFilter.order}
                  items={[
                    { value: 'relevance', label: '相关' },
                    { value: 'latest', label: '最新' }
                  ]}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ order: value as typeof draftFilter.order })}
                />
                <FilterTextField label="作者" placeholder="linux.do 用户名" value={draftFilter.username} styles={styles} theme={theme} onChange={(value) => updateDraft({ username: value })} />
              </>
            ) : null}
            {draftFilter.source === 'nodeseek' ? (
              <>
                <FilterChoiceGroup
                  horizontal={nodeSeekCategoryItems.length > 8}
                  title="分类"
                  value={draftFilter.category}
                  items={nodeSeekCategoryItems}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ category: value })}
                />
                <FilterChoiceGroup
                  title="排序"
                  value={draftFilter.sort}
                  items={[
                    { value: 'replyTime', label: '新评论' },
                    { value: 'postTime', label: '新帖子' }
                  ]}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ sort: value as typeof draftFilter.sort })}
                />
              </>
            ) : null}
            {draftFilter.source === 'yaohuo' ? (
              <FilterChoiceGroup
                horizontal={yaohuoCategoryItems.length > 8}
                title="版块"
                value={draftFilter.category}
                items={yaohuoCategoryItems}
                styles={styles}
                theme={theme}
                onChange={(value) => updateDraft({ category: value })}
              />
            ) : null}
          </ScrollView>
          <View style={styles.searchFilterActions}>
            <AppButton compact label="重置" variant="ghost" styles={styles} onPress={resetDraft} />
            <AppButton compact label="确认筛选" variant="primary" styles={styles} onPress={applyDraft} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SearchFilterEntry({
  summary,
  styles,
  theme,
  onPress
}: {
  summary: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开搜索筛选，当前${summary}`}
      android_ripple={androidRipple(theme.primarySoft)}
      style={styles.searchFilterEntry}
      onPress={onPress}
    >
      <View style={styles.searchFilterEntryIcon}>
        <SlidersHorizontal size={17} color={theme.primary} strokeWidth={1.9} />
      </View>
      <Text style={styles.searchFilterEntryText}>筛选</Text>
      <Text numberOfLines={1} style={styles.searchFilterEntrySummary}>{summary}</Text>
      <ChevronDown size={16} color={theme.muted} strokeWidth={1.7} />
    </Pressable>
  );
}

export function SearchScreen({
  busy,
  categories,
  query,
  recentSearches,
  topicStateIndex,
  searchFilters,
  searchGroups,
  searchSource,
  submittedQuery,
  scrollToTopSignal,
  styles,
  theme,
  onOpenExternalUrl,
  onOpenTopic,
  onLoadMoreSearchSource,
  onRemoveRecentSearch,
  onQueryChange,
  onRetrySearchSource,
  onSearch,
  onSearchFilterApply,
  onSearchSourceChange
}: {
  busy: boolean;
  categories: Category[];
  query: string;
  recentSearches: string[];
  topicStateIndex: TopicListItemStateIndex;
  searchFilters: SearchFilterState;
  searchGroups: SearchGroup[];
  searchSource: FeedSource;
  submittedQuery: string;
  scrollToTopSignal: number;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenExternalUrl: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onLoadMoreSearchSource: (source: Source, page: number) => void;
  onRemoveRecentSearch: (query: string) => void;
  onQueryChange: (value: string) => void;
  onRetrySearchSource: (source: Source) => void;
  onSearch: () => void;
  onSearchFilterApply: (source: Source, filter: SourceSearchFilter) => void;
  onSearchSourceChange: (source: FeedSource) => void;
}) {
  const listRef = useRef<FlashListRef<SearchListItem> | null>(null);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
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
  const [expandedSearchGroups, setExpandedSearchGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (searchSource === 'all') {
      setFilterSheetVisible(false);
    }
  }, [searchSource]);
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
  const visibleSearchGroups = searchGroups;
  const searchTerm = query.trim();
  const hasInputValue = query.length > 0;
  const hasSearchTerm = searchTerm.length > 0;
  const hasSubmittedQuery = hasSearchTerm && submittedQuery === searchTerm;
  const linuxDoExternalItems = useMemo(() => (
    hasSubmittedQuery && (searchSource === 'all' || searchSource === 'linuxdo')
      ? linuxDoExternalSearchItems(searchTerm)
      : []
  ), [hasSubmittedQuery, searchSource, searchTerm]);
  const showSearchGroups = hasSubmittedQuery && visibleSearchGroups.length > 0;
  const showIdleRecentSearches = !hasInputValue && recentSearches.length > 0;
  const searchFilterEntrySummary = searchSource !== 'all'
    ? searchFilterSummary(searchSource as Source, searchFilterForSource(searchFilters, searchSource as Source), categories)
    : '';
  const listItems = useMemo(() => (
    showSearchGroups
      ? buildSearchListItems({
        expandedGroups: expandedSearchGroups,
        groups: visibleSearchGroups
      })
      : []
  ), [expandedSearchGroups, showSearchGroups, visibleSearchGroups]);
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
    return null;
  }, [busy, onLoadMoreSearchSource, onRetrySearchSource, renderTopicCard, styles, theme, toggleSearchGroup]);
  const keySearchListItem = useCallback((item: SearchListItem) => {
    if (item.type === 'topic') {
      return `topic:${item.groupSource || item.topic.source}:${topicKey(item.topic)}`;
    }
    if (item.type === 'groupHeader') {
      return `${item.group.source}:header`;
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
      <SearchInputField
        busy={busy}
        query={query}
        styles={styles}
        theme={theme}
        onQueryChange={onQueryChange}
        onSearch={onSearch}
      />
      <PillRail
        items={feedSourceItems}
        value={searchSource}
        styles={styles}
        onChange={(value) => onSearchSourceChange(value as FeedSource)}
      />
      {searchSource !== 'all' ? (
        <SearchFilterEntry
          summary={searchFilterEntrySummary}
          styles={styles}
          theme={theme}
          onPress={() => setFilterSheetVisible(true)}
        />
      ) : null}
      {showIdleRecentSearches ? (
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

  return (
    <View style={styles.content}>
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
        ListFooterComponent={null}
        ListEmptyComponent={showSearchGroups ? null : busy && hasSubmittedQuery
          ? <LoadingState text="正在搜索..." styles={styles} theme={theme} />
          : !hasInputValue ? (showIdleRecentSearches ? null : <EmptyText text="输入关键词后开始搜索" styles={styles} />)
            : !hasSearchTerm ? <EmptyText text="输入关键词后开始搜索" styles={styles} />
              : !hasSubmittedQuery ? <EmptyText text="按键盘上的搜索键开始" styles={styles} />
                : <EmptyText text="暂无搜索结果" styles={styles} />}
        renderItem={renderSearchListItem}
      />
      {searchSource !== 'all' ? (
        <SearchFilterSheet
          categories={categories}
          source={searchSource as Source}
          searchFilters={searchFilters}
          styles={styles}
          theme={theme}
          visible={filterSheetVisible}
          onApply={onSearchFilterApply}
          onClose={() => setFilterSheetVisible(false)}
        />
      ) : null}
    </View>
  );
}
