import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import React, { useState } from 'react';
import { createEmptyReaderData } from '../../src/readerData';
import { FeedScreen } from '../../src/screens/FeedScreen';
import { createStyles, createTheme } from '../../src/theme';
import { createTopicListItemStateIndex } from '../../src/topicListItemState';
import { defaultFeedFilters } from '../../src/feedCategoryRail';
import type { ReadingFilter } from '../../src/feedLogic';
import type { Category, FeedFilterState, FeedSource, SourceFeedFilter, Topic } from '../../src/types';

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { ScrollView: NativeScrollView, View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function FlashList(
      { data, ListEmptyComponent, ListFooterComponent, onScroll, onScrollBeginDrag, refreshControl, testID }: {
        data: unknown[];
        ListEmptyComponent?: React.ReactNode;
        ListFooterComponent?: React.ReactNode;
        onScroll?: React.ComponentProps<typeof NativeScrollView>['onScroll'];
        onScrollBeginDrag?: () => void;
        refreshControl?: React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToOffset: () => void }>
    ) {
      const [offsetY, setOffsetY] = ReactModule.useState(0);
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: () => undefined }));
      const handleScroll: React.ComponentProps<typeof NativeScrollView>['onScroll'] = (event) => {
        setOffsetY(event.nativeEvent.contentOffset.y);
        onScroll?.(event);
      };
      return ReactModule.createElement(
        NativeScrollView,
        {
          accessibilityLabel: refreshControl ? '列表，支持下拉刷新' : '列表，无下拉刷新',
          onScroll: handleScroll,
          onScrollBeginDrag,
          testID
        },
        refreshControl,
        data.length > 0 && offsetY === 0 ? ReactModule.createElement(NativeView, { testID: 'mock-feed-first-visible' }) : null,
        data.length === 0 ? ListEmptyComponent : null,
        ListFooterComponent
      );
    })
  };
});

jest.mock('react-native-tab-view', () => ({
  TabView: ({ navigationState, renderScene }: {
    navigationState: { index: number; routes: Array<{ key: string }> };
    renderScene: (input: { route: { key: string } }) => React.ReactNode;
  }) => renderScene({ route: navigationState.routes[navigationState.index] })
}));

