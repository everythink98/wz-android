import { getNodeSeekCategories, getNodeSeekFeed } from '@/sources/nodeseek/reader';
import { yaohuoCategoriesResponse } from '@/sources/yaohuo/feedParser';
import { getV2exCategories, getV2exFeed } from '@/sources/v2ex/reader';
import { getYaohuoFeedDirect } from '@/sources/yaohuo/reader';
import { getDiscourseSourceCategories, getDiscourseSourceFeed, type DiscourseReadAuth } from './discourseRead';
import { aggregateFeedSources, isDiscourseSource, sourceValues } from '@/domain/forum/sourceCatalog';
import { balanceTopicsBySource } from '@/domain/forum/feed';
import type {
  CategoriesResponse,
  DiscourseFeedFilter,
  FeedResponse,
  FeedSource,
  NodeSeekFeedFilter,
  Source,
  SourceFeedFilter,
  Topic,
  V2exFeedFilter
} from '@/domain/forum/models';
import type { Fetcher } from '@/platform/network/request';
import { mergeSourceDiagnosticSummaries } from './diagnostics';
import {
  dispatchSourceRead,
  mergeSettledSourceErrors,
  settledDiagnosticFacts,
  unavailableSourceRead
} from './readAggregation';
const allFeedSources = aggregateFeedSources;

function sortByTime<T extends { createdAt: string; lastReplyAt?: string }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      Date.parse(right.lastReplyAt || right.createdAt || '') - Date.parse(left.lastReplyAt || left.createdAt || '')
  );
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
  return topic.source && topic.id && topic.title && topic.url && topic.createdAt ? (topic as Topic) : null;
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
        ? (parsed.buffers[source]?.map(cursorTopic).filter(Boolean) as Topic[])
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
function topicIdentity(topic: Topic) {
  return `${topic.source}:${topic.id}`;
}

export async function getFeed({
  source,
  page = 1,
  limit = 20,
  cursor,
  category,
  feedFilter,
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
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
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  unavailableSources?: readonly Source[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const options = {
    authenticated: nodeSeekAuthenticated,
    page,
    limit,
    cursor,
    category,
    fetcher,
    nodeSeekUserAgent,
    signal,
    timeoutMs
  };
  if (source === 'all') {
    const unavailableSourceSet = new Set(unavailableSources);
    const cursorState = decodeAllFeedCursor(cursor);
    const bufferedItems = allFeedSources.flatMap((item) => cursorState.buffers?.[item] || []);
    const shouldFetchSource = (item: Source) =>
      !cursor || (Boolean(cursorState.nextPages?.[item]) && (cursorState.buffers?.[item]?.length || 0) < limit);
    const fetchedSources = allFeedSources.map(shouldFetchSource);
    const requestedPages = Object.fromEntries(
      allFeedSources.map((item) => [item, cursor ? cursorState.nextPages?.[item] || page : page])
    ) as Record<(typeof allFeedSources)[number], number>;
    const adapterLimit = limit < 30 ? limit * allFeedSources.length : limit;
    const results = await Promise.allSettled(
      allFeedSources.map((item, index) => {
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
          return getYaohuoFeedDirect({
            category,
            page: requestedPages[item],
            limit: adapterLimit,
            yaohuoFetcher: fetcher,
            signal,
            timeoutMs
          });
        }
        throw new Error(`${item} 未注册聚合首页读取 adapter`);
      })
    );
    const items = sortByTime([
      ...bufferedItems,
      ...results.flatMap((result) => (result.status === 'fulfilled' ? result.value.items : []))
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
      errors: mergeSettledSourceErrors(results, allFeedSources),
      hasMore: Boolean(nextCursor),
      nextPage: nextCursor ? page + 1 : null,
      nextCursor
    };
    const facts = settledDiagnosticFacts(results);
    return mergeSourceDiagnosticSummaries(
      response,
      'aggregate-feed',
      results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      {
        candidateCount: selected.length + facts.droppedCount,
        validCount: selected.length,
        droppedCount: facts.droppedCount,
        partialErrorCount: facts.partialErrorCount,
        missingFloorCount: facts.missingFloorCount,
        hasRepeatedCursor: facts.hasRepeatedCursor || response.nextPage === page || response.nextCursor === cursor,
        isExpectedEmpty: selected.length === 0 && facts.droppedCount === 0 && (page > 1 || Boolean(category))
      }
    );
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
  return dispatchSourceRead(source, {
    nodeseek: () => getNodeSeekFeed({ ...options, feedFilter: feedFilter as NodeSeekFeedFilter | undefined }),
    v2ex: () => getV2exFeed({ ...options, feedFilter: feedFilter as V2exFeedFilter | undefined })
  });
}

export async function getCategories({
  source = 'all',
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  unavailableSources,
  signal,
  timeoutMs
}: {
  source?: FeedSource;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  unavailableSources?: readonly Source[];
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<CategoriesResponse> {
  const options = { authenticated: nodeSeekAuthenticated, fetcher, nodeSeekUserAgent, signal, timeoutMs };
  if (source === 'all') {
    const sources = sourceValues;
    const results = await Promise.allSettled(
      sources.map((item) => {
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
      })
    );
    const response = {
      items: results.flatMap((result) => (result.status === 'fulfilled' ? result.value.items : [])),
      errors: mergeSettledSourceErrors(results, sources)
    };
    const facts = settledDiagnosticFacts(results);
    return mergeSourceDiagnosticSummaries(
      response,
      'aggregate-categories',
      results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      {
        candidateCount: response.items.length + facts.droppedCount,
        validCount: response.items.length,
        droppedCount: facts.droppedCount,
        partialErrorCount: facts.partialErrorCount,
        missingFloorCount: facts.missingFloorCount,
        hasRepeatedCursor: facts.hasRepeatedCursor
      }
    );
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
  return dispatchSourceRead(source, {
    nodeseek: () => getNodeSeekCategories(options),
    v2ex: () => getV2exCategories(options)
  });
}
