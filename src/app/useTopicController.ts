import { useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  getReply,
  getReplies,
  getTopic,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect
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
import { pushTopicSession, topicSessionFromSnapshot } from '../topicSessionState';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import { topicWithAuthorFallback } from '../userNavigation';
import type { Fetcher } from '../request';
import type { FeedSource, Reply, Source, Topic, TopicDetail } from '../types';
import type { ReplyFilter, ReplyTarget, Screen, TopicSnapshot } from '../appTypes';

const NODESEEK_DETAIL_TIMEOUT_MS = 30000;
const LINUXDO_DETAIL_TIMEOUT_MS = 30000;

type MutableRef<T> = { current: T };

export function useTopicController({
  changeScreen,
  clearTopicScrollRestoreTimer,
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
  setCommentQuery,
  setLoadingMoreReplies,
  setLoadedQuotedReplies,
  setLoadingQuotedFloors,
  setReplyComposerOpen,
  setReplyContent,
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
  showNodeSeekVerification,
  showYaohuoLogin,
  topicAbortRef,
  topicBackStackRef,
  topicDetail,
  topicReplies,
  topicRepliesRef,
  topicRequestIdRef,
  topicReturnScreenRef,
  topicScrollRef,
  topicScrollRestoreTimerRef,
  topicSnapshot,
  updateExpandedQuotes,
  repliesAbortRef,
  repliesRequestIdRef
}: {
  changeScreen: (nextScreen: Screen) => void;
  clearTopicScrollRestoreTimer: () => void;
  clearYaohuoLoginState: () => Promise<void>;
  commitReaderData: (updater: (current: ReaderData) => ReaderData) => void;
  currentTopicKeyRef: MutableRef<string | null>;
  expandedQuotesRef: MutableRef<Record<string, boolean>>;
  fetcher: Fetcher;
  handleLinuxDoCloudflareForTopic: (topic: Topic, message: string) => Promise<boolean>;
  linuxDoDismissedVerificationTopicKeyRef: MutableRef<string | null>;
  linuxDoPendingTopicVerifiedRef: MutableRef<boolean>;
  linuxDoVerifiedRetryTopicKeyRef: MutableRef<string | null>;
  loadNodeSeekCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
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
  setCommentQuery: Dispatch<SetStateAction<string>>;
  setLoadingMoreReplies: Dispatch<SetStateAction<boolean>>;
  setLoadedQuotedReplies: (updater: (current: Record<number, Reply>) => Record<number, Reply>) => void;
  setLoadingQuotedFloors: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  setReplyComposerOpen: Dispatch<SetStateAction<boolean>>;
  setReplyContent: Dispatch<SetStateAction<string>>;
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
  showNodeSeekVerification: (message?: string) => void;
  showYaohuoLogin: (message?: string) => void;
  topicAbortRef: MutableRef<AbortController | null>;
  topicBackStackRef: MutableRef<TopicSnapshot[]>;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicRepliesRef: MutableRef<Reply[]>;
  topicRequestIdRef: MutableRef<number>;
  topicReturnScreenRef: MutableRef<Exclude<Screen, 'topic'>>;
  topicScrollRef: MutableRef<{ scrollToOffset: (params: { offset: number; animated: boolean }) => void } | null>;
  topicScrollRestoreTimerRef: MutableRef<ReturnType<typeof setTimeout> | null>;
  topicSnapshot: () => TopicSnapshot;
  updateExpandedQuotes: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  repliesAbortRef: MutableRef<AbortController | null>;
  repliesRequestIdRef: MutableRef<number>;
}) {
  const topicRequestOwnerRef = useRef(createRequestOwner('topic'));
  const repliesRequestOwnerRef = useRef(createRequestOwner('topic-replies'));
  const currentTopic = topicDetail || selectedTopic;
  const currentTopicKey = screen === 'topic' && currentTopic ? topicKey(currentTopic) : null;
  const topicFavorite = useMemo(() => (
    Boolean(currentTopic && readerData.favorites[topicKey(currentTopic)])
  ), [currentTopic, readerData.favorites]);

  const openTopic = useCallback(async (topic: Topic, nocache = false) => {
    clearTopicScrollRestoreTimer();
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
        expandedQuotes: session.expandedQuotes,
        loadedQuotedReplies: session.loadedQuotedReplies,
        loadingQuotedFloors: session.loadingQuotedFloors,
        scrollY: session.scrollY
      }));
      pushTopicScreen();
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
    const isCurrentTopicRequest = () => isCurrentOwnedRequest(requestOwner, topicRequestOwnerRef) && requestId === topicRequestIdRef.current;
    repliesRequestIdRef.current += 1;
    repliesAbortRef.current?.abort();
    loadingMoreRepliesRef.current = false;
    onTopicContextChange(nextTopicKey);
    currentTopicKeyRef.current = nextTopicKey;
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
    setReplyFilter('all');
    resetQuoteState();
    if (!reopenExistingTopicScreen) {
      changeScreen('topic');
    }
    setTopicBusy(true);
    const controller = startAbortableRequest(topicAbortRef);
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(topic.source),
        loadNodeSeekCookieForSource(topic.source)
      ]);
      if (!isCurrentTopicRequest()) {
        return;
      }
      if (topic.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        return;
      }
      const detail = topic.source === 'yaohuo'
        ? await getYaohuoTopicDirect({ topic, yaohuoCookie, replyLimit: 30, signal: controller.signal })
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
      const progress = readerDataRef.current.progress[topicKey(displayDetail)];
      if (progress?.scrollY) {
        const restoreTopicKey = topicKey(displayDetail);
        topicScrollRestoreTimerRef.current = setTimeout(() => {
          topicScrollRestoreTimerRef.current = null;
          if (currentTopicKeyRef.current !== restoreTopicKey) {
            return;
          }
          topicScrollRef.current?.scrollToOffset({ offset: progress.scrollY, animated: false });
          notify(`已恢复到上次阅读位置 ${progress.percent}%`);
        }, 180);
      }
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
          showNodeSeekVerification(message);
          return;
        }
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
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
    clearTopicScrollRestoreTimer,
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
    setCommentQuery,
    setLoadingMoreReplies,
    setReplyComposerOpen,
    setReplyContent,
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
    showNodeSeekVerification,
    showYaohuoLogin,
    topicAbortRef,
    topicBackStackRef,
    topicRequestIdRef,
    topicReturnScreenRef,
    topicScrollRef,
    topicScrollRestoreTimerRef,
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
    const isCurrentRepliesRequest = () => isCurrentOwnedRequest(requestOwner, repliesRequestOwnerRef) && currentTopicKeyRef.current === requestTopicKey && requestId === repliesRequestIdRef.current;
    loadingMoreRepliesRef.current = true;
    repliesAbortRef.current?.abort();
    let controller: AbortController | null = null;
    setLoadingMoreReplies(true);
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(detail.source);
      const nodeSeekCookie = await loadNodeSeekCookieForSource(detail.source);
      if (!isCurrentRepliesRequest()) {
        return false;
      }
      if (detail.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
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
        ? await getYaohuoRepliesDirect({
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
        setReplyHasMore(Boolean(data.hasMore && data.nextPage));
        setReplyNextPage(data.nextPage ?? null);
        setReplyNextOffset(data.nextOffset ?? null);
      }
      if (!silent) {
        notify(`评论已更新${data.items.length ? `，读取 ${data.items.length} 条` : ''}`);
      }
      return true;
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
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
          showNodeSeekVerification(errorMessage(error));
          return false;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
      return false;
    } finally {
      if (isCurrentOwnedRequest(requestOwner, repliesRequestOwnerRef) && requestId === repliesRequestIdRef.current) {
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
    setLoadingMoreReplies,
    setReplyHasMore,
    setReplyNextOffset,
    setReplyNextPage,
    setTopicReplies,
    showNodeSeekVerification,
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
    const isCurrentRepliesRequest = () => isCurrentOwnedRequest(requestOwner, repliesRequestOwnerRef) && currentTopicKeyRef.current === requestTopicKey && requestId === repliesRequestIdRef.current;
    loadingMoreRepliesRef.current = true;
    let controller: AbortController | null = null;
    setLoadingMoreReplies(true);
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(detail.source);
      const nodeSeekCookie = await loadNodeSeekCookieForSource(detail.source);
      if (!isCurrentRepliesRequest()) {
        return;
      }
      if (detail.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        return;
      }
      controller = startAbortableRequest(repliesAbortRef);
      const data = detail.source === 'yaohuo'
        ? await getYaohuoRepliesDirect({
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
      const previousReplyCount = currentReplies.length;
      const mergedReplies = mergeReplies(currentReplies, data.items);
      const addedReplies = mergedReplies.length > previousReplyCount;
      setTopicReplies(mergedReplies);
      setReplyHasMore(Boolean(data.hasMore && data.nextPage && mergedReplies.length > previousReplyCount));
      setReplyNextPage(addedReplies ? data.nextPage ?? null : null);
      setReplyNextOffset(addedReplies ? data.nextOffset ?? null : null);
      notify(`已加载 ${data.items.length} 条回复`);
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
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
          showNodeSeekVerification(errorMessage(error));
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (isCurrentOwnedRequest(requestOwner, repliesRequestOwnerRef) && requestId === repliesRequestIdRef.current) {
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
    setLoadingMoreReplies,
    setReplyHasMore,
    setReplyNextOffset,
    setReplyNextPage,
    setTopicReplies,
    showNodeSeekVerification,
    showYaohuoLogin,
    topicDetail,
    topicRepliesRef
  ]);

  const refreshTopic = useCallback(() => {
    void refreshTopicReplies();
  }, [refreshTopicReplies]);

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
    refreshTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    toggleQuotedFloor,
    topicFavorite
  };
}
