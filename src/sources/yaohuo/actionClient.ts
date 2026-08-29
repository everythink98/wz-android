import type { YaohuoActionRequest } from './actionRequest';
import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from '@/platform/android/androidWebViewUserAgent';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { elementText, parseHtml, textContentFromHtml } from '@/domain/forum/html';
import { parseYaohuoFavoriteRecordId } from './topicParser';
import { yaohuoLoginRequirementReason } from './sessionParser';
import { YAOHUO_BASE_URL, YAOHUO_BBS_REFERER, YAOHUO_LOGIN_URL } from './protocol';

const YAOHUO_ACTION_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  origin: YAOHUO_BASE_URL,
  referer: YAOHUO_BBS_REFERER,
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  ...(DEFAULT_ANDROID_WEBVIEW_USER_AGENT ? { 'user-agent': DEFAULT_ANDROID_WEBVIEW_USER_AGENT } : {})
};
const YAOHUO_ACTION_FAILURE_PATTERN = /(失败|权限不足|请勿重复|重复提交|错误|禁止|无权|不允许|请选择|不能为空|未成功)/;
const YAOHUO_ACTION_SUCCESS_PATTERN = /^评论成功$/;
const YAOHUO_REPLY_DELETE_PATH_PATTERN = /^\/bbs\/book_re_del\.aspx$/i;
const YAOHUO_FAVORITE_ENTRY_PATH_PATTERN = /^\/bbs\/share\.aspx$/i;
const YAOHUO_FAVORITE_SUCCESS_PATH_PATTERN = /^\/bbs\/favlist\.aspx$/i;
const YAOHUO_MESSAGE_REPLY_PATH_PATTERN = /^\/bbs\/messagelist_add\.aspx$/i;
const YAOHUO_ACTION_UNKNOWN_MESSAGE = '操作结果无法确认，请刷新原帖核对';

export type YaohuoActionResult =
  { status: 'confirmed'; message: string; favoriteId?: number } | { status: 'unknown'; message: string };

function yaohuoLoginRequiredError(reason: 'expired' | 'verification' = 'expired') {
  const error = new Error(
    reason === 'verification' ? '妖火需要完成访问验证，请在登录页完成验证后重试' : '妖火登录已失效，请重新登录'
  );
  Object.assign(error, {
    source: 'yaohuo',
    loginRequired: true,
    reason,
    loginUrl: YAOHUO_LOGIN_URL
  });
  return error;
}

function actionMessage(html: string): YaohuoActionResult {
  const tip = parseHtml(html).querySelector('.tip');
  const text = tip ? elementText(tip) : textContentFromHtml(html);
  if (!text || (!tip && text.length > 80)) {
    return { status: 'unknown', message: YAOHUO_ACTION_UNKNOWN_MESSAGE };
  }
  assertYaohuoActionSuccess(text);
  if (!tip && !YAOHUO_ACTION_SUCCESS_PATTERN.test(text)) {
    return { status: 'unknown', message: YAOHUO_ACTION_UNKNOWN_MESSAGE };
  }
  return {
    status: 'confirmed',
    message: text.length > 80 ? '操作已提交' : text
  };
}

function messageReplyResult(html: string): YaohuoActionResult {
  const root = parseHtml(html);
  const message = elementText(root.querySelector('.tip')) || textContentFromHtml(html);
  assertYaohuoActionSuccess(message);
  return message === '发送信息成功！'
    ? { status: 'confirmed', message }
    : { status: 'unknown', message: YAOHUO_ACTION_UNKNOWN_MESSAGE };
}

function assertYaohuoActionSuccess(message: string) {
  if (YAOHUO_ACTION_FAILURE_PATTERN.test(message)) {
    throw new Error(message);
  }
}

