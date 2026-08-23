import { absoluteUrl } from '@/domain/forum/html';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';

export const V2EX_BASE_URL: string = sourceCatalog.v2ex.baseUrl;
export const SOV2EX_URL = 'https://www.sov2ex.com';

export function isV2exHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'v2ex.com' || host.endsWith('.v2ex.com');
}

export function safeV2exTopicUrl(id: string, raw?: unknown) {
  const fallback = `${V2EX_BASE_URL}/t/${id}`;
  const url = absoluteUrl(raw, V2EX_BASE_URL) || fallback;
  try {
    return isV2exHost(new URL(url).hostname) ? url : fallback;
  } catch {
    return fallback;
  }
}

export function v2exMemberUrl(username: string) {
  return `${V2EX_BASE_URL}/member/${encodeURIComponent(username)}`;
}

export function v2exNodeIdFromHref(href?: string) {
  const match = String(href || '').match(/\/go\/([^/?#]+)/);
  if (!match) {
    return undefined;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function safeV2exNodePath(category?: string) {
  if (!category) {
    return '/recent';
  }
  return /^[a-zA-Z0-9_-]+$/.test(category) ? `/go/${category}` : null;
}
