import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let state = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [state, (next: T | ((current: T) => T)) => {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
    }];
  }
}));

const mocks = vi.hoisted(() => ({
  checkLinuxDoLoginAccess: vi.fn(),
  checkYaohuoLogin: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  getItemAsync: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  currentLinuxDoAccessGeneration: vi.fn(),
  loadLinuxDoAccess: vi.fn()
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.getItemAsync
}));

vi.mock('../sources/sourceGateway', () => ({
  checkLinuxDoLoginAccess: mocks.checkLinuxDoLoginAccess,
  checkYaohuoLogin: mocks.checkYaohuoLogin,
  getCurrentUserProfile: mocks.getCurrentUserProfile
}));

vi.mock('../nodeseekCookies', () => ({
  parseNodeSeekDocumentCookie: () => ({}),
  summarizeNodeSeekCookies: () => ({ count: 2, loggedIn: true, names: ['session-a', 'session-b'] })
}));

vi.mock('../yaohuoCookies', () => ({
  yaohuoCookieMapFromHeader: () => ({}),
  summarizeYaohuoCookies: () => ({ count: 1, loggedIn: true, names: ['session-c'] })
}));

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccessForGeneration: mocks.clearLinuxDoAccessForGeneration,
  currentLinuxDoAccessGeneration: mocks.currentLinuxDoAccessGeneration,
  linuxDoAccessSummary: (access: { cookieHeader?: string } | null) => ({
    hasClearance: Boolean(access?.cookieHeader),
    loggedIn: Boolean(access?.cookieHeader)
  }),
  loadLinuxDoAccess: mocks.loadLinuxDoAccess,
  parseLinuxDoDocumentCookie: () => ({}),
  summarizeLinuxDoCookies: () => ({ count: 3, loggedIn: true, names: ['session-d'] })
}));

