import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from '@/platform/android/androidWebViewUserAgent';
import { parseHtml, parsePositiveInteger } from '@/domain/forum/html';
import type {
  FeedResponse,
  RepliesResponse,
  ReplyOrder,
  ReplyWindowPosition,
  SearchResponse,
  Topic,
  TopicDetail
} from '@/domain/forum/models';
import { checkYaohuoLoginHtml, ensureYaohuoHtmlLoggedIn } from './sessionParser';
import { parseYaohuoListHtml, parseYaohuoSearchHtml } from './feedParser';
import { parseYaohuoFavoriteRecordId, parseYaohuoRepliesHtml, parseYaohuoTopicHtml } from './topicParser';
import { YAOHUO_BASE_URL, YAOHUO_BBS_REFERER, YAOHUO_LOGIN_URL, requireYaohuoRequestUrl } from './protocol';
import {
  annotateSourceDiagnosticSummary,
  mergeSourceDiagnosticSummaries,
  sourceDiagnosticSummary
} from '@/sources/diagnostics';
import { emptyReplyWindow } from '@/sources/replyWindows';
import { replyCountRefreshRequiredError } from '@/sources/sourceErrors';

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
      order: 'oldest',
      position: { kind: 'start' },
      limit: replyLimit,
      replyCount: detail.replyCount,
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
  order,
  position,
  limit = 30,
  replyCount,
  yaohuoFetcher,
  signal,
  timeoutMs
}: {
  id: string;
  categoryId?: string;
  order: ReplyOrder;
  position: ReplyWindowPosition;
  limit?: number;
  replyCount?: number;
  yaohuoFetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  let page = 1;
  let targetFloor: number | undefined;
  if (position.kind === 'cursor') {
    page = position.page;
  } else if (position.kind === 'target') {
    targetFloor = position.target.floor;
  } else {
    if (
      typeof replyCount !== 'number' ||
      !Number.isSafeInteger(replyCount) ||
      replyCount < 0 ||
      replyCount === Number.MAX_SAFE_INTEGER
    ) {
      throw replyCountRefreshRequiredError('妖火缺少可确认的回复总数');
    }
    if (replyCount === 0) {
      return emptyReplyWindow('html-replies');
    }
    targetFloor = order === 'newest' ? replyCount : 1;
  }
  if (targetFloor !== undefined && (!Number.isSafeInteger(targetFloor) || targetFloor <= 0)) {
    throw new Error('妖火目标楼层不正确');
  }
  const pageResult = await fetchYaohuoHtml(
    yaohuoUrl('/bbs/book_re.aspx', {
      id: topicIdValue(id),
      classid: categoryId || DEFAULT_CLASS_ID,
      ...(targetFloor ? { tofloor: targetFloor } : { page })
    }),
    yaohuoFetcher,
    { signal, timeoutMs }
  );

  const confirmedPage = (() => {
    try {
      const value = Number(new URL(pageResult.url).searchParams.get('page'));
      if (Number.isSafeInteger(value) && value > 0) return value;
    } catch {}
    return parsePositiveInteger(
      parseHtml(pageResult.html)
        .querySelector('input[name="page"], input#Action_page, input[name="replyPage"], input#Action_replyPage')
        ?.getAttribute('value')
    );
  })();
  if (targetFloor !== undefined && !confirmedPage) {
    throw new Error('妖火未确认目标楼层所在页');
  }
  const resolvedPage = confirmedPage || page;
  if (position.kind === 'cursor' && resolvedPage !== page) {
    throw new Error('妖火未确认请求的回复页');
  }
  const result = parseYaohuoRepliesHtml(pageResult.html, {
    url: pageResult.url,
    page: resolvedPage,
    limit
  });
  if (targetFloor !== undefined && !result.items.some((reply) => reply.floor === targetFloor)) {
    if (position.kind === 'target') {
      throw new Error('妖火目标楼层未找到');
    }
    if (!result.items.length) {
      throw replyCountRefreshRequiredError('妖火边缘回复窗口为空');
    }
  }
  const floors = result.items.map((reply) => reply.floor || 0).filter(Boolean);
  const minFloor = Math.min(...floors);
  if (order === 'newest' && position.kind === 'start' && resolvedPage !== 1) {
    throw replyCountRefreshRequiredError('妖火回复总数已变化，无法确认最新窗口');
  }
  const olderPage = order === 'oldest' && position.kind === 'start' ? null : minFloor > 1 ? result.nextPage : null;
  const newerPage = resolvedPage > 1 ? resolvedPage - 1 : null;
  return Object.assign(result, {
    items: order === 'newest' ? [...result.items].reverse() : result.items,
    currentPage: resolvedPage,
    currentOffset: null,
    previousPage: order === 'newest' ? newerPage : olderPage,
    previousOffset: null,
    hasMore: Boolean(order === 'newest' ? olderPage : newerPage),
    nextPage: order === 'newest' ? olderPage : newerPage,
    nextOffset: null
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
