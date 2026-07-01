import { useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  getReply,
  getReplies,
  getTopic,
  getYaohuoReplies,
  getYaohuoTopic
} from '../sources/sourceGateway';
import {
  recordHistory,
  topicKey,
  updateFavoriteTopic,
  type ReaderData
} from '../readerData';
import { mergeReplies } from '../feedLogic';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  isLinuxDoCloudflareError,
  isNodeSeekCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  startAbortableRequest
} from '../appUtils';
import { REPLY_PAGE_SIZE, replyRefreshTarget } from '../androidFeatureHelpers';
import { pushTopicSession, shouldReuseCurrentTopicDetail, topicSessionFromSnapshot } from '../topicSessionState';
import { createRequestOwner, startOwnedRequest } from '../requestOwnership';
import { isCurrentTopicLoadRequest, isCurrentTopicRepliesRequest } from '../topicRequestState';
import { topicWithAuthorFallback } from '../userNavigation';
import type { Fetcher } from '../request';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import { authHintForSource } from '../siteSessionPrompts';
import type { SiteSessionViewModels } from '../siteSessionState';
import type { FeedSource, Reply, Source, Topic, TopicDetail } from '../types';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget, Screen, TopicSnapshot } from '../appTypes';

const NODESEEK_DETAIL_TIMEOUT_MS = 30000;
const LINUXDO_DETAIL_TIMEOUT_MS = 30000;

type MutableRef<T> = { current: T };

function replyPageVisitKey(page: number | null | undefined, offset?: number | null) {
  return `${page ?? ''}:${offset ?? ''}`;
}

