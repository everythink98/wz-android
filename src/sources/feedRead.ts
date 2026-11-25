import { topicKey } from '@/domain/reader/readerData';
import { getNodeSeekCategories, getNodeSeekFeed } from '@/sources/nodeseek/reader';
import { yaohuoCategoriesResponse } from '@/sources/yaohuo/feedParser';
import { getV2exCategories, getV2exFeed } from '@/sources/v2ex/reader';
import { getYaohuoFeedDirect } from '@/sources/yaohuo/reader';
import {
  applyFeedTopicUpdate,
  getLinuxDoCategories,
  getLinuxDoFeed,
  mergeTopicsWithLinuxDoMetadata,
  stripLinuxDoTopicReading,
  type LinuxDoReadAuth
} from '@/sources/linuxdo/reader';
import { isDiscourseSource, sourceValues } from '@/domain/forum/sourceCatalog';
import { balanceTopicsBySource } from '@/domain/forum/feed';
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
  bind?: string;
  buffers?: Partial<Record<Source, Topic[]>>;
  nextPages?: Partial<Record<Source, number | null>>;
  sourceCursors?: Partial<Record<Source, string | null>>;
  pinnedTopicKeys?: string[];
  manualSources?: Source[];
};

type AllFeedSourceState = {
  source: Source;
  buffer: Topic[];
  continuation?: PagePosition;
  manualContinuation?: true;
};

type AggregateFeedSourcePlan = Readonly<AllFeedSourceState> &
  ({ kind: 'buffer-only' } | { kind: 'fetch'; request: PagePosition });

function aggregateFeedCursorBinding(
  sources: readonly Source[],
  scopes: Partial<Record<Source, string>> | undefined,
  discourseAuth: LinuxDoReadAuth | undefined,
  nodeSeekAuthenticated: boolean | undefined,
  category: string | undefined,
  feedFilter: SourceFeedFilter | undefined
) {
  const directScopes = {
    linuxdo:
      discourseAuth?.authenticated === true
        ? JSON.stringify([
            'authenticated',
            discourseAuth.identityKey,
            discourseAuth.sessionEpoch,
            discourseAuth.categoryCacheScope,
            discourseAuth.readingScope
          ])
        : 'public',
    nodeseek: nodeSeekAuthenticated ? 'authenticated' : 'public',
    v2ex: 'public',
    yaohuo: 'public'
  };
  return JSON.stringify([
    sources.map((source) => [source, scopes?.[source] ?? directScopes[source]]),
    category?.trim() || '',
    feedFilter || ''
  ]);
}

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

function decodeAllFeedCursor(cursor: string | undefined, sources: readonly Source[], binding: string) {
  const empty = (restart = false) => ({
    sourceStates: sources.map<AllFeedSourceState>((source) => ({ source, buffer: [] })),
    pinnedKeys: new Set<string>(),
    restart
  });
  if (!cursor) return empty();
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor)) as AllFeedCursorWire;
    if (!isRecord(parsed) || ('bind' in parsed && parsed.bind !== binding)) return empty(true);
    const bound = parsed.bind === binding;
    const pinnedKeys = new Set(
      bound && Array.isArray(parsed.pinnedTopicKeys)
        ? parsed.pinnedTopicKeys.filter(
            (key) => typeof key === 'string' && sources.some((source) => key.startsWith(`${source}:`))
          )
        : []
    );
    const sourceStates = sources.map<AllFeedSourceState>((source) => {
      const buffer = parsed.buffers?.[source];
      const items = bound && Array.isArray(buffer) ? buffer.filter((topic) => isCursorTopic(topic, source)) : [];
      const sourceCursor = parsed.sourceCursors?.[source];
      const continuation = pagePosition(
        parsed.nextPages?.[source],
        typeof sourceCursor === 'string' ? sourceCursor : undefined
      );
      const manualContinuation =
        bound && continuation && Array.isArray(parsed.manualSources) && parsed.manualSources.includes(source);
      return {
        source,
        buffer: excludePinnedTopics(items, pinnedKeys).map(stripLinuxDoTopicReading),
        continuation,
        ...(manualContinuation ? { manualContinuation: true } : {})
      };
    });
    return { sourceStates, pinnedKeys, restart: !bound && !sourceStates.some((state) => state.continuation) };
  } catch {
    return empty(true);
  }
}

