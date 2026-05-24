import { fetchWithTimeout, type Fetcher } from './request';
import type { CategoriesResponse, FeedResponse, Reply, SearchResponse, Topic, TopicDetail } from './types';
import {
  absoluteUrl,
  accessRequirementFromObject,
  accessRequirementFromText,
  elementText,
  isRecord,
  parseHtml,
  sanitizeContentHtml,
  sortTopicsByTime,
  textExcerpt,
  toIsoString
} from './localHtml';

const BASE_URL = 'https://www.v2ex.com';
const SOV2EX_URL = 'https://www.sov2ex.com';
const HTML_LIST_PAGE_SIZE = 20;
const latestCache: { savedAt: number; data: unknown[] } = { savedAt: 0, data: [] };

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
  const avatar = element.querySelector('img.avatar')?.getAttribute('src');
  const timestamp = element.querySelector('span[title]')?.getAttribute('title');
  const countText = element.querySelector('.count_livid,.count_orange')?.text || '';
  const createdAt = toIsoString(timestamp) || new Date().toISOString();
  const accessRequirement = accessRequirementFromText(elementText(element).replace(title, ' '));
  return {
    source: 'v2ex',
    id,
    title,
    author: elementText(memberLink),
    authorAvatar: absoluteUrl(avatar, BASE_URL),
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
    authorAvatar: absoluteUrl(member.avatar_large || member.avatar_normal || member.avatar_mini, BASE_URL),
    contentHtml: sanitizeContentHtml(raw.content_rendered || raw.content || '', BASE_URL),
    createdAt: toIsoString(raw.created),
    floor: index + 1
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

export async function searchV2ex(query: string, options: V2exOptions & { limit?: number; page?: number } = {}): Promise<SearchResponse> {
  const limit = options.limit || 30;
  const page = options.page || 1;
  const from = Math.max(0, page - 1) * limit;
  const params = new URLSearchParams({
    q: query,
    size: String(limit),
    from: String(from),
    sort: 'sumup',
    order: '0'
  });
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
