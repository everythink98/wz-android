import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { effect(); },
  useLayoutEffect: (effect: () => void) => effect(),
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
vi.mock('react-native', () => ({ NativeModules: { LinuxDoCookieModule: {} } }));
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  enqueueCredentialWrite,
  enqueueLatestBrowserFetchRequest,
  isCredentialWriteCurrent,
  nodeSeekMediaCookieHeaderAfterCredentialLoad,
  nodeSeekBrowserResponse,
  preemptActiveBrowserFetchRequest,
  replaceCredentialWrite,
  rejectBrowserFetchRequest,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  shouldHandleBrowserHttpError,
  shouldKeepQueuedBrowserFetchRequest,
  shouldPreemptBrowserFetchRequest,
  siteSessionEventInvalidatesForumQueries,
  startNextBrowserFetchRequest,
  takeNodeSeekVerificationRetry,
  type BrowserFetchQueueRequest,
  type BrowserFetchRequestCleanupTarget,
  type NodeSeekVerificationRetry
} from './sessionControllerHelpers';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from '../diagnostics';
import type { Fetcher } from '../request';
import { useSessionController } from './useSessionController';
import { saveLinuxDoAccess } from '../linuxdoCookieBridge';

afterEach(() => {
  setDiagnosticWriter(null);
});

function createTestSessionController(
  defaultFetcher: Fetcher = vi.fn(),
  setWebLoginUserId = vi.fn(),
  notify = vi.fn(),
  overrides: Partial<Parameters<typeof useSessionController>[0]> = {}
) {
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
    setNodeSeekMediaCookieHeader: vi.fn(),
    setNodeSeekWebViewUserAgent: vi.fn(),
    setWebLoginUserId,
    webLoginDetectedRef: { current: false },
    ...overrides
  });
}

