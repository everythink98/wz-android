import { memo, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Drumstick, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import type { Reply, Source, TopicDetail, TopicPoll, UserProfile } from '../../types';
import { highlightHtml } from '../../androidFeatureHelpers';
import { formatDateTime } from '../../appUtils';
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

function visiblePositiveStat(label: string, value: number | undefined): NodeSeekStat | null {
  return typeof value === 'number' && value > 0 ? { label, value } : null;
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

function linuxDoReactionLabel(id: string) {
  return LINUXDO_REACTION_LABELS[id] || id.replace(/_/g, ' ');
}

export function linuxDoReactionStats(item: Pick<Reply | TopicDetail, 'boostCount' | 'reactionSummary' | 'likeCount'>) {
  const reactions = item.reactionSummary || [];
  const hasHeartReaction = reactions.some((reaction) => reaction.id === 'heart');
  return [
    hasHeartReaction ? null : visiblePositiveStat('喜欢', item.likeCount),
    ...reactions.map((reaction) => ({ label: linuxDoReactionLabel(reaction.id), value: reaction.count })),
    visiblePositiveStat('加电', item.boostCount)
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
  topicImageDeriver,
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
  isActionPending: (targetId: string | number | undefined, action: TopicActionStateKind) => boolean;
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
  topicImageDeriver: TopicImageDeriver;
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
        <Avatar small name={reply.author} uri={reply.authorAvatar} styles={styles} />
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
            {linuxDoReplyReactionStats.map((stat) => (
              <NodeSeekStatPill compact key={stat.label} label={stat.label} value={stat.value} styles={styles} />
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
            <DetailActionButton alignStart accessibilityLabel="回复" icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
            <DetailActionButton alignStart active={Boolean(reply.upvoted)} accessibilityLabel={reply.upvoted ? '已点赞' : '点赞'} count={reply.upvoteCount} icon={ThumbsUp} label="赞" pending={isActionPending(reply.commentId, 'upvote')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} />
            <DetailActionButton alignStart active={Boolean(reply.liked)} accessibilityLabel={reply.liked ? '已加鸡腿' : '加鸡腿'} count={reply.likeCount} icon={Drumstick} label="鸡腿" pending={isActionPending(reply.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
            <DetailActionButton alignStart active={Boolean(reply.disliked)} accessibilityLabel={reply.disliked ? '已反对' : '反对'} count={reply.dislikeCount} icon={ThumbsDown} label="反对" pending={isActionPending(reply.commentId, 'dislike')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('dislike', reply.commentId)} />
          </View>
        ) : null}
        {canWrite && source === 'yaohuo' ? (
          <View style={styles.replyActionRow}>
            <DetailActionButton alignStart accessibilityLabel="回复" icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
          </View>
        ) : null}
        {canWrite && source === 'linuxdo' ? (
          <View style={styles.replyActionRow}>
            <DetailActionButton alignStart accessibilityLabel="回复" icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
            <DetailActionButton alignStart active={Boolean(reply.liked)} accessibilityLabel={reply.liked ? '取消赞' : '点赞'} icon={ThumbsUp} label="赞" pending={isActionPending(reply.commentId, 'like')} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
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
