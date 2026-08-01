import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { appendFileToFormData, type NormalizedReplyImageAsset } from '@/sources/imageUpload';

const NODEIMAGE_UPLOAD_URL = 'https://api.nodeimage.com/api/upload';
type NodeImageUploadError = Error & { nodeImageApiKeyExpired?: boolean };
type NodeImageApiKeyProvider = () => Promise<string | null | undefined>;

export function nodeImageUrlFromUploadResponse(data: unknown) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const links = record.links && typeof record.links === 'object' ? (record.links as Record<string, unknown>) : {};
  const dataRecord = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : {};
  const image = record.image && typeof record.image === 'object' ? (record.image as Record<string, unknown>) : {};
  const url = String(links.direct || dataRecord.url || image.url || record.url || '').trim();
  if (!url) {
    throw new Error('NodeImage 返回缺少图片地址');
  }
  return url;
}

export function nodeImageUploadErrorMessage(data: unknown, status: number) {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const message = String(record.message || record.error || '').trim();
    if (message) {
      return message;
    }
  }
  return `NodeImage 上传失败：HTTP ${status}`;
}

export function nodeImageApiKeyFromResponse(data: unknown) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const dataRecord = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : {};
  return String(record.api_key || record.apiKey || dataRecord.api_key || dataRecord.apiKey || '').trim();
}

export function isNodeImageApiKeyExpiredError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as NodeImageUploadError).nodeImageApiKeyExpired);
}

export async function uploadNodeSeekReplyImage({
  apiKey,
  file,
  fetcher = fetch,
  signal,
  timeoutMs = 30_000
}: {
  apiKey: string;
  file: NormalizedReplyImageAsset;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const cleanApiKey = apiKey.trim();
  if (!cleanApiKey) {
    throw new Error('请先保存 NodeImage API Key');
  }
  const body = new FormData();
  appendFileToFormData(body, 'image', file);
  const response = await fetchWithTimeout(
    NODEIMAGE_UPLOAD_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-API-Key': cleanApiKey
      },
      body
    },
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
    data = null;
  }
  if (!response.ok) {
    const error = new Error(nodeImageUploadErrorMessage(data, response.status)) as NodeImageUploadError;
    error.nodeImageApiKeyExpired = response.status === 401 || response.status === 403;
    throw error;
  }
  return nodeImageUrlFromUploadResponse(data);
}

export async function uploadNodeSeekReplyImageWithApiKey({
  ensureApiKey,
  file,
  fetcher = fetch,
  signal,
  timeoutMs = 30_000
}: {
  ensureApiKey: NodeImageApiKeyProvider;
  file: NormalizedReplyImageAsset;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const apiKey = await ensureApiKey();
  if (!apiKey) {
    return '';
  }
  return uploadNodeSeekReplyImage({ apiKey, file, fetcher, signal, timeoutMs });
}
