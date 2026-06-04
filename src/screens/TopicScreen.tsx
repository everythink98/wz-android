import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import {
  HTMLContentModel,
  HTMLElementModel,
  RenderHTMLConfigProvider,
  RenderHTMLSource,
  TChildrenRenderer,
  TRenderEngineProvider,
  useTNodeChildrenProps,
  type CustomBlockRenderer
} from 'react-native-render-html';
import { SvgXml } from 'react-native-svg';
import { BookMarked, CheckCircle, CheckSquare, ChevronDown, ChevronLeft, ChevronUp, Circle, Drumstick, ExternalLink, MessageCircle, MoreHorizontal, RefreshCw, Settings, Share2, Square, Star, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import type { ReaderData } from '../readerData';
import { isFavorite } from '../readerData';
import type { AccessRequirement, Reply, Source, Topic, TopicDetail, TopicPoll, UserProfile } from '../types';
import type { HtmlAllowedStyles, HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, ReplyFilter, ReplyTarget } from '../appTypes';
import { highlightHtml } from '../androidFeatureHelpers';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '../appUtils';
import { loadRemoteAvatarSvgText } from '../avatarImages';
import { flowInlineImagesInMixedParagraphs, imageSourceFromUrl, INLINE_FORUM_IMAGE_TAG, markInlineSizedImageHtml } from '../htmlImages';
import { splitTopicContentHtml } from '../topicContentSplit';
import { androidRipple, createStyles, replyContextBadgeStyle, topicStatusBadgeColorStyle, topicStatusBadgeTextColorStyle, topicTagColorStyle, topicTagTextColorStyle, type ReaderTheme, type StatusBadgeTone } from '../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail, triggerPressFeedback } from '../components/AppControls';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';
import { topicWithAuthorFallback, userFromReply, userFromTopic } from '../userNavigation';
import type { InteractionType } from '../topicActionState';

type TopicListContentItem = { type: 'content'; key: string; html: string };
export type TopicListItem =
  | TopicListContentItem
  | { type: 'accessNotice'; key: string; label: string; detail: string }
  | { type: 'topicActions'; key: string }
  | { type: 'replyControls'; key: string }
  | { type: 'replyComposer'; key: string; replyFloor?: number }
  | { type: 'emptyReplies'; key: string }
  | { type: 'reply'; key: string; reply: Reply; replyFloor: number };

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'iframe', 'noscript'];
const HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = ['fontWeight', 'fontStyle', 'textAlign', 'textDecorationLine'];
const HTML_CUSTOM_ELEMENT_MODELS = {
  [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: INLINE_FORUM_IMAGE_TAG,
    contentModel: HTMLContentModel.textual,
    isOpaque: true
  })
};

