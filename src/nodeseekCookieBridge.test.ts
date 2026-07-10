import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeCookie = vi.hoisted(() => ({
  getNodeSeekCookieHeader: vi.fn()
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({}))
  }
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {
      getNodeSeekCookieHeader: nativeCookie.getNodeSeekCookieHeader
    }
  }
}));

import {
  buildCookieHeader,
  readNodeSeekCookiesFromStores
} from './nodeseekCookieBridge';
import { parseNodeSeekDocumentCookie } from './nodeseekCookies';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter
} from './diagnostics';

describe('NodeSeek WebView cookie bridge', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
    nativeCookie.getNodeSeekCookieHeader.mockReset();
  });
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

  it('distinguishes empty, timeout and error stores on the caller trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('credential', 'load', { source: 'nodeseek' });

    await readNodeSeekCookiesFromStores({
      diagnosticTrace: trace,
      readAndroidStore: () => new Promise(() => undefined),
      readCookieManagerStore: async () => { throw new Error('private cookie-store failure'); },
      timeoutMs: 1
    });
    finishDiagnosticTrace(trace, 'success');
    setDiagnosticWriter(null);

    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', store: 'android-webview', state: 'timeout', hasCredential: false }),
      expect.objectContaining({ phase: 'credential', store: 'cookie-manager', state: 'error', hasCredential: false })
    ]));
    expect(events.filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'partial', reason: 'timeout' })
    ]);
    expect(lines.join('')).not.toMatch(/private|cookie-store failure/);
  });

  it('records a rejecting default Android bridge as an error instead of empty', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    nativeCookie.getNodeSeekCookieHeader.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_FAILURE'));

    await readNodeSeekCookiesFromStores({ timeoutMs: 20 });

    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', store: 'android-webview', state: 'error' }),
      expect.objectContaining({ phase: 'finish', outcome: 'failure', reason: 'storage_error' })
    ]));
    expect(lines.join('')).not.toContain('PRIVATE_NATIVE_FAILURE');
  });
});
