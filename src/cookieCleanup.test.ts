import { describe, expect, it, vi } from 'vitest';
import { clearCookieUrls } from './cookieCleanup';

describe('cookie cleanup helpers', () => {
  it('expires only cookies visible from the provided urls', async () => {
    const store = {
      get: vi.fn(async (url: string) => (
        url.includes('nodeseek.com')
          ? {
            session: { name: 'session', value: 'a' },
            user: { name: 'user', value: 'b' }
          }
          : {
            yh_sid: { name: 'yh_sid', value: 'c' }
          }
      )),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await clearCookieUrls(store, ['https://www.nodeseek.com']);

    expect(store.get).toHaveBeenCalledWith('https://www.nodeseek.com');
    expect(store.setFromResponse).toHaveBeenCalledTimes(2);
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^session=; .*Max-Age=0; Path=\/$/));
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^user=; .*Max-Age=0; Path=\/$/));
    expect(store.setFromResponse).not.toHaveBeenCalledWith('https://yaohuo.me', expect.any(String));
    expect(store.flush).toHaveBeenCalledTimes(1);
  });

  it('can expire only named cookies while preserving verification cookies', async () => {
    const cookies = {
      cf_clearance: { name: 'cf_clearance', value: 'keep' },
      session: { name: 'session', value: 'delete' },
      sid: { name: 'sid', value: 'delete' }
    };
    const store = {
      get: vi.fn(async () => cookies),
      setFromResponse: vi.fn(async (_url: string, header: string) => {
        const name = header.slice(0, header.indexOf('='));
        delete cookies[name as keyof typeof cookies];
        return true;
      }),
      flush: vi.fn(async () => undefined)
    };

    await clearCookieUrls(store, ['https://www.nodeseek.com'], ['session', 'sid']);

    expect(store.setFromResponse).toHaveBeenCalledTimes(2);
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^session=;/));
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^sid=;/));
    expect(store.setFromResponse).not.toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^cf_clearance=;/));
  });

  it('[REG-ACCOUNT-022] expires host-only and domain-scoped variants of a named login cookie', async () => {
    const store = {
      get: vi.fn(async () => ({})),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await clearCookieUrls(
      store,
      ['https://nodeseek.com'],
      ['session'],
      () => true,
      { domains: ['nodeseek.com'] }
    );

    expect(store.setFromResponse.mock.calls).toEqual([
      ['https://nodeseek.com', expect.stringMatching(/^session=; .*Path=\/$/)],
      ['https://nodeseek.com', expect.stringMatching(/^session=; Domain=nodeseek\.com; .*Path=\/$/)]
    ]);
  });

  it('[REG-ACCOUNT-022] rejects a targeted cleanup when the cookie is still visible after flush', async () => {
    const store = {
      get: vi.fn(async () => ({ session: { name: 'session', value: 'still-present' } })),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(
      store,
      ['https://nodeseek.com'],
      ['session'],
      () => true,
      { domains: ['nodeseek.com'] }
    )).rejects.toThrow('Cookie 删除未确认');
  });

  it('[REG-ACCOUNT-015] clears cookies from reachable urls even when another cookie store read fails', async () => {
    const store = {
      get: vi.fn(async (url: string) => {
        if (url.includes('www.')) {
          throw new Error('primary cookie store unavailable');
        }
        return { session: { name: 'session', value: 'delete' } };
      }),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(store, [
      'https://www.nodeseek.com',
      'https://nodeseek.com'
    ])).rejects.toThrow('primary cookie store unavailable');

    expect(store.setFromResponse).toHaveBeenCalledWith(
      'https://nodeseek.com',
      expect.stringMatching(/^session=;/)
    );
    expect(store.flush).toHaveBeenCalledTimes(1);
  });

  it('[REG-ACCOUNT-015] flushes successful cookie deletions before reporting another deletion failure', async () => {
    const store = {
      get: vi.fn(async () => ({
        session: { name: 'session', value: 'delete' },
        user: { name: 'user', value: 'delete' }
      })),
      setFromResponse: vi.fn(async (_url: string, cookie: string) => {
        if (cookie.startsWith('session=')) {
          throw new Error('session deletion failed');
        }
        return true;
      }),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(store, ['https://www.nodeseek.com'])).rejects.toThrow('session deletion failed');

    expect(store.setFromResponse).toHaveBeenCalledTimes(2);
    expect(store.flush).toHaveBeenCalledTimes(1);
  });

  it('[REG-ACCOUNT-015] treats an unconfirmed native cookie deletion as a cleanup failure', async () => {
    const store = {
      get: vi.fn(async () => ({ session: { name: 'session', value: 'delete' } })),
      setFromResponse: vi.fn(async () => false),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(store, ['https://www.nodeseek.com'])).rejects.toThrow('Cookie 删除未确认');
    expect(store.setFromResponse).toHaveBeenCalledTimes(1);
    expect(store.flush).toHaveBeenCalledTimes(1);
  });
});
