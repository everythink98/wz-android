import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, within } from '../render';
import React, { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { defaultFeedFilters } from '@/domain/forum/feedOptions';
import type { ReadingFilter } from '@/domain/forum/feed';
import type { Category, FeedFilterState, FeedSource, Source, SourceFeedFilter, Topic } from '@/domain/forum/models';

let mockTabViewProps: {
  initialLayout?: { width: number };
  lazy?: boolean;
  lazyPreloadDistance?: number;
  navigationState: { index: number; routes: { key: string }[] };
  onIndexChange: (index: number) => void;
  onSwipeEnd?: () => void;
  renderLazyPlaceholder?: (input: { route: { key: string } }) => React.ReactNode;
  renderScene: (input: { route: { key: string } }) => React.ReactNode;
} | null = null;
let mockFlashListMountCount = 0;
const mockFlashListRenderItemByTopicId = new Map<string, unknown>();
const mockFlashListScrollToOffset = jest.fn<(options: { animated: boolean; offset: number }) => void>();

beforeEach(() => {
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 0);
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { ScrollView: NativeScrollView, View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    useMappingHelper: () => ({ getMappingKey: (_item: unknown, index: number) => String(index) }),
    FlashList: ReactModule.forwardRef(function FlashList(
      {
        accessibilityElementsHidden,
        data,
        importantForAccessibility,
        keyExtractor,
        ListEmptyComponent,
        ListFooterComponent,
        ListHeaderComponent,
        onLoad,
        onScroll,
        onScrollBeginDrag,
        pointerEvents,
        refreshControl,
        renderItem,
        testID
      }: {
        accessibilityElementsHidden?: boolean;
        data: Topic[];
        importantForAccessibility?: React.ComponentProps<typeof NativeScrollView>['importantForAccessibility'];
        keyExtractor?: (item: Topic, index: number) => string;
        ListEmptyComponent?: React.ReactNode;
        ListFooterComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        onLoad?: () => void;
        onScroll?: React.ComponentProps<typeof NativeScrollView>['onScroll'];
        onScrollBeginDrag?: () => void;
        pointerEvents?: React.ComponentProps<typeof NativeScrollView>['pointerEvents'];
        refreshControl?: React.ReactNode;
        renderItem?: (info: { item: Topic; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToOffset: (options: { animated: boolean; offset: number }) => void }>
    ) {
      if (data[0]) {
        mockFlashListRenderItemByTopicId.set(data[0].id, renderItem);
      }
      const [offsetY, setOffsetY] = ReactModule.useState(0);
      ReactModule.useState(() => {
        mockFlashListMountCount += 1;
        return undefined;
      });
      ReactModule.useEffect(() => onLoad?.(), [onLoad]);
      ReactModule.useImperativeHandle(ref, () => ({
        scrollToOffset: (options: { animated: boolean; offset: number }) => {
          mockFlashListScrollToOffset(options);
          setOffsetY(options.offset);
        }
      }));
      const handleScroll: React.ComponentProps<typeof NativeScrollView>['onScroll'] = (event) => {
        setOffsetY(event.nativeEvent.contentOffset.y);
        onScroll?.(event);
      };
      return ReactModule.createElement(
        NativeScrollView,
        {
          accessibilityLabel: refreshControl ? '列表，支持下拉刷新' : '列表，无下拉刷新',
          accessibilityElementsHidden,
          importantForAccessibility,
          onScroll: handleScroll,
          onScrollBeginDrag,
          pointerEvents,
          testID
        },
        refreshControl,
        ListHeaderComponent,
        data.length > 0 && offsetY === 0
          ? ReactModule.createElement(NativeView, { testID: 'mock-feed-first-visible' })
          : null,
        ...data.map((item, index) =>
          ReactModule.createElement(
            NativeView,
            { key: keyExtractor?.(item, index) ?? index },
            renderItem?.({ item, index })
          )
        ),
        data.length === 0 ? ListEmptyComponent : null,
        ListFooterComponent
      );
    })
  };
});

jest.mock('react-native-tab-view', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    TabView: (props: {
      initialLayout?: { width: number };
      lazy?: boolean;
      lazyPreloadDistance?: number;
      navigationState: { index: number; routes: { key: string }[] };
      onIndexChange: (index: number) => void;
      onSwipeEnd?: () => void;
      renderLazyPlaceholder?: (input: { route: { key: string } }) => React.ReactNode;
      renderScene: (input: { route: { key: string } }) => React.ReactNode;
    }) => {
      mockTabViewProps = props;
      return ReactModule.createElement(
        ReactModule.Fragment,
        null,
        ...props.navigationState.routes.map((route) =>
          ReactModule.createElement(
            NativeView,
            { key: route.key, testID: `mock-feed-scene-${route.key}` },
            props.renderScene({ route })
          )
        )
      );
    }
  };
});

