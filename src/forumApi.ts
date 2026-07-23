import { getNodeSeekCategories, getNodeSeekCurrentUserProfile, getNodeSeekFeed, getNodeSeekReplies, getNodeSeekTopic, getNodeSeekUserProfile, searchNodeSeek } from './localNodeseek';
import { checkYaohuoLoginHtml, yaohuoCategoriesResponse, parseYaohuoListHtml, parseYaohuoUserProfileHtml, parseYaohuoUserRepliesHtml } from './localYaohuo';
import { YAOHUO_BASE_URL, YAOHUO_BBS_REFERER, requireYaohuoRequestUrl, yaohuoReplyListNextPageUrl, yaohuoTopicListNextPageUrl, yaohuoUserProfileReplyListUrl, yaohuoUserProfileTopicListUrl } from './localYaohuoHelpers';
import { getV2exCategories, getV2exFeed, getV2exTopic, getV2exUserProfile, searchV2ex } from './localV2ex';
import { getYaohuoFeedDirect, searchYaohuoDirect } from './yaohuoApi';
import {
  getDiscourseSourceCategories,
  getDiscourseSourceCurrentUserProfile,
  getDiscourseSourceFeed,
  getDiscourseSourceReplies,
  getDiscourseSourceReply,
  getDiscourseSourceTopic,
  getDiscourseSourceUserProfile,
  searchDiscourseSourceTopics,
  type DiscourseReadAuth
} from './discourseSourceReaders';
import {
  aggregateFeedSources,
  aggregateSearchSources,
  isDiscourseSource,
  sourceValues
} from './sourceCatalog';
import { balanceTopicsBySource, parseSearchExpression, positiveSearchQuery, searchExpressionText, sortTopicsByCreatedAt, type SearchExpression, type SearchSort } from './feedLogic';
import { buildDiscourseSearchQuery, filterSearchResponseItems, isDiscourseSearchFilter, type SourceSearchFilter } from './searchFilters';
import { sourceErrorFromUnknown } from './sourceErrors';
import type {
  CategoriesResponse,
  Category,
  DiscourseFeedFilter,
  FeedResponse,
  FeedSource,
  NodeSeekFeedFilter,
  Reply,
  RepliesResponse,
  SearchResponse,
  Source,
  SourceErrors,
  SourceFeedFilter,
  Topic,
  TopicDetail,
  V2exFeedFilter,
  UserProfile
} from './types';
import { fetchWithTimeout, type Fetcher } from './request';
import {
  annotateSourceDiagnosticSummary,
  copySourceDiagnosticSummary,
  mergeSourceDiagnosticSummaries,
  sourceDiagnosticSummary
} from './sourceAdapterDiagnostics';

const allFeedSources = aggregateFeedSources;

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
  sourceCursors?: Partial<Record<Source, string | null>>;
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
    const sourceCursors: Partial<Record<Source, string | null>> = {};
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
      if (typeof parsed.sourceCursors?.[source] === 'string' && parsed.sourceCursors[source]) {
        sourceCursors[source] = parsed.sourceCursors[source];
      }
    }
    return { buffers, nextPages, sourceCursors };
  } catch {
    return {};
  }
}

function encodeAllFeedCursor(state: AllFeedCursorState) {
  const buffers: Partial<Record<Source, Topic[]>> = {};
  const nextPages: Partial<Record<Source, number | null>> = {};
  const sourceCursors: Partial<Record<Source, string | null>> = {};
  for (const source of allFeedSources) {
    const items = state.buffers?.[source] || [];
    if (items.length) {
      buffers[source] = items;
    }
    const nextPage = state.nextPages?.[source];
    if (typeof nextPage === 'number' && nextPage > 0) {
      nextPages[source] = nextPage;
    }
    const sourceCursor = state.sourceCursors?.[source];
    if (sourceCursor) {
      sourceCursors[source] = sourceCursor;
    }
  }
  if (!Object.keys(buffers).length && !Object.keys(nextPages).length && !Object.keys(sourceCursors).length) {
    return undefined;
  }
  return encodeURIComponent(JSON.stringify({ buffers, nextPages, sourceCursors }));
}

