import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
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
  Topic
} from '../types';
import {
  emptyForumCredentialScope,
  forumQueryKeys,
  type ForumCredentialScope
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

export function useFeedController({
  credentialScope = emptyForumCredentialScope,
  notify,
  readerData,
  readerDataLoaded,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  credentialScope?: ForumCredentialScope;
  notify: (message: string) => void;
  readerData: ReaderData;
  readerDataLoaded: boolean;
  showLinuxDoVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void | Promise<void>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
}) {
  const queryClient = useQueryClient();
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>(defaultFeedFilters);
  const handledFeedErrorRef = useRef<unknown>(undefined);
  const feedFilter = feedFilterForRequest(feedSource, categoryFilter, feedFilters);
  const feedQueryKey = forumQueryKeys.feed({
    category: categoryFilter || undefined,
    feedFilter,
    scope: credentialScope,
    source: feedSource
  });
  const feedEnabled = readerDataLoaded || !shouldWaitForReaderDataBeforeFeed(feedSource, readingFilter);

  const allCategoriesQuery = useQuery({
    queryKey: forumQueryKeys.categories('all', credentialScope),
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
    queryKey: forumQueryKeys.categories(feedSource === 'all' ? 'v2ex' : feedSource, credentialScope),
    enabled: needsSourceCategories,
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
    enabled: feedEnabled,
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
  const mergedFeed = useMemo(() => mergeFeedPages(pages), [pages]);
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

  useEffect(() => {
    const query = sourceCategoriesQuery.isError ? sourceCategoriesQuery : allCategoriesQuery;
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
    feedSource,
    notify,
    showNodeSeekVerification,
    sourceCategoriesQuery.errorUpdatedAt,
    sourceCategoriesQuery.isError
  ]);

  useEffect(() => {
    if (!feedQuery.isError || handledFeedErrorRef.current === feedQuery.error) {
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
    feedSource,
    loadMoreError,
    notify,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
  ]);

  useEffect(() => {
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
  }, [feedQuery.dataUpdatedAt, feedSource, lastPage?.errors, notify, showNodeSeekVerification]);

  const loadFeed = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!nextPage || feedQuery.isFetchingNextPage) {
      return 'stale';
    }
    const result = await feedQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [feedQuery.fetchNextPage, feedQuery.isFetchingNextPage, nextPage]);

  const refreshFeed = useCallback(async () => {
    if (feedQuery.isFetching) {
      notify('列表正在更新');
      return;
    }
    notify('正在更新列表');
    const result = await feedQuery.refetch({ cancelRefetch: false });
    if (!result.isError) {
      notify('列表已更新');
    }
  }, [feedQuery.isFetching, feedQuery.refetch, notify]);

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

  useEffect(() => abortFeedRequests, [abortFeedRequests]);

  return {
    abortFeedRequests,
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy: feedQuery.isPending,
    feedFilter,
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
