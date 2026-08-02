import type { TopicStyles } from '../styles';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, ToastAndroid, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { CheckCircle, Drumstick, MessageCircle, Pencil, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react-native';
import type {
  QuotedPostMetadata,
  Reply,
  Source,
  Topic,
  TopicDetail,
  TopicPoll,
  UserReference
} from '@/domain/forum/models';
import { highlightHtml } from '@/ui/text/highlight';
import { stripHtml } from '@/domain/forum/text';
import { formatDateTime } from '@/domain/forum/presentation';
import { parseForumTopicLink } from '@/domain/forum/links';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { splitDiscourseContentHtml } from '@/sources/discourse/content';
import {
  discourseReactionStats,
  type DiscourseEmojiUrlMap,
  type DiscourseReactionStat
} from '@/sources/discourse/reactions';
import { linuxDoReactionStats } from '@/sources/linuxdo/reactions';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import {
  quotedPostsForSource,
  replyForQuotedPost,
  replyQuotedPostInstanceKey,
  type ToggleReplyQuoteOptions
} from '@/domain/forum/quotedPosts';
import { replyContextBadgeStyle, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, triggerPressFeedback } from '@/ui/controls/AppControls';
import { Avatar } from '@/ui/avatar/Avatar';
import { userFromReply, userReferenceFromUsername } from '@/domain/forum/userNavigation';
import type { InteractionType, TopicActionStateKind } from '@/domain/forum/topicActionState';
import { sameInlineSizedImagesForReply, type TopicImageDeriver } from '../model/topicDerivedData';
import { TopicPolls } from './TopicPolls';
import { DetailActionButton } from './TopicActionBar';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { getReplyKey, type TopicReplyListItem } from '../model/replyListModel';
import { stableTextHash } from '../model/contentIdentity';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import type { TopicActionDecisionFor } from '../actions/topicActionDecision';

type NodeSeekStat = { label: string; value: number };
type ReplyItemSection = Extract<
  TopicReplyListItem,
  {
    type: 'replyStart' | 'replyQuoteSummary' | 'replyQuoteContent' | 'replyEnd';
  }
>;

function topicForQuotedPost(quote: QuotedPostMetadata, baseUrl?: string): Topic | null {
  if (!quote.topicUrl) return null;
  const topic = parseForumTopicLink(quote.topicUrl, baseUrl);
  return topic?.source === quote.reference.source && topic.id === quote.reference.topicId
    ? { ...topic, ...(quote.topicTitle ? { title: quote.topicTitle } : {}) }
    : null;
}

function visibleNodeSeekStat(label: string, value: number | undefined): NodeSeekStat | null {
  return typeof value === 'number' ? { label, value } : null;
}

export function nodeSeekReactionStats(item: Pick<Reply | TopicDetail, 'upvoteCount' | 'likeCount' | 'dislikeCount'>) {
  return [
    visibleNodeSeekStat('点赞', item.upvoteCount),
    visibleNodeSeekStat('鸡腿', item.likeCount),
    visibleNodeSeekStat('反对', item.dislikeCount)
  ].filter((stat): stat is NodeSeekStat => Boolean(stat));
}

export function nodeSeekTopicReactionStats(
  item: Pick<TopicDetail, 'upvoteCount' | 'likeCount' | 'dislikeCount' | 'collectionCount'>
) {
  return [...nodeSeekReactionStats(item), visibleNodeSeekStat('原站收藏', item.collectionCount)].filter(
    (stat): stat is NodeSeekStat => Boolean(stat)
  );
}

export function NodeSeekStatPill({
  compact = false,
  label,
  styles,
  value
}: {
  compact?: boolean;
  label: string;
  styles: TopicStyles;
  value: number;
}) {
  return (
    <View style={[styles.nodeSeekStatPill, compact && styles.nodeSeekStatCompact]}>
      <Text style={styles.nodeSeekStatText}>
        <Text style={styles.nodeSeekStatLabel}>{label}</Text>
        <Text style={styles.nodeSeekStatValue}> {value}</Text>
      </Text>
    </View>
  );
}

export function DiscourseReactionPill({
  compact = false,
  contentSource,
  stat,
  styles
}: {
  compact?: boolean;
  contentSource: Source | null;
  stat: DiscourseReactionStat;
  styles: TopicStyles;
}) {
  const mediaContext = useForumMediaRequestContext(contentSource);
  const mediaSessionIdentity = mediaContext.sessionIdentity;
  return (
    <View
      accessible
      accessibilityLabel={`${stat.label} ${stat.value}`}
      style={[styles.linuxDoReactionPill, compact && styles.linuxDoReactionPillCompact]}
    >
      {stat.imageUrl ? (
        <ExpoImage
          source={imageSourceFromUrl(stat.imageUrl, { mediaContext })}
          recyclingKey={`${mediaSessionIdentity}:${stat.imageUrl}`}
          style={styles.linuxDoReactionImage}
          contentFit="contain"
        />
      ) : (
        <Text style={styles.linuxDoReactionLabel} numberOfLines={1}>
          {stat.label}
        </Text>
      )}
      <Text style={styles.linuxDoReactionCount}>{stat.value}</Text>
    </View>
  );
}

function NodeSeekActionPlaceholder({ styles }: { styles: TopicStyles }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.detailActionButton,
        styles.replyDetailActionButton,
        styles.replyCompactActionButton,
        { opacity: 0 }
      ]}
    />
  );
}

