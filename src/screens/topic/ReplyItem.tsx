import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, ToastAndroid, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { CheckCircle, Drumstick, MessageCircle, Pencil, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react-native';
import type { Reply, Source, TopicDetail, TopicPoll, UserReference } from '../../types';
import { highlightHtml, stripHtml } from '../../androidFeatureHelpers';
import { formatDateTime } from '../../appUtils';
import { imageSourceFromUrl } from '../../htmlImages';
import { splitDiscourseContentHtml } from '../../discourseContent';
import { discourseReactionStats, type DiscourseEmojiUrlMap, type DiscourseReactionStat } from '../../discourseReactions';
import { linuxDoReactionStats } from '../../linuxdoReactions';
import { canToggleDiscourseLike } from '../../discoursePermissions';
import { isDiscourseSource } from '../../sourceCatalog';
import {
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  replyQuotedPostInstanceKey,
  type ToggleReplyQuoteOptions
} from '../../quotedPosts';
import { createStyles, replyContextBadgeStyle, type ReaderTheme } from '../../theme';
import { AppButton, triggerPressFeedback } from '../../components/AppControls';
import { Avatar } from '../../components/Avatar';
import { userFromReply, userReferenceFromUsername } from '../../userNavigation';
import type { InteractionType, TopicActionStateKind } from '../../topicActionState';
import { inlineSizedImageSignatureForReply, type TopicImageDeriver } from '../../topicDerivedData';
import { TopicPolls } from './TopicPolls';
import { DetailActionButton } from './TopicActionBar';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { stableTextHash } from './topicScreenHelpers';
import { useForumMediaRequestContext } from '../../mediaSessionEpoch';

type NodeSeekStat = { label: string; value: number };

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

export function nodeSeekTopicReactionStats(item: Pick<TopicDetail, 'upvoteCount' | 'likeCount' | 'dislikeCount' | 'collectionCount'>) {
  return [
    ...nodeSeekReactionStats(item),
    visibleNodeSeekStat('原站收藏', item.collectionCount)
  ].filter((stat): stat is NodeSeekStat => Boolean(stat));
}

export function NodeSeekStatPill({
  compact = false,
  label,
  styles,
  value
}: {
  compact?: boolean;
  label: string;
  styles: ReturnType<typeof createStyles>;
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
  styles: ReturnType<typeof createStyles>;
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
        <Text style={styles.linuxDoReactionLabel} numberOfLines={1}>{stat.label}</Text>
      )}
      <Text style={styles.linuxDoReactionCount}>{stat.value}</Text>
    </View>
  );
}