import { setDiagnosticWriter, type DiagnosticEvent } from '../diagnostics';
import { useAccountStatusController } from './useAccountStatusController';

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('account status diagnostics', () => {
  it('links multi-site credential checks, a partial result, and final apply with one parent trace', async () => {
    const nodeSeekSecret = 'NODESEEK_COOKIE_SHOULD_NOT_LEAK';
    const linuxDoSecret = 'LINUXDO_COOKIE_SHOULD_NOT_LEAK';
    const yaohuoSecret = 'YAOHUO_COOKIE_SHOULD_NOT_LEAK';
    const privateUserId = 'private-user-9487';
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });

    mocks.getItemAsync.mockResolvedValue(yaohuoSecret);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: linuxDoSecret,
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: true,
      loginRequired: false,
      currentUser: { id: privateUserId }
    });
    mocks.getCurrentUserProfile.mockImplementation(async ({ source }: { source: string }) => {
      if (source === 'nodeseek') {
        throw new Error('profile lookup failed');
      }
      return { id: privateUserId };
    });

    const dispatchSiteSessionEvent = vi.fn();
    const notify = vi.fn();
    const refreshXiaoyinsiAuthorization = vi.fn(async () => null);
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => true),
      currentNodeSeekCredentialGeneration: vi.fn(() => 3),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(3);
        options?.captureNodeSeekUserId?.(9487);
        return nodeSeekSecret;
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      refreshXiaoyinsiAuthorization,
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => nodeSeekSecret)
    });

    await controller.refreshAccountStatus();

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    const parentEvents = events.filter((event) => event.operation === 'refresh');
    expect(parentEvents.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'intent',
      'credential',
      'transport',
      'apply',
      'finish'
    ]));
    expect(new Set(parentEvents.map((event) => event.traceId)).size).toBe(1);
    expect(parentEvents.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ area: 'session', outcome: 'partial', partialErrorCount: 2 })
    ]);
    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：NodeSeek、小隐寺');
    expect(dispatchSiteSessionEvent).toHaveBeenCalledTimes(3);
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      site: 'nodeseek',
      type: 'check-failed'
    }));
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      site: 'nodeseek',
      type: 'cookie-loaded'
    }));
    expect(lines.join('')).not.toMatch(new RegExp([
      nodeSeekSecret,
      linuxDoSecret,
      yaohuoSecret,
      privateUserId,
      'session-a',
      'session-b',
      'session-c',
      'session-d'
    ].join('|')));
  });

  it('REG-ACCOUNT-001 keeps linux.do and Yaohuo identity lookup failures as check-failed states', async () => {
    mocks.getItemAsync.mockResolvedValue('yaohuo-cookie');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'linuxdo-cookie',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.getCurrentUserProfile.mockImplementation(async ({ source }: { source: string }) => {
      if (source === 'nodeseek') {
        return { source: 'nodeseek', id: '7', username: 'alice', url: '', topics: [] };
      }
      throw new Error(`${source} identity lookup failed`);
    });
    const dispatchSiteSessionEvent = vi.fn();
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => true),
      currentNodeSeekCredentialGeneration: vi.fn(() => 3),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek-cookie'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => 'nodeseek-cookie')
    });

    await controller.refreshAccountStatus();

    for (const site of ['linuxdo', 'yaohuo']) {
      expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site, type: 'check-failed' }));
      expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site, type: 'cookie-loaded' }));
    }
  });

  it('REG-ACCOUNT-002 isolates one credential-store failure while refreshing the other accounts', async () => {
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockResolvedValue(null);
    const dispatchSiteSessionEvent = vi.fn();
    const notify = vi.fn();
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => true),
      currentNodeSeekCredentialGeneration: vi.fn(() => 0),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => { throw new Error('NodeSeek credential store failed'); }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek', type: 'check-failed' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo', type: 'cookie-loaded' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo', type: 'cookie-loaded' }));
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：NodeSeek');
  });

  it('REG-ACCOUNT-008 keeps other account results when Yaohuo expiry cleanup fails', async () => {
    mocks.getItemAsync.mockResolvedValue('yaohuo-cookie');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true, reason: 'expired' });
    mocks.getCurrentUserProfile.mockResolvedValue({ source: 'nodeseek', id: '7', username: 'alice', url: '', topics: [] });
    const dispatchSiteSessionEvent = vi.fn();
    const notify = vi.fn();
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => { throw new Error('Yaohuo cleanup failed'); }),
      currentNodeSeekCredentialGeneration: vi.fn(() => 0),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek-cookie'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => 'nodeseek-cookie')
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek', type: 'cookie-loaded' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo', type: 'cookie-loaded' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo', type: 'login-expired' }));
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：妖火');
  });

  it('REG-ACCOUNT-008 keeps confirmed linux.do expiry as the final account state', async () => {
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'linuxdo-expired',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.clearLinuxDoAccessForGeneration.mockResolvedValue(null);
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true, message: 'linux.do 登录已失效' });
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockResolvedValue(null);
    const dispatchSiteSessionEvent = vi.fn();
    const linuxDoWebViewCookieHeaderRef = { current: '_t=expired-session; cf_clearance=old-clearance' };
    const setLinuxDoWebViewCookieHeader = vi.fn();
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => true),
      currentNodeSeekCredentialGeneration: vi.fn(() => 0),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef,
      setLinuxDoWebViewCookieHeader,
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo', type: 'login-expired' }));
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo', type: 'cookie-loaded' }));
    expect(linuxDoWebViewCookieHeaderRef.current).toBe('');
    expect(setLinuxDoWebViewCookieHeader).toHaveBeenCalledWith('');
  });

  it('REG-ACCOUNT-008 isolates NodeSeek identity persistence failure from other account results', async () => {
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockResolvedValue({ source: 'nodeseek', id: '7', username: 'alice', url: '', topics: [] });
    const dispatchSiteSessionEvent = vi.fn();
    const notify = vi.fn();
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => true),
      currentNodeSeekCredentialGeneration: vi.fn(() => 0),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek-cookie'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => { throw new Error('NodeSeek persistence failed'); })
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo', type: 'cookie-loaded' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo', type: 'cookie-loaded' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek', type: 'check-failed' }));
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：NodeSeek');
  });

  it('REG-ACCOUNT-009 does not apply an old account refresh after newer credentials are saved', async () => {
    let nodeSeekGeneration = 3;
    let yaohuoGeneration = 5;
    let linuxDoGeneration = 8;
    const linuxDoCheck = Promise.withResolvers<{ ok: boolean; loginRequired: boolean; message: string }>();
    mocks.getItemAsync.mockResolvedValue('old-yaohuo-cookie');
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => linuxDoGeneration);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'old-linuxdo-cookie',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.checkLinuxDoLoginAccess.mockReturnValue(linuxDoCheck.promise);
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true, reason: 'expired' });
    mocks.getCurrentUserProfile.mockResolvedValue({ source: 'nodeseek', id: '7', username: 'old-user', url: '', topics: [] });
    const clearYaohuoLoginState = vi.fn(async () => true);
    const dispatchSiteSessionEvent = vi.fn();
    const saveNodeSeekCookieHeader = vi.fn(async () => 'old-nodeseek-cookie');
    const controller = useAccountStatusController({
      clearYaohuoLoginState,
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: () => yaohuoGeneration,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(nodeSeekGeneration);
        return 'old-nodeseek-cookie';
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader
    });

    const refresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.checkLinuxDoLoginAccess).toHaveBeenCalledTimes(1));
    nodeSeekGeneration += 1;
    yaohuoGeneration += 1;
    linuxDoGeneration += 1;
    linuxDoCheck.resolve({ ok: false, loginRequired: true, message: 'old login expired' });
    await refresh;

    expect(mocks.clearLinuxDoAccessForGeneration).not.toHaveBeenCalled();
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(saveNodeSeekCookieHeader).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek' }));
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo' }));
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo' }));
  });

  it('REG-ACCOUNT-009 does not send credentials that became stale while storage was loading', async () => {
    let nodeSeekGeneration = 3;
    let yaohuoGeneration = 5;
    let linuxDoGeneration = 8;
    const yaohuoCredential = Promise.withResolvers<string | null>();
    const nodeSeekCredential = Promise.withResolvers<string | undefined>();
    const linuxDoCredential = Promise.withResolvers<{
      cookieHeader: string;
      savedAt: string;
      source: 'webview';
    } | null>();
    mocks.getItemAsync.mockReturnValue(yaohuoCredential.promise);
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => linuxDoGeneration);
    mocks.loadLinuxDoAccess.mockReturnValue(linuxDoCredential.promise);
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.getCurrentUserProfile.mockResolvedValue(null);
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => true),
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: () => yaohuoGeneration,
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn((_source, options) => {
        options?.captureGeneration?.(nodeSeekGeneration);
        return nodeSeekCredential.promise;
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const refresh = controller.refreshAccountStatus();
    nodeSeekGeneration += 1;
    yaohuoGeneration += 1;
    linuxDoGeneration += 1;
    yaohuoCredential.resolve('old-yaohuo-cookie');
    nodeSeekCredential.resolve('old-nodeseek-cookie');
    linuxDoCredential.resolve({
      cookieHeader: 'old-linuxdo-cookie',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    await refresh;

    expect(mocks.checkYaohuoLogin).not.toHaveBeenCalled();
    expect(mocks.checkLinuxDoLoginAccess).not.toHaveBeenCalled();
    expect(mocks.getCurrentUserProfile).not.toHaveBeenCalled();
  });

  it('records a busy refresh separately and gives the active refresh one canceled terminal', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const linuxDoCheck = Promise.withResolvers<{ ok: boolean; loginRequired: boolean }>();
    const xiaoyinsiCheck = Promise.withResolvers<boolean | null>();
    const refreshXiaoyinsiAuthorization = vi.fn(() => xiaoyinsiCheck.promise);
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(2);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'secret',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.checkLinuxDoLoginAccess.mockReturnValue(linuxDoCheck.promise);
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockResolvedValue(null);

    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => true),
      currentNodeSeekCredentialGeneration: vi.fn(() => 0),
      currentYaohuoCredentialGeneration: vi.fn(() => 4),
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      refreshXiaoyinsiAuthorization,
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const activeRefresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.checkLinuxDoLoginAccess).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1));
    await controller.refreshAccountStatus();
    controller.abortAccountStatusRequests();
    linuxDoCheck.resolve({ ok: true, loginRequired: false });
    xiaoyinsiCheck.resolve(false);
    await activeRefresh;

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'session' && event.operation === 'refresh' && event.phase === 'finish');
    expect(terminalEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'blocked', reason: 'busy' }),
      expect.objectContaining({ outcome: 'canceled', reason: 'canceled' })
    ]));
    expect(terminalEvents).toHaveLength(2);
    expect(new Set(terminalEvents.map((event) => event.traceId)).size).toBe(2);
  });

  it('records generation-scoped credential clears without exporting credential data', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.getItemAsync.mockResolvedValue('YAOHUO_EXPIRED_COOKIE_SECRET');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'LINUXDO_EXPIRED_COOKIE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.clearLinuxDoAccessForGeneration.mockResolvedValue(null);
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: false,
      loginRequired: true,
      reason: 'expired'
    });
    mocks.getCurrentUserProfile.mockResolvedValue(null);
    const clearYaohuoLoginState = vi.fn(async () => true);
    const controller = useAccountStatusController({
      clearYaohuoLoginState,
      currentNodeSeekCredentialGeneration: vi.fn(() => 0),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoWebViewCookieHeaderRef: { current: '' },
      setLinuxDoWebViewCookieHeader: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      refreshXiaoyinsiAuthorization: vi.fn(async () => false),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(mocks.clearLinuxDoAccessForGeneration).toHaveBeenCalledWith(8, 'LINUXDO_EXPIRED_COOKIE_SECRET');
    expect(clearYaohuoLoginState).toHaveBeenCalledWith({
      generation: 5,
      expiredMessage: '妖火登录已失效'
    });
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'linuxdo', generation: 8, state: 'expired' }),
      expect.objectContaining({ phase: 'credential', source: 'yaohuo', generation: 5, state: 'expired' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', generation: 8, hasCredential: false }),
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', generation: 5, hasCredential: false })
    ]));
    expect(lines.join('')).not.toMatch(/LINUXDO_EXPIRED_COOKIE_SECRET|YAOHUO_EXPIRED_COOKIE_SECRET/);
  });
});
