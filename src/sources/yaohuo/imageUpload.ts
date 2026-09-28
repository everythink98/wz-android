import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import type { NormalizedReplyImageAsset } from '@/sources/imageUpload';

const YAOHUO_IMAGE_BED_UPLOAD_URL = 'https://file.sang.pub/api/upload';

function uploadMessage(data: unknown) {
  const message = data && typeof data === 'object' ? (data as Record<string, unknown>).msg : undefined;
  return typeof message === 'string' ? message.trim() : '';
}

export function yaohuoImageUrlFromUploadResponse(data: unknown) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (record.code !== 200) {
    throw new Error(`图床上传失败：${uploadMessage(data) || '未返回成功状态'}`);
  }
  const url = typeof record.data === 'string' ? record.data.trim() : '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password)
      throw new Error('invalid image URL');
    return parsed.href;
  } catch {
    throw new Error('图床返回的图片地址无效');
  }
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
  const response = await fetchWithTimeout(
    YAOHUO_IMAGE_BED_UPLOAD_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.mimeType,
        'X-Upload-Type': 'qiyu',
        'X-File-Name': encodeURIComponent(file.name)
      },
      // React Native streams this URI as the raw request body, without a multipart envelope.
      body: { uri: file.uri } as unknown as BodyInit
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
    throw new Error(`图床上传失败：${uploadMessage(data) || `HTTP ${response.status}`}`);
  }
  return yaohuoImageUrlFromUploadResponse(data);
}
