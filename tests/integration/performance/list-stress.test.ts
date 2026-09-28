import { describe, expect, it } from 'vitest';
import type { Topic, UserReplyActivity } from '@/domain/forum/models';
import { sourceCatalog, sourceValues } from '@/domain/forum/sourceCatalog';
import { topicKey } from '@/domain/reader/readerData';
import { applyFeedFilter, balanceTopicsBySource, mergeTopics, sortTopicsByCreatedAt } from '@/domain/forum/feed';
import { buildSearchListItems, type SearchGroup } from '@/features/search/listItems';
import { createUserListItems, userListItemKey } from '@/features/user/userScreenItems';

function measure<T>(name: string, operation: () => T) {
  operation();
  const timings: number[] = [];
  let result!: T;
  for (let sample = 0; sample < 9; sample++) {
    const started = performance.now();
    result = operation();
    timings.push(performance.now() - started);
  }
  timings.sort((left, right) => left - right);
  process.stdout.write(
    `PERF ${JSON.stringify({ name, samples: 9, medianMs: Number(timings[4]!.toFixed(3)), p95Ms: Number(timings[8]!.toFixed(3)) })}\n`
  );
  return result;
}

function topics(count: number): Topic[] {
  return Array.from({ length: count }, (_, position) => {
    const index = (position * 7919) % count;
    const source = sourceValues[index % 4]!;
    return {
      source,
      id: String(index),
      title: `主题 ${index} 😀`,
      author: `reader-${index % 100}`,
      url: `${sourceCatalog[source].baseUrl}/t/${index}`,
      createdAt: index % 17 ? new Date(Date.UTC(2026, 0, 1) + (index % 97) * 1000).toISOString() : '',
      isPrivateMessage: source === 'linuxdo' && index % 7 === 0,
      accessRequirement: { type: 'level', label: '需等级', detail: 'Lv2' }
    };
  });
}

