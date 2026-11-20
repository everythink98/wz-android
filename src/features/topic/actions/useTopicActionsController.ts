import {
  createDiscoursePolicyOperation,
  policyRequestBusy,
  type PolicyOperationSnapshot
} from '@/domain/forum/discoursePolicyOperation';
import { resolveLinuxDoUpload as fetchLinuxDoUploadUrl } from '@/sources/linuxdo/uploadUrls';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  queryOptions,
  useMutation,
  useMutationState,
  useQueryClient,
  type InfiniteData,
  type QueryKey
} from '@tanstack/react-query';
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
  nodeSeekCreatedReplyTarget,
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
  discourseCreatedReplyTarget,
  discourseImageUrlFromUploadResponse,
  type DiscourseAction
} from '@/sources/discourse/actionRequest';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { linuxDoEditedReplyFromAction } from '@/sources/linuxdo/reader';
import { fetchNodeSeekVoteInfo, runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { runYaohuoAction } from '@/sources/yaohuo/actionClient';
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
import {
  discourseBoostStats,
  discourseReactionPreview,
  type DiscourseInteractionPatch
} from '@/domain/forum/discourseInteractions';
import { discoursePostFields } from '@/sources/discourse/model';
import { linuxDoBoostFromData } from '@/sources/linuxdo/boosts';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { setLinuxDoPolicyAcceptance } from '@/sources/linuxdo/policy';
import type { ReplyEditTarget, ReplyRefreshCommand, ReplyRefreshTarget } from '../model/types';
import { topicKey } from '@/domain/reader/readerData';
import {
  rejectUnauthorizedResponse,
  withFetchGuard,
  withRequestBeforeSend,
  type Fetcher,
  type RequestDispatchState
} from '@/platform/network/request';
import type { ReadGateway } from '@/sources/readGateway';
import { errorMessage } from '@/platform/network/errors';
import { canToggleDiscourseLike } from '@/sources/discourse/permissions';
import { isDiscourseSource, isSessionSource } from '@/domain/forum/sourceCatalog';
import {
  MAX_REPLY_IMAGE_UPLOAD_BYTES,
  normalizeReplyImageAsset,
  replyImageMarkupForSource,
  replyImageUploadSupported
} from '@/sources/imageUpload';
import { withPickedAttachmentCopies } from '@/platform/media/pickedAttachmentCopies';
import { isNodeImageApiKeyExpiredError, uploadNodeSeekReplyImageWithApiKey } from '@/sources/nodeimage/upload';
import { uploadYaohuoReplyImage } from '@/sources/yaohuo/imageUpload';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import type { SessionSite, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { nodeSeekUserIdForSession, siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import {
  diagnosticRef,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import type { TopicSessionController } from '../useTopicSessionController';
import type {
  ComposerSnapshot,
  ComposerSubmissionSettlement,
  NodeSeekStardustReceive,
  PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import { nodeSeekStardustMarkerRanges } from '@/domain/forum/structuredComposer';
import {
  materializePendingNodeSeekPolls,
  PendingNodeSeekPollError,
  type PendingNodeSeekPollCreation
} from '@/sources/nodeseek/pendingPolls';
import { fetchNodeSeekStardustStatus, nodeSeekStardustReceiverName } from '@/sources/nodeseek/stardust';
import { fetchLinuxDoTemplates, recordLinuxDoTemplateUse } from '@/sources/linuxdo/templates';
import { fetchLinuxDoPollCapabilities } from '@/sources/linuxdo/pollCapabilities';
import { forumMutationKeys, forumQueryKeys, forumReplyWindowKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { RequestAccountRecheck } from '@/domain/session/sessionContracts';
import { errorRequiresAccountRecheck } from '@/sources/sourceErrors';
import {
  canSubmitReplyToTopic,
  canVotePollOnTopic,
  currentTopicActionTopic,
  applyEditedReplyContent,
  isNodeSeekActionTopic,
  isYaohuoActionTopic,
  matchesReplyRefreshTarget,
  removeRepliesForRefresh,
  replaceConfirmedReplyBody,
  topicEditReplyActionKey,
  topicPollVoteActionKey,
  topicReplyActionKey,
  updateConfirmedReplyCaches,
  yaohuoFavoriteActionKey,
  YAOHUO_DEFAULT_CLASS_ID
} from './actionHelpers';
import { WritableSessionBlockedError, type WritableSessionTicket } from '@/domain/session/writableSessionGate';
import { readManagedCookieHeader } from '@/platform/network/managedCookies';
import { YAOHUO_BASE_URL } from '@/sources/yaohuo/protocol';
import { LINUXDO_BASE_URL } from '@/sources/linuxdo/protocol';
import { replyKey } from '@/domain/forum/feed';
import {
  decideTopicAction,
  topicActionDecisionMessage,
  type TopicActionDecisionFor,
  type TopicActionDecisionRequest
} from './topicActionDecision';

type ReplyCache = InfiniteData<{ items: Reply[]; [key: string]: unknown }, unknown>;

type MutationCompletion = {
  applyResult?: (variables: MutationVariables) => void | Promise<void>;
  afterSuccess?: (variables: MutationVariables) => Promise<boolean>;
  successMessage?: string | ((refreshed: boolean | undefined) => string);
};

type ActionCacheKeys = {
  detailKey: QueryKey;
  replyKeys: readonly QueryKey[];
  repliesKey: QueryKey;
  repliesReadPlanScope: string;
  quotedReplyKey?: QueryKey;
};

type MutationVariables = ActionCacheKeys & {
  actionKey: string;
  busy: boolean;
  decision: TopicActionDecisionRequest;
  ticket: WritableSessionTicket;
  source: Source;
  task: (ticket: WritableSessionTicket) => Promise<MutationCompletion>;
  topicId: string;
  trace: DiagnosticTrace;
  isCurrent?: () => boolean;
  editTarget?: ReplyEditTarget;
  applyOptimistic?: () => void | (() => void);
};

type MutationInput = Omit<MutationVariables, keyof ActionCacheKeys | 'ticket' | 'source' | 'topicId'>;

const NODEIMAGE_API_KEY_UNAVAILABLE_MESSAGE = 'NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴';
const STALE_REPLY_EDIT_MESSAGE = '回复内容或编辑权限已变化。草稿已保留，请复制需要的内容后重新打开编辑。';

class HandledMutationError extends Error {
  constructor(
    message: string,
    readonly outcome: 'blocked' | 'canceled' | 'failure' | 'stale',
    readonly reason: ReturnType<typeof normalizeDiagnosticReason>,
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

type ReplyDelivery = { dispatchState: RequestDispatchState; status?: number };

function observeReplyDelivery(fetcher: Fetcher, delivery?: ReplyDelivery): Fetcher {
  if (!delivery) return fetcher;
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (init?.method === 'POST') delivery.status = response.status;
    return response;
  };
}

function replyDeliveryIsUnconfirmed(delivery: ReplyDelivery, error: unknown) {
  if (!delivery.dispatchState.mayHaveSent || isRawUnauthorized(error)) return false;
  if (error instanceof HandledMutationError && error.serverConfirmed) return false;
  if (delivery.status !== undefined) {
    if (delivery.status >= 500 || delivery.status === 408 || delivery.status === 409) return true;
    if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(delivery.status)) return false;
  }
  return !(error instanceof HandledMutationError && error.serverRejected);
}

type NodeSeekRequestOptions = {
  beforeSend?: () => void;
  notifyFailure?: boolean;
  pollCreation?: PendingNodeSeekPollCreation;
  replyDelivery?: ReplyDelivery;
};

type LinuxDoRequestOptions = {
  beforeSend?: () => void;
  dispatchState?: RequestDispatchState;
  replyDelivery?: ReplyDelivery;
};

function confirmTopicAction(
  title: string,
  message: string,
  confirmLabel: string,
  submit: () => void,
  onCancel?: () => void
) {
  let phase: 'pending' | 'consumed' = 'pending';
  const cancel = () => {
    if (phase === 'consumed') return;
    phase = 'consumed';
    onCancel?.();
  };
  Alert.alert(
    title,
    message,
    [
      {
        text: '取消',
        style: 'cancel',
        onPress: cancel
      },
      {
        text: confirmLabel,
        style: 'destructive',
        onPress: () => {
          if (phase === 'consumed') return;
          phase = 'consumed';
          submit();
        }
      }
    ],
    {
      cancelable: true,
      onDismiss: cancel
    }
  );
}

function confirmNodeSeekPollReplacement(poll: PendingNodeSeekPoll) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      '投票内容已修改',
      `“${poll.title}”已经分配过远端投票。NodeSeek 不支持修改远端投票；继续会创建一个新投票，旧投票会保留。`,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: '创建新投票', onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

function confirmNodeSeekStardustPayment(receive: NodeSeekStardustReceive, receiverName: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      '确认 Stardust 付款？',
      `收款人 ${receiverName} (#${receive.receiverMemberId})\n金额 ${receive.amount} Stardust\n\n付款提交后不可退回。`,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: '确认付款', style: 'destructive', onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
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

function toggleBookmarkOptimistically(
  patch: (active: boolean, bookmarkId?: number) => void,
  bookmarked: boolean,
  detail: TopicDetail
) {
  patch(!bookmarked, bookmarked ? undefined : detail.bookmarkId);
  return () => patch(bookmarked, detail.bookmarkId);
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
  let matchingReply: Reply | undefined;
  for (const page of cachedReplies?.pages || []) {
    for (const reply of page.items) {
      if (reply.commentId !== target.commentId) continue;
      if (
        reply.canEdit !== true ||
        reply.contentMarkdown !== target.contentMarkdown ||
        reply.replyLocationConflict === 'identity'
      )
        return false;
      if (
        matchingReply &&
        (reply.author !== matchingReply.author ||
          reply.authorId !== matchingReply.authorId ||
          reply.authorUrl !== matchingReply.authorUrl ||
          reply.contentHtml !== matchingReply.contentHtml ||
          reply.createdAt !== matchingReply.createdAt)
      )
        return false;
      matchingReply = reply;
    }
  }
  return Boolean(matchingReply);
}

type TopicActionsRuntime = {
  active: boolean;
  isRouteFocused?: () => boolean;
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
  requestAccountRecheck: RequestAccountRecheck;
  readGateway: Pick<ReadGateway, 'getReadPlan' | 'getReply' | 'getLinuxDoInteractionConfig' | 'getEmojiUrls'>;
  replyWindowOwner?: string;
  refreshTopicReplies: (command?: ReplyRefreshCommand, trace?: DiagnosticTrace) => Promise<unknown>;
  refreshWholeTopic: () => Promise<unknown>;
  siteSessionViewModels: SiteSessionViewModels;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicSession: TopicSessionController;
};
type TopicActionExecutor = (topic: TopicDetail, variables: MutationInput) => Promise<boolean>;
type TopicActionRequests = {
  runNodeSeekRequest(
    request: NodeSeekActionRequest,
    trace: DiagnosticTrace,
    ticket: WritableSessionTicket,
    options?: NodeSeekRequestOptions
  ): Promise<unknown>;
  runLinuxDoRequest(
    request: DiscourseAction,
    trace: DiagnosticTrace,
    ticket: WritableSessionTicket,
    options?: LinuxDoRequestOptions
  ): Promise<unknown>;
  runYaohuoRequest(
    request: (cookieHeader: string) => YaohuoActionRequest,
    trace: DiagnosticTrace,
    ticket: WritableSessionTicket,
    replyDelivery?: ReplyDelivery,
    beforeSend?: () => void
  ): Promise<unknown>;
};
type PollResultApplication = {
  actionTopic: TopicDetail;
  confirmedPoll?: TopicPoll;
  optionIds: string[];
  poll: TopicPoll;
  preserveUnknownCounts?: boolean;
};
type TopicPollActionsInput = Pick<TopicActionsRuntime, 'topicDetail' | 'getNodeSeekUserAgent' | 'notify'> &
  TopicActionRequests & {
    selectedTopic: TopicSessionController['state']['selectedTopic'];
    executeMutation: TopicActionExecutor;
    decisionFor: TopicActionDecisionFor;
    captureConfirmation(): () => boolean;
    assertWritableTicket(ticket: WritableSessionTicket, serverConfirmed?: boolean): void;
    authenticatedFetcher: Fetcher;
    applyPollResult(input: PollResultApplication): void;
  };
type TopicReplyActionsInput = Pick<
  TopicActionsRuntime,
  | 'active'
  | 'sessionEpochs'
  | 'ensureWritableSession'
  | 'isWritableSessionTicketCurrent'
  | 'notify'
  | 'siteSessionViewModels'
  | 'topicDetail'
  | 'topicReplies'
  | 'topicSession'
> &
  TopicActionRequests & {
    executeMutation: TopicActionExecutor;
    decisionFor: TopicActionDecisionFor;
    captureConfirmation(): () => boolean;
    getReplyComposerIntent(): TopicSessionController['state']['replyComposerIntent'];
    assertReplyNotEnded(): void;
    cacheKeys(topic: TopicDetail, ticket?: WritableSessionTicket): ActionCacheKeys;
    queryClient: ReturnType<typeof useQueryClient>;
    refreshRepliesAfterWrite(
      topic: TopicDetail,
      trace: DiagnosticTrace,
      command: ReplyRefreshCommand
    ): Promise<boolean>;
    materializeNodeSeekPolls(input: {
      content: string;
      polls: PendingNodeSeekPoll[];
      ticket: WritableSessionTicket;
      trace: DiagnosticTrace;
      confirmReplacement(poll: PendingNodeSeekPoll): Promise<boolean>;
      beforeSend(): void;
    }): Promise<string>;
  };

function useTopicPollActions({
  topicDetail,
  selectedTopic,
  getNodeSeekUserAgent,
  notify,
  executeMutation,
  captureConfirmation,
  decisionFor,
  assertWritableTicket,
  authenticatedFetcher,
  applyPollResult,
  runNodeSeekRequest,
  runLinuxDoRequest,
  runYaohuoRequest
}: TopicPollActionsInput) {
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
      const submit = async (isCurrent?: () => boolean) => {
        await executeMutation(actionTopic as TopicDetail, {
          actionKey: topicPollVoteActionKey(topicKey(actionTopic), poll),
          busy: true,
          decision: { action: 'vote', poll, targetPresent: optionIds.length > 0 },
          trace,
          isCurrent,
          task: async (ticket) => {
            const result = await (async () => {
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
            })();
            return {
              applyResult: () => {
                const voteResult = result;
                applyPollResult({
                  actionTopic: actionTopic as TopicDetail,
                  confirmedPoll: voteResult.confirmedPoll,
                  optionIds,
                  poll,
                  preserveUnknownCounts: voteResult.refreshFailed
                });
                if (voteResult.refreshFailed) notify('提交成功但结果刷新失败，请手动刷新。');
              },
              successMessage: () => (result.refreshFailed ? '' : '投票已提交')
            };
          }
        });
      };
      if (!isNodeSeekActionTopic(actionTopic)) {
        await submit();
        return;
      }
      const isCurrent = captureConfirmation();
      confirmTopicAction(
        '确认提交投票？',
        '提交后不可修改。',
        '提交',
        () => void submit(isCurrent),
        () => finishDiagnosticTrace(trace, 'canceled', { source: actionTopic.source, reason: 'canceled' })
      );
    },
    [
      applyPollResult,
      executeMutation,
      captureConfirmation,
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
        finishDiagnosticTrace(trace, 'blocked', {
          source: 'nodeseek',
          reason: normalizeDiagnosticReason({ reason: initialDecision.reason })
        });
        return;
      }
      const isCurrent = captureConfirmation();
      const submit = async () => {
        await executeMutation(actionDetail, {
          actionKey: `lock:${topicPollVoteActionKey(topicKey(actionTopic), poll)}`,
          busy: true,
          decision: { action: 'manage-poll', poll },
          trace,
          isCurrent,
          task: async (ticket) => {
            const result = await (async () => {
              try {
                await runNodeSeekRequest(buildNodeSeekPollLockRequest({ pollId }), trace, ticket, {
                  notifyFailure: false
                });
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
            })();
            return {
              applyResult: () => {
                const lockResult = result;
                applyPollResult({
                  actionTopic: actionDetail,
                  confirmedPoll: lockResult.confirmedPoll,
                  optionIds: [],
                  poll
                });
                if (lockResult.refreshFailed) notify('锁定成功但结果刷新失败，请手动刷新。');
              },
              successMessage: () => (result.refreshFailed ? '' : '投票已锁定')
            };
          }
        });
      };
      confirmTopicAction(
        '锁定投票？',
        '锁定后普通作者无法重新开启，且不能继续投票。',
        '锁定',
        () => void submit(),
        () => finishDiagnosticTrace(trace, 'canceled', { source: 'nodeseek', reason: 'canceled' })
      );
    },
    [
      assertWritableTicket,
      applyPollResult,
      authenticatedFetcher,
      decisionFor,
      executeMutation,
      captureConfirmation,
      getNodeSeekUserAgent,
      notify,
      runNodeSeekRequest,
      selectedTopic,
      topicDetail
    ]
  );
  return { votePoll, lockNodeSeekPoll };
}

function useTopicReplyActions({
  active,
  sessionEpochs,
  ensureWritableSession,
  isWritableSessionTicketCurrent,
  notify,
  siteSessionViewModels,
  topicDetail,
  topicReplies,
  topicSession,
  executeMutation,
  captureConfirmation,
  decisionFor,
  getReplyComposerIntent,
  assertReplyNotEnded,
  cacheKeys,
  queryClient,
  refreshRepliesAfterWrite,
  materializeNodeSeekPolls,
  runNodeSeekRequest,
  runLinuxDoRequest,
  runYaohuoRequest
}: TopicReplyActionsInput) {
  const {
    state: { replyComposerIntent, replyContent, replyFace, selectedTopic },
    commands: { composer: topicComposer, topic: topicCommands }
  } = topicSession;
  const detail = currentTopicActionTopic(topicDetail, selectedTopic);
  const editOpenScope =
    detail && isSessionSource(detail.source) ? `${topicKey(detail)}:${sessionEpochs[detail.source]}` : '';
  const pendingEditOpen = useRef<object | null>(null);
  const uncertainReplies = useRef(new Set<string>());
  useLayoutEffect(
    () => () => {
      pendingEditOpen.current = null;
    },
    [active, editOpenScope]
  );
  const detachReplyEdit = topicComposer.detachEdit;
  const openReplyEditor = topicComposer.editReply;
  const editReply = useCallback(
    async (reply: Reply) => {
      if (!active) return;
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
      const request = {};
      pendingEditOpen.current = request;
      const revision = topicComposer.getDraftRevision();
      const ownsRequest = () => pendingEditOpen.current === request && topicComposer.getDraftRevision() === revision;
      try {
        const ticket = await ensureWritableSession(actionTopic.source);
        if (!ownsRequest()) return;
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
        if (ownsRequest()) notify(errorMessage(error));
      } finally {
        if (pendingEditOpen.current === request) pendingEditOpen.current = null;
      }
    },
    [
      active,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      notify,
      selectedTopic,
      openReplyEditor,
      topicComposer,
      topicDetail
    ]
  );
  const submitReply = useCallback(
    async (snapshot?: ComposerSnapshot, settleSubmission?: ComposerSubmissionSettlement) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const submittedContent = snapshot?.markdown ?? replyContent;
      const submittedDraftRevision = topicComposer.getDraftRevision();
      const submittedNodeSeekPolls = snapshot?.pendingNodeSeekPolls || [];
      const trace = beginDiagnosticTrace('reply', replyComposerIntent.kind === 'edit' ? 'edit' : 'submit', {
        ...(actionTopic ? { source: actionTopic.source } : {}),
        contentLength: submittedContent.length
      });
      if (getReplyComposerIntent().kind === 'closed') {
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
      const ownsConfirmation = captureConfirmation();
      let requiresLiveConfirmation = false;
      const canConfirm = () =>
        ownsConfirmation() &&
        getReplyComposerIntent() === replyComposerIntent &&
        topicComposer.getDraftRevision() === submittedDraftRevision;
      const acceptConfirmation = () => {
        if (!canConfirm()) return false;
        requiresLiveConfirmation = true;
        return true;
      };
      const beforeSend = () => {
        if (requiresLiveConfirmation && !ownsConfirmation())
          throw new HandledMutationError('回复确认已取消', 'canceled', 'canceled');
      };
      const confirmReplacement = async (poll: PendingNodeSeekPoll) =>
        canConfirm() && (await confirmNodeSeekPollReplacement(poll)) && acceptConfirmation();
      const settleReply = async (ticket: WritableSessionTicket) => {
        const complete = () => {
          if (
            !isWritableSessionTicketCurrent(ticket) ||
            topicCommands.getCurrentKey() !== actionTopicKey ||
            getReplyComposerIntent() !== replyComposerIntent
          )
            return false;
          return topicComposer.completeSubmission(settleSubmission ? undefined : submittedDraftRevision);
        };
        if (
          !isWritableSessionTicketCurrent(ticket) ||
          topicCommands.getCurrentKey() !== actionTopicKey ||
          getReplyComposerIntent() !== replyComposerIntent
        )
          return;
        if (settleSubmission) await settleSubmission(complete);
        else complete();
      };
      if (replyComposerIntent.kind === 'edit') {
        const editTarget = replyComposerIntent.target;
        if (!isNodeSeekActionTopic(actionTopic) && !isDiscourseSource(actionTopic.source)) {
          notify('当前来源暂不支持编辑回复');
          finishDiagnosticTrace(trace, 'blocked', { source: actionTopic.source, reason: 'unsupported' });
          return;
        }
        const edit = { ...editTarget, contentMarkdown: submittedContent };
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
            let sentEditContent = edit.contentMarkdown;
            let confirmedEdit: Reply | null = null;
            const completion: MutationCompletion = {
              applyResult: async ({ detailKey, replyKeys, repliesReadPlanScope, quotedReplyKey, ticket }) => {
                if (confirmedEdit) {
                  const body = confirmedEdit;
                  const replaceBody = (items: Reply[]) =>
                    replaceConfirmedReplyBody(items, edit.commentId, body, edit.contentMarkdown);
                  const windowKeys = forumReplyWindowKeys(queryClient, detailKey, repliesReadPlanScope);
                  const containsEdit = (items: Reply[]) => items.some((reply) => reply.commentId === edit.commentId);
                  const affected = windowKeys.filter((queryKey) =>
                    queryClient.getQueryData<ReplyCache>(queryKey)?.pages.some((page) => containsEdit(page.items))
                  );
                  if (containsEdit(queryClient.getQueryData<TopicDetail>(detailKey)?.replies ?? []))
                    affected.push(detailKey);
                  const quoteKey = body.floor === edit.floor ? quotedReplyKey : undefined;
                  if (quoteKey && queryClient.getQueryData<Reply>(quoteKey)?.commentId === edit.commentId)
                    affected.push(quoteKey);
                  // Older reads can finish after the write. Cancel the affected cached windows before publishing.
                  await Promise.all(affected.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true })));
                  if (!isWritableSessionTicketCurrent(ticket)) return;
                  updateConfirmedReplyCaches(queryClient, windowKeys, replaceBody, quoteKey);
                  queryClient.setQueryData<TopicDetail>(
                    detailKey,
                    (cached) => {
                      if (!cached) return undefined;
                      const replies = replaceBody(cached.replies);
                      return replies === cached.replies ? undefined : { ...cached, replies };
                    },
                    { updatedAt: queryClient.getQueryState(detailKey)?.dataUpdatedAt }
                  );
                  void queryClient.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'none' });
                } else {
                  replyKeys.forEach((repliesKey) => {
                    updateReplyCache(queryClient, repliesKey, (replies) =>
                      applyEditedReplyContent(
                        replies,
                        { ...edit, contentMarkdown: sentEditContent },
                        actionTopic.source
                      )
                    );
                    void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' });
                  });
                }
                await settleReply(ticket);
              },
              afterSuccess: async () =>
                confirmedEdit !== null ||
                (await refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
                  kind: 'edited',
                  silent: true,
                  target: { kind: 'comment-id', commentId: editTarget.commentId },
                  contentMarkdown: sentEditContent
                })),
              successMessage: '回复已更新'
            };
            if (isNodeSeekActionTopic(actionTopic)) {
              sentEditContent = await materializeNodeSeekPolls({
                content: edit.contentMarkdown,
                polls: submittedNodeSeekPolls,
                ticket,
                trace,
                confirmReplacement,
                beforeSend
              });
              await runNodeSeekRequest(
                buildNodeSeekEditReplyRequest({
                  commentId: edit.commentId,
                  content: sentEditContent,
                  csrfToken: ''
                }),
                trace,
                ticket,
                { beforeSend }
              );
              return completion;
            }
            const editRepliesKey = cacheKeys(actionTopic as TopicDetail, ticket).repliesKey;
            const result = await runLinuxDoRequest(
              {
                type: 'edit-post',
                postId: edit.commentId,
                content: edit.contentMarkdown,
                originalContent: editTarget.contentMarkdown
              },
              trace,
              ticket,
              {
                beforeSend: () => {
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
                  notify(STALE_REPLY_EDIT_MESSAGE);
                  throw new HandledMutationError(STALE_REPLY_EDIT_MESSAGE, 'blocked', 'permission_denied');
                }
              }
            );
            confirmedEdit = linuxDoEditedReplyFromAction(result, actionTopic.id, edit.commentId);
            return completion;
          }
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
      const face = replyFace;
      const target = floorTarget;
      const discourseReply = isDiscourseSource(actionTopic.source);
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: topicReplyActionKey(actionTopicKey),
        busy: true,
        decision: { action: 'reply' },
        trace,
        task: async (ticket) => {
          const key = JSON.stringify([
            actionTopicKey,
            ticket.identityKey,
            target?.floor,
            target?.authorId,
            face,
            content.trim(),
            submittedNodeSeekPolls.map(({ localId, fingerprint }) => [localId, fingerprint])
          ]);
          if (uncertainReplies.current.has(key)) {
            const confirmed =
              canConfirm() &&
              (await new Promise<boolean>((resolve) =>
                confirmTopicAction(
                  '上次回复可能已发送',
                  '请先刷新原帖核对。仍要重发可能造成重复回复。',
                  '仍要重发',
                  () => resolve(true),
                  () => resolve(false)
                )
              ));
            if (!confirmed || !acceptConfirmation())
              throw new HandledMutationError('已取消重新发送回复', 'canceled', 'canceled');
          }
          const replyDelivery: ReplyDelivery = { dispatchState: { mayHaveSent: false } };
          let sentContent = content;
          const send = async () => {
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
                ticket,
                replyDelivery,
                beforeSend
              );
            }
            if (discourseReply) {
              return runLinuxDoRequest(
                {
                  type: 'reply',
                  topicId: actionTopic.id,
                  content,
                  replyToPostNumber: target?.floor
                },
                trace,
                ticket,
                {
                  beforeSend: () => {
                    assertReplyNotEnded();
                    beforeSend();
                  },
                  replyDelivery
                }
              );
            }
            sentContent = await materializeNodeSeekPolls({
              content,
              polls: submittedNodeSeekPolls,
              ticket,
              trace,
              confirmReplacement,
              beforeSend
            });
            return runNodeSeekRequest(
              buildNodeSeekReplyRequest({
                postId: actionTopic.id,
                content: sentContent,
                replyTarget: target,
                csrfToken: ''
              }),
              trace,
              ticket,
              { beforeSend, replyDelivery }
            );
          };
          let result: unknown;
          try {
            result = await send();
            uncertainReplies.current.delete(key);
          } catch (error) {
            if (replyDeliveryIsUnconfirmed(replyDelivery, error)) {
              uncertainReplies.current.add(key);
              const message = '回复可能已发送，草稿已保留。请先刷新原帖核对，避免重复回复。';
              if (ownsConfirmation()) notify(message);
              throw new HandledMutationError(message, 'failure', 'unconfirmed');
            }
            if (error instanceof HandledMutationError && error.outcome === 'failure' && ownsConfirmation())
              notify(error.message);
            throw error;
          }
          return {
            applyResult: async ({ detailKey, replyKeys, ticket }) => {
              if (!discourseReply) await settleReply(ticket);
              void queryClient.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'none' });
              replyKeys.forEach(
                (repliesKey) =>
                  void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true, refetchType: 'none' })
              );
            },
            afterSuccess: async ({ ticket }) => {
              const refresh = refreshRepliesAfterWrite(actionTopic as TopicDetail, trace, {
                kind: 'created',
                createdTarget: isNodeSeekActionTopic(actionTopic)
                  ? nodeSeekCreatedReplyTarget(result, actionTopic.id)
                  : discourseReply
                    ? discourseCreatedReplyTarget(result, actionTopic.id)
                    : undefined,
                silent: true
              });
              if (!discourseReply) return refresh;
              // The confirmed floor can load while the editor checks for newer typing.
              const [windowResult] = await Promise.allSettled([refresh, settleReply(ticket)]);
              return windowResult.status === 'fulfilled' && windowResult.value;
            },
            successMessage: (refreshed) =>
              (isNodeSeekActionTopic(actionTopic) || discourseReply) && refreshed === false
                ? '回复已提交，但暂未能显示；请手动刷新，勿重复发送'
                : '回复已提交'
          };
        }
      });
    },
    [
      assertReplyNotEnded,
      cacheKeys,
      captureConfirmation,
      detachReplyEdit,
      executeMutation,
      materializeNodeSeekPolls,
      notify,
      queryClient,
      refreshRepliesAfterWrite,
      replyComposerIntent,
      getReplyComposerIntent,
      replyContent,
      replyFace,
      runLinuxDoRequest,
      runNodeSeekRequest,
      runYaohuoRequest,
      selectedTopic,
      siteSessionViewModels.nodeseek.currentUser?.id,
      topicCommands,
      topicComposer,
      topicDetail,
      isWritableSessionTicketCurrent
    ]
  );
  const deleteReplyConfirmed = useCallback(
    async (reply: Reply, trace: DiagnosticTrace, isCurrent: () => boolean) => {
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        return;
      }
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
        isCurrent,
        task: async (ticket) => {
          await (isYaohuoActionTopic(actionTopic)
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
              ));
          return {
            applyResult: ({ replyKeys }) => {
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
          };
        }
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
      const isCurrent = captureConfirmation();
      confirmTopicAction(
        '删除回复',
        '确认删除这条回复？',
        '删除',
        () => void deleteReplyConfirmed(reply, trace, isCurrent),
        () => finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' })
      );
    },
    [captureConfirmation, deleteReplyConfirmed, detail, notify]
  );
  useEffect(() => {
    if (active && detail?.closed && replyComposerIntent.kind !== 'closed' && replyComposerIntent.kind !== 'edit') {
      detachReplyEdit();
      notify(topicActionDecisionMessage(decisionFor({ action: 'reply' })));
    }
  }, [active, detail?.closed, decisionFor, detachReplyEdit, notify, replyComposerIntent.kind]);
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
  return { editReply, submitReply, deleteReply };
}

