import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => JSON.stringify({
    cookieHeader: '_t=token; _forum_session=session; cf_clearance=clearance',
    savedAt: '2026-06-22T00:00:00.000Z',
    source: 'webview'
  })),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('react-native', () => ({
  NativeModules: {}
}));

import { loadLinuxDoAccess, setLinuxDoDevAnonymousOverride } from './linuxdoCookieBridge';

describe('linux.do cookie bridge dev anonymous override', () => {
  afterEach(() => {
    setLinuxDoDevAnonymousOverride(false);
  });

  it('returns no access while the temporary anonymous override is enabled', async () => {
    await expect(loadLinuxDoAccess()).resolves.toMatchObject({
      cookieHeader: '_t=token; _forum_session=session; cf_clearance=clearance'
    });

    setLinuxDoDevAnonymousOverride(true);
    await expect(loadLinuxDoAccess()).resolves.toBeNull();

    setLinuxDoDevAnonymousOverride(false);
    await expect(loadLinuxDoAccess()).resolves.toMatchObject({
      cookieHeader: '_t=token; _forum_session=session; cf_clearance=clearance'
    });
  });
});