export function useTopicController({
  changeScreen,
  clearYaohuoLoginState,
  commitReaderData,
  currentTopicKeyRef,
  expandedQuotesRef,
  fetcher,
  handleLinuxDoCloudflareForTopic,
  linuxDoDismissedVerificationTopicKeyRef,
  linuxDoPendingTopicVerifiedRef,
  linuxDoVerifiedRetryTopicKeyRef,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  loadedQuotedRepliesRef,
  loadingMoreRepliesRef,
  nodeSeekUserAgentRef,
  notify,
  onTopicContextChange,
  pendingLinuxDoTopicRef,
  pushTopicScreen,
  quotedReplyAbortRefs,
  readerData,
  readerDataRef,
  reopenExistingTopicScreenRef,
  replyNextOffset,
  replyNextPage,
  resetQuoteState,
  screen,
  selectedTopic,
  sessionViewModels,
  setCommentQuery,
  setLoadingMoreReplies,
  setLoadedQuotedReplies,
  setLoadingQuotedFloors,
  setReplyComposerOpen,
  setReplyContent,
  setReplyEditTarget,
  setReplyFilter,
  setReplyHasMore,
  setReplyNextOffset,
  setReplyNextPage,
  setReplyTarget,
  setSelectedTopic,
  setTopicBusy,
  setTopicDetail,
  setTopicError,
  setTopicReplies,
  setUnreadReplyCount,
  onNodeSeekTopicVerificationRequired,
  showYaohuoLogin,
  topicAbortRef,
  topicBackStackRef,
  topicDetail,
  topicReplies,
  topicRepliesRef,
  topicRequestIdRef,
  topicReturnScreenRef,
  topicSnapshot,
  updateExpandedQuotes,
  repliesAbortRef,
  repliesRequestIdRef
}: {
  changeScreen: (nextScreen: Screen) => void;
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  commitReaderData: (updater: (current: ReaderData) => ReaderData) => void;
  currentTopicKeyRef: MutableRef<string | null>;
  expandedQuotesRef: MutableRef<Record<string, boolean>>;
  fetcher: Fetcher;
  handleLinuxDoCloudflareForTopic: (topic: Topic, message: string) => Promise<boolean>;
  linuxDoDismissedVerificationTopicKeyRef: MutableRef<string | null>;
  linuxDoPendingTopicVerifiedRef: MutableRef<boolean>;
  linuxDoVerifiedRetryTopicKeyRef: MutableRef<string | null>;
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  loadedQuotedRepliesRef: MutableRef<Record<number, Reply>>;
  loadingMoreRepliesRef: MutableRef<boolean>;
  nodeSeekUserAgentRef: MutableRef<string>;
  notify: (message: string) => void;
  onTopicContextChange: (topicKey: string | null) => void;
  pendingLinuxDoTopicRef: MutableRef<Topic | null>;
  pushTopicScreen: () => void;
  quotedReplyAbortRefs: MutableRef<Record<string, AbortController>>;
  readerData: ReaderData;
  readerDataRef: MutableRef<ReaderData>;
  reopenExistingTopicScreenRef: MutableRef<boolean>;
  replyNextOffset: number | null;
  replyNextPage: number | null;
  resetQuoteState: () => void;
  screen: Screen;
  selectedTopic: Topic | null;
  sessionViewModels: SiteSessionViewModels;
  setCommentQuery: Dispatch<SetStateAction<string>>;
  setLoadingMoreReplies: Dispatch<SetStateAction<boolean>>;
  setLoadedQuotedReplies: (updater: (current: Record<number, Reply>) => Record<number, Reply>) => void;
  setLoadingQuotedFloors: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  setReplyComposerOpen: Dispatch<SetStateAction<boolean>>;
  setReplyContent: Dispatch<SetStateAction<string>>;
  setReplyEditTarget: Dispatch<SetStateAction<ReplyEditTarget | null>>;
  setReplyFilter: Dispatch<SetStateAction<ReplyFilter>>;
  setReplyHasMore: Dispatch<SetStateAction<boolean>>;
  setReplyNextOffset: Dispatch<SetStateAction<number | null>>;
  setReplyNextPage: Dispatch<SetStateAction<number | null>>;
  setReplyTarget: Dispatch<SetStateAction<ReplyTarget | null>>;
  setSelectedTopic: Dispatch<SetStateAction<Topic | null>>;
  setTopicBusy: Dispatch<SetStateAction<boolean>>;
  setTopicDetail: Dispatch<SetStateAction<TopicDetail | null>>;
  setTopicError: Dispatch<SetStateAction<string>>;
  setTopicReplies: Dispatch<SetStateAction<Reply[]>>;
  setUnreadReplyCount: Dispatch<SetStateAction<number>>;
  onNodeSeekTopicVerificationRequired: (message: string) => void;
  showYaohuoLogin: (message?: string) => void;
  topicAbortRef: MutableRef<AbortController | null>;
  topicBackStackRef: MutableRef<TopicSnapshot[]>;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicRepliesRef: MutableRef<Reply[]>;
  topicRequestIdRef: MutableRef<number>;
  topicReturnScreenRef: MutableRef<Exclude<Screen, 'topic'>>;
  topicSnapshot: () => TopicSnapshot;
  updateExpandedQuotes: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  repliesAbortRef: MutableRef<AbortController | null>;
  repliesRequestIdRef: MutableRef<number>;
}) {
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
    const activeTopicKey = currentTopicKeyRef.current || (reopenExistingTopicScreen && selectedTopic ? topicKey(selectedTopic) : null);
    const opensDifferentTopic = nextTopicKey !== activeTopicKey;
    if (screen !== 'topic' && !reopenExistingTopicScreen) {
      topicReturnScreenRef.current = screen;
      topicBackStackRef.current = [];
    } else if (opensDifferentTopic) {
      topicBackStackRef.current = pushTopicSession(
        topicBackStackRef.current.map(topicSessionFromSnapshot),
        topicSessionFromSnapshot(topicSnapshot()),
        topic
      ).map((session) => ({
        key: session.key,
        selectedTopic: session.selectedTopic,
        topicDetail: session.topicDetail,
        topicReplies: session.topicReplies,
        topicError: session.topicError,
        replyHasMore: session.replyHasMore,
        replyNextPage: session.replyNextPage,
        replyNextOffset: session.replyNextOffset,
        unreadReplyCount: session.unreadReplyCount,
        commentQuery: session.commentQuery,
        replyFilter: session.replyFilter,
        replyContent: session.replyContent,
        replyComposerOpen: session.replyComposerOpen,
        replyTarget: session.replyTarget,
        replyEditTarget: session.replyEditTarget,
        expandedQuotes: session.expandedQuotes,
        loadedQuotedReplies: session.loadedQuotedReplies,
        loadingQuotedFloors: session.loadingQuotedFloors,
        scrollY: session.scrollY
      }));
      pushTopicScreen();
    }
    if (screen !== 'topic' && shouldReuseCurrentTopicDetail({
      currentDetail: topicDetail,
      nextTopic: topic,
      nocache,
      reopenExistingTopicScreen
    })) {
      onTopicContextChange(nextTopicKey);
      currentTopicKeyRef.current = nextTopicKey;
      setSelectedTopic(topic);
      setTopicBusy(false);
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
      currentTopicKeyRef,
      ownerRef: topicRequestOwnerRef,
      requestId,
      requestIdRef: topicRequestIdRef,
      requestOwner,
      requestTopicKey: nextTopicKey
    });
    repliesRequestIdRef.current += 1;
    repliesAbortRef.current?.abort();
    loadingMoreRepliesRef.current = false;
    onTopicContextChange(nextTopicKey);
    currentTopicKeyRef.current = nextTopicKey;
    replyVisitedPageKeysRef.current[nextTopicKey] = new Set();
    setSelectedTopic(topic);
    setTopicDetail(null);
    setTopicError('');
    setTopicReplies([]);
    setCommentQuery('');
    setUnreadReplyCount(0);
    setReplyHasMore(false);
    setReplyNextPage(null);
    setReplyNextOffset(null);
    setLoadingMoreReplies(false);
    setReplyContent('');
    setReplyComposerOpen(false);
    setReplyTarget(null);
    setReplyEditTarget(null);
    setReplyFilter('all');
    resetQuoteState();
    if (!reopenExistingTopicScreen) {
      changeScreen('topic');
    }
    setTopicBusy(true);
    const controller = startAbortableRequest(topicAbortRef);
    let yaohuoGeneration: number | undefined;
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(topic.source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } }),
        loadNodeSeekCookieForSource(topic.source)
      ]);
      if (!isCurrentTopicRequest()) {
        return;
      }
      if (topic.source === 'yaohuo' && !yaohuoCookie) {
        const message = authHintForSource('yaohuo', sessionViewModels, 'read') || '妖火需要登录后使用此功能。';
        setTopicError(message);
        showYaohuoLogin(message);
        return;
      }
      const detail = topic.source === 'yaohuo'
        ? await getYaohuoTopic({ topic, yaohuoCookie, replyLimit: 30, signal: controller.signal })
        : await getTopic({
          source: topic.source,
          id: topic.id,
          fetcher,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal,
          timeoutMs: topic.source === 'nodeseek' ? NODESEEK_DETAIL_TIMEOUT_MS : topic.source === 'linuxdo' ? LINUXDO_DETAIL_TIMEOUT_MS : undefined
        });
      if (!isCurrentTopicRequest()) {
        return;
      }
      const displayDetail = topicWithAuthorFallback(detail, topic) || detail;
      const previousReplyCount = readerDataRef.current.history[topicKey(displayDetail)]?.topic.replyCount;
      setUnreadReplyCount(typeof previousReplyCount === 'number' && displayDetail.replyCount > previousReplyCount ? displayDetail.replyCount - previousReplyCount : 0);
      setTopicDetail(displayDetail);
      setTopicReplies(displayDetail.replies || []);
      setReplyHasMore(Boolean(displayDetail.replyHasMore && displayDetail.replyNextPage));
      setReplyNextPage(displayDetail.replyNextPage ?? null);
      setReplyNextOffset(displayDetail.replyNextOffset ?? null);
      commitReaderData((current) => updateFavoriteTopic(recordHistory(current, displayDetail), displayDetail));
      if (nocache) {
        notify('主题已更新');
      }
      linuxDoVerifiedRetryTopicKeyRef.current = null;
    } catch (error) {
      if (isCurrentTopicRequest()) {
        const message = errorMessage(error);
        setTopicError(message);
        if (isLinuxDoCloudflareError(error)) {
          await handleLinuxDoCloudflareForTopic(topic, message);
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          onNodeSeekTopicVerificationRequired(message);
          return;
        }
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(message);
        }
      }
    } finally {
      if (isCurrentTopicRequest()) {
        setTopicBusy(false);
      }
      finishAbortableRequest(topicAbortRef, controller);
    }
  }, [
    changeScreen,
    clearYaohuoLoginState,
    commitReaderData,
    currentTopicKeyRef,
    fetcher,
    handleLinuxDoCloudflareForTopic,
    linuxDoDismissedVerificationTopicKeyRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoVerifiedRetryTopicKeyRef,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loadingMoreRepliesRef,
    nodeSeekUserAgentRef,
    notify,
    onTopicContextChange,
    pendingLinuxDoTopicRef,
    pushTopicScreen,
    readerDataRef,
    reopenExistingTopicScreenRef,
    repliesAbortRef,
    repliesRequestIdRef,
    resetQuoteState,
    screen,
    selectedTopic,
    sessionViewModels,
    setCommentQuery,
    setLoadingMoreReplies,
    setReplyComposerOpen,
    setReplyContent,
    setReplyEditTarget,
    setReplyFilter,
    setReplyHasMore,
    setReplyNextOffset,
    setReplyNextPage,
    setReplyTarget,
    setSelectedTopic,
    setTopicBusy,
    setTopicDetail,
    setTopicError,
    setTopicReplies,
    setUnreadReplyCount,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    topicAbortRef,
    topicBackStackRef,
    topicDetail,
    topicRequestIdRef,
    topicReturnScreenRef,
    topicSnapshot
  ]);

  const refreshTopicReplies = useCallback(async ({ silent = false, afterSubmit = false }: { silent?: boolean; afterSubmit?: boolean } = {}) => {
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
      currentTopicKeyRef,
      ownerRef: repliesRequestOwnerRef,
      requestId,
      requestIdRef: repliesRequestIdRef,
      requestOwner,
      requestTopicKey
    });
    loadingMoreRepliesRef.current = true;
    repliesAbortRef.current?.abort();
    let controller: AbortController | null = null;
    setLoadingMoreReplies(true);
    let yaohuoGeneration: number | undefined;
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(detail.source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } });
      const nodeSeekCookie = await loadNodeSeekCookieForSource(detail.source);
      if (!isCurrentRepliesRequest()) {
        return false;
      }
      if (detail.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin(authHintForSource('yaohuo', sessionViewModels, 'read') || '妖火需要登录后使用此功能。');
        return false;
      }
      controller = startAbortableRequest(repliesAbortRef);
      const expectedReplyCount = Math.max(detail.replyCount || 0, topicReplies.length) + 1;
      const { page: targetPage, offset: targetOffset } = replyRefreshTarget({
        source: detail.source,
        afterSubmit,
        expectedReplyCount,
        replyNextPage
      });
      const data = detail.source === 'yaohuo'
        ? await getYaohuoReplies({
          id: detail.id,
          categoryId: detail.categoryId,
          page: targetPage,
          limit: REPLY_PAGE_SIZE,
          yaohuoCookie,
          signal: controller.signal
        })
        : await getReplies({
          source: detail.source,
          id: detail.id,
          page: targetPage,
          limit: REPLY_PAGE_SIZE,
          offset: targetOffset,
          fetcher,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal
        });
      if (!isCurrentRepliesRequest()) {
        return false;
      }
      setTopicReplies((current) => afterSubmit ? mergeReplies(current, data.items) : mergeReplies(data.items, current));
      if (!afterSubmit) {
        const visitedPages = replyVisitedPageKeysRef.current[requestTopicKey] || new Set<string>();
        visitedPages.add(replyPageVisitKey(targetPage, targetOffset));
        replyVisitedPageKeysRef.current[requestTopicKey] = visitedPages;
        const nextPageKey = replyPageVisitKey(data.nextPage, data.nextOffset);
        const canLoadNext = Boolean(data.hasMore && data.nextPage && !visitedPages.has(nextPageKey));
        setReplyHasMore(canLoadNext);
        setReplyNextPage(canLoadNext ? data.nextPage ?? null : null);
        setReplyNextOffset(canLoadNext ? data.nextOffset ?? null : null);
      }
      if (!silent) {
        notify(`评论已更新${data.items.length ? `，读取 ${data.items.length} 条` : ''}`);
      }
      return true;
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return false;
        }
        if (isLinuxDoCloudflareError(error)) {
          await handleLinuxDoCloudflareForTopic(detail, errorMessage(error));
          return false;
        }
        if (isNodeSeekCloudflareError(error)) {
          const message = errorMessage(error);
          setTopicError(message);
          onNodeSeekTopicVerificationRequired(message);
          return false;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
      return false;
    } finally {
      if (isCurrentRepliesRequest()) {
        loadingMoreRepliesRef.current = false;
        setLoadingMoreReplies(false);
      }
      if (controller) {
        finishAbortableRequest(repliesAbortRef, controller);
      }
    }
  }, [
    clearYaohuoLoginState,
    currentTopicKeyRef,
    fetcher,
    handleLinuxDoCloudflareForTopic,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loadingMoreRepliesRef,
    nodeSeekUserAgentRef,
    notify,
    openTopic,
    repliesAbortRef,
    repliesRequestIdRef,
    replyNextPage,
    selectedTopic,
    sessionViewModels,
    setLoadingMoreReplies,
    setReplyHasMore,
    setReplyNextOffset,
    setReplyNextPage,
    setTopicReplies,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    topicDetail,
    topicReplies.length
  ]);

  const loadMoreReplies = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail || !replyNextPage || loadingMoreRepliesRef.current) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const requestId = ++repliesRequestIdRef.current;
    const requestOwner = startOwnedRequest(repliesRequestOwnerRef, `topic-replies:${requestTopicKey}:more:${replyNextPage}:${replyNextOffset || ''}`);
    const isCurrentRepliesRequest = () => isCurrentTopicRepliesRequest({
      currentTopicKeyRef,
      ownerRef: repliesRequestOwnerRef,
      requestId,
      requestIdRef: repliesRequestIdRef,
      requestOwner,
      requestTopicKey
    });
    loadingMoreRepliesRef.current = true;
    let controller: AbortController | null = null;
    setLoadingMoreReplies(true);
    let yaohuoGeneration: number | undefined;
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(detail.source, { captureGeneration: (generation) => { yaohuoGeneration = generation; } });
      const nodeSeekCookie = await loadNodeSeekCookieForSource(detail.source);
      if (!isCurrentRepliesRequest()) {
        return;
      }
      if (detail.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin(authHintForSource('yaohuo', sessionViewModels, 'read') || '妖火需要登录后使用此功能。');
        return;
      }
      controller = startAbortableRequest(repliesAbortRef);
      const data = detail.source === 'yaohuo'
        ? await getYaohuoReplies({
          id: detail.id,
          categoryId: detail.categoryId,
          page: replyNextPage,
          limit: 30,
          yaohuoCookie,
          signal: controller.signal
        })
        : await getReplies({
          source: detail.source,
          id: detail.id,
          page: replyNextPage,
          limit: 30,
          offset: replyNextOffset,
          fetcher,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal
        });
      if (!isCurrentRepliesRequest()) {
        return;
      }
      const currentReplies = topicRepliesRef.current;
      const mergedReplies = mergeReplies(currentReplies, data.items);
      const visitedPages = replyVisitedPageKeysRef.current[requestTopicKey] || new Set<string>();
      visitedPages.add(replyPageVisitKey(replyNextPage, replyNextOffset));
      replyVisitedPageKeysRef.current[requestTopicKey] = visitedPages;
      const nextPageKey = replyPageVisitKey(data.nextPage, data.nextOffset);
      const canLoadNext = Boolean(data.hasMore && data.nextPage && !visitedPages.has(nextPageKey));
      setTopicReplies(mergedReplies);
      setReplyHasMore(canLoadNext);
      setReplyNextPage(canLoadNext ? data.nextPage ?? null : null);
      setReplyNextOffset(canLoadNext ? data.nextOffset ?? null : null);
      notify(`已加载 ${data.items.length} 条回复`);
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState({ generation: yaohuoGeneration });
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return;
        }
        if (isLinuxDoCloudflareError(error)) {
          await handleLinuxDoCloudflareForTopic(detail, errorMessage(error));
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          const message = errorMessage(error);
          setTopicError(message);
          onNodeSeekTopicVerificationRequired(message);
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (isCurrentRepliesRequest()) {
        loadingMoreRepliesRef.current = false;
        setLoadingMoreReplies(false);
      }
      if (controller) {
        finishAbortableRequest(repliesAbortRef, controller);
      }
    }
  }, [
    clearYaohuoLoginState,
    currentTopicKeyRef,
    fetcher,
    handleLinuxDoCloudflareForTopic,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loadingMoreRepliesRef,
    nodeSeekUserAgentRef,
    notify,
    repliesAbortRef,
    repliesRequestIdRef,
    replyNextOffset,
    replyNextPage,
    selectedTopic,
    sessionViewModels,
    setLoadingMoreReplies,
    setReplyHasMore,
    setReplyNextOffset,
    setReplyNextPage,
    setTopicReplies,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    topicDetail,
    topicRepliesRef
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
    if (expandedQuotesRef.current[key]) {
      updateExpandedQuotes((current) => ({ ...current, [key]: false }));
      return;
    }

    if (quotedReply || loadedQuotedRepliesRef.current[quotedFloor]) {
      updateExpandedQuotes((current) => ({ ...current, [key]: true }));
      return;
    }

    const detail = topicDetail || selectedTopic;
    if (!detail || detail.source !== 'linuxdo') {
      notify('引用楼层未加载');
      updateExpandedQuotes((current) => ({ ...current, [key]: true }));
      return;
    }
    const requestTopicKey = topicKey(detail);

    setLoadingQuotedFloors((current) => ({ ...current, [key]: true }));
    quotedReplyAbortRefs.current[key]?.abort?.();
    const controller = new AbortController();
    quotedReplyAbortRefs.current[key] = controller;
    try {
      const loaded = await getReply({
        source: detail.source,
        id: detail.id,
        floor: quotedFloor,
        fetcher,
        signal: controller.signal
      });
      if (currentTopicKeyRef.current !== requestTopicKey) {
        return;
      }
      if (loaded.floor) {
        setLoadedQuotedReplies((current) => ({ ...current, [loaded.floor as number]: loaded }));
      }
      updateExpandedQuotes((current) => ({ ...current, [key]: true }));
      notify(`引用已展开 #${quotedFloor}`);
    } catch (error) {
      if (currentTopicKeyRef.current === requestTopicKey) {
        if (isLinuxDoCloudflareError(error)) {
          await handleLinuxDoCloudflareForTopic(detail, errorMessage(error));
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (quotedReplyAbortRefs.current[key] === controller) {
        delete quotedReplyAbortRefs.current[key];
      }
      if (currentTopicKeyRef.current === requestTopicKey) {
        setLoadingQuotedFloors((current) => ({ ...current, [key]: false }));
      }
    }
  }, [
    currentTopicKeyRef,
    expandedQuotesRef,
    fetcher,
    handleLinuxDoCloudflareForTopic,
    loadedQuotedRepliesRef,
    notify,
    quotedReplyAbortRefs,
    selectedTopic,
    setLoadedQuotedReplies,
    setLoadingQuotedFloors,
    topicDetail,
    updateExpandedQuotes
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
