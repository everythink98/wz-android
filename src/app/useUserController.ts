import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUserProfile } from '../sources/sourceGateway';
import { mergeTopics } from '../feedLogic';
import {
  isUserFollowed,
  type FollowedUserRecord,
  type ReaderData
} from '../readerData';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  isLinuxDoCloudflareError,
  isNodeSeekCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  startAbortableRequest
} from '../appUtils';
import { nodeSeekUserIdFromValue } from '../userNavigation';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import type { Fetcher } from '../request';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import { authHintForSource } from '../siteSessionPrompts';
import type { SiteSessionViewModels } from '../siteSessionState';
import type { FeedSource, Source, UserProfile, UserReplyActivity } from '../types';
import type { Screen } from '../appTypes';

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

export function useUserController({
  clearYaohuoLoginState,
  fetcher,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  nodeSeekUserAgentRef,
  notify,
  onOpenUserScreen,
  readerData,
  screen,
  sessionViewModels,
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin
}: {
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onOpenUserScreen: () => void;
  readerData: ReaderData;
  screen: Screen;
  sessionViewModels: SiteSessionViewModels;
  showLinuxDoVerification: (message?: string) => void;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
}) {
  const userRequestIdRef = useRef(0);
  const userRequestOwnerRef = useRef(createRequestOwner('user'));
  const userAbortRef = useRef<AbortController | null>(null);
  const userLoadingMoreTopicCursorRef = useRef<string | null>(null);
  const userLoadingMoreReplyCursorRef = useRef<string | null>(null);
  const userVisitedTopicCursorsRef = useRef<Set<string>>(new Set());
  const userVisitedReplyCursorsRef = useRef<Set<string>>(new Set());
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userLoadingMoreTopics, setUserLoadingMoreTopics] = useState(false);
  const [userLoadingMoreReplies, setUserLoadingMoreReplies] = useState(false);
  const [userError, setUserError] = useState('');

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

  const openUser = useCallback(async (user: UserProfile, nocache = false) => {
    if (!user.id && !user.username) {
      notify('用户信息不完整');
      return;
    }
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
    setSelectedUser(requestUser);
    setUserProfile(null);
    setUserError('');
    setUserBusy(true);
    setUserLoadingMoreTopics(false);
    setUserLoadingMoreReplies(false);
    userLoadingMoreTopicCursorRef.current = null;
    userLoadingMoreReplyCursorRef.current = null;
    userVisitedTopicCursorsRef.current = new Set();
    userVisitedReplyCursorsRef.current = new Set();
    const controller = startAbortableRequest(userAbortRef);
    let yaohuoGeneration: number | undefined;
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(requestUser.source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } }),
        loadNodeSeekCookieForSource(requestUser.source)
      ]);
      if (!isCurrentUserRequest()) {
        return;
      }
      if (requestUser.source === 'yaohuo' && !yaohuoCookie) {
        const message = authHintForSource('yaohuo', sessionViewModels, 'read') || '妖火需要登录后使用此功能。';
        showYaohuoLogin(message);
        setUserError(message);
        return;
      }
      const profile = await getUserProfile({
        source: requestUser.source,
        id: requestUser.id,
        username: requestUser.username,
        fetcher,
        nodeSeekCookie,
        nodeSeekUserAgent: nodeSeekUserAgentRef.current,
        yaohuoCookie,
        signal: controller.signal
      });
      if (!isCurrentUserRequest()) {
        return;
      }
      setUserProfile(profile);
      if (nocache) {
        notify('用户主页已更新');
      }
    } catch (error) {
      if (isCurrentUserRequest()) {
        const message = errorMessage(error);
        setUserError(message);
        if (isLinuxDoCloudflareError(error)) {
          showLinuxDoVerification(message);
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(message);
          return;
        }
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(message);
          }
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(message);
        }
      }
    } finally {
      if (isCurrentUserRequest()) {
        setUserBusy(false);
        setUserLoadingMoreTopics(false);
        setUserLoadingMoreReplies(false);
      }
      finishAbortableRequest(userAbortRef, controller);
    }
  }, [
    clearYaohuoLoginState,
    fetcher,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    onOpenUserScreen,
    sessionViewModels,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
  ]);

  const loadMoreUserTopics = useCallback(async () => {
    const current = userProfile;
    if (!current?.hasMoreTopics || !current.nextTopicsCursor || userBusy || userLoadingMoreTopics || userLoadingMoreTopicCursorRef.current === current.nextTopicsCursor) {
      return;
    }
    const requestId = ++userRequestIdRef.current;
    const requestOwner = startOwnedRequest(userRequestOwnerRef, `user:${current.source}:${current.id || current.username}:more:${current.nextTopicsCursor}`);
    const isCurrentUserRequest = () => isCurrentOwnedRequest(requestOwner, userRequestOwnerRef) && requestId === userRequestIdRef.current;
    const controller = startAbortableRequest(userAbortRef);
    userLoadingMoreTopicCursorRef.current = current.nextTopicsCursor;
    setUserLoadingMoreTopics(true);
    setUserError('');
    let yaohuoGeneration: number | undefined;
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(current.source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } }),
        loadNodeSeekCookieForSource(current.source)
      ]);
      if (!isCurrentUserRequest()) {
        return;
      }
      if (current.source === 'yaohuo' && !yaohuoCookie) {
        const message = authHintForSource('yaohuo', sessionViewModels, 'read') || '妖火需要登录后使用此功能。';
        showYaohuoLogin(message);
        setUserError(message);
        return;
      }
      const nextProfile = await getUserProfile({
        source: current.source,
        id: current.id,
        username: current.username,
        fetcher,
        nodeSeekCookie,
        nodeSeekUserAgent: nodeSeekUserAgentRef.current,
        yaohuoCookie,
        cursor: current.nextTopicsCursor,
        cursorType: 'topics',
        signal: controller.signal
      });
      if (!isCurrentUserRequest()) {
        return;
      }
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
    } catch (error) {
      if (isCurrentUserRequest() && !isCanceledRequest(error)) {
        const message = errorMessage(error);
        setUserError(message);
        if (isLinuxDoCloudflareError(error)) {
          showLinuxDoVerification(message);
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(message);
          return;
        }
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(message);
          }
          return;
        }
        notify(message);
      }
    } finally {
      if (isCurrentUserRequest()) {
        setUserLoadingMoreTopics(false);
        userLoadingMoreTopicCursorRef.current = null;
      }
      finishAbortableRequest(userAbortRef, controller);
    }
  }, [
    clearYaohuoLoginState,
    fetcher,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    sessionViewModels,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin,
    userBusy,
    userLoadingMoreTopics,
    userProfile
  ]);

  const loadMoreUserReplies = useCallback(async () => {
    const current = userProfile;
    if (!current?.hasMoreReplies || !current.nextRepliesCursor || userBusy || userLoadingMoreReplies || userLoadingMoreReplyCursorRef.current === current.nextRepliesCursor) {
      return;
    }
    const requestId = ++userRequestIdRef.current;
    const requestOwner = startOwnedRequest(userRequestOwnerRef, `user:${current.source}:${current.id || current.username}:more-replies:${current.nextRepliesCursor}`);
    const isCurrentUserRequest = () => isCurrentOwnedRequest(requestOwner, userRequestOwnerRef) && requestId === userRequestIdRef.current;
    const controller = startAbortableRequest(userAbortRef);
    userLoadingMoreReplyCursorRef.current = current.nextRepliesCursor;
    setUserLoadingMoreReplies(true);
    setUserError('');
    let yaohuoGeneration: number | undefined;
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(current.source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } }),
        loadNodeSeekCookieForSource(current.source)
      ]);
      if (!isCurrentUserRequest()) {
        return;
      }
      if (current.source === 'yaohuo' && !yaohuoCookie) {
        const message = authHintForSource('yaohuo', sessionViewModels, 'read') || '妖火需要登录后使用此功能。';
        showYaohuoLogin(message);
        setUserError(message);
        return;
      }
      const nextProfile = await getUserProfile({
        source: current.source,
        id: current.id,
        username: current.username,
        fetcher,
        nodeSeekCookie,
        nodeSeekUserAgent: nodeSeekUserAgentRef.current,
        yaohuoCookie,
        cursor: current.nextRepliesCursor,
        cursorType: 'replies',
        signal: controller.signal
      });
      if (!isCurrentUserRequest()) {
        return;
      }
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
    } catch (error) {
      if (isCurrentUserRequest() && !isCanceledRequest(error)) {
        const message = errorMessage(error);
        setUserError(message);
        if (isLinuxDoCloudflareError(error)) {
          showLinuxDoVerification(message);
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(message);
          return;
        }
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(message);
          }
          return;
        }
        notify(message);
      }
    } finally {
      if (isCurrentUserRequest()) {
        setUserLoadingMoreReplies(false);
        userLoadingMoreReplyCursorRef.current = null;
      }
      finishAbortableRequest(userAbortRef, controller);
    }
  }, [
    clearYaohuoLoginState,
    fetcher,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    sessionViewModels,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin,
    userBusy,
    userLoadingMoreReplies,
    userProfile
  ]);

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
