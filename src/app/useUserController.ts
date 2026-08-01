import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { mergeTopics } from '../feedLogic';
import {
  beginDiagnosticTrace,
  diagnosticRef,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason
} from '../diagnostics';
import { isUserFollowed, type FollowedUserRecord, type ReaderData } from '../readerData';
import { nodeSeekUserIdFromValue } from '../userNavigation';
import { sourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { sourceErrorFromUnknown, sourceReadRecoveryOutcome } from '../sourceErrors';
import type { Source, SourceErrorInfo, Topic, UserProfile, UserReference, UserReplyActivity } from '../types';
import type { Screen } from '../appTypes';
import type { SourceGateway } from '../sources/sourceGateway';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
import {
  initialForumSessionEpochs,
  forumQueryKeys,
  type ForumIdentityBarrierSource,
  type ForumSessionEpochs
} from './serverState';

type UserLane = 'topics' | 'replies';

function mergeUserReplies(existing: UserReplyActivity[] = [], incoming: UserReplyActivity[] = []) {
  const seen = new Set(existing.map((reply) => `${reply.source}:${reply.id}`));
  return [
    ...existing,
    ...incoming.filter((reply) => {
      const key = `${reply.source}:${reply.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  ];
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

export function hasNextUserPage(
  hasMore: boolean | undefined,
  nextCursor: string | null | undefined,
  requestedCursor: string | null | undefined
) {
  return Boolean(hasMore && nextCursor && nextCursor !== requestedCursor);
}

function normalizeRequestedUser(user: UserReference): UserReference | null {
  const username = user.username?.trim() || undefined;
  const id =
    user.source === 'nodeseek'
      ? nodeSeekUserIdFromValue(user.id) || nodeSeekUserIdFromValue(user.url) || undefined
      : user.id?.trim() || username;
  if (!id && !username) {
    return null;
  }
  const identity = id ? { id, ...(username ? { username } : {}) } : { username: username! };
  return {
    source: user.source,
    ...identity,
    displayName: user.displayName,
    avatar: user.avatar,
    url: user.url || ''
  };
}

function nextUserCursor(profile: UserProfile, lane: UserLane) {
  return lane === 'topics' ? profile.nextTopicsCursor : profile.nextRepliesCursor;
}

function hasMoreUserLane(profile: UserProfile, lane: UserLane) {
  return lane === 'topics' ? profile.hasMoreTopics : profile.hasMoreReplies;
}

function mergeUserProfile(profile: UserProfile, topicPages: UserProfile[], replyPages: UserProfile[]): UserProfile {
  const topics = topicPages.reduce<Topic[]>((items, page) => mergeTopics(items, page.topics || []), []);
  const replies = replyPages.reduce<UserReplyActivity[]>(
    (items, page) => mergeUserReplies(items, page.replies || []),
    []
  );
  const lastTopicPage = topicPages.at(-1) || profile;
  const lastReplyPage = replyPages.at(-1) || profile;
  return {
    ...profile,
    topics,
    replies,
    hasMoreTopics: Boolean(lastTopicPage.hasMoreTopics && lastTopicPage.nextTopicsCursor),
    nextTopicsCursor: lastTopicPage.nextTopicsCursor ?? null,
    hasMoreReplies: Boolean(lastReplyPage.hasMoreReplies && lastReplyPage.nextRepliesCursor),
    nextRepliesCursor: lastReplyPage.nextRepliesCursor ?? null
  };
}

function firstLaneData(profile: UserProfile): InfiniteData<UserProfile, string | null> {
  return { pages: [profile], pageParams: [null] };
}

export function useUserController({
  identityBarriers = [],
  sessionEpochs = initialForumSessionEpochs,
  notify,
  onOpenUserScreen,
  readerData,
  screen,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  identityBarriers?: readonly ForumIdentityBarrierSource[];
  sessionEpochs?: ForumSessionEpochs;
  notify: (message: string) => void;
  onOpenUserScreen: () => void;
  readerData: ReaderData;
  screen: Screen;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showNodeSeekVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
}) {
  const queryClient = useQueryClient();
  const handledUserErrorAtRef = useRef<Record<'resolution' | 'profile' | UserLane, number>>({
    profile: 0,
    resolution: 0,
    replies: 0,
    topics: 0
  });
  const [selectedUser, setSelectedUser] = useState<UserReference | null>(null);
  const followedUserRecords = useMemo<FollowedUserRecord[]>(
    () =>
      Object.values(readerData.followedUsers).sort(
        (left, right) => Date.parse(right.followedAt) - Date.parse(left.followedAt)
      ),
    [readerData.followedUsers]
  );
  const selectedSource = selectedUser?.source || 'v2ex';
  const selectedUsername = selectedUser?.username || '';
  const selectedNeedsResolution = Boolean(
    selectedUser?.source === 'nodeseek' && !nodeSeekUserIdFromValue(selectedUser.id) && selectedUsername
  );
  const selectedIdentityPending = Boolean(
    selectedUser && selectedUser.source !== 'v2ex' && identityBarriers.includes(selectedUser.source)
  );
  const resolutionKey = useMemo(
    () =>
      forumQueryKeys.userResolution({
        scope: sessionEpochs,
        username: selectedUsername
      }),
    [sessionEpochs.nodeseek, selectedUsername]
  );
  const resolutionEnabled = Boolean(selectedNeedsResolution && screen === 'user' && !selectedIdentityPending);
  const resolutionQuery = useQuery({
    queryKey: resolutionKey,
    enabled: resolutionEnabled,
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('user', 'resolveUser', {
        source: 'nodeseek',
        userRef: diagnosticRef('user', `nodeseek:${selectedUsername}`)
      });
      try {
        markDiagnosticStage(trace, 'guard', { source: 'nodeseek', state: 'resolve' });
        const resolved = await sourceGateway.resolveNodeSeekUser(
          {
            username: selectedUsername,
            signal
          },
          { trace }
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
  const profileKey = useMemo(
    () =>
      forumQueryKeys.user({
        source: selectedSource,
        userId: identity,
        scope: sessionEpochs
      }),
    [
      sessionEpochs.linuxdo,
      sessionEpochs.nodeseek,
      sessionEpochs.xiaoyinsi,
      sessionEpochs.yaohuo,
      identity,
      selectedSource
    ]
  );
  const topicKey = useMemo(() => forumQueryKeys.userLane(profileKey, 'topics'), [profileKey]);
  const replyKey = useMemo(() => forumQueryKeys.userLane(profileKey, 'replies'), [profileKey]);
  const enabled = Boolean(canonicalUser && identity && screen === 'user' && !selectedIdentityPending);

  const profileQuery = useQuery({
    queryKey: profileKey,
    enabled,
    queryFn: async ({ signal }) => {
      const user = canonicalUser!;
      const trace = beginDiagnosticTrace('user', 'open', {
        source: user.source,
        userRef: diagnosticRef('user', `${user.source}:${identity}`)
      });
      try {
        markDiagnosticStage(trace, 'guard', { source: user.source, state: 'open' });
        const profile = await sourceGateway.getUserProfile(
          {
            source: user.source,
            id: user.id!,
            username: user.username,
            signal
          },
          { trace }
        );
        if (sourceDiagnosticSummary(profile)?.isParseEmpty) {
          throw new Error('用户主页解析为空，无法显示，请重试。');
        }
        markDiagnosticStage(trace, 'apply', {
          source: user.source,
          topicCount: profile.topics.length,
          replyCount: profile.replies?.length || 0
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

  const createLaneQuery = (lane: UserLane, queryKey: QueryKey) => ({
    queryKey,
    enabled: enabled && Boolean(profileQuery.data),
    initialPageParam: null as string | null,
    initialData: profileQuery.data ? firstLaneData(profileQuery.data) : undefined,
    initialDataUpdatedAt: profileQuery.dataUpdatedAt || undefined,
    queryFn: async ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) => {
      if (!pageParam) return profileQuery.data!;
      const user = canonicalUser!;
      const trace = beginDiagnosticTrace('user', `load-more-${lane}`, {
        source: user.source,
        userRef: diagnosticRef('user', `${user.source}:${identity}`),
        hasCursor: true,
        cursorRef: diagnosticRef('cursor', pageParam)
      });
      try {
        markDiagnosticStage(trace, 'guard', { source: user.source, state: 'load-more', hasCursor: true });
        const page = await sourceGateway.getUserProfile(
          {
            source: user.source,
            id: user.id!,
            username: user.username,
            cursor: pageParam,
            cursorType: lane,
            signal
          },
          { trace }
        );
        if (sourceDiagnosticSummary(page)?.isParseEmpty) {
          throw new Error(`用户${lane === 'topics' ? '帖子' : '回复'}解析为空，无法加载下一页，请重试。`);
        }
        markDiagnosticStage(trace, 'apply', {
          source: user.source,
          itemCount: lane === 'topics' ? page.topics.length : page.replies?.length || 0
        });
        finishDiagnosticTrace(trace, 'success', { source: user.source });
        return page;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: user.source,
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    },
    getNextPageParam: (lastPage: UserProfile, _pages: UserProfile[], lastCursor: string | null) => {
      const next = nextUserCursor(lastPage, lane);
      return hasNextUserPage(hasMoreUserLane(lastPage, lane), next, lastCursor) ? next : undefined;
    }
  });
  const topicsQuery = useInfiniteQuery(createLaneQuery('topics', topicKey));
  const repliesQuery = useInfiniteQuery(createLaneQuery('replies', replyKey));

  const seedUserLane = useCallback(
    (key: QueryKey) => {
      const profile = profileQuery.data;
      if (!profile) return;
      const state = queryClient.getQueryState(key);
      if (!state || profileQuery.dataUpdatedAt > state.dataUpdatedAt) {
        queryClient.setQueryData<InfiniteData<UserProfile, string | null>>(
          key,
          (current) =>
            current
              ? {
                  pages: [profile, ...current.pages.slice(1)],
                  pageParams: [null, ...current.pageParams.slice(1)]
                }
              : firstLaneData(profile),
          { updatedAt: profileQuery.dataUpdatedAt }
        );
      }
    },
    [profileQuery.data, profileQuery.dataUpdatedAt, queryClient]
  );

  useEffect(() => {
    seedUserLane(topicKey);
    seedUserLane(replyKey);
  }, [replyKey, seedUserLane, topicKey]);

  const userProfile = useMemo(() => {
    const profile = profileQuery.data || topicsQuery.data?.pages[0] || repliesQuery.data?.pages[0];
    return profile
      ? mergeUserProfile(profile, topicsQuery.data?.pages || [profile], repliesQuery.data?.pages || [profile])
      : null;
  }, [profileQuery.data, repliesQuery.data?.pages, topicsQuery.data?.pages]);
  const queryError = resolutionQuery.error || profileQuery.error || topicsQuery.error || repliesQuery.error;
  const userError = queryError && selectedUser ? sourceErrorFromUnknown(selectedUser.source, queryError) : null;
  const currentUserFollowed = Boolean(userProfile && isUserFollowed(readerData, userProfile));

  const handleError = useCallback(
    (
      error: unknown,
      lane: 'resolution' | 'profile' | UserLane,
      resume: () => Promise<{ error: unknown; errorUpdatedAt: number; isError: boolean }>
    ) => {
      if (!selectedUser) return;
      const sourceError = sourceErrorFromUnknown(selectedUser.source, error);
      const target = userSourceRecoveryTarget(selectedUser.source, sourceError);
      if (target === 'linuxdo-verification') {
        const queryKey =
          lane === 'resolution'
            ? resolutionKey
            : lane === 'profile'
              ? profileKey
              : lane === 'topics'
                ? topicKey
                : replyKey;
        const recovery: LinuxDoReadRecovery = {
          queryKey,
          resume: async () => {
            const result = await resume();
            handledUserErrorAtRef.current[lane] = result.errorUpdatedAt;
            return result.isError ? sourceReadRecoveryOutcome('linuxdo', result.error) : 'completed';
          }
        };
        void showLinuxDoVerification(sourceError.message, recovery);
      } else if (target === 'nodeseek-verification') {
        if (lane !== 'resolution' && lane !== 'profile') {
          showNodeSeekVerification(sourceError.message);
          return;
        }
        const queryKey = lane === 'resolution' ? resolutionKey : profileKey;
        const recovery: LinuxDoReadRecovery = {
          queryKey,
          resume: async () => {
            const result = await resume();
            handledUserErrorAtRef.current[lane] = result.errorUpdatedAt;
            return result.isError ? sourceReadRecoveryOutcome('nodeseek', result.error) : 'completed';
          }
        };
        showNodeSeekVerification(sourceError.message, recovery);
      } else if (target === 'yaohuo-login') {
        showYaohuoLogin(sourceError.kind === 'login-expired' ? '妖火登录已失效，请重新登录。' : sourceError.message);
      } else {
        notify(sourceError.message);
      }
    },
    [
      notify,
      profileKey,
      replyKey,
      resolutionKey,
      selectedUser,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      topicKey
    ]
  );

  useEffect(() => {
    if (resolutionQuery.error && handledUserErrorAtRef.current.resolution !== resolutionQuery.errorUpdatedAt) {
      handledUserErrorAtRef.current.resolution = resolutionQuery.errorUpdatedAt;
      handleError(resolutionQuery.error, 'resolution', () => resolutionQuery.refetch({ cancelRefetch: false }));
    }
  }, [handleError, resolutionQuery.error, resolutionQuery.errorUpdatedAt, resolutionQuery.refetch, selectedUsername]);

  useEffect(() => {
    if (profileQuery.error && handledUserErrorAtRef.current.profile !== profileQuery.errorUpdatedAt) {
      handledUserErrorAtRef.current.profile = profileQuery.errorUpdatedAt;
      handleError(profileQuery.error, 'profile', () => profileQuery.refetch({ cancelRefetch: false }));
    }
  }, [
    handleError,
    identity,
    profileQuery.error,
    profileQuery.errorUpdatedAt,
    profileQuery.refetch,
    selectedUser?.source
  ]);
  useEffect(() => {
    if (topicsQuery.error && handledUserErrorAtRef.current.topics !== topicsQuery.errorUpdatedAt) {
      handledUserErrorAtRef.current.topics = topicsQuery.errorUpdatedAt;
      handleError(topicsQuery.error, 'topics', () => topicsQuery.fetchNextPage({ cancelRefetch: false }));
    }
  }, [
    handleError,
    identity,
    selectedUser?.source,
    topicsQuery.data?.pageParams,
    topicsQuery.error,
    topicsQuery.errorUpdatedAt,
    topicsQuery.fetchNextPage
  ]);
  useEffect(() => {
    if (repliesQuery.error && handledUserErrorAtRef.current.replies !== repliesQuery.errorUpdatedAt) {
      handledUserErrorAtRef.current.replies = repliesQuery.errorUpdatedAt;
      handleError(repliesQuery.error, 'replies', () => repliesQuery.fetchNextPage({ cancelRefetch: false }));
    }
  }, [
    handleError,
    identity,
    repliesQuery.data?.pageParams,
    repliesQuery.error,
    repliesQuery.errorUpdatedAt,
    repliesQuery.fetchNextPage,
    selectedUser?.source
  ]);

  const openUser = useCallback(
    async (user: UserReference): Promise<LinuxDoReadResumeOutcome> => {
      if (!user.id && !user.username) {
        notify('用户信息不完整');
        return 'completed';
      }
      const requested = normalizeRequestedUser(user);
      if (!requested) {
        notify('用户信息不完整');
        return 'completed';
      }
      onOpenUserScreen();
      setSelectedUser(requested);
      return 'completed';
    },
    [notify, onOpenUserScreen]
  );

  const refreshUser = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!selectedUser) return 'completed';
    if (selectedIdentityPending) return 'stale';
    if (selectedNeedsResolution && !resolutionQuery.data) {
      const result = await resolutionQuery.refetch({ cancelRefetch: true });
      return result.isError ? 'failed' : 'completed';
    }
    if (!identity) return 'completed';
    await queryClient.invalidateQueries({ queryKey: profileKey, exact: true, refetchType: 'active' });
    const profile = queryClient.getQueryData<UserProfile>(profileKey);
    if (profile) {
      queryClient.setQueryData(topicKey, firstLaneData(profile));
      queryClient.setQueryData(replyKey, firstLaneData(profile));
    }
    return 'completed';
  }, [
    identity,
    profileKey,
    queryClient,
    replyKey,
    resolutionQuery.data,
    resolutionQuery.refetch,
    selectedIdentityPending,
    selectedNeedsResolution,
    selectedUser,
    topicKey
  ]);

  const loadMoreUserTopics = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (selectedIdentityPending) return 'stale';
    if (topicsQuery.isFetchingNextPage || !profileQuery.data) return 'completed';
    seedUserLane(topicKey);
    if (queryClient.getQueryState(topicKey)?.fetchStatus === 'fetching') {
      await topicsQuery.refetch({ cancelRefetch: false });
    }
    const cached = queryClient.getQueryData<InfiniteData<UserProfile, string | null>>(topicKey);
    const lastPage = cached?.pages.at(-1);
    const lastCursor = cached?.pageParams.at(-1) ?? null;
    if (
      !lastPage ||
      !hasNextUserPage(hasMoreUserLane(lastPage, 'topics'), nextUserCursor(lastPage, 'topics'), lastCursor)
    )
      return 'completed';
    const result = await topicsQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [
    profileQuery.data,
    queryClient,
    seedUserLane,
    selectedIdentityPending,
    topicKey,
    topicsQuery.fetchNextPage,
    topicsQuery.isFetchingNextPage,
    topicsQuery.refetch
  ]);
  const loadMoreUserReplies = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (selectedIdentityPending) return 'stale';
    if (repliesQuery.isFetchingNextPage || !profileQuery.data) return 'completed';
    seedUserLane(replyKey);
    if (queryClient.getQueryState(replyKey)?.fetchStatus === 'fetching') {
      await repliesQuery.refetch({ cancelRefetch: false });
    }
    const cached = queryClient.getQueryData<InfiniteData<UserProfile, string | null>>(replyKey);
    const lastPage = cached?.pages.at(-1);
    const lastCursor = cached?.pageParams.at(-1) ?? null;
    if (
      !lastPage ||
      !hasNextUserPage(hasMoreUserLane(lastPage, 'replies'), nextUserCursor(lastPage, 'replies'), lastCursor)
    )
      return 'completed';
    const result = await repliesQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [
    profileQuery.data,
    queryClient,
    repliesQuery.fetchNextPage,
    repliesQuery.isFetchingNextPage,
    repliesQuery.refetch,
    replyKey,
    seedUserLane,
    selectedIdentityPending
  ]);

  useEffect(() => {
    if (screen === 'user' || !selectedUser) return;
    void queryClient.cancelQueries({ queryKey: resolutionKey, exact: true });
    void queryClient.cancelQueries({ queryKey: profileKey, exact: true });
    void queryClient.cancelQueries({ queryKey: topicKey, exact: true });
    void queryClient.cancelQueries({ queryKey: replyKey, exact: true });
  }, [profileKey, queryClient, replyKey, resolutionKey, screen, selectedUser, topicKey]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: resolutionKey, exact: true });
      void queryClient.cancelQueries({ queryKey: profileKey, exact: true });
      void queryClient.cancelQueries({ queryKey: topicKey, exact: true });
      void queryClient.cancelQueries({ queryKey: replyKey, exact: true });
    },
    [profileKey, queryClient, replyKey, resolutionKey, topicKey]
  );

  return {
    currentUserFollowed,
    followedUserRecords,
    loadMoreUserReplies,
    loadMoreUserTopics,
    openUser,
    refreshUser,
    selectedUser,
    userBusy: (resolutionQuery.isFetching && resolutionEnabled) || (profileQuery.isFetching && enabled),
    userError,
    userLoadingMoreReplies: repliesQuery.isFetchingNextPage,
    userLoadingMoreTopics: topicsQuery.isFetchingNextPage,
    userProfile
  };
}
