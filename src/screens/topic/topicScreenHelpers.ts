import type { AccessRequirement, Reply, Topic } from '../../types';
import { accessRequirementFromNoticeText, textContentFromHtml } from '../../localHtml';

export type TopicListItem =
  | { type: 'emptyReplies'; key: string }
  | { type: 'reply'; key: string; reply: Reply; replyFloor: number };

function stableTextHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function slowModeLabel(seconds: number) {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

function getReplyKey(reply: Reply) {
  if (typeof reply.commentId === 'number') {
    return `reply-comment-${reply.commentId}`;
  }
  if (typeof reply.floor === 'number') {
    return `reply-floor-${reply.floor}`;
  }
  const seed = [
    reply.authorId || '',
    reply.author || '',
    reply.createdAt || '',
    reply.contentHtml || ''
  ].join('|');
  return `reply-${stableTextHash(seed || JSON.stringify(reply))}`;
}

export function topicStatusBadges(item: Pick<Topic, 'acceptedAnswerFloor' | 'archived' | 'closed' | 'pinned' | 'slowModeSeconds' | 'solved'>) {
  const badges: { label: string; tone: 'success' | 'accent' | 'danger' | 'neutral' | 'warning' }[] = [];
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

export function readableTopicError(message: string) {
  if (/upstream unavailable/i.test(message)) {
    return '来源暂时不可用，请稍后重试';
  }
  if (/^HTTP 5\d\d$/i.test(message)) {
    return `来源暂时不可用（${message}）`;
  }
  return message;
}

export function isAccessNoticeHtml(html: string, accessRequirement?: AccessRequirement) {
  if (!accessRequirement) {
    return false;
  }
  const text = textContentFromHtml(html);
  return !text || Boolean(accessRequirementFromNoticeText(text));
}

export function buildReplyListItems({
  canShowReplies,
  replies,
  topicShowsAccessNotice
}: {
  canShowReplies: boolean;
  replies: Reply[];
  topicShowsAccessNotice: boolean;
}): TopicListItem[] {
  if (!canShowReplies || topicShowsAccessNotice) {
    return [];
  }
  if (!replies.length) {
    return [{ type: 'emptyReplies', key: 'empty-replies' }];
  }
  const keyCounts = new Map<string, number>();
  return replies.map((reply) => {
    const baseKey = getReplyKey(reply);
    const count = (keyCounts.get(baseKey) || 0) + 1;
    keyCounts.set(baseKey, count);
    return {
      type: 'reply',
      key: count === 1 ? baseKey : `${baseKey}-duplicate-${count}`,
      reply,
      replyFloor: reply.floor ?? 0
    };
  });
}

export {
  getReplyKey,
  stableTextHash
};
