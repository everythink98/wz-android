import type { Category, FeedResponse, RepliesResponse, SearchResponse, Topic, TopicDetail } from './types';
import {
  absoluteUrl,
  accessRequirementFromText,
  elementText,
  parseHtml,
  parsePositiveInteger,
  sanitizeContentHtml,
  sortTopicsByTime,
  textContentFromHtml,
  textExcerpt
} from './localHtml';

const BASE_URL = 'https://yaohuo.me';
export const YAOHUO_LOGIN_URL = `${BASE_URL}/waplogin.aspx?siteid=1000`;
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

const categoryNames = new Map(YAOHUO_CATEGORIES.map((category) => [category.id, category.name]));

export function isYaohuoLoginRequiredHtml(html: string, responseUrl = '') {
  const visibleText = textContentFromHtml(html);
  return /waplogin\.aspx/i.test(responseUrl)
    || /身份失效了，请重新登录网站|请先登录网站/.test(html)
    || /访问验证|ImageCaptcha|Gocaptcha|CAPTCHA_CONFIG|请开启JavaScript并刷新该页/i.test(html)
    || /请先\s+登录/.test(visibleText);
}

function isVerificationRequiredHtml(html: string) {
  return /访问验证|ImageCaptcha|Gocaptcha|CAPTCHA_CONFIG|请开启JavaScript并刷新该页/i.test(html);
}

function loginRequiredError(reason = 'expired') {
  const error = new Error(reason === 'missing_cookie' ? '请先登录妖火' : reason === 'verification' ? '妖火需要完成访问验证，请在登录页完成验证后重试' : '妖火登录已失效，请重新登录');
  Object.assign(error, {
    source: 'yaohuo',
    loginRequired: true,
    reason,
    loginUrl: YAOHUO_LOGIN_URL
  });
  return error;
}

export function ensureYaohuoHtmlLoggedIn(html: string, responseUrl = '') {
  if (isYaohuoLoginRequiredHtml(html, responseUrl)) {
    throw loginRequiredError(isVerificationRequiredHtml(html) ? 'verification' : 'expired');
  }
}

