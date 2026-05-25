import { describe, expect, it } from 'vitest';
import { nodeSeekUserIdFromValue, topicWithAuthorFallback, userFromReply, userFromTopic } from './userNavigation';
import type { Reply, Topic, TopicDetail } from './types';

describe('Android user navigation helpers', () => {
  it('extracts NodeSeek numeric user IDs from space URLs with discussion hashes', () => {
    expect(nodeSeekUserIdFromValue('https://www.nodeseek.com/space/15105#/discussions')).toBe('15105');
    expect(nodeSeekUserIdFromValue('/space/15105#/discussions')).toBe('15105');
    expect(nodeSeekUserIdFromValue('Bugs')).toBe('');
  });

  it('keeps NodeSeek author navigation available when detail data loses the list author ID', () => {
    const listTopic: Topic = {
      source: 'nodeseek',
      id: '746779',
      title: 'NodeSeek topic',
      author: 'Bugs',
      authorId: '15105',
      authorUrl: 'https://www.nodeseek.com/space/15105#/discussions',
      url: 'https://www.nodeseek.com/post-746779-1',
      createdAt: '2026-05-25T03:34:00.000Z',
      replyCount: 9
    };
    const detailTopic: TopicDetail = {
      ...listTopic,
      authorId: undefined,
      authorUrl: undefined,
      contentHtml: '<p>body</p>',
      replies: []
    };

    const merged = topicWithAuthorFallback(detailTopic, listTopic);
    expect(merged).not.toBeNull();
    const user = userFromTopic(merged!);

    expect(merged?.authorId).toBe('15105');
    expect(user).toMatchObject({
      source: 'nodeseek',
      id: '15105',
      username: 'Bugs',
      url: 'https://www.nodeseek.com/space/15105#/discussions'
    });
  });

  it('does not treat a NodeSeek display name as a user ID', () => {
    const topic: Topic = {
      source: 'nodeseek',
      id: '746779',
      title: 'NodeSeek topic',
      author: 'Bugs',
      url: 'https://www.nodeseek.com/post-746779-1',
      createdAt: '2026-05-25T03:34:00.000Z',
      replyCount: 9
    };
    const reply: Reply = {
      author: 'Bugs',
      contentHtml: '<p>reply</p>',
      createdAt: '2026-05-25T03:35:00.000Z'
    };

    expect(userFromTopic(topic)).toBeNull();
    expect(userFromReply(reply, 'nodeseek')).toBeNull();
  });
});
