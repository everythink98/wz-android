import type { HTMLElement } from 'node-html-parser';
import type { Category, FeedResponse, RepliesResponse, SearchResponse, Topic, TopicDetail, TopicPoll, TopicPollOption, UserProfile } from './types';
import {
  absoluteUrl,
  accessRequirementFromText,
  elementText,
  parseHtml,
  parsePositiveInteger,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  sortTopicsByTime,
  textContentFromHtml,
  textExcerpt
} from './localHtml';
import {
  YAOHUO_BASE_URL as BASE_URL,
  YAOHUO_CATEGORIES,
  YAOHUO_LOGIN_URL,
  extractYaohuoTopicParts as extractTopicParts,
  extractYaohuoUserIdFromHref as extractUserIdFromHref,
  nextYaohuoPageFromHtml as nextPageFromHtml,
  yaohuoTopicListNextPageUrl,
  yaohuoUserProfileTopicListUrl,
  yaohuoUserUrl as userUrl
} from './localYaohuoHelpers';

export { YAOHUO_CATEGORIES, YAOHUO_LOGIN_URL, yaohuoTopicListNextPageUrl, yaohuoUserProfileTopicListUrl } from './localYaohuoHelpers';

const categoryNames = new Map(YAOHUO_CATEGORIES.map((category) => [category.id, category.name]));
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

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
  const beijingNow = new Date(Date.now() + BEIJING_OFFSET_MS);
  const currentYear = beijingNow.getUTCFullYear();
  const currentMonth = beijingNow.getUTCMonth() + 1;
  const currentDay = beijingNow.getUTCDate();
  const relative = parseYaohuoRelativeDate(text, {
    year: currentYear,
    month: currentMonth,
    day: currentDay
  });
  const parts = full ? full.slice(1) : partial ? [String(currentYear), ...partial.slice(1)] : null;
  if (relative) {
    return relative;
  }
  if (!parts) {
    return '';
  }
  let [year, month, day, hour, minute] = parts.map(Number);
  if (!full && month > currentMonth) {
    year -= 1;
  }
  const date = beijingDateToIso(year, month, day, hour, minute);
  return date || '';
}

function beijingDateToIso(year: number, month: number, day: number, hour: number, minute: number) {
  const date = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function parseYaohuoRelativeDate(text: string, now: { year: number; month: number; day: number }) {
  const dayAndTime = text.match(/(今天|昨天|前天)\s*(?:(午夜|凌晨|上午|中午|下午|晚上)\s*)?(\d{1,2}):(\d{1,2})/);
  const periodTime = text.match(/(?:(今天|昨天|前天)\s*)?(午夜|凌晨|上午|中午|下午|晚上)(?:\s*(\d{1,2}):(\d{1,2}))?/);
  const match = dayAndTime || periodTime;
  if (!match) {
    return '';
  }
  const dayWord = match[1] || '今天';
  const period = match[2] || '';
  const rawHour = match[3] === undefined ? undefined : Number(match[3]);
  const minute = match[4] === undefined ? 0 : Number(match[4]);
  const dayOffset = dayWord === '前天' ? 2 : dayWord === '昨天' ? 1 : 0;
  const beijingDay = new Date(Date.UTC(now.year, now.month - 1, now.day - dayOffset, 0, 0));
  const hour = normalizeYaohuoRelativeHour(period, rawHour);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return '';
  }
  return beijingDateToIso(beijingDay.getUTCFullYear(), beijingDay.getUTCMonth() + 1, beijingDay.getUTCDate(), hour, minute);
}

function normalizeYaohuoRelativeHour(period: string, rawHour?: number) {
  let hour = rawHour;
  if (hour === undefined) {
    hour = period === '中午' ? 12 : 0;
  }
  if (hour < 0 || hour > 23) {
    return NaN;
  }
  if ((period === '下午' || period === '晚上') && hour < 12) {
    return hour + 12;
  }
  if (period === '中午' && hour < 11) {
    return hour + 12;
  }
  if ((period === '午夜' || period === '凌晨' || period === '上午') && hour === 12) {
    return 0;
  }
  return hour;
}

function profileStats(root: ReturnType<typeof parseHtml>, text: string) {
  const topicCount = profileStructuredStatValue(root, 'posts') || profileStatValue(text, '主题|帖子|贴子|发帖');
  const replyCount = profileStructuredStatValue(root, 'replies') || profileStatValue(text, '回复|回帖');
  return {
    topicCount: topicCount || undefined,
    replyCount: replyCount || undefined,
    postCount: topicCount && replyCount ? topicCount + replyCount : undefined
  };
}