jest.mock('lucide-react-native', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    ChevronDown: () => null,
    ChevronUp: () => null,
    Eye: () => ReactModule.createElement(NativeView, { accessibilityLabel: '浏览统计图标' }),
    MessageCircle: () => ReactModule.createElement(NativeView, { accessibilityLabel: '回复统计图标' })
  };
});

jest.mock('@/ui/avatar/Avatar', () => {
  const ReactModule = require('react') as typeof React;
  const { Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    Avatar: ({ contentSource }: { contentSource?: string }) =>
      ReactModule.createElement(
        NativeText,
        { accessibilityLabel: `avatar source ${contentSource || 'missing'}` },
        '头像'
      )
  };
});

const readerData = createEmptyReaderData();
const defaultEnabledFeedSources = projectContentSourcePreferences(readerData.settings.contentSources).feedSources;
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
  overrides: Partial<React.ComponentProps<typeof FeedScreen>> & {
    enabledFeedSources?: readonly Source[];
    onManageContentSources?: () => void;
  } = {}
) {
  return (
    <FeedScreen
      busy={busy}
      categories={[]}
      categoryFilter=""
      feedOutcomeKind={busy ? undefined : feedItems.length ? 'data' : 'empty'}
      feedHasMore={false}
      feedItems={feedItems}
      feedPage={1}
      feedFilters={defaultFeedFilters}
      feedSource="all"
      enabledFeedSources={defaultEnabledFeedSources}
      loadMoreFailureSignal={0}
      loadingMore={false}
      topicStateIndex={topicStateIndex}
      readingFilter="all"
      refreshing={false}
      onCategoryChange={jest.fn()}
      onFeedFilterChange={jest.fn()}
      onFeedSourceChange={jest.fn()}
      onManageContentSources={jest.fn()}
      onLoadMore={jest.fn()}
      onOpenTopic={jest.fn()}
      onReadingFilterChange={jest.fn()}
      onRefresh={jest.fn()}
      {...overrides}
    />
  );
}

async function settlePager() {
  await act(async () => mockTabViewProps?.onSwipeEnd?.());
}

describe('feed initial content readiness', () => {
  it('[REG-PERF-014] reports readiness only after a terminal FlashList has loaded', async () => {
    const onInitialContentReady = jest.fn();
    const view = await render(renderFeed(true, [], { onInitialContentReady }));

    expect(onInitialContentReady).not.toHaveBeenCalled();
    await view.rerender(renderFeed(false, [], { onInitialContentReady }));

    expect(onInitialContentReady).toHaveBeenCalledTimes(1);
  });
});

function FeedSourceHarness({ onSourceChange }: { onSourceChange?: (source: FeedSource) => void }) {
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  return renderFeed(false, [topic], {
    feedSource,
    onFeedSourceChange: (source) => {
      onSourceChange?.(source);
      setFeedSource(source);
    }
  });
}

