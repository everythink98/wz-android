import { getLinuxDoCategories, getLinuxDoCurrentUserProfile, getLinuxDoFeed, getLinuxDoReplies, getLinuxDoReply, getLinuxDoTopic, getLinuxDoUserProfile, searchLinuxDo } from './localLinuxdo';
import { getNodeSeekBasicUserProfile, getNodeSeekCategories, getNodeSeekCurrentUserProfile, getNodeSeekFeed, getNodeSeekReplies, getNodeSeekTopic, getNodeSeekUserProfile, searchNodeSeek } from './localNodeseek';
import { checkYaohuoLoginHtml, yaohuoCategoriesResponse, parseYaohuoListHtml, parseYaohuoUserProfileHtml, parseYaohuoUserRepliesHtml } from './localYaohuo';
import { requireYaohuoRequestUrl, yaohuoReplyListNextPageUrl, yaohuoTopicListNextPageUrl, yaohuoUserProfileReplyListUrl, yaohuoUserProfileTopicListUrl } from './localYaohuoHelpers';
import { getV2exCategories, getV2exFeed, getV2exTopic, getV2exUserProfile, searchV2ex } from './localV2ex';
import { balanceTopicsBySource, parseSearchExpression, positiveSearchQuery, searchExpressionText, sortTopicsByCreatedAt, type SearchExpression, type SearchSort } from './feedLogic';
import { buildLinuxDoSearchQuery, filterSearchResponseItems, type SourceSearchFilter } from './searchFilters';
import { sourceErrorFromUnknown } from './sourceErrors';
import type {
  CategoriesResponse,
  Category,
  FeedResponse,
  FeedSource,
  LinuxDoFeedFilter,
  Reply,
  RepliesResponse,
  SearchResponse,
  Source,
  SourceErrors,
  Topic,
  TopicDetail,
  UserProfile
} from './types';
import { fetchWithTimeout, type Fetcher } from './request';

const allFeedSources = ['nodeseek', 'linuxdo', 'v2ex'] as const satisfies readonly Source[];

function mergeErrors(results: Array<PromiseSettledResult<{ errors?: SourceErrors }>>, sources: readonly Source[]) {
  const errors: SourceErrors = {};
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      Object.assign(errors, result.value.errors || {});
    } else {
      errors[sources[index]] = sourceErrorFromUnknown(sources[index], result.reason);
    }
  });
  return errors;
}

function sortByTime<T extends { createdAt: string; lastReplyAt?: string }>(items: T[]) {
  return [...items].sort((left, right) => (
    Date.parse(right.lastReplyAt || right.createdAt || '') - Date.parse(left.lastReplyAt || left.createdAt || '')
  ));
}

function pageNumberFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('page') || '1');
    return Number.isFinite(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
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

function filterExcludedSearchItems(items: Topic[], expression: SearchExpression) {
  if (!expression.exclude.length) {
    return items;
  }
  return items.filter((topic) => {
    const text = searchExpressionText(topic).toLowerCase();
    return expression.exclude.every((term) => !text.includes(term.toLowerCase()));
  });
}

function filterSearchItems(response: SearchResponse, query: string, limit: number, filter?: SourceSearchFilter): SearchResponse {
  const expression = parseSearchExpression(query);
  const scopedItems = filterSearchResponseItems(response.items, filter, query);
  return {
    ...response,
    items: filterExcludedSearchItems(scopedItems, expression).slice(0, limit)
  };
}

function pickSource<T>(source: Source, handlers: Partial<Record<Source, () => Promise<T>>>): Promise<T> {
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
  linuxDoFilter,
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
  linuxDoFilter?: LinuxDoFeedFilter;
  nocache?: boolean;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const options = { page, limit, category, linuxDoFilter, nocache, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  if (source === 'all') {
    const cursorState = decodeAllFeedCursor(cursor);
    const bufferedItems = allFeedSources.flatMap((item) => cursorState.buffers?.[item] || []);
    const shouldFetchSource = (item: Source) => !cursor || (Boolean(cursorState.nextPages?.[item]) && (cursorState.buffers?.[item]?.length || 0) < limit);
    const fetchedSources = allFeedSources.map(shouldFetchSource);
    const requestedPages = {
      nodeseek: cursor ? cursorState.nextPages?.nodeseek || page : page,
      linuxdo: cursor ? cursorState.nextPages?.linuxdo || page : page,
      v2ex: cursor ? cursorState.nextPages?.v2ex || page : page
    } satisfies Record<typeof allFeedSources[number], number>;
    const adapterLimit = limit < 30 ? limit * allFeedSources.length : limit;
    const v2exLimit = limit;
    const results = await Promise.allSettled([
      fetchedSources[0]
        ? getNodeSeekFeed({ ...options, limit: adapterLimit, page: requestedPages.nodeseek })
        : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: cursorState.nextPages?.nodeseek ?? null }),
      fetchedSources[1]
        ? getLinuxDoFeed({ ...options, limit: adapterLimit, page: requestedPages.linuxdo })
        : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: cursorState.nextPages?.linuxdo ?? null }),
      fetchedSources[2]
        ? getV2exFeed({ ...options, limit: v2exLimit, page: requestedPages.v2ex })
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
      if (result?.status === 'fulfilled') {
        if (result.value.nextPage) {
          nextPages[item] = result.value.nextPage;
        }
        return;
      }
      if (fetchedSources[index] && selected.length) {
        nextPages[item] = requestedPages[item];
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
  nocache = false,
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
  const options = { nocache, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  return pickSource(source, {
    nodeseek: () => getNodeSeekTopic(id, options),
    linuxdo: () => getLinuxDoTopic(id, options),
    v2ex: () => getV2exTopic(id, options)
  });
}

export function getReplies({
  source,
  id,
  page,
  limit = 20,
  offset,
  nocache = false,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  fillPages,
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
  fillPages?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const options = { page, limit, offset, nocache, fetcher, nodeSeekCookie, nodeSeekUserAgent, fillPages, signal, timeoutMs };
  return pickSource<RepliesResponse>(source, {
    nodeseek: () => getNodeSeekReplies(id, options),
    linuxdo: () => getLinuxDoReplies(id, options),
    v2ex: async (): Promise<RepliesResponse> => ({ items: [], hasMore: false, nextPage: null })
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
  cursor,
  cursorType,
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
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserProfile> {
  const options = { fetcher, nodeSeekCookie, nodeSeekUserAgent, cursor, cursorType, signal, timeoutMs };
  return pickSource(source, {
    nodeseek: () => getNodeSeekUserProfile(id || username || '', options),
    linuxdo: () => getLinuxDoUserProfile(id, username || id, { fetcher, cursor, cursorType, signal, timeoutMs }),
    v2ex: () => getV2exUserProfile(id, username || id, { fetcher, cursor, cursorType, signal, timeoutMs }),
    yaohuo: async () => {
      if (!yaohuoCookie) {
        throw new Error('请先登录妖火');
      }
      const targetId = id || username || '';
      const url = `https://yaohuo.me/bbs/userinfo.aspx?touserid=${encodeURIComponent(targetId)}&siteid=1000`;
      const headers = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Cookie: yaohuoCookie,
        Referer: 'https://yaohuo.me/bbs/'
      };
      const readHtml = async (pageUrl: string) => {
        const safeUrl = requireYaohuoRequestUrl(pageUrl);
        const response = await fetchWithTimeout(safeUrl, { headers }, { fetcher, signal, timeoutMs });
        const html = await response.text();
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return {
          html,
          url: requireYaohuoRequestUrl(response.url || safeUrl, safeUrl)
        };
      };
      const readProfilePage = async (pageUrl: string) => {
        const page = await readHtml(pageUrl);
        return {
          ...page,
          profile: parseYaohuoUserProfileHtml(page.html, {
            id: targetId,
            username,
            url: page.url
          })
        };
      };
      const readTopicPage = async (pageUrl: string) => {
        const page = await readHtml(pageUrl);
        const pageNumber = pageNumberFromUrl(page.url);
        const result = parseYaohuoListHtml(page.html, {
          classId: '0',
          limit: 30,
          page: pageNumber,
          url: page.url
        });
        return {
          ...page,
          result,
          nextUrl: yaohuoTopicListNextPageUrl(page.html, page.url, pageNumber, result.items.length, 30)
        };
      };
      const readReplyPage = async (pageUrl: string, authorFallback?: string) => {
        const page = await readHtml(pageUrl);
        const replies = parseYaohuoUserRepliesHtml(page.html, {
          id: targetId,
          username: authorFallback || username || targetId,
          url: page.url
        });
        return {
          ...page,
          replies,
          nextUrl: yaohuoReplyListNextPageUrl(page.html, page.url, replies.length)
        };
      };
      const seen = new Set<string>();
      const topics: Topic[] = [];
      const addTopics = (items: Topic[], authorFallback?: string) => {
        for (const topic of items) {
          if (!seen.has(topic.id)) {
            seen.add(topic.id);
            topics.push(topic.author || !authorFallback ? topic : { ...topic, author: authorFallback });
          }
        }
      };

      if (cursor) {
        if (cursorType === 'replies') {
          const replyPage = await readReplyPage(cursor, username || targetId);
          return {
            source: 'yaohuo',
            id: targetId,
            username: username || targetId,
            displayName: username || targetId,
            url,
            topics: [],
            hasMoreTopics: false,
            nextTopicsCursor: null,
            replies: replyPage.replies,
            hasMoreReplies: Boolean(replyPage.nextUrl),
            nextRepliesCursor: replyPage.nextUrl || null
          };
        }
        const topicPage = await readTopicPage(cursor);
        addTopics(topicPage.result.items, username || targetId);
        return {
          source: 'yaohuo',
          id: targetId,
          username: username || targetId,
          displayName: username || targetId,
          url,
          topics: sortTopicsByCreatedAt(topics).slice(0, 30),
          hasMoreTopics: Boolean(topicPage.nextUrl),
          nextTopicsCursor: topicPage.nextUrl || null,
          replies: [],
          hasMoreReplies: false,
          nextRepliesCursor: null
        };
      }

      const firstPage = await readProfilePage(url);
      const authorFallback = firstPage.profile.displayName || firstPage.profile.username || targetId;
      const firstReplyUrl = yaohuoUserProfileReplyListUrl(firstPage.html, targetId, firstPage.url);
      const firstReplyPage = firstReplyUrl
        ? await readReplyPage(firstReplyUrl, authorFallback).catch(() => ({ replies: [], nextUrl: '' }))
        : { replies: [], nextUrl: '' };
      let nextUrl = yaohuoUserProfileTopicListUrl(firstPage.html, targetId, firstPage.url);
      if (!nextUrl) {
        return {
          ...firstPage.profile,
          hasMoreTopics: false,
          nextTopicsCursor: null,
          replies: firstReplyPage.replies,
          hasMoreReplies: Boolean(firstReplyPage.nextUrl),
          nextRepliesCursor: firstReplyPage.nextUrl || null
        };
      }

      const visited = new Set<string>();
      for (let page = 1; nextUrl && topics.length < 30 && page <= 10; page += 1) {
        if (visited.has(nextUrl)) {
          break;
        }
        visited.add(nextUrl);
        const pageResult = await readTopicPage(nextUrl);
        addTopics(pageResult.result.items, authorFallback);
        nextUrl = pageResult.nextUrl;
      }
      const visibleTopics = sortTopicsByCreatedAt(topics).slice(0, 30);
      const topicAuthor = visibleTopics.map((topic) => topic.author).find((author) => author && author !== targetId);
      const profile = topicAuthor && firstPage.profile.displayName === targetId
        ? { ...firstPage.profile, username: topicAuthor, displayName: topicAuthor }
        : firstPage.profile;
      const replyAuthor = profile.displayName || profile.username || targetId;
      const replies = firstReplyPage.replies.map((reply) => (
        reply.author === targetId && replyAuthor !== targetId
          ? { ...reply, author: replyAuthor }
          : reply
      ));
      return {
        ...profile,
        topics: visibleTopics,
        hasMoreTopics: Boolean(nextUrl),
        nextTopicsCursor: nextUrl || null,
        replies,
        hasMoreReplies: Boolean(firstReplyPage.nextUrl),
        nextRepliesCursor: firstReplyPage.nextUrl || null
      };
    }
  });
}

export function getCurrentUserProfile({
  source,
  fetcher,
  linuxDoCookie,
  linuxDoUserAgent,
  nodeSeekCookie,
  nodeSeekUserId,
  nodeSeekUserAgent,
  yaohuoCookie,
  signal,
  timeoutMs
}: {
  source: Source;
  fetcher?: Fetcher;
  linuxDoCookie?: string;
  linuxDoUserAgent?: string;
  nodeSeekCookie?: string;
  nodeSeekUserId?: string | number | null;
  nodeSeekUserAgent?: string;
  yaohuoCookie?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserProfile> {
  return pickSource(source, {
    nodeseek: async () => {
      try {
        return await getNodeSeekCurrentUserProfile({ fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs });
      } catch (error) {
        if (!nodeSeekUserId) {
          throw error;
        }
        return getNodeSeekBasicUserProfile(String(nodeSeekUserId), { fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs });
      }
    },
    linuxdo: () => getLinuxDoCurrentUserProfile({ fetcher, linuxDoCookie, linuxDoUserAgent, signal, timeoutMs }),
    v2ex: () => {
      throw new Error('V2EX 不支持当前登录身份读取');
    },
    yaohuo: async () => {
      if (!yaohuoCookie?.trim()) {
        throw new Error('请先登录妖火');
      }
      const response = await fetchWithTimeout('https://yaohuo.me/wapindex.aspx?sid=-2', {
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
      const check = checkYaohuoLoginHtml(html, response.url);
      if (check.currentUser) {
        const profile = await getUserProfile({
          source: 'yaohuo',
          id: check.currentUser.id,
          username: check.currentUser.username,
          fetcher,
          yaohuoCookie,
          signal,
          timeoutMs
        });
        return { ...profile, topics: [] };
      }
      if (check.loginRequired) {
        throw new Error(check.message || '妖火登录已失效，请重新登录。');
      }
      throw new Error('无法读取当前妖火用户身份，请重新检测妖火登录状态。');
    }
  });
}

export async function searchTopics({
  source,
  query,
  limit = 20,
  page = 1,
  categories = [],
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  sort = 'relevance',
  filter,
  signal,
  timeoutMs
}: {
  source: FeedSource;
  query: string;
  limit?: number;
  page?: number;
  categories?: Category[];
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  sort?: SearchSort;
  filter?: SourceSearchFilter;
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
      items: sortTopicsByCreatedAt(filterExcludedSearchItems(
        results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : []),
        expression
      )).slice(0, limit),
      errors: mergeErrors(results, sources),
      hasMore: results.some((result) => result.status === 'fulfilled' && result.value.hasMore),
      nextPage: results.some((result) => result.status === 'fulfilled' && result.value.hasMore) ? page + 1 : null
    };
  }
  const activeFilter = filter?.source === source ? filter : undefined;
  const response = await pickSource(source, {
    nodeseek: () => searchNodeSeek(adapterQuery, {
      ...options,
      filter: activeFilter?.source === 'nodeseek' ? activeFilter : undefined
    }),
    linuxdo: () => searchLinuxDo(
      activeFilter?.source === 'linuxdo'
        ? buildLinuxDoSearchQuery(adapterQuery, activeFilter, categories)
        : adapterQuery,
      options
    ),
    v2ex: () => searchV2ex(adapterQuery, {
      ...options,
      sort: activeFilter?.source === 'v2ex' ? activeFilter.sort : sort,
      filter: activeFilter?.source === 'v2ex' ? activeFilter : undefined
    })
  });
  return filterSearchItems(response, query, limit, activeFilter);
}
