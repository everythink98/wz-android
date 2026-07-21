import { topicKey } from './readerData';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget, TopicSnapshot } from './appTypes';
import type { Topic } from './types';

export type TopicSession = {
  key: string;
  selectedTopic: Topic | null;
  commentQuery: string;
  replyFilter: ReplyFilter;
  replyContent: string;
  replyFace: string;
  replyComposerOpen: boolean;
  replyTarget: ReplyTarget | null;
  replyEditTarget: ReplyEditTarget | null;
  expandedQuotes: Record<string, boolean>;
  scrollY: number;
};

export type TopicRouteSessionStore = Map<string, TopicSnapshot>;

export function createTopicRouteSessionStore(): TopicRouteSessionStore {
  return new Map();
}

export function saveTopicRouteSnapshot(store: TopicRouteSessionStore, routeKey: string, snapshot: TopicSnapshot) {
  if (routeKey) store.set(routeKey, snapshot);
}

export function readTopicRouteSnapshot(store: TopicRouteSessionStore, routeKey: string) {
  return store.get(routeKey);
}

export function removeTopicRouteSnapshot(store: TopicRouteSessionStore, routeKey: string) {
  store.delete(routeKey);
}

export function createInactiveTopicSession(): TopicSession {
  return {
    key: '',
    selectedTopic: null,
    commentQuery: '',
    replyFilter: 'all',
    replyContent: '',
    replyFace: '',
    replyComposerOpen: false,
    replyTarget: null,
    replyEditTarget: null,
    expandedQuotes: {},
    scrollY: 0
  };
}

export function createEmptyTopicSession(topic: Topic): TopicSession {
  return { ...createInactiveTopicSession(), key: topicKey(topic), selectedTopic: topic };
}

export function pushTopicSession(stack: TopicSession[], current: TopicSession, nextTopic?: Topic) {
  return nextTopic && current.key === topicKey(nextTopic) ? stack : [...stack, current];
}

export function pushTopicSnapshot(stack: TopicSnapshot[], current: TopicSnapshot, nextTopic?: Topic) {
  return pushTopicSession(
    stack.map(topicSessionFromSnapshot),
    topicSessionFromSnapshot(current),
    nextTopic
  ).map(snapshotFromTopicSession);
}

export function snapshotFromTopicSession(session: TopicSession): TopicSnapshot {
  return {
    key: session.key,
    selectedTopic: session.selectedTopic,
    commentQuery: session.commentQuery,
    replyFilter: session.replyFilter,
    replyContent: session.replyContent,
    replyFace: session.replyFace,
    replyComposerOpen: session.replyComposerOpen,
    replyTarget: session.replyTarget,
    replyEditTarget: session.replyEditTarget,
    expandedQuotes: session.expandedQuotes,
    scrollY: session.scrollY
  };
}

export function topicSessionFromSnapshot(snapshot: TopicSnapshot): TopicSession {
  return {
    key: snapshot.key || (snapshot.selectedTopic ? topicKey(snapshot.selectedTopic) : ''),
    selectedTopic: snapshot.selectedTopic,
    commentQuery: snapshot.commentQuery,
    replyFilter: snapshot.replyFilter,
    replyContent: snapshot.replyContent,
    replyFace: snapshot.replyFace || '',
    replyComposerOpen: snapshot.replyComposerOpen,
    replyTarget: snapshot.replyTarget,
    replyEditTarget: snapshot.replyEditTarget || null,
    expandedQuotes: snapshot.expandedQuotes,
    scrollY: snapshot.scrollY || 0
  };
}
