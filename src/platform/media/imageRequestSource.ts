import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';
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

const IMAGE_ACCEPT = 'image/avif,image/webp,image/*,*/*;q=0.8';
const FALLBACK_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_ACCEPT_LANGUAGE = defaultAcceptLanguage();

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
      Accept: IMAGE_ACCEPT,
      'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
      [FORUM_MEDIA_IDENTITY_HEADER]: forumMediaIdentityHeaderValue(options?.mediaContext),
      [FORUM_MEDIA_SOURCE_HEADER]: forumMediaSourceHeaderValue(options?.mediaContext)
    };
    const contentSource = options?.mediaContext?.contentSource;
    if (contentSource) {
      headers.Referer = `${new URL(sourceCatalog[contentSource].baseUrl).origin}/`;
    }
    const userAgent =
      (contentSource === 'nodeseek' ? String(options?.nodeSeekUserAgent || '').trim() : '') ||
      DEFAULT_NODESEEK_ANDROID_USER_AGENT;
    if (userAgent) {
      headers['User-Agent'] = userAgent;
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

function defaultAcceptLanguage() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.trim().replace(/_/g, '-');
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale)) {
      return FALLBACK_ACCEPT_LANGUAGE;
    }
    const language = locale.split('-')[0];
    return language.toLowerCase() === locale.toLowerCase() ? locale : `${locale},${language};q=0.9`;
  } catch {
    return FALLBACK_ACCEPT_LANGUAGE;
  }
}

export function isNodeSeekHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'nodeseek.com' || normalized.endsWith('.nodeseek.com');
}
