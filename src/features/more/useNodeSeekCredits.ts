import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type {
  NodeSeekCreditCurrency,
  NodeSeekCreditPage,
  NodeSeekStardustCreditPage
} from '@/domain/forum/accountData';
import type { ReadGateway } from '@/sources/readGateway';
import { forumQueryKeys, keepFirstQueryPage } from '@/platform/query/serverState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { summarizeCredits } from './nodeSeekCredits';

export type NodeSeekCreditsGateway = Pick<
  ReadGateway,
  'getReadPlan' | 'getNodeSeekCredits' | 'getNodeSeekStardustCredits'
>;

type CreditPage = NodeSeekCreditPage | NodeSeekStardustCreditPage;
type RefreshedPagination = { session: { firstRead: boolean; day: number }; day: number };
type CreditRefreshState =
  | { phase: 'idle' }
  | { phase: 'refreshing'; pagination: RefreshedPagination | null }
  | { phase: 'bookmarked'; pagination: RefreshedPagination };

export function useNodeSeekCredits({
  active,
  gateway,
  userId,
  sessionEpoch,
  currency = 'coin'
}: {
  active: boolean;
  gateway: NodeSeekCreditsGateway;
  userId: string;
  sessionEpoch: number;
  currency?: NodeSeekCreditCurrency;
}) {
  const queryClient = useQueryClient();
  const plan = gateway.getReadPlan('nodeseek', 'account-data');
  const enabled = active && plan.state === 'ready';
  const scope = plan.cacheScope;
  const key = useMemo(
    () =>
      forumQueryKeys.accountData({
        source: 'nodeseek',
        kind: currency === 'coin' ? 'credits' : 'stardust-credits',
        userId,
        sessionEpoch,
        readPlanScope: scope
      }),
    [currency, scope, sessionEpoch, userId]
  );
  const owner = JSON.stringify(key);
  const currentOwner = useCommittedRef({ owner, enabled });
  const refreshStateRef = useRef<CreditRefreshState>({ phase: 'idle' });
  const [refreshState, setRefreshState] = useState<CreditRefreshState>(refreshStateRef.current);
  const refreshing = refreshState.phase === 'refreshing';
  const paginationSession = useMemo(
    () => ({ firstRead: enabled && !queryClient.getQueryData(key), day: new Date().setHours(0, 0, 0, 0) }),
    [enabled, key, queryClient]
  );
  const refreshedPagination = refreshState.phase === 'idle' ? null : refreshState.pagination;
  const ledger = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }): Promise<CreditPage> =>
      currency === 'coin'
        ? gateway.getNodeSeekCredits({ userId, page: pageParam, signal }, { readPlanScope: scope })
        : gateway.getNodeSeekStardustCredits(
            { userId, ...(pageParam > 0 ? { beforeId: pageParam } : {}), signal },
            { readPlanScope: scope }
          ),
    initialPageParam: currency === 'coin' ? 1 : 0,
    getNextPageParam: (page) => ('nextPage' in page ? page.nextPage : page.nextBeforeId) ?? undefined,
    enabled,
    gcTime: Infinity,
    retry: false
  });
  const { fetchNextPage, refetch: refetchLedger } = ledger;
  const todayTimestamp = new Date().setHours(0, 0, 0, 0);
  const canAutomaticallyPaginate =
    (paginationSession.firstRead && paginationSession.day === todayTimestamp) ||
    (refreshedPagination?.session === paginationSession && refreshedPagination.day === todayTimestamp);
  const summary = useMemo(
    () =>
      summarizeCredits({
        entries: ledger.data?.pages.flatMap((page) => page.entries) ?? [],
        hasMore: Boolean(ledger.hasNextPage),
        loaded: Boolean(ledger.data),
        consistent:
          ledger.data?.pages.every((page) => {
            const first = ledger.data?.pages[0];
            return !('total' in page) || (first && 'total' in first && page.total === first.total);
          }) ?? true,
        now: new Date(todayTimestamp)
      }),
    [ledger.data, ledger.hasNextPage, todayTimestamp]
  );

  useEffect(() => {
    if (
      !enabled ||
      !canAutomaticallyPaginate ||
      !ledger.data ||
      !summary.ordered ||
      !summary.consistent ||
      summary.today.complete ||
      !ledger.hasNextPage ||
      ledger.isFetching ||
      ledger.isError ||
      refreshing
    )
      return;
    void fetchNextPage({ cancelRefetch: false });
  }, [
    enabled,
    canAutomaticallyPaginate,
    ledger.data,
    fetchNextPage,
    ledger.hasNextPage,
    ledger.isError,
    ledger.isFetching,
    refreshing,
    summary.ordered,
    summary.consistent,
    summary.today.complete
  ]);

  useEffect(() => {
    if (enabled) return;
    void queryClient.cancelQueries({ queryKey: key, exact: true, predicate: (query) => !query.isActive() });
  }, [enabled, key, queryClient]);
  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: key, exact: true, predicate: (query) => !query.isActive() });
    },
    [key, queryClient]
  );

  const refresh = useCallback(async () => {
    if (!enabled || refreshStateRef.current.phase === 'refreshing') return;
    const current = refreshStateRef.current;
    const refreshingState: CreditRefreshState = {
      phase: 'refreshing',
      pagination: current.phase === 'idle' ? null : current.pagination
    };
    refreshStateRef.current = refreshingState;
    setRefreshState(refreshingState);
    try {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      if (!currentOwner.current.enabled || currentOwner.current.owner !== owner) return;
      const bookmarkedState: CreditRefreshState = {
        phase: 'refreshing',
        pagination: { session: paginationSession, day: new Date().setHours(0, 0, 0, 0) }
      };
      refreshStateRef.current = bookmarkedState;
      setRefreshState(bookmarkedState);
      queryClient.setQueryData<InfiniteData<CreditPage, number>>(key, keepFirstQueryPage);
      await refetchLedger();
    } finally {
      const pagination = refreshStateRef.current.pagination;
      const settledState: CreditRefreshState =
        pagination === null ? { phase: 'idle' } : { phase: 'bookmarked', pagination };
      refreshStateRef.current = settledState;
      setRefreshState(settledState);
    }
  }, [currentOwner, enabled, key, refetchLedger, owner, paginationSession, queryClient]);

  const loadMore = useCallback(() => {
    if (!enabled || ledger.isFetching || !ledger.hasNextPage || refreshStateRef.current.phase === 'refreshing') return;
    void fetchNextPage({ cancelRefetch: false });
  }, [enabled, fetchNextPage, ledger.hasNextPage, ledger.isFetching]);

  return {
    currency,
    summary,
    error: ledger.error,
    busy: ledger.isFetching,
    refreshing,
    loaded: Boolean(ledger.data),
    hasMore: Boolean(ledger.hasNextPage),
    loadMore,
    refresh
  };
}
