import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import type { Screen } from '@/ui/navigation/types';
import type { ReadGateway } from '@/sources/readGateway';
import {
  defaultFeedFilters,
  shouldAllowFeedRemotePagination,
  shouldLoadCategoriesForSource,
  shouldUseFeedFilter,
  shouldUseReadingFilter
} from '@/domain/forum/feedOptions';
import { applyFeedFilter, mergeCategories, mergeTopics, type ReadingFilter } from '@/domain/forum/feed';
import { categoryKey, topicKey, type ReaderData } from '@/domain/reader/readerData';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason
} from '@/platform/diagnostics/diagnostics';
import { sourceLabel } from '@/domain/forum/presentation';
import { isFeedFilterSource, isSessionSource, sourceValues } from '@/domain/forum/sourceCatalog';
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
import { forumQueryKeys, type ForumIdentityBarrierSource } from '@/platform/query/serverState';
import {
  canRetainTrustedSource,
  changedSessionSources,
  changedSourcesForIdentityTransition,
  identityBarriersOnlyRemoved,
  normalizeIdentityBarriers,
  sameIdentityBarriers,
  sameSessionEpochs,
  visibleIdentityErrors,
  withoutChangedSourceErrors
} from '@/platform/query/identityProjection';
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

function mergeTrustedTopics(
  current: Topic[],
  trusted: Topic[],
  blockedSources: ReadonlySet<ForumIdentityBarrierSource>,
  retainableSources: ReadonlySet<ForumIdentityBarrierSource>
) {
  const visibleTrusted = trusted.filter((topic) =>
    canRetainTrustedSource(topic.source, blockedSources, retainableSources)
  );
  const merged = mergeTopics(current, visibleTrusted);
  const remaining = new Map(merged.map((topic) => [topicKey(topic), topic]));
  const stable = visibleTrusted.flatMap((topic) => {
    const key = topicKey(topic);
    const retained = remaining.get(key);
    if (!retained) {
      return [];
    }
    remaining.delete(key);
    return [retained];
  });
  return [...stable, ...remaining.values()];
}

function mergeTrustedCategories(
  current: Category[],
  trusted: Category[],
  blockedSources: ReadonlySet<ForumIdentityBarrierSource>,
  retainableSources: ReadonlySet<ForumIdentityBarrierSource>
) {
  const visibleTrusted = trusted.filter((category) =>
    canRetainTrustedSource(category.source, blockedSources, retainableSources)
  );
  const merged = mergeCategories(current, visibleTrusted);
  const remaining = new Map(merged.map((category) => [categoryKey(category), category]));
  const stable = visibleTrusted.flatMap((category) => {
    const key = categoryKey(category);
    const retained = remaining.get(key);
    if (!retained) {
      return [];
    }
    remaining.delete(key);
    return [retained];
  });
  return [...stable, ...remaining.values()];
}

function transitionFeedData(
  trustedData: InfiniteData<FeedPage, FeedPageParam> | undefined,
  response: FeedResponse
): InfiniteData<FeedPage, FeedPageParam> {
  if (!trustedData?.pages.length) {
    return {
      pages: [
        {
          ...response,
          hasMore: false,
          nextCursor: null,
          nextPage: null,
          page: 1
        }
      ],
      pageParams: [{ page: 1 }]
    };
  }

  const remaining = new Map(response.items.map((topic) => [topicKey(topic), topic]));
  const pages = trustedData.pages.map((page, index) => ({
    ...page,
    cursor: undefined,
    errors: index === 0 ? response.errors : {},
    hasMore: false,
    items: page.items.flatMap((topic) => {
      const key = topicKey(topic);
      const retained = remaining.get(key);
      if (!retained) {
        return [];
      }
      remaining.delete(key);
      return [retained];
    }),
    nextCursor: null,
    nextPage: null
  }));
  pages[pages.length - 1] = {
    ...pages[pages.length - 1],
    hasMore: false,
    items: [...pages[pages.length - 1].items, ...remaining.values()],
    nextCursor: null,
    nextPage: null
  };
  return {
    pages,
    pageParams: pages.map((page) => ({ page: page.page }))
  };
}