function systemActionText(reply: Pick<Reply, 'actionCode' | 'contentHtml'>) {
  if (reply.actionCode === 'closed.enabled') {
    return '关闭了主题';
  }
  if (reply.actionCode === 'closed.disabled') {
    return '重新打开了主题';
  }
  const contentText = stripHtml(reply.contentHtml).trim();
  return contentText && (!reply.actionCode || !contentText.includes(reply.actionCode)) ? contentText : '更新了主题';
}

export function ReplyItem({
  actionBusy,
  decisionFor,
  contentWidth,
  expandedQuotes,
  isActionPending,
  isNew,
  loadedQuotedReplies,
  loadingQuotedFloors,
  inlineSizedImageUrls,
  discourseEmojiUrls,
  onTogglePollSelection,
  pollSelections,
  query,
  reply,
  replyFloor,
  repliesByFloor,
  section,
  source,
  styles,
  theme,
  topicAuthor,
  topicBaseUrl,
  topicId,
  topicImageDeriver,
  onInteract,
  onDeleteReply,
  onEditReply,
  onOpenTopic,
  onOpenUser,
  onQuoteContentLayout,
  onReplyToFloor,
  onVotePoll,
  onToggleReplyQuote
}: {
  actionBusy: boolean;
  decisionFor: TopicActionDecisionFor;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  isActionPending: (targetId: string | number | undefined, action: TopicActionStateKind) => boolean;
  inlineSizedImageUrls: Record<string, true>;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  isNew?: boolean;
  loadedQuotedReplies: Record<string, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  onTogglePollSelection: (key: string, poll: TopicPoll, optionId: string) => void;
  pollSelections: Record<string, string[]>;
  query: string;
  reply: Reply;
  replyFloor: number;
  repliesByFloor: Map<number, Reply>;
  section?: ReplyItemSection;
  source?: Source;
  styles: TopicStyles;
  theme: ReaderTheme;
  topicAuthor?: string;
  topicBaseUrl?: string;
  topicId?: string;
  topicImageDeriver: TopicImageDeriver;
  onInteract: (type: InteractionType, commentId?: number) => void;
  onDeleteReply: (reply: Reply) => void;
  onEditReply: (reply: Reply) => void;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserReference) => void;
  onQuoteContentLayout?: (options: { contentToken: string; instanceKey: string }) => void;
  onReplyToFloor: (reply: Reply) => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  onToggleReplyQuote: (options: ToggleReplyQuoteOptions) => void;
}) {
  const { getMappingKey } = useMappingHelper();
  const replyInstanceKey = getReplyKey(reply);
  const isDiscourse = isDiscourseSource(source);
  const isQuoteContent = section?.type === 'replyQuoteContent';
  const replyQuotes = useMemo(
    () =>
      isQuoteContent
        ? []
        : section?.type === 'replyQuoteSummary'
          ? [section.quote]
          : quotedPostsForSource(reply, source),
    [isQuoteContent, reply, section, source]
  );
  const rendersReplyBody = !section || section.type === 'replyEnd';
  const highlightedHtml = useMemo(
    () => (rendersReplyBody ? highlightHtml(reply.contentHtml, query) : ''),
    [query, rendersReplyBody, reply.contentHtml]
  );
  const discourseContentParts = useMemo(
    () => (rendersReplyBody && isDiscourse ? splitDiscourseContentHtml(highlightedHtml, reply.polls) : []),
    [highlightedHtml, isDiscourse, rendersReplyBody, reply.polls]
  );
  const replyContentWidth = Math.max(220, contentWidth - 42);
  const copyReplyTextToClipboard = useCallback(() => {
    const htmlParts = quotedPostsForSource(reply, source).flatMap(({ reference }) => {
      const key = replyQuotedPostInstanceKey(replyInstanceKey, reference);
      if (!expandedQuotes[key]) {
        return [];
      }
      const quotedReply = replyForQuotedPost(reference, source, topicId, repliesByFloor, loadedQuotedReplies);
      return quotedReply?.contentHtml ? [quotedReply.contentHtml] : [];
    });
    htmlParts.push(reply.contentHtml);
    const replyCopyText = stripHtml(htmlParts.join('\n\n'));
    if (!replyCopyText) {
      return;
    }
    triggerPressFeedback();
    void Clipboard.setStringAsync(replyCopyText)
      .then(() => ToastAndroid.show('评论已复制', ToastAndroid.SHORT))
      .catch(() => ToastAndroid.show('复制失败', ToastAndroid.SHORT));
  }, [
    expandedQuotes,
    loadedQuotedReplies,
    repliesByFloor,
    reply,
    reply.contentHtml,
    replyInstanceKey,
    source,
    topicId
  ]);
  if (section?.type === 'replyQuoteContent') {
    const bodyStyle = section.first ? [styles.quoteBody, styles.quotePanelBody, styles.replyQuotePanelBody] : undefined;
    return (
      <View
        style={[styles.replyCard, styles.replyCardMiddle]}
        testID={section.measureForMaterialization ? `reply-quote-materialization-${section.key}` : undefined}
        onLayout={
          section.measureForMaterialization && onQuoteContentLayout
            ? () =>
                onQuoteContentLayout({
                  contentToken: section.contentToken,
                  instanceKey: section.instanceKey
                })
            : undefined
        }
      >
        <View style={styles.replyContentArea}>
          <View
            style={[
              styles.quoteBox,
              styles.replyQuoteBox,
              section.last ? styles.quoteRowBottom : styles.quoteRowContinuation
            ]}
            testID={
              section.first
                ? `reply-quote-complete-${replyFloor}-${section.reference.topicId}-${section.reference.postNumber}`
                : undefined
            }
          >
            <View style={bodyStyle}>
              {section.content.type === 'poll' ? (
                <TopicPolls
                  embeddedInArticle
                  actionBusy={actionBusy}
                  keyPrefix={`quote-${replyFloor}-${section.reference.topicId}-${section.reference.postNumber}`}
                  onTogglePollSelection={onTogglePollSelection}
                  onVotePoll={onVotePoll}
                  pollSelections={pollSelections}
                  polls={[section.content.poll]}
                  source={section.reference.source}
                  styles={styles}
                  theme={theme}
                />
              ) : (
                <Pressable delayLongPress={450} onLongPress={copyReplyTextToClipboard}>
                  <MemoizedTopicContentBlock
                    baseUrl={topicBaseUrl}
                    compact
                    contentWidth={Math.max(220, replyContentWidth - 24)}
                    inlineSizedImageUrls={inlineSizedImageUrls}
                    html={section.content.html}
                    topicImageDeriver={topicImageDeriver}
                  />
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    );
  }
  const replyUser = userFromReply(reply, source);
  const isTopicAuthorReply = Boolean(
    reply.isOp || (source === 'v2ex' && topicAuthor && reply.author && reply.author === topicAuthor)
  );
  const nodeSeekReplyReactionStats = source === 'nodeseek' ? nodeSeekReactionStats(reply) : [];
  const canReply = decisionFor({ action: 'reply' }).allowed;
  const canEdit = decisionFor({ action: 'edit', reply }).allowed;
  const canDelete = decisionFor({ action: 'delete', reply }).allowed;
  const canLike = decisionFor({ action: 'like', reply }).allowed;
  const canUseNodeSeekInteractions = source === 'nodeseek' && canLike;
  const canUseDiscoursePostActions = isDiscourse && Boolean(canReply || canEdit || canDelete || canLike);
  const discourseReplyReactionStats = isDiscourse
    ? source === 'linuxdo'
      ? linuxDoReactionStats(reply, discourseEmojiUrls)
      : discourseReactionStats(reply, discourseEmojiUrls)
    : [];
  const replyTargetUsername = isDiscourse ? reply.replyTargetUsername : reply.replyTargetAuthor;
  const replyTargetUser = source && replyTargetUsername ? userReferenceFromUsername(source, replyTargetUsername) : null;
  if (reply.systemAction) {
    const actionText = systemActionText(reply);
    const author = reply.author || '系统';
    const createdAt = formatDateTime(reply.createdAt);
    return (
      <View
        accessible
        accessibilityLabel={`系统事件，${author} 于 ${createdAt} ${actionText}`}
        style={[styles.replyCard, styles.replyHead, styles.replySystemEvent]}
      >
        <Avatar contentSource={source || null} small name={author} uri={reply.authorAvatar} styles={styles} />
        <View style={styles.replyAuthorBlock}>
          <View style={styles.replyAuthorNameRow}>
            <Text style={styles.replyAuthor} numberOfLines={1}>
              {author}
            </Text>
            <Text style={styles.replySystemEventText}>{actionText}</Text>
          </View>
          <Text style={styles.replyTime}>{createdAt}</Text>
        </View>
        {isNew ? <Text style={styles.replyNewBadge}>新增</Text> : null}
      </View>
    );
  }
  const showStart = !section || section.type === 'replyStart';
  const showQuotes = !section || section.type === 'replyQuoteSummary';
  const showTail = !section || section.type === 'replyEnd';
  return (
    <View
      style={[
        styles.replyCard,
        section?.type === 'replyStart' && styles.replyCardStart,
        section?.type === 'replyQuoteSummary' && styles.replyCardMiddle,
        section?.type === 'replyEnd' && styles.replyCardEnd
      ]}
    >
      {showStart ? (
        <>
          {reply.acceptedAnswer ? (
            <View accessible accessibilityLabel="已采纳的解决方案" style={styles.replyAcceptedNotice}>
              <CheckCircle color={theme.primary} size={16} strokeWidth={2.2} />
              <Text style={styles.replyAcceptedNoticeText}>已解决</Text>
            </View>
          ) : null}
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
            <Avatar contentSource={source || null} small name={reply.author} uri={reply.authorAvatar} styles={styles} />
            <View style={styles.replyAuthorBlock}>
              <View style={styles.replyAuthorNameRow}>
                <Text style={styles.replyAuthor} numberOfLines={1}>
                  {reply.author || '未知作者'}
                </Text>
                {reply.authorLevelLabel ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('neutral', theme)]} numberOfLines={1}>
                    {reply.authorLevelLabel}
                  </Text>
                ) : null}
                {isTopicAuthorReply ? <Text style={styles.replyOpBadge}>OP</Text> : null}
                {reply.hot ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>热门</Text>
                ) : null}
                {reply.pinned ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('accent', theme)]}>置顶</Text>
                ) : null}
                {reply.wiki ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('info', theme)]}>Wiki</Text>
                ) : null}
                {reply.hidden ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('danger', theme)]}>已隐藏</Text>
                ) : null}
                {reply.folded ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>已折叠</Text>
                ) : null}
                {reply.siteExtension?.source === 'linuxdo' && reply.siteExtension.needsApproval ? (
                  <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>待审批</Text>
                ) : null}
              </View>
              <Text style={styles.replyTime}>{formatDateTime(reply.createdAt)}</Text>
            </View>
            <View style={styles.replyFloorBadge}>
              <Text style={styles.replyFloorText}>#{reply.floor ?? '-'}</Text>
            </View>
            {isNew ? <Text style={styles.replyNewBadge}>新增</Text> : null}
          </Pressable>
        </>
      ) : null}
      {showQuotes || showTail ? (
        <View style={styles.replyContentArea} testID="reply-content-area">
          {showQuotes && replyQuotes.length ? (
            <View style={styles.quoteStack}>
              {replyQuotes.map((quote, index) => {
                const { reference } = quote;
                const key = replyQuotedPostInstanceKey(replyInstanceKey, reference);
                const quotedReply =
                  section?.type === 'replyQuoteSummary'
                    ? section.quotedReply
                    : replyForQuotedPost(reference, source, topicId, repliesByFloor, loadedQuotedReplies);
                const quotedAuthorName = quotedReply?.author || quote.author?.label || '未知作者';
                const quotedUser = quotedReply
                  ? userFromReply(quotedReply, reference.source)
                  : quote.author?.username
                    ? userReferenceFromUsername(reference.source, quote.author.username, quote.author.label)
                    : null;
                const quotedTopic =
                  reference.source !== source || reference.topicId !== topicId
                    ? topicForQuotedPost(quote, topicBaseUrl)
                    : null;
                const expanded =
                  section?.type === 'replyQuoteSummary' ? section.expanded : Boolean(expandedQuotes[key]);
                const loading =
                  section?.type === 'replyQuoteSummary' ? section.loading : Boolean(loadingQuotedFloors[key]);
                const completeQuotedPost = !section && expanded ? quotedReply : undefined;
                const hasVirtualContent = section?.type === 'replyQuoteSummary' && section.hasContent;
                return (
                  <View
                    key={getMappingKey(key, index)}
                    style={[styles.quoteBox, styles.replyQuoteBox, hasVirtualContent && styles.quoteRowTop]}
                    testID={`reply-quote-${replyFloor}-${reference.topicId}-${reference.postNumber}`}
                  >
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
                        <Avatar
                          contentSource={reference.source}
                          small
                          name={quotedAuthorName}
                          uri={quotedReply?.authorAvatar}
                          styles={styles}
                        />
                        <View style={styles.quoteAuthorTextBlock}>
                          <Text style={styles.quoteAuthorText} numberOfLines={1}>
                            {quotedAuthorName}
                          </Text>
                          <Text style={styles.replyMeta}>引用 #{reference.postNumber}</Text>
                        </View>
                      </Pressable>
                      <AppButton
                        compact
                        label={loading ? '读取' : expanded ? '收起' : '展开'}
                        variant="ghost"
                        styles={styles}
                        disabled={loading}
                        onPress={() =>
                          onToggleReplyQuote({
                            replyKey: replyInstanceKey,
                            reference,
                            quotedReply
                          })
                        }
                      />
                    </View>
                    {quotedTopic ? (
                      <Pressable
                        accessibilityRole="link"
                        style={styles.quoteTopicLink}
                        onPress={() => onOpenTopic(quotedTopic)}
                      >
                        <Text style={styles.quoteTopicLinkText} numberOfLines={2}>
                          {quotedTopic.title}
                        </Text>
                      </Pressable>
                    ) : null}
                    {quote.preview && !hasVirtualContent && !completeQuotedPost ? (
                      <Text
                        style={styles.quotePreviewText}
                        testID={`reply-quote-preview-${replyFloor}-${reference.topicId}-${reference.postNumber}`}
                      >
                        {quote.preview}
                      </Text>
                    ) : null}
                    {completeQuotedPost ? (
                      <View
                        style={[styles.quoteBody, styles.quotePanelBody, styles.replyQuotePanelBody]}
                        testID={`reply-quote-complete-${replyFloor}-${reference.topicId}-${reference.postNumber}`}
                      >
                        {(isDiscourse
                          ? splitDiscourseContentHtml(completeQuotedPost.contentHtml, completeQuotedPost.polls)
                          : [{ type: 'html' as const, html: completeQuotedPost.contentHtml }]
                        ).map((part) =>
                          part.type === 'poll' ? (
                            <TopicPolls
                              embeddedInArticle
                              key={`quote-poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                              actionBusy={actionBusy}
                              keyPrefix={`quote-${replyFloor}-${reference.topicId}-${reference.postNumber}`}
                              onTogglePollSelection={onTogglePollSelection}
                              onVotePoll={onVotePoll}
                              pollSelections={pollSelections}
                              polls={[part.poll]}
                              source={source}
                              styles={styles}
                              theme={theme}
                            />
                          ) : (
                            <Pressable
                              key={`quote-html-${stableTextHash(part.html)}`}
                              delayLongPress={450}
                              onLongPress={copyReplyTextToClipboard}
                            >
                              <MemoizedTopicContentBlock
                                baseUrl={topicBaseUrl}
                                compact
                                contentWidth={Math.max(220, replyContentWidth - 24)}
                                inlineSizedImageUrls={inlineSizedImageUrls}
                                html={part.html}
                                topicImageDeriver={topicImageDeriver}
                              />
                            </Pressable>
                          )
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
          {showTail ? (
            <>
              {reply.replyTargetAuthor ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={!replyTargetUser}
                  hitSlop={12}
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
              {isDiscourse ? (
                <View style={styles.replyBody}>
                  {discourseContentParts.map((part, index) =>
                    part.type === 'poll' ? (
                      <TopicPolls
                        key={`poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                        actionBusy={actionBusy}
                        decisionFor={decisionFor}
                        keyPrefix={`reply-${reply.floor ?? reply.commentId ?? replyFloor}`}
                        onTogglePollSelection={onTogglePollSelection}
                        onVotePoll={onVotePoll}
                        pollSelections={pollSelections}
                        polls={[part.poll]}
                        source={source}
                        styles={styles}
                        theme={theme}
                      />
                    ) : (
                      <Pressable
                        key={`html-${stableTextHash(part.html)}`}
                        delayLongPress={450}
                        onLongPress={copyReplyTextToClipboard}
                      >
                        <MemoizedTopicContentBlock
                          baseUrl={topicBaseUrl}
                          compact
                          contentWidth={replyContentWidth}
                          inlineSizedImageUrls={inlineSizedImageUrls}
                          html={part.html}
                          trimTrailingBlockSpacing={index === discourseContentParts.length - 1}
                          topicImageDeriver={topicImageDeriver}
                        />
                      </Pressable>
                    )
                  )}
                </View>
              ) : (
                <>
                  <Pressable delayLongPress={450} style={styles.replyBody} onLongPress={copyReplyTextToClipboard}>
                    <MemoizedTopicContentBlock
                      baseUrl={topicBaseUrl}
                      compact
                      contentWidth={replyContentWidth}
                      inlineSizedImageUrls={inlineSizedImageUrls}
                      html={highlightedHtml}
                      trimTrailingBlockSpacing
                      topicImageDeriver={topicImageDeriver}
                    />
                  </Pressable>
                  <TopicPolls
                    actionBusy={actionBusy}
                    decisionFor={decisionFor}
                    keyPrefix={`reply-${reply.floor ?? reply.commentId ?? replyFloor}`}
                    onTogglePollSelection={onTogglePollSelection}
                    onVotePoll={onVotePoll}
                    pollSelections={pollSelections}
                    polls={reply.polls || []}
                    source={source}
                    styles={styles}
                    theme={theme}
                  />
                </>
              )}
              {reply.signatureHtml ? (
                <View style={styles.replySignature}>
                  <MemoizedTopicContentBlock
                    baseUrl={topicBaseUrl}
                    compact
                    contentWidth={replyContentWidth}
                    inlineSizedImageUrls={inlineSizedImageUrls}
                    html={reply.signatureHtml}
                    trimTrailingBlockSpacing
                    topicImageDeriver={topicImageDeriver}
                  />
                </View>
              ) : null}
              {source === 'v2ex' && typeof reply.thanksCount === 'number' && reply.thanksCount > 0 ? (
                <Text style={styles.replyThanksText}>{reply.thanksCount} 感谢</Text>
              ) : null}
              {isDiscourse && discourseReplyReactionStats.length ? (
                <View style={styles.replyStatRail}>
                  {discourseReplyReactionStats.map((stat, index) => (
                    <DiscourseReactionPill
                      compact
                      contentSource={source || null}
                      key={getMappingKey(stat.id, index)}
                      stat={stat}
                      styles={styles}
                    />
                  ))}
                </View>
              ) : null}
              {reply.acceptedAnswer ? (
                <View accessible accessibilityLabel="解决方案" style={styles.replyAcceptedSolution}>
                  <CheckCircle color={theme.primary} size={16} strokeWidth={2.2} />
                  <Text style={styles.replyAcceptedSolutionText}>解决方案</Text>
                </View>
              ) : null}
              {source === 'nodeseek' && !canReply && !canLike && nodeSeekReplyReactionStats.length ? (
                <View style={styles.replyStatRail}>
                  {nodeSeekReplyReactionStats.map((stat, index) => (
                    <NodeSeekStatPill
                      compact
                      key={getMappingKey(stat.label, index)}
                      label={stat.label}
                      value={stat.value}
                      styles={styles}
                    />
                  ))}
                </View>
              ) : null}
              {(canReply || canEdit || canLike) && source === 'nodeseek' ? (
                <View style={styles.replyActionRow}>
                  <DetailActionButton
                    alignStart
                    compact
                    accessibilityLabel="回复"
                    icon={MessageCircle}
                    label="回复"
                    styles={styles}
                    theme={theme}
                    disabled={actionBusy}
                    onPress={() => onReplyToFloor(reply)}
                  />
                  {canEdit ? (
                    <DetailActionButton
                      alignStart
                      compact
                      accessibilityLabel="编辑回复"
                      icon={Pencil}
                      label="编辑"
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onEditReply(reply)}
                    />
                  ) : canUseNodeSeekInteractions ? (
                    <DetailActionButton
                      alignStart
                      compact
                      active={Boolean(reply.upvoted)}
                      tone="success"
                      accessibilityLabel={reply.upvoted ? '已点赞' : '点赞'}
                      count={reply.upvoteCount}
                      icon={ThumbsUp}
                      label="赞"
                      pending={isActionPending(reply.commentId, 'upvote')}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onInteract('upvote', reply.commentId)}
                    />
                  ) : (
                    <NodeSeekActionPlaceholder styles={styles} />
                  )}
                  {canUseNodeSeekInteractions ? (
                    <DetailActionButton
                      alignStart
                      compact
                      active={Boolean(reply.liked)}
                      tone="warning"
                      accessibilityLabel={reply.liked ? '已加鸡腿' : '加鸡腿'}
                      count={reply.likeCount}
                      icon={Drumstick}
                      label="鸡腿"
                      pending={isActionPending(reply.commentId, 'like')}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onInteract('like', reply.commentId)}
                    />
                  ) : (
                    <NodeSeekActionPlaceholder styles={styles} />
                  )}
                  {canUseNodeSeekInteractions ? (
                    <DetailActionButton
                      alignStart
                      compact
                      active={Boolean(reply.disliked)}
                      tone="danger"
                      accessibilityLabel={reply.disliked ? '已反对' : '反对'}
                      count={reply.dislikeCount}
                      icon={ThumbsDown}
                      label="反对"
                      pending={isActionPending(reply.commentId, 'dislike')}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onInteract('dislike', reply.commentId)}
                    />
                  ) : (
                    <NodeSeekActionPlaceholder styles={styles} />
                  )}
                </View>
              ) : null}
              {(canReply || canDelete) && source === 'yaohuo' ? (
                <View style={styles.replyActionRow}>
                  <DetailActionButton
                    alignStart
                    accessibilityLabel="回复"
                    icon={MessageCircle}
                    label="回复"
                    styles={styles}
                    theme={theme}
                    disabled={actionBusy}
                    onPress={() => onReplyToFloor(reply)}
                  />
                  {canDelete ? (
                    <DetailActionButton
                      alignStart
                      accessibilityLabel="删除回复"
                      icon={Trash2}
                      label="删除"
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onDeleteReply(reply)}
                    />
                  ) : null}
                </View>
              ) : null}
              {canUseDiscoursePostActions ? (
                <View style={styles.replyActionRow}>
                  {canReply ? (
                    <DetailActionButton
                      alignStart
                      accessibilityLabel="回复"
                      icon={MessageCircle}
                      label="回复"
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onReplyToFloor(reply)}
                    />
                  ) : null}
                  {canEdit ? (
                    <DetailActionButton
                      alignStart
                      accessibilityLabel="编辑回复"
                      icon={Pencil}
                      label="编辑"
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onEditReply(reply)}
                    />
                  ) : null}
                  {canLike ? (
                    <DetailActionButton
                      alignStart
                      active={Boolean(reply.liked)}
                      tone="success"
                      accessibilityLabel={reply.liked ? '取消赞' : '点赞'}
                      icon={ThumbsUp}
                      label="赞"
                      pending={isActionPending(reply.commentId, 'like')}
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onInteract('like', reply.commentId)}
                    />
                  ) : null}
                  {canDelete ? (
                    <DetailActionButton
                      alignStart
                      accessibilityLabel="删除回复"
                      icon={Trash2}
                      label="删除"
                      styles={styles}
                      theme={theme}
                      disabled={actionBusy}
                      onPress={() => onDeleteReply(reply)}
                    />
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function sameReplyItemSection(previous: ReplyItemSection | undefined, next: ReplyItemSection | undefined) {
  if (previous === next) return true;
  if (!previous || !next || previous.type !== next.type || previous.key !== next.key) return false;
  if (previous.type === 'replyQuoteSummary' && next.type === 'replyQuoteSummary') {
    return (
      previous.quote === next.quote &&
      previous.quotedReply === next.quotedReply &&
      previous.expanded === next.expanded &&
      previous.loading === next.loading &&
      previous.hasContent === next.hasContent
    );
  }
  if (previous.type === 'replyQuoteContent' && next.type === 'replyQuoteContent') {
    return (
      previous.first === next.first &&
      previous.last === next.last &&
      previous.contentToken === next.contentToken &&
      previous.measureForMaterialization === next.measureForMaterialization &&
      previous.content.type === next.content.type &&
      (previous.content.type === 'html' && next.content.type === 'html'
        ? previous.content.html === next.content.html
        : previous.content.type === 'poll' && next.content.type === 'poll'
          ? previous.content.poll === next.content.poll
          : false)
    );
  }
  return true;
}

export const MemoizedReplyItem = memo(ReplyItem, (previous, next) => {
  if (
    previous.actionBusy !== next.actionBusy ||
    previous.decisionFor !== next.decisionFor ||
    previous.contentWidth !== next.contentWidth ||
    previous.isActionPending !== next.isActionPending ||
    previous.isNew !== next.isNew ||
    previous.discourseEmojiUrls !== next.discourseEmojiUrls ||
    previous.onDeleteReply !== next.onDeleteReply ||
    previous.onEditReply !== next.onEditReply ||
    previous.onInteract !== next.onInteract ||
    previous.onOpenTopic !== next.onOpenTopic ||
    previous.onOpenUser !== next.onOpenUser ||
    previous.onQuoteContentLayout !== next.onQuoteContentLayout ||
    previous.onReplyToFloor !== next.onReplyToFloor ||
    previous.onTogglePollSelection !== next.onTogglePollSelection ||
    previous.onToggleReplyQuote !== next.onToggleReplyQuote ||
    previous.onVotePoll !== next.onVotePoll ||
    previous.pollSelections !== next.pollSelections ||
    previous.query !== next.query ||
    previous.replyFloor !== next.replyFloor ||
    !sameReplyItemSection(previous.section, next.section) ||
    previous.source !== next.source ||
    previous.styles !== next.styles ||
    previous.theme !== next.theme ||
    previous.topicAuthor !== next.topicAuthor ||
    previous.topicBaseUrl !== next.topicBaseUrl ||
    previous.topicId !== next.topicId ||
    previous.topicImageDeriver !== next.topicImageDeriver ||
    (next.section?.type === 'replyQuoteContent' && previous.inlineSizedImageUrls !== next.inlineSizedImageUrls) ||
    !sameInlineSizedImagesForReply(previous.reply, next.reply, previous.inlineSizedImageUrls, next.inlineSizedImageUrls)
  ) {
    return false;
  }

  for (const { reference } of next.reply.quotedPosts || []) {
    const previousKey = replyQuotedPostInstanceKey(getReplyKey(previous.reply), reference);
    const nextKey = replyQuotedPostInstanceKey(getReplyKey(next.reply), reference);
    if (
      Boolean(previous.expandedQuotes[previousKey]) !== Boolean(next.expandedQuotes[nextKey]) ||
      Boolean(previous.loadingQuotedFloors[previousKey]) !== Boolean(next.loadingQuotedFloors[nextKey]) ||
      replyForQuotedPost(
        reference,
        previous.source,
        previous.topicId,
        previous.repliesByFloor,
        previous.loadedQuotedReplies
      ) !== replyForQuotedPost(reference, next.source, next.topicId, next.repliesByFloor, next.loadedQuotedReplies)
    ) {
      return false;
    }
  }

  return true;
});
