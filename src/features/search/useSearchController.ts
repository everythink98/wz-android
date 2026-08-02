import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { aggregateSearchSources, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { mergeTopics, type SearchSort } from '@/domain/forum/feed';
import {
  buildDiscourseSearchQuery,
  DEFAULT_SEARCH_FILTERS,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import { mergeLoadedSearchHistory, normalizeSearchHistory, sameSearchHistory } from './history';
import type { ReadGateway } from '@/sources/readGateway';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { sourceLabel } from '@/domain/forum/presentation';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  sourceErrorFromUnknown,
  sourceReadRecoveryOutcome,
  yaohuoErrorRequiresLoginPanel
} from '@/sources/sourceErrors';
import {
  authNoticeForSource,
  authNoticeForSourceError,
  searchSessionNoticeItems
} from '@/domain/session/siteSessionPrompts';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { Category, DiscourseTagOption, DiscourseUserOption, FeedSource, Source } from '@/domain/forum/models';
import type { SearchGroup } from './listItems';
import {
  createSearchHistoryWriteQueue,
  enqueueSearchHistoryWrite,
  groupFromRemoteSearchResult,
  hasNextSearchPage,
  linuxDoAiFailureState,
  mergeLinuxDoAiTopics,
  remoteSearchSort,
  snapshotSearchFilters,
  type LinuxDoAiSearchState,
  type RemoteSearchSourceResult,
  type SearchRunOptions
} from './controllerResults';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';

const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';
type SearchRunInput = Source | Partial<SearchRunOptions>;
type SubmittedSearch = {
  filters: SearchFilterState;
  query: string;
  source: FeedSource;
};

class SearchPageError extends Error {
  constructor(
    readonly page: number,
    readonly result: RemoteSearchSourceResult
  ) {
    super(groupFromRemoteSearchResult(result).error || '搜索失败');
  }
}

function remoteSearchResult(group: SearchGroup): RemoteSearchSourceResult {
  return group.error ? { kind: 'failed', group } : { kind: 'success', group };
}

function searchGroupForUnexpectedError(
  source: Source,
  error: unknown,
  sessionViewModels: SiteSessionViewModels
): SearchGroup {
  const sourceError = sourceErrorFromUnknown(source, error);
  return {
    source,
    label: sourceLabel(source),
    items: [],
    error: sourceError.message,
    errorKind: sourceError.kind,
    authNotice:
      authNoticeForSourceError(sourceError) || authNoticeForSource(source, sessionViewModels, 'search') || undefined,
    hasMore: false,
    nextPage: null
  };
}

function mergeSearchPages(pages: RemoteSearchSourceResult[], error: unknown): SearchGroup | null {
  if (!pages.length) {
    return null;
  }
  const first = groupFromRemoteSearchResult(pages[0]);
  const merged = pages.reduce((current, page) => {
    const group = groupFromRemoteSearchResult(page);
    return {
      ...group,
      items: mergeTopics(current.items, group.items),
      authNotice: group.authNotice || current.authNotice
    };
  }, first);
  if (error instanceof SearchPageError) {
    const failed = groupFromRemoteSearchResult(error.result);
    return {
      ...merged,
      error: failed.error,
      errorKind: failed.errorKind,
      authNotice: failed.authNotice || merged.authNotice,
      hasMore: error.page > 1 ? true : merged.hasMore,
      nextPage: error.page > 1 ? error.page : merged.nextPage,
      loading: false,
      loadingMore: false
    };
  }
  return merged;
}

function isSourceIdentityPending(source: Source, sessions: SiteSessionViewModels) {
  return source !== 'v2ex' && sessions[source].identityTrust === 'pending';
}

type SearchTagCandidatesRequest = {
  categoryId?: string;
  query: string;
  selectedTags: string[];
  source: DiscourseSource;
};

type SearchUserCandidatesRequest = {
  categoryId?: string;
  source: DiscourseSource;
  term: string;
};

export function useSearchCandidateQueries({
  sessionEpochs,
  enabled,
  searchDiscourseTags,
  searchDiscourseUsers,
  tagRequest,
  userRequest
}: {
  sessionEpochs: ForumSessionEpochs;
  enabled: boolean;
  searchDiscourseTags: (
    options: SearchTagCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseTagOption[]>;
  searchDiscourseUsers: (
    options: SearchUserCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseUserOption[]>;
  tagRequest: SearchTagCandidatesRequest | null;
  userRequest: SearchUserCandidatesRequest | null;
}) {
  const queryClient = useQueryClient();
  const tagCandidatesQuery = useQuery<DiscourseTagOption[]>({
    queryKey: forumQueryKeys.searchTags({
      categoryId: tagRequest?.categoryId,
      query: tagRequest?.query || '',
      scope: sessionEpochs,
      selectedTags: tagRequest?.selectedTags || [],
      source: tagRequest?.source || 'linuxdo'
    }),
    enabled: Boolean(enabled && tagRequest),
    queryFn: ({ signal }) => (tagRequest ? searchDiscourseTags({ ...tagRequest, signal }) : Promise.resolve([]))
  });

  const userCandidatesQuery = useQuery<DiscourseUserOption[]>({
    queryKey: forumQueryKeys.searchUsers({
      categoryId: userRequest?.categoryId,
      scope: sessionEpochs,
      source: userRequest?.source || 'linuxdo',
      term: userRequest?.term || ''
    }),
    enabled: Boolean(enabled && userRequest),
    queryFn: ({ signal }) => (userRequest ? searchDiscourseUsers({ ...userRequest, signal }) : Promise.resolve([]))
  });
  useEffect(() => {
    if (enabled) return;
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === 'forum' && (queryKey[2] === 'search-tags' || queryKey[2] === 'search-users')
    });
  }, [enabled, queryClient]);

  return {
    tags: {
      error: tagCandidatesQuery.isError,
      loading: tagCandidatesQuery.isFetching,
      options: tagCandidatesQuery.data || [],
      retry: tagCandidatesQuery.refetch
    },
    users: {
      error: userCandidatesQuery.isError,
      loading: userCandidatesQuery.isFetching,
      options: userCandidatesQuery.data || [],
      retry: userCandidatesQuery.refetch
    }
  };
}

export function useSearchController({
  active,
  categories,
  sessionEpochs = initialForumSessionEpochs,
  linuxDoVerificationActive,
  notify,
  onNodeSeekSearchVerificationRequired,
  sessionViewModels,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  readGateway
}: {
  active: boolean;
  categories: Category[];
  sessionEpochs?: ForumSessionEpochs;
  linuxDoVerificationActive: boolean;
  notify: (message: string) => void;
  onNodeSeekSearchVerificationRequired?: (message: string, recovery: LinuxDoReadRecovery) => void;
  sessionViewModels: SiteSessionViewModels;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
}) {
  const queryClient = useQueryClient();
  const searchActive = active;
  const recentSearchWriteQueueRef = useRef(createSearchHistoryWriteQueue());
  const lastSavedRecentSearchesRef = useRef<string[] | null>(null);
  const recentSearchHistoryHydratedRef = useRef(false);
  const recentSearchHistoryReadFailedRef = useRef(false);
  const pendingRecentSearchRemovalKeysRef = useRef(new Set<string>());
  const handledSearchActionsRef = useRef(new WeakSet<RemoteSearchSourceResult>());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSource, setSearchSourceState] = useState<FeedSource>('all');
  const [searchFilters, setSearchFilters] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(null);
  const [linuxDoAiEnabled, setLinuxDoAiEnabled] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentSearchesHydrated, setRecentSearchesHydrated] = useState(false);
  const [recentSearchHistoryReadAttempt, setRecentSearchHistoryReadAttempt] = useState(0);
  const searchSessionNotices = useMemo(
    () => searchSessionNoticeItems(searchSource, sessionViewModels),
    [searchSource, sessionViewModels]
  );
  const linuxDoVerificationInProgress =
    sessionViewModels.linuxdo.status === 'verification-required' || sessionViewModels.linuxdo.status === 'verifying';
  const [stableLinuxDoAuthenticated, setStableLinuxDoAuthenticated] = useState(sessionViewModels.linuxdo.isLoggedIn);
  const linuxDoAuthenticated = linuxDoVerificationInProgress
    ? stableLinuxDoAuthenticated
    : sessionViewModels.linuxdo.isLoggedIn;
  useLayoutEffect(() => {
    if (!linuxDoVerificationInProgress) {
      setStableLinuxDoAuthenticated(sessionViewModels.linuxdo.isLoggedIn);
    }
  }, [linuxDoVerificationInProgress, sessionViewModels.linuxdo.isLoggedIn]);

  useEffect(() => {
    let active = true;
    recentSearchHistoryReadFailedRef.current = false;
    AsyncStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (!active) return;
        const storedHistory = mergeLoadedSearchHistory([], raw);
        const removedKeys = new Set(pendingRecentSearchRemovalKeysRef.current);
        recentSearchHistoryHydratedRef.current = true;
        pendingRecentSearchRemovalKeysRef.current.clear();
        lastSavedRecentSearchesRef.current = storedHistory;
        setRecentSearches((current) => {
          const merged = mergeLoadedSearchHistory(current, raw).filter((item) => !removedKeys.has(item.toLowerCase()));
          return sameSearchHistory(current, merged) ? current : merged;
        });
        setRecentSearchesHydrated(true);
      })
      .catch(() => {
        if (active) recentSearchHistoryReadFailedRef.current = true;
      });
    return () => {
      active = false;
    };
  }, [recentSearchHistoryReadAttempt]);

  useEffect(() => {
    if (!recentSearchesHydrated || sameSearchHistory(lastSavedRecentSearchesRef.current, recentSearches)) {
      return;
    }
    const next = recentSearches;
    void enqueueSearchHistoryWrite(recentSearchWriteQueueRef.current, () =>
      AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next))
    )
      .then(() => {
        lastSavedRecentSearchesRef.current = next;
      })
      .catch(() => undefined);
  }, [recentSearches, recentSearchesHydrated]);

  const retryRecentSearchHistoryRead = useCallback(() => {
    if (!recentSearchHistoryHydratedRef.current && recentSearchHistoryReadFailedRef.current) {
      recentSearchHistoryReadFailedRef.current = false;
      setRecentSearchHistoryReadAttempt((current) => current + 1);
    }
  }, []);

  const addRecentSearch = useCallback(
    (query: string) => {
      const clean = query.trim();
      if (!clean) return;
      pendingRecentSearchRemovalKeysRef.current.delete(clean.toLowerCase());
      retryRecentSearchHistoryRead();
      setRecentSearches((current) =>
        normalizeSearchHistory([clean, ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())])
      );
    },
    [retryRecentSearchHistoryRead]
  );

  const removeRecentSearch = useCallback(
    (query: string) => {
      if (!recentSearchHistoryHydratedRef.current) {
        pendingRecentSearchRemovalKeysRef.current.add(query.toLowerCase());
      }
      retryRecentSearchHistoryRead();
      setRecentSearches((current) => current.filter((item) => item !== query));
    },
    [retryRecentSearchHistoryRead]
  );

  const runRemoteSearchSource = useCallback(
    async (
      source: Source,
      query: string,
      page: number,
      signal: AbortSignal,
      sort: SearchSort,
      filter?: SourceSearchFilter
    ): Promise<RemoteSearchSourceResult> => {
      const trace = beginDiagnosticTrace('search', page > 1 ? 'load-more' : 'run', { source, page });
      const sourceStatusNotice = authNoticeForSource(source, sessionViewModels, 'search') || undefined;
      try {
        markDiagnosticStage(trace, 'guard', { source, page, state: page > 1 ? 'load-more' : 'started' });
        const activeFilter = filter?.source === source ? filter : undefined;
        const data = await readGateway.searchTopics(
          {
            query,
            source,
            page,
            limit: source === 'linuxdo' ? 50 : 30,
            categories,
            sort: source === 'v2ex' ? sort : 'relevance',
            filter: activeFilter,
            signal
          },
          { trace }
        );
        const parserSummary = sourceDiagnosticSummary(data);
        const sourceError =
          data.errors?.[source] ||
          (parserSummary?.isParseEmpty
            ? {
                kind: 'ordinary' as const,
                message: '搜索结果返回内容无法解析，请重试。',
                reason: 'parse_empty',
                retryable: true
              }
            : undefined);
        const group: SearchGroup = {
          source,
          label: sourceLabel(source),
          items: data.items,
          authNotice: sourceError ? authNoticeForSourceError(sourceError) || undefined : sourceStatusNotice,
          error: sourceError?.message,
          errorKind: sourceError?.kind,
          hasMore: !sourceError && hasNextSearchPage(data.hasMore, data.nextPage, page),
          nextPage:
            !sourceError && hasNextSearchPage(data.hasMore, data.nextPage, page) ? (data.nextPage ?? null) : null
        };
        const result: RemoteSearchSourceResult =
          sourceError?.kind === 'verification-required' && (source === 'nodeseek' || source === 'linuxdo')
            ? {
                kind: 'action-required',
                group,
                action: {
                  type: `${source === 'nodeseek' ? 'nodeseek' : 'linuxdo'}-verification`,
                  message: sourceError.message
                }
              }
            : remoteSearchResult(group);
        finishDiagnosticTrace(trace, sourceError ? 'failure' : 'success', {
          source,
          itemCount: data.items.length,
          ...(sourceError ? { reason: normalizeDiagnosticReason(sourceError.message) } : {})
        });
        return result;
      } catch (error) {
        if (signal.aborted) {
          finishDiagnosticTrace(trace, 'canceled', { source, reason: 'canceled' });
          throw error;
        }
        const sourceError = sourceErrorFromUnknown(source, error);
        const group: SearchGroup = {
          source,
          label: sourceLabel(source),
          items: [],
          error: sourceError.message,
          errorKind: sourceError.kind,
          authNotice: authNoticeForSourceError(sourceError) || sourceStatusNotice,
          hasMore: false,
          nextPage: null
        };
        finishDiagnosticTrace(
          trace,
          sourceError.kind === 'verification-required' ||
            sourceError.kind === 'login-required' ||
            sourceError.kind === 'permission-denied'
            ? 'blocked'
            : 'failure',
          { source, reason: normalizeDiagnosticReason(error) }
        );
        if (source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          return { kind: 'action-required', group, action: { type: 'yaohuo-login', message: sourceError.message } };
        }
        if (source === 'nodeseek' && sourceError.kind === 'verification-required') {
          return {
            kind: 'action-required',
            group,
            action: { type: 'nodeseek-verification', message: sourceError.message }
          };
        }
        if (source === 'linuxdo' && sourceError.kind === 'verification-required') {
          return {
            kind: 'action-required',
            group,
            action: { type: 'linuxdo-verification', message: sourceError.message }
          };
        }
        return { kind: 'failed', group };
      }
    },
    [categories, linuxDoAuthenticated, sessionViewModels, readGateway]
  );

  const submittedSource = submittedSearch?.source === 'all' ? 'v2ex' : submittedSearch?.source || 'v2ex';
  const submittedFilter = submittedSearch ? submittedSearch.filters[submittedSource] : undefined;
  const submittedSort = submittedSearch
    ? remoteSearchSort(submittedSearch.source, submittedSearch.filters)
    : 'relevance';
  const singleSearchKey = forumQueryKeys.search({
    authenticated: submittedSource === 'linuxdo' && linuxDoAuthenticated,
    source: submittedSource,
    query: submittedSearch?.query || '',
    sort: submittedSort,
    filter: submittedFilter,
    scope: sessionEpochs
  });

  const aggregateKeys = aggregateSearchSources.map((source) =>
    forumQueryKeys.search({
      authenticated: source === 'linuxdo' && linuxDoAuthenticated,
      source,
      query: submittedSearch?.query || '',
      sort: submittedSearch ? remoteSearchSort('all', submittedSearch.filters) : 'relevance',
      scope: sessionEpochs
    })
  );
  const aggregateQueries = useQueries({
    queries: aggregateSearchSources.map((source, index) => ({
      queryKey: aggregateKeys[index],
      enabled: Boolean(
        searchActive &&
        submittedSearch?.query &&
        submittedSearch.source === 'all' &&
        !isSourceIdentityPending(source, sessionViewModels)
      ),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const result = await runRemoteSearchSource(
          source,
          submittedSearch?.query || '',
          1,
          signal,
          submittedSearch ? remoteSearchSort('all', submittedSearch.filters) : 'relevance'
        );
        if (result.kind !== 'success') {
          throw new SearchPageError(1, result);
        }
        return result;
      }
    }))
  });

  const singleSearchQuery = useInfiniteQuery({
    queryKey: singleSearchKey,
    enabled: Boolean(
      searchActive &&
      submittedSearch?.query &&
      submittedSearch.source !== 'all' &&
      !isSourceIdentityPending(submittedSource, sessionViewModels)
    ),
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      const result = await runRemoteSearchSource(
        submittedSource,
        submittedSearch?.query || '',
        pageParam,
        signal,
        submittedSort,
        submittedFilter
      );
      if (result.kind !== 'success') {
        throw new SearchPageError(pageParam, result);
      }
      return result;
    },
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const group = groupFromRemoteSearchResult(lastPage);
      return hasNextSearchPage(group.hasMore, group.nextPage, lastPageParam)
        ? (group.nextPage ?? undefined)
        : undefined;
    }
  });

  const aggregateGroups = useMemo(
    () =>
      aggregateSearchSources.map((source, index): SearchGroup => {
        const query = aggregateQueries[index];
        if (query.error instanceof SearchPageError) {
          const failed = groupFromRemoteSearchResult(query.error.result);
          if (query.data) {
            return {
              ...groupFromRemoteSearchResult(query.data),
              authNotice: failed.authNotice,
              error: failed.error,
              errorKind: failed.errorKind,
              loading: query.isFetching
            };
          }
          return { ...failed, loading: query.isFetching };
        }
        if (query.error) {
          return {
            ...searchGroupForUnexpectedError(source, query.error, sessionViewModels),
            loading: query.isFetching
          };
        }
        if (query.data) {
          return { ...groupFromRemoteSearchResult(query.data), loading: query.isFetching };
        }
        return {
          source,
          label: sourceLabel(source),
          items: [],
          authNotice: authNoticeForSource(source, sessionViewModels, 'search') || undefined,
          settled: false,
          loading: Boolean(
            searchActive &&
            submittedSearch?.query &&
            submittedSearch.source === 'all' &&
            !isSourceIdentityPending(source, sessionViewModels)
          )
        };
      }),
    [aggregateQueries, searchActive, sessionViewModels, submittedSearch?.query, submittedSearch?.source]
  );
  const singleGroup = useMemo(() => {
    const merged = mergeSearchPages(singleSearchQuery.data?.pages || [], singleSearchQuery.error);
    if (merged) {
      return {
        ...merged,
        loading: singleSearchQuery.isFetching && !singleSearchQuery.isFetchingNextPage,
        loadingMore: singleSearchQuery.isFetchingNextPage
      };
    }
    if (singleSearchQuery.error instanceof SearchPageError) {
      return { ...groupFromRemoteSearchResult(singleSearchQuery.error.result), loading: singleSearchQuery.isFetching };
    }
    if (singleSearchQuery.error) {
      return {
        ...searchGroupForUnexpectedError(submittedSource, singleSearchQuery.error, sessionViewModels),
        loading: singleSearchQuery.isFetching
      };
    }
    if (
      searchActive &&
      submittedSearch?.query &&
      submittedSearch.source !== 'all' &&
      isSourceIdentityPending(submittedSource, sessionViewModels)
    ) {
      return {
        source: submittedSource,
        label: sourceLabel(submittedSource),
        items: [],
        authNotice: authNoticeForSource(submittedSource, sessionViewModels, 'search') || undefined,
        settled: false,
        loading: false
      };
    }
    return null;
  }, [
    searchActive,
    sessionViewModels,
    singleSearchQuery.data?.pages,
    singleSearchQuery.error,
    singleSearchQuery.isFetching,
    singleSearchQuery.isFetchingNextPage,
    submittedSearch?.query,
    submittedSearch?.source,
    submittedSource
  ]);
  const baseSearchGroups = submittedSearch?.source === 'all' ? aggregateGroups : singleGroup ? [singleGroup] : [];

  const linuxDoAiVisible = Boolean(
    submittedSearch?.query &&
    submittedSearch.source === 'linuxdo' &&
    submittedSearch.filters.linuxdo.order === 'relevance' &&
    sessionViewModels.linuxdo.isLoggedIn
  );
  const linuxDoAiFullQuery =
    linuxDoAiVisible && submittedSearch
      ? buildDiscourseSearchQuery(submittedSearch.query, submittedSearch.filters.linuxdo, categories)
      : '';
  const linuxDoAiQuery = useQuery({
    queryKey: forumQueryKeys.semanticSearch(linuxDoAiFullQuery, sessionEpochs),
    enabled: Boolean(
      searchActive &&
      !linuxDoVerificationActive &&
      linuxDoAiFullQuery &&
      !isSourceIdentityPending('linuxdo', sessionViewModels)
    ),
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('search', 'searchSemanticTopics', { source: 'linuxdo' });
      try {
        markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'started' });
        const result = await readGateway.searchSemanticTopics(
          { source: 'linuxdo', query: linuxDoAiFullQuery, signal },
          { trace }
        );
        if (!result) throw new Error('AI 搜索未返回结果');
        if (signal.aborted) {
          finishDiagnosticTrace(trace, 'canceled', { source: 'linuxdo', reason: 'canceled' });
          return result;
        }
        markDiagnosticStage(trace, 'apply', { source: 'linuxdo', itemCount: result.items.length });
        finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', itemCount: result.items.length });
        return result;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: 'linuxdo',
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  });
  useEffect(() => {
    if (!linuxDoVerificationActive) return;
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[2] === 'semantic-search'
    });
  }, [linuxDoVerificationActive, queryClient]);
  const linuxDoAiState = useMemo<LinuxDoAiSearchState>(() => {
    if (!linuxDoAiVisible) return { status: 'idle', enabled: false, count: 0 };
    if (isSourceIdentityPending('linuxdo', sessionViewModels) && !linuxDoAiQuery.data) {
      return { status: 'idle', enabled: false, count: 0 };
    }
    if (linuxDoAiQuery.isPending) return { status: 'loading', enabled: false, count: 0 };
    if (linuxDoAiQuery.isError) return linuxDoAiFailureState(linuxDoAiQuery.error);
    const count = linuxDoAiQuery.data?.items.length || 0;
    return count
      ? { status: 'ready', enabled: linuxDoAiEnabled, count }
      : { status: 'empty', enabled: false, count: 0, message: '未找到 AI 结果' };
  }, [
    linuxDoAiEnabled,
    linuxDoAiQuery.data,
    linuxDoAiQuery.data?.items.length,
    linuxDoAiQuery.error,
    linuxDoAiQuery.isError,
    linuxDoAiQuery.isPending,
    linuxDoAiVisible,
    sessionViewModels
  ]);
  const searchGroups = useMemo(
    () =>
      linuxDoAiState.enabled
        ? baseSearchGroups.map((group) =>
            group.source === 'linuxdo'
              ? { ...group, items: mergeLinuxDoAiTopics(group.items, linuxDoAiQuery.data?.items || [], true) }
              : group
          )
        : baseSearchGroups,
    [baseSearchGroups, linuxDoAiQuery.data?.items, linuxDoAiState.enabled]
  );

  const requireNodeSeekSearchVerification = useCallback(
    (message: string, recovery: LinuxDoReadRecovery) => {
      if (onNodeSeekSearchVerificationRequired) {
        onNodeSeekSearchVerificationRequired(message, recovery);
      } else {
        showNodeSeekVerification(message);
      }
    },
    [onNodeSeekSearchVerificationRequired, showNodeSeekVerification]
  );

  const retrySearchSource = useCallback(
    (source: Source) => {
      if (!searchActive || isSourceIdentityPending(source, sessionViewModels)) return;
      if (submittedSearch?.source === 'all') {
        const index = aggregateSearchSources.indexOf(source);
        if (index >= 0) void aggregateQueries[index].refetch({ cancelRefetch: false });
        return;
      }
      if (source !== submittedSource) return;
      if (singleSearchQuery.isFetchNextPageError) {
        void singleSearchQuery.fetchNextPage({ cancelRefetch: false });
      } else {
        void singleSearchQuery.refetch({ cancelRefetch: false });
      }
    },
    [
      aggregateQueries,
      searchActive,
      sessionViewModels,
      singleSearchQuery.fetchNextPage,
      singleSearchQuery.isFetchNextPageError,
      singleSearchQuery.refetch,
      submittedSearch?.source,
      submittedSource
    ]
  );

  const loadMoreSearchSource = useCallback(
    async (source: Source, page: number): Promise<LinuxDoReadResumeOutcome> => {
      if (
        !searchActive ||
        submittedSearch?.source === 'all' ||
        source !== submittedSource ||
        singleSearchQuery.isFetchingNextPage ||
        isSourceIdentityPending(source, sessionViewModels)
      ) {
        return 'stale';
      }
      const last = singleSearchQuery.data?.pages.at(-1);
      const group = last ? groupFromRemoteSearchResult(last) : null;
      const retryPage =
        singleSearchQuery.isFetchNextPageError && singleSearchQuery.error instanceof SearchPageError
          ? singleSearchQuery.error.page
          : group?.nextPage;
      if (retryPage !== page) return 'stale';
      const result = await singleSearchQuery.fetchNextPage({ cancelRefetch: false });
      return result.isError ? 'failed' : 'completed';
    },
    [
      searchActive,
      sessionViewModels,
      singleSearchQuery.data?.pages,
      singleSearchQuery.error,
      singleSearchQuery.fetchNextPage,
      singleSearchQuery.isFetchNextPageError,
      singleSearchQuery.isFetchingNextPage,
      submittedSearch?.source,
      submittedSource
    ]
  );

  useEffect(() => {
    if (
      !searchActive ||
      !submittedSearch ||
      submittedSearch.source === 'all' ||
      searchQuery.trim() !== submittedSearch.query
    )
      return;
    const results = [
      singleSearchQuery.error instanceof SearchPageError
        ? singleSearchQuery.error.result
        : singleSearchQuery.data?.pages.at(-1)
    ];
    results.forEach((result) => {
      if (!result || result.kind !== 'action-required') return;
      if (handledSearchActionsRef.current.has(result)) return;
      handledSearchActionsRef.current.add(result);
      if (result.action.type === 'linuxdo-verification') {
        if (submittedSearch?.source !== 'linuxdo') return;
        const loadMore = singleSearchQuery.isFetchNextPageError;
        const recovery: LinuxDoReadRecovery = {
          queryKey: singleSearchKey,
          resume: async () => {
            const resumed = loadMore
              ? await singleSearchQuery.fetchNextPage({ cancelRefetch: false })
              : await singleSearchQuery.refetch({ cancelRefetch: false });
            if (resumed.isError) {
              if (
                resumed.error instanceof SearchPageError &&
                resumed.error.result.kind === 'action-required' &&
                resumed.error.result.action.type === 'linuxdo-verification'
              ) {
                handledSearchActionsRef.current.add(resumed.error.result);
                return 'verification-required';
              }
              return sourceReadRecoveryOutcome('linuxdo', resumed.error);
            }
            const resumedResult = loadMore ? resumed.data?.pages.at(-1) : resumed.data?.pages[0];
            return resumedResult?.kind === 'success' ? 'completed' : 'failed';
          }
        };
        void showLinuxDoVerification(result.action.message, recovery);
      } else if (result.action.type === 'nodeseek-verification') {
        const loadMore = singleSearchQuery.isFetchNextPageError;
        requireNodeSeekSearchVerification(result.action.message, {
          queryKey: singleSearchKey,
          resume: async () => {
            const resumed = loadMore
              ? await singleSearchQuery.fetchNextPage({ cancelRefetch: false })
              : await singleSearchQuery.refetch({ cancelRefetch: false });
            if (resumed.isError) {
              if (
                resumed.error instanceof SearchPageError &&
                resumed.error.result.kind === 'action-required' &&
                resumed.error.result.action.type === 'nodeseek-verification'
              ) {
                handledSearchActionsRef.current.add(resumed.error.result);
                return 'verification-required';
              }
              return sourceReadRecoveryOutcome('nodeseek', resumed.error);
            }
            const resumedResult = loadMore ? resumed.data?.pages.at(-1) : resumed.data?.pages[0];
            return resumedResult?.kind === 'success' ? 'completed' : 'failed';
          }
        });
      } else if (submittedSearch?.source !== 'all') {
        showYaohuoLogin(result.action.message);
      }
    });
  }, [
    requireNodeSeekSearchVerification,
    showLinuxDoVerification,
    showYaohuoLogin,
    singleSearchKey,
    singleSearchQuery.data?.pages,
    singleSearchQuery.error,
    singleSearchQuery.errorUpdatedAt,
    singleSearchQuery.fetchNextPage,
    singleSearchQuery.isFetchNextPageError,
    singleSearchQuery.refetch,
    searchQuery,
    searchActive,
    submittedSearch
  ]);

  const runSearch = useCallback(
    async (options?: SearchRunInput): Promise<LinuxDoReadResumeOutcome> => {
      if (!searchActive) return 'stale';
      const runOptions = typeof options === 'string' ? { sourceOverride: options } : options || {};
      if ('sourceOverride' in runOptions && runOptions.sourceOverride) {
        retrySearchSource(runOptions.sourceOverride as Source);
        return 'completed';
      }
      const query = (runOptions.query ?? searchQuery).trim();
      if (!query) {
        notify('请输入搜索词');
        return 'completed';
      }
      const source = runOptions.source ?? searchSource;
      const filters = snapshotSearchFilters(runOptions.filters ?? searchFilters);
      if (runOptions.query !== undefined) setSearchQuery(query);
      if (runOptions.source !== undefined) setSearchSourceState(source);
      addRecentSearch(query);
      setLinuxDoAiEnabled(false);
      const next = { query, source, filters };
      const same =
        submittedSearch &&
        submittedSearch.query === query &&
        submittedSearch.source === source &&
        JSON.stringify(submittedSearch.filters) === JSON.stringify(filters);
      if (same) {
        if (source === 'all') {
          aggregateQueries.forEach((result, index) => {
            if (!isSourceIdentityPending(aggregateSearchSources[index], sessionViewModels)) {
              void result.refetch({ cancelRefetch: false });
            }
          });
        } else if (!isSourceIdentityPending(source, sessionViewModels)) {
          void singleSearchQuery.refetch({ cancelRefetch: false });
        }
      } else {
        setSubmittedSearch(next);
      }
      return 'completed';
    },
    [
      addRecentSearch,
      aggregateQueries,
      notify,
      retrySearchSource,
      searchActive,
      searchFilters,
      searchQuery,
      searchSource,
      sessionViewModels,
      singleSearchQuery.refetch,
      submittedSearch
    ]
  );

  useEffect(() => {
    if (submittedSearch && searchQuery.trim() !== submittedSearch.query) {
      setSubmittedSearch(null);
      setLinuxDoAiEnabled(false);
    }
  }, [searchQuery, submittedSearch]);

  useEffect(() => {
    if (!sessionViewModels.linuxdo.isLoggedIn) setLinuxDoAiEnabled(false);
  }, [sessionViewModels.linuxdo.isLoggedIn]);

  const setSearchSource = useCallback(
    (source: FeedSource) => {
      setSearchSourceState(() => source);
      setLinuxDoAiEnabled(false);
      setSubmittedSearch((current) =>
        current && current.query === searchQuery.trim()
          ? { ...current, source, filters: snapshotSearchFilters(searchFilters) }
          : current
      );
    },
    [searchFilters, searchQuery]
  );

  const applySearchFilter = useCallback(
    (source: Source, filter: SourceSearchFilter) => {
      const next = { ...searchFilters, [source]: filter };
      setSearchFilters(next);
      setSubmittedSearch((submitted) =>
        submitted && submitted.source === source && submitted.query === searchQuery.trim()
          ? { ...submitted, filters: snapshotSearchFilters(next) }
          : submitted
      );
      setLinuxDoAiEnabled(false);
    },
    [searchFilters, searchQuery]
  );

  const searchDiscourseTags = useCallback(
    async (options: Omit<Parameters<ReadGateway['searchTagOptions']>[0], 'source'> & { source?: DiscourseSource }) => {
      const source = options.source || 'linuxdo';
      const { source: _source, ...request } = options;
      const trace = beginDiagnosticTrace('search', 'searchTagOptions', { source });
      markDiagnosticStage(trace, 'guard', {
        source,
        state: 'started',
        hasQuery: Boolean(options.query?.trim()),
        selectedCount: options.selectedTags?.length || 0
      });
      try {
        const items = await readGateway.searchTagOptions({ source, ...request }, { trace });
        markDiagnosticStage(trace, 'apply', { source, itemCount: items.length });
        finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length });
        return items;
      } catch (error) {
        finishDiagnosticTrace(trace, options.signal?.aborted ? 'canceled' : 'failure', {
          source,
          reason: options.signal?.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    },
    [readGateway]
  );

  const searchDiscourseUsers = useCallback(
    async (options: Omit<Parameters<ReadGateway['searchUserOptions']>[0], 'source'> & { source?: DiscourseSource }) => {
      const source = options.source || 'linuxdo';
      const { source: _source, ...request } = options;
      const trace = beginDiagnosticTrace('search', 'searchUserOptions', { source });
      markDiagnosticStage(trace, 'guard', { source, state: 'started', hasQuery: Boolean(options.term.trim()) });
      try {
        const items = await readGateway.searchUserOptions({ source, ...request }, { trace });
        markDiagnosticStage(trace, 'apply', { source, itemCount: items.length });
        finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length });
        return items;
      } catch (error) {
        finishDiagnosticTrace(trace, options.signal?.aborted ? 'canceled' : 'failure', {
          source,
          reason: options.signal?.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    },
    [readGateway]
  );

  const toggleLinuxDoAiSearch = useCallback(() => {
    if (linuxDoAiState.status === 'ready') setLinuxDoAiEnabled((current) => !current);
  }, [linuxDoAiState.status]);
  const retryLinuxDoAiSearch = useCallback(() => {
    if (
      searchActive &&
      !linuxDoVerificationActive &&
      !isSourceIdentityPending('linuxdo', sessionViewModels) &&
      linuxDoAiQuery.isError
    ) {
      void linuxDoAiQuery.refetch({ cancelRefetch: false });
    }
  }, [linuxDoAiQuery.isError, linuxDoAiQuery.refetch, linuxDoVerificationActive, searchActive, sessionViewModels]);
  const abortSearchRequests = useCallback(() => {
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === 'forum' &&
        typeof queryKey[2] === 'string' &&
        (queryKey[2].startsWith('search') || queryKey[2] === 'semantic-search')
    });
  }, [queryClient]);
  useEffect(() => {
    if (!searchActive) abortSearchRequests();
  }, [abortSearchRequests, searchActive]);
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
    searchBusy:
      !searchActive || !submittedSearch
        ? false
        : submittedSearch.source === 'all'
          ? aggregateQueries.some(
              (query, index) =>
                !isSourceIdentityPending(aggregateSearchSources[index], sessionViewModels) && query.isPending
            )
          : singleSearchQuery.isFetching,
    searchFilters,
    searchGroups,
    searchDiscourseTags,
    searchDiscourseUsers,
    linuxDoAiState,
    linuxDoAiVisible,
    searchSessionNotices,
    searchQuery,
    searchSource,
    submittedSearchQuery: submittedSearch?.query || '',
    setSearchQuery,
    setSearchSource,
    toggleLinuxDoAiSearch
  };
}
