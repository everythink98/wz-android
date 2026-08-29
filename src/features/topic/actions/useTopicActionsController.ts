import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useMutation, useMutationState, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import {
  buildNodeSeekCollectionRequest,
  buildNodeSeekEditReplyRequest,
  buildNodeSeekInteractionRequest,
  buildNodeSeekPollLockRequest,
  buildNodeSeekPollCreateRequest,
  buildNodeSeekReplyRequest,
  buildNodeSeekStardustPrepareRequest,
  buildNodeSeekStardustSendRequest,
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
import {
  buildDiscourseActionRequest,
  discourseImageUrlFromUploadResponse,
  type DiscourseAction
} from '@/sources/discourse/actionRequest';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { fetchNodeSeekVoteInfo, nodeSeekCreatedPollId, runNodeSeekAction } from '@/sources/nodeseek/actionClient';
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
import type { ReplyEditTarget, ReplyRefreshCommand, ReplyRefreshTarget } from '../model/types';
import { topicKey } from '@/domain/reader/readerData';
import { rejectUnauthorizedResponse, withFetchGuard, type Fetcher } from '@/platform/network/request';
import type { ReadGateway } from '@/sources/readGateway';
import { errorMessage } from '@/platform/network/errors';
import { canToggleDiscourseLike } from '@/sources/discourse/permissions';
import { isDiscourseSource, isSessionSource } from '@/domain/forum/sourceCatalog';
import { normalizeReplyImageAsset, replyImageMarkupForSource, replyImageUploadSupported } from '@/sources/imageUpload';
import { isNodeImageApiKeyExpiredError, uploadNodeSeekReplyImageWithApiKey } from '@/sources/nodeimage/upload';
import { uploadYaohuoReplyImage } from '@/sources/yaohuo/imageUpload';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import type { SessionSite, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { nodeSeekUserIdForSession } from '@/domain/session/siteSessionState';
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
import type { ComposerSnapshot, NodeSeekStardustReceive, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import {
  fingerprintNodeSeekPoll,
  nodeSeekPendingPollTokenRanges,
  nodeSeekStardustMarkerRanges,
  replacePendingNodeSeekPollToken
} from '@/domain/forum/structuredComposer';
import { readNodeSeekPollJournalEntry, saveNodeSeekPollJournalEntry } from '@/platform/persistence/nodeSeekPollJournal';
import { fetchNodeSeekStardustStatus, nodeSeekStardustReceiverName } from '@/sources/nodeseek/stardust';
import { fetchLinuxDoTemplates, recordLinuxDoTemplateUse } from '@/sources/linuxdo/templates';
import { fetchLinuxDoPollCapabilities } from '@/sources/linuxdo/pollCapabilities';
import { forumMutationKeys, forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import {
  canSubmitReplyToTopic,
  canVotePollOnTopic,
  currentTopicActionTopic,
  applyEditedReplyContent,
  isNodeSeekActionTopic,
  isYaohuoActionTopic,
  matchesReplyRefreshTarget,
  removeRepliesForRefresh,
  topicEditReplyActionKey,
  topicPollVoteActionKey,
  topicReplyActionKey,
  yaohuoFavoriteActionKey,
  YAOHUO_DEFAULT_CLASS_ID
} from './actionHelpers';
import { WritableSessionBlockedError, type WritableSessionTicket } from '@/domain/session/writableSessionGate';
import { readManagedCookieHeader } from '@/platform/network/managedCookies';
import { YAOHUO_BASE_URL } from '@/sources/yaohuo/protocol';
import { LINUXDO_BASE_URL } from '@/sources/linuxdo/protocol';
import {
  decideTopicAction,
  topicActionDecisionMessage,
  type TopicActionDecisionFor,
  type TopicActionDecisionRequest
} from './topicActionDecision';

type ReplyCache = InfiniteData<{ items: Reply[]; [key: string]: unknown }, unknown>;

const REPLY_ORDERS = ['oldest', 'newest'] as const;

type MutationVariables = {
  actionKey: string;
  busy: boolean;
  decision: TopicActionDecisionRequest;
  ticket: WritableSessionTicket;
  detailKey: QueryKey;
  replyKeys: readonly QueryKey[];
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
    readonly serverConfirmed = false,
    readonly serverRejected = false
  ) {
    super(message);
  }
}

function mutationFailure(error: unknown, outcome: HandledMutationError['outcome'] = 'failure') {
  if (error instanceof HandledMutationError) return error;
  return new HandledMutationError(errorMessage(error), outcome, normalizeDiagnosticReason(error));
}

function confirmNodeSeekPollReplacement(poll: PendingNodeSeekPoll) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    Alert.alert(
      '投票内容已修改',
      `“${poll.title}”已经分配过远端投票。NodeSeek 不支持修改远端投票；继续会创建一个新投票，旧投票会保留。`,
      [
        { text: '取消', style: 'cancel', onPress: () => finish(false) },
        { text: '创建新投票', onPress: () => finish(true) }
      ],
      { cancelable: true, onDismiss: () => finish(false) }
    );
  });
}

function confirmNodeSeekStardustPayment(receive: NodeSeekStardustReceive, receiverName: string) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    Alert.alert(
      '确认 Stardust 付款？',
      `收款人 ${receiverName} (#${receive.receiverMemberId})\n金额 ${receive.amount} Stardust\n\n付款提交后不可退回。`,
      [
        { text: '取消', style: 'cancel', onPress: () => finish(false) },
        { text: '确认付款', style: 'destructive', onPress: () => finish(true) }
      ],
      { cancelable: true, onDismiss: () => finish(false) }
    );
  });
}

