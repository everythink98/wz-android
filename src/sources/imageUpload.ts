import type { Source } from '@/domain/forum/models';
import { sourceSupportsTopicAction } from '@/domain/forum/sourceCatalog';

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
  return source === 'yaohuo' ? `[img]${cleanUrl}[/img]` : `![${safeImageAlt(name)}](${cleanUrl})`;
}

export function appendReplyImageMarkup(content: string, markup: string) {
  const cleanMarkup = markup.trim();
  if (!cleanMarkup) {
    return content;
  }
  return `${content}${content && !content.endsWith('\n') ? '\n' : ''}${cleanMarkup}`;
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
  return (
    String(name || 'image')
      .replace(/[\r\n[\]<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'image'
  );
}
