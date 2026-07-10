import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effect(),
  useRef: <T,>(value: T) => ({ current: value })
}));

const mocks = vi.hoisted(() => ({
  checkYaohuoLogin: vi.fn(),
  getLinuxDoLevelProfile: vi.fn(),
  readNodeSeekCookiesFromStores: vi.fn(),
  cookieFlush: vi.fn(),
  cookieGet: vi.fn()
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: mocks.cookieFlush,
    get: mocks.cookieGet
  }
}));

vi.mock('../nodeseekCookieBridge', () => ({
  readNodeSeekCookiesFromStores: mocks.readNodeSeekCookiesFromStores
}));

vi.mock('../nodeseekCookies', () => ({
  mergeNodeSeekCookies: (...maps: Array<Record<string, unknown>>) => Object.assign({}, ...maps),
  parseNodeSeekDocumentCookie: (header: string) => header ? {
    PRIVATE_NODESEEK_COOKIE_NAME: { name: 'PRIVATE_NODESEEK_COOKIE_NAME', value: header }
  } : {},
  sanitizeNodeSeekUserAgent: (userAgent: string) => userAgent,
  summarizeNodeSeekCookies: () => ({
    count: 2,
    loggedIn: true,
    names: ['PRIVATE_NODESEEK_COOKIE_NAME']
  })
}));

vi.mock('../yaohuoCookies', () => ({
  buildYaohuoCookieHeader: () => 'YAOHUO_COOKIE_VALUE_SECRET',
  canStoreYaohuoCookieHeader: () => true,
  mergeYaohuoCookies: (...maps: Array<Record<string, unknown>>) => Object.assign({}, ...maps),
  summarizeYaohuoCookies: () => ({
    count: 1,
    loggedIn: true,
    names: ['PRIVATE_YAOHUO_COOKIE_NAME']
  })
}));

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: vi.fn(async () => null),
  linuxDoAccessSummary: () => ({ hasClearance: false, loggedIn: false }),
  loadLinuxDoAccess: vi.fn(async () => null),
  parseLinuxDoDocumentCookie: () => ({}),
  summarizeLinuxDoCookies: () => ({ names: [] })
}));

vi.mock('../sources/sourceGateway', () => ({
  checkYaohuoLogin: mocks.checkYaohuoLogin,
  getLinuxDoLevelProfile: mocks.getLinuxDoLevelProfile
}));

import { setDiagnosticWriter, type DiagnosticEvent, type DiagnosticTrace } from '../diagnostics';
import { useAccountController } from './useAccountController';

const ref = <T,>(current: T) => ({ current });

