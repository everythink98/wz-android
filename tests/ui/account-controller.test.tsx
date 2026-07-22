import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-cookies/cookies', () => ({
  __esModule: true,
  default: {
    flush: jest.fn(),
    get: jest.fn()
  }
}));

jest.mock('../../src/nodeseekCookieBridge', () => ({
  readNodeSeekCookiesFromStores: jest.fn()
}));

jest.mock('../../src/nodeseekCookies', () => ({
  mergeNodeSeekCookies: (...maps: Array<Record<string, unknown>>) => Object.assign({}, ...maps),
  parseNodeSeekDocumentCookie: (header: string) => header ? {
    session: { name: 'session', value: header }
  } : {},
  sanitizeNodeSeekUserAgent: (userAgent: string) => userAgent,
  summarizeNodeSeekCookies: () => ({ count: 1, loggedIn: true, names: ['session'] })
}));

jest.mock('../../src/yaohuoCookies', () => ({
  buildYaohuoCookieHeader: () => 'sidyaohuo=safe',
  canStoreYaohuoCookieHeader: () => true,
  mergeYaohuoCookies: (...maps: Array<Record<string, unknown>>) => Object.assign({}, ...maps),
  summarizeYaohuoCookies: () => ({ count: 1, loggedIn: true, names: ['sidyaohuo'] })
}));

jest.mock('../../src/linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: jest.fn(),
  currentLinuxDoAccessGeneration: jest.fn(),
  linuxDoAccessSummary: jest.fn(),
  loadLinuxDoAccess: jest.fn(),
  parseLinuxDoDocumentCookie: () => ({}),
  summarizeLinuxDoCookies: () => ({ names: ['cf_clearance'] })
}));

jest.mock('../../src/sources/sourceGateway', () => ({
  checkYaohuoLogin: jest.fn()
}));

import CookieManager from '@react-native-cookies/cookies';
import { readNodeSeekCookiesFromStores } from '../../src/nodeseekCookieBridge';
import {
  clearLinuxDoAccess,
  currentLinuxDoAccessGeneration,
  linuxDoAccessSummary,
  loadLinuxDoAccess
} from '../../src/linuxdoCookieBridge';
import { checkYaohuoLogin, type LinuxDoLevelProfile, type SourceGateway } from '../../src/sources/sourceGateway';
import { useAccountController } from '../../src/app/useAccountController';
import type { Screen } from '../../src/appTypes';
import { appQueryClient, emptyForumCredentialScope } from '../../src/app/serverState';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';
import { QueryTestWrapper } from './QueryTestWrapper';

const mockCookies = {
  flush: jest.mocked(CookieManager.flush),
  get: jest.mocked(CookieManager.get)
};
const mockBridge = {
  readNodeSeekCookiesFromStores: jest.mocked(readNodeSeekCookiesFromStores)
};
const mockLinux = {
  clearLinuxDoAccess: jest.mocked(clearLinuxDoAccess),
  currentLinuxDoAccessGeneration: jest.mocked(currentLinuxDoAccessGeneration),
  linuxDoAccessSummary: jest.mocked(linuxDoAccessSummary),
  loadLinuxDoAccess: jest.mocked(loadLinuxDoAccess)
};
const mockGateway = {
  checkYaohuoLogin: jest.mocked(checkYaohuoLogin)
};
const mockManagedLinuxDoLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>();

const ref = <T,>(current: T) => ({ current });

function linuxDoCloudflareError(message = 'linux.do 需要完成 Cloudflare 验证') {
  return Object.assign(new Error(message), {
    source: 'linuxdo',
    reason: 'cloudflare'
  });
}

async function renderAccountController(overrides: Partial<Parameters<typeof useAccountController>[0]> = {}) {
  return renderNativeHook(() => useAccountController({
    checkingRequestIdRef: ref(0),
    clearNodeSeekLoginState: jest.fn(async () => true),
    clearYaohuoLoginState: jest.fn(async () => true),
    credentialScope: emptyForumCredentialScope,
    currentNodeSeekCredentialGeneration: () => 3,
    currentYaohuoCredentialGeneration: () => 4,
    forumFetchWithWebViewFallback: jest.fn(async () => new Response('{}')),
    linuxDoVerificationActive: false,
    nodeSeekLoginPanelRequestRef: ref(7),
    nodeSeekCurrentUserId: null,
    nodeSeekWebViewCookieHeaderRef: ref(''),
    nodeSeekWebViewUserAgentRef: ref(''),
    notify: jest.fn(),
    onLoginWebViewFailure: jest.fn(),
    resetLinuxDoLevelState: jest.fn(),
    resetLinuxDoWebView: jest.fn(),
    saveNodeSeekCookieHeader: jest.fn(async () => 'saved'),
    saveYaohuoCookieHeader: jest.fn(async () => true),
    setChecking: jest.fn() as never,
    setNodeSeekWebViewUserAgent: jest.fn() as never,
    setWebLoginUserId: jest.fn() as never,
    screen: 'more',
    showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
    sourceGateway: { getLinuxDoLevelProfile: mockManagedLinuxDoLevelProfile },
    showLoginPanelRef: ref(true),
    showYaohuoLoginPanel: true,
    updateLinuxDoSession: jest.fn(),
    updateYaohuoSession: jest.fn(),
    webLoginDetectedRef: ref(false),
    webViewRef: ref({ injectJavaScript: jest.fn(), reload: jest.fn() }) as never,
    yaohuoLoginPanelRequestRef: ref(9),
    yaohuoWebViewRef: ref({ reload: jest.fn() }) as never,
    ...overrides
  }), { wrapper: QueryTestWrapper });
}

