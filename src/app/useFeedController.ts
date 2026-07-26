import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
import type { Screen } from '../appTypes';
import type { SourceGateway } from '../sources/sourceGateway';
import {
  defaultFeedFilters,
  shouldAllowFeedRemotePagination,
  shouldLoadCategoriesForSource,
  shouldUseFeedFilter,
  shouldUseReadingFilter
} from '../feedCategoryRail';
import { applyFeedFilter, mergeCategories, mergeFeedResponses, type ReadingFilter } from '../feedLogic';
import type { ReaderData } from '../readerData';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage, normalizeDiagnosticReason } from '../diagnostics';
import { sourceLabel } from '../appUtils';
import { isFeedFilterSource } from '../sourceCatalog';
import { sourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import {
  formatSourceErrorMessages,
  linuxDoVerificationNavigationMessage,
  nodeSeekVerificationNavigationMessage,
  sourceErrorFromUnknown,
  sourceReadRecoveryOutcome,
  yaohuoErrorRequiresLoginPanel
} from '../sourceErrors';
import type {
  FeedFilterState,
  FeedResponse,
  FeedSource,
  SourceErrorInfo,
  SourceFeedFilter,
  SourceErrors,
  SourceLoadOutcomeKind,
  Topic
} from '../types';
import {
  initialForumSessionEpochs,
  forumQueryKeys,
  type ForumIdentityBarrierSource,
  type ForumSessionEpochs
} from './serverState';

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

function feedFilterForRequest(source: FeedSource, category: string, filters: FeedFilterState): SourceFeedFilter | undefined {
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
  if (
    lastPage.nextPage === lastPage.page
    && (lastPage.nextCursor || '') === (lastPage.cursor || '')
  ) {
    return undefined;
  }
  return { page: lastPage.nextPage, ...(lastPage.nextCursor ? { cursor: lastPage.nextCursor } : {}) };
}

function validateFeedPage(source: FeedSource, pageParam: FeedPageParam, response: FeedResponse): FeedPage {
  const errors = response.errors || {};
  const diagnostic = sourceDiagnosticSummary(response);
  const loadMore = pageParam.page > 1;
  const parseEmpty = diagnostic?.isParseEmpty === true
    && (loadMore || Number(diagnostic.validCount || 0) === 0);
  const rejectsPartial = Object.keys(errors).length > 0
    && (source !== 'all' || loadMore || response.items.length === 0);
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
  return pages.reduce<FeedResponse>((current, page) => mergeFeedResponses(current, page), {
    errors: {},
    hasMore: false,
    items: [],
    nextPage: null
  });
}

type FeedQueryKeyState = {
  category?: unknown;
  feedFilter?: unknown;
  identityBarriers?: unknown;
  sessionEpoch?: unknown;
};

function feedQueryKeyState(queryKey: readonly unknown[]): FeedQueryKeyState | null {
  if (
    queryKey[0] !== 'forum'
    || queryKey[1] !== 'all'
    || queryKey[2] !== 'feed'
    || !queryKey[3]
    || typeof queryKey[3] !== 'object'
  ) {
    return null;
  }
  return queryKey[3] as FeedQueryKeyState;
}

export function canUseTrustedFeedAsIdentityBarrierPlaceholder(
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[]
) {
  const previous = previousQueryKey ? feedQueryKeyState(previousQueryKey) : null;
  const current = feedQueryKeyState(currentQueryKey);
  if (!previous || !current || !Array.isArray(current.identityBarriers) || !current.identityBarriers.length) {
    return false;
  }
  return Object.is(previous.category, current.category)
    && Object.is(previous.feedFilter, current.feedFilter)
    && JSON.stringify(previous.sessionEpoch) === JSON.stringify(current.sessionEpoch);
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
  if (sourceErrors.some((error) => (
    error.kind === 'login-required'
    || error.kind === 'login-expired'
    || error.kind === 'verification-required'
  ))) {
    return 'auth';
  }
  if (sourceErrors.length) {
    return itemCount ? 'partial' : 'error';
  }
  return itemCount ? 'data' : 'empty';
}

export function useFeedController({
  identityBarriers = [],
  sessionEpochs = initialForumSessionEpochs,
  linuxDoVerificationActive,
  notify,
  readerData,
  readerDataLoaded,
  screen,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  identityBarriers?: readonly ForumIdentityBarrierSource[];
  sessionEpochs?: ForumSessionEpochs;
  linuxDoVerificationActive: boolean;
  notify: (message: string) => void;
  readerData: ReaderData;
  readerDataLoaded: boolean;
  screen: Screen;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
}) {
  const queryClient = useQueryClient();
  const feedActive = screen === 'feed';
  const categoriesActive = (screen === 'feed' || screen === 'search') && !linuxDoVerificationActive;
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>(defaultFeedFilters);
  const handledFeedErrorRef = useRef<unknown>(undefined);
  const feedSourceIdentityPending = feedSource !== 'all'
    && feedSource !== 'v2ex'
    && identityBarriers.includes(feedSource);
  const feedFilter = feedFilterForRequest(feedSource, categoryFilter, feedFilters);
  const feedQueryKey = forumQueryKeys.feed({
    category: categoryFilter || undefined,
    feedFilter,
    identityBarriers,
    scope: sessionEpochs,
    source: feedSource
  });
  const feedEnabled = !feedSourceIdentityPending
    && (readerDataLoaded || !shouldWaitForReaderDataBeforeFeed(feedSource, readingFilter));

  const allCategoriesQuery = useQuery({
    queryKey: forumQueryKeys.categories('all', sessionEpochs, identityBarriers),
    enabled: categoriesActive,
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('feed', 'categories', { source: 'all' });
      try {
        const data = await sourceGateway.getCategories({ source: 'all', signal }, { trace });
        finishDiagnosticTrace(trace, Object.keys(data.errors || {}).length ? 'partial' : 'success', {
          source: 'all',
          itemCount: data.items.length,
          partialErrorCount: Object.keys(data.errors || {}).length
        });
        return data;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: 'all',
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  });
  const allCategories = allCategoriesQuery.data?.items || [];
  const needsSourceCategories = feedSource !== 'all' && shouldLoadCategoriesForSource(allCategories, feedSource);
  const sourceCategoriesQuery = useQuery({
    queryKey: forumQueryKeys.categories(feedSource === 'all' ? 'v2ex' : feedSource, sessionEpochs),
    enabled: feedActive
      && !linuxDoVerificationActive
      && !feedSourceIdentityPending
      && needsSourceCategories,
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('feed', 'categories', { source: feedSource });
      try {
        const data = await sourceGateway.getCategories({ source: feedSource, signal }, { trace });
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
    () => mergeCategories(allCategories, sourceCategoriesQuery.data?.items || []),
    [allCategories, sourceCategoriesQuery.data?.items]
  );

  const feedQuery = useInfiniteQuery({
    queryKey: feedQueryKey,
    enabled: feedActive && feedEnabled,
    initialPageParam: { page: 1 } satisfies FeedPageParam,
    placeholderData: (previousData, previousQuery) => (
      canUseTrustedFeedAsIdentityBarrierPlaceholder(previousQuery?.queryKey, feedQueryKey)
        ? previousData
        : undefined
    ),
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
        const response = await sourceGateway.getFeed({
          source: feedSource,
          page: pageParam.page,
          cursor: pageParam.cursor,
          limit: 30,
          category: categoryFilter || undefined,
          feedFilter,
          signal
        }, { trace });
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
        finishDiagnosticTrace(trace,
          signal.aborted
            ? 'canceled'
            : sourceError.kind === 'verification-required' || sourceError.kind === 'login-required' || sourceError.kind === 'permission-denied'
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
  const trustedAggregatePages = feedSource === 'all' && identityBarriers.length
    ? queryClient.getQueryData<InfiniteData<FeedPage, FeedPageParam>>(forumQueryKeys.feed({
        category: categoryFilter || undefined,
        feedFilter,
        identityBarriers: [],
        scope: sessionEpochs,
        source: 'all'
      }))?.pages
    : undefined;
  const mergedFeed = useMemo(() => {
    const current = mergeFeedPages(pages);
    if (!trustedAggregatePages?.length || !identityBarriers.length) {
      return current;
    }
    const pendingSources = new Set<ForumIdentityBarrierSource>(identityBarriers);
    const trustedPendingItems = mergeFeedPages(trustedAggregatePages).items.filter(
      (topic) => topic.source !== 'v2ex' && pendingSources.has(topic.source)
    );
    return trustedPendingItems.length
      ? mergeFeedResponses(current, {
          errors: {},
          hasMore: false,
          items: trustedPendingItems,
          nextPage: null
        })
      : current;
  }, [identityBarriers, pages, trustedAggregatePages]);
  const lastPage = pages.at(-1);
  const nextPage = lastPage ? nextFeedPage(lastPage) : undefined;
  const loadMoreError = feedQuery.isFetchNextPageError;
  const activeFeedState = useMemo<FeedSourceState>(() => ({
    hasMore: Boolean(nextPage),
    items: mergedFeed.items,
    loadMoreFailureSignal: loadMoreError ? feedQuery.errorUpdatedAt : 0,
    loadingMore: feedQuery.isFetchingNextPage,
    nextCursor: nextPage?.cursor,
    page: lastPage?.page || 1,
    refreshing: feedQuery.isRefetching && !feedQuery.isFetchingNextPage
  }), [
    feedQuery.errorUpdatedAt,
    feedQuery.isFetchingNextPage,
    feedQuery.isRefetching,
    lastPage?.page,
    loadMoreError,
    mergedFeed.items,
    nextPage
  ]);
  const feedAllowsRemotePagination = shouldAllowFeedRemotePagination(feedSource, readingFilter);
  const shownFeedItems = useMemo(
    () => applyFeedFilter(activeFeedState.items, readerData, shouldUseReadingFilter(feedSource) ? readingFilter : 'all'),
    [activeFeedState.items, feedSource, readerData.favorites, readerData.history, readingFilter]
  );
  const settledFeedOutcomeKind = feedQuery.isPending || feedQuery.isFetching
    ? undefined
    : feedOutcomeKind(
        mergedFeed.items.length,
        feedQuery.isError ? sourceErrorsFromFeedError(feedSource, feedQuery.error) : mergedFeed.errors
      );

  useEffect(() => {
    if (!categoriesActive) {
      return;
    }
    const query = feedActive && sourceCategoriesQuery.isError
      ? sourceCategoriesQuery
      : allCategoriesQuery;
    if (!query.isError) {
      return;
    }
    const error = sourceErrorFromUnknown(feedSource, query.error);
    if (feedSource === 'nodeseek' && error.kind === 'verification-required') {
      showNodeSeekVerification(error.message);
    } else {
      notify(error.message);
    }
  }, [
    allCategoriesQuery.errorUpdatedAt,
    allCategoriesQuery.isError,
    categoriesActive,
    feedActive,
    feedSource,
    notify,
    showNodeSeekVerification,
    sourceCategoriesQuery.errorUpdatedAt,
    sourceCategoriesQuery.isError
  ]);

  useEffect(() => {
    if (!feedActive || !feedQuery.isError || handledFeedErrorRef.current === feedQuery.error) {
      return;
    }
    handledFeedErrorRef.current = feedQuery.error;
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
        resume: async () => {
          const result = loadMoreError
            ? await feedQuery.fetchNextPage({ cancelRefetch: false })
            : await feedQuery.refetch({ cancelRefetch: false });
          handledFeedErrorRef.current = result.error;
          if (!result.isError) return 'completed';
          const error = result.error instanceof FeedQueryError
            ? result.error.sourceErrors.linuxdo || result.error
            : result.error;
          return sourceReadRecoveryOutcome('linuxdo', error);
        }
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
    feedQuery.isError,
    feedQueryKey,
    feedActive,
    feedSource,
    loadMoreError,
    notify,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
  ]);

  useEffect(() => {
    if (!feedActive) {
      return;
    }
    const errors = lastPage?.errors || {};
    if (!Object.keys(errors).length) {
      return;
    }
    const nodeSeekMessage = nodeSeekVerificationNavigationMessage(feedSource, errors);
    if (nodeSeekMessage) {
      showNodeSeekVerification(nodeSeekMessage);
    } else {
      notify(formatSourceErrorMessages(errors, sourceLabel));
    }
  }, [feedActive, feedQuery.dataUpdatedAt, feedSource, lastPage?.errors, notify, showNodeSeekVerification]);

  const loadFeed = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!feedActive || feedSourceIdentityPending || !nextPage || feedQuery.isFetchingNextPage) {
      return 'stale';
    }
    const result = await feedQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [feedActive, feedQuery.fetchNextPage, feedQuery.isFetchingNextPage, feedSourceIdentityPending, nextPage]);

  const refreshFeed = useCallback(async () => {
    if (!feedActive || feedSourceIdentityPending) {
      return;
    }
    if (feedQuery.isFetching) {
      notify('列表正在更新');
      return;
    }
    notify('正在更新列表');
    const result = await feedQuery.refetch({ cancelRefetch: false });
    if (!result.isError) {
      notify('列表已更新');
    }
  }, [feedActive, feedQuery.isFetching, feedQuery.refetch, feedSourceIdentityPending, notify]);

  const changeFeedSource = useCallback((source: FeedSource) => {
    setFeedSource(source);
    setCategoryFilter('');
  }, []);

  const setFeedFilter = useCallback((filter: SourceFeedFilter) => {
    setFeedFilters((current) => feedSource !== 'all' && isFeedFilterSource(feedSource)
      ? { ...current, [feedSource]: filter } as FeedFilterState
      : current
    );
  }, [feedSource]);

  const abortFeedRequests = useCallback(() => {
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum'
        && (queryKey[2] === 'feed' || queryKey[2] === 'categories')
    });
  }, [queryClient]);

  useEffect(() => {
    if (feedActive) return;
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum'
        && (queryKey[2] === 'feed' || (queryKey[2] === 'categories' && queryKey[1] !== 'all'))
    });
  }, [feedActive, queryClient]);
  useEffect(() => {
    if (categoriesActive) return;
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[2] === 'categories'
    });
  }, [categoriesActive, queryClient]);
  useEffect(() => abortFeedRequests, [abortFeedRequests]);

  return {
    abortFeedRequests,
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy: feedActive && feedEnabled && feedQuery.isPending,
    feedFilter,
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
