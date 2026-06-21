import { describe, expect, it, vi } from 'vitest';
import CookieManager from '@react-native-cookies/cookies';
import * as SecureStore from 'expo-secure-store';

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
  canAcceptLinuxDoAccessUpdate,
  canStoreLinuxDoAccess,
  canStoreLinuxDoClearance,
  canStoreLinuxDoLogin,
  clearLinuxDoAccess,
  clearLinuxDoAccessForGeneration,
  clearLinuxDoWebViewClearance,
  clearLinuxDoSavedAccess,
  currentLinuxDoAccessGeneration,
  hasFreshLinuxDoClearance,
  isCloudflareChallengeResponse,
  linuxDoClearanceCookieFromValue,
  linuxDoCookieModuleFromReactNativeImport,
  mergeLinuxDoCookies,
  parseLinuxDoDocumentCookie,
  readLinuxDoCookiesFromStores,
  removeLinuxDoLoginCookies,
  sanitizeLinuxDoUserAgent,
  saveLinuxDoAccess,
  saveLinuxDoAccessForGeneration,
  summarizeLinuxDoCookies
} from './linuxdoCookieBridge';
import { isLinuxDoRequestUrl } from './linuxdoFetchFallback';

describe('linux.do Cloudflare helpers', () => {
  it('allows linux.do authenticated requests only over HTTPS on expected hosts', () => {
    expect(isLinuxDoRequestUrl('https://linux.do/latest.json')).toBe(true);
    expect(isLinuxDoRequestUrl('http://linux.do/latest.json')).toBe(false);
    expect(isLinuxDoRequestUrl('https://linux.do.evil.example/latest.json')).toBe(false);
    expect(isLinuxDoRequestUrl('https://evil.example@linux.do/latest.json')).toBe(false);
  });

  it('detects Cloudflare challenge responses but not ordinary errors', () => {
    expect(isCloudflareChallengeResponse(new Response('ok', { status: 403, headers: { 'cf-mitigated': 'challenge' } }))).toBe(true);
    expect(isCloudflareChallengeResponse({ status: 200, headers: new Headers(), bodyText: '<html>Just a moment cf-turnstile</html>' })).toBe(true);
    expect(isCloudflareChallengeResponse(new Response('ordinary forbidden', { status: 403 }))).toBe(false);
  });

  it('stores linux.do access cookies and never exposes values in summaries', () => {
    const cookies = mergeLinuxDoCookies({
      cf_clearance: { name: 'cf_clearance', value: 'secret', domain: '.linux.do' },
      _t: { name: '_t', value: 'login-secret', domain: '.linux.do' },
      _forum_session: { name: '_forum_session', value: 'session-secret', domain: '.linux.do' },
      analytics: { name: 'analytics', value: 'skip-me', domain: '.linux.do' }
    });

    expect(canStoreLinuxDoClearance(cookies)).toBe(true);
    expect(canStoreLinuxDoLogin(cookies)).toBe(true);
    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=secret; _t=login-secret; _forum_session=session-secret');
    expect(summarizeLinuxDoCookies(cookies)).toEqual({
      names: ['_forum_session', '_t', 'cf_clearance'],
      hasClearance: true,
      loggedIn: true
    });
    expect(JSON.stringify(summarizeLinuxDoCookies(cookies))).not.toContain('secret');
    expect(JSON.stringify(cookies)).not.toContain('skip-me');
  });

  it('requires cf_clearance before storing linux.do access for topic retries', () => {
    const cookies = parseLinuxDoDocumentCookie('_t=login; _forum_session=session');

    expect(canStoreLinuxDoLogin(cookies)).toBe(true);
    expect(canStoreLinuxDoClearance(cookies)).toBe(false);
    expect(canStoreLinuxDoAccess(cookies)).toBe(false);
  });

  it('requires a fresh cf_clearance after opening linux.do verification', () => {
    expect(hasFreshLinuxDoClearance(parseLinuxDoDocumentCookie('cf_clearance=old'), 'old')).toBe(false);
    expect(hasFreshLinuxDoClearance(parseLinuxDoDocumentCookie('cf_clearance=new'), 'old')).toBe(true);
    expect(hasFreshLinuxDoClearance(parseLinuxDoDocumentCookie('_t=login; _forum_session=session'), 'old')).toBe(false);
    expect(hasFreshLinuxDoClearance(parseLinuxDoDocumentCookie('cf_clearance=first'), null)).toBe(true);
  });

  it('allows login cookie updates without a fresh cf_clearance outside forced verification', () => {
    expect(canAcceptLinuxDoAccessUpdate(parseLinuxDoDocumentCookie('cf_clearance=old; _t=login; _forum_session=session'), 'old', false)).toBe(true);
    expect(canAcceptLinuxDoAccessUpdate(parseLinuxDoDocumentCookie('cf_clearance=old'), 'old', false)).toBe(false);
    expect(canAcceptLinuxDoAccessUpdate(parseLinuxDoDocumentCookie('cf_clearance=old; _t=login'), 'old', true)).toBe(false);
    expect(canAcceptLinuxDoAccessUpdate(parseLinuxDoDocumentCookie('cf_clearance=new'), 'old', true)).toBe(true);
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

  it('reads access cookies from document.cookie fallback data', () => {
    const cookies = parseLinuxDoDocumentCookie('_ga=analytics; cf_clearance=secret%3Dvalue; _t=login; _forum_session=session; theme=light');

    expect(canStoreLinuxDoClearance(cookies)).toBe(true);
    expect(canStoreLinuxDoLogin(cookies)).toBe(true);
    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=secret%3Dvalue; _t=login; _forum_session=session');
  });

  it('can remove linux.do login cookies while preserving public verification', () => {
    const cookies = parseLinuxDoDocumentCookie('cf_clearance=clearance; _t=login; _forum_session=session');

    expect(buildLinuxDoCookieHeader(removeLinuxDoLoginCookies(cookies))).toBe('cf_clearance=clearance');
    expect(canStoreLinuxDoClearance(removeLinuxDoLoginCookies(cookies))).toBe(true);
    expect(canStoreLinuxDoLogin(removeLinuxDoLoginCookies(cookies))).toBe(false);
  });

  it('converts the Android WebView cookie store clearance value into a linux.do cookie', () => {
    const cookies = linuxDoClearanceCookieFromValue(' native-secret ');

    expect(canStoreLinuxDoClearance(cookies)).toBe(true);
    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=native-secret');
    expect(linuxDoClearanceCookieFromValue('')).toEqual({});
  });

  it('merges Android WebView clearance with CookieManager login cookies', async () => {
    const readCookieManagerStore = vi.fn(async () => parseLinuxDoDocumentCookie('_t=login; _forum_session=session'));

    const cookies = await readLinuxDoCookiesFromStores({
      readAndroidStore: async () => linuxDoClearanceCookieFromValue('native-secret'),
      readCookieManagerStore,
      timeoutMs: 1
    });

    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=native-secret; _t=login; _forum_session=session');
    expect(readCookieManagerStore).toHaveBeenCalled();
  });

  it('prefers refreshed CookieManager clearance over stale native WebView cookies', async () => {
    const readCookieManagerStore = vi.fn(async () => linuxDoClearanceCookieFromValue('fresh-clearance'));

    const cookies = await readLinuxDoCookiesFromStores({
      readAndroidStore: async () => parseLinuxDoDocumentCookie('cf_clearance=old-clearance; _t=login; _forum_session=session'),
      readCookieManagerStore,
      timeoutMs: 1
    });

    expect(buildLinuxDoCookieHeader(cookies)).toBe('cf_clearance=fresh-clearance; _t=login; _forum_session=session');
    expect(readCookieManagerStore).toHaveBeenCalled();
  });

  it('reads Android and CookieManager stores concurrently', async () => {
    let androidReadResolved = false;
    let cookieManagerStartedBeforeAndroidResolved = false;
    await readLinuxDoCookiesFromStores({
      readAndroidStore: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        androidReadResolved = true;
        return {};
      },
      readCookieManagerStore: async () => {
        cookieManagerStartedBeforeAndroidResolved = !androidReadResolved;
        return parseLinuxDoDocumentCookie('_t=login');
      },
      timeoutMs: 50
    });

    expect(cookieManagerStartedBeforeAndroidResolved).toBe(true);
  });

  it('can clear only the saved linux.do access state', async () => {
    vi.mocked(SecureStore.deleteItemAsync).mockClear();

    await clearLinuxDoSavedAccess();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
  });

  it('does not let stale linux.do access saves restore state after clearing starts', async () => {
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();

    const staleSave = saveLinuxDoAccess('cf_clearance=old', 'Old Agent');
    const clear = clearLinuxDoSavedAccess();
    await Promise.all([staleSave, clear]);

    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith('linuxdo-clearance', expect.stringContaining('old'));
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
  });

  it('does not let delayed linux.do access saves use a generation captured before clearing', async () => {
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();

    const staleGeneration = currentLinuxDoAccessGeneration();
    await clearLinuxDoSavedAccess();
    await saveLinuxDoAccessForGeneration(staleGeneration, 'cf_clearance=old', 'Old Agent');

    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith('linuxdo-clearance', expect.stringContaining('old'));
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
  });

  it('skips stale linux.do login clears captured before a newer access generation exists', async () => {
    const staleGeneration = currentLinuxDoAccessGeneration();
    await clearLinuxDoSavedAccess();
    vi.mocked(CookieManager.clearByName).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();

    await clearLinuxDoAccessForGeneration(staleGeneration);

    expect(CookieManager.clearByName).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('can clear stale WebView linux.do clearance without clearing login cookies', async () => {
    vi.mocked(CookieManager.clearByName).mockClear();

    await clearLinuxDoWebViewClearance();

    expect(CookieManager.clearByName).toHaveBeenCalledWith('https://linux.do/latest', 'cf_clearance');
    expect(CookieManager.clearByName).toHaveBeenCalledWith('https://www.linux.do/latest', 'cf_clearance');
    expect(CookieManager.clearByName).not.toHaveBeenCalledWith(expect.any(String), '_t');
    expect(CookieManager.clearByName).not.toHaveBeenCalledWith(expect.any(String), '_forum_session');
  });

  it('flushes CookieManager after clearing linux.do login cookies', async () => {
    vi.mocked(CookieManager.flush).mockClear();

    await clearLinuxDoAccess();

    expect(CookieManager.clearByName).toHaveBeenCalledWith('https://linux.do/latest', '_t');
    expect(CookieManager.flush).toHaveBeenCalled();
  });

  it('supports React Native dynamic imports that expose NativeModules on default', () => {
    const getClearance = async () => 'native-secret';

    const module = linuxDoCookieModuleFromReactNativeImport({
      default: { NativeModules: { LinuxDoCookieModule: { getClearance } } }
    });

    expect(module?.getClearance).toBe(getClearance);
  });
});