export function useTopicActionsController({
  active,
  isRouteFocused,
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
  requestAccountRecheck,
  readGateway,
  replyWindowOwner,
  refreshTopicReplies,
  refreshWholeTopic,
  siteSessionViewModels,
  topicDetail,
  topicReplies,
  topicSession
}: TopicActionsRuntime) {
  const queryClient = useQueryClient();
  const pendingActionReservationsRef = useRef(new Set<string>());
  const activeRef = useCommittedRef(active);
  const sessionEpochsRef = useCommittedRef(sessionEpochs);
  const writableTicketCurrentRef = useCommittedRef(isWritableSessionTicketCurrent);
  const {
    state: { replyComposerIntent, replyOrder, selectedTopic },
    commands: { composer: topicComposer, topic: topicCommands }
  } = topicSession;
  const replyOrderRef = useCommittedRef(replyOrder);
  const refreshTopicRepliesRef = useCommittedRef(refreshTopicReplies);
  const refreshWholeTopicRef = useCommittedRef(refreshWholeTopic);
  const replyComposerIntentRef = useCommittedRef(replyComposerIntent);
  const getReplyComposerIntent = useCallback(() => replyComposerIntentRef.current, [replyComposerIntentRef]);
  const currentWritableTicket = useCallback(
    (ticket: WritableSessionTicket) => writableTicketCurrentRef.current(ticket),
    [writableTicketCurrentRef]
  );
  const authenticatedFetcher = useMemo(() => rejectUnauthorizedResponse(fetcher), [fetcher]);
  const reportAccountError = useCallback(
    (error: unknown, ticket: WritableSessionTicket | undefined, trace: DiagnosticTrace) => {
      if (!ticket || !activeRef.current || !writableTicketCurrentRef.current(ticket)) return;
      if (isRawUnauthorized(error)) onSessionExpired(ticket.source, ticket.sessionEpoch);
      else if (ticket.source === 'linuxdo' && errorRequiresAccountRecheck(error))
        requestAccountRecheck(ticket.source, ticket.sessionEpoch, trace.traceId);
    },
    [activeRef, writableTicketCurrentRef, onSessionExpired, requestAccountRecheck]
  );
  const nodeSeekUserId = nodeSeekUserIdForSession(siteSessionViewModels.nodeseek);
  const detachReplyEdit = topicComposer.detachEdit;

  const detail = currentTopicActionTopic(topicDetail, selectedTopic);
  const confirmationSource = detail && isSessionSource(detail.source) ? detail.source : undefined;
  const confirmationSession = confirmationSource ? siteSessionViewModels[confirmationSource] : undefined;
  const confirmationIdentity = confirmationSession?.canWrite ? siteSessionIdentityKey(confirmationSession) : undefined;
  const confirmationEpoch = confirmationSource ? sessionEpochs[confirmationSource] : undefined;
  const confirmationTopic = active && detail ? topicKey(detail) : undefined;
  const confirmationOwner = useRef<{ topic: string; ticket: WritableSessionTicket } | null>(null);
  useLayoutEffect(() => {
    if (!confirmationTopic || !confirmationSource || !confirmationIdentity || confirmationEpoch === undefined) return;
    confirmationOwner.current = {
      topic: confirmationTopic,
      ticket: { source: confirmationSource, identityKey: confirmationIdentity, sessionEpoch: confirmationEpoch }
    };
    return () => {
      confirmationOwner.current = null;
    };
  }, [confirmationTopic, confirmationSource, confirmationIdentity, confirmationEpoch]);
  const captureConfirmation = useCallback(() => {
    const owner = confirmationOwner.current;
    return () =>
      Boolean(
        owner &&
        confirmationOwner.current === owner &&
        owner.topic === confirmationTopic &&
        owner.ticket.identityKey === confirmationIdentity &&
        owner.ticket.sessionEpoch === confirmationEpoch &&
        (!isRouteFocused || isRouteFocused()) &&
        currentWritableTicket(owner.ticket)
      );
  }, [confirmationTopic, confirmationIdentity, confirmationEpoch, currentWritableTicket, isRouteFocused]);
  const policyContentRef = useCommittedRef({ topicDetail, topicReplies });

  const policyScope = `${detail?.source}:${detail?.id}:${sessionEpochs.linuxdo}:${siteSessionViewModels.linuxdo.currentUser?.id}`;
  const policyScopeRef = useCommittedRef(policyScope);
  const [policyState, setPolicyState] = useState<PolicyOperationSnapshot>({ request: null, submissions: {} });
  const [policies] = useState(() =>
    createDiscoursePolicyOperation({
      isCurrentScope: (scope) => policyScopeRef.current === scope,
      publish: setPolicyState
    })
  );
  const policyBusy = policyRequestBusy(policyState.request);
  const policySubmissions = policyState.submissions;
  const [boostComposer, setBoostComposer] = useState<{ postId: number; content: string } | null>(null);
  const boostDraftsRef = useRef(new Map<number, string>());
  useLayoutEffect(() => {
    setBoostComposer(null);
    boostDraftsRef.current.clear();
  }, [policyScope]);
  useLayoutEffect(() => {
    if (!active) setBoostComposer(null);
  }, [active]);
  useLayoutEffect(() => {
    policies.cancel();
    return policies.cancel;
  }, [active, policyScope, siteSessionViewModels.linuxdo.canWrite, policies]);
  useLayoutEffect(() => {
    policies.observe(policyScope, [topicDetail?.policy, ...topicReplies.map((reply) => reply.policy)]);
  }, [policyScope, topicDetail, topicReplies, policies]);
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
          ? !actionTopic?.archived && canToggleDiscourseLike(interactionTarget)
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
      } else if (request.action === 'boost' && interactionTarget) {
        objectAllowed ??=
          interactionTarget.siteExtension?.canBoost === true &&
          !('systemAction' in interactionTarget && interactionTarget.systemAction);
        targetPresent ??= Boolean(interactionTarget.commentId);
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
        reply: request.reply,
        targetPresent,
        topic: actionTopic
      });
    },
    [nodeSeekUserId, selectedTopic, siteSessionViewModels, topicDetail]
  );
  const mutation = useMutation<MutationCompletion, unknown, MutationVariables>({
    mutationKey,
    scope: { id: mutationScope },
    mutationFn: async (variables) => {
      if (variables.isCurrent?.() === false) throw new HandledMutationError('操作已取消', 'canceled', 'canceled');
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
      if (variables.isCurrent?.() === false) throw new HandledMutationError('操作已取消', 'canceled', 'canceled');
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
        notify(STALE_REPLY_EDIT_MESSAGE);
        throw new HandledMutationError(STALE_REPLY_EDIT_MESSAGE, 'blocked', 'permission_denied');
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
        if (
          isRawUnauthorized(error) &&
          isWritableSessionTicketCurrent(variables.ticket) &&
          variables.isCurrent?.() !== false
        ) {
          const message = errorMessage(error);
          notify(message);
          reportAccountError(error, variables.ticket, variables.trace);
          throw new HandledMutationError(message, 'failure', 'login_required');
        }
        if (
          variables.source === 'linuxdo' &&
          errorRequiresAccountRecheck(error) &&
          isWritableSessionTicketCurrent(variables.ticket) &&
          variables.isCurrent?.() !== false
        ) {
          reportAccountError(error, variables.ticket, variables.trace);
        }
        throw error;
      }
    },
    onSuccess: async (completion, variables) => {
      if (!writableTicketCurrentRef.current(variables.ticket) || variables.isCurrent?.() === false) {
        finishDiagnosticTrace(variables.trace, 'stale', {
          source: variables.source,
          reason: 'stale',
          serverConfirmed: true
        });
        return;
      }
      await completion.applyResult?.(variables);
      const refreshed =
        writableTicketCurrentRef.current(variables.ticket) && variables.isCurrent?.() !== false
          ? await completion.afterSuccess?.(variables)
          : undefined;
      if (!writableTicketCurrentRef.current(variables.ticket) || variables.isCurrent?.() === false) {
        finishDiagnosticTrace(variables.trace, 'stale', {
          source: variables.source,
          reason: 'stale',
          serverConfirmed: true
        });
        return;
      }
      const message =
        typeof completion.successMessage === 'function'
          ? completion.successMessage(refreshed)
          : completion.successMessage;
      if (message) notify(message);
      finishDiagnosticTrace(variables.trace, refreshed === false ? 'partial' : 'success', {
        source: variables.source,
        serverConfirmed: true,
        ...(refreshed === false ? { reason: 'refresh_failed' } : {})
      });
    },
    onError: (error, variables) => {
      const failure = mutationFailure(error);
      const credentialIsCurrent = isWritableSessionTicketCurrent(variables.ticket) && variables.isCurrent?.() !== false;
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
      const postInteraction =
        request.interaction || (request.action === 'like' || request.action === 'boost' ? request.action : undefined);
      const actionKey =
        request.actionKey ||
        (actionTopic && postInteraction && target?.commentId
          ? topicActionStateKey({
              topicKey: topicKey(actionTopic),
              targetId: target.commentId,
              action: postInteraction
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
  const decisionForRef = useCommittedRef(decisionFor);

  const assertReplyNotEnded = useCallback(() => {
    const decision = decisionForRef.current({ action: 'reply' });
    if (decision.reason === 'topic-ended' || decision.reason === 'topic-closed') {
      throw new HandledMutationError(topicActionDecisionMessage(decision), 'blocked', 'permission_denied');
    }
  }, [decisionForRef]);

  const cacheKeys = useCallback(
    (actionTopic: TopicDetail, ticket?: WritableSessionTicket, quotedFloor?: number): ActionCacheKeys => {
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
      const replyKeys = forumReplyWindowKeys(queryClient, detailKey, repliesReadPlanScope);
      const owned = forumQueryKeys.replies(detailKey, replyOrderRef.current, repliesReadPlanScope, replyWindowOwner);
      const quotePlan =
        quotedFloor && actionTopic.source === 'linuxdo' ? readGateway.getReadPlan('linuxdo', 'reply') : null;
      return {
        detailKey,
        replyKeys,
        repliesReadPlanScope,
        ...(quotedFloor && quotePlan?.state === 'ready' && quotePlan.lane === 'authenticated'
          ? {
              quotedReplyKey: forumQueryKeys.reply({
                postNumber: quotedFloor,
                readPlanScope: quotePlan.cacheScope,
                scope,
                source: actionTopic.source,
                topicId: actionTopic.id
              })
            }
          : {}),
        repliesKey: queryClient.getQueryData(owned)
          ? owned
          : forumQueryKeys.replies(detailKey, replyOrderRef.current, repliesReadPlanScope)
      };
    },
    [queryClient, readGateway, replyOrderRef, replyWindowOwner, sessionEpochsRef]
  );

  const applyPollResult = useCallback(
    ({ actionTopic, confirmedPoll, optionIds, poll, preserveUnknownCounts }: PollResultApplication) => {
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

  const refreshRepliesAfterWrite = useCallback(
    async (actionTopic: TopicDetail, trace: DiagnosticTrace, command: ReplyRefreshCommand) => {
      if (!activeRef.current) {
        markDiagnosticStage(trace, 'apply', { source: actionTopic.source, state: 'inactive-route' });
        return true;
      }
      if (topicCommands.getCurrentKey() !== topicKey(actionTopic)) {
        const { detailKey, replyKeys } = cacheKeys(actionTopic);
        replyKeys.forEach((queryKey) => {
          const { windowOwner } = queryKey.at(-1) as { windowOwner?: string };
          if (windowOwner) {
            void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
          } else {
            queryClient.removeQueries({ queryKey, exact: true });
          }
        });
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
    async (actionTopic: TopicDetail, variables: MutationInput) => {
      if (variables.isCurrent?.() === false) {
        finishDiagnosticTrace(variables.trace, 'canceled', { source: actionTopic.source, reason: 'canceled' });
        return false;
      }
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
      let request = variables.decision;
      if (variables.isCurrent) {
        const { topicDetail: currentTopic, topicReplies: currentReplies } = policyContentRef.current;
        const reply = request.action === 'delete' ? request.reply : undefined;
        const poll = actionTopic.source === 'nodeseek' ? request.poll : undefined;
        if (reply) {
          const key = replyKey(reply);
          const currentReply = currentReplies.find((item) => replyKey(item) === key);
          if (currentReply) request = { ...request, reply: currentReply };
        } else if (poll?.id) {
          const matchesPoll = (item: TopicPoll) => item.id === poll.id;
          const currentPoll =
            currentTopic?.polls?.find(matchesPoll) ??
            currentReplies.flatMap((item) => item.polls ?? []).find(matchesPoll);
          if (currentPoll) request = { ...request, poll: currentPoll };
        }
      }
      const decision = decisionForRef.current({
        ...request,
        pending: duplicate || pendingActionReservationsRef.current.has(reservationKey)
      });
      if (!decision.allowed) {
        const message = topicActionDecisionMessage(decision);
        if (message) notify(message);
        finishDiagnosticTrace(variables.trace, 'blocked', {
          source: actionTopic.source,
          reason: normalizeDiagnosticReason({ reason: decision.reason })
        });
        return false;
      }
      pendingActionReservationsRef.current.add(reservationKey);
      try {
        if (!isSessionSource(actionTopic.source)) {
          throw new WritableSessionBlockedError('当前来源不支持写操作', 'login_required');
        }
        const ticket = await ensureWritableSession(actionTopic.source);
        const keys = cacheKeys(actionTopic, ticket, variables.editTarget?.floor);
        if (variables.isCurrent?.() === false) {
          finishDiagnosticTrace(variables.trace, 'canceled', { source: actionTopic.source, reason: 'canceled' });
          return false;
        }
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
            notify(STALE_REPLY_EDIT_MESSAGE);
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
          decision: request,
          ticket,
          source: actionTopic.source,
          topicId: actionTopic.id
        });
        return true;
      } catch (error) {
        if (variables.isCurrent?.() === false) {
          finishDiagnosticTrace(variables.trace, 'canceled', { source: actionTopic.source, reason: 'canceled' });
        } else if (error instanceof HandledMutationError) {
          // Mutation callbacks already own diagnostics and user feedback.
        } else if (error instanceof WritableSessionBlockedError) {
          notify(error.message);
          finishDiagnosticTrace(variables.trace, 'blocked', {
            source: actionTopic.source,
            reason: normalizeDiagnosticReason(error)
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
    [
      cacheKeys,
      decisionForRef,
      detachReplyEdit,
      ensureWritableSession,
      mutation.mutateAsync,
      notify,
      policyContentRef,
      queryClient
    ]
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
      { beforeSend, notifyFailure = true, pollCreation, replyDelivery }: NodeSeekRequestOptions = {}
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
          fetcher: withRequestBeforeSend(
            observeReplyDelivery(withDiagnosticFetcher(trace, authenticatedFetcher), replyDelivery),
            () => {
              assertWritableTicket(ticket);
              beforeSend?.();
            },
            pollCreation?.dispatchState ?? replyDelivery?.dispatchState
          ),
          request,
          userAgent: getNodeSeekUserAgent()
        });
        // The remote object belongs to the captured account even if the UI ticket changed during the request.
        if (pollCreation) await pollCreation.persistResult(result);
        markDiagnosticStage(trace, 'transport', { source: 'nodeseek', state: 'confirmed', serverConfirmed: true });
        assertWritableTicket(ticket, true);
        return result;
      } catch (error) {
        if (error instanceof HandledMutationError) throw error;
        if (isRawUnauthorized(error)) throw error;
        if (!(
          pollCreation &&
          error &&
          typeof error === 'object' &&
          (error as { serverRejected?: unknown }).serverRejected
        ))
          assertWritableTicket(ticket);
        const message = errorMessage(error);
        if (notifyFailure && !replyDelivery) notify(message);
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

  const actionBusy = policyBusy || pendingVariables.some((variables) => variables?.busy !== false);
  const replyImageUploading = pendingVariables.some((variables) => variables?.decision.action === 'upload');

  const materializeNodeSeekPolls = useCallback(
    async ({
      content,
      polls,
      ticket,
      trace,
      confirmReplacement,
      beforeSend
    }: {
      content: string;
      polls: PendingNodeSeekPoll[];
      ticket: WritableSessionTicket;
      trace: DiagnosticTrace;
      confirmReplacement(poll: PendingNodeSeekPoll): Promise<boolean>;
      beforeSend(): void;
    }) => {
      try {
        return await materializePendingNodeSeekPolls({
          content,
          polls,
          identityKey: ticket.identityKey,
          assertCurrent: () => assertWritableTicket(ticket),
          confirmReplacement,
          createPoll: (poll, pollCreation) =>
            runNodeSeekRequest(buildNodeSeekPollCreateRequest({ poll }), trace, ticket, { beforeSend, pollCreation }),
          notify
        });
      } catch (error) {
        if (error instanceof PendingNodeSeekPollError)
          throw new HandledMutationError(
            error.message,
            error.outcome,
            error.outcome === 'canceled' ? 'canceled' : 'invalid_response'
          );
        throw error;
      }
    },
    [assertWritableTicket, notify, runNodeSeekRequest]
  );

  const runYaohuoRequest = useCallback(
    async (
      requestFactory: (cookieHeader: string) => YaohuoActionRequest,
      trace: DiagnosticTrace,
      ticket: WritableSessionTicket,
      replyDelivery?: ReplyDelivery,
      beforeSend?: () => void
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
        if (draftRequest.path === '/bbs/book_re.aspx') assertReplyNotEnded();
        const result = await runYaohuoAction({
          trace,
          fetcher: (input, init) =>
            withRequestBeforeSend(
              observeReplyDelivery(withDiagnosticFetcher(trace, authenticatedFetcher), replyDelivery),
              () => {
                assertWritableTicket(ticket);
                if (draftRequest.path === '/bbs/book_re.aspx') assertReplyNotEnded();
                beforeSend?.();
              },
              init?.method === 'POST' ? replyDelivery?.dispatchState : undefined
            )(input, init),
          request: requestFactory(cookieRead.header)
        });
        if (result.status === 'unknown') {
          assertWritableTicket(ticket);
          if (!replyDelivery) notify(result.message);
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
        if (!replyDelivery) notify(message);
        throw new HandledMutationError(
          message,
          'failure',
          normalizeDiagnosticReason(error),
          false,
          Boolean(error && typeof error === 'object' && 'serverRejected' in error && error.serverRejected)
        );
      }
    },
    [assertReplyNotEnded, assertWritableTicket, authenticatedFetcher, notify]
  );

  const runLinuxDoRequest = useCallback(
    async (
      action: DiscourseAction,
      trace: DiagnosticTrace,
      ticket: WritableSessionTicket,
      { beforeSend, dispatchState, replyDelivery }: LinuxDoRequestOptions = {}
    ) => {
      assertWritableTicket(ticket);
      beforeSend?.();
      try {
        assertWritableTicket(ticket);
        const result = await runLinuxDoAction({
          fetcher: (input, init) =>
            withRequestBeforeSend(
              observeReplyDelivery(withDiagnosticFetcher(trace, authenticatedFetcher), replyDelivery),
              () => {
                assertWritableTicket(ticket);
                beforeSend?.();
              },
              init?.method && init.method !== 'GET' ? (dispatchState ?? replyDelivery?.dispatchState) : undefined
            )(input, init),
          request: buildDiscourseActionRequest(action),
          userAgent: linuxDoUserAgent()
        });
        const hasPostResult = ['toggle-reaction', 'set-like', 'create-boost'].includes(action.type);
        markDiagnosticStage(trace, 'transport', {
          source: 'linuxdo',
          state: hasPostResult ? 'body-ready' : 'confirmed',
          ...(hasPostResult ? {} : { serverConfirmed: true })
        });
        assertWritableTicket(ticket, true);
        return result ?? true;
      } catch (error) {
        if (error instanceof HandledMutationError) throw error;
        if (isRawUnauthorized(error) || errorRequiresAccountRecheck(error)) throw error;
        const message = errorMessage(error);
        if (isLoginRequiredError(error)) {
          showLinuxDoVerification(message);
          throw new HandledMutationError(message, 'blocked', 'login_required');
        }
        if (!replyDelivery) notify(message);
        throw new HandledMutationError(
          message,
          'failure',
          normalizeDiagnosticReason(error),
          false,
          Boolean(error && typeof error === 'object' && 'serverRejected' in error && error.serverRejected)
        );
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

  const patchLinuxDoPost = useCallback(
    (postId: number, patch: DiscourseInteractionPatch, keys: Pick<MutationVariables, 'detailKey' | 'replyKeys'>) => {
      const update = (reply: Reply) => (reply.commentId === postId ? { ...reply, ...patch } : reply);
      queryClient.setQueryData<TopicDetail>(keys.detailKey, (current) =>
        current
          ? {
              ...current,
              ...(current.commentId === postId ? patch : {}),
              replies: current.replies.map(update)
            }
          : current
      );
      keys.replyKeys.forEach((key) => updateReplyCache(queryClient, key, (replies) => replies.map(update)));
    },
    [queryClient]
  );
  const linuxDoInteractionConfigQuery = useMemo(
    () =>
      queryOptions({
        queryKey: forumQueryKeys.interactionConfig(sessionEpochs.linuxdo),
        staleTime: 5 * 60_000,
        queryFn: ({ signal }) => readGateway.getLinuxDoInteractionConfig({ signal })
      }),
    [readGateway, sessionEpochs.linuxdo]
  );
  const loadLinuxDoInteractionConfig = useCallback(
    () => queryClient.fetchQuery(linuxDoInteractionConfigQuery),
    [queryClient, linuxDoInteractionConfigQuery]
  );
  const interactionReadsRef = useRef(new Map<number, { controller: AbortController; promise: Promise<boolean> }>());
  const getLinuxDoPost = useCallback(
    (postId: number) => {
      const view = policyContentRef.current;
      if (!view.topicDetail || view.topicDetail.source !== 'linuxdo') return null;
      const keys = cacheKeys(view.topicDetail);
      const cachedOpening = queryClient.getQueryData<TopicDetail>(keys.detailKey);
      const cachedReplies = queryClient.getQueryData<ReplyCache>(keys.repliesKey);
      const opening = cachedOpening || view.topicDetail;
      const target =
        opening.commentId === postId
          ? opening
          : cachedReplies?.pages.flatMap((page) => page.items).find((reply) => reply.commentId === postId) ||
            cachedOpening?.replies.find((reply) => reply.commentId === postId) ||
            (!cachedOpening && !cachedReplies
              ? view.topicReplies.find((reply) => reply.commentId === postId)
              : undefined);
      return target ? { opening, target } : null;
    },
    [cacheKeys, policyContentRef, queryClient]
  );
  useLayoutEffect(
    () => () => {
      interactionReadsRef.current.forEach(({ controller }) => controller.abort());
      interactionReadsRef.current.clear();
    },
    [active, policyScope]
  );
  const recheckLinuxDoPost = useCallback(
    async (postId: number, suppliedTicket?: WritableSessionTicket, parentTrace?: DiagnosticTrace) => {
      const pending = interactionReadsRef.current.get(postId);
      if (pending) return pending.promise;
      const { opening, target } = getLinuxDoPost(postId) || {};
      const trace = beginDiagnosticTrace('topic', 'interaction-reconcile', {
        source: 'linuxdo',
        parentTraceId: parentTrace?.traceId,
        ...(opening ? { topicRef: diagnosticRef('topic', topicKey(opening)) } : {})
      });
      if (!opening || opening.source !== 'linuxdo' || !target) {
        finishDiagnosticTrace(trace, 'blocked', { source: 'linuxdo', reason: 'missing_target' });
        return false;
      }
      const actionKey = topicActionStateKey({ topicKey: topicKey(opening), targetId: postId, action: 'like' });
      if (!suppliedTicket && pendingActionReservationsRef.current.has(`${opening.source}:${opening.id}:${actionKey}`)) {
        finishDiagnosticTrace(trace, 'blocked', { source: 'linuxdo', reason: 'busy' });
        return false;
      }
      const floor = opening.commentId === postId ? 1 : 'floor' in target ? target.floor : undefined;
      if (!floor) {
        finishDiagnosticTrace(trace, 'blocked', { source: 'linuxdo', reason: 'missing_target' });
        return false;
      }
      const controller = new AbortController();
      const scope = policyScopeRef.current;
      const promise = (async () => {
        try {
          const ticket = await (suppliedTicket || ensureWritableSession('linuxdo'));
          if (!activeRef.current || scope !== policyScopeRef.current || controller.signal.aborted)
            throw new HandledMutationError('操作已取消', 'canceled', 'canceled');
          assertWritableTicket(ticket);
          const reply = await readGateway.getReply(
            {
              source: 'linuxdo',
              id: opening.id,
              floor,
              signal: controller.signal
            },
            { trace }
          );
          if (
            !activeRef.current ||
            scope !== policyScopeRef.current ||
            controller.signal.aborted ||
            reply.commentId !== postId
          ) {
            finishDiagnosticTrace(trace, controller.signal.aborted ? 'canceled' : 'stale', {
              source: 'linuxdo',
              floor,
              reason: controller.signal.aborted ? 'canceled' : 'stale',
              isTargetMatch: reply.commentId === postId
            });
            return false;
          }
          assertWritableTicket(ticket);
          patchLinuxDoPost(
            postId,
            {
              currentUserReaction: reply.currentUserReaction,
              reactionSummary: reply.reactionSummary,
              likeCount: reply.likeCount,
              liked: reply.liked,
              canLike: reply.canLike,
              siteExtension: reply.siteExtension
            },
            cacheKeys(opening, ticket)
          );
          finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', floor, state: 'confirmed', localApplied: true });
          return true;
        } catch (error) {
          const failure = mutationFailure(error);
          finishDiagnosticTrace(trace, controller.signal.aborted ? 'canceled' : failure.outcome, {
            source: 'linuxdo',
            floor,
            reason: controller.signal.aborted ? 'canceled' : failure.reason
          });
          return false;
        } finally {
          if (interactionReadsRef.current.get(postId)?.controller === controller)
            interactionReadsRef.current.delete(postId);
        }
      })();
      interactionReadsRef.current.set(postId, { controller, promise });
      return promise;
    },
    [
      activeRef,
      assertWritableTicket,
      cacheKeys,
      ensureWritableSession,
      getLinuxDoPost,
      patchLinuxDoPost,
      policyContentRef,
      policyScopeRef,
      readGateway
    ]
  );

  const mutateLinuxDoPost = useCallback(
    async (
      postId: number,
      intent:
        | { kind: 'reaction'; reactionId?: string }
        | { kind: 'create-boost'; content: string }
        | { kind: 'delete-boost'; boostId: number },
      confirmation?: () => boolean
    ) => {
      if (confirmation?.() === false) return false;
      const { opening, target } = getLinuxDoPost(postId) || {};
      if (!opening || opening.source !== 'linuxdo' || !target || ('systemAction' in target && target.systemAction))
        return false;
      if (target.siteExtension?.interactionUnconfirmed) {
        const reconciled = await recheckLinuxDoPost(postId);
        notify(reconciled ? '已核对最新状态，请重新选择操作' : '互动结果尚未确认，请稍后刷新核对');
        return false;
      }
      const isReaction = intent.kind === 'reaction';
      const boost =
        intent.kind === 'delete-boost'
          ? target.siteExtension?.boosts?.find((item) => item.id === intent.boostId)
          : undefined;
      const action = isReaction ? 'like' : 'boost';
      const objectAllowed = isReaction
        ? !opening.archived && canToggleDiscourseLike(target)
        : intent.kind === 'create-boost'
          ? target.siteExtension?.canBoost === true
          : boost?.canDelete === true;
      const trace = beginDiagnosticTrace('topic', 'interaction', {
        source: 'linuxdo',
        action: isReaction ? 'like' : 'boost',
        requestType: intent.kind === 'reaction' ? 'interaction' : intent.kind,
        topicRef: diagnosticRef('topic', topicKey(opening)),
        floor: opening.commentId === postId ? 1 : 'floor' in target ? target.floor : undefined
      });
      const scope = policyScopeRef.current;
      const isCurrent = () => activeRef.current && scope === policyScopeRef.current && confirmation?.() !== false;
      const dispatchState: RequestDispatchState = { mayHaveSent: false };
      const success = await executeMutation(opening, {
        actionKey: topicActionStateKey({ topicKey: topicKey(opening), targetId: postId, action }),
        busy: false,
        decision: { action, objectAllowed, target, targetPresent: true },
        trace,
        isCurrent,
        task: async (ticket) => {
          let resultPatch: DiscourseInteractionPatch = {};

          interactionReadsRef.current.get(postId)?.controller.abort();
          interactionReadsRef.current.delete(postId);
          let request: DiscourseAction;
          let rollback: DiscourseInteractionPatch | undefined;
          const keys = cacheKeys(opening, ticket);
          if (intent.kind === 'reaction') {
            const config = await loadLinuxDoInteractionConfig();
            assertWritableTicket(ticket);
            if (!isCurrent()) throw new HandledMutationError('操作已取消', 'canceled', 'canceled');
            const latest = getLinuxDoPost(postId)?.target;
            if (!latest || latest.siteExtension?.interactionUnconfirmed || !canToggleDiscourseLike(latest))
              throw new HandledMutationError('当前内容不允许此操作', 'blocked', 'permission_denied');
            const previous =
              latest.currentUserReaction?.id ??
              (latest.currentUserReaction === undefined && latest.liked ? config.reactionForLike : null);
            const id = intent.reactionId || previous || config.reactionForLike;
            if (config.reactionsEnabled && id !== previous && !config.enabledReactions.includes(id))
              throw new Error('当前站点不支持这个反应');
            if (!config.reactionsEnabled && intent.reactionId && id !== config.reactionForLike)
              throw new Error('当前站点未启用表情反应');
            request = config.reactionsEnabled
              ? { type: 'toggle-reaction', postId, reactionId: id }
              : { type: 'set-like', postId, active: !latest.liked };
            markDiagnosticStage(trace, 'guard', {
              source: 'linuxdo',
              requestType: request.type,
              isReactionsEnabled: config.reactionsEnabled,
              itemCount: config.enabledReactions.length
            });
            rollback = {
              currentUserReaction: latest.currentUserReaction,
              reactionSummary: latest.reactionSummary,
              liked: latest.liked
            };
            patchLinuxDoPost(postId, discourseReactionPreview(latest, id, config.reactionForLike), keys);
            markDiagnosticStage(trace, 'apply', {
              source: 'linuxdo',
              requestType: request.type,
              state: 'optimistic',
              localApplied: true,
              mode: id === previous ? 'remove' : 'add'
            });
          } else if (intent.kind === 'create-boost') {
            const [config, emojis] = await Promise.all([
              loadLinuxDoInteractionConfig(),
              readGateway.getEmojiUrls({ source: 'linuxdo' })
            ]);
            assertWritableTicket(ticket);
            if (!config.boostsEnabled || !discourseBoostStats(intent.content, Object.keys(emojis)).valid)
              throw new Error('加电最多 16 个字符、5 个表情，请检查内容');
            request = { type: 'create-boost', postId, content: intent.content };
          } else request = { type: 'delete-boost', boostId: intent.boostId };
          markDiagnosticStage(trace, 'guard', {
            source: 'linuxdo',
            requestType: request.type,
            state: 'ready',
            ...(intent.kind === 'create-boost' ? { contentLength: intent.content.length } : {})
          });
          const checkTarget = () => {
            if (!isCurrent()) throw new HandledMutationError('操作已取消', 'canceled', 'canceled');
            const current = getLinuxDoPost(postId)?.target;
            if (
              !current ||
              current.siteExtension?.interactionUnconfirmed ||
              policyContentRef.current.topicDetail?.archived ||
              ('systemAction' in current && current.systemAction) ||
              (intent.kind === 'reaction' && !canToggleDiscourseLike(current)) ||
              (intent.kind === 'delete-boost' &&
                !current.siteExtension?.boosts?.some((item) => item.id === intent.boostId && item.canDelete)) ||
              (intent.kind === 'create-boost' && current.siteExtension?.canBoost !== true)
            )
              throw new HandledMutationError('当前内容不允许此操作', 'blocked', 'permission_denied');
          };
          try {
            const result = await runLinuxDoRequest(request, trace, ticket, { beforeSend: checkTarget, dispatchState });
            if (intent.kind === 'reaction') {
              const fields = discoursePostFields(result);
              if (
                !fields ||
                fields.commentId !== postId ||
                (request.type === 'toggle-reaction' && !('currentUserReaction' in fields))
              )
                throw new Error('表情反应返回内容不完整');
              resultPatch = {
                currentUserReaction: fields.currentUserReaction,
                reactionSummary: fields.reactionSummary || [],
                likeCount: fields.likeCount,
                liked: fields.liked,
                canLike: fields.canLike
              };
            } else if (intent.kind === 'create-boost') {
              const created = linuxDoBoostFromData(result);
              if (!created) throw new Error('加电返回内容不完整');
              resultPatch = {
                siteExtension: {
                  ...target.siteExtension,
                  boosts: [...(target.siteExtension?.boosts || []), created],
                  boostCount: (target.siteExtension?.boostCount || target.siteExtension?.boosts?.length || 0) + 1,
                  canBoost: false
                }
              };
            } else
              resultPatch = {
                siteExtension: {
                  ...target.siteExtension,
                  boosts: target.siteExtension?.boosts?.filter((item) => item.id !== intent.boostId),
                  boostCount: Math.max(
                    0,
                    (target.siteExtension?.boostCount || target.siteExtension?.boosts?.length || 0) - 1
                  ),
                  canBoost: false
                }
              };
            markDiagnosticStage(trace, 'parse', {
              source: 'linuxdo',
              requestType: request.type,
              state: 'confirmed',
              serverConfirmed: true
            });
            if (!isCurrent())
              patchLinuxDoPost(
                postId,
                { siteExtension: { ...target.siteExtension, interactionUnconfirmed: true } },
                keys
              );
            await result;
            return {
              applyResult: (variables) => {
                patchLinuxDoPost(postId, resultPatch, variables);
                if (intent.kind === 'create-boost' && boostDraftsRef.current.get(postId) === intent.content) {
                  boostDraftsRef.current.delete(postId);
                  setBoostComposer((current) =>
                    current?.postId === postId && current.content === intent.content ? null : current
                  );
                }
              },
              afterSuccess:
                intent.kind === 'reaction'
                  ? undefined
                  : (variables) => recheckLinuxDoPost(postId, variables.ticket, trace),
              successMessage: (refreshed) =>
                refreshed === false
                  ? '操作已提交，请刷新核对最新状态'
                  : intent.kind === 'reaction'
                    ? '反应已更新'
                    : intent.kind === 'create-boost'
                      ? '加电已提交'
                      : '加电已删除'
            };
          } catch (error) {
            const rejected = error instanceof HandledMutationError && error.serverRejected;
            if (
              dispatchState.mayHaveSent &&
              !rejected &&
              !isRawUnauthorized(error) &&
              scope === policyScopeRef.current
            ) {
              patchLinuxDoPost(
                postId,
                { siteExtension: { ...getLinuxDoPost(postId)?.target.siteExtension, interactionUnconfirmed: true } },
                keys
              );
              if (isCurrent()) notify('互动结果尚未确认，请先核对，勿重复提交');
              markDiagnosticStage(trace, 'apply', {
                source: 'linuxdo',
                requestType: request.type,
                state: 'unconfirmed',
                didDispatch: true,
                serverConfirmed: false,
                reason: 'unconfirmed'
              });
            } else if (rollback && isCurrent()) {
              patchLinuxDoPost(postId, rollback, keys);
              markDiagnosticStage(trace, 'rollback', {
                source: 'linuxdo',
                requestType: request.type,
                state: 'local',
                localApplied: true,
                isServerRejected: rejected,
                reason: normalizeDiagnosticReason(error)
              });
            }
            throw error;
          }
        }
      });
      return success && isCurrent();
    },
    [
      activeRef,
      assertWritableTicket,
      cacheKeys,
      executeMutation,
      getLinuxDoPost,
      loadLinuxDoInteractionConfig,
      notify,
      patchLinuxDoPost,
      policyContentRef,
      policyScopeRef,
      readGateway,
      recheckLinuxDoPost,
      runLinuxDoRequest
    ]
  );
  const reactToPost = useCallback(
    (postId: number, reactionId?: string) => mutateLinuxDoPost(postId, { kind: 'reaction', reactionId }),
    [mutateLinuxDoPost]
  );
  const openBoostComposer = useCallback((postId: number) => {
    setBoostComposer({ postId, content: boostDraftsRef.current.get(postId) || '' });
  }, []);
  const changeBoostContent = useCallback((content: string) => {
    setBoostComposer((current) => {
      if (!current) return current;
      boostDraftsRef.current.set(current.postId, content);
      return { ...current, content };
    });
  }, []);
  const closeBoostComposer = useCallback(() => setBoostComposer(null), []);
  const submitBoost = useCallback(
    () =>
      boostComposer
        ? mutateLinuxDoPost(boostComposer.postId, { kind: 'create-boost', content: boostComposer.content })
        : Promise.resolve(false),
    [boostComposer, mutateLinuxDoPost]
  );
  const deleteBoost = useCallback(
    (postId: number, boostId: number) => {
      const isCurrent = captureConfirmation();
      confirmTopicAction('删除加电？', '确认删除这条加电内容？', '删除', () => {
        void mutateLinuxDoPost(postId, { kind: 'delete-boost', boostId }, isCurrent);
      });
    },
    [captureConfirmation, mutateLinuxDoPost]
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
        reply: editTarget ? topicReplies.find((reply) => reply.commentId === editTarget.commentId) : undefined,
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
          notify(STALE_REPLY_EDIT_MESSAGE);
          throw new HandledMutationError(STALE_REPLY_EDIT_MESSAGE, 'blocked', 'permission_denied', serverConfirmed);
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
        return withPickedAttachmentCopies(
          { type: 'image/*', maxFiles: 1, maxBytes: MAX_REPLY_IMAGE_UPLOAD_BYTES },
          async (picked) => {
            assertWritableTicket(ticket);
            if (!editTarget) assertReplyNotEnded();
            assertCurrentEditTarget();
            if (picked.canceled || !picked.assets?.[0]) {
              throw new HandledMutationError('已取消选择', 'canceled', 'canceled');
            }
            const file = normalizeReplyImageAsset(picked.assets[0]);
            let imageUrl = '';
            if (isDiscourseSource(actionTopic.source)) {
              const result = await runLinuxDoRequest({ type: 'upload', file }, trace, ticket, {
                beforeSend: () => {
                  if (!editTarget) assertReplyNotEnded();
                  assertCurrentEditTarget();
                }
              });
              imageUrl = discourseImageUrlFromUploadResponse(result, LINUXDO_BASE_URL, 'linux.do');
            } else if (isYaohuoActionTopic(actionTopic)) {
              imageUrl = await uploadYaohuoReplyImage({
                fetcher: withRequestBeforeSend(withDiagnosticFetcher(trace, fetcher), () => {
                  assertWritableTicket(ticket);
                  assertCurrentEditTarget();
                  assertReplyNotEnded();
                }),
                file
              });
            } else if (isNodeSeekActionTopic(actionTopic)) {
              try {
                imageUrl = await uploadNodeSeekReplyImageWithApiKey({
                  ensureApiKey: async () => nodeSeekApiKey,
                  fetcher: withRequestBeforeSend(withDiagnosticFetcher(trace, authenticatedFetcher), () => {
                    assertWritableTicket(ticket);
                    assertCurrentEditTarget();
                    if (nodeImageGeneration !== currentNodeImageApiKeyGeneration()) {
                      throw new HandledMutationError('NodeImage 凭据已变化', 'stale', 'stale');
                    }
                  }),
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
            return {
              applyResult: () => {
                uploadedMarkup = replyImageMarkupForSource(actionTopic.source, imageUrl, file.name);
              },
              successMessage: '图片已插入'
            };
          }
        );
      }
    });
    return uploadedMarkup || undefined;
  }, [
    assertReplyNotEnded,
    cacheKeys,
    detachReplyEdit,
    ensureNodeImageApiKey,
    executeMutation,
    authenticatedFetcher,
    fetcher,
    notify,
    queryClient,
    replyComposerIntent,
    replyComposerIntentRef,
    runLinuxDoRequest,
    selectedTopic,
    topicDetail,
    topicReplies
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

          task: async (ticket) => {
            await runLinuxDoRequest(
              {
                type: 'set-like',
                postId: commentId,
                active: desired
              },
              trace,
              ticket
            );
            return {
              applyResult: () => {
                void updateInteraction(actionTopic as TopicDetail, patch);
              },
              successMessage: desired ? '点赞已提交' : '已取消点赞'
            };
          }
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

        task: async (ticket) => {
          await runNodeSeekRequest(buildNodeSeekInteractionRequest({ type, commentId, active: false }), trace, ticket);
          return {
            applyResult: () => {
              void updateInteraction(actionTopic as TopicDetail, patch);
            },
            successMessage: type === 'upvote' ? '点赞已提交' : type === 'like' ? '加鸡腿请求已提交' : '反对已提交'
          };
        }
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
      applyOptimistic: () => toggleBookmarkOptimistically(patch, bookmarked, actionDetail),
      task: async (ticket) => {
        const result = await runYaohuoRequest(
          () =>
            bookmarked
              ? buildYaohuoDeleteFavoriteRequest({ favoriteId: actionDetail.bookmarkId || 0 })
              : buildYaohuoFavoriteRequest({
                  topicId: actionTopic.id,
                  classId: actionTopic.categoryId || YAOHUO_DEFAULT_CLASS_ID
                }),
          trace,
          ticket
        );
        return {
          applyResult: () => {
            const yaohuoResult = result;
            patch(!bookmarked, bookmarked ? undefined : yaohuoResult.favoriteId);
          },
          successMessage: bookmarked ? '已取消收藏' : '收藏已提交'
        };
      }
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
      task: async (ticket) => {
        await runNodeSeekRequest(buildNodeSeekCollectionRequest({ postId: actionTopic.id, collected }), trace, ticket);
        return { successMessage: collected ? '已取消收藏' : '收藏已提交' };
      }
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
      applyOptimistic: () => toggleBookmarkOptimistically(patch, bookmarked, actionDetail),
      task: async (ticket) => {
        const result = await runLinuxDoRequest(
          {
            type: 'set-bookmark',
            targetId: actionTopic.id,
            targetType: 'Topic',
            active: !bookmarked,
            bookmarkId: actionDetail.bookmarkId
          },
          trace,
          ticket
        );
        return {
          applyResult: () => patch(!bookmarked, bookmarked ? undefined : discourseBookmarkIdFromActionResult(result)),
          successMessage: bookmarked ? '已取消收藏' : '收藏已提交'
        };
      }
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
      const ownsConfirmation = captureConfirmation();
      const beforeSend = () => {
        if (ownsConfirmation()) return;
        outcome = 'canceled';
        throw new HandledMutationError('已取消付款', 'canceled', 'canceled');
      };
      await executeMutation(actionTopic as TopicDetail, {
        actionKey: 'stardust-payment',
        busy: true,
        decision: { action: 'pay' },
        trace,
        task: async (ticket) => {
          const prepareResult = await runNodeSeekRequest(
            buildNodeSeekStardustPrepareRequest({ receiverId: receive.receiverMemberId }),
            trace,
            ticket,
            { beforeSend }
          );
          beforeSend();
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
          beforeSend();
          try {
            const sendResult = await runNodeSeekRequest(sendRequest, trace, ticket, {
              beforeSend,
              notifyFailure: false
            });
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
            if (error instanceof HandledMutationError && error.outcome === 'canceled') throw error;
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
          return { successMessage: '付款已由 NodeSeek 确认' };
        }
      });
      return outcome;
    },
    [captureConfirmation, executeMutation, notify, runNodeSeekRequest, selectedTopic, topicDetail]
  );

  const resolveLinuxDoUpload = useCallback(
    async (shortUrl: string) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      if (actionTopic?.source !== 'linuxdo') throw new Error('当前入口不支持图片地址解析');
      const trace = beginDiagnosticTrace('reply', 'image-load', { source: 'linuxdo' });
      let ticket: WritableSessionTicket | undefined;
      try {
        ticket = await ensureWritableSession('linuxdo');
        const requestTicket = ticket;
        assertWritableTicket(ticket);
        const url = await fetchLinuxDoUploadUrl({
          shortUrl,
          userAgent: linuxDoUserAgent(),
          fetcher: withFetchGuard(withDiagnosticFetcher(trace, authenticatedFetcher), () =>
            assertWritableTicket(requestTicket)
          )
        });
        assertWritableTicket(ticket);
        finishDiagnosticTrace(trace, 'success');
        return url;
      } catch (error) {
        reportAccountError(error, ticket, trace);
        finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
        throw error;
      }
    },
    [
      topicDetail,
      selectedTopic,
      ensureWritableSession,
      assertWritableTicket,
      authenticatedFetcher,
      linuxDoUserAgent,
      reportAccountError
    ]
  );

  const loadLinuxDoEditorData = useCallback(
    async <T>(
      operation: 'load-templates' | 'load-poll-capabilities',
      read: (options: Parameters<typeof fetchLinuxDoTemplates>[0]) => Promise<T>,
      itemCount: (result: T) => number
    ) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      const trace = beginDiagnosticTrace('reply', operation, {
        ...(actionTopic ? { source: actionTopic.source } : {})
      });
      if (!actionTopic || actionTopic.source !== 'linuxdo') {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        throw new Error(`当前入口不支持 LinuxDo ${operation === 'load-templates' ? '模板' : '投票配置'}`);
      }
      let ticket: WritableSessionTicket | undefined;
      try {
        ticket = await ensureWritableSession('linuxdo');
        const requestTicket = ticket;
        assertWritableTicket(ticket);
        const result = await read({
          fetcher: withFetchGuard(withDiagnosticFetcher(trace, authenticatedFetcher), () =>
            assertWritableTicket(requestTicket)
          ),
          userAgent: linuxDoUserAgent()
        });
        assertWritableTicket(ticket);
        finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', itemCount: itemCount(result) });
        return result;
      } catch (error) {
        reportAccountError(error, ticket, trace);
        if (isLoginRequiredError(error)) showLinuxDoVerification(errorMessage(error));
        finishDiagnosticTrace(trace, 'failure', { source: 'linuxdo', reason: normalizeDiagnosticReason(error) });
        throw error;
      }
    },
    [
      assertWritableTicket,
      authenticatedFetcher,
      linuxDoUserAgent,
      reportAccountError,
      showLinuxDoVerification,
      ensureWritableSession,
      selectedTopic,
      topicDetail
    ]
  );
  const loadLinuxDoTemplates = useCallback(
    () => loadLinuxDoEditorData('load-templates', fetchLinuxDoTemplates, (items) => items.length),
    [loadLinuxDoEditorData]
  );
  const loadLinuxDoPollCapabilities = useCallback(
    () => loadLinuxDoEditorData('load-poll-capabilities', fetchLinuxDoPollCapabilities, (value) => value.groups.length),
    [loadLinuxDoEditorData]
  );

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
      let ticket: WritableSessionTicket | undefined;
      try {
        ticket = await ensureWritableSession('linuxdo');
        const requestTicket = ticket;
        assertWritableTicket(ticket);
        await recordLinuxDoTemplateUse({
          fetcher: withRequestBeforeSend(withDiagnosticFetcher(trace, authenticatedFetcher), () =>
            assertWritableTicket(requestTicket)
          ),
          id,
          userAgent: linuxDoUserAgent()
        });
        assertWritableTicket(ticket, true);
        finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', serverConfirmed: true });
      } catch (error) {
        reportAccountError(error, ticket, trace);
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
      reportAccountError,
      showLinuxDoVerification,
      ensureWritableSession,
      selectedTopic,
      topicDetail
    ]
  );

  const setPolicyAcceptance = useCallback(
    async (policy: DiscoursePostPolicy, accepted: boolean) => {
      const actionTopic = currentTopicActionTopic(topicDetail, selectedTopic);
      if (!activeRef.current || actionTopic?.source !== 'linuxdo' || policies.hasRequest()) return;
      const scope = policyScope;
      if (scope !== policyScopeRef.current) return;
      const submitted = policies.submitted(scope, policy);
      if (submitted?.scope === scope && submitted.postId === policy.postId && submitted.version === policy.version) {
        notify('操作已提交，请刷新公告核对阅读状态');
        return;
      }
      const decision = decisionForRef.current({
        action: 'policy',
        objectAllowed: accepted ? policy.canAccept : policy.canRevoke,
        targetPresent: /^[1-9]\d*$/.test(policy.postId)
      });
      if (!decision.allowed) {
        notify(topicActionDecisionMessage(decision));
        return;
      }
      const run = policies.claim({ scope, policy, accepted, busyDuringConfirmation: true });
      if (!run) return;
      const controller = run.controller;
      const isCurrent = () =>
        policies.owns(run) && !controller.signal.aborted && activeRef.current && policyScopeRef.current === scope;
      const assertCurrent = (ticket: WritableSessionTicket, beforeSend = false) => {
        if (!isCurrent()) throw new HandledMutationError('操作已取消', 'canceled', 'canceled');
        assertWritableTicket(ticket);
        if (!beforeSend) return;
        const current = [
          policyContentRef.current.topicDetail?.policy,
          ...policyContentRef.current.topicReplies.map((reply) => reply.policy)
        ].find((candidate) => candidate?.postId === policy.postId);
        if (current?.version !== policy.version || !(accepted ? current.canAccept : current.canRevoke)) {
          throw new HandledMutationError('公告状态已变化，请刷新后重试', 'blocked', 'permission_denied');
        }
      };
      try {
        if (!accepted) {
          const confirmed = await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (value: boolean) => {
              if (settled) return;
              settled = true;
              controller.signal.removeEventListener('abort', cancel);
              resolve(value);
            };
            const cancel = () => finish(false);
            controller.signal.addEventListener('abort', cancel, { once: true });
            Alert.alert(
              '撤销阅读确认？',
              '撤销后将恢复为尚未确认阅读。',
              [
                { text: '取消', style: 'cancel', onPress: cancel },
                { text: '撤销确认', style: 'destructive', onPress: () => finish(true) }
              ],
              { cancelable: true, onDismiss: cancel }
            );
          });
          if (!confirmed || !isCurrent()) return;
        }
        if (!policies.beginSend(run)) return;
        const trace = beginDiagnosticTrace('topic', 'apply', { source: 'linuxdo' });
        await executeMutation(actionTopic as TopicDetail, {
          actionKey: `policy:${policy.postId}:${policy.version}`,
          busy: true,
          decision: { action: 'policy', objectAllowed: accepted ? policy.canAccept : policy.canRevoke },
          trace,
          isCurrent,
          task: async (ticket) => {
            assertCurrent(ticket, true);
            try {
              const result = await setLinuxDoPolicyAcceptance({
                policy,
                accepted,
                signal: controller.signal,
                userAgent: linuxDoUserAgent(),
                fetcher: withRequestBeforeSend(withDiagnosticFetcher(trace, authenticatedFetcher), () =>
                  assertCurrent(ticket, true)
                )
              });
              assertCurrent(ticket);
              if (!result.confirmed) {
                const message = result.message || '操作结果尚未确认，请刷新公告核对';
                notify(message);
                throw new HandledMutationError(message, 'failure', 'invalid_response');
              }
              policies.confirmed(run);
              await result;
              return {
                afterSuccess: async () => {
                  if (!isCurrent()) return false;
                  try {
                    const result = await refreshWholeTopicRef.current();
                    return result === 'completed' || result === true;
                  } catch {
                    return false;
                  }
                },
                successMessage: (refreshed) =>
                  refreshed === false
                    ? '提交已由原站确认，但阅读状态刷新失败，请刷新公告核对'
                    : '提交已由原站确认，阅读状态以刷新后的公告为准'
              };
            } catch (error) {
              if (!isCurrent()) throw new HandledMutationError('操作已取消', 'canceled', 'canceled');
              if (
                error instanceof HandledMutationError ||
                isRawUnauthorized(error) ||
                errorRequiresAccountRecheck(error)
              )
                throw error;
              const message = errorMessage(error);
              if (isLoginRequiredError(error)) showLinuxDoVerification(message);
              else notify(message);
              throw new HandledMutationError(message, 'failure', normalizeDiagnosticReason(error));
            }
          }
        });
      } finally {
        policies.finish(run);
      }
    },
    [
      activeRef,
      assertWritableTicket,
      authenticatedFetcher,
      decisionForRef,
      executeMutation,
      linuxDoUserAgent,
      notify,
      policyContentRef,
      policyScope,
      policyScopeRef,
      refreshWholeTopicRef,
      selectedTopic,
      showLinuxDoVerification,
      topicDetail,
      policies
    ]
  );

  const { editReply, submitReply, deleteReply } = useTopicReplyActions({
    active,
    sessionEpochs,
    ensureWritableSession,
    isWritableSessionTicketCurrent: currentWritableTicket,
    notify,
    siteSessionViewModels,
    topicDetail,
    topicReplies,
    topicSession,
    executeMutation,
    captureConfirmation,
    decisionFor,
    getReplyComposerIntent,
    assertReplyNotEnded,
    cacheKeys,
    queryClient,
    refreshRepliesAfterWrite,
    materializeNodeSeekPolls,
    runNodeSeekRequest,
    runLinuxDoRequest,
    runYaohuoRequest
  });
  const { votePoll, lockNodeSeekPoll } = useTopicPollActions({
    topicDetail,
    selectedTopic,
    getNodeSeekUserAgent,
    notify,
    executeMutation,
    captureConfirmation,
    decisionFor,
    assertWritableTicket,
    authenticatedFetcher,
    applyPollResult,
    runNodeSeekRequest,
    runLinuxDoRequest,
    runYaohuoRequest
  });
  return {
    actionBusy,
    boostComposer,
    openBoostComposer,
    closeBoostComposer,
    changeBoostContent,
    submitBoost,
    deleteBoost,
    reactToPost,
    recheckLinuxDoPost,
    loadLinuxDoInteractionConfig,
    linuxDoInteractionConfigQuery,
    replyImageUploading,
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
    resolveLinuxDoUpload,
    policySubmissions,
    setPolicyAcceptance,
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