jest.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  ChevronUp: () => null
}));

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const topicStateIndex = createTopicListItemStateIndex(readerData);
const topic: Topic = {
  source: 'v2ex',
  id: '1',
  title: 'topic',
  author: 'author',
  url: 'https://www.v2ex.com/t/1',
  createdAt: '2026-07-14T00:00:00.000Z',
  replyCount: 0
};
const categories: Category[] = [
  { source: 'v2ex', id: 'qna', name: '问与答' },
  { source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' },
  { source: 'nodeseek', id: 'daily', name: '日常' },
  { source: 'yaohuo', id: '177', name: '妖火茶馆' }
];

function renderFeed(
  busy: boolean,
  feedItems: Topic[],
  overrides: Partial<React.ComponentProps<typeof FeedScreen>> = {}
) {
  return (
    <FeedScreen
      busy={busy}
      categories={[]}
      categoryFilter=""
      feedHasMore={false}
      feedItems={feedItems}
      feedPage={1}
      feedSource="all"
      loadMoreFailureSignal={0}
      loadingMore={false}
      topicStateIndex={topicStateIndex}
      readingFilter="all"
      refreshing={false}
      scrollToTopSignal={0}
      styles={styles}
      theme={theme}
      onCategoryChange={jest.fn()}
      onFeedFilterChange={jest.fn()}
      onFeedSourceChange={jest.fn()}
      onLoadMore={jest.fn()}
      onOpenTopic={jest.fn()}
      onReadingFilterChange={jest.fn()}
      onRefresh={jest.fn()}
      {...overrides}
    />
  );
}

function FeedFilterHarness() {
  const [{ categoryFilter, feedSource }, setFeedSelection] = useState<{ categoryFilter: string; feedSource: FeedSource }>({
    categoryFilter: '',
    feedSource: 'all'
  });
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>({ ...defaultFeedFilters });
  const changeSource = (source: FeedSource) => {
    setFeedSelection({ categoryFilter: '', feedSource: source });
  };
  const changeFeedFilter = (filter: SourceFeedFilter) => {
    if (feedSource === 'v2ex' || feedSource === 'linuxdo' || feedSource === 'nodeseek') {
      setFeedFilters((current) => ({ ...current, [feedSource]: filter } as FeedFilterState));
    }
  };

  return (
    <FeedScreen
      busy={false}
      categories={categories}
      categoryFilter={categoryFilter}
      feedFilter={feedSource === 'v2ex' || feedSource === 'linuxdo' || feedSource === 'nodeseek' ? feedFilters[feedSource] : undefined}
      feedHasMore={false}
      feedItems={[topic]}
      feedPage={1}
      feedSource={feedSource}
      loadMoreFailureSignal={0}
      loadingMore={false}
      topicStateIndex={topicStateIndex}
      readingFilter={readingFilter}
      refreshing={false}
      scrollToTopSignal={0}
      styles={styles}
      theme={theme}
      onCategoryChange={(value) => setFeedSelection((current) => ({ ...current, categoryFilter: value }))}
      onFeedFilterChange={changeFeedFilter}
      onFeedSourceChange={changeSource}
      onLoadMore={jest.fn()}
      onOpenTopic={jest.fn()}
      onReadingFilterChange={setReadingFilter}
      onRefresh={jest.fn()}
    />
  );
}

describe('Feed loading', () => {
  it('shows one loading indicator before data and keeps pull-to-refresh after data arrives', async () => {
    const view = await render(renderFeed(true, []));

    expect(view.getAllByText('正在读取主题...')).toHaveLength(1);
    expect(view.getByLabelText('列表，无下拉刷新')).toBeTruthy();

    await view.rerender(renderFeed(false, [topic]));

    expect(view.queryByText('正在读取主题...')).toBeNull();
    expect(view.getByLabelText('列表，支持下拉刷新')).toBeTruthy();
  });

  it('keeps the scrolled-list state when the same Feed screen is revisited', async () => {
    const view = await render(renderFeed(false, [topic]));

    await act(async () => {
      view.getByTestId('feed-list-ready-all').props.onScroll({
        nativeEvent: {
          contentOffset: { y: 500 },
          contentSize: { height: 3000 },
          layoutMeasurement: { height: 1000 }
        }
      });
    });

    expect(view.getByLabelText('回到顶部')).toBeTruthy();

    await view.rerender(renderFeed(false, [topic]));

    expect(view.getByLabelText('回到顶部')).toBeTruthy();
  });

  it('[REG-FEED-002] resets the rendered list position when the Feed filter changes', async () => {
    const nodeSeekTopic: Topic = { ...topic, source: 'nodeseek' };
    const nodeSeekItems = [nodeSeekTopic];
    const callbacks = {
      onCategoryChange: jest.fn(),
      onFeedFilterChange: jest.fn(),
      onFeedSourceChange: jest.fn(),
      onLoadMore: jest.fn(),
      onOpenTopic: jest.fn(),
      onReadingFilterChange: jest.fn(),
      onRefresh: jest.fn()
    };
    const view = await render(renderFeed(false, nodeSeekItems, {
      ...callbacks,
      feedFilter: 'postTime',
      feedSource: 'nodeseek'
    }));

    expect(view.getByTestId('mock-feed-first-visible')).toBeTruthy();
    await act(async () => {
      fireEvent.scroll(view.getByTestId('feed-list-ready-nodeseek'), {
        nativeEvent: {
          contentOffset: { y: 1200 },
          contentSize: { height: 3000 },
          layoutMeasurement: { height: 1000 }
        }
      });
    });
    expect(view.queryByTestId('mock-feed-first-visible')).toBeNull();

    await view.rerender(renderFeed(false, nodeSeekItems, {
      ...callbacks,
      feedFilter: 'replyTime',
      feedSource: 'nodeseek'
    }));

    expect(view.getByTestId('mock-feed-first-visible')).toBeTruthy();
  });

  it('requests each next page once and unlocks only after the page advances', async () => {
    const onLoadMore = jest.fn<() => void>();
    const view = await render(renderFeed(false, [topic], {
      feedHasMore: true,
      onLoadMore
    }));

    await fireEvent.press(view.getByText('加载第 2 页'));
    await fireEvent.press(view.getByText('加载第 2 页'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await view.rerender(renderFeed(false, [topic], {
      feedHasMore: true,
      loadingMore: true,
      onLoadMore
    }));
    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('正在加载...'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await view.rerender(renderFeed(false, [topic], {
      feedHasMore: true,
      feedPage: 2,
      onLoadMore
    }));
    await fireEvent.press(view.getByText('加载第 3 页'));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('pauses automatic pagination after failure until the user drags the list again', async () => {
    const onLoadMore = jest.fn<() => void>();
    const view = await render(renderFeed(false, [topic], {
      feedHasMore: true,
      onLoadMore
    }));
    await view.rerender(renderFeed(false, [topic], {
      feedHasMore: true,
      loadMoreFailureSignal: 1,
      onLoadMore
    }));
    const list = view.getByTestId('feed-list-ready-all');
    const nearEndEvent = {
      nativeEvent: {
        contentOffset: { y: 900 },
        contentSize: { height: 1800 },
        layoutMeasurement: { height: 1000 }
      }
    };

    await act(async () => list.props.onScroll(nearEndEvent));
    expect(onLoadMore).not.toHaveBeenCalled();

    await act(async () => list.props.onScrollBeginDrag());
    await act(async () => list.props.onScroll(nearEndEvent));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an empty feed from a filter with no matching topics', async () => {
    const view = await render(renderFeed(false, []));

    expect(view.getByText('暂无主题')).toBeTruthy();

    await view.rerender(renderFeed(false, [], { readingFilter: 'unread' }));
    expect(view.queryByText('暂无主题')).toBeNull();
    expect(view.getByText('当前筛选没有匹配主题')).toBeTruthy();
  });

  it('keeps reading, category and per-site sort filters on their supported surfaces', async () => {
    const view = await render(<FeedFilterHarness />);

    await fireEvent.press(view.getByText('未读'));
    expect(view.getByLabelText('未读，已选择')).toBeTruthy();
    expect(view.queryByLabelText('列表筛选')).toBeNull();
    await fireEvent.press(view.getByText('已读'));
    expect(view.getByLabelText('已读，已选择')).toBeTruthy();
    await fireEvent.press(view.getByText('收藏'));
    expect(view.getByLabelText('收藏，已选择')).toBeTruthy();
    await fireEvent.press(view.getAllByLabelText('全部').at(-1)!);
    expect(view.getAllByLabelText('全部，已选择')).toHaveLength(2);

    await fireEvent.press(view.getByTestId('feed-source-v2ex'));
    await fireEvent.press(view.getByLabelText('列表筛选'));
    expect(view.getByText('最热')).toBeTruthy();
    await fireEvent.press(view.getByText('最新'));
    expect(view.getByText('最新')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('问与答'));
    expect(view.queryByLabelText('列表筛选')).toBeNull();
    await fireEvent.press(view.getAllByLabelText('全部').at(-1)!);
    expect(view.getByLabelText('列表筛选')).toBeTruthy();
    expect(view.getByText('最新')).toBeTruthy();

    await fireEvent.press(view.getByTestId('feed-source-linuxdo'));
    await fireEvent.press(view.getByLabelText('列表筛选'));
    expect(view.getByText('新')).toBeTruthy();
    expect(view.getByText('所有')).toBeTruthy();
    expect(view.getByText('话题')).toBeTruthy();
    expect(view.getByText('回复')).toBeTruthy();
    await fireEvent.press(view.getByText('所有'));
    expect(view.getByText('新·所有')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('列表筛选'));
    await fireEvent.press(view.getByText('热门'));
    await fireEvent.press(view.getByLabelText('开发调优'));
    expect(view.getByLabelText('列表筛选')).toBeTruthy();
    expect(view.getByText('热门')).toBeTruthy();

    await fireEvent.press(view.getByTestId('feed-source-nodeseek'));
    await fireEvent.press(view.getByLabelText('列表筛选'));
    await fireEvent.press(view.getByText('新评论'));
    expect(view.getByText('新评论')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('日常'));
    expect(view.queryByLabelText('列表筛选')).toBeNull();

    await fireEvent.press(view.getByTestId('feed-source-yaohuo'));
    await fireEvent.press(view.getByLabelText('妖火茶馆'));
    expect(view.getByLabelText('妖火茶馆，已选择')).toBeTruthy();
    expect(view.queryByLabelText('列表筛选')).toBeNull();
  });
});
