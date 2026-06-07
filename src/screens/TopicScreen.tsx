import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native';
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
import { BookMarked, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Drumstick, MoreHorizontal, Star, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import type { AccessRequirement, Reply, Source, Topic, TopicDetail, TopicPoll, UserProfile } from '../types';
import type { HtmlAllowedStyles, HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, ReplyFilter, ReplyTarget } from '../appTypes';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '../appUtils';
import { INLINE_FORUM_IMAGE_TAG } from '../htmlImages';
import { splitTopicContentHtml } from '../topicContentSplit';
import { androidRipple, createStyles, topicStatusBadgeColorStyle, topicStatusBadgeTextColorStyle, topicTagColorStyle, topicTagTextColorStyle, type ReaderTheme, type StatusBadgeTone } from '../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail, triggerPressFeedback } from '../components/AppControls';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';
import { topicWithAuthorFallback, userFromTopic } from '../userNavigation';
import { topicActionStateKey, type InteractionType, type OptimisticActionState, type TopicActionStateKind } from '../topicActionState';
import { TopicPolls } from './topic/TopicPolls';
import { DetailActionButton } from './topic/TopicActionBar';
import { MemoizedTopicContentBlock } from './topic/TopicContentBlock';
import { AuthorAvatar, MemoizedReplyItem, NodeSeekStatPill, linuxDoReactionStats, nodeSeekTopicReactionStats } from './topic/ReplyItem';
import { ReplyComposer } from './topic/ReplyComposer';
import { TopicMenu } from './topic/TopicMenu';

type TopicListContentItem = { type: 'content'; key: string; html: string };
export type TopicListItem =
  | TopicListContentItem
  | { type: 'accessNotice'; key: string; label: string; detail: string }
  | { type: 'topicPolls'; key: string }
  | { type: 'topicActions'; key: string }
  | { type: 'replyControls'; key: string }
  | { type: 'replyComposer'; key: string; replyFloor?: number }
  | { type: 'emptyReplies'; key: string }
  | { type: 'reply'; key: string; reply: Reply; replyFloor: number };

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'iframe', 'noscript'];
const HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = ['fontWeight', 'fontStyle', 'textAlign', 'textDecorationLine'];
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

function stableTextHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getReplyKey(reply: Reply) {
  if (typeof reply.floor === 'number') {
    return `reply-floor-${reply.floor}`;
  }
  if (typeof reply.commentId === 'number') {
    return `reply-comment-${reply.commentId}`;
  }
  const seed = [
    reply.authorId || '',
    reply.author || '',
    reply.createdAt || '',
    reply.contentHtml || ''
  ].join('|');
  return `reply-${stableTextHash(seed || JSON.stringify(reply))}`;
}

type TopicStatusBadge = { label: string; tone: StatusBadgeTone };

