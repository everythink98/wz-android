import { describe, expect, it, vi } from 'vitest';

import { searchLinuxDo } from './search';

function searchResponse() {
  return new Response(JSON.stringify({ topics: [], posts: [], users: [], grouped_search_result: {} }), {
    headers: { 'content-type': 'application/json' }
  });
}

function pagedSearch(dropped: ReadonlySet<number> = new Set()) {
  const requests: number[] = [];
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === '/session/csrf.json') return Response.json({ csrf: 'page-token' });
    if (url.origin !== 'https://linux.do' || !['/search', '/search.json'].includes(url.pathname))
      throw new Error(`Unexpected local search request: ${url.pathname}`);
    const page = Number(url.searchParams.get('page'));
    if (!Number.isSafeInteger(page) || page < 1 || page > 4) throw new Error('Unexpected upstream search page');
    requests.push(page);
    return Response.json({
      topics: Array.from({ length: 50 }, (_, index) => {
        const id = (page - 1) * 50 + index + 1;
        return {
          ...(dropped.has(id) ? {} : { id }),
          slug: `topic-${id}`,
          title: `Topic ${id}`,
          created_at: '2026-08-15T00:00:00.000Z',
          posts_count: 1
        };
      }),
      posts: [],
      users: [],
      grouped_search_result: { more_full_page_results: page < 4 }
    });
  });
  const read = (page: number, limit: number) =>
    searchLinuxDo('pagination', {
      fetcher,
      limit,
      page,
      linuxDoAccess: { authenticated: true, userAgent: 'LinuxDo WebView UA' }
    });
  return { requests, read };
}