describe('large production list derivations (host JS, without native cell rendering)', () => {
  it.each([1000, 10_000, 50_000])(
    'preserves reading membership, source order and access requirements through %i topic projections',
    (count) => {
      const items = topics(count);
      const originalKeys = items.map(topicKey);
      const data = {
        history: Object.fromEntries(
          items.filter((item) => Number(item.id) % 3 === 0).map((item) => [topicKey(item), true])
        ),
        favorites: Object.fromEntries(
          items.filter((item) => Number(item.id) % 5 === 0).map((item) => [topicKey(item), true])
        )
      };
      const reading = Object.fromEntries(
        items.filter((item) => item.source === 'linuxdo').map((item) => [item.id, { visited: true }])
      );
      const read = measure(`feed.read-filter.${count}`, () => applyFeedFilter(items, data, 'read', reading));
      const unread = measure(`feed.unread-filter.${count}`, () => applyFeedFilter(items, data, 'unread', reading));
      const favorite = measure(`feed.favorite-filter.${count}`, () =>
        applyFeedFilter(items, data, 'favorite', reading)
      );
      const expectedRead = items.filter(
        (item) => Number(item.id) % 3 === 0 || (item.source === 'linuxdo' && !item.isPrivateMessage)
      );
      expect(read.map(topicKey)).toEqual(expectedRead.map(topicKey));
      expect(favorite.length).toBe(count / 5);
      expect(favorite.every((item) => Number(item.id) % 5 === 0)).toBe(true);
      expect(new Set([...read, ...unread].map(topicKey)).size).toBe(count);
      expect(read.length + unread.length).toBe(count);

      const sorted = measure(`search.time-sort.${count}`, () => sortTopicsByCreatedAt(items));
      const position = new Map(items.map((item, index) => [topicKey(item), index]));
      expect(
        sorted.every((item, index) => {
          if (!index) return true;
          const previous = sorted[index - 1]!;
          const previousTime = Date.parse(previous.createdAt) || 0;
          const currentTime = Date.parse(item.createdAt) || 0;
          return (
            previousTime > currentTime ||
            (previousTime === currentTime && position.get(topicKey(previous))! < position.get(topicKey(item))!)
          );
        })
      ).toBe(true);
      expect(sorted.slice(count - items.filter((item) => !item.createdAt).length)).toEqual(
        items.filter((item) => !item.createdAt)
      );

      const grouped = sourceValues.flatMap((source) => items.filter((item) => item.source === source));
      const balanced = measure(`feed.source-balance.${count}`, () => balanceTopicsBySource(grouped));
      expect(balanced.every((item, index) => item.source === sourceValues[index % 4])).toBe(true);
      for (const source of sourceValues) {
        expect(balanced.filter((item) => item.source === source).map(topicKey)).toEqual(
          items.filter((item) => item.source === source).map(topicKey)
        );
      }

      const repeated = items.map((item): Topic => ({
        ...item,
        accessRequirement: { type: 'level', label: '需等级', detail: 'Lv5' }
      }));
      const additional = items
        .slice(0, count / 2)
        .map((item): Topic => ({ ...item, id: `new-${item.id}`, url: `${item.url}-new` }));
      const incoming = [...repeated, ...additional];
      const merged = measure(`feed.merge-overlapping-pages.${count}`, () => mergeTopics(items, incoming));
      expect(merged.length).toBe(count * 1.5);
      expect(new Set(merged.map(topicKey)).size).toBe(merged.length);
      expect(merged.slice(0, count).map(topicKey)).toEqual(originalKeys);
      expect(merged.slice(0, count).every((item) => item.accessRequirement?.detail === 'Lv5')).toBe(true);
      expect(items.every((item) => item.accessRequirement?.detail === 'Lv2')).toBe(true);
      expect(items.map(topicKey)).toEqual(originalKeys);
    }
  );

  it.each([1000, 10_000, 50_000])(
    'bounds search overview while preserving complete source pages and unique user keys for %i records',
    (count) => {
      const items = topics(count);
      const groups: SearchGroup[] = sourceValues.map((source) => ({
        source,
        label: sourceCatalog[source].label,
        items: items.filter((item) => item.source === source),
        hasMore: true,
        nextPage: 2,
        settled: true
      }));
      const overview = measure(`search.overview.${count}`, () => buildSearchListItems({ groups, mode: 'overview' }));
      expect(overview.filter((item) => item.type === 'topic').map((item) => item.topic)).toEqual(
        groups.flatMap((group) => group.items.slice(0, 2))
      );
      expect(overview.length).toBe(12);
      const pages = measure(`search.four-source-pages.${count}`, () =>
        groups.map((group) => buildSearchListItems({ groups: [group], mode: 'source' }))
      );
      expect(
        pages
          .flat()
          .filter((item) => item.type === 'topic')
          .map((item) => topicKey(item.topic))
      ).toEqual(groups.flatMap((group) => group.items.map(topicKey)));
      expect(pages.every((page) => page.at(-1)?.type === 'groupLoadMore')).toBe(true);
      const protectedGroups: SearchGroup[] = groups.map((group) => ({
        ...group,
        error: '请重新登录',
        errorKind: 'login-expired',
        nextPage: null,
        authNotice: { kind: 'login-expired', tone: 'warning', message: '请重新登录' }
      }));
      const protectedItems = measure(`search.auth-expired.${count}`, () =>
        buildSearchListItems({ groups: protectedGroups, mode: 'overview' })
      );
      expect(protectedItems.some((item) => item.type === 'topic')).toBe(false);
      expect(protectedItems.filter((item) => item.type === 'groupAuthNotice')).toHaveLength(4);

      const duplicateTopics = [...items, ...items.slice(0, count / 10)];
      const topicRows = measure(`user.topics-with-duplicates.${count}`, () =>
        createUserListItems('topics', duplicateTopics, [])
      );
      expect(topicRows.length).toBe(duplicateTopics.length + 1);
      expect(new Set(topicRows.map(userListItemKey)).size).toBe(topicRows.length);
      expect(topicRows.slice(1, count + 1).map(userListItemKey)).toEqual(items.map(topicKey));
      expect(topicRows.slice(count + 1).map(userListItemKey)).toEqual(
        items.slice(0, count / 10).map((item) => `${topicKey(item)}:2`)
      );
      const replies: UserReplyActivity[] = duplicateTopics.map((item) => ({
        source: item.source,
        id: item.id,
        topicId: item.id,
        topicTitle: item.title,
        topicUrl: item.url,
        url: `${item.url}#reply`
      }));
      const replyRows = measure(`user.replies-with-duplicates.${count}`, () =>
        createUserListItems('replies', [], replies)
      );
      expect(replyRows.length).toBe(replies.length + 1);
      expect(new Set(replyRows.map(userListItemKey)).size).toBe(replyRows.length);
      expect(replyRows.slice(1).map((item) => (item.type === 'reply' ? item.reply : undefined))).toEqual(replies);
      expect(createUserListItems('replies', [], replies).map(userListItemKey)).toEqual(replyRows.map(userListItemKey));
    }
  );
});