function FeedFilterHarness() {
  const [{ categoryFilter, feedSource }, setFeedSelection] = useState<{
    categoryFilter: string;
    feedSource: FeedSource;
  }>({
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
      setFeedFilters((current) => ({ ...current, [feedSource]: filter }) as FeedFilterState);
    }
  };

  return (
    <FeedScreen
      busy={false}
      categories={categories}
      categoryFilter={categoryFilter}
      feedFilter={
        feedSource === 'v2ex' || feedSource === 'linuxdo' || feedSource === 'nodeseek'
          ? feedFilters[feedSource]
          : undefined
      }
      feedOutcomeKind="data"
      feedHasMore={false}
      feedItems={[topic]}
      feedPage={1}
      feedFilters={feedFilters}
      feedSource={feedSource}
      enabledFeedSources={defaultEnabledFeedSources}
      loadMoreFailureSignal={0}
      loadingMore={false}
      topicStateIndex={topicStateIndex}
      readingFilter={readingFilter}
      refreshing={false}
      onCategoryChange={(value) => setFeedSelection((current) => ({ ...current, categoryFilter: value }))}
      onFeedFilterChange={changeFeedFilter}
      onFeedSourceChange={changeSource}
      onManageContentSources={jest.fn()}
      onLoadMore={jest.fn()}
      onOpenTopic={jest.fn()}
      onReadingFilterChange={setReadingFilter}
      onRefresh={jest.fn()}
    />
  );
}

function FeedSortHarness({ onFilterChange }: { onFilterChange: (filter: SourceFeedFilter) => void }) {
  const [filter, setFilter] = useState<SourceFeedFilter>('postTime');
  return renderFeed(false, [{ ...topic, source: 'nodeseek' }], {
    feedFilter: filter,
    feedSource: 'nodeseek',
    onFeedFilterChange: (value) => {
      onFilterChange(value);
      setFilter(value);
    }
  });
}

