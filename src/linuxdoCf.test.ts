import { afterEach, describe, expect, it, vi } from 'vitest';
import CookieManager from '@react-native-cookies/cookies';
import * as SecureStore from 'expo-secure-store';
import { NativeModules } from 'react-native';

const linuxDoCookieModuleMock = vi.hoisted(() => ({
  clearLinuxDoLoginCookies: vi.fn(async (_expected?: Partial<Record<'_t' | '_forum_session', string>>) => true),
  clearLinuxDoClearanceCookies: vi.fn(async () => true)
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true),
    setFromResponse: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: linuxDoCookieModuleMock
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
  clearLinuxDoSavedClearance,
  clearLinuxDoWebViewClearance,
  clearLinuxDoSavedAccess,
  currentLinuxDoAccessGeneration,
  hasFreshLinuxDoClearance,
  linuxDoClearanceCookieFromValue,
  linuxDoCookieModuleFromReactNativeImport,
  loadLinuxDoAccess,
  mergeLinuxDoCookies,
  parseLinuxDoDocumentCookie,
  readLinuxDoCookiesFromStores,
  removeLinuxDoLoginCookies,
  sanitizeLinuxDoUserAgent,
  saveLinuxDoAccess,
  saveLinuxDoAccessForGeneration,
  summarizeLinuxDoCookies
} from './linuxdoCookieBridge';
import { isCloudflareChallengeResponse } from './cloudflareChallenge';
import { isLinuxDoRequestUrl } from './linuxdoFetchFallback';
import { REQUEST_SUPERSEDED_MESSAGE } from './request';
import fs from 'node:fs';

afterEach(() => {
  vi.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue(null);
  vi.mocked(SecureStore.setItemAsync).mockReset().mockResolvedValue(undefined);
  vi.mocked(SecureStore.deleteItemAsync).mockReset().mockResolvedValue(undefined);
  vi.mocked(CookieManager.flush).mockReset().mockResolvedValue(undefined);
  vi.mocked(CookieManager.get).mockReset().mockResolvedValue({});
  vi.mocked(CookieManager.clearByName).mockReset().mockResolvedValue(true);
  vi.mocked(CookieManager.setFromResponse).mockReset().mockResolvedValue(true);
  linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockReset().mockResolvedValue(true);
  linuxDoCookieModuleMock.clearLinuxDoClearanceCookies.mockReset().mockResolvedValue(true);
});

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

  it('loads linux.do access only after an in-flight save commits', async () => {
    let stored = JSON.stringify({
      cookieHeader: 'cf_clearance=old; _t=old-login; _forum_session=old-session',
      userAgent: 'Old Agent'
    });
    const saveStarted = Promise.withResolvers<void>();
    const releaseSave = Promise.withResolvers<void>();
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async () => stored);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (_key, value) => {
      saveStarted.resolve();
      await releaseSave.promise;
      stored = value;
    });

    const save = saveLinuxDoAccess('cf_clearance=new; _t=new-login; _forum_session=new-session', 'New Agent');
    await saveStarted.promise;
    vi.mocked(SecureStore.getItemAsync).mockClear();
    const load = loadLinuxDoAccess();
    await Promise.resolve();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    releaseSave.resolve();

    await expect(save).resolves.toEqual(expect.objectContaining({ cookieHeader: expect.stringContaining('new-login') }));
    await expect(load).resolves.toEqual(expect.objectContaining({
      cookieHeader: expect.stringContaining('new-login'),
      userAgent: 'New Agent'
    }));
  });

  it('does not let clearance cleanup overwrite a newer linux.do credential save', async () => {
    const oldRead = Promise.withResolvers<string | null>();
    const readStarted = Promise.withResolvers<void>();
    let stored = JSON.stringify({
      cookieHeader: 'cf_clearance=old; _t=old-login; _forum_session=old-session',
      userAgent: 'Old Agent'
    });
    let firstRead = true;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async () => {
      if (firstRead) {
        firstRead = false;
        readStarted.resolve();
        return oldRead.promise;
      }
      return stored;
    });
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (_key, value) => { stored = value; });

    const clear = clearLinuxDoSavedClearance();
    await readStarted.promise;
    const save = saveLinuxDoAccess('cf_clearance=new; _t=new-login; _forum_session=new-session', 'New Agent');
    oldRead.resolve(JSON.stringify({
      cookieHeader: 'cf_clearance=old; _t=old-login; _forum_session=old-session',
      userAgent: 'Old Agent'
    }));

    await expect(save).resolves.toEqual(expect.objectContaining({ cookieHeader: expect.stringContaining('new-login') }));
    await expect(clear).resolves.toEqual(expect.objectContaining({
      cookieHeader: expect.stringContaining('new-login'),
      userAgent: 'New Agent'
    }));
    expect(stored).toContain('new-login');
    expect(stored).not.toContain('old-login');
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
    vi.mocked(CookieManager.clearByName).mockClear();
    linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockClear();

    await clearLinuxDoAccess();

    expect(linuxDoCookieModuleMock.clearLinuxDoLoginCookies).toHaveBeenCalledWith(undefined);
    expect(CookieManager.clearByName).not.toHaveBeenCalledWith(expect.any(String), '_t');
    expect(CookieManager.flush).toHaveBeenCalled();
  });

  it('keeps WebView login cleanup inside the credential write generation', async () => {
    const oldHeader = 'cf_clearance=clear; _t=old-login; _forum_session=old-session';
    const nativeCleanup = Promise.withResolvers<boolean>();
    const events: string[] = [];
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({
      cookieHeader: oldHeader,
      userAgent: 'LinuxDo UA'
    }));
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (_key, value) => {
      events.push(String(value).includes('new-login') ? 'new-save' : 'old-login-removed');
    });
    linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockImplementationOnce(async (expected) => {
      events.push('native-start');
      expect(expected).toEqual({ _t: 'old-login', _forum_session: 'old-session' });
      const cleared = await nativeCleanup.promise;
      events.push('native-finish');
      return cleared;
    });

    try {
      const generation = currentLinuxDoAccessGeneration();
      const clear = clearLinuxDoAccessForGeneration(generation, oldHeader);
      await vi.waitFor(() => expect(events).toContain('native-start'));
      const save = saveLinuxDoAccess(
        'cf_clearance=new; _t=new-login; _forum_session=new-session',
        'New Agent',
        { verifiedLogin: true }
      );

      await Promise.resolve();
      expect(events).not.toContain('new-save');
      nativeCleanup.resolve(true);
      await expect(clear).rejects.toThrow(REQUEST_SUPERSEDED_MESSAGE);
      await expect(save).resolves.toEqual(expect.objectContaining({ cookieHeader: expect.stringContaining('new-login') }));

      expect(events.indexOf('native-finish')).toBeLessThan(events.indexOf('new-save'));
    } finally {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
      vi.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
      linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockResolvedValue(true);
    }
  });

  it('surfaces a native linux.do WebView login-cookie cleanup failure', async () => {
    linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(clearLinuxDoAccess()).rejects.toThrow('cleanup failed');
  });

  it('fails closed when the native linux.do Cookie cleanup module is unavailable', async () => {
    const nativeModule = NativeModules.LinuxDoCookieModule;
    NativeModules.LinuxDoCookieModule = undefined;
    try {
      await expect(clearLinuxDoAccess()).rejects.toThrow('linux.do 原生 Cookie 清理模块不可用');
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('linuxdo-login-revoked', '1');
    } finally {
      NativeModules.LinuxDoCookieModule = nativeModule;
    }
  });

  it('keeps linux.do login fail-closed in memory when its revocation marker cannot be persisted', async () => {
    const oldHeader = 'cf_clearance=clear; _t=old-login; _forum_session=old-session';
    const store = new Map<string, string>([['linuxdo-clearance', JSON.stringify({
      cookieHeader: oldHeader,
      userAgent: 'LinuxDo UA'
    })]]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'linuxdo-login-revoked') {
        throw new Error('marker failed');
      }
      store.set(key, value);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });

    try {
      await expect(clearLinuxDoAccessForGeneration(
        currentLinuxDoAccessGeneration(),
        oldHeader
      )).rejects.toThrow('marker failed');
      expect(store.get('linuxdo-clearance')).toContain('cf_clearance=clear');
      expect(store.get('linuxdo-clearance')).not.toMatch(/old-login|old-session/);
      await expect(loadLinuxDoAccess()).resolves.toEqual(expect.objectContaining({
        cookieHeader: 'cf_clearance=clear'
      }));
    } finally {
      vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
      await saveLinuxDoAccess(
        'cf_clearance=new; _t=new-login; _forum_session=new-session',
        'Confirmed Agent',
        { verifiedLogin: true }
      );
    }
  });

  it('treats an unsuccessful native linux.do WebView cleanup as a failure', async () => {
    linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockResolvedValueOnce(false);

    await expect(clearLinuxDoAccess()).rejects.toThrow('linux.do WebView 登录 Cookie 清理失败');
  });

  it('treats a changed conditional WebView cookie bundle as superseded', async () => {
    const oldHeader = 'cf_clearance=clear; _t=old-login; _forum_session=old-session';
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(JSON.stringify({
      cookieHeader: oldHeader,
      userAgent: 'LinuxDo UA'
    }));
    linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockResolvedValueOnce(false);

    await expect(clearLinuxDoAccessForGeneration(
      currentLinuxDoAccessGeneration(),
      oldHeader
    )).rejects.toThrow(REQUEST_SUPERSEDED_MESSAGE);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('linuxdo-login-revoked', '1');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith('linuxdo-login-revoked');
  });

  it('keeps linux.do login revoked after a real cleanup failure until an App-confirmed login replaces it', async () => {
    const oldHeader = 'cf_clearance=clear; _t=old-login; _forum_session=old-session';
    const store = new Map<string, string>([['linuxdo-clearance', JSON.stringify({
      cookieHeader: oldHeader,
      userAgent: 'LinuxDo UA'
    })]]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(clearLinuxDoAccessForGeneration(
      currentLinuxDoAccessGeneration(),
      oldHeader
    )).rejects.toThrow('cleanup failed');
    expect(store.get('linuxdo-login-revoked')).toBe('1');

    await saveLinuxDoAccessForGeneration(currentLinuxDoAccessGeneration(), oldHeader, 'Hidden Agent');
    await expect(loadLinuxDoAccess()).resolves.toEqual(expect.objectContaining({
      cookieHeader: 'cf_clearance=clear'
    }));
    expect(store.get('linuxdo-clearance')).not.toMatch(/old-login|old-session/);
    expect(store.get('linuxdo-login-revoked')).toBe('1');

    await expect(saveLinuxDoAccess(oldHeader, 'Unverified Agent')).resolves.toEqual(expect.objectContaining({
      cookieHeader: 'cf_clearance=clear'
    }));
    expect(store.get('linuxdo-login-revoked')).toBe('1');
    expect(store.get('linuxdo-clearance')).not.toMatch(/old-login|old-session/);

    await expect(saveLinuxDoAccess(
      'cf_clearance=new; _t=new-login; _forum_session=new-session',
      'Confirmed Agent',
      { verifiedLogin: true }
    )).resolves.toEqual(expect.objectContaining({ cookieHeader: expect.stringContaining('new-login') }));
    expect(store.get('linuxdo-login-revoked')).toBeUndefined();
    expect(CookieManager.setFromResponse).toHaveBeenCalledWith(
      expect.stringContaining('linux.do'),
      expect.stringContaining('_t=new-login')
    );
    await expect(loadLinuxDoAccess()).resolves.toEqual(expect.objectContaining({
      cookieHeader: expect.stringContaining('new-login'),
      userAgent: 'Confirmed Agent'
    }));
  });

  it('skips conditional linux.do clears when saved login cookies changed', async () => {
    const generation = currentLinuxDoAccessGeneration();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(JSON.stringify({
      cookieHeader: 'cf_clearance=clear; _t=new-login; _forum_session=new-session',
      userAgent: 'LinuxDo UA'
    }));
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();
    linuxDoCookieModuleMock.clearLinuxDoLoginCookies.mockClear();

    await expect(clearLinuxDoAccessForGeneration(
      generation,
      'cf_clearance=clear; _t=old-login; _forum_session=old-session'
    )).rejects.toThrow(REQUEST_SUPERSEDED_MESSAGE);

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(linuxDoCookieModuleMock.clearLinuxDoLoginCookies).not.toHaveBeenCalled();
  });

  it('generates native CookieManager login clearing guarded by expected cookie values', () => {
    const pluginSource = fs.readFileSync('plugins/withLinuxDoCookieModule.js', 'utf8');

    expect(pluginSource).toContain('expectedValues[name]');
    expect(pluginSource).toContain('cookieManager.getCookie(url)');
    expect(pluginSource).toContain('currentValues[name] != expectedValues[name]');
    expect(pluginSource).toContain('previousValue != null && previousValue != currentValue');
    expect(pluginSource).toContain('changedCookieAppeared');
    expect(pluginSource).toContain('unchangedCookieRemains');
    expect(pluginSource).toContain('linux.do login cookies remained after cleanup');
    expect(pluginSource).toMatch(/if \(conditional\) \{\r?\n\s+return cleared/);
  });

  it('supports React Native dynamic imports that expose NativeModules on default', () => {
    const getClearance = async () => 'native-secret';

    const module = linuxDoCookieModuleFromReactNativeImport({
      default: { NativeModules: { LinuxDoCookieModule: { getClearance } } }
    });

    expect(module?.getClearance).toBe(getClearance);
  });
});
