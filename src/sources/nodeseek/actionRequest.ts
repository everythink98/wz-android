import { NODESEEK_VOTE_API_HEADERS } from './polls';
import { NODESEEK_BASE_URL } from './protocol';
import {
  normalizeNodeSeekStardustRefId,
  type NodeSeekStardustReceive,
  type PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';

export interface NodeSeekActionRequest {
  path: string;
  method: 'POST';
  headers: Record<string, string>;
  body?: string;
  fallbackErrorMessage?: string;
}

type NodeSeekInteractionType = 'upvote' | 'like' | 'dislike';

const NODESEEK_CONTENT_TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function nodeSeekInteractionRemovalMessage(type: NodeSeekInteractionType) {
  const labels: Record<NodeSeekInteractionType, string> = {
    upvote: '点赞',
    like: '鸡腿',
    dislike: '反对'
  };
  return `NodeSeek 原站不支持取消${labels[type]}`;
}

function cleanPositiveInteger(value: string | number, name: string) {
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} 不正确`);
  }
  return number;
}

function randomNodeSeekContentToken() {
  let token = '';
  for (let index = 0; index < 16; index += 1) {
    token += NODESEEK_CONTENT_TOKEN_CHARS.charAt(Math.floor(Math.random() * NODESEEK_CONTENT_TOKEN_CHARS.length));
  }
  return token;
}

function cleanCsrfToken(value: string) {
  const token = String(value || '').trim();
  return token || randomNodeSeekContentToken();
}

export function buildNodeSeekReplyRequest({
  postId,
  content,
  csrfToken,
  replyTarget
}: {
  postId: string | number;
  content: string;
  csrfToken: string;
  replyTarget?: {
    floor?: string | number;
    author?: string;
  } | null;
}): NodeSeekActionRequest {
  const cleanContent = content.trim();
  if (!cleanContent) {
    throw new Error('请输入回复内容');
  }
  const cleanPostId = cleanPositiveInteger(postId, '帖子 id');
  const cleanCsrf = cleanCsrfToken(csrfToken);
  const targetFloor = replyTarget?.floor ? cleanPositiveInteger(replyTarget.floor, '楼层') : undefined;
  const targetAuthor = String(replyTarget?.author || '').trim();
  const finalContent = targetFloor
    ? `${targetAuthor ? `@${targetAuthor} ` : ''}[#${targetFloor}](${NODESEEK_BASE_URL}/post-${cleanPostId}-${targetFloor})\n\n${cleanContent}`
    : cleanContent;

  return {
    path: '/api/content/new-comment',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: `${NODESEEK_BASE_URL}/post-${cleanPostId}-1`,
      'csrf-token': cleanCsrf
    },
    body: JSON.stringify({
      content: finalContent,
      mode: 'new-comment',
      postId: cleanPostId
    })
  };
}

export function buildNodeSeekEditReplyRequest({
  commentId,
  content,
  csrfToken
}: {
  commentId: string | number;
  content: string;
  csrfToken: string;
}): NodeSeekActionRequest {
  const cleanContent = content.trim();
  if (!cleanContent) {
    throw new Error('请输入回复内容');
  }
  const cleanCsrf = cleanCsrfToken(csrfToken);
  return {
    path: '/api/content/edit-comment',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'csrf-token': cleanCsrf
    },
    body: JSON.stringify({
      commentId: cleanPositiveInteger(commentId, '评论 id'),
      content: cleanContent,
      mode: 'edit-comment'
    })
  };
}

export function buildNodeSeekInteractionRequest({
  type,
  commentId,
  active = false
}: {
  type: NodeSeekInteractionType;
  commentId: string | number;
  active?: boolean;
}): NodeSeekActionRequest {
  if (active) {
    throw new Error(nodeSeekInteractionRemovalMessage(type));
  }
  const paths: Record<NodeSeekInteractionType, string> = {
    upvote: '/api/statistics/upvote',
    like: '/api/statistics/like',
    dislike: '/api/statistics/dislike'
  };
  return {
    path: paths[type],
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      commentId: cleanPositiveInteger(commentId, '评论 id'),
      action: 'add'
    })
  };
}

