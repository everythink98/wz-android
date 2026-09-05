import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, within } from '../render';
import React from 'react';
import { StyleSheet } from 'react-native';
import type { Topic, UserProfile, UserReference } from '@/domain/forum/models';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { UserScreen } from '@/features/user/UserScreen';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';

const mockListRender = jest.fn<(props: { data: unknown[]; header: React.ReactNode }) => void>();

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function FlashList(
      {
        data = [],
        keyExtractor,
        ListHeaderComponent,
        ListFooterComponent,
        renderItem,
        testID
      }: {
        data?: unknown[];
        keyExtractor?: (item: unknown, index: number) => string;
        ListHeaderComponent?: React.ReactNode;
        ListFooterComponent?: React.ReactNode;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToOffset: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: () => undefined }));
      mockListRender({ data, header: ListHeaderComponent });
      return ReactModule.createElement(
        NativeView,
        { testID },
        ListHeaderComponent,
        ...data.map((item, index) =>
          ReactModule.createElement(
            NativeView,
            { key: keyExtractor?.(item, index) ?? index },
            renderItem?.({ item, index })
          )
        ),
        ListFooterComponent
      );
    })
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronLeft: Icon, ExternalLink: Icon, RefreshCw: Icon, Star: Icon };
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
jest.mock('@/ui/topic/TopicCard', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable, Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    MemoizedTopicCard: ({
      onOpenTopic,
      topic,
      testID
    }: {
      onOpenTopic: (topic: Topic) => void;
      topic: Topic;
      testID?: string;
    }) =>
      ReactModule.createElement(
        NativePressable,
        { accessibilityRole: 'button', testID, onPress: () => onOpenTopic(topic) },
        ReactModule.createElement(NativeText, null, topic.title)
      )
  };
});

const readerData = createEmptyReaderData();
const topicStateIndex = createTopicListItemStateIndex(readerData);
const topic: Topic = {
  source: 'linuxdo',
  id: 'topic-1',
  title: '用户主题',
  author: 'alice',
  url: 'https://linux.do/t/topic-1',
  createdAt: '2026-07-14T00:00:00.000Z',
  replyCount: 2
};
const profile: UserProfile = {
  source: 'linuxdo',
  id: 'alice',
  username: 'alice',
  displayName: 'Alice',
  url: 'https://linux.do/u/alice',
  levelLabel: 'LV 2',
  topicCount: 1,
  replyCount: 1,
  topics: [topic],
  hasMoreTopics: true,
  replies: [
    {
      source: 'linuxdo',
      id: 'reply-1',
      topicId: 'reply-topic',
      topicTitle: '回复所在主题',
      topicUrl: 'https://linux.do/t/reply-topic',
      url: 'https://linux.do/t/reply-topic/2',
      author: 'alice',
      floor: 2,
      excerpt: '回复摘要'
    }
  ],
  hasMoreReplies: true
};

function userScreen(overrides: Partial<React.ComponentProps<typeof UserScreen>> = {}) {
  const props: React.ComponentProps<typeof UserScreen> = {
    busy: false,
    error: null,
    followed: false,
    loadingMoreReplies: false,
    loadingMoreTopics: false,
    profile,
    requestedUser: profile,
    topicStateIndex,
    onBack: jest.fn(),
    onLoadMoreReplies: jest.fn(),
    onLoadMoreTopics: jest.fn(),
    onOpenOriginal: jest.fn(),
    onOpenTopic: jest.fn(),
    onRefresh: jest.fn(),
    onToggleFollow: jest.fn(),
    ...overrides
  };
  return <UserScreen {...props} />;
}

