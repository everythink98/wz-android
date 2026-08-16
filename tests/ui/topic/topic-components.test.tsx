import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { fireEvent, render, within } from '../render';
import React, { type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RenderHTMLConfigProvider } from 'react-native-render-html';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReplyComposerSheet } from '@/features/topic/components/ReplyComposerSheet';
import { MemoizedReplyItem, ReplyItem } from '@/features/topic/components/ReplyItem';
import { TopicBodyQuoteCard } from '@/features/topic/components/TopicBodyQuoteCard';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { TopicPolls } from '@/features/topic/components/TopicPolls';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import {
  buildVirtualizedReplyItems as buildVirtualizedReplyItemsFromPlan,
  getReplyKey,
  type TopicReplyListItem
} from '@/features/topic/model/replyListModel';
import {
  prepareReplyContent,
  compileForumContent,
  type ForumContentMaterializationRegion,
  type ForumContentSelectableRegion,
  type ForumContentSemanticContinuation
} from '@/domain/forum/topicContentSplit';
import { forumContentRegionForSegment } from '../../helpers/forumContentSegments';
import {
  TopicSplitDisclosureProvider,
  topicMaterializationRegionVisible,
  useTopicSplitDisclosureStore
} from '@/features/topic/rendering/TopicSplitDisclosure';
import type { ForumSelectionDocument, ForumSelectionNode } from '@/features/topic/rendering/forumSelectionDocument';
import type { Reply, Source, TopicDetail, TopicPoll } from '@/domain/forum/models';
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

jest.mock('react-native-gesture-handler', () => {
  const chain = () => {
    const gesture: Record<string, any> = {};
    for (const name of [
      'activeOffsetX',
      'blocksExternalGesture',
      'enabled',
      'failOffsetY',
      'manualActivation',
      'maxPointers',
      'onBegin',
      'onEnd',
      'onTouchesDown',
      'onTouchesMove',
      'onUpdate'
    ]) {
      gesture[name] = () => gesture;
    }
    return gesture;
  };
  return {
    Gesture: { Native: chain, Pan: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    ScrollView: require('react-native').ScrollView
  };
});

jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

jest.mock('react-native-webview', () => ({ WebView: () => null }));

jest.mock('react-native-render-html', () => {
  const actual = jest.requireActual('react-native-render-html') as typeof import('react-native-render-html');
  const ReactModule = require('react') as typeof React;
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView
  } = require('react-native') as typeof import('react-native');
  const { forumSelectionTestEngine } =
    require('../../helpers/forumSelectionEngine') as typeof import('../../helpers/forumSelectionEngine');
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
    ...actual,
    RenderHTMLConfigProvider: ({
      children,
      renderersProps = {}
    }: {
      children?: React.ReactNode;
      renderersProps?: Record<string, { onPress?: (event: { stopPropagation: () => void }, href: string) => void }>;
    }) => ReactModule.createElement(RenderersPropsContext.Provider, { value: renderersProps }, children),
    RenderHTMLSource: function RenderHTMLSource({
      contentWidth,
      source
    }: {
      contentWidth: number;
      source: { html: string };
    }) {
      const renderersProps = ReactModule.useContext(RenderersPropsContext);
      const { useContentBoundarySpacing } =
        require('@/features/topic/rendering/TopicContentPresentation') as typeof import('@/features/topic/rendering/TopicContentPresentation');
      const boundarySpacing = useContentBoundarySpacing({ parent: null } as never);
      const links = Array.from(source.html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a\s*>/gi));
      return ReactModule.createElement(
        NativeView,
        {
          accessibilityHint: source.html,
          style: { width: contentWidth, ...boundarySpacing },
          testID: 'html-source'
        },
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
      ),
    TNodeRenderer: ({ tnode }: { tnode: { attributes: Readonly<Record<string, string>>; tagName?: string } }) =>
      ReactModule.createElement(NativeView, {
        accessibilityHint: JSON.stringify({ attributes: tnode.attributes, tagName: tnode.tagName }),
        testID: 'tnode-renderer'
      }),
    useAmbientTRenderEngine: () => forumSelectionTestEngine
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

function buildVirtualizedReplyItems(options: Parameters<typeof buildVirtualizedReplyItemsFromPlan>[0]) {
  const source = options.source;
  if (!source) return buildVirtualizedReplyItemsFromPlan(options);
  return buildVirtualizedReplyItemsFromPlan({
    ...options,
    loadedQuotedReplies: Object.fromEntries(
      Object.entries(options.loadedQuotedReplies).map(([key, reply]) => [
        key,
        prepareReplyContent(reply, key.split(':')[0] as Source)
      ])
    ),
    replies: options.replies.map((reply) => prepareReplyContent(reply, source)),
    repliesByFloor: new Map(
      [...options.repliesByFloor].map(([floor, reply]) => [floor, prepareReplyContent(reply, source)])
    )
  });
}

function compiledRichText(html: string, role: 'opening' | 'quoted-reply' | 'reply' | 'signature' = 'reply') {
  const region = compileForumContent({ html, role, source: 'nodeseek' }).regions.find(
    (candidate): candidate is ForumContentSelectableRegion =>
      candidate.kind === 'selectable' && candidate.segments.some((segment) => segment.type === 'richText')
  );
  if (!region) throw new Error('Expected one rich-text region.');
  return region;
}

function semanticRegionContinuation(
  region: ForumContentSelectableRegion,
  semanticContinuation: ForumContentSemanticContinuation
): ForumContentSelectableRegion {
  return {
    ...region,
    segments: region.segments.map((segment) => ({ ...segment, semanticContinuation }))
  };
}

function nativeSelectionDocument(surface: { props: Record<string, unknown> }) {
  return JSON.parse(String(surface.props.content)) as ForumSelectionDocument;
}

function selectionNodes(nodes: readonly ForumSelectionNode[]): ForumSelectionNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.type === 'block' || node.type === 'listItem' ? selectionNodes(node.children) : []),
    ...(node.type === 'table'
      ? node.rows.flatMap((row) => row.cells.flatMap((cell) => selectionNodes(cell.children)))
      : [])
  ]);
}

