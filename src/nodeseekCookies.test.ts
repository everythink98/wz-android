import { describe, expect, it } from 'vitest';
import {
  buildCookieHeader,
  canStoreNodeSeekCookieHeader,
  hasNodeSeekLoginCookie,
  mergeNodeSeekCookies,
  summarizeNodeSeekCookies,
  type NativeCookie
} from './nodeseekCookies';

describe('NodeSeek cookie helpers', () => {
  it('detects a NodeSeek login cookie', () => {
    const cookies: Record<string, NativeCookie> = {
      session: {
        name: 'session',
        value: 'abc',
        domain: 'www.nodeseek.com'
      }
    };

    expect(hasNodeSeekLoginCookie(cookies)).toBe(true);
  });

  it('detects a scoped login cookie when CookieManager omits the domain', () => {
    const cookies: Record<string, NativeCookie> = {
      session: {
        name: 'session',
        value: 'abc'
      }
    };

    expect(hasNodeSeekLoginCookie(cookies)).toBe(true);
  });

  it('ignores unrelated cookies and empty values', () => {
    const cookies: Record<string, NativeCookie> = {
      other: {
        name: 'other',
        value: '',
        domain: 'www.nodeseek.com'
      },
      linux: {
        name: 'session',
        value: 'abc',
        domain: 'linux.do'
      }
    };

    expect(hasNodeSeekLoginCookie(cookies)).toBe(false);
  });

  it('builds a cookie header without exposing empty cookies', () => {
    const cookies: Record<string, NativeCookie> = {
      session: {
        name: 'session',
        value: 'abc',
        domain: 'www.nodeseek.com'
      },
      empty: {
        name: 'empty',
        value: '',
        domain: 'www.nodeseek.com'
      }
    };

    expect(buildCookieHeader(cookies)).toBe('session=abc');
  });

  it('allows storing unknown cookie names only when the page confirms login', () => {
    const cookies: Record<string, NativeCookie> = {
      ns: {
        name: 'ns',
        value: 'abc',
        domain: 'www.nodeseek.com'
      }
    };

    expect(canStoreNodeSeekCookieHeader(cookies)).toBe(false);
    expect(canStoreNodeSeekCookieHeader(cookies, true)).toBe(true);
  });

  it('merges cookies read from both NodeSeek hostnames', () => {
    expect(mergeNodeSeekCookies(
      {
        a: {
          name: 'a',
          value: '1'
        }
      },
      {
        b: {
          name: 'b',
          value: '2'
        }
      }
    )).toEqual({
      a: {
        name: 'a',
        value: '1'
      },
      b: {
        name: 'b',
        value: '2'
      }
    });
  });

  it('summarizes cookies without returning values', () => {
    const summary = summarizeNodeSeekCookies({
      session: {
        name: 'session',
        value: 'abc',
        domain: 'www.nodeseek.com'
      }
    });

    expect(summary).toEqual({
      count: 1,
      names: ['session'],
      loggedIn: true
    });
  });
});
