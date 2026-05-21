import { normalizeServerUrl } from './syncClient';
import { fetchWithTimeout, type Fetcher } from './request';
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

type Validator<T> = (data: unknown) => data is T;
interface RequestOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DATA_FORMAT_ERROR = '服务器返回数据格式不正确';
const validSources = new Set<Source>(['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown) {
  return value === undefined || typeof value === 'number';
}

function isOptionalBoolean(value: unknown) {
  return value === undefined || typeof value === 'boolean';
}

function isNullableNumber(value: unknown) {
  return typeof value === 'number' || value === null;
}

function isOptionalNullableNumber(value: unknown) {
  return value === undefined || isNullableNumber(value);
}

function isOptionalNullableString(value: unknown) {
  return value === undefined || typeof value === 'string' || value === null;
}

function isSource(value: unknown): value is Source {
  return isString(value) && validSources.has(value as Source);
}

function isErrorMap(value: unknown) {
  return isRecord(value)
    && Object.entries(value).every(([source, message]) => isSource(source) && isString(message));
}

function isOptionalNumberArray(value: unknown) {
  return value === undefined
    || (Array.isArray(value) && value.every((item) => typeof item === 'number'));
}

function isVoteOption(value: unknown) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.label)
    && isOptionalNumber(value.count);
}

function isOptionalVoteOptions(value: unknown) {
  return value === undefined
    || (Array.isArray(value) && value.every(isVoteOption));
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
    && typeof value.replyCount === 'number'
    && isOptionalString(value.authorAvatar)
    && isOptionalString(value.categoryId)
    && isOptionalString(value.category)
    && isOptionalString(value.lastReplyAt)
    && isOptionalNumber(value.viewCount)
    && isOptionalString(value.excerpt);
}

function isReply(value: unknown): value is Reply {
  if (!isRecord(value)) {
    return false;
  }
  return isString(value.author)
    && isString(value.contentHtml)
    && isString(value.createdAt)
    && isOptionalString(value.authorId)
    && isOptionalString(value.authorAvatar)
    && isOptionalNumber(value.floor)
    && isOptionalNumberArray(value.quotedFloors)
    && isOptionalNumber(value.commentId)
    && isOptionalNumber(value.upvoteCount)
    && isOptionalNumber(value.likeCount)
    && isOptionalBoolean(value.upvoted)
    && isOptionalBoolean(value.liked);
}

function isCategory(value: unknown): value is Category {
  if (!isRecord(value)) {
    return false;
  }
  return isSource(value.source)
    && isString(value.id)
    && isString(value.name)
    && isOptionalString(value.slug)
    && isOptionalString(value.description)
    && isOptionalString(value.parentCategoryId)
    && isOptionalNumber(value.topicCount);
}

const isFeedResponse: Validator<FeedResponse> = (data): data is FeedResponse => (
  isRecord(data)
    && Array.isArray(data.items)
    && data.items.every(isTopic)
    && isErrorMap(data.errors)
    && isOptionalBoolean(data.hasMore)
    && isOptionalNullableNumber(data.nextPage)
    && isOptionalNullableString(data.nextCursor)
);

const isCategoriesResponse: Validator<CategoriesResponse> = (data): data is CategoriesResponse => (
  isRecord(data)
    && Array.isArray(data.items)
    && data.items.every(isCategory)
    && isErrorMap(data.errors)
);

const isTopicDetail: Validator<TopicDetail> = (data): data is TopicDetail => (
  isTopic(data)
    && isRecord(data)
    && isString(data.contentHtml)
    && Array.isArray(data.replies)
    && data.replies.every(isReply)
    && isOptionalVoteOptions(data.voteOptions)
    && isOptionalBoolean(data.replyHasMore)
    && isOptionalNullableNumber(data.replyNextPage)
    && isOptionalNullableNumber(data.replyNextOffset)
    && isOptionalNumber(data.commentId)
    && isOptionalNumber(data.upvoteCount)
    && isOptionalNumber(data.likeCount)
    && isOptionalBoolean(data.upvoted)
    && isOptionalBoolean(data.liked)
);

const isRepliesResponse: Validator<RepliesResponse> = (data): data is RepliesResponse => (
  isRecord(data)
    && Array.isArray(data.items)
    && data.items.every(isReply)
    && typeof data.hasMore === 'boolean'
    && isNullableNumber(data.nextPage)
    && isOptionalNullableNumber(data.nextOffset)
);

const isSearchResponse: Validator<SearchResponse> = (data): data is SearchResponse => (
  isRecord(data)
    && Array.isArray(data.items)
    && data.items.every(isTopic)
    && isErrorMap(data.errors)
);

async function fetchJson<T>(url: string, validator?: Validator<T>, init?: RequestInit, options: RequestOptions = {}) {
  const response = await fetchWithTimeout(url, init, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `HTTP ${response.status}`);
    Object.assign(error, data);
    throw error;
  }
  if (validator && !validator(data)) {
    throw new Error(DATA_FORMAT_ERROR);
  }
  return data as T;
}

function postJson<T>(url: string, payload: Record<string, unknown>, validator?: Validator<T>, options: RequestOptions = {}) {
  return fetchJson<T>(url, validator, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }, options);
}

