import { useCallback, useEffect, useRef, useState } from 'react';
import { createReplyTextIndexForQuery, filterRepliesByQuery } from '../androidFeatureHelpers';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget, TopicSnapshot } from '../appTypes';
import { appendReplyImageMarkup } from '../replyImageUpload';
import { filterRepliesWithImages, type InlineSizedImageUrlMap, type TopicImageDeriver } from '../topicDerivedData';
import {
  createEmptyTopicSession,
  createInactiveTopicSession,
  createTopicRouteSessionStore,
  pushTopicSnapshot,
  readTopicRouteSnapshot,
  removeTopicRouteSnapshot,
  saveTopicRouteSnapshot,
  snapshotFromTopicSession,
  topicSessionFromSnapshot
} from '../topicSessionState';
import type { Reply, Topic, TopicDetail } from '../types';

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
    replies = topicDetail ? replies.filter((reply) => reply.author === topicDetail.author) : replies;
  } else if (replyFilter === 'images') {
    replies = filterRepliesWithImages(replies, inlineSizedImageUrls, topicImageDeriver);
  } else if (replyFilter === 'newest') {
    replies = [...replies].reverse();
  }
  return filterRepliesByQuery(replies, commentQuery, createReplyTextIndexForQuery(topicReplies, commentQuery));
}

