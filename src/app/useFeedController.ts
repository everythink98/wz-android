import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { getCategories, getFeed, getYaohuoFeedDirect } from '../sources/sourceGateway';
import { shouldLoadCategoriesForSource, shouldAllowFeedRemotePagination, shouldUseReadingFilter } from '../feedCategoryRail';
import {
  applyFeedFilter,
  mergeCategories,
  mergeFeedResponses,
  nextFeedPageState,
  shouldFetchAggregatedBaseFeed,
  type ReadingFilter
} from '../feedLogic';
import type { ReaderData } from '../readerData';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  isNodeSeekCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  sourceLabel,
  startAbortableRequest
} from '../appUtils';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import type { Fetcher } from '../request';
import type { Category, FeedResponse, FeedSource, Source, Topic } from '../types';

type FeedSourceState = {
  hasMore: boolean;
  items: Topic[];
  loadMoreFailureSignal: number;
  loadingMore: boolean;
  nextCursor?: string;
  page: number;
  refreshing: boolean;
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

export function useFeedController({
  clearYaohuoLoginState,
  fetcher,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  nodeSeekUserAgentRef,
  notify,
  queryClient,
  readerData,
  readerDataLoaded,
  showNodeSeekVerification,
  showYaohuoLogin
}: {
  clearYaohuoLoginState: () => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  queryClient: QueryClient;
  readerData: ReaderData;
  readerDataLoaded: boolean;
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
      const data = await queryClient.fetchQuery({
        queryKey: ['android-categories', source, requestId],
        queryFn: async () => {
          const nodeSeekCookie = await loadNodeSeekCookieForSource(source);
          return getCategories({
            source,
            nocache: true,
            fetcher,
            nodeSeekCookie,
            nodeSeekUserAgent: nodeSeekUserAgentRef.current,
            signal: controller.signal
          });
        }
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
        if (errors.some(([sourceName, message]) => sourceName === 'nodeseek' && /Cloudflare|验证/.test(message))) {
          showNodeSeekVerification(data.errors.nodeseek || 'NodeSeek 需要完成 Cloudflare 验证');
          return;
        }
        notify(errors.map(([sourceName, message]) => `${sourceLabel(sourceName as Source)}：${message}`).join('；'));
      }
    } catch (error) {
      if (requestId === categoriesRequestIdRef.current && !controller.signal.aborted && !isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      finishAbortableRequest(categoriesAbortRef, controller);
    }
  }, [fetcher, loadNodeSeekCookieForSource, nodeSeekUserAgentRef, notify, queryClient, showNodeSeekVerification]);

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
    nocache = false,
    clearItems = reset && !nocache,
    successMessage
  }: {
    page?: number;
    cursor?: string;
    reset?: boolean;
    source?: FeedSource;
    category?: string;
    nocache?: boolean;
    clearItems?: boolean;
    successMessage?: string;
  } = {}) => {
    if (feedLoadingRef.current && !reset) {
      return;
    }
    const requestSource = source;
    const requestBaseState = feedStatesRef.current[requestSource];
    feedLoadingRef.current = true;
    const controller = startAbortableRequest(feedAbortRef);
    const requestId = ++feedRequestIdRef.current;
    const requestOwner = startOwnedRequest(feedRequestOwnerRef, `feed:${requestSource}:${category || ''}:${page}:${cursor || ''}:${nocache ? 'nocache' : 'cache'}`);
    const isCurrentFeedRequest = () => isCurrentOwnedRequest(requestOwner, feedRequestOwnerRef) && requestId === feedRequestIdRef.current;
    feedSourceRequestIdRef.current[requestSource] = requestId;
    const isLoadMore = !reset && page > 1;
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
              ...nextPageState
            }
          };
        });
      };
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(source),
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
      let finalErrors: Partial<Record<FeedSource, string>> = {};
      if (source === 'all' && yaohuoCookie) {
        const shouldFetchBaseFeed = shouldFetchAggregatedBaseFeed({ page, cursor, hasYaohuoCookie: true });
        const basePromise = shouldFetchBaseFeed
          ? getFeed({
            source,
            page,
            cursor,
            limit: 30,
            category: category || undefined,
            nocache,
            fetcher,
            nodeSeekCookie,
            nodeSeekUserAgent: nodeSeekUserAgentRef.current,
            signal: controller.signal
          })
          : Promise.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
        const yaohuoPromise = getYaohuoFeedDirect({
          yaohuoCookie,
          page,
          limit: 30,
          signal: controller.signal
        });
        void basePromise.then(applyFeedResponse).catch(() => undefined);
        void yaohuoPromise.then(applyFeedResponse).catch(() => undefined);
        const [baseResult, yaohuoResult] = await Promise.allSettled([basePromise, yaohuoPromise]);
        if (baseResult.status === 'rejected' && isCanceledRequest(baseResult.reason)) {
          throw baseResult.reason;
        }
        if (yaohuoResult.status === 'rejected' && isCanceledRequest(yaohuoResult.reason)) {
          throw yaohuoResult.reason;
        }
        if (yaohuoResult.status === 'rejected' && isYaohuoLoginRequiredError(yaohuoResult.reason)) {
          if (isYaohuoLoginExpiredError(yaohuoResult.reason)) {
            await clearYaohuoLoginState();
          }
        }
        if (baseResult.status === 'rejected' && yaohuoResult.status === 'rejected') {
          throw baseResult.reason;
        }
        finalErrors = {
          ...(baseResult.status === 'fulfilled' ? (baseResult.value.errors || {}) : { all: errorMessage(baseResult.reason) }),
          ...(yaohuoResult.status === 'fulfilled' ? (yaohuoResult.value.errors || {}) : { yaohuo: errorMessage(yaohuoResult.reason) })
        };
      } else if (source === 'yaohuo') {
        const data = await getYaohuoFeedDirect({
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
        if (errors.some(([sourceName, message]) => sourceName === 'nodeseek' && /Cloudflare|验证/.test(message))) {
          const message = finalErrors.nodeseek || 'NodeSeek 需要完成 Cloudflare 验证';
          if (isLoadMore) {
            markFeedLoadMoreFailed(requestSource);
          }
          showNodeSeekVerification(isLoadMore ? `加载下一页失败：${message}` : message);
          return;
        }
        const message = errors.map(([sourceName, error]) => `${sourceLabel(sourceName as Source)}：${error}`).join('；');
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
            await clearYaohuoLoginState();
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
    feedSource,
    fetcher,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    markFeedLoadMoreFailed,
    nodeSeekUserAgentRef,
    notify,
    showNodeSeekVerification,
    showYaohuoLogin
  ]);

  const loadFeedRef = useRef(loadFeed);
  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    if (!readerDataLoaded) {
      return;
    }
    void loadFeedRef.current({ reset: true, page: 1, source: feedSource, category: categoryFilter, nocache: true, clearItems: true });
  }, [categoryFilter, feedSource, readerDataLoaded]);

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
    void loadCategories();
  }, [loadCategories, loadFeed, notify]);

  const changeFeedSource = useCallback((source: FeedSource) => {
    setFeedSource(source);
    setCategoryFilter('');
  }, []);

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
    feedSource,
    loadFeed,
    readingFilter,
    refreshFeed,
    setCategoryFilter,
    setReadingFilter,
    shownFeedItems
  };
}
