import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { withBrowserFetchIntent, type BrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { discourseActionResponseMessage, type DiscourseActionRequest } from '@/sources/discourse/actionRequest';
import { isCloudflareChallengeResponse } from '@/platform/network/cloudflareChallenge';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import {
  diagnosticRequestFields,
  diagnosticTraceForRequest,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticFields, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { LINUXDO_BASE_URL, linuxDoRequestError } from './protocol';

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
    status: 401,
    loginRequired: true
  });
  return error;
}

function linuxDoActionError(data: Record<string, unknown> | unknown[], response: Response) {
  const payload = Array.isArray(data) ? { errors: data.filter((value) => typeof value === 'string') } : data;
  const { status } = response;
  const message = discourseActionResponseMessage(payload, `linux.do 请求失败：HTTP ${status}`);
  if (status === 401) {
    return linuxDoLoginRequiredError();
  }
  const error = linuxDoRequestError(message, status, payload);
  if (status === 429) {
    const retry = response.headers.get('Retry-After');
    const seconds = Number(retry);
    const retryAfterMs =
      retry && !Number.isFinite(seconds) ? Math.max(0, Date.parse(retry) - Date.now()) : seconds * 1000;
    Object.assign(error, { safeToRetry: true, retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0 });
  }
  return error;
}

async function readJsonResponse(
  response: Response,
  diagnostics?: { trace: DiagnosticTrace; fields: DiagnosticFields }
) {
  const text = await response.text();
  if (diagnostics) {
    markDiagnosticStage(diagnostics.trace, 'parse', {
      ...diagnostics.fields,
      state: 'body-ready',
      status: response.status,
      isBodyEmpty: text.length === 0,
      // Size of the consumed UTF-8 text, independent of Content-Length and transfer compression.
      byteCount: new TextEncoder().encode(text).byteLength
    });
  }
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
      return {};
    }
    throw new Error('linux.do 返回内容格式不正确');
  }
}

export async function getLinuxDoCsrfToken({
  fetcher,
  signal,
  timeoutMs,
  userAgent,
  browserFetchIntent = { owner: 'write', priority: 'write' }
}: {
  fetcher: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
  browserFetchIntent?: BrowserFetchIntent;
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
      browserFetchIntent
    ),
    { fetcher, signal, timeoutMs }
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw linuxDoActionError(data, response);
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
  userAgent,
  csrfToken: suppliedCsrf,
  readingDiagnostics,
  browserFetchIntent = { owner: 'write', priority: 'write' }
}: {
  request: DiscourseActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
  csrfToken?: string;
  readingDiagnostics?: { trace: DiagnosticTrace; topicId: string };
  browserFetchIntent?: BrowserFetchIntent;
}) {
  const csrfToken =
    request.method === 'GET'
      ? ''
      : suppliedCsrf || (await getLinuxDoCsrfToken({ fetcher, signal, timeoutMs, userAgent, browserFetchIntent }));
  let responseDiagnostics: { trace: DiagnosticTrace; fields: DiagnosticFields } | undefined;
  const requestFetcher =
    readingDiagnostics && request.path === '/topics/timings' && request.method === 'POST'
      ? withDiagnosticFetcher(readingDiagnostics.trace, (input, init) => {
          const trace = diagnosticTraceForRequest(init)!;
          const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
          const fields: DiagnosticFields = {
            ...diagnosticRequestFields(init),
            source: 'linuxdo',
            endpoint: 'action',
            method: 'POST',
            topicRef: diagnosticRef('topic', `linuxdo:${form.get('topic_id')}`)
          };
          responseDiagnostics = { trace, fields };
          const timings = [...form].filter(([key]) => /^timings\[\d+\]$/.test(key));
          markDiagnosticStage(trace, 'transport', {
            ...fields,
            state: 'summary',
            isTopicIdMatch: form.get('topic_id') === readingDiagnostics.topicId,
            isFormEncoded: new Headers(init?.headers).get('Content-Type') === 'application/x-www-form-urlencoded',
            topicTimeMs: Number(form.get('topic_time') ?? Number.NaN),
            itemCount: timings.length
          });
          for (const [key, milliseconds] of timings) {
            markDiagnosticStage(trace, 'transport', {
              ...fields,
              floor: Number(key.slice(8, -1)),
              postTimeMs: Number(milliseconds)
            });
          }
          return fetcher(input, init);
        })
      : fetcher;
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
      browserFetchIntent
    ),
    { fetcher: requestFetcher, signal, timeoutMs }
  );
  const data = await readJsonResponse(response, responseDiagnostics);
  if (!response.ok) {
    throw linuxDoActionError(data, response);
  }
  return data;
}
