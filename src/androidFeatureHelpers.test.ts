import { describe, expect, it } from 'vitest';
import {
  filterLibraryRecords,
  filterRepliesByQuery,
  createReplyTextIndex,
  createReplyTextIndexForQuery,
  groupLibraryRecordsByTime,
  highlightHtml,
  highlightTextParts,
  libraryCategoryFilterItems,
  replyRefreshTarget,
  stripHtml
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

  it('copies rendered reply text without html while keeping visible line breaks', () => {
    expect(stripHtml('<p>Hello <a href="https://example.com">link</a></p><ul><li>One</li><li>Two</li></ul><pre><code>const x = 1;\n\nconsole.log(x);</code></pre><p><img src="x.png"><img alt="图示" src="y.png"></p>')).toBe('Hello link\nOne\nTwo\nconst x = 1;\n\nconsole.log(x);\n图示');
  });

  it('filters library records and groups them by recency', () => {
    const records = [
      record({ id: '1', savedAt: '2026-05-23T03:00:00.000Z' }),
      record({ id: '2', savedAt: '2026-05-20T03:00:00.000Z', topic: { ...topic, category: 'App' } }),
      record({ id: '3', savedAt: '2026-05-10T03:00:00.000Z', topic: { ...topic, category: 'Other', categoryId: 'other' } })
    ];

    expect(filterLibraryRecords(records, { source: 'all', category: 'Daily' }).map((item) => item.topic.id)).toEqual(['1']);
    expect(groupLibraryRecordsByTime(records, new Date('2026-05-23T12:00:00.000Z')).map((section) => section.label)).toEqual(['今天', '本周', '更早']);
  });

  it('filters library records by source-scoped category keys', () => {
    const records = [
      record({ id: '1', savedAt: '2026-05-20T00:00:00.000Z', topic: { ...topic, source: 'nodeseek', category: '日常', categoryId: 'daily' } }),
      record({ id: '2', savedAt: '2026-05-20T00:00:00.000Z', topic: { ...topic, source: 'v2ex', category: '分享创造', categoryId: 'daily' } })
    ];

    expect(filterLibraryRecords(records, { source: 'all', category: 'v2ex:daily' }).map((item) => item.topic.id)).toEqual(['2']);
    expect(filterLibraryRecords(records, { source: 'nodeseek', category: 'nodeseek:daily' }).map((item) => item.topic.id)).toEqual(['1']);
  });

  it('builds library category filters only from the selected source', () => {
    const categories: Category[] = [
      { source: 'v2ex', id: 'create', name: '分享创造' },
      { source: 'nodeseek', id: 'daily', name: '日常' },
      { source: 'linuxdo', id: '4', name: '开发调优' }
    ];

    expect(libraryCategoryFilterItems(categories, 'linuxdo')).toEqual([
      { value: 'all', label: '全部' },
      { value: 'linuxdo:4', label: '开发调优' }
    ]);
    expect(libraryCategoryFilterItems(categories, 'all').map((item) => item.value)).toEqual([
      'all',
      'v2ex:create',
      'nodeseek:daily',
      'linuxdo:4'
    ]);
  });

  it('filters replies by query with or without a cached text index', () => {
    const replies: Reply[] = [
      { floor: 1, author: 'alice', createdAt: '2026-05-23T01:00:00.000Z', contentHtml: '<p>Hello VPS</p>' },
      { floor: 2, author: 'bob', createdAt: '2026-05-23T02:00:00.000Z', contentHtml: '<p>Other</p>' }
    ];
    const index = createReplyTextIndex(replies);

    expect(filterRepliesByQuery(replies, 'vps')).toEqual([replies[0]]);
    expect(filterRepliesByQuery(replies, 'vps', index)).toEqual([replies[0]]);
  });

  it('builds a reply text index only when a query needs one', () => {
    const replies: Reply[] = [
      { floor: 1, author: 'alice', createdAt: '2026-05-23T01:00:00.000Z', contentHtml: '<p>Hello VPS</p>' },
      { floor: 2, author: 'bob', createdAt: '2026-05-23T02:00:00.000Z', contentHtml: '<p>Other</p>' }
    ];

    expect(createReplyTextIndexForQuery(replies, '   -ignored ')).toBeUndefined();

    const index = createReplyTextIndexForQuery(replies, 'vps');
    expect(index).toBeInstanceOf(Map);
    expect(filterRepliesByQuery(replies, 'vps', index)).toEqual([replies[0]]);
  });

  it('keeps NodeSeek submit refresh on page one when reply pagination is still page-one offset based', () => {
    expect(replyRefreshTarget({
      source: 'nodeseek',
      afterSubmit: true,
      expectedReplyCount: 61,
      replyNextPage: 1
    })).toEqual({
      page: 1,
      offset: 60
    });
  });

  it('refreshes changed replies from the page that currently contains them', () => {
    expect(replyRefreshTarget({
      source: 'linuxdo',
      afterSubmit: true,
      expectedReplyCount: 91,
      targetReplyIndex: 35
    })).toEqual({
      page: 2,
      offset: 30
    });

    expect(replyRefreshTarget({
      source: 'yaohuo',
      afterSubmit: true,
      expectedReplyCount: 91,
      targetReplyIndex: 35
    })).toEqual({
      page: 2,
      offset: 0
    });
  });
});
