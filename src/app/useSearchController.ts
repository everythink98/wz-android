import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { feedSources } from '../feedCategoryRail';
import {
  mergeTopics,
  searchLocal,
  sortTopicsByCreatedAt,
  type SearchSort
} from '../feedLogic';
import { searchTopics } from '../forumApi';
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
import { searchYaohuoDirect } from '../yaohuoApi';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import type { Fetcher } from '../request';
import type { FeedSource, Source, Topic } from '../types';
import type { SearchGroup } from '../searchListItems';
import type { SearchScope } from '../screens/SearchScreen';

const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';

function searchHistoryFromRaw(raw: string | null) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function mergeSearchGroupsToItems(groups: SearchGroup[], searchSource: FeedSource) {
  const merged = groups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []);
  return searchSource === 'all' ? sortTopicsByCreatedAt(merged) : merged;
}

function remoteSearchSort(searchSource: FeedSource, searchSort: SearchSort) {
  return searchSource === 'all'
    ? 'time'
    : searchSource === 'v2ex' && searchSort === 'time'
      ? searchSort
      : 'relevance';
}

export function useSearchController({
  clearYaohuoLoginState,
  fetcher,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  nodeSeekUserAgentRef,
  notify,
  readerData,
  showNodeSeekVerification,
  showYaohuoLogin
}: {
  clearYaohuoLoginState: () => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  readerData: ReaderData;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
}) {
  const searchRequestIdRef = useRef(0);
  const searchRequestOwnerRef = useRef(createRequestOwner('search'));
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchGroupsRef = useRef<SearchGroup[]>([]);
  const searchQueryRef = useRef('');
  const runSearchRef = useRef<((sourceOverride?: Source) => Promise<void>) | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSource, setSearchSource] = useState<FeedSource>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('remote');
  const [searchSort, setSearchSort] = useState<SearchSort>('relevance');
  const [searchItems, setSearchItems] = useState<Topic[]>([]);
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentSearchesLoaded, setRecentSearchesLoaded] = useState(false);

  const visibleSearchItems = useMemo(() => searchItems, [searchItems]);

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
      const next = [
        clean,
        ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())
      ].slice(0, 20);
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((query: string) => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== query);
      return next;
    });
  }, []);

  useEffect(() => {
    searchRequestIdRef.current += 1;
    searchAbortRef.current?.abort();
    setSearchItems([]);
    setSearchGroups([]);
    searchGroupsRef.current = [];
    setSearchBusy(false);
  }, [searchQuery, searchScope, searchSource]);

  const runRemoteSearchSource = useCallback(async (
    source: Source,
    query: string,
    page: number,
    signal: AbortSignal,
    sort: SearchSort = 'relevance',
    options?: { isCurrent?: () => boolean }
  ): Promise<SearchGroup> => {
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(source),
        loadNodeSeekCookieForSource(source)
      ]);
      if (source === 'yaohuo' && !yaohuoCookie) {
        return { source, label: sourceLabel(source), items: [], error: '未登录', hasMore: false, nextPage: null };
      }
      const data = source === 'yaohuo'
        ? await searchYaohuoDirect({ query, page, limit: 30, yaohuoCookie, signal })
        : await searchTopics({
          query,
          source,
          page,
          limit: 30,
          fetcher,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          sort: source === 'v2ex' ? sort : 'relevance',
          signal
        });
      return {
        source,
        label: sourceLabel(source),
        items: data.items,
        error: data.errors?.[source],
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
  }, [clearYaohuoLoginState, fetcher, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekUserAgentRef]);

  const runSearch = useCallback(async (sourceOverride?: Source) => {
    const query = searchQuery.trim();
    if (!query) {
      notify('请输入搜索词');
      return;
    }
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    const requestOwner = startOwnedRequest(searchRequestOwnerRef, `search:${sourceOverride || searchSource}:${searchScope}:${query}:${searchSort}`);
    const isCurrentSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    const activeSources = sourceOverride
      ? [sourceOverride]
      : searchSource === 'all'
        ? feedSources
        : [searchSource as Source];
    const activeSort = remoteSearchSort(searchSource, searchSort);
    if (sourceOverride) {
      const nextGroups = searchGroupsRef.current.map((group) => (
        group.source === sourceOverride ? { ...group, loading: true, loadingMore: false, error: undefined } : { ...group, loading: false, loadingMore: false }
      ));
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
    } else {
      setSearchItems([]);
      const nextGroups = searchScope === 'remote'
        ? activeSources.map((source) => ({ source, label: sourceLabel(source), items: [], loading: true }))
        : [];
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
    }
    setSearchBusy(true);
    try {
      addRecentSearch(query);
      if (searchScope === 'local') {
        if (!isCurrentSearchRequest()) {
          return;
        }
        setSearchItems(searchLocal(readerData, query, searchSource));
        notify('本地搜索完成');
      } else {
        await Promise.all(activeSources.map(async (source) => {
          const group = await runRemoteSearchSource(source, query, 1, controller.signal, activeSort, { isCurrent: () => isCurrentSearchRequest() });
          if (!isCurrentSearchRequest()) {
            return;
          }
          const nextGroups = searchGroupsRef.current.map((currentGroup) => (
            currentGroup.source === source ? { ...group, loading: false } : currentGroup
          ));
          searchGroupsRef.current = nextGroups;
          setSearchGroups(nextGroups);
          setSearchItems(mergeSearchGroupsToItems(nextGroups, searchSource));
        }));
        if (!isCurrentSearchRequest()) {
          return;
        }
        const nextGroups = searchGroupsRef.current.map((group) => (
          activeSources.includes(group.source) ? { ...group, loading: false } : group
        ));
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
        const mergedItems = mergeSearchGroupsToItems(nextGroups, searchSource);
        setSearchItems(mergedItems);
        const nodeSeekError = nextGroups.find((group) => group.source === 'nodeseek')?.error;
        if (nodeSeekError && /Cloudflare|验证/.test(nodeSeekError)) {
          showNodeSeekVerification(nodeSeekError);
          return;
        }
        const errors = nextGroups.filter((group) => group.error);
        notify(errors.length
          ? errors.map((group) => `${group.label}：${group.error}`).join('；')
          : `搜索完成：${mergedItems.length} 条结果`);
      }
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
          showNodeSeekVerification(errorMessage(error));
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
    readerData,
    runRemoteSearchSource,
    searchQuery,
    searchScope,
    searchSort,
    searchSource,
    showNodeSeekVerification,
    showYaohuoLogin
  ]);

  const loadMoreSearchSource = useCallback(async (source: Source, page: number) => {
    const query = searchQuery.trim();
    if (!query || searchScope !== 'remote') {
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
    const requestOwner = startOwnedRequest(searchRequestOwnerRef, `search-more:${source}:${query}:${page}:${searchSort}`);
    const isCurrentSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    setSearchBusy(true);
    try {
      const data = await runRemoteSearchSource(source, query, page, controller.signal, remoteSearchSort(searchSource, searchSort), { isCurrent: () => isCurrentSearchRequest() });
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
      setSearchItems(mergeSearchGroupsToItems(nextGroups, searchSource));
      const updated = nextGroups.find((group) => group.source === source);
      if (updated?.error && source === 'nodeseek' && /Cloudflare|验证/.test(updated.error)) {
        showNodeSeekVerification(updated.error);
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
  }, [notify, runRemoteSearchSource, searchQuery, searchScope, searchSort, searchSource, showNodeSeekVerification]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    runSearchRef.current = runSearch;
  }, [runSearch, searchQuery]);

  useEffect(() => {
    if (searchSource !== 'v2ex' || searchScope !== 'remote') {
      setSearchSort('relevance');
    }
  }, [searchScope, searchSource]);

  useEffect(() => {
    if (!searchQueryRef.current.trim()) {
      return;
    }
    void runSearchRef.current?.();
  }, [searchSource, searchScope, searchSort]);

  const retrySearchSource = useCallback((source: Source) => {
    void runSearch(source);
  }, [runSearch]);

  const abortSearchRequests = useCallback(() => {
    searchAbortRef.current?.abort();
  }, []);

  useEffect(() => abortSearchRequests, [abortSearchRequests]);

  return {
    abortSearchRequests,
    loadMoreSearchSource,
    recentSearches,
    removeRecentSearch,
    retrySearchSource,
    runSearch,
    searchBusy,
    searchGroups,
    searchQuery,
    searchScope,
    searchSort,
    searchSource,
    setSearchQuery,
    setSearchScope,
    setSearchSort,
    setSearchSource,
    visibleSearchItems
  };
}
