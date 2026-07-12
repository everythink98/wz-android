export interface NodeSeekActionRequest {
  path: string;
  method: 'POST';
  headers: Record<string, string>;
  body?: string;
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

export function buildNodeSeekReplyRequest({
  postId,
  content,
  replyTarget
}: {
  postId: string | number;
  content: string;
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
  const targetFloor = replyTarget?.floor ? cleanPositiveInteger(replyTarget.floor, '楼层') : undefined;
  const targetAuthor = String(replyTarget?.author || '').trim();
  const finalContent = targetFloor
    ? `${targetAuthor ? `@${targetAuthor} ` : ''}[#${targetFloor}](https://www.nodeseek.com/post-${cleanPostId}-${targetFloor})\n\n${cleanContent}`
    : cleanContent;

  return {
    path: '/api/content/new-comment',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: `https://www.nodeseek.com/post-${cleanPostId}-1`,
      'csrf-token': randomNodeSeekContentToken()
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
  content
}: {
  commentId: string | number;
  content: string;
}): NodeSeekActionRequest {
  const cleanContent = content.trim();
  if (!cleanContent) {
    throw new Error('请输入回复内容');
  }
  return {
    path: '/api/content/edit-comment',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'csrf-token': randomNodeSeekContentToken()
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

export function buildNodeSeekVoteRequest({
  optionIds
}: {
  optionIds: Array<string | number>;
}): NodeSeekActionRequest {
  const ids = optionIds.map((id) => cleanPositiveInteger(id, '投票选项')).filter(Boolean);
  if (!ids.length) {
    throw new Error('请选择投票选项');
  }
  return {
    path: '/api/vote/voteforitem',
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ ids })
  };
}

export function nodeSeekActionErrorMessage(data: unknown, status: number) {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
  }

  if (status === 401) {
    return 'NodeSeek 登录已失效，请重新检测登录';
  }

  if (status === 403) {
    return 'NodeSeek 拒绝了请求，请稍后重试';
  }

  return `NodeSeek 请求失败：HTTP ${status}`;
}
