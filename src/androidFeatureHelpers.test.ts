import { describe, expect, it } from 'vitest';
import {
  filterLibraryRecords,
  filterRepliesByQuery,
  groupLibraryRecordsByTime,
  highlightHtml,
  highlightTextParts,
  readerModeHtml
} from './androidFeatureHelpers';
import type { Reply, Topic } from './types';
import type { TopicRecord } from './readerData';

const topic: Topic = {
  source: 'nodeseek',
  id: '1',
  title: 'Hello VPS',
  author: 'alice',
  category: 'Daily',
  categoryId: 'daily',
  url: 'https://example.com/1',
  createdAt: '2026-05-20T00:00:00.000Z',
  replyCount: 2
};

function record(patch: Partial<TopicRecord> & { id: string; savedAt: string }): TopicRecord {
  return {
    topic: { ...topic, id: patch.id, title: `Topic ${patch.id}`, category: patch.topic?.category ?? topic.category },
    savedAt: patch.savedAt,
    tags: patch.tags,
    note: patch.note,
    visitCount: patch.visitCount
  };
}

describe('Android feature helpers', () => {
  it('builds plain text highlight parts from positive search terms', () => {
    expect(highlightTextParts('Hello VPS blocked', 'hello -blocked vps')).toEqual([
      { text: 'Hello', highlighted: true },
      { text: ' ', highlighted: false },
      { text: 'VPS', highlighted: true },
      { text: ' blocked', highlighted: false }
    ]);
  });

  it('highlights html text without touching tags', () => {
    expect(highlightHtml('<p>Hello <strong>VPS</strong></p>', 'vps hello')).toBe('<p><mark>Hello</mark> <strong><mark>VPS</mark></strong></p>');
  });

  it('filters library records and groups them by recency', () => {
    const records = [
      record({ id: '1', savedAt: '2026-05-23T03:00:00.000Z', tags: ['server'] }),
      record({ id: '2', savedAt: '2026-05-20T03:00:00.000Z', tags: ['app'], topic: { ...topic, category: 'App' } }),
      record({ id: '3', savedAt: '2026-05-10T03:00:00.000Z' })
    ];

    expect(filterLibraryRecords(records, { source: 'all', category: 'Daily', tag: 'server' }).map((item) => item.topic.id)).toEqual(['1']);
    expect(groupLibraryRecordsByTime(records, new Date('2026-05-23T12:00:00.000Z')).map((section) => section.label)).toEqual(['今天', '本周', '更早']);
  });

  it('filters replies by query', () => {
    const replies: Reply[] = [
      { floor: 1, author: 'alice', createdAt: '2026-05-23T01:00:00.000Z', contentHtml: '<p>Hello VPS</p>' },
      { floor: 2, author: 'bob', createdAt: '2026-05-23T02:00:00.000Z', contentHtml: '<p>Other</p>' }
    ];

    expect(filterRepliesByQuery(replies, 'vps')).toEqual([replies[0]]);
  });

  it('normalizes reader mode html noise', () => {
    expect(readerModeHtml('<p></p><hr><hr><p>Body</p>')).toBe('<hr><p>Body</p>');
  });
});
