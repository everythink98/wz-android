import { topicKey } from '@/domain/reader/readerData';
import { getNodeSeekCategories, getNodeSeekFeed } from '@/sources/nodeseek/reader';
import { yaohuoCategoriesResponse } from '@/sources/yaohuo/feedParser';
import { getV2exCategories, getV2exFeed } from '@/sources/v2ex/reader';
import { getYaohuoFeedDirect } from '@/sources/yaohuo/reader';
import { getLinuxDoCategories, getLinuxDoFeed, type LinuxDoReadAuth } from '@/sources/linuxdo/reader';
import { isDiscourseSource, sourceValues } from '@/domain/forum/sourceCatalog';
import { balanceTopicsBySource, mergeTopics } from '@/domain/forum/feed';
import { nextPagePosition, pagePosition, type PagePosition } from '@/domain/forum/pagination';
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
import { DEFAULT_REQUEST_TIMEOUT_MS, REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import { markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { isRecord, sortTopicsByTime } from '@/domain/forum/html';
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

type AllFeedCursorWire = {
  buffers?: Partial<Record<Source, Topic[]>>;
  nextPages?: Partial<Record<Source, number | null>>;
  sourceCursors?: Partial<Record<Source, string | null>>;
  pinnedTopicKeys?: string[];
};

type AllFeedSourceState = {
  source: Source;
  buffer: Topic[];
  continuation?: PagePosition;
};

type AggregateFeedSourcePlan = Readonly<AllFeedSourceState> &
  ({ kind: 'buffer-only' } | { kind: 'fetch'; request: PagePosition });

function excludePinnedTopics(items: Topic[], pinnedKeys = new Set<string>()) {
  for (const topic of items) {
    if (topic.pinned === true) pinnedKeys.add(topicKey(topic));
  }
  return pinnedKeys.size ? items.filter((topic) => !pinnedKeys.has(topicKey(topic))) : items;
}

function isCursorTopic(value: unknown, source: Source): value is Topic {
  return (
    isRecord(value) &&
    value.source === source &&
    typeof value.id === 'string' &&
    Boolean(value.id.trim()) &&
    typeof value.title === 'string' &&
    Boolean(value.title.trim()) &&
    typeof value.url === 'string' &&
    Boolean(value.url.trim()) &&
    typeof value.createdAt === 'string'
  );
}

function decodeAllFeedCursor(cursor: string | undefined, sources: readonly Source[]) {
  const empty = () => ({
    sourceStates: sources.map<AllFeedSourceState>((source) => ({ source, buffer: [] })),
    pinnedKeys: new Set<string>()
  });
  if (!cursor) return empty();
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor)) as AllFeedCursorWire;
    const pinnedKeys = new Set(
      Array.isArray(parsed.pinnedTopicKeys)
        ? parsed.pinnedTopicKeys.filter(
            (key) => typeof key === 'string' && sources.some((source) => key.startsWith(`${source}:`))
          )
        : []
    );
    const sourceStates = sources.map((source) => {
      const buffer = parsed.buffers?.[source];
      const items = Array.isArray(buffer) ? buffer.filter((topic) => isCursorTopic(topic, source)) : [];
      const cursor = parsed.sourceCursors?.[source];
      return {
        source,
        buffer: excludePinnedTopics(items, pinnedKeys),
        continuation: pagePosition(parsed.nextPages?.[source], typeof cursor === 'string' ? cursor : undefined)
      };
    });
    return { sourceStates, pinnedKeys };
  } catch {
    return empty();
  }
}

function encodeAllFeedCursor(states: readonly AllFeedSourceState[], pinnedKeys: ReadonlySet<string>) {
  const buffers: Partial<Record<Source, Topic[]>> = {};
  const nextPages: Partial<Record<Source, number | null>> = {};
  const sourceCursors: Partial<Record<Source, string | null>> = {};
  for (const { source, buffer, continuation } of states) {
    if (buffer.length) {
      buffers[source] = buffer;
    }
    if (continuation) {
      nextPages[source] = continuation.page;
      if (continuation.cursor) sourceCursors[source] = continuation.cursor;
    }
  }
  if (!Object.keys(buffers).length && !Object.keys(nextPages).length && !Object.keys(sourceCursors).length) {
    return undefined;
  }
  return encodeURIComponent(
    JSON.stringify({
      buffers,
      nextPages,
      sourceCursors,
      pinnedTopicKeys: pinnedKeys.size ? [...pinnedKeys] : undefined
    })
  );
}

