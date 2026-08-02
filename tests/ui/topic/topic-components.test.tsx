import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { fireEvent, render, within } from '../render';
import React, { type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RenderHTMLConfigProvider } from 'react-native-render-html';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { HTML_REPLY_CONTENT_CLASS } from '@/features/topic/rendering/htmlStyles';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReplyComposerSheet } from '@/features/topic/components/ReplyComposerSheet';
import { ReplyItem } from '@/features/topic/components/ReplyItem';
import { TopicBodyQuoteCard } from '@/features/topic/components/TopicBodyQuoteCard';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { TopicPolls } from '@/features/topic/components/TopicPolls';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import { createTopicImageDeriver } from '@/features/topic/model/topicDerivedData';
import type { Reply, TopicDetail, TopicPoll } from '@/domain/forum/models';
import type {
  TopicActionDecision,
  TopicActionDecisionFor,
  TopicActionDecisionRequest
} from '@/features/topic/actions/topicActionDecision';
import {
  DISCOURSE_CALLOUT_ATTRIBUTE,
  DISCOURSE_CALLOUT_CONTENT_CLASS,
  DISCOURSE_CALLOUT_TITLE_CLASS,
  DISCOURSE_CALLOUT_TYPE_ATTRIBUTE
} from '@/domain/forum/callouts';

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
    BottomSheetView: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(NativeView, null, children)
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('react-native-gesture-handler', () => ({
  ScrollView: require('react-native').ScrollView
}));

jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

jest.mock('react-native-webview', () => ({ WebView: () => null }));

jest.mock('react-native-render-html', () => {
  const ReactModule = require('react') as typeof React;
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView
  } = require('react-native') as typeof import('react-native');
  const RenderersPropsContext = ReactModule.createContext<
    Record<
      string,
      {
        onPress?: (event: { stopPropagation: () => void }, href: string) => void;
      }
    >
  >({});
  const nodeText = (node: { children?: unknown[]; data?: unknown }): string =>
    `${typeof node.data === 'string' ? node.data : ''}${
      Array.isArray(node.children)
        ? node.children.map((child) => nodeText(child as { children?: unknown[]; data?: unknown })).join('')
        : ''
    }`;
  return {
    RenderHTMLConfigProvider: ({
      children,
      renderersProps = {}
    }: {
      children?: React.ReactNode;
      renderersProps?: Record<string, { onPress?: (event: { stopPropagation: () => void }, href: string) => void }>;
    }) => ReactModule.createElement(RenderersPropsContext.Provider, { value: renderersProps }, children),
    RenderHTMLSource: ({ contentWidth, source }: { contentWidth: number; source: { html: string } }) => {
      const renderersProps = ReactModule.useContext(RenderersPropsContext);
      const links = Array.from(source.html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a\s*>/gi));
      return ReactModule.createElement(
        NativeView,
        { accessibilityHint: source.html, style: { width: contentWidth }, testID: 'html-source' },
        ReactModule.createElement(NativeText, null, source.html.replace(/<[^>]+>/g, '')),
        ...links.map((link, index) => {
          const label = link[2].replace(/<[^>]+>/g, '').trim();
          return ReactModule.createElement(
            NativePressable,
            {
              key: `${label}-${index}`,
              onPress: () => renderersProps.a?.onPress?.({ stopPropagation: () => undefined }, link[1]),
              testID: `html-link-${label}`
            },
            ReactModule.createElement(NativeText, null, label)
          );
        })
      );
    },
    TChildrenRenderer: ({ tchildren }: { tchildren: { children?: unknown[]; data?: unknown; nodeIndex?: number }[] }) =>
      ReactModule.createElement(
        NativeView,
        null,
        ...tchildren.map((child, index) =>
          ReactModule.createElement(NativeText, { key: child.nodeIndex ?? index }, nodeText(child))
        )
      )
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    CheckCircle: Icon,
    Check: Icon,
    CheckSquare: Icon,
    Bug: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    Circle: Icon,
    CircleCheck: Icon,
    CircleHelp: Icon,
    ClipboardList: Icon,
    Drumstick: Icon,
    Flame: Icon,
    Lightbulb: Icon,
    List: Icon,
    MessageCircle: Icon,
    Pencil: Icon,
    Quote: Icon,
    Square: Icon,
    SquarePen: Icon,
    ThumbsDown: Icon,
    ThumbsUp: Icon,
    TriangleAlert: Icon,
    Trash2: Icon,
    Users: Icon,
    X: Icon,
    Zap: Icon
  };
});

jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    Image: ({ source }: { source?: { headers?: Record<string, string>; uri?: string } }) =>
      ReactModule.createElement(NativeView, {
        accessibilityLabel: source?.uri ? `emoji image ${source.uri}` : 'emoji image',
        testID: source?.headers?.['X-WZ-Forum-Media-Source']
          ? `media-source-${source.headers['X-WZ-Forum-Media-Source']}`
          : undefined
      })
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

const deniedDecision = (reason: TopicActionDecision['reason']): TopicActionDecision => ({
  allowed: false,
  reason
});

const allowReplyTargetActions: TopicActionDecisionFor = ({ action, reply }) => {
  const allowed =
    action === 'edit'
      ? reply?.canEdit === true
      : action === 'delete'
        ? reply?.canDelete === true
        : reply?.canLike !== false;
  return allowed ? { allowed: true, reason: 'allowed' } : deniedDecision('object-forbidden');
};

const denyAllActions: TopicActionDecisionFor = () => deniedDecision('unsupported');
const allowInteractionsOnly: TopicActionDecisionFor = (request: TopicActionDecisionRequest) =>
  request.action === 'reply' ? deniedDecision('object-forbidden') : allowReplyTargetActions(request);

function pollProps(overrides: Partial<ComponentProps<typeof TopicPolls>> = {}): ComponentProps<typeof TopicPolls> {
  return {
    actionBusy: false,
    decisionFor: () => ({ allowed: true, reason: 'allowed' }),
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
    quotedPosts: [
      {
        reference: { source: 'nodeseek', topicId: 'topic-1', postNumber: 1 },
        author: { label: 'quoted-user', username: 'quoted-user' }
      }
    ],
    replyTargetAuthor: 'bob',
    upvoteCount: 3,
    likeCount: 4,
    dislikeCount: 1
  };
  return {
    actionBusy: false,
    decisionFor: allowReplyTargetActions,
    contentWidth: 720,
    expandedQuotes: {},
    inlineSizedImageUrls: {},
    isActionPending: () => false,
    loadedQuotedReplies: {},
    loadingQuotedFloors: {},
    onDeleteReply: jest.fn(),
    onEditReply: jest.fn(),
    onInteract: jest.fn(),
    onOpenTopic: jest.fn(),
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
    const view = await render(<TopicPolls {...pollProps({ decisionFor: denyAllActions, source: 'v2ex' })} />);

    expect(view.getByText('只读结果')).toBeTruthy();
    expect(view.getByText('3 人参与')).toBeTruthy();
    expect(view.getByText('2 票 · 67%')).toBeTruthy();
    expect(view.getAllByRole('checkbox').every((option) => option.props.accessibilityState.disabled)).toBe(true);
    expect(view.queryByText('提交投票')).toBeNull();

    await view.rerender(
      <TopicPolls {...pollProps({ decisionFor: () => deniedDecision('login-required'), source: 'nodeseek' })} />
    );
    expect(view.getByLabelText('登录后投票').props.accessibilityState.disabled).toBe(true);
  });

  it('[REG-TOPIC-026] renders duplicated accepted-answer polls as results without a login action', async () => {
    const view = await render(<TopicPolls {...pollProps({ decisionFor: denyAllActions, source: undefined })} />);

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
    expect(onToggleReplyQuote).toHaveBeenCalledWith({
      replyKey: 'comment:22',
      reference: { source: 'nodeseek', topicId: 'topic-1', postNumber: 1 },
      quotedReply
    });

    await view.rerender(<ReplyItem {...props} expandedQuotes={{ 'reply:comment:22:nodeseek:topic-1:1': true }} />);
    expect(view.getByText('被引用内容')).toBeTruthy();
    const replyTarget = view.getByText('回复 @bob');
    expect(replyTarget.parent?.props.hitSlop).toBe(12);
    expect(styles.replyTargetPill).not.toHaveProperty('minHeight');
    await fireEvent.press(replyTarget);
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

  it('[REG-TOPIC-047] keeps reply prose inset from the avatar column and article density separate', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>短评论</p>',
      quotedPosts: [],
      replyTargetAuthor: undefined,
      signatureHtml: '<p>签名内容</p>'
    };
    const replyView = await render(
      <ReplyItem {...replyProps({ contentWidth: 360, decisionFor: denyAllActions, reply, source: 'v2ex' })} />
    );

    const replySources = replyView.getAllByTestId('html-source');
    expect(replySources).toHaveLength(2);
    expect(replyView.getByTestId('reply-content-area')).toHaveStyle({ paddingLeft: 42, paddingRight: 0 });
    for (const source of replySources) {
      expect(source.props.style).toEqual({ width: 318 });
      expect(source.props.accessibilityHint).toContain(`class="${HTML_REPLY_CONTENT_CLASS}"`);
    }

    const articleView = await render(
      <TopicContentBlock
        contentWidth={360}
        html="<p>主楼正文</p>"
        inlineSizedImageUrls={{}}
        topicImageDeriver={topicImageDeriver}
      />
    );
    const articleSource = articleView.getByTestId('html-source');
    expect(articleSource.props.style).toEqual({ width: 360 });
    expect(articleSource.props.accessibilityHint).not.toContain(HTML_REPLY_CONTENT_CLASS);
  });

  it('[REG-TOPIC-039] routes actual body, reply, quote, and signature links through internal user navigation', async () => {
    const onOpenExternalUrl = jest.fn<(url: string) => void>();
    const onOpenUser = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenUser']>();
    const quotedReply: Reply = {
      author: 'quoted-source',
      contentHtml: '<a href="https://www.nodeseek.com/member?t=quote-target">引用用户</a>',
      createdAt: '2026-07-28T00:00:00.000Z',
      floor: 1
    };
    const reply: Reply = {
      author: 'reply-source',
      commentId: 22,
      contentHtml: '<a href="https://www.nodeseek.com/member?t=reply-target">回复用户</a>',
      createdAt: '2026-07-28T00:01:00.000Z',
      floor: 2,
      quotedPosts: [{ reference: { source: 'nodeseek', topicId: '832584', postNumber: 1 } }],
      signatureHtml: '<a href="https://www.nodeseek.com/member?t=signature-target">签名用户</a>'
    };
    const topic: TopicDetail = {
      author: 'topic-source',
      contentHtml: '<a href="https://www.nodeseek.com/member?t=body-target">正文用户</a>',
      createdAt: '2026-07-28T00:00:00.000Z',
      id: '832584',
      replyCount: 1,
      replies: [reply],
      source: 'nodeseek',
      title: '用户链接入口',
      url: 'https://www.nodeseek.com/post-832584-1'
    };

    function UserLinkEntryHarness() {
      const rendering = useHtmlRenderingController({
        mediaSessionIdentity: 'nodeseek:0',
        onOpenExternalUrl,
        onOpenImagePreview: () => undefined,
        onOpenTopic: () => undefined,
        onOpenUser,
        selectedTopic: topic,
        settings: readerData.settings,
        theme,
        topicDetail: topic,
        topicKey: 'nodeseek:832584',
        webViewBlockMessage: ''
      });
      return (
        <RenderHTMLConfigProvider renderers={rendering.htmlRenderers} renderersProps={rendering.htmlRenderersProps}>
          <TopicContentBlock
            baseUrl={topic.url}
            contentWidth={720}
            html={topic.contentHtml}
            inlineSizedImageUrls={{}}
            topicImageDeriver={topicImageDeriver}
          />
          <ReplyItem
            {...replyProps({
              expandedQuotes: { 'reply:comment:22:nodeseek:832584:1': true },
              loadedQuotedReplies: { 'nodeseek:832584:1': quotedReply },
              onOpenUser,
              reply,
              source: 'nodeseek',
              topicBaseUrl: topic.url,
              topicId: topic.id
            })}
          />
        </RenderHTMLConfigProvider>
      );
    }

    const view = await render(<UserLinkEntryHarness />);
    const entries = [
      ['正文用户', 'body-target'],
      ['回复用户', 'reply-target'],
      ['引用用户', 'quote-target'],
      ['签名用户', 'signature-target']
    ] as const;
    for (const [label] of entries) {
      await fireEvent.press(view.getByTestId(`html-link-${label}`));
    }

    expect(onOpenUser.mock.calls.map(([reference]) => reference)).toEqual(
      entries.map(([, username]) =>
        expect.objectContaining({
          source: 'nodeseek',
          username
        })
      )
    );
    expect(onOpenUser.mock.calls.every(([reference]) => !reference.id)).toBe(true);
    expect(onOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-053] renders and navigates a cross-topic linux.do reply quote with the matching complete post', async () => {
    const onOpenTopic = jest.fn();
    const onToggleReplyQuote = jest.fn();
    const quotedReply: Reply = {
      author: 'quoted-user',
      contentHtml: '<p>完整帖子正文</p>',
      createdAt: '2026-07-14T00:00:00.000Z',
      floor: 1
    };
    const wrongLocalReply = { ...quotedReply, contentHtml: '<p>当前主题同楼层错误内容</p>' };
    const reply: Reply = {
      ...replyProps().reply,
      quotedPosts: [
        {
          reference: { source: 'linuxdo', topicId: '2679944', postNumber: 1 },
          author: { label: 'quoted-user', username: 'quoted-user' },
          preview: '引用简介',
          topicTitle: '跨主题引用标题',
          topicUrl: 'https://linux.do/t/topic/2679944/1'
        }
      ]
    };
    const props = replyProps({
      loadedQuotedReplies: {
        'linuxdo:2679944:1': quotedReply
      },
      onOpenTopic,
      onToggleReplyQuote,
      repliesByFloor: new Map([[1, wrongLocalReply]]),
      reply,
      source: 'linuxdo',
      topicBaseUrl: 'https://linux.do/t/topic/2685882',
      topicId: '2685882'
    });
    const view = await render(<ReplyItem {...props} />);

    expect(view.getByText('引用简介')).toBeTruthy();
    expect(view.queryByText('完整帖子正文')).toBeNull();
    expect(view.queryByText('当前主题同楼层错误内容')).toBeNull();
    await fireEvent.press(view.getByRole('link', { name: '跨主题引用标题' }));
    expect(onOpenTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'linuxdo',
        id: '2679944',
        title: '跨主题引用标题'
      })
    );
    await fireEvent.press(view.getByText('展开'));
    expect(onToggleReplyQuote).toHaveBeenCalledWith({
      replyKey: 'comment:22',
      reference: { source: 'linuxdo', topicId: '2679944', postNumber: 1 },
      quotedReply
    });

    await view.rerender(<ReplyItem {...props} expandedQuotes={{ 'reply:comment:22:linuxdo:2679944:1': true }} />);
    expect(view.queryByText('引用简介')).toBeNull();
    expect(view.getByText('完整帖子正文')).toBeTruthy();
    expect(view.queryByText('当前主题同楼层错误内容')).toBeNull();
  });

  it('[REG-TOPIC-054] keeps a cached quote header stable before and after expansion', async () => {
    const author = '一位名字非常非常长的引用帖子作者 Long Display Name';
    const title = '一个很长的引用主题标题，用来确认窄屏下不会挤压头像、作者名和展开按钮';
    const reference = { source: 'linuxdo' as const, topicId: '342888', postNumber: 1 };
    const reply: Reply = {
      ...replyProps().reply,
      quotedPosts: [
        {
          reference,
          author: { label: author, username: 'long-author' },
          preview: '引用简介保持可见',
          topicTitle: title,
          topicUrl: 'https://linux.do/t/topic/342888/1'
        }
      ]
    };
    const longHtml = '<p>已缓存的引用正文</p>';
    const quotedReply: Reply = {
      author,
      authorAvatar: 'https://cdn.ldstatic.com/long-author.png',
      contentHtml: longHtml,
      createdAt: '2026-02-17T00:00:00.000Z',
      floor: 1
    };
    const onToggleReplyQuote = jest.fn();
    const loadedQuotedReplies = { 'linuxdo:342888:1': quotedReply };
    const props = replyProps({
      contentWidth: 360,
      loadedQuotedReplies,
      onToggleReplyQuote,
      reply,
      source: 'linuxdo',
      topicBaseUrl: 'https://linux.do/t/topic/2685882',
      topicId: '2685882'
    });
    const view = await render(<ReplyItem {...props} />);
    let quote = within(view.getByTestId('reply-quote-2-342888-1'));

    expect(quote.getAllByLabelText('avatar source linuxdo')).toHaveLength(1);
    expect(quote.getByText(author).props.numberOfLines).toBe(1);
    expect(quote.getByText(title).props.numberOfLines).toBe(2);
    await fireEvent.press(quote.getByText('展开'));
    expect(onToggleReplyQuote).toHaveBeenCalledWith({
      replyKey: 'comment:22',
      reference,
      quotedReply
    });

    await view.rerender(
      <ReplyItem
        {...props}
        expandedQuotes={{ 'reply:comment:22:linuxdo:342888:1': true }}
        loadedQuotedReplies={loadedQuotedReplies}
      />
    );
    quote = within(view.getByTestId('reply-quote-2-342888-1'));
    expect(quote.getAllByLabelText('avatar source linuxdo')).toHaveLength(1);
    expect(quote.getByText('已缓存的引用正文')).toBeTruthy();
  });

  it('[REG-TOPIC-053] rejects quote metadata whose source does not match the current Topic', async () => {
    const wrongLocalReply: Reply = {
      author: 'wrong-source',
      contentHtml: '<p>异站同主题号楼层错误内容</p>',
      createdAt: '2026-07-14T00:00:00.000Z',
      floor: 1
    };
    const reply: Reply = {
      ...replyProps().reply,
      quotedPosts: [
        {
          reference: { source: 'xiaoyinsi', topicId: '2685882', postNumber: 1 },
          preview: '不应显示的异站引用'
        }
      ]
    };
    const view = await render(
      <ReplyItem
        {...replyProps({
          expandedQuotes: { 'reply:comment:22:xiaoyinsi:2685882:1': true },
          repliesByFloor: new Map([[1, wrongLocalReply]]),
          reply,
          source: 'linuxdo',
          topicBaseUrl: 'https://linux.do/t/topic/2685882',
          topicId: '2685882'
        })}
      />
    );

    expect(view.queryByTestId('reply-quote-2-2685882-1')).toBeNull();
    expect(view.queryByText('不应显示的异站引用')).toBeNull();
    expect(view.queryByText('异站同主题号楼层错误内容')).toBeNull();
  });

  it('[REG-TOPIC-035] shows a display-only quoted author without creating a navigable username', async () => {
    const onOpenUser = jest.fn();
    const reply: Reply = {
      ...replyProps().reply,
      quotedPosts: [
        {
          reference: { source: 'linuxdo', topicId: 'topic-1', postNumber: 1 },
          author: { label: 'Alice Display' }
        }
      ]
    };
    const view = await render(<ReplyItem {...replyProps({ onOpenUser, reply, source: 'linuxdo' })} />);

    expect(view.getByText('Alice Display')).toBeTruthy();
    await fireEvent.press(view.getByText('Alice Display'));
    expect(onOpenUser).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-035] shows a reply target display name without guessing a Discourse username', async () => {
    const onOpenUser = jest.fn();
    const reply: Reply = {
      ...replyProps().reply,
      replyTargetAuthor: 'Alice Display',
      replyTargetUsername: undefined
    };
    const view = await render(<ReplyItem {...replyProps({ onOpenUser, reply, source: 'linuxdo' })} />);

    expect(view.getByText('回复 @Alice Display')).toBeTruthy();
    await fireEvent.press(view.getByText('回复 @Alice Display'));
    expect(onOpenUser).not.toHaveBeenCalled();
  });

  it.each(['linuxdo', 'xiaoyinsi'] as const)(
    '[REG-TOPIC-026] renders an accepted %s reply as the solved answer without replacing normal reply behavior',
    async (source) => {
      const reply: Reply = {
        ...replyProps().reply,
        acceptedAnswer: true,
        contentHtml: '<p>答案正文</p>',
        quotedPosts: [],
        replyTargetAuthor: undefined
      };
      const view = await render(<ReplyItem {...replyProps({ reply, source })} />);

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
  ] as ['linuxdo' | 'xiaoyinsi', string, string][])(
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
        quotedPosts: [],
        reactionSummary: [{ id: 'heart', count: 1 }],
        replyTargetAuthor: undefined,
        systemAction: true
      };
      const view = await render(<ReplyItem {...replyProps({ reply, replyFloor: 3, source })} />);

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
  ] as ['linuxdo' | 'xiaoyinsi', string, string][])(
    '[REG-TOPIC-026] gives an unknown %s system action a readable fallback',
    async (source, contentHtml, expectedAction) => {
      const reply: Reply = {
        ...replyProps().reply,
        actionCode: 'topic.mystery',
        contentHtml,
        quotedPosts: [],
        replyTargetAuthor: undefined,
        systemAction: true
      };
      const view = await render(<ReplyItem {...replyProps({ reply, source })} />);

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
        header={
          <Pressable accessibilityLabel="正文引用标题" onPress={onOpenReference}>
            <Text>正文引用作者</Text>
          </Pressable>
        }
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
        expanded
        header={<Text>正文引用作者</Text>}
        loading
        preview={<Text>正文引用简介</Text>}
        previewTestID="topic-quote-preview-20-1"
        styles={styles}
        testID="topic-quote-20-1"
        theme={theme}
        onToggle={onToggle}
      />
    );
    expect(view.getByTestId('topic-quote-preview-20-1')).toBeTruthy();

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
    expect(view.queryByText('正文引用简介')).toBeNull();
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
      <ReplyItem {...replyProps({ onDeleteReply, onEditReply, reply: writableReply, source: 'linuxdo' })} />
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

  it('keeps signature, reactions, and available actions independent', async () => {
    const fullReply: Reply = {
      ...replyProps().reply,
      canLike: true,
      liked: true,
      quotedPosts: [],
      reactionSummary: [{ id: 'heart', count: 2 }],
      replyTargetAuthor: undefined,
      signatureHtml: '<p>签名内容</p>'
    };
    const view = await render(
      <ReplyItem
        {...replyProps({
          discourseEmojiUrls: {
            heart: 'https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15'
          },
          reply: fullReply,
          source: 'xiaoyinsi'
        })}
      />
    );

    expect(view.getByText('签名内容')).toBeTruthy();
    expect(view.getByLabelText('heart 2')).toBeTruthy();
    expect(view.getByLabelText('回复')).toBeTruthy();
    expect(view.getByLabelText('取消赞')).toBeTruthy();

    await view.rerender(
      <ReplyItem
        {...replyProps({
          decisionFor: denyAllActions,
          reply: {
            ...fullReply,
            canLike: false,
            liked: false,
            reactionSummary: undefined,
            signatureHtml: undefined
          },
          source: 'v2ex'
        })}
      />
    );
    expect(view.queryByText('签名内容')).toBeNull();
    expect(view.queryByLabelText('heart 2')).toBeNull();
    expect(view.queryByLabelText('回复')).toBeNull();
    expect(view.queryByLabelText('取消赞')).toBeNull();
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
          decisionFor: allowInteractionsOnly,
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
          decisionFor: denyAllActions,
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
    expect(
      view.getByLabelText('emoji image https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15')
    ).toBeTruthy();
    expect(
      view.getByLabelText('emoji image https://forum.xiaoyinsi.com/images/emoji/twitter/+1.png?v=15')
    ).toBeTruthy();
    expect(view.getAllByTestId('media-source-xiaoyinsi')).toHaveLength(2);
    expect(view.getAllByLabelText('avatar source xiaoyinsi').length).toBeGreaterThan(0);
  });

  it('[REG-TOPIC-056] routes only canonical Discourse blockquotes through the shared Callout renderer', async () => {
    const onOpenExternalUrl = jest.fn();
    const discourseTopic: TopicDetail = {
      author: 'alice',
      contentHtml: '',
      createdAt: '2026-08-01T00:00:00.000Z',
      id: 'callout-topic',
      replies: [],
      replyCount: 0,
      source: 'linuxdo',
      title: 'Callout renderer',
      url: 'https://linux.do/t/topic/callout-topic'
    };
    const controller = await renderHook(() =>
      useHtmlRenderingController({
        mediaSessionIdentity: 'linuxdo:0',
        onOpenExternalUrl,
        onOpenImagePreview: () => undefined,
        onOpenTopic: () => undefined,
        onOpenUser: () => undefined,
        selectedTopic: discourseTopic,
        settings: readerData.settings,
        theme,
        topicDetail: discourseTopic,
        topicKey: 'linuxdo:callout-topic',
        webViewBlockMessage: ''
      })
    );
    const BlockquoteRenderer = controller.result.current.htmlRenderers.blockquote as unknown as React.ComponentType<
      Record<string, unknown>
    >;
    const InternalRenderer = () => <Text>普通引用 renderer</Text>;
    const canonicalTNode = {
      attributes: {
        [DISCOURSE_CALLOUT_ATTRIBUTE]: 'true',
        [DISCOURSE_CALLOUT_TYPE_ATTRIBUTE]: 'warning'
      },
      children: [
        {
          attributes: { class: DISCOURSE_CALLOUT_TITLE_CLASS },
          children: [{ data: '警告标题', nodeIndex: 1, type: 'text' }],
          nodeIndex: 0,
          tagName: 'div'
        },
        {
          attributes: { class: DISCOURSE_CALLOUT_CONTENT_CLASS },
          children: [{ data: 'Callout 正文', nodeIndex: 3, type: 'text' }],
          nodeIndex: 2,
          tagName: 'div'
        }
      ],
      nodeIndex: 0,
      parent: null,
      tagName: 'blockquote'
    };

    const callout = await render(
      <BlockquoteRenderer InternalRenderer={InternalRenderer} style={{}} tnode={canonicalTNode} />
    );
    expect(callout.getByText('警告标题')).toBeTruthy();
    expect(callout.getByText('Callout 正文')).toBeTruthy();
    expect(callout.queryByText('普通引用 renderer')).toBeNull();

    const ordinary = await render(
      <BlockquoteRenderer
        InternalRenderer={InternalRenderer}
        style={{}}
        tnode={{ attributes: {}, children: [], nodeIndex: 0, parent: null, tagName: 'blockquote' }}
      />
    );
    expect(ordinary.getByText('普通引用 renderer')).toBeTruthy();

    const nodeSeekTopic = {
      ...discourseTopic,
      source: 'nodeseek' as const,
      url: 'https://www.nodeseek.com/post-callout-topic-1'
    };
    const nonDiscourseController = await renderHook(() =>
      useHtmlRenderingController({
        mediaSessionIdentity: 'nodeseek:0',
        onOpenExternalUrl,
        onOpenImagePreview: () => undefined,
        onOpenTopic: () => undefined,
        onOpenUser: () => undefined,
        selectedTopic: nodeSeekTopic,
        settings: readerData.settings,
        theme,
        topicDetail: nodeSeekTopic,
        topicKey: 'nodeseek:callout-topic',
        webViewBlockMessage: ''
      })
    );
    const NonDiscourseBlockquoteRenderer = nonDiscourseController.result.current.htmlRenderers
      .blockquote as unknown as React.ComponentType<Record<string, unknown>>;
    const forged = await render(
      <NonDiscourseBlockquoteRenderer InternalRenderer={InternalRenderer} style={{}} tnode={canonicalTNode} />
    );
    expect(forged.getByText('普通引用 renderer')).toBeTruthy();

    const event = { stopPropagation: jest.fn() };
    controller.result.current.htmlRenderersProps.a?.onPress?.(
      event as never,
      'https://example.com/path',
      {} as never,
      {} as never
    );
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onOpenExternalUrl).toHaveBeenCalledWith('https://example.com/path');
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
        <Pressable>
          <Text>页面其余内容</Text>
        </Pressable>
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
