import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from '@/platform/android/androidWebViewUserAgent';
import type { FeedResponse, RepliesResponse, SearchResponse, Topic, TopicDetail } from '@/domain/forum/models';
import { checkYaohuoLoginHtml, ensureYaohuoHtmlLoggedIn } from './sessionParser';
import { parseYaohuoListHtml, parseYaohuoSearchHtml } from './feedParser';
import { parseYaohuoFavoriteRecordId, parseYaohuoRepliesHtml, parseYaohuoTopicHtml } from './topicParser';
import { YAOHUO_BASE_URL, YAOHUO_BBS_REFERER, YAOHUO_LOGIN_URL, requireYaohuoRequestUrl } from './protocol';
import {
  annotateSourceDiagnosticSummary,
  mergeSourceDiagnosticSummaries,
  sourceDiagnosticSummary
} from '@/sources/diagnostics';

export interface DirectRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type YaohuoHtmlRequestOptions = DirectRequestOptions & {
  validateLogin?: boolean;
};

const DEFAULT_CLASS_ID = '177';

function yaohuoUrl(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  return `${YAOHUO_BASE_URL}${path}?${query.toString()}`;
}

function yaohuoRequestInit(): RequestInit {
  return {
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: YAOHUO_BBS_REFERER,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1',
      ...(DEFAULT_ANDROID_WEBVIEW_USER_AGENT ? { 'User-Agent': DEFAULT_ANDROID_WEBVIEW_USER_AGENT } : {})
    }
  };
}

export async function fetchYaohuoHtml(url: string, fetcher: Fetcher = fetch, options: YaohuoHtmlRequestOptions = {}) {
  const { validateLogin = true, ...requestOptions } = options;
  const safeUrl = requireYaohuoRequestUrl(url);
  const response = await fetchWithTimeout(safeUrl, yaohuoRequestInit(), { fetcher, ...requestOptions });
  const html = await response.text();
  const responseUrl = requireYaohuoRequestUrl(response.url || safeUrl, safeUrl);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    Object.assign(error, {
      status: response.status,
      statusCode: response.status
    });
    throw error;
  }
  if (validateLogin) {
    ensureYaohuoHtmlLoggedIn(html, responseUrl);
  }
  return {
    html,
    url: responseUrl
  };
}

function topicIdValue(id: string) {
  return String(id || '').match(/\d+/)?.[0] || String(id || '');
}