function includedAggregateSources(includedSources: readonly Source[] | undefined, sources: readonly Source[]) {
  const included = new Set(includedSources || sources);
  return sources.filter((source) => included.has(source));
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
  timeoutMs,
  onProgress
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
  onProgress?: (response: FeedResponse) => void;
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
        const { sourceStates, pinnedKeys } = decodeAllFeedCursor(cursor, sources);
        const bufferedItems = sourceStates.flatMap((state) => state.buffer);
        const hasRetryableCursor = Boolean(
          cursor && sourceStates.some((state) => state.buffer.length || state.continuation)
        );
        const plans = sourceStates.map<AggregateFeedSourcePlan>((state) => {
          const { continuation } = state;
          if (cursor && (!continuation || state.buffer.length >= limit)) {
            return { ...state, kind: 'buffer-only' };
          }
          return {
            ...state,
            kind: 'fetch',
            request: continuation ?? { page }
          };
        });
        const adapterLimit = limit < 30 ? limit * sources.length : limit;
        let visibleItems: Topic[] = [];
        const previewLimit = Math.floor(limit / Math.max(1, sources.length));
        const results = await Promise.allSettled(
          plans.map((plan): Promise<FeedResponse> => {
            const item = plan.source;
            if (plan.kind === 'buffer-only') {
              return Promise.resolve({ items: [], errors: {} });
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
                    cursor: plan.request.cursor,
                    fetcher: sourceFetcher,
                    limit: item === 'v2ex' ? limit : adapterLimit,
                    page: plan.request.page,
                    signal: sourceSignal
                  });
                const sourceFetcher = fetcherForSource ? scopeFetcher(fetcherForSource(item)) : aggregateFetcher;
                return item === 'linuxdo' || item === 'nodeseek'
                  ? runForumSourceReadAttempt(item, sourceFetcher, readSource, () => !sourceSignal.aborted)
                  : readSource(sourceFetcher);
              },
              { prepare, preparation, trace: diagnosticTrace, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS }
            ).then(
              (value) => {
                if (onProgress && page === 1 && !cursor && !signal?.aborted && value.items.length && previewLimit) {
                  // Reserve each source's share so already visible posts survive the final balanced page.
                  const preview = sortTopicsByTime(mergeTopics([], excludePinnedTopics(value.items))).slice(
                    0,
                    previewLimit
                  );
                  if (preview.length) {
                    visibleItems = mergeTopics(visibleItems, preview);
                    onProgress({ items: visibleItems, errors: {} });
                  }
                }
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
        const candidates = [
          ...bufferedItems,
          ...results.flatMap((result) => (result.status === 'fulfilled' ? result.value.items : []))
        ];
        const unpinnedCandidates = excludePinnedTopics(candidates, pinnedKeys);
        const items = mergeTopics([], sortTopicsByTime(unpinnedCandidates));
        const balanced = balanceTopicsBySource(items).slice(0, limit);
        const balancedKeys = new Set(balanced.map(topicKey));
        const selected = mergeTopics(
          visibleItems.filter((item) => balancedKeys.has(topicKey(item))),
          balanced
        );
        const selectedKeys = new Set(selected.map(topicKey));
        const nextBuffers: Partial<Record<Source, Topic[]>> = {};
        for (const item of items) {
          if (selectedKeys.has(topicKey(item))) {
            continue;
          }
          (nextBuffers[item.source] ??= []).push(item);
        }
        const hasFulfilledSource = results.some((result) => result.status === 'fulfilled');
        const nextStates = plans.map<AllFeedSourceState>((plan, index) => {
          const result = results[index];
          const buffer = nextBuffers[plan.source] ?? [];
          if (result?.status === 'fulfilled') {
            return {
              source: plan.source,
              buffer,
              continuation: plan.kind === 'fetch' ? nextPagePosition(result.value, plan.request) : plan.continuation
            };
          }
          const aggregateTimedOut =
            result?.status === 'rejected' &&
            typeof result.reason === 'object' &&
            result.reason !== null &&
            (result.reason as { reason?: unknown }).reason === 'aggregate_timeout';
          return {
            source: plan.source,
            buffer,
            continuation:
              plan.kind === 'fetch' && (hasRetryableCursor || hasFulfilledSource || aggregateTimedOut)
                ? plan.request
                : undefined
          };
        });
        const nextCursor = encodeAllFeedCursor(nextStates, pinnedKeys);
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
            isExpectedEmpty:
              selected.length === 0 &&
              (candidates.length > unpinnedCandidates.length ||
                (facts.droppedCount === 0 && (page > 1 || Boolean(category))))
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
  v2exNodeDirectory,
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
  v2exNodeDirectory?: boolean;
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
            v2exNodeDirectory,
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
  v2exNodeDirectory,
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
    v2ex: () => getV2exCategories({ ...options, v2exNodeDirectory })
  });
}