function NodeSeekActionPlaceholder({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View
      pointerEvents="none"
      style={[styles.detailActionButton, styles.replyDetailActionButton, styles.replyCompactActionButton, { opacity: 0 }]}
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
  canUseDiscourseActions,
  canWrite,
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
  onOpenUser,
  onReplyToFloor,
  onVotePoll,
  onToggleReplyQuote
}: {
  actionBusy: boolean;
  canUseDiscourseActions: boolean;
  canWrite: boolean;
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
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicAuthor?: string;
  topicBaseUrl?: string;
  topicId?: string;
  topicImageDeriver: TopicImageDeriver;
  onInteract: (type: InteractionType, commentId?: number) => void;
  onDeleteReply: (reply: Reply) => void;
  onEditReply: (reply: Reply) => void;
  onOpenUser: (user: UserReference) => void;
  onReplyToFloor: (reply: Reply) => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  onToggleReplyQuote: (options: ToggleReplyQuoteOptions) => void;
}) {
  const { getMappingKey } = useMappingHelper();
  const isDiscourse = isDiscourseSource(source);
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
  const highlightedHtml = useMemo(() => highlightHtml(reply.contentHtml, query), [query, reply.contentHtml]);
  const discourseContentParts = useMemo(() => (
    isDiscourse ? splitDiscourseContentHtml(highlightedHtml, reply.polls) : []
  ), [highlightedHtml, isDiscourse, reply.polls]);
  const replyContentWidth = Math.max(220, contentWidth);
  const replyUser = userFromReply(reply, source);
  const isTopicAuthorReply = Boolean(reply.isOp || (source === 'v2ex' && topicAuthor && reply.author && reply.author === topicAuthor));
  const nodeSeekReplyReactionStats = source === 'nodeseek' ? nodeSeekReactionStats(reply) : [];
  const canUseNodeSeekInteractions = reply.canLike !== false;
  const canUseDiscoursePostActions = isDiscourse && Boolean(
    canWrite
    || (canUseDiscourseActions
      && (reply.canEdit || reply.canDelete || canToggleDiscourseLike(reply)))
  );
  const discourseReplyReactionStats = isDiscourse
    ? source === 'linuxdo' ? linuxDoReactionStats(reply, discourseEmojiUrls) : discourseReactionStats(reply, discourseEmojiUrls)
    : [];
  const replyTargetUsername = isDiscourse ? reply.replyTargetUsername : reply.replyTargetAuthor;
  const replyTargetUser = source && replyTargetUsername
    ? userReferenceFromUsername(source, replyTargetUsername)
    : null;
  const copyReplyTextToClipboard = useCallback(() => {
    const htmlParts = quotedFloors.flatMap((quotedFloor) => {
      const reference = quotedPostReferenceFromReply(source, topicId, quotedFloor);
      if (!reference) {
        return [];
      }
      const key = replyQuotedPostInstanceKey(replyFloor, reference);
      if (!expandedQuotes[key]) {
        return [];
      }
      const quotedReply = repliesByFloor.get(quotedFloor) || loadedQuotedReplies[quotedPostReferenceKey(reference)];
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
  }, [expandedQuotes, loadedQuotedReplies, quotedFloors, repliesByFloor, reply.contentHtml, replyFloor, source, topicId]);
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
            <Text style={styles.replyAuthor} numberOfLines={1}>{author}</Text>
            <Text style={styles.replySystemEventText}>{actionText}</Text>
          </View>
          <Text style={styles.replyTime}>{createdAt}</Text>
        </View>
        {isNew ? <Text style={styles.replyNewBadge}>新增</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.replyCard}>
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
            <Text style={styles.replyAuthor} numberOfLines={1}>{reply.author || '未知作者'}</Text>
            {reply.authorLevelLabel ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('neutral', theme)]} numberOfLines={1}>{reply.authorLevelLabel}</Text> : null}
            {isTopicAuthorReply ? <Text style={styles.replyOpBadge}>OP</Text> : null}
            {reply.hot ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>热门</Text> : null}
            {reply.pinned ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('accent', theme)]}>置顶</Text> : null}
            {reply.wiki ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('info', theme)]}>Wiki</Text> : null}
            {reply.hidden ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('danger', theme)]}>已隐藏</Text> : null}
            {reply.folded ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>已折叠</Text> : null}
            {reply.siteExtension?.source === 'linuxdo' && reply.siteExtension.needsApproval
              ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('warning', theme)]}>待审批</Text>
              : null}
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
            {quotedFloors.map((quotedFloor, index) => {
              const reference = quotedPostReferenceFromReply(source, topicId, quotedFloor);
              if (!reference) {
                return null;
              }
              const key = replyQuotedPostInstanceKey(replyFloor, reference);
              const quotedReply = repliesByFloor.get(quotedFloor) || loadedQuotedReplies[quotedPostReferenceKey(reference)];
              const quotedAuthorFromMarkup = reply.quotedAuthors?.[quotedFloor];
              const quotedPreview = reply.quotedPreviews?.[quotedFloor];
              const quotedAuthorName = quotedReply?.author || quotedAuthorFromMarkup?.label || '未知作者';
              const quotedUser = quotedReply
                ? userFromReply(quotedReply, source)
                : source && quotedAuthorFromMarkup?.username
                  ? userReferenceFromUsername(source, quotedAuthorFromMarkup.username, quotedAuthorFromMarkup.label)
                  : null;
              const expanded = Boolean(expandedQuotes[key]);
              const loading = Boolean(loadingQuotedFloors[key]);
              const completeQuotedPost = expanded ? quotedReply : undefined;
              return (
                <View
                  key={getMappingKey(key, index)}
                  style={[styles.quoteBox, styles.replyQuoteBox]}
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
                      {quotedReply ? <Avatar contentSource={source || null} small name={quotedReply.author} uri={quotedReply.authorAvatar} styles={styles} /> : null}
                      <View style={styles.quoteAuthorTextBlock}>
                        <Text style={styles.quoteAuthorText} numberOfLines={1}>{quotedAuthorName}</Text>
                        <Text style={styles.replyMeta}>引用 #{quotedFloor}</Text>
                      </View>
                    </Pressable>
                    <AppButton
                      compact
                      label={loading ? '读取' : expanded ? '收起' : '展开'}
                      variant="ghost"
                      styles={styles}
                      disabled={loading}
                      onPress={() => onToggleReplyQuote({ replyFloor, quotedFloor, quotedReply })}
                    />
                  </View>
                  {quotedPreview ? (
                    <Text style={styles.quotePreviewText} testID={`reply-quote-preview-${replyFloor}-${reference.topicId}-${reference.postNumber}`}>
                      {quotedPreview}
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
                      ).map((part) => part.type === 'poll' ? (
                        <TopicPolls
                          embeddedInArticle
                          key={`quote-poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                          actionBusy={actionBusy}
                          canWritePollSource={false}
                          keyPrefix={`quote-${replyFloor}-${quotedFloor}`}
                          onTogglePollSelection={onTogglePollSelection}
                          onVotePoll={onVotePoll}
                          pollSelections={pollSelections}
                          polls={[part.poll]}
                          source={source}
                          styles={styles}
                          theme={theme}
                        />
                      ) : (
                        <Pressable key={`quote-html-${stableTextHash(part.html)}`} delayLongPress={450} onLongPress={copyReplyTextToClipboard}>
                          <MemoizedTopicContentBlock
                            baseUrl={topicBaseUrl}
                            compact
                            contentWidth={Math.max(220, replyContentWidth - 24)}
                            inlineSizedImageUrls={inlineSizedImageUrls}
                            html={part.html}
                            topicImageDeriver={topicImageDeriver}
                          />
                        </Pressable>
                      ))}
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
        {isDiscourse ? (
          <View style={styles.replyBody}>
            {discourseContentParts.map((part, index) => part.type === 'poll' ? (
              <TopicPolls
                key={`poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                actionBusy={actionBusy}
                canWritePollSource={canUseDiscourseActions}
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
              <Pressable key={`html-${stableTextHash(part.html)}`} delayLongPress={450} onLongPress={copyReplyTextToClipboard}>
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
            ))}
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
              canWritePollSource={false}
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
              <DiscourseReactionPill compact contentSource={source || null} key={getMappingKey(stat.id, index)} stat={stat} styles={styles} />
            ))}
          </View>
        ) : null}
        {reply.acceptedAnswer ? (
          <View accessible accessibilityLabel="解决方案" style={styles.replyAcceptedSolution}>
            <CheckCircle color={theme.primary} size={16} strokeWidth={2.2} />
            <Text style={styles.replyAcceptedSolutionText}>解决方案</Text>
          </View>
        ) : null}
        {source === 'nodeseek' && !canWrite && nodeSeekReplyReactionStats.length ? (
          <View style={styles.replyStatRail}>
            {nodeSeekReplyReactionStats.map((stat, index) => (
              <NodeSeekStatPill compact key={getMappingKey(stat.label, index)} label={stat.label} value={stat.value} styles={styles} />
            ))}
          </View>
        ) : null}
        {canWrite && source === 'nodeseek' ? (
          <View style={styles.replyActionRow}>
            <DetailActionButton alignStart compact accessibilityLabel="回复" icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
            {reply.canEdit ? <DetailActionButton alignStart compact accessibilityLabel="编辑回复" icon={Pencil} label="编辑" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onEditReply(reply)} /> : canUseNodeSeekInteractions ? <DetailActionButton alignStart compact active={Boolean(reply.upvoted)} tone="success" accessibilityLabel={reply.upvoted ? '已点赞' : '点赞'} count={reply.upvoteCount} icon={ThumbsUp} label="赞" pending={isActionPending(reply.commentId, 'upvote')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} /> : <NodeSeekActionPlaceholder styles={styles} />}
            {canUseNodeSeekInteractions ? <DetailActionButton alignStart compact active={Boolean(reply.liked)} tone="warning" accessibilityLabel={reply.liked ? '已加鸡腿' : '加鸡腿'} count={reply.likeCount} icon={Drumstick} label="鸡腿" pending={isActionPending(reply.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} /> : <NodeSeekActionPlaceholder styles={styles} />}
            {canUseNodeSeekInteractions ? <DetailActionButton alignStart compact active={Boolean(reply.disliked)} tone="danger" accessibilityLabel={reply.disliked ? '已反对' : '反对'} count={reply.dislikeCount} icon={ThumbsDown} label="反对" pending={isActionPending(reply.commentId, 'dislike')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('dislike', reply.commentId)} /> : <NodeSeekActionPlaceholder styles={styles} />}
          </View>
        ) : null}
        {canWrite && source === 'yaohuo' ? (
          <View style={styles.replyActionRow}>
            <DetailActionButton alignStart accessibilityLabel="回复" icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
            {reply.canDelete ? <DetailActionButton alignStart accessibilityLabel="删除回复" icon={Trash2} label="删除" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onDeleteReply(reply)} /> : null}
          </View>
        ) : null}
        {canUseDiscoursePostActions ? (
          <View style={styles.replyActionRow}>
            {canWrite ? <DetailActionButton alignStart accessibilityLabel="回复" icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} /> : null}
            {reply.canEdit ? <DetailActionButton alignStart accessibilityLabel="编辑回复" icon={Pencil} label="编辑" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onEditReply(reply)} /> : null}
            {canToggleDiscourseLike(reply) ? <DetailActionButton alignStart active={Boolean(reply.liked)} tone="success" accessibilityLabel={reply.liked ? '取消赞' : '点赞'} icon={ThumbsUp} label="赞" pending={isActionPending(reply.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} /> : null}
            {reply.canDelete ? <DetailActionButton alignStart accessibilityLabel="删除回复" icon={Trash2} label="删除" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onDeleteReply(reply)} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const MemoizedReplyItem = memo(ReplyItem, (previous, next) => {
  if (
    previous.actionBusy !== next.actionBusy
    || previous.canUseDiscourseActions !== next.canUseDiscourseActions
    || previous.canWrite !== next.canWrite
    || previous.contentWidth !== next.contentWidth
    || previous.isActionPending !== next.isActionPending
    || inlineSizedImageSignatureForReply(previous.reply, previous.inlineSizedImageUrls) !== inlineSizedImageSignatureForReply(next.reply, next.inlineSizedImageUrls)
    || previous.isNew !== next.isNew
    || previous.discourseEmojiUrls !== next.discourseEmojiUrls
    || previous.onDeleteReply !== next.onDeleteReply
    || previous.onEditReply !== next.onEditReply
    || previous.onInteract !== next.onInteract
    || previous.onOpenUser !== next.onOpenUser
    || previous.onReplyToFloor !== next.onReplyToFloor
    || previous.onTogglePollSelection !== next.onTogglePollSelection
    || previous.onToggleReplyQuote !== next.onToggleReplyQuote
    || previous.onVotePoll !== next.onVotePoll
    || previous.pollSelections !== next.pollSelections
    || previous.query !== next.query
    || previous.reply !== next.reply
    || previous.replyFloor !== next.replyFloor
    || previous.source !== next.source
    || previous.styles !== next.styles
    || previous.theme !== next.theme
    || previous.topicAuthor !== next.topicAuthor
    || previous.topicBaseUrl !== next.topicBaseUrl
    || previous.topicId !== next.topicId
    || previous.topicImageDeriver !== next.topicImageDeriver
  ) {
    return false;
  }

  const quotedFloors = new Set([...(previous.reply.quotedFloors || []), ...(next.reply.quotedFloors || [])]);
  for (const quotedFloor of quotedFloors) {
    const previousReference = quotedPostReferenceFromReply(previous.source, previous.topicId, quotedFloor);
    const nextReference = quotedPostReferenceFromReply(next.source, next.topicId, quotedFloor);
    if (!previousReference || !nextReference) {
      continue;
    }
    const previousKey = replyQuotedPostInstanceKey(previous.replyFloor, previousReference);
    const nextKey = replyQuotedPostInstanceKey(next.replyFloor, nextReference);
    if (
      Boolean(previous.expandedQuotes[previousKey]) !== Boolean(next.expandedQuotes[nextKey])
      || Boolean(previous.loadingQuotedFloors[previousKey]) !== Boolean(next.loadingQuotedFloors[nextKey])
      || previous.loadedQuotedReplies[quotedPostReferenceKey(previousReference)] !== next.loadedQuotedReplies[quotedPostReferenceKey(nextReference)]
      || previous.repliesByFloor.get(quotedFloor) !== next.repliesByFloor.get(quotedFloor)
    ) {
      return false;
    }
  }

  return true;
});
