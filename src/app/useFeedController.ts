import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCategories, getFeed, getYaohuoFeed } from '../sources/sourceGateway';
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
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  isLinuxDoCloudflareError,
  isNodeSeekCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  sourceLabel,
  startAbortableRequest
} from '../appUtils';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import type { Fetcher } from '../request';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import { formatSourceErrorMessages, linuxDoVerificationNavigationMessage, nodeSeekVerificationNavigationMessage, sourceErrorFromUnknown } from '../sourceErrors';
import type { Category, FeedFilterState, FeedSource, FeedResponse, LinuxDoFeedFilter, Source, SourceFeedFilter, SourceErrors, Topic } from '../types';

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

export function useFeedController({
  clearYaohuoLoginState,
  fetcher,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  nodeSeekUserAgentRef,
  notify,
  readerData,
  readerDataLoaded,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin
}: {
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  readerData: ReaderData;
  readerDataLoaded: boolean;
  showLinuxDoVerification: (message?: string) => void;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
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

  const activeFeedState = feedStates[feedSource];
  const feedAllowsRemotePagination = shouldAllowFeedRemotePagination(feedSource, readingFilter);
  const shownFeedItems = useMemo(
    () => applyFeedFilter(activeFeedState.items, readerData, shouldUseReadingFilter(feedSource) ? readingFilter : 'all'),
    [activeFeedState.items, feedSource, readerData, readingFilter]
  );

  const loadCategories = useCallback(async (source: FeedSource = 'all') => {
    const requestId = ++categoriesRequestIdRef.current;
    const controller = startAbortableRequest(categoriesAbortRef);
    try {
      const nodeSeekCookie = await loadNodeSeekCookieForSource(source);
      const data = await getCategories({
        source,
        nocache: true,
        fetcher,
        nodeSeekCookie,
        nodeSeekUserAgent: nodeSeekUserAgentRef.current,
        signal: controller.signal
      });
      if (requestId !== categoriesRequestIdRef.current || controller.signal.aborted) {
        return;
      }
      if (source !== 'all' && !data.items.length) {
        return;
      }
      setCategories((current) => source === 'all' ? mergeCategories(data.items, []) : mergeCategories(current, data.items));
      const errors = Object.entries(data.errors || {});
      if (errors.length) {
        const verificationMessage = nodeSeekVerificationNavigationMessage(source, data.errors);
        if (verificationMessage) {
          showNodeSeekVerification(verificationMessage);
          return;
        }
        notify(formatSourceErrorMessages(data.errors, sourceLabel));
      }
    } catch (error) {
      if (requestId === categoriesRequestIdRef.current && !controller.signal.aborted && !isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      finishAbortableRequest(categoriesAbortRef, controller);
    }
  }, [fetcher, loadNodeSeekCookieForSource, nodeSeekUserAgentRef, notify, showNodeSeekVerification]);

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
    if (feedLoadingRef.current && !reset) {
      return;
    }
    const requestSource = source;
    const requestBaseState = feedStatesRef.current[requestSource];
    const requestFeedFilter = feedFilter ?? feedFilterForRequest(requestSource, category, feedFilters);
    const requestKey = feedRequestKey(requestSource, category, requestFeedFilter);
    feedLoadingRef.current = true;
    const controller = startAbortableRequest(feedAbortRef);
    const requestId = ++feedRequestIdRef.current;
    const requestOwner = startOwnedRequest(feedRequestOwnerRef, `feed:${requestKey}:${page}:${cursor || ''}:${nocache ? 'nocache' : 'cache'}`);
    const isCurrentFeedRequest = () => isCurrentOwnedRequest(requestOwner, feedRequestOwnerRef) && requestId === feedRequestIdRef.current;
    feedSourceRequestIdRef.current[requestSource] = requestId;
    const isLoadMore = !reset && page > 1;
    let yaohuoGeneration: number | undefined;
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
        setFeedStates((current) => {
          const previous = current[requestSource];
          const nextPageState = nextFeedPageState(requestBaseState, appliedFeedResponse as FeedResponse, {
            requestedPage: page,
            reset
          });
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
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } }),
        loadNodeSeekCookieForSource(source)
      ]);
      if (!isCurrentFeedRequest()) {
        return;
      }
      if (source === 'yaohuo' && !yaohuoCookie) {
        const message = '请先登录妖火。';
        if (isLoadMore) {
          markFeedLoadMoreFailed(requestSource);
        }
        showYaohuoLogin(isLoadMore ? `加载下一页失败：${message}` : message);
        return;
      }
      let finalErrors: SourceErrors = {};
      if (source === 'all' && yaohuoCookie) {
        const shouldFetchBaseFeed = shouldFetchAggregatedBaseFeed({
          page,
          cursor,
          hasYaohuoCookie: true,
          retryWithoutCursor: Boolean(requestBaseState.baseFeedRetryPending)
        });
        const basePromise = shouldFetchBaseFeed
          ? getFeed({
            source,
            page,
            cursor,
            limit: 30,
          category: category || undefined,
          feedFilter: requestFeedFilter,
          nocache,
            fetcher,
            nodeSeekCookie,
            nodeSeekUserAgent: nodeSeekUserAgentRef.current,
            signal: controller.signal
          })
          : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
        const yaohuoPromise = getYaohuoFeed({
          yaohuoCookie,
          page,
          limit: 30,
          signal: controller.signal
        });
        const [baseResult, yaohuoResult] = await Promise.allSettled([basePromise, yaohuoPromise]);
        if (baseResult.status === 'rejected' && isCanceledRequest(baseResult.reason)) {
          throw baseResult.reason;
        }
        if (yaohuoResult.status === 'rejected' && isCanceledRequest(yaohuoResult.reason)) {
          throw yaohuoResult.reason;
        }
        if (yaohuoResult.status === 'rejected' && isYaohuoLoginRequiredError(yaohuoResult.reason)) {
          if (isYaohuoLoginExpiredError(yaohuoResult.reason)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
          }
        }
        if (baseResult.status === 'rejected' && yaohuoResult.status === 'rejected') {
          throw baseResult.reason;
        }
        if (!isCurrentFeedRequest()) {
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
        const data = await getYaohuoFeed({
          yaohuoCookie,
          page,
          limit: 30,
          category: category || undefined,
          signal: controller.signal
        });
        if (!isCurrentFeedRequest()) {
          return;
        }
        applyFeedResponse(data);
        finalErrors = data.errors || {};
      } else {
        const data = await getFeed({
          source,
          page,
          cursor,
          limit: 30,
          category: category || undefined,
          feedFilter: requestFeedFilter,
          linuxDoFilter: requestSource === 'linuxdo' ? requestFeedFilter as LinuxDoFeedFilter | undefined : undefined,
          nocache,
          fetcher,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal
        });
        if (!isCurrentFeedRequest()) {
          return;
        }
        applyFeedResponse(data);
        finalErrors = data.errors || {};
      }
      if (!isCurrentFeedRequest()) {
        return;
      }
      const errors = Object.entries(finalErrors);
      if (errors.length) {
        const verificationMessage = nodeSeekVerificationNavigationMessage(requestSource, finalErrors);
        if (verificationMessage) {
          if (isLoadMore) {
            markFeedLoadMoreFailed(requestSource);
          }
          showNodeSeekVerification(isLoadMore ? `加载下一页失败：${verificationMessage}` : verificationMessage);
          return;
        }
        const linuxDoVerificationMessage = linuxDoVerificationNavigationMessage(requestSource, finalErrors);
        if (linuxDoVerificationMessage) {
          if (isLoadMore) {
            markFeedLoadMoreFailed(requestSource);
          }
          showLinuxDoVerification(isLoadMore ? `加载下一页失败：${linuxDoVerificationMessage}` : linuxDoVerificationMessage);
          return;
        }
        const message = formatSourceErrorMessages(finalErrors, sourceLabel);
        if (isLoadMore) {
          markFeedLoadMoreFailed(requestSource);
          notify(`加载下一页失败：${message}`);
        } else {
          notify(message);
        }
      } else if (successMessage) {
        notify(successMessage);
      }
    } catch (error) {
      if (isCurrentFeedRequest()) {
        const message = errorMessage(error);
        const notice = isLoadMore ? `加载下一页失败：${message}` : message;
        if (isLoadMore && !isCanceledRequest(error)) {
          markFeedLoadMoreFailed(requestSource);
        }
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(notice);
          }
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(notice);
          return;
        }
        if (isLinuxDoCloudflareError(error)) {
          showLinuxDoVerification(notice);
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(notice);
        }
      }
    } finally {
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
      if (isCurrentFeedRequest()) {
        setFeedBusy(false);
        feedLoadingRef.current = false;
      }
      finishAbortableRequest(feedAbortRef, controller);
    }
  }, [
    categoryFilter,
    clearYaohuoLoginState,
    feedFilters,
    feedSource,
    fetcher,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    markFeedLoadMoreFailed,
    nodeSeekUserAgentRef,
    notify,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
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
    setFeedSource(source);
    setCategoryFilter('');
  }, []);

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
