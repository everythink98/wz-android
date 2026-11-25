import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hashKey, useQuery, useQueryClient, type InfiniteData, type Query, type QueryKey } from '@tanstack/react-query';
import type { LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import type { ReadGateway } from '@/sources/readGateway';
import { useDiscourseVisited } from '@/platform/query/useDiscourseVisited';
import {
  defaultFeedFilters,
  shouldAllowFeedRemotePagination,
  shouldLoadCategoriesForSource,
  shouldUseFeedFilter,
  shouldUseReadingFilter
} from '@/domain/forum/feedOptions';
import { applyFeedFilter, mergeCategories, mergeTopics, type ReadingFilter } from '@/domain/forum/feed';
import { topicKey } from '@/domain/reader/readerData';
import type { ReaderView } from '@/domain/reader/readerRecordState';
import { applyFeedTopicUpdate } from '@/sources/linuxdo/reader';
import {
  aggregateForumReadPlan,
  forumReadSites,
  type AggregateForumReadPlan,
  type ForumReadPlan
} from '@/domain/forum/readPlan';
import { nextPagePosition, type PagePosition } from '@/domain/forum/pagination';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { sourceLabel } from '@/domain/forum/presentation';
import { isFeedFilterSource, type Source } from '@/domain/forum/sourceCatalog';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import {
  formatSourceErrorMessages,
  linuxDoVerificationNavigationMessage,
  nodeSeekVerificationNavigationMessage,
  sourceErrorFromUnknown,
  sourceReadRecoveryOutcome,
  yaohuoErrorRequiresLoginPanel
} from '@/sources/sourceErrors';
import type {
  Category,
  CategoriesResponse,
  FeedFilterState,
  FeedResponse,
  FeedSource,
  SourceErrorInfo,
  SourceFeedFilter,
  SourceErrors,
  SourceLoadOutcomeKind,
  Topic
} from '@/domain/forum/models';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import {
  resumeExactQuery,
  resumeInfiniteQueryPage,
  useFirstPageInfiniteQuery,
  type FirstPageInfiniteQueryOptions
} from '@/platform/query/useFirstPageInfiniteQuery';
import { createFeedRefreshIntent } from './feedRefreshIntent';

type FeedPageParam = PagePosition;
type FeedPage = FeedResponse & FeedPageParam;
type FeedRead = { queryKey: ReturnType<typeof forumQueryKeys.feed>; plan: ForumReadPlan | AggregateForumReadPlan };
type FeedSnapshot = { read: FeedRead; data: InfiniteData<FeedPage> };

type FeedSourceState = {
  hasMore: boolean;
  items: Topic[];
  loadMoreFailureSignal: number;
  loadMoreErrorMessage?: string;
  loadingMore: boolean;
  manualContinuation: boolean;
  nextCursor?: string;
  page: number;
  refreshing: boolean;
};

class FeedQueryError extends Error {
  constructor(
    message: string,
    readonly pageParam: FeedPageParam,
    readonly sourceErrors: SourceErrors = {},
    readonly parseEmpty = false
  ) {
    super(message);
  }
}

function feedFilterForRequest(
  source: FeedSource,
  category: string,
  filters: FeedFilterState
): SourceFeedFilter | undefined {
  if (!shouldUseFeedFilter(source, category)) {
    return undefined;
  }
  return source !== 'all' && isFeedFilterSource(source) ? filters[source] : undefined;
}

export function shouldWaitForReaderDataBeforeFeed(source: FeedSource, readingFilter: ReadingFilter) {
  return shouldUseReadingFilter(source) && readingFilter !== 'all';
}

function nextFeedPage(lastPage: FeedPage): FeedPageParam | undefined {
  return nextPagePosition(lastPage, lastPage);
}

function validateFeedPage(source: FeedSource, pageParam: FeedPageParam, response: FeedResponse): FeedPage {
  const errors = response.errors || {};
  const diagnostic = sourceDiagnosticSummary(response);
  const loadMore = pageParam.page > 1;
  const parseEmpty = diagnostic?.isParseEmpty === true && (loadMore || Number(diagnostic.validCount || 0) === 0);
  const rejectsPartial =
    Object.keys(errors).length > 0 && (source !== 'all' || loadMore || response.items.length === 0);
  if (parseEmpty) {
    throw new FeedQueryError(
      loadMore ? '加载下一页失败：返回内容无法解析，请重试。' : `${sourceLabel(source)} 返回内容无法解析，请重试。`,
      pageParam,
      errors,
      true
    );
  }
  if (rejectsPartial) {
    throw new FeedQueryError(formatSourceErrorMessages(errors, sourceLabel), pageParam, errors);
  }
  return { ...response, ...pageParam, errors };
}

function mergeFeedPages(pages: FeedPage[], source: FeedSource) {
  const lastPage = pages.at(-1);
  if (!lastPage) return { errors: {}, hasMore: false, items: [], nextPage: null };
  const merged = mergeTopics(
    [],
    pages.flatMap((page) => page.items)
  );
  const hasUpdates = pages.some((page) => Boolean(page.topicUpdates?.length));
  let items = merged;
  if (hasUpdates && merged.length) {
    const indexByKey = new Map<string, number>();
    merged.forEach((topic, index) => {
      indexByKey.set(topicKey(topic), index);
    });
    let updated: Topic[] | undefined;
    for (const page of pages) {
      for (const update of page.topicUpdates || []) {
        const index = indexByKey.get(topicKey(update));
        if (index === undefined) continue;
        const current = (updated ?? merged)[index]!;
        const next = applyFeedTopicUpdate(current, update);
        if (next === current) continue;
        updated ??= [...merged];
        updated[index] = next;
      }
    }
    if (updated) {
      items = source === 'all' ? updated.filter((topic) => topic.pinned !== true) : updated;
    }
  }
  return {
    ...lastPage,
    errors: pages.reduce((errors, page) => ({ ...errors, ...page.errors }), {}),
    items
  };
}

function safeFeedSnapshot(previous: FeedSnapshot | undefined, current: FeedRead) {
  if (!previous || previous.read.plan.source !== current.plan.source) return undefined;
  const previousFilter = previous.read.queryKey[3];
  const currentFilter = current.queryKey[3];
  if (previousFilter.category !== currentFilter.category || previousFilter.feedFilter !== currentFilter.feedFilter)
    return undefined;
  if (previous.read.plan.cacheScope === current.plan.cacheScope) return previous.data;
  const currentScopes = new Map(forumReadSites(current.plan).map((site) => [site.source, site.cacheScope]));
  const retainedSources = new Set(
    forumReadSites(previous.read.plan)
      .filter((site) => currentScopes.get(site.source) === site.cacheScope)
      .map((site) => site.source)
  );
  const pages = previous.data.pages.map((page) => ({
    ...page,
    errors: Object.fromEntries(
      Object.entries(page.errors || {}).filter(([source]) => retainedSources.has(source as Source))
    ),
    hasMore: false,
    items: page.items.filter((topic) => retainedSources.has(topic.source)),
    ...(page.topicUpdates
      ? { topicUpdates: page.topicUpdates.filter((topic) => retainedSources.has(topic.source)) }
      : {}),
    nextCursor: null,
    nextPage: null
  }));
  return pages.some((page) => page.items.length) ? { ...previous.data, pages } : undefined;
}

function sourceErrorsFromFeedError(source: FeedSource, error: unknown): SourceErrors {
  if (error instanceof FeedQueryError && Object.keys(error.sourceErrors).length) {
    return error.sourceErrors;
  }
  const sourceError = sourceErrorFromUnknown(source, error);
  return source === 'all' ? {} : { [source]: sourceError };
}

function firstSourceError(errors: SourceErrors): SourceErrorInfo | undefined {
  return Object.values(errors).find(Boolean);
}

export function feedOutcomeKind(itemCount: number, errors: SourceErrors): SourceLoadOutcomeKind {
  const sourceErrors = Object.values(errors).filter((error): error is SourceErrorInfo => Boolean(error));
  if (
    sourceErrors.some(
      (error) =>
        error.kind === 'login-required' || error.kind === 'login-expired' || error.kind === 'verification-required'
    )
  ) {
    return 'auth';
  }
  if (sourceErrors.length) {
    return itemCount ? 'partial' : 'error';
  }
  return itemCount ? 'data' : 'empty';
}

export function useFeedController({
  active,
  enabledSources: enabledFeedSources,
  enabledSourcesKey,
  feedLayoutKey = '',
  catalogCategories,
  sessionEpochs = initialForumSessionEpochs,
  linuxDoVerificationActive,
  nodeSeekVerificationActive = false,
  notify,
  readerData,
  readerDataLoaded,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  readGateway
}: {
  active: boolean;
  enabledSources: Source[];
  enabledSourcesKey: string;
  feedLayoutKey?: string;
  catalogCategories: Category[];
  sessionEpochs?: ForumSessionEpochs;
  linuxDoVerificationActive: boolean;
  nodeSeekVerificationActive?: boolean;
  notify: (message: string) => void;
  readerData: ReaderView;
  readerDataLoaded: boolean;
  showLinuxDoVerification: (message?: string, recovery?: ReadRecovery) => void | boolean | Promise<void | boolean>;
  showNodeSeekVerification: (message: string, recovery: ReadRecovery) => void;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
}) {
  const queryClient = useQueryClient();
  const serverReading = useDiscourseVisited(readGateway.reading?.scope());
  const feedActive = active;
  const [previousLayoutKey, setPreviousLayoutKey] = useState(feedLayoutKey);
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilterState] = useState('');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>(defaultFeedFilters);
  if (previousLayoutKey !== feedLayoutKey) {
    // Start the new Pager with the default controls while preserving the read snapshot.
    setPreviousLayoutKey(feedLayoutKey);
    setFeedSource('all');
    setReadingFilter('all');
    setCategoryFilterState('');
    setFeedFilters(defaultFeedFilters);
  }
  const feedSourceIncluded = feedSource === 'all' || enabledFeedSources.includes(feedSource);
  const feedSourceRequestEnabled =
    feedSource === 'all' ? enabledFeedSources.length > 0 : enabledFeedSources.includes(feedSource);
  useLayoutEffect(() => {
    if (feedSourceIncluded) return;
    setFeedSource('all');
    setCategoryFilterState('');
  }, [feedSourceIncluded]);
  const [handledReadErrors] = useState(() => new WeakMap<Query, number>());
  const claimReadError = useCallback(
    (queryKey: QueryKey, error: unknown) => {
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (!query || query.state.fetchStatus !== 'idle' || !error || query.state.error !== error) return false;
      if (handledReadErrors.get(query) === query.state.errorUpdateCount) return false;
      handledReadErrors.set(query, query.state.errorUpdateCount);
      return true;
    },
    [handledReadErrors, queryClient]
  );
  const handledPartialErrorsRef = useRef<unknown>(undefined);
  const yaohuoLoginPromptedRef = useRef(false);
  const feedReadPlan =
    feedSource === 'all'
      ? aggregateForumReadPlan(
          'feed',
          enabledFeedSources.map((source) => readGateway.getReadPlan(source, 'feed'))
        )
      : readGateway.getReadPlan(feedSource, 'feed');
  const feedReadPlanScope = feedReadPlan.cacheScope;
  const feedFilter = feedFilterForRequest(feedSource, categoryFilter, feedFilters);
  const feedRead = useMemo<FeedRead>(
    () => ({
      plan: feedReadPlan,
      queryKey: forumQueryKeys.feed({
        category: categoryFilter || undefined,
        enabledSourcesKey,
        feedFilter,
        readPlanScope: feedReadPlanScope,
        scope: sessionEpochs,
        source: feedReadPlan.source
      })
    }),
    [categoryFilter, enabledSourcesKey, feedFilter, feedReadPlanScope, sessionEpochs, feedSource]
  );
  const feedQueryKey = feedRead.queryKey;
  const waitingForReaderData = !readerDataLoaded && shouldWaitForReaderDataBeforeFeed(feedSource, readingFilter);
  const feedEnabled = feedSourceRequestEnabled && !waitingForReaderData;

  const needsSourceCategories =
    feedSourceRequestEnabled && feedSource !== 'all' && shouldLoadCategoriesForSource(catalogCategories, feedSource);
  const sourceCategoriesSource = feedSource === 'all' ? 'v2ex' : feedSource;
  const sourceCategoriesReadPlan = readGateway.getReadPlan(sourceCategoriesSource, 'categories');
  const sourceCategoriesOptions = {
    queryKey: forumQueryKeys.categories(
      sourceCategoriesSource,
      sessionEpochs,
      undefined,
      sourceCategoriesReadPlan.cacheScope
    ),
    enabled: feedActive && !linuxDoVerificationActive && needsSourceCategories,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const trace = beginDiagnosticTrace('feed', 'categories', { source: feedSource });
      try {
        const data = await readGateway.getCategories(
          { source: sourceCategoriesSource, signal },
          { plan: sourceCategoriesReadPlan, trace }
        );
        const error = firstSourceError(data.errors || {});
        if (error) {
          throw Object.assign(new Error(error.message), error);
        }
        finishDiagnosticTrace(trace, 'success', { source: feedSource, itemCount: data.items.length });
        return data;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: feedSource,
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  };
  const sourceCategoriesQuery = useQuery(sourceCategoriesOptions);
  const categories = useMemo(
    () =>
      mergeCategories(
        catalogCategories,
        feedSource !== 'all' && feedSourceIncluded ? sourceCategoriesQuery.data?.items || [] : []
      ),
    [catalogCategories, feedSource, feedSourceIncluded, sourceCategoriesQuery.data?.items]
  );
  const feedCategories = useMemo(
    () =>
      enabledFeedSources.reduce((current, source) => {
        const plan = readGateway.getReadPlan(source, 'categories');
        const cached = queryClient.getQueryData<CategoriesResponse>(
          forumQueryKeys.categories(source, sessionEpochs, undefined, plan.cacheScope)
        );
        return cached?.items.length ? mergeCategories(current, cached.items) : current;
      }, categories),
    [categories, enabledFeedSources, queryClient, readGateway, sessionEpochs]
  );

  const [feedSnapshot, setFeedSnapshot] = useState<FeedSnapshot>();
  const feedQueryHash = hashKey(feedQueryKey);
  const activeFeedRead = useRef<{ hash: string; layout: string } | null>(null);
  useLayoutEffect(() => {
    activeFeedRead.current =
      feedActive && feedSourceRequestEnabled ? { hash: feedQueryHash, layout: feedLayoutKey } : null;
    return () => {
      activeFeedRead.current = null;
    };
  }, [feedActive, feedLayoutKey, feedQueryHash, feedSourceRequestEnabled]);
  const currentFeedRead = useCallback(() => {
    const current = activeFeedRead.current;
    return current?.hash === feedQueryHash && current.layout === feedLayoutKey ? current : null;
  }, [feedLayoutKey, feedQueryHash]);
  const nodeSeekReadScope = hashKey([feedLayoutKey, categoryFilter, feedFilter, sessionEpochs.nodeseek]);
  const nodeSeekReadOwner = useRef<object | null>(null);
  const nodeSeekReadActive = feedActive && feedSourceRequestEnabled && feedSource === 'nodeseek';
  useLayoutEffect(() => {
    nodeSeekReadOwner.current = nodeSeekReadActive ? { scope: nodeSeekReadScope } : null;
    return () => {
      nodeSeekReadOwner.current = null;
    };
  }, [nodeSeekReadActive, nodeSeekReadScope]);
  const feedOptions: FirstPageInfiniteQueryOptions<FeedPage, FeedPageParam> = {
    queryKey: feedQueryKey,
    enabled: feedActive && feedEnabled,
    initialPageParam: { page: 1 } satisfies FeedPageParam,
    queryFn: async ({ pageParam, signal }) => {
      const trace = beginDiagnosticTrace('feed', 'load', {
        source: feedSource,
        page: pageParam.page,
        hasCursor: Boolean(pageParam.cursor),
        isLoadMore: pageParam.page > 1
      });
      try {
        markDiagnosticStage(trace, 'guard', {
          source: feedSource,
          state: pageParam.page > 1 ? 'load-more' : 'initial'
        });
        const response = await readGateway.getFeed(
          {
            source: feedSource,
            page: pageParam.page,
            cursor: pageParam.cursor,
            limit: 30,
            category: categoryFilter || undefined,
            feedFilter,
            signal
          },
          {
            plan: feedRead.plan,
            trace,
            ...(pageParam.page > 1
              ? {
                  hasSelectedFeedTopic: (id: string) =>
                    queryClient
                      .getQueryData<InfiniteData<FeedPage, FeedPageParam>>(feedQueryKey)
                      ?.pages.some((page) => page.items.some((item) => item.source === 'linuxdo' && item.id === id)) ===
                    true
                }
              : {}),
            ...(pageParam.page === 1 && !queryClient.getQueryData(feedQueryKey)
              ? {
                  onProgress: (response: FeedResponse) => {
                    if (
                      pageParam.page !== 1 ||
                      signal.aborted ||
                      !currentFeedRead() ||
                      queryClient.getQueryData(feedQueryKey) ||
                      !response.items.length
                    )
                      return;
                    setFeedSnapshot({
                      read: feedRead,
                      data: { pages: [validateFeedPage(feedSource, pageParam, response)], pageParams: [pageParam] }
                    });
                  }
                }
              : {}),
            onBeforeSessionChange: (response) => {
              if (
                feedSource !== 'all' ||
                pageParam.page !== 1 ||
                signal.aborted ||
                !currentFeedRead() ||
                response.items.length === 0 ||
                !Object.keys(response.errors || {}).length
              )
                return;
              let page: FeedPage;
              try {
                page = validateFeedPage(feedSource, pageParam, response);
              } catch {
                // The normal Query path below still reports the invalid page.
                return;
              }
              setFeedSnapshot({ read: feedRead, data: { pages: [page], pageParams: [pageParam] } });
            }
          }
        );
        const page = validateFeedPage(feedSource, pageParam, response);
        markDiagnosticStage(trace, 'apply', {
          source: feedSource,
          itemCount: page.items.length,
          hasMore: Boolean(nextFeedPage(page))
        });
        finishDiagnosticTrace(trace, Object.keys(page.errors).length ? 'partial' : 'success', {
          source: feedSource,
          itemCount: page.items.length,
          partialErrorCount: Object.keys(page.errors).length
        });
        return page;
      } catch (error) {
        const sourceError = sourceErrorFromUnknown(feedSource, error);
        finishDiagnosticTrace(
          trace,
          signal.aborted
            ? 'canceled'
            : sourceError.kind === 'verification-required' ||
                sourceError.kind === 'login-required' ||
                sourceError.kind === 'permission-denied'
              ? 'blocked'
              : 'failure',
          { source: feedSource, reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error) }
        );
        throw error instanceof FeedQueryError
          ? error
          : new FeedQueryError(sourceError.message, pageParam, { [feedSource]: sourceError });
      }
    },
    getNextPageParam: nextFeedPage
  };
  const [feedQuery, refreshFeedFirstPage] = useFirstPageInfiniteQuery(feedOptions);
  const retainedFeed = useMemo(() => safeFeedSnapshot(feedSnapshot, feedRead), [feedSnapshot, feedRead]);
  const feedData = feedQuery.data ?? retainedFeed;
  useLayoutEffect(() => {
    setFeedSnapshot((current) =>
      current?.read === feedRead && current?.data === feedData
        ? current
        : feedData
          ? { read: feedRead, data: feedData }
          : undefined
    );
  }, [feedData, feedRead]);
  const pages = feedData?.pages || [];
  const [refreshIntent] = useState(createFeedRefreshIntent);
  const [manualRefreshing, setManualRefreshing] = useState(refreshIntent.refreshing);
  const publishRefresh = useCallback(() => setManualRefreshing(refreshIntent.refreshing), [refreshIntent]);
  useLayoutEffect(() => {
    refreshIntent.invalidate();
    publishRefresh();
    return () => refreshIntent.invalidate();
  }, [feedActive, feedLayoutKey, feedQueryHash, feedSourceRequestEnabled, publishRefresh, refreshIntent]);
  const mergedFeed = useMemo(() => mergeFeedPages(pages, feedSource), [feedSource, pages]);
  const lastPage = pages.at(-1);
  const nextPage = feedSourceRequestEnabled && feedQuery.data && lastPage ? nextFeedPage(lastPage) : undefined;
  const loadMoreError = feedSourceRequestEnabled && feedQuery.isFetchNextPageError;
  useEffect(() => {
    if (feedSource === 'yaohuo' && feedQuery.isSuccess) {
      yaohuoLoginPromptedRef.current = false;
    }
  }, [feedQuery.isSuccess, feedSource]);
  const activeFeedState = useMemo<FeedSourceState>(
    () => ({
      hasMore: Boolean(nextPage),
      items: feedSourceRequestEnabled ? mergedFeed.items : [],
      loadMoreFailureSignal: loadMoreError ? feedQuery.errorUpdatedAt : 0,
      loadMoreErrorMessage: loadMoreError ? feedQuery.error?.message : undefined,
      loadingMore: feedQuery.isFetchingNextPage,
      manualContinuation: Boolean(nextPage && lastPage?.manualContinuation),
      nextCursor: nextPage?.cursor,
      page: lastPage?.page || 1,
      refreshing: manualRefreshing || (feedQuery.isRefetching && !feedQuery.isFetchingNextPage)
    }),
    [
      feedQuery.error,
      feedQuery.errorUpdatedAt,
      feedQuery.isFetchingNextPage,
      feedQuery.isRefetching,
      feedSourceRequestEnabled,
      lastPage?.manualContinuation,
      lastPage?.page,
      loadMoreError,
      manualRefreshing,
      mergedFeed.items,
      nextPage
    ]
  );
  const feedAllowsRemotePagination =
    feedSourceRequestEnabled && shouldAllowFeedRemotePagination(feedSource, readingFilter);
  const shownFeedItems = useMemo(
    () =>
      applyFeedFilter(
        activeFeedState.items,
        readerData,
        shouldUseReadingFilter(feedSource) ? readingFilter : 'all',
        serverReading
      ),
    [activeFeedState.items, feedSource, readerData.favorites, readerData.history, readingFilter, serverReading]
  );
  const settledFeedOutcomeKind = !feedSourceRequestEnabled
    ? 'empty'
    : waitingForReaderData || feedQuery.isPending || feedQuery.isFetching
      ? undefined
      : feedOutcomeKind(
          mergedFeed.items.length,
          feedQuery.isError ? sourceErrorsFromFeedError(feedSource, feedQuery.error) : mergedFeed.errors
        );
  const resumeLinuxDoFeed = useCallback(
    async (loadMore: boolean, signal?: AbortSignal): Promise<LinuxDoReadResumeOutcome> => {
      const owner = currentFeedRead();
      if (!owner || signal?.aborted) return 'stale';
      const result = loadMore ? await feedQuery.fetchNextPage({ cancelRefetch: false }) : await refreshFeedFirstPage();
      if (signal?.aborted || activeFeedRead.current !== owner) return 'stale';
      claimReadError(feedQueryKey, result.error);
      const errors = result.data?.pages.at(-1)?.errors || {};
      handledPartialErrorsRef.current = errors;
      if (errors.linuxdo) return sourceReadRecoveryOutcome('linuxdo', errors.linuxdo);
      if (!result.isError) return 'completed';
      const error =
        result.error instanceof FeedQueryError ? result.error.sourceErrors.linuxdo || result.error : result.error;
      return sourceReadRecoveryOutcome('linuxdo', error);
    },
    [claimReadError, currentFeedRead, feedQuery.fetchNextPage, feedQueryKey, refreshFeedFirstPage]
  );

  const requestNodeSeekReadRecovery = useCallback(
    (
      message: string,
      queryKey: readonly unknown[],
      plan: ForumReadPlan,
      resume: (ownsRead: () => boolean, signal?: AbortSignal) => Promise<LinuxDoReadResumeOutcome>
    ) => {
      const owner = nodeSeekReadOwner.current;
      if (!owner || nodeSeekVerificationActive) return;
      const isCurrent = () => nodeSeekReadOwner.current === owner;
      showNodeSeekVerification(message, {
        queryKey,
        isCurrent,
        resume: (signal) =>
          resume(
            () => isCurrent() && readGateway.getReadPlan('nodeseek', plan.operation).cacheScope === plan.cacheScope,
            signal
          )
      });
    },
    [nodeSeekVerificationActive, readGateway, showNodeSeekVerification]
  );

  useEffect(() => {
    if (
      !feedActive ||
      feedSource === 'all' ||
      !feedSourceRequestEnabled ||
      !sourceCategoriesQuery.isError ||
      !claimReadError(sourceCategoriesOptions.queryKey, sourceCategoriesQuery.error)
    ) {
      return;
    }
    const error = sourceErrorFromUnknown(feedSource, sourceCategoriesQuery.error);
    if (feedSource === 'nodeseek' && error.kind === 'verification-required') {
      const { queryKey } = sourceCategoriesOptions;
      requestNodeSeekReadRecovery(error.message, queryKey, sourceCategoriesReadPlan, async (ownsRead, signal) => {
        const result = await resumeExactQuery(queryClient, sourceCategoriesOptions, ownsRead, signal);
        if (result.kind === 'failed') {
          claimReadError(queryKey, result.error);
          return sourceReadRecoveryOutcome('nodeseek', result.error);
        }
        return result.kind === 'success' ? 'completed' : 'stale';
      });
    } else {
      notify(error.message);
    }
  }, [
    claimReadError,
    feedActive,
    feedSource,
    feedSourceRequestEnabled,
    notify,
    queryClient,
    requestNodeSeekReadRecovery,
    sourceCategoriesOptions,
    sourceCategoriesReadPlan,
    sourceCategoriesQuery.errorUpdatedAt,
    sourceCategoriesQuery.isError,
    sourceCategoriesQuery.isFetching,
    sourceCategoriesQuery.error
  ]);

  useEffect(() => {
    if (
      !feedActive ||
      !feedSourceRequestEnabled ||
      !feedQuery.isError ||
      !claimReadError(feedQueryKey, feedQuery.error)
    ) {
      return;
    }
    const errors = sourceErrorsFromFeedError(feedSource, feedQuery.error);
    const sourceError = firstSourceError(errors) || sourceErrorFromUnknown(feedSource, feedQuery.error);
    const loadMorePrefix = loadMoreError ? '加载下一页失败：' : '';
    const message = `${loadMorePrefix}${sourceError.message}`;
    const nodeSeekMessage = nodeSeekVerificationNavigationMessage(feedSource, errors);
    if (feedRead.plan.source === 'nodeseek' && (nodeSeekMessage || sourceError.kind === 'verification-required')) {
      const pageParam = feedQuery.error instanceof FeedQueryError ? feedQuery.error.pageParam : null;
      const page = loadMoreError && pageParam ? ({ kind: 'next', pageParam } as const) : ({ kind: 'first' } as const);
      requestNodeSeekReadRecovery(message, feedQueryKey, feedRead.plan, async (ownsRead, signal) => {
        const result = await resumeInfiniteQueryPage(queryClient, feedOptions, page, ownsRead, signal);
        if (result.kind === 'stale') return 'stale';
        if (result.kind === 'success') return 'completed';
        claimReadError(feedQueryKey, result.error);
        const failure =
          result.error instanceof FeedQueryError ? (result.error.sourceErrors.nodeseek ?? result.error) : result.error;
        return sourceReadRecoveryOutcome('nodeseek', failure);
      });
      return;
    }
    const linuxDoMessage = linuxDoVerificationNavigationMessage(feedSource, errors);
    if (linuxDoMessage || (feedSource === 'linuxdo' && sourceError.kind === 'verification-required')) {
      const recovery: ReadRecovery = {
        queryKey: feedQueryKey,
        resume: (signal) => resumeLinuxDoFeed(loadMoreError, signal)
      };
      void showLinuxDoVerification(linuxDoMessage ? `${loadMorePrefix}${linuxDoMessage}` : message, recovery);
      return;
    }
    if (feedSource === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
      if (yaohuoLoginPromptedRef.current) return;
      yaohuoLoginPromptedRef.current = true;
      showYaohuoLogin(sourceError.kind === 'login-expired' ? '妖火登录已失效，请重新登录。' : message);
      return;
    }
    if (!loadMoreError) notify(message);
  }, [
    claimReadError,
    feedQuery.errorUpdatedAt,
    feedQuery.isFetching,
    feedQuery.isError,
    feedQueryKey,
    feedRead.plan,
    feedOptions,
    feedActive,
    feedSource,
    feedSourceRequestEnabled,
    loadMoreError,
    notify,
    resumeLinuxDoFeed,
    showLinuxDoVerification,
    queryClient,
    requestNodeSeekReadRecovery,
    showYaohuoLogin
  ]);

  useEffect(() => {
    if (!feedActive || !feedSourceRequestEnabled) {
      return;
    }
    const errors = feedQuery.data?.pages.at(-1)?.errors || {};
    if (!Object.keys(errors).length) {
      return;
    }
    if (handledPartialErrorsRef.current === errors) {
      return;
    }
    handledPartialErrorsRef.current = errors;
    const linuxDoMessage = linuxDoVerificationNavigationMessage(feedSource, errors);
    if (linuxDoMessage) {
      void showLinuxDoVerification(linuxDoMessage, {
        queryKey: feedQueryKey,
        resume: (signal) => resumeLinuxDoFeed(false, signal)
      });
    } else {
      notify(formatSourceErrorMessages(errors, sourceLabel));
    }
  }, [
    feedActive,
    feedQuery.dataUpdatedAt,
    feedSource,
    feedSourceRequestEnabled,
    feedQueryKey,
    feedQuery.data,
    notify,
    resumeLinuxDoFeed,
    showLinuxDoVerification
  ]);

  const loadFeed = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    const owner = currentFeedRead();
    if (!owner || !nextPage) return 'stale';
    const current = queryClient.getQueryState<InfiniteData<FeedPage, FeedPageParam>>(feedQueryKey);
    if (!current || current.fetchStatus !== 'idle') return 'stale';
    const last = current.data?.pages.at(-1);
    const currentNextPage = last ? nextFeedPage(last) : undefined;
    if (currentNextPage?.page !== nextPage.page || currentNextPage.cursor !== nextPage.cursor) return 'stale';
    const result = await feedQuery.fetchNextPage({ cancelRefetch: false });
    if (activeFeedRead.current !== owner) return 'stale';
    return result.isError ? 'failed' : 'completed';
  }, [currentFeedRead, feedQuery.fetchNextPage, feedQueryKey, nextPage, queryClient]);

  const refreshFeed = useCallback(async () => {
    const owner = currentFeedRead();
    if (!owner) return;
    if (feedSource === 'yaohuo') yaohuoLoginPromptedRef.current = false;
    const refresh = refreshIntent.begin();
    publishRefresh();
    try {
      await queryClient.cancelQueries({ queryKey: feedQueryKey, exact: true });
      if (activeFeedRead.current !== owner || !refreshIntent.owns(refresh)) return;
      await refreshFeedFirstPage();
    } finally {
      refreshIntent.finished(refresh);
      publishRefresh();
    }
  }, [currentFeedRead, refreshFeedFirstPage, feedQueryKey, feedSource, queryClient, refreshIntent, publishRefresh]);

  const changeFeedSource = useCallback(
    (source: FeedSource) => {
      if (source === feedSource || (source !== 'all' && !enabledFeedSources.includes(source))) {
        return;
      }
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === source && queryKey[2] === 'feed'
      });
      if (source === 'yaohuo') yaohuoLoginPromptedRef.current = false;
      setFeedSource(source);
      setCategoryFilterState('');
    },
    [enabledFeedSources, feedSource, queryClient]
  );

  const setFeedFilter = useCallback(
    (filter: SourceFeedFilter) => {
      setFeedFilters((current) =>
        feedSource !== 'all' && isFeedFilterSource(feedSource)
          ? ({ ...current, [feedSource]: filter } as FeedFilterState)
          : current
      );
    },
    [feedSource]
  );

  const setCategoryFilter = useCallback(
    (category: string) => {
      if (category === categoryFilter) return;
      if (feedSource === 'yaohuo') yaohuoLoginPromptedRef.current = false;
      setCategoryFilterState(category);
    },
    [categoryFilter, feedSource]
  );

  const abortFeedRequests = useCallback(() => {
    void queryClient.cancelQueries({
      predicate: (query) =>
        query.queryKey[0] === 'forum' &&
        (query.queryKey[2] === 'feed' || (query.queryKey[2] === 'categories' && !query.isActive()))
    });
  }, [queryClient]);

  useEffect(() => {
    if (feedActive) return;
    abortFeedRequests();
  }, [feedActive, abortFeedRequests]);
  useEffect(() => abortFeedRequests, [abortFeedRequests]);

  return {
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy:
      feedActive &&
      feedSourceRequestEnabled &&
      (waitingForReaderData || feedQuery.isPending || (feedQuery.isError && feedQuery.isRefetching)) &&
      shownFeedItems.length === 0,
    feedCategories,
    enabledFeedSources,
    feedFilter,
    feedFilters,
    feedOutcomeKind: settledFeedOutcomeKind,
    feedSource,
    loadFeed,
    readingFilter,
    refreshFeed,
    setCategoryFilter,
    setFeedFilter,
    setReadingFilter,
    shownFeedItems
  };
}
