import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import type { LinuxDoLevelProfile, SourceGateway } from '../../src/sources/sourceGateway';
import { useAccountController } from '../../src/app/useAccountController';
import type { Screen } from '../../src/appTypes';
import type { SiteSessionState } from '../../src/siteSessionState';
import {
  appQueryClient,
  initialForumSessionEpochs
} from '../../src/app/serverState';
import type { AccountReconcileResult } from '../../src/app/useAccountStatusController';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';
import { QueryTestWrapper } from './QueryTestWrapper';

const ref = <T,>(current: T) => ({ current });
const loggedInSession: SiteSessionState = {
  site: 'nodeseek',
  status: 'logged-in',
  cookieSummary: ['session'],
  isVerifying: false,
  currentUser: {
    source: 'nodeseek',
    id: '42',
    username: 'alice',
    url: 'https://www.nodeseek.com/people/alice',
    topics: []
  }
};

function linuxDoCloudflareError(message = 'linux.do 需要完成 Cloudflare 验证') {
  return Object.assign(new Error(message), {
    source: 'linuxdo',
    reason: 'cloudflare'
  });
}

const mockManagedLinuxDoLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>();
const mountedHooks: Array<{ unmount: () => void }> = [];

async function renderAccountController(
  overrides: Partial<Parameters<typeof useAccountController>[0]> = {}
) {
  const baseProps: Parameters<typeof useAccountController>[0] = {
    checkingRequestIdRef: ref(0),
    clearLinuxDoLoginState: jest.fn(async () => true),
    clearNodeSeekLoginState: jest.fn(async () => true),
    clearYaohuoLoginState: jest.fn(async () => true),
    sessionEpochs: initialForumSessionEpochs,
    linuxDoVerificationActive: false,
    nodeSeekLoginPanelRequestRef: ref(7),
    nodeSeekWebViewUserAgentRef: ref(''),
    notify: jest.fn(),
    onLoginWebViewFailure: jest.fn(),
    reconcileAccountStatus: jest.fn<
      Parameters<typeof useAccountController>[0]['reconcileAccountStatus']
    >(async () => ({
      status: 'same',
      session: loggedInSession
    })),
    resetLinuxDoLevelState: jest.fn(),
    resetLinuxDoWebView: jest.fn(),
    screen: 'more',
    setChecking: jest.fn() as never,
    setNodeSeekWebViewUserAgent: jest.fn() as never,
    showLinuxDoVerification: jest.fn<
      (message?: string, recovery?: LinuxDoReadRecovery) => void
    >(),
    sourceGateway: {
      getLinuxDoLevelProfile: mockManagedLinuxDoLevelProfile
    },
    showLoginPanelRef: ref(true),
    showYaohuoLoginPanel: true,
    webViewRef: ref({
      reload: jest.fn(),
      stopLoading: jest.fn()
    }) as never,
    yaohuoLoginPanelRequestRef: ref(9),
    yaohuoWebViewRef: ref({
      reload: jest.fn(),
      stopLoading: jest.fn()
    }) as never
  };
  const hook = await renderNativeHook(
    () => useAccountController({
      ...baseProps,
      ...overrides
    }),
    { wrapper: QueryTestWrapper }
  );
  mountedHooks.push(hook);
  return {
    hook,
    props: {
      ...baseProps,
      ...overrides
    }
  };
}

