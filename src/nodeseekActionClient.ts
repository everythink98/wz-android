import { nodeSeekActionErrorMessage, type NodeSeekActionRequest } from './nodeseekActions';
import { fetchWithTimeout, type Fetcher } from './request';

const NODESEEK_BASE_URL = 'https://www.nodeseek.com';
const NODESEEK_ACTION_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'content-type': 'application/json',
  origin: NODESEEK_BASE_URL,
  referer: `${NODESEEK_BASE_URL}/`,
  'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
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
    return /high risk|risk|fail|error|invalid|csrf|unauthorized|forbidden|拒绝|失败|错误|风险|无效|登录/i.test(record.message);
  }
  return false;
}

export async function runNodeSeekAction({
  cookieHeader,
  request,
  fetcher = fetch,
  signal,
  timeoutMs
}: {
  cookieHeader: string;
  request: NodeSeekActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const cleanCookie = cookieHeader.trim();
  if (!cleanCookie) {
    throw new Error('请先检测 NodeSeek 登录');
  }

  const response = await fetchWithTimeout(`${NODESEEK_BASE_URL}${request.path}`, {
    method: request.method,
    headers: {
      ...NODESEEK_ACTION_HEADERS,
      ...request.headers,
      cookie: cleanCookie
    },
    body: request.body
  }, {
    fetcher,
    signal,
    timeoutMs
  });
  let data: unknown = null;
  let parsedJson = true;
  try {
    data = await response.json();
  } catch {
    parsedJson = false;
  }

  if (!response.ok) {
    throw nodeSeekActionError(data, response.status);
  }
  if (!parsedJson) {
    throw new Error('NodeSeek 返回内容格式不正确');
  }
  if (isFailedActionPayload(data)) {
    throw nodeSeekActionError(data, response.status);
  }

  return data;
}

function nodeSeekActionError(data: unknown, status: number) {
  const message = nodeSeekActionErrorMessage(data, status);
  const error = new Error(message);
  if (status === 401 || /重新登录|请先.*登录|拒绝了请求/i.test(message)) {
    Object.assign(error, {
      source: 'nodeseek',
      loginRequired: true
    });
  }
  return error;
}