describe('linux.do search', () => {
  it.each([undefined, {}, { authenticated: false }])(
    'refuses search without authenticated proof %j before transport',
    async (linuxDoAccess) => {
      const fetcher = vi.fn();

      await expect(searchLinuxDo('performance', { fetcher, linuxDoAccess })).rejects.toMatchObject({
        kind: 'login-required',
        source: 'linuxdo'
      });
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it('does not reuse a CSRF token after the authenticated transport changes', async () => {
    const firstFetcher = vi.fn(async (input: string, _init?: RequestInit) =>
      input.endsWith('/session/csrf.json')
        ? new Response(JSON.stringify({ csrf: 'first-account-token' }))
        : searchResponse()
    );
    const secondFetcher = vi.fn(async (input: string, _init?: RequestInit) =>
      input.endsWith('/session/csrf.json')
        ? new Response(JSON.stringify({ csrf: 'second-account-token' }))
        : searchResponse()
    );
    const access = { authenticated: true, userAgent: 'LinuxDo WebView UA' };

    await searchLinuxDo('first account', { fetcher: firstFetcher, linuxDoAccess: access });
    await searchLinuxDo('second account', { fetcher: secondFetcher, linuxDoAccess: access });

    expect(secondFetcher).toHaveBeenCalledTimes(2);
    expect(secondFetcher.mock.calls[0]?.[0]).toBe('https://linux.do/session/csrf.json');
    expect(new Headers(secondFetcher.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe('second-account-token');
  });

  it('trusts the search cursor instead of probing one extra result', async () => {
    const topics = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      slug: `topic-${index + 1}`,
      title: `Topic ${index + 1}`,
      created_at: '2026-08-15T00:00:00.000Z',
      posts_count: 1
    }));
    const fetcher = vi.fn(async (input: string) =>
      input.endsWith('/session/csrf.json')
        ? new Response(JSON.stringify({ csrf: 'token' }))
        : new Response(
            JSON.stringify({
              topics,
              posts: [],
              users: [],
              grouped_search_result: { more_full_page_results: true }
            })
          )
    );

    const result = await searchLinuxDo('performance', {
      fetcher,
      limit: 30,
      linuxDoAccess: { authenticated: true, userAgent: 'LinuxDo WebView UA' }
    });

    expect(result.items).toHaveLength(30);
    expect(result).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([30, 50])('preserves raw search windows and their requests when all rows parse (limit %s)', async (limit) => {
    const source = pagedSearch();
    for (const page of [1, 2, 3, 4]) {
      const result = await source.read(page, limit);
      expect(result.items.map((topic) => Number(topic.id))).toEqual(
        Array.from({ length: limit }, (_, index) => (page - 1) * limit + index + 1)
      );
      expect(result).toMatchObject({ hasMore: page * limit < 200, nextPage: page * limit < 200 ? page + 1 : null });
    }
    expect(source.requests).toEqual(limit === 30 ? [1, 1, 2, 2, 2, 3] : [1, 2, 3, 4]);
  });

  it.each([30, 50])(
    'consumes malformed rows in their raw search window without overlapping later pages (limit %s)',
    async (limit) => {
      const dropped = new Set([1, 12, 25]);
      const source = pagedSearch(dropped);
      const ids: number[] = [];
      for (const page of [1, 2, 3, 4]) {
        const result = await source.read(page, limit);
        const pageIds = result.items.map((topic) => Number(topic.id));
        expect(pageIds).toEqual(
          Array.from({ length: limit }, (_, index) => (page - 1) * limit + index + 1).filter((id) => !dropped.has(id))
        );
        ids.push(...pageIds);
        expect(result).toMatchObject({ hasMore: page * limit < 200, nextPage: page * limit < 200 ? page + 1 : null });
      }
      expect(ids).toEqual(Array.from({ length: limit * 4 }, (_, index) => index + 1).filter((id) => !dropped.has(id)));
      expect(new Set(ids).size).toBe(ids.length);
      expect(source.requests).toEqual(limit === 30 ? [1, 1, 2, 2, 2, 3] : [1, 2, 3, 4]);
    }
  );

  it.each([30, 50])(
    'continues after a completely malformed raw window without filling from the next window (limit %s)',
    async (limit) => {
      const source = pagedSearch(new Set(Array.from({ length: limit }, (_, index) => index + 1)));
      await expect(source.read(1, limit)).resolves.toMatchObject({ items: [], hasMore: true, nextPage: 2 });
      expect(source.requests).toEqual([1]);
      const next = await source.read(2, limit);
      expect(next.items.map((topic) => Number(topic.id))).toEqual(
        Array.from({ length: limit }, (_, index) => limit + index + 1)
      );
    }
  );

  it('ends at an exhausted raw tail even when every returned row is malformed', async () => {
    const source = pagedSearch(new Set(Array.from({ length: 20 }, (_, index) => 181 + index)));
    await expect(source.read(7, 30)).resolves.toMatchObject({ items: [], hasMore: false, nextPage: null });
    expect(source.requests).toEqual([4]);
  });

  it('retains fractional Array.slice endpoints without fetching past the requested raw interval', async () => {
    const source = pagedSearch();
    expect((await source.read(1, 2.5)).items.map((topic) => topic.id)).toEqual(['1', '2']);
    expect((await source.read(2, 2.5)).items.map((topic) => topic.id)).toEqual(['3', '4', '5']);
    expect(source.requests).toEqual([1, 1]);
  });

  it('retains a nonfinite raw interval without dispatching a search request', async () => {
    for (const options of [
      { page: Infinity, limit: 30 },
      { page: 1, limit: Infinity }
    ]) {
      const fetcher = vi.fn(async (input: string) =>
        input.endsWith('/session/csrf.json') ? Response.json({ csrf: 'number-token' }) : searchResponse()
      );
      await expect(
        searchLinuxDo('number boundary', {
          ...options,
          fetcher,
          linuxDoAccess: { authenticated: true, userAgent: 'LinuxDo WebView UA' }
        })
      ).resolves.toMatchObject({ items: [], hasMore: false, nextPage: null });
      expect.soft(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![0]).toBe('https://linux.do/session/csrf.json');
    }
  });

  it('extracts raw search blurb HTML once while keeping already-normalized topic excerpts and plain titles un-decoded', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.endsWith('/session/csrf.json')
        ? Response.json({ csrf: 'blurb-token' })
        : Response.json({
            topics: [
              {
                id: 501,
                slug: 'blurb-topic',
                title: 'Plain &copy; &amp; &#128; title',
                created_at: '2026-08-15T00:00:00.000Z',
                posts_count: 1,
                excerpt: '<p>ignored fallback</p>'
              },
              {
                id: 502,
                slug: 'excerpt-fallback-topic',
                fancy_title: '&#128; &#0; &#x1F600 &Lt; &Gt; &unknownref; &amp;copy;',
                created_at: '2026-08-15T00:00:00.000Z',
                posts_count: 1,
                excerpt: '<p>&amp;copy; &amp;lt;tag&amp;gt; &#128; &#x1F600 &Lt; &Gt; &unknownref;</p>'
              }
            ],
            posts: [
              {
                topic_id: 501,
                blurb: '<span class="search-highlight">&amp;copy;</span> &#128; &#0; &#x1F600 &Lt; &Gt; &unknownref;'
              }
            ],
            users: [],
            grouped_search_result: { more_full_page_results: false }
          })
    );

    const result = await searchLinuxDo('copy', {
      fetcher,
      limit: 30,
      linuxDoAccess: { authenticated: true, userAgent: 'LinuxDo WebView UA' }
    });

    expect(result.items[0]).toMatchObject({
      id: '501',
      title: 'Plain &copy; &amp; &#128; title',
      excerpt: '&copy; € \uFFFD 😀 ≪ ≫ &unknownref;'
    });
    expect(result.items[1]).toMatchObject({
      id: '502',
      title: '€ \uFFFD 😀 ≪ ≫ &unknownref; &copy;',
      excerpt: '&copy; &lt;tag&gt; € 😀 ≪ ≫ &unknownref;'
    });
  });

  it('decodes data-preloaded attribute JSON once without double-decoding embedded HTML entity text', async () => {
    const { linuxDoPreloadedData } = await import('./preloadedData');
    const encodedPayload = JSON.stringify({
      topic: JSON.stringify({ title: 'Literal &copy; &amp;copy; title' })
    })
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
    const parsed = linuxDoPreloadedData(`<div id="data-preloaded" data-preloaded="${encodedPayload}"></div>`);
    expect(JSON.parse(String(parsed.topic))).toEqual({ title: 'Literal &copy; &amp;copy; title' });
  });
});
