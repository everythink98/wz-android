import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import {
  useMutation,
  useMutationState,
  useQueryClient,
  type InfiniteData,
  type QueryKey
} from '@tanstack/react-query';
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
  buildYaohuoDeleteReplyRequest,
  buildYaohuoFavoriteRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid,
  type YaohuoActionRequest
} from '../yaohuoActions';
import type { DiscourseAction } from '../discourseActions';
import { buildDiscourseSourceActionRequest, discourseSourceUploadUrl } from '../discourseSourceActions';
import { fetchNodeSeekVoteInfo, runNodeSeekAction } from '../nodeseekActionClient';
import { runYaohuoAction, type YaohuoActionResult } from '../yaohuoActionClient';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyNodeSeekCollectionToTopic,
  applyPollVoteToReplies,
  applyPollVoteToTopic,
  discourseBookmarkIdFromActionResult,
  topicActionStateKey,
  type InteractionType,
  type OptimisticActionState
} from '../topicActionState';
import type { Reply, Source, TopicDetail, TopicPoll } from '../types';
import type { TopicRepliesRefreshOptions } from '../appTypes';
import { topicKey } from '../readerData';
import {
  DEFAULT_NODESEEK_ANDROID_USER_AGENT,
  NODESEEK_ACCESS_STORAGE_KEY,
  NODESEEK_COOKIE_STORAGE_KEY,
  NODESEEK_USER_AGENT_STORAGE_KEY,
  nodeSeekAccessRecord,
  parseNodeSeekAccessRecord
} from '../nodeseekCookies';
import type { Fetcher } from '../request';
import { errorMessage } from '../appUtils';
import { canToggleDiscourseLike } from '../discoursePermissions';
import { isDiscourseSource, isSessionSource, sourceValues, type DiscourseSource } from '../sourceCatalog';
import {
  normalizeReplyImageAsset,
  replyImageMarkupForSource,
  replyImageUploadSupported,
  uploadNodeSeekReplyImageWithApiKey,
  uploadYaohuoReplyImage
} from '../replyImageUpload';
import { currentNodeImageApiKeyGeneration } from '../nodeimageCredentials';
import type { ScopedSiteSessionEvent, SiteSessionViewModels } from '../siteSessionState';
import { authActionMessageForSource } from '../siteSessionPrompts';
import { useCommittedRef } from './useCommittedRef';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticTrace
} from '../diagnostics';
import type { CredentialLoadOptions } from './sessionControllerHelpers';
import type { TopicSessionController } from './useTopicSessionController';
import {
  forumMutationKeys,
  forumQueryKeys,
  type ForumCredentialScope
} from './serverState';
import {
  prepareDiscourseActionRuntime,
  type DiscourseActionRuntimeDependencies
} from './discourseActionRuntime';
import {
  canSubmitReplyToTopic,
  canVotePollOnTopic,
  currentTopicActionTopic,
  applyEditedReplyContent,
  isNodeSeekActionTopic,
  isXiaoyinsiActionTopic,
  isYaohuoActionTopic,
  topicEditReplyActionKey,
  topicPollVoteActionKey,
  topicReplyActionKey,
  yaohuoFavoriteActionKey,
  YAOHUO_DEFAULT_CLASS_ID
} from './topicActionControllerHelpers';

type Ref<T> = { current: T };
type ReplyCache = InfiniteData<{ items: Reply[]; [key: string]: unknown }, unknown>;

type MutationVariables = {
  actionKey: string;
  busy: boolean;
  credential: number;
  detailKey: QueryKey;
  repliesKey: QueryKey;
  source: Source;
  task: () => Promise<unknown>;
  topicId: string;
  trace: DiagnosticTrace;
  applyOptimistic?: () => void;
  applyResult?: (result: unknown) => void;
  afterSuccess?: (result: unknown) => Promise<boolean>;
  successMessage?: string | ((result: unknown) => string);
};

type AttendanceMutationVariables = {
  credential: number;
  trace: DiagnosticTrace;
};

class HandledMutationError extends Error {
  constructor(
    message: string,
    readonly outcome: 'blocked' | 'canceled' | 'failure' | 'stale',
    readonly reason: string
  ) {
    super(message);
  }
}

function credentialValue(source: Source, scope: ForumCredentialScope) {
  return source === 'v2ex' ? 0 : scope[source];
}

function mutationFailure(error: unknown, outcome: HandledMutationError['outcome'] = 'failure') {
  if (error instanceof HandledMutationError) return error;
  return new HandledMutationError(errorMessage(error), outcome, normalizeDiagnosticReason(error));
}

function topicDeleteReplyActionKey(topicKeyValue: string, reply: Reply) {
  return `delete-reply:${topicKeyValue}:${reply.commentId ?? reply.deletePath ?? reply.floor ?? 'reply'}`;
}

async function loadNodeSeekActionAccess() {
  const savedAccess = parseNodeSeekAccessRecord(await SecureStore.getItemAsync(NODESEEK_ACCESS_STORAGE_KEY));
  if (savedAccess) return savedAccess;
  const [cookieHeader, userAgent] = await Promise.all([
    SecureStore.getItemAsync(NODESEEK_COOKIE_STORAGE_KEY),
    SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY)
  ]);
  return cookieHeader ? nodeSeekAccessRecord(cookieHeader, userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT) : null;
}

function updateReplyCache(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: QueryKey,
  update: (replies: Reply[]) => Reply[]
) {
  queryClient.setQueryData<ReplyCache>(queryKey, (current) => current ? {
    ...current,
    pages: current.pages.map((page) => ({ ...page, items: update(page.items) }))
  } : current);
}

