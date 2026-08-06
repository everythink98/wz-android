import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '../render';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { MemoizedTopicCard, TopicCard } from '@/ui/topic/TopicCard';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import type { Topic } from '@/domain/forum/models';

jest.mock('@shopify/flash-list', () => ({
  useMappingHelper: () => ({ getMappingKey: (key: string | number) => String(key) })
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Eye: Icon, MessageCircle: Icon };
});

jest.mock('expo-image', () => ({ Image: () => null }));
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
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const topic: Topic = {
  source: 'linuxdo',
  id: 'topic-card-1',
  title: '真实自动化覆盖卡片',
  author: 'alice',
  authorLevelLabel: 'LV 2',
  category: '开发调优',
  url: 'https://linux.do/t/topic-card-1',
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

describe('Topic card visible behavior', () => {
  it('shows source metadata, local state, tag limits, access rules and the loose excerpt', async () => {
    const onOpenTopic = jest.fn();
    const view = await render(
      <TopicCard
        highlightQuery="自动化"
        readerState={{ favorite: true, listDensity: 'loose', read: true }}
        testID="real-topic-card"
        topic={topic}
        onOpenTopic={onOpenTopic}
      />
    );

    expect(view.getByText('linux.do')).toBeTruthy();
    expect(view.getByText('开发调优')).toBeTruthy();
    expect(view.getByText('今天 08:00')).toBeTruthy();
    expect(view.getByText('alice · LV 2 · 已收藏 · 同链：V2EX、NodeSeek')).toBeTruthy();
    expect(view.getByText('需 Lv2')).toBeTruthy();
    expect(view.getByText('Android')).toBeTruthy();
    expect(view.getByText('测试')).toBeTruthy();
    expect(view.getByText('回归')).toBeTruthy();
    expect(view.queryByText('第四个标签')).toBeNull();
    expect(view.getByText('+1')).toBeTruthy();
    expect(view.getByText('宽松密度下显示的主题摘要')).toBeTruthy();
    expect(view.getByText('23')).toBeTruthy();
    expect(view.getByText('456')).toBeTruthy();
    expect(view.getByLabelText('avatar source linuxdo')).toBeTruthy();

    await fireEvent.press(view.getByTestId('real-topic-card'));
    expect(onOpenTopic).toHaveBeenCalledWith(topic);
  });

  it('hides density-dependent content and keeps a trailing local action separate', async () => {
    const onOpenTopic = jest.fn();
    const onTrailingAction = jest.fn();
    const view = await render(
      <TopicCard
        hideReplyCount
        readerState={{ favorite: false, listDensity: 'standard', read: false }}
        renderTrailingAction={() => (
          <Pressable accessibilityRole="button" accessibilityLabel="本机取消收藏" onPress={onTrailingAction}>
            <Text>取消</Text>
          </Pressable>
        )}
        testID="real-topic-card"
        topic={topic}
        onOpenTopic={onOpenTopic}
      />
    );

    expect(view.queryByText('宽松密度下显示的主题摘要')).toBeNull();
    expect(view.queryByText('23')).toBeNull();
    expect(view.getByText('456')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('本机取消收藏'));
    expect(onTrailingAction).toHaveBeenCalledTimes(1);
    expect(onOpenTopic).not.toHaveBeenCalled();
  });

  it('[REG-SEARCH-022] does not manufacture an untitled search card', async () => {
    const view = await render(
      <TopicCard
        readerState={{ favorite: false, listDensity: 'standard', read: false }}
        topic={{ ...topic, title: '' }}
        onOpenTopic={jest.fn()}
      />
    );

    expect(view.queryByText('无标题')).toBeNull();
  });

  it('[REG-FEED-012] updates card actions when a new immutable payload keeps the same visible text', async () => {
    const onOpenTopic = jest.fn();
    const onTrailingAction = jest.fn();
    const renderTrailingAction = (current: Topic) => (
      <Pressable accessibilityRole="button" accessibilityLabel="当前主题操作" onPress={() => onTrailingAction(current)}>
        <Text>操作</Text>
      </Pressable>
    );
    const nextTopic = {
      ...topic,
      url: 'https://linux.do/t/topic-card-2',
      categoryId: '99',
      authorId: '9001'
    };
    const commonProps = {
      onOpenTopic,
      readerState: { favorite: false, listDensity: 'standard' as const, read: false },
      renderTrailingAction,
      styles,
      testID: 'memoized-topic-card',
      theme
    };
    const view = await render(<MemoizedTopicCard {...commonProps} topic={topic} />);

    await view.rerender(<MemoizedTopicCard {...commonProps} topic={nextTopic} />);
    await fireEvent.press(view.getByTestId('memoized-topic-card'));
    await fireEvent.press(view.getByLabelText('当前主题操作'));

    expect(onOpenTopic).toHaveBeenCalledWith(nextTopic);
    expect(onTrailingAction).toHaveBeenCalledWith(nextTopic);
  });
});
