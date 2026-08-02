import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import {
  FORUM_MEDIA_IDENTITY_HEADER,
  FORUM_MEDIA_SOURCE_HEADER,
  forumMediaIdentityHeaderValue,
  forumMediaSourceHeaderValue,
  type ForumMediaRequestContext
} from './mediaRequestContext';

export type ImageRequestOptions = {
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
};

export type ImageSourceOptions = ImageRequestOptions & {
  baseSource?: unknown;
};

const IMAGE_REQUEST_HEADER_HOSTS = ['v2ex.com', 'linux.do', 'nodeseek.com', '111666.best'];

export function isHttpOrHttpsUrl(url: unknown): boolean {
  const clean = typeof url === 'string' ? url.trim() : '';
  if (!clean) {
    return false;
  }
  try {
    const protocol = new URL(clean).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeImagePreviewUrl(url: string): string {
  const clean = String(url || '').trim();
  if (/^(?:https?:|data:)/i.test(clean)) {
    return clean;
  }
  if (clean.startsWith('//')) {
    return `https:${clean}`;
  }
  return clean;
}

export function imageRequestHeadersForUrl(
  url: unknown,
  options: ImageRequestOptions
): Record<string, string> | undefined {
  const clean = normalizeImagePreviewUrl(typeof url === 'string' ? url : '');
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    const headers: Record<string, string> = {
      [FORUM_MEDIA_IDENTITY_HEADER]: forumMediaIdentityHeaderValue(options?.mediaContext),
      [FORUM_MEDIA_SOURCE_HEADER]: forumMediaSourceHeaderValue(options?.mediaContext)
    };
    if (!isKnownForumImageHost(parsed.hostname)) {
      return headers;
    }
    Object.assign(headers, {
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: parsed.origin
    });
    if (isNodeSeekHost(parsed.hostname)) {
      const userAgent = String(options?.nodeSeekUserAgent || '').trim() || DEFAULT_NODESEEK_ANDROID_USER_AGENT;
      if (userAgent) {
        headers['User-Agent'] = userAgent;
      }
    }
    return headers;
  } catch {
    return undefined;
  }
}

export function imageSourceFromUrl(url: string, options: ImageSourceOptions) {
  const clean = normalizeImagePreviewUrl(url);
  const source = options?.baseSource;
  const base: Record<string, unknown> =
    source && typeof source === 'object' && !Array.isArray(source)
      ? { ...(source as Record<string, unknown>), uri: clean }
      : { uri: clean };
  const mediaSessionIdentity = options?.mediaContext?.sessionIdentity || '';
  if (mediaSessionIdentity && /^https?:\/\//i.test(clean)) {
    base.cacheKey = `${mediaSessionIdentity}:${clean}`;
  }
  const headers = imageRequestHeadersForUrl(clean, options);
  if (!headers) {
    return base;
  }
  return {
    ...base,
    headers: {
      ...(base.headers && typeof base.headers === 'object' && !Array.isArray(base.headers) ? base.headers : {}),
      ...headers
    }
  };
}

export function dataImageFileFromUrl(url: unknown): { base64: string; extension: string } | null {
  const clean = typeof url === 'string' ? url.trim() : '';
  const match = clean.match(/^data:image\/(png|jpe?g|gif|webp|avif);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const type = match[1].toLowerCase();
  const extension = type === 'jpeg' ? 'jpg' : type.split('+')[0];
  const base64 = match[2].trim();
  return base64 ? { base64, extension } : null;
}

function isKnownForumImageHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return IMAGE_REQUEST_HEADER_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

export function isNodeSeekHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'nodeseek.com' || normalized.endsWith('.nodeseek.com');
}
