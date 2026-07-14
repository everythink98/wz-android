import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
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
        keyExtractor,
        ListEmptyComponent,
        ListHeaderComponent,
        renderItem
      }: {
        data?: unknown[];
        keyExtractor?: (item: unknown, index: number) => string;
        ListEmptyComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
      },
      ref: React.ForwardedRef<{ scrollToOffset: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: () => undefined }));
      return ReactModule.createElement(
        NativeView,
        null,
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

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const topicStateIndex = createTopicListItemStateIndex(readerData);
const categories: Category[] = [
  { source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' },
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

  const searchGroups = submittedQuery ? [{
    source: 'v2ex' as const,
    label: 'V2EX',
    items: page === 1 ? [firstTopic] : [firstTopic, secondTopic],
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
      onSearch={() => {
        setSubmittedQuery(query.trim());
        setPage(1);
      }}
      onSearchFilterApply={(source: Source, filter: SourceSearchFilter) => {
        setSearchFilters((current) => ({ ...current, [source]: filter } as SearchFilterState));
      }}
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
      onSearch={onSearch}
      onSearchFilterApply={jest.fn()}
      onSearchSourceChange={jest.fn()}
    />
  );
}

function renderSearchScreen(overrides: Partial<React.ComponentProps<typeof SearchScreen>> = {}) {
  const props: React.ComponentProps<typeof SearchScreen> = {
    busy: false,
    categories,
    query: 'codex',
    recentSearches: [],
    topicStateIndex,
    searchFilters: DEFAULT_SEARCH_FILTERS,
    searchGroups: [],
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
    onSearch: jest.fn(),
    onSearchFilterApply: jest.fn(),
    onSearchSourceChange: jest.fn(),
    ...overrides
  };
  return render(<SearchScreen {...props} />);
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

  it('loads the next page for each result source independently', async () => {
    const onLoadMoreSearchSource = jest.fn<(source: Source, page: number) => void>();
    const view = await renderSearchScreen({
      onLoadMoreSearchSource,
      searchGroups: [
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
      ]
    });

    await fireEvent.press(view.getByText('加载更多 linux.do'));
    expect(onLoadMoreSearchSource).toHaveBeenLastCalledWith('linuxdo', 7);
    expect(view.getByText('加载更多 V2EX')).toBeTruthy();

    await fireEvent.press(view.getByText('加载更多 V2EX'));
    expect(onLoadMoreSearchSource).toHaveBeenLastCalledWith('v2ex', 2);
    expect(onLoadMoreSearchSource).toHaveBeenCalledTimes(2);
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
    expect(view.getByText('加载更多 V2EX')).toBeTruthy();

    await fireEvent.press(view.getByText('加载更多 V2EX'));
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
    expect(view.queryByText('加载更多 V2EX')).toBeNull();
  });

  it('applies linux.do, NodeSeek and Yaohuo filters without leaking state between sites', async () => {
    const view = await render(<SearchHarness initialSource="linuxdo" />);

    await fireEvent.press(view.getByLabelText('打开搜索筛选，当前默认'));
    await fireEvent.press(view.getByText('标题'));
    await fireEvent.press(view.getByText('开发调优'));
    await fireEvent.changeText(view.getByPlaceholderText('例如 人工智能'), '人工智能');
    await fireEvent.changeText(view.getByPlaceholderText('linux.do 用户名'), 'alice');
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
