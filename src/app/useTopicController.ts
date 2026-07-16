import { useCallback, useMemo, useRef } from 'react';
import type { SourceGateway } from '../sources/sourceGateway';
import {
  recordHistory,
  topicKey,
  updateFavoriteTopic,
  type ReaderData
} from '../readerData';
import { isSameReply, mergeReplies, removeReply } from '../feedLogic';
import {
  finishAbortableRequest,
  isCanceledRequest,
  startAbortableRequest
} from '../appUtils';
import { REPLY_PAGE_SIZE, replyCountAfterNewReplySubmit, replyLoadMoreLimit, replyRefreshTarget } from '../androidFeatureHelpers';
import { shouldReuseCurrentTopicDetail } from '../topicSessionState';
import { createRequestOwner, startOwnedRequest } from '../requestOwnership';
import { isCurrentTopicLoadRequest, isCurrentTopicRepliesRequest } from '../topicRequestState';
import { topicWithAuthorFallback } from '../userNavigation';
import { applyEditedReplyContent, shouldApplyEditedReplyFallback } from './topicActionControllerHelpers';
import type { TopicSessionController } from './useTopicSessionController';
import { sourceErrorFromUnknown, yaohuoErrorRequiresLoginPanel } from '../sourceErrors';
import type { Reply, Topic } from '../types';
import type { ReplyRefreshTarget, Screen, TopicRepliesRefreshOptions } from '../appTypes';
import type { ReaderDataMutationReason } from './useReaderDataController';
import {
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  replyQuotedPostInstanceKey,
  type ToggleReplyQuoteOptions,
  type ToggleTopicBodyQuoteOptions
} from '../quotedPosts';
import {
  beginDiagnosticTrace,
  diagnosticRef,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason
} from '../diagnostics';

const NODESEEK_DETAIL_TIMEOUT_MS = 30000;
const LINUXDO_DETAIL_TIMEOUT_MS = 30000;

type MutableRef<T> = { current: T };

function replyPageVisitKey(page: number | null | undefined, offset?: number | null) {
  return `${page ?? ''}:${offset ?? ''}`;
}

function replyTargetIndex(replies: Reply[], target?: ReplyRefreshTarget | null) {
  const index = target ? replies.findIndex((reply) => isSameReply(reply, target)) : -1;
  return index >= 0 ? index : undefined;
}

