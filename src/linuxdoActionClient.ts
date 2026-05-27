import { fetchWithTimeout, type Fetcher } from './request';
import type { LinuxDoActionRequest } from './linuxdoActions';
import {
  DEFAULT_LINUXDO_ANDROID_USER_AGENT,
  canStoreLinuxDoLogin,
  isCloudflareChallengeResponse,
  parseLinuxDoDocumentCookie
} from './linuxdoCookieBridge';

const LINUXDO_BASE_URL = 'https://linux.do';
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

function linuxDoResponseMessage(data: Record<string, unknown>, fallback: string) {
  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }
  if (Array.isArray(data.errors)) {
    const message = data.errors.map((item) => String(item || '').trim()).filter(Boolean).join('；');
    if (message) {
      return message;
    }
  }
  return fallback;
}

function linuxDoActionError(data: Record<string, unknown>, status: number) {
  const message = linuxDoResponseMessage(data, `linux.do 请求失败：HTTP ${status}`);
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
  cookieHeader,
  fetcher,
  signal,
  timeoutMs,
  userAgent
}: {
  cookieHeader: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}) {
  const response = await fetchWithTimeout(`${LINUXDO_BASE_URL}/session/csrf`, {
    headers: {
      ...LINUXDO_ACTION_HEADERS,
      Cookie: cookieHeader,
      'User-Agent': userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT
    }
  }, { fetcher, signal, timeoutMs });
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw response.status === 401 || response.status === 403 ? linuxDoLoginRequiredError() : new Error(`linux.do 请求失败：HTTP ${response.status}`);
  }
  const token = typeof data.csrf === 'string' ? data.csrf : typeof data.csrf_token === 'string' ? data.csrf_token : '';
  if (!token) {
    throw new Error('linux.do CSRF 信息不完整');
  }
  return token;
}

export async function runLinuxDoAction({
  cookieHeader,
  request,
  fetcher = fetch,
  signal,
  timeoutMs,
  userAgent
}: {
  cookieHeader: string;
  request: LinuxDoActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}) {
  const cleanCookie = cookieHeader.trim();
  if (!cleanCookie || !canStoreLinuxDoLogin(parseLinuxDoDocumentCookie(cleanCookie))) {
    throw linuxDoLoginRequiredError();
  }
  const csrfToken = await getCsrfToken({ cookieHeader: cleanCookie, fetcher, signal, timeoutMs, userAgent });
  const response = await fetchWithTimeout(`${LINUXDO_BASE_URL}${request.path}`, {
    method: request.method,
    headers: {
      ...LINUXDO_ACTION_HEADERS,
      ...request.headers,
      Cookie: cleanCookie,
      'User-Agent': userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT,
      'X-CSRF-Token': csrfToken
    },
    body: request.body
  }, { fetcher, signal, timeoutMs });
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw linuxDoActionError(data, response.status);
  }
  return data;
}

export async function checkLinuxDoLoginAccess({
  cookieHeader,
  fetcher = fetch,
  signal,
  timeoutMs,
  userAgent
}: {
  cookieHeader: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}) {
  const cleanCookie = cookieHeader.trim();
  if (!cleanCookie || !canStoreLinuxDoLogin(parseLinuxDoDocumentCookie(cleanCookie))) {
    return {
      ok: false,
      loginRequired: true,
      message: 'linux.do 登录已失效，请重新登录'
    };
  }
  try {
    await getCsrfToken({ cookieHeader: cleanCookie, fetcher, signal, timeoutMs, userAgent });
    return {
      ok: true,
      message: '登录可用'
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
      return {
        ok: false,
        loginRequired: true,
        message: 'linux.do 登录已失效，请重新登录'
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'linux.do 登录检查失败'
    };
  }
}
