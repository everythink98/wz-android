import { createContext, memo, type ReactNode, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { BookMarked, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Drumstick, MoreHorizontal, Star, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import type { Reply, Source, SourceErrorInfo, Topic, TopicDetail, TopicPoll, UserReference } from '../../types';
import type { HtmlBaseStyle, HtmlClassesStyles, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, ReplyEditTarget, ReplyFilter, ReplyTarget } from '../../appTypes';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '../../appUtils';
import { HTML_ALLOWED_INLINE_STYLES, trimsTrailingBlockSpacing } from '../../htmlRenderingStyles';
import { FORUM_INLINE_MEDIA_LINE_TAG, FORUM_STICKER_ROW_TAG, FORUM_STICKER_TAG, INLINE_FORUM_IMAGE_TAG } from '../../htmlImages';
import { FORUM_LINK_CARD_TAG, FORUM_TERMINAL_REPORT_TAG, FORUM_TERMINAL_TAB_TAG, FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG } from '../../localHtml';
import { FORUM_REPLY_REFERENCE_TAG } from '../../topicContentHtml';
import { forumVideoBlockFromHtml, splitTopicContentHtml } from '../../topicContentSplit';
import { androidRipple, createStyles, replyContextBadgeStyle, sourceBadgeColorStyle, topicStatusBadgeColorStyle, topicStatusBadgeTextColorStyle, topicTagColorStyle, topicTagTextColorStyle, type ReaderTheme } from '../../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail, triggerPressFeedback } from '../../components/AppControls';
import { Avatar } from '../../components/Avatar';
import { ForumContentVideo } from '../../components/ForumContentVideo';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '../../components/listPerformance';
import { topicWithAuthorFallback, userFromTopic } from '../../userNavigation';
import { topicActionStateKey, type InteractionType, type OptimisticActionState, type TopicActionStateKind } from '../../topicActionState';
import type { TopicImageDeriver } from '../../topicDerivedData';
import { authNoticeForSourceError } from '../../siteSessionPrompts';
import { splitDiscourseContentHtml } from '../../discourseContent';
import { NODESEEK_POLL_PLACEHOLDER_TAG } from '../../nodeseekPolls';
import { discourseReactionStats, type DiscourseEmojiUrlMap } from '../../discourseReactions';
import { linuxDoReactionStats } from '../../linuxdoReactions';
import { canToggleDiscourseLike } from '../../discoursePermissions';
import { replyImageUploadSupported } from '../../replyImageUpload';
import {
  discourseQuotedPostReferenceFromAttributes,
  quotedPostReferenceKey,
  quotedPostReferenceFromReply,
  topicQuotedPostInstanceKey,
  type ToggleReplyQuoteOptions,
  type ToggleTopicBodyQuoteOptions
} from '../../quotedPosts';
import { isDiscourseSource, sourceSupportsTopicAction, sourceUsesTopicCreatePermission, type DiscourseSource } from '../../sourceCatalog';
import { TopicPolls } from './TopicPolls';
import { DetailActionButton } from './TopicActionBar';
import { TopicBodyQuoteCard } from './TopicBodyQuoteCard';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { DiscourseReactionPill, MemoizedReplyItem, NodeSeekStatPill, nodeSeekTopicReactionStats } from './ReplyItem';
import { ReplyComposerSheet } from './ReplyComposerSheet';
import { TopicMenu } from './TopicMenu';
import { buildReplyListItems, getReplyKey, isAccessNoticeHtml, readableTopicError, stableTextHash, topicOpeningPostAsReply, topicStatusBadges, type TopicListItem } from './topicScreenHelpers';

type YaohuoFavoriteState = {
  bookmarked?: boolean;
  onPress: () => void;
  topicKey: string;
};

const YaohuoFavoriteStateContext = createContext<YaohuoFavoriteState | null>(null);

export function YaohuoFavoriteStateProvider({
  bookmarked,
  children,
  onPress,
  topicKey
}: YaohuoFavoriteState & { children: ReactNode }) {
  const value = useMemo(() => ({ bookmarked, onPress, topicKey }), [bookmarked, onPress, topicKey]);
  return <YaohuoFavoriteStateContext.Provider value={value}>{children}</YaohuoFavoriteStateContext.Provider>;
}

function YaohuoFavoriteButton({
  actionBusy,
  fallbackBookmarked,
  styles,
  theme,
  topicKey
}: {
  actionBusy: boolean;
  fallbackBookmarked?: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicKey: string;
}) {
  const favoriteState = useContext(YaohuoFavoriteStateContext);
  const currentState = favoriteState?.topicKey === topicKey ? favoriteState : null;
  const bookmarked = currentState ? currentState.bookmarked : fallbackBookmarked;
  const stateKnown = bookmarked !== undefined;
  return (
    <DetailActionButton
      active={bookmarked === true}
      tone="favorite"
      accessibilityLabel={stateKnown ? bookmarked ? '取消原站收藏' : '原站收藏' : '原站收藏状态未加载'}
      icon={BookMarked}
      label={stateKnown ? '收藏' : '状态未知'}
      styles={styles}
      theme={theme}
      disabled={actionBusy || !stateKnown}
      onPress={currentState?.onPress || (() => undefined)}
    />
  );
}

function AcceptedAnswerPreview({
  contentSource,
  contentWidth,
  floor,
  inlineSizedImageUrls,
  loading,
  onLoad,
  onReadMore,
  reply,
  styles,
  theme,
  topicBaseUrl,
  topicImageDeriver
}: {
  contentSource: Source;
  contentWidth: number;
  floor: number;
  inlineSizedImageUrls: Record<string, true>;
  loading: boolean;
  onLoad?: () => void;
  onReadMore?: () => void;
  reply?: Reply;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicBaseUrl?: string;
  topicImageDeriver: TopicImageDeriver;
}) {
  const [expanded, setExpanded] = useState(true);
  const [fullAnswerVisible, setFullAnswerVisible] = useState(false);
  const contentParts = useMemo(
    () => reply ? splitDiscourseContentHtml(reply.contentHtml, reply.polls) : [],
    [reply]
  );
  const quotedFloors = useMemo(
    () => Array.from(new Set(reply?.quotedFloors || [])),
    [reply?.quotedFloors]
  );
  const ToggleIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <View style={styles.topicAcceptedAnswer} testID="topic-accepted-answer">
      <Pressable
        accessibilityLabel={expanded ? '收起已采纳答案' : '展开已采纳答案'}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={styles.topicAcceptedAnswerHeader}
        onPress={() => {
          triggerPressFeedback();
          setExpanded((current) => !current);
        }}
      >
        <View style={styles.topicAcceptedAnswerHeaderLead}>
          <CheckCircle color={theme.primary} size={18} strokeWidth={2.2} />
          <Text style={styles.topicAcceptedAnswerTitle}>已采纳答案</Text>
        </View>
        <View style={styles.topicAcceptedAnswerToggle}>
          <Text style={styles.topicAcceptedAnswerToggleText}>{expanded ? '收起' : '展开'}</Text>
          <ToggleIcon color={theme.primary} size={16} strokeWidth={2.2} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.topicAcceptedAnswerBody}>
          {reply ? (
            <>
              <View style={styles.topicAcceptedAnswerAuthorRow}>
                <Avatar contentSource={contentSource} small name={reply.author} uri={reply.authorAvatar} styles={styles} />
                <View style={styles.topicAcceptedAnswerAuthorMeta}>
                  <Text style={styles.topicAcceptedAnswerAuthor} numberOfLines={1}>{reply.author || '未知作者'}</Text>
                  <Text style={styles.topicAcceptedAnswerTime}>{formatDateTime(reply.createdAt)}{floor ? ` · #${floor}` : ''}</Text>
                </View>
              </View>
              <View style={!fullAnswerVisible ? styles.topicAcceptedAnswerPreview : undefined}>
                {quotedFloors.length ? (
                  <View style={styles.quoteStack}>
                    {quotedFloors.map((quotedFloor) => (
                      <View key={`accepted-quote-${quotedFloor}`} style={[styles.quoteBox, styles.replyQuoteBox]}>
                        <View style={styles.quoteHeader}>
                          <View style={styles.quoteAuthorSummary}>
                            <View style={styles.quoteAuthorTextBlock}>
                              <Text style={styles.quoteAuthorText} numberOfLines={1}>
                                {reply.quotedAuthors?.[quotedFloor]?.label || '引用内容'}
                              </Text>
                              <Text style={styles.replyMeta}>引用 #{quotedFloor}</Text>
                            </View>
                          </View>
                        </View>
                        {reply.quotedPreviews?.[quotedFloor] ? (
                          <Text style={styles.quotePreviewText}>{reply.quotedPreviews[quotedFloor]}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
                {contentParts.map((part) => part.type === 'poll' ? (
                  <TopicPolls
                    actionBusy={false}
                    canWritePollSource={false}
                    embeddedInArticle
                    key={`accepted-poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                    keyPrefix={`accepted-answer-${floor}`}
                    onTogglePollSelection={() => undefined}
                    onVotePoll={() => undefined}
                    pollSelections={{}}
                    polls={[part.poll]}
                    styles={styles}
                    theme={theme}
                  />
                ) : (
                  <MemoizedTopicContentBlock
                    key={`accepted-html-${stableTextHash(part.html)}`}
                    baseUrl={topicBaseUrl}
                    compact
                    contentWidth={Math.max(220, contentWidth - 24)}
                    inlineSizedImageUrls={inlineSizedImageUrls}
                    html={part.html}
                    trimTrailingBlockSpacing
                    topicImageDeriver={topicImageDeriver}
                  />
                ))}
              </View>
            </>
          ) : (
            <View accessibilityLiveRegion="polite" style={styles.topicAcceptedAnswerAuthorMeta}>
              <Text style={styles.topicAcceptedAnswerAuthor}>{loading ? '正在读取解决方案' : '解决方案正文暂未载入'}</Text>
              <Text style={styles.topicAcceptedAnswerTime}>采纳答案位于第 {floor} 楼</Text>
            </View>
          )}
          {reply && floor && (onReadMore || !fullAnswerVisible) ? (
            <Pressable
              accessibilityLabel={`查看完整解决方案，第 ${floor} 楼`}
              accessibilityRole="button"
              android_ripple={androidRipple(theme.primarySoft)}
              style={styles.topicAcceptedAnswerReadMore}
              onPress={() => {
                triggerPressFeedback();
                if (onReadMore) {
                  onReadMore();
                } else {
                  setFullAnswerVisible(true);
                }
              }}
            >
              <Text style={styles.topicAcceptedAnswerReadMoreText}>查看完整答案 · #{floor}</Text>
              <ChevronRight color={theme.primary} size={17} strokeWidth={2.2} />
            </Pressable>
          ) : !reply && onLoad && !loading ? (
            <Pressable
              accessibilityLabel={`读取已采纳答案，第 ${floor} 楼`}
              accessibilityRole="button"
              android_ripple={androidRipple(theme.primarySoft)}
              style={styles.topicAcceptedAnswerReadMore}
              onPress={() => {
                triggerPressFeedback();
                onLoad();
              }}
            >
              <Text style={styles.topicAcceptedAnswerReadMoreText}>读取答案 · #{floor}</Text>
              <ChevronRight color={theme.primary} size={17} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type TopicContentItem =
  | { type: 'content'; key: string; html: string }
  | { type: 'contentVideo'; key: string; src: string }
  | { type: 'poll'; key: string; poll: TopicPoll }
  | { type: 'accessNotice'; key: string; label: string; detail: string };
export type { TopicListItem };

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'noscript'];
const EMPTY_TOPIC_POLLS: TopicPoll[] = [];
const EMPTY_DISCOURSE_EMOJI_URLS: DiscourseEmojiUrlMap = {};

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
  const summaryNode = Array.isArray(domNode?.children) ? domNode.children.find((child) => domNodeTagName(child) === 'summary') : undefined;
  return domNodeTextContent(summaryNode).replace(/\s+/g, ' ').trim();
}

function hasHtmlClass(tnode: unknown, className: string) {
  const classValue = ((tnode as { attributes?: Record<string, string | undefined> }).attributes?.class || '');
  return classValue.split(/\s+/).includes(className);
}

function topicListItemKey(item: TopicListItem) {
  return item.key;
}

function topicListItemType(item: TopicListItem) {
  return item.type;
}

export const TopicScreen = memo(function TopicScreen({
  actionBusy,
  sourceActionAvailability,
  contentWidth,
  htmlBaseStyle,
  htmlClassesStyles,
  htmlIgnoredStyles,
  htmlRenderers,
  htmlRenderersProps,
  htmlTagsStyles,
  getDiscourseEmojiUrls,
  expandedQuotes,
  loadedQuotedReplies,
  loadingMoreReplies,
  loadingQuotedFloors,
  mediaSessionIdentity,
  commentQuery,
  replyHighlightQuery,
  quoteStateVersion,
  replyComposerOpen,
  replyContent,
  replyFace,
  replyEditTarget,
  replyFilter,
  replyTarget,
  replyHasMore,
  replies,
  selectedTopic,
  sourceReplies,
  styles,
  theme,
  topic,
  topicBusy,
  topicError,
  topicFavorite,
  topicScrollRef,
  unreadReplyCount,
  onBack,
  onCommentQueryChange,
  optimisticActions,
  onDeleteReply,
  onEditReply,
  onInteract,
  onDiscourseBookmark,
  onNodeSeekCollection,
  onShareTopic,
  onVotePoll,
  onLoadMoreReplies,
  onOpenOriginal,
  onOpenReadingSettings,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFaceChange,
  onReplyFilterChange,
  onReplyToFloor,
  onRefreshTopic,
  onRefreshWholeTopic,
  onVerifyLinuxDo,
  onVerifyNodeSeek,
  onSubmitReply,
  onUploadReplyImage,
  onTopicScroll,
  onToggleReplyQuote,
  onToggleTopicBodyQuote,
  onToggleFavorite,
  onOpenUser,
  inlineSizedImageUrls,
  topicImageDeriver
}: {
  actionBusy: boolean;
  sourceActionAvailability: Record<Source, boolean>;
  contentWidth: number;
  htmlBaseStyle: HtmlBaseStyle;
  htmlClassesStyles: HtmlClassesStyles;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRenderers: HtmlRenderers;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  getDiscourseEmojiUrls: (options: {
    signal?: AbortSignal;
    source: DiscourseSource;
  }) => Promise<DiscourseEmojiUrlMap>;
  expandedQuotes: Record<string, boolean>;
  loadedQuotedReplies: Record<string, Reply>;
  loadingMoreReplies: boolean;
  loadingQuotedFloors: Record<string, boolean>;
  mediaSessionIdentity: string;
  commentQuery: string;
  replyHighlightQuery: string;
  quoteStateVersion: number;
  replyComposerOpen: boolean;
  replyContent: string;
  replyFace: string;
  replyEditTarget: ReplyEditTarget | null;
  replyFilter: ReplyFilter;
  replyTarget: ReplyTarget | null;
  replyHasMore: boolean;
  replies: Reply[];
  selectedTopic: Topic | null;
  sourceReplies: Reply[];
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topic: TopicDetail | null;
  topicBusy: boolean;
  topicError: SourceErrorInfo | null;
  topicFavorite: boolean;
  topicScrollRef: RefObject<FlashListRef<TopicListItem> | null>;
  unreadReplyCount: number;
  onBack: () => void;
  onCommentQueryChange: (value: string) => void;
  optimisticActions: Record<string, OptimisticActionState>;
  onDeleteReply: (reply: Reply) => void;
  onEditReply: (reply: Reply) => void;
  onInteract: (type: InteractionType, commentId?: number) => void;
  onDiscourseBookmark: () => void;
  onNodeSeekCollection: () => void;
  onShareTopic: () => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  onLoadMoreReplies: () => void;
  onOpenOriginal: (url: string) => void;
  onOpenReadingSettings: () => void;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFaceChange: (value: string) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
  onReplyToFloor: (reply: Reply) => void;
  onRefreshTopic: () => void;
  onRefreshWholeTopic: () => void;
  onVerifyLinuxDo: () => void;
  onVerifyNodeSeek: () => void;
  onSubmitReply: () => void;
  onUploadReplyImage: () => void;
  onTopicScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onToggleReplyQuote: (options: ToggleReplyQuoteOptions) => void;
  onToggleTopicBodyQuote: (options: ToggleTopicBodyQuoteOptions) => void;
  onToggleFavorite: (topic: Topic) => void;
  onOpenUser: (user: UserReference) => void;
  inlineSizedImageUrls: Record<string, true>;
  topicImageDeriver: TopicImageDeriver;
}) {
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const mediaContext = useMemo(() => ({
    contentSource: item?.source || null,
    sessionIdentity: mediaSessionIdentity
  }), [item?.source, mediaSessionIdentity]);
  const topicLoading = topicBusy || (!topic && !topicError);
  const canShowReplies = Boolean(topic && !topicLoading);
  const canUseCurrentSourceActions = Boolean(topic && sourceActionAvailability[topic.source]);
  const canWriteNodeSeek = Boolean(topic && topic.source === 'nodeseek' && canUseCurrentSourceActions);
  const canWriteYaohuo = Boolean(topic && topic.source === 'yaohuo' && canUseCurrentSourceActions);
  const canUseDiscourseInteractions = Boolean(topic && isDiscourseSource(topic.source) && canUseCurrentSourceActions);
  const canWriteDiscourse = Boolean(
    topic
    && canUseDiscourseInteractions
    && (!sourceUsesTopicCreatePermission(topic.source) || topic.canCreatePost === true)
  );
  const canWrite = canWriteNodeSeek || canWriteYaohuo || canWriteDiscourse;
  const canOpenReplyComposer = canWrite || Boolean(
    canUseDiscourseInteractions
    && replyEditTarget
  );
  const replyTotalCount = item?.replyCount ?? replies.length;
  const replyDisplayCount = replyFilter === 'author' || replyFilter === 'images' || replyHighlightQuery.trim()
    ? replies.length
    : replyTotalCount;
  const listExtraData = useMemo(() => ({
    actionBusy,
    quoteStateVersion,
    replyComposerOpen
  }), [actionBusy, quoteStateVersion, replyComposerOpen]);
  const itemSource = topic?.source;
  const topicBaseUrl = topic?.url || item?.url;
  const detailTopicStateKey = topic ? `${topic.source}:${topic.id}` : item ? `${item.source}:${item.id}` : '';
  const isOptimisticActionPending = useCallback((targetId: string | number | undefined, action: TopicActionStateKind) => {
    if (!detailTopicStateKey || !targetId) {
      return false;
    }
    return Boolean(optimisticActions[topicActionStateKey({ topicKey: detailTopicStateKey, targetId, action })]?.inFlight);
  }, [detailTopicStateKey, optimisticActions]);
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const autoLoadRepliesArmedRef = useRef(false);
  const repliesByFloor = useMemo(() => {
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
    const floors = sourceReplies.map((reply) => reply.floor).filter((floor): floor is number => typeof floor === 'number');
    if (!floors.length) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(...floors) - unreadReplyCount + 1;
  }, [sourceReplies, unreadReplyCount]);
  const [pollSelections, setPollSelections] = useState<Record<string, string[]>>({});
  const [discourseEmojiCatalog, setDiscourseEmojiCatalog] = useState<{
    source: DiscourseSource;
    urls: DiscourseEmojiUrlMap;
  } | null>(null);
  const discourseEmojiUrls = discourseEmojiCatalog && discourseEmojiCatalog.source === itemSource
    ? discourseEmojiCatalog.urls
    : EMPTY_DISCOURSE_EMOJI_URLS;
  useEffect(() => {
    setPollSelections({});
  }, [item?.id, item?.source]);
  useEffect(() => {
    if (!isDiscourseSource(itemSource)) {
      setDiscourseEmojiCatalog(null);
      return undefined;
    }
    const controller = new AbortController();
    getDiscourseEmojiUrls({ source: itemSource, signal: controller.signal })
      .then((urls) => {
        if (!controller.signal.aborted) {
          setDiscourseEmojiCatalog({ source: itemSource, urls });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDiscourseEmojiCatalog(null);
        }
      });
    return () => {
      controller.abort();
    };
  }, [getDiscourseEmojiUrls, itemSource, topic]);
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
  const topicContentHtml = topic?.contentHtml || '';
  const topicPolls = topic?.polls || EMPTY_TOPIC_POLLS;
  const topicAccessRequirementText = topic?.accessRequirement ? forumAccessRequirementText(topic.accessRequirement) : '';
  const topicAccessRequirementDetail = topic?.accessRequirement?.detail || '当前账号暂无权限查看这个帖子';
  const topicShowsAccessNotice = Boolean(topic && isAccessNoticeHtml(topicContentHtml, topic.accessRequirement));
  const topicContentItems = useMemo<TopicContentItem[]>(() => (
    topic
      ? topicShowsAccessNotice
        ? [{
          type: 'accessNotice',
          key: 'topic-access-notice',
          label: topicAccessRequirementText,
          detail: topicAccessRequirementDetail
        }]
        : (isDiscourseSource(topic.source)
          ? splitDiscourseContentHtml(topicContentHtml, topicPolls)
          : [{ type: 'html' as const, html: topicContentHtml }]
        ).flatMap((part, partIndex): TopicContentItem[] => {
          if (part.type === 'poll') {
            return [{ type: 'poll' as const, key: `topic-poll-${part.poll.name || part.poll.id || partIndex}`, poll: part.poll }];
          }
          return splitTopicContentHtml(part.html).map((html, index) => {
            const video = forumVideoBlockFromHtml(html);
            return video
              ? { type: 'contentVideo' as const, key: `topic-video-${partIndex}-${index}-${stableTextHash(video.src)}`, src: video.src }
              : { type: 'content' as const, key: `topic-content-${partIndex}-${index}-${stableTextHash(html)}`, html };
          });
        })
      : []
  ), [topic, topicAccessRequirementDetail, topicAccessRequirementText, topicContentHtml, topicPolls, topicShowsAccessNotice]);
  const replyItems = useMemo<TopicListItem[]>(() => replies.map((reply) => ({
    type: 'reply',
    key: getReplyKey(reply),
    reply,
    replyFloor: reply.floor ?? 0
  })), [replies]);
  const acceptedAnswer = useMemo(() => {
    if (!topic || topicShowsAccessNotice || !isDiscourseSource(topic.source)) {
      return null;
    }
    const flaggedReply = sourceReplies.find((reply) => reply.acceptedAnswer)
      || topic.replies.find((reply) => reply.acceptedAnswer);
    const acceptedFloor = flaggedReply?.floor ?? topic.acceptedAnswerFloor;
    const reference = quotedPostReferenceFromReply(topic.source, topic.id, acceptedFloor);
    if (!reference) {
      return null;
    }
    const referenceKey = quotedPostReferenceKey(reference);
    const candidate = (acceptedFloor
      ? sourceReplies.find((reply) => reply.floor === acceptedFloor)
        || topic.replies.find((reply) => reply.floor === acceptedFloor)
        || loadedQuotedReplies[referenceKey]
      : undefined) || flaggedReply;
    return {
      floor: reference.postNumber,
      instanceKey: `accepted-answer:${topic.id}:${referenceKey}`,
      reference,
      reply: candidate && !candidate.systemAction && candidate.contentHtml.trim() ? candidate : undefined
    };
  }, [loadedQuotedReplies, sourceReplies, topic, topicShowsAccessNotice]);
  const acceptedAnswerReply = acceptedAnswer?.reply;
  const acceptedAnswerLoading = Boolean(
    acceptedAnswer && loadingQuotedFloors[acceptedAnswer.instanceKey]
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
      !acceptedAnswer
      || acceptedAnswer.reply
      || acceptedAnswerLoading
      || acceptedAnswerLoadAttemptRef.current === acceptedAnswer.instanceKey
    ) {
      return;
    }
    loadAcceptedAnswer();
  }, [acceptedAnswer, acceptedAnswerLoading, loadAcceptedAnswer]);
  const canWriteTopicPollSource = Boolean(
    topic
    && sourceSupportsTopicAction(topic.source, 'vote')
    && canUseCurrentSourceActions
  );
  const discourseTopicReactionStats = topic && isDiscourseSource(topic.source)
    ? topic.source === 'linuxdo' ? linuxDoReactionStats(topic, discourseEmojiUrls) : discourseReactionStats(topic, discourseEmojiUrls)
    : [];
  const topicHasPostActions = Boolean(topic && !topicShowsAccessNotice && (
    (topic.source === 'nodeseek' && (canWriteNodeSeek || nodeSeekTopicReactionStats(topic).length > 0))
    || (isDiscourseSource(topic.source) && (canUseDiscourseInteractions || discourseTopicReactionStats.length > 0))
    || (topic.source === 'yaohuo' && canWriteYaohuo)
    || (topic.source === 'v2ex' && typeof topic.upvoteCount === 'number')
  ));
  const replyListItems = useMemo(() => buildReplyListItems({
    canShowReplies,
    replyItems,
    topicShowsAccessNotice
  }), [canShowReplies, replyItems, topicShowsAccessNotice]);
  const acceptedAnswerListIndex = useMemo(() => {
    if (!acceptedAnswerReply) {
      return -1;
    }
    return replyListItems.findIndex((listItem) => listItem.type === 'reply'
      && listItem.reply.floor === acceptedAnswerReply.floor);
  }, [acceptedAnswerReply, replyListItems]);
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
    setTopicMenuOpen(false);
    autoLoadRepliesArmedRef.current = false;
    pendingAcceptedAnswerScrollRef.current = false;
  }, [item?.id, item?.source]);
  const runTopicMenuAction = useCallback((action: () => void) => {
    triggerPressFeedback();
    setTopicMenuOpen(false);
    action();
  }, []);
  const genericHtmlRenderers = useMemo<HtmlRenderers>(() => {
    const DetailsRenderer: CustomBlockRenderer = (props) => {
      const [expanded, setExpanded] = useState(props.tnode.attributes?.open !== undefined);
      const tchildrenProps = useTNodeChildrenProps(props);
      const summaryNode = props.tnode.children.find((child) => htmlTagName(child) === 'summary');
      const summaryChildren = ((summaryNode as { children?: typeof props.tnode.children } | undefined)?.children || []);
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
      blockquote: TrimTrailingBlockSpacingRenderer,
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
      const poll = itemSource === 'nodeseek'
        ? topicPolls.find((candidate) => candidate.id && encodeURIComponent(candidate.id) === encodedId)
        : undefined;
      if (!poll) {
        return null;
      }
      return (
        <TopicPolls
          actionBusy={actionBusy}
          canWritePollSource={canWriteTopicPollSource}
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

      const quoteTitleChildren = props.tnode.children.filter((child) => htmlTagName(child) === 'div' && hasHtmlClass(child, 'title'));
      const quoteHeaderChildren = quoteTitleChildren.length ? quoteTitleChildren : props.tnode.children.slice(0, 1);
      const quoteHeaderChildSet = new Set(quoteHeaderChildren);
      const quoteBodyChildren = props.tnode.children.filter((child) => !quoteHeaderChildSet.has(child));
      const reference = isDiscourseSource(itemSource)
        ? discourseQuotedPostReferenceFromAttributes(itemSource, props.tnode.attributes, item?.id)
        : null;
      const referenceKey = reference ? quotedPostReferenceKey(reference) : '';
      const instanceKey = reference && item?.id ? topicQuotedPostInstanceKey(item.id, reference) : '';
      const quotedPost = reference
        ? (reference.topicId === item?.id ? repliesByFloor.get(reference.postNumber) : undefined)
          || loadedQuotedReplies[referenceKey]
        : undefined;
      const expanded = Boolean(instanceKey && expandedQuotes[instanceKey]);
      const loading = Boolean(instanceKey && loadingQuotedFloors[instanceKey]);
      const completeQuotedPost = expanded ? quotedPost : undefined;
      return (
        <TopicBodyQuoteCard
          completeContent={reference && completeQuotedPost ? (
            <>
              {splitDiscourseContentHtml(completeQuotedPost.contentHtml, completeQuotedPost.polls).map((part) => part.type === 'poll' ? (
                <TopicPolls
                  embeddedInArticle
                  key={`topic-quote-poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                  actionBusy={actionBusy}
                  canWritePollSource={false}
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
              ))}
            </>
          ) : undefined}
          completeTestID={reference ? `topic-quote-complete-${reference.topicId}-${reference.postNumber}` : undefined}
          expanded={expanded}
          header={<TChildrenRenderer {...tchildrenProps} tchildren={quoteHeaderChildren} />}
          loading={loading}
          preview={quoteBodyChildren.length ? <TChildrenRenderer {...tchildrenProps} tchildren={quoteBodyChildren} /> : undefined}
          previewTestID={reference ? `topic-quote-preview-${reference.topicId}-${reference.postNumber}` : undefined}
          styles={styles}
          testID={reference ? `topic-quote-${reference.topicId}-${reference.postNumber}` : undefined}
          theme={theme}
          onToggle={reference && instanceKey ? () => onToggleTopicBodyQuote({ instanceKey, reference, quotedPost }) : undefined}
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
    canWriteTopicPollSource,
    contentWidth,
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
  const renderTopicListItemFrame = useCallback((children: ReactNode, key?: string) => (
    <View key={key} style={styles.topicListItemFrame}>{children}</View>
  ), [styles]);
  function renderTopicContentItem(contentItem: TopicContentItem) {
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
              canWritePollSource={canWriteTopicPollSource}
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
                topicImageDeriver={topicImageDeriver}
              />
            </RenderHTMLConfigProvider>
          </View>
        </View>,
        contentItem.key
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
  }

  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(({ item: listItem }) => {
    if (listItem.type === 'replyControls') {
      return renderTopicListItemFrame(
        <View style={[styles.replyHeader, topicColumnStyle]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>回复列表 <Text style={styles.countText}>{replyDisplayCount} 条</Text></Text>
            {canWrite ? (
              <AppButton
                label={replyComposerOpen ? '收起回复' : '写回复'}
                variant={replyComposerOpen ? 'ghost' : 'default'}
                styles={styles}
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
            styles={styles}
            onChange={(value) => onReplyFilterChange(value as ReplyFilter)}
          />
          {unreadReplyCount > 0 ? <Text style={styles.noticeText}>新增 {unreadReplyCount} 条回复</Text> : null}
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={commentQuery}
              onChangeText={onCommentQueryChange}
              placeholder="评论内查找"
              placeholderTextColor={theme.muted}
            />
            {commentQuery ? <IconButton icon={X} label="清空查找" styles={styles} theme={theme} onPress={() => onCommentQueryChange('')} /> : null}
          </View>
        </View>
      );
    }

    if (listItem.type === 'emptyReplies') {
      return renderTopicListItemFrame(
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <EmptyText text="暂无回复" styles={styles} />
        </View>
      );
    }

    return renderTopicListItemFrame(
      <View style={[styles.replyListItem, topicColumnStyle]}>
        <MemoizedReplyItem
          actionBusy={actionBusy}
          canUseDiscourseActions={canUseDiscourseInteractions}
          canWrite={canWrite}
          contentWidth={contentWidth}
          expandedQuotes={expandedQuotes}
          isActionPending={isOptimisticActionPending}
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
          styles={styles}
          theme={theme}
          topicAuthor={item?.author}
          onInteract={onInteract}
          onDeleteReply={onDeleteReply}
          onEditReply={onEditReply}
          onVotePoll={onVotePoll}
          onReplyToFloor={onReplyToFloor}
          onToggleReplyQuote={onToggleReplyQuote}
          topicId={item?.id}
          query={replyHighlightQuery}
          isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
          source={itemSource}
          onOpenUser={onOpenUser}
        />
      </View>
    );
  }, [
    actionBusy,
    canUseDiscourseInteractions,
    canWrite,
    commentQuery,
    contentWidth,
    expandedQuotes,
    inlineSizedImageUrls,
    item?.author,
    item?.id,
    topicImageDeriver,
    isOptimisticActionPending,
    loadedQuotedReplies,
    loadingQuotedFloors,
    discourseEmojiUrls,
    newReplyFloorStart,
    onCommentQueryChange,
    onDeleteReply,
    onEditReply,
    onInteract,
    onReplyComposerOpenChange,
    onReplyFilterChange,
    onReplyToFloor,
    onToggleReplyQuote,
    onOpenUser,
    onVotePoll,
    pollSelections,
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
    unreadReplyCount
  ]);

  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }

  const topicHeaderStatusBadges = topicStatusBadges(item);
  const itemAccessRequirementText = forumAccessRequirementText(item.accessRequirement);
  const topicReadableError = topicError ? readableTopicError(topicError.message) : '';
  const topicAuthNotice = topicError ? authNoticeForSourceError(topicError) : null;
  const topicAuthNoticeBoxStyle = topicAuthNotice?.tone === 'danger'
    ? styles.authNoticeBoxDanger
    : topicAuthNotice?.tone === 'warning'
      ? styles.authNoticeBoxWarning
      : styles.authNoticeBoxNeutral;
  const topicAuthNoticeTextStyle = topicAuthNotice?.tone === 'danger'
    ? styles.authNoticeTextDanger
    : topicAuthNotice?.tone === 'warning'
      ? styles.authNoticeTextWarning
      : styles.authNoticeTextNeutral;
  const topicReactionStats = topic?.source === 'nodeseek' && topic ? nodeSeekTopicReactionStats(topic) : [];
  const listHeader = (
    <View style={styles.topicHeaderStack}>
      <View style={[styles.article, topicColumnStyle]}>
        <View style={styles.topicMetaStack}>
          <View style={styles.topicBadgeRow}>
            <Text style={[styles.topicSourceBadge, sourceBadgeColorStyle(item.source, theme)]} numberOfLines={1}>{sourceLabel(item.source)}</Text>
            {item.category ? <Text style={styles.topicCategoryBadge} numberOfLines={1}>{item.category}</Text> : null}
          </View>
          <Text selectable style={styles.articleTitle}>{item.title}</Text>
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
            <Avatar contentSource={item.source} name={item.author} uri={item.authorAvatar} styles={styles} />
            <View style={styles.topicAuthorMeta}>
              <View style={styles.replyAuthorNameRow}>
                <Text style={styles.replyAuthor} numberOfLines={1}>{item.author || '未知作者'}</Text>
                {item.authorLevelLabel ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('neutral', theme)]} numberOfLines={1}>{item.authorLevelLabel}</Text> : null}
              </View>
              <Text style={styles.meta}>{formatDateTime(item.createdAt)} · {item.replyCount} 回复{item.viewCount ? ` · ${item.viewCount} 浏览` : ''}</Text>
            </View>
          </Pressable>
          {itemAccessRequirementText ? <Text style={styles.topicAccessBadge}>{itemAccessRequirementText}</Text> : null}
          {topicHeaderStatusBadges.length ? (
            <View style={styles.topicStatusRow}>
              {topicHeaderStatusBadges.map((badge) => (
                <View key={badge.label} style={[styles.topicStatusBadge, topicStatusBadgeColorStyle(badge.tone, theme)]}>
                  <Text style={[styles.topicStatusBadgeText, topicStatusBadgeTextColorStyle(badge.tone, theme)]} numberOfLines={1}>{badge.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {item.tags?.length ? (
            <View style={styles.topicTagRow}>
              {item.tags.map((tag, index) => (
                <View key={`${tag}-${index}`} style={[styles.topicTagPill, topicTagColorStyle(tag, theme)]}>
                  <Text style={[styles.topicTagText, topicTagTextColorStyle(tag, theme)]} numberOfLines={1}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        {topicError ? (
          <View style={topicAuthNotice ? [styles.authNoticeBox, topicAuthNoticeBoxStyle] : styles.errorBox}>
            <Text style={topicAuthNotice ? [styles.authNoticeText, topicAuthNoticeTextStyle] : styles.errorText}>{topicAuthNotice?.message || topicReadableError}</Text>
            <View style={styles.actions}>
              {item.source === 'linuxdo' && topicError.kind === 'verification-required' ? <AppButton label="去验证" styles={styles} onPress={onVerifyLinuxDo} /> : null}
              {item.source === 'nodeseek' && topicError.kind === 'verification-required' ? <AppButton label="去验证" styles={styles} onPress={onVerifyNodeSeek} /> : null}
              <AppButton label="重试" styles={styles} onPress={onRefreshWholeTopic} />
            </View>
          </View>
        ) : null}
        {!topic && !topicError ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : null}
      </View>
      {topicContentItems.map(renderTopicContentItem)}
      {topic && !isDiscourseSource(topic.source) && topic.source !== 'nodeseek' && !topicShowsAccessNotice && topicPolls.length ? renderTopicListItemFrame(
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.articleBody}>
            <TopicPolls
              actionBusy={actionBusy}
              canWritePollSource={canWriteTopicPollSource}
              embeddedInArticle
              keyPrefix="topic"
              onTogglePollSelection={togglePollSelection}
              onVotePoll={onVotePoll}
              pollSelections={pollSelections}
              polls={topicPolls}
              source={topic.source}
              styles={styles}
              theme={theme}
            />
          </View>
        </View>,
        'topic-polls'
      ) : null}
      {acceptedAnswer && !topicShowsAccessNotice ? renderTopicListItemFrame(
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <AcceptedAnswerPreview
            key={acceptedAnswer.instanceKey}
            contentSource={item.source}
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
            onReadMore={acceptedAnswerReply && acceptedAnswerIsInSourceReplies ? scrollToAcceptedAnswer : undefined}
          />
        </View>,
        `topic-accepted-answer-${acceptedAnswer.floor}`
      ) : null}
      {topicHasPostActions ? renderTopicListItemFrame(
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
              <DetailActionButton active={Boolean(topic?.upvoted)} tone="success" accessibilityLabel={topic?.upvoted ? '已点赞' : '点赞'} count={topic?.upvoteCount} icon={ThumbsUp} label="赞" pending={isOptimisticActionPending(topic?.commentId, 'upvote')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.liked)} tone="warning" accessibilityLabel={topic?.liked ? '已加鸡腿' : '加鸡腿'} count={topic?.likeCount} icon={Drumstick} label="鸡腿" pending={isOptimisticActionPending(topic?.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.disliked)} tone="danger" accessibilityLabel={topic?.disliked ? '已反对' : '反对'} count={topic?.dislikeCount} icon={ThumbsDown} label="反对" pending={isOptimisticActionPending(topic?.commentId, 'dislike')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('dislike', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.collected)} tone="favorite" accessibilityLabel={topic?.collected ? '取消原站收藏' : '原站收藏'} count={topic?.collectionCount} icon={BookMarked} label="收藏" pending={isOptimisticActionPending(topic?.id, 'collection')} styles={styles} theme={theme} disabled={actionBusy} onPress={onNodeSeekCollection} />
            </View>
          ) : null}
          {isDiscourseSource(topic?.source) && discourseTopicReactionStats.length ? (
            <View style={styles.topicStatRail}>
              {discourseTopicReactionStats.map((stat) => (
                <DiscourseReactionPill compact contentSource={topic?.source || null} key={stat.id} stat={stat} styles={styles} />
              ))}
            </View>
          ) : null}
          {canWriteYaohuo ? (
            <View style={styles.topicPrimaryActions}>
              <YaohuoFavoriteButton
                actionBusy={actionBusy}
                fallbackBookmarked={topic?.bookmarked}
                styles={styles}
                theme={theme}
                topicKey={detailTopicStateKey}
              />
            </View>
          ) : null}
          {canUseDiscourseInteractions ? (
            <View style={styles.topicPrimaryActions}>
              {canToggleDiscourseLike(topic) ? <DetailActionButton active={Boolean(topic?.liked)} tone="success" accessibilityLabel={topic?.liked ? '取消赞' : '点赞'} icon={ThumbsUp} label="赞" pending={isOptimisticActionPending(topic?.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} /> : null}
              <DetailActionButton active={Boolean(topic?.bookmarked)} tone="favorite" accessibilityLabel={topic?.bookmarked ? '取消原站收藏' : '原站收藏'} icon={BookMarked} label="收藏" pending={isOptimisticActionPending(topic?.id, 'bookmark')} styles={styles} theme={theme} disabled={actionBusy} onPress={onDiscourseBookmark} />
            </View>
          ) : null}
        </View>,
        'topic-actions'
      ) : null}
    </View>
  );

  return (
    <TRenderEngineProvider baseStyle={htmlBaseStyle} allowedStyles={HTML_ALLOWED_INLINE_STYLES} classesStyles={htmlClassesStyles} customHTMLElementModels={HTML_CUSTOM_ELEMENT_MODELS} ignoredStyles={htmlIgnoredStyles} tagsStyles={htmlTagsStyles} ignoredDomTags={HTML_IGNORED_DOM_TAGS}>
      <RenderHTMLConfigProvider
        renderers={genericHtmlRenderers}
        renderersProps={htmlRenderersProps}
        defaultTextProps={{ selectable: true }}
        enableExperimentalBRCollapsing
        enableExperimentalGhostLinesPrevention
        enableExperimentalMarginCollapsing
      >
        <View style={styles.topicScreenRoot}>
        <View style={styles.topicTopBar}>
          <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
          <Text style={styles.topicTopHint} numberOfLines={1}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
          <View style={styles.topicTopActions}>
            <IconButton iconOnly ghost icon={Star} label={topicFavorite ? '已收藏' : '收藏'} styles={styles} theme={theme} active={topicFavorite} activeColor={theme.favorite} onPress={() => onToggleFavorite(item)} />
            <IconButton iconOnly ghost icon={MoreHorizontal} label="更多操作" styles={styles} theme={theme} active={topicMenuOpen} onPress={() => setTopicMenuOpen((value) => !value)} />
          </View>
        </View>
        <FlashList
            ref={topicScrollRef}
            accessibilityLabel={topic ? '主题详情，已加载' : '主题详情'}
            testID={topic ? 'topic-detail-loaded' : undefined}
            style={[styles.content, styles.topicContent]}
            contentContainerStyle={styles.topicContentInner}
            data={replyListItems}
            keyExtractor={topicListItemKey}
            getItemType={topicListItemType}
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
            ListFooterComponent={canShowReplies && replyHasMore ? (
              <View style={styles.topicListItemFrame}>
                <View style={[styles.topicFooter, topicColumnStyle]}>
                  <AppButton label={loadingMoreReplies ? '正在加载...' : '加载更多回复'} styles={styles} disabled={loadingMoreReplies} onPress={requestReplyLoadMore} />
                </View>
              </View>
            ) : null}
            renderItem={renderReplyItem}
        />
        <TopicMenu
          onOpenOriginal={onOpenOriginal}
          onOpenReadingSettings={onOpenReadingSettings}
          onRefreshTopic={onRefreshTopic}
          onRefreshWholeTopic={onRefreshWholeTopic}
          onRequestClose={() => setTopicMenuOpen(false)}
          onShareTopic={onShareTopic}
          runTopicMenuAction={runTopicMenuAction}
          styles={styles}
          theme={theme}
          topicUrl={item.url}
          visible={topicMenuOpen}
        />
        <ReplyComposerSheet
          actionBusy={actionBusy}
          discourseEmojiUrls={discourseEmojiUrls}
          replyContent={replyContent}
          replyFace={replyFace}
          replyEditTarget={replyEditTarget}
          replyTarget={replyTarget}
          source={topic?.source}
          styles={styles}
          theme={theme}
          visible={Boolean(canOpenReplyComposer && replyComposerOpen)}
          onReplyComposerOpenChange={onReplyComposerOpenChange}
          onReplyContentChange={onReplyContentChange}
          onReplyFaceChange={onReplyFaceChange}
          onSubmitReply={onSubmitReply}
          onUploadReplyImage={replyImageUploadSupported(topic?.source) ? onUploadReplyImage : undefined}
        />
        </View>
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
});
