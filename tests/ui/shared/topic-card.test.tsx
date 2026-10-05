import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { createEmptyReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import { useAppTheme } from '@/app/useAppTheme';
import { MemoizedTopicCard, TopicCard } from '@/ui/topic/TopicCard';
import { ReaderStyleProvider, useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createNotificationStyles } from '@/features/notifications/styles';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import type { Topic } from '@/domain/forum/models';

jest.mock('@shopify/flash-list', () => ({
  useMappingHelper: () => ({ getMappingKey: (key: string | number) => String(key) })
}));

const mockIconCommits = jest.fn<(name: string) => void>();
jest.mock('lucide-react-native', () => {
  const ReactModule = require('react') as typeof React;
  function Icon({ name }: { name: string }) {
    ReactModule.useLayoutEffect(() => mockIconCommits(name));
    return null;
  }
  return {
    Eye: () => ReactModule.createElement(Icon, { name: 'Eye' }),
    MessageCircle: () => ReactModule.createElement(Icon, { name: 'MessageCircle' })
  };
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
  it.each([
    {
      identity: 'topic id',
      replacement: { ...topic, id: 'topic-card-2', title: '回收后的另一主题', url: 'https://linux.do/t/topic-card-2' }
    },
    {
      identity: 'source',
      replacement: {
        ...topic,
        source: 'nodeseek' as const,
        title: '另一来源的同号主题',
        url: 'https://www.nodeseek.com/post-topic-card-1-1'
      }
    }
  ])('accepts a new $identity when a recently pressed card instance is recycled', async ({ replacement }) => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const onOpenTopic = jest.fn();
      const commonProps = {
        onOpenTopic,
        readerState: { favorite: false, listDensity: 'standard' as const, read: false },
        testID: 'recycled-topic-card'
      };
      const view = await render(<MemoizedTopicCard {...commonProps} topic={topic} />);
      await fireEvent.press(view.getByTestId('recycled-topic-card'));
      expect(onOpenTopic.mock.calls).toEqual([[topic]]);

      now.mockReturnValue(1_100);
      await view.rerender(<MemoizedTopicCard {...commonProps} topic={replacement} />);
      expect(view.getByText(replacement.title)).toBeTruthy();
      await fireEvent.press(view.getByTestId('recycled-topic-card'));
      expect(onOpenTopic.mock.calls).toEqual([[topic], [replacement]]);
    } finally {
      now.mockRestore();
    }
  });

  it('suppresses batched double taps and same-identity updates until the opening window ends', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const onOpenTopic = jest.fn();
      const commonProps = {
        onOpenTopic,
        readerState: { favorite: false, listDensity: 'standard' as const, read: false },
        testID: 'guarded-topic-card'
      };
      const view = await render(<MemoizedTopicCard {...commonProps} topic={topic} />);
      await act(async () => {
        await fireEvent.press(view.getByTestId('guarded-topic-card'));
        await fireEvent.press(view.getByTestId('guarded-topic-card'));
      });
      expect(onOpenTopic.mock.calls).toEqual([[topic]]);

      const updated = { ...topic, replyCount: 24 };
      now.mockReturnValue(1_499);
      await view.rerender(<MemoizedTopicCard {...commonProps} topic={updated} />);
      await fireEvent.press(view.getByTestId('guarded-topic-card'));
      expect(onOpenTopic.mock.calls).toEqual([[topic]]);

      now.mockReturnValue(1_500);
      await fireEvent.press(view.getByTestId('guarded-topic-card'));
      expect(onOpenTopic.mock.calls).toEqual([[topic], [updated]]);
    } finally {
      now.mockRestore();
    }
  });

  it('keeps an already read title dimmed while showing new replies, including memoized updates', async () => {
    const onOpenTopic = jest.fn();
    const state = { favorite: false, read: true, listDensity: 'loose' as const };
    const view = await render(<MemoizedTopicCard topic={topic} readerState={state} onOpenTopic={onOpenTopic} />);
    expect(view.queryByText('有新回复')).toBeNull();
    await view.rerender(
      <MemoizedTopicCard topic={topic} readerState={{ ...state, hasNewReplies: true }} onOpenTopic={onOpenTopic} />
    );
    expect(view.getByText('有新回复')).toBeTruthy();
    expect(StyleSheet.flatten(view.getByText(topic.title).parent?.props.style)).toMatchObject({ color: theme.muted });
  });

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
    expect(view.getByText('alice · LV 2 · 已收藏')).toBeTruthy();
    expect(view.getByText('同链：V2EX、NodeSeek')).toBeTruthy();
    expect(view.queryByText('alice · LV 2 · 已收藏 · 同链：V2EX、NodeSeek')).toBeNull();
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

  it('keeps read metadata legible while lowering only the title emphasis', async () => {
    const view = await render(
      <TopicCard
        readerState={{ favorite: false, listDensity: 'standard', read: true }}
        testID="read-topic-card"
        topic={topic}
        onOpenTopic={jest.fn()}
      />
    );

    const fadedAncestors =
      view.root?.queryAll((instance) => typeof StyleSheet.flatten(instance.props.style)?.opacity === 'number') || [];
    expect(fadedAncestors).toHaveLength(0);
    expect(StyleSheet.flatten(view.getByText(topic.title).parent?.props.style)).toMatchObject({ color: theme.muted });
    expect(view.getByText(/^alice/)).toHaveStyle({ color: theme.muted });
    expect(view.getByText('23')).toHaveStyle({ color: theme.muted });
  });

  it('emphasizes search matches without imitating a text selection', async () => {
    const view = await render(
      <TopicCard
        highlightQuery="自动化"
        readerState={{ favorite: false, listDensity: 'standard', read: false }}
        topic={topic}
        onOpenTopic={jest.fn()}
      />
    );

    const highlightStyle = StyleSheet.flatten(view.getByText('自动化').props.style);
    expect(highlightStyle).toMatchObject({ color: theme.primaryStrong, fontWeight: '700' });
    expect(highlightStyle.backgroundColor).toBeUndefined();
  });

  it('does not manufacture an untitled search card', async () => {
    const view = await render(
      <TopicCard
        readerState={{ favorite: false, listDensity: 'standard', read: false }}
        topic={{ ...topic, title: '' }}
        onOpenTopic={jest.fn()}
      />
    );

    expect(view.queryByText('无标题')).toBeNull();
  });

  it('updates card actions when a new immutable payload keeps the same visible text', async () => {
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

function AppThemeHarness({
  children,
  settings,
  width = 1000
}: {
  children: React.ReactNode;
  settings: ReaderSettings;
  width?: number;
}) {
  const appTheme = useAppTheme(settings, width);
  return (
    <ReaderStyleProvider value={appTheme.readerStyleContext}>
      <Text testID="theme-content-width">{appTheme.contentWidth}</Text>
      <Text testID="navigation-theme" style={{ color: appTheme.navigationTheme.colors.text }}>
        Navigation
      </Text>
      {children}
    </ReaderStyleProvider>
  );
}

const ReadingStyleSample = React.memo(function ReadingStyleSample({
  onCommit
}: {
  onCommit: (fontScale: number) => void;
}) {
  const { settings, styles } = useReaderThemeStyles(createNotificationStyles);
  React.useLayoutEffect(() => onCommit(settings.fontScale));
  return (
    <Text testID="reading-body" style={styles.detailBody}>
      正文样式
    </Text>
  );
});

describe('App theme propagation to real topic cards', () => {
  function content(onCommit: (fontScale: number) => void) {
    return (
      <>
        <ReadingStyleSample onCommit={onCommit} />
        <MemoizedTopicCard
          topic={topic}
          readerState={{ favorite: false, listDensity: 'standard', read: false }}
          testID="themed-topic-card"
          onOpenTopic={jest.fn()}
        />
      </>
    );
  }

  it('commits only the new font scale to cards and their icon children', async () => {
    const settings = createEmptyReaderData().settings;
    const onCommit = jest.fn<(fontScale: number) => void>();
    const children = content(onCommit);
    const view = await render(<AppThemeHarness settings={settings}>{children}</AppThemeHarness>);
    onCommit.mockClear();
    mockIconCommits.mockClear();

    await view.rerender(<AppThemeHarness settings={{ ...settings, fontScale: 1.1 }}>{children}</AppThemeHarness>);

    expect(onCommit.mock.calls.map(([scale]) => scale)).toEqual([1.1]);
    expect(mockIconCommits.mock.calls.map(([name]) => name).sort()).toEqual(['Eye', 'MessageCircle']);
    expect(StyleSheet.flatten(view.getByText(topic.title).parent?.props.style)).toMatchObject({ fontSize: 18 });
  });

  it.each(['network', 'content-sources', 'equivalent-object'] as const)(
    'keeps card and icon commits quiet for %s settings updates',
    async (update) => {
      const settings = createEmptyReaderData().settings;
      const onCommit = jest.fn<(fontScale: number) => void>();
      const children = content(onCommit);
      const view = await render(<AppThemeHarness settings={settings}>{children}</AppThemeHarness>);
      onCommit.mockClear();
      mockIconCommits.mockClear();
      const next = {
        ...settings,
        ...(update === 'network' ? { nodeSeekRecoveryThreshold: settings.nodeSeekRecoveryThreshold + 1 } : {}),
        ...(update === 'content-sources'
          ? { contentSources: settings.contentSources.map((source) => ({ ...source, enabled: !source.enabled })) }
          : {})
      };

      await view.rerender(<AppThemeHarness settings={next}>{children}</AppThemeHarness>);

      expect(onCommit).not.toHaveBeenCalled();
      expect(mockIconCommits).not.toHaveBeenCalled();
      expect(StyleSheet.flatten(view.getByText(topic.title).parent?.props.style)).toMatchObject({ fontSize: 16 });
    }
  );

  it('keeps every appearance setting live through the provider and native navigation theme', async () => {
    let settings = createEmptyReaderData().settings;
    const children = content(jest.fn());
    const view = await render(<AppThemeHarness settings={settings}>{children}</AppThemeHarness>);
    const update = async (patch: Partial<ReaderSettings>) => {
      settings = { ...settings, ...patch };
      await view.rerender(<AppThemeHarness settings={settings}>{children}</AppThemeHarness>);
    };

    await update({ theme: 'dark' });
    expect(StyleSheet.flatten(view.getByText(topic.title).parent?.props.style)).toMatchObject({ color: '#F1F1F1' });
    expect(view.getByTestId('navigation-theme')).toHaveStyle({ color: '#F1F1F1' });
    await update({ fontFamily: 'serif' });
    expect(StyleSheet.flatten(view.getByText(topic.title).parent?.props.style)).toMatchObject({ fontFamily: 'serif' });
    await update({ listDensity: 'loose' });
    expect(view.getByTestId('themed-topic-card')).toHaveStyle({ paddingTop: 18 });
    await update({ lineHeight: 'loose' });
    expect(view.getByTestId('reading-body')).toHaveStyle({ lineHeight: 26 });
    await update({ contentWidth: 'wide' });
    expect(view.getByTestId('theme-content-width')).toHaveTextContent('820');
    await view.rerender(
      <AppThemeHarness settings={settings} width={400}>
        {children}
      </AppThemeHarness>
    );
    expect(view.getByTestId('theme-content-width')).toHaveTextContent('360');
  });
});
