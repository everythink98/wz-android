import { describe, expect, it } from 'vitest';
import type { TopicDetail } from '@/domain/forum/models';
import { hasSameYaohuoTopicLayout } from './topicContentIdentity';

describe('topic content identity', () => {
  it('ignores Yaohuo bookmark fields but not content changes', () => {
    const detail: TopicDetail = {
      source: 'yaohuo',
      id: '123',
      title: 'topic',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-123.html',
      createdAt: '2026-07-15T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>body</p>',
      replies: [],
      bookmarked: false
    };

    expect(hasSameYaohuoTopicLayout(detail, { ...detail, bookmarked: true, bookmarkId: 987 })).toBe(true);
    expect(hasSameYaohuoTopicLayout(detail, { ...detail, title: 'changed' })).toBe(false);
  });
});
