import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effect(),
  useRef: <T,>(value: T) => ({ current: value })
}));

const mocks = vi.hoisted(() => ({
  clearLinuxDoAccess: vi.fn(async () => null),
  clearLinuxDoAccessForGeneration: vi.fn(async () => null),
  currentLinuxDoAccessGeneration: vi.fn(() => 1),
  checkYaohuoLogin: vi.fn(),
  getLinuxDoLevelProfile: vi.fn(),
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
  clearLinuxDoAccessForGeneration: mocks.clearLinuxDoAccessForGeneration,
  currentLinuxDoAccessGeneration: mocks.currentLinuxDoAccessGeneration,
  linuxDoAccessSummary: (access: { cookieHeader?: string } | null) => ({
    hasClearance: false,
    loggedIn: Boolean(access?.cookieHeader)
  }),
  loadLinuxDoAccess: mocks.loadLinuxDoAccess,
  parseLinuxDoDocumentCookie: () => ({}),
  summarizeLinuxDoCookies: () => ({ names: [] })
}));

vi.mock('../sources/sourceGateway', () => ({
  checkYaohuoLogin: mocks.checkYaohuoLogin,
  getLinuxDoLevelProfile: mocks.getLinuxDoLevelProfile,
  isLinuxDoLoginExpiredError: (error: unknown) => Boolean(
    error
    && typeof error === 'object'
    && (error as { source?: unknown }).source === 'linuxdo'
    && (error as { reason?: unknown }).reason === 'expired'
    && (error as { loginRequired?: unknown }).loginRequired === true
  )
}));

import { setDiagnosticWriter, type DiagnosticEvent, type DiagnosticTrace } from '../diagnostics';
import { useAccountController } from './useAccountController';

const ref = <T,>(current: T) => ({ current });

function createController(overrides: Partial<Parameters<typeof useAccountController>[0]> = {}) {
  return useAccountController({
    checkingRequestIdRef: ref(0),
    clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
    clearNodeSeekLoginState: vi.fn(async () => undefined),
    clearYaohuoLoginState: vi.fn(async () => undefined),
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
    yaohuoCredentialSuppressedRef: ref(false),
    yaohuoLoginPanelRequestRef: ref(9),
    yaohuoWebViewRef: ref({ reload: vi.fn() }) as never,
    ...overrides
  });
}

