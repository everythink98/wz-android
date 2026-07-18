import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceGateway } from '../sources/sourceGateway';
import { mergeTopics } from '../feedLogic';
import {
  beginDiagnosticTrace,
  diagnosticRef,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticReason
} from '../diagnostics';
import {
  isUserFollowed,
  type FollowedUserRecord,
  type ReaderData
} from '../readerData';
import {
  finishAbortableRequest,
  isCanceledRequest,
  startAbortableRequest
} from '../appUtils';
import { nodeSeekUserIdFromValue } from '../userNavigation';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import { authHintForSource } from '../siteSessionPrompts';
import { sourceErrorFromUnknown } from '../sourceErrors';
import type { SiteSessionViewModels } from '../siteSessionState';
import type { Source, SourceErrorInfo, UserProfile, UserReplyActivity } from '../types';
import type { Screen } from '../appTypes';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';

function mergeUserReplies(existing: UserReplyActivity[] = [], incoming: UserReplyActivity[] = []) {
  const seen = new Set(existing.map((reply) => `${reply.source}:${reply.id}`));
  const merged = [...existing];
  for (const reply of incoming) {
    const key = `${reply.source}:${reply.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(reply);
    }
  }
  return merged;
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

function diagnosticReasonForUserError(error: SourceErrorInfo): DiagnosticReason {
  if (error.kind === 'login-required' || error.kind === 'login-expired') return 'login_required';
  if (error.kind === 'verification-required') return 'verification_required';
  if (error.kind === 'permission-denied') return 'permission_denied';
  return normalizeDiagnosticReason(error.message);
}

function diagnosticUserFields(user?: Pick<UserProfile, 'source' | 'id' | 'username'> | null, cursor?: string | null): DiagnosticFields {
  return {
    ...(user ? {
      source: user.source,
      userRef: diagnosticRef('user', `${user.source}:${user.id || user.username}`)
    } : {}),
    hasCursor: Boolean(cursor),
    ...(cursor ? { cursorRef: diagnosticRef('cursor', cursor) } : {})
  };
}

export function useUserController({
  notify,
  onOpenUserScreen,
  readerData,
  screen,
  sessionViewModels,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin,
  sourceGateway
}: {
  notify: (message: string) => void;
  onOpenUserScreen: () => void;
  readerData: ReaderData;
  screen: Screen;
  sessionViewModels: SiteSessionViewModels;
  showLinuxDoVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void | Promise<void>;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
}) {
  const userRequestIdRef = useRef(0);
  const userRequestOwnerRef = useRef(createRequestOwner('user'));
  const userAbortRef = useRef<AbortController | null>(null);
  const userLoadingMoreTopicCursorRef = useRef<string | null>(null);
  const userLoadingMoreReplyCursorRef = useRef<string | null>(null);
  const userVisitedTopicCursorsRef = useRef<Set<string>>(new Set());
  const userVisitedReplyCursorsRef = useRef<Set<string>>(new Set());
  const openUserRef = useRef<((user: UserProfile, nocache?: boolean, suppressLinuxDoVerification?: boolean) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const loadMoreUserTopicsRef = useRef<((suppressLinuxDoVerification?: boolean) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const loadMoreUserRepliesRef = useRef<((suppressLinuxDoVerification?: boolean) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userLoadingMoreTopics, setUserLoadingMoreTopics] = useState(false);
  const [userLoadingMoreReplies, setUserLoadingMoreReplies] = useState(false);
  const [userError, setUserError] = useState<SourceErrorInfo | null>(null);

  const followedUserRecords = useMemo<FollowedUserRecord[]>(
    () => Object.values(readerData.followedUsers).sort((left, right) => Date.parse(right.followedAt) - Date.parse(left.followedAt)),
    [readerData.followedUsers]
  );
  const currentUserFollowed = Boolean((userProfile || selectedUser) && isUserFollowed(readerData, (userProfile || selectedUser) as UserProfile));

  const cancelUserRequests = useCallback(() => {
    userRequestIdRef.current += 1;
    userAbortRef.current?.abort();
    setUserBusy(false);
    setUserLoadingMoreTopics(false);
    setUserLoadingMoreReplies(false);
    userLoadingMoreTopicCursorRef.current = null;
    userLoadingMoreReplyCursorRef.current = null;
    userVisitedTopicCursorsRef.current = new Set();
    userVisitedReplyCursorsRef.current = new Set();
  }, []);

  useEffect(() => {
    if (screen !== 'user') {
      cancelUserRequests();
    }
  }, [cancelUserRequests, screen]);

  useEffect(() => cancelUserRequests, [cancelUserRequests]);

  const handleUserSourceError = useCallback(async ({ error, recovery, source, suppressLinuxDoVerification = false }: {
    error: unknown;
    recovery?: LinuxDoReadRecovery;
    source: Source;
    suppressLinuxDoVerification?: boolean;
  }): Promise<LinuxDoReadResumeOutcome> => {
    const classifiedError = sourceErrorFromUnknown(source, error);
    const sourceError = source === 'yaohuo' && classifiedError.kind === 'login-required'
      ? {
        ...classifiedError,
        message: authHintForSource('yaohuo', sessionViewModels, 'read') || classifiedError.message
      }
      : classifiedError;
    setUserError(sourceError);
    const recoveryTarget = userSourceRecoveryTarget(source, sourceError);
    if (recoveryTarget === 'linuxdo-verification') {
      if (!suppressLinuxDoVerification) {
        await showLinuxDoVerification(sourceError.message, recovery);
      }
      return 'verification-required';
    }
    if (recoveryTarget === 'nodeseek-verification') {
      showNodeSeekVerification(sourceError.message);
      return 'completed';
    }
    if (recoveryTarget === 'yaohuo-login') {
      if (sourceError.kind === 'login-expired') {
        showYaohuoLogin('妖火登录已失效，请重新登录。');
      } else {
        showYaohuoLogin(sourceError.message);
      }
      return 'completed';
    }
    notify(sourceError.message);
    return 'completed';
  }, [notify, sessionViewModels, showLinuxDoVerification, showNodeSeekVerification, showYaohuoLogin]);

  const openUser = useCallback(async (
    user: UserProfile,
    nocache = false,
    suppressLinuxDoVerification = false
  ): Promise<LinuxDoReadResumeOutcome> => {
    const trace = beginDiagnosticTrace('user', 'open', diagnosticUserFields(user));
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
    if (!user.id && !user.username) {
      markDiagnosticStage(trace, 'guard', { source: user.source, state: 'incomplete-user' });
      finishTrace('blocked', { source: user.source, reason: 'not_ready' });
      notify('用户信息不完整');
      return 'completed';
    }
    markDiagnosticStage(trace, 'guard', {
      source: user.source,
      state: nocache ? 'refresh' : 'open',
      hasUserId: Boolean(user.id),
      hasUsername: Boolean(user.username)
    });
    onOpenUserScreen();
    const requestUser = {
      ...user,
      id: user.source === 'nodeseek' ? nodeSeekUserIdFromValue(user.id) || nodeSeekUserIdFromValue(user.url) || user.id || user.username : user.id || user.username,
      username: user.username || user.displayName || user.id,
      url: user.url || '',
      topics: user.topics || []
    };
    const requestId = ++userRequestIdRef.current;
    const requestOwner = startOwnedRequest(userRequestOwnerRef, `user:${requestUser.source}:${requestUser.id || requestUser.username}:${nocache ? 'nocache' : 'cache'}`);
    const isCurrentUserRequest = () => isCurrentOwnedRequest(requestOwner, userRequestOwnerRef) && requestId === userRequestIdRef.current;
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: requestOwner.key,
      isCurrent: isCurrentUserRequest,
      resume: async () => {
        if (!isCurrentUserRequest()) {
          return 'stale';
        }
        return await openUserRef.current?.(requestUser, true, true) ?? 'stale';
      }
    };
    setSelectedUser(requestUser);
    const preserveCurrentProfile = Boolean(
      nocache
      && userProfile
      && userProfile.source === requestUser.source
      && userProfile.id === requestUser.id
    );
    if (!preserveCurrentProfile) {
      setUserProfile(null);
    }
    setUserError(null);
    setUserBusy(true);
    setUserLoadingMoreTopics(false);
    setUserLoadingMoreReplies(false);
    userLoadingMoreTopicCursorRef.current = null;
    userLoadingMoreReplyCursorRef.current = null;
    userVisitedTopicCursorsRef.current = new Set();
    userVisitedReplyCursorsRef.current = new Set();
    const controller = startAbortableRequest(userAbortRef);
    try {
      const profile = await sourceGateway.getUserProfile({
        source: requestUser.source,
        id: requestUser.id,
        username: requestUser.username,
        signal: controller.signal
      }, { isCurrent: isCurrentUserRequest, trace });
      if (!isCurrentUserRequest()) {
        finishTrace(controller.signal.aborted ? 'canceled' : 'stale', {
          source: requestUser.source,
          reason: controller.signal.aborted ? 'canceled' : 'superseded'
        });
        return 'stale';
      }
      markDiagnosticStage(trace, 'apply', {
        source: requestUser.source,
        beforeCount: 0,
        afterCount: profile.topics.length + (profile.replies?.length || 0),
        topicCount: profile.topics.length,
        replyCount: profile.replies?.length || 0,
        hasMoreTopics: Boolean(profile.hasMoreTopics),
        hasMoreReplies: Boolean(profile.hasMoreReplies)
      });
      setUserProfile(profile);
      if (nocache) {
        notify('用户主页已更新');
      }
      finishTrace('success', {
        source: requestUser.source,
        topicCount: profile.topics.length,
        replyCount: profile.replies?.length || 0
      });
      return 'completed';
    } catch (error) {
      if (isCanceledRequest(error)) {
        finishTrace(isCurrentUserRequest() ? 'canceled' : 'stale', {
          source: requestUser.source,
          reason: isCurrentUserRequest() ? 'canceled' : 'superseded'
        });
        return 'stale';
      } else if (!isCurrentUserRequest()) {
        finishTrace('stale', { source: requestUser.source, reason: 'superseded' });
        return 'stale';
      } else {
        const sourceError = sourceErrorFromUnknown(requestUser.source, error);
        const reason = diagnosticReasonForUserError(sourceError);
        finishTrace(
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source: requestUser.source, reason }
        );
        return await handleUserSourceError({
          error,
          recovery: requestUser.source === 'linuxdo' ? linuxDoRecovery : undefined,
          source: requestUser.source,
          suppressLinuxDoVerification
        });
      }
    } finally {
      if (!traceFinished) {
        finishTrace(isCurrentUserRequest() ? 'failure' : controller.signal.aborted ? 'canceled' : 'stale', {
          source: requestUser.source,
          reason: isCurrentUserRequest() ? 'unknown' : controller.signal.aborted ? 'canceled' : 'superseded'
        });
      }
      if (isCurrentUserRequest()) {
        setUserBusy(false);
        setUserLoadingMoreTopics(false);
        setUserLoadingMoreReplies(false);
      }
      finishAbortableRequest(userAbortRef, controller);
    }
  }, [
    handleUserSourceError,
    notify,
    onOpenUserScreen,
    sourceGateway,
    userProfile
  ]);

  openUserRef.current = openUser;

  const loadMoreUserTopics = useCallback(async (
    suppressLinuxDoVerification = false
  ): Promise<LinuxDoReadResumeOutcome> => {
    const current = userProfile;
    const trace = beginDiagnosticTrace('user', 'load-more-topics', diagnosticUserFields(current, current?.nextTopicsCursor));
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
    if (!current?.hasMoreTopics || !current.nextTopicsCursor || userBusy || userLoadingMoreTopics || userLoadingMoreTopicCursorRef.current === current.nextTopicsCursor) {
      const busy = Boolean(userBusy || userLoadingMoreTopics || (current?.nextTopicsCursor && userLoadingMoreTopicCursorRef.current === current.nextTopicsCursor));
      markDiagnosticStage(trace, 'guard', {
        ...(current ? { source: current.source } : {}),
        state: !current ? 'missing-user' : busy ? 'busy' : current.hasMoreTopics ? 'missing-cursor' : 'complete'
      });
      finishTrace(busy ? 'blocked' : current?.hasMoreTopics ? 'blocked' : current ? 'noop' : 'blocked', {
        ...(current ? { source: current.source } : {}),
        ...(busy ? { reason: 'busy' } : current?.hasMoreTopics ? { reason: 'not_ready' } : current ? {} : { reason: 'not_ready' })
      });
      return 'completed';
    }
    markDiagnosticStage(trace, 'guard', { source: current.source, state: 'load-more', hasCursor: true });
    const requestId = ++userRequestIdRef.current;
    const requestOwner = startOwnedRequest(userRequestOwnerRef, `user:${current.source}:${current.id || current.username}:more:${current.nextTopicsCursor}`);
    const isCurrentUserRequest = () => isCurrentOwnedRequest(requestOwner, userRequestOwnerRef) && requestId === userRequestIdRef.current;
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: requestOwner.key,
      isCurrent: isCurrentUserRequest,
      resume: async () => {
        if (!isCurrentUserRequest()) {
          return 'stale';
        }
        return await loadMoreUserTopicsRef.current?.(true) ?? 'stale';
      }
    };
    const controller = startAbortableRequest(userAbortRef);
    userLoadingMoreTopicCursorRef.current = current.nextTopicsCursor;
    setUserLoadingMoreTopics(true);
    setUserError(null);
    try {
      const nextProfile = await sourceGateway.getUserProfile({
        source: current.source,
        id: current.id,
        username: current.username,
        cursor: current.nextTopicsCursor,
        cursorType: 'topics',
        signal: controller.signal
      }, { isCurrent: isCurrentUserRequest, trace });
      if (!isCurrentUserRequest()) {
        finishTrace(controller.signal.aborted ? 'canceled' : 'stale', {
          source: current.source,
          reason: controller.signal.aborted ? 'canceled' : 'superseded'
        });
        return 'stale';
      }
      const expectedAfterCount = mergeTopics(current.topics, nextProfile.topics).length;
      markDiagnosticStage(trace, 'apply', {
        source: current.source,
        beforeCount: current.topics.length,
        afterCount: expectedAfterCount,
        itemCount: nextProfile.topics.length,
        hasMore: Boolean(nextProfile.hasMoreTopics)
      });
      setUserProfile((previous) => {
        if (!previous || previous.source !== current.source || previous.id !== current.id) {
          return previous;
        }
        const mergedTopics = mergeTopics(previous.topics, nextProfile.topics);
        userVisitedTopicCursorsRef.current.add(current.nextTopicsCursor || '');
        const canLoadNext = Boolean(nextProfile.hasMoreTopics && nextProfile.nextTopicsCursor && !userVisitedTopicCursorsRef.current.has(nextProfile.nextTopicsCursor));
        return {
          ...previous,
          topics: mergedTopics,
          hasMoreTopics: canLoadNext,
          nextTopicsCursor: canLoadNext ? nextProfile.nextTopicsCursor : null
        };
      });
      notify('用户帖子已加载更多');
      finishTrace('success', {
        source: current.source,
        beforeCount: current.topics.length,
        afterCount: expectedAfterCount,
        hasMore: Boolean(nextProfile.hasMoreTopics)
      });
      return 'completed';
    } catch (error) {
      if (isCanceledRequest(error)) {
        finishTrace(isCurrentUserRequest() ? 'canceled' : 'stale', {
          source: current.source,
          reason: isCurrentUserRequest() ? 'canceled' : 'superseded'
        });
        return 'stale';
      } else if (!isCurrentUserRequest()) {
        finishTrace('stale', { source: current.source, reason: 'superseded' });
        return 'stale';
      } else {
        const sourceError = sourceErrorFromUnknown(current.source, error);
        const reason = diagnosticReasonForUserError(sourceError);
        finishTrace(
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source: current.source, reason }
        );
        return await handleUserSourceError({
          error,
          recovery: current.source === 'linuxdo' ? linuxDoRecovery : undefined,
          source: current.source,
          suppressLinuxDoVerification
        });
      }
    } finally {
      if (!traceFinished) {
        finishTrace(isCurrentUserRequest() ? 'failure' : controller.signal.aborted ? 'canceled' : 'stale', {
          source: current.source,
          reason: isCurrentUserRequest() ? 'unknown' : controller.signal.aborted ? 'canceled' : 'superseded'
        });
      }
      if (isCurrentUserRequest()) {
        setUserLoadingMoreTopics(false);
        userLoadingMoreTopicCursorRef.current = null;
      }
      finishAbortableRequest(userAbortRef, controller);
    }
  }, [
    handleUserSourceError,
    notify,
    sourceGateway,
    userBusy,
    userLoadingMoreTopics,
    userProfile
  ]);

  loadMoreUserTopicsRef.current = loadMoreUserTopics;

  const loadMoreUserReplies = useCallback(async (
    suppressLinuxDoVerification = false
  ): Promise<LinuxDoReadResumeOutcome> => {
    const current = userProfile;
    const trace = beginDiagnosticTrace('user', 'load-more-replies', diagnosticUserFields(current, current?.nextRepliesCursor));
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (!traceFinished) {
        traceFinished = true;
        finishDiagnosticTrace(trace, outcome, fields);
      }
    };
    if (!current?.hasMoreReplies || !current.nextRepliesCursor || userBusy || userLoadingMoreReplies || userLoadingMoreReplyCursorRef.current === current.nextRepliesCursor) {
      const busy = Boolean(userBusy || userLoadingMoreReplies || (current?.nextRepliesCursor && userLoadingMoreReplyCursorRef.current === current.nextRepliesCursor));
      markDiagnosticStage(trace, 'guard', {
        ...(current ? { source: current.source } : {}),
        state: !current ? 'missing-user' : busy ? 'busy' : current.hasMoreReplies ? 'missing-cursor' : 'complete'
      });
      finishTrace(busy ? 'blocked' : current?.hasMoreReplies ? 'blocked' : current ? 'noop' : 'blocked', {
        ...(current ? { source: current.source } : {}),
        ...(busy ? { reason: 'busy' } : current?.hasMoreReplies ? { reason: 'not_ready' } : current ? {} : { reason: 'not_ready' })
      });
      return 'completed';
    }
    markDiagnosticStage(trace, 'guard', { source: current.source, state: 'load-more', hasCursor: true });
    const requestId = ++userRequestIdRef.current;
    const requestOwner = startOwnedRequest(userRequestOwnerRef, `user:${current.source}:${current.id || current.username}:more-replies:${current.nextRepliesCursor}`);
    const isCurrentUserRequest = () => isCurrentOwnedRequest(requestOwner, userRequestOwnerRef) && requestId === userRequestIdRef.current;
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: requestOwner.key,
      isCurrent: isCurrentUserRequest,
      resume: async () => {
        if (!isCurrentUserRequest()) {
          return 'stale';
        }
        return await loadMoreUserRepliesRef.current?.(true) ?? 'stale';
      }
    };
    const controller = startAbortableRequest(userAbortRef);
    userLoadingMoreReplyCursorRef.current = current.nextRepliesCursor;
    setUserLoadingMoreReplies(true);
    setUserError(null);
    try {
      const nextProfile = await sourceGateway.getUserProfile({
        source: current.source,
        id: current.id,
        username: current.username,
        cursor: current.nextRepliesCursor,
        cursorType: 'replies',
        signal: controller.signal
      }, { isCurrent: isCurrentUserRequest, trace });
      if (!isCurrentUserRequest()) {
        finishTrace(controller.signal.aborted ? 'canceled' : 'stale', {
          source: current.source,
          reason: controller.signal.aborted ? 'canceled' : 'superseded'
        });
        return 'stale';
      }
      const expectedAfterCount = mergeUserReplies(current.replies || [], nextProfile.replies || []).length;
      markDiagnosticStage(trace, 'apply', {
        source: current.source,
        beforeCount: current.replies?.length || 0,
        afterCount: expectedAfterCount,
        itemCount: nextProfile.replies?.length || 0,
        hasMore: Boolean(nextProfile.hasMoreReplies)
      });
      setUserProfile((previous) => {
        if (!previous || previous.source !== current.source || previous.id !== current.id) {
          return previous;
        }
        const mergedReplies = mergeUserReplies(previous.replies || [], nextProfile.replies || []);
        userVisitedReplyCursorsRef.current.add(current.nextRepliesCursor || '');
        const canLoadNext = Boolean(nextProfile.hasMoreReplies && nextProfile.nextRepliesCursor && !userVisitedReplyCursorsRef.current.has(nextProfile.nextRepliesCursor));
        return {
          ...previous,
          replies: mergedReplies,
          hasMoreReplies: canLoadNext,
          nextRepliesCursor: canLoadNext ? nextProfile.nextRepliesCursor : null
        };
      });
      notify('用户回复已加载更多');
      finishTrace('success', {
        source: current.source,
        beforeCount: current.replies?.length || 0,
        afterCount: expectedAfterCount,
        hasMore: Boolean(nextProfile.hasMoreReplies)
      });
      return 'completed';
    } catch (error) {
      if (isCanceledRequest(error)) {
        finishTrace(isCurrentUserRequest() ? 'canceled' : 'stale', {
          source: current.source,
          reason: isCurrentUserRequest() ? 'canceled' : 'superseded'
        });
        return 'stale';
      } else if (!isCurrentUserRequest()) {
        finishTrace('stale', { source: current.source, reason: 'superseded' });
        return 'stale';
      } else {
        const sourceError = sourceErrorFromUnknown(current.source, error);
        const reason = diagnosticReasonForUserError(sourceError);
        finishTrace(
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
          { source: current.source, reason }
        );
        return await handleUserSourceError({
          error,
          recovery: current.source === 'linuxdo' ? linuxDoRecovery : undefined,
          source: current.source,
          suppressLinuxDoVerification
        });
      }
    } finally {
      if (!traceFinished) {
        finishTrace(isCurrentUserRequest() ? 'failure' : controller.signal.aborted ? 'canceled' : 'stale', {
          source: current.source,
          reason: isCurrentUserRequest() ? 'unknown' : controller.signal.aborted ? 'canceled' : 'superseded'
        });
      }
      if (isCurrentUserRequest()) {
        setUserLoadingMoreReplies(false);
        userLoadingMoreReplyCursorRef.current = null;
      }
      finishAbortableRequest(userAbortRef, controller);
    }
  }, [
    handleUserSourceError,
    notify,
    sourceGateway,
    userBusy,
    userLoadingMoreReplies,
    userProfile
  ]);

  loadMoreUserRepliesRef.current = loadMoreUserReplies;

  return {
    currentUserFollowed,
    followedUserRecords,
    loadMoreUserReplies,
    loadMoreUserTopics,
    openUser,
    selectedUser,
    userBusy,
    userError,
    userLoadingMoreReplies,
    userLoadingMoreTopics,
    userProfile
  };
}
