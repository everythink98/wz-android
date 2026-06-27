import { fetchWithTimeout, type Fetcher } from './request';
import type { SearchSort } from './feedLogic';
import { searchTimeRangeStartEpoch, type V2exSearchFilter } from './searchFilters';
import { XMLParser } from 'fast-xml-parser';
import type { CategoriesResponse, FeedResponse, Reply, SearchResponse, Topic, TopicDetail, UserProfile } from './types';
import {
  absoluteUrl,
  accessRequirementFromObject,
  accessRequirementFromNoticeText,
  accessRequirementFromText,
  decodeHtml,
  elementText,
  isRecord,
  parsePositiveInteger,
  parseHtml,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  sortTopicsByTime,
  textExcerpt,
  textContentFromHtml,
  toIsoString
} from './localHtml';
import {
  SOV2EX_URL,
  V2EX_BASE_URL as BASE_URL,
  safeV2exNodePath as safeNodePath,
  safeV2exTopicUrl as safeTopicUrl,
  v2exMemberUrl as memberUrl,
  v2exNodeIdFromHref as nodeIdFromHref
} from './localV2exHelpers';

const HTML_LIST_PAGE_SIZE = 20;
const V2EX_HTML_TIMEZONE = '+08:00';
const latestCache: { savedAt: number; data: unknown[] } = { savedAt: 0, data: [] };
const atomParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true
});

interface V2exOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type V2exHtmlReplyMeta = {
  commentId?: number;
  createdAt?: string;
  floor?: number;
  replyTargetAuthor?: string;
  thanksCount?: number;
};

type V2exHtmlDetail = {
  supplementHtml: string;
  tags: string[];
  viewCount?: number;
  replies: Reply[];
  repliesByCommentId: Map<number, V2exHtmlReplyMeta>;
  repliesByFloor: Map<number, V2exHtmlReplyMeta>;
};

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function v2exLastReplyAt(raw: Record<string, unknown>, createdAt: string) {
  const touchedAt = toIsoString(raw.last_touched);
  const createdMs = Date.parse(createdAt || '');
  const touchedMs = Date.parse(touchedAt || '');
  if (!Number.isFinite(touchedMs)) {
    return createdAt;
  }
  if (!Number.isFinite(createdMs)) {
    return touchedAt;
  }
  return Number(raw.replies || 0) > 0 && touchedMs >= createdMs ? touchedAt : createdAt;
}
function toV2exHtmlIsoString(value: unknown) {
  return toIsoString(value, V2EX_HTML_TIMEZONE);
}

function topicId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