describe('User screen behavior', () => {
  it('reuses activity rows and the profile header until their data changes', async () => {
    const view = await render(userScreen());
    const topicInputs = mockListRender.mock.calls.at(-1)![0];
    await fireEvent.press(view.getByLabelText('回复'));
    const replyInputs = mockListRender.mock.calls.at(-1)![0];
    expect(replyInputs.header === topicInputs.header).toBe(true);
    await fireEvent.press(view.getByLabelText('主题'));
    expect(mockListRender.mock.calls.at(-1)![0].data).toBe(topicInputs.data);
    await fireEvent.press(view.getByLabelText('回复'));
    expect(mockListRender.mock.calls.at(-1)![0].data).toBe(replyInputs.data);

    await view.rerender(
      userScreen({
        profile: {
          ...profile,
          replies: [...profile.replies!, { ...profile.replies![0], id: 'reply-2', topicTitle: '新增回复' }]
        }
      })
    );
    expect(view.getByText('新增回复')).toBeTruthy();
    expect(mockListRender.mock.calls.at(-1)![0].data).not.toBe(replyInputs.data);
    await fireEvent.press(view.getByLabelText('主题'));
    expect(mockListRender.mock.calls.at(-1)![0].data).toBe(topicInputs.data);
  });

  it('refreshes in the toolbar while retaining the selected activity and loaded content', async () => {
    const onRefresh = jest.fn<() => void>();
    const view = await render(userScreen({ onRefresh }));
    await fireEvent.press(view.getByLabelText('回复'));
    await fireEvent.press(view.getByLabelText('刷新'));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await view.rerender(userScreen({ busy: true, onRefresh }));

    expect(view.queryByText('正在读取用户主页...')).toBeNull();
    expect(view.getByTestId('user-screen-loaded')).toBeTruthy();
    expect(view.getByText('回复所在主题')).toBeTruthy();
    expect(view.getByLabelText('刷新').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(view.getByLabelText('刷新'));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await view.rerender(userScreen({ onRefresh }));
    expect(view.getByLabelText('刷新').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(view.getByText('回复所在主题')).toBeTruthy();
  });

  it('keeps topic and reply pagination busy states independent', async () => {
    const onLoadMoreReplies = jest.fn<() => void>();
    const view = await render(userScreen({ loadingMoreTopics: true, onLoadMoreReplies }));

    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('刷新').props.accessibilityState.busy).toBe(false);
    await fireEvent.press(view.getByLabelText('回复'));
    expect(view.getByLabelText('加载更多回复').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('加载更多回复'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);

    await view.rerender(userScreen({ loadingMoreReplies: true, onLoadMoreReplies }));
    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('正在加载...'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
  });

  it('keeps the profile avatar bound to the profile source', async () => {
    const view = await render(userScreen());

    expect(view.getByLabelText('avatar source linuxdo')).toBeTruthy();
  });

  it('keeps a failed user source visible and allows refresh', async () => {
    const onRefresh = jest.fn<() => void>();
    const view = await render(
      userScreen({
        error: { kind: 'login-expired', message: 'linux.do 登录已失效，请重新登录。' },
        profile: null,
        onRefresh
      })
    );

    const notice = view.getByText('linux.do 登录已失效，请重新登录。');
    expect(view.getByText('Alice')).toBeTruthy();
    const retry = view.getByLabelText('重试');
    expect(retry.parent).toBe(notice.parent);
    await fireEvent.press(retry);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps an unresolved NodeSeek user in the app without exposing follow', async () => {
    const requestedUser: UserReference = {
      source: 'nodeseek',
      username: 'xy',
      displayName: 'xy',
      url: 'https://www.nodeseek.com/member?t=xy'
    };
    const onOpenOriginal = jest.fn<() => void>();
    const view = await render(
      userScreen({
        busy: true,
        profile: null,
        requestedUser,
        onOpenOriginal
      })
    );

    expect(view.getByText('xy')).toBeTruthy();
    expect(view.queryByLabelText('关注')).toBeNull();
    expect(view.queryByLabelText('已关注')).toBeNull();
    expect(view.queryByText('原站主页')).toBeNull();
    expect(view.getAllByLabelText('原站')).toHaveLength(1);
    expect(view.getByRole('status').props.accessibilityState.busy).toBe(true);
    await fireEvent.press(view.getByLabelText('原站'));
    expect(onOpenOriginal).toHaveBeenCalledWith(requestedUser.url);
  });

  it('distinguishes empty topic and reply tabs for a loaded user', async () => {
    const emptyProfile: UserProfile = {
      ...profile,
      topics: [],
      replies: [],
      hasMoreTopics: false,
      hasMoreReplies: false
    };
    const view = await render(userScreen({ profile: emptyProfile, requestedUser: emptyProfile }));

    expect(view.getByText('这个用户暂时没有可显示的主题')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('回复'));
    expect(view.queryByText('这个用户暂时没有可显示的主题')).toBeNull();
    expect(view.getByText('这个用户暂时没有可显示的回复')).toBeTruthy();
    await view.rerender(userScreen({ profile: emptyProfile, requestedUser: emptyProfile, busy: true }));
    expect(view.getByText('这个用户暂时没有可显示的回复')).toBeTruthy();
    expect(view.queryByRole('status')).toBeNull();
  });

  it('keeps topic and reply actions connected to the selected user', async () => {
    const onLoadMoreReplies = jest.fn();
    const onLoadMoreTopics = jest.fn();
    const onOpenOriginal = jest.fn();
    const onOpenTopic = jest.fn();
    const onToggleFollow = jest.fn();
    const view = await render(
      <UserScreen
        busy={false}
        error={null}
        followed={false}
        loadingMoreReplies={false}
        loadingMoreTopics={false}
        profile={profile}
        requestedUser={profile}
        topicStateIndex={topicStateIndex}
        onBack={jest.fn()}
        onLoadMoreReplies={onLoadMoreReplies}
        onLoadMoreTopics={onLoadMoreTopics}
        onOpenOriginal={onOpenOriginal}
        onOpenTopic={onOpenTopic}
        onRefresh={jest.fn()}
        onToggleFollow={onToggleFollow}
      />
    );

    expect(view.getByTestId('user-screen-loaded')).toBeTruthy();
    expect(view.getByText('Alice')).toBeTruthy();
    expect(view.getByText('用户主题')).toBeTruthy();
    expect(view.getByTestId('user-topic-first')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('加载更多主题'));
    expect(onLoadMoreTopics).toHaveBeenCalledTimes(1);
    const followActions = view.getAllByLabelText('关注');
    expect(followActions).toHaveLength(1);
    await fireEvent.press(followActions[0]);
    expect(onToggleFollow).toHaveBeenCalledWith(profile);
    await fireEvent.press(view.getByLabelText('原站'));
    expect(onOpenOriginal).toHaveBeenCalledWith(profile.url);

    await fireEvent.press(view.getByLabelText('回复'));
    expect(view.getByText('回复所在主题')).toBeTruthy();
    expect(view.getByText('回复摘要')).toBeTruthy();
    await fireEvent.press(view.getByText('回复所在主题'));
    expect(onOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'reply-topic', source: 'linuxdo' }));
    await fireEvent.press(view.getByLabelText('加载更多回复'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
  });

  it('keeps the follow action in the same bounds and exposes its selected state', async () => {
    const onToggleFollow = jest.fn();
    const view = await render(userScreen({ onToggleFollow }));
    const before = StyleSheet.flatten(view.getByLabelText('关注').props.style);

    await view.rerender(userScreen({ followed: true, onToggleFollow }));
    const followButton = view.getByLabelText('已关注');
    const after = StyleSheet.flatten(followButton.props.style);
    expect(after.minWidth).toBe(before.minWidth);
    expect(after.minHeight).toBe(before.minHeight);
    expect(followButton.props.accessibilityState.selected).toBe(true);
    await fireEvent.press(followButton);
    expect(onToggleFollow).toHaveBeenCalledWith(profile);
  });

  it('keeps the measured biography and profile mounted across activity switches and refresh', async () => {
    const bioProfile = { ...profile, bio: '第一行简介。第二行简介。第三行简介。' };
    const view = await render(userScreen({ profile: bioProfile }));
    expect(view.queryByLabelText('展开简介')).toBeNull();
    await fireEvent(view.getByTestId('user-bio-measure', { includeHiddenElements: true }), 'textLayout', {
      nativeEvent: { lines: [{}, {}] }
    });
    expect(view.queryByLabelText('展开简介')).toBeNull();
    await fireEvent(view.getByTestId('user-bio-measure', { includeHiddenElements: true }), 'textLayout', {
      nativeEvent: { lines: [{}, {}, {}] }
    });
    expect(view.getByTestId('user-bio-text').props.numberOfLines).toBe(2);
    await fireEvent.press(view.getByLabelText('展开简介'));
    expect(view.getByLabelText('收起简介').props.accessibilityState.expanded).toBe(true);
    const profileHeader = view.getByTestId('user-profile-header');
    const activityList = view.getByTestId('user-screen-loaded');
    await fireEvent.press(view.getByLabelText('回复'));
    expect(view.getByLabelText('收起简介').props.accessibilityState.expanded).toBe(true);
    expect(view.getByTestId('user-profile-header') === profileHeader).toBe(true);
    expect(view.getByTestId('user-screen-loaded') === activityList).toBe(true);
    expect(view.getByTestId('user-bio-text').props.numberOfLines).toBeUndefined();
    await fireEvent.press(view.getByLabelText('主题'));
    expect(view.getByTestId('user-profile-header') === profileHeader).toBe(true);
    expect(view.getByText('用户主题')).toBeTruthy();

    await view.rerender(userScreen({ profile: bioProfile, busy: true }));
    expect(view.getByTestId('user-bio-text').props.numberOfLines).toBeUndefined();
    await view.rerender(userScreen({ profile: { ...bioProfile, id: 'another-user' } }));
    expect(view.getByTestId('user-screen-loaded') === activityList).toBe(false);
    expect(view.getByTestId('user-bio-text').props.numberOfLines).toBe(2);
  });

  it.each(['nodeseek', 'v2ex', 'linuxdo', 'yaohuo'] as const)(
    'shows zero counts and deduplicates statistics according to %s semantics',
    async (source) => {
      const view = await render(
        userScreen({ profile: { ...profile, source, topicCount: 0, replyCount: 0, postCount: 0 } })
      );
      expect(view.getByLabelText('主题 0')).toBeTruthy();
      expect(view.getByLabelText('回复 0')).toBeTruthy();
      expect(Boolean(view.queryByLabelText('发言 0'))).toBe(source === 'linuxdo' || source === 'yaohuo');
    }
  );

  it('omits absent metadata and a repeated username', async () => {
    const view = await render(
      userScreen({
        profile: {
          ...profile,
          displayName: 'alice',
          topicCount: undefined,
          replyCount: undefined,
          levelLabel: undefined
        }
      })
    );
    expect(view.getByText('alice')).toBeTruthy();
    expect(view.getByText('linux.do')).toBeTruthy();
    expect(within(view.getByTestId('user-profile-header')).queryByText('linux.do · alice')).toBeNull();
    expect(view.queryByLabelText(/^主题 \d/)).toBeNull();
    expect(view.queryByLabelText(/^回复 \d/)).toBeNull();
  });

  it('retains loaded content and restores the refresh action after a failed refresh', async () => {
    const view = await render(userScreen({ busy: true }));
    await view.rerender(userScreen({ error: { kind: 'ordinary', message: '暂时无法刷新，请稍后重试。' } }));
    expect(view.getByText('用户主题')).toBeTruthy();
    expect(view.getByText('暂时无法刷新，请稍后重试。')).toBeTruthy();
    expect(view.getByLabelText('刷新').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(view.queryByRole('status')).toBeNull();
  });
});
