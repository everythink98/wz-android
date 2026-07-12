import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { effect(); },
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let current = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [current, (next: T | ((value: T) => T)) => {
      current = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
    }];
  }
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    clearByName: vi.fn(),
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    setFromResponse: vi.fn(async () => true)
  }
}));
vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined)
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  NativeModules: { LinuxDoCookieModule: {} },
}));
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  enqueueCredentialWrite,
  enqueueLatestBrowserFetchRequest,
  isCredentialWriteCurrent,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  preemptActiveBrowserFetchRequest,
  replaceCredentialWrite,
  replaceCredentialWriteForGeneration,
  rejectBrowserFetchRequest,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  shouldHandleBrowserHttpError,
  shouldKeepQueuedBrowserFetchRequest,
  shouldPreemptBrowserFetchRequest,
  startNextBrowserFetchRequest,
  takeNodeSeekVerificationRetry,
  type BrowserFetchQueueRequest,
  type BrowserFetchRequestCleanupTarget
} from './sessionControllerHelpers';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from '../diagnostics';
import { REQUEST_SUPERSEDED_MESSAGE, type Fetcher } from '../request';
import { saveLinuxDoAccess } from '../linuxdoCookieBridge';
import { useSessionController } from './useSessionController';

afterEach(() => {
  setDiagnosticWriter(null);
  vi.mocked(SecureStore.getItemAsync).mockClear();
  vi.mocked(SecureStore.deleteItemAsync).mockClear();
  vi.mocked(SecureStore.setItemAsync).mockClear();
  vi.mocked(CookieManager.get).mockClear();
  vi.mocked(CookieManager.setFromResponse).mockClear();
  vi.mocked(CookieManager.flush).mockClear();
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async () => null);
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async () => undefined);
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async () => undefined);
  vi.mocked(CookieManager.get).mockImplementation(async () => ({}));
  vi.mocked(CookieManager.setFromResponse).mockImplementation(async () => true);
  vi.mocked(CookieManager.flush).mockImplementation(async () => undefined);
});

function createTestSessionController(defaultFetcher: Fetcher = vi.fn(), setWebLoginUserId = vi.fn(), notify = vi.fn()) {
  return useSessionController({
    defaultFetcher,
    linuxDoBrowserWebViewRef: { current: null },
    linuxDoClearanceBeforeVerifyRef: { current: null },
    linuxDoWebViewCookieHeaderRef: { current: '' },
    linuxDoWebViewUserAgentRef: { current: '' },
    nodeSeekBrowserWebViewRef: { current: null },
    nodeSeekWebViewCookieHeaderRef: { current: '' },
    nodeSeekWebViewUserAgentRef: { current: '' },
    notify,
    setLinuxDoWebViewCookieHeader: vi.fn(),
    setLinuxDoWebViewUserAgent: vi.fn(),
    setNodeSeekWebViewUserAgent: vi.fn(),
    setWebLoginUserId,
    webLoginDetectedRef: { current: false }
  });
}