function normalizeApiTopic(raw: unknown): Topic | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = topicId(raw.id);
  if (!id) {
    return null;
  }
  const node = isRecord(raw.node) ? raw.node : {};
  const member = isRecord(raw.member) ? raw.member : {};
  const createdAt = toIsoString(raw.created) || new Date().toISOString();
  const lastReplyAt = v2exLastReplyAt(raw, createdAt);
  const accessRequirement = accessRequirementFromObject(raw);
  return {
    source: 'v2ex',
    id,
    title: String(raw.title || ''),
    author: String(member.username || ''),
    authorAvatar: absoluteUrl(member.avatar_large || member.avatar_normal || member.avatar_mini, BASE_URL),
    authorId: typeof member.username === 'string' ? member.username : undefined,
    authorUrl: typeof member.username === 'string' ? memberUrl(member.username) : undefined,
    categoryId: typeof node.name === 'string' ? node.name : undefined,
    category: typeof node.title === 'string' ? node.title : typeof node.name === 'string' ? node.name : undefined,
    url: safeTopicUrl(id, raw.url),
    createdAt,
    lastReplyAt,
    replyCount: Number(raw.replies || 0),
    excerpt: textExcerpt(raw.content || raw.content_rendered || ''),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function normalizeHtmlTopic(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number], fallbackCategory?: string): Topic | null {
  const link = element.querySelector('.topic-link');
  const href = link?.getAttribute('href') || '';
  const id = href.match(/\/t\/(\d+)/)?.[1];
  const title = elementText(link);
  if (!id || !title) {
    return null;
  }
  const nodeLink = element.querySelector('a.node');
  const categoryId = nodeIdFromHref(nodeLink?.getAttribute('href')) || fallbackCategory;
  const memberLink = element.querySelector('.topic_info strong a[href^="/member/"]')
    || element.querySelector('strong a[href^="/member/"]')
    || element.querySelector('a[href^="/member/"]');
  const memberHref = memberLink?.getAttribute('href') || '';
  const memberName = elementText(memberLink);
  const avatar = element.querySelector('img.avatar')?.getAttribute('src');
  const timestamp = element.querySelector('span[title]')?.getAttribute('title');
  const replyBadge = element.querySelector(`td[align="right"] a[href*="/t/${id}#reply"].count_livid,td[align="right"] a[href*="/t/${id}#reply"].count_orange`)
    || element.querySelector('td[align="right"] .count_livid,td[align="right"] .count_orange')
    || element.querySelector('.count_livid');
  const countText = replyBadge?.text || href.match(/#reply(\d+)/)?.[1] || '';
  const createdAt = toV2exHtmlIsoString(timestamp) || new Date().toISOString();
  const accessRequirement = accessRequirementFromText(elementText(element).replace(title, ' '));
  return {
    source: 'v2ex',
    id,
    title,
    author: memberName,
    authorAvatar: absoluteUrl(avatar, BASE_URL),
    authorId: memberName || undefined,
    authorUrl: memberHref ? absoluteUrl(memberHref, BASE_URL) : memberName ? memberUrl(memberName) : undefined,
    categoryId,
    category: elementText(nodeLink) || categoryId,
    url: `${BASE_URL}/t/${id}`,
    createdAt,
    lastReplyAt: createdAt,
    replyCount: Number.parseInt(String(countText || '0'), 10) || 0,
    excerpt: '',
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function v2exReplyTargetAuthor(value: unknown) {
  const text = String(value || '')
    .replace(/^<p>/i, '')
    .replace(/<\/p>$/i, '')
    .trim();
  const linked = text.match(/^@<a\b[^>]*href=["']\/member\/([^"']+)["'][^>]*>/i);
  if (linked) {
    try {
      return decodeURIComponent(linked[1]);
    } catch {
      return undefined;
    }
  }
  const plain = text.match(/^@([A-Za-z0-9_-]{1,32})\b/);
  return plain ? plain[1] : undefined;
}

function parseV2exThanksCount(value: unknown) {
  const raw = String(value || '');
  const text = decodeHtml(raw.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const hasThanksText = /(thanks?|感谢|谢)/i.test(text);
  const hasHeartIcon = /(?:^|[/_-])heart/i.test(raw);
  if (!hasThanksText && !hasHeartIcon) {
    return undefined;
  }
  const count = parsePositiveInteger(text);
  return count > 0 ? count : undefined;
}

function interactionTypeName(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    return String(value['@id'] || value.name || value.url || '');
  }
  return '';
}

function statCountByInteraction(data: unknown, pattern: RegExp) {
  if (!isRecord(data)) {
    return undefined;
  }
  const rawStats = data.interactionStatistic;
  const stats = Array.isArray(rawStats) ? rawStats : rawStats ? [rawStats] : [];
  for (const stat of stats) {
    if (!isRecord(stat) || !pattern.test(interactionTypeName(stat.interactionType))) {
      continue;
    }
    const count = parsePositiveInteger(stat.userInteractionCount);
    if (count > 0) {
      return count;
    }
  }
  return undefined;
}

function parseV2exViewCount(root: ReturnType<typeof parseHtml>) {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.text);
      const viewCount = statCountByInteraction(parsed, /ViewAction/i);
      if (typeof viewCount === 'number') {
        return viewCount;
      }
    } catch {
      // Ignore unrelated structured data.
    }
  }
  return undefined;
}

