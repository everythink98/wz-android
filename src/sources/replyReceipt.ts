import { isRecord } from '@/domain/forum/html';
import { positiveInteger } from '@/domain/forum/numericValues';
import { discourseActionResponseMessage, discourseCreatedReplyTarget } from '@/sources/discourse/actionRequest';
import { isConfirmedNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { nodeSeekActionErrorMessage, nodeSeekCreatedReplyTarget } from '@/sources/nodeseek/actionRequest';

export type ReplyWriteReceipt =
  | {
      kind: 'confirmed';
      postId?: number;
      target?: { floor: number; commentId?: number; pageHint?: number };
      message?: string;
    }
  | { kind: 'enqueued'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'unconfirmed'; message: string };

export function nodeSeekReplyReceipt(data: unknown, topicId?: string): ReplyWriteReceipt {
  if (isConfirmedNodeSeekAction(data)) {
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    return { kind: 'confirmed', target: topicId ? nodeSeekCreatedReplyTarget(data, topicId) : undefined, message };
  }
  if (isRecord(data) && data.success === false)
    return { kind: 'rejected', message: nodeSeekActionErrorMessage(data, 200, 'NodeSeek 拒绝了回复请求') };
  return { kind: 'unconfirmed', message: 'NodeSeek 未确认回复已发送' };
}

function replyInteger(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const integer = positiveInteger(value);
  return Number.isSafeInteger(integer) ? integer : undefined;
}

export function discourseReplyReceipt(data: unknown, topicId: string): ReplyWriteReceipt {
  const unconfirmed = { kind: 'unconfirmed', message: '原站未确认发送成功，请刷新核对。' } as const;
  if (!isRecord(data)) return unconfirmed;
  const rejected =
    data.success === false ||
    (typeof data.error === 'string' && data.error.trim()) ||
    (Array.isArray(data.errors) && data.errors.some((error) => typeof error === 'string' && error.trim()));
  if (rejected) {
    return { kind: 'rejected', message: discourseActionResponseMessage(data, 'linux.do 拒绝了回复请求') };
  }
  if (data.action === 'enqueued') {
    return data.success === true ? { kind: 'enqueued', message: '回复已提交，正在等待审核' } : unconfirmed;
  }
  const post = isRecord(data.post) ? data.post : data;
  if (post.topic_id !== undefined && String(post.topic_id) !== topicId) return unconfirmed;
  if (post.post_number !== undefined && !replyInteger(post.post_number)) return unconfirmed;
  if (Number(post.post_number) === 1) return unconfirmed;
  const postId = replyInteger(post.id);
  return postId ? { kind: 'confirmed', postId, target: discourseCreatedReplyTarget(data, topicId) } : unconfirmed;
}
