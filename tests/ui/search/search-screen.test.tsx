import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render as renderNative, waitFor, within } from '../render';
import React, { Suspense, useState } from 'react';
import { AppState, DeviceEventEmitter, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordUserInteraction, userPresent } from '@/platform/network/userPresence';
import { createEmptyReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState, type SourceSearchFilter } from '@/domain/forum/searchFilters';
import type { SearchGroup } from '@/features/search/listItems';
import { SearchScreen } from '@/features/search/SearchScreen';
import { SearchFilterSheet, type SearchFilterPlacement } from '@/features/search/SearchFilterSheet';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { Category, FeedSource, Source, Topic } from '@/domain/forum/models';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { aggregateSearchSources, isSessionSource } from '@/domain/forum/sourceCatalog';
import { resolveForumReadPlan, type ForumReadOperation } from '@/domain/forum/readPlan';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { SearchRoute, SearchRouteRuntimeProvider, type SearchRouteRuntimeValue } from '@/features/search/SearchRoute';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import type { ReadGateway } from '@/sources/readGateway';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme, readerRadii } from '@/ui/theme/tokens';

const mockSearchScrollToOffset = jest.fn<(options: { offset: number; animated: boolean }) => void>();
const mockSearchNavigationDispatch = jest.fn();
const mockSearchNavigation = { dispatch: mockSearchNavigationDispatch, isFocused: () => mockSearchFocused };
const mockSearchInputCommit = jest.fn();
let mockSearchFocused = true;
let lastSearchListData: readonly unknown[] = [];
let mockSearchFlashListExtraData: unknown;
let mockSearchFlashListRenderItem: unknown;
let lastSearchListSeparatorComponent:
  ((props: { leadingItem: unknown; trailingItem: unknown }) => React.ReactNode) | null = null;

jest.mock('@react-navigation/native', () => ({
  ...(jest.requireActual('@react-navigation/native') as Record<string, unknown>),
  useIsFocused: () => mockSearchFocused,
  useNavigation: () => mockSearchNavigation,
  useScrollToTop: () => undefined
}));

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest'));

function render(element: React.ReactElement) {
  return renderNative(element, { wrapper: QueryTestWrapper });
}

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    useMappingHelper: () => ({ getMappingKey: (value: string, index: number) => `${value}-${index}` }),
    FlashList: ReactModule.forwardRef(function FlashList(
      {
        data = [],
        accessibilityLabel,
        accessibilityLiveRegion,
        accessibilityState,
        keyExtractor,
        extraData,
        ListEmptyComponent,
        ListHeaderComponent,
        ItemSeparatorComponent,
        onScrollBeginDrag,
        onViewableItemsChanged,
        renderItem,
        testID
      }: {
        accessibilityLabel?: string;
        accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
        accessibilityState?: { busy?: boolean };
        data?: unknown[];
        extraData?: unknown;
        keyExtractor?: (item: unknown, index: number) => string;
        ListEmptyComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        ItemSeparatorComponent?: (props: { leadingItem: unknown; trailingItem: unknown }) => React.ReactNode;
        onScrollBeginDrag?: () => void;
        onViewableItemsChanged?: (info: { viewableItems: unknown[]; changed: unknown[] }) => void;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{
        recordInteraction: () => void;
        recomputeViewableItems: () => void;
        scrollToOffset: (options: { offset: number; animated: boolean }) => void;
      }>
    ) {
      lastSearchListData = data;
      mockSearchFlashListExtraData = extraData;
      mockSearchFlashListRenderItem = renderItem;
      lastSearchListSeparatorComponent = ItemSeparatorComponent || null;
      ReactModule.useImperativeHandle(ref, () => ({
        recordInteraction: () => undefined,
        recomputeViewableItems: () => undefined,
        scrollToOffset: (options) => mockSearchScrollToOffset(options)
      }));
      return ReactModule.createElement(
        NativeView,
        {
          accessibilityLabel,
          accessibilityLiveRegion,
          accessibilityState,
          testID: testID ?? 'search-list',
          onScrollBeginDrag,
          onViewableItemsChanged
        } as React.ComponentProps<typeof NativeView>,
        ListHeaderComponent,
        ...data.map((item, index) =>
          ReactModule.createElement(
            NativeView,
            { key: keyExtractor?.(item, index) ?? index },
            renderItem?.({ item, index }),
            ItemSeparatorComponent && index + 1 < data.length
              ? ReactModule.createElement(ItemSeparatorComponent, { leadingItem: item, trailingItem: data[index + 1] })
              : null
          )
        ),
        data.length ? null : ListEmptyComponent
      );
    })
  };
});

jest.mock('lucide-react-native', () => ({
  Check: () => null,
  ChevronDown: () => null,
  ChevronLeft: () => null,
  ChevronRight: () => null,
  ChevronUp: () => null,
  ExternalLink: () => null,
  Eye: () => null,
  History: () => null,
  MessageCircle: () => null,
  Search: function MockSearchIcon({ size }: { size: number }) {
    const { useLayoutEffect } = require('react') as typeof React;
    useLayoutEffect(() => {
      // The leading icon records committed work inside the production search input.
      if (size === 18) mockSearchInputCommit();
    });
    return null;
  },
  SlidersHorizontal: () => null,
  Sparkles: () => null,
  X: () => null
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable, Text: NativeText } = require('react-native') as typeof import('react-native');
  return function MockDateTimePicker({
    onValueChange
  }: {
    onValueChange: (event: { nativeEvent: { timestamp: number; utcOffset: number } }, date: Date) => void;
  }) {
    const selectedDate = new Date(2026, 6, 1);
    return ReactModule.createElement(
      NativePressable,
      {
        accessibilityRole: 'button',
        accessibilityLabel: '确认日期 2026-07-01',
        onPress: () => onValueChange({ nativeEvent: { timestamp: selectedDate.getTime(), utcOffset: 0 } }, selectedDate)
      },
      ReactModule.createElement(NativeText, null, '确认日期')
    );
  };
});

const readerData = createEmptyReaderData();
const topicStateIndex = createTopicListItemStateIndex(readerData);
const categories: Category[] = [
  { source: 'linuxdo', id: '2', name: '技术', slug: 'tech', topicCount: 120 },
  {
    source: 'linuxdo',
    id: '4',
    name: '开发调优',
    slug: 'dev',
    parentId: '2',
    parentSlug: 'tech',
    topicCount: 88,
    readRestricted: true
  },
  { source: 'nodeseek', id: 'daily', name: '日常' },
  { source: 'yaohuo', id: '177', name: '妖火茶馆' }
];
type FilterInputs = Omit<React.ComponentProps<typeof SearchFilterSheet>, keyof SearchFilterPlacement>;
const filterDefaults: FilterInputs = {
  active: true,
  categories,
  sessionEpochs: initialForumSessionEpochs,
  requestsEnabled: true,
  readPlanScopes: { tags: 'public:omit', users: 'public:omit' },
  searchFilters: DEFAULT_SEARCH_FILTERS,
  onLoadV2exNodes: async () => [],
  onSearchDiscourseTags: async () => [],
  onSearchDiscourseUsers: async () => []
};

function contentSourceReaderData(enabledSources: readonly Source[]) {
  const data = createEmptyReaderData();
  return {
    ...data,
    settings: {
      ...data.settings,
      contentSources: data.settings.contentSources.map((preference) => ({
        ...preference,
        enabled: enabledSources.includes(preference.source)
      }))
    }
  };
}

function createSearchRouteRuntime({
  linuxDoVerificationVisible = false,
  readGateway,
  readerData,
  sessionViewModels
}: {
  linuxDoVerificationVisible?: boolean;
  readGateway: ReadGateway;
  readerData: ReturnType<typeof contentSourceReaderData>;
  sessionViewModels: SearchRouteRuntimeValue['account']['sessionViewModels'];
}): SearchRouteRuntimeValue {
  return {
    enabledSources: readerData.settings.contentSources.filter((entry) => entry.enabled).map((entry) => entry.source),
    account: {
      linuxDoVerificationVisible,
      readGateway,
      reconcileAccountStatus: jest.fn(async () => ({ status: 'stale' as const })),
      requestNodeSeekVerification: jest.fn(),
      sessionEpochs: initialForumSessionEpochs,
      sessionViewModels,
      showLinuxDoVerification: jest.fn<SearchRouteRuntimeValue['account']['showLinuxDoVerification']>(),
      showYaohuoLogin: jest.fn()
    },
    catalogCategories: categories,
    notify: jest.fn(),
    topicStateIndex: createTopicListItemStateIndex(readerData)
  };
}

function routeReadPlan(
  source: Source,
  operation: ForumReadOperation,
  enabledSources: readonly Source[],
  sessionViewModels: SearchRouteRuntimeValue['account']['sessionViewModels'],
  linuxDoVerificationVisible = false
) {
  return resolveForumReadPlan(
    source,
    operation,
    enabledSources.includes(source),
    isSessionSource(source)
      ? {
          source,
          authenticated: sessionViewModels[source].isLoggedIn,
          authSurfaceOpen: source === 'linuxdo' && linuxDoVerificationVisible,
          identityKey: `${source}:route-test`,
          identityTrust: sessionViewModels[source].identityTrust,
          sessionEpoch: initialForumSessionEpochs[source],
          sourceEnabled: enabledSources.includes(source)
        }
      : undefined
  );
}

const firstTopic: Topic = {
  source: 'v2ex',
  id: 'search-1',
  title: '第一页主题',
  author: 'alice',
  url: 'https://www.v2ex.com/t/1',
  createdAt: '2026-07-14T00:00:00.000Z',
  replyCount: 1
};

const secondTopic: Topic = {
  ...firstTopic,
  id: 'search-2',
  title: '第二页主题',
  url: 'https://www.v2ex.com/t/2'
};

const linuxTopic: Topic = {
  ...firstTopic,
  source: 'linuxdo',
  id: 'linux-search-1',
  title: 'linux.do 主题',
  url: 'https://linux.do/t/topic/linux-search-1'
};

function visibleLoadMore(group: SearchGroup, page: number, index: number) {
  return {
    index,
    isViewable: true,
    key: `${group.source}:groupLoadMore:${page}`,
    item: { type: 'groupLoadMore' as const, group, page }
  };
}

function SearchHarness({ initialSource = 'v2ex' }: { initialSource?: FeedSource }) {
  const [route, setRoute] = useState<'search' | 'topic' | 'user'>('search');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [searchSource, setSearchSource] = useState<FeedSource>(initialSource);
  const [searchFilters, setSearchFilters] = useState<SearchFilterState>(() => ({
    v2ex: { ...DEFAULT_SEARCH_FILTERS.v2ex },
    linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo },
    nodeseek: { ...DEFAULT_SEARCH_FILTERS.nodeseek },
    yaohuo: { ...DEFAULT_SEARCH_FILTERS.yaohuo }
  }));

  if (route === 'topic') {
    return (
      <View testID="topic-placeholder">
        <Pressable accessibilityRole="button" accessibilityLabel="打开作者页" onPress={() => setRoute('user')}>
          <Text>打开作者页</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="返回搜索" onPress={() => setRoute('search')}>
          <Text>返回搜索</Text>
        </Pressable>
      </View>
    );
  }
  if (route === 'user') {
    return (
      <View testID="user-placeholder">
        <Pressable accessibilityRole="button" accessibilityLabel="返回主题" onPress={() => setRoute('topic')}>
          <Text>返回主题</Text>
        </Pressable>
      </View>
    );
  }

  const resultSource: Source = searchSource === 'all' ? 'v2ex' : searchSource;
  const resultLabel =
    resultSource === 'v2ex'
      ? 'V2EX'
      : resultSource === 'linuxdo'
        ? 'linux.do'
        : resultSource === 'nodeseek'
          ? 'NodeSeek'
          : '妖火';
  const resultFirstTopic = resultSource === 'linuxdo' ? linuxTopic : { ...firstTopic, source: resultSource };
  const resultSecondTopic =
    resultSource === 'v2ex'
      ? secondTopic
      : {
          ...resultFirstTopic,
          id: `${resultSource}-search-2`,
          title: '第二页主题',
          url: `${resultFirstTopic.url}/2`
        };
  const searchGroups = submittedQuery
    ? [
        {
          source: resultSource,
          label: resultLabel,
          items: page === 1 ? [resultFirstTopic] : [resultFirstTopic, resultSecondTopic],
          hasMore: page === 1,
          nextPage: page === 1 ? 2 : null
        }
      ]
    : [];
  const loadMoreSearchSource = (_source: Source, nextPage: number) => setPage(Number(nextPage));

  return (
    <SearchScreen
      busy={false}
      renderFilters={(placement) => (
        <SearchFilterSheet
          {...filterDefaults}
          {...placement}
          searchFilters={searchFilters}
          onSearchDiscourseTags={async () => [
            { name: '人工智能', topicCount: 12 },
            { name: '快问快答', topicCount: 3 }
          ]}
          onSearchDiscourseUsers={async () => [{ id: '7', username: 'alice', displayName: '山月' }]}
        />
      )}
      query={query}
      readScope={`${searchSource}:${submittedQuery}`}
      recentSearches={[]}
      topicStateIndex={topicStateIndex}
      searchGroups={searchGroups}
      expectedSearchSources={aggregateSearchSources}
      linuxDoAiState={{ status: 'idle', enabled: false, count: 0 }}
      linuxDoAiVisible={false}
      searchSource={searchSource}
      submittedQuery={submittedQuery}
      onOpenTopic={() => setRoute('topic')}
      onManageContentSources={jest.fn()}
      onLoadMoreSearchSource={loadMoreSearchSource}
      onRemoveRecentSearch={jest.fn()}
      onQueryChange={setQuery}
      onRetrySearchSource={jest.fn()}
      onRetryLinuxDoAiSearch={jest.fn()}
      onSearch={() => {
        setSubmittedQuery(query.trim());
        setPage(1);
      }}
      onSearchFilterApply={(source: Source, filter: SourceSearchFilter) => {
        setSearchFilters((current) => ({ ...current, [source]: filter }) as SearchFilterState);
      }}
      onToggleLinuxDoAiSearch={jest.fn()}
      onSearchSourceChange={setSearchSource}
    />
  );
}

function RecentSearchHarness({
  onRemoveRecentSearch,
  onSearch
}: {
  onRemoveRecentSearch: (query: string) => void;
  onSearch: (queryOverride?: string) => void;
}) {
  const [query, setQuery] = useState('');

  return (
    <SearchScreen
      busy={false}
      renderFilters={() => null}
      query={query}
      readScope="recent-searches"
      recentSearches={['codex', 'react native']}
      topicStateIndex={topicStateIndex}
      searchGroups={[]}
      expectedSearchSources={aggregateSearchSources}
      linuxDoAiState={{ status: 'idle', enabled: false, count: 0 }}
      linuxDoAiVisible={false}
      searchSource="all"
      submittedQuery=""
      onOpenTopic={jest.fn()}
      onManageContentSources={jest.fn()}
      onLoadMoreSearchSource={jest.fn<React.ComponentProps<typeof SearchScreen>['onLoadMoreSearchSource']>()}
      onRemoveRecentSearch={onRemoveRecentSearch}
      onQueryChange={setQuery}
      onRetrySearchSource={jest.fn()}
      onRetryLinuxDoAiSearch={jest.fn()}
      onSearch={onSearch}
      onSearchFilterApply={jest.fn()}
      onToggleLinuxDoAiSearch={jest.fn()}
      onSearchSourceChange={jest.fn()}
    />
  );
}