function parseV2exTags(root: ReturnType<typeof parseHtml>) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const element of root.querySelectorAll('a.tag')) {
    const tag = elementText(element);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function parseV2exSupplements(root: ReturnType<typeof parseHtml>) {
  const mainSupplements = root.querySelectorAll('#Main .subtle');
  const supplements = mainSupplements.length ? mainSupplements : root.querySelectorAll('.subtle');
  return supplements
    .map((element, index) => {
      const content = element.querySelector('.topic_content')?.innerHTML || '';
      if (!content.trim()) {
        return '';
      }
      const titleTime = element.querySelector('.fade span[title]')?.getAttribute('title') || '';
      const displayTime = titleTime ? toV2exHtmlIsoString(titleTime) || titleTime : '';
      const label = `补充 ${index + 1}${displayTime ? ` · ${displayTime}` : ''}`;
      return `<blockquote><p><strong>${escapeHtml(label)}</strong></p>${sanitizeContentHtml(content, BASE_URL)}</blockquote>`;
    })
    .filter(Boolean)
    .join('\n');
}

function parseV2exReplyMeta(root: ReturnType<typeof parseHtml>) {
  const repliesByCommentId = new Map<number, V2exHtmlReplyMeta>();
  const repliesByFloor = new Map<number, V2exHtmlReplyMeta>();
  const replies: Reply[] = [];
  for (const element of root.querySelectorAll('[id^="r_"]')) {
    const commentId = parsePositiveInteger(String(element.getAttribute('id') || '').replace(/^r_/, ''));
    const floor = parsePositiveInteger(element.querySelector('.no')?.text);
    const createdAt = toV2exHtmlIsoString(element.querySelector('.ago')?.getAttribute('title'));
    const replyContent = element.querySelector('.reply_content')?.innerHTML || '';
    const thanksCount = element.querySelectorAll('.small')
      .map((item) => parseV2exThanksCount(item.innerHTML || item.text))
      .find((count): count is number => typeof count === 'number');
    const replyTargetAuthor = v2exReplyTargetAuthor(replyContent);
    const meta: V2exHtmlReplyMeta = {
      ...(commentId ? { commentId } : {}),
      ...(floor ? { floor } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(thanksCount ? { thanksCount } : {}),
      ...(replyTargetAuthor ? { replyTargetAuthor } : {})
    };
    if (commentId) {
      repliesByCommentId.set(commentId, meta);
    }
    if (floor) {
      repliesByFloor.set(floor, meta);
    }
    const authorLink = element.querySelector('strong a[href^="/member/"]')
      || element.querySelector('a.dark[href^="/member/"]')
      || element.querySelector('a[href^="/member/"]');
    const author = elementText(authorLink);
    const authorHref = authorLink?.getAttribute('href') || '';
    const contentHtml = sanitizeContentHtml(replyContent, BASE_URL);
    if (author || contentHtml) {
      replies.push({
        author,
        authorId: author || undefined,
        authorAvatar: absoluteUrl(element.querySelector('img.avatar')?.getAttribute('src'), BASE_URL),
        authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : author ? memberUrl(author) : undefined,
        contentHtml,
        createdAt,
        ...(floor ? { floor } : {}),
        ...(commentId ? { commentId } : {}),
        ...(replyTargetAuthor ? { replyTargetAuthor } : {}),
        ...(typeof thanksCount === 'number' ? { thanksCount } : {})
      });
    }
  }
  return { replies, repliesByCommentId, repliesByFloor };
}

function parseV2exHtmlDetail(html: string): V2exHtmlDetail {
  const root = parseHtml(html);
  const replyMeta = parseV2exReplyMeta(root);
  return {
    supplementHtml: parseV2exSupplements(root),
    tags: parseV2exTags(root),
    viewCount: parseV2exViewCount(root),
    replies: replyMeta.replies,
    repliesByCommentId: replyMeta.repliesByCommentId,
    repliesByFloor: replyMeta.repliesByFloor
  };
}

function v2exHtmlAccessRequirement(html: string) {
  const root = parseHtml(html);
  const text = elementText(root.querySelector('#Main')) || elementText(root.querySelector('body'));
  return accessRequirementFromNoticeText(text, { requireStart: true });
}

function appendV2exSupplementHtml(contentHtml: string, supplementHtml: string) {
  return [contentHtml, supplementHtml].filter((part) => String(part || '').trim()).join('\n');
}

function v2exHtmlWindowStart(options: { page: number; limit: number; category?: string }) {
  if (options.category || options.page <= 1) {
    return (options.page - 1) * options.limit;
  }
  return Math.min(options.limit, HTML_LIST_PAGE_SIZE) + ((options.page - 2) * options.limit);
}

function parseV2exAllTabPage(html: string, limit: number) {
  const root = parseHtml(html);
  const items = root.querySelectorAll('.cell.item')
    .map((element) => normalizeHtmlTopic(element))
    .filter(Boolean) as Topic[];
  const hasRecentLink = root.querySelectorAll('a[href]').some((link) => {
    try {
      return new URL(link.getAttribute('href') || '', BASE_URL).pathname === '/recent';
    } catch {
      return false;
    }
  });
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit || hasRecentLink,
    nextPage: items.length > limit || hasRecentLink ? 2 : null
  };
}

function parseV2exListPage(html: string, page: number, path: string, fallbackCategory?: string) {
  const root = parseHtml(html);
  const items = root.querySelectorAll('.cell')
    .map((element) => normalizeHtmlTopic(element, fallbackCategory))
    .filter(Boolean) as Topic[];
  const hasMore = root.querySelectorAll('a[href]').some((link) => {
    try {
      const url = new URL(link.getAttribute('href') || '', BASE_URL);
      return url.pathname === path && Number(url.searchParams.get('p') || '1') > page;
    } catch {
      return false;
    }
  });
  return { items, hasMore };
}

async function fetchJson<T>(url: string, options: V2exOptions = {}) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json,text/plain,*/*', Referer: BASE_URL }
  }, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return data as T;
}

async function fetchText(url: string, options: V2exOptions = {}) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: 'text/html,application/xhtml+xml,*/*', Referer: BASE_URL }
  }, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

