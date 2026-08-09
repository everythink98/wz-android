import { describe, expect, it } from 'vitest';
import type { Reply } from '@/domain/forum/models';
import { topicListMediaPlanStats, type TopicListItem } from './topicListModel';

const reply: Reply = {
  author: 'alice',
  contentHtml: '<p>reply</p>',
  createdAt: '2026-08-09T00:00:00.000Z',
  floor: 2
};

describe('topic list model', () => {
  it('[REG-PERF-010] aggregates only planned parent rows and opaque media counts', () => {
    const items: TopicListItem[] = [
      {
        type: 'topicContent',
        key: 'opening-1',
        content: {
          type: 'content',
          key: 'content-1',
          html: '<p><img src="https://secret.example/1.jpg"></p>',
          groupKey: 'opening',
          continuation: 'first',
          networkMediaCount: 4
        }
      },
      { type: 'replyStart', key: 'reply-start', reply, replyFloor: 2 },
      {
        type: 'replyContent',
        key: 'reply-content',
        reply,
        replyFloor: 2,
        content: {
          type: 'html',
          continuation: 'only',
          groupKey: '0:block-0',
          html: '<img src="https://secret.example/2.jpg">',
          networkMediaCount: 1
        },
        first: true,
        last: true
      },
      {
        type: 'replySignatureContent',
        key: 'reply-signature',
        reply,
        replyFloor: 2,
        html: '<img src="https://secret.example/3.jpg">',
        continuation: 'only',
        groupKey: 'block-0',
        networkMediaCount: 1,
        first: true,
        last: true
      },
      { type: 'topicPostlude', key: 'postlude' }
    ];

    expect(topicListMediaPlanStats(items)).toEqual({ networkMediaCount: 6, plannedRowCount: 3 });
    expect(JSON.stringify(topicListMediaPlanStats(items))).not.toContain('secret.example');
  });
});