export function useTopicActionsController({
  credentialScope,
  currentNodeSeekCredentialGeneration,
  currentYaohuoCredentialGeneration,
  dispatchSiteSessionEvent,
  discourseActionRuntimeDependencies,
  discourseLoginPrompts,
  ensureNodeImageApiKey,
  fetcher,
  loadYaohuoCookieForSource,
  nodeSeekWebViewUserAgentRef,
  notify,
  refreshTopicReplies,
  showYaohuoLogin,
  siteSessionViewModels,
  topicDetail,
  topicReplies,
  topicSession
}: {
  credentialScope: ForumCredentialScope;
  currentNodeSeekCredentialGeneration: () => number;
  currentYaohuoCredentialGeneration: () => number;
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  discourseActionRuntimeDependencies: DiscourseActionRuntimeDependencies;
  discourseLoginPrompts: Record<DiscourseSource, (message?: string) => void>;
  ensureNodeImageApiKey: (options?: { forceRefresh?: boolean; clearOnCancel?: boolean }) => Promise<string | null>;
  fetcher: Fetcher;
  loadYaohuoCookieForSource: (source: 'yaohuo', options?: CredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  refreshTopicReplies: (options?: TopicRepliesRefreshOptions) => Promise<unknown>;
  showYaohuoLogin: (message?: string) => void;
  siteSessionViewModels: SiteSessionViewModels;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicSession: TopicSessionController;
}) {
  const queryClient = useQueryClient();
  const credentialScopeRef = useCommittedRef(credentialScope);
  const {
    state: { replyContent, replyEditTarget, replyFace, replyTarget, selectedTopic },
    commands: { composer: topicComposer, topic: topicCommands }
  } = topicSession;
  const detail = currentTopicActionTopic(topicDetail, selectedTopic);
  const mutationSource = detail?.source || 'nodeseek';
  const mutationTopicId = detail?.id || 'global';
  const mutationKey = useMemo(
    () => forumMutationKeys.topic(mutationSource, mutationTopicId),
    [mutationSource, mutationTopicId]
  );
  const mutationScope = `forum:${mutationSource}:topic:${mutationTopicId}`;
  const sourceActionAvailability = Object.fromEntries(sourceValues.map((source) => [
    source,
    isSessionSource(source) && siteSessionViewModels[source].canWrite
  ])) as Record<Source, boolean>;

  const mutation = useMutation<unknown, unknown, MutationVariables>({
    mutationKey,
    scope: { id: mutationScope },
    mutationFn: async (variables) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: variables.detailKey, exact: true }),
        queryClient.cancelQueries({ queryKey: variables.repliesKey, exact: true })
      ]);
      const previousDetail = variables.applyOptimistic
        ? queryClient.getQueryData<TopicDetail>(variables.detailKey)
        : undefined;
      const previousReplies = variables.applyOptimistic
        ? queryClient.getQueryData<ReplyCache>(variables.repliesKey)
        : undefined;
      variables.applyOptimistic?.();
      markDiagnosticStage(variables.trace, 'apply', {
        source: variables.source,
        state: variables.applyOptimistic ? 'optimistic' : 'pending',
        localApplied: Boolean(variables.applyOptimistic)
      });
      try {
        return await variables.task();
      } catch (error) {
        const failure = mutationFailure(error);
        const credentialIsCurrent = credentialValue(variables.source, credentialScopeRef.current) === variables.credential;
        if (variables.applyOptimistic && credentialIsCurrent && failure.outcome !== 'stale') {
          if (previousDetail) queryClient.setQueryData(variables.detailKey, previousDetail);
          if (previousReplies) queryClient.setQueryData(variables.repliesKey, previousReplies);
          markDiagnosticStage(variables.trace, 'rollback', { source: variables.source, state: 'local' });
        }
        throw error;
      }
    },
    onSuccess: async (result, variables) => {
      if (credentialValue(variables.source, credentialScopeRef.current) !== variables.credential) {
        finishDiagnosticTrace(variables.trace, 'stale', { source: variables.source, reason: 'stale' });
        return;
      }
      variables.applyResult?.(result);
      const refreshed = await variables.afterSuccess?.(result);
      const message = typeof variables.successMessage === 'function'
        ? variables.successMessage(result)
        : variables.successMessage;
      if (message) notify(message);
      finishDiagnosticTrace(variables.trace, refreshed === false ? 'partial' : 'success', {
        source: variables.source,
        serverConfirmed: true,
        ...(refreshed === false ? { reason: 'refresh_failed' } : {})
      });
    },
    onError: (error, variables) => {
      const failure = mutationFailure(error);
      const credentialIsCurrent = credentialValue(variables.source, credentialScopeRef.current) === variables.credential;
      if (credentialIsCurrent && !(error instanceof HandledMutationError)) notify(failure.message);
      finishDiagnosticTrace(variables.trace, credentialIsCurrent ? failure.outcome : 'stale', {
        source: variables.source,
        reason: credentialIsCurrent ? failure.reason : 'stale'
      });
    }
  });

  const pendingVariables = useMutationState<MutationVariables>({
    filters: { mutationKey, status: 'pending' },
    select: (entry) => entry.state.variables as MutationVariables
  });
  const optimisticTopicActions = useMemo<Record<string, OptimisticActionState>>(() => Object.fromEntries(
    pendingVariables
      .filter((variables) => variables?.applyOptimistic)
      .map((variables) => [variables.actionKey, {
        inFlight: true
      }])
  ), [pendingVariables]);

  const cacheKeys = useCallback((actionTopic: TopicDetail) => {
    const detailKey = forumQueryKeys.topic({
      source: actionTopic.source,
      topicId: actionTopic.id,
      scope: credentialScopeRef.current
    });
    return { detailKey, repliesKey: forumQueryKeys.replies(detailKey) };
  }, []);

  const refreshRepliesAfterWrite = useCallback(async (
    actionTopic: TopicDetail,
    trace: DiagnosticTrace,
    options: TopicRepliesRefreshOptions
  ) => {
    if (topicCommands.getCurrentKey() !== topicKey(actionTopic)) {
      const { detailKey, repliesKey } = cacheKeys(actionTopic);
      queryClient.removeQueries({ queryKey: repliesKey, exact: true });
      queryClient.removeQueries({ queryKey: detailKey, exact: true });
      markDiagnosticStage(trace, 'apply', { source: actionTopic.source, state: 'cache-removed' });
      return true;
    }
    const outcome = await refreshTopicReplies({ ...options, diagnosticTrace: trace });
    return outcome === 'completed' || outcome === true;
  }, [cacheKeys, queryClient, refreshTopicReplies, topicCommands]);

  const executeMutation = useCallback(async (
    actionTopic: TopicDetail,
    variables: Omit<MutationVariables, 'credential' | 'detailKey' | 'repliesKey' | 'source' | 'topicId'>
  ) => {
    const duplicate = queryClient.getMutationCache().getAll().some((entry) => {
      const pending = entry.state.variables as MutationVariables | undefined;
      return entry.state.status === 'pending'
        && pending?.actionKey === variables.actionKey
        && pending.source === actionTopic.source
        && pending.topicId === actionTopic.id;
    });
    if (duplicate) return false;
    const keys = cacheKeys(actionTopic);
    try {
      await mutation.mutateAsync({
        ...variables,
        ...keys,
        credential: credentialValue(actionTopic.source, credentialScopeRef.current),
        source: actionTopic.source,
        topicId: actionTopic.id
      });
      return true;
    } catch {
      return false;
    }
  }, [cacheKeys, credentialScopeRef, mutation.mutateAsync, queryClient]);

  const runNodeSeekRequest = useCallback(async (request: NodeSeekActionRequest, trace: DiagnosticTrace) => {
    if (!sourceActionAvailability.nodeseek) {
      notify(authActionMessageForSource('nodeseek', siteSessionViewModels));
      throw new HandledMutationError('NodeSeek 未登录', 'blocked', 'login_required');
    }
    const generation = currentNodeSeekCredentialGeneration();
    const access = await loadNodeSeekActionAccess();
    if (generation !== currentNodeSeekCredentialGeneration()) {
      throw new HandledMutationError('凭据已变化', 'stale', 'stale');
    }
    markDiagnosticStage(trace, 'credential', {
      source: 'nodeseek',
      state: 'ready',
      hasCredential: Boolean(access?.cookieHeader),
      credentialSource: 'secure-store'
    });
    try {
      await runNodeSeekAction({
        cookieHeader: access?.cookieHeader || '',
        fetcher: withDiagnosticFetcher(trace, fetcher),
        request,
        userAgent: nodeSeekWebViewUserAgentRef.current || access?.userAgent
      });
    } catch (error) {
      if (generation !== currentNodeSeekCredentialGeneration()) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      const loginRequired = Boolean(error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired);
      const message = errorMessage(error);
      if (generation !== currentNodeSeekCredentialGeneration()) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      if (loginRequired) {
        dispatchSiteSessionEvent({ site: 'nodeseek', type: 'login-expired', message });
      }
      notify(message);
      throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
    }
    if (generation !== currentNodeSeekCredentialGeneration()) {
      throw new HandledMutationError('凭据已变化', 'stale', 'stale');
    }
    markDiagnosticStage(trace, 'transport', { source: 'nodeseek', state: 'confirmed', serverConfirmed: true });
    return true;
  }, [currentNodeSeekCredentialGeneration, dispatchSiteSessionEvent, fetcher, nodeSeekWebViewUserAgentRef, notify, siteSessionViewModels, sourceActionAvailability.nodeseek]);

  const attendanceMutation = useMutation<unknown, unknown, AttendanceMutationVariables>({
    mutationKey: forumMutationKeys.topic('nodeseek', 'global'),
    scope: { id: 'forum:nodeseek:topic:global' },
    mutationFn: ({ trace }) => runNodeSeekRequest(
      buildNodeSeekAttendanceRequest({ random: false }),
      trace
    ),
    onSuccess: (_result, variables) => {
      if (credentialScopeRef.current.nodeseek !== variables.credential) {
        finishDiagnosticTrace(variables.trace, 'stale', { source: 'nodeseek', reason: 'stale' });
        return;
      }
      notify('签到请求已提交');
      finishDiagnosticTrace(variables.trace, 'success', { source: 'nodeseek', serverConfirmed: true });
    },
    onError: (error, variables) => {
      const current = credentialScopeRef.current.nodeseek === variables.credential;
      const failure = mutationFailure(error);
      if (current && !(error instanceof HandledMutationError)) notify(failure.message);
      finishDiagnosticTrace(variables.trace, current ? failure.outcome : 'stale', {
        source: 'nodeseek',
        reason: current ? failure.reason : 'stale'
      });
    }
  });
  const actionBusy = attendanceMutation.isPending
    || pendingVariables.some((variables) => variables?.busy !== false);

  const runYaohuoRequest = useCallback(async (
    requestFactory: (cookieHeader: string) => YaohuoActionRequest,
    trace: DiagnosticTrace
  ) => {
    if (!sourceActionAvailability.yaohuo) {
      showYaohuoLogin(authActionMessageForSource('yaohuo', siteSessionViewModels));
      throw new HandledMutationError('妖火未登录', 'blocked', 'login_required');
    }
    let generation = currentYaohuoCredentialGeneration();
    const cookieHeader = await loadYaohuoCookieForSource('yaohuo', {
      captureGeneration: (value) => { generation = value; },
      diagnosticTrace: trace
    });
    if (generation !== currentYaohuoCredentialGeneration()) {
      throw new HandledMutationError('凭据已变化', 'stale', 'stale');
    }
    if (!cookieHeader) {
      showYaohuoLogin(authActionMessageForSource('yaohuo', siteSessionViewModels));
      throw new HandledMutationError('妖火登录信息不可用', 'blocked', 'missing_credential');
    }
    try {
      const result = await runYaohuoAction({
        cookieHeader,
        fetcher: withDiagnosticFetcher(trace, fetcher),
        request: requestFactory(cookieHeader)
      });
      if (generation !== currentYaohuoCredentialGeneration()) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      if (result.message === '操作结果无法确认，请刷新原帖核对') {
        notify(result.message);
        throw new HandledMutationError(result.message, 'failure', 'invalid_response');
      }
      markDiagnosticStage(trace, 'transport', { source: 'yaohuo', state: 'confirmed', serverConfirmed: true });
      return result;
    } catch (error) {
      if (error instanceof HandledMutationError) throw error;
      if (generation !== currentYaohuoCredentialGeneration()) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      const failure = error && typeof error === 'object'
        ? error as { loginRequired?: unknown; reason?: unknown }
        : {};
      const loginRequired = Boolean(failure.loginRequired);
      const message = errorMessage(error);
      if (loginRequired) {
        if (generation !== currentYaohuoCredentialGeneration()) {
          throw new HandledMutationError('凭据已变化', 'stale', 'stale');
        }
        dispatchSiteSessionEvent({
          site: 'yaohuo',
          type: failure.reason === 'verification' ? 'verification-required' : 'login-expired',
          message
        });
        showYaohuoLogin(message);
        throw new HandledMutationError(message, 'blocked', 'login_required');
      }
      notify(message);
      throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
    }
  }, [currentYaohuoCredentialGeneration, dispatchSiteSessionEvent, fetcher, loadYaohuoCookieForSource, notify, showYaohuoLogin, siteSessionViewModels, sourceActionAvailability.yaohuo]);

  const runDiscourseRequest = useCallback(async (
    source: DiscourseSource,
    action: DiscourseAction,
    trace: DiagnosticTrace
  ) => {
    const loginPrompt = discourseLoginPrompts[source];
    if (!sourceActionAvailability[source]) {
      loginPrompt(authActionMessageForSource(source, siteSessionViewModels));
      throw new HandledMutationError(`${source} 未登录`, 'blocked', 'login_required');
    }
    const runtime = await prepareDiscourseActionRuntime(source, {
      ...discourseActionRuntimeDependencies,
      fetcher: withDiagnosticFetcher(trace, fetcher)
    });
    if (runtime.isCredentialCurrent?.() === false) {
      throw new HandledMutationError('凭据已变化', 'stale', 'stale');
    }
    if (!runtime.credentialReady || !runtime.execute) {
      runtime.onMissingCredential?.();
      loginPrompt(authActionMessageForSource(source, siteSessionViewModels));
      throw new HandledMutationError('登录信息不可用', 'blocked', 'missing_credential');
    }
    try {
      const result = await runtime.execute(buildDiscourseSourceActionRequest(source, action));
      if (runtime.isCredentialCurrent?.() === false) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      markDiagnosticStage(trace, 'transport', { source, state: 'confirmed', serverConfirmed: true });
      return result ?? true;
    } catch (error) {
      if (error instanceof HandledMutationError) throw error;
      if (runtime.isCredentialCurrent?.() === false) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      let recovery;
      let recoveryError: unknown;
      try {
        recovery = await runtime.recover(error);
      } catch (errorDuringRecovery) {
        recoveryError = errorDuringRecovery;
        recovery = { loginRequired: false, phase: 'credential' as const };
      }
      if (recovery.stale || runtime.isCredentialCurrent?.() === false) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      const originalMessage = errorMessage(error);
      const recoveryMessage = recoveryError ? errorMessage(recoveryError) : '';
      const message = recoveryError
        ? `${originalMessage}；${recoveryMessage.includes('复核未完成')
          ? recoveryMessage
          : `授权状态复核未完成：${recoveryMessage}`}`
        : originalMessage;
      if (recovery.loginRequired) {
        const promptMessage = recovery.message || message;
        loginPrompt(promptMessage);
        throw new HandledMutationError(promptMessage, 'blocked', 'login_required');
      }
      notify(message);
      throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
    }
  }, [discourseActionRuntimeDependencies, discourseLoginPrompts, fetcher, notify, siteSessionViewModels, sourceActionAvailability]);

  const updateInteraction = useCallback((actionTopic: TopicDetail, patch: Parameters<typeof applyInteractionToTopic>[1]) => {
    const { detailKey, repliesKey } = cacheKeys(actionTopic);
    queryClient.setQueryData<TopicDetail>(detailKey, (current) => applyInteractionToTopic(current || null, patch) || current);
    updateReplyCache(queryClient, repliesKey, (replies) => applyInteractionToReplies(replies, patch));
  }, [cacheKeys, queryClient]);

  const submitReply = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('reply', replyEditTarget ? 'edit' : 'submit', {
      ...(actionTopic ? { source: actionTopic.source } : {}),
      contentLength: replyContent.length
    });
    const canEditDiscourseReply = Boolean(actionTopic && isDiscourseSource(actionTopic.source) && replyEditTarget);
    if (!actionTopic || (!canEditDiscourseReply && !canSubmitReplyToTopic(actionTopic))) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
    if (!replyContent.trim()) {
      notify('请输入回复内容');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
      return;
    }
    const actionTopicKey = topicKey(actionTopic);
    if (replyEditTarget) {
      if (!isNodeSeekActionTopic(actionTopic) && !isDiscourseSource(actionTopic.source)) {
        notify('当前来源暂不支持编辑回复');
        finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
        return;
      }
      const edit = { ...replyEditTarget, contentMarkdown: replyContent };
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: topicEditReplyActionKey(actionTopicKey, replyEditTarget.commentId),
        busy: true,
        trace,
        task: () => isNodeSeekActionTopic(actionTopic)
          ? runNodeSeekRequest(buildNodeSeekEditReplyRequest({ commentId: edit.commentId, content: edit.contentMarkdown, csrfToken: '' }), trace)
          : runDiscourseRequest(actionTopic.source as DiscourseSource, {
              type: 'edit-post', postId: edit.commentId, content: edit.contentMarkdown
            }, trace),
        applyResult: () => {
          const { repliesKey } = cacheKeys(actionTopic as TopicDetail);
          updateReplyCache(queryClient, repliesKey, (replies) => applyEditedReplyContent(replies, edit, actionTopic.source));
          void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true });
          if (topicCommands.getCurrentKey() === actionTopicKey) topicComposer.completeSubmission();
        },
        afterSuccess: () => refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
          silent: true,
          afterSubmit: true,
          targetReply: replyEditTarget,
          editedReplyContent: edit
        }),
        successMessage: '回复已更新'
      });
      return;
    }
    if (isYaohuoActionTopic(actionTopic) && replyTarget && !replyTarget.authorId) {
      notify('当前楼层缺少用户 id，刷新主题后再试。');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
      return;
    }
    const content = replyContent;
    const face = replyFace;
    const target = replyTarget;
    await executeMutation(actionTopic as TopicDetail, {
      actionKey: topicReplyActionKey(actionTopicKey),
      busy: true,
      trace,
      task: () => isYaohuoActionTopic(actionTopic)
        ? runYaohuoRequest((cookieHeader) => buildYaohuoReplyRequest({
            topicId: actionTopic.id,
            classId: actionTopic.categoryId || YAOHUO_DEFAULT_CLASS_ID,
            content,
            face,
            sid: extractYaohuoSid(cookieHeader),
            replyFloor: target?.floor,
            toUserId: target?.authorId
          }), trace)
        : isDiscourseSource(actionTopic.source)
          ? runDiscourseRequest(actionTopic.source, {
              type: 'reply', topicId: actionTopic.id, content, replyToPostNumber: target?.floor
            }, trace)
          : runNodeSeekRequest(buildNodeSeekReplyRequest({ postId: actionTopic.id, content, replyTarget: target, csrfToken: '' }), trace),
      applyResult: () => {
        if (topicCommands.getCurrentKey() === actionTopicKey) topicComposer.completeSubmission();
        const { detailKey, repliesKey } = cacheKeys(actionTopic as TopicDetail);
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
        void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true });
      },
      afterSuccess: () => refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
        silent: true,
        afterSubmit: true
      }),
      successMessage: '回复已提交'
    });
  }, [cacheKeys, executeMutation, notify, queryClient, refreshRepliesAfterWrite, replyContent, replyEditTarget, replyFace, replyTarget, runDiscourseRequest, runNodeSeekRequest, runYaohuoRequest, selectedTopic, topicCommands, topicComposer, topicDetail]);

  const deleteReplyConfirmed = useCallback(async (reply: Reply, trace: DiagnosticTrace) => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    if (!actionTopic || !reply.canDelete) {
      notify(actionTopic ? '当前回复不能删除' : '主题尚未加载');
      finishDiagnosticTrace(trace, 'blocked', { reason: actionTopic ? 'permission_denied' : 'not_ready' });
      return;
    }
    if (isNodeSeekActionTopic(actionTopic)) {
      notify('NodeSeek 原站没有删除评论入口');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
      return;
    }
    if (isYaohuoActionTopic(actionTopic) && !reply.deletePath) {
      notify('当前回复缺少删除链接，刷新主题后再试。');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
      return;
    }
    if (isDiscourseSource(actionTopic.source) && !reply.commentId) {
      notify('当前回复缺少评论 id，刷新主题后再试。');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
      return;
    }
    const actionTopicKey = topicKey(actionTopic);
    const patch = () => {
      const { detailKey, repliesKey } = cacheKeys(actionTopic as TopicDetail);
      updateReplyCache(queryClient, repliesKey, (replies) => replies.filter((item) => (
        reply.commentId ? item.commentId !== reply.commentId : item.floor !== reply.floor
      )));
      queryClient.setQueryData<TopicDetail>(detailKey, (current) => current ? {
        ...current,
        replyCount: Math.max(0, current.replyCount - 1),
        replies: current.replies.filter((item) => reply.commentId ? item.commentId !== reply.commentId : item.floor !== reply.floor)
      } : current);
    };
    await executeMutation(actionTopic as TopicDetail, {
      actionKey: topicDeleteReplyActionKey(actionTopicKey, reply),
      busy: true,
      trace,
      task: () => isYaohuoActionTopic(actionTopic)
        ? runYaohuoRequest((cookieHeader) => buildYaohuoDeleteReplyRequest({
            deletePath: reply.deletePath || '', sid: extractYaohuoSid(cookieHeader)
          }), trace)
        : runDiscourseRequest(actionTopic.source as DiscourseSource, {
            type: 'delete-post', postId: reply.commentId || 0
          }, trace),
      applyOptimistic: patch,
      applyResult: () => {
        const { repliesKey } = cacheKeys(actionTopic as TopicDetail);
        void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true });
      },
      afterSuccess: () => refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
        silent: true,
        afterSubmit: true,
        targetReply: reply,
        excludeReply: reply
      }),
      successMessage: '回复已删除'
    });
  }, [cacheKeys, executeMutation, notify, queryClient, refreshRepliesAfterWrite, runDiscourseRequest, runYaohuoRequest, selectedTopic, topicDetail]);

  const deleteReply = useCallback((reply: Reply) => {
    const trace = beginDiagnosticTrace('reply', 'delete', detail ? { source: detail.source } : {});
    if (!reply.canDelete) {
      notify('当前回复不能删除');
      finishDiagnosticTrace(trace, 'blocked', { reason: 'permission_denied' });
      return;
    }
    let handled = false;
    Alert.alert('删除回复', '确认删除这条回复？', [
      { text: '取消', style: 'cancel', onPress: () => {
        handled = true;
        finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
      } },
      { text: '删除', style: 'destructive', onPress: () => {
        handled = true;
        void deleteReplyConfirmed(reply, trace);
      } }
    ], {
      cancelable: true,
      onDismiss: () => {
        if (!handled) finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
      }
    });
  }, [deleteReplyConfirmed, detail, notify]);

  const uploadReplyImage = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('reply', 'image-upload', actionTopic ? { source: actionTopic.source } : {});
    const canEditXiaoyinsiReply = Boolean(actionTopic && isXiaoyinsiActionTopic(actionTopic) && replyEditTarget);
    if (!actionTopic || (!canEditXiaoyinsiReply && !canSubmitReplyToTopic(actionTopic))) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
    if (!replyImageUploadSupported(actionTopic.source)) {
      notify('当前来源暂不支持上传图片');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
      return;
    }
    const actionTopicKey = topicKey(actionTopic);
    await executeMutation(actionTopic as TopicDetail, {
      actionKey: `${topicReplyActionKey(actionTopicKey)}:image`,
      busy: true,
      trace,
      task: async () => {
        let nodeSeekApiKey: string | null = null;
        let nodeImageGeneration: number | undefined;
        if (isNodeSeekActionTopic(actionTopic)) {
          nodeSeekApiKey = await ensureNodeImageApiKey();
          nodeImageGeneration = currentNodeImageApiKeyGeneration();
          if (!nodeSeekApiKey) throw new HandledMutationError('NodeImage 授权不可用', 'blocked', 'missing_credential');
        }
        const picked = await DocumentPicker.getDocumentAsync({
          type: 'image/*', copyToCacheDirectory: true, multiple: false
        });
        if (picked.canceled || !picked.assets?.[0]) {
          throw new HandledMutationError('已取消选择', 'canceled', 'canceled');
        }
        const file = normalizeReplyImageAsset(picked.assets[0]);
        let imageUrl = '';
        if (isDiscourseSource(actionTopic.source)) {
          const result = await runDiscourseRequest(actionTopic.source, { type: 'upload', file }, trace);
          imageUrl = discourseSourceUploadUrl(actionTopic.source, result);
        } else if (isYaohuoActionTopic(actionTopic)) {
          imageUrl = await uploadYaohuoReplyImage({ fetcher: withDiagnosticFetcher(trace, fetcher), file });
        } else if (isNodeSeekActionTopic(actionTopic)) {
          imageUrl = await uploadNodeSeekReplyImageWithApiKey({
            ensureApiKey: async (options) => {
              if (!options?.forceRefresh) return nodeSeekApiKey;
              const refreshed = await ensureNodeImageApiKey({ forceRefresh: true, clearOnCancel: true });
              if (refreshed) nodeImageGeneration = currentNodeImageApiKeyGeneration();
              return refreshed;
            },
            fetcher: withDiagnosticFetcher(trace, fetcher),
            file
          });
          if (nodeImageGeneration !== currentNodeImageApiKeyGeneration()) {
            throw new HandledMutationError('NodeImage 凭据已变化', 'stale', 'stale');
          }
        }
        if (!imageUrl) throw new HandledMutationError('图片上传结果不正确', 'failure', 'invalid_response');
        return { imageUrl, name: file.name };
      },
      applyResult: (result) => {
        if (topicCommands.getCurrentKey() !== actionTopicKey) return;
        const uploaded = result as { imageUrl: string; name: string };
        topicComposer.appendMarkup(replyImageMarkupForSource(actionTopic.source, uploaded.imageUrl, uploaded.name));
      },
      successMessage: '图片已插入'
    });
  }, [ensureNodeImageApiKey, executeMutation, fetcher, notify, replyEditTarget, runDiscourseRequest, selectedTopic, topicCommands, topicComposer, topicDetail]);

  const checkIn = useCallback(async () => {
    const trace = beginDiagnosticTrace('topic', 'attendance', { source: 'nodeseek' });
    try {
      await attendanceMutation.mutateAsync({
        credential: credentialScopeRef.current.nodeseek,
        trace
      });
    } catch {
      // Error reporting and diagnostics are owned by the mutation callbacks.
    }
  }, [attendanceMutation.mutateAsync, credentialScopeRef]);

  const interact = useCallback(async (type: InteractionType, commentId?: number) => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('topic', 'interaction', {
      ...(actionTopic ? { source: actionTopic.source } : {}), action: type
    });
    if (!actionTopic || !commentId) {
      notify('当前内容缺少评论 id，刷新主题后再试。');
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
    const target = [topicDetail, ...topicReplies].find((item) => item?.commentId === commentId);
    if (isDiscourseSource(actionTopic.source)) {
      if (type !== 'like' || !canToggleDiscourseLike(target)) {
        notify(type === 'like' ? '当前帖子不能点赞' : '当前来源暂不支持此操作');
        finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
        return;
      }
      const desired = !Boolean(target?.liked);
      const actionKey = topicActionStateKey({ topicKey: topicKey(actionTopic), targetId: commentId, action: 'like' });
      const patch = { commentId, type: 'like' as const, mode: desired ? 'add' as const : 'remove' as const, reactionId: 'heart' };
      await executeMutation(actionTopic as TopicDetail, {
        actionKey,
        busy: false,
        trace,
        applyOptimistic: () => updateInteraction(actionTopic as TopicDetail, patch),
        task: () => runDiscourseRequest(actionTopic.source as DiscourseSource, {
          type: 'set-like', postId: commentId, active: desired
        }, trace),
        successMessage: desired ? '点赞已提交' : '已取消点赞'
      });
      return;
    }
    if (!isNodeSeekActionTopic(actionTopic)) {
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
      return;
    }
    const fields = { upvote: 'upvoted', like: 'liked', dislike: 'disliked' } as const;
    if (target?.[fields[type]]) {
      notify(nodeSeekInteractionRemovalMessage(type));
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
      return;
    }
    const actionKey = topicActionStateKey({ topicKey: topicKey(actionTopic), targetId: commentId, action: type });
    const patch = { commentId, type, mode: 'add' as const };
    await executeMutation(actionTopic as TopicDetail, {
      actionKey,
      busy: false,
      trace,
      applyOptimistic: () => updateInteraction(actionTopic as TopicDetail, patch),
      task: () => runNodeSeekRequest(buildNodeSeekInteractionRequest({ type, commentId, active: false }), trace),
      successMessage: type === 'upvote' ? '点赞已提交' : type === 'like' ? '加鸡腿请求已提交' : '反对已提交'
    });
  }, [executeMutation, notify, runDiscourseRequest, runNodeSeekRequest, selectedTopic, topicDetail, topicReplies, updateInteraction]);

  const favoriteOnYaohuoSite = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('topic', 'favorite', actionTopic ? { source: actionTopic.source } : {});
    if (!isYaohuoActionTopic(actionTopic)) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'unsupported' });
      return;
    }
    const actionDetail = actionTopic as TopicDetail;
    const bookmarked = Boolean(actionDetail.bookmarked);
    if (bookmarked && !actionDetail.bookmarkId) {
      notify('当前收藏记录不完整，请刷新主题后再试。');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
      return;
    }
    const patch = (active: boolean, bookmarkId?: number) => {
      const { detailKey } = cacheKeys(actionDetail);
      queryClient.setQueryData<TopicDetail>(detailKey, (current) => applyBookmarkToTopic(current || null, {
        bookmarked: active, bookmarkId
      }) || current);
    };
    await executeMutation(actionDetail, {
      actionKey: yaohuoFavoriteActionKey(topicKey(actionTopic)),
      busy: false,
      trace,
      applyOptimistic: () => patch(!bookmarked, bookmarked ? undefined : actionDetail.bookmarkId),
      task: () => runYaohuoRequest(() => bookmarked
        ? buildYaohuoDeleteFavoriteRequest({ favoriteId: actionDetail.bookmarkId || 0 })
        : buildYaohuoFavoriteRequest({
            topicId: actionTopic.id,
            classId: actionTopic.categoryId || YAOHUO_DEFAULT_CLASS_ID
          }), trace),
      applyResult: (result) => patch(!bookmarked, bookmarked ? undefined : (result as YaohuoActionResult).favoriteId),
      successMessage: bookmarked ? '已取消原站收藏' : '原站收藏已提交'
    });
  }, [cacheKeys, executeMutation, notify, queryClient, runYaohuoRequest, selectedTopic, topicDetail]);

  const collectOnNodeSeekSite = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('topic', 'collection', actionTopic ? { source: actionTopic.source } : {});
    if (!isNodeSeekActionTopic(actionTopic)) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'unsupported' });
      return;
    }
    const actionDetail = actionTopic as TopicDetail;
    const collected = Boolean(actionDetail.collected);
    const patch = () => {
      const { detailKey } = cacheKeys(actionDetail);
      queryClient.setQueryData<TopicDetail>(detailKey, (current) => applyNodeSeekCollectionToTopic(current || null, {
        collected: !collected
      }) || current);
    };
    await executeMutation(actionDetail, {
      actionKey: topicActionStateKey({ topicKey: topicKey(actionTopic), targetId: actionTopic.id, action: 'collection' }),
      busy: false,
      trace,
      applyOptimistic: patch,
      task: () => runNodeSeekRequest(buildNodeSeekCollectionRequest({ postId: actionTopic.id, collected }), trace),
      successMessage: collected ? '已取消原站收藏' : '原站收藏已提交'
    });
  }, [cacheKeys, executeMutation, queryClient, runNodeSeekRequest, selectedTopic, topicDetail]);

  const bookmarkOnDiscourseSite = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('topic', 'bookmark', actionTopic ? { source: actionTopic.source } : {});
    if (!actionTopic || !isDiscourseSource(actionTopic.source)) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'unsupported' });
      return;
    }
    const actionDetail = actionTopic as TopicDetail;
    const bookmarked = Boolean(actionDetail.bookmarked);
    const patch = (active: boolean, bookmarkId?: number) => {
      const { detailKey } = cacheKeys(actionDetail);
      queryClient.setQueryData<TopicDetail>(detailKey, (current) => applyBookmarkToTopic(current || null, {
        bookmarked: active, bookmarkId
      }) || current);
    };
    await executeMutation(actionDetail, {
      actionKey: topicActionStateKey({ topicKey: topicKey(actionTopic), targetId: actionTopic.id, action: 'bookmark' }),
      busy: false,
      trace,
      applyOptimistic: () => patch(!bookmarked, bookmarked ? undefined : actionDetail.bookmarkId),
      task: () => runDiscourseRequest(actionTopic.source as DiscourseSource, {
        type: 'set-bookmark',
        targetId: actionTopic.id,
        targetType: 'Topic',
        active: !bookmarked,
        bookmarkId: actionDetail.bookmarkId
      }, trace),
      applyResult: (result) => patch(!bookmarked, bookmarked ? undefined : discourseBookmarkIdFromActionResult(result)),
      successMessage: bookmarked ? '已取消原站收藏' : '原站收藏已提交'
    });
  }, [cacheKeys, executeMutation, queryClient, runDiscourseRequest, selectedTopic, topicDetail]);

  const votePoll = useCallback(async (poll: TopicPoll, optionIds: string[]) => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('topic', 'vote', {
      ...(actionTopic ? { source: actionTopic.source } : {}), selectedCount: optionIds.length
    });
    if (!canVotePollOnTopic(actionTopic) || !optionIds.length) {
      if (!optionIds.length) notify('请选择投票选项');
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
    const submit = async () => {
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: topicPollVoteActionKey(topicKey(actionTopic), poll),
        busy: true,
        trace,
        task: async () => {
          if (isNodeSeekActionTopic(actionTopic)) {
            await runNodeSeekRequest(buildNodeSeekVoteRequest({ optionIds }), trace);
            try {
              if (!poll.id) throw new Error('投票 id 不正确');
              const access = await loadNodeSeekActionAccess();
              if (!access?.cookieHeader) throw new Error('NodeSeek 登录信息不可用');
              const confirmedPoll = await fetchNodeSeekVoteInfo({
                cookieHeader: access.cookieHeader,
                pollId: poll.id,
                fetcher: withDiagnosticFetcher(trace, fetcher),
                userAgent: nodeSeekWebViewUserAgentRef.current || access.userAgent
              });
              return { confirmedPoll, refreshFailed: false };
            } catch {
              hintDiagnosticOutcome(trace, 'partial', {
                source: 'nodeseek',
                reason: 'refresh_failed'
              });
              return { confirmedPoll: undefined, refreshFailed: true };
            }
          }
          if (isDiscourseSource(actionTopic.source)) {
            if (!poll.postId || !poll.name) {
              throw new HandledMutationError('当前投票信息不完整，刷新主题后再试。', 'blocked', 'not_ready');
            }
            await runDiscourseRequest(actionTopic.source, {
              type: 'vote', postId: poll.postId, pollName: poll.name, optionIds
            }, trace);
          } else {
            await runYaohuoRequest(() => buildYaohuoVoteRequest({
              topicId: actionTopic.id,
              classId: actionTopic.categoryId || YAOHUO_DEFAULT_CLASS_ID,
              voteIds: optionIds
            }), trace);
          }
          return { confirmedPoll: undefined, refreshFailed: false };
        },
        applyResult: (result) => {
          const voteResult = result as { confirmedPoll?: TopicPoll; refreshFailed: boolean };
          const patch = {
            pollId: poll.id,
            pollName: poll.name,
            pollPostId: poll.postId,
            optionIds,
            ...(voteResult.confirmedPoll ? { confirmedPoll: voteResult.confirmedPoll } : {}),
            ...(voteResult.refreshFailed ? { preserveUnknownCounts: true } : {})
          };
          const { detailKey, repliesKey } = cacheKeys(actionTopic as TopicDetail);
          queryClient.setQueryData<TopicDetail>(detailKey, (current) => applyPollVoteToTopic(current || null, patch) || current);
          updateReplyCache(queryClient, repliesKey, (replies) => applyPollVoteToReplies(replies, patch));
          if (voteResult.refreshFailed) notify('提交成功但结果刷新失败，请手动刷新。');
        },
        successMessage: (result) => (result as { refreshFailed: boolean }).refreshFailed ? '' : '投票已提交'
      });
    };
    if (!isNodeSeekActionTopic(actionTopic)) {
      await submit();
      return;
    }
    let handled = false;
    Alert.alert('确认提交投票？', '提交后不可修改。', [
      { text: '取消', style: 'cancel', onPress: () => {
        handled = true;
        finishDiagnosticTrace(trace, 'canceled', { source: actionTopic.source, reason: 'canceled' });
      } },
      { text: '提交', style: 'destructive', onPress: () => {
        if (handled) return;
        handled = true;
        void submit();
      } }
    ], {
      cancelable: true,
      onDismiss: () => {
        if (!handled) finishDiagnosticTrace(trace, 'canceled', { source: actionTopic.source, reason: 'canceled' });
      }
    });
  }, [cacheKeys, executeMutation, fetcher, nodeSeekWebViewUserAgentRef, notify, queryClient, runDiscourseRequest, runNodeSeekRequest, runYaohuoRequest, selectedTopic, topicDetail]);

  return {
    actionBusy,
    bookmarkOnDiscourseSite,
    checkIn,
    collectOnNodeSeekSite,
    deleteReply,
    favoriteOnYaohuoSite,
    interact,
    optimisticTopicActions,
    sourceActionAvailability,
    submitReply,
    uploadReplyImage,
    votePoll
  };
}
