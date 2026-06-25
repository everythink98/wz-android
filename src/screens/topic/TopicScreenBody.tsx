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
import type { Reply, Topic, TopicDetail, TopicPoll, UserProfile } from '../../types';
import type { HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, ReplyFilter, ReplyTarget } from '../../appTypes';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '../../appUtils';
import { HTML_ALLOWED_INLINE_STYLES } from '../../htmlRenderingStyles';
import { INLINE_FORUM_IMAGE_TAG } from '../../htmlImages';
import { FORUM_REPLY_REFERENCE_TAG } from '../../topicContentHtml';
import { splitTopicContentHtml } from '../../topicContentSplit';
import { androidRipple, createStyles, sourceBadgeColorStyle, topicStatusBadgeColorStyle, topicStatusBadgeTextColorStyle, topicTagColorStyle, topicTagTextColorStyle, type ReaderTheme } from '../../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail, triggerPressFeedback } from '../../components/AppControls';
import { Avatar } from '../../components/Avatar';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '../../components/listPerformance';
import { topicWithAuthorFallback, userFromTopic } from '../../userNavigation';
import { topicActionStateKey, type InteractionType, type OptimisticActionState, type TopicActionStateKind } from '../../topicActionState';
import type { TopicImageDeriver } from '../../topicDerivedData';
import { authNoticeForMessage } from '../../siteSessionPrompts';
import { getLinuxDoEmojiUrls } from '../../localLinuxdo';
import { linuxDoReactionStats, type LinuxDoEmojiUrlMap } from '../../linuxdoReactions';
import { TopicPolls } from './TopicPolls';
import { DetailActionButton } from './TopicActionBar';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { LinuxDoReactionPill, MemoizedReplyItem, NodeSeekStatPill, nodeSeekTopicReactionStats } from './ReplyItem';
import { ReplyComposer } from './ReplyComposer';
import { TopicMenu } from './TopicMenu';
import { getReplyKey, isAccessNoticeHtml, readableTopicError, stableTextHash, topicStatusBadges } from './topicScreenHelpers';

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

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'noscript'];
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
  [FORUM_REPLY_REFERENCE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_REPLY_REFERENCE_TAG,
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
  inlineSizedImageUrls,
  topicImageDeriver
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
  topicImageDeriver: TopicImageDeriver;
}) {
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const topicLoading = topicBusy || (!topic && !topicError);
  const canShowReplies = Boolean(topic && !topicLoading);
  const canWriteNodeSeek = Boolean(topic && topic.source === 'nodeseek' && canUseNodeSeekActions);
  const canWriteYaohuo = Boolean(topic && topic.source === 'yaohuo' && canUseYaohuoActions);
  const canWriteLinuxDo = Boolean(topic && topic.source === 'linuxdo' && canUseLinuxDoActions);
  const canWrite = canWriteNodeSeek || canWriteYaohuo || canWriteLinuxDo;
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
  const [linuxDoEmojiUrls, setLinuxDoEmojiUrls] = useState<LinuxDoEmojiUrlMap>({});
  useEffect(() => {
    setPollSelections({});
  }, [item?.id, item?.source]);
  useEffect(() => {
    let cancelled = false;
    if (itemSource !== 'linuxdo') {
      setLinuxDoEmojiUrls({});
      return () => {
        cancelled = true;
      };
    }
    getLinuxDoEmojiUrls()
      .then((urls) => {
        if (!cancelled) {
          setLinuxDoEmojiUrls(urls);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinuxDoEmojiUrls({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemSource]);
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
              baseUrl={topicBaseUrl}
              contentWidth={contentWidth}
              inlineSizedImageUrls={inlineSizedImageUrls}
              html={listItem.html}
              topicImageDeriver={topicImageDeriver}
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
      const linuxDoTopicReactionStats = topic?.source === 'linuxdo' && topic ? linuxDoReactionStats(topic, linuxDoEmojiUrls) : [];
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
                <LinuxDoReactionPill compact key={stat.id} stat={stat} styles={styles} />
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
          linuxDoEmojiUrls={linuxDoEmojiUrls}
          topicImageDeriver={topicImageDeriver}
          topicBaseUrl={topicBaseUrl}
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
    inlineSizedImageUrls,
    topicImageDeriver,
    isOptimisticActionPending,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    linuxDoEmojiUrls,
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
    topicBaseUrl,
    topicColumnStyle
  ]);

  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }

  const topicHeaderStatusBadges = topicStatusBadges(item);
  const itemAccessRequirementText = forumAccessRequirementText(item.accessRequirement);
  const topicReadableError = topicError ? readableTopicError(topicError) : '';
  const topicAuthNotice = authNoticeForMessage(topicError) || authNoticeForMessage(topicReadableError);
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
            <Avatar name={item.author} uri={item.authorAvatar} styles={styles} />
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
          <View style={topicAuthNotice ? [styles.authNoticeBox, topicAuthNoticeBoxStyle] : styles.errorBox}>
            <Text style={topicAuthNotice ? [styles.authNoticeText, topicAuthNoticeTextStyle] : styles.errorText}>{topicAuthNotice?.message || topicReadableError}</Text>
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
