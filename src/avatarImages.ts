import { imageRequestHeadersForUrl, normalizeImagePreviewUrl } from './htmlImages';

type AvatarFetcher = (input: string, init?: RequestInit) => Promise<Response>;
const RETRY_LATER_AVATAR_RESULT = Symbol('retry-later-avatar-result');
const AVATAR_SVG_TEXT_CACHE_LIMIT = 200;
const avatarSvgTextCache = new Map<string, Promise<string | null>>();

export async function loadRemoteAvatarSvgText(uri: string, fetcher: AvatarFetcher = fetch): Promise<string | null> {
  const clean = normalizeImagePreviewUrl(uri);
  if (!isNodeSeekAvatarUrl(clean)) {
    return null;
  }
  const cached = avatarSvgTextCache.get(clean);
  if (cached) {
    return cached;
  }
  const request = Promise.resolve()
    .then(() => loadRemoteAvatarSvgTextUncached(clean, fetcher))
    .then((result) => {
      if (result === RETRY_LATER_AVATAR_RESULT) {
        avatarSvgTextCache.delete(clean);
        return null;
      }
      return result;
    })
    .catch(() => {
      avatarSvgTextCache.delete(clean);
      return null;
    });
  rememberAvatarSvgTextRequest(clean, request);
  return request;
}

async function loadRemoteAvatarSvgTextUncached(uri: string, fetcher: AvatarFetcher) {
  const headers = imageRequestHeadersForUrl(uri);
  const head = await fetcher(uri, {
    method: 'HEAD',
    headers
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
  const response = await fetcher(uri, {
    headers: {
      ...headers,
      Accept: 'image/svg+xml,image/*,*/*;q=0.8'
    }
  });
  if (!response.ok) {
    return RETRY_LATER_AVATAR_RESULT;
  }
  const text = await response.text();
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