type SearchFixtureProps = Partial<React.ComponentProps<typeof SearchScreen>> & { filter?: Partial<FilterInputs> };

function createSearchScreenProps({ filter, ...overrides }: SearchFixtureProps = {}) {
  const props: React.ComponentProps<typeof SearchScreen> = {
    busy: false,
    renderFilters: (placement) => <SearchFilterSheet {...filterDefaults} {...filter} {...placement} />,
    query: 'codex',
    readScope: `${overrides.searchSource ?? 'all'}:${overrides.submittedQuery ?? 'codex'}`,
    recentSearches: [],
    topicStateIndex,
    searchGroups: [],
    expectedSearchSources: aggregateSearchSources,
    linuxDoAiState: { status: 'idle', enabled: false, count: 0 },
    linuxDoAiVisible: false,
    searchSource: 'all',
    submittedQuery: 'codex',
    onOpenTopic: jest.fn(),
    onManageContentSources: jest.fn(),
    onLoadMoreSearchSource: jest.fn<React.ComponentProps<typeof SearchScreen>['onLoadMoreSearchSource']>(),
    onRemoveRecentSearch: jest.fn(),
    onQueryChange: jest.fn(),
    onRetrySearchSource: jest.fn(),
    onRetryLinuxDoAiSearch: jest.fn(),
    onSearch: jest.fn(),
    onSearchFilterApply: jest.fn(),
    onToggleLinuxDoAiSearch: jest.fn(),
    onSearchSourceChange: jest.fn(),
    ...overrides
  };
  return props;
}

function renderSearchScreen(overrides: SearchFixtureProps = {}) {
  return render(<SearchScreen {...createSearchScreenProps(overrides)} />);
}

