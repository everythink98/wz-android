import { fetchWithTimeout, type Fetcher } from './request';

interface SyncRequestOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function normalizeServerUrl(value: string) {
  const clean = value.trim().replace(/\/+$/, '');
  if (!clean) {
    throw new Error('请输入服务器地址');
  }
  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    throw new Error('请输入有效的服务器地址');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('服务器地址只支持 http/https');
  }
  if (url.protocol === 'http:' && !isLocalHttpHost(url.hostname)) {
    throw new Error('公网服务器地址必须使用 https');
  }
  return clean;
}

function isLocalHttpHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2') {
    return true;
  }
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function buildSyncHeaders(syncCode: string) {
  const clean = syncCode.trim();
  if (!clean) {
    throw new Error('请输入同步码');
  }

  return {
    'content-type': 'application/json',
    'x-sync-code': clean
  };
}

export async function readReaderData(serverUrl: string, syncCode: string, options: SyncRequestOptions = {}) {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}/api/sync/reader-data`, {
    headers: buildSyncHeaders(syncCode)
  }, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function writeReaderData(serverUrl: string, syncCode: string, readerData: unknown, options: SyncRequestOptions = {}) {
  const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}/api/sync/reader-data`, {
    method: 'PUT',
    headers: buildSyncHeaders(syncCode),
    body: JSON.stringify(readerData)
  }, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}