function encodeAllFeedCursor(states: readonly AllFeedSourceState[], pinnedKeys: ReadonlySet<string>, binding: string) {
  const buffers: Partial<Record<Source, Topic[]>> = {};
  const nextPages: Partial<Record<Source, number | null>> = {};
  const sourceCursors: Partial<Record<Source, string | null>> = {};
  const manualSources: Source[] = [];
  for (const { source, buffer, continuation, manualContinuation } of states) {
    if (buffer.length) {
      buffers[source] = buffer.map(stripLinuxDoTopicReading);
    }
    if (continuation) {
      nextPages[source] = continuation.page;
      if (continuation.cursor) sourceCursors[source] = continuation.cursor;
      if (manualContinuation) manualSources.push(source);
    }
  }
  if (!Object.keys(buffers).length && !Object.keys(nextPages).length && !Object.keys(sourceCursors).length) {
    return undefined;
  }
  return encodeURIComponent(
    JSON.stringify({
      bind: binding,
      buffers,
      nextPages,
      sourceCursors,
      pinnedTopicKeys: pinnedKeys.size ? [...pinnedKeys] : undefined,
      manualSources: manualSources.length ? manualSources : undefined
    })
  );
}

function includedAggregateSources(includedSources: readonly Source[] | undefined, sources: readonly Source[]) {
  const included = new Set(includedSources || sources);
  return sources.filter((source) => included.has(source));
}

