import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceGateway } from '../sources/sourceGateway';
import { defaultFeedFilters, shouldLoadCategoriesForSource, shouldAllowFeedRemotePagination, shouldUseFeedFilter, shouldUseReadingFilter } from '../feedCategoryRail';
import {
  applyFeedFilter,
  feedRequestKey,
  mergeCategories,
  mergeFeedResponses,
  nextFeedPageState,
  shouldFetchAggregatedBaseFeed,
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
import {
  errorMessage,
  finishAbortableRequest,
  interruptedRequestDiagnostic,
  isSilentRequestInterruption,
  isSupersededRequest,
  sourceLabel,
  startAbortableRequest
} from '../appUtils';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import { formatSourceErrorMessages, linuxDoVerificationNavigationMessage, nodeSeekVerificationNavigationMessage, sourceErrorFromUnknown, yaohuoErrorRequiresLoginPanel } from '../sourceErrors';
import type { Category, FeedFilterState, FeedSource, FeedResponse, LinuxDoFeedFilter, SourceErrorInfo, SourceFeedFilter, SourceErrors, Topic } from '../types';

type FeedSourceState = {
  baseFeedRetryPending?: boolean;
  hasMore: boolean;
  items: Topic[];
  loadMoreFailureSignal: number;
  loadingMore: boolean;
  nextCursor?: string;
  page: number;
  refreshing: boolean;
  requestKey?: string;
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
  return {
    all: createFeedSourceState(),
    v2ex: createFeedSourceState(),
    linuxdo: createFeedSourceState(),
    nodeseek: createFeedSourceState(),
    yaohuo: createFeedSourceState()
  };
}

function feedFilterForRequest(source: FeedSource, category: string, filters: FeedFilterState): SourceFeedFilter | undefined {
  if (!shouldUseFeedFilter(source, category)) {
    return undefined;
  }
  if (source === 'linuxdo') {
    return filters.linuxdo;
  }
  if (source === 'nodeseek') {
    return filters.nodeseek;
  }
  if (source === 'v2ex') {
    return filters.v2ex;
  }
  return undefined;
}

export function shouldWaitForReaderDataBeforeFeed(source: FeedSource, readingFilter: ReadingFilter) {
  return shouldUseReadingFilter(source) && readingFilter !== 'all';
}

export function mergedFeedResponseAfterSplitFetch(responses: FeedResponse[], errors: SourceErrors, isLoadMore: boolean) {
  if (!responses.length || (isLoadMore && Object.keys(errors).length > 0)) {
    return null;
  }
  let merged: FeedResponse | null = null;
  for (const response of responses) {
    merged = merged ? mergeFeedResponses(merged, response) : response;
  }
  return merged;
}

function diagnosticReasonForSourceError(error?: SourceErrorInfo): DiagnosticReason {
  if (error?.kind === 'login-required' || error?.kind === 'login-expired') return 'login_required';
  if (error?.kind === 'verification-required') return 'verification_required';
  if (error?.kind === 'permission-denied') return 'permission_denied';
  return error ? normalizeDiagnosticReason(error.message) : 'unknown';
}

export function useFeedController({
  notify,
  readerData,
  readerDataLoaded,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway,
  yaohuoCredentialSuppressed = false
}: {
  notify: (message: string) => void;
  readerData: ReaderData;
  readerDataLoaded: boolean;
  showLinuxDoVerification: (message?: string) => void;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
  yaohuoCredentialSuppressed?: boolean;
}) {
  const feedRequestIdRef = useRef(0);
  const feedRequestOwnerRef = useRef(createRequestOwner('feed'));
  const feedSourceRequestIdRef = useRef<Partial<Record<FeedSource, number>>>({});
  const feedLoadingRef = useRef(false);
  const feedAbortRef = useRef<AbortController | null>(null);
  const categoriesRequestIdRef = useRef(0);
  const categoriesAbortRef = useRef<AbortController | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [feedStates, setFeedStates] = useState<Record<FeedSource, FeedSourceState>>(() => createFeedStates());
  const feedStatesRef = useRef(feedStates);
  if (feedStatesRef.current !== feedStates) {
    feedStatesRef.current = feedStates;
  }
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [feedFilters, setFeedFilters] = useState<FeedFilterState>(defaultFeedFilters);
  const [categories, setCategories] = useState<Category[]>([]);
  const categoriesRef = useRef(categories);
  if (categoriesRef.current !== categories) {
    categoriesRef.current = categories;
  }

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
    const requestId = ++categoriesRequestIdRef.current;
    const controller = startAbortableRequest(categoriesAbortRef);
    const isLatestCategoriesRequest = () => requestId === categoriesRequestIdRef.current;
    const isCurrentCategoriesRequest = () => isLatestCategoriesRequest() && !controller.signal.aborted;
    markDiagnosticStage(trace, 'guard', { source, state: 'started' });
    try {
      const data = await sourceGateway.getCategories({
        source,
        nocache: true,
        signal: controller.signal
      }, { isCurrent: isCurrentCategoriesRequest, trace });
      const interruption = interruptedRequestDiagnostic(isLatestCategoriesRequest(), controller.signal.aborted);
      if (interruption) {
        finishTrace(interruption.outcome, { source, reason: interruption.reason });
        return;
      }
      if (source !== 'all' && !data.items.length) {
        finishTrace('noop', { source, reason: 'parse_empty' });
        return;
      }
      const currentCategories = categoriesRef.current;
      const nextCategories = source === 'all' ? mergeCategories(data.items, []) : mergeCategories(currentCategories, data.items);
      markDiagnosticStage(trace, 'apply', {
        source,
        beforeCount: currentCategories.length,
        afterCount: nextCategories.length,
        itemCount: data.items.length
      });
      setCategories((current) => source === 'all' ? mergeCategories(data.items, []) : mergeCategories(current, data.items));
      const errors = Object.entries(data.errors || {});
      if (errors.length) {
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
      if (isSilentRequestInterruption(error)) {
        const stale = isSupersededRequest(error) || !isLatestCategoriesRequest();
        finishTrace(stale ? 'stale' : 'canceled', {
          source,
          reason: stale ? 'superseded' : 'canceled'
        });
      } else if (interruptedRequestDiagnostic(isLatestCategoriesRequest(), controller.signal.aborted)) {
        const interruption = interruptedRequestDiagnostic(isLatestCategoriesRequest(), controller.signal.aborted)!;
        finishTrace(interruption.outcome, { source, reason: interruption.reason });
      } else {
        notify(errorMessage(error));
        finishTrace('failure', { source, reason: normalizeDiagnosticReason(error) });
      }
    } finally {
      if (!traceFinished) {
        const interruption = interruptedRequestDiagnostic(isLatestCategoriesRequest(), controller.signal.aborted);
        finishTrace(interruption?.outcome || 'failure', { source, reason: interruption?.reason || 'unknown' });
      }
      finishAbortableRequest(categoriesAbortRef, controller);
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

  const loadFeed = useCallback(async ({
    page = 1,
    cursor,
    reset = false,
    source = feedSource,
    category = categoryFilter,
    feedFilter,
    nocache = false,
    clearItems = reset && !nocache,
    successMessage
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
  } = {}) => {
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
      return;
    }
    const requestBaseState = feedStatesRef.current[requestSource];
    const requestFeedFilter = feedFilter ?? feedFilterForRequest(requestSource, category, feedFilters);
    const requestKey = feedRequestKey(requestSource, category, requestFeedFilter);
    feedLoadingRef.current = true;
    const controller = startAbortableRequest(feedAbortRef);
    const requestId = ++feedRequestIdRef.current;
    const requestOwner = startOwnedRequest(feedRequestOwnerRef, `feed:${requestKey}:${page}:${cursor || ''}:${nocache ? 'nocache' : 'cache'}`);
    const isLatestFeedRequest = () => isCurrentOwnedRequest(requestOwner, feedRequestOwnerRef) && requestId === feedRequestIdRef.current;
    const isCurrentFeedRequest = () => isLatestFeedRequest() && !controller.signal.aborted;
    const finishInterruptedFeedRequest = () => {
      const interruption = interruptedRequestDiagnostic(isLatestFeedRequest(), controller.signal.aborted);
      if (!interruption) {
        return false;
      }
      finishTrace(interruption.outcome, { source: requestSource, reason: interruption.reason });
      return true;
    };
    feedSourceRequestIdRef.current[requestSource] = requestId;
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
        if (!isCurrentFeedRequest() || controller.signal.aborted) {
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
      const getAggregatedBaseFeed = () => sourceGateway.getFeed({
        source: 'all',
        page,
        cursor,
        limit: 30,
        category: category || undefined,
        feedFilter: requestFeedFilter,
        nocache,
        signal: controller.signal
      }, { isCurrent: isCurrentFeedRequest, trace });
      const shouldStartAggregatedBaseFeed = source === 'all' && shouldFetchAggregatedBaseFeed({
        page,
        cursor,
        hasYaohuoCookie: true,
        retryWithoutCursor: Boolean(requestBaseState.baseFeedRetryPending)
      });
      const eagerBasePromise = shouldStartAggregatedBaseFeed ? getAggregatedBaseFeed() : undefined;
      void eagerBasePromise?.catch(() => undefined);
      let hasYaohuoCredential = false;
      let yaohuoCredentialFailure: { reason: unknown } | null = null;
      if (source === 'all') {
        if (yaohuoCredentialSuppressed) {
          markDiagnosticStage(trace, 'credential', {
            source: 'yaohuo',
            state: 'disabled',
            hasCredential: false
          });
        } else try {
          hasYaohuoCredential = await sourceGateway.hasYaohuoCredential();
          markDiagnosticStage(trace, 'credential', {
            source: 'yaohuo',
            state: 'success',
            hasCredential: hasYaohuoCredential
          });
        } catch (error) {
          if (isSilentRequestInterruption(error)) {
            throw error;
          }
          markDiagnosticStage(trace, 'credential', {
            source: 'yaohuo',
            state: 'error',
            reason: 'storage_error',
            hasCredential: false
          });
          yaohuoCredentialFailure = { reason: error };
        }
      }
      if (finishInterruptedFeedRequest()) {
        return;
      }
      let finalErrors: SourceErrors = {};
      if (source === 'all' && (hasYaohuoCredential || yaohuoCredentialFailure)) {
        const shouldFetchBaseFeed = shouldFetchAggregatedBaseFeed({
          page,
          cursor,
          hasYaohuoCookie: hasYaohuoCredential,
          retryWithoutCursor: Boolean(requestBaseState.baseFeedRetryPending)
        });
        const basePromise = shouldFetchBaseFeed
          ? eagerBasePromise || getAggregatedBaseFeed()
          : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
        const yaohuoPromise = hasYaohuoCredential
          ? sourceGateway.getFeed({
            source: 'yaohuo',
            page,
            limit: 30,
            signal: controller.signal
          }, { isCurrent: isCurrentFeedRequest, trace })
          : Promise.reject(yaohuoCredentialFailure?.reason);
        const [baseResult, yaohuoResult] = await Promise.allSettled([basePromise, yaohuoPromise]);
        if (baseResult.status === 'rejected' && isSilentRequestInterruption(baseResult.reason)) {
          throw baseResult.reason;
        }
        if (yaohuoResult.status === 'rejected' && isSilentRequestInterruption(yaohuoResult.reason)) {
          throw yaohuoResult.reason;
        }
        if (baseResult.status === 'rejected' && yaohuoResult.status === 'rejected') {
          throw baseResult.reason;
        }
        if (finishInterruptedFeedRequest()) {
          return;
        }
        setFeedStates((current) => ({
          ...current,
          [requestSource]: {
            ...current[requestSource],
            baseFeedRetryPending: baseResult.status === 'rejected' && yaohuoResult.status === 'fulfilled'
          }
        }));
        finalErrors = {
          ...(baseResult.status === 'fulfilled' ? (baseResult.value.errors || {}) : { all: sourceErrorFromUnknown('all', baseResult.reason) }),
          ...(yaohuoResult.status === 'fulfilled' ? (yaohuoResult.value.errors || {}) : { yaohuo: sourceErrorFromUnknown('yaohuo', yaohuoResult.reason) })
        };
        const splitResponse = mergedFeedResponseAfterSplitFetch([
          ...(baseResult.status === 'fulfilled' ? [baseResult.value] : []),
          ...(yaohuoResult.status === 'fulfilled' ? [yaohuoResult.value] : [])
        ], finalErrors, isLoadMore);
        if (splitResponse) {
          applyFeedResponse(splitResponse);
        }
      } else if (source === 'yaohuo') {
        const data = await sourceGateway.getFeed({
          source: 'yaohuo',
          page,
          limit: 30,
          category: category || undefined,
          signal: controller.signal
        }, { isCurrent: isCurrentFeedRequest, trace });
        if (finishInterruptedFeedRequest()) {
          return;
        }
        applyFeedResponse(data);
        finalErrors = data.errors || {};
      } else {
        const data = source === 'all' && eagerBasePromise
          ? await eagerBasePromise
          : await sourceGateway.getFeed({
            source,
            page,
            cursor,
            limit: 30,
            category: category || undefined,
            feedFilter: requestFeedFilter,
            linuxDoFilter: requestSource === 'linuxdo' ? requestFeedFilter as LinuxDoFeedFilter | undefined : undefined,
            nocache,
            signal: controller.signal
          }, { isCurrent: isCurrentFeedRequest, trace });
        if (finishInterruptedFeedRequest()) {
          return;
        }
        finalErrors = data.errors || {};
        const response = mergedFeedResponseAfterSplitFetch([data], finalErrors, isLoadMore);
        if (response) {
          applyFeedResponse(response);
        }
      }
      if (finishInterruptedFeedRequest()) {
        return;
      }
      const errors = Object.entries(finalErrors);
      if (errors.length) {
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
          return;
        }
        const linuxDoVerificationMessage = linuxDoVerificationNavigationMessage(requestSource, finalErrors);
        if (linuxDoVerificationMessage) {
          if (isLoadMore) {
            markFeedLoadMoreFailed(requestSource);
          }
          showLinuxDoVerification(isLoadMore ? `加载下一页失败：${linuxDoVerificationMessage}` : linuxDoVerificationMessage);
          finishTrace(outcome, { source: requestSource, reason, partialErrorCount: errors.length });
          return;
        }
        const message = formatSourceErrorMessages(finalErrors, sourceLabel);
        if (isLoadMore) {
          markFeedLoadMoreFailed(requestSource);
          notify(`加载下一页失败：${message}`);
        } else {
          notify(message);
        }
        finishTrace(outcome, { source: requestSource, reason, partialErrorCount: errors.length });
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
    } catch (error) {
      if (isSilentRequestInterruption(error)) {
        const stale = isSupersededRequest(error) || !isLatestFeedRequest();
        finishTrace(stale ? 'stale' : 'canceled', {
          source: requestSource,
          reason: stale ? 'superseded' : 'canceled'
        });
      } else if (interruptedRequestDiagnostic(isLatestFeedRequest(), controller.signal.aborted)) {
        const interruption = interruptedRequestDiagnostic(isLatestFeedRequest(), controller.signal.aborted)!;
        finishTrace(interruption.outcome, { source: requestSource, reason: interruption.reason });
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
          return;
        }
        if (requestSource === 'nodeseek' && sourceError.kind === 'verification-required') {
          showNodeSeekVerification(notice);
          finishTrace(outcome, { source: requestSource, reason });
          return;
        }
        if (requestSource === 'linuxdo' && sourceError.kind === 'verification-required') {
          showLinuxDoVerification(notice);
          finishTrace(outcome, { source: requestSource, reason });
          return;
        }
        notify(notice);
        finishTrace(outcome, { source: requestSource, reason });
      }
    } finally {
      if (!traceFinished) {
        const interruption = interruptedRequestDiagnostic(isLatestFeedRequest(), controller.signal.aborted);
        finishTrace(interruption?.outcome || 'failure', {
          source: requestSource,
          reason: interruption?.reason || 'unknown'
        });
      }
      const isLatestForFeedSource = feedSourceRequestIdRef.current[requestSource] === requestId;
      if (isLatestForFeedSource) {
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
      finishAbortableRequest(feedAbortRef, controller);
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
    sourceGateway,
    yaohuoCredentialSuppressed
  ]);

  const loadFeedRef = useRef(loadFeed);
  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    if (!readerDataLoaded && shouldWaitForReaderDataBeforeFeed(feedSource, readingFilter)) {
      return;
    }
    const requestFeedFilter = feedFilterForRequest(feedSource, categoryFilter, feedFilters);
    const requestKey = feedRequestKey(feedSource, categoryFilter, requestFeedFilter);
    if (shouldReuseFeedStateForRequest(feedStatesRef.current[feedSource], requestKey)) {
      return;
    }
    void loadFeedRef.current({ reset: true, page: 1, source: feedSource, category: categoryFilter, feedFilter: requestFeedFilter, nocache: true, clearItems: true });
  }, [categoryFilter, feedFilters, feedSource, readerDataLoaded, readingFilter]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

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
      if (feedSource === 'linuxdo') {
        return { ...current, linuxdo: filter as LinuxDoFeedFilter };
      }
      if (feedSource === 'nodeseek') {
        return { ...current, nodeseek: filter as FeedFilterState['nodeseek'] };
      }
      if (feedSource === 'v2ex') {
        return { ...current, v2ex: filter as FeedFilterState['v2ex'] };
      }
      return current;
    });
  }, [feedSource]);

  const abortFeedRequests = useCallback(() => {
    feedAbortRef.current?.abort();
    categoriesAbortRef.current?.abort();
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
