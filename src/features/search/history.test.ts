import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';
import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_SEARCHES,
  MAX_SEARCH_HISTORY_QUERY_LENGTH,
  normalizeSearchHistory,
  sameSearchHistory,
  searchHistoryFromRaw
} from './history';

describe('search history helpers', () => {
  it('loads only clean deduplicated search terms from storage', () => {
    const longQuery = 'x'.repeat(MAX_SEARCH_HISTORY_QUERY_LENGTH + 20);

    expect(searchHistoryFromRaw(JSON.stringify(['  AI  ', '', 'ai', 123, longQuery, 'linux']))).toEqual([
      'AI',
      'x'.repeat(MAX_SEARCH_HISTORY_QUERY_LENGTH),
      'linux'
    ]);
  });

  it('keeps only the most recent search terms', () => {
    const history = Array.from({ length: MAX_RECENT_SEARCHES + 5 }, (_, index) => `query ${index}`);

    expect(normalizeSearchHistory(history)).toHaveLength(MAX_RECENT_SEARCHES);
    expect(normalizeSearchHistory(history).at(-1)).toBe(`query ${MAX_RECENT_SEARCHES - 1}`);
  });

  it('treats malformed stored history as empty', () => {
    expect(searchHistoryFromRaw('{bad json')).toEqual([]);
    expect(searchHistoryFromRaw(JSON.stringify({ query: 'AI' }))).toEqual([]);
  });

  it('fills the history limit with nonremoved queries after a late read', () => {
    const stored = Array.from({ length: MAX_RECENT_SEARCHES }, (_, index) => `query ${index}`);
    expect(normalizeSearchHistory(['new query', ...stored], new Set(['query 0']))).toEqual([
      'new query',
      ...stored.slice(1)
    ]);
  });

  it('detects unchanged search history snapshots', () => {
    expect(sameSearchHistory(['AI', 'linux'], ['AI', 'linux'])).toBe(true);
    expect(sameSearchHistory(['AI', 'linux'], ['linux', 'AI'])).toBe(false);
    expect(sameSearchHistory(['AI'], ['ai'])).toBe(false);
  });

  it('serializes writes so the latest history state wins', async () => {
    const queue = createKeyedSerialRunner<null>('after-reaction');
    const writes: string[] = [];
    const delivery: string[] = [];
    const releaseFirstWrite = Promise.withResolvers<void>();
    const first = queue.run(null, async () => {
      delivery.push('first:start');
      await releaseFirstWrite.promise;
      writes.push('with A');
    });
    const second = queue.run(null, async () => {
      delivery.push('second:start');
      writes.push('without A');
    });

    const observer = first.then(() => {
      delivery.push('observer');
      queueMicrotask(() => delivery.push('observer:microtask'));
    });
    await Promise.resolve();
    expect(delivery).toEqual([]);
    releaseFirstWrite.resolve();
    await Promise.all([first, second, observer]);

    expect(writes).toEqual(['with A', 'without A']);
    expect(delivery).toEqual(['first:start', 'observer', 'observer:microtask', 'second:start']);
  });
});
