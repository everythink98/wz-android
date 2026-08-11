import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import type { LibraryTab } from '@/domain/forum/feed';
import { createEmptyReaderData, type FollowedUserRecord, type TopicRecord } from '@/domain/reader/readerData';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { Category, Topic, UserProfile, UserReference } from '@/domain/forum/models';
import type { Source } from '@/domain/forum/sourceCatalog';

let mockFlashListMountCount = 0;
const mockFlashListRenders: { dataLength: number; testID?: string }[] = [];
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
        renderItem,
        testID
      }: {
        data?: unknown[];
        drawDistance?: number;
        keyExtractor?: (item: unknown, index: number) => string;
        ListEmptyComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        maintainVisibleContentPosition?: { disabled?: boolean };
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToOffset: (options: { animated: boolean; offset: number }) => void }>
    ) {
      ReactModule.useState(() => {
        mockFlashListMountCount += 1;
        return undefined;
      });
      mockFlashListRenders.push({ dataLength: data.length, testID });
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

function LibraryHarness({
  enabledSources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo', 'xiaoyinsi'],
  followedUsers: libraryUsers = followedUsers,
  onClearHistory = jest.fn(),
  onManageContentSources = jest.fn(),
  onOpenTopic = jest.fn(),
  onOpenUser = jest.fn(),
  onRemove = jest.fn(),
  onRemoveUser = jest.fn(),
  records: libraryRecords = records
}: {
  enabledSources?: readonly Source[];
  followedUsers?: FollowedUserRecord[];
  onClearHistory?: () => void;
  onManageContentSources?: () => void;
  onOpenTopic?: (topic: Topic) => void;
  onOpenUser?: (user: UserReference) => void;
  onRemove?: (topic: Topic) => void;
  onRemoveUser?: (user: UserProfile) => void;
  records?: TopicRecord[];
} = {}) {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  return (
    <View>
      <LibraryScreen
        categories={categories}
        enabledSources={enabledSources}
        followedUsers={libraryUsers}
        libraryTab={libraryTab}
        loaded
        records={libraryRecords}
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

describe('Library filters', () => {
  it('projects source rails and local records in user order without mutating stored data, then restores re-enabled data', async () => {
    const recordsSnapshot = JSON.stringify(records);
    const recordReferences = [...records];
    const followedUsersSnapshot = JSON.stringify(followedUsers);
    const followedUserReferences = [...followedUsers];
    const view = await render(<LibraryHarness enabledSources={['xiaoyinsi', 'linuxdo']} />);

    expect(
      view
        .getAllByRole('button')
        .map((button) => button.props.testID)
        .filter((testID) => String(testID).startsWith('library-source-'))
    ).toEqual(['library-source-all', 'library-source-xiaoyinsi', 'library-source-linuxdo']);
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
    const onRemove = jest.fn<(topic: Topic) => void>();
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
    await fireEvent.press(view.getByLabelText('问与答'));

    await view.rerender(
      <LibraryHarness
        enabledSources={['linuxdo', 'v2ex']}
        onClearHistory={onClearHistory}
        onRemove={onRemove}
        onRemoveUser={onRemoveUser}
      />
    );
    expect(view.getByTestId('library-source-v2ex').props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText('问与答，已选择')).toBeTruthy();
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
    await fireEvent.press(view.getByLabelText('问与答'));
    expect(view.getByText('1 / 3 条')).toBeTruthy();

    await view.rerender(<LibraryHarness enabledSources={['linuxdo']} />);
    expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.queryByTestId('library-source-v2ex')).toBeNull();
    expect(view.getByText('linux.do 开发主题')).toBeTruthy();
    expect(view.getByText('1 条')).toBeTruthy();
    expect(view.getByLabelText('问与答').props.accessibilityState.selected).toBe(false);

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

  it('[REG-PERF-001] reuses the list while switching between all three library tabs', async () => {
    mockFlashListMountCount = 0;
    const view = await render(<LibraryHarness />);

    expect(mockFlashListMountCount).toBe(1);
    await fireEvent.press(view.getByTestId('library-tab-users'));
    await fireEvent.press(view.getByTestId('library-tab-history'));
    await fireEvent.press(view.getByTestId('library-tab-favorites'));

    expect(mockFlashListMountCount).toBe(1);
  });

  it('[REG-PERF-001] enters the next tab with source and category filters already reset', async () => {
    const view = await render(<LibraryHarness />);
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    await fireEvent.press(view.getByLabelText('问与答'));
    mockFlashListRenders.length = 0;

    await fireEvent.press(view.getByTestId('library-tab-history'));

    const historyRenders = mockFlashListRenders.filter((renderState) => renderState.testID === 'library-history-ready');
    expect(historyRenders).toEqual([{ dataLength: 4, testID: 'library-history-ready' }]);
  });

  it('[REG-PERF-001] resets the list position before switching tabs without animation', async () => {
    const frameCallbacks: ((time: number) => void)[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const view = await render(<LibraryHarness />);
    mockFlashListScrollToOffset.mockClear();

    await fireEvent.press(view.getByTestId('library-tab-history'));

    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(1);
    expect(mockFlashListScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(frameCallbacks).toHaveLength(1);
    await act(async () => frameCallbacks[0]?.(0));
    expect(mockFlashListScrollToOffset).toHaveBeenCalledTimes(2);
  });

  it('[REG-PERF-001] leaves filters and position unchanged when the selected tab is pressed again', async () => {
    const view = await render(<LibraryHarness />);
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    await fireEvent.press(view.getByLabelText('问与答'));
    mockFlashListScrollToOffset.mockClear();

    await fireEvent.press(view.getByTestId('library-tab-favorites'));

    expect(view.getByTestId('library-source-v2ex').props.accessibilityState.selected).toBe(true);
    expect(view.getByText('1 / 3 条')).toBeTruthy();
    expect(mockFlashListScrollToOffset).not.toHaveBeenCalled();
  });

  it('[REG-PERF-001] disables visible-position anchoring while library datasets switch', async () => {
    const view = await render(<LibraryHarness />);

    expect(view.getByTestId('library-favorites-ready').props.maintainVisibleContentPosition).toEqual({
      disabled: true
    });
    expect(view.getByTestId('library-favorites-ready').props.drawDistance).toBe(250);
  });

  it('settles all three tabs with an empty device library', async () => {
    const view = await render(<LibraryHarness followedUsers={[]} records={[]} />);

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
    expect(onRemove).toHaveBeenCalledWith(records[0]?.topic);

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
    const onRemove = jest.fn<(topic: Topic) => void>();
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
    expect(onRemove).toHaveBeenCalledWith(records[0]?.topic);
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

    await fireEvent.press(view.getByLabelText('问与答'));
    expect(view.getByText('1 / 3 条')).toBeTruthy();
    expect(view.getByText('V2EX 问答主题')).toBeTruthy();
    expect(view.queryByText('V2EX 工作主题')).toBeNull();

    await fireEvent.press(view.getByTestId('library-tab-users'));
    expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.queryByLabelText('问与答')).toBeNull();
    expect(view.getByText('2 / 2 人')).toBeTruthy();
    await fireEvent.press(view.getByTestId('library-source-v2ex'));
    expect(view.getByText('1 / 2 人')).toBeTruthy();
    expect(view.getByText('Neo')).toBeTruthy();
    expect(view.queryByText('Alice')).toBeNull();

    await fireEvent.press(view.getByTestId('library-tab-history'));
    expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.getAllByLabelText('全部，已选择')).toHaveLength(2);
    expect(view.getByText('3 条')).toBeTruthy();
    await fireEvent.press(view.getByTestId('library-source-linuxdo'));
    await fireEvent.press(view.getByLabelText('开发调优'));
    expect(view.getByText('1 / 3 条')).toBeTruthy();
    expect(view.getByText('linux.do 开发主题')).toBeTruthy();
    expect(view.queryByText('V2EX 问答主题')).toBeNull();
  });
});
