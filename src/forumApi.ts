import { getLinuxDoCategories, getLinuxDoFeed, getLinuxDoReplies, getLinuxDoReply, getLinuxDoTopic, getLinuxDoUserProfile, searchLinuxDo } from './localLinuxdo';
import { getNodeSeekCategories, getNodeSeekFeed, getNodeSeekReplies, getNodeSeekTopic, getNodeSeekUserProfile, searchNodeSeek } from './localNodeseek';
import { yaohuoCategoriesResponse, parseYaohuoListHtml, checkYaohuoLoginHtml, parseYaohuoUserProfileHtml } from './localYaohuo';
import { getV2exCategories, getV2exFeed, getV2exTopic, getV2exUserProfile, searchV2ex } from './localV2ex';
import { balanceTopicsBySource, matchesSearchExpression, parseSearchExpression, positiveSearchQuery, searchExpressionText, sortTopicsByCreatedAt, type SearchSort } from './feedLogic';
import type {
  CategoriesResponse,
  FeedResponse,
  FeedSource,
  Reply,
  RepliesResponse,
  SearchResponse,
  Source,
  Topic,
  TopicDetail,
  UserProfile
} from './types';
import { fetchWithTimeout, type Fetcher } from './request';

const allFeedSources: Source[] = ['nodeseek', 'linuxdo', 'v2ex'];

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

type AllFeedCursorState = {
  buffers?: Partial<Record<Source, Topic[]>>;
  nextPages?: Partial<Record<Source, number | null>>;
};

function cursorTopic(value: unknown): Topic | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const topic = value as Partial<Topic>;
  return topic.source
    && topic.id
    && topic.title
    && topic.url
    && topic.createdAt
    ? topic as Topic
    : null;
}

function decodeAllFeedCursor(cursor?: string): AllFeedCursorState {
  if (!cursor) {
    return {};
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor)) as AllFeedCursorState;
    const buffers: Partial<Record<Source, Topic[]>> = {};
    const nextPages: Partial<Record<Source, number | null>> = {};
    for (const source of allFeedSources) {
      const items = Array.isArray(parsed.buffers?.[source])
        ? parsed.buffers[source]?.map(cursorTopic).filter(Boolean) as Topic[]
        : [];
      if (items.length) {
        buffers[source] = items;
      }
      const nextPage = parsed.nextPages?.[source];
      if (typeof nextPage === 'number' && nextPage > 0) {
        nextPages[source] = nextPage;
      }
    }
    return { buffers, nextPages };
  } catch {
    return {};
  }
}

function encodeAllFeedCursor(state: AllFeedCursorState) {
  const buffers: Partial<Record<Source, Topic[]>> = {};
  const nextPages: Partial<Record<Source, number | null>> = {};
  for (const source of allFeedSources) {
    const items = state.buffers?.[source] || [];
    if (items.length) {
      buffers[source] = items;
    }
    const nextPage = state.nextPages?.[source];
    if (typeof nextPage === 'number' && nextPage > 0) {
      nextPages[source] = nextPage;
    }
  }
  if (!Object.keys(buffers).length && !Object.keys(nextPages).length) {
    return undefined;
  }
  return encodeURIComponent(JSON.stringify({ buffers, nextPages }));
}

function topicIdentity(topic: Topic) {
  return `${topic.source}:${topic.id}`;
}

function filterSearchItems(response: SearchResponse, query: string, limit: number): SearchResponse {
  const expression = parseSearchExpression(query);
  return {
    ...response,
    items: response.items.filter((topic) => matchesSearchExpression(searchExpressionText(topic), expression)).slice(0, limit)
  };
}

function pickSource<T>(source: Source, handlers: Partial<Record<Source, () => Promise<T>>>) {
  const handler = handlers[source];
  if (!handler) {
    throw new Error('来源不支持');
  }
  return handler();
}

export async function getFeed({
  source,
  page = 1,
  limit = 20,
  cursor,
  category,
  nocache = false,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  signal,
  timeoutMs
}: {
  source: FeedSource;
  page?: number;
  limit?: number;
  cursor?: string;
  category?: string;
  nocache?: boolean;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const options = { page, limit, category, nocache, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  if (source === 'all') {
    const cursorState = decodeAllFeedCursor(cursor);
    const bufferedItems = allFeedSources.flatMap((item) => cursorState.buffers?.[item] || []);
    const shouldFetchSource = (item: Source) => !cursor || (Boolean(cursorState.nextPages?.[item]) && (cursorState.buffers?.[item]?.length || 0) < limit);
    const adapterLimit = limit * allFeedSources.length;
    const v2exLimit = limit;
    const results = await Promise.allSettled([
      shouldFetchSource('nodeseek')
        ? getNodeSeekFeed({ ...options, limit: adapterLimit, page: cursor ? cursorState.nextPages?.nodeseek || page : page })
        : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: cursorState.nextPages?.nodeseek ?? null }),
      shouldFetchSource('linuxdo')
        ? getLinuxDoFeed({ ...options, limit: adapterLimit, page: cursor ? cursorState.nextPages?.linuxdo || page : page })
        : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: cursorState.nextPages?.linuxdo ?? null }),
      shouldFetchSource('v2ex')
        ? getV2exFeed({ ...options, limit: v2exLimit, page: cursor ? cursorState.nextPages?.v2ex || page : page })
        : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: cursorState.nextPages?.v2ex ?? null })
    ]);
    const items = sortByTime([
      ...bufferedItems,
      ...results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : [])
    ]);
    const selected = balanceTopicsBySource(items).slice(0, limit);
    const selectedKeys = new Set(selected.map(topicIdentity));
    const nextBuffers: Partial<Record<Source, Topic[]>> = {};
    for (const item of items) {
      if (selectedKeys.has(topicIdentity(item))) {
        continue;
      }
      nextBuffers[item.source] = [...(nextBuffers[item.source] || []), item];
    }
    const nextPages: Partial<Record<Source, number | null>> = {};
    allFeedSources.forEach((item, index) => {
      const result = results[index];
      const nextPage = result?.status === 'fulfilled'
        ? result.value.nextPage
        : cursorState.nextPages?.[item];
      if (nextPage) {
        nextPages[item] = nextPage;
      }
    });
    const nextCursor = encodeAllFeedCursor({ buffers: nextBuffers, nextPages });
    return {
      items: selected,
      errors: mergeErrors(results, allFeedSources),
      hasMore: Boolean(nextCursor),
      nextPage: nextCursor ? page + 1 : null,
      nextCursor
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
    v2ex: () => getV2exFeed(options)
  });
}

