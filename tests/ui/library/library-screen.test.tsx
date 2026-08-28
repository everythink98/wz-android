import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import type { LibraryTab } from '@/domain/forum/feed';
import { createEmptyReaderData, type FollowedUserRecord, type TopicRecord } from '@/domain/reader/readerData';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { Category, Topic, UserProfile, UserReference } from '@/domain/forum/models';
import type { Source } from '@/domain/forum/sourceCatalog';
import { PillRail } from '@/ui/controls/SelectionControls';

let mockFlashListMountCount = 0;
let mockFlashListUnmountCount = 0;
const mockFlashListRenders: { data: unknown[]; dataLength: number; testID?: string }[] = [];
const mockFlashListOnLoadByData = new Map<unknown[], (info: { elapsedTimeInMs: number }) => void>();
const mockFlashListScrollToOffset = jest.fn<(options: { animated: boolean; offset: number }) => void>();

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function FlashList(
      {
        data = [],
        drawDistance,
        keyExtractor,
        ListEmptyComponent,
        ListHeaderComponent,
        maintainVisibleContentPosition,
        onLoad,
        renderItem,
        testID
      }: {
        data?: unknown[];
        drawDistance?: number;
        keyExtractor?: (item: unknown, index: number) => string;
        ListEmptyComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        maintainVisibleContentPosition?: { disabled?: boolean };
        onLoad?: (info: { elapsedTimeInMs: number }) => void;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToOffset: (options: { animated: boolean; offset: number }) => void }>
    ) {
      ReactModule.useState(() => {
        mockFlashListMountCount += 1;
        return undefined;
      });
      ReactModule.useEffect(
        () => () => {
          mockFlashListUnmountCount += 1;
        },
        []
      );
      mockFlashListRenders.push({ data, dataLength: data.length, testID });
      if (onLoad) mockFlashListOnLoadByData.set(data, onLoad);
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: mockFlashListScrollToOffset }));
      return ReactModule.createElement(
        NativeView,
        { drawDistance, maintainVisibleContentPosition, testID } as React.ComponentProps<typeof NativeView>,
        ListHeaderComponent,
        ...data.map((item, index) =>
          ReactModule.createElement(
            NativeView,
            { key: keyExtractor?.(item, index) ?? index },
            renderItem?.({ item, index })
          )
        ),
        data.length ? null : ListEmptyComponent
      );
    })
  };
});

jest.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  Star: () => null,
  Trash2: () => null
}));

jest.mock('@/ui/topic/TopicCard', () => {
  const ReactModule = require('react') as typeof React;
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView
  } = require('react-native') as typeof import('react-native');
  return {
    MemoizedTopicCard: ({
      onOpenTopic,
      renderTrailingAction,
      testID,
      topic
    }: {
      onOpenTopic: (topic: Topic) => void;
      renderTrailingAction?: (topic: Topic) => React.ReactNode;
      testID?: string;
      topic: Topic;
    }) =>
      ReactModule.createElement(
        NativeView,
        null,
        ReactModule.createElement(
          NativePressable,
          { testID, onPress: () => onOpenTopic(topic) },
          ReactModule.createElement(NativeText, null, topic.title)
        ),
        renderTrailingAction?.(topic)
      )
  };
});

const readerData = createEmptyReaderData();
const topicStateIndex = createTopicListItemStateIndex(readerData);
const categories: Category[] = [
  { source: 'v2ex', id: 'qna', name: '问与答' },
  { source: 'v2ex', id: 'jobs', name: '酷工作' },
  { source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }
];

function topic(source: Topic['source'], id: string, title: string, categoryId: string, category: string): Topic {
  return {
    source,
    id,
    title,
    author: 'author',
    categoryId,
    category,
    url: `https://example.com/${id}`,
    createdAt: '2026-07-14T00:00:00.000Z',
    replyCount: 0
  };
}

