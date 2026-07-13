import { memo, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  View
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { BookMarked, ChevronLeft, Drumstick, MoreHorizontal, Star, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import type { Reply, SourceErrorInfo, Topic, TopicDetail, TopicPoll, UserProfile } from '../../types';
import type { HtmlBaseStyle, HtmlClassesStyles, HtmlIgnoredStyles, HtmlRenderersProps, HtmlTagsStyles, ReplyEditTarget, ReplyFilter, ReplyTarget } from '../../appTypes';
import { formatDateTime, forumAccessRequirementText, sourceLabel } from '../../appUtils';
import { forumVideoBlockFromHtml, splitTopicContentHtml } from '../../topicContentSplit';
import { createStyles, replyContextBadgeStyle, sourceBadgeColorStyle, topicStatusBadgeColorStyle, topicStatusBadgeTextColorStyle, topicTagColorStyle, topicTagTextColorStyle, type ReaderTheme } from '../../theme';
import { AppButton, EmptyText, IconButton, LoadingState, triggerPressFeedback } from '../../components/AppControls';
import { Avatar } from '../../components/Avatar';
import { ForumContentVideo } from '../../components/ForumContentVideo';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from '../../components/listPerformance';
import { topicWithAuthorFallback, userFromTopic } from '../../userNavigation';
import { topicActionStateKey, type InteractionType, type OptimisticActionState, type TopicActionStateKind } from '../../topicActionState';
import type { TopicImageDeriver } from '../../topicDerivedData';
import { authNoticeForSourceError } from '../../siteSessionPrompts';
import { canSubmitReplyToTopic } from '../../app/topicActionControllerHelpers';
import { getLinuxDoEmojiUrls } from '../../localLinuxdo';
import { linuxDoReactionStats, type LinuxDoEmojiUrlMap } from '../../linuxdoReactions';
import { canUseLinuxDoLike } from '../../linuxdoPermissions';
import { replyImageUploadSupported } from '../../replyImageUpload';
import { TopicPolls } from './TopicPolls';
import { DetailActionButton } from './TopicActionBar';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { LinuxDoReactionPill, MemoizedReplyItem, NodeSeekStatPill, nodeSeekTopicReactionStats } from './ReplyItem';
import { ReplyComposerSheet } from './ReplyComposerSheet';
import { ReplyControls } from './ReplyControls';
import { ForumHtmlRendererProvider, type ForumHtmlRendererContextValue } from './ForumHtmlRendererProvider';
import { TopicMenu } from './TopicMenu';
import { buildReplyListItems, isAccessNoticeHtml, readableTopicError, stableTextHash, topicStatusBadges, type TopicListItem } from './topicScreenHelpers';

type TopicContentItem =
  | { type: 'content'; key: string; html: string }
  | { type: 'contentVideo'; key: string; src: string }
  | { type: 'accessNotice'; key: string; label: string; detail: string };
export type { TopicListItem };

function topicListItemKey(item: TopicListItem) {
  return item.key;
}

function topicListItemType(item: TopicListItem) {
  return item.type;
}

export const TopicScreen = memo(function TopicScreen({
  actionBusy,
  canUseLinuxDoActions,
  canUseNodeSeekActions,
  canUseYaohuoActions,
  contentWidth,
  htmlBaseStyle,
  htmlClassesStyles,
  htmlIgnoredStyles,
  htmlRendererContext,
  htmlRenderersProps,
  htmlTagsStyles,
  expandedQuotes,
  loadedQuotedReplies,
  loadingMoreReplies,
  loadingQuotedFloors,
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
  htmlClassesStyles: HtmlClassesStyles;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRendererContext: ForumHtmlRendererContextValue;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  expandedQuotes: Record<string, boolean>;
  loadedQuotedReplies: Record<number, Reply>;
  loadingMoreReplies: boolean;
  loadingQuotedFloors: Record<string, boolean>;
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
  onReplyFaceChange: (value: string) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
  onReplyToFloor: (reply: Reply) => void;
  onRefreshTopic: () => void;
  onRefreshWholeTopic: () => void;
  onVerifyLinuxDo: () => void;
  onVerifyNodeSeek: () => void;
  onSubmitReply: (content: string) => void | Promise<void>;
  onUploadReplyImage: () => Promise<string | null | undefined>;
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
  const canSubmitReply = canSubmitReplyToTopic(topic);
  const canWriteNodeSeek = Boolean(topic && topic.source === 'nodeseek' && canUseNodeSeekActions);
  const canWriteYaohuo = Boolean(topic && topic.source === 'yaohuo' && canUseYaohuoActions);
  const canWriteLinuxDo = Boolean(topic && topic.source === 'linuxdo' && canUseLinuxDoActions);
  const canWrite = Boolean(canSubmitReply && (canWriteNodeSeek || canWriteYaohuo || canWriteLinuxDo));
  const replyTotalCount = item?.replyCount ?? replies.length;
  const listExtraData = useMemo(() => ({
    actionBusy,
    quoteStateVersion
  }), [actionBusy, quoteStateVersion]);
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
    sourceReplies.forEach((reply) => {
      if (typeof reply.floor === 'number') {
        next.set(reply.floor, reply);
      }
    });
    Object.values(loadedQuotedReplies).forEach((reply) => {
      if (reply.floor) {
        next.set(reply.floor, reply);
      }
    });
    return next;
  }, [loadedQuotedReplies, quoteStateVersion, sourceReplies]);
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
  const topicContentItems = useMemo<TopicContentItem[]>(() => (
    topic
      ? topicShowsAccessNotice
        ? [{
          type: 'accessNotice',
          key: 'topic-access-notice',
          label: topicAccessRequirementText,
          detail: topicAccessRequirementDetail
        }]
        : splitTopicContentHtml(topicContentHtml).map((html, index) => {
          const video = forumVideoBlockFromHtml(html);
          return video
            ? { type: 'contentVideo', key: `topic-video-${index}-${stableTextHash(video.src)}`, src: video.src }
            : { type: 'content', key: `topic-content-${index}-${stableTextHash(html)}`, html };
        })
      : []
  ), [topic, topicAccessRequirementDetail, topicAccessRequirementText, topicContentHtml, topicShowsAccessNotice]);
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
  const replyListItems = useMemo(() => buildReplyListItems({
    canShowReplies,
    replies,
    topicShowsAccessNotice
  }), [canShowReplies, replies, topicShowsAccessNotice]);
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

    if (contentItem.type === 'content') {
      return renderTopicListItemFrame(
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.articleBody}>
            <MemoizedTopicContentBlock
              baseUrl={topicBaseUrl}
              contentWidth={contentWidth}
              inlineSizedImageUrls={inlineSizedImageUrls}
              html={contentItem.html}
              topicImageDeriver={topicImageDeriver}
            />
          </View>
        </View>,
        contentItem.key
      );
    }

    return renderTopicListItemFrame(
      <View style={[styles.replyListItem, topicColumnStyle]}>
        <View style={styles.articleBody}>
          <ForumContentVideo src={contentItem.src} theme={theme} />
        </View>
      </View>,
      contentItem.key
    );
  }

  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(({ item: listItem }) => {
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
          canWrite={canWrite}
          contentWidth={contentWidth}
          expandedQuotes={expandedQuotes}
          isActionPending={isOptimisticActionPending}
          inlineSizedImageUrls={inlineSizedImageUrls}
          linuxDoEmojiUrls={linuxDoEmojiUrls}
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
          onToggleQuotedFloor={onToggleQuotedFloor}
          query={replyHighlightQuery}
          isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
          source={itemSource}
          onOpenUser={onOpenUser}
        />
      </View>
    );
  }, [
    actionBusy,
    canWrite,
    contentWidth,
    expandedQuotes,
    inlineSizedImageUrls,
    topicImageDeriver,
    isOptimisticActionPending,
    loadedQuotedReplies,
    loadingQuotedFloors,
    linuxDoEmojiUrls,
    newReplyFloorStart,
    onDeleteReply,
    onEditReply,
    onInteract,
    onReplyToFloor,
    onToggleQuotedFloor,
    onOpenUser,
    onVotePoll,
    pollSelections,
    renderTopicListItemFrame,
    itemSource,
    replyHighlightQuery,
    repliesByFloor,
    styles,
    theme,
    togglePollSelection,
    topicBaseUrl,
    topicColumnStyle
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
  const linuxDoTopicReactionStats = topic?.source === 'linuxdo' && topic ? linuxDoReactionStats(topic, linuxDoEmojiUrls) : [];
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
            <Avatar name={item.author} uri={item.authorAvatar} styles={styles} />
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
      {topic && !topicShowsAccessNotice && topicPolls.length ? renderTopicListItemFrame(
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
      {topicHasPostActions ? renderTopicListItemFrame(
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
              <DetailActionButton active={Boolean(topic?.upvoted)} tone="success" accessibilityLabel={topic?.upvoted ? '已点赞' : '点赞'} count={topic?.upvoteCount} icon={ThumbsUp} label="赞" pending={isOptimisticActionPending(topic?.commentId, 'upvote')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.liked)} tone="warning" accessibilityLabel={topic?.liked ? '已加鸡腿' : '加鸡腿'} count={topic?.likeCount} icon={Drumstick} label="鸡腿" pending={isOptimisticActionPending(topic?.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.disliked)} tone="danger" accessibilityLabel={topic?.disliked ? '已反对' : '反对'} count={topic?.dislikeCount} icon={ThumbsDown} label="反对" pending={isOptimisticActionPending(topic?.commentId, 'dislike')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('dislike', topic?.commentId)} />
              <DetailActionButton active={Boolean(topic?.collected)} tone="favorite" accessibilityLabel={topic?.collected ? '取消原站收藏' : '原站收藏'} count={topic?.collectionCount} icon={BookMarked} label="收藏" pending={isOptimisticActionPending(topic?.id, 'collection')} styles={styles} theme={theme} disabled={actionBusy} onPress={onNodeSeekCollection} />
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
              {canUseLinuxDoLike(topic) ? <DetailActionButton active={Boolean(topic?.liked)} tone="success" accessibilityLabel={topic?.liked ? '取消赞' : '点赞'} icon={ThumbsUp} label="赞" pending={isOptimisticActionPending(topic?.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} /> : null}
              <DetailActionButton active={Boolean(topic?.bookmarked)} tone="favorite" accessibilityLabel={topic?.bookmarked ? '取消原站收藏' : '原站收藏'} icon={BookMarked} label="收藏" pending={isOptimisticActionPending(topic?.id, 'bookmark')} styles={styles} theme={theme} disabled={actionBusy} onPress={onLinuxDoBookmark} />
            </View>
          ) : null}
        </View>,
        'topic-actions'
      ) : null}
      {canShowReplies && !topicShowsAccessNotice ? (
        <ReplyControls
          key={detailTopicStateKey}
          canWrite={canWrite}
          commentQuery={commentQuery}
          contentWidth={contentWidth}
          replyComposerOpen={replyComposerOpen}
          replyFilter={replyFilter}
          replyTotalCount={replyTotalCount}
          styles={styles}
          theme={theme}
          unreadReplyCount={unreadReplyCount}
          onCommentQueryChange={onCommentQueryChange}
          onReplyComposerOpenChange={onReplyComposerOpenChange}
          onReplyFilterChange={onReplyFilterChange}
        />
      ) : null}
    </View>
  );

  return (
    <ForumHtmlRendererProvider
      context={htmlRendererContext}
      htmlBaseStyle={htmlBaseStyle}
      htmlClassesStyles={htmlClassesStyles}
      htmlIgnoredStyles={htmlIgnoredStyles}
      htmlRenderersProps={htmlRenderersProps}
      htmlTagsStyles={htmlTagsStyles}
      topicKey={detailTopicStateKey}
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
          linuxDoEmojiUrls={linuxDoEmojiUrls}
          replyContent={replyContent}
          replyFace={replyFace}
          replyEditTarget={replyEditTarget}
          replyTarget={replyTarget}
          source={topic?.source}
          styles={styles}
          theme={theme}
          visible={Boolean(canWrite && replyComposerOpen)}
          onReplyComposerOpenChange={onReplyComposerOpenChange}
          onReplyContentChange={onReplyContentChange}
          onReplyFaceChange={onReplyFaceChange}
          onSubmitReply={onSubmitReply}
          onUploadReplyImage={replyImageUploadSupported(topic?.source) ? onUploadReplyImage : undefined}
        />
        </View>
    </ForumHtmlRendererProvider>
  );
});
