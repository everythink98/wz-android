import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUserProfile } from '../forumApi';
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
import type { Fetcher } from '../request';
import type { FeedSource, Source, UserProfile } from '../types';
import type { Screen } from '../appTypes';

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
  showLinuxDoVerification,
  showNodeSeekVerification,
  showYaohuoLogin
}: {
  clearYaohuoLoginState: () => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onOpenUserScreen: () => void;
  readerData: ReaderData;
  screen: Screen;
  showLinuxDoVerification: (message?: string) => void;
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
}) {
  const userRequestIdRef = useRef(0);
  const userAbortRef = useRef<AbortController | null>(null);
  const userLoadingMoreCursorRef = useRef<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userLoadingMore, setUserLoadingMore] = useState(false);
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
    setUserLoadingMore(false);
    userLoadingMoreCursorRef.current = null;
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
    setSelectedUser(requestUser);
    setUserProfile(null);
    setUserError('');
    setUserBusy(true);
    setUserLoadingMore(false);
    userLoadingMoreCursorRef.current = null;
    const controller = startAbortableRequest(userAbortRef);
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(requestUser.source),
        loadNodeSeekCookieForSource(requestUser.source)
      ]);
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      if (requestUser.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        setUserError('请先登录妖火后再查看用户主页');
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
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      setUserProfile(profile);
      if (nocache) {
        notify('用户主页已更新');
      }
    } catch (error) {
      if (requestId === userRequestIdRef.current) {
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
            await clearYaohuoLoginState();
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
      if (requestId === userRequestIdRef.current) {
        setUserBusy(false);
        setUserLoadingMore(false);
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
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
  ]);

  const loadMoreUserTopics = useCallback(async () => {
    const current = userProfile;
    if (!current?.hasMoreTopics || !current.nextTopicsCursor || userBusy || userLoadingMore || userLoadingMoreCursorRef.current === current.nextTopicsCursor) {
      return;
    }
    const requestId = ++userRequestIdRef.current;
    const controller = startAbortableRequest(userAbortRef);
    userLoadingMoreCursorRef.current = current.nextTopicsCursor;
    setUserLoadingMore(true);
    setUserError('');
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(current.source),
        loadNodeSeekCookieForSource(current.source)
      ]);
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      if (current.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        setUserError('请先登录妖火后再查看用户主页');
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
        signal: controller.signal
      });
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      setUserProfile((previous) => {
        if (!previous || previous.source !== current.source || previous.id !== current.id) {
          return previous;
        }
        const mergedTopics = mergeTopics(previous.topics, nextProfile.topics);
        return {
          ...previous,
          topics: mergedTopics,
          hasMoreTopics: Boolean(nextProfile.hasMoreTopics && nextProfile.nextTopicsCursor && mergedTopics.length > previous.topics.length),
          nextTopicsCursor: mergedTopics.length > previous.topics.length ? nextProfile.nextTopicsCursor : null
        };
      });
      notify('用户帖子已加载更多');
    } catch (error) {
      if (requestId === userRequestIdRef.current && !isCanceledRequest(error)) {
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
            await clearYaohuoLoginState();
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(message);
          }
          return;
        }
        notify(message);
      }
    } finally {
      if (requestId === userRequestIdRef.current) {
        setUserLoadingMore(false);
        userLoadingMoreCursorRef.current = null;
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
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin,
    userBusy,
    userLoadingMore,
    userProfile
  ]);

  return {
    currentUserFollowed,
    followedUserRecords,
    loadMoreUserTopics,
    openUser,
    selectedUser,
    userBusy,
    userError,
    userLoadingMore,
    userProfile
  };
}