function stabilizeFeedData(
  data: InfiniteData<FeedPage, FeedPageParam>,
  items: Topic[]
): InfiniteData<FeedPage, FeedPageParam> {
  let offset = 0;
  const pages = data.pages.map((page, index) => {
    const end = index === data.pages.length - 1 ? items.length : offset + page.items.length;
    const stablePage = { ...page, items: items.slice(offset, end) };
    offset = end;
    return stablePage;
  });
  return { ...data, pages };
}

function projectSafeFeedPlaceholder(
  previousData: InfiniteData<FeedPage, FeedPageParam> | undefined,
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[]
) {
  const changedSources = changedSourcesForIdentityTransition(previousQueryKey, currentQueryKey, 'feed', [
    'category',
    'feedFilter'
  ]);
  if (!previousData || !changedSources) {
    return undefined;
  }
  if (!changedSources.size) {
    return previousData.pages.some((page) => page.items.length) ? previousData : undefined;
  }

  const pages = previousData.pages.map((page) => ({
    ...page,
    errors: withoutChangedSourceErrors(page.errors, changedSources),
    items: page.items.filter((topic) => !isSessionSource(topic.source) || !changedSources.has(topic.source))
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
  catalogCategories,
  identityBarriers = [],
  identityReconciliationPending = false,
  retainableIdentityBarriers = [],
  sessionEpochs = initialForumSessionEpochs,
  linuxDoVerificationActive,
  notify,
  readerData,
  readerDataLoaded,
  screen,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  readGateway
}: {
  catalogCategories: Category[];
  identityBarriers?: readonly ForumIdentityBarrierSource[];
  identityReconciliationPending?: boolean;
  retainableIdentityBarriers?: readonly ForumIdentityBarrierSource[];
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
  readGateway: ReadGateway;
}) {
  const queryClient = useQueryClient();
  const feedActive = screen === 'feed';
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>(defaultFeedFilters);
  const [feedQueryIdentityBarriers, setFeedQueryIdentityBarriers] = useState(() =>
    normalizeIdentityBarriers(identityBarriers)
  );
  const [feedQueryRetainableIdentityBarriers, setFeedQueryRetainableIdentityBarriers] = useState(() =>
    normalizeIdentityBarriers(retainableIdentityBarriers)
  );
  const [feedQuerySessionEpochs, setFeedQuerySessionEpochs] = useState(sessionEpochs);
  const trustedAggregateFeedRef = useRef<
    | {
        data: InfiniteData<FeedPage, FeedPageParam>;
        queryKey: readonly unknown[];
      }
    | undefined
  >(undefined);
  const handledSourceCategoriesErrorRef = useRef<unknown>(undefined);
  const handledFeedErrorRef = useRef<unknown>(undefined);
  const handledPartialErrorsRef = useRef<unknown>(undefined);
  const blockedIdentitySources = useMemo(() => new Set(identityBarriers), [identityBarriers]);
  const retainableIdentitySources = useMemo(() => new Set(retainableIdentityBarriers), [retainableIdentityBarriers]);
  const feedChangedIdentitySources = useMemo(
    () => changedSessionSources(feedQuerySessionEpochs, sessionEpochs),
    [feedQuerySessionEpochs, sessionEpochs]
  );
  const feedBlockedIdentitySources = useMemo(
    () => new Set([...blockedIdentitySources, ...feedChangedIdentitySources]),
    [blockedIdentitySources, feedChangedIdentitySources]
  );
  const feedRetainableIdentitySources = useMemo(
    () => new Set([...retainableIdentitySources].filter((source) => !feedChangedIdentitySources.has(source))),
    [feedChangedIdentitySources, retainableIdentitySources]
  );
  const feedSourceIdentityPending =
    feedSource !== 'all' && feedSource !== 'v2ex' && identityBarriers.includes(feedSource);
  const feedIdentitySnapshotReady =
    feedSource !== 'all' ||
    (!identityReconciliationPending &&
      sameIdentityBarriers(feedQueryIdentityBarriers, identityBarriers) &&
      sameSessionEpochs(feedQuerySessionEpochs, sessionEpochs));
  const aggregateIdentityTransitionPending = feedSource === 'all' && !feedIdentitySnapshotReady;
  const canShowFeedSourceData =
    !feedSourceIdentityPending || (isSessionSource(feedSource) && retainableIdentityBarriers.includes(feedSource));
  const feedFilter = feedFilterForRequest(feedSource, categoryFilter, feedFilters);
  const feedQueryKey = forumQueryKeys.feed({
    category: categoryFilter || undefined,
    feedFilter,
    identityBarriers: feedQueryIdentityBarriers,
    scope: feedSource === 'all' ? feedQuerySessionEpochs : sessionEpochs,
    source: feedSource
  });
  const feedEnabled =
    !feedSourceIdentityPending &&
    feedIdentitySnapshotReady &&
    (readerDataLoaded || !shouldWaitForReaderDataBeforeFeed(feedSource, readingFilter));

  const needsSourceCategories = feedSource !== 'all' && shouldLoadCategoriesForSource(catalogCategories, feedSource);
  const sourceCategoriesQuery = useQuery({
    queryKey: forumQueryKeys.categories(feedSource === 'all' ? 'v2ex' : feedSource, sessionEpochs),
    enabled: feedActive && !linuxDoVerificationActive && !feedSourceIdentityPending && needsSourceCategories,
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('feed', 'categories', { source: feedSource });
      try {
        const data = await readGateway.getCategories({ source: feedSource, signal }, { trace });
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
    () => mergeCategories(catalogCategories, canShowFeedSourceData ? sourceCategoriesQuery.data?.items || [] : []),
    [canShowFeedSourceData, catalogCategories, sourceCategoriesQuery.data?.items]
  );
  const feedCategories = useMemo(
    () =>
      sourceValues.reduce((current, source) => {
        const cached = queryClient.getQueryData<CategoriesResponse>(forumQueryKeys.categories(source, sessionEpochs));
        return cached?.items.length
          ? mergeTrustedCategories(current, cached.items, feedBlockedIdentitySources, feedRetainableIdentitySources)
          : current;
      }, categories),
    [categories, feedBlockedIdentitySources, feedRetainableIdentitySources, queryClient, sessionEpochs]
  );

  const feedQuery = useInfiniteQuery({
    queryKey: feedQueryKey,
    enabled: feedActive && feedEnabled,
    initialPageParam: { page: 1 } satisfies FeedPageParam,
    placeholderData: (previousData, previousQuery) =>
      projectSafeFeedPlaceholder(previousData, previousQuery?.queryKey, feedQueryKey),
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
            ...(feedSource === 'all' ? { identityBarriers: feedQueryIdentityBarriers } : {}),
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
  const visibleFeedQueryKey =
    feedSource === 'all'
      ? forumQueryKeys.feed({
          category: categoryFilter || undefined,
          feedFilter,
          identityBarriers,
          scope: sessionEpochs,
          source: 'all'
        })
      : feedQueryKey;
  const rawPages = canShowFeedSourceData ? feedQuery.data?.pages || [] : [];
  const pages =
    feedSource === 'all'
      ? rawPages.map((page) => ({
          ...page,
          errors: visibleIdentityErrors(page.errors, feedBlockedIdentitySources, feedRetainableIdentitySources),
          items: page.items.filter((topic) =>
            canRetainTrustedSource(topic.source, feedBlockedIdentitySources, feedRetainableIdentitySources)
          )
        }))
      : rawPages;
  const effectiveFeedRetainableIdentityBarriers = sameIdentityBarriers(feedQueryIdentityBarriers, identityBarriers)
    ? normalizeIdentityBarriers(retainableIdentityBarriers)
    : feedQueryRetainableIdentityBarriers;
  const trustedFeedState = trustedAggregateFeedRef.current;
  const trustedFeedChangedSources =
    feedSource === 'all' && trustedFeedState
      ? changedSourcesForIdentityTransition(trustedFeedState.queryKey, visibleFeedQueryKey, 'feed', [
          'category',
          'feedFilter'
        ])
      : null;
  const trustedFeedData =
    trustedFeedState && (effectiveFeedRetainableIdentityBarriers.length || trustedFeedChangedSources?.size)
      ? projectSafeFeedPlaceholder(trustedFeedState.data, trustedFeedState.queryKey, visibleFeedQueryKey)
      : undefined;
  const refreshFeedScope = JSON.stringify([
    feedActive,
    feedQueryKey,
    feedSourceIdentityPending,
    feedSource === 'all' ? normalizeIdentityBarriers(identityBarriers) : []
  ]);
  const refreshFeedGenerationRef = useRef(0);
  useLayoutEffect(() => {
    refreshFeedGenerationRef.current += 1;
    return () => {
      refreshFeedGenerationRef.current += 1;
    };
  }, [refreshFeedScope]);
  const mergedFeed = useMemo(() => {
    const current = mergeFeedPages(pages);
    if (!trustedFeedData?.pages.length) {
      return current;
    }
    const trustedItems = mergeFeedPages(trustedFeedData.pages).items;
    return {
      ...current,
      items: mergeTrustedTopics(current.items, trustedItems, feedBlockedIdentitySources, feedRetainableIdentitySources)
    };
  }, [feedBlockedIdentitySources, feedRetainableIdentitySources, pages, trustedFeedData?.pages]);
  useEffect(() => {
    if (
      feedSource !== 'all' ||
      feedQueryIdentityBarriers.length ||
      !feedQuery.isSuccess ||
      feedQuery.isFetching ||
      feedQuery.isPlaceholderData ||
      !feedQuery.data
    ) {
      return;
    }
    const data = feedQuery.data as InfiniteData<FeedPage, FeedPageParam>;
    if (trustedFeedChangedSources?.size && trustedFeedData?.pages.length) {
      const trustedPageCount = trustedFeedData.pages.reduce(
        (count, page, index) => (page.items.length ? index + 1 : count),
        0
      );
      const currentLastPage = data.pages.at(-1);
      if (data.pages.length < trustedPageCount && currentLastPage && nextFeedPage(currentLastPage)) {
        return;
      }
      const stableData = stabilizeFeedData(data, mergedFeed.items);
      trustedAggregateFeedRef.current = { data: stableData, queryKey: feedQueryKey };
      queryClient.setQueryData<InfiniteData<FeedPage, FeedPageParam>>(feedQueryKey, stableData);
      return;
    }
    trustedAggregateFeedRef.current = {
      data,
      queryKey: feedQueryKey
    };
  }, [
    feedQuery.data,
    feedQuery.isFetching,
    feedQuery.isPlaceholderData,
    feedQuery.isSuccess,
    feedQueryIdentityBarriers.length,
    feedQueryKey,
    feedSource,
    mergedFeed.items,
    queryClient,
    trustedFeedChangedSources?.size,
    trustedFeedData?.pages.length
  ]);
  useEffect(() => {
    if (identityReconciliationPending) {
      return;
    }
    const nextRetainableIdentityBarriers = normalizeIdentityBarriers(retainableIdentityBarriers);
    if (
      sameIdentityBarriers(feedQueryIdentityBarriers, identityBarriers) &&
      sameSessionEpochs(feedQuerySessionEpochs, sessionEpochs)
    ) {
      if (!sameIdentityBarriers(feedQueryRetainableIdentityBarriers, nextRetainableIdentityBarriers)) {
        setFeedQueryRetainableIdentityBarriers(nextRetainableIdentityBarriers);
      }
      return;
    }
    if (feedSource === 'all' && feedQuery.isFetching) {
      return;
    }
    const nextIdentityBarriers = normalizeIdentityBarriers(identityBarriers);
    if (feedSource === 'all') {
      const targetQueryKey = forumQueryKeys.feed({
        category: categoryFilter || undefined,
        feedFilter,
        identityBarriers: nextIdentityBarriers,
        scope: sessionEpochs,
        source: 'all'
      });
      if (identityBarriersOnlyRemoved(feedQueryIdentityBarriers, nextIdentityBarriers) && mergedFeed.items.length) {
        const trustedTargetData = trustedAggregateFeedRef.current
          ? projectSafeFeedPlaceholder(
              trustedAggregateFeedRef.current.data,
              trustedAggregateFeedRef.current.queryKey,
              targetQueryKey
            )
          : undefined;
        queryClient.setQueryData<InfiniteData<FeedPage, FeedPageParam>>(
          targetQueryKey,
          transitionFeedData(trustedTargetData, mergedFeed)
        );
        void queryClient.invalidateQueries({ queryKey: targetQueryKey, exact: true, refetchType: 'none' });
      } else {
        queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
      }
    }
    setFeedQueryIdentityBarriers(nextIdentityBarriers);
    setFeedQueryRetainableIdentityBarriers(nextRetainableIdentityBarriers);
    setFeedQuerySessionEpochs(sessionEpochs);
  }, [
    categoryFilter,
    feedFilter,
    feedQuery.isFetching,
    feedQueryIdentityBarriers,
    feedQueryRetainableIdentityBarriers,
    feedQuerySessionEpochs,
    feedSource,
    identityBarriers,
    identityReconciliationPending,
    mergedFeed,
    queryClient,
    retainableIdentityBarriers,
    sessionEpochs
  ]);
  const lastPage = pages.at(-1);
  const nextPage =
    !feedQuery.isPlaceholderData && feedIdentitySnapshotReady && lastPage ? nextFeedPage(lastPage) : undefined;
  const loadMoreError = !feedSourceIdentityPending && feedQuery.isFetchNextPageError;
  const activeFeedState = useMemo<FeedSourceState>(
    () => ({
      hasMore: Boolean(nextPage),
      items: mergedFeed.items,
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
      lastPage?.page,
      loadMoreError,
      mergedFeed.items,
      nextPage
    ]
  );
  const feedAllowsRemotePagination = shouldAllowFeedRemotePagination(feedSource, readingFilter);
  const shownFeedItems = useMemo(
    () =>
      applyFeedFilter(activeFeedState.items, readerData, shouldUseReadingFilter(feedSource) ? readingFilter : 'all'),
    [activeFeedState.items, feedSource, readerData.favorites, readerData.history, readingFilter]
  );
  const settledFeedOutcomeKind =
    aggregateIdentityTransitionPending || feedSourceIdentityPending || feedQuery.isPending || feedQuery.isFetching
      ? undefined
      : feedOutcomeKind(
          mergedFeed.items.length,
          feedQuery.isError ? sourceErrorsFromFeedError(feedSource, feedQuery.error) : mergedFeed.errors
        );
  const feedRecoveryQueryIdentity = JSON.stringify(feedQueryKey);
  const feedRecoveryOwnerRef = useCommittedRef({
    active: feedActive,
    identityReady: feedIdentitySnapshotReady,
    queryIdentity: feedRecoveryQueryIdentity,
    sourceIdentityPending: feedSourceIdentityPending
  });

  useEffect(() => {
    if (
      !feedActive ||
      feedSourceIdentityPending ||
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
    feedSourceIdentityPending,
    notify,
    showNodeSeekVerification,
    sourceCategoriesQuery.errorUpdatedAt,
    sourceCategoriesQuery.isError,
    sourceCategoriesQuery.isFetching,
    sourceCategoriesQuery.error
  ]);

  useEffect(() => {
    if (!feedActive || !feedQuery.isError || handledFeedErrorRef.current === feedQuery.error) {
      return;
    }
    handledFeedErrorRef.current = feedQuery.error;
    if (feedSourceIdentityPending || feedQuery.isFetching) {
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
        resume: async () => {
          const owner = feedRecoveryOwnerRef.current;
          if (
            !owner.active ||
            !owner.identityReady ||
            owner.queryIdentity !== feedRecoveryQueryIdentity ||
            owner.sourceIdentityPending
          ) {
            return 'stale';
          }
          const result = loadMoreError
            ? await feedQuery.fetchNextPage({ cancelRefetch: false })
            : await feedQuery.refetch({ cancelRefetch: false });
          handledFeedErrorRef.current = result.error;
          if (!result.isError) return 'completed';
          const error =
            result.error instanceof FeedQueryError ? result.error.sourceErrors.linuxdo || result.error : result.error;
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
    feedQuery.isFetching,
    feedQuery.isError,
    feedQueryKey,
    feedActive,
    feedRecoveryOwnerRef,
    feedRecoveryQueryIdentity,
    feedSource,
    feedSourceIdentityPending,
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
    if (handledPartialErrorsRef.current === errors) {
      return;
    }
    handledPartialErrorsRef.current = errors;
    if (feedSourceIdentityPending) {
      return;
    }
    const nodeSeekMessage = nodeSeekVerificationNavigationMessage(feedSource, errors);
    if (nodeSeekMessage) {
      showNodeSeekVerification(nodeSeekMessage);
    } else {
      notify(formatSourceErrorMessages(errors, sourceLabel));
    }
  }, [
    feedActive,
    feedQuery.dataUpdatedAt,
    feedSource,
    feedSourceIdentityPending,
    lastPage?.errors,
    notify,
    showNodeSeekVerification
  ]);

  const loadFeed = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (
      !feedActive ||
      !feedIdentitySnapshotReady ||
      feedSourceIdentityPending ||
      !nextPage ||
      feedQuery.isFetchingNextPage
    ) {
      return 'stale';
    }
    const result = await feedQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [
    feedActive,
    feedIdentitySnapshotReady,
    feedQuery.fetchNextPage,
    feedQuery.isFetchingNextPage,
    feedSourceIdentityPending,
    nextPage
  ]);

  const refreshFeed = useCallback(async () => {
    if (!feedActive || aggregateIdentityTransitionPending || feedSourceIdentityPending) {
      return;
    }
    if (feedQuery.isFetching) {
      notify('列表正在更新');
      return;
    }
    const refreshGeneration = refreshFeedGenerationRef.current;
    notify('正在更新列表');
    const result = await feedQuery.refetch({ cancelRefetch: false });
    if (refreshFeedGenerationRef.current !== refreshGeneration) {
      return;
    }
    if (!result.isError) {
      if (
        feedSource === 'all' &&
        feedQueryIdentityBarriers.length === 0 &&
        identityBarriers.length === 0 &&
        trustedFeedChangedSources?.size &&
        result.data
      ) {
        trustedAggregateFeedRef.current = {
          data: result.data as InfiniteData<FeedPage, FeedPageParam>,
          queryKey: feedQueryKey
        };
      }
      notify('列表已更新');
    }
  }, [
    aggregateIdentityTransitionPending,
    feedActive,
    feedQuery.isFetching,
    feedQuery.refetch,
    feedQueryIdentityBarriers.length,
    feedQueryKey,
    feedSource,
    feedSourceIdentityPending,
    identityBarriers.length,
    notify,
    trustedFeedChangedSources?.size
  ]);

  const changeFeedSource = useCallback(
    (source: FeedSource) => {
      if (source === feedSource) {
        return;
      }
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === source && queryKey[2] === 'feed'
      });
      setFeedSource(source);
      setCategoryFilter('');
    },
    [feedSource, queryClient]
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
    feedBusy:
      feedActive &&
      ((aggregateIdentityTransitionPending && mergedFeed.items.length === 0) ||
        (feedSourceIdentityPending && mergedFeed.items.length === 0) ||
        (feedEnabled && feedQuery.isPending)),
    feedCategories,
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
