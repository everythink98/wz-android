import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { createEmptyReaderData } from '../../src/readerData';
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState, type SourceSearchFilter } from '../../src/searchFilters';
import type { SearchGroup } from '../../src/searchListItems';
import { SearchScreen } from '../../src/screens/SearchScreen';
import { createStyles, createTheme } from '../../src/theme';
import { createTopicListItemStateIndex } from '../../src/topicListItemState';
import type { Category, FeedSource, Source, Topic } from '../../src/types';

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    useMappingHelper: () => ({ getMappingKey: (value: string, index: number) => `${value}-${index}` }),
    FlashList: ReactModule.forwardRef(function FlashList(
      {
        data = [],
        accessibilityLabel,
        keyExtractor,
        ListEmptyComponent,
        ListHeaderComponent,
        onScrollBeginDrag,
        onViewableItemsChanged,
        renderItem,
        testID
      }: {
        accessibilityLabel?: string;
        data?: unknown[];
        keyExtractor?: (item: unknown, index: number) => string;
        ListEmptyComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        onScrollBeginDrag?: () => void;
        onViewableItemsChanged?: (info: { viewableItems: unknown[]; changed: unknown[] }) => void;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{
        recordInteraction: () => void;
        recomputeViewableItems: () => void;
        scrollToOffset: () => void;
      }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        recordInteraction: () => undefined,
        recomputeViewableItems: () => undefined,
        scrollToOffset: () => undefined
      }));
      return ReactModule.createElement(
        NativeView,
        {
          accessibilityLabel,
          testID: testID ?? 'search-list',
          onScrollBeginDrag,
          onViewableItemsChanged
        } as React.ComponentProps<typeof NativeView>,
        ListHeaderComponent,
        ...data.map((item, index) => ReactModule.createElement(
          NativeView,
          { key: keyExtractor?.(item, index) ?? index },
          renderItem?.({ item, index })
        )),
        data.length ? null : ListEmptyComponent
      );
    })
  };
});

