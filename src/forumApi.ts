import { normalizeServerUrl } from './syncClient';
import type {
  CategoriesResponse,
  FeedSource,
  FeedResponse,
  RepliesResponse,
  SearchResponse,
  Reply,
  Source,
  TopicDetail
} from './types';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function fetchJson<T>(url: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
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
  return fetchJson<FeedResponse>(`${normalizeServerUrl(serverUrl)}/api/feed?${params.toString()}`, fetcher);
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
  return fetchJson<CategoriesResponse>(`${normalizeServerUrl(serverUrl)}/api/categories?${params.toString()}`, fetcher);
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
  return fetchJson<TopicDetail>(`${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}${query}`, fetcher);
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
  return fetchJson<RepliesResponse>(`${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}/replies?${params.toString()}`, fetcher);
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
  return fetchJson<Reply>(`${normalizeServerUrl(serverUrl)}/api/topic/${source}/${encodeURIComponent(id)}/replies/${encodeURIComponent(String(floor))}${query}`, fetcher);
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
  return fetchJson<SearchResponse>(`${normalizeServerUrl(serverUrl)}/api/search?${params.toString()}`, fetcher);
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
