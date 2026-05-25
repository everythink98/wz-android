import { fetchWithTimeout, type Fetcher } from './request';
import type { SearchSort } from './feedLogic';
import { XMLParser } from 'fast-xml-parser';
import type { CategoriesResponse, FeedResponse, Reply, SearchResponse, Topic, TopicDetail, UserProfile } from './types';
import {
  absoluteUrl,
  accessRequirementFromObject,
  accessRequirementFromText,
  elementText,
  isRecord,
  parseHtml,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  sortTopicsByTime,
  textExcerpt,
  toIsoString
} from './localHtml';

const BASE_URL = 'https://www.v2ex.com';
const SOV2EX_URL = 'https://www.sov2ex.com';
const HTML_LIST_PAGE_SIZE = 20;
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

function isV2exHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'v2ex.com' || host.endsWith('.v2ex.com');
}

function safeTopicUrl(id: string, raw?: unknown) {
  const fallback = `${BASE_URL}/t/${id}`;
  const url = absoluteUrl(raw, BASE_URL) || fallback;
  try {
    return isV2exHost(new URL(url).hostname) ? url : fallback;
  } catch {
    return fallback;
  }
}

function memberUrl(username: string) {
  return `${BASE_URL}/member/${encodeURIComponent(username)}`;
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

function nodeIdFromHref(href?: string) {
  const match = String(href || '').match(/\/go\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
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
  const memberLink = element.querySelector('a[href^="/member/"]');
  const memberHref = memberLink?.getAttribute('href') || '';
  const memberName = elementText(memberLink);
  const avatar = element.querySelector('img.avatar')?.getAttribute('src');
  const timestamp = element.querySelector('span[title]')?.getAttribute('title');
  const countText = element.querySelector('.count_livid,.count_orange')?.text || '';
  const createdAt = toIsoString(timestamp) || new Date().toISOString();
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

function safeNodePath(category?: string) {
  if (!category) {
    return '/recent';
  }
  return /^[a-zA-Z0-9_-]+$/.test(category) ? `/go/${category}` : null;
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
  const start = (options.page - 1) * options.limit;
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
  if (options.category || page > 1) {
    const htmlResult = await fetchHtmlWindow({ ...options, page, limit });
    if (htmlResult) {
      return { ...htmlResult, errors: {} };
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
  return {
    author: String(member.username || ''),
    authorId: typeof member.username === 'string' ? member.username : undefined,
    authorAvatar: absoluteUrl(member.avatar_large || member.avatar_normal || member.avatar_mini, BASE_URL),
    authorUrl: typeof member.username === 'string' ? memberUrl(member.username) : undefined,
    contentHtml: sanitizeContentHtml(raw.content_rendered || raw.content || '', BASE_URL),
    createdAt: toIsoString(raw.created),
    floor: index + 1
  };
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
  const [topicData, replyData] = await Promise.all([
    fetchJson<unknown[]>(`${BASE_URL}/api/topics/show.json?id=${encodeURIComponent(id)}`, options),
    fetchJson<unknown[]>(`${BASE_URL}/api/replies/show.json?topic_id=${encodeURIComponent(id)}&page=1`, options)
  ]);
  const topic = normalizeApiTopic(Array.isArray(topicData) ? topicData[0] : null);
  if (!topic) {
    throw new Error('V2EX 主题不存在');
  }
  const rawTopic = Array.isArray(topicData) && isRecord(topicData[0]) ? topicData[0] : {};
  return {
    ...topic,
    contentHtml: sanitizeContentHtml(rawTopic.content_rendered || rawTopic.content || '', BASE_URL),
    replies: (Array.isArray(replyData) ? replyData : []).map(normalizeReply).filter(Boolean) as Reply[],
    replyHasMore: false,
    replyNextPage: null
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

export async function searchV2ex(query: string, options: V2exOptions & { limit?: number; page?: number; sort?: SearchSort } = {}): Promise<SearchResponse> {
  const limit = options.limit || 30;
  const page = options.page || 1;
  const from = Math.max(0, page - 1) * limit;
  const params = new URLSearchParams({
    q: query,
    size: String(limit),
    from: String(from),
    version: '1.0.1'
  });
  if (options.sort === 'time') {
    params.set('sort', 'created');
    params.set('order', '0');
  } else {
    params.set('sort', 'sumup');
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

export function clearV2exCacheForTest() {
  latestCache.savedAt = 0;
  latestCache.data = [];
}