function deleteConfirmationPath(html: string) {
  const link = parseHtml(html)
    .querySelectorAll('a[href]')
    .find((item) => {
      const href = item.getAttribute('href') || '';
      return /book_re_del\.aspx/i.test(href) && /确定删除|确认删除/.test(elementText(item));
    });
  const href = link?.getAttribute('href');
  if (!href) {
    return '';
  }
  try {
    const url = new URL(href.replace(/&amp;/gi, '&'), YAOHUO_BASE_URL);
    const host = url.hostname.toLowerCase();
    if (
      host !== 'www.yaohuo.me' ||
      !YAOHUO_REPLY_DELETE_PATH_PATTERN.test(url.pathname) ||
      url.searchParams.get('action')?.toLowerCase() !== 'godel' ||
      !url.searchParams.get('reid') ||
      !url.searchParams.get('id')
    ) {
      return '';
    }
    url.protocol = 'https:';
    url.hostname = 'www.yaohuo.me';
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

function isFavoriteEntryRequest(request: YaohuoActionRequest) {
  const url = new URL(request.path, YAOHUO_BASE_URL);
  return (
    request.method === 'GET' &&
    YAOHUO_FAVORITE_ENTRY_PATH_PATTERN.test(url.pathname) &&
    url.searchParams.get('action')?.toLowerCase() === 'fav'
  );
}

function isFavoriteSuccessUrl(responseUrl: string) {
  try {
    const url = new URL(responseUrl);
    return url.origin === new URL(YAOHUO_BASE_URL).origin && YAOHUO_FAVORITE_SUCCESS_PATH_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

function isFavoriteDeleteRequest(request: YaohuoActionRequest) {
  const url = new URL(request.path, YAOHUO_BASE_URL);
  return (
    request.method === 'POST' &&
    YAOHUO_FAVORITE_SUCCESS_PATH_PATTERN.test(url.pathname) &&
    url.searchParams.get('action')?.toLowerCase() === 'delete'
  );
}

function favoriteDeleteMessage(text: string) {
  let result: { success?: unknown; message?: unknown };
  try {
    result = JSON.parse(text) as { success?: unknown; message?: unknown };
  } catch {
    throw new Error('取消收藏结果无法确认，请刷新原帖核对');
  }
  if (result.success !== true) {
    throw new Error(
      typeof result.message === 'string' && result.message.trim() ? result.message.trim() : '取消收藏失败'
    );
  }
  return '已取消收藏';
}

async function fetchYaohuoActionHtml({
  request,
  path,
  fetcher,
  signal,
  timeoutMs
}: {
  request: YaohuoActionRequest;
  path: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const response = await fetchWithTimeout(
    `${YAOHUO_BASE_URL}${path}`,
    {
      method: request.method,
      headers: {
        ...YAOHUO_ACTION_HEADERS,
        ...request.headers
      },
      body: request.method === 'POST' ? request.body : undefined
    },
    {
      fetcher,
      signal,
      timeoutMs
    }
  );
  const html = await response.text();
  const responseUrl = response.url || '';

  const loginReason = yaohuoLoginRequirementReason(html, responseUrl);
  if (loginReason) {
    throw yaohuoLoginRequiredError(loginReason);
  }
  if (!response.ok) {
    throw new Error(`妖火请求失败：HTTP ${response.status}`);
  }
  return { html, responseUrl };
}

export async function runYaohuoAction({
  request,
  fetcher = fetch,
  signal,
  timeoutMs
}: {
  request: YaohuoActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<YaohuoActionResult> {
  let { html, responseUrl } = await fetchYaohuoActionHtml({
    request,
    fetcher,
    path: request.path,
    signal,
    timeoutMs
  });

  const requestUrl = new URL(request.path, YAOHUO_BASE_URL);
  if (request.method === 'GET' && YAOHUO_REPLY_DELETE_PATH_PATTERN.test(requestUrl.pathname)) {
    const confirmationPath = deleteConfirmationPath(html);
    if (confirmationPath) {
      ({ html, responseUrl } = await fetchYaohuoActionHtml({
        request,
        fetcher,
        path: confirmationPath,
        signal,
        timeoutMs
      }));
    } else if (requestUrl.searchParams.get('action')?.toLowerCase() !== 'godel') {
      return { status: 'unknown', message: YAOHUO_ACTION_UNKNOWN_MESSAGE };
    }
  }

  if (isFavoriteDeleteRequest(request)) {
    return { status: 'confirmed', message: favoriteDeleteMessage(html) };
  }

  if (request.method === 'POST' && YAOHUO_MESSAGE_REPLY_PATH_PATTERN.test(requestUrl.pathname)) {
    return messageReplyResult(html);
  }

  if (isFavoriteEntryRequest(request)) {
    actionMessage(html);
    if (isFavoriteSuccessUrl(responseUrl)) {
      const topicId = new URL(request.path, YAOHUO_BASE_URL).searchParams.get('id') || '';
      const favoriteId = parseYaohuoFavoriteRecordId(html, topicId);
      if (favoriteId) {
        return { status: 'confirmed', message: '收藏成功', favoriteId };
      }
    }
    return { status: 'unknown', message: YAOHUO_ACTION_UNKNOWN_MESSAGE };
  }

  return actionMessage(html);
}
