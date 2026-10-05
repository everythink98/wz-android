import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type {
  NodeSeekCreditCurrency,
  NodeSeekCreditPage,
  NodeSeekStardustCreditPage
} from '@/domain/forum/accountData';
import type { ReadGateway } from '@/sources/readGateway';
import { forumQueryKeys } from '@/platform/query/serverState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { summarizeCredits } from './nodeSeekCredits';

export type NodeSeekCreditsGateway = Pick<
  ReadGateway,
  'getReadPlan' | 'getNodeSeekCredits' | 'getNodeSeekStardustCredits'
>;

type CreditPage = NodeSeekCreditPage | NodeSeekStardustCreditPage;

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
  const refreshingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const paginationSession = useMemo(
    () => ({ firstRead: enabled && !queryClient.getQueryData(key), day: new Date().setHours(0, 0, 0, 0) }),
    [enabled, key, queryClient]
  );
  const [refreshedPagination, setRefreshedPagination] = useState<{
    session: typeof paginationSession;
    day: number;
  } | null>(null);
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
    if (!enabled || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      if (!currentOwner.current.enabled || currentOwner.current.owner !== owner) return;
      setRefreshedPagination({ session: paginationSession, day: new Date().setHours(0, 0, 0, 0) });
      queryClient.setQueryData<InfiniteData<CreditPage, number>>(key, (previous) =>
        previous ? { pages: previous.pages.slice(0, 1), pageParams: previous.pageParams.slice(0, 1) } : previous
      );
      await refetchLedger();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [currentOwner, enabled, key, refetchLedger, owner, paginationSession, queryClient]);

  const loadMore = useCallback(() => {
    if (!enabled || ledger.isFetching || !ledger.hasNextPage || refreshingRef.current) return;
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