function readSourceFeed({
  source,
  mode,
  discourseAuth,
  feedFilter,
  ...options
}: {
  source: Source;
  mode: 'direct' | 'aggregate';
  page: number;
  limit: number;
  cursor?: string;
  category?: string;
  feedFilter?: SourceFeedFilter;
  fetcher?: Fetcher;
  authenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FeedResponse> {
  const { category, cursor, fetcher, limit, page, signal, timeoutMs } = options;
  if (isDiscourseSource(source)) {
    return getLinuxDoFeed({
      linuxDoAccess: discourseAuth,
      aggregateHead: mode === 'aggregate' && page === 1 && !cursor,
      category,
      cursor,
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
  aggregateFeedScopes,
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
  aggregateFeedScopes?: Partial<Record<Source, string>>;
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
        const binding = aggregateFeedCursorBinding(
          sources,
          aggregateFeedScopes,
          discourseAuth,
          nodeSeekAuthenticated,
          category,
          feedFilter
        );
        const { sourceStates, pinnedKeys, restart } = decodeAllFeedCursor(cursor, sources, binding);
        const currentPage = restart ? 1 : page;
        const continuing = Boolean(cursor) && !restart;
        const bufferedItems = sourceStates.flatMap((state) => state.buffer);
        const hasRetryableCursor = Boolean(
          continuing && sourceStates.some((state) => state.buffer.length || state.continuation)
        );
        const plans = sourceStates.map<AggregateFeedSourcePlan>((state) => {
          const { continuation } = state;
          if (continuing && (!continuation || state.buffer.length >= limit)) {
            return { ...state, kind: 'buffer-only' };
          }
          return {
            ...state,
            kind: 'fetch',
            request: continuation ?? { page: currentPage }
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
                  readSourceFeed({
                    ...options,
                    source: item,
                    mode: 'aggregate',
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
                if (
                  onProgress &&
                  currentPage === 1 &&
                  !continuing &&
                  !signal?.aborted &&
                  value.items.length &&
                  previewLimit
                ) {
                  // Reserve each source's share so already visible posts survive the final balanced page.
                  const previewCandidates = excludePinnedTopics(value.items);
                  const preview = sortTopicsByTime(mergeTopicsWithLinuxDoMetadata([], previewCandidates)).slice(
                    0,
                    previewLimit
                  );
                  if (preview.length) {
                    visibleItems = mergeTopicsWithLinuxDoMetadata(visibleItems, preview);
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
        const incomingItems = results.flatMap((result) => (result.status === 'fulfilled' ? result.value.items : []));
        const incomingUpdates = results.flatMap((result) =>
          result.status === 'fulfilled' && result.value.topicUpdates ? result.value.topicUpdates : []
        );
        const updatesByKey = new Map<string, Topic>();
        for (const update of incomingUpdates) {
          const key = topicKey(update);
          if (update.pinned === true) pinnedKeys.add(key);
          const existing = updatesByKey.get(key);
          updatesByKey.set(key, existing ? applyFeedTopicUpdate(existing, update) : update);
        }
        const matchedUpdateKeys = new Set<string>();
        const updatedBufferedItems = bufferedItems.map((topic) => {
          const key = topicKey(topic);
          const update = updatesByKey.get(key);
          if (!update) return topic;
          matchedUpdateKeys.add(key);
          return applyFeedTopicUpdate(topic, update);
        });
        const candidates = [...updatedBufferedItems, ...incomingItems];
        const unpinnedCandidates = excludePinnedTopics(candidates, pinnedKeys);
        const mergedCandidates = mergeTopicsWithLinuxDoMetadata([], unpinnedCandidates).map((topic) => {
          const key = topicKey(topic);
          const update = updatesByKey.get(key);
          if (!update) return topic;
          matchedUpdateKeys.add(key);
          return applyFeedTopicUpdate(topic, update);
        });
        const items = sortTopicsByTime(excludePinnedTopics(mergedCandidates, pinnedKeys));
        const balanced = balanceTopicsBySource(items).slice(0, limit);
        const balancedKeys = new Set(balanced.map(topicKey));
        const visiblePreferred = visibleItems.filter((item) => balancedKeys.has(topicKey(item)));
        const selected = mergeTopicsWithLinuxDoMetadata(visiblePreferred, balanced);
        const selectedKeys = new Set(selected.map(topicKey));
        const nextBuffers: Partial<Record<Source, Topic[]>> = {};
        for (const item of items) {
          if (selectedKeys.has(topicKey(item))) {
            continue;
          }
          (nextBuffers[item.source] ??= []).push(item);
        }
        const forwardedTopicUpdates: Topic[] = [];
        for (const [key, update] of updatesByKey.entries()) {
          if (matchedUpdateKeys.has(key)) continue;
          forwardedTopicUpdates.push(update);
        }
        const hasFulfilledSource = results.some((result) => result.status === 'fulfilled');
        const nextStates = plans.map<AllFeedSourceState>((plan, index) => {
          const result = results[index];
          const buffer = nextBuffers[plan.source] ?? [];
          if (result?.status === 'fulfilled') {
            const continuation =
              plan.kind === 'fetch' ? nextPagePosition(result.value, plan.request) : plan.continuation;
            const manualContinuation =
              plan.kind === 'fetch' ? result.value.manualContinuation : plan.manualContinuation;
            return {
              source: plan.source,
              buffer,
              continuation,
              manualContinuation
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
            manualContinuation: plan.manualContinuation,
            continuation:
              plan.kind === 'fetch' && (hasRetryableCursor || hasFulfilledSource || aggregateTimedOut)
                ? plan.request
                : undefined
          };
        });
        const nextCursor = encodeAllFeedCursor(nextStates, pinnedKeys, binding);
        // Draining a full buffer does not consume the protected source position.
        const manualContinuation = nextStates.some(
          (state) => state.manualContinuation && state.continuation && state.buffer.length < limit
        );
        const response: FeedResponse = {
          items: selected,
          ...(forwardedTopicUpdates.length ? { topicUpdates: forwardedTopicUpdates } : {}),
          errors: mergeSettledSourceErrors(results, sources),
          hasMore: Boolean(nextCursor),
          ...(manualContinuation ? { manualContinuation: true } : {}),
          nextPage: nextCursor ? currentPage + 1 : null,
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
            hasRepeatedCursor:
              facts.hasRepeatedCursor || response.nextPage === currentPage || response.nextCursor === cursor,
            isExpectedEmpty:
              selected.length === 0 &&
              (candidates.length > unpinnedCandidates.length ||
                (facts.droppedCount === 0 && (currentPage > 1 || Boolean(category) || Boolean(nextCursor))))
          }
        );
      },
      () => signal?.aborted !== true
    );
  }
  return readSourceFeed({ ...options, source, mode: 'direct', discourseAuth, feedFilter });
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
