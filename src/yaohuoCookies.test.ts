import { describe, expect, it } from 'vitest';
import {
  buildYaohuoCookieHeader,
  buildYaohuoSetCookieHeaders,
  canStoreYaohuoCookieHeader,
  mergeYaohuoCookies,
  summarizeYaohuoCookies,
  yaohuoCookieMapFromHeader,
  type YaohuoNativeCookie
} from './yaohuoCookies';

describe('yaohuo cookie helpers', () => {
  it('detects sidyaohuo as the yaohuo login cookie', () => {
    const cookies: Record<string, YaohuoNativeCookie> = {
      sidyaohuo: {
        name: 'sidyaohuo',
        value: 'abc',
        domain: 'yaohuo.me'
      }
    };

    expect(summarizeYaohuoCookies(cookies).loggedIn).toBe(true);
    expect(canStoreYaohuoCookieHeader(cookies)).toBe(true);
  });

  it('allows session cookies to reach the real yaohuo login check', () => {
    const cookies: Record<string, YaohuoNativeCookie> = {
      asp: { name: 'ASP.NET_SessionId', value: 'session', domain: 'yaohuo.me' },
      guid: { name: 'GUID', value: 'guid', domain: 'yaohuo.me' }
    };

    expect(summarizeYaohuoCookies(cookies).loggedIn).toBe(false);
    expect(buildYaohuoCookieHeader(cookies)).toBe('ASP.NET_SessionId=session; GUID=guid');
    expect(canStoreYaohuoCookieHeader(cookies)).toBe(true);
  });

  it('keeps yaohuo session cookies and drops unrelated domains or empty values', () => {
    const cookies: Record<string, YaohuoNativeCookie> = {
      sidyaohuo: { name: 'sidyaohuo', value: 'abc', domain: '.yaohuo.me' },
      asp: { name: 'ASP.NET_SessionId', value: 'session', domain: 'www.yaohuo.me' },
      guid: { name: 'GUID', value: 'guid', domain: 'yaohuo.me' },
      empty: { name: 'empty', value: '', domain: 'yaohuo.me' },
      other: { name: 'sidyaohuo', value: 'wrong', domain: 'example.com' }
    };

    expect(buildYaohuoCookieHeader(cookies)).toBe('ASP.NET_SessionId=session; GUID=guid; sidyaohuo=abc');
  });

  it('summarizes yaohuo cookies without returning values', () => {
    const summary = summarizeYaohuoCookies({
      sidyaohuo: { name: 'sidyaohuo', value: 'secret', domain: 'yaohuo.me' },
      guid: { name: 'GUID', value: 'guid', domain: 'yaohuo.me' }
    });

    expect(summary).toEqual({
      count: 2,
      names: ['GUID', 'sidyaohuo'],
      loggedIn: true
    });
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  it('merges cookies read from both yaohuo hostnames', () => {
    expect(mergeYaohuoCookies(
      { sidyaohuo: { name: 'sidyaohuo', value: 'abc' } },
      { guid: { name: 'GUID', value: 'guid' } }
    )).toEqual({
      sidyaohuo: { name: 'sidyaohuo', value: 'abc' },
      guid: { name: 'GUID', value: 'guid' }
    });
  });

  it('builds Set-Cookie headers from saved yaohuo cookies for WebView reuse', () => {
    expect(buildYaohuoSetCookieHeaders('sidyaohuo=abc; GUID=guid; bad=value; ASP.NET_SessionId=session')).toEqual([
      'ASP.NET_SessionId=session; Domain=yaohuo.me; Path=/',
      'GUID=guid; Domain=yaohuo.me; Path=/',
      'sidyaohuo=abc; Domain=yaohuo.me; Path=/'
    ]);
  });

  it('parses saved yaohuo cookie headers into the shared native cookie shape', () => {
    expect(yaohuoCookieMapFromHeader('sidyaohuo=abc; bad=value; GUID=guid')).toEqual({
      GUID: { name: 'GUID', value: 'guid', domain: 'yaohuo.me' },
      sidyaohuo: { name: 'sidyaohuo', value: 'abc', domain: 'yaohuo.me' }
    });
  });
});
