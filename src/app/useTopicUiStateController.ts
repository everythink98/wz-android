import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createReplyTextIndexForQuery, filterRepliesByQuery } from '../androidFeatureHelpers';
import type { ReplyFilter, ReplyTarget } from '../appTypes';
import { filterRepliesWithImages, type InlineSizedImageUrlMap, type TopicImageDeriver } from '../topicDerivedData';
import type { Reply, TopicDetail } from '../types';

export function useTopicUiStateController({
  inlineSizedImageUrls,
  notify,
  topicDetail,
  topicImageDeriver,
  topicReplies
}: {
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  notify: (message: string) => void;
  topicDetail: TopicDetail | null;
  topicImageDeriver: TopicImageDeriver;
  topicReplies: Reply[];
}) {
  const topicRepliesRef = useRef<Reply[]>(topicReplies);
  const quotedReplyAbortRefs = useRef<Record<string, AbortController>>({});
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [debouncedCommentQuery, setDebouncedCommentQuery] = useState('');
  const [replyComposerOpen, setReplyComposerOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [loadedQuotedReplies, setLoadedQuotedReplies] = useState<Record<number, Reply>>({});
  const [loadingQuotedFloors, setLoadingQuotedFloors] = useState<Record<string, boolean>>({});
  const expandedQuotesRef = useRef(expandedQuotes);
  const loadedQuotedRepliesRef = useRef(loadedQuotedReplies);
  const loadingQuotedFloorsRef = useRef(loadingQuotedFloors);
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);

  topicRepliesRef.current = topicReplies;
  const replyTextIndex = useMemo(
    () => createReplyTextIndexForQuery(topicReplies, debouncedCommentQuery),
    [debouncedCommentQuery, topicReplies]
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCommentQuery(commentQuery), 180);
    return () => clearTimeout(timer);
  }, [commentQuery]);

  const updateExpandedQuotes = useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    const next = updater(expandedQuotesRef.current);
    expandedQuotesRef.current = next;
    setExpandedQuotes(next);
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const updateLoadedQuotedReplies = useCallback((updater: (current: Record<number, Reply>) => Record<number, Reply>) => {
    const next = updater(loadedQuotedRepliesRef.current);
    loadedQuotedRepliesRef.current = next;
    setLoadedQuotedReplies(next);
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const updateLoadingQuotedFloors = useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    const next = updater(loadingQuotedFloorsRef.current);
    loadingQuotedFloorsRef.current = next;
    setLoadingQuotedFloors(next);
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
    setExpandedQuotes({});
    setLoadedQuotedReplies({});
    setLoadingQuotedFloors({});
    setQuoteStateVersion((current) => current + 1);
  }, [abortQuotedReplyRequests]);

  const filteredReplies = useMemo(() => {
    let base = topicReplies;
    if (replyFilter === 'author') {
      base = topicDetail ? topicReplies.filter((reply) => reply.author === topicDetail.author) : topicReplies;
    } else if (replyFilter === 'images') {
      base = filterRepliesWithImages(topicReplies, inlineSizedImageUrls, topicImageDeriver);
    } else if (replyFilter === 'newest') {
      base = [...topicReplies].reverse();
    }
    return filterRepliesByQuery(base, debouncedCommentQuery, replyTextIndex);
  }, [debouncedCommentQuery, inlineSizedImageUrls, replyFilter, replyTextIndex, topicDetail, topicImageDeriver, topicReplies]);

  const toggleReplyComposer = useCallback((open: boolean) => {
    setReplyComposerOpen(open);
    if (!open) {
      setReplyTarget(null);
    }
  }, []);

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
    setReplyComposerOpen(true);
  }, [notify]);

  return {
    abortQuotedReplyRequests,
    commentQuery,
    debouncedCommentQuery,
    expandedQuotes,
    expandedQuotesRef,
    filteredReplies,
    loadedQuotedReplies,
    loadedQuotedRepliesRef,
    loadingQuotedFloors,
    loadingQuotedFloorsRef,
    quoteStateVersion,
    quotedReplyAbortRefs,
    replyComposerOpen,
    replyContent,
    replyFilter,
    replyTarget,
    replyToFloor,
    resetQuoteState,
    setCommentQuery,
    setExpandedQuotes,
    setLoadedQuotedReplies,
    setLoadingQuotedFloors,
    setQuoteStateVersion,
    setReplyComposerOpen,
    setReplyContent,
    setReplyFilter,
    setReplyTarget,
    toggleReplyComposer,
    topicRepliesRef,
    updateExpandedQuotes,
    updateLoadedQuotedReplies,
    updateLoadingQuotedFloors
  };
}
