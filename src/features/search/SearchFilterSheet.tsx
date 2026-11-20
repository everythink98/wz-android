import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Keyboard, Pressable, ScrollView, type ScrollViewProps, Text, useWindowDimensions, View } from 'react-native';
import { ChevronDown, ChevronLeft, SlidersHorizontal, X } from 'lucide-react-native';
import { hashKey, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category, DiscourseTagOption, DiscourseUserOption, Source } from '@/domain/forum/models';
import { type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { sourceLabel } from '@/domain/forum/presentation';
import {
  isDiscourseSearchFilter,
  defaultSearchFilterForSource,
  discourseSearchFilterError,
  searchFilterSummary,
  type DiscourseSearchFilterError,
  type DiscourseVisitedFilter,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import { DiscourseFilterPickerPage, useDiscourseFilterPickers } from './DiscourseFilterPickers';
import { FilterCandidateInput, type FilterAppearance } from './SearchFilterControls';
import {
  filterPageTitles,
  hasAdvancedSearchFilters,
  SearchFilterChoices,
  SearchFilterForm,
  type LocalFilterPage,
  type SearchFilterPage
} from './SearchFilterForm';
import { V2exNodePicker, v2exSearchNodes } from './V2exNodePicker';

type ScrollOffsets = Partial<Record<SearchFilterPage, NonNullable<ScrollViewProps['contentOffset']>>>;
const filterErrorPages = {
  date: 'date',
  minPosts: 'posts',
  maxPosts: 'posts',
  minViews: 'views',
  maxViews: 'views'
} as const satisfies Record<DiscourseSearchFilterError['field'], LocalFilterPage>;

function SearchFilterBody({
  page,
  scrollOffsetsRef,
  ...props
}: Pick<ScrollViewProps, 'children' | 'style'> & {
  page: SearchFilterPage;
  scrollOffsetsRef: RefObject<ScrollOffsets>;
}) {
  // The legacy Android KAV remounts on keyboard hide. Seed only the new native
  // viewport; ordinary draft renders must not control an in-progress scroll.
  const [initialOffset] = useState(() => scrollOffsetsRef.current[page] ?? { x: 0, y: 0 });
  return (
    <ScrollView
      testID={`search-filter-body-${page}`}
      overScrollMode="never"
      {...props}
      contentOffset={initialOffset}
      onScroll={({ nativeEvent }) => {
        scrollOffsetsRef.current[page] = nativeEvent.contentOffset;
      }}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
    />
  );
}

export type SearchFilterPlacement = FilterAppearance & {
  source: Source;
  onApply: (source: Source, filter: SourceSearchFilter) => void;
};

type SearchFilterSheetProps = SearchFilterPlacement & {
  active: boolean;
  categories: Category[];
  sessionEpochs: ForumSessionEpochs;
  requestsEnabled: boolean;
  readPlanScopes: { tags: string; users: string };
  searchFilters: SearchFilterState;
  onLoadV2exNodes: (signal: AbortSignal) => Promise<Category[]>;
  onSearchDiscourseTags: (options: {
    source?: DiscourseSource;
    query: string;
    categoryId?: string;
    signal?: AbortSignal;
  }) => Promise<DiscourseTagOption[]>;
  onSearchDiscourseUsers: (options: {
    source?: DiscourseSource;
    term: string;
    categoryId?: string;
    signal?: AbortSignal;
  }) => Promise<DiscourseUserOption[]>;
};

export function SearchFilterSheet(props: SearchFilterSheetProps) {
  const { active, categories, sessionEpochs, readPlanScopes, source, searchFilters, styles, theme } = props;
  const [visible, setVisible] = useState(false);
  if (!active && visible) setVisible(false);
  const applied = searchFilters[source];
  const appliedUsername = isDiscourseSearchFilter(applied) ? applied.username : '';
  const queryClient = useQueryClient();
  const authorKey = forumQueryKeys.searchAuthorLabels(sessionEpochs.linuxdo, readPlanScopes.users);
  const { data: authors } = useQuery<DiscourseUserOption[]>({
    queryKey: authorKey,
    queryFn: skipToken,
    gcTime: Infinity,
    subscribed: source === 'linuxdo' && (visible || !!appliedUsername)
  });
  const appliedAuthorName = authors?.find((user) => user.username === appliedUsername)?.displayName;
  const hasNode = applied.source === 'v2ex' && !!applied.node;
  const directory = hasNode ? queryClient.getQueryData<Category[]>(forumQueryKeys.v2exNodeDirectory) : undefined;
  const summaryCategories = useMemo(
    () =>
      hasNode
        ? v2exSearchNodes(
            categories.filter((category) => category.source === 'v2ex'),
            directory
          )
        : categories,
    [categories, directory, hasNode]
  );
  const summary = useMemo(
    () => searchFilterSummary(source, applied, summaryCategories, appliedAuthorName),
    [applied, appliedAuthorName, source, summaryCategories]
  );
  const hasAppliedFilter = summary !== '默认';
  return (
    <>
      <Pressable
        testID="search-filter-trigger"
        accessibilityRole="button"
        accessibilityLabel={`打开搜索筛选，当前${summary}`}
        accessibilityState={{ expanded: visible, selected: hasAppliedFilter }}
        style={[styles.searchFilterTrigger, hasAppliedFilter && styles.searchFilterTriggerActive]}
        onPress={() => {
          if (!active) return;
          Keyboard.dismiss();
          setVisible(true);
        }}
      >
        <View style={styles.searchFilterEntryIcon}>
          <SlidersHorizontal size={17} color={theme.primary} strokeWidth={1.9} accessible={false} />
        </View>
        <Text style={styles.searchFilterEntryText}>筛选</Text>
        {hasAppliedFilter ? (
          <Text numberOfLines={1} style={[styles.searchFilterEntrySummary, styles.searchFilterEntrySummaryActive]}>
            {summary}
          </Text>
        ) : (
          <View style={styles.flex} />
        )}
        <ChevronDown size={16} color={theme.muted} strokeWidth={1.7} accessible={false} />
      </Pressable>
      {visible && (
        <SearchFilterEditor
          {...props}
          applied={applied}
          authors={authors}
          onClose={() => setVisible(false)}
          onSelectAuthor={(user) => {
            queryClient.setQueryData(authorKey, [
              user,
              ...(authors ?? []).filter(
                (other) => other.username === appliedUsername && other.username !== user.username
              )
            ]);
          }}
        />
      )}
    </>
  );
}

function toggleValue<Value>(items: Value[], value: Value): Value[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function SearchFilterEditor({
  categories,
  sessionEpochs,
  requestsEnabled,
  readPlanScopes,
  source,
  onLoadV2exNodes,
  styles,
  theme,
  onSearchDiscourseTags,
  onSearchDiscourseUsers,
  onApply,
  applied,
  authors,
  onClose,
  onSelectAuthor
}: SearchFilterSheetProps & {
  applied: SourceSearchFilter;
  authors?: DiscourseUserOption[];
  onClose: () => void;
  onSelectAuthor: (user: DiscourseUserOption) => void;
}) {
  const { height } = useWindowDimensions();
  const bodyMaxHeight = Math.round(height * 0.55);
  const scrollOffsets = useRef<ScrollOffsets>({});
  const [page, setPage] = useState<SearchFilterPage>('main');
  const [pickerQuery, setPickerQuery] = useState('');
  const [draftFilter, setDraftFilter] = useState(applied);
  const [filterError, setFilterError] = useState<DiscourseSearchFilterError | null>(null);
  const [moreVisible, setMoreVisible] = useState(() => hasAdvancedSearchFilters(applied));
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };
  const allCategory = source === 'yaohuo' ? '0' : '';
  const nodePickerActive = source === 'v2ex' && page === 'nodes';
  const nodeDirectory = useQuery({
    queryKey: forumQueryKeys.v2exNodeDirectory,
    queryFn: ({ signal }) => onLoadV2exNodes(signal),
    enabled: nodePickerActive,
    subscribed: nodePickerActive,
    staleTime: 24 * 60 * 60 * 1000
  });
  const sourceCategories = useMemo(() => {
    const recent = categories.filter((category) => category.source === source && category.id !== allCategory);
    return source === 'v2ex' ? v2exSearchNodes(recent, nodeDirectory.data) : recent;
  }, [allCategory, categories, nodeDirectory.data, source]);
  const categoryNames = useMemo(
    () =>
      new Map([
        [allCategory, source === 'yaohuo' ? '全部版块' : source === 'v2ex' ? '全部节点' : '全部分类'],
        ...sourceCategories.map(({ id, name }) => [id, name] as const)
      ]),
    [allCategory, source, sourceCategories]
  );

  useEffect(() => {
    setDraftFilter(applied);
    setMoreVisible(hasAdvancedSearchFilters(applied));
    setFilterError(null);
  }, [applied]);

  function updateDraft(partial: Partial<SourceSearchFilter>) {
    setFilterError(null);
    setDraftFilter((current) => ({ ...current, ...partial }) as SourceSearchFilter);
  }

  const discourseDraft = isDiscourseSearchFilter(draftFilter) ? draftFilter : null;
  const pickers = useDiscourseFilterPickers({
    discourseDraft,
    picker: page === 'tags' || page === 'author' ? page : null,
    query: pickerQuery,
    readPlanScopes,
    sessionEpochs,
    enabled: requestsEnabled,
    searchDiscourseTags: onSearchDiscourseTags,
    searchDiscourseUsers: onSearchDiscourseUsers
  });
  const onMainPage = page === 'main';
  const hasCandidateInput = page === 'category' || page === 'tags' || page === 'author';
  const categoryTitle = source === 'yaohuo' ? '选择版块' : filterPageTitles.category;
  const title = onMainPage ? '筛选' : page === 'category' ? categoryTitle : filterPageTitles[page];
  const appearance = { styles, theme };

  function changePage(nextPage: SearchFilterPage) {
    if (nextPage === page) return;
    Keyboard.dismiss();
    if (nextPage !== 'main') delete scrollOffsets.current[nextPage];
    setPickerQuery('');
    setPage(nextPage);
  }

  function returnToMain() {
    changePage('main');
  }

  function applyDraft() {
    const error = discourseDraft && discourseSearchFilterError(discourseDraft);
    if (error) {
      setFilterError(error);
      changePage(filterErrorPages[error.field]);
      return;
    }
    if (hashKey([applied]) !== hashKey([draftFilter])) onApply(source, draftFilter);
    close();
  }

  function toggleTag(tag: string) {
    setFilterError(null);
    setDraftFilter((current) =>
      isDiscourseSearchFilter(current) ? { ...current, tags: toggleValue(current.tags, tag) } : current
    );
  }

  function toggleVisited(value: DiscourseVisitedFilter) {
    setFilterError(null);
    setDraftFilter((current) =>
      isDiscourseSearchFilter(current) ? { ...current, visited: toggleValue(current.visited, value) } : current
    );
  }

  return (
    <ModalSheetFrame
      backdropLabel={onMainPage ? '关闭筛选' : '返回筛选条件'}
      visible
      onRequestClose={onMainPage ? close : returnToMain}
    >
      <View testID="modal-sheet-header" style={styles.searchFilterHeader}>
        {!onMainPage ? (
          <IconButton icon={ChevronLeft} iconOnly label="返回筛选" testID="search-filter-back" onPress={returnToMain} />
        ) : null}
        <View style={styles.searchFilterHeading}>
          <Text accessibilityRole="header" style={styles.searchFilterTitle}>
            {title}
          </Text>
          <Text style={styles.searchFilterSite}>{sourceLabel(source)}</Text>
        </View>
        <IconButton icon={X} iconOnly label="关闭筛选" testID="search-filter-close" onPress={close} />
      </View>
      {page === 'category' || page === 'nodes' ? (
        <FilterCandidateInput
          {...appearance}
          id={page === 'nodes' ? 'search-filter-node-query' : 'search-filter-input-category'}
          label={page === 'nodes' ? '搜索节点' : source === 'yaohuo' ? '搜索版块' : '搜索分类'}
          value={pickerQuery}
          onChange={setPickerQuery}
        />
      ) : null}
      {page === 'tags' || page === 'author' ? (
        <FilterCandidateInput
          {...appearance}
          id={page === 'tags' ? 'search-filter-input-tags' : 'search-filter-input-author'}
          label={page === 'tags' ? '搜索标签' : '搜索作者'}
          value={pickerQuery}
          onChange={setPickerQuery}
        />
      ) : null}
      {page === 'nodes' ? (
        <V2exNodePicker
          {...appearance}
          nodes={sourceCategories}
          query={pickerQuery}
          selected={draftFilter.source === 'v2ex' ? draftFilter.node : ''}
          height={bodyMaxHeight}
          loading={nodeDirectory.isFetching}
          error={nodeDirectory.isError}
          retry={() => void nodeDirectory.refetch()}
          onSelect={(node) => {
            updateDraft({ node });
            returnToMain();
          }}
        />
      ) : (
        <SearchFilterBody
          key={page}
          page={page}
          scrollOffsetsRef={scrollOffsets}
          style={[
            styles.searchFilterBody,
            { maxHeight: bodyMaxHeight },
            hasCandidateInput && { height: bodyMaxHeight }
          ]}
        >
          {page === 'main' ? (
            <SearchFilterForm
              {...appearance}
              authorDisplayName={authors?.find((user) => user.username === discourseDraft?.username)?.displayName}
              categoryNames={categoryNames}
              draftFilter={draftFilter}
              moreVisible={moreVisible}
              onMoreVisibleChange={(visible) => {
                Keyboard.dismiss();
                setMoreVisible(visible);
              }}
              openPage={changePage}
              toggleTag={toggleTag}
              updateDraft={updateDraft}
            />
          ) : page === 'tags' || page === 'author' ? (
            discourseDraft && (
              <DiscourseFilterPickerPage
                {...appearance}
                picker={page}
                controller={pickers}
                query={pickerQuery}
                draftFilter={discourseDraft}
                toggleTag={toggleTag}
                selectAuthor={(user) => {
                  onSelectAuthor(user);
                  updateDraft({ username: user.username });
                  returnToMain();
                }}
              />
            )
          ) : (
            <SearchFilterChoices
              {...appearance}
              page={page}
              categories={sourceCategories}
              categoryNames={categoryNames}
              categoryQuery={pickerQuery}
              draftFilter={draftFilter}
              error={filterError}
              toggleVisited={toggleVisited}
              updateDraft={updateDraft}
              onReturn={returnToMain}
            />
          )}
        </SearchFilterBody>
      )}
      <View style={styles.searchFilterActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重置"
          style={styles.searchFilterReset}
          onPress={() => {
            setFilterError(null);
            setDraftFilter(defaultSearchFilterForSource(source));
            if (!onMainPage) returnToMain();
          }}
        >
          <Text style={styles.searchFilterLabel}>重置</Text>
        </Pressable>
        <AppButton size="lg" minWidth={108} label="确认筛选" variant="solid" onPress={applyDraft} />
      </View>
    </ModalSheetFrame>
  );
}