describe('account workflows with canonical identity reconciliation', () => {
  beforeEach(() => {
    appQueryClient.clear();
    jest.clearAllMocks();
    mockManagedLinuxDoLevelProfile.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      for (const hook of mountedHooks.splice(0)) {
        hook.unmount();
      }
      await Promise.resolve();
    });
    jest.useRealTimers();
  });

  it('reads linux.do level through SourceGateway with only the Query signal', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn(async () => profile);
    const { hook } = await renderAccountController({
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    });

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
    await waitFor(() => {
      expect(hook.result.current.linuxDoLevelProfile).toEqual(profile);
    });
  });

  it('[REG-ACCOUNT-031] does not start a linux.do Level read while identity is pending', async () => {
    const getLevelProfile = jest.fn(async () => ({ username: 'alice' } as LinuxDoLevelProfile));
    const { hook } = await renderAccountController({
      linuxDoIdentityPending: true,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    });

    await expect(hook.result.current.refreshLinuxDoLevel()).resolves.toBe(false);
    expect(getLevelProfile).not.toHaveBeenCalled();
    expect(hook.result.current.linuxDoLevelBusy).toBe(false);
  });

  it('[REG-LINUXDO-006] resumes the exact active Level Query once after verification', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError())
      .mockResolvedValueOnce(profile);
    const showLinuxDoVerification = jest.fn<
      (message?: string, recovery?: LinuxDoReadRecovery) => void
    >();
    const { hook } = await renderAccountController({
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    });

    let refresh!: Promise<boolean>;
    await act(async () => {
      refresh = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await expect(refresh).resolves.toBe(false);
    await waitFor(() => {
      expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    expect(appQueryClient.getQueryCache().find({
      queryKey: recovery.queryKey,
      exact: true
    })?.isActive()).toBe(true);
    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(getLevelProfile).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(hook.result.current.linuxDoLevelProfile).toEqual(profile);
    });
  });

  it('[REG-LINUXDO-006] aborts Level recovery and makes it stale after leaving More', async () => {
    let recoverySignal: AbortSignal | undefined;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError())
      .mockImplementationOnce(async ({ signal }) => {
        recoverySignal = signal;
        return new Promise<LinuxDoLevelProfile>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          );
        });
      });
    const showLinuxDoVerification = jest.fn<
      (message?: string, recovery?: LinuxDoReadRecovery) => void
    >();
    const overrides: Partial<Parameters<typeof useAccountController>[0]> = {
      screen: 'more' as Screen,
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    };
    const { hook } = await renderAccountController(overrides);
    await act(async () => {
      void hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    });
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
  });

  it('[REG-VERIFICATION-001] retains Level recovery across explicit repeated checks', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError())
      .mockRejectedValueOnce(linuxDoCloudflareError('仍需验证'))
      .mockResolvedValueOnce(profile);
    const showLinuxDoVerification = jest.fn<
      (message?: string, recovery?: LinuxDoReadRecovery) => void
    >();
    const { hook } = await renderAccountController({
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    });
    await act(async () => {
      void hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('verification-required');
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(getLevelProfile).toHaveBeenCalledTimes(3);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('releases Level state when verification preparation is rejected', async () => {
    const profile = { username: 'alice' } as LinuxDoLevelProfile;
    const getLevelProfile = jest.fn<SourceGateway['getLinuxDoLevelProfile']>()
      .mockRejectedValueOnce(linuxDoCloudflareError())
      .mockResolvedValueOnce(profile);
    const showLinuxDoVerification = jest.fn<
      (message?: string, recovery?: LinuxDoReadRecovery) => Promise<boolean>
    >(async () => false);
    const { hook } = await renderAccountController({
      showLinuxDoVerification,
      sourceGateway: { getLinuxDoLevelProfile: getLevelProfile }
    });

    let first!: Promise<boolean>;
    await act(async () => {
      first = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    let firstResult = true;
    await act(async () => {
      firstResult = await first;
      await Promise.resolve();
    });
    expect(firstResult).toBe(false);
    await waitFor(() => {
      expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    await waitFor(() => {
      expect(appQueryClient.getQueryCache().find({
        queryKey: recovery.queryKey,
        exact: true
      })?.isActive()).toBe(false);
    });

    let second!: Promise<boolean>;
    await act(async () => {
      second = hook.result.current.refreshLinuxDoLevel();
      await Promise.resolve();
    });
    let secondResult = false;
    await act(async () => {
      secondResult = await second;
      await Promise.resolve();
    });
    expect(secondResult).toBe(true);
    expect(getLevelProfile).toHaveBeenCalledTimes(2);
  });

  it('[REG-ACCOUNT-031] accepts only same-origin NodeSeek messages and never consumes page cookies', async () => {
    const setNodeSeekWebViewUserAgent = jest.fn();
    const userAgentRef = ref('');
    const { hook } = await renderAccountController({
      nodeSeekWebViewUserAgentRef: userAgentRef,
      setNodeSeekWebViewUserAgent: setNodeSeekWebViewUserAgent as never
    });

    await act(() => {
      hook.result.current.handleLoginMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'nodeseek-login',
            cookie: 'PAGE_COOKIE_MUST_BE_IGNORED',
            userAgent: 'trusted-agent'
          }),
          url: 'https://www.nodeseek.com/signIn.html'
        }
      } as never);
    });

    expect(userAgentRef.current).toBe('trusted-agent');
    expect(setNodeSeekWebViewUserAgent).toHaveBeenCalledWith('trusted-agent');
  });

  it('ignores a valid-looking NodeSeek message from the Cloudflare host', async () => {
    const setNodeSeekWebViewUserAgent = jest.fn();
    const userAgentRef = ref('');
    const { hook } = await renderAccountController({
      nodeSeekWebViewUserAgentRef: userAgentRef,
      setNodeSeekWebViewUserAgent: setNodeSeekWebViewUserAgent as never
    });

    await act(() => {
      hook.result.current.handleLoginMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'nodeseek-login',
            userAgent: 'forged-agent'
          }),
          url: 'https://challenges.cloudflare.com/frame'
        }
      } as never);
    });

    expect(userAgentRef.current).toBe('');
    expect(setNodeSeekWebViewUserAgent).not.toHaveBeenCalled();
  });

  it('runs every settled manual NodeSeek check through canonical reconciliation', async () => {
    const reconcileAccountStatus = jest.fn<
      (source: 'nodeseek' | 'yaohuo') => Promise<AccountReconcileResult>
    >(async () => ({ status: 'same', session: loggedInSession }));
    const { hook } = await renderAccountController({ reconcileAccountStatus });

    await act(async () => {
      await expect(hook.result.current.checkLogin()).resolves.toBe(true);
      await expect(hook.result.current.checkLogin()).resolves.toBe(true);
    });

    expect(reconcileAccountStatus).toHaveBeenNthCalledWith(1, 'nodeseek');
    expect(reconcileAccountStatus).toHaveBeenNthCalledWith(2, 'nodeseek');
  });

  it('[REG-ACCOUNT-035] exposes the authoritative NodeSeek result to recovery orchestration', async () => {
    const changed = {
      status: 'changed' as const,
      session: loggedInSession
    };
    const reconcileAccountStatus = jest.fn(async () => changed);
    const { hook } = await renderAccountController({ reconcileAccountStatus });

    await act(async () => {
      await expect(hook.result.current.checkNodeSeekAccount()).resolves.toBe(changed);
    });
  });

  it('routes manual Yaohuo checks through the same canonical reconciliation path', async () => {
    const reconcileAccountStatus = jest.fn<
      (source: 'nodeseek' | 'yaohuo') => Promise<AccountReconcileResult>
    >(async () => ({ status: 'same', session: {
      ...loggedInSession,
      site: 'yaohuo',
      currentUser: {
        ...loggedInSession.currentUser!,
        source: 'yaohuo'
      }
    } }));
    const { hook } = await renderAccountController({ reconcileAccountStatus });

    await act(async () => {
      await expect(hook.result.current.checkYaohuoCookie()).resolves.toBe(true);
    });

    expect(reconcileAccountStatus).toHaveBeenCalledWith('yaohuo');
  });

  it('keeps unknown identity retryable without invoking a logout or clear path', async () => {
    const clearNodeSeekLoginState = jest.fn(async () => true);
    const notify = jest.fn();
    const { hook } = await renderAccountController({
      clearNodeSeekLoginState,
      notify,
      reconcileAccountStatus: jest.fn<
        Parameters<typeof useAccountController>[0]['reconcileAccountStatus']
      >(async () => ({
        status: 'unknown',
        error: 'network unavailable'
      }))
    });

    await act(async () => {
      await expect(hook.result.current.checkLogin()).resolves.toBe(false);
    });

    expect(notify).toHaveBeenCalledWith('network unavailable');
    expect(clearNodeSeekLoginState).not.toHaveBeenCalled();
  });

  it('reports confirmed anonymous without invoking a logout command during validation', async () => {
    const clearYaohuoLoginState = jest.fn(async () => true);
    const notify = jest.fn();
    const { hook } = await renderAccountController({
      clearYaohuoLoginState,
      notify,
      reconcileAccountStatus: jest.fn<
        Parameters<typeof useAccountController>[0]['reconcileAccountStatus']
      >(async () => ({
        status: 'anonymous',
        session: {
          site: 'yaohuo',
          status: 'anonymous',
          cookieSummary: [],
          isVerifying: false
        }
      }))
    });

    await act(async () => {
      await expect(hook.result.current.checkYaohuoCookie()).resolves.toBe(false);
    });

    expect(notify).toHaveBeenCalledWith('妖火当前未登录。');
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
  });

  it('ignores a stale result after a newer manual check owns the request', async () => {
    const first = Promise.withResolvers<AccountReconcileResult>();
    const reconcileAccountStatus = jest.fn<
      (source: 'nodeseek' | 'yaohuo') => Promise<AccountReconcileResult>
    >()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ status: 'same', session: loggedInSession });
    const notify = jest.fn();
    const { hook } = await renderAccountController({
      notify,
      reconcileAccountStatus
    });

    let oldCheck!: Promise<boolean>;
    await act(async () => {
      oldCheck = hook.result.current.checkLogin();
      await Promise.resolve();
    });
    await act(async () => {
      await expect(hook.result.current.checkLogin()).resolves.toBe(true);
    });
    first.resolve({ status: 'changed', session: loggedInSession });
    await act(async () => {
      await expect(oldCheck).resolves.toBe(false);
    });

    expect(notify.mock.calls.filter(([message]) => (
      message === '已确认 NodeSeek当前账号。'
    ))).toHaveLength(1);
  });

  it('[REG-ACCOUNT-031] invokes Cookie clearing only from the explicit NodeSeek clear command', async () => {
    const clearNodeSeekLoginState = jest.fn(async () => true);
    const reload = jest.fn();
    const { hook } = await renderAccountController({
      clearNodeSeekLoginState,
      webViewRef: ref({ reload }) as never
    });

    expect(clearNodeSeekLoginState).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.clearLogin();
    });

    expect(clearNodeSeekLoginState).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a login surface when native Cookie clear is unconfirmed', async () => {
    const reload = jest.fn();
    const { hook } = await renderAccountController({
      clearYaohuoLoginState: jest.fn(async () => false),
      yaohuoWebViewRef: ref({ reload }) as never
    });

    await act(async () => {
      await hook.result.current.clearYaohuoLogin();
    });

    expect(reload).not.toHaveBeenCalled();
  });

  it('resets linux.do views only after an explicit confirmed native clear', async () => {
    const clearLinuxDoLoginState = jest.fn(async () => true);
    const resetLinuxDoLevelState = jest.fn();
    const resetLinuxDoWebView = jest.fn();
    const { hook } = await renderAccountController({
      clearLinuxDoLoginState,
      resetLinuxDoLevelState,
      resetLinuxDoWebView
    });

    await act(async () => {
      await hook.result.current.clearLinuxDoCookie();
    });

    expect(clearLinuxDoLoginState).toHaveBeenCalledTimes(1);
    expect(resetLinuxDoLevelState).toHaveBeenCalledTimes(1);
    expect(resetLinuxDoWebView).toHaveBeenCalledTimes(1);
  });

  it('reports one terminal WebView failure per panel request', async () => {
    const onLoginWebViewFailure = jest.fn();
    const { hook } = await renderAccountController({ onLoginWebViewFailure });

    await act(() => {
      hook.result.current.recordNodeSeekLoginWebViewState('renderer-gone', 3);
      hook.result.current.recordNodeSeekLoginWebViewState('error', 3);
    });

    expect(onLoginWebViewFailure).toHaveBeenCalledTimes(1);
    expect(onLoginWebViewFailure).toHaveBeenCalledWith(
      'nodeseek',
      3,
      'renderer_gone'
    );
  });
});
