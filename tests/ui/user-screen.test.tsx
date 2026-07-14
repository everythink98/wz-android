import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import type { Topic, UserProfile } from '../../src/types';
import { createEmptyReaderData } from '../../src/readerData';
import { UserScreen } from '../../src/screens/UserScreen';
import { createStyles, createTheme } from '../../src/theme';
import { createTopicListItemStateIndex } from '../../src/topicListItemState';

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function FlashList(
      { data = [], keyExtractor, ListFooterComponent, renderItem, testID }: {
        data?: unknown[];
        keyExtractor?: (item: unknown, index: number) => string;
        ListFooterComponent?: React.ReactNode;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToOffset: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: () => undefined }));
      return ReactModule.createElement(
        NativeView,
        { testID },
        ...data.map((item, index) => ReactModule.createElement(
          NativeView,
          { key: keyExtractor?.(item, index) ?? index },
          renderItem?.({ item, index })
        )),
        ListFooterComponent
      );
    })
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronLeft: Icon, ExternalLink: Icon, RefreshCw: Icon, Star: Icon };
});
jest.mock('../../src/components/Avatar', () => ({ Avatar: () => null }));
jest.mock('../../src/components/TopicCard', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable, Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    MemoizedTopicCard: ({ onOpenTopic, topic }: { onOpenTopic: (topic: Topic) => void; topic: Topic }) => ReactModule.createElement(
      NativePressable,
      { accessibilityRole: 'button', onPress: () => onOpenTopic(topic) },
      ReactModule.createElement(NativeText, null, topic.title)
    )
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
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
  replies: [{
    source: 'linuxdo',
    id: 'reply-1',
    topicId: 'reply-topic',
    topicTitle: '回复所在主题',
    topicUrl: 'https://linux.do/t/reply-topic',
    url: 'https://linux.do/t/reply-topic/2',
    author: 'alice',
    floor: 2,
    excerpt: '回复摘要'
  }],
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
    styles,
    theme,
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
  it('keeps topic and reply pagination busy states independent', async () => {
    const onLoadMoreReplies = jest.fn<() => void>();
    const view = await render(userScreen({ loadingMoreTopics: true, onLoadMoreReplies }));

    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('回复'));
    expect(view.getByLabelText('加载更多回复').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('加载更多回复'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);

    await view.rerender(userScreen({ loadingMoreReplies: true, onLoadMoreReplies }));
    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('正在加载...'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed user source visible and allows refresh', async () => {
    const onRefresh = jest.fn<() => void>();
    const view = await render(userScreen({
      error: { kind: 'login-expired', message: 'linux.do 登录已失效，请重新登录。' },
      profile: null,
      onRefresh
    }));

    expect(view.getByText('linux.do 登录已失效，请重新登录。')).toBeTruthy();
    expect(view.getByText('Alice')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('刷新'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
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
        styles={styles}
        theme={theme}
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
    await fireEvent.press(view.getByLabelText('加载更多主题'));
    expect(onLoadMoreTopics).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getAllByLabelText('关注')[0]);
    expect(onToggleFollow).toHaveBeenCalledWith(profile);
    await fireEvent.press(view.getByLabelText('原站主页'));
    expect(onOpenOriginal).toHaveBeenCalledWith(profile.url);

    await fireEvent.press(view.getByLabelText('回复'));
    expect(view.getByText('回复所在主题')).toBeTruthy();
    expect(view.getByText('回复摘要')).toBeTruthy();
    await fireEvent.press(view.getByText('回复所在主题'));
    expect(onOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'reply-topic', source: 'linuxdo' }));
    await fireEvent.press(view.getByLabelText('加载更多回复'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
  });
});
