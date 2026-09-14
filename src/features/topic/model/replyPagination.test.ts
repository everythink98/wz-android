import { describe, expect, it } from 'vitest';
import type { Reply, TopicDetail } from '@/domain/forum/models';
import { replyKey } from '@/domain/forum/feed';
import {
  firstReplyData,
  hasNextReplyPage,
  hasPreviousReplyPage,
  mergedReplyPages,
  topicHasCompleteReplies,
  type ReplyPage
} from './replyPagination';

describe('topic query pagination', () => {
  it('accepts an advancing reply cursor', () => {
    expect(
      hasNextReplyPage({
        hasMore: true,
        requestedPage: 1,
        requestedOffset: 0,
        nextPage: 2,
        nextOffset: 20
      })
    ).toBe(true);
  });

  it('rejects a repeated reply cursor', () => {
    expect(
      hasNextReplyPage({
        hasMore: true,
        requestedPage: 2,
        requestedOffset: 20,
        nextPage: 2,
        nextOffset: 20
      })
    ).toBe(false);
  });

  it('accepts an advancing previous cursor and rejects a repeated one', () => {
    expect(
      hasPreviousReplyPage({
        requestedPage: 16,
        requestedOffset: 150,
        previousPage: 15,
        previousOffset: 140
      })
    ).toBe(true);
    expect(
      hasPreviousReplyPage({
        requestedPage: 16,
        requestedOffset: 150,
        previousPage: 16,
        previousOffset: 150
      })
    ).toBe(false);
  });

  it('requires explicit completeness before enabling full-collection behavior', () => {
    const detail: TopicDetail = {
      source: 'v2ex',
      id: '1',
      title: 'Partial replies',
      author: 'alice',
      url: 'https://www.v2ex.com/t/1',
      createdAt: '2026-08-10T00:00:00.000Z',
      contentHtml: '<p>body</p>',
      replies: [{ author: 'bob', floor: 1, commentId: 101, contentHtml: '<p>reply</p>', createdAt: '' }],
      replyCount: 1,
      replyHasMore: false
    };

    for (const replyCompleteness of [undefined, 'partial'] as const) {
      const candidate = { ...detail, replyCompleteness };
      expect(topicHasCompleteReplies(candidate)).toBe(false);
      expect(firstReplyData(candidate, 'oldest')?.pages[0].items).toHaveLength(1);
      expect(firstReplyData(candidate, 'newest')).toBeUndefined();
    }

    const complete = { ...detail, replyCompleteness: 'complete' as const };
    expect(topicHasCompleteReplies(complete)).toBe(true);
    expect(firstReplyData(complete, 'newest')?.pages[0].items).toHaveLength(1);
  });

  it('preserves every adapter-approved row when pages share a generic reply key', () => {
    const first: Reply = {
      author: 'first-source-row',
      floor: 7,
      contentHtml: '<p>first</p>',
      createdAt: '2026-08-10T00:00:00.000Z'
    };
    const second: Reply = {
      author: 'second-source-row',
      floor: 7,
      contentHtml: '<p>second</p>',
      createdAt: '2026-08-10T00:01:00.000Z'
    };
    const page = (items: Reply[], requestedPage: number): ReplyPage => ({
      items,
      completeness: 'partial',
      currentPage: requestedPage,
      currentOffset: (requestedPage - 1) * 10,
      hasMore: false,
      nextPage: null,
      requestedPage,
      requestedOffset: (requestedPage - 1) * 10
    });

    const merged = mergedReplyPages({
      pages: [page([first], 1), page([second], 2)],
      pageParams: [
        { kind: 'cursor', page: 1, offset: 0 },
        { kind: 'cursor', page: 2, offset: 10 }
      ]
    });
    expect(merged).toEqual([first, second]);
    expect(new Set(merged.map(replyKey)).size).toBe(2);
  });

  it.each(['prepend', 'append'] as const)(
    'shows overlapping reply windows once after %s without changing cursors',
    (direction) => {
      const reply = (floor: number): Reply => ({
        author: `author-${floor}`,
        authorId: `${floor}`,
        floor,
        createdAt: '2026-09-14T00:00:00Z',
        contentHtml: `<p>reply ${floor}</p>`
      });
      const page = (floors: number[], requestedPage: number): ReplyPage => ({
        items: floors.map(reply),
        completeness: 'complete',
        currentPage: requestedPage,
        requestedPage,
        requestedOffset: null,
        hasMore: true,
        nextPage: requestedPage + 1
      });
      const older = page(direction === 'prepend' ? [2, 3, 4] : [4, 3, 2], 2);
      const newer = page(direction === 'prepend' ? [4, 5, 6] : [6, 5, 4], 1);
      const data = { pages: direction === 'prepend' ? [older, newer] : [newer, older], pageParams: [] };
      const merged = mergedReplyPages(data);
      expect(merged.map((reply) => reply.floor)).toEqual(direction === 'prepend' ? [2, 3, 4, 5, 6] : [6, 5, 4, 3, 2]);
      expect(new Set(merged.map(replyKey)).size).toBe(merged.length);
      expect(data.pages.map((page) => page.items.length)).toEqual([3, 3]);
      expect(data.pages.map((page) => page.nextPage)).toEqual(direction === 'prepend' ? [3, 2] : [2, 3]);
    }
  );
});
