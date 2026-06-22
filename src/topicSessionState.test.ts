import { describe, expect, it } from 'vitest';
import {
  createEmptyTopicSession,
  pushTopicSession,
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
      scrollY: 120
    };
    const restored = topicSessionFromSnapshot(snapshotFromTopicSession(session));

    expect(restored).toMatchObject({
      key: 'nodeseek:3',
      replyContent: '待回复',
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
});
