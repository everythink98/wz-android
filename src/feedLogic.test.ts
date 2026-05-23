import { describe, expect, it } from 'vitest';
import { createEmptyReaderData } from './readerData';
import { applyFeedFilter, dateTime, mergeReplies, mergeSearchResponses, mergeTopics, searchLocal } from './feedLogic';
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

  it('honors excluded terms in local search', () => {
    const data = createEmptyReaderData();
    data.favorites.nodeseek_1 = {
      topic: { ...topic, title: 'Hello VPS blocked' },
      savedAt: '2026-05-20T01:00:00.000Z',
      tags: ['server']
    };

    expect(searchLocal(data, 'server -other', 'all')).toEqual([data.favorites.nodeseek_1.topic]);
    expect(searchLocal(data, 'server -blocked', 'all')).toEqual([]);
  });

  it('filters blocked categories by source category id and display name', () => {
    const data = createEmptyReaderData();
    data.settings.blockedCategories = ['nodeseek:daily', 'v2ex:分享创造'];

    const nodeseekTopic: Topic = { ...topic, id: '2', categoryId: 'daily', category: '日常' };
    const v2exTopic: Topic = { ...topic, source: 'v2ex', id: '3', categoryId: 'create', category: '分享创造' };
    const visibleTopic: Topic = { ...topic, id: '4', categoryId: 'tech', category: '技术' };

    expect(applyFeedFilter([nodeseekTopic, v2exTopic, visibleTopic], data, 'all')).toEqual([visibleTopic]);
  });

  it('matches subscribed categories by category id even when the display name is absent', () => {
    const data = createEmptyReaderData();
    data.subscriptions['nodeseek:daily'] = {
      source: 'nodeseek',
      id: 'daily',
      name: '日常',
      subscribedAt: '2026-05-20T00:00:00.000Z'
    };

    const subscribedTopic: Topic = { ...topic, id: '2', categoryId: 'daily', category: undefined };
    const otherTopic: Topic = { ...topic, id: '3', categoryId: 'tech', category: undefined };

    expect(applyFeedFilter([subscribedTopic, otherTopic], data, 'subscribed')).toEqual([subscribedTopic]);
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

  it('keeps merged search results source-balanced for the default relevance order', () => {
    const newestYaohuo = Array.from({ length: 4 }, (_, index) => ({
      ...topic,
      source: 'yaohuo' as const,
      id: `y${index}`,
      title: `Yaohuo ${index}`,
      url: `https://yaohuo.me/bbs-${index}.html`,
      createdAt: `2026-05-20T00:0${index}:00.000Z`
    }));
    const baseItems: Topic[] = [
      { ...topic, source: 'nodeseek', id: 'n1', title: 'NodeSeek result', createdAt: '2026-05-19T00:00:00.000Z' },
      { ...topic, source: 'linuxdo', id: 'l1', title: 'linux.do result', createdAt: '2026-05-18T00:00:00.000Z' },
      { ...topic, source: 'v2ex', id: 'v1', title: 'V2EX result', createdAt: '2026-05-17T00:00:00.000Z' }
    ];

    const merged = mergeSearchResponses({ items: baseItems, errors: {} }, { items: newestYaohuo, errors: {} });

    expect(merged.items.slice(0, 4).map((item) => item.source)).toEqual(['yaohuo', 'nodeseek', 'linuxdo', 'v2ex']);
  });
});
