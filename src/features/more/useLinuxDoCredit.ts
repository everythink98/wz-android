import { useCallback, useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { LinuxDoCreditError, type LinuxDoCreditPage } from '@/domain/forum/linuxDoCredit';
import type { ReadGateway } from '@/sources/readGateway';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { forumQueryKeys } from '@/platform/query/serverState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

export type LinuxDoCreditGateway = Pick<
  ReadGateway,
  'getReadPlan' | 'getLinuxDoCreditAccount' | 'getLinuxDoCreditTransactions'
>;

export function useLinuxDoCredit({
  active,
  gateway,
  userId,
  username,
  sessionEpoch,
  connectSilently,
  connecting,
  transactions = false
}: {
  active: boolean;
  gateway: LinuxDoCreditGateway;
  userId: string;
  username: string;
  sessionEpoch: number;
  connectSilently: () => void | Promise<void>;
  connecting: boolean;
  transactions?: boolean;
}) {
  const client = useQueryClient();
  const plan = gateway.getReadPlan('linuxdo', 'account-data');
  const enabled = active && Boolean(userId && username) && plan.state === 'ready';
  const scope = plan.cacheScope;
  const keys = useMemo(
    () => ({
      account: forumQueryKeys.accountData({
        source: 'linuxdo',
        kind: 'ldc-account',
        userId,
        sessionEpoch,
        readPlanScope: scope
      }),
      transactions: forumQueryKeys.accountData({
        source: 'linuxdo',
        kind: 'ldc-transactions',
        userId,
        sessionEpoch,
        readPlanScope: scope
      })
    }),
    [userId, sessionEpoch, scope]
  );
  const current = useCommittedRef({ keys, enabled });
  const account = useQuery({
    queryKey: keys.account,
    enabled,
    queryFn: ({ signal }) => gateway.getLinuxDoCreditAccount({ userId, username, signal }, { readPlanScope: scope }),
    gcTime: Infinity,
    retry: false
  });
  const ledger = useInfiniteQuery({
    queryKey: keys.transactions,
    enabled: enabled && transactions && Boolean(account.data) && !account.error,
    queryFn: ({ signal, pageParam }) =>
      gateway.getLinuxDoCreditTransactions({ userId, username, page: pageParam, signal }, { readPlanScope: scope }),
    initialPageParam: 1,
    getNextPageParam: (page) => page.nextPage ?? undefined,
    gcTime: Infinity,
    retry: false
  });
  const ownedKeys = useMemo(
    () => (transactions ? [keys.account, keys.transactions] : [keys.account]),
    [keys, transactions]
  );
  useEffect(() => {
    if (enabled) return;
    for (const key of ownedKeys)
      void client.cancelQueries({ queryKey: key, exact: true, predicate: (query) => !query.isActive() });
  }, [client, enabled, ownedKeys]);
  useEffect(
    () => () => {
      for (const key of ownedKeys)
        void client.cancelQueries({ queryKey: key, exact: true, predicate: (query) => !query.isActive() });
    },
    [client, ownedKeys]
  );

  const refresh = useCallback(async () => {
    if (!current.current.enabled) return;
    await Promise.all(ownedKeys.map((key) => client.cancelQueries({ queryKey: key, exact: true })));
    if (!current.current.enabled || current.current.keys !== keys) return;
    client.setQueryData<InfiniteData<LinuxDoCreditPage, number>>(keys.transactions, (previous) =>
      previous ? { pages: previous.pages.slice(0, 1), pageParams: previous.pageParams.slice(0, 1) } : previous
    );
    await client.invalidateQueries({ queryKey: keys.account, exact: true });
    if (!current.current.enabled || current.current.keys !== keys || client.getQueryState(keys.account)?.error) return;
    await client.invalidateQueries({ queryKey: keys.transactions, exact: true });
  }, [client, current, keys, ownedKeys]);
  const loadMore = useCallback(() => {
    if (!enabled || !transactions || account.error || ledger.isFetching || !ledger.hasNextPage) return;
    void ledger.fetchNextPage({ cancelRefetch: false });
  }, [enabled, transactions, account.error, ledger]);
  const error = account.error || (transactions ? ledger.error : null);
  const fetching = account.isFetching || (transactions && ledger.isFetching);
  const needsCreditSession =
    error instanceof LinuxDoCreditError &&
    (error.kind === 'authorization-required' || error.kind === 'verification-required');
  useEffect(() => {
    if (enabled && !fetching && needsCreditSession) void connectSilently();
  }, [connectSilently, enabled, fetching, needsCreditSession]);
  const blocked =
    plan.state !== 'ready' ||
    (error instanceof LinuxDoCreditError &&
      (error.kind === 'authorization-required' || error.kind === 'identity-mismatch'));
  const entries = useMemo(() => {
    if (blocked || !transactions) return [];
    const unique = new Map(
      (ledger.data?.pages ?? []).flatMap((page) => page.entries).map((entry) => [entry.id, entry])
    );
    return [...unique.values()];
  }, [blocked, transactions, ledger.data]);
  return {
    account: blocked ? undefined : account.data,
    entries,
    busy: connecting || (enabled && fetching),
    refreshing:
      enabled && (account.isRefetching || (transactions && ledger.isRefetching && !ledger.isFetchingNextPage)),
    loaded: !blocked && Boolean(ledger.data),
    hasMore: !blocked && Boolean(ledger.hasNextPage),
    error: connecting && needsCreditSession ? null : error,
    forumVerificationRequired: error instanceof LinuxDoCloudflareError,
    refresh,
    loadMore
  };
}
