import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { act, fireEvent, render, waitFor, within } from '../render';
import React, { type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, ToastAndroid, type StyleProp, type ViewStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { RenderHTMLConfigProvider } from 'react-native-render-html';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReplyComposerSheet } from '@/features/topic/components/ReplyComposerSheet';
import { ReplyItem } from '@/features/topic/components/ReplyItem';
import * as TopicSelection from '@/features/topic/selection/TopicSelectionSurface';
import { TopicBodyQuoteCard } from '@/features/topic/components/TopicBodyQuoteCard';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { TopicPolls } from '@/features/topic/components/TopicPolls';
import { NodeSeekStardustCard } from '@/features/topic/components/NodeSeekStardustCard';
import type { TopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import {
  buildVirtualizedReplyItems as buildVirtualizedReplyItemsFromPlan,
  getReplyKey,
  type TopicReplyListItem
} from '@/features/topic/model/replyListModel';
import {
  compileForumContent,
  prepareReplyContent,
  type CompiledForumContentRow
} from '@/domain/forum/topicContentSplit';
import {
  TopicSplitDisclosureProvider,
  topicSemanticRowVisible,
  useTopicSplitDisclosureStore
} from '@/features/topic/rendering/TopicSplitDisclosure';
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

const mockAnimatedKeyboardStateSet = jest.fn();
const mockComposerBottomSheetClose = jest.fn();
let mockComposerBottomSheetOnClose: (() => void) | undefined;
let mockComposerBottomSheetProps: { index: number; snapPoints?: number[] } | undefined;

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
      android_keyboardInputMode,
      backdropComponent,
      bottomInset,
      children,
      enableContentPanningGesture,
      enablePanDownToClose,
      index,
      keyboardBehavior,
      onChange,
      onClose,
      snapPoints
    }: {
      android_keyboardInputMode?: string;
      backdropComponent?: (props: Record<string, unknown>) => React.ReactNode;
      bottomInset?: number;
      children?: React.ReactNode;
      enableContentPanningGesture?: boolean;
      enablePanDownToClose?: boolean;
      index: number;
      keyboardBehavior?: string;
      onChange?: (index: number) => void;
      onClose?: () => void;
      snapPoints?: number[];
    },
    ref
  ) {
    mockComposerBottomSheetOnClose = onClose;
    mockComposerBottomSheetProps = { index, snapPoints };
    ReactModule.useImperativeHandle(ref, () => ({ close: mockComposerBottomSheetClose }));
    return ReactModule.createElement(
      NativeView,
      {
        android_keyboardInputMode,
        bottomInset,
        enableContentPanningGesture,
        enablePanDownToClose,
        keyboardBehavior,
        onChange,
        testID: 'composer-bottom-sheet'
      } as React.ComponentProps<typeof NativeView>,
      backdropComponent?.({}),
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
    BottomSheetBackdrop: (props: Record<string, unknown>) =>
      ReactModule.createElement(NativeView, { ...props, testID: 'composer-bottom-sheet-backdrop' }),
    BottomSheetFlatList: (props: Record<string, unknown>) => ReactModule.createElement(NativeView, props),
    BottomSheetTextInput: ReactModule.forwardRef(function BottomSheetTextInput(props: Record<string, unknown>, ref) {
      void ref;
      return ReactModule.createElement(TextInput, props);
    }),
    BottomSheetView: ({ children, ...props }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) =>
      ReactModule.createElement(NativeView, { ...props, testID: 'composer-bottom-sheet-content' }, children),
    useBottomSheetInternal: () => ({ animatedKeyboardState: { set: mockAnimatedKeyboardStateSet } })
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 })
}));

jest.mock('react-native-gesture-handler', () => {
  return {
    GestureStateManager: { activate: jest.fn(), fail: jest.fn() },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    ScrollView: require('react-native').ScrollView,
    useNativeGesture: (config: Record<string, unknown> = {}) => ({ config }),
    usePanGesture: (config: Record<string, unknown> = {}) => ({ config })
  };
});

jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

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
    useContentWidth: () => 320,
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
    CodeXml: Icon,
    Copy: Icon,
    Drumstick: Icon,
    Flame: Icon,
    Lightbulb: Icon,
    List: Icon,
    MessageCircle: Icon,
    Maximize2: Icon,
    Minimize2: Icon,
    Pencil: Icon,
    Quote: Icon,
    Redo2: Icon,
    Square: Icon,
    SquarePen: Icon,
    ThumbsDown: Icon,
    ThumbsUp: Icon,
    TextCursorInput: Icon,
    TriangleAlert: Icon,
    Trash2: Icon,
    Undo2: Icon,
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
    Avatar: ({ contentSource, uri }: { contentSource?: string; uri?: string }) =>
      ReactModule.createElement(
        NativeText,
        { accessibilityHint: uri, accessibilityLabel: `avatar source ${contentSource || 'missing'}` },
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
  const row = compileForumContent({ html, role, source: 'nodeseek' }).rows.find(
    (candidate): candidate is Extract<CompiledForumContentRow, { type: 'richText' }> => candidate.type === 'richText'
  );
  if (!row) throw new Error('Expected one rich-text row.');
  return row;
}

function semanticRowPart<T extends CompiledForumContentRow>(row: T, part: T['part']): T {
  return { ...row, part };
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
    loadedQuotedReplies: {},
    loadingQuotedFloors: {},
    onDeleteReply: jest.fn(),
    onEditReply: jest.fn(),
    onInteract: jest.fn(),
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
  contentVisible?: (row: CompiledForumContentRow) => boolean;
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
      <VirtualizedReplyRows contentVisible={(row) => topicSemanticRowVisible(row, scopeKey, store)} props={props} />
    </TopicSplitDisclosureProvider>
  );
}

function stardustActions(
  loadNodeSeekStardustStatus: TopicActionsController['loadNodeSeekStardustStatus'],
  payNodeSeekStardust: TopicActionsController['payNodeSeekStardust'] = async () => 'canceled'
) {
  return {
    actionBusy: false,
    decisionFor: () => ({ allowed: true, reason: 'allowed' }),
    loadNodeSeekStardustStatus,
    payNodeSeekStardust
  } as unknown as TopicActionsController;
}

