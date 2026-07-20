import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isCancelledError } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { aggregateSearchSources } from '../sourceCatalog';
import {
  mergeTopics,
  type SearchSort
} from '../feedLogic';
import {
  buildDiscourseSearchQuery,
  DEFAULT_SEARCH_FILTERS,
  type SearchFilterState,
  type SourceSearchFilter
} from '../searchFilters';
import { mergeLoadedSearchHistory, normalizeSearchHistory, sameSearchHistory } from '../searchHistory';
import type { SourceGateway, SourceGatewayReadContext } from '../sources/sourceGateway';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticReason
} from '../diagnostics';
import { isCanceledRequest, sourceLabel } from '../appUtils';
import { sourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { sourceErrorFromUnknown, yaohuoErrorRequiresLoginPanel } from '../sourceErrors';
import { authNoticeForSource, authNoticeForSourceError, searchSessionNoticeItems } from '../siteSessionPrompts';
import type { SiteSessionViewModels } from '../siteSessionState';
import type { Category, FeedSource, Source, SourceErrorInfo, Topic } from '../types';
import type { DiscourseSource } from '../sourceCatalog';
import type { SearchGroup } from '../searchListItems';
import { useCommitRefValue } from './useCommittedRef';
import {
  createSearchHistoryWriteQueue,
  createNodeSeekRetrySearchOptions,
  createSearchMoreRequestSnapshot,
  enqueueSearchHistoryWrite,
  groupFromRemoteSearchResult,
  linuxDoAiFailureState,
  mergeLinuxDoAiTopics,
  remoteSearchSort,
  remoteSearchActionForSource,
  snapshotSearchFilters,
  type LinuxDoAiSearchState,
  type RemoteSearchAction,
  type RemoteSearchSourceResult,
  type SearchRunOptions
} from '../searchControllerResults';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
import {
  appQueryClient,
  forumQueryKeys,
  subscribeForumSourceResets
} from './serverState';

const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';
type SearchRunInput = Source | (Partial<SearchRunOptions> & { suppressLinuxDoVerification?: boolean });

function mergedSearchGroupItemCount(groups: SearchGroup[]) {
  const merged = groups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []);
  return merged.length;
}

function remoteSearchResult(group: SearchGroup): RemoteSearchSourceResult {
  return group.error ? { kind: 'failed', group } : { kind: 'success', group };
}

function diagnosticReasonForSearchError(error?: SourceErrorInfo): DiagnosticReason {
  if (error?.kind === 'login-required' || error?.kind === 'login-expired') return 'login_required';
  if (error?.kind === 'verification-required') return 'verification_required';
  if (error?.kind === 'permission-denied') return 'permission_denied';
  return error ? normalizeDiagnosticReason(error.message) : 'unknown';
}

function isCanceledSearchQuery(error: unknown) {
  return isCancelledError(error) || isCanceledRequest(error);
}

export function hasNextSearchPage(hasMore: boolean | undefined, nextPage: number | null | undefined, requestedPage: number) {
  return Boolean(hasMore && nextPage && nextPage !== requestedPage);
}

