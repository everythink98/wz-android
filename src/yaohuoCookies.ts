export interface YaohuoNativeCookie {
  name?: string;
  value?: string;
  domain?: string;
  secure?: boolean;
}

const loginCookieName = 'sidyaohuo';
const keptCookieNames = new Set(['sidyaohuo', 'ASP.NET_SessionId', 'GUID']);

export function sanitizeYaohuoCookieHeader(cookieHeader?: string | null) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex <= 0) {
        return false;
      }
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      return keptCookieNames.has(name) && Boolean(value);
    })
    .join('; ');
}

function isYaohuoDomain(domain?: string) {
  if (!domain) {
    return true;
  }
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'yaohuo.me' || normalized === 'www.yaohuo.me';
}

function normalizedCookieEntries(cookies: Record<string, YaohuoNativeCookie>) {
  return Object.entries(cookies)
    .map(([key, cookie]) => ({
      name: cookie.name || key,
      value: cookie.value || '',
      domain: cookie.domain,
      secure: cookie.secure
    }))
    .filter((cookie) => (
      cookie.name
      && cookie.value
      && keptCookieNames.has(cookie.name)
      && isYaohuoDomain(cookie.domain)
    ));
}

function hasYaohuoLoginCookie(cookies: Record<string, YaohuoNativeCookie>) {
  return normalizedCookieEntries(cookies).some((cookie) => cookie.name === loginCookieName);
}

export function buildYaohuoCookieHeader(cookies: Record<string, YaohuoNativeCookie>) {
  return normalizedCookieEntries(cookies)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function yaohuoCookieMapFromHeader(cookieHeader: string) {
  const cookies: Record<string, YaohuoNativeCookie> = {};
  for (const cookiePart of sanitizeYaohuoCookieHeader(cookieHeader).split(';')) {
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (name && value) {
      cookies[name] = { name, value, domain: 'www.yaohuo.me', secure: true };
    }
  }
  return cookies;
}

export function canStoreYaohuoCookieHeader(cookies: Record<string, YaohuoNativeCookie>) {
  return Boolean(buildYaohuoCookieHeader(cookies));
}

export function mergeYaohuoCookies(...cookieMaps: Array<Record<string, YaohuoNativeCookie>>) {
  return cookieMaps.reduce<Record<string, YaohuoNativeCookie>>((merged, cookies) => {
    for (const [key, cookie] of Object.entries(cookies)) {
      const current = merged[key];
      if (current?.secure && cookie.secure === false) {
        continue;
      }
      merged[key] = cookie;
    }
    return merged;
  }, {});
}

export function summarizeYaohuoCookies(cookies: Record<string, YaohuoNativeCookie>) {
  const names = normalizedCookieEntries(cookies)
    .map((cookie) => cookie.name)
    .sort((left, right) => left.localeCompare(right));

  return {
    count: names.length,
    names,
    loggedIn: hasYaohuoLoginCookie(cookies)
  };
}
