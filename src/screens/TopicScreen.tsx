import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Image,
  Modal,
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
  RenderHTMLSource,
  TChildrenRenderer,
  TRenderEngineProvider,
  useTNodeChildrenProps,
  type CustomBlockRenderer
} from 'react-native-render-html';
import { SvgXml } from 'react-native-svg';
import { BookMarked, CheckCircle, ChevronDown, ChevronLeft, ChevronUp, Drumstick, ExternalLink, MessageCircle, MoreHorizontal, RefreshCw, Settings, Share2, Star, ThumbsUp, X } from 'lucide-react-native';
import type { ReaderData } from '../readerData';
import { isFavorite } from '../readerData';
import type { Reply, Source, Topic, TopicDetail, UserProfile } from '../types';
import type { HtmlAllowedStyles, HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, ReplyFilter, YaohuoReplyTarget } from '../appTypes';
import { highlightHtml } from '../androidFeatureHelpers';
import { formatDateTime, sourceLabel } from '../appUtils';
import { loadRemoteAvatarSvgText } from '../avatarImages';
import { flowInlineImagesInMixedParagraphs, imageSourceFromUrl, INLINE_FORUM_IMAGE_TAG } from '../htmlImages';
import { splitTopicContentHtml } from '../topicContentSplit';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail, triggerPressFeedback } from '../components/AppControls';
import { REPLY_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';
import { topicWithAuthorFallback, userFromReply, userFromTopic } from '../userNavigation';

type TopicListContentItem = { type: 'content'; key: string; html: string };
export type TopicListItem =
  | TopicListContentItem
  | { type: 'topicActions'; key: string }
  | { type: 'replyControls'; key: string }
  | { type: 'replyComposer'; key: string }
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
        <Image
          source={imageSourceFromUrl(uri)}
          style={[styles.replyAvatarImage, small ? styles.replyAvatarSmall : styles.topicAvatar]}
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
  onShareTopic,
  onYaohuoFavorite,
  onYaohuoVote,
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
  onOpenUser
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
  replyTarget: YaohuoReplyTarget | null;
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
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onLinuxDoBookmark: () => void;
  onShareTopic: () => void;
  onYaohuoFavorite: () => void;
  onYaohuoVote: (voteId: string) => void;
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

  const topicColumnStyle = useMemo(() => ({ width: contentWidth }), [contentWidth]);
  const topicContentHtml = topic?.contentHtml || '';
  const topicContentItems = useMemo<TopicListItem[]>(() => (
    topic
      ? splitTopicContentHtml(topicContentHtml).map((html, index) => ({
        type: 'content',
        key: `topic-content-${index}-${stableTextHash(html)}`,
        html
      }))
      : []
  ), [topic, topicContentHtml]);
  const replyItems = useMemo<TopicListItem[]>(() => replies.map((reply) => ({
    type: 'reply',
    key: getReplyKey(reply),
    reply,
    replyFloor: reply.floor ?? 0
  })), [replies]);
  const topicListItems = useMemo<TopicListItem[]>(() => {
    const items = [...topicContentItems];
    if (topic) {
      items.push({ type: 'topicActions', key: 'topic-actions' });
    }
    if (canShowReplies) {
      items.push({ type: 'replyControls', key: 'reply-controls' });
      if (canWrite && replyComposerOpen) {
        items.push({ type: 'replyComposer', key: 'reply-composer' });
      }
      if (replyItems.length) {
        items.push(...replyItems);
      } else {
        items.push({ type: 'emptyReplies', key: 'empty-replies' });
      }
    }
    return items;
  }, [canShowReplies, canWrite, replyComposerOpen, replyItems, topic, topicContentItems]);
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
    if (listItem.type === 'content') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.articleBody}>
            <MemoizedHtmlContent
              contentWidth={contentWidth}
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
              <IconButton tiny icon={ThumbsUp} label={`点赞 ${topic?.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
              <IconButton tiny icon={Drumstick} label={`加鸡腿 ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              {topicPassiveStats.map((stat) => (
                <NodeSeekStatPill key={stat.label} label={stat.label} value={stat.value} styles={styles} />
              ))}
            </View>
          ) : null}
          {canWriteYaohuo ? (
            <View style={styles.topicPrimaryActions}>
              <IconButton tiny icon={BookMarked} label="原站收藏" styles={styles} theme={theme} disabled={actionBusy} onPress={onYaohuoFavorite} />
              {(topic?.voteOptions || []).map((option) => (
                <IconButton
                  key={option.id}
                  tiny
                  icon={CheckCircle}
                  label={`投票 ${option.label}${typeof option.count === 'number' ? ` ${option.count}` : ''}`}
                  styles={styles}
                  theme={theme}
                  disabled={actionBusy}
                  onPress={() => onYaohuoVote(option.id)}
                />
              ))}
            </View>
          ) : null}
          {canWriteLinuxDo ? (
            <View style={styles.topicPrimaryActions}>
              <IconButton tiny icon={ThumbsUp} label={`${topic?.liked ? '取消赞' : '点赞'} ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              <IconButton tiny icon={BookMarked} label={topic?.bookmarked ? '取消原站收藏' : '原站收藏'} styles={styles} theme={theme} disabled={actionBusy} onPress={onLinuxDoBookmark} />
            </View>
          ) : null}
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
          loadedQuotedReplies={loadedQuotedRepliesRef.current}
          loadingQuotedFloors={loadingQuotedFloorsRef.current}
          reply={listItem.reply}
          replyFloor={listItem.replyFloor}
          repliesByFloor={repliesByFloor}
          styles={styles}
          theme={theme}
          topicAuthor={item?.author}
          onInteract={onInteract}
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
    jumpToFloor,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    newReplyFloorStart,
    onCommentQueryChange,
    onInteract,
    onLinuxDoBookmark,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onReplyFilterChange,
    onReplyToFloor,
    onSubmitReply,
    onToggleQuotedFloor,
    onOpenUser,
    onYaohuoFavorite,
    onYaohuoVote,
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
    topic,
    topicColumnStyle
  ]);

  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }

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
          {item.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{item.accessRequirement.label}</Text> : null}
          {item.tags?.length ? (
            <View style={styles.topicTagRow}>
              {item.tags.map((tag) => (
                <Text key={tag} style={styles.topicTagText}>{tag}</Text>
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
          {...REPLY_LIST_PERFORMANCE_PROPS}
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
  html
}: {
  contentWidth: number;
  html: string | undefined;
}) {
  const source = useMemo(() => ({ html: flowInlineImagesInMixedParagraphs(html || '<p></p>') }), [html]);
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
  onToggleQuotedFloor
}: {
  actionBusy: boolean;
  canWrite: boolean;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  isNew?: boolean;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  query: string;
  reply: Reply;
  replyFloor: number;
  repliesByFloor: Map<number, Reply>;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicAuthor?: string;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onOpenUser: (user: UserProfile) => void;
  onReplyToFloor: (reply: Reply) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
  const highlightedHtml = useMemo(() => highlightHtml(reply.contentHtml, query), [query, reply.contentHtml]);
  const replyContentWidth = Math.max(220, contentWidth - 42);
  const replyUser = userFromReply(reply, source);
  const isTopicAuthorReply = Boolean(reply.isOp || (source === 'v2ex' && topicAuthor && reply.author && reply.author === topicAuthor));
  const nodeSeekReplyReactionStats = source === 'nodeseek' ? nodeSeekReactionStats(reply) : [];
  const nodeSeekReplyPassiveStatItems = source === 'nodeseek' ? nodeSeekReplyPassiveStats(reply) : [];
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
            {reply.hot ? <Text style={styles.replyContextBadge}>热门</Text> : null}
            {reply.pinned ? <Text style={styles.replyContextBadge}>置顶</Text> : null}
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
            html={highlightedHtml}
          />
        </View>
        {reply.signatureHtml ? (
          <View style={styles.replySignature}>
            <MemoizedHtmlContent
              contentWidth={replyContentWidth}
              html={reply.signatureHtml}
            />
          </View>
        ) : null}
        {source === 'v2ex' && typeof reply.thanksCount === 'number' && reply.thanksCount > 0 ? (
          <Text style={styles.replyThanksText}>{reply.thanksCount} 感谢</Text>
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
            <IconButton tiny icon={ThumbsUp} label={`点赞 ${reply.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} />
            <IconButton tiny icon={Drumstick} label={`加鸡腿 ${reply.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
            {nodeSeekReplyPassiveStatItems.map((stat) => (
              <NodeSeekStatPill key={stat.label} label={stat.label} value={stat.value} styles={styles} />
            ))}
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
    || previous.isNew !== next.isNew
    || previous.onInteract !== next.onInteract
    || previous.onOpenUser !== next.onOpenUser
    || previous.onReplyToFloor !== next.onReplyToFloor
    || previous.onToggleQuotedFloor !== next.onToggleQuotedFloor
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