function slowModeLabel(seconds: number) {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

function topicStatusBadges(item: Pick<Topic, 'acceptedAnswerFloor' | 'archived' | 'closed' | 'pinned' | 'slowModeSeconds' | 'solved'>) {
  const badges: TopicStatusBadge[] = [];
  if (item.solved) {
    badges.push({ label: '已解决', tone: 'success' });
  }
  if (item.acceptedAnswerFloor) {
    badges.push({ label: `采纳 #${item.acceptedAnswerFloor}`, tone: 'success' });
  }
  if (item.pinned) {
    badges.push({ label: '置顶', tone: 'accent' });
  }
  if (item.closed) {
    badges.push({ label: '已关闭', tone: 'danger' });
  }
  if (item.archived) {
    badges.push({ label: '已归档', tone: 'neutral' });
  }
  if (item.slowModeSeconds) {
    badges.push({ label: `慢速 ${slowModeLabel(item.slowModeSeconds)}`, tone: 'warning' });
  }
  return badges;
}


function topicListItemKey(item: TopicListItem) {
  return item.key;
}

function readableTopicError(message: string) {
  if (/upstream unavailable/i.test(message)) {
    return '来源暂时不可用，请稍后重试';
  }
  if (/^HTTP 5\d\d$/i.test(message)) {
    return `来源暂时不可用（${message}）`;
  }
  return message;
}

function plainHtmlText(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAccessNoticeHtml(html: string, accessRequirement?: AccessRequirement) {
  if (!accessRequirement) {
    return false;
  }
  const text = plainHtmlText(html);
  if (text.length > 240) {
    return false;
  }
  return !text || /查看本帖需要|权限不足|权限不够|没有权限|暂无权限|无权限|无权(?:查看|访问|阅读)|无访问权限|当前用户组不可(?:查看|访问|阅读)|游客不可见|登录后(?:才能|可见)|需要[^。；\n]{0,24}(?:等级|Lv|level)|requires?[^.]{0,40}(?:trust\s+level|level\s*(?:of\s+|[:：#-]\s*)?\d+)|minimum (?:trust\s+level|level\s*(?:of\s+|[:：#-]\s*)?\d+)|must be (?:at least )?(?:trust\s+level|level\s*(?:of\s+|[:：#-]\s*)?\d+)|permission denied|access denied|insufficient privileges|not allowed|not permitted|forbidden|(?:private|restricted)\s+(?:topic|category)|(?:topic|category)\s+is\s+(?:private|restricted)|not authorized|you do not have permission|you don't have permission/i.test(text);
}

export function TopicScreen({
  actionBusy,
  canUseLinuxDoActions,
  canUseNodeSeekActions,
  canUseYaohuoActions,
  contentWidth,
  htmlBaseStyle,
  htmlIgnoredStyles,
  htmlRenderers,
  htmlRenderersProps,
  htmlTagsStyles,
  expandedQuotesRef,
  loadedQuotedRepliesRef,
  loadingMoreReplies,
  loadingQuotedFloorsRef,
  commentQuery,
  quoteStateVersion,
  replyComposerOpen,
  replyContent,
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
  onInteract,
  onLinuxDoBookmark,
  onNodeSeekCollection,
  onShareTopic,
  onYaohuoFavorite,
  onVotePoll,
  onLoadMoreReplies,
  onOpenOriginal,
  onOpenReadingSettings,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFilterChange,
  onReplyToFloor,
  onRefreshTopic,
  onRefreshWholeTopic,
  onVerifyLinuxDo,
  onSubmitReply,
  onTopicScroll,
  onToggleQuotedFloor,
  onToggleFavorite,
  onOpenUser,
  inlineSizedImageUrls
}: {
  actionBusy: boolean;
  canUseLinuxDoActions: boolean;
  canUseNodeSeekActions: boolean;
  canUseYaohuoActions: boolean;
  contentWidth: number;
  htmlBaseStyle: HtmlBaseStyle;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRenderers: HtmlRenderers;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  expandedQuotesRef: RefObject<Record<string, boolean>>;
  loadedQuotedRepliesRef: RefObject<Record<number, Reply>>;
  loadingMoreReplies: boolean;
  loadingQuotedFloorsRef: RefObject<Record<string, boolean>>;
  commentQuery: string;
  quoteStateVersion: number;
  replyComposerOpen: boolean;
  replyContent: string;
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
  topicError: string;
  topicFavorite: boolean;
  topicScrollRef: RefObject<FlatList<TopicListItem> | null>;
  unreadReplyCount: number;
  onBack: () => void;
  onCommentQueryChange: (value: string) => void;
  optimisticActions: Record<string, OptimisticActionState>;
  onInteract: (type: InteractionType, commentId?: number) => void;
  onLinuxDoBookmark: () => void;
  onNodeSeekCollection: () => void;
  onShareTopic: () => void;
  onYaohuoFavorite: () => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  onLoadMoreReplies: () => void;
  onOpenOriginal: (url: string) => void;
  onOpenReadingSettings: () => void;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
  onReplyToFloor: (reply: Reply) => void;
  onRefreshTopic: () => void;
  onRefreshWholeTopic: () => void;
  onVerifyLinuxDo: () => void;
  onSubmitReply: () => void;
  onTopicScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
  onToggleFavorite: (topic: Topic) => void;
  onOpenUser: (user: UserProfile) => void;
  inlineSizedImageUrls: Record<string, true>;
}) {
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const topicLoading = topicBusy || (!topic && !topicError);
  const canShowReplies = Boolean(topic && !topicLoading);
  const canWriteNodeSeek = Boolean(topic && topic.source === 'nodeseek' && canUseNodeSeekActions);
  const canWriteYaohuo = Boolean(topic && topic.source === 'yaohuo' && canUseYaohuoActions);
  const canWriteLinuxDo = Boolean(topic && topic.source === 'linuxdo' && canUseLinuxDoActions);
  const canWrite = canWriteNodeSeek || canWriteYaohuo || canWriteLinuxDo;
  const itemSource = topic?.source;
  const detailTopicStateKey = topic ? `${topic.source}:${topic.id}` : item ? `${item.source}:${item.id}` : '';
  const isOptimisticActionPending = useCallback((targetId: string | number | undefined, action: TopicActionStateKind) => {
    if (!detailTopicStateKey || !targetId) {
      return false;
    }
    return Boolean(optimisticActions[topicActionStateKey({ topicKey: detailTopicStateKey, targetId, action })]?.inFlight);
  }, [detailTopicStateKey, optimisticActions]);
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const autoLoadRepliesArmedRef = useRef(false);
  const topicScrollRetryIdRef = useRef(0);
  const repliesByFloor = useMemo(() => {
    const next = new Map<number, Reply>();
    sourceReplies.forEach((reply) => {
      if (typeof reply.floor === 'number') {
        next.set(reply.floor, reply);
      }
    });
    Object.values(loadedQuotedRepliesRef.current).forEach((reply) => {
      if (reply.floor) {
        next.set(reply.floor, reply);
      }
    });
    return next;
  }, [loadedQuotedRepliesRef, quoteStateVersion, sourceReplies]);
  const [floorOpen, setFloorOpen] = useState(false);
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
  useEffect(() => {
    setPollSelections({});
  }, [item?.id, item?.source]);
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
  const topicPolls = topic?.polls || [];
  const topicAccessRequirementText = topic?.accessRequirement ? forumAccessRequirementText(topic.accessRequirement) : '';
  const topicAccessRequirementDetail = topic?.accessRequirement?.detail || '当前账号暂无权限查看这个帖子';
  const topicShowsAccessNotice = Boolean(topic && isAccessNoticeHtml(topicContentHtml, topic.accessRequirement));
  const topicContentItems = useMemo<TopicListItem[]>(() => (
    topic
      ? topicShowsAccessNotice
        ? [{
          type: 'accessNotice',
          key: 'topic-access-notice',
          label: topicAccessRequirementText,
          detail: topicAccessRequirementDetail
        }]
        : splitTopicContentHtml(topicContentHtml).map((html, index) => ({
          type: 'content',
          key: `topic-content-${index}-${stableTextHash(html)}`,
          html
        }))
      : []
  ), [topic, topicAccessRequirementDetail, topicAccessRequirementText, topicContentHtml, topicShowsAccessNotice]);
  const replyItems = useMemo<TopicListItem[]>(() => replies.map((reply) => ({
    type: 'reply',
    key: getReplyKey(reply),
    reply,
    replyFloor: reply.floor ?? 0
  })), [replies]);
  const canWriteTopicPollSource = Boolean(
    topic
    && (
      (topic.source === 'nodeseek' && canWriteNodeSeek)
      || (topic.source === 'linuxdo' && canWriteLinuxDo)
      || (topic.source === 'yaohuo' && canWriteYaohuo)
    )
  );
  const topicHasPostActions = Boolean(topic && !topicShowsAccessNotice && (
    (topic.source === 'nodeseek' && (canWriteNodeSeek || nodeSeekTopicReactionStats(topic).length > 0))
    || (topic.source === 'linuxdo' && (canWriteLinuxDo || linuxDoReactionStats(topic).length > 0))
    || (topic.source === 'yaohuo' && canWriteYaohuo)
  ));
  const topicListItems = useMemo<TopicListItem[]>(() => {
    const items = [...topicContentItems];
    if (topic && !topicShowsAccessNotice) {
      if (topicPolls.length) {
        items.push({ type: 'topicPolls', key: 'topic-polls' });
      }
    }
    if (topicHasPostActions) {
      items.push({ type: 'topicActions', key: 'topic-actions' });
    }
    if (canShowReplies && !topicShowsAccessNotice) {
      items.push({ type: 'replyControls', key: 'reply-controls' });
      const targetReplyVisible = replyTarget ? replyItems.some((entry) => entry.type === 'reply' && entry.replyFloor === replyTarget.floor) : false;
      if (canWrite && replyComposerOpen && !replyTarget) {
        items.push({ type: 'replyComposer', key: 'reply-composer' });
      }
      if (canWrite && replyComposerOpen && replyTarget && !targetReplyVisible) {
        items.push({ type: 'replyComposer', key: `reply-composer-hidden-target-${replyTarget.floor}`, replyFloor: replyTarget.floor });
      }
      if (replyItems.length) {
        replyItems.forEach((entry) => {
          items.push(entry);
          const isTargetReply = replyTarget && entry.type === 'reply' && entry.replyFloor === replyTarget.floor;
          if (canWrite && replyComposerOpen && isTargetReply) {
            items.push({ type: 'replyComposer', key: `reply-composer-${entry.replyFloor}`, replyFloor: entry.replyFloor });
          }
        });
      } else {
        items.push({ type: 'emptyReplies', key: 'empty-replies' });
      }
    }
    return items;
  }, [canShowReplies, canWrite, replyComposerOpen, replyItems, replyTarget, topic, topicContentItems, topicHasPostActions, topicPolls.length, topicShowsAccessNotice]);
  const jumpToFloor = useCallback((floor: number) => {
    topicScrollRetryIdRef.current += 1;
    const index = topicListItems.findIndex((entry) => entry.type === 'reply' && entry.replyFloor === floor);
    if (index >= 0) {
      topicScrollRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.08 });
      setFloorOpen(false);
    }
  }, [topicListItems, topicScrollRef]);
  const handleTopicScrollToIndexFailed = useCallback(({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    const retryId = ++topicScrollRetryIdRef.current;
    const offset = Math.max(0, averageItemLength * index);
    topicScrollRef.current?.scrollToOffset({ offset, animated: true });
    setTimeout(() => {
      if (topicScrollRetryIdRef.current !== retryId) {
        return;
      }
      topicScrollRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.08 });
    }, 80);
  }, [topicScrollRef]);
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
  }, [item?.id, item?.source]);
  useEffect(() => {
    topicScrollRetryIdRef.current += 1;
  }, [item?.id, item?.source]);
  useEffect(() => {
    topicScrollRetryIdRef.current += 1;
  }, [topicListItems]);
  const runTopicMenuAction = useCallback((action: () => void) => {
    triggerPressFeedback();
    setTopicMenuOpen(false);
    action();
  }, []);
  const topicHtmlRenderers = useMemo<HtmlRenderers>(() => {
    const QuoteAsideRenderer: CustomBlockRenderer = (props) => {
      const [expanded, setExpanded] = useState(false);
      const tchildrenProps = useTNodeChildrenProps(props);
      const { TDefaultRenderer, ...defaultRendererProps } = props;
      if (!hasHtmlClass(props.tnode, 'quote')) {
        return <TDefaultRenderer {...defaultRendererProps} />;
      }

      const quoteTitleChildren = props.tnode.children.filter((child) => htmlTagName(child) === 'div' && hasHtmlClass(child, 'title'));
      const quoteHeaderChildren = quoteTitleChildren.length ? quoteTitleChildren : props.tnode.children.slice(0, 1);
      const quoteBodyChildren = props.tnode.children.filter((child) => !quoteHeaderChildren.includes(child));
      const StateIcon = expanded ? ChevronUp : ChevronDown;

      return (
        <View style={styles.quoteBox}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            android_ripple={androidRipple(theme.primarySoft)}
            disabled={!quoteBodyChildren.length}
            style={styles.quotePanelHeader}
            onPress={() => setExpanded((value) => !value)}
          >
            <View style={styles.quoteAuthorSummary}>
              <TChildrenRenderer {...tchildrenProps} tchildren={quoteHeaderChildren} />
            </View>
            {quoteBodyChildren.length ? (
              <View style={styles.quotePanelState}>
                <Text style={styles.quotePanelStateText}>{expanded ? '收起' : '展开'}</Text>
                <View style={styles.quotePanelStateIcon}>
                  <StateIcon size={16} color={theme.primary} strokeWidth={1.9} />
                </View>
              </View>
            ) : null}
          </Pressable>
          {expanded && quoteBodyChildren.length ? (
            <View style={[styles.quoteBody, styles.quotePanelBody]}>
              <TChildrenRenderer {...tchildrenProps} tchildren={quoteBodyChildren} />
            </View>
          ) : null}
        </View>
      );
    };
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
    return { ...htmlRenderers, aside: QuoteAsideRenderer, details: DetailsRenderer, summary: SummaryRenderer, table: TableRenderer };
  }, [htmlRenderers, styles, theme.ink, theme.primary, theme.primarySoft]);
  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(({ item: listItem }) => {
    if (listItem.type === 'accessNotice') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.topicAccessNotice}>
            {listItem.label ? <Text style={styles.topicAccessBadge}>{listItem.label}</Text> : null}
            <Text style={styles.topicAccessNoticeTitle}>暂无权限</Text>
            <Text style={styles.topicAccessNoticeDetail}>{listItem.detail}</Text>
          </View>
        </View>
      );
    }

    if (listItem.type === 'content') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.articleBody}>
            <MemoizedTopicContentBlock
              contentWidth={contentWidth}
              inlineSizedImageUrls={inlineSizedImageUrls}
              html={listItem.html}
            />
          </View>
        </View>
      );
    }

    if (listItem.type === 'replyControls') {
      return (
        <View style={[styles.replyHeader, topicColumnStyle]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>回复列表 <Text style={styles.countText}>{sourceReplies.length} 条</Text></Text>
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
          <View style={styles.actions}>
            <AppButton compact label={floorOpen ? '收起楼层目录' : '楼层目录'} variant="ghost" styles={styles} onPress={() => setFloorOpen((value) => !value)} />
          </View>
          {floorOpen ? (
            <View style={styles.floorIndex}>
              {replies.map((reply, index) => {
                const floor = reply.floor ?? index + 1;
                return (
                  <Pressable key={`${floor}-${reply.createdAt}`} accessibilityRole="button" style={styles.floorIndexItem} onPress={() => jumpToFloor(floor)}>
                    <Text style={styles.meta}>#{floor} {reply.author || '未知作者'}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      );
    }

    if (listItem.type === 'topicPolls') {
      return (
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
              source={topic?.source}
              styles={styles}
              theme={theme}
            />
          </View>
        </View>
      );
    }

    if (listItem.type === 'topicActions') {
      const topicReactionStats = topic?.source === 'nodeseek' && topic ? nodeSeekTopicReactionStats(topic) : [];
      const linuxDoTopicReactionStats = topic?.source === 'linuxdo' && topic ? linuxDoReactionStats(topic) : [];
      return (
        <View style={[styles.topicPostActionArea, topicColumnStyle]}>
          {topic?.source === 'nodeseek' && !canWriteNodeSeek && topicReactionStats.length ? (
            <View style={styles.topicStatRail}>
              {topicReactionStats.map((stat) => (
                <NodeSeekStatPill key={stat.label} label={stat.label} value={stat.value} styles={styles} />
              ))}
            </View>
          ) : null}
          {canWriteNodeSeek ? (
            <View style={styles.topicPrimaryActions}>
              <DetailActionButton active={Boolean(topic?.upvoted)} accessibilityLabel={topic?.upvoted ? '已点赞' : '点赞'} count={topic?.upvoteCount} icon={ThumbsUp} label="赞" pending={isOptimisticActionPending(topic?.commentId, 'upvote')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.liked)} accessibilityLabel={topic?.liked ? '已加鸡腿' : '加鸡腿'} count={topic?.likeCount} icon={Drumstick} label="鸡腿" pending={isOptimisticActionPending(topic?.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.disliked)} accessibilityLabel={topic?.disliked ? '已反对' : '反对'} count={topic?.dislikeCount} icon={ThumbsDown} label="反对" pending={isOptimisticActionPending(topic?.commentId, 'dislike')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('dislike', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.collected)} accessibilityLabel={topic?.collected ? '取消原站收藏' : '原站收藏'} count={topic?.collectionCount} icon={BookMarked} label="收藏" pending={isOptimisticActionPending(topic?.id, 'collection')} styles={styles} theme={theme} disabled={actionBusy} onPress={onNodeSeekCollection} />
            </View>
          ) : null}
          {topic?.source === 'linuxdo' && linuxDoTopicReactionStats.length ? (
            <View style={styles.topicStatRail}>
              {linuxDoTopicReactionStats.map((stat) => (
                <NodeSeekStatPill compact key={stat.label} label={stat.label} value={stat.value} styles={styles} />
              ))}
            </View>
          ) : null}
          {canWriteYaohuo ? (
            <View style={styles.topicPrimaryActions}>
              <DetailActionButton accessibilityLabel="原站收藏" icon={BookMarked} label="收藏" styles={styles} theme={theme} disabled={actionBusy} onPress={onYaohuoFavorite} />
            </View>
          ) : null}
          {canWriteLinuxDo ? (
            <View style={styles.topicPrimaryActions}>
              <DetailActionButton active={Boolean(topic?.liked)} accessibilityLabel={topic?.liked ? '取消赞' : '点赞'} icon={ThumbsUp} label="赞" pending={isOptimisticActionPending(topic?.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.bookmarked)} accessibilityLabel={topic?.bookmarked ? '取消原站收藏' : '原站收藏'} icon={BookMarked} label="收藏" pending={isOptimisticActionPending(topic?.id, 'bookmark')} styles={styles} theme={theme} disabled={actionBusy} onPress={onLinuxDoBookmark} />
            </View>
          ) : null}
        </View>
      );
    }

    if (listItem.type === 'replyComposer') {
      return (
        <ReplyComposer
          actionBusy={actionBusy}
          replyContent={replyContent}
          replyTarget={replyTarget}
          styles={styles}
          theme={theme}
          topicColumnStyle={topicColumnStyle}
          onReplyComposerOpenChange={onReplyComposerOpenChange}
          onReplyContentChange={onReplyContentChange}
          onSubmitReply={onSubmitReply}
        />
      );
    }

    if (listItem.type === 'emptyReplies') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <EmptyText text="暂无回复" styles={styles} />
        </View>
      );
    }

    return (
      <View style={[styles.replyListItem, topicColumnStyle]}>
        <MemoizedReplyItem
          actionBusy={actionBusy}
          canWrite={canWrite}
          contentWidth={Math.max(240, contentWidth - 28)}
          expandedQuotes={expandedQuotesRef.current}
          isActionPending={isOptimisticActionPending}
          inlineSizedImageUrls={inlineSizedImageUrls}
          loadedQuotedReplies={loadedQuotedRepliesRef.current}
          loadingQuotedFloors={loadingQuotedFloorsRef.current}
          onTogglePollSelection={togglePollSelection}
          reply={listItem.reply}
          replyFloor={listItem.replyFloor}
          pollSelections={pollSelections}
          repliesByFloor={repliesByFloor}
          styles={styles}
          theme={theme}
          topicAuthor={item?.author}
          onInteract={onInteract}
          onVotePoll={onVotePoll}
          onReplyToFloor={onReplyToFloor}
          onToggleQuotedFloor={onToggleQuotedFloor}
          query={commentQuery}
          isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
          source={itemSource}
          onOpenUser={onOpenUser}
        />
      </View>
    );
  }, [
    actionBusy,
    canWrite,
    canWriteLinuxDo,
    canWriteNodeSeek,
    canWriteYaohuo,
    commentQuery,
    contentWidth,
    expandedQuotesRef,
    floorOpen,
    inlineSizedImageUrls,
    isOptimisticActionPending,
    jumpToFloor,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    newReplyFloorStart,
    onCommentQueryChange,
    onInteract,
    onLinuxDoBookmark,
    onNodeSeekCollection,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onReplyFilterChange,
    onReplyToFloor,
    onSubmitReply,
    onToggleQuotedFloor,
    onOpenUser,
    onYaohuoFavorite,
    onVotePoll,
    pollSelections,
    quoteStateVersion,
    itemSource,
    replyComposerOpen,
    replyContent,
    replyFilter,
    replyTarget,
    repliesByFloor,
    sourceReplies.length,
    styles,
    theme,
    togglePollSelection,
    topic,
    topicColumnStyle
  ]);

  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }

  const topicHeaderStatusBadges = topicStatusBadges(item);
  const itemAccessRequirementText = forumAccessRequirementText(item.accessRequirement);
  const listHeader = (
    <View style={styles.topicHeaderStack}>
      <View style={[styles.article, topicColumnStyle]}>
        <View style={styles.topicMetaStack}>
          <Text style={styles.sourceText}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
          <Text selectable style={styles.articleTitle}>{item.title}</Text>
          <Pressable
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
            <AuthorAvatar name={item.author} uri={item.authorAvatar} styles={styles} />
            <View style={styles.topicAuthorMeta}>
              <Text style={styles.replyAuthor} numberOfLines={1}>{item.author || '未知作者'}</Text>
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
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{readableTopicError(topicError)}</Text>
            <View style={styles.actions}>
              {item.source === 'linuxdo' && topicError.includes('Cloudflare') ? <AppButton label="去验证" styles={styles} onPress={onVerifyLinuxDo} /> : null}
              <AppButton label="重试" styles={styles} onPress={onRefreshWholeTopic} />
            </View>
          </View>
        ) : null}
        {!topic && !topicError ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : null}
      </View>
    </View>
  );

  return (
    <TRenderEngineProvider baseStyle={htmlBaseStyle} allowedStyles={HTML_ALLOWED_INLINE_STYLES} customHTMLElementModels={HTML_CUSTOM_ELEMENT_MODELS} ignoredStyles={htmlIgnoredStyles} tagsStyles={htmlTagsStyles} ignoredDomTags={HTML_IGNORED_DOM_TAGS}>
      <RenderHTMLConfigProvider
        renderers={topicHtmlRenderers}
        renderersProps={htmlRenderersProps}
        defaultTextProps={{ selectable: true }}
        enableExperimentalBRCollapsing
        enableExperimentalGhostLinesPrevention
        enableExperimentalMarginCollapsing
      >
        <View style={styles.topicTopBar}>
          <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
          <Text style={styles.topicTopHint} numberOfLines={1}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
          <View style={styles.topicTopActions}>
            <IconButton iconOnly ghost icon={Star} label={topicFavorite ? '已收藏' : '收藏'} styles={styles} theme={theme} active={topicFavorite} onPress={() => onToggleFavorite(item)} />
            <IconButton iconOnly ghost icon={MoreHorizontal} label="更多操作" styles={styles} theme={theme} active={topicMenuOpen} onPress={() => setTopicMenuOpen((value) => !value)} />
          </View>
        </View>
        <FlatList
          ref={topicScrollRef}
          style={[styles.content, styles.topicContent]}
          contentContainerStyle={[styles.contentInner, styles.topicContentInner]}
          data={topicListItems}
          keyExtractor={topicListItemKey}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={onTopicScroll}
          onScrollEndDrag={onTopicScroll}
          onEndReachedThreshold={0.55}
          onEndReached={handleReplyEndReached}
          onScrollBeginDrag={armReplyAutoLoad}
          onMomentumScrollBegin={armReplyAutoLoad}
          onScrollToIndexFailed={handleTopicScrollToIndexFailed}
          extraData={quoteStateVersion}
          {...TOPIC_DETAIL_LIST_PERFORMANCE_PROPS}
          ListHeaderComponent={listHeader}
          ListFooterComponent={canShowReplies && replyHasMore ? (
            <View style={[styles.topicFooter, topicColumnStyle]}>
              <AppButton label={loadingMoreReplies ? '正在加载...' : '加载更多回复'} styles={styles} disabled={loadingMoreReplies} onPress={requestReplyLoadMore} />
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
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
}
