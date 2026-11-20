import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { searchTopics } from './searchRead';

describe('search read', () => {
  it.each(['v2ex', 'linuxdo'] as const)(
    'keeps all matching %s results across pages with an excluded search term',
    async (source) => {
      const hits = Array.from({ length: 8 }, (_, index) => ({
        _source: {
          id: index + 1,
          title: 'keep match',
          member: 'alice',
          created: '2026-09-01T00:00:00.000Z',
          replies: 0
        }
      }));
      const fetcher = async (input: string) => {
        const url = new URL(input);
        if (url.pathname === '/session/csrf.json') return Response.json({ csrf: 'fixture-token' });
        if (url.hostname === 'linux.do') {
          const offset = (Number(url.searchParams.get('page')) - 1) * 50;
          return Response.json({
            topics: hits.slice(offset, offset + 50).map(({ _source: hit }) => ({
              id: hit.id,
              title: hit.title,
              created_at: hit.created,
              posts_count: 1
            })),
            grouped_search_result: { more_full_page_results: offset + 50 < hits.length }
          });
        }
        const from = Number(url.searchParams.get('from'));
        const size = Number(url.searchParams.get('size'));
        return Response.json({ hits: hits.slice(from, from + size), total: hits.length });
      };
      const ids: string[] = [];
      let page: number | null = 1;
      for (let request = 0; page !== null && request < hits.length + 1; request += 1) {
        const result = await searchTopics({
          source,
          query: 'keep -excluded',
          limit: 2,
          page,
          fetcher,
          discourseAuth: { authenticated: true, userAgent: 'fixture' }
        });
        ids.push(...result.items.map((item) => item.id));
        page = result.hasMore ? (result.nextPage ?? null) : null;
      }
      expect(page).toBeNull();
      expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    }
  );

  it('stops on an empty V2EX search page even if the cached total is larger than its offset', async () => {
    const result = await searchTopics({
      source: 'v2ex',
      query: 'match',
      page: 2,
      limit: 10,
      fetcher: async () => Response.json({ hits: { total: 200, hits: [] } })
    });
    expect(result).toMatchObject({ items: [], hasMore: false, nextPage: null });
  });
});
