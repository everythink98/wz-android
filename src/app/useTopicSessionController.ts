import { useCallback, useEffect, useRef, useState } from 'react';
import { createReplyTextIndexForQuery, filterRepliesByQuery } from '../androidFeatureHelpers';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget, TopicSnapshot } from '../appTypes';
import { isSameReply, removeReply } from '../feedLogic';
import { topicKey } from '../readerData';
import { appendReplyImageMarkup } from '../replyImageUpload';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyNodeSeekCollectionToTopic,
  applyPollVoteToReplies,
  applyPollVoteToTopic
} from '../topicActionState';
import { filterRepliesWithImages, type InlineSizedImageUrlMap, type TopicImageDeriver } from '../topicDerivedData';
import {
  createEmptyTopicSession,
  createInactiveTopicSession,
  createTopicRouteSessionStore,
  readTopicRouteSnapshot,
  removeTopicRouteSnapshot,
  saveTopicRouteSnapshot,
  snapshotFromTopicSession,
  topicSessionFromSnapshot,
  pushTopicSnapshot
} from '../topicSessionState';
import type { Reply, Source, SourceErrorInfo, Topic, TopicDetail } from '../types';
import { applyEditedReplyContent } from './topicActionControllerHelpers';

type TopicSessionInteractionPatch = Parameters<typeof applyInteractionToTopic>[1];
type TopicSessionPollVotePatch = Parameters<typeof applyPollVoteToTopic>[1];

export type TopicSessionActionUpdate =
  | { type: 'interaction'; patch: TopicSessionInteractionPatch }
  | { type: 'collection'; collected: boolean }
  | { type: 'bookmark'; bookmarked: boolean; bookmarkId?: number }
  | { type: 'poll-vote'; patch: TopicSessionPollVotePatch }
  | { type: 'reply-deleted'; reply: Reply };

type ResolvedReplies = {
  hasMore?: boolean;
  nextOffset?: number | null;
  nextPage?: number | null;
  replies: Reply[];
  replyCount?: number;
  requestTopicKey?: string;
};

export function topicDetailAfterActionUpdate(topicDetail: TopicDetail | null, update: TopicSessionActionUpdate) {
  if (update.type === 'interaction') {
    return applyInteractionToTopic(topicDetail, update.patch);
  }
  if (update.type === 'collection') {
    return applyNodeSeekCollectionToTopic(topicDetail, update);
  }
  if (update.type === 'bookmark') {
    return applyBookmarkToTopic(topicDetail, update);
  }
  if (update.type === 'poll-vote') {
    return applyPollVoteToTopic(topicDetail, update.patch);
  }
  return topicDetail;
}

export function topicRepliesAfterActionUpdate(topicReplies: Reply[], update: TopicSessionActionUpdate) {
  if (update.type === 'interaction') {
    return applyInteractionToReplies(topicReplies, update.patch);
  }
  if (update.type === 'poll-vote') {
    return applyPollVoteToReplies(topicReplies, update.patch);
  }
  return update.type === 'reply-deleted' ? removeReply(topicReplies, update.reply) : topicReplies;
}

export function actionUpdateClosesReplyComposer(
  update: TopicSessionActionUpdate,
  targets: { replyTarget: ReplyTarget | null; replyEditTarget: ReplyEditTarget | null }
) {
  return update.type === 'reply-deleted'
    && (isSameReply(update.reply, targets.replyTarget) || isSameReply(update.reply, targets.replyEditTarget));
}

export function replyContentAfterComposerClose(content: string, replyEditTarget: ReplyEditTarget | null) {
  return replyEditTarget ? '' : content;
}

export function replyComposerAfterSuccessfulSubmission() {
  return {
    replyComposerOpen: false,
    replyContent: '',
    replyEditTarget: null,
    replyFace: '',
    replyTarget: null
  };
}

