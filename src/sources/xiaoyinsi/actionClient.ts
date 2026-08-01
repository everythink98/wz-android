import type { XiaoyinsiApiCredentials } from './reader';
import { XIAOYINSI_BASE_URL } from './protocol';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import type { DiscourseActionRequest } from '@/sources/discourse/actionRequest';

type XiaoyinsiActionErrorFields = {
  source: 'xiaoyinsi';
  status?: number;
  reason?: 'permission';
  loginRequired?: true;
  authorizationCheckRequired?: true;
};

function actionError(message: string, fields: Omit<XiaoyinsiActionErrorFields, 'source'> = {}) {
  const error = new Error(message) as Error & XiaoyinsiActionErrorFields;
  Object.assign(error, { source: 'xiaoyinsi' as const, ...fields });
  return error;
}

function responseMessage(data: Record<string, unknown>, fallback: string) {
  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }
  if (Array.isArray(data.errors)) {
    const message = data.errors
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join('；');
    if (message) {
      return message;
    }
  }
  return fallback;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (!response.ok) {
      throw actionError(`小隐寺请求失败：HTTP ${response.status}`, { status: response.status });
    }
    throw actionError('小隐寺返回内容格式不正确');
  }
}

export async function runXiaoyinsiAction({
  credentials,
  request,
  fetcher = fetch,
  signal,
  timeoutMs
}: {
  credentials: XiaoyinsiApiCredentials;
  request: DiscourseActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const apiKey = credentials.apiKey.trim();
  const clientId = credentials.clientId.trim();
  if (!apiKey || !clientId) {
    throw actionError('请先授权小隐寺', { loginRequired: true });
  }
  const response = await fetchWithTimeout(
    `${XIAOYINSI_BASE_URL}${request.path}`,
    {
      method: request.method,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        ...request.headers,
        'User-Api-Key': apiKey,
        'User-Api-Client-Id': clientId
      },
      body: request.body
    },
    { fetcher, signal, timeoutMs }
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    const message = responseMessage(data, `小隐寺请求失败：HTTP ${response.status}`);
    throw actionError(message, {
      status: response.status,
      ...(response.status === 401 || response.status === 403 ? { authorizationCheckRequired: true as const } : {}),
      ...(response.status === 403 ? { reason: 'permission' as const } : {})
    });
  }
  return data;
}