function selectionEdgeMargin(nodes: readonly ForumSelectionNode[], edge: 'leading' | 'trailing'): number | undefined {
  const node = nodes[edge === 'leading' ? 0 : nodes.length - 1];
  if (!node || node.type === 'table') return undefined;
  const key = edge === 'leading' ? 'marginTop' : 'marginBottom';
  if (typeof node.style[key] === 'number') return node.style[key];
  if (node.type === 'block' || node.type === 'listItem') {
    return selectionEdgeMargin(node.children, edge);
  }
  return undefined;
}

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
    replyTarget: { floor: 1, author: { name: 'bob', username: 'bob' } },
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
    loadedQuotedReplies: {},
    loadingQuotedFloors: {},
    onDeleteReply: jest.fn(),
    onEditReply: jest.fn(),
    onInteract: jest.fn(),
    onLinkPress: jest.fn(),
    onLocateReply: jest.fn(),
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
    topicStateKey: 'nodeseek:topic-1',
    ...overrides
  };
}

type RenderableReplyListItem = Extract<TopicReplyListItem, { reply: Reply }>;

function VirtualizedReplyRows({
  contentVisible,
  props
}: {
  contentVisible?: (region: ForumContentMaterializationRegion) => boolean;
  props: ComponentProps<typeof ReplyItem>;
}) {
  const items = buildVirtualizedReplyItems({
    expandedQuotes: props.expandedQuotes,
    loadedQuotedReplies: props.loadedQuotedReplies,
    loadingQuotedFloors: props.loadingQuotedFloors,
    replies: [props.reply],
    repliesByFloor: props.repliesByFloor,
    source: props.source,
    topicId: props.topicId
  })
    .filter((item): item is RenderableReplyListItem => 'reply' in item)
    .filter((item) => item.type !== 'replyContent' || !contentVisible || contentVisible(item.content));
  return (
    <>
      {items.map((item) => (
        <ReplyItem
          {...props}
          bodyContent={item.type === 'reply' ? item.bodyContent : undefined}
          key={item.key}
          reply={item.reply}
          replyFloor={item.replyFloor}
          section={item.type === 'reply' ? undefined : item}
          signatureContent={item.type === 'reply' ? item.signatureContent : undefined}
        />
      ))}
    </>
  );
}

function VirtualizedTerminalReplyRows({ props }: { props: ComponentProps<typeof ReplyItem> }) {
  const store = useTopicSplitDisclosureStore(props.topicStateKey);
  const scopeKey = `reply:${getReplyKey(props.reply)}:body`;
  return (
    <TopicSplitDisclosureProvider value={store}>
      <VirtualizedReplyRows
        contentVisible={(region) => topicMaterializationRegionVisible(region, scopeKey, store)}
        props={props}
      />
    </TopicSplitDisclosureProvider>
  );
}