async function loadLatest(options: V2exOptions & { nocache?: boolean } = {}) {
  if (!options.nocache && latestCache.data.length && Date.now() - latestCache.savedAt < 60_000) {
    return latestCache.data;
  }
  const data = await fetchJson<unknown[]>(`${BASE_URL}/api/topics/latest.json`, options);
  latestCache.savedAt = Date.now();
  latestCache.data = Array.isArray(data) ? data : [];
  return latestCache.data;
}

async function fetchHtmlWindow(options: V2exOptions & {
  page: number;
  limit: number;
  category?: string;
}) {
  const path = safeNodePath(options.category);
  if (!path) {
    return null;
  }
  const start = v2exHtmlWindowStart(options);
  const firstHtmlPage = Math.floor(start / HTML_LIST_PAGE_SIZE) + 1;
  const skip = start % HTML_LIST_PAGE_SIZE;
  const needed = skip + options.limit;
  const collected: Topic[] = [];
  let htmlPage = firstHtmlPage;
  let lastHasMore = false;
  while (collected.length < needed) {
    const html = await fetchText(`${BASE_URL}${path}?p=${htmlPage}`, options);
    const pageResult = parseV2exListPage(html, htmlPage, path, options.category);
    collected.push(...pageResult.items);
    lastHasMore = pageResult.hasMore;
    if (!pageResult.hasMore || pageResult.items.length === 0) {
      break;
    }
    htmlPage += 1;
  }
  const items = collected.slice(skip, skip + options.limit);
  const hasMore = items.length === options.limit && (collected.length > skip + options.limit || lastHasMore);
  return { items, hasMore, nextPage: hasMore ? options.page + 1 : null };
}

export async function getV2exFeed(options: V2exOptions & {
  page?: number;
  limit?: number;
  category?: string;
  nocache?: boolean;
} = {}): Promise<FeedResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  if (!options.category && page === 1) {
    const html = await fetchText(`${BASE_URL}/?tab=all`, options);
    return { ...parseV2exAllTabPage(html, limit), errors: {} };
  }
  if (options.category || page > 1) {
    const htmlResult = await fetchHtmlWindow({ ...options, page, limit });
    if (htmlResult) {
      return {
        ...htmlResult,
        nextPage: htmlResult.hasMore ? htmlResult.nextPage : null,
        errors: {}
      };
    }
  }
  const data = await loadLatest(options);
  const items = data.map(normalizeApiTopic).filter(Boolean) as Topic[];
  const filtered = options.category
    ? items.filter((topic) => topic.categoryId === options.category || topic.category === options.category)
    : items;
  const start = (page - 1) * limit;
  let pageItems = filtered.slice(start, start + limit);
  let hasMore = filtered.length >= start + limit;
  if (!options.category && page === 1 && pageItems.length < limit) {
    const htmlResult = await fetchHtmlWindow({ ...options, page, limit }).catch(() => null);
    if (htmlResult) {
      const seen = new Set(pageItems.map((topic) => topic.id));
      const merged = [...pageItems];
      for (const topic of htmlResult.items) {
        if (!seen.has(topic.id)) {
          seen.add(topic.id);
          merged.push(topic);
        }
      }
      pageItems = sortTopicsByTime(merged).slice(0, limit);
      hasMore = hasMore || htmlResult.hasMore || merged.length > limit;
    }
  }
  return {
    items: pageItems,
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
}

