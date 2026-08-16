import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor, within } from '../render';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Reply, ReplyOrder, Source, SourceErrorInfo, Topic, TopicDetail, TopicPoll } from '@/domain/forum/models';
import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import type { ReplyFilter } from '@/features/topic/model/types';
import type { TopicSessionController } from '@/features/topic/useTopicSessionController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { discoursePollPlaceholder, prepareReplyContent, prepareTopicContent } from '@/domain/forum/topicContentSplit';
import { sanitizeLinuxDoContentHtml } from '@/sources/linuxdo/parser';
import { buildHtmlRenderingStyles } from '@/features/topic/rendering/htmlStyles';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { TopicScreen } from '@/features/topic/TopicScreen';
import { createTheme } from '@/ui/theme/tokens';
import { createTopicImageDeriver } from '@/features/topic/model/topicDerivedData';
import type { InteractionType } from '@/domain/forum/topicActionState';
import type { TopicActionDecisionFor } from '@/features/topic/actions/topicActionDecision';
import type { TopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import type { useTopicController } from '@/features/topic/useTopicController';
import type { TopicListItem } from '@/features/topic/model/topicListModel';
import type { ToggleTopicBodyQuoteOptions } from '@/domain/forum/quotedPosts';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { forumContentRegionForSegment, singleForumContentSegment } from '../../helpers/forumContentSegments';

const mockGetDiscourseSourceEmojiUrls = jest.fn(async () => ({}));
const mockScrollToIndex = jest.fn();
const mockCompileForumContent = jest.fn();
const mockNodeSeekTopicReactionStats = jest.fn<(item: TopicDetail) => { label: string; value: number }[]>(() => []);
let lastFlashListItemTypes: string[] = [];
let lastFlashListItemKeys: string[] = [];
let lastFlashListProps: Record<string, any> = {};
let mockBodyMediaViewportRowKeys: readonly string[] = [];

function lastReplyListIndex(floor: number) {
  return ((lastFlashListProps.data || []) as { reply?: Reply }[]).findIndex((item) => item.reply?.floor === floor);
}

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
        testID,
        ...props
      }: {
        accessibilityLabel?: string;
        data?: unknown[];
        keyExtractor?: (item: unknown, index: number) => string;
        ListFooterComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
        [key: string]: unknown;
      },
      ref: React.ForwardedRef<{ scrollToIndex: (options: unknown) => void; scrollToOffset: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        scrollToIndex: (options: unknown) => mockScrollToIndex(options),
        scrollToOffset: () => undefined
      }));
      lastFlashListItemTypes = data.map((item) => String((item as { type?: unknown }).type || 'unknown'));
      lastFlashListItemKeys = data.map((item, index) => keyExtractor?.(item, index) ?? String(index));
      lastFlashListProps = { ...props, data };
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
    }),
    useMappingHelper: () => ({ getMappingKey: (key: string | number) => String(key) })
  };
});

