import { describe, expect, it, vi } from 'vitest';

import { searchLinuxDo } from './search';

function searchResponse() {
  return new Response(JSON.stringify({ topics: [], posts: [], users: [], grouped_search_result: {} }), {
    headers: { 'content-type': 'application/json' }
  });
}

describe('linux.do search', () => {
  it('[REG-SEARCH-028] refuses anonymous adapter search without a transport call', async () => {
    const fetcher = vi.fn();

    await expect(searchLinuxDo('performance', { fetcher })).rejects.toMatchObject({
      kind: 'login-required',
      source: 'linuxdo'
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

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

    await searchLinuxDo('first account', { authenticated: true, fetcher: firstFetcher, linuxDoAccess: access });
    await searchLinuxDo('second account', { authenticated: true, fetcher: secondFetcher, linuxDoAccess: access });

    expect(secondFetcher).toHaveBeenCalledTimes(2);
    expect(secondFetcher.mock.calls[0]?.[0]).toBe('https://linux.do/session/csrf.json');
    expect(new Headers(secondFetcher.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe('second-account-token');
  });

  it('[REG-PERF-016] trusts the search cursor instead of probing one extra result', async () => {
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
      authenticated: true,
      fetcher,
      limit: 30,
      linuxDoAccess: { authenticated: true, userAgent: 'LinuxDo WebView UA' }
    });

    expect(result.items).toHaveLength(30);
    expect(result).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
