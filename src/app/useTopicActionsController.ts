import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import {
  buildNodeSeekAttendanceRequest,
  buildNodeSeekCollectionRequest,
  buildNodeSeekEditReplyRequest,
  buildNodeSeekInteractionRequest,
  buildNodeSeekReplyRequest,
  buildNodeSeekVoteRequest,
  nodeSeekInteractionRemovalMessage,
  type NodeSeekActionRequest
} from '../nodeseekActions';
import {
  buildYaohuoFavoriteRequest,
  buildYaohuoDeleteReplyRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid,
  type YaohuoActionRequest
} from '../yaohuoActions';
import {
  buildLinuxDoBookmarkRequest,
  buildLinuxDoDeleteReplyRequest,
  buildLinuxDoEditReplyRequest,
  buildLinuxDoImageUploadRequest,
  buildLinuxDoLikeRequest,
  buildLinuxDoPollVoteRequest,
  buildLinuxDoReplyRequest,
  linuxDoImageUrlFromUploadResponse,
  type LinuxDoActionRequest
} from '../linuxdoActions';
import { runLinuxDoAction } from '../linuxdoActionClient';
import { runNodeSeekAction } from '../nodeseekActionClient';
import { runYaohuoAction } from '../yaohuoActionClient';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyNodeSeekCollectionToTopic,
  applyPollVoteToReplies,
  applyPollVoteToTopic,
  linuxDoBookmarkIdFromActionResult,
  topicActionStateKey,
  type InteractionType,
  type OptimisticActionState
} from '../topicActionState';
import type { Reply, Topic, TopicDetail, TopicPoll } from '../types';
import { topicKey } from '../readerData';
import { isSameReply, removeReply } from '../feedLogic';
import type { TopicRepliesRefreshOptions } from '../appTypes';
import { currentLinuxDoAccessGeneration, linuxDoAccessSummary, loadLinuxDoAccess } from '../linuxdoCookieBridge';
import {
  DEFAULT_NODESEEK_ANDROID_USER_AGENT,
  NODESEEK_ACCESS_STORAGE_KEY,
  NODESEEK_COOKIE_STORAGE_KEY,
  NODESEEK_USER_AGENT_STORAGE_KEY,
  nodeSeekAccessRecord,
  parseNodeSeekAccessRecord,
  type NodeSeekAccessRecord
} from '../nodeseekCookies';
import type { RequestOwner } from '../requestOwnership';
import {
  abortTopicActionRuns,
  clearBusyTopicActionRuns,
  currentTopicActionRequestOwner,
  finishBusyTopicActionRun,
  isCurrentTopicActionRequestOwner,
  finishTopicActionRun,
  isCurrentTopicActionRun,
  trackBusyTopicActionRun,
  startTopicActionRequestOwner,
  type TopicActionBusyRunSet,
  type TopicActionOwnerMap,
  type TopicActionRequestOwner,
  startTopicActionRun,
  type TopicActionRun,
  type TopicActionRunMap
} from '../topicActionRequestOwners';
import { errorMessage, isCanceledRequest } from '../appUtils';
import { canUseLinuxDoLike } from '../linuxdoPermissions';
import {
  appendReplyImageMarkup,
  normalizeReplyImageAsset,
  replyImageMarkupForSource,
  replyImageUploadSupported,
  type NormalizedReplyImageAsset,
  uploadNodeSeekReplyImageWithApiKey,
  uploadYaohuoReplyImage
} from '../replyImageUpload';
import { createSiteSessionViewModels, isSiteLoggedIn, type SiteSessionEvent, type SiteSessionStates } from '../siteSessionState';
import { authActionMessageForSource } from '../siteSessionPrompts';
import type { ReplyEditTarget, ReplyTarget } from '../appTypes';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import {
  beginOptimisticTopicAction,
  clearExpiredLinuxDoLogin,
  runSingleTopicAction,
  isNodeSeekLoginRequiredError,
  runOptimisticActionQueue as runOptimisticActionQueueHelper
} from './topicActionHelpers';
import {
  canSubmitReplyToTopic,
  canVotePollOnTopic,
  currentTopicActionTopic,
  isTopicScopedActionKey,
  isLinuxDoActionTopic,
  isNodeSeekActionTopic,
  isYaohuoActionTopic,
  nodeSeekAttendanceActionKey,
  topicEditReplyActionKey,
  topicPollVoteActionKey,
  topicReplyActionKey,
  yaohuoFavoriteActionKey,
  YAOHUO_DEFAULT_CLASS_ID
} from './topicActionControllerHelpers';