export async function getCategories({
  source = 'all',
  nocache = false,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  signal,
  timeoutMs
}: {
  source?: FeedSource;
  nocache?: boolean;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<CategoriesResponse> {
  const options = { nocache, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
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
    v2ex: () => getV2exCategories(options)
  });
}

export function getTopic({
  source,
  id,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  nocache?: boolean;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  const options = { fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  return pickSource(source, {
    nodeseek: () => getNodeSeekTopic(id, options),
    linuxdo: () => getLinuxDoTopic(id, options),
    v2ex: () => getV2exTopic(id, options),
    yaohuo: async () => { throw new Error('请先登录妖火'); }
  });
}

export function getReplies({
  source,
  id,
  page,
  limit = 20,
  offset,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  page: number;
  limit?: number;
  offset?: number | null;
  nocache?: boolean;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const options = { page, limit, offset, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  return pickSource(source, {
    nodeseek: () => getNodeSeekReplies(id, options),
    linuxdo: () => getLinuxDoReplies(id, options),
    v2ex: async () => ({ items: [], hasMore: false, nextPage: null }),
    yaohuo: async () => { throw new Error('请先登录妖火'); }
  });
}

export function getReply({
  source,
  id,
  floor,
  fetcher,
  signal,
  timeoutMs
}: {
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

export function getUserProfile({
  source,
  id,
  username,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  yaohuoCookie,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  username?: string;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  yaohuoCookie?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserProfile> {
  const options = { fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  return pickSource(source, {
    nodeseek: () => getNodeSeekUserProfile(id || username || '', options),
    linuxdo: () => getLinuxDoUserProfile(id, username || id, { fetcher, signal, timeoutMs }),
    v2ex: () => getV2exUserProfile(id, username || id, { fetcher, signal, timeoutMs }),
    yaohuo: async () => {
      if (!yaohuoCookie) {
        throw new Error('请先登录妖火');
      }
      const targetId = id || username || '';
      const url = `https://yaohuo.me/bbs/userinfo.aspx?touserid=${encodeURIComponent(targetId)}&siteid=1000`;
      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Cookie: yaohuoCookie,
          Referer: 'https://yaohuo.me/bbs/'
        }
      }, { fetcher, signal, timeoutMs });
      const html = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return parseYaohuoUserProfileHtml(html, {
        id: targetId,
        username,
        url: response.url || url
      });
    }
  });
}

export async function searchTopics({
  source,
  query,
  limit = 20,
  page = 1,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  sort = 'relevance',
  signal,
  timeoutMs
}: {
  source: FeedSource;
  query: string;
  limit?: number;
  page?: number;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  sort?: SearchSort;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  const adapterQuery = positiveSearchQuery(query);
  const adapterLimit = parseSearchExpression(query).exclude.length ? Math.min(100, limit * 3) : limit;
  const options = { limit: adapterLimit, page, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  if (source === 'all') {
    const sources: Source[] = ['nodeseek', 'linuxdo', 'v2ex'];
    const results = await Promise.allSettled([
      searchNodeSeek(adapterQuery, options),
      searchLinuxDo(adapterQuery, options),
      searchV2ex(adapterQuery, options)
    ]);
    const expression = parseSearchExpression(query);
    return {
      items: sortTopicsByCreatedAt(results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : [])
        .filter((topic) => matchesSearchExpression(searchExpressionText(topic), expression)))
        .slice(0, limit),
      errors: mergeErrors(results, sources),
      hasMore: results.some((result) => result.status === 'fulfilled' && result.value.hasMore),
      nextPage: results.some((result) => result.status === 'fulfilled' && result.value.hasMore) ? page + 1 : null
    };
  }
  if (source === 'yaohuo') {
    return { items: [], errors: { yaohuo: '请先登录妖火' }, hasMore: false, nextPage: null };
  }
  const response = await pickSource(source, {
    nodeseek: () => searchNodeSeek(adapterQuery, options),
    linuxdo: () => searchLinuxDo(adapterQuery, options),
    v2ex: () => searchV2ex(adapterQuery, { ...options, sort })
  });
  return filterSearchItems(response, query, limit);
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

export function parseYaohuoLoginHtml({
  html,
  url
}: {
  html: string;
  url?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return Promise.resolve(checkYaohuoLoginHtml(html, url));
}
