import { imageRequestHeadersForUrl, normalizeImagePreviewUrl } from './htmlImages';

type AvatarFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function loadRemoteAvatarSvgText(uri: string, fetcher: AvatarFetcher = fetch): Promise<string | null> {
  const clean = normalizeImagePreviewUrl(uri);
  if (!isNodeSeekAvatarUrl(clean)) {
    return null;
  }
  const headers = imageRequestHeadersForUrl(clean);
  try {
    const head = await fetcher(clean, {
      method: 'HEAD',
      headers
    });
    if (!isSvgContentType(head.headers.get('content-type'))) {
      return null;
    }
    const response = await fetcher(clean, {
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
  } catch {
    return null;
  }
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