describe('Feed loading', () => {
  it('[REG-NAV-002] opens a list topic only once when the card is pressed twice before navigation settles', async () => {
    const onOpenTopic = jest.fn();
    const view = await render(renderFeed(false, [topic], { onOpenTopic }));
    const topicCard = view.getByTestId('feed-topic-first');
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    await fireEvent.press(topicCard);
    await fireEvent.press(topicCard);

    expect(onOpenTopic).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_500);
    await fireEvent.press(topicCard);
    expect(onOpenTopic).toHaveBeenCalledTimes(2);
  });

  it('[REG-FEED-016] keeps the home source tabs at the old compact 100% geometry', async () => {
    const view = await render(renderFeed(false, [topic]));
    const tabStyle = StyleSheet.flatten(view.getByTestId('feed-source-all').props.style);

    expect(tabStyle.minHeight).toBe(40);
    expect(tabStyle.minWidth).toBeUndefined();
    expect(StyleSheet.flatten(within(view.getByTestId('feed-source-all')).getByText('全部').props.style).fontSize).toBe(
      13
    );
  });

  it('[REG-SOURCE-010] renders the enabled sources in user order and exposes a recoverable all-disabled state', async () => {
    const onManageContentSources = jest.fn();
    const onFeedSourceChange = jest.fn();
    const view = await render(
      renderFeed(false, [topic], {
        enabledFeedSources: ['nodeseek', 'v2ex'],
        feedSource: 'v2ex',
        onFeedSourceChange,
        onManageContentSources
      })
    );

    expect(mockTabViewProps?.navigationState.routes.map((route) => route.key)).toEqual(['all', 'nodeseek', 'v2ex']);
    expect(view.getAllByTestId(/^feed-source-/).map((tab) => tab.props.testID)).toEqual([
      'feed-source-all',
      'feed-source-nodeseek',
      'feed-source-v2ex'
    ]);
    expect(view.queryByTestId('feed-source-linuxdo')).toBeNull();
    expect(view.getByTestId('feed-source-v2ex').props.accessibilityState).toMatchObject({ selected: true });

    await view.rerender(
      renderFeed(false, [topic], {
        enabledFeedSources: ['v2ex', 'nodeseek'],
        feedSource: 'v2ex',
        onFeedSourceChange,
        onManageContentSources
      })
    );

    expect(mockTabViewProps?.navigationState.routes.map((route) => route.key)).toEqual(['all', 'v2ex', 'nodeseek']);
    expect(view.getByTestId('feed-source-v2ex').props.accessibilityState).toMatchObject({ selected: true });
    expect(onFeedSourceChange).not.toHaveBeenCalled();

    await view.rerender(
      renderFeed(false, [topic], {
        enabledFeedSources: [],
        feedOutcomeKind: 'empty',
        onManageContentSources
      })
    );

    expect(mockTabViewProps?.navigationState.routes.map((route) => route.key)).toEqual(['all']);
    expect(view.queryByText('topic')).toBeNull();
    expect(view.getByText('尚未启用内容源')).toBeTruthy();
    expect(view.queryByLabelText('列表，支持下拉刷新')).toBeNull();
    await fireEvent.press(view.getByLabelText('前往更多管理'));
    expect(onManageContentSources).toHaveBeenCalledTimes(1);
  });

  it('[REG-PERF-006] updates both Feed rails when the native pager selects the target', async () => {
    const onFeedSourceChange = jest.fn();
    const view = await render(
      renderFeed(false, [topic], {
        categories,
        onFeedSourceChange
      })
    );

    expect(view.getByTestId('feed-source-all').props.accessibilityState).toMatchObject({ selected: true });
    expect(view.getByText('未读')).toBeTruthy();

    await act(async () => mockTabViewProps?.onIndexChange(1));

    expect(view.getByTestId('feed-source-v2ex').props.accessibilityState).toMatchObject({ selected: true });
    expect(view.queryByText('未读')).toBeNull();
    expect(view.getByText('问与答')).toBeTruthy();
    expect(onFeedSourceChange).not.toHaveBeenCalled();
  });

  it('[REG-PERF-006] shows the target source saved sort before the active source commits', async () => {
    const view = await render(
      renderFeed(false, [topic], {
        categories,
        feedFilters: { ...defaultFeedFilters, v2ex: 'latest' }
      })
    );

    await act(async () => mockTabViewProps?.onIndexChange(1));

    expect(view.getByLabelText('列表筛选')).toBeTruthy();
    expect(view.getByText('最新')).toBeTruthy();
  });

  it('[REG-PERF-006] keeps the target secondary rail read-only until the source commits', async () => {
    const onCategoryChange = jest.fn();
    const onFeedSourceChange = jest.fn();
    const view = await render(
      renderFeed(false, [topic], {
        categories,
        onCategoryChange,
        onFeedSourceChange
      })
    );

    await act(async () => mockTabViewProps?.onIndexChange(1));
    expect(view.getByText('问与答').parent?.props.accessibilityState).toMatchObject({
      selected: false,
      disabled: true
    });
    expect(view.getByLabelText('列表筛选').props.accessibilityState).toMatchObject({ expanded: false, disabled: true });
    await fireEvent.press(view.getByText('问与答'));

    expect(onCategoryChange).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('feed-source-linuxdo'));
    expect(view.getByTestId('feed-source-linuxdo').props.accessibilityState).toMatchObject({ selected: true });
    expect(onFeedSourceChange).not.toHaveBeenCalled();

    await settlePager();

    expect(onFeedSourceChange).toHaveBeenCalledWith('linuxdo');
  });

  it('[REG-PERF-003] activates a selected source only after the native pager becomes idle', async () => {
    const onFeedSourceChange = jest.fn();
    await render(renderFeed(false, [topic], { onFeedSourceChange }));

    await act(async () => mockTabViewProps?.onIndexChange(1));

    expect(onFeedSourceChange).not.toHaveBeenCalled();

    await act(async () => mockTabViewProps?.onSwipeEnd?.());

    expect(onFeedSourceChange).toHaveBeenCalledTimes(1);
    expect(onFeedSourceChange).toHaveBeenCalledWith('v2ex');
  });

  it('[REG-PERF-003] lays out a cold adjacent scene before the swipe selects it', async () => {
    const onFeedSourceChange = jest.fn();
    const view = await render(renderFeed(false, [topic], { onFeedSourceChange }));
    const incomingScene = () => within(view.getByTestId('mock-feed-scene-v2ex'));

    expect(incomingScene().getByText('正在读取主题...')).toBeTruthy();
    expect(view.queryByText('正在切换来源...')).toBeNull();
    expect(mockTabViewProps).toMatchObject({
      initialLayout: { width: expect.any(Number) },
      lazy: true,
      lazyPreloadDistance: 1
    });

    await act(async () => mockTabViewProps?.onIndexChange(1));

    expect(onFeedSourceChange).not.toHaveBeenCalled();
    expect(incomingScene().getByText('正在读取主题...')).toBeTruthy();
  });

  it('[REG-PERF-003][REG-PERF-004][REG-PERF-006] keeps inactive sources lightweight and mounts one rich list', async () => {
    const onFeedSourceChange = jest.fn();
    const freshV2exTopic: Topic = {
      ...topic,
      source: 'v2ex',
      id: 'v2ex-fresh',
      title: 'V2EX 新请求主题',
      url: 'https://www.v2ex.com/t/v2ex-fresh'
    };
    mockFlashListMountCount = 0;
    const view = await render(
      renderFeed(false, [topic], {
        onFeedSourceChange
      })
    );
    const incomingScene = within(view.getByTestId('mock-feed-scene-v2ex'));

    expect(incomingScene.getByText('正在读取主题...')).toBeTruthy();
    expect(incomingScene.queryByText('V2EX 新请求主题', { includeHiddenElements: true })).toBeNull();
    expect(mockFlashListMountCount).toBe(1);

    await act(async () => mockTabViewProps?.onIndexChange(1));

    expect(mockFlashListMountCount).toBe(1);
    expect(incomingScene.getByText('正在读取主题...')).toBeTruthy();

    await settlePager();
    await view.rerender(
      renderFeed(false, [freshV2exTopic], {
        feedSource: 'v2ex',
        onFeedSourceChange
      })
    );

    expect(mockFlashListMountCount).toBe(2);
    expect(within(view.getByTestId('mock-feed-scene-v2ex')).getByText('V2EX 新请求主题')).toBeTruthy();
  });

  it('[REG-FEED-013] keeps the prelaid loading scene mounted until the target source has data', async () => {
    const onFeedSourceChange = jest.fn();
    mockFlashListMountCount = 0;
    const view = await render(renderFeed(false, [topic], { onFeedSourceChange }));

    expect(mockFlashListMountCount).toBe(1);
    await act(async () => mockTabViewProps?.onIndexChange(1));
    await settlePager();
    await view.rerender(
      renderFeed(true, [], {
        feedSource: 'v2ex',
        onFeedSourceChange
      })
    );

    expect(within(view.getByTestId('mock-feed-scene-v2ex')).getByText('正在读取主题...')).toBeTruthy();
    expect(mockFlashListMountCount).toBe(1);

    await view.rerender(
      renderFeed(
        false,
        [
          {
            ...topic,
            source: 'v2ex',
            id: 'v2ex-loaded',
            title: 'V2EX 已加载主题',
            url: 'https://www.v2ex.com/t/v2ex-loaded'
          }
        ],
        {
          feedSource: 'v2ex',
          onFeedSourceChange
        }
      )
    );

    expect(mockFlashListMountCount).toBe(2);
    expect(within(view.getByTestId('mock-feed-scene-v2ex')).getByText('V2EX 已加载主题')).toBeTruthy();
  });

  it('[REG-PERF-005] keeps the complete rich TopicCard presentation in Feed', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const richTopic: Topic = {
      source: 'linuxdo',
      id: 'rich-feed-topic',
      title: '完整列表样式',
      author: 'Q',
      authorLevelLabel: 'LV 2',
      category: '开发调优',
      url: 'https://linux.do/t/rich-feed-topic',
      createdAt: '2026-07-14T00:00:00.000Z',
      displayTimeText: '今天 08:00',
      replyCount: 23,
      viewCount: 456,
      excerpt: '宽松密度下显示的主题摘要',
      tags: ['Android', '测试', '回归', '第四个标签'],
      duplicateSources: ['V2EX', 'NodeSeek'],
      accessRequirement: {
        type: 'level',
        label: '等级限制',
        detail: '需要等级达到 2 才能查看'
      }
    };
    const view = await render(
      renderFeed(false, [richTopic], {
        topicStateIndex: {
          favorites: new Set(['linuxdo:rich-feed-topic']),
          history: new Set(['linuxdo:rich-feed-topic']),
          listDensity: 'loose'
        }
      })
    );
    const activeScene = within(view.getByTestId('mock-feed-scene-all'));

    const source = activeScene.getByText('linux.do');
    expect(source.props.style).toEqual(expect.arrayContaining([styles.topicSourceBadge]));
    expect(activeScene.getByText('开发调优')).toHaveStyle(styles.topicCategoryBadge);
    expect(activeScene.getByText('需 Lv2')).toHaveStyle(styles.topicAccessBadge);
    expect(activeScene.getByText('Android').props.style).toEqual(expect.arrayContaining([styles.topicTagText]));
    expect(activeScene.getByText('Android').parent?.props.style).toEqual(expect.arrayContaining([styles.topicTagPill]));
    expect(activeScene.getByText('测试')).toBeTruthy();
    expect(activeScene.getByText('回归')).toBeTruthy();
    expect(activeScene.queryByText('第四个标签')).toBeNull();
    expect(activeScene.getByText('+1')).toBeTruthy();
    expect(activeScene.getByText('Q · LV 2 · 已收藏 · 同链：V2EX、NodeSeek')).toBeTruthy();
    expect(activeScene.getByLabelText('avatar source linuxdo')).toBeTruthy();
    expect(activeScene.getByLabelText('回复统计图标')).toBeTruthy();
    expect(activeScene.getByLabelText('浏览统计图标')).toBeTruthy();
    expect(activeScene.getByText('23')).toBeTruthy();
    expect(activeScene.getByText('456')).toBeTruthy();
    expect(activeScene.getByText('宽松密度下显示的主题摘要')).toBeTruthy();
    const card = activeScene.getByTestId('feed-topic-first');
    expect(card.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gap: 10, paddingHorizontal: 16, paddingBottom: 14 }),
        expect.objectContaining({ opacity: 0.72 })
      ])
    );
    expect(card.props.nativeBackgroundAndroid).toBeDefined();
  });

  it('[REG-PERF-003] keeps a distant source-bar target lightweight until pager idle', async () => {
    const onFeedSourceChange = jest.fn();
    const sourceTopic = (source: Topic['source'], id: string, title: string): Topic => ({
      ...topic,
      source,
      id,
      title,
      url: `https://example.com/${id}`
    });
    mockFlashListMountCount = 0;
    const view = await render(
      renderFeed(false, [sourceTopic('nodeseek', 'node-live', 'NodeSeek 当前主题')], {
        feedSource: 'nodeseek',
        onFeedSourceChange
      })
    );

    expect(view.getAllByTestId(/^feed-outcome-/, { includeHiddenElements: true })).toHaveLength(1);
    const mountsBeforeSelection = mockFlashListMountCount;

    await fireEvent.press(view.getByTestId('feed-source-all'));

    expect(onFeedSourceChange).not.toHaveBeenCalled();
    expect(within(view.getByTestId('mock-feed-scene-all')).getByText('正在读取主题...')).toBeTruthy();
    expect(mockFlashListMountCount).toBe(mountsBeforeSelection);

    await settlePager();

    expect(onFeedSourceChange).toHaveBeenCalledTimes(1);
    expect(onFeedSourceChange).toHaveBeenCalledWith('all');
    await view.rerender(
      renderFeed(false, [sourceTopic('v2ex', 'all-fresh', '全部新请求主题')], {
        feedSource: 'all',
        onFeedSourceChange
      })
    );
    expect(within(view.getByTestId('mock-feed-scene-all')).getByText('全部新请求主题')).toBeTruthy();
    expect(mockFlashListMountCount).toBe(mountsBeforeSelection + 1);
  });

  it('[REG-PERF-003] renders the existing Loading state while a lazy scene materializes', async () => {
    await render(renderFeed(false, [topic]));

    const placeholder = mockTabViewProps?.renderLazyPlaceholder?.({ route: { key: 'linuxdo' } });
    expect(placeholder).toBeDefined();
    const placeholderView = await render(<>{placeholder}</>);

    expect(placeholderView.getByText('正在读取主题...')).toBeTruthy();
  });

  it('[REG-PERF-003] ignores a canceled swipe and commits only the final source', async () => {
    const onFeedSourceChange = jest.fn();
    const view = await render(<FeedSourceHarness onSourceChange={onFeedSourceChange} />);

    await settlePager();

    expect(onFeedSourceChange).not.toHaveBeenCalled();

    await act(async () => mockTabViewProps?.onIndexChange(1));
    await act(async () => mockTabViewProps?.onIndexChange(0));
    await settlePager();

    expect(onFeedSourceChange).not.toHaveBeenCalled();

    await act(async () => mockTabViewProps?.onIndexChange(3));
    await act(async () => mockTabViewProps?.onIndexChange(1));

    expect(onFeedSourceChange).not.toHaveBeenCalled();

    await settlePager();

    expect(onFeedSourceChange).toHaveBeenCalledTimes(1);
    expect(onFeedSourceChange).toHaveBeenCalledWith('v2ex');
    expect(view.getAllByTestId(/^feed-outcome-/, { includeHiddenElements: true })).toHaveLength(1);
  });

  it.each(['data', 'empty', 'partial', 'error', 'auth'] as const)(
    'exposes the settled %s outcome for the active source and filter',
    async (kind) => {
      const view = await render(
        renderFeed(false, kind === 'data' || kind === 'partial' ? [topic] : [], {
          feedFilter: 'postTime',
          feedOutcomeKind: kind,
          feedSource: 'nodeseek'
        })
      );

      expect(view.getByTestId(`feed-outcome-${kind}-nodeseek-postTime`)).toBeTruthy();
    }
  );

  it('does not expose a terminal outcome while loading', async () => {
    const view = await render(renderFeed(true, [topic], { feedOutcomeKind: 'data' }));

    expect(view.queryByTestId('feed-outcome-data-all-default')).toBeNull();
  });

  it('[REG-FEED-013] shows one stable loading scene before data and enables pull-to-refresh after data arrives', async () => {
    const view = await render(renderFeed(true, []));
    const activeScene = () => within(view.getByTestId('mock-feed-scene-all'));

    expect(activeScene().getByText('正在读取主题...')).toBeTruthy();
    expect(activeScene().queryByLabelText('列表，无下拉刷新')).toBeNull();

    await view.rerender(renderFeed(false, [topic]));

    expect(activeScene().queryByText('正在读取主题...')).toBeNull();
    expect(activeScene().getByLabelText('列表，支持下拉刷新')).toBeTruthy();
  });

  it('keeps the scrolled-list state when the same Feed screen is revisited', async () => {
    const view = await render(renderFeed(false, [topic]));

    await act(async () => {
      view.getByTestId('feed-outcome-data-all-default').props.onScroll({
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

  it('[REG-FEED-002] resets the stable list before and after changing the Feed filter', async () => {
    const frameCallbacks: ((time: number) => void)[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const onFilterChange = jest.fn<(filter: SourceFeedFilter) => void>();
    mockFlashListMountCount = 0;
    const view = await render(<FeedSortHarness onFilterChange={onFilterChange} />);

    expect(view.getByTestId('mock-feed-first-visible')).toBeTruthy();
    await act(async () => {
      fireEvent.scroll(view.getByTestId('feed-outcome-data-nodeseek-postTime'), {
        nativeEvent: {
          contentOffset: { y: 1200 },
          contentSize: { height: 3000 },
          layoutMeasurement: { height: 1000 }
        }
      });
    });
    expect(view.queryByTestId('mock-feed-first-visible')).toBeNull();
    const mountsBeforeFilterChange = mockFlashListMountCount;
    mockFlashListScrollToOffset.mockClear();

    await fireEvent.press(view.getByLabelText('列表筛选'));
    await fireEvent.press(view.getByText('新评论'));

    expect(onFilterChange).toHaveBeenCalledWith('replyTime');
    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(1);
    expect(mockFlashListScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(mockFlashListScrollToOffset.mock.invocationCallOrder[0]).toBeLessThan(
      onFilterChange.mock.invocationCallOrder[0]
    );
    expect(frameCallbacks).toHaveLength(1);
    expect(view.getByTestId('mock-feed-first-visible')).toBeTruthy();
    expect(mockFlashListMountCount).toBe(mountsBeforeFilterChange);

    await act(async () => frameCallbacks[0]?.(0));

    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(2);
  });

  it('[REG-FEED-002] resets stable lists for reading and category selections', async () => {
    const frameCallbacks: ((time: number) => void)[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    mockFlashListMountCount = 0;
    const view = await render(<FeedFilterHarness />);
    const scrollAway = async (testID: string) => {
      await act(async () => {
        view.getByTestId(testID).props.onScroll({
          nativeEvent: {
            contentOffset: { y: 640 },
            contentSize: { height: 1600 },
            layoutMeasurement: { height: 800 }
          }
        });
      });
      expect(view.queryByTestId('mock-feed-first-visible')).toBeNull();
    };

    await scrollAway('feed-outcome-data-all-default');
    let mountsBeforeSelection = mockFlashListMountCount;
    mockFlashListScrollToOffset.mockClear();

    await fireEvent.press(view.getByText('未读'));

    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(1);
    expect(mockFlashListMountCount).toBe(mountsBeforeSelection);
    expect(view.getByTestId('mock-feed-first-visible')).toBeTruthy();
    expect(frameCallbacks).toHaveLength(1);
    await act(async () => frameCallbacks.shift()?.(0));
    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(2);

    await fireEvent.press(view.getByTestId('feed-source-v2ex'));
    await settlePager();
    while (frameCallbacks.length > 0) {
      await act(async () => frameCallbacks.shift()?.(16));
    }
    await scrollAway('feed-outcome-data-v2ex-all');
    mountsBeforeSelection = mockFlashListMountCount;
    mockFlashListScrollToOffset.mockClear();

    await fireEvent.press(view.getByLabelText('问与答'));

    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(1);
    expect(mockFlashListMountCount).toBe(mountsBeforeSelection);
    expect(view.getByTestId('mock-feed-first-visible')).toBeTruthy();
    expect(frameCallbacks).toHaveLength(1);
    await act(async () => frameCallbacks.shift()?.(0));
    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(2);
  });

  it('requests each next page once and unlocks only after the page advances', async () => {
    const onLoadMore = jest.fn<() => void>();
    const view = await render(
      renderFeed(false, [topic], {
        feedHasMore: true,
        onLoadMore
      })
    );

    await fireEvent.press(view.getByText('加载第 2 页'));
    await fireEvent.press(view.getByText('加载第 2 页'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await view.rerender(
      renderFeed(false, [topic], {
        feedHasMore: true,
        loadingMore: true,
        onLoadMore
      })
    );
    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('正在加载...'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await view.rerender(
      renderFeed(false, [topic], {
        feedHasMore: true,
        feedPage: 2,
        onLoadMore
      })
    );
    await fireEvent.press(view.getByText('加载第 3 页'));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('pauses automatic pagination after failure until the user drags the list again', async () => {
    const onLoadMore = jest.fn<() => void>();
    const view = await render(
      renderFeed(false, [topic], {
        feedHasMore: true,
        onLoadMore
      })
    );
    await view.rerender(
      renderFeed(false, [topic], {
        feedHasMore: true,
        loadMoreFailureSignal: 1,
        onLoadMore
      })
    );
    const list = view.getByTestId('feed-outcome-data-all-default');
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

  it('[REG-FEED-003] keeps reading, category and per-site sort filters on their supported surfaces', async () => {
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
    await settlePager();
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
    await settlePager();
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
    await settlePager();
    await fireEvent.press(view.getByLabelText('列表筛选'));
    await fireEvent.press(view.getByText('新评论'));
    expect(view.getByText('新评论')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('日常'));
    expect(view.queryByLabelText('列表筛选')).toBeNull();

    await fireEvent.press(view.getByTestId('feed-source-yaohuo'));
    await settlePager();
    await fireEvent.press(view.getByLabelText('妖火茶馆'));
    expect(view.getByLabelText('妖火茶馆，已选择')).toBeTruthy();
    expect(view.queryByLabelText('列表筛选')).toBeNull();
  });
});
