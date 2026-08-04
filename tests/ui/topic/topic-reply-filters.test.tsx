import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Reply, SourceErrorInfo, Topic, TopicDetail, TopicPoll } from '@/domain/forum/models';
import type { ReplyFilter } from '@/features/topic/model/types';
import type { TopicSessionController } from '@/features/topic/useTopicSessionController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { discoursePollPlaceholder } from '@/sources/discourse/content';
import { buildHtmlRenderingStyles } from '@/features/topic/rendering/htmlStyles';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { TopicScreen } from '@/features/topic/TopicScreen';
import { createTheme } from '@/ui/theme/tokens';
import { createTopicImageDeriver } from '@/features/topic/model/topicDerivedData';
import type { InteractionType } from '@/domain/forum/topicActionState';
import type { TopicActionDecisionFor } from '@/features/topic/actions/topicActionDecision';
import type { TopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import type { useTopicController } from '@/features/topic/useTopicController';
import type { ToggleTopicBodyQuoteOptions } from '@/domain/forum/quotedPosts';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';

const mockGetDiscourseSourceEmojiUrls = jest.fn(async () => ({}));
const mockScrollToIndex = jest.fn();
const mockSplitTopicContentHtml = jest.fn();
let lastFlashListItemTypes: string[] = [];
let lastFlashListItemKeys: string[] = [];

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function FlashList(
      {
        accessibilityLabel,
        data = [],
        keyExtractor,
        ListFooterComponent,
        ListHeaderComponent,
        renderItem,
        testID
      }: {
        accessibilityLabel?: string;
        data?: unknown[];
        keyExtractor?: (item: unknown, index: number) => string;
        ListFooterComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToIndex: (options: unknown) => void; scrollToOffset: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        scrollToIndex: (options: unknown) => mockScrollToIndex(options),
        scrollToOffset: () => undefined
      }));
      lastFlashListItemTypes = data.map((item) => String((item as { type?: unknown }).type || 'unknown'));
      lastFlashListItemKeys = data.map((item, index) => keyExtractor?.(item, index) ?? String(index));
      return ReactModule.createElement(
        NativeView,
        { accessibilityLabel, testID },
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

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));
jest.mock('react-native-webview', () => ({ WebView: () => null }));

jest.mock('react-native-render-html', () => {
  const ReactModule = require('react') as typeof React;
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    ReactModule.createElement(ReactModule.Fragment, null, children);
  const RenderersContext = ReactModule.createContext<Record<string, React.ComponentType<any>>>({});
  return {
    __useMockRenderers: () => ReactModule.useContext(RenderersContext),
    HTMLContentModel: { block: 'block', mixed: 'mixed', textual: 'textual' },
    HTMLElementModel: { fromCustomModel: () => ({}) },
    RenderHTMLConfigProvider: ({
      children,
      renderers = {}
    }: {
      children?: React.ReactNode;
      renderers?: Record<string, React.ComponentType<any>>;
    }) => ReactModule.createElement(RenderersContext.Provider, { value: renderers }, children),
    TChildrenRenderer: () => null,
    TRenderEngineProvider: Passthrough,
    defaultHTMLElementModels: {
      details: { extend: () => ({}) },
      summary: { extend: () => ({}) }
    },
    useTNodeChildrenProps: () => ({})
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    BookMarked: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    Drumstick: Icon,
    MoreHorizontal: Icon,
    Star: Icon,
    ThumbsDown: Icon,
    ThumbsUp: Icon,
    X: Icon
  };
});