function nodeSeekLoginEvent(
  controller: ReturnType<typeof useAccountController>,
  payload: Record<string, unknown>,
  url = 'https://www.nodeseek.com/'
) {
  const sessionJson = controller.nodeSeekLoginProbeScript.match(/const messageSession = (\{[^;]+\});/)?.[1];
  if (!sessionJson) {
    throw new Error('NodeSeek probe script is missing its message session.');
  }
  return {
    nativeEvent: {
      data: JSON.stringify({ ...payload, ...JSON.parse(sessionJson) }),
      url
    }
  } as never;
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('visible account WebView diagnostics', () => {
  it('reports manual credential cleanup failures without rejecting the button handler', async () => {
    const notify = vi.fn();
    const controller = createController({
      clearNodeSeekLoginState: vi.fn(async () => { throw new Error('cleanup failed'); }),
      clearYaohuoLoginState: vi.fn(async () => { throw new Error('cleanup failed'); }),
      notify
    });
    mocks.clearLinuxDoAccess.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(controller.clearLogin()).resolves.toBeUndefined();
    await expect(controller.clearYaohuoLogin()).resolves.toBeUndefined();
    await expect(controller.clearLinuxDoCookie()).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledWith('NodeSeek 登录信息清理失败，请稍后重试。');
    expect(notify).toHaveBeenCalledWith('妖火登录信息清理失败，请稍后重试。');
    expect(notify).toHaveBeenCalledWith('linux.do 登录信息清理失败，请稍后重试。');
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

    controller.handleLoginMessage(nodeSeekLoginEvent(controller, {
          type: 'nodeseek-login',
          loggedIn: true,
          userId: 9487,
          csrfToken: 'PRIVATE_CSRF_SECRET',
          userAgent: 'PRIVATE_USER_AGENT_SECRET',
          cookie: 'NODESEEK_WEBVIEW_COOKIE_SECRET',
          html: '<html>PRIVATE_HTML</html>'
    }));
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
    expect(saveNodeSeekCookieHeader.mock.calls[0]?.[1]).not.toHaveProperty('csrfToken');
    expect(lines.join('')).not.toMatch(/PRIVATE_NODESEEK_COOKIE_NAME|NODESEEK_NATIVE_COOKIE_SECRET|PRIVATE_CSRF_SECRET|PRIVATE_USER_AGENT_SECRET|NODESEEK_WEBVIEW_COOKIE_SECRET|PRIVATE_HTML|9487/);

    controller.handleLoginMessage(nodeSeekLoginEvent(controller, {
      type: 'nodeseek-login',
      loggedIn: true,
      userId: 9999,
      userAgent: 'PRIVATE_USER_AGENT_SECRET',
      cookie: 'NODESEEK_WEBVIEW_COOKIE_SECRET'
    }));
    const changedAccount = controller.checkLogin();
    await vi.advanceTimersByTimeAsync(250);
    await changedAccount;
    expect(saveNodeSeekCookieHeader.mock.calls[1]?.[1]?.resetCurrentUser).toBe(true);
  });

  it('revokes a NodeSeek login confirmed logged out without resaving native cookies', async () => {
    vi.useFakeTimers();
    const clearNodeSeekLoginCookiesOnly = vi.fn(async () => undefined);
    const saveNodeSeekCookieHeader = vi.fn(async () => 'stale-login');
    const controller = createController({
      clearNodeSeekLoginCookiesOnly,
      currentNodeSeekCredentialGeneration: vi.fn(() => 8),
      saveNodeSeekCookieHeader
    });

    const check = controller.checkLogin();
    controller.handleLoginMessage(nodeSeekLoginEvent(controller, {
      type: 'nodeseek-login',
      loggedIn: false,
      userAgent: '',
      cookie: ''
    }));
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(clearNodeSeekLoginCookiesOnly).toHaveBeenCalledWith({ generation: 8 });
    expect(mocks.readNodeSeekCookiesFromStores).not.toHaveBeenCalled();
    expect(saveNodeSeekCookieHeader).not.toHaveBeenCalled();
  });

  it('ignores forged NodeSeek login messages from a child frame or stale panel session', () => {
    const clearNodeSeekLoginCookiesOnly = vi.fn(async () => undefined);
    const updateNodeSeekSession = vi.fn();
    const controller = createController({ clearNodeSeekLoginCookiesOnly, updateNodeSeekSession });

    controller.handleLoginMessage(nodeSeekLoginEvent(controller, {
      type: 'nodeseek-login',
      loggedIn: false,
      userAgent: '',
      cookie: ''
    }, 'https://www.nodeseek.com.evil.test/'));
    controller.handleLoginMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'nodeseek-login',
          loggedIn: false,
          userAgent: '',
          cookie: '',
          sessionId: 'stale-panel',
          nonce: '00000000000000000000000000000000'
        }),
        url: 'https://www.nodeseek.com/'
      }
    } as never);

    expect(clearNodeSeekLoginCookiesOnly).not.toHaveBeenCalled();
    expect(updateNodeSeekSession).not.toHaveBeenCalled();
  });

  it('rejects a message minted by the previous NodeSeek WebView load', () => {
    const clearNodeSeekLoginCookiesOnly = vi.fn(async () => undefined);
    const updateNodeSeekSession = vi.fn();
    const controller = createController({ clearNodeSeekLoginCookiesOnly, updateNodeSeekSession });
    const previousLoadMessage = nodeSeekLoginEvent(controller, {
      type: 'nodeseek-login',
      loggedIn: false,
      userAgent: '',
      cookie: ''
    });

    controller.recordNodeSeekLoginWebViewState('start');
    controller.handleLoginMessage(previousLoadMessage);

    expect(clearNodeSeekLoginCookiesOnly).not.toHaveBeenCalled();
    expect(updateNodeSeekSession).not.toHaveBeenCalled();
  });

  it('ignores a current NodeSeek logout message when its probe payload is incomplete', () => {
    const clearNodeSeekLoginCookiesOnly = vi.fn(async () => undefined);
    const updateNodeSeekSession = vi.fn();
    const controller = createController({ clearNodeSeekLoginCookiesOnly, updateNodeSeekSession });

    controller.handleLoginMessage(nodeSeekLoginEvent(controller, {
      type: 'nodeseek-login',
      loggedIn: false
    }));

    expect(clearNodeSeekLoginCookiesOnly).not.toHaveBeenCalled();
    expect(updateNodeSeekSession).not.toHaveBeenCalled();
  });

  it('links Yaohuo cookie detection, server confirmation, and save with one sanitized terminal trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    const currentUser = {
      source: 'yaohuo' as const,
      id: '45245',
      username: '45245',
      url: 'https://yaohuo.me/bbs/book_view.aspx?id=45245',
      topics: []
    };
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: true, loginRequired: false, currentUser });
    const saveYaohuoCookieHeader = vi.fn(async (
      _cookieHeader: string,
      _options?: { diagnosticTrace?: DiagnosticTrace; generation?: number }
    ) => true);
    const updateYaohuoSession = vi.fn();
    const controller = createController({ saveYaohuoCookieHeader, updateYaohuoSession });

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
    expect(saveYaohuoCookieHeader.mock.calls[0]?.[1]?.generation).toBe(4);
    expect(updateYaohuoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'login-detected',
      currentUser
    }));
    expect(lines.join('')).not.toMatch(/PRIVATE_YAOHUO_COOKIE_NAME|YAOHUO_NATIVE_COOKIE_SECRET|YAOHUO_COOKIE_VALUE_SECRET/);
  });

  it('does not restore a stale Yaohuo login after another credential operation advances the generation', async () => {
    const yaohuoCheck = Promise.withResolvers<{ ok: true; loginRequired: false }>();
    let generation = 4;
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    mocks.checkYaohuoLogin.mockReturnValue(yaohuoCheck.promise);
    const saveYaohuoCookieHeader = vi.fn(async () => true);
    const updateYaohuoSession = vi.fn();
    const controller = createController({
      currentYaohuoCredentialGeneration: () => generation,
      saveYaohuoCookieHeader,
      updateYaohuoSession
    });

    const check = controller.checkYaohuoCookie();
    await vi.waitFor(() => expect(mocks.checkYaohuoLogin).toHaveBeenCalled());
    generation += 1;
    yaohuoCheck.resolve({ ok: true, loginRequired: false });
    await check;

    expect(saveYaohuoCookieHeader).not.toHaveBeenCalled();
    expect(updateYaohuoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'login-detected' }));
  });

  it('does not read or send Yaohuo cookies while temporary anonymous mode is active', async () => {
    const lines: string[] = [];
    const notify = vi.fn();
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createController({
      notify,
      yaohuoCredentialSuppressedRef: { current: true }
    });

    await controller.checkYaohuoCookie();

    expect(mocks.cookieFlush).not.toHaveBeenCalled();
    expect(mocks.cookieGet).not.toHaveBeenCalled();
    expect(mocks.checkYaohuoLogin).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('妖火临时匿名测试已开启，请关闭测试后再检测登录。');
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'guard', source: 'yaohuo', state: 'disabled' }),
      expect.objectContaining({ phase: 'finish', outcome: 'blocked', state: 'disabled' })
    ]));
  });

  it('does not clear the saved Yaohuo login while temporary anonymous mode is active', async () => {
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const notify = vi.fn();
    const controller = createController({
      clearYaohuoLoginState,
      notify,
      yaohuoCredentialSuppressedRef: { current: true }
    });

    await controller.clearYaohuoLogin();

    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('妖火临时匿名测试已开启，请关闭测试后再清除登录。');
  });

  it('does not clear the saved Yaohuo credential when anonymous mode starts during a login check', async () => {
    const yaohuoCheck = Promise.withResolvers<never>();
    const yaohuoCredentialSuppressedRef = { current: false };
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    mocks.checkYaohuoLogin.mockReturnValue(yaohuoCheck.promise);
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const updateYaohuoSession = vi.fn();
    const controller = createController({
      clearYaohuoLoginState,
      updateYaohuoSession,
      yaohuoCredentialSuppressedRef
    });

    const check = controller.checkYaohuoCookie();
    await vi.waitFor(() => expect(mocks.checkYaohuoLogin).toHaveBeenCalled());
    yaohuoCredentialSuppressedRef.current = true;
    yaohuoCheck.reject(Object.assign(new Error('妖火登录已失效'), {
      source: 'yaohuo',
      loginRequired: true,
      reason: 'expired'
    }));
    await check;

    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(updateYaohuoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'login-expired' }));
  });

  it('maps a yaohuo verification error without clearing the cookie', async () => {
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    mocks.checkYaohuoLogin.mockRejectedValue(Object.assign(new Error('妖火需要完成访问验证'), {
      source: 'yaohuo',
      loginRequired: true,
      reason: 'verification'
    }));
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const saveYaohuoCookieHeader = vi.fn(async () => true);
    const updateYaohuoSession = vi.fn();
    const controller = createController({
      clearYaohuoLoginState,
      saveYaohuoCookieHeader,
      updateYaohuoSession
    });

    await controller.checkYaohuoCookie();

    expect(updateYaohuoSession).toHaveBeenCalledWith({
      type: 'verification-required',
      message: '妖火需要完成访问验证'
    });
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(saveYaohuoCookieHeader).not.toHaveBeenCalled();
  });

  it('records a resolved Yaohuo verification page as verification-required', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: false,
      loginRequired: true,
      reason: 'verification',
      message: '妖火需要完成访问验证'
    });
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const updateYaohuoSession = vi.fn();
    const controller = createController({ clearYaohuoLoginState, updateYaohuoSession });

    await controller.checkYaohuoCookie();

    expect(updateYaohuoSession).toHaveBeenCalledWith({
      type: 'verification-required',
      message: '妖火需要完成访问验证'
    });
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(lines.map((line) => JSON.parse(line)).at(-1)).toMatchObject({
      phase: 'finish',
      outcome: 'blocked',
      reason: 'verification_required'
    });
  });

  it('keeps the yaohuo login-expired result when automatic cleanup fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    mocks.checkYaohuoLogin.mockRejectedValue(Object.assign(new Error('妖火登录已失效，请重新登录。'), {
      source: 'yaohuo',
      loginRequired: true,
      reason: 'expired'
    }));
    const clearYaohuoLoginState = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    const notify = vi.fn();
    const updateYaohuoSession = vi.fn();
    const controller = createController({ clearYaohuoLoginState, notify, updateYaohuoSession });

    await controller.checkYaohuoCookie();

    expect(updateYaohuoSession).toHaveBeenCalledWith({
      type: 'login-expired',
      message: '妖火登录已失效，请重新登录。'
    });
    expect(notify).toHaveBeenCalledWith('妖火登录已失效，请重新登录。');
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', state: 'error', reason: 'storage_error' }),
      expect.objectContaining({ phase: 'finish', outcome: 'blocked', reason: 'login_required' })
    ]));
  });

  it('does not report an expired Yaohuo credential as cleared when cleanup declines ownership', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.cookieFlush.mockResolvedValue(undefined);
    mocks.cookieGet.mockResolvedValue({
      session: { name: 'PRIVATE_YAOHUO_COOKIE_NAME', value: 'YAOHUO_NATIVE_COOKIE_SECRET' }
    });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: false,
      loginRequired: true,
      reason: 'expired',
      message: '妖火登录已失效，请重新登录。'
    });
    const clearYaohuoLoginState = vi.fn(async () => false);
    const controller = createController({ clearYaohuoLoginState });

    await controller.checkYaohuoCookie();

    expect(lines.map((line) => JSON.parse(line))).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', hasCredential: false, state: 'applied' })
    ]));
    expect(lines.map((line) => JSON.parse(line)).at(-1)).toMatchObject({
      phase: 'finish',
      outcome: 'blocked',
      reason: 'login_required'
    });
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

