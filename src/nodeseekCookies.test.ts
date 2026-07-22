import { describe, expect, it } from 'vitest';
import {
  buildCookieHeader,
  canStoreNodeSeekCookieHeader,
  hasNodeSeekLoginCookie,
  mergeNodeSeekCookies,
  nodeSeekBrowserCookieHeaderForPersistence,
  nodeSeekAccessRecord,
  nodeSeekCredentialUserId,
  nodeSeekCsrfTokenFromHtml,
  nodeSeekUserIdFromCookies,
  parseNodeSeekDocumentCookie,
  parseNodeSeekAccessRecord,
  removeNodeSeekLoginCookies,
  sanitizeNodeSeekUserAgent,
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

  it('detects known NodeSeek login cookie aliases without broad token names', () => {
    const cookies: Record<string, NativeCookie> = {
      connect: {
        name: 'connect.sid',
        value: 'abc',
        domain: 'www.nodeseek.com'
      },
      tokenHint: {
        name: 'user_token_hint',
        value: 'secret',
        domain: 'www.nodeseek.com'
      }
    };

    expect(hasNodeSeekLoginCookie(cookies)).toBe(true);
    expect(buildCookieHeader(cookies)).toBe('connect.sid=abc');
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

  it('does not store unknown cookie names even when the page confirms login', () => {
    const cookies: Record<string, NativeCookie> = {
      ns: {
        name: 'ns',
        value: 'abc',
        domain: 'www.nodeseek.com'
      }
    };

    expect(canStoreNodeSeekCookieHeader(cookies)).toBe(false);
    expect(canStoreNodeSeekCookieHeader(cookies, true)).toBe(false);
  });

  it('does not persist broad token-like NodeSeek cookie names', () => {
    const cookies: Record<string, NativeCookie> = {
      user_token_hint: {
        name: 'user_token_hint',
        value: 'abc',
        domain: 'www.nodeseek.com'
      }
    };

    expect(hasNodeSeekLoginCookie(cookies)).toBe(false);
    expect(buildCookieHeader(cookies)).toBe('');
  });

  it('reads the current user id from NodeSeek pjwt without persisting pjwt as an action cookie', () => {
    const payload = Buffer.from(JSON.stringify({ id: 54874, name: '凡想世界' }), 'utf8').toString('base64url');
    const cookies: Record<string, NativeCookie> = {
      pjwt: {
        name: 'pjwt',
        value: `${payload}.signature`,
        domain: 'www.nodeseek.com'
      },
      session: {
        name: 'session',
        value: 'abc',
        domain: 'www.nodeseek.com'
      }
    };

    expect(nodeSeekUserIdFromCookies(cookies)).toBe(54874);
    expect(buildCookieHeader(cookies)).toBe('session=abc');
  });

  it('does not use a saved NodeSeek id when current login cookies do not expose an id', () => {
    const savedPayload = Buffer.from(JSON.stringify({ id: 15105 }), 'utf8').toString('base64url');

    expect(nodeSeekCredentialUserId(
      { session: { name: 'session', value: 'current', domain: 'www.nodeseek.com' } },
      { pjwt: { name: 'pjwt', value: `${savedPayload}.signature`, domain: 'www.nodeseek.com' } },
      15105
    )).toBeNull();
  });

  it('uses the saved NodeSeek id only when there is no current login cookie', () => {
    expect(nodeSeekCredentialUserId(
      {},
      { session: { name: 'session', value: 'saved', domain: 'www.nodeseek.com' } },
      15105
    )).toBe(15105);
  });

  it('allows storing Cloudflare clearance cookies from NodeSeek verification', () => {
    const cookies: Record<string, NativeCookie> = {
      cf_clearance: {
        name: 'cf_clearance',
        value: 'clearance',
        domain: '.nodeseek.com'
      }
    };

    expect(canStoreNodeSeekCookieHeader(cookies)).toBe(true);
  });

  it('reads NodeSeek verification cookies from document.cookie fallback data', () => {
    const cookies = parseNodeSeekDocumentCookie('theme=dark; cf_clearance=clearance; session=abc');

    expect(buildCookieHeader(cookies)).toBe('cf_clearance=clearance; session=abc');
    expect(canStoreNodeSeekCookieHeader(cookies)).toBe(true);
  });

  it('does not persist Google cookies collected during NodeSeek browser fallback', () => {
    expect(nodeSeekBrowserCookieHeaderForPersistence(
      'https://www.google.com/search?q=site%3Anodeseek.com+login',
      'SID=google; cf_clearance=google-clearance'
    )).toBe('');
    expect(nodeSeekBrowserCookieHeaderForPersistence(
      'https://www.nodeseek.com/search?q=login',
      'session=abc; cf_clearance=clearance'
    )).toBe('session=abc; cf_clearance=clearance');
  });

  it('can remove login cookies without deleting Cloudflare verification', () => {
    const cookies = parseNodeSeekDocumentCookie('cf_clearance=clearance; session=abc; theme=dark');

    expect(buildCookieHeader(removeNodeSeekLoginCookies(cookies))).toBe('cf_clearance=clearance');
  });

  it('[REG-VERIFICATION-003] preserves the WebView identity used for NodeSeek verification', () => {
    expect(sanitizeNodeSeekUserAgent('  Mozilla/5.0 (Linux; Android 15; wv)   Version/4.0 Chrome/124 Mobile Safari/537.36  ')).toBe(
      'Mozilla/5.0 (Linux; Android 15; wv) Version/4.0 Chrome/124 Mobile Safari/537.36'
    );
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

  it('parses a combined NodeSeek access record without changing its WebView identity', () => {
    expect(parseNodeSeekAccessRecord(JSON.stringify({
      cookieHeader: 'session=abc',
      userAgent: 'Mozilla/5.0 (Linux; Android 15; wv) Version/4.0 Chrome/124 Mobile Safari/537.36',
      userId: 48872,
      csrfToken: ' page-csrf ',
      savedAt: '2026-06-21T00:00:00.000Z',
      source: 'webview'
    }))).toEqual({
      cookieHeader: 'session=abc',
      userAgent: 'Mozilla/5.0 (Linux; Android 15; wv) Version/4.0 Chrome/124 Mobile Safari/537.36',
      userId: 48872,
      csrfToken: 'page-csrf',
      savedAt: '2026-06-21T00:00:00.000Z',
      source: 'webview'
    });
  });

  it('stores a NodeSeek access csrf token separately from cookies', () => {
    expect(nodeSeekAccessRecord(
      'session=abc',
      'Mozilla/5.0',
      48872,
      ' page-csrf '
    )).toMatchObject({
      cookieHeader: 'session=abc',
      userId: 48872,
      csrfToken: 'page-csrf'
    });
  });

  it('reads NodeSeek csrf token from rendered page html', () => {
    expect(nodeSeekCsrfTokenFromHtml('<html><head><meta name="csrf-token" content="page-csrf"></head></html>')).toBe('page-csrf');
    expect(nodeSeekCsrfTokenFromHtml('<meta content="next-csrf" name="csrf-token">')).toBe('next-csrf');
  });
});
