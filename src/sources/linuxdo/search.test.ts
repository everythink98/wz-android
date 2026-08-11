import { describe, expect, it, vi } from 'vitest';

import { searchLinuxDo } from './search';

function searchResponse() {
  return new Response(JSON.stringify({ topics: [], posts: [], users: [], grouped_search_result: {} }), {
    headers: { 'content-type': 'application/json' }
  });
}

describe('linux.do search', () => {
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
});
