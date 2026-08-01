import type { SearchStyles } from './styles';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ChevronDown, ChevronUp, X } from 'lucide-react-native';
import type { Category, DiscourseTagOption, DiscourseUserOption, Source } from '@/domain/forum/models';
import { type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { sourceLabel } from '@/domain/forum/presentation';
import {
  defaultSearchFilterForSource,
  discourseSearchFilterError,
  isDiscourseSearchFilter,
  searchFilterForSource,
  searchTimeRangeItems,
  type DiscourseVisitedFilter,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, EmptyText, LoadingState, TOUCH_HIT_SLOP } from '@/ui/controls/AppControls';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useSearchCandidateQueries } from './useSearchController';

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
  items: { value: string; label: string }[];
  title: string;
  value: string;
  styles: SearchStyles;
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
        <Text
          numberOfLines={1}
          style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}
        >
          {item.label}
        </Text>
      </Pressable>
    );
  });

  return (
    <View style={styles.searchFilterField}>
      <Text style={styles.searchFilterLabel}>{title}</Text>
      {horizontal ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.searchFilterOptionRow}
        >
          {options}
        </ScrollView>
      ) : (
        <View style={styles.searchFilterOptionWrap}>{options}</View>
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
  styles: SearchStyles;
  theme: ReaderTheme;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.searchFilterField}>
      <Text style={styles.searchFilterLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
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

export function SearchFilterSheet({
  categories,
  sessionEpochs,
  requestsEnabled,
  source,
  searchFilters,
  styles,
  theme,
  visible,
  onSearchDiscourseTags,
  onSearchDiscourseUsers,
  onApply,
  onClose
}: {
  categories: Category[];
  sessionEpochs: ForumSessionEpochs;
  requestsEnabled: boolean;
  source: Source;
  searchFilters: SearchFilterState;
  styles: SearchStyles;
  theme: ReaderTheme;
  visible: boolean;
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
  onApply: (source: Source, filter: SourceSearchFilter) => void;
  onClose: () => void;
}) {
  const [draftFilter, setDraftFilter] = useState<SourceSearchFilter>(() =>
    searchFilterForSource(searchFilters, source)
  );
  const [v2exMoreVisible, setV2exMoreVisible] = useState(false);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [debouncedTagQuery, setDebouncedTagQuery] = useState<string | null>(null);
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [userPickerVisible, setUserPickerVisible] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [debouncedUserQuery, setDebouncedUserQuery] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [filterError, setFilterError] = useState('');
  const nodeSeekCategoryItems = useMemo(() => categoryOptions(categories, 'nodeseek'), [categories]);
  const yaohuoCategoryItems = useMemo(() => categoryOptions(categories, 'yaohuo'), [categories]);

  useEffect(() => {
    if (visible) {
      const filter = searchFilterForSource(searchFilters, source);
      setDraftFilter(
        isDiscourseSearchFilter(filter)
          ? { ...filter, tags: [...filter.tags], visited: [...filter.visited] }
          : { ...filter }
      );
      setV2exMoreVisible(false);
      setTagPickerVisible(false);
      setCategoryPickerVisible(false);
      setUserPickerVisible(false);
      setDatePickerVisible(false);
      setFilterError('');
    }
  }, [searchFilters, source, visible]);

  const updateDraft = useCallback((partial: Partial<SourceSearchFilter>) => {
    setFilterError('');
    setDraftFilter((current) => ({ ...current, ...partial }) as SourceSearchFilter);
  }, []);

  const resetDraft = useCallback(() => {
    setDraftFilter(defaultSearchFilterForSource(source));
    setDatePickerVisible(false);
    setFilterError('');
  }, [source]);

  const applyDraft = useCallback(() => {
    if (isDiscourseSearchFilter(draftFilter)) {
      const error = discourseSearchFilterError(draftFilter);
      if (error) {
        setFilterError(error);
        return;
      }
    }
    onApply(source, draftFilter);
    onClose();
  }, [draftFilter, onApply, onClose, source]);
  const V2exMoreChevron = v2exMoreVisible ? ChevronUp : ChevronDown;
  const discourseDraft = isDiscourseSearchFilter(draftFilter) ? draftFilter : null;
  const discourseCategories = useMemo(
    () => (discourseDraft ? sourceCategories(categories, discourseDraft.source) : []),
    [categories, discourseDraft?.source]
  );
  const categoryNames = useMemo(
    () => new Map(discourseCategories.map((category) => [category.id, category.name])),
    [discourseCategories]
  );
  const filteredDiscourseCategories = useMemo(() => {
    const query = categoryQuery.trim().toLowerCase();
    return discourseCategories.filter((category) => {
      const parentName = category.parentId ? categoryNames.get(category.parentId) || '' : '';
      return !query || `${parentName} ${category.name} ${category.slug || ''}`.toLowerCase().includes(query);
    });
  }, [categoryNames, categoryQuery, discourseCategories]);

  useEffect(() => {
    setDebouncedTagQuery(null);
    if (!tagPickerVisible) {
      return;
    }
    const timer = setTimeout(() => setDebouncedTagQuery(tagQuery), 300);
    return () => clearTimeout(timer);
  }, [tagPickerVisible, tagQuery]);

  useEffect(() => {
    setDebouncedUserQuery(null);
    const term = userQuery.trim();
    if (!userPickerVisible || !term) {
      return;
    }
    const timer = setTimeout(() => setDebouncedUserQuery(term), 300);
    return () => clearTimeout(timer);
  }, [userPickerVisible, userQuery]);

  const normalizedUserQuery = userQuery.trim();
  const candidates = useSearchCandidateQueries({
    sessionEpochs,
    enabled: requestsEnabled,
    searchDiscourseTags: onSearchDiscourseTags,
    searchDiscourseUsers: onSearchDiscourseUsers,
    tagRequest:
      visible && tagPickerVisible && discourseDraft && debouncedTagQuery !== null
        ? {
            source: discourseDraft.source,
            query: debouncedTagQuery,
            categoryId: discourseDraft.category || undefined,
            selectedTags: discourseDraft.tags
          }
        : null,
    userRequest:
      visible && userPickerVisible && discourseDraft && debouncedUserQuery
        ? {
            source: discourseDraft.source,
            term: debouncedUserQuery,
            categoryId: discourseDraft.category || undefined
          }
        : null
  });

  const tagDebouncing = tagPickerVisible && debouncedTagQuery !== tagQuery;
  const tagOptions = tagDebouncing ? [] : candidates.tags.options;
  const tagLoading = tagDebouncing || candidates.tags.loading;
  const tagError = !tagDebouncing && candidates.tags.error ? '标签候选加载失败' : '';
  const userDebouncing =
    userPickerVisible && Boolean(normalizedUserQuery) && debouncedUserQuery !== normalizedUserQuery;
  const userOptions = userDebouncing ? [] : candidates.users.options;
  const userLoading = userDebouncing || candidates.users.loading;
  const userError = !userDebouncing && candidates.users.error ? '作者候选加载失败' : '';

  const toggleTag = useCallback((name: string) => {
    setFilterError('');
    setDraftFilter((current) => {
      if (!isDiscourseSearchFilter(current)) {
        return current;
      }
      const tags = current.tags.includes(name) ? current.tags.filter((tag) => tag !== name) : [...current.tags, name];
      return { ...current, tags };
    });
  }, []);

  const toggleVisited = useCallback((value: DiscourseVisitedFilter) => {
    setFilterError('');
    setDraftFilter((current) => {
      if (!isDiscourseSearchFilter(current)) {
        return current;
      }
      const visited = current.visited.includes(value)
        ? current.visited.filter((item) => item !== value)
        : [...current.visited, value];
      return { ...current, visited };
    });
  }, []);

  const updateLinuxDoExpertResponse = useCallback((expertResponse: boolean) => {
    setFilterError('');
    setDraftFilter((current) => {
      if (!isDiscourseSearchFilter(current) || current.source !== 'linuxdo') {
        return current;
      }
      return {
        ...current,
        siteExtension: { ...current.siteExtension, expertResponse }
      };
    });
  }, []);

  const changeExactDate = useCallback(
    (event: DateTimePickerEvent, value?: Date) => {
      setDatePickerVisible(false);
      if (event.type === 'set' && value) {
        updateDraft({ date: localSearchDate(value), timeRange: 'all' });
      }
    },
    [updateDraft]
  );

  return (
    <>
      <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
        <KeyboardAvoidingView behavior="height" style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭筛选"
            style={styles.searchFilterBackdrop}
            onPress={onClose}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <View style={styles.flex}>
                <Text style={styles.searchFilterTitle}>筛选</Text>
                <Text style={styles.meta}>{sourceLabel(source)}</Text>
              </View>
              <Pressable
                testID="search-filter-close"
                accessibilityRole="button"
                accessibilityLabel="关闭筛选"
                hitSlop={TOUCH_HIT_SLOP}
                style={styles.searchInlineButton}
                onPress={onClose}
              >
                <X size={18} color={theme.muted} strokeWidth={2} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="handled"
            >
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
                  <FilterTextField
                    label="节点"
                    placeholder="例如 qna / jobs"
                    value={draftFilter.node}
                    styles={styles}
                    theme={theme}
                    onChange={(value) => updateDraft({ node: value })}
                  />
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
                      <FilterTextField
                        label="作者"
                        placeholder="V2EX 用户名"
                        value={draftFilter.username}
                        styles={styles}
                        theme={theme}
                        onChange={(value) => updateDraft({ username: value })}
                      />
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
              {isDiscourseSearchFilter(draftFilter) ? (
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
                  <View style={styles.searchFilterField}>
                    <Text style={styles.searchFilterLabel}>分类</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="选择分类"
                      android_ripple={androidRipple(theme.primarySoft)}
                      style={styles.input}
                      onPress={() => {
                        setCategoryQuery('');
                        setCategoryPickerVisible(true);
                      }}
                    >
                      <Text
                        style={[
                          styles.searchFilterOptionText,
                          draftFilter.category && styles.searchFilterOptionTextActive
                        ]}
                      >
                        {draftFilter.category
                          ? categoryNames.get(draftFilter.category) || draftFilter.category
                          : '全部分类'}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.searchFilterField}>
                    <Text style={styles.searchFilterLabel}>标签</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="选择标签"
                      android_ripple={androidRipple(theme.primarySoft)}
                      style={styles.input}
                      onPress={() => {
                        setTagQuery('');
                        setTagPickerVisible(true);
                      }}
                    >
                      <Text
                        style={[
                          styles.searchFilterOptionText,
                          draftFilter.tags.length > 0 && styles.searchFilterOptionTextActive
                        ]}
                      >
                        {draftFilter.tags.length ? `已选择 ${draftFilter.tags.length} 个标签` : '选择标签'}
                      </Text>
                    </Pressable>
                    {draftFilter.tags.length ? (
                      <View style={styles.chipWrap}>
                        {draftFilter.tags.map((tag) => (
                          <Pressable
                            key={tag}
                            accessibilityRole="button"
                            accessibilityLabel={`移除标签 ${tag}`}
                            style={styles.searchFilterOption}
                            onPress={() => toggleTag(tag)}
                          >
                            <Text style={styles.searchFilterOptionText}>{tag} ×</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {draftFilter.tags.length >= 2 ? (
                      <FilterCheckbox
                        checked={draftFilter.tagMatch === 'all'}
                        label="匹配全部标签"
                        styles={styles}
                        theme={theme}
                        onChange={(checked) => updateDraft({ tagMatch: checked ? 'all' : 'any' })}
                      />
                    ) : null}
                  </View>
                  <View style={styles.searchFilterField}>
                    <Text style={styles.searchFilterLabel}>回访范围</Text>
                    <View style={styles.searchFilterOptionWrap}>
                      {(
                        [
                          ['seen', '我读过'],
                          ['bookmarks', '我已添加为书签'],
                          ['likes', '我赞过'],
                          ['posted', '我发过帖'],
                          ['created', '我创建']
                        ] as [DiscourseVisitedFilter, string][]
                      ).map(([value, label]) => (
                        <FilterCheckbox
                          key={value}
                          checked={draftFilter.visited.includes(value)}
                          label={label}
                          styles={styles}
                          theme={theme}
                          onChange={() => toggleVisited(value)}
                        />
                      ))}
                    </View>
                  </View>
                  <FilterChoiceGroup
                    title="话题状态"
                    value={draftFilter.status}
                    items={[
                      { value: '', label: '不限状态' },
                      { value: 'open', label: '开放' },
                      { value: 'closed', label: '已关闭' },
                      { value: 'public', label: '公开' },
                      { value: 'archived', label: '已归档' },
                      { value: 'noreplies', label: '无回复' },
                      { value: 'single_user', label: '单一用户' },
                      { value: 'solved', label: '已解决' },
                      { value: 'unsolved', label: '未解决' }
                    ]}
                    styles={styles}
                    theme={theme}
                    onChange={(value) => updateDraft({ status: value as typeof draftFilter.status })}
                  />
                  <FilterChoiceGroup
                    title="时间"
                    value={draftFilter.timeRange}
                    items={searchTimeRangeItems}
                    styles={styles}
                    theme={theme}
                    onChange={(value) => updateDraft({ timeRange: value as typeof draftFilter.timeRange, date: '' })}
                  />
                  <View style={styles.searchFilterField}>
                    <Text style={styles.searchFilterLabel}>精确日期</Text>
                    <FilterChoiceGroup
                      title="日期关系"
                      value={draftFilter.dateRelation}
                      items={[
                        { value: 'after', label: '之后' },
                        { value: 'before', label: '之前' }
                      ]}
                      styles={styles}
                      theme={theme}
                      onChange={(value) => updateDraft({ dateRelation: value as typeof draftFilter.dateRelation })}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="选择精确日期"
                      android_ripple={androidRipple(theme.primarySoft)}
                      style={styles.input}
                      onPress={() => setDatePickerVisible(true)}
                    >
                      <Text
                        style={[styles.searchFilterOptionText, draftFilter.date && styles.searchFilterOptionTextActive]}
                      >
                        {draftFilter.date || '选择日期'}
                      </Text>
                    </Pressable>
                    {draftFilter.date ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="清除精确日期"
                        style={styles.searchFilterOption}
                        onPress={() => updateDraft({ date: '' })}
                      >
                        <Text style={styles.searchFilterOptionText}>清除日期</Text>
                      </Pressable>
                    ) : null}
                    {datePickerVisible ? (
                      <DateTimePicker
                        value={draftFilter.date ? new Date(`${draftFilter.date}T12:00:00`) : new Date()}
                        mode="date"
                        onChange={changeExactDate}
                      />
                    ) : null}
                  </View>
                  <View style={styles.searchFilterField}>
                    <Text style={styles.searchFilterLabel}>帖子数范围</Text>
                    <View style={styles.searchFilterOptionRow}>
                      <FilterNumberField
                        label="帖子数最小值"
                        value={draftFilter.minPosts}
                        styles={styles}
                        theme={theme}
                        onChange={(value) => updateDraft({ minPosts: value })}
                      />
                      <FilterNumberField
                        label="帖子数最大值"
                        value={draftFilter.maxPosts}
                        styles={styles}
                        theme={theme}
                        onChange={(value) => updateDraft({ maxPosts: value })}
                      />
                    </View>
                  </View>
                  <View style={styles.searchFilterField}>
                    <Text style={styles.searchFilterLabel}>浏览量范围</Text>
                    <View style={styles.searchFilterOptionRow}>
                      <FilterNumberField
                        label="浏览量最小值"
                        value={draftFilter.minViews}
                        styles={styles}
                        theme={theme}
                        onChange={(value) => updateDraft({ minViews: value })}
                      />
                      <FilterNumberField
                        label="浏览量最大值"
                        value={draftFilter.maxViews}
                        styles={styles}
                        theme={theme}
                        onChange={(value) => updateDraft({ maxViews: value })}
                      />
                    </View>
                  </View>
                  {draftFilter.siteExtension?.source === 'linuxdo' ? (
                    <View style={styles.searchFilterField}>
                      <Text style={styles.searchFilterLabel}>其他</Text>
                      <FilterCheckbox
                        checked={draftFilter.siteExtension.expertResponse}
                        label="有专家回应"
                        styles={styles}
                        theme={theme}
                        onChange={updateLinuxDoExpertResponse}
                      />
                    </View>
                  ) : null}
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
                  <View style={styles.searchFilterField}>
                    <Text style={styles.searchFilterLabel}>发帖人</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="选择作者"
                      android_ripple={androidRipple(theme.primarySoft)}
                      style={styles.input}
                      onPress={() => {
                        setUserQuery('');
                        setUserPickerVisible(true);
                      }}
                    >
                      <Text
                        style={[
                          styles.searchFilterOptionText,
                          draftFilter.username && styles.searchFilterOptionTextActive
                        ]}
                      >
                        {draftFilter.username || '选择站点用户'}
                      </Text>
                    </Pressable>
                    {draftFilter.username ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`移除作者 ${draftFilter.username}`}
                        style={styles.searchFilterOption}
                        onPress={() => updateDraft({ username: '' })}
                      >
                        <Text style={styles.searchFilterOptionText}>{draftFilter.username} ×</Text>
                      </Pressable>
                    ) : null}
                  </View>
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
            {filterError ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {filterError}
              </Text>
            ) : null}
            <View style={styles.searchFilterActions}>
              <AppButton compact label="重置" variant="ghost" styles={styles} onPress={resetDraft} />
              <AppButton compact label="确认筛选" variant="primary" styles={styles} onPress={applyDraft} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        transparent
        visible={tagPickerVisible}
        animationType="fade"
        onRequestClose={() => setTagPickerVisible(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭标签选择"
            style={styles.searchFilterBackdrop}
            onPress={() => setTagPickerVisible(false)}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <Text style={styles.searchFilterTitle}>选择标签</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭标签选择"
                hitSlop={TOUCH_HIT_SLOP}
                style={styles.searchInlineButton}
                onPress={() => setTagPickerVisible(false)}
              >
                <X size={18} color={theme.muted} strokeWidth={2} />
              </Pressable>
            </View>
            <View style={styles.searchFilterBodyInner}>
              <TextInput
                accessibilityLabel="搜索标签"
                style={styles.input}
                value={tagQuery}
                onChangeText={setTagQuery}
                placeholder="搜索站点标签"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="handled"
            >
              {tagLoading ? <LoadingState text="正在加载标签..." styles={styles} theme={theme} /> : null}
              {tagError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{tagError}</Text>
                  <AppButton
                    compact
                    label="重试标签候选"
                    variant="ghost"
                    styles={styles}
                    onPress={() => {
                      void candidates.tags.retry();
                    }}
                  />
                </View>
              ) : null}
              {!tagLoading && !tagError && !tagOptions.length ? (
                <EmptyText text="没有匹配标签" styles={styles} />
              ) : null}
              {tagOptions.map((option) => {
                const selected = Boolean(discourseDraft?.tags.includes(option.name));
                return (
                  <Pressable
                    key={option.name}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`标签 ${option.name}`}
                    accessibilityState={{ checked: selected }}
                    android_ripple={androidRipple(theme.primarySoft)}
                    style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
                    onPress={() => toggleTag(option.name)}
                  >
                    <Text style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}>
                      {option.name}
                      {option.topicCount === undefined ? '' : ` · ${option.topicCount}`}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.searchFilterActions}>
              <AppButton
                compact
                label="完成"
                variant="primary"
                styles={styles}
                onPress={() => setTagPickerVisible(false)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        transparent
        visible={categoryPickerVisible}
        animationType="fade"
        onRequestClose={() => setCategoryPickerVisible(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭分类选择"
            style={styles.searchFilterBackdrop}
            onPress={() => setCategoryPickerVisible(false)}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <Text style={styles.searchFilterTitle}>选择分类</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭分类选择"
                hitSlop={TOUCH_HIT_SLOP}
                style={styles.searchInlineButton}
                onPress={() => setCategoryPickerVisible(false)}
              >
                <X size={18} color={theme.muted} strokeWidth={2} />
              </Pressable>
            </View>
            <View style={styles.searchFilterBodyInner}>
              <TextInput
                accessibilityLabel="搜索分类"
                style={styles.input}
                value={categoryQuery}
                onChangeText={setCategoryQuery}
                placeholder="搜索分类"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="handled"
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="分类 全部分类"
                accessibilityState={{ checked: !discourseDraft?.category }}
                style={[styles.searchFilterOption, !discourseDraft?.category && styles.searchFilterOptionActive]}
                onPress={() => {
                  updateDraft({ category: '' });
                  setCategoryPickerVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.searchFilterOptionText,
                    !discourseDraft?.category && styles.searchFilterOptionTextActive
                  ]}
                >
                  全部分类
                </Text>
              </Pressable>
              {filteredDiscourseCategories.map((category) => {
                const parentName = category.parentId ? categoryNames.get(category.parentId) : '';
                const label = parentName ? `${parentName} / ${category.name}` : category.name;
                const selected = discourseDraft?.category === category.id;
                return (
                  <Pressable
                    key={category.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`分类 ${label}`}
                    accessibilityState={{ checked: selected }}
                    style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
                    onPress={() => {
                      updateDraft({ category: category.id });
                      setCategoryPickerVisible(false);
                    }}
                  >
                    <Text style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}>
                      {label}
                      {category.readRestricted ? ' · 🔒' : ''}
                      {category.topicCount === undefined ? '' : ` · ${category.topicCount}`}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        transparent
        visible={userPickerVisible}
        animationType="fade"
        onRequestClose={() => setUserPickerVisible(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭作者选择"
            style={styles.searchFilterBackdrop}
            onPress={() => setUserPickerVisible(false)}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <Text style={styles.searchFilterTitle}>选择发帖人</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭作者选择"
                hitSlop={TOUCH_HIT_SLOP}
                style={styles.searchInlineButton}
                onPress={() => setUserPickerVisible(false)}
              >
                <X size={18} color={theme.muted} strokeWidth={2} />
              </Pressable>
            </View>
            <View style={styles.searchFilterBodyInner}>
              <TextInput
                accessibilityLabel="搜索作者"
                style={styles.input}
                value={userQuery}
                onChangeText={setUserQuery}
                placeholder="输入用户名"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="handled"
            >
              {userLoading ? <LoadingState text="正在加载作者..." styles={styles} theme={theme} /> : null}
              {userError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{userError}</Text>
                  <AppButton
                    compact
                    label="重试作者候选"
                    variant="ghost"
                    styles={styles}
                    onPress={() => {
                      void candidates.users.retry();
                    }}
                  />
                </View>
              ) : null}
              {!userQuery.trim() ? <EmptyText text="输入用户名后选择" styles={styles} /> : null}
              {!userLoading && !userError && userQuery.trim() && !userOptions.length ? (
                <EmptyText text="没有匹配用户" styles={styles} />
              ) : null}
              {userOptions.map((user) => (
                <Pressable
                  key={user.id}
                  accessibilityRole="radio"
                  accessibilityLabel={`用户 ${user.username}`}
                  accessibilityState={{ checked: discourseDraft?.username === user.username }}
                  style={[
                    styles.searchFilterOption,
                    discourseDraft?.username === user.username && styles.searchFilterOptionActive
                  ]}
                  onPress={() => {
                    updateDraft({ username: user.username });
                    setUserPickerVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.searchFilterOptionText,
                      discourseDraft?.username === user.username && styles.searchFilterOptionTextActive
                    ]}
                  >
                    {user.displayName && user.displayName !== user.username ? `${user.displayName} · ` : ''}@
                    {user.username}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function FilterCheckbox({
  checked,
  label,
  styles,
  theme,
  onChange
}: {
  checked: boolean;
  label: string;
  styles: SearchStyles;
  theme: ReaderTheme;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      android_ripple={androidRipple(theme.primarySoft)}
      style={[styles.searchFilterOption, checked && styles.searchFilterOptionActive]}
      onPress={() => onChange(!checked)}
    >
      <Text style={[styles.searchFilterOptionText, checked && styles.searchFilterOptionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function FilterNumberField({
  label,
  value,
  styles,
  theme,
  onChange
}: {
  label: string;
  value: number | null;
  styles: SearchStyles;
  theme: ReaderTheme;
  onChange: (value: number | null) => void;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      style={[styles.input, styles.flex]}
      value={value === null ? '' : String(value)}
      onChangeText={(nextValue) => {
        if (!/^\d*$/.test(nextValue)) {
          return;
        }
        onChange(nextValue ? Number(nextValue) : null);
      }}
      placeholder={label.includes('最小') ? '最小' : '最大'}
      placeholderTextColor={theme.muted}
      keyboardType="number-pad"
    />
  );
}

function localSearchDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
