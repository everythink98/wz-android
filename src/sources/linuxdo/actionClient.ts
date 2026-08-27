import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { discourseActionResponseMessage, type DiscourseActionRequest } from '@/sources/discourse/actionRequest';
import { isCloudflareChallengeResponse } from '@/platform/network/cloudflareChallenge';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import { LINUXDO_BASE_URL } from './protocol';

const LINUXDO_ACTION_HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Origin: LINUXDO_BASE_URL,
  Referer: `${LINUXDO_BASE_URL}/latest`,
  'X-Requested-With': 'XMLHttpRequest'
};

function linuxDoLoginRequiredError() {
  const error = new Error('linux.do 登录已失效，请重新登录');
  Object.assign(error, {
    source: 'linuxdo',
    loginRequired: true
  });
  return error;
}

function linuxDoActionError(data: Record<string, unknown>, status: number) {
  const message = discourseActionResponseMessage(data, `linux.do 请求失败：HTTP ${status}`);
  if (status === 401 || /login|log in|csrf|登录已失效|重新登录|请先.*登录/i.test(message)) {
    return linuxDoLoginRequiredError();
  }
  const error = new Error(message);
  if (status === 403) {
    Object.assign(error, {
      source: 'linuxdo',
      reason: 'permission'
    });
  }
  return error;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
    const error = new Error('linux.do 需要完成 Cloudflare 验证');
    Object.assign(error, {
      source: 'linuxdo',
      reason: 'cloudflare'
    });
    throw error;
  }
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (!response.ok) {
      throw new Error(`linux.do 请求失败：HTTP ${response.status}`);
    }
    throw new Error('linux.do 返回内容格式不正确');
  }
}

async function getCsrfToken({
  fetcher,
  signal,
  timeoutMs,
  userAgent
}: {
  fetcher: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}) {
  const response = await fetchWithTimeout(
    `${LINUXDO_BASE_URL}/session/csrf`,
    withBrowserFetchIntent(
      {
        headers: {
          ...LINUXDO_ACTION_HEADERS,
          'User-Agent': userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT
        }
      },
      { owner: 'write', priority: 'write' }
    ),
    { fetcher, signal, timeoutMs }
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw response.status === 401 || response.status === 403
      ? linuxDoLoginRequiredError()
      : new Error(`linux.do 请求失败：HTTP ${response.status}`);
  }
  const token = typeof data.csrf === 'string' ? data.csrf : typeof data.csrf_token === 'string' ? data.csrf_token : '';
  if (!token) {
    throw new Error('linux.do CSRF 信息不完整');
  }
  return token;
}

export async function runLinuxDoAction({
  request,
  fetcher = fetch,
  signal,
  timeoutMs,
  userAgent
}: {
  request: DiscourseActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}) {
  const csrfToken = request.method === 'GET' ? '' : await getCsrfToken({ fetcher, signal, timeoutMs, userAgent });
  const response = await fetchWithTimeout(
    `${LINUXDO_BASE_URL}${request.path}`,
    withBrowserFetchIntent(
      {
        method: request.method,
        headers: {
          ...LINUXDO_ACTION_HEADERS,
          ...request.headers,
          'User-Agent': userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT,
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
        },
        body: request.body
      },
      { owner: 'write', priority: 'write' }
    ),
    { fetcher, signal, timeoutMs }
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw linuxDoActionError(data, response.status);
  }
  return data;
}