export async function getYaohuoFeedDirect({
  category,
  page = 1,
  limit = 30,
  yaohuoFetcher,
  signal,
  timeoutMs
}: {
  category?: string;
  page?: number;
  limit?: number;
  yaohuoFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const classId = category?.trim();
  const pageResult = await fetchYaohuoHtml(
    classId
      ? yaohuoUrl('/bbs/book_list.aspx', {
          action: 'new',
          classid: classId,
          page,
          siteid: '1000'
        })
      : yaohuoUrl('/bbs/book_list.aspx', {
          gettotal: '2025',
          action: 'new',
          ...(page > 1 ? { page } : {})
        }),
    yaohuoFetcher,
    { signal, timeoutMs }
  );

  return parseYaohuoListHtml(pageResult.html, {
    url: pageResult.url,
    classId: classId || undefined,
    page,
    limit
  });
}

export async function searchYaohuoDirect({
  query,
  page = 1,
  limit = 30,
  category = '0',
  yaohuoFetcher,
  signal,
  timeoutMs
}: {
  query: string;
  page?: number;
  limit?: number;
  category?: string;
  yaohuoFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  const searchPath = page > 1 ? '/bbs/book_list_search.aspx' : '/bbs/book_list.aspx';
  const pageResult = await fetchYaohuoHtml(
    yaohuoUrl(searchPath, {
      action: 'search',
      type: 'title',
      key: query,
      classid: category,
      page,
      siteid: '1000',
      getTotal: '2021'
    }),
    yaohuoFetcher,
    { signal, timeoutMs }
  );

  return parseYaohuoSearchHtml(pageResult.html, {
    classId: category,
    url: pageResult.url,
    page,
    limit
  });
}

export async function getYaohuoTopicDirect({
  topic,
  replyLimit = 30,
  yaohuoFetcher,
  signal,
  timeoutMs
}: {
  topic: Topic;
  replyLimit?: number;
  yaohuoFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  const id = topicIdValue(topic.id);
  const topicUrl = topic.url || `${YAOHUO_BASE_URL}/bbs-${id}.html`;
  const topicPage = await fetchYaohuoHtml(topicUrl, yaohuoFetcher, { signal, timeoutMs });
  const detail = parseYaohuoTopicHtml(topicPage.html, {
    id,
    url: topicPage.url
  });

  const [replies, favoritePage] = await Promise.all([
    getYaohuoRepliesDirect({
      id: detail.id || id,
      categoryId: detail.categoryId || topic.categoryId || DEFAULT_CLASS_ID,
      page: 1,
      limit: replyLimit,
      yaohuoFetcher,
      signal,
      timeoutMs
    }),
    fetchYaohuoHtml(
      yaohuoUrl('/bbs/favlist.aspx', {
        key: detail.title || topic.title
      }),
      yaohuoFetcher,
      { signal, timeoutMs }
    ).catch((error) => {
      if (signal?.aborted) {
        throw error;
      }
      return null;
    })
  ]);
  const favoriteId = favoritePage ? parseYaohuoFavoriteRecordId(favoritePage.html, detail.id || id) : undefined;

  const result = {
    ...detail,
    categoryId: detail.categoryId || topic.categoryId,
    category: detail.category || topic.category,
    ...(favoritePage
      ? {
          bookmarked: Boolean(favoriteId),
          bookmarkId: favoriteId
        }
      : {}),
    replyCount: Math.max(detail.replyCount || 0, topic.replyCount || 0, replies.items.length),
    replies: replies.items,
    replyHasMore: replies.hasMore,
    replyNextPage: replies.nextPage,
    replyNextOffset: replies.hasMore ? replies.items.length : null
  };
  const mergedResult = mergeSourceDiagnosticSummaries(result, 'html-topic-with-replies', [detail, replies], {
    validCount: 1 + replies.items.length
  });
  const summary = sourceDiagnosticSummary(mergedResult);
  return !favoritePage && summary
    ? annotateSourceDiagnosticSummary(mergedResult, {
        ...summary,
        partialErrorCount: summary.partialErrorCount + 1,
        hasDegradation: true
      })
    : mergedResult;
}

export async function getYaohuoRepliesDirect({
  id,
  categoryId,
  page,
  limit = 30,
  yaohuoFetcher,
  signal,
  timeoutMs
}: {
  id: string;
  categoryId?: string;
  page: number;
  limit?: number;
  yaohuoFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const pageResult = await fetchYaohuoHtml(
    yaohuoUrl('/bbs/book_re.aspx', {
      id: topicIdValue(id),
      classid: categoryId || DEFAULT_CLASS_ID,
      page
    }),
    yaohuoFetcher,
    { signal, timeoutMs }
  );

  return parseYaohuoRepliesHtml(pageResult.html, {
    url: pageResult.url,
    page,
    limit
  });
}

export async function checkYaohuoLoginDirect({
  yaohuoFetcher,
  signal,
  timeoutMs
}: {
  yaohuoFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const page = await fetchYaohuoHtml(`${YAOHUO_BASE_URL}/wapindex.aspx?sid=-2`, yaohuoFetcher, {
    signal,
    timeoutMs,
    validateLogin: false
  });
  const check = checkYaohuoLoginHtml(page.html, page.url);
  if (check.ok || check.loginRequired) {
    return check;
  }
  const loginPage = await fetchYaohuoHtml(YAOHUO_LOGIN_URL, yaohuoFetcher, {
    signal,
    timeoutMs,
    validateLogin: false
  });
  return checkYaohuoLoginHtml(loginPage.html, loginPage.url);
}
