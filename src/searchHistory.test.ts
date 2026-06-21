import { describe, expect, it } from 'vitest';
import { MAX_RECENT_SEARCHES, MAX_SEARCH_HISTORY_QUERY_LENGTH, mergeLoadedSearchHistory, normalizeSearchHistory, searchHistoryFromRaw } from './searchHistory';

describe('search history helpers', () => {
  it('loads only clean deduplicated search terms from storage', () => {
    const longQuery = 'x'.repeat(MAX_SEARCH_HISTORY_QUERY_LENGTH + 20);

    expect(searchHistoryFromRaw(JSON.stringify([
      '  AI  ',
      '',
      'ai',
      123,
      longQuery,
      'linux'
    ]))).toEqual([
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
});