export function filterTopicSessionReplies({
  commentQuery,
  inlineSizedImageUrls,
  replyFilter,
  topicDetail,
  topicImageDeriver,
  topicReplies
}: {
  commentQuery: string;
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  replyFilter: ReplyFilter;
  topicDetail: TopicDetail | null;
  topicImageDeriver: TopicImageDeriver;
  topicReplies: Reply[];
}) {
  let replies = topicReplies;
  if (replyFilter === 'author') {
    replies = topicDetail ? topicReplies.filter((reply) => reply.author === topicDetail.author) : topicReplies;
  } else if (replyFilter === 'images') {
    replies = filterRepliesWithImages(topicReplies, inlineSizedImageUrls, topicImageDeriver);
  } else if (replyFilter === 'newest') {
    replies = [...topicReplies].reverse();
  }
  return filterRepliesByQuery(replies, commentQuery, createReplyTextIndexForQuery(topicReplies, commentQuery));
}

export function useTopicSessionController({
  invalidateTopicActionRequests,
  notify
}: {
  invalidateTopicActionRequests: (nextTopicKey: string | null) => void;
  notify: (message: string) => void;
}) {
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicError, setTopicError] = useState<SourceErrorInfo | null>(null);
  const [topicReplies, setTopicReplies] = useState<Reply[]>([]);
  const [replyNextPage, setReplyNextPage] = useState<number | null>(null);
  const [replyNextOffset, setReplyNextOffset] = useState<number | null>(null);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [unreadReplyCount, setUnreadReplyCount] = useState(0);
  const [topicBusy, setTopicBusy] = useState(false);
  const [loadingMoreReplies, setLoadingMoreRepliesState] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
  const [replyFace, setReplyFace] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [debouncedCommentQuery, setDebouncedCommentQuery] = useState('');
  const [replyComposerOpen, setReplyComposerOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [replyEditTarget, setReplyEditTarget] = useState<ReplyEditTarget | null>(null);
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);
  const currentTopicKeyRef = useRef<string | null>(null);
  const activeTopicRouteKeyRef = useRef<string | null>(null);
  const topicRouteSessionStoreRef = useRef(createTopicRouteSessionStore());
  const topicScrollYRef = useRef(0);
  const topicBackStackRef = useRef<TopicSnapshot[]>([]);
  const topicRepliesRef = useRef<Reply[]>(topicReplies);
  const loadingMoreRepliesRef = useRef(false);
  const expandedQuotesRef = useRef<Record<string, boolean>>({});
  const loadedQuotedRepliesRef = useRef<Record<string, Reply>>({});
  const loadingQuotedFloorsRef = useRef<Record<string, boolean>>({});
  const quotedReplyAbortRefs = useRef<Record<string, AbortController>>({});

  topicRepliesRef.current = topicReplies;

  const setLoadingMoreReplies = useCallback((loading: boolean) => {
    loadingMoreRepliesRef.current = loading;
    setLoadingMoreRepliesState(loading);
  }, []);

  useEffect(() => {
    setTopicDetail((current) => {
      if (!current || current.replies === topicReplies) {
        return current;
      }
      return { ...current, replies: topicReplies };
    });
  }, [topicReplies]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCommentQuery(commentQuery), 180);
    return () => clearTimeout(timer);
  }, [commentQuery]);

  const updateExpandedQuotes = useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    expandedQuotesRef.current = updater(expandedQuotesRef.current);
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const updateLoadedQuotedReplies = useCallback((updater: (current: Record<string, Reply>) => Record<string, Reply>) => {
    loadedQuotedRepliesRef.current = updater(loadedQuotedRepliesRef.current);
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const updateLoadingQuotedFloors = useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    loadingQuotedFloorsRef.current = updater(loadingQuotedFloorsRef.current);
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const abortQuotedReplyRequests = useCallback(() => {
    Object.values(quotedReplyAbortRefs.current).forEach((controller) => controller.abort());
    quotedReplyAbortRefs.current = {};
  }, []);

  const resetQuoteState = useCallback(() => {
    abortQuotedReplyRequests();
    expandedQuotesRef.current = {};
    loadedQuotedRepliesRef.current = {};
    loadingQuotedFloorsRef.current = {};
    setQuoteStateVersion((current) => current + 1);
  }, [abortQuotedReplyRequests]);

  const toggleReplyComposer = useCallback((open: boolean) => {
    setReplyComposerOpen(open);
    if (open) {
      setReplyTarget(null);
      setReplyEditTarget(null);
      setReplyFace('');
      return;
    }
    setReplyContent((current) => replyContentAfterComposerClose(current, replyEditTarget));
    setReplyFace('');
    setReplyTarget(null);
    setReplyEditTarget(null);
  }, [replyEditTarget]);

  const replyToFloor = useCallback((reply: Reply) => {
    if (!reply.floor) {
      notify('当前楼层信息不完整，刷新主题后再试。');
      return;
    }
    setReplyTarget({
      floor: reply.floor,
      author: reply.author,
      authorId: reply.authorId,
      commentId: reply.commentId
    });
    setReplyEditTarget(null);
    setReplyFace('');
    setReplyComposerOpen(true);
  }, [notify]);

  const editReply = useCallback((reply: Reply) => {
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
    setReplyTarget(null);
    setReplyFace('');
    setReplyEditTarget({
      commentId: reply.commentId,
      floor: reply.floor,
      contentMarkdown: reply.contentMarkdown
    });
    setReplyContent(reply.contentMarkdown);
    setReplyComposerOpen(true);
  }, [notify]);

  const completeReplySubmission = useCallback((edited?: {
    editedReplyContent: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'>;
    source: Source;
  }) => {
    if (edited) {
      setTopicReplies((current) => applyEditedReplyContent(current, edited.editedReplyContent, edited.source));
    }
    const next = replyComposerAfterSuccessfulSubmission();
    setReplyContent(next.replyContent);
    setReplyFace(next.replyFace);
    setReplyComposerOpen(next.replyComposerOpen);
    setReplyTarget(next.replyTarget);
    setReplyEditTarget(next.replyEditTarget);
  }, []);

  const appendReplyMarkup = useCallback((markup: string) => {
    setReplyContent((current) => appendReplyImageMarkup(current, markup));
  }, []);

  const applyTopicActionUpdate = useCallback((update: TopicSessionActionUpdate) => {
    const activeRouteKey = activeTopicRouteKeyRef.current;
    const routeSnapshot = activeRouteKey
      ? readTopicRouteSnapshot(topicRouteSessionStoreRef.current, activeRouteKey)
      : undefined;
    if (activeRouteKey && routeSnapshot) {
      saveTopicRouteSnapshot(topicRouteSessionStoreRef.current, activeRouteKey, {
        ...routeSnapshot,
        topicDetail: topicDetailAfterActionUpdate(routeSnapshot.topicDetail, update),
        topicReplies: topicRepliesAfterActionUpdate(routeSnapshot.topicReplies, update)
      });
    }
    setTopicDetail((current) => topicDetailAfterActionUpdate(current, update));
    setTopicReplies((current) => topicRepliesAfterActionUpdate(current, update));
    if (actionUpdateClosesReplyComposer(update, { replyTarget, replyEditTarget })) {
      setReplyComposerOpen(false);
      setReplyContent('');
      setReplyTarget(null);
      setReplyEditTarget(null);
    }
  }, [replyEditTarget, replyTarget]);

  const reuseTopic = useCallback((topic: Topic, key: string) => {
    invalidateTopicActionRequests(key);
    currentTopicKeyRef.current = key;
    setSelectedTopic(topic);
    setTopicBusy(false);
  }, [invalidateTopicActionRequests]);

  const beginTopicLoad = useCallback((topic: Topic, key: string) => {
    invalidateTopicActionRequests(key);
    currentTopicKeyRef.current = key;
    setLoadingMoreReplies(false);
    setSelectedTopic(topic);
    setTopicDetail(null);
    setTopicError(null);
    setTopicReplies([]);
    setCommentQuery('');
    setUnreadReplyCount(0);
    setReplyHasMore(false);
    setReplyNextPage(null);
    setReplyNextOffset(null);
    setReplyContent('');
    setReplyFace('');
    setReplyComposerOpen(false);
    setReplyTarget(null);
    setReplyEditTarget(null);
    setReplyFilter('all');
    resetQuoteState();
    setTopicBusy(true);
  }, [invalidateTopicActionRequests, resetQuoteState, setLoadingMoreReplies]);

  const resolveTopicLoad = useCallback((detail: TopicDetail, unreadCount: number) => {
    setUnreadReplyCount(unreadCount);
    setTopicDetail(detail);
    setTopicReplies(detail.replies || []);
    setReplyHasMore(Boolean(detail.replyHasMore && detail.replyNextPage));
    setReplyNextPage(detail.replyNextPage ?? null);
    setReplyNextOffset(detail.replyNextOffset ?? null);
  }, []);

  const failTopicLoad = useCallback((error: SourceErrorInfo) => {
    setTopicError(error);
  }, []);

  const finishTopicLoad = useCallback(() => {
    setTopicBusy(false);
  }, []);

  const beginRepliesLoad = useCallback(() => {
    setLoadingMoreReplies(true);
  }, [setLoadingMoreReplies]);

  const resolveReplies = useCallback((result: ResolvedReplies) => {
    setTopicReplies(result.replies);
    if (typeof result.replyCount === 'number' && result.requestTopicKey) {
      setTopicDetail((current) => current && topicKey(current) === result.requestTopicKey && result.replyCount! > current.replyCount
        ? { ...current, replyCount: result.replyCount! }
        : current);
      setSelectedTopic((current) => current && topicKey(current) === result.requestTopicKey && result.replyCount! > current.replyCount
        ? { ...current, replyCount: result.replyCount! }
        : current);
    }
    if (typeof result.hasMore === 'boolean') {
      setReplyHasMore(result.hasMore);
      setReplyNextPage(result.hasMore ? result.nextPage ?? null : null);
      setReplyNextOffset(result.hasMore ? result.nextOffset ?? null : null);
    }
  }, []);

  const finishRepliesLoad = useCallback(() => {
    setLoadingMoreReplies(false);
  }, [setLoadingMoreReplies]);

  const changeQuoteExpanded = useCallback((key: string, expanded: boolean) => {
    updateExpandedQuotes((current) => ({ ...current, [key]: expanded }));
  }, [updateExpandedQuotes]);

  const changeQuoteLoading = useCallback((key: string, loading: boolean) => {
    updateLoadingQuotedFloors((current) => ({ ...current, [key]: loading }));
  }, [updateLoadingQuotedFloors]);

  const rememberQuotedReply = useCallback((referenceKey: string, reply: Reply) => {
    updateLoadedQuotedReplies((current) => ({ ...current, [referenceKey]: reply }));
  }, [updateLoadedQuotedReplies]);

  const stopTopicWork = useCallback((clearCurrentTopic = false) => {
    if (clearCurrentTopic) {
      currentTopicKeyRef.current = null;
    }
    setLoadingMoreReplies(false);
    setTopicBusy(false);
  }, [setLoadingMoreReplies]);

  const snapshot = useCallback((): TopicSnapshot => {
    const currentTopic = topicDetail || selectedTopic;
    const session = currentTopic ? createEmptyTopicSession(currentTopic) : createInactiveTopicSession();
    return snapshotFromTopicSession({
      ...session,
      selectedTopic,
      topicDetail,
      topicReplies,
      topicError: topicError?.message || '',
      replyHasMore,
      replyNextPage,
      replyNextOffset,
      unreadReplyCount,
      commentQuery,
      replyFilter,
      replyContent,
      replyFace,
      replyComposerOpen,
      replyTarget,
      replyEditTarget,
      expandedQuotes: expandedQuotesRef.current,
      loadedQuotedReplies: loadedQuotedRepliesRef.current,
      loadingQuotedFloors: {},
      scrollY: topicScrollYRef.current
    });
  }, [commentQuery, replyComposerOpen, replyContent, replyEditTarget, replyFace, replyFilter, replyHasMore, replyNextOffset, replyNextPage, replyTarget, selectedTopic, topicDetail, topicError, topicReplies, unreadReplyCount]);

  const restore = useCallback((topicSnapshot: TopicSnapshot) => {
    const session = topicSessionFromSnapshot(topicSnapshot);
    abortQuotedReplyRequests();
    setSelectedTopic(session.selectedTopic);
    setTopicDetail(session.topicDetail);
    setTopicReplies(session.topicReplies);
    setTopicError(null);
    setReplyHasMore(session.replyHasMore);
    setReplyNextPage(session.replyNextPage);
    setReplyNextOffset(session.replyNextOffset);
    setUnreadReplyCount(session.unreadReplyCount);
    setCommentQuery(session.commentQuery);
    setDebouncedCommentQuery(session.commentQuery);
    setReplyFilter(session.replyFilter);
    setReplyContent(session.replyContent);
    setReplyFace(session.replyFace);
    setReplyComposerOpen(session.replyComposerOpen);
    setReplyTarget(session.replyTarget);
    setReplyEditTarget(session.replyEditTarget);
    expandedQuotesRef.current = session.expandedQuotes;
    loadedQuotedRepliesRef.current = session.loadedQuotedReplies;
    loadingQuotedFloorsRef.current = {};
    topicScrollYRef.current = session.scrollY;
    setQuoteStateVersion((current) => current + 1);
    setTopicBusy(false);
    setLoadingMoreReplies(false);
    const restoredTopic = session.topicDetail || session.selectedTopic;
    const restoredTopicKey = restoredTopic ? topicKey(restoredTopic) : null;
    invalidateTopicActionRequests(restoredTopicKey);
    currentTopicKeyRef.current = restoredTopicKey;
  }, [abortQuotedReplyRequests, invalidateTopicActionRequests, setLoadingMoreReplies]);

  const getCurrentTopicKey = useCallback(() => currentTopicKeyRef.current, []);
  const isLoadingMoreReplies = useCallback(() => loadingMoreRepliesRef.current, []);
  const getTopicReplies = useCallback(() => topicRepliesRef.current, []);
  const clearTopicBackStack = useCallback(() => {
    topicBackStackRef.current = [];
  }, []);
  const pushTopicBackStack = useCallback((currentSnapshot: TopicSnapshot, nextTopic?: Topic) => {
    topicBackStackRef.current = pushTopicSnapshot(topicBackStackRef.current, currentSnapshot, nextTopic);
  }, []);
  const popTopicBackStack = useCallback(() => topicBackStackRef.current.pop(), []);
  const readTopicBackStack = useCallback(() => [...topicBackStackRef.current], []);
  const replaceTopicBackStack = useCallback((stack: TopicSnapshot[]) => {
    topicBackStackRef.current = [...stack];
  }, []);
  const isQuoteExpanded = useCallback((key: string) => Boolean(expandedQuotesRef.current[key]), []);
  const getLoadedQuotedReply = useCallback((referenceKey: string) => loadedQuotedRepliesRef.current[referenceKey], []);
  const replaceQuotedReplyRequest = useCallback((key: string, controller: AbortController) => {
    quotedReplyAbortRefs.current[key]?.abort();
    quotedReplyAbortRefs.current[key] = controller;
  }, []);
  const isQuotedReplyRequest = useCallback((key: string, controller: AbortController) => quotedReplyAbortRefs.current[key] === controller, []);
  const clearQuotedReplyRequest = useCallback((key: string, controller: AbortController) => {
    if (quotedReplyAbortRefs.current[key] === controller) {
      delete quotedReplyAbortRefs.current[key];
    }
  }, []);
  const setTopicScrollY = useCallback((value: number) => {
    topicScrollYRef.current = Math.max(0, value);
  }, []);

  const activateTopicRoute = useCallback((routeKey: string) => {
    activeTopicRouteKeyRef.current = routeKey;
  }, []);

  const saveTopicRoute = useCallback((routeKey = activeTopicRouteKeyRef.current) => {
    if (routeKey) {
      saveTopicRouteSnapshot(topicRouteSessionStoreRef.current, routeKey, snapshot());
    }
  }, [snapshot]);

  const restoreTopicRoute = useCallback((routeKey: string) => {
    const routeSnapshot = readTopicRouteSnapshot(topicRouteSessionStoreRef.current, routeKey);
    if (!routeSnapshot) {
      return false;
    }
    activeTopicRouteKeyRef.current = routeKey;
    restore(routeSnapshot);
    return true;
  }, [restore]);

  const forgetTopicRoute = useCallback((routeKey: string) => {
    removeTopicRouteSnapshot(topicRouteSessionStoreRef.current, routeKey);
    if (activeTopicRouteKeyRef.current === routeKey) {
      activeTopicRouteKeyRef.current = null;
    }
  }, []);

  const clearTopicRoutes = useCallback(() => {
    topicRouteSessionStoreRef.current.clear();
    activeTopicRouteKeyRef.current = null;
  }, []);

  return {
    state: {
      commentQuery,
      debouncedCommentQuery,
      expandedQuotes: expandedQuotesRef.current,
      loadedQuotedReplies: loadedQuotedRepliesRef.current,
      loadingMoreReplies,
      loadingQuotedFloors: loadingQuotedFloorsRef.current,
      quoteStateVersion,
      replyComposerOpen,
      replyContent,
      replyEditTarget,
      replyFace,
      replyFilter,
      replyHasMore,
      replyNextOffset,
      replyNextPage,
      replyTarget,
      selectedTopic,
      topicBusy,
      topicDetail,
      topicError,
      topicReplies,
      unreadReplyCount
    },
    commands: {
      actions: {
        applyUpdate: applyTopicActionUpdate
      },
      composer: {
        appendMarkup: appendReplyMarkup,
        changeContent: setReplyContent,
        changeFace: setReplyFace,
        completeSubmission: completeReplySubmission,
        editReply,
        replyToFloor,
        toggle: toggleReplyComposer
      },
      navigation: {
        activateRoute: activateTopicRoute,
        clearBackStack: clearTopicBackStack,
        clearRoutes: clearTopicRoutes,
        forgetRoute: forgetTopicRoute,
        popBackStack: popTopicBackStack,
        pushBackStack: pushTopicBackStack,
        readBackStack: readTopicBackStack,
        replaceBackStack: replaceTopicBackStack,
        restoreRoute: restoreTopicRoute,
        saveRoute: saveTopicRoute
      },
      quotes: {
        abortRequests: abortQuotedReplyRequests,
        changeExpanded: changeQuoteExpanded,
        changeLoading: changeQuoteLoading,
        clearRequest: clearQuotedReplyRequest,
        getLoaded: getLoadedQuotedReply,
        isExpanded: isQuoteExpanded,
        isRequest: isQuotedReplyRequest,
        remember: rememberQuotedReply,
        replaceRequest: replaceQuotedReplyRequest
      },
      replies: {
        beginLoad: beginRepliesLoad,
        finishLoad: finishRepliesLoad,
        getCurrent: getTopicReplies,
        isLoading: isLoadingMoreReplies,
        resolve: resolveReplies
      },
      topic: {
        beginLoad: beginTopicLoad,
        failLoad: failTopicLoad,
        finishLoad: finishTopicLoad,
        getCurrentKey: getCurrentTopicKey,
        resolveLoad: resolveTopicLoad,
        reuse: reuseTopic,
        stopWork: stopTopicWork
      },
      view: {
        changeCommentQuery: setCommentQuery,
        changeReplyFilter: setReplyFilter,
        rememberScrollY: setTopicScrollY
      }
    },
    restore,
    snapshot
  };
}

export type TopicSessionController = ReturnType<typeof useTopicSessionController>;
