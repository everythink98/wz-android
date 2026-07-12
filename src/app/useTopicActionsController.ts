import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
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
  linuxDoBookmarkIdFromActionResult,
  topicActionStateKey,
  type InteractionType,
  type OptimisticActionState
} from '../topicActionState';
import type { Reply, TopicDetail, TopicPoll } from '../types';
import { topicKey } from '../readerData';
import type { TopicRepliesRefreshOptions } from '../appTypes';
import { currentLinuxDoAccessGeneration, linuxDoAccessSummary, loadLinuxDoAccess } from '../linuxdoCookieBridge';
import { hasNodeSeekLoginCookie, parseNodeSeekDocumentCookie } from '../nodeseekCookies';
import type { RequestOwner } from '../requestOwnership';
import type { Fetcher } from '../request';
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
import {
  errorMessage,
  isCanceledRequest,
  isSilentRequestInterruption,
  isSupersededRequest
} from '../appUtils';
import { canUseLinuxDoLike } from '../linuxdoPermissions';
import {
  normalizeReplyImageAsset,
  replyImageMarkupForSource,
  replyImageUploadSupported,
  type NormalizedReplyImageAsset,
  uploadNodeSeekReplyImageWithApiKey,
  uploadYaohuoReplyImage
} from '../replyImageUpload';
import { createSiteSessionViewModels, isSiteLoggedIn, type SiteSessionEvent, type SiteSessionStates } from '../siteSessionState';
import { authActionMessageForSource } from '../siteSessionPrompts';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticOutcome,
  type DiagnosticPhase,
  type DiagnosticReason,
  type DiagnosticTrace
} from '../diagnostics';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import type { TopicSessionController } from './useTopicSessionController';
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
  deferDiagnosticFailure?: boolean;
  diagnosticTrace?: DiagnosticTrace;
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
  diagnosticTrace: DiagnosticTrace;
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

function failDiagnosticActionRequest(
  options: ActionRunOptions,
  source: 'nodeseek' | 'linuxdo' | 'yaohuo',
  phase: DiagnosticPhase,
  outcome: DiagnosticOutcome,
  reason: DiagnosticReason
) {
  if (!options.diagnosticTrace) {
    return;
  }
  markDiagnosticStage(options.diagnosticTrace, phase, { source, state: 'failure', reason });
  if (!options.deferDiagnosticFailure) {
    finishDiagnosticTrace(options.diagnosticTrace, outcome, { source, reason });
  }
}

function actionRequestDiagnosticFields(
  source: 'nodeseek' | 'linuxdo' | 'yaohuo',
  request: NodeSeekActionRequest | LinuxDoActionRequest | YaohuoActionRequest
) {
  const path = request.path.split('?', 1)[0].toLowerCase();
  if (source === 'nodeseek') {
    const requestType = path === '/api/content/new-comment' ? 'reply'
      : path === '/api/content/edit-comment' ? 'edit'
        : path === '/api/statistics/collection' ? 'collection'
          : path.startsWith('/api/statistics/') ? 'interaction'
            : path === '/api/attendance' ? 'attendance'
              : path === '/api/vote/voteforitem' ? 'vote'
                : 'unknown';
    return {
      requestType,
      csrfSource: requestType === 'reply' || requestType === 'edit' ? 'local-generated' : 'none'
    };
  }
  if (source === 'linuxdo') {
    const requestType = path === '/posts.json' ? 'reply'
      : path === '/uploads.json' ? 'image-upload'
        : /^\/posts\/\d+\.json$/.test(path) ? request.method === 'PUT' ? 'edit' : 'delete'
          : path.startsWith('/post_actions') ? 'interaction'
            : path.startsWith('/bookmarks') ? 'bookmark'
              : path === '/polls/vote' ? 'vote'
                : 'unknown';
    return { requestType, csrfSource: 'session-endpoint' };
  }
  const requestType = path === '/bbs/book_re.aspx' ? 'reply'
    : path === '/bbs/book_re_del.aspx' ? 'delete'
      : path === '/bbs/share.aspx' ? 'favorite'
        : path === '/bbs/book_view_tovote.aspx' ? 'vote'
          : 'unknown';
  return { requestType, csrfSource: 'none' };
}

function topicDeleteReplyActionKey(topicKeyValue: string, reply: Reply) {
  return `delete-reply:${topicKeyValue}:${reply.commentId ?? reply.deletePath ?? reply.floor ?? 'reply'}`;
}

