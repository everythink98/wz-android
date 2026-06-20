import { useCallback, useEffect, useRef, useState } from 'react';
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
import { normalizeSearchHistory, searchHistoryFromRaw } from '../searchHistory';
import { searchTopics, searchYaohuoDirect } from '../sources/sourceGateway';
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
import { sourceErrorMessage, sourceErrorRequiresVerification } from '../sourceErrors';
import type { Category, FeedSource, Source, Topic } from '../types';
import type { SearchGroup } from '../searchListItems';

const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';

function mergedSearchGroupItemCount(groups: SearchGroup[]) {
  const merged = groups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []);
  return merged.length;
}

function remoteSearchSort(searchSource: FeedSource, searchFilters: SearchFilterState) {
  return searchSource === 'all'
    ? 'time'
    : searchSource === 'v2ex' && searchFilters.v2ex.sort === 'time'
      ? searchFilters.v2ex.sort
      : 'relevance';
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
  showNodeSeekVerification,
  showYaohuoLogin
}: {
  categories: Category[];
  clearYaohuoLoginState: () => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onNodeSeekSearchVerificationRequired?: (message: string, retry: () => void) => void;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
}) {
  const searchRequestIdRef = useRef(0);
  const searchRequestOwnerRef = useRef(createRequestOwner('search'));
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchGroupsRef = useRef<SearchGroup[]>([]);
  const searchQueryRef = useRef('');
  const submittedSearchQueryRef = useRef('');
  const searchFiltersRef = useRef<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const runSearchRef = useRef<((sourceOverride?: Source) => Promise<void>) | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState('');
  const [searchSource, setSearchSource] = useState<FeedSource>('all');
  const [searchFilters, setSearchFilters] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentSearchesLoaded, setRecentSearchesLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (active) {
          setRecentSearches(searchHistoryFromRaw(raw));
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
    void AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(recentSearches)).catch(() => undefined);
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
  ): Promise<SearchGroup> => {
    try {
      const activeFilter = filter?.source === source ? filter : undefined;
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(source),
        loadNodeSeekCookieForSource(source)
      ]);
      if (source === 'yaohuo' && !yaohuoCookie) {
        return { source, label: sourceLabel(source), items: [], error: '未登录', hasMore: false, nextPage: null };
      }
      const searchLimit = source === 'linuxdo' ? 50 : 30;
      const data = source === 'yaohuo'
        ? await searchYaohuoDirect({
          query,
          page,
          limit: searchLimit,
          category: activeFilter?.source === 'yaohuo' ? activeFilter.category : undefined,
          yaohuoCookie,
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
      return {
        source,
        label: sourceLabel(source),
        items: data.items,
        error: sourceErrorMessage(sourceError) || undefined,
        verificationRequired: sourceErrorRequiresVerification(sourceError),
        hasMore: Boolean(data.hasMore && data.nextPage),
        nextPage: data.nextPage ?? null
      };
    } catch (error) {
      if (isCanceledRequest(error)) {
        throw error;
      }
      if (source === 'yaohuo' && isYaohuoLoginRequiredError(error)) {
        if (isYaohuoLoginExpiredError(error)) {
          if (options?.isCurrent?.() !== false) {
            await clearYaohuoLoginState();
          }
          return { source, label: sourceLabel(source), items: [], error: '登录已失效', hasMore: false, nextPage: null };
        }
        return { source, label: sourceLabel(source), items: [], error: errorMessage(error), hasMore: false, nextPage: null };
      }
      return { source, label: sourceLabel(source), items: [], error: errorMessage(error), hasMore: false, nextPage: null };
    }
  }, [categories, clearYaohuoLoginState, fetcher, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekUserAgentRef]);

  const runSearch = useCallback(async (sourceOverride?: Source) => {
    const query = searchQuery.trim();
    if (!query) {
      notify('请输入搜索词');
      return;
    }
    submittedSearchQueryRef.current = query;
    setSubmittedSearchQuery(query);
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    const activeFilter = searchSource === 'all'
      ? undefined
      : searchFiltersRef.current[(sourceOverride || searchSource) as Source];
    const requestFilter = searchSource === 'all' ? undefined : activeFilter;
    const requestOwner = startOwnedRequest(searchRequestOwnerRef, `search:${sourceOverride || searchSource}:${query}:${JSON.stringify(activeFilter || {})}`);
    const isCurrentSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    const activeSources = sourceOverride
      ? [sourceOverride]
      : searchSource === 'all'
        ? feedSources
        : [searchSource as Source];
    const activeSort = remoteSearchSort(searchSource, searchFiltersRef.current);
    if (sourceOverride) {
      const nextGroups = searchGroupsRef.current.map((group) => (
        group.source === sourceOverride ? { ...group, loading: true, loadingMore: false, error: undefined } : { ...group, loading: false, loadingMore: false }
      ));
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
    } else {
      const nextGroups = activeSources.map((source) => ({ source, label: sourceLabel(source), items: [], loading: true }));
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
    }
    setSearchBusy(true);
    try {
      addRecentSearch(query);
      await Promise.all(activeSources.map(async (source) => {
        const group = await runRemoteSearchSource(source, query, 1, controller.signal, activeSort, requestFilter, { isCurrent: () => isCurrentSearchRequest() });
        if (!isCurrentSearchRequest()) {
          return;
        }
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
      const nodeSeekGroup = nextGroups.find((group) => group.source === 'nodeseek');
      if (nodeSeekGroup?.verificationRequired && nodeSeekGroup.error) {
        requireNodeSeekSearchVerification(nodeSeekGroup.error, () => { void runSearchRef.current?.('nodeseek'); });
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
          requireNodeSeekSearchVerification(message, () => { void runSearchRef.current?.('nodeseek'); });
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
    runRemoteSearchSource,
    searchQuery,
    searchSource,
    showYaohuoLogin
  ]);

  const loadMoreSearchSource = useCallback(async (source: Source, page: number) => {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }
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
    const activeFilter = searchSource === 'all' ? undefined : searchFiltersRef.current[source];
    const requestOwner = startOwnedRequest(searchRequestOwnerRef, `search-more:${source}:${query}:${page}:${JSON.stringify(activeFilter || {})}`);
    const isCurrentSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    setSearchBusy(true);
    try {
      const data = await runRemoteSearchSource(source, query, page, controller.signal, remoteSearchSort(searchSource, searchFiltersRef.current), activeFilter, { isCurrent: () => isCurrentSearchRequest() });
      if (!isCurrentSearchRequest()) {
        return;
      }
      const nextGroups = searchGroupsRef.current.map((group) => {
        if (group.source !== source) {
          return group;
        }
        const mergedItems = mergeTopics(group.items, data.items);
        return {
          ...data,
          items: mergedItems,
          loading: false,
          loadingMore: false,
          hasMore: Boolean(data.hasMore && data.nextPage && mergedItems.length > group.items.length)
        };
      });
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
      const updated = nextGroups.find((group) => group.source === source);
      if (updated?.error && source === 'nodeseek' && updated.verificationRequired) {
        requireNodeSeekSearchVerification(updated.error, () => { void runSearchRef.current?.('nodeseek'); });
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
  }, [notify, requireNodeSeekSearchVerification, runRemoteSearchSource, searchQuery, searchSource]);

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
    searchQuery,
    searchSource,
    submittedSearchQuery,
    setSearchQuery,
    setSearchSource
  };
}
