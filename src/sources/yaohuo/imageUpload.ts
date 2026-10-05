import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import {
  appendFileToFormData,
  MAX_REPLY_IMAGE_UPLOAD_BYTES,
  type NormalizedReplyImageAsset
} from '@/sources/imageUpload';
import { YAOHUO_BASE_URL } from './protocol';

const YAOHUO_IMAGE_BED_UPLOAD_URL = 'https://aapi.helioho.st/upload.php';

function uploadMessage(data: unknown) {
  const message = data && typeof data === 'object' ? (data as Record<string, unknown>).msg : undefined;
  return typeof message === 'string' ? message.trim() : '';
}

export function yaohuoImageUrlFromUploadResponse(data: unknown) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (record.code !== 200) {
    throw new Error(`图床上传失败：${uploadMessage(data) || '未返回成功状态'}`);
  }
  const image = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : {};
  const url = typeof image.url === 'string' ? image.url.trim() : '';
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
  const size = file.size ?? new (await import('expo-file-system')).File(file.uri).size;
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('图片文件为空或无法读取');
  if (size > MAX_REPLY_IMAGE_UPLOAD_BYTES) throw new Error('图片不能超过 20MB');
  const body = new FormData();
  appendFileToFormData(body, 'image', file);
  const response = await fetchWithTimeout(
    YAOHUO_IMAGE_BED_UPLOAD_URL,
    {
      method: 'POST',
      headers: { Origin: YAOHUO_BASE_URL },
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
    throw new Error(`图床上传失败：${uploadMessage(data) || `HTTP ${response.status}`}`);
  }
  return yaohuoImageUrlFromUploadResponse(data);
}
