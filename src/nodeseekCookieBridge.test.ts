import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({}))
  }
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import {
  buildCookieHeader,
  readNodeSeekCookiesFromStores
} from './nodeseekCookieBridge';
import { parseNodeSeekDocumentCookie } from './nodeseekCookies';

describe('NodeSeek WebView cookie bridge', () => {
  it('merges Android WebView and CookieManager cookies so clearance does not hide login cookies', async () => {
    const readCookieManagerStore = vi.fn(async () => parseNodeSeekDocumentCookie('session=abc'));
    const cookies = await readNodeSeekCookiesFromStores({
      readAndroidStore: async () => parseNodeSeekDocumentCookie('cf_clearance=native-clearance'),
      readCookieManagerStore,
      timeoutMs: 1
    });

    expect(buildCookieHeader(cookies)).toBe('cf_clearance=native-clearance; session=abc');
    expect(readCookieManagerStore).toHaveBeenCalled();
  });

  it('prefers refreshed CookieManager clearance over stale native cookies with login state', async () => {
    const readCookieManagerStore = vi.fn(async () => parseNodeSeekDocumentCookie('cf_clearance=fresh-clearance'));
    const cookies = await readNodeSeekCookiesFromStores({
      readAndroidStore: async () => parseNodeSeekDocumentCookie('cf_clearance=old-clearance; session=abc'),
      readCookieManagerStore,
      timeoutMs: 1
    });

    expect(buildCookieHeader(cookies)).toBe('cf_clearance=fresh-clearance; session=abc');
    expect(readCookieManagerStore).toHaveBeenCalled();
  });

  it('falls back to CookieManager when Android store has no NodeSeek cookies', async () => {
    const cookies = await readNodeSeekCookiesFromStores({
      readAndroidStore: async () => ({}),
      readCookieManagerStore: async () => parseNodeSeekDocumentCookie('session=abc'),
      timeoutMs: 1
    });

    expect(buildCookieHeader(cookies)).toBe('session=abc');
  });

  it('reads Android and CookieManager stores concurrently', async () => {
    let androidReadResolved = false;
    let cookieManagerStartedBeforeAndroidResolved = false;
    await readNodeSeekCookiesFromStores({
      readAndroidStore: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        androidReadResolved = true;
        return {};
      },
      readCookieManagerStore: async () => {
        cookieManagerStartedBeforeAndroidResolved = !androidReadResolved;
        return parseNodeSeekDocumentCookie('session=abc');
      },
      timeoutMs: 50
    });

    expect(cookieManagerStartedBeforeAndroidResolved).toBe(true);
  });
});