jest.mock('@/features/topic/media/TopicBodyMediaCoordinator', () => {
  const ReactModule = require('react') as typeof React;
  const actual = jest.requireActual<typeof import('@/features/topic/media/TopicBodyMediaCoordinator')>(
    '@/features/topic/media/TopicBodyMediaCoordinator'
  );
  return {
    ...actual,
    TopicBodyMediaCoordinatorProvider: (
      props: React.ComponentProps<typeof actual.TopicBodyMediaCoordinatorProvider>
    ) => {
      mockBodyMediaViewportRowKeys = props.viewportRowKeys;
      return ReactModule.createElement(actual.TopicBodyMediaCoordinatorProvider, props);
    }
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
  const { Text: NativeText, View: NativeView } = require('react-native') as typeof import('react-native');
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    ReactModule.createElement(ReactModule.Fragment, null, children);
  const RenderersContext = ReactModule.createContext<Record<string, React.ComponentType<any>>>({});
  const nodeText = (node: { children?: unknown[]; data?: unknown }): string =>
    `${typeof node.data === 'string' ? node.data : ''}${
      Array.isArray(node.children)
        ? node.children.map((child) => nodeText(child as { children?: unknown[]; data?: unknown })).join('')
        : ''
    }`;
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
    TChildrenRenderer: ({ tchildren }: { tchildren: { children?: unknown[]; data?: unknown; nodeIndex?: number }[] }) =>
      ReactModule.createElement(
        NativeView,
        null,
        ...tchildren.map((child, index) =>
          ReactModule.createElement(NativeText, { key: child.nodeIndex ?? index }, nodeText(child))
        )
      ),
    TRenderEngineProvider: Passthrough,
    defaultHTMLElementModels: {
      details: { extend: () => ({}) },
      summary: { extend: () => ({}) }
    },
    useAmbientTRenderEngine: () => null,
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
jest.mock('@/ui/content/ForumContentVideo', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable } = require('react-native') as typeof import('react-native');
  return {
    ForumContentVideo: ({
      admission,
      boundarySpacing,
      src
    }: {
      admission?: { admitted: boolean; settle: (outcome: string) => void };
      boundarySpacing?: StyleProp<ViewStyle>;
      src: string;
    }) =>
      ReactModule.createElement(NativePressable, {
        accessibilityLabel: `mock forum video ${src}`,
        onPress: () => admission?.settle('displayed'),
        style: boundarySpacing,
        testID: admission?.admitted === false ? 'topic-managed-video-waiting' : 'topic-managed-video-admitted'
      })
  };
});
jest.mock('@/domain/forum/topicContentSplit', () => {
  const actual = jest.requireActual<typeof import('@/domain/forum/topicContentSplit')>(
    '@/domain/forum/topicContentSplit'
  );
  return {
    ...actual,
    compileForumContent: (...args: Parameters<typeof actual.compileForumContent>) => {
      mockCompileForumContent(...args);
      return actual.compileForumContent(...args);
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
  const actual = jest.requireActual<typeof import('@/features/topic/components/TopicContentBlock')>(
    '@/features/topic/components/TopicContentBlock'
  );
  return {
    MemoizedTopicContentBlock: (props: {
      contentWidth: number;
      originalImageUpgradeEnabled?: boolean;
      query?: string;
      region: import('@/domain/forum/topicContentSplit').ForumContentMaterializationRegion;
      trimTrailingBlockSpacing?: boolean;
    }) => {
      const { originalImageUpgradeEnabled, region } = props;
      if (
        region.kind === 'island' &&
        (region.segment.type === 'codeBlock' ||
          region.segment.type === 'disclosureHeader' ||
          region.segment.type === 'terminalReportHeader')
      ) {
        return ReactModule.createElement(actual.TopicContentBlock, props);
      }
      const firstSegment = region.kind === 'selectable' ? region.segments[0] : region.segment;
      const continuation = firstSegment?.ancestorFrames[0]?.semanticContinuation || firstSegment?.semanticContinuation;
      return ReactModule.createElement(
        NativeView,
        {
          accessibilityLabel: `content-continuation-${continuation}`,
          testID: `topic-html-block-${originalImageUpgradeEnabled ? 'ready' : 'deferred'}`
        },
        ReactModule.createElement(NativeText, null, region.fallbackText)
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
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView
  } = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual<typeof import('@/features/topic/components/ReplyItem')>(
    '@/features/topic/components/ReplyItem'
  );
  return {
    DiscourseReactionPill: ({ stat }: { stat: { id: string; imageUrl?: string; label: string; value: number } }) =>
      ReactModule.createElement(
        NativeText,
        { testID: `reaction-${stat.id}` },
        `${stat.label} ${stat.value}${stat.imageUrl ? ` ${stat.imageUrl}` : ''}`
      ),
    MemoizedReplyItem: (props: {
      bodyContent?: import('@/features/topic/model/replyListModel').ReplyRenderableContent;
      isTerminal?: boolean;
      onLocateReply: (target: { floor?: number }) => void;
      onQuoteContentLayout?: (options: { contentToken: string; instanceKey: string }) => void;
      reply: Reply;
      section?: {
        contentToken?: string;
        instanceKey?: string;
        key: string;
        measureForMaterialization?: boolean;
        type?: string;
      };
    }) => {
      const { isTerminal, onQuoteContentLayout, reply, section } = props;
      if (!section && props.bodyContent?.kind === 'island' && props.bodyContent.segment.type === 'codeBlock') {
        return ReactModule.createElement(actual.ReplyItem, props as never);
      }
      if (
        section?.type === 'replyContent' ||
        section?.type === 'replySignatureContent' ||
        section?.type === 'replyQuoteContent'
      ) {
        return ReactModule.createElement(actual.ReplyItem, props as never);
      }
      if (section?.type === 'replyEnd') {
        return isTerminal ? ReactModule.createElement(NativeView, { testID: 'terminal-reply' }) : null;
      }
      if (section?.type === 'replyQuoteSummary') {
        return section.measureForMaterialization
          ? ReactModule.createElement(NativeView, {
              onLayout: () =>
                onQuoteContentLayout?.({
                  contentToken: section.contentToken!,
                  instanceKey: section.instanceKey!
                }),
              testID: `reply-quote-materialization-${section.key}`
            })
          : null;
      }
      return ReactModule.createElement(
        NativeView,
        isTerminal ? { testID: 'terminal-reply' } : undefined,
        ReactModule.createElement(
          NativeText,
          { testID: `reply-floor-${reply.floor}` },
          `reply-${reply.floor}-${reply.author}`
        ),
        reply.replyTarget?.floor
          ? ReactModule.createElement(
              NativePressable,
              {
                accessibilityLabel: `定位回复目标，第 ${reply.replyTarget.floor} 楼`,
                accessibilityRole: 'link',
                onPress: () => props.onLocateReply({ floor: reply.replyTarget!.floor })
              },
              ReactModule.createElement(NativeText, null, `#${reply.replyTarget.floor}`)
            )
          : null
      );
    },
    NodeSeekStatPill: ({ label, value }: { label: string; value: number }) =>
      ReactModule.createElement(NativeText, { testID: `readonly-stat-${label}` }, `${label} ${value}`),
    nodeSeekTopicReactionStats: (item: TopicDetail) => mockNodeSeekTopicReactionStats(item)
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
  loadingPreviousReplies = false,
  loadingQuotedFloors = {},
  onLocateReply = jest.fn(async () => 'completed'),
  onLoadMoreReplies = jest.fn(),
  onLoadPreviousReplies = jest.fn(),
  onInteract = jest.fn(),
  onImagePreviewDescriptors = jest.fn(),
  onRefreshWholeTopic = jest.fn(),
  onRetryReplies = jest.fn(),
  onReplyComposerOpenChange = jest.fn(),
  onToggleFavorite = jest.fn(),
  onYaohuoFavorite = jest.fn(),
  onVerifyNodeSeek = jest.fn(),
  onVerifyLinuxDo = jest.fn(),
  onVotePoll = jest.fn(),
  onDiscourseBookmark = jest.fn(),
  onToggleTopicBodyQuote = jest.fn(),
  prepareContent = true,
  replyHasMore = false,
  replyHasPrevious = false,
  replyEndError = null,
  replyStartError = null,
  replyCollectionComplete = true,
  replyRowsPartial = false,
  repliesError = null,
  repliesLoading = false,
  selectedTopic = topic,
  topicReplies = sourceReplies,
  topicDetail = topic,
  topicError = null,
  topicFavorite = false,
  topicBusy = false,
  targetReply,
  targetReplyRequestId,
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
  loadingPreviousReplies?: boolean;
  loadingQuotedFloors?: Record<string, boolean>;
  onLoadMoreReplies?: (options?: { silent?: boolean }) => void;
  onLoadPreviousReplies?: (options?: { silent?: boolean }) => void;
  onInteract?: (type: InteractionType, commentId?: number) => void;
  onImagePreviewDescriptors?: (descriptors: readonly ForumImagePreviewDescriptor[]) => void;
  onLocateReply?: (target: { commentId?: number; floor?: number; pageHint?: number }) => Promise<string>;
  onRefreshWholeTopic?: () => void;
  onRetryReplies?: (edge?: 'start' | 'end') => void;
  onReplyComposerOpenChange?: (open: boolean) => void;
  onToggleFavorite?: () => void;
  onYaohuoFavorite?: () => void;
  onVerifyNodeSeek?: () => void;
  onVerifyLinuxDo?: () => void;
  onVotePoll?: (poll: TopicPoll, optionIds: string[]) => void;
  onDiscourseBookmark?: () => void;
  onToggleTopicBodyQuote?: (options: ToggleTopicBodyQuoteOptions) => void;
  prepareContent?: boolean;
  replyHasMore?: boolean;
  replyHasPrevious?: boolean;
  replyEndError?: SourceErrorInfo | null;
  replyStartError?: SourceErrorInfo | null;
  replyCollectionComplete?: boolean;
  replyRowsPartial?: boolean;
  repliesError?: SourceErrorInfo | null;
  repliesLoading?: boolean;
  selectedTopic?: Topic;
  topicReplies?: Reply[];
  topicDetail?: TopicDetail | null;
  topicError?: SourceErrorInfo | null;
  topicFavorite?: boolean;
  topicBusy?: boolean;
  targetReply?: { commentId?: number; floor?: number; pageHint?: number };
  targetReplyRequestId?: number;
  yaohuoVisualBookmarked?: boolean;
} = {}) {
  const [commentQuery, setCommentQuery] = useState('');
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyOrder, setReplyOrder] = useState<ReplyOrder>('oldest');
  const topicScrollRef = useRef(null);
  const effectiveCommentQuery = filteredCommentQuery ?? commentQuery;
  const preparedTopicDetail = React.useMemo(
    () => (topicDetail && prepareContent ? prepareTopicContent(topicDetail) : topicDetail),
    [prepareContent, topicDetail]
  );
  const contentSource = preparedTopicDetail?.source || selectedTopic?.source || 'v2ex';
  const preparedTopicReplies = React.useMemo(
    () => (prepareContent ? topicReplies.map((reply) => prepareReplyContent(reply, contentSource)) : topicReplies),
    [contentSource, prepareContent, topicReplies]
  );
  const preparedLoadedQuotedReplies = React.useMemo(
    () =>
      Object.fromEntries(
        Object.entries(loadedQuotedReplies).map(([key, reply]) => [
          key,
          prepareContent ? prepareReplyContent(reply, key.split(':')[0] as Source, 'quoted-reply') : reply
        ])
      ),
    [loadedQuotedReplies, prepareContent]
  );
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
    loadPreviousReplies: async (options?: { silent?: boolean }) => {
      onLoadPreviousReplies(options);
      return true;
    },
    loadMoreReplies: async (options?: { silent?: boolean }) => {
      onLoadMoreReplies(options);
      return true;
    },
    loadedQuotedReplies: preparedLoadedQuotedReplies,
    loadingMoreReplies,
    loadingPreviousReplies,
    loadingQuotedFloors,
    replyHasMore,
    replyHasPrevious,
    replyEndError,
    replyStartError,
    replyCollectionComplete,
    replyRowsPartial,
    repliesError,
    repliesLoading,
    retryReplies: async (edge?: 'start' | 'end') => {
      onRetryReplies(edge);
      return 'completed';
    },
    locateReply: onLocateReply,
    toggleReplyQuote: jest.fn(),
    toggleTopicBodyQuote: onToggleTopicBodyQuote,
    topicReplies: preparedTopicReplies,
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
      replyOrder,
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
        changeReplyFilter: setReplyFilter,
        changeReplyOrder: setReplyOrder
      }
    }
  } as unknown as TopicSessionController;

  return (
    <QueryTestWrapper>
      <View>
        <TopicScreen
          actions={actions}
          article={{
            busy: topicBusy,
            error: topicError,
            topic: preparedTopicDetail,
            yaohuoBookmarked: yaohuoVisualBookmarked ?? preparedTopicDetail?.bookmarked
          }}
          chrome={{
            back: jest.fn(),
            favorite: topicFavorite,
            getDiscourseEmojiUrls,
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
              mediaContext: {
                contentSource: preparedTopicDetail?.source || null,
                sessionIdentity: `${preparedTopicDetail?.source || 'public'}:0`
              },
              mediaSessionIdentity: `${preparedTopicDetail?.source || 'public'}:0`,
              topicImageDeriver
            } as ReturnType<typeof useHtmlRenderingController> & { contentWidth: number; mediaSessionIdentity: string }
          }
          nodeSeekUserId={null}
          onImagePreviewDescriptors={onImagePreviewDescriptors}
          read={read}
          session={session}
          targetReply={targetReply}
          targetReplyRequestId={targetReplyRequestId}
          topicScrollRef={topicScrollRef}
        />
        <Text testID="active-filter">{replyFilter}</Text>
        <Text testID="active-order">{replyOrder}</Text>
      </View>
    </QueryTestWrapper>
  );
}

describe('NodeSeek reply count availability', () => {
  it('[REG-TOPIC-068] omits an unavailable NodeSeek total instead of showing the loaded window size', async () => {
    const nodeSeekTopic = {
      ...topic,
      source: 'nodeseek' as const,
      url: 'https://www.nodeseek.com/post-topic-1-1',
      replyCount: undefined as unknown as number
    };
    const view = await render(
      <TopicFilterHarness selectedTopic={nodeSeekTopic} topicDetail={nodeSeekTopic} topicReplies={sourceReplies} />
    );

    expect(view.getByTestId('topic-detail-loaded')).toBeTruthy();
    expect(view.queryByText('3 条')).toBeNull();
  });
});

describe('Topic reply filters', () => {
  it('[REG-PERF-018] computes NodeSeek topic reactions once per render without changing the visible stats', async () => {
    const nodeSeekTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-topic-1-1'
    };
    mockNodeSeekTopicReactionStats.mockClear();
    mockNodeSeekTopicReactionStats.mockReturnValue([{ label: '点赞', value: 7 }]);

    try {
      const view = await render(
        <TopicFilterHarness selectedTopic={nodeSeekTopic} topicDetail={nodeSeekTopic} topicReplies={[]} />
      );

      expect(mockNodeSeekTopicReactionStats).toHaveBeenCalledTimes(1);
      expect(view.getByTestId('readonly-stat-点赞').props.children).toBe('点赞 7');
    } finally {
      mockNodeSeekTopicReactionStats.mockReturnValue([]);
    }
  });

  it('[REG-TOPIC-096] keeps the ready preview catalog independent of filtering and reply order', async () => {
    const quoteInstanceKey = 'topic:preview-catalog-owner:linuxdo:quoted-topic:9';
    const replies: Reply[] = [
      {
        author: 'first',
        contentHtml: '<p>needle</p><img src="https://img.example/reply-1.webp">',
        createdAt: '2026-08-14T00:01:00.000Z',
        floor: 2,
        signatureHtml: '<img src="https://img.example/signature-1.webp">'
      },
      {
        author: 'second',
        contentHtml: '<img src="https://img.example/reply-2.webp">',
        createdAt: '2026-08-14T00:02:00.000Z',
        floor: 3
      }
    ];
    const quotedReply = {
      author: 'quoted',
      contentHtml: '<img src="https://img.example/quoted.webp">',
      createdAt: '2026-08-14T00:03:00.000Z',
      floor: 9,
      signatureHtml: '<img src="https://img.example/quoted-signature.webp">'
    } satisfies Reply;
    const loadedQuotedReplies = { 'linuxdo:quoted-topic:9': quotedReply };
    const imageTopic = {
      ...topic,
      id: 'preview-catalog-owner',
      source: 'linuxdo' as const,
      url: 'https://linux.do/t/preview-catalog-owner',
      contentHtml:
        '<img src="https://img.example/opening.webp"><aside class="quote" data-post="9" data-topic="quoted-topic" data-username="quoted"><div class="title">quoted:</div><blockquote>preview</blockquote></aside>',
      replies
    };
    const onImagePreviewDescriptors = jest.fn<(descriptors: readonly ForumImagePreviewDescriptor[]) => void>();
    const harnessProps = {
      loadedQuotedReplies,
      onImagePreviewDescriptors,
      selectedTopic: imageTopic,
      topicDetail: imageTopic,
      topicReplies: replies
    };
    mockCompileForumContent.mockClear();
    const view = await render(<TopicFilterHarness {...harnessProps} expandedQuotes={{ [quoteInstanceKey]: true }} />);

    await waitFor(() => expect(onImagePreviewDescriptors).toHaveBeenCalled());
    expect(onImagePreviewDescriptors.mock.calls.at(-1)?.[0].map((descriptor) => descriptor.source)).toEqual([
      'https://img.example/opening.webp',
      'https://img.example/reply-1.webp',
      'https://img.example/signature-1.webp',
      'https://img.example/reply-2.webp',
      'https://img.example/quoted.webp',
      'https://img.example/quoted-signature.webp'
    ]);
    expect(lastFlashListItemTypes).toContain('topicQuoteContent');
    expect(
      mockCompileForumContent.mock.calls.filter(
        ([options]) => (options as { html?: string }).html === quotedReply.contentHtml
      )
    ).toHaveLength(0);
    const registrationCount = onImagePreviewDescriptors.mock.calls.length;

    await fireEvent.changeText(view.getByPlaceholderText('评论内查找'), 'needle');
    await fireEvent.press(view.getByLabelText('回复排序，当前正序'));
    await fireEvent.press(view.getByLabelText('倒序'));
    await act(() => lastFlashListProps.onViewableItemsChanged({ viewableItems: [] }));
    await view.rerender(<TopicFilterHarness {...harnessProps} expandedQuotes={{}} />);
    expect(lastFlashListItemTypes).not.toContain('topicQuoteContent');
    await view.rerender(<TopicFilterHarness {...harnessProps} expandedQuotes={{ [quoteInstanceKey]: true }} />);

    expect(onImagePreviewDescriptors).toHaveBeenCalledTimes(registrationCount);
    expect(
      mockCompileForumContent.mock.calls.filter(
        ([options]) => (options as { html?: string }).html === quotedReply.contentHtml
      )
    ).toHaveLength(0);
  });

  it('[REG-TOPIC-062] scrolls an atomically anchored notification window without chasing pages', async () => {
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
    mockScrollToIndex.mockClear();

    const view = await render(
      <TopicFilterHarness
        onLoadMoreReplies={loadMore}
        replyHasMore
        selectedTopic={targetTopic}
        targetReply={{ commentId: 11640077, floor: 21 }}
        topicDetail={targetTopic}
        topicReplies={pages[2]}
      />
    );

    await waitFor(() => expect(view.getByTestId('reply-floor-99')).toBeTruthy());
    expect(loadMore).not.toHaveBeenCalled();
    expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    expect(mockScrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ animated: true, viewPosition: 0.2 }));
  });

  it('[REG-TOPIC-092] reissues the same loaded reply location on every explicit press', async () => {
    const replies: Reply[] = [
      {
        author: 'target',
        contentHtml: '<p>目标回复</p>',
        createdAt: '2026-08-01T00:00:00.000Z',
        floor: 3
      },
      {
        author: 'caller',
        contentHtml: '<p>回复关系</p>',
        createdAt: '2026-08-01T00:01:00.000Z',
        floor: 10,
        replyTarget: { floor: 3 }
      },
      {
        author: 'other-target',
        contentHtml: '<p>另一个目标</p>',
        createdAt: '2026-08-01T00:02:00.000Z',
        floor: 4
      },
      {
        author: 'other-caller',
        contentHtml: '<p>另一条回复关系</p>',
        createdAt: '2026-08-01T00:03:00.000Z',
        floor: 11,
        replyTarget: { floor: 4 }
      }
    ];
    const targetTopic: TopicDetail = {
      ...topic,
      id: 'repeat-location-topic',
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-859086-2',
      replies,
      replyCount: replies.length
    };
    const locateReply = jest.fn(async () => 'completed');
    mockScrollToIndex.mockClear();
    const view = await render(
      <TopicFilterHarness
        onLocateReply={locateReply}
        selectedTopic={targetTopic}
        topicDetail={targetTopic}
        topicReplies={replies}
      />
    );
    const target = view.getByRole('link', { name: '定位回复目标，第 3 楼' });
    const otherTarget = view.getByRole('link', { name: '定位回复目标，第 4 楼' });

    await fireEvent.press(target);
    await waitFor(() => {
      expect(locateReply).toHaveBeenCalledTimes(1);
      expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    });
    const targetHighlightStyle = () =>
      StyleSheet.flatten(view.getByTestId('reply-floor-3').parent?.parent?.props.style);
    expect(targetHighlightStyle()?.backgroundColor).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_850));
    });
    expect(targetHighlightStyle()?.backgroundColor).toBeUndefined();
    await fireEvent.press(target);
    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledTimes(2));
    expect(targetHighlightStyle()?.backgroundColor).toBeTruthy();
    await fireEvent.press(otherTarget);
    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledTimes(3));
    await fireEvent.press(target);
    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledTimes(4));

    expect(locateReply).toHaveBeenCalledTimes(4);
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ animated: true, index: lastReplyListIndex(3), viewPosition: 0.2 })
    );
  });

  it('[REG-TOPIC-092] consumes repeated same-topic HTML floor links as distinct route commands', async () => {
    const replies: Reply[] = [
      {
        author: 'target',
        contentHtml: '<p>目标回复</p>',
        createdAt: '2026-08-01T00:00:00.000Z',
        floor: 3
      }
    ];
    const targetTopic: TopicDetail = {
      ...topic,
      id: 'repeat-html-location-topic',
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-859086-2',
      replies,
      replyCount: replies.length
    };
    const tree = (targetReplyRequestId: number) => (
      <TopicFilterHarness
        selectedTopic={targetTopic}
        targetReply={{ floor: 3 }}
        targetReplyRequestId={targetReplyRequestId}
        topicDetail={targetTopic}
        topicReplies={replies}
      />
    );
    mockScrollToIndex.mockClear();
    const view = await render(tree(1));
    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledTimes(1));

    await view.rerender(tree(2));
    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledTimes(2));
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ animated: true, index: lastReplyListIndex(3), viewPosition: 0.2 })
    );
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

  it('[REG-TOPIC-091] admits a newly selected terminal-tab long image without waiting for a scroll', async () => {
    const terminalTopic: TopicDetail = {
      ...topic,
      contentHtml:
        '<forum-terminal-report>' +
        '<forum-terminal-tab title="Long image"><p><img src="https://img.example.com/long.png" width="630" height="1450"></p></forum-terminal-tab>' +
        '<forum-terminal-tab title="Code"><div class="forum-terminal-code">second tab</div></forum-terminal-tab>' +
        '</forum-terminal-report>',
      id: 'terminal-tab-long-image',
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-812712-1'
    };
    const compiledRow = (item: TopicListItem) =>
      item.type === 'topicContent' && item.content.type === 'content'
        ? singleForumContentSegment(item.content.region)
        : null;
    mockBodyMediaViewportRowKeys = [];
    const view = await render(
      <TopicFilterHarness selectedTopic={terminalTopic} topicDetail={terminalTopic} topicReplies={[]} />
    );
    const initialItems = lastFlashListProps.data as TopicListItem[];
    const headerItem = initialItems.find((item) => compiledRow(item)?.type === 'terminalReportHeader');
    const headerRow = headerItem ? compiledRow(headerItem) : null;
    if (!headerItem || headerRow?.type !== 'terminalReportHeader') throw new Error('terminal header missing');
    const codeTabId = headerRow.tabs.find((tab) => tab.title === 'Code')?.id;
    const imageItem = initialItems.find((item) =>
      compiledRow(item)?.ancestorFrames.some(
        (frame) => frame.kind === 'terminalTab' && frame.tabId === headerRow.defaultTabId
      )
    );
    if (!imageItem || !codeTabId) throw new Error('terminal body missing');
    expect(compiledRow(imageItem)?.networkMediaCount).toBe(1);

    await act(() =>
      lastFlashListProps.onViewableItemsChanged({
        viewableItems: [headerItem, imageItem].map((item) => ({
          index: initialItems.indexOf(item),
          isViewable: true,
          item
        }))
      })
    );
    expect(mockBodyMediaViewportRowKeys).toContain(imageItem.key);

    await fireEvent.press(view.getByRole('tab', { name: 'Code' }));
    const codeItems = lastFlashListProps.data as TopicListItem[];
    const codeHeaderItem = codeItems.find((item) => compiledRow(item)?.type === 'terminalReportHeader');
    const codeItem = codeItems.find((item) =>
      compiledRow(item)?.ancestorFrames.some((frame) => frame.kind === 'terminalTab' && frame.tabId === codeTabId)
    );
    if (!codeHeaderItem || !codeItem) throw new Error('selected code body missing');
    await act(() =>
      lastFlashListProps.onViewableItemsChanged({
        viewableItems: [codeHeaderItem, codeItem].map((item) => ({
          index: codeItems.indexOf(item),
          isViewable: true,
          item
        }))
      })
    );
    expect(mockBodyMediaViewportRowKeys).toContain(codeItem.key);

    await fireEvent.press(view.getByRole('tab', { name: 'Long image' }));
    expect(mockBodyMediaViewportRowKeys).toContain(imageItem.key);
  });

  it('[REG-TOPIC-081][REG-TOPIC-090][REG-TOPIC-099] removes virtual-list separators across adjacent semantic rows', async () => {
    await render(<TopicFilterHarness selectedTopic={topic} topicDetail={topic} topicReplies={[]} />);
    const separatorHeight = (leadingItem: TopicListItem, trailingItem: TopicListItem) => {
      const separator = lastFlashListProps.ItemSeparatorComponent({ leadingItem, trailingItem }) as React.ReactElement<{
        style?: unknown;
      }> | null;
      return separator
        ? (StyleSheet.flatten(separator.props.style as StyleProp<ViewStyle>) as ViewStyle | undefined)?.height || 0
        : 0;
    };
    const content = (key: string, semanticId: string, semanticContinuation: 'only' | 'first' | 'middle' | 'last') => ({
      type: 'content' as const,
      key,
      region: forumContentRegionForSegment({
        ancestorFrames: [],
        html: `<p>${key}</p>`,
        keySuffix: `${semanticId}:0`,
        networkMediaCount: 0,
        semanticContinuation,
        segmentIndex: semanticContinuation === 'last' ? 1 : 0,
        semanticId,
        type: 'richText' as const
      })
    });
    const openingFirst: TopicListItem = {
      type: 'topicContent',
      key: 'opening-first',
      content: content('opening-first', 'block-0', 'first')
    };
    const openingLast: TopicListItem = {
      type: 'topicContent',
      key: 'opening-last',
      content: content('opening-last', 'block-0', 'last')
    };
    const openingOnly: TopicListItem = {
      type: 'topicContent',
      key: 'opening-only',
      content: content('opening-only', 'block-1', 'only')
    };
    const quoteFirst: TopicListItem = {
      type: 'topicQuoteContent',
      key: 'quote-first',
      content: content('quote-first', 'block-0', 'first'),
      instanceKey: 'quote-a',
      source: 'nodeseek'
    };
    const quoteMetadata = {
      reference: { source: 'nodeseek' as const, topicId: 'quote-topic', postNumber: 1 },
      preview: 'quote preview'
    };
    const quoteSummary: TopicListItem = {
      type: 'topicQuoteSummary',
      key: 'quote-summary',
      content: {
        type: 'quoteSummary',
        key: 'quote-summary',
        instanceKey: 'quote-a',
        quote: quoteMetadata,
        region: forumContentRegionForSegment({
          ancestorFrames: [],
          keySuffix: 'quote-directive:0',
          networkMediaCount: 0,
          semanticContinuation: 'only',
          quote: quoteMetadata,
          segmentIndex: 0,
          semanticId: 'quote-directive',
          type: 'quote'
        })
      }
    };
    const quoteLast: TopicListItem = {
      type: 'topicQuoteContent',
      key: 'quote-last',
      content: content('quote-last', 'block-1', 'only'),
      instanceKey: 'quote-a',
      source: 'nodeseek'
    };
    const otherQuoteLast: TopicListItem = {
      type: 'topicQuoteContent',
      key: 'other-quote-last',
      content: quoteLast.content,
      instanceKey: 'quote-b',
      source: 'nodeseek'
    };
    const acceptedFirst: TopicListItem = {
      type: 'topicAcceptedAnswerContent',
      key: 'accepted-first',
      content: content('accepted-first', 'block-0', 'first'),
      preview: false
    };
    const acceptedLast: TopicListItem = {
      type: 'topicAcceptedAnswerContent',
      key: 'accepted-last',
      content: content('accepted-last', 'block-0', 'last'),
      preview: false
    };
    const terminalHeader: TopicListItem = {
      type: 'topicContent',
      key: 'terminal-header',
      content: {
        type: 'content',
        key: 'terminal-header',
        region: forumContentRegionForSegment({
          ancestorFrames: [],
          defaultTabId: 'report-tab-0',
          keySuffix: 'report:0',
          networkMediaCount: 0,
          semanticContinuation: 'only',
          segmentIndex: 0,
          semanticId: 'report',
          tabs: [{ id: 'report-tab-0', title: 'Overview' }],
          type: 'terminalReportHeader'
        })
      }
    };
    const terminalBody: TopicListItem = {
      type: 'topicContent',
      key: 'terminal-body',
      content: {
        type: 'content',
        key: 'terminal-body',
        region: forumContentRegionForSegment({
          ancestorFrames: [
            {
              defaultTabId: 'report-tab-0',
              kind: 'terminalTab',
              semanticContinuation: 'last',
              reportSemanticId: 'report',
              semanticId: 'report-tab-0',
              tabId: 'report-tab-0'
            }
          ],
          copyText: 'result',
          keySuffix: 'report-body:0',
          networkMediaCount: 0,
          semanticContinuation: 'only',
          runs: [{ text: 'result' }],
          segmentIndex: 0,
          semanticId: 'report-body',
          text: 'result',
          type: 'codeBlock',
          variant: 'terminal'
        })
      }
    };

    expect(separatorHeight(openingFirst, openingLast)).toBe(0);
    expect(separatorHeight(quoteSummary, quoteFirst)).toBe(0);
    expect(separatorHeight(quoteFirst, quoteLast)).toBe(0);
    expect(separatorHeight(acceptedFirst, acceptedLast)).toBe(0);
    expect(separatorHeight(openingOnly, { ...openingOnly, key: 'opening-only-2' })).toBe(10);
    expect(separatorHeight(openingFirst, { ...openingLast, content: content('different', 'block-2', 'last') })).toBe(
      10
    );
    expect(separatorHeight(quoteFirst, otherQuoteLast)).toBe(10);
    expect(separatorHeight(openingFirst, quoteLast)).toBe(10);
    expect(separatorHeight(terminalHeader, terminalBody)).toBe(0);
  });

  it('[REG-TOPIC-081] gives a multi-row opening article only one top boundary', async () => {
    const article: TopicDetail = {
      ...topic,
      contentHtml: Array.from({ length: 6 }, (_, index) => `<p>${String(index).repeat(2300)}</p>`).join(''),
      replies: [],
      replyCount: 0
    };
    const view = await render(<TopicFilterHarness selectedTopic={article} topicDetail={article} topicReplies={[]} />);
    const blocks = view.getAllByLabelText(/^content-continuation-/);
    expect(blocks.length).toBeGreaterThan(1);
    const containers = blocks.map((block) => StyleSheet.flatten(block.parent?.props.style));

    expect(containers[0]).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 });
    containers.slice(1).forEach((container) => {
      expect(container).toMatchObject({ borderTopWidth: 0, paddingTop: 0 });
    });
  });

  it('[REG-PERF-010] keeps continuation chrome only at the outer edges of a split opening group', async () => {
    const splitTopic: TopicDetail = {
      ...topic,
      contentHtml: `<p>${Array.from(
        { length: 12 },
        (_, index) => `<img src="https://img.example.com/chrome-${index}.jpg">`
      ).join('')}</p>`,
      replies: [],
      replyCount: 0
    };
    const view = await render(
      <TopicFilterHarness selectedTopic={splitTopic} topicDetail={splitTopic} topicReplies={[]} />
    );
    const first = view.getByLabelText('content-continuation-first');
    const middle = view.getByLabelText('content-continuation-middle');
    const last = view.getByLabelText('content-continuation-last');
    const firstContainer = StyleSheet.flatten(first.parent?.props.style);
    const middleContainer = StyleSheet.flatten(middle.parent?.props.style);
    const lastContainer = StyleSheet.flatten(last.parent?.props.style);

    expect(firstContainer).toMatchObject({
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingBottom: 0,
      paddingTop: 16
    });
    expect(middleContainer).toMatchObject({ borderBottomWidth: 0, borderTopWidth: 0, paddingBottom: 0, paddingTop: 0 });
    expect(lastContainer).toMatchObject({ borderTopWidth: 0, paddingTop: 0 });
    expect(lastContainer?.paddingBottom).toBeUndefined();
  });

  it('[REG-PERF-010] gives a 2000-image reply to FlashList as direct bounded content rows', async () => {
    const imageReply: Reply = {
      author: 'image-poster',
      commentId: 863650,
      contentHtml: `<p>${Array.from(
        { length: 2000 },
        (_, index) => `<img src="https://img.example.com/${index}.jpg">`
      ).join('')}</p>`,
      createdAt: '2026-08-09T00:00:00.000Z',
      floor: 2
    };
    const imageTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: '863650',
      url: 'https://www.nodeseek.com/post-863650-1',
      contentHtml: '<p>opening body</p>',
      replies: [imageReply],
      replyCount: 1
    };
    lastFlashListItemKeys = [];
    lastFlashListItemTypes = [];

    await render(
      <TopicFilterHarness selectedTopic={imageTopic} topicDetail={imageTopic} topicReplies={[imageReply]} />
    );

    const replyStartIndex = lastFlashListItemTypes.indexOf('replyStart');
    const replyEndIndex = lastFlashListItemTypes.indexOf('replyEnd', replyStartIndex + 1);
    const directReplyRows = lastFlashListItemTypes.slice(replyStartIndex, replyEndIndex + 1);
    expect(directReplyRows).toEqual(['replyStart', ...Array.from({ length: 500 }, () => 'replyContent'), 'replyEnd']);
    const directRowKeys = lastFlashListItemKeys.slice(replyStartIndex, replyEndIndex + 1);
    expect(new Set(directRowKeys).size).toBe(directRowKeys.length);
    expect(directReplyRows).not.toContain('reply');
  });

  it('[REG-PERF-010] gives a poll-only reply to FlashList instead of materializing it inside ReplyItem', async () => {
    const pollReply: Reply = {
      author: 'poll-poster',
      commentId: 864000,
      contentHtml: '',
      createdAt: '2026-08-09T00:00:00.000Z',
      floor: 2,
      polls: [{ name: 'reply-choice', options: [{ id: 'yes', label: 'Yes' }] }]
    };
    const pollTopic: TopicDetail = {
      ...topic,
      source: 'linuxdo',
      id: 'poll-only-reply',
      url: 'https://linux.do/t/poll-only-reply/864000',
      contentHtml: '<p>opening body</p>',
      replies: [pollReply],
      replyCount: 1
    };
    lastFlashListItemTypes = [];

    await render(<TopicFilterHarness selectedTopic={pollTopic} topicDetail={pollTopic} topicReplies={[pollReply]} />);

    const replyStartIndex = lastFlashListItemTypes.indexOf('replyStart');
    const replyEndIndex = lastFlashListItemTypes.indexOf('replyEnd', replyStartIndex + 1);
    expect(lastFlashListItemTypes.slice(replyStartIndex, replyEndIndex + 1)).toEqual([
      'replyStart',
      'replyContent',
      'replyEnd'
    ]);
    expect(lastFlashListItemTypes).not.toContain('reply');
  });

  it('[REG-PERF-010] shares split details within one entrance without crossing main, reply, or signature', async () => {
    const oversizedDetails = (label: string) =>
      `<details><summary>${label} header</summary>${Array.from({ length: 3 }, (_, part) => {
        const imageCount = part < 2 ? 4 : 1;
        return `<p>${label} body ${part + 1}${Array.from(
          { length: imageCount },
          (_, image) => `<img src="https://img.example.com/${label}-${part}-${image}.jpg">`
        ).join('')}</p>`;
      }).join('')}</details>`;
    const detailsReply: Reply = {
      author: 'details-author',
      commentId: 902,
      contentHtml: oversizedDetails('Reply'),
      createdAt: '2026-08-09T00:00:00.000Z',
      floor: 2,
      signatureHtml: oversizedDetails('Signature')
    };
    const detailsTopic: TopicDetail = {
      ...topic,
      contentHtml: oversizedDetails('Main'),
      id: 'split-details',
      replies: [detailsReply],
      replyCount: 1,
      source: 'linuxdo',
      url: 'https://linux.do/t/split-details'
    };
    const view = await render(
      <TopicFilterHarness selectedTopic={detailsTopic} topicDetail={detailsTopic} topicReplies={[detailsReply]} />
    );

    expect(view.getAllByText('Main header')).toHaveLength(1);
    expect(view.getAllByText('Reply header')).toHaveLength(1);
    expect(view.getAllByText('Signature header')).toHaveLength(1);
    expect(view.queryByText('详情')).toBeNull();
    expect(view.queryByText('Main body 1')).toBeNull();
    expect(view.queryByText('Main body 2')).toBeNull();
    expect(view.queryByText('Main body 3')).toBeNull();

    await fireEvent.press(view.getByText('Main header'));

    expect(view.getByText(/Main body 1/)).toBeTruthy();
    expect(view.getByText(/Main body 2/)).toBeTruthy();
    expect(view.getByText(/Main body 3/)).toBeTruthy();
    expect(view.queryByText(/Reply body 1/)).toBeNull();
    expect(view.queryByText(/Signature body 1/)).toBeNull();

    await fireEvent.press(view.getByText('Reply header'));

    expect(view.getByText(/Reply body 1/)).toBeTruthy();
    expect(view.getByText(/Reply body 2/)).toBeTruthy();
    expect(view.getByText(/Reply body 3/)).toBeTruthy();
    expect(view.queryByText(/Signature body 1/)).toBeNull();
  });

  it('[REG-TOPIC-087][REG-TOPIC-088][REG-TOPIC-089] carries one sanitized code owner through the real FlashList reply path', async () => {
    const codeLines = Array.from(
      { length: 52 },
      (_, index) =>
        `${String(index + 1).padStart(2, '0')}.${' '.repeat(50)}code-line-${String(index + 1).padStart(2, '0')}\n`
    ).join('');
    const codeReply: Reply = {
      author: 'code-author',
      commentId: 909,
      contentHtml: sanitizeLinuxDoContentHtml(`<pre><code class="lang-auto">${codeLines}</code></pre>`, []),
      createdAt: '2026-08-09T00:00:00.000Z',
      floor: 9,
      replyTarget: { author: { name: 'target-author' }, floor: 5 }
    };
    const codeTopic: TopicDetail = {
      ...topic,
      contentHtml: '<p>opening body</p>',
      id: '2556285',
      replies: [codeReply],
      replyCount: 1,
      source: 'linuxdo',
      url: 'https://linux.do/t/topic/2556285'
    };
    const view = await render(
      <TopicFilterHarness selectedTopic={codeTopic} topicDetail={codeTopic} topicReplies={[codeReply]} />
    );

    const replyItem = (lastFlashListProps.data as TopicListItem[]).find(
      (item) => item.type === 'reply' && item.reply.floor === 9
    );
    expect(replyItem).toBeDefined();
    expect(lastFlashListProps.getItemType(replyItem)).toBe('reply:codeBlock');
    expect(view.getAllByTestId('topic-code-frame')).toHaveLength(1);
    const rendered = JSON.stringify(view.toJSON());
    expect(rendered.indexOf('target-author')).toBeLessThan(rendered.indexOf('code-line-01'));
    expect(rendered.indexOf('code-line-01')).toBeLessThan(rendered.indexOf('code-line-52'));
  });

  it('[REG-PERF-010] emits one route aggregate with the actual bounded opening-post plan', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const imageTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: '863650',
      url: 'https://www.nodeseek.com/post-863650-1',
      contentHtml: `<p>${Array.from(
        { length: 2000 },
        (_, index) => `<img src="https://secret.example/${index}.jpg?token=private">`
      ).join('')}</p>`,
      replies: [],
      replyCount: 0
    };

    try {
      const view = await render(
        <TopicFilterHarness selectedTopic={imageTopic} topicDetail={imageTopic} topicReplies={[]} />
      );
      await view.unmount();

      const aggregateEvents = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((event) => event.operation === 'topic-body-media');
      expect(aggregateEvents).toEqual([
        expect.objectContaining({ phase: 'intent', source: 'nodeseek' }),
        expect.objectContaining({
          phase: 'finish',
          outcome: 'success',
          plannedRowCount: 500,
          networkMediaCount: 2000
        })
      ]);
      expect(JSON.stringify(aggregateEvents)).not.toContain('secret.example');
    } finally {
      setDiagnosticWriter(null);
    }
  });

  it('[REG-PERF-010] records the first opening row layout from the response-ready monotonic epoch once', async () => {
    const lines: string[] = [];
    let now = 1_000;
    const nowSpy = jest.spyOn(globalThis.performance, 'now').mockImplementation(() => now);
    setDiagnosticWriter((line) => {
      lines.push(line);
    });

    try {
      const layoutTopic: TopicDetail = { ...topic, contentHtml: '<p>opening body</p>' };
      const view = await render(
        <TopicFilterHarness selectedTopic={layoutTopic} topicDetail={layoutTopic} topicReplies={sourceReplies} />
      );
      now = 1_250;
      await fireEvent(view.getAllByTestId(/^topic-html-block-/)[0], 'layout', {
        nativeEvent: { layout: { height: 100, width: 720, x: 0, y: 0 } }
      });
      now = 1_900;
      await fireEvent(view.getAllByTestId(/^topic-html-block-/)[0], 'layout', {
        nativeEvent: { layout: { height: 100, width: 720, x: 0, y: 0 } }
      });
      await view.unmount();

      const finish = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((event) => event.operation === 'topic-body-media' && event.phase === 'finish');
      expect(finish).toEqual(expect.objectContaining({ firstRowElapsedMs: 250 }));
    } finally {
      nowSpy.mockRestore();
      setDiagnosticWriter(null);
    }
  });

  it('[REG-PERF-010] admits at most four atomic opening videos before one settles', async () => {
    const lines: string[] = [];
    const videoTopic: TopicDetail = {
      ...topic,
      id: 'bounded-video-topic',
      contentHtml: Array.from(
        { length: 5 },
        (_, index) => `<forum-video src="https://media.example.com/${index}.mp4"></forum-video>`
      ).join(''),
      replies: [],
      replyCount: 0
    };
    setDiagnosticWriter((line) => {
      lines.push(line);
    });

    try {
      const view = await render(
        <TopicFilterHarness selectedTopic={videoTopic} topicDetail={videoTopic} topicReplies={[]} />
      );
      expect(view.queryAllByTestId('topic-managed-video-admitted')).toHaveLength(0);
      expect(view.getAllByTestId('topic-managed-video-waiting')).toHaveLength(5);

      const videoRows = (lastFlashListProps.data as { key: string; type: string }[]).filter(
        (listItem) => listItem.type === 'topicContent'
      );
      expect(videoRows).toHaveLength(5);
      await act(async () => {
        lastFlashListProps.onViewableItemsChanged({
          viewableItems: videoRows.map((listItem, index) => ({ index, isViewable: true, item: listItem }))
        });
      });
      await waitFor(() => expect(view.getAllByTestId('topic-managed-video-admitted')).toHaveLength(4));

      await fireEvent.press(view.getAllByTestId('topic-managed-video-admitted')[0]);
      await waitFor(() => expect(view.getAllByTestId('topic-managed-video-admitted')).toHaveLength(5));
      await view.unmount();

      const finish = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((event) => event.operation === 'topic-body-media' && event.phase === 'finish');
      expect(finish).toEqual(expect.objectContaining({ runningHighWater: 4 }));
    } finally {
      setDiagnosticWriter(null);
    }
  });

  it('[REG-PERF-010] inserts expanded opening-post quote content as direct FlashList rows', async () => {
    const quoteInstanceKey = 'topic:opening-quote-owner:linuxdo:quoted-topic:8';
    const quotedReply: Reply = {
      author: 'quoted-author',
      contentHtml: `<p>${Array.from(
        { length: 2000 },
        (_, index) => `<img src="https://img.example.com/quote-${index}.jpg">`
      ).join('')}</p>`,
      createdAt: '2026-08-09T00:00:00.000Z',
      floor: 8
    };
    const quoteTopic: TopicDetail = {
      ...topic,
      source: 'linuxdo',
      id: 'opening-quote-owner',
      url: 'https://linux.do/t/topic/opening-quote-owner',
      contentHtml:
        '<p>before</p><aside class="quote" data-post="8" data-topic="quoted-topic" data-username="quoted-author"><div class="title">quoted-author:</div><blockquote>preview</blockquote></aside><p>after</p>',
      replies: [],
      replyCount: 0
    };
    lastFlashListItemTypes = [];

    const quoteProps = {
      loadedQuotedReplies: { 'linuxdo:quoted-topic:8': quotedReply },
      selectedTopic: quoteTopic,
      topicDetail: quoteTopic,
      topicReplies: [] as Reply[]
    };
    const view = await render(<TopicFilterHarness expandedQuotes={{ [quoteInstanceKey]: true }} {...quoteProps} />);

    const summaryIndex = lastFlashListItemTypes.indexOf('topicQuoteSummary');
    expect(summaryIndex).toBeGreaterThan(0);
    expect(lastFlashListItemTypes.filter((type) => type === 'topicQuoteContent')).toHaveLength(500);
    expect(lastFlashListItemTypes.slice(summaryIndex + 1, summaryIndex + 501)).toEqual(
      Array.from({ length: 500 }, () => 'topicQuoteContent')
    );
    expect(lastFlashListItemTypes[summaryIndex + 501]).toBe('topicContent');
    expect(lastFlashListItemTypes.indexOf('replyControls')).toBe(summaryIndex + 502);
    expect(view.queryByText('preview')).toBeNull();

    await view.rerender(<TopicFilterHarness expandedQuotes={{}} {...quoteProps} />);
    expect(lastFlashListItemTypes.filter((type) => type === 'topicQuoteContent')).toHaveLength(0);
    expect(view.getByText('preview')).toBeTruthy();
  });

  it('[REG-TOPIC-003] expands a same-topic opening quote from the current reply instead of stale quote cache', async () => {
    const topicId = 'same-topic-quote-owner';
    const currentReply: Reply = {
      author: 'current-author',
      contentHtml: '<p>current same-topic body</p>',
      createdAt: '2026-08-15T00:00:00.000Z',
      floor: 2
    };
    const cachedReply: Reply = {
      ...currentReply,
      author: 'cached-author',
      contentHtml: '<p>stale cached body</p>'
    };
    const quoteTopic: TopicDetail = {
      ...topic,
      source: 'linuxdo',
      id: topicId,
      url: `https://linux.do/t/topic/${topicId}`,
      contentHtml: `<aside class="quote" data-post="2" data-topic="${topicId}" data-username="current-author"><div class="title">current-author:</div><blockquote>preview</blockquote></aside>`,
      replies: [currentReply],
      replyCount: 1
    };
    const view = await render(
      <TopicFilterHarness
        expandedQuotes={{ [`topic:${topicId}:linuxdo:${topicId}:2`]: true }}
        loadedQuotedReplies={{ [`linuxdo:${topicId}:2`]: cachedReply }}
        selectedTopic={quoteTopic}
        topicDetail={quoteTopic}
        topicReplies={[currentReply]}
      />
    );
    const rendered = JSON.stringify(view.toJSON());

    expect(rendered).toContain('current same-topic body');
    expect(rendered).not.toContain('stale cached body');
  });

  it('[REG-PERF-010] keeps a giant accepted answer to one preview row until explicitly expanded', async () => {
    const acceptedFloor = 42;
    const acceptedTopic: TopicDetail = {
      ...topic,
      acceptedAnswerFloor: acceptedFloor,
      id: 'accepted-image-owner',
      replies: [],
      solved: true,
      source: 'xiaoyinsi',
      url: 'https://forum.xiaoyinsi.com/t/topic/accepted-image-owner'
    };
    const acceptedReply: Reply = {
      author: 'accepted-author',
      acceptedAnswer: true,
      contentHtml: `<p>${Array.from(
        { length: 2000 },
        (_, index) => `<img src="https://img.example.com/accepted-${index}.jpg">`
      ).join('')}</p>`,
      createdAt: '2026-08-09T00:00:00.000Z',
      floor: acceptedFloor
    };
    const referenceKey = `xiaoyinsi:${acceptedTopic.id}:${acceptedFloor}`;
    lastFlashListItemTypes = [];
    const view = await render(
      <TopicFilterHarness
        loadedQuotedReplies={{ [referenceKey]: acceptedReply }}
        selectedTopic={acceptedTopic}
        topicDetail={acceptedTopic}
        topicReplies={[]}
      />
    );

    expect(lastFlashListItemTypes.filter((type) => type === 'topicAcceptedAnswer')).toHaveLength(1);
    expect(lastFlashListItemTypes.filter((type) => type === 'topicAcceptedAnswerContent')).toHaveLength(1);
    expect(view.getByLabelText('content-continuation-first')).toBeTruthy();
    expect(view.queryByLabelText('content-continuation-only')).toBeNull();

    await fireEvent.press(view.getByLabelText(`查看完整解决方案，第 ${acceptedFloor} 楼`));
    await waitFor(() =>
      expect(lastFlashListItemTypes.filter((type) => type === 'topicAcceptedAnswerContent')).toHaveLength(500)
    );
    expect(view.getByLabelText('content-continuation-first')).toBeTruthy();
    expect(view.getByLabelText('content-continuation-last')).toBeTruthy();
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
      expect(within(measuredRows[0]).getByLabelText('content-continuation-first')).toBeTruthy();
      expect(within(measuredRows[1]).getByLabelText('content-continuation-middle')).toBeTruthy();
      expect(within(measuredRows[1]).queryByLabelText('content-continuation-last')).toBeNull();

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
      expect(view.getAllByLabelText('content-continuation-middle')).toHaveLength(4);
      expect(view.getAllByLabelText('content-continuation-last')).toHaveLength(1);

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

  it('[REG-PERF-008][REG-PERF-010] never compiles opening content after it reaches the UI', async () => {
    const openingTopic = prepareTopicContent({
      ...topic,
      source: 'linuxdo',
      contentHtml: '<p>opening body</p>',
      polls: []
    });
    mockCompileForumContent.mockClear();
    const view = await render(
      <TopicFilterHarness
        prepareContent={false}
        selectedTopic={openingTopic}
        topicDetail={openingTopic}
        topicReplies={[]}
      />
    );
    expect(mockCompileForumContent).not.toHaveBeenCalled();

    const likedTopic = { ...openingTopic, liked: true };
    await view.rerender(
      <TopicFilterHarness
        prepareContent={false}
        selectedTopic={likedTopic}
        topicDetail={likedTopic}
        topicReplies={[]}
      />
    );
    expect(mockCompileForumContent).not.toHaveBeenCalled();

    const changedBodyTopic = prepareTopicContent({ ...likedTopic, contentHtml: '<p>changed opening body</p>' });
    mockCompileForumContent.mockClear();
    await view.rerender(
      <TopicFilterHarness
        prepareContent={false}
        selectedTopic={changedBodyTopic}
        topicDetail={changedBodyTopic}
        topicReplies={[]}
      />
    );
    expect(mockCompileForumContent).not.toHaveBeenCalled();
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
      expect(view.getByText(/采纳答案正文/)).toBeTruthy();
      expect(view.getByText('查看完整答案 · #2')).toBeTruthy();
      const rendered = JSON.stringify(view.toJSON());
      expect(rendered.indexOf('提问正文')).toBeLessThan(rendered.indexOf('topic-accepted-answer'));
      expect(rendered.indexOf('topic-accepted-answer')).toBeLessThan(rendered.indexOf('回复列表'));

      await fireEvent.press(view.getByLabelText('收起已采纳答案'));
      expect(view.queryByText(/采纳答案正文/)).toBeNull();
      expect(view.getByLabelText('展开已采纳答案')).toBeTruthy();

      await fireEvent.press(view.getByLabelText('展开已采纳答案'));
      await fireEvent.press(view.getByLabelText('查看完整解决方案，第 2 楼'));
      const acceptedReplyIndex = lastReplyListIndex(2);
      expect(acceptedReplyIndex).toBeGreaterThan(-1);
      expect(mockScrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          animated: true,
          index: acceptedReplyIndex
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

      expect(view.getByText(/后分页采纳答案正文/)).toBeTruthy();
      expect(view.getByText('采纳答案引用摘要')).toBeTruthy();
      expect(view.getByText('只读投票')).toBeTruthy();
      expect(view.getByTestId('topic-poll-undefined')).toBeTruthy();
      expect(view.getByText(`查看完整答案 · #${acceptedFloor}`)).toBeTruthy();
      await fireEvent.press(view.getByLabelText(`查看完整解决方案，第 ${acceptedFloor} 楼`));
      expect(view.queryByText(`查看完整答案 · #${acceptedFloor}`)).toBeNull();
      expect(view.getByText(/后分页采纳答案正文/)).toBeTruthy();
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
    await waitFor(() => {
      const acceptedReplyIndex = lastReplyListIndex(2);
      expect(acceptedReplyIndex).toBeGreaterThan(-1);
      expect(mockScrollToIndex).toHaveBeenCalledWith({
        animated: true,
        index: acceptedReplyIndex
      });
    });
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
    const onRefreshWholeTopic = jest.fn();
    const view = await render(
      <TopicFilterHarness
        onRefreshWholeTopic={onRefreshWholeTopic}
        selectedTopic={xiaoyinsiTopic}
        topicDetail={xiaoyinsiTopic}
        topicError={{ kind: 'ordinary', message: 'temporary topic failure', retryable: true }}
      />
    );
    await waitFor(() => expect(mockGetDiscourseSourceEmojiUrls).toHaveBeenCalledTimes(1));

    await fireEvent.press(view.getByText('重试'));

    expect(onRefreshWholeTopic).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockGetDiscourseSourceEmojiUrls).toHaveBeenCalledTimes(2));
  });

  it('shows the cached source emoji catalog in Topic reactions without another request', async () => {
    const linuxDoTopic: TopicDetail = {
      ...topic,
      source: 'linuxdo',
      reactionSummary: [{ id: 'heart', count: 1 }],
      url: 'https://linux.do/t/topic-1'
    };
    const getDiscourseEmojiUrls = jest.fn(async () => ({ heart: 'https://linux.do/network-heart.png' }));
    appQueryClient.setQueryData(forumQueryKeys.emojiUrls('linuxdo'), {
      heart: 'https://linux.do/cached-heart.png'
    });

    const view = await render(
      <TopicFilterHarness
        getDiscourseEmojiUrls={getDiscourseEmojiUrls}
        selectedTopic={linuxDoTopic}
        topicDetail={linuxDoTopic}
      />
    );

    await waitFor(() => {
      expect(view.getByTestId('reaction-heart').props.children).toContain('https://linux.do/cached-heart.png');
    });
    expect(getDiscourseEmojiUrls).not.toHaveBeenCalled();
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
    expect(view.getAllByTestId('topic-html-block-deferred')).toHaveLength(2);
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

  it('[REG-TOPIC-067] confirms the ordered reply boundary immediately after the final window', async () => {
    const onLoadMoreReplies = jest.fn<() => void>();
    const view = await render(<TopicFilterHarness replyHasMore onLoadMoreReplies={onLoadMoreReplies} />);

    await fireEvent.press(view.getByLabelText('加载更多回复'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);

    await view.rerender(<TopicFilterHarness onLoadMoreReplies={onLoadMoreReplies} />);
    expect(view.queryByLabelText('加载更多回复')).toBeNull();
    const replyEndMarker = view.getByLabelText('已到最新回复');
    expect(replyEndMarker.type).toBe('Text');
    expect(replyEndMarker.props.children).toBe('已到最新回复');
    const decorativeViews = React.Children.toArray(replyEndMarker.props.children).filter(
      (child) => React.isValidElement(child) && child.type === View
    );
    expect(view.getByText('已到最新回复')).toBeTruthy();
    expect(decorativeViews).toHaveLength(0);
    expect(view.getByTestId('terminal-reply')).toBeTruthy();
    await act(async () => {
      lastFlashListProps.onScrollBeginDrag();
      lastFlashListProps.onEndReached();
    });
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText('回复排序，当前正序'));
    await fireEvent.press(view.getByLabelText('倒序'));
    expect(view.getByText('已到最早回复')).toBeTruthy();
  });

  it('[REG-TOPIC-076][REG-TOPIC-077] shows a partial V2EX prefix as a settled visible result', async () => {
    const partialTopic: TopicDetail = {
      ...topic,
      replyCount: 106,
      replies: sourceReplies,
      replyCompleteness: 'partial',
      replyHasMore: true,
      replyNextPage: null
    };
    const view = await render(
      <TopicFilterHarness
        replyCollectionComplete={false}
        replyRowsPartial
        selectedTopic={partialTopic}
        topicDetail={partialTopic}
      />
    );

    expect(view.getByText('部分评论未能读取，已显示 3 条')).toBeTruthy();
    expect(view.getByText('3 条')).toBeTruthy();
    expect(view.queryByText(/评论正在同步/)).toBeNull();
    expect(view.getByLabelText('评论内查找')).toBeTruthy();
    expect(view.getByLabelText('只看楼主')).toBeTruthy();
    expect(view.queryByLabelText('回复排序，当前正序')).toBeNull();
    expect(view.queryByLabelText('已到最新回复')).toBeNull();

    const unknownCountTopic = { ...partialTopic, replyCount: undefined };
    await view.rerender(
      <TopicFilterHarness
        replyCollectionComplete={false}
        replyRowsPartial
        selectedTopic={unknownCountTopic}
        topicDetail={unknownCountTopic}
      />
    );
    expect(view.getByText('部分评论未能读取，已显示 3 条')).toBeTruthy();

    await view.rerender(
      <TopicFilterHarness
        replyCollectionComplete={false}
        replyRowsPartial
        repliesError={{ kind: 'ordinary', message: '回复总数仍未同步', retryable: true }}
        selectedTopic={partialTopic}
        topicDetail={partialTopic}
      />
    );
    expect(view.getAllByText(/^reply-/)).toHaveLength(3);
    expect(view.getByText('回复总数仍未同步')).toBeTruthy();
    expect(view.getByText('重试评论')).toBeTruthy();
    expect(view.queryByLabelText('回复排序，当前正序')).toBeNull();
    expect(view.queryByLabelText('已到最新回复')).toBeNull();
  });

  it('[REG-TOPIC-077] shows a non-V2EX partial hint without hiding server reply order', async () => {
    const partialTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-1-1',
      replyCount: 106,
      replies: sourceReplies,
      replyCompleteness: 'partial',
      replyHasMore: false,
      replyNextPage: null
    };
    const view = await render(
      <TopicFilterHarness
        replyRowsPartial
        selectedTopic={partialTopic}
        topicDetail={partialTopic}
        topicReplies={sourceReplies}
      />
    );

    expect(view.getByText('部分评论未能读取，已显示 3 条')).toBeTruthy();
    expect(view.getByText('3 条')).toBeTruthy();
    expect(view.getByLabelText('回复排序，当前正序')).toBeTruthy();
    expect(view.queryByLabelText('已到最新回复')).toBeNull();
  });

  it('[REG-TOPIC-076] waits to scroll to a V2EX floor outside the prefix until the full collection arrives', async () => {
    const prefix = sourceReplies.slice(0, 1);
    const syncingTopic: TopicDetail = {
      ...topic,
      replies: prefix,
      replyHasMore: true,
      replyNextPage: null
    };
    mockScrollToIndex.mockClear();
    const view = await render(
      <TopicFilterHarness
        replyCollectionComplete={false}
        replyRowsPartial
        selectedTopic={syncingTopic}
        targetReply={{ floor: 2 }}
        topicDetail={syncingTopic}
        topicReplies={prefix}
      />
    );

    expect(mockScrollToIndex).not.toHaveBeenCalled();

    const completeTopic = { ...syncingTopic, replies: sourceReplies, replyHasMore: false };
    await view.rerender(
      <TopicFilterHarness
        selectedTopic={completeTopic}
        targetReply={{ floor: 2 }}
        topicDetail={completeTopic}
        topicReplies={sourceReplies}
      />
    );

    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledTimes(1));
    expect(mockScrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ animated: true, viewPosition: 0.2 }));
  });

  it('[REG-TOPIC-067] scales the reply order control, menu and boundary with reader text size', async () => {
    const settings = { ...readerData.settings, fontScale: 1.3 };
    const value = { settings, theme: createTheme(settings) };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ReaderStyleProvider value={value}>{children}</ReaderStyleProvider>
    );
    const view = await render(<TopicFilterHarness />, { wrapper });

    const orderButton = view.getByLabelText('回复排序，当前正序');
    const orderButtonStyle = StyleSheet.flatten(orderButton.props.style);
    expect(
      orderButtonStyle.minHeight + orderButton.props.hitSlop.top + orderButton.props.hitSlop.bottom
    ).toBeGreaterThanOrEqual(48);
    expect(StyleSheet.flatten(view.getByText('正序').props.style).fontSize).toBe(16);
    expect(StyleSheet.flatten(view.getByLabelText('已到最新回复').props.style).fontSize).toBe(16);

    await fireEvent.press(view.getByLabelText('回复排序，当前正序'));
    const menuText = within(view.getByLabelText('正序')).getByText('正序');
    expect(StyleSheet.flatten(menuText.props.style)).toEqual(expect.objectContaining({ fontSize: 17, lineHeight: 23 }));
  });

  it('[REG-TOPIC-062] maps both window edges without double-loading a gesture', async () => {
    const onLoadMoreReplies = jest.fn();
    const onLoadPreviousReplies = jest.fn();
    const view = await render(
      <TopicFilterHarness
        replyHasMore
        replyHasPrevious
        onLoadMoreReplies={onLoadMoreReplies}
        onLoadPreviousReplies={onLoadPreviousReplies}
      />
    );

    expect(lastFlashListItemTypes).toContain('replyWindowStart');
    expect(lastFlashListProps.maintainVisibleContentPosition).toEqual({ disabled: false });
    const startItem = (lastFlashListProps.data as { type: string }[]).find((item) => item.type === 'replyWindowStart');
    await act(async () => {
      lastFlashListProps.onViewableItemsChanged({ viewableItems: [{ isViewable: true, item: startItem }] });
      lastFlashListProps.onScrollBeginDrag();
      lastFlashListProps.onEndReached();
    });
    expect(onLoadPreviousReplies).toHaveBeenCalledTimes(1);
    expect(onLoadMoreReplies).not.toHaveBeenCalled();

    await act(async () => {
      lastFlashListProps.onViewableItemsChanged({ viewableItems: [] });
      lastFlashListProps.onScrollBeginDrag();
      lastFlashListProps.onEndReached();
    });
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('加载更早回复')).toBeTruthy();
  });

  it('[REG-TOPIC-067] labels the previous newest window as newer replies', async () => {
    const view = await render(<TopicFilterHarness replyHasPrevious />);

    await fireEvent.press(view.getByLabelText('回复排序，当前正序'));
    await fireEvent.press(view.getByLabelText('倒序'));

    expect(view.getByLabelText('加载更新回复')).toBeTruthy();
    expect(view.queryByLabelText('加载更早回复')).toBeNull();
  });

  it('[REG-TOPIC-063] prefetches the previous window before its retry button becomes visible', async () => {
    const onLoadPreviousReplies = jest.fn();
    const replyForFloor = (floor: number): Reply => ({
      author: `author-${floor}`,
      contentHtml: `<p>reply-${floor}</p>`,
      createdAt: `2026-08-05T00:00:${String(floor).padStart(2, '0')}.000Z`,
      floor
    });
    const windowReplies = Array.from({ length: 10 }, (_, index) => replyForFloor(index + 11));
    const view = await render(
      <TopicFilterHarness onLoadPreviousReplies={onLoadPreviousReplies} replyHasPrevious topicReplies={windowReplies} />
    );

    const data = lastFlashListProps.data as { type: string; reply?: Reply }[];
    const visibleReplies = data.filter(
      (item) => item.type === 'reply' && item.reply?.floor && item.reply.floor >= 14 && item.reply.floor <= 16
    );
    const windowStart = data.find((item) => item.type === 'replyWindowStart');
    expect(visibleReplies).toHaveLength(3);
    expect(windowStart).toBeDefined();
    expect(visibleReplies).not.toContain(windowStart);

    await act(async () => {
      lastFlashListProps.onScrollBeginDrag();
      lastFlashListProps.onViewableItemsChanged({
        viewableItems: visibleReplies.map((item) => ({ isViewable: true, item }))
      });
      lastFlashListProps.onViewableItemsChanged({
        viewableItems: visibleReplies.map((item) => ({ isViewable: true, item }))
      });
    });

    expect(onLoadPreviousReplies).toHaveBeenCalledTimes(1);

    await view.rerender(
      <TopicFilterHarness
        onLoadPreviousReplies={onLoadPreviousReplies}
        replyHasPrevious
        topicReplies={Array.from({ length: 15 }, (_, index) => replyForFloor(index + 6))}
      />
    );
    await act(async () => {
      lastFlashListProps.onScrollBeginDrag();
    });
    expect(onLoadPreviousReplies).toHaveBeenCalledTimes(1);

    const prependedData = lastFlashListProps.data as { type: string; reply?: Reply }[];
    const nextVisibleReplies = prependedData.filter(
      (item) => item.type === 'reply' && item.reply?.floor && item.reply.floor >= 9 && item.reply.floor <= 11
    );
    await act(async () => {
      lastFlashListProps.onViewableItemsChanged({
        viewableItems: nextVisibleReplies.map((item) => ({ isViewable: true, item }))
      });
      lastFlashListProps.onViewableItemsChanged({
        viewableItems: nextVisibleReplies.map((item) => ({ isViewable: true, item }))
      });
    });
    expect(onLoadPreviousReplies).toHaveBeenCalledTimes(2);
  });

  it('[REG-TOPIC-063] keeps position maintenance enabled for the final previous-window prepend', async () => {
    const earlierReply: Reply = {
      author: 'earlier',
      commentId: 999,
      contentHtml: '<p>earlier</p>',
      createdAt: '2026-08-05T00:00:00.000Z',
      floor: 0
    };
    const view = await render(<TopicFilterHarness replyHasPrevious />);

    expect(lastFlashListProps.maintainVisibleContentPosition).toEqual({ disabled: false });
    await view.rerender(<TopicFilterHarness topicReplies={[earlierReply, ...sourceReplies]} />);
    expect(lastFlashListProps.maintainVisibleContentPosition).toEqual({ disabled: false });

    await view.rerender(<TopicFilterHarness topicReplies={[earlierReply, ...sourceReplies]} />);
    expect(lastFlashListProps.maintainVisibleContentPosition).toEqual({ disabled: true });
  });

  it('toggles the local favorite for the current topic and reflects the updated state', async () => {
    const onToggleFavorite = jest.fn<() => void>();
    const view = await render(<TopicFilterHarness onToggleFavorite={onToggleFavorite} />);

    await fireEvent.press(view.getByLabelText('收藏'));
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);

    await view.rerender(<TopicFilterHarness topicFavorite onToggleFavorite={onToggleFavorite} />);
    expect(view.getByLabelText('已收藏')).toBeTruthy();
  });

  it('REG-WRITE-003 exposes the confirmed yaohuo favorite as a selected cancel action', async () => {
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

  it('[REG-TOPIC-063] exposes independent reply ordering without reversing the rendered array locally', async () => {
    const view = await render(<TopicFilterHarness />);

    expect(view.getByLabelText('回复排序，当前正序')).toBeTruthy();
    expect(view.queryByLabelText('倒序')).toBeNull();
    await fireEvent.press(view.getByLabelText('回复排序，当前正序'));
    expect(view.getByLabelText('正序').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(view.getByLabelText('倒序'));
    expect(view.getByTestId('active-order').props.children).toBe('newest');
    expect(view.getByLabelText('回复排序，当前倒序')).toBeTruthy();
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual([
      'reply-1-alice',
      'reply-2-bob',
      'reply-3-alice'
    ]);
  });

  it('[REG-TOPIC-067] shows newest-tail loading and a reply-level retry without stale replies', async () => {
    const onRetryReplies = jest.fn();
    const view = await render(<TopicFilterHarness onRetryReplies={onRetryReplies} repliesLoading topicReplies={[]} />);

    await fireEvent.press(view.getByLabelText('回复排序，当前正序'));
    await fireEvent.press(view.getByLabelText('倒序'));
    expect(view.getByText('正在读取最新回复...')).toBeTruthy();
    expect(view.queryAllByText(/^reply-/)).toHaveLength(0);

    await view.rerender(
      <TopicFilterHarness
        onRetryReplies={onRetryReplies}
        repliesError={{ kind: 'ordinary', message: '无法确认最新回复窗口', retryable: true }}
        topicReplies={[]}
      />
    );
    expect(view.getByText('无法确认最新回复窗口')).toBeTruthy();
    await fireEvent.press(view.getByText('重试评论'));
    expect(onRetryReplies).toHaveBeenCalledTimes(1);
  });

  it('[REG-TOPIC-067] keeps a full-window refresh error visible above trusted replies', async () => {
    const onRetryReplies = jest.fn();
    const view = await render(
      <TopicFilterHarness
        onRetryReplies={onRetryReplies}
        repliesError={{ kind: 'ordinary', message: '回复总数已变化，请重试', retryable: true }}
      />
    );

    expect(view.getAllByText(/^reply-/)).toHaveLength(3);
    expect(view.getByText('回复总数已变化，请重试')).toBeTruthy();
    await fireEvent.press(view.getByText('重试评论'));
    expect(onRetryReplies).toHaveBeenLastCalledWith(undefined);

    await view.rerender(
      <TopicFilterHarness repliesError={{ kind: 'ordinary', message: '回复总数仍不一致', retryable: false }} />
    );
    expect(view.getByText('回复总数仍不一致')).toBeTruthy();
    expect(view.queryByText('重试评论')).toBeNull();
  });

  it('[REG-TOPIC-067] keeps an adjacent-window failure visible at its exact retry edge', async () => {
    const onLoadMoreReplies = jest.fn();
    const onLoadPreviousReplies = jest.fn();
    const onRetryReplies = jest.fn();
    const startError = { kind: 'ordinary' as const, message: '无法确认更早回复窗口', retryable: true };
    const endError = { kind: 'ordinary' as const, message: '无法确认更多回复窗口', retryable: true };
    const view = await render(
      <TopicFilterHarness
        onLoadMoreReplies={onLoadMoreReplies}
        onLoadPreviousReplies={onLoadPreviousReplies}
        onRetryReplies={onRetryReplies}
        replyHasMore
        replyHasPrevious
        replyStartError={startError}
      />
    );

    expect(view.getByText('无法确认更早回复窗口')).toBeTruthy();
    expect(view.queryByLabelText('加载更早回复')).toBeNull();
    const startItem = (lastFlashListProps.data as { type: string }[]).find((item) => item.type === 'replyWindowStart');
    await act(async () => {
      lastFlashListProps.onScrollBeginDrag();
      lastFlashListProps.onViewableItemsChanged({ viewableItems: [{ isViewable: true, item: startItem }] });
    });
    expect(onLoadPreviousReplies).not.toHaveBeenCalled();
    await act(async () => {
      lastFlashListProps.onScrollBeginDrag();
      lastFlashListProps.onEndReached();
    });
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByText('重试评论'));
    expect(onRetryReplies).toHaveBeenLastCalledWith('start');

    await view.rerender(
      <TopicFilterHarness
        onLoadMoreReplies={onLoadMoreReplies}
        onLoadPreviousReplies={onLoadPreviousReplies}
        onRetryReplies={onRetryReplies}
        replyEndError={endError}
        replyHasMore
        replyHasPrevious
      />
    );
    expect(view.getByText('无法确认更多回复窗口')).toBeTruthy();
    expect(view.queryByLabelText('加载更多回复')).toBeNull();
    await act(async () => {
      lastFlashListProps.onViewableItemsChanged({ viewableItems: [] });
      lastFlashListProps.onScrollBeginDrag();
      lastFlashListProps.onEndReached();
    });
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByText('重试评论'));
    expect(onRetryReplies).toHaveBeenLastCalledWith('end');

    await view.rerender(
      <TopicFilterHarness
        onRetryReplies={onRetryReplies}
        replyEndError={endError}
        replyHasMore
        replyHasPrevious
        replyStartError={startError}
      />
    );
    expect(view.getAllByText('重试评论')).toHaveLength(2);
  });

  it('[REG-TOPIC-067][REG-WRITE-017] keeps independent root and edge failures reachable when their text matches', async () => {
    const onRetryReplies = jest.fn();
    const error = { kind: 'ordinary' as const, message: 'offline', retryable: true };
    const view = await render(
      <TopicFilterHarness onRetryReplies={onRetryReplies} repliesError={error} replyEndError={error} replyHasMore />
    );

    expect(view.getAllByText('offline')).toHaveLength(2);
    const retries = view.getAllByText('重试评论');
    await fireEvent.press(retries[0]);
    await fireEvent.press(retries[1]);
    expect(onRetryReplies.mock.calls).toEqual([[undefined], ['end']]);
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
    await fireEvent.press(view.getByLabelText('回复排序，当前正序'));
    await fireEvent.press(view.getByLabelText('倒序'));
    expect(view.getByLabelText('只看楼主，已选择')).toBeTruthy();
    expect(view.getByLabelText('回复排序，当前倒序')).toBeTruthy();
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual(['reply-1-alice', 'reply-3-alice']);
    expect(view.getByText('2 条')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('只看带图'));
    expect(view.getByLabelText('只看带图，已选择')).toBeTruthy();
    expect(view.getByText('reply-2-bob')).toBeTruthy();
    expect(view.getByText('1 条')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('全部'));
    await fireEvent.changeText(view.getByLabelText('评论内查找'), 'needle');
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual(['reply-2-bob', 'reply-3-alice']);
    expect(view.getByText('2 条')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('清空查找'));
    expect(view.getByText('3 条')).toBeTruthy();
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