export function useSearchController({
  categories,
  notify,
  onNodeSeekSearchVerificationRequired,
  sessionViewModels,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  categories: Category[];
  notify: (message: string) => void;
  onNodeSeekSearchVerificationRequired?: (message: string, retry: () => void) => void;
  sessionViewModels: SiteSessionViewModels;
  showLinuxDoVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void | Promise<void>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
}) {
  const searchRecoveryGenerationRef = useRef(0);
  const activeSearchRecoveryRef = useRef<{
    key: string;
    lane: 'root' | 'more';
    source: Source;
  } | null>(null);
  const linuxDoAiGenerationRef = useRef(0);
  const linuxDoAiQueryRef = useRef('');
  const searchGroupsRef = useRef<SearchGroup[]>([]);
  const searchQueryRef = useRef('');
  const submittedSearchQueryRef = useRef('');
  const submittedSearchFiltersRef = useRef<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const submittedSearchSourceRef = useRef<FeedSource>('all');
  const searchFiltersRef = useRef<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const runSearchRef = useRef<((options?: SearchRunInput) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const loadMoreSearchSourceRef = useRef<((source: Source, page: number, suppressLinuxDoVerification?: boolean) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const recentSearchWriteQueueRef = useRef(createSearchHistoryWriteQueue());
  const lastSavedRecentSearchesRef = useRef<string[] | null>(null);
  const recentSearchHistoryHydratedRef = useRef(false);
  const recentSearchHistoryReadFailedRef = useRef(false);
  const pendingRecentSearchRemovalKeysRef = useRef(new Set<string>());
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState('');
  const [searchSource, setSearchSource] = useState<FeedSource>('all');
  const [searchFilters, setSearchFilters] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [linuxDoAiItems, setLinuxDoAiItems] = useState<Topic[]>([]);
  const [linuxDoAiState, setLinuxDoAiState] = useState<LinuxDoAiSearchState>({ status: 'idle', enabled: false, count: 0 });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentSearchesHydrated, setRecentSearchesHydrated] = useState(false);
  const [recentSearchHistoryReadAttempt, setRecentSearchHistoryReadAttempt] = useState(0);
  const searchSessionNotices = useMemo(() => (
    searchSessionNoticeItems(searchSource, sessionViewModels)
  ), [searchSource, sessionViewModels]);

  useEffect(() => {
    let active = true;
    recentSearchHistoryReadFailedRef.current = false;
    AsyncStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (active) {
          const storedHistory = mergeLoadedSearchHistory([], raw);
          const removedKeys = new Set(pendingRecentSearchRemovalKeysRef.current);
          recentSearchHistoryHydratedRef.current = true;
          pendingRecentSearchRemovalKeysRef.current.clear();
          lastSavedRecentSearchesRef.current = storedHistory;
          setRecentSearches((current) => {
            const merged = mergeLoadedSearchHistory(current, raw)
              .filter((item) => !removedKeys.has(item.toLowerCase()));
            return sameSearchHistory(current, merged) ? current : merged;
          });
          setRecentSearchesHydrated(true);
        }
      })
      .catch(() => {
        if (active) {
          recentSearchHistoryReadFailedRef.current = true;
        }
      });
    return () => {
      active = false;
    };
  }, [recentSearchHistoryReadAttempt]);

  useEffect(() => {
    if (!recentSearchesHydrated) {
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
  }, [recentSearches, recentSearchesHydrated]);

  const retryRecentSearchHistoryRead = useCallback(() => {
    if (!recentSearchHistoryHydratedRef.current && recentSearchHistoryReadFailedRef.current) {
      recentSearchHistoryReadFailedRef.current = false;
      setRecentSearchHistoryReadAttempt((current) => current + 1);
    }
  }, []);

  const addRecentSearch = useCallback((query: string) => {
    const clean = query.trim();
    if (!clean) {
      return;
    }
    pendingRecentSearchRemovalKeysRef.current.delete(clean.toLowerCase());
    retryRecentSearchHistoryRead();
    setRecentSearches((current) => {
      return normalizeSearchHistory([
        clean,
        ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())
      ]);
    });
  }, [retryRecentSearchHistoryRead]);

  const removeRecentSearch = useCallback((query: string) => {
    if (!recentSearchHistoryHydratedRef.current) {
      pendingRecentSearchRemovalKeysRef.current.add(query.toLowerCase());
    }
    retryRecentSearchHistoryRead();
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== query);
      return next;
    });
  }, [retryRecentSearchHistoryRead]);

  const clearLinuxDoAiSearch = useCallback(() => {
    linuxDoAiGenerationRef.current += 1;
    void appQueryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[2] === 'semantic-search'
    });
    linuxDoAiQueryRef.current = '';
    setLinuxDoAiItems([]);
    setLinuxDoAiState({ status: 'idle', enabled: false, count: 0 });
  }, []);

  const runLinuxDoAiSearch = useCallback((fullQuery: string) => {
    const requestGeneration = ++linuxDoAiGenerationRef.current;
    const trace = beginDiagnosticTrace('search', 'searchSemanticTopics', { source: 'linuxdo' });
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
    let querySignal: AbortSignal | undefined;
    const isCurrent = () => requestGeneration === linuxDoAiGenerationRef.current && !querySignal?.aborted;
    const queryKey = forumQueryKeys.semanticSearch('linuxdo', fullQuery);
    linuxDoAiQueryRef.current = fullQuery;
    setLinuxDoAiItems([]);
    setLinuxDoAiState({ status: 'loading', enabled: false, count: 0 });
    markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'started' });
    void (async () => {
      try {
        const result = await appQueryClient.fetchQuery({
          queryKey,
          queryFn: async ({ signal }) => {
            querySignal = signal;
            const result = await sourceGateway.searchSemanticTopics({
              source: 'linuxdo',
              query: fullQuery,
              signal
            }, { trace, isCurrent: () => !signal.aborted });
            if (!result) {
              throw new Error('AI 搜索未返回结果');
            }
            return result;
          }
        });
        if (!isCurrent()) {
          finishTrace(querySignal?.aborted ? 'canceled' : 'stale', {
            source: 'linuxdo',
            reason: querySignal?.aborted ? 'canceled' : 'superseded'
          });
          return;
        }
        markDiagnosticStage(trace, 'apply', { source: 'linuxdo', itemCount: result.items.length });
        setLinuxDoAiItems(result.items);
        setLinuxDoAiState(result.items.length
          ? { status: 'ready', enabled: false, count: result.items.length }
          : { status: 'empty', enabled: false, count: 0, message: '未找到 AI 结果' });
        finishTrace('success', { source: 'linuxdo', itemCount: result.items.length });
      } catch (error) {
        if (isCanceledSearchQuery(error)) {
          finishTrace('canceled', { source: 'linuxdo', reason: 'canceled' });
          return;
        }
        if (requestGeneration !== linuxDoAiGenerationRef.current) {
          finishTrace('stale', { source: 'linuxdo', reason: 'superseded' });
          return;
        }
        const sourceError = sourceErrorFromUnknown('linuxdo', error);
        const reason = diagnosticReasonForSearchError(sourceError);
        setLinuxDoAiItems([]);
        setLinuxDoAiState(linuxDoAiFailureState(error));
        finishTrace(
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source: 'linuxdo', reason }
        );
      } finally {
        if (!traceFinished) {
          finishTrace(isCurrent() ? 'failure' : querySignal?.aborted ? 'canceled' : 'stale', {
            source: 'linuxdo',
            reason: isCurrent() ? 'unknown' : querySignal?.aborted ? 'canceled' : 'superseded'
          });
        }
      }
    })();
  }, [sourceGateway]);

  useEffect(() => subscribeForumSourceResets(({ source, preserveRecoveryKey }) => {
    const activeRecovery = activeSearchRecoveryRef.current;
    const preservedRecovery = activeRecovery
      && activeRecovery.key === preserveRecoveryKey
      && activeRecovery.source === source
      ? activeRecovery
      : null;
    if (submittedSearchSourceRef.current === source && !preservedRecovery) {
      searchRecoveryGenerationRef.current += 1;
      setSearchBusy(false);
    }
    if (!preservedRecovery) {
      activeSearchRecoveryRef.current = null;
    }
    const nextGroups = preservedRecovery
      ? searchGroupsRef.current.map((group) => group.source === source
        ? preservedRecovery.lane === 'more'
          ? { ...group, loading: false, loadingMore: false, error: undefined, errorKind: undefined }
          : { ...group, items: [], loading: false, loadingMore: false, error: undefined, errorKind: undefined, hasMore: false, nextPage: null }
        : group)
      : searchGroupsRef.current.filter((group) => group.source !== source);
    searchGroupsRef.current = nextGroups;
    setSearchGroups(nextGroups);
    if (source === 'linuxdo') {
      clearLinuxDoAiSearch();
    }
  }), [clearLinuxDoAiSearch]);

  const clearSearchResults = useCallback(() => {
    searchRecoveryGenerationRef.current += 1;
    void appQueryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[2] === 'search'
    });
    setSearchGroups([]);
    searchGroupsRef.current = [];
    setSearchBusy(false);
    clearLinuxDoAiSearch();
  }, [clearLinuxDoAiSearch]);

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

  useEffect(() => {
    if (!sessionViewModels.linuxdo.isLoggedIn) {
      clearLinuxDoAiSearch();
    }
  }, [clearLinuxDoAiSearch, sessionViewModels.linuxdo.isLoggedIn]);

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
    options?: SourceGatewayReadContext
  ): Promise<RemoteSearchSourceResult> => {
    const sourceStatusNotice = authNoticeForSource(source, sessionViewModels, 'search') || undefined;
    try {
      const activeFilter = filter?.source === source ? filter : undefined;
      const searchLimit = source === 'linuxdo' ? 50 : 30;
      const data = await sourceGateway.searchTopics({
        query,
        source,
        page,
        limit: searchLimit,
        categories,
        sort: source === 'v2ex' ? sort : 'relevance',
        filter: activeFilter,
        signal
      }, options);
      const parserSummary = sourceDiagnosticSummary(data);
      const sourceError = data.errors?.[source] || (parserSummary?.isParseEmpty ? {
        kind: 'ordinary' as const,
        message: '搜索结果返回内容无法解析，请重试。',
        reason: 'parse_empty',
        retryable: true
      } : undefined);
      const sourceErrorText = sourceError?.message || undefined;
      const group = {
        source,
        label: sourceLabel(source),
        items: data.items,
        authNotice: sourceError ? authNoticeForSourceError(sourceError) || undefined : sourceStatusNotice,
        error: sourceErrorText,
        errorKind: sourceError?.kind,
        hasMore: sourceErrorText ? false : Boolean(data.hasMore && data.nextPage),
        nextPage: sourceErrorText ? null : data.nextPage ?? null
      };
      if (source === 'nodeseek' && group.errorKind === 'verification-required' && group.error) {
        return { kind: 'action-required', group, action: { type: 'nodeseek-verification', message: group.error } };
      }
      if (source === 'linuxdo' && group.errorKind === 'verification-required' && group.error) {
        return { kind: 'action-required', group, action: { type: 'linuxdo-verification', message: group.error } };
      }
      return remoteSearchResult(group);
    } catch (error) {
      if (isCanceledRequest(error)) {
        throw error;
      }
      const sourceError = sourceErrorFromUnknown(source, error);
      const message = sourceError.message;
      if (source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
        const group = { source, label: sourceLabel(source), items: [], error: message, errorKind: sourceError.kind, authNotice: authNoticeForSourceError(sourceError) || sourceStatusNotice, hasMore: false, nextPage: null };
        return { kind: 'action-required', group, action: { type: 'yaohuo-login', message } };
      }
      if (source === 'nodeseek' && sourceError.kind === 'verification-required') {
        const group = { source, label: sourceLabel(source), items: [], error: message, errorKind: sourceError.kind, authNotice: authNoticeForSourceError(sourceError) || sourceStatusNotice, hasMore: false, nextPage: null };
        return { kind: 'action-required', group, action: { type: 'nodeseek-verification', message } };
      }
      if (source === 'linuxdo' && sourceError.kind === 'verification-required') {
        const group = { source, label: sourceLabel(source), items: [], error: message, errorKind: sourceError.kind, authNotice: authNoticeForSourceError(sourceError) || sourceStatusNotice, hasMore: false, nextPage: null };
        return { kind: 'action-required', group, action: { type: 'linuxdo-verification', message } };
      }
      return { kind: 'failed', group: { source, label: sourceLabel(source), items: [], error: message, errorKind: sourceError.kind, authNotice: authNoticeForSourceError(sourceError) || undefined, hasMore: false, nextPage: null } };
    }
  }, [categories, sessionViewModels, sourceGateway]);

  const handleRemoteSearchAction = useCallback((action: RemoteSearchAction, retryNodeSeek = () => { void runSearchRef.current?.('nodeseek'); }) => {
    if (action.type === 'yaohuo-login') {
      showYaohuoLogin(action.message);
      return;
    }
    if (action.type === 'linuxdo-verification') {
      return;
    }
    requireNodeSeekSearchVerification(action.message, retryNodeSeek);
  }, [requireNodeSeekSearchVerification, showYaohuoLogin]);

  const runSearch = useCallback(async (options?: SearchRunInput): Promise<LinuxDoReadResumeOutcome> => {
    const runOptions: Partial<SearchRunOptions> & { sourceOverride?: Source; suppressLinuxDoVerification?: boolean } = typeof options === 'string' ? { sourceOverride: options } : options || {};
    const query = (runOptions.query ?? searchQuery).trim();
    const requestSearchSource = runOptions.source ?? searchSource;
    const trace = beginDiagnosticTrace('search', 'run', {
      source: runOptions.sourceOverride || requestSearchSource,
      hasQuery: Boolean(query)
    });
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
    if (!query) {
      markDiagnosticStage(trace, 'guard', { state: 'missing-query' });
      finishTrace('blocked', { reason: 'not_ready' });
      notify('请输入搜索词');
      return 'completed';
    }
    if (runOptions.query !== undefined && searchQueryRef.current !== query) {
      searchQueryRef.current = query;
      setSearchQuery(query);
    }
    if (runOptions.source !== undefined && runOptions.source !== searchSource) {
      setSearchSource(runOptions.source);
    }
    const requestFilters = runOptions.filters ?? searchFiltersRef.current;
    const sourceOverride = runOptions.sourceOverride;
    if (!sourceOverride) {
      clearLinuxDoAiSearch();
      const linuxDoFilter = requestFilters.linuxdo;
      if (requestSearchSource === 'linuxdo' && sessionViewModels.linuxdo.isLoggedIn && linuxDoFilter.order === 'relevance') {
        runLinuxDoAiSearch(buildDiscourseSearchQuery(query, linuxDoFilter, categories));
      }
    }
    submittedSearchQueryRef.current = query;
    submittedSearchFiltersRef.current = snapshotSearchFilters(requestFilters);
    submittedSearchSourceRef.current = requestSearchSource;
    setSubmittedSearchQuery(query);
    const requestGeneration = ++searchRecoveryGenerationRef.current;
    activeSearchRecoveryRef.current = null;
    const activeFilter = requestSearchSource === 'all'
      ? undefined
      : requestFilters[(sourceOverride || requestSearchSource) as Source];
    const requestFilter = requestSearchSource === 'all' ? undefined : activeFilter;
    let recoveryGeneration = requestGeneration;
    const isCurrentSearchRequest = () => searchRecoveryGenerationRef.current === requestGeneration;
    const isCurrentSearchRecovery = () => (
      searchRecoveryGenerationRef.current === recoveryGeneration
    );
    const linuxDoRecovery = (): LinuxDoReadRecovery => ({
      key: `search:${sourceOverride || requestSearchSource}:${query}:${JSON.stringify(activeFilter || {})}`,
      isCurrent: isCurrentSearchRecovery,
      resume: async () => {
        if (!isCurrentSearchRecovery()) {
          return 'stale';
        }
        const resumedRequest = runSearchRef.current?.({
          filters: snapshotSearchFilters(requestFilters),
          query,
          source: requestSearchSource,
          sourceOverride: 'linuxdo',
          suppressLinuxDoVerification: true
        });
        if (!resumedRequest) {
          return 'stale';
        }
        const outcome = await resumedRequest;
        recoveryGeneration = searchRecoveryGenerationRef.current;
        return outcome;
      }
    });
    const activeSources = sourceOverride
      ? [sourceOverride]
      : requestSearchSource === 'all'
        ? aggregateSearchSources
        : [requestSearchSource as Source];
    const activeSort = remoteSearchSort(requestSearchSource, requestFilters);
    markDiagnosticStage(trace, 'guard', {
      source: sourceOverride || requestSearchSource,
      state: sourceOverride ? 'retry' : 'started',
      count: activeSources.length
    });
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
        const sourceFilter = requestFilter?.source === source ? requestFilter : undefined;
        const requestKey = JSON.stringify({ query, page: 1, sort: activeSort, filter: sourceFilter || null });
        const queryKey = forumQueryKeys.search(source, requestKey);
        if (sourceOverride) {
          void appQueryClient.cancelQueries({ queryKey, exact: true });
          appQueryClient.removeQueries({ queryKey, exact: true });
        }
        let result: RemoteSearchSourceResult;
        try {
          result = await appQueryClient.fetchQuery({
            queryKey,
            staleTime: 0,
            queryFn: ({ signal }) => runRemoteSearchSource(source, query, 1, signal, activeSort, sourceFilter, {
              isCurrent: () => !signal.aborted,
              trace
            })
          });
        } catch (error) {
          if (
            isCanceledSearchQuery(error)
            && requestSearchSource === 'all'
            && !sourceOverride
            && isCurrentSearchRequest()
          ) {
            markDiagnosticStage(trace, 'apply', {
              source,
              state: 'session-reset'
            });
            return;
          }
          throw error;
        }
        if (!isCurrentSearchRequest()) {
          return;
        }
        if (result.kind !== 'success') {
          appQueryClient.removeQueries({ queryKey, exact: true });
        }
        resultsBySource[source] = result;
        const group = groupFromRemoteSearchResult(result);
        const beforeCount = searchGroupsRef.current.find((currentGroup) => currentGroup.source === source)?.items.length || 0;
        markDiagnosticStage(trace, 'apply', {
          source,
          beforeCount,
          afterCount: group.items.length,
          itemCount: group.items.length,
          hasMore: Boolean(group.hasMore)
        });
        const nextGroups = searchGroupsRef.current.map((currentGroup) => {
          if (currentGroup.source !== source) {
            return currentGroup;
          }
          if (sourceOverride && result.kind !== 'success' && group.items.length === 0) {
            return {
              ...group,
              items: currentGroup.items,
              authNotice: group.authNotice || currentGroup.authNotice,
              hasMore: currentGroup.hasMore,
              nextPage: currentGroup.nextPage,
              loading: false
            };
          }
          return { ...group, loading: false };
        });
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
      }));
      if (!isCurrentSearchRequest()) {
        finishTrace('stale', {
          source: sourceOverride || requestSearchSource,
          reason: 'superseded'
        });
        return 'stale';
      }
      const nextGroups = searchGroupsRef.current.map((group) => (
        activeSources.includes(group.source) ? { ...group, loading: false } : group
      ));
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
      const resultCount = mergedSearchGroupItemCount(nextGroups);
      const action = remoteSearchActionForSource(sourceOverride || requestSearchSource, activeSources.map((source) => resultsBySource[source]).filter(Boolean) as RemoteSearchSourceResult[]);
      if (action) {
        if (action.type === 'linuxdo-verification') {
          finishTrace(resultCount ? 'partial' : 'blocked', {
            source: 'linuxdo',
            reason: 'verification_required',
            itemCount: resultCount
          });
          if (requestSearchSource === 'linuxdo' && !runOptions.suppressLinuxDoVerification) {
            const recovery = linuxDoRecovery();
            activeSearchRecoveryRef.current = { key: recovery.key, lane: 'root', source: 'linuxdo' };
            await showLinuxDoVerification(action.message, recovery);
          }
          return requestSearchSource === 'linuxdo' ? 'verification-required' : 'completed';
        }
        handleRemoteSearchAction(action, () => {
          void runSearchRef.current?.(createNodeSeekRetrySearchOptions({
            filters: requestFilters,
            query,
            searchSource: requestSearchSource
          }));
        });
        finishTrace(resultCount ? 'partial' : 'blocked', {
          source: sourceOverride || requestSearchSource,
          reason: action.type === 'nodeseek-verification' ? 'verification_required' : 'login_required',
          itemCount: resultCount
        });
        return 'completed';
      }
      const errors = nextGroups.filter((group) => activeSources.includes(group.source) && group.error);
      if (errors.length) {
        notify(errors.map((group) => `${group.label}：${group.error}`).join('；'));
      }
      if (errors.length) {
        const reason = diagnosticReasonForSearchError(errors[0]?.errorKind ? {
          kind: errors[0].errorKind,
          message: errors[0].error || ''
        } : undefined);
        finishTrace(
          resultCount ? 'partial' : reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source: sourceOverride || requestSearchSource, reason, itemCount: resultCount, partialErrorCount: errors.length }
        );
        return requestSearchSource === 'all' && !sourceOverride && resultCount ? 'completed' : 'failed';
      } else {
        finishTrace('success', { source: sourceOverride || requestSearchSource, itemCount: resultCount });
      }
      return 'completed';
    } catch (error) {
      if (isCanceledSearchQuery(error)) {
        finishTrace(isCurrentSearchRequest() ? 'canceled' : 'stale', {
          source: sourceOverride || requestSearchSource,
          reason: isCurrentSearchRequest() ? 'canceled' : 'superseded'
        });
        return 'stale';
      } else if (!isCurrentSearchRequest()) {
        finishTrace('stale', { source: sourceOverride || requestSearchSource, reason: 'superseded' });
        return 'stale';
      } else {
        const failureSource = sourceOverride || requestSearchSource;
        const sourceError = sourceErrorFromUnknown(failureSource, error);
        const reason = diagnosticReasonForSearchError(sourceError);
        const outcome = reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied'
          ? 'blocked'
          : 'failure';
        if (failureSource === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(sourceError.message);
          }
          finishTrace(outcome, { source: failureSource, reason });
          return 'completed';
        }
        if (failureSource === 'nodeseek' && sourceError.kind === 'verification-required') {
          requireNodeSeekSearchVerification(sourceError.message, () => {
            void runSearchRef.current?.(createNodeSeekRetrySearchOptions({
              filters: requestFilters,
              query,
              searchSource: requestSearchSource
            }));
          });
          finishTrace(outcome, { source: failureSource, reason });
          return 'completed';
        }
        if (failureSource === 'linuxdo' && sourceError.kind === 'verification-required') {
          finishTrace(outcome, { source: failureSource, reason });
          if (requestSearchSource === 'linuxdo' && !runOptions.suppressLinuxDoVerification) {
            const recovery = linuxDoRecovery();
            activeSearchRecoveryRef.current = { key: recovery.key, lane: 'root', source: 'linuxdo' };
            await showLinuxDoVerification(sourceError.message, recovery);
          }
          return requestSearchSource === 'linuxdo' ? 'verification-required' : 'completed';
        }
        notify(sourceError.message);
        finishTrace(outcome, { source: failureSource, reason });
        return 'failed';
      }
    } finally {
      if (!traceFinished) {
        finishTrace(isCurrentSearchRequest() ? 'failure' : 'stale', {
          source: sourceOverride || requestSearchSource,
          reason: isCurrentSearchRequest() ? 'unknown' : 'superseded'
        });
      }
      if (isCurrentSearchRequest()) {
        setSearchBusy(false);
      }
    }
  }, [
    addRecentSearch,
    categories,
    clearLinuxDoAiSearch,
    notify,
    requireNodeSeekSearchVerification,
    handleRemoteSearchAction,
    runRemoteSearchSource,
    runLinuxDoAiSearch,
    searchQuery,
    searchSource,
    sessionViewModels,
    showLinuxDoVerification,
    showYaohuoLogin
  ]);

  const loadMoreSearchSource = useCallback(async (
    source: Source,
    page: number,
    suppressLinuxDoVerification = false
  ): Promise<LinuxDoReadResumeOutcome> => {
    const trace = beginDiagnosticTrace('search', 'load-more', { source, page });
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
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
      markDiagnosticStage(trace, 'guard', { source, state: 'missing-snapshot' });
      finishTrace('blocked', { source, reason: 'not_ready' });
      return 'completed';
    }
    const { activeFilter, ownerKey, query, sort } = requestSnapshot;
    const currentGroup = searchGroupsRef.current.find((group) => group.source === source);
    if (!currentGroup || currentGroup.loading || currentGroup.loadingMore || !currentGroup.hasMore) {
      const busy = Boolean(currentGroup?.loading || currentGroup?.loadingMore);
      markDiagnosticStage(trace, 'guard', {
        source,
        state: !currentGroup ? 'missing-group' : busy ? 'busy' : 'complete'
      });
      finishTrace(busy ? 'blocked' : currentGroup ? 'noop' : 'blocked', {
        source,
        ...(busy ? { reason: 'busy' } : currentGroup ? {} : { reason: 'not_ready' })
      });
      return 'completed';
    }
    markDiagnosticStage(trace, 'guard', { source, state: 'load-more', page });
    const markedGroups = searchGroupsRef.current.map((group) => (
      group.source === source ? { ...group, loadingMore: true, error: undefined } : { ...group, loadingMore: false }
    ));
    searchGroupsRef.current = markedGroups;
    setSearchGroups(markedGroups);
    const requestGeneration = ++searchRecoveryGenerationRef.current;
    activeSearchRecoveryRef.current = null;
    let recoveryGeneration = requestGeneration;
    let querySignal: AbortSignal | undefined;
    const isLatestSearchRequest = () => searchRecoveryGenerationRef.current === requestGeneration;
    const isCurrentSearchRequest = () => isLatestSearchRequest() && !querySignal?.aborted;
    const isCurrentSearchRecovery = () => (
      searchRecoveryGenerationRef.current === recoveryGeneration
    );
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: ownerKey,
      isCurrent: isCurrentSearchRecovery,
      resume: async () => {
        if (!isCurrentSearchRecovery()) {
          return 'stale';
        }
        const resumedRequest = loadMoreSearchSourceRef.current?.(source, page, true);
        if (!resumedRequest) {
          return 'stale';
        }
        const outcome = await resumedRequest;
        recoveryGeneration = searchRecoveryGenerationRef.current;
        return outcome;
      }
    };
    const queryKey = forumQueryKeys.search(source, ownerKey);
    setSearchBusy(true);
    try {
      const result = await appQueryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => {
          querySignal = signal;
          return runRemoteSearchSource(source, query, page, signal, sort, activeFilter, {
            isCurrent: () => !signal.aborted,
            trace
          });
        }
      });
      if (!isCurrentSearchRequest()) {
        finishTrace(querySignal?.aborted ? 'canceled' : 'stale', {
          source,
          reason: querySignal?.aborted ? 'canceled' : 'superseded'
        });
        return 'stale';
      }
      const data = groupFromRemoteSearchResult(result);
      if (result.kind !== 'success') {
        appQueryClient.removeQueries({ queryKey, exact: true });
      }
      const nextGroups = searchGroupsRef.current.map((group) => {
        if (group.source !== source) {
          return group;
        }
        const paginationFailed = result.kind !== 'success';
        const mergedItems = paginationFailed ? group.items : mergeTopics(group.items, data.items);
        const nextRequest = data.nextPage ? createSearchMoreRequestSnapshot({
          filters: requestFilters,
          page: data.nextPage,
          searchSource: requestSearchSource,
          source,
          submittedQuery: query
        }) : null;
        const canLoadNext = Boolean(
          nextRequest
          && hasNextSearchPage(data.hasMore, data.nextPage, page)
        );
        return {
          ...data,
          items: mergedItems,
          loading: false,
          loadingMore: false,
          hasMore: paginationFailed ? true : canLoadNext,
          nextPage: paginationFailed ? page : canLoadNext ? data.nextPage ?? null : null
        };
      });
      const updated = nextGroups.find((group) => group.source === source);
      markDiagnosticStage(trace, 'apply', {
        source,
        beforeCount: currentGroup.items.length,
        afterCount: updated?.items.length || currentGroup.items.length,
        itemCount: data.items.length,
        hasMore: Boolean(updated?.hasMore)
      });
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
      if (result.kind === 'action-required') {
        if (result.action.type === 'linuxdo-verification') {
          finishTrace(updated?.items.length ? 'partial' : 'blocked', {
            source,
            reason: 'verification_required',
            itemCount: updated?.items.length || 0
          });
          if (requestSearchSource === 'linuxdo' && !suppressLinuxDoVerification) {
            activeSearchRecoveryRef.current = { key: linuxDoRecovery.key, lane: 'more', source };
            await showLinuxDoVerification(result.action.message, linuxDoRecovery);
          }
          return requestSearchSource === 'linuxdo' ? 'verification-required' : 'completed';
        }
        handleRemoteSearchAction(result.action, () => {
          void loadMoreSearchSourceRef.current?.(source, page);
        });
        finishTrace(updated?.items.length ? 'partial' : 'blocked', {
          source,
          reason: result.action.type === 'nodeseek-verification' ? 'verification_required' : 'login_required',
          itemCount: updated?.items.length || 0
        });
        return 'completed';
      }
      if (updated?.error) {
        notify(`${updated.label}：${updated.error}`);
        const reason = diagnosticReasonForSearchError(updated.errorKind ? { kind: updated.errorKind, message: updated.error } : undefined);
        finishTrace(updated.items.length > currentGroup.items.length ? 'partial' : 'failure', {
          source,
          reason,
          beforeCount: currentGroup.items.length,
          afterCount: updated.items.length
        });
        return 'failed';
      } else {
        finishTrace('success', {
          source,
          beforeCount: currentGroup.items.length,
          afterCount: updated?.items.length || currentGroup.items.length,
          hasMore: Boolean(updated?.hasMore)
        });
      }
      return 'completed';
    } catch (error) {
      if (isCanceledSearchQuery(error)) {
        finishTrace(isCurrentSearchRequest() ? 'canceled' : 'stale', {
          source,
          reason: isCurrentSearchRequest() ? 'canceled' : 'superseded'
        });
        return 'stale';
      } else if (!isCurrentSearchRequest()) {
        finishTrace('stale', { source, reason: 'superseded' });
        return 'stale';
      } else {
        const sourceError = sourceErrorFromUnknown(source, error);
        const nextGroups = searchGroupsRef.current.map((group) => (
          group.source === source ? {
            ...group,
            loadingMore: false,
            error: sourceError.message,
            errorKind: sourceError.kind,
            authNotice: authNoticeForSourceError(sourceError) || group.authNotice
          } : group
        ));
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
        const reason = diagnosticReasonForSearchError(sourceError);
        finishTrace(
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source, reason }
        );
        if (source === 'linuxdo' && sourceError.kind === 'verification-required') {
          if (requestSearchSource === 'linuxdo' && !suppressLinuxDoVerification) {
            activeSearchRecoveryRef.current = { key: linuxDoRecovery.key, lane: 'more', source };
            await showLinuxDoVerification(sourceError.message, linuxDoRecovery);
          }
          return requestSearchSource === 'linuxdo' ? 'verification-required' : 'completed';
        }
        notify(sourceError.message);
        return 'failed';
      }
    } finally {
      if (!traceFinished) {
        finishTrace(isCurrentSearchRequest() ? 'failure' : querySignal?.aborted ? 'canceled' : 'stale', {
          source,
          reason: isCurrentSearchRequest() ? 'unknown' : querySignal?.aborted ? 'canceled' : 'superseded'
        });
      }
      if (isLatestSearchRequest()) {
        setSearchBusy(false);
      }
    }
  }, [handleRemoteSearchAction, notify, runRemoteSearchSource, showLinuxDoVerification]);

  useCommitRefValue(loadMoreSearchSourceRef, loadMoreSearchSource);
  useCommitRefValue(runSearchRef, runSearch);
  useCommitRefValue(searchQueryRef, searchQuery);


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

  const searchDiscourseTags = useCallback(async (options: Omit<Parameters<SourceGateway['searchTagOptions']>[0], 'source'> & { source?: DiscourseSource }) => {
    const source = options.source || 'linuxdo';
    const { source: _source, ...request } = options;
    const trace = beginDiagnosticTrace('search', 'searchTagOptions', { source });
    const isCurrent = () => !options.signal?.aborted;
    markDiagnosticStage(trace, 'guard', {
      source,
      state: 'started',
      hasQuery: Boolean(options.query?.trim()),
      selectedCount: options.selectedTags?.length || 0
    });
    try {
      const items = await sourceGateway.searchTagOptions({ source, ...request }, { trace, isCurrent });
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'canceled', { source, reason: 'canceled' });
        return items;
      }
      markDiagnosticStage(trace, 'apply', { source, itemCount: items.length });
      finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length });
      return items;
    } catch (error) {
      if (options.signal?.aborted || isCanceledRequest(error)) {
        finishDiagnosticTrace(trace, 'canceled', { source, reason: 'canceled' });
      } else {
        const reason = diagnosticReasonForSearchError(sourceErrorFromUnknown(source, error));
        finishDiagnosticTrace(
          trace,
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source, reason }
        );
      }
      throw error;
    }
  }, [sourceGateway]);

  const searchDiscourseUsers = useCallback(async (options: Omit<Parameters<SourceGateway['searchUserOptions']>[0], 'source'> & { source?: DiscourseSource }) => {
    const source = options.source || 'linuxdo';
    const { source: _source, ...request } = options;
    const trace = beginDiagnosticTrace('search', 'searchUserOptions', { source });
    const isCurrent = () => !options.signal?.aborted;
    markDiagnosticStage(trace, 'guard', { source, state: 'started', hasQuery: Boolean(options.term.trim()) });
    try {
      const items = await sourceGateway.searchUserOptions({ source, ...request }, { trace, isCurrent });
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'canceled', { source, reason: 'canceled' });
        return items;
      }
      markDiagnosticStage(trace, 'apply', { source, itemCount: items.length });
      finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length });
      return items;
    } catch (error) {
      if (options.signal?.aborted || isCanceledRequest(error)) {
        finishDiagnosticTrace(trace, 'canceled', { source, reason: 'canceled' });
      } else {
        const reason = diagnosticReasonForSearchError(sourceErrorFromUnknown(source, error));
        finishDiagnosticTrace(
          trace,
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source, reason }
        );
      }
      throw error;
    }
  }, [sourceGateway]);

  const linuxDoAiVisible = Boolean(
    submittedSearchQuery
    && searchSource === 'linuxdo'
    && searchFilters.linuxdo.order === 'relevance'
    && sessionViewModels.linuxdo.isLoggedIn
  );
  const visibleSearchGroups = useMemo(() => (
    linuxDoAiState.enabled
      ? searchGroups.map((group) => group.source === 'linuxdo'
        ? { ...group, items: mergeLinuxDoAiTopics(group.items, linuxDoAiItems, true) }
        : group)
      : searchGroups
  ), [linuxDoAiItems, linuxDoAiState.enabled, searchGroups]);

  const toggleLinuxDoAiSearch = useCallback(() => {
    setLinuxDoAiState((current) => current.status === 'ready'
      ? { ...current, enabled: !current.enabled }
      : current);
  }, []);

  const retryLinuxDoAiSearch = useCallback(() => {
    if (linuxDoAiState.status === 'error' && linuxDoAiQueryRef.current) {
      runLinuxDoAiSearch(linuxDoAiQueryRef.current);
    }
  }, [linuxDoAiState.status, runLinuxDoAiSearch]);

  const abortSearchRequests = useCallback(() => {
    searchRecoveryGenerationRef.current += 1;
    linuxDoAiGenerationRef.current += 1;
    void appQueryClient.cancelQueries({
      predicate: ({ queryKey }) => (
        queryKey[0] === 'forum'
        && typeof queryKey[2] === 'string'
        && (queryKey[2].startsWith('search') || queryKey[2] === 'semantic-search')
      )
    });
  }, []);

  useEffect(() => abortSearchRequests, [abortSearchRequests]);

  return {
    abortSearchRequests,
    applySearchFilter,
    loadMoreSearchSource,
    recentSearches,
    removeRecentSearch,
    retrySearchSource,
    retryLinuxDoAiSearch,
    runSearch,
    searchBusy,
    searchFilters,
    searchGroups: visibleSearchGroups,
    searchDiscourseTags,
    searchDiscourseUsers,
    linuxDoAiState,
    linuxDoAiVisible,
    searchSessionNotices,
    searchQuery,
    searchSource,
    submittedSearchQuery,
    setSearchQuery,
    setSearchSource,
    toggleLinuxDoAiSearch
  };
}