jest.mock('@/ui/avatar/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/ui/content/ForumContentVideo', () => ({ ForumContentVideo: () => null }));
jest.mock('@/domain/forum/topicContentSplit', () => {
  const actual = jest.requireActual<typeof import('@/domain/forum/topicContentSplit')>(
    '@/domain/forum/topicContentSplit'
  );
  return {
    ...actual,
    splitTopicContentHtml: (...args: Parameters<typeof actual.splitTopicContentHtml>) => {
      mockSplitTopicContentHtml(...args);
      return actual.splitTopicContentHtml(...args);
    }
  };
});
jest.mock('@/features/topic/components/TopicActionBar', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable, Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    DetailActionButton: ({
      accessibilityLabel,
      active,
      disabled,
      label,
      onPress,
      tone
    }: {
      accessibilityLabel: string;
      active?: boolean;
      disabled?: boolean;
      label: string;
      onPress: () => void;
      tone?: string;
    }) =>
      ReactModule.createElement(
        NativePressable,
        {
          accessibilityLabel,
          accessibilityRole: 'button',
          accessibilityState: { disabled: Boolean(disabled), selected: Boolean(active) },
          disabled,
          onPress,
          testID: `detail-action-${tone || 'primary'}`
        },
        ReactModule.createElement(NativeText, null, label)
      )
  };
});
jest.mock('@/features/topic/components/TopicContentBlock', () => {
  const ReactModule = require('react') as typeof React;
  const { Text: NativeText, View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    MemoizedTopicContentBlock: ({
      html,
      originalImageUpgradeEnabled
    }: {
      html: string;
      originalImageUpgradeEnabled?: boolean;
    }) => {
      const renderers = (
        require('react-native-render-html') as {
          __useMockRenderers: () => Record<string, React.ComponentType<any>>;
        }
      ).__useMockRenderers();
      const children: React.ReactNode[] = [];
      const pattern = /<forum-nodeseek-poll\b[^>]*\bid=["']([^"']+)["'][^>]*>\s*<\/forum-nodeseek-poll\s*>/gi;
      let offset = 0;
      let match = pattern.exec(html);
      while (match) {
        if (match.index > offset) {
          children.push(
            ReactModule.createElement(NativeText, { key: `html-${offset}` }, html.slice(offset, match.index))
          );
        }
        const Renderer = renderers['forum-nodeseek-poll'];
        if (Renderer) {
          children.push(
            ReactModule.createElement(Renderer, {
              key: `poll-${match.index}`,
              tnode: { attributes: { id: match[1] } }
            })
          );
        }
        offset = pattern.lastIndex;
        match = pattern.exec(html);
      }
      if (offset < html.length) {
        children.push(ReactModule.createElement(NativeText, { key: `html-${offset}` }, html.slice(offset)));
      }
      return ReactModule.createElement(
        NativeView,
        {
          testID: `topic-html-block-${originalImageUpgradeEnabled ? 'ready' : 'deferred'}`
        },
        children
      );
    }
  };
});
jest.mock('@/features/topic/components/TopicPolls', () => {
  const ReactModule = require('react') as typeof React;
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView
  } = require('react-native') as typeof import('react-native');
  return {
    TopicPolls: ({
      decisionFor,
      onVotePoll,
      polls,
      source
    }: {
      decisionFor?: TopicActionDecisionFor;
      onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
      polls: TopicPoll[];
      source?: TopicDetail['source'];
    }) => {
      const poll = polls[0];
      if (!poll) {
        return null;
      }
      const canVote = decisionFor?.({ action: 'vote', poll }).allowed === true;
      return ReactModule.createElement(
        NativeView,
        { testID: `topic-poll-${source}` },
        ReactModule.createElement(NativeText, null, canVote ? '可投票' : '只读投票'),
        canVote
          ? ReactModule.createElement(
              NativePressable,
              {
                accessibilityLabel: `提交 ${source} 投票`,
                accessibilityRole: 'button',
                onPress: () => onVotePoll(poll, [poll.options[0].id])
              },
              ReactModule.createElement(NativeText, null, '提交投票')
            )
          : null
      );
    }
  };
});
jest.mock('@/features/topic/components/ReplyComposerSheet', () => ({ ReplyComposerSheet: () => null }));
jest.mock('@/features/topic/components/TopicMenu', () => ({ TopicMenu: () => null }));
jest.mock('@/features/topic/components/ReplyItem', () => {
  const ReactModule = require('react') as typeof React;
  const { Text: NativeText, View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    DiscourseReactionPill: ({ stat }: { stat: { id: string; imageUrl?: string; label: string; value: number } }) =>
      ReactModule.createElement(
        NativeText,
        { testID: `reaction-${stat.id}` },
        `${stat.label} ${stat.value}${stat.imageUrl ? ` ${stat.imageUrl}` : ''}`
      ),
    MemoizedReplyItem: ({
      onQuoteContentLayout,
      reply,
      section
    }: {
      onQuoteContentLayout?: (options: { contentToken: string; instanceKey: string }) => void;
      reply: Reply;
      section?: {
        contentToken?: string;
        instanceKey?: string;
        key: string;
        measureForMaterialization?: boolean;
      };
    }) =>
      ReactModule.createElement(
        NativeView,
        section?.measureForMaterialization
          ? {
              onLayout: () =>
                onQuoteContentLayout?.({
                  contentToken: section.contentToken!,
                  instanceKey: section.instanceKey!
                }),
              testID: `reply-quote-materialization-${section.key}`
            }
          : undefined,
        ReactModule.createElement(
          NativeText,
          { testID: `reply-floor-${reply.floor}` },
          `reply-${reply.floor}-${reply.author}`
        )
      ),
    NodeSeekStatPill: ({ label, value }: { label: string; value: number }) =>
      ReactModule.createElement(NativeText, { testID: `readonly-stat-${label}` }, `${label} ${value}`),
    nodeSeekTopicReactionStats: () => []
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const htmlStyles = buildHtmlRenderingStyles({ settings: readerData.settings, theme });
const topicImageDeriver = createTopicImageDeriver();
const noop = () => undefined;
const sourceReplies: Reply[] = [
  { author: 'alice', contentHtml: '<p>first answer</p>', createdAt: '2026-07-14T00:01:00.000Z', floor: 1 },
  {
    author: 'bob',
    contentHtml: '<p>second needle</p><img src="https://img.example.com/2.png">',
    createdAt: '2026-07-14T00:02:00.000Z',
    floor: 2
  },
  { author: 'alice', contentHtml: '<p>third needle</p>', createdAt: '2026-07-14T00:03:00.000Z', floor: 3 }
];
const topic: TopicDetail = {
  source: 'v2ex',
  id: 'topic-1',
  title: '筛选测试主题',
  author: 'alice',
  authorId: 'alice',
  url: 'https://www.v2ex.com/t/topic-1',
  createdAt: '2026-07-14T00:00:00.000Z',
  replyCount: sourceReplies.length,
  contentHtml: '',
  replies: sourceReplies
};
const topicPoll: TopicPoll = {
  id: 'source-poll',
  title: '来源投票',
  options: [
    { id: 'yes', label: '赞成', count: 3 },
    { id: 'no', label: '反对', count: 1 }
  ]
};

function HtmlRendererIdentityHarness({
  onRender,
  selectedTopic,
  topicDetail
}: {
  onRender: (renderers: object, rendererProps: object) => void;
  selectedTopic: Topic;
  topicDetail: TopicDetail;
}) {
  const rendering = useHtmlRenderingController({
    mediaSessionIdentity: `${topicDetail.source}:0`,
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic,
    settings: readerData.settings,
    theme,
    topicDetail,
    topicKey: `${topicDetail.source}:${topicDetail.id}`,
    webViewBlockMessage: ''
  });
  useEffect(() => {
    onRender(rendering.htmlRenderers, rendering.htmlRenderersProps);
  }, [onRender, rendering.htmlRenderers, rendering.htmlRenderersProps]);
  return null;
}

function TopicFilterHarness({
  canUseLinuxDoActions = false,
  canUseNodeSeekActions = false,
  canUseXiaoyinsiActions = false,
  canUseYaohuoActions = false,
  filteredCommentQuery,
  expandedQuotes = {},
  getDiscourseEmojiUrls = mockGetDiscourseSourceEmojiUrls,
  loadedQuotedReplies = {},
  loadingMoreReplies = false,
  loadingQuotedFloors = {},
  onLoadMoreReplies = jest.fn(),
  onInteract = jest.fn(),
  onRefreshWholeTopic = jest.fn(),
  onReplyComposerOpenChange = jest.fn(),
  onToggleFavorite = jest.fn(),
  onYaohuoFavorite = jest.fn(),
  onVerifyNodeSeek = jest.fn(),
  onVerifyLinuxDo = jest.fn(),
  onVotePoll = jest.fn(),
  onDiscourseBookmark = jest.fn(),
  onToggleTopicBodyQuote = jest.fn(),
  replyHasMore = false,
  selectedTopic = topic,
  topicReplies = sourceReplies,
  topicDetail = topic,
  topicError = null,
  topicFavorite = false,
  topicBusy = false,
  targetReply,
  identityBlocked = false,
  identityChecking = false,
  yaohuoVisualBookmarked
}: {
  canUseLinuxDoActions?: boolean;
  canUseNodeSeekActions?: boolean;
  canUseXiaoyinsiActions?: boolean;
  canUseYaohuoActions?: boolean;
  filteredCommentQuery?: string;
  expandedQuotes?: Record<string, boolean>;
  getDiscourseEmojiUrls?: (options: { signal?: AbortSignal; source: DiscourseSource }) => Promise<DiscourseEmojiUrlMap>;
  loadedQuotedReplies?: Record<string, Reply>;
  loadingMoreReplies?: boolean;
  loadingQuotedFloors?: Record<string, boolean>;
  onLoadMoreReplies?: (options?: { silent?: boolean }) => void;
  onInteract?: (type: InteractionType, commentId?: number) => void;
  onRefreshWholeTopic?: () => void;
  onReplyComposerOpenChange?: (open: boolean) => void;
  onToggleFavorite?: () => void;
  onYaohuoFavorite?: () => void;
  onVerifyNodeSeek?: () => void;
  onVerifyLinuxDo?: () => void;
  onVotePoll?: (poll: TopicPoll, optionIds: string[]) => void;
  onDiscourseBookmark?: () => void;
  onToggleTopicBodyQuote?: (options: ToggleTopicBodyQuoteOptions) => void;
  replyHasMore?: boolean;
  selectedTopic?: Topic;
  topicReplies?: Reply[];
  topicDetail?: TopicDetail | null;
  topicError?: SourceErrorInfo | null;
  topicFavorite?: boolean;
  topicBusy?: boolean;
  targetReply?: { commentId?: number; floor?: number };
  identityBlocked?: boolean;
  identityChecking?: boolean;
  yaohuoVisualBookmarked?: boolean;
} = {}) {
  const [commentQuery, setCommentQuery] = useState('');
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const topicScrollRef = useRef(null);
  const effectiveCommentQuery = filteredCommentQuery ?? commentQuery;
  const decisionFor = (({ action }) => {
    const source = topicDetail?.source || selectedTopic?.source;
    const sourceAllowed = {
      linuxdo: canUseLinuxDoActions,
      nodeseek: canUseNodeSeekActions,
      v2ex: false,
      xiaoyinsi: canUseXiaoyinsiActions,
      yaohuo: canUseYaohuoActions
    }[source || 'v2ex'];
    const allowed =
      sourceAllowed &&
      !(source === 'yaohuo' && action === 'like') &&
      !(source === 'xiaoyinsi' && (action === 'reply' || action === 'upload') && topicDetail?.canCreatePost !== true);
    return { allowed, reason: allowed ? 'allowed' : 'login-required' };
  }) satisfies TopicActionDecisionFor;
  const actions = {
    actionBusy: false,
    bookmarkOnDiscourseSite: async () => onDiscourseBookmark(),
    collectOnNodeSeekSite: async () => undefined,
    decisionFor,
    deleteReply: async () => undefined,
    editReply: async () => undefined,
    favoriteOnYaohuoSite: async () => onYaohuoFavorite(),
    interact: async (type: InteractionType, commentId?: number) => onInteract(type, commentId),
    submitReply: async () => undefined,
    uploadReplyImage: async () => undefined,
    votePoll: async (poll: TopicPoll, optionIds: string[]) => onVotePoll(poll, optionIds)
  } satisfies TopicActionsController;
  const read = {
    loadMoreReplies: async (options?: { silent?: boolean }) => {
      onLoadMoreReplies(options);
      return true;
    },
    loadedQuotedReplies,
    loadingMoreReplies,
    loadingQuotedFloors,
    replyHasMore,
    toggleReplyQuote: jest.fn(),
    toggleTopicBodyQuote: onToggleTopicBodyQuote,
    topicReplies,
    unreadReplyCount: 0
  } as unknown as ReturnType<typeof useTopicController>;
  const session = {
    state: {
      commentQuery,
      debouncedCommentQuery: effectiveCommentQuery,
      expandedQuotes,
      quoteStateVersion: 0,
      replyComposerOpen: false,
      replyContent: '',
      replyEditTarget: null,
      replyFace: '',
      replyFilter,
      replyTarget: null,
      selectedTopic
    },
    commands: {
      composer: {
        changeContent: jest.fn(),
        changeFace: jest.fn(),
        replyToFloor: jest.fn(),
        toggle: onReplyComposerOpenChange
      },
      view: {
        changeCommentQuery: setCommentQuery,
        changeReplyFilter: setReplyFilter
      }
    }
  } as unknown as TopicSessionController;

  return (
    <View>
      <TopicScreen
        actions={actions}
        article={{
          busy: topicBusy,
          error: topicError,
          topic: topicDetail,
          yaohuoBookmarked: yaohuoVisualBookmarked ?? topicDetail?.bookmarked
        }}
        chrome={{
          back: jest.fn(),
          favorite: topicFavorite,
          getDiscourseEmojiUrls,
          identityBlocked,
          identityChecking,
          onScroll: jest.fn(),
          openOriginal: jest.fn(),
          openReadingSettings: jest.fn(),
          openTopic: jest.fn(),
          openUser: jest.fn(),
          refreshReplies: jest.fn(),
          refreshTopic: onRefreshWholeTopic,
          share: jest.fn(),
          toggleFavorite: onToggleFavorite,
          verifyLinuxDo: onVerifyLinuxDo,
          verifyNodeSeek: onVerifyNodeSeek
        }}
        currentNodeSeekUser={undefined}
        html={
          {
            contentWidth: 720,
            htmlBaseStyle: htmlStyles.htmlBaseStyle,
            htmlClassesStyles: htmlStyles.htmlClassesStyles,
            htmlIgnoredStyles: htmlStyles.htmlIgnoredStyles,
            htmlRenderers: {},
            htmlRenderersProps: {},
            htmlTagsStyles: htmlStyles.htmlTagsStyles,
            inlineSizedImageUrls: {},
            mediaSessionIdentity: `${topicDetail?.source || 'public'}:0`,
            topicImageDeriver
          } as ReturnType<typeof useHtmlRenderingController> & { contentWidth: number; mediaSessionIdentity: string }
        }
        nodeSeekUserId={null}
        read={read}
        session={session}
        targetReply={targetReply}
        topicScrollRef={topicScrollRef}
      />
      <Text testID="active-filter">{replyFilter}</Text>
    </View>
  );
}

describe('Topic reply filters', () => {
  it('loads later pages and locates a notification reply by stable comment id', async () => {
    const pages: Reply[][] = [
      [
        {
          author: 'first',
          commentId: 101,
          contentHtml: '<p>第一页</p>',
          createdAt: '2026-08-01T00:00:00.000Z',
          floor: 1
        }
      ],
      [
        {
          author: 'decoy',
          commentId: 999,
          contentHtml: '<p>同楼层但不是目标</p>',
          createdAt: '2026-08-01T00:01:00.000Z',
          floor: 21
        }
      ],
      [
        {
          author: 'target',
          commentId: 11640077,
          contentHtml: '<p>目标评论</p>',
          createdAt: '2026-08-01T00:02:00.000Z',
          floor: 99
        }
      ]
    ];
    const targetTopic: TopicDetail = {
      ...topic,
      id: 'notification-target-topic',
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-852804-1',
      replies: pages[0],
      replyCount: 3
    };
    const loadMore = jest.fn();
    function NotificationTargetHarness() {
      const [pageCount, setPageCount] = useState(1);
      return (
        <TopicFilterHarness
          onLoadMoreReplies={(options) => {
            loadMore(options);
            setPageCount((current) => Math.min(pages.length, current + 1));
          }}
          replyHasMore={pageCount < pages.length}
          selectedTopic={targetTopic}
          targetReply={{ commentId: 11640077, floor: 21 }}
          topicDetail={targetTopic}
          topicReplies={pages.slice(0, pageCount).flat()}
        />
      );
    }
    mockScrollToIndex.mockClear();

    const view = await render(<NotificationTargetHarness />);

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(2));
    expect(loadMore).toHaveBeenNthCalledWith(1, { silent: true });
    expect(loadMore).toHaveBeenNthCalledWith(2, { silent: true });
    await waitFor(() => expect(view.getByTestId('reply-floor-99')).toBeTruthy());
    expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    expect(mockScrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
  });

  it('[REG-PERF-008] gives split opening-post blocks to FlashList instead of mounting them in its header', async () => {
    const longTopic: TopicDetail = {
      ...topic,
      contentHtml: Array.from({ length: 6 }, (_, index) => `<p>${String(index).repeat(2300)}</p>`).join(''),
      replies: [],
      replyCount: 0
    };
    lastFlashListItemTypes = [];

    await render(<TopicFilterHarness selectedTopic={longTopic} topicDetail={longTopic} topicReplies={[]} />);

    const contentItemCount = lastFlashListItemTypes.filter((type) => type === 'topicContent').length;
    expect(contentItemCount).toBeGreaterThan(1);
    expect(lastFlashListItemTypes.slice(0, contentItemCount)).toEqual(
      Array.from({ length: contentItemCount }, () => 'topicContent')
    );
    expect(lastFlashListItemTypes.indexOf('replyControls')).toBe(contentItemCount);
  });

  it('[REG-TOPIC-054][REG-TOPIC-055] measures a staged quote row before materializing the complete post', async () => {
    const pendingFrames: FrameRequestCallback[] = [];
    const requestFrame = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
    const cancelFrame = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const reference = { source: 'linuxdo' as const, topicId: '342888', postNumber: 1 };
    const instanceKey = 'reply:comment:222:linuxdo:342888:1';
    const quotedReply: Reply = {
      author: 'quoted author',
      contentHtml: Array.from({ length: 6 }, (_, index) => `<p>quote ${index} ${'safe text '.repeat(260)}</p>`).join(
        ''
      ),
      createdAt: '2026-02-17T00:00:00.000Z',
      floor: 1
    };
    const quotingReply: Reply = {
      author: 'reader',
      commentId: 222,
      contentHtml: '<p>reply body after quote</p>',
      createdAt: '2026-07-31T00:00:00.000Z',
      floor: 2,
      quotedPosts: [
        {
          reference,
          author: { label: 'quoted author' },
          preview: 'quote preview'
        }
      ]
    };
    const linuxTopic: TopicDetail = {
      ...topic,
      source: 'linuxdo',
      id: '2685882',
      url: 'https://linux.do/t/topic/2685882',
      contentHtml: '<p>opening body</p>',
      replies: [quotingReply],
      replyCount: 1
    };
    const props = {
      expandedQuotes: { [instanceKey]: true },
      loadedQuotedReplies: { 'linuxdo:342888:1': quotedReply },
      selectedTopic: linuxTopic,
      topicDetail: linuxTopic,
      topicReplies: [quotingReply]
    };
    lastFlashListItemKeys = [];
    lastFlashListItemTypes = [];

    try {
      const view = await render(<TopicFilterHarness {...props} />);
      const quoteContentKeys = () =>
        lastFlashListItemKeys.filter((_key, index) => lastFlashListItemTypes[index] === 'replyQuoteContent');

      expect(lastFlashListItemTypes.indexOf('replyStart')).toBeGreaterThan(
        lastFlashListItemTypes.indexOf('replyControls')
      );
      expect(lastFlashListItemTypes.filter((type) => type === 'replyQuoteContent')).toHaveLength(2);
      const coldKeys = quoteContentKeys();
      const measuredRows = view.getAllByTestId(/^reply-quote-materialization-/);
      expect(measuredRows).toHaveLength(2);

      await fireEvent(measuredRows[0], 'layout', {
        nativeEvent: { layout: { height: 300, width: 720, x: 0, y: 0 } }
      });
      expect(lastFlashListItemTypes.filter((type) => type === 'replyQuoteContent')).toHaveLength(2);
      expect(pendingFrames).toHaveLength(1);

      await act(async () => {
        pendingFrames.shift()?.(16);
      });
      await waitFor(() =>
        expect(lastFlashListItemTypes.filter((type) => type === 'replyQuoteContent')).toHaveLength(6)
      );
      expect(quoteContentKeys().slice(0, 2)).toEqual(coldKeys);
      expect(view.queryAllByTestId(/^reply-quote-materialization-/)).toHaveLength(0);

      const fullKeys = quoteContentKeys();
      await view.rerender(<TopicFilterHarness {...props} topicFavorite />);
      expect(quoteContentKeys()).toEqual(fullKeys);

      await view.rerender(<TopicFilterHarness {...props} expandedQuotes={{}} />);
      expect(quoteContentKeys()).toHaveLength(0);
      await view.rerender(<TopicFilterHarness {...props} />);
      expect(quoteContentKeys()).toEqual(fullKeys);

      const changedReply = { ...quotedReply, contentHtml: `${quotedReply.contentHtml}<p>changed content</p>` };
      await view.rerender(<TopicFilterHarness {...props} loadedQuotedReplies={{ 'linuxdo:342888:1': changedReply }} />);
      expect(quoteContentKeys()).toHaveLength(2);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('[REG-PERF-008] does not split an unchanged opening post after unrelated topic state changes', async () => {
    const openingTopic: TopicDetail = {
      ...topic,
      source: 'linuxdo',
      contentHtml: '<p>opening body</p>',
      polls: []
    };
    mockSplitTopicContentHtml.mockClear();
    const view = await render(<TopicFilterHarness selectedTopic={openingTopic} topicDetail={openingTopic} />);
    const initialCalls = mockSplitTopicContentHtml.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    const likedTopic = { ...openingTopic, liked: true };
    await view.rerender(<TopicFilterHarness selectedTopic={likedTopic} topicDetail={likedTopic} />);
    expect(mockSplitTopicContentHtml).toHaveBeenCalledTimes(initialCalls);

    const changedBodyTopic = { ...likedTopic, contentHtml: '<p>changed opening body</p>' };
    await view.rerender(<TopicFilterHarness selectedTopic={changedBodyTopic} topicDetail={changedBodyTopic} />);
    expect(mockSplitTopicContentHtml.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('[REG-TOPIC-048] enables original-image upgrades when FlashList mounts an opening-post chunk', async () => {
    const topicWithImage = {
      ...topic,
      contentHtml: '<p>opening post <img src="https://img.example.com/opening.png"></p>'
    };
    const view = await render(
      <TopicFilterHarness selectedTopic={topicWithImage} topicDetail={topicWithImage} topicReplies={[]} />
    );
    const content = view.getByTestId('topic-html-block-deferred');
    let frame = content.parent;
    while (frame && typeof frame.props.onLayout !== 'function') frame = frame.parent;
    expect(frame).toBeTruthy();

    await fireEvent(frame!, 'layout', {
      nativeEvent: { layout: { height: 200, width: 720, x: 0, y: 0 } }
    });

    await waitFor(() => expect(view.getByTestId('topic-html-block-ready')).toBeTruthy());
  });

  it.each(['linuxdo', 'xiaoyinsi'] as const)(
    '[REG-TOPIC-026] renders the accepted %s answer inside the opening post before the reply list',
    async (source) => {
      const acceptedReply: Reply = {
        ...sourceReplies[1],
        acceptedAnswer: true,
        author: 'CyrilXu',
        contentHtml: '<p>采纳答案正文</p>'
      };
      const topicReplies = [sourceReplies[0], acceptedReply, sourceReplies[2]];
      const solvedTopic: TopicDetail = {
        ...topic,
        acceptedAnswerFloor: 2,
        contentHtml: '<p>提问正文</p>',
        id: `${source}-solved-topic`,
        replies: topicReplies,
        solved: true,
        source,
        url: source === 'linuxdo' ? 'https://linux.do/t/topic/206' : 'https://forum.xiaoyinsi.com/t/topic/206'
      };
      mockScrollToIndex.mockClear();
      const view = await render(
        <TopicFilterHarness selectedTopic={solvedTopic} topicDetail={solvedTopic} topicReplies={topicReplies} />
      );

      expect(view.getByTestId('topic-accepted-answer')).toBeTruthy();
      expect(view.getByText('已采纳答案')).toBeTruthy();
      expect(view.getByText('CyrilXu')).toBeTruthy();
      expect(view.getByText('<p>采纳答案正文</p>')).toBeTruthy();
      expect(view.getByText('查看完整答案 · #2')).toBeTruthy();
      const rendered = JSON.stringify(view.toJSON());
      expect(rendered.indexOf('提问正文')).toBeLessThan(rendered.indexOf('topic-accepted-answer'));
      expect(rendered.indexOf('topic-accepted-answer')).toBeLessThan(rendered.indexOf('回复列表'));

      await fireEvent.press(view.getByLabelText('收起已采纳答案'));
      expect(view.queryByText('<p>采纳答案正文</p>')).toBeNull();
      expect(view.getByLabelText('展开已采纳答案')).toBeTruthy();

      await fireEvent.press(view.getByLabelText('展开已采纳答案'));
      await fireEvent.press(view.getByLabelText('查看完整解决方案，第 2 楼'));
      expect(mockScrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          animated: true,
          index: 4
        })
      );
    }
  );

  it.each(['linuxdo', 'xiaoyinsi'] as const)(
    '[REG-TOPIC-026] loads the accepted %s answer by floor when it is outside the current reply page',
    async (source) => {
      const acceptedFloor = 42;
      const solvedTopic: TopicDetail = {
        ...topic,
        acceptedAnswerFloor: acceptedFloor,
        id: `${source}-paged-solved-topic`,
        replies: [sourceReplies[0]],
        solved: true,
        source,
        url: source === 'linuxdo' ? 'https://linux.do/t/topic/208' : 'https://forum.xiaoyinsi.com/t/topic/208'
      };
      const referenceKey = `${source}:${solvedTopic.id}:${acceptedFloor}`;
      const instanceKey = `accepted-answer:${solvedTopic.id}:${referenceKey}`;
      const onToggleTopicBodyQuote = jest.fn<(options: ToggleTopicBodyQuoteOptions) => void>();
      const view = await render(
        <TopicFilterHarness
          onToggleTopicBodyQuote={onToggleTopicBodyQuote}
          selectedTopic={solvedTopic}
          topicDetail={solvedTopic}
          topicReplies={[sourceReplies[0]]}
        />
      );

      expect(view.getByTestId('topic-accepted-answer')).toBeTruthy();
      await waitFor(() =>
        expect(onToggleTopicBodyQuote).toHaveBeenCalledWith({
          instanceKey,
          prefetch: true,
          reference: {
            source,
            topicId: solvedTopic.id,
            postNumber: acceptedFloor
          }
        })
      );

      const loadedAnswer: Reply = {
        ...sourceReplies[1],
        acceptedAnswer: true,
        contentHtml: `<p>后分页采纳答案正文</p>${discoursePollPlaceholder('accepted-answer-poll')}`,
        floor: acceptedFloor,
        polls: [{ ...topicPoll, name: 'accepted-answer-poll' }],
        quotedPosts: [
          {
            reference: { source, topicId: solvedTopic.id, postNumber: 7 },
            author: { label: 'quoted-user', username: 'quoted-user' },
            preview: '采纳答案引用摘要'
          }
        ]
      };
      await view.rerender(
        <TopicFilterHarness
          loadedQuotedReplies={{ [referenceKey]: loadedAnswer }}
          onToggleTopicBodyQuote={onToggleTopicBodyQuote}
          selectedTopic={solvedTopic}
          topicDetail={solvedTopic}
          topicReplies={[sourceReplies[0]]}
        />
      );

      expect(view.getByText('<p>后分页采纳答案正文</p>')).toBeTruthy();
      expect(view.getByText('采纳答案引用摘要')).toBeTruthy();
      expect(view.getByText('只读投票')).toBeTruthy();
      expect(view.getByTestId('topic-poll-undefined')).toBeTruthy();
      expect(view.getByText(`查看完整答案 · #${acceptedFloor}`)).toBeTruthy();
      await fireEvent.press(view.getByLabelText(`查看完整解决方案，第 ${acceptedFloor} 楼`));
      expect(view.queryByText(`查看完整答案 · #${acceptedFloor}`)).toBeNull();
      expect(view.getByText('<p>后分页采纳答案正文</p>')).toBeTruthy();
    }
  );

  it('[REG-TOPIC-026] does not load an accepted answer hidden behind an access notice', async () => {
    const restrictedTopic: TopicDetail = {
      ...topic,
      acceptedAnswerFloor: 42,
      accessRequirement: {
        type: 'permission',
        label: '需权限',
        detail: '暂无权限查看此内容'
      },
      contentHtml: '<p>暂无权限查看此内容</p>',
      id: 'linuxdo-restricted-solved-topic',
      replies: [],
      solved: true,
      source: 'linuxdo'
    };
    const onToggleTopicBodyQuote = jest.fn<(options: ToggleTopicBodyQuoteOptions) => void>();
    const view = await render(
      <TopicFilterHarness
        onToggleTopicBodyQuote={onToggleTopicBodyQuote}
        selectedTopic={restrictedTopic}
        topicDetail={restrictedTopic}
        topicReplies={[]}
      />
    );

    expect(view.queryByTestId('topic-accepted-answer')).toBeNull();
    expect(onToggleTopicBodyQuote).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-026] restores the reply list before locating an accepted answer hidden by filters', async () => {
    const acceptedReply: Reply = {
      ...sourceReplies[1],
      acceptedAnswer: true,
      contentHtml: '<p>被筛选隐藏的采纳答案</p>'
    };
    const topicReplies = [sourceReplies[0], acceptedReply, sourceReplies[2]];
    const solvedTopic: TopicDetail = {
      ...topic,
      acceptedAnswerFloor: 2,
      id: 'xiaoyinsi-filtered-solved-topic',
      replies: topicReplies,
      solved: true,
      source: 'xiaoyinsi'
    };
    mockScrollToIndex.mockClear();
    const view = await render(
      <TopicFilterHarness selectedTopic={solvedTopic} topicDetail={solvedTopic} topicReplies={topicReplies} />
    );

    await fireEvent.press(view.getByLabelText('只看楼主'));
    await fireEvent.changeText(view.getByPlaceholderText('评论内查找'), '不会命中答案');
    expect(view.getByTestId('active-filter').props.children).toBe('author');
    expect(view.getByLabelText('查看完整解决方案，第 2 楼')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('查看完整解决方案，第 2 楼'));

    await waitFor(() => expect(view.getByTestId('active-filter').props.children).toBe('all'));
    await waitFor(() => expect(view.getByPlaceholderText('评论内查找').props.value).toBe(''));
    await waitFor(() =>
      expect(mockScrollToIndex).toHaveBeenCalledWith({
        animated: true,
        index: 3
      })
    );
  });

  it('[REG-XIAOYINSI-017] retries the emoji catalog after a same-topic refresh', async () => {
    const xiaoyinsiTopic: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      url: 'https://forum.xiaoyinsi.com/t/topic-1'
    };
    mockGetDiscourseSourceEmojiUrls.mockClear();
    mockGetDiscourseSourceEmojiUrls
      .mockRejectedValueOnce(new Error('temporary emoji failure'))
      .mockResolvedValue({ heart: 'https://forum.xiaoyinsi.com/heart.png' });
    const view = await render(<TopicFilterHarness selectedTopic={xiaoyinsiTopic} topicDetail={xiaoyinsiTopic} />);
    await waitFor(() => expect(mockGetDiscourseSourceEmojiUrls).toHaveBeenCalledTimes(1));

    const refreshedTopic = { ...xiaoyinsiTopic, title: '刷新后的主题' };
    await view.rerender(<TopicFilterHarness selectedTopic={refreshedTopic} topicDetail={refreshedTopic} />);

    await waitFor(() => expect(mockGetDiscourseSourceEmojiUrls).toHaveBeenCalledTimes(2));
  });

  it('[REG-TOPIC-027] aborts the old emoji read and ignores its late result after switching sites', async () => {
    type EmojiLoader = (options: { signal?: AbortSignal; source: DiscourseSource }) => Promise<DiscourseEmojiUrlMap>;
    type EmojiUrls = Awaited<ReturnType<EmojiLoader>>;
    let resolveFirst: ((urls: EmojiUrls) => void) | undefined;
    let resolveSecond: ((urls: EmojiUrls) => void) | undefined;
    const getDiscourseEmojiUrls = jest.fn(
      (_request: Parameters<EmojiLoader>[0]) =>
        new Promise<EmojiUrls>((resolve) => {
          if (!resolveFirst) {
            resolveFirst = resolve;
          } else {
            resolveSecond = resolve;
          }
        })
    );
    const xiaoyinsiTopic: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      reactionSummary: [{ id: 'heart', count: 1 }],
      url: 'https://forum.xiaoyinsi.com/t/topic-1'
    };
    const linuxDoTopic: TopicDetail = {
      ...xiaoyinsiTopic,
      source: 'linuxdo',
      url: 'https://linux.do/t/topic-1'
    };
    const view = await render(
      <TopicFilterHarness
        getDiscourseEmojiUrls={getDiscourseEmojiUrls}
        selectedTopic={xiaoyinsiTopic}
        topicDetail={xiaoyinsiTopic}
      />
    );
    await waitFor(() => expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(1));
    const firstSignal = getDiscourseEmojiUrls.mock.calls[0][0].signal;

    await view.rerender(
      <TopicFilterHarness
        getDiscourseEmojiUrls={getDiscourseEmojiUrls}
        selectedTopic={linuxDoTopic}
        topicDetail={linuxDoTopic}
      />
    );
    await waitFor(() => expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      resolveSecond?.({ heart: 'https://linux.do/current-heart.png' });
    });
    await waitFor(() => {
      expect(view.getByTestId('reaction-heart').props.children).toContain('https://linux.do/current-heart.png');
    });

    await act(async () => {
      resolveFirst?.({ heart: 'https://forum.xiaoyinsi.com/stale-heart.png' });
    });
    expect(view.getByTestId('reaction-heart').props.children).toContain('https://linux.do/current-heart.png');
    expect(view.getByTestId('reaction-heart').props.children).not.toContain('stale-heart.png');
  });

  it.each(['linuxdo', 'yaohuo', 'xiaoyinsi'] as const)(
    'wires %s topic polls through the source-specific writable path',
    async (source) => {
      const onVotePoll = jest.fn<(poll: TopicPoll, optionIds: string[]) => void>();
      const sourceTopic: TopicDetail = {
        ...topic,
        source,
        id: `${source}-poll-topic`,
        url:
          source === 'linuxdo'
            ? 'https://linux.do/t/topic/2'
            : source === 'xiaoyinsi'
              ? 'https://forum.xiaoyinsi.com/t/topic/2'
              : 'https://yaohuo.me/bbs-2.html',
        polls: [topicPoll]
      };
      const view = await render(
        <TopicFilterHarness
          canUseLinuxDoActions={source === 'linuxdo'}
          canUseXiaoyinsiActions={source === 'xiaoyinsi'}
          canUseYaohuoActions={source === 'yaohuo'}
          onVotePoll={onVotePoll}
          selectedTopic={sourceTopic}
          topicDetail={sourceTopic}
        />
      );

      expect(view.getByTestId(`topic-poll-${source}`)).toBeTruthy();
      expect(view.getByText('可投票')).toBeTruthy();
      await fireEvent.press(view.getByLabelText(`提交 ${source} 投票`));
      expect(onVotePoll).toHaveBeenCalledWith(topicPoll, ['yes']);
    }
  );

  it('shows 小隐寺 write actions only after authorization and wires them independently', async () => {
    const xiaoyinsiTopic: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      id: 'xiaoyinsi-actions',
      url: 'https://forum.xiaoyinsi.com/t/topic/42',
      commentId: 100,
      canCreatePost: true,
      canLike: true,
      liked: false,
      bookmarked: false,
      reactionSummary: [{ id: 'heart', count: 3 }]
    };
    const onInteract = jest.fn<(type: InteractionType, commentId?: number) => void>();
    const onDiscourseBookmark = jest.fn();

    const anonymous = await render(<TopicFilterHarness selectedTopic={xiaoyinsiTopic} topicDetail={xiaoyinsiTopic} />);
    expect(anonymous.getByTestId('reaction-heart')).toBeTruthy();
    expect(anonymous.queryByLabelText('点赞')).toBeNull();
    expect(anonymous.queryByLabelText('原站收藏')).toBeNull();
    await anonymous.unmount();

    const authorized = await render(
      <TopicFilterHarness
        canUseXiaoyinsiActions
        onInteract={onInteract}
        onDiscourseBookmark={onDiscourseBookmark}
        selectedTopic={xiaoyinsiTopic}
        topicDetail={xiaoyinsiTopic}
      />
    );
    await fireEvent.press(authorized.getByLabelText('点赞'));
    await fireEvent.press(authorized.getByLabelText('原站收藏'));
    expect(onInteract).toHaveBeenCalledWith('like', 100);
    expect(onDiscourseBookmark).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-007] hides reply entry without can_create_post while preserving allowed 小隐寺 interactions', async () => {
    const readOnlyTopic: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      id: 'xiaoyinsi-read-only',
      url: 'https://forum.xiaoyinsi.com/t/topic/43',
      commentId: 101,
      canCreatePost: false,
      canLike: true,
      liked: false,
      bookmarked: false
    };

    const view = await render(
      <TopicFilterHarness canUseXiaoyinsiActions selectedTopic={readOnlyTopic} topicDetail={readOnlyTopic} />
    );

    expect(view.queryByText('写回复')).toBeNull();
    expect(view.getByLabelText('点赞')).toBeTruthy();
    expect(view.getByLabelText('原站收藏')).toBeTruthy();
  });

  it('[REG-WRITE-009] renders a NodeSeek poll at its marker between body blocks', async () => {
    const nodeSeekTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: 'nodeseek-poll-topic',
      url: 'https://www.nodeseek.com/post-2-1',
      contentHtml:
        '<p>投票前正文<br><forum-nodeseek-poll id="source-poll"></forum-nodeseek-poll><br>投票后正文 <img class="sticker" src="/sticker.png"></p>',
      polls: [topicPoll]
    };
    const view = await render(
      <TopicFilterHarness canUseNodeSeekActions selectedTopic={nodeSeekTopic} topicDetail={nodeSeekTopic} />
    );

    const rendered = JSON.stringify(view.toJSON());
    const beforeIndex = rendered.indexOf('投票前正文');
    const pollIndex = rendered.indexOf('topic-poll-nodeseek');
    const afterIndex = rendered.indexOf('投票后正文');
    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(pollIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(pollIndex);
    expect(view.getAllByTestId('topic-html-block-deferred')).toHaveLength(1);
    expect(view.getAllByTestId('topic-poll-nodeseek')).toHaveLength(1);
  });

  it('shows the V2EX topic vote count without exposing a vote action', async () => {
    const v2exTopic: TopicDetail = { ...topic, upvoteCount: 336 };
    const view = await render(<TopicFilterHarness selectedTopic={v2exTopic} topicDetail={v2exTopic} />);

    expect(view.getByTestId('readonly-stat-UP 票').props.children).toBe('UP 票 336');
    expect(view.queryByTestId('topic-poll-v2ex')).toBeNull();
  });

  it('keeps V2EX read-only and exposes reply composition only for an authorized writable source', async () => {
    const onReplyComposerOpenChange = jest.fn<(open: boolean) => void>();
    const view = await render(
      <TopicFilterHarness canUseNodeSeekActions onReplyComposerOpenChange={onReplyComposerOpenChange} />
    );

    expect(view.queryByLabelText('写回复')).toBeNull();

    const nodeSeekTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: 'nodeseek-writable',
      url: 'https://www.nodeseek.com/post-2-1'
    };
    await view.rerender(
      <TopicFilterHarness
        canUseNodeSeekActions
        selectedTopic={nodeSeekTopic}
        topicDetail={nodeSeekTopic}
        onReplyComposerOpenChange={onReplyComposerOpenChange}
      />
    );
    await fireEvent.press(view.getByLabelText('写回复'));
    expect(onReplyComposerOpenChange).toHaveBeenCalledWith(true);
  });

  it('shows a single detail loading state before the selected topic is available', async () => {
    const view = await render(<TopicFilterHarness topicDetail={null} topicBusy />);

    expect(view.getAllByText('正在读取主题...')).toHaveLength(1);
    expect(view.queryByText('回复列表')).toBeNull();
  });

  it('offers verification and retry actions when a NodeSeek topic cannot be read', async () => {
    const onRefreshWholeTopic = jest.fn<() => void>();
    const onVerifyNodeSeek = jest.fn<() => void>();
    const selectedTopic: Topic = {
      ...topic,
      source: 'nodeseek',
      id: 'nodeseek-topic-1',
      url: 'https://www.nodeseek.com/post-1-1'
    };
    const view = await render(
      <TopicFilterHarness
        selectedTopic={selectedTopic}
        topicDetail={null}
        topicError={{
          kind: 'verification-required',
          message: 'NodeSeek 需要完成验证后继续。',
          retryable: true,
          verificationRequired: true
        }}
        onRefreshWholeTopic={onRefreshWholeTopic}
        onVerifyNodeSeek={onVerifyNodeSeek}
      />
    );

    expect(view.getByText('NodeSeek 需要完成验证后继续。')).toBeTruthy();
    expect(view.queryByText('正在读取主题...')).toBeNull();
    await fireEvent.press(view.getByLabelText('去验证'));
    await fireEvent.press(view.getByLabelText('重试'));
    expect(onVerifyNodeSeek).toHaveBeenCalledTimes(1);
    expect(onRefreshWholeTopic).toHaveBeenCalledTimes(1);
  });

  it('[REG-LINUXDO-007] ends Topic loading and offers Account recovery after an ordinary identity probe failure', async () => {
    const onRefreshWholeTopic = jest.fn<() => void>();
    const onVerifyLinuxDo = jest.fn<() => void>();
    const selectedTopic: Topic = {
      ...topic,
      source: 'linuxdo',
      id: 'linuxdo-topic-1',
      url: 'https://linux.do/t/topic/1'
    };
    const view = await render(
      <TopicFilterHarness
        identityBlocked
        selectedTopic={selectedTopic}
        topicDetail={null}
        topicError={{ kind: 'ordinary', message: 'Network request failed' }}
        onRefreshWholeTopic={onRefreshWholeTopic}
        onVerifyLinuxDo={onVerifyLinuxDo}
      />
    );

    expect(view.queryByText('正在读取主题...')).toBeNull();
    expect(view.getByText('Network request failed')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('重试检测'));
    await fireEvent.press(view.getByLabelText('检查 L 站状态'));
    expect(onRefreshWholeTopic).toHaveBeenCalledTimes(1);
    expect(onVerifyLinuxDo).toHaveBeenCalledTimes(1);
  });

  it('[REG-LINUXDO-007] identifies an active Account probe instead of showing Topic loading', async () => {
    const selectedTopic: Topic = {
      ...topic,
      source: 'linuxdo',
      id: 'linuxdo-topic-2',
      url: 'https://linux.do/t/topic/2'
    };
    const view = await render(
      <TopicFilterHarness
        identityBlocked
        identityChecking
        selectedTopic={selectedTopic}
        topicDetail={{ ...topic, ...selectedTopic }}
      />
    );

    expect(view.getByText('正在确认 L 站访问状态')).toBeTruthy();
    expect(view.queryByText('正在读取主题...')).toBeNull();
  });

  it('disables reply pagination while the next page is loading', async () => {
    const onLoadMoreReplies = jest.fn<() => void>();
    const view = await render(<TopicFilterHarness replyHasMore onLoadMoreReplies={onLoadMoreReplies} />);

    await fireEvent.press(view.getByLabelText('加载更多回复'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);

    await view.rerender(<TopicFilterHarness replyHasMore loadingMoreReplies onLoadMoreReplies={onLoadMoreReplies} />);
    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('正在加载...'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
  });

  it('toggles the local favorite for the current topic and reflects the updated state', async () => {
    const onToggleFavorite = jest.fn<() => void>();
    const view = await render(<TopicFilterHarness onToggleFavorite={onToggleFavorite} />);

    await fireEvent.press(view.getByLabelText('收藏'));
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);

    await view.rerender(<TopicFilterHarness topicFavorite onToggleFavorite={onToggleFavorite} />);
    expect(view.getByLabelText('已收藏')).toBeTruthy();
  });

  it('REG-WRITE-003 exposes the confirmed yaohuo favorite as a yellow cancel action', async () => {
    const onYaohuoFavorite = jest.fn<() => void>();
    const yaohuoTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html',
      bookmarked: true,
      bookmarkId: 987
    };
    const view = await render(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={yaohuoTopic}
        topicDetail={yaohuoTopic}
      />
    );

    const cancelButton = view.getByLabelText('取消原站收藏');
    expect(cancelButton.props.accessibilityState.selected).toBe(true);
    expect(cancelButton.props.testID).toBe('detail-action-favorite');
    await fireEvent.press(cancelButton);
    expect(onYaohuoFavorite).toHaveBeenCalledTimes(1);

    const unfavoritedYaohuoTopic: TopicDetail = {
      ...yaohuoTopic,
      bookmarked: false,
      bookmarkId: undefined
    };
    await view.rerender(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={unfavoritedYaohuoTopic}
        topicDetail={unfavoritedYaohuoTopic}
      />
    );
    expect(view.getByLabelText('原站收藏').props.accessibilityState.selected).toBe(false);
  });

  it('REG-WRITE-003 disables the yaohuo favorite action while its original state is unknown', async () => {
    const onYaohuoFavorite = jest.fn<() => void>();
    const yaohuoTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html'
    };
    const view = await render(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={yaohuoTopic}
        topicDetail={yaohuoTopic}
      />
    );

    const unknownButton = view.getByLabelText('原站收藏状态未加载');
    expect(unknownButton.props.accessibilityState.disabled).toBe(true);
    expect(view.getByText('状态未知')).toBeTruthy();
    await fireEvent.press(unknownButton);
    expect(onYaohuoFavorite).not.toHaveBeenCalled();
  });

  it('[REG-WRITE-004] updates the yaohuo favorite button without replacing the topic layout detail', async () => {
    const onYaohuoFavorite = jest.fn<() => void>();
    const unfavoritedTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html',
      bookmarked: false
    };
    const view = await render(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={unfavoritedTopic}
        topicDetail={unfavoritedTopic}
        yaohuoVisualBookmarked={false}
      />
    );

    await fireEvent.press(view.getByLabelText('原站收藏'));
    expect(onYaohuoFavorite).toHaveBeenCalledTimes(1);
    await view.rerender(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={unfavoritedTopic}
        topicDetail={unfavoritedTopic}
        yaohuoVisualBookmarked
      />
    );

    expect(view.getByLabelText('取消原站收藏').props.accessibilityState.selected).toBe(true);
  });

  it('[REG-WRITE-005] keeps HTML rendering inputs stable for yaohuo favorite and cancel confirmations', async () => {
    const unbookmarkedTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html',
      bookmarked: false
    };
    const onRender = jest.fn<(renderers: object, rendererProps: object) => void>();
    const view = await render(
      <HtmlRendererIdentityHarness
        onRender={onRender}
        selectedTopic={unbookmarkedTopic}
        topicDetail={unbookmarkedTopic}
      />
    );
    const initialRenderers = onRender.mock.calls.at(-1)?.[0];
    const initialRendererProps = onRender.mock.calls.at(-1)?.[1];

    const bookmarkedTopic: TopicDetail = { ...unbookmarkedTopic, bookmarked: true, bookmarkId: 987 };
    await view.rerender(
      <HtmlRendererIdentityHarness
        onRender={onRender}
        selectedTopic={unbookmarkedTopic}
        topicDetail={bookmarkedTopic}
      />
    );

    expect(onRender.mock.calls.at(-1)?.[0]).toBe(initialRenderers);
    expect(onRender.mock.calls.at(-1)?.[1]).toBe(initialRendererProps);

    await view.rerender(
      <HtmlRendererIdentityHarness
        onRender={onRender}
        selectedTopic={unbookmarkedTopic}
        topicDetail={{ ...bookmarkedTopic, bookmarked: false, bookmarkId: undefined }}
      />
    );

    expect(onRender.mock.calls.at(-1)?.[0]).toBe(initialRenderers);
    expect(onRender.mock.calls.at(-1)?.[1]).toBe(initialRendererProps);
  });

  it('updates visible replies for every filter and comment query', async () => {
    const view = await render(<TopicFilterHarness />);

    expect(view.getByText('3 条')).toBeTruthy();
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual([
      'reply-1-alice',
      'reply-2-bob',
      'reply-3-alice'
    ]);

    await fireEvent.press(view.getByLabelText('只看楼主'));
    expect(view.getByLabelText('只看楼主，已选择')).toBeTruthy();
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual(['reply-1-alice', 'reply-3-alice']);

    await fireEvent.press(view.getByLabelText('只看带图'));
    expect(view.getByLabelText('只看带图，已选择')).toBeTruthy();
    expect(view.getByText('reply-2-bob')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('倒序'));
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual([
      'reply-3-alice',
      'reply-2-bob',
      'reply-1-alice'
    ]);

    await fireEvent.press(view.getByLabelText('全部'));
    await fireEvent.changeText(view.getByLabelText('评论内查找'), 'needle');
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual(['reply-2-bob', 'reply-3-alice']);

    await fireEvent.press(view.getByLabelText('清空查找'));
    expect(view.getByText('3 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] shows the two visible replies in the count after selecting only the author', async () => {
    const view = await render(<TopicFilterHarness />);

    await fireEvent.press(view.getByLabelText('只看楼主'));

    expect(view.getByText('2 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] shows the one visible reply in the count after selecting replies with images', async () => {
    const view = await render(<TopicFilterHarness />);

    await fireEvent.press(view.getByLabelText('只看带图'));

    expect(view.getByText('1 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] shows the two visible replies in the count after a comment query', async () => {
    const view = await render(<TopicFilterHarness />);

    await fireEvent.changeText(view.getByPlaceholderText('评论内查找'), 'needle');

    expect(view.getByText('2 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] keeps the count aligned with the debounced result while a cleared query settles', async () => {
    const view = await render(<TopicFilterHarness filteredCommentQuery="needle" />);

    expect(view.getAllByText(/^reply-/)).toHaveLength(2);
    expect(view.getByText('2 条')).toBeTruthy();

    await view.rerender(<TopicFilterHarness filteredCommentQuery="first" />);
    expect(view.getAllByText(/^reply-/)).toHaveLength(1);
    expect(view.getByText('1 条')).toBeTruthy();
  });
});
