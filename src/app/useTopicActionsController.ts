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
  buildYaohuoDeleteFavoriteRequest,
  buildYaohuoFavoriteRequest,
  buildYaohuoDeleteReplyRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid,
  type YaohuoActionRequest
} from '../yaohuoActions';
import {
  type DiscourseAction,
  type DiscourseActionRequest
} from '../discourseActions';
import {
  buildDiscourseSourceActionRequest,
  discourseSourceUploadUrl
} from '../discourseSourceActions';
import { fetchNodeSeekVoteInfo, runNodeSeekAction } from '../nodeseekActionClient';
import { runYaohuoAction } from '../yaohuoActionClient';
import {
  discourseBookmarkIdFromActionResult,
  topicActionStateKey,
  type InteractionType,
  type OptimisticActionState
} from '../topicActionState';
import type { Reply, Source, TopicDetail, TopicPoll } from '../types';
import { topicKey } from '../readerData';
import type { TopicRepliesRefreshOptions } from '../appTypes';
import {
  DEFAULT_NODESEEK_ANDROID_USER_AGENT,
  NODESEEK_ACCESS_STORAGE_KEY,
  NODESEEK_COOKIE_STORAGE_KEY,
  NODESEEK_USER_AGENT_STORAGE_KEY,
  nodeSeekAccessRecord,
  parseNodeSeekAccessRecord
} from '../nodeseekCookies';
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
import { errorMessage, isCanceledRequest } from '../appUtils';
import { canToggleDiscourseLike } from '../discoursePermissions';
import {
  isDiscourseSource,
  isSessionSource,
  sourceValues,
  type DiscourseSource
} from '../sourceCatalog';
import {
  normalizeReplyImageAsset,
  replyImageMarkupForSource,
  replyImageUploadSupported,
  type NormalizedReplyImageAsset,
  uploadNodeSeekReplyImageWithApiKey,
  uploadYaohuoReplyImage
} from '../replyImageUpload';
import { currentNodeImageApiKeyGeneration } from '../nodeimageCredentials';
import { createSiteSessionViewModels, isSiteLoggedIn, type SiteSessionStates } from '../siteSessionState';
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
  runSingleTopicAction,
  isNodeSeekLoginRequiredError,
  runOptimisticActionQueue as runOptimisticActionQueueHelper
} from './topicActionHelpers';
import {
  prepareDiscourseActionRuntime,
  type DiscourseActionRuntimeDependencies,
  type DiscourseActionRuntimeRecovery,
  type PreparedDiscourseActionRuntime
} from './discourseActionRuntime';
import {
  canSubmitReplyToTopic,
  canVotePollOnTopic,
  currentTopicActionTopic,
  isTopicScopedActionKey,
  isNodeSeekActionTopic,
  isXiaoyinsiActionTopic,
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
  source: 'nodeseek' | 'linuxdo' | 'yaohuo' | 'xiaoyinsi',
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
  source: 'nodeseek' | 'linuxdo' | 'yaohuo' | 'xiaoyinsi',
  request: NodeSeekActionRequest | DiscourseActionRequest | YaohuoActionRequest,
  discourseCsrfSource: 'none' | 'session-endpoint' = 'none'
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
  if (isDiscourseSource(source)) {
    const requestType = path === '/posts.json' ? 'reply'
      : path === '/uploads.json' ? 'image-upload'
        : /^\/posts\/\d+\.json$/.test(path) ? request.method === 'PUT' ? 'edit' : 'delete'
          : path.startsWith('/post_actions') ? 'interaction'
            : path.startsWith('/bookmarks') ? 'bookmark'
              : path === '/polls/vote' ? 'vote'
                : 'unknown';
    return { requestType, csrfSource: discourseCsrfSource };
  }
  const requestType = path === '/bbs/book_re.aspx' ? 'reply'
    : path === '/bbs/book_re_del.aspx' ? 'delete'
      : path === '/bbs/share.aspx' || path === '/bbs/favlist.aspx' ? 'favorite'
        : path === '/bbs/book_view_tovote.aspx' ? 'vote'
          : 'unknown';
  return { requestType, csrfSource: 'none' };
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
  currentYaohuoCredentialGeneration,
  discourseActionRuntimeDependencies,
  discourseLoginPrompts,
  fetcher,
  loadYaohuoCookieForSource,
  nodeSeekWebViewUserAgentRef,
  ensureNodeImageApiKey,
  notify,
  optimisticTopicActionsRef,
  refreshTopicReplies,
  setActionBusy,
  setOptimisticTopicActions,
  showYaohuoLogin,
  siteSessionStates,
  topicActionRequestOwnerRef,
  topicSession
}: {
  actionAbortRef: Ref<{ abort: () => void; abortAll: () => void } | null>;
  clearNodeSeekLoginCookiesOnly: (options?: CredentialClearOptions) => Promise<void>;
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<boolean>;
  currentNodeSeekCredentialGeneration: () => number;
  currentYaohuoCredentialGeneration: () => number;
  discourseActionRuntimeDependencies: DiscourseActionRuntimeDependencies;
  discourseLoginPrompts: Record<DiscourseSource, (message?: string) => void>;
  fetcher: Fetcher;
  loadYaohuoCookieForSource: (source: 'yaohuo', options?: CredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  ensureNodeImageApiKey: (options?: { forceRefresh?: boolean; clearOnCancel?: boolean }) => Promise<string | null>;
  notify: (message: string) => void;
  optimisticTopicActionsRef: Ref<Record<string, OptimisticActionState>>;
  refreshTopicReplies: (options?: TopicRepliesRefreshOptions) => Promise<unknown>;
  setActionBusy: Dispatch<SetStateAction<boolean>>;
  setOptimisticTopicActions: Dispatch<SetStateAction<Record<string, OptimisticActionState>>>;
  showYaohuoLogin: (message?: string) => void;
  siteSessionStates: SiteSessionStates;
  topicActionRequestOwnerRef: Ref<RequestOwner>;
  topicSession: TopicSessionController;
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
  const sourceActionAvailability = Object.fromEntries(sourceValues.map((source) => [
    source,
    isSessionSource(source) && isSiteLoggedIn(siteSessionStates[source])
  ])) as Record<Source, boolean>;
  const canUseNodeSeekActions = sourceActionAvailability.nodeseek;
  const canUseYaohuoActions = sourceActionAvailability.yaohuo;
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
      if (refreshed === false || refreshed === 'failed' || refreshed === 'stale' || refreshed === 'verification-required') {
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
    const nodeSeekGeneration = currentNodeSeekCredentialGeneration();
    const isNodeSeekCredentialCurrent = () => currentNodeSeekCredentialGeneration() === nodeSeekGeneration;
    try {
      const access = await loadNodeSeekActionAccess();
      if (!isNodeSeekCredentialCurrent() || !isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return false;
      }
      const request = requestFactory();
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'credential', {
          source: 'nodeseek',
          state: 'ready',
          hasCredential: Boolean(access?.cookieHeader),
          credentialSource: 'secure-store',
          ...actionRequestDiagnosticFields('nodeseek', request)
        });
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'nodeseek', state: 'start' });
      }
      await runNodeSeekAction({
        cookieHeader: access?.cookieHeader || '',
        fetcher: diagnosticTrace ? withDiagnosticFetcher(diagnosticTrace, fetcher) : fetcher,
        request,
        signal: run.controller.signal,
        userAgent: access?.userAgent || nodeSeekWebViewUserAgentRef.current
      });
      if (!isNodeSeekCredentialCurrent() || !isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
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
      if (!isNodeSeekCredentialCurrent() || !isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner)) || isCanceledRequest(error)) {
        if (diagnosticTrace) {
          const reason = isCanceledRequest(error) ? 'canceled' : 'stale';
          finishDiagnosticTrace(diagnosticTrace, reason === 'canceled' ? 'canceled' : 'stale', { source: 'nodeseek', reason });
        }
        return false;
      }
      const diagnosticReason = normalizeDiagnosticReason(error);
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'transport', { source: 'nodeseek', state: 'failure', reason: diagnosticReason });
      }
      let failureMessage = errorMessage(error);
      if (isNodeSeekLoginRequiredError(error)) {
        try {
          await clearNodeSeekLoginCookiesOnly({
            generation: nodeSeekGeneration,
            expiredMessage: failureMessage
          });
        } catch (cleanupError) {
          failureMessage = `${failureMessage} 本机 Cookie 清理未完成，请重试。`;
          if (diagnosticTrace) {
            markDiagnosticStage(diagnosticTrace, 'persist', {
              source: 'nodeseek',
              store: 'multi-store',
              state: 'partial',
              reason: normalizeDiagnosticReason(cleanupError)
            });
          }
        }
        if (!isNodeSeekCredentialCurrent() || !isCurrentActionRun(run) || (requestOwner && !isCurrentTopicActionRequest(requestOwner))) {
          if (diagnosticTrace) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'nodeseek', reason: 'stale' });
          }
          return false;
        }
      }
      notify(actionMessage(failureMessage, options.restoreOnFailure));
      if (diagnosticTrace && !options.deferDiagnosticFailure) {
        finishDiagnosticTrace(diagnosticTrace, 'failure', { source: 'nodeseek', reason: diagnosticReason });
      }
      return false;
    } finally {
      finishActionRun(run, busy);
    }
  }, [canUseNodeSeekActions, clearNodeSeekLoginCookiesOnly, currentNodeSeekCredentialGeneration, fetcher, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, nodeSeekWebViewUserAgentRef, notify, siteSessionViewModels, startActionRun, startTopicActionRequest]);

  const runYaohuoRequest = useCallback(async (
    requestFactory: (cookieHeader: string) => YaohuoActionRequest,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    const diagnosticTrace = options.diagnosticTrace;
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
    const busy = options.busy ?? true;
    const run = startActionRun(options.key || requestOwner.action.key || success, busy);
    if (diagnosticTrace) {
      markDiagnosticStage(diagnosticTrace, 'guard', { source: 'yaohuo', hasOwner: true, isBusy: busy });
      markDiagnosticStage(diagnosticTrace, 'credential', { source: 'yaohuo', state: 'load' });
    }
    let yaohuoGeneration = currentYaohuoCredentialGeneration();
    const isYaohuoCredentialCurrent = () => currentYaohuoCredentialGeneration() === yaohuoGeneration;
    try {
      const cookieHeader = await loadYaohuoCookieForSource('yaohuo', {
        captureGeneration: (generation) => { yaohuoGeneration = generation; },
        diagnosticTrace
      });
      if (!isYaohuoCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
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
      if (!isYaohuoCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
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
      if (!isYaohuoCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        if (diagnosticTrace) {
          const reason = isCanceledRequest(error) ? 'canceled' : 'stale';
          finishDiagnosticTrace(diagnosticTrace, reason === 'canceled' ? 'canceled' : 'stale', { source: 'yaohuo', reason });
        }
        return false;
      }
      const diagnosticReason = normalizeDiagnosticReason(error);
      if (error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired) {
        let loginMessage = errorMessage(error);
        if ((error as { reason?: unknown }).reason === 'expired') {
          try {
            await clearYaohuoLoginState({
              generation: yaohuoGeneration,
              expiredMessage: loginMessage
            });
          } catch (cleanupError) {
            loginMessage = `${loginMessage} 本机 Cookie 清理未完成，请重试。`;
            if (diagnosticTrace) {
              markDiagnosticStage(diagnosticTrace, 'persist', {
                source: 'yaohuo',
                store: 'multi-store',
                state: 'partial',
                reason: normalizeDiagnosticReason(cleanupError)
              });
            }
          }
          if (!isYaohuoCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
            if (diagnosticTrace) {
              finishDiagnosticTrace(diagnosticTrace, 'stale', { source: 'yaohuo', reason: 'stale' });
            }
            return false;
          }
        }
        showYaohuoLogin(loginMessage);
        failDiagnosticActionRequest(options, 'yaohuo', 'credential', 'blocked', diagnosticReason);
        return false;
      }
      notify(errorMessage(error));
      failDiagnosticActionRequest(options, 'yaohuo', 'transport', 'failure', diagnosticReason);
      return false;
    } finally {
      finishActionRun(run, busy);
    }
  }, [canUseYaohuoActions, clearYaohuoLoginState, currentYaohuoCredentialGeneration, fetcher, finishActionRun, isCurrentActionRun, isCurrentTopicActionRequest, loadYaohuoCookieForSource, notify, showYaohuoLogin, siteSessionViewModels, startActionRun, startTopicActionRequest]);

  const runDiscourseRequest = useCallback(async (
    source: DiscourseSource,
    actionFactory: () => DiscourseAction,
    success: string,
    options: ActionRunOptions = {}
  ) => {
    const diagnosticTrace = options.diagnosticTrace;
    const loginPrompt = discourseLoginPrompts[source];
    if (!sourceActionAvailability[source]) {
      if (options.owner && !isCurrentTopicActionRequest(options.owner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source, reason: 'stale' });
        }
        return false;
      }
      const message = authActionMessageForSource(source, siteSessionViewModels);
      loginPrompt(actionMessage(message, options.restoreOnFailure));
      failDiagnosticActionRequest(options, source, 'credential', 'blocked', 'login_required');
      return false;
    }
    const actionKey = options.key || options.owner?.action.key || success || options.fallbackKey || `${source}-action`;
    const requestOwner = options.owner || startTopicActionRequest(actionKey);
    const busy = options.busy ?? true;
    const run = startActionRun(actionKey, busy);
    let runtime: PreparedDiscourseActionRuntime | undefined;
    const isRuntimeCredentialCurrent = () => runtime?.isCredentialCurrent?.() !== false;
    if (diagnosticTrace) {
      markDiagnosticStage(diagnosticTrace, 'guard', { source, hasOwner: true, isBusy: busy });
      markDiagnosticStage(diagnosticTrace, 'credential', { source, state: 'load' });
    }
    try {
      runtime = await prepareDiscourseActionRuntime(source, {
        ...discourseActionRuntimeDependencies,
        fetcher: diagnosticTrace ? withDiagnosticFetcher(diagnosticTrace, fetcher) : fetcher
      });
      if (!isRuntimeCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source, reason: 'stale' });
        }
        return false;
      }
      if (!runtime.credentialReady || !runtime.execute) {
        runtime.onMissingCredential?.();
        const message = authActionMessageForSource(source, siteSessionViewModels);
        loginPrompt(actionMessage(message, options.restoreOnFailure));
        failDiagnosticActionRequest(options, source, 'credential', 'blocked', 'missing_credential');
        return false;
      }
      const request = buildDiscourseSourceActionRequest(source, actionFactory());
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'credential', {
          source,
          state: 'ready',
          hasCredential: true,
          credentialSource: runtime.credentialSource,
          ...actionRequestDiagnosticFields(source, request, runtime.csrfSource)
        });
        markDiagnosticStage(diagnosticTrace, 'transport', { source, state: 'start' });
      }
      const result = await runtime.execute(request, run.controller.signal);
      if (!isRuntimeCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source, reason: 'stale' });
        }
        return false;
      }
      if (diagnosticTrace) {
        markDiagnosticStage(diagnosticTrace, 'transport', { source, state: 'confirmed', serverConfirmed: true });
      }
      if (options.notifySuccess !== false && success) {
        notify(success);
      }
      return result ?? true;
    } catch (error) {
      if (!isRuntimeCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner) || isCanceledRequest(error)) {
        if (diagnosticTrace) {
          const reason = isCanceledRequest(error) ? 'canceled' : 'stale';
          finishDiagnosticTrace(diagnosticTrace, reason === 'canceled' ? 'canceled' : 'stale', { source, reason });
        }
        return false;
      }
      const diagnosticReason = normalizeDiagnosticReason(error);
      const loginRequired = Boolean(error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired);
      let recoveryFailure: unknown;
      let recovery: DiscourseActionRuntimeRecovery;
      try {
        recovery = runtime
          ? await runtime.recover(error)
          : { loginRequired, phase: loginRequired ? 'credential' : 'transport' };
      } catch (recoverError) {
        recoveryFailure = recoverError;
        recovery = {
          loginRequired,
          phase: loginRequired || source === 'xiaoyinsi' ? 'credential' : 'transport'
        };
        if (diagnosticTrace) {
          markDiagnosticStage(diagnosticTrace, 'credential', {
            source,
            state: 'partial',
            reason: normalizeDiagnosticReason(recoverError)
          });
        }
      }
      if (recovery.stale || !isRuntimeCredentialCurrent() || !isCurrentActionRun(run) || !isCurrentTopicActionRequest(requestOwner)) {
        if (diagnosticTrace) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source, reason: 'stale' });
        }
        return false;
      }
      const recoveryMessage = recoveryFailure
        ? `${errorMessage(error)} ${source === 'linuxdo'
          ? '本机 Cookie 清理未完成，请重试。'
          : '授权状态复核未完成，请重试。'}`
        : errorMessage(error);
      if (recovery.loginRequired) {
        loginPrompt(actionMessage(recoveryMessage, options.restoreOnFailure));
        failDiagnosticActionRequest(options, source, 'credential', 'blocked', diagnosticReason);
        return false;
      }
      notify(actionMessage(recoveryMessage, options.restoreOnFailure));
      failDiagnosticActionRequest(options, source, recovery.phase, 'failure', diagnosticReason);
      return false;
    } finally {
      finishActionRun(run, busy);
    }
  }, [
    discourseActionRuntimeDependencies,
    discourseLoginPrompts,
    fetcher,
    finishActionRun,
    isCurrentActionRun,
    isCurrentTopicActionRequest,
    notify,
    siteSessionViewModels,
    sourceActionAvailability,
    startActionRun,
    startTopicActionRequest
  ]);

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

  const runDiscourseActionForOptimisticUpdate = useCallback(async (
    source: DiscourseSource,
    actionFactory: () => DiscourseAction,
    options: ActionRunOptions = {}
  ) => runDiscourseRequest(source, actionFactory, '', {
    ...options,
    busy: false,
    deferDiagnosticFailure: true,
    fallbackKey: 'discourse-optimistic',
    notifySuccess: false,
    restoreOnFailure: true
  }), [runDiscourseRequest]);

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
    const canEditExistingDiscourseReply = Boolean(
      detail
      && isDiscourseSource(detail.source)
      && replyEditTarget
    );
    if (!detail || (!canEditExistingDiscourseReply && !canSubmitReplyToTopic(detail))) {
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
      if (!isNodeSeekActionTopic(detail) && !isDiscourseSource(detail.source)) {
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
            () => buildNodeSeekEditReplyRequest({ commentId: replyEditTarget.commentId, content: replyContent, csrfToken: '' }),
            '回复已更新',
            { owner: requestOwner, diagnosticTrace }
          )
          : await runDiscourseRequest(
              detail.source as DiscourseSource,
              () => ({ type: 'edit-post', postId: replyEditTarget.commentId, content: replyContent }),
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
          if (isXiaoyinsiActionTopic(detail)) {
            completeReplySubmission();
          } else {
            completeReplySubmission({ editedReplyContent, source: detail.source });
          }
          markDiagnosticStage(diagnosticTrace, 'apply', isXiaoyinsiActionTopic(detail)
            ? { source: detail.source, state: 'server-refresh-start' }
            : { source: detail.source, state: 'local', localApplied: true });
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
      if (isDiscourseSource(detail.source)) {
        const submitted = await runDiscourseRequest(
          detail.source,
          () => ({
            type: 'reply',
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
          markDiagnosticStage(diagnosticTrace, 'apply', detail.source === 'xiaoyinsi'
            ? { source: detail.source, state: 'server-refresh-start' }
            : { source: detail.source, state: 'local', localApplied: true });
          await refreshTopicRepliesAfterWrite(diagnosticTrace, { silent: true, afterSubmit: true });
        }
        return;
      }
      const submitted = await runNodeSeekRequest(
        () => buildNodeSeekReplyRequest({ postId: detail.id, content: replyContent, replyTarget, csrfToken: '' }),
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
  }, [completeReplySubmission, isCurrentTopicActionRequest, notify, refreshTopicRepliesAfterWrite, replyContent, replyEditTarget, replyFace, replyTarget, runDiscourseRequest, runNodeSeekRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

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
      } else if (isDiscourseSource(detail.source)) {
        if (!reply.commentId) {
          notify('当前回复缺少评论 id，刷新主题后再试。');
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
          return;
        }
        deleted = await runDiscourseRequest(
          detail.source,
          () => ({ type: 'delete-post', postId: reply.commentId || 0 }),
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
  }, [applyTopicActionUpdate, isCurrentTopicActionRequest, notify, refreshTopicRepliesAfterWrite, runDiscourseRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

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
    const canEditExistingXiaoyinsiReply = Boolean(
      detail
      && isXiaoyinsiActionTopic(detail)
      && replyEditTarget
    );
    if (!detail || (!canEditExistingXiaoyinsiReply && !canSubmitReplyToTopic(detail))) {
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
      let nodeImageCredentialGeneration: number | undefined;
      const isNodeImageCredentialCurrent = () => nodeImageCredentialGeneration === undefined
        || currentNodeImageApiKeyGeneration() === nodeImageCredentialGeneration;
      if (isNodeSeekActionTopic(detail)) {
        markDiagnosticStage(diagnosticTrace, 'credential', { source: detail.source, credentialSource: 'nodeimage', state: 'load' });
        nodeSeekApiKey = await ensureNodeImageApiKey();
        nodeImageCredentialGeneration = currentNodeImageApiKeyGeneration();
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
      if (!isCurrentTopicActionRequest(requestOwner) || !isNodeImageCredentialCurrent()) {
        finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
        return;
      }
      const uploadRun = startActionRun(`${actionKey}:lifecycle`, true);
      try {
        let imageUrl = '';
        if (isDiscourseSource(detail.source)) {
          const result = await runDiscourseRequest(
            detail.source,
            () => ({ type: 'upload', file }),
            '',
            { owner: requestOwner, key: actionKey, busy: false, notifySuccess: false, diagnosticTrace }
          );
          if (!result || !isCurrentTopicActionRequest(requestOwner)) {
            if (result) {
              finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            }
            return;
          }
          imageUrl = discourseSourceUploadUrl(detail.source, result);
        } else if (isYaohuoActionTopic(detail)) {
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
            signal: uploadRun.controller.signal
          });
          markDiagnosticStage(diagnosticTrace, 'transport', { source: detail.source, state: 'confirmed', serverConfirmed: Boolean(imageUrl) });
          if (!isCurrentTopicActionRequest(requestOwner)) {
            finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
            return;
          }
        } else if (isNodeSeekActionTopic(detail)) {
          markDiagnosticStage(diagnosticTrace, 'transport', { source: detail.source, state: 'start' });
          imageUrl = await uploadNodeSeekReplyImageWithApiKey({
            ensureApiKey: async (options) => {
              if (!options?.forceRefresh) {
                return nodeSeekApiKey;
              }
              const refreshedApiKey = await ensureNodeImageApiKey({ forceRefresh: true, clearOnCancel: true });
              if (refreshedApiKey) {
                nodeImageCredentialGeneration = currentNodeImageApiKeyGeneration();
              }
              return refreshedApiKey;
            },
            fetcher: withDiagnosticFetcher(diagnosticTrace, fetcher),
            file,
            signal: uploadRun.controller.signal
          });
          markDiagnosticStage(diagnosticTrace, 'transport', { source: detail.source, state: 'confirmed', serverConfirmed: Boolean(imageUrl) });
          if (!isCurrentTopicActionRequest(requestOwner) || !isNodeImageCredentialCurrent()) {
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
        if (!isNodeImageCredentialCurrent()) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
          return;
        }
        const reason = isCanceledRequest(error) ? 'canceled' : normalizeDiagnosticReason(error);
        finishDiagnosticTrace(diagnosticTrace, reason === 'canceled' ? 'canceled' : 'failure', { source: detail.source, reason });
        if (!isCanceledRequest(error) && isCurrentTopicActionRequest(requestOwner)) {
          notify(errorMessage(error));
        }
      } finally {
        finishActionRun(uploadRun, true);
      }
    }, diagnosticTrace);
  }, [appendReplyMarkup, ensureNodeImageApiKey, fetcher, finishActionRun, isCurrentTopicActionRequest, notify, replyEditTarget, runDiscourseRequest, runSingleNonIdempotentTopicAction, selectedTopic, startActionRun, startTopicActionRequest, topicDetail]);

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
    if (isDiscourseSource(detail.source)) {
      const discourseSource = detail.source;
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
      if (!canToggleDiscourseLike(target)) {
        notify('当前帖子不能点赞');
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
        sendDesired: async (desiredActive) => Boolean(await runDiscourseActionForOptimisticUpdate(
          discourseSource,
          () => ({ type: 'set-like', postId: commentId, active: desiredActive }),
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
  }, [applyTopicActionUpdate, notify, runDiscourseActionForOptimisticUpdate, runNodeSeekActionForOptimisticUpdate, selectedTopic, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail, topicReplies]);

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
    const favoriteDetail = detail as TopicDetail;
    const bookmarked = Boolean(favoriteDetail.bookmarked);
    if (bookmarked && !favoriteDetail.bookmarkId) {
      notify('当前收藏记录不完整，请刷新主题后再试。');
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
      return;
    }
    await runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      const result = await runYaohuoRequest(
        () => bookmarked
          ? buildYaohuoDeleteFavoriteRequest({ favoriteId: favoriteDetail.bookmarkId || 0 })
          : buildYaohuoFavoriteRequest({
            topicId: detail.id,
            classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID
          }),
        bookmarked ? '已取消原站收藏' : '原站收藏已提交',
        { owner: requestOwner, busy: false, diagnosticTrace }
      );
      if (!result || !isCurrentTopicActionRequest(requestOwner)) {
        if (result) {
          finishDiagnosticTrace(diagnosticTrace, 'stale', { source: detail.source, reason: 'stale' });
        }
        return;
      }
      if (!bookmarked && !result.favoriteId) {
        failDiagnosticActionRequest({ diagnosticTrace }, 'yaohuo', 'transport', 'failure', 'invalid_response');
        return;
      }
      applyTopicActionUpdate({
        type: 'bookmark',
        bookmarked: !bookmarked,
        bookmarkId: bookmarked ? undefined : result.favoriteId
      });
      markDiagnosticStage(diagnosticTrace, 'apply', { source: detail.source, state: 'local', localApplied: true });
    }, diagnosticTrace);
  }, [applyTopicActionUpdate, isCurrentTopicActionRequest, notify, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

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

  const bookmarkOnDiscourseSite = useCallback(async () => {
    const actionSource = topicDetail?.source || selectedTopic?.source;
    const diagnosticTrace = beginDiagnosticTrace('topic', 'bookmark', actionSource ? { source: actionSource } : {});
    const detail = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!detail || !isDiscourseSource(detail.source)) {
      finishDiagnosticTrace(diagnosticTrace, 'blocked', { reason: 'unsupported' });
      return;
    }
    const discourseSource = detail.source;
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
        const result = await runDiscourseActionForOptimisticUpdate(
          discourseSource,
          () => ({
            type: 'set-bookmark',
            targetId: detail.id,
            targetType: 'Topic',
            active: desiredActive,
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
          const resultBookmarkId = discourseBookmarkIdFromActionResult(result);
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
  }, [applyTopicActionUpdate, isCurrentTopicActionRequest, optimisticTopicActionsRef, runDiscourseActionForOptimisticUpdate, selectedTopic, startOptimisticTopicAction, startOptimisticTopicActionRequest, topicDetail]);

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
    const submitVote = () => runSingleNonIdempotentTopicAction(actionKey, async () => {
      const requestOwner = startTopicActionRequest(actionKey);
      let submitted: unknown = false;
      let confirmedPoll: TopicPoll | undefined;
      let resultRefreshFailed = false;
      if (isNodeSeekActionTopic(detail)) {
        submitted = await runNodeSeekRequest(
          () => buildNodeSeekVoteRequest({ optionIds }),
          '',
          { owner: requestOwner, diagnosticTrace, notifySuccess: false }
        );
        if (submitted) {
          try {
            if (!poll.id) {
              throw new Error('投票 id 不正确');
            }
            const access = await loadNodeSeekActionAccess();
            if (!access?.cookieHeader) {
              throw new Error('NodeSeek 登录信息不可用');
            }
            confirmedPoll = await fetchNodeSeekVoteInfo({
              cookieHeader: access.cookieHeader,
              pollId: poll.id,
              fetcher: withDiagnosticFetcher(diagnosticTrace, fetcher),
              userAgent: access.userAgent || nodeSeekWebViewUserAgentRef.current
            });
          } catch {
            resultRefreshFailed = true;
          }
        }
      } else if (isDiscourseSource(detail.source)) {
        if (!poll.postId || !poll.name) {
          notify('当前投票信息不完整，刷新主题后再试。');
          finishDiagnosticTrace(diagnosticTrace, 'blocked', { source: detail.source, reason: 'not_ready' });
          return;
        }
        submitted = await runDiscourseRequest(
          detail.source,
          () => ({
            type: 'vote',
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
            optionIds,
            ...(confirmedPoll ? { confirmedPoll } : {}),
            ...(resultRefreshFailed ? { preserveUnknownCounts: true } : {})
          }
        });
        markDiagnosticStage(diagnosticTrace, 'apply', {
          source: detail.source,
          state: confirmedPoll ? 'server' : 'local',
          localApplied: true,
          ...(confirmedPoll ? { serverConfirmed: true } : {})
        });
        if (isNodeSeekActionTopic(detail)) {
          if (resultRefreshFailed) {
            notify('提交成功但结果刷新失败，请手动刷新。');
            finishDiagnosticTrace(diagnosticTrace, 'partial', { source: detail.source, reason: 'refresh_failed' });
          } else {
            notify('投票已提交');
          }
        }
      }
    }, diagnosticTrace);
    if (isNodeSeekActionTopic(detail)) {
      let resolved = false;
      const cancelVote = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        finishDiagnosticTrace(diagnosticTrace, 'canceled', { source: detail.source, reason: 'canceled' });
      };
      Alert.alert('确认提交投票？', '提交后不可修改。', [
        {
          text: '取消',
          style: 'cancel',
          onPress: cancelVote
        },
        {
          text: '提交',
          style: 'destructive',
          onPress: () => {
            if (resolved) {
              return;
            }
            resolved = true;
            void submitVote();
          }
        }
      ], {
        cancelable: true,
        onDismiss: cancelVote
      });
      return;
    }
    await submitVote();
  }, [applyTopicActionUpdate, fetcher, isCurrentTopicActionRequest, nodeSeekWebViewUserAgentRef, notify, runDiscourseRequest, runNodeSeekRequest, runSingleNonIdempotentTopicAction, runYaohuoRequest, selectedTopic, startTopicActionRequest, topicDetail]);

  return {
    bookmarkOnDiscourseSite,
    checkIn,
    collectOnNodeSeekSite,
    deleteReply,
    favoriteOnYaohuoSite,
    interact,
    submitReply,
    sourceActionAvailability,
    uploadReplyImage,
    votePoll
  };
}
