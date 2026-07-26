import type { Source } from './types';
import { fetchWithTimeout, type Fetcher } from './request';
import { sourceSupportsTopicAction } from './sourceCatalog';

export type ReplyImageAsset = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number;
};

export type NormalizedReplyImageAsset = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
};

export const MAX_REPLY_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const YAOHUO_IMAGE_BED_UPLOAD_URL = 'https://tucdn.wpon.cn/api/upload';
const NODEIMAGE_UPLOAD_URL = 'https://api.nodeimage.com/api/upload';
type NodeImageUploadError = Error & { nodeImageApiKeyExpired?: boolean };
type NodeImageApiKeyProvider = () => Promise<string | null | undefined>;

export function replyImageUploadSupported(source?: Source) {
  return sourceSupportsTopicAction(source, 'upload');
}

export function normalizeReplyImageAsset(asset: ReplyImageAsset): NormalizedReplyImageAsset {
  const uri = String(asset.uri || '').trim();
  if (!uri) {
    throw new Error('请选择图片文件');
  }
  const name = String(asset.name || fileNameFromUri(uri) || 'image.jpg').trim();
  const mimeType = String(asset.mimeType || imageMimeTypeFromName(name)).trim();
  if (!/^image\//i.test(mimeType)) {
    throw new Error('请选择图片文件');
  }
  if (asset.size && asset.size > MAX_REPLY_IMAGE_UPLOAD_BYTES) {
    throw new Error('图片不能超过 20MB');
  }
  return {
    uri,
    name,
    mimeType,
    ...(asset.size ? { size: asset.size } : {})
  };
}

export function replyImageMarkupForSource(source: Source, url: string, name: string) {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) {
    throw new Error('图片上传返回缺少地址');
  }
  return source === 'yaohuo'
    ? `[img]${cleanUrl}[/img]`
    : `![${safeImageAlt(name)}](${cleanUrl})`;
}

export function appendReplyImageMarkup(content: string, markup: string) {
  const cleanMarkup = markup.trim();
  if (!cleanMarkup) {
    return content;
  }
  return `${content}${content && !content.endsWith('\n') ? '\n' : ''}${cleanMarkup}`;
}

export function yaohuoImageUrlFromUploadResponse(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const payload = record.data;
  const url = typeof payload === 'string'
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

export function nodeImageUrlFromUploadResponse(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const links = record.links && typeof record.links === 'object' ? record.links as Record<string, unknown> : {};
  const dataRecord = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
  const image = record.image && typeof record.image === 'object' ? record.image as Record<string, unknown> : {};
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
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const dataRecord = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
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
  const response = await fetchWithTimeout(NODEIMAGE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-API-Key': cleanApiKey
    },
    body
  }, {
    fetcher,
    signal,
    timeoutMs
  });
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
  const response = await fetchWithTimeout(YAOHUO_IMAGE_BED_UPLOAD_URL, {
    method: 'POST',
    body
  }, {
    fetcher,
    signal,
    timeoutMs
  });
  let data: unknown = null;
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

export function appendFileToFormData(body: FormData, fieldName: string, file: NormalizedReplyImageAsset) {
  const uploadFile = {
    uri: file.uri,
    name: file.name,
    type: file.mimeType
  };
  try {
    body.append(fieldName, uploadFile as unknown as Blob);
  } catch {
    body.append(fieldName, new Blob([]), file.name);
  }
}

function fileNameFromUri(uri: string) {
  const clean = uri.split(/[?#]/)[0] || '';
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name || '').trim();
  } catch {
    return name.trim();
  }
}

function imageMimeTypeFromName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') {
    return 'image/jpeg';
  }
  if (extension === 'png') {
    return 'image/png';
  }
  if (extension === 'webp') {
    return 'image/webp';
  }
  if (extension === 'gif') {
    return 'image/gif';
  }
  return 'image/jpeg';
}

function safeImageAlt(name: string) {
  return String(name || 'image').replace(/[\r\n[\]<>]/g, ' ').replace(/\s+/g, ' ').trim() || 'image';
}
