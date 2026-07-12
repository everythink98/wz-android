import { Buffer } from 'buffer';

export interface NativeCookie {
  name?: string;
  value?: string;
  domain?: string;
}

export type NodeSeekAccessRecord = {
  cookieHeader: string;
  userAgent?: string;
  userId?: number;
  savedAt: string;
  source: 'webview';
};

export const NODESEEK_ACCESS_STORAGE_KEY = 'nodeseek-access';
export const NODESEEK_COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';
export const NODESEEK_USER_AGENT_STORAGE_KEY = 'nodeseek-user-agent';

export function sanitizeNodeSeekUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/;\s*wv(?=[;)])/i, '')
    .replace(/\s*Version\/4\.0\s*/i, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export const DEFAULT_NODESEEK_ANDROID_USER_AGENT = sanitizeNodeSeekUserAgent(
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
);

export const nodeSeekLoginCookieNames = ['session', 'connect.sid', 'sid'] as const;
const loginCookieNames = new Set<string>(nodeSeekLoginCookieNames);
const clearanceCookiePattern = /^cf_clearance$/i;
const pjwtCookiePattern = /^pjwt$/i;

function isNodeSeekLoginCookieName(name: string) {
  return loginCookieNames.has(name.toLowerCase());
}

function isNodeSeekDomain(domain?: string) {
  if (!domain) {
    return true;
  }
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'nodeseek.com' || normalized.endsWith('.nodeseek.com');
}

function isNodeSeekCookieSourceUrl(input?: string) {
  try {
    const url = new URL(String(input || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (host === 'nodeseek.com' || host.endsWith('.nodeseek.com'));
  } catch {
    return false;
  }
}

export function nodeSeekBrowserCookieHeaderForPersistence(url?: string, cookieHeader?: string) {
  return isNodeSeekCookieSourceUrl(url) ? String(cookieHeader || '') : '';
}

export function hasNodeSeekLoginCookie(cookies: Record<string, NativeCookie>) {
  return Object.entries(cookies).some(([key, cookie]) => {
    const name = cookie.name || key;
    return Boolean(cookie.value) && isNodeSeekDomain(cookie.domain) && isNodeSeekLoginCookieName(name);
  });
}

function hasNodeSeekClearanceCookie(cookies: Record<string, NativeCookie>) {
  return Object.entries(cookies).some(([key, cookie]) => {
    const name = cookie.name || key;
    return Boolean(cookie.value) && isNodeSeekDomain(cookie.domain) && clearanceCookiePattern.test(name);
  });
}

function isPersistableNodeSeekCookie(name: string, cookie?: NativeCookie) {
  if (!cookie?.value) {
    return false;
  }
  return isNodeSeekDomain(cookie.domain) && (clearanceCookiePattern.test(name) || isNodeSeekLoginCookieName(name));
}

function filterPersistableNodeSeekCookies(cookies: Record<string, NativeCookie>) {
  return Object.entries(cookies).reduce<Record<string, NativeCookie>>((kept, [key, cookie]) => {
    const name = cookie.name || key;
    if (isPersistableNodeSeekCookie(name, cookie)) {
      kept[key] = cookie;
    }
    return kept;
  }, {});
}

export function buildCookieHeader(cookies: Record<string, NativeCookie>) {
  return Object.entries(filterPersistableNodeSeekCookies(cookies))
    .map(([key, cookie]) => ({
      name: cookie.name || key,
      value: cookie.value || ''
    }))
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function parseNodeSeekDocumentCookie(cookieHeader?: string) {
  const parsed: Record<string, NativeCookie> = {};
  for (const segment of String(cookieHeader || '').split(';')) {
    const clean = segment.trim();
    const separator = clean.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = clean.slice(0, separator).trim();
    const value = clean.slice(separator + 1).trim();
    if (name && value) {
      parsed[name] = { name, value, domain: 'nodeseek.com' };
    }
  }
  return parsed;
}

export function buildNodeSeekSetCookieHeaders(cookieHeader: string) {
  return Object.entries(filterPersistableNodeSeekCookies(parseNodeSeekDocumentCookie(cookieHeader)))
    .map(([key, cookie]) => ({ name: cookie.name || key, value: cookie.value || '' }))
    .filter(({ name, value }) => Boolean(name && value))
    .map(({ name, value }) => `${name}=${value}; Domain=nodeseek.com; Path=/; Secure; HttpOnly; SameSite=Lax`);
}

export function canStoreNodeSeekCookieHeader(cookies: Record<string, NativeCookie>, verifiedByPage = false) {
  const cookieHeader = buildCookieHeader(cookies);
  if (!cookieHeader) {
    return false;
  }
  return verifiedByPage || hasNodeSeekLoginCookie(cookies) || hasNodeSeekClearanceCookie(cookies);
}

export function mergeNodeSeekCookies(...cookieMaps: Array<Record<string, NativeCookie>>) {
  return cookieMaps.reduce<Record<string, NativeCookie>>((merged, cookies) => ({
    ...merged,
    ...cookies
  }), {});
}

export function removeNodeSeekLoginCookies(cookies: Record<string, NativeCookie>) {
  return Object.entries(cookies).reduce<Record<string, NativeCookie>>((kept, [key, cookie]) => {
    const name = cookie.name || key;
    if (!isNodeSeekLoginCookieName(name)) {
      kept[key] = cookie;
    }
    return kept;
  }, {});
}

function positiveInteger(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function decodeNodeSeekPjwtPayload(token: string) {
  const firstPart = token.split('.')[0] || '';
  if (!firstPart) {
    return null;
  }
  try {
    const padded = firstPart.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - firstPart.length % 4) % 4);
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function nodeSeekUserIdFromCookies(cookies: Record<string, NativeCookie>) {
  const pjwt = Object.entries(cookies).find(([key, cookie]) => (
    pjwtCookiePattern.test(cookie.name || key)
    && isNodeSeekDomain(cookie.domain)
    && cookie.value
  ))?.[1]?.value;
  const payload = decodeNodeSeekPjwtPayload(String(pjwt || ''));
  return positiveInteger(payload?.id ?? payload?.uid ?? payload?.userId ?? payload?.user_id ?? payload?.member_id);
}

export function nodeSeekCredentialUserId(currentCookies: Record<string, NativeCookie>, savedCookies: Record<string, NativeCookie>, savedUserId?: number | null) {
  if (hasNodeSeekLoginCookie(currentCookies)) {
    return nodeSeekUserIdFromCookies(currentCookies) || null;
  }
  return nodeSeekUserIdFromCookies(savedCookies) || positiveInteger(savedUserId) || null;
}

export function nodeSeekAccessRecord(cookieHeader: string, userAgent?: string, userId?: number | null): NodeSeekAccessRecord {
  const cleanUserAgent = sanitizeNodeSeekUserAgent(userAgent);
  const cleanUserId = positiveInteger(userId);
  return {
    cookieHeader,
    savedAt: new Date().toISOString(),
    source: 'webview',
    ...(cleanUserAgent ? { userAgent: cleanUserAgent } : {}),
    ...(cleanUserId ? { userId: cleanUserId } : {})
  };
}

export function parseNodeSeekAccessRecord(raw?: string | null): NodeSeekAccessRecord | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<NodeSeekAccessRecord>;
    if (!parsed.cookieHeader || parsed.source !== 'webview') {
      return null;
    }
    return {
      cookieHeader: parsed.cookieHeader,
      savedAt: typeof parsed.savedAt === 'string' && parsed.savedAt ? parsed.savedAt : new Date(0).toISOString(),
      source: 'webview',
      ...(parsed.userAgent ? { userAgent: sanitizeNodeSeekUserAgent(parsed.userAgent) } : {}),
      ...(positiveInteger(parsed.userId) ? { userId: positiveInteger(parsed.userId) } : {})
    };
  } catch {
    return null;
  }
}

export function summarizeNodeSeekCookies(cookies: Record<string, NativeCookie>) {
  const names = Object.entries(filterPersistableNodeSeekCookies(cookies))
    .filter(([, cookie]) => Boolean(cookie.value))
    .map(([key, cookie]) => cookie.name || key)
    .sort((left, right) => left.localeCompare(right));

  return {
    count: names.length,
    names,
    loggedIn: hasNodeSeekLoginCookie(cookies)
  };
}
