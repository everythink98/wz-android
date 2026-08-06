import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useMutation, useMutationState, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import {
  buildNodeSeekCollectionRequest,
  buildNodeSeekEditReplyRequest,
  buildNodeSeekInteractionRequest,
  buildNodeSeekReplyRequest,
  buildNodeSeekVoteRequest,
  type NodeSeekActionRequest
} from '@/sources/nodeseek/actionRequest';
import {
  buildYaohuoDeleteFavoriteRequest,
  buildYaohuoDeleteReplyRequest,
  buildYaohuoFavoriteRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid,
  type YaohuoActionRequest
} from '@/sources/yaohuo/actionRequest';
import type { DiscourseAction } from '@/sources/discourse/actionRequest';
import { buildDiscourseSourceActionRequest, discourseSourceUploadUrl } from '@/sources/discourseActions';
import { fetchNodeSeekVoteInfo, runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { runYaohuoAction, type YaohuoActionResult } from '@/sources/yaohuo/actionClient';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyNodeSeekCollectionToTopic,
  applyPollVoteToReplies,
  applyPollVoteToTopic,
  discourseBookmarkIdFromActionResult,
  topicActionStateKey,
  type InteractionType
} from '@/domain/forum/topicActionState';
import type { Reply, Source, TopicDetail, TopicPoll } from '@/domain/forum/models';
import type { ReplyEditTarget, ReplyRefreshCommand } from '../model/types';
import { topicKey } from '@/domain/reader/readerData';
import type { Fetcher } from '@/platform/network/request';
import { errorMessage } from '@/platform/network/errors';
import { canToggleDiscourseLike } from '@/sources/discourse/permissions';
import {
  isDiscourseSource,
  isSessionSource,
  sourceUsesTopicCreatePermission,
  type DiscourseSource
} from '@/domain/forum/sourceCatalog';
import { normalizeReplyImageAsset, replyImageMarkupForSource, replyImageUploadSupported } from '@/sources/imageUpload';
import { isNodeImageApiKeyExpiredError, uploadNodeSeekReplyImageWithApiKey } from '@/sources/nodeimage/upload';
import { uploadYaohuoReplyImage } from '@/sources/yaohuo/imageUpload';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import type { SessionSite, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { authActionMessageForSource } from '@/domain/session/siteSessionPrompts';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import type { TopicSessionController } from '../useTopicSessionController';
import { forumMutationKeys, forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { prepareDiscourseActionRuntime, type DiscourseActionRuntimeDependencies } from './discourseActionRuntime';
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
} from './actionHelpers';
import {
  WritableSessionBlockedError,
  type WritableSessionReconcileResult,
  type WritableSessionTicket
} from '@/domain/session/writableSessionGate';
import { readManagedCookieHeader } from '@/platform/network/managedCookies';
import { YAOHUO_BASE_URL } from '@/sources/yaohuo/protocol';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import {
  decideTopicAction,
  topicActionDecisionMessage,
  type TopicActionDecisionFor,
  type TopicActionDecisionRequest
} from './topicActionDecision';

type ReplyCache = InfiniteData<{ items: Reply[]; [key: string]: unknown }, unknown>;

const REPLY_ORDERS = ['oldest', 'newest'] as const;

function replyCacheKeys(detailKey: QueryKey) {
  return REPLY_ORDERS.map((order) => forumQueryKeys.replies(detailKey, order));
}

type MutationVariables = {
  actionKey: string;
  busy: boolean;
  decision: TopicActionDecisionRequest;
  ticket: WritableSessionTicket;
  detailKey: QueryKey;
  repliesKey: QueryKey;
  source: Source;
  task: (ticket: WritableSessionTicket) => Promise<unknown>;
  topicId: string;
  trace: DiagnosticTrace;
  editTarget?: ReplyEditTarget;
  applyOptimistic?: () => void | (() => void);
  applyResult?: (result: unknown, variables: MutationVariables) => void;
  afterSuccess?: (result: unknown, variables: MutationVariables) => Promise<boolean>;
  successMessage?: string | ((result: unknown) => string);
};

const NODEIMAGE_API_KEY_UNAVAILABLE_MESSAGE = 'NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴';

class HandledMutationError extends Error {
  constructor(
    message: string,
    readonly outcome: 'blocked' | 'canceled' | 'failure' | 'stale',
    readonly reason: string,
    readonly serverConfirmed = false
  ) {
    super(message);
  }
}

function mutationFailure(error: unknown, outcome: HandledMutationError['outcome'] = 'failure') {
  if (error instanceof HandledMutationError) return error;
  return new HandledMutationError(errorMessage(error), outcome, normalizeDiagnosticReason(error));
}

function writeFailureRequiresIdentityProbe(source: SessionSite, error: unknown) {
  const kind = sourceErrorFromUnknown(source, error).kind;
  return kind === 'login-required' || kind === 'login-expired' || kind === 'verification-required';
}

function topicDeleteReplyActionKey(topicKeyValue: string, reply: Reply) {
  return `delete-reply:${topicKeyValue}:${reply.commentId ?? reply.deletePath ?? reply.floor ?? 'reply'}`;
}

function updateReplyCache(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: QueryKey,
  update: (replies: Reply[]) => Reply[]
) {
  queryClient.setQueryData<ReplyCache>(queryKey, (current) =>
    current
      ? {
          ...current,
          pages: current.pages.map((page) => ({ ...page, items: update(page.items) }))
        }
      : current
  );
}

function replyCursorFor(cache: ReplyCache | undefined, reply: Reply) {
  const page = cache?.pages.find((candidate) =>
    candidate.items.some((item) => (reply.commentId ? item.commentId === reply.commentId : item.floor === reply.floor))
  );
  const pageNumber = Number(page?.currentPage ?? page?.requestedPage);
  const offset = page?.currentOffset ?? page?.requestedOffset ?? null;
  return Number.isSafeInteger(pageNumber) &&
    pageNumber > 0 &&
    (offset === null || (Number.isSafeInteger(offset) && Number(offset) >= 0))
    ? { kind: 'cursor' as const, page: pageNumber, offset: offset === null ? null : Number(offset) }
    : null;
}

function replyEditTargetIsCurrent(
  target: ReplyEditTarget,
  ticket: WritableSessionTicket,
  source: Source,
  topicId: string,
  cachedReplies: ReplyCache | undefined
) {
  if (
    target.topicId !== topicId ||
    target.ticket.source !== source ||
    target.ticket.source !== ticket.source ||
    target.ticket.identityKey !== ticket.identityKey ||
    target.ticket.sessionEpoch !== ticket.sessionEpoch
  ) {
    return false;
  }
  let matchingReplyCount = 0;
  for (const page of cachedReplies?.pages || []) {
    for (const reply of page.items) {
      if (reply.commentId !== target.commentId) continue;
      matchingReplyCount += 1;
      if (matchingReplyCount > 1 || reply.canEdit !== true) return false;
    }
  }
  return matchingReplyCount === 1;
}

export function useTopicActionsController({
  active,
  sessionEpochs,
  discourseActionRuntimeDependencies,
  discourseLoginPrompts,
  ensureNodeImageApiKey,
  ensureWritableSession,
  fetcher,
  isWritableSessionTicketCurrent,
  getNodeSeekUserAgent,
  notify,
  reconcileWritableSession,
  refreshTopicReplies,
  siteSessionViewModels,
  topicDetail,
  topicReplies,
  topicSession
}: {
  active: boolean;
  sessionEpochs: ForumSessionEpochs;
  discourseActionRuntimeDependencies: DiscourseActionRuntimeDependencies;
  discourseLoginPrompts: Record<DiscourseSource, (message?: string) => void>;
  ensureNodeImageApiKey: () => Promise<string | null>;
  ensureWritableSession: (source: SessionSite) => Promise<WritableSessionTicket>;
  fetcher: Fetcher;
  isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
  getNodeSeekUserAgent: () => string;
  notify: (message: string) => void;
  reconcileWritableSession: (source: SessionSite) => Promise<WritableSessionReconcileResult>;
  refreshTopicReplies: (command?: ReplyRefreshCommand, trace?: DiagnosticTrace) => Promise<unknown>;
  siteSessionViewModels: SiteSessionViewModels;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicSession: TopicSessionController;
}) {
  const queryClient = useQueryClient();
  const pendingActionReservationsRef = useRef(new Set<string>());
  const activeRef = useCommittedRef(active);
  const sessionEpochsRef = useCommittedRef(sessionEpochs);
  const {
    state: { replyComposerOpen, replyContent, replyEditTarget, replyFace, replyOrder, replyTarget, selectedTopic },
    commands: { composer: topicComposer, topic: topicCommands }
  } = topicSession;
  const replyOrderRef = useCommittedRef(replyOrder);
  const refreshTopicRepliesRef = useCommittedRef(refreshTopicReplies);
  const replyComposerOpenRef = useCommittedRef(replyComposerOpen);
  const detachReplyEdit = topicComposer.detachEdit;
  const openReplyEditor = topicComposer.editReply;
  const detail = currentTopicActionTopic(topicDetail, selectedTopic);
  const mutationSource = detail?.source || 'nodeseek';
  const mutationTopicId = detail?.id || 'global';
  const mutationKey = useMemo(
    () => forumMutationKeys.topic(mutationSource, mutationTopicId),
    [mutationSource, mutationTopicId]
  );
  const mutationScope = `forum:${mutationSource}:topic:${mutationTopicId}`;
  const baseDecisionFor = useCallback<TopicActionDecisionFor>(
    (request) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic) as TopicDetail | null;
      const account =
        actionTopic && isSessionSource(actionTopic.source) ? siteSessionViewModels[actionTopic.source] : undefined;
      let objectAllowed = request.objectAllowed;
      let targetPresent = request.targetPresent;
      let alreadyComplete = request.alreadyComplete;
      const interactionTarget = request.target || request.reply;
      if (request.action === 'reply' || request.action === 'upload') {
        objectAllowed ??=
          Boolean(request.reply?.canEdit) ||
          Boolean(
            actionTopic && (!sourceUsesTopicCreatePermission(actionTopic.source) || actionTopic.canCreatePost === true)
          );
      } else if (request.action === 'edit') {
        objectAllowed ??= request.reply?.canEdit === true;
        targetPresent ??= Boolean(request.reply?.commentId && request.reply.contentMarkdown);
      } else if (request.action === 'delete') {
        objectAllowed ??= request.reply?.canDelete === true;
        targetPresent ??= Boolean(request.reply?.commentId || request.reply?.deletePath || request.reply?.floor);
      } else if (request.action === 'like' && interactionTarget) {
        objectAllowed ??= isDiscourseSource(actionTopic?.source)
          ? canToggleDiscourseLike(interactionTarget)
          : interactionTarget.canLike !== false;
        targetPresent ??= Boolean(interactionTarget.commentId);
        if (actionTopic?.source === 'nodeseek' && request.interaction) {
          const completedField = {
            upvote: 'upvoted',
            like: 'liked',
            dislike: 'disliked'
          }[request.interaction] as 'upvoted' | 'liked' | 'disliked';
          alreadyComplete ??= interactionTarget[completedField] === true;
        }
      } else if (request.action === 'vote') {
        objectAllowed ??= !request.poll?.closed;
        targetPresent ??= Boolean(request.poll);
        alreadyComplete ??= request.poll?.voted === true;
      }
      return decideTopicAction({
        account,
        action: request.action,
        alreadyComplete,
        objectAllowed,
        pending: request.pending,
        targetPresent,
        topic: actionTopic
      });
    },
    [selectedTopic, siteSessionViewModels, topicDetail]
  );
  const mutation = useMutation<unknown, unknown, MutationVariables>({
    mutationKey,
    scope: { id: mutationScope },
    mutationFn: async (variables) => {
      const decision = baseDecisionFor(variables.decision);
      if (!decision.allowed) {
        throw new HandledMutationError(
          topicActionDecisionMessage(decision),
          'blocked',
          decision.reason === 'identity-pending' ? 'identity_pending' : 'permission_denied'
        );
      }
      if (!isWritableSessionTicketCurrent(variables.ticket)) {
        throw new HandledMutationError('登录状态已变化，请重试', 'stale', 'stale');
      }
      await Promise.all([
        queryClient.cancelQueries({ queryKey: variables.detailKey, exact: true }),
        ...replyCacheKeys(variables.detailKey).map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true }))
      ]);
      if (!isWritableSessionTicketCurrent(variables.ticket)) {
        throw new HandledMutationError('登录状态已变化，请重试', 'stale', 'stale');
      }
      if (
        variables.editTarget &&
        !replyEditTargetIsCurrent(
          variables.editTarget,
          variables.ticket,
          variables.source,
          variables.topicId,
          queryClient.getQueryData<ReplyCache>(variables.repliesKey)
        )
      ) {
        detachReplyEdit();
        notify('编辑权限已变化，请刷新主题后重试');
        throw new HandledMutationError('编辑权限已变化，请刷新主题后重试', 'blocked', 'permission_denied');
      }
      const rollbackOptimistic = variables.applyOptimistic?.();
      markDiagnosticStage(variables.trace, 'apply', {
        source: variables.source,
        state: variables.applyOptimistic ? 'optimistic' : 'pending',
        localApplied: Boolean(variables.applyOptimistic)
      });
      try {
        if (!isWritableSessionTicketCurrent(variables.ticket)) {
          throw new HandledMutationError('登录状态已变化，请重试', 'stale', 'stale');
        }
        return await variables.task(variables.ticket);
      } catch (error) {
        const failure = mutationFailure(error);
        if (rollbackOptimistic && !failure.serverConfirmed) {
          rollbackOptimistic();
          markDiagnosticStage(variables.trace, 'rollback', { source: variables.source, state: 'local' });
        }
        throw error;
      }
    },
    onSuccess: async (result, variables) => {
      if (!isWritableSessionTicketCurrent(variables.ticket)) {
        finishDiagnosticTrace(variables.trace, 'stale', {
          source: variables.source,
          reason: 'stale',
          serverConfirmed: true
        });
        return;
      }
      variables.applyResult?.(result, variables);
      const refreshed = await variables.afterSuccess?.(result, variables);
      if (!isWritableSessionTicketCurrent(variables.ticket)) {
        finishDiagnosticTrace(variables.trace, 'stale', {
          source: variables.source,
          reason: 'stale',
          serverConfirmed: true
        });
        return;
      }
      const message =
        typeof variables.successMessage === 'function' ? variables.successMessage(result) : variables.successMessage;
      if (message) notify(message);
      finishDiagnosticTrace(variables.trace, refreshed === false ? 'partial' : 'success', {
        source: variables.source,
        serverConfirmed: true,
        ...(refreshed === false ? { reason: 'refresh_failed' } : {})
      });
    },
    onError: (error, variables) => {
      const failure = mutationFailure(error);
      const credentialIsCurrent = isWritableSessionTicketCurrent(variables.ticket);
      if (credentialIsCurrent && !(error instanceof HandledMutationError)) notify(failure.message);
      finishDiagnosticTrace(variables.trace, credentialIsCurrent ? failure.outcome : 'stale', {
        source: variables.source,
        reason: credentialIsCurrent ? failure.reason : 'stale',
        ...(failure.serverConfirmed ? { serverConfirmed: true } : {})
      });
    }
  });

  const pendingVariables = useMutationState<MutationVariables>({
    filters: { mutationKey, status: 'pending' },
    select: (entry) => entry.state.variables as MutationVariables
  });
  const decisionFor = useCallback<TopicActionDecisionFor>(
    (request) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const target = request.target || request.reply;
      const actionKey =
        request.actionKey ||
        (actionTopic && request.interaction && target?.commentId
          ? topicActionStateKey({
              topicKey: topicKey(actionTopic),
              targetId: target.commentId,
              action: request.interaction
            })
          : actionTopic && request.action === 'vote' && request.poll
            ? topicPollVoteActionKey(topicKey(actionTopic), request.poll)
            : actionTopic && request.action === 'bookmark'
              ? actionTopic.source === 'yaohuo'
                ? yaohuoFavoriteActionKey(topicKey(actionTopic))
                : topicActionStateKey({
                    topicKey: topicKey(actionTopic),
                    targetId: actionTopic.id,
                    action: actionTopic.source === 'nodeseek' ? 'collection' : 'bookmark'
                  })
              : undefined);
      return baseDecisionFor({
        ...request,
        pending:
          request.pending === true ||
          Boolean(actionKey && pendingVariables.some((variables) => variables?.actionKey === actionKey))
      });
    },
    [baseDecisionFor, pendingVariables, selectedTopic, topicDetail]
  );

  const cacheKeys = useCallback(
    (actionTopic: TopicDetail, ticket?: WritableSessionTicket) => {
      const scope = ticket
        ? { ...sessionEpochsRef.current, [ticket.source]: ticket.sessionEpoch }
        : sessionEpochsRef.current;
      const detailKey = forumQueryKeys.topic({
        source: actionTopic.source,
        topicId: actionTopic.id,
        scope
      });
      return { detailKey, repliesKey: forumQueryKeys.replies(detailKey, replyOrderRef.current) };
    },
    [replyOrderRef, sessionEpochsRef]
  );

  const editReply = useCallback(
    async (reply: Reply) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      if (!actionTopic) {
        notify('主题尚未加载');
        return;
      }
      if (!reply.commentId) {
        notify('当前回复缺少评论 id，刷新主题后再试。');
        return;
      }
      if (!reply.canEdit) {
        notify('当前回复不能编辑');
        return;
      }
      if (!reply.contentMarkdown) {
        notify('当前回复缺少原文，刷新主题后再试。');
        return;
      }
      if (!isSessionSource(actionTopic.source)) {
        notify('当前来源不支持写操作');
        return;
      }
      try {
        const ticket = await ensureWritableSession(actionTopic.source);
        if (!isWritableSessionTicketCurrent(ticket)) {
          throw new WritableSessionBlockedError('登录状态已变化，请重试', 'stale');
        }
        openReplyEditor({
          commentId: reply.commentId,
          contentMarkdown: reply.contentMarkdown,
          floor: reply.floor,
          topicId: actionTopic.id,
          ticket
        });
      } catch (error) {
        notify(errorMessage(error));
      }
    },
    [ensureWritableSession, isWritableSessionTicketCurrent, notify, selectedTopic, openReplyEditor, topicDetail]
  );

  useEffect(() => {
    if (
      replyEditTarget &&
      (!selectedTopic ||
        replyEditTarget.topicId !== selectedTopic.id ||
        replyEditTarget.ticket.source !== selectedTopic.source ||
        !isWritableSessionTicketCurrent(replyEditTarget.ticket) ||
        !topicReplies.some((reply) => reply.commentId === replyEditTarget.commentId && reply.canEdit === true))
    ) {
      detachReplyEdit();
    }
  }, [
    isWritableSessionTicketCurrent,
    replyEditTarget,
    selectedTopic,
    sessionEpochs,
    siteSessionViewModels,
    topicReplies,
    detachReplyEdit
  ]);

  const refreshRepliesAfterWrite = useCallback(
    async (actionTopic: TopicDetail, trace: DiagnosticTrace, command: ReplyRefreshCommand) => {
      if (!activeRef.current) {
        markDiagnosticStage(trace, 'apply', { source: actionTopic.source, state: 'inactive-route' });
        return true;
      }
      if (topicCommands.getCurrentKey() !== topicKey(actionTopic)) {
        const { detailKey } = cacheKeys(actionTopic);
        replyCacheKeys(detailKey).forEach((queryKey) => queryClient.removeQueries({ queryKey, exact: true }));
        queryClient.removeQueries({ queryKey: detailKey, exact: true });
        markDiagnosticStage(trace, 'apply', { source: actionTopic.source, state: 'cache-removed' });
        return true;
      }
      const outcome = await refreshTopicRepliesRef.current(command, trace);
      return outcome === 'completed' || outcome === true;
    },
    [activeRef, cacheKeys, queryClient, refreshTopicRepliesRef, topicCommands]
  );

  const executeMutation = useCallback(
    async (
      actionTopic: TopicDetail,
      variables: Omit<MutationVariables, 'ticket' | 'detailKey' | 'repliesKey' | 'source' | 'topicId'>
    ) => {
      const reservationKey = `${actionTopic.source}:${actionTopic.id}:${variables.actionKey}`;
      const duplicate = queryClient
        .getMutationCache()
        .getAll()
        .some((entry) => {
          const pending = entry.state.variables as MutationVariables | undefined;
          return (
            entry.state.status === 'pending' &&
            pending?.actionKey === variables.actionKey &&
            pending.source === actionTopic.source &&
            pending.topicId === actionTopic.id
          );
        });
      const decision = decisionFor({
        ...variables.decision,
        pending: duplicate || pendingActionReservationsRef.current.has(reservationKey)
      });
      if (!decision.allowed) {
        const message = topicActionDecisionMessage(decision);
        if (message) notify(message);
        finishDiagnosticTrace(variables.trace, 'blocked', {
          source: actionTopic.source,
          reason: decision.reason
        });
        return false;
      }
      pendingActionReservationsRef.current.add(reservationKey);
      try {
        if (!isSessionSource(actionTopic.source)) {
          throw new WritableSessionBlockedError('当前来源不支持写操作', 'login_required');
        }
        const ticket = await ensureWritableSession(actionTopic.source);
        const keys = cacheKeys(actionTopic, ticket);
        if (variables.editTarget) {
          if (
            !replyEditTargetIsCurrent(
              variables.editTarget,
              ticket,
              actionTopic.source,
              actionTopic.id,
              queryClient.getQueryData<ReplyCache>(keys.repliesKey)
            )
          ) {
            detachReplyEdit();
            notify('编辑权限已变化，请刷新主题后重试');
            finishDiagnosticTrace(variables.trace, 'blocked', {
              source: actionTopic.source,
              reason: 'permission_denied'
            });
            return false;
          }
        }
        await mutation.mutateAsync({
          ...variables,
          ...keys,
          ticket,
          source: actionTopic.source,
          topicId: actionTopic.id
        });
        return true;
      } catch (error) {
        if (error instanceof HandledMutationError) {
          // Mutation callbacks already own diagnostics and user feedback.
        } else if (error instanceof WritableSessionBlockedError) {
          notify(error.message);
          finishDiagnosticTrace(variables.trace, 'blocked', {
            source: actionTopic.source,
            reason: error.reason
          });
        } else {
          notify(errorMessage(error));
          finishDiagnosticTrace(variables.trace, 'failure', {
            source: actionTopic.source,
            reason: normalizeDiagnosticReason(error)
          });
        }
        return false;
      } finally {
        pendingActionReservationsRef.current.delete(reservationKey);
      }
    },
    [cacheKeys, decisionFor, detachReplyEdit, ensureWritableSession, mutation.mutateAsync, notify, queryClient]
  );

  const assertWritableTicket = useCallback(
    (ticket: WritableSessionTicket, serverConfirmed = false) => {
      if (!isWritableSessionTicketCurrent(ticket)) {
        throw new HandledMutationError('登录状态已变化，请重试', 'stale', 'stale', serverConfirmed);
      }
    },
    [isWritableSessionTicketCurrent]
  );

  const runNodeSeekRequest = useCallback(
    async (request: NodeSeekActionRequest, trace: DiagnosticTrace, ticket: WritableSessionTicket) => {
      assertWritableTicket(ticket);
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        state: 'ready',
        hasCredential: true,
        credentialSource: 'managed-cookie-jar'
      });
      try {
        assertWritableTicket(ticket);
        await runNodeSeekAction({
          fetcher: withDiagnosticFetcher(trace, fetcher),
          request,
          userAgent: getNodeSeekUserAgent()
        });
      } catch (error) {
        assertWritableTicket(ticket);
        const message = errorMessage(error);
        if (writeFailureRequiresIdentityProbe('nodeseek', error)) {
          await reconcileWritableSession('nodeseek').catch(() => ({ status: 'unknown' as const }));
        }
        notify(message);
        throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
      }
      markDiagnosticStage(trace, 'transport', { source: 'nodeseek', state: 'confirmed', serverConfirmed: true });
      assertWritableTicket(ticket, true);
      return true;
    },
    [assertWritableTicket, fetcher, getNodeSeekUserAgent, notify, reconcileWritableSession]
  );

  const actionBusy = pendingVariables.some((variables) => variables?.busy !== false);

  const runYaohuoRequest = useCallback(
    async (
      requestFactory: (cookieHeader: string) => YaohuoActionRequest,
      trace: DiagnosticTrace,
      ticket: WritableSessionTicket
    ) => {
      assertWritableTicket(ticket);
      const draftRequest = requestFactory('');
      const actionUrl = new URL(draftRequest.path, YAOHUO_BASE_URL).toString();
      const cookieRead = await readManagedCookieHeader(actionUrl);
      assertWritableTicket(ticket);
      if (cookieRead.status !== 'ok') {
        throw new HandledMutationError(
          cookieRead.status === 'error' ? cookieRead.message : '当前安装包不支持读取 WebView Cookie',
          'blocked',
          'identity_pending'
        );
      }
      try {
        assertWritableTicket(ticket);
        const result = await runYaohuoAction({
          fetcher: withDiagnosticFetcher(trace, fetcher),
          request: requestFactory(cookieRead.header)
        });
        if (result.status === 'unknown') {
          assertWritableTicket(ticket);
          notify(result.message);
          throw new HandledMutationError(result.message, 'failure', 'invalid_response');
        }
        markDiagnosticStage(trace, 'transport', { source: 'yaohuo', state: 'confirmed', serverConfirmed: true });
        assertWritableTicket(ticket, true);
        return result;
      } catch (error) {
        if (error instanceof HandledMutationError) throw error;
        assertWritableTicket(ticket);
        const message = errorMessage(error);
        if (writeFailureRequiresIdentityProbe('yaohuo', error)) {
          await reconcileWritableSession('yaohuo').catch(() => ({ status: 'unknown' as const }));
        }
        notify(message);
        throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
      }
    },
    [assertWritableTicket, fetcher, notify, reconcileWritableSession]
  );

  const runDiscourseRequest = useCallback(
    async (
      source: DiscourseSource,
      action: DiscourseAction,
      trace: DiagnosticTrace,
      ticket: WritableSessionTicket,
      preTransport?: () => void
    ) => {
      assertWritableTicket(ticket);
      const loginPrompt = discourseLoginPrompts[source];
      const runtime = await prepareDiscourseActionRuntime(source, {
        ...discourseActionRuntimeDependencies,
        fetcher: withDiagnosticFetcher(trace, fetcher)
      });
      assertWritableTicket(ticket);
      preTransport?.();
      if (runtime.isCredentialCurrent?.() === false) {
        throw new HandledMutationError('凭据已变化', 'stale', 'stale');
      }
      if (!runtime.credentialReady || !runtime.execute) {
        runtime.onMissingCredential?.();
        loginPrompt(authActionMessageForSource(source, siteSessionViewModels));
        throw new HandledMutationError('登录信息不可用', 'blocked', 'missing_credential');
      }
      try {
        assertWritableTicket(ticket);
        const result = await runtime.execute(buildDiscourseSourceActionRequest(source, action));
        markDiagnosticStage(trace, 'transport', { source, state: 'confirmed', serverConfirmed: true });
        if (runtime.isCredentialCurrent?.() === false) {
          throw new HandledMutationError('凭据已变化', 'stale', 'stale', true);
        }
        assertWritableTicket(ticket, true);
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
          ? `${originalMessage}；${
              recoveryMessage.includes('复核未完成') ? recoveryMessage : `授权状态复核未完成：${recoveryMessage}`
            }`
          : originalMessage;
        if (source === 'linuxdo' && (recovery.loginRequired || writeFailureRequiresIdentityProbe(source, error))) {
          const promptMessage = recovery.message || message;
          await reconcileWritableSession(source).catch(() => ({ status: 'unknown' as const }));
          notify(promptMessage);
          throw new HandledMutationError(promptMessage, 'failure', normalizeDiagnosticReason(error));
        }
        if (recovery.loginRequired) {
          const promptMessage = recovery.message || message;
          loginPrompt(promptMessage);
          throw new HandledMutationError(promptMessage, 'blocked', 'login_required');
        }
        notify(message);
        throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
      }
    },
    [
      assertWritableTicket,
      discourseActionRuntimeDependencies,
      discourseLoginPrompts,
      fetcher,
      notify,
      reconcileWritableSession,
      siteSessionViewModels
    ]
  );

  const updateInteraction = useCallback(
    (actionTopic: TopicDetail, patch: Parameters<typeof applyInteractionToTopic>[1]) => {
      const { detailKey } = cacheKeys(actionTopic);
      const apply = (nextPatch: Parameters<typeof applyInteractionToTopic>[1]) => {
        queryClient.setQueryData<TopicDetail>(
          detailKey,
          (current) => applyInteractionToTopic(current || null, nextPatch) || current
        );
        replyCacheKeys(detailKey).forEach((repliesKey) =>
          updateReplyCache(queryClient, repliesKey, (replies) => applyInteractionToReplies(replies, nextPatch))
        );
      };
      apply(patch);
      return () => apply({ ...patch, mode: patch.mode === 'add' ? 'remove' : 'add' });
    },
    [cacheKeys, queryClient]
  );

  const submitReply = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('reply', replyEditTarget ? 'edit' : 'submit', {
      ...(actionTopic ? { source: actionTopic.source } : {}),
      contentLength: replyContent.length
    });
    if (!replyComposerOpenRef.current) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
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
        decision: {
          action: 'edit',
          objectAllowed: true,
          targetPresent: Boolean(replyEditTarget.commentId && replyEditTarget.contentMarkdown)
        },
        editTarget: replyEditTarget,
        trace,
        task: (ticket) => {
          if (isNodeSeekActionTopic(actionTopic)) {
            return runNodeSeekRequest(
              buildNodeSeekEditReplyRequest({
                commentId: edit.commentId,
                content: edit.contentMarkdown,
                csrfToken: ''
              }),
              trace,
              ticket
            );
          }
          const editRepliesKey = cacheKeys(actionTopic as TopicDetail, ticket).repliesKey;
          return runDiscourseRequest(
            actionTopic.source as DiscourseSource,
            {
              type: 'edit-post',
              postId: edit.commentId,
              content: edit.contentMarkdown
            },
            trace,
            ticket,
            () => {
              if (
                replyEditTargetIsCurrent(
                  replyEditTarget,
                  ticket,
                  actionTopic.source,
                  actionTopic.id,
                  queryClient.getQueryData<ReplyCache>(editRepliesKey)
                )
              ) {
                return;
              }
              detachReplyEdit();
              notify('编辑权限已变化，请刷新主题后重试');
              throw new HandledMutationError('编辑权限已变化，请刷新主题后重试', 'blocked', 'permission_denied');
            }
          );
        },
        applyResult: (_result, { detailKey }) => {
          replyCacheKeys(detailKey).forEach((repliesKey) => {
            updateReplyCache(queryClient, repliesKey, (replies) =>
              applyEditedReplyContent(replies, edit, actionTopic.source)
            );
            void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' });
          });
          if (topicCommands.getCurrentKey() === actionTopicKey) topicComposer.completeSubmission();
        },
        afterSuccess: () =>
          refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
            kind: 'edited',
            silent: true,
            target: replyEditTarget,
            contentMarkdown: edit.contentMarkdown
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
      decision: { action: 'reply' },
      trace,
      task: (ticket) =>
        isYaohuoActionTopic(actionTopic)
          ? runYaohuoRequest(
              (cookieHeader) =>
                buildYaohuoReplyRequest({
                  topicId: actionTopic.id,
                  classId: actionTopic.categoryId || YAOHUO_DEFAULT_CLASS_ID,
                  content,
                  face,
                  sid: extractYaohuoSid(cookieHeader),
                  replyFloor: target?.floor,
                  toUserId: target?.authorId
                }),
              trace,
              ticket
            )
          : isDiscourseSource(actionTopic.source)
            ? runDiscourseRequest(
                actionTopic.source,
                {
                  type: 'reply',
                  topicId: actionTopic.id,
                  content,
                  replyToPostNumber: target?.floor
                },
                trace,
                ticket
              )
            : runNodeSeekRequest(
                buildNodeSeekReplyRequest({ postId: actionTopic.id, content, replyTarget: target, csrfToken: '' }),
                trace,
                ticket
              ),
      applyResult: () => {
        if (topicCommands.getCurrentKey() === actionTopicKey) topicComposer.completeSubmission();
        const { detailKey } = cacheKeys(actionTopic as TopicDetail);
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'none' });
        replyCacheKeys(detailKey).forEach(
          (repliesKey) => void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' })
        );
      },
      afterSuccess: () =>
        refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
          kind: 'created',
          silent: true
        }),
      successMessage: '回复已提交'
    });
  }, [
    cacheKeys,
    detachReplyEdit,
    executeMutation,
    notify,
    queryClient,
    refreshRepliesAfterWrite,
    replyComposerOpenRef,
    replyContent,
    replyEditTarget,
    replyFace,
    replyTarget,
    runDiscourseRequest,
    runNodeSeekRequest,
    runYaohuoRequest,
    selectedTopic,
    topicCommands,
    topicComposer,
    topicDetail
  ]);

  const deleteReplyConfirmed = useCallback(
    async (reply: Reply, trace: DiagnosticTrace) => {
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
      const targetPosition = replyCursorFor(
        queryClient.getQueryData<ReplyCache>(cacheKeys(actionTopic as TopicDetail).repliesKey),
        reply
      );
      const patch = () => {
        const { detailKey } = cacheKeys(actionTopic as TopicDetail);
        replyCacheKeys(detailKey).forEach((repliesKey) =>
          updateReplyCache(queryClient, repliesKey, (replies) =>
            replies.filter((item) =>
              reply.commentId ? item.commentId !== reply.commentId : item.floor !== reply.floor
            )
          )
        );
        queryClient.setQueryData<TopicDetail>(detailKey, (current) =>
          current
            ? {
                ...current,
                ...(typeof current.replyCount === 'number' ? { replyCount: Math.max(0, current.replyCount - 1) } : {}),
                replies: current.replies.filter((item) =>
                  reply.commentId ? item.commentId !== reply.commentId : item.floor !== reply.floor
                )
              }
            : current
        );
      };
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: topicDeleteReplyActionKey(actionTopicKey, reply),
        busy: true,
        decision: { action: 'delete', reply },
        trace,
        task: (ticket) =>
          isYaohuoActionTopic(actionTopic)
            ? runYaohuoRequest(
                (cookieHeader) =>
                  buildYaohuoDeleteReplyRequest({
                    deletePath: reply.deletePath || '',
                    sid: extractYaohuoSid(cookieHeader)
                  }),
                trace,
                ticket
              )
            : runDiscourseRequest(
                actionTopic.source as DiscourseSource,
                {
                  type: 'delete-post',
                  postId: reply.commentId || 0
                },
                trace,
                ticket
              ),
        applyResult: (_result, { detailKey }) => {
          patch();
          replyCacheKeys(detailKey).forEach(
            (repliesKey) =>
              void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' })
          );
        },
        afterSuccess: () =>
          refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
            kind: 'deleted',
            silent: true,
            target: reply,
            ...(targetPosition ? { position: targetPosition } : {})
          }),
        successMessage: '回复已删除'
      });
    },
    [
      cacheKeys,
      executeMutation,
      notify,
      queryClient,
      refreshRepliesAfterWrite,
      runDiscourseRequest,
      runYaohuoRequest,
      selectedTopic,
      topicDetail
    ]
  );

  const deleteReply = useCallback(
    (reply: Reply) => {
      const trace = beginDiagnosticTrace('reply', 'delete', detail ? { source: detail.source } : {});
      if (!reply.canDelete) {
        notify('当前回复不能删除');
        finishDiagnosticTrace(trace, 'blocked', { reason: 'permission_denied' });
        return;
      }
      let handled = false;
      Alert.alert(
        '删除回复',
        '确认删除这条回复？',
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => {
              handled = true;
              finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
            }
          },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => {
              handled = true;
              void deleteReplyConfirmed(reply, trace);
            }
          }
        ],
        {
          cancelable: true,
          onDismiss: () => {
            if (!handled) finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          }
        }
      );
    },
    [deleteReplyConfirmed, detail, notify]
  );

  const uploadReplyImage = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('reply', 'image-upload', actionTopic ? { source: actionTopic.source } : {});
    if (!replyComposerOpenRef.current) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
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
      decision: {
        action: 'upload',
        objectAllowed: Boolean(replyEditTarget) || canSubmitReplyToTopic(actionTopic)
      },
      ...(replyEditTarget ? { editTarget: replyEditTarget } : {}),
      trace,
      task: async (ticket) => {
        const editRepliesKey = replyEditTarget ? cacheKeys(actionTopic as TopicDetail, ticket).repliesKey : null;
        const assertCurrentEditTarget = (serverConfirmed = false) => {
          if (
            !replyEditTarget ||
            !editRepliesKey ||
            replyEditTargetIsCurrent(
              replyEditTarget,
              ticket,
              actionTopic.source,
              actionTopic.id,
              queryClient.getQueryData<ReplyCache>(editRepliesKey)
            )
          ) {
            return;
          }
          detachReplyEdit();
          notify('编辑权限已变化，请刷新主题后重试');
          throw new HandledMutationError(
            '编辑权限已变化，请刷新主题后重试',
            'blocked',
            'permission_denied',
            serverConfirmed
          );
        };
        assertWritableTicket(ticket);
        let nodeSeekApiKey: string | null = null;
        let nodeImageGeneration: number | undefined;
        if (isNodeSeekActionTopic(actionTopic)) {
          nodeSeekApiKey = await ensureNodeImageApiKey();
          assertWritableTicket(ticket);
          assertCurrentEditTarget();
          nodeImageGeneration = currentNodeImageApiKeyGeneration();
          if (!nodeSeekApiKey) {
            notify(NODEIMAGE_API_KEY_UNAVAILABLE_MESSAGE);
            throw new HandledMutationError(NODEIMAGE_API_KEY_UNAVAILABLE_MESSAGE, 'blocked', 'missing_credential');
          }
        }
        const picked = await DocumentPicker.getDocumentAsync({
          type: 'image/*',
          copyToCacheDirectory: true,
          multiple: false
        });
        assertWritableTicket(ticket);
        assertCurrentEditTarget();
        if (picked.canceled || !picked.assets?.[0]) {
          throw new HandledMutationError('已取消选择', 'canceled', 'canceled');
        }
        const file = normalizeReplyImageAsset(picked.assets[0]);
        let imageUrl = '';
        if (isDiscourseSource(actionTopic.source)) {
          const result = await runDiscourseRequest(actionTopic.source, { type: 'upload', file }, trace, ticket, () =>
            assertCurrentEditTarget()
          );
          imageUrl = discourseSourceUploadUrl(actionTopic.source, result);
        } else if (isYaohuoActionTopic(actionTopic)) {
          imageUrl = await uploadYaohuoReplyImage({ fetcher: withDiagnosticFetcher(trace, fetcher), file });
        } else if (isNodeSeekActionTopic(actionTopic)) {
          try {
            imageUrl = await uploadNodeSeekReplyImageWithApiKey({
              ensureApiKey: async () => nodeSeekApiKey,
              fetcher: withDiagnosticFetcher(trace, fetcher),
              file
            });
          } catch (error) {
            if (!isNodeImageApiKeyExpiredError(error)) {
              throw error;
            }
            notify(NODEIMAGE_API_KEY_UNAVAILABLE_MESSAGE);
            throw new HandledMutationError(NODEIMAGE_API_KEY_UNAVAILABLE_MESSAGE, 'blocked', 'missing_credential');
          }
          if (nodeImageGeneration !== currentNodeImageApiKeyGeneration()) {
            throw new HandledMutationError('NodeImage 凭据已变化', 'stale', 'stale', true);
          }
        }
        assertWritableTicket(ticket, Boolean(imageUrl));
        assertCurrentEditTarget(Boolean(imageUrl));
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
  }, [
    cacheKeys,
    detachReplyEdit,
    ensureNodeImageApiKey,
    executeMutation,
    fetcher,
    notify,
    queryClient,
    replyComposerOpenRef,
    replyEditTarget,
    runDiscourseRequest,
    selectedTopic,
    topicCommands,
    topicComposer,
    topicDetail
  ]);

  const interact = useCallback(
    async (type: InteractionType, commentId?: number) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const trace = beginDiagnosticTrace('topic', 'interaction', {
        ...(actionTopic ? { source: actionTopic.source } : {}),
        action: type
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
        const patch = {
          commentId,
          type: 'like' as const,
          mode: desired ? ('add' as const) : ('remove' as const),
          reactionId: 'heart'
        };
        await executeMutation(actionTopic as TopicDetail, {
          actionKey,
          busy: false,
          decision: {
            action: 'like',
            actionKey,
            interaction: 'like',
            objectAllowed: canToggleDiscourseLike(target),
            target: target || undefined,
            targetPresent: Boolean(commentId)
          },
          trace,
          applyOptimistic: () => updateInteraction(actionTopic as TopicDetail, patch),
          applyResult: () => {
            void updateInteraction(actionTopic as TopicDetail, patch);
          },
          task: (ticket) =>
            runDiscourseRequest(
              actionTopic.source as DiscourseSource,
              {
                type: 'set-like',
                postId: commentId,
                active: desired
              },
              trace,
              ticket
            ),
          successMessage: desired ? '点赞已提交' : '已取消点赞'
        });
        return;
      }
      if (!isNodeSeekActionTopic(actionTopic)) {
        finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
        return;
      }
      const fields = { upvote: 'upvoted', like: 'liked', dislike: 'disliked' } as const;
      const actionKey = topicActionStateKey({ topicKey: topicKey(actionTopic), targetId: commentId, action: type });
      const patch = { commentId, type, mode: 'add' as const };
      await executeMutation(actionTopic as TopicDetail, {
        actionKey,
        busy: false,
        decision: {
          action: 'like',
          actionKey,
          alreadyComplete: target?.[fields[type]] === true,
          interaction: type,
          objectAllowed: target?.canLike !== false,
          target: target || undefined,
          targetPresent: Boolean(commentId)
        },
        trace,
        applyOptimistic: () => updateInteraction(actionTopic as TopicDetail, patch),
        applyResult: () => {
          void updateInteraction(actionTopic as TopicDetail, patch);
        },
        task: (ticket) =>
          runNodeSeekRequest(buildNodeSeekInteractionRequest({ type, commentId, active: false }), trace, ticket),
        successMessage: type === 'upvote' ? '点赞已提交' : type === 'like' ? '加鸡腿请求已提交' : '反对已提交'
      });
    },
    [
      executeMutation,
      notify,
      runDiscourseRequest,
      runNodeSeekRequest,
      selectedTopic,
      topicDetail,
      topicReplies,
      updateInteraction
    ]
  );

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
      queryClient.setQueryData<TopicDetail>(
        detailKey,
        (current) =>
          applyBookmarkToTopic(current || null, {
            bookmarked: active,
            bookmarkId
          }) || current
      );
    };
    await executeMutation(actionDetail, {
      actionKey: yaohuoFavoriteActionKey(topicKey(actionTopic)),
      busy: false,
      decision: { action: 'bookmark', targetPresent: !bookmarked || Boolean(actionDetail.bookmarkId) },
      trace,
      applyOptimistic: () => {
        patch(!bookmarked, bookmarked ? undefined : actionDetail.bookmarkId);
        return () => patch(bookmarked, actionDetail.bookmarkId);
      },
      task: (ticket) =>
        runYaohuoRequest(
          () =>
            bookmarked
              ? buildYaohuoDeleteFavoriteRequest({ favoriteId: actionDetail.bookmarkId || 0 })
              : buildYaohuoFavoriteRequest({
                  topicId: actionTopic.id,
                  classId: actionTopic.categoryId || YAOHUO_DEFAULT_CLASS_ID
                }),
          trace,
          ticket
        ),
      applyResult: (result) => {
        const yaohuoResult = result as YaohuoActionResult;
        patch(!bookmarked, bookmarked || yaohuoResult.status === 'unknown' ? undefined : yaohuoResult.favoriteId);
      },
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
    const patch = (active: boolean) => {
      const { detailKey } = cacheKeys(actionDetail);
      queryClient.setQueryData<TopicDetail>(
        detailKey,
        (current) =>
          applyNodeSeekCollectionToTopic(current || null, {
            collected: active
          }) || current
      );
    };
    await executeMutation(actionDetail, {
      actionKey: topicActionStateKey({
        topicKey: topicKey(actionTopic),
        targetId: actionTopic.id,
        action: 'collection'
      }),
      busy: false,
      decision: { action: 'bookmark' },
      trace,
      applyOptimistic: () => {
        patch(!collected);
        return () => patch(collected);
      },
      task: (ticket) =>
        runNodeSeekRequest(buildNodeSeekCollectionRequest({ postId: actionTopic.id, collected }), trace, ticket),
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
      queryClient.setQueryData<TopicDetail>(
        detailKey,
        (current) =>
          applyBookmarkToTopic(current || null, {
            bookmarked: active,
            bookmarkId
          }) || current
      );
    };
    await executeMutation(actionDetail, {
      actionKey: topicActionStateKey({ topicKey: topicKey(actionTopic), targetId: actionTopic.id, action: 'bookmark' }),
      busy: false,
      decision: { action: 'bookmark' },
      trace,
      applyOptimistic: () => {
        patch(!bookmarked, bookmarked ? undefined : actionDetail.bookmarkId);
        return () => patch(bookmarked, actionDetail.bookmarkId);
      },
      task: (ticket) =>
        runDiscourseRequest(
          actionTopic.source as DiscourseSource,
          {
            type: 'set-bookmark',
            targetId: actionTopic.id,
            targetType: 'Topic',
            active: !bookmarked,
            bookmarkId: actionDetail.bookmarkId
          },
          trace,
          ticket
        ),
      applyResult: (result) => patch(!bookmarked, bookmarked ? undefined : discourseBookmarkIdFromActionResult(result)),
      successMessage: bookmarked ? '已取消原站收藏' : '原站收藏已提交'
    });
  }, [cacheKeys, executeMutation, queryClient, runDiscourseRequest, selectedTopic, topicDetail]);

  const votePoll = useCallback(
    async (poll: TopicPoll, optionIds: string[]) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const trace = beginDiagnosticTrace('topic', 'vote', {
        ...(actionTopic ? { source: actionTopic.source } : {}),
        selectedCount: optionIds.length
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
          decision: { action: 'vote', poll, targetPresent: optionIds.length > 0 },
          trace,
          task: async (ticket) => {
            if (isNodeSeekActionTopic(actionTopic)) {
              await runNodeSeekRequest(buildNodeSeekVoteRequest({ optionIds }), trace, ticket);
              try {
                if (!poll.id) throw new Error('投票 id 不正确');
                assertWritableTicket(ticket);
                const confirmedPoll = await fetchNodeSeekVoteInfo({
                  pollId: poll.id,
                  fetcher: withDiagnosticFetcher(trace, fetcher),
                  userAgent: getNodeSeekUserAgent()
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
              await runDiscourseRequest(
                actionTopic.source,
                {
                  type: 'vote',
                  postId: poll.postId,
                  pollName: poll.name,
                  optionIds
                },
                trace,
                ticket
              );
            } else {
              await runYaohuoRequest(
                () =>
                  buildYaohuoVoteRequest({
                    topicId: actionTopic.id,
                    classId: actionTopic.categoryId || YAOHUO_DEFAULT_CLASS_ID,
                    voteIds: optionIds
                  }),
                trace,
                ticket
              );
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
            const { detailKey } = cacheKeys(actionTopic as TopicDetail);
            queryClient.setQueryData<TopicDetail>(
              detailKey,
              (current) => applyPollVoteToTopic(current || null, patch) || current
            );
            replyCacheKeys(detailKey).forEach((repliesKey) =>
              updateReplyCache(queryClient, repliesKey, (replies) => applyPollVoteToReplies(replies, patch))
            );
            if (voteResult.refreshFailed) notify('提交成功但结果刷新失败，请手动刷新。');
          },
          successMessage: (result) => ((result as { refreshFailed: boolean }).refreshFailed ? '' : '投票已提交')
        });
      };
      if (!isNodeSeekActionTopic(actionTopic)) {
        await submit();
        return;
      }
      let handled = false;
      Alert.alert(
        '确认提交投票？',
        '提交后不可修改。',
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => {
              handled = true;
              finishDiagnosticTrace(trace, 'canceled', { source: actionTopic.source, reason: 'canceled' });
            }
          },
          {
            text: '提交',
            style: 'destructive',
            onPress: () => {
              if (handled) return;
              handled = true;
              void submit();
            }
          }
        ],
        {
          cancelable: true,
          onDismiss: () => {
            if (!handled) finishDiagnosticTrace(trace, 'canceled', { source: actionTopic.source, reason: 'canceled' });
          }
        }
      );
    },
    [
      cacheKeys,
      executeMutation,
      fetcher,
      getNodeSeekUserAgent,
      notify,
      queryClient,
      runDiscourseRequest,
      runNodeSeekRequest,
      runYaohuoRequest,
      selectedTopic,
      topicDetail
    ]
  );

  return {
    actionBusy,
    bookmarkOnDiscourseSite,
    collectOnNodeSeekSite,
    decisionFor,
    deleteReply,
    editReply,
    favoriteOnYaohuoSite,
    interact,
    submitReply,
    uploadReplyImage,
    votePoll
  };
}

export type TopicActionsController = ReturnType<typeof useTopicActionsController>;
