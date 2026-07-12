import { describe, expect, it, vi } from 'vitest';
import { clearCookieUrls } from './cookieCleanup';

describe('cookie cleanup helpers', () => {
  it('expires only cookies visible from the provided urls', async () => {
    let readCount = 0;
    const store = {
      get: vi.fn(async (url: string) => {
        readCount += 1;
        return readCount === 1 && url.includes('nodeseek.com')
          ? {
            session: { name: 'session', value: 'a' },
            user: { name: 'user', value: 'b' }
          }
          : {};
      }),
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
    let readCount = 0;
    const store = {
      get: vi.fn(async () => {
        readCount += 1;
        return readCount === 1 ? {
          cf_clearance: { name: 'cf_clearance', value: 'keep' },
          session: { name: 'session', value: 'delete' },
          sid: { name: 'sid', value: 'delete' }
        } : { cf_clearance: { name: 'cf_clearance', value: 'keep' } };
      }),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await clearCookieUrls(store, ['https://www.nodeseek.com'], ['session', 'sid']);

    expect(store.setFromResponse).toHaveBeenCalledTimes(2);
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^session=;/));
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^sid=;/));
    expect(store.setFromResponse).not.toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^cf_clearance=;/));
  });

  it('rejects cleanup when the native cookie store reports a failed expiry', async () => {
    const store = {
      get: vi.fn(async () => ({ session: { name: 'session' } })),
      setFromResponse: vi.fn(async () => false),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(store, ['https://www.nodeseek.com'])).rejects.toThrow('Cookie 清理失败');

    expect(store.flush).toHaveBeenCalledTimes(1);
  });

  it('rejects cleanup when an accepted expiry leaves the old cookie readable', async () => {
    const store = {
      get: vi.fn(async () => ({ session: { name: 'session', value: 'old-login' } })),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(store, ['https://www.nodeseek.com'])).rejects.toThrow('Cookie 清理失败');

    expect(store.get).toHaveBeenCalledTimes(2);
  });

  it('does not expire a cookie that changed after the cleanup snapshot was captured', async () => {
    const store = {
      get: vi.fn(async () => ({
        session: { name: 'session', value: 'new-login' },
        companion: { name: 'companion', value: 'unchanged' }
      })),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(
      store,
      ['https://www.nodeseek.com'],
      ['session', 'companion'],
      { session: 'expired-login', companion: 'unchanged' }
    )).resolves.toBe(false);

    expect(store.setFromResponse).not.toHaveBeenCalled();
    expect(store.flush).toHaveBeenCalledTimes(1);
  });

  it('does not expire the remaining cookie when an expected cookie disappeared across all urls', async () => {
    const store = {
      get: vi.fn(async (url: string) => url.includes('www.')
        ? { companion: { name: 'companion', value: 'unchanged' } }
        : {}),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await expect(clearCookieUrls(
      store,
      ['https://www.nodeseek.com', 'https://nodeseek.com'],
      ['session', 'companion'],
      { session: 'expired-login', companion: 'unchanged' }
    )).resolves.toBe(false);

    expect(store.setFromResponse).not.toHaveBeenCalled();
    expect(store.flush).toHaveBeenCalledTimes(1);
  });
});
