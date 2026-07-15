import { YAOHUO_BASE_URL } from './localYaohuoHelpers';

export interface YaohuoActionRequest {
  path: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
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

function normalizeYaohuoContent(content: string) {
  return cleanRequiredText(content, '请输入回复内容').replace(/\r?\n/g, '\r\n');
}

function appendIfPresent(params: URLSearchParams, key: string, value?: string | number) {
  const text = String(value ?? '').trim();
  if (text) {
    params.set(key, text);
  }
}

function yaohuoDeleteUrl(deletePath: string) {
  const text = String(deletePath || '').trim().replace(/&amp;/gi, '&');
  let url: URL;
  try {
    url = new URL(text, YAOHUO_BASE_URL);
  } catch {
    throw new Error('妖火删除链接不正确');
  }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || host !== 'www.yaohuo.me'
    || !/^\/bbs\/book_re_del\.aspx$/i.test(url.pathname)) {
    throw new Error('妖火删除链接不正确');
  }
  cleanPositiveInteger(url.searchParams.get('reid') || '', '回复 id');
  cleanPositiveInteger(url.searchParams.get('id') || '', '帖子 id');
  cleanPositiveInteger(url.searchParams.get('classid') || '', '分区 id');
  url.protocol = 'https:';
  url.hostname = 'www.yaohuo.me';
  return url;
}

export function normalizeYaohuoReplyDeletePath(deletePath: string) {
  const url = yaohuoDeleteUrl(deletePath);
  return `${url.pathname}${url.search}`;
}

export function extractYaohuoSid(cookieHeader: string) {
  const cookie = String(cookieHeader || '');
  const pair = cookie.split(';').map((part) => part.trim()).find((part) => /^sidyaohuo=/i.test(part));
  if (!pair) {
    return '';
  }
  return pair.slice(pair.indexOf('=') + 1).trim();
}

export function buildYaohuoReplyRequest({
  topicId,
  classId,
  content,
  face,
  replyFloor,
  toUserId,
  sid
}: {
  topicId: string | number;
  classId: string | number;
  content: string;
  face?: string;
  replyFloor?: string | number;
  toUserId?: string | number;
  sid?: string;
}): YaohuoActionRequest {
  const params = new URLSearchParams({
    face: String(face ?? '').trim(),
    sendmsg: '0',
    content: normalizeYaohuoContent(content),
    action: 'add',
    id: cleanPositiveInteger(topicId, '帖子 id'),
    siteid: '1000',
    lpage: '1',
    classid: cleanPositiveInteger(classId, '分区 id'),
    g: replyFloor && toUserId ? '发表回复' : '快速回复'
  });
  appendIfPresent(params, 'sid', sid);
  if (replyFloor && toUserId) {
    params.set('reply', cleanPositiveInteger(replyFloor, '楼层'));
    params.set('touserid', cleanPositiveInteger(toUserId, '用户 id'));
  }

  return {
    path: '/bbs/book_re.aspx',
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  };
}

export function buildYaohuoDeleteReplyRequest({
  deletePath,
  sid
}: {
  deletePath: string;
  sid?: string;
}): YaohuoActionRequest {
  const url = yaohuoDeleteUrl(deletePath);
  appendIfPresent(url.searchParams, 'sid', sid);
  return {
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: {}
  };
}

export function buildYaohuoFavoriteRequest({
  topicId,
  classId
}: {
  topicId: string | number;
  classId: string | number;
}): YaohuoActionRequest {
  const params = new URLSearchParams({
    action: 'fav',
    siteid: '1000',
    classid: cleanPositiveInteger(classId, '分区 id'),
    id: cleanPositiveInteger(topicId, '帖子 id')
  });
  return {
    path: `/bbs/Share.aspx?${params.toString()}`,
    method: 'GET',
    headers: {}
  };
}

export function buildYaohuoDeleteFavoriteRequest({
  favoriteId
}: {
  favoriteId: string | number;
}): YaohuoActionRequest {
  const params = new URLSearchParams({
    action: 'delete',
    siteid: '1000',
    favtypeid: '0',
    id: cleanPositiveInteger(favoriteId, '收藏记录 id')
  });
  return {
    path: `/bbs/favlist.aspx?${params.toString()}`,
    method: 'POST',
    headers: { accept: '*/*' }
  };
}

export function buildYaohuoVoteRequest({
  topicId,
  classId,
  voteId,
  voteIds
}: {
  topicId: string | number;
  classId: string | number;
  voteId?: string | number;
  voteIds?: Array<string | number>;
}): YaohuoActionRequest {
  const rawVoteIds = voteIds ?? (voteId !== undefined ? [voteId] : []);
  if (!rawVoteIds.length) {
    throw new Error('请选择投票选项');
  }
  const cleanVoteIds = rawVoteIds.map((id) => cleanPositiveInteger(id, '投票 id'));
  const params = new URLSearchParams({
    siteid: '1000',
    classid: cleanPositiveInteger(classId, '分区 id')
  });
  cleanVoteIds.forEach((id) => params.append('vid', id));
  params.set('vpage', '1');
  params.set('lpage', '2');
  params.set('id', cleanPositiveInteger(topicId, '帖子 id'));
  return {
    path: `/bbs/book_view_toVote.aspx?${params.toString()}`,
    method: 'GET',
    headers: {}
  };
}