jest.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  ChevronUp: () => null,
  Eye: () => null,
  MessageCircle: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  X: () => null
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable, Text: NativeText } = require('react-native') as typeof import('react-native');
  return function MockDateTimePicker({ onChange }: { onChange: (event: { type: string }, date?: Date) => void }) {
    return ReactModule.createElement(
      NativePressable,
      { accessibilityRole: 'button', accessibilityLabel: '确认日期 2026-07-01', onPress: () => onChange({ type: 'set' }, new Date(2026, 6, 1)) },
      ReactModule.createElement(NativeText, null, '确认日期')
    );
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const topicStateIndex = createTopicListItemStateIndex(readerData);
const categories: Category[] = [
  { source: 'linuxdo', id: '2', name: '技术', slug: 'tech', topicCount: 120 },
  { source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev', parentId: '2', parentSlug: 'tech', topicCount: 88, readRestricted: true },
  { source: 'nodeseek', id: 'daily', name: '日常' },
  { source: 'yaohuo', id: '177', name: '妖火茶馆' }
];

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
  const resultLabel = resultSource === 'v2ex' ? 'V2EX' : resultSource === 'linuxdo' ? 'linux.do' : resultSource === 'nodeseek' ? 'NodeSeek' : '妖火';
  const resultFirstTopic = resultSource === 'linuxdo' ? linuxTopic : { ...firstTopic, source: resultSource };
  const resultSecondTopic = resultSource === 'v2ex' ? secondTopic : {
    ...resultFirstTopic,
    id: `${resultSource}-search-2`,
    title: '第二页主题',
    url: `${resultFirstTopic.url}/2`
  };
  const searchGroups = submittedQuery ? [{
    source: resultSource,
    label: resultLabel,
    items: page === 1 ? [resultFirstTopic] : [resultFirstTopic, resultSecondTopic],
    hasMore: page === 1,
    nextPage: page === 1 ? 2 : null
  }] : [];
  const loadMoreSearchSource = (_source: Source, nextPage: number) => setPage(Number(nextPage));

  return (
    <SearchScreen
      busy={false}
      categories={categories}
      query={query}
      recentSearches={[]}
      topicStateIndex={topicStateIndex}
      searchFilters={searchFilters}
      searchGroups={searchGroups}
      linuxDoAiState={{ status: 'idle', enabled: false, count: 0 }}
      linuxDoAiVisible={false}
      searchSessionNotices={[]}
      searchSource={searchSource}
      submittedQuery={submittedQuery}
      scrollToTopSignal={0}
      styles={styles}
      theme={theme}
      onOpenTopic={() => setRoute('topic')}
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
        setSearchFilters((current) => ({ ...current, [source]: filter } as SearchFilterState));
      }}
      onSearchLinuxDoTags={async () => [
        { name: '人工智能', topicCount: 12 },
        { name: '快问快答', topicCount: 3 }
      ]}
      onSearchLinuxDoUsers={async () => [{ id: '7', username: 'alice', displayName: 'Alice' }]}
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
  onSearch: () => void;
}) {
  const [query, setQuery] = useState('');

  return (
    <SearchScreen
      busy={false}
      categories={categories}
      query={query}
      recentSearches={['codex', 'react native']}
      topicStateIndex={topicStateIndex}
      searchFilters={DEFAULT_SEARCH_FILTERS}
      searchGroups={[]}
      linuxDoAiState={{ status: 'idle', enabled: false, count: 0 }}
      linuxDoAiVisible={false}
      searchSessionNotices={[]}
      searchSource="all"
      submittedQuery=""
      scrollToTopSignal={0}
      styles={styles}
      theme={theme}
      onOpenTopic={jest.fn()}
      onLoadMoreSearchSource={jest.fn()}
      onRemoveRecentSearch={onRemoveRecentSearch}
      onQueryChange={setQuery}
      onRetrySearchSource={jest.fn()}
      onRetryLinuxDoAiSearch={jest.fn()}
      onSearch={onSearch}
      onSearchFilterApply={jest.fn()}
      onSearchLinuxDoTags={jest.fn(async () => [])}
      onSearchLinuxDoUsers={jest.fn(async () => [])}
      onToggleLinuxDoAiSearch={jest.fn()}
      onSearchSourceChange={jest.fn()}
    />
  );
}

function createSearchScreenProps(overrides: Partial<React.ComponentProps<typeof SearchScreen>> = {}) {
  const props: React.ComponentProps<typeof SearchScreen> = {
    busy: false,
    categories,
    query: 'codex',
    recentSearches: [],
    topicStateIndex,
    searchFilters: DEFAULT_SEARCH_FILTERS,
    searchGroups: [],
    linuxDoAiState: { status: 'idle', enabled: false, count: 0 },
    linuxDoAiVisible: false,
    searchSessionNotices: [],
    searchSource: 'all',
    submittedQuery: 'codex',
    scrollToTopSignal: 0,
    styles,
    theme,
    onOpenTopic: jest.fn(),
    onLoadMoreSearchSource: jest.fn(),
    onRemoveRecentSearch: jest.fn(),
    onQueryChange: jest.fn(),
    onRetrySearchSource: jest.fn(),
    onRetryLinuxDoAiSearch: jest.fn(),
    onSearch: jest.fn(),
    onSearchFilterApply: jest.fn(),
    onSearchLinuxDoTags: jest.fn(async () => []),
    onSearchLinuxDoUsers: jest.fn(async () => []),
    onToggleLinuxDoAiSearch: jest.fn(),
    onSearchSourceChange: jest.fn(),
    ...overrides
  };
  return props;
}

function renderSearchScreen(overrides: Partial<React.ComponentProps<typeof SearchScreen>> = {}) {
  return render(<SearchScreen {...createSearchScreenProps(overrides)} />);
}

