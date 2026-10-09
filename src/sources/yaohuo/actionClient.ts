import { normalizeYaohuoReplyDeletePath, type YaohuoActionRequest } from './actionRequest';
import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from '@/platform/android/androidWebViewUserAgent';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { elementText, parseHtml, textContentFromHtml } from '@/domain/forum/html';
import { parseYaohuoFavoriteRecordId } from './topicParser';
import { yaohuoLoginRequirementReason } from './sessionParser';
import { YAOHUO_BASE_URL, YAOHUO_BBS_REFERER, YAOHUO_LOGIN_URL } from './protocol';
import { markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

export const YAOHUO_ACTION_HEADERS = {
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
const YAOHUO_ACTION_SUCCESS_PATTERN =
  /^(?:评论成功|回复成功！(?:\s*获得妖晶:\d+，获得经验:\d+)?(?:\s*跳转中\.\.\.返回)?)$/;
const YAOHUO_DELETE_SUCCESS_PATTERN = /^删除成功[！!。\s]*(?:跳转中[.。…]*\s*)?(?:返回)?$/;
const YAOHUO_VOTE_SUCCESS_PATTERN = /^投票成功[！!。\s]*(?:跳转中[.。…]*\s*)?(?:返回)?$/;
const YAOHUO_REPLY_PATH_PATTERN = /^\/bbs\/book_re\.aspx$/i;
const YAOHUO_REPLY_DELETE_PATH_PATTERN = /^\/bbs\/book_re_del\.aspx$/i;
const YAOHUO_FAVORITE_ENTRY_PATH_PATTERN = /^\/bbs\/share\.aspx$/i;
const YAOHUO_FAVORITE_SUCCESS_PATH_PATTERN = /^\/bbs\/favlist\.aspx$/i;
const YAOHUO_MESSAGE_REPLY_PATH_PATTERN = /^\/bbs\/messagelist_add\.aspx$/i;
const YAOHUO_VOTE_PATH_PATTERN = /^\/bbs\/book_view_toVote\.aspx$/i;
const YAOHUO_ACTION_UNKNOWN_MESSAGE = '操作结果无法确认，请刷新原帖核对';
const YAOHUO_MESSAGE_REPLY_ERRORS = new Map<string, string>([
  ['REPEAT', '刚刚已经给对方发过相同的内容了'],
  ['NULL', '请填写对方ID和内容'],
  ['WAITING', '操作太快了，请稍后再试'],
  ['MAX1', '一次最多发给100人，请分批发送'],
  ['MAX', '今天的发信数量已达上限，明天再来吧'],
  ['LOCK', '你已被加入黑名单，暂时不能发信'],
  ['ALLERR', '只有站长才能群发给全站会员'],
  ['BLOCKED', '对方设置了不接收你的私信'],
  ['NOTEXSIT', '对方ID不存在，请检查后再发']
]);

export type YaohuoActionResult =
  { status: 'confirmed'; message: string; favoriteId?: number } | { status: 'unknown'; message: string };

function yaohuoLoginRequiredError(reason: 'expired' | 'verification' = 'expired') {
  const error = new Error(
    reason === 'verification' ? '妖火需要完成访问验证，请在登录页完成验证后重试' : '妖火登录已失效，请重新登录'
  );
  Object.assign(error, {
    source: 'yaohuo',
    loginRequired: true,
    serverRejected: true,
    reason,
    loginUrl: YAOHUO_LOGIN_URL
  });
  return error;
}

function actionMessage(html: string, action?: 'reply' | 'delete' | 'vote'): YaohuoActionResult {
  const tip = parseHtml(html).querySelector('.tip');
  const text = tip ? elementText(tip) : textContentFromHtml(html);
  if (!text || (!tip && text.length > 80)) {
    return { status: 'unknown', message: YAOHUO_ACTION_UNKNOWN_MESSAGE };
  }
  assertYaohuoActionSuccess(text);
  const successPattern =
    action === 'reply'
      ? YAOHUO_ACTION_SUCCESS_PATTERN
      : action === 'delete'
        ? YAOHUO_DELETE_SUCCESS_PATTERN
        : action === 'vote'
          ? YAOHUO_VOTE_SUCCESS_PATTERN
          : undefined;
  if (!successPattern?.test(text) || (action !== 'reply' && !tip)) {
    return { status: 'unknown', message: tip && text.length <= 80 ? text : YAOHUO_ACTION_UNKNOWN_MESSAGE };
  }
  return {
    status: 'confirmed',
    message: text.length > 80 ? '操作已提交' : text
  };
}

function messageReplyResult(html: string, ajax: boolean): YaohuoActionResult {
  if (ajax) {
    const code = html.trim();
    if (code === 'OK') return { status: 'confirmed', message: '发送信息成功！' };
    const rejection = YAOHUO_MESSAGE_REPLY_ERRORS.get(code);
    if (rejection) throw Object.assign(new Error(rejection), { serverRejected: true });
  }
  const root = parseHtml(html);
  const tip = root.querySelector('.tip');
  const message = elementText(tip) || textContentFromHtml(html);
  assertYaohuoActionSuccess(message, Boolean(tip));
  return message === '发送信息成功！'
    ? { status: 'confirmed', message }
    : { status: 'unknown', message: YAOHUO_ACTION_UNKNOWN_MESSAGE };
}

function assertYaohuoActionSuccess(message: string, serverRejected = false) {
  if (YAOHUO_ACTION_FAILURE_PATTERN.test(message)) {
    throw Object.assign(new Error(message), { serverRejected });
  }
}

function deleteConfirmationPath(html: string, requestUrl: URL) {
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
    const url = new URL(normalizeYaohuoReplyDeletePath(href), YAOHUO_BASE_URL);
    if (
      url.searchParams.get('action')?.toLowerCase() !== 'godel' ||
      url.searchParams.get('reid') !== requestUrl.searchParams.get('reid') ||
      url.searchParams.get('id') !== requestUrl.searchParams.get('id')
    ) {
      return '';
    }
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
    new URLSearchParams(request.body).get('action')?.toLowerCase() === 'delete'
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
  timeoutMs,
  cache
}: {
  request: YaohuoActionRequest;
  path: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  cache?: RequestCache;
}) {
  const response = await fetchWithTimeout(
    `${YAOHUO_BASE_URL}${path}`,
    {
      method: request.method,
      headers: {
        ...YAOHUO_ACTION_HEADERS,
        ...request.headers
      },
      body: request.method === 'POST' ? request.body : undefined,
      ...(cache ? { cache } : {})
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
  timeoutMs,
  trace
}: {
  request: YaohuoActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  trace?: DiagnosticTrace;
}): Promise<YaohuoActionResult> {
  const requestUrl = new URL(request.path, YAOHUO_BASE_URL);
  const isReply = request.method === 'POST' && YAOHUO_REPLY_PATH_PATTERN.test(requestUrl.pathname);
  const isVote = request.method === 'POST' && YAOHUO_VOTE_PATH_PATTERN.test(requestUrl.pathname);
  if (isReply) {
    const body = new URLSearchParams(request.body);
    const topicId = body.get('id') || '';
    if (!/^[1-9]\d*$/.test(topicId)) throw new Error('帖子 id 不正确');
    const formPath = `/bbs-${topicId}.html`;
    const formUrl = `${YAOHUO_BASE_URL}${formPath}`;
    const formResponse = await fetchYaohuoActionHtml({
      request: { path: formPath, method: 'GET', headers: { 'cache-control': 'no-cache' } },
      path: formPath,
      fetcher,
      signal,
      timeoutMs
    });
    const form = parseHtml(formResponse.html)
      .querySelectorAll('form[action]')
      .find((candidate) => {
        try {
          const url = new URL(candidate.getAttribute('action') || '', formUrl);
          return (
            url.origin === YAOHUO_BASE_URL &&
            YAOHUO_REPLY_PATH_PATTERN.test(url.pathname) &&
            candidate.querySelector('input[name="id"]')?.getAttribute('value') === topicId
          );
        } catch {
          return false;
        }
      });
    const token = form?.querySelector('input[name="__CSRFToken"]')?.getAttribute('value')?.trim();
    const isSameOrigin = !formResponse.responseUrl || new URL(formResponse.responseUrl).origin === YAOHUO_BASE_URL;
    if (trace)
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        hasReplyForm: Boolean(form),
        hasCsrfToken: Boolean(token),
        isSameOrigin
      });
    if (!token || !isSameOrigin) {
      throw new Error('无法读取妖火回复验证信息，请刷新后重试');
    }
    body.set('__CSRFToken', token);
    request = { ...request, body: body.toString(), headers: { ...request.headers, referer: formUrl } };
  } else if (isVote) {
    const body = new URLSearchParams(request.body);
    const topicId = body.get('id') || '';
    if (!/^[1-9]\d*$/.test(topicId)) throw new Error('帖子 id 不正确');
    const formPath = `/bbs-${topicId}.html`;
    const formUrl = `${YAOHUO_BASE_URL}${formPath}`;
    const formResponse = await fetchYaohuoActionHtml({
      request: { path: formPath, method: 'GET', headers: { 'cache-control': 'no-store' } },
      path: formPath,
      fetcher,
      signal,
      timeoutMs,
      cache: 'no-store'
    });
    const voteIds = body.getAll('vid');
    const root = parseHtml(formResponse.html);
    if (root.querySelector('body')?.getAttribute('data-has-voted') === 'true')
      throw new Error('无法读取妖火投票验证信息，请刷新后重试');
    const contexts = root
      .querySelectorAll('.vote-container')
      .map((container) => {
        try {
          const url = new URL(container.getAttribute('data-vote-url') || '', formUrl);
          const token = container.getAttribute('data-vote-csrf')?.trim();
          if (
            url.origin !== YAOHUO_BASE_URL ||
            !YAOHUO_VOTE_PATH_PATTERN.test(url.pathname) ||
            url.search ||
            url.hash ||
            !token
          )
            return null;
          const buttons = container
            .querySelectorAll('.vote-button')
            .filter((button) => voteIds.includes(button.getAttribute('data-vid') || ''));
          const first = buttons[0];
          if (
            !first ||
            buttons.length !== voteIds.length ||
            voteIds.some((id) => buttons.filter((button) => button.getAttribute('data-vid') === id).length !== 1)
          )
            return null;
          const fields = {
            classid: first.getAttribute('data-classid') || '',
            vpage: first.getAttribute('data-vpage') || '',
            lpage: first.getAttribute('data-lpage') || ''
          };
          if (
            buttons.some(
              (button) =>
                button.hasAttribute('disabled') ||
                button.getAttribute('data-id') !== topicId ||
                button.getAttribute('data-siteid') !== body.get('siteid') ||
                Boolean(fields.classid && fields.classid !== body.get('classid')) ||
                Object.entries(fields).some(([name, value]) => (button.getAttribute(`data-${name}`) || '') !== value)
            )
          )
            return null;
          return { path: url.pathname, token, fields };
        } catch {
          return null;
        }
      })
      .filter((context) => context !== null);
    const context = contexts.length === 1 ? contexts[0] : undefined;
    const isSameOrigin = !formResponse.responseUrl || new URL(formResponse.responseUrl).origin === YAOHUO_BASE_URL;
    if (trace)
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        hasCsrfToken: Boolean(context?.token),
        isSameOrigin
      });
    if (!context || !isSameOrigin) throw new Error('无法读取妖火投票验证信息，请刷新后重试');
    body.set('__CSRFToken', context.token);
    Object.entries(context.fields).forEach(([name, value]) => body.set(name, value));
    request = {
      ...request,
      path: context.path,
      body: body.toString(),
      headers: { ...request.headers, referer: formUrl }
    };
  } else if (isFavoriteDeleteRequest(request)) {
    const tokenPath = '/bbs/favlist.aspx?action=csrftoken&siteid=1000';
    const tokenResponse = await fetchYaohuoActionHtml({
      request: { path: tokenPath, method: 'GET', headers: { accept: 'application/json', 'cache-control': 'no-store' } },
      path: tokenPath,
      fetcher,
      signal,
      timeoutMs,
      cache: 'no-store'
    });
    const isSameOrigin = !tokenResponse.responseUrl || isFavoriteSuccessUrl(tokenResponse.responseUrl);
    let token = '';
    try {
      const data: unknown = JSON.parse(tokenResponse.html);
      if (
        data &&
        typeof data === 'object' &&
        'success' in data &&
        data.success === true &&
        'token' in data &&
        typeof data.token === 'string'
      ) {
        token = data.token.trim();
      }
    } catch {
      token = '';
    }
    if (trace)
      markDiagnosticStage(trace, 'credential', { source: 'yaohuo', hasCsrfToken: Boolean(token), isSameOrigin });
    if (!token || !isSameOrigin) throw new Error('无法读取妖火收藏验证信息，请刷新后重试');
    const body = new URLSearchParams(request.body);
    body.set('__CSRFToken', token);
    request = { ...request, body: body.toString() };
  }
  let { html, responseUrl } = await fetchYaohuoActionHtml({
    request,
    fetcher,
    path: request.path,
    signal,
    timeoutMs
  });

  if (request.method === 'GET' && YAOHUO_REPLY_DELETE_PATH_PATTERN.test(requestUrl.pathname)) {
    const confirmationPath = deleteConfirmationPath(html, requestUrl);
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
    return messageReplyResult(html, new URLSearchParams(request.body).get('ajax') === '1');
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

  return actionMessage(
    html,
    isReply
      ? 'reply'
      : request.method === 'GET' && YAOHUO_REPLY_DELETE_PATH_PATTERN.test(requestUrl.pathname)
        ? 'delete'
        : isVote
          ? 'vote'
          : undefined
  );
}
