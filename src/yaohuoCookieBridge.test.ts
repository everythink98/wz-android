import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ NativeModules: {} }));
vi.mock('@react-native-cookies/cookies', () => ({
  default: { flush: vi.fn(), get: vi.fn() }
}));

import { readYaohuoCookieHeaderFromStores } from './yaohuoCookieBridge';
import { sanitizeYaohuoCookieHeader } from './yaohuoCookies';

describe('Yaohuo Android WebView cookie bridge', () => {
  it('[REG-ACCOUNT-020] preserves the native Cookie header order and repeated scoped cookie names', () => {
    expect(sanitizeYaohuoCookieHeader(
      'sidyaohuo=path-session; tracking=drop; sidyaohuo=root-session; GUID=device; ASP.NET_SessionId=asp'
    )).toBe('sidyaohuo=path-session; sidyaohuo=root-session; GUID=device; ASP.NET_SessionId=asp');
  });

  it('[REG-ACCOUNT-020] prefers the raw Android WebView header over the flattened JS cookie map', async () => {
    const readCookieManagerStore = vi.fn(async () => 'sidyaohuo=flattened');

    await expect(readYaohuoCookieHeaderFromStores({
      readAndroidStore: async () => 'sidyaohuo=native; GUID=device',
      readCookieManagerStore
    })).resolves.toBe('sidyaohuo=native; GUID=device');
    expect(readCookieManagerStore).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-020] generates the raw Yaohuo CookieManager bridge in fresh Android prebuilds', () => {
    const pluginSource = fs.readFileSync('plugins/withLinuxDoCookieModule.js', 'utf8');

    expect(pluginSource).toContain('fun getYaohuoCookieHeader(promise: Promise)');
    expect(pluginSource).toContain('cookieManager.getCookie(url)');
  });
});
