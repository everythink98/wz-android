import { imageRequestHeadersForUrl, normalizeImagePreviewUrl } from './htmlImages';

type AvatarFetcher = (input: string, init?: RequestInit) => Promise<Response>;
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
  if (!isSvgContentType(head.headers.get('content-type'))) {
    return null;
  }
  const response = await fetcher(uri, {
    headers: {
      ...headers,
      Accept: 'image/svg+xml,image/*,*/*;q=0.8'
    }
  });
  if (!response.ok) {
    return null;
  }
  const text = await response.text();
  return /<svg[\s>]/i.test(text) ? text : null;
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