function settledDiagnosticFacts(results: Array<PromiseSettledResult<{ errors?: SourceErrors }>>) {
  let droppedCount = 0;
  let partialErrorCount = 0;
  let missingFloorCount = 0;
  let hasRepeatedCursor = false;
  for (const result of results) {
    if (result.status === 'rejected') {
      partialErrorCount += 1;
      continue;
    }
    const summary = sourceDiagnosticSummary(result.value);
    droppedCount += summary?.droppedCount || 0;
    partialErrorCount += (summary?.partialErrorCount || 0) + Object.keys(result.value.errors || {}).length;
    missingFloorCount += summary?.missingFloorCount || 0;
    hasRepeatedCursor ||= summary?.hasRepeatedCursor === true;
  }
  return { droppedCount, partialErrorCount, missingFloorCount, hasRepeatedCursor };
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
  return copySourceDiagnosticSummary({
    ...response,
    items: filterExcludedSearchItems(scopedItems, expression).slice(0, limit)
  }, response);
}

function pickSource<T>(source: Source, handlers: Partial<Record<Source, () => Promise<T>>>): Promise<T> {
  const handler = handlers[source];
  if (!handler) {
    throw new Error('来源不支持');
  }
  return handler();
}

function unavailableSourceRead(source: Source) {
  return Promise.reject(Object.assign(new Error(`${source} 凭据暂不可用`), {
    source,
    reason: 'credential_unavailable'
  }));
}

export async function getFeed({
  source,
  page = 1,
  limit = 20,
  cursor,
  category,
  feedFilter,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  discourseAuth,
  yaohuoCookie,
  unavailableSources,
  signal,
  timeoutMs
}: {
  source: FeedSource;
  page?: number;
  limit?: number;
  cursor?: string;
  category?: string;
  feedFilter?: SourceFeedFilter;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  yaohuoCookie?: string;
  unavailableSources?: readonly Source[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const options = { page, limit, cursor, category, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  if (source === 'all') {
    const unavailableSourceSet = new Set(unavailableSources);
    const cursorState = decodeAllFeedCursor(cursor);
    const bufferedItems = allFeedSources.flatMap((item) => cursorState.buffers?.[item] || []);
    const shouldFetchSource = (item: Source) => !cursor || (Boolean(cursorState.nextPages?.[item]) && (cursorState.buffers?.[item]?.length || 0) < limit);
    const fetchedSources = allFeedSources.map(shouldFetchSource);
    const requestedPages = Object.fromEntries(allFeedSources.map((item) => [
      item,
      cursor ? cursorState.nextPages?.[item] || page : page
    ])) as Record<typeof allFeedSources[number], number>;
    const adapterLimit = limit < 30 ? limit * allFeedSources.length : limit;
    const results = await Promise.allSettled(allFeedSources.map((item, index) => {
      if (unavailableSourceSet.has(item)) {
        return unavailableSourceRead(item);
      }
      if (!fetchedSources[index]) {
        return Promise.resolve({
          items: [],
          errors: {},
          hasMore: false,
          nextPage: cursorState.nextPages?.[item] ?? null,
          nextCursor: cursorState.sourceCursors?.[item] ?? null
        });
      }
      if (isDiscourseSource(item)) {
        return getDiscourseSourceFeed(item, {
          auth: discourseAuth,
          category,
          fetcher,
          limit: adapterLimit,
          page: requestedPages[item],
          signal,
          timeoutMs
        });
      }
      if (item === 'nodeseek') {
        return getNodeSeekFeed({ ...options, limit: adapterLimit, page: requestedPages[item] });
      }
      if (item === 'v2ex') {
        return getV2exFeed({
          ...options,
          cursor: cursorState.sourceCursors?.[item],
          limit,
          page: requestedPages[item]
        });
      }
      if (item === 'yaohuo') {
        return yaohuoCookie?.trim()
          ? getYaohuoFeedDirect({
            yaohuoCookie,
            category,
            page: requestedPages[item],
            limit: adapterLimit,
            yaohuoFetcher: fetcher,
            signal,
            timeoutMs
          })
          : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: null, nextCursor: null });
      }
      throw new Error(`${item} 未注册聚合首页读取 adapter`);
    }));
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
    const sourceCursors: Partial<Record<Source, string | null>> = {};
    allFeedSources.forEach((item, index) => {
      const result = results[index];
      if (result?.status === 'fulfilled') {
        if (result.value.nextPage) {
          nextPages[item] = result.value.nextPage;
        }
        if (result.value.nextCursor) {
          sourceCursors[item] = result.value.nextCursor;
        }
        return;
      }
      if (fetchedSources[index] && selected.length) {
        nextPages[item] = requestedPages[item];
      }
    });
    const nextCursor = encodeAllFeedCursor({ buffers: nextBuffers, nextPages, sourceCursors });
    const response = {
      items: selected,
      errors: mergeErrors(results, allFeedSources),
      hasMore: Boolean(nextCursor),
      nextPage: nextCursor ? page + 1 : null,
      nextCursor
    };
    const facts = settledDiagnosticFacts(results);
    return mergeSourceDiagnosticSummaries(response, 'aggregate-feed', results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []), {
      candidateCount: selected.length + facts.droppedCount,
      validCount: selected.length,
      droppedCount: facts.droppedCount,
      partialErrorCount: facts.partialErrorCount,
      missingFloorCount: facts.missingFloorCount,
      hasRepeatedCursor: facts.hasRepeatedCursor || response.nextPage === page || response.nextCursor === cursor,
      isExpectedEmpty: selected.length === 0 && facts.droppedCount === 0 && (page > 1 || Boolean(category))
    });
  }
  if (isDiscourseSource(source)) {
    return getDiscourseSourceFeed(source, {
      auth: discourseAuth,
      category,
      fetcher,
      filter: feedFilter as DiscourseFeedFilter | undefined,
      limit,
      page,
      signal,
      timeoutMs
    });
  }
  return pickSource(source, {
    nodeseek: () => getNodeSeekFeed({ ...options, feedFilter: feedFilter as NodeSeekFeedFilter | undefined }),
    v2ex: () => getV2exFeed({ ...options, feedFilter: feedFilter as V2exFeedFilter | undefined })
  });
}

