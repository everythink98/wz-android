import { describe, expect, it } from 'vitest';
import { createEmptyReaderData } from './readerData';
import { applyFeedFilter, dateTime, mergeReplies, mergeSettledFeedResponses, mergeTopics, nextFeedPageState, searchLocal, shouldFetchAggregatedBaseFeed } from './feedLogic';
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

  it('searches saved local records without list-management filters', () => {
    const data = createEmptyReaderData();
    data.favorites.nodeseek_1 = {
      topic,
      savedAt: '2026-05-20T01:00:00.000Z'
    };

    expect(applyFeedFilter([
      topic,
      { ...topic, id: '2', title: 'blocked title' }
    ], data, 'all')).toHaveLength(2);
    expect(searchLocal(data, 'Hello VPS', 'all')).toEqual([topic]);
  });

  it('honors excluded terms in local search', () => {
    const data = createEmptyReaderData();
    data.favorites.nodeseek_1 = {
      topic: { ...topic, title: 'Hello VPS blocked' },
      savedAt: '2026-05-20T01:00:00.000Z'
    };

    expect(searchLocal(data, 'VPS -other', 'all')).toEqual([data.favorites.nodeseek_1.topic]);
    expect(searchLocal(data, 'VPS -blocked', 'all')).toEqual([]);
  });

  it('keeps only unread, read, and favorite as local reading filters', () => {
    const data = createEmptyReaderData();
    const readTopic: Topic = { ...topic, id: '2' };
    const favoriteTopic: Topic = { ...topic, id: '3' };
    data.history['nodeseek:2'] = { topic: readTopic, savedAt: '2026-05-20T01:00:00.000Z' };
    data.favorites['nodeseek:3'] = { topic: favoriteTopic, savedAt: '2026-05-20T01:00:00.000Z' };

    expect(applyFeedFilter([topic, readTopic, favoriteTopic], data, 'unread')).toEqual([topic, favoriteTopic]);
    expect(applyFeedFilter([topic, readTopic, favoriteTopic], data, 'read')).toEqual([readTopic]);
    expect(applyFeedFilter([topic, readTopic, favoriteTopic], data, 'favorite')).toEqual([favoriteTopic]);
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

  it('merges duplicate external links across sources while keeping forum topic links separate', () => {
    const externalA: Topic = { ...topic, source: 'v2ex', id: 'a', url: 'https://example.com/shared' };
    const externalB: Topic = { ...topic, source: 'nodeseek', id: 'b', url: 'https://example.com/shared' };
    const forumA: Topic = { ...topic, source: 'v2ex', id: 'c', url: 'https://www.v2ex.com/t/1' };
    const forumB: Topic = { ...topic, source: 'nodeseek', id: 'd', url: 'https://www.nodeseek.com/topic/1' };

    const merged = mergeTopics([externalA, forumA], [externalB, forumB]);

    expect(merged.map((item) => item.id)).toEqual(['a', 'c', 'd']);
    expect(merged[0].duplicateSources).toEqual(['NodeSeek']);
  });

  it('does not mutate existing topics when marking duplicate external links', () => {
    const externalA: Topic = { ...topic, source: 'v2ex', id: 'a', url: 'https://example.com/shared' };
    const externalB: Topic = { ...topic, source: 'nodeseek', id: 'b', url: 'https://example.com/shared' };

    const merged = mergeTopics([externalA], [externalB]);

    expect(externalA.duplicateSources).toBeUndefined();
    expect(merged[0]).not.toBe(externalA);
    expect(merged[0].duplicateSources).toEqual(['NodeSeek']);
  });

  it('keeps merged feed results source-balanced after adding yaohuo items', () => {
    const v2exItems = Array.from({ length: 3 }, (_, index) => ({
      ...topic,
      source: 'v2ex' as const,
      id: `v${index}`,
      title: `V2EX ${index}`,
      url: `https://www.v2ex.com/t/${index}`,
      createdAt: `2026-05-20T00:0${5 - index}:00.000Z`
    }));
    const baseItems: Topic[] = [
      ...v2exItems,
      { ...topic, source: 'nodeseek', id: 'n1', title: 'NodeSeek result', createdAt: '2026-05-20T00:02:00.000Z' },
      { ...topic, source: 'linuxdo', id: 'l1', title: 'linux.do result', createdAt: '2026-05-20T00:01:00.000Z' }
    ];
    const yaohuoItem: Topic = {
      ...topic,
      source: 'yaohuo',
      id: 'y1',
      title: 'Yaohuo result',
      url: 'https://yaohuo.me/bbs-1.html',
      createdAt: '2026-05-20T00:03:00.000Z'
    };

    const merged = mergeSettledFeedResponses(
      { status: 'fulfilled', value: { items: baseItems, errors: {}, hasMore: false, nextPage: null } },
      { status: 'fulfilled', value: { items: [yaohuoItem], errors: {}, hasMore: false, nextPage: null } }
    );

    expect(merged.items.slice(0, 4).map((item) => item.source)).toEqual(['v2ex', 'yaohuo', 'nodeseek', 'linuxdo']);
  });

  it('stops feed pagination when a load-more response adds no visible topics', () => {
    const next = nextFeedPageState({
      items: [topic],
      page: 1,
      hasMore: true
    }, {
      items: [{ ...topic }],
      errors: {},
      hasMore: true,
      nextPage: 6
    }, {
      requestedPage: 2,
      reset: false
    });

    expect(next.items).toEqual([topic]);
    expect(next.hasMore).toBe(false);
    expect(next.page).toBe(2);
  });

  it('preserves feed pagination when a load-more response has errors', () => {
    const next = nextFeedPageState({
      items: [topic],
      page: 1,
      hasMore: true,
      nextCursor: 'cursor-before'
    }, {
      items: [{ ...topic, id: '2', url: 'https://example.com/2' }],
      errors: { v2ex: '读取失败' },
      hasMore: true,
      nextPage: 3,
      nextCursor: 'cursor-after'
    }, {
      requestedPage: 2,
      reset: false
    });

    expect(next.items.map((item) => item.id)).toEqual(['1', '2']);
    expect(next.hasMore).toBe(true);
    expect(next.page).toBe(1);
    expect(next.nextCursor).toBe('cursor-before');
  });

  it('skips the non-yaohuo aggregate feed after its cursor is exhausted while yaohuo can continue', () => {
    expect(shouldFetchAggregatedBaseFeed({ page: 1, hasYaohuoCookie: true })).toBe(true);
    expect(shouldFetchAggregatedBaseFeed({ page: 2, cursor: 'base-cursor', hasYaohuoCookie: true })).toBe(true);
    expect(shouldFetchAggregatedBaseFeed({ page: 2, hasYaohuoCookie: true })).toBe(false);
    expect(shouldFetchAggregatedBaseFeed({ page: 2, hasYaohuoCookie: false })).toBe(true);
  });
});
