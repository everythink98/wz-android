import { getLinuxDoCategories, getLinuxDoFeed, getLinuxDoReplies, getLinuxDoReply, getLinuxDoTopic, searchLinuxDo } from './localLinuxdo';
import { getNodeSeekCategories, getNodeSeekFeed, getNodeSeekReplies, getNodeSeekTopic, searchNodeSeek } from './localNodeseek';
import { yaohuoCategoriesResponse, parseYaohuoListHtml, parseYaohuoRepliesHtml as parseLocalYaohuoRepliesHtml, parseYaohuoSearchHtml as parseLocalYaohuoSearchHtml, parseYaohuoTopicHtml as parseLocalYaohuoTopicHtml, checkYaohuoLoginHtml } from './localYaohuo';
import { getV2exCategories, getV2exFeed, getV2exTopic, searchV2ex } from './localV2ex';
import type {
  CategoriesResponse,
  FeedResponse,
  FeedSource,
  Reply,
  RepliesResponse,
  SearchResponse,
  Source,
  TopicDetail
} from './types';
import type { Fetcher } from './request';

interface RequestOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function mergeErrors(results: Array<PromiseSettledResult<{ errors?: Partial<Record<FeedSource, string>> }>>, sources: Source[]) {
  const errors: Partial<Record<FeedSource, string>> = {};
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      Object.assign(errors, result.value.errors || {});
    } else {
      errors[sources[index]] = result.reason instanceof Error ? result.reason.message : String(result.reason || '读取失败');
    }
  });
  return errors;
}

function sortByTime<T extends { createdAt: string; lastReplyAt?: string }>(items: T[]) {
  return [...items].sort((left, right) => (
    Date.parse(right.lastReplyAt || right.createdAt || '') - Date.parse(left.lastReplyAt || left.createdAt || '')
  ));
}

function pickSource(source: Source, handlers: Record<Source, () => Promise<unknown>>) {
  return handlers[source]();
}

export async function getFeed({
  source,
  page = 1,
  limit = 20,
  category,
  nocache = false,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl?: string;
  source: FeedSource;
  page?: number;
  limit?: number;
  cursor?: string;
  category?: string;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const options = { page, limit, category, nocache, fetcher, signal, timeoutMs };
  if (source === 'all') {
    const sources: Source[] = ['nodeseek', 'linuxdo', 'v2ex'];
    const results = await Promise.allSettled([
      getNodeSeekFeed(options),
      getLinuxDoFeed(options),
      getV2exFeed(options)
    ]);
    const items = sortByTime(results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : []));
    const hasMore = results.some((result) => result.status === 'fulfilled' && result.value.hasMore);
    return {
      items: items.slice(0, limit),
      errors: mergeErrors(results, sources),
      hasMore,
      nextPage: hasMore ? page + 1 : null
    };
  }
  if (source === 'yaohuo') {
    return {
      items: [],
      errors: { yaohuo: '请先登录妖火' },
      hasMore: false,
      nextPage: null
    };
  }
  return pickSource(source, {
    nodeseek: () => getNodeSeekFeed(options),
    linuxdo: () => getLinuxDoFeed(options),
    v2ex: () => getV2exFeed(options),
    yaohuo: async () => ({ items: [], errors: { yaohuo: '请先登录妖火' }, hasMore: false, nextPage: null })
  }) as Promise<FeedResponse>;
}

