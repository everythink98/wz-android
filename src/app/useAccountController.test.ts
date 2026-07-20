import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effect(),
  useRef: <T,>(value: T) => ({ current: value })
}));

const mocks = vi.hoisted(() => ({
  checkYaohuoLogin: vi.fn(),
  clearLinuxDoAccess: vi.fn(async () => null),
  currentLinuxDoAccessGeneration: vi.fn(() => 1),
  getLinuxDoLevelProfile: vi.fn(),
  linuxDoAccessSummary: vi.fn(() => ({ hasClearance: false, loggedIn: false })),
  loadLinuxDoAccess: vi.fn(async () => null as { cookieHeader: string; userAgent?: string } | null),
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
  clearLinuxDoAccess: mocks.clearLinuxDoAccess,
  currentLinuxDoAccessGeneration: mocks.currentLinuxDoAccessGeneration,
  linuxDoAccessSummary: mocks.linuxDoAccessSummary,
  loadLinuxDoAccess: mocks.loadLinuxDoAccess,
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
    clearNodeSeekLoginState: vi.fn(async () => true),
    clearYaohuoLoginState: vi.fn(async () => true),
    currentNodeSeekCredentialGeneration: vi.fn(() => 3),
    currentYaohuoCredentialGeneration: vi.fn(() => 4),
    forumFetchWithWebViewFallback: vi.fn(),
    linuxDoLevelRequestIdRef: ref(0),
    linuxDoWebViewUserAgentRef: ref(''),
    nodeSeekLoginPanelRequestRef: ref(7),
    nodeSeekCurrentUserId: null,
    nodeSeekWebViewCookieHeaderRef: ref(''),
    nodeSeekWebViewUserAgentRef: ref(''),
    notify: vi.fn(),
    onLoginWebViewFailure: vi.fn(),
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
  mocks.clearLinuxDoAccess.mockResolvedValue(null);
  mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
  mocks.linuxDoAccessSummary.mockReturnValue({ hasClearance: false, loggedIn: false });
  mocks.loadLinuxDoAccess.mockResolvedValue(null);
  vi.useRealTimers();
});

describe('visible account WebView diagnostics', () => {
  it('REG-ACCOUNT-009 does not apply a linux.do level response from superseded credentials', async () => {
    let generation = 4;
    const profile = Promise.withResolvers<{ username: string }>();
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => generation);
    mocks.linuxDoAccessSummary.mockReturnValue({ hasClearance: true, loggedIn: true });
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: '_t=old', userAgent: 'old-agent' });
    mocks.getLinuxDoLevelProfile.mockReturnValueOnce(profile.promise);
    const notify = vi.fn();
    const setLinuxDoLevelProfile = vi.fn();
    const controller = createController({ notify, setLinuxDoLevelProfile });

    const refresh = controller.refreshLinuxDoLevel();
    await vi.waitFor(() => expect(mocks.getLinuxDoLevelProfile).toHaveBeenCalledTimes(1));
    generation += 1;
    profile.resolve({ username: 'old-user' });
    await refresh;

    expect(setLinuxDoLevelProfile).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('linux.do 等级已更新。');
  });

  it('REG-ACCOUNT-009 does not report or reload a superseded manual NodeSeek clear', async () => {
    const notify = vi.fn();
    const reload = vi.fn();
    const controller = createController({
      clearNodeSeekLoginState: vi.fn(async () => false) as never,
      notify,
      webViewRef: ref({ injectJavaScript: vi.fn(), reload }) as never
    });

    await controller.clearLogin();

    expect(reload).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('已清除本机保存的 NodeSeek Cookie。');
  });

  it('REG-ACCOUNT-009 does not report or reload a superseded manual Yaohuo clear', async () => {
    const notify = vi.fn();
    const reload = vi.fn();
    const controller = createController({
      clearYaohuoLoginState: vi.fn(async () => false) as never,
      notify,
      yaohuoWebViewRef: ref({ reload }) as never
    });

    await controller.clearYaohuoLogin();

    expect(reload).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('已清除本机保存的妖火 Cookie。');
  });

  it('REG-ACCOUNT-009 does not reset a newer linux.do session after an old manual clear settles', async () => {
    const clear = Promise.withResolvers<null>();
    let generation = 10;
    mocks.clearLinuxDoAccess.mockReturnValueOnce(clear.promise);
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => generation);
    const notify = vi.fn();
    const resetLinuxDoLevelState = vi.fn();
    const resetLinuxDoWebView = vi.fn();
    const updateLinuxDoSession = vi.fn();
    const controller = createController({
      notify,
      resetLinuxDoLevelState,
      resetLinuxDoWebView,
      updateLinuxDoSession
    });

    const staleClear = controller.clearLinuxDoCookie();
    await vi.waitFor(() => expect(mocks.clearLinuxDoAccess).toHaveBeenCalledTimes(1));
    generation = 11;
    clear.resolve(null);
    await staleClear;

    expect(updateLinuxDoSession).not.toHaveBeenCalled();
    expect(resetLinuxDoLevelState).not.toHaveBeenCalled();
    expect(resetLinuxDoWebView).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('REG-ACCOUNT-005 ignores NodeSeek login payloads from an allowed non-NodeSeek challenge host', () => {
    const setWebLoginUserId = vi.fn();
    const setNodeSeekWebViewUserAgent = vi.fn();
    const updateNodeSeekSession = vi.fn();
    const controller = createController({
      setNodeSeekWebViewUserAgent,
      setWebLoginUserId,
      updateNodeSeekSession
    });

    controller.handleLoginMessage({
      nativeEvent: {
        url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/',
        data: JSON.stringify({
          type: 'nodeseek-login',
          loggedIn: true,
          userId: 9487,
          userAgent: 'challenge-agent',
          cookie: 'session=wrong-origin'
        })
      }
    } as never);

    expect(setWebLoginUserId).not.toHaveBeenCalled();
    expect(setNodeSeekWebViewUserAgent).not.toHaveBeenCalled();
    expect(updateNodeSeekSession).not.toHaveBeenCalled();
  });

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
      _options?: { diagnosticTrace?: DiagnosticTrace; resetCurrentUser?: boolean }
    ) => 'NODESEEK_SAVED_COOKIE_SECRET');
    const controller = createController({ nodeSeekCurrentUserId: 9487, saveNodeSeekCookieHeader });

    controller.handleLoginMessage({
      nativeEvent: {
        url: 'https://www.nodeseek.com/',
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
    expect(saveNodeSeekCookieHeader.mock.calls[0]?.[1]?.resetCurrentUser).toBe(false);
    expect(lines.join('')).not.toMatch(/PRIVATE_NODESEEK_COOKIE_NAME|NODESEEK_NATIVE_COOKIE_SECRET|PRIVATE_CSRF_SECRET|PRIVATE_USER_AGENT_SECRET|NODESEEK_WEBVIEW_COOKIE_SECRET|PRIVATE_HTML|9487/);

    controller.handleLoginMessage({
      nativeEvent: {
        url: 'https://www.nodeseek.com/',
        data: JSON.stringify({ type: 'nodeseek-login', loggedIn: true, userId: 9999 })
      }
    } as never);
    const changedAccount = controller.checkLogin();
    await vi.advanceTimersByTimeAsync(250);
    await changedAccount;
    expect(saveNodeSeekCookieHeader.mock.calls[1]?.[1]?.resetCurrentUser).toBe(true);
  });

  it('REG-ACCOUNT-009 does not let an old NodeSeek cookie read overwrite a newer credential', async () => {
    vi.useFakeTimers();
    mocks.cookieFlush.mockResolvedValue(undefined);
    const cookieRead = Promise.withResolvers<Record<string, { name: string; value: string }>>();
    mocks.readNodeSeekCookiesFromStores.mockReturnValueOnce(cookieRead.promise);
    let credentialGeneration = 3;
    const saveNodeSeekCookieHeader = vi.fn(async () => 'STALE_NODESEEK_COOKIE');
    const controller = createController({
      currentNodeSeekCredentialGeneration: vi.fn(() => credentialGeneration),
      saveNodeSeekCookieHeader
    });

    const staleCheck = controller.checkLogin();
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(mocks.readNodeSeekCookiesFromStores).toHaveBeenCalledTimes(1));
    credentialGeneration = 4;
    cookieRead.resolve({
      session: { name: 'session', value: 'old-session' }
    });
    await staleCheck;

    expect(saveNodeSeekCookieHeader).not.toHaveBeenCalled();
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

  it('REG-ACCOUNT-004 keeps confirmed Yaohuo expiry as the final state after credential cleanup', async () => {
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      sidyaohuo: { name: 'sidyaohuo', value: 'saved-session' }
    });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: false,
      loginRequired: true,
      reason: 'expired',
      message: '妖火登录已失效，请重新登录。'
    });
    const updateYaohuoSession = vi.fn();
    const clearYaohuoLoginState = vi.fn(async () => {
      updateYaohuoSession({ type: 'cleared' });
      return true;
    });
    const controller = createController({ clearYaohuoLoginState, updateYaohuoSession });

    await controller.checkYaohuoCookie();

    expect(clearYaohuoLoginState).toHaveBeenCalledWith({
      generation: 4,
      expiredMessage: '妖火登录已失效，请重新登录。'
    });
    expect(updateYaohuoSession).toHaveBeenLastCalledWith({
      type: 'login-expired',
      message: '妖火登录已失效，请重新登录。'
    });
  });

  it('REG-ACCOUNT-009 ignores an old Yaohuo expiry check after a newer credential takes ownership', async () => {
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      sidyaohuo: { name: 'sidyaohuo', value: 'old-session' }
    });
    const check = Promise.withResolvers<{
      ok: false;
      loginRequired: true;
      reason: 'expired';
      message: string;
    }>();
    mocks.checkYaohuoLogin.mockReturnValueOnce(check.promise);
    let credentialGeneration = 4;
    const clearYaohuoLoginState = vi.fn(async () => true);
    const updateYaohuoSession = vi.fn();
    const controller = createController({
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: vi.fn(() => credentialGeneration),
      updateYaohuoSession
    });

    const staleCheck = controller.checkYaohuoCookie();
    await vi.waitFor(() => expect(mocks.checkYaohuoLogin).toHaveBeenCalledTimes(1));
    credentialGeneration = 5;
    check.resolve({
      ok: false,
      loginRequired: true,
      reason: 'expired',
      message: '旧 Cookie 已失效'
    });
    await staleCheck;

    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(updateYaohuoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'login-expired' }));
  });

  it('REG-ACCOUNT-007 keeps a typed Yaohuo expiry when automatic cleanup also fails', async () => {
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      sidyaohuo: { name: 'sidyaohuo', value: 'saved-session' }
    });
    mocks.checkYaohuoLogin.mockRejectedValue(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));
    const updateYaohuoSession = vi.fn();
    const notify = vi.fn();
    const controller = createController({
      clearYaohuoLoginState: vi.fn(async () => { throw new Error('WebView cookie cleanup failed'); }),
      notify,
      updateYaohuoSession
    });

    await expect(controller.checkYaohuoCookie()).resolves.toBeUndefined();

    expect(updateYaohuoSession).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'login-expired',
      message: expect.stringContaining('清理未完成')
    }));
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('清理未完成'));
  });

  it('finishes a visible login trace at the real WebView failure stage', () => {
    const lines: string[] = [];
    const onLoginWebViewFailure = vi.fn();
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createController({ onLoginWebViewFailure });

    controller.recordNodeSeekLoginWebViewState('start');
    controller.recordNodeSeekLoginWebViewState('renderer-gone', 7);
    controller.recordNodeSeekLoginWebViewState('error', 7);

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check' && event.source === 'nodeseek');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'transport', channel: 'webview', state: 'started' }),
      expect.objectContaining({ phase: 'transport', outcome: 'success', state: 'failure', reason: 'renderer_gone' }),
      expect.objectContaining({ phase: 'finish', outcome: 'failure', reason: 'renderer_gone' })
    ]));
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(1);
    expect(onLoginWebViewFailure).toHaveBeenCalledWith('nodeseek', 7, 'renderer_gone');
    expect(onLoginWebViewFailure).toHaveBeenCalledTimes(1);
  });

  it('reports a login page timeout to the automatic-fill lifecycle', () => {
    const onLoginWebViewFailure = vi.fn();
    const controller = createController({ onLoginWebViewFailure });

    controller.recordYaohuoLoginWebViewState('timeout', 8);

    expect(onLoginWebViewFailure).toHaveBeenCalledWith('yaohuo', 8, 'timeout');
  });
});
