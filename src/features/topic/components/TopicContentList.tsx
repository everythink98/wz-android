import { recordUserInteraction } from '@/platform/network/userPresence';
import { resolveTopicLocation, topicLocationForReply } from '@/domain/forum/topicLocation';
import { createTopicStyles, createTopicTableStyles, type TopicStyles } from '../styles';
import {
  createContext,
  memo,
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
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
  type NativeTouchEvent,
  type ViewStyle,
  Keyboard,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  useWindowDimensions,
  View
} from 'react-native';
import { Searchbar } from 'react-native-paper';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { RenderHTMLConfigProvider, TRenderEngineProvider, type CustomBlockRenderer } from 'react-native-render-html';
import { Bookmark, BookmarkCheck, ChevronDown, Ham, Search, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import { findReplyLocation } from '@/domain/forum/replyLocation';
import type { ReadingSession } from '@/platform/query/discourseReadingRuntime';
import {
  topicListReadingFloor,
  topicListReadingNeedsDisplayedMedia,
  topicListReadingRevision
} from '../model/topicListModel';
import { findReadingResumeReply } from '@/domain/forum/discourseReading';
import type {
  Reply,
  ReplyLocationTarget,
  TopicLocationTarget,
  ReplyOrder,
  SourceErrorInfo,
  Topic,
  TopicDetail,
  TopicPoll,
  UserReference
} from '@/domain/forum/models';
import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { HtmlRenderers } from '../rendering/types';
import type { ReplyFilter } from '../model/types';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '@/domain/forum/presentation';
import { contentBoundaryForContinuation } from '../rendering/htmlStyles';
import { HTML_ALLOWED_INLINE_STYLES } from '@/ui/content/forumHtmlStyles';
import {
  NODESEEK_STARDUST_PLACEHOLDER_TAG,
  nodeSeekStardustReceiveFromAttributes
} from '@/sources/nodeseek/stardustMarkup';
import {
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
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { Avatar } from '@/ui/avatar/Avatar';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { topicWithAuthorFallback, userFromTopic } from '@/domain/forum/userNavigation';
import type { InteractionType } from '@/domain/forum/topicActionState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { discourseReactionStats, type DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { linuxDoReactionStats } from '@/sources/linuxdo/reactions';
import {
  LinuxDoBoostButton,
  LinuxDoBoosts,
  LinuxDoReactionButton,
  useLinuxDoInteractionOverlayOpen
} from './LinuxDoPostInteractions';
import { replyForQuotedPost, topicOpeningPostAsReply, topicForQuotedPost } from '@/domain/forum/quotedPosts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { TopicPolls } from './TopicPolls';
import { AcceptedAnswerPreview } from './AcceptedAnswerPreview';
import { DetailActionButton } from './TopicActionBar';
import { TopicBodyQuoteCard } from './TopicBodyQuoteCard';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { DiscourseReactionPill, MemoizedReplyItem, NodeSeekStatPill, nodeSeekTopicReactionStats } from './ReplyItem';
import { TopicCopySurface } from './TopicCopySurface';
import { topicStatusBadges } from '../model/topicHeaderModel';
import type { TopicActionsController } from '../actions/useTopicActionsController';
import { markCurrentNodeSeekOwnRepliesUnlikable } from '../actions/actionHelpers';
import type { useHtmlRenderingController } from '../rendering/useHtmlRenderingController';
import { filterTopicSessionReplies, type TopicSessionController } from '../useTopicSessionController';
import { createReplySearchCache } from '../model/replySearch';
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
  imagePreviewDescriptorsForReplies,
  topicListItemSpacing,
  type TopicReplyListItem
} from '../model/replyListModel';
import {
  topicListCompiledRow,
  topicListItemKey,
  topicListItemType,
  projectTopicListItems,
  type TopicListItem
} from '../model/topicListModel';
import { highlightHtml } from '@/ui/text/highlight';
import { stripHtml } from '@/domain/forum/text';
import { createHtmlCustomElementModels } from '../rendering/htmlElementModels';
import {
  TopicBodyMediaCoordinatorProvider,
  useTopicBodyMediaFirstRowMarker,
  TopicBodyMediaRowBoundary,
  type TopicBodyMediaAggregate
} from '../media/TopicBodyMediaCoordinator';
import { ManagedTopicContentVideo } from '../media/ManagedTopicContentVideo';
import { useTopicBodyMediaViewport } from '../media/useTopicBodyMediaViewport';
import { diagnosticRef, type DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  topicSemanticRowVisible,
  useTopicSplitDisclosureStore
} from '../rendering/TopicSplitDisclosure';
import { useContentBoundarySpacing } from '../rendering/TopicContentPresentation';
import type { CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { createTopicTableRenderers, TopicTableScrollProvider } from '../rendering/topicTableRenderers';
import { NodeSeekStardustCard } from './NodeSeekStardustCard';
import { DiscoursePolicyPanel } from '@/ui/content/DiscoursePolicyPanel';
import {
  TopicSelectionRowProvider,
  TopicSelectionSurface,
  useTopicSelectionRowActive,
  useTopicSelectionRowRef
} from '../selection/TopicSelectionSurface';

const EMPTY_QUOTE_CONTENT_TOKENS = new Map<string, string>();
const REPLY_START_REACHED_THRESHOLD = 3;
const REPLY_END_REACHED_THRESHOLD = 0.55;
const TOPIC_VISIBLE_CONTENT_POSITION = {
  shouldAnchorItem: (item: TopicListItem) =>
    item.type !== 'topicHeader' && item.type !== 'replyControls' && item.type !== 'replyWindowStart'
};

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

type TopicOpeningListItem = Extract<
  TopicListItem,
  { type: 'topicContent' | 'topicQuoteContent' | 'topicQuoteSummary' }
>;

function topicListItemVisible(item: TopicListItem, disclosureStore: Parameters<typeof topicSemanticRowVisible>[2]) {
  const row = topicListCompiledRow(item);
  const scopeKey = topicListContentScope(item);
  return !row || !scopeKey || topicSemanticRowVisible(row, scopeKey, disclosureStore);
}

const TopicStardustActionsContext = createContext<TopicActionsController | null>(null);

const NodeSeekStardustRenderer: CustomBlockRenderer = (props) => {
  const actions = useContext(TopicStardustActionsContext);
  const receive = nodeSeekStardustReceiveFromAttributes(props.tnode.attributes);
  return actions && receive ? <NodeSeekStardustCard actions={actions} receive={receive} /> : null;
};

function TopicSelectionRenderHtmlConfig({
  actions,
  children,
  renderers,
  renderersProps,
  selectable
}: Pick<ComponentProps<typeof RenderHTMLConfigProvider>, 'renderers' | 'renderersProps'> & {
  actions?: TopicActionsController;
  children: ReactNode;
  selectable?: boolean;
}) {
  const rowActive = useTopicSelectionRowActive();
  const textSelectable = selectable ?? !rowActive;
  const defaultTextProps = useMemo(() => ({ selectable: textSelectable }), [textSelectable]);
  const content = (
    <RenderHTMLConfigProvider
      renderers={renderers}
      renderersProps={renderersProps}
      defaultTextProps={defaultTextProps}
      enableExperimentalBRCollapsing
      enableExperimentalGhostLinesPrevention
      enableExperimentalMarginCollapsing
    >
      {children}
    </RenderHTMLConfigProvider>
  );
  return actions ? (
    <TopicStardustActionsContext.Provider value={actions}>{content}</TopicStardustActionsContext.Provider>
  ) : (
    content
  );
}

function topicListContentScope(item: TopicListItem) {
  if (item.type === 'topicQuoteSummary') return `topic-quote:${item.content.instanceKey}`;
  if (item.type === 'topicQuoteContent') return `topic-quote:${item.instanceKey}`;
  if (item.type === 'topicContent') return 'opening';
  if (item.type === 'replyQuoteContent') return `reply-quote:${item.instanceKey}`;
  if (item.type === 'replyContent') return `reply:${getReplyKey(item.reply)}:body`;
  if (item.type === 'replySignatureContent') return `reply:${getReplyKey(item.reply)}:signature`;
  return '';
}

function continuesSameLogicalContentGroup(leadingItem: TopicListItem, trailingItem: TopicListItem) {
  if (topicListContentScope(leadingItem) !== topicListContentScope(trailingItem)) return false;
  if (
    leadingItem.type === 'topicQuoteSummary' &&
    trailingItem.type === 'topicQuoteContent' &&
    leadingItem.content.instanceKey === trailingItem.instanceKey
  ) {
    return true;
  }
  if (
    leadingItem.type === 'topicQuoteContent' &&
    trailingItem.type === 'topicQuoteContent' &&
    leadingItem.instanceKey === trailingItem.instanceKey
  ) {
    return true;
  }
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
  selectionRowKey,
  style
}: {
  children: ReactNode;
  firstRowStartedAt?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  selectionRowKey?: string;
  style: ViewStyle;
}) {
  const markFirstRow = useTopicBodyMediaFirstRowMarker();
  const marker = useTopicSelectionRowRef(selectionRowKey);
  const markedRef = useRef<number | undefined>(undefined);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLayout?.(event);
      if (firstRowStartedAt === undefined || markedRef.current === firstRowStartedAt) return;
      markedRef.current = firstRowStartedAt;
      markFirstRow(monotonicNowMs() - firstRowStartedAt);
    },
    [firstRowStartedAt, markFirstRow, onLayout]
  );
  return (
    <TopicSelectionRowProvider active={Boolean(selectionRowKey && marker.active)}>
      {/* Selection changes must keep the quote header and native media mounted. */}
      <View ref={marker.ref} collapsable={false} nativeID={marker.nativeID} style={style} onLayout={handleLayout}>
        {children}
      </View>
    </TopicSelectionRowProvider>
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
      tone={stateKnown ? 'favorite' : 'primary'}
      accessibilityLabel={stateKnown ? (bookmarked ? '取消收藏' : '收藏') : '收藏状态未加载'}
      icon={Bookmark}
      activeIcon={BookmarkCheck}
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
  readingPaused: readingPausedByParent = false,
  bottomContentInset = 0,
  commentSearchFocused,
  currentNodeSeekUser,
  discourseEmojiUrls,
  headerState,
  html,
  nodeSeekUserId,
  onImagePreviewDescriptors,
  onCommentSearchFocusChange,
  onOpenTopic,
  onOpenUser,
  onScroll: onTopicScroll,
  onScrollProgress,
  read,
  session,
  location,
  locationRequestId,
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
  readingPaused?: boolean;
  bottomContentInset?: number;
  commentSearchFocused: boolean;
  currentNodeSeekUser: SiteSessionViewModels['nodeseek']['currentUser'];
  discourseEmojiUrls: DiscourseEmojiUrlMap;
  headerState: ReactNode;
  html: ReturnType<typeof useHtmlRenderingController> & { contentWidth: number; mediaSessionIdentity: string };
  nodeSeekUserId: number | null;
  onImagePreviewDescriptors: (descriptors: readonly ForumImagePreviewDescriptor[]) => void;
  onCommentSearchFocusChange: (focused: boolean) => void;
  onOpenTopic: (topic: Topic, location?: TopicLocationTarget) => void;
  onOpenUser: (user: UserReference) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollProgress?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  read: ReturnType<typeof useTopicController>;
  session: TopicSessionController;
  location?: TopicLocationTarget;
  locationRequestId?: number;
  topicScrollRef: RefObject<FlashListRef<TopicListItem> | null>;
}) {
  const interactionOverlayOpen = useLinuxDoInteractionOverlayOpen();
  const readingPaused = readingPausedByParent || interactionOverlayOpen;
  const { state, commands } = session;
  const {
    actionBusy,
    decisionFor,
    deleteReply: onDeleteReply,
    editReply: onEditReply,
    policySubmissions,
    setPolicyAcceptance: onSetPolicyAcceptance
  } = actions;
  const { busy: topicBusy, error: topicError, topic, yaohuoBookmarked } = article;
  const {
    contentWidth,
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    mediaContext,
    mediaSessionIdentity,
    nodeSeekMediaUserAgent
  } = html;
  const searchCache = useMemo(
    () => createReplySearchCache(),
    // Scope changes must replace the cache before filtering this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, mediaSessionIdentity, state.selectedTopic.id, state.selectedTopic.source]
  );
  useEffect(() => () => searchCache.clear(), [searchCache]);
  const filteredReplies = useMemo(
    () =>
      filterTopicSessionReplies({
        commentQuery: state.debouncedCommentQuery,
        replyFilter: state.replyFilter,
        source: state.selectedTopic.source,
        topicDetail: topic,
        topicReplies: read.topicReplies,
        searchCache: active ? searchCache : undefined
      }),
    [
      active,
      read.topicReplies,
      searchCache,
      state.debouncedCommentQuery,
      state.replyFilter,
      state.selectedTopic.source,
      topic
    ]
  );
  const replies = useMemo(
    () => markCurrentNodeSeekOwnRepliesUnlikable(filteredReplies, currentNodeSeekUser, nodeSeekUserId),
    [currentNodeSeekUser, filteredReplies, nodeSeekUserId]
  );
  const selectedTopic = state.selectedTopic;
  const commentQuery = state.commentQuery;
  const commentSearchRef = useRef<ComponentRef<typeof Searchbar>>(null);
  const commentSearchContainerRef = useRef<View>(null);
  const commentSearchMeasureRequestRef = useRef(0);
  const commentSearchActive = active && commentSearchFocused && state.replyComposerIntent.kind === 'closed';
  const commentSearchScopeRef = useCommittedRef(commentSearchActive);
  const commentSearchTouchRef = useRef<NativeTouchEvent | null>(null);
  const expandedQuotes = state.expandedQuotes;
  const replyHighlightQuery = state.debouncedCommentQuery;
  const quoteStateVersion = state.quoteStateVersion;
  const replyFilter = state.replyFilter;
  const replyOrder = state.replyOrder;
  const sourceReplies = read.topicReplies;
  const endedEmpty = topic?.source === 'yaohuo' && topic.closed && topic.replyCount === 0 && sourceReplies.length === 0;
  const replyHasPrevious = read.replyHasPrevious;
  const replyHasMore = read.replyHasMore;
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
  const onCancelReplyLocation = read.cancelReplyLocation;
  const onReplyToFloor = commands.composer.replyToFloor;
  const onToggleReplyQuote = read.toggleReplyQuote;
  const onToggleTopicBodyQuote = read.toggleTopicBodyQuote;
  const onDiscourseBookmark = actions.bookmarkOnDiscourseSite;
  const onNodeSeekCollection = actions.collectOnNodeSeekSite;
  const onYaohuoFavorite = actions.favoriteOnYaohuoSite;
  const onInteract = actions.interact;
  const onLockPoll = actions.lockNodeSeekPoll;
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
  const { settings, styles, theme } = useReaderThemeStyles(createTopicStyles);
  const htmlCustomElementModels = useMemo(
    () => createHtmlCustomElementModels(settings.lineHeight),
    [settings.lineHeight]
  );
  const { fontScale: systemFontScale, height: windowHeight, width: windowWidth } = useWindowDimensions();
  const replyOrderMenuTriggerRef = useRef<View>(null);
  const replyOrderMenuRequestRef = useRef(0);
  const [replyOrderMenuOpen, setReplyOrderMenuOpen] = useState(false);
  const [replyOrderMenuPlacement, setReplyOrderMenuPlacement] = useState<ViewStyle>({
    position: 'absolute',
    right: 12,
    top: 12,
    minWidth: 104
  });
  const replyOrderLabel = replyOrder === 'newest' ? '倒序' : '正序';
  const closeReplyOrderMenu = useCallback(() => {
    replyOrderMenuRequestRef.current += 1;
    setReplyOrderMenuOpen(false);
  }, []);
  useEffect(() => {
    closeReplyOrderMenu();
    return () => {
      replyOrderMenuRequestRef.current += 1;
    };
  }, [active, closeReplyOrderMenu, windowHeight, windowWidth]);
  const openReplyOrderMenu = useCallback(() => {
    if (!active) return;
    closeReplyOrderMenu();
    const request = replyOrderMenuRequestRef.current;
    replyOrderMenuTriggerRef.current?.measureInWindow((x, y, width, height) => {
      if (replyOrderMenuRequestRef.current !== request) return;
      const margin = 8;
      const opensAbove = y + height / 2 > windowHeight / 2;
      setReplyOrderMenuPlacement({
        position: 'absolute',
        right: Math.max(margin, windowWidth - x - width),
        ...(opensAbove ? { bottom: Math.max(margin, windowHeight - y + 4) } : { top: y + height + 4 }),
        minWidth: 104
      });
      setReplyOrderMenuOpen(true);
    });
  }, [active, closeReplyOrderMenu, windowHeight, windowWidth]);
  const selectReplyOrder = useCallback(
    (order: ReplyOrder) => {
      closeReplyOrderMenu();
      changeReplyOrder(order);
    },
    [changeReplyOrder, closeReplyOrderMenu]
  );
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const topicLoading = topicBusy || (!topic && !topicError);
  const canShowReplies = Boolean(topic && !topicLoading);
  const detailTopicStateKey = topic ? `${topic.source}:${topic.id}` : item ? `${item.source}:${item.id}` : '';
  const detailTopicDiagnosticRef = item ? diagnosticRef('topic', `${item.source}:${item.id}`) : '';
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
      replyEndError,
      replyOrder,
      replyOrderMenuOpen,
      replyStartError
    ]
  );
  const itemSource = topic?.source;
  const topicBaseUrl = topic?.url || item?.url;
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
  const replyScroll = useRef({
    phase: 'idle' as 'idle' | 'drag' | 'momentum',
    momentum: false,
    offset: 0,
    correction: 0,
    start: '',
    end: ''
  });
  const replyLoadPending = useRef(false);
  const stopReplyScroll = useCallback(() => {
    replyScroll.current.phase = 'idle';
    replyScroll.current.momentum = false;
  }, []);
  const recordScrollCommand = useCallback(
    (
      scrollReason: NonNullable<DiagnosticFields['scrollReason']>,
      target: Pick<DiagnosticFields, 'targetIndex' | 'offset'>
    ) => {
      const fields = { source: item?.source, topicRef: detailTopicDiagnosticRef, scrollReason, ...target };
      const trace = beginDiagnosticTrace('topic', 'scroll-command', fields);
      finishDiagnosticTrace(trace, 'success', fields);
    },
    [detailTopicDiagnosticRef, item?.source]
  );
  const loadedReplyCount = sourceReplies.length;
  const firstReplyFloor = sourceReplies[0]?.floor;
  const lastReplyFloor = sourceReplies.at(-1)?.floor;
  const replyWindowCursor = `${read.replyPreviousCursor?.page}:${read.replyPreviousCursor?.offset}:${read.replyNextPage}:${read.replyNextOffset}`;
  useEffect(() => {
    const fields = {
      source: item?.source,
      topicRef: detailTopicDiagnosticRef,
      cursorRef: diagnosticRef('cursor', `${detailTopicStateKey}:${replyOrder}:${replyWindowCursor}`),
      replyOrder,
      itemCount: loadedReplyCount,
      firstFloor: firstReplyFloor,
      lastFloor: lastReplyFloor
    };
    const trace = beginDiagnosticTrace('topic', 'scroll-window', fields);
    finishDiagnosticTrace(trace, 'success', fields);
  }, [
    detailTopicDiagnosticRef,
    detailTopicStateKey,
    firstReplyFloor,
    item?.source,
    lastReplyFloor,
    loadedReplyCount,
    replyOrder,
    replyWindowCursor
  ]);
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
  const newReplyFloorStart = read.newReplyFloorStart ?? Number.POSITIVE_INFINITY;
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
  const openingPreparedContent = topic?.preparedContent;
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
              preparedContent: openingPreparedContent,
              source: openingSource
            }
          : null
      ),
    [openingAccessRequirement, openingContentHtml, openingPolls, openingPreparedContent, openingSource, openingTopicId]
  );
  const {
    contentItems: topicContentItems,
    legacyPollsVisible: legacyTopicPollsVisible,
    polls: topicPolls,
    previewImages: openingPreviewImages,
    showsAccessNotice: topicShowsAccessNotice
  } = openingContent;
  const openingImagePreviewDescriptors = useMemo(
    () =>
      itemSource === 'linuxdo'
        ? openingPreviewImages.map((descriptor) => ({
            ...descriptor,
            readingOrigin: { topicId: selectedTopic.id, floor: 1 }
          }))
        : openingPreviewImages,
    [itemSource, openingPreviewImages, selectedTopic.id]
  );
  const loadedQuotedReplyValues = useMemo(() => Object.values(loadedQuotedReplies), [loadedQuotedReplies]);
  const imagePreviewDescriptors = useMemo(
    () =>
      itemSource
        ? [
            ...openingImagePreviewDescriptors,
            ...imagePreviewDescriptorsForReplies(sourceReplies, itemSource, selectedTopic.id),
            ...imagePreviewDescriptorsForReplies(loadedQuotedReplyValues, itemSource)
          ]
        : openingImagePreviewDescriptors,
    [itemSource, loadedQuotedReplyValues, openingImagePreviewDescriptors, sourceReplies, selectedTopic.id]
  );
  const catalogReadyElapsedRef = useRef<{ elapsedMs?: number; topicRef: string }>({ topicRef: '' });
  useLayoutEffect(() => {
    onImagePreviewDescriptors(imagePreviewDescriptors);
    if (!detailTopicDiagnosticRef || topicResponseReadyCandidate === undefined) {
      catalogReadyElapsedRef.current = { topicRef: detailTopicDiagnosticRef };
      return;
    }
    const current = catalogReadyElapsedRef.current;
    if (current.topicRef === detailTopicDiagnosticRef && current.elapsedMs !== undefined) return;
    catalogReadyElapsedRef.current = {
      elapsedMs: Math.max(0, Math.floor(monotonicNowMs() - topicResponseReadyCandidate)),
      topicRef: detailTopicDiagnosticRef
    };
  }, [detailTopicDiagnosticRef, imagePreviewDescriptors, onImagePreviewDescriptors, topicResponseReadyCandidate]);
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
  const acceptedAnswerReply = acceptedAnswer?.reply;
  const copyAcceptedAnswerToClipboard = useCallback(() => {
    const copyText = stripHtml(acceptedAnswerReply?.contentHtml || '');
    if (!copyText) return;
    void Clipboard.setStringAsync(copyText)
      .then(() => ToastAndroid.show('评论已复制', ToastAndroid.SHORT))
      .catch(() => ToastAndroid.show('复制失败', ToastAndroid.SHORT));
  }, [acceptedAnswerReply?.contentHtml]);
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
  const titleOnlyV2ex = topic?.source === 'v2ex' && !topicContentItems.length && !legacyTopicPollsVisible;
  const topicHasPostActions = Boolean(
    topic &&
    !topicShowsAccessNotice &&
    ((topic.source === 'nodeseek' && (canWriteNodeSeek || topicReactionStats.length > 0)) ||
      (isDiscourseSource(topic.source) &&
        (canUseDiscourseInteractions ||
          discourseTopicReactionStats.length > 0 ||
          topic.siteExtension?.boosts?.length ||
          topic.siteExtension?.canBoost)) ||
      (topic.source === 'yaohuo' && canWriteYaohuo) ||
      (topic.source === 'v2ex' && !titleOnlyV2ex && typeof topic.upvoteCount === 'number'))
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
  const topicOpeningListItems = useMemo<TopicOpeningListItem[]>(
    () =>
      topicContentItems.flatMap((content): TopicOpeningListItem[] => {
        if (content.type !== 'quoteSummary') {
          return [{ type: 'topicContent', key: content.key, content }];
        }
        const reference = content.quote.reference;
        const quotedPost = replyForQuotedPost(reference, itemSource, item?.id, repliesByFloor, loadedQuotedReplies);
        const expanded = Boolean(expandedQuotes[content.instanceKey]);
        return [
          {
            type: 'topicQuoteSummary',
            key: content.key,
            content,
            previewVisible: Boolean(content.quote.preview && !(expanded && quotedPost))
          },
          ...(expanded && quotedPost
            ? buildTopicQuotedPostContentItems({
                instanceKey: content.instanceKey,
                reply: quotedPost,
                source: reference.source
              }).map((quoteContent): TopicOpeningListItem => ({
                type: 'topicQuoteContent',
                key: `${content.key}:${quoteContent.key}`,
                content: quoteContent,
                instanceKey: content.instanceKey,
                source: reference.source
              }))
            : [])
        ];
      }),
    [expandedQuotes, item?.id, itemSource, loadedQuotedReplies, repliesByFloor, topicContentItems]
  );
  const firstOpeningRowKey = topicOpeningListItems[0]?.key;
  const firstArticleBodyKey = topicOpeningListItems.find(
    (item) => item.type === 'topicContent' && item.content.type === 'content'
  )?.key;
  const firstOpeningRowStartedAt = topicResponseReadyCandidate;
  const disclosureStore = useTopicSplitDisclosureStore(detailTopicStateKey);
  const acceptedAnswerListItems = useMemo<TopicListItem[]>(() => {
    if (!acceptedAnswer || topicShowsAccessNotice) return [];
    const visibleContent = acceptedAnswerExpanded
      ? acceptedAnswerFullVisible
        ? acceptedAnswerContent.fullItems
        : acceptedAnswerContent.previewItems
      : [];
    return [
      {
        type: 'topicAcceptedAnswer',
        key: `topic-accepted-answer-${acceptedAnswer.floor}`,
        content: visibleContent.filter(
          (content) => !('row' in content) || topicSemanticRowVisible(content.row, 'accepted-answer', disclosureStore)
        ),
        preview: !acceptedAnswerFullVisible
      }
    ];
  }, [
    acceptedAnswer,
    acceptedAnswerContent.fullItems,
    acceptedAnswerContent.previewItems,
    acceptedAnswerExpanded,
    acceptedAnswerFullVisible,
    disclosureStore,
    topicShowsAccessNotice
  ]);
  const topicPostludeVisible = Boolean(legacyTopicPollsVisible || topicHasPostActions);
  const replyLocationRequestIdRef = useRef(0);
  const [replyLocationCommand, setReplyLocationCommand] = useState<{
    requestId: number;
    target: ReplyLocationTarget;
  } | null>(null);
  const targetReply = location?.kind === 'reply' ? location.target : undefined;
  const activeLocation = resolveTopicLocation(
    topic,
    replyLocationCommand ? { kind: 'reply', target: replyLocationCommand.target } : location
  );
  const activeTargetReply = activeLocation?.kind === 'reply' ? activeLocation.target : undefined;
  // A middle window has an unloaded gap before it; the opening is not its preceding content.
  const showOpening = !replyHasPrevious || activeLocation?.kind === 'opening';
  const unfilteredTopicListItems = useMemo<TopicListItem[]>(
    () => [
      ...(showOpening ? [{ type: 'topicHeader' as const, key: 'topic-header' }] : []),
      ...(showOpening ? topicOpeningListItems : []),
      ...(showOpening ? acceptedAnswerListItems : []),
      ...(showOpening && topicPostludeVisible ? [{ type: 'topicPostlude' as const, key: 'topic-postlude' }] : []),
      ...replyListItems
    ],
    [acceptedAnswerListItems, replyListItems, showOpening, topicOpeningListItems, topicPostludeVisible]
  );
  const {
    items: topicListItems,
    selectionItems: topicSelectionItems,
    selectionRowKeys: topicSelectionRowKeys,
    mediaPlanStats: bodyMediaPlanStats
  } = useMemo(
    () =>
      projectTopicListItems(unfilteredTopicListItems, (listItem) => topicListItemVisible(listItem, disclosureStore)),
    [disclosureStore, unfilteredTopicListItems]
  );
  const topicSelectionSessionKey = `${detailTopicStateKey}:${contentWidth}:${systemFontScale}:${settings.fontFamily}:${settings.fontScale}:${settings.lineHeight}`;
  const replyWindowStartIndex = useMemo(
    () => topicListItems.findIndex((listItem) => listItem.type === 'replyWindowStart'),
    [topicListItems]
  );
  const bodyMediaDiagnosticSession = useMemo(
    () =>
      item
        ? {
            ...bodyMediaPlanStats,
            responseReadyAt: topicResponseReadyCandidate,
            source: item.source,
            topicRef: detailTopicDiagnosticRef
          }
        : undefined,
    [bodyMediaPlanStats, detailTopicDiagnosticRef, item, topicResponseReadyCandidate]
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
      ...(catalogReadyElapsedRef.current.topicRef === aggregate.topicRef &&
      catalogReadyElapsedRef.current.elapsedMs !== undefined
        ? { catalogReadyElapsedMs: catalogReadyElapsedRef.current.elapsedMs }
        : {}),
      ...(aggregate.firstMediaElapsedMs === undefined ? {} : { firstMediaElapsedMs: aggregate.firstMediaElapsedMs }),
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
  const {
    observeViewableItems,
    visibleRowKeys: bodyMediaVisibleRowKeys,
    viewportRowKeys: bodyMediaViewportRowKeys
  } = useTopicBodyMediaViewport({
    items: topicListItems,
    sessionIdentity: `${detailTopicStateKey}:${mediaSessionIdentity}`
  });
  const bodyMediaViewportRowKeySet = useMemo(() => new Set(bodyMediaViewportRowKeys), [bodyMediaViewportRowKeys]);
  const [loadedDetailKey, setLoadedDetailKey] = useState('');
  const onListLoad = useCallback(() => setLoadedDetailKey(detailTopicStateKey), [detailTopicStateKey]);
  useEffect(() => {
    if (
      loadedDetailKey !== detailTopicStateKey ||
      !pendingReplyOrderScrollRef.current ||
      repliesLoading ||
      repliesError
    )
      return;
    const firstReplyIndex = topicListItems.findIndex(
      (listItem) => listItem.type === 'reply' || listItem.type === 'replyStart'
    );
    if (firstReplyIndex < 0) return;
    pendingReplyOrderScrollRef.current = false;
    recordScrollCommand('reply-order', { targetIndex: firstReplyIndex });
    topicScrollRef.current?.scrollToIndex({ animated: true, index: firstReplyIndex, viewPosition: 0 });
  }, [
    detailTopicStateKey,
    loadedDetailKey,
    recordScrollCommand,
    repliesError,
    repliesLoading,
    topicListItems,
    topicScrollRef
  ]);
  const targetReplyIdentity =
    activeLocation?.kind === 'opening'
      ? 'opening'
      : typeof activeTargetReply?.commentId === 'number'
        ? `comment:${activeTargetReply.commentId}:${activeTargetReply.expectedAuthorUsername ?? ''}`
        : typeof activeTargetReply?.floor === 'number'
          ? `floor:${activeTargetReply.floor}:${activeTargetReply.expectedAuthorUsername ?? ''}`
          : '';
  const targetReplyCommandKey = replyLocationCommand
    ? `request:${replyLocationCommand.requestId}`
    : targetReplyIdentity
      ? typeof locationRequestId === 'number'
        ? `route-request:${locationRequestId}`
        : `route:${targetReplyIdentity}`
      : '';
  const resolvedTargetReplyKey = useMemo(() => {
    if (activeTargetReply?.readingResume && read.readingEntry?.windowReady === false) return null;
    const reply =
      activeTargetReply &&
      (findReplyLocation(sourceReplies, activeTargetReply) ||
        (activeTargetReply.readingResume
          ? findReadingResumeReply(sourceReplies, activeTargetReply.floor || 1)
          : undefined));
    return reply ? getReplyKey(reply) : null;
  }, [activeTargetReply, read.readingEntry?.windowReady, sourceReplies]);
  const targetReplyListIndex = useMemo(() => {
    const target = resolvedTargetReplyKey;
    return targetReplyCommandKey && target
      ? topicListItems.findIndex(
          (listItem) =>
            (listItem.type === 'reply' || listItem.type === 'replyStart') && getReplyKey(listItem.reply) === target
        )
      : -1;
  }, [resolvedTargetReplyKey, targetReplyCommandKey, topicListItems]);
  const targetIsOpeningPost = activeLocation?.kind === 'opening';
  const handledTargetReplyRef = useRef('');
  const pendingTargetPositionRef = useRef<{
    topicKey: string;
    commandKey: string;
    rowKey?: string;
    offset: number;
    highlight: boolean;
  } | null>(null);
  const nativeViewportRef = useRef({ topicKey: detailTopicStateKey, offset: 0, height: 0 });
  const revealCommentSearch = useCallback(() => {
    const request = ++commentSearchMeasureRequestRef.current;
    if (!commentSearchScopeRef.current || !Keyboard.isVisible()) return;
    const container = commentSearchContainerRef.current;
    const scroller = topicScrollRef.current?.getNativeScrollRef()?.getNativeScrollRef();
    if (!container || !scroller) return;
    container.measureInWindow((_x, y, _width, height) => {
      const keyboard = Keyboard.metrics();
      if (!keyboard || y + height + 12 <= keyboard.screenY) return;
      // Android can scroll for focus before FlashList accepts that offset.
      container.measureLayout(scroller, (_left, contentY, _contentWidth, contentHeight) => {
        scroller.measureInWindow((_scrollX, viewportY, _viewportWidth, viewportHeight) => {
          const currentKeyboard = Keyboard.metrics();
          if (
            !currentKeyboard ||
            !commentSearchScopeRef.current ||
            request !== commentSearchMeasureRequestRef.current ||
            container !== commentSearchContainerRef.current ||
            scroller !== topicScrollRef.current?.getNativeScrollRef()?.getNativeScrollRef()
          )
            return;
          const visibleHeight = Math.min(viewportHeight, currentKeyboard.screenY - viewportY);
          if (visibleHeight <= 0) return;
          topicScrollRef.current?.scrollToOffset({
            animated: false,
            offset: Math.max(0, contentY + contentHeight + 12 - visibleHeight)
          });
        });
      });
    });
  }, [commentSearchScopeRef, topicScrollRef]);
  useLayoutEffect(() => {
    if (commentSearchActive) revealCommentSearch();
  }, [commentSearchActive, revealCommentSearch]);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', revealCommentSearch);
    return () => subscription.remove();
  }, [revealCommentSearch]);
  const targetHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedTargetKey, setHighlightedTargetKey] = useState('');
  useEffect(() => {
    handledTargetReplyRef.current = '';
    pendingTargetPositionRef.current = null;
    if (targetHighlightTimerRef.current) clearTimeout(targetHighlightTimerRef.current);
    setHighlightedTargetKey('');
  }, [detailTopicStateKey, targetReplyCommandKey]);
  const confirmTargetPosition = useCallback(() => {
    const pending = pendingTargetPositionRef.current;
    const viewport = nativeViewportRef.current;
    if (
      !active ||
      loadedDetailKey !== detailTopicStateKey ||
      !pending ||
      pending.topicKey !== detailTopicStateKey ||
      pending.commandKey !== targetReplyCommandKey ||
      viewport.topicKey !== detailTopicStateKey ||
      viewport.height <= 0
    )
      return;
    let position = -viewport.offset;
    if (pending.rowKey) {
      const index = topicListItems.findIndex((item) => item.key === pending.rowKey);
      if (index < 0) return;
      const layout = topicScrollRef.current?.getLayout(index);
      if (!layout || layout.height <= 0) return;
      position =
        (topicScrollRef.current?.getFirstItemOffset() || 0) +
        layout.y +
        Math.min(pending.offset, Math.max(0, layout.height - 1)) -
        viewport.offset;
    }
    const roundedPosition = PixelRatio.roundToNearestPixel(position);
    if (
      roundedPosition < PixelRatio.roundToNearestPixel(-1) ||
      roundedPosition >= PixelRatio.roundToNearestPixel(viewport.height)
    )
      return;
    pendingTargetPositionRef.current = null;
    if (pending.highlight) {
      setHighlightedTargetKey(pending.commandKey);
      targetHighlightTimerRef.current = setTimeout(() => setHighlightedTargetKey(''), 1800);
    }
    read.readingEntry?.positioned();
  }, [
    active,
    detailTopicStateKey,
    loadedDetailKey,
    read.readingEntry,
    targetReplyCommandKey,
    topicListItems,
    topicScrollRef
  ]);
  const onListViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const previous = nativeViewportRef.current;
      nativeViewportRef.current = {
        topicKey: detailTopicStateKey,
        offset: previous.topicKey === detailTopicStateKey ? previous.offset : 0,
        height: event.nativeEvent.layout.height
      };
      confirmTargetPosition();
      revealCommentSearch();
    },
    [confirmTargetPosition, detailTopicStateKey, revealCommentSearch]
  );
  useEffect(() => {
    setReplyLocationCommand(null);
  }, [
    detailTopicStateKey,
    location?.kind,
    targetReply?.commentId,
    targetReply?.floor,
    targetReply?.pageHint,
    targetReply?.expectedAuthorUsername,
    locationRequestId
  ]);
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
    if (!active || loadedDetailKey !== detailTopicStateKey || !targetReplyCommandKey || !canShowReplies) return;
    if (handledTargetReplyRef.current === targetReplyCommandKey) {
      confirmTargetPosition();
      return;
    }
    if (commentQuery || replyFilter !== 'all') {
      onCommentQueryChange('');
      onReplyFilterChange('all');
      return;
    }
    if (targetIsOpeningPost) {
      handledTargetReplyRef.current = targetReplyCommandKey;
      const anchor = read.readingEntry?.anchor;
      const index = anchor?.rowKey
        ? topicListItems.findIndex(
            (item) => item.key === anchor.rowKey && topicListReadingRevision(item) === anchor.revision
          )
        : -1;
      pendingTargetPositionRef.current = {
        topicKey: detailTopicStateKey,
        commandKey: targetReplyCommandKey,
        rowKey: index >= 0 ? topicListItems[index].key : undefined,
        offset: index >= 0 ? anchor?.offset || 0 : 0,
        highlight: false
      };
      recordScrollCommand(anchor ? 'reading-resume' : 'opening', {
        ...(index >= 0 ? { targetIndex: index } : {}),
        offset: index >= 0 ? anchor?.offset || 0 : 0
      });
      if (index >= 0)
        void topicScrollRef.current?.scrollToIndex({ animated: false, index, viewOffset: anchor?.offset || 0 });
      else
        void topicScrollRef.current?.scrollToIndex({
          animated: false,
          index: 0,
          viewOffset: 0 - (topicScrollRef.current?.getFirstItemOffset() || 0)
        });
      confirmTargetPosition();
      return;
    }
    if (targetReplyListIndex >= 0) {
      handledTargetReplyRef.current = targetReplyCommandKey;
      const anchor = activeTargetReply?.readingResume ? read.readingEntry?.anchor : undefined;
      const rowIndex = anchor?.rowKey
        ? topicListItems.findIndex(
            (item) => item.key === anchor.rowKey && topicListReadingRevision(item) === anchor.revision
          )
        : -1;
      pendingTargetPositionRef.current = {
        topicKey: detailTopicStateKey,
        commandKey: targetReplyCommandKey,
        rowKey: topicListItems[rowIndex >= 0 ? rowIndex : targetReplyListIndex].key,
        offset: rowIndex >= 0 ? anchor?.offset || 0 : 0,
        highlight: !activeTargetReply?.readingResume
      };
      recordScrollCommand(activeTargetReply?.readingResume ? 'reading-resume' : 'reply-location', {
        targetIndex: rowIndex >= 0 ? rowIndex : targetReplyListIndex,
        offset: rowIndex >= 0 ? anchor?.offset || 0 : 0
      });
      void topicScrollRef.current?.scrollToIndex({
        animated: !activeTargetReply?.readingResume,
        index: rowIndex >= 0 ? rowIndex : targetReplyListIndex,
        viewPosition: 0,
        viewOffset: rowIndex >= 0 ? anchor?.offset || 0 : 0
      });
      confirmTargetPosition();
    }
  }, [
    active,
    activeTargetReply?.readingResume,
    canShowReplies,
    commentQuery,
    confirmTargetPosition,
    detailTopicStateKey,
    loadedDetailKey,
    onCommentQueryChange,
    onReplyFilterChange,
    read.readingEntry,
    recordScrollCommand,
    replyFilter,
    targetIsOpeningPost,
    targetReplyCommandKey,
    targetReplyListIndex,
    topicListItems,
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
    stopReplyScroll();
    if (acceptedAnswerListIndex < 0) {
      pendingAcceptedAnswerScrollRef.current = true;
      onCommentQueryChange('');
      onReplyFilterChange('all');
      return;
    }
    recordScrollCommand('accepted-answer', { targetIndex: acceptedAnswerListIndex });
    topicScrollRef.current?.scrollToIndex({ animated: true, index: acceptedAnswerListIndex });
  }, [
    acceptedAnswerListIndex,
    onCommentQueryChange,
    onReplyFilterChange,
    recordScrollCommand,
    stopReplyScroll,
    topicScrollRef
  ]);
  useEffect(() => {
    if (!pendingAcceptedAnswerScrollRef.current || acceptedAnswerListIndex < 0) {
      return;
    }
    pendingAcceptedAnswerScrollRef.current = false;
    stopReplyScroll();
    recordScrollCommand('accepted-answer', { targetIndex: acceptedAnswerListIndex });
    topicScrollRef.current?.scrollToIndex({ animated: true, index: acceptedAnswerListIndex });
  }, [acceptedAnswerListIndex, recordScrollCommand, stopReplyScroll, topicScrollRef]);
  const readingSessionRef = useRef<ReadingSession | null>(null);
  const readingVisibleRef = useRef<{ index?: number | null; item: TopicListItem }[]>([]);
  const readingScrollOffset = useRef(0);
  const readingDisplayedRows = useRef<ReadonlySet<string>>(new Set());
  const reportReadingVisible = useCallback(() => {
    const visible = readingVisibleRef.current.flatMap(({ item, index }) => {
      if (topicListReadingNeedsDisplayedMedia(item) && !readingDisplayedRows.current.has(item.key)) return [];
      const floor = topicListReadingFloor(item, topic?.acceptedAnswerFloor);
      return floor ? [{ floor, rowKey: item.key, revision: topicListReadingRevision(item), index }] : [];
    });
    const first = visible[0];
    const layout =
      first?.index === undefined || first.index === null ? undefined : topicScrollRef.current?.getLayout?.(first.index);
    readingSessionRef.current?.visible(
      visible.map(({ floor }) => floor),
      first
        ? {
            floor: first.floor,
            rowKey: first.rowKey,
            revision: first.revision,
            offset: layout
              ? Math.max(
                  0,
                  readingScrollOffset.current - (topicScrollRef.current?.getFirstItemOffset?.() || 0) - layout.y
                )
              : 0
          }
        : undefined
    );
  }, [topic?.acceptedAnswerFloor, topicScrollRef]);
  const reportDisplayedRows = useCallback(
    (rows: ReadonlySet<string>) => {
      readingDisplayedRows.current = rows;
      reportReadingVisible();
    },
    [reportReadingVisible]
  );
  const readingScope = read.readingRuntime?.scope();
  useLayoutEffect(() => {
    const session = read.readingRuntime?.begin(selectedTopic.id);
    readingSessionRef.current = session || null;
    reportReadingVisible();
    return () => {
      session?.end();
      readingSessionRef.current = null;
    };
  }, [read.readingRuntime, readingScope, reportReadingVisible, selectedTopic.id]);
  useLayoutEffect(() => {
    if (!read.readingRuntime) return;
    // FlashList reports index changes, so a new item at the same index needs a fresh observation.
    readingVisibleRef.current = readingVisibleRef.current.flatMap(({ item, index }) => {
      const current = typeof index === 'number' ? topicListItems[index] : undefined;
      return current?.key === item.key ? [{ item: current, index }] : [];
    });
    reportReadingVisible();
    topicScrollRef.current?.recomputeViewableItems?.();
  }, [read.readingRuntime, reportReadingVisible, topicListItems, topicScrollRef]);
  const readingPositionReady = read.readingEntry?.ready !== false && read.readingEntry?.positionReady !== false;
  useEffect(() => {
    readingSessionRef.current?.active(
      Boolean(
        active &&
        topic &&
        !topicShowsAccessNotice &&
        readingPositionReady &&
        !readingPaused &&
        !bodyMediaPaused &&
        loadedDetailKey === detailTopicStateKey
      )
    );
  }, [
    active,
    bodyMediaPaused,
    readingPaused,
    read.readingRuntime,
    reportReadingVisible,
    readingPositionReady,
    topic,
    topicShowsAccessNotice,
    loadedDetailKey,
    detailTopicStateKey,
    readingScope
  ]);
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index?: number | null; isViewable?: boolean; item: TopicListItem }[] }) => {
      observeViewableItems({ viewableItems });
      readingVisibleRef.current = viewableItems
        .filter((item) => item.isViewable !== false)
        .sort((a, b) => (a.index || 0) - (b.index || 0));
      reportReadingVisible();
      confirmTargetPosition();
    },
    [confirmTargetPosition, observeViewableItems, reportReadingVisible]
  );
  const beginReplyScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      handledTargetReplyRef.current = targetReplyCommandKey;
      pendingTargetPositionRef.current = null;
      onCancelReplyLocation();
      readingSessionRef.current?.interact();
      const event: NativeScrollEvent & { contentOffsetCorrection?: { y: number } } = nativeEvent;
      Object.assign(replyScroll.current, {
        phase: 'drag',
        momentum: true,
        offset: event.contentOffset.y,
        correction: event.contentOffsetCorrection?.y || 0,
        start: '',
        end: ''
      });
    },
    [onCancelReplyLocation, targetReplyCommandKey]
  );
  const advanceReplyScroll = useCallback(
    (event: NativeScrollEvent & { contentOffsetCorrection?: { y: number } }) => {
      const scroll = replyScroll.current;
      const correction = event.contentOffsetCorrection?.y || 0;
      const movement = Math.round(
        (event.contentOffset.y - scroll.offset - (correction - scroll.correction)) * PixelRatio.get()
      );
      scroll.offset = event.contentOffset.y;
      scroll.correction = correction;
      if (
        !active ||
        scroll.phase === 'idle' ||
        movement === 0 ||
        replyLoadPending.current ||
        loadingMoreReplies ||
        loadingPreviousReplies
      )
        return;
      const { contentOffset, contentSize, layoutMeasurement } = event;
      if (layoutMeasurement.height <= 0) return;
      let load: (() => ReturnType<typeof onLoadPreviousReplies>) | undefined;
      if (movement < 0 && replyHasPrevious && !replyStartError && replyWindowStartIndex >= 0) {
        const layout = topicScrollRef.current?.getLayout(replyWindowStartIndex);
        if (!layout) return;
        const boundary = (topicScrollRef.current?.getFirstItemOffset() || 0) + layout.y;
        const cursor = `${read.replyPreviousCursor?.page}:${read.replyPreviousCursor?.offset}`;
        if (
          contentOffset.y + layoutMeasurement.height < boundary ||
          contentOffset.y - boundary > REPLY_START_REACHED_THRESHOLD * layoutMeasurement.height ||
          scroll.start === cursor
        )
          return;
        scroll.start = cursor;
        load = onLoadPreviousReplies;
      } else if (movement > 0 && replyHasMore && !replyEndError) {
        const cursor = `${read.replyNextPage}:${read.replyNextOffset}`;
        if (
          contentOffset.y + layoutMeasurement.height <
            contentSize.height - REPLY_END_REACHED_THRESHOLD * layoutMeasurement.height ||
          scroll.end === cursor
        )
          return;
        scroll.end = cursor;
        load = onLoadMoreReplies;
      }
      if (!load) return;
      replyLoadPending.current = true;
      void load().finally(() => {
        replyLoadPending.current = false;
      });
    },
    [
      active,
      loadingMoreReplies,
      loadingPreviousReplies,
      onLoadMoreReplies,
      onLoadPreviousReplies,
      read.replyNextOffset,
      read.replyNextPage,
      read.replyPreviousCursor,
      replyEndError,
      replyHasMore,
      replyHasPrevious,
      replyStartError,
      replyWindowStartIndex,
      topicScrollRef
    ]
  );
  const requestWindowStartLoad = useCallback(() => {
    stopReplyScroll();
    void onLoadPreviousReplies();
  }, [onLoadPreviousReplies, stopReplyScroll]);
  const requestWindowEndLoad = useCallback(() => {
    stopReplyScroll();
    void onLoadMoreReplies();
  }, [onLoadMoreReplies, stopReplyScroll]);
  useLayoutEffect(() => {
    stopReplyScroll();
  }, [
    active,
    detailTopicStateKey,
    mediaSessionIdentity,
    replyFilter,
    replyOrder,
    commentQuery,
    stopReplyScroll,
    targetReplyCommandKey
  ]);
  useEffect(() => {
    pendingAcceptedAnswerScrollRef.current = false;
  }, [item?.id, item?.source]);
  const tableStyles = useMemo(() => createTopicTableStyles(theme), [theme]);
  const tableRenderers = useMemo(
    () =>
      createTopicTableRenderers({
        minColumnWidth: Math.round(
          96 *
            (typeof htmlBaseStyle.fontSize === 'number' && htmlBaseStyle.fontSize > 0 ? htmlBaseStyle.fontSize / 16 : 1)
        ),
        styles: tableStyles
      }),
    [htmlBaseStyle.fontSize, tableStyles]
  );
  const genericHtmlRenderers = useMemo<HtmlRenderers>(() => {
    return {
      ...htmlRenderers,
      ...tableRenderers,
      [NODESEEK_STARDUST_PLACEHOLDER_TAG]: NodeSeekStardustRenderer,
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
  }, [htmlRenderers, tableRenderers]);
  const renderTopicListItemFrame = useCallback(
    (children: ReactNode, key?: string, onLayout?: (event: LayoutChangeEvent) => void) => {
      const frame = (
        <TopicListItemFrame
          firstRowStartedAt={key && key === firstOpeningRowKey ? firstOpeningRowStartedAt : undefined}
          selectionRowKey={key && topicSelectionRowKeys.has(key) ? key : undefined}
          style={styles.topicListItemFrame}
          onLayout={onLayout}
        >
          {children}
        </TopicListItemFrame>
      );
      return key ? (
        <TopicBodyMediaRowBoundary rowKey={key}>
          <OriginalImageUpgradeBoundary enabled={bodyMediaViewportRowKeySet.has(key)}>
            {frame}
          </OriginalImageUpgradeBoundary>
        </TopicBodyMediaRowBoundary>
      ) : (
        frame
      );
    },
    [bodyMediaViewportRowKeySet, firstOpeningRowKey, firstOpeningRowStartedAt, styles, topicSelectionRowKeys]
  );
  const TopicListItemSeparator = useCallback(
    ({ leadingItem, trailingItem }: { leadingItem: TopicListItem; trailingItem: TopicListItem }) => {
      if (leadingItem.type === 'topicHeader' || trailingItem.type === 'topicHeader') return null;
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
      if (
        leadingItem.type === 'topicContent' &&
        trailingItem.type === 'topicContent' &&
        leadingItem.content.type !== 'poll' &&
        trailingItem.content.type !== 'poll'
      ) {
        return null;
      }
      const height =
        leadingItem.type === 'topicContent' ||
        leadingItem.type === 'topicQuoteSummary' ||
        leadingItem.type === 'topicQuoteContent' ||
        leadingItem.type === 'topicAcceptedAnswer' ||
        leadingItem.type === 'topicPostlude' ||
        trailingItem.type === 'topicContent' ||
        trailingItem.type === 'topicQuoteSummary' ||
        trailingItem.type === 'topicQuoteContent' ||
        trailingItem.type === 'topicAcceptedAnswer' ||
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
        quoteBodyFirst?: boolean;
        quoteBodyLast?: boolean;
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
          ? undefined
          : context === 'quote'
            ? options?.quoteBodyFirst
              ? [styles.quoteBody, styles.quotePanelBody]
              : undefined
            : frameKey === firstArticleBodyKey
              ? styles.articleBody
              : undefined;
      const contentContainerStyle = [baseContentContainerStyle, trimLeadingStyle, trimTrailingStyle];
      const baseRowStyle =
        context === 'quote'
          ? [
              styles.replyListItem,
              styles.quoteBox,
              options?.quoteBodyLast ? styles.quoteRowBottom : styles.quoteRowContinuation,
              topicColumnStyle
            ]
          : [styles.replyListItem, topicColumnStyle];
      const rowStyle = [baseRowStyle, trimLeadingStyle, trimTrailingStyle];
      const wrapContent = (children: ReactNode) => {
        const content = (
          <View key={frameKey} style={contentContainerStyle}>
            {children}
          </View>
        );
        if (context === 'accepted') return content;
        return renderTopicListItemFrame(<View style={rowStyle}>{content}</View>, frameKey);
      };
      if (contentItem.type === 'accessNotice') {
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            <View style={styles.topicAccessNotice}>
              {contentItem.label ? (
                <Text style={[styles.topicAccessBadge, styles.topicAccessNoticeBadge]}>{contentItem.label}</Text>
              ) : null}
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
            onLockPoll={onLockPoll}
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
              referrerPolicy={contentItem.row.referrerPolicy}
              src={contentItem.row.src}
              theme={theme}
            />
          );
        }
        const resolvedHtml = 'html' in contentItem.row ? contentItem.row.html : undefined;
        return wrapContent(
          <TopicSplitDisclosureScope scopeKey={options?.scopeKey || 'opening'}>
            <TopicSelectionRenderHtmlConfig
              renderers={genericHtmlRenderers}
              renderersProps={htmlRenderersProps}
              selectable={context === 'accepted' ? false : undefined}
            >
              <MemoizedTopicContentBlock
                contentWidth={context === 'topic' ? contentWidth : Math.max(220, contentWidth - 24)}
                html={
                  resolvedHtml === undefined || context === 'topic'
                    ? resolvedHtml
                    : highlightHtml(resolvedHtml, replyHighlightQuery)
                }
                query={context === 'topic' ? '' : replyHighlightQuery}
                row={contentItem.row}
                selectable={context === 'accepted' ? false : undefined}
              />
            </TopicSelectionRenderHtmlConfig>
          </TopicSplitDisclosureScope>
        );
      }

      if (contentItem.type === 'quoteSummary') return null;
      return null;
    },
    [
      actionBusy,
      contentWidth,
      decisionFor,
      firstArticleBodyKey,
      genericHtmlRenderers,
      htmlRenderersProps,
      mediaContext,
      mediaSessionIdentity,
      nodeSeekMediaUserAgent,
      onLockPoll,
      onVotePoll,
      pollSelections,
      replyHighlightQuery,
      renderTopicListItemFrame,
      styles,
      theme,
      togglePollSelection,
      topic?.source,
      topicColumnStyle
    ]
  );

  const topicPostlude = useMemo(() => {
    void detailTopicStateKey;
    const policy = topic?.source === 'linuxdo' ? topic.policy : undefined;
    const policySubmission = policy ? policySubmissions[policy.postId] : undefined;
    return (
      <>
        {policy
          ? renderTopicListItemFrame(
              <View style={[styles.replyListItem, topicColumnStyle]}>
                <DiscoursePolicyPanel
                  policy={policy}
                  busy={actionBusy}
                  disabled={!decisionFor({ action: 'policy' }).allowed || policySubmission?.version === policy.version}
                  status={
                    policySubmission?.version === policy.version ? '操作已提交，请刷新公告核对阅读状态' : undefined
                  }
                  onSetAcceptance={(accepted) => void onSetPolicyAcceptance(policy, accepted)}
                />
              </View>,
              'topic-policy'
            )
          : null}
        {legacyTopicPollsVisible
          ? renderTopicListItemFrame(
              <View style={[styles.replyListItem, topicColumnStyle]}>
                <View style={styles.articleBody}>
                  <TopicPolls
                    actionBusy={actionBusy}
                    decisionFor={decisionFor}
                    embeddedInArticle
                    keyPrefix="topic"
                    onLockPoll={onLockPoll}
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
                      icon={Ham}
                      iconSize={20}
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
                      accessibilityLabel={topic?.collected ? '取消收藏' : '收藏'}
                      count={topic?.collectionCount}
                      icon={Bookmark}
                      activeIcon={BookmarkCheck}
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
                    <LinuxDoReactionButton
                      post={topic!}
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
                    <LinuxDoBoostButton post={topic!} styles={styles} theme={theme} disabled={actionBusy} />
                    <DetailActionButton
                      active={Boolean(topic?.bookmarked)}
                      tone="favorite"
                      accessibilityLabel={topic?.bookmarked ? '取消收藏' : '收藏'}
                      icon={Bookmark}
                      activeIcon={BookmarkCheck}
                      label="收藏"
                      pending={bookmarkDecision.reason === 'pending'}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy || !bookmarkDecision.allowed}
                      onPress={onDiscourseBookmark}
                    />
                  </View>
                ) : null}
                {topic?.source === 'linuxdo' ? <LinuxDoBoosts post={topic} /> : null}
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
    onLockPoll,
    onNodeSeekCollection,
    onYaohuoFavorite,
    onVotePoll,
    onSetPolicyAcceptance,
    policySubmissions,
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

  const listHeader = useMemo(() => {
    if (!item) return null;
    const topicHeaderStatusBadges = topicStatusBadges(item);
    const itemAccessRequirementText = forumAccessRequirementText(item.accessRequirement);
    return (
      <View style={[styles.topicHeaderStack, titleOnlyV2ex && styles.titleOnlyHeaderStack]}>
        <View style={[styles.article, topicColumnStyle]}>
          {topic || topicError?.reason !== 'site-notice' ? (
            <View style={[styles.topicMetaStack, titleOnlyV2ex && styles.titleOnlyMetaStack]}>
              {!titleOnlyV2ex ? (
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
              ) : null}
              <Text
                selectable
                style={[styles.articleTitle, titleOnlyV2ex && styles.titleOnlyTitle]}
                textBreakStrategy={titleOnlyV2ex ? 'balanced' : undefined}
              >
                {item.title}
              </Text>
              <Pressable
                testID="topic-author"
                accessibilityRole="button"
                disabled={!userFromTopic(item)}
                style={[styles.topicAuthorRow, titleOnlyV2ex && styles.titleOnlyAuthorRow]}
                onPress={() => {
                  const user = userFromTopic(item);
                  if (user) {
                    onOpenUser(user);
                  }
                }}
              >
                <Avatar contentSource={item.source} name={item.author} uri={item.authorAvatar} small={titleOnlyV2ex} />
                <View style={styles.topicAuthorMeta}>
                  <View style={styles.replyAuthorNameRow}>
                    <Text style={[styles.replyAuthor, titleOnlyV2ex && styles.titleOnlyAuthorName]} numberOfLines={1}>
                      {item.author || '未知作者'}
                    </Text>
                    {item.authorLevelLabel ? (
                      <Text
                        style={[styles.replyContextBadge, replyContextBadgeStyle('neutral', theme)]}
                        numberOfLines={1}
                      >
                        {item.authorLevelLabel}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.meta, titleOnlyV2ex && styles.titleOnlyAuthorDate]}>
                    {formatDateTime(item.createdAt)}
                    {typeof item.replyCount === 'number' ? ` · ${item.replyCount} 回复` : ''}
                    {item.viewCount ? ` · ${item.viewCount} 浏览` : ''}
                    {titleOnlyV2ex && topic.upvoteCount ? ` · ${topic.upvoteCount} UP 票` : ''}
                  </Text>
                </View>
              </Pressable>
              {itemAccessRequirementText ? (
                <Text style={styles.topicAccessBadge}>{itemAccessRequirementText}</Text>
              ) : null}
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
                    <View
                      key={`${tag}-${index}`}
                      style={[styles.topicTagPill, !titleOnlyV2ex && topicTagColorStyle(tag, theme, item.tags)]}
                    >
                      <Text
                        style={[styles.topicTagText, !titleOnlyV2ex && topicTagTextColorStyle(tag, theme, item.tags)]}
                        numberOfLines={1}
                      >
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {headerState}
          {topic && !topicError && !readingPositionReady ? <LoadingState text="正在读取主题..." /> : null}
        </View>
      </View>
    );
  }, [
    headerState,
    item,
    onOpenUser,
    readingPositionReady,
    styles,
    theme,
    titleOnlyV2ex,
    topic,
    topicColumnStyle,
    topicError
  ]);

  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(
    ({ index, item: listItem }) => {
      if (listItem.type === 'topicHeader') return listHeader;
      if (listItem.type === 'topicContent') {
        return renderTopicContentItem(listItem.content);
      }
      if (listItem.type === 'topicQuoteSummary') {
        const { instanceKey, quote } = listItem.content;
        const { reference } = quote;
        const quotedPost = replyForQuotedPost(reference, itemSource, item?.id, repliesByFloor, loadedQuotedReplies);
        const expanded = Boolean(expandedQuotes[instanceKey]);
        const sameTopic = reference.source === itemSource && reference.topicId === item?.id;
        const quotedTopic = sameTopic ? null : topicForQuotedPost(quote, item?.url);
        const canOpenReference = sameTopic || Boolean(quotedTopic);
        const openReference = () => {
          if (sameTopic) {
            requestReplyLocation({ floor: reference.postNumber });
          } else if (quotedTopic) {
            onOpenTopic(quotedTopic, topicLocationForReply(reference.source, { floor: reference.postNumber }));
          }
        };
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            <TopicBodyQuoteCard
              completeContentMountedExternally={expanded && Boolean(quotedPost)}
              expanded={expanded}
              header={
                <>
                  <Avatar
                    contentSource={reference.source}
                    small
                    name={quote.author?.label}
                    uri={quote.author?.avatar || quotedPost?.authorAvatar}
                  />
                  <Pressable
                    accessibilityLabel={`${quote.author?.label || '引用内容'}，${
                      sameTopic
                        ? `定位引用回复，第 ${reference.postNumber} 楼`
                        : `打开引用楼层，第 ${reference.postNumber} 楼`
                    }`}
                    accessibilityRole={canOpenReference ? 'button' : undefined}
                    disabled={!canOpenReference}
                    style={[styles.quoteAuthorTextBlock, styles.quoteTopicLink]}
                    onPress={openReference}
                  >
                    <Text style={styles.quoteAuthorText} numberOfLines={1}>
                      {quote.author?.label || '引用内容'}
                    </Text>
                    <Text style={[styles.replyMeta, styles.quoteMeta]} numberOfLines={1}>
                      引用 #{reference.postNumber}
                    </Text>
                  </Pressable>
                </>
              }
              loading={Boolean(loadingQuotedFloors[instanceKey])}
              preview={quote.preview ? <Text style={styles.quotePreviewText}>{quote.preview}</Text> : undefined}
              previewTestID={`topic-quote-preview-${reference.topicId}-${reference.postNumber}`}
              styles={styles}
              testID={`topic-quote-${reference.topicId}-${reference.postNumber}`}
              theme={theme}
              title={
                quote.topicTitle ? (
                  <Pressable
                    accessibilityLabel={
                      sameTopic
                        ? `定位引用主题，${quote.topicTitle}，第 ${reference.postNumber} 楼`
                        : `打开引用主题，${quote.topicTitle}`
                    }
                    accessibilityRole={canOpenReference ? 'button' : undefined}
                    disabled={!canOpenReference}
                    style={styles.quoteTopicLink}
                    onPress={openReference}
                  >
                    <Text style={styles.quoteTopicLinkText} numberOfLines={2}>
                      {quote.topicTitle}
                    </Text>
                  </Pressable>
                ) : undefined
              }
              onToggle={() => onToggleTopicBodyQuote({ instanceKey, reference, quotedPost })}
            />
          </View>,
          listItem.key
        );
      }
      if (listItem.type === 'topicQuoteContent') {
        const previousItem = topicListItems[index - 1];
        const nextItem = topicListItems[index + 1];
        return renderTopicContentItem(listItem.content, {
          context: 'quote',
          frameKey: listItem.key,
          quoteBodyFirst:
            previousItem?.type !== 'topicQuoteContent' || previousItem.instanceKey !== listItem.instanceKey,
          quoteBodyLast: nextItem?.type !== 'topicQuoteContent' || nextItem.instanceKey !== listItem.instanceKey,
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
            >
              {listItem.content.length ? (
                <TopicCopySurface onCopy={copyAcceptedAnswerToClipboard}>
                  {listItem.content.map((content) =>
                    renderTopicContentItem(content, {
                      context: 'accepted',
                      frameKey: `${listItem.key}:${content.key}`,
                      scopeKey: 'accepted-answer',
                      source: topic.source
                    })
                  )}
                </TopicCopySurface>
              ) : null}
            </AcceptedAnswerPreview>
          </View>,
          listItem.key
        );
      }
      if (listItem.type === 'topicPostlude') {
        return topicPostlude;
      }
      if (listItem.type === 'replyControls') {
        return renderTopicListItemFrame(
          <View style={[styles.replyHeader, topicColumnStyle]}>
            <View style={styles.sectionHeader}>
              <Text style={titleOnlyV2ex ? styles.panelTitle : styles.sectionTitle}>
                {titleOnlyV2ex ? '回复' : '回复列表'}
                {typeof replyDisplayCount === 'number' ? (
                  <Text style={styles.countText}> {replyDisplayCount} 条</Text>
                ) : null}
              </Text>
            </View>
            {repliesPartialStatus ? (
              <Text style={[styles.noticeText, titleOnlyV2ex && styles.titleOnlyNoticeText]}>
                {repliesPartialStatus}
              </Text>
            ) : null}
            {!endedEmpty ? (
              <>
                <View style={styles.replySelectionRow}>
                  <View style={styles.replyFilterRailSlot}>
                    <PillRail
                      layout="wrap"
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
                        style={styles.replyOrderButton}
                        onPress={openReplyOrderMenu}
                      >
                        <Text style={styles.replyOrderButtonText}>{replyOrderLabel}</Text>
                        <ChevronDown size={14} color={theme.primary} strokeWidth={1.8} />
                      </Pressable>
                      <PopupMenu
                        accessibilityLabel="关闭回复排序菜单"
                        placementStyle={replyOrderMenuPlacement}
                        visible={active && replyOrderMenuOpen}
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
                {read.hasNewReplies ? (
                  <Text style={styles.noticeText}>有新回复</Text>
                ) : unreadReplyCount > 0 ? (
                  <Text style={styles.noticeText}>较上次多 {unreadReplyCount} 条回复</Text>
                ) : null}
                <View
                  ref={commentSearchContainerRef}
                  collapsable={false}
                  onLayout={revealCommentSearch}
                  onTouchStart={({ nativeEvent }) => {
                    commentSearchTouchRef.current = nativeEvent;
                  }}
                >
                  <View pointerEvents="none" style={styles.replySearchBackground} />
                  <Searchbar
                    ref={commentSearchRef}
                    testID="topic-reply-search"
                    accessibilityLabel="评论内查找"
                    searchAccessibilityLabel="查找评论"
                    icon={() => (
                      <View style={styles.replySearchIcon}>
                        <Search size={18} color={theme.muted} strokeWidth={1.8} accessible={false} />
                      </View>
                    )}
                    clearIcon={({ color }) => <X size={18} color={color} strokeWidth={1.8} />}
                    style={styles.replySearchShell}
                    inputStyle={styles.replySearchInput}
                    value={commentQuery}
                    onChange={recordUserInteraction}
                    onChangeText={onCommentQueryChange}
                    onFocus={() => onCommentSearchFocusChange(true)}
                    onBlur={() => onCommentSearchFocusChange(false)}
                    onIconPress={() => commentSearchRef.current?.focus()}
                    placeholder="评论内查找"
                    placeholderTextColor={theme.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    submitBehavior="blurAndSubmit"
                    right={() =>
                      commentQuery ? (
                        <IconButton
                          icon={X}
                          iconOnly
                          ghost
                          iconSize={18}
                          label="清空查找"
                          onPress={() => onCommentQueryChange('')}
                        />
                      ) : null
                    }
                  />
                </View>
              </>
            ) : null}
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
            highlightedTargetKey && getReplyKey(listItem.reply) === resolvedTargetReplyKey
              ? styles.replyLocationHighlight
              : undefined
          ]}
        >
          <TopicSelectionRenderHtmlConfig
            renderers={genericHtmlRenderers}
            renderersProps={htmlRenderersProps}
            selectable={false}
          >
            <MemoizedReplyItem
              actionBusy={actionBusy}
              bodyContent={listItem.type === 'reply' ? listItem.bodyContent : undefined}
              decisionFor={decisionFor}
              contentWidth={contentWidth}
              expandedQuotes={expandedQuotes}
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
              onLockPoll={onLockPoll}
              onOpenTopic={onOpenTopic}
              onQuoteContentLayout={markReplyQuoteContentLayout}
              onVotePoll={onVotePoll}
              onSetPolicyAcceptance={onSetPolicyAcceptance}
              policySubmission={listItem.reply.policy ? policySubmissions[listItem.reply.policy.postId] : undefined}
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
          </TopicSelectionRenderHtmlConfig>
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
      active,
      endedEmpty,
      closeReplyOrderMenu,
      commentQuery,
      copyAcceptedAnswerToClipboard,
      contentWidth,
      decisionFor,
      expandedQuotes,
      genericHtmlRenderers,
      highlightedTargetKey,
      htmlRenderersProps,
      listHeader,
      item?.author,
      item?.id,
      item?.url,
      loadedQuotedReplies,
      loadingPreviousReplies,
      loadingQuotedFloors,
      loadAcceptedAnswer,
      discourseEmojiUrls,
      read.hasNewReplies,
      newReplyFloorStart,
      onCommentQueryChange,
      onCommentSearchFocusChange,
      revealCommentSearch,
      onDeleteReply,
      onEditReply,
      onInteract,
      onLockPoll,
      onOpenTopic,
      onToggleTopicBodyQuote,
      openReplyOrderMenu,
      markReplyQuoteContentLayout,
      onReplyFilterChange,
      onReplyToFloor,
      onToggleReplyQuote,
      onOpenUser,
      onVotePoll,
      onSetPolicyAcceptance,
      policySubmissions,
      pollSelections,
      renderTopicContentItem,
      topicListItems,
      renderTopicListItemFrame,
      requestWindowStartLoad,
      requestReplyLocation,
      itemSource,
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
      titleOnlyV2ex,
      topic,
      resolvedTargetReplyKey,
      unreadReplyCount,
      detailTopicStateKey
    ]
  );

  if (!item) {
    return <EmptyText text="未选择主题" />;
  }

  return (
    <TRenderEngineProvider
      baseStyle={htmlBaseStyle}
      allowedStyles={HTML_ALLOWED_INLINE_STYLES}
      classesStyles={htmlClassesStyles}
      customHTMLElementModels={htmlCustomElementModels}
      emSize={typeof htmlBaseStyle.fontSize === 'number' ? htmlBaseStyle.fontSize : 16}
      enableUserAgentStyles
      ignoredStyles={htmlIgnoredStyles}
      tagsStyles={htmlTagsStyles}
      ignoredDomTags={HTML_IGNORED_DOM_TAGS}
    >
      <TopicSplitDisclosureProvider key={detailTopicStateKey} value={disclosureStore}>
        <TopicTableScrollProvider key={detailTopicStateKey}>
          <TopicBodyMediaCoordinatorProvider
            key={detailTopicStateKey}
            active={active}
            diagnosticSession={bodyMediaDiagnosticSession}
            onDiagnosticFinish={finishBodyMediaDiagnostic}
            onDisplayedRowsChange={read.readingRuntime ? reportDisplayedRows : undefined}
            paused={bodyMediaPaused}
            visibleRowKeys={bodyMediaVisibleRowKeys}
            viewportRowKeys={bodyMediaViewportRowKeys}
          >
            <TopicSelectionSurface
              active={Boolean(active)}
              items={topicSelectionItems}
              listRef={topicScrollRef}
              sessionKey={topicSelectionSessionKey}
            >
              <TopicSelectionRenderHtmlConfig
                actions={actions}
                renderers={genericHtmlRenderers}
                renderersProps={htmlRenderersProps}
              >
                {!readingPositionReady ? (
                  <ScrollView
                    overScrollMode="never"
                    style={[styles.content, styles.topicContent, StyleSheet.absoluteFill]}
                    contentContainerStyle={styles.topicContentInner}
                  >
                    {listHeader}
                  </ScrollView>
                ) : null}
                <FlashList
                  ref={topicScrollRef}
                  onLoad={onListLoad}
                  onLayout={onListViewportLayout}
                  onContentSizeChange={() => {
                    confirmTargetPosition();
                    revealCommentSearch();
                  }}
                  accessibilityLabel={topic ? '主题详情，已加载' : '主题详情'}
                  testID={topic ? 'topic-detail-loaded' : undefined}
                  style={[styles.content, styles.topicContent, !readingPositionReady && { opacity: 0 }]}
                  pointerEvents={readingPositionReady ? 'auto' : 'none'}
                  accessibilityElementsHidden={!readingPositionReady}
                  importantForAccessibility={readingPositionReady ? 'auto' : 'no-hide-descendants'}
                  contentContainerStyle={[
                    styles.topicContentInner,
                    { paddingBottom: Math.max(styles.topicContentInner.paddingBottom, bottomContentInset) }
                  ]}
                  data={topicListItems}
                  keyExtractor={topicListItemKey}
                  getItemType={topicListItemType}
                  ItemSeparatorComponent={TopicListItemSeparator}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  onTouchStart={({ nativeEvent }) => {
                    // Exempt the same bubbling touch from the search field and its controls.
                    if (commentSearchTouchRef.current !== nativeEvent) commentSearchRef.current?.blur();
                    commentSearchTouchRef.current = null;
                  }}
                  onScroll={(event) => {
                    const previousViewport = nativeViewportRef.current;
                    if (
                      previousViewport.topicKey === detailTopicStateKey &&
                      event.nativeEvent.layoutMeasurement.height > 0 &&
                      previousViewport.offset > event.nativeEvent.layoutMeasurement.height &&
                      event.nativeEvent.contentOffset.y <= 24
                    ) {
                      const nativeEvent: NativeScrollEvent & { contentOffsetCorrection?: { y: number } } =
                        event.nativeEvent;
                      const fields = {
                        source: item?.source,
                        topicRef: detailTopicDiagnosticRef,
                        previousOffset: previousViewport.offset,
                        offset: nativeEvent.contentOffset.y,
                        contentHeight: nativeEvent.contentSize.height,
                        viewportHeight: nativeEvent.layoutMeasurement.height,
                        correction: nativeEvent.contentOffsetCorrection?.y || 0,
                        scrollPhase: replyScroll.current.phase
                      };
                      const trace = beginDiagnosticTrace('topic', 'scroll-position', fields);
                      finishDiagnosticTrace(trace, 'success', fields);
                    }
                    nativeViewportRef.current = {
                      topicKey: detailTopicStateKey,
                      offset: event.nativeEvent.contentOffset.y,
                      height: event.nativeEvent.layoutMeasurement.height
                    };
                    confirmTargetPosition();
                    revealCommentSearch();
                    onScrollProgress?.(event);
                    readingScrollOffset.current = event.nativeEvent.contentOffset.y;
                    readingSessionRef.current?.interact();
                    reportReadingVisible();
                    advanceReplyScroll(event.nativeEvent);
                  }}
                  scrollEventThrottle={16}
                  onMomentumScrollBegin={() => {
                    if (replyScroll.current.phase === 'idle' && replyScroll.current.momentum)
                      replyScroll.current.phase = 'momentum';
                  }}
                  onMomentumScrollEnd={(event) => {
                    if (replyScroll.current.phase === 'momentum') {
                      replyScroll.current.phase = 'idle';
                      replyScroll.current.momentum = false;
                    }
                    onTopicScroll(event);
                  }}
                  onScrollEndDrag={(event) => {
                    replyScroll.current.phase = 'idle';
                    replyScroll.current.momentum = Boolean(event.nativeEvent.velocity?.y);
                    onTopicScroll(event);
                  }}
                  onScrollBeginDrag={beginReplyScroll}
                  onViewableItemsChanged={handleViewableItemsChanged}
                  extraData={listExtraData}
                  {...TOPIC_DETAIL_LIST_PERFORMANCE_PROPS}
                  maintainVisibleContentPosition={TOPIC_VISIBLE_CONTENT_POSITION}
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
              </TopicSelectionRenderHtmlConfig>
            </TopicSelectionSurface>
          </TopicBodyMediaCoordinatorProvider>
        </TopicTableScrollProvider>
      </TopicSplitDisclosureProvider>
    </TRenderEngineProvider>
  );
});
