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
  screen,
  showYaohuoLogin,
  sourceGateway,
  topicAbortRef,
  topicRequestIdRef,
  topicReturnScreenRef,
  topicSession
}: {
  changeScreen: (nextScreen: Screen) => void;
  commitReaderData: (updater: (current: ReaderData) => ReaderData) => void;
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
    const reopenExistingTopicScreen = reopenExistingTopicScreenRef.current;
    reopenExistingTopicScreenRef.current = false;
    if (!reopenExistingTopicScreen) {
      linuxDoDismissedVerificationTopicKeyRef.current = null;
    }
    const nextTopicKey = topicKey(topic);
    const activeTopicKey = topicCommands.getCurrentKey() || (reopenExistingTopicScreen && selectedTopic ? topicKey(selectedTopic) : null);
    const opensDifferentTopic = nextTopicKey !== activeTopicKey;
    if (screen !== 'topic' && !reopenExistingTopicScreen) {
      topicReturnScreenRef.current = screen;
      topicNavigation.clearBackStack();
    } else if (opensDifferentTopic) {
      topicNavigation.pushBackStack(topicSnapshot(), topic);
      pushTopicScreen();
    }
    if (screen !== 'topic' && shouldReuseCurrentTopicDetail({
      currentDetail: topicDetail,
      nextTopic: topic,
      nocache,
      reopenExistingTopicScreen
    })) {
      topicCommands.reuse(topic, nextTopicKey);
      if (!reopenExistingTopicScreen) {
        changeScreen('topic');
      }
      return;
    }
    if (screen === 'topic' && !reopenExistingTopicScreen && !opensDifferentTopic && !nocache) {
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
      }, { isCurrent: isCurrentTopicRequest });
      if (!isCurrentTopicRequest()) {
        return;
      }
      const displayDetail = topicWithAuthorFallback(detail, topic) || detail;
      const previousReplyCount = readerDataRef.current.history[topicKey(displayDetail)]?.topic.replyCount;
      topicCommands.resolveLoad(
        displayDetail,
        typeof previousReplyCount === 'number' && displayDetail.replyCount > previousReplyCount ? displayDetail.replyCount - previousReplyCount : 0
      );
      commitReaderData((current) => updateFavoriteTopic(recordHistory(current, displayDetail), displayDetail));
      if (nocache) {
        notify('主题已更新');
      }
      linuxDoVerifiedRetryTopicKeyRef.current = null;
    } catch (error) {
      if (isCurrentTopicRequest()) {
        const sourceError = sourceErrorFromUnknown(topic.source, error);
        const message = sourceError.message;
        topicCommands.failLoad(sourceError);
        if (topic.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          await handleLinuxDoCloudflareForTopic(topic, message);
          return;
        }
        if (topic.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          onNodeSeekTopicVerificationRequired(message);
          return;
        }
        if (topic.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          if (sourceError.kind === 'login-expired') {
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
    screen,
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
    excludeReply
  }: TopicRepliesRefreshOptions = {}) => {
    const detail = topicDetail || selectedTopic;
    if (!detail) {
      return false;
    }
    if (detail.source === 'v2ex') {
      await openTopic(detail, true);
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
      }, { isCurrent: isCurrentRepliesRequest });
      if (!isCurrentRepliesRequest()) {
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
      return true;
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        const sourceError = sourceErrorFromUnknown(detail.source, error);
        if (detail.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(sourceError.message);
          }
          return false;
        }
        if (detail.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          await handleLinuxDoCloudflareForTopic(detail, sourceError.message);
          return false;
        }
        if (detail.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          topicCommands.failLoad(sourceError);
          onNodeSeekTopicVerificationRequired(sourceError.message);
          return false;
        }
        if (!isCanceledRequest(error)) {
          notify(sourceError.message);
        }
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
    if (!detail || !replyNextPage || topicReplyCommands.isLoading()) {
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
      }, { isCurrent: isCurrentRepliesRequest });
      if (!isCurrentRepliesRequest()) {
        return;
      }
      const currentReplies = topicReplyCommands.getCurrent();
      const mergedReplies = mergeReplies(currentReplies, data.items);
      const visitedPages = replyVisitedPageKeysRef.current[requestTopicKey] || new Set<string>();
      visitedPages.add(replyPageVisitKey(replyNextPage, replyNextOffset));
      replyVisitedPageKeysRef.current[requestTopicKey] = visitedPages;
      const nextPageKey = replyPageVisitKey(data.nextPage, data.nextOffset);
      const canLoadNext = Boolean(data.hasMore && data.nextPage && !visitedPages.has(nextPageKey));
      topicReplyCommands.resolve({
        replies: mergedReplies,
        hasMore: canLoadNext,
        nextPage: data.nextPage ?? null,
        nextOffset: data.nextOffset ?? null
      });
      notify(`已加载 ${data.items.length} 条回复`);
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        const sourceError = sourceErrorFromUnknown(detail.source, error);
        if (detail.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(sourceError.message);
          }
          return;
        }
        if (detail.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          await handleLinuxDoCloudflareForTopic(detail, sourceError.message);
          return;
        }
        if (detail.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          topicCommands.failLoad(sourceError);
          onNodeSeekTopicVerificationRequired(sourceError.message);
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(sourceError.message);
        }
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

  const toggleQuotedFloor = useCallback(async ({
    replyFloor,
    quotedFloor,
    quotedReply
  }: {
    replyFloor: number;
    quotedFloor: number;
    quotedReply?: Reply;
  }) => {
    const key = `${replyFloor}:${quotedFloor}`;
    if (topicQuotes.isExpanded(key)) {
      topicQuotes.changeExpanded(key, false);
      return;
    }

    if (quotedReply || topicQuotes.getLoaded(quotedFloor)) {
      topicQuotes.changeExpanded(key, true);
      return;
    }

    const detail = topicDetail || selectedTopic;
    if (!detail || detail.source !== 'linuxdo') {
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
        source: detail.source,
        id: detail.id,
        floor: quotedFloor,
        signal: controller.signal
      }, { isCurrent: () => topicCommands.getCurrentKey() === requestTopicKey });
      if (topicCommands.getCurrentKey() !== requestTopicKey) {
        return;
      }
      topicQuotes.remember(loaded);
      topicQuotes.changeExpanded(key, true);
      notify(`引用已展开 #${quotedFloor}`);
    } catch (error) {
      if (topicCommands.getCurrentKey() === requestTopicKey) {
        const sourceError = sourceErrorFromUnknown(detail.source, error);
        if (sourceError.kind === 'verification-required') {
          await handleLinuxDoCloudflareForTopic(detail, sourceError.message);
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(sourceError.message);
        }
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

  return {
    currentTopic,
    currentTopicKey,
    loadMoreReplies,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    toggleQuotedFloor,
    topicFavorite
  };
}
