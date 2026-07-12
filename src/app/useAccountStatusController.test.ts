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
import { REQUEST_SUPERSEDED_MESSAGE } from '../request';
import { useAccountStatusController } from './useAccountStatusController';

type AccountStatusControllerOptions = Parameters<typeof useAccountStatusController>[0];

function createAccountStatusController(
  options: Omit<AccountStatusControllerOptions, 'currentNodeSeekCredentialGeneration' | 'loadYaohuoCookieForSource' | 'yaohuoCredentialSuppressedRef'>
    & Partial<Pick<AccountStatusControllerOptions, 'currentNodeSeekCredentialGeneration' | 'loadYaohuoCookieForSource' | 'yaohuoCredentialSuppressedRef'>>
) {
  return useAccountStatusController({
    currentNodeSeekCredentialGeneration: () => 1,
    loadYaohuoCookieForSource: async () => mocks.getItemAsync(),
    yaohuoCredentialSuppressedRef: { current: false },
    ...options
  });
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('account status diagnostics', () => {
  it('keeps yaohuo credentials and its underlying session untouched while temporary anonymous mode is active', async () => {
    mocks.getItemAsync.mockResolvedValue('YAOHUO_COOKIE_MUST_STAY_HIDDEN');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=valid' });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.getCurrentUserProfile.mockResolvedValue({ id: 'safe-user' });
    const loadYaohuoCookieForSource = vi.fn(async () => 'YAOHUO_COOKIE_MUST_STAY_HIDDEN');
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=valid'),
      loadYaohuoCookieForSource,
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => ''),
      yaohuoCredentialSuppressed: true,
      yaohuoCredentialSuppressedRef: { current: true }
    });

    await controller.refreshAccountStatus();

    expect(loadYaohuoCookieForSource).not.toHaveBeenCalled();
    expect(mocks.checkYaohuoLogin).not.toHaveBeenCalled();
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo' }));
  });

  it('restores normal yaohuo account checks when temporary anonymous mode is off', async () => {
    mocks.getItemAsync.mockResolvedValue('yaohuo=visible-again');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: true,
      loginRequired: false,
      currentUser: { id: 'safe-yaohuo-user' }
    });
    mocks.getCurrentUserProfile.mockResolvedValue({ id: 'safe-node-user' });
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=valid'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => ''),
      yaohuoCredentialSuppressed: false
    });

    await controller.refreshAccountStatus();

    expect(mocks.checkYaohuoLogin).toHaveBeenCalledWith(expect.objectContaining({
      yaohuoCookie: 'yaohuo=visible-again'
    }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      site: 'yaohuo',
      type: 'cookie-loaded',
      loggedIn: true
    }));
  });

  it('does not apply results captured from credential generations that were replaced mid-refresh', async () => {
    let nodeSeekGeneration = 3;
    let yaohuoGeneration = 5;
    let linuxDoGeneration = 8;
    const nodeSeekProfile = Promise.withResolvers<{ id: string }>();
    mocks.getItemAsync.mockResolvedValue('yaohuo=old');
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => linuxDoGeneration);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=old' });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: true,
      loginRequired: false,
      currentUser: { id: 'old-yaohuo-user' }
    });
    mocks.getCurrentUserProfile.mockImplementation(({ source }: { source: string }) => (
      source === 'nodeseek' ? nodeSeekProfile.promise : Promise.resolve({ id: `old-${source}-user` })
    ));
    const dispatchSiteSessionEvent = vi.fn();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: () => yaohuoGeneration,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(nodeSeekGeneration);
        return 'nodeseek=old';
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const refresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.getCurrentUserProfile).toHaveBeenCalled());
    nodeSeekGeneration += 1;
    yaohuoGeneration += 1;
    linuxDoGeneration += 1;
    nodeSeekProfile.resolve({ id: 'old-node-user' });
    await refresh;

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'nodeseek', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', state: 'refresh-stale' })
    ]));
  });

  it('finishes a refresh as stale when a foreground request supersedes one of its account checks', async () => {
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.getCurrentUserProfile.mockRejectedValue(new Error(REQUEST_SUPERSEDED_MESSAGE));
    const clearNodeSeekLoginCookiesOnly = vi.fn(async () => undefined);
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const dispatchSiteSessionEvent = vi.fn();
    const notify = vi.fn();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly,
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: () => 1,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=valid'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(clearNodeSeekLoginCookiesOnly).not.toHaveBeenCalled();
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo' }));
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新未完成，请稍后再试');
    const terminals = lines.map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.operation === 'refresh' && event.phase === 'finish');
    expect(terminals).toEqual([
      expect.objectContaining({ outcome: 'partial', reason: 'superseded', staleCount: 1 })
    ]);
  });

  it('does not apply an old NodeSeek account after a newer credential generation replaces its pending save', async () => {
    let nodeSeekGeneration = 3;
    const pendingSave = Promise.withResolvers<string>();
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.getCurrentUserProfile.mockResolvedValue({ id: '123', username: 'old-user' });
    const dispatchSiteSessionEvent = vi.fn();
    const notify = vi.fn();
    const saveNodeSeekCookieHeader = vi.fn(() => pendingSave.promise);
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: () => 1,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(nodeSeekGeneration);
        return 'nodeseek=old';
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader
    });

    const refresh = controller.refreshAccountStatus({ silent: true });
    await vi.waitFor(() => expect(saveNodeSeekCookieHeader).toHaveBeenCalledTimes(1));
    nodeSeekGeneration += 1;
    pendingSave.resolve('');
    await refresh;

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo' }));
    expect(notify).not.toHaveBeenCalled();
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'nodeseek', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'finish', outcome: 'partial', reason: 'superseded', staleCount: 1 })
    ]));
  });

  it('does not send credentials whose generations changed while the credential stores were loading', async () => {
    let nodeSeekGeneration = 3;
    let yaohuoGeneration = 5;
    let linuxDoGeneration = 8;
    const nodeSeekCredential = Promise.withResolvers<string>();
    const yaohuoCredential = Promise.withResolvers<string>();
    const linuxDoCredential = Promise.withResolvers<{ cookieHeader: string }>();
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => linuxDoGeneration);
    mocks.loadLinuxDoAccess.mockReturnValue(linuxDoCredential.promise);
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.getCurrentUserProfile.mockResolvedValue({ id: 'stale-user' });
    const loadNodeSeekCookieForSource = vi.fn((_source, options) => {
      options?.captureGeneration?.(nodeSeekGeneration);
      return nodeSeekCredential.promise;
    });
    const loadYaohuoCookieForSource = vi.fn(() => yaohuoCredential.promise);
    const dispatchSiteSessionEvent = vi.fn();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: () => yaohuoGeneration,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource,
      loadYaohuoCookieForSource,
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const refresh = controller.refreshAccountStatus();
    await vi.waitFor(() => {
      expect(loadNodeSeekCookieForSource).toHaveBeenCalledTimes(1);
      expect(loadYaohuoCookieForSource).toHaveBeenCalledTimes(1);
      expect(mocks.loadLinuxDoAccess).toHaveBeenCalledTimes(1);
    });
    nodeSeekGeneration += 1;
    yaohuoGeneration += 1;
    linuxDoGeneration += 1;
    nodeSeekCredential.resolve('nodeseek=stale');
    yaohuoCredential.resolve('yaohuo=stale');
    linuxDoCredential.resolve({ cookieHeader: 'linuxdo=stale' });
    await refresh;

    expect(mocks.getCurrentUserProfile).not.toHaveBeenCalled();
    expect(mocks.checkYaohuoLogin).not.toHaveBeenCalled();
    expect(mocks.checkLinuxDoLoginAccess).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'nodeseek', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', state: 'refresh-stale' })
    ]));
  });

  it('does not start a Yaohuo check when anonymous mode changes while its credential is loading', async () => {
    const yaohuoCredential = Promise.withResolvers<string>();
    const yaohuoCredentialSuppressedRef = { current: false };
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.getCurrentUserProfile.mockResolvedValue({ id: 'safe-node-user' });
    const loadYaohuoCookieForSource = vi.fn(() => yaohuoCredential.promise);
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: () => 5,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=valid'),
      loadYaohuoCookieForSource,
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => ''),
      yaohuoCredentialSuppressedRef
    });

    const refresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(loadYaohuoCookieForSource).toHaveBeenCalledTimes(1));
    yaohuoCredentialSuppressedRef.current = true;
    yaohuoCredential.resolve('yaohuo=stale');
    await refresh;

    expect(mocks.checkYaohuoLogin).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo' }));
  });

  it('does not clear a real Yaohuo credential when anonymous mode starts during refresh', async () => {
    const yaohuoCheck = Promise.withResolvers<{ ok: false; loginRequired: true; reason: 'expired' }>();
    const yaohuoCredentialSuppressedRef = { current: false };
    mocks.getItemAsync.mockResolvedValue('yaohuo=real-cookie');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.checkYaohuoLogin.mockReturnValue(yaohuoCheck.promise);
    mocks.getCurrentUserProfile.mockResolvedValue({ id: 'safe-node-user' });
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: () => 5,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=valid'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => ''),
      yaohuoCredentialSuppressedRef
    });

    const refresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.checkYaohuoLogin).toHaveBeenCalled());
    yaohuoCredentialSuppressedRef.current = true;
    yaohuoCheck.resolve({ ok: false, loginRequired: true, reason: 'expired' });
    await refresh;

    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo' }));
  });

  it('expires NodeSeek instead of reapplying a logged-in cookie after the current account returns 401', async () => {
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.getCurrentUserProfile.mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 }));
    const clearNodeSeekLoginCookiesOnly = vi.fn(async () => undefined);
    const dispatchSiteSessionEvent = vi.fn();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly,
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentNodeSeekCredentialGeneration: () => 7,
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(7);
        return 'nodeseek=expired';
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(clearNodeSeekLoginCookiesOnly).toHaveBeenCalledWith({ generation: 7 });
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      site: 'nodeseek',
      type: 'cookie-loaded'
    }));
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'nodeseek', state: 'expired' }),
      expect.objectContaining({ phase: 'finish', outcome: 'success' })
    ]));
  });

  it('does not reapply the NodeSeek login cookie when clearing it fails', async () => {
    let nodeSeekGeneration = 7;
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.getCurrentUserProfile.mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 }));
    const dispatchSiteSessionEvent = vi.fn();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => {
        nodeSeekGeneration += 1;
        throw new Error('private cleanup failure');
      }),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(7);
        return 'nodeseek=expired';
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      site: 'nodeseek',
      type: 'cookie-loaded'
    }));
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'nodeseek', state: 'error', reason: 'storage_error' }),
      expect.objectContaining({ phase: 'apply', source: 'nodeseek', state: 'expired' }),
      expect.objectContaining({ phase: 'finish', outcome: 'success' })
    ]));
    expect(lines.map((line) => JSON.parse(line))).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'nodeseek', state: 'refresh-stale' })
    ]));
    expect(lines.join('')).not.toContain('private cleanup failure');
  });

  it('keeps an ordinary NodeSeek current-account failure distinct from login expiry', async () => {
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.getCurrentUserProfile.mockRejectedValue(new Error('network request failed'));
    const clearNodeSeekLoginCookiesOnly = vi.fn(async () => undefined);
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly,
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=valid'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(clearNodeSeekLoginCookiesOnly).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      site: 'nodeseek',
      type: 'check-failed'
    }));
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      site: 'nodeseek',
      type: 'cookie-loaded'
    }));
  });

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
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentNodeSeekCredentialGeneration: () => 3,
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(3);
        options?.captureNodeSeekUserId?.(9487);
        return nodeSeekSecret;
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
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
      expect.objectContaining({ area: 'session', outcome: 'partial', partialErrorCount: 1 })
    ]);
    expect(dispatchSiteSessionEvent).toHaveBeenCalledTimes(3);
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

  it('refreshes the other site sessions when one credential store fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.getItemAsync.mockRejectedValue(new Error('private yaohuo store failure'));
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=secret' });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.getCurrentUserProfile.mockResolvedValue({ id: 'safe-user' });
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=secret'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo', type: 'check-failed' }));
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'refresh', phase: 'finish', outcome: 'partial' })
    ]));
    expect(lines.join('')).not.toMatch(/private|secret|safe-user/);
  });

  it('applies the other site sessions when persisting the NodeSeek user id fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.getCurrentUserProfile.mockResolvedValue({
      source: 'nodeseek',
      id: '123',
      username: 'safe-user'
    });
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => 'nodeseek=secret'),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => {
        throw new Error('private persist failure');
      })
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'nodeseek' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo' }));
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'persist', source: 'nodeseek', state: 'error', reason: 'storage_error' }),
      expect.objectContaining({ phase: 'finish', outcome: 'partial' })
    ]));
    expect(lines.join('')).not.toMatch(/private|secret|safe-user/);
  });

  it('records a busy refresh separately and gives the active refresh one canceled terminal', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const linuxDoCheck = Promise.withResolvers<{ ok: boolean; loginRequired: boolean }>();
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

    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 4),
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const activeRefresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.checkLinuxDoLoginAccess).toHaveBeenCalledTimes(1));
    await controller.refreshAccountStatus();
    controller.abortAccountStatusRequests();
    linuxDoCheck.resolve({ ok: true, loginRequired: false });
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
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(mocks.clearLinuxDoAccessForGeneration).toHaveBeenCalledWith(8, 'LINUXDO_EXPIRED_COOKIE_SECRET');
    expect(clearYaohuoLoginState).toHaveBeenCalledWith(expect.objectContaining({ generation: 5 }));
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'linuxdo', generation: 8, state: 'expired' }),
      expect.objectContaining({ phase: 'credential', source: 'yaohuo', generation: 5, state: 'expired' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', generation: 8, hasCredential: false }),
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', generation: 5, hasCredential: false })
    ]));
    expect(lines.join('')).not.toMatch(/LINUXDO_EXPIRED_COOKIE_SECRET|YAOHUO_EXPIRED_COOKIE_SECRET/);
  });

  it('keeps expired session results when automatic credential cleanup fails', async () => {
    let linuxDoGeneration = 8;
    let yaohuoGeneration = 5;
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.getItemAsync.mockResolvedValue('yaohuo=expired');
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => linuxDoGeneration);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=expired' });
    mocks.clearLinuxDoAccessForGeneration.mockImplementation(async () => {
      linuxDoGeneration += 1;
      throw new Error('linuxdo cleanup failed');
    });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true, reason: 'expired' });
    mocks.getCurrentUserProfile.mockResolvedValue(null);
    const clearYaohuoLoginState = vi.fn(async () => {
      yaohuoGeneration += 1;
      throw new Error('yaohuo cleanup failed');
    });
    const dispatchSiteSessionEvent = vi.fn();
    const resetLinuxDoLevelState = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: vi.fn(() => yaohuoGeneration),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState,
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(clearYaohuoLoginState).toHaveBeenCalledWith(expect.objectContaining({ generation: 5 }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'linuxdo', type: 'login-expired' }));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: 'yaohuo', type: 'login-expired' }));
    expect(resetLinuxDoLevelState).toHaveBeenCalledTimes(1);
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'linuxdo', state: 'error', reason: 'storage_error' }),
      expect.objectContaining({ phase: 'credential', source: 'yaohuo', state: 'error', reason: 'storage_error' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', state: 'blocked' }),
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', state: 'expired' }),
      expect.objectContaining({ phase: 'finish', outcome: 'success' })
    ]));
    const events = lines.map((line) => JSON.parse(line));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', state: 'refresh-stale' })
    ]));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', state: 'refresh-stale' })
    ]));
  });

  it('keeps a confirmed linux.do expiry fail-closed when its WebView cookie bundle changed during cleanup', async () => {
    const lines: string[] = [];
    const notify = vi.fn();
    const dispatchSiteSessionEvent = vi.fn();
    const resetLinuxDoLevelState = vi.fn();
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=expired' });
    mocks.clearLinuxDoAccessForGeneration.mockRejectedValue(new Error(REQUEST_SUPERSEDED_MESSAGE));
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockResolvedValue(null);
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      resetLinuxDoLevelState,
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(resetLinuxDoLevelState).toHaveBeenCalledTimes(1);
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      site: 'linuxdo',
      type: 'login-expired'
    }));
    expect(notify).toHaveBeenCalledWith('账号状态已刷新');
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'linuxdo', state: 'cleanup-skipped', reason: 'superseded' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', state: 'blocked' }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', staleCount: 0 })
    ]));
  });

  it('applies a confirmed linux.do expiry when only the now-irrelevant profile request was superseded', async () => {
    const lines: string[] = [];
    const dispatchSiteSessionEvent = vi.fn();
    const resetLinuxDoLevelState = vi.fn();
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=expired' });
    mocks.clearLinuxDoAccessForGeneration.mockResolvedValue(null);
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockImplementation(async (options: { source?: string }) => {
      if (options.source === 'linuxdo') {
        throw new Error(REQUEST_SUPERSEDED_MESSAGE);
      }
      return null;
    });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState,
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(resetLinuxDoLevelState).toHaveBeenCalledTimes(1);
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      site: 'linuxdo',
      type: 'login-expired'
    }));
    expect(lines.map((line) => JSON.parse(line))).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', state: 'refresh-stale' })
    ]));
  });

  it('does not retain a failed-site error after that site becomes stale while another cleanup is pending', async () => {
    let nodeSeekGeneration = 3;
    const linuxDoCleanup = Promise.withResolvers<null>();
    const lines: string[] = [];
    const notify = vi.fn();
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=expired' });
    mocks.clearLinuxDoAccessForGeneration.mockReturnValue(linuxDoCleanup.promise);
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockImplementation(async (options: { source?: string }) => {
      if (options.source === 'nodeseek') {
        throw new Error('temporary NodeSeek profile failure');
      }
      return null;
    });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: vi.fn(() => 1),
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(nodeSeekGeneration);
        return 'nodeseek=old';
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify,
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const refresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.clearLinuxDoAccessForGeneration).toHaveBeenCalledTimes(1));
    nodeSeekGeneration += 1;
    linuxDoCleanup.resolve(null);
    await refresh;

    expect(notify).toHaveBeenCalledWith('账号状态部分刷新未完成，请稍后再试');
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('NodeSeek'));
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'nodeseek', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'finish', outcome: 'partial', partialErrorCount: 0, staleCount: 1 })
    ]));
  });

  it('discards expired results when a newer credential write replaces each cleanup generation', async () => {
    let nodeSeekGeneration = 3;
    let yaohuoGeneration = 5;
    let linuxDoGeneration = 8;
    const nodeSeekCleanup = Promise.withResolvers<{ hasCredential: boolean }>();
    const yaohuoCleanup = Promise.withResolvers<boolean>();
    const linuxDoCleanup = Promise.withResolvers<null>();
    mocks.getItemAsync.mockResolvedValue('yaohuo=expired');
    mocks.currentLinuxDoAccessGeneration.mockImplementation(() => linuxDoGeneration);
    mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'linuxdo=expired' });
    mocks.clearLinuxDoAccessForGeneration.mockImplementation(() => {
      linuxDoGeneration += 1;
      return linuxDoCleanup.promise;
    });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true, reason: 'expired' });
    mocks.getCurrentUserProfile.mockImplementation(({ source }: { source: string }) => (
      source === 'nodeseek'
        ? Promise.reject(Object.assign(new Error('HTTP 401'), { status: 401 }))
        : Promise.resolve(null)
    ));
    const clearNodeSeekLoginCookiesOnly = vi.fn(() => {
      nodeSeekGeneration += 1;
      return nodeSeekCleanup.promise;
    });
    const clearYaohuoLoginState = vi.fn(() => {
      yaohuoGeneration += 1;
      return yaohuoCleanup.promise;
    });
    const dispatchSiteSessionEvent = vi.fn();
    const resetLinuxDoLevelState = vi.fn();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly,
      clearYaohuoLoginState,
      currentNodeSeekCredentialGeneration: () => nodeSeekGeneration,
      currentYaohuoCredentialGeneration: () => yaohuoGeneration,
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(nodeSeekGeneration);
        return 'nodeseek=expired';
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState,
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const refresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.clearLinuxDoAccessForGeneration).toHaveBeenCalledTimes(1));
    linuxDoGeneration += 1;
    linuxDoCleanup.resolve(null);
    await vi.waitFor(() => expect(clearNodeSeekLoginCookiesOnly).toHaveBeenCalledTimes(1));
    nodeSeekGeneration += 1;
    nodeSeekCleanup.resolve({ hasCredential: false });
    await vi.waitFor(() => expect(clearYaohuoLoginState).toHaveBeenCalledTimes(1));
    yaohuoGeneration += 1;
    yaohuoCleanup.resolve(true);
    await refresh;

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(resetLinuxDoLevelState).not.toHaveBeenCalled();
    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'nodeseek', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', state: 'refresh-stale' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', state: 'refresh-stale' })
    ]));
    expect(events.filter((event) => event.phase === 'apply' && ['nodeseek', 'yaohuo'].includes(event.source) && event.state === 'expired')).toHaveLength(0);
    expect(events.filter((event) => event.phase === 'apply' && event.source === 'linuxdo' && event.state === 'blocked')).toHaveLength(0);
  });

  it('maps a yaohuo verification error without clearing the cookie', async () => {
    mocks.getItemAsync.mockResolvedValue('YAOHUO_COOKIE_SECRET');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mocks.loadLinuxDoAccess.mockResolvedValue(null);
    mocks.checkYaohuoLogin.mockRejectedValue(Object.assign(new Error('妖火需要完成访问验证'), {
      source: 'yaohuo',
      loginRequired: true,
      reason: 'verification'
    }));
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const dispatchSiteSessionEvent = vi.fn();
    const controller = createAccountStatusController({
      clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: vi.fn(() => 6),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith({
      site: 'yaohuo',
      type: 'verification-required',
      message: '妖火需要完成访问验证'
    });
    expect(dispatchSiteSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      site: 'yaohuo',
      type: 'check-failed'
    }));
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
  });
});
