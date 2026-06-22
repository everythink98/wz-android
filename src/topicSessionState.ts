import { topicKey } from './readerData';
import type { Reply, Topic, TopicDetail } from './types';
import type { ReplyFilter, ReplyTarget, TopicSnapshot } from './appTypes';

export type TopicSession = {
  key: string;
  selectedTopic: Topic | null;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicError: string;
  replyHasMore: boolean;
  replyNextPage: number | null;
  replyNextOffset: number | null;
  unreadReplyCount: number;
  commentQuery: string;
  replyFilter: ReplyFilter;
  replyContent: string;
  replyComposerOpen: boolean;
  replyTarget: ReplyTarget | null;
  expandedQuotes: Record<string, boolean>;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  scrollY: number;
};

export function shouldReuseCurrentTopicDetail({
  currentDetail,
  nextTopic,
  nocache,
  reopenExistingTopicScreen
}: {
  currentDetail: TopicDetail | null;
  nextTopic: Topic;
  nocache: boolean;
  reopenExistingTopicScreen: boolean;
}) {
  return Boolean(
    currentDetail
      && !nocache
      && !reopenExistingTopicScreen
      && topicKey(currentDetail) === topicKey(nextTopic)
  );
}

export function createEmptyTopicSession(topic: Topic): TopicSession {
  return {
    key: topicKey(topic),
    selectedTopic: topic,
    topicDetail: null,
    topicReplies: [],
    topicError: '',
    replyHasMore: false,
    replyNextPage: null,
    replyNextOffset: null,
    unreadReplyCount: 0,
    commentQuery: '',
    replyFilter: 'all',
    replyContent: '',
    replyComposerOpen: false,
    replyTarget: null,
    expandedQuotes: {},
    loadedQuotedReplies: {},
    loadingQuotedFloors: {},
    scrollY: 0
  };
}

export function pushTopicSession(stack: TopicSession[], current: TopicSession, nextTopic?: Topic) {
  if (nextTopic && current.key === topicKey(nextTopic)) {
    return stack;
  }
  return [...stack, current];
}

export function snapshotFromTopicSession(session: TopicSession): TopicSnapshot {
  return {
    key: session.key,
    selectedTopic: session.selectedTopic,
    topicDetail: session.topicDetail,
    topicReplies: session.topicReplies,
    topicError: '',
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
    loadingQuotedFloors: {},
    scrollY: session.scrollY
  };
}

export function topicSessionFromSnapshot(snapshot: TopicSnapshot): TopicSession {
  const currentTopic = snapshot.topicDetail || snapshot.selectedTopic;
  return {
    key: snapshot.key || (currentTopic ? topicKey(currentTopic) : ''),
    selectedTopic: snapshot.selectedTopic,
    topicDetail: snapshot.topicDetail,
    topicReplies: snapshot.topicReplies,
    topicError: '',
    replyHasMore: snapshot.replyHasMore,
    replyNextPage: snapshot.replyNextPage,
    replyNextOffset: snapshot.replyNextOffset,
    unreadReplyCount: snapshot.unreadReplyCount,
    commentQuery: snapshot.commentQuery,
    replyFilter: snapshot.replyFilter,
    replyContent: snapshot.replyContent,
    replyComposerOpen: snapshot.replyComposerOpen,
    replyTarget: snapshot.replyTarget,
    expandedQuotes: snapshot.expandedQuotes,
    loadedQuotedReplies: snapshot.loadedQuotedReplies,
    loadingQuotedFloors: {},
    scrollY: snapshot.scrollY || 0
  };
}
