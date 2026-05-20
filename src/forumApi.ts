import { normalizeServerUrl } from './syncClient';
import type {
  CategoriesResponse,
  FeedSource,
  FeedResponse,
  RepliesResponse,
  SearchResponse,
  Category,
  Reply,
  Source,
  TopicDetail
} from './types';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Validator<T> = (data: unknown) => data is T;

const DATA_FORMAT_ERROR = '服务器返回数据格式不正确';
const validSources = new Set<Source>(['v2ex', 'linuxdo', 'nodeseek']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isSource(value: unknown): value is Source {
  return isString(value) && validSources.has(value as Source);
}

function isTopic(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return isSource(value.source)
    && isString(value.id)
    && isString(value.title)
    && isString(value.author)
    && isString(value.url)
    && isString(value.createdAt)
    && typeof value.replyCount === 'number';
}

function isReply(value: unknown): value is Reply {
  if (!isRecord(value)) {
    return false;
  }
  return isString(value.author)
    && isString(value.contentHtml)
    && isString(value.createdAt);
}

function isCategory(value: unknown): value is Category {
  if (!isRecord(value)) {
    return false;
  }
  return isSource(value.source)
    && isString(value.id)
    && isString(value.name);
}

const isFeedResponse: Validator<FeedResponse> = (data): data is FeedResponse => (
  isRecord(data) && Array.isArray(data.items) && data.items.every(isTopic)
);

const isCategoriesResponse: Validator<CategoriesResponse> = (data): data is CategoriesResponse => (
  isRecord(data) && Array.isArray(data.items) && data.items.every(isCategory)
);

const isTopicDetail: Validator<TopicDetail> = (data): data is TopicDetail => (
  isTopic(data)
    && isRecord(data)
    && isString(data.contentHtml)
    && Array.isArray(data.replies)
    && data.replies.every(isReply)
);

const isRepliesResponse: Validator<RepliesResponse> = (data): data is RepliesResponse => (
  isRecord(data) && Array.isArray(data.items) && data.items.every(isReply)
);

const isSearchResponse: Validator<SearchResponse> = (data): data is SearchResponse => (
  isRecord(data) && Array.isArray(data.items) && data.items.every(isTopic)
);

async function fetchJson<T>(url: string, fetcher: Fetcher = fetch, validator?: Validator<T>) {
  const response = await fetcher(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  if (validator && !validator(data)) {
    throw new Error(DATA_FORMAT_ERROR);
  }
  return data as T;
}

export function getFeed({
  serverUrl,
  source,
  page = 1,
  limit = 20,
  cursor,
  category,
  nocache = false,
  fetcher
}: {
  serverUrl: string;
  source: FeedSource;
  page?: number;
  limit?: number;
  cursor?: string;
  category?: string;
  nocache?: boolean;
  fetcher?: Fetcher;
}) {
  const params = new URLSearchParams({
    source,
    limit: String(limit),
    page: String(page)
  });
  if (cursor) {
    params.set('cursor', cursor);
  }
  if (category) {
    params.set('category', category);
  }
  if (nocache) {
    params.set('nocache', '1');
  }
  return fetchJson<FeedResponse>(`${normalizeServerUrl(serverUrl)}/api/feed?${params.toString()}`, fetcher, isFeedResponse);
}

export function getCategories({
  serverUrl,
  source = 'all',
  fetcher
}: {
  serverUrl: string;
  source?: FeedSource;
  fetcher?: Fetcher;
}) {
  const params = new URLSearchParams({ source });
  return fetchJson<CategoriesResponse>(`${normalizeServerUrl(serverUrl)}/api/categories?${params.toString()}`, fetcher, isCategoriesResponse);
}

export function getTopic({
  serverUrl,
  source,
  id,
  nocache = false,
  fetcher
}: {
  serverUrl: string;
  source: Source;
  id: string;
  nocache?: boolean;
  fetcher?: Fetcher;
}) {
  const params = new URLSearchParams();
  if (nocache) {
    params.set('nocache', '1');
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<TopicDetail>(`${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}${query}`, fetcher, isTopicDetail);
}

export function getReplies({
  serverUrl,
  source,
  id,
  page,
  limit = 20,
  offset,
  nocache = false,
  fetcher
}: {
  serverUrl: string;
  source: Source;
  id: string;
  page: number;
  limit?: number;
  offset?: number | null;
  nocache?: boolean;
  fetcher?: Fetcher;
}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });
  if (typeof offset === 'number') {
    params.set('offset', String(offset));
  }
  if (nocache) {
    params.set('nocache', '1');
  }
  return fetchJson<RepliesResponse>(`${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}/replies?${params.toString()}`, fetcher, isRepliesResponse);
}

export function getReply({
  serverUrl,
  source,
  id,
  floor,
  nocache = false,
  fetcher
}: {
  serverUrl: string;
  source: Source;
  id: string;
  floor: number;
  nocache?: boolean;
  fetcher?: Fetcher;
}) {
  const params = new URLSearchParams();
  if (nocache) {
    params.set('nocache', '1');
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<Reply>(`${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}/replies/${encodeURIComponent(String(floor))}${query}`, fetcher, isReply);
}

export function searchTopics({
  serverUrl,
  source,
  query,
  limit = 20,
  fetcher
}: {
  serverUrl: string;
  source: FeedSource;
  query: string;
  limit?: number;
  fetcher?: Fetcher;
}) {
  const params = new URLSearchParams({
    q: query.trim(),
    source,
    limit: String(limit)
  });
  return fetchJson<SearchResponse>(`${normalizeServerUrl(serverUrl)}/api/search?${params.toString()}`, fetcher, isSearchResponse);
}

export function getNodeSeekFeed(options: Omit<Parameters<typeof getFeed>[0], 'source'>) {
  return getFeed({ ...options, source: 'nodeseek' });
}

export function getNodeSeekCategories(options: Omit<Parameters<typeof getCategories>[0], 'source'>) {
  return getCategories({ ...options, source: 'nodeseek' });
}

export function getNodeSeekTopic(options: Omit<Parameters<typeof getTopic>[0], 'source'>) {
  return getTopic({ ...options, source: 'nodeseek' });
}

export function getNodeSeekReplies(options: Omit<Parameters<typeof getReplies>[0], 'source'>) {
  return getReplies({ ...options, source: 'nodeseek' });
}

export function getNodeSeekSearch(options: Omit<Parameters<typeof searchTopics>[0], 'source'>) {
  return searchTopics({ ...options, source: 'nodeseek' });
}
