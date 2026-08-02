import { describe, expect, it } from 'vitest';
import type { TopicDetail } from '@/domain/forum/models';
import { buildTopicOpeningPresentation } from './topicOpeningPresentation';

const topic: TopicDetail = {
  source: 'linuxdo',
  id: '42',
  title: 'Topic',
  author: 'alice',
  url: 'https://linux.do/t/topic/42',
  createdAt: '2026-08-01T00:00:00.000Z',
  replyCount: 1,
  contentHtml: '<p>body</p>',
  replies: [],
  acceptedAnswerFloor: 2
};

describe('topic opening presentation', () => {
  it('projects opening content and a paged accepted answer without UI state', () => {
    const accepted = {
      author: 'bob',
      contentHtml: '<p>answer</p>',
      createdAt: '2026-08-01T00:01:00.000Z',
      floor: 2
    };
    const result = buildTopicOpeningPresentation({
      loadedQuotedReplies: { 'linuxdo:42:2': accepted },
      sourceReplies: [],
      topic
    });

    expect(result.contentItems).toEqual([expect.objectContaining({ type: 'content', html: '<p>body</p>' })]);
    expect(result.acceptedAnswer).toMatchObject({ floor: 2, reply: accepted });
  });

  it('replaces restricted content with one access notice and suppresses answer loading', () => {
    const result = buildTopicOpeningPresentation({
      loadedQuotedReplies: {},
      sourceReplies: [],
      topic: {
        ...topic,
        accessRequirement: { type: 'permission', label: '需权限', detail: '暂无权限查看此内容' },
        contentHtml: '<p>暂无权限查看此内容</p>'
      }
    });

    expect(result.contentItems).toEqual([
      { type: 'accessNotice', key: 'topic-access-notice', label: '需权限', detail: '暂无权限查看此内容' }
    ]);
    expect(result.acceptedAnswer).toBeNull();
  });
});