describe('linux.do level session recovery', () => {
  it('does not use access loaded after another credential generation takes ownership', async () => {
    const loaded = Promise.withResolvers<{ cookieHeader: string }>();
    let generation = 20;
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => generation);
    mocks.loadLinuxDoAccess.mockReturnValueOnce(loaded.promise);
    const setLinuxDoLevelError = vi.fn();
    const setLinuxDoLevelProfile = vi.fn();
    const controller = createController({ setLinuxDoLevelError, setLinuxDoLevelProfile });

    const refresh = controller.refreshLinuxDoLevel();
    generation = 21;
    loaded.resolve({ cookieHeader: '_t=old' });
    await refresh;

    expect(mocks.getLinuxDoLevelProfile).not.toHaveBeenCalled();
    expect(setLinuxDoLevelProfile).not.toHaveBeenCalled();
    expect(setLinuxDoLevelError).not.toHaveBeenCalledWith(expect.stringContaining('登录'));
  });

  it('does not let an expired response from credential A clear newer credential B', async () => {
    const level = Promise.withResolvers<never>();
    let generation = 30;
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => generation);
    mocks.loadLinuxDoAccess.mockResolvedValueOnce({ cookieHeader: '_t=credential-a' });
    mocks.getLinuxDoLevelProfile.mockReturnValueOnce(level.promise);
    const setLinuxDoLevelError = vi.fn();
    const updateLinuxDoSession = vi.fn();
    const controller = createController({ setLinuxDoLevelError, updateLinuxDoSession });

    const refresh = controller.refreshLinuxDoLevel();
    await vi.waitFor(() => expect(mocks.getLinuxDoLevelProfile).toHaveBeenCalledTimes(1));
    generation = 31;
    level.reject(Object.assign(new Error('credential A expired'), {
      source: 'linuxdo',
      reason: 'expired',
      loginRequired: true,
      status: 401
    }));
    await refresh;

    expect(mocks.clearLinuxDoAccessForGeneration).not.toHaveBeenCalled();
    expect(updateLinuxDoSession).not.toHaveBeenCalled();
    expect(setLinuxDoLevelError).not.toHaveBeenCalledWith('credential A expired');
  });

  it('does not let a successful response from credential A overwrite credential B', async () => {
    const level = Promise.withResolvers<{ username: string }>();
    let generation = 40;
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => generation);
    mocks.loadLinuxDoAccess.mockResolvedValueOnce({ cookieHeader: '_t=credential-a' });
    mocks.getLinuxDoLevelProfile.mockReturnValueOnce(level.promise);
    const notify = vi.fn();
    const setLinuxDoLevelProfile = vi.fn();
    const controller = createController({ notify, setLinuxDoLevelProfile });

    const refresh = controller.refreshLinuxDoLevel();
    await vi.waitFor(() => expect(mocks.getLinuxDoLevelProfile).toHaveBeenCalledTimes(1));
    generation = 41;
    level.resolve({ username: 'credential-a-user' });
    await refresh;

    expect(setLinuxDoLevelProfile).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('linux.do 等级已更新。');
  });

  it('generation-safely clears a definitely expired login and updates the visible session', async () => {
    mocks.loadLinuxDoAccess.mockResolvedValueOnce({ cookieHeader: '_t=expired', userAgent: 'test-agent' });
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(7);
    mocks.getLinuxDoLevelProfile.mockRejectedValueOnce(Object.assign(new Error('linux.do 登录已失效，请重新登录'), {
      source: 'linuxdo',
      reason: 'expired',
      loginRequired: true,
      status: 401
    }));
    const resetLinuxDoLevelState = vi.fn();
    const updateLinuxDoSession = vi.fn();
    const setLinuxDoLevelProfile = vi.fn();
    const controller = createController({
      resetLinuxDoLevelState,
      setLinuxDoLevelProfile,
      updateLinuxDoSession
    });

    await controller.refreshLinuxDoLevel();

    expect(mocks.clearLinuxDoAccessForGeneration).toHaveBeenCalledWith(7, '_t=expired');
    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'login-expired',
      message: 'linux.do 登录已失效，请重新登录'
    }));
    expect(resetLinuxDoLevelState).toHaveBeenCalledTimes(1);
    expect(setLinuxDoLevelProfile).toHaveBeenCalledWith(null);
  });

  it('does not clear a newer login when the credential generation advances during level refresh', async () => {
    const level = Promise.withResolvers<never>();
    let generation = 11;
    mocks.loadLinuxDoAccess.mockResolvedValueOnce({ cookieHeader: '_t=stale' });
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => generation);
    mocks.getLinuxDoLevelProfile.mockReturnValueOnce(level.promise);
    const expired = Object.assign(new Error('expired'), {
      source: 'linuxdo',
      reason: 'expired',
      loginRequired: true
    });
    const updateLinuxDoSession = vi.fn();
    const controller = createController({ updateLinuxDoSession });

    const refresh = controller.refreshLinuxDoLevel();
    await vi.waitFor(() => expect(mocks.getLinuxDoLevelProfile).toHaveBeenCalledTimes(1));
    generation = 12;
    level.reject(expired);
    await refresh;

    expect(mocks.clearLinuxDoAccessForGeneration).not.toHaveBeenCalled();
    expect(updateLinuxDoSession).not.toHaveBeenCalled();
  });

  it('keeps the saved login for an ordinary permission error', async () => {
    mocks.loadLinuxDoAccess.mockResolvedValueOnce({ cookieHeader: '_t=valid' });
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(3);
    mocks.getLinuxDoLevelProfile.mockRejectedValueOnce(Object.assign(new Error('无权读取'), {
      source: 'linuxdo',
      reason: 'permission',
      status: 403
    }));
    const updateLinuxDoSession = vi.fn();
    const setLinuxDoLevelError = vi.fn();
    const controller = createController({ setLinuxDoLevelError, updateLinuxDoSession });

    await controller.refreshLinuxDoLevel();

    expect(mocks.clearLinuxDoAccessForGeneration).not.toHaveBeenCalled();
    expect(updateLinuxDoSession).not.toHaveBeenCalled();
    expect(setLinuxDoLevelError).toHaveBeenLastCalledWith('无权读取');
  });
});
