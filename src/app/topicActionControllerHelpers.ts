import type { ReplyEditTarget, Screen, TopicSnapshot } from '../appTypes';
import { nodeSeekMarkdownToHtml } from '../nodeSeekMarkdown';
import type { OptimisticActionState } from '../topicActionState';
import type { Reply, Source, Topic, TopicDetail, TopicPoll, UserProfile } from '../types';

type TopicActionTopic = Topic | TopicDetail;

export const YAOHUO_DEFAULT_CLASS_ID = '177';

export function currentTopicActionTopic(topicDetail: TopicDetail | null, selectedTopic: Topic | null) {
  return topicDetail || selectedTopic;
}

export function isNodeSeekActionTopic(topic: TopicActionTopic | null): topic is TopicActionTopic & { source: 'nodeseek' } {
  return topic?.source === 'nodeseek';
}

export function isYaohuoActionTopic(topic: TopicActionTopic | null): topic is TopicActionTopic & { source: 'yaohuo' } {
  return topic?.source === 'yaohuo';
}

export function isLinuxDoActionTopic(topic: TopicActionTopic | null): topic is TopicActionTopic & { source: 'linuxdo' } {
  return topic?.source === 'linuxdo';
}

export function canSubmitReplyToTopic(topic: TopicActionTopic | null): topic is TopicActionTopic {
  if (!topic || !isActionSource(topic.source, ['nodeseek', 'linuxdo', 'yaohuo'])) {
    return false;
  }
  return !('locked' in topic) || topic.locked !== true;
}

export function canVotePollOnTopic(topic: TopicActionTopic | null): topic is TopicActionTopic {
  return isActionSource(topic?.source, ['nodeseek', 'linuxdo', 'yaohuo']);
}

export function topicReplyActionKey(topicKey: string) {
  return `reply:${topicKey}`;
}

export function topicEditReplyActionKey(topicKey: string, commentId: string | number) {
  return `edit-reply:${topicKey}:${commentId}`;
}

export function yaohuoFavoriteActionKey(topicKey: string) {
  return `yaohuo-favorite:${topicKey}`;
}

export function topicPollVoteActionKey(topicKey: string, poll: Pick<TopicPoll, 'id' | 'name' | 'postId'>) {
  return `vote:${topicKey}:${poll.id || poll.name || poll.postId || 'poll'}`;
}

export function nodeSeekAttendanceActionKey() {
  return 'nodeseek:attendance';
}

export function isTopicScopedActionKey(key: string) {
  return key !== nodeSeekAttendanceActionKey();
}

export function shouldInvalidateTopicActionsOnScreenChange(currentScreen: Screen, nextScreen: Screen) {
  return currentScreen === 'topic' && nextScreen !== 'topic';
}

export function hasPendingOptimisticTopicAction(actions: Record<string, OptimisticActionState>) {
  return Object.values(actions).some((action) => action.inFlight);
}

export function topicSnapshotForUserReturn(snapshot: TopicSnapshot, hasPendingOptimisticAction: boolean): TopicSnapshot {
  if (!hasPendingOptimisticAction) {
    return snapshot;
  }
  return {
    ...snapshot,
    selectedTopic: snapshot.selectedTopic || snapshot.topicDetail,
    topicDetail: null,
    topicReplies: [],
    replyHasMore: false,
    replyNextPage: null,
    replyNextOffset: null,
    unreadReplyCount: 0,
    expandedQuotes: {},
    loadedQuotedReplies: {},
    loadingQuotedFloors: {},
    scrollY: 0
  };
}

export function applyEditedReplyContent(replies: Reply[], edit: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'>, source: Source) {
  if (source !== 'nodeseek') {
    return replies;
  }
  const contentMarkdown = edit.contentMarkdown.trim();
  if (!contentMarkdown) {
    return replies;
  }
  let changed = false;
  const contentHtml = nodeSeekMarkdownToHtml(contentMarkdown);
  const next = replies.map((reply) => {
    if (reply.commentId !== edit.commentId) {
      return reply;
    }
    changed = true;
    return {
      ...reply,
      contentHtml,
      contentMarkdown
    };
  });
  return changed ? next : replies;
}

export function shouldApplyEditedReplyFallback(
  replies: Reply[],
  edit: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'> | undefined,
  source: Source
): edit is Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'> {
  return source === 'nodeseek' && Boolean(edit?.contentMarkdown.trim()) && !replies.some((reply) => reply.commentId === edit?.commentId);
}

export function markCurrentNodeSeekOwnRepliesUnlikable(replies: Reply[], currentUser: UserProfile | undefined, currentUserId?: number | null) {
  const cleanCurrentUserId = positiveId(currentUserId) || (currentUser?.source === 'nodeseek' ? String(currentUser.id || '').trim() : '');
  if (!cleanCurrentUserId) {
    return replies;
  }
  let changed = false;
  const next = replies.map((reply) => {
    if (!isCurrentNodeSeekReply(reply, currentUser, cleanCurrentUserId)) {
      return reply;
    }
    const canEdit = Boolean(reply.commentId && reply.contentMarkdown);
    if (reply.canLike === false && reply.canEdit === canEdit) {
      return reply;
    }
    changed = true;
    if (canEdit) {
      return { ...reply, canEdit: true, canLike: false };
    }
    const nextReply = { ...reply };
    delete nextReply.canEdit;
    return { ...nextReply, canLike: false };
  });
  return changed ? next : replies;
}

function isCurrentNodeSeekReply(reply: Reply, currentUser: UserProfile | undefined, currentUserId: string) {
  if (currentUser && currentUser.source !== 'nodeseek') {
    return false;
  }
  const replyAuthorId = String(reply.authorId || '').trim();
  return Boolean(replyAuthorId && currentUserId && replyAuthorId === currentUserId);
}

function positiveId(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? String(number) : '';
}

function isActionSource(source: Source | undefined, supportedSources: Source[]) {
  return Boolean(source && supportedSources.includes(source));
}