function parseYaohuoDate(value: unknown) {
  const text = String(value || '').trim();
  const full = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  const partial = text.match(/(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  const beijingNow = new Date(Date.now() + 8 * 3600 * 1000);
  const currentYear = beijingNow.getUTCFullYear();
  const currentMonth = beijingNow.getUTCMonth() + 1;
  const parts = full ? full.slice(1) : partial ? [String(currentYear), ...partial.slice(1)] : null;
  if (!parts) {
    return '';
  }
  let [year, month, day, hour, minute] = parts.map(Number);
  if (!full && month > currentMonth) {
    year -= 1;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function extractTopicParts(href?: string) {
  const url = absoluteUrl(href, BASE_URL) || '';
  const id = url.match(/bbs-(\d+)\.html/i)?.[1]
    || url.match(/[?&]id=(\d+)/i)?.[1];
  const classId = url.match(/[?&]classid=(\d+)/i)?.[1];
  return { id, classId, url };
}

function parseListItem(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number], fallbackClassId = '177') {
  const link = element.querySelectorAll('a[href]').find((item) => {
    const href = item.getAttribute('href') || '';
    return elementText(item) && (/bbs-\d+\.html/i.test(href) || /view\.aspx/i.test(href) || (/[?&]id=\d+/i.test(href) && !/book_re\.aspx/i.test(href)));
  });
  const { id, classId, url } = extractTopicParts(link?.getAttribute('href'));
  if (!id) {
    return null;
  }
  const text = elementText(element);
  const title = elementText(link);
  const resolvedClassId = classId || fallbackClassId;
  const accessRequirement = accessRequirementFromText(text.replace(title, ' '));
  const replyCount = parsePositiveInteger(element.querySelectorAll('a').find((item) => /^\d+$/.test(elementText(item)))?.text);
  const viewCount = parsePositiveInteger(text.match(/阅\s*(\d+)/)?.[1] || text.match(/(\d+)\s*阅/)?.[1] || text.match(/\/\s*阅(\d+)/)?.[1]);
  const timeText = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
    || text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
    || '';
  const createdAt = parseYaohuoDate(timeText) || new Date().toISOString();
  const author = text.replace(title, '').split('/').map((part) => part.trim().replace(/^\d+\.\s*/, '')).find((part) => (
    part && !/^\d+$/.test(part) && !/阅\s*\d+/.test(part) && !/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/.test(part)
  )) || '';
  return {
    source: 'yaohuo' as const,
    id,
    title,
    author,
    categoryId: resolvedClassId,
    category: categoryNames.get(resolvedClassId),
    url: url || `${BASE_URL}/bbs-${id}.html`,
    createdAt,
    lastReplyAt: createdAt,
    replyCount,
    viewCount: viewCount || undefined,
    excerpt: textExcerpt(text),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function parseListDataChunks(html: string) {
  return [...html.matchAll(/<div\b[^>]*class=["'][^"']*\blistdata\b[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*\blistdata\b|<!--listE-->|$)/gi)]
    .map((match) => match[0]);
}

function parseCompactListItems(root: ReturnType<typeof parseHtml>, fallbackClassId = '177', limit = 30) {
  const items: Topic[] = [];
  const seen = new Set<string>();
  const fallbackCreatedAt = new Date().toISOString();
  for (const list of root.querySelectorAll('div.list, .list')) {
    for (const link of list.querySelectorAll('a[href]')) {
      const title = elementText(link);
      const { id, classId, url } = extractTopicParts(link.getAttribute('href'));
      if (!id || !title || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const resolvedClassId = classId || fallbackClassId;
      items.push({
        source: 'yaohuo',
        id,
        title,
        author: '',
        categoryId: resolvedClassId,
        category: categoryNames.get(resolvedClassId),
        url: url || `${BASE_URL}/bbs-${id}.html`,
        createdAt: fallbackCreatedAt,
        lastReplyAt: fallbackCreatedAt,
        replyCount: 0,
        excerpt: title
      });
      if (items.length >= limit) {
        return items;
      }
    }
  }
  return items;
}

function nextPageFromHtml(html: string, page: number, itemCount: number, limit: number) {
  if (!itemCount) {
    return null;
  }
  const root = parseHtml(html);
  const href = root.querySelectorAll('a[href]').find((link) => /下一页|下页/.test(elementText(link)))?.getAttribute('href') || '';
  const next = href.match(/[?&]page=(\d+)/i)?.[1];
  if (next) {
    return Number(next);
  }
  const total = parsePositiveInteger(root.querySelector('input[name="getTotal"], input#Action_getTotal')?.getAttribute('value'));
  return total && total > page * limit && itemCount ? page + 1 : null;
}

export function parseYaohuoListHtml(html: string, { classId = '177', limit = 30, page = 1, url }: { classId?: string; limit?: number; page?: number; url?: string } = {}): FeedResponse {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  let rows = root.querySelectorAll('.listdata');
  if (!rows.length) {
    rows = root.querySelectorAll('div.line1, div.line2');
  }
  const seen = new Set<string>();
  const items: Topic[] = [];
  for (const row of rows) {
    const item = parseListItem(row, classId) as Topic | null;
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
      if (items.length >= limit) {
        break;
      }
    }
  }
  for (const chunk of parseListDataChunks(html)) {
    if (items.length >= limit) {
      break;
    }
    const item = parseListItem(parseHtml(chunk), classId) as Topic | null;
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  if (!items.length) {
    items.push(...parseCompactListItems(root, classId, limit));
  }
  const nextPage = nextPageFromHtml(html, page, items.length, limit);
  return {
    items: sortTopicsByTime(items),
    errors: {},
    hasMore: Boolean(nextPage),
    nextPage
  };
}

function extractMarkedContent(html: string, start: string, end: string) {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? html.slice(startIndex + start.length, endIndex) : html;
}

function parseVoteOptions(html: string) {
  const root = parseHtml(html);
  const options: Array<{ id: string; label: string; count?: number }> = [];
  root.querySelectorAll('.toupiao').forEach((element) => {
    element.innerHTML.split(/<br\s*\/?>/i).forEach((line) => {
      const id = line.match(/[?&]vid=(\d+)/i)?.[1];
      const text = textContentFromHtml(line);
      if (!id || !text) {
        return;
      }
      const count = parsePositiveInteger(text.match(/\((\d+)\)\s*$/)?.[1]);
      const label = text.replace(/^\[[^\]]+\]\s*/, '').replace(/\(\d+\)\s*$/, '').trim();
      if (label) {
        options.push({ id, label, count });
      }
    });
  });
  return options;
}

function topicTitle(root: ReturnType<typeof parseHtml>) {
  const content = elementText(root.querySelector('div.content'));
  return content.match(/\[标题\]\s*(.*?)\s*\(阅/i)?.[1]?.trim()
    || elementText(root.querySelector('title')).replace(/[-_].*$/, '').trim();
}

export function parseYaohuoTopicHtml(html: string, { id, url }: { id: string; url?: string }): TopicDetail {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const bbsContent = root.querySelector('div.bbscontent')?.innerHTML || '';
  const contentHtml = extractMarkedContent(bbsContent, '<!--listS-->', '<!--listE-->');
  const contentText = elementText(root.querySelector('div.content'));
  const classId = root.querySelectorAll('a[href*="classid="]').map((link) => link.getAttribute('href')?.match(/[?&]classid=(\d+)/i)?.[1]).find(Boolean);
  const author = elementText(root.querySelector('div.subtitle a[href*="userinfo"], div.subtitle a[href*="touserid"]')) || elementText(root.querySelector('div.subtitle a'));
  const createdAt = parseYaohuoDate(contentText.match(/\[时间\]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2})/)?.[1]
    || contentText.match(/\[时间\]\s*(\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2})/)?.[1]
    || contentText.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]) || new Date().toISOString();
  const voteOptions = parseVoteOptions(html);
  return {
    source: 'yaohuo',
    id: String(id || ''),
    title: topicTitle(root) || '',
    author,
    categoryId: classId,
    category: classId ? categoryNames.get(classId) : undefined,
    url: url || `${BASE_URL}/bbs-${id}.html`,
    createdAt,
    lastReplyAt: createdAt,
    replyCount: parsePositiveInteger(html.match(/更多回帖\((\d+)\)/)?.[1]),
    viewCount: parsePositiveInteger(contentText.match(/\(阅\s*(\d+)\)/)?.[1]) || undefined,
    excerpt: textExcerpt(contentHtml),
    contentHtml: sanitizeContentHtml(contentHtml, BASE_URL),
    replies: [],
    ...(voteOptions.length ? { voteOptions } : {})
  };
}

function parseFloor(value: string) {
  const text = value.replace(/楼/g, '').trim();
  if (text === '沙发') return 1;
  if (text === '椅子') return 2;
  if (text === '板凳') return 3;
  const floor = Number(text);
  return Number.isInteger(floor) && floor > 0 ? floor : undefined;
}

export function parseYaohuoRepliesHtml(html: string, { page = 1, limit = 30, url }: { page?: number; limit?: number; url?: string } = {}): RepliesResponse {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const rows = root.querySelectorAll('div.line1, div.line2');
  const floorOffset = Math.max(0, page - 1) * limit;
  const items = rows.map((row, index) => {
    const rawHtml = row.innerHTML;
    const text = elementText(row);
    const floor = parseFloor(text.match(/\[(沙发|椅子|板凳|\d+楼?)\]/)?.[1] || '') || floorOffset + index + 1;
    const authorLink = row.querySelectorAll('a[href*="userinfo"]').at(-1);
    const actionLink = row.querySelector('a[href*="book_re.aspx"][href*="reply="], a[href*="book_re.aspx"][href*="touserid="]');
    const author = elementText(authorLink);
    const authorId = authorLink?.getAttribute('href')?.match(/[?&]touserid=(\d+)/i)?.[1]
      || actionLink?.getAttribute('href')?.match(/[?&]touserid=(\d+)/i)?.[1];
    const createdAt = parseYaohuoDate(text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
      || text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]) || new Date().toISOString();
    let contentOnly = rawHtml
      .replace(/^\s*\[\s*(?:<a\b[^>]*>)?\s*(沙发|椅子|板凳|\d+楼?)\s*(?:<\/a>)?\s*\]\s*/i, '')
      .replace(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}[\s\S]*$/i, '');
    const authorHtml = authorLink?.toString() || '';
    const authorIndex = authorHtml ? contentOnly.lastIndexOf(authorHtml) : -1;
    if (authorIndex >= 0) {
      contentOnly = contentOnly.slice(0, authorIndex);
    }
    return {
      author,
      ...(authorId ? { authorId } : {}),
      contentHtml: sanitizeContentHtml(contentOnly, BASE_URL),
      createdAt,
      floor
    };
  }).slice(0, limit);
  const nextPage = nextPageFromHtml(html, page, items.length, limit);
  return {
    items,
    hasMore: Boolean(nextPage),
    nextPage
  };
}

export function parseYaohuoSearchHtml(html: string, options: { page?: number; limit?: number; url?: string } = {}): SearchResponse {
  const result = parseYaohuoListHtml(html, { ...options, classId: '0' });
  return { items: result.items, errors: result.errors };
}

export function checkYaohuoLoginHtml(html: string, url?: string) {
  const loginRequired = isYaohuoLoginRequiredHtml(html, url);
  return {
    source: 'yaohuo' as const,
    ok: !loginRequired,
    loginRequired,
    reason: loginRequired ? (isVerificationRequiredHtml(html) ? 'verification' : 'expired') : undefined,
    loginUrl: YAOHUO_LOGIN_URL,
    message: loginRequired ? (isVerificationRequiredHtml(html) ? '妖火需要完成访问验证，请在登录页完成验证后重试' : '妖火登录已失效，请重新登录。') : undefined
  };
}

export function yaohuoCategoriesResponse() {
  return { items: YAOHUO_CATEGORIES, errors: {} };
}