export async function getV2exCategories(options: V2exOptions & { nocache?: boolean } = {}): Promise<CategoriesResponse> {
  const data = await loadLatest(options);
  const seen = new Set<string>();
  const items = data.map((topic) => {
    if (!isRecord(topic) || !isRecord(topic.node)) {
      return null;
    }
    const id = String(topic.node.name || topic.node.title || '').trim();
    const name = String(topic.node.title || topic.node.name || '').trim();
    return id && name ? { source: 'v2ex' as const, id, name } : null;
  }).filter((item): item is { source: 'v2ex'; id: string; name: string } => {
    if (!item || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
  return { items, errors: {} };
}

function normalizeReply(raw: unknown, index: number): Reply | null {
  if (!isRecord(raw)) {
    return null;
  }
  const member = isRecord(raw.member) ? raw.member : {};
  const contentHtml = sanitizeContentHtml(raw.content_rendered || raw.content || '', BASE_URL);
  const commentId = typeof raw.id === 'number' ? raw.id : parsePositiveInteger(raw.id);
  const replyTargetAuthor = v2exReplyTargetAuthor(raw.content_rendered || raw.content || contentHtml);
  return {
    author: String(member.username || ''),
    authorId: typeof member.username === 'string' ? member.username : undefined,
    authorAvatar: absoluteUrl(member.avatar_large || member.avatar_normal || member.avatar_mini, BASE_URL),
    authorUrl: typeof member.username === 'string' ? memberUrl(member.username) : undefined,
    contentHtml,
    createdAt: toIsoString(raw.created),
    floor: index + 1,
    ...(commentId ? { commentId } : {}),
    ...(replyTargetAuthor ? { replyTargetAuthor } : {})
  };
}

function mergeV2exReplyMeta(replies: Reply[], detail: V2exHtmlDetail | null) {
  if (!detail) {
    return replies;
  }
  return replies.map((reply, index) => {
    const meta = (reply.commentId ? detail.repliesByCommentId.get(reply.commentId) : undefined)
      || detail.repliesByFloor.get(reply.floor || index + 1);
    if (!meta) {
      return reply;
    }
    return {
      ...reply,
      ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
      ...(meta.floor ? { floor: meta.floor } : {}),
      ...(meta.replyTargetAuthor && !reply.replyTargetAuthor ? { replyTargetAuthor: meta.replyTargetAuthor } : {}),
      ...(typeof meta.thanksCount === 'number' ? { thanksCount: meta.thanksCount } : {})
    };
  });
}

function parseV2exMemberTopics(html: string, username: string, avatar?: string) {
  const root = parseHtml(html);
  return root.querySelectorAll('.cell, .box .item')
    .map((element) => normalizeHtmlTopic(element))
    .filter(Boolean)
    .map((topic) => ({
      ...topic,
      author: topic?.author || username,
      authorId: username,
      authorAvatar: topic?.authorAvatar || avatar,
      authorUrl: memberUrl(username)
    })) as Topic[];
}

function parseV2exAtomFeed(xml: string, username: string, avatar?: string) {
  const data = atomParser.parse(xml);
  const entries = isRecord(data) && isRecord(data.feed)
    ? data.feed.entry
    : [];
  return (Array.isArray(entries) ? entries : [entries])
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      const link = links.find((item) => isRecord(item) && typeof item.href === 'string') || {};
      const href = isRecord(link) ? String(link.href || '') : '';
      const id = href.match(/\/t\/(\d+)/)?.[1] || String(entry.id || '').match(/\/t\/(\d+)/)?.[1];
      const rawTitle = String(entry.title || '').trim();
      const titleMatch = rawTitle.match(/^\[([^\]]+)\]\s*(.+)$/);
      const category = titleMatch ? titleMatch[1].trim() : undefined;
      const title = (titleMatch ? titleMatch[2] : rawTitle).trim();
      if (!id || !title) {
        return null;
      }
      const createdAt = toIsoString(entry.published)
        || toIsoString(entry.updated)
        || new Date().toISOString();
      const updatedAt = toIsoString(entry.updated) || createdAt;
      const content = isRecord(entry.content)
        ? String(entry.content['#cdata'] || entry.content['#text'] || '')
        : String(entry.content || '');
      return {
        source: 'v2ex' as const,
        id,
        title,
        author: username,
        authorId: username,
        authorAvatar: avatar,
        authorUrl: memberUrl(username),
        category,
        url: safeTopicUrl(id, href),
        createdAt,
        lastReplyAt: updatedAt,
        replyCount: Number.parseInt(href.match(/#reply(\d+)/)?.[1] || '0', 10) || 0,
        excerpt: textExcerpt(content)
      };
    })
    .filter(Boolean) as Topic[];
}

async function fetchV2exMemberTopics(username: string, options: V2exOptions) {
  const html = await fetchText(`${memberUrl(username)}/topics`, options).catch(() => '');
  return html ? parseV2exMemberTopics(html, username).slice(0, 30) : [];
}

async function fetchV2exMemberFeedTopics(username: string, avatar: string | undefined, options: V2exOptions) {
  const xml = await fetchText(`${BASE_URL}/feed/member/${encodeURIComponent(username)}.xml`, options).catch(() => '');
  return xml ? parseV2exAtomFeed(xml, username, avatar).slice(0, 30) : [];
}

export async function getV2exUserProfile(id: string, username: string, options: V2exOptions = {}): Promise<UserProfile> {
  const key = (username || id).trim();
  if (!key) {
    throw new Error('V2EX 用户信息不完整');
  }
  const [memberData, memberHtml] = await Promise.all([
    fetchJson<Record<string, unknown>>(`${BASE_URL}/api/members/show.json?username=${encodeURIComponent(key)}`, options),
    fetchText(memberUrl(key), options).catch(() => '')
  ]);
  if (isRecord(memberData) && memberData.status === 'notfound') {
    throw new Error('V2EX 用户不存在');
  }
  const resolvedUsername = String(memberData.username || key);
  const avatar = absoluteUrl(memberData.avatar_large || memberData.avatar_normal || memberData.avatar_mini, BASE_URL);
  const topics = memberHtml ? parseV2exMemberTopics(memberHtml, resolvedUsername, avatar) : [];
  const topicsPageTopics = topics.length ? topics : await fetchV2exMemberTopics(resolvedUsername, options);
  const feedTopics = topicsPageTopics.length ? topicsPageTopics : await fetchV2exMemberFeedTopics(resolvedUsername, avatar, options);
  const profileTopics = sortTopicsByCreatedAt(feedTopics).slice(0, 30);
  return {
    source: 'v2ex',
    id: resolvedUsername,
    username: resolvedUsername,
    displayName: resolvedUsername,
    avatar,
    url: memberUrl(resolvedUsername),
    bio: typeof memberData.tagline === 'string' ? memberData.tagline : undefined,
    topics: profileTopics,
    topicCount: profileTopics.length || undefined,
    postCount: profileTopics.length || undefined
  };
}

export async function getV2exTopic(id: string, options: V2exOptions & { replyLimit?: number } = {}): Promise<TopicDetail> {
  const [topicData, replyResult, detailHtml] = await Promise.all([
    fetchJson<unknown[]>(`${BASE_URL}/api/topics/show.json?id=${encodeURIComponent(id)}`, options),
    fetchJson<unknown[]>(`${BASE_URL}/api/replies/show.json?topic_id=${encodeURIComponent(id)}&page=1`, options)
      .then((data) => ({ data }))
      .catch((error: unknown) => ({ error })),
    fetchText(`${BASE_URL}/t/${encodeURIComponent(id)}`, options).catch(() => '')
  ]);
  const topic = normalizeApiTopic(Array.isArray(topicData) ? topicData[0] : null);
  if (!topic) {
    throw new Error('V2EX 主题不存在');
  }
  const rawTopic = Array.isArray(topicData) && isRecord(topicData[0]) ? topicData[0] : {};
  const htmlDetail = detailHtml ? parseV2exHtmlDetail(detailHtml) : null;
  const apiContentHtml = sanitizeContentHtml(rawTopic.content_rendered || rawTopic.content || '', BASE_URL);
  const htmlAccessRequirement = detailHtml && !textContentFromHtml(apiContentHtml) ? v2exHtmlAccessRequirement(detailHtml) : undefined;
  const apiReplies = 'data' in replyResult && Array.isArray(replyResult.data)
    ? mergeV2exReplyMeta(replyResult.data.map(normalizeReply).filter(Boolean) as Reply[], htmlDetail)
    : [];
  if (!apiReplies.length && 'error' in replyResult && topic.replyCount > 0 && !htmlDetail?.replies.length) {
    throw replyResult.error instanceof Error ? replyResult.error : new Error(String(replyResult.error || 'V2EX 回复读取失败'));
  }
  const replies = apiReplies.length ? apiReplies : htmlDetail?.replies || [];
  return {
    ...topic,
    ...(htmlDetail?.viewCount ? { viewCount: htmlDetail.viewCount } : {}),
    ...(htmlDetail?.tags.length ? { tags: htmlDetail.tags } : {}),
    replyCount: replies.length || topic.replyCount,
    contentHtml: appendV2exSupplementHtml(
      apiContentHtml,
      htmlDetail?.supplementHtml || ''
    ),
    replies,
    replyHasMore: false,
    replyNextPage: null,
    ...(!topic.accessRequirement && htmlAccessRequirement ? { accessRequirement: htmlAccessRequirement } : {})
  };
}

function sov2exHits(data: unknown) {
  if (Array.isArray(data)) {
    return data;
  }
  if (isRecord(data) && Array.isArray(data.hits)) {
    return data.hits;
  }
  if (isRecord(data) && isRecord(data.hits) && Array.isArray(data.hits.hits)) {
    return data.hits.hits;
  }
  if (isRecord(data) && Array.isArray(data.data)) {
    return data.data;
  }
  return [];
}

function sov2exTotal(data: unknown) {
  if (!isRecord(data)) {
    return undefined;
  }
  if (typeof data.total === 'number') {
    return data.total;
  }
  if (isRecord(data.hits)) {
    if (typeof data.hits.total === 'number') {
      return data.hits.total;
    }
    if (isRecord(data.hits.total) && typeof data.hits.total.value === 'number') {
      return data.hits.total.value;
    }
  }
  return undefined;
}

function highlightText(highlight: unknown) {
  if (!isRecord(highlight)) {
    return '';
  }
  for (const key of ['title', 'content', 'reply_list.content', 'postscript_list.content']) {
    const value = highlight[key];
    if (Array.isArray(value) && value.length) {
      return value.join(' ');
    }
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

export async function searchV2ex(query: string, options: V2exOptions & { limit?: number; page?: number; sort?: SearchSort; filter?: V2exSearchFilter } = {}): Promise<SearchResponse> {
  const limit = options.limit || 30;
  const page = options.page || 1;
  const from = Math.max(0, page - 1) * limit;
  const activeSort = options.filter?.sort || options.sort;
  const params = new URLSearchParams({
    q: query,
    size: String(limit),
    from: String(from),
    version: '1.0.1'
  });
  if (activeSort === 'time') {
    params.set('sort', 'created');
    params.set('order', '0');
  } else {
    params.set('sort', 'sumup');
  }
  const filter = options.filter;
  if (filter?.node.trim()) {
    params.set('node', filter.node.trim());
  }
  if (filter?.username.trim()) {
    params.set('username', filter.username.trim().replace(/^@+/, ''));
  }
  if (filter?.operator === 'and') {
    params.set('operator', 'and');
  }
  const gte = filter ? searchTimeRangeStartEpoch(filter.timeRange) : undefined;
  if (gte !== undefined) {
    params.set('gte', String(gte));
  }
  const data = await fetchJson<unknown>(`${SOV2EX_URL}/api/search?${params.toString()}`, options);
  const hits = sov2exHits(data);
  const items = hits.map((hit) => {
    const source = isRecord(hit) && isRecord(hit._source) ? hit._source : isRecord(hit) ? hit : {};
    const id = topicId(source.id);
    if (!id) {
      return null;
    }
    const createdAt = toIsoString(source.created) || new Date().toISOString();
    const accessRequirement = accessRequirementFromObject(source);
    return {
      source: 'v2ex' as const,
      id,
      title: String(source.title || ''),
      author: String(source.member || source.author || ''),
      category: typeof source.node === 'string' && !/^\d+$/.test(source.node) ? source.node : undefined,
      url: `${BASE_URL}/t/${id}`,
      createdAt,
      lastReplyAt: createdAt,
      replyCount: Number(source.replies || 0),
      excerpt: textExcerpt(highlightText(isRecord(hit) ? hit.highlight : undefined) || source.content || ''),
      ...(accessRequirement ? { accessRequirement } : {})
    };
  }).filter(Boolean) as Topic[];
  const total = sov2exTotal(data);
  const hasMore = typeof total === 'number'
    ? total > from + hits.length
    : hits.length >= limit;
  return {
    items,
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
}
