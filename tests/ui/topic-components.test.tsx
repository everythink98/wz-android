import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React, { type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { createEmptyReaderData } from '../../src/readerData';
import { ReplyComposerSheet } from '../../src/screens/topic/ReplyComposerSheet';
import { ReplyItem } from '../../src/screens/topic/ReplyItem';
import { TopicBodyQuoteCard } from '../../src/screens/topic/TopicBodyQuoteCard';
import { TopicPolls } from '../../src/screens/topic/TopicPolls';
import { createStyles, createTheme } from '../../src/theme';
import { createTopicImageDeriver } from '../../src/topicDerivedData';
import type { Reply, TopicPoll } from '../../src/types';

jest.mock('@shopify/flash-list', () => ({
  useMappingHelper: () => ({
    getMappingKey: (key: string | number) => String(key)
  })
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactModule = require('react') as typeof React;
  const {
    Pressable: NativePressable,
    TextInput,
    View: NativeView
  } = require('react-native') as typeof import('react-native');
  const BottomSheet = ReactModule.forwardRef(function BottomSheet(
    {
      children,
      index,
      onClose
    }: {
      children?: React.ReactNode;
      index: number;
      onClose?: () => void;
    },
    ref
  ) {
    ReactModule.useImperativeHandle(ref, () => ({ close: () => undefined }));
    if (index < 0) {
      return null;
    }
    return ReactModule.createElement(
      NativeView,
      null,
      children,
      ReactModule.createElement(
        NativePressable,
        { accessibilityRole: 'button', accessibilityLabel: '模拟关闭回复面板', onPress: onClose },
        ReactModule.createElement(require('react-native').Text, null, '模拟关闭回复面板')
      )
    );
  });
  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetBackdrop: () => null,
    BottomSheetFlatList: (props: Record<string, unknown>) => ReactModule.createElement(NativeView, props),
    BottomSheetTextInput: ReactModule.forwardRef(function BottomSheetTextInput(props: Record<string, unknown>, ref) {
      void ref;
      return ReactModule.createElement(TextInput, props);
    }),
    BottomSheetView: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(NativeView, null, children)
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('react-native-gesture-handler', () => ({
  ScrollView: require('react-native').ScrollView
}));

jest.mock('react-native-render-html', () => {
  const ReactModule = require('react') as typeof React;
  const { Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    RenderHTMLSource: ({ source }: { source: { html: string } }) => ReactModule.createElement(
      NativeText,
      null,
      source.html.replace(/<[^>]+>/g, '')
    )
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    CheckCircle: Icon,
    CheckSquare: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    Circle: Icon,
    Drumstick: Icon,
    MessageCircle: Icon,
    Pencil: Icon,
    Square: Icon,
    ThumbsDown: Icon,
    ThumbsUp: Icon,
    Trash2: Icon,
    Users: Icon
  };
});

jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    Image: ({ source }: { source?: { uri?: string } }) => ReactModule.createElement(
      NativeView,
      { accessibilityLabel: source?.uri ? `emoji image ${source.uri}` : 'emoji image' }
    )
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const topicImageDeriver = createTopicImageDeriver();

const multiplePoll: TopicPoll = {
  id: 'poll-1',
  name: 'poll-1',
  postId: 'post-1',
  title: '选择两个答案',
  multiple: true,
  min: 2,
  max: 2,
  public: true,
  participantCount: 3,
  options: [
    { id: 'a', label: '选项甲', count: 2 },
    { id: 'b', label: '选项乙', count: 1 }
  ]
};

function pollProps(overrides: Partial<ComponentProps<typeof TopicPolls>> = {}): ComponentProps<typeof TopicPolls> {
  return {
    actionBusy: false,
    canWritePollSource: true,
    keyPrefix: 'topic',
    onTogglePollSelection: jest.fn(),
    onVotePoll: jest.fn(),
    pollSelections: {},
    polls: [multiplePoll],
    source: 'linuxdo',
    styles,
    theme,
    ...overrides
  };
}

function replyProps(overrides: Partial<ComponentProps<typeof ReplyItem>> = {}): ComponentProps<typeof ReplyItem> {
  const reply: Reply = {
    author: 'alice',
    commentId: 22,
    contentHtml: '<p>正文内容</p>',
    createdAt: '2026-07-14T01:02:03.000Z',
    floor: 2,
    isOp: true,
    quotedFloors: [1],
    quotedAuthors: { 1: 'quoted-user' },
    replyTargetAuthor: 'bob',
    upvoteCount: 3,
    likeCount: 4,
    dislikeCount: 1
  };
  return {
    actionBusy: false,
    canUseDiscourseActions: false,
    canWrite: true,
    contentWidth: 720,
    expandedQuotes: {},
    inlineSizedImageUrls: {},
    isActionPending: () => false,
    loadedQuotedReplies: {},
    loadingQuotedFloors: {},
    onDeleteReply: jest.fn(),
    onEditReply: jest.fn(),
    onInteract: jest.fn(),
    onOpenUser: jest.fn(),
    onReplyToFloor: jest.fn(),
    onTogglePollSelection: jest.fn(),
    onToggleReplyQuote: jest.fn(),
    onVotePoll: jest.fn(),
    pollSelections: {},
    query: '',
    repliesByFloor: new Map(),
    reply,
    replyFloor: 2,
    source: 'nodeseek',
    styles,
    theme,
    topicAuthor: 'alice',
    topicBaseUrl: 'https://www.nodeseek.com/post-1-1',
    topicId: 'topic-1',
    topicImageDeriver,
    ...overrides
  };
}

describe('Topic real child components', () => {
  it('shows poll constraints and submits only the controlled valid selection', async () => {
    const onTogglePollSelection = jest.fn();
    const onVotePoll = jest.fn();
    const view = await render(
      <TopicPolls
        {...pollProps({
          onTogglePollSelection,
          onVotePoll,
          pollSelections: { 'topic-poll-1': ['a'] }
        })}
      />
    );

    expect(view.getByLabelText('至少选择 2 项').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getAllByRole('checkbox')[1]);
    expect(onTogglePollSelection).toHaveBeenCalledWith('topic-poll-1', multiplePoll, 'b');

    await view.rerender(
      <TopicPolls
        {...pollProps({
          onTogglePollSelection,
          onVotePoll,
          pollSelections: { 'topic-poll-1': ['a', 'b'] }
        })}
      />
    );
    expect(view.getByLabelText('提交投票').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('提交投票'));
    expect(onVotePoll).toHaveBeenCalledWith(multiplePoll, ['a', 'b']);
  });

  it('keeps authenticated Yaohuo polls selectable and submittable', async () => {
    const onVotePoll = jest.fn();
    const view = await render(
      <TopicPolls
        {...pollProps({
          onVotePoll,
          pollSelections: { 'topic-poll-1': ['a', 'b'] },
          source: 'yaohuo'
        })}
      />
    );

    expect(view.getByLabelText('提交投票').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('提交投票'));
    expect(onVotePoll).toHaveBeenCalledWith(multiplePoll, ['a', 'b']);
  });

  it('keeps unsupported and unauthenticated polls visibly read-only', async () => {
    const view = await render(<TopicPolls {...pollProps({ canWritePollSource: false, source: 'v2ex' })} />);

    expect(view.getByText('只读结果')).toBeTruthy();
    expect(view.getByText('3 人参与')).toBeTruthy();
    expect(view.getByText('2 票 · 67%')).toBeTruthy();
    expect(view.getAllByRole('checkbox').every((option) => option.props.accessibilityState.disabled)).toBe(true);
    expect(view.queryByText('提交投票')).toBeNull();

    await view.rerender(<TopicPolls {...pollProps({ canWritePollSource: false, source: 'nodeseek' })} />);
    expect(view.getByLabelText('登录后投票').props.accessibilityState.disabled).toBe(true);
  });

  it('[REG-TOPIC-026] renders duplicated accepted-answer polls as results without a login action', async () => {
    const view = await render(
      <TopicPolls {...pollProps({ canWritePollSource: false, source: undefined })} />
    );

    expect(view.getByText('只读结果')).toBeTruthy();
    expect(view.getByText('3 人参与')).toBeTruthy();
    expect(view.queryByText('未登录')).toBeNull();
    expect(view.queryByLabelText('登录后投票')).toBeNull();
    expect(view.queryByText('提交投票')).toBeNull();
  });

  it('renders reply content and routes quote, user and NodeSeek actions through callbacks', async () => {
    const onInteract = jest.fn();
    const onOpenUser = jest.fn();
    const onReplyToFloor = jest.fn();
    const onToggleReplyQuote = jest.fn();
    const quotedReply: Reply = {
      author: 'quoted-user',
      contentHtml: '<p>被引用内容</p>',
      createdAt: '2026-07-14T00:00:00.000Z',
      floor: 1
    };
    const props = replyProps({
      loadedQuotedReplies: { 'nodeseek:topic-1:1': quotedReply },
      onInteract,
      onOpenUser,
      onReplyToFloor,
      onToggleReplyQuote
    });
    const view = await render(<ReplyItem {...props} />);

    expect(view.getByText('正文内容')).toBeTruthy();
    expect(view.getByText('OP')).toBeTruthy();
    expect(view.queryByText('被引用内容')).toBeNull();
    await fireEvent.press(view.getByText('展开'));
    expect(onToggleReplyQuote).toHaveBeenCalledWith({ replyFloor: 2, quotedFloor: 1, quotedReply });

    await view.rerender(<ReplyItem {...props} expandedQuotes={{ 'reply:2:nodeseek:topic-1:1': true }} />);
    expect(view.getByText('被引用内容')).toBeTruthy();
    await fireEvent.press(view.getByText('回复 @bob'));
    expect(onOpenUser).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', username: 'bob' }));

    await fireEvent.press(view.getByLabelText('回复'));
    await fireEvent.press(view.getByLabelText('点赞'));
    await fireEvent.press(view.getByLabelText('加鸡腿'));
    await fireEvent.press(view.getByLabelText('反对'));
    expect(onReplyToFloor).toHaveBeenCalledWith(props.reply);
    expect(onInteract.mock.calls).toEqual([
      ['upvote', 22],
      ['like', 22],
      ['dislike', 22]
    ]);
  });

  it('keeps a linux.do quote preview visible and reveals only the matching complete post on expand', async () => {
    const onToggleReplyQuote = jest.fn();
    const quotedReply: Reply = {
      author: 'quoted-user',
      contentHtml: '<p>完整帖子正文</p>',
      createdAt: '2026-07-14T00:00:00.000Z',
      floor: 1
    };
    const reply: Reply = {
      ...replyProps().reply,
      quotedPreviews: { 1: '引用简介' }
    };
    const props = replyProps({
      loadedQuotedReplies: {
        'linuxdo:other-topic:1': { ...quotedReply, contentHtml: '<p>错误主题内容</p>' },
        'linuxdo:topic-1:1': quotedReply
      },
      onToggleReplyQuote,
      repliesByFloor: new Map(),
      reply,
      source: 'linuxdo'
    });
    const view = await render(<ReplyItem {...props} />);

    expect(view.getByText('引用简介')).toBeTruthy();
    expect(view.queryByText('完整帖子正文')).toBeNull();
    expect(view.queryByText('错误主题内容')).toBeNull();
    await fireEvent.press(view.getByText('展开'));
    expect(onToggleReplyQuote).toHaveBeenCalledWith({ replyFloor: 2, quotedFloor: 1, quotedReply });

    await view.rerender(
      <ReplyItem {...props} expandedQuotes={{ 'reply:2:linuxdo:topic-1:1': true }} />
    );
    expect(view.getByText('引用简介')).toBeTruthy();
    expect(view.getByText('完整帖子正文')).toBeTruthy();
    expect(view.queryByText('错误主题内容')).toBeNull();
  });

  it.each(['linuxdo', 'xiaoyinsi'] as const)(
    '[REG-TOPIC-026] renders an accepted %s reply as the solved answer without replacing normal reply behavior',
    async (source) => {
      const reply: Reply = {
        ...replyProps().reply,
        acceptedAnswer: true,
        contentHtml: '<p>答案正文</p>',
        quotedFloors: [],
        replyTargetAuthor: undefined
      };
      const view = await render(
        <ReplyItem {...replyProps({ reply, source })} />
      );

      expect(view.getByLabelText('已采纳的解决方案')).toBeTruthy();
      expect(view.getByText('已解决')).toBeTruthy();
      expect(view.getByLabelText('解决方案')).toBeTruthy();
      expect(view.queryByText('✓ 解决方案')).toBeNull();
      expect(view.getByText('答案正文')).toBeTruthy();
      expect(view.getByText('#2')).toBeTruthy();
      expect(view.getByLabelText('回复')).toBeTruthy();
      expect(view.queryByText('已采纳')).toBeNull();
    }
  );

  it.each([
    ['linuxdo', 'closed.enabled', '关闭了主题'],
    ['xiaoyinsi', 'closed.disabled', '重新打开了主题']
  ] as Array<['linuxdo' | 'xiaoyinsi', string, string]>)(
    '[REG-TOPIC-026] renders a %s system post as the compact “%s” event',
    async (source, actionCode, expectedAction) => {
      const reply: Reply = {
        ...replyProps().reply,
        actionCode,
        author: 'CyrilXu',
        authorLevelLabel: 'Lv1',
        canDelete: true,
        canEdit: true,
        canLike: true,
        contentHtml: '',
        floor: 3,
        quotedFloors: [],
        reactionSummary: [{ id: 'heart', count: 1 }],
        replyTargetAuthor: undefined,
        systemAction: true
      };
      const view = await render(
        <ReplyItem
          {...replyProps({ canUseDiscourseActions: true, reply, replyFloor: 3, source })}
        />
      );

      expect(view.getByLabelText(new RegExp(`系统事件.*${expectedAction}`))).toBeTruthy();
      expect(view.getByText(expectedAction)).toBeTruthy();
      expect(view.queryByText('Lv1')).toBeNull();
      expect(view.queryByText('系统')).toBeNull();
      expect(view.queryByText('#3')).toBeNull();
      expect(view.queryByLabelText('回复')).toBeNull();
      expect(view.queryByLabelText('编辑回复')).toBeNull();
      expect(view.queryByLabelText('点赞')).toBeNull();
      expect(view.queryByLabelText('删除回复')).toBeNull();
      expect(view.queryByLabelText('heart 1')).toBeNull();
    }
  );

  it.each([
    ['xiaoyinsi', '<p>移动了主题</p>', '移动了主题'],
    ['linuxdo', '', '更新了主题'],
    ['xiaoyinsi', '<p>topic.mystery</p>', '更新了主题'],
    ['linuxdo', '<p>执行 topic.mystery</p>', '更新了主题']
  ] as Array<['linuxdo' | 'xiaoyinsi', string, string]>)(
    '[REG-TOPIC-026] gives an unknown %s system action a readable fallback',
    async (source, contentHtml, expectedAction) => {
      const reply: Reply = {
        ...replyProps().reply,
        actionCode: 'topic.mystery',
        contentHtml,
        quotedFloors: [],
        replyTargetAuthor: undefined,
        systemAction: true
      };
      const view = await render(
        <ReplyItem {...replyProps({ reply, source })} />
      );

      expect(view.getByText(expectedAction)).toBeTruthy();
      expect(view.queryByText('topic.mystery')).toBeNull();
    }
  );

  it('keeps the topic-body quote preview separate from its complete post', async () => {
    const onOpenReference = jest.fn();
    const onToggle = jest.fn();
    const view = await render(
      <TopicBodyQuoteCard
        expanded={false}
        header={(
          <Pressable accessibilityLabel="正文引用标题" onPress={onOpenReference}>
            <Text>正文引用作者</Text>
          </Pressable>
        )}
        loading={false}
        preview={<Text>正文引用简介</Text>}
        previewTestID="topic-quote-preview-20-1"
        styles={styles}
        testID="topic-quote-20-1"
        theme={theme}
        onToggle={onToggle}
      />
    );

    expect(view.getByTestId('topic-quote-preview-20-1')).toBeTruthy();
    expect(view.getByText('正文引用简介')).toBeTruthy();
    expect(view.queryByText('正文引用完整帖子')).toBeNull();
    await fireEvent.press(view.getByLabelText('正文引用标题'));
    expect(onOpenReference).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
    await fireEvent.press(view.getByText('展开'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    await view.rerender(
      <TopicBodyQuoteCard
        completeContent={<Text>正文引用完整帖子</Text>}
        completeTestID="topic-quote-complete-20-1"
        expanded
        header={<Text>正文引用作者</Text>}
        loading={false}
        preview={<Text>正文引用简介</Text>}
        previewTestID="topic-quote-preview-20-1"
        styles={styles}
        testID="topic-quote-20-1"
        theme={theme}
        onToggle={onToggle}
      />
    );
    expect(view.getByTestId('topic-quote-complete-20-1')).toBeTruthy();
    expect(view.getByText('正文引用简介')).toBeTruthy();
    expect(view.getByText('正文引用完整帖子')).toBeTruthy();
  });

  it('exposes only the actions allowed by each reply source', async () => {
    const onDeleteReply = jest.fn();
    const onEditReply = jest.fn();
    const writableReply: Reply = {
      ...replyProps().reply,
      canDelete: true,
      canEdit: true,
      canLike: true
    };
    const view = await render(
      <ReplyItem
        {...replyProps({ onDeleteReply, onEditReply, reply: writableReply, source: 'linuxdo' })}
      />
    );

    expect(view.getByLabelText('编辑回复')).toBeTruthy();
    expect(view.getByLabelText('删除回复')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('编辑回复'));
    await fireEvent.press(view.getByLabelText('删除回复'));
    expect(onEditReply).toHaveBeenCalledWith(writableReply);
    expect(onDeleteReply).toHaveBeenCalledWith(writableReply);

    await view.rerender(<ReplyItem {...replyProps({ reply: writableReply, source: 'v2ex' })} />);
    expect(view.queryByLabelText('回复')).toBeNull();
    expect(view.queryByLabelText('编辑回复')).toBeNull();
    expect(view.queryByLabelText('删除回复')).toBeNull();
  });

  it('[REG-XIAOYINSI-007] separates 小隐寺 reply permission from per-post interaction permissions', async () => {
    const writableReply: Reply = {
      ...replyProps().reply,
      canDelete: true,
      canEdit: true,
      canLike: true,
      contentHtml: '<p>回复正文</p><div class="poll" data-poll-name="poll-1"></div>',
      polls: [multiplePoll]
    };
    const view = await render(
      <ReplyItem
        {...replyProps({
          canUseDiscourseActions: true,
          canWrite: false,
          reply: writableReply,
          source: 'xiaoyinsi'
        })}
      />
    );

    expect(view.queryByLabelText('回复')).toBeNull();
    expect(view.getByLabelText('编辑回复')).toBeTruthy();
    expect(view.getByLabelText('点赞')).toBeTruthy();
    expect(view.getByLabelText('删除回复')).toBeTruthy();
    expect(view.getByText('可投票')).toBeTruthy();
    expect(view.getAllByRole('checkbox').every((option) => !option.props.accessibilityState.disabled)).toBe(true);
  });

  it('[REG-XIAOYINSI-017] shows 小隐寺 reply reaction images without write authorization', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      reactionSummary: [
        { id: 'heart', count: 2 },
        { id: '+1', count: 1 }
      ]
    };
    const view = await render(
      <ReplyItem
        {...replyProps({
          canUseDiscourseActions: false,
          canWrite: false,
          discourseEmojiUrls: {
            heart: 'https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15',
            '+1': 'https://forum.xiaoyinsi.com/images/emoji/twitter/+1.png?v=15'
          },
          reply,
          source: 'xiaoyinsi'
        })}
      />
    );

    expect(view.getByLabelText('heart 2')).toBeTruthy();
    expect(view.getByLabelText('+1 1')).toBeTruthy();
    expect(view.getByLabelText('emoji image https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15')).toBeTruthy();
    expect(view.getByLabelText('emoji image https://forum.xiaoyinsi.com/images/emoji/twitter/+1.png?v=15')).toBeTruthy();
  });

  it('keeps the composer sheet visibility and close gesture connected to the parent state', async () => {
    const onReplyComposerOpenChange = jest.fn();
    const props: ComponentProps<typeof ReplyComposerSheet> = {
      actionBusy: false,
      replyContent: '保留中的草稿',
      replyEditTarget: null,
      replyFace: '',
      replyTarget: null,
      source: 'nodeseek',
      styles,
      theme,
      visible: true,
      onReplyComposerOpenChange,
      onReplyContentChange: jest.fn(),
      onReplyFaceChange: jest.fn(),
      onSubmitReply: jest.fn(),
      onUploadReplyImage: jest.fn()
    };
    const view = await render(
      <View>
        <ReplyComposerSheet {...props} />
        <Pressable><Text>页面其余内容</Text></Pressable>
      </View>
    );

    expect(view.getByPlaceholderText('输入回复内容').props.value).toBe('保留中的草稿');
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(false);
    await view.rerender(<ReplyComposerSheet {...props} actionBusy />);
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    await view.rerender(<ReplyComposerSheet {...props} />);
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('模拟关闭回复面板'));
    expect(onReplyComposerOpenChange).toHaveBeenCalledWith(false);

    await view.rerender(<ReplyComposerSheet {...props} visible={false} />);
    expect(view.queryByPlaceholderText('输入回复内容')).toBeNull();
  });
});
