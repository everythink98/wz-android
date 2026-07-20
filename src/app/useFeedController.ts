import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isCancelledError } from '@tanstack/react-query';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
import type { SourceGateway } from '../sources/sourceGateway';
import { defaultFeedFilters, shouldLoadCategoriesForSource, shouldAllowFeedRemotePagination, shouldUseFeedFilter, shouldUseReadingFilter } from '../feedCategoryRail';
import {
  applyFeedFilter,
  feedRequestKey,
  mergeCategories,
  mergeFeedResponses,
  nextFeedPageState,
  shouldReuseFeedStateForRequest,
  type ReadingFilter
} from '../feedLogic';
import type { ReaderData } from '../readerData';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticReason
} from '../diagnostics';
import { errorMessage, isCanceledRequest, sourceLabel } from '../appUtils';
import { isFeedFilterSource, sourceValues } from '../sourceCatalog';
import { sourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { formatSourceErrorMessages, linuxDoVerificationNavigationMessage, nodeSeekVerificationNavigationMessage, sourceErrorFromUnknown, yaohuoErrorRequiresLoginPanel } from '../sourceErrors';
import type { Category, FeedFilterState, FeedSource, FeedResponse, SourceErrorInfo, SourceFeedFilter, SourceErrors, Topic } from '../types';
import { useCommitRefValue, useCommittedRef } from './useCommittedRef';
import {
  appQueryClient,
  forumQueryKeys,
  subscribeForumSourceResets
} from './serverState';

type FeedSourceState = {
  hasMore: boolean;
  items: Topic[];
  loadMoreFailureSignal: number;
  loadingMore: boolean;
  nextCursor?: string;
  page: number;
  refreshing: boolean;
  requestKey?: string;
};

type FeedRecoveryLane = {
  key: string;
  lane: 'root' | 'more';
  source: FeedSource;
};

function createFeedSourceState(): FeedSourceState {
  return {
    hasMore: false,
    items: [],
    loadMoreFailureSignal: 0,
    page: 1,
    refreshing: false,
    loadingMore: false
  };
}

function createFeedStates(): Record<FeedSource, FeedSourceState> {
  return Object.fromEntries(['all', ...sourceValues].map((source) => [
    source,
    createFeedSourceState()
  ])) as Record<FeedSource, FeedSourceState>;
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

function diagnosticReasonForSourceError(error?: SourceErrorInfo): DiagnosticReason {
  if (error?.kind === 'login-required' || error?.kind === 'login-expired') return 'login_required';
  if (error?.kind === 'verification-required') return 'verification_required';
  if (error?.kind === 'permission-denied') return 'permission_denied';
  return error ? normalizeDiagnosticReason(error.message) : 'unknown';
}

function isCanceledFeedQuery(error: unknown) {
  return isCancelledError(error) || isCanceledRequest(error);
}

export function useFeedController({
  notify,
  readerData,
  readerDataLoaded,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  notify: (message: string) => void;
  readerData: ReaderData;
  readerDataLoaded: boolean;
  showLinuxDoVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void | Promise<void>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
}) {
  const feedRecoveryGenerationRef = useRef(0);
  const activeFeedRecoveryRef = useRef<FeedRecoveryLane | null>(null);
  const feedLoadingRef = useRef(false);
  const categoriesGenerationRef = useRef(0);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [feedStates, setFeedStates] = useState<Record<FeedSource, FeedSourceState>>(() => createFeedStates());
  const feedStatesRef = useCommittedRef(feedStates);
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>(defaultFeedFilters);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sourceResetVersion, setSourceResetVersion] = useState(0);
  const categoriesRef = useCommittedRef(categories);

  useEffect(() => subscribeForumSourceResets(({ source, preserveRecoveryKey }) => {
    const activeSourceAffected = feedSource === 'all' || feedSource === source;
    const activeRecovery = activeFeedRecoveryRef.current;
    const preservedRecovery = activeRecovery
      && activeRecovery.key === preserveRecoveryKey
      && (activeRecovery.source === source || activeRecovery.source === 'all')
      ? activeRecovery
      : null;
    if (activeSourceAffected) {
      if (!preservedRecovery) {
        feedRecoveryGenerationRef.current += 1;
        setSourceResetVersion((current) => current + 1);
      }
      categoriesGenerationRef.current += 1;
      feedLoadingRef.current = false;
      setFeedBusy(false);
    }
    if (!preservedRecovery) {
      activeFeedRecoveryRef.current = null;
    }
    setFeedStates((current) => {
      const next = {
        ...current,
        all: createFeedSourceState(),
        [source]: createFeedSourceState()
      };
      if (preservedRecovery?.lane === 'more') {
        next[preservedRecovery.source] = {
          ...current[preservedRecovery.source],
          refreshing: false,
          loadingMore: false
        };
      }
      return next;
    });
    setCategories((current) => current.filter((category) => category.source !== source));
  }), [feedSource]);

  const activeFeedState = feedStates[feedSource];
  const feedAllowsRemotePagination = shouldAllowFeedRemotePagination(feedSource, readingFilter);
  const shownFeedItems = useMemo(
    () => applyFeedFilter(activeFeedState.items, readerData, shouldUseReadingFilter(feedSource) ? readingFilter : 'all'),
    [activeFeedState.items, feedSource, readerData.favorites, readerData.history, readingFilter]
  );

  const loadCategories = useCallback(async (source: FeedSource = 'all') => {
    const trace = beginDiagnosticTrace('feed', 'categories', { source });
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
    const requestGeneration = ++categoriesGenerationRef.current;
    let querySignal: AbortSignal | undefined;
    const isLatestCategoriesRequest = () => requestGeneration === categoriesGenerationRef.current;
    const isCurrentCategoriesRequest = () => isLatestCategoriesRequest() && !querySignal?.aborted;
    const queryKey = forumQueryKeys.categories(source);
    markDiagnosticStage(trace, 'guard', { source, state: 'started' });
    try {
      const data = await appQueryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => {
          querySignal = signal;
          return sourceGateway.getCategories({
            source,
            nocache: true,
            signal
          }, { isCurrent: () => !signal.aborted, trace });
        }
      });
      if (!isCurrentCategoriesRequest()) {
        finishTrace(querySignal?.aborted ? 'canceled' : 'stale', {
          source,
          reason: querySignal?.aborted ? 'canceled' : 'superseded'
        });
        return;
      }
      const errors = Object.entries(data.errors || {});
      if (source !== 'all' && !data.items.length && !errors.length) {
        appQueryClient.removeQueries({ queryKey, exact: true });
        finishTrace('noop', { source, reason: 'parse_empty' });
        return;
      }
      if (data.items.length || source === 'all') {
        const currentCategories = categoriesRef.current;
        const nextCategories = source === 'all' ? mergeCategories(data.items, []) : mergeCategories(currentCategories, data.items);
        markDiagnosticStage(trace, 'apply', {
          source,
          beforeCount: currentCategories.length,
          afterCount: nextCategories.length,
          itemCount: data.items.length
        });
        setCategories((current) => source === 'all' ? mergeCategories(data.items, []) : mergeCategories(current, data.items));
      }
      if (errors.length) {
        appQueryClient.removeQueries({ queryKey, exact: true });
        const reason = diagnosticReasonForSourceError(errors[0]?.[1]);
        const outcome = data.items.length ? 'partial' : reason === 'verification_required' || reason === 'login_required' || reason === 'permission_denied' ? 'blocked' : 'failure';
        const verificationMessage = nodeSeekVerificationNavigationMessage(source, data.errors);
        if (verificationMessage) {
          showNodeSeekVerification(verificationMessage);
          finishTrace(outcome, { source, reason, partialErrorCount: errors.length });
          return;
        }
        notify(formatSourceErrorMessages(data.errors, sourceLabel));
        finishTrace(outcome, { source, reason, partialErrorCount: errors.length });
        return;
      }
      finishTrace('success', { source, itemCount: data.items.length });
    } catch (error) {
      if (isCanceledFeedQuery(error)) {
        finishTrace(isLatestCategoriesRequest() ? 'canceled' : 'stale', {
          source,
          reason: isLatestCategoriesRequest() ? 'canceled' : 'superseded'
        });
      } else if (!isCurrentCategoriesRequest()) {
        finishTrace('stale', { source, reason: 'superseded' });
      } else {
        notify(errorMessage(error));
        finishTrace('failure', { source, reason: normalizeDiagnosticReason(error) });
      }
    } finally {
      if (!traceFinished) {
        finishTrace(isCurrentCategoriesRequest() ? 'failure' : 'stale', {
          source,
          reason: isCurrentCategoriesRequest() ? 'unknown' : 'superseded'
        });
      }
    }
  }, [notify, showNodeSeekVerification, sourceGateway]);

  const markFeedLoadMoreFailed = useCallback((source: FeedSource) => {
    setFeedStates((current) => ({
      ...current,
      [source]: {
        ...current[source],
        loadMoreFailureSignal: current[source].loadMoreFailureSignal + 1
      }
    }));
  }, []);

  const loadFeedRef = useRef<((options?: {
    page?: number;
    cursor?: string;
    reset?: boolean;
    source?: FeedSource;
    category?: string;
    feedFilter?: SourceFeedFilter;
    nocache?: boolean;
    clearItems?: boolean;
    successMessage?: string;
    suppressLinuxDoVerification?: boolean;
  }) => Promise<LinuxDoReadResumeOutcome>) | null>(null);

  const loadFeed = useCallback(async ({
    page = 1,
    cursor,
    reset = false,
    source = feedSource,
    category = categoryFilter,
    feedFilter,
    nocache = false,
    clearItems = reset && !nocache,
    successMessage,
    suppressLinuxDoVerification = false
  }: {
    page?: number;
    cursor?: string;
    reset?: boolean;
    source?: FeedSource;
    category?: string;
    feedFilter?: SourceFeedFilter;
    nocache?: boolean;
    clearItems?: boolean;
    successMessage?: string;
    suppressLinuxDoVerification?: boolean;
  } = {}): Promise<LinuxDoReadResumeOutcome> => {
    const requestSource = source;
    const isLoadMore = !reset && page > 1;
    const trace = beginDiagnosticTrace('feed', 'load', {
      source: requestSource,
      page,
      isLoadMore,
      hasCursor: Boolean(cursor)
    });
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
    if (feedLoadingRef.current && !reset) {
      markDiagnosticStage(trace, 'guard', { source: requestSource, state: 'busy', isLoadMore });
      finishTrace('blocked', { source: requestSource, reason: 'busy' });
      return 'stale';
    }
    const requestBaseState = feedStatesRef.current[requestSource];
    const requestFeedFilter = feedFilter ?? feedFilterForRequest(requestSource, category, feedFilters);
    const requestKey = feedRequestKey(requestSource, category, requestFeedFilter);
    feedLoadingRef.current = true;
    const requestGeneration = ++feedRecoveryGenerationRef.current;
    activeFeedRecoveryRef.current = null;
    let recoveryGeneration = requestGeneration;
    let querySignal: AbortSignal | undefined;
    const isLatestFeedRequest = () => feedRecoveryGenerationRef.current === requestGeneration;
    const isCurrentFeedRequest = () => isLatestFeedRequest() && !querySignal?.aborted;
    const isCurrentFeedRecovery = () => (
      feedRecoveryGenerationRef.current === recoveryGeneration
    );
    const linuxDoRecovery = (): LinuxDoReadRecovery => ({
      key: `feed:${requestKey}:${page}:${cursor || ''}`,
      isCurrent: isCurrentFeedRecovery,
      resume: async () => {
        if (!isCurrentFeedRecovery()) {
          return 'stale';
        }
        const resumedRequest = loadFeedRef.current?.({
          page,
          cursor,
          reset,
          source: requestSource,
          category,
          feedFilter: requestFeedFilter,
          nocache: true,
          clearItems: false,
          successMessage,
          suppressLinuxDoVerification: true
        });
        if (!resumedRequest) {
          return 'stale';
        }
        const outcome = await resumedRequest;
        recoveryGeneration = feedRecoveryGenerationRef.current;
        return outcome;
      }
    });
    const queryKey = forumQueryKeys.feedPage(requestSource, requestKey, page, cursor);
    if (nocache) {
      void appQueryClient.cancelQueries({ queryKey, exact: true });
      appQueryClient.removeQueries({ queryKey, exact: true });
    }
    markDiagnosticStage(trace, 'guard', {
      source: requestSource,
      state: isLoadMore ? 'load-more' : reset ? 'reset' : 'initial',
      isLoadMore
    });
    if (!isLoadMore && reset && clearItems) {
      setFeedStates((current) => ({
        ...current,
        [requestSource]: {
          ...current[requestSource],
          items: [],
          page: 1,
          nextCursor: undefined,
          hasMore: false
        }
      }));
    }
    if (isLoadMore) {
      setFeedStates((current) => ({
        ...current,
        [requestSource]: {
          ...current[requestSource],
          loadingMore: true
        }
      }));
    } else if (nocache) {
      setFeedStates((current) => ({
        ...current,
        [requestSource]: {
          ...current[requestSource],
          refreshing: true
        }
      }));
    }
    setFeedBusy(true);
    try {
      let appliedFeedResponse: FeedResponse | null = null;
      const applyFeedResponse = (data: FeedResponse) => {
        if (!isCurrentFeedRequest()) {
          return;
        }
        appliedFeedResponse = appliedFeedResponse ? mergeFeedResponses(appliedFeedResponse, data) : data;
        const nextPageState = nextFeedPageState(requestBaseState, appliedFeedResponse, {
          requestedPage: page,
          reset
        });
        markDiagnosticStage(trace, 'apply', {
          source: requestSource,
          beforeCount: requestBaseState.items.length,
          afterCount: nextPageState.items.length,
          itemCount: data.items.length,
          hasMore: nextPageState.hasMore
        });
        setFeedStates((current) => {
          const previous = current[requestSource];
          return {
            ...current,
            [requestSource]: {
              ...previous,
              ...nextPageState,
              requestKey
            }
          };
        });
      };
      const data = await appQueryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => {
          querySignal = signal;
          return sourceGateway.getFeed({
            source,
            page,
            cursor,
            limit: 30,
            category: category || undefined,
            feedFilter: requestFeedFilter,
            nocache: true,
            signal
          }, { isCurrent: () => !signal.aborted, trace });
        }
      });
      if (!isCurrentFeedRequest()) {
        finishTrace(querySignal?.aborted ? 'canceled' : 'stale', {
          source: requestSource,
          reason: querySignal?.aborted ? 'canceled' : 'superseded'
        });
        return 'stale';
      }
      const finalErrors: SourceErrors = data.errors || {};
      const errors = Object.entries(finalErrors);
      const diagnosticSummary = sourceDiagnosticSummary(data);
      const parseEmpty = diagnosticSummary?.isParseEmpty === true;
      const parseEmptyFailure = parseEmpty && (
        isLoadMore || Number(diagnosticSummary.validCount || 0) === 0
      );
      const canApplyPartialAggregate = requestSource === 'all' && !isLoadMore && data.items.length > 0;
      if ((!errors.length || canApplyPartialAggregate) && !parseEmptyFailure) {
        applyFeedResponse(data);
      }
      if (!isCurrentFeedRequest()) {
        finishTrace(querySignal?.aborted ? 'canceled' : 'stale', {
          source: requestSource,
          reason: querySignal?.aborted ? 'canceled' : 'superseded'
        });
        return 'stale';
      }
      if (parseEmptyFailure && !errors.length) {
        appQueryClient.removeQueries({ queryKey, exact: true });
        if (isLoadMore) {
          markFeedLoadMoreFailed(requestSource);
        }
        notify(isLoadMore
          ? `加载下一页失败：${requestSource === 'all' ? '部分来源' : sourceLabel(requestSource)}返回内容无法解析，请重试。`
          : `${sourceLabel(requestSource)} 返回内容无法解析，请重试。`);
        finishTrace('failure', { source: requestSource, reason: 'parse_empty' });
        return 'failed';
      } else if (errors.length) {
        if (!canApplyPartialAggregate) {
          appQueryClient.removeQueries({ queryKey, exact: true });
        }
        const reason = diagnosticReasonForSourceError(errors[0]?.[1]);
        const outcome = appliedFeedResponse
          ? 'partial'
          : reason === 'verification_required' || reason === 'login_required' || reason === 'permission_denied'
            ? 'blocked'
            : 'failure';
        const verificationMessage = nodeSeekVerificationNavigationMessage(requestSource, finalErrors);
        if (verificationMessage) {
          if (isLoadMore) {
            markFeedLoadMoreFailed(requestSource);
          }
          showNodeSeekVerification(isLoadMore ? `加载下一页失败：${verificationMessage}` : verificationMessage);
          finishTrace(outcome, { source: requestSource, reason, partialErrorCount: errors.length });
          return 'completed';
        }
        const linuxDoVerificationMessage = linuxDoVerificationNavigationMessage(requestSource, finalErrors);
        if (linuxDoVerificationMessage) {
          if (isLoadMore) {
            markFeedLoadMoreFailed(requestSource);
          }
          if (!suppressLinuxDoVerification) {
            const recovery = linuxDoRecovery();
            activeFeedRecoveryRef.current = {
              key: recovery.key,
              lane: isLoadMore ? 'more' : 'root',
              source: requestSource
            };
            await showLinuxDoVerification(
              isLoadMore ? `加载下一页失败：${linuxDoVerificationMessage}` : linuxDoVerificationMessage,
              recovery
            );
          }
          finishTrace(outcome, { source: requestSource, reason, partialErrorCount: errors.length });
          return 'verification-required';
        }
        const message = formatSourceErrorMessages(finalErrors, sourceLabel);
        if (isLoadMore) {
          markFeedLoadMoreFailed(requestSource);
          notify(`加载下一页失败：${message}`);
        } else {
          notify(message);
        }
        finishTrace(outcome, { source: requestSource, reason, partialErrorCount: errors.length });
        return requestSource === 'all' && appliedFeedResponse ? 'completed' : 'failed';
      } else if (successMessage) {
        notify(successMessage);
      }
      if (!errors.length) {
        const appliedSummary = appliedFeedResponse as FeedResponse | null;
        finishTrace('success', {
          source: requestSource,
          itemCount: appliedSummary?.items.length || 0,
          hasMore: Boolean(appliedSummary?.hasMore)
        });
      }
      return 'completed';
    } catch (error) {
      if (isCanceledFeedQuery(error)) {
        finishTrace(isCurrentFeedRequest() ? 'canceled' : 'stale', {
          source: requestSource,
          reason: isCurrentFeedRequest() ? 'canceled' : 'superseded'
        });
        return 'stale';
      } else if (!isCurrentFeedRequest()) {
        finishTrace('stale', { source: requestSource, reason: 'superseded' });
        return 'stale';
      } else {
        const sourceError = sourceErrorFromUnknown(requestSource, error);
        const reason = diagnosticReasonForSourceError(sourceError);
        const outcome = reason === 'verification_required' || reason === 'login_required' || reason === 'permission_denied'
          ? 'blocked'
          : 'failure';
        const notice = isLoadMore ? `加载下一页失败：${sourceError.message}` : sourceError.message;
        if (isLoadMore) {
          markFeedLoadMoreFailed(requestSource);
        }
        if (requestSource === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(notice);
          }
          finishTrace(outcome, { source: requestSource, reason });
          return 'completed';
        }
        if (requestSource === 'nodeseek' && sourceError.kind === 'verification-required') {
          showNodeSeekVerification(notice);
          finishTrace(outcome, { source: requestSource, reason });
          return 'completed';
        }
        if (requestSource === 'linuxdo' && sourceError.kind === 'verification-required') {
          if (!suppressLinuxDoVerification) {
            const recovery = linuxDoRecovery();
            activeFeedRecoveryRef.current = {
              key: recovery.key,
              lane: isLoadMore ? 'more' : 'root',
              source: requestSource
            };
            await showLinuxDoVerification(notice, recovery);
          }
          finishTrace(outcome, { source: requestSource, reason });
          return 'verification-required';
        }
        notify(notice);
        finishTrace(outcome, { source: requestSource, reason });
        return 'failed';
      }
    } finally {
      if (!traceFinished) {
        finishTrace(isCurrentFeedRequest() ? 'failure' : querySignal?.aborted ? 'canceled' : 'stale', {
          source: requestSource,
          reason: isCurrentFeedRequest() ? 'unknown' : querySignal?.aborted ? 'canceled' : 'superseded'
        });
      }
      if (feedRecoveryGenerationRef.current === requestGeneration) {
        setFeedStates((current) => ({
          ...current,
          [requestSource]: {
            ...current[requestSource],
            refreshing: false,
            loadingMore: false
          }
        }));
      }
      if (isLatestFeedRequest()) {
        setFeedBusy(false);
        feedLoadingRef.current = false;
      }
    }
  }, [
    categoryFilter,
    feedFilters,
    feedSource,
    markFeedLoadMoreFailed,
    notify,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin,
    sourceGateway
  ]);

  useCommitRefValue(loadFeedRef, loadFeed);

  useEffect(() => {
    if (!readerDataLoaded && shouldWaitForReaderDataBeforeFeed(feedSource, readingFilter)) {
      return;
    }
    const requestFeedFilter = feedFilterForRequest(feedSource, categoryFilter, feedFilters);
    const requestKey = feedRequestKey(feedSource, categoryFilter, requestFeedFilter);
    if (shouldReuseFeedStateForRequest(feedStatesRef.current[feedSource], requestKey)) {
      return;
    }
    void loadFeedRef.current?.({ reset: true, page: 1, source: feedSource, category: categoryFilter, feedFilter: requestFeedFilter, nocache: true, clearItems: true });
  }, [categoryFilter, feedFilters, feedSource, feedStatesRef, readerDataLoaded, readingFilter, sourceResetVersion]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories, sourceResetVersion]);

  useEffect(() => {
    if (shouldLoadCategoriesForSource(categories, feedSource)) {
      void loadCategories(feedSource);
    }
  }, [categories, feedSource, loadCategories]);

  const refreshFeed = useCallback(() => {
    if (feedLoadingRef.current) {
      notify('列表正在更新');
      return;
    }
    notify('正在更新列表');
    void loadFeed({ reset: true, page: 1, nocache: true, successMessage: '列表已更新' });
  }, [loadFeed, notify]);

  const changeFeedSource = useCallback((source: FeedSource) => {
    if (source !== feedSource) {
      setFeedStates((current) => ({
        ...current,
        [source]: createFeedSourceState()
      }));
    }
    setFeedSource(source);
    setCategoryFilter('');
  }, [feedSource]);

  const setFeedFilter = useCallback((filter: SourceFeedFilter) => {
    setFeedFilters((current) => {
      return feedSource !== 'all' && isFeedFilterSource(feedSource)
        ? { ...current, [feedSource]: filter } as FeedFilterState
        : current;
    });
  }, [feedSource]);

  const abortFeedRequests = useCallback(() => {
    feedRecoveryGenerationRef.current += 1;
    categoriesGenerationRef.current += 1;
    void appQueryClient.cancelQueries({
      predicate: ({ queryKey }) => (
        queryKey[0] === 'forum'
        && (queryKey[2] === 'feed' || queryKey[2] === 'categories')
      )
    });
  }, []);

  useEffect(() => abortFeedRequests, [abortFeedRequests]);

  return {
    abortFeedRequests,
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy,
    feedFilter: feedFilterForRequest(feedSource, categoryFilter, feedFilters),
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
