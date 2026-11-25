import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CancelledError,
  hashKey,
  isCancelledError,
  notifyManager,
  skipToken,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type Query,
  type QueryKey,
  type QueryState
} from '@tanstack/react-query';
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
import type { LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { isCanceledRequest } from '@/platform/network/errors';
import { forumQueryKeys } from '@/platform/query/serverState';
import {
  resumeExactQuery,
  resumeInfiniteQueryPage,
  useFirstPageInfiniteQuery,
  type FirstPageInfiniteQueryOptions
} from '@/platform/query/useFirstPageInfiniteQuery';
import { isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';

type UserLane = 'topics' | 'replies';
type UserRefreshLane = 'profile' | UserLane;
type UserErrorLane = 'resolution' | UserRefreshLane;
type UserActivityPage = Partial<UserTopicsPage & UserRepliesPage>;
type UserActivityData = InfiniteData<UserActivityPage>;
type ResumeUserRead = (ownsRead: () => boolean, signal?: AbortSignal) => ReturnType<typeof resumeExactQuery>;

class UserRefreshError extends Error {
  constructor(
    readonly lanes: Partial<Record<UserRefreshLane, { cause: unknown; queryState: QueryState | undefined }>>
  ) {
    super('用户页刷新失败');
  }

  currentFailure(lane: UserRefreshLane, current: QueryState | undefined) {
    const failure = this.lanes[lane];
    return failure && failure.queryState === current ? failure : undefined;
  }
}

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
  showLinuxDoVerification: (message?: string, recovery?: ReadRecovery) => void | boolean | Promise<void | boolean>;
  showNodeSeekVerification: (message?: string, recovery?: ReadRecovery) => void;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
  user: UserReference;
}) {
  const queryClient = useQueryClient();
  const refreshOwner = useId();
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
  const resolutionOptions = {
    queryKey: resolutionKey,
    enabled: resolutionEnabled,
    subscribed: active,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
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
  };
  const resolutionQuery = useQuery(resolutionOptions);
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
  const refreshKey = useMemo(() => [...profileKey, 'refresh', refreshOwner] as const, [profileKey, refreshOwner]);
  const readScope = hashKey([profileKey, selectedNeedsResolution ? resolutionKey : null]);
  const recoveryScope = hashKey([selectedSource, selectedUser?.id, selectedUsername, profileSessionEpoch]);
  const activeRecovery = useRef<object | null>(null);
  const activeRead = useRef<{ scope: string } | null>(null);
  const refreshingRead = useRef<{ scope: string } | null>(null);
  useLayoutEffect(() => {
    activeRead.current = active ? { scope: readScope } : null;
    return () => {
      activeRead.current = null;
    };
  }, [active, readScope]);
  useLayoutEffect(() => {
    activeRecovery.current = active ? { scope: recoveryScope } : null;
    return () => {
      activeRecovery.current = null;
    };
  }, [active, recoveryScope]);
  const currentRead = useCallback(
    () => (activeRead.current?.scope === readScope ? activeRead.current : null),
    [readScope]
  );
  const enabled = Boolean(canonicalUser && identity && active);
  const refreshQuery = useQuery<true>({ queryKey: refreshKey, queryFn: skipToken, enabled: false, subscribed: active });

  const profileOptions = {
    queryKey: profileKey,
    enabled,
    subscribed: active,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
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
  };
  const profileQuery = useQuery(profileOptions);

  async function readActivity(lane: UserLane, details: UserDetails, cursor: string | null, signal: AbortSignal) {
    const options = { source: details.source, profile: details, cursor, signal };
    const context = { plan: profileReadPlan };
    const page =
      lane === 'topics'
        ? await readGateway.getUserTopics(options, context)
        : await readGateway.getUserReplies(options, context);
    if (sourceDiagnosticSummary(page)?.isParseEmpty)
      throw new Error(`用户${lane === 'topics' ? '主题' : '回复'}响应无法解析`);
    return page;
  }

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
      return readActivity(lane, details, pageParam, signal);
    },
    getNextPageParam: (
      lastPage: UserActivityPage,
      _pages: UserActivityPage[],
      _lastCursor: string | null,
      cursors: (string | null)[]
    ) => nextUserActivityCursor(lastPage, lane, cursors)
  });
  const topicOptions = createLaneQuery('topics', topicKey);
  const replyOptions = createLaneQuery('replies', replyKey);
  const [topicsQuery, refreshTopicsFirstPage] = useFirstPageInfiniteQuery<UserActivityPage, string | null>(
    topicOptions
  );
  const [repliesQuery, refreshRepliesFirstPage] = useFirstPageInfiniteQuery<UserActivityPage, string | null>(
    replyOptions
  );
  const refreshFailure = refreshQuery.error instanceof UserRefreshError ? refreshQuery.error : null;
  const profileRefreshFailure = refreshFailure?.currentFailure('profile', queryClient.getQueryState(profileKey));
  const topicsRefreshFailure = refreshFailure?.currentFailure('topics', queryClient.getQueryState(topicKey));
  const repliesRefreshFailure = refreshFailure?.currentFailure('replies', queryClient.getQueryState(replyKey));
  const topicsError = topicsRefreshFailure?.cause ?? topicsQuery.error;
  const repliesError = repliesRefreshFailure?.cause ?? repliesQuery.error;
  const retryTopicsNext = topicsQuery.isFetchNextPageError && !topicsRefreshFailure;
  const retryRepliesNext = repliesQuery.isFetchNextPageError && !repliesRefreshFailure;
  const retryTopicsRead = retryTopicsNext ? topicsQuery.fetchNextPage : refreshTopicsFirstPage;
  const retryRepliesRead = retryRepliesNext ? repliesQuery.fetchNextPage : refreshRepliesFirstPage;
  const resolutionErrorCount = queryClient.getQueryState(resolutionKey)?.errorUpdateCount ?? 0;
  const refreshErrorCount = queryClient.getQueryState(refreshKey)?.errorUpdateCount ?? 0;
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
  const profileError = profileRefreshFailure?.cause ?? profileQuery.error;
  const queryError = resolutionError || profileError;
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
    (error: unknown, lane: UserErrorLane, resume: ResumeUserRead, transactionError?: UserRefreshError | null) => {
      const route = activeRecovery.current;
      if (!currentRead() || !route || !selectedUser || (lane === 'resolution' && !selectedNeedsResolution)) return;
      const queryKey = { resolution: resolutionKey, profile: profileKey, topics: topicKey, replies: replyKey }[lane];
      if (!claimUserError(lane, transactionError ? refreshKey : queryKey, transactionError ?? error)) return;
      const { source } = selectedUser;
      const sourceError = sourceErrorFromUnknown(source, error);
      const target = userSourceRecoveryTarget(source, sourceError);
      if (target === 'linuxdo-verification' || target === 'nodeseek-verification') {
        const canonicalMatches = () =>
          !selectedNeedsResolution ||
          queryClient.getQueryData<UserReference>(resolutionKey)?.id === (identity || undefined);
        const ownsRoute = () => activeRecovery.current === route;
        const isCurrent = () => ownsRoute() && canonicalMatches();
        const plan = lane === 'resolution' ? resolutionReadPlan : profileReadPlan;
        const recovery: ReadRecovery = {
          queryKey,
          isCurrent,
          resume: async (signal) => {
            if (!isCurrent()) return 'stale';
            const ownsRead = () =>
              ownsRoute() &&
              (lane === 'resolution' || canonicalMatches()) &&
              readGateway.getReadPlan(source, plan.operation).cacheScope === plan.cacheScope;
            const result = await resume(ownsRead, signal);
            if (result.kind === 'failed') {
              claimUserError(lane, queryKey, result.error);
              return sourceReadRecoveryOutcome(source, result.error);
            }
            return result.kind === 'success' ? 'completed' : 'stale';
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
      claimUserError,
      currentRead,
      identity,
      notify,
      profileKey,
      profileReadPlan,
      queryClient,
      readGateway,
      refreshKey,
      replyKey,
      resolutionKey,
      resolutionReadPlan,
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
      handleError(resolutionError, 'resolution', (ownsRead, signal) =>
        resumeExactQuery(queryClient, resolutionOptions, ownsRead, signal)
      );
    }
  }, [handleError, queryClient, resolutionError, resolutionErrorCount, resolutionOptions]);

  useEffect(() => {
    if (profileError) {
      handleError(
        profileError,
        'profile',
        (ownsRead, signal) => resumeExactQuery(queryClient, profileOptions, ownsRead, signal),
        profileRefreshFailure ? refreshFailure : null
      );
    }
  }, [
    handleError,
    queryClient,
    profileError,
    profileErrorCount,
    profileOptions,
    profileRefreshFailure,
    refreshErrorCount,
    refreshFailure
  ]);

  const resumeActivity = useCallback(
    (
      options: FirstPageInfiniteQueryOptions<UserActivityPage, string | null>,
      next: boolean,
      cursor: string | null | undefined,
      ownsRead: () => boolean,
      signal?: AbortSignal
    ): ReturnType<typeof resumeInfiniteQueryPage> => {
      if (next && !cursor) return Promise.resolve({ kind: 'stale' });
      return resumeInfiniteQueryPage(
        queryClient,
        options,
        next && cursor ? { kind: 'next', pageParam: cursor } : { kind: 'first' },
        ownsRead,
        signal
      );
    },
    [queryClient]
  );
  useEffect(() => {
    if (topicsError) {
      handleError(
        topicsError,
        'topics',
        (ownsRead, signal) => resumeActivity(topicOptions, retryTopicsNext, nextTopicsCursor, ownsRead, signal),
        topicsRefreshFailure ? refreshFailure : null
      );
    }
  }, [
    handleError,
    nextTopicsCursor,
    refreshErrorCount,
    refreshFailure,
    resumeActivity,
    retryTopicsNext,
    topicOptions,
    topicsError,
    topicsErrorCount,
    topicsRefreshFailure
  ]);
  useEffect(() => {
    if (repliesError) {
      handleError(
        repliesError,
        'replies',
        (ownsRead, signal) => resumeActivity(replyOptions, retryRepliesNext, nextRepliesCursor, ownsRead, signal),
        repliesRefreshFailure ? refreshFailure : null
      );
    }
  }, [
    handleError,
    nextRepliesCursor,
    refreshErrorCount,
    refreshFailure,
    replyOptions,
    repliesError,
    repliesErrorCount,
    repliesRefreshFailure,
    resumeActivity,
    retryRepliesNext
  ]);

  const refreshUser = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    const owner = currentRead();
    if (!owner || !selectedUser || refreshingRead.current === owner) return 'stale';
    refreshingRead.current = owner;
    try {
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
      await Promise.all(
        [profileKey, topicKey, replyKey].map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true }))
      );
      if (activeRead.current !== owner) return 'stale';
      const previous = queryClient.getQueryState(refreshKey);
      const refreshEntry = queryClient.getQueryCache().find({ queryKey: refreshKey, exact: true });
      let staged: { profile: UserDetails; topics: UserActivityPage; replies: UserActivityPage } | undefined;
      await queryClient.fetchQuery({
        queryKey: refreshKey,
        staleTime: 0,
        queryFn: async ({ signal }) => {
          const cancel = (): never => {
            if (!signal.aborted) void refreshEntry?.cancel({ revert: true });
            throw new CancelledError({ revert: true });
          };
          const profile = await profileOptions.queryFn({ signal }).catch((error: unknown) => {
            if (signal.aborted || activeRead.current !== owner || isCanceledRequest(error)) return cancel();
            throw new UserRefreshError({
              profile: { cause: error, queryState: queryClient.getQueryState(profileKey) }
            });
          });
          if (signal.aborted || activeRead.current !== owner) return cancel();
          const [topics, replies] = await Promise.allSettled([
            readActivity('topics', profile, null, signal),
            readActivity('replies', profile, null, signal)
          ]);
          if (signal.aborted || activeRead.current !== owner) return cancel();
          if (topics.status === 'rejected' || replies.status === 'rejected') {
            if (
              (topics.status === 'rejected' && isCanceledRequest(topics.reason)) ||
              (replies.status === 'rejected' && isCanceledRequest(replies.reason))
            )
              return cancel();
            throw new UserRefreshError({
              ...(topics.status === 'rejected'
                ? { topics: { cause: topics.reason, queryState: queryClient.getQueryState(topicKey) } }
                : {}),
              ...(replies.status === 'rejected'
                ? { replies: { cause: replies.reason, queryState: queryClient.getQueryState(replyKey) } }
                : {})
            });
          }
          staged = { profile, topics: topics.value, replies: replies.value };
          return true;
        }
      });
      const committed = queryClient.getQueryState(refreshKey);
      if (
        activeRead.current !== owner ||
        !staged ||
        !committed ||
        committed.dataUpdateCount <= (previous?.dataUpdateCount ?? 0)
      )
        return 'stale';
      const { profile, topics, replies } = staged;
      notifyManager.batch(() => {
        queryClient.setQueryData<UserDetails>(profileKey, profile);
        queryClient.setQueryData<InfiniteData<UserActivityPage, string | null>>(topicKey, {
          pages: [topics],
          pageParams: [null]
        });
        queryClient.setQueryData<InfiniteData<UserActivityPage, string | null>>(replyKey, {
          pages: [replies],
          pageParams: [null]
        });
      });
      return 'completed';
    } catch (error) {
      return activeRead.current !== owner || isCancelledError(error) || isCanceledRequest(error) ? 'stale' : 'failed';
    } finally {
      if (refreshingRead.current === owner) refreshingRead.current = null;
    }
  }, [
    currentRead,
    identity,
    onRetryIdentityStatus,
    profileKey,
    profileOptions,
    profileReadPlan,
    queryClient,
    readActivity,
    refreshKey,
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
    if (!owner || refreshingRead.current === owner) return 'stale';
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
    if (!owner || refreshingRead.current === owner) return 'stale';
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
    const owner = currentRead();
    if (!owner || refreshingRead.current === owner) return;
    if (selectedSource === 'yaohuo') handledYaohuoLoginReadKeyRef.current = null;
    return read();
  }

  return {
    currentUserFollowed,
    loadMoreUserReplies,
    loadMoreUserTopics,
    refreshUser,
    selectedUser,
    userBusy:
      (resolutionQuery.isFetching && resolutionEnabled) ||
      (enabled && (profileQuery.isFetching || refreshQuery.isFetching)),
    userError,
    userTopicsError: topicsError ? sourceErrorFromUnknown(selectedSource, topicsError) : null,
    userRepliesError: repliesError ? sourceErrorFromUnknown(selectedSource, repliesError) : null,
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
