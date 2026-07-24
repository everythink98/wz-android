import { imageRequestHeadersForUrl, normalizeImagePreviewUrl } from './htmlImages';
import { fetchWithTimeout } from './request';

type AvatarFetcher = (input: string, init?: RequestInit) => Promise<Response>;
type AvatarLoadOptions = {
  cacheIdentity?: string;
  signal?: AbortSignal;
};
const RETRY_LATER_AVATAR_RESULT = Symbol('retry-later-avatar-result');
const AVATAR_SVG_TEXT_CACHE_LIMIT = 200;
const AVATAR_SVG_TIMEOUT_MS = 4000;
const MAX_AVATAR_SVG_TEXT_BYTES = 64 * 1024;
const avatarSvgTextCache = new Map<string, Promise<string | null>>();
let defaultAvatarFetcher: AvatarFetcher = fetch;

export function setDefaultAvatarFetcher(fetcher: AvatarFetcher) {
  defaultAvatarFetcher = fetcher;
  return () => {
    if (defaultAvatarFetcher === fetcher) {
      defaultAvatarFetcher = fetch;
    }
  };
}

export async function loadRemoteAvatarSvgText(uri: string, fetcher: AvatarFetcher = defaultAvatarFetcher, options: AvatarLoadOptions = {}): Promise<string | null> {
  const clean = normalizeImagePreviewUrl(uri);
  if (!isNodeSeekAvatarUrl(clean)) {
    return null;
  }
  if (options.signal) {
    try {
      const result = await loadRemoteAvatarSvgTextUncached(clean, fetcher, options);
      return result === RETRY_LATER_AVATAR_RESULT ? null : result;
    } catch {
      return null;
    }
  }
  const cacheKey = options.cacheIdentity
    ? `${options.cacheIdentity}:${clean}`
    : clean;
  const cached = avatarSvgTextCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const request = Promise.resolve()
    .then(() => loadRemoteAvatarSvgTextUncached(clean, fetcher))
    .then((result) => {
      if (result === RETRY_LATER_AVATAR_RESULT) {
        avatarSvgTextCache.delete(cacheKey);
        return null;
      }
      return result;
    })
    .catch(() => {
      avatarSvgTextCache.delete(cacheKey);
      return null;
    });
  rememberAvatarSvgTextRequest(cacheKey, request);
  return request;
}

async function loadRemoteAvatarSvgTextUncached(uri: string, fetcher: AvatarFetcher, options: AvatarLoadOptions = {}) {
  const headers = imageRequestHeadersForUrl(uri);
  const head = await fetchWithTimeout(uri, {
    method: 'HEAD',
    headers
  }, {
    fetcher,
    signal: options.signal,
    timeoutMs: AVATAR_SVG_TIMEOUT_MS
  });
  if (!head.ok) {
    return RETRY_LATER_AVATAR_RESULT;
  }
  const headType = head.headers.get('content-type');
  if (isBitmapContentType(headType)) {
    return null;
  }
  if (headType && !isSvgContentType(headType)) {
    return RETRY_LATER_AVATAR_RESULT;
  }
  const contentLength = headerNumber(head.headers.get('content-length'));
  if (contentLength && contentLength > MAX_AVATAR_SVG_TEXT_BYTES) {
    return RETRY_LATER_AVATAR_RESULT;
  }
  const response = await fetchWithTimeout(uri, {
    headers: {
      ...headers,
      Accept: 'image/svg+xml,image/*,*/*;q=0.8'
    }
  }, {
    fetcher,
    signal: options.signal,
    timeoutMs: AVATAR_SVG_TIMEOUT_MS
  });
  if (!response.ok) {
    return RETRY_LATER_AVATAR_RESULT;
  }
  const responseLength = headerNumber(response.headers.get('content-length'));
  if (responseLength && responseLength > MAX_AVATAR_SVG_TEXT_BYTES) {
    return RETRY_LATER_AVATAR_RESULT;
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_AVATAR_SVG_TEXT_BYTES) {
    return RETRY_LATER_AVATAR_RESULT;
  }
  if (/<svg[\s>]/i.test(text)) {
    return text;
  }
  return isBitmapContentType(response.headers.get('content-type')) ? null : RETRY_LATER_AVATAR_RESULT;
}

function rememberAvatarSvgTextRequest(uri: string, request: Promise<string | null>) {
  if (avatarSvgTextCache.size >= AVATAR_SVG_TEXT_CACHE_LIMIT) {
    const firstKey = avatarSvgTextCache.keys().next().value;
    if (firstKey) {
      avatarSvgTextCache.delete(firstKey);
    }
  }
  avatarSvgTextCache.set(uri, request);
}

function isNodeSeekAvatarUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (host === 'nodeseek.com' || host.endsWith('.nodeseek.com'))
      && /^\/avatar\/\d+\.png$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isSvgContentType(value: string | null) {
  return /(?:^|;|\s)(?:image|application)\/svg\+xml(?:;|\s|$)/i.test(value || '');
}

function isBitmapContentType(value: string | null) {
  return /(?:^|;|\s)image\/(?:png|jpe?g|webp|gif|avif|bmp)(?:;|\s|$)/i.test(value || '');
}

function headerNumber(value: string | null) {
  const number = value ? Number(value) : 0;
  return Number.isFinite(number) && number > 0 ? number : 0;
}
