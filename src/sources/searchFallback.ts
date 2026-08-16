import { elementText, parseHtml } from '@/domain/forum/html';

export function googleSiteSearchUrl(site: string, query: string, page = 1) {
  const params = new URLSearchParams({ q: `site:${site} ${query}` });
  if (page > 1) {
    params.set('start', String((page - 1) * 10));
  }
  return `https://www.google.com/search?${params.toString()}`;
}

function hasSiteSearchToken(query: string, site: string) {
  const siteTokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.startsWith('site:'));
  return siteTokens.length === 1 && siteTokens[0] === `site:${site.toLowerCase()}`;
}

function hasOnlyGoogleSearchParams(url: URL) {
  const keys = [...url.searchParams.keys()];
  const starts = url.searchParams.getAll('start');
  return (
    url.searchParams.getAll('q').length === 1 &&
    starts.length <= 1 &&
    keys.every((key) => key === 'q' || key === 'start') &&
    (!starts.length || (/^\d+$/.test(starts[0]) && Number(starts[0]) % 10 === 0))
  );
}

const googleFlowTokenPattern = /^[a-z0-9_-]{1,256}$/i;

function safeGoogleUrl(input: string) {
  try {
    const value = String(input);
    const authorityStart = value.indexOf('://') + 3;
    const authorityEnd = value.slice(authorityStart).search(/[/?#\\]/);
    const authority =
      authorityEnd < 0 ? value.slice(authorityStart) : value.slice(authorityStart, authorityStart + authorityEnd);
    if (value !== value.trim() || !/^https:\/\//i.test(value) || authority.includes('@')) {
      return null;
    }
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      host === 'www.google.com'
      ? url
      : null;
  } catch {
    return null;
  }
}

function safeRejectedGoogleUrl(input: string) {
  try {
    const value = String(input);
    if (value !== value.trim() || !/^https:\/\//i.test(value)) return null;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (host === 'www.google.com' || host === 'consent.google.com' || host === 'accounts.google.com')
      ? url
      : null;
  } catch {
    return null;
  }
}

export function isGoogleSiteSearchUrl(input: string, site: string) {
  const url = safeGoogleUrl(input);
  return Boolean(
    url &&
    url.pathname.replace(/\/+$/, '') === '/search' &&
    hasOnlyGoogleSearchParams(url) &&
    hasSiteSearchToken(url.searchParams.get('q') || '', site)
  );
}

export function isSameGoogleSiteSearchUrl(input: string, site: string, initialSearchUrl: string) {
  const target = safeGoogleUrl(input);
  const initial = safeGoogleUrl(initialSearchUrl);
  if (!target || !initial || !isGoogleSiteSearchUrl(initial.href, site)) {
    return false;
  }
  const hasSessionToken = target.searchParams.has('sei');
  const expectedKeys = [
    'q',
    ...(initial.searchParams.has('start') ? ['start'] : []),
    ...(hasSessionToken ? ['sei'] : [])
  ];
  const keys = [...target.searchParams.keys()];
  return Boolean(
    target.origin === initial.origin &&
    target.pathname.replace(/\/+$/, '') === '/search' &&
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => target.searchParams.getAll(key).length === 1) &&
    keys.every((key) => expectedKeys.includes(key)) &&
    target.searchParams.get('q') === initial.searchParams.get('q') &&
    target.searchParams.get('start') === initial.searchParams.get('start') &&
    (!hasSessionToken || googleFlowTokenPattern.test(target.searchParams.get('sei') || ''))
  );
}

export function isGoogleSiteSearchAccessTroubleUrl(input: string, site: string, initialSearchUrl: string) {
  const target = safeGoogleUrl(input);
  const initial = safeGoogleUrl(initialSearchUrl);
  if (!target || !initial || !isGoogleSiteSearchUrl(initial.href, site)) {
    return false;
  }
  const expectedKeys = ['q', ...(initial.searchParams.has('start') ? ['start'] : []), 'sca_esv', 'emsg', 'sei'];
  const keys = [...target.searchParams.keys()];
  return (
    target.origin === initial.origin &&
    target.pathname.replace(/\/+$/, '') === '/search' &&
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => target.searchParams.getAll(key).length === 1) &&
    keys.every((key) => expectedKeys.includes(key)) &&
    target.searchParams.get('q') === initial.searchParams.get('q') &&
    target.searchParams.get('start') === initial.searchParams.get('start') &&
    target.searchParams.get('emsg') === 'SG_REL' &&
    googleFlowTokenPattern.test(target.searchParams.get('sca_esv') || '') &&
    googleFlowTokenPattern.test(target.searchParams.get('sei') || '')
  );
}

export function googleSiteSearchNavigationFailure(input: string, site: string, initialSearchUrl: string) {
  if (!isGoogleSiteSearchUrl(initialSearchUrl, site)) return null;
  const target = safeRejectedGoogleUrl(input);
  if (!target) return null;
  const facts = {
    navigationHost: target.hostname.toLowerCase(),
    navigationPath: target.pathname || '/',
    navigationParamKeys: [...new Set(target.searchParams.keys())].sort().join(',') || 'none'
  };
  if (isGoogleSiteSearchAccessTroubleUrl(input, site, initialSearchUrl)) {
    return {
      ...facts,
      navigationClass: 'access-trouble',
      reason: 'verification_required',
      message: 'Google 搜索环境验证暂时未通过，请稍后重试'
    } as const;
  }
  if (
    target.hostname === 'www.google.com' &&
    (/^\/sorry(?:\/|$)/i.test(target.pathname) || /(?:captcha|recaptcha)/i.test(target.pathname))
  ) {
    return {
      ...facts,
      navigationClass: 'captcha',
      reason: 'verification_required',
      message: 'Google 要求完成人机验证，已停止读取'
    } as const;
  }
  if (target.hostname === 'consent.google.com' || /^\/consent(?:\/|$)/i.test(target.pathname)) {
    return {
      ...facts,
      navigationClass: 'consent',
      reason: 'unsupported',
      message: 'Google 要求确认隐私设置，已停止读取'
    } as const;
  }
  if (target.hostname === 'accounts.google.com' || /^\/(?:accounts|signin)(?:\/|$)/i.test(target.pathname)) {
    return {
      ...facts,
      navigationClass: 'login',
      reason: 'login_required',
      message: 'Google 要求登录，已停止读取'
    } as const;
  }
  return {
    ...facts,
    navigationClass: 'unknown-google',
    reason: 'unsupported',
    message: 'Google 搜索流程已变化，已停止读取'
  } as const;
}

export function isGoogleSiteSearchNavigationUrl(input: string, site: string, initialSearchUrl: string) {
  const target = safeGoogleUrl(input);
  const initial = safeGoogleUrl(initialSearchUrl);
  if (!target || !initial || !isGoogleSiteSearchUrl(initial.href, site)) {
    return false;
  }
  if (isSameGoogleSiteSearchUrl(target.href, site, initial.href)) return true;
  const keys = target ? [...target.searchParams.keys()] : [];
  return Boolean(
    target.origin === initial.origin &&
    target.pathname === '/httpservice/retry/enablejs' &&
    keys.length === 1 &&
    keys[0] === 'sei' &&
    googleFlowTokenPattern.test(target.searchParams.get('sei') || '')
  );
}

export function googleResultTargetUrl(href: string) {
  try {
    const url = new URL(href, 'https://www.google.com');
    if ((url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) && url.pathname === '/url') {
      return url.searchParams.get('q') || url.searchParams.get('url') || '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function hasGoogleSiteSearchNextPage(root: ReturnType<typeof parseHtml>, site: string, nextPage: number) {
  const nextStart = (nextPage - 1) * 10;
  return root.querySelectorAll('a[href]').some((link) => {
    const href = link.getAttribute('href') || '';
    const label = elementText(link);
    const rel = String(link.getAttribute('rel') || '');
    if (!/next|下一|下页/i.test(`${rel} ${label}`) && !href.includes(`start=${nextStart}`)) {
      return false;
    }
    try {
      const url = new URL(href, 'https://www.google.com');
      return isGoogleSiteSearchUrl(url.toString(), site) && Number(url.searchParams.get('start') || 0) === nextStart;
    } catch {
      return false;
    }
  });
}

export function isGoogleSiteSearchResponse(root: ReturnType<typeof parseHtml>, site: string) {
  const title = elementText(root.querySelector('title')).toLowerCase();
  const siteText = site.toLowerCase();
  if (!title.includes('google') && !title.includes(`site:${siteText}`)) {
    return false;
  }
  return root.querySelectorAll('a[href]').some((link) => {
    const href = link.getAttribute('href') || '';
    try {
      const url = new URL(href, 'https://www.google.com');
      if (isGoogleSiteSearchUrl(url.toString(), site)) {
        return true;
      }
    } catch {
      // Keep checking the extracted result URL below.
    }
    return googleResultTargetUrl(href).toLowerCase().includes(siteText);
  });
}