export function buildNodeSeekCollectionRequest({
  postId,
  collected = false
}: {
  postId: string | number;
  collected?: boolean;
}): NodeSeekActionRequest {
  return {
    path: '/api/statistics/collection',
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      postId: cleanPositiveInteger(postId, '帖子 id'),
      action: collected ? 'remove' : 'add'
    })
  };
}

export function buildNodeSeekAttendanceRequest({
  random = false
}: {
  random?: boolean;
} = {}): NodeSeekActionRequest {
  return {
    path: `/api/attendance?random=${random ? 'true' : 'false'}`,
    method: 'POST',
    headers: {},
    body: undefined
  };
}

export function buildNodeSeekVoteRequest({ optionIds }: { optionIds: (string | number)[] }): NodeSeekActionRequest {
  const ids = optionIds.map((id) => cleanPositiveInteger(id, '投票选项')).filter(Boolean);
  if (!ids.length) {
    throw new Error('请选择投票选项');
  }
  return {
    path: '/api/vote/voteforitem',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dynamic-sign': NODESEEK_VOTE_API_HEADERS['x-dynamic-sign']
    },
    body: JSON.stringify({ ids })
  };
}

export function buildNodeSeekPollLockRequest({ pollId }: { pollId: string | number }): NodeSeekActionRequest {
  return {
    path: `/api/vote/lock/${cleanPositiveInteger(pollId, '投票 id')}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dynamic-sign': NODESEEK_VOTE_API_HEADERS['x-dynamic-sign']
    },
    body: JSON.stringify({ locked: true }),
    fallbackErrorMessage: '投票锁定失败'
  };
}

export function buildNodeSeekPollCreateRequest({
  poll
}: {
  poll: Pick<PendingNodeSeekPoll, 'title' | 'multiple' | 'isPublic' | 'options'>;
}): NodeSeekActionRequest {
  const title = String(poll.title || '').trim();
  const items = poll.options.map((option) => String(option || '').trim()).filter(Boolean);
  if (!title) throw new Error('请输入投票标题');
  if (items.length < 2) throw new Error('投票至少需要两个选项');
  if (new Set(items).size !== items.length) throw new Error('投票选项不能重复');
  return {
    path: '/api/vote/info',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dynamic-sign': NODESEEK_VOTE_API_HEADERS['x-dynamic-sign']
    },
    body: JSON.stringify({ title, multiple: Boolean(poll.multiple), isPublic: Boolean(poll.isPublic), items })
  };
}

export function buildNodeSeekStardustPrepareRequest({
  receiverId
}: {
  receiverId: string | number;
}): NodeSeekActionRequest {
  return {
    path: '/api/stardust/payment-prepare',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receiver_id: cleanPositiveInteger(receiverId, '收款人 id'), origin: NODESEEK_BASE_URL }),
    fallbackErrorMessage: '获取支付基础信息失败'
  };
}

export function buildNodeSeekStardustSendRequest({
  receive
}: {
  receive: NodeSeekStardustReceive;
}): NodeSeekActionRequest {
  const refId = normalizeNodeSeekStardustRefId(receive.refId);
  if (!refId) throw new Error('Ref ID 必须为大于等于 100 的安全整数');
  return {
    path: '/api/stardust/send',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      member_id: cleanPositiveInteger(receive.receiverMemberId, '收款人 id'),
      diff: cleanPositiveInteger(receive.amount, 'Stardust 数额'),
      ref_id: refId,
      onetime: receive.oneTime
    }),
    fallbackErrorMessage: '转账失败'
  };
}

export function nodeSeekActionErrorMessage(data: unknown, status: number, fallbackErrorMessage?: string) {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
  }

  if (fallbackErrorMessage) {
    return fallbackErrorMessage;
  }

  if (status === 401) {
    return 'NodeSeek 登录已失效，请重新检测登录';
  }

  if (status === 403) {
    return 'NodeSeek 拒绝了请求，请稍后重试';
  }

  return `NodeSeek 请求失败：HTTP ${status}`;
}