describe('Topic real child components', () => {
  it('keeps reply long-press copy available while opening-post selection is active', async () => {
    const selection = jest.spyOn(TopicSelection, 'useTopicSelectionRowRef').mockReturnValue({
      active: true,
      nativeID: undefined,
      ref: { current: null }
    });
    const copy = jest.mocked(Clipboard.setStringAsync);
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    copy.mockClear();
    try {
      const view = await render(<ReplyItem {...replyProps({ bodyContent: compiledRichText('<p>正文内容</p>') })} />);

      await fireEvent(view.getByTestId('html-source'), 'longPress');

      await waitFor(() => expect(copy).toHaveBeenCalledWith('正文内容'));
      await waitFor(() => expect(toast).toHaveBeenCalledWith('评论已复制', ToastAndroid.SHORT));
    } finally {
      toast.mockRestore();
      selection.mockRestore();
    }
  });

  it('renders the deterministic avatar and reloads only for real inputs', async () => {
    const receive = {
      receiverMemberId: '42',
      amount: 3,
      refId: 100,
      description: '测试收款',
      oneTime: false
    };
    const firstLoader = jest.fn(async () => ({ participantCount: 0, totalAmount: 0, paid: false, closed: false }));
    const secondLoader = jest.fn(async () => ({ participantCount: 1, totalAmount: 3, paid: false, closed: false }));
    const view = await render(<NodeSeekStardustCard actions={stardustActions(firstLoader)} receive={receive} />);

    await waitFor(() => expect(firstLoader).toHaveBeenCalledTimes(1));
    expect(view.getByLabelText('avatar source nodeseek').props.accessibilityHint).toBe(
      'https://www.nodeseek.com/avatar/42.png'
    );
    await view.rerender(<NodeSeekStardustCard actions={stardustActions(firstLoader)} receive={{ ...receive }} />);
    await act(async () => Promise.resolve());
    expect(firstLoader).toHaveBeenCalledTimes(1);

    await view.rerender(<NodeSeekStardustCard actions={stardustActions(secondLoader)} receive={{ ...receive }} />);
    await waitFor(() => expect(secondLoader).toHaveBeenCalledTimes(1));
  });

  it('keeps optional status failures silent while payment stays available', async () => {
    const receive = {
      receiverMemberId: '42',
      amount: 3,
      refId: 100,
      description: '测试收款',
      oneTime: false
    };
    const load = jest.fn(async () => {
      throw new Error('每天最多进行500次星辰记录查询');
    });
    const pay = jest.fn(async () => 'canceled' as const);
    const view = await render(<NodeSeekStardustCard actions={stardustActions(load, pay)} receive={receive} />);

    expect(view.queryByText('正在读取付款状态…')).toBeNull();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(view.queryByText('每天最多进行500次星辰记录查询')).toBeNull();
    expect(view.queryByLabelText('重试付款状态')).toBeNull();
    expect(view.getByLabelText('支付 3 Stardust').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('支付 3 Stardust'));
    expect(pay).toHaveBeenCalledWith(receive);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('allows repeat payments but keeps one-time and legacy cards closed', async () => {
    const repeatable = {
      receiverMemberId: '42',
      amount: 3,
      refId: 100,
      description: '可重复',
      oneTime: false
    };
    const pay = jest.fn(async () => 'canceled' as const);
    const paidStatus = jest.fn(async () => ({ participantCount: 1, totalAmount: 3, paid: true, closed: false }));
    const view = await render(<NodeSeekStardustCard actions={stardustActions(paidStatus, pay)} receive={repeatable} />);

    await waitFor(() => expect(view.getByText('当前账号已付款')).toBeTruthy());
    expect(view.getByLabelText('支付 3 Stardust').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('支付 3 Stardust'));
    expect(pay).toHaveBeenCalledTimes(1);

    const closed = { ...repeatable, oneTime: true };
    const closedStatus = jest.fn(async () => ({ participantCount: 1, totalAmount: 3, paid: true, closed: true }));
    await view.rerender(<NodeSeekStardustCard actions={stardustActions(closedStatus, pay)} receive={closed} />);
    await waitFor(() => expect(view.getByLabelText('已关闭').props.accessibilityState.disabled).toBe(true));

    const legacy = { ...repeatable, refId: 1 };
    await view.rerender(<NodeSeekStardustCard actions={stardustActions(paidStatus, pay)} receive={legacy} />);
    await waitFor(() => expect(view.getByText('此卡片的 Ref 无效，不能付款')).toBeTruthy());
    expect(view.getByLabelText('Ref 无效').props.accessibilityState.disabled).toBe(true);
  });

  it('blocks a second click after an ambiguous send', async () => {
    const receive = {
      receiverMemberId: '42',
      amount: 3,
      refId: 100,
      description: '测试收款',
      oneTime: false
    };
    const load = jest.fn(async () => ({ participantCount: 0, totalAmount: 0, paid: false, closed: false }));
    const pay = jest.fn(async () => 'unknown' as const);
    const view = await render(<NodeSeekStardustCard actions={stardustActions(load, pay)} receive={receive} />);

    await waitFor(() => expect(view.getByText('0 人已付 · 累计 0 Stardust')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('支付 3 Stardust'));
    await waitFor(() => expect(view.getByText('付款结果未知，请先在原站确认，切勿直接重复付款。')).toBeTruthy());
    expect(view.getByLabelText('结果待确认').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('结果待确认'));
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade an explicit success when status refresh fails', async () => {
    const receive = {
      receiverMemberId: '42',
      amount: 3,
      refId: 100,
      description: '测试收款',
      oneTime: false
    };
    const load = jest
      .fn<TopicActionsController['loadNodeSeekStardustStatus']>()
      .mockResolvedValueOnce({ participantCount: 0, totalAmount: 0, paid: false, closed: false })
      .mockRejectedValueOnce(new Error('每天最多进行500次星辰记录查询'));
    const pay = jest.fn(async () => 'submitted' as const);
    const view = await render(<NodeSeekStardustCard actions={stardustActions(load, pay)} receive={receive} />);

    await waitFor(() => expect(view.getByText('0 人已付 · 累计 0 Stardust')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('支付 3 Stardust'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => Promise.resolve());
    expect(view.queryByText('每天最多进行500次星辰记录查询')).toBeNull();
    expect(view.getByText('0 人已付 · 累计 0 Stardust')).toBeTruthy();
    expect(view.queryByText(/结果未知/)).toBeNull();
    expect(view.getByLabelText('支付 3 Stardust').props.accessibilityState.disabled).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);

    const staleLoad = jest.fn(async () => ({ participantCount: 0, totalAmount: 0, paid: false, closed: false }));
    await view.rerender(
      <NodeSeekStardustCard actions={stardustActions(staleLoad, pay)} receive={{ ...receive, oneTime: true }} />
    );
    await waitFor(() => expect(staleLoad).toHaveBeenCalledTimes(1));
    await fireEvent.press(view.getByLabelText('支付 3 Stardust'));
    await waitFor(() => expect(staleLoad).toHaveBeenCalledTimes(2));
    await act(async () => Promise.resolve());
    expect(view.getByLabelText('已关闭').props.accessibilityState.disabled).toBe(true);
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

  it('shows NodeSeek poll locking only for the current owner and labels locked polls', async () => {
    const onLockPoll = jest.fn();
    const ownerPoll = { ...multiplePoll, ownerId: '54874' };
    const ownerDecision: TopicActionDecisionFor = ({ action }) =>
      action === 'manage-poll' ? { allowed: true, reason: 'allowed' } : deniedDecision('already-complete');
    const view = await render(
      <TopicPolls
        {...pollProps({
          decisionFor: ownerDecision,
          onLockPoll,
          polls: [ownerPoll],
          source: 'nodeseek'
        })}
      />
    );

    await fireEvent.press(view.getByLabelText('锁定投票'));
    expect(onLockPoll).toHaveBeenCalledWith(ownerPoll);

    await view.rerender(
      <TopicPolls
        {...pollProps({
          decisionFor: ({ action }) =>
            action === 'manage-poll' ? deniedDecision('object-forbidden') : deniedDecision('already-complete'),
          onLockPoll,
          polls: [ownerPoll],
          source: 'nodeseek'
        })}
      />
    );
    expect(view.queryByLabelText('锁定投票')).toBeNull();

    await view.rerender(
      <TopicPolls
        {...pollProps({
          decisionFor: undefined,
          onLockPoll,
          polls: [ownerPoll],
          source: 'nodeseek'
        })}
      />
    );
    expect(view.queryByLabelText('锁定投票')).toBeNull();

    await view.rerender(
      <TopicPolls
        {...pollProps({
          decisionFor: ownerDecision,
          onLockPoll,
          polls: [{ ...ownerPoll, closed: true }],
          source: 'nodeseek'
        })}
      />
    );
    expect(view.getByText('已锁定')).toBeTruthy();
    expect(view.queryByLabelText('锁定投票')).toBeNull();
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

  it('keeps an unavailable poll identity typed as awaiting reconciliation', async () => {
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

  it('renders duplicated accepted-answer polls as results without a login action', async () => {
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

  it('renders one virtualized reply-content row with row-local search highlighting', async () => {
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

    const htmlSources = view.getAllByTestId('html-source');
    expect(htmlSources).toHaveLength(1);
    expect(htmlSources[0].props.accessibilityHint).toContain('<mark>needle</mark> chunk only');
    expect(view.queryByText('whole reply must not render here')).toBeNull();
    expect(view.queryByText('signature must not render here')).toBeNull();
    expect(view.queryByLabelText('回复')).toBeNull();
  });

  it('keeps reply target in reply-start and virtualized body out of reply-end', async () => {
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

  it('keeps reply target before the single virtualized code owner', async () => {
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

  it('carries terminal tabs through reply modeling, filtering, and real row rendering', async () => {
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

  it('renders a virtualized signature as its own reply row', async () => {
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

    const htmlSources = view.getAllByTestId('html-source');
    expect(htmlSources).toHaveLength(1);
    expect(htmlSources[0].props.accessibilityHint).toContain('signature chunk only');
    expect(view.queryByText('body must stay in its own row')).toBeNull();
    expect(view.queryByText('whole signature must not render here')).toBeNull();
    expect(view.queryByLabelText('回复')).toBeNull();
  });

  it('applies the same continuation boundary to reply, quote, and signature rows', async () => {
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
        content: semanticRowPart(compiledRichText('<p>reply middle</p>'), 'middle'),
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
        content: semanticRowPart(compiledRichText('<p>quote middle</p>', 'quoted-reply'), 'middle'),
        first: false,
        last: false
      },
      {
        type: 'replySignatureContent',
        key: 'comment:22:signature:middle',
        reply,
        replyFloor: 2,
        content: semanticRowPart(compiledRichText('<p>signature middle</p>', 'signature'), 'middle'),
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
      expect(StyleSheet.flatten(view.getByTestId('html-source').props.style)).toMatchObject({
        marginBottom: 0,
        marginTop: 0
      });
      await view.unmount();
    }
  });

  it('preserves a reply poll when its body is virtualized into direct rows', async () => {
    const reply: Reply = {
      ...replyProps().reply,
      contentHtml: '<p>body lives in another row</p>',
      polls: [multiplePoll],
      quotedPosts: []
    };
    const section: Extract<TopicReplyListItem, { type: 'replyContent' }> = {
      type: 'replyContent',
      key: 'comment:22:body:poll-1',
      reply,
      replyFloor: 2,
      content: compileForumContent({
        html: '',
        polls: [multiplePoll],
        role: 'reply',
        source: 'linuxdo'
      }).rows[0] as Extract<CompiledForumContentRow, { type: 'poll' }>,
      first: false,
      last: true
    };
    const view = await render(<ReplyItem {...replyProps({ reply, section, source: 'linuxdo' })} />);

    expect(view.getByText('选择两个答案')).toBeTruthy();
    expect(view.getByText('选项甲')).toBeTruthy();
    expect(view.queryByText('body lives in another row')).toBeNull();
    expect(view.queryByLabelText('回复')).toBeNull();
  });

  it('removes the divider after the confirmed terminal reply', async () => {
    const view = await render(<ReplyItem {...replyProps({ isTerminal: true })} />);
    const terminalStyle = StyleSheet.flatten(view.getByTestId('terminal-reply').props.style);

    expect(terminalStyle).toMatchObject({ borderBottomWidth: 0 });
  });

  it('removes the divider after a terminal system event', async () => {
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

  it('routes actual body, reply, quote, and signature links through internal user navigation', async () => {
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
        webViewBlockMessage: ''
      });
      return (
        <RenderHTMLConfigProvider renderers={rendering.htmlRenderers} renderersProps={rendering.htmlRenderersProps}>
          <TopicContentBlock contentWidth={720} row={compiledRichText(topic.contentHtml, 'opening')} />
          <VirtualizedReplyRows
            props={replyProps({
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

  it('routes a NodeSeek floor link with its native page hint', async () => {
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
        webViewBlockMessage: ''
      });
      return (
        <RenderHTMLConfigProvider renderers={rendering.htmlRenderers} renderersProps={rendering.htmlRenderersProps}>
          <TopicContentBlock contentWidth={720} row={compiledRichText(topic.contentHtml, 'opening')} />
        </RenderHTMLConfigProvider>
      );
    }

    const view = await render(<FloorLinkHarness />);
    await fireEvent.press(view.getByTestId('html-link-#155'));
    expect(onOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', id: '832584' }), {
      floor: 155,
      pageHint: 16
    });
  });

  it('renders and navigates a cross-topic linux.do reply quote with the matching complete post', async () => {
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

  it('keeps a cached quote header stable before and after expansion', async () => {
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

  it('rejects quote metadata whose source does not match the current Topic', async () => {
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
          reference: { source: 'linuxdo', topicId: '2685882', postNumber: 1 },
          preview: '不应显示的异站引用'
        }
      ]
    };
    const view = await render(
      <ReplyItem
        {...replyProps({
          expandedQuotes: { 'reply:comment:22:linuxdo:2685882:1': true },
          repliesByFloor: new Map([[1, wrongLocalReply]]),
          reply,
          source: 'nodeseek',
          topicBaseUrl: 'https://www.nodeseek.com/post-2685882-1',
          topicId: '2685882'
        })}
      />
    );

    expect(view.queryByTestId('reply-quote-2-2685882-1')).toBeNull();
    expect(view.queryByText('不应显示的异站引用')).toBeNull();
    expect(view.queryByText('异站同主题号楼层错误内容')).toBeNull();
  });

  it('shows a display-only quoted author without creating a navigable username', async () => {
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

  it('shows a reply target display name without guessing a Discourse username', async () => {
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

  it('gives the Yaohuo target author and floor independent destinations', async () => {
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

  it('renders an accepted linux.do reply as the solved answer without replacing normal reply behavior', async () => {
    const source = 'linuxdo' as const;
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
  });

  it.each([
    ['linuxdo', 'closed.enabled', '关闭了主题'],
    ['linuxdo', 'closed.disabled', '重新打开了主题']
  ] as ['linuxdo', string, string][])(
    'renders a %s system post as the compact “%s” event',
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
    ['linuxdo', '<p>移动了主题</p>', '移动了主题'],
    ['linuxdo', '', '更新了主题'],
    ['linuxdo', '<p>topic.mystery</p>', '更新了主题'],
    ['linuxdo', '<p>执行 topic.mystery</p>', '更新了主题']
  ] as ['linuxdo', string, string][])(
    'gives an unknown %s system action a readable fallback',
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

  it('leaves the expanded topic quote header open for its external body rows', async () => {
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
      source: 'linuxdo',
      topicId: 'topic-1'
    });
    if (planned?.type !== 'reply') throw new Error('Expected a single-cell signed reply.');
    const view = await render(
      <ReplyItem
        {...replyProps({
          bodyContent: planned.bodyContent,
          discourseEmojiUrls: {
            heart: 'https://linux.do/images/emoji/twitter/heart.png?v=15'
          },
          reply: fullReply,
          signatureContent: planned.signatureContent,
          source: 'linuxdo'
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

  it('separates linux.do reply permission from per-post interaction permissions', async () => {
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
          source: 'linuxdo'
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

  it('shows linux.do reply reaction images without write authorization', async () => {
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
            heart: 'https://linux.do/images/emoji/twitter/heart.png?v=15',
            '+1': 'https://linux.do/images/emoji/twitter/+1.png?v=15'
          },
          reply,
          source: 'linuxdo'
        })}
      />
    );

    expect(view.getByLabelText('heart 2')).toBeTruthy();
    expect(view.getByLabelText('+1 1')).toBeTruthy();
    expect(view.getByLabelText('emoji image https://linux.do/images/emoji/twitter/heart.png?v=15')).toBeTruthy();
    expect(view.getByLabelText('emoji image https://linux.do/images/emoji/twitter/+1.png?v=15')).toBeTruthy();
    expect(view.getAllByTestId('media-source-linuxdo')).toHaveLength(2);
    expect(view.getAllByLabelText('avatar source linuxdo').length).toBeGreaterThan(0);
  });

  it('leaves blockquote rendering structural after Callout classification moved to the compiler', async () => {
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
    mockAnimatedKeyboardStateSet.mockClear();
    const onReplyComposerOpenChange = jest.fn();
    const onReplySnapshot = jest.fn();
    const props: ComponentProps<typeof ReplyComposerSheet> = {
      actionBusy: false,
      intent: { kind: 'new' },
      replyContent: '保留中的草稿',
      replyFace: '',
      source: 'nodeseek',
      styles,
      theme,
      visible: true,
      onReplyComposerOpenChange,
      onReplyContentChange: jest.fn(),
      onReplyFaceChange: jest.fn(),
      onReplySnapshot,
      onSubmitReply: jest.fn(),
      onUploadReplyImage: jest.fn()
    };
    const view = await render(<ReplyComposerSheet {...props} />);

    expect(view.getByText('回复')).toBeTruthy();
    const sheetProps = view.getByTestId('composer-bottom-sheet').props;
    expect(sheetProps.android_keyboardInputMode).toBe('adjustPan');
    expect(sheetProps.bottomInset).toBe(0);
    expect(sheetProps.enableContentPanningGesture).toBe(false);
    expect(sheetProps.keyboardBehavior).toBe('interactive');
    const keyboardTargetSetter = mockAnimatedKeyboardStateSet.mock.calls
      .map(([setter]) => setter)
      .filter(
        (setter): setter is (state: { status: number; target?: number }) => { status: number; target?: number } =>
          typeof setter === 'function'
      )
      .find((setter) => setter({ status: 0 }).target !== undefined);
    expect(keyboardTargetSetter?.({ status: 0 }).target).toBeTruthy();
    expect(view.getByLabelText('富文本').props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText('全屏')).toBeTruthy();
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'READY', payload: { revision: 0 } }) }
    });
    await waitFor(() => expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('全屏'));
    expect(StyleSheet.flatten(view.getByTestId('composer-bottom-sheet-content').props.style)).toEqual(
      expect.objectContaining({ flex: 1, paddingBottom: 24 })
    );
    await fireEvent.press(view.getByLabelText('退出全屏'));
    await view.rerender(<ReplyComposerSheet {...props} actionBusy />);
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    await view.rerender(<ReplyComposerSheet {...props} />);
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(false);

    onReplySnapshot.mockClear();
    await view.rerender(<ReplyComposerSheet {...props} routeActive={false} />);
    const routeSnapshotRequest = [...webView.props.postMessageMock.mock.calls]
      .map(([message]: [string]) => JSON.parse(message))
      .findLast((message) => message.type === 'REQUEST_SNAPSHOT');
    expect(routeSnapshotRequest).toBeTruthy();
    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'SNAPSHOT',
          payload: {
            requestId: routeSnapshotRequest.payload.requestId,
            snapshot: {
              revision: 1,
              markdown: '路由离开前的草稿',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          }
        })
      }
    });
    await waitFor(() => expect(onReplySnapshot).toHaveBeenCalledTimes(1));
    await view.rerender(<ReplyComposerSheet {...props} />);

    await view.rerender(
      <ReplyComposerSheet {...props} intent={{ kind: 'floor', target: { author: '@bob', floor: 3 } }} />
    );
    expect(view.getByText('回复 @bob · #3')).toBeTruthy();
    expect(view.getByTestId('structured-composer-webview')).toBe(webView);
    expect(view.queryByPlaceholderText('输入楼层回复内容')).toBeNull();
    expect(view.getByLabelText('取消楼层回复')).toBeTruthy();

    const editIntent = {
      kind: 'edit' as const,
      target: {
        commentId: 9,
        contentMarkdown: '保留中的草稿',
        floor: 4,
        topicId: '1',
        ticket: { source: 'linuxdo' as const, identityKey: 'linuxdo:alice', sessionEpoch: 1 }
      }
    };
    await view.rerender(<ReplyComposerSheet {...props} intent={editIntent} />);
    expect(view.getByText('编辑 #4')).toBeTruthy();
    expect(view.queryByPlaceholderText('编辑回复内容')).toBeNull();
    expect(view.getByLabelText('取消编辑')).toBeTruthy();
    expect(view.getByLabelText('保存编辑')).toBeTruthy();

    onReplySnapshot.mockClear();
    await view.rerender(<ReplyComposerSheet {...props} visible={false} />);
    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'SNAPSHOT',
          payload: {
            snapshot: {
              revision: 1,
              markdown: '迟到的编辑正文',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          }
        })
      }
    });
    expect(onReplySnapshot).not.toHaveBeenCalled();

    await view.rerender(<ReplyComposerSheet {...props} />);
    onReplySnapshot.mockClear();
    await fireEvent.press(view.getByLabelText('模拟关闭回复面板'));
    const request = [...webView.props.postMessageMock.mock.calls]
      .map(([message]: [string]) => JSON.parse(message))
      .findLast((message) => message.type === 'REQUEST_SNAPSHOT');
    expect(request).toBeTruthy();
    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'SNAPSHOT',
          payload: {
            requestId: request.payload.requestId,
            snapshot: {
              revision: 1,
              markdown: '保留中的草稿',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          }
        })
      }
    });
    await waitFor(() => expect(onReplyComposerOpenChange).toHaveBeenCalledWith(false));
    expect(onReplySnapshot).toHaveBeenCalledTimes(1);
  });

  it('keeps one controlled close path while fullscreen closes', async () => {
    const { ComposerBottomSheet } =
      require('@/ui/sheets/ComposerBottomSheet') as typeof import('@/ui/sheets/ComposerBottomSheet');
    const onOpenChange = jest.fn();
    const onPresentationChange = jest.fn();
    mockComposerBottomSheetClose.mockClear();
    const view = await render(
      <ComposerBottomSheet
        dark={false}
        fixedContent
        presentation="sheet"
        visible
        onOpenChange={onOpenChange}
        onPresentationChange={onPresentationChange}
      >
        {() => <Text>编辑器</Text>}
      </ComposerBottomSheet>
    );
    expect(onPresentationChange).toHaveBeenCalledWith('sheet');
    onPresentationChange.mockClear();
    const sheetSnapPoints = mockComposerBottomSheetProps?.snapPoints;
    expect(mockComposerBottomSheetProps?.index).toBe(0);
    expect(sheetSnapPoints).toHaveLength(1);
    expect(view.getByTestId('composer-bottom-sheet')).toHaveProp('enablePanDownToClose', false);
    expect(view.getByTestId('composer-bottom-sheet-backdrop')).toHaveProp('pressBehavior', 'none');

    await view.rerender(
      <ComposerBottomSheet
        dark={false}
        fixedContent
        presentation="fullscreen"
        visible
        onOpenChange={onOpenChange}
        onPresentationChange={onPresentationChange}
      >
        {() => <Text>编辑器</Text>}
      </ComposerBottomSheet>
    );
    const openSnapPoints = mockComposerBottomSheetProps?.snapPoints;
    expect(mockComposerBottomSheetProps?.index).toBe(0);
    expect(openSnapPoints).toHaveLength(1);
    expect(openSnapPoints![0]).toBeGreaterThan(sheetSnapPoints![0]!);

    await view.rerender(
      <ComposerBottomSheet
        dark={false}
        fixedContent
        presentation="fullscreen"
        visible={false}
        onOpenChange={onOpenChange}
        onPresentationChange={onPresentationChange}
      >
        {() => <Text>编辑器</Text>}
      </ComposerBottomSheet>
    );
    expect(mockComposerBottomSheetProps).toEqual({ index: -1, snapPoints: openSnapPoints });
    expect(onPresentationChange).not.toHaveBeenCalled();
    expect(mockComposerBottomSheetClose).toHaveBeenCalledTimes(1);

    mockComposerBottomSheetOnClose?.();
    expect(onPresentationChange).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await view.rerender(
      <ComposerBottomSheet
        dark={false}
        fixedContent
        presentation="fullscreen"
        visible
        onOpenChange={onOpenChange}
        onPresentationChange={onPresentationChange}
      >
        {() => <Text>编辑器</Text>}
      </ComposerBottomSheet>
    );
    expect(onPresentationChange).toHaveBeenCalledWith('sheet');
  });

  it('requests editor focus only after the sheet reaches its open position', async () => {
    const { ComposerBottomSheet } =
      require('@/ui/sheets/ComposerBottomSheet') as typeof import('@/ui/sheets/ComposerBottomSheet');
    const view = await render(
      <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={jest.fn()}>
        {(focusSignal) => <Text>焦点信号 {focusSignal}</Text>}
      </ComposerBottomSheet>
    );

    expect(view.getByText('焦点信号 0')).toBeTruthy();
    await fireEvent(view.getByTestId('composer-bottom-sheet'), 'change', 0);
    await waitFor(() => expect(view.getByText('焦点信号 1')).toBeTruthy());
    await fireEvent(view.getByTestId('composer-bottom-sheet'), 'change', -1);
    expect(view.getByText('焦点信号 1')).toBeTruthy();
  });
});
