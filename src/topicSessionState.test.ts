import { describe, expect, it } from 'vitest';
import {
  createEmptyTopicSession,
  createInactiveTopicSession,
  createTopicRouteSessionStore,
  pushTopicSession,
  readTopicRouteSnapshot,
  removeTopicRouteSnapshot,
  saveTopicRouteSnapshot,
  shouldReuseCurrentTopicDetail,
  snapshotFromTopicSession,
  topicSessionFromSnapshot,
  type TopicSession
} from './topicSessionState';
import type { Topic, TopicDetail } from './types';

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

function detail(id: string): TopicDetail {
  return {
    ...topic(id),
    contentHtml: '<p>Loaded</p>',
    replies: []
  };
}

describe('topic session state', () => {
  it('starts without a fabricated topic before the first topic route opens', () => {
    expect(createInactiveTopicSession()).toEqual({
      ...createEmptyTopicSession(topic('unused')),
      key: '',
      selectedTopic: null
    });
  });

  it('does not push the current topic when the app link points to itself', () => {
    const current = createEmptyTopicSession(topic('1'));
    const stack = pushTopicSession([], current, topic('1'));

    expect(stack).toEqual([]);
  });

  it('reuses the loaded detail only when reopening the same topic without refresh', () => {
    expect(shouldReuseCurrentTopicDetail({
      currentDetail: detail('1'),
      nextTopic: topic('1'),
      nocache: false,
      reopenExistingTopicScreen: false
    })).toBe(true);
    expect(shouldReuseCurrentTopicDetail({
      currentDetail: detail('1'),
      nextTopic: topic('2'),
      nocache: false,
      reopenExistingTopicScreen: false
    })).toBe(false);
    expect(shouldReuseCurrentTopicDetail({
      currentDetail: detail('1'),
      nextTopic: topic('1'),
      nocache: true,
      reopenExistingTopicScreen: false
    })).toBe(false);
    expect(shouldReuseCurrentTopicDetail({
      currentDetail: null,
      nextTopic: topic('1'),
      nocache: false,
      reopenExistingTopicScreen: false
    })).toBe(false);
  });

  it('converts between legacy snapshots and explicit detail sessions', () => {
    const session: TopicSession = {
      ...createEmptyTopicSession(topic('3')),
      replyContent: '待回复',
      replyFace: '淡定.gif',
      replyComposerOpen: true,
      replyTarget: { floor: 2, author: 'bob' },
      replyEditTarget: { commentId: 9, floor: 3, contentMarkdown: '旧回复' },
      expandedQuotes: { '4:2': true },
      loadedQuotedReplies: {
        2: { floor: 2, author: 'bob', createdAt: '2026-06-06T01:00:00.000Z', contentHtml: '<p>quote</p>' }
      },
      scrollY: 120
    };
    const restored = topicSessionFromSnapshot(snapshotFromTopicSession(session));

    expect(restored).toMatchObject({
      key: 'nodeseek:3',
      replyContent: '待回复',
      replyFace: '淡定.gif',
      replyComposerOpen: true,
      replyTarget: { floor: 2, author: 'bob' },
      replyEditTarget: { commentId: 9, floor: 3, contentMarkdown: '旧回复' },
      expandedQuotes: { '4:2': true },
      loadedQuotedReplies: {
        2: { floor: 2, author: 'bob', createdAt: '2026-06-06T01:00:00.000Z', contentHtml: '<p>quote</p>' }
      },
      scrollY: 120
    });
  });

  it('does not restore transient errors or quote loading flags from snapshots', () => {
    const session: TopicSession = {
      ...createEmptyTopicSession(topic('4')),
      topicError: '加载失败',
      loadingQuotedFloors: { '2': true }
    };

    const snapshot = snapshotFromTopicSession(session);
    const restored = topicSessionFromSnapshot({
      ...snapshot,
      topicError: '旧错误',
      loadingQuotedFloors: { '3': true }
    });

    expect(snapshot.topicError).toBe('');
    expect(snapshot.loadingQuotedFloors).toEqual({});
    expect(restored.topicError).toBe('');
    expect(restored.loadingQuotedFloors).toEqual({});
  });

  it('stores separate snapshots by navigation route key even for the same topic', () => {
    const store = createTopicRouteSessionStore();
    const base = snapshotFromTopicSession(createEmptyTopicSession(topic('5')));

    saveTopicRouteSnapshot(store, 'Topic-route-a', { ...base, replyContent: '草稿 A' });
    saveTopicRouteSnapshot(store, 'Topic-route-b', { ...base, replyContent: '草稿 B' });

    expect(readTopicRouteSnapshot(store, 'Topic-route-a')?.replyContent).toBe('草稿 A');
    expect(readTopicRouteSnapshot(store, 'Topic-route-b')?.replyContent).toBe('草稿 B');
    removeTopicRouteSnapshot(store, 'Topic-route-b');
    expect(readTopicRouteSnapshot(store, 'Topic-route-b')).toBeUndefined();
  });

  it('restores reply filters, pagination, draft and scroll state from a route snapshot', () => {
    const store = createTopicRouteSessionStore();
    const session: TopicSession = {
      ...createEmptyTopicSession(topic('6')),
      replyHasMore: true,
      replyNextPage: 4,
      replyNextOffset: 60,
      commentQuery: '关键字',
      replyFilter: 'author',
      replyContent: '尚未发送的草稿',
      replyComposerOpen: true,
      scrollY: 960
    };

    saveTopicRouteSnapshot(store, 'Topic-route-visible-state', snapshotFromTopicSession(session));
    const snapshot = readTopicRouteSnapshot(store, 'Topic-route-visible-state');
    if (!snapshot) {
      throw new Error('Topic route snapshot was not saved');
    }

    expect(topicSessionFromSnapshot(snapshot)).toMatchObject({
      replyHasMore: true,
      replyNextPage: 4,
      replyNextOffset: 60,
      commentQuery: '关键字',
      replyFilter: 'author',
      replyContent: '尚未发送的草稿',
      replyComposerOpen: true,
      scrollY: 960
    });
  });
});