export async function getCategories({
  source = 'all',
  nocache = false,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl?: string;
  source?: FeedSource;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<CategoriesResponse> {
  const options = { nocache, fetcher, signal, timeoutMs };
  if (source === 'all') {
    const sources: Source[] = ['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'];
    const results = await Promise.allSettled([
      getNodeSeekCategories(options),
      getLinuxDoCategories(options),
      getV2exCategories(options),
      Promise.resolve(yaohuoCategoriesResponse())
    ]);
    return {
      items: results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : []),
      errors: mergeErrors(results, sources)
    };
  }
  if (source === 'yaohuo') {
    return yaohuoCategoriesResponse();
  }
  return pickSource(source, {
    nodeseek: () => getNodeSeekCategories(options),
    linuxdo: () => getLinuxDoCategories(options),
    v2ex: () => getV2exCategories(options),
    yaohuo: () => Promise.resolve(yaohuoCategoriesResponse())
  }) as Promise<CategoriesResponse>;
}

export function getTopic({
  source,
  id,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl?: string;
  source: Source;
  id: string;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  const options = { fetcher, signal, timeoutMs };
  return pickSource(source, {
    nodeseek: () => getNodeSeekTopic(id, options),
    linuxdo: () => getLinuxDoTopic(id, options),
    v2ex: () => getV2exTopic(id, options),
    yaohuo: async () => { throw new Error('请先登录妖火'); }
  }) as Promise<TopicDetail>;
}

export function getReplies({
  source,
  id,
  page,
  limit = 20,
  offset,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl?: string;
  source: Source;
  id: string;
  page: number;
  limit?: number;
  offset?: number | null;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const options = { page, limit, offset, fetcher, signal, timeoutMs };
  return pickSource(source, {
    nodeseek: () => getNodeSeekReplies(id, options),
    linuxdo: () => getLinuxDoReplies(id, options),
    v2ex: async () => ({ items: [], hasMore: false, nextPage: null }),
    yaohuo: async () => { throw new Error('请先登录妖火'); }
  }) as Promise<RepliesResponse>;
}

export function getReply({
  source,
  id,
  floor,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl?: string;
  source: Source;
  id: string;
  floor: number;
  nocache?: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Reply> {
  if (source !== 'linuxdo') {
    throw new Error('该来源不支持按楼层读取引用');
  }
  return getLinuxDoReply(id, floor, { fetcher, signal, timeoutMs });
}

export async function searchTopics({
  source,
  query,
  limit = 20,
  fetcher,
  signal,
  timeoutMs
}: {
  serverUrl?: string;
  source: FeedSource;
  query: string;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  const options = { limit, fetcher, signal, timeoutMs };
  if (source === 'all') {
    const sources: Source[] = ['nodeseek', 'linuxdo', 'v2ex'];
    const results = await Promise.allSettled([
      searchNodeSeek(query, options),
      searchLinuxDo(query, options),
      searchV2ex(query, options)
    ]);
    return {
      items: sortByTime(results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : [])).slice(0, limit),
      errors: mergeErrors(results, sources)
    };
  }
  if (source === 'yaohuo') {
    return { items: [], errors: { yaohuo: '请先登录妖火' } };
  }
  return pickSource(source, {
    nodeseek: () => searchNodeSeek(query, options),
    linuxdo: () => searchLinuxDo(query, options),
    v2ex: () => searchV2ex(query, options),
    yaohuo: async () => ({ items: [], errors: { yaohuo: '请先登录妖火' } })
  }) as Promise<SearchResponse>;
}

export interface YaohuoLoginCheckResponse {
  source: 'yaohuo';
  ok: boolean;
  loginRequired: boolean;
  reason?: string;
  loginUrl: string;
  message?: string;
}

export function parseYaohuoFeedHtml({
  html,
  category,
  url,
  page = 1,
  limit = 20
}: {
  serverUrl?: string;
  html: string;
  category?: string;
  url?: string;
  page?: number;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return Promise.resolve().then(() => parseYaohuoListHtml(html, { classId: category, url, page, limit }));
}

export function parseYaohuoSearchHtml({
  html,
  url,
  page = 1,
  limit = 20
}: {
  serverUrl?: string;
  html: string;
  url?: string;
  page?: number;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return Promise.resolve().then(() => parseLocalYaohuoSearchHtml(html, { url, page, limit }));
}

export function parseYaohuoTopicHtml({
  html,
  id,
  url
}: {
  serverUrl?: string;
  html: string;
  id: string;
  url?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return Promise.resolve().then(() => parseLocalYaohuoTopicHtml(html, { id, url }));
}

export function parseYaohuoRepliesHtml({
  html,
  url,
  page,
  limit = 20
}: {
  serverUrl?: string;
  html: string;
  url?: string;
  page: number;
  limit?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return Promise.resolve().then(() => parseLocalYaohuoRepliesHtml(html, { url, page, limit }));
}

export function parseYaohuoLoginHtml({
  html,
  url
}: {
  serverUrl?: string;
  html: string;
  url?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return Promise.resolve(checkYaohuoLoginHtml(html, url));
}