describe('session controller helpers', () => {
  it('restores other site sessions when one credential store fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (key === 'nodeseek-access') {
        throw new Error('private NodeSeek store failure');
      }
      if (key === 'yaohuo-cookie-header') {
        return 'sidyaohuo=private-secret';
      }
      return null;
    });

    createTestSessionController();

    await vi.waitFor(() => {
      const events = lines.map((line) => JSON.parse(line));
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: 'state-transition', source: 'yaohuo', nextState: 'logged-in' }),
        expect.objectContaining({ operation: 'load-stored', phase: 'finish', outcome: 'partial' })
      ]));
    });
    expect(lines.join('')).not.toMatch(/private|secret/);
  });

  it('does not restore a revoked NodeSeek login during cold startup', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (key === 'nodeseek-login-revoked') {
        return '1';
      }
      if (key === 'nodeseek-access') {
        return JSON.stringify({
          cookieHeader: 'session=stale-login',
          savedAt: '2026-07-10T00:00:00.000Z',
          source: 'webview'
        });
      }
      return null;
    });

    createTestSessionController();
    await vi.waitFor(() => expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'load-stored', phase: 'finish' })
    ])));

    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'state-transition', source: 'nodeseek', nextState: 'expired' })
    ]));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'state-transition', source: 'nodeseek', nextState: 'logged-in' })
    ]));
    expect(lines.join('')).not.toContain('stale-login');
  });

  it('does not apply a stale linux.do startup read after a newer access generation exists', async () => {
    const oldLinuxDoAccess = Promise.withResolvers<string | null>();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (key === 'linuxdo-clearance') {
        return oldLinuxDoAccess.promise;
      }
      return null;
    });

    createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('linuxdo-clearance'));
    await saveLinuxDoAccess('cf_clearance=new; _t=new-login', 'New Agent');
    oldLinuxDoAccess.resolve(JSON.stringify({
      cookieHeader: 'cf_clearance=old; _t=old-login',
      source: 'webview'
    }));
    await vi.waitFor(() => expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'load-stored', phase: 'finish' })
    ])));

    expect(lines.map((line) => JSON.parse(line))).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'state-transition', source: 'linuxdo' })
    ]));
  });

  it('records a session transition without cookie facts or raw errors', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();

    controller.dispatchSiteSessionEvent({
      site: 'nodeseek',
      type: 'verification-required',
      message: 'private cookie=secret raw error'
    });

    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'state-transition');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'nodeseek', eventType: 'verification-required' }),
      expect.objectContaining({
        phase: 'apply',
        previousState: 'anonymous',
        nextState: 'verification-required',
        hasCredential: false
      }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', state: 'verification-required' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/private|cookie|secret|raw error/);
  });

  it('invalidates only definitive non-login NodeSeek identity transitions', () => {
    const setWebLoginUserId = vi.fn();
    const controller = createTestSessionController(vi.fn(), setWebLoginUserId);

    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'check-failed', message: 'offline' });
    expect(setWebLoginUserId).not.toHaveBeenCalled();

    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'login-expired' });
    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'cookie-loaded', loggedIn: false });
    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'verification-succeeded', loggedIn: false, at: '2026-07-10T00:00:00.000Z' });
    expect(setWebLoginUserId).toHaveBeenCalledTimes(3);
    expect(setWebLoginUserId).toHaveBeenNthCalledWith(1, null);
  });

  it('records an externally superseded credential save as stale without a generation argument', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();

    await controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'private-cookie-value' }
    }, { isCurrent: () => false });

    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ area, operation, source }) => area === 'credential' && operation === 'save' && source === 'nodeseek');
    expect(events.at(-1)).toMatchObject({ phase: 'finish', outcome: 'stale', reason: 'stale' });
    expect(JSON.stringify(events)).not.toMatch(/private-cookie-value|session=/);
  });

  it('records WebView credential restore and clear with one terminal event each', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();

    await controller.restoreSavedYaohuoCookiesToWebView();
    await controller.clearNodeSeekLoginState();

    const events = lines.map((line) => JSON.parse(line));
    for (const operation of ['restore-webview', 'clear']) {
      const operationEvents = events.filter((event) => event.operation === operation);
      expect(operationEvents[0]).toMatchObject({ phase: 'intent' });
      expect(operationEvents.filter((event) => event.phase === 'finish')).toHaveLength(1);
      expect(operationEvents.at(-1)).toMatchObject({ outcome: 'success' });
    }
    expect(JSON.stringify(events.filter((event) => ['restore-webview', 'clear'].includes(event.operation))))
      .not.toMatch(/cookieHeader|private|session=/);
  });

  it('does not restore Yaohuo WebView cookies after the login request is invalidated', async () => {
    const storedCookie = Promise.withResolvers<string | null>();
    const current = { value: true };
    vi.mocked(SecureStore.getItemAsync).mockReturnValue(storedCookie.promise);
    vi.mocked(CookieManager.setFromResponse).mockClear();
    const controller = createTestSessionController();

    const restore = controller.restoreSavedYaohuoCookiesToWebView({
      isCurrent: () => current.value
    });
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalled());
    current.value = false;
    storedCookie.resolve('sidyaohuo=private-cookie');
    await restore;

    expect(CookieManager.setFromResponse).not.toHaveBeenCalled();
  });

  it('finishes a Yaohuo clear only after both saved and WebView cookies are cleared', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(SecureStore.deleteItemAsync).mockClear();
    vi.mocked(CookieManager.get).mockResolvedValueOnce({ session: { name: 'session', value: 'private' } });
    vi.mocked(CookieManager.setFromResponse).mockClear();
    const controller = createTestSessionController();

    await controller.clearYaohuoLoginState();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('yaohuo-cookie-header');
    expect(CookieManager.setFromResponse).toHaveBeenCalled();
    const events = lines.map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'clear');
    expect(events.filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'success' })
    ]);
  });

  it('restores the saved Yaohuo cookie when anonymous mode invalidates an in-flight delete', async () => {
    const deleteCookie = Promise.withResolvers<void>();
    const current = { value: true };
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => (
      key === 'yaohuo-cookie-header' ? 'sidyaohuo=preserve' : null
    ));
    const controller = createTestSessionController();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation((key) => (
      key === 'yaohuo-cookie-header' ? deleteCookie.promise : Promise.resolve()
    ));
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(CookieManager.setFromResponse).mockClear();

    const clear = controller.clearYaohuoLoginState({
      generation: controller.currentYaohuoCredentialGeneration(),
      isCurrent: () => current.value
    });
    await vi.waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('yaohuo-cookie-header'));
    current.value = false;
    deleteCookie.resolve();

    await expect(clear).resolves.toBe(false);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('yaohuo-cookie-header', 'sidyaohuo=preserve');
    expect(CookieManager.setFromResponse).not.toHaveBeenCalled();
  });

  it('keeps an automatically detected Yaohuo expiration when credential cleanup fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => (
      key === 'yaohuo-cookie-header' ? 'sidyaohuo=expired' : null
    ));
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === 'yaohuo-cookie-header') {
        throw new Error('cleanup failed');
      }
    });
    const controller = createTestSessionController();

    await expect(controller.clearYaohuoLoginState({
      generation: controller.currentYaohuoCredentialGeneration()
    })).rejects.toThrow('cleanup failed');

    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'state-transition',
        phase: 'apply',
        source: 'yaohuo',
        nextState: 'expired'
      }),
      expect.objectContaining({
        operation: 'clear',
        phase: 'finish',
        source: 'yaohuo',
        outcome: 'failure',
        reason: 'storage_error'
      })
    ]));
    await expect(controller.loadYaohuoCookieForSource('yaohuo')).resolves.toBeUndefined();
  });

  it('continues removing an expired Yaohuo login when its revocation marker cannot be persisted', async () => {
    const store = new Map<string, string>([['yaohuo-cookie-header', 'sidyaohuo=old-login']]);
    let nativeCookiePresent = true;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'yaohuo-login-revoked') {
        throw new Error('marker failed');
      }
      store.set(key, value);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockImplementation(async (): ReturnType<typeof CookieManager.get> => {
      if (!nativeCookiePresent) {
        return {};
      }
      return { sidyaohuo: { name: 'sidyaohuo', value: 'old-login', domain: 'yaohuo.me' } };
    });
    vi.mocked(CookieManager.setFromResponse).mockImplementation(async () => {
      nativeCookiePresent = false;
      return true;
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('yaohuo-login-revoked'));

    await expect(controller.clearYaohuoLoginState({
      generation: controller.currentYaohuoCredentialGeneration()
    })).rejects.toThrow('marker failed');

    expect(store.get('yaohuo-cookie-header')).toBeUndefined();
    expect(nativeCookiePresent).toBe(false);
    const restarted = createTestSessionController();
    await expect(restarted.loadYaohuoCookieForSource('yaohuo')).resolves.toBeUndefined();
  });

  it('does not report a NodeSeek clear as successful when WebView cookie cleanup fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(CookieManager.get).mockResolvedValueOnce({ session: { name: 'session', value: 'private' } });
    vi.mocked(CookieManager.setFromResponse).mockRejectedValueOnce(new Error('cleanup failed'));
    const controller = createTestSessionController();

    await expect(controller.clearNodeSeekLoginState()).rejects.toThrow('cleanup failed');

    const events = lines.map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'clear');
    expect(events.filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'failure', reason: 'storage_error' })
    ]);
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'state-transition', source: 'nodeseek', nextState: 'anonymous' })
    ]));
  });

  it('does not resurrect a revoked NodeSeek login from stale native cookies after cleanup fails', async () => {
    const store = new Map<string, string>([[
      'nodeseek-access',
      JSON.stringify({
        cookieHeader: 'session=old-login',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      })
    ]]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockResolvedValue({
      session: { name: 'session', value: 'old-login', domain: 'nodeseek.com' }
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));
    vi.mocked(CookieManager.setFromResponse).mockRejectedValue(new Error('cleanup failed'));

    await expect(controller.clearNodeSeekLoginCookiesOnly({
      generation: controller.currentNodeSeekCredentialGeneration()
    })).rejects.toThrow('cleanup failed');

    vi.mocked(CookieManager.setFromResponse).mockResolvedValue(true);
    await expect(controller.loadNodeSeekCookieForSource('nodeseek')).resolves.toBeUndefined();
    expect(store.get('nodeseek-login-revoked')).toBe('1');
    expect(store.get('nodeseek-access')).toBeUndefined();
  });

  it('accepts an explicitly verified NodeSeek login and removes its revocation marker', async () => {
    const store = new Map<string, string>([['nodeseek-login-revoked', '1']]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    await expect(controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login', domain: 'nodeseek.com' }
    }, { verifiedByPage: true })).resolves.toBe('session=new-login');

    expect(store.get('nodeseek-login-revoked')).toBeUndefined();
    expect(store.get('nodeseek-access')).toContain('session=new-login');
  });

  it('keeps the NodeSeek revocation marker when a verified replacement cannot be persisted', async () => {
    const store = new Map<string, string>([
      ['nodeseek-login-revoked', '1'],
      ['nodeseek-access', JSON.stringify({
        cookieHeader: 'session=old-login',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      })]
    ]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'nodeseek-access') {
        throw new Error('persist failed');
      }
      store.set(key, value);
    });
    vi.mocked(CookieManager.get).mockResolvedValue({
      session: { name: 'session', value: 'old-login', domain: 'nodeseek.com' }
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    await expect(controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login', domain: 'nodeseek.com' }
    }, { verifiedByPage: true })).rejects.toThrow('persist failed');

    expect(store.get('nodeseek-login-revoked')).toBe('1');
    await expect(controller.loadNodeSeekCookieForSource('nodeseek')).resolves.toBeUndefined();
  });

  it('loads NodeSeek credentials only after an in-flight verified replacement commits its marker state', async () => {
    const store = new Map<string, string>([
      ['nodeseek-login-revoked', '1'],
      ['nodeseek-access', JSON.stringify({
        cookieHeader: 'session=old-login',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      })]
    ]);
    const releaseSave = Promise.withResolvers<void>();
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'nodeseek-access') {
        await releaseSave.promise;
      }
      store.set(key, value);
    });
    vi.mocked(CookieManager.get).mockResolvedValue({
      session: { name: 'session', value: 'new-login', domain: 'nodeseek.com' }
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    const save = controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login', domain: 'nodeseek.com' }
    }, { verifiedByPage: true });
    await vi.waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledWith('nodeseek-access', expect.any(String)));
    const load = controller.loadNodeSeekCookieForSource('nodeseek');
    releaseSave.resolve();

    await expect(save).resolves.toBe('session=new-login');
    await expect(load).resolves.toBe('session=new-login');
    expect(store.get('nodeseek-login-revoked')).toBeUndefined();
  });

  it('loads NodeSeek credentials only after an in-flight clear removes the stale login', async () => {
    const store = new Map<string, string>([['nodeseek-access', JSON.stringify({
      cookieHeader: 'session=old-login',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    })]]);
    const releaseMarker = Promise.withResolvers<void>();
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'nodeseek-login-revoked') {
        await releaseMarker.promise;
      }
      store.set(key, value);
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    const clear = controller.clearNodeSeekLoginCookiesOnly();
    await vi.waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked', '1'));
    let loadSettled = false;
    const load = controller.loadNodeSeekCookieForSource('nodeseek').finally(() => { loadSettled = true; });
    await Promise.resolve();
    expect(loadSettled).toBe(false);
    releaseMarker.resolve();

    await expect(clear).resolves.toBeUndefined();
    await expect(load).resolves.toBeUndefined();
    expect(store.get('nodeseek-access')).toBeUndefined();
  });

  it('does not serialize concurrent NodeSeek native cookie reads behind each other', async () => {
    const firstRead = Promise.withResolvers<Record<string, { name: string; value: string; domain: string }>>();
    const store = new Map<string, string>();
    let readCount = 0;
    vi.mocked(CookieManager.get).mockImplementation(() => {
      readCount += 1;
      return readCount <= 2 ? firstRead.promise : Promise.resolve({
        session: { name: 'session', value: 'newer-snapshot', domain: 'nodeseek.com' }
      });
    });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    const first = controller.loadNodeSeekCookieForSource('nodeseek');
    await vi.waitFor(() => expect(CookieManager.get).toHaveBeenCalledTimes(2));
    const second = controller.loadNodeSeekCookieForSource('nodeseek');
    await vi.waitFor(() => expect(CookieManager.get).toHaveBeenCalledTimes(4));
    await expect(second).resolves.toBe('session=newer-snapshot');
    firstRead.resolve({
      session: { name: 'session', value: 'older-snapshot', domain: 'nodeseek.com' }
    });
    await expect(first).resolves.toBe('session=older-snapshot');

    expect(store.get('nodeseek-access')).toContain('session=newer-snapshot');
    expect(store.get('nodeseek-access')).not.toContain('session=older-snapshot');
  });

  it('does not let a slow NodeSeek load overwrite a newer external credential save in the same generation', async () => {
    const slowRead = Promise.withResolvers<Record<string, { name: string; value: string; domain: string }>>();
    const store = new Map<string, string>();
    vi.mocked(CookieManager.get).mockReturnValue(slowRead.promise);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    const slowLoad = controller.loadNodeSeekCookieForSource('nodeseek');
    await vi.waitFor(() => expect(CookieManager.get).toHaveBeenCalledTimes(2));
    await expect(controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'newer-external', domain: 'nodeseek.com' }
    }, {
      generation: controller.currentNodeSeekCredentialGeneration(),
      userId: 123
    })).resolves.toBe('session=newer-external');
    slowRead.resolve({
      session: { name: 'session', value: 'older-load', domain: 'nodeseek.com' }
    });
    await expect(slowLoad).resolves.toBe('session=older-load');

    expect(store.get('nodeseek-access')).toContain('session=newer-external');
    expect(store.get('nodeseek-access')).toContain('"userId":123');
    expect(store.get('nodeseek-access')).not.toContain('session=older-load');
  });

  it('continues removing an expired NodeSeek login when its revocation marker cannot be persisted', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const store = new Map<string, string>([['nodeseek-access', JSON.stringify({
        cookieHeader: 'session=old-login',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      })]]);
    let nativeCookiePresent = true;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'nodeseek-login-revoked') {
        throw new Error('marker failed');
      }
      store.set(key, value);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockImplementation(async (): ReturnType<typeof CookieManager.get> => {
      if (!nativeCookiePresent) {
        return {};
      }
      return { session: { name: 'session', value: 'old-login', domain: 'nodeseek.com' } };
    });
    vi.mocked(CookieManager.setFromResponse).mockImplementation(async () => {
      nativeCookiePresent = false;
      return true;
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    await expect(controller.clearNodeSeekLoginCookiesOnly({
      generation: controller.currentNodeSeekCredentialGeneration()
    })).rejects.toThrow('marker failed');

    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'state-transition', source: 'nodeseek', nextState: 'expired' })
    ]));
    expect(store.get('nodeseek-access')).toBeUndefined();
    expect(nativeCookiePresent).toBe(false);
    const restarted = createTestSessionController();
    await expect(restarted.loadNodeSeekCookieForSource('nodeseek')).resolves.toBeUndefined();
  });

  it('does not expire a newer unsaved NodeSeek WebView login with an older automatic clear', async () => {
    const store = new Map<string, string>([['nodeseek-access', JSON.stringify({
      cookieHeader: 'session=old-login',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    })]]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockResolvedValue({
      session: { name: 'session', value: 'new-unsaved-login', domain: 'nodeseek.com' }
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));
    vi.mocked(CookieManager.setFromResponse).mockClear();

    await expect(controller.clearNodeSeekLoginCookiesOnly({
      generation: controller.currentNodeSeekCredentialGeneration()
    })).resolves.toBeUndefined();

    expect(CookieManager.setFromResponse).not.toHaveBeenCalled();
    expect(store.get('nodeseek-login-revoked')).toBe('1');
  });

  it('restores a newer NodeSeek login after an older clear already started touching WebView cookies', async () => {
    const store = new Map<string, string>([[
      'nodeseek-access',
      JSON.stringify({
        cookieHeader: 'session=old-login',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      })
    ]]);
    const releaseCleanup = Promise.withResolvers<boolean>();
    const appliedHeaders: string[] = [];
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockResolvedValue({ session: { name: 'session', value: 'old-login' } });
    vi.mocked(CookieManager.setFromResponse).mockImplementation(async (_url, header) => {
      if (header.includes('Max-Age=0')) {
        return releaseCleanup.promise;
      }
      appliedHeaders.push(header);
      return true;
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    const clear = controller.clearNodeSeekLoginState();
    await vi.waitFor(() => expect(CookieManager.setFromResponse).toHaveBeenCalled());
    const save = controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login', domain: 'nodeseek.com' }
    }, { verifiedByPage: true });
    releaseCleanup.resolve(true);

    await expect(clear).resolves.toBe(false);
    await expect(save).resolves.toBe('session=new-login');
    expect(appliedHeaders).toEqual(expect.arrayContaining([
      expect.stringContaining('session=new-login')
    ]));
    expect(store.get('nodeseek-login-revoked')).toBeUndefined();
  });

  it('restores a newer Yaohuo login after an older clear already started touching WebView cookies', async () => {
    const store = new Map<string, string>([['yaohuo-cookie-header', 'sidyaohuo=old-login']]);
    const releaseCleanup = Promise.withResolvers<boolean>();
    const appliedHeaders: string[] = [];
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockResolvedValue({ sidyaohuo: { name: 'sidyaohuo', value: 'old-login' } });
    vi.mocked(CookieManager.setFromResponse).mockImplementation(async (_url, header) => {
      if (header.includes('Max-Age=0')) {
        return releaseCleanup.promise;
      }
      appliedHeaders.push(header);
      return true;
    });
    const controller = createTestSessionController();

    const clear = controller.clearYaohuoLoginState();
    await vi.waitFor(() => expect(CookieManager.setFromResponse).toHaveBeenCalled());
    const save = controller.saveYaohuoCookieHeader('sidyaohuo=new-login');
    releaseCleanup.resolve(true);

    await expect(clear).resolves.toBe(false);
    await expect(save).resolves.toBe(true);
    expect(appliedHeaders).toEqual(expect.arrayContaining([
      expect.stringContaining('sidyaohuo=new-login')
    ]));
    expect(store.get('yaohuo-cookie-header')).toBe('sidyaohuo=new-login');
  });

  it('does not expire a newer unsaved Yaohuo WebView login with an older automatic clear', async () => {
    const store = new Map<string, string>([['yaohuo-cookie-header', 'sidyaohuo=old-login']]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockResolvedValue({
      sidyaohuo: { name: 'sidyaohuo', value: 'new-unsaved-login' }
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('yaohuo-login-revoked'));
    vi.mocked(CookieManager.setFromResponse).mockClear();

    await expect(controller.clearYaohuoLoginState({
      generation: controller.currentYaohuoCredentialGeneration()
    })).resolves.toBe(false);

    expect(CookieManager.setFromResponse).not.toHaveBeenCalled();
    expect(store.get('yaohuo-cookie-header')).toBeUndefined();
    expect(store.get('yaohuo-login-revoked')).toBe('1');
  });

  it('does not restore an expired Yaohuo credential after native cleanup fails', async () => {
    const store = new Map<string, string>([['yaohuo-cookie-header', 'sidyaohuo=expired']]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockResolvedValue({
      sidyaohuo: { name: 'sidyaohuo', value: 'expired' }
    });
    vi.mocked(CookieManager.setFromResponse).mockRejectedValue(new Error('native cleanup failed'));
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('yaohuo-login-revoked'));

    await expect(controller.clearYaohuoLoginState({
      generation: controller.currentYaohuoCredentialGeneration()
    })).rejects.toThrow('native cleanup failed');

    expect(store.get('yaohuo-cookie-header')).toBeUndefined();
    expect(store.get('yaohuo-login-revoked')).toBe('1');
    await expect(controller.loadYaohuoCookieForSource('yaohuo')).resolves.toBeUndefined();
  });

  it('keeps a Yaohuo revocation when anonymous mode invalidates the clear during its store read', async () => {
    const store = new Map<string, string>([['yaohuo-cookie-header', 'sidyaohuo=preserve']]);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('yaohuo-login-revoked'));
    const delayedRead = Promise.withResolvers<string | null>();
    const current = { value: true };
    vi.mocked(SecureStore.getItemAsync).mockImplementation((key) => key === 'yaohuo-cookie-header'
      ? delayedRead.promise
      : Promise.resolve(store.get(key) ?? null));

    const clear = controller.clearYaohuoLoginState({
      generation: controller.currentYaohuoCredentialGeneration(),
      isCurrent: () => current.value
    });
    await vi.waitFor(() => expect(store.get('yaohuo-login-revoked')).toBe('1'));
    current.value = false;
    delayedRead.resolve('sidyaohuo=preserve');

    await expect(clear).resolves.toBe(false);
    expect(store.get('yaohuo-cookie-header')).toBe('sidyaohuo=preserve');
    expect(store.get('yaohuo-login-revoked')).toBe('1');
    await expect(controller.loadYaohuoCookieForSource('yaohuo')).resolves.toBeUndefined();
  });

  it('loads a Yaohuo credential only after an in-flight replacement commits its marker state', async () => {
    const store = new Map<string, string>([
      ['yaohuo-cookie-header', 'sidyaohuo=old-login'],
      ['yaohuo-login-revoked', '1']
    ]);
    const releaseSave = Promise.withResolvers<void>();
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'yaohuo-cookie-header') {
        await releaseSave.promise;
      }
      store.set(key, value);
    });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('yaohuo-login-revoked'));

    const save = controller.saveYaohuoCookieHeader('sidyaohuo=new-login');
    await vi.waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledWith('yaohuo-cookie-header', 'sidyaohuo=new-login'));
    const load = controller.loadYaohuoCookieForSource('yaohuo');
    releaseSave.resolve();

    await expect(save).resolves.toBe(true);
    await expect(load).resolves.toBe('sidyaohuo=new-login');
    expect(store.get('yaohuo-login-revoked')).toBeUndefined();
  });

  it('does not let a stale hidden NodeSeek completion cancel an in-flight verified login save', async () => {
    const store = new Map<string, string>([
      ['nodeseek-login-revoked', '1'],
      ['nodeseek-access', JSON.stringify({
        cookieHeader: 'session=old-login',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      })]
    ]);
    const releaseSave = Promise.withResolvers<void>();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === 'nodeseek-access' && value.includes('new-login')) {
        await releaseSave.promise;
      }
      store.set(key, value);
    });
    vi.mocked(CookieManager.get).mockResolvedValue({
      session: { name: 'session', value: 'old-browser-login', domain: 'nodeseek.com' }
    });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )));
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('nodeseek-login-revoked'));

    const url = 'https://www.nodeseek.com/post-hidden-stale-generation';
    const response = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    const save = controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login', domain: 'nodeseek.com' }
    }, { verifiedByPage: true });
    await vi.waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'nodeseek-access',
      expect.stringContaining('new-login')
    ));

    await controller.completeNodeSeekBrowserFetch({
      id: 1,
      url,
      html: '<html>old hidden response</html>',
      cookie: 'session=old-browser-login'
    });
    await expect(response).resolves.toBeInstanceOf(Response);
    releaseSave.resolve();

    await expect(save).resolves.toBe('session=new-login');
    await vi.waitFor(() => expect(store.get('nodeseek-login-revoked')).toBeUndefined());
    expect(store.get('nodeseek-access')).toContain('session=new-login');
    expect(store.get('nodeseek-access')).not.toContain('old-browser-login');
  });

  it('does not let an older linux.do hidden cookie read overwrite a newer completion in the same generation', async () => {
    const slowNativeRead = Promise.withResolvers<Record<string, { name: string; value: string; domain: string }>>();
    const store = new Map<string, string>();
    const lines: string[] = [];
    let cookieReadCount = 0;
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
    vi.mocked(CookieManager.get).mockImplementation(() => {
      cookieReadCount += 1;
      if (cookieReadCount <= 4) {
        return slowNativeRead.promise;
      }
      return Promise.resolve({
        cf_clearance: { name: 'cf_clearance', value: 'new-clearance', domain: '.linux.do' },
        _t: { name: '_t', value: 'new-login', domain: '.linux.do' },
        _forum_session: { name: '_forum_session', value: 'new-session', domain: '.linux.do' }
      });
    });
    const controller = createTestSessionController(vi.fn(async () => new Response('', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    })));
    const firstUrl = 'https://linux.do/t/old-hidden-read/1';
    const secondUrl = 'https://linux.do/t/new-hidden-read/2';

    const first = controller.forumFetchWithWebViewFallback(firstUrl);
    await vi.waitFor(() => expect(lines.filter((line) => {
      const event = JSON.parse(line);
      return event.source === 'linuxdo' && event.state === 'queued';
    })).toHaveLength(1));
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url: firstUrl,
      body: '<html>old</html>',
      cookie: 'cf_clearance=old-clearance; _t=old-login; _forum_session=old-session'
    });
    await expect(first).resolves.toBeInstanceOf(Response);
    await vi.waitFor(() => expect(CookieManager.get).toHaveBeenCalledTimes(4));

    const second = controller.forumFetchWithWebViewFallback(secondUrl);
    await vi.waitFor(() => expect(lines.filter((line) => {
      const event = JSON.parse(line);
      return event.source === 'linuxdo' && event.state === 'queued';
    })).toHaveLength(2));
    await controller.completeLinuxDoBrowserFetch({
      id: 2,
      url: secondUrl,
      body: '<html>new</html>',
      cookie: 'cf_clearance=new-clearance; _t=new-login; _forum_session=new-session'
    });
    await expect(second).resolves.toBeInstanceOf(Response);
    await vi.waitFor(() => expect(store.get('linuxdo-clearance')).toContain('new-login'));

    slowNativeRead.resolve({
      cf_clearance: { name: 'cf_clearance', value: 'old-clearance', domain: '.linux.do' },
      _t: { name: '_t', value: 'old-login', domain: '.linux.do' },
      _forum_session: { name: '_forum_session', value: 'old-session', domain: '.linux.do' }
    });
    await vi.waitFor(() => expect(lines.filter((line) => {
      const event = JSON.parse(line);
      return event.area === 'credential'
        && event.operation === 'cookie-store-read'
        && event.source === 'linuxdo'
        && event.phase === 'finish';
    })).toHaveLength(2));

    expect(store.get('linuxdo-clearance')).toContain('new-login');
    expect(store.get('linuxdo-clearance')).not.toContain('old-login');
  });

  it('keeps a hidden WebView request trace safe from URL, HTML, and cookie data', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html>private challenge body</html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const url = 'https://www.nodeseek.com/post-private-query-1';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => {
      expect(lines.some((line) => {
        const event = JSON.parse(line);
        return event.area === 'webview' && event.operation === 'browser-fetch';
      })).toBe(true);
    });
    await controller.completeNodeSeekBrowserFetch({
      id: 1,
      url,
      html: '<html>private rendered body</html>',
      cookie: 'session=private-cookie'
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);

    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ area, operation }) => area === 'webview' && operation === 'browser-fetch');
    expect(events.map(({ phase }) => phase)).toEqual(['intent', 'guard', 'transport', 'parse', 'finish']);
    expect(events.at(-2)).toMatchObject({
      channel: 'webview',
      status: 200,
      hasCredential: true,
      isChallenge: false
    });
    expect(events.at(-1)).toMatchObject({ outcome: 'success' });
    expect(JSON.stringify(events)).not.toMatch(/private-query|rendered body|private-cookie|google\.com|nodeseek\.com|session=/);
  });

  it('keeps the hidden WebView queue on its caller trace without an early terminal event', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const trace = beginDiagnosticTrace('topic', 'open');
    const fetcher = withDiagnosticFetcher(trace, controller.forumFetchWithWebViewFallback);
    const url = 'https://www.nodeseek.com/post-private-query-2';

    const responsePromise = fetcher(url, {});
    await vi.waitFor(() => {
      expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true);
    });
    expect(lines.map((line) => JSON.parse(line)).filter((event) => event.traceId === trace.traceId && event.phase === 'finish')).toHaveLength(0);

    await controller.completeNodeSeekBrowserFetch({
      id: 1,
      url,
      html: '<html>private rendered body</html>',
      cookie: 'session=private-cookie'
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);
    expect(lines.map((line) => JSON.parse(line)).filter((event) => event.traceId === trace.traceId && event.phase === 'finish')).toHaveLength(0);

    finishDiagnosticTrace(trace, 'success');
    const events = lines.map((line) => JSON.parse(line)).filter((event) => event.traceId === trace.traceId);
    expect(new Set(events.map((event) => event.traceId))).toEqual(new Set([trace.traceId]));
    expect(events.filter(({ phase }) => phase === 'intent')).toHaveLength(1);
    expect(events.filter(({ phase }) => phase === 'finish')).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'guard', channel: 'webview', state: 'queued' }),
      expect.objectContaining({ phase: 'parse', channel: 'webview', status: 200 })
    ]));
  });

  it('records a queued WebView request replaced by a newer request as stale without notifying the user', async () => {
    const lines: string[] = [];
    const notify = vi.fn();
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )), vi.fn(), notify);

    const firstUrl = 'https://www.nodeseek.com/post-101-1';
    const secondUrl = 'https://www.nodeseek.com/post-102-1';
    const latestUrl = 'https://www.nodeseek.com/post-103-1';
    const first = controller.forumFetchWithWebViewFallback(firstUrl);
    await vi.waitFor(() => expect(lines.filter((line) => JSON.parse(line).state === 'queued')).toHaveLength(1));
    const replaced = controller.forumFetchWithWebViewFallback(secondUrl);
    await vi.waitFor(() => expect(lines.filter((line) => JSON.parse(line).state === 'queued')).toHaveLength(2));
    const latest = controller.forumFetchWithWebViewFallback(latestUrl);

    await expect(replaced).rejects.toThrow('请求已被新请求替代');
    const browserEvents = lines
      .map((line) => JSON.parse(line))
      .filter(({ area, operation }) => area === 'webview' && operation === 'browser-fetch');
    const replacedTraceId = browserEvents.filter(({ phase }) => phase === 'intent')[1]?.traceId;
    expect(browserEvents.filter(({ traceId, phase }) => traceId === replacedTraceId && phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'stale', reason: 'superseded' })
    ]);
    expect(browserEvents.filter(({ traceId, phase }) => traceId === replacedTraceId && phase === 'finish'))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'failure' })]));
    expect(notify).not.toHaveBeenCalled();

    await controller.completeNodeSeekBrowserFetch({ id: 1, url: firstUrl, html: '<html>first</html>' });
    await expect(first).resolves.toBeInstanceOf(Response);
    await controller.completeNodeSeekBrowserFetch({ id: 3, url: latestUrl, html: '<html>latest</html>' });
    await expect(latest).resolves.toBeInstanceOf(Response);
  });

  it('settles a browser fetch request only once', () => {
    const timeout = setTimeout(() => undefined, 10_000);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const request: BrowserFetchRequestCleanupTarget & { settled?: boolean } = { timeout };
    const settle = vi.fn();

    const first = settleBrowserFetchRequestOnce(request, settle);
    const second = settleBrowserFetchRequestOnce(request, settle);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(request.timeout).toBeUndefined();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);

    clearTimeoutSpy.mockRestore();
  });

  it('removes abort listeners and handler references after settling', () => {
    const abortSignal = {
      removeEventListener: vi.fn()
    } as unknown as AbortSignal;
    const abortHandler = vi.fn();
    const request: BrowserFetchRequestCleanupTarget = { abortHandler, abortSignal };

    settleBrowserFetchRequestOnce(request, vi.fn());

    expect(abortSignal.removeEventListener).toHaveBeenCalledWith('abort', abortHandler);
    expect(request.abortHandler).toBeUndefined();
  });

  it('does not wait indefinitely for best-effort follow-up work', async () => {
    vi.useFakeTimers();
    try {
      const task = vi.fn(() => new Promise<void>(() => undefined));
      const done = runBestEffortTask(task, 100);
      let completed = false;
      void done.then(() => {
        completed = true;
      });

      await vi.advanceTimersByTimeAsync(99);
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await done;

      expect(completed).toBe(true);
      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows best-effort follow-up failures', async () => {
    await expect(runBestEffortTask(() => {
      throw new Error('persist failed');
    }, 100)).resolves.toBeUndefined();
  });

  it('runs credential writes in order for the same generation', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];

    await Promise.all([
      enqueueCredentialWrite(gate, async () => {
        writes.push('first');
      }),
      enqueueCredentialWrite(gate, async () => {
        writes.push('second');
      })
    ]);

    expect(writes).toEqual(['first', 'second']);
  });

  it('invalidates stale credential writes after a clear generation starts', async () => {
    const gate = createCredentialWriteGate();
    const releaseFirstWrite = Promise.withResolvers<void>();
    const writes: string[] = [];
    const staleGeneration = gate.generation;
    const firstWrite = enqueueCredentialWrite(gate, async ({ isCurrent }) => {
      await releaseFirstWrite.promise;
      if (isCurrent()) {
        writes.push('stale-save');
      }
    });

    const clearWrite = enqueueCredentialWrite(gate, async () => {
      writes.push('clear');
    }, { advanceGeneration: true });

    expect(isCredentialWriteCurrent(gate, staleGeneration)).toBe(false);
    releaseFirstWrite.resolve();
    await Promise.all([firstWrite, clearWrite]);

    expect(writes).toEqual(['clear']);
  });

  it('does not let async work started before a clear enqueue a fresh credential write later', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];
    const staleGeneration = gate.generation;

    advanceCredentialWriteGeneration(gate);
    await enqueueCredentialWriteForGeneration(gate, staleGeneration, () => {
      writes.push('stale-save');
    });

    expect(writes).toEqual([]);
  });

  it('skips conditional clears after a newer credential generation exists', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];
    const staleGeneration = gate.generation;

    await enqueueCredentialWrite(gate, () => {
      writes.push('new-save');
    }, { advanceGeneration: true });
    await enqueueCredentialWriteForGeneration(gate, staleGeneration, () => {
      writes.push('stale-clear');
    });

    expect(writes).toEqual(['new-save']);
  });

  it('advances credential generation when replacing credentials', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];
    const staleGeneration = gate.generation;

    await replaceCredentialWrite(gate, () => {
      writes.push('new-login');
    });
    await enqueueCredentialWriteForGeneration(gate, staleGeneration, () => {
      writes.push('stale-clear');
    });

    expect(writes).toEqual(['new-login']);
  });

  it('atomically advances a matching generation before a conditional clear runs', async () => {
    const gate = createCredentialWriteGate();
    const releaseOldWrite = Promise.withResolvers<void>();
    const writes: string[] = [];
    const generation = gate.generation;
    const oldWrite = enqueueCredentialWriteForGeneration(gate, generation, async ({ isCurrent }) => {
      await releaseOldWrite.promise;
      if (isCurrent()) {
        writes.push('old-write');
      }
    });

    const clear = replaceCredentialWriteForGeneration(gate, generation, () => {
      writes.push('clear');
    });
    expect(gate.generation).toBe(generation + 1);
    releaseOldWrite.resolve();
    await Promise.all([oldWrite, clear]);

    expect(writes).toEqual(['clear']);
  });

  it('does not advance or run a conditional clear for a stale generation', async () => {
    const gate = createCredentialWriteGate();
    const staleGeneration = gate.generation;
    advanceCredentialWriteGeneration(gate);
    const currentGeneration = gate.generation;
    const clear = vi.fn();

    await replaceCredentialWriteForGeneration(gate, staleGeneration, clear);

    expect(clear).not.toHaveBeenCalled();
    expect(gate.generation).toBe(currentGeneration);
  });

  it('starts the next non-aborted browser fetch request', () => {
    const rejected = vi.fn();
    const active = {
      id: 2,
      url: 'https://linux.do/t/1',
      reject: vi.fn()
    };
    const currentRef = { current: null };
    const queueRef = {
      current: [
        {
          id: 1,
          url: 'https://linux.do/aborted',
          abortSignal: { aborted: true },
          reject: rejected
        },
        active
      ]
    };
    const setActiveRequest = vi.fn();

    startNextBrowserFetchRequest({
      currentRef,
      queueRef,
      setActiveRequest,
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      rejectCurrent: vi.fn()
    });

    expect(rejected).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(currentRef.current).toBe(active);
    expect(setActiveRequest).toHaveBeenCalledWith({
      id: 2,
      url: 'https://linux.do/t/1',
      cookie: undefined,
      userAgent: undefined
    });
  });

  it('starts browser fetch timeout after a queued request becomes active', async () => {
    vi.useFakeTimers();
    try {
      const queued = {
        id: 1,
        url: 'https://www.nodeseek.com/post-1-1',
        deadlineMs: Date.now() - 1,
        reject: vi.fn()
      };
      const currentRef = { current: null };
      const queueRef = { current: [queued] };
      const setActiveRequest = vi.fn();
      const rejectCurrent = vi.fn((request: typeof queued, message: string) => {
        request.reject(new Error(message));
      });

      startNextBrowserFetchRequest({
        currentRef,
        queueRef,
        setActiveRequest,
        timeoutMs: 15000,
        timeoutMessage: 'timeout',
        rejectCurrent
      });

      expect(currentRef.current).toBe(queued);
      expect(queued.reject).not.toHaveBeenCalled();
      expect(setActiveRequest).toHaveBeenCalledWith({
        id: 1,
        url: 'https://www.nodeseek.com/post-1-1',
        cookie: undefined,
        userAgent: undefined
      });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(rejectCurrent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(rejectCurrent).toHaveBeenCalledWith(queued, 'timeout');
      expect(queued.reject).toHaveBeenCalledWith(new Error('timeout'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a queued browser fetch request without touching the active request', () => {
    const active = {
      id: 1,
      url: 'https://linux.do/t/1',
      reject: vi.fn()
    };
    const queued = {
      id: 2,
      url: 'https://linux.do/t/2',
      reject: vi.fn()
    };
    const currentRef = { current: active };
    const queueRef = { current: [queued] };
    const setActiveRequest = vi.fn();
    const startNext = vi.fn();

    rejectBrowserFetchRequest({
      request: queued,
      message: '取消',
      currentRef,
      queueRef,
      setActiveRequest,
      startNext
    });

    expect(currentRef.current).toBe(active);
    expect(queueRef.current).toEqual([]);
    expect(queued.reject).toHaveBeenCalledWith(new Error('取消'));
    expect(setActiveRequest).not.toHaveBeenCalled();
    expect(startNext).toHaveBeenCalledTimes(1);
  });

  it('can reject an active browser fetch request without stopping a gone WebView renderer', () => {
    const active = {
      id: 1,
      url: 'https://www.nodeseek.com/post-1-1',
      reject: vi.fn()
    };
    const currentRef = { current: active };
    const queueRef = { current: [] };
    const setActiveRequest = vi.fn();
    const startNext = vi.fn();
    const webViewRef = { current: { stopLoading: vi.fn() } };

    rejectBrowserFetchRequest({
      request: active,
      message: 'NodeSeek 页面读取进程已停止',
      currentRef,
      queueRef,
      setActiveRequest,
      startNext,
      webViewRef,
      skipStopLoading: true
    });

    expect(webViewRef.current.stopLoading).not.toHaveBeenCalled();
    expect(currentRef.current).toBeNull();
    expect(active.reject).toHaveBeenCalledTimes(1);
    expect(active.reject).toHaveBeenCalledWith(new Error('NodeSeek 页面读取进程已停止'));
    expect(setActiveRequest).toHaveBeenCalledWith(null);
    expect(startNext).toHaveBeenCalledTimes(1);
  });

  it('preempts an active background browser fetch with a foreground request', () => {
    const active: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const incoming: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/post-2-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };
    const currentRef: { current: BrowserFetchQueueRequest | null } = { current: active };
    const rejectCurrent = vi.fn((request: BrowserFetchQueueRequest) => {
      if (currentRef.current?.id === request.id) {
        currentRef.current = null;
      }
    });

    const preempted = preemptActiveBrowserFetchRequest({
      currentRef,
      request: incoming,
      message: '请求已被新的前台读取替换',
      rejectCurrent
    });

    expect(preempted).toBe(true);
    expect(rejectCurrent).toHaveBeenCalledWith(active, '请求已被新的前台读取替换');
    expect(currentRef.current).toBeNull();
  });

  it('starts the incoming foreground request instead of a stale queued read after preemption', () => {
    const active: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const staleQueuedRead: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/page-2',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const incoming: BrowserFetchQueueRequest = {
      id: 3,
      url: 'https://www.nodeseek.com/post-3-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };
    const currentRef = { current: active };
    const queueRef = { current: [staleQueuedRead] };
    const setActiveRequest = vi.fn();
    const rejectCurrent = (request: BrowserFetchQueueRequest, message: string) => {
      rejectBrowserFetchRequest({
        request,
        message,
        currentRef,
        queueRef,
        setActiveRequest,
        startNext: () => startNextBrowserFetchRequest({
          currentRef,
          queueRef,
          setActiveRequest,
          timeoutMs: 15000,
          timeoutMessage: 'timeout',
          rejectCurrent: vi.fn()
        })
      });
    };

    enqueueLatestBrowserFetchRequest({
      queueRef,
      request: incoming,
      message: REQUEST_SUPERSEDED_MESSAGE,
      shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
    });
    preemptActiveBrowserFetchRequest({
      currentRef,
      request: incoming,
      message: '请求已被新的前台读取替换',
      rejectCurrent
    });

    expect(staleQueuedRead.reject).toHaveBeenCalledWith(new Error(REQUEST_SUPERSEDED_MESSAGE));
    expect(active.reject).toHaveBeenCalledWith(new Error('请求已被新的前台读取替换'));
    expect(currentRef.current).toBe(incoming);
    expect(setActiveRequest).toHaveBeenLastCalledWith({
      id: 3,
      url: 'https://www.nodeseek.com/post-3-1',
      cookie: undefined,
      userAgent: undefined
    });
  });

  it('does not let ordinary reads preempt a NodeSeek write request', () => {
    const writeRequest: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/api/comment/reply',
      browserFetchIntent: { owner: 'write', priority: 'write', cancelable: false },
      reject: vi.fn()
    };
    const foregroundRead: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/post-2-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };

    expect(shouldPreemptBrowserFetchRequest(writeRequest, foregroundRead)).toBe(false);
  });

  it('keeps queued NodeSeek writes when a newer read request replaces stale reads', () => {
    const queuedWrite: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/api/comment/reply',
      browserFetchIntent: { owner: 'write', priority: 'write', cancelable: false },
      reject: vi.fn()
    };
    const staleRead: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const latestRead: BrowserFetchQueueRequest = {
      id: 3,
      url: 'https://www.nodeseek.com/post-3-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };
    const queueRef = { current: [queuedWrite, staleRead] };

    enqueueLatestBrowserFetchRequest({
      queueRef,
      request: latestRead,
      message: REQUEST_SUPERSEDED_MESSAGE,
      shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
    });

    expect(queueRef.current).toEqual([queuedWrite, latestRead]);
    expect(queuedWrite.reject).not.toHaveBeenCalled();
    expect(staleRead.reject).toHaveBeenCalledWith(new Error(REQUEST_SUPERSEDED_MESSAGE));
    expect(latestRead.reject).not.toHaveBeenCalled();
  });

  it('releases the queued browser fetch after a renderer crash rejects the active one', () => {
    vi.useFakeTimers();
    try {
      const active: BrowserFetchQueueRequest = {
        id: 1,
        url: 'https://www.nodeseek.com/post-1-1',
        reject: vi.fn()
      };
      const queued: BrowserFetchQueueRequest = {
        id: 2,
        url: 'https://www.nodeseek.com/post-2-1',
        reject: vi.fn()
      };
      const currentRef = { current: active };
      const queueRef = { current: [queued] };
      const setActiveRequest = vi.fn();
      const rejectCurrent = vi.fn((request: BrowserFetchQueueRequest, message: string) => {
        request.reject(new Error(message));
      });
      const startNext = () => startNextBrowserFetchRequest({
        currentRef,
        queueRef,
        setActiveRequest,
        timeoutMs: 15000,
        timeoutMessage: 'timeout',
        rejectCurrent
      });
      const webViewRef = { current: { stopLoading: vi.fn() } };

      rejectBrowserFetchRequest({
        request: active,
        message: 'NodeSeek 页面读取进程已停止',
        currentRef,
        queueRef,
        setActiveRequest,
        startNext,
        webViewRef,
        skipStopLoading: true
      });

      expect(webViewRef.current.stopLoading).not.toHaveBeenCalled();
      expect(active.reject).toHaveBeenCalledWith(new Error('NodeSeek 页面读取进程已停止'));
      expect(currentRef.current).toBe(queued);
      expect(queueRef.current).toEqual([]);
      expect(setActiveRequest).toHaveBeenLastCalledWith({
        id: 2,
        url: 'https://www.nodeseek.com/post-2-1',
        cookie: undefined,
        userAgent: undefined
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps only the latest queued browser fetch request', () => {
    const first = {
      id: 1,
      url: 'https://linux.do/t/1',
      reject: vi.fn()
    };
    const second = {
      id: 2,
      url: 'https://linux.do/t/2',
      reject: vi.fn()
    };
    const latest = {
      id: 3,
      url: 'https://linux.do/t/3',
      reject: vi.fn()
    };
    const queueRef = { current: [first, second] };

    enqueueLatestBrowserFetchRequest({
      queueRef,
      request: latest,
      message: REQUEST_SUPERSEDED_MESSAGE
    });

    expect(queueRef.current).toEqual([latest]);
    expect(first.reject).toHaveBeenCalledWith(new Error(REQUEST_SUPERSEDED_MESSAGE));
    expect(second.reject).toHaveBeenCalledWith(new Error(REQUEST_SUPERSEDED_MESSAGE));
    expect(latest.reject).not.toHaveBeenCalled();
  });

  it('clears browser challenge response bodies even if a script sends page HTML', async () => {
    await expect(nodeSeekBrowserResponse('<html>challenge</html>', true).text()).resolves.toBe('');
    await expect(linuxDoBrowserResponse('<html>challenge</html>', true).text()).resolves.toBe('');
  });

  it('takes a pending NodeSeek topic verification retry only once', () => {
    const topic = { source: 'nodeseek' as const, id: '42' };
    const searchRetryRef = { current: null };
    const topicRetryRef = { current: topic };

    expect(takeNodeSeekVerificationRetry(searchRetryRef, topicRetryRef)).toEqual({
      type: 'topic',
      topic
    });
    expect(takeNodeSeekVerificationRetry(searchRetryRef, topicRetryRef)).toBeNull();
  });

  it('keeps existing NodeSeek search verification retry ahead of topic retry', () => {
    const retry = vi.fn();
    const topic = { source: 'nodeseek' as const, id: '42' };
    const searchRetryRef = { current: retry };
    const topicRetryRef = { current: topic };

    expect(takeNodeSeekVerificationRetry(searchRetryRef, topicRetryRef)).toEqual({
      type: 'search',
      retry
    });
    expect(searchRetryRef.current).toBeNull();
    expect(topicRetryRef.current).toBeNull();
  });

  it('handles document HTTP errors after allowed redirects', () => {
    const isAllowed = (url: string) => new URL(url).hostname.endsWith('nodeseek.com');

    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://www.nodeseek.com/post-1-1/',
      isAllowed
    )).toBe(true);
    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://www.nodeseek.com/login',
      isAllowed
    )).toBe(true);
  });

  it('ignores off-site and static resource HTTP errors in hidden browser pages', () => {
    const isAllowed = (url: string) => new URL(url).hostname.endsWith('nodeseek.com');

    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://example.com/login',
      isAllowed
    )).toBe(false);
    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://www.nodeseek.com/assets/missing.png',
      isAllowed
    )).toBe(false);
  });

  it('does not read the current NodeSeek profile while loading credentials', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/useSessionController.ts'), 'utf8');

    expect(source).not.toContain('getNodeSeekCurrentUserProfile');
    expect(source).not.toContain('restoreNodeSeekIdentityForAccess');
  });

  it('accepts NodeSeek topic identity only through the logged-in session guard', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/AppRoot.tsx'), 'utf8');

    expect(source).toContain('const nodeSeekTopicCurrentUser = nodeSeekTopicCurrentUserForSession(');
    expect(source).toContain('const currentUser = nodeSeekTopicCurrentUser;');
    expect(source).not.toContain("const currentUser = topicDetail?.source === 'nodeseek' ? topicDetail.currentUser : undefined;");
  });

  it('starts account refresh silently without using stale NodeSeek page state', () => {
    const appRootSource = readFileSync(path.join(process.cwd(), 'src/app/AppRoot.tsx'), 'utf8');
    const refreshSource = readFileSync(path.join(process.cwd(), 'src/app/useAccountStatusController.ts'), 'utf8');

    expect(appRootSource).toContain('refreshAccountStatus({ silent: true })');
    expect(appRootSource).not.toContain('nodeSeekUserId: webLoginUserId');
    expect(refreshSource).toContain('captureNodeSeekUserId');
    expect(refreshSource).toContain('nodeSeekUserId: nodeSeekCredentialUserId');
  });

  it('claims the starting generation when saving a manually confirmed Yaohuo login', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    vi.mocked(SecureStore.setItemAsync).mockClear();
    const controller = createTestSessionController();
    const generation = controller.currentYaohuoCredentialGeneration();

    await expect(controller.saveYaohuoCookieHeader('sidyaohuo=new', { generation })).resolves.toBe(true);
    expect(controller.currentYaohuoCredentialGeneration()).toBe(generation + 1);
    await expect(controller.saveYaohuoCookieHeader('sidyaohuo=old', { generation })).resolves.toBe(false);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });
});
