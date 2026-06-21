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
    const store = {
      get: vi.fn(async () => ({
        cf_clearance: { name: 'cf_clearance', value: 'keep' },
        session: { name: 'session', value: 'delete' },
        sid: { name: 'sid', value: 'delete' }
      })),
      setFromResponse: vi.fn(async () => true),
      flush: vi.fn(async () => undefined)
    };

    await clearCookieUrls(store, ['https://www.nodeseek.com'], ['session', 'sid']);

    expect(store.setFromResponse).toHaveBeenCalledTimes(2);
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^session=;/));
    expect(store.setFromResponse).toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^sid=;/));
    expect(store.setFromResponse).not.toHaveBeenCalledWith('https://www.nodeseek.com', expect.stringMatching(/^cf_clearance=;/));
  });
});