type Ref<T> = MutableRefObject<T>;
type ActionRunOptions = {
  busy?: boolean;
  fallbackKey?: string;
  key?: string;
  notifySuccess?: boolean;
  owner?: TopicActionRequestOwner;
  restoreOnFailure?: boolean;
};
type ActionRun = TopicActionRun & {
  cancelOnTopicChange: boolean;
};
type OptimisticTopicActionOptions = {
  key: string;
  requestOwner: TopicActionRequestOwner;
  currentActive: boolean;
  applyDisplayed: (desiredActive: boolean) => void;
  sendDesired: (desiredActive: boolean) => Promise<boolean>;
  successMessage: (active: boolean) => string;
};

function optimisticOwnerKey(requestOwner: TopicActionRequestOwner) {
  return [
    requestOwner.context.key,
    requestOwner.context.token,
    requestOwner.action.key,
    requestOwner.action.token
  ].join(':');
}
function actionMessage(message: string, restoreOnFailure?: boolean) {
  return restoreOnFailure ? `${message}，已恢复原状态。` : message;
}

function topicDeleteReplyActionKey(topicKeyValue: string, reply: Reply) {
  return `delete-reply:${topicKeyValue}:${reply.commentId ?? reply.deletePath ?? reply.floor ?? 'reply'}`;
}

async function loadNodeSeekActionAccess() {
  const savedAccess = parseNodeSeekAccessRecord(await SecureStore.getItemAsync(NODESEEK_ACCESS_STORAGE_KEY));
  if (savedAccess) {
    return savedAccess;
  }
  const [cookieHeader, userAgent] = await Promise.all([
    SecureStore.getItemAsync(NODESEEK_COOKIE_STORAGE_KEY),
    SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY)
  ]);
  return cookieHeader ? nodeSeekAccessRecord(cookieHeader, userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT) : null;
}