describe('Search state', () => {
  it('fills a recent search without submitting and removes only the selected entry', async () => {
    const onRemoveRecentSearch = jest.fn<(query: string) => void>();
    const onSearch = jest.fn<() => void>();
    const view = await render(
      <RecentSearchHarness onRemoveRecentSearch={onRemoveRecentSearch} onSearch={onSearch} />
    );

    await fireEvent.press(view.getByText('codex'));
    expect(view.getByLabelText('搜索关键词').props.value).toBe('codex');
    expect(onSearch).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('清空搜索关键词'));
    await fireEvent.press(view.getByLabelText('删除最近搜索 react native'));
    expect(onRemoveRecentSearch).toHaveBeenCalledTimes(1);
    expect(onRemoveRecentSearch).toHaveBeenCalledWith('react native');
    expect(view.getByLabelText('搜索关键词').props.value).toBe('');
    expect(onSearch).not.toHaveBeenCalled();
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
    expect(view.getByTestId('search-outcome-error-linuxdo')).toBeTruthy();
    expect(view.getByText('linux.do 暂时不可用')).toBeTruthy();
    fireEvent.press(view.getByText('重试 linux.do'));
    expect(onRetrySearchSource).toHaveBeenCalledTimes(1);
    expect(onRetrySearchSource).toHaveBeenCalledWith('linuxdo');
  });

  it('collapses and expands each source result group independently', async () => {
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
    const view = await renderSearchScreen({ searchGroups });

    await fireEvent.press(view.getByLabelText('收起V2EX搜索结果'));
    expect(view.queryByText('第一页主题')).toBeNull();
    expect(view.getByLabelText('展开V2EX搜索结果')).toBeTruthy();
    expect(view.getByText('linux.do 暂时不可用')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('展开V2EX搜索结果'));
    expect(view.getByText('第一页主题')).toBeTruthy();
    expect(view.getByLabelText('收起V2EX搜索结果')).toBeTruthy();
  });

  it('hides stale results as soon as the input differs from the submitted query', async () => {
    const view = await renderSearchScreen({
      query: 'codex next',
      searchGroups: [{ source: 'v2ex', label: 'V2EX', items: [firstTopic] }]
    });

    expect(view.queryByText('第一页主题')).toBeNull();
    expect(view.getByText('按键盘上的搜索键开始')).toBeTruthy();
    expect(view.queryByTestId('search-complete')).toBeNull();
  });

  it('shows a login-required outcome as guidance instead of a retryable source error', async () => {
    const message = 'linux.do 登录已失效，请重新登录。';
    const view = await renderSearchScreen({
      searchGroups: [{
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
      }]
    });

    expect(view.getByTestId('search-outcome-auth-linuxdo')).toBeTruthy();
    expect(view.getByText(message)).toBeTruthy();
    expect(view.queryByTestId('search-outcome-error-linuxdo')).toBeNull();
    expect(view.queryByText('重试 linux.do')).toBeNull();
  });

  it('disables duplicate submission while a submitted search is still running', async () => {
    const onSearch = jest.fn<() => void>();
    const view = await renderSearchScreen({ busy: true, onSearch });

    expect(view.getByText('正在搜索...')).toBeTruthy();
    expect(view.getByLabelText('提交搜索').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('提交搜索'));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('identifies which source completed with no matching results', async () => {
    const view = await renderSearchScreen({
      searchGroups: [{ source: 'nodeseek', label: 'NodeSeek', items: [] }]
    });

    expect(view.getByTestId('search-outcome-empty-nodeseek')).toBeTruthy();
    expect(view.getByText('NodeSeek 没有匹配结果')).toBeTruthy();
  });

  it('loads only the first visible source after a user scroll and never from initial render', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const searchGroups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic],
        hasMore: true,
        nextPage: 2
      },
      {
        source: 'linuxdo',
        label: 'linux.do',
        items: [linuxTopic],
        hasMore: true,
        nextPage: 7
      }
    ];
    const props = createSearchScreenProps({
      onLoadMoreSearchSource,
      searchGroups
    });
    const view = await render(<SearchScreen {...props} />);

    const list = view.getByTestId('search-complete');
    const visibleSentinels = [
      visibleLoadMore(searchGroups[0], 2, 2),
      visibleLoadMore(searchGroups[1], 7, 5)
    ];
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: visibleSentinels, changed: visibleSentinels });
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
    expect(view.getByText('继续下滑加载更多 V2EX')).toBeTruthy();
    expect(view.getByTestId('search-load-more-v2ex').props.onPress).toBeUndefined();

    await fireEvent(list, 'scrollBeginDrag');
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: visibleSentinels, changed: visibleSentinels });
    expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(1);
    expect(onLoadMoreSearchSource).toHaveBeenLastCalledWith('v2ex', 2);

    await fireEvent(list, 'viewableItemsChanged', {
      viewableItems: [visibleSentinels[1]],
      changed: [visibleSentinels[1]]
    });
    expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(1);

    await view.rerender(<SearchScreen
      {...props}
      searchGroups={[{ ...searchGroups[0], hasMore: false, nextPage: null }, searchGroups[1]]}
    />);
    const updatedList = view.getByTestId('search-complete');
    await fireEvent(updatedList, 'scrollBeginDrag');
    await fireEvent(updatedList, 'viewableItemsChanged', {
      viewableItems: [visibleSentinels[1]],
      changed: [visibleSentinels[1]]
    });
    expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(2);
    expect(onLoadMoreSearchSource).toHaveBeenLastCalledWith('linuxdo', 7);
  });

  it.each([
    ['query', { query: 'changed' }],
    ['source', { searchSource: 'v2ex' as const }],
    ['scroll-to-top', { scrollToTopSignal: 1 }]
  ])('clears an armed sentinel when %s changes', async (_label, changedProps) => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const group: SearchGroup = {
      source: 'v2ex',
      label: 'V2EX',
      items: [firstTopic],
      hasMore: true,
      nextPage: 2
    };
    const props = createSearchScreenProps({ onLoadMoreSearchSource, searchGroups: [group] });
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
    const view = await renderSearchScreen({ busy: true, onLoadMoreSearchSource, searchGroups: [group] });
    const list = view.getByTestId('search-list');
    const sentinel = visibleLoadMore(group, 2, 2);

    await fireEvent(list, 'scrollBeginDrag');
    await fireEvent(list, 'viewableItemsChanged', { viewableItems: [sentinel], changed: [sentinel] });
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
  });

  it('clears an armed sentinel when its group is collapsed', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const group: SearchGroup = {
      source: 'v2ex',
      label: 'V2EX',
      items: [firstTopic],
      hasMore: true,
      nextPage: 2
    };
    const view = await renderSearchScreen({ onLoadMoreSearchSource, searchGroups: [group] });
    const sentinel = visibleLoadMore(group, 2, 2);

    await fireEvent(view.getByTestId('search-complete'), 'scrollBeginDrag');
    await fireEvent.press(view.getByLabelText('收起V2EX搜索结果'));
    await fireEvent(view.getByTestId('search-complete'), 'viewableItemsChanged', {
      viewableItems: [sentinel],
      changed: [sentinel]
    });
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
    const finishedView = await renderSearchScreen({ onLoadMoreSearchSource, searchGroups: [finishedGroup] });
    const sentinel = visibleLoadMore(group, 2, 2);

    await fireEvent(finishedView.getByTestId('search-complete'), 'scrollBeginDrag');
    await fireEvent(finishedView.getByTestId('search-complete'), 'viewableItemsChanged', {
      viewableItems: [sentinel],
      changed: [sentinel]
    });
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
    expect(finishedView.queryByTestId('search-load-more-v2ex')).toBeNull();
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
    const props = createSearchScreenProps({ searchGroups: [loadingGroup] });
    const view = await render(<SearchScreen {...props} />);

    expect(view.getByText('正在加载更多 V2EX')).toBeTruthy();
    expect(view.getByTestId('search-load-more-spinner-v2ex')).toBeTruthy();

    await view.rerender(<SearchScreen
      {...props}
      searchGroups={[{ ...loadingGroup, loadingMore: false, hasMore: false, nextPage: null }]}
    />);
    expect(view.queryByTestId('search-load-more-v2ex')).toBeNull();
  });

  it('REG-SEARCH-002 keeps loaded results and retries the failed page', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const onRetrySearchSource = jest.fn<(source: Source) => void>();
    const view = await renderSearchScreen({
      onLoadMoreSearchSource,
      onRetrySearchSource,
      searchGroups: [{
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic],
        error: '第 2 页请求失败',
        hasMore: true,
        nextPage: 2
      }]
    });

    expect(view.getByText('第一页主题')).toBeTruthy();
    expect(view.getByText('1 条 · 加载失败')).toBeTruthy();
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
      searchGroups: [{
        source: 'v2ex',
        label: 'V2EX',
        items: [firstTopic],
        error: '首屏请求失败',
        hasMore: false,
        nextPage: null
      }]
    });

    expect(view.queryByText('第一页主题')).toBeNull();
    expect(view.getByText('首屏请求失败')).toBeTruthy();
    await fireEvent.press(view.getByText('重试 V2EX'));
    expect(onRetrySearchSource).toHaveBeenCalledWith('v2ex');
    expect(onLoadMoreSearchSource).not.toHaveBeenCalled();
  });

  it('keeps query, filter and loaded page across Topic and User navigation', async () => {
    const view = await render(<SearchHarness />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('按时间'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前按时间')).toBeTruthy();

    await fireEvent.changeText(view.getByLabelText('搜索关键词'), 'codex');
    await fireEvent.press(view.getByLabelText('提交搜索'));
    expect(view.getByTestId('search-result-first')).toBeTruthy();
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

    await fireEvent.press(view.getByTestId('search-result-first'));
    expect(view.getByTestId('topic-placeholder')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('打开作者页'));
    expect(view.getByTestId('user-placeholder')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('返回主题'));
    await fireEvent.press(view.getByLabelText('返回搜索'));

    expect(view.getByLabelText('搜索关键词').props.value).toBe('codex');
    expect(view.getByLabelText('打开搜索筛选，当前按时间')).toBeTruthy();
    expect(view.getByText('第二页主题')).toBeTruthy();
    expect(view.queryByTestId('search-load-more-v2ex')).toBeNull();
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
    await fireEvent.press(view.getByText('完成'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'alice');
    await waitFor(() => expect(view.getByLabelText('用户 alice')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('用户 alice'));
    await fireEvent.press(view.getByText('7天'));
    await fireEvent.press(view.getByText('最新'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前标题 · 开发调优 · 人工智能 · alice · 7天 · 最新')).toBeTruthy();

    await fireEvent.press(view.getByTestId('search-source-nodeseek'));
    expect(view.getByLabelText('打开搜索筛选，当前默认')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('日常'));
    await fireEvent.press(view.getByText('新帖子'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前日常 · 新帖子')).toBeTruthy();

    await fireEvent.press(view.getByTestId('search-source-yaohuo'));
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('妖火茶馆'));
    await fireEvent.press(view.getByText('确认筛选'));
    expect(view.getByLabelText('打开搜索筛选，当前妖火茶馆')).toBeTruthy();

    await fireEvent.press(view.getByTestId('search-source-linuxdo'));
    expect(view.getByLabelText('打开搜索筛选，当前标题 · 开发调优 · 人工智能 · alice · 7天 · 最新')).toBeTruthy();
  });

  it('REG-SEARCH-001 accepts linux.do tags only from the candidate picker', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    expect(view.queryByPlaceholderText('例如 人工智能')).toBeNull();
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), '任意手打');
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await fireEvent.press(view.getByText('完成'));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByLabelText('打开搜索筛选，当前人工智能')).toBeTruthy();
    expect(view.queryByText('任意手打')).toBeNull();
  });

  it('REG-SEARCH-001 ignores a stale linux.do tag response after the search term changes', async () => {
    const oldResponse = Promise.withResolvers<Array<{ name: string }>>();
    const freshResponse = Promise.withResolvers<Array<{ name: string }>>();
    const onSearchLinuxDoTags = jest.fn(({ query: term }: { query: string }) => (
      term === 'old' ? oldResponse.promise : freshResponse.promise
    ));
    const view = await renderSearchScreen({ searchSource: 'linuxdo', onSearchLinuxDoTags });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'old');
    await waitFor(() => expect(onSearchLinuxDoTags).toHaveBeenCalledWith(expect.objectContaining({ query: 'old' })));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'fresh');
    await waitFor(() => expect(onSearchLinuxDoTags).toHaveBeenCalledWith(expect.objectContaining({ query: 'fresh' })));

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

  it('REG-SEARCH-001 removes visible tag and author candidates as soon as their query changes', async () => {
    const onSearchLinuxDoTags = jest.fn(async ({ query: term }: { query: string }) => (
      term === 'old' ? [{ name: '旧标签' }] : [{ name: '新标签' }]
    ));
    const onSearchLinuxDoUsers = jest.fn(async ({ term }: { term: string }) => (
      term === 'old' ? [{ id: 'old', username: 'old-user' }] : [{ id: 'new', username: 'new-user' }]
    ));
    const view = await renderSearchScreen({ searchSource: 'linuxdo', onSearchLinuxDoTags, onSearchLinuxDoUsers });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'old');
    await waitFor(() => expect(view.getByLabelText('标签 旧标签')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'fresh');
    expect(view.queryByLabelText('标签 旧标签')).toBeNull();
    await waitFor(() => expect(view.getByLabelText('标签 新标签')).toBeTruthy());
    await fireEvent.press(view.getByText('完成'));

    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'old');
    await waitFor(() => expect(view.getByLabelText('用户 old-user')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'fresh');
    expect(view.queryByLabelText('用户 old-user')).toBeNull();
    await waitFor(() => expect(view.getByLabelText('用户 new-user')).toBeTruthy());
  });

  it('selects a hierarchical linux.do category and author from searchable candidates', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    expect(view.queryByPlaceholderText('linux.do 用户名')).toBeNull();
    await fireEvent.press(view.getByLabelText('选择分类'));
    await fireEvent.changeText(view.getByLabelText('搜索分类'), '开发');
    await fireEvent.press(view.getByLabelText('分类 技术 / 开发调优'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'ali');
    await waitFor(() => expect(view.getByLabelText('用户 alice')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('用户 alice'));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByLabelText('打开搜索筛选，当前开发调优 · alice')).toBeTruthy();
  });

  it('REG-SEARCH-001 keeps selected linux.do candidates through pagination and Topic return', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await fireEvent.press(view.getByText('完成'));
    await fireEvent.press(view.getByLabelText('选择作者'));
    await fireEvent.changeText(view.getByLabelText('搜索作者'), 'alice');
    await waitFor(() => expect(view.getByLabelText('用户 alice')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('用户 alice'));
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

    await fireEvent.press(view.getByTestId('search-result-first'));
    await fireEvent.press(view.getByLabelText('返回搜索'));
    expect(view.getByText('第二页主题')).toBeTruthy();
    expect(view.getByLabelText('打开搜索筛选，当前人工智能 · alice')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前人工智能 · alice'));
    expect(view.getByLabelText('移除标签 人工智能')).toBeTruthy();
    expect(view.getByLabelText('移除作者 alice')).toBeTruthy();
  });

  it('applies every linux.do advanced filter exposed by the original site', async () => {
    const onSearchFilterApply = jest.fn<(source: Source, filter: SourceSearchFilter) => void>();
    const view = await renderSearchScreen({
      searchSource: 'linuxdo',
      query: '',
      submittedQuery: '',
      onSearchFilterApply,
      onSearchLinuxDoTags: jest.fn(async () => [
        { name: '人工智能', topicCount: 12 },
        { name: '快问快答', topicCount: 3 }
      ])
    });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByLabelText('标签 人工智能')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('标签 人工智能'));
    await fireEvent.press(view.getByLabelText('标签 快问快答'));
    await fireEvent.press(view.getByText('完成'));
    await fireEvent.press(view.getByLabelText('匹配全部标签'));
    await fireEvent.press(view.getByText('我读过'));
    await fireEvent.press(view.getByText('我赞过'));
    await fireEvent.press(view.getByText('已解决'));
    await fireEvent.press(view.getByText('之前'));
    await fireEvent.press(view.getByLabelText('选择精确日期'));
    await fireEvent.press(view.getByLabelText('确认日期 2026-07-01'));
    await fireEvent.changeText(view.getByLabelText('帖子数最小值'), '2');
    await fireEvent.changeText(view.getByLabelText('帖子数最大值'), '20');
    await fireEvent.changeText(view.getByLabelText('浏览量最小值'), '100');
    await fireEvent.changeText(view.getByLabelText('浏览量最大值'), '1000');
    await fireEvent.press(view.getByLabelText('有专家回应'));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(onSearchFilterApply).toHaveBeenCalledWith('linuxdo', expect.objectContaining({
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
    }));
  });

  it('blocks an invalid linux.do numeric range and explains the field error', async () => {
    const onSearchFilterApply = jest.fn<(source: Source, filter: SourceSearchFilter) => void>();
    const view = await renderSearchScreen({ searchSource: 'linuxdo', onSearchFilterApply });

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.changeText(view.getByLabelText('帖子数最小值'), '-1');
    expect(view.getByLabelText('帖子数最小值').props.value).toBe('');
    await fireEvent.changeText(view.getByLabelText('帖子数最小值'), '20');
    await fireEvent.changeText(view.getByLabelText('帖子数最大值'), '2');
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByText('帖子数最小值不能大于最大值')).toBeTruthy();
    expect(onSearchFilterApply).not.toHaveBeenCalled();
    expect(view.getByText('确认筛选')).toBeTruthy();
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
    await fireEvent.press(view.getByLabelText('AI 搜索'));
    expect(onToggleLinuxDoAiSearch).toHaveBeenCalledTimes(1);
  });

  it('keeps the AI switch disabled while loading', async () => {
    const loadingView = await renderSearchScreen({
      searchSource: 'linuxdo',
      linuxDoAiVisible: true,
      linuxDoAiState: { status: 'loading', enabled: false, count: 0 }
    });
    expect(loadingView.getByText('AI 结果加载中')).toBeTruthy();
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
    await fireEvent.press(errorView.getByText('重试 AI 搜索'));
    expect(onRetryLinuxDoAiSearch).toHaveBeenCalledTimes(1);
  });

  it('applies every V2EX filter field exposed by the compact sheet', async () => {
    const view = await render(<SearchHarness />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('按时间'));
    await fireEvent.press(view.getByText('30天'));
    await fireEvent.changeText(view.getByPlaceholderText('例如 qna / jobs'), 'qna');
    await fireEvent.press(view.getByLabelText('展开 V2EX 更多筛选'));
    await fireEvent.changeText(view.getByPlaceholderText('V2EX 用户名'), 'alice');
    await fireEvent.press(view.getByText('全部关键词'));
    await fireEvent.press(view.getByText('确认筛选'));

    expect(view.getByLabelText('打开搜索筛选，当前按时间 · qna · alice · 全部关键词 · 30天')).toBeTruthy();
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
