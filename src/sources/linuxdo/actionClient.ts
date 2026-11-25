import { fetchWithTimeout, isDefinitiveHttpRejection, type Fetcher } from '@/platform/network/request';
import { isRecord } from '@/domain/forum/html';
import { withBrowserFetchIntent, type BrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { discourseActionResponseMessage, type DiscourseActionRequest } from '@/sources/discourse/actionRequest';
import {
  isCloudflareChallengeResponse,
  LinuxDoCloudflareError,
  cloudflareChallengeDiagnostics,
  responseRetryAfterMs
} from '@/platform/network/cloudflareChallenge';
import { diagnosticUserAgentHash } from '@/platform/android/userAgent';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
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
  const explicitlyRejected = [408, 409].includes(status) && 'success' in payload && payload.success === false;
  Object.assign(error, { serverRejected: isDefinitiveHttpRejection(status) || explicitlyRejected });
  if (status === 429) {
    Object.assign(error, { safeToRetry: true, retryAfterMs: responseRetryAfterMs(response.headers) ?? 0 });
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
    if (diagnostics)
      markDiagnosticStage(diagnostics.trace, 'guard', {
        ...diagnostics.fields,
        ...cloudflareChallengeDiagnostics(response, text)
      });
    throw Object.assign(new LinuxDoCloudflareError(response), cloudflareChallengeDiagnostics(response, text));
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
          'User-Agent': await resolveWebViewUserAgent(userAgent, signal)
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

export async function loadLinuxDoReplyEditSource({
  topicId,
  commentId,
  floor,
  fetcher,
  signal,
  userAgent
}: {
  topicId: string;
  commentId: number;
  floor?: number;
  fetcher: Fetcher;
  signal: AbortSignal;
  userAgent: string;
}) {
  if (!Number.isSafeInteger(commentId) || commentId <= 0) throw new Error('当前回复缺少有效评论 id');
  const post = await runLinuxDoAction({
    fetcher,
    signal,
    userAgent,
    browserFetchIntent: { owner: 'topic', priority: 'foreground' },
    request: { path: `/posts/${commentId}.json`, method: 'GET', headers: {} }
  });
  if (
    !isRecord(post) ||
    post.id !== commentId ||
    String(post.topic_id) !== topicId ||
    typeof post.post_number !== 'number' ||
    !Number.isSafeInteger(post.post_number) ||
    post.post_number <= 1 ||
    (floor !== undefined && post.post_number !== floor) ||
    post.can_edit !== true ||
    typeof post.raw !== 'string' ||
    !post.raw.trim()
  )
    throw new Error('原站未确认回复身份、编辑权限或原文');
  return post.raw;
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
            userAgentHash: diagnosticUserAgentHash(new Headers(init?.headers).get('User-Agent') || ''),
            userAgentSource: userAgent ? 'provided' : 'default',
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
          'User-Agent': await resolveWebViewUserAgent(userAgent, signal),
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