describe('account credential workflows with query-backed level state', () => {
  beforeEach(() => {
    appQueryClient.clear();
    jest.clearAllMocks();
    mockManagedLinuxDoLevelProfile.mockReset();
    mockCookies.flush.mockResolvedValue(undefined);
    mockCookies.get.mockResolvedValue({});
    mockBridge.readNodeSeekCookiesFromStores.mockResolvedValue({});
    mockLinux.clearLinuxDoAccess.mockResolvedValue(null);
    mockLinux.currentLinuxDoAccessGeneration.mockReturnValue(1);
    mockLinux.linuxDoAccessSummary.mockReturnValue({ hasClearance: false, loggedIn: false, savedAt: undefined });
    mockLinux.loadLinuxDoAccess.mockResolvedValue(null);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('reads linux.do level through the managed SourceGateway with only the Query signal', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn(async () => profile);
    const hook = await renderAccountController({
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    } as never);

    let refresh!: Promise<boolean>;
    await act(async () => {
      refresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await expect(refresh).resolves.toBe(true);

    expect(getLevelProfile).toHaveBeenCalledWith({
      source: 'linuxdo',
      signal: expect.any(Object)
    });
    await waitFor(() => expect(hook.result.current.linuxDoLevelProfile).toEqual(profile));
  });

  it('[REG-LINUXDO-006] keeps a failed Level Query active and resumes that exact request once after verification', async () => {
    const cloudflare = linuxDoCloudflareError();
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(cloudflare)
      .mockResolvedValueOnce(profile);
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderAccountController({
      screen: 'more',
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    } as never);

    let refresh!: Promise<boolean>;
    await act(async () => {
      refresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await expect(refresh).resolves.toBe(false);
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    expect(recovery).toBeDefined();
    expect(getLevelProfile).toHaveBeenCalledTimes(1);
    expect(appQueryClient.getQueryCache().find({ queryKey: recovery.queryKey, exact: true })?.isActive()).toBe(true);
    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(getLevelProfile).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(hook.result.current.linuxDoLevelProfile).toEqual(profile));
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('[REG-LINUXDO-006] aborts an in-flight Level recovery and makes it stale after leaving More', async () => {
    let recoverySignal: AbortSignal | undefined;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError())
      .mockImplementationOnce(async ({ signal }) => {
        recoverySignal = signal;
        return new Promise<LinuxDoLevelProfile>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const overrides = {
      screen: 'more' as Screen,
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    } as Partial<Parameters<typeof useAccountController>[0]>;
    const hook = await renderAccountController(overrides);
    await act(async () => {
      void hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    let resume!: ReturnType<LinuxDoReadRecovery['resume']>;
    await act(async () => {
      resume = recovery.resume();
      await Promise.resolve();
    });
    await waitFor(() => expect(getLevelProfile).toHaveBeenCalledTimes(2));

    overrides.screen = 'feed';
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(recoverySignal?.aborted).toBe(true));
    await act(async () => {
      await expect(resume).resolves.toBe('stale');
    });

    expect(appQueryClient.getQueryCache().find({ queryKey: recovery.queryKey, exact: true })?.isActive()).toBe(false);
    expect(getLevelProfile).toHaveBeenCalledTimes(2);
  });

  it('[REG-LINUXDO-006] invalidates Level recovery when the user closes verification', async () => {
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError());
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const overrides = {
      linuxDoVerificationActive: false,
      screen: 'more' as Screen,
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    } as Partial<Parameters<typeof useAccountController>[0]>;
    const hook = await renderAccountController(overrides);
    await act(async () => {
      void hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    overrides.linuxDoVerificationActive = true;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    overrides.linuxDoVerificationActive = false;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await expect(recovery.resume()).resolves.toBe('stale');
    expect(appQueryClient.getQueryCache().find({ queryKey: recovery.queryKey, exact: true })?.isActive()).toBe(false);
    expect(getLevelProfile).toHaveBeenCalledTimes(1);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('[REG-VERIFICATION-001] keeps Level recovery available for an explicit retry after Cloudflare is returned again', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError())
      .mockRejectedValueOnce(linuxDoCloudflareError('linux.do 仍需验证'))
      .mockResolvedValueOnce(profile);
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderAccountController({
      screen: 'more',
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    } as never);
    await act(async () => {
      void hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('verification-required');
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(getLevelProfile).toHaveBeenCalledTimes(3);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hook.result.current.linuxDoLevelProfile).toEqual(profile));
  });

  it('[REG-LINUXDO-006] releases Level after verification preparation is rejected so the user can retry', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError())
      .mockResolvedValueOnce(profile);
    const showLinuxDoVerification = jest.fn<(
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => Promise<boolean>>(async () => false);
    const hook = await renderAccountController({
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    } as never);

    let firstRefresh!: Promise<boolean>;
    await act(async () => {
      firstRefresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    let firstResult = true;
    await act(async () => {
      firstResult = await firstRefresh;
      await Promise.resolve();
    });
    expect(firstResult).toBe(false);
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    await waitFor(() => {
      expect(appQueryClient.getQueryCache().find({ queryKey: recovery.queryKey, exact: true })?.isActive()).toBe(false);
    });

    let secondRefresh!: Promise<boolean>;
    await act(async () => {
      secondRefresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await expect(secondRefresh).resolves.toBe(true);

    expect(getLevelProfile).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(hook.result.current.linuxDoLevelProfile).toEqual(profile));
  });

  it('[REG-ACCOUNT-018] reports a failed linux.do level refresh even when trusted data already exists', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockResolvedValueOnce(profile)
      .mockRejectedValueOnce(new Error('linux.do 等级刷新失败'));
    const notify = jest.fn();
    const hook = await renderAccountController({
      notify,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    } as never);

    let firstRefresh!: Promise<boolean>;
    await act(async () => {
      firstRefresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await expect(firstRefresh).resolves.toBe(true);
    await waitFor(() => expect(hook.result.current.linuxDoLevelProfile).toEqual(profile));
    let secondRefresh!: Promise<boolean>;
    await act(async () => {
      secondRefresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await expect(secondRefresh).resolves.toBe(false);

    await waitFor(() => {
      expect(hook.result.current.linuxDoLevelProfile).toEqual(profile);
      expect(hook.result.current.linuxDoLevelError).toBe('linux.do 等级刷新失败');
    });
    expect(notify.mock.calls.filter(([message]) => message === 'linux.do 等级已更新。')).toHaveLength(1);
  });

  it('REG-ACCOUNT-009 does not cache or report a linux.do level response from superseded credentials', async () => {
    let generation = 4;
    const transport = Promise.withResolvers<LinuxDoLevelProfile>();
    mockLinux.currentLinuxDoAccessGeneration.mockImplementation(() => generation);
    mockLinux.linuxDoAccessSummary.mockReturnValue({ hasClearance: true, loggedIn: true, savedAt: undefined });
    mockLinux.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: '_t=old',
      userAgent: 'old-agent',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview'
    });
    mockManagedLinuxDoLevelProfile.mockImplementationOnce(async () => {
      const profile = await transport.promise;
      if (generation !== 4) throw new Error('credential changed');
      return profile;
    });
    const notify = jest.fn();
    const hook = await renderAccountController({ notify });
    let refresh!: Promise<boolean>;

    await act(async () => {
      refresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockManagedLinuxDoLevelProfile).toHaveBeenCalledTimes(1));
    generation = 5;
    await act(async () => {
      transport.resolve({ username: 'old-user' } as LinuxDoLevelProfile);
      await refresh;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(hook.result.current.linuxDoLevelBusy).toBe(false));
    expect(hook.result.current.linuxDoLevelProfile).toBeNull();
    expect(notify).not.toHaveBeenCalledWith('linux.do 等级已更新。');
  });

  it('REG-ACCOUNT-005 ignores a valid-looking NodeSeek message from the Cloudflare host', async () => {
    const setWebLoginUserId = jest.fn();
    const setNodeSeekWebViewUserAgent = jest.fn();
    const hook = await renderAccountController({
      setNodeSeekWebViewUserAgent: setNodeSeekWebViewUserAgent as never,
      setWebLoginUserId: setWebLoginUserId as never
    });

    await act(async () => {
      hook.result.current.handleLoginMessage({
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
    });

    expect(setWebLoginUserId).not.toHaveBeenCalled();
    expect(setNodeSeekWebViewUserAgent).not.toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-001] performs a fresh NodeSeek read for every settled manual check', async () => {
    jest.useFakeTimers();
    const saveNodeSeekCookieHeader = jest.fn(async () => 'saved');
    const hook = await renderAccountController({ saveNodeSeekCookieHeader });

    let first!: ReturnType<typeof hook.result.current.checkLogin>;
    await act(async () => {
      first = hook.result.current.checkLogin();
      await jest.advanceTimersByTimeAsync(250);
    });
    await expect(first).resolves.toBe(true);

    let second!: ReturnType<typeof hook.result.current.checkLogin>;
    await act(async () => {
      second = hook.result.current.checkLogin();
      await jest.advanceTimersByTimeAsync(250);
    });
    await expect(second).resolves.toBe(true);

    expect(mockBridge.readNodeSeekCookiesFromStores).toHaveBeenCalledTimes(2);
    expect(saveNodeSeekCookieHeader).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('[REG-VERIFICATION-001] performs a fresh direct Yaohuo check for every settled manual check', async () => {
    mockCookies.get.mockResolvedValue({ sidyaohuo: { name: 'sidyaohuo', value: 'saved-session' } });
    mockGateway.checkYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: true,
      loginRequired: false,
      loginUrl: '',
      message: undefined,
      reason: undefined
    });
    const hook = await renderAccountController();

    await act(async () => { await hook.result.current.checkYaohuoCookie(); });
    await act(async () => { await hook.result.current.checkYaohuoCookie(); });

    expect(mockCookies.flush).toHaveBeenCalledTimes(2);
    expect(mockGateway.checkYaohuoLogin).toHaveBeenCalledTimes(2);
  });

  it('REG-ACCOUNT-004 keeps confirmed Yaohuo expiry as the final event after cleanup', async () => {
    mockCookies.get.mockResolvedValue({ sidyaohuo: { name: 'sidyaohuo', value: 'saved-session' } });
    mockGateway.checkYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      loginUrl: 'https://www.yaohuo.me/login.aspx',
      reason: 'expired',
      message: '妖火登录已失效，请重新登录。'
    });
    const updateYaohuoSession = jest.fn();
    const clearYaohuoLoginState = jest.fn(async () => {
      updateYaohuoSession({ type: 'cleared' });
      return true;
    });
    const hook = await renderAccountController({ clearYaohuoLoginState, updateYaohuoSession });

    await act(async () => { await hook.result.current.checkYaohuoCookie(); });

    expect(clearYaohuoLoginState).toHaveBeenCalledWith({
      generation: 4,
      expiredMessage: '妖火登录已失效，请重新登录。'
    });
    expect(updateYaohuoSession).toHaveBeenLastCalledWith({
      type: 'login-expired',
      message: '妖火登录已失效，请重新登录。'
    });
  });

  it('REG-ACCOUNT-007 preserves the typed expiry when Yaohuo cleanup also fails', async () => {
    mockCookies.get.mockResolvedValue({ sidyaohuo: { name: 'sidyaohuo', value: 'saved-session' } });
    mockGateway.checkYaohuoLogin.mockRejectedValue(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));
    const notify = jest.fn();
    const updateYaohuoSession = jest.fn();
    const hook = await renderAccountController({
      clearYaohuoLoginState: jest.fn(async () => { throw new Error('cleanup failed'); }),
      notify,
      updateYaohuoSession
    });

    await act(async () => { await hook.result.current.checkYaohuoCookie(); });

    expect(updateYaohuoSession).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'login-expired',
      message: expect.stringContaining('清理未完成')
    }));
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('清理未完成'));
  });

  it('REG-ACCOUNT-009 ignores stale manual clears and keeps retained linux.do clearance explicit', async () => {
    const nodeReload = jest.fn();
    const yaohuoReload = jest.fn();
    const notify = jest.fn();
    const updateLinuxDoSession = jest.fn();
    mockLinux.clearLinuxDoAccess.mockResolvedValueOnce({
      cookieHeader: 'cf_clearance=retained',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview'
    });
    mockLinux.linuxDoAccessSummary.mockReturnValueOnce({ hasClearance: true, loggedIn: false, savedAt: undefined });
    const hook = await renderAccountController({
      clearNodeSeekLoginState: jest.fn(async () => false),
      clearYaohuoLoginState: jest.fn(async () => false),
      notify,
      updateLinuxDoSession,
      webViewRef: ref({ injectJavaScript: jest.fn(), reload: nodeReload }) as never,
      yaohuoWebViewRef: ref({ reload: yaohuoReload }) as never
    });

    await act(async () => {
      await hook.result.current.clearLogin();
      await hook.result.current.clearYaohuoLogin();
      await hook.result.current.clearLinuxDoCookie();
    });

    expect(nodeReload).not.toHaveBeenCalled();
    expect(yaohuoReload).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('NodeSeek Cookie'));
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('妖火 Cookie'));
    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      hasVerification: true,
      loggedIn: false
    }));
  });
});
