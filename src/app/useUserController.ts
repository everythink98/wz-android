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
import type { Source, SourceErrorInfo, Topic, UserProfile, UserReplyActivity } from '../types';
import type { Screen } from '../appTypes';
import type { SourceGateway } from '../sources/sourceGateway';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
import {
  emptyForumCredentialScope,
  forumQueryKeys,
  type ForumCredentialScope
} from './serverState';

type UserLane = 'topics' | 'replies';

function mergeUserReplies(existing: UserReplyActivity[] = [], incoming: UserReplyActivity[] = []) {
  const seen = new Set(existing.map((reply) => `${reply.source}:${reply.id}`));
  return [...existing, ...incoming.filter((reply) => {
    const key = `${reply.source}:${reply.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
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

function normalizeRequestedUser(user: UserProfile): UserProfile {
  const id = user.source === 'nodeseek'
    ? nodeSeekUserIdFromValue(user.id) || nodeSeekUserIdFromValue(user.url) || user.id || user.username
    : user.id || user.username;
  return {
    ...user,
    id,
    username: user.username || user.displayName || id,
    url: user.url || '',
    topics: user.topics || []
  };
}

function nextUserCursor(profile: UserProfile, lane: UserLane) {
  return lane === 'topics' ? profile.nextTopicsCursor : profile.nextRepliesCursor;
}

function hasMoreUserLane(profile: UserProfile, lane: UserLane) {
  return lane === 'topics' ? profile.hasMoreTopics : profile.hasMoreReplies;
}

function mergeUserProfile(
  profile: UserProfile,
  topicPages: UserProfile[],
  replyPages: UserProfile[]
): UserProfile {
  const topics = topicPages.reduce<Topic[]>((items, page) => mergeTopics(items, page.topics || []), []);
  const replies = replyPages.reduce<UserReplyActivity[]>((items, page) => mergeUserReplies(items, page.replies || []), []);
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
  credentialScope = emptyForumCredentialScope,
  notify,
  onOpenUserScreen,
  readerData,
  screen,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  credentialScope?: ForumCredentialScope;
  notify: (message: string) => void;
  onOpenUserScreen: () => void;
  readerData: ReaderData;
  screen: Screen;
  showLinuxDoVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void | Promise<void>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
}) {
  const queryClient = useQueryClient();
  const handledUserErrorAtRef = useRef<Record<'profile' | UserLane, number>>({
    profile: 0,
    replies: 0,
    topics: 0
  });
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const followedUserRecords = useMemo<FollowedUserRecord[]>(
    () => Object.values(readerData.followedUsers).sort((left, right) => Date.parse(right.followedAt) - Date.parse(left.followedAt)),
    [readerData.followedUsers]
  );
  const identity = selectedUser?.id || selectedUser?.username || '';
  const selectedSource = selectedUser?.source || 'v2ex';
  const selectedUsername = selectedUser?.username || '';
  const profileKey = useMemo(() => forumQueryKeys.user({
    source: selectedSource,
    userId: identity,
    username: selectedUsername,
    scope: credentialScope
  }), [
    credentialScope.linuxdo,
    credentialScope.nodeseek,
    credentialScope.xiaoyinsi,
    credentialScope.yaohuo,
    identity,
    selectedSource,
    selectedUsername
  ]);
  const topicKey = useMemo(() => forumQueryKeys.userLane(profileKey, 'topics'), [profileKey]);
  const replyKey = useMemo(() => forumQueryKeys.userLane(profileKey, 'replies'), [profileKey]);
  const enabled = Boolean(selectedUser && identity && screen === 'user');

  const profileQuery = useQuery({
    queryKey: profileKey,
    enabled,
    queryFn: async ({ signal }) => {
      const user = selectedUser!;
      const trace = beginDiagnosticTrace('user', 'open', {
        source: user.source,
        userRef: diagnosticRef('user', `${user.source}:${identity}`)
      });
      try {
        markDiagnosticStage(trace, 'guard', { source: user.source, state: 'open' });
        const profile = await sourceGateway.getUserProfile({
          source: user.source,
          id: user.id,
          username: user.username,
          signal
        }, { trace });
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
      const user = selectedUser!;
      const trace = beginDiagnosticTrace('user', `load-more-${lane}`, {
        source: user.source,
        userRef: diagnosticRef('user', `${user.source}:${identity}`),
        hasCursor: true,
        cursorRef: diagnosticRef('cursor', pageParam)
      });
      try {
        markDiagnosticStage(trace, 'guard', { source: user.source, state: 'load-more', hasCursor: true });
        const page = await sourceGateway.getUserProfile({
          source: user.source,
          id: user.id,
          username: user.username,
          cursor: pageParam,
          cursorType: lane,
          signal
        }, { trace });
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

  const seedUserLane = useCallback((key: QueryKey) => {
    const profile = profileQuery.data;
    if (!profile) return;
    const state = queryClient.getQueryState(key);
    if (!state || profileQuery.dataUpdatedAt > state.dataUpdatedAt) {
      queryClient.setQueryData<InfiniteData<UserProfile, string | null>>(key, (current) => current ? {
        pages: [profile, ...current.pages.slice(1)],
        pageParams: [null, ...current.pageParams.slice(1)]
      } : firstLaneData(profile), { updatedAt: profileQuery.dataUpdatedAt });
    }
  }, [profileQuery.data, profileQuery.dataUpdatedAt, queryClient]);

  useEffect(() => {
    seedUserLane(topicKey);
    seedUserLane(replyKey);
  }, [replyKey, seedUserLane, topicKey]);

  const userProfile = useMemo(() => {
    const profile = profileQuery.data || topicsQuery.data?.pages[0] || repliesQuery.data?.pages[0];
    return profile
      ? mergeUserProfile(profile, topicsQuery.data?.pages || [profile], repliesQuery.data?.pages || [profile])
      : null;
  },
  [profileQuery.data, repliesQuery.data?.pages, topicsQuery.data?.pages]);
  const queryError = profileQuery.error || topicsQuery.error || repliesQuery.error;
  const userError = queryError && selectedUser ? sourceErrorFromUnknown(selectedUser.source, queryError) : null;
  const currentUserFollowed = Boolean((userProfile || selectedUser) && isUserFollowed(readerData, (userProfile || selectedUser)!));

  const handleError = useCallback((
    error: unknown,
    lane: 'profile' | UserLane,
    resume: () => Promise<{ error: unknown; errorUpdatedAt: number; isError: boolean }>
  ) => {
    if (!selectedUser) return;
    const sourceError = sourceErrorFromUnknown(selectedUser.source, error);
    const target = userSourceRecoveryTarget(selectedUser.source, sourceError);
    if (target === 'linuxdo-verification') {
      const queryKey = lane === 'profile' ? profileKey : lane === 'topics' ? topicKey : replyKey;
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
      showNodeSeekVerification(sourceError.message);
    } else if (target === 'yaohuo-login') {
      showYaohuoLogin(sourceError.kind === 'login-expired' ? '妖火登录已失效，请重新登录。' : sourceError.message);
    } else {
      notify(sourceError.message);
    }
  }, [notify, profileKey, queryClient, replyKey, selectedUser, showLinuxDoVerification, showNodeSeekVerification, showYaohuoLogin, topicKey]);

  useEffect(() => {
    if (profileQuery.error && handledUserErrorAtRef.current.profile !== profileQuery.errorUpdatedAt) {
      handledUserErrorAtRef.current.profile = profileQuery.errorUpdatedAt;
      handleError(profileQuery.error, 'profile', () => profileQuery.refetch({ cancelRefetch: false }));
    }
  }, [handleError, identity, profileQuery.error, profileQuery.errorUpdatedAt, profileQuery.refetch, selectedUser?.source]);
  useEffect(() => {
    if (topicsQuery.error && handledUserErrorAtRef.current.topics !== topicsQuery.errorUpdatedAt) {
      handledUserErrorAtRef.current.topics = topicsQuery.errorUpdatedAt;
      handleError(topicsQuery.error, 'topics', () => topicsQuery.fetchNextPage({ cancelRefetch: false }));
    }
  }, [handleError, identity, selectedUser?.source, topicsQuery.data?.pageParams, topicsQuery.error, topicsQuery.errorUpdatedAt, topicsQuery.fetchNextPage]);
  useEffect(() => {
    if (repliesQuery.error && handledUserErrorAtRef.current.replies !== repliesQuery.errorUpdatedAt) {
      handledUserErrorAtRef.current.replies = repliesQuery.errorUpdatedAt;
      handleError(repliesQuery.error, 'replies', () => repliesQuery.fetchNextPage({ cancelRefetch: false }));
    }
  }, [handleError, identity, repliesQuery.data?.pageParams, repliesQuery.error, repliesQuery.errorUpdatedAt, repliesQuery.fetchNextPage, selectedUser?.source]);

  const openUser = useCallback(async (user: UserProfile, refresh = false): Promise<LinuxDoReadResumeOutcome> => {
    if (!user.id && !user.username) {
      notify('用户信息不完整');
      return 'completed';
    }
    const requested = normalizeRequestedUser(user);
    onOpenUserScreen();
    setSelectedUser(requested);
    if (refresh) {
      const key = forumQueryKeys.user({
        source: requested.source,
        userId: requested.id || requested.username,
        username: requested.username,
        scope: credentialScope
      });
      await queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'active' });
      const profile = queryClient.getQueryData<UserProfile>(key);
      if (profile) {
        queryClient.setQueryData(forumQueryKeys.userLane(key, 'topics'), firstLaneData(profile));
        queryClient.setQueryData(forumQueryKeys.userLane(key, 'replies'), firstLaneData(profile));
      }
    }
    return 'completed';
  }, [credentialScope, notify, onOpenUserScreen, queryClient]);

  const loadMoreUserTopics = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (topicsQuery.isFetchingNextPage || !profileQuery.data) return 'completed';
    seedUserLane(topicKey);
    if (queryClient.getQueryState(topicKey)?.fetchStatus === 'fetching') {
      await topicsQuery.refetch({ cancelRefetch: false });
    }
    const cached = queryClient.getQueryData<InfiniteData<UserProfile, string | null>>(topicKey);
    const lastPage = cached?.pages.at(-1);
    const lastCursor = cached?.pageParams.at(-1) ?? null;
    if (!lastPage || !hasNextUserPage(
      hasMoreUserLane(lastPage, 'topics'),
      nextUserCursor(lastPage, 'topics'),
      lastCursor
    )) return 'completed';
    const result = await topicsQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [profileQuery.data, queryClient, seedUserLane, topicKey, topicsQuery.fetchNextPage, topicsQuery.isFetchingNextPage, topicsQuery.refetch]);
  const loadMoreUserReplies = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (repliesQuery.isFetchingNextPage || !profileQuery.data) return 'completed';
    seedUserLane(replyKey);
    if (queryClient.getQueryState(replyKey)?.fetchStatus === 'fetching') {
      await repliesQuery.refetch({ cancelRefetch: false });
    }
    const cached = queryClient.getQueryData<InfiniteData<UserProfile, string | null>>(replyKey);
    const lastPage = cached?.pages.at(-1);
    const lastCursor = cached?.pageParams.at(-1) ?? null;
    if (!lastPage || !hasNextUserPage(
      hasMoreUserLane(lastPage, 'replies'),
      nextUserCursor(lastPage, 'replies'),
      lastCursor
    )) return 'completed';
    const result = await repliesQuery.fetchNextPage({ cancelRefetch: false });
    return result.isError ? 'failed' : 'completed';
  }, [profileQuery.data, queryClient, repliesQuery.fetchNextPage, repliesQuery.isFetchingNextPage, repliesQuery.refetch, replyKey, seedUserLane]);

  useEffect(() => {
    if (screen === 'user' || !selectedUser) return;
    void queryClient.cancelQueries({ queryKey: profileKey, exact: true });
    void queryClient.cancelQueries({ queryKey: topicKey, exact: true });
    void queryClient.cancelQueries({ queryKey: replyKey, exact: true });
  }, [profileKey, queryClient, replyKey, screen, selectedUser, topicKey]);

  return {
    currentUserFollowed,
    followedUserRecords,
    loadMoreUserReplies,
    loadMoreUserTopics,
    openUser,
    selectedUser,
    userBusy: profileQuery.isFetching && enabled,
    userError,
    userLoadingMoreReplies: repliesQuery.isFetchingNextPage,
    userLoadingMoreTopics: topicsQuery.isFetchingNextPage,
    userProfile
  };
}
