import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeCookie = vi.hoisted(() => ({
  getLinuxDoCookieHeader: vi.fn()
}));

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
  NativeModules: {
    LinuxDoCookieModule: {
      getLinuxDoCookieHeader: nativeCookie.getLinuxDoCookieHeader
    }
  }
}));

import {
  loadLinuxDoAccess,
  readLinuxDoCookiesFromStores,
  saveLinuxDoAccess,
  setLinuxDoDevAnonymousOverride
} from './linuxdoCookieBridge';
import * as SecureStore from 'expo-secure-store';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter
} from './diagnostics';

describe('linux.do cookie bridge dev anonymous override', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
    setLinuxDoDevAnonymousOverride(false);
    nativeCookie.getLinuxDoCookieHeader.mockReset();
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

  it('REG-ACCOUNT-009 suppresses an old storage error after a newer linux.do credential save starts', async () => {
    const oldRead = Promise.withResolvers<string | null>();
    vi.mocked(SecureStore.getItemAsync).mockReturnValueOnce(oldRead.promise);

    const load = loadLinuxDoAccess();
    const save = saveLinuxDoAccess('_t=new-token; _forum_session=new-session');
    oldRead.reject(new Error('old SecureStore read failed'));

    await expect(load).resolves.toBeNull();
    await expect(save).resolves.toMatchObject({
      cookieHeader: '_t=new-token; _forum_session=new-session'
    });
  });

  it('[REG-ACCOUNT-014] rejects a corrupted saved linux.do session instead of treating it as anonymous', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('{bad json');

    await expect(loadLinuxDoAccess()).rejects.toThrow('linux.do 登录配置已损坏');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('records a partial multi-store timeout without logging Cookie values', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('credential', 'load', { source: 'linuxdo' });

    await readLinuxDoCookiesFromStores({
      diagnosticTrace: trace,
      readAndroidStore: async () => ({ cf_clearance: { name: 'cf_clearance', value: 'PRIVATE_CLEARANCE' } }),
      readCookieManagerStore: () => new Promise(() => undefined),
      timeoutMs: 1
    });
    finishDiagnosticTrace(trace, 'success');

    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', store: 'android-webview', state: 'success', hasCredential: true }),
      expect.objectContaining({ phase: 'credential', store: 'cookie-manager', state: 'timeout', hasCredential: false })
    ]));
    expect(events.filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'partial', reason: 'timeout' })
    ]);
    expect(lines.join('')).not.toMatch(/PRIVATE_CLEARANCE|cf_clearance/);
  });

  it('records a rejecting default Android bridge as an error instead of empty', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    nativeCookie.getLinuxDoCookieHeader.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_FAILURE'));

    await readLinuxDoCookiesFromStores({ timeoutMs: 20 });

    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', store: 'android-webview', state: 'error' }),
      expect.objectContaining({ phase: 'finish', outcome: 'failure', reason: 'storage_error' })
    ]));
    expect(lines.join('')).not.toContain('PRIVATE_NATIVE_FAILURE');
  });
});
