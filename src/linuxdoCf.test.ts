import { describe, expect, it } from 'vitest';
import {
  buildLinuxDoCookieHeader,
  canStoreLinuxDoClearance,
  isCloudflareChallengeResponse,
  mergeLinuxDoCookies,
  summarizeLinuxDoCookies
} from './linuxdoCookieBridge';

describe('linux.do Cloudflare helpers', () => {
  it('detects Cloudflare challenge responses but not ordinary errors', () => {
    expect(isCloudflareChallengeResponse(new Response('ok', { status: 403, headers: { 'cf-mitigated': 'challenge' } }))).toBe(true);
    expect(isCloudflareChallengeResponse({ status: 200, headers: new Headers(), bodyText: '<html>Just a moment cf-turnstile</html>' })).toBe(true);
    expect(isCloudflareChallengeResponse(new Response('ordinary forbidden', { status: 403 }))).toBe(false);
  });

  it('stores only cf_clearance and never exposes the value in summaries', () => {
    const cookies = mergeLinuxDoCookies({
      cf_clearance: { name: 'cf_clearance', value: 'secret', domain: '.linux.do' },
      _t: { name: '_t', value: 'login-secret', domain: '.linux.do' }
    });

    expect(canStoreLinuxDoClearance(cookies)).toBe(true);
    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=secret');
    expect(summarizeLinuxDoCookies(cookies)).toEqual({ names: ['cf_clearance'], hasClearance: true });
    expect(JSON.stringify(summarizeLinuxDoCookies(cookies))).not.toContain('secret');
  });

  it('rejects cf_clearance cookies from other domains', () => {
    const cookies = mergeLinuxDoCookies({
      cf_clearance: { name: 'cf_clearance', value: 'secret', domain: 'example.com' }
    });

    expect(canStoreLinuxDoClearance(cookies)).toBe(false);
    expect(buildLinuxDoCookieHeader(cookies)).toBe('');
  });
});
