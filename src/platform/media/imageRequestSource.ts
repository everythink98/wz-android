import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
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
  referrerPolicy?: MediaReferrerPolicy;
};

export type ImageSourceOptions = ImageRequestOptions & {
  baseSource?: unknown;
};

const IMAGE_ACCEPT = 'image/avif,image/webp,image/*,*/*;q=0.8';
const VIDEO_ACCEPT = 'video/webm,video/mp4,video/*,*/*;q=0.8';
const AUDIO_ACCEPT = 'audio/mpeg,audio/*,*/*;q=0.8';
const FORUM_MEDIA_KIND_HEADER = 'X-WZ-Forum-Media-Kind';
const READ_NETWORK_GENERATION_HEADER = 'X-WZ-Read-Network-Generation';
const FALLBACK_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_ACCEPT_LANGUAGE = defaultAcceptLanguage();
const DEFAULT_REFERRER_POLICY: MediaReferrerPolicy = 'strict-origin-when-cross-origin';

function cleanReferrerUrl(value: unknown) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function referrerForParsedMediaUrls(targetUrl: URL, documentUrl: URL, policy: MediaReferrerPolicy) {
  const sameOrigin = documentUrl.origin === targetUrl.origin;
  const downgrade = documentUrl.protocol === 'https:' && targetUrl.protocol === 'http:';
  const fullReferrer = documentUrl.toString();
  const originReferrer = `${documentUrl.origin}/`;
  switch (policy) {
    case 'no-referrer':
      return undefined;
    case 'no-referrer-when-downgrade':
      return downgrade ? undefined : fullReferrer;
    case 'origin':
      return originReferrer;
    case 'origin-when-cross-origin':
      return sameOrigin ? fullReferrer : originReferrer;
    case 'same-origin':
      return sameOrigin ? fullReferrer : undefined;
    case 'strict-origin':
      return downgrade ? undefined : originReferrer;
    case 'strict-origin-when-cross-origin':
      return sameOrigin ? fullReferrer : downgrade ? undefined : originReferrer;
    case 'unsafe-url':
      return fullReferrer;
  }
}

function referrerForMediaUrl(targetUrl: URL, options: ImageRequestOptions) {
  const context = options.mediaContext?.referrer;
  if (!context) {
    const contentSource = options.mediaContext?.contentSource;
    return contentSource ? `${new URL(sourceCatalog[contentSource].baseUrl).origin}/` : undefined;
  }
  const documentUrl = cleanReferrerUrl(context.documentUrl);
  if (!documentUrl) {
    return undefined;
  }
  const policy =
    normalizeMediaReferrerPolicy(options.referrerPolicy) ||
    normalizeMediaReferrerPolicy(context.documentPolicy) ||
    DEFAULT_REFERRER_POLICY;
  return referrerForParsedMediaUrls(targetUrl, documentUrl, policy);
}

export function createImageRequestReferrerResolver(mediaContext: ForumMediaRequestContext) {
  const context = mediaContext.referrer;
  const documentUrl = context ? cleanReferrerUrl(context.documentUrl) : null;
  const contentSource = mediaContext.contentSource;
  const defaultReferrer =
    !context && contentSource ? `${new URL(sourceCatalog[contentSource].baseUrl).origin}/` : undefined;
  return (url: string, referrerPolicy?: MediaReferrerPolicy) => {
    const targetUrl = cleanReferrerUrl(url);
    if (!targetUrl) return undefined;
    if (!context) return defaultReferrer;
    if (!documentUrl) return undefined;
    const policy =
      normalizeMediaReferrerPolicy(referrerPolicy) ||
      normalizeMediaReferrerPolicy(context.documentPolicy) ||
      DEFAULT_REFERRER_POLICY;
    return referrerForParsedMediaUrls(targetUrl, documentUrl, policy);
  };
}

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
    const referrer = referrerForMediaUrl(parsed, options);
    if (referrer) {
      headers.Referer = referrer;
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
  const headers = imageRequestHeadersForUrl(clean, options);
  const mediaSessionIdentity = options?.mediaContext?.sessionIdentity || '';
  if (mediaSessionIdentity && /^https?:\/\//i.test(clean)) {
    const referrerIdentity = options.mediaContext.referrer ? `:referrer:${headers?.Referer || 'none'}` : '';
    base.cacheKey = `${mediaSessionIdentity}:${clean}${referrerIdentity}`;
  }
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

export function forumMediaPlayerSourceFromUrl(
  url: string,
  options: ImageRequestOptions & { kind: 'audio' | 'video'; runtimeGeneration: number }
) {
  const headers = {
    ...(imageRequestHeadersForUrl(url, options) || {}),
    Accept: options.kind === 'audio' ? AUDIO_ACCEPT : VIDEO_ACCEPT,
    [FORUM_MEDIA_KIND_HEADER]: 'video',
    [READ_NETWORK_GENERATION_HEADER]: String(options.runtimeGeneration)
  };
  return {
    uri: url,
    ...(Object.keys(headers).length ? { headers } : {}),
    contentType: 'progressive' as const
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
