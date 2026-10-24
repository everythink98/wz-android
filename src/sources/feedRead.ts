import { getNodeSeekCategories, getNodeSeekFeed } from '@/sources/nodeseek/reader';
import { yaohuoCategoriesResponse } from '@/sources/yaohuo/feedParser';
import { getV2exCategories, getV2exFeed } from '@/sources/v2ex/reader';
import { getYaohuoFeedDirect } from '@/sources/yaohuo/reader';
import { getLinuxDoCategories, getLinuxDoFeed, type LinuxDoReadAuth } from '@/sources/linuxdo/reader';
import { isDiscourseSource, sourceValues } from '@/domain/forum/sourceCatalog';
import { balanceTopicsBySource, mergeTopics } from '@/domain/forum/feed';
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
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import { markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { sortTopicsByTime } from '@/domain/forum/html';
import { mergeSourceDiagnosticSummaries } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { runForumSourceReadAggregateAttempt, runForumSourceReadAttempt } from './forumSourceReadAttempt';
import {
  dispatchSourceRead,
  mergeSettledSourceErrors,
  READ_PREPARATION_BUDGET_MS,
  readWithinAggregateSourceBudget,
  settledDiagnosticFacts,
  unavailableSourceRead,
  type ReadPreparation
} from './readAggregation';

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

function decodeAllFeedCursor(cursor: string | undefined, sources: readonly Source[]): AllFeedCursorState {
  if (!cursor) {
    return {};
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor)) as AllFeedCursorState;
    const buffers: Partial<Record<Source, Topic[]>> = {};
    const nextPages: Partial<Record<Source, number | null>> = {};
    const sourceCursors: Partial<Record<Source, string | null>> = {};
    for (const source of sources) {
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

function encodeAllFeedCursor(state: AllFeedCursorState, sources: readonly Source[]) {
  const buffers: Partial<Record<Source, Topic[]>> = {};
  const nextPages: Partial<Record<Source, number | null>> = {};
  const sourceCursors: Partial<Record<Source, string | null>> = {};
  for (const source of sources) {
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

function includedAggregateSources(includedSources: readonly Source[] | undefined, sources: readonly Source[]) {
  const included = new Set(includedSources || sources);
  return sources.filter((source) => included.has(source));
}
function topicIdentity(topic: Topic) {
  return `${topic.source}:${topic.id}`;
}

export async function getFeed({
  source,
  page = 1,
  limit = source === 'yaohuo' ? 30 : 20,
  cursor,
  category,
  feedFilter,
  fetcher,
  fetcherForSource,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  diagnosticTrace,
  preparation = { deadline: Date.now() + READ_PREPARATION_BUDGET_MS },
  includedSources,
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
  fetcherForSource?: (source: Source) => Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  diagnosticTrace?: DiagnosticTrace;
  preparation?: ReadPreparation;
  includedSources?: readonly Source[];
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
    return runForumSourceReadAggregateAttempt(
      fetcher || fetch,
      async (aggregateFetcher, scopeFetcher) => {
        const unavailableSourceSet = new Set(unavailableSources);
        const sources = includedAggregateSources(includedSources, sourceValues).filter(
          (item) => !unavailableSourceSet.has(item)
        );
        const cursorState = decodeAllFeedCursor(cursor, sources);
        const bufferedItems = sources.flatMap((item) => cursorState.buffers?.[item] || []);
        const hasRetryableCursor = Boolean(
          cursor &&
          (bufferedItems.length ||
            Object.keys(cursorState.nextPages || {}).length ||
            Object.keys(cursorState.sourceCursors || {}).length)
        );
        const shouldFetchSource = (item: Source) =>
          !cursor || (Boolean(cursorState.nextPages?.[item]) && (cursorState.buffers?.[item]?.length || 0) < limit);
        const fetchedSources = sources.map(shouldFetchSource);
        const requestedPages = Object.fromEntries(
          sources.map((item) => [item, cursor ? cursorState.nextPages?.[item] || page : page])
        ) as Record<Source, number>;
        const adapterLimit = limit < 30 ? limit * sources.length : limit;
        const results = await Promise.allSettled(
          sources.map((item, index) => {
            if (!fetchedSources[index]) {
              return Promise.resolve({
                items: [],
                errors: {},
                hasMore: false,
                nextPage: cursorState.nextPages?.[item] ?? null,
                nextCursor: cursorState.sourceCursors?.[item] ?? null
              });
            }
            const startedAt = Date.now();
            const userAgent = item === 'nodeseek' ? nodeSeekUserAgent : discourseAuth?.userAgent;
            const prepare =
              item !== 'v2ex' && (item === 'yaohuo' || !userAgent?.trim())
                ? (preparationSignal: AbortSignal) => resolveWebViewUserAgent(undefined, preparationSignal)
                : undefined;
            return readWithinAggregateSourceBudget(
              item,
              signal,
              (sourceSignal) => {
                const readSource = (sourceFetcher: Fetcher) =>
                  getFeed({
                    ...options,
                    source: item,
                    nodeSeekAuthenticated,
                    discourseAuth,
                    cursor: item === 'v2ex' ? cursorState.sourceCursors?.[item] || undefined : cursor,
                    fetcher: sourceFetcher,
                    limit: item === 'v2ex' ? limit : adapterLimit,
                    page: requestedPages[item],
                    signal: sourceSignal
                  });
                const sourceFetcher = fetcherForSource ? scopeFetcher(fetcherForSource(item)) : aggregateFetcher;
                return item === 'linuxdo' || item === 'nodeseek'
                  ? runForumSourceReadAttempt(item, sourceFetcher, readSource, () => !sourceSignal.aborted)
                  : readSource(sourceFetcher);
              },
              { prepare, preparation, trace: diagnosticTrace }
            ).then(
              (value) => {
                if (diagnosticTrace) {
                  markDiagnosticStage(diagnosticTrace, 'transport', {
                    source: item,
                    state: 'success',
                    latencyMs: Date.now() - startedAt
                  });
                }
                return value;
              },
              (error) => {
                const aggregateTimedOut =
                  typeof error === 'object' &&
                  error !== null &&
                  (error as { reason?: unknown }).reason === 'aggregate_timeout';
                const reason = aggregateTimedOut ? 'timeout' : normalizeDiagnosticReason(error);
                if (diagnosticTrace) {
                  markDiagnosticStage(diagnosticTrace, 'transport', {
                    source: item,
                    state: reason === 'timeout' || reason === 'canceled' ? reason : 'failure',
                    reason,
                    latencyMs: Date.now() - startedAt
                  });
                }
                throw error;
              }
            );
          })
        );
        if (signal?.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
        const items = mergeTopics(
          [],
          sortTopicsByTime([
            ...bufferedItems,
            ...results.flatMap((result) => (result.status === 'fulfilled' ? result.value.items : []))
          ])
        );
        const selected = balanceTopicsBySource(items).slice(0, limit);
        const selectedKeys = new Set(selected.map(topicIdentity));
        const nextBuffers: Partial<Record<Source, Topic[]>> = {};
        for (const item of items) {
          if (selectedKeys.has(topicIdentity(item))) {
            continue;
          }
          (nextBuffers[item.source] ??= []).push(item);
        }
        const nextPages: Partial<Record<Source, number | null>> = {};
        const sourceCursors: Partial<Record<Source, string | null>> = {};
        const hasFulfilledSource = results.some((result) => result.status === 'fulfilled');
        sources.forEach((item, index) => {
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
          const aggregateTimedOut =
            result?.status === 'rejected' &&
            typeof result.reason === 'object' &&
            result.reason !== null &&
            (result.reason as { reason?: unknown }).reason === 'aggregate_timeout';
          if (fetchedSources[index] && (hasRetryableCursor || hasFulfilledSource || aggregateTimedOut)) {
            nextPages[item] = requestedPages[item];
            if (cursorState.sourceCursors?.[item]) sourceCursors[item] = cursorState.sourceCursors[item];
          }
        });
        const nextCursor = encodeAllFeedCursor({ buffers: nextBuffers, nextPages, sourceCursors }, sources);
        const response = {
          items: selected,
          errors: mergeSettledSourceErrors(results, sources),
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
      },
      () => signal?.aborted !== true
    );
  }
  if (isDiscourseSource(source)) {
    return getLinuxDoFeed({
      linuxDoAccess: discourseAuth,
      category,
      fetcher,
      linuxDoFilter: feedFilter as DiscourseFeedFilter | undefined,
      limit,
      page,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead(source, {
    nodeseek: () => getNodeSeekFeed({ ...options, feedFilter: feedFilter as NodeSeekFeedFilter | undefined }),
    v2ex: () => getV2exFeed({ ...options, feedFilter: feedFilter as V2exFeedFilter | undefined }),
    yaohuo: () => getYaohuoFeedDirect({ category, page, limit, yaohuoFetcher: fetcher, signal, timeoutMs })
  });
}

export async function getCategories({
  source = 'all',
  fetcher,
  fetcherForSource,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  diagnosticTrace,
  preparation = { deadline: Date.now() + READ_PREPARATION_BUDGET_MS },
  includedSources,
  unavailableSources,
  signal,
  timeoutMs
}: {
  source?: FeedSource;
  fetcher?: Fetcher;
  fetcherForSource?: (source: Source) => Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  diagnosticTrace?: DiagnosticTrace;
  preparation?: ReadPreparation;
  includedSources?: readonly Source[];
  unavailableSources?: readonly Source[];
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<CategoriesResponse> {
  const readSourceCategories = (item: Source, sourceFetcher: Fetcher): Promise<CategoriesResponse> => {
    if (signal?.aborted) return Promise.reject(new Error(REQUEST_CANCELED_MESSAGE));
    if (unavailableSources?.includes(item)) return unavailableSourceRead(item);
    if (item === 'yaohuo') return Promise.resolve(yaohuoCategoriesResponse());
    const userAgent = item === 'nodeseek' ? nodeSeekUserAgent : discourseAuth?.userAgent;
    const prepare =
      (item === 'nodeseek' || item === 'linuxdo') && !userAgent?.trim()
        ? (preparationSignal: AbortSignal) => resolveWebViewUserAgent(undefined, preparationSignal)
        : undefined;
    return readWithinAggregateSourceBudget(
      item,
      signal,
      (sourceSignal) => {
        const readSource = (activeFetcher: Fetcher) =>
          getSourceCategories({
            source: item,
            nodeSeekAuthenticated,
            nodeSeekUserAgent,
            discourseAuth,
            fetcher: activeFetcher,
            signal: sourceSignal,
            timeoutMs
          });
        return source === 'all' && (item === 'linuxdo' || item === 'nodeseek')
          ? runForumSourceReadAttempt(item, sourceFetcher, readSource, () => !sourceSignal.aborted)
          : readSource(sourceFetcher);
      },
      { prepare, preparation, trace: diagnosticTrace }
    );
  };
  if (source === 'all') {
    return runForumSourceReadAggregateAttempt(
      fetcher || fetch,
      async (aggregateFetcher, scopeFetcher) => {
        const sources = includedAggregateSources(includedSources, sourceValues);
        const results = await Promise.allSettled(
          sources.map((item) =>
            readSourceCategories(item, fetcherForSource ? scopeFetcher(fetcherForSource(item)) : aggregateFetcher)
          )
        );
        if (signal?.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
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
      },
      () => signal?.aborted !== true
    );
  }
  return readSourceCategories(source, fetcher || fetch);
}

export function getSourceCategories({
  source,
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  signal,
  timeoutMs
}: NonNullable<Parameters<typeof getCategories>[0]> & { source: Source }): Promise<CategoriesResponse> {
  if (signal?.aborted) return Promise.reject(new Error(REQUEST_CANCELED_MESSAGE));
  if (source === 'yaohuo') return Promise.resolve(yaohuoCategoriesResponse());
  if (isDiscourseSource(source)) {
    return getLinuxDoCategories({ linuxDoAccess: discourseAuth, fetcher, signal, timeoutMs });
  }
  const options = { authenticated: nodeSeekAuthenticated, fetcher, nodeSeekUserAgent, signal, timeoutMs };
  return dispatchSourceRead(source, {
    nodeseek: () => getNodeSeekCategories(options),
    v2ex: () => getV2exCategories(options)
  });
}
