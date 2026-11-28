import { nodeSeekActionErrorMessage, type NodeSeekActionRequest } from './actionRequest';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { NODESEEK_VOTE_API_HEADERS, normalizeNodeSeekVoteInfo } from './polls';
import { fetchWithTimeout, isDefinitiveHttpRejection, type Fetcher } from '@/platform/network/request';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import { isRecord } from '@/domain/forum/html';
import { isNodeSeekChallengeResponse, NODESEEK_BASE_URL } from './protocol';
import { canContainCloudflareChallengePage } from '@/platform/network/cloudflareChallenge';

export const NODESEEK_ACTION_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'content-type': 'application/json',
  origin: NODESEEK_BASE_URL,
  referer: `${NODESEEK_BASE_URL}/`,
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'x-csrf-challenge': 'simple-token',
  'x-requested-with': 'XMLHttpRequest'
};

export function isConfirmedNodeSeekAction(data: unknown): data is Record<string, unknown> & { success: true } {
  return isRecord(data) && data.success === true;
}

export function unconfirmedNodeSeekVerification(error: unknown) {
  if (isRecord(error) && error.reason === 'cloudflare' && error.serverRejected === false) {
    return { status: 'unknown' as const, message: '请到 NodeSeek 原站完成验证并核对本次提交结果，勿重复提交' };
  }
}

function isFailedActionPayload(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const record = data as Record<string, unknown>;
  if (record.success === false) {
    return true;
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    return true;
  }
  if (record.success !== true && typeof record.message === 'string') {
    return /high risk|risk|fail|error|invalid|csrf|unauthorized|forbidden|拒绝|失败|错误|风险|无效|登录/i.test(
      record.message
    );
  }
  return false;
}

export function nodeSeekCreatedPollId(data: unknown) {
  const candidates = [
    data,
    data && typeof data === 'object' ? (data as Record<string, unknown>).data : undefined,
    data && typeof data === 'object' ? (data as Record<string, unknown>).vote : undefined
  ];
  for (const candidate of candidates) {
    const raw =
      candidate && typeof candidate === 'object'
        ? ((candidate as Record<string, unknown>).id ??
          (candidate as Record<string, unknown>).voteId ??
          (candidate as Record<string, unknown>).vote_id)
        : candidate;
    const id = String(raw || '').trim();
    if (/^\d+$/.test(id)) return id;
  }
  throw new Error('NodeSeek 未返回投票 id，结果未知，请刷新原站确认');
}

export async function fetchNodeSeekVoteInfo({
  pollId,
  fetcher = fetch,
  signal,
  timeoutMs,
  userAgent
}: {
  pollId: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}) {
  const cleanPollId = pollId.trim();
  if (!/^\d+$/.test(cleanPollId)) {
    throw new Error('投票 id 不正确');
  }
  const cleanUserAgent = (await resolveWebViewUserAgent(userAgent, signal)).trim();
  const url = `${NODESEEK_BASE_URL}/api/vote/info/${encodeURIComponent(cleanPollId)}`;
  const response = await fetchWithTimeout(
    url,
    withBrowserFetchIntent(
      {
        method: 'GET',
        headers: {
          ...NODESEEK_ACTION_HEADERS,
          ...NODESEEK_VOTE_API_HEADERS,
          ...(cleanUserAgent ? { 'user-agent': cleanUserAgent } : {})
        }
      },
      { owner: 'write', priority: 'write' }
    ),
    {
      fetcher,
      signal,
      timeoutMs
    }
  );
  const { data } = await readNodeSeekActionPayload(response, url);
  if (!response.ok) {
    throw nodeSeekActionError(data, response.status);
  }
  const poll = normalizeNodeSeekVoteInfo(data, cleanPollId);
  if (!poll) {
    throw new Error('NodeSeek 返回内容格式不正确');
  }
  return poll;
}

export async function runNodeSeekAction({
  request,
  fetcher = fetch,
  signal,
  timeoutMs,
  userAgent
}: {
  request: NodeSeekActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}) {
  const cleanUserAgent = (await resolveWebViewUserAgent(userAgent, signal)).trim();

  const url = `${NODESEEK_BASE_URL}${request.path}`;
  const response = await fetchWithTimeout(
    url,
    withBrowserFetchIntent(
      {
        method: request.method,
        headers: {
          ...NODESEEK_ACTION_HEADERS,
          ...request.headers,
          ...(cleanUserAgent ? { 'user-agent': cleanUserAgent } : {})
        },
        body: request.body
      },
      { owner: 'write', priority: 'write' }
    ),
    {
      fetcher,
      signal,
      timeoutMs
    }
  );
  const { data, parsedJson } = await readNodeSeekActionPayload(response, url);

  if (!response.ok) {
    const attendanceRequest = /^\/api\/attendance\?random=(?:true|false)$/.test(request.path);
    const requiresBusinessEvidence =
      [408, 409].includes(response.status) || (attendanceRequest && response.status >= 500);
    const payload = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    const explicitlyRejected =
      payload?.success === false ||
      (typeof payload?.error === 'string' && Boolean(payload.error.trim())) ||
      (Array.isArray(payload?.errors) && payload.errors.some((error) => typeof error === 'string' && error.trim()));
    const confirmedRejection = requiresBusinessEvidence
      ? explicitlyRejected
      : isDefinitiveHttpRejection(response.status);
    throw nodeSeekActionError(data, response.status, request.fallbackErrorMessage, confirmedRejection);
  }
  if (!parsedJson) {
    throw new Error('NodeSeek 返回内容格式不正确');
  }
  if (isFailedActionPayload(data)) {
    throw nodeSeekActionError(data, response.status, request.fallbackErrorMessage, true);
  }

  return data;
}

export async function readNodeSeekActionPayload(response: Response, url: string) {
  const readChallengeBody =
    (response.status === 403 || response.status === 503) && canContainCloudflareChallengePage(response.headers);
  const body = readChallengeBody ? await response.text().catch(() => '') : undefined;
  if (
    (body !== undefined || response.headers.has('cf-mitigated')) &&
    isNodeSeekChallengeResponse(response, body ?? '', response.url || url)
  ) {
    throw Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), {
      source: 'nodeseek',
      reason: 'cloudflare',
      status: response.status,
      serverRejected: false
    });
  }
  try {
    const data: unknown = body === undefined ? await response.json() : JSON.parse(body);
    return { data, parsedJson: true };
  } catch {
    return { data: null, parsedJson: false };
  }
}

function nodeSeekActionError(
  data: unknown,
  status: number,
  fallbackErrorMessage?: string,
  confirmedRejection = isDefinitiveHttpRejection(status)
) {
  const message = nodeSeekActionErrorMessage(data, status, fallbackErrorMessage);
  const error = new Error(message);
  Object.assign(error, { serverRejected: confirmedRejection, status });
  if (status === 401 || /登录已失效|重新检测登录|重新登录|请先.*登录/i.test(message)) {
    Object.assign(error, {
      source: 'nodeseek',
      loginRequired: true
    });
  }
  return error;
}