export async function getCategories({
  source = 'all',
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  discourseAuth,
  unavailableSources,
  signal,
  timeoutMs
}: {
  source?: FeedSource;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  unavailableSources?: readonly Source[];
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<CategoriesResponse> {
  const options = { fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  if (source === 'all') {
    const sources = sourceValues;
    const results = await Promise.allSettled(sources.map((item) => {
      if (unavailableSources?.includes(item)) {
        return unavailableSourceRead(item);
      }
      if (isDiscourseSource(item)) {
        return getDiscourseSourceCategories(item, {
          auth: discourseAuth,
          fetcher,
          signal,
          timeoutMs
        });
      }
      if (item === 'nodeseek') {
        return getNodeSeekCategories(options);
      }
      if (item === 'v2ex') {
        return getV2exCategories(options);
      }
      if (item === 'yaohuo') {
        return Promise.resolve(yaohuoCategoriesResponse());
      }
      throw new Error(`${item} 未注册分类读取 adapter`);
    }));
    const response = {
      items: results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : []),
      errors: mergeErrors(results, sources)
    };
    const facts = settledDiagnosticFacts(results);
    return mergeSourceDiagnosticSummaries(response, 'aggregate-categories', results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []), {
      candidateCount: response.items.length + facts.droppedCount,
      validCount: response.items.length,
      droppedCount: facts.droppedCount,
      partialErrorCount: facts.partialErrorCount,
      missingFloorCount: facts.missingFloorCount,
      hasRepeatedCursor: facts.hasRepeatedCursor
    });
  }
  if (source === 'yaohuo') {
    return yaohuoCategoriesResponse();
  }
  if (isDiscourseSource(source)) {
    return getDiscourseSourceCategories(source, {
      auth: discourseAuth,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return pickSource(source, {
    nodeseek: () => getNodeSeekCategories(options),
    v2ex: () => getV2exCategories(options)
  });
}

export function getTopic({
  source,
  id,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  discourseAuth,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  const options = { fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  if (isDiscourseSource(source)) {
    return getDiscourseSourceTopic(source, id, {
      auth: discourseAuth,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return pickSource(source, {
    nodeseek: () => getNodeSeekTopic(id, options),
    v2ex: () => getV2exTopic(id, options)
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
  discourseAuth,
  fillPages,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  page: number;
  limit?: number;
  offset?: number | null;
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  fillPages?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const options = { page, limit, offset, fetcher, nodeSeekCookie, nodeSeekUserAgent, fillPages, signal, timeoutMs };
  if (isDiscourseSource(source)) {
    return getDiscourseSourceReplies(source, id, {
      auth: discourseAuth,
      fetcher,
      limit,
      offset,
      page,
      signal,
      timeoutMs
    });
  }
  return pickSource<RepliesResponse>(source, {
    nodeseek: () => getNodeSeekReplies(id, options),
    v2ex: async (): Promise<RepliesResponse> => annotateSourceDiagnosticSummary({ items: [], hasMore: false, nextPage: null }, {
      parserVariant: 'unsupported-replies',
      candidateCount: 0,
      validCount: 0,
      droppedCount: 0,
      isExpectedEmpty: true
    })
  });
}

export function getReply({
  source,
  id,
  floor,
  fetcher,
  discourseAuth,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  floor: number;
  fetcher?: Fetcher;
  discourseAuth?: DiscourseReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Reply> {
  if (!isDiscourseSource(source)) {
    throw new Error('该来源不支持按楼层读取引用');
  }
  return getDiscourseSourceReply(source, id, floor, {
    auth: discourseAuth,
    fetcher,
    signal,
    timeoutMs
  });
}

export function getUserProfile({
  source,
  id,
  username,
  fetcher,
  nodeSeekCookie,
  nodeSeekUserAgent,
  yaohuoCookie,
  discourseAuth,
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
  discourseAuth?: DiscourseReadAuth;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserProfile> {
  const options = { fetcher, nodeSeekCookie, nodeSeekUserAgent, cursor, cursorType, signal, timeoutMs };
  if (isDiscourseSource(source)) {
    return getDiscourseSourceUserProfile(source, id, username || id, {
      auth: discourseAuth,
      cursor,
      cursorType,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return pickSource(source, {
    nodeseek: () => getNodeSeekUserProfile(id || username || '', options),
    v2ex: () => getV2exUserProfile(id, username || id, { fetcher, cursor, cursorType, signal, timeoutMs }),
    yaohuo: async () => {
      if (!yaohuoCookie) {
        throw new Error('请先登录妖火');
      }
      const targetId = id || username || '';
      const url = `${YAOHUO_BASE_URL}/bbs/userinfo.aspx?touserid=${encodeURIComponent(targetId)}&siteid=1000`;
      const diagnosticSources: unknown[] = [];
      let partialErrorCount = 0;
      let hasRepeatedCursor = false;
      const annotateUserProfile = (profile: UserProfile) => {
        const childSummaries = diagnosticSources.map(sourceDiagnosticSummary).filter(Boolean);
        const droppedCount = childSummaries.reduce((total, summary) => total + (summary?.droppedCount || 0), 0);
        const missingFloorCount = childSummaries.reduce((total, summary) => total + (summary?.missingFloorCount || 0), 0);
        const childPartialErrorCount = childSummaries.reduce((total, summary) => total + (summary?.partialErrorCount || 0), 0);
        const identityValid = childSummaries.some((summary) => summary?.parserVariant === 'html-user' && summary.isParseEmpty) ? 0 : 1;
        const validCount = identityValid + profile.topics.length + (profile.replies?.length || 0);
        return mergeSourceDiagnosticSummaries(profile, 'html-user', diagnosticSources, {
          candidateCount: 1 + profile.topics.length + (profile.replies?.length || 0) + droppedCount,
          validCount,
          droppedCount,
          partialErrorCount: partialErrorCount + childPartialErrorCount,
          missingFloorCount,
          hasRepeatedCursor: hasRepeatedCursor
            || profile.nextTopicsCursor === cursor
            || profile.nextRepliesCursor === cursor
        });
      };
      const headers = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: YAOHUO_BBS_REFERER
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
        const profile = parseYaohuoUserProfileHtml(page.html, {
          id: targetId,
          username,
          url: page.url
        });
        diagnosticSources.push(profile);
        return {
          ...page,
          profile
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
        diagnosticSources.push(result);
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
        diagnosticSources.push(replies);
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
          return annotateUserProfile({
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
          });
        }
        const topicPage = await readTopicPage(cursor);
        addTopics(topicPage.result.items, username || targetId);
        return annotateUserProfile({
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
        });
      }

      const firstPage = await readProfilePage(url);
      const authorFallback = firstPage.profile.displayName || firstPage.profile.username || targetId;
      const firstReplyUrl = yaohuoUserProfileReplyListUrl(firstPage.html, targetId, firstPage.url);
      let firstReplyPage: { replies: NonNullable<UserProfile['replies']>; nextUrl: string } = { replies: [], nextUrl: '' };
      if (firstReplyUrl) {
        try {
          firstReplyPage = await readReplyPage(firstReplyUrl, authorFallback);
        } catch {
          partialErrorCount += 1;
        }
      }
      let nextUrl = yaohuoUserProfileTopicListUrl(firstPage.html, targetId, firstPage.url);
      if (!nextUrl) {
        return annotateUserProfile({
          ...firstPage.profile,
          hasMoreTopics: false,
          nextTopicsCursor: null,
          replies: firstReplyPage.replies,
          hasMoreReplies: Boolean(firstReplyPage.nextUrl),
          nextRepliesCursor: firstReplyPage.nextUrl || null
        });
      }

      const visited = new Set<string>();
      for (let page = 1; nextUrl && topics.length < 30 && page <= 10; page += 1) {
        if (visited.has(nextUrl)) {
          hasRepeatedCursor = true;
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
      return annotateUserProfile({
        ...profile,
        topics: visibleTopics,
        hasMoreTopics: Boolean(nextUrl),
        nextTopicsCursor: nextUrl || null,
        replies,
        hasMoreReplies: Boolean(firstReplyPage.nextUrl),
        nextRepliesCursor: firstReplyPage.nextUrl || null
      });
    }
  });
}

export function getCurrentUserProfile({
  source,
  fetcher,
  discourseAuth,
  nodeSeekCookie,
  nodeSeekUserAgent,
  yaohuoCookie,
  signal,
  timeoutMs
}: {
  source: Source;
  fetcher?: Fetcher;
  discourseAuth?: DiscourseReadAuth;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  yaohuoCookie?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserProfile> {
  if (isDiscourseSource(source)) {
    return getDiscourseSourceCurrentUserProfile(source, {
      auth: discourseAuth,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return pickSource(source, {
    nodeseek: () => getNodeSeekCurrentUserProfile({ fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs }),
    v2ex: () => {
      throw new Error('V2EX 不支持当前登录身份读取');
    },
    yaohuo: async () => {
      if (!yaohuoCookie?.trim()) {
        throw new Error('请先登录妖火');
      }
      const response = await fetchWithTimeout(`${YAOHUO_BASE_URL}/wapindex.aspx?sid=-2`, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: YAOHUO_BBS_REFERER
        }
      }, { fetcher, signal, timeoutMs });
      const html = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const check = checkYaohuoLoginHtml(html, response.url);
      if (check.currentUser) {
        try {
          const profile = await getUserProfile({
            source: 'yaohuo',
            id: check.currentUser.id,
            username: check.currentUser.username,
            fetcher,
            yaohuoCookie,
            signal,
            timeoutMs
          });
          return copySourceDiagnosticSummary({ ...profile, topics: [] }, profile);
        } catch (error) {
          if (signal?.aborted) {
            throw error;
          }
          return check.currentUser;
        }
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
  discourseAuth,
  linuxDoAuthenticated,
  yaohuoCookie,
  unavailableSources,
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
  discourseAuth?: DiscourseReadAuth;
  linuxDoAuthenticated?: boolean;
  yaohuoCookie?: string;
  unavailableSources?: readonly Source[];
  sort?: SearchSort;
  filter?: SourceSearchFilter;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  const adapterQuery = positiveSearchQuery(query);
  const adapterLimit = parseSearchExpression(query).exclude.length ? Math.min(100, limit * 3) : limit;
  const options = { limit: adapterLimit, page, fetcher, nodeSeekCookie, nodeSeekUserAgent, signal, timeoutMs };
  if (source === 'all') {
    const sources = aggregateSearchSources;
    const results = await Promise.allSettled(sources.map((item) => {
      if (unavailableSources?.includes(item)) {
        return unavailableSourceRead(item);
      }
      if (isDiscourseSource(item)) {
        return searchDiscourseSourceTopics(item, adapterQuery, {
          authenticated: item === 'linuxdo' && linuxDoAuthenticated === true,
          auth: discourseAuth,
          fetcher,
          limit: adapterLimit,
          page,
          signal,
          timeoutMs
        });
      }
      if (item === 'nodeseek') {
        return searchNodeSeek(adapterQuery, options);
      }
      if (item === 'v2ex') {
        return searchV2ex(adapterQuery, options);
      }
      if (item === 'yaohuo') {
        return yaohuoCookie?.trim()
          ? searchYaohuoDirect({
            yaohuoCookie,
            query: adapterQuery,
            page,
            limit: adapterLimit,
            yaohuoFetcher: fetcher,
            signal,
            timeoutMs
          })
          : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
      }
      throw new Error(`${item} 未注册聚合搜索 adapter`);
    }));
    const expression = parseSearchExpression(query);
    const response = {
      items: sortTopicsByCreatedAt(filterExcludedSearchItems(
        results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : []),
        expression
      )).slice(0, limit),
      errors: mergeErrors(results, sources),
      hasMore: results.some((result) => result.status === 'fulfilled' && result.value.hasMore),
      nextPage: results.some((result) => result.status === 'fulfilled' && result.value.hasMore) ? page + 1 : null
    };
    const facts = settledDiagnosticFacts(results);
    return mergeSourceDiagnosticSummaries(response, 'aggregate-search', results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []), {
      candidateCount: response.items.length + facts.droppedCount,
      validCount: response.items.length,
      droppedCount: facts.droppedCount,
      partialErrorCount: facts.partialErrorCount,
      missingFloorCount: facts.missingFloorCount,
      hasRepeatedCursor: facts.hasRepeatedCursor || response.nextPage === page,
      isExpectedEmpty: response.items.length === 0 && facts.droppedCount === 0 && facts.partialErrorCount === 0
    });
  }
  const activeFilter = filter?.source === source ? filter : undefined;
  const response = isDiscourseSource(source)
    ? await searchDiscourseSourceTopics(
      source,
      activeFilter && isDiscourseSearchFilter(activeFilter)
        ? buildDiscourseSearchQuery(adapterQuery, activeFilter, categories)
        : adapterQuery,
      {
        authenticated: source === 'linuxdo' && linuxDoAuthenticated === true,
        auth: discourseAuth,
        fetcher,
        limit: adapterLimit,
        page,
        signal,
        timeoutMs
      }
    )
    : await pickSource(source, {
      nodeseek: () => searchNodeSeek(adapterQuery, {
        ...options,
        filter: activeFilter?.source === 'nodeseek' ? activeFilter : undefined
      }),
      v2ex: () => searchV2ex(adapterQuery, {
        ...options,
        sort: activeFilter?.source === 'v2ex' ? activeFilter.sort : sort,
        filter: activeFilter?.source === 'v2ex' ? activeFilter : undefined
      })
    });
  return filterSearchItems(response, query, limit, activeFilter);
}