function profileStructuredStatValue(root: ReturnType<typeof parseHtml>, className: string) {
  for (const element of root.querySelectorAll('.uinfo-stat')) {
    const classes = String(element.getAttribute('class') || '').split(/\s+/);
    if (!classes.includes(className)) {
      continue;
    }
    const value = parsePositiveInteger(elementText(element.querySelector('.value')));
    if (value) {
      return value;
    }
  }
  return 0;
}

function profileStatValue(text: string, labels: string) {
  const pattern = new RegExp(`(?:^|[^\\d])(?:${labels})\\s*(?:[:：]?\\s*|[（(]\\s*)([\\d,]{1,6})(?!\\d)`, 'g');
  for (const match of text.matchAll(pattern)) {
    const value = parsePositiveInteger(match[1]);
    if (value) {
      return value;
    }
  }
  return 0;
}

function safeYaohuoProfileName(value: unknown) {
  const text = String(value || '').trim();
  if (!text || text.length > 32 || /正在论坛|查看更多|动态|人气|留言板|小时前|分钟前|今天|昨天/.test(text)) {
    return '';
  }
  return text;
}

function extractClassIdFromRow(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number]) {
  return element.querySelectorAll('a[href]')
    .map((item) => item.getAttribute('href')?.match(/[?&]classid=(\d+)/i)?.[1])
    .find(Boolean);
}

function parseListItem(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number], fallbackClassId?: string, fallbackCreatedAt = new Date().toISOString()) {
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
  const resolvedClassId = classId || extractClassIdFromRow(element) || fallbackClassId;
  const accessRequirement = accessRequirementFromText(text.replace(title, ' '));
  const replyCount = parsePositiveInteger(element.querySelectorAll('a').find((item) => /^\d+$/.test(elementText(item)))?.text);
  const viewCount = parsePositiveInteger(text.match(/阅\s*(\d+)/)?.[1] || text.match(/(\d+)\s*阅/)?.[1] || text.match(/\/\s*阅(\d+)/)?.[1]);
  const rightText = element.querySelectorAll('.right').map(elementText).find(Boolean) || '';
  const timeText = rightText
    || text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
    || text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
    || '';
  const createdAt = parseYaohuoDate(timeText || text) || fallbackCreatedAt;
  const author = text.replace(title, '').split('/').map((part) => part.trim().replace(/^\d+\.\s*/, '')).find((part) => (
    part && !/^\d+$/.test(part) && !/阅\s*\d+/.test(part) && !/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/.test(part)
  )) || '';
  const authorLink = element.querySelector('a[href*="userinfo"], a[href*="touserid"]');
  const authorHref = authorLink?.getAttribute('href') || '';
  const authorId = extractUserIdFromHref(authorHref);
  return {
    source: 'yaohuo' as const,
    id,
    title,
    author,
    authorId,
    authorUrl: authorId ? userUrl(authorId) : authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
    categoryId: resolvedClassId,
    category: resolvedClassId ? categoryNames.get(resolvedClassId) : undefined,
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

function parseCompactListItems(root: ReturnType<typeof parseHtml>, fallbackClassId?: string, limit = 30) {
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
      const parent = link.parentNode as HTMLElement | null;
      const row = parent && typeof parent.querySelectorAll === 'function' ? parent : list;
      const text = elementText(row);
      const accessRequirement = accessRequirementFromText(text.replace(title, ' '));
      items.push({
        source: 'yaohuo',
        id,
        title,
        author: '',
        categoryId: resolvedClassId,
        category: resolvedClassId ? categoryNames.get(resolvedClassId) : undefined,
        url: url || `${BASE_URL}/bbs-${id}.html`,
        createdAt: fallbackCreatedAt,
        lastReplyAt: fallbackCreatedAt,
        replyCount: 0,
        excerpt: title,
        ...(accessRequirement ? { accessRequirement } : {})
      });
      if (items.length >= limit) {
        return items;
      }
    }
  }
  return items;
}

