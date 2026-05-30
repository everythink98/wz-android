export interface YaohuoNativeCookie {
  name?: string;
  value?: string;
  domain?: string;
}

const loginCookieName = 'sidyaohuo';
const keptCookieNames = new Set(['sidyaohuo', 'ASP.NET_SessionId', 'GUID']);

function isYaohuoDomain(domain?: string) {
  if (!domain) {
    return true;
  }
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'yaohuo.me' || normalized.endsWith('.yaohuo.me');
}

function normalizedCookieEntries(cookies: Record<string, YaohuoNativeCookie>) {
  return Object.entries(cookies)
    .map(([key, cookie]) => ({
      name: cookie.name || key,
      value: cookie.value || '',
      domain: cookie.domain
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

export function buildYaohuoSetCookieHeaders(cookieHeader: string) {
  const cookies = new Map<string, string>();

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (keptCookieNames.has(name) && value) {
      cookies.set(name, value);
    }
  }

  return Array.from(cookies.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}; Domain=yaohuo.me; Path=/`);
}

export function canStoreYaohuoCookieHeader(cookies: Record<string, YaohuoNativeCookie>) {
  return Boolean(buildYaohuoCookieHeader(cookies));
}

export function mergeYaohuoCookies(...cookieMaps: Array<Record<string, YaohuoNativeCookie>>) {
  return cookieMaps.reduce<Record<string, YaohuoNativeCookie>>((merged, cookies) => ({
    ...merged,
    ...cookies
  }), {});
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
