import type { SearchStyles } from './styles';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react-native';
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
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from '@/ui/controls/ButtonControls';
import { TOUCH_HIT_SLOP } from '@/ui/controls/pressFeedback';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { DiscourseFilterPickers, useDiscourseFilterPickers } from './DiscourseFilterPickers';
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
  summary,
  styles,
  theme,
  onSearchDiscourseTags,
  onSearchDiscourseUsers,
  onApply
}: {
  categories: Category[];
  sessionEpochs: ForumSessionEpochs;
  requestsEnabled: boolean;
  source: Source;
  searchFilters: SearchFilterState;
  summary: string;
  styles: SearchStyles;
  theme: ReaderTheme;
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
}) {
  const { height } = useWindowDimensions();
  const filterBodyStyle = { maxHeight: Math.max(320, Math.round(height * 0.58)) };
  const [draftFilter, setDraftFilter] = useState<SourceSearchFilter>(() =>
    searchFilterForSource(searchFilters, source)
  );
  const [filterError, setFilterError] = useState('');
  const [visible, setVisible] = useState(false);
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
      setFilterError('');
    }
  }, [searchFilters, source, visible]);

  const updateDraft = useCallback((partial: Partial<SourceSearchFilter>) => {
    setFilterError('');
    setDraftFilter((current) => ({ ...current, ...partial }) as SourceSearchFilter);
  }, []);

  const resetDraft = useCallback(() => {
    setDraftFilter(defaultSearchFilterForSource(source));
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
    setVisible(false);
  }, [draftFilter, onApply, source]);
  const discourseDraft = isDiscourseSearchFilter(draftFilter) ? draftFilter : null;
  const pickers = useDiscourseFilterPickers({
    categories,
    discourseDraft,
    filterSheetVisible: visible,
    sessionEpochs,
    requestsEnabled,
    searchDiscourseTags: onSearchDiscourseTags,
    searchDiscourseUsers: onSearchDiscourseUsers
  });

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

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开搜索筛选，当前${summary}`}
        accessibilityState={{ selected: summary !== '默认' }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={[styles.searchFilterEntry, summary !== '默认' && styles.searchFilterEntryActive]}
        onPress={() => setVisible(true)}
      >
        <View style={styles.searchFilterEntryIcon}>
          <SlidersHorizontal size={17} color={theme.primary} strokeWidth={1.9} />
        </View>
        <Text style={styles.searchFilterEntryText}>筛选</Text>
        <Text
          numberOfLines={1}
          style={[styles.searchFilterEntrySummary, summary !== '默认' && styles.searchFilterEntrySummaryActive]}
        >
          {summary}
        </Text>
        <ChevronDown size={16} color={theme.muted} strokeWidth={1.7} />
      </Pressable>
      <ModalSheetFrame backdropLabel="关闭筛选" visible={visible} onRequestClose={() => setVisible(false)}>
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
            onPress={() => setVisible(false)}
          >
            <X size={18} color={theme.muted} strokeWidth={2} />
          </Pressable>
        </View>
        <ScrollView
          style={[styles.searchFilterBody, filterBodyStyle]}
          contentContainerStyle={styles.searchFilterBodyInner}
          keyboardShouldPersistTaps="handled"
        >
          <SearchFilterForm
            categoryNames={pickers.category.names}
            draftFilter={draftFilter}
            filterSheetVisible={visible}
            nodeSeekCategoryItems={nodeSeekCategoryItems}
            openCategoryPicker={pickers.category.open}
            openTagPicker={pickers.tags.open}
            openUserPicker={pickers.users.open}
            styles={styles}
            theme={theme}
            toggleTag={toggleTag}
            toggleVisited={toggleVisited}
            updateDraft={updateDraft}
            updateLinuxDoExpertResponse={updateLinuxDoExpertResponse}
            yaohuoCategoryItems={yaohuoCategoryItems}
          />
        </ScrollView>
        {filterError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {filterError}
          </Text>
        ) : null}
        <View style={styles.searchFilterActions}>
          <AppButton compact label="重置" variant="ghost" onPress={resetDraft} />
          <AppButton compact label="确认筛选" variant="primary" onPress={applyDraft} />
        </View>
      </ModalSheetFrame>
      <DiscourseFilterPickers
        controller={pickers}
        discourseDraft={discourseDraft}
        styles={styles}
        theme={theme}
        filterBodyStyle={filterBodyStyle}
        toggleTag={toggleTag}
        updateDraft={updateDraft}
      />
    </>
  );
}
