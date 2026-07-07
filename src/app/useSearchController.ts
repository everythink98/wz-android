import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { feedSources } from '../feedCategoryRail';
import {
  mergeTopics,
  type SearchSort
} from '../feedLogic';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchFilterState,
  type SourceSearchFilter
} from '../searchFilters';
import { mergeLoadedSearchHistory, normalizeSearchHistory, sameSearchHistory } from '../searchHistory';
import { searchTopics, searchYaohuoTopics } from '../sources/sourceGateway';
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
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import { sourceErrorMessage, sourceErrorRequiresVerification } from '../sourceErrors';
import { authNoticeForMessage, authNoticeForSource, searchSessionNoticeItems } from '../siteSessionPrompts';
import type { SiteSessionViewModels } from '../siteSessionState';
import type { Category, FeedSource, Source, Topic } from '../types';
import type { SearchGroup } from '../searchListItems';
import {
  createSearchHistoryWriteQueue,
  createNodeSeekRetrySearchOptions,
  createSearchMoreRequestSnapshot,
  enqueueSearchHistoryWrite,
  groupFromRemoteSearchResult,
  remoteSearchSort,
  remoteSearchActionForSource,
  snapshotSearchFilters,
  type RemoteSearchAction,
  type RemoteSearchSourceResult,
  type SearchRunOptions
} from '../searchControllerResults';

const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';

function mergedSearchGroupItemCount(groups: SearchGroup[]) {
  const merged = groups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []);
  return merged.length;
}

function remoteSearchResult(group: SearchGroup): RemoteSearchSourceResult {
  return group.error ? { kind: 'failed', group } : { kind: 'success', group };
}

