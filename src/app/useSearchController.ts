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
import {
  finishAbortableRequest,
  interruptedRequestDiagnostic,
  isSilentRequestInterruption,
  isSupersededRequest,
  sourceLabel,
  startAbortableRequest
} from '../appUtils';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import { sourceErrorFromUnknown, yaohuoErrorRequiresLoginPanel } from '../sourceErrors';
import { authNoticeForSource, authNoticeForSourceError, searchSessionNoticeItems } from '../siteSessionPrompts';
import type { SiteSessionViewModels } from '../siteSessionState';
import type { Category, FeedSource, Source, SourceErrorInfo, Topic } from '../types';
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
  stopSearchGroupLoadingMore,
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

function diagnosticReasonForSearchError(error?: SourceErrorInfo): DiagnosticReason {
  if (error?.kind === 'login-required' || error?.kind === 'login-expired') return 'login_required';
  if (error?.kind === 'verification-required') return 'verification_required';
  if (error?.kind === 'permission-denied') return 'permission_denied';
  return error ? normalizeDiagnosticReason(error.message) : 'unknown';
}

export function useSearchController({
  categories,
  notify,
  onNodeSeekSearchVerificationRequired,
  sessionViewModels,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  categories: Category[];
  notify: (message: string) => void;
  onNodeSeekSearchVerificationRequired?: (message: string, retry: () => void) => void;
  sessionViewModels: SiteSessionViewModels;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
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
      const sourceError = data.errors?.[source];
      const sourceErrorText = sourceError?.message || undefined;
      const group = {
        source,
        label: sourceLabel(source),
        items: data.items,
        authNotice: sourceError ? authNoticeForSourceError(sourceError) || undefined : sourceStatusNotice,
        error: sourceErrorText,
        errorKind: sourceError?.kind,
        hasMore: Boolean(data.hasMore && data.nextPage),
        nextPage: data.nextPage ?? null
      };
      if (source === 'nodeseek' && group.errorKind === 'verification-required' && group.error) {
        return { kind: 'action-required', group, action: { type: 'nodeseek-verification', message: group.error } };
      }
      return remoteSearchResult(group);
    } catch (error) {
      if (isSilentRequestInterruption(error)) {
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
      return { kind: 'failed', group: { source, label: sourceLabel(source), items: [], error: message, errorKind: sourceError.kind, authNotice: authNoticeForSourceError(sourceError) || undefined, hasMore: false, nextPage: null } };
    }
  }, [categories, sessionViewModels, sourceGateway]);

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
      return;
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
    const isLatestSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    const isCurrentSearchRequest = () => isLatestSearchRequest() && !controller.signal.aborted;
    const finishInterruptedSearchRequest = () => {
      const interruption = interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted);
      if (!interruption) {
        return false;
      }
      finishTrace(interruption.outcome, {
        source: sourceOverride || requestSearchSource,
        reason: interruption.reason
      });
      return true;
    };
    const activeSources = sourceOverride
      ? [sourceOverride]
      : requestSearchSource === 'all'
        ? feedSources
        : [requestSearchSource as Source];
    const activeSort = remoteSearchSort(requestSearchSource, requestFilters);
    markDiagnosticStage(trace, 'guard', {
      source: sourceOverride || requestSearchSource,
      state: sourceOverride ? 'retry' : 'started',
      count: activeSources.length
    });
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
    let canceledCurrentRequest = false;
    try {
      addRecentSearch(query);
      const resultsBySource: Partial<Record<Source, RemoteSearchSourceResult>> = {};
      await Promise.all(activeSources.map(async (source) => {
        const result = await runRemoteSearchSource(source, query, 1, controller.signal, activeSort, requestFilter, {
          isCurrent: () => isCurrentSearchRequest(),
          trace
        });
        if (!isCurrentSearchRequest()) {
          return;
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
        const nextGroups = searchGroupsRef.current.map((currentGroup) => (
          currentGroup.source === source ? { ...group, loading: false } : currentGroup
        ));
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
      }));
      if (finishInterruptedSearchRequest()) {
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
        finishTrace(resultCount ? 'partial' : 'blocked', {
          source: sourceOverride || requestSearchSource,
          reason: action.type === 'nodeseek-verification' ? 'verification_required' : 'login_required',
          itemCount: resultCount
        });
        return;
      }
      const errors = nextGroups.filter((group) => group.error);
      notify(errors.length
        ? errors.map((group) => `${group.label}：${group.error}`).join('；')
        : `搜索完成：${resultCount} 条结果`);
      if (errors.length) {
        const reason = diagnosticReasonForSearchError(errors[0]?.errorKind ? {
          kind: errors[0].errorKind,
          message: errors[0].error || ''
        } : undefined);
        finishTrace(
          resultCount ? 'partial' : reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source: sourceOverride || requestSearchSource, reason, itemCount: resultCount, partialErrorCount: errors.length }
        );
      } else {
        finishTrace('success', { source: sourceOverride || requestSearchSource, itemCount: resultCount });
      }
    } catch (error) {
      if (isSilentRequestInterruption(error)) {
        const wasCurrent = isLatestSearchRequest();
        const stale = isSupersededRequest(error) || !isLatestSearchRequest();
        if (wasCurrent) {
          canceledCurrentRequest = true;
          searchRequestIdRef.current += 1;
          controller.abort();
          const nextGroups = searchGroupsRef.current.map((group) => (
            activeSources.includes(group.source) ? { ...group, loading: false, loadingMore: false } : group
          ));
          searchGroupsRef.current = nextGroups;
          setSearchGroups(nextGroups);
        }
        finishTrace(stale ? 'stale' : 'canceled', {
          source: sourceOverride || requestSearchSource,
          reason: stale ? 'superseded' : 'canceled'
        });
      } else if (interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted)) {
        const interruption = interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted)!;
        finishTrace(interruption.outcome, { source: sourceOverride || requestSearchSource, reason: interruption.reason });
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
          return;
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
          return;
        }
        notify(sourceError.message);
        finishTrace(outcome, { source: failureSource, reason });
      }
    } finally {
      if (!traceFinished) {
        const interruption = interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted);
        finishTrace(interruption?.outcome || 'failure', {
          source: sourceOverride || requestSearchSource,
          reason: interruption?.reason || 'unknown'
        });
      }
      if (isLatestSearchRequest() || canceledCurrentRequest) {
        setSearchBusy(false);
      }
      finishAbortableRequest(searchAbortRef, controller);
    }
  }, [
    addRecentSearch,
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
      return;
    }
    const { activeFilter, ownerKey, query, sort, visitedKey } = requestSnapshot;
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
      return;
    }
    markDiagnosticStage(trace, 'guard', { source, state: 'load-more', page });
    const markedGroups = searchGroupsRef.current.map((group) => (
      group.source === source ? { ...group, loadingMore: true, error: undefined } : { ...group, loadingMore: false }
    ));
    searchGroupsRef.current = markedGroups;
    setSearchGroups(markedGroups);
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    const requestOwner = startOwnedRequest(searchRequestOwnerRef, ownerKey);
    const isLatestSearchRequest = () => isCurrentOwnedRequest(requestOwner, searchRequestOwnerRef) && requestId === searchRequestIdRef.current;
    const isCurrentSearchRequest = () => isLatestSearchRequest() && !controller.signal.aborted;
    const finishInterruptedSearchRequest = () => {
      const interruption = interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted);
      if (!interruption) {
        return false;
      }
      finishTrace(interruption.outcome, { source, reason: interruption.reason });
      return true;
    };
    setSearchBusy(true);
    try {
      const result = await runRemoteSearchSource(source, query, page, controller.signal, sort, activeFilter, {
        isCurrent: () => isCurrentSearchRequest(),
        trace
      });
      if (finishInterruptedSearchRequest()) {
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
        handleRemoteSearchAction(result.action, () => {
          void runSearchRef.current?.(createNodeSeekRetrySearchOptions({
            filters: requestFilters,
            query,
            searchSource: requestSearchSource
          }));
        });
        finishTrace(updated?.items.length ? 'partial' : 'blocked', {
          source,
          reason: result.action.type === 'nodeseek-verification' ? 'verification_required' : 'login_required',
          itemCount: updated?.items.length || 0
        });
        return;
      }
      notify(updated?.error ? `${updated.label}：${updated.error}` : `${sourceLabel(source)} 已加载更多`);
      if (updated?.error) {
        const reason = diagnosticReasonForSearchError(updated.errorKind ? { kind: updated.errorKind, message: updated.error } : undefined);
        finishTrace(updated.items.length > currentGroup.items.length ? 'partial' : 'failure', {
          source,
          reason,
          beforeCount: currentGroup.items.length,
          afterCount: updated.items.length
        });
      } else {
        finishTrace('success', {
          source,
          beforeCount: currentGroup.items.length,
          afterCount: updated?.items.length || currentGroup.items.length,
          hasMore: Boolean(updated?.hasMore)
        });
      }
    } catch (error) {
      if (isSilentRequestInterruption(error)) {
        const requestLatest = isLatestSearchRequest();
        if (requestLatest) {
          const nextGroups = stopSearchGroupLoadingMore(searchGroupsRef.current, source);
          searchGroupsRef.current = nextGroups;
          setSearchGroups(nextGroups);
        }
        const stale = isSupersededRequest(error) || !requestLatest;
        finishTrace(stale ? 'stale' : 'canceled', {
          source,
          reason: stale ? 'superseded' : 'canceled'
        });
      } else if (interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted)) {
        const interruption = interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted)!;
        finishTrace(interruption.outcome, { source, reason: interruption.reason });
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
        notify(sourceError.message);
        const reason = diagnosticReasonForSearchError(sourceError);
        finishTrace(
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source, reason }
        );
      }
    } finally {
      if (!traceFinished) {
        const interruption = interruptedRequestDiagnostic(isLatestSearchRequest(), controller.signal.aborted);
        finishTrace(interruption?.outcome || 'failure', {
          source,
          reason: interruption?.reason || 'unknown'
        });
      }
      if (isLatestSearchRequest()) {
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
