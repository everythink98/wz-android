import type { SearchStyles } from './styles';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, ScrollView, type ScrollViewProps, Text, useWindowDimensions, View } from 'react-native';
import { ChevronDown, SlidersHorizontal } from 'lucide-react-native';
import type { Category, DiscourseTagOption, DiscourseUserOption, Source } from '@/domain/forum/models';
import { type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { sourceLabel } from '@/domain/forum/presentation';
import {
  isDiscourseSearchFilter,
  searchFilterForSource,
  type DiscourseVisitedFilter,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from '@/ui/controls/ButtonControls';
import { ModalSheetFrame, ModalSheetHeader } from '@/ui/controls/ModalSheetFrame';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { DiscourseFilterPickers, useDiscourseFilterPickers } from './DiscourseFilterPickers';
import { hasDiscourseAdvancedFilters, SearchFilterForm } from './SearchFilterForm';
import { createSearchFilterEdit } from './searchFilterEdit';

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

function SearchFilterBody({
  scrollOffsetRef,
  ...props
}: Pick<ScrollViewProps, 'children' | 'style' | 'contentContainerStyle'> & {
  scrollOffsetRef: RefObject<NonNullable<ScrollViewProps['contentOffset']>>;
}) {
  // The legacy Android KAV remounts on keyboard hide. Seed only the new native
  // viewport; ordinary draft renders must not control an in-progress scroll.
  const [initialOffset] = useState(() => scrollOffsetRef.current);
  return (
    <ScrollView
      overScrollMode="never"
      {...props}
      contentOffset={initialOffset}
      onScroll={({ nativeEvent }) => {
        scrollOffsetRef.current = nativeEvent.contentOffset;
      }}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
    />
  );
}

export function SearchFilterSheet({
  categories,
  sessionEpochs,
  requestsEnabled,
  readPlanScopes,
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
  readPlanScopes: { tags: string; users: string };
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
  const [editSession] = useState(() => createSearchFilterEdit(searchFilterForSource(searchFilters, source)));
  const [editView, setEditView] = useState(editSession.snapshot);
  const { draft: draftFilter, error: filterError, visible, more: moreVisible } = editView;
  const publishEdit = useCallback(() => setEditView(editSession.snapshot), [editSession]);
  const close = useCallback(() => {
    editSession.close();
    publishEdit();
  }, [editSession, publishEdit]);
  const moreChanged = useCallback(
    (value: boolean) => {
      editSession.moreChanged(value);
      publishEdit();
    },
    [editSession, publishEdit]
  );
  const scrollOffsetRef = useRef({ x: 0, y: 0 });
  const nodeSeekCategoryItems = useMemo(() => categoryOptions(categories, 'nodeseek'), [categories]);
  const yaohuoCategoryItems = useMemo(() => categoryOptions(categories, 'yaohuo'), [categories]);

  useEffect(() => {
    const filter = searchFilterForSource(searchFilters, source);
    editSession.observe(filter, hasDiscourseAdvancedFilters(filter));
    publishEdit();
  }, [editSession, publishEdit, searchFilters, source]);
  const updateDraft = useCallback(
    (partial: Partial<SourceSearchFilter>) => {
      editSession.edit(partial);
      publishEdit();
    },
    [editSession, publishEdit]
  );
  const resetDraft = useCallback(() => {
    editSession.reset(source);
    publishEdit();
  }, [editSession, publishEdit, source]);
  const applyDraft = useCallback(() => {
    const filter = editSession.validate();
    publishEdit();
    if (!filter) return;
    onApply(source, filter);
    close();
  }, [close, editSession, onApply, publishEdit, source]);

  const discourseDraft = isDiscourseSearchFilter(draftFilter) ? draftFilter : null;
  const pickers = useDiscourseFilterPickers({
    categories,
    discourseDraft,
    filterSheetVisible: visible,
    readPlanScopes,
    sessionEpochs,
    requestsEnabled,
    searchDiscourseTags: onSearchDiscourseTags,
    searchDiscourseUsers: onSearchDiscourseUsers
  });

  const toggleTag = useCallback(
    (name: string) => {
      editSession.toggleTag(name);
      publishEdit();
    },
    [editSession, publishEdit]
  );
  const toggleVisited = useCallback(
    (value: DiscourseVisitedFilter) => {
      editSession.toggleVisited(value);
      publishEdit();
    },
    [editSession, publishEdit]
  );
  const updateLinuxDoExpertResponse = useCallback(
    (value: boolean) => {
      editSession.expertResponseChanged(value);
      publishEdit();
    },
    [editSession, publishEdit]
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开搜索筛选，当前${summary}`}
        accessibilityState={{ selected: summary !== '默认' }}
        style={[styles.searchFilterEntry, summary !== '默认' && styles.searchFilterEntryActive]}
        onPress={() => {
          scrollOffsetRef.current = { x: 0, y: 0 };
          const filter = searchFilterForSource(searchFilters, source);
          editSession.open(filter, hasDiscourseAdvancedFilters(filter));
          publishEdit();
        }}
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
      <ModalSheetFrame backdropLabel="关闭筛选" visible={visible} onRequestClose={close}>
        <ModalSheetHeader
          title="筛选"
          subtitle={sourceLabel(source)}
          closeLabel="关闭筛选"
          closeTestID="search-filter-close"
          onClose={close}
        />
        <SearchFilterBody
          scrollOffsetRef={scrollOffsetRef}
          style={[styles.searchFilterBody, filterBodyStyle]}
          contentContainerStyle={styles.searchFilterBodyInner}
        >
          <SearchFilterForm
            categoryNames={pickers.category.names}
            draftFilter={draftFilter}
            filterSheetVisible={visible}
            moreVisible={moreVisible}
            nodeSeekCategoryItems={nodeSeekCategoryItems}
            onMoreVisibleChange={moreChanged}
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
        </SearchFilterBody>
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