describe('session controller helpers', () => {
  it('invalidates source queries only when session credentials can have changed', () => {
    expect(siteSessionEventInvalidatesForumQueries({
      type: 'cookie-loaded',
      cookieSummary: ['session'],
      hasVerification: true,
      loggedIn: true
    })).toBe(false);
    expect(siteSessionEventInvalidatesForumQueries({
      type: 'session-updated',
      cookieSummary: ['session'],
      hasVerification: true,
      loggedIn: true
    })).toBe(true);
    expect(siteSessionEventInvalidatesForumQueries({ type: 'check-failed', message: 'offline' })).toBe(false);
    expect(siteSessionEventInvalidatesForumQueries({ type: 'login-detected' })).toBe(true);
    expect(siteSessionEventInvalidatesForumQueries({
      type: 'verification-succeeded',
      loggedIn: false,
      at: '2026-07-20T00:00:00.000Z'
    })).toBe(false);
    expect(siteSessionEventInvalidatesForumQueries({ type: 'login-expired' })).toBe(true);
    expect(siteSessionEventInvalidatesForumQueries({ type: 'cleared' })).toBe(true);
  });

  it('publishes an explicit credential update when a new NodeSeek cookie generation is saved', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();

    await controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login-cookie' }
    });

    expect(lines.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({
      area: 'session',
      operation: 'state-transition',
      eventType: 'session-updated'
    }));
  });

  it('[REG-LINUXDO-005] does not treat stored linux.do login cookies as a confirmed session', async () => {
    const lines: string[] = [];
    const getItemAsync = vi.mocked(SecureStore.getItemAsync);
    getItemAsync.mockImplementation(async (key) => key === 'linuxdo-clearance'
      ? JSON.stringify({
        cookieHeader: 'cf_clearance=saved-clearance; _t=expired-login; _forum_session=expired-session',
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'webview'
      })
      : null);
    setDiagnosticWriter((line) => { lines.push(line); });

    createTestSessionController();

    await vi.waitFor(() => {
      const transition = lines
        .map((line) => JSON.parse(line))
        .find(({ operation, phase, source }) => (
          operation === 'state-transition'
          && phase === 'apply'
          && source === 'linuxdo'
        ));
      expect(transition).toMatchObject({
        eventType: 'cookie-loaded',
        previousState: 'anonymous',
        nextState: 'verified'
      });
    });

    getItemAsync.mockResolvedValue(null);
  });

  it.each([
    ['NodeSeek', 'clearNodeSeekLoginState'],
    ['妖火', 'clearYaohuoLoginState']
  ] as const)('REG-ACCOUNT-007 does not report %s cleared when WebView cookie cleanup fails', async (siteLabel, command) => {
    const lines: string[] = [];
    const getCookies = vi.mocked(CookieManager.get);
    getCookies.mockResolvedValue({});
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    lines.length = 0;
    getCookies.mockRejectedValueOnce(new Error('WebView cookie store unavailable'));

    await expect(controller[command]()).rejects.toThrow('WebView cookie store unavailable');

    const transitions = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
    expect(transitions.at(-1)).toMatchObject({ eventType: 'check-failed' });
    expect(transitions.map(({ eventType }) => eventType)).not.toContain('cleared');
    expect(transitions.at(-1)?.source).toBe(siteLabel === 'NodeSeek' ? 'nodeseek' : 'yaohuo');
  });

  it('REG-ACCOUNT-007 clears the Yaohuo WebView cookies after deleting the stored header', async () => {
    const lines: string[] = [];
    const getCookies = vi.mocked(CookieManager.get);
    getCookies.mockResolvedValue({ sidyaohuo: { name: 'sidyaohuo', value: 'saved' } });
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    lines.length = 0;
    getCookies.mockClear();

    await controller.clearYaohuoLoginState();

    expect(getCookies).toHaveBeenCalledWith('https://www.yaohuo.me');
    const transitions = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
    expect(transitions.at(-1)).toMatchObject({ source: 'yaohuo', eventType: 'cleared' });
  });

  it('REG-ACCOUNT-009 stops a stale NodeSeek clear before WebView cleanup and session commit', async () => {
    const lines: string[] = [];
    const firstDelete = Promise.withResolvers<void>();
    const deleteItemAsync = vi.mocked(SecureStore.deleteItemAsync);
    deleteItemAsync.mockReset();
    deleteItemAsync.mockImplementationOnce(() => firstDelete.promise);
    deleteItemAsync.mockResolvedValue(undefined);
    vi.mocked(CookieManager.get).mockReset();
    vi.mocked(CookieManager.get).mockResolvedValue({});
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    lines.length = 0;
    vi.mocked(CookieManager.get).mockClear();

    const clear = controller.clearNodeSeekLoginState();
    await vi.waitFor(() => expect(deleteItemAsync).toHaveBeenCalled());
    const save = controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login-cookie' }
    });
    firstDelete.resolve();
    await Promise.all([clear, save]);

    const transitions = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
    expect(transitions.map(({ eventType }) => eventType)).not.toContain('cleared');
    expect(vi.mocked(CookieManager.get)).not.toHaveBeenCalled();
  });

  it('REG-ACCOUNT-009 preserves the newer NodeSeek media credential when an old load returns empty', () => {
    expect(nodeSeekMediaCookieHeaderAfterCredentialLoad({
      currentHeader: 'session=new-login-cookie',
      loadedHeader: undefined,
      generationIsCurrent: false
    })).toBe('session=new-login-cookie');
  });

  it('REG-ACCOUNT-009 reports a superseded Yaohuo clear and leaves the newer WebView session alone', async () => {
    const lines: string[] = [];
    const firstDelete = Promise.withResolvers<void>();
    const deleteItemAsync = vi.mocked(SecureStore.deleteItemAsync);
    deleteItemAsync.mockReset();
    deleteItemAsync.mockImplementationOnce(() => firstDelete.promise);
    deleteItemAsync.mockResolvedValue(undefined);
    vi.mocked(CookieManager.get).mockReset();
    vi.mocked(CookieManager.get).mockResolvedValue({});
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    lines.length = 0;
    vi.mocked(CookieManager.get).mockClear();

    const clear = controller.clearYaohuoLoginState();
    await vi.waitFor(() => expect(deleteItemAsync).toHaveBeenCalled());
    const save = controller.saveYaohuoCookieHeader('sidyaohuo=new-login-cookie');
    firstDelete.resolve();
    const [cleared] = await Promise.all([clear, save]);

    expect(cleared).toBe(false);
    const transitions = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
    expect(transitions.map(({ eventType }) => eventType)).not.toContain('cleared');
    expect(vi.mocked(CookieManager.get)).not.toHaveBeenCalled();
  });

  it('REG-ACCOUNT-009 stops a NodeSeek clear superseded during WebView cookie discovery', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    lines.length = 0;
    const cookieRead = Promise.withResolvers<Record<string, { name: string; value: string }>>();
    vi.mocked(CookieManager.get).mockReset();
    vi.mocked(CookieManager.get).mockReturnValue(cookieRead.promise);
    vi.mocked(CookieManager.setFromResponse).mockClear();

    const clear = controller.clearNodeSeekLoginState();
    await vi.waitFor(() => expect(CookieManager.get).toHaveBeenCalled());
    const save = controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-login-cookie' }
    });
    cookieRead.resolve({ session: { name: 'session', value: 'old-login-cookie' } });
    const [cleared] = await Promise.all([clear, save]);

    expect(cleared).toBe(false);
    expect(CookieManager.setFromResponse).not.toHaveBeenCalled();
    const transitions = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
    expect(transitions.map(({ eventType }) => eventType)).not.toContain('cleared');
  });

  it('REG-ACCOUNT-009 stops a Yaohuo clear superseded during WebView cookie discovery', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    lines.length = 0;
    const cookieRead = Promise.withResolvers<Record<string, { name: string; value: string }>>();
    vi.mocked(CookieManager.get).mockReset();
    vi.mocked(CookieManager.get).mockReturnValue(cookieRead.promise);
    vi.mocked(CookieManager.setFromResponse).mockClear();

    const clear = controller.clearYaohuoLoginState();
    await vi.waitFor(() => expect(CookieManager.get).toHaveBeenCalled());
    const save = controller.saveYaohuoCookieHeader('sidyaohuo=new-login-cookie');
    cookieRead.resolve({ sidyaohuo: { name: 'sidyaohuo', value: 'old-login-cookie' } });
    const [cleared] = await Promise.all([clear, save]);

    expect(cleared).toBe(false);
    expect(CookieManager.setFromResponse).not.toHaveBeenCalled();
    const transitions = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
    expect(transitions.map(({ eventType }) => eventType)).not.toContain('cleared');
  });

  it('REG-ACCOUNT-009 suppresses an old Yaohuo storage error after a newer credential save starts', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    const oldRead = Promise.withResolvers<string | null>();
    vi.mocked(SecureStore.getItemAsync).mockReset();
    vi.mocked(SecureStore.getItemAsync).mockReturnValueOnce(oldRead.promise);

    const load = controller.loadYaohuoCookieForSource('yaohuo');
    const save = controller.saveYaohuoCookieHeader('sidyaohuo=new-login-cookie');
    oldRead.reject(new Error('old SecureStore read failed'));

    await expect(load).resolves.toBeUndefined();
    await expect(save).resolves.toBe(true);
  });

  it('REG-ACCOUNT-009 suppresses an old NodeSeek storage error after a newer credential save starts', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    const oldRead = Promise.withResolvers<string | null>();
    vi.mocked(CookieManager.get).mockResolvedValue({});
    vi.mocked(SecureStore.getItemAsync).mockReset();
    vi.mocked(SecureStore.getItemAsync).mockReturnValueOnce(oldRead.promise);
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);

    const load = controller.loadNodeSeekCookieForSource('nodeseek');
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalled());
    const save = controller.saveNodeSeekCookieHeader(
      { session: { name: 'session', value: 'new-login-cookie' } },
      { csrfToken: null, userId: null }
    );
    oldRead.reject(new Error('old SecureStore read failed'));

    await expect(load).resolves.toBeUndefined();
    await expect(save).resolves.toBeTruthy();
  });

  it('[REG-ACCOUNT-014] rejects a corrupted saved NodeSeek session instead of treating it as anonymous', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    vi.mocked(CookieManager.get).mockResolvedValue({});
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    vi.mocked(SecureStore.getItemAsync).mockReset();
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => (
      key === 'nodeseek-access' ? '{bad json' : null
    ));
    vi.mocked(SecureStore.deleteItemAsync).mockClear();

    await expect(controller.loadNodeSeekCookieForSource('nodeseek')).rejects.toThrow('NodeSeek 登录配置已损坏');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith('nodeseek-access');
  });

  it('REG-ACCOUNT-007 keeps NodeSeek expired when login-cookie cleanup cannot read the store', async () => {
    const lines: string[] = [];
    const getItemAsync = vi.mocked(SecureStore.getItemAsync);
    getItemAsync.mockResolvedValue(null);
    vi.mocked(CookieManager.get).mockResolvedValue({});
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();
    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'load-stored' && event.phase === 'finish';
    })).toBe(true));
    lines.length = 0;
    getItemAsync.mockRejectedValueOnce(new Error('SecureStore unavailable'));

    await expect(controller.clearNodeSeekLoginCookiesOnly({
      expiredMessage: 'NodeSeek 登录已失效'
    })).rejects.toThrow('SecureStore unavailable');

    const transitions = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
    expect(transitions.at(-1)).toMatchObject({
      source: 'nodeseek',
      eventType: 'login-expired'
    });
  });

  it('REG-ACCOUNT-003 restores unaffected sessions when one startup credential read fails', async () => {
    const lines: string[] = [];
    const notify = vi.fn();
    const getItemAsync = vi.mocked(SecureStore.getItemAsync);
    getItemAsync.mockImplementation(async (key) => {
      if (key === 'nodeseek-access') {
        throw new Error('NodeSeek storage unavailable');
      }
      if (key === 'yaohuo-cookie-header') {
        return 'sidyaohuo=saved-session';
      }
      if (key === 'linuxdo-clearance') {
        return JSON.stringify({
          cookieHeader: '_t=saved-login; cf_clearance=saved-clearance',
          savedAt: '2026-07-19T00:00:00.000Z',
          source: 'webview'
        });
      }
      return null;
    });
    setDiagnosticWriter((line) => { lines.push(line); });

    createTestSessionController(vi.fn(), vi.fn(), notify);

    await vi.waitFor(() => {
      const transitions = lines
        .map((line) => JSON.parse(line))
        .filter(({ operation, phase }) => operation === 'state-transition' && phase === 'intent');
      expect(transitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'nodeseek', eventType: 'check-failed' }),
        expect.objectContaining({ source: 'linuxdo', eventType: 'cookie-loaded' }),
        expect.objectContaining({ source: 'yaohuo', eventType: 'cookie-loaded' })
      ]));
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('NodeSeek'));
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('LinuxDo storage unavailable'));

    getItemAsync.mockResolvedValue(null);
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

  it('REG-ACCOUNT-009 does not let an old NodeSeek hidden read replace a newer in-memory session', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const nodeSeekWebViewCookieHeaderRef = { current: '' };
    const setNodeSeekWebViewUserAgent = vi.fn();
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )), vi.fn(), vi.fn(), {
      nodeSeekWebViewCookieHeaderRef,
      setNodeSeekWebViewUserAgent
    });
    const url = 'https://www.nodeseek.com/post-credential-generation-1';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-session' }
    }, { verifiedByPage: true });
    nodeSeekWebViewCookieHeaderRef.current = 'session=new-session';
    setNodeSeekWebViewUserAgent.mockClear();

    await controller.completeNodeSeekBrowserFetch({
      id: 1,
      url,
      html: '<html>old session body</html>',
      cookie: 'session=old-session',
      userAgent: 'old-user-agent'
    });
    await expect(responsePromise).rejects.toThrow('请求已取消');

    expect(nodeSeekWebViewCookieHeaderRef.current).toBe('session=new-session');
    expect(setNodeSeekWebViewUserAgent).not.toHaveBeenCalledWith('old-user-agent');
  });

  it('REG-ACCOUNT-012 preserves the current NodeSeek session when a hidden read reports only document cookies', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const nodeSeekWebViewCookieHeaderRef = { current: 'session=current-session' };
    const setNodeSeekMediaCookieHeader = vi.fn();
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )), vi.fn(), vi.fn(), {
      nodeSeekWebViewCookieHeaderRef,
      setNodeSeekMediaCookieHeader
    });
    const url = 'https://www.nodeseek.com/post-document-cookie-merge-1';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await controller.completeNodeSeekBrowserFetch({
      id: 1,
      url,
      html: '<html>rendered body</html>',
      cookie: 'cf_clearance=fresh-clearance'
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);

    expect(nodeSeekWebViewCookieHeaderRef.current).toContain('session=current-session');
    expect(nodeSeekWebViewCookieHeaderRef.current).toContain('cf_clearance=fresh-clearance');
    expect(setNodeSeekMediaCookieHeader).toHaveBeenCalledWith(expect.stringContaining('session=current-session'));
    expect(setNodeSeekMediaCookieHeader).toHaveBeenCalledWith(expect.stringContaining('cf_clearance=fresh-clearance'));
  });

  it('REG-ACCOUNT-012 clears the NodeSeek media credential with the stored session', async () => {
    const nodeSeekWebViewCookieHeaderRef = { current: 'session=current-session' };
    const setNodeSeekMediaCookieHeader = vi.fn();
    const controller = createTestSessionController(vi.fn(), vi.fn(), vi.fn(), {
      nodeSeekWebViewCookieHeaderRef,
      setNodeSeekMediaCookieHeader
    });
    setNodeSeekMediaCookieHeader.mockClear();

    await controller.clearStoredNodeSeekLoginState();

    expect(nodeSeekWebViewCookieHeaderRef.current).toBe('');
    expect(setNodeSeekMediaCookieHeader).toHaveBeenCalledWith('');
  });

  it('REG-ACCOUNT-009 does not let an old linux.do hidden read replace a newer in-memory session', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const linuxDoWebViewCookieHeaderRef = { current: '' };
    const setLinuxDoWebViewCookieHeader = vi.fn();
    const setLinuxDoWebViewUserAgent = vi.fn();
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 429, headers: { 'cf-mitigated': 'challenge' } }
    )), vi.fn(), vi.fn(), {
      linuxDoWebViewCookieHeaderRef,
      setLinuxDoWebViewCookieHeader,
      setLinuxDoWebViewUserAgent
    });
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await saveLinuxDoAccess('cf_clearance=new-clearance; _t=new-session', 'new-user-agent');
    linuxDoWebViewCookieHeaderRef.current = 'cf_clearance=new-clearance; _t=new-session';
    setLinuxDoWebViewCookieHeader.mockClear();
    setLinuxDoWebViewUserAgent.mockClear();

    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      body: '{"topic_list":{"topics":[]}}',
      challenge: false,
      cookie: 'cf_clearance=old-clearance; _t=old-session',
      userAgent: 'old-user-agent'
    });
    await expect(responsePromise).rejects.toThrow('请求已取消');

    expect(linuxDoWebViewCookieHeaderRef.current).toBe('cf_clearance=new-clearance; _t=new-session');
    expect(setLinuxDoWebViewCookieHeader).not.toHaveBeenCalledWith('cf_clearance=old-clearance; _t=old-session');
    expect(setLinuxDoWebViewUserAgent).not.toHaveBeenCalledWith('old-user-agent');
  });

  it('REG-ACCOUNT-012 preserves the current linux.do session when a hidden read reports only document cookies', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const linuxDoWebViewCookieHeaderRef = { current: '_t=current-session; cf_clearance=old-clearance' };
    const setLinuxDoWebViewCookieHeader = vi.fn();
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 429, headers: { 'cf-mitigated': 'challenge' } }
    )), vi.fn(), vi.fn(), {
      linuxDoWebViewCookieHeaderRef,
      setLinuxDoWebViewCookieHeader
    });
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      body: '{"topic_list":{"topics":[]}}',
      challenge: false,
      cookie: 'cf_clearance=fresh-clearance'
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);

    expect(linuxDoWebViewCookieHeaderRef.current).toContain('_t=current-session');
    expect(linuxDoWebViewCookieHeaderRef.current).toContain('cf_clearance=fresh-clearance');
    expect(setLinuxDoWebViewCookieHeader).toHaveBeenCalledWith(expect.stringContaining('_t=current-session'));
  });

  it('REG-ACCOUNT-009 does not activate a queued NodeSeek hidden read after credentials change', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const firstUrl = 'https://www.nodeseek.com/post-generation-queue-1';
    const secondUrl = 'https://www.nodeseek.com/post-generation-queue-2';

    const first = controller.forumFetchWithWebViewFallback(firstUrl);
    await vi.waitFor(() => expect(lines.filter((line) => JSON.parse(line).state === 'queued')).toHaveLength(1));
    const second = controller.forumFetchWithWebViewFallback(secondUrl);
    const secondOutcome = second.then(() => 'resolved', (error) => (error as Error).message);
    await vi.waitFor(() => expect(lines.filter((line) => JSON.parse(line).state === 'queued')).toHaveLength(2));
    await controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'new-session' }
    }, { verifiedByPage: true });

    await controller.completeNodeSeekBrowserFetch({ id: 1, url: firstUrl, html: '<html>first</html>' });
    await expect(first).rejects.toThrow('请求已取消');
    await controller.completeNodeSeekBrowserFetch({ id: 2, url: secondUrl, html: '<html>second</html>' });

    await expect(secondOutcome).resolves.toContain('请求已取消');
  });

  it('REG-ACCOUNT-009 does not activate a queued linux.do hidden read after credentials change', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 429, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const firstUrl = 'https://linux.do/latest.json?page=1';
    const secondUrl = 'https://linux.do/latest.json?page=2';

    const first = controller.forumFetchWithWebViewFallback(firstUrl);
    await vi.waitFor(() => expect(lines.filter((line) => JSON.parse(line).state === 'queued')).toHaveLength(1));
    const second = controller.forumFetchWithWebViewFallback(secondUrl);
    const secondOutcome = second.then(() => 'resolved', (error) => (error as Error).message);
    await vi.waitFor(() => expect(lines.filter((line) => JSON.parse(line).state === 'queued')).toHaveLength(2));
    await saveLinuxDoAccess('cf_clearance=new-clearance; _t=new-session', 'new-user-agent');

    await controller.completeLinuxDoBrowserFetch({ id: 1, url: firstUrl, body: '{}', challenge: false });
    await expect(first).rejects.toThrow('请求已取消');
    await controller.completeLinuxDoBrowserFetch({ id: 2, url: secondUrl, body: '{}', challenge: false });

    await expect(secondOutcome).resolves.toContain('请求已取消');
  });

  it('rejects a confirmed linux.do WebView challenge as a typed verification error', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 429, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => {
      expect(lines.some((line) => {
        const event = JSON.parse(line);
        return event.source === 'linuxdo' && event.channel === 'webview' && event.state === 'queued';
      })).toBe(true);
    });
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      challenge: true
    });

    await expect(responsePromise).rejects.toMatchObject({
      source: 'linuxdo',
      reason: 'cloudflare',
      verificationRequired: true
    });
  });

  it('keeps an oversized linux.do WebView body as an explicit transport failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    })));
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      challenge: false,
      error: 'linux.do 页面内容过大，已停止读取',
      failureReason: 'content-too-large'
    });

    await expect(responsePromise).rejects.toMatchObject({
      reason: 'content-too-large',
      message: 'linux.do 页面内容过大，已停止读取'
    });
  });

  it('records hidden linux.do cookie persistence as cookie-loaded, not verification success', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    })));
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      body: '{"topic_list":{"topics":[]}}',
      challenge: false,
      cookie: 'cf_clearance=private-value'
    });
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });

    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'state-transition' && event.eventType === 'cookie-loaded';
    })).toBe(true));
    expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'state-transition' && event.eventType === 'verification-succeeded';
    })).toBe(false);
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
      message: '请求已取消',
      shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
    });
    preemptActiveBrowserFetchRequest({
      currentRef,
      request: incoming,
      message: '请求已被新的前台读取替换',
      rejectCurrent
    });

    expect(staleQueuedRead.reject).toHaveBeenCalledWith(new Error('请求已取消'));
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
      message: '请求已取消',
      shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
    });

    expect(queueRef.current).toEqual([queuedWrite, latestRead]);
    expect(queuedWrite.reject).not.toHaveBeenCalled();
    expect(staleRead.reject).toHaveBeenCalledWith(new Error('请求已取消'));
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
      message: '请求已取消'
    });

    expect(queueRef.current).toEqual([latest]);
    expect(first.reject).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(second.reject).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(latest.reject).not.toHaveBeenCalled();
  });

  it('clears browser challenge response bodies even if a script sends page HTML', async () => {
    await expect(nodeSeekBrowserResponse('<html>challenge</html>', true).text()).resolves.toBe('');
  });

  it('takes a pending NodeSeek topic verification retry only once', () => {
    const retry = vi.fn(async () => true);
    const retryRef = { current: { type: 'topic', retry } as const };

    expect(takeNodeSeekVerificationRetry(retryRef)).toEqual({
      type: 'topic',
      retry
    });
    expect(takeNodeSeekVerificationRetry(retryRef)).toBeNull();
  });

  it('[REG-VERIFICATION-001] lets the latest NodeSeek recovery owner replace an older one', () => {
    const searchRetry = vi.fn(async () => true);
    const topicRetry = vi.fn(async () => true);
    const retryRef: { current: NodeSeekVerificationRetry | null } = {
      current: { type: 'search', retry: searchRetry }
    };
    retryRef.current = { type: 'topic', retry: topicRetry };

    expect(takeNodeSeekVerificationRetry(retryRef)).toEqual({
      type: 'topic',
      retry: topicRetry
    });
    expect(searchRetry).not.toHaveBeenCalled();
    expect(retryRef.current).toBeNull();
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

  it('starts account refresh silently without using stale NodeSeek page state', () => {
    const appRootSource = readFileSync(path.join(process.cwd(), 'src/app/AppRoot.tsx'), 'utf8');
    const refreshSource = readFileSync(path.join(process.cwd(), 'src/app/useAccountStatusController.ts'), 'utf8');

    expect(appRootSource).toContain('refreshAccountStatus({ silent: true })');
    expect(appRootSource).not.toContain('nodeSeekUserId: webLoginUserId');
    expect(refreshSource).toContain('captureNodeSeekUserId');
    expect(refreshSource).toContain('nodeSeekUserId: nodeSeekCredentialUserId');
  });
});
