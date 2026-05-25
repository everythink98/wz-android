import { describe, expect, it } from 'vitest';
import {
  filterLibraryRecords,
  filterRepliesByQuery,
  groupLibraryRecordsByTime,
  highlightHtml,
  highlightTextParts,
  libraryCategoryFilterItems,
  readerModeHtml
} from './androidFeatureHelpers';
import type { Category, Reply, Topic } from './types';
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
    topic: {
      ...topic,
      id: patch.id,
      title: `Topic ${patch.id}`,
      category: patch.topic?.category ?? topic.category,
      categoryId: patch.topic?.categoryId ?? topic.categoryId,
      source: patch.topic?.source ?? topic.source
    },
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

  it('filters library records by source-scoped category keys', () => {
    const records = [
      record({ id: '1', savedAt: '2026-05-20T00:00:00.000Z', topic: { ...topic, source: 'nodeseek', category: '日常', categoryId: 'daily' } }),
      record({ id: '2', savedAt: '2026-05-20T00:00:00.000Z', topic: { ...topic, source: 'v2ex', category: '分享创造', categoryId: 'daily' } })
    ];

    expect(filterLibraryRecords(records, { source: 'all', category: 'v2ex:daily', tag: 'all' }).map((item) => item.topic.id)).toEqual(['2']);
    expect(filterLibraryRecords(records, { source: 'nodeseek', category: 'nodeseek:daily', tag: 'all' }).map((item) => item.topic.id)).toEqual(['1']);
  });

  it('builds library category filters only from the selected source', () => {
    const records = [
      record({ id: '1', savedAt: '2026-05-20T00:00:00.000Z', topic: { ...topic, source: 'v2ex', category: '分享创造', categoryId: 'create' } }),
      record({ id: '2', savedAt: '2026-05-20T00:00:00.000Z', topic: { ...topic, source: 'nodeseek', category: '日常', categoryId: 'daily' } }),
      record({ id: '3', savedAt: '2026-05-20T00:00:00.000Z', topic: { ...topic, source: 'linuxdo', category: '4', categoryId: '4' } })
    ];
    const categories: Category[] = [
      { source: 'v2ex', id: 'create', name: '分享创造' },
      { source: 'nodeseek', id: 'daily', name: '日常' },
      { source: 'linuxdo', id: '4', name: '开发调优' }
    ];

    expect(libraryCategoryFilterItems(records, categories, 'linuxdo')).toEqual([
      { value: 'all', label: '全部' },
      { value: 'linuxdo:4', label: '开发调优' }
    ]);
    expect(libraryCategoryFilterItems(records, categories, 'all').map((item) => item.value)).toEqual([
      'all',
      'v2ex:create',
      'nodeseek:daily',
      'linuxdo:4'
    ]);
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
