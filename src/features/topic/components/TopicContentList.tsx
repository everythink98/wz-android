import { createTopicStyles, type TopicStyles } from '../styles';
import { memo, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import {
  HTMLContentModel,
  HTMLElementModel,
  RenderHTMLConfigProvider,
  TChildrenRenderer,
  TRenderEngineProvider,
  defaultHTMLElementModels,
  useTNodeChildrenProps,
  type CustomBlockRenderer
} from 'react-native-render-html';
import { BookMarked, ChevronDown, ChevronRight, Drumstick, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import type { Reply, SourceErrorInfo, Topic, TopicDetail, TopicPoll, UserReference } from '@/domain/forum/models';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { HtmlRenderers } from '../rendering/types';
import type { ReplyFilter } from '../model/types';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '@/domain/forum/presentation';
import { HTML_ALLOWED_INLINE_STYLES, trimsTrailingBlockSpacing } from '../rendering/htmlStyles';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG
} from '@/platform/media/inlineMedia';
import {
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_TERMINAL_TAB_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG
} from '@/domain/forum/html';
import { FORUM_REPLY_REFERENCE_TAG } from '@/domain/forum/topicContentHtml';
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
import { EmptyText } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { Avatar } from '@/ui/avatar/Avatar';
import { ForumContentVideo } from '@/ui/content/ForumContentVideo';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { topicWithAuthorFallback, userFromTopic } from '@/domain/forum/userNavigation';
import type { InteractionType } from '@/domain/forum/topicActionState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { splitDiscourseContentHtml } from '@/sources/discourse/content';
import { NODESEEK_POLL_PLACEHOLDER_TAG } from '@/sources/nodeseek/polls';
import { discourseReactionStats, type DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { linuxDoReactionStats } from '@/sources/linuxdo/reactions';
import {
  discourseQuotedPostReferenceFromAttributes,
  quotedPostReferenceKey,
  topicOpeningPostAsReply,
  topicQuotedPostInstanceKey
} from '@/domain/forum/quotedPosts';
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
  buildAcceptedAnswerPresentation,
  buildTopicOpeningContent,
  type TopicContentItem
} from '../model/topicOpeningPresentation';
import {
  buildReplyListItems,
  buildVirtualizedReplyItems,
  topicListItemSpacing,
  type TopicReplyListItem
} from '../model/replyListModel';
import { stableTextHash } from '../model/contentIdentity';
import { topicListItemKey, topicListItemType, type TopicListItem } from '../model/topicListModel';

const EMPTY_QUOTE_CONTENT_TOKENS = new Map<string, string>();
const EMPTY_NEARBY_TOPIC_CONTENT_KEYS: ReadonlySet<string> = new Set();

type QuoteContentLayoutProgress = {
  contentToken: string;
  frame: number | null;
  primed: boolean;
};

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
const TrimTrailingBlockSpacingRenderer: CustomBlockRenderer = ({ InternalRenderer, ...props }) => (
  <InternalRenderer
    {...props}
    style={trimsTrailingBlockSpacing(props.tnode) ? { ...props.style, marginBottom: -4 } : props.style}
  />
);

const HTML_CUSTOM_ELEMENT_MODELS = {
  details: defaultHTMLElementModels.details.extend({
    contentModel: HTMLContentModel.mixed
  }),
  summary: defaultHTMLElementModels.summary.extend({
    contentModel: HTMLContentModel.mixed
  }),
  [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: INLINE_FORUM_IMAGE_TAG,
    contentModel: HTMLContentModel.textual,
    isOpaque: true
  }),
  [FORUM_STICKER_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_STICKER_TAG,
    contentModel: HTMLContentModel.textual,
    isOpaque: true
  }),
  [FORUM_STICKER_ROW_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_STICKER_ROW_TAG,
    contentModel: HTMLContentModel.mixed,
    isOpaque: false
  }),
  [FORUM_INLINE_MEDIA_LINE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_INLINE_MEDIA_LINE_TAG,
    contentModel: HTMLContentModel.mixed,
    isOpaque: false
  }),
  [FORUM_REPLY_REFERENCE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_REPLY_REFERENCE_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [NODESEEK_POLL_PLACEHOLDER_TAG]: HTMLElementModel.fromCustomModel({
    tagName: NODESEEK_POLL_PLACEHOLDER_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [FORUM_LINK_CARD_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_LINK_CARD_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [FORUM_TERMINAL_REPORT_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_TERMINAL_REPORT_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: false
  }),
  [FORUM_TERMINAL_TAB_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_TERMINAL_TAB_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: false
  }),
  [FORUM_VIDEO_STICKER_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_VIDEO_STICKER_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [FORUM_VIDEO_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_VIDEO_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  iframe: HTMLElementModel.fromCustomModel({
    tagName: 'iframe',
    contentModel: HTMLContentModel.block,
    isOpaque: true
  })
};

function htmlTagName(tnode: unknown) {
  const tagName = ((tnode as { tagName?: string }).tagName || '').toLowerCase();
  return tagName || domNodeTagName((tnode as { domNode?: unknown }).domNode);
}
function domNodeTagName(node: unknown) {
  const record = node as { name?: unknown; tagName?: unknown };
  return String(record?.name || record?.tagName || '').toLowerCase();
}
function domNodeTextContent(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { children?: unknown; data?: unknown };
  const ownText = typeof record.data === 'string' ? record.data : '';
  const childText = Array.isArray(record.children) ? record.children.map(domNodeTextContent).join('') : '';
  return `${ownText}${childText}`;
}

function detailsSummaryTextFromDom(tnode: unknown) {
  const domNode = (tnode as { domNode?: { children?: unknown[] } }).domNode;
  const summaryNode = Array.isArray(domNode?.children)
    ? domNode.children.find((child) => domNodeTagName(child) === 'summary')
    : undefined;
  return domNodeTextContent(summaryNode).replace(/\s+/g, ' ').trim();
}

function hasHtmlClass(tnode: unknown, className: string) {
  const classValue = (tnode as { attributes?: Record<string, string | undefined> }).attributes?.class || '';
  return classValue.split(/\s+/).includes(className);
}

export const TopicContentList = memo(function TopicContentList({
  actions,
  article,
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
  topicScrollRef
}: {
  actions: TopicActionsController;
  article: {
    busy: boolean;
    error: SourceErrorInfo | null;
    topic: TopicDetail | null;
    yaohuoBookmarked?: boolean;
  };
  currentNodeSeekUser: SiteSessionViewModels['nodeseek']['currentUser'];
  discourseEmojiUrls: DiscourseEmojiUrlMap;
  headerState: ReactNode;
  html: ReturnType<typeof useHtmlRenderingController> & { contentWidth: number; mediaSessionIdentity: string };
  nodeSeekUserId: number | null;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserReference) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  read: ReturnType<typeof useTopicController>;
  session: TopicSessionController;
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
    mediaSessionIdentity,
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
  const sourceReplies = read.topicReplies;
  const replyHasMore = read.replyHasMore;
  const loadedQuotedReplies = read.loadedQuotedReplies;
  const loadingMoreReplies = read.loadingMoreReplies;
  const loadingQuotedFloors = read.loadingQuotedFloors;
  const unreadReplyCount = read.unreadReplyCount;
  const onCommentQueryChange = commands.view.changeCommentQuery;
  const onReplyFilterChange = commands.view.changeReplyFilter;
  const onLoadMoreReplies = read.loadMoreReplies;
  const onReplyComposerOpenChange = commands.composer.toggle;
  const onReplyToFloor = commands.composer.replyToFloor;
  const onToggleReplyQuote = read.toggleReplyQuote;
  const onToggleTopicBodyQuote = read.toggleTopicBodyQuote;
  const onDiscourseBookmark = actions.bookmarkOnDiscourseSite;
  const onNodeSeekCollection = actions.collectOnNodeSeekSite;
  const onYaohuoFavorite = actions.favoriteOnYaohuoSite;
  const onInteract = actions.interact;
  const onVotePoll = actions.votePoll;
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const mediaContext = useMemo(
    () => ({
      contentSource: item?.source || null,
      sessionIdentity: mediaSessionIdentity
    }),
    [item?.source, mediaSessionIdentity]
  );
  const topicLoading = topicBusy || (!topic && !topicError);
  const canShowReplies = Boolean(topic && !topicLoading);
  const detailTopicStateKey = topic ? `${topic.source}:${topic.id}` : item ? `${item.source}:${item.id}` : '';
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
  const replyTotalCount = item?.replyCount ?? replies.length;
  const replyDisplayCount =
    replyFilter === 'author' || replyFilter === 'images' || replyHighlightQuery.trim()
      ? replies.length
      : replyTotalCount;
  const listExtraData = useMemo(
    () => ({
      actionBusy,
      quoteStateVersion,
      replyComposerOpen
    }),
    [actionBusy, quoteStateVersion, replyComposerOpen]
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
              polls: openingPolls,
              source: openingSource
            }
          : null
      ),
    [openingAccessRequirement, openingContentHtml, openingPolls, openingSource]
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
  const acceptedAnswerReply = acceptedAnswer?.reply;
  const acceptedAnswerLoading = Boolean(acceptedAnswer && loadingQuotedFloors[acceptedAnswer.instanceKey]);
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
        replyItems,
        topicShowsAccessNotice
      }),
    [canShowReplies, replyItems, topicShowsAccessNotice]
  );
  const topicPostludeVisible = Boolean(
    legacyTopicPollsVisible || (acceptedAnswer && !topicShowsAccessNotice) || topicHasPostActions
  );
  const topicListItems = useMemo<TopicListItem[]>(
    () => [
      ...topicContentItems.map((content) => ({
        type: 'topicContent' as const,
        key: content.key,
        content
      })),
      ...(topicPostludeVisible ? [{ type: 'topicPostlude' as const, key: 'topic-postlude' }] : []),
      ...replyListItems
    ],
    [replyListItems, topicContentItems, topicPostludeVisible]
  );
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
  const armReplyAutoLoad = useCallback(() => {
    autoLoadRepliesArmedRef.current = true;
  }, []);
  const handleReplyEndReached = useCallback(() => {
    if (!replyHasMore || loadingMoreReplies || !autoLoadRepliesArmedRef.current) {
      return;
    }
    autoLoadRepliesArmedRef.current = false;
    onLoadMoreReplies();
  }, [loadingMoreReplies, onLoadMoreReplies, replyHasMore]);
  const requestReplyLoadMore = useCallback(() => {
    autoLoadRepliesArmedRef.current = false;
    onLoadMoreReplies();
  }, [onLoadMoreReplies]);
  useEffect(() => {
    autoLoadRepliesArmedRef.current = false;
    pendingAcceptedAnswerScrollRef.current = false;
  }, [item?.id, item?.source]);
  const genericHtmlRenderers = useMemo<HtmlRenderers>(() => {
    const DetailsRenderer: CustomBlockRenderer = (props) => {
      const [expanded, setExpanded] = useState(props.tnode.attributes?.open !== undefined);
      const tchildrenProps = useTNodeChildrenProps(props);
      const summaryNode = props.tnode.children.find((child) => htmlTagName(child) === 'summary');
      const summaryChildren = (summaryNode as { children?: typeof props.tnode.children } | undefined)?.children || [];
      const detailSummaryText = detailsSummaryTextFromDom(props.tnode);
      const detailBodyChildren = props.tnode.children.filter((child) => child !== summaryNode);
      const StateIcon = expanded ? ChevronDown : ChevronRight;

      return (
        <View style={styles.detailsPanel}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            android_ripple={androidRipple(theme.primarySoft)}
            style={styles.detailsPanelHeader}
            onPress={() => setExpanded((value) => !value)}
          >
            <View style={styles.detailsPanelIcon}>
              <StateIcon size={18} color={theme.ink} strokeWidth={2.1} />
            </View>
            <View style={styles.detailsPanelSummary}>
              {summaryChildren.length ? (
                <TChildrenRenderer {...tchildrenProps} tchildren={summaryChildren} />
              ) : detailSummaryText ? (
                <Text style={styles.detailsPanelSummaryText}>{detailSummaryText}</Text>
              ) : (
                <Text style={styles.detailsPanelSummaryText}>详情</Text>
              )}
            </View>
          </Pressable>
          {expanded && detailBodyChildren.length ? (
            <View style={styles.detailsPanelBody}>
              <TChildrenRenderer {...tchildrenProps} tchildren={detailBodyChildren} />
            </View>
          ) : null}
        </View>
      );
    };
    const SummaryRenderer: CustomBlockRenderer = () => null;
    const TableRenderer: CustomBlockRenderer = (props) => {
      const { TDefaultRenderer, ...defaultRendererProps } = props;
      if (htmlTagName(props.tnode) !== 'table') {
        return <TDefaultRenderer {...defaultRendererProps} />;
      }
      return (
        <ScrollView horizontal style={styles.htmlTableScroll} contentContainerStyle={styles.htmlTableScrollContent}>
          <View style={styles.htmlTableFrame}>
            <TDefaultRenderer {...defaultRendererProps} />
          </View>
        </ScrollView>
      );
    };
    return {
      ...htmlRenderers,
      details: DetailsRenderer,
      h1: TrimTrailingBlockSpacingRenderer,
      h2: TrimTrailingBlockSpacingRenderer,
      h3: TrimTrailingBlockSpacingRenderer,
      h4: TrimTrailingBlockSpacingRenderer,
      h5: TrimTrailingBlockSpacingRenderer,
      h6: TrimTrailingBlockSpacingRenderer,
      ol: TrimTrailingBlockSpacingRenderer,
      p: TrimTrailingBlockSpacingRenderer,
      pre: TrimTrailingBlockSpacingRenderer,
      summary: SummaryRenderer,
      table: TableRenderer,
      ul: TrimTrailingBlockSpacingRenderer
    };
  }, [htmlRenderers, styles, theme.ink, theme.primarySoft]);
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
    const QuoteAsideRenderer: CustomBlockRenderer = (props) => {
      const tchildrenProps = useTNodeChildrenProps(props);
      const { TDefaultRenderer, ...defaultRendererProps } = props;
      if (!hasHtmlClass(props.tnode, 'quote')) {
        return <TDefaultRenderer {...defaultRendererProps} />;
      }

      const quoteTitleChildren = props.tnode.children.filter(
        (child) => htmlTagName(child) === 'div' && hasHtmlClass(child, 'title')
      );
      const quoteHeaderChildren = quoteTitleChildren.length ? quoteTitleChildren : props.tnode.children.slice(0, 1);
      const quoteHeaderChildSet = new Set(quoteHeaderChildren);
      const quoteBodyChildren = props.tnode.children.filter((child) => !quoteHeaderChildSet.has(child));
      const reference = isDiscourseSource(itemSource)
        ? discourseQuotedPostReferenceFromAttributes(itemSource, props.tnode.attributes, item?.id)
        : null;
      const referenceKey = reference ? quotedPostReferenceKey(reference) : '';
      const instanceKey = reference && item?.id ? topicQuotedPostInstanceKey(item.id, reference) : '';
      const quotedPost = reference
        ? (reference.topicId === item?.id ? repliesByFloor.get(reference.postNumber) : undefined) ||
          loadedQuotedReplies[referenceKey]
        : undefined;
      const expanded = Boolean(instanceKey && expandedQuotes[instanceKey]);
      const loading = Boolean(instanceKey && loadingQuotedFloors[instanceKey]);
      const completeQuotedPost = expanded ? quotedPost : undefined;
      return (
        <TopicBodyQuoteCard
          completeContent={
            reference && completeQuotedPost ? (
              <>
                {splitDiscourseContentHtml(completeQuotedPost.contentHtml, completeQuotedPost.polls).map((part) =>
                  part.type === 'poll' ? (
                    <TopicPolls
                      embeddedInArticle
                      key={`topic-quote-poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                      actionBusy={actionBusy}
                      keyPrefix={`topic-quote-${reference.topicId}-${reference.postNumber}`}
                      onTogglePollSelection={togglePollSelection}
                      onVotePoll={onVotePoll}
                      pollSelections={pollSelections}
                      polls={[part.poll]}
                      source={reference.source}
                      styles={styles}
                      theme={theme}
                    />
                  ) : (
                    <MemoizedTopicContentBlock
                      key={`topic-quote-html-${stableTextHash(part.html)}`}
                      baseUrl={topicBaseUrl}
                      contentWidth={Math.max(220, contentWidth - 24)}
                      inlineSizedImageUrls={inlineSizedImageUrls}
                      html={part.html}
                      topicImageDeriver={topicImageDeriver}
                    />
                  )
                )}
              </>
            ) : undefined
          }
          completeTestID={reference ? `topic-quote-complete-${reference.topicId}-${reference.postNumber}` : undefined}
          expanded={expanded}
          header={<TChildrenRenderer {...tchildrenProps} tchildren={quoteHeaderChildren} />}
          loading={loading}
          preview={
            quoteBodyChildren.length ? (
              <TChildrenRenderer {...tchildrenProps} tchildren={quoteBodyChildren} />
            ) : undefined
          }
          previewTestID={reference ? `topic-quote-preview-${reference.topicId}-${reference.postNumber}` : undefined}
          styles={styles}
          testID={reference ? `topic-quote-${reference.topicId}-${reference.postNumber}` : undefined}
          theme={theme}
          onToggle={
            reference && instanceKey ? () => onToggleTopicBodyQuote({ instanceKey, reference, quotedPost }) : undefined
          }
        />
      );
    };
    return {
      ...genericHtmlRenderers,
      aside: QuoteAsideRenderer,
      [NODESEEK_POLL_PLACEHOLDER_TAG]: NodeSeekPollRenderer
    };
  }, [
    actionBusy,
    contentWidth,
    decisionFor,
    expandedQuotes,
    genericHtmlRenderers,
    inlineSizedImageUrls,
    item?.id,
    itemSource,
    loadedQuotedReplies,
    loadingQuotedFloors,
    onToggleTopicBodyQuote,
    onVotePoll,
    pollSelections,
    repliesByFloor,
    styles,
    theme,
    togglePollSelection,
    topicBaseUrl,
    topicImageDeriver,
    topicPolls
  ]);
  const renderTopicListItemFrame = useCallback(
    (children: ReactNode, key?: string, onLayout?: (event: LayoutChangeEvent) => void) => (
      <View key={key} style={styles.topicListItemFrame} onLayout={onLayout}>
        {children}
      </View>
    ),
    [styles]
  );
  const TopicListItemSeparator = useCallback(
    ({ leadingItem, trailingItem }: { leadingItem: TopicListItem; trailingItem: TopicListItem }) => {
      const height =
        leadingItem.type === 'topicContent' ||
        leadingItem.type === 'topicPostlude' ||
        trailingItem.type === 'topicContent' ||
        trailingItem.type === 'topicPostlude'
          ? 10
          : topicListItemSpacing(leadingItem, trailingItem);
      return height ? <View style={{ height }} /> : null;
    },
    []
  );
  const renderTopicContentItem = useCallback(
    (contentItem: TopicContentItem) => {
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
        return renderTopicListItemFrame(
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
                polls={[contentItem.poll]}
                source={topic?.source}
                styles={styles}
                theme={theme}
              />
            </View>
          </View>,
          contentItem.key
        );
      }

      if (contentItem.type === 'content') {
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            <View style={styles.articleBody}>
              <RenderHTMLConfigProvider
                renderers={topicBodyHtmlRenderers}
                renderersProps={htmlRenderersProps}
                defaultTextProps={{ selectable: true }}
                enableExperimentalBRCollapsing
                enableExperimentalGhostLinesPrevention
                enableExperimentalMarginCollapsing
              >
                <MemoizedTopicContentBlock
                  baseUrl={topicBaseUrl}
                  contentWidth={contentWidth}
                  inlineSizedImageUrls={inlineSizedImageUrls}
                  html={contentItem.html}
                  originalImageUpgradeEnabled={nearbyTopicContentKeys.has(contentItem.key)}
                  topicImageDeriver={topicImageDeriver}
                />
              </RenderHTMLConfigProvider>
            </View>
          </View>,
          contentItem.key,
          () => addNearbyTopicContentKeys([contentItem.key])
        );
      }

      return renderTopicListItemFrame(
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.articleBody}>
            <ForumContentVideo
              key={`${mediaSessionIdentity}:${contentItem.src}`}
              mediaContext={mediaContext}
              src={contentItem.src}
              theme={theme}
            />
          </View>
        </View>,
        contentItem.key
      );
    },
    [
      actionBusy,
      contentWidth,
      decisionFor,
      htmlRenderersProps,
      inlineSizedImageUrls,
      mediaContext,
      mediaSessionIdentity,
      nearbyTopicContentKeys,
      onVotePoll,
      pollSelections,
      addNearbyTopicContentKeys,
      renderTopicListItemFrame,
      styles,
      theme,
      togglePollSelection,
      topic?.source,
      topicBaseUrl,
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
        {acceptedAnswer && !topicShowsAccessNotice
          ? renderTopicListItemFrame(
              <View style={[styles.replyListItem, topicColumnStyle]}>
                <AcceptedAnswerPreview
                  key={acceptedAnswer.instanceKey}
                  contentSource={topic!.source}
                  contentWidth={contentWidth}
                  floor={acceptedAnswer.floor}
                  inlineSizedImageUrls={inlineSizedImageUrls}
                  loading={acceptedAnswerLoading}
                  reply={acceptedAnswerReply}
                  styles={styles}
                  theme={theme}
                  topicBaseUrl={topicBaseUrl}
                  topicImageDeriver={topicImageDeriver}
                  onLoad={loadAcceptedAnswer}
                  onReadMore={
                    acceptedAnswerReply && acceptedAnswerIsInSourceReplies ? scrollToAcceptedAnswer : undefined
                  }
                />
              </View>,
              `topic-accepted-answer-${acceptedAnswer.floor}`
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
    acceptedAnswer,
    acceptedAnswerIsInSourceReplies,
    acceptedAnswerLoading,
    acceptedAnswerReply,
    actionBusy,
    bookmarkDecision,
    canUseDiscourseInteractions,
    canWriteNodeSeek,
    canWriteYaohuo,
    contentWidth,
    decisionFor,
    detailTopicStateKey,
    dislikeDecision,
    discourseTopicReactionStats,
    inlineSizedImageUrls,
    likeDecision,
    legacyTopicPollsVisible,
    loadAcceptedAnswer,
    onDiscourseBookmark,
    onInteract,
    onNodeSeekCollection,
    onYaohuoFavorite,
    onVotePoll,
    pollSelections,
    renderTopicListItemFrame,
    scrollToAcceptedAnswer,
    styles,
    theme,
    togglePollSelection,
    topic,
    yaohuoBookmarked,
    topicBaseUrl,
    topicColumnStyle,
    topicHasPostActions,
    topicImageDeriver,
    topicPolls,
    topicReactionStats,
    topicShowsAccessNotice,
    upvoteDecision
  ]);

  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(
    ({ item: listItem }) => {
      if (listItem.type === 'topicContent') {
        return renderTopicContentItem(listItem.content);
      }
      if (listItem.type === 'topicPostlude') {
        return topicPostlude;
      }
      if (listItem.type === 'replyControls') {
        return renderTopicListItemFrame(
          <View style={[styles.replyHeader, topicColumnStyle]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                回复列表 <Text style={styles.countText}>{replyDisplayCount} 条</Text>
              </Text>
              {canWrite ? (
                <AppButton
                  label={replyComposerOpen ? '收起回复' : '写回复'}
                  variant={replyComposerOpen ? 'ghost' : 'default'}
                  onPress={() => onReplyComposerOpenChange(!replyComposerOpen)}
                />
              ) : null}
            </View>
            <PillRail
              variant="subtabs"
              items={[
                { value: 'all', label: '全部' },
                { value: 'author', label: '只看楼主' },
                { value: 'images', label: '只看带图' },
                { value: 'newest', label: '倒序' }
              ]}
              value={replyFilter}
              onChange={(value) => onReplyFilterChange(value as ReplyFilter)}
            />
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
          </View>
        );
      }

      if (listItem.type === 'emptyReplies') {
        return renderTopicListItemFrame(
          <View style={[styles.replyListItem, topicColumnStyle]}>
            <EmptyText text="暂无回复" />
          </View>
        );
      }

      return renderTopicListItemFrame(
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <MemoizedReplyItem
            actionBusy={actionBusy}
            decisionFor={decisionFor}
            contentWidth={contentWidth}
            expandedQuotes={expandedQuotes}
            inlineSizedImageUrls={inlineSizedImageUrls}
            discourseEmojiUrls={discourseEmojiUrls}
            topicImageDeriver={topicImageDeriver}
            topicBaseUrl={topicBaseUrl}
            loadedQuotedReplies={loadedQuotedReplies}
            loadingQuotedFloors={loadingQuotedFloors}
            onTogglePollSelection={togglePollSelection}
            reply={listItem.reply}
            replyFloor={listItem.replyFloor}
            pollSelections={pollSelections}
            repliesByFloor={repliesByFloor}
            section={listItem.type === 'reply' ? undefined : listItem}
            styles={styles}
            theme={theme}
            topicAuthor={item?.author}
            onInteract={onInteract}
            onDeleteReply={onDeleteReply}
            onEditReply={onEditReply}
            onOpenTopic={onOpenTopic}
            onQuoteContentLayout={markReplyQuoteContentLayout}
            onVotePoll={onVotePoll}
            onReplyToFloor={onReplyToFloor}
            onToggleReplyQuote={onToggleReplyQuote}
            topicId={item?.id}
            topicStateKey={detailTopicStateKey}
            query={replyHighlightQuery}
            isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
            source={itemSource}
            onOpenUser={onOpenUser}
          />
        </View>
      );
    },
    [
      actionBusy,
      canWrite,
      commentQuery,
      contentWidth,
      decisionFor,
      expandedQuotes,
      inlineSizedImageUrls,
      item?.author,
      item?.id,
      topicImageDeriver,
      loadedQuotedReplies,
      loadingQuotedFloors,
      discourseEmojiUrls,
      newReplyFloorStart,
      onCommentQueryChange,
      onDeleteReply,
      onEditReply,
      onInteract,
      onOpenTopic,
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
      itemSource,
      replyComposerOpen,
      replyHighlightQuery,
      replyFilter,
      repliesByFloor,
      replyDisplayCount,
      styles,
      theme,
      togglePollSelection,
      topicBaseUrl,
      topicColumnStyle,
      topicPostlude,
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
                {formatDateTime(item.createdAt)} · {item.replyCount} 回复
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
          onMomentumScrollBegin={armReplyAutoLoad}
          extraData={listExtraData}
          {...TOPIC_DETAIL_LIST_PERFORMANCE_PROPS}
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            canShowReplies && replyHasMore ? (
              <View style={styles.topicListItemFrame}>
                <View style={[styles.topicFooter, topicColumnStyle]}>
                  <AppButton
                    label={loadingMoreReplies ? '正在加载...' : '加载更多回复'}
                    disabled={loadingMoreReplies}
                    onPress={requestReplyLoadMore}
                  />
                </View>
              </View>
            ) : null
          }
          renderItem={renderReplyItem}
        />
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
});