export function parseYaohuoListHtml(html: string, {
  classId,
  limit = 30,
  page = 1,
  preserveOrder = false,
  url
}: { classId?: string; limit?: number; page?: number; preserveOrder?: boolean; url?: string } = {}): FeedResponse {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  let rows = root.querySelectorAll('.listdata');
  if (!rows.length) {
    rows = root.querySelectorAll('div.line1, div.line2');
  }
  const seen = new Set<string>();
  const items: Topic[] = [];
  const fallbackCreatedAt = new Date().toISOString();
  for (const row of rows) {
    const item = parseListItem(row, classId, fallbackCreatedAt) as Topic | null;
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
    const item = parseListItem(parseHtml(chunk), classId, fallbackCreatedAt) as Topic | null;
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
    items: preserveOrder ? items : sortTopicsByTime(items),
    errors: {},
    hasMore: Boolean(nextPage),
    nextPage
  };
}

function extractMarkedContent(html: string, start: string, end: string) {
  const marked = extractMarkedContentBounds(html, start, end);
  return marked ? marked.content : html;
}

const yaohuoDownloadContentPattern = /下载|网盘|提取码|提取密码|解压密码|访问码|夸克|百度云?|蓝奏|123云盘|迅雷|天翼云|阿里云盘|城通|apk\b|pan\.|quark|lanzou|123pan|aliyundrive|cloud\.189|ctfile|uc\.cn/i;
const yaohuoNonPostClassNames = new Set(['content', 'subtitle', 'line1', 'line2', 'listdata', 'page', 'pager', 'nav', 'footer', 'header']);
const yaohuoPostBoundaryTextPattern = /原站收藏|回复列表|更多回帖|评论内查找|楼层目录|写回复|只看楼主|只看带图|倒序/;
const yaohuoRawPostBoundaryPatterns = [
  /<div\b[^>]*class=["'][^"']*\blouzhuxinxi\b[^"']*["'][^>]*>/i,
  /<div\b[^>]*class=["'][^"']*\brecontent\b[^"']*["'][^>]*>/i,
  /<div\b[^>]*class=["'][^"']*\bline[12]\b[^"']*["'][^>]*>/i,
  /更多回帖\s*\(/i
];

function extractMarkedContentBounds(html: string, start: string, end: string) {
  const startIndex = html.indexOf(start);
  const contentStart = startIndex + start.length;
  const endIndex = html.indexOf(end, contentStart);
  return startIndex >= 0 && endIndex > contentStart
    ? { content: html.slice(contentStart, endIndex), endIndex: endIndex + end.length }
    : null;
}

function firstYaohuoRawPostBoundaryIndex(html: string) {
  return yaohuoRawPostBoundaryPatterns
    .map((pattern) => html.search(pattern))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
}

function extractRawYaohuoPostContent(html: string) {
  const marked = extractMarkedContentBounds(html, '<!--listS-->', '<!--listE-->');
  if (!marked) {
    return '';
  }
  const rest = html.slice(marked.endIndex);
  const boundaryIndex = firstYaohuoRawPostBoundaryIndex(rest);
  const followingContent = (boundaryIndex >= 0 ? rest.slice(0, boundaryIndex) : rest)
    .replace(/^\s*(?:<\/div>\s*)+/, '');
  return [marked.content, followingContent]
    .filter((part) => textContentFromHtml(part))
    .join('\n');
}

function hasAncestor(node: HTMLElement, ancestor: HTMLElement | null | undefined) {
  let current = node.parentNode;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function hasExcludedYaohuoClass(node: HTMLElement) {
  return String(node.getAttribute('class') || '')
    .toLowerCase()
    .split(/\s+/)
    .some((name) => yaohuoNonPostClassNames.has(name));
}

function isHtmlElementNode(node: unknown): node is HTMLElement {
  return Boolean(node && typeof node === 'object' && 'tagName' in node && typeof (node as HTMLElement).getAttribute === 'function');
}

function isYaohuoPostBoundaryNode(node: HTMLElement) {
  if (hasExcludedYaohuoClass(node)) {
    return true;
  }
  const href = node.getAttribute('href') || '';
  if (/book_list\.aspx|book_re\.aspx/i.test(href)) {
    return true;
  }
  const html = node.toString();
  const text = elementText(node);
  return isYaohuoPostBoundaryText(text, html);
}

function isYaohuoPostBoundaryText(text: string, html = '') {
  return yaohuoPostBoundaryTextPattern.test(text) && !yaohuoDownloadContentPattern.test(`${text} ${html}`);
}

function collectFollowingYaohuoPostContent(mainContent: HTMLElement | null | undefined) {
  const parent = mainContent?.parentNode;
  if (!parent) {
    return [];
  }
  const chunks: string[] = [];
  let afterMainContent = false;
  for (const node of parent.childNodes) {
    if (node === mainContent) {
      afterMainContent = true;
      continue;
    }
    if (!afterMainContent) {
      continue;
    }
    const html = node.toString();
    const text = textContentFromHtml(html);
    if (!text) {
      continue;
    }
    if (isYaohuoPostBoundaryText(text, html)) {
      break;
    }
    if (isHtmlElementNode(node) && isYaohuoPostBoundaryNode(node)) {
      break;
    }
    chunks.push(html);
  }
  return chunks;
}

function collectYaohuoDownloadContent(root: ReturnType<typeof parseHtml>, mainContent: HTMLElement | null | undefined) {
  const selected: HTMLElement[] = [];
  for (const node of root.querySelectorAll('div, p, table, ul, ol, a')) {
    if (node === mainContent || hasAncestor(node, mainContent) || (mainContent && hasAncestor(mainContent, node))) {
      continue;
    }
    if (hasExcludedYaohuoClass(node)) {
      continue;
    }
    const html = node.toString();
    const text = elementText(node);
    if (!yaohuoDownloadContentPattern.test(`${text} ${html}`)) {
      continue;
    }
    if (selected.some((parent) => hasAncestor(node, parent))) {
      continue;
    }
    selected.push(node);
  }
  return selected.map((node) => node.toString());
}

function appendYaohuoPostContent(contentHtml: string, root: ReturnType<typeof parseHtml>, mainContent: HTMLElement | null | undefined) {
  const followingContent = collectFollowingYaohuoPostContent(mainContent);
  const extraHtml = followingContent.length ? followingContent : collectYaohuoDownloadContent(root, mainContent);
  return [contentHtml, ...extraHtml].filter((part) => textContentFromHtml(part)).join('\n');
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readableYaohuoActivityText(value: unknown) {
  return textContentFromHtml(value)
    .replace(/(派币|礼金|每人|余|获赏)\s*(\d+)/g, '$1 $2')
    .replace(/(\d+)\s*(已结束|已开始|进行中|未开始)/g, '$1 $2')
    .replace(/(\d+)\s*(派币|礼金|每人|余|获赏)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function yaohuoActivitySummaryHtml(root: ReturnType<typeof parseHtml>) {
  const parts = [
    root.querySelector('.notification-text'),
    root.querySelector('.paibi'),
    root.querySelector('#stamp-badge, .post-badge')
  ]
    .map((node) => readableYaohuoActivityText(node?.toString() || ''))
    .filter(Boolean);
  return parts.length
    ? `<blockquote>${parts.map((part) => `<p>${escapeHtmlText(part)}</p>`).join('')}</blockquote>`
    : '';
}

function parseVoteOptions(html: string) {
  const root = parseHtml(html);
  const options: TopicPollOption[] = [];
  root.querySelectorAll('.toupiao').forEach((element) => {
    element.querySelectorAll('a[href*="vid="]').forEach((link) => {
      const id = link.getAttribute('href')?.match(/[?&]vid=(\d+)/i)?.[1];
      const text = elementText(link);
      if (!id || !text) {
        return;
      }
      const count = parsePositiveInteger(
        text.match(/[（(]\s*(\d+)\s*(?:票)?\s*[）)]\s*$/)?.[1]
        || text.match(/(\d+)\s*票\s*$/)?.[1]
      );
      const label = text
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/[（(]\s*\d+\s*(?:票)?\s*[）)]\s*$/, '')
        .replace(/\d+\s*票\s*$/, '')
        .trim();
      if (label) {
        options.push({ id, label, count, selected: /已投|已选|当前/i.test(text) });
      }
    });
  });
  return options;
}

function parseYaohuoVoteChoiceLimits(text: string) {
  const min = parsePositiveInteger(text.match(/至少\s*(?:选择)?\s*(\d+)\s*项/i)?.[1]) || undefined;
  const max = parsePositiveInteger(text.match(/(?:最多\s*(?:选择)?|可选)\s*(\d+)\s*项/i)?.[1]) || undefined;
  return { min, max };
}

function parseVotePolls(html: string, topicId: string): TopicPoll[] | undefined {
  const options = parseVoteOptions(html);
  if (!options.length) {
    return undefined;
  }
  const text = textContentFromHtml(html);
  const { min, max } = parseYaohuoVoteChoiceLimits(text);
  const multiple = /多选|可选\s*\d+\s*项|至少\s*(?:选择\s*)?\d+\s*项|至少\s*选择|最多\s*(?:选择)?\s*\d+\s*项/i.test(text);
  return [{
    id: `yaohuo-${topicId}`,
    title: '投票',
    voted: options.some((option) => option.selected) || /已投票|已经投票|您已投/i.test(text),
    closed: /投票(?:已)?(?:结束|关闭|截止)|已结束投票/i.test(text),
    multiple,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    options
  }];
}

function yaohuoTopicAccessRequirementFromContent(html: string) {
  const accessRequirement = accessRequirementFromText(html);
  if (!accessRequirement || accessRequirement.type !== 'login') {
    return accessRequirement;
  }
  const text = textContentFromHtml(html);
  return /请先\s*登录|登录后(?:可|才|才能)?(?:查看|访问|回复|阅读)|需要\s*登录(?:后)?(?:才|才能|可)?(?:查看|访问|回复|阅读)|未登录[^。；\n]{0,20}(?:无法|不能|不可|禁止)?(?:查看|访问|回复|阅读)/i.test(text)
    ? accessRequirement
    : undefined;
}

function topicTitle(root: ReturnType<typeof parseHtml>) {
  const content = elementText(root.querySelector('div.content'));
  return content.match(/\[标题\]\s*(.*?)\s*\(阅/i)?.[1]?.trim()
    || elementText(root.querySelector('title')).replace(/[-_].*$/, '').trim();
}

export function parseYaohuoTopicHtml(html: string, { id, url }: { id: string; url?: string }): TopicDetail {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const bbsContentElement = root.querySelector('div.bbscontent');
  const bbsContent = bbsContentElement?.innerHTML || '';
  const activitySummaryHtml = yaohuoActivitySummaryHtml(root);
  const postContentHtml = extractRawYaohuoPostContent(html)
    || appendYaohuoPostContent(extractMarkedContent(bbsContent, '<!--listS-->', '<!--listE-->'), root, bbsContentElement);
  const contentHtml = [activitySummaryHtml, postContentHtml]
    .filter((part) => textContentFromHtml(part))
    .join('\n');
  const contentText = elementText(root.querySelector('div.content'));
  const classId = root.querySelectorAll('a[href*="classid="]').map((link) => link.getAttribute('href')?.match(/[?&]classid=(\d+)/i)?.[1]).find(Boolean);
  const author = elementText(root.querySelector('div.subtitle a[href*="userinfo"], div.subtitle a[href*="touserid"]')) || elementText(root.querySelector('div.subtitle a'));
  const authorHref = root.querySelector('div.subtitle a[href*="userinfo"], div.subtitle a[href*="touserid"]')?.getAttribute('href') || '';
  const authorId = extractUserIdFromHref(authorHref);
  const createdAt = parseYaohuoDate(contentText.match(/\[时间\]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2})/)?.[1]
    || contentText.match(/\[时间\]\s*(\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2})/)?.[1]
    || contentText.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]) || new Date().toISOString();
  const polls = parseVotePolls(html, String(id || ''));
  const accessRequirement = yaohuoTopicAccessRequirementFromContent(contentHtml)
    || yaohuoTopicAccessRequirementFromContent(html);
  return {
    source: 'yaohuo',
    id: String(id || ''),
    title: topicTitle(root) || '',
    author,
    authorId,
    authorUrl: authorId ? userUrl(authorId) : authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
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
    ...(accessRequirement ? { accessRequirement } : {}),
    ...(polls ? { polls } : {})
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

function parseReplyFloor(row: HTMLElement, text: string, fallback: number) {
  return parsePositiveInteger(row.getAttribute('data-floor'))
    || parsePositiveInteger(String(row.getAttribute('id') || '').match(/floor-(\d+)/i)?.[1])
    || parsePositiveInteger(row.querySelector('.floornumber0')?.getAttribute('title')?.match(/原\s*(\d+)\s*楼/i)?.[1])
    || parseFloor(text.match(/\[(沙发|椅子|板凳|\d+楼?)\]/)?.[1] || '')
    || fallback;
}

function yaohuoReplyContentHtml(row: HTMLElement, rawHtml: string, authorHtml: string) {
  const rewardHtml = row.querySelector('.remoney')?.toString() || '';
  const replyTextHtml = row.querySelector('.retext')?.innerHTML;
  if (rewardHtml || replyTextHtml !== undefined) {
    return `${rewardHtml}${replyTextHtml || ''}`;
  }
  let contentOnly = rawHtml
    .replace(/^\s*\[\s*(?:<a\b[^>]*>)?\s*(沙发|椅子|板凳|\d+楼?)\s*(?:<\/a>)?\s*\]\s*/i, '')
    .replace(/^\s*\[\s*<a\b[^>]*book_re\.aspx[^>]*(?:reply=|touserid=)[^>]*>[\s\S]*?<\/a>\s*\]\s*/i, '')
    .replace(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}[\s\S]*$/i, '');
  const authorIndex = authorHtml ? contentOnly.lastIndexOf(authorHtml) : -1;
  if (authorIndex >= 0) {
    contentOnly = contentOnly.slice(0, authorIndex);
  }
  return contentOnly;
}

export function parseYaohuoRepliesHtml(html: string, { page = 1, limit = 30, url }: { page?: number; limit?: number; url?: string } = {}): RepliesResponse {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const rows = root.querySelectorAll('div.list-reply, div.line1, div.line2');
  const floorOffset = Math.max(0, page - 1) * limit;
  const items = rows.map((row, index) => {
    const rawHtml = row.innerHTML;
    const text = elementText(row);
    const floor = parseReplyFloor(row, text, floorOffset + index + 1);
    const authorLink = row.querySelectorAll('a[href*="userinfo"]').at(-1);
    const actionLink = row.querySelector('a[href*="book_re.aspx"][href*="reply="], a[href*="book_re.aspx"][href*="touserid="]');
    const author = elementText(authorLink);
    const authorId = extractUserIdFromHref(authorLink?.getAttribute('href'))
      || extractUserIdFromHref(actionLink?.getAttribute('href'));
    const createdAt = parseYaohuoDate(elementText(row.querySelector('.retime'))
      || text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
      || text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]) || new Date().toISOString();
    const authorHtml = authorLink?.toString() || '';
    const contentOnly = yaohuoReplyContentHtml(row, rawHtml, authorHtml);
    return {
      author,
      ...(authorId ? { authorId } : {}),
      ...(authorId ? { authorUrl: userUrl(authorId) } : {}),
      contentHtml: sanitizeContentHtml(contentOnly, url || `${BASE_URL}/bbs/book_re.aspx`),
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

export function parseYaohuoUserProfileHtml(html: string, { id, username, url }: { id: string; username?: string; url?: string }): UserProfile {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const visibleText = elementText(root);
  const displayName = safeYaohuoProfileName(visibleText.match(/(?:昵称|用户名)\s*[:：]\s*([^\s<]+)/)?.[1])
    || safeYaohuoProfileName(elementText(root.querySelector('.username, .user-name, h1')))
    || username
    || id;
  const stats = profileStats(root, visibleText);
  const seen = new Set<string>();
  const rows = [
    ...root.querySelectorAll('.listdata, div.line1, div.line2'),
    ...root.querySelectorAll('a[href]')
  ];
  const topics = rows.flatMap((row) => {
    const link = row.rawTagName === 'a' ? row : row.querySelector('a[href]');
    const title = elementText(link);
    const { id: topicId, classId, url: topicUrl } = extractTopicParts(link?.getAttribute('href'));
    if (!topicId || !title || seen.has(topicId)) {
      return [];
    }
    seen.add(topicId);
    const text = elementText(row);
    const timeText = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
      || text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
      || '';
    const createdAt = parseYaohuoDate(timeText || text) || new Date().toISOString();
    return [{
      source: 'yaohuo' as const,
      id: topicId,
      title,
      author: displayName,
      authorId: id,
      authorUrl: userUrl(id),
      categoryId: classId,
      category: classId ? categoryNames.get(classId) : undefined,
      url: topicUrl || `${BASE_URL}/bbs-${topicId}.html`,
      createdAt,
      lastReplyAt: createdAt,
      replyCount: 0
    }];
  });
  return {
    source: 'yaohuo',
    id,
    username: username || displayName,
    displayName,
    url: userUrl(id),
    ...stats,
    topics: sortTopicsByCreatedAt(topics).slice(0, 30)
  };
}

export function parseYaohuoSearchHtml(html: string, options: { classId?: string; page?: number; limit?: number; url?: string } = {}): SearchResponse {
  const result = parseYaohuoListHtml(html, { ...options, classId: options.classId || '0', preserveOrder: true });
  return {
    items: result.items,
    errors: result.errors,
    hasMore: result.hasMore,
    nextPage: result.nextPage
  };
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