export function useTopicActionsController({
  actionAbortRef,
  clearNodeSeekLoginCookiesOnly,
  clearYaohuoLoginState,
  currentNodeSeekCredentialGeneration,
  linuxDoWebViewUserAgentRef,
  loadYaohuoCookieForSource,
  nodeSeekWebViewUserAgentRef,
  ensureNodeImageApiKey,
  notify,
  optimisticTopicActionsRef,
  refreshTopicReplies,
  replyContent,
  replyEditTarget,
  replyTarget,
  resetLinuxDoLevelState,
  selectedTopic,
  setActionBusy,
  setOptimisticTopicActions,
  setReplyComposerOpen,
  setReplyContent,
  setReplyEditTarget,
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
  actionAbortRef: Ref<{ abort: () => void; abortAll: () => void } | null>;
  clearNodeSeekLoginCookiesOnly: (options?: CredentialClearOptions) => Promise<void>;
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  currentNodeSeekCredentialGeneration: () => number;
  linuxDoWebViewUserAgentRef: Ref<string>;
  loadYaohuoCookieForSource: (source: 'yaohuo', options?: CredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  ensureNodeImageApiKey: (options?: { forceRefresh?: boolean; clearOnCancel?: boolean }) => Promise<string | null>;
  notify: (message: string) => void;
  optimisticTopicActionsRef: Ref<Record<string, OptimisticActionState>>;
  refreshTopicReplies: (options?: TopicRepliesRefreshOptions) => Promise<unknown>;
  replyContent: string;
  replyEditTarget: ReplyEditTarget | null;
  replyTarget: ReplyTarget | null;
  resetLinuxDoLevelState: () => void;
  selectedTopic: Topic | null;
  setActionBusy: Dispatch<SetStateAction<boolean>>;
  setOptimisticTopicActions: Dispatch<SetStateAction<Record<string, OptimisticActionState>>>;
  setReplyComposerOpen: Dispatch<SetStateAction<boolean>>;
  setReplyContent: Dispatch<SetStateAction<string>>;
  setReplyEditTarget: Dispatch<SetStateAction<ReplyEditTarget | null>>;
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
  const siteSessionViewModels = useMemo(() => createSiteSessionViewModels(siteSessionStates), [siteSessionStates]);
  const topicActionOwnersRef = useRef<TopicActionOwnerMap>({});
  const topicActionRunsRef = useRef<TopicActionRunMap>({});
  const detachedActionRunsRef = useRef<TopicActionRunMap>({});
  const busyActionRunsRef = useRef<TopicActionBusyRunSet>(new Set());
  const pendingTopicActionsRef = useRef<Record<string, true>>({});

  const startTopicActionRequest = useCallback((key: string) => (
    startTopicActionRequestOwner(topicActionRequestOwnerRef, topicActionOwnersRef, key)
  ), [topicActionRequestOwnerRef]);

  const startOptimisticTopicActionRequest = useCallback((key: string) => (
    optimisticTopicActionsRef.current[key]?.inFlight
      ? currentTopicActionRequestOwner(topicActionRequestOwnerRef, topicActionOwnersRef, key)
      : startTopicActionRequest(key)
  ), [optimisticTopicActionsRef, startTopicActionRequest, topicActionRequestOwnerRef]);

  const isCurrentTopicActionRequest = useCallback((requestOwner: TopicActionRequestOwner) => (
    isCurrentTopicActionRequestOwner(requestOwner, topicActionRequestOwnerRef, topicActionOwnersRef)
  ), [topicActionRequestOwnerRef]);

  const startActionRun = useCallback((key: string, busy: boolean, cancelOnTopicChange = true): ActionRun => {
    const run = {
      ...startTopicActionRun(cancelOnTopicChange ? topicActionRunsRef : detachedActionRunsRef, key),
      cancelOnTopicChange
    };
    actionAbortRef.current = {
      abort: () => {
        for (const controller of abortTopicActionRuns(topicActionRunsRef)) {
          busyActionRunsRef.current.delete(controller);
        }
        setActionBusy(busyActionRunsRef.current.size > 0);
        if (!Object.keys(detachedActionRunsRef.current).length) {
          actionAbortRef.current = null;
        }
      },
      abortAll: () => {
        abortTopicActionRuns(topicActionRunsRef);
        abortTopicActionRuns(detachedActionRunsRef);
        clearBusyTopicActionRuns(busyActionRunsRef);
        setActionBusy(false);
        actionAbortRef.current = null;
      }
    };
    if (busy) {
      trackBusyTopicActionRun(busyActionRunsRef, run);
      setActionBusy(true);
    }
    return run;
  }, [actionAbortRef, setActionBusy]);

  const isCurrentActionRun = useCallback((run: ActionRun) => (
    isCurrentTopicActionRun(run, run.cancelOnTopicChange ? topicActionRunsRef : detachedActionRunsRef)
  ), []);

  const finishActionRun = useCallback((run: ActionRun, busy: boolean) => {
    finishTopicActionRun(run, run.cancelOnTopicChange ? topicActionRunsRef : detachedActionRunsRef);
    if (!Object.keys(topicActionRunsRef.current).length && !Object.keys(detachedActionRunsRef.current).length) {
      actionAbortRef.current = null;
    }
    if (busy) {
      setActionBusy(finishBusyTopicActionRun(busyActionRunsRef, run));
    }
  }, [actionAbortRef, setActionBusy]);

  const runSingleNonIdempotentTopicAction = useCallback(<T,>(key: string, task: () => Promise<T>) => (
    runSingleTopicAction({
      key,
      notifyDuplicate: () => notify('操作正在提交，请稍后。'),
      pendingActions: pendingTopicActionsRef,
      task
    })
  ), [notify]);

  const runNodeSeekRequest = useCallback(async (
    requestFactory: (access: NodeSeekAccessRecord | null) => NodeSeekActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    if (!canUseNodeSeekActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      notify(actionMessage(authActionMessageForSource('nodeseek', siteSessionViewModels), options.restoreOnFailure));
      return false;
    }
    const actionKey = options.key || options.owner?.action.key || success || options.fallbackKey || 'nodeseek-action';
    const topicScoped = isTopicScopedActionKey(actionKey);
    const requestOwner = options.owner || (topicScoped ? startTopicActionRequest(actionKey) : undefined);
    const busy = options.busy ?? true;
    const run = startActionRun(actionKey, busy, topicScoped);
    const nodeSeekGeneration = currentNodeSeekCredentialGeneration();
    try {
      const access = await loadNodeSeekActionAccess();
      if (!isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
        return false;
      }
      await runNodeSeekAction({
        cookieHeader: access?.cookieHeader || '',
        request: requestFactory(access),
        signal: run.controller.signal,
        userAgent: access?.userAgent || nodeSeekWebViewUserAgentRef.current
      });
      if (!isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
        return false;
      }
      if (options.notifySuccess !== false && success) {
        notify(success);
      }
      return true;
    } catch (error) {
      if (!isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner)) || isCanceledRequest(error)) {
        return false;
      }
      if (isNodeSeekLoginRequiredError(error)) {
        await clearNodeSeekLoginCookiesOnly({ generation: nodeSeekGeneration });
        if (!isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
          return false;
        }
      }
      notify(actionMessage(errorMessage(error), options.restoreOnFailure));
      return false;
    } finally {
      finishActionRun(run, busy);
    }
  }, [canUseNodeSeekActions, clearNodeSeekLoginCookiesOnly, currentNodeSeekCredentialGeneration, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, nodeSeekWebViewUserAgentRef, notify, siteSessionViewModels, startActionRun, startTopicActionRequest]);

  const runYaohuoRequest = useCallback(async (
    requestFactory: (cookieHeader: string) => YaohuoActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    if (!canUseYaohuoActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      showYaohuoLogin(authActionMessageForSource('yaohuo', siteSessionViewModels));
      return false;
    }
    const requestOwner = options.owner || startTopicActionRequest(options.key || success);
    const run = startActionRun(options.key || requestOwner.action.key || success, true);
    let yaohuoGeneration: number | undefined;
    try {
      const cookieHeader = await loadYaohuoCookieForSource('yaohuo', { captureGeneration: (generation) => { yaohuoGeneration = generation; } });
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      if (!cookieHeader) {
        showYaohuoLogin(authActionMessageForSource('yaohuo', siteSessionViewModels));
        return false;
      }
      const result = await runYaohuoAction({
        cookieHeader,
        request: requestFactory(cookieHeader),
        signal: run.controller.signal
      });
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      const resultConfirmed = result.message !== '操作结果无法确认，请刷新原帖核对';
      notify(result.message === '操作已提交' ? success : result.message);
      return resultConfirmed ? result : false;
    } catch (error) {
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        return false;
      }
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        if ((error as { reason?: unknown }).reason === 'expired') {
          await clearYaohuoLoginState({ generation: yaohuoGeneration });
          if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
            return false;
          }
        }
        showYaohuoLogin(errorMessage(error));
        return false;
      }
      notify(errorMessage(error));
      return false;
    } finally {
      finishActionRun(run, true);
    }
  }, [canUseYaohuoActions, clearYaohuoLoginState, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, loadYaohuoCookieForSource, notify, showYaohuoLogin, siteSessionViewModels, startActionRun, startTopicActionRequest]);

  const runLinuxDoRequest = useCallback(async (
    requestFactory: () => LinuxDoActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    if (!canUseLinuxDoActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        return false;
      }
      const message = authActionMessageForSource('linuxdo', siteSessionViewModels);
      showLinuxDoLogin(actionMessage(message, options.restoreOnFailure));
      return false;
    }
    const actionKey = options.key || options.owner?.action.key || success || options.fallbackKey || 'linuxdo-action';
    const requestOwner = options.owner || startTopicActionRequest(actionKey);
    const busy = options.busy ?? true;
    const run = startActionRun(actionKey, busy);
    let linuxDoGeneration: number | undefined;
    let linuxDoAccessCookieHeader: string | undefined;
    try {
      linuxDoGeneration = currentLinuxDoAccessGeneration();
      const access = await loadLinuxDoAccess();
      linuxDoAccessCookieHeader = access?.cookieHeader;
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      if (!access?.cookieHeader || !linuxDoAccessSummary(access).loggedIn) {
        const message = authActionMessageForSource('linuxdo', siteSessionViewModels);
        updateLinuxDoSession({ type: 'login-expired', message });
        showLinuxDoLogin(actionMessage(message, options.restoreOnFailure));
        return false;
      }
      const result = await runLinuxDoAction({
        cookieHeader: access.cookieHeader,
        userAgent: access.userAgent || linuxDoWebViewUserAgentRef.current,
        request: requestFactory(),
        signal: run.controller.signal
      });
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        return false;
      }
      if (options.notifySuccess !== false && success) {
        notify(success);
      }
      return result ?? true;
    } catch (error) {
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        return false;
      }
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        await clearExpiredLinuxDoLogin({ error, generation: linuxDoGeneration, cookieHeader: linuxDoAccessCookieHeader, resetLinuxDoLevelState, updateLinuxDoSession });
        if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
          return false;
        }
        showLinuxDoLogin(actionMessage(errorMessage(error), options.restoreOnFailure));
        return false;
      }
      notify(actionMessage(errorMessage(error), options.restoreOnFailure));
      return false;
    } finally {
      finishActionRun(run, busy);
    }
  }, [canUseLinuxDoActions, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, linuxDoWebViewUserAgentRef, notify, resetLinuxDoLevelState, showLinuxDoLogin, siteSessionViewModels, startActionRun, startTopicActionRequest, updateLinuxDoSession]);

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
  ) => runNodeSeekRequest(requestFactory, '', {
    ...options,
    busy: false,
    fallbackKey: 'nodeseek-optimistic',
    notifySuccess: false,
    restoreOnFailure: true
  }), [runNodeSeekRequest]);

  const runLinuxDoActionForOptimisticUpdate = useCallback(async (
    requestFactory: () => LinuxDoActionRequest,
    options: ActionRunOptions = {}
  ) => runLinuxDoRequest(requestFactory, '', {
    ...options,
    busy: false,
    fallbackKey: 'linuxdo-optimistic',
    notifySuccess: false,
    restoreOnFailure: true
  }), [runLinuxDoRequest]);

  const runOptimisticActionQueue = useCallback(async ({
    key,
    requestOwner,
    applyDisplayed,
    sendDesired,
    successMessage
  }: Omit<OptimisticTopicActionOptions, 'currentActive'>) => {
    await runOptimisticActionQueueHelper({
      key,
      requestOwner,
      applyDisplayed,
      sendDesired,
      successMessage,
      isCurrentRequest: isCurrentTopicActionRequest,
      notify,
      optimisticActions: optimisticTopicActionsRef,
      ownerKey: optimisticOwnerKey(requestOwner),
      setOptimisticActionState: setOptimisticTopicActionState
    });
  }, [isCurrentTopicActionRequest, notify, optimisticTopicActionsRef, setOptimisticTopicActionState]);

  const startOptimisticTopicAction = useCallback(({
    key,
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
      ownerKey: optimisticOwnerKey(requestOwner),
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
    if (replyEditTarget) {
      if (!isNodeSeekActionTopic(detail) && !isLinuxDoActionTopic(detail)) {
        notify('当前来源暂不支持编辑回复');
        return;
      }
      const actionKey = topicEditReplyActionKey(requestTopicKey, replyEditTarget.commentId);
      await runSingleNonIdempotentTopicAction(actionKey, async () => {
        const requestOwner = startTopicActionRequest(actionKey);
        const submitted = isNodeSeekActionTopic(detail)
          ? await runNodeSeekRequest(
            (access) => buildNodeSeekEditReplyRequest({ commentId: replyEditTarget.commentId, content: replyContent, csrfToken: access?.csrfToken || '' }),
            '回复已更新',
            { owner: requestOwner }
          )
          : await runLinuxDoRequest(
            () => buildLinuxDoEditReplyRequest({ postId: replyEditTarget.commentId, content: replyContent }),
            '回复已更新',
            { owner: requestOwner }
          );
        if (submitted) {
          if (!isCurrentTopicActionRequest(requestOwner)) {
            return;
          }
          setReplyContent('');
          setReplyComposerOpen(false);
          setReplyTarget(null);
          setReplyEditTarget(null);
          await refreshTopicReplies({ silent: true, afterSubmit: true, targetReply: replyEditTarget });
        }
      });
      return;
    }
    const actionKey = topicReplyActionKey(requestTopicKey);
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
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
          { owner: requestOwner }
        );
        if (submitted) {
          if (!isCurrentTopicActionRequest(requestOwner)) {
            return;
          }
          setReplyContent('');
          setReplyComposerOpen(false);
          setReplyTarget(null);
          setReplyEditTarget(null);
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
          { owner: requestOwner }
        );
        if (submitted) {
          if (!isCurrentTopicActionRequest(requestOwner)) {
            return;
          }
          setReplyContent('');
          setReplyComposerOpen(false);
          setReplyTarget(null);
          setReplyEditTarget(null);
          await refreshTopicReplies({ silent: true, afterSubmit: true });
        }
        return;
      }
      const submitted = await runNodeSeekRequest(
        (access) => buildNodeSeekReplyRequest({ postId: detail.id, content: replyContent, replyTarget, csrfToken: access?.csrfToken || '' }),
        '回复已提交',
        { owner: requestOwner }
      );
      if (submitted) {
        if (!isCurrentTopicActionRequest(requestOwner)) {
          return;
        }
        setReplyContent('');
        setReplyComposerOpen(false);
        setReplyTarget(null);
        setReplyEditTarget(null);
        await refreshTopicReplies({ silent: true, afterSubmit: true });
      }
    });
  }, [isCurrentTopicActionRequest, notify, refreshTopicReplies, replyContent, replyEditTarget, replyTarget, runLinuxDoRequest, runNodeSeekRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, setReplyComposerOpen, setReplyContent, setReplyEditTarget, setReplyTarget, startTopicActionRequest, topicDetail]);

  const deleteReplyConfirmed = useCallback(async (reply: Reply) => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail) {
      return;
    }
    if (!reply.canDelete) {
      notify('当前回复不能删除');
      return;
    }
    const requestTopicKey = topicKey(detail);
    const actionKey = topicDeleteReplyActionKey(requestTopicKey, reply);
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      let deleted: unknown = false;
      if (isYaohuoActionTopic(detail)) {
        if (!reply.deletePath) {
          notify('当前回复缺少删除链接，刷新主题后再试。');
          return;
        }
        deleted = await runYaohuoRequest(
          (cookieHeader) => buildYaohuoDeleteReplyRequest({
            deletePath: reply.deletePath || '',
            sid: extractYaohuoSid(cookieHeader)
          }),
          '回复已删除',
          { owner: requestOwner }
        );
      } else if (isLinuxDoActionTopic(detail)) {
        if (!reply.commentId) {
          notify('当前回复缺少评论 id，刷新主题后再试。');
          return;
        }
        deleted = await runLinuxDoRequest(
          () => buildLinuxDoDeleteReplyRequest({ postId: reply.commentId || 0 }),
          '回复已删除',
          { owner: requestOwner }
        );
      } else if (isNodeSeekActionTopic(detail)) {
        notify('NodeSeek 原站没有删除评论入口');
        return;
      }
      if (!deleted || !isCurrentTopicActionRequest(requestOwner)) {
        return;
      }
      if ((replyEditTarget && isSameReply(reply, replyEditTarget)) || (replyTarget && isSameReply(reply, replyTarget))) {
        setReplyComposerOpen(false);
        setReplyContent('');
        setReplyTarget(null);
        setReplyEditTarget(null);
      }
      setTopicReplies((current) => removeReply(current, reply));
      await refreshTopicReplies({ silent: true, afterSubmit: true, targetReply: reply, excludeReply: reply });
    });
  }, [isCurrentTopicActionRequest, notify, refreshTopicReplies, replyEditTarget, replyTarget, runLinuxDoRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, setReplyComposerOpen, setReplyContent, setReplyEditTarget, setReplyTarget, setTopicReplies, startTopicActionRequest, topicDetail]);

  const deleteReply = useCallback((reply: Reply) => {
    if (!reply.canDelete) {
      notify('当前回复不能删除');
      return;
    }
    Alert.alert('删除回复', '确认删除这条回复？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteReplyConfirmed(reply);
        }
      }
    ]);
  }, [deleteReplyConfirmed, notify]);

  const uploadReplyImage = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail || !canSubmitReplyToTopic(detail)) {
      return;
    }
    if (!replyImageUploadSupported(detail.source)) {
      notify('当前来源暂不支持上传图片');
      return;
    }

    const actionKey = `${topicReplyActionKey(topicKey(detail))}:image`;
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      let nodeSeekApiKey: string | null = null;
      if (isNodeSeekActionTopic(detail)) {
        nodeSeekApiKey = await ensureNodeImageApiKey();
        if (!nodeSeekApiKey || !isCurrentTopicActionRequest(requestOwner)) {
          return;
        }
      }
      let file: NormalizedReplyImageAsset;
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: 'image/*',
          copyToCacheDirectory: true,
          multiple: false
        });
        if (result.canceled || !result.assets?.[0]) {
          return;
        }
        file = normalizeReplyImageAsset(result.assets[0]);
      } catch (error) {
        notify(errorMessage(error));
        return;
      }
      if (!isCurrentTopicActionRequest(requestOwner)) {
        return;
      }
      try {
        let imageUrl = '';
        if (isLinuxDoActionTopic(detail)) {
          const result = await runLinuxDoRequest(
            () => buildLinuxDoImageUploadRequest({ file }),
            '',
            { owner: requestOwner, key: actionKey, notifySuccess: false }
          );
          if (!result || !isCurrentTopicActionRequest(requestOwner)) {
            return;
          }
          imageUrl = linuxDoImageUrlFromUploadResponse(result);
        } else if (isYaohuoActionTopic(detail)) {
          const run = startActionRun(actionKey, true);
          try {
            imageUrl = await uploadYaohuoReplyImage({
              file,
              signal: run.controller.signal
            });
          } finally {
            finishActionRun(run, true);
          }
          if (!isCurrentTopicActionRequest(requestOwner)) {
            return;
          }
        } else if (isNodeSeekActionTopic(detail)) {
          const run = startActionRun(actionKey, true);
          try {
            imageUrl = await uploadNodeSeekReplyImageWithApiKey({
              ensureApiKey: (options) => options?.forceRefresh
                ? ensureNodeImageApiKey({ forceRefresh: true, clearOnCancel: true })
                : Promise.resolve(nodeSeekApiKey),
              file,
              signal: run.controller.signal
            });
          } finally {
            finishActionRun(run, true);
          }
          if (!isCurrentTopicActionRequest(requestOwner)) {
            return;
          }
        }

        if (!imageUrl) {
          return;
        }
        const markup = replyImageMarkupForSource(detail.source, imageUrl, file.name);
        setReplyContent((current) => appendReplyImageMarkup(current, markup));
        notify('图片已插入');
      } catch (error) {
        if (!isCanceledRequest(error) && isCurrentTopicActionRequest(requestOwner)) {
          notify(errorMessage(error));
        }
      }
    });
  }, [ensureNodeImageApiKey, finishActionRun, isCurrentTopicActionRequest, notify, runLinuxDoRequest, runSingleNonIdempotentTopicAction, selectedTopic, setReplyContent, startActionRun, startTopicActionRequest, topicDetail]);

  const checkIn = useCallback(async () => {
    const actionKey = nodeSeekAttendanceActionKey();
    await runSingleNonIdempotentTopicAction(actionKey, () => runNodeSeekRequest(
      () => buildNodeSeekAttendanceRequest({ random: false }),
      '签到请求已提交',
      { key: actionKey }
    ));
  }, [runNodeSeekRequest, runSingleNonIdempotentTopicAction]);

  const interact = useCallback(async (type: InteractionType, commentId?: number) => {
    if (!commentId) {
      notify('当前内容缺少评论 id，刷新主题后再试。');
      return;
    }
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail) {
      return;
    }
    if (isLinuxDoActionTopic(detail)) {
      if (type !== 'like') {
        return;
      }
      const requestTopicKey = topicKey(detail);
      const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: commentId, action: 'like' });
      const requestOwner = startOptimisticTopicActionRequest(actionKey);
      const target = [
        topicDetail,
        ...topicReplies
      ].find((item) => (item as { commentId?: number } | null)?.commentId === commentId) as ({ liked?: boolean; canLike?: boolean } | undefined);
      if (!canUseLinuxDoLike(target)) {
        notify('不能给自己的帖子点赞');
        return;
      }
      startOptimisticTopicAction({
        key: actionKey,
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
    const requestTopicKey = topicKey(detail);
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
    const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: commentId, action: type });
    const requestOwner = startOptimisticTopicActionRequest(actionKey);
    startOptimisticTopicAction({
      key: actionKey,
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
  }, [notify, runLinuxDoActionForOptimisticUpdate, runNodeSeekActionForOptimisticUpdate, selectedTopic, setTopicDetail, setTopicReplies, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail, topicReplies]);

  const favoriteOnYaohuoSite = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isYaohuoActionTopic(detail)) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const actionKey = yaohuoFavoriteActionKey(requestTopicKey);
    await runSingleNonIdempotentTopicAction(actionKey, () => runYaohuoRequest(
      () => buildYaohuoFavoriteRequest({
        topicId: detail.id,
        classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID
      }),
      '原站收藏已提交',
      { owner: startTopicActionRequest(actionKey) }
    ));
  }, [runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

  const collectOnNodeSeekSite = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isNodeSeekActionTopic(detail)) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: detail.id, action: 'collection' });
    const requestOwner = startOptimisticTopicActionRequest(actionKey);
    const collected = Boolean((detail as TopicDetail).collected);
    startOptimisticTopicAction({
      key: actionKey,
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
  }, [runNodeSeekActionForOptimisticUpdate, selectedTopic, setTopicDetail, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail]);

  const bookmarkOnLinuxDoSite = useCallback(async () => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isLinuxDoActionTopic(detail)) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const bookmarked = Boolean((detail as TopicDetail).bookmarked);
    let bookmarkId = (detail as TopicDetail).bookmarkId;
    const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: detail.id, action: 'bookmark' });
    const requestOwner = startOptimisticTopicActionRequest(actionKey);
    startOptimisticTopicAction({
      key: actionKey,
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
  }, [isCurrentTopicActionRequest, optimisticTopicActionsRef, runLinuxDoActionForOptimisticUpdate, selectedTopic, setTopicDetail, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail]);

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
    const actionKey = topicPollVoteActionKey(requestTopicKey, poll);
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      let submitted: unknown = false;
      if (isNodeSeekActionTopic(detail)) {
        submitted = await runNodeSeekRequest(
          () => buildNodeSeekVoteRequest({ optionIds }),
          '投票已提交',
          { owner: requestOwner }
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
          { owner: requestOwner }
        );
      } else {
        submitted = await runYaohuoRequest(
          () => buildYaohuoVoteRequest({
            topicId: detail.id,
            classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID,
            voteIds: optionIds
          }),
          '投票已提交',
          { owner: requestOwner }
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
    });
  }, [isCurrentTopicActionRequest, notify, runLinuxDoRequest, runNodeSeekRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, setTopicDetail, setTopicReplies, startTopicActionRequest, topicDetail]);

  return {
    bookmarkOnLinuxDoSite,
    canUseLinuxDoActions,
    canUseNodeSeekActions,
    canUseYaohuoActions,
    checkIn,
    collectOnNodeSeekSite,
    deleteReply,
    favoriteOnYaohuoSite,
    interact,
    submitReply,
    uploadReplyImage,
    votePoll
  };
}