export function useTopicActionsController({
  actionAbortRef,
  clearNodeSeekLoginCookiesOnly,
  clearYaohuoLoginState,
  currentNodeSeekCredentialGeneration,
  fetcher,
  linuxDoWebViewUserAgentRef,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  nodeSeekWebViewUserAgentRef,
  ensureNodeImageApiKey,
  notify,
  optimisticTopicActionsRef,
  refreshTopicReplies,
  resetLinuxDoLevelState,
  setActionBusy,
  setOptimisticTopicActions,
  showLinuxDoLogin,
  showYaohuoLogin,
  siteSessionStates,
  topicActionRequestOwnerRef,
  topicSession,
  updateLinuxDoSession,
  yaohuoCredentialSuppressedRef
}: {
  actionAbortRef: Ref<{ abort: () => void; abortAll: () => void } | null>;
  clearNodeSeekLoginCookiesOnly: (options?: CredentialClearOptions) => Promise<unknown>;
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<boolean | void>;
  currentNodeSeekCredentialGeneration: () => number;
  fetcher: Fetcher;
  linuxDoWebViewUserAgentRef: Ref<string>;
  loadNodeSeekCookieForSource: (source: 'nodeseek', options?: CredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: 'yaohuo', options?: CredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  ensureNodeImageApiKey: (options?: { forceRefresh?: boolean; clearOnCancel?: boolean }) => Promise<string | null>;
  notify: (message: string) => void;
  optimisticTopicActionsRef: Ref<Record<string, OptimisticActionState>>;
  refreshTopicReplies: (options?: TopicRepliesRefreshOptions) => Promise<unknown>;
  resetLinuxDoLevelState: () => void;
  setActionBusy: Dispatch<SetStateAction<boolean>>;
  setOptimisticTopicActions: Dispatch<SetStateAction<Record<string, OptimisticActionState>>>;
  showLinuxDoLogin: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  siteSessionStates: SiteSessionStates;
  topicActionRequestOwnerRef: Ref<RequestOwner>;
  topicSession: TopicSessionController;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
  yaohuoCredentialSuppressedRef: Ref<boolean>;
}) {
  const {
    state: { replyContent, replyEditTarget, replyFace, replyTarget, selectedTopic, topicDetail, topicReplies },
    commands: {
      actions: topicActions,
      composer: topicComposer
    }
  } = topicSession;
  const appendReplyMarkup = topicComposer.appendMarkup;
  const applyTopicActionUpdate = topicActions.applyUpdate;
  const completeReplySubmission = topicComposer.completeSubmission;
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

  const runSingleNonIdempotentTopicAction = useCallback(<T,>(key: string, task: () => Promise<T>, diagnosticTrace?: DiagnosticTrace) => (
    runSingleTopicAction({
      key,
      notifyDuplicate: () => {
        notify('操作正在提交，请稍后。');
        if (diagnosticTrace) {
          markDiagnosticStage(diagnosticTrace, 'guard', { isBusy: true, reason: 'duplicate' });
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'duplicate' });
        }
      },
      pendingActions: pendingTopicActionsRef,
      task: async () => {
        try {
          const result = await task();
          if (diagnosticTrace) {
            finishDiagnosticTrace(diagnosticTrace, 'success');
          }
          return result;
        } catch (error) {
          if (diagnosticTrace) {
            finishDiagnosticTrace(diagnosticTrace, 'failure', { reason: normalizeDiagnosticReason(error) });
          }
          throw error;
        }
      }
    })
  ), [notify]);

  const refreshTopicRepliesAfterWrite = useCallback(async (diagnosticTrace: DiagnosticTrace, options: TopicRepliesRefreshOptions) => {
    try {
      const refreshed = await refreshTopicReplies({ ...options, diagnosticTrace });
      if (refreshed === false) {
        finishDiagnosticTrace(diagnosticTrace, 'partial', { reason: 'refresh_failed' });
        return;
      }
      markDiagnosticStage(diagnosticTrace, 'apply', { state: 'refreshed', refreshSucceeded: true });
    } catch (error) {
      finishDiagnosticTrace(diagnosticTrace, 'partial', { reason: 'refresh_failed' });
      throw error;
    }
  }, [refreshTopicReplies]);

  const runNodeSeekRequest = useCallback(async (
    requestFactory: () => NodeSeekActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    const diagnosticTrace = options.diagnosticTrace;
    if (!canUseNodeSeekActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return false;
      }
      notify(actionMessage(authActionMessageForSource('nodeseek', siteSessionViewModels), options.restoreOnFailure));
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'credential', { source: 'nodeseek', hasCredential: false, reason: 'login_required' });
        if (!options.deferDiagnosticFailure) {
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: 'nodeseek', reason: 'login_required' });
        }
      }
      return false;
    }
    const actionKey = options.key || options.owner?.action.key || success || options.fallbackKey || 'nodeseek-action';
    const topicScoped = isTopicScopedActionKey(actionKey);
    const requestOwner = options.owner || (topicScoped ? startTopicActionRequest(actionKey) : undefined);
    const busy = options.busy ?? true;
    if (diagnosticTrace) {
      markDiagnosticStage(diagnosticTrace, 'guard', { source: 'nodeseek', hasOwner: Boolean(requestOwner), isBusy: busy });
      markDiagnosticStage(diagnosticTrace, 'credential', { source: 'nodeseek', state: 'load' });
    }
    const run = startActionRun(actionKey, busy, topicScoped);
    let nodeSeekGeneration = currentNodeSeekCredentialGeneration();
    try {
      const cookieHeader = await loadNodeSeekCookieForSource('nodeseek', {
        captureGeneration: (generation) => { nodeSeekGeneration = generation; },
        diagnosticTrace
      });
      if (nodeSeekGeneration !== currentNodeSeekCredentialGeneration()
        || !isCurrentActionRun(run)
        || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return false;
      }
      if (!cookieHeader?.trim() || !hasNodeSeekLoginCookie(parseNodeSeekDocumentCookie(cookieHeader))) {
        notify(actionMessage('NodeSeek 登录已失效，请重新登录。', options.restoreOnFailure));
        if (diagnosticTrace) {
          markDiagnosticStage(diagnosticTrace, 'credential', { source: 'nodeseek', hasCredential: false, reason: 'login_required' });
          if (!options.deferDiagnosticFailure) {
            finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: 'nodeseek', reason: 'login_required' });
          }
        }
        return false;
      }
      const request = requestFactory();
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'credential', {
          source: 'nodeseek',
          state: 'ready',
          hasCredential: true,
          credentialSource: 'secure-store',
          ...actionRequestDiagnosticFields('nodeseek', request)
        });
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'nodeseek', state: 'start' });
      }
      await runNodeSeekAction({
        cookieHeader,
        fetcher: diagnosticTrace ? withDiagnosticFetcher(diagnosticTrace, fetcher) : fetcher,
        request,
        signal: run.controller.signal,
        userAgent: nodeSeekWebViewUserAgentRef.current
      });
      if (!isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return false;
      }
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'nodeseek', state: 'confirmed', serverConfirmed: true });
      }
      if (options.notifySuccess !== false && success) {
        notify(success);
      }
      return true;
    } catch (error) {
      if (!isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner)) || isSilentRequestInterruption(error)) {
        if (diagnosticTrace) {
          const reason = isSupersededRequest(error) ? 'superseded' : isCanceledRequest(error) ? 'canceled' : 'stale';
          finishDiagnosticTrace(diagnosticTrace, reason === 'canceled' ? 'canceled' : 'stale', { source: 'nodeseek', reason });
        }
        return false;
      }
      const diagnosticReason = normalizeDiagnosticReason(error);
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'nodeseek', state: 'failure', reason: diagnosticReason });
      }
      if (isNodeSeekLoginRequiredError(error)) {
        let cleanupCurrent = nodeSeekGeneration === currentNodeSeekCredentialGeneration();
        let cleanupGeneration: number | undefined;
        try {
          if (cleanupCurrent) {
            const cleanup = clearNodeSeekLoginCookiesOnly({ generation: nodeSeekGeneration });
            cleanupGeneration = currentNodeSeekCredentialGeneration();
            await cleanup;
            cleanupCurrent = cleanupGeneration === currentNodeSeekCredentialGeneration();
          }
        } catch {
          cleanupCurrent = cleanupGeneration === undefined
            ? cleanupCurrent
            : cleanupGeneration === currentNodeSeekCredentialGeneration();
          if (diagnosticTrace && cleanupCurrent) {
            markDiagnosticStage(diagnosticTrace, 'credential', { source: 'nodeseek', state: 'error', reason: 'storage_error' });
          }
        }
        if (!cleanupCurrent || !isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
          if (diagnosticTrace) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', {
              source: 'nodeseek',
              reason: cleanupCurrent ? 'stale' : 'superseded'
            });
          }
          return false;
        }
      }
      notify(actionMessage(errorMessage(error), options.restoreOnFailure));
      if (diagnosticTrace && !options.deferDiagnosticFailure) {
        finishDiagnosticTrace(diagnosticTrace, 'failure', { source: 'nodeseek', reason: diagnosticReason });
      }
      return false;
    } finally {
      finishActionRun(run, busy);
    }
  }, [canUseNodeSeekActions, clearNodeSeekLoginCookiesOnly, currentNodeSeekCredentialGeneration, fetcher, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, loadNodeSeekCookieForSource, nodeSeekWebViewUserAgentRef, notify, siteSessionViewModels, startActionRun, startTopicActionRequest]);

  const runYaohuoRequest = useCallback(async (
    requestFactory: (cookieHeader: string) => YaohuoActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    const diagnosticTrace = options.diagnosticTrace;
    if (yaohuoCredentialSuppressedRef.current) {
      failDiagnosticActionRequest(options, 'yaohuo', 'credential', 'blocked', 'missing_credential');
      return false;
    }
    if (!canUseYaohuoActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'yaohuo', reason: 'stale' });
        }
        return false;
      }
      showYaohuoLogin(authActionMessageForSource('yaohuo', siteSessionViewModels));
      failDiagnosticActionRequest(options, 'yaohuo', 'credential', 'blocked', 'login_required');
      return false;
    }
    const requestOwner = options.owner || startTopicActionRequest(options.key || success);
    const run = startActionRun(options.key || requestOwner.action.key || success, true);
    if (diagnosticTrace) {
      markDiagnosticStage(diagnosticTrace, 'guard', { source: 'yaohuo', hasOwner: true, isBusy: true });
      markDiagnosticStage(diagnosticTrace, 'credential', { source: 'yaohuo', state: 'load' });
    }
    let yaohuoGeneration: number | undefined;
    try {
      const cookieHeader = await loadYaohuoCookieForSource('yaohuo', {
        captureGeneration: (generation) => { yaohuoGeneration = generation; },
        diagnosticTrace
      });
      if (yaohuoCredentialSuppressedRef.current || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'yaohuo', reason: 'stale' });
        }
        return false;
      }
      if (!cookieHeader) {
        showYaohuoLogin(authActionMessageForSource('yaohuo', siteSessionViewModels));
        failDiagnosticActionRequest(options, 'yaohuo', 'credential', 'blocked', 'missing_credential');
        return false;
      }
      const request = requestFactory(cookieHeader);
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'credential', {
          source: 'yaohuo',
          state: 'ready',
          hasCredential: true,
          credentialSource: 'secure-store',
          ...actionRequestDiagnosticFields('yaohuo', request)
        });
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'yaohuo', state: 'start' });
      }
      const result = await runYaohuoAction({
        cookieHeader,
        fetcher: diagnosticTrace ? withDiagnosticFetcher(diagnosticTrace, fetcher) : fetcher,
        request,
        signal: run.controller.signal
      });
      if (yaohuoCredentialSuppressedRef.current || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'yaohuo', reason: 'stale' });
        }
        return false;
      }
      const resultConfirmed = result.message !== '操作结果无法确认，请刷新原帖核对';
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'yaohuo', state: resultConfirmed ? 'confirmed' : 'unconfirmed', serverConfirmed: resultConfirmed });
      }
      notify(result.message === '操作已提交' ? success : result.message);
      if (!resultConfirmed) {
        failDiagnosticActionRequest(options, 'yaohuo', 'transport', 'failure', 'invalid_response');
      }
      return resultConfirmed ? result : false;
    } catch (error) {
      if (yaohuoCredentialSuppressedRef.current || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner) || isSilentRequestInterruption(error)) {
        if (diagnosticTrace) {
          const reason = isSupersededRequest(error) ? 'superseded' : isCanceledRequest(error) ? 'canceled' : 'stale';
          finishDiagnosticTrace(diagnosticTrace, reason === 'canceled' ? 'canceled' : 'stale', { source: 'yaohuo', reason });
        }
        return false;
      }
      const diagnosticReason = normalizeDiagnosticReason(error);
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        if ((error as { reason?: unknown }).reason === 'expired') {
          let cleanupCurrent = true;
          try {
            const cleared = await clearYaohuoLoginState({
              generation: yaohuoGeneration,
              isCurrent: () => !yaohuoCredentialSuppressedRef.current
                && isCurrentActionRun(run)
                && isCurrentTopicActionRequest(requestOwner)
            });
            cleanupCurrent = cleared !== false;
          } catch {
            if (diagnosticTrace) {
              markDiagnosticStage(diagnosticTrace, 'credential', { source: 'yaohuo', state: 'error', reason: 'storage_error' });
            }
          }
          if (!cleanupCurrent || yaohuoCredentialSuppressedRef.current || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
            if (diagnosticTrace) {
              finishDiagnosticTrace(diagnosticTrace, 'stale', {
                source: 'yaohuo',
                reason: cleanupCurrent ? 'stale' : 'superseded'
              });
            }
            return false;
          }
        }
        showYaohuoLogin(errorMessage(error));
        failDiagnosticActionRequest(options, 'yaohuo', 'credential', 'blocked', diagnosticReason);
        return false;
      }
      notify(errorMessage(error));
      failDiagnosticActionRequest(options, 'yaohuo', 'transport', 'failure', diagnosticReason);
      return false;
    } finally {
      finishActionRun(run, true);
    }
  }, [canUseYaohuoActions, clearYaohuoLoginState, fetcher, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, loadYaohuoCookieForSource, notify, showYaohuoLogin, siteSessionViewModels, startActionRun, startTopicActionRequest, yaohuoCredentialSuppressedRef]);

  const runLinuxDoRequest = useCallback(async (
    requestFactory: () => LinuxDoActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    const diagnosticTrace = options.diagnosticTrace;
    if (!canUseLinuxDoActions) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'linuxdo', reason: 'stale' });
        }
        return false;
      }
      const message = authActionMessageForSource('linuxdo', siteSessionViewModels);
      showLinuxDoLogin(actionMessage(message, options.restoreOnFailure));
      failDiagnosticActionRequest(options, 'linuxdo', 'credential', 'blocked', 'login_required');
      return false;
    }
    const actionKey = options.key || options.owner?.action.key || success || options.fallbackKey || 'linuxdo-action';
    const requestOwner = options.owner || startTopicActionRequest(actionKey);
    const busy = options.busy ?? true;
    const run = startActionRun(actionKey, busy);
    if (diagnosticTrace) {
      markDiagnosticStage(diagnosticTrace, 'guard', { source: 'linuxdo', hasOwner: true, isBusy: busy });
      markDiagnosticStage(diagnosticTrace, 'credential', { source: 'linuxdo', state: 'load' });
    }
    let linuxDoGeneration: number | undefined;
    let linuxDoAccessCookieHeader: string | undefined;
    try {
      linuxDoGeneration = currentLinuxDoAccessGeneration();
      const access = await loadLinuxDoAccess();
      linuxDoAccessCookieHeader = access?.cookieHeader;
      if (linuxDoGeneration !== currentLinuxDoAccessGeneration()
        || !isCurrentActionRun(run)
        || !isCurrentTopicActionRequest(requestOwner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'linuxdo', reason: 'stale' });
        }
        return false;
      }
      if (!access?.cookieHeader || !linuxDoAccessSummary(access).loggedIn) {
        const message = authActionMessageForSource('linuxdo', siteSessionViewModels);
        updateLinuxDoSession({ type: 'login-expired', message });
        showLinuxDoLogin(actionMessage(message, options.restoreOnFailure));
        failDiagnosticActionRequest(options, 'linuxdo', 'credential', 'blocked', 'missing_credential');
        return false;
      }
      const request = requestFactory();
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'credential', {
          source: 'linuxdo',
          state: 'ready',
          hasCredential: true,
          credentialSource: 'secure-store',
          ...actionRequestDiagnosticFields('linuxdo', request)
        });
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'linuxdo', state: 'start' });
      }
      const result = await runLinuxDoAction({
        cookieHeader: access.cookieHeader,
        fetcher: diagnosticTrace ? withDiagnosticFetcher(diagnosticTrace, fetcher) : fetcher,
        userAgent: access.userAgent || linuxDoWebViewUserAgentRef.current,
        request,
        signal: run.controller.signal
      });
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'linuxdo', reason: 'stale' });
        }
        return false;
      }
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'linuxdo', state: 'confirmed', serverConfirmed: true });
      }
      if (options.notifySuccess !== false && success) {
        notify(success);
      }
      return result ?? true;
    } catch (error) {
      if (!isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner) || isSilentRequestInterruption(error)) {
        if (diagnosticTrace) {
          const reason = isSupersededRequest(error) ? 'superseded' : isCanceledRequest(error) ? 'canceled' : 'stale';
          finishDiagnosticTrace(diagnosticTrace, reason === 'canceled' ? 'canceled' : 'stale', { source: 'linuxdo', reason });
        }
        return false;
      }
      const diagnosticReason = normalizeDiagnosticReason(error);
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        let cleanupCurrent = true;
        try {
          cleanupCurrent = await clearExpiredLinuxDoLogin({ error, generation: linuxDoGeneration, cookieHeader: linuxDoAccessCookieHeader, resetLinuxDoLevelState, updateLinuxDoSession });
        } catch {
          if (diagnosticTrace) {
            markDiagnosticStage(diagnosticTrace, 'credential', { source: 'linuxdo', state: 'error', reason: 'storage_error' });
          }
        }
        if (!cleanupCurrent || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
          if (diagnosticTrace) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', {
              source: 'linuxdo',
              reason: cleanupCurrent ? 'stale' : 'superseded'
            });
          }
          return false;
        }
        showLinuxDoLogin(actionMessage(errorMessage(error), options.restoreOnFailure));
        failDiagnosticActionRequest(options, 'linuxdo', 'credential', 'blocked', diagnosticReason);
        return false;
      }
      notify(actionMessage(errorMessage(error), options.restoreOnFailure));
      failDiagnosticActionRequest(options, 'linuxdo', 'transport', 'failure', diagnosticReason);
      return false;
    } finally {
      finishActionRun(run, busy);
    }
  }, [canUseLinuxDoActions, fetcher, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, linuxDoWebViewUserAgentRef, notify, resetLinuxDoLevelState, showLinuxDoLogin, siteSessionViewModels, startActionRun, startTopicActionRequest, updateLinuxDoSession]);

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
    deferDiagnosticFailure: true,
    notifySuccess: false,
    restoreOnFailure: true
  }), [runNodeSeekRequest]);

  const runLinuxDoActionForOptimisticUpdate = useCallback(async (
    requestFactory: () => LinuxDoActionRequest,
    options: ActionRunOptions = {}
  ) => runLinuxDoRequest(requestFactory, '', {
    ...options,
    busy: false,
    deferDiagnosticFailure: true,
    fallbackKey: 'linuxdo-optimistic',
    notifySuccess: false,
    restoreOnFailure: true
  }), [runLinuxDoRequest]);

  const runOptimisticActionQueue = useCallback(async ({
    key,
    requestOwner,
    applyDisplayed,
    sendDesired,
    successMessage,
    diagnosticTrace
  }: Omit<OptimisticTopicActionOptions, 'currentActive'>) => {
    let lastResult: boolean | undefined;
    await runOptimisticActionQueueHelper({
      key,
      requestOwner,
      applyDisplayed,
      sendDesired: async (desiredActive) => {
        try {
          lastResult = await sendDesired(desiredActive);
          return lastResult;
        } catch (error) {
          lastResult = false;
          throw error;
        }
      },
      successMessage,
      isCurrentRequest: isCurrentTopicActionRequest,
      notify,
      optimisticActions: optimisticTopicActionsRef,
      ownerKey: optimisticOwnerKey(requestOwner),
      setOptimisticActionState: setOptimisticTopicActionState
    });
    if (!isCurrentTopicActionRequest(requestOwner)) {
      finishDiagnosticTrace(diagnosticTrace, 'stale', { reason: 'stale' });
      return;
    }
    if (lastResult === false) {
      markDiagnosticStage(diagnosticTrace, 'rollback', { state: 'local' });
      finishDiagnosticTrace(diagnosticTrace, 'failure', { reason: 'unknown' });
    } else if (lastResult === true) {
      markDiagnosticStage(diagnosticTrace, 'apply', { state: 'confirmed', localApplied: true });
      finishDiagnosticTrace(diagnosticTrace, 'success');
    } else {
      finishDiagnosticTrace(diagnosticTrace, 'stale', { reason: 'stale' });
    }
  }, [isCurrentTopicActionRequest, notify, optimisticTopicActionsRef, setOptimisticTopicActionState]);

  const startOptimisticTopicAction = useCallback(({
    key,
    requestOwner,
    currentActive,
    applyDisplayed,
    sendDesired,
    successMessage,
    diagnosticTrace
  }: OptimisticTopicActionOptions) => {
    if (!isCurrentTopicActionRequest(requestOwner)) {
      finishDiagnosticTrace(diagnosticTrace, 'stale', { reason: 'stale' });
      return;
    }
    const alreadyInFlight = Boolean(optimisticTopicActionsRef.current[key]?.inFlight);
    markDiagnosticStage(diagnosticTrace, 'apply', { state: 'optimistic', localApplied: true });
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
          successMessage,
          diagnosticTrace
        });
      }
    });
    if (alreadyInFlight) {
      markDiagnosticStage(diagnosticTrace, 'apply', { state: 'queued', localApplied: true });
      finishDiagnosticTrace(diagnosticTrace, 'success', { state: 'queued' });
    }
  }, [isCurrentTopicActionRequest, optimisticTopicActionsRef, runOptimisticActionQueue, setOptimisticTopicActionState]);

  const submitReply = useCallback(async () => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('reply', replyEditTarget ? 'edit' : 'submit', {
      ...(actionSource ? { source: actionSource } : {}),
      contentLength: replyContent.length
    });
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!canSubmitReplyToTopic(detail)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'not_ready' });
      return;
    }
    const requestTopicKey = topicKey(detail);
    if (!replyContent.trim()) {
      notify('请输入回复内容');
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
      return;
    }
    if (replyEditTarget) {
      if (!isNodeSeekActionTopic(detail) && !isLinuxDoActionTopic(detail)) {
        notify('当前来源暂不支持编辑回复');
        finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'unsupported' });
        return;
      }
      markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
      const actionKey = topicEditReplyActionKey(requestTopicKey, replyEditTarget.commentId);
      await runSingleNonIdempotentTopicAction(actionKey, async () => {
        const requestOwner = startTopicActionRequest(actionKey);
        const submitted = isNodeSeekActionTopic(detail)
          ? await runNodeSeekRequest(
            () => buildNodeSeekEditReplyRequest({ commentId: replyEditTarget.commentId, content: replyContent }),
            '回复已更新',
            { owner: requestOwner, diagnosticTrace }
          )
          : await runLinuxDoRequest(
            () => buildLinuxDoEditReplyRequest({ postId: replyEditTarget.commentId, content: replyContent }),
            '回复已更新',
            { owner: requestOwner, diagnosticTrace }
          );
        if (submitted) {
          if (!isCurrentTopicActionRequest(requestOwner)) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            return;
          }
          const editedReplyContent = {
            commentId: replyEditTarget.commentId,
            contentMarkdown: replyContent
          };
          completeReplySubmission({ editedReplyContent, source: detail.source });
          markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', localApplied: true });
          await refreshTopicRepliesAfterWrite(diagnosticTrace, {
            silent: true,
            afterSubmit: true,
            nocache: true,
            targetReply: replyEditTarget,
            editedReplyContent
          });
        }
      }, diagnosticTrace);
      return;
    }
    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    const actionKey = topicReplyActionKey(requestTopicKey);
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      if (isYaohuoActionTopic(detail)) {
        if (replyTarget && !replyTarget.authorId) {
          notify('当前楼层缺少用户 id，刷新主题后再试。');
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
          return;
        }
        const submitted = await runYaohuoRequest(
          (cookieHeader) => buildYaohuoReplyRequest({
            topicId: detail.id,
            classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID,
            content: replyContent,
            face: replyFace,
            sid: extractYaohuoSid(cookieHeader),
            replyFloor: replyTarget?.floor,
            toUserId: replyTarget?.authorId
          }),
          '回复已提交',
          { owner: requestOwner, diagnosticTrace }
        );
        if (submitted) {
          if (!isCurrentTopicActionRequest(requestOwner)) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            return;
          }
          completeReplySubmission();
          markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', localApplied: true });
          await refreshTopicRepliesAfterWrite(diagnosticTrace, { silent: true, afterSubmit: true });
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
          { owner: requestOwner, diagnosticTrace }
        );
        if (submitted) {
          if (!isCurrentTopicActionRequest(requestOwner)) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            return;
          }
          completeReplySubmission();
          markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', localApplied: true });
          await refreshTopicRepliesAfterWrite(diagnosticTrace, { silent: true, afterSubmit: true });
        }
        return;
      }
      const submitted = await runNodeSeekRequest(
        () => buildNodeSeekReplyRequest({ postId: detail.id, content: replyContent, replyTarget }),
        '回复已提交',
        { owner: requestOwner, diagnosticTrace }
      );
      if (submitted) {
        if (!isCurrentTopicActionRequest(requestOwner)) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
          return;
        }
        completeReplySubmission();
        markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', localApplied: true });
        await refreshTopicRepliesAfterWrite(diagnosticTrace, { silent: true, afterSubmit: true });
      }
    }, diagnosticTrace);
  }, [completeReplySubmission, isCurrentTopicActionRequest, notify, refreshTopicRepliesAfterWrite, replyContent, replyEditTarget, replyFace, replyTarget, runLinuxDoRequest, runNodeSeekRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

  const deleteReplyConfirmed = useCallback(async (reply: Reply, diagnosticTrace: DiagnosticTrace) => {
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'not_ready' });
      return;
    }
    if (!reply.canDelete) {
      notify('当前回复不能删除');
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'permission_denied' });
      return;
    }
    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    const requestTopicKey = topicKey(detail);
    const actionKey = topicDeleteReplyActionKey(requestTopicKey, reply);
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      let deleted: unknown = false;
      if (isYaohuoActionTopic(detail)) {
        if (!reply.deletePath) {
          notify('当前回复缺少删除链接，刷新主题后再试。');
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
          return;
        }
        deleted = await runYaohuoRequest(
          (cookieHeader) => buildYaohuoDeleteReplyRequest({
            deletePath: reply.deletePath || '',
            sid: extractYaohuoSid(cookieHeader)
          }),
          '回复已删除',
          { owner: requestOwner, diagnosticTrace }
        );
      } else if (isLinuxDoActionTopic(detail)) {
        if (!reply.commentId) {
          notify('当前回复缺少评论 id，刷新主题后再试。');
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
          return;
        }
        deleted = await runLinuxDoRequest(
          () => buildLinuxDoDeleteReplyRequest({ postId: reply.commentId || 0 }),
          '回复已删除',
          { owner: requestOwner, diagnosticTrace }
        );
      } else if (isNodeSeekActionTopic(detail)) {
        notify('NodeSeek 原站没有删除评论入口');
        finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'unsupported' });
        return;
      } else {
        finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'unsupported' });
        return;
      }
      if (!deleted || !isCurrentTopicActionRequest(requestOwner)) {
        if (deleted) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
        }
        return;
      }
      applyTopicActionUpdate({ type: 'reply-deleted', reply });
      markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', localApplied: true });
      await refreshTopicRepliesAfterWrite(diagnosticTrace, { silent: true, afterSubmit: true, targetReply: reply, excludeReply: reply });
    }, diagnosticTrace);
  }, [applyTopicActionUpdate, isCurrentTopicActionRequest, notify, refreshTopicRepliesAfterWrite, runLinuxDoRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

  const deleteReply = useCallback((reply: Reply) => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('reply', 'delete', actionSource ? { source: actionSource } : {});
    if (!reply.canDelete) {
      notify('当前回复不能删除');
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'permission_denied' });
      return;
    }
    let handled = false;
    Alert.alert('删除回复', '确认删除这条回复？', [
      {
        text: '取消',
        style: 'cancel',
        onPress: () => {
          handled = true;
          finishDiagnosticTrace(diagnosticTrace, 'canceled', { reason: 'canceled' });
        }
      },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          handled = true;
          void deleteReplyConfirmed(reply, diagnosticTrace);
        }
      }
    ], {
      cancelable: true,
      onDismiss: () => {
        if (!handled) {
          finishDiagnosticTrace(diagnosticTrace, 'canceled', { reason: 'canceled' });
        }
      }
    });
  }, [deleteReplyConfirmed, notify, selectedTopic, topicDetail]);

  const uploadReplyImage = useCallback(async () => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('reply', 'image-upload', actionSource ? { source: actionSource } : {});
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail || !canSubmitReplyToTopic(detail)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'not_ready' });
      return;
    }
    if (!replyImageUploadSupported(detail.source)) {
      notify('当前来源暂不支持上传图片');
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'unsupported' });
      return;
    }

    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    const actionKey = `${topicReplyActionKey(topicKey(detail))}:image`;
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      let nodeSeekApiKey: string | null = null;
      if (isNodeSeekActionTopic(detail)) {
        markDiagnosticStage(diagnosticTrace, 'credential', { source: detail.source, credentialSource: 'nodeimage', state: 'load' });
        nodeSeekApiKey = await ensureNodeImageApiKey();
        if (!nodeSeekApiKey || !isCurrentTopicActionRequest(requestOwner)) {
          if (!isCurrentTopicActionRequest(requestOwner)) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
          } else {
            finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'missing_credential' });
          }
          return;
        }
        markDiagnosticStage(diagnosticTrace, 'credential', {
          source: detail.source,
          credentialSource: 'nodeimage',
          state: 'ready',
          hasCredential: true,
          requestType: 'image-upload',
          csrfSource: 'none'
        });
      }
      let file: NormalizedReplyImageAsset;
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: 'image/*',
          copyToCacheDirectory: true,
          multiple: false
        });
        if (result.canceled || !result.assets?.[0]) {
          finishDiagnosticTrace(diagnosticTrace, 'canceled', { source: detail.source, reason: 'canceled' });
          return;
        }
        file = normalizeReplyImageAsset(result.assets[0]);
      } catch (error) {
        notify(errorMessage(error));
        finishDiagnosticTrace(diagnosticTrace, 'failure', { source: detail.source, reason: normalizeDiagnosticReason(error) });
        return;
      }
      if (!isCurrentTopicActionRequest(requestOwner)) {
        finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
        return;
      }
      try {
        let imageUrl = '';
        if (isLinuxDoActionTopic(detail)) {
          const result = await runLinuxDoRequest(
            () => buildLinuxDoImageUploadRequest({ file }),
            '',
            { owner: requestOwner, key: actionKey, notifySuccess: false, diagnosticTrace }
          );
          if (!result || !isCurrentTopicActionRequest(requestOwner)) {
            if (result) {
              finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            }
            return;
          }
          imageUrl = linuxDoImageUrlFromUploadResponse(result);
        } else if (isYaohuoActionTopic(detail)) {
          const run = startActionRun(actionKey, true);
          try {
            markDiagnosticStage(diagnosticTrace, 'credential', {
              source: detail.source,
              credentialSource: 'none',
              state: 'not-required',
              hasCredential: false,
              requestType: 'image-upload',
              csrfSource: 'none'
            });
            markDiagnosticStage(diagnosticTrace, 'transport', { source: detail.source, state: 'start' });
            imageUrl = await uploadYaohuoReplyImage({
              fetcher: withDiagnosticFetcher(diagnosticTrace, fetcher),
              file,
              signal: run.controller.signal
            });
            markDiagnosticStage(diagnosticTrace, 'transport', { source: detail.source, state: 'confirmed', serverConfirmed: Boolean(imageUrl) });
          } finally {
            finishActionRun(run, true);
          }
          if (!isCurrentTopicActionRequest(requestOwner)) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            return;
          }
        } else if (isNodeSeekActionTopic(detail)) {
          const run = startActionRun(actionKey, true);
          try {
            markDiagnosticStage(diagnosticTrace, 'transport', { source: detail.source, state: 'start' });
            imageUrl = await uploadNodeSeekReplyImageWithApiKey({
              ensureApiKey: (options) => options?.forceRefresh
                ? ensureNodeImageApiKey({ forceRefresh: true, clearOnCancel: true })
                : Promise.resolve(nodeSeekApiKey),
              fetcher: withDiagnosticFetcher(diagnosticTrace, fetcher),
              file,
              signal: run.controller.signal
            });
            markDiagnosticStage(diagnosticTrace, 'transport', { source: detail.source, state: 'confirmed', serverConfirmed: Boolean(imageUrl) });
          } finally {
            finishActionRun(run, true);
          }
          if (!isCurrentTopicActionRequest(requestOwner)) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            return;
          }
        }

        if (!imageUrl) {
          finishDiagnosticTrace(diagnosticTrace, 'failure', { source: detail.source, reason: 'invalid_response' });
          return;
        }
        const markup = replyImageMarkupForSource(detail.source, imageUrl, file.name);
        appendReplyMarkup(markup);
        markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', markupApplied: true });
        notify('图片已插入');
      } catch (error) {
        const reason = isSupersededRequest(error)
          ? 'superseded'
          : isCanceledRequest(error) ? 'canceled' : normalizeDiagnosticReason(error);
        finishDiagnosticTrace(
          diagnosticTrace,
          reason === 'superseded' ? 'stale' : reason === 'canceled' ? 'canceled' : 'failure',
          { source: detail.source, reason }
        );
        if (!isSilentRequestInterruption(error) && isCurrentTopicActionRequest(requestOwner)) {
          notify(errorMessage(error));
        }
      }
    }, diagnosticTrace);
  }, [appendReplyMarkup, ensureNodeImageApiKey, fetcher, finishActionRun, isCurrentTopicActionRequest, notify, runLinuxDoRequest, runSingleNonIdempotentTopicAction, selectedTopic, startActionRun, startTopicActionRequest, topicDetail]);

  const checkIn = useCallback(async () => {
    const diagnosticTrace = beginDiagnosticTrace('topic', 'attendance', { source: 'nodeseek' });
    const actionKey = nodeSeekAttendanceActionKey();
    await runSingleNonIdempotentTopicAction(actionKey, () => runNodeSeekRequest(
      () => buildNodeSeekAttendanceRequest({ random: false }),
      '签到请求已提交',
      { key: actionKey, diagnosticTrace }
    ), diagnosticTrace);
  }, [runNodeSeekRequest, runSingleNonIdempotentTopicAction]);

  const interact = useCallback(async (type: InteractionType, commentId?: number) => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('topic', 'interaction', {
      ...(actionSource ? { source: actionSource } : {}),
      action: type
    });
    if (!commentId) {
      notify('当前内容缺少评论 id，刷新主题后再试。');
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'not_ready' });
      return;
    }
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'not_ready' });
      return;
    }
    if (isLinuxDoActionTopic(detail)) {
      if (type !== 'like') {
        finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'unsupported' });
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
        finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'permission_denied' });
        return;
      }
      markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
      startOptimisticTopicAction({
        key: actionKey,
        requestOwner,
        currentActive: Boolean(target?.liked),
        applyDisplayed: (desiredActive) => {
          const patch = { commentId, type: 'like' as const, mode: desiredActive ? 'add' as const : 'remove' as const, reactionId: 'heart' };
          applyTopicActionUpdate({ type: 'interaction', patch });
        },
        sendDesired: async (desiredActive) => Boolean(await runLinuxDoActionForOptimisticUpdate(
          () => buildLinuxDoLikeRequest({ postId: commentId, liked: !desiredActive }),
          { owner: requestOwner, diagnosticTrace }
        )),
        successMessage: (active) => active ? '点赞已提交' : '已取消点赞',
        diagnosticTrace
      });
      return;
    }
    if (!isNodeSeekActionTopic(detail)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'unsupported' });
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
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'unsupported' });
      return;
    }
    const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: commentId, action: type });
    const requestOwner = startOptimisticTopicActionRequest(actionKey);
    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    startOptimisticTopicAction({
      key: actionKey,
      requestOwner,
      currentActive: Boolean(target?.[activeField]),
      applyDisplayed: (desiredActive) => {
        const patch = { commentId, type, mode: desiredActive ? 'add' as const : 'remove' as const };
        applyTopicActionUpdate({ type: 'interaction', patch });
      },
      sendDesired: (desiredActive) => runNodeSeekActionForOptimisticUpdate(
        () => buildNodeSeekInteractionRequest({ type, commentId, active: !desiredActive }),
        { owner: requestOwner, diagnosticTrace }
      ),
      successMessage: (active) => active
        ? type === 'upvote' ? '点赞已提交' : type === 'like' ? '加鸡腿请求已提交' : '反对已提交'
        : type === 'upvote' ? '已取消点赞' : type === 'like' ? '已取消鸡腿' : '已取消反对',
      diagnosticTrace
    });
  }, [applyTopicActionUpdate, notify, runLinuxDoActionForOptimisticUpdate, runNodeSeekActionForOptimisticUpdate, selectedTopic, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail, topicReplies]);

  const favoriteOnYaohuoSite = useCallback(async () => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('topic', 'favorite', actionSource ? { source: actionSource } : {});
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isYaohuoActionTopic(detail)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'unsupported' });
      return;
    }
    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    const requestTopicKey = topicKey(detail);
    const actionKey = yaohuoFavoriteActionKey(requestTopicKey);
    await runSingleNonIdempotentTopicAction(actionKey, () => runYaohuoRequest(
      () => buildYaohuoFavoriteRequest({
        topicId: detail.id,
        classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID
      }),
      '原站收藏已提交',
      { owner: startTopicActionRequest(actionKey), diagnosticTrace }
    ), diagnosticTrace);
  }, [runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

  const collectOnNodeSeekSite = useCallback(async () => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('topic', 'collection', actionSource ? { source: actionSource } : {});
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isNodeSeekActionTopic(detail)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'unsupported' });
      return;
    }
    const requestTopicKey = topicKey(detail);
    const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: detail.id, action: 'collection' });
    const requestOwner = startOptimisticTopicActionRequest(actionKey);
    const collected = Boolean((detail as TopicDetail).collected);
    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    startOptimisticTopicAction({
      key: actionKey,
      requestOwner,
      currentActive: collected,
      applyDisplayed: (desiredActive) => {
        applyTopicActionUpdate({ type: 'collection', collected: desiredActive });
      },
      sendDesired: (desiredActive) => runNodeSeekActionForOptimisticUpdate(
        () => buildNodeSeekCollectionRequest({
          postId: detail.id,
          collected: !desiredActive
        }),
        { owner: requestOwner, diagnosticTrace }
      ),
      successMessage: (active) => active ? '原站收藏已提交' : '已取消原站收藏',
      diagnosticTrace
    });
  }, [applyTopicActionUpdate, runNodeSeekActionForOptimisticUpdate, selectedTopic, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail]);

  const bookmarkOnLinuxDoSite = useCallback(async () => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('topic', 'bookmark', actionSource ? { source: actionSource } : {});
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!isLinuxDoActionTopic(detail)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'unsupported' });
      return;
    }
    const requestTopicKey = topicKey(detail);
    const bookmarked = Boolean((detail as TopicDetail).bookmarked);
    let bookmarkId = (detail as TopicDetail).bookmarkId;
    const actionKey = topicActionStateKey({ topicKey: requestTopicKey, targetId: detail.id, action: 'bookmark' });
    const requestOwner = startOptimisticTopicActionRequest(actionKey);
    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    startOptimisticTopicAction({
      key: actionKey,
      requestOwner,
      currentActive: bookmarked,
      applyDisplayed: (desiredActive) => {
        applyTopicActionUpdate({
          type: 'bookmark',
          bookmarked: desiredActive,
          bookmarkId: desiredActive ? bookmarkId : undefined
        });
      },
      sendDesired: async (desiredActive) => {
        const result = await runLinuxDoActionForOptimisticUpdate(
          () => buildLinuxDoBookmarkRequest({
            bookmarkableId: detail.id,
            bookmarkableType: 'Topic',
            bookmarked: !desiredActive,
            bookmarkId
          }),
          { owner: requestOwner, diagnosticTrace }
        );
        if (!result) {
          return false;
        }
        if (!desiredActive) {
          bookmarkId = undefined;
          if (isCurrentTopicActionRequest(requestOwner) && optimisticTopicActionsRef.current[actionKey]?.desired === true) {
            applyTopicActionUpdate({ type: 'bookmark', bookmarked: true });
          }
        }
        if (desiredActive) {
          const resultBookmarkId = linuxDoBookmarkIdFromActionResult(result);
          if (resultBookmarkId) {
            bookmarkId = resultBookmarkId;
            if (isCurrentTopicActionRequest(requestOwner) && optimisticTopicActionsRef.current[actionKey]?.desired === true) {
              applyTopicActionUpdate({ type: 'bookmark', bookmarked: true, bookmarkId });
            }
          }
        }
        return true;
      },
      successMessage: (active) => active ? '原站收藏已提交' : '已取消原站收藏',
      diagnosticTrace
    });
  }, [applyTopicActionUpdate, isCurrentTopicActionRequest, optimisticTopicActionsRef, runLinuxDoActionForOptimisticUpdate, selectedTopic, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail]);

  const votePoll = useCallback(async (poll: TopicPoll, optionIds: string[]) => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('topic', 'vote', {
      ...(actionSource ? { source: actionSource } : {}),
      selectedCount: optionIds.length
    });
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!canVotePollOnTopic(detail)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'not_ready' });
      return;
    }
    if (!optionIds.length) {
      notify('请选择投票选项');
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
      return;
    }
    markDiagnosticStage(diagnosticTrace, 'guard', { source: detail.source, hasOwner: true, isBusy: false });
    const requestTopicKey = topicKey(detail);
    const actionKey = topicPollVoteActionKey(requestTopicKey, poll);
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      let submitted: unknown = false;
      if (isNodeSeekActionTopic(detail)) {
        submitted = await runNodeSeekRequest(
          () => buildNodeSeekVoteRequest({ optionIds }),
          '投票已提交',
          { owner: requestOwner, diagnosticTrace }
        );
      } else if (isLinuxDoActionTopic(detail)) {
        if (!poll.postId || !poll.name) {
          notify('当前投票信息不完整，刷新主题后再试。');
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
          return;
        }
        submitted = await runLinuxDoRequest(
          () => buildLinuxDoPollVoteRequest({
            postId: poll.postId || '',
            pollName: poll.name || '',
            optionIds
          }),
          '投票已提交',
          { owner: requestOwner, diagnosticTrace }
        );
      } else {
        submitted = await runYaohuoRequest(
          () => buildYaohuoVoteRequest({
            topicId: detail.id,
            classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID,
            voteIds: optionIds
          }),
          '投票已提交',
          { owner: requestOwner, diagnosticTrace }
        );
      }
      if (submitted) {
        if (!isCurrentTopicActionRequest(requestOwner)) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
          return;
        }
        applyTopicActionUpdate({
          type: 'poll-vote',
          patch: {
          pollId: poll.id,
          pollName: poll.name,
          pollPostId: poll.postId,
          optionIds
          }
        });
        markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', localApplied: true });
      }
    }, diagnosticTrace);
  }, [applyTopicActionUpdate, isCurrentTopicActionRequest, notify, runLinuxDoRequest, runNodeSeekRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

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
