import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hashKey, useQuery, useQueryClient, type InfiniteData, type Query, type QueryKey } from '@tanstack/react-query';
import { mergeTopics } from '@/domain/forum/feed';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import type { ReaderView } from '@/domain/reader/readerRecordState';
import { isUserFollowed } from '@/domain/reader/readerData';
import { nodeSeekUserIdFromValue, normalizeUserReference } from '@/domain/forum/userNavigation';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { sourceErrorFromUnknown, sourceReadRecoveryOutcome } from '@/sources/sourceErrors';
import type {
  Source,
  SourceErrorInfo,
  UserDetails,
  UserTopicsPage,
  UserRepliesPage,
  UserReference,
  UserReplyActivity
} from '@/domain/forum/models';
import type { ReadGateway } from '@/sources/readGateway';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import { useFirstPageInfiniteQuery } from '@/platform/query/useFirstPageInfiniteQuery';
import { isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';

type UserLane = 'topics' | 'replies';
type UserErrorLane = 'resolution' | 'profile' | UserLane;
type UserActivityPage = Partial<UserTopicsPage & UserRepliesPage>;
type UserActivityData = InfiniteData<UserActivityPage>;

function mergeUserReplies(incoming: UserReplyActivity[]) {
  const seen = new Set<string>();
  return incoming.filter((reply) => {
    const key = `${reply.source}:${reply.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function userSourceRecoveryTarget(source: Source, error: SourceErrorInfo) {
  if (error.kind === 'verification-required') {
    return source === 'linuxdo'
      ? 'linuxdo-verification'
      : source === 'nodeseek'
        ? 'nodeseek-verification'
        : source === 'yaohuo'
          ? 'yaohuo-login'
          : null;
  }
  return source === 'yaohuo' && (error.kind === 'login-required' || error.kind === 'login-expired')
    ? 'yaohuo-login'
    : null;
}

function nextUserActivityCursor(page: UserActivityPage | undefined, lane: UserLane, consumed: readonly unknown[]) {
  const hasMore = lane === 'topics' ? page?.hasMoreTopics : page?.hasMoreReplies;
  const cursor = lane === 'topics' ? page?.nextTopicsCursor : page?.nextRepliesCursor;
  return hasMore && cursor && !consumed.includes(cursor) ? cursor : undefined;
}

export function useUserController({
  active,
  sessionEpochs = initialForumSessionEpochs,
  notify,
  onRetryIdentityStatus,
  readerData,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  readGateway,
  user
}: {
  active: boolean;
  sessionEpochs?: ForumSessionEpochs;
  notify: (message: string) => void;
  onRetryIdentityStatus?: (source: SessionSource) => Promise<unknown> | unknown;
  readerData: ReaderView;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showNodeSeekVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
  user: UserReference;
}) {
  const queryClient = useQueryClient();
  const [handledUserErrors] = useState<Record<UserErrorLane, WeakMap<Query, number>>>(() => ({
    profile: new WeakMap(),
    resolution: new WeakMap(),
    replies: new WeakMap(),
    topics: new WeakMap()
  }));
  const claimUserError = useCallback(
    (lane: UserErrorLane, queryKey: QueryKey, error: unknown) => {
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (!query || query.state.fetchStatus !== 'idle' || !error || query.state.error !== error) return false;
      const handled = handledUserErrors[lane];
      if (handled.get(query) === query.state.errorUpdateCount) return false;
      handled.set(query, query.state.errorUpdateCount);
      return true;
    },
    [handledUserErrors, queryClient]
  );
  const selectedUser = useMemo(
    () => normalizeUserReference(user),
    [user.avatar, user.displayName, user.id, user.source, user.url, user.username]
  );
  const selectedSource = selectedUser?.source || 'v2ex';
  const selectedUsername = selectedUser?.username || '';
  const selectedNeedsResolution = Boolean(
    selectedUser?.source === 'nodeseek' && !nodeSeekUserIdFromValue(selectedUser.id) && selectedUsername
  );
  const resolutionReadPlan = readGateway.getReadPlan('nodeseek', 'user-resolution');
  const resolutionKey = useMemo(
    () =>
      forumQueryKeys.userResolution({
        readPlanScope: resolutionReadPlan.cacheScope,
        scope: sessionEpochs,
        username: selectedUsername
      }),
    [resolutionReadPlan.cacheScope, sessionEpochs.nodeseek, selectedUsername]
  );
  const resolutionEnabled = Boolean(selectedNeedsResolution && active);
  const resolutionQuery = useQuery({
    queryKey: resolutionKey,
    enabled: resolutionEnabled,
    subscribed: active,
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('user', 'resolveUser', {
        source: 'nodeseek',
        userRef: diagnosticRef('user', `nodeseek:${selectedUsername}`)
      });
      try {
        markDiagnosticStage(trace, 'guard', { source: 'nodeseek', state: 'resolve' });
        const resolved = await readGateway.resolveNodeSeekUser(
          {
            username: selectedUsername,
            signal
          },
          { plan: resolutionReadPlan, trace }
        );
        if (!/^\d+$/.test(resolved.id || '')) {
          throw new Error('NodeSeek 用户名解析结果缺少数字用户 ID');
        }
        finishDiagnosticTrace(trace, 'success', { source: 'nodeseek' });
        return resolved;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: 'nodeseek',
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  });
  const canonicalUser = selectedNeedsResolution ? resolutionQuery.data || null : selectedUser;
  const identity = canonicalUser?.id || '';
  const loginReadKey = `${selectedSource}:${identity}`;
  const handledYaohuoLoginReadKeyRef = useRef<string | null>(null);
  const profileReadPlan = readGateway.getReadPlan(selectedSource, 'user-profile');
  const profileSessionEpoch = isSessionSource(selectedSource) ? sessionEpochs[selectedSource] : 0;
  const profileKey = useMemo(
    () =>
      forumQueryKeys.user({
        readPlanScope: profileReadPlan.cacheScope,
        source: selectedSource,
        userId: identity,
        scope: { ...initialForumSessionEpochs, [selectedSource]: profileSessionEpoch }
      }),
    [profileSessionEpoch, identity, profileReadPlan.cacheScope, selectedSource]
  );
  const topicKey = useMemo(() => forumQueryKeys.userLane(profileKey, 'topics'), [profileKey]);
  const replyKey = useMemo(() => forumQueryKeys.userLane(profileKey, 'replies'), [profileKey]);
  const readScope = hashKey([profileKey, selectedNeedsResolution ? resolutionKey : null]);
  const activeRead = useRef<{ scope: string } | null>(null);
  useLayoutEffect(() => {
    activeRead.current = active ? { scope: readScope } : null;
    return () => {
      activeRead.current = null;
    };
  }, [active, readScope]);
  const currentRead = useCallback(
    () => (activeRead.current?.scope === readScope ? activeRead.current : null),
    [readScope]
  );
  const enabled = Boolean(canonicalUser && identity && active);

  const profileQuery = useQuery({
    queryKey: profileKey,
    enabled,
    subscribed: active,
    queryFn: async ({ signal }) => {
      const user = canonicalUser;
      if (!user?.id) throw new Error('用户信息不完整');
      const trace = beginDiagnosticTrace('user', 'open', {
        source: user.source,
        userRef: diagnosticRef('user', `${user.source}:${identity}`)
      });
      try {
        markDiagnosticStage(trace, 'guard', { source: user.source, state: 'open' });
        const profile = await readGateway.getUserDetails(
          {
            source: user.source,
            id: user.id,
            username: user.username,
            signal
          },
          { plan: profileReadPlan, trace }
        );
        if (sourceDiagnosticSummary(profile)?.isParseEmpty) {
          throw new Error('用户主页解析为空，无法显示，请重试。');
        }
        markDiagnosticStage(trace, 'apply', {
          source: user.source,
          state: 'success'
        });
        finishDiagnosticTrace(trace, 'success', { source: user.source });
        return profile;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: user.source,
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  });

  const createLaneQuery = (lane: UserLane, queryKey: QueryKey, details = profileQuery.data) => ({
    queryKey,
    enabled: enabled && Boolean(details),
    subscribed: active,
    initialPageParam: null as string | null,
    queryFn: async ({
      pageParam,
      signal
    }: {
      pageParam: string | null;
      signal: AbortSignal;
    }): Promise<UserActivityPage> => {
      if (!details) throw new Error('用户资料尚未读取');
      const options = { source: details.source, profile: details, cursor: pageParam, signal };
      const context = { plan: profileReadPlan };
      const page =
        lane === 'topics'
          ? await readGateway.getUserTopics(options, context)
          : await readGateway.getUserReplies(options, context);
      if (sourceDiagnosticSummary(page)?.isParseEmpty)
        throw new Error(`用户${lane === 'topics' ? '主题' : '回复'}响应无法解析`);
      return page;
    },
    getNextPageParam: (
      lastPage: UserActivityPage,
      _pages: UserActivityPage[],
      _lastCursor: string | null,
      cursors: (string | null)[]
    ) => nextUserActivityCursor(lastPage, lane, cursors)
  });
  const [topicsQuery, refreshTopicsFirstPage] = useFirstPageInfiniteQuery<UserActivityPage, string | null>(
    createLaneQuery('topics', topicKey)
  );
  const [repliesQuery, refreshRepliesFirstPage] = useFirstPageInfiniteQuery<UserActivityPage, string | null>(
    createLaneQuery('replies', replyKey)
  );
  const retryTopicsRead = topicsQuery.isFetchNextPageError ? topicsQuery.fetchNextPage : refreshTopicsFirstPage;
  const retryRepliesRead = repliesQuery.isFetchNextPageError ? repliesQuery.fetchNextPage : refreshRepliesFirstPage;
  const resolutionErrorCount = queryClient.getQueryState(resolutionKey)?.errorUpdateCount ?? 0;
  const profileErrorCount = queryClient.getQueryState(profileKey)?.errorUpdateCount ?? 0;
  const topicsErrorCount = queryClient.getQueryState(topicKey)?.errorUpdateCount ?? 0;
  const repliesErrorCount = queryClient.getQueryState(replyKey)?.errorUpdateCount ?? 0;
  const topicData = topicsQuery.data;
  const replyData = repliesQuery.data;
  const topicPages = topicData?.pages;
  const replyPages = replyData?.pages;
  const profile = profileQuery.data;
  const topics = useMemo(
    () =>
      topicPages
        ? mergeTopics(
            [],
            topicPages.flatMap((page) => page.topics || [])
          )
        : undefined,
    [topicPages]
  );
  const replies = useMemo(
    () => (replyPages ? mergeUserReplies(replyPages.flatMap((page) => page.replies || [])) : undefined),
    [replyPages]
  );
  const nextTopicsCursor = topicData
    ? (nextUserActivityCursor(topicData.pages.at(-1), 'topics', topicData.pageParams) ?? null)
    : undefined;
  const nextRepliesCursor = replyData
    ? (nextUserActivityCursor(replyData.pages.at(-1), 'replies', replyData.pageParams) ?? null)
    : undefined;
  const userProfile = useMemo(
    () =>
      profile
        ? {
            ...profile,
            topics,
            replies,
            hasMoreTopics: nextTopicsCursor === undefined ? undefined : Boolean(nextTopicsCursor),
            nextTopicsCursor,
            hasMoreReplies: nextRepliesCursor === undefined ? undefined : Boolean(nextRepliesCursor),
            nextRepliesCursor
          }
        : null,
    [nextRepliesCursor, nextTopicsCursor, profile, replies, topics]
  );
  const resolutionError = selectedNeedsResolution ? resolutionQuery.error : null;
  const queryError = resolutionError || profileQuery.error;
  const userError = queryError && selectedUser ? sourceErrorFromUnknown(selectedUser.source, queryError) : null;
  const currentUserFollowed = Boolean(userProfile && isUserFollowed(readerData, userProfile));

  const showYaohuoLoginForRead = useCallback(
    (message: string) => {
      if (!currentRead() || handledYaohuoLoginReadKeyRef.current === loginReadKey) return;
      handledYaohuoLoginReadKeyRef.current = loginReadKey;
      showYaohuoLogin(message);
    },
    [currentRead, loginReadKey, showYaohuoLogin]
  );
  const handleError = useCallback(
    (error: unknown, lane: UserErrorLane, resume: () => Promise<{ error: unknown; isError: boolean }>) => {
      const owner = currentRead();
      if (!active || !owner || !selectedUser || (lane === 'resolution' && !selectedNeedsResolution)) return;
      const queryKey = { resolution: resolutionKey, profile: profileKey, topics: topicKey, replies: replyKey }[lane];
      if (!claimUserError(lane, queryKey, error)) return;
      const { source } = selectedUser;
      const sourceError = sourceErrorFromUnknown(source, error);
      const target = userSourceRecoveryTarget(source, sourceError);
      if (target === 'linuxdo-verification' || target === 'nodeseek-verification') {
        const isCurrent = () => activeRead.current === owner;
        const recovery: LinuxDoReadRecovery = {
          queryKey,
          isCurrent,
          resume: async () => {
            if (!isCurrent()) return 'stale';
            const result = await resume();
            if (!isCurrent()) return 'stale';
            claimUserError(lane, queryKey, result.error);
            return result.isError ? sourceReadRecoveryOutcome(source, result.error) : 'completed';
          }
        };
        if (target === 'linuxdo-verification') void showLinuxDoVerification(sourceError.message, recovery);
        else showNodeSeekVerification(sourceError.message, recovery);
      } else if (target === 'yaohuo-login') {
        showYaohuoLoginForRead(
          sourceError.kind === 'login-expired' ? '妖火登录已失效，请重新登录。' : sourceError.message
        );
      } else {
        notify(sourceError.message);
      }
    },
    [
      active,
      claimUserError,
      currentRead,
      notify,
      profileKey,
      replyKey,
      resolutionKey,
      selectedNeedsResolution,
      selectedUser,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLoginForRead,
      topicKey
    ]
  );

  useEffect(() => {
    if (resolutionError) {
      handleError(resolutionError, 'resolution', () => resolutionQuery.refetch({ cancelRefetch: false }));
    }
  }, [handleError, resolutionError, resolutionErrorCount, resolutionQuery.refetch]);

  useEffect(() => {
    if (profileQuery.error) {
      handleError(profileQuery.error, 'profile', () => profileQuery.refetch({ cancelRefetch: false }));
    }
  }, [handleError, profileErrorCount, profileQuery.error, profileQuery.refetch]);
  useEffect(() => {
    if (topicsQuery.error) {
      handleError(topicsQuery.error, 'topics', () => retryTopicsRead({ cancelRefetch: false }));
    }
  }, [handleError, topicsQuery.error, topicsErrorCount, retryTopicsRead]);
  useEffect(() => {
    if (repliesQuery.error) {
      handleError(repliesQuery.error, 'replies', () => retryRepliesRead({ cancelRefetch: false }));
    }
  }, [handleError, repliesQuery.error, repliesErrorCount, retryRepliesRead]);

  const refreshUser = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    const owner = currentRead();
    if (!owner || !selectedUser) return 'stale';
    if (selectedUser.source === 'yaohuo') handledYaohuoLoginReadKeyRef.current = null;
    const blockedPlan = selectedNeedsResolution ? resolutionReadPlan : profileReadPlan;
    if (blockedPlan.state === 'blocked') {
      if (
        (blockedPlan.reason === 'identity-pending' || blockedPlan.reason === 'identity-unavailable') &&
        isSessionSource(selectedUser.source)
      ) {
        await onRetryIdentityStatus?.(selectedUser.source);
      } else if (blockedPlan.reason === 'login-required' && selectedUser.source === 'yaohuo') {
        showYaohuoLoginForRead('请先登录妖火后再读取。');
      }
      return 'stale';
    }
    if (selectedNeedsResolution && !resolutionQuery.data) {
      const result = await resolutionQuery.refetch({ cancelRefetch: true });
      return result.isError ? 'failed' : 'completed';
    }
    if (!identity) return 'completed';
    await Promise.all([
      queryClient.cancelQueries({ queryKey: topicKey, exact: true }),
      queryClient.cancelQueries({ queryKey: replyKey, exact: true })
    ]);
    if (activeRead.current !== owner) return 'stale';
    const before = queryClient.getQueryState(profileKey);
    await queryClient.invalidateQueries({ queryKey: profileKey, exact: true, refetchType: 'active' });
    if (activeRead.current !== owner) return 'stale';
    const state = queryClient.getQueryState<UserDetails>(profileKey);
    if (state?.status === 'error') return state.errorUpdateCount > (before?.errorUpdateCount ?? 0) ? 'failed' : 'stale';
    if (
      !state?.data ||
      state.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.dataUpdateCount <= (before?.dataUpdateCount ?? 0)
    )
      return 'stale';
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: topicKey, exact: true, refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: replyKey, exact: true, refetchType: 'none' })
    ]);
    if (activeRead.current !== owner) return 'stale';
    const outcomes = await Promise.allSettled([
      queryClient.fetchInfiniteQuery({ ...createLaneQuery('topics', topicKey, state.data), pages: 1, staleTime: 0 }),
      queryClient.fetchInfiniteQuery({ ...createLaneQuery('replies', replyKey, state.data), pages: 1, staleTime: 0 })
    ]);
    if (activeRead.current !== owner) return 'stale';
    return outcomes.some((outcome) => outcome.status === 'rejected') ? 'failed' : 'completed';
  }, [
    currentRead,
    identity,
    onRetryIdentityStatus,
    profileKey,
    profileReadPlan,
    queryClient,
    replyKey,
    resolutionQuery.data,
    resolutionQuery.refetch,
    resolutionReadPlan,
    selectedNeedsResolution,
    selectedUser,
    showYaohuoLoginForRead,
    topicKey
  ]);

  const loadMoreUserTopics = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    const owner = currentRead();
    if (!owner) return 'stale';
    if (queryClient.getQueryState(profileKey)?.fetchStatus === 'fetching') return 'completed';
    if (topicsQuery.isFetchingNextPage || !profileQuery.data) return 'completed';
    if (queryClient.getQueryState(topicKey)?.fetchStatus === 'fetching') {
      return 'completed';
    }
    const cached = queryClient.getQueryData<UserActivityData>(topicKey);
    if (!cached || !nextUserActivityCursor(cached.pages.at(-1), 'topics', cached.pageParams)) return 'completed';
    const result = await topicsQuery.fetchNextPage({ cancelRefetch: false });
    if (activeRead.current !== owner) return 'stale';
    return result.isError ? 'failed' : 'completed';
  }, [
    currentRead,
    profileKey,
    profileQuery.data,
    queryClient,
    topicKey,
    topicsQuery.fetchNextPage,
    topicsQuery.isFetchingNextPage
  ]);
  const loadMoreUserReplies = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    const owner = currentRead();
    if (!owner) return 'stale';
    if (queryClient.getQueryState(profileKey)?.fetchStatus === 'fetching') return 'completed';
    if (repliesQuery.isFetchingNextPage || !profileQuery.data) return 'completed';
    if (queryClient.getQueryState(replyKey)?.fetchStatus === 'fetching') {
      return 'completed';
    }
    const cached = queryClient.getQueryData<UserActivityData>(replyKey);
    if (!cached || !nextUserActivityCursor(cached.pages.at(-1), 'replies', cached.pageParams)) return 'completed';
    const result = await repliesQuery.fetchNextPage({ cancelRefetch: false });
    if (activeRead.current !== owner) return 'stale';
    return result.isError ? 'failed' : 'completed';
  }, [
    currentRead,
    profileKey,
    profileQuery.data,
    queryClient,
    repliesQuery.fetchNextPage,
    repliesQuery.isFetchingNextPage,
    replyKey
  ]);

  function retryUserRead(read: () => Promise<{ error: unknown; isError: boolean }>) {
    if (!currentRead()) return;
    if (selectedSource === 'yaohuo') handledYaohuoLoginReadKeyRef.current = null;
    return read();
  }

  return {
    currentUserFollowed,
    loadMoreUserReplies,
    loadMoreUserTopics,
    refreshUser,
    selectedUser,
    userBusy: (resolutionQuery.isFetching && resolutionEnabled) || (profileQuery.isFetching && enabled),
    userError,
    userTopicsError: topicsQuery.error ? sourceErrorFromUnknown(selectedSource, topicsQuery.error) : null,
    userRepliesError: repliesQuery.error ? sourceErrorFromUnknown(selectedSource, repliesQuery.error) : null,
    userTopicsBusy: topicsQuery.isFetching,
    userRepliesBusy: repliesQuery.isFetching,
    retryUserTopics: () => retryUserRead(() => retryTopicsRead({ cancelRefetch: false })),
    retryUserReplies: () => retryUserRead(() => retryRepliesRead({ cancelRefetch: false })),
    retryUserProfile: () =>
      selectedNeedsResolution && !identity
        ? refreshUser()
        : retryUserRead(() => profileQuery.refetch({ cancelRefetch: false })),
    userLoadingMoreReplies: repliesQuery.isFetchingNextPage,
    userLoadingMoreTopics: topicsQuery.isFetchingNextPage,
    userProfile
  };
}
