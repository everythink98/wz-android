import type { SearchStyles } from './styles';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { X } from 'lucide-react-native';
import type { Category, DiscourseTagOption, DiscourseUserOption, Source } from '@/domain/forum/models';
import { type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { sourceLabel } from '@/domain/forum/presentation';
import {
  defaultSearchFilterForSource,
  discourseSearchFilterError,
  isDiscourseSearchFilter,
  searchFilterForSource,
  type DiscourseVisitedFilter,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, TOUCH_HIT_SLOP } from '@/ui/controls/AppControls';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useSearchCandidateQueries } from './useSearchController';
import { DiscourseFilterPickers } from './DiscourseFilterPickers';
import { SearchFilterForm } from './SearchFilterForm';

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
              <SearchFilterForm
                categoryNames={categoryNames}
                changeExactDate={changeExactDate}
                datePickerVisible={datePickerVisible}
                draftFilter={draftFilter}
                nodeSeekCategoryItems={nodeSeekCategoryItems}
                setCategoryPickerVisible={setCategoryPickerVisible}
                setCategoryQuery={setCategoryQuery}
                setDatePickerVisible={setDatePickerVisible}
                setTagPickerVisible={setTagPickerVisible}
                setTagQuery={setTagQuery}
                setUserPickerVisible={setUserPickerVisible}
                setUserQuery={setUserQuery}
                setV2exMoreVisible={setV2exMoreVisible}
                styles={styles}
                theme={theme}
                toggleTag={toggleTag}
                toggleVisited={toggleVisited}
                updateDraft={updateDraft}
                updateLinuxDoExpertResponse={updateLinuxDoExpertResponse}
                v2exMoreVisible={v2exMoreVisible}
                yaohuoCategoryItems={yaohuoCategoryItems}
              />
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
      <DiscourseFilterPickers
        categoryNames={categoryNames}
        categoryPickerVisible={categoryPickerVisible}
        categoryQuery={categoryQuery}
        discourseDraft={discourseDraft}
        filteredDiscourseCategories={filteredDiscourseCategories}
        onRetryTags={candidates.tags.retry}
        onRetryUsers={candidates.users.retry}
        setCategoryPickerVisible={setCategoryPickerVisible}
        setCategoryQuery={setCategoryQuery}
        setTagPickerVisible={setTagPickerVisible}
        setTagQuery={setTagQuery}
        setUserPickerVisible={setUserPickerVisible}
        setUserQuery={setUserQuery}
        styles={styles}
        tagError={tagError}
        tagLoading={tagLoading}
        tagOptions={tagOptions}
        tagPickerVisible={tagPickerVisible}
        tagQuery={tagQuery}
        theme={theme}
        toggleTag={toggleTag}
        updateDraft={updateDraft}
        userError={userError}
        userLoading={userLoading}
        userOptions={userOptions}
        userPickerVisible={userPickerVisible}
        userQuery={userQuery}
      />
    </>
  );
}

function localSearchDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