const records: TopicRecord[] = [
  { topic: topic('v2ex', '1', 'V2EX 问答主题', 'qna', '问与答'), savedAt: '2026-07-14T10:00:00.000Z' },
  { topic: topic('v2ex', '2', 'V2EX 工作主题', 'jobs', '酷工作'), savedAt: '2026-07-14T09:00:00.000Z' },
  { topic: topic('linuxdo', '3', 'linux.do 开发主题', '4', '开发调优'), savedAt: '2026-07-14T08:00:00.000Z' }
];
const followedUsers: FollowedUserRecord[] = [
  {
    user: {
      source: 'v2ex',
      id: 'neo',
      username: 'neo',
      displayName: 'Neo',
      url: 'https://www.v2ex.com/member/neo',
      topics: []
    },
    followedAt: '2026-07-14T00:00:00.000Z'
  },
  {
    user: {
      source: 'linuxdo',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://linux.do/u/alice',
      topics: []
    },
    followedAt: '2026-07-14T00:00:00.000Z'
  }
];
const noop = () => undefined;
const noopTopic = (_topic: Topic) => undefined;
const noopLibraryTopic = (_topic: Topic, _section: 'favorites' | 'history') => undefined;
const noopUserReference = (_user: UserReference) => undefined;
const noopUserProfile = (_user: UserProfile) => undefined;