describe('Search state', () => {
  it('restores failed history edits when Search returns from a frozen stack', async () => {
    const storageKey = 'reader-search-history';
    const previous = await AsyncStorage.getItem(storageKey);
    await AsyncStorage.setItem(storageKey, JSON.stringify(['saved query']));
    const pendingWrite = Promise.withResolvers<void>();
    const write = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(() => pendingWrite.promise);
    const enabledSources = ['v2ex'] as const;
    const sessionViewModels = projectTestAccountSessions(createSiteSessionStates());
    const runtime = createSearchRouteRuntime({
      readerData: contentSourceReaderData(enabledSources),
      sessionViewModels,
      readGateway: {
        getReadPlan: (source: Source, operation: ForumReadOperation) =>
          routeReadPlan(source, operation, enabledSources, sessionViewModels)
      } as ReadGateway
    });
    const frozen = new Promise<never>(() => {});
    function FreezeSearch({ hidden }: { hidden: boolean }) {
      // React Native Screens retains the mounted route behind a Suspense fallback.
      if (hidden) throw frozen;
      return <SearchRoute />;
    }
    const route = (hidden: boolean) => (
      <SearchRouteRuntimeProvider value={runtime}>
        <Suspense fallback={<Text>覆盖搜索的页面</Text>}>
          <FreezeSearch hidden={hidden} />
        </Suspense>
      </SearchRouteRuntimeProvider>
    );
    const searchLabel = '搜索最近记录 saved query';
    const view = await render(route(false));
    try {
      await fireEvent.press(await view.findByLabelText('删除最近搜索 saved query'));
      await waitFor(() => expect(write).toHaveBeenCalledWith(storageKey, '[]'));
      expect(view.queryByLabelText(searchLabel)).toBeNull();
      mockSearchFocused = false;
      await view.rerender(route(false));
      await view.rerender(route(true));
      expect(view.getByText('覆盖搜索的页面')).toBeTruthy();
      await act(async () => pendingWrite.reject(new Error('temporary local write failure')));
      expect(runtime.notify).not.toHaveBeenCalled();

      mockSearchFocused = true;
      await view.rerender(route(false));
      expect(view.getByLabelText(searchLabel)).toBeTruthy();
      expect(runtime.notify).toHaveBeenCalledTimes(1);
      expect(runtime.notify).toHaveBeenCalledWith(expect.stringContaining('最近搜索保存失败'));
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      mockSearchFocused = true;
      pendingWrite.resolve();
      write.mockRestore();
      await view.unmount();
      if (previous === null) await AsyncStorage.removeItem(storageKey);
      else await AsyncStorage.setItem(storageKey, previous);
    }
  });

  it('keeps unchanged search controls committed across focus-only changes', async () => {
    const props = createSearchScreenProps({ query: '', submittedQuery: '', recentSearches: ['Android', 'codex'] });
    const view = await render(<SearchScreen {...props} active />);
    const initialInputCommits = mockSearchInputCommit.mock.calls.length;

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await view.rerender(<SearchScreen {...props} active={false} />);
      await view.rerender(<SearchScreen {...props} active />);
    }

    expect(mockSearchInputCommit.mock.calls.length - initialInputCommits).toBe(0);
    expect(view.getByLabelText('搜索关键词').props.value).toBe('');
    expect(view.getByLabelText('搜索最近记录 codex')).toBeTruthy();

    const onSearch = jest.fn();
    await view.rerender(<SearchScreen {...props} active query="new query" onSearch={onSearch} />);
    expect(mockSearchInputCommit.mock.calls.length).toBeGreaterThan(initialInputCommits);
    expect(view.getByLabelText('搜索关键词').props.value).toBe('new query');
    await fireEvent.press(view.getByLabelText('提交搜索'));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(props.onSearch).not.toHaveBeenCalled();
  });

  it('pauses the retained AI loading animation on blur without replacing its pending result', async () => {
    appQueryClient.clear();
    const enabledSources = ['linuxdo'] as const;
    const sessionViewModels = projectTestAccountSessions(
      createSiteSessionStates({
        linuxdo: {
          site: 'linuxdo',
          status: 'logged-in',
          cookieSummary: ['session-present'],
          isVerifying: false,
          currentUser: testAccountUser('linuxdo')
        }
      })
    );
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>(
      async ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
        })
    );
    const readGateway = {
      getReadPlan: (source: Source, operation: ForumReadOperation) =>
        routeReadPlan(source, operation, enabledSources, sessionViewModels),
      searchTopics: jest.fn(async () => ({ items: [linuxTopic], errors: {}, hasMore: false, nextPage: null })),
      searchSemanticTopics,
      searchTagOptions: jest.fn(async () => []),
      searchUserOptions: jest.fn(async () => [])
    } as unknown as ReadGateway;
    const runtime = createSearchRouteRuntime({
      readGateway,
      readerData: contentSourceReaderData(enabledSources),
      sessionViewModels
    });
    const route = () => (
      <SearchRouteRuntimeProvider value={runtime}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );
    const view = await render(route());
    const indicators = () =>
      view.root?.queryAll((instance) => instance.props.accessibilityRole === 'progressbar') ?? [];
    try {
      await fireEvent.press(view.getByTestId('search-source-linuxdo'));
      await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'codex');
      await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
      await fireEvent.press(view.getByText('相关'));
      await fireEvent.press(view.getByText('确认筛选'));
      await fireEvent.press(view.getByLabelText('提交搜索'));
      await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(view.getByText('linux.do 主题')).toBeTruthy());
      expect(view.getByText('加载中')).toBeTruthy();
      expect(indicators().some((indicator) => indicator.props.accessibilityState.busy)).toBe(true);

      mockSearchFocused = false;
      await view.rerender(route());
      await waitFor(() => expect(searchSemanticTopics.mock.calls[0]?.[0].signal?.aborted).toBe(true));
      expect(view.getByText('加载中')).toBeTruthy();
      expect(view.getByText('linux.do 主题')).toBeTruthy();
      expect(indicators().every((indicator) => !indicator.props.accessibilityState.busy)).toBe(true);

      mockSearchFocused = true;
      await view.rerender(route());
      await waitFor(() => expect(indicators().some((indicator) => indicator.props.accessibilityState.busy)).toBe(true));
      expect(view.getByText('加载中')).toBeTruthy();
    } finally {
      mockSearchFocused = true;
      await act(async () => appQueryClient.cancelQueries());
      await view.unmount();
    }
  });

  it('keeps the Search list renderer stable across unchanged route renders', async () => {
    const enabledSources = ['v2ex'] as const;
    const sessionViewModels = projectTestAccountSessions(createSiteSessionStates({}));
    const readGateway = {
      getReadPlan: (source: Source, operation: ForumReadOperation) =>
        routeReadPlan(source, operation, enabledSources, sessionViewModels),
      searchTopics: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      searchTagOptions: jest.fn(async () => []),
      searchUserOptions: jest.fn(async () => [])
    } as unknown as ReadGateway;
    const runtime = createSearchRouteRuntime({
      readGateway,
      readerData: contentSourceReaderData(enabledSources),
      sessionViewModels
    });
    const route = () => (
      <SearchRouteRuntimeProvider value={runtime}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );
    const view = await render(route());
    await act(async () => undefined);
    const renderItem = mockSearchFlashListRenderItem;
    expect(renderItem).toBeDefined();
    for (let index = 0; index < 5; index += 1) {
      await view.rerender(route());
      expect(mockSearchFlashListRenderItem).toBe(renderItem);
    }
    expect(readGateway.searchTopics).not.toHaveBeenCalled();
  });

  it('waits for the requested search page to commit before another drag can advance its Query cursor', async () => {
    const enabledSources = ['nodeseek'] as const;
    const sessionViewModels = projectTestAccountSessions(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session-present'],
          isVerifying: false,
          currentUser: testAccountUser('nodeseek')
        }
      })
    );
    const first: Topic = { ...firstTopic, source: 'nodeseek' };
    const second: Topic = { ...secondTopic, source: 'nodeseek' };
    const third: Topic = { ...second, id: 'search-3', title: '第三页主题' };
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({ items: [first], errors: {}, hasMore: true, nextPage: 2 })
      .mockResolvedValueOnce({ items: [second], errors: {}, hasMore: true, nextPage: 3 })
      .mockResolvedValue({ items: [third], errors: {}, hasMore: false, nextPage: null });
    const readGateway = {
      getReadPlan: (source: Source, operation: ForumReadOperation) =>
        routeReadPlan(source, operation, enabledSources, sessionViewModels),
      searchTopics,
      searchTagOptions: jest.fn(async () => []),
      searchUserOptions: jest.fn(async () => [])
    } as unknown as ReadGateway;
    const runtime = createSearchRouteRuntime({
      readGateway,
      readerData: contentSourceReaderData(enabledSources),
      sessionViewModels
    });
    const view = await render(
      <SearchRouteRuntimeProvider value={runtime}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );
    const notifications: (() => void)[] = [];
    try {
      await fireEvent.press(view.getByTestId('search-source-nodeseek'));
      await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'codex');
      await fireEvent.press(view.getByLabelText('提交搜索'));
      await waitFor(() => expect(view.getByTestId('search-load-more-nodeseek-page-2')).toBeTruthy());
      const group: SearchGroup = {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [first],
        hasMore: true,
        nextPage: 2
      };
      const sentinel = visibleLoadMore(group, 2, 1);
      const list = view.getByTestId('search-complete');
      notifyManager.setScheduler((callback) => notifications.push(callback));
      await act(async () => {
        list.props.onScrollBeginDrag();
        list.props.onViewableItemsChanged({ viewableItems: [sentinel], changed: [sentinel] });
        // Query can settle before its scheduled observer notifications commit the new list props.
        for (let index = 0; index < 40; index += 1) await Promise.resolve();
        list.props.onScrollBeginDrag();
        list.props.onViewableItemsChanged({ viewableItems: [sentinel], changed: [sentinel] });
        for (let index = 0; index < 40; index += 1) await Promise.resolve();
      });
      expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
      notifyManager.setScheduler(defaultScheduler);
      await act(async () => notifications.splice(0).forEach((notify) => notify()));
      await waitFor(() => expect(view.getByTestId('search-load-more-nodeseek-page-3')).toBeTruthy());
      expect(view.getByText('第一页主题')).toBeTruthy();
      expect(view.getByText('第二页主题')).toBeTruthy();
      const nextSentinel = visibleLoadMore({ ...group, items: [first, second], nextPage: 3 }, 3, 3);
      await fireEvent(view.getByTestId('search-complete'), 'scrollBeginDrag');
      await fireEvent(view.getByTestId('search-complete'), 'viewableItemsChanged', {
        viewableItems: [nextSentinel],
        changed: [nextSentinel]
      });
      await waitFor(() => expect(view.getByText('第三页主题')).toBeTruthy());
      expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 3]);
    } finally {
      notifyManager.setScheduler(defaultScheduler);
      await act(async () => {
        notifications.splice(0).forEach((notify) => notify());
        await appQueryClient.cancelQueries();
      });
      await view.unmount();
    }
  });

  it('keeps pagination feedback with the search account that actually loaded the page', async () => {
    const enabledSources = ['nodeseek'] as const;
    const first: Topic = { ...firstTopic, source: 'nodeseek', title: '旧账号第一页' };
    const second: Topic = { ...secondTopic, source: 'nodeseek', title: '旧账号第二页' };
    const replacementFirst: Topic = { ...first, id: 'replacement-1', title: '新账号第一页' };
    const replacementSecond: Topic = { ...second, id: 'replacement-2', title: '新账号第二页' };
    const searchTopicsA = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({ items: [first], errors: {}, hasMore: true, nextPage: 2 })
      .mockResolvedValue({ items: [second], errors: {}, hasMore: false, nextPage: null });
    const searchTopicsB = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({ items: [replacementFirst], errors: {}, hasMore: true, nextPage: 2 })
      .mockResolvedValue({ items: [replacementSecond], errors: {}, hasMore: false, nextPage: null });
    const routeRuntime = (id: string, epoch: number, searchTopics: ReadGateway['searchTopics']) => {
      const sessionViewModels = projectTestAccountSessions(
        createSiteSessionStates({
          nodeseek: {
            site: 'nodeseek',
            status: 'logged-in',
            cookieSummary: ['session-present'],
            isVerifying: false,
            currentUser: { ...testAccountUser('nodeseek'), id }
          }
        })
      );
      const readGateway = {
        getReadPlan: (source: Source, operation: ForumReadOperation) =>
          resolveForumReadPlan(
            source,
            operation,
            source === 'nodeseek',
            source === 'nodeseek'
              ? {
                  source,
                  authenticated: true,
                  authSurfaceOpen: false,
                  identityTrust: 'confirmed',
                  identityKey: `nodeseek:${id}`,
                  sessionEpoch: epoch,
                  sourceEnabled: true
                }
              : undefined
          ),
        searchTopics,
        searchTagOptions: jest.fn(async () => []),
        searchUserOptions: jest.fn(async () => [])
      } as unknown as ReadGateway;
      const runtime = createSearchRouteRuntime({
        readGateway,
        readerData: contentSourceReaderData(enabledSources),
        sessionViewModels
      });
      runtime.account.sessionEpochs = { ...runtime.account.sessionEpochs, nodeseek: epoch };
      return runtime;
    };
    const tree = (runtime: SearchRouteRuntimeValue) => (
      <SearchRouteRuntimeProvider value={runtime}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );
    const accountA = routeRuntime('123', 0, searchTopicsA);
    const accountB = routeRuntime('456', 1, searchTopicsB);
    const view = await render(tree(accountA));
    const pageStatus = 'search-page-loaded-nodeseek-page-2';
    const loadMore = async (topic: Topic) => {
      const group: SearchGroup = { source: 'nodeseek', label: 'NodeSeek', items: [topic], hasMore: true, nextPage: 2 };
      const sentinel = visibleLoadMore(group, 2, 1);
      await fireEvent(view.getByTestId('search-complete'), 'scrollBeginDrag');
      await fireEvent(view.getByTestId('search-complete'), 'viewableItemsChanged', {
        viewableItems: [sentinel],
        changed: [sentinel]
      });
    };
    try {
      await fireEvent.press(view.getByTestId('search-source-nodeseek'));
      await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'same');
      await fireEvent.press(view.getByLabelText('提交搜索'));
      await waitFor(() => expect(view.getByTestId('search-load-more-nodeseek-page-2')).toBeTruthy());
      await loadMore(first);
      await waitFor(() => expect(view.getByTestId(pageStatus)).toBeTruthy());
      expect(view.getByText('已载入 2 条')).toBeTruthy();
      expect(searchTopicsA.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);

      await view.rerender(tree(accountA));
      expect(view.getByTestId(pageStatus)).toBeTruthy();
      mockSearchFocused = false;
      await view.rerender(tree(accountB));
      mockSearchFocused = true;
      await view.rerender(tree(accountB));
      await waitFor(() => expect(view.getByText(replacementFirst.title)).toBeTruthy());
      expect(view.queryByText(second.title)).toBeNull();
      expect(view.getByTestId('search-load-more-nodeseek-page-2')).toBeTruthy();
      expect(searchTopicsB.mock.calls.map(([request]) => request.page)).toEqual([1]);
      expect(view.queryByTestId(pageStatus)).toBeNull();

      await loadMore(replacementFirst);
      await waitFor(() => expect(view.getByText(replacementSecond.title)).toBeTruthy());
      expect(view.getByTestId(pageStatus)).toBeTruthy();
      expect(view.getByText('已载入 2 条')).toBeTruthy();
      expect(searchTopicsB.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
    } finally {
      mockSearchFocused = true;
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it.each(['network failure', 'focus cancellation'] as const)(
    'resumes NodeSeek pagination after %s without losing loaded results',
    async (interruption) => {
      const enabledSources = ['nodeseek'] as const;
      const sessionViewModels = projectTestAccountSessions(
        createSiteSessionStates({
          nodeseek: {
            site: 'nodeseek',
            status: 'logged-in',
            cookieSummary: ['session-present'],
            isVerifying: false,
            currentUser: testAccountUser('nodeseek')
          }
        })
      );
      const first: Topic = { ...firstTopic, source: 'nodeseek', url: 'https://www.nodeseek.com/post-1-1' };
      const second: Topic = { ...secondTopic, source: 'nodeseek', url: 'https://www.nodeseek.com/post-2-1' };
      const pendingPage = Promise.withResolvers<Awaited<ReturnType<ReadGateway['searchTopics']>>>();
      const searchTopics = jest
        .fn<ReadGateway['searchTopics']>()
        .mockResolvedValueOnce({ items: [first], errors: {}, hasMore: true, nextPage: 2 })
        .mockImplementationOnce(async ({ signal }) => {
          const abort = () => pendingPage.reject(new Error('request canceled'));
          signal?.addEventListener('abort', abort, { once: true });
          try {
            return await pendingPage.promise;
          } finally {
            signal?.removeEventListener('abort', abort);
          }
        })
        .mockResolvedValue({ items: [second], errors: {}, hasMore: false, nextPage: null });
      const readGateway = {
        getReadPlan: (source: Source, operation: ForumReadOperation) =>
          routeReadPlan(source, operation, enabledSources, sessionViewModels),
        searchTopics,
        searchTagOptions: jest.fn(async () => []),
        searchUserOptions: jest.fn(async () => [])
      } as unknown as ReadGateway;
      const runtime = createSearchRouteRuntime({
        readGateway,
        readerData: contentSourceReaderData(enabledSources),
        sessionViewModels
      });
      const route = () => (
        <SearchRouteRuntimeProvider value={runtime}>
          <SearchRoute />
        </SearchRouteRuntimeProvider>
      );
      const view = await render(route());
      try {
        await fireEvent.press(view.getByTestId('search-source-nodeseek'));
        await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'codex');
        await fireEvent.press(view.getByLabelText('提交搜索'));
        await waitFor(() => expect(view.getByTestId('search-load-more-nodeseek-page-2')).toBeTruthy());
        const group: SearchGroup = {
          source: 'nodeseek',
          label: 'NodeSeek',
          items: [first],
          hasMore: true,
          nextPage: 2
        };
        const sentinel = visibleLoadMore(group, 2, 1);
        const drag = async () => {
          const list = view.getByTestId('search-complete');
          await fireEvent(list, 'scrollBeginDrag');
          await fireEvent(list, 'viewableItemsChanged', { viewableItems: [sentinel], changed: [sentinel] });
        };
        await drag();
        await waitFor(() => expect(view.getByText('正在加载更多 NodeSeek')).toBeTruthy());
        expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
        if (interruption === 'network failure') {
          await act(async () => pendingPage.reject(new Error('第二页临时网络失败')));
          await waitFor(() => expect(view.getByText('重试加载 NodeSeek')).toBeTruthy());
          await fireEvent.press(view.getByText('重试加载 NodeSeek'));
        } else {
          mockSearchFocused = false;
          await view.rerender(route());
          await waitFor(() => expect(view.getByText('继续下滑加载更多 NodeSeek')).toBeTruthy());
          expect(searchTopics.mock.calls[1][0].signal?.aborted).toBe(true);
          mockSearchFocused = true;
          await view.rerender(route());
          expect(view.queryByText('重试加载 NodeSeek')).toBeNull();
          expect(view.queryByTestId('search-page-loaded-nodeseek-page-2')).toBeNull();
          await drag();
        }
        expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 2]);
        await waitFor(() => expect(view.getByText('第二页主题')).toBeTruthy());
        expect(view.getByText('第一页主题')).toBeTruthy();
        if (interruption === 'focus cancellation') {
          expect(view.getByTestId('search-page-loaded-nodeseek-page-2')).toBeTruthy();
        }
      } finally {
        await act(async () => {
          await appQueryClient.cancelQueries();
        });
        await view.unmount();
        mockSearchFocused = true;
      }
    }
  );

  it.each(['stale', 'rejected'] as const)(
    'releases a %s pagination attempt and keeps an older settlement from unlocking its replacement',
    async (outcome) => {
      const oldRequest = Promise.withResolvers<unknown>();
      const currentRequest = Promise.withResolvers<unknown>();
      void currentRequest.promise.catch(() => undefined);
      const onLoadMoreSearchSource = jest
        .fn<(source: Source, page: number) => Promise<unknown>>()
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(currentRequest.promise)
        .mockResolvedValue('stale');
      const group: SearchGroup = {
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic],
        hasMore: true,
        nextPage: 2
      };
      const props = createSearchScreenProps({ onLoadMoreSearchSource, searchSource: 'v2ex', searchGroups: [group] });
      const view = await render(<SearchScreen {...props} />);
      const sentinel = visibleLoadMore(group, 2, 1);
      const drag = async () => {
        const list = view.getByTestId('search-complete');
        await fireEvent(list, 'scrollBeginDrag');
        await fireEvent(list, 'viewableItemsChanged', { viewableItems: [sentinel], changed: [sentinel] });
      };
      try {
        await drag();
        await view.rerender(
          <SearchScreen {...props} query="new query" readScope="new-query" submittedQuery="new query" />
        );
        await drag();
        expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(2);
        await act(async () => oldRequest.resolve('stale'));
        await drag();
        expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(2);
        await act(async () => {
          if (outcome === 'stale') currentRequest.resolve('stale');
          else currentRequest.reject(new Error('request interrupted'));
        });
        expect(view.queryByTestId('search-page-loaded-v2ex-page-2')).toBeNull();
        await drag();
        expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(3);
      } finally {
        await act(async () => {
          oldRequest.resolve('stale');
          currentRequest.resolve('stale');
        });
      }
    }
  );

  it('counts native input and clearing as activity but not controlled value updates', async () => {
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    let now = 100_000;
    const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
    recordUserInteraction();
    try {
      const props = createSearchScreenProps();
      const view = await render(<SearchScreen {...props} />);
      now += 60_000;
      await view.rerender(<SearchScreen {...props} query="程序赋值" />);
      expect(userPresent()).toBe(false);
      await fireEvent(view.getByTestId('search-query'), 'change', { nativeEvent: { text: '真实输入' } });
      expect(userPresent()).toBe(true);
      now += 60_000;
      await fireEvent.press(view.getByLabelText('清空搜索关键词'));
      expect(props.onQueryChange).toHaveBeenLastCalledWith('');
      expect(props.onSearch).not.toHaveBeenCalled();
      expect(userPresent()).toBe(true);
      await view.rerender(<SearchScreen {...props} query="" />);
      expect(view.queryByRole('button', { name: '清空搜索关键词' })).toBeNull();
    } finally {
      clock.mockRestore();
      AppState.currentState = previous;
    }
  });

  it('keeps search actions within one input surface and submits through the visible button or keyboard', async () => {
    const onSearch = jest.fn<(queryOverride?: string) => void>();
    const view = await renderSearchScreen({ onSearch });
    const bar = within(view.getByTestId('search-query-container'));

    expect(bar.getByRole('button', { name: '清空搜索关键词' })).toBeTruthy();
    const submit = bar.getByRole('button', { name: '提交搜索' });
    await fireEvent.press(bar.getByRole('button', { name: '聚焦搜索关键词' }));
    expect(onSearch).not.toHaveBeenCalled();
    await fireEvent(bar.getByLabelText('搜索关键词'), 'submitEditing');
    await fireEvent.press(submit);
    expect(onSearch.mock.calls).toEqual([[], []]);
  });

  it('invalidates the mounted result list when reader appearance changes', async () => {
    const darkSettings: ReaderSettings = { ...createEmptyReaderData().settings, theme: 'dark' };
    const lightSettings: ReaderSettings = { ...darkSettings, theme: 'light' };
    const themedScreen = (settings: ReaderSettings) => (
      <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>
        <SearchScreen {...createSearchScreenProps()} />
      </ReaderStyleProvider>
    );
    const view = await render(themedScreen(darkSettings));

    expect(mockSearchFlashListExtraData).toBe(darkSettings);
    await view.rerender(themedScreen(lightSettings));
    expect(mockSearchFlashListExtraData).toBe(lightSettings);
  });

  it('does not expose transient account reconciliation as a paused search on first entry', async () => {
    const pausedMessage = 'linux.do 登录状态待确认，已暂停新请求和写入。';
    const view = await renderSearchScreen({
      query: '',
      submittedQuery: '',
      searchGroups: [
        {
          source: 'linuxdo',
          label: 'linux.do',
          items: [],
          settled: false,
          authNotice: { kind: 'verification-required', message: pausedMessage, tone: 'warning' }
        }
      ]
    });

    expect(view.queryByText(pausedMessage)).toBeNull();
    expect(view.queryByTestId('search-complete')).toBeNull();
  });

  it('keeps settled results and the search input stable across equivalent runtime updates', async () => {
    appQueryClient.clear();
    const enabledSources = ['v2ex', 'yaohuo'] as const;
    const sessionViewModels = projectTestAccountSessions(createSiteSessionStates());
    const loginMessage = '妖火需要登录后使用此功能。';
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => {
      if (source === 'yaohuo') {
        throw Object.assign(new Error(loginMessage), { kind: 'login-required' as const });
      }
      return {
        items: [
          {
            ...firstTopic,
            source: 'v2ex',
            id: `${source}-route-result`,
            title: 'V2EX 公开搜索正常结算',
            url: 'https://www.v2ex.com/t/route-result'
          }
        ],
        errors: {},
        hasMore: false,
        nextPage: null
      };
    });
    const readGateway = {
      getReadPlan: (source: Source, operation: ForumReadOperation) =>
        routeReadPlan(source, operation, enabledSources, sessionViewModels),
      searchSemanticTopics: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      searchTagOptions: jest.fn(async () => []),
      searchTopics,
      searchUserOptions: jest.fn(async () => [])
    } as unknown as ReadGateway;
    const runtime = createSearchRouteRuntime({
      readGateway,
      readerData: contentSourceReaderData(enabledSources),
      sessionViewModels
    });
    const view = await render(
      <SearchRouteRuntimeProvider value={runtime}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );

    await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'codex');
    await fireEvent.press(view.getByLabelText('提交搜索'));

    await waitFor(() => expect(view.getByText('V2EX 公开搜索正常结算')).toBeTruthy());
    expect(view.getAllByText(loginMessage)).toHaveLength(1);
    expect(view.getByLabelText('搜索关键词').props.value).toBe('codex');
    expect(searchTopics).toHaveBeenCalledTimes(2);
    const settledListItems = lastSearchListData;
    const settledInputCommits = mockSearchInputCommit.mock.calls.length;

    for (let update = 0; update < 10; update++) {
      await view.rerender(
        <SearchRouteRuntimeProvider value={{ ...runtime }}>
          <SearchRoute />
        </SearchRouteRuntimeProvider>
      );
    }

    expect(mockSearchInputCommit.mock.calls.length - settledInputCommits).toBe(0);
    expect(lastSearchListData).toBe(settledListItems);
    expect(searchTopics).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('搜索关键词').props.value).toBe('codex');

    await view.rerender(
      <SearchRouteRuntimeProvider value={{ ...runtime, notify: jest.fn() }}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );

    expect(lastSearchListData).toBe(settledListItems);
    expect(searchTopics).toHaveBeenCalledTimes(2);

    await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'updated query');
    await fireEvent.press(view.getByLabelText('提交搜索'));
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(4));
    expect(searchTopics.mock.calls.slice(2).map(([request]) => request.query)).toEqual([
      'updated query',
      'updated query'
    ]);
    expect(mockSearchInputCommit.mock.calls.length).toBeGreaterThan(settledInputCommits);
    await waitFor(() => expect(view.getByTestId('search-all-sources-settled')).toBeTruthy());
    await fireEvent.press(view.getByTestId('search-source-v2ex'));
    await waitFor(() => expect(view.getByTestId('search-complete')).toBeTruthy());
    expect(view.getByLabelText('搜索关键词').props.value).toBe('updated query');
    expect(view.getByText('V2EX 公开搜索正常结算')).toBeTruthy();
    expect(searchTopics).toHaveBeenCalledTimes(4);
  });

  it('gates candidate reads by the selected source during linux.do verification', async () => {
    appQueryClient.clear();
    const enabledSources = ['linuxdo'] as const;
    const sessionViewModels = projectTestAccountSessions(
      createSiteSessionStates({
        linuxdo: {
          site: 'linuxdo',
          status: 'logged-in',
          cookieSummary: ['session-present'],
          isVerifying: false,
          currentUser: {
            source: 'linuxdo',
            id: '8',
            username: 'linux-tester',
            url: 'https://linux.do/u/linux-tester'
          }
        }
      })
    );
    const searchTagOptions = jest.fn<ReadGateway['searchTagOptions']>(async () => [{ name: 'linux.do候选' }]);
    const readGateway = {
      getReadPlan: (source: Source, operation: ForumReadOperation) =>
        routeReadPlan(source, operation, enabledSources, sessionViewModels, true),
      searchSemanticTopics: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      searchTagOptions,
      searchTopics: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      searchUserOptions: jest.fn(async () => [])
    } as unknown as ReadGateway;
    const runtime = createSearchRouteRuntime({
      linuxDoVerificationVisible: true,
      readGateway,
      readerData: contentSourceReaderData(enabledSources),
      sessionViewModels
    });
    const view = await render(
      <SearchRouteRuntimeProvider value={runtime}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );

    await fireEvent.press(view.getByTestId('search-source-linuxdo'));
    await waitFor(() =>
      expect(view.getByTestId('search-source-linuxdo').props.accessibilityState).toMatchObject({ selected: true })
    );
    expect(view.queryByLabelText('打开搜索筛选，当前默认')).toBeNull();
    expect(searchTagOptions).not.toHaveBeenCalled();
  });

  it('renders enabled sources in user order and replaces warm results with management guidance', async () => {
    const onManageContentSources = jest.fn();
    const onSearchSourceChange = jest.fn();
    const view = await renderSearchScreen({
      expectedSearchSources: ['nodeseek', 'v2ex'],
      onManageContentSources,
      onSearchSourceChange,
      searchSource: 'v2ex',
      searchGroups: [
        { source: 'nodeseek', label: 'NodeSeek', items: [{ ...firstTopic, source: 'nodeseek' }] },
        { source: 'v2ex', label: 'V2EX', items: [firstTopic] },
        { source: 'linuxdo', label: 'linux.do', items: [{ ...firstTopic, source: 'linuxdo' }] }
      ]
    });

    expect(
      view
        .getAllByRole('button')
        .filter((tab) => tab.props.testID?.startsWith('search-source-'))
        .map((tab) => tab.props.testID)
    ).toEqual(['search-source-all', 'search-source-nodeseek', 'search-source-v2ex']);
    expect(view.queryByTestId('search-source-linuxdo')).toBeNull();
    expect(view.queryByText('linux.do')).toBeNull();
    expect(view.getByTestId('search-source-v2ex').props.accessibilityState).toMatchObject({ selected: true });

    await view.rerender(
      <SearchScreen
        {...createSearchScreenProps({
          expectedSearchSources: ['v2ex', 'nodeseek'],
          onManageContentSources,
          onSearchSourceChange,
          searchGroups: [{ source: 'v2ex', label: 'V2EX', items: [firstTopic] }],
          searchSource: 'v2ex'
        })}
      />
    );

    expect(
      view
        .getAllByRole('button')
        .filter((tab) => tab.props.testID?.startsWith('search-source-'))
        .map((tab) => tab.props.testID)
    ).toEqual(['search-source-all', 'search-source-v2ex', 'search-source-nodeseek']);
    expect(view.getByTestId('search-source-v2ex').props.accessibilityState).toMatchObject({ selected: true });
    expect(onSearchSourceChange).not.toHaveBeenCalled();

    await view.rerender(
      <SearchScreen
        {...createSearchScreenProps({
          expectedSearchSources: [],
          onManageContentSources,
          searchGroups: [{ source: 'v2ex', label: 'V2EX', items: [firstTopic] }]
        })}
      />
    );

    expect(
      view
        .getAllByRole('button')
        .filter((tab) => tab.props.testID?.startsWith('search-source-'))
        .map((tab) => tab.props.testID)
    ).toEqual(['search-source-all']);
    expect(view.queryByText('第一页主题')).toBeNull();
    expect(view.getByText('尚未启用内容源')).toBeTruthy();
    expect(view.getByTestId('search-all-sources-settled')).toBeTruthy();
    expect(view.getByLabelText('搜索结果，尚未启用内容源').props.accessibilityState.busy).toBe(false);
    await fireEvent.press(view.getByLabelText('前往更多管理'));
    expect(onManageContentSources).toHaveBeenCalledTimes(1);
  });

  it('submits a recent search immediately and removes only the selected entry', async () => {
    for (const platformName of [Platform.OS, 'android'] as const) {
      const platform = jest.replaceProperty(Platform, 'OS', platformName);
      try {
        const onRemoveRecentSearch = jest.fn<(query: string) => void>();
        const onSearch = jest.fn<(queryOverride?: string) => void>();
        const lightSettings: ReaderSettings = { ...createEmptyReaderData().settings, theme: 'light' };
        const darkSettings: ReaderSettings = { ...lightSettings, theme: 'dark' };
        const themedHistory = (settings: ReaderSettings) => (
          <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>
            <RecentSearchHarness onRemoveRecentSearch={onRemoveRecentSearch} onSearch={onSearch} />
          </ReaderStyleProvider>
        );
        const view = await render(themedHistory(lightSettings));

        for (const settings of [lightSettings, darkSettings]) {
          if (settings === darkSettings) await view.rerender(themedHistory(settings));
          for (const [label, iconName, size] of [
            ['搜索最近记录 codex', 'history', 17],
            ['删除最近搜索 react native', 'close', 16]
          ] as const) {
            const icon = view
              .getByLabelText(label)
              .children.filter((node) => typeof node !== 'string')
              .find((node) => node.type === 'WzSearchHistoryIcon');
            if (platformName === 'android') {
              expect(icon?.props).toMatchObject({
                accessible: false,
                icon: iconName,
                color: createTheme(settings).muted
              });
              expect(StyleSheet.flatten(icon?.props.style)).toMatchObject({ width: size, height: size });
            } else {
              expect(icon).toBeUndefined();
            }
          }
          expect(view.queryAllByRole('image')).toHaveLength(0);
        }

        expect(lastSearchListData).toEqual([
          { type: 'recentHeader' },
          { type: 'recentSearch', query: 'codex' },
          { type: 'recentSearch', query: 'react native' }
        ]);
        const recentSearchButton = view.getByLabelText('搜索最近记录 codex');
        expect(StyleSheet.flatten(recentSearchButton.props.style).minHeight).toBe(48);
        expect(StyleSheet.flatten(recentSearchButton.parent?.props.style)).toMatchObject({
          borderTopLeftRadius: readerRadii.surface,
          borderTopRightRadius: readerRadii.surface,
          borderTopWidth: StyleSheet.hairlineWidth
        });
        expect(view.getByText('codex').props.numberOfLines).toBe(2);
        await fireEvent.press(recentSearchButton);
        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onSearch).toHaveBeenCalledWith('codex');

        const deleteButton = view.getByLabelText('删除最近搜索 react native');
        expect(StyleSheet.flatten(deleteButton.props.style).minHeight).toBe(48);
        expect(StyleSheet.flatten(deleteButton.parent?.props.style)).toMatchObject({
          borderBottomLeftRadius: readerRadii.surface,
          borderBottomRightRadius: readerRadii.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderTopWidth: StyleSheet.hairlineWidth
        });
        expect(StyleSheet.flatten(deleteButton.parent?.props.style)).not.toHaveProperty('marginTop');
        expect(
          lastSearchListSeparatorComponent?.({
            leadingItem: lastSearchListData[1],
            trailingItem: lastSearchListData[2]
          })
        ).toBeNull();
        expect(
          lastSearchListSeparatorComponent?.({
            leadingItem: lastSearchListData[0],
            trailingItem: lastSearchListData[1]
          })
        ).not.toBeNull();
        await fireEvent.press(deleteButton);
        expect(onRemoveRecentSearch).toHaveBeenCalledTimes(1);
        expect(onRemoveRecentSearch).toHaveBeenCalledWith('react native');
        expect(view.getByLabelText('搜索关键词').props.value).toBe('');
        expect(onSearch).toHaveBeenCalledTimes(1);
        await view.unmount();
      } finally {
        platform.restore();
      }
    }
  });

  it('keeps successful source results available while retrying only the failed source', async () => {
    const onRetrySearchSource = jest.fn<(source: Source) => void>();
    const searchGroups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic]
      },
      {
        source: 'linuxdo',
        label: 'linux.do',
        items: [],
        error: 'linux.do 暂时不可用'
      }
    ];
    const view = await renderSearchScreen({ onRetrySearchSource, searchGroups });

    expect(view.getByText('第一页主题')).toBeTruthy();
    expect(view.getByText('linux.do 暂时不可用')).toBeTruthy();
    fireEvent.press(view.getByText('重试 linux.do'));
    expect(onRetrySearchSource).toHaveBeenCalledTimes(1);
    expect(onRetrySearchSource).toHaveBeenCalledWith('linuxdo');
  });

  it('keeps cached aggregate results visible through their source refresh and failure', async () => {
    const enabledSources = ['v2ex'] as const;
    const sessionViewModels = projectTestAccountSessions(createSiteSessionStates());
    const pending = Promise.withResolvers<Awaited<ReturnType<ReadGateway['searchTopics']>>>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({ items: [firstTopic], errors: {}, hasMore: true, nextPage: 2 })
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ items: [secondTopic], errors: {}, hasMore: false, nextPage: null });
    const readGateway = {
      getReadPlan: (source: Source, operation: ForumReadOperation) =>
        routeReadPlan(source, operation, enabledSources, sessionViewModels),
      searchTopics
    } as unknown as ReadGateway;
    const runtime = createSearchRouteRuntime({
      readGateway,
      readerData: contentSourceReaderData(enabledSources),
      sessionViewModels
    });
    const view = await render(
      <SearchRouteRuntimeProvider value={runtime}>
        <SearchRoute />
      </SearchRouteRuntimeProvider>
    );
    await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'cached refresh');
    await fireEvent.press(view.getByLabelText('提交搜索'));
    const result = await view.findByText(firstTopic.title);

    await act(async () => {
      void appQueryClient.invalidateQueries({ queryKey: ['forum', 'v2ex', 'search'] });
    });
    await view.findByText('1 条 · 刷新中');
    expect(view.getByText(firstTopic.title)).toBe(result);
    expect(view.queryByText('V2EX 搜索中')).toBeNull();

    await act(async () => pending.reject(new Error('刷新失败，请重试')));
    const retry = await view.findByRole('button', { name: '重试 V2EX' });
    expect(view.getByText(firstTopic.title)).toBe(result);
    await fireEvent.press(retry);
    expect(await view.findByText(secondTopic.title)).toBeTruthy();
    expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 1, 1]);
  });

  it('keeps loading and pending sources out of terminal search states', async () => {
    const view = await renderSearchScreen({
      searchGroups: [
        { source: 'v2ex', label: 'V2EX', items: [firstTopic] },
        {
          source: 'linuxdo',
          label: 'linux.do',
          items: [{ ...firstTopic, source: 'linuxdo', id: 'linux-1' }],
          error: '第 2 页请求失败',
          hasMore: true,
          nextPage: 2
        },
        { source: 'nodeseek', label: 'NodeSeek', items: [], loading: true },
        { source: 'yaohuo', label: '妖火', items: [], settled: false }
      ]
    });

    expect(view.getAllByText('第一页主题')).toHaveLength(2);
    expect(view.getByText('第 2 页请求失败')).toBeTruthy();
    expect(view.getByText('NodeSeek 搜索中')).toBeTruthy();
    expect(view.getByText('等待账号状态')).toBeTruthy();
    expect(view.queryByText('NodeSeek 没有匹配结果')).toBeNull();
    expect(view.queryByText('妖火 没有匹配结果')).toBeNull();
    expect(view.queryByTestId('search-all-sources-settled')).toBeNull();
    expect(view.getByLabelText('搜索结果，等待来源结算').props.accessibilityState.busy).toBe(true);

    await view.rerender(
      <SearchScreen
        {...createSearchScreenProps({
          busy: true,
          searchGroups: [{ source: 'v2ex', label: 'V2EX', items: [], loading: true }]
        })}
      />
    );

    expect(view.getByText('V2EX 搜索中')).toBeTruthy();
    expect(view.queryByText('第一页主题')).toBeNull();

    await view.rerender(
      <SearchScreen
        {...createSearchScreenProps({
          searchSource: 'v2ex',
          searchGroups: [
            {
              source: 'v2ex',
              label: 'V2EX',
              items: [firstTopic],
              loadingMore: true,
              hasMore: true,
              nextPage: 2
            }
          ]
        })}
      />
    );

    expect(view.getByText('正在加载更多 V2EX')).toBeTruthy();
  });

  it('keeps automation state out of the Search header layout', async () => {
    const view = await renderSearchScreen({
      searchGroups: [
        { source: 'v2ex', label: 'V2EX', items: [] },
        { source: 'linuxdo', label: 'linux.do', items: [] },
        { source: 'nodeseek', label: 'NodeSeek', items: [] },
        { source: 'yaohuo', label: '妖火', items: [] }
      ]
    });
    const header = view.getByTestId('search-all-sources-settled').children[0];

    expect(typeof header).not.toBe('string');
    if (typeof header === 'string') return;

    const gap = Number(StyleSheet.flatten(header.props.style)?.gap || 0);
    const emptyFlowChildren = header.children.filter(
      (child) =>
        typeof child !== 'string' &&
        child.children.length === 0 &&
        StyleSheet.flatten(child.props.style)?.position !== 'absolute'
    );

    expect(gap * emptyFlowChildren.length).toBe(0);
  });

  it('settles after every enabled aggregate source completes', async () => {
    const view = await renderSearchScreen({
      expectedSearchSources: ['v2ex', 'linuxdo'],
      searchGroups: [
        { source: 'v2ex', label: 'V2EX', items: [firstTopic] },
        { source: 'linuxdo', label: 'linux.do', items: [] }
      ]
    });

    expect(view.getByTestId('search-all-sources-settled')).toBeTruthy();
    expect(view.getByLabelText('搜索结果，已完成，有可打开结果').props.accessibilityState.busy).toBe(false);
  });

  it('renders external search as an action and hides anonymous source filters', async () => {
    const onOpenExternalSearch = jest.fn<(url: string) => void>();
    const url = 'https://www.google.com/search?q=site%3Alinux.do+codex';
    const externalProps = {
      externalSearchSources: ['linuxdo'],
      onOpenExternalSearch
    } as unknown as Partial<React.ComponentProps<typeof SearchScreen>>;
    const view = await renderSearchScreen({
      ...externalProps,
      expectedSearchSources: ['linuxdo'],
      searchSource: 'linuxdo',
      searchGroups: [
        {
          source: 'linuxdo',
          label: 'linux.do',
          items: [],
          externalSearchUrl: url,
          settled: true
        }
      ]
    });

    expect(view.getByTestId('search-complete')).toBeTruthy();
    expect(view.getByLabelText('搜索结果，已完成，有可打开入口')).toBeTruthy();
    expect(view.queryByLabelText(/打开搜索筛选/)).toBeNull();
    expect(view.queryByText('linux.do 没有匹配结果')).toBeNull();
    expect(view.getByText('再次去 Google 搜索')).toBeTruthy();

    await fireEvent.press(view.getByTestId('search-external-linuxdo'));
    expect(onOpenExternalSearch).toHaveBeenCalledWith(url);
  });

  it('shows fixed all-source previews and opens the selected source list', async () => {
    const onSearchSourceChange = jest.fn<(source: FeedSource) => void>();
    const thirdTopic: Topic = {
      ...firstTopic,
      id: 'search-3',
      title: '第三条主题',
      url: 'https://www.v2ex.com/t/3'
    };
    const searchGroups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic, secondTopic, thirdTopic],
        hasMore: true,
        nextPage: 2
      },
      {
        source: 'linuxdo',
        label: 'linux.do',
        items: [{ ...firstTopic, source: 'linuxdo', id: 'linux-1', title: 'linux.do 主题' }]
      },
      {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [{ ...firstTopic, source: 'nodeseek', id: 'node-1', title: 'NodeSeek 主题' }]
      },
      {
        source: 'yaohuo',
        label: '妖火',
        items: [{ ...firstTopic, source: 'yaohuo', id: 'yaohuo-1', title: '妖火主题' }]
      }
    ];
    const view = await renderSearchScreen({ onSearchSourceChange, searchGroups });

    expect(view.getAllByLabelText(/^查看 .* 全部搜索结果$/).map((node) => node.props.accessibilityLabel)).toEqual([
      '查看 V2EX 全部搜索结果',
      '查看 linux.do 全部搜索结果',
      '查看 NodeSeek 全部搜索结果',
      '查看 妖火 全部搜索结果'
    ]);
    expect(view.getByText('第一页主题')).toBeTruthy();
    expect(view.getByText('第二页主题')).toBeTruthy();
    expect(view.queryByText('第三条主题')).toBeNull();
    expect(view.queryByTestId('search-load-more-v2ex-page-2')).toBeNull();
    expect(view.getByTestId('search-overview-source-v2ex')).toBeTruthy();
    expect(view.queryByLabelText('收起V2EX搜索结果')).toBeNull();
    expect(view.getByText('linux.do 主题')).toBeTruthy();
    expect(view.getByText('NodeSeek 主题')).toBeTruthy();
    expect(view.getByText('妖火主题')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('查看 V2EX 全部搜索结果'));
    expect(onSearchSourceChange).toHaveBeenCalledWith('v2ex');
  });

  it('hides stale results as soon as the input differs from the submitted query', async () => {
    const view = await renderSearchScreen({
      query: 'codex next',
      searchGroups: [{ source: 'v2ex', label: 'V2EX', items: [firstTopic] }]
    });

    expect(view.queryByText('第一页主题')).toBeNull();
    expect(view.queryByTestId('search-complete')).toBeNull();
  });

  it('shows a login-required outcome as guidance instead of a retryable source error', async () => {
    const message = 'linux.do 登录已失效，请重新登录。';
    const view = await renderSearchScreen({
      searchGroups: [
        {
          source: 'linuxdo',
          label: 'linux.do',
          items: [],
          error: message,
          errorKind: 'login-expired',
          authNotice: {
            kind: 'login-expired',
            message,
            tone: 'danger'
          }
        }
      ]
    });

    expect(view.getByText(message)).toBeTruthy();
    expect(view.queryByText('重试 linux.do')).toBeNull();
  });

  it('disables duplicate submission while a submitted search is still running', async () => {
    const onSearch = jest.fn<(queryOverride?: string) => void>();
    const view = await renderSearchScreen({ busy: true, onSearch });

    expect(view.getByRole('status', { name: '搜索中', busy: true })).toBeTruthy();
    expect(view.queryByText('搜索中')).toBeNull();
    expect(view.getByTestId('search-list').props.accessibilityLiveRegion).toBe('polite');
    expect(view.getByTestId('search-list').props.accessibilityState.busy).toBe(true);
    expect(view.getByLabelText('提交搜索').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('提交搜索'));

    const historyView = await renderSearchScreen({ busy: true, onSearch, query: '', recentSearches: ['codex'] });
    expect(historyView.getByLabelText('搜索最近记录 codex').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(historyView.getByLabelText('搜索最近记录 codex'));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('disables submission when the query contains only whitespace', async () => {
    const onSearch = jest.fn<(queryOverride?: string) => void>();
    const view = await renderSearchScreen({ query: '   ', submittedQuery: '', onSearch });

    expect(view.getByLabelText('提交搜索').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('提交搜索'));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('dismisses the keyboard and scrolls to the top before submitting', async () => {
    const onSearch = jest.fn<(queryOverride?: string) => void>();
    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    mockSearchScrollToOffset.mockClear();
    const view = await renderSearchScreen({ onSearch });

    await fireEvent.press(view.getByLabelText('提交搜索'));

    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    expect(mockSearchScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(onSearch).toHaveBeenCalledWith();
    dismissKeyboard.mockRestore();
  });

  it('continues an empty source page only on request and stops at the terminal page', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const props = createSearchScreenProps({
      onLoadMoreSearchSource,
      searchSource: 'nodeseek',
      searchGroups: [
        {
          source: 'nodeseek',
          label: 'NodeSeek',
          items: [],
          hasMore: true,
          nextPage: 2
        }
      ]
    });
    const view = await render(<SearchScreen {...props} />);

    expect(view.getByText('NodeSeek 没有匹配结果')).toBeTruthy();
    expect(view.queryByText('继续下滑加载更多 NodeSeek')).toBeNull();
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '继续搜索 NodeSeek' }));
    expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(1);
    expect(onLoadMoreSearchSource).toHaveBeenLastCalledWith('nodeseek', 2);

    await view.rerender(<SearchScreen {...props} searchGroups={[{ ...props.searchGroups[0], loadingMore: true }]} />);
    expect(view.getByRole('button', { name: '继续搜索 NodeSeek' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByRole('button', { name: '继续搜索 NodeSeek' }));
    expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(1);

    await view.rerender(
      <SearchScreen {...props} searchGroups={[{ ...props.searchGroups[0], hasMore: false, nextPage: null }]} />
    );
    expect(view.getByText('NodeSeek 没有匹配结果')).toBeTruthy();
    expect(view.queryByRole('button', { name: '继续搜索 NodeSeek' })).toBeNull();
  });

  it('draws one divider between two search results and none beside the group controls', async () => {
    const view = await renderSearchScreen({
      searchSource: 'v2ex',
      searchGroups: [
        {
          source: 'v2ex',
          label: 'V2EX',
          items: [firstTopic, { ...secondTopic, source: 'v2ex' }],
          hasMore: true,
          nextPage: 2
        }
      ]
    });

    expect(view.getByText(firstTopic.title)).toBeTruthy();
    expect(view.getByText(secondTopic.title)).toBeTruthy();
    expect(view.getAllByTestId('topic-list-separator')).toHaveLength(1);
  });

  it('opens an empty overview source with a next page but disables a terminal empty source', async () => {
    const onSearchSourceChange = jest.fn<(source: FeedSource) => void>();
    const view = await renderSearchScreen({
      onSearchSourceChange,
      searchGroups: [
        { source: 'v2ex', label: 'V2EX', items: [], hasMore: true, nextPage: 2 },
        { source: 'nodeseek', label: 'NodeSeek', items: [], hasMore: false, nextPage: null }
      ]
    });
    expect(view.queryByRole('button', { name: '继续搜索 V2EX' })).toBeNull();
    expect(view.getByLabelText('查看 V2EX 全部搜索结果').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('查看 V2EX 全部搜索结果'));
    expect(onSearchSourceChange).toHaveBeenCalledWith('v2ex');
    expect(view.getByLabelText('查看 NodeSeek 全部搜索结果').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('查看 NodeSeek 全部搜索结果'));
    expect(onSearchSourceChange).toHaveBeenCalledTimes(1);
  });

  it('loads after user scroll and preserves pagination when reselecting the current source', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const onSearch = jest.fn<(queryOverride?: string) => void>();
    const searchGroups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic],
        hasMore: true,
        nextPage: 2
      }
    ];
    const props = createSearchScreenProps({
      onLoadMoreSearchSource,
      onSearch,
      searchSource: 'v2ex',
      searchGroups
    });
    const view = await render(<SearchScreen {...props} />);

    const list = view.getByTestId('search-complete');
    const visibleSentinels = [visibleLoadMore(searchGroups[0], 2, 1)];
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: visibleSentinels, changed: visibleSentinels });
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
    expect(view.getByText('继续下滑加载更多 V2EX')).toBeTruthy();
    expect(view.getByTestId('search-load-more-v2ex-page-2').props.onPress).toBeUndefined();

    await fireEvent(list, 'scrollBeginDrag');
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: visibleSentinels, changed: visibleSentinels });
    expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(1);
    expect(onLoadMoreSearchSource).toHaveBeenLastCalledWith('v2ex', 2);

    await view.rerender(
      <SearchScreen
        {...props}
        searchGroups={[
          {
            ...searchGroups[0],
            items: [firstTopic, secondTopic],
            hasMore: false,
            nextPage: null
          }
        ]}
      />
    );
    expect(view.getByTestId('search-page-loaded-v2ex-page-2')).toBeTruthy();
    expect(view.getByText('已载入 2 条')).toBeTruthy();

    mockSearchScrollToOffset.mockClear();
    await fireEvent.press(view.getByTestId('search-source-v2ex'));
    expect(view.getByTestId('search-page-loaded-v2ex-page-2')).toBeTruthy();
    expect(mockSearchScrollToOffset).not.toHaveBeenCalled();
    expect(props.onSearchSourceChange).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('提交搜索'));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('search-page-loaded-v2ex-page-2')).toBeNull();
  });

  it('clears completed pagination feedback before applying a new filter', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const onSearchFilterApply = jest.fn<(source: Source, filter: SourceSearchFilter) => void>();
    const searchGroups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic],
        hasMore: true,
        nextPage: 2
      }
    ];
    const props = createSearchScreenProps({
      onLoadMoreSearchSource,
      onSearchFilterApply,
      searchSource: 'v2ex',
      searchGroups
    });
    const view = await render(<SearchScreen {...props} />);
    const list = view.getByTestId('search-complete');
    const visibleSentinels = [visibleLoadMore(searchGroups[0], 2, 1)];

    await fireEvent(list, 'scrollBeginDrag');
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: visibleSentinels, changed: visibleSentinels });
    await view.rerender(
      <SearchScreen
        {...props}
        searchGroups={[
          {
            ...searchGroups[0],
            items: [firstTopic, secondTopic],
            hasMore: false,
            nextPage: null
          }
        ]}
      />
    );
    expect(view.getByTestId('search-page-loaded-v2ex-page-2')).toBeTruthy();

    mockSearchScrollToOffset.mockClear();
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.queryByText('确认筛选')).toBeNull();
    expect(onSearchFilterApply).not.toHaveBeenCalled();
    expect(mockSearchScrollToOffset).not.toHaveBeenCalled();
    expect(view.getByTestId('search-page-loaded-v2ex-page-2')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('相关'));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(onSearchFilterApply).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('search-page-loaded-v2ex-page-2')).toBeNull();
  });

  it.each([
    ['query', { query: 'changed' }],
    ['source', { searchSource: 'all' as const, readScope: 'all:codex' }]
  ])('clears an armed sentinel when %s changes', async (_label, changedProps) => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const group: SearchGroup = {
      source: 'v2ex',
      label: 'V2EX',
      items: [firstTopic],
      hasMore: true,
      nextPage: 2
    };
    const props = createSearchScreenProps({ onLoadMoreSearchSource, searchGroups: [group], searchSource: 'v2ex' });
    const view = await render(<SearchScreen {...props} />);
    const list = view.getByTestId('search-complete');
    const sentinel = visibleLoadMore(group, 2, 2);

    await fireEvent(list, 'scrollBeginDrag');
    await view.rerender(<SearchScreen {...props} {...changedProps} />);
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: [sentinel], changed: [sentinel] });
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
  });

  it('does not arm automatic pagination while a search request is busy', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const group: SearchGroup = {
      source: 'v2ex',
      label: 'V2EX',
      items: [firstTopic],
      hasMore: true,
      nextPage: 2
    };
    const view = await renderSearchScreen({
      busy: true,
      onLoadMoreSearchSource,
      searchGroups: [group],
      searchSource: 'v2ex'
    });
    const list = view.getByTestId('search-list');
    const sentinel = visibleLoadMore(group, 2, 2);

    await fireEvent(list, 'scrollBeginDrag');
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: [sentinel], changed: [sentinel] });
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
  });

  it('ignores a stale sentinel after the source reaches its last page', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const group: SearchGroup = {
      source: 'v2ex',
      label: 'V2EX',
      items: [firstTopic],
      hasMore: true,
      nextPage: 2
    };
    const finishedGroup = { ...group, hasMore: false, nextPage: null };
    const finishedView = await renderSearchScreen({
      onLoadMoreSearchSource,
      searchGroups: [finishedGroup],
      searchSource: 'v2ex'
    });
    const sentinel = visibleLoadMore(group, 2, 2);

    await fireEvent(finishedView.getByTestId('search-complete'), 'scrollBeginDrag');
    await fireEvent(finishedView.getByTestId('search-complete'), 'viewableItemsChanged', {
      viewableItems: [sentinel],
      changed: [sentinel]
    });
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
    expect(finishedView.queryByTestId('search-load-more-v2ex-page-2')).toBeNull();
  });

  it('shows a spinner while loading and removes the sentinel at the last page', async () => {
    const loadingGroup: SearchGroup = {
      source: 'v2ex',
      label: 'V2EX',
      items: [firstTopic],
      loadingMore: true,
      hasMore: true,
      nextPage: 2
    };
    const props = createSearchScreenProps({ searchGroups: [loadingGroup], searchSource: 'v2ex' });
    const view = await render(<SearchScreen {...props} />);

    expect(view.getByText('正在加载更多 V2EX')).toBeTruthy();
    expect(view.getByTestId('search-load-more-spinner-v2ex')).toBeTruthy();

    await view.rerender(
      <SearchScreen
        {...props}
        searchGroups={[{ ...loadingGroup, loadingMore: false, hasMore: false, nextPage: null }]}
      />
    );
    expect(view.queryByTestId('search-load-more-v2ex-page-2')).toBeNull();
  });

  it('keeps loaded results and retries the failed page', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const onRetrySearchSource = jest.fn<(source: Source) => void>();
    const view = await renderSearchScreen({
      onLoadMoreSearchSource,
      onRetrySearchSource,
      searchSource: 'v2ex',
      searchGroups: [
        {
          source: 'v2ex',
          label: 'V2EX',
          items: [firstTopic],
          error: '第 2 页请求失败',
          hasMore: true,
          nextPage: 2
        }
      ]
    });

    expect(view.getByText('第一页主题')).toBeTruthy();
    expect(view.getByText('第 2 页请求失败')).toBeTruthy();
    await fireEvent.press(view.getByText('重试加载 V2EX'));
    expect(onLoadMoreSearchSource).toHaveBeenCalledWith('v2ex', 2);
    expect(onRetrySearchSource).not.toHaveBeenCalled();
  });

  it('keeps first-page partial failures on whole-source retry', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const onRetrySearchSource = jest.fn<(source: Source) => void>();
    const view = await renderSearchScreen({
      onLoadMoreSearchSource,
      onRetrySearchSource,
      searchSource: 'v2ex',
      searchGroups: [
        {
          source: 'v2ex',
          label: 'V2EX',
          items: [firstTopic],
          error: '首屏请求失败',
          hasMore: false,
          nextPage: null
        }
      ]
    });

    expect(view.queryByText('第一页主题')).toBeNull();
    expect(view.getByText('首屏请求失败')).toBeTruthy();
    await fireEvent.press(view.getByText('重试 V2EX'));
    expect(onRetrySearchSource).toHaveBeenCalledWith('v2ex');
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
  });

  it('keeps query, filter and loaded page across Topic and User navigation', async () => {
    const view = await render(<SearchHarness />);

    expect(view.getByLabelText('打开搜索筛选，当前默认').props.accessibilityState.selected).toBe(false);
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    let close = view.getByTestId('search-filter-close');
    while (StyleSheet.flatten(close.props.style)?.width === undefined) close = close.parent!;
    expect(StyleSheet.flatten(close.props.style)).toMatchObject({
      width: 48,
      height: 48
    });
    const selectedSegment = view.getByRole('radio', { name: '最新', checked: true });
    expect(selectedSegment).toHaveStyle({ backgroundColor: 'rgba(22, 119, 255, 0.10)' });
    expect(within(selectedSegment).getByText('最新')).toHaveStyle({ color: '#0958D9' });
    await fireEvent.press(view.getByText('相关'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前相关').props.accessibilityState.selected).toBe(true);

    await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'codex');
    await fireEvent.press(view.getByLabelText('提交搜索'));
    expect(view.getByTestId('search-complete')).toBeTruthy();
    expect(view.getByText('继续下滑加载更多 V2EX')).toBeTruthy();

    const v2exGroup: SearchGroup = {
      source: 'v2ex',
      label: 'V2EX',
      items: [firstTopic],
      hasMore: true,
      nextPage: 2
    };
    await fireEvent(view.getByTestId('search-complete'), 'scrollBeginDrag');
    const v2exSentinel = visibleLoadMore(v2exGroup, 2, 2);
    await fireEvent(view.getByTestId('search-complete'), 'viewableItemsChanged', {
      viewableItems: [v2exSentinel],
      changed: [v2exSentinel]
    });
    expect(view.getByText('第二页主题')).toBeTruthy();

    await fireEvent.press(view.getByText('第一页主题'));
    expect(view.getByTestId('topic-placeholder')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('打开作者页'));
    expect(view.getByTestId('user-placeholder')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('返回主题'));
    await fireEvent.press(view.getByLabelText('返回搜索'));

    expect(view.getByLabelText('搜索关键词').props.value).toBe('codex');
    expect(view.getByLabelText('打开搜索筛选，当前相关')).toBeTruthy();
    expect(view.getByText('第二页主题')).toBeTruthy();
    expect(view.queryByTestId('search-load-more-v2ex-page-2')).toBeNull();
  });

  it('keeps the author cache unobserved until the filter is opened with a default author', async () => {
    const key = forumQueryKeys.searchAuthorLabels(
      initialForumSessionEpochs.linuxdo,
      filterDefaults.readPlanScopes.users
    );
    const observers = () =>
      appQueryClient.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount() ?? 0;
    const view = await renderSearchScreen({ searchSource: 'linuxdo' });
    expect(observers()).toBe(0);
    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    expect(observers()).toBe(1);
    await fireEvent.press(view.getByTestId('search-filter-close'));
    expect(observers()).toBe(0);
  });

  it('distinguishes linux.do authors with the same display name and submits the chosen username', async () => {
    const onSearchFilterApply = jest.fn();
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      onSearchFilterApply,
      filter: {
        onSearchDiscourseUsers: async () => [
          { id: '21', username: 'reader_one', displayName: '同名读者' },
          { id: '22', username: 'reader_two', displayName: '同名读者' }
        ]
      }
    });
    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'reader');
    const candidate = await view.findByTestId('search-filter-author-option-22');
    expect(within(candidate).getByText('@reader_two')).toBeTruthy();
    await fireEvent.press(candidate);
    expect(view.getByLabelText('选择作者').props.accessibilityValue.text).toBe('同名读者');
    await fireEvent.press(view.getByText('确认筛选'));
    expect(onSearchFilterApply).toHaveBeenCalledWith('linuxdo', expect.objectContaining({ username: 'reader_two' }));
  });

  it('applies linux.do, NodeSeek and Yaohuo filters without leaking state between sites', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('标题'));
    await fireEvent.press(view.getByLabelText('选择分类'));
    await fireEvent.press(view.getByLabelText('分类 技术 / 开发调优'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await fireEvent.press(view.getByRole('button', { name: '确认标签' }));
    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'alice');
    await waitFor(() => expect(view.getByLabelText('用户 山月')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('用户 山月'));
    await fireEvent.press(view.getByLabelText('选择时间范围'));
    await fireEvent.press(view.getByText('7天'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前标题 · 开发调优 · 人工智能 · 山月 · 7天')).toBeTruthy();

    await fireEvent.press(view.getByTestId('search-source-nodeseek'));
    expect(view.getByLabelText('打开搜索筛选，当前默认')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择分类'));
    await fireEvent.press(view.getByText('日常'));
    await fireEvent.press(view.getByText('新评论'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前日常 · 新评论')).toBeTruthy();

    await fireEvent.press(view.getByTestId('search-source-yaohuo'));
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择版块'));
    await fireEvent.press(view.getByText('妖火茶馆'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前妖火茶馆')).toBeTruthy();

    await fireEvent.press(view.getByTestId('search-source-linuxdo'));
    expect(view.getByLabelText('打开搜索筛选，当前标题 · 开发调优 · 人工智能 · 山月 · 7天')).toBeTruthy();
  });

  it('completes picker edits locally and applies them only on the filter overview', async () => {
    const onSearchFilterApply = jest.fn<(source: Source, filter: SourceSearchFilter) => void>();
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      onSearchFilterApply,
      filter: { onSearchDiscourseTags: async () => [{ name: '人工智能' }] }
    });

    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    await fireEvent.press(view.getByText('标题'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    expect(view.getAllByTestId('modal-sheet')).toHaveLength(1);
    expect(view.queryByText('搜索范围')).toBeNull();
    expect(view.queryByRole('button', { name: '确认筛选' })).toBeNull();
    expect(view.queryByRole('button', { name: '重置' })).toBeNull();
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await fireEvent.press(view.getByRole('button', { name: '确认标签' }));

    expect(view.getByLabelText('选择标签').props.accessibilityValue.text).toBe('人工智能');
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.press(view.getByRole('checkbox', { name: '标签 人工智能', checked: true }));
    await fireEvent.press(view.getByRole('button', { name: '取消' }));
    expect(view.getByLabelText('选择标签').props.accessibilityValue.text).toBe('人工智能');

    await fireEvent.press(view.getByLabelText('选择时间范围'));
    expect(view.queryByRole('button', { name: '确认筛选' })).toBeNull();
    expect(view.queryByRole('button', { name: '取消' })).toBeNull();
    await fireEvent.press(view.getByRole('radio', { name: '7天' }));
    expect(onSearchFilterApply).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '确认筛选' }));
    expect(onSearchFilterApply).toHaveBeenCalledWith(
      'linuxdo',
      expect.objectContaining({ scope: 'title', tags: ['人工智能'], timeRange: 'week' })
    );
  });

  it('picks V2EX nodes without typing and preserves the applied choice when a change is dismissed', async () => {
    const view = await render(<SearchHarness />);
    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    await fireEvent.press(view.getByLabelText('选择节点'));
    expect(view.getByLabelText('搜索节点').props.autoFocus).toBeFalsy();
    await fireEvent.press(view.getByRole('radio', { name: '节点 问与答' }));
    await fireEvent.press(view.getByText('确认筛选'));
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前问与答'));
    await fireEvent.press(view.getByLabelText('选择节点'));
    expect(view.getByRole('radio', { name: '节点 问与答', checked: true })).toBeTruthy();
    await fireEvent.press(view.getByRole('radio', { name: '节点 全部节点' }));
    await fireEvent.press(view.getByTestId('search-filter-close'));
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前问与答'));
    await fireEvent.press(view.getByLabelText('清除节点'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前默认')).toBeTruthy();
  });

  it('cancels an unfinished V2EX directory read on leaving the node picker and starts a new read on return', async () => {
    appQueryClient.removeQueries({ queryKey: forumQueryKeys.v2exNodeDirectory });
    const stale = Promise.withResolvers<Category[]>();
    const onLoadV2exNodes = jest
      .fn<FilterInputs['onLoadV2exNodes']>()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValue([{ source: 'v2ex', id: 'fresh', name: '本次节点' }]);
    const view = await renderSearchScreen({ searchSource: 'v2ex', filter: { onLoadV2exNodes } });
    try {
      await fireEvent.press(view.getByTestId('search-filter-trigger'));
      await fireEvent.press(view.getByLabelText('选择节点'));
      await waitFor(() => expect(onLoadV2exNodes).toHaveBeenCalledTimes(1));
      const [firstSignal] = onLoadV2exNodes.mock.calls[0];
      await fireEvent.press(view.getByLabelText('返回筛选'));
      expect(firstSignal.aborted).toBe(true);
      await fireEvent.press(view.getByLabelText('选择节点'));
      await view.findByRole('radio', { name: '节点 本次节点' });
      await act(async () => stale.resolve([{ source: 'v2ex', id: 'old', name: '旧节点' }]));
      expect(view.queryByRole('radio', { name: '节点 旧节点' })).toBeNull();
      expect(onLoadV2exNodes).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => stale.resolve([]));
    }
  });

  it('loads the V2EX directory on demand, recovers from failure and applies the slug of a matching node', async () => {
    appQueryClient.removeQueries({ queryKey: forumQueryKeys.v2exNodeDirectory });
    const onLoadV2exNodes = jest
      .fn<FilterInputs['onLoadV2exNodes']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([{ source: 'v2ex', id: 'rare_slug', name: '冷门节点' }]);
    const onSearchFilterApply = jest.fn();
    const view = await renderSearchScreen({
      searchSource: 'v2ex',
      onSearchFilterApply,
      filter: {
        searchFilters: { ...DEFAULT_SEARCH_FILTERS, v2ex: { ...DEFAULT_SEARCH_FILTERS.v2ex, node: 'older-node' } },
        onLoadV2exNodes
      }
    });
    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    expect(onLoadV2exNodes).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('选择节点'));
    expect(view.getByRole('radio', { name: '节点 问与答' })).toBeTruthy();
    expect(view.getByRole('radio', { name: '节点 older-node', checked: true })).toBeTruthy();
    await fireEvent.press(await view.findByLabelText('节点目录加载失败，重试'));
    await fireEvent.changeText(view.getByLabelText('搜索节点'), '冷门');
    await view.findByRole('radio', { name: '节点 冷门节点' });
    await fireEvent.changeText(view.getByLabelText('搜索节点'), 'does-not-exist');
    expect(view.getByText('没有匹配节点')).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('搜索节点'), 'RARE_SLUG');
    await fireEvent.press(view.getByRole('radio', { name: '节点 冷门节点' }));
    expect(view.getByLabelText('选择节点').props.accessibilityValue.text).toBe('冷门节点');
    await fireEvent.press(view.getByLabelText('选择节点'));
    expect(view.getByRole('radio', { name: '节点 冷门节点', checked: true })).toBeTruthy();
    expect(view.getByLabelText('搜索节点').props.value).toBe('');
    expect(onLoadV2exNodes).toHaveBeenCalledTimes(2);
    await fireEvent.press(view.getByTestId('search-filter-back'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(onSearchFilterApply).toHaveBeenCalledWith('v2ex', expect.objectContaining({ node: 'rare_slug' }));
  });

  it('accepts linux.do tags only from the candidate picker', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    expect(view.queryByPlaceholderText('例如 人工智能')).toBeNull();
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), '任意手打');
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await fireEvent.press(view.getByRole('button', { name: '确认标签' }));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByLabelText('打开搜索筛选，当前人工智能')).toBeTruthy();
    expect(view.queryByText('任意手打')).toBeNull();
  });

  it('reuses the same tag candidates while checking, unchecking and reopening for the same search', async () => {
    const onSearchDiscourseTags = jest.fn<FilterInputs['onSearchDiscourseTags']>().mockResolvedValue([
      { name: '软件开发', topicCount: 12 },
      { name: 'OpenAI', topicCount: 34 }
    ]);
    const view = await renderSearchScreen({ searchSource: 'linuxdo', filter: { onSearchDiscourseTags } });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.press(await view.findByRole('checkbox', { name: '标签 软件开发', checked: false }));
    expect(view.getByRole('checkbox', { name: '标签 软件开发', checked: true })).toBeTruthy();
    expect(onSearchDiscourseTags).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByRole('checkbox', { name: '标签 OpenAI', checked: false }));
    await fireEvent.press(view.getByRole('checkbox', { name: '标签 软件开发', checked: true }));
    await fireEvent.press(view.getByRole('button', { name: '确认标签' }));
    await fireEvent.press(view.getByLabelText('选择标签'));
    expect(await view.findByRole('checkbox', { name: '标签 OpenAI', checked: true })).toBeTruthy();
    expect(await view.findByText('34 个主题')).toBeTruthy();
    expect(onSearchDiscourseTags).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale linux.do tag response after the search term changes', async () => {
    const oldResponse = Promise.withResolvers<{ name: string }[]>();
    const freshResponse = Promise.withResolvers<{ name: string }[]>();
    const onSearchDiscourseTags = jest.fn(({ query: term }: { query: string }) =>
      term === 'old' ? oldResponse.promise : freshResponse.promise
    );
    const view = await renderSearchScreen({ searchSource: 'linuxdo', filter: { onSearchDiscourseTags } });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'old');
    await waitFor(() => expect(onSearchDiscourseTags).toHaveBeenCalledWith(expect.objectContaining({ query: 'old' })));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'fresh');
    await waitFor(() =>
      expect(onSearchDiscourseTags).toHaveBeenCalledWith(expect.objectContaining({ query: 'fresh' }))
    );

    await act(async () => {
      freshResponse.resolve([{ name: '新候选' }]);
      await freshResponse.promise;
    });
    await waitFor(() => expect(view.getByLabelText('标签 新候选')).toBeTruthy());
    await act(async () => {
      oldResponse.resolve([{ name: '旧候选' }]);
      await oldResponse.promise;
    });

    expect(view.queryByLabelText('标签 旧候选')).toBeNull();
    expect(view.getByLabelText('标签 新候选')).toBeTruthy();
  });

  it.each(['', 'old'])(
    'cancels closed tag candidates for query "%s" before reopening with a fresh request',
    async (query) => {
      const oldResponse = Promise.withResolvers<{ name: string }[]>();
      const freshResponse = Promise.withResolvers<{ name: string }[]>();
      const onSearchDiscourseTags = jest
        .fn<FilterInputs['onSearchDiscourseTags']>()
        .mockImplementationOnce(() => oldResponse.promise)
        .mockImplementation(() => freshResponse.promise);
      const view = await renderSearchScreen({ searchSource: 'linuxdo', filter: { onSearchDiscourseTags } });
      try {
        await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
        await fireEvent.press(view.getByLabelText('选择标签'));
        if (query) await fireEvent.changeText(view.getByLabelText('搜索标签'), query);
        await waitFor(() => expect(onSearchDiscourseTags).toHaveBeenCalledTimes(1));
        const oldSignal = onSearchDiscourseTags.mock.calls[0][0].signal;
        expect(oldSignal?.aborted).toBe(false);

        await fireEvent.press(view.getByLabelText('返回筛选'));
        expect(oldSignal?.aborted).toBe(true);
        expect(view.queryByLabelText('搜索标签')).toBeNull();
        await fireEvent.press(view.getByLabelText('选择标签'));
        if (query) await fireEvent.changeText(view.getByLabelText('搜索标签'), query);
        await waitFor(() => expect(onSearchDiscourseTags).toHaveBeenCalledTimes(2));

        await act(async () => oldResponse.resolve([{ name: '已关闭候选' }]));
        expect(view.queryByLabelText('标签 已关闭候选')).toBeNull();
        await act(async () => freshResponse.resolve([{ name: '本次候选' }]));
        await waitFor(() => expect(view.getByLabelText('标签 本次候选')).toBeTruthy());
        expect(view.queryByLabelText('标签 已关闭候选')).toBeNull();
      } finally {
        await act(async () => {
          oldResponse.resolve([]);
          freshResponse.resolve([]);
        });
      }
    }
  );

  it('keeps another source candidate request alive when this search screen is inactive', async () => {
    const otherResponse = Promise.withResolvers<{ name: string }[]>();
    let otherSignal: AbortSignal | undefined;
    const otherRequest = appQueryClient
      .fetchQuery({
        queryKey: forumQueryKeys.searchTags({
          source: 'nodeseek',
          query: '',
          scope: initialForumSessionEpochs,
          readPlanScope: 'independent-picker'
        }),
        queryFn: ({ signal }) => {
          otherSignal = signal;
          return otherResponse.promise;
        }
      })
      .catch(() => undefined);
    try {
      await renderSearchScreen({ searchSource: 'linuxdo', filter: { requestsEnabled: false } });
      expect(otherSignal?.aborted).toBe(false);
    } finally {
      await act(async () => {
        otherResponse.resolve([{ name: '独立候选' }]);
        await otherRequest;
      });
    }
  });

  it('keeps picker input and draft fields through keyboard dismissal and discards them only when the sheet is cancelled', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const view = await render(<SearchHarness initialSource="linuxdo" />);
      await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
      await fireEvent.press(view.getByLabelText('展开更多筛选'));
      await fireEvent.press(view.getByLabelText('设置帖子数范围'));
      await fireEvent.changeText(view.getByTestId('search-filter-input-minPosts'), '3');
      await fireEvent.press(view.getByRole('button', { name: '确认范围' }));
      await fireEvent.press(view.getByLabelText('选择作者'));
      await act(() =>
        DeviceEventEmitter.emit('keyboardDidShow', {
          duration: 250,
          easing: 'keyboard',
          endCoordinates: { height: 300, width: 400, screenX: 0, screenY: 500 }
        })
      );
      await fireEvent.changeText(view.getByTestId('search-filter-input-author'), 'ali');
      await waitFor(() => expect(view.getByLabelText('用户 山月')).toBeTruthy());
      await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
      expect(view.getByLabelText('搜索作者').props.value).toBe('ali');
      expect(view.getByLabelText('用户 山月')).toBeTruthy();
      await fireEvent.press(view.getByLabelText('用户 山月'));
      expect(view.getByLabelText('设置帖子数范围').props.accessibilityValue.text).toBe('至少 3');
      expect(view.getByText('山月')).toBeTruthy();

      await fireEvent.press(view.getByLabelText('选择标签'));
      await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('标签 人工智能'));
      await fireEvent.press(view.getByRole('button', { name: '确认标签' }));
      await fireEvent.press(view.getAllByLabelText('关闭筛选')[1]);
      await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
      expect(view.queryByLabelText('移除标签 人工智能')).toBeNull();
      expect(view.queryByLabelText('设置帖子数范围')).toBeNull();
      await fireEvent.press(view.getByLabelText('展开更多筛选'));
      expect(view.getByLabelText('设置帖子数范围').props.accessibilityValue.text).toBe('不限');
      await fireEvent.press(view.getByLabelText('设置帖子数范围'));
      expect(view.getByLabelText('帖子数最小值').props.value).toBe('');
      expect(view.queryByText('山月')).toBeNull();
    } finally {
      await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
      platform.restore();
    }
  });

  it('removes visible tag and author candidates as soon as their query changes', async () => {
    const onSearchDiscourseTags = jest.fn(async ({ query: term }: { query: string }) =>
      term === 'old' ? [{ name: '旧标签' }] : [{ name: '新标签' }]
    );
    const onSearchDiscourseUsers = jest.fn(async ({ term }: { term: string }) =>
      term === 'old' ? [{ id: 'old', username: 'old-user' }] : [{ id: 'new', username: 'new-user' }]
    );
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      filter: { onSearchDiscourseTags, onSearchDiscourseUsers }
    });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'old');
    await waitFor(() => expect(view.getByLabelText('标签 旧标签')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'fresh');
    expect(view.queryByLabelText('标签 旧标签')).toBeNull();
    await waitFor(() => expect(view.getByLabelText('标签 新标签')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('返回筛选'));

    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'old');
    await waitFor(() => expect(view.getByLabelText('用户 old-user')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'fresh');
    expect(view.queryByLabelText('用户 old-user')).toBeNull();
    await waitFor(() => expect(view.getByLabelText('用户 new-user')).toBeTruthy());
  });

  it.each([
    { kind: 'tag', field: '搜索标签', loading: '加载标签中', settled: '没有匹配标签', candidate: '标签 稳定候选' },
    {
      kind: 'user',
      field: '搜索作者',
      loading: '加载作者中',
      settled: '作者候选加载失败',
      candidate: '用户 stable-candidate'
    }
  ])('keeps a shrinkable $kind candidate viewport through loading and result changes', async (picker) => {
    const candidate = { id: '7', username: 'stable-candidate', name: '稳定候选' };
    const firstRead = Promise.withResolvers<(typeof candidate)[]>();
    const readCandidates = jest.fn((term: string) =>
      term === 'first' ? firstRead.promise : Promise.resolve([candidate])
    );
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      filter: {
        onSearchDiscourseTags: ({ query: term }) => readCandidates(term),
        onSearchDiscourseUsers: ({ term }) => readCandidates(term)
      }
    });
    try {
      await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
      if (picker.kind === 'user') await fireEvent.press(view.getByLabelText('展开更多筛选'));
      await fireEvent.press(view.getByLabelText(picker.kind === 'tag' ? '选择标签' : '选择作者'));
      const input = view.getByLabelText(picker.field);
      await fireEvent.changeText(input, 'first');
      await waitFor(() => expect(readCandidates).toHaveBeenCalledWith('first'));
      const candidateBody = (text: string) => {
        let node = view.getByText(text).parent;
        while (node && node.type !== 'RCTScrollView') node = node.parent;
        if (!node) throw new Error('Candidate states must belong to a native ScrollView');
        return node;
      };
      const body = candidateBody(picker.loading);
      const viewportStyle = StyleSheet.flatten(body.props.style);
      // This is the native layout constraint; device replay owns the resulting pixel positions.
      expect(viewportStyle.height).toEqual(expect.any(Number));
      expect(viewportStyle.height).toBeGreaterThan(0);
      expect(viewportStyle).toMatchObject({ flexGrow: 0, flexShrink: 1 });
      expect(viewportStyle.minHeight ?? 0).toBe(0);

      await act(async () => {
        if (picker.kind === 'tag') firstRead.resolve([]);
        else firstRead.reject(new Error('Candidate read failed'));
      });
      await waitFor(() => expect(view.getByText(picker.settled)).toBeTruthy());
      expect(candidateBody(picker.settled)).toBe(body);
      expect(StyleSheet.flatten(body.props.style)).toEqual(viewportStyle);
      expect(view.getByLabelText(picker.field)).toBe(input);

      await fireEvent.changeText(input, 'next');
      await waitFor(() => expect(view.getByLabelText(picker.candidate)).toBeTruthy());
      expect(StyleSheet.flatten(body.props.style)).toEqual(viewportStyle);
      expect(view.getByLabelText(picker.field)).toBe(input);
      expect(input.props.value).toBe('next');
      if (picker.kind === 'tag') await fireEvent.press(view.getByLabelText('返回筛选'));
      else await fireEvent.press(view.getByLabelText(picker.candidate));
      expect(view.queryByLabelText(picker.field)).toBeNull();
    } finally {
      await act(async () => firstRead.resolve([]));
    }
  });

  it('shows the empty-author prompt without a permanent loading state', async () => {
    const onSearchDiscourseUsers = jest.fn(async () => []);
    const view = await renderSearchScreen({ searchSource: 'linuxdo', filter: { onSearchDiscourseUsers } });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择作者'));

    expect(view.getByText('输入用户名后选择')).toBeTruthy();
    expect(view.queryByText('加载作者中')).toBeNull();
    expect(onSearchDiscourseUsers).not.toHaveBeenCalled();
  });

  it('hides tag candidates from the previous category while the new request is pending', async () => {
    const categoryResponse = Promise.withResolvers<{ name: string }[]>();
    const onSearchDiscourseTags = jest.fn(({ categoryId, query: term }: { categoryId?: string; query: string }) => {
      if (term !== '') {
        return Promise.resolve([]);
      }
      return categoryId === '4' ? categoryResponse.promise : Promise.resolve([{ name: '旧分类候选' }]);
    });
    const view = await renderSearchScreen({ searchSource: 'linuxdo', filter: { onSearchDiscourseTags } });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByLabelText('标签 旧分类候选')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('返回筛选'));
    await fireEvent.press(view.getByLabelText('选择分类'));
    await fireEvent.press(view.getByLabelText('分类 技术 / 开发调优'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await waitFor(() =>
      expect(onSearchDiscourseTags).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: '4',
          query: ''
        })
      )
    );

    expect(view.queryByLabelText('标签 旧分类候选')).toBeNull();
    await act(async () => {
      categoryResponse.resolve([{ name: '新分类候选' }]);
      await categoryResponse.promise;
    });
    await waitFor(() => expect(view.getByLabelText('标签 新分类候选')).toBeTruthy());
  });

  it('selects a hierarchical linux.do category and author from searchable candidates', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    expect(view.queryByPlaceholderText('linux.do 用户名')).toBeNull();
    await fireEvent.press(view.getByLabelText('选择分类'));
    await fireEvent.changeText(view.getByLabelText('搜索分类'), '开发');
    await fireEvent.press(view.getByLabelText('分类 技术 / 开发调优'));
    expect(view.getByLabelText('选择分类').props.accessibilityValue.text).toBe('开发调优');
    const categoryRow = within(view.getByLabelText('选择分类'));
    expect(categoryRow.getByText('分类')).toBeTruthy();
    expect(categoryRow.getByText('开发调优')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'ali');
    await waitFor(() => expect(view.getByLabelText('用户 山月')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('用户 山月'));
    expect(view.getByLabelText('选择作者').props.accessibilityValue.text).toBe('山月');
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByLabelText('打开搜索筛选，当前开发调优 · 山月')).toBeTruthy();
  });

  it('keeps selected linux.do candidates through pagination and Topic return', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await fireEvent.press(view.getByRole('button', { name: '确认标签' }));
    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'alice');
    await waitFor(() => expect(view.getByLabelText('用户 山月')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('用户 山月'));
    await fireEvent.press(view.getByText('确认筛选'));
    await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'codex');
    await fireEvent.press(view.getByLabelText('提交搜索'));
    const linuxDoGroup: SearchGroup = {
      source: 'linuxdo',
      label: 'linux.do',
      items: [linuxTopic],
      hasMore: true,
      nextPage: 2
    };
    await fireEvent(view.getByTestId('search-complete'), 'scrollBeginDrag');
    const linuxDoSentinel = visibleLoadMore(linuxDoGroup, 2, 2);
    await fireEvent(view.getByTestId('search-complete'), 'viewableItemsChanged', {
      viewableItems: [linuxDoSentinel],
      changed: [linuxDoSentinel]
    });
    expect(view.getByText('第二页主题')).toBeTruthy();

    await fireEvent.press(view.getByText('linux.do 主题'));
    await fireEvent.press(view.getByLabelText('返回搜索'));
    expect(view.getByText('第二页主题')).toBeTruthy();
    expect(view.getByLabelText('打开搜索筛选，当前人工智能 · 山月')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前人工智能 · 山月'));
    expect(view.getByLabelText('移除标签 人工智能')).toBeTruthy();
    expect(view.getByLabelText('移除作者 山月')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('移除标签 人工智能'));
    expect(view.queryByLabelText('移除标签 人工智能')).toBeNull();
    expect(view.getByLabelText('移除作者 山月')).toBeTruthy();
    await fireEvent.press(view.getByTestId('search-filter-close'));
    expect(view.getByLabelText('打开搜索筛选，当前人工智能 · 山月')).toBeTruthy();
  });

  it('applies every linux.do advanced filter exposed by the original site', async () => {
    const onSearchFilterApply = jest.fn<(source: Source, filter: SourceSearchFilter) => void>();
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      query: '',
      submittedQuery: '',
      onSearchFilterApply,
      filter: {
        onSearchDiscourseTags: jest.fn(async () => [
          { name: '人工智能', topicCount: 12 },
          { name: '快问快答', topicCount: 3 }
        ])
      }
    });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await waitFor(() => expect(view.getByLabelText('标签 快问快答')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 快问快答'));
    await fireEvent.press(view.getByRole('button', { name: '确认标签' }));
    await fireEvent.press(view.getByLabelText('匹配全部标签'));
    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择回访范围'));
    await fireEvent.press(view.getByLabelText('我读过'));
    await fireEvent.press(view.getByLabelText('我赞过'));
    await fireEvent.press(view.getByRole('button', { name: '确认回访范围' }));
    await fireEvent.press(view.getByLabelText('选择话题状态'));
    await fireEvent.press(view.getByText('已解决'));
    await fireEvent.press(view.getByLabelText('设置精确日期'));
    await fireEvent.press(view.getByText('之前'));
    await fireEvent.press(view.getByLabelText('选择精确日期'));
    await fireEvent.press(view.getByLabelText('确认日期 2026-07-01'));
    await fireEvent.press(view.getByRole('button', { name: '完成' }));
    await fireEvent.press(view.getByLabelText('设置帖子数范围'));
    await fireEvent.changeText(view.getByLabelText('帖子数最小值'), '2');
    await fireEvent.changeText(view.getByLabelText('帖子数最大值'), '20');
    await fireEvent.press(view.getByRole('button', { name: '确认范围' }));
    await fireEvent.press(view.getByLabelText('设置浏览量范围'));
    await fireEvent.changeText(view.getByLabelText('浏览量最小值'), '100');
    await fireEvent.changeText(view.getByLabelText('浏览量最大值'), '1000');
    await fireEvent.press(view.getByRole('button', { name: '确认范围' }));
    await fireEvent.press(view.getByLabelText('有专家回应'));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(onSearchFilterApply).toHaveBeenCalledWith(
      'linuxdo',
      expect.objectContaining({
        tags: ['人工智能', '快问快答'],
        tagMatch: 'all',
        visited: ['seen', 'likes'],
        status: 'solved',
        dateRelation: 'before',
        date: '2026-07-01',
        timeRange: 'all',
        minPosts: 2,
        maxPosts: 20,
        minViews: 100,
        maxViews: 1000,
        expertResponse: true
      })
    );
  });

  it('keeps a selected exact date distinct from the unrestricted time option', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('设置精确日期'));
    await fireEvent.press(view.getByLabelText('选择精确日期'));
    await fireEvent.press(view.getByLabelText('确认日期 2026-07-01'));

    expect(view.getByLabelText('选择精确日期').props.accessibilityValue.text).toBe('2026-07-01');
    await fireEvent.press(view.getByRole('button', { name: '完成' }));
    expect(view.getByLabelText('选择时间范围').props.accessibilityValue.text).toBe('2026-07-01 之后');
    await fireEvent.press(view.getByLabelText('选择时间范围'));
    expect(view.getByRole('radio', { name: '不限时间' }).props.accessibilityState.checked).toBe(false);
    await fireEvent.press(view.getByLabelText('返回筛选'));
    await fireEvent.press(view.getByLabelText('清除精确日期'));
    await fireEvent.press(view.getByLabelText('选择时间范围'));
    expect(view.getByRole('radio', { name: '不限时间' }).props.accessibilityState.checked).toBe(true);
  });

  it('discards the open filter and candidate picker when the selected site changes', async () => {
    const props = createSearchScreenProps({ searchSource: 'linuxdo' });
    const view = await render(<SearchScreen {...props} />);

    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    expect(view.getByLabelText('搜索标签')).toBeTruthy();

    await view.rerender(<SearchScreen {...props} searchSource="nodeseek" />);
    expect(view.queryByLabelText('搜索标签')).toBeNull();
    expect(view.queryByText('确认筛选')).toBeNull();
    expect(props.onSearchFilterApply).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    expect(view.getByText('确认筛选')).toBeTruthy();
    expect(view.queryByLabelText('选择标签')).toBeNull();
  });

  it.each([
    { name: '帖子数', page: 'posts', min: 'minPosts', max: 'maxPosts' },
    { name: '浏览量', page: 'views', min: 'minViews', max: 'maxViews' }
  ] as const)(
    'returns to the invalid $name range and keeps other draft values when correcting it',
    async ({ name, page, min, max }) => {
      const onSearchFilterApply = jest.fn<(source: Source, filter: SourceSearchFilter) => void>();
      const view = await renderSearchScreen({ searchSource: 'linuxdo', onSearchFilterApply });
      const minField = `${name}最小值`;
      const maxField = `${name}最大值`;
      const message = `${name}最小值不能大于最大值`;

      await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
      await fireEvent.press(view.getByText('标题'));
      await fireEvent.press(view.getByLabelText('展开更多筛选'));
      await fireEvent.press(view.getByLabelText(`设置${name}范围`));
      await fireEvent.changeText(view.getByLabelText(minField), '-1');
      expect(view.getByLabelText(minField).props.value).toBe('');
      await fireEvent.changeText(view.getByLabelText(minField), '20');
      await fireEvent.changeText(view.getByLabelText(maxField), '2');
      await fireEvent.press(view.getByRole('button', { name: '确认范围' }));
      await fireEvent.press(view.getByText('确认筛选'));

      expect(view.getByRole('header', { name: `${name}范围` })).toBeTruthy();
      expect(within(view.getByTestId(`search-filter-body-${page}`)).getByRole('alert')).toHaveTextContent(message);
      expect(view.getByLabelText(maxField).props.accessibilityHint).toBe(message);
      expect(onSearchFilterApply).not.toHaveBeenCalled();
      expect(view.getByLabelText(minField).props.value).toBe('20');
      expect(view.getByLabelText(maxField).props.value).toBe('2');

      await fireEvent.changeText(view.getByLabelText(maxField), '30');
      expect(view.queryByRole('alert')).toBeNull();
      await fireEvent.press(view.getByRole('button', { name: '确认范围' }));
      await fireEvent.press(view.getByText('确认筛选'));
      expect(onSearchFilterApply).toHaveBeenCalledTimes(1);
      expect(onSearchFilterApply).toHaveBeenCalledWith(
        'linuxdo',
        expect.objectContaining({ scope: 'title', [min]: 20, [max]: 30 })
      );
    }
  );

  it('opens the calendar field for an invalid existing date and applies the corrected date', async () => {
    const onSearchFilterApply = jest.fn<(source: Source, filter: SourceSearchFilter) => void>();
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      onSearchFilterApply,
      filter: {
        searchFilters: {
          ...DEFAULT_SEARCH_FILTERS,
          linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo, date: 'invalid-date', minViews: 200 }
        }
      }
    });

    await fireEvent.press(view.getByTestId('search-filter-trigger'));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByRole('header', { name: '精确日期' })).toBeTruthy();
    expect(within(view.getByTestId('search-filter-body-date')).getByRole('alert')).toHaveTextContent('请选择有效日期');
    expect(onSearchFilterApply).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('选择精确日期'));
    await fireEvent.press(view.getByLabelText('确认日期 2026-07-01'));
    expect(view.queryByRole('alert')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '完成' }));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(onSearchFilterApply).toHaveBeenCalledTimes(1);
    expect(onSearchFilterApply).toHaveBeenCalledWith(
      'linuxdo',
      expect.objectContaining({ date: '2026-07-01', minViews: 200 })
    );
  });

  it('shows cached AI results as an optional marked extension of linux.do results', async () => {
    const onToggleLinuxDoAiSearch = jest.fn<() => void>();
    const aiTopic: Topic = {
      ...linuxTopic,
      id: 'linux-search-ai',
      title: 'AI 独有主题',
      url: 'https://linux.do/t/topic/linux-search-ai',
      isAiGenerated: true
    };
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      searchGroups: [{ source: 'linuxdo', label: 'linux.do', items: [linuxTopic, aiTopic] }],
      linuxDoAiVisible: true,
      linuxDoAiState: { status: 'ready', enabled: false, count: 2 },
      onToggleLinuxDoAiSearch
    });

    expect(view.getByText('2 条 AI 结果')).toBeTruthy();
    expect(view.getByText('✦ AI')).toBeTruthy();
    expect(view.getByLabelText('AI 搜索').props.accessibilityState).toEqual({ checked: false, disabled: false });
    await fireEvent(view.getByLabelText('AI 搜索'), 'valueChange', true);
    expect(onToggleLinuxDoAiSearch).toHaveBeenCalledTimes(1);
  });

  it('keeps the AI switch disabled while loading', async () => {
    const loadingView = await renderSearchScreen({
      searchSource: 'linuxdo',
      linuxDoAiVisible: true,
      linuxDoAiState: { status: 'loading', enabled: false, count: 0 }
    });
    expect(loadingView.getByText('加载中')).toBeTruthy();
    expect(loadingView.getByLabelText('AI 搜索').props.accessibilityState.disabled).toBe(true);
  });

  it('offers retry for an AI network failure', async () => {
    const onRetryLinuxDoAiSearch = jest.fn<() => void>();
    const errorView = await renderSearchScreen({
      searchSource: 'linuxdo',
      linuxDoAiVisible: true,
      linuxDoAiState: { status: 'error', enabled: false, count: 0, message: 'AI 搜索失败，可重试' },
      onRetryLinuxDoAiSearch
    });
    expect(errorView.getByText('AI 搜索失败，可重试')).toBeTruthy();
    expect(errorView.queryByLabelText('AI 搜索')).toBeNull();
    await fireEvent.press(errorView.getByRole('button', { name: '重试 AI 搜索' }));
    expect(onRetryLinuxDoAiSearch).toHaveBeenCalledTimes(1);
  });

  it('applies every V2EX filter field exposed by the compact sheet', async () => {
    const view = await render(<SearchHarness />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('相关'));
    await fireEvent.press(view.getByLabelText('选择时间范围'));
    await fireEvent.press(view.getByText('30天'));
    await fireEvent.press(view.getByLabelText('选择节点'));
    await fireEvent.press(view.getByLabelText('节点 问与答'));
    await fireEvent.press(view.getByLabelText('展开 V2EX 更多筛选'));
    await fireEvent.changeText(view.getByLabelText('作者'), 'alice');
    await fireEvent.press(view.getByRole('radio', { name: '全部' }));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByLabelText('打开搜索筛选，当前相关 · 问与答 · alice · 全部关键词 · 30天')).toBeTruthy();
  });

  it.each([
    {
      source: 'v2ex',
      expand: '展开 V2EX 更多筛选',
      collapse: '收起 V2EX 更多筛选',
      field: '作者',
      value: 'alice',
      rangeEntry: null
    },
    {
      source: 'linuxdo',
      expand: '展开更多筛选',
      collapse: '收起更多筛选，已设置',
      field: '帖子数最小值',
      value: '3',
      rangeEntry: '设置帖子数范围'
    }
  ] as const)(
    'preserves $source expanded filters, draft fields and scroll position when Android dismisses the keyboard',
    async ({ source, expand, collapse, field, value, rangeEntry }) => {
      const platform = jest.replaceProperty(Platform, 'OS', 'android');
      try {
        const view = await render(<SearchHarness initialSource={source} />);
        await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
        await fireEvent.press(view.getByLabelText(expand));
        const mainBody = () => view.getByTestId('search-filter-body-main');
        const filterBody = () => (rangeEntry ? view.getByTestId('search-filter-body-posts') : mainBody());
        if (rangeEntry) {
          await fireEvent.scroll(mainBody(), {
            nativeEvent: {
              contentOffset: { x: 0, y: 120 },
              contentSize: { width: 400, height: 650 },
              layoutMeasurement: { width: 400, height: 400 }
            }
          });
          await fireEvent.press(view.getByLabelText(rangeEntry));
        }

        for (let cycle = 0; cycle < 2; cycle += 1) {
          const body = filterBody();
          const initialOffset = body.props.contentOffset ?? { x: 0, y: 0 };
          const offset = { x: 0, y: rangeEntry ? 0 : 16 + cycle * 12 };
          await act(() =>
            DeviceEventEmitter.emit('keyboardDidShow', {
              duration: 250,
              easing: 'keyboard',
              endCoordinates: { height: 300, width: 400, screenX: 0, screenY: 500 }
            })
          );
          await fireEvent.scroll(body, {
            nativeEvent: {
              contentOffset: offset,
              contentSize: { width: 400, height: 1600 },
              layoutMeasurement: { width: 400, height: 400 }
            }
          });
          await fireEvent.changeText(view.getByLabelText(field), value);
          // Editing must not issue a new controlled scroll offset to the existing native view.
          expect(filterBody()).toBe(body);
          expect(body.props.contentOffset ?? { x: 0, y: 0 }).toEqual(initialOffset);
          await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));

          const restoredBody = filterBody();
          expect(restoredBody).not.toBe(body);
          // The native ScrollView consumes this starting offset after the KAV remount.
          expect(restoredBody.props.contentOffset ?? { x: 0, y: 0 }).toEqual(offset);
          expect(view.getByLabelText(field).props.value).toBe(value);
        }
        if (rangeEntry) {
          await fireEvent.press(view.getByRole('button', { name: '确认范围' }));
          expect(mainBody().props.contentOffset).toEqual({ x: 0, y: 120 });
        }
        expect(view.getByLabelText(collapse).props.accessibilityState.expanded).toBe(true);

        await fireEvent.press(view.getByTestId('search-filter-close'));
        await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
        expect(mainBody().props.contentOffset).toEqual({ x: 0, y: 0 });
        expect(view.getByLabelText(expand)).toBeTruthy();
        await fireEvent.press(view.getByLabelText(expand));
        if (rangeEntry) await fireEvent.press(view.getByLabelText(rangeEntry));
        expect(view.getByLabelText(field).props.value).toBe('');
      } finally {
        await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
        platform.restore();
      }
    }
  );

  it('keeps low-frequency Discourse filters behind progressive disclosure', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    expect(view.getByText('排序')).toBeTruthy();
    expect(view.getByText('时间')).toBeTruthy();
    expect(view.getByText('搜索范围')).toBeTruthy();
    expect(view.getByText('分类')).toBeTruthy();
    expect(view.getByText('标签')).toBeTruthy();
    expect(view.queryByText('话题状态')).toBeNull();
    expect(view.queryByLabelText('选择作者')).toBeNull();

    await fireEvent.press(view.getByLabelText('展开更多筛选'));
    await fireEvent.press(view.getByLabelText('选择话题状态'));
    await fireEvent.press(view.getByText('已解决'));
    await fireEvent.press(view.getByLabelText('收起更多筛选，已设置'));
    expect(view.queryByText('话题状态')).toBeNull();
    expect(view.getByText('更多筛选 · 已设置')).toBeTruthy();
    await fireEvent.press(view.getByText('确认筛选'));

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前已解决'));
    expect(view.getByLabelText('收起更多筛选，已设置')).toBeTruthy();
    expect(view.getByText('话题状态')).toBeTruthy();
    expect(view.getByLabelText('选择作者')).toBeTruthy();
  });

  it('discards a closed filter draft and applies reset only after confirmation', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('标题'));
    await fireEvent.press(view.getAllByLabelText('关闭筛选')[1]);
    expect(view.getByLabelText('打开搜索筛选，当前默认')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('标题'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前标题')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前标题'));
    await fireEvent.press(view.getByText('重置'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前默认')).toBeTruthy();
  });
});