function htmlTagName(tnode: unknown) {
  return ((tnode as { tagName?: string }).tagName || '').toLowerCase();
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

type NodeSeekStat = { label: string; value: number };
type TopicStatusBadge = { label: string; tone: StatusBadgeTone };

const LINUXDO_REACTION_LABELS: Record<string, string> = {
  clap: '鼓掌',
  confused: '困惑',
  cry: '难过',
  distorted_face: '难绷',
  eyes: '关注',
  heart: '喜欢',
  laughing: '笑',
  open_mouth: '惊讶',
  rocket: '火箭'
};

function visibleNodeSeekStat(label: string, value: number | undefined): NodeSeekStat | null {
  return typeof value === 'number' ? { label, value } : null;
}

function nodeSeekReactionStats(item: Pick<Reply | TopicDetail, 'upvoteCount' | 'likeCount' | 'dislikeCount'>) {
  return [
    visibleNodeSeekStat('点赞', item.upvoteCount),
    visibleNodeSeekStat('鸡腿', item.likeCount),
    visibleNodeSeekStat('反对', item.dislikeCount)
  ].filter((stat): stat is NodeSeekStat => Boolean(stat));
}

function nodeSeekTopicReactionStats(item: Pick<TopicDetail, 'upvoteCount' | 'likeCount' | 'dislikeCount' | 'collectionCount'>) {
  return [
    ...nodeSeekReactionStats(item),
    visibleNodeSeekStat('原站收藏', item.collectionCount)
  ].filter((stat): stat is NodeSeekStat => Boolean(stat));
}

function nodeSeekTopicPassiveStats(item: Pick<TopicDetail, 'dislikeCount' | 'collectionCount'>) {
  return [
    visibleNodeSeekStat('反对', item.dislikeCount),
    visibleNodeSeekStat('原站收藏', item.collectionCount)
  ].filter((stat): stat is NodeSeekStat => Boolean(stat));
}

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

function linuxDoReactionLabel(id: string) {
  return LINUXDO_REACTION_LABELS[id] || id.replace(/_/g, ' ');
}

function linuxDoReactionStats(item: Pick<Reply | TopicDetail, 'boostCount' | 'reactionSummary'>) {
  return [
    ...(item.reactionSummary || []).map((reaction) => ({ label: linuxDoReactionLabel(reaction.id), value: reaction.count })),
    visibleNodeSeekStat('加电', item.boostCount)
  ].filter((stat): stat is NodeSeekStat => Boolean(stat));
}

function topicPollKey(poll: TopicPoll, index: number) {
  return poll.id || poll.name || `poll-${index}`;
}

function pollTotalVotes(poll: TopicPoll) {
  return poll.options.reduce((total, option) => total + (typeof option.count === 'number' ? option.count : 0), 0);
}

function pollChoiceRangeLabel(poll: TopicPoll) {
  if (!poll.multiple) {
    return undefined;
  }
  return [
    typeof poll.min === 'number' ? `至少 ${poll.min} 项` : undefined,
    typeof poll.max === 'number' ? `最多 ${poll.max} 项` : undefined
  ].filter(Boolean).join('，') || undefined;
}

function pollTypeLabel(poll: TopicPoll) {
  const labels: Record<string, string> = {
    ranked_choice: '排序投票',
    number: '数字投票'
  };
  return (poll.type ? labels[poll.type] : undefined) || (poll.multiple ? '多选' : '单选');
}

function pollSelectionRangeStatus(poll: TopicPoll, selectedCount: number) {
  if (!poll.multiple) {
    return undefined;
  }
  if (typeof poll.min === 'number' && selectedCount > 0 && selectedCount < poll.min) {
    return `至少选择 ${poll.min} 项`;
  }
  if (typeof poll.max === 'number' && selectedCount > poll.max) {
    return `最多选择 ${poll.max} 项`;
  }
  return undefined;
}

function PollBlockList({
  actionBusy,
  canWritePollSource,
  keyPrefix,
  onTogglePollSelection,
  onVotePoll,
  pollSelections,
  polls,
  source,
  styles,
  theme
}: {
  actionBusy: boolean;
  canWritePollSource: boolean;
  keyPrefix: string;
  onTogglePollSelection: (key: string, poll: TopicPoll, optionId: string) => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  pollSelections: Record<string, string[]>;
  polls: TopicPoll[];
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
}) {
  if (!polls.length) {
    return null;
  }
  const canVotePollSource = source === 'nodeseek' || source === 'linuxdo' || source === 'yaohuo';
  return (
    <View style={styles.pollStack}>
      {polls.map((poll, index) => {
        const pollKey = `${keyPrefix}-${topicPollKey(poll, index)}`;
        const hasCounts = poll.options.some((option) => typeof option.count === 'number');
        const totalVotes = pollTotalVotes(poll);
        const selectedOptionIds = pollSelections[pollKey] || poll.options.filter((option) => option.selected).map((option) => option.id);
        const selectedSet = new Set(selectedOptionIds);
        const linuxDoPollReady = source !== 'linuxdo' || Boolean(poll.postId && poll.name);
        const pollReadonly = Boolean(poll.readonly || !canVotePollSource);
        const pollOptionDisabled = actionBusy || pollReadonly || Boolean(poll.closed || poll.voted || !canWritePollSource || !linuxDoPollReady);
        const selectionRangeStatus = pollSelectionRangeStatus(poll, selectedOptionIds.length);
        const pollStatus = poll.closed
          ? '已关闭'
          : poll.voted
            ? '已投票'
            : pollReadonly
              ? '只读结果'
              : !canWritePollSource
                ? '未登录'
                : !linuxDoPollReady
                  ? '信息不完整'
                  : '可投票';
        const pollMetaItems = [
          pollTypeLabel(poll),
          pollChoiceRangeLabel(poll),
          hasCounts ? `${totalVotes} 票` : undefined,
          typeof poll.public === 'boolean' ? (poll.public ? '公开' : '不公开') : undefined
        ].filter((item): item is string => Boolean(item));
        const submitLabel = poll.closed
          ? '投票已关闭'
          : poll.voted
            ? '已投票'
            : pollReadonly
              ? '只读结果'
              : !canWritePollSource
                ? '登录后投票'
                : !linuxDoPollReady
                  ? '刷新后投票'
                  : selectionRangeStatus || '提交投票';
        const submitDisabled = pollOptionDisabled || !selectedOptionIds.length || Boolean(selectionRangeStatus);
        return (
          <View key={pollKey} style={styles.pollBlock}>
            <View style={styles.pollHeader}>
              <Text style={styles.pollTitle}>{poll.title || '投票'}</Text>
            </View>
            <View style={styles.pollOptionList}>
              {poll.options.map((option, optionIndex) => {
                const selected = selectedSet.has(option.id);
                const OptionIcon = poll.multiple
                  ? selected ? CheckSquare : Square
                  : selected ? CheckCircle : Circle;
                const percentValue = hasCounts && totalVotes > 0 && typeof option.count === 'number'
                  ? Math.round((option.count / totalVotes) * 100)
                  : undefined;
                const countText = typeof option.count === 'number'
                  ? `${option.count} 票${percentValue !== undefined ? ` · ${percentValue}%` : ''}`
                  : '';
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: selected, disabled: pollOptionDisabled }}
                    android_ripple={androidRipple(theme.primarySoft)}
                    disabled={pollOptionDisabled}
                    style={[styles.pollOptionRow, optionIndex > 0 && styles.pollOptionDivider, selected && styles.pollOptionRowSelected]}
                    onPress={() => {
                      triggerPressFeedback();
                      onTogglePollSelection(pollKey, poll, option.id);
                    }}
                  >
                    {percentValue !== undefined ? (
                      <View pointerEvents="none" style={[styles.pollOptionProgress, { width: `${percentValue}%` }]} />
                    ) : null}
                    <View style={styles.pollOptionContent}>
                      <View style={styles.pollOptionIcon}>
                        <OptionIcon size={18} color={selected ? theme.primary : theme.muted} strokeWidth={1.8} />
                      </View>
                      <View style={styles.pollOptionTextBlock}>
                        <Text style={styles.pollOptionText}>{option.label}</Text>
                        {countText ? <Text style={styles.pollOptionCount}>{countText}</Text> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.pollFooter}>
              <View style={styles.pollMetaWrap}>
                {pollMetaItems.map((item) => (
                  <Text key={item} style={styles.pollMetaPill}>{item}</Text>
                ))}
                <Text style={styles.pollStatePill}>{pollStatus}</Text>
              </View>
              {canVotePollSource ? (
                <View style={styles.pollSubmitRow}>
                  <AppButton
                    compact
                    label={submitLabel}
                    variant={submitDisabled ? 'ghost' : 'primary'}
                    styles={styles}
                    disabled={submitDisabled}
                    onPress={() => onVotePoll(poll, selectedOptionIds)}
                  />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function nodeSeekReplyPassiveStats(item: Pick<Reply, 'dislikeCount'>) {
  return [
    visibleNodeSeekStat('反对', item.dislikeCount)
  ].filter((stat): stat is NodeSeekStat => Boolean(stat));
}

function NodeSeekStatPill({
  label,
  styles,
  value
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: number;
}) {
  return (
    <View style={styles.nodeSeekStatPill}>
      <Text style={styles.nodeSeekStatLabel}>{label}</Text>
      <Text style={styles.nodeSeekStatValue}>{value}</Text>
    </View>
  );
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
  return !text || /查看本帖需要|权限不足|没有权限|无权(?:查看|访问|阅读)|无访问权限|当前用户组不可(?:查看|访问|阅读)|游客不可见|登录后(?:才能|可见)|需要[^。；\n]{0,24}(?:等级|Lv|level)|permission denied|access denied|insufficient privileges|not allowed|not permitted|forbidden|(?:private|restricted)\s+(?:topic|category)|(?:topic|category)\s+is\s+(?:private|restricted)|not authorized|you do not have permission|you don't have permission/i.test(text);
}

function authorInitial(name: string | undefined) {
  return (name || '?').trim().slice(0, 1).toUpperCase() || '?';
}

function AuthorAvatar({
  name,
  small,
  styles,
  uri
}: {
  name?: string;
  small?: boolean;
  styles: ReturnType<typeof createStyles>;
  uri?: string;
}) {
  const [svgXml, setSvgXml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvgXml(null);
    if (!uri) {
      return () => {
        cancelled = true;
      };
    }
    loadRemoteAvatarSvgText(uri).then((xml) => {
      if (!cancelled) {
        setSvgXml(xml);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <View style={[styles.replyAvatar, small ? styles.replyAvatarSmall : styles.topicAvatar]}>
      {svgXml ? (
        <SvgXml
          xml={svgXml}
          width="100%"
          height="100%"
        />
      ) : uri ? (
        <ExpoImage
          source={imageSourceFromUrl(uri)}
          style={[styles.replyAvatarImage, small ? styles.replyAvatarSmall : styles.topicAvatar]}
          contentFit="cover"
        />
      ) : (
        <Text style={[styles.replyAvatarText, small && styles.replyAvatarSmallText]}>{authorInitial(name)}</Text>
      )}
    </View>
  );
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
  readerData,
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
  topicScrollRef,
  unreadReplyCount,
  onBack,
  onCommentQueryChange,
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
  readerData: ReaderData;
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
  topicScrollRef: RefObject<FlatList<TopicListItem> | null>;
  unreadReplyCount: number;
  onBack: () => void;
  onCommentQueryChange: (value: string) => void;
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
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const autoLoadRepliesArmedRef = useRef(false);
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
  const topicListItems = useMemo<TopicListItem[]>(() => {
    const items = [...topicContentItems];
    if (topic && !topicShowsAccessNotice) {
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
  }, [canShowReplies, canWrite, replyComposerOpen, replyItems, replyTarget, topic, topicContentItems, topicShowsAccessNotice]);
  const jumpToFloor = useCallback((floor: number) => {
    const index = topicListItems.findIndex((entry) => entry.type === 'reply' && entry.replyFloor === floor);
    if (index >= 0) {
      topicScrollRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.08 });
      setFloorOpen(false);
    }
  }, [topicListItems, topicScrollRef]);
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
    return { ...htmlRenderers, aside: QuoteAsideRenderer, table: TableRenderer };
  }, [htmlRenderers, styles, theme.primary, theme.primarySoft]);
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
            <MemoizedHtmlContent
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

    if (listItem.type === 'topicActions') {
      const topicReactionStats = topic?.source === 'nodeseek' && topic ? nodeSeekTopicReactionStats(topic) : [];
      const topicPassiveStats = topic?.source === 'nodeseek' && topic ? nodeSeekTopicPassiveStats(topic) : [];
      const linuxDoTopicReactionStats = topic?.source === 'linuxdo' && topic ? linuxDoReactionStats(topic) : [];
      const topicPolls = topic ? topic.polls || [] : [];
      const canWritePollSource = Boolean(
        topic
        && (
          (topic.source === 'nodeseek' && canWriteNodeSeek)
          || (topic.source === 'linuxdo' && canWriteLinuxDo)
          || (topic.source === 'yaohuo' && canWriteYaohuo)
        )
      );
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
              <IconButton tiny icon={ThumbsUp} label={`${topic?.upvoted ? '取消赞' : '点赞'} ${topic?.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
              <IconButton tiny icon={Drumstick} label={`${topic?.liked ? '取消鸡腿' : '加鸡腿'} ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              <IconButton tiny icon={ThumbsDown} label={`${topic?.disliked ? '取消反对' : '反对'} ${topic?.dislikeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('dislike', topic?.commentId)} />
              <IconButton tiny icon={BookMarked} label={topic?.collected ? '取消原站收藏' : '原站收藏'} styles={styles} theme={theme} disabled={actionBusy} onPress={onNodeSeekCollection} />
            </View>
          ) : null}
          {topic?.source === 'linuxdo' && linuxDoTopicReactionStats.length ? (
            <View style={styles.topicStatRail}>
              {linuxDoTopicReactionStats.map((stat) => (
                <NodeSeekStatPill key={stat.label} label={stat.label} value={stat.value} styles={styles} />
              ))}
            </View>
          ) : null}
          {canWriteYaohuo ? (
            <View style={styles.topicPrimaryActions}>
              <IconButton tiny icon={BookMarked} label="原站收藏" styles={styles} theme={theme} disabled={actionBusy} onPress={onYaohuoFavorite} />
            </View>
          ) : null}
          {canWriteLinuxDo ? (
            <View style={styles.topicPrimaryActions}>
              <IconButton tiny icon={ThumbsUp} label={`${topic?.liked ? '取消赞' : '点赞'} ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              <IconButton tiny icon={BookMarked} label={topic?.bookmarked ? '取消原站收藏' : '原站收藏'} styles={styles} theme={theme} disabled={actionBusy} onPress={onLinuxDoBookmark} />
            </View>
          ) : null}
          <PollBlockList
            actionBusy={actionBusy}
            canWritePollSource={canWritePollSource}
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
      );
    }

    if (listItem.type === 'replyComposer') {
      return (
        <View style={[styles.replyBox, topicColumnStyle]}>
          <Text style={styles.panelTitle}>{replyTarget ? `回复 #${replyTarget.floor}${replyTarget.author ? ` · ${replyTarget.author}` : ''}` : '回复'}</Text>
          <TextInput
            style={[styles.input, styles.replyInput]}
            value={replyContent}
            onChangeText={onReplyContentChange}
            placeholder={replyTarget ? '输入楼层回复内容' : '输入回复内容'}
            placeholderTextColor={theme.muted}
            multiline
          />
          {replyTarget ? <AppButton label="取消楼层回复" variant="ghost" styles={styles} disabled={actionBusy} onPress={() => onReplyComposerOpenChange(false)} /> : null}
          <AppButton label="发送回复" variant="primary" styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
        </View>
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
        <MemoizedReplyCard
          actionBusy={actionBusy}
          canWrite={canWrite}
          contentWidth={Math.max(240, contentWidth - 28)}
          expandedQuotes={expandedQuotesRef.current}
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
            <IconButton iconOnly ghost icon={Star} label={isFavorite(readerData, item) ? '已收藏' : '收藏'} styles={styles} theme={theme} active={isFavorite(readerData, item)} onPress={() => onToggleFavorite(item)} />
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
        <Modal transparent visible={topicMenuOpen} animationType="fade" onRequestClose={() => setTopicMenuOpen(false)}>
          <View style={styles.topicMenuLayer}>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭更多操作" style={styles.topicMenuDismissLayer} onPress={() => setTopicMenuOpen(false)} />
            <View style={styles.topicOverflowMenu}>
              <Pressable accessibilityRole="menuitem" android_ripple={{ color: theme.primarySoft }} style={styles.topicMenuItem} onPress={() => runTopicMenuAction(onShareTopic)}>
                <Share2 size={17} color={theme.ink} strokeWidth={1.8} />
                <Text style={styles.topicMenuItemText}>分享</Text>
              </Pressable>
              <Pressable accessibilityRole="menuitem" android_ripple={{ color: theme.primarySoft }} style={styles.topicMenuItem} onPress={() => runTopicMenuAction(onRefreshTopic)}>
                <RefreshCw size={17} color={theme.ink} strokeWidth={1.8} />
                <Text style={styles.topicMenuItemText}>刷新评论</Text>
              </Pressable>
              <Pressable accessibilityRole="menuitem" android_ripple={{ color: theme.primarySoft }} style={styles.topicMenuItem} onPress={() => runTopicMenuAction(onRefreshWholeTopic)}>
                <RefreshCw size={17} color={theme.ink} strokeWidth={1.8} />
                <Text style={styles.topicMenuItemText}>刷新全文</Text>
              </Pressable>
              <Pressable accessibilityRole="menuitem" accessibilityLabel="阅读设置" android_ripple={{ color: theme.primarySoft }} style={styles.topicMenuItem} onPress={() => runTopicMenuAction(onOpenReadingSettings)}>
                <Settings size={17} color={theme.ink} strokeWidth={1.8} />
                <Text style={styles.topicMenuItemText}>阅读设置</Text>
              </Pressable>
              <Pressable accessibilityRole="menuitem" android_ripple={{ color: theme.primarySoft }} style={[styles.topicMenuItem, styles.topicMenuItemLast]} onPress={() => runTopicMenuAction(() => onOpenOriginal(item.url))}>
                <ExternalLink size={17} color={theme.ink} strokeWidth={1.8} />
                <Text style={styles.topicMenuItemText}>原站打开</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
}

function HtmlContent({
  contentWidth,
  html,
  inlineSizedImageUrls
}: {
  contentWidth: number;
  html: string | undefined;
  inlineSizedImageUrls: Record<string, true>;
}) {
  const source = useMemo(() => {
    const markedHtml = Object.keys(inlineSizedImageUrls).reduce((current, url) => markInlineSizedImageHtml(current, url), html || '<p></p>');
    return { html: flowInlineImagesInMixedParagraphs(markedHtml) };
  }, [html, inlineSizedImageUrls]);
  return (
    <RenderHTMLSource
      contentWidth={contentWidth}
      source={source}
    />
  );
}

const MemoizedHtmlContent = memo(HtmlContent);

function ReplyCard({
  actionBusy,
  canWrite,
  contentWidth,
  expandedQuotes,
  isNew,
  loadedQuotedReplies,
  loadingQuotedFloors,
  inlineSizedImageUrls,
  onTogglePollSelection,
  pollSelections,
  query,
  reply,
  replyFloor,
  repliesByFloor,
  source,
  styles,
  theme,
  topicAuthor,
  onInteract,
  onOpenUser,
  onReplyToFloor,
  onVotePoll,
  onToggleQuotedFloor
}: {
  actionBusy: boolean;
  canWrite: boolean;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  inlineSizedImageUrls: Record<string, true>;
  isNew?: boolean;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  onTogglePollSelection: (key: string, poll: TopicPoll, optionId: string) => void;
  pollSelections: Record<string, string[]>;
  query: string;
  reply: Reply;
  replyFloor: number;
  repliesByFloor: Map<number, Reply>;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicAuthor?: string;
  onInteract: (type: InteractionType, commentId?: number) => void;
  onOpenUser: (user: UserProfile) => void;
  onReplyToFloor: (reply: Reply) => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
  const highlightedHtml = useMemo(() => highlightHtml(reply.contentHtml, query), [query, reply.contentHtml]);
  const replyContentWidth = Math.max(220, contentWidth - 42);
  const replyUser = userFromReply(reply, source);
  const isTopicAuthorReply = Boolean(reply.isOp || (source === 'v2ex' && topicAuthor && reply.author && reply.author === topicAuthor));
  const nodeSeekReplyReactionStats = source === 'nodeseek' ? nodeSeekReactionStats(reply) : [];
  const nodeSeekReplyPassiveStatItems = source === 'nodeseek' ? nodeSeekReplyPassiveStats(reply) : [];
  const linuxDoReplyReactionStats = source === 'linuxdo' ? linuxDoReactionStats(reply) : [];
  const replyTargetUser = source && reply.replyTargetAuthor ? {
    source,
    id: reply.replyTargetAuthor,
    username: reply.replyTargetAuthor,
    displayName: reply.replyTargetAuthor,
    url: '',
    topics: []
  } : null;
  return (
    <View style={styles.replyCard}>
      <Pressable
        accessibilityRole="button"
        disabled={!replyUser}
        style={styles.replyHead}
        onPress={() => {
          if (replyUser) {
            onOpenUser(replyUser);
          }
        }}
      >
        <AuthorAvatar small name={reply.author} uri={reply.authorAvatar} styles={styles} />
        <View style={styles.replyAuthorBlock}>
          <View style={styles.replyAuthorNameRow}>
            <Text style={styles.replyAuthor} numberOfLines={1}>{reply.author || '未知作者'}</Text>
            {isTopicAuthorReply ? <Text style={styles.replyOpBadge}>OP</Text> : null}
            {reply.hot ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>热门</Text> : null}
            {reply.pinned ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('accent', theme)]}>置顶</Text> : null}
            {reply.acceptedAnswer ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('success', theme)]}>已采纳</Text> : null}
            {reply.wiki ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('info', theme)]}>Wiki</Text> : null}
            {reply.hidden ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('danger', theme)]}>已隐藏</Text> : null}
            {reply.folded ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>已折叠</Text> : null}
            {reply.needsApproval ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>待审批</Text> : null}
            {reply.systemAction ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('neutral', theme)]}>系统</Text> : null}
          </View>
          <Text style={styles.replyTime}>{formatDateTime(reply.createdAt)}</Text>
        </View>
        <View style={styles.replyFloorBadge}>
          <Text style={styles.replyFloorText}>#{reply.floor ?? '-'}</Text>
        </View>
        {isNew ? <Text style={styles.replyNewBadge}>新增</Text> : null}
      </Pressable>
      <View style={styles.replyContentArea}>
        {quotedFloors.length ? (
          <View style={styles.quoteStack}>
            {quotedFloors.map((quotedFloor) => {
              const key = `${replyFloor}:${quotedFloor}`;
              const quotedReply = repliesByFloor.get(quotedFloor) || loadedQuotedReplies[quotedFloor];
              const quotedAuthorFromMarkup = reply.quotedAuthors?.[quotedFloor];
              const quotedAuthorName = quotedReply?.author || quotedAuthorFromMarkup || '未知作者';
              const quotedUser = quotedReply ? userFromReply(quotedReply, source) : source && quotedAuthorFromMarkup ? {
                source,
                id: quotedAuthorFromMarkup,
                username: quotedAuthorFromMarkup,
                displayName: quotedAuthorFromMarkup,
                url: '',
                topics: []
              } : null;
              const expanded = Boolean(expandedQuotes[key]);
              const loading = Boolean(loadingQuotedFloors[key]);
              return (
                <View key={key} style={styles.quoteBox}>
                  <View style={styles.quoteHeader}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!quotedUser}
                      style={styles.quoteAuthorSummary}
                      onPress={() => {
                        if (quotedUser) {
                          onOpenUser(quotedUser);
                        }
                      }}
                    >
                      {quotedReply ? <AuthorAvatar small name={quotedReply.author} uri={quotedReply.authorAvatar} styles={styles} /> : null}
                      <View style={styles.quoteAuthorTextBlock}>
                        <Text style={styles.quoteAuthorText} numberOfLines={1}>{quotedAuthorName}</Text>
                        <Text style={styles.replyMeta}>引用 #{quotedFloor}{quotedReply ? '' : ' · 楼层未加载'}</Text>
                      </View>
                    </Pressable>
                    <AppButton
                      compact
                      label={loading ? '读取' : expanded ? '收起' : '展开'}
                      variant="ghost"
                      styles={styles}
                      disabled={loading}
                      onPress={() => onToggleQuotedFloor({ replyFloor, quotedFloor, quotedReply })}
                    />
                  </View>
                  {expanded && quotedReply ? (
                    <View style={styles.quoteBody}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={!userFromReply(quotedReply, source)}
                        style={styles.quoteAuthorRow}
                        onPress={() => {
                          const user = userFromReply(quotedReply, source);
                          if (user) {
                            onOpenUser(user);
                          }
                        }}
                      >
                        <AuthorAvatar small name={quotedReply.author} uri={quotedReply.authorAvatar} styles={styles} />
                        <Text style={styles.replyMeta}>引用 #{quotedFloor} · {quotedReply.author || '未知作者'}</Text>
                      </Pressable>
                      <MemoizedHtmlContent
                        contentWidth={Math.max(220, replyContentWidth - 24)}
                        inlineSizedImageUrls={inlineSizedImageUrls}
                        html={quotedReply.contentHtml}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        {reply.replyTargetAuthor ? (
          <Pressable
            accessibilityRole="button"
            disabled={!replyTargetUser}
            style={styles.replyTargetPill}
            onPress={() => {
              if (replyTargetUser) {
                onOpenUser(replyTargetUser);
              }
            }}
          >
            <Text style={styles.replyTargetText}>回复 @{reply.replyTargetAuthor}</Text>
          </Pressable>
        ) : null}
        <View style={styles.replyBody}>
          <MemoizedHtmlContent
            contentWidth={replyContentWidth}
            inlineSizedImageUrls={inlineSizedImageUrls}
            html={highlightedHtml}
          />
        </View>
        <PollBlockList
          actionBusy={actionBusy}
          canWritePollSource={Boolean(canWrite && source === 'linuxdo')}
          keyPrefix={`reply-${reply.floor ?? reply.commentId ?? replyFloor}`}
          onTogglePollSelection={onTogglePollSelection}
          onVotePoll={onVotePoll}
          pollSelections={pollSelections}
          polls={reply.polls || []}
          source={source}
          styles={styles}
          theme={theme}
        />
        {reply.signatureHtml ? (
          <View style={styles.replySignature}>
            <MemoizedHtmlContent
              contentWidth={replyContentWidth}
              inlineSizedImageUrls={inlineSizedImageUrls}
              html={reply.signatureHtml}
            />
          </View>
        ) : null}
        {source === 'v2ex' && typeof reply.thanksCount === 'number' && reply.thanksCount > 0 ? (
          <Text style={styles.replyThanksText}>{reply.thanksCount} 感谢</Text>
        ) : null}
        {source === 'linuxdo' && (reply.reactionSummary?.length || reply.boostCount) ? (
          <View style={styles.replyStatRail}>
            {linuxDoReplyReactionStats.map((stat) => (
              <NodeSeekStatPill key={stat.label} label={stat.label} value={stat.value} styles={styles} />
            ))}
          </View>
        ) : null}
        {source === 'nodeseek' && !canWrite && nodeSeekReplyReactionStats.length ? (
          <View style={styles.replyStatRail}>
            {nodeSeekReplyReactionStats.map((stat) => (
              <NodeSeekStatPill key={stat.label} label={stat.label} value={stat.value} styles={styles} />
            ))}
          </View>
        ) : null}
        {canWrite && source === 'nodeseek' ? (
          <View style={styles.replyActionRow}>
            <IconButton tiny icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
            <IconButton tiny icon={ThumbsUp} label={`${reply.upvoted ? '取消赞' : '点赞'} ${reply.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} />
            <IconButton tiny icon={Drumstick} label={`${reply.liked ? '取消鸡腿' : '加鸡腿'} ${reply.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
            <IconButton tiny icon={ThumbsDown} label={`${reply.disliked ? '取消反对' : '反对'} ${reply.dislikeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('dislike', reply.commentId)} />
          </View>
        ) : null}
        {canWrite && source === 'yaohuo' ? (
          <View style={styles.replyActionRow}>
            <IconButton tiny icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
          </View>
        ) : null}
        {canWrite && source === 'linuxdo' ? (
          <View style={styles.replyActionRow}>
            <IconButton tiny icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
            <IconButton tiny icon={ThumbsUp} label={`${reply.liked ? '取消赞' : '点赞'} ${reply.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const MemoizedReplyCard = memo(ReplyCard, (previous, next) => {
  if (
    previous.actionBusy !== next.actionBusy
    || previous.canWrite !== next.canWrite
    || previous.contentWidth !== next.contentWidth
    || previous.inlineSizedImageUrls !== next.inlineSizedImageUrls
    || previous.isNew !== next.isNew
    || previous.onInteract !== next.onInteract
    || previous.onOpenUser !== next.onOpenUser
    || previous.onReplyToFloor !== next.onReplyToFloor
    || previous.onTogglePollSelection !== next.onTogglePollSelection
    || previous.onToggleQuotedFloor !== next.onToggleQuotedFloor
    || previous.onVotePoll !== next.onVotePoll
    || previous.pollSelections !== next.pollSelections
    || previous.query !== next.query
    || previous.reply !== next.reply
    || previous.replyFloor !== next.replyFloor
    || previous.source !== next.source
    || previous.styles !== next.styles
    || previous.theme !== next.theme
    || previous.topicAuthor !== next.topicAuthor
  ) {
    return false;
  }

  const quotedFloors = new Set([...(previous.reply.quotedFloors || []), ...(next.reply.quotedFloors || [])]);
  for (const quotedFloor of quotedFloors) {
    const previousKey = `${previous.replyFloor}:${quotedFloor}`;
    const nextKey = `${next.replyFloor}:${quotedFloor}`;
    if (
      Boolean(previous.expandedQuotes[previousKey]) !== Boolean(next.expandedQuotes[nextKey])
      || Boolean(previous.loadingQuotedFloors[previousKey]) !== Boolean(next.loadingQuotedFloors[nextKey])
      || previous.loadedQuotedReplies[quotedFloor] !== next.loadedQuotedReplies[quotedFloor]
      || previous.repliesByFloor.get(quotedFloor) !== next.repliesByFloor.get(quotedFloor)
    ) {
      return false;
    }
  }

  return true;
});
