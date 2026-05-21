import {
  parseYaohuoFeedHtml,
  parseYaohuoLoginHtml,
  parseYaohuoRepliesHtml,
  parseYaohuoSearchHtml,
  parseYaohuoTopicHtml
} from './forumApi';
import { fetchWithTimeout, type Fetcher } from './request';
import type { FeedResponse, RepliesResponse, SearchResponse, Topic, TopicDetail } from './types';

interface DirectRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const YAOHUO_BASE_URL = 'https://yaohuo.me';
const YAOHUO_LOGIN_URL = `${YAOHUO_BASE_URL}/waplogin.aspx?siteid=1000`;
const DEFAULT_CLASS_ID = '177';

function yaohuoLoginRequiredError(reason = 'missing_cookie') {
  const error = new Error(reason === 'missing_cookie' ? '请先登录妖火' : '妖火登录已失效，请重新登录');
  Object.assign(error, {
    source: 'yaohuo',
    loginRequired: true,
    reason,
    loginUrl: YAOHUO_LOGIN_URL
  });
  return error;
}

function requireYaohuoCookie(cookie?: string) {
  const value = cookie?.trim();
  if (!value) {
    throw yaohuoLoginRequiredError('missing_cookie');
  }
  return value;
}

function yaohuoUrl(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  return `${YAOHUO_BASE_URL}${path}?${query.toString()}`;
}

function yaohuoRequestInit(cookie: string): RequestInit {
  return {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: cookie,
      Referer: `${YAOHUO_BASE_URL}/bbs/`
    }
  };
}

async function fetchYaohuoHtml(url: string, cookie: string, fetcher: Fetcher = fetch, options: DirectRequestOptions = {}) {
  const response = await fetchWithTimeout(url, yaohuoRequestInit(cookie), { fetcher, ...options });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return {
    html,
    url: response.url || url
  };
}

function topicIdValue(id: string) {
  return String(id || '').match(/\d+/)?.[0] || String(id || '');
}

export async function getYaohuoFeedDirect({
  serverUrl,
  yaohuoCookie,
  category,
  page = 1,
  limit = 30,
  yaohuoFetcher,
  serverFetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  yaohuoCookie?: string;
  category?: string;
  page?: number;
  limit?: number;
  yaohuoFetcher?: Fetcher;
  serverFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const cookie = requireYaohuoCookie(yaohuoCookie);
  const classId = category || DEFAULT_CLASS_ID;
  const pageResult = await fetchYaohuoHtml(yaohuoUrl('/bbs/book_list.aspx', {
    action: 'new',
    classid: classId,
    page,
    siteid: '1000',
    getTotal: '2021'
  }), cookie, yaohuoFetcher, { signal, timeoutMs });

  return parseYaohuoFeedHtml({
    serverUrl,
    html: pageResult.html,
    url: pageResult.url,
    category: classId,
    page,
    limit,
    fetcher: serverFetcher,
    signal,
    timeoutMs
  });
}

export async function searchYaohuoDirect({
  serverUrl,
  yaohuoCookie,
  query,
  page = 1,
  limit = 30,
  category = '0',
  yaohuoFetcher,
  serverFetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  yaohuoCookie?: string;
  query: string;
  page?: number;
  limit?: number;
  category?: string;
  yaohuoFetcher?: Fetcher;
  serverFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  const cookie = requireYaohuoCookie(yaohuoCookie);
  const pageResult = await fetchYaohuoHtml(yaohuoUrl('/bbs/book_list.aspx', {
    action: 'search',
    type: 'title',
    key: query,
    classid: category,
    page,
    siteid: '1000',
    getTotal: '2021'
  }), cookie, yaohuoFetcher, { signal, timeoutMs });

  return parseYaohuoSearchHtml({
    serverUrl,
    html: pageResult.html,
    url: pageResult.url,
    page,
    limit,
    fetcher: serverFetcher,
    signal,
    timeoutMs
  });
}

export async function getYaohuoTopicDirect({
  serverUrl,
  topic,
  yaohuoCookie,
  replyLimit = 30,
  yaohuoFetcher,
  serverFetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  topic: Topic;
  yaohuoCookie?: string;
  replyLimit?: number;
  yaohuoFetcher?: Fetcher;
  serverFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  const cookie = requireYaohuoCookie(yaohuoCookie);
  const id = topicIdValue(topic.id);
  const topicUrl = topic.url || `${YAOHUO_BASE_URL}/bbs-${id}.html`;
  const topicPage = await fetchYaohuoHtml(topicUrl, cookie, yaohuoFetcher, { signal, timeoutMs });
  const detail = await parseYaohuoTopicHtml({
    serverUrl,
    html: topicPage.html,
    id,
    url: topicPage.url,
    fetcher: serverFetcher,
    signal,
    timeoutMs
  });

  const replies = await getYaohuoRepliesDirect({
    serverUrl,
    id: detail.id || id,
    categoryId: detail.categoryId || topic.categoryId || DEFAULT_CLASS_ID,
    page: 1,
    limit: replyLimit,
    yaohuoCookie,
    yaohuoFetcher,
    serverFetcher,
    signal,
    timeoutMs
  });

  return {
    ...detail,
    replyCount: Math.max(detail.replyCount || 0, topic.replyCount || 0, replies.items.length),
    replies: replies.items,
    replyHasMore: replies.hasMore,
    replyNextPage: replies.nextPage,
    replyNextOffset: replies.hasMore ? replies.items.length : null
  };
}

export async function getYaohuoRepliesDirect({
  serverUrl,
  id,
  categoryId,
  page,
  limit = 30,
  yaohuoCookie,
  yaohuoFetcher,
  serverFetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  id: string;
  categoryId?: string;
  page: number;
  limit?: number;
  yaohuoCookie?: string;
  yaohuoFetcher?: Fetcher;
  serverFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const cookie = requireYaohuoCookie(yaohuoCookie);
  const pageResult = await fetchYaohuoHtml(yaohuoUrl('/bbs/book_re.aspx', {
    id: topicIdValue(id),
    classid: categoryId || DEFAULT_CLASS_ID,
    page
  }), cookie, yaohuoFetcher, { signal, timeoutMs });

  return parseYaohuoRepliesHtml({
    serverUrl,
    html: pageResult.html,
    url: pageResult.url,
    page,
    limit,
    fetcher: serverFetcher,
    signal,
    timeoutMs
  });
}

export async function checkYaohuoLoginDirect({
  serverUrl,
  yaohuoCookie,
  yaohuoFetcher,
  serverFetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  yaohuoCookie?: string;
  yaohuoFetcher?: Fetcher;
  serverFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const cookie = requireYaohuoCookie(yaohuoCookie);
  const page = await fetchYaohuoHtml(`${YAOHUO_BASE_URL}/wapindex.aspx?sid=-2`, cookie, yaohuoFetcher, { signal, timeoutMs });
  return parseYaohuoLoginHtml({
    serverUrl,
    html: page.html,
    url: page.url,
    fetcher: serverFetcher,
    signal,
    timeoutMs
  });
}
