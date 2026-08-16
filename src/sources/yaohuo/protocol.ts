import type { Category } from '@/domain/forum/models';
import { absoluteUrl, elementText, parseHtml, parsePositiveInteger } from '@/domain/forum/html';

export const YAOHUO_BASE_URL = 'https://www.yaohuo.me';
export const YAOHUO_LOGIN_URL = `${YAOHUO_BASE_URL}/waplogin.aspx?siteid=1000`;
export const YAOHUO_BBS_REFERER = `${YAOHUO_BASE_URL}/bbs/`;
export const YAOHUO_CATEGORIES: Category[] = [
  { source: 'yaohuo', id: '177', name: '妖火茶馆' },
  { source: 'yaohuo', id: '213', name: '悬赏问答' },
  { source: 'yaohuo', id: '201', name: '资源分享' },
  { source: 'yaohuo', id: '197', name: '综合技术' },
  { source: 'yaohuo', id: '204', name: '有奖活动' },
  { source: 'yaohuo', id: '203', name: '免流分享' },
  { source: 'yaohuo', id: '240', name: '贴图晒照' },
  { source: 'yaohuo', id: '198', name: '投诉建议' },
  { source: 'yaohuo', id: '199', name: '站务处理' },
  { source: 'yaohuo', id: '288', name: '网站公告' }
];

function isYaohuoHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'www.yaohuo.me';
}

function normalizeYaohuoUrl(url: URL) {
  url.hostname = 'www.yaohuo.me';
  return url.toString();
}