function LibraryHarness({
  active = true,
  enabledSources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'],
  followedUsers: libraryUsers = followedUsers,
  favoriteRecords = records,
  historyRecords = records,
  onClearHistory = noop,
  onManageContentSources = noop,
  onOpenTopic = noopTopic,
  onOpenUser = noopUserReference,
  onRemove = noopLibraryTopic,
  onRemoveUser = noopUserProfile
}: {
  active?: boolean;
  enabledSources?: readonly Source[];
  followedUsers?: FollowedUserRecord[];
  favoriteRecords?: TopicRecord[];
  historyRecords?: TopicRecord[];
  onClearHistory?: () => void;
  onManageContentSources?: () => void;
  onOpenTopic?: (topic: Topic) => void;
  onOpenUser?: (user: UserReference) => void;
  onRemove?: (topic: Topic, section: 'favorites' | 'history') => void;
  onRemoveUser?: (user: UserProfile) => void;
} = {}) {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  return (
    <View>
      <LibraryScreen
        active={active}
        categories={categories}
        enabledSources={enabledSources}
        favoriteRecords={favoriteRecords}
        followedUsers={libraryUsers}
        historyRecords={historyRecords}
        libraryTab={libraryTab}
        loaded
        topicStateIndex={topicStateIndex}
        onClearHistory={onClearHistory}
        onManageContentSources={onManageContentSources}
        onOpenTopic={onOpenTopic}
        onOpenUser={onOpenUser}
        onRemove={onRemove}
        onRemoveUser={onRemoveUser}
        onTabChange={setLibraryTab}
      />
    </View>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 1);
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

describe('Library filters', () => {
  it('projects source rails and local records in user order without mutating stored data, then restores re-enabled data', async () => {
    const recordsSnapshot = JSON.stringify(records);
    const recordReferences = [...records];
    const followedUsersSnapshot = JSON.stringify(followedUsers);
    const followedUserReferences = [...followedUsers];
    const view = await render(<LibraryHarness enabledSources={['linuxdo']} />);

    expect(
      view
        .getAllByRole('button')
        .map((button) => button.props.testID)
        .filter((testID) => String(testID).startsWith('library-source-'))
    ).toEqual(['library-source-all', 'library-source-linuxdo']);
    expect(view.queryByText('V2EX 问答主题')).toBeNull();
    expect(view.getByText('linux.do 开发主题')).toBeTruthy();
    expect(view.getByText('1 条')).toBeTruthy();

    await view.rerender(<LibraryHarness enabledSources={['v2ex', 'linuxdo']} />);
    expect(view.getByText('V2EX 问答主题')).toBeTruthy();
    expect(view.getByText('V2EX 工作主题')).toBeTruthy();
    expect(view.getByText('linux.do 开发主题')).toBeTruthy();
    expect(JSON.stringify(records)).toBe(recordsSnapshot);
    expect(records).toEqual(recordReferences);
    expect(records.every((record, index) => record === recordReferences[index])).toBe(true);

    await fireEvent.press(view.getByTestId('library-tab-users'));
    await view.rerender(<LibraryHarness enabledSources={['linuxdo']} />);
    expect(view.queryByText('Neo')).toBeNull();
    expect(view.getByText('Alice')).toBeTruthy();
    await view.rerender(<LibraryHarness enabledSources={['linuxdo', 'v2ex']} />);
    expect(view.getByText('Neo')).toBeTruthy();
    expect(view.getByText('Alice')).toBeTruthy();
    expect(JSON.stringify(followedUsers)).toBe(followedUsersSnapshot);
    expect(followedUsers).toEqual(followedUserReferences);
    expect(followedUsers.every((record, index) => record === followedUserReferences[index])).toBe(true);
  });

  it('reorders the rail without changing selection, category or local data actions', async () => {
    const onClearHistory = jest.fn();
    const onRemove = jest.fn<(topic: Topic, section: 'favorites' | 'history') => void>();
    const onRemoveUser = jest.fn<(user: UserProfile) => void>();
    const view = await render(
      <LibraryHarness
        enabledSources={['v2ex', 'linuxdo']}
        onClearHistory={onClearHistory}
        onRemove={onRemove}
        onRemoveUser={onRemoveUser}
      />
    );
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    await fireEvent.press(view.getByTestId('library-category-menu-button'));
    await fireEvent.press(view.getByRole('menuitem', { name: '问与答' }));

    await view.rerender(
      <LibraryHarness
        enabledSources={['linuxdo', 'v2ex']}
        onClearHistory={onClearHistory}
        onRemove={onRemove}
        onRemoveUser={onRemoveUser}
      />
    );
    expect(view.getByTestId('library-source-v2ex').props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText('分类：问与答')).toBeTruthy();
    expect(
      view
        .getAllByRole('button')
        .map((button) => button.props.testID)
        .filter((testID) => String(testID).startsWith('library-source-'))
    ).toEqual(['library-source-all', 'library-source-linuxdo', 'library-source-v2ex']);
    expect(onClearHistory).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(onRemoveUser).not.toHaveBeenCalled();
  });

  it('returns a disabled active source to all, clears category selection and restores it only as unfiltered data', async () => {
    const view = await render(<LibraryHarness enabledSources={['v2ex', 'linuxdo']} />);
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    await fireEvent.press(view.getByTestId('library-category-menu-button'));
    await fireEvent.press(view.getByRole('menuitem', { name: '问与答' }));
    expect(view.getByText('1 / 3 条')).toBeTruthy();

    await view.rerender(<LibraryHarness enabledSources={['linuxdo']} />);
    expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.queryByTestId('library-source-v2ex')).toBeNull();
    expect(view.getByText('linux.do 开发主题')).toBeTruthy();
    expect(view.getByText('1 条')).toBeTruthy();
    expect(view.getByLabelText('分类：全部')).toBeTruthy();

    await view.rerender(<LibraryHarness enabledSources={['linuxdo', 'v2ex']} />);
    expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.getByText('3 条')).toBeTruthy();
    expect(view.getByText('V2EX 问答主题')).toBeTruthy();
    expect(view.getByText('V2EX 工作主题')).toBeTruthy();
  });

  it('shows management guidance with no destructive action when every source is disabled', async () => {
    const onClearHistory = jest.fn();
    const onManageContentSources = jest.fn();
    const onRemove = jest.fn<(topic: Topic) => void>();
    const onRemoveUser = jest.fn<(user: UserProfile) => void>();
    const view = await render(
      <LibraryHarness
        enabledSources={[]}
        onClearHistory={onClearHistory}
        onManageContentSources={onManageContentSources}
        onRemove={onRemove}
        onRemoveUser={onRemoveUser}
      />
    );

    expect(
      view
        .getAllByRole('button')
        .map((button) => button.props.testID)
        .filter((testID) => String(testID).startsWith('library-source-'))
    ).toEqual(['library-source-all']);
    expect(view.getByText('尚未启用内容源')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('管理内容源'));
    expect(onManageContentSources).toHaveBeenCalledTimes(1);
    expect(view.queryByText('V2EX 问答主题')).toBeNull();

    await fireEvent.press(view.getByTestId('library-tab-history'));
    expect(view.getByText('尚未启用内容源')).toBeTruthy();
    expect(view.queryByLabelText('清空历史')).toBeNull();
    expect(onClearHistory).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(onRemoveUser).not.toHaveBeenCalled();
  });

  it('gives each tab one stable viewport while Library stays focused', async () => {
    mockFlashListMountCount = 0;
    const view = await render(<LibraryHarness />);

    expect(mockFlashListMountCount).toBe(1);
    await fireEvent.press(view.getByTestId('library-tab-users'));
    await fireEvent.press(view.getByTestId('library-tab-history'));
    await fireEvent.press(view.getByTestId('library-tab-favorites'));

    expect(mockFlashListMountCount).toBe(3);
  });

  it('prewarms one viewport per loaded frame and releases inactive viewports on blur', async () => {
    const frameCallbacks: ((time: number) => void)[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    mockFlashListMountCount = 0;
    mockFlashListUnmountCount = 0;
    mockFlashListRenders.length = 0;
    mockFlashListOnLoadByData.clear();
    const view = await render(<LibraryHarness historyRecords={records.slice(0, 2)} />);
    const favoriteData = mockFlashListRenders.find(
      (renderState) => renderState.testID === 'library-favorites-ready'
    )?.data;

    expect(mockFlashListMountCount).toBe(1);
    await act(async () => mockFlashListOnLoadByData.get(favoriteData || [])?.({ elapsedTimeInMs: 1 }));
    expect(frameCallbacks).toHaveLength(1);
    await act(async () => frameCallbacks.shift()?.(0));
    expect(mockFlashListMountCount).toBe(2);
    const historyData = mockFlashListRenders.find((renderState) => renderState.dataLength === 3)?.data;

    await act(async () => mockFlashListOnLoadByData.get(historyData || [])?.({ elapsedTimeInMs: 1 }));
    expect(frameCallbacks).toHaveLength(1);
    await act(async () => frameCallbacks.shift()?.(0));
    expect(mockFlashListMountCount).toBe(3);
    expect(view.queryByTestId('library-history-viewport')).toBeNull();
    expect(view.getByTestId('library-history-viewport', { includeHiddenElements: true })).toBeTruthy();

    mockFlashListUnmountCount = 0;
    await view.rerender(<LibraryHarness active={false} historyRecords={records.slice(0, 2)} />);
    expect(mockFlashListUnmountCount).toBe(2);
    expect(view.queryByTestId('library-history-viewport', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByTestId('library-users-viewport', { includeHiddenElements: true })).toBeNull();
  });

  it('retains each populated dataset item array across tab switches', async () => {
    mockFlashListRenders.length = 0;
    const view = await render(<LibraryHarness />);
    const firstFavoriteData = mockFlashListRenders.find(
      (renderState) => renderState.testID === 'library-favorites-ready'
    )?.data;

    await fireEvent.press(view.getByTestId('library-tab-history'));
    const firstHistoryData = mockFlashListRenders.find(
      (renderState) => renderState.testID === 'library-history-ready'
    )?.data;
    await fireEvent.press(view.getByTestId('library-tab-favorites'));
    await fireEvent.press(view.getByTestId('library-tab-history'));

    expect(
      mockFlashListRenders.filter((renderState) => renderState.testID === 'library-favorites-ready').at(-1)?.data
    ).toBe(firstFavoriteData);
    expect(
      mockFlashListRenders.filter((renderState) => renderState.testID === 'library-history-ready').at(-1)?.data
    ).toBe(firstHistoryData);
  });

  it('changes viewport visibility without rendering either populated FlashList again', async () => {
    const view = await render(<LibraryHarness />);
    await fireEvent.press(view.getByTestId('library-tab-history'));
    await fireEvent.press(view.getByTestId('library-tab-favorites'));
    mockFlashListRenders.length = 0;

    await fireEvent.press(view.getByTestId('library-tab-history'));
    await fireEvent.press(view.getByTestId('library-tab-favorites'));

    expect(mockFlashListRenders).toHaveLength(0);
  });

  it('reuses positional pill nodes when a source swaps the category taxonomy', async () => {
    const onChange = jest.fn();
    const view = await render(
      <PillRail
        items={[
          { value: 'all', label: '全部' },
          { value: 'first-a', label: '分类 A' },
          { value: 'first-b', label: '分类 B' }
        ]}
        testIDPrefix="perf-category"
        value="all"
        onChange={onChange}
      />
    );
    const secondSlot = view.getByTestId('perf-category-first-a');

    await view.rerender(
      <PillRail
        items={[
          { value: 'all', label: '全部' },
          { value: 'second-a', label: '另一分类 A' },
          { value: 'second-b', label: '另一分类 B' }
        ]}
        testIDPrefix="perf-category"
        value="all"
        onChange={onChange}
      />
    );

    expect(view.getByTestId('perf-category-second-a')).toBe(secondSlot);
  });

  it('keeps one fixed category button across source taxonomies', async () => {
    const view = await render(<LibraryHarness />);
    const categoryButton = view.getByTestId('library-category-menu-button');

    expect(view.queryByRole('menuitem')).toBeNull();
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    expect(view.getByTestId('library-category-menu-button')).toBe(categoryButton);
    await fireEvent.press(view.getByTestId('library-source-linuxdo'));
    expect(view.getByTestId('library-category-menu-button')).toBe(categoryButton);
    expect(view.queryByRole('menuitem')).toBeNull();
  });

  it('keeps the category button mounted but inaccessible while followed users are selected', async () => {
    const view = await render(<LibraryHarness />);
    const categoryButton = view.getByTestId('library-category-menu-button');

    await fireEvent.press(view.getByTestId('library-tab-users'));

    expect(view.queryByTestId('library-category-menu-button')).toBeNull();

    await fireEvent.press(view.getByTestId('library-tab-favorites'));

    expect(view.getByTestId('library-category-menu-button')).toBe(categoryButton);
  });

  it('enters the next tab with source and category filters already reset', async () => {
    const view = await render(<LibraryHarness />);
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    await fireEvent.press(view.getByTestId('library-category-menu-button'));
    await fireEvent.press(view.getByRole('menuitem', { name: '问与答' }));
    mockFlashListRenders.length = 0;

    await fireEvent.press(view.getByTestId('library-tab-history'));

    const historyRenders = mockFlashListRenders.filter((renderState) => renderState.testID === 'library-history-ready');
    expect(historyRenders).toHaveLength(1);
    expect(historyRenders[0]).toMatchObject({ dataLength: 4, testID: 'library-history-ready' });
  });

  it('resets the list position before switching tabs without animation', async () => {
    const frameCallbacks: ((time: number) => void)[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const view = await render(<LibraryHarness />);
    await fireEvent.press(view.getByTestId('library-tab-history'));
    await act(async () => frameCallbacks.shift()?.(0));
    await fireEvent.press(view.getByTestId('library-tab-favorites'));
    await act(async () => frameCallbacks.shift()?.(0));
    mockFlashListScrollToOffset.mockClear();

    await fireEvent.press(view.getByTestId('library-tab-history'));

    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(1);
    expect(mockFlashListScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(frameCallbacks).toHaveLength(1);
    await act(async () => frameCallbacks[0]?.(0));
    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(2);
  });

  it('leaves filters and position unchanged when the selected tab is pressed again', async () => {
    const view = await render(<LibraryHarness />);
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    await fireEvent.press(view.getByTestId('library-category-menu-button'));
    await fireEvent.press(view.getByRole('menuitem', { name: '问与答' }));
    mockFlashListScrollToOffset.mockClear();

    await fireEvent.press(view.getByTestId('library-tab-favorites'));

    expect(view.getByTestId('library-source-v2ex').props.accessibilityState.selected).toBe(true);
    expect(view.getByText('1 / 3 条')).toBeTruthy();
    expect(mockFlashListScrollToOffset).not.toHaveBeenCalled();
  });

  it('disables visible-position anchoring while library datasets switch', async () => {
    const view = await render(<LibraryHarness />);

    expect(view.getByTestId('library-favorites-ready').props.maintainVisibleContentPosition).toEqual({
      disabled: true
    });
    expect(view.getByTestId('library-favorites-ready').props.drawDistance).toBe(250);
  });

  it('settles all three tabs with an empty device library', async () => {
    const view = await render(<LibraryHarness favoriteRecords={[]} followedUsers={[]} historyRecords={[]} />);

    expect(view.getByTestId('library-favorites-ready')).toBeTruthy();
    expect(view.getByTestId('library-favorites-empty')).toBeTruthy();
    await fireEvent.press(view.getByTestId('library-tab-users'));
    expect(view.getByTestId('library-users-ready')).toBeTruthy();
    expect(view.getByText('这里还没有关注用户')).toBeTruthy();
    await fireEvent.press(view.getByTestId('library-tab-history'));
    expect(view.getByTestId('library-history-ready')).toBeTruthy();
    expect(view.getByText('这里还没有内容')).toBeTruthy();
  });

  it('requires destructive confirmation before removing a favorite or clearing history', async () => {
    const onClearHistory = jest.fn<() => void>();
    const onRemove = jest.fn<(topic: Topic) => void>();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(<LibraryHarness onClearHistory={onClearHistory} onRemove={onRemove} />);

    await fireEvent.press(view.getAllByLabelText('取消收藏')[0]);
    expect(alert).toHaveBeenNthCalledWith(1, '确定取消收藏吗？', 'V2EX 问答主题', expect.any(Array));
    expect(onRemove).not.toHaveBeenCalled();
    const removeButtons = alert.mock.calls[0]?.[2];
    removeButtons?.find((button) => button.text === '取消')?.onPress?.();
    expect(onRemove).not.toHaveBeenCalled();
    removeButtons?.find((button) => button.text === '确定')?.onPress?.();
    expect(onRemove).toHaveBeenCalledWith(records[0]?.topic, 'favorites');

    await fireEvent.press(view.getByTestId('library-tab-history'));
    await fireEvent.press(view.getByLabelText('清空历史'));
    expect(alert).toHaveBeenNthCalledWith(2, '清空历史？', '清空后无法恢复。', expect.any(Array));
    expect(onClearHistory).not.toHaveBeenCalled();
    const clearButtons = alert.mock.calls[1]?.[2];
    clearButtons?.find((button) => button.text === '取消')?.onPress?.();
    expect(onClearHistory).not.toHaveBeenCalled();
    clearButtons?.find((button) => button.text === '清空')?.onPress?.();
    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });

  it('applies single-item history and follow removals without opening the row', async () => {
    const onOpenTopic = jest.fn<(topic: Topic) => void>();
    const onOpenUser = jest.fn<(user: UserReference) => void>();
    const onRemove = jest.fn<(topic: Topic, section: 'favorites' | 'history') => void>();
    const onRemoveUser = jest.fn<(user: UserProfile) => void>();
    const view = await render(
      <LibraryHarness
        onOpenTopic={onOpenTopic}
        onOpenUser={onOpenUser}
        onRemove={onRemove}
        onRemoveUser={onRemoveUser}
      />
    );

    await fireEvent.press(view.getByTestId('library-tab-history'));
    await fireEvent.press(view.getAllByLabelText('删除')[0]);
    expect(onRemove).toHaveBeenCalledWith(records[0]?.topic, 'history');
    expect(onOpenTopic).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('library-tab-users'));
    await fireEvent.press(view.getAllByLabelText('取消关注')[0]);
    expect(onRemoveUser).toHaveBeenCalledWith(followedUsers[0]?.user);
    expect(onOpenUser).not.toHaveBeenCalled();
  });

  it('filters by source and category, then resets both when the tab changes', async () => {
    const view = await render(<LibraryHarness />);

    expect(view.getByText('3 条')).toBeTruthy();
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    expect(view.getByText('2 / 3 条')).toBeTruthy();
    expect(view.queryByText('linux.do 开发主题')).toBeNull();

    await fireEvent.press(view.getByTestId('library-category-menu-button'));
    await fireEvent.press(view.getByRole('menuitem', { name: '问与答' }));
    expect(view.getByText('1 / 3 条')).toBeTruthy();
    expect(view.getByText('V2EX 问答主题')).toBeTruthy();
    expect(view.queryByText('V2EX 工作主题')).toBeNull();

    await fireEvent.press(view.getByTestId('library-tab-users'));
    expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.queryByTestId('library-category-menu-button')).toBeNull();
    expect(view.getByText('2 / 2 人')).toBeTruthy();
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    expect(view.getByText('1 / 2 人')).toBeTruthy();
    expect(view.getByText('Neo')).toBeTruthy();
    expect(view.queryByText('Alice')).toBeNull();

    await fireEvent.press(view.getByTestId('library-tab-history'));
    expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.getAllByLabelText('全部，已选择')).toHaveLength(1);
    expect(view.getByLabelText('分类：全部')).toBeTruthy();
    expect(view.getByText('3 条')).toBeTruthy();
    await fireEvent.press(view.getByTestId('library-source-linuxdo'));
    await fireEvent.press(view.getByTestId('library-category-menu-button'));
    await fireEvent.press(view.getByRole('menuitem', { name: '开发调优' }));
    expect(view.getByText('1 / 3 条')).toBeTruthy();
    expect(view.getByText('linux.do 开发主题')).toBeTruthy();
    expect(view.queryByText('V2EX 问答主题')).toBeNull();
  });
});
