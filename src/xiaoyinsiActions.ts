import { appendFileToFormData, type NormalizedReplyImageAsset } from './replyImageUpload';

export interface XiaoyinsiActionRequest {
  path: string;
  method: 'POST' | 'DELETE' | 'PUT';
  headers: Record<string, string>;
  body?: BodyInit;
}

function cleanPositiveInteger(value: string | number, name: string) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${name} 不正确`);
  }
  const number = Number(text);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} 不正确`);
  }
  return String(number);
}

function cleanRequiredText(value: string, message: string) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(message);
  }
  return text;
}

export function buildXiaoyinsiReplyRequest({
  topicId,
  content,
  replyToPostNumber
}: {
  topicId: string | number;
  content: string;
  replyToPostNumber?: string | number;
}): XiaoyinsiActionRequest {
  const params = new URLSearchParams({
    topic_id: cleanPositiveInteger(topicId, '主题 id'),
    raw: cleanRequiredText(content, '请输入回复内容')
  });
  if (replyToPostNumber) {
    params.set('reply_to_post_number', cleanPositiveInteger(replyToPostNumber, '楼层'));
  }
  return {
    path: '/posts.json',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  };
}

export function buildXiaoyinsiEditReplyRequest({
  postId,
  content
}: {
  postId: string | number;
  content: string;
}): XiaoyinsiActionRequest {
  return {
    path: `/posts/${cleanPositiveInteger(postId, '回复 id')}.json`,
    method: 'PUT',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      'post[raw]': cleanRequiredText(content, '请输入回复内容')
    }).toString()
  };
}

export function buildXiaoyinsiDeleteReplyRequest({
  postId
}: {
  postId: string | number;
}): XiaoyinsiActionRequest {
  return {
    path: `/posts/${cleanPositiveInteger(postId, '回复 id')}.json`,
    method: 'DELETE',
    headers: {},
    body: undefined
  };
}

export function buildXiaoyinsiLikeRequest({
  postId,
  liked
}: {
  postId: string | number;
  liked: boolean;
}): XiaoyinsiActionRequest {
  const cleanPostId = cleanPositiveInteger(postId, '帖子 id');
  if (liked) {
    return {
      path: `/post_actions/${cleanPostId}?post_action_type_id=2`,
      method: 'DELETE',
      headers: {},
      body: undefined
    };
  }
  return {
    path: '/post_actions',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      id: cleanPostId,
      post_action_type_id: '2'
    }).toString()
  };
}

export function buildXiaoyinsiBookmarkRequest({
  bookmarkableId,
  bookmarkableType,
  bookmarked,
  bookmarkId
}: {
  bookmarkableId: string | number;
  bookmarkableType: 'Topic' | 'Post';
  bookmarked: boolean;
  bookmarkId?: string | number;
}): XiaoyinsiActionRequest {
  if (bookmarked) {
    if (!bookmarkId) {
      if (bookmarkableType === 'Topic') {
        return {
          path: `/t/${cleanPositiveInteger(bookmarkableId, '收藏对象 id')}/remove_bookmarks`,
          method: 'PUT',
          headers: {},
          body: undefined
        };
      }
      throw new Error('当前收藏缺少 id，刷新主题后再试。');
    }
    return {
      path: `/bookmarks/${cleanPositiveInteger(bookmarkId, '收藏 id')}.json`,
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
      bookmarkable_id: cleanPositiveInteger(bookmarkableId, '收藏对象 id'),
      bookmarkable_type: bookmarkableType
    }).toString()
  };
}

export function buildXiaoyinsiPollVoteRequest({
  postId,
  pollName,
  optionIds
}: {
  postId: string | number;
  pollName: string;
  optionIds: string[];
}): XiaoyinsiActionRequest {
  const cleanOptions = optionIds.map((optionId) => String(optionId || '').trim()).filter(Boolean);
  if (!cleanOptions.length) {
    throw new Error('请选择投票选项');
  }
  const params = new URLSearchParams({
    post_id: cleanPositiveInteger(postId, '帖子 id'),
    poll_name: cleanRequiredText(pollName, '投票名称不正确')
  });
  cleanOptions.forEach((optionId) => params.append('options[]', optionId));
  return {
    path: '/polls/vote',
    method: 'PUT',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  };
}

export function buildXiaoyinsiImageUploadRequest({
  file
}: {
  file: NormalizedReplyImageAsset;
}): XiaoyinsiActionRequest {
  const body = new FormData();
  body.append('type', 'composer');
  body.append('synchronous', 'true');
  appendFileToFormData(body, 'file', file);
  return {
    path: '/uploads.json',
    method: 'POST',
    headers: {},
    body
  };
}

export function xiaoyinsiImageUrlFromUploadResponse(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const markdown = typeof record.markdown === 'string' ? record.markdown : '';
  const markdownUrl = markdown.match(/\]\(([^)]+)\)/)?.[1];
  const rawUrl = String(markdownUrl || record.short_url || record.url || '').trim();
  if (!rawUrl) {
    throw new Error('小隐寺上传返回缺少图片地址');
  }
  if (rawUrl.startsWith('//')) {
    return `https:${rawUrl}`;
  }
  return rawUrl.startsWith('/') ? `https://forum.xiaoyinsi.com${rawUrl}` : rawUrl;
}