export function isYaohuoRequestUrl(url: string, baseUrl = YAOHUO_BASE_URL) {
  try {
    const parsed = new URL(url, baseUrl);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && isYaohuoHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function requireYaohuoRequestUrl(url: string, baseUrl = YAOHUO_BASE_URL) {
  try {
    const parsed = new URL(url, baseUrl);
    if (!isYaohuoRequestUrl(parsed.toString(), baseUrl)) {
      throw new Error('妖火链接不属于 www.yaohuo.me');
    }
    return normalizeYaohuoUrl(parsed);
  } catch {
    throw new Error('妖火链接不属于 www.yaohuo.me');
  }
}

export function extractYaohuoTopicParts(href?: string) {
  const url = absoluteUrl(href, YAOHUO_BASE_URL) || '';
  try {
    if (url && !isYaohuoHost(new URL(url).hostname)) {
      return { id: undefined, classId: undefined, url: '' };
    }
  } catch {
    return { id: undefined, classId: undefined, url: '' };
  }
  const id = url.match(/bbs-(\d+)\.html/i)?.[1] || url.match(/[?&]id=(\d+)/i)?.[1];
  const classId = url.match(/[?&]classid=(\d+)/i)?.[1];
  return { id, classId, url: url ? normalizeYaohuoUrl(new URL(url)) : '' };
}

export function yaohuoUserUrl(id: string) {
  return `${YAOHUO_BASE_URL}/bbs/userinfo.aspx?touserid=${encodeURIComponent(id)}`;
}

export function extractYaohuoUserIdFromHref(href?: string) {
  return (
    String(href || '').match(/[?&]touserid=(\d+)/i)?.[1] ||
    String(href || '').match(/[?&]userid=(\d+)/i)?.[1] ||
    String(href || '').match(/userinfo(?:\.aspx)?\/?(\d+)/i)?.[1]
  );
}

function nextYaohuoPageHref(root: ReturnType<typeof parseHtml>, acceptsHref: (href: string) => boolean = () => true) {
  return (
    root
      .querySelectorAll('a[href]')
      .filter((link) => /^(下一页|下页)$/.test(elementText(link)))
      .map((link) => link.getAttribute('href') || '')
      .find((href) => /[?&]page=\d+/i.test(href) && acceptsHref(href)) || ''
  );
}

export function nextYaohuoPage(root: ReturnType<typeof parseHtml>, page: number, itemCount: number, limit: number) {
  if (!itemCount) {
    return null;
  }
  const next = nextYaohuoPageHref(root).match(/[?&]page=(\d+)/i)?.[1];
  if (next) {
    return Number(next);
  }
  const total = parsePositiveInteger(
    root.querySelector('input[name="getTotal"], input#Action_getTotal')?.getAttribute('value')
  );
  return total && total > page * limit && itemCount ? page + 1 : null;
}

function queryValue(url: URL, name: string) {
  for (const [key, value] of url.searchParams.entries()) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }
  return '';
}

function isYaohuoUserTopicListUrl(url: URL, userId: string) {
  return (
    /\/bbs\/book_list(?:_search)?\.aspx$/i.test(url.pathname) &&
    queryValue(url, 'action').toLowerCase() === 'search' &&
    queryValue(url, 'type').toLowerCase() === 'pub' &&
    queryValue(url, 'key') === userId
  );
}

function isYaohuoUserReplyListUrl(url: URL, userId: string) {
  return /\/bbs\/book_re_my\.aspx$/i.test(url.pathname) && queryValue(url, 'touserid') === userId;
}

export function yaohuoUserProfileTopicListUrlFromRoot(
  root: ReturnType<typeof parseHtml>,
  userId: string,
  currentUrl = YAOHUO_BASE_URL
) {
  const href =
    root
      .querySelectorAll('a[href]')
      .find((link) => {
        const text = elementText(link);
        const rawHref = link.getAttribute('href') || '';
        return /贴子|帖子|发帖/.test(text) && /book_list(?:_search)?\.aspx/i.test(rawHref);
      })
      ?.getAttribute('href') || '';
  const nextUrl = absoluteUrl(href, currentUrl);
  if (!nextUrl) {
    return '';
  }
  try {
    const parsed = new URL(nextUrl);
    if (!isYaohuoHost(parsed.hostname) || !isYaohuoUserTopicListUrl(parsed, userId)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function yaohuoUserProfileReplyListUrlFromRoot(
  root: ReturnType<typeof parseHtml>,
  userId: string,
  currentUrl = YAOHUO_BASE_URL
) {
  const href =
    root
      .querySelectorAll('a[href]')
      .find((link) => {
        const text = elementText(link);
        const rawHref = link.getAttribute('href') || '';
        return /回帖|回复/.test(text) && /book_re_my\.aspx/i.test(rawHref);
      })
      ?.getAttribute('href') || '';
  const nextUrl = absoluteUrl(href, currentUrl);
  if (!nextUrl) {
    return '';
  }
  try {
    const parsed = new URL(nextUrl);
    if (!isYaohuoHost(parsed.hostname) || !isYaohuoUserReplyListUrl(parsed, userId)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function yaohuoTopicListNextPageUrlFromRoot(
  root: ReturnType<typeof parseHtml>,
  currentUrl: string,
  page: number,
  itemCount: number,
  limit = 30
) {
  if (!itemCount) {
    return '';
  }
  const href = nextYaohuoPageHref(root, (candidate) => /\/bbs\/book_list(?:_search)?\.aspx/i.test(candidate));
  const linkedUrl = absoluteUrl(href, currentUrl);
  if (linkedUrl) {
    try {
      return requireYaohuoRequestUrl(linkedUrl, currentUrl);
    } catch {
      return '';
    }
  }
  const nextPage = nextYaohuoPage(root, page, itemCount, limit);
  if (!nextPage) {
    return '';
  }
  try {
    const parsed = new URL(currentUrl);
    parsed.searchParams.set('page', String(nextPage));
    return parsed.toString();
  } catch {
    return '';
  }
}

export function yaohuoReplyListNextPageUrlFromRoot(
  root: ReturnType<typeof parseHtml>,
  currentUrl: string,
  itemCount: number
) {
  if (!itemCount) {
    return '';
  }
  const href = nextYaohuoPageHref(root, (candidate) => /\/bbs\/book_re_my\.aspx/i.test(candidate));
  const linkedUrl = absoluteUrl(href, currentUrl);
  if (!linkedUrl) {
    return '';
  }
  try {
    return requireYaohuoRequestUrl(linkedUrl, currentUrl);
  } catch {
    return '';
  }
}
