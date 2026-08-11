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

function assertYaohuoTopicIdentity(responseUrl: string, id: string) {
  try {
    const url = new URL(responseUrl);
    const responseId = url.searchParams.get('id') || url.pathname.match(/\/bbs-(\d+)\.html$/i)?.[1];
    if (responseId && topicIdValue(responseId) !== topicIdValue(id)) {
      throw new Error('妖火主题身份不一致');
    }
  } catch (error) {
    if (error instanceof Error && error.message === '妖火主题身份不一致') throw error;
  }
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
  assertYaohuoTopicIdentity(topicPage.url, id);
  const detail = parseYaohuoTopicHtml(topicPage.html, {
    id,
    url: topicPage.url
  });

  const favoritePage = await fetchYaohuoHtml(
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
  });
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
    replyCount: Math.max(detail.replyCount || 0, topic.replyCount || 0),
    replies: [],
    replyCompleteness: 'partial' as const,
    replyHasMore: true,
    replyNextPage: null,
    replyNextOffset: null
  };
  const mergedResult = mergeSourceDiagnosticSummaries(result, 'html-topic', [detail], {
    validCount: 1
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
    targetFloor = order === 'oldest' ? 1 : undefined;
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
  assertYaohuoTopicIdentity(pageResult.url, id);

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
  if (position.kind === 'start' && order === 'newest' && confirmedPage !== 1) {
    throw new Error('妖火未确认最新回复窗口');
  }
  const result = parseYaohuoRepliesHtml(pageResult.html, {
    url: pageResult.url,
    page: resolvedPage,
    limit
  });
  const items = result.items;
  if (position.kind === 'start' && replyCount === 0 && !items.length) {
    return Object.assign(result, {
      items: [],
      completeness: 'complete' as const,
      currentPage: resolvedPage,
      currentOffset: null,
      previousPage: null,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null
    });
  }
  if (position.kind === 'cursor' && !items.length) {
    throw new Error('妖火普通回复窗口为空');
  }
  const hasTargetFloor = targetFloor !== undefined && items.some((reply) => reply.floor === targetFloor);
  if (
    position.kind === 'target' &&
    (targetFloor === undefined || !result.confirmedFloors.includes(targetFloor) || !hasTargetFloor)
  ) {
    throw new Error('妖火目标楼层未找到');
  }
  if (targetFloor !== undefined && !hasTargetFloor) {
    if (position.kind === 'target') {
      throw new Error('妖火目标楼层未找到');
    }
    if (!result.items.length) {
      throw new Error('妖火边缘回复窗口为空');
    }
  }
  if (position.kind === 'start' && order === 'newest' && !result.items.length && replyCount !== 0) {
    throw new Error('妖火普通回复窗口为空');
  }
  const floors = items.map((reply) => reply.floor || 0).filter(Boolean);
  const minFloor = Math.min(...floors);
  const ascendingFloors = [...new Set(floors)].sort((left, right) => left - right);
  const hasFloorGap = ascendingFloors.some((floor, index) => index > 0 && floor !== ascendingFloors[index - 1] + 1);
  const edgeConfirmed =
    position.kind === 'target' ||
    position.kind === 'cursor' ||
    (order === 'oldest'
      ? floors.includes(1)
      : typeof replyCount === 'number' && replyCount > 0 && Math.max(...floors) === replyCount);
  const summary = sourceDiagnosticSummary(result);
  const hasRowDegradation = Boolean(summary?.droppedCount) || Boolean(summary?.missingFloorCount);
  const completeness = !items.length
    ? ('complete' as const)
    : !hasRowDegradation && !hasFloorGap && edgeConfirmed
      ? ('complete' as const)
      : ('partial' as const);
  const olderPage = order === 'oldest' && position.kind === 'start' ? null : minFloor > 1 ? result.nextPage : null;
  const newerPage = resolvedPage > 1 ? resolvedPage - 1 : null;
  return Object.assign(result, {
    items: order === 'newest' ? [...items].reverse() : items,
    completeness,
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
