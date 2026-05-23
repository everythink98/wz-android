import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import {
  buildLinuxDoCookieHeader,
  canStoreLinuxDoClearance,
  isCloudflareChallengeResponse,
  linuxDoClearanceCookieFromValue,
  linuxDoCookieModuleFromReactNativeImport,
  mergeLinuxDoCookies,
  parseLinuxDoDocumentCookie,
  readLinuxDoCookiesFromStores,
  sanitizeLinuxDoUserAgent,
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

  it('uses a browser-like user agent for linux.do verification', () => {
    const webViewUserAgent = 'Mozilla/5.0 (Linux; Android 15; sdk_gphone64_x86_64 Build/AP31.240322.027; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36';

    const userAgent = sanitizeLinuxDoUserAgent(webViewUserAgent);

    expect(userAgent).not.toContain('; wv');
    expect(userAgent).not.toContain('Version/4.0');
    expect(userAgent).toContain('Chrome/124.0.6367.219 Mobile Safari/537.36');
  });

  it('reads cf_clearance from document.cookie fallback data', () => {
    const cookies = parseLinuxDoDocumentCookie('_ga=analytics; cf_clearance=secret%3Dvalue; theme=light');

    expect(canStoreLinuxDoClearance(cookies)).toBe(true);
    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=secret%3Dvalue');
  });

  it('converts the Android WebView cookie store clearance value into a linux.do cookie', () => {
    const cookies = linuxDoClearanceCookieFromValue(' native-secret ');

    expect(canStoreLinuxDoClearance(cookies)).toBe(true);
    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=native-secret');
    expect(linuxDoClearanceCookieFromValue('')).toEqual({});
  });

  it('uses the Android WebView cookie store before CookieManager when clearance is present', async () => {
    const readCookieManagerStore = vi.fn(async () => {
      throw new Error('CookieManager should not be required when the Android store has clearance');
    });

    const cookies = await readLinuxDoCookiesFromStores({
      readAndroidStore: async () => linuxDoClearanceCookieFromValue('native-secret'),
      readCookieManagerStore,
      timeoutMs: 1
    });

    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=native-secret');
    expect(readCookieManagerStore).not.toHaveBeenCalled();
  });

  it('supports React Native dynamic imports that expose NativeModules on default', () => {
    const getClearance = async () => 'native-secret';

    const module = linuxDoCookieModuleFromReactNativeImport({
      default: { NativeModules: { LinuxDoCookieModule: { getClearance } } }
    });

    expect(module?.getClearance).toBe(getClearance);
  });
});
