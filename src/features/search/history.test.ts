import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_SEARCHES,
  MAX_SEARCH_HISTORY_QUERY_LENGTH,
  createSearchHistoryWriteQueue,
  enqueueSearchHistoryWrite,
  mergeLoadedSearchHistory,
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

  it('merges loaded history without dropping searches added during startup', () => {
    expect(mergeLoadedSearchHistory(['new query'], JSON.stringify(['old query', 'new query']))).toEqual([
      'new query',
      'old query'
    ]);
  });

  it('detects unchanged search history snapshots', () => {
    expect(sameSearchHistory(['AI', 'linux'], ['AI', 'linux'])).toBe(true);
    expect(sameSearchHistory(['AI', 'linux'], ['linux', 'AI'])).toBe(false);
    expect(sameSearchHistory(['AI'], ['ai'])).toBe(false);
  });

  it('serializes writes so the latest history state wins', async () => {
    const queue = createSearchHistoryWriteQueue();
    const writes: string[] = [];
    const releaseFirstWrite = Promise.withResolvers<void>();
    const first = enqueueSearchHistoryWrite(queue, async () => {
      await releaseFirstWrite.promise;
      writes.push('with A');
    });
    const second = enqueueSearchHistoryWrite(queue, async () => {
      writes.push('without A');
    });

    releaseFirstWrite.resolve();
    await Promise.all([first, second]);

    expect(writes).toEqual(['with A', 'without A']);
  });
});
