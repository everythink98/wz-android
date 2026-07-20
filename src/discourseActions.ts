import { appendFileToFormData, type NormalizedReplyImageAsset } from './replyImageUpload';

export interface DiscourseActionRequest {
  path: string;
  method: 'POST' | 'DELETE' | 'PUT';
  headers: Record<string, string>;
  body?: string | FormData;
}

export type DiscourseAction =
  | {
    type: 'reply';
    topicId: string | number;
    content: string;
    replyToPostNumber?: string | number;
  }
  | {
    type: 'set-like';
    postId: string | number;
    active: boolean;
  }
  | {
    type: 'edit-post';
    postId: string | number;
    content: string;
  }
  | {
    type: 'delete-post';
    postId: string | number;
  }
  | {
    type: 'set-bookmark';
    targetId: string | number;
    targetType: 'Topic' | 'Post';
    active: boolean;
    bookmarkId?: string | number;
  }
  | {
    type: 'vote';
    postId: string | number;
    pollName: string;
    optionIds: string[];
  }
  | {
    type: 'upload';
    file: NormalizedReplyImageAsset;
  };

function positiveInteger(value: string | number, name: string) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || Number(text) <= 0) {
    throw new Error(`${name} 不正确`);
  }
  return text;
}

function requiredText(value: string, message: string) {
  const text = value.trim();
  if (!text) {
    throw new Error(message);
  }
  return text;
}

export function buildDiscourseActionRequest(action: DiscourseAction): DiscourseActionRequest {
  if (action.type === 'upload') {
    const body = new FormData();
    body.append('type', 'composer');
    body.append('synchronous', 'true');
    appendFileToFormData(body, 'file', action.file);
    return {
      path: '/uploads.json',
      method: 'POST',
      headers: {},
      body
    };
  }
  if (action.type === 'vote') {
    const optionIds = action.optionIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (!optionIds.length) {
      throw new Error('请选择投票选项');
    }
    const params = new URLSearchParams({
      post_id: positiveInteger(action.postId, '帖子 id'),
      poll_name: requiredText(action.pollName, '投票名称不正确')
    });
    optionIds.forEach((id) => params.append('options[]', id));
    return {
      path: '/polls/vote',
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    };
  }
  if (action.type === 'set-bookmark') {
    if (!action.active) {
      if (!action.bookmarkId) {
        throw new Error('当前收藏缺少 id，刷新主题后再试。');
      }
      return {
        path: `/bookmarks/${positiveInteger(action.bookmarkId, '收藏 id')}.json`,
        method: 'DELETE',
        headers: {},
        body: undefined
      };
    }
    return {
      path: '/bookmarks.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        bookmarkable_id: positiveInteger(action.targetId, '收藏对象 id'),
        bookmarkable_type: action.targetType
      }).toString()
    };
  }
  if (action.type === 'edit-post' || action.type === 'delete-post') {
    const postId = positiveInteger(action.postId, '回复 id');
    if (action.type === 'delete-post') {
      return {
        path: `/posts/${postId}.json`,
        method: 'DELETE',
        headers: {},
        body: undefined
      };
    }
    return {
      path: `/posts/${postId}.json`,
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'post[raw]': requiredText(action.content, '请输入回复内容') }).toString()
    };
  }
  if (action.type === 'set-like') {
    const postId = positiveInteger(action.postId, '帖子 id');
    return action.active
      ? {
        path: '/post_actions',
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: postId, post_action_type_id: '2' }).toString()
      }
      : {
        path: `/post_actions/${postId}?post_action_type_id=2`,
        method: 'DELETE',
        headers: {},
        body: undefined
      };
  }
  const params = new URLSearchParams({
    topic_id: positiveInteger(action.topicId, '主题 id'),
    raw: requiredText(action.content, '请输入回复内容')
  });
  if (action.replyToPostNumber !== undefined) {
    params.set('reply_to_post_number', positiveInteger(action.replyToPostNumber, '楼层'));
  }
  return {
    path: '/posts.json',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  };
}

export function discourseImageUrlFromUploadResponse(data: unknown, baseUrl: string, siteName: string) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const markdown = typeof record.markdown === 'string' ? record.markdown : '';
  const markdownUrl = markdown.match(/\]\(([^)]+)\)/)?.[1];
  const rawUrl = String(markdownUrl || record.short_url || record.url || '').trim();
  if (!rawUrl) {
    throw new Error(`${siteName} 上传返回缺少图片地址`);
  }
  if (rawUrl.startsWith('//')) {
    return `https:${rawUrl}`;
  }
  return rawUrl.startsWith('/') ? new URL(rawUrl, baseUrl).toString() : rawUrl;
}
