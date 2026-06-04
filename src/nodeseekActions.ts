export interface NodeSeekActionRequest {
  path: string;
  method: 'POST';
  headers: Record<string, string>;
  body?: string;
}

function cleanPositiveInteger(value: string | number, name: string) {
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} 不正确`);
  }
  return number;
}

function randomToken(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function buildNodeSeekReplyRequest({
  postId,
  content,
  csrfToken = randomToken()
}: {
  postId: string | number;
  content: string;
  csrfToken?: string;
}): NodeSeekActionRequest {
  const cleanContent = content.trim();
  if (!cleanContent) {
    throw new Error('请输入回复内容');
  }

  return {
    path: '/api/content/new-comment',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'csrf-token': csrfToken
    },
    body: JSON.stringify({
      content: cleanContent,
      mode: 'new-comment',
      postId: cleanPositiveInteger(postId, '帖子 id')
    })
  };
}

export function buildNodeSeekInteractionRequest({
  type,
  commentId
}: {
  type: 'upvote' | 'like';
  commentId: string | number;
}): NodeSeekActionRequest {
  return {
    path: type === 'upvote' ? '/api/statistics/upvote' : '/api/statistics/like',
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
