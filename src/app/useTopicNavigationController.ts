import { useCallback, type MutableRefObject } from 'react';
import type { Reply, Topic, TopicDetail } from '../types';
import { createEmptyTopicSession, snapshotFromTopicSession, topicSessionFromSnapshot } from '../topicSessionState';
import { topicKey } from '../readerData';
import type { ReplyFilter, ReplyTarget, TopicSnapshot } from '../appTypes';

export function useTopicNavigationController({
  commentQuery,
  currentTopicKeyRef,
  expandedQuotesRef,
  invalidateTopicActionRequests,
  loadedQuotedRepliesRef,
  loadingMoreRepliesRef,
  loadingQuotedFloorsRef,
  replyComposerOpen,
  replyContent,
  replyFilter,
  replyHasMore,
  replyNextOffset,
  replyNextPage,
  replyTarget,
  selectedTopic,
  setCommentQuery,
  setExpandedQuotes,
  setLoadedQuotedReplies,
  setLoadingMoreReplies,
  setLoadingQuotedFloors,
  setQuoteStateVersion,
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
  topicDetail,
  topicError,
  topicReplies,
  topicScrollYRef,
  unreadReplyCount
}: {
  commentQuery: string;
  currentTopicKeyRef: MutableRefObject<string | null>;
  expandedQuotesRef: MutableRefObject<Record<string, boolean>>;
  invalidateTopicActionRequests: (nextTopicKey: string | null) => void;
  loadedQuotedRepliesRef: MutableRefObject<Record<number, Reply>>;
  loadingMoreRepliesRef: MutableRefObject<boolean>;
  loadingQuotedFloorsRef: MutableRefObject<Record<string, boolean>>;
  replyComposerOpen: boolean;
  replyContent: string;
  replyFilter: ReplyFilter;
  replyHasMore: boolean;
  replyNextOffset: number | null;
  replyNextPage: number | null;
  replyTarget: ReplyTarget | null;
  selectedTopic: Topic | null;
  setCommentQuery: (value: string) => void;
  setExpandedQuotes: (value: Record<string, boolean>) => void;
  setLoadedQuotedReplies: (value: Record<number, Reply>) => void;
  setLoadingMoreReplies: (value: boolean) => void;
  setLoadingQuotedFloors: (value: Record<string, boolean>) => void;
  setQuoteStateVersion: (updater: (current: number) => number) => void;
  setReplyComposerOpen: (value: boolean) => void;
  setReplyContent: (value: string) => void;
  setReplyFilter: (value: ReplyFilter) => void;
  setReplyHasMore: (value: boolean) => void;
  setReplyNextOffset: (value: number | null) => void;
  setReplyNextPage: (value: number | null) => void;
  setReplyTarget: (value: ReplyTarget | null) => void;
  setSelectedTopic: (value: Topic | null) => void;
  setTopicBusy: (value: boolean) => void;
  setTopicDetail: (value: TopicDetail | null) => void;
  setTopicError: (value: string) => void;
  setTopicReplies: (value: Reply[]) => void;
  setUnreadReplyCount: (value: number) => void;
  topicDetail: TopicDetail | null;
  topicError: string;
  topicReplies: Reply[];
  topicScrollYRef: MutableRefObject<number>;
  unreadReplyCount: number;
}) {
  const topicSnapshot = useCallback((): TopicSnapshot => {
    const currentTopic = topicDetail || selectedTopic;
    const session = currentTopic ? {
      ...createEmptyTopicSession(currentTopic),
      selectedTopic,
      topicDetail,
      topicReplies,
      topicError,
      replyHasMore,
      replyNextPage,
      replyNextOffset,
      unreadReplyCount,
      commentQuery,
      replyFilter,
      replyContent,
      replyComposerOpen,
      replyTarget,
      expandedQuotes: expandedQuotesRef.current,
      loadedQuotedReplies: loadedQuotedRepliesRef.current,
      loadingQuotedFloors: {},
      scrollY: topicScrollYRef.current
    } : createEmptyTopicSession({
      source: 'nodeseek',
      id: '',
      title: '',
      author: '',
      url: '',
      createdAt: '',
      replyCount: 0
    });
    return snapshotFromTopicSession(session);
  }, [commentQuery, expandedQuotesRef, loadedQuotedRepliesRef, replyComposerOpen, replyContent, replyFilter, replyHasMore, replyNextOffset, replyNextPage, replyTarget, selectedTopic, topicDetail, topicError, topicReplies, topicScrollYRef, unreadReplyCount]);

  const restoreTopicSnapshot = useCallback((snapshot: TopicSnapshot) => {
    const session = topicSessionFromSnapshot(snapshot);
    setSelectedTopic(session.selectedTopic);
    setTopicDetail(session.topicDetail);
    setTopicReplies(session.topicReplies);
    setTopicError(session.topicError);
    setReplyHasMore(session.replyHasMore);
    setReplyNextPage(session.replyNextPage);
    setReplyNextOffset(session.replyNextOffset);
    setUnreadReplyCount(session.unreadReplyCount);
    setCommentQuery(session.commentQuery);
    setReplyFilter(session.replyFilter);
    setReplyContent(session.replyContent);
    setReplyComposerOpen(session.replyComposerOpen);
    setReplyTarget(session.replyTarget);
    expandedQuotesRef.current = session.expandedQuotes;
    loadedQuotedRepliesRef.current = session.loadedQuotedReplies;
    loadingQuotedFloorsRef.current = {};
    topicScrollYRef.current = session.scrollY;
    setExpandedQuotes(session.expandedQuotes);
    setLoadedQuotedReplies(session.loadedQuotedReplies);
    setLoadingQuotedFloors({});
    setQuoteStateVersion((current) => current + 1);
    setTopicBusy(false);
    setLoadingMoreReplies(false);
    loadingMoreRepliesRef.current = false;
    const restoredTopic = session.topicDetail || session.selectedTopic;
    invalidateTopicActionRequests(restoredTopic ? topicKey(restoredTopic) : null);
    currentTopicKeyRef.current = restoredTopic ? topicKey(restoredTopic) : null;
  }, [currentTopicKeyRef, expandedQuotesRef, invalidateTopicActionRequests, loadedQuotedRepliesRef, loadingMoreRepliesRef, loadingQuotedFloorsRef, setCommentQuery, setExpandedQuotes, setLoadedQuotedReplies, setLoadingMoreReplies, setLoadingQuotedFloors, setQuoteStateVersion, setReplyComposerOpen, setReplyContent, setReplyFilter, setReplyHasMore, setReplyNextOffset, setReplyNextPage, setReplyTarget, setSelectedTopic, setTopicBusy, setTopicDetail, setTopicError, setTopicReplies, setUnreadReplyCount, topicScrollYRef]);

  return {
    restoreTopicSnapshot,
    topicSnapshot
  };
}
