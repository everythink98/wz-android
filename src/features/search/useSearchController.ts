import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createSearchRecoveryOwner } from './searchRecoveryOwner';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';
import {
  hashKey,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseQueryResult
} from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isDiscourseSource,
  isSessionSource,
  type DiscourseSource,
  type SessionSource
} from '@/domain/forum/sourceCatalog';
import { mergeTopics, type SearchSort } from '@/domain/forum/feed';
import {
  buildDiscourseSearchQuery,
  DEFAULT_SEARCH_FILTERS,
  type SearchFilterState,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import {
  normalizeSearchHistory,
  normalizeSearchHistoryEntry,
  sameSearchHistory,
  searchHistoryFromRaw
} from './history';
import type { ReadGateway } from '@/sources/readGateway';
import type { ForumReadPlan } from '@/domain/forum/readPlan';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { sourceLabel } from '@/domain/forum/presentation';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import {
  sourceErrorFromUnknown,
  sourceReadRecoveryOutcome,
  yaohuoErrorRequiresLoginPanel
} from '@/sources/sourceErrors';
import { authNoticeForSource, authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { Category, FeedSource, Source, SourceErrorInfo } from '@/domain/forum/models';
import {
  groupFromRemoteSearchResult,
  nextSearchPage,
  type RemoteSearchSourceResult,
  type SearchGroup
} from './listItems';
import { linuxDoAiFailureState, mergeLinuxDoAiTopics, type LinuxDoAiSearchState } from './aiSearch';
import { remoteSearchSort, snapshotSearchFilters, type SearchRunOptions } from './searchRun';
import {
  buildExternalForumSearchUrl,
  isExternalForumSearchSource,
  type ExternalForumSearchSource
} from '@/domain/forum/externalSearch';
import type {
  AccountReconcileResult,
  LinuxDoReadRecovery,
  LinuxDoReadResumeOutcome
} from '@/domain/session/sessionContracts';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import { useFirstPageInfiniteQuery } from '@/platform/query/useFirstPageInfiniteQuery';
import { RequestCanceledError } from '@/platform/network/request';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';

const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';

type RecentSearchHistoryOwner = {
  read: 'waiting' | 'retryable' | 'hydrated';
  pending?: string[];
  stored: string[];
  removedKeys: Set<string>;
  writer: ReturnType<typeof createKeyedSerialRunner<null>>;
};
type SubmittedSearch = {
  filters: SearchFilterState;
  query: string;
  source: FeedSource;
};
type AggregateSearchQueryProjection = Pick<
  UseQueryResult<RemoteSearchSourceResult>,
  'data' | 'dataUpdatedAt' | 'error' | 'errorUpdatedAt' | 'isFetching' | 'isPending' | 'refetch'
>;

function combineAggregateSearchQueries(results: AggregateSearchQueryProjection[]): AggregateSearchQueryProjection[] {
  return results.map(({ data, dataUpdatedAt, error, errorUpdatedAt, isFetching, isPending, refetch }) => ({
    data,
    dataUpdatedAt,
    error,
    errorUpdatedAt,
    isFetching,
    isPending,
    refetch
  }));
}

async function runSearchOptions<Item>(
  source: DiscourseSource,
  trace: DiagnosticTrace,
  signal: AbortSignal | undefined,
  read: () => Promise<Item[]>
) {
  try {
    const items = await read();
    markDiagnosticStage(trace, 'apply', { source, itemCount: items.length });
    finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length });
    return items;
  } catch (error) {
    finishDiagnosticTrace(trace, signal?.aborted ? 'canceled' : 'failure', {
      source,
      reason: signal?.aborted ? 'canceled' : normalizeDiagnosticReason(error)
    });
    throw error;
  }
}

function firstSearchPageData(result: RemoteSearchSourceResult): InfiniteData<RemoteSearchSourceResult, number> {
  return { pages: [result], pageParams: [1] };
}

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

function searchErrorKind(error?: SourceErrorInfo): SearchGroup['errorKind'] {
  return error?.reason === 'query-too-short' ? 'invalid-query' : error?.kind;
}

function searchGroupForUnexpectedError(source: Source, error: unknown): SearchGroup {
  const sourceError = sourceErrorFromUnknown(source, error);
  return {
    source,
    label: sourceLabel(source),
    items: [],
    error: sourceError.message,
    errorKind: searchErrorKind(sourceError),
    authNotice: authNoticeForSourceError(sourceError) || undefined,
    hasMore: false,
    nextPage: null
  };
}

function mergeSearchPages(pages: RemoteSearchSourceResult[]): SearchGroup | null {
  if (!pages.length) {
    return null;
  }
  const groups = pages.map(groupFromRemoteSearchResult);
  return {
    ...groups.at(-1)!,
    items: mergeTopics(
      groups[0].items,
      groups.flatMap((group) => group.items)
    ),
    authNotice: groups.reduce((notice, group) => group.authNotice || notice, groups[0].authNotice)
  };
}

