import { describe, expect, it } from 'vitest';
import {
  createEmptyTopicSession,
  createInactiveTopicSession,
  createTopicRouteSessionStore,
  pushTopicSession,
  readTopicRouteSnapshot,
  removeTopicRouteSnapshot,
  saveTopicRouteSnapshot,
  snapshotFromTopicSession,
  topicSessionFromSnapshot,
  type TopicSession
} from './topicSessionState';
import type { Topic } from './types';

function topic(id: string): Topic {
  return {
    source: 'nodeseek',
    id,
    title: `Topic ${id}`,
    author: 'alice',
    url: `https://www.nodeseek.com/post-${id}-1`,
    createdAt: '2026-06-06T00:00:00.000Z',
    replyCount: 0
  };
}

describe('topic local session state', () => {
  it('starts without a fabricated topic', () => {
    expect(createInactiveTopicSession()).toMatchObject({ key: '', selectedTopic: null, replyContent: '' });
  });

  it('does not push the current topic when a link points to itself', () => {
    expect(pushTopicSession([], createEmptyTopicSession(topic('1')), topic('1'))).toEqual([]);
  });

  it('[REG-WRITE-026] restores an edit snapshot as a closed text draft', () => {
    const session: TopicSession = {
      ...createEmptyTopicSession(topic('3')),
      commentQuery: 'needle',
      replyFilter: 'author',
      replyContent: '待回复',
      replyFace: '淡定.gif',
      replyComposerOpen: true,
      replyTarget: { floor: 2, author: 'bob' },
      replyEditTarget: {
        commentId: 9,
        floor: 3,
        contentMarkdown: '旧回复',
        topicId: '1',
        ticket: { source: 'nodeseek', identityKey: 'nodeseek:alice', sessionEpoch: 1 }
      },
      expandedQuotes: { 'reply:4:nodeseek:3:2': true },
      scrollY: 120
    };

    const restoredDraft = {
      ...session,
      replyComposerOpen: false,
      replyEditTarget: null,
      replyFace: '',
      replyTarget: null
    };
    const snapshot = snapshotFromTopicSession(session);
    expect(snapshot).toMatchObject({
      replyComposerOpen: false,
      replyContent: '待回复',
      replyEditTarget: null,
      replyFace: '',
      replyTarget: null
    });
    expect(topicSessionFromSnapshot(snapshot)).toEqual(restoredDraft);
    expect(topicSessionFromSnapshot({
      ...snapshot,
      replyComposerOpen: true,
      replyEditTarget: session.replyEditTarget,
      replyFace: session.replyFace,
      replyTarget: session.replyTarget
    })).toEqual(restoredDraft);
    expect(snapshot).not.toHaveProperty('topicDetail');
    expect(snapshot).not.toHaveProperty('topicReplies');
  });

  it('stores separate local snapshots per navigation route', () => {
    const store = createTopicRouteSessionStore();
    const base = snapshotFromTopicSession(createEmptyTopicSession(topic('5')));
    saveTopicRouteSnapshot(store, 'Topic-route-a', { ...base, replyContent: '草稿 A' });
    saveTopicRouteSnapshot(store, 'Topic-route-b', { ...base, replyContent: '草稿 B' });

    expect(readTopicRouteSnapshot(store, 'Topic-route-a')?.replyContent).toBe('草稿 A');
    expect(readTopicRouteSnapshot(store, 'Topic-route-b')?.replyContent).toBe('草稿 B');
    removeTopicRouteSnapshot(store, 'Topic-route-b');
    expect(readTopicRouteSnapshot(store, 'Topic-route-b')).toBeUndefined();
  });
});