export function useSearchController({
  categories,
  clearYaohuoLoginState,
  fetcher,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  nodeSeekUserAgentRef,
  notify,
  onNodeSeekSearchVerificationRequired,
  sessionViewModels,
  showNodeSeekVerification,
  showYaohuoLogin
}: {
  categories: Category[];
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onNodeSeekSearchVerificationRequired?: (message: string, retry: () => void) => void;
  sessionViewModels: SiteSessionViewModels;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
}) {
  const searchRequestIdRef = useRef(0);
  const searchRequestOwnerRef = useRef(createRequestOwner('search'));
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchGroupsRef = useRef<SearchGroup[]>([]);
  const searchQueryRef = useRef('');
  const submittedSearchQueryRef = useRef('');
  const submittedSearchFiltersRef = useRef<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const submittedSearchSourceRef = useRef<FeedSource>('all');
  const searchFiltersRef = useRef<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const searchVisitedPagesRef = useRef<Record<string, Set<number>>>({});
  const runSearchRef = useRef<((options?: Source | SearchRunOptions) => Promise<void>) | null>(null);
  const recentSearchWriteQueueRef = useRef(createSearchHistoryWriteQueue());
  const lastSavedRecentSearchesRef = useRef<string[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState('');
  const [searchSource, setSearchSource] = useState<FeedSource>('all');
  const [searchFilters, setSearchFilters] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentSearchesLoaded, setRecentSearchesLoaded] = useState(false);
  const searchSessionNotices = useMemo(() => (
    searchSessionNoticeItems(searchSource, sessionViewModels)
  ), [searchSource, sessionViewModels]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (active) {
          setRecentSearches((current) => {
            const merged = mergeLoadedSearchHistory(current, raw);
            lastSavedRecentSearchesRef.current = merged;
            return sameSearchHistory(current, merged) ? current : merged;
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setRecentSearchesLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!recentSearchesLoaded) {
      return;
    }
    if (sameSearchHistory(lastSavedRecentSearchesRef.current, recentSearches)) {
      return;
    }
    const nextRecentSearches = recentSearches;
    void enqueueSearchHistoryWrite(recentSearchWriteQueueRef.current, () => (
      AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(nextRecentSearches))
    ))
      .then(() => {
        lastSavedRecentSearchesRef.current = nextRecentSearches;
      })
      .catch(() => undefined);
  }, [recentSearches, recentSearchesLoaded]);

  const addRecentSearch = useCallback((query: string) => {
    const clean = query.trim();
    if (!clean) {
      return;
    }
    setRecentSearches((current) => {
      return normalizeSearchHistory([
        clean,
        ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())
      ]);
    });
  }, []);

  const removeRecentSearch = useCallback((query: string) => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== query);
      return next;
    });
  }, []);

  const clearSearchResults = useCallback(() => {
    searchRequestIdRef.current += 1;
    searchAbortRef.current?.abort();
    setSearchGroups([]);
    searchGroupsRef.current = [];
    setSearchBusy(false);
  }, []);

  useEffect(() => {
    const cleanQuery = searchQuery.trim();
    if (cleanQuery && cleanQuery === submittedSearchQueryRef.current) {
      return;
    }
    clearSearchResults();
    submittedSearchQueryRef.current = '';
    setSubmittedSearchQuery('');
  }, [clearSearchResults, searchQuery]);

  useEffect(() => {
    clearSearchResults();
  }, [clearSearchResults, searchSource]);

  const requireNodeSeekSearchVerification = useCallback((message: string, retry: () => void) => {
    if (onNodeSeekSearchVerificationRequired) {
      onNodeSeekSearchVerificationRequired(message, retry);
      return;
    }
    showNodeSeekVerification(message);
  }, [onNodeSeekSearchVerificationRequired, showNodeSeekVerification]);

  const runRemoteSearchSource = useCallback(async (
    source: Source,
    query: string,
    page: number,
    signal: AbortSignal,
    sort: SearchSort = 'relevance',
    filter?: SourceSearchFilter,
    options?: { isCurrent?: () => boolean }
  ): Promise<RemoteSearchSourceResult> => {
    let yaohuoGeneration: number | undefined;
    const sourceStatusNotice = authNoticeForSource(source, sessionViewModels, 'search') || undefined;
    try {
      const activeFilter = filter?.source === source ? filter : undefined;
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } }),
        loadNodeSeekCookieForSource(source)
      ]);
      if (source === 'yaohuo' && !yaohuoCookie) {
        const message = '妖火需要登录后使用此功能。';
        const group = { source, label: sourceLabel(source), items: [], error: message, authNotice: authNoticeForMessage(message) || sourceStatusNotice, hasMore: false, nextPage: null };
        return { kind: 'action-required', group, action: { type: 'yaohuo-login', message } };
      }
      const searchLimit = source === 'linuxdo' ? 50 : 30;
      const data = source === 'yaohuo'
        ? await searchYaohuoTopics({
          query,
          page,
          limit: searchLimit,
          category: activeFilter?.source === 'yaohuo' ? activeFilter.category : undefined,
          yaohuoCookie,
          yaohuoFetcher: fetcher,
          signal
        })
        : await searchTopics({
          query,
          source,
          page,
          limit: searchLimit,
          categories,
          fetcher,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          sort: source === 'v2ex' ? sort : 'relevance',
          filter: activeFilter,
          signal
        });
      const sourceError = data.errors?.[source];
      const sourceErrorText = sourceErrorMessage(sourceError) || undefined;
      const group = {
        source,
        label: sourceLabel(source),
        items: data.items,
        authNotice: sourceErrorText ? authNoticeForMessage(sourceErrorText) || undefined : sourceStatusNotice,
        error: sourceErrorText,
        verificationRequired: sourceErrorRequiresVerification(sourceError),
        hasMore: Boolean(data.hasMore && data.nextPage),
        nextPage: data.nextPage ?? null
      };
      if (source === 'nodeseek' && group.verificationRequired && group.error) {
        return { kind: 'action-required', group, action: { type: 'nodeseek-verification', message: group.error } };
      }
      return remoteSearchResult(group);
    } catch (error) {
      if (isCanceledRequest(error)) {
        throw error;
      }
      if (source === 'yaohuo' && isYaohuoLoginRequiredError(error)) {
        const message = isYaohuoLoginExpiredError(error) ? '妖火登录已失效，请重新登录。' : errorMessage(error);
        if (isYaohuoLoginExpiredError(error)) {
          if (options?.isCurrent?.() !== false) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
          }
        }
        const group = { source, label: sourceLabel(source), items: [], error: message, authNotice: authNoticeForMessage(message) || sourceStatusNotice, hasMore: false, nextPage: null };
        return { kind: 'action-required', group, action: { type: 'yaohuo-login', message } };
      }
      if (source === 'nodeseek' && isNodeSeekCloudflareError(error)) {
        const message = errorMessage(error);
        const group = { source, label: sourceLabel(source), items: [], error: message, authNotice: authNoticeForMessage(message) || sourceStatusNotice, verificationRequired: true, hasMore: false, nextPage: null };
        return { kind: 'action-required', group, action: { type: 'nodeseek-verification', message } };
      }
      const message = errorMessage(error);
      return { kind: 'failed', group: { source, label: sourceLabel(source), items: [], error: message, authNotice: authNoticeForMessage(message) || undefined, hasMore: false, nextPage: null } };
    }
  }, [categories, clearYaohuoLoginState, fetcher, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekUserAgentRef, sessionViewModels]);

  const handleRemoteSearchAction = useCallback((action: RemoteSearchAction, retryNodeSeek = () => { void runSearchRef.current?.('nodeseek'); }) => {
    if (action.type === 'yaohuo-login') {
      showYaohuoLogin(action.message);
      return;
    }
    requireNodeSeekSearchVerification(action.message, retryNodeSeek);
  }, [requireNodeSeekSearchVerification, showYaohuoLogin]);

  const runSearch = useCallback(async (options?: Source | SearchRunOptions) => {
    const runOptions: Partial<SearchRunOptions> & { sourceOverride?: Source } = typeof options === 'string' ? { sourceOverride: options } : options || {};
    const query = (runOptions.query ?? searchQuery).trim();
    if (!query) {
      notify('请输入搜索词');
      return;
    }
    if (runOptions.query !== undefined && searchQueryRef.current !== query) {
      searchQueryRef.current = query;
      setSearchQuery(query);
    }
    if (runOptions.source !== undefined && runOptions.source !== searchSource) {
      setSearchSource(runOptions.source);
    }
    const requestSearchSource = runOptions.source ?? searchSource;
    const requestFilters = runOptions.filters ?? searchFiltersRef.current;
    const sourceOverride = runOptions.sourceOverride;
    submittedSearchQueryRef.current = query;
    submittedSearchFiltersRef.current = snapshotSearchFilters(requestFilters);
    submittedSearchSourceRef.current = requestSearchSource;
    setSubmittedSearchQuery(query);
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    const activeFilter = requestSearchSource === 'all'
      ? undefined
      : requestFilters[(sourceOverride || requestSearchSource) as Source];
    const requestFilter = requestSearchSource === 'all' ? undefined : activeFilter;
    const requestOwner = startOwnedRequest(searchRequestOwnerRef, `search:${sourceOverride || requestSearchSource}:${query}:${JSON.stringify(activeFilter || {})}`);
    const isCurrentSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    const activeSources = sourceOverride
      ? [sourceOverride]
      : requestSearchSource === 'all'
        ? feedSources
        : [requestSearchSource as Source];
    const activeSort = remoteSearchSort(requestSearchSource, requestFilters);
    if (!sourceOverride) {
      searchVisitedPagesRef.current = {};
    }
    if (sourceOverride) {
      const nextGroups = searchGroupsRef.current.map((group) => (
        group.source === sourceOverride ? { ...group, loading: true, loadingMore: false, error: undefined } : { ...group, loading: false, loadingMore: false }
      ));
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
    } else {
      const nextGroups = activeSources.map((source) => ({ source, label: sourceLabel(source), items: [], authNotice: authNoticeForSource(source, sessionViewModels, 'search') || undefined, loading: true }));
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
    }
    setSearchBusy(true);
    try {
      addRecentSearch(query);
      const resultsBySource: Partial<Record<Source, RemoteSearchSourceResult>> = {};
      await Promise.all(activeSources.map(async (source) => {
        const result = await runRemoteSearchSource(source, query, 1, controller.signal, activeSort, requestFilter, { isCurrent: () => isCurrentSearchRequest() });
        if (!isCurrentSearchRequest()) {
          return;
        }
        resultsBySource[source] = result;
        const group = groupFromRemoteSearchResult(result);
        const nextGroups = searchGroupsRef.current.map((currentGroup) => (
          currentGroup.source === source ? { ...group, loading: false } : currentGroup
        ));
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
      }));
      if (!isCurrentSearchRequest()) {
        return;
      }
      const nextGroups = searchGroupsRef.current.map((group) => (
        activeSources.includes(group.source) ? { ...group, loading: false } : group
      ));
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
      const resultCount = mergedSearchGroupItemCount(nextGroups);
      const action = remoteSearchActionForSource(requestSearchSource, activeSources.map((source) => resultsBySource[source]).filter(Boolean) as RemoteSearchSourceResult[]);
      if (action) {
        handleRemoteSearchAction(action, () => {
          void runSearchRef.current?.(createNodeSeekRetrySearchOptions({
            filters: requestFilters,
            query,
            searchSource: requestSearchSource
          }));
        });
        return;
      }
      const errors = nextGroups.filter((group) => group.error);
      notify(errors.length
        ? errors.map((group) => `${group.label}：${group.error}`).join('；')
        : `搜索完成：${resultCount} 条结果`);
    } catch (error) {
      if (isCurrentSearchRequest()) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          const message = errorMessage(error);
          requireNodeSeekSearchVerification(message, () => {
            void runSearchRef.current?.(createNodeSeekRetrySearchOptions({
              filters: requestFilters,
              query,
              searchSource: requestSearchSource
            }));
          });
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (isCurrentSearchRequest()) {
        setSearchBusy(false);
      }
      finishAbortableRequest(searchAbortRef, controller);
    }
  }, [
    addRecentSearch,
    clearYaohuoLoginState,
    notify,
    requireNodeSeekSearchVerification,
    handleRemoteSearchAction,
    runRemoteSearchSource,
    searchQuery,
    searchSource,
    sessionViewModels,
    showYaohuoLogin
  ]);

  const loadMoreSearchSource = useCallback(async (source: Source, page: number) => {
    const requestFilters = snapshotSearchFilters(submittedSearchFiltersRef.current);
    const requestSearchSource = submittedSearchSourceRef.current;
    const requestSnapshot = createSearchMoreRequestSnapshot({
      filters: requestFilters,
      page,
      searchSource: requestSearchSource,
      source,
      submittedQuery: submittedSearchQueryRef.current
    });
    if (!requestSnapshot) {
      return;
    }
    const { activeFilter, ownerKey, query, sort, visitedKey } = requestSnapshot;
    const currentGroup = searchGroupsRef.current.find((group) => group.source === source);
    if (!currentGroup || currentGroup.loading || currentGroup.loadingMore || !currentGroup.hasMore) {
      return;
    }
    const markedGroups = searchGroupsRef.current.map((group) => (
      group.source === source ? { ...group, loadingMore: true, error: undefined } : { ...group, loadingMore: false }
    ));
    searchGroupsRef.current = markedGroups;
    setSearchGroups(markedGroups);
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    const requestOwner = startOwnedRequest(searchRequestOwnerRef, ownerKey);
    const isCurrentSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    setSearchBusy(true);
    try {
      const result = await runRemoteSearchSource(source, query, page, controller.signal, sort, activeFilter, { isCurrent: () => isCurrentSearchRequest() });
      if (!isCurrentSearchRequest()) {
        return;
      }
      const data = groupFromRemoteSearchResult(result);
      const nextGroups = searchGroupsRef.current.map((group) => {
        if (group.source !== source) {
          return group;
        }
        const mergedItems = mergeTopics(group.items, data.items);
        const visitedPages = searchVisitedPagesRef.current[visitedKey] || new Set<number>();
        visitedPages.add(page);
        searchVisitedPagesRef.current[visitedKey] = visitedPages;
        const canLoadNext = Boolean(data.hasMore && data.nextPage && !visitedPages.has(data.nextPage));
        return {
          ...data,
          items: mergedItems,
          loading: false,
          loadingMore: false,
          hasMore: canLoadNext,
          nextPage: canLoadNext ? data.nextPage ?? null : null
        };
      });
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
      const updated = nextGroups.find((group) => group.source === source);
      if (result.kind === 'action-required') {
        handleRemoteSearchAction(result.action, () => {
          void runSearchRef.current?.(createNodeSeekRetrySearchOptions({
            filters: requestFilters,
            query,
            searchSource: requestSearchSource
          }));
        });
        return;
      }
      notify(updated?.error ? `${updated.label}：${updated.error}` : `${sourceLabel(source)} 已加载更多`);
    } catch (error) {
      if (isCurrentSearchRequest() && !isCanceledRequest(error)) {
        const nextGroups = searchGroupsRef.current.map((group) => (
          group.source === source ? { ...group, loadingMore: false, error: errorMessage(error) } : group
        ));
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
        notify(errorMessage(error));
      }
    } finally {
      if (isCurrentSearchRequest()) {
        setSearchBusy(false);
      }
      finishAbortableRequest(searchAbortRef, controller);
    }
  }, [handleRemoteSearchAction, notify, runRemoteSearchSource]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    runSearchRef.current = runSearch;
  }, [runSearch, searchQuery]);

  const applySearchFilter = useCallback((source: Source, filter: SourceSearchFilter) => {
    const nextFilters = {
      ...searchFiltersRef.current,
      [source]: filter
    };
    searchFiltersRef.current = nextFilters;
    setSearchFilters(nextFilters);
    const cleanQuery = searchQueryRef.current.trim();
    if (searchSource === source && cleanQuery) {
      void runSearchRef.current?.();
    }
  }, [searchSource]);

  useEffect(() => {
    const cleanQuery = searchQueryRef.current.trim();
    if (!cleanQuery || cleanQuery !== submittedSearchQueryRef.current) {
      return;
    }
    void runSearchRef.current?.();
  }, [searchSource]);

  const retrySearchSource = useCallback((source: Source) => {
    void runSearch(source);
  }, [runSearch]);

  const abortSearchRequests = useCallback(() => {
    searchAbortRef.current?.abort();
  }, []);

  useEffect(() => abortSearchRequests, [abortSearchRequests]);

  return {
    abortSearchRequests,
    applySearchFilter,
    loadMoreSearchSource,
    recentSearches,
    removeRecentSearch,
    retrySearchSource,
    runSearch,
    searchBusy,
    searchFilters,
    searchGroups,
    searchSessionNotices,
    searchQuery,
    searchSource,
    submittedSearchQuery,
    setSearchQuery,
    setSearchSource
  };
}
