import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  buildNodeSeekAttendanceRequest,
  buildNodeSeekCollectionRequest,
  buildNodeSeekInteractionRequest,
  buildNodeSeekReplyRequest,
  buildNodeSeekVoteRequest,
  nodeSeekInteractionRemovalMessage,
  type NodeSeekActionRequest
} from '../nodeseekActions';
import {
  buildYaohuoFavoriteRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid,
  type YaohuoActionRequest
} from '../yaohuoActions';
import {
  buildLinuxDoBookmarkRequest,
  buildLinuxDoLikeRequest,
  buildLinuxDoPollVoteRequest,
  buildLinuxDoReplyRequest,
  type LinuxDoActionRequest
} from '../linuxdoActions';
import { runLinuxDoAction, runNodeSeekAction, runYaohuoAction } from '../sources/sourceGateway';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyNodeSeekCollectionToTopic,
  applyPollVoteToReplies,
  applyPollVoteToTopic,
  beginOptimisticAction,
  completeOptimisticAction,
  linuxDoBookmarkIdFromActionResult,
  topicActionStateKey,
  type InteractionType,
  type OptimisticActionState
} from '../topicActionState';
import type { Reply, Topic, TopicDetail, TopicPoll } from '../types';
import { topicKey } from '../readerData';
import { linuxDoAccessSummary, loadLinuxDoAccess } from '../linuxdoCookieBridge';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest, type RequestOwner } from '../requestOwnership';
import { errorMessage, finishAbortableRequest, isCanceledRequest, startAbortableRequest } from '../appUtils';
import { isSiteLoggedIn, type SiteSessionEvent, type SiteSessionStates } from '../siteSessionState';
import type { ReplyTarget } from '../appTypes';
import {
  beginOptimisticTopicAction,
  clearExpiredLinuxDoLogin,
  isNodeSeekLoginRequiredError,
  runOptimisticActionQueue as runOptimisticActionQueueHelper
} from './topicActionHelpers';
import {
  canSubmitReplyToTopic,
  canVotePollOnTopic,
  currentTopicActionTopic,
  isLinuxDoActionTopic,
  isNodeSeekActionTopic,
  isYaohuoActionTopic,
  YAOHUO_DEFAULT_CLASS_ID
} from './topicActionControllerHelpers';

const COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';

type Ref<T> = MutableRefObject<T>;
type ActionRunOptions = {
  refreshTopic?: boolean;
  key?: string;
  owner?: RequestOwner;
};
type OptimisticTopicActionOptions = {
  key: string;
  requestTopicKey: string;
  requestOwner: RequestOwner;
  currentActive: boolean;
  applyDisplayed: (desiredActive: boolean) => void;
  sendDesired: (desiredActive: boolean) => Promise<boolean>;
  successMessage: (active: boolean) => string;
};

