import { describe, expect, it } from 'vitest';
import {
  createEmptyTopicSession,
  createTopicSessionKey,
  pushTopicSession,
  restoreTopicSession,
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

describe('topic session state', () => {
  it('uses source and id as the detail session identity', () => {
    expect(createTopicSessionKey(topic('1'))).toBe('nodeseek:1');
  });

  it('keeps a parent detail state suspended while a nested detail is open', () => {
    const parent: TopicSession = {
      ...createEmptyTopicSession(topic('1')),
      commentQuery: '关键词',
      replyContent: '草稿',
      expandedQuotes: { '2:1': true },
      scrollY: 320
    };
    const child = createEmptyTopicSession(topic('2'));

    const stack = pushTopicSession([], parent);
    const restored = restoreTopicSession(stack, child);

    expect(restored.current).toMatchObject({
      key: 'nodeseek:1',
      commentQuery: '关键词',
      replyContent: '草稿',
      expandedQuotes: { '2:1': true },
      scrollY: 320
    });
    expect(restored.stack).toEqual([]);
  });

  it('does not push the current topic when the app link points to itself', () => {
    const current = createEmptyTopicSession(topic('1'));
    const stack = pushTopicSession([], current, topic('1'));

    expect(stack).toEqual([]);
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
});
