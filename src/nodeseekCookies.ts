export interface NativeCookie {
  name?: string;
  value?: string;
  domain?: string;
}

const loginCookiePattern = /(session|auth|token|jwt|user|sid)/i;

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

export function canStoreNodeSeekCookieHeader(cookies: Record<string, NativeCookie>, verifiedByPage = false) {
  const cookieHeader = buildCookieHeader(cookies);
  if (!cookieHeader) {
    return false;
  }
  return verifiedByPage || hasNodeSeekLoginCookie(cookies);
}

export function mergeNodeSeekCookies(...cookieMaps: Array<Record<string, NativeCookie>>) {
  return cookieMaps.reduce<Record<string, NativeCookie>>((merged, cookies) => ({
    ...merged,
    ...cookies
  }), {});
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