export function useTopicActionsController({
  actionAbortRef,
  actionRequestIdRef,
  clearNodeSeekLoginCookiesOnly,
  clearYaohuoLoginState,
  linuxDoWebViewUserAgentRef,
  loadYaohuoCookieForSource,
  nodeSeekWebViewUserAgentRef,
  notify,
  openTopic,
  optimisticTopicActionsRef,
  refreshTopicReplies,
  replyContent,
  replyTarget,
  resetLinuxDoLevelState,
  selectedTopic,
  setActionBusy,
  setOptimisticTopicActions,
  setReplyComposerOpen,
  setReplyContent,
  setReplyTarget,
  setTopicDetail,
  setTopicReplies,
  showLinuxDoLogin,
  showYaohuoLogin,
  siteSessionStates,
  topicActionRequestOwnerRef,
  topicDetail,
  topicReplies,
  updateLinuxDoSession
}: {
  actionAbortRef: Ref<AbortController | null>;
  actionRequestIdRef: Ref<number>;
  clearNodeSeekLoginCookiesOnly: () => Promise<void>;
  clearYaohuoLoginState: () => Promise<void>;
  linuxDoWebViewUserAgentRef: Ref<string>;
  loadYaohuoCookieForSource: (source: 'yaohuo') => Promise<string | undefined>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  openTopic: (topic: Topic, nocache?: boolean) => Promise<void>;
  optimisticTopicActionsRef: Ref<Record<string, OptimisticActionState>>;
  refreshTopicReplies: (options?: { silent?: boolean; afterSubmit?: boolean }) => Promise<unknown>;
  replyContent: string;
  replyTarget: ReplyTarget | null;
  resetLinuxDoLevelState: () => void;
  selectedTopic: Topic | null;
  setActionBusy: Dispatch<SetStateAction<boolean>>;
  setOptimisticTopicActions: Dispatch<SetStateAction<Record<string, OptimisticActionState>>>;
  setReplyComposerOpen: Dispatch<SetStateAction<boolean>>;
  setReplyContent: Dispatch<SetStateAction<string>>;
  setReplyTarget: Dispatch<SetStateAction<ReplyTarget | null>>;
  setTopicDetail: Dispatch<SetStateAction<TopicDetail | null>>;
  setTopicReplies: Dispatch<SetStateAction<Reply[]>>;
  showLinuxDoLogin: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  siteSessionStates: SiteSessionStates;
  topicActionRequestOwnerRef: Ref<RequestOwner>;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
}) {
  const canUseNodeSeekActions = isSiteLoggedIn(siteSessionStates.nodeseek);
  const canUseYaohuoActions = isSiteLoggedIn(siteSessionStates.yaohuo);
  const canUseLinuxDoActions = isSiteLoggedIn(siteSessionStates.linuxdo);

  const startTopicActionRequest = useCallback((key: string) => (
    startOwnedRequest(topicActionRequestOwnerRef, `topic-action:${key}`)
  ), [topicActionRequestOwnerRef]);

  const isCurrentTopicActionRequest = useCallback((requestOwner: RequestOwner) => (
    isCurrentOwnedRequest(requestOwner, topicActionRequestOwnerRef)
  ), [topicActionRequestOwnerRef]);

  const runNodeSeekRequest = useCallback(async (
    requestFactory: () => NodeSeekActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    if (!canUseNodeSeekActions) {
      notify('请先在“更多”里登录并检测 NodeSeek Cookie。');
      return false;
    }
    const requestId = ++actionRequestIdRef.current;
    const requestOwner = options.owner || startTopicActionRequest(options.key || success);
    const controller = startAbortableRequest(actionAbortRef);
    setActionBusy(true);
    try {
      const cookieHeader = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
      await runNodeSeekAction({
        cookieHeader: cookieHeader || '',
        request: requestFactory(),
        signal: controller.signal,
        userAgent: nodeSeekWebViewUserAgentRef.current
      });
      if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      notify(success);
      if (options.refreshTopic === true && topicDetail?.source === 'nodeseek') {
        await openTopic(topicDetail, true);
      }
      return true;
    } catch (error) {
      if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        return false;
      }
      if (isNodeSeekLoginRequiredError(error)) {
        await clearNodeSeekLoginCookiesOnly();
        if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner)) {
          return false;
        }
      }
      notify(errorMessage(error));
      return false;
    } finally {
      if (finishAbortableRequest(actionAbortRef, controller)) {
        setActionBusy(false);
      }
    }
  }, [actionAbortRef, actionRequestIdRef, canUseNodeSeekActions, clearNodeSeekLoginCookiesOnly, isCurrentTopicActionRequest, nodeSeekWebViewUserAgentRef, notify, openTopic, setActionBusy, startTopicActionRequest, topicDetail]);

  const runYaohuoRequest = useCallback(async (
    requestFactory: (cookieHeader: string) => YaohuoActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    if (!canUseYaohuoActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      showYaohuoLogin();
      return false;
    }
    const cookieHeader = await loadYaohuoCookieForSource('yaohuo');
    if (!cookieHeader) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      showYaohuoLogin();
      return false;
    }
    const requestId = ++actionRequestIdRef.current;
    const requestOwner = options.owner || startTopicActionRequest(options.key || success);
    const controller = startAbortableRequest(actionAbortRef);
    setActionBusy(true);
    try {
      const result = await runYaohuoAction({
        cookieHeader,
        request: requestFactory(cookieHeader),
        signal: controller.signal
      });
      if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      const resultConfirmed = result.message !== '操作结果无法确认，请刷新原帖核对';
      notify(result.message === '操作已提交' ? success : result.message);
      if (options.refreshTopic === true && topicDetail?.source === 'yaohuo') {
        await openTopic(topicDetail, true);
      }
      return resultConfirmed ? result : false;
    } catch (error) {
      if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        return false;
      }
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        if ((error as { reason?: unknown }).reason === 'expired') {
          await clearYaohuoLoginState();
          if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner)) {
            return false;
          }
        }
        showYaohuoLogin(errorMessage(error));
        return false;
      }
      notify(errorMessage(error));
      return false;
    } finally {
      if (finishAbortableRequest(actionAbortRef, controller)) {
        setActionBusy(false);
      }
    }
  }, [actionAbortRef, actionRequestIdRef, canUseYaohuoActions, clearYaohuoLoginState, isCurrentTopicActionRequest, loadYaohuoCookieForSource, notify, openTopic, setActionBusy, showYaohuoLogin, startTopicActionRequest, topicDetail]);

  const runLinuxDoRequest = useCallback(async (
    requestFactory: () => LinuxDoActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    if (!canUseLinuxDoActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      updateLinuxDoSession({ type: 'login-expired', message: 'linux.do 登录后才能操作' });
      showLinuxDoLogin();
      return false;
    }
    const access = await loadLinuxDoAccess();
    if (!access?.cookieHeader || !linuxDoAccessSummary(access).loggedIn) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      updateLinuxDoSession({ type: 'login-expired', message: 'linux.do 登录后才能操作' });
      showLinuxDoLogin();
      return false;
    }
    const requestId = ++actionRequestIdRef.current;
    const requestOwner = options.owner || startTopicActionRequest(options.key || success);
    const controller = startAbortableRequest(actionAbortRef);
    setActionBusy(true);
    try {
      const result = await runLinuxDoAction({
        cookieHeader: access.cookieHeader,
        userAgent: access.userAgent || linuxDoWebViewUserAgentRef.current,
        request: requestFactory(),
        signal: controller.signal
      });
      if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      notify(success);
      if (options.refreshTopic === true && topicDetail?.source === 'linuxdo') {
        await openTopic(topicDetail, true);
      }
      return result ?? true;
    } catch (error) {
      if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        return false;
      }
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        await clearExpiredLinuxDoLogin({ error, resetLinuxDoLevelState, updateLinuxDoSession });
        if (requestId !== actionRequestIdRef.current || controller.signal.aborted || !isCurrentTopicActionRequest(requestOwner)) {
          return false;
        }
        showLinuxDoLogin(errorMessage(error));
        return false;
      }
      notify(errorMessage(error));
      return false;
    } finally {
      if (finishAbortableRequest(actionAbortRef, controller)) {
        setActionBusy(false);
      }
    }
  }, [actionAbortRef, actionRequestIdRef, canUseLinuxDoActions, isCurrentTopicActionRequest, linuxDoWebViewUserAgentRef, notify, openTopic, resetLinuxDoLevelState, setActionBusy, showLinuxDoLogin, startTopicActionRequest, topicDetail, updateLinuxDoSession]);

  const setOptimisticTopicActionState = useCallback((key: string, state?: OptimisticActionState) => {
    const next = { ...optimisticTopicActionsRef.current };
    if (!state || (!state.inFlight && state.displayed === state.confirmed && state.desired === state.confirmed)) {
      delete next[key];
    } else {
      next[key] = state;
    }
    optimisticTopicActionsRef.current = next;
    setOptimisticTopicActions(next);
  }, [optimisticTopicActionsRef, setOptimisticTopicActions]);

  const runNodeSeekActionForOptimisticUpdate = useCallback(async (
    requestFactory: () => NodeSeekActionRequest,
    options: ActionRunOptions = {}
  ) => {
    if (!canUseNodeSeekActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      notify('请先在“更多”里登录并检测 NodeSeek Cookie，已恢复原状态。');
      return false;
    }
    const requestOwner = options.owner || startTopicActionRequest(options.key || 'nodeseek-optimistic');
    try {
      const cookieHeader = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
      await runNodeSeekAction({
        cookieHeader: cookieHeader || '',
        request: requestFactory(),
        userAgent: nodeSeekWebViewUserAgentRef.current
      });
      if (!isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      return true;
    } catch (error) {
      if (!isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        return false;
      }
      if (isNodeSeekLoginRequiredError(error)) {
        await clearNodeSeekLoginCookiesOnly();
        if (!isCurrentTopicActionRequest(requestOwner)) {
          return false;
        }
      }
      notify(`${errorMessage(error)}，已恢复原状态。`);
      return false;
    }
  }, [canUseNodeSeekActions, clearNodeSeekLoginCookiesOnly, isCurrentTopicActionRequest, nodeSeekWebViewUserAgentRef, notify, startTopicActionRequest]);

  const runLinuxDoActionForOptimisticUpdate = useCallback(async (
    requestFactory: () => LinuxDoActionRequest,
    options: ActionRunOptions = {}
  ) => {
    const requestOwner = options.owner || startTopicActionRequest(options.key || 'linuxdo-optimistic');
    try {
      if (!canUseLinuxDoActions) {
        if (!isCurrentTopicActionRequest(requestOwner)) {
          return false;
        }
        updateLinuxDoSession({ type: 'login-expired', message: 'linux.do 登录后才能操作' });
        showLinuxDoLogin('linux.do 登录后才能操作，已恢复原状态。');
        return false;
      }
      const access = await loadLinuxDoAccess();
      if (!access?.cookieHeader || !linuxDoAccessSummary(access).loggedIn) {
        if (!isCurrentTopicActionRequest(requestOwner)) {
          return false;
        }
        updateLinuxDoSession({ type: 'login-expired', message: 'linux.do 登录后才能操作' });
        showLinuxDoLogin('linux.do 登录后才能操作，已恢复原状态。');
        return false;
      }
      const result = await runLinuxDoAction({
        cookieHeader: access.cookieHeader,
        userAgent: access.userAgent || linuxDoWebViewUserAgentRef.current,
        request: requestFactory()
      });
      if (!isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      return result ?? true;
    } catch (error) {
      if (!isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        return false;
      }
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        await clearExpiredLinuxDoLogin({ error, resetLinuxDoLevelState, updateLinuxDoSession });
        if (!isCurrentTopicActionRequest(requestOwner)) {
          return false;
        }
        showLinuxDoLogin(`${errorMessage(error)}，已恢复原状态。`);
        return false;
      }
      notify(`${errorMessage(error)}，已恢复原状态。`);
      return false;
    }
  }, [canUseLinuxDoActions, isCurrentTopicActionRequest, linuxDoWebViewUserAgentRef, notify, resetLinuxDoLevelState, showLinuxDoLogin, startTopicActionRequest, updateLinuxDoSession]);

  const runOptimisticActionQueue = useCallback(async ({
    key,
    requestOwner,
    applyDisplayed,
    sendDesired,
    successMessage
  }: Omit<OptimisticTopicActionOptions, 'currentActive' | 'requestTopicKey'>) => {
    await runOptimisticActionQueueHelper({
      key,
      requestOwner,
      applyDisplayed,
      sendDesired,
      successMessage,
      isCurrentRequest: isCurrentTopicActionRequest,
      notify,
      optimisticActions: optimisticTopicActionsRef,
      setOptimisticActionState: setOptimisticTopicActionState
    });
  }, [isCurrentTopicActionRequest, notify, optimisticTopicActionsRef, setOptimisticTopicActionState]);

  const startOptimisticTopicAction = useCallback(({
    key,
    requestTopicKey,
    requestOwner,
    currentActive,
    applyDisplayed,
    sendDesired,
    successMessage
  }: OptimisticTopicActionOptions) => {
    beginOptimisticTopicAction({
      key,
      currentActive,
      requestOwner,
      applyDisplayed,
      isCurrentRequest: isCurrentTopicActionRequest,
      optimisticActions: optimisticTopicActionsRef,
      setOptimisticActionState: setOptimisticTopicActionState,
      startQueue: () => {
        void runOptimisticActionQueue({
          key,
          requestOwner,
          applyDisplayed,
          sendDesired,
          successMessage
        });
      }
    });
  }, [isCurrentTopicActionRequest, optimisticTopicActionsRef, runOptimisticActionQueue, setOptimisticTopicActionState]);

  const submitReply = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!canSubmitReplyToTopic(detail)) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    if (!replyContent.trim()) {
      notify('请输入回复内容');
      return;
    }
    const requestOwner = startTopicActionRequest(requestTopicKey);
    if (isYaohuoActionTopic(detail)) {
      if (replyTarget && !replyTarget.authorId) {
        notify('当前楼层缺少用户 id，刷新主题后再试。');
        return;
      }
      const submitted = await runYaohuoRequest(
        (cookieHeader) => buildYaohuoReplyRequest({
          topicId: detail.id,
          classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID,
          content: replyContent,
          sid: extractYaohuoSid(cookieHeader),
          replyFloor: replyTarget?.floor,
          toUserId: replyTarget?.authorId
        }),
        '回复已提交',
        { refreshTopic: false, owner: requestOwner }
      );
      if (submitted) {
        if (!isCurrentTopicActionRequest(requestOwner)) {
          return;
        }
        setReplyContent('');
        setReplyComposerOpen(false);
        setReplyTarget(null);
        await refreshTopicReplies({ silent: true, afterSubmit: true });
      }
      return;
    }
    if (isLinuxDoActionTopic(detail)) {
      const submitted = await runLinuxDoRequest(
        () => buildLinuxDoReplyRequest({
          topicId: detail.id,
          content: replyContent,
          replyToPostNumber: replyTarget?.floor
        }),
        '回复已提交',
        { refreshTopic: false, owner: requestOwner }
      );
      if (submitted) {
        if (!isCurrentTopicActionRequest(requestOwner)) {
          return;
        }
        setReplyContent('');
        setReplyComposerOpen(false);
        setReplyTarget(null);
        await refreshTopicReplies({ silent: true, afterSubmit: true });
      }
      return;
    }
    const submitted = await runNodeSeekRequest(
      () => buildNodeSeekReplyRequest({ postId: detail.id, content: replyContent, replyTarget }),
      '回复已提交',
      { refreshTopic: false, owner: requestOwner }
    );
    if (submitted) {
      if (!isCurrentTopicActionRequest(requestOwner)) {
        return;
      }
      setReplyContent('');
      setReplyComposerOpen(false);
      setReplyTarget(null);
      await refreshTopicReplies({ silent: true, afterSubmit: true });
    }
  }, [isCurrentTopicActionRequest, notify, refreshTopicReplies, replyContent, replyTarget, runLinuxDoRequest, runNodeSeekRequest, runYaohuoRequest, selectedTopic, setReplyComposerOpen, setReplyContent, setReplyTarget, startTopicActionRequest, topicDetail]);

  const checkIn = useCallback(async () => {
    await runNodeSeekRequest(
      () => buildNodeSeekAttendanceRequest({ random: false }),
      '签到请求已提交',
      { refreshTopic: false }
    );
  }, [runNodeSeekRequest]);

  const interact = useCallback(async (type: InteractionType, commentId?: number) => {
    if (!commentId) {
      notify('当前内容缺少评论 id，刷新主题后再试。');
      return;
    }
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const requestOwner = startTopicActionRequest(requestTopicKey);
    if (isLinuxDoActionTopic(detail)) {
      if (type !== 'like') {
        return;
      }
      const target = [
        topicDetail,
        ...topicReplies
      ].find((item) => (item as { commentId?: number } | null)?.commentId === commentId) as ({ liked?: boolean } | undefined);
      startOptimisticTopicAction({
        key: topicActionStateKey({ topicKey: requestTopicKey, targetId: commentId, action: 'like' }),
        requestTopicKey,
        requestOwner,
        currentActive: Boolean(target?.liked),
        applyDisplayed: (desiredActive) => {
          const patch = { commentId, type: 'like' as const, mode: desiredActive ? 'add' as const : 'remove' as const, reactionId: 'heart' };
          setTopicDetail((current) => applyInteractionToTopic(current, patch));
          setTopicReplies((current) => applyInteractionToReplies(current, patch));
        },
        sendDesired: async (desiredActive) => Boolean(await runLinuxDoActionForOptimisticUpdate(
          () => buildLinuxDoLikeRequest({ postId: commentId, liked: !desiredActive }),
          { owner: requestOwner }
        )),
        successMessage: (active) => active ? '点赞已提交' : '已取消点赞'
      });
      return;
    }
    if (!isNodeSeekActionTopic(detail)) {
      return;
    }
    const activeFields: Record<InteractionType, 'upvoted' | 'liked' | 'disliked'> = {
      upvote: 'upvoted',
      like: 'liked',
      dislike: 'disliked'
    };
    const target = [
      topicDetail,
      ...topicReplies
    ].find((item) => (item as { commentId?: number } | null)?.commentId === commentId) as (Pick<TopicDetail | Reply, 'upvoted' | 'liked' | 'disliked'> | undefined);
    const activeField = activeFields[type];
    if (target?.[activeField]) {
      notify(nodeSeekInteractionRemovalMessage(type));
      return;
    }
    startOptimisticTopicAction({
      key: topicActionStateKey({ topicKey: requestTopicKey, targetId: commentId, action: type }),
      requestTopicKey,
      requestOwner,
      currentActive: Boolean(target?.[activeField]),
      applyDisplayed: (desiredActive) => {
        const patch = { commentId, type, mode: desiredActive ? 'add' as const : 'remove' as const };
        setTopicDetail((current) => applyInteractionToTopic(current, patch));
        setTopicReplies((current) => applyInteractionToReplies(current, patch));
      },
      sendDesired: (desiredActive) => runNodeSeekActionForOptimisticUpdate(
        () => buildNodeSeekInteractionRequest({ type, commentId, active: !desiredActive }),
        { owner: requestOwner }
      ),
      successMessage: (active) => active
        ? type === 'upvote' ? '点赞已提交' : type === 'like' ? '加鸡腿请求已提交' : '反对已提交'
        : type === 'upvote' ? '已取消点赞' : type === 'like' ? '已取消鸡腿' : '已取消反对'
    });
  }, [notify, runLinuxDoActionForOptimisticUpdate, runNodeSeekActionForOptimisticUpdate, selectedTopic, setTopicDetail, setTopicReplies, startOptimisticTopicAction, startTopicActionRequest, topicDetail, topicReplies]);

  const favoriteOnYaohuoSite = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isYaohuoActionTopic(detail)) {
      return;
    }
    await runYaohuoRequest(
      () => buildYaohuoFavoriteRequest({
        topicId: detail.id,
        classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID
      }),
      '原站收藏已提交',
      { refreshTopic: false, owner: startTopicActionRequest(topicKey(detail)) }
    );
  }, [runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

  const collectOnNodeSeekSite = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isNodeSeekActionTopic(detail)) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const requestOwner = startTopicActionRequest(requestTopicKey);
    const collected = Boolean((detail as TopicDetail).collected);
    startOptimisticTopicAction({
      key: topicActionStateKey({ topicKey: requestTopicKey, targetId: detail.id, action: 'collection' }),
      requestTopicKey,
      requestOwner,
      currentActive: collected,
      applyDisplayed: (desiredActive) => {
        setTopicDetail((current) => applyNodeSeekCollectionToTopic(current, { collected: desiredActive }));
      },
      sendDesired: (desiredActive) => runNodeSeekActionForOptimisticUpdate(
        () => buildNodeSeekCollectionRequest({
          postId: detail.id,
          collected: !desiredActive
        }),
        { owner: requestOwner }
      ),
      successMessage: (active) => active ? '原站收藏已提交' : '已取消原站收藏'
    });
  }, [runNodeSeekActionForOptimisticUpdate, selectedTopic, setTopicDetail, startOptimisticTopicAction, startTopicActionRequest, topicDetail]);

  const bookmarkOnLinuxDoSite = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isLinuxDoActionTopic(detail)) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const requestOwner = startTopicActionRequest(requestTopicKey);
    const bookmarked = Boolean((detail as TopicDetail).bookmarked);
    let bookmarkId = (detail as TopicDetail).bookmarkId;
    const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: detail.id, action: 'bookmark' });
    startOptimisticTopicAction({
      key: actionKey,
      requestTopicKey,
      requestOwner,
      currentActive: bookmarked,
      applyDisplayed: (desiredActive) => {
        setTopicDetail((current) => applyBookmarkToTopic(current, {
          bookmarked: desiredActive,
          bookmarkId: desiredActive ? bookmarkId : undefined
        }));
      },
      sendDesired: async (desiredActive) => {
        const result = await runLinuxDoActionForOptimisticUpdate(
          () => buildLinuxDoBookmarkRequest({
            bookmarkableId: detail.id,
            bookmarkableType: 'Topic',
            bookmarked: !desiredActive,
            bookmarkId
          }),
          { owner: requestOwner }
        );
        if (!result) {
          return false;
        }
        if (!desiredActive) {
          bookmarkId = undefined;
          if (isCurrentTopicActionRequest(requestOwner) && optimisticTopicActionsRef.current[actionKey]?.desired === true) {
            setTopicDetail((current) => applyBookmarkToTopic(current, { bookmarked: true }));
          }
        }
        if (desiredActive) {
          const resultBookmarkId = linuxDoBookmarkIdFromActionResult(result);
          if (resultBookmarkId) {
            bookmarkId = resultBookmarkId;
            if (isCurrentTopicActionRequest(requestOwner) && optimisticTopicActionsRef.current[actionKey]?.desired === true) {
              setTopicDetail((current) => applyBookmarkToTopic(current, { bookmarked: true, bookmarkId }));
            }
          }
        }
        return true;
      },
      successMessage: (active) => active ? '原站收藏已提交' : '已取消原站收藏'
    });
  }, [isCurrentTopicActionRequest, optimisticTopicActionsRef, runLinuxDoActionForOptimisticUpdate, selectedTopic, setTopicDetail, startOptimisticTopicAction, startTopicActionRequest, topicDetail]);

  const votePoll = useCallback(async (poll: TopicPoll, optionIds: string[]) => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!canVotePollOnTopic(detail)) {
      return;
    }
    if (!optionIds.length) {
      notify('请选择投票选项');
      return;
    }
    const requestTopicKey = topicKey(detail);
    const requestOwner = startTopicActionRequest(requestTopicKey);
    let submitted: unknown = false;
    if (isNodeSeekActionTopic(detail)) {
      submitted = await runNodeSeekRequest(
        () => buildNodeSeekVoteRequest({ optionIds }),
        '投票已提交',
        { refreshTopic: false, owner: requestOwner }
      );
    } else if (isLinuxDoActionTopic(detail)) {
      if (!poll.postId || !poll.name) {
        notify('当前投票信息不完整，刷新主题后再试。');
        return;
      }
      submitted = await runLinuxDoRequest(
        () => buildLinuxDoPollVoteRequest({
          postId: poll.postId || '',
          pollName: poll.name || '',
          optionIds
        }),
        '投票已提交',
        { refreshTopic: false, owner: requestOwner }
      );
    } else {
      submitted = await runYaohuoRequest(
        () => buildYaohuoVoteRequest({
          topicId: detail.id,
          classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID,
          voteIds: optionIds
        }),
        '投票已提交',
        { refreshTopic: false, owner: requestOwner }
      );
    }
    if (submitted) {
      if (!isCurrentTopicActionRequest(requestOwner)) {
        return;
      }
      setTopicDetail((current) => applyPollVoteToTopic(current, {
        pollId: poll.id,
        pollName: poll.name,
        pollPostId: poll.postId,
        optionIds
      }));
      setTopicReplies((current) => applyPollVoteToReplies(current, {
        pollId: poll.id,
        pollName: poll.name,
        pollPostId: poll.postId,
        optionIds
      }));
    }
  }, [isCurrentTopicActionRequest, notify, runLinuxDoRequest, runNodeSeekRequest, runYaohuoRequest, selectedTopic, setTopicDetail, setTopicReplies, startTopicActionRequest, topicDetail]);

  return {
    bookmarkOnLinuxDoSite,
    canUseLinuxDoActions,
    canUseNodeSeekActions,
    canUseYaohuoActions,
    checkIn,
    collectOnNodeSeekSite,
    favoriteOnYaohuoSite,
    interact,
    submitReply,
    votePoll
  };
}

export function createTopicActionRequestOwner() {
  return createRequestOwner('topic-action');
}

export function invalidateTopicActionRequestOwner(ownerRef: Ref<RequestOwner>, nextTopicKey: string | null) {
  return startOwnedRequest(ownerRef, `topic-action-context:${nextTopicKey || 'none'}`);
}