function isRawUnauthorized(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { reason?: unknown }).reason === 'http-401');
}

function isLoginRequiredError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { loginRequired?: unknown }).loginRequired);
}

function topicDeleteReplyActionKey(topicKeyValue: string, target: ReplyRefreshTarget) {
  return `delete-reply:${topicKeyValue}:${target.kind}:${
    target.kind === 'comment-id' ? target.commentId : target.deletePath
  }`;
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

function updateBookmarkCache(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: QueryKey,
  active: boolean,
  bookmarkId?: number
) {
  queryClient.setQueryData<TopicDetail>(
    queryKey,
    (current) => applyBookmarkToTopic(current || null, { bookmarked: active, bookmarkId }) || current
  );
}

function replyCursorFor(cache: ReplyCache | undefined, target: ReplyRefreshTarget) {
  const page = cache?.pages.find((candidate) =>
    candidate.items.some((reply) => matchesReplyRefreshTarget(reply, target))
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
  linuxDoUserAgent,
  showLinuxDoVerification,
  ensureNodeImageApiKey,
  ensureWritableSession,
  fetcher,
  isWritableSessionTicketCurrent,
  getNodeSeekUserAgent,
  notify,
  onSessionExpired,
  readGateway,
  refreshTopicReplies,
  siteSessionViewModels,
  topicDetail,
  topicReplies,
  topicSession
}: {
  active: boolean;
  sessionEpochs: ForumSessionEpochs;
  linuxDoUserAgent: () => string;
  showLinuxDoVerification: (message?: string) => void;
  ensureNodeImageApiKey: () => Promise<string | null>;
  ensureWritableSession: (source: SessionSite) => Promise<WritableSessionTicket>;
  fetcher: Fetcher;
  isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
  getNodeSeekUserAgent: () => string;
  notify: (message: string) => void;
  onSessionExpired: (source: SessionSite, requestSessionEpoch: number) => void;
  readGateway: Pick<ReadGateway, 'getReadPlan'>;
  refreshTopicReplies: (command?: ReplyRefreshCommand, trace?: DiagnosticTrace) => Promise<unknown>;
  siteSessionViewModels: SiteSessionViewModels;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicSession: TopicSessionController;
}) {
  const queryClient = useQueryClient();
  const pendingActionReservationsRef = useRef(new Set<string>());
  const uncertainNodeSeekPollsRef = useRef(new Set<string>());
  const activeRef = useCommittedRef(active);
  const sessionEpochsRef = useCommittedRef(sessionEpochs);
  const {
    state: { replyComposerIntent, replyContent, replyFace, replyOrder, selectedTopic },
    commands: { composer: topicComposer, topic: topicCommands }
  } = topicSession;
  const replyOrderRef = useCommittedRef(replyOrder);
  const refreshTopicRepliesRef = useCommittedRef(refreshTopicReplies);
  const replyComposerIntentRef = useCommittedRef(replyComposerIntent);
  const authenticatedFetcher = useMemo(() => rejectUnauthorizedResponse(fetcher), [fetcher]);
  const nodeSeekUserId = nodeSeekUserIdForSession(siteSessionViewModels.nodeseek);
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
        objectAllowed ??= Boolean(request.reply?.canEdit) || Boolean(actionTopic);
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
      } else if (request.action === 'manage-poll') {
        objectAllowed ??= Boolean(nodeSeekUserId && request.poll?.ownerId === String(nodeSeekUserId));
        targetPresent ??= Boolean(request.poll?.id);
        alreadyComplete ??= request.poll?.closed === true;
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
    [nodeSeekUserId, selectedTopic, siteSessionViewModels, topicDetail]
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
        ...variables.replyKeys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true }))
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
        if (isRawUnauthorized(error) && isWritableSessionTicketCurrent(variables.ticket)) {
          const message = errorMessage(error);
          notify(message);
          onSessionExpired(variables.ticket.source, variables.ticket.sessionEpoch);
          throw new HandledMutationError(message, 'failure', 'http-401');
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
        readPlanScope: readGateway.getReadPlan(actionTopic.source, 'topic').cacheScope,
        scope
      });
      const repliesReadPlanScope = readGateway.getReadPlan(actionTopic.source, 'replies').cacheScope;
      const replyKeys = REPLY_ORDERS.map((order) => forumQueryKeys.replies(detailKey, order, repliesReadPlanScope));
      return {
        detailKey,
        replyKeys,
        repliesKey: forumQueryKeys.replies(detailKey, replyOrderRef.current, repliesReadPlanScope)
      };
    },
    [readGateway, replyOrderRef, sessionEpochsRef]
  );

  const applyPollResult = useCallback(
    ({
      actionTopic,
      confirmedPoll,
      optionIds,
      poll,
      preserveUnknownCounts
    }: {
      actionTopic: TopicDetail;
      confirmedPoll?: TopicPoll;
      optionIds: string[];
      poll: TopicPoll;
      preserveUnknownCounts?: boolean;
    }) => {
      const patch = {
        pollId: poll.id,
        pollName: poll.name,
        pollPostId: poll.postId,
        optionIds,
        ...(confirmedPoll ? { confirmedPoll } : {}),
        ...(preserveUnknownCounts ? { preserveUnknownCounts: true } : {})
      };
      const { detailKey, replyKeys } = cacheKeys(actionTopic);
      queryClient.setQueryData<TopicDetail>(
        detailKey,
        (current) => applyPollVoteToTopic(current || null, patch) || current
      );
      replyKeys.forEach((repliesKey) =>
        updateReplyCache(queryClient, repliesKey, (replies) =>
          applyPollVoteToReplies(replies, patch, actionTopic.source)
        )
      );
    },
    [cacheKeys, queryClient]
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
    if (replyComposerIntent.kind !== 'edit') return;
    const target = replyComposerIntent.target;
    if (
      !selectedTopic ||
      target.topicId !== selectedTopic.id ||
      target.ticket.source !== selectedTopic.source ||
      !isWritableSessionTicketCurrent(target.ticket) ||
      !topicReplies.some((reply) => reply.commentId === target.commentId && reply.canEdit === true)
    ) {
      detachReplyEdit();
    }
  }, [
    isWritableSessionTicketCurrent,
    replyComposerIntent,
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
        const { detailKey, replyKeys } = cacheKeys(actionTopic);
        replyKeys.forEach((queryKey) => queryClient.removeQueries({ queryKey, exact: true }));
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
      variables: Omit<MutationVariables, 'ticket' | 'detailKey' | 'replyKeys' | 'repliesKey' | 'source' | 'topicId'>
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
    async (
      request: NodeSeekActionRequest,
      trace: DiagnosticTrace,
      ticket: WritableSessionTicket,
      notifyFailure = true
    ) => {
      assertWritableTicket(ticket);
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        state: 'ready',
        hasCredential: true,
        credentialSource: 'managed-cookie-jar'
      });
      try {
        assertWritableTicket(ticket);
        const result = await runNodeSeekAction({
          fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
          request,
          userAgent: getNodeSeekUserAgent()
        });
        markDiagnosticStage(trace, 'transport', { source: 'nodeseek', state: 'confirmed', serverConfirmed: true });
        assertWritableTicket(ticket, true);
        return result;
      } catch (error) {
        if (error instanceof HandledMutationError) throw error;
        if (isRawUnauthorized(error)) throw error;
        assertWritableTicket(ticket);
        const message = errorMessage(error);
        if (notifyFailure) notify(message);
        throw new HandledMutationError(
          message,
          'failure',
          normalizeDiagnosticReason(error),
          false,
          Boolean(error && typeof error === 'object' && (error as { serverRejected?: unknown }).serverRejected)
        );
      }
    },
    [assertWritableTicket, authenticatedFetcher, getNodeSeekUserAgent, notify]
  );

  const actionBusy = pendingVariables.some((variables) => variables?.busy !== false);

  const materializeNodeSeekPolls = useCallback(
    async ({
      content,
      polls,
      ticket,
      trace
    }: {
      content: string;
      polls: PendingNodeSeekPoll[];
      ticket: WritableSessionTicket;
      trace: DiagnosticTrace;
    }) => {
      let markdown = content;
      const tokenRanges = nodeSeekPendingPollTokenRanges(content);
      const tokenIds = tokenRanges.map((range) => range.localId);
      const pollIds = polls.map((poll) => poll.localId);
      const rawTokenCount = content.split('<!-- wz:nodeseek-poll:').length - 1;
      const invalidSnapshot =
        rawTokenCount !== tokenRanges.length ||
        tokenIds.length !== polls.length ||
        new Set(tokenIds).size !== tokenIds.length ||
        new Set(pollIds).size !== pollIds.length ||
        tokenIds.some((localId) => !pollIds.includes(localId));
      if (invalidSnapshot) {
        const message = '本地投票数据不完整，请移除后重新插入';
        notify(message);
        throw new HandledMutationError(message, 'blocked', 'invalid_response');
      }

      const plans: {
        poll: PendingNodeSeekPoll;
        fingerprint: string;
        uncertaintyKey: string;
        remoteId: string;
      }[] = [];
      for (const poll of polls) {
        assertWritableTicket(ticket);
        const fingerprint = fingerprintNodeSeekPoll(poll);
        if (fingerprint !== poll.fingerprint) {
          const message = '投票草稿校验失败，请重新打开投票编辑器';
          notify(message);
          throw new HandledMutationError(message, 'blocked', 'invalid_response');
        }
        const uncertaintyKey = `${ticket.identityKey}:${poll.localId}:${fingerprint}`;
        if (uncertainNodeSeekPollsRef.current.has(uncertaintyKey)) {
          const message = '该投票上次创建结果未知。请先到 NodeSeek 原站确认，修改或移除投票后再发送。';
          notify(message);
          throw new HandledMutationError(message, 'blocked', 'invalid_response');
        }
        const journal = await readNodeSeekPollJournalEntry(ticket.identityKey, poll.localId);
        assertWritableTicket(ticket);
        if (journal?.fingerprint === fingerprint && journal.remoteId === null) {
          const message = '该投票上次创建结果未知。请先到 NodeSeek 原站确认，修改或移除投票后再发送。';
          notify(message);
          throw new HandledMutationError(message, 'blocked', 'invalid_response');
        }
        let remoteId = journal?.fingerprint === fingerprint ? journal.remoteId || '' : '';
        if (!remoteId && journal && !(await confirmNodeSeekPollReplacement(poll))) {
          throw new HandledMutationError('已取消创建新投票', 'canceled', 'canceled');
        }
        assertWritableTicket(ticket);
        plans.push({ poll, fingerprint, uncertaintyKey, remoteId });
      }

      for (const plan of plans) {
        const { poll, fingerprint, uncertaintyKey } = plan;
        let { remoteId } = plan;
        if (!remoteId) {
          let remoteIdSaved = false;
          try {
            const result = await runNodeSeekRequest(buildNodeSeekPollCreateRequest({ poll }), trace, ticket);
            remoteId = nodeSeekCreatedPollId(result);
            await saveNodeSeekPollJournalEntry(ticket.identityKey, { localId: poll.localId, fingerprint, remoteId });
            remoteIdSaved = true;
            assertWritableTicket(ticket, true);
          } catch (error) {
            const knownSafeFailure =
              error instanceof HandledMutationError &&
              (error.serverRejected || (error.outcome === 'stale' && !error.serverConfirmed));
            if (!knownSafeFailure && !remoteIdSaved) {
              uncertainNodeSeekPollsRef.current.add(uncertaintyKey);
              if (!remoteId) {
                await saveNodeSeekPollJournalEntry(ticket.identityKey, {
                  localId: poll.localId,
                  fingerprint,
                  remoteId: null
                }).catch(() => undefined);
              }
              notify('投票创建结果未知。请先到 NodeSeek 原站确认，修改或移除投票后再发送。');
            }
            throw error;
          }
        }
        markdown = replacePendingNodeSeekPollToken(markdown, poll.localId, remoteId);
      }
      if (markdown.includes('<!-- wz:nodeseek-poll:')) {
        const message = '本地投票数据不完整，请移除后重新插入';
        notify(message);
        throw new HandledMutationError(message, 'blocked', 'invalid_response');
      }
      return markdown;
    },
    [assertWritableTicket, notify, runNodeSeekRequest]
  );

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
          fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
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
        if (isRawUnauthorized(error)) throw error;
        assertWritableTicket(ticket);
        const message = errorMessage(error);
        notify(message);
        throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
      }
    },
    [assertWritableTicket, authenticatedFetcher, notify]
  );

  const runLinuxDoRequest = useCallback(
    async (
      action: DiscourseAction,
      trace: DiagnosticTrace,
      ticket: WritableSessionTicket,
      preTransport?: () => void
    ) => {
      assertWritableTicket(ticket);
      preTransport?.();
      try {
        assertWritableTicket(ticket);
        const result = await runLinuxDoAction({
          fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
          request: buildDiscourseActionRequest(action),
          userAgent: linuxDoUserAgent()
        });
        markDiagnosticStage(trace, 'transport', { source: 'linuxdo', state: 'confirmed', serverConfirmed: true });
        assertWritableTicket(ticket, true);
        return result ?? true;
      } catch (error) {
        if (error instanceof HandledMutationError) throw error;
        if (isRawUnauthorized(error)) throw error;
        const message = errorMessage(error);
        if (isLoginRequiredError(error)) {
          showLinuxDoVerification(message);
          throw new HandledMutationError(message, 'blocked', 'login_required');
        }
        notify(message);
        throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
      }
    },
    [assertWritableTicket, authenticatedFetcher, linuxDoUserAgent, notify, showLinuxDoVerification]
  );

  const updateInteraction = useCallback(
    (actionTopic: TopicDetail, patch: Parameters<typeof applyInteractionToTopic>[1]) => {
      const { detailKey, replyKeys } = cacheKeys(actionTopic);
      const apply = (nextPatch: Parameters<typeof applyInteractionToTopic>[1]) => {
        queryClient.setQueryData<TopicDetail>(
          detailKey,
          (current) => applyInteractionToTopic(current || null, nextPatch) || current
        );
        replyKeys.forEach((repliesKey) =>
          updateReplyCache(queryClient, repliesKey, (replies) => applyInteractionToReplies(replies, nextPatch))
        );
      };
      apply(patch);
      return () => apply({ ...patch, mode: patch.mode === 'add' ? 'remove' : 'add' });
    },
    [cacheKeys, queryClient]
  );

  const submitReply = useCallback(
    async (snapshot?: ComposerSnapshot) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const submittedContent = snapshot?.markdown ?? replyContent;
      const submittedNodeSeekPolls = snapshot?.pendingNodeSeekPolls || [];
      const trace = beginDiagnosticTrace('reply', replyComposerIntent.kind === 'edit' ? 'edit' : 'submit', {
        ...(actionTopic ? { source: actionTopic.source } : {}),
        contentLength: submittedContent.length
      });
      if (replyComposerIntentRef.current.kind === 'closed') {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        return;
      }
      const canEditDiscourseReply = Boolean(
        actionTopic && isDiscourseSource(actionTopic.source) && replyComposerIntent.kind === 'edit'
      );
      if (!actionTopic || (!canEditDiscourseReply && !canSubmitReplyToTopic(actionTopic))) {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        return;
      }
      if (snapshot?.validationIssues.length) {
        notify(snapshot.validationIssues[0]!.message);
        finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
        return;
      }
      if (!submittedContent.trim()) {
        notify('请输入回复内容');
        finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
        return;
      }
      if (isNodeSeekActionTopic(actionTopic)) {
        const currentMemberId = String(siteSessionViewModels.nodeseek.currentUser?.id || '').trim();
        const foreignReceive = nodeSeekStardustMarkerRanges(submittedContent).find(
          (range) => range.receive && range.receive.receiverMemberId !== currentMemberId
        );
        if (foreignReceive) {
          notify('收款卡片属于其他账号，请替换为当前账号或移除');
          finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'permission_denied' });
          return;
        }
      }
      const actionTopicKey = topicKey(actionTopic);
      if (replyComposerIntent.kind === 'edit') {
        const editTarget = replyComposerIntent.target;
        if (!isNodeSeekActionTopic(actionTopic) && !isDiscourseSource(actionTopic.source)) {
          notify('当前来源暂不支持编辑回复');
          finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
          return;
        }
        const edit = { ...editTarget, contentMarkdown: submittedContent };
        let sentEditContent = edit.contentMarkdown;
        await executeMutation(actionTopic as TopicDetail, {
          actionKey: topicEditReplyActionKey(actionTopicKey, editTarget.commentId),
          busy: true,
          decision: {
            action: 'edit',
            objectAllowed: true,
            targetPresent: Boolean(editTarget.commentId && editTarget.contentMarkdown)
          },
          editTarget,
          trace,
          task: async (ticket) => {
            if (isNodeSeekActionTopic(actionTopic)) {
              sentEditContent = await materializeNodeSeekPolls({
                content: edit.contentMarkdown,
                polls: submittedNodeSeekPolls,
                ticket,
                trace
              });
              return runNodeSeekRequest(
                buildNodeSeekEditReplyRequest({
                  commentId: edit.commentId,
                  content: sentEditContent,
                  csrfToken: ''
                }),
                trace,
                ticket
              );
            }
            const editRepliesKey = cacheKeys(actionTopic as TopicDetail, ticket).repliesKey;
            return runLinuxDoRequest(
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
                    editTarget,
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
          applyResult: (_result, { replyKeys }) => {
            replyKeys.forEach((repliesKey) => {
              updateReplyCache(queryClient, repliesKey, (replies) =>
                applyEditedReplyContent(replies, { ...edit, contentMarkdown: sentEditContent }, actionTopic.source)
              );
              void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' });
            });
            if (topicCommands.getCurrentKey() === actionTopicKey) topicComposer.completeSubmission();
          },
          afterSuccess: () =>
            refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
              kind: 'edited',
              silent: true,
              target: { kind: 'comment-id', commentId: editTarget.commentId },
              contentMarkdown: sentEditContent
            }),
          successMessage: '回复已更新'
        });
        return;
      }
      const floorTarget = replyComposerIntent.kind === 'floor' ? replyComposerIntent.target : null;
      if (isYaohuoActionTopic(actionTopic) && floorTarget && !floorTarget.authorId) {
        notify('当前楼层缺少用户 id，刷新主题后再试。');
        finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'not_ready' });
        return;
      }
      const content = submittedContent;
      let sentContent = content;
      const face = replyFace;
      const target = floorTarget;
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: topicReplyActionKey(actionTopicKey),
        busy: true,
        decision: { action: 'reply' },
        trace,
        task: async (ticket) => {
          if (isYaohuoActionTopic(actionTopic)) {
            return runYaohuoRequest(
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
            );
          }
          if (isDiscourseSource(actionTopic.source)) {
            return runLinuxDoRequest(
              {
                type: 'reply',
                topicId: actionTopic.id,
                content,
                replyToPostNumber: target?.floor
              },
              trace,
              ticket
            );
          }
          sentContent = await materializeNodeSeekPolls({
            content,
            polls: submittedNodeSeekPolls,
            ticket,
            trace
          });
          return runNodeSeekRequest(
            buildNodeSeekReplyRequest({
              postId: actionTopic.id,
              content: sentContent,
              replyTarget: target,
              csrfToken: ''
            }),
            trace,
            ticket
          );
        },
        applyResult: () => {
          if (topicCommands.getCurrentKey() === actionTopicKey) topicComposer.completeSubmission();
          const { detailKey, replyKeys } = cacheKeys(actionTopic as TopicDetail);
          void queryClient.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'none' });
          replyKeys.forEach(
            (repliesKey) =>
              void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' })
          );
        },
        afterSuccess: () =>
          refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
            kind: 'created',
            silent: true
          }),
        successMessage: '回复已提交'
      });
    },
    [
      cacheKeys,
      detachReplyEdit,
      executeMutation,
      materializeNodeSeekPolls,
      notify,
      queryClient,
      refreshRepliesAfterWrite,
      replyComposerIntent,
      replyComposerIntentRef,
      replyContent,
      replyFace,
      runLinuxDoRequest,
      runNodeSeekRequest,
      runYaohuoRequest,
      selectedTopic,
      siteSessionViewModels.nodeseek.currentUser?.id,
      topicCommands,
      topicComposer,
      topicDetail
    ]
  );

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
      const refreshTarget: ReplyRefreshTarget = isYaohuoActionTopic(actionTopic)
        ? { kind: 'delete-path', deletePath: reply.deletePath! }
        : { kind: 'comment-id', commentId: reply.commentId! };
      const actionTopicKey = topicKey(actionTopic);
      const targetPosition = replyCursorFor(
        queryClient.getQueryData<ReplyCache>(cacheKeys(actionTopic as TopicDetail).repliesKey),
        refreshTarget
      );
      const patch = () => {
        const { detailKey, replyKeys } = cacheKeys(actionTopic as TopicDetail);
        replyKeys.forEach((repliesKey) =>
          updateReplyCache(queryClient, repliesKey, (replies) => removeRepliesForRefresh(replies, refreshTarget))
        );
        queryClient.setQueryData<TopicDetail>(detailKey, (current) =>
          current
            ? {
                ...current,
                ...(typeof current.replyCount === 'number' ? { replyCount: Math.max(0, current.replyCount - 1) } : {}),
                replies: removeRepliesForRefresh(current.replies, refreshTarget)
              }
            : current
        );
      };
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: topicDeleteReplyActionKey(actionTopicKey, refreshTarget),
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
            : runLinuxDoRequest(
                {
                  type: 'delete-post',
                  postId: reply.commentId || 0
                },
                trace,
                ticket
              ),
        applyResult: (_result, { replyKeys }) => {
          patch();
          replyKeys.forEach(
            (repliesKey) =>
              void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' })
          );
        },
        afterSuccess: () =>
          refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
            kind: 'deleted',
            silent: true,
            target: refreshTarget,
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
      runLinuxDoRequest,
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

  const uploadReplyImageMarkup = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('reply', 'image-upload', actionTopic ? { source: actionTopic.source } : {});
    if (replyComposerIntentRef.current.kind === 'closed') {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
    const editTarget = replyComposerIntent.kind === 'edit' ? replyComposerIntent.target : null;
    if (!actionTopic || !canSubmitReplyToTopic(actionTopic)) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return;
    }
    if (!replyImageUploadSupported(actionTopic.source)) {
      notify('当前来源暂不支持上传图片');
      finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
      return;
    }
    const actionTopicKey = topicKey(actionTopic);
    let uploadedMarkup = '';
    await executeMutation(actionTopic as TopicDetail, {
      actionKey: `${topicReplyActionKey(actionTopicKey)}:image`,
      busy: true,
      decision: {
        action: 'upload',
        objectAllowed: Boolean(editTarget) || canSubmitReplyToTopic(actionTopic)
      },
      ...(editTarget ? { editTarget } : {}),
      trace,
      task: async (ticket) => {
        const editRepliesKey = editTarget ? cacheKeys(actionTopic as TopicDetail, ticket).repliesKey : null;
        const assertCurrentEditTarget = (serverConfirmed = false) => {
          if (
            !editTarget ||
            !editRepliesKey ||
            replyEditTargetIsCurrent(
              editTarget,
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
          const result = await runLinuxDoRequest({ type: 'upload', file }, trace, ticket, () =>
            assertCurrentEditTarget()
          );
          imageUrl = discourseImageUrlFromUploadResponse(result, LINUXDO_BASE_URL, 'linux.do');
        } else if (isYaohuoActionTopic(actionTopic)) {
          imageUrl = await uploadYaohuoReplyImage({
            fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
            file
          });
        } else if (isNodeSeekActionTopic(actionTopic)) {
          try {
            imageUrl = await uploadNodeSeekReplyImageWithApiKey({
              ensureApiKey: async () => nodeSeekApiKey,
              fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
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
        const uploaded = result as { imageUrl: string; name: string };
        uploadedMarkup = replyImageMarkupForSource(actionTopic.source, uploaded.imageUrl, uploaded.name);
      },
      successMessage: '图片已插入'
    });
    return uploadedMarkup || undefined;
  }, [
    cacheKeys,
    detachReplyEdit,
    ensureNodeImageApiKey,
    executeMutation,
    authenticatedFetcher,
    notify,
    queryClient,
    replyComposerIntent,
    replyComposerIntentRef,
    runLinuxDoRequest,
    selectedTopic,
    topicDetail
  ]);

  const uploadReplyImage = useCallback(async () => {
    const markup = await uploadReplyImageMarkup();
    if (markup) topicComposer.appendMarkup(markup);
    return markup;
  }, [topicComposer, uploadReplyImageMarkup]);

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
            runLinuxDoRequest(
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
      runLinuxDoRequest,
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
    const patch = (active: boolean, bookmarkId?: number) =>
      updateBookmarkCache(queryClient, cacheKeys(actionDetail).detailKey, active, bookmarkId);
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
      successMessage: bookmarked ? '已取消收藏' : '收藏已提交'
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
      successMessage: collected ? '已取消收藏' : '收藏已提交'
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
    const patch = (active: boolean, bookmarkId?: number) =>
      updateBookmarkCache(queryClient, cacheKeys(actionDetail).detailKey, active, bookmarkId);
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
        runLinuxDoRequest(
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
      successMessage: bookmarked ? '已取消收藏' : '收藏已提交'
    });
  }, [cacheKeys, executeMutation, queryClient, runLinuxDoRequest, selectedTopic, topicDetail]);

  const readNodeSeekStardustStatus = useCallback(
    (receive: NodeSeekStardustReceive, trace: DiagnosticTrace) =>
      fetchNodeSeekStardustStatus({
        currentMemberId: nodeSeekUserId ? String(nodeSeekUserId) : undefined,
        fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
        receive,
        userAgent: getNodeSeekUserAgent()
      }),
    [authenticatedFetcher, getNodeSeekUserAgent, nodeSeekUserId]
  );

  const loadNodeSeekStardustStatus = useCallback(
    async (receive: NodeSeekStardustReceive) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const trace = beginDiagnosticTrace('topic', 'stardust-status', {
        ...(actionTopic ? { source: actionTopic.source } : {})
      });
      if (!isNodeSeekActionTopic(actionTopic)) {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        throw new Error('当前主题不支持 Stardust');
      }
      try {
        const status = await readNodeSeekStardustStatus(receive, trace);
        finishDiagnosticTrace(trace, 'success', { source: 'nodeseek' });
        return status;
      } catch (error) {
        finishDiagnosticTrace(trace, 'failure', {
          source: 'nodeseek',
          reason: normalizeDiagnosticReason(error)
        });
        throw error;
      }
    },
    [readNodeSeekStardustStatus, selectedTopic, topicDetail]
  );

  const payNodeSeekStardust = useCallback(
    async (receive: NodeSeekStardustReceive): Promise<'submitted' | 'canceled' | 'failed' | 'unknown'> => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const trace = beginDiagnosticTrace('topic', 'stardust-payment', {
        ...(actionTopic ? { source: actionTopic.source } : {})
      });
      if (!isNodeSeekActionTopic(actionTopic)) {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        notify('当前主题不支持 Stardust');
        return 'failed';
      }
      let sendRequest: NodeSeekActionRequest;
      try {
        sendRequest = buildNodeSeekStardustSendRequest({ receive });
      } catch (error) {
        const message = errorMessage(error);
        finishDiagnosticTrace(trace, 'failure', { source: 'nodeseek', reason: 'invalid_request' });
        notify(message);
        return 'failed';
      }
      let outcome: 'submitted' | 'canceled' | 'failed' | 'unknown' = 'failed';
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: 'stardust-payment',
        busy: true,
        decision: { action: 'pay' },
        trace,
        task: async (ticket) => {
          const prepareResult = await runNodeSeekRequest(
            buildNodeSeekStardustPrepareRequest({ receiverId: receive.receiverMemberId }),
            trace,
            ticket
          );
          let receiverName: string;
          try {
            receiverName = nodeSeekStardustReceiverName(prepareResult);
          } catch (error) {
            const message = errorMessage(error);
            notify(message);
            throw new HandledMutationError(message, 'failure', 'invalid_response', false, true);
          }
          if (!(await confirmNodeSeekStardustPayment(receive, receiverName))) {
            outcome = 'canceled';
            throw new HandledMutationError('已取消付款', 'canceled', 'canceled');
          }
          assertWritableTicket(ticket);
          try {
            const sendResult = await runNodeSeekRequest(sendRequest, trace, ticket, false);
            if (
              !sendResult ||
              typeof sendResult !== 'object' ||
              Array.isArray(sendResult) ||
              (sendResult as { success?: unknown }).success !== true
            ) {
              throw new Error('NodeSeek 返回内容格式不正确');
            }
          } catch (error) {
            if (isRawUnauthorized(error)) throw error;
            if (error instanceof HandledMutationError && error.serverRejected) {
              notify(error.message);
              throw error;
            }
            outcome = 'unknown';
            const message = '付款结果未知，请勿直接重发；请先在原站确认付款记录';
            notify(message);
            throw new HandledMutationError(message, 'failure', 'invalid_response');
          }
          outcome = 'submitted';
          return null;
        },
        successMessage: '付款已由 NodeSeek 确认'
      });
      return outcome;
    },
    [assertWritableTicket, executeMutation, notify, runNodeSeekRequest, selectedTopic, topicDetail]
  );

  const loadLinuxDoTemplates = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('reply', 'load-templates', {
      ...(actionTopic ? { source: actionTopic.source } : {})
    });
    if (!actionTopic || actionTopic.source !== 'linuxdo') {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      throw new Error('当前入口不支持 LinuxDo 模板');
    }
    try {
      const ticket = await ensureWritableSession('linuxdo');
      assertWritableTicket(ticket);
      const templates = await fetchLinuxDoTemplates({
        fetcher: withFetchGuard(withDiagnosticFetcher(trace, authenticatedFetcher), () => assertWritableTicket(ticket)),
        userAgent: linuxDoUserAgent()
      });
      assertWritableTicket(ticket);
      finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', itemCount: templates.length });
      return templates;
    } catch (error) {
      const message = errorMessage(error);
      if (isLoginRequiredError(error)) {
        showLinuxDoVerification(message);
      }
      finishDiagnosticTrace(trace, 'failure', { source: 'linuxdo', reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, [
    assertWritableTicket,
    authenticatedFetcher,
    linuxDoUserAgent,
    showLinuxDoVerification,
    ensureWritableSession,
    selectedTopic,
    topicDetail
  ]);

  const loadLinuxDoPollCapabilities = useCallback(async () => {
    const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
    const trace = beginDiagnosticTrace('reply', 'load-poll-capabilities', {
      ...(actionTopic ? { source: actionTopic.source } : {})
    });
    if (!actionTopic || actionTopic.source !== 'linuxdo') {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      throw new Error('当前入口不支持 LinuxDo 投票配置');
    }
    try {
      const ticket = await ensureWritableSession('linuxdo');
      assertWritableTicket(ticket);
      const capabilities = await fetchLinuxDoPollCapabilities({
        fetcher: withFetchGuard(withDiagnosticFetcher(trace, authenticatedFetcher), () => assertWritableTicket(ticket)),
        userAgent: linuxDoUserAgent()
      });
      assertWritableTicket(ticket);
      finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', itemCount: capabilities.groups.length });
      return capabilities;
    } catch (error) {
      const message = errorMessage(error);
      if (isLoginRequiredError(error)) {
        showLinuxDoVerification(message);
      }
      finishDiagnosticTrace(trace, 'failure', { source: 'linuxdo', reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, [
    assertWritableTicket,
    authenticatedFetcher,
    linuxDoUserAgent,
    showLinuxDoVerification,
    ensureWritableSession,
    selectedTopic,
    topicDetail
  ]);

  const useLinuxDoTemplate = useCallback(
    async (id: string) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const trace = beginDiagnosticTrace('reply', 'use-template', {
        ...(actionTopic ? { source: actionTopic.source } : {})
      });
      if (!actionTopic || actionTopic.source !== 'linuxdo') {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        throw new Error('当前入口不支持 LinuxDo 模板');
      }
      try {
        const ticket = await ensureWritableSession('linuxdo');
        assertWritableTicket(ticket);
        await recordLinuxDoTemplateUse({
          fetcher: withFetchGuard(withDiagnosticFetcher(trace, authenticatedFetcher), () =>
            assertWritableTicket(ticket)
          ),
          id,
          userAgent: linuxDoUserAgent()
        });
        assertWritableTicket(ticket, true);
        finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', serverConfirmed: true });
      } catch (error) {
        const message = errorMessage(error);
        if (isLoginRequiredError(error)) {
          showLinuxDoVerification(message);
        }
        finishDiagnosticTrace(trace, 'failure', { source: 'linuxdo', reason: normalizeDiagnosticReason(error) });
        throw error;
      }
    },
    [
      assertWritableTicket,
      authenticatedFetcher,
      linuxDoUserAgent,
      showLinuxDoVerification,
      ensureWritableSession,
      selectedTopic,
      topicDetail
    ]
  );

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
                  fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
                  userAgent: getNodeSeekUserAgent()
                });
                return { confirmedPoll, refreshFailed: false };
              } catch (error) {
                if (isRawUnauthorized(error)) throw error;
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
              await runLinuxDoRequest(
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
            applyPollResult({
              actionTopic: actionTopic as TopicDetail,
              confirmedPoll: voteResult.confirmedPoll,
              optionIds,
              poll,
              preserveUnknownCounts: voteResult.refreshFailed
            });
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
      applyPollResult,
      executeMutation,
      authenticatedFetcher,
      getNodeSeekUserAgent,
      notify,
      runLinuxDoRequest,
      runNodeSeekRequest,
      runYaohuoRequest,
      selectedTopic,
      topicDetail
    ]
  );

  const lockNodeSeekPoll = useCallback(
    async (poll: TopicPoll) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const trace = beginDiagnosticTrace('topic', 'manage-poll', {
        ...(actionTopic ? { source: actionTopic.source } : {})
      });
      if (!isNodeSeekActionTopic(actionTopic) || !poll.id) {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        return;
      }
      const actionDetail = actionTopic as TopicDetail;
      const pollId = poll.id;
      const initialDecision = decisionFor({ action: 'manage-poll', poll });
      if (!initialDecision.allowed) {
        const message = topicActionDecisionMessage(initialDecision);
        if (message) notify(message);
        finishDiagnosticTrace(trace, 'blocked', { source: 'nodeseek', reason: initialDecision.reason });
        return;
      }
      const submit = async () => {
        await executeMutation(actionDetail, {
          actionKey: `lock:${topicPollVoteActionKey(topicKey(actionTopic), poll)}`,
          busy: true,
          decision: { action: 'manage-poll', poll },
          trace,
          task: async (ticket) => {
            try {
              await runNodeSeekRequest(buildNodeSeekPollLockRequest({ pollId }), trace, ticket, false);
            } catch (error) {
              if (
                isRawUnauthorized(error) ||
                (error instanceof HandledMutationError && (error.serverConfirmed || error.serverRejected))
              ) {
                if (error instanceof HandledMutationError && error.serverRejected) notify(error.message);
                throw error;
              }
              try {
                assertWritableTicket(ticket);
                const reconciledPoll = await fetchNodeSeekVoteInfo({
                  pollId,
                  fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
                  userAgent: getNodeSeekUserAgent()
                });
                assertWritableTicket(ticket);
                if (reconciledPoll.closed) return { confirmedPoll: reconciledPoll, refreshFailed: false };
              } catch (reconcileError) {
                if (isRawUnauthorized(reconcileError)) throw reconcileError;
              }
              notify('投票锁定结果未知，请刷新原站确认，切勿重复提交。');
              throw error;
            }
            try {
              assertWritableTicket(ticket, true);
              const confirmedPoll = await fetchNodeSeekVoteInfo({
                pollId,
                fetcher: withDiagnosticFetcher(trace, authenticatedFetcher),
                userAgent: getNodeSeekUserAgent()
              });
              assertWritableTicket(ticket, true);
              return { confirmedPoll, refreshFailed: false };
            } catch (error) {
              if (error instanceof HandledMutationError && error.reason === 'stale') throw error;
              hintDiagnosticOutcome(trace, 'partial', { source: 'nodeseek', reason: 'refresh_failed' });
              return { confirmedPoll: { ...poll, closed: true }, refreshFailed: true };
            }
          },
          applyResult: (result) => {
            const lockResult = result as { confirmedPoll: TopicPoll; refreshFailed: boolean };
            applyPollResult({
              actionTopic: actionDetail,
              confirmedPoll: lockResult.confirmedPoll,
              optionIds: [],
              poll
            });
            if (lockResult.refreshFailed) notify('锁定成功但结果刷新失败，请手动刷新。');
          },
          successMessage: (result) => ((result as { refreshFailed: boolean }).refreshFailed ? '' : '投票已锁定')
        });
      };
      let handled = false;
      Alert.alert(
        '锁定投票？',
        '锁定后普通作者无法重新开启，且不能继续投票。',
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => {
              handled = true;
              finishDiagnosticTrace(trace, 'canceled', { source: 'nodeseek', reason: 'canceled' });
            }
          },
          {
            text: '锁定',
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
            if (!handled) finishDiagnosticTrace(trace, 'canceled', { source: 'nodeseek', reason: 'canceled' });
          }
        }
      );
    },
    [
      assertWritableTicket,
      applyPollResult,
      authenticatedFetcher,
      decisionFor,
      executeMutation,
      getNodeSeekUserAgent,
      notify,
      runNodeSeekRequest,
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
    loadNodeSeekStardustStatus,
    loadLinuxDoPollCapabilities,
    loadLinuxDoTemplates,
    lockNodeSeekPoll,
    payNodeSeekStardust,
    submitReply,
    uploadReplyImage,
    uploadReplyImageMarkup,
    useLinuxDoTemplate,
    votePoll
  };
}

export type TopicActionsController = ReturnType<typeof useTopicActionsController>;
