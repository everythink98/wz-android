import { memo, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
import { Drumstick, MessageCircle, Pencil, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react-native';
import type { Reply, Source, TopicDetail, TopicPoll, UserProfile } from '../../types';
import { highlightHtml } from '../../androidFeatureHelpers';
import { formatDateTime } from '../../appUtils';
import { imageSourceFromUrl } from '../../htmlImages';
import { linuxDoReactionStats, type LinuxDoEmojiUrlMap, type LinuxDoReactionStat } from '../../linuxdoReactions';
import { canUseLinuxDoLike } from '../../linuxdoPermissions';
import { createStyles, replyContextBadgeStyle, type ReaderTheme } from '../../theme';
import { AppButton } from '../../components/AppControls';
import { Avatar } from '../../components/Avatar';
import { userFromReply } from '../../userNavigation';
import type { InteractionType, TopicActionStateKind } from '../../topicActionState';
import { inlineSizedImageSignatureForReply, type TopicImageDeriver } from '../../topicDerivedData';
import { TopicPolls } from './TopicPolls';
import { DetailActionButton } from './TopicActionBar';
import { MemoizedTopicContentBlock } from './TopicContentBlock';

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

export function LinuxDoReactionPill({
  compact = false,
  stat,
  styles
}: {
  compact?: boolean;
  stat: LinuxDoReactionStat;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${stat.label} ${stat.value}`}
      style={[styles.linuxDoReactionPill, compact && styles.linuxDoReactionPillCompact]}
    >
      {stat.imageUrl ? (
        <ExpoImage source={imageSourceFromUrl(stat.imageUrl)} style={styles.linuxDoReactionImage} contentFit="contain" />
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

export function ReplyItem({
  actionBusy,
  canWrite,
  contentWidth,
  expandedQuotes,
  isActionPending,
  isNew,
  loadedQuotedReplies,
  loadingQuotedFloors,
  inlineSizedImageUrls,
  linuxDoEmojiUrls,
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
  topicImageDeriver,
  onInteract,
  onDeleteReply,
  onEditReply,
  onOpenUser,
  onReplyToFloor,
  onVotePoll,
  onToggleQuotedFloor
}: {
  actionBusy: boolean;
  canWrite: boolean;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  isActionPending: (targetId: string | number | undefined, action: TopicActionStateKind) => boolean;
  inlineSizedImageUrls: Record<string, true>;
  linuxDoEmojiUrls?: LinuxDoEmojiUrlMap;
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
  topicBaseUrl?: string;
  topicImageDeriver: TopicImageDeriver;
  onInteract: (type: InteractionType, commentId?: number) => void;
  onDeleteReply: (reply: Reply) => void;
  onEditReply: (reply: Reply) => void;
  onOpenUser: (user: UserProfile) => void;
  onReplyToFloor: (reply: Reply) => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const { getMappingKey } = useMappingHelper();
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
  const highlightedHtml = useMemo(() => highlightHtml(reply.contentHtml, query), [query, reply.contentHtml]);
  const replyContentWidth = Math.max(220, contentWidth - 42);
  const replyUser = userFromReply(reply, source);
  const isTopicAuthorReply = Boolean(reply.isOp || (source === 'v2ex' && topicAuthor && reply.author && reply.author === topicAuthor));
  const nodeSeekReplyReactionStats = source === 'nodeseek' ? nodeSeekReactionStats(reply) : [];
  const canUseNodeSeekInteractions = reply.canLike !== false;
  const linuxDoReplyReactionStats = source === 'linuxdo' ? linuxDoReactionStats(reply, linuxDoEmojiUrls) : [];
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
        <Avatar small name={reply.author} uri={reply.authorAvatar} styles={styles} />
        <View style={styles.replyAuthorBlock}>
          <View style={styles.replyAuthorNameRow}>
            <Text style={styles.replyAuthor} numberOfLines={1}>{reply.author || '未知作者'}</Text>
            {reply.authorLevelLabel ? <Text style={[styles.replyContextBadge, replyContextBadgeStyle('neutral', theme)]} numberOfLines={1}>{reply.authorLevelLabel}</Text> : null}
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
            {quotedFloors.map((quotedFloor, index) => {
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
                <View key={getMappingKey(key, index)} style={styles.quoteBox}>
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
                      {quotedReply ? <Avatar small name={quotedReply.author} uri={quotedReply.authorAvatar} styles={styles} /> : null}
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
                        <Avatar small name={quotedReply.author} uri={quotedReply.authorAvatar} styles={styles} />
                        <Text style={styles.replyMeta}>引用 #{quotedFloor} · {quotedReply.author || '未知作者'}</Text>
                      </Pressable>
                      <MemoizedTopicContentBlock
                        baseUrl={topicBaseUrl}
                        contentWidth={Math.max(220, replyContentWidth - 24)}
                        inlineSizedImageUrls={inlineSizedImageUrls}
                        html={quotedReply.contentHtml}
                        topicImageDeriver={topicImageDeriver}
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
          <MemoizedTopicContentBlock
            baseUrl={topicBaseUrl}
            contentWidth={replyContentWidth}
            inlineSizedImageUrls={inlineSizedImageUrls}
            html={highlightedHtml}
            topicImageDeriver={topicImageDeriver}
          />
        </View>
        <TopicPolls
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
            <MemoizedTopicContentBlock
              baseUrl={topicBaseUrl}
              contentWidth={replyContentWidth}
              inlineSizedImageUrls={inlineSizedImageUrls}
              html={reply.signatureHtml}
              topicImageDeriver={topicImageDeriver}
            />
          </View>
        ) : null}
        {source === 'v2ex' && typeof reply.thanksCount === 'number' && reply.thanksCount > 0 ? (
          <Text style={styles.replyThanksText}>{reply.thanksCount} 感谢</Text>
        ) : null}
        {source === 'linuxdo' && linuxDoReplyReactionStats.length ? (
          <View style={styles.replyStatRail}>
            {linuxDoReplyReactionStats.map((stat, index) => (
              <LinuxDoReactionPill compact key={getMappingKey(stat.id, index)} stat={stat} styles={styles} />
            ))}
          </View>
        ) : null}
        {source === 'nodeseek' && !canWrite && nodeSeekReplyReactionStats.length ? (
          <View style={styles.replyStatRail}>
            {nodeSeekReplyReactionStats.map((stat, index) => (
              <NodeSeekStatPill key={getMappingKey(stat.label, index)} label={stat.label} value={stat.value} styles={styles} />
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
        {canWrite && source === 'linuxdo' ? (
          <View style={styles.replyActionRow}>
            <DetailActionButton alignStart accessibilityLabel="回复" icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
            {reply.canEdit ? <DetailActionButton alignStart accessibilityLabel="编辑回复" icon={Pencil} label="编辑" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onEditReply(reply)} /> : null}
            {canUseLinuxDoLike(reply) ? <DetailActionButton alignStart active={Boolean(reply.liked)} tone="success" accessibilityLabel={reply.liked ? '取消赞' : '点赞'} icon={ThumbsUp} label="赞" pending={isActionPending(reply.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} /> : null}
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
    || previous.canWrite !== next.canWrite
    || previous.contentWidth !== next.contentWidth
    || previous.isActionPending !== next.isActionPending
    || inlineSizedImageSignatureForReply(previous.reply, previous.inlineSizedImageUrls) !== inlineSizedImageSignatureForReply(next.reply, next.inlineSizedImageUrls)
    || previous.isNew !== next.isNew
    || previous.linuxDoEmojiUrls !== next.linuxDoEmojiUrls
    || previous.onDeleteReply !== next.onDeleteReply
    || previous.onEditReply !== next.onEditReply
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
    || previous.topicBaseUrl !== next.topicBaseUrl
    || previous.topicImageDeriver !== next.topicImageDeriver
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
