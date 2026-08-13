import { createTopicStyles, type TopicStyles } from '../styles';
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { RenderHTMLConfigProvider, TRenderEngineProvider, type CustomBlockRenderer } from 'react-native-render-html';
import { BookMarked, ChevronDown, Drumstick, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import type {
  Reply,
  ReplyLocationTarget,
  ReplyOrder,
  SourceErrorInfo,
  Topic,
  TopicDetail,
  TopicPoll,
  UserReference
} from '@/domain/forum/models';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { HtmlRenderers } from '../rendering/types';
import type { ReplyFilter } from '../model/types';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '@/domain/forum/presentation';
import { contentBoundaryForContinuation, HTML_ALLOWED_INLINE_STYLES } from '../rendering/htmlStyles';
import { NODESEEK_POLL_PLACEHOLDER_TAG } from '@/sources/nodeseek/polls';
import {
  androidRipple,
  replyContextBadgeStyle,
  sourceBadgeColorStyle,
  topicStatusBadgeColorStyle,
  topicStatusBadgeTextColorStyle,
  topicTagColorStyle,
  topicTagTextColorStyle,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOUCH_HIT_SLOP } from '@/ui/controls/pressFeedback';
import { Avatar } from '@/ui/avatar/Avatar';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { topicWithAuthorFallback, userFromTopic } from '@/domain/forum/userNavigation';
import type { InteractionType } from '@/domain/forum/topicActionState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { discourseReactionStats, type DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { linuxDoReactionStats } from '@/sources/linuxdo/reactions';
import { quotedPostReferenceKey, topicOpeningPostAsReply } from '@/domain/forum/quotedPosts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { TopicPolls } from './TopicPolls';
import { AcceptedAnswerPreview } from './AcceptedAnswerPreview';
import { DetailActionButton } from './TopicActionBar';
import { TopicBodyQuoteCard } from './TopicBodyQuoteCard';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { DiscourseReactionPill, MemoizedReplyItem, NodeSeekStatPill, nodeSeekTopicReactionStats } from './ReplyItem';
import { topicStatusBadges } from '../model/topicHeaderModel';
import type { TopicActionsController } from '../actions/useTopicActionsController';
import { markCurrentNodeSeekOwnRepliesUnlikable } from '../actions/actionHelpers';
import type { useHtmlRenderingController } from '../rendering/useHtmlRenderingController';
import { filterTopicSessionReplies, type TopicSessionController } from '../useTopicSessionController';
import type { useTopicController } from '../useTopicController';
import {
  buildAcceptedAnswerContentItems,
  buildAcceptedAnswerPresentation,
  buildTopicOpeningContent,
  buildTopicQuotedPostContentItems,
  type TopicContentItem
} from '../model/topicOpeningPresentation';
import {
  buildReplyListItems,
  buildVirtualizedReplyItems,
  getReplyKey,
  topicListItemSpacing,
  type TopicReplyListItem
} from '../model/replyListModel';
import {
  topicListItemKey,
  topicListItemType,
  topicListMediaPlanStats,
  type TopicListItem
} from '../model/topicListModel';
import { highlightHtml } from '@/ui/text/highlight';
import { HTML_CUSTOM_ELEMENT_MODELS } from '../rendering/htmlElementModels';
import {
  TopicBodyMediaCoordinatorProvider,
  useTopicBodyMediaFirstRowMarker,
  TopicBodyMediaRowBoundary,
  type TopicBodyMediaAggregate
} from '../media/TopicBodyMediaCoordinator';
import { ManagedTopicContentVideo } from '../media/ManagedTopicContentVideo';
import { diagnosticRef } from '@/platform/diagnostics/diagnosticPolicy';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  topicSemanticRowVisible,
  useTopicSplitDisclosureStore
} from '../rendering/TopicSplitDisclosure';
import { useContentBoundarySpacing } from '../rendering/TopicContentPresentation';
import { resolveForumContentRowHtml, type CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { createTopicTableRenderers, TopicTableScrollProvider } from '../rendering/topicTableRenderers';

const EMPTY_QUOTE_CONTENT_TOKENS = new Map<string, string>();
const EMPTY_NEARBY_TOPIC_CONTENT_KEYS: ReadonlySet<string> = new Set();

const CONTENT_ROW_TRIM_LEADING: ViewStyle = {
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderTopWidth: 0,
  marginTop: 0,
  paddingTop: 0
};

const CONTENT_ROW_TRIM_TRAILING: ViewStyle = {
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  borderBottomWidth: 0,
  marginBottom: 0,
  paddingBottom: 0
};

function topicListCompiledRow(item: TopicListItem): CompiledForumContentRow | null {
  if (item.type === 'topicContent' || item.type === 'topicQuoteContent' || item.type === 'topicAcceptedAnswerContent') {
    return item.content.type === 'accessNotice' ? null : item.content.row;
  }
  if (item.type === 'topicQuoteSummary') return item.content.row;
  if (item.type === 'replyContent' || item.type === 'replyQuoteContent') return item.content;
  if (item.type === 'replySignatureContent') return item.content;
  return null;
}

function topicListContentScope(item: TopicListItem) {
  if (item.type === 'topicQuoteContent') return `topic-quote:${item.instanceKey}`;
  if (item.type === 'topicAcceptedAnswerContent') return 'accepted-answer';
  if (item.type === 'topicContent' || item.type === 'topicQuoteSummary') return 'opening';
  if (item.type === 'replyQuoteContent') return `reply-quote:${item.instanceKey}`;
  if (item.type === 'replyContent') return `reply:${getReplyKey(item.reply)}:body`;
  if (item.type === 'replySignatureContent') return `reply:${getReplyKey(item.reply)}:signature`;
  return '';
}

function continuesSameLogicalContentGroup(leadingItem: TopicListItem, trailingItem: TopicListItem) {
  if (topicListContentScope(leadingItem) !== topicListContentScope(trailingItem)) return false;
  const leadingRow = topicListCompiledRow(leadingItem);
  const trailingRow = topicListCompiledRow(trailingItem);
  if (!leadingRow || !trailingRow) return false;
  const terminalReportId = (row: CompiledForumContentRow) =>
    row.type === 'terminalReportHeader'
      ? row.semanticId
      : row.ancestorFrames.find((frame) => frame.kind === 'terminalTab')?.reportSemanticId;
  const leadingReportId = terminalReportId(leadingRow);
  if (leadingReportId && leadingReportId === terminalReportId(trailingRow)) return true;
  const trailingParts = new Map([
    [trailingRow.semanticId, trailingRow.part],
    ...trailingRow.ancestorFrames.map((frame) => [frame.semanticId, frame.part] as const)
  ]);
  return [
    [leadingRow.semanticId, leadingRow.part] as const,
    ...leadingRow.ancestorFrames.map((frame) => [frame.semanticId, frame.part] as const)
  ].some(([semanticId, part]) => {
    const trailingPart = trailingParts.get(semanticId);
    return (
      trailingPart !== undefined &&
      contentBoundaryForContinuation(part).trimTrailing &&
      contentBoundaryForContinuation(trailingPart).trimLeading
    );
  });
}

function rowPresentationPart(row: CompiledForumContentRow) {
  return row.ancestorFrames[0]?.part || row.part;
}

type QuoteContentLayoutProgress = {
  contentToken: string;
  frame: number | null;
  primed: boolean;
};

function monotonicNowMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function TopicListItemFrame({
  children,
  firstRowStartedAt,
  onLayout,
  style
}: {
  children: ReactNode;
  firstRowStartedAt?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  style: ViewStyle;
}) {
  const markFirstRow = useTopicBodyMediaFirstRowMarker();
  const markedRef = useRef(false);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLayout?.(event);
      if (firstRowStartedAt === undefined || markedRef.current) return;
      markedRef.current = true;
      markFirstRow(monotonicNowMs() - firstRowStartedAt);
    },
    [firstRowStartedAt, markFirstRow, onLayout]
  );
  return (
    <View style={style} onLayout={handleLayout}>
      {children}
    </View>
  );
}

function YaohuoFavoriteButton({
  actionBusy,
  bookmarked,
  onPress,
  styles,
  theme
}: {
  actionBusy: boolean;
  bookmarked?: boolean;
  onPress: () => void;
  styles: TopicStyles;
  theme: ReaderTheme;
}) {
  const stateKnown = bookmarked !== undefined;
  return (
    <DetailActionButton
      active={bookmarked === true}
      tone="favorite"
      accessibilityLabel={stateKnown ? (bookmarked ? '取消原站收藏' : '原站收藏') : '原站收藏状态未加载'}
      icon={BookMarked}
      label={stateKnown ? '收藏' : '状态未知'}
      styles={styles}
      theme={theme}
      disabled={actionBusy || !stateKnown}
      onPress={onPress}
    />
  );
}

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'noscript'];
const ContentBoundarySpacingRenderer: CustomBlockRenderer = ({ InternalRenderer, ...props }) => {
  const boundarySpacing = useContentBoundarySpacing(props.tnode);
  return <InternalRenderer {...props} style={boundarySpacing ? { ...props.style, ...boundarySpacing } : props.style} />;
};