export function useTopicSessionController({ notify }: { notify: (message: string) => void }) {
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
  const [replyFace, setReplyFace] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [debouncedCommentQuery, setDebouncedCommentQuery] = useState('');
  const [replyComposerOpen, setReplyComposerOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [replyEditTarget, setReplyEditTarget] = useState<ReplyEditTarget | null>(null);
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);
  const currentTopicKeyRef = useRef('');
  const activeTopicRouteKeyRef = useRef<string | null>(null);
  const topicRouteSessionStoreRef = useRef(createTopicRouteSessionStore());
  const topicBackStackRef = useRef<TopicSnapshot[]>([]);
  const topicScrollYRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCommentQuery(commentQuery), 180);
    return () => clearTimeout(timer);
  }, [commentQuery]);

  const selectTopic = useCallback((topic: Topic) => {
    const key = `${topic.source}:${topic.id}`;
    if (currentTopicKeyRef.current === key) {
      setSelectedTopic(() => topic);
      return;
    }
    const session = createEmptyTopicSession(topic);
    currentTopicKeyRef.current = session.key;
    setSelectedTopic(() => topic);
    setReplyFilter(session.replyFilter);
    setReplyContent(session.replyContent);
    setReplyFace(session.replyFace);
    setCommentQuery(session.commentQuery);
    setDebouncedCommentQuery(session.commentQuery);
    setReplyComposerOpen(session.replyComposerOpen);
    setReplyTarget(session.replyTarget);
    setReplyEditTarget(session.replyEditTarget);
    setExpandedQuotes(session.expandedQuotes);
    topicScrollYRef.current = 0;
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const toggleReplyComposer = useCallback(
    (open: boolean) => {
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
    },
    [replyEditTarget]
  );

  const replyToFloor = useCallback(
    (reply: Reply) => {
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
    },
    [notify]
  );

  const editReply = useCallback((target: ReplyEditTarget) => {
    setReplyTarget(null);
    setReplyFace('');
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This is an event callback, not a React state updater.
    setReplyEditTarget(target);
    setReplyContent(target.contentMarkdown);
    setReplyComposerOpen(true);
  }, []);

  const detachReplyEdit = useCallback(() => {
    setReplyComposerOpen(false);
    setReplyFace('');
    setReplyTarget(null);
    setReplyEditTarget(null);
  }, []);

  const completeReplySubmission = useCallback(() => {
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

  const changeQuoteExpanded = useCallback((key: string, expanded: boolean) => {
    setExpandedQuotes((current) => ({ ...current, [key]: expanded }));
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const snapshot = useCallback(
    (): TopicSnapshot =>
      snapshotFromTopicSession({
        ...(selectedTopic ? createEmptyTopicSession(selectedTopic) : createInactiveTopicSession()),
        key: currentTopicKeyRef.current,
        selectedTopic,
        commentQuery,
        replyFilter,
        replyContent,
        replyFace,
        replyComposerOpen,
        replyTarget,
        replyEditTarget,
        expandedQuotes,
        scrollY: topicScrollYRef.current
      }),
    [
      commentQuery,
      expandedQuotes,
      replyComposerOpen,
      replyContent,
      replyEditTarget,
      replyFace,
      replyFilter,
      replyTarget,
      selectedTopic
    ]
  );

  const restore = useCallback((topicSnapshot: TopicSnapshot) => {
    const session = topicSessionFromSnapshot(topicSnapshot);
    currentTopicKeyRef.current = session.key;
    setSelectedTopic(session.selectedTopic);
    setCommentQuery(session.commentQuery);
    setDebouncedCommentQuery(session.commentQuery);
    setReplyFilter(session.replyFilter);
    setReplyContent(session.replyContent);
    setReplyFace(session.replyFace);
    setReplyComposerOpen(session.replyComposerOpen);
    setReplyTarget(session.replyTarget);
    setReplyEditTarget(session.replyEditTarget);
    setExpandedQuotes(session.expandedQuotes);
    topicScrollYRef.current = session.scrollY;
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const saveRoute = useCallback(
    (routeKey: string) => {
      if (routeKey) saveTopicRouteSnapshot(topicRouteSessionStoreRef.current, routeKey, snapshot());
    },
    [snapshot]
  );
  const restoreRoute = useCallback(
    (routeKey: string) => {
      if (activeTopicRouteKeyRef.current === routeKey) return true;
      const saved = readTopicRouteSnapshot(topicRouteSessionStoreRef.current, routeKey);
      if (!saved) return false;
      activeTopicRouteKeyRef.current = routeKey;
      restore(saved);
      return true;
    },
    [restore]
  );
  const activateRoute = useCallback((routeKey: string) => {
    activeTopicRouteKeyRef.current = routeKey;
  }, []);
  const forgetRoute = useCallback((routeKey: string) => {
    removeTopicRouteSnapshot(topicRouteSessionStoreRef.current, routeKey);
    if (activeTopicRouteKeyRef.current === routeKey) activeTopicRouteKeyRef.current = null;
  }, []);
  const clearRoutes = useCallback(() => {
    topicRouteSessionStoreRef.current.clear();
    activeTopicRouteKeyRef.current = null;
  }, []);
  const clearBackStack = useCallback(() => {
    topicBackStackRef.current = [];
  }, []);
  const pushBackStack = useCallback((current: TopicSnapshot, nextTopic?: Topic) => {
    topicBackStackRef.current = pushTopicSnapshot(topicBackStackRef.current, current, nextTopic);
  }, []);
  const popBackStack = useCallback(() => topicBackStackRef.current.pop(), []);
  const readBackStack = useCallback(() => [...topicBackStackRef.current], []);
  const replaceBackStack = useCallback((stack: TopicSnapshot[]) => {
    topicBackStackRef.current = [...stack];
  }, []);
  const rememberScrollY = useCallback((value: number) => {
    topicScrollYRef.current = Math.max(0, value);
  }, []);

  return {
    state: {
      commentQuery,
      debouncedCommentQuery,
      expandedQuotes,
      quoteStateVersion,
      replyComposerOpen,
      replyContent,
      replyEditTarget,
      replyFace,
      replyFilter,
      replyTarget,
      selectedTopic
    },
    commands: {
      composer: {
        appendMarkup: appendReplyMarkup,
        changeContent: setReplyContent,
        changeFace: setReplyFace,
        completeSubmission: completeReplySubmission,
        detachEdit: detachReplyEdit,
        editReply,
        replyToFloor,
        toggle: toggleReplyComposer
      },
      navigation: {
        activateRoute,
        clearBackStack,
        clearRoutes,
        forgetRoute,
        popBackStack,
        pushBackStack,
        readBackStack,
        replaceBackStack,
        restoreRoute,
        saveRoute
      },
      quotes: {
        changeExpanded: changeQuoteExpanded,
        isExpanded: (key: string) => Boolean(expandedQuotes[key])
      },
      topic: {
        getCurrentKey: () => currentTopicKeyRef.current,
        select: selectTopic,
        stopWork: () => undefined
      },
      view: {
        changeCommentQuery: setCommentQuery,
        changeReplyFilter: setReplyFilter,
        rememberScrollY
      }
    },
    restore,
    snapshot
  };
}

export type TopicSessionController = ReturnType<typeof useTopicSessionController>;
