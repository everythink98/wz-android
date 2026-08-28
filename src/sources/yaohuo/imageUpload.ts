import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { appendFileToFormData, type NormalizedReplyImageAsset } from '@/sources/imageUpload';

const YAOHUO_IMAGE_BED_UPLOAD_URL = 'https://tucdn.wpon.cn/api/upload';

export function yaohuoImageUrlFromUploadResponse(data: unknown) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const payload = record.data;
  const url =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).url || '')
        : String(record.url || '');
  const cleanUrl = url.trim();
  if (!cleanUrl) {
    throw new Error('图床返回缺少图片地址');
  }
  return cleanUrl;
}

export async function uploadYaohuoReplyImage({
  file,
  fetcher = fetch,
  signal,
  timeoutMs = 30_000
}: {
  file: NormalizedReplyImageAsset;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const body = new FormData();
  appendFileToFormData(body, 'image', file);
  const response = await fetchWithTimeout(
    YAOHUO_IMAGE_BED_UPLOAD_URL,
    {
      method: 'POST',
      body
    },
    {
      fetcher,
      signal,
      timeoutMs
    }
  );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(`图床上传失败：HTTP ${response.status}`);
  }
  return yaohuoImageUrlFromUploadResponse(data);
}
