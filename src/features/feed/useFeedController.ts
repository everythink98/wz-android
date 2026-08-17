import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import type { ReadGateway } from '@/sources/readGateway';
import {
  defaultFeedFilters,
  shouldAllowFeedRemotePagination,
  shouldLoadCategoriesForSource,
  shouldUseFeedFilter,
  shouldUseReadingFilter
} from '@/domain/forum/feedOptions';
import { applyFeedFilter, mergeCategories, mergeTopics, type ReadingFilter } from '@/domain/forum/feed';
import type { ReaderData } from '@/domain/reader/readerData';
import { canonicalEnabledSourcesKey, projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { forumReadPlanScopesKey } from '@/domain/forum/readPlan';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { sourceLabel } from '@/domain/forum/presentation';
import { isFeedFilterSource, sourceValues, type Source } from '@/domain/forum/sourceCatalog';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
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
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type FeedPageParam = { cursor?: string; page: number };
type FeedPage = FeedResponse & FeedPageParam;

type FeedSourceState = {
  hasMore: boolean;
  items: Topic[];
  loadMoreFailureSignal: number;
  loadingMore: boolean;
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
  if (!lastPage.hasMore || !lastPage.nextPage) {
    return undefined;
  }
  if (lastPage.nextPage === lastPage.page && (lastPage.nextCursor || '') === (lastPage.cursor || '')) {
    return undefined;
  }
  return { page: lastPage.nextPage, ...(lastPage.nextCursor ? { cursor: lastPage.nextCursor } : {}) };
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

function mergeFeedPages(pages: FeedPage[]) {
  return pages.reduce<FeedResponse>(
    (current, page) => ({
      ...page,
      errors: { ...current.errors, ...page.errors },
      items: mergeTopics(current.items, page.items)
    }),
    {
      errors: {},
      hasMore: false,
      items: [],
      nextPage: null
    }
  );
}

function queryReadPlanScopes(queryKey: readonly unknown[]) {
  const source = queryKey[1];
  const state = queryKey[3] as { readPlanScope?: unknown } | undefined;
  if (typeof source !== 'string' || typeof state?.readPlanScope !== 'string') return null;
  if (source !== 'all') return new Map<Source, string>([[source as Source, state.readPlanScope]]);
  const scopes = new Map<Source, string>();
  for (const entry of state.readPlanScope.split(',')) {
    const matchedSource = sourceValues.find((candidate) => entry.startsWith(`${candidate}:`));
    if (matchedSource) scopes.set(matchedSource, entry.slice(matchedSource.length + 1));
  }
  return scopes;
}

function changedReadPlanSources(previousQueryKey: readonly unknown[], currentQueryKey: readonly unknown[]) {
  if (
    previousQueryKey[0] !== currentQueryKey[0] ||
    previousQueryKey[1] !== currentQueryKey[1] ||
    previousQueryKey[2] !== currentQueryKey[2]
  ) {
    return null;
  }
  const previousState = previousQueryKey[3] as Record<string, unknown> | undefined;
  const currentState = currentQueryKey[3] as Record<string, unknown> | undefined;
  for (const field of ['category', 'enabledSources', 'feedFilter'] as const) {
    if (previousState?.[field] !== currentState?.[field]) return null;
  }
  const previousScopes = queryReadPlanScopes(previousQueryKey);
  const currentScopes = queryReadPlanScopes(currentQueryKey);
  if (!previousScopes || !currentScopes) return null;
  return new Set(sourceValues.filter((source) => previousScopes.get(source) !== currentScopes.get(source)));
}

function safeFeedPlaceholder(
  previousData: { pages: FeedPage[]; pageParams: FeedPageParam[] } | undefined,
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[]
) {
  if (!previousData || !previousQueryKey) return undefined;
  const changedSources = changedReadPlanSources(previousQueryKey, currentQueryKey);
  if (!changedSources) return undefined;
  if (!changedSources.size) return previousData;
  const pages = previousData.pages.map((page) => ({
    ...page,
    errors: Object.fromEntries(
      Object.entries(page.errors || {}).filter(([source]) => !changedSources.has(source as Source))
    ),
    hasMore: false,
    items: page.items.filter((topic) => !changedSources.has(topic.source)),
    nextCursor: null,
    nextPage: null
  }));
  return pages.some((page) => page.items.length) ? { ...previousData, pages } : undefined;
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
  catalogCategories,
  sessionEpochs = initialForumSessionEpochs,
  linuxDoVerificationActive,
  notify,
  readerData,
  readerDataLoaded,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  readGateway
}: {
  active: boolean;
  catalogCategories: Category[];
  sessionEpochs?: ForumSessionEpochs;
  linuxDoVerificationActive: boolean;
  notify: (message: string) => void;
  readerData: ReaderData;
  readerDataLoaded: boolean;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
}) {
  const queryClient = useQueryClient();
  const feedActive = active;
  const { feedSources: enabledFeedSources } = projectContentSourcePreferences(readerData.settings.contentSources);
  const enabledSourcesKey = canonicalEnabledSourcesKey(readerData.settings.contentSources);
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>(defaultFeedFilters);
  const feedSourceIncluded = feedSource === 'all' || enabledFeedSources.includes(feedSource);
  const feedSourceRequestEnabled =
    feedSource === 'all' ? enabledFeedSources.length > 0 : enabledFeedSources.includes(feedSource);
  useLayoutEffect(() => {
    if (feedSourceIncluded) return;
    setFeedSource('all');
    setCategoryFilter('');
  }, [feedSourceIncluded]);
  const handledSourceCategoriesErrorRef = useRef<unknown>(undefined);
  const handledFeedErrorRef = useRef<unknown>(undefined);
  const handledPartialErrorsRef = useRef<unknown>(undefined);
  const feedReadPlanScopes = (feedSource === 'all' ? enabledFeedSources : [feedSource]).map(
    (source) => [source, readGateway.getReadPlan(source, 'feed').cacheScope] as const
  );
  const feedReadPlanScope =
    feedSource === 'all'
      ? forumReadPlanScopesKey(feedReadPlanScopes)
      : feedReadPlanScopes[0]?.[1] || 'blocked:source-disabled';
  const feedFilter = feedFilterForRequest(feedSource, categoryFilter, feedFilters);
  const feedQueryKey = forumQueryKeys.feed({
    category: categoryFilter || undefined,
    enabledSourcesKey,
    feedFilter,
    readPlanScope: feedReadPlanScope,
    scope: sessionEpochs,
    source: feedSource
  });
  const feedEnabled =
    feedSourceRequestEnabled &&
    (feedSource !== 'all' || enabledFeedSources.length > 0) &&
    (readerDataLoaded || !shouldWaitForReaderDataBeforeFeed(feedSource, readingFilter));

  const needsSourceCategories =
    feedSourceRequestEnabled && feedSource !== 'all' && shouldLoadCategoriesForSource(catalogCategories, feedSource);
  const sourceCategoriesSource = feedSource === 'all' ? 'v2ex' : feedSource;
  const sourceCategoriesReadPlan = readGateway.getReadPlan(sourceCategoriesSource, 'categories');
  const sourceCategoriesQuery = useQuery({
    queryKey: forumQueryKeys.categories(
      sourceCategoriesSource,
      sessionEpochs,
      undefined,
      sourceCategoriesReadPlan.cacheScope
    ),
    enabled: feedActive && !linuxDoVerificationActive && needsSourceCategories,
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('feed', 'categories', { source: feedSource });
      try {
        const data = await readGateway.getCategories(
          { source: feedSource, signal },
          { readPlanScope: sourceCategoriesReadPlan.cacheScope, trace }
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
  });
  const categories = useMemo(
    () => mergeCategories(catalogCategories, sourceCategoriesQuery.data?.items || []),
    [catalogCategories, sourceCategoriesQuery.data?.items]
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

  const feedQuery = useInfiniteQuery({
    queryKey: feedQueryKey,
    enabled: feedActive && feedEnabled,
    initialPageParam: { page: 1 } satisfies FeedPageParam,
    placeholderData: (previousData, previousQuery) =>
      safeFeedPlaceholder(previousData, previousQuery?.queryKey, feedQueryKey),
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
            ...(feedSource === 'all'
              ? { includedSources: enabledFeedSources, readPlanScopes: feedReadPlanScopes }
              : { readPlanScope: feedReadPlanScope }),
            trace
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
  });
  const pages = feedQuery.data?.pages || [];
  const refreshFeedScope = JSON.stringify([feedActive, feedQueryKey]);
  const refreshFeedGenerationRef = useRef(0);
  useLayoutEffect(() => {
    refreshFeedGenerationRef.current += 1;
    return () => {
      refreshFeedGenerationRef.current += 1;
    };
  }, [refreshFeedScope]);
  const mergedFeed = useMemo(() => mergeFeedPages(pages), [pages]);
  const lastPage = pages.at(-1);
  const nextPage =
    feedSourceRequestEnabled && !feedQuery.isPlaceholderData && lastPage ? nextFeedPage(lastPage) : undefined;
  const loadMoreError = feedSourceRequestEnabled && feedQuery.isFetchNextPageError;
  const activeFeedState = useMemo<FeedSourceState>(
    () => ({
      hasMore: Boolean(nextPage),
      items: feedSourceRequestEnabled ? mergedFeed.items : [],
      loadMoreFailureSignal: loadMoreError ? feedQuery.errorUpdatedAt : 0,
      loadingMore: feedQuery.isFetchingNextPage,
      nextCursor: nextPage?.cursor,
      page: lastPage?.page || 1,
      refreshing: feedQuery.isRefetching && !feedQuery.isFetchingNextPage
    }),
    [
      feedQuery.errorUpdatedAt,
      feedQuery.isFetchingNextPage,
      feedQuery.isRefetching,
      feedSourceRequestEnabled,
      lastPage?.page,
      loadMoreError,
      mergedFeed.items,
      nextPage
    ]
  );
  const feedAllowsRemotePagination =
    feedSourceRequestEnabled && shouldAllowFeedRemotePagination(feedSource, readingFilter);
  const shownFeedItems = useMemo(
    () =>
      applyFeedFilter(activeFeedState.items, readerData, shouldUseReadingFilter(feedSource) ? readingFilter : 'all'),
    [activeFeedState.items, feedSource, readerData.favorites, readerData.history, readingFilter]
  );
  const settledFeedOutcomeKind = !feedSourceRequestEnabled
    ? 'empty'
    : feedQuery.isPending || feedQuery.isFetching
      ? undefined
      : feedOutcomeKind(
          mergedFeed.items.length,
          feedQuery.isError ? sourceErrorsFromFeedError(feedSource, feedQuery.error) : mergedFeed.errors
        );
  const feedRecoveryQueryIdentity = JSON.stringify(feedQueryKey);
  const feedRecoveryOwnerRef = useCommittedRef({
    active: feedActive,
    queryIdentity: feedRecoveryQueryIdentity,
    sourceRequestEnabled: feedSourceRequestEnabled
  });
  const resumeLinuxDoFeed = useCallback(
    async (loadMore: boolean): Promise<LinuxDoReadResumeOutcome> => {
      const owner = feedRecoveryOwnerRef.current;
      if (!owner.active || owner.queryIdentity !== feedRecoveryQueryIdentity || !owner.sourceRequestEnabled) {
        return 'stale';
      }
      const result = loadMore
        ? await feedQuery.fetchNextPage({ cancelRefetch: false })
        : await feedQuery.refetch({ cancelRefetch: false });
      handledFeedErrorRef.current = result.error;
      const errors = result.data?.pages.at(-1)?.errors || {};
      handledPartialErrorsRef.current = errors;
      if (errors.linuxdo) return sourceReadRecoveryOutcome('linuxdo', errors.linuxdo);
      if (!result.isError) return 'completed';
      const error =
        result.error instanceof FeedQueryError ? result.error.sourceErrors.linuxdo || result.error : result.error;
      return sourceReadRecoveryOutcome('linuxdo', error);
    },
    [feedQuery.fetchNextPage, feedQuery.refetch, feedRecoveryOwnerRef, feedRecoveryQueryIdentity]
  );

  useEffect(() => {
    if (
      !feedActive ||
      !feedSourceRequestEnabled ||
      !sourceCategoriesQuery.isError ||
      handledSourceCategoriesErrorRef.current === sourceCategoriesQuery.error
    ) {
      return;
    }
    handledSourceCategoriesErrorRef.current = sourceCategoriesQuery.error;
    if (sourceCategoriesQuery.isFetching) {
      return;
    }
    const error = sourceErrorFromUnknown(feedSource, sourceCategoriesQuery.error);
    if (feedSource === 'nodeseek' && error.kind === 'verification-required') {
      showNodeSeekVerification(error.message);
    } else {
      notify(error.message);
    }
  }, [
    feedActive,
    feedSource,
    feedSourceRequestEnabled,
    notify,
    showNodeSeekVerification,
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
      handledFeedErrorRef.current === feedQuery.error
    ) {
      return;
    }
    handledFeedErrorRef.current = feedQuery.error;
    if (feedQuery.isFetching) {
      return;
    }
    const errors = sourceErrorsFromFeedError(feedSource, feedQuery.error);
    const sourceError = firstSourceError(errors) || sourceErrorFromUnknown(feedSource, feedQuery.error);
    const loadMorePrefix = loadMoreError ? '加载下一页失败：' : '';
    const message = `${loadMorePrefix}${sourceError.message}`;
    const nodeSeekMessage = nodeSeekVerificationNavigationMessage(feedSource, errors);
    if (nodeSeekMessage || (feedSource === 'nodeseek' && sourceError.kind === 'verification-required')) {
      showNodeSeekVerification(nodeSeekMessage ? `${loadMorePrefix}${nodeSeekMessage}` : message);
      return;
    }
    const linuxDoMessage = linuxDoVerificationNavigationMessage(feedSource, errors);
    if (linuxDoMessage || (feedSource === 'linuxdo' && sourceError.kind === 'verification-required')) {
      const recovery: LinuxDoReadRecovery = {
        queryKey: feedQueryKey,
        resume: () => resumeLinuxDoFeed(loadMoreError)
      };
      void showLinuxDoVerification(linuxDoMessage ? `${loadMorePrefix}${linuxDoMessage}` : message, recovery);
      return;
    }
    if (feedSource === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
      showYaohuoLogin(sourceError.kind === 'login-expired' ? '妖火登录已失效，请重新登录。' : message);
      return;
    }
    notify(message);
  }, [
    feedQuery.errorUpdatedAt,
    feedQuery.isFetching,
    feedQuery.isError,
    feedQueryKey,
    feedActive,
    feedSource,
    feedSourceRequestEnabled,
    loadMoreError,
    notify,
    resumeLinuxDoFeed,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
  ]);

  useEffect(() => {
    if (!feedActive || !feedSourceRequestEnabled) {
      return;
    }
    const errors = lastPage?.errors || {};
    if (!Object.keys(errors).length) {
      return;
    }
    if (handledPartialErrorsRef.current === errors) {
      return;
    }
    handledPartialErrorsRef.current = errors;
    const nodeSeekMessage = nodeSeekVerificationNavigationMessage(feedSource, errors);
    const linuxDoMessage = linuxDoVerificationNavigationMessage(feedSource, errors);
    if (nodeSeekMessage) {
      showNodeSeekVerification(nodeSeekMessage);
    } else if (linuxDoMessage) {
      void showLinuxDoVerification(linuxDoMessage, {
        queryKey: feedQueryKey,
        resume: () => resumeLinuxDoFeed(false)
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
    lastPage?.errors,
    notify,
    resumeLinuxDoFeed,
    showLinuxDoVerification,
    showNodeSeekVerification
  ]);

  const loadFeed = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!feedActive || !feedSourceRequestEnabled || !nextPage || feedQuery.isFetchingNextPage) {
      return 'stale';
    }
    const result = await feedQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [feedActive, feedSourceRequestEnabled, feedQuery.fetchNextPage, feedQuery.isFetchingNextPage, nextPage]);

  const refreshFeed = useCallback(async () => {
    if (!feedActive || !feedSourceRequestEnabled) return;
    const refreshGeneration = ++refreshFeedGenerationRef.current;
    notify('正在更新列表');
    await queryClient.cancelQueries({ queryKey: feedQueryKey, exact: true });
    if (refreshFeedGenerationRef.current !== refreshGeneration) return;
    const result = await feedQuery.refetch({ cancelRefetch: true });
    if (refreshFeedGenerationRef.current !== refreshGeneration) {
      return;
    }
    if (!result.isError) notify('列表已更新');
  }, [feedActive, feedQuery.refetch, feedQueryKey, feedSourceRequestEnabled, notify, queryClient]);

  const changeFeedSource = useCallback(
    (source: FeedSource) => {
      if (source === feedSource || (source !== 'all' && !enabledFeedSources.includes(source))) {
        return;
      }
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === source && queryKey[2] === 'feed'
      });
      setFeedSource(source);
      setCategoryFilter('');
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

  const abortFeedRequests = useCallback(() => {
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === 'forum' && (queryKey[2] === 'feed' || (queryKey[2] === 'categories' && queryKey[1] !== 'all'))
    });
  }, [queryClient]);

  useEffect(() => {
    if (feedActive) return;
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === 'forum' && (queryKey[2] === 'feed' || (queryKey[2] === 'categories' && queryKey[1] !== 'all'))
    });
  }, [feedActive, queryClient]);
  useEffect(() => abortFeedRequests, [abortFeedRequests]);

  return {
    abortFeedRequests,
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy: feedActive && feedEnabled && feedQuery.isPending,
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
