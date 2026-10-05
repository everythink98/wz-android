import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { SessionSite, SiteSessionViewModel } from '@/domain/session/siteSessionState';
import type { AccountOverview } from '@/domain/forum/accountData';
import type { ReadGateway } from '@/sources/readGateway';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';

export type AccountOverviewGateway = Pick<
  ReadGateway,
  | 'getReadPlan'
  | 'getUserDetails'
  | 'getNodeSeekAccountOverview'
  | 'getYaohuoAccountOverview'
  | 'getNodeSeekAttendanceBoard'
>;

export function useAccountOverview({
  active,
  gateway,
  session,
  sessionEpochs,
  site
}: {
  active: boolean;
  gateway: AccountOverviewGateway;
  session: SiteSessionViewModel;
  sessionEpochs: ForumSessionEpochs;
  site: SessionSite;
}) {
  const queryClient = useQueryClient();
  const user = session.currentUser;
  const userId = user?.id || '';
  const profilePlan = gateway.getReadPlan(site, 'user-profile');
  const privatePlan = gateway.getReadPlan(site, 'account-data');
  const identityAvailable = session.canWrite && session.identityTrust === 'confirmed' && Boolean(userId);
  const enabled = active && identityAvailable;
  const showPrivate = identityAvailable && privatePlan.state === 'ready';
  const showProfile = identityAvailable && profilePlan.state === 'ready';
  const profileKey = useMemo(
    () => forumQueryKeys.user({ source: site, userId, scope: sessionEpochs, readPlanScope: profilePlan.cacheScope }),
    [site, userId, sessionEpochs, profilePlan.cacheScope]
  );
  const privateKey = useMemo(
    () =>
      forumQueryKeys.accountData({
        source: site,
        kind: 'overview',
        userId,
        sessionEpoch: sessionEpochs[site],
        readPlanScope: privatePlan.cacheScope
      }),
    [site, userId, sessionEpochs, privatePlan.cacheScope]
  );
  const boardKey = useMemo(
    () =>
      forumQueryKeys.accountData({
        source: 'nodeseek',
        kind: 'attendance',
        userId,
        sessionEpoch: sessionEpochs.nodeseek,
        readPlanScope: privatePlan.cacheScope
      }),
    [userId, sessionEpochs.nodeseek, privatePlan.cacheScope]
  );
  const profileQuery = useQuery({
    gcTime: Infinity,
    queryKey: profileKey,
    enabled: enabled && profilePlan.state === 'ready',
    queryFn: ({ signal }) =>
      gateway.getUserDetails(
        { source: site, id: userId, username: user?.username, signal },
        { readPlanScope: profilePlan.cacheScope }
      )
  });
  const overviewQuery = useQuery<AccountOverview>({
    gcTime: Infinity,
    queryKey: privateKey,
    enabled: enabled && privatePlan.state === 'ready' && site !== 'linuxdo',
    queryFn: ({ signal }) => {
      const context = { readPlanScope: privatePlan.cacheScope };
      if (site === 'nodeseek') return gateway.getNodeSeekAccountOverview({ userId, signal }, context);
      if (site === 'yaohuo') return gateway.getYaohuoAccountOverview({ userId, signal }, context);
      throw new Error('该站点没有私有概要');
    }
  });
  const boardQuery = useQuery({
    gcTime: Infinity,
    queryKey: boardKey,
    enabled: enabled && privatePlan.state === 'ready' && site === 'nodeseek',
    queryFn: ({ signal }) =>
      gateway.getNodeSeekAttendanceBoard({ userId, signal }, { readPlanScope: privatePlan.cacheScope })
  });
  const keys = useMemo(
    () => [profileKey, ...(site === 'linuxdo' ? [] : [privateKey]), ...(site === 'nodeseek' ? [boardKey] : [])],
    [profileKey, privateKey, boardKey, site]
  );
  const refreshKeys = useCallback(
    async (targets: readonly QueryKey[]) => {
      if (!enabled) return;
      await Promise.all(
        targets.map((key) =>
          queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'active' }, { cancelRefetch: false })
        )
      );
    },
    [enabled, queryClient]
  );
  const refresh = useCallback(() => refreshKeys(keys), [keys, refreshKeys]);
  const retryOverview = useCallback(
    () => refreshKeys([...(profileQuery.error ? [profileKey] : []), ...(overviewQuery.error ? [privateKey] : [])]),
    [overviewQuery.error, privateKey, profileKey, profileQuery.error, refreshKeys]
  );
  const retryAttendance = useCallback(() => refreshKeys([boardKey]), [boardKey, refreshKeys]);
  useEffect(
    () => () => {
      for (const key of keys) {
        void queryClient.cancelQueries({ queryKey: key, exact: true, predicate: (query) => !query.isActive() });
      }
    },
    [keys, queryClient]
  );
  useEffect(() => {
    if (enabled) return;
    for (const key of keys) {
      void queryClient.cancelQueries({ queryKey: key, exact: true, predicate: (query) => !query.isActive() });
    }
  }, [enabled, keys, queryClient]);

  return {
    profile: (showPrivate ? overviewQuery.data?.profile : undefined) || (showProfile ? profileQuery.data : undefined),
    overview: showPrivate ? overviewQuery.data : undefined,
    board: showPrivate && site === 'nodeseek' ? boardQuery.data : undefined,
    boardBusy: enabled && boardQuery.isFetching,
    boardError: enabled ? boardQuery.error : null,
    boardUpdatedAt: boardQuery.dataUpdatedAt,
    busy: enabled && (profileQuery.isFetching || overviewQuery.isFetching),
    error: profileQuery.error || overviewQuery.error,
    updatedAt: Math.max(profileQuery.dataUpdatedAt, overviewQuery.dataUpdatedAt),
    refresh,
    retryOverview,
    retryAttendance
  };
}
