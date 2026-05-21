import { describe, expect, it } from 'vitest';
import { createEmptyReaderData } from './readerData';
import { applyFeedFilter, dateTime, mergeReplies, mergeTopics, searchLocal } from './feedLogic';
import type { Reply, Topic } from './types';

describe('Android feed logic helpers', () => {
  const topic: Topic = {
    source: 'nodeseek',
    id: '1',
    title: 'Hello VPS',
    author: 'alice',
    url: 'https://example.com/1',
    createdAt: '2026-05-20T00:00:00.000Z',
    replyCount: 1
  };

  it('filters blocked topics and searches saved local records', () => {
    const data = createEmptyReaderData();
    data.settings.blockedKeywords = ['blocked'];
    data.favorites.nodeseek_1 = {
      topic,
      savedAt: '2026-05-20T01:00:00.000Z',
      tags: ['server']
    };

    expect(applyFeedFilter([
      topic,
      { ...topic, id: '2', title: 'blocked title' }
    ], data, 'all')).toEqual([topic]);
    expect(searchLocal(data, 'server VPS', 'all')).toEqual([topic]);
  });

  it('deduplicates topics and replies by stable keys', () => {
    const replies: Reply[] = [
      { floor: 1, author: 'a', createdAt: '2026-05-20T00:00:00.000Z', contentHtml: '<p>one</p>' },
      { floor: 1, author: 'a', createdAt: '2026-05-20T00:01:00.000Z', contentHtml: '<p>duplicate</p>' },
      { floor: 2, author: 'b', createdAt: '2026-05-20T00:02:00.000Z', contentHtml: '<p>two</p>' }
    ];

    expect(mergeTopics([topic], [{ ...topic }, { ...topic, id: '2' }])).toHaveLength(2);
    expect(mergeReplies([replies[0]], replies.slice(1))).toEqual([replies[0], replies[2]]);
    expect(dateTime('bad-date')).toBe(0);
  });
});