function createController(overrides: Partial<Parameters<typeof useAccountController>[0]> = {}) {
  return useAccountController({
    checkingRequestIdRef: ref(0),
    clearNodeSeekLoginState: vi.fn(async () => undefined),
    clearYaohuoLoginState: vi.fn(async () => undefined),
    currentYaohuoCredentialGeneration: vi.fn(() => 4),
    forumFetchWithWebViewFallback: vi.fn(),
    linuxDoLevelRequestIdRef: ref(0),
    linuxDoWebViewUserAgentRef: ref(''),
    nodeSeekLoginPanelRequestRef: ref(7),
    nodeSeekWebViewCookieHeaderRef: ref(''),
    nodeSeekWebViewUserAgentRef: ref(''),
    notify: vi.fn(),
    resetLinuxDoLevelState: vi.fn(),
    resetLinuxDoWebView: vi.fn(),
    saveNodeSeekCookieHeader: vi.fn(async () => 'NODESEEK_SAVED_COOKIE_SECRET'),
    saveYaohuoCookieHeader: vi.fn(async () => true),
    setChecking: vi.fn(),
    setLinuxDoLevelBusy: vi.fn(),
    setLinuxDoLevelError: vi.fn(),
    setLinuxDoLevelProfile: vi.fn(),
    setNodeSeekWebViewUserAgent: vi.fn(),
    setWebLoginUserId: vi.fn(),
    showLinuxDoVerification: vi.fn(),
    showLoginPanelRef: ref(true),
    showYaohuoLoginPanel: true,
    updateLinuxDoSession: vi.fn(),
    updateNodeSeekSession: vi.fn(),
    updateYaohuoSession: vi.fn(),
    webLoginDetectedRef: ref(false),
    webViewRef: ref({ injectJavaScript: vi.fn(), reload: vi.fn() }) as never,
    yaohuoLoginPanelRequestRef: ref(9),
    yaohuoWebViewRef: ref({ reload: vi.fn() }) as never,
    ...overrides
  });
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('visible account WebView diagnostics', () => {
  it('links a NodeSeek WebView message, probe, cookie detection, and save without leaking payloads', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.readNodeSeekCookiesFromStores.mockResolvedValue({
      session: { name: 'PRIVATE_NODESEEK_COOKIE_NAME', value: 'NODESEEK_NATIVE_COOKIE_SECRET' }
    });
    const saveNodeSeekCookieHeader = vi.fn(async (
      _cookies: Record<string, unknown>,
      _options?: { diagnosticTrace?: DiagnosticTrace }
    ) => 'NODESEEK_SAVED_COOKIE_SECRET');
    const controller = createController({ saveNodeSeekCookieHeader });

    controller.handleLoginMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'nodeseek-login',
          loggedIn: true,
          userId: 9487,
          csrfToken: 'PRIVATE_CSRF_SECRET',
          userAgent: 'PRIVATE_USER_AGENT_SECRET',
          cookie: 'NODESEEK_WEBVIEW_COOKIE_SECRET',
          html: '<html>PRIVATE_HTML</html>'
        })
      }
    } as never);
    const pending = controller.checkLogin();
    await vi.advanceTimersByTimeAsync(250);
    await pending;

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    const parentEvents = events.filter((event) => event.area === 'credential' && event.operation === 'check' && event.source === 'nodeseek');
    expect(parentEvents.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'intent',
      'parse',
      'transport',
      'credential',
      'persist',
      'finish'
    ]));
    expect(new Set(parentEvents.map((event) => event.traceId)).size).toBe(1);
    expect(parentEvents.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'success' })
    ]);
    const cookieStoreTrace = mocks.readNodeSeekCookiesFromStores.mock.calls[0]?.[0]?.diagnosticTrace;
    expect(cookieStoreTrace).toEqual(expect.objectContaining({ traceId: parentEvents[0].traceId }));
    expect(saveNodeSeekCookieHeader.mock.calls[0]?.[1]?.diagnosticTrace).toBe(cookieStoreTrace);
    expect(lines.join('')).not.toMatch(/PRIVATE_NODESEEK_COOKIE_NAME|NODESEEK_NATIVE_COOKIE_SECRET|PRIVATE_CSRF_SECRET|PRIVATE_USER_AGENT_SECRET|NODESEEK_WEBVIEW_COOKIE_SECRET|PRIVATE_HTML|9487/);
  });

  it('links Yaohuo cookie detection, server confirmation, and save with one sanitized terminal trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: true, loginRequired: false });
    const saveYaohuoCookieHeader = vi.fn(async (
      _cookieHeader: string,
      _options?: { diagnosticTrace?: DiagnosticTrace }
    ) => true);
    const controller = createController({ saveYaohuoCookieHeader });

    controller.recordYaohuoLoginWebViewState('start');
    controller.recordYaohuoLoginWebViewState('ready');
    await controller.checkYaohuoCookie();

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    const parentEvents = events.filter((event) => event.area === 'credential' && event.operation === 'check' && event.source === 'yaohuo');
    expect(parentEvents.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'intent',
      'guard',
      'credential',
      'transport',
      'persist',
      'apply',
      'finish'
    ]));
    expect(new Set(parentEvents.map((event) => event.traceId)).size).toBe(1);
    expect(parentEvents.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'success' })
    ]);
    expect(parentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'transport', channel: 'webview', state: 'ready' })
    ]));
    expect(saveYaohuoCookieHeader.mock.calls[0]?.[1]?.diagnosticTrace).toEqual(
      expect.objectContaining({ traceId: parentEvents[0].traceId })
    );
    expect(lines.join('')).not.toMatch(/PRIVATE_YAOHUO_COOKIE_NAME|YAOHUO_NATIVE_COOKIE_SECRET|YAOHUO_COOKIE_VALUE_SECRET/);
  });

  it('finishes a visible login trace at the real WebView failure stage', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createController();

    controller.recordNodeSeekLoginWebViewState('start');
    controller.recordNodeSeekLoginWebViewState('renderer-gone');

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check' && event.source === 'nodeseek');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'transport', channel: 'webview', state: 'started' }),
      expect.objectContaining({ phase: 'transport', outcome: 'success', state: 'failure', reason: 'renderer_gone' }),
      expect.objectContaining({ phase: 'finish', outcome: 'failure', reason: 'renderer_gone' })
    ]));
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(1);
  });
});