function externalSearchUrlForPlan(plan: ForumReadPlan, query: string) {
  return query.trim() && searchPlanUsesExternalBrowser(plan)
    ? buildExternalForumSearchUrl(plan.source, query)
    : undefined;
}

function searchPlanUsesExternalBrowser(
  plan: ForumReadPlan
): plan is ForumReadPlan & { source: ExternalForumSearchSource } {
  return plan.state === 'ready' && plan.lane === 'public' && isExternalForumSearchSource(plan.source);
}

export function useSearchController({
  active,
  categories,
  enabledSearchSources,
  sessionEpochs = initialForumSessionEpochs,
  linuxDoVerificationActive,
  notify,
  onOpenExternalSearch,
  onNodeSeekSearchVerificationRequired,
  reconcileIdentityStatus,
  sessionViewModels,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  readGateway
}: {
  active: boolean;
  categories: Category[];
  enabledSearchSources: readonly Source[];
  sessionEpochs?: ForumSessionEpochs;
  linuxDoVerificationActive: boolean;
  notify: (message: string) => void;
  onOpenExternalSearch?: (url: string) => void | Promise<void>;
  onNodeSeekSearchVerificationRequired?: (message: string, recovery: LinuxDoReadRecovery) => void;
  reconcileIdentityStatus: (source: SessionSource) => Promise<AccountReconcileResult>;
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
  const aggregateSources = enabledSearchSources;
  const recentSearchHistoryRef = useRef<RecentSearchHistoryOwner>({
    read: 'waiting',
    stored: [],
    writer: createKeyedSerialRunner<null>('after-reaction'),
    removedKeys: new Set<string>()
  });
  const [searchRecovery] = useState(createSearchRecoveryOwner);
  const yaohuoLoginHandledRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSource, setSearchSourceState] = useState<FeedSource>('all');
  const [searchFilters, setSearchFilters] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(null);
  const [linuxDoAiEnabled, setLinuxDoAiEnabled] = useState(false);
  const [{ entries: recentSearches, writeFailed }, setRecentSearchHistory] = useState<{
    entries: string[];
    writeFailed: boolean;
  }>({ entries: [], writeFailed: false });
  const [recentSearchWritePermission, setRecentSearchWritePermission] = useState<'protected' | 'writable'>('protected');
  const [recentSearchHistoryReadAttempt, setRecentSearchHistoryReadAttempt] = useState(0);
  useEffect(() => {
    if (!searchActive || !writeFailed) return;
    notify('最近搜索保存失败，已恢复上次保存的记录。');
    setRecentSearchHistory((current) => ({ ...current, writeFailed: false }));
  }, [notify, searchActive, writeFailed]);
  const enabledSearchSourcesRef = useRef(enabledSearchSources);
  useCommitRefValue(enabledSearchSourcesRef, enabledSearchSources);
  const searchSourceIncluded = searchSource === 'all' || enabledSearchSources.includes(searchSource);
  const submittedSearchSourceIncluded =
    !submittedSearch || submittedSearch.source === 'all' || enabledSearchSources.includes(submittedSearch.source);
  useLayoutEffect(() => {
    if (searchSourceIncluded && submittedSearchSourceIncluded) return;
    if (!searchSourceIncluded) setSearchSourceState('all');
    if (!submittedSearchSourceIncluded) {
      setSubmittedSearch((current) => (current && current.source !== 'all' ? { ...current, source: 'all' } : current));
    }
    setLinuxDoAiEnabled(false);
  }, [searchSourceIncluded, submittedSearchSourceIncluded]);
  useEffect(() => {
    let observation: 'live' | 'retired' = 'live';
    if (recentSearchHistoryRef.current.read !== 'hydrated') recentSearchHistoryRef.current.read = 'waiting';
    AsyncStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (observation === 'retired') return;
        const storedHistory = searchHistoryFromRaw(raw);
        const removedKeys = new Set(recentSearchHistoryRef.current.removedKeys);
        recentSearchHistoryRef.current.read = 'hydrated';
        recentSearchHistoryRef.current.removedKeys.clear();
        recentSearchHistoryRef.current.stored = storedHistory;
        setRecentSearchHistory((current) => {
          const merged = normalizeSearchHistory([...current.entries, ...storedHistory], removedKeys);
          return sameSearchHistory(current.entries, merged) ? current : { ...current, entries: merged };
        });
        setRecentSearchWritePermission('writable');
      })
      .catch(() => {
        if (observation === 'live' && recentSearchHistoryRef.current.read !== 'hydrated') {
          recentSearchHistoryRef.current.read = 'retryable';
        }
      });
    return () => {
      observation = 'retired';
    };
  }, [recentSearchHistoryReadAttempt]);

  useEffect(() => {
    if (recentSearchWritePermission !== 'writable') return;
    const owner = recentSearchHistoryRef.current;
    if (sameSearchHistory(owner.pending ?? owner.stored, recentSearches)) return;
    const next = recentSearches;
    owner.pending = next;
    void owner.writer
      .run(null, async () => {
        await AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
        owner.stored = next;
        if (owner.pending === next) owner.pending = undefined;
      })
      .catch(() => {
        if (owner.pending !== next) return;
        owner.pending = undefined;
        const stored = owner.stored;
        setRecentSearchHistory((current) =>
          sameSearchHistory(current.entries, next) ? { entries: stored, writeFailed: true } : current
        );
      });
  }, [recentSearches, recentSearchWritePermission]);

  const retryRecentSearchHistoryRead = useCallback(() => {
    if (recentSearchHistoryRef.current.read === 'retryable') {
      recentSearchHistoryRef.current.read = 'waiting';
      setRecentSearchHistoryReadAttempt((current) => current + 1);
    }
  }, []);

  const addRecentSearch = useCallback(
    (query: string) => {
      const { query: clean, key } = normalizeSearchHistoryEntry(query);
      if (!clean) return;
      recentSearchHistoryRef.current.removedKeys.delete(key);
      retryRecentSearchHistoryRead();
      setRecentSearchHistory((current) => ({
        ...current,
        entries: normalizeSearchHistory([clean, ...current.entries])
      }));
    },
    [retryRecentSearchHistoryRead]
  );

  const removeRecentSearch = useCallback(
    (query: string) => {
      const { key } = normalizeSearchHistoryEntry(query);
      if (recentSearchHistoryRef.current.read !== 'hydrated') {
        recentSearchHistoryRef.current.removedKeys.add(key);
      }
      retryRecentSearchHistoryRead();
      setRecentSearchHistory((current) => ({
        ...current,
        entries: current.entries.filter((item) => normalizeSearchHistoryEntry(item).key !== key)
      }));
    },
    [retryRecentSearchHistoryRead]
  );

  const runRemoteSearchSource = useCallback(
    async (
      plan: ForumReadPlan,
      query: string,
      page: number,
      signal: AbortSignal,
      sort: SearchSort,
      filter: SourceSearchFilter | undefined
    ): Promise<RemoteSearchSourceResult> => {
      const source = plan.source;
      const trace = beginDiagnosticTrace('search', page > 1 ? 'load-more' : 'run', { source, page });
      const sourceStatusNotice =
        plan.state === 'ready' && plan.lane === 'public'
          ? undefined
          : authNoticeForSource(source, sessionViewModels, 'search') || undefined;
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
          { plan, trace }
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
        const nextPage = sourceError ? undefined : nextSearchPage(data, page);
        const group: SearchGroup = {
          source,
          label: sourceLabel(source),
          items: data.items,
          authNotice: sourceError ? authNoticeForSourceError(sourceError) || undefined : sourceStatusNotice,
          error: sourceError?.message,
          errorKind: searchErrorKind(sourceError),
          hasMore: nextPage !== undefined,
          nextPage: nextPage ?? null
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
        let sourceError = sourceErrorFromUnknown(source, error);
        if (
          source === 'linuxdo' &&
          plan.state === 'ready' &&
          plan.lane === 'authenticated' &&
          sourceError.kind === 'ordinary' &&
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          error.status === 429
        ) {
          const reconciliation = await reconcileIdentityStatus(source);
          if (signal.aborted) {
            finishDiagnosticTrace(trace, 'canceled', { source, reason: 'canceled' });
            throw new RequestCanceledError();
          }
          const currentPlan = readGateway.getReadPlan(source, 'search');
          if (
            currentPlan.cacheScope !== plan.cacheScope ||
            reconciliation.status === 'anonymous' ||
            reconciliation.status === 'changed'
          ) {
            finishDiagnosticTrace(trace, 'stale', { source, reason: 'superseded' });
            throw new RequestCanceledError();
          }
          if (reconciliation.status === 'unknown') {
            sourceError = {
              ...sourceError,
              message: 'linux.do 登录状态暂时无法确认；原站搜索同时返回频控，请稍后重试。'
            };
          }
        }
        const group: SearchGroup = {
          source,
          label: sourceLabel(source),
          items: [],
          error: sourceError.message,
          errorKind: searchErrorKind(sourceError),
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
    [categories, reconcileIdentityStatus, sessionViewModels, readGateway]
  );

  const submittedSource = submittedSearch?.source === 'all' ? 'v2ex' : submittedSearch?.source || 'v2ex';
  const submittedFilter = submittedSearch?.source === 'all' ? undefined : submittedSearch?.filters[submittedSource];
  const submittedSort = submittedSearch
    ? remoteSearchSort(submittedSearch.source, submittedSearch.filters)
    : 'relevance';
  const singleSearchPlan = readGateway.getReadPlan(submittedSource, 'search');
  const singleExternalSearchUrl = externalSearchUrlForPlan(singleSearchPlan, submittedSearch?.query || '');
  const singleSearchKey = useMemo(
    () =>
      forumQueryKeys.search({
        source: singleSearchPlan.source,
        lane: 'pages',
        query: submittedSearch?.query || '',
        readPlanScope: singleSearchPlan.cacheScope,
        sort: submittedSort,
        filter: submittedFilter,
        scope: sessionEpochs
      }),
    [
      submittedSource,
      submittedSearch?.query,
      singleSearchPlan.cacheScope,
      submittedSort,
      submittedFilter,
      sessionEpochs
    ]
  );

  const aggregatePlans = aggregateSources.map((source) => readGateway.getReadPlan(source, 'search'));
  const externalSearchSources = aggregatePlans.filter(searchPlanUsesExternalBrowser).map((plan) => plan.source);
  const aggregateExternalSearchUrls = aggregatePlans.map((plan) =>
    externalSearchUrlForPlan(plan, submittedSearch?.query || '')
  );
  const aggregateExternalSearchKey = aggregateExternalSearchUrls.join('\u0000');
  const aggregateSorts = aggregateSources.map((source) => remoteSearchSort(source, DEFAULT_SEARCH_FILTERS));
  const aggregateKeys = aggregateSources.map((source, index) => {
    const plan = aggregatePlans[index];
    return forumQueryKeys.search({
      source,
      lane: 'preview',
      query: submittedSearch?.query || '',
      readPlanScope: plan.cacheScope,
      sort: aggregateSorts[index],
      filter: DEFAULT_SEARCH_FILTERS[source],
      scope: sessionEpochs
    });
  });
  const aggregatePageKeys = aggregateSources.map((source, index) => {
    const plan = aggregatePlans[index];
    return forumQueryKeys.search({
      source,
      lane: 'pages',
      query: submittedSearch?.query || '',
      readPlanScope: plan.cacheScope,
      sort: aggregateSorts[index],
      filter: DEFAULT_SEARCH_FILTERS[source],
      scope: sessionEpochs
    });
  });
  const searchReadScope = hashKey(submittedSearch?.source === 'all' ? aggregateKeys : singleSearchKey);
  const activeSearchRead = useRef<string | null>(null);
  useLayoutEffect(() => {
    activeSearchRead.current = searchActive ? searchReadScope : null;
    return () => {
      activeSearchRead.current = null;
    };
  }, [searchActive, searchReadScope]);
  const searchReadIsCurrent = useCallback(() => activeSearchRead.current === searchReadScope, [searchReadScope]);
  const aggregateQueries = useQueries({
    queries: aggregateSources.map((source, index) => ({
      queryKey: aggregateKeys[index],
      enabled: Boolean(
        searchActive &&
        submittedSearch?.query &&
        submittedSearch.source === 'all' &&
        !aggregateExternalSearchUrls[index]
      ),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const result = await runRemoteSearchSource(
          aggregatePlans[index],
          submittedSearch?.query || '',
          1,
          signal,
          aggregateSorts[index],
          DEFAULT_SEARCH_FILTERS[source]
        );
        if (result.kind !== 'success') {
          throw new SearchPageError(1, result);
        }
        return result;
      }
    })),
    combine: combineAggregateSearchQueries
  });

  const promoteAggregateSearchPage = useCallback(
    (source: Source) => {
      if (submittedSearch?.source !== 'all' || submittedSearch.query !== searchQuery.trim()) return;
      const index = aggregateSources.indexOf(source);
      if (index < 0 || aggregateExternalSearchUrls[index]) return;
      const preview = aggregateQueries[index];
      const pageKey = aggregatePageKeys[index];
      if (!preview?.data || preview.data.kind !== 'success' || preview.error || preview.isFetching || !pageKey) return;
      const targetKey = forumQueryKeys.search({
        source,
        lane: 'pages',
        query: submittedSearch.query,
        readPlanScope: readGateway.getReadPlan(source, 'search').cacheScope,
        sort: remoteSearchSort(source, searchFilters),
        filter: searchFilters[source],
        scope: sessionEpochs
      });
      if (hashKey(pageKey) !== hashKey(targetKey)) return;
      const targetState = queryClient.getQueryState(targetKey);
      if (targetState?.data !== undefined) return;
      queryClient.setQueryData<InfiniteData<RemoteSearchSourceResult, number>>(
        targetKey,
        firstSearchPageData(preview.data),
        { updatedAt: preview.dataUpdatedAt }
      );
    },
    [
      aggregatePageKeys,
      aggregateQueries,
      aggregateExternalSearchUrls,
      aggregateSources,
      queryClient,
      readGateway,
      searchFilters,
      searchQuery,
      sessionEpochs,
      submittedSearch
    ]
  );

  const [singleSearchQuery, refreshSearchFirstPage] = useFirstPageInfiniteQuery<RemoteSearchSourceResult, number>({
    queryKey: singleSearchKey,
    enabled: Boolean(
      searchActive &&
      submittedSearch?.query &&
      submittedSearch.source !== 'all' &&
      submittedSearchSourceIncluded &&
      !singleExternalSearchUrl
    ),
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      const result = await runRemoteSearchSource(
        singleSearchPlan,
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
      return nextSearchPage(group, lastPageParam);
    }
  });

  const aggregateGroups = useMemo(
    () =>
      aggregateSources.map((source, index): SearchGroup => {
        const externalSearchUrl = aggregateExternalSearchUrls[index];
        if (externalSearchUrl) {
          return {
            source,
            label: sourceLabel(source),
            items: [],
            externalSearchUrl,
            settled: true,
            hasMore: false,
            nextPage: null
          };
        }
        const query = aggregateQueries[index];
        if (query.error) {
          const failed =
            query.error instanceof SearchPageError
              ? groupFromRemoteSearchResult(query.error.result)
              : searchGroupForUnexpectedError(source, query.error);
          if (query.data) {
            return {
              ...groupFromRemoteSearchResult(query.data),
              authNotice: failed.authNotice,
              error: failed.error,
              errorKind: failed.errorKind,
              retainedResults: { retryPage: null },
              loading: query.isFetching
            };
          }
          return { ...failed, loading: query.isFetching };
        }
        if (query.data) {
          return { ...groupFromRemoteSearchResult(query.data), loading: query.isFetching };
        }
        return {
          source,
          label: sourceLabel(source),
          items: [],
          settled: false,
          loading: Boolean(searchActive && submittedSearch?.query && submittedSearch.source === 'all')
        };
      }),
    [
      aggregateExternalSearchKey,
      aggregateQueries,
      aggregateSources,
      searchActive,
      submittedSearch?.query,
      submittedSearch?.source
    ]
  );
  const mergedSinglePages = useMemo(
    () => mergeSearchPages(singleSearchQuery.data?.pages || []),
    [singleSearchQuery.data?.pages]
  );
  const singleGroup = useMemo<SearchGroup | null>(() => {
    if (!submittedSearchSourceIncluded) return null;
    if (singleExternalSearchUrl) {
      return {
        source: submittedSource,
        label: sourceLabel(submittedSource),
        items: [],
        externalSearchUrl: singleExternalSearchUrl,
        settled: true,
        hasMore: false,
        nextPage: null
      };
    }
    let merged = mergedSinglePages;
    const error = singleSearchQuery.error;
    if (merged && error) {
      const failed =
        error instanceof SearchPageError
          ? groupFromRemoteSearchResult(error.result)
          : searchGroupForUnexpectedError(submittedSource, error);
      const retryPage = singleSearchQuery.isFetchNextPageError && error instanceof SearchPageError ? error.page : null;
      merged = {
        ...merged,
        error: failed.error,
        errorKind: failed.errorKind,
        authNotice: failed.authNotice || merged.authNotice,
        retainedResults: { retryPage }
      };
    }
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
        ...searchGroupForUnexpectedError(submittedSource, singleSearchQuery.error),
        loading: singleSearchQuery.isFetching
      };
    }
    return null;
  }, [
    mergedSinglePages,
    singleSearchQuery.error,
    singleSearchQuery.isFetchNextPageError,
    singleSearchQuery.isFetching,
    singleSearchQuery.isFetchingNextPage,
    submittedSearchSourceIncluded,
    submittedSource,
    singleExternalSearchUrl
  ]);
  const baseSearchGroups = useMemo(
    () =>
      submittedSearch?.source === 'all'
        ? aggregateGroups
        : submittedSearchSourceIncluded && singleGroup
          ? [singleGroup]
          : [],
    [aggregateGroups, singleGroup, submittedSearch?.source, submittedSearchSourceIncluded]
  );

  const linuxDoAiVisible = Boolean(
    aggregateSources.includes('linuxdo') &&
    submittedSearch?.query &&
    submittedSearch.source === 'linuxdo' &&
    submittedSearch.filters.linuxdo.order === 'relevance' &&
    sessionViewModels.linuxdo.isLoggedIn
  );
  const linuxDoAiFullQuery =
    linuxDoAiVisible && submittedSearch
      ? buildDiscourseSearchQuery(submittedSearch.query, submittedSearch.filters.linuxdo, categories)
      : '';
  const linuxDoSemanticPlan = readGateway.getReadPlan('linuxdo', 'semantic-search');
  const linuxDoAiQuery = useQuery({
    queryKey: forumQueryKeys.semanticSearch(linuxDoAiFullQuery, sessionEpochs, linuxDoSemanticPlan.cacheScope),
    enabled: Boolean(
      searchActive &&
      aggregateSources.includes('linuxdo') &&
      !linuxDoVerificationActive &&
      linuxDoAiFullQuery &&
      linuxDoSemanticPlan.state === 'ready'
    ),
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('search', 'searchSemanticTopics', { source: 'linuxdo' });
      try {
        markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'started' });
        const result = await readGateway.searchSemanticTopics(
          { source: 'linuxdo', query: linuxDoAiFullQuery, signal },
          { plan: linuxDoSemanticPlan, trace }
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
      predicate: ({ queryKey }) =>
        queryKey[0] === 'forum' &&
        queryKey[1] === 'linuxdo' &&
        (queryKey[2] === 'semantic-search' || queryKey[2] === 'search-tags' || queryKey[2] === 'search-users')
    });
  }, [linuxDoVerificationActive, queryClient]);
  const linuxDoAiState = useMemo<LinuxDoAiSearchState>(() => {
    if (!linuxDoAiVisible) return { status: 'idle', enabled: false, count: 0 };
    if (linuxDoSemanticPlan.state === 'blocked') return { status: 'idle', enabled: false, count: 0 };
    if (linuxDoAiQuery.isPending || (linuxDoAiQuery.isError && linuxDoAiQuery.isFetching))
      return { status: 'loading', enabled: false, count: 0 };
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
    linuxDoAiQuery.isFetching,
    linuxDoAiQuery.isPending,
    linuxDoSemanticPlan.state,
    linuxDoAiVisible
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
      if (!searchReadIsCurrent() || !enabledSearchSourcesRef.current.includes(source)) return;
      const plan = readGateway.getReadPlan(source, 'search');
      if (searchPlanUsesExternalBrowser(plan)) return;
      searchRecovery.newIntent();
      if (source === 'yaohuo') yaohuoLoginHandledRef.current = false;
      if (
        plan.state === 'blocked' &&
        (plan.reason === 'identity-pending' || plan.reason === 'identity-unavailable') &&
        isSessionSource(source)
      ) {
        void reconcileIdentityStatus(source);
        return;
      }
      if (submittedSearch?.source === 'all') {
        const index = aggregateSources.indexOf(source);
        if (index >= 0) void aggregateQueries[index].refetch({ cancelRefetch: false });
        return;
      }
      if (source !== submittedSource) return;
      if (singleSearchQuery.isFetchNextPageError) {
        void singleSearchQuery.fetchNextPage({ cancelRefetch: false });
      } else {
        void refreshSearchFirstPage();
      }
    },
    [
      aggregateQueries,
      aggregateSources,
      reconcileIdentityStatus,
      readGateway,
      searchReadIsCurrent,
      singleSearchQuery.fetchNextPage,
      singleSearchQuery.isFetchNextPageError,
      refreshSearchFirstPage,
      submittedSearch?.source,
      submittedSource,
      searchRecovery
    ]
  );

  const loadMoreSearchSource = useCallback(
    async (source: Source, page: number): Promise<LinuxDoReadResumeOutcome> => {
      if (
        !searchReadIsCurrent() ||
        !enabledSearchSourcesRef.current.includes(source) ||
        submittedSearch?.source === 'all' ||
        source !== submittedSource
      ) {
        return 'stale';
      }
      const current = queryClient.getQueryState<InfiniteData<RemoteSearchSourceResult, number>>(singleSearchKey);
      if (!current || current.fetchStatus !== 'idle') return 'stale';
      const last = current.data?.pages.at(-1);
      const group = last ? groupFromRemoteSearchResult(last) : null;
      const retryPage =
        current.status === 'error' &&
        current.fetchMeta?.fetchMore?.direction === 'forward' &&
        current.error instanceof SearchPageError
          ? current.error.page
          : group?.nextPage;
      if (retryPage !== page) return 'stale';
      const result = await singleSearchQuery.fetchNextPage({ cancelRefetch: false });
      if (!searchReadIsCurrent()) return 'stale';
      return result.isError ? 'failed' : 'completed';
    },
    [
      queryClient,
      searchReadIsCurrent,
      singleSearchKey,
      singleSearchQuery.fetchNextPage,
      submittedSearch?.source,
      submittedSource
    ]
  );

  const recoveryScope =
    searchActive &&
    submittedSearch &&
    submittedSearchSourceIncluded &&
    submittedSearch.source !== 'all' &&
    searchQuery.trim() === submittedSearch.query
      ? JSON.stringify(singleSearchKey)
      : null;
  useLayoutEffect(() => {
    searchRecovery.observe(recoveryScope);
    return () => searchRecovery.observe(null);
  }, [recoveryScope, searchRecovery]);
  useEffect(() => {
    if (
      !searchActive ||
      !submittedSearch ||
      !submittedSearchSourceIncluded ||
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
      if (result?.kind === 'success' && submittedSearch.source === 'yaohuo') {
        yaohuoLoginHandledRef.current = false;
        return;
      }
      if (!result || result.kind !== 'action-required') return;
      if (!searchRecovery.accept(result)) return;
      const recoveryTicket = searchRecovery.capture();
      if (result.action.type === 'linuxdo-verification') {
        if (submittedSearch?.source !== 'linuxdo') return;
        const loadMore = singleSearchQuery.isFetchNextPageError;
        const recovery: LinuxDoReadRecovery = {
          queryKey: singleSearchKey,
          resume: async () => {
            if (!searchRecovery.current(recoveryTicket) || !enabledSearchSourcesRef.current.includes('linuxdo'))
              return 'stale';
            const resumed = loadMore
              ? await singleSearchQuery.fetchNextPage({ cancelRefetch: false })
              : await refreshSearchFirstPage();
            if (!searchRecovery.current(recoveryTicket)) return 'stale';
            if (resumed.isError) {
              if (
                resumed.error instanceof SearchPageError &&
                resumed.error.result.kind === 'action-required' &&
                resumed.error.result.action.type === 'linuxdo-verification'
              ) {
                searchRecovery.remember(resumed.error.result);
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
            if (!searchRecovery.current(recoveryTicket) || !enabledSearchSourcesRef.current.includes('nodeseek'))
              return 'stale';
            const resumed = loadMore
              ? await singleSearchQuery.fetchNextPage({ cancelRefetch: false })
              : await refreshSearchFirstPage();
            if (!searchRecovery.current(recoveryTicket)) return 'stale';
            if (resumed.isError) {
              if (
                resumed.error instanceof SearchPageError &&
                resumed.error.result.kind === 'action-required' &&
                resumed.error.result.action.type === 'nodeseek-verification'
              ) {
                searchRecovery.remember(resumed.error.result);
                return 'verification-required';
              }
              return sourceReadRecoveryOutcome('nodeseek', resumed.error);
            }
            const resumedResult = loadMore ? resumed.data?.pages.at(-1) : resumed.data?.pages[0];
            return resumedResult?.kind === 'success' ? 'completed' : 'failed';
          }
        });
      } else if (submittedSearch?.source !== 'all') {
        if (yaohuoLoginHandledRef.current) return;
        yaohuoLoginHandledRef.current = true;
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
    refreshSearchFirstPage,
    searchQuery,
    searchActive,
    submittedSearch,
    submittedSearchSourceIncluded,
    searchRecovery
  ]);

  const runSearch = useCallback(
    async (runOptions: Partial<SearchRunOptions> = {}): Promise<LinuxDoReadResumeOutcome> => {
      if (!searchReadIsCurrent()) return 'stale';
      const query = (runOptions.query ?? searchQuery).trim();
      if (!query) {
        notify('请输入搜索词');
        return 'completed';
      }
      const source = runOptions.source ?? searchSource;
      if (source !== 'all' && !enabledSearchSourcesRef.current.includes(source)) return 'stale';
      searchRecovery.newIntent();
      if (source === 'yaohuo') yaohuoLoginHandledRef.current = false;
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
            const aggregateSource = aggregateSources[index];
            if (
              aggregateSource &&
              !externalSearchUrlForPlan(readGateway.getReadPlan(aggregateSource, 'search'), query)
            ) {
              void result.refetch({ cancelRefetch: false });
            }
          });
        } else if (!externalSearchUrlForPlan(readGateway.getReadPlan(source, 'search'), query)) {
          void refreshSearchFirstPage();
        }
      } else {
        setSubmittedSearch(next);
      }
      if (source !== 'all') {
        const externalSearchUrl = externalSearchUrlForPlan(readGateway.getReadPlan(source, 'search'), query);
        if (externalSearchUrl) {
          try {
            await onOpenExternalSearch?.(externalSearchUrl);
          } catch {
            notify('无法打开 Google 搜索');
          }
        }
      }
      return 'completed';
    },
    [
      addRecentSearch,
      aggregateQueries,
      aggregateSources,
      notify,
      onOpenExternalSearch,
      readGateway,
      searchReadIsCurrent,
      searchFilters,
      searchQuery,
      searchSource,
      refreshSearchFirstPage,
      submittedSearch,
      searchRecovery
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
      if (source !== 'all' && !enabledSearchSourcesRef.current.includes(source)) return;
      searchRecovery.newIntent();
      if (source !== 'all') promoteAggregateSearchPage(source);
      setSearchSourceState(() => source);
      setLinuxDoAiEnabled(false);
      setSubmittedSearch((current) =>
        current && current.query === searchQuery.trim()
          ? { ...current, source, filters: snapshotSearchFilters(searchFilters) }
          : current
      );
    },
    [promoteAggregateSearchPage, searchFilters, searchQuery, searchRecovery]
  );

  const applySearchFilter = useCallback(
    (source: Source, filter: SourceSearchFilter) => {
      if (!enabledSearchSourcesRef.current.includes(source)) return;
      if (
        submittedSearch?.source === source &&
        submittedSearch.query === searchQuery.trim() &&
        hashKey([submittedSearch.filters[source]]) !== hashKey([filter])
      )
        searchRecovery.newIntent();
      const next = { ...searchFilters, [source]: filter };
      setSearchFilters(next);
      setSubmittedSearch((submitted) =>
        submitted && submitted.source === source && submitted.query === searchQuery.trim()
          ? { ...submitted, filters: snapshotSearchFilters(next) }
          : submitted
      );
      setLinuxDoAiEnabled(false);
    },
    [searchFilters, searchQuery, searchRecovery, submittedSearch]
  );

  const candidateSource = searchSource !== 'all' && isDiscourseSource(searchSource) ? searchSource : 'linuxdo';
  const tagReadPlan = readGateway.getReadPlan(candidateSource, 'search-tags');
  const userReadPlan = readGateway.getReadPlan(candidateSource, 'search-users');
  const searchCandidateReadPlanScopes = useMemo(
    () => ({ tags: tagReadPlan.cacheScope, users: userReadPlan.cacheScope }),
    [tagReadPlan.cacheScope, userReadPlan.cacheScope]
  );
  const searchDiscourseTags = useCallback(
    async (options: Omit<Parameters<ReadGateway['searchTagOptions']>[0], 'source'> & { source?: DiscourseSource }) => {
      const source = options.source || 'linuxdo';
      if (!enabledSearchSourcesRef.current.includes(source)) return [];
      const { source: _source, ...request } = options;
      const trace = beginDiagnosticTrace('search', 'searchTagOptions', { source });
      markDiagnosticStage(trace, 'guard', {
        source,
        state: 'started',
        hasQuery: Boolean(options.query?.trim())
      });
      return runSearchOptions(source, trace, options.signal, () =>
        readGateway.searchTagOptions({ source, ...request }, { plan: tagReadPlan, trace })
      );
    },
    [readGateway, candidateSource, tagReadPlan.cacheScope]
  );

  const searchDiscourseUsers = useCallback(
    async (options: Omit<Parameters<ReadGateway['searchUserOptions']>[0], 'source'> & { source?: DiscourseSource }) => {
      const source = options.source || 'linuxdo';
      if (!enabledSearchSourcesRef.current.includes(source)) return [];
      const { source: _source, ...request } = options;
      const trace = beginDiagnosticTrace('search', 'searchUserOptions', { source });
      markDiagnosticStage(trace, 'guard', { source, state: 'started', hasQuery: Boolean(options.term.trim()) });
      return runSearchOptions(source, trace, options.signal, () =>
        readGateway.searchUserOptions({ source, ...request }, { plan: userReadPlan, trace })
      );
    },
    [readGateway, candidateSource, userReadPlan.cacheScope]
  );

  const toggleLinuxDoAiSearch = useCallback(() => {
    if (enabledSearchSourcesRef.current.includes('linuxdo') && linuxDoAiState.status === 'ready') {
      setLinuxDoAiEnabled((current) => !current);
    }
  }, [linuxDoAiState.status]);
  const retryLinuxDoAiSearch = useCallback(() => {
    if (
      searchReadIsCurrent() &&
      enabledSearchSourcesRef.current.includes('linuxdo') &&
      !linuxDoVerificationActive &&
      linuxDoSemanticPlan.state === 'ready' &&
      linuxDoAiQuery.isError
    ) {
      void linuxDoAiQuery.refetch({ cancelRefetch: false });
    }
  }, [
    linuxDoAiQuery.isError,
    linuxDoAiQuery.refetch,
    linuxDoSemanticPlan.state,
    linuxDoVerificationActive,
    searchReadIsCurrent
  ]);
  const abortSearchRequests = useCallback(() => {
    searchRecovery.observe(null);
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === 'forum' &&
        typeof queryKey[2] === 'string' &&
        (queryKey[2].startsWith('search') || queryKey[2] === 'semantic-search')
    });
  }, [queryClient, searchRecovery]);
  useEffect(() => {
    if (!searchActive) abortSearchRequests();
  }, [abortSearchRequests, searchActive]);
  useEffect(() => abortSearchRequests, [abortSearchRequests]);

  return {
    applySearchFilter,
    externalSearchSources,
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
          ? aggregateQueries.some((query, index) => !aggregateExternalSearchUrls[index] && query.isPending)
          : submittedSearchSourceIncluded && !singleExternalSearchUrl && singleSearchQuery.isFetching,
    searchFilters,
    searchGroups,
    searchCandidateReadPlanScopes,
    searchCandidateRequestsEnabled:
      searchActive &&
      !(candidateSource === 'linuxdo' && linuxDoVerificationActive) &&
      tagReadPlan.state === 'ready' &&
      userReadPlan.state === 'ready',
    searchDiscourseTags,
    searchDiscourseUsers,
    linuxDoAiState,
    linuxDoAiVisible,
    searchQuery,
    searchReadScope,
    searchSource,
    submittedSearchQuery: submittedSearch?.query || '',
    setSearchQuery,
    setSearchSource,
    toggleLinuxDoAiSearch
  };
}
