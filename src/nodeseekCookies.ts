export interface NativeCookie {
  name?: string;
  value?: string;
  domain?: string;
}

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

const loginCookiePattern = /(session|auth|token|jwt|user|sid)/i;
const clearanceCookiePattern = /^cf_clearance$/i;

function isNodeSeekDomain(domain?: string) {
  if (!domain) {
    return true;
  }
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'nodeseek.com' || normalized.endsWith('.nodeseek.com');
}

export function hasNodeSeekLoginCookie(cookies: Record<string, NativeCookie>) {
  return Object.entries(cookies).some(([key, cookie]) => {
    const name = cookie.name || key;
    return Boolean(cookie.value) && isNodeSeekDomain(cookie.domain) && loginCookiePattern.test(name);
  });
}

export function hasNodeSeekClearanceCookie(cookies: Record<string, NativeCookie>) {
  return Object.entries(cookies).some(([key, cookie]) => {
    const name = cookie.name || key;
    return Boolean(cookie.value) && isNodeSeekDomain(cookie.domain) && clearanceCookiePattern.test(name);
  });
}

export function buildCookieHeader(cookies: Record<string, NativeCookie>) {
  return Object.entries(cookies)
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
    if (!loginCookiePattern.test(name)) {
      kept[key] = cookie;
    }
    return kept;
  }, {});
}

export function summarizeNodeSeekCookies(cookies: Record<string, NativeCookie>) {
  const names = Object.entries(cookies)
    .filter(([, cookie]) => Boolean(cookie.value))
    .map(([key, cookie]) => cookie.name || key)
    .sort((left, right) => left.localeCompare(right));

  return {
    count: names.length,
    names,
    loggedIn: hasNodeSeekLoginCookie(cookies)
  };
}