export const TopicContentList = memo(function TopicContentList({
  active = true,
  actions,
  article,
  bodyMediaPaused = false,
  currentNodeSeekUser,
  discourseEmojiUrls,
  headerState,
  html,
  nodeSeekUserId,
  onOpenTopic,
  onOpenUser,
  onScroll: onTopicScroll,
  read,
  session,
  targetReply,
  targetReplyRequestId,
  topicScrollRef
}: {
  active?: boolean;
  actions: TopicActionsController;
  article: {
    busy: boolean;
    error: SourceErrorInfo | null;
    topic: TopicDetail | null;
    yaohuoBookmarked?: boolean;
  };
  bodyMediaPaused?: boolean;
  currentNodeSeekUser: SiteSessionViewModels['nodeseek']['currentUser'];
  discourseEmojiUrls: DiscourseEmojiUrlMap;
  headerState: ReactNode;
  html: ReturnType<typeof useHtmlRenderingController> & { contentWidth: number; mediaSessionIdentity: string };
  nodeSeekUserId: number | null;
  onOpenTopic: (topic: Topic, targetReply?: ReplyLocationTarget) => void;
  onOpenUser: (user: UserReference) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  read: ReturnType<typeof useTopicController>;
  session: TopicSessionController;
  targetReply?: ReplyLocationTarget;
  targetReplyRequestId?: number;
  topicScrollRef: RefObject<FlashListRef<TopicListItem> | null>;
}) {
  const { state, commands } = session;
  const { actionBusy, decisionFor, deleteReply: onDeleteReply, editReply: onEditReply } = actions;
  const { busy: topicBusy, error: topicError, topic, yaohuoBookmarked } = article;
  const {
    contentWidth,
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    inlineSizedImageUrls,
    mediaContext,
    mediaSessionIdentity,
    nodeSeekMediaUserAgent,
    topicImageDeriver
  } = html;
  const filteredReplies = useMemo(
    () =>
      filterTopicSessionReplies({
        commentQuery: state.debouncedCommentQuery,
        inlineSizedImageUrls,
        replyFilter: state.replyFilter,
        topicDetail: topic,
        topicImageDeriver,
        topicReplies: read.topicReplies
      }),
    [inlineSizedImageUrls, read.topicReplies, state.debouncedCommentQuery, state.replyFilter, topic, topicImageDeriver]
  );
  const replies = useMemo(
    () => markCurrentNodeSeekOwnRepliesUnlikable(filteredReplies, currentNodeSeekUser, nodeSeekUserId),
    [currentNodeSeekUser, filteredReplies, nodeSeekUserId]
  );
  const selectedTopic = state.selectedTopic;
  const commentQuery = state.commentQuery;
  const expandedQuotes = state.expandedQuotes;
  const replyHighlightQuery = state.debouncedCommentQuery;
  const quoteStateVersion = state.quoteStateVersion;
  const replyComposerOpen = state.replyComposerOpen;
  const replyFilter = state.replyFilter;
  const replyOrder = state.replyOrder;
  const sourceReplies = read.topicReplies;
  const replyHasPrevious = read.replyHasPrevious;
  const replyHasMore = read.replyHasMore;
  const previousWindowWasAvailableRef = useRef(replyHasPrevious);
  const maintainPreviousWindowPosition = replyHasPrevious || previousWindowWasAvailableRef.current;
  const loadedQuotedReplies = read.loadedQuotedReplies;
  const loadingMoreReplies = read.loadingMoreReplies;
  const loadingPreviousReplies = read.loadingPreviousReplies;
  const loadingQuotedFloors = read.loadingQuotedFloors;
  const replyStartError = read.replyStartError;
  const replyEndError = read.replyEndError;
  const replyCollectionComplete = read.replyCollectionComplete;
  const replyRowsPartial = read.replyRowsPartial;
  const repliesError = read.repliesError;
  const repliesLoading = read.repliesLoading;
  const retryReplies = read.retryReplies;
  const unreadReplyCount = read.unreadReplyCount;
  const onCommentQueryChange = commands.view.changeCommentQuery;
  const onReplyFilterChange = commands.view.changeReplyFilter;
  const onReplyOrderChange = commands.view.changeReplyOrder;
  const onLoadMoreReplies = read.loadMoreReplies;
  const onLoadPreviousReplies = read.loadPreviousReplies;
  const onLocateReply = read.locateReply;
  const onReplyComposerOpenChange = commands.composer.toggle;
  const onReplyToFloor = commands.composer.replyToFloor;
  const onToggleReplyQuote = read.toggleReplyQuote;
  const onToggleTopicBodyQuote = read.toggleTopicBodyQuote;
  const onDiscourseBookmark = actions.bookmarkOnDiscourseSite;
  const onNodeSeekCollection = actions.collectOnNodeSeekSite;
  const onYaohuoFavorite = actions.favoriteOnYaohuoSite;
  const onInteract = actions.interact;
  const onVotePoll = actions.votePoll;
  const pendingReplyOrderScrollRef = useRef(false);
  const changeReplyOrder = useCallback(
    (order: ReplyOrder) => {
      if (order === replyOrder) return;
      pendingReplyOrderScrollRef.current = true;
      onReplyOrderChange(order);
    },
    [onReplyOrderChange, replyOrder]
  );
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const replyOrderMenuTriggerRef = useRef<View>(null);
  const [replyOrderMenuOpen, setReplyOrderMenuOpen] = useState(false);
  const [replyOrderMenuPlacement, setReplyOrderMenuPlacement] = useState<ViewStyle>({
    position: 'absolute',
    right: 12,
    top: 12,
    minWidth: 104
  });
  const replyOrderLabel = replyOrder === 'newest' ? '倒序' : '正序';
  const openReplyOrderMenu = useCallback(() => {
    const trigger = replyOrderMenuTriggerRef.current;
    setReplyOrderMenuOpen(true);
    trigger?.measureInWindow((x, y, width, height) => {
      const margin = 8;
      const opensAbove = y + height / 2 > windowHeight / 2;
      setReplyOrderMenuPlacement({
        position: 'absolute',
        right: Math.max(margin, windowWidth - x - width),
        ...(opensAbove ? { bottom: Math.max(margin, windowHeight - y + 4) } : { top: y + height + 4 }),
        minWidth: 104
      });
    });
  }, [windowHeight, windowWidth]);
  const closeReplyOrderMenu = useCallback(() => setReplyOrderMenuOpen(false), []);
  const selectReplyOrder = useCallback(
    (order: ReplyOrder) => {
      setReplyOrderMenuOpen(false);
      changeReplyOrder(order);
    },
    [changeReplyOrder]
  );
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const topicLoading = topicBusy || (!topic && !topicError);
  const canShowReplies = Boolean(topic && !topicLoading);
  const detailTopicStateKey = topic ? `${topic.source}:${topic.id}` : item ? `${item.source}:${item.id}` : '';
  const topicResponseReadyRef = useRef<{ readyAt?: number; topicKey: string }>({ topicKey: '' });
  const topicResponseReadyCandidate =
    topic &&
    topicResponseReadyRef.current.topicKey === detailTopicStateKey &&
    topicResponseReadyRef.current.readyAt !== undefined
      ? topicResponseReadyRef.current.readyAt
      : topic
        ? monotonicNowMs()
        : undefined;
  useLayoutEffect(() => {
    if (!topic || topicResponseReadyCandidate === undefined) {
      topicResponseReadyRef.current = { topicKey: detailTopicStateKey };
      return;
    }
    if (
      topicResponseReadyRef.current.topicKey !== detailTopicStateKey ||
      topicResponseReadyRef.current.readyAt === undefined
    ) {
      topicResponseReadyRef.current = {
        readyAt: topicResponseReadyCandidate,
        topicKey: detailTopicStateKey
      };
    }
  }, [detailTopicStateKey, topic, topicResponseReadyCandidate]);
  const interactionDecision = (interaction: InteractionType) =>
    decisionFor({ action: 'like', interaction, target: topic || undefined });
  const upvoteDecision = interactionDecision('upvote');
  const likeDecision = interactionDecision('like');
  const dislikeDecision = interactionDecision('dislike');
  const canWriteNodeSeek = Boolean(
    topic &&
    topic.source === 'nodeseek' &&
    [upvoteDecision, likeDecision, dislikeDecision].some(
      (decision) => decision.allowed || decision.reason === 'already-complete' || decision.reason === 'pending'
    )
  );
  const bookmarkDecision = decisionFor({ action: 'bookmark' });
  const canWriteYaohuo = Boolean(
    topic && topic.source === 'yaohuo' && (bookmarkDecision.allowed || bookmarkDecision.reason === 'pending')
  );
  const canUseDiscourseInteractions = Boolean(
    topic && isDiscourseSource(topic.source) && (likeDecision.allowed || likeDecision.reason === 'pending')
  );
  const canWrite = decisionFor({ action: 'reply' }).allowed;
  const replyTotalCount = item ? item.replyCount : replies.length;
  const replyDisplayCount =
    replyFilter === 'author' || replyFilter === 'images' || replyHighlightQuery.trim()
      ? replies.length
      : !replyRowsPartial
        ? replyTotalCount
        : sourceReplies.length;
  const repliesPartialStatus =
    replyRowsPartial && sourceReplies.length > 0 ? `部分评论未能读取，已显示 ${sourceReplies.length} 条` : '';
  const renderReplyErrorState = useCallback(
    (error: SourceErrorInfo | null, edge?: 'start' | 'end') =>
      error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error.message}</Text>
          {error.retryable === false ? null : <AppButton label="重试评论" onPress={() => void retryReplies(edge)} />}
        </View>
      ) : null,
    [retryReplies, styles]
  );
  const listExtraData = useMemo(
    () => ({
      actionBusy,
      quoteStateVersion,
      replyComposerOpen,
      replyCollectionComplete,
      replyEndError,
      replyOrder,
      replyOrderMenuOpen,
      replyStartError,
      repliesError,
      repliesLoading
    }),
    [
      actionBusy,
      quoteStateVersion,
      replyCollectionComplete,
      repliesError,
      repliesLoading,
      replyComposerOpen,
      replyEndError,
      replyOrder,
      replyOrderMenuOpen,
      replyStartError
    ]
  );
  const itemSource = topic?.source;
  const topicBaseUrl = topic?.url || item?.url;
  const [nearbyTopicContent, setNearbyTopicContent] = useState<{
    keys: ReadonlySet<string>;
    topicKey: string;
  }>({ keys: new Set(), topicKey: '' });
  const nearbyTopicContentKeys =
    nearbyTopicContent.topicKey === detailTopicStateKey ? nearbyTopicContent.keys : EMPTY_NEARBY_TOPIC_CONTENT_KEYS;
  const addNearbyTopicContentKeys = useCallback(
    (keys: string[]) => {
      if (!detailTopicStateKey || !keys.length) {
        return;
      }
      setNearbyTopicContent((current) => {
        const currentKeys = current.topicKey === detailTopicStateKey ? current.keys : new Set<string>();
        const additions = keys.filter((key) => !currentKeys.has(key));
        if (!additions.length) {
          return current;
        }
        return {
          keys: new Set([...currentKeys, ...additions]),
          topicKey: detailTopicStateKey
        };
      });
    },
    [detailTopicStateKey]
  );
  const [primedReplyQuoteContent, setPrimedReplyQuoteContent] = useState<{
    tokens: ReadonlyMap<string, string>;
    topicKey: string;
  }>({ tokens: EMPTY_QUOTE_CONTENT_TOKENS, topicKey: '' });
  const primedReplyQuoteContentTokens =
    primedReplyQuoteContent.topicKey === detailTopicStateKey
      ? primedReplyQuoteContent.tokens
      : EMPTY_QUOTE_CONTENT_TOKENS;
  const quoteContentLayoutProgressRef = useRef(new Map<string, QuoteContentLayoutProgress>());
  useEffect(() => {
    const layoutProgress = quoteContentLayoutProgressRef.current;
    setPrimedReplyQuoteContent((current) =>
      current.topicKey === detailTopicStateKey && current.tokens.size === 0
        ? current
        : { tokens: EMPTY_QUOTE_CONTENT_TOKENS, topicKey: detailTopicStateKey }
    );
    return () => {
      layoutProgress.forEach((progress) => {
        if (progress.frame !== null) cancelAnimationFrame(progress.frame);
      });
      layoutProgress.clear();
    };
  }, [detailTopicStateKey]);
  const markReplyQuoteContentLayout = useCallback(
    ({ contentToken, instanceKey }: { contentToken: string; instanceKey: string }) => {
      if (!detailTopicStateKey) return;
      const progressKey = `${detailTopicStateKey}:${instanceKey}`;
      let progress = quoteContentLayoutProgressRef.current.get(progressKey);
      if (!progress || progress.contentToken !== contentToken) {
        if (progress?.frame !== null && progress?.frame !== undefined) cancelAnimationFrame(progress.frame);
        progress = { contentToken, frame: null, primed: false };
        quoteContentLayoutProgressRef.current.set(progressKey, progress);
      }
      if (progress.primed) return;
      if (progress.frame !== null) return;
      progress.frame = requestAnimationFrame(() => {
        if (quoteContentLayoutProgressRef.current.get(progressKey) !== progress) return;
        progress!.frame = null;
        progress!.primed = true;
        setPrimedReplyQuoteContent((current) => {
          const currentTokens = current.topicKey === detailTopicStateKey ? current.tokens : EMPTY_QUOTE_CONTENT_TOKENS;
          if (currentTokens.get(instanceKey) === contentToken) return current;
          const tokens = new Map(currentTokens);
          tokens.set(instanceKey, contentToken);
          return { tokens, topicKey: detailTopicStateKey };
        });
      });
    },
    [detailTopicStateKey]
  );
  const autoLoadRepliesArmedRef = useRef(false);
  const repliesByFloor = useMemo(() => {
    void quoteStateVersion;
    const next = new Map<number, Reply>();
    if (topic) {
      next.set(1, topicOpeningPostAsReply(topic));
    }
    sourceReplies.forEach((reply) => {
      if (typeof reply.floor === 'number') {
        next.set(reply.floor, reply);
      }
    });
    return next;
  }, [quoteStateVersion, sourceReplies, topic]);
  const newReplyFloorStart = useMemo(() => {
    if (unreadReplyCount <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    const floors = sourceReplies
      .map((reply) => reply.floor)
      .filter((floor): floor is number => typeof floor === 'number');
    if (!floors.length) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(...floors) - unreadReplyCount + 1;
  }, [sourceReplies, unreadReplyCount]);
  const [pollSelections, setPollSelections] = useState<Record<string, string[]>>({});
  const togglePollSelection = useCallback((key: string, poll: TopicPoll, optionId: string) => {
    setPollSelections((current) => {
      const selected = current[key] || [];
      const next = poll.multiple
        ? selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId]
        : [optionId];
      return { ...current, [key]: next };
    });
  }, []);

  const topicColumnStyle = useMemo(() => ({ width: contentWidth }), [contentWidth]);
  const openingAcceptedAnswerFloor = topic?.acceptedAnswerFloor;
  const openingAccessRequirement = topic?.accessRequirement;
  const openingContentHtml = topic?.contentHtml;
  const openingTopicId = topic?.id;
  const openingPolls = topic?.polls;
  const openingReplies = topic?.replies;
  const openingSource = topic?.source;
  const openingContent = useMemo(
    () =>
      buildTopicOpeningContent(
        openingSource
          ? {
              accessRequirement: openingAccessRequirement,
              contentHtml: openingContentHtml || '',
              id: openingTopicId || '',
              polls: openingPolls,
              source: openingSource
            }
          : null
      ),
    [openingAccessRequirement, openingContentHtml, openingPolls, openingSource, openingTopicId]
  );
  const {
    contentItems: topicContentItems,
    legacyPollsVisible: legacyTopicPollsVisible,
    polls: topicPolls,
    showsAccessNotice: topicShowsAccessNotice
  } = openingContent;
  const acceptedAnswer = useMemo(
    () =>
      buildAcceptedAnswerPresentation({
        loadedQuotedReplies,
        showsAccessNotice: topicShowsAccessNotice,
        sourceReplies,
        topic:
          openingSource && openingTopicId
            ? {
                acceptedAnswerFloor: openingAcceptedAnswerFloor,
                id: openingTopicId,
                replies: openingReplies || [],
                source: openingSource
              }
            : null
      }),
    [
      loadedQuotedReplies,
      sourceReplies,
      openingAcceptedAnswerFloor,
      openingReplies,
      openingSource,
      openingTopicId,
      topicShowsAccessNotice
    ]
  );
  const replyItems = useMemo<TopicReplyListItem[]>(
    () =>
      buildVirtualizedReplyItems({
        expandedQuotes,
        loadedQuotedReplies,
        loadingQuotedFloors,
        primedQuoteContentTokens: primedReplyQuoteContentTokens,
        replies,
        repliesByFloor,
        source: itemSource,
        topicId: item?.id
      }),
    [
      expandedQuotes,
      item?.id,
      itemSource,
      loadedQuotedReplies,
      loadingQuotedFloors,
      primedReplyQuoteContentTokens,
      replies,
      repliesByFloor
    ]
  );
  const replyBoundaryConfirmed =
    canShowReplies &&
    !replyRowsPartial &&
    sourceReplies.length > 0 &&
    !replyHasMore &&
    !repliesLoading &&
    !repliesError;
  const terminalReplyItemKey = replyBoundaryConfirmed ? replyItems.at(-1)?.key : undefined;
  const replyWindowIndexByKey = useMemo(
    () => new Map(replies.map((reply, index) => [getReplyKey(reply), index])),
    [replies]
  );
  const replyWindowStartKey = replies[0] ? getReplyKey(replies[0]) : '';
  const acceptedAnswerReply = acceptedAnswer?.reply;
  const acceptedAnswerLoading = Boolean(acceptedAnswer && loadingQuotedFloors[acceptedAnswer.instanceKey]);
  const acceptedAnswerViewKey = acceptedAnswer ? `${detailTopicStateKey}:${acceptedAnswer.instanceKey}` : '';
  const [acceptedAnswerView, setAcceptedAnswerView] = useState({
    expanded: true,
    full: false,
    key: ''
  });
  const acceptedAnswerExpanded = acceptedAnswerView.key === acceptedAnswerViewKey ? acceptedAnswerView.expanded : true;
  const acceptedAnswerFullVisible = acceptedAnswerView.key === acceptedAnswerViewKey ? acceptedAnswerView.full : false;
  useEffect(() => {
    setAcceptedAnswerView((current) =>
      current.key === acceptedAnswerViewKey ? current : { expanded: true, full: false, key: acceptedAnswerViewKey }
    );
  }, [acceptedAnswerViewKey]);
  const acceptedAnswerSource = topic?.source;
  const acceptedAnswerContent = useMemo(
    () =>
      acceptedAnswerReply && acceptedAnswerSource
        ? buildAcceptedAnswerContentItems({
            floor: acceptedAnswer?.floor || acceptedAnswerReply.floor || 0,
            reply: acceptedAnswerReply,
            source: acceptedAnswerSource
          })
        : { fullItems: [] as TopicContentItem[], previewItems: [] as TopicContentItem[] },
    [acceptedAnswer?.floor, acceptedAnswerReply, acceptedAnswerSource]
  );
  const acceptedAnswerLoadAttemptRef = useRef('');
  const loadAcceptedAnswer = useCallback(() => {
    if (!acceptedAnswer) {
      return;
    }
    acceptedAnswerLoadAttemptRef.current = acceptedAnswer.instanceKey;
    onToggleTopicBodyQuote({
      instanceKey: acceptedAnswer.instanceKey,
      prefetch: true,
      reference: acceptedAnswer.reference
    });
  }, [acceptedAnswer, onToggleTopicBodyQuote]);
  useEffect(() => {
    if (
      !acceptedAnswer ||
      acceptedAnswer.reply ||
      acceptedAnswerLoading ||
      acceptedAnswerLoadAttemptRef.current === acceptedAnswer.instanceKey
    ) {
      return;
    }
    loadAcceptedAnswer();
  }, [acceptedAnswer, acceptedAnswerLoading, loadAcceptedAnswer]);
  const discourseTopicReactionStats = useMemo(
    () =>
      topic && isDiscourseSource(topic.source)
        ? topic.source === 'linuxdo'
          ? linuxDoReactionStats(topic, discourseEmojiUrls)
          : discourseReactionStats(topic, discourseEmojiUrls)
        : [],
    [discourseEmojiUrls, topic]
  );
  const topicReactionStats = useMemo(
    () => (topic?.source === 'nodeseek' ? nodeSeekTopicReactionStats(topic) : []),
    [topic]
  );
  const topicHasPostActions = Boolean(
    topic &&
    !topicShowsAccessNotice &&
    ((topic.source === 'nodeseek' && (canWriteNodeSeek || nodeSeekTopicReactionStats(topic).length > 0)) ||
      (isDiscourseSource(topic.source) && (canUseDiscourseInteractions || discourseTopicReactionStats.length > 0)) ||
      (topic.source === 'yaohuo' && canWriteYaohuo) ||
      (topic.source === 'v2ex' && typeof topic.upvoteCount === 'number'))
  );
  const replyListItems = useMemo(
    () =>
      buildReplyListItems({
        canShowReplies,
        showWindowStart: replyHasPrevious,
        replyItems,
        topicShowsAccessNotice
      }),
    [canShowReplies, replyHasPrevious, replyItems, topicShowsAccessNotice]
  );
  const topicOpeningListItems = useMemo<TopicListItem[]>(
    () =>
      topicContentItems.flatMap((content): TopicListItem[] => {
        if (content.type !== 'quoteSummary') {
          return [{ type: 'topicContent', key: content.key, content }];
        }
        const reference = content.quote.reference;
        const quotedPost =
          (reference.topicId === item?.id ? repliesByFloor.get(reference.postNumber) : undefined) ||
          loadedQuotedReplies[quotedPostReferenceKey(reference)];
        const expanded = Boolean(expandedQuotes[content.instanceKey]);
        return [
          { type: 'topicQuoteSummary', key: content.key, content },
          ...(expanded && quotedPost
            ? buildTopicQuotedPostContentItems({
                instanceKey: content.instanceKey,
                reply: quotedPost,
                source: reference.source
              }).map((quoteContent): TopicListItem => ({
                type: 'topicQuoteContent',
                key: `${content.key}:${quoteContent.key}`,
                content: quoteContent,
                instanceKey: content.instanceKey,
                source: reference.source
              }))
            : [])
        ];
      }),
    [expandedQuotes, item?.id, loadedQuotedReplies, repliesByFloor, topicContentItems]
  );
  const firstOpeningRowKey = topicOpeningListItems[0]?.key;
  const firstOpeningRowStartedAt = topicResponseReadyCandidate;
  const acceptedAnswerListItems = useMemo<TopicListItem[]>(() => {
    if (!acceptedAnswer || topicShowsAccessNotice) return [];
    const visibleContent = acceptedAnswerExpanded
      ? acceptedAnswerFullVisible
        ? acceptedAnswerContent.fullItems
        : acceptedAnswerContent.previewItems
      : [];
    return [
      { type: 'topicAcceptedAnswer', key: `topic-accepted-answer-${acceptedAnswer.floor}` },
      ...visibleContent.map((content): TopicListItem => ({
        type: 'topicAcceptedAnswerContent',
        key: `topic-accepted-answer-${acceptedAnswer.floor}:${content.key}`,
        content,
        preview: !acceptedAnswerFullVisible
      }))
    ];
  }, [
    acceptedAnswer,
    acceptedAnswerContent.fullItems,
    acceptedAnswerContent.previewItems,
    acceptedAnswerExpanded,
    acceptedAnswerFullVisible,
    topicShowsAccessNotice
  ]);
  const topicPostludeVisible = Boolean(legacyTopicPollsVisible || topicHasPostActions);
  const disclosureStore = useTopicSplitDisclosureStore(detailTopicStateKey);
  const unfilteredTopicListItems = useMemo<TopicListItem[]>(
    () => [
      ...topicOpeningListItems,
      ...acceptedAnswerListItems,
      ...(topicPostludeVisible ? [{ type: 'topicPostlude' as const, key: 'topic-postlude' }] : []),
      ...replyListItems
    ],
    [acceptedAnswerListItems, replyListItems, topicOpeningListItems, topicPostludeVisible]
  );
  const topicListItems = useMemo(
    () =>
      unfilteredTopicListItems.filter((listItem) => {
        const row = topicListCompiledRow(listItem);
        const scopeKey = topicListContentScope(listItem);
        return !row || !scopeKey || topicSemanticRowVisible(row, scopeKey, disclosureStore);
      }),
    [disclosureStore, unfilteredTopicListItems]
  );
  const bodyMediaPlanStats = useMemo(() => topicListMediaPlanStats(topicListItems), [topicListItems]);
  const bodyMediaDiagnosticSession = useMemo(
    () =>
      item
        ? {
            ...bodyMediaPlanStats,
            source: item.source,
            topicRef: diagnosticRef('topic', `${item.source}:${item.id}`)
          }
        : undefined,
    [bodyMediaPlanStats, item]
  );
  const finishBodyMediaDiagnostic = useCallback((aggregate: TopicBodyMediaAggregate) => {
    const trace = beginDiagnosticTrace('media', 'topic-body-media', {
      source: aggregate.source,
      topicRef: aggregate.topicRef
    });
    finishDiagnosticTrace(trace, 'success', {
      cancelCount: aggregate.cancelCount,
      displayCount: aggregate.displayCount,
      errorCount: aggregate.errorCount,
      ...(aggregate.firstRowElapsedMs === undefined ? {} : { firstRowElapsedMs: aggregate.firstRowElapsedMs }),
      networkMediaCount: aggregate.networkMediaCount,
      plannedRowCount: aggregate.plannedRowCount,
      retryCount: aggregate.retryCount,
      runningHighWater: aggregate.runningHighWater,
      timeoutCount: aggregate.timeoutCount,
      timerHighWater: aggregate.timerHighWater,
      warmHighWater: aggregate.warmHighWater
    });
  }, []);
  const topicListIndexByKey = useMemo(
    () => new Map(topicListItems.map((listItem, index) => [listItem.key, index])),
    [topicListItems]
  );
  const [bodyMediaViewport, setBodyMediaViewport] = useState<{
    indexes: readonly number[];
    rowKeys: readonly string[];
    topicKey: string;
  }>({
    indexes: [],
    rowKeys: [],
    topicKey: ''
  });
  const bodyMediaViewportRowKeys = useMemo(() => {
    if (bodyMediaViewport.topicKey !== detailTopicStateKey) return [];
    if (bodyMediaViewport.rowKeys.every((key) => topicListIndexByKey.has(key))) return bodyMediaViewport.rowKeys;
    return bodyMediaViewport.indexes
      .map((index) => topicListItems[index]?.key)
      .filter((key): key is string => Boolean(key));
  }, [bodyMediaViewport, detailTopicStateKey, topicListIndexByKey, topicListItems]);
  const previousFirstVisibleIndexRef = useRef(-1);
  useEffect(() => {
    previousFirstVisibleIndexRef.current = -1;
    setBodyMediaViewport({ indexes: [], rowKeys: [], topicKey: detailTopicStateKey });
  }, [detailTopicStateKey]);
  useEffect(() => {
    if (!pendingReplyOrderScrollRef.current || repliesLoading || repliesError) return;
    const firstReplyIndex = topicListItems.findIndex(
      (listItem) => listItem.type === 'reply' || listItem.type === 'replyStart'
    );
    if (firstReplyIndex < 0) return;
    pendingReplyOrderScrollRef.current = false;
    topicScrollRef.current?.scrollToIndex({ animated: true, index: firstReplyIndex, viewPosition: 0.2 });
  }, [repliesError, repliesLoading, topicListItems, topicScrollRef]);
  const replyLocationRequestIdRef = useRef(0);
  const [replyLocationCommand, setReplyLocationCommand] = useState<{
    requestId: number;
    target: ReplyLocationTarget;
  } | null>(null);
  const activeTargetReply = replyLocationCommand?.target || targetReply;
  const targetReplyIdentity =
    typeof activeTargetReply?.commentId === 'number'
      ? `comment:${activeTargetReply.commentId}`
      : typeof activeTargetReply?.floor === 'number'
        ? `floor:${activeTargetReply.floor}`
        : '';
  const targetReplyCommandKey = replyLocationCommand
    ? `request:${replyLocationCommand.requestId}`
    : targetReplyIdentity
      ? typeof targetReplyRequestId === 'number'
        ? `route-request:${targetReplyRequestId}`
        : `route:${targetReplyIdentity}`
      : '';
  const targetReplyMatches = useCallback(
    (reply: Reply) =>
      typeof activeTargetReply?.commentId === 'number'
        ? reply.commentId === activeTargetReply.commentId
        : typeof activeTargetReply?.floor === 'number' && reply.floor === activeTargetReply.floor,
    [activeTargetReply?.commentId, activeTargetReply?.floor]
  );
  const targetReplyListIndex = useMemo(
    () =>
      targetReplyCommandKey
        ? topicListItems.findIndex(
            (listItem) =>
              (listItem.type === 'reply' || listItem.type === 'replyStart') && targetReplyMatches(listItem.reply)
          )
        : -1,
    [targetReplyCommandKey, targetReplyMatches, topicListItems]
  );
  const targetIsOpeningPost = Boolean(
    targetReplyCommandKey &&
    ((typeof activeTargetReply?.commentId === 'number' && topic?.commentId === activeTargetReply.commentId) ||
      (typeof activeTargetReply?.commentId !== 'number' &&
        activeTargetReply?.floor === 1 &&
        itemSource &&
        isDiscourseSource(itemSource)))
  );
  const handledTargetReplyRef = useRef('');
  const targetHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedTargetKey, setHighlightedTargetKey] = useState('');
  useEffect(() => {
    handledTargetReplyRef.current = '';
    setHighlightedTargetKey('');
  }, [detailTopicStateKey, targetReplyCommandKey]);
  useEffect(() => {
    setReplyLocationCommand(null);
  }, [detailTopicStateKey, targetReply?.commentId, targetReply?.floor, targetReply?.pageHint, targetReplyRequestId]);
  useEffect(
    () => () => {
      if (targetHighlightTimerRef.current) clearTimeout(targetHighlightTimerRef.current);
    },
    []
  );
  const requestReplyLocation = useCallback(
    (target: ReplyLocationTarget) => {
      replyLocationRequestIdRef.current += 1;
      const requestId = replyLocationRequestIdRef.current;
      setReplyLocationCommand({ requestId, target });
      onCommentQueryChange('');
      onReplyFilterChange('all');
      void onLocateReply(target);
    },
    [onCommentQueryChange, onLocateReply, onReplyFilterChange]
  );
  useEffect(() => {
    if (!targetReplyCommandKey || !canShowReplies || handledTargetReplyRef.current === targetReplyCommandKey) return;
    if (commentQuery || replyFilter !== 'all') {
      onCommentQueryChange('');
      onReplyFilterChange('all');
      return;
    }
    if (targetIsOpeningPost) {
      handledTargetReplyRef.current = targetReplyCommandKey;
      topicScrollRef.current?.scrollToOffset({ animated: true, offset: 0 });
      return;
    }
    if (targetReplyListIndex >= 0) {
      handledTargetReplyRef.current = targetReplyCommandKey;
      if (targetHighlightTimerRef.current) clearTimeout(targetHighlightTimerRef.current);
      setHighlightedTargetKey(targetReplyCommandKey);
      targetHighlightTimerRef.current = setTimeout(() => setHighlightedTargetKey(''), 1800);
      topicScrollRef.current?.scrollToIndex({
        animated: true,
        index: targetReplyListIndex,
        viewPosition: 0.2
      });
    }
  }, [
    canShowReplies,
    commentQuery,
    onCommentQueryChange,
    onReplyFilterChange,
    replyFilter,
    targetIsOpeningPost,
    targetReplyCommandKey,
    targetReplyListIndex,
    topicScrollRef
  ]);
  const acceptedAnswerListIndex = useMemo(() => {
    if (!acceptedAnswerReply) {
      return -1;
    }
    return topicListItems.findIndex(
      (listItem) =>
        (listItem.type === 'reply' || listItem.type === 'replyStart') &&
        listItem.reply.floor === acceptedAnswerReply.floor
    );
  }, [acceptedAnswerReply, topicListItems]);
  const acceptedAnswerIsInSourceReplies = Boolean(
    acceptedAnswer && sourceReplies.some((reply) => reply.floor === acceptedAnswer.floor)
  );
  const pendingAcceptedAnswerScrollRef = useRef(false);
  const scrollToAcceptedAnswer = useCallback(() => {
    if (acceptedAnswerListIndex < 0) {
      pendingAcceptedAnswerScrollRef.current = true;
      onCommentQueryChange('');
      onReplyFilterChange('all');
      return;
    }
    topicScrollRef.current?.scrollToIndex({ animated: true, index: acceptedAnswerListIndex });
  }, [acceptedAnswerListIndex, onCommentQueryChange, onReplyFilterChange, topicScrollRef]);
  useEffect(() => {
    if (!pendingAcceptedAnswerScrollRef.current || acceptedAnswerListIndex < 0) {
      return;
    }
    pendingAcceptedAnswerScrollRef.current = false;
    topicScrollRef.current?.scrollToIndex({ animated: true, index: acceptedAnswerListIndex });
  }, [acceptedAnswerListIndex, topicScrollRef]);
  const windowStartWithinPrefetchRef = useRef(false);
  const loadWindowStart = useCallback(() => {
    if (replyStartError || !replyHasPrevious || loadingPreviousReplies || !autoLoadRepliesArmedRef.current) return;
    autoLoadRepliesArmedRef.current = false;
    void onLoadPreviousReplies();
  }, [loadingPreviousReplies, onLoadPreviousReplies, replyHasPrevious, replyStartError]);
  const armReplyAutoLoad = useCallback(() => {
    autoLoadRepliesArmedRef.current = true;
    if (windowStartWithinPrefetchRef.current) loadWindowStart();
  }, [loadWindowStart]);
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index?: number | null; isViewable?: boolean; item: TopicListItem }[] }) => {
      const visibleReplyIndexes = new Set<number>();
      const visibleTopicIndexes: number[] = [];
      let windowStartVisible = false;
      viewableItems.forEach(({ index, isViewable, item: listItem }) => {
        if (isViewable === false) return;
        const topicIndex = typeof index === 'number' ? index : topicListIndexByKey.get(listItem.key);
        if (topicIndex !== undefined) visibleTopicIndexes.push(topicIndex);
        if (listItem.type === 'replyWindowStart') {
          windowStartVisible = true;
          return;
        }
        if ('reply' in listItem) {
          const index = replyWindowIndexByKey.get(getReplyKey(listItem.reply));
          if (index !== undefined) visibleReplyIndexes.add(index);
        }
      });
      const firstVisibleReplyIndex = Math.min(...visibleReplyIndexes);
      windowStartWithinPrefetchRef.current =
        windowStartVisible || (visibleReplyIndexes.size > 0 && firstVisibleReplyIndex <= visibleReplyIndexes.size);
      if (windowStartWithinPrefetchRef.current) loadWindowStart();
      visibleTopicIndexes.sort((left, right) => left - right);
      const firstVisibleTopicIndex = visibleTopicIndexes[0];
      const lastVisibleTopicIndex = visibleTopicIndexes.at(-1);
      const scrollingForward =
        firstVisibleTopicIndex === undefined ||
        previousFirstVisibleIndexRef.current < 0 ||
        firstVisibleTopicIndex >= previousFirstVisibleIndexRef.current;
      previousFirstVisibleIndexRef.current = firstVisibleTopicIndex ?? -1;
      const nearbyIndexes =
        firstVisibleTopicIndex === undefined || lastVisibleTopicIndex === undefined
          ? []
          : scrollingForward
            ? [lastVisibleTopicIndex + 1, lastVisibleTopicIndex + 2, firstVisibleTopicIndex - 1]
            : [firstVisibleTopicIndex - 1, firstVisibleTopicIndex - 2, lastVisibleTopicIndex + 1];
      const indexes = [...new Set([...visibleTopicIndexes, ...nearbyIndexes])].filter((index) =>
        Boolean(topicListItems[index])
      );
      const rowKeys = indexes.map((index) => topicListItems[index]?.key).filter((key): key is string => Boolean(key));
      setBodyMediaViewport((current) =>
        current.topicKey === detailTopicStateKey &&
        current.indexes.length === indexes.length &&
        current.indexes.every((index, position) => index === indexes[position]) &&
        current.rowKeys.length === rowKeys.length &&
        current.rowKeys.every((key, index) => key === rowKeys[index])
          ? current
          : { indexes, rowKeys, topicKey: detailTopicStateKey }
      );
    },
    [detailTopicStateKey, loadWindowStart, replyWindowIndexByKey, topicListIndexByKey, topicListItems]
  );
  const handleReplyEndReached = useCallback(() => {
    if (replyEndError || !replyHasMore || loadingMoreReplies || !autoLoadRepliesArmedRef.current) return;
    autoLoadRepliesArmedRef.current = false;
    void onLoadMoreReplies();
  }, [loadingMoreReplies, onLoadMoreReplies, replyEndError, replyHasMore]);
  const requestWindowStartLoad = useCallback(() => {
    autoLoadRepliesArmedRef.current = false;
    void onLoadPreviousReplies();
  }, [onLoadPreviousReplies]);
  const requestWindowEndLoad = useCallback(() => {
    autoLoadRepliesArmedRef.current = false;
    void onLoadMoreReplies();
  }, [onLoadMoreReplies]);
  useEffect(() => {
    previousWindowWasAvailableRef.current = replyHasPrevious;
  }, [replyHasPrevious]);
  useEffect(() => {
    autoLoadRepliesArmedRef.current = false;
    windowStartWithinPrefetchRef.current = false;
  }, [replyWindowStartKey]);
  useEffect(() => {
    autoLoadRepliesArmedRef.current = false;
    windowStartWithinPrefetchRef.current = false;
    pendingAcceptedAnswerScrollRef.current = false;
  }, [item?.id, item?.source]);
  const genericHtmlRenderers = useMemo<HtmlRenderers>(() => {
    const tableRenderers = createTopicTableRenderers({
      minColumnWidth: Math.round(
        96 *
          (typeof htmlBaseStyle.fontSize === 'number' && htmlBaseStyle.fontSize > 0 ? htmlBaseStyle.fontSize / 16 : 1)
      ),
      styles
    });
    return {
      ...htmlRenderers,
      ...tableRenderers,
      h1: ContentBoundarySpacingRenderer,
      h2: ContentBoundarySpacingRenderer,
      h3: ContentBoundarySpacingRenderer,
      h4: ContentBoundarySpacingRenderer,
      h5: ContentBoundarySpacingRenderer,
      h6: ContentBoundarySpacingRenderer,
      ol: ContentBoundarySpacingRenderer,
      p: ContentBoundarySpacingRenderer,
      ul: ContentBoundarySpacingRenderer
    };
  }, [htmlBaseStyle.fontSize, htmlRenderers, styles]);
  const topicBodyHtmlRenderers = useMemo<HtmlRenderers>(() => {
    const NodeSeekPollRenderer: CustomBlockRenderer = (props) => {
      const encodedId = String(props.tnode.attributes.id || '');
      const poll =
        itemSource === 'nodeseek'
          ? topicPolls.find((candidate) => candidate.id && encodeURIComponent(candidate.id) === encodedId)
          : undefined;
      if (!poll) {
        return null;
      }
      return (
        <TopicPolls
          actionBusy={actionBusy}
          decisionFor={decisionFor}
          embeddedInArticle
          keyPrefix="topic"
          onTogglePollSelection={togglePollSelection}
          onVotePoll={onVotePoll}
          pollSelections={pollSelections}
          polls={[poll]}
          source="nodeseek"
          styles={styles}
          theme={theme}
        />
      );
    };
    return {
      ...genericHtmlRenderers,
      [NODESEEK_POLL_PLACEHOLDER_TAG]: NodeSeekPollRenderer
    };
  }, [
    actionBusy,
    decisionFor,
    genericHtmlRenderers,
    itemSource,
    onVotePoll,
    pollSelections,
    styles,
    theme,
    togglePollSelection,
    topicPolls
  ]);
  const renderTopicListItemFrame = useCallback(
    (children: ReactNode, key?: string, onLayout?: (event: LayoutChangeEvent) => void) => {
      const frame = (
        <TopicListItemFrame
          key={key}
          firstRowStartedAt={key && key === firstOpeningRowKey ? firstOpeningRowStartedAt : undefined}
          style={styles.topicListItemFrame}
          onLayout={onLayout}
        >
          {children}
        </TopicListItemFrame>
      );
      return key ? <TopicBodyMediaRowBoundary rowKey={key}>{frame}</TopicBodyMediaRowBoundary> : frame;
    },
    [firstOpeningRowKey, firstOpeningRowStartedAt, styles]
  );
  const TopicListItemSeparator = useCallback(
    ({ leadingItem, trailingItem }: { leadingItem: TopicListItem; trailingItem: TopicListItem }) => {
      if (continuesSameLogicalContentGroup(leadingItem, trailingItem)) return null;
      const leadingRow = topicListCompiledRow(leadingItem);
      const trailingRow = topicListCompiledRow(trailingItem);
      if (
        leadingRow?.type === 'table' &&
        trailingRow?.type === 'table' &&
        topicListContentScope(leadingItem) === topicListContentScope(trailingItem)
      ) {
        return <View style={{ height: 12 }} />;
      }
      const height =
        leadingItem.type === 'topicContent' ||
        leadingItem.type === 'topicQuoteSummary' ||
        leadingItem.type === 'topicQuoteContent' ||
        leadingItem.type === 'topicAcceptedAnswer' ||
        leadingItem.type === 'topicAcceptedAnswerContent' ||
        leadingItem.type === 'topicPostlude' ||
        trailingItem.type === 'topicContent' ||
        trailingItem.type === 'topicQuoteSummary' ||
        trailingItem.type === 'topicQuoteContent' ||
        trailingItem.type === 'topicAcceptedAnswer' ||
        trailingItem.type === 'topicAcceptedAnswerContent' ||
        trailingItem.type === 'topicPostlude'
          ? 10
          : topicListItemSpacing(leadingItem, trailingItem);
      return height ? <View style={{ height }} /> : null;
    },
    []
  );
  const renderTopicContentItem = useCallback(
    (
      contentItem: TopicContentItem,
      options?: {
        context?: 'accepted' | 'quote' | 'topic';
        frameKey?: string;
        scopeKey?: string;
        source?: Topic['source'];
      }
    ) => {
      const context = options?.context || 'topic';
      const frameKey = options?.frameKey || contentItem.key;
      const row = contentItem.type === 'content' ? contentItem.row : undefined;
      const continuationBoundary = row ? contentBoundaryForContinuation(rowPresentationPart(row)) : null;
      const trimLeadingStyle = continuationBoundary?.trimLeading ? CONTENT_ROW_TRIM_LEADING : undefined;
      const trimTrailingStyle = continuationBoundary?.trimTrailing ? CONTENT_ROW_TRIM_TRAILING : undefined;
      const contentBoundarySpacing =
        continuationBoundary?.trimLeading || continuationBoundary?.trimTrailing
          ? {
              ...(continuationBoundary.trimLeading ? { marginTop: 0 as const } : {}),
              ...(continuationBoundary.trimTrailing ? { marginBottom: 0 as const } : {})
            }
          : undefined;
      const baseContentContainerStyle =
        context === 'accepted'
          ? styles.topicAcceptedAnswerBody
          : context === 'quote'
            ? [styles.quoteBody, styles.quotePanelBody]
            : styles.articleBody;
      const contentContainerStyle = [baseContentContainerStyle, trimLeadingStyle, trimTrailingStyle];
      const baseRowStyle =
        context === 'accepted'
          ? [styles.replyListItem, styles.topicAcceptedAnswer, topicColumnStyle]
          : context === 'quote'
            ? [styles.replyListItem, styles.quoteBox, topicColumnStyle]
            : [styles.replyListItem, topicColumnStyle];
      const rowStyle = [baseRowStyle, trimLeadingStyle, trimTrailingStyle];
      const wrapContent = (children: ReactNode, onLayout?: (event: LayoutChangeEvent) => void) =>
        renderTopicListItemFrame(
          <View style={rowStyle}>
            <View style={contentContainerStyle}>{children}</View>
          </View>,
          frameKey,
          onLayout
        );
      if (contentItem.type === 'accessNotice') {
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            <View style={styles.topicAccessNotice}>
              {contentItem.label ? <Text style={styles.topicAccessBadge}>{contentItem.label}</Text> : null}
              <Text style={styles.topicAccessNoticeTitle}>暂无权限</Text>
              <Text style={styles.topicAccessNoticeDetail}>{contentItem.detail}</Text>
            </View>
          </View>,
          contentItem.key
        );
      }

      if (contentItem.type === 'poll') {
        return wrapContent(
          <TopicPolls
            actionBusy={actionBusy}
            decisionFor={context === 'accepted' ? undefined : decisionFor}
            embeddedInArticle
            keyPrefix={context === 'topic' ? 'topic' : frameKey}
            onTogglePollSelection={togglePollSelection}
            onVotePoll={onVotePoll}
            pollSelections={pollSelections}
            polls={[contentItem.poll]}
            source={context === 'accepted' ? undefined : context === 'topic' ? topic?.source : options?.source}
            styles={styles}
            theme={theme}
          />
        );
      }

      if (contentItem.type === 'content') {
        if (contentItem.row.type === 'video') {
          return wrapContent(
            <ManagedTopicContentVideo
              key={`${mediaSessionIdentity}:${contentItem.row.src}`}
              boundarySpacing={contentBoundarySpacing}
              mediaContext={mediaContext}
              nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
              poster={contentItem.row.poster}
              referrerPolicy={contentItem.row.referrerPolicy}
              src={contentItem.row.src}
              theme={theme}
            />
          );
        }
        const resolvedHtml =
          'html' in contentItem.row
            ? resolveForumContentRowHtml(contentItem.row, inlineSizedImageUrls, topicImageDeriver.isInlineSizedImage)
            : undefined;
        return wrapContent(
          <TopicSplitDisclosureScope scopeKey={options?.scopeKey || 'opening'}>
            <RenderHTMLConfigProvider
              renderers={topicBodyHtmlRenderers}
              renderersProps={htmlRenderersProps}
              defaultTextProps={{ selectable: true }}
              enableExperimentalBRCollapsing
              enableExperimentalGhostLinesPrevention
              enableExperimentalMarginCollapsing
            >
              <MemoizedTopicContentBlock
                contentWidth={context === 'topic' ? contentWidth : Math.max(220, contentWidth - 24)}
                html={
                  resolvedHtml === undefined || context === 'topic'
                    ? resolvedHtml
                    : highlightHtml(resolvedHtml, replyHighlightQuery)
                }
                originalImageUpgradeEnabled={nearbyTopicContentKeys.has(frameKey)}
                query={context === 'topic' ? '' : replyHighlightQuery}
                row={contentItem.row}
              />
            </RenderHTMLConfigProvider>
          </TopicSplitDisclosureScope>,
          () => addNearbyTopicContentKeys([frameKey])
        );
      }

      if (contentItem.type === 'quoteSummary') return null;
      return null;
    },
    [
      actionBusy,
      contentWidth,
      decisionFor,
      htmlRenderersProps,
      inlineSizedImageUrls,
      mediaContext,
      mediaSessionIdentity,
      nodeSeekMediaUserAgent,
      nearbyTopicContentKeys,
      onVotePoll,
      pollSelections,
      replyHighlightQuery,
      addNearbyTopicContentKeys,
      renderTopicListItemFrame,
      styles,
      theme,
      togglePollSelection,
      topic?.source,
      topicBodyHtmlRenderers,
      topicColumnStyle,
      topicImageDeriver
    ]
  );

  const topicPostlude = useMemo(() => {
    void detailTopicStateKey;
    return (
      <>
        {legacyTopicPollsVisible
          ? renderTopicListItemFrame(
              <View style={[styles.replyListItem, topicColumnStyle]}>
                <View style={styles.articleBody}>
                  <TopicPolls
                    actionBusy={actionBusy}
                    decisionFor={decisionFor}
                    embeddedInArticle
                    keyPrefix="topic"
                    onTogglePollSelection={togglePollSelection}
                    onVotePoll={onVotePoll}
                    pollSelections={pollSelections}
                    polls={topicPolls}
                    source={topic?.source}
                    styles={styles}
                    theme={theme}
                  />
                </View>
              </View>,
              'topic-polls'
            )
          : null}
        {topicHasPostActions
          ? renderTopicListItemFrame(
              <View style={[styles.topicPostActionArea, topicColumnStyle]}>
                {topic?.source === 'v2ex' && typeof topic.upvoteCount === 'number' ? (
                  <View style={styles.topicStatRail}>
                    <NodeSeekStatPill label="UP 票" value={topic.upvoteCount} styles={styles} />
                  </View>
                ) : null}
                {topic?.source === 'nodeseek' && !canWriteNodeSeek && topicReactionStats.length ? (
                  <View style={styles.topicStatRail}>
                    {topicReactionStats.map((stat) => (
                      <NodeSeekStatPill key={stat.label} label={stat.label} value={stat.value} styles={styles} />
                    ))}
                  </View>
                ) : null}
                {canWriteNodeSeek ? (
                  <View style={styles.topicPrimaryActions}>
                    <DetailActionButton
                      active={Boolean(topic?.upvoted)}
                      tone="success"
                      accessibilityLabel={topic?.upvoted ? '已点赞' : '点赞'}
                      count={topic?.upvoteCount}
                      icon={ThumbsUp}
                      label="赞"
                      pending={upvoteDecision.reason === 'pending'}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy || !upvoteDecision.allowed}
                      onPress={() => onInteract('upvote', topic?.commentId)}
                    />
                    <DetailActionButton
                      active={Boolean(topic?.liked)}
                      tone="warning"
                      accessibilityLabel={topic?.liked ? '已加鸡腿' : '加鸡腿'}
                      count={topic?.likeCount}
                      icon={Drumstick}
                      label="鸡腿"
                      pending={likeDecision.reason === 'pending'}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy || !likeDecision.allowed}
                      onPress={() => onInteract('like', topic?.commentId)}
                    />
                    <DetailActionButton
                      active={Boolean(topic?.disliked)}
                      tone="danger"
                      accessibilityLabel={topic?.disliked ? '已反对' : '反对'}
                      count={topic?.dislikeCount}
                      icon={ThumbsDown}
                      label="反对"
                      pending={dislikeDecision.reason === 'pending'}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy || !dislikeDecision.allowed}
                      onPress={() => onInteract('dislike', topic?.commentId)}
                    />
                    <DetailActionButton
                      active={Boolean(topic?.collected)}
                      tone="favorite"
                      accessibilityLabel={topic?.collected ? '取消原站收藏' : '原站收藏'}
                      count={topic?.collectionCount}
                      icon={BookMarked}
                      label="收藏"
                      pending={bookmarkDecision.reason === 'pending'}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy || !bookmarkDecision.allowed}
                      onPress={onNodeSeekCollection}
                    />
                  </View>
                ) : null}
                {isDiscourseSource(topic?.source) && discourseTopicReactionStats.length ? (
                  <View style={styles.topicStatRail}>
                    {discourseTopicReactionStats.map((stat) => (
                      <DiscourseReactionPill
                        compact
                        contentSource={topic?.source || null}
                        key={stat.id}
                        stat={stat}
                        styles={styles}
                      />
                    ))}
                  </View>
                ) : null}
                {canWriteYaohuo ? (
                  <View style={styles.topicPrimaryActions}>
                    <YaohuoFavoriteButton
                      actionBusy={actionBusy}
                      bookmarked={yaohuoBookmarked ?? topic?.bookmarked}
                      onPress={onYaohuoFavorite}
                      styles={styles}
                      theme={theme}
                    />
                  </View>
                ) : null}
                {canUseDiscourseInteractions ? (
                  <View style={styles.topicPrimaryActions}>
                    <DetailActionButton
                      active={Boolean(topic?.liked)}
                      tone="success"
                      accessibilityLabel={topic?.liked ? '取消赞' : '点赞'}
                      icon={ThumbsUp}
                      label="赞"
                      pending={likeDecision.reason === 'pending'}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy || !likeDecision.allowed}
                      onPress={() => onInteract('like', topic?.commentId)}
                    />
                    <DetailActionButton
                      active={Boolean(topic?.bookmarked)}
                      tone="favorite"
                      accessibilityLabel={topic?.bookmarked ? '取消原站收藏' : '原站收藏'}
                      icon={BookMarked}
                      label="收藏"
                      pending={bookmarkDecision.reason === 'pending'}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy || !bookmarkDecision.allowed}
                      onPress={onDiscourseBookmark}
                    />
                  </View>
                ) : null}
              </View>,
              'topic-actions'
            )
          : null}
      </>
    );
  }, [
    actionBusy,
    bookmarkDecision,
    canUseDiscourseInteractions,
    canWriteNodeSeek,
    canWriteYaohuo,
    decisionFor,
    detailTopicStateKey,
    dislikeDecision,
    discourseTopicReactionStats,
    likeDecision,
    legacyTopicPollsVisible,
    onDiscourseBookmark,
    onInteract,
    onNodeSeekCollection,
    onYaohuoFavorite,
    onVotePoll,
    pollSelections,
    renderTopicListItemFrame,
    styles,
    theme,
    togglePollSelection,
    topic,
    yaohuoBookmarked,
    topicColumnStyle,
    topicHasPostActions,
    topicPolls,
    topicReactionStats,
    upvoteDecision
  ]);

  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(
    ({ item: listItem }) => {
      if (listItem.type === 'topicContent') {
        return renderTopicContentItem(listItem.content);
      }
      if (listItem.type === 'topicQuoteSummary') {
        const { instanceKey, quote } = listItem.content;
        const { reference } = quote;
        const quotedPost =
          (reference.topicId === item?.id ? repliesByFloor.get(reference.postNumber) : undefined) ||
          loadedQuotedReplies[quotedPostReferenceKey(reference)];
        const expanded = Boolean(expandedQuotes[instanceKey]);
        const canOpenReference = reference.topicId === item?.id || Boolean(quote.topicUrl);
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            <TopicBodyQuoteCard
              completeContentMountedExternally={expanded && Boolean(quotedPost)}
              expanded={expanded}
              header={
                <Pressable
                  accessibilityLabel={
                    reference.topicId === item?.id
                      ? `定位引用回复，第 ${reference.postNumber} 楼`
                      : `打开引用主题，${quote.topicTitle || `第 ${reference.postNumber} 楼`}`
                  }
                  accessibilityRole={canOpenReference ? 'button' : undefined}
                  disabled={!canOpenReference}
                  onPress={() => {
                    if (reference.topicId === item?.id) {
                      requestReplyLocation({ floor: reference.postNumber });
                    } else if (quote.topicUrl) {
                      onOpenTopic({
                        source: reference.source,
                        id: reference.topicId,
                        title: quote.topicTitle || `引用 #${reference.postNumber}`,
                        author: quote.author?.label || '',
                        url: quote.topicUrl,
                        createdAt: ''
                      });
                    }
                  }}
                >
                  <Text style={styles.quoteAuthorText} numberOfLines={1}>
                    {quote.author?.label || quote.topicTitle || '引用内容'}
                  </Text>
                  <Text style={styles.replyMeta}>引用 #{reference.postNumber}</Text>
                </Pressable>
              }
              loading={Boolean(loadingQuotedFloors[instanceKey])}
              preview={quote.preview ? <Text style={styles.quotePreviewText}>{quote.preview}</Text> : undefined}
              previewTestID={`topic-quote-preview-${reference.topicId}-${reference.postNumber}`}
              styles={styles}
              testID={`topic-quote-${reference.topicId}-${reference.postNumber}`}
              theme={theme}
              onToggle={() => onToggleTopicBodyQuote({ instanceKey, reference, quotedPost })}
            />
          </View>,
          listItem.key
        );
      }
      if (listItem.type === 'topicQuoteContent') {
        return renderTopicContentItem(listItem.content, {
          context: 'quote',
          frameKey: listItem.key,
          scopeKey: `topic-quote:${listItem.instanceKey}`,
          source: listItem.source
        });
      }
      if (listItem.type === 'topicAcceptedAnswer') {
        if (!acceptedAnswer || !topic) return null;
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            <AcceptedAnswerPreview
              key={acceptedAnswer.instanceKey}
              contentSource={topic.source}
              expanded={acceptedAnswerExpanded}
              floor={acceptedAnswer.floor}
              fullAnswerVisible={acceptedAnswerFullVisible}
              loading={acceptedAnswerLoading}
              reply={acceptedAnswerReply}
              styles={styles}
              theme={theme}
              onExpandedChange={(expanded) =>
                setAcceptedAnswerView((current) => ({
                  expanded,
                  full: current.key === acceptedAnswerViewKey ? current.full : false,
                  key: acceptedAnswerViewKey
                }))
              }
              onLoad={loadAcceptedAnswer}
              onReadMore={acceptedAnswerReply && acceptedAnswerIsInSourceReplies ? scrollToAcceptedAnswer : undefined}
              onRevealFull={() => setAcceptedAnswerView({ expanded: true, full: true, key: acceptedAnswerViewKey })}
            />
          </View>,
          listItem.key
        );
      }
      if (listItem.type === 'topicAcceptedAnswerContent') {
        return renderTopicContentItem(listItem.content, {
          context: 'accepted',
          frameKey: listItem.key,
          scopeKey: 'accepted-answer',
          source: topic?.source
        });
      }
      if (listItem.type === 'topicPostlude') {
        return topicPostlude;
      }
      if (listItem.type === 'replyControls') {
        return renderTopicListItemFrame(
          <View style={[styles.replyHeader, topicColumnStyle]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                回复列表
                {typeof replyDisplayCount === 'number' ? (
                  <Text style={styles.countText}> {replyDisplayCount} 条</Text>
                ) : null}
              </Text>
              {canWrite ? (
                <AppButton
                  label={replyComposerOpen ? '收起回复' : '写回复'}
                  variant={replyComposerOpen ? 'ghost' : 'default'}
                  onPress={() => onReplyComposerOpenChange(!replyComposerOpen)}
                />
              ) : null}
            </View>
            {repliesPartialStatus ? <Text style={styles.noticeText}>{repliesPartialStatus}</Text> : null}
            <View style={styles.replySelectionRow}>
              <View style={styles.replyFilterRailSlot}>
                <PillRail
                  variant="subtabs"
                  items={[
                    { value: 'all', label: '全部' },
                    { value: 'author', label: '只看楼主' },
                    { value: 'images', label: '只看带图' }
                  ]}
                  value={replyFilter}
                  onChange={(value) => onReplyFilterChange(value as ReplyFilter)}
                />
              </View>
              {replyCollectionComplete ? (
                <>
                  <Pressable
                    ref={replyOrderMenuTriggerRef}
                    collapsable={false}
                    accessibilityRole="button"
                    accessibilityLabel={`回复排序，当前${replyOrderLabel}`}
                    accessibilityState={{ expanded: replyOrderMenuOpen }}
                    hitSlop={TOUCH_HIT_SLOP}
                    android_ripple={androidRipple(theme.primarySoft)}
                    style={({ pressed }) => [styles.replyOrderButton, pressed && styles.replyOrderButtonPressed]}
                    onPress={openReplyOrderMenu}
                  >
                    <Text style={styles.replyOrderButtonText}>{replyOrderLabel}</Text>
                    <ChevronDown size={14} color={theme.primary} strokeWidth={1.8} />
                  </Pressable>
                  <PopupMenu
                    accessibilityLabel="关闭回复排序菜单"
                    placementStyle={replyOrderMenuPlacement}
                    visible={replyOrderMenuOpen}
                    onRequestClose={closeReplyOrderMenu}
                  >
                    <PopupMenuItem
                      compact
                      label="正序"
                      selected={replyOrder === 'oldest'}
                      onPress={() => selectReplyOrder('oldest')}
                    />
                    <PopupMenuItem
                      compact
                      label="倒序"
                      last
                      selected={replyOrder === 'newest'}
                      onPress={() => selectReplyOrder('newest')}
                    />
                  </PopupMenu>
                </>
              ) : null}
            </View>
            {unreadReplyCount > 0 ? <Text style={styles.noticeText}>新增 {unreadReplyCount} 条回复</Text> : null}
            <View style={styles.searchRow}>
              <TextInput
                accessibilityLabel="评论内查找"
                style={[styles.input, styles.flex]}
                value={commentQuery}
                onChangeText={onCommentQueryChange}
                placeholder="评论内查找"
                placeholderTextColor={theme.muted}
              />
              {commentQuery ? <IconButton icon={X} label="清空查找" onPress={() => onCommentQueryChange('')} /> : null}
            </View>
            {sourceReplies.length > 0 ? renderReplyErrorState(repliesError) : null}
          </View>
        );
      }

      if (listItem.type === 'replyWindowStart') {
        return renderTopicListItemFrame(
          <View style={[styles.topicFooter, topicColumnStyle]}>
            {replyStartError ? (
              renderReplyErrorState(replyStartError, 'start')
            ) : (
              <AppButton
                label={
                  loadingPreviousReplies ? '正在加载...' : replyOrder === 'newest' ? '加载更新回复' : '加载更早回复'
                }
                disabled={loadingPreviousReplies}
                onPress={requestWindowStartLoad}
              />
            )}
          </View>
        );
      }

      if (listItem.type === 'emptyReplies') {
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            {repliesLoading ? (
              <LoadingState text={replyOrder === 'newest' ? '正在读取最新回复...' : '正在读取回复...'} />
            ) : repliesError ? (
              renderReplyErrorState(repliesError)
            ) : (
              <EmptyText text="暂无回复" />
            )}
          </View>
        );
      }

      return renderTopicListItemFrame(
        <View
          style={[
            styles.replyListItem,
            topicColumnStyle,
            highlightedTargetKey && targetReplyMatches(listItem.reply) ? styles.replyLocationHighlight : undefined
          ]}
        >
          <MemoizedReplyItem
            actionBusy={actionBusy}
            bodyContent={listItem.type === 'reply' ? listItem.bodyContent : undefined}
            decisionFor={decisionFor}
            contentWidth={contentWidth}
            expandedQuotes={expandedQuotes}
            inlineSizedImageUrls={inlineSizedImageUrls}
            topicImageDeriver={topicImageDeriver}
            discourseEmojiUrls={discourseEmojiUrls}
            topicBaseUrl={topicBaseUrl}
            loadedQuotedReplies={loadedQuotedReplies}
            loadingQuotedFloors={loadingQuotedFloors}
            onTogglePollSelection={togglePollSelection}
            reply={listItem.reply}
            replyFloor={listItem.replyFloor}
            pollSelections={pollSelections}
            repliesByFloor={repliesByFloor}
            section={listItem.type === 'reply' ? undefined : listItem}
            signatureContent={listItem.type === 'reply' ? listItem.signatureContent : undefined}
            styles={styles}
            theme={theme}
            topicAuthor={item?.author}
            onInteract={onInteract}
            onDeleteReply={onDeleteReply}
            onEditReply={onEditReply}
            onLocateReply={requestReplyLocation}
            onOpenTopic={onOpenTopic}
            onQuoteContentLayout={markReplyQuoteContentLayout}
            onVotePoll={onVotePoll}
            onReplyToFloor={onReplyToFloor}
            onToggleReplyQuote={onToggleReplyQuote}
            topicId={item?.id}
            topicStateKey={detailTopicStateKey}
            query={replyHighlightQuery}
            isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
            isTerminal={listItem.key === terminalReplyItemKey}
            source={itemSource}
            onOpenUser={onOpenUser}
          />
        </View>,
        listItem.key
      );
    },
    [
      acceptedAnswer,
      acceptedAnswerExpanded,
      acceptedAnswerFullVisible,
      acceptedAnswerIsInSourceReplies,
      acceptedAnswerLoading,
      acceptedAnswerReply,
      acceptedAnswerViewKey,
      actionBusy,
      canWrite,
      closeReplyOrderMenu,
      commentQuery,
      contentWidth,
      decisionFor,
      expandedQuotes,
      highlightedTargetKey,
      inlineSizedImageUrls,
      item?.author,
      item?.id,
      topicImageDeriver,
      loadedQuotedReplies,
      loadingPreviousReplies,
      loadingQuotedFloors,
      loadAcceptedAnswer,
      discourseEmojiUrls,
      newReplyFloorStart,
      onCommentQueryChange,
      onDeleteReply,
      onEditReply,
      onInteract,
      onOpenTopic,
      onToggleTopicBodyQuote,
      openReplyOrderMenu,
      markReplyQuoteContentLayout,
      onReplyComposerOpenChange,
      onReplyFilterChange,
      onReplyToFloor,
      onToggleReplyQuote,
      onOpenUser,
      onVotePoll,
      pollSelections,
      renderTopicContentItem,
      renderTopicListItemFrame,
      requestWindowStartLoad,
      requestReplyLocation,
      itemSource,
      replyComposerOpen,
      replyHighlightQuery,
      replyFilter,
      replyCollectionComplete,
      replyOrderLabel,
      replyOrder,
      replyOrderMenuOpen,
      replyOrderMenuPlacement,
      renderReplyErrorState,
      repliesError,
      replyStartError,
      repliesByFloor,
      replyDisplayCount,
      repliesLoading,
      repliesPartialStatus,
      scrollToAcceptedAnswer,
      selectReplyOrder,
      sourceReplies.length,
      styles,
      terminalReplyItemKey,
      theme,
      togglePollSelection,
      topicBaseUrl,
      topicColumnStyle,
      topicPostlude,
      topic,
      targetReplyMatches,
      unreadReplyCount,
      detailTopicStateKey
    ]
  );

  if (!item) {
    return <EmptyText text="未选择主题" />;
  }

  const topicHeaderStatusBadges = topicStatusBadges(item);
  const itemAccessRequirementText = forumAccessRequirementText(item.accessRequirement);
  const listHeader = (
    <View style={styles.topicHeaderStack}>
      <View style={[styles.article, topicColumnStyle]}>
        <View style={styles.topicMetaStack}>
          <View style={styles.topicBadgeRow}>
            <Text style={[styles.topicSourceBadge, sourceBadgeColorStyle(item.source, theme)]} numberOfLines={1}>
              {sourceLabel(item.source)}
            </Text>
            {item.category ? (
              <Text style={styles.topicCategoryBadge} numberOfLines={1}>
                {item.category}
              </Text>
            ) : null}
          </View>
          <Text selectable style={styles.articleTitle}>
            {item.title}
          </Text>
          <Pressable
            testID="topic-author"
            accessibilityRole="button"
            disabled={!userFromTopic(item)}
            style={styles.topicAuthorRow}
            onPress={() => {
              const user = userFromTopic(item);
              if (user) {
                onOpenUser(user);
              }
            }}
          >
            <Avatar contentSource={item.source} name={item.author} uri={item.authorAvatar} />
            <View style={styles.topicAuthorMeta}>
              <View style={styles.replyAuthorNameRow}>
                <Text style={styles.replyAuthor} numberOfLines={1}>
                  {item.author || '未知作者'}
                </Text>
                {item.authorLevelLabel ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('neutral', theme)]} numberOfLines={1}>
                    {item.authorLevelLabel}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.meta}>
                {formatDateTime(item.createdAt)}
                {typeof item.replyCount === 'number' ? ` · ${item.replyCount} 回复` : ''}
                {item.viewCount ? ` · ${item.viewCount} 浏览` : ''}
              </Text>
            </View>
          </Pressable>
          {itemAccessRequirementText ? <Text style={styles.topicAccessBadge}>{itemAccessRequirementText}</Text> : null}
          {topicHeaderStatusBadges.length ? (
            <View style={styles.topicStatusRow}>
              {topicHeaderStatusBadges.map((badge) => (
                <View
                  key={badge.label}
                  style={[styles.topicStatusBadge, topicStatusBadgeColorStyle(badge.tone, theme)]}
                >
                  <Text
                    style={[styles.topicStatusBadgeText, topicStatusBadgeTextColorStyle(badge.tone, theme)]}
                    numberOfLines={1}
                  >
                    {badge.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {item.tags?.length ? (
            <View style={styles.topicTagRow}>
              {item.tags.map((tag, index) => (
                <View key={`${tag}-${index}`} style={[styles.topicTagPill, topicTagColorStyle(tag, theme)]}>
                  <Text style={[styles.topicTagText, topicTagTextColorStyle(tag, theme)]} numberOfLines={1}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        {headerState}
      </View>
    </View>
  );

  return (
    <TRenderEngineProvider
      baseStyle={htmlBaseStyle}
      allowedStyles={HTML_ALLOWED_INLINE_STYLES}
      classesStyles={htmlClassesStyles}
      customHTMLElementModels={HTML_CUSTOM_ELEMENT_MODELS}
      ignoredStyles={htmlIgnoredStyles}
      tagsStyles={htmlTagsStyles}
      ignoredDomTags={HTML_IGNORED_DOM_TAGS}
    >
      <RenderHTMLConfigProvider
        renderers={genericHtmlRenderers}
        renderersProps={htmlRenderersProps}
        defaultTextProps={{ selectable: true }}
        enableExperimentalBRCollapsing
        enableExperimentalGhostLinesPrevention
        enableExperimentalMarginCollapsing
      >
        <TopicSplitDisclosureProvider key={detailTopicStateKey} value={disclosureStore}>
          <TopicTableScrollProvider key={detailTopicStateKey}>
            <TopicBodyMediaCoordinatorProvider
              key={detailTopicStateKey}
              active={active}
              diagnosticSession={bodyMediaDiagnosticSession}
              onDiagnosticFinish={finishBodyMediaDiagnostic}
              paused={bodyMediaPaused}
              viewportRowKeys={bodyMediaViewportRowKeys}
            >
              <FlashList
                ref={topicScrollRef}
                accessibilityLabel={topic ? '主题详情，已加载' : '主题详情'}
                testID={topic ? 'topic-detail-loaded' : undefined}
                style={[styles.content, styles.topicContent]}
                contentContainerStyle={styles.topicContentInner}
                data={topicListItems}
                keyExtractor={topicListItemKey}
                getItemType={topicListItemType}
                ItemSeparatorComponent={TopicListItemSeparator}
                keyboardShouldPersistTaps="always"
                onMomentumScrollEnd={onTopicScroll}
                onScrollEndDrag={onTopicScroll}
                onEndReachedThreshold={0.55}
                onEndReached={handleReplyEndReached}
                onScrollBeginDrag={armReplyAutoLoad}
                onViewableItemsChanged={handleViewableItemsChanged}
                extraData={listExtraData}
                {...TOPIC_DETAIL_LIST_PERFORMANCE_PROPS}
                maintainVisibleContentPosition={{ disabled: !maintainPreviousWindowPosition }}
                ListHeaderComponent={listHeader}
                ListFooterComponent={
                  canShowReplies && replyEndError ? (
                    <View style={styles.topicListItemFrame}>
                      <View style={[styles.topicFooter, topicColumnStyle]}>
                        {renderReplyErrorState(replyEndError, 'end')}
                      </View>
                    </View>
                  ) : canShowReplies && replyHasMore ? (
                    <View style={styles.topicListItemFrame}>
                      <View style={[styles.topicFooter, topicColumnStyle]}>
                        <AppButton
                          label={loadingMoreReplies ? '正在加载...' : '加载更多回复'}
                          disabled={loadingMoreReplies}
                          onPress={requestWindowEndLoad}
                        />
                      </View>
                    </View>
                  ) : replyBoundaryConfirmed ? (
                    <View style={styles.topicListItemFrame}>
                      <Text
                        accessible
                        accessibilityLabel={replyOrder === 'newest' ? '已到最早回复' : '已到最新回复'}
                        style={[styles.replyEndMarker, topicColumnStyle]}
                      >
                        {replyOrder === 'newest' ? '已到最早回复' : '已到最新回复'}
                      </Text>
                    </View>
                  ) : null
                }
                renderItem={renderReplyItem}
              />
            </TopicBodyMediaCoordinatorProvider>
          </TopicTableScrollProvider>
        </TopicSplitDisclosureProvider>
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
});
