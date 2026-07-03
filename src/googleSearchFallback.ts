import { elementText, parseHtml } from './localHtml';

export function googleSiteSearchUrl(site: string, query: string, page = 1) {
  const params = new URLSearchParams({ q: `site:${site} ${query}` });
  if (page > 1) {
    params.set('start', String((page - 1) * 10));
  }
  return `https://www.google.com/search?${params.toString()}`;
}

function hasSiteSearchToken(query: string, site: string) {
  return query.toLowerCase().split(/\s+/).includes(`site:${site.toLowerCase()}`);
}

export function isGoogleSiteSearchUrl(input: string, site: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (host === 'google.com' || host.endsWith('.google.com'))
      && url.pathname.replace(/\/+$/, '') === '/search'
      && hasSiteSearchToken(url.searchParams.get('q') || '', site);
  } catch {
    return false;
  }
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

export function hasGoogleSiteSearchNextPage(html: string, site: string, nextPage: number) {
  const nextStart = (nextPage - 1) * 10;
  const root = parseHtml(html);
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

export function isGoogleSiteSearchResponse(html: string, site: string) {
  const root = parseHtml(html);
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
