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

  it('keeps the saved NodeSeek topic title and category when restricted detail uses a placeholder title', () => {
    const listTopic: Topic = {
      source: 'nodeseek',
      id: '760813',
      title: '求新闻类app分流域名合集',
      author: '江shan-123',
      authorId: '123',
      categoryId: 'inside',
      category: '内版',
      url: 'https://www.nodeseek.com/post-760813-1',
      createdAt: '2026-06-04T06:58:00.000Z',
      replyCount: 0
    };
    const detailTopic: TopicDetail = {
      ...listTopic,
      title: '受限帖子',
      categoryId: 'daily',
      category: '日常',
      accessRequirement: {
        type: 'level',
        label: '需权限',
        detail: '查看本帖需要Lv2'
      },
      contentHtml: '<p>查看本帖需要Lv2</p>',
      replies: []
    };

    const merged = topicWithAuthorFallback(detailTopic, listTopic);

    expect(merged?.title).toBe('求新闻类app分流域名合集');
    expect(merged?.author).toBe('江shan-123');
    expect(merged?.categoryId).toBe('inside');
    expect(merged?.category).toBe('内版');
  });

  it('keeps a list access requirement when a V2EX detail response omits it', () => {
    const listTopic: Topic = {
      source: 'v2ex',
      id: '123',
      title: 'V2EX restricted topic',
      author: 'alice',
      url: 'https://www.v2ex.com/t/123',
      createdAt: '2026-06-04T06:58:00.000Z',
      replyCount: 0,
      accessRequirement: {
        type: 'permission',
        label: '需权限',
        detail: 'This topic is private.'
      }
    };
    const detailTopic: TopicDetail = {
      ...listTopic,
      accessRequirement: undefined,
      contentHtml: '<p>This topic is private.</p>',
      replies: []
    };

    const merged = topicWithAuthorFallback(detailTopic, listTopic);

    expect(merged?.accessRequirement).toEqual(listTopic.accessRequirement);
  });

  it('keeps a linux.do list title when a restricted detail uses a placeholder title', () => {
    const listTopic: Topic = {
      source: 'linuxdo',
      id: '123',
      title: 'linux.do 限制主题',
      author: 'alice',
      categoryId: '12',
      category: '开发调优',
      url: 'https://linux.do/t/topic/123',
      createdAt: '2026-06-04T06:58:00.000Z',
      replyCount: 0
    };
    const detailTopic: TopicDetail = {
      ...listTopic,
      title: '受限帖子',
      accessRequirement: {
        type: 'permission',
        label: '需权限',
        detail: 'You are not permitted to view this topic.'
      },
      contentHtml: 'You are not permitted to view this topic.',
      replies: []
    };

    const merged = topicWithAuthorFallback(detailTopic, listTopic);

    expect(merged?.title).toBe('linux.do 限制主题');
    expect(merged?.category).toBe('开发调优');
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