function sanitizeYaohuoParserUrl(url?: string) {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isYaohuoSessionParam(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isYaohuoSessionParam(key: string) {
  return ['sid', 'sidyaohuo', 'session', 'sessionid', 'token'].includes(key.toLowerCase());
}

export function getFeed({
  serverUrl,
  source,
  page = 1,
  limit = 20,
  cursor,
  category,
  nocache = false,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  source: FeedSource;
  page?: number;
  limit?: number;
  cursor?: string;
  category?: string;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
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
  return fetchJson<FeedResponse>(
    `${normalizeServerUrl(serverUrl)}/api/feed?${params.toString()}`,
    isFeedResponse,
    undefined,
    { fetcher, signal, timeoutMs }
  );
}
export function getCategories({
  serverUrl,
  source = 'all',
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  source?: FeedSource;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const params = new URLSearchParams({ source });
  return fetchJson<CategoriesResponse>(
    `${normalizeServerUrl(serverUrl)}/api/categories?${params.toString()}`,
    isCategoriesResponse,
    undefined,
    { fetcher, signal, timeoutMs }
  );
}

export function getTopic({
  serverUrl,
  source,
  id,
  nocache = false,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  source: Source;
  id: string;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const params = new URLSearchParams();
  if (nocache) {
    params.set('nocache', '1');
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<TopicDetail>(
    `${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}${query}`,
    isTopicDetail,
    undefined,
    { fetcher, signal, timeoutMs }
  );
}

export function getReplies({
  serverUrl,
  source,
  id,
  page,
  limit = 20,
  offset,
  nocache = false,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  source: Source;
  id: string;
  page: number;
  limit?: number;
  offset?: number | null;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
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
  return fetchJson<RepliesResponse>(
    `${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}/replies?${params.toString()}`,
    isRepliesResponse,
    undefined,
    { fetcher, signal, timeoutMs }
  );
}

export function getReply({
  serverUrl,
  source,
  id,
  floor,
  nocache = false,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  source: Source;
  id: string;
  floor: number;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const params = new URLSearchParams();
  if (nocache) {
    params.set('nocache', '1');
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<Reply>(
    `${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}/replies/${encodeURIComponent(String(floor))}${query}`,
    isReply,
    undefined,
    { fetcher, signal, timeoutMs }
  );
}

export function searchTopics({
  serverUrl,
  source,
  query,
  limit = 20,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  source: FeedSource;
  query: string;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const params = new URLSearchParams({
    q: query.trim(),
    source,
    limit: String(limit)
  });
  return fetchJson<SearchResponse>(
    `${normalizeServerUrl(serverUrl)}/api/search?${params.toString()}`,
    isSearchResponse,
    undefined,
    { fetcher, signal, timeoutMs }
  );
}

export interface YaohuoLoginCheckResponse {
  source: 'yaohuo';
  ok: boolean;
  loginRequired: boolean;
  reason?: string;
  loginUrl: string;
  message?: string;
}

const isYaohuoLoginCheckResponse: Validator<YaohuoLoginCheckResponse> = (data): data is YaohuoLoginCheckResponse => (
  isRecord(data)
    && data.source === 'yaohuo'
    && typeof data.ok === 'boolean'
    && typeof data.loginRequired === 'boolean'
    && isString(data.loginUrl)
);

export function parseYaohuoFeedHtml({
  serverUrl,
  html,
  category,
  url,
  page = 1,
  limit = 20,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  html: string;
  category?: string;
  url?: string;
  page?: number;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return postJson<FeedResponse>(
    `${normalizeServerUrl(serverUrl)}/api/yaohuo/parse/feed`,
    {
      html,
      category,
      url: sanitizeYaohuoParserUrl(url),
      page,
      limit
    },
    isFeedResponse,
    { fetcher, signal, timeoutMs }
  );
}

export function parseYaohuoSearchHtml({
  serverUrl,
  html,
  url,
  page = 1,
  limit = 20,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  html: string;
  url?: string;
  page?: number;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return postJson<SearchResponse>(
    `${normalizeServerUrl(serverUrl)}/api/yaohuo/parse/search`,
    {
      html,
      url: sanitizeYaohuoParserUrl(url),
      page,
      limit
    },
    isSearchResponse,
    { fetcher, signal, timeoutMs }
  );
}

export function parseYaohuoTopicHtml({
  serverUrl,
  html,
  id,
  url,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  html: string;
  id: string;
  url?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return postJson<TopicDetail>(
    `${normalizeServerUrl(serverUrl)}/api/yaohuo/parse/topic`,
    {
      html,
      id,
      url: sanitizeYaohuoParserUrl(url)
    },
    isTopicDetail,
    { fetcher, signal, timeoutMs }
  );
}

export function parseYaohuoRepliesHtml({
  serverUrl,
  html,
  url,
  page,
  limit = 20,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  html: string;
  url?: string;
  page: number;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return postJson<RepliesResponse>(
    `${normalizeServerUrl(serverUrl)}/api/yaohuo/parse/replies`,
    {
      html,
      url: sanitizeYaohuoParserUrl(url),
      page,
      limit
    },
    isRepliesResponse,
    { fetcher, signal, timeoutMs }
  );
}

export function parseYaohuoLoginHtml({
  serverUrl,
  html,
  url,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl: string;
  html: string;
  url?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return postJson<YaohuoLoginCheckResponse>(
    `${normalizeServerUrl(serverUrl)}/api/yaohuo/parse/check-login`,
    {
      html,
      url: sanitizeYaohuoParserUrl(url)
    },
    isYaohuoLoginCheckResponse,
    { fetcher, signal, timeoutMs }
  );
}
