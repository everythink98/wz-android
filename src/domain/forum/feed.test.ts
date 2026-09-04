import { describe, expect, it } from 'vitest';
import { dateTime } from './presentation';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { applyFeedFilter, balanceTopicsBySource, mergeTopics } from './feed';
import type { Topic } from './models';

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

  it('round-robins uneven buckets in first-source order without changing input', () => {
    const items: Topic[] = [topic, { ...topic, id: '2' }, { ...topic, source: 'v2ex', id: '3' }, { ...topic, id: '4' }];
    expect(balanceTopicsBySource(items).map(({ id }) => id)).toEqual(['1', '3', '2', '4']);
    expect(items.map(({ id }) => id)).toEqual(['1', '2', '3', '4']);
    expect(balanceTopicsBySource([])).toEqual([]);
  });

  it('deduplicates topics and normalizes invalid dates', () => {
    expect(mergeTopics([topic], [{ ...topic }, { ...topic, id: '2' }])).toHaveLength(2);
    expect(dateTime('bad-date')).toBe(0);
  });

  it('fills missing access requirements when merging duplicate topics', () => {
    const merged = mergeTopics(
      [topic],
      [
        {
          ...topic,
          accessRequirement: {
            type: 'permission',
            label: '需权限',
            detail: 'This topic is private.'
          }
        }
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].accessRequirement).toEqual({
      type: 'permission',
      label: '需权限',
      detail: 'This topic is private.'
    });
  });

  it('updates stale level access requirements when a duplicate topic has a newer real level', () => {
    const merged = mergeTopics(
      [
        {
          ...topic,
          accessRequirement: {
            type: 'level',
            label: '需等级',
            detail: 'Lv2'
          }
        }
      ],
      [
        {
          ...topic,
          accessRequirement: {
            type: 'level',
            label: '需等级',
            detail: 'Lv5'
          }
        }
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv5'
    });
  });

  it('keeps an explicit level when a duplicate topic only has a generic level marker', () => {
    const merged = mergeTopics(
      [
        {
          ...topic,
          accessRequirement: {
            type: 'level',
            label: '需等级',
            detail: 'Lv5'
          }
        }
      ],
      [
        {
          ...topic,
          accessRequirement: {
            type: 'level',
            label: '需等级'
          }
        }
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv5'
    });
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

  it('keeps first-seen order while consolidating cross-page identity, access, and external-link duplicates', () => {
    const externalA: Topic = { ...topic, source: 'v2ex', id: 'external-a', url: 'https://example.com/shared' };
    const restricted: Topic = { ...topic, id: 'restricted', url: 'https://example.com/restricted' };
    const trailing: Topic = { ...topic, id: 'trailing', url: 'https://example.com/trailing' };

    const merged = mergeTopics(
      [],
      [
        externalA,
        { ...externalA, accessRequirement: { type: 'level', label: '需等级', detail: 'Lv2' } },
        restricted,
        { ...topic, source: 'nodeseek', id: 'external-b', url: 'https://example.com/shared' },
        {
          ...restricted,
          accessRequirement: { type: 'level', label: '需等级', detail: 'Lv4' }
        },
        { ...topic, source: 'linuxdo', id: 'external-c', url: 'https://example.com/shared' },
        trailing
      ]
    );

    expect(merged.map(({ id }) => id)).toEqual(['external-a', 'restricted', 'trailing']);
    expect(merged[0].duplicateSources).toEqual(['NodeSeek', 'linux.do']);
    expect(merged[0].accessRequirement).toEqual({ type: 'level', label: '需等级', detail: 'Lv2' });
    expect(merged[1].accessRequirement).toEqual({ type: 'level', label: '需等级', detail: 'Lv4' });
  });
});