describe('Topic real child components', () => {
  it('[REG-PERF-018] rerenders only the compiled reply row whose inline image state changed', async () => {
    const firstImage = 'https://i.imgur.com/first-dynamic.png';
    const secondImage = 'https://i.imgur.com/second-dynamic.png';
    const replyRow = (url: string) => {
      const region = compileForumContent({
        html: `<p><img class="embedded_image" src="${url}"></p>`,
        role: 'reply',
        source: 'v2ex'
      }).regions.find((candidate): candidate is ForumContentSelectableRegion => candidate.kind === 'selectable');
      if (!region) throw new Error('Expected one dynamic reply region.');
      return region;
    };
    const firstReply = { ...replyProps().reply, contentHtml: `<img src="${firstImage}">`, floor: 1 };
    const secondReply = { ...replyProps().reply, contentHtml: `<img src="${secondImage}">`, floor: 2 };
    const firstRow = replyRow(firstImage);
    const secondRow = replyRow(secondImage);
    const firstRender = jest.fn();
    const secondRender = jest.fn();
    const countedStyles = (onReplyRender: () => void) =>
      new Proxy(styles, {
        get(target, property, receiver) {
          if (property === 'replyCard') onReplyRender();
          return Reflect.get(target, property, receiver);
        }
      });
    const firstProps = replyProps({
      reply: firstReply,
      replyFloor: 1,
      section: {
        type: 'replyContent',
        key: 'comment:1:body:dynamic',
        reply: firstReply,
        replyFloor: 1,
        content: firstRow,
        first: true,
        last: true
      },
      source: 'v2ex',
      styles: countedStyles(firstRender)
    });
    const secondProps = replyProps({
      reply: secondReply,
      section: {
        type: 'replyContent',
        key: 'comment:2:body:dynamic',
        reply: secondReply,
        replyFloor: 2,
        content: secondRow,
        first: true,
        last: true
      },
      source: 'v2ex',
      styles: countedStyles(secondRender)
    });
    const rows = (inlineSizedImageUrls: Record<string, true>) => (
      <>
        <MemoizedReplyItem key="first" {...firstProps} inlineSizedImageUrls={inlineSizedImageUrls} />
        <MemoizedReplyItem key="second" {...secondProps} inlineSizedImageUrls={inlineSizedImageUrls} />
      </>
    );
    const view = await render(rows({}));
    firstRender.mockClear();
    secondRender.mockClear();

    await view.rerender(rows({ [firstImage]: true }));

    expect(firstRender).toHaveBeenCalled();
    expect(secondRender).not.toHaveBeenCalled();
    const renderedNodes = view
      .getAllByTestId('tnode-renderer')
      .map(
        (node) =>
          JSON.parse(node.props.accessibilityHint as string) as { attributes: Record<string, string>; tagName: string }
      );
    expect(renderedNodes[0]).toMatchObject({ attributes: { src: firstImage }, tagName: 'forum-inline-image' });
    expect(renderedNodes[1]).toMatchObject({
      attributes: { class: 'embedded_image', src: secondImage },
      tagName: 'img'
    });
  });

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

  it('[REG-ACCOUNT-041] keeps an unavailable poll identity typed as awaiting reconciliation', async () => {
    const onVotePoll = jest.fn();
    const view = await render(
      <TopicPolls
        {...pollProps({
          decisionFor: () => deniedDecision('identity-unavailable'),
          onVotePoll,
          pollSelections: { 'topic-poll-1': ['a', 'b'] },
          source: 'nodeseek'
        })}
      />
    );

    expect(view.getByText('账号待核对')).toBeTruthy();
    expect(view.getByLabelText('核对后投票').props.accessibilityState.disabled).toBe(true);
    expect(view.queryByText('未登录')).toBeNull();
    await fireEvent.press(view.getByLabelText('核对后投票'));
    expect(onVotePoll).not.toHaveBeenCalled();
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
    const onLocateReply = jest.fn();
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
      onLocateReply,
      onOpenUser,
      onReplyToFloor,
      onToggleReplyQuote
    });
    const view = await render(<VirtualizedReplyRows props={props} />);

    expect(view.getByText('正文内容')).toBeTruthy();
    expect(view.getByText('OP')).toBeTruthy();
    expect(view.queryByText('被引用内容')).toBeNull();
    await fireEvent.press(view.getByText('展开'));
    expect(onToggleReplyQuote).toHaveBeenCalledWith({
      replyKey: 'comment:22',
      reference: { source: 'nodeseek', topicId: 'topic-1', postNumber: 1 },
      quotedReply: expect.objectContaining({ ...quotedReply })
    });

    await view.rerender(
      <VirtualizedReplyRows props={{ ...props, expandedQuotes: { 'reply:comment:22:nodeseek:topic-1:1': true } }} />
    );
    expect(view.getByText('被引用内容')).toBeTruthy();
    await fireEvent.press(view.getByText('引用 #1'));
    expect(onLocateReply).toHaveBeenCalledWith({ floor: 1 });
    const replyTarget = view.getByText('@bob');
    expect(replyTarget.parent?.props.hitSlop).toBe(12);
    await fireEvent.press(replyTarget);
    expect(onOpenUser).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', username: 'bob' }));
    await fireEvent.press(view.getByText('#1'));
    expect(onLocateReply).toHaveBeenCalledWith({ floor: 1 });
    await fireEvent.press(view.getByText('#2'));
    expect(onLocateReply).toHaveBeenCalledWith({ floor: 2 });

    await fireEvent.press(view.getByLabelText('回复'));
    await fireEvent.press(view.getByLabelText('点赞'));
    await fireEvent.press(view.getByLabelText('加鸡腿'));
    await fireEvent.press(view.getByLabelText('反对'));
    expect(onReplyToFloor).toHaveBeenCalledWith(expect.objectContaining({ ...props.reply }));
    expect(onInteract.mock.calls).toEqual([
      ['upvote', 22],
      ['like', 22],
      ['dislike', 22]
    ]);
  });

  it('[REG-PERF-010] renders one virtualized reply-content row with row-local search highlighting', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>whole reply must not render here</p>',
      quotedPosts: [],
      signatureHtml: '<p>signature must not render here</p>'
    };
    const section: Extract<TopicReplyListItem, { type: 'replyContent' }> = {
      type: 'replyContent',
      key: 'comment:22:body:chunk-1',
      reply,
      replyFloor: 2,
      content: compiledRichText('<p>needle chunk only</p>'),
      first: true,
      last: false
    };
    const view = await render(<ReplyItem {...replyProps({ query: 'needle', reply, section })} />);

    const surfaces = view.getAllByTestId('native-forum-selection-surface');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].props.query).toBe('needle');
    expect(view.getByText('needle chunk only')).toBeTruthy();
    expect(view.queryByText('whole reply must not render here')).toBeNull();
    expect(view.queryByText('signature must not render here')).toBeNull();
    expect(view.queryByLabelText('回复')).toBeNull();
  });

  it('[REG-TOPIC-087] keeps reply target in reply-start and virtualized body out of reply-end', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>virtualized reply body</p>',
      quotedPosts: [],
      signatureHtml: '<p>virtualized reply signature</p>'
    };
    const endSection: Extract<TopicReplyListItem, { type: 'replyEnd' }> = {
      type: 'replyEnd',
      key: 'comment:22:body',
      reply,
      replyFloor: 2,
      bodyVirtualized: true,
      signatureVirtualized: true
    };
    const view = await render(<ReplyItem {...replyProps({ reply, section: endSection })} />);

    expect(view.queryByText('virtualized reply body')).toBeNull();
    expect(view.queryByText('virtualized reply signature')).toBeNull();
    expect(view.queryByText('@bob')).toBeNull();
    expect(view.getByLabelText('回复')).toBeTruthy();

    const startSection: Extract<TopicReplyListItem, { type: 'replyStart' }> = {
      type: 'replyStart',
      key: 'comment:22',
      reply,
      replyFloor: 2
    };
    await view.rerender(<ReplyItem {...replyProps({ reply, section: startSection })} />);

    expect(view.getByText('@bob')).toBeTruthy();
    expect(view.queryByLabelText('回复')).toBeNull();
  });

  it('[REG-TOPIC-087] keeps reply target before the single virtualized code owner', async () => {
    const codeLines = Array.from(
      { length: 52 },
      (_, index) => `<span>code-line-${String(index + 1).padStart(2, '0')}</span>\n`
    ).join('');
    const props = replyProps({
      reply: {
        ...replyProps().reply,
        contentHtml: `<pre>${codeLines}</pre>`,
        quotedPosts: []
      }
    });
    const view = await render(<VirtualizedReplyRows props={props} />);
    const visibleText = JSON.stringify(view.toJSON());

    expect(view.getByText('@bob')).toBeTruthy();
    expect(view.getAllByTestId('topic-code-frame')).toHaveLength(1);
    expect(visibleText.indexOf('"children":["@","bob"]')).toBeLessThan(visibleText.indexOf('code-line-01'));
    expect(visibleText.indexOf('code-line-01')).toBeLessThan(visibleText.indexOf('code-line-52'));
  });

  it('[REG-TOPIC-090] carries terminal tabs through reply modeling, filtering, and real row rendering', async () => {
    const props = replyProps({
      reply: {
        ...replyProps().reply,
        contentHtml:
          '<forum-terminal-report>' +
          '<forum-terminal-tab title="Overview"><div class="forum-terminal-code">overview result</div></forum-terminal-tab>' +
          '<forum-terminal-tab title="Benchmark"><div class="forum-terminal-code">benchmark result</div></forum-terminal-tab>' +
          '</forum-terminal-report>',
        quotedPosts: []
      }
    });
    const view = await render(<VirtualizedTerminalReplyRows props={props} />);

    expect(view.getByText('overview result')).toBeTruthy();
    expect(view.queryByText('benchmark result')).toBeNull();
    await fireEvent.press(view.getByRole('tab', { name: 'Benchmark' }));
    expect(view.queryByText('overview result')).toBeNull();
    expect(view.getByText('benchmark result')).toBeTruthy();

    await view.rerender(<VirtualizedTerminalReplyRows props={{ ...props }} />);
    expect(view.getByText('benchmark result')).toBeTruthy();
  });

  it('[REG-PERF-010] renders a virtualized signature as its own reply row', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>body must stay in its own row</p>',
      quotedPosts: [],
      signatureHtml: '<p>whole signature must not render here</p>'
    };
    const section: Extract<TopicReplyListItem, { type: 'replySignatureContent' }> = {
      type: 'replySignatureContent',
      key: 'comment:22:signature:chunk-1',
      reply,
      replyFloor: 2,
      content: compiledRichText('<p>signature chunk only</p>', 'signature'),
      first: true,
      last: false
    };
    const view = await render(<ReplyItem {...replyProps({ reply, section })} />);

    expect(view.getAllByTestId('native-forum-selection-surface')).toHaveLength(1);
    expect(view.getByText('signature chunk only')).toBeTruthy();
    expect(view.queryByText('body must stay in its own row')).toBeNull();
    expect(view.queryByText('whole signature must not render here')).toBeNull();
    expect(view.queryByLabelText('回复')).toBeNull();
  });

  it('[REG-PERF-010] applies the same continuation boundary to reply, quote, and signature rows', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>whole reply stays outside this row</p>',
      quotedPosts: [],
      signatureHtml: '<p>whole signature stays outside this row</p>'
    };
    const sections: TopicReplyListItem[] = [
      {
        type: 'replyContent',
        key: 'comment:22:body:middle',
        reply,
        replyFloor: 2,
        content: semanticRegionContinuation(compiledRichText('<p>reply middle</p>'), 'middle'),
        first: false,
        last: false
      },
      {
        type: 'replyQuoteContent',
        key: 'comment:22:quote:middle',
        contentToken: 'quote-token',
        reply,
        replyFloor: 2,
        instanceKey: 'reply:comment:22:nodeseek:topic-1:1',
        measureForMaterialization: false,
        reference: { source: 'nodeseek', topicId: 'topic-1', postNumber: 1 },
        content: semanticRegionContinuation(compiledRichText('<p>quote middle</p>', 'quoted-reply'), 'middle'),
        first: false,
        last: false
      },
      {
        type: 'replySignatureContent',
        key: 'comment:22:signature:middle',
        reply,
        replyFloor: 2,
        content: semanticRegionContinuation(compiledRichText('<p>signature middle</p>', 'signature'), 'middle'),
        first: false,
        last: false
      }
    ];

    for (const section of sections) {
      const view = await render(
        <ReplyItem
          {...replyProps({
            reply,
            section: section as Extract<
              TopicReplyListItem,
              { type: 'replyContent' | 'replyQuoteContent' | 'replySignatureContent' }
            >
          })}
        />
      );
      const document = nativeSelectionDocument(view.getByTestId('native-forum-selection-surface'));
      expect(selectionEdgeMargin(document.nodes, 'leading')).toBe(0);
      expect(selectionEdgeMargin(document.nodes, 'trailing')).toBe(0);
      await view.unmount();
    }
  });

  it('[REG-PERF-010] preserves a reply poll when its body is virtualized into direct rows', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>body lives in another row</p>',
      polls: [multiplePoll],
      quotedPosts: []
    };
    const pollRegion = compileForumContent({
      html: '',
      polls: [multiplePoll],
      role: 'reply',
      source: 'linuxdo'
    }).regions[0];
    if (!pollRegion || pollRegion.kind !== 'island' || pollRegion.segment.type !== 'poll') {
      throw new Error('Expected one poll island.');
    }
    const section: Extract<TopicReplyListItem, { type: 'replyContent' }> = {
      type: 'replyContent',
      key: 'comment:22:body:poll-1',
      reply,
      replyFloor: 2,
      content: forumContentRegionForSegment(pollRegion.segment),
      first: false,
      last: true
    };
    const view = await render(<ReplyItem {...replyProps({ reply, section, source: 'linuxdo' })} />);

    expect(view.getByText('选择两个答案')).toBeTruthy();
    expect(view.getByText('选项甲')).toBeTruthy();
    expect(view.queryByText('body lives in another row')).toBeNull();
    expect(view.queryByLabelText('回复')).toBeNull();
  });

  it('[REG-TOPIC-067] removes the divider after the confirmed terminal reply', async () => {
    const view = await render(<ReplyItem {...replyProps({ isTerminal: true })} />);
    const terminalStyle = StyleSheet.flatten(view.getByTestId('terminal-reply').props.style);

    expect(terminalStyle).toMatchObject({ borderBottomWidth: 0 });
  });

  it('[REG-TOPIC-067] removes the divider after a terminal system event', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      actionCode: 'closed.enabled',
      contentHtml: '',
      systemAction: true
    };
    const view = await render(<ReplyItem {...replyProps({ isTerminal: true, reply, source: 'linuxdo' })} />);
    const terminalStyle = StyleSheet.flatten(view.getByLabelText(/系统事件/).props.style);

    expect(terminalStyle).toMatchObject({ borderBottomWidth: 0 });
  });

  it('[REG-TOPIC-047] keeps reply prose inset from the avatar column and article density separate', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>短评论</p>',
      quotedPosts: [],
      replyTarget: undefined,
      signatureHtml: '<p>签名内容</p>'
    };
    const [plannedReply] = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [reply],
      repliesByFloor: new Map(),
      source: 'v2ex',
      topicId: 'topic-1'
    });
    expect(plannedReply.type).toBe('reply');
    if (plannedReply.type !== 'reply') throw new Error('Expected a single-cell reply fixture');
    const replyView = await render(
      <ReplyItem
        {...replyProps({
          bodyContent: plannedReply.bodyContent,
          contentWidth: 360,
          decisionFor: denyAllActions,
          reply,
          signatureContent: plannedReply.signatureContent,
          source: 'v2ex'
        })}
      />
    );

    const replySurfaces = replyView.getAllByTestId('native-forum-selection-surface');
    expect(replySurfaces).toHaveLength(2);
    expect(replyView.getByTestId('reply-content-area')).toHaveStyle({ paddingLeft: 42, paddingRight: 0 });
    for (const surface of replySurfaces) {
      expect(surface.props.contentWidth).toBe(318);
      expect(
        selectionNodes(nativeSelectionDocument(surface).nodes).some(
          (node) => node.type !== 'table' && node.style.fontSize === 15 && node.style.lineHeight === 24
        )
      ).toBe(true);
    }

    const articleView = await render(
      <TopicContentBlock contentWidth={360} region={compiledRichText('<p>主楼正文</p>', 'opening')} />
    );
    const articleSurface = articleView.getByTestId('native-forum-selection-surface');
    expect(articleSurface.props.contentWidth).toBe(360);
    expect(
      selectionNodes(nativeSelectionDocument(articleSurface).nodes).some(
        (node) => node.type !== 'table' && node.style.fontSize === 16 && node.style.lineHeight === 26
      )
    ).toBe(true);
  });

  it('[REG-PERF-010] presents exact continuation margins without rewriting the compiled row HTML', async () => {
    const expectations = [
      ['first', false, true],
      ['middle', true, true],
      ['last', true, false],
      ['only', false, false]
    ] as const;
    const compiledRow = compiledRichText('<h2>fragment</h2>');

    for (const [continuation, trimsLeading, trimsTrailing] of expectations) {
      const region = semanticRegionContinuation(compiledRow, continuation);
      const view = await render(<TopicContentBlock contentWidth={360} region={region} />);
      const surface = view.getByTestId('native-forum-selection-surface');
      expect(surface.props.content).toContain('fragment');
      expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ alignSelf: 'stretch' });
      const document = nativeSelectionDocument(surface);
      expect(selectionEdgeMargin(document.nodes, 'leading')).toBe(trimsLeading ? 0 : 18);
      expect(selectionEdgeMargin(document.nodes, 'trailing')).toBe(trimsTrailing ? 0 : 9);
      await view.unmount();
    }
  });

  it('[REG-TOPIC-100] closes one shared callout frame at the last segment in a selectable region', async () => {
    const compilation = compileForumContent({
      html: `<blockquote ${DISCOURSE_CALLOUT_ATTRIBUTE}="true" ${DISCOURSE_CALLOUT_TYPE_ATTRIBUTE}="note"><div class="${DISCOURSE_CALLOUT_TITLE_CLASS}">标题</div><div class="${DISCOURSE_CALLOUT_CONTENT_CLASS}"><p>正文</p><table><tbody><tr><td>表格</td></tr></tbody></table></div></blockquote>`,
      role: 'opening',
      source: 'linuxdo'
    });
    const region = compilation.regions.find(
      (candidate): candidate is ForumContentSelectableRegion =>
        candidate.kind === 'selectable' && candidate.segments.length === 2
    );
    if (!region) throw new Error('Expected one selectable callout body region.');

    const view = await render(<TopicContentBlock contentWidth={360} region={region} />);

    expect(view.getByTestId('forum-callout-body')).toHaveStyle({
      borderBottomWidth: StyleSheet.hairlineWidth,
      marginBottom: 12
    });
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
            contentWidth={720}
            region={compiledRichText(topic.contentHtml, 'opening')}
            onLinkPress={rendering.openHtmlLink}
          />
          <VirtualizedReplyRows
            props={replyProps({
              expandedQuotes: { 'reply:comment:22:nodeseek:832584:1': true },
              loadedQuotedReplies: { 'nodeseek:832584:1': quotedReply },
              onLinkPress: rendering.openHtmlLink,
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
    const hrefByLabel = {
      正文用户: 'https://www.nodeseek.com/member?t=body-target',
      回复用户: 'https://www.nodeseek.com/member?t=reply-target',
      引用用户: 'https://www.nodeseek.com/member?t=quote-target',
      签名用户: 'https://www.nodeseek.com/member?t=signature-target'
    } as const;
    for (const [label] of entries) {
      await fireEvent(view.getByText(label).parent!, 'linkPress', {
        nativeEvent: { href: hrefByLabel[label] }
      });
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

  it('[REG-TOPIC-062] routes a NodeSeek floor link with its native page hint', async () => {
    const onOpenTopic = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenTopic']>();
    const topic: TopicDetail = {
      author: 'alice',
      contentHtml: '<a href="https://www.nodeseek.com/post-832584-16#155">#155</a>',
      createdAt: '2026-07-28T00:00:00.000Z',
      id: '832584',
      replyCount: 200,
      replies: [],
      source: 'nodeseek',
      title: '楼层链接',
      url: 'https://www.nodeseek.com/post-832584-1'
    };
    function FloorLinkHarness() {
      const rendering = useHtmlRenderingController({
        mediaSessionIdentity: 'nodeseek:0',
        onOpenExternalUrl: jest.fn(),
        onOpenImagePreview: () => undefined,
        onOpenTopic,
        onOpenUser: () => undefined,
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
            contentWidth={720}
            region={compiledRichText(topic.contentHtml, 'opening')}
            onLinkPress={rendering.openHtmlLink}
          />
        </RenderHTMLConfigProvider>
      );
    }

    const view = await render(<FloorLinkHarness />);
    await fireEvent(view.getByTestId('native-forum-selection-surface'), 'linkPress', {
      nativeEvent: { href: 'https://www.nodeseek.com/post-832584-16#155' }
    });
    expect(onOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', id: '832584' }), {
      floor: 155,
      pageHint: 16
    });
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
    const view = await render(<VirtualizedReplyRows props={props} />);

    expect(view.getByText('引用简介')).toBeTruthy();
    expect(view.queryByText('完整帖子正文')).toBeNull();
    expect(view.queryByText('当前主题同楼层错误内容')).toBeNull();
    await fireEvent.press(view.getByRole('link', { name: '跨主题引用标题' }));
    expect(onOpenTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'linuxdo',
        id: '2679944',
        title: '跨主题引用标题'
      }),
      { floor: 1 }
    );
    await fireEvent.press(view.getByText('展开'));
    expect(onToggleReplyQuote).toHaveBeenCalledWith({
      replyKey: 'comment:22',
      reference: { source: 'linuxdo', topicId: '2679944', postNumber: 1 },
      quotedReply: expect.objectContaining({ ...quotedReply })
    });

    await view.rerender(
      <VirtualizedReplyRows props={{ ...props, expandedQuotes: { 'reply:comment:22:linuxdo:2679944:1': true } }} />
    );
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
    const view = await render(<VirtualizedReplyRows props={props} />);
    let quote = within(view.getByTestId('reply-quote-2-342888-1'));

    expect(quote.getAllByLabelText('avatar source linuxdo')).toHaveLength(1);
    expect(quote.getByText(author).props.numberOfLines).toBe(1);
    expect(quote.getByText(title).props.numberOfLines).toBe(2);
    await fireEvent.press(quote.getByText('展开'));
    expect(onToggleReplyQuote).toHaveBeenCalledWith({
      replyKey: 'comment:22',
      reference,
      quotedReply: expect.objectContaining({ ...quotedReply })
    });

    await view.rerender(
      <VirtualizedReplyRows
        props={{
          ...props,
          expandedQuotes: { 'reply:comment:22:linuxdo:342888:1': true },
          loadedQuotedReplies
        }}
      />
    );
    quote = within(view.getByTestId('reply-quote-2-342888-1'));
    expect(quote.getAllByLabelText('avatar source linuxdo')).toHaveLength(1);
    expect(quote.getByText(author).props.numberOfLines).toBe(1);
    expect(quote.getByText(title).props.numberOfLines).toBe(2);
    expect(view.getByText('已缓存的引用正文')).toBeTruthy();
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
      replyTarget: { author: { name: 'Alice Display' } }
    };
    const view = await render(<ReplyItem {...replyProps({ onOpenUser, reply, source: 'linuxdo' })} />);

    expect(view.getByText('@Alice Display')).toBeTruthy();
    await fireEvent.press(view.getByText('@Alice Display'));
    expect(onOpenUser).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-061][REG-TOPIC-062] gives the Yaohuo target author and floor independent destinations', async () => {
    const onOpenUser = jest.fn();
    const onLocateReply = jest.fn();
    const reply: Reply = {
      ...replyProps().reply,
      floor: 90,
      replyTarget: {
        floor: 88,
        author: {
          id: '45245',
          name: '流金岁月',
          url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=45245'
        }
      }
    };
    const view = await render(
      <ReplyItem {...replyProps({ onLocateReply, onOpenUser, reply, replyFloor: 90, source: 'yaohuo' })} />
    );

    await fireEvent.press(view.getByText('@流金岁月'));
    expect(onOpenUser).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yaohuo', id: '45245', displayName: '流金岁月' })
    );
    await fireEvent.press(view.getByText('#88'));
    expect(onLocateReply).toHaveBeenCalledWith({ floor: 88 });

    await view.rerender(
      <ReplyItem
        {...replyProps({
          onLocateReply,
          onOpenUser,
          reply: { ...reply, replyTarget: { floor: 30 } },
          replyFloor: 90,
          repliesByFloor: new Map([
            [
              30,
              {
                author: '补全用户',
                authorId: '7',
                authorUrl: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7',
                contentHtml: '<p>目标</p>',
                createdAt: '2026-08-05T00:00:00.000Z',
                floor: 30
              }
            ]
          ]),
          source: 'yaohuo'
        })}
      />
    );
    expect(view.getByText('@补全用户')).toBeTruthy();
    await fireEvent.press(view.getByText('#30'));
    expect(onLocateReply).toHaveBeenLastCalledWith({ floor: 30 });
  });

  it.each(['linuxdo', 'xiaoyinsi'] as const)(
    '[REG-TOPIC-026] renders an accepted %s reply as the solved answer without replacing normal reply behavior',
    async (source) => {
      const reply: Reply = {
        ...replyProps().reply,
        acceptedAnswer: true,
        contentHtml: '<p>答案正文</p>',
        quotedPosts: [],
        replyTarget: undefined
      };
      const [planned] = buildVirtualizedReplyItems({
        expandedQuotes: {},
        loadedQuotedReplies: {},
        loadingQuotedFloors: {},
        replies: [reply],
        repliesByFloor: new Map(),
        source,
        topicId: 'topic-1'
      });
      if (planned?.type !== 'reply') throw new Error('Expected a single-cell accepted reply.');
      const view = await render(
        <ReplyItem
          {...replyProps({
            bodyContent: planned.bodyContent,
            reply,
            signatureContent: planned.signatureContent,
            source
          })}
        />
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
        replyTarget: undefined,
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
        replyTarget: undefined,
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

  it('[REG-TOPIC-099] leaves the expanded topic quote header open for its external body rows', async () => {
    const view = await render(
      <TopicBodyQuoteCard
        completeContentMountedExternally
        expanded
        header={<Text>正文引用作者</Text>}
        loading={false}
        styles={styles}
        testID="topic-quote-continuous"
        theme={theme}
      />
    );

    expect(StyleSheet.flatten(view.getByTestId('topic-quote-continuous').props.style)).toMatchObject({
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      borderBottomWidth: 0
    });
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
      replyTarget: undefined,
      signatureHtml: '<p>签名内容</p>'
    };
    const [planned] = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [fullReply],
      repliesByFloor: new Map(),
      source: 'xiaoyinsi',
      topicId: 'topic-1'
    });
    if (planned?.type !== 'reply') throw new Error('Expected a single-cell signed reply.');
    const view = await render(
      <ReplyItem
        {...replyProps({
          bodyContent: planned.bodyContent,
          discourseEmojiUrls: {
            heart: 'https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15'
          },
          reply: fullReply,
          signatureContent: planned.signatureContent,
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
      <VirtualizedReplyRows
        props={replyProps({
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

  it('[REG-TOPIC-056] leaves blockquote rendering structural after Callout classification moved to the compiler', async () => {
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
    expect(callout.getByText('普通引用 renderer')).toBeTruthy();

    const ordinary = await render(
      <BlockquoteRenderer
        InternalRenderer={InternalRenderer}
        style={{}}
        tnode={{ attributes: {}, children: [], nodeIndex: 0, parent: null, tagName: 'blockquote' }}
      />
    );
    expect(ordinary.getByText('普通引用 renderer')).toBeTruthy();

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
