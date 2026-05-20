export function normalizeServerUrl(value: string) {
  const clean = value.trim().replace(/\/+$/, '');
  if (!clean) {
    throw new Error('请输入服务器地址');
  }
  return clean;
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

export async function readReaderData(serverUrl: string, syncCode: string) {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/sync/reader-data`, {
    headers: buildSyncHeaders(syncCode)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function writeReaderData(serverUrl: string, syncCode: string, readerData: unknown) {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/sync/reader-data`, {
    method: 'PUT',
    headers: buildSyncHeaders(syncCode),
    body: JSON.stringify(readerData)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}