export function useTopicController({
  changeScreen,
  commitReaderData,
  handleLinuxDoCloudflareForTopic,
  linuxDoDismissedVerificationTopicKeyRef,
  linuxDoPendingTopicVerifiedRef,
  linuxDoVerifiedRetryTopicKeyRef,
  notify,
  onNodeSeekTopicVerificationRequired,
  pendingLinuxDoTopicRef,
  pushTopicScreen,
  readerData,
  readerDataRef,
  reopenExistingTopicScreenRef,
  repliesAbortRef,
  repliesRequestIdRef,
  getCurrentScreen,
  screen,
  showYaohuoLogin,
  sourceGateway,
  topicAbortRef,
  topicRequestIdRef,
  topicReturnScreenRef,
  topicSession
}: {
  changeScreen: (nextScreen: Screen) => void;
  commitReaderData: (
    mutationReason: ReaderDataMutationReason,
    updater: (current: ReaderData) => ReaderData
  ) => void;
  handleLinuxDoCloudflareForTopic: (topic: Topic, message: string) => Promise<boolean>;
  linuxDoDismissedVerificationTopicKeyRef: MutableRef<string | null>;
  linuxDoPendingTopicVerifiedRef: MutableRef<boolean>;
  linuxDoVerifiedRetryTopicKeyRef: MutableRef<string | null>;
  notify: (message: string) => void;
  onNodeSeekTopicVerificationRequired: (message: string) => void;
  pendingLinuxDoTopicRef: MutableRef<Topic | null>;
  pushTopicScreen: () => void;
  readerData: ReaderData;
  readerDataRef: MutableRef<ReaderData>;
  reopenExistingTopicScreenRef: MutableRef<boolean>;
  repliesAbortRef: MutableRef<AbortController | null>;
  repliesRequestIdRef: MutableRef<number>;
  getCurrentScreen: () => Screen;
  screen: Screen;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
  topicAbortRef: MutableRef<AbortController | null>;
  topicRequestIdRef: MutableRef<number>;
  topicReturnScreenRef: MutableRef<Exclude<Screen, 'topic'>>;
  topicSession: TopicSessionController;
}) {
  const {
    state: { replyNextOffset, replyNextPage, selectedTopic, topicDetail, topicReplies },
    commands: {
      navigation: topicNavigation,
      quotes: topicQuotes,
      replies: topicReplyCommands,
      topic: topicCommands
    },
    snapshot: topicSnapshot
  } = topicSession;
  const topicRequestOwnerRef = useRef(createRequestOwner('topic'));
  const repliesRequestOwnerRef = useRef(createRequestOwner('topic-replies'));
  const replyVisitedPageKeysRef = useRef<Record<string, Set<string>>>({});
  const currentTopic = topicDetail || selectedTopic;
  const currentTopicKey = screen === 'topic' && currentTopic ? topicKey(currentTopic) : null;
  const topicFavorite = useMemo(() => (
    Boolean(currentTopic && readerData.favorites[topicKey(currentTopic)])
  ), [currentTopic, readerData.favorites]);

  const openTopic = useCallback(async (topic: Topic, nocache = false) => {
    const trace = beginDiagnosticTrace('topic', 'open', {
      source: topic.source,
      topicRef: diagnosticRef('topic', `${topic.source}:${topic.id}`),
      mode: nocache ? 'refresh' : 'open'
    });
    const reopenExistingTopicScreen = reopenExistingTopicScreenRef.current;
    const currentScreen = getCurrentScreen();
    reopenExistingTopicScreenRef.current = false;
    if (!reopenExistingTopicScreen) {
      linuxDoDismissedVerificationTopicKeyRef.current = null;
    }
    const nextTopicKey = topicKey(topic);
    const activeTopicKey = topicCommands.getCurrentKey() || (reopenExistingTopicScreen && selectedTopic ? topicKey(selectedTopic) : null);
    const opensDifferentTopic = nextTopicKey !== activeTopicKey;
    if (currentScreen !== 'topic' && !reopenExistingTopicScreen) {
      topicReturnScreenRef.current = currentScreen;
      topicNavigation.clearBackStack();
    } else if (opensDifferentTopic) {
      topicNavigation.pushBackStack(topicSnapshot(), topic);
      pushTopicScreen();
    }
    if (currentScreen !== 'topic' && shouldReuseCurrentTopicDetail({
      currentDetail: topicDetail,
      nextTopic: topic,
      nocache,
      reopenExistingTopicScreen
    })) {
      topicCommands.reuse(topic, nextTopicKey);
      if (!reopenExistingTopicScreen) {
        changeScreen('topic');
      }
      markDiagnosticStage(trace, 'apply', { state: 'cached-detail-reused' });
      finishDiagnosticTrace(trace, 'success', { state: 'cached-detail-reused' });
      return;
    }
    if (currentScreen === 'topic' && !reopenExistingTopicScreen && !opensDifferentTopic && !nocache) {
      markDiagnosticStage(trace, 'guard', { state: 'same-topic' });
      finishDiagnosticTrace(trace, 'noop', { reason: 'duplicate' });
      return;
    }
    if (pendingLinuxDoTopicRef.current && topicKey(pendingLinuxDoTopicRef.current) !== topicKey(topic)) {
      pendingLinuxDoTopicRef.current = null;
      linuxDoPendingTopicVerifiedRef.current = false;
    }
    if (linuxDoVerifiedRetryTopicKeyRef.current && linuxDoVerifiedRetryTopicKeyRef.current !== topicKey(topic)) {
      linuxDoVerifiedRetryTopicKeyRef.current = null;
    }
    const requestId = ++topicRequestIdRef.current;
    const requestOwner = startOwnedRequest(topicRequestOwnerRef, `topic:${nextTopicKey}:${nocache ? 'nocache' : 'cache'}`);
    const isCurrentTopicRequest = () => isCurrentTopicLoadRequest({
      getCurrentTopicKey: topicCommands.getCurrentKey,
      ownerRef: topicRequestOwnerRef,
      requestId,
      requestIdRef: topicRequestIdRef,
      requestOwner,
      requestTopicKey: nextTopicKey
    });
    repliesRequestIdRef.current += 1;
    repliesAbortRef.current?.abort();
    replyVisitedPageKeysRef.current[nextTopicKey] = new Set();
    topicCommands.beginLoad(topic, nextTopicKey);
    if (!reopenExistingTopicScreen) {
      changeScreen('topic');
    }
    const controller = startAbortableRequest(topicAbortRef);
    try {
      const detail = await sourceGateway.getTopic({
        source: topic.source,
        id: topic.id,
        topic,
        nocache,
        signal: controller.signal,
        timeoutMs: topic.source === 'nodeseek' ? NODESEEK_DETAIL_TIMEOUT_MS : topic.source === 'linuxdo' ? LINUXDO_DETAIL_TIMEOUT_MS : undefined
      }, { isCurrent: isCurrentTopicRequest, trace });
      if (!isCurrentTopicRequest()) {
        finishDiagnosticTrace(trace, 'stale', { source: topic.source, reason: 'stale' });
        return;
      }
      const displayDetail = topicWithAuthorFallback(detail, topic) || detail;
      const previousReplyCount = readerDataRef.current.history[topicKey(displayDetail)]?.topic.replyCount;
      topicCommands.resolveLoad(
        displayDetail,
        typeof previousReplyCount === 'number' && displayDetail.replyCount > previousReplyCount ? displayDetail.replyCount - previousReplyCount : 0
      );
      markDiagnosticStage(trace, 'apply', {
        itemCount: detail.replies?.length || 0,
        hasContent: Boolean(detail.contentHtml?.trim())
      });
      commitReaderData('history-recorded', (current) => (
        updateFavoriteTopic(recordHistory(current, displayDetail), displayDetail)
      ));
      if (nocache) {
        notify('主题已更新');
      }
      linuxDoVerifiedRetryTopicKeyRef.current = null;
      finishDiagnosticTrace(trace, 'success', {
        itemCount: detail.replies?.length || 0,
        hasContent: Boolean(detail.contentHtml?.trim())
      });
    } catch (error) {
      if (isCurrentTopicRequest()) {
        const sourceError = sourceErrorFromUnknown(topic.source, error);
        const message = sourceError.message;
        topicCommands.failLoad(sourceError);
        if (topic.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          await handleLinuxDoCloudflareForTopic(topic, message);
          return;
        }
        if (topic.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          onNodeSeekTopicVerificationRequired(message);
          return;
        }
        if (topic.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'login_required' });
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(message);
          }
          return;
        }
        if (isCanceledRequest(error)) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        } else {
          finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          notify(message);
        }
      } else {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
      }
    } finally {
      if (isCurrentTopicRequest()) {
        topicCommands.finishLoad();
      }
      finishAbortableRequest(topicAbortRef, controller);
    }
  }, [
    topicCommands.beginLoad,
    changeScreen,
    commitReaderData,
    topicNavigation.clearBackStack,
    topicCommands.getCurrentKey,
    getCurrentScreen,
    handleLinuxDoCloudflareForTopic,
    linuxDoDismissedVerificationTopicKeyRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoVerifiedRetryTopicKeyRef,
    notify,
    topicCommands.failLoad,
    topicCommands.finishLoad,
    pendingLinuxDoTopicRef,
    pushTopicScreen,
    topicNavigation.pushBackStack,
    readerDataRef,
    reopenExistingTopicScreenRef,
    repliesAbortRef,
    repliesRequestIdRef,
    topicCommands.resolveLoad,
    topicCommands.reuse,
    selectedTopic,
    sourceGateway,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    topicAbortRef,
    topicDetail,
    topicRequestIdRef,
    topicReturnScreenRef,
    topicSnapshot
  ]);

  const refreshTopicReplies = useCallback(async ({
    silent = false,
    afterSubmit = false,
    nocache = !silent || afterSubmit,
    editedReplyContent,
    targetReply,
    excludeReply,
    diagnosticTrace
  }: TopicRepliesRefreshOptions = {}) => {
    const detail = topicDetail || selectedTopic;
    const ownsTrace = !diagnosticTrace;
    const trace = diagnosticTrace || beginDiagnosticTrace('reply', 'refresh', {
      source: detail?.source || 'unknown',
      ...(detail ? { topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`) } : {}),
      mode: afterSubmit ? 'after-submit' : silent ? 'silent' : 'manual'
    });
    const finishRefreshTrace = (outcome: Parameters<typeof finishDiagnosticTrace>[1], fields: Parameters<typeof finishDiagnosticTrace>[2] = {}) => {
      if (ownsTrace) {
        finishDiagnosticTrace(trace, outcome, fields);
        return;
      }
      markDiagnosticStage(trace, 'apply', {
        ...fields,
        state: `refresh-${outcome}`
      });
    };
    if (!detail) {
      markDiagnosticStage(trace, 'guard', { state: 'missing-topic' });
      finishRefreshTrace('blocked', { reason: 'not_ready' });
      return false;
    }
    if (detail.source === 'v2ex') {
      markDiagnosticStage(trace, 'guard', { state: 'topic-refresh-delegated' });
      await openTopic(detail, true);
      finishRefreshTrace('success', { state: 'topic-refresh-delegated' });
      return true;
    }
    const requestTopicKey = topicKey(detail);
    const requestId = ++repliesRequestIdRef.current;
    const requestOwner = startOwnedRequest(repliesRequestOwnerRef, `topic-replies:${requestTopicKey}:refresh:${afterSubmit ? 'after-submit' : 'manual'}`);
    const isCurrentRepliesRequest = () => isCurrentTopicRepliesRequest({
      getCurrentTopicKey: topicCommands.getCurrentKey,
      ownerRef: repliesRequestOwnerRef,
      requestId,
      requestIdRef: repliesRequestIdRef,
      requestOwner,
      requestTopicKey
    });
    repliesAbortRef.current?.abort();
    let controller: AbortController | null = null;
    topicReplyCommands.beginLoad();
    try {
      controller = startAbortableRequest(repliesAbortRef);
      const expectedReplyCount = Math.max(detail.replyCount || 0, topicReplies.length) + 1;
      const { page: targetPage, offset: targetOffset, limit: targetLimit } = replyRefreshTarget({
        source: detail.source,
        afterSubmit,
        expectedReplyCount,
        replyNextPage,
        replyNextOffset,
        loadedReplyCount: topicReplies.length,
        targetReplyIndex: replyTargetIndex(topicReplies, targetReply)
      });
      const data = await sourceGateway.getReplies({
        source: detail.source,
        id: detail.id,
        categoryId: detail.categoryId,
        page: targetPage,
        limit: targetLimit ?? REPLY_PAGE_SIZE,
        offset: targetOffset,
        nocache,
        fillPages: !afterSubmit && detail.source === 'nodeseek',
        signal: controller.signal
      }, { isCurrent: isCurrentRepliesRequest, trace });
      if (!isCurrentRepliesRequest()) {
        finishRefreshTrace('stale', { reason: 'stale' });
        return false;
      }
      const refreshedItems = removeReply(data.items, excludeReply);
      const mergedReplies = mergeReplies(topicReplyCommands.getCurrent(), refreshedItems);
      const displayedReplies = shouldApplyEditedReplyFallback(refreshedItems, editedReplyContent, detail.source)
        ? applyEditedReplyContent(mergedReplies, editedReplyContent, detail.source)
        : mergedReplies;
      const replyCount = afterSubmit && !targetReply && !excludeReply
        ? replyCountAfterNewReplySubmit(detail.replyCount || 0, displayedReplies.length)
        : undefined;
      if (afterSubmit && !targetReply && !excludeReply) {
        topicReplyCommands.resolve({ replies: displayedReplies, replyCount, requestTopicKey });
      }
      if (!afterSubmit) {
        const visitedPages = replyVisitedPageKeysRef.current[requestTopicKey] || new Set<string>();
        visitedPages.add(replyPageVisitKey(targetPage, targetOffset));
        replyVisitedPageKeysRef.current[requestTopicKey] = visitedPages;
        const nextPageKey = replyPageVisitKey(data.nextPage, data.nextOffset);
        const canLoadNext = Boolean(data.hasMore && data.nextPage && !visitedPages.has(nextPageKey));
        topicReplyCommands.resolve({
          replies: displayedReplies,
          hasMore: canLoadNext,
          nextPage: data.nextPage ?? null,
          nextOffset: data.nextOffset ?? null
        });
      } else if (targetReply || excludeReply) {
        topicReplyCommands.resolve({ replies: displayedReplies });
      }
      if (!silent) {
        notify(`评论已更新${refreshedItems.length ? `，读取 ${refreshedItems.length} 条` : ''}`);
      }
      markDiagnosticStage(trace, 'apply', {
        beforeCount: topicReplies.length,
        afterCount: displayedReplies.length,
        itemCount: refreshedItems.length
      });
      finishRefreshTrace('success', {
        itemCount: refreshedItems.length,
        hasMore: Boolean(data.hasMore)
      });
      return true;
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        const sourceError = sourceErrorFromUnknown(detail.source, error);
        if (detail.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          finishRefreshTrace('blocked', { reason: 'login_required' });
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(sourceError.message);
          }
          return false;
        }
        if (detail.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          finishRefreshTrace('blocked', { reason: 'verification_required' });
          await handleLinuxDoCloudflareForTopic(detail, sourceError.message);
          return false;
        }
        if (detail.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          finishRefreshTrace('blocked', { reason: 'verification_required' });
          topicCommands.failLoad(sourceError);
          onNodeSeekTopicVerificationRequired(sourceError.message);
          return false;
        }
        if (isCanceledRequest(error)) {
          finishRefreshTrace('canceled', { reason: 'canceled' });
        } else {
          finishRefreshTrace('failure', { reason: normalizeDiagnosticReason(error) });
          notify(sourceError.message);
        }
      } else {
        finishRefreshTrace('stale', { reason: 'stale' });
      }
      return false;
    } finally {
      if (isCurrentRepliesRequest()) {
        topicReplyCommands.finishLoad();
      }
      if (controller) {
        finishAbortableRequest(repliesAbortRef, controller);
      }
    }
  }, [
    topicReplyCommands.beginLoad,
    topicCommands.failLoad,
    topicReplyCommands.finishLoad,
    topicCommands.getCurrentKey,
    topicReplyCommands.getCurrent,
    handleLinuxDoCloudflareForTopic,
    notify,
    openTopic,
    repliesAbortRef,
    repliesRequestIdRef,
    replyNextOffset,
    replyNextPage,
    selectedTopic,
    sourceGateway,
    topicReplyCommands.resolve,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    topicDetail,
    topicReplies,
  ]);

  const loadMoreReplies = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    const trace = beginDiagnosticTrace('reply', 'load-more', {
      source: detail?.source || 'unknown',
      ...(detail ? { topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`) } : {}),
      page: replyNextPage || 0
    });
    if (!detail || !replyNextPage || topicReplyCommands.isLoading()) {
      const state = !detail ? 'missing-topic' : !replyNextPage ? 'no-next-page' : 'busy';
      markDiagnosticStage(trace, 'guard', { state });
      finishDiagnosticTrace(
        trace,
        state === 'no-next-page' ? 'noop' : 'blocked',
        { reason: state === 'busy' ? 'busy' : 'not_ready' }
      );
      return;
    }
    const requestTopicKey = topicKey(detail);
    const requestId = ++repliesRequestIdRef.current;
    const requestOwner = startOwnedRequest(repliesRequestOwnerRef, `topic-replies:${requestTopicKey}:more:${replyNextPage}:${replyNextOffset || ''}`);
    const isCurrentRepliesRequest = () => isCurrentTopicRepliesRequest({
      getCurrentTopicKey: topicCommands.getCurrentKey,
      ownerRef: repliesRequestOwnerRef,
      requestId,
      requestIdRef: repliesRequestIdRef,
      requestOwner,
      requestTopicKey
    });
    let controller: AbortController | null = null;
    topicReplyCommands.beginLoad();
    try {
      controller = startAbortableRequest(repliesAbortRef);
      const limit = replyLoadMoreLimit({
        source: detail.source,
        replyNextPage,
        replyNextOffset
      });
      const data = await sourceGateway.getReplies({
        source: detail.source,
        id: detail.id,
        categoryId: detail.categoryId,
        page: replyNextPage,
        limit,
        offset: replyNextOffset,
        signal: controller.signal
      }, { isCurrent: isCurrentRepliesRequest, trace });
      if (!isCurrentRepliesRequest()) {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      const currentReplies = topicReplyCommands.getCurrent();
      const mergedReplies = mergeReplies(currentReplies, data.items);
      const visitedPages = replyVisitedPageKeysRef.current[requestTopicKey] || new Set<string>();
      visitedPages.add(replyPageVisitKey(replyNextPage, replyNextOffset));
      replyVisitedPageKeysRef.current[requestTopicKey] = visitedPages;
      const nextPageKey = replyPageVisitKey(data.nextPage, data.nextOffset);
      const repeatedCursor = Boolean(data.hasMore && data.nextPage && visitedPages.has(nextPageKey));
      const canLoadNext = Boolean(data.hasMore && data.nextPage && !repeatedCursor);
      topicReplyCommands.resolve({
        replies: mergedReplies,
        hasMore: canLoadNext,
        nextPage: data.nextPage ?? null,
        nextOffset: data.nextOffset ?? null
      });
      markDiagnosticStage(trace, 'apply', {
        beforeCount: currentReplies.length,
        afterCount: mergedReplies.length,
        itemCount: data.items.length,
        hasMore: canLoadNext
      });
      finishDiagnosticTrace(
        trace,
        repeatedCursor ? 'partial' : 'success',
        repeatedCursor ? { reason: 'duplicate' } : { itemCount: data.items.length }
      );
      notify(`已加载 ${data.items.length} 条回复`);
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        const sourceError = sourceErrorFromUnknown(detail.source, error);
        if (detail.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'login_required' });
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(sourceError.message);
          }
          return;
        }
        if (detail.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          await handleLinuxDoCloudflareForTopic(detail, sourceError.message);
          return;
        }
        if (detail.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          topicCommands.failLoad(sourceError);
          onNodeSeekTopicVerificationRequired(sourceError.message);
          return;
        }
        if (isCanceledRequest(error)) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        } else {
          finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          notify(sourceError.message);
        }
      } else {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
      }
    } finally {
      if (isCurrentRepliesRequest()) {
        topicReplyCommands.finishLoad();
      }
      if (controller) {
        finishAbortableRequest(repliesAbortRef, controller);
      }
    }
  }, [
    topicReplyCommands.beginLoad,
    topicCommands.failLoad,
    topicReplyCommands.finishLoad,
    topicCommands.getCurrentKey,
    topicReplyCommands.getCurrent,
    handleLinuxDoCloudflareForTopic,
    topicReplyCommands.isLoading,
    notify,
    repliesAbortRef,
    repliesRequestIdRef,
    replyNextOffset,
    replyNextPage,
    selectedTopic,
    sourceGateway,
    topicReplyCommands.resolve,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    topicDetail
  ]);

  const refreshWholeTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail) {
      void openTopic(detail, true);
    }
  }, [openTopic, selectedTopic, topicDetail]);

  const toggleLoadedQuotedPost = useCallback(async ({
    instanceKey,
    reference,
    quotedPost
  }: ToggleTopicBodyQuoteOptions) => {
    const detail = topicDetail || selectedTopic;
    const trace = beginDiagnosticTrace('reply', 'toggle-quote', {
      source: detail?.source || 'unknown',
      ...(detail ? { topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`) } : {})
    });
    const referenceKey = quotedPostReferenceKey(reference);
    const key = instanceKey;
    if (topicQuotes.isExpanded(key)) {
      topicQuotes.changeExpanded(key, false);
      markDiagnosticStage(trace, 'apply', { state: 'collapsed' });
      finishDiagnosticTrace(trace, 'success', { state: 'collapsed' });
      return;
    }

    if (quotedPost || topicQuotes.getLoaded(referenceKey)) {
      topicQuotes.changeExpanded(key, true);
      markDiagnosticStage(trace, 'apply', { state: 'cached-quote' });
      finishDiagnosticTrace(trace, 'success', { state: 'cached-quote' });
      return;
    }

    if (!detail || reference.source !== 'linuxdo') {
      markDiagnosticStage(trace, 'guard', { state: detail ? 'unsupported-source' : 'missing-topic' });
      finishDiagnosticTrace(trace, 'blocked', { reason: detail ? 'unsupported' : 'not_ready' });
      notify('引用楼层未加载');
      topicQuotes.changeExpanded(key, true);
      return;
    }
    const requestTopicKey = topicKey(detail);

    topicQuotes.changeLoading(key, true);
    const controller = new AbortController();
    topicQuotes.replaceRequest(key, controller);
    try {
      const loaded = await sourceGateway.getReply({
        source: reference.source,
        id: reference.topicId,
        floor: reference.postNumber,
        signal: controller.signal
      }, { isCurrent: () => topicCommands.getCurrentKey() === requestTopicKey, trace });
      if (topicCommands.getCurrentKey() !== requestTopicKey) {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      topicQuotes.remember(referenceKey, loaded);
      topicQuotes.changeExpanded(key, true);
      markDiagnosticStage(trace, 'apply', { state: 'quote-expanded' });
      finishDiagnosticTrace(trace, 'success');
      notify(`引用已展开 #${reference.postNumber}`);
    } catch (error) {
      if (topicCommands.getCurrentKey() === requestTopicKey) {
        const sourceError = sourceErrorFromUnknown(reference.source, error);
        if (sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          await handleLinuxDoCloudflareForTopic(detail, sourceError.message);
          return;
        }
        if (isCanceledRequest(error)) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        } else {
          finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          notify(sourceError.message);
        }
      } else {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
      }
    } finally {
      if (topicQuotes.isRequest(key, controller)) {
        topicQuotes.clearRequest(key, controller);
      }
      if (topicCommands.getCurrentKey() === requestTopicKey) {
        topicQuotes.changeLoading(key, false);
      }
    }
  }, [
    topicQuotes.clearRequest,
    topicCommands.getCurrentKey,
    topicQuotes.getLoaded,
    handleLinuxDoCloudflareForTopic,
    topicQuotes.isExpanded,
    topicQuotes.isRequest,
    notify,
    topicQuotes.remember,
    topicQuotes.replaceRequest,
    selectedTopic,
    sourceGateway,
    topicQuotes.changeExpanded,
    topicQuotes.changeLoading,
    topicDetail,
  ]);

  const toggleTopicBodyQuote = useCallback((options: ToggleTopicBodyQuoteOptions) => (
    toggleLoadedQuotedPost(options)
  ), [toggleLoadedQuotedPost]);

  const toggleReplyQuote = useCallback(({
    replyFloor,
    quotedFloor,
    quotedReply
  }: ToggleReplyQuoteOptions) => {
    const detail = topicDetail || selectedTopic;
    const reference = quotedPostReferenceFromReply(detail?.source, detail?.id, quotedFloor);
    if (!reference) {
      notify('引用楼层未加载');
      return;
    }
    return toggleLoadedQuotedPost({
      instanceKey: replyQuotedPostInstanceKey(replyFloor, reference),
      reference,
      quotedPost: quotedReply
    });
  }, [notify, selectedTopic, toggleLoadedQuotedPost, topicDetail]);

  return {
    currentTopic,
    currentTopicKey,
    loadMoreReplies,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    toggleReplyQuote,
    toggleTopicBodyQuote,
    topicFavorite
  };
}
