import { nodeSeekActionErrorMessage, type NodeSeekActionRequest } from './actionRequest';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { NODESEEK_VOTE_API_HEADERS, normalizeNodeSeekVoteInfo } from './polls';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import { NODESEEK_BASE_URL } from './protocol';

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
  const cleanUserAgent = (userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT).trim();
  const response = await fetchWithTimeout(
    `${NODESEEK_BASE_URL}/api/vote/info/${encodeURIComponent(cleanPollId)}`,
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
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new Error('NodeSeek 返回内容格式不正确');
  }
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
  const cleanUserAgent = (userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT).trim();

  const response = await fetchWithTimeout(
    `${NODESEEK_BASE_URL}${request.path}`,
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
  let data: unknown = null;
  let parsedJson = true;
  try {
    data = await response.json();
  } catch {
    parsedJson = false;
  }

  if (!response.ok) {
    throw nodeSeekActionError(data, response.status, request.fallbackErrorMessage);
  }
  if (!parsedJson) {
    throw new Error('NodeSeek 返回内容格式不正确');
  }
  if (isFailedActionPayload(data)) {
    throw nodeSeekActionError(data, response.status, request.fallbackErrorMessage, true);
  }

  return data;
}

function nodeSeekActionError(
  data: unknown,
  status: number,
  fallbackErrorMessage?: string,
  confirmedRejection = status >= 400 && status < 500
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
