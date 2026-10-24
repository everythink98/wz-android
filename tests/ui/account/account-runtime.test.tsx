import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryObserver } from '@tanstack/react-query';
import { createRoot } from 'test-renderer';
import { useLayoutEffect } from 'react';
import { NativeModules } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as legacyCookieMigration from '@/platform/storage/legacyCookieSnapshotMigration';
import { markAccountSessionHandoffPending, saveAccountSessionSnapshot } from '@/platform/storage/accountSessionStore';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { useLinuxDoCredit } from '@/features/more/useLinuxDoCredit';
import { nativeSecureRandomHex } from '@/platform/android/secureRandom';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { discourseReadingQueryKey } from '@/platform/query/discourseReadingRuntime';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { readManagedCookieHeader, setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import { waitForLinuxDoLoginInitialization } from '@/platform/network/linuxDoLoginInitialization';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { createNotificationGateway } from '@/sources/notificationGateway';
import { readForegroundNotificationAccess } from '@/sources/notificationForegroundAccess';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import type { Source } from '@/domain/forum/models';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { fireEvent, render } from '../render';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: Record<string, unknown>, ref: unknown) {
      React.useImperativeHandle(
        ref,
        () => ({ stopLoading: jest.fn(), injectJavaScript: mockWebViewInjectJavaScript }),
        []
      );
      React.useEffect(() => {
        mockWebViewLoads.push((props.source as { uri?: string })?.uri || '');
      }, []);
      return React.createElement(View, { ...props, testID: 'login-webview' });
    })
  };
});
let mockWebViewLoads: string[] = [];
const mockWebViewInjectJavaScript = jest.fn<void, [string]>();
jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined),
  readManagedCookieHeader: jest.fn(async () => ({ status: 'ok', header: 'test-session=fixture' }))
}));
jest.mock('@/platform/network/linuxDoLoginInitialization', () => ({
  waitForLinuxDoLoginInitialization: jest.fn(async () => true)
}));
jest.mock('@/platform/android/secureRandom', () => ({ nativeSecureRandomHex: jest.fn() }));

let events: DiagnosticEvent[] = [];
let networkProxyDescriptor: PropertyDescriptor | undefined;
let defaultStorageRead: jest.SpyInstance;
function seedAccount(username = 'alice') {
  const snapshot = accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), {
    type: 'session-updated',
    loggedIn: true,
    currentUser: { source: 'linuxdo', id: username, username, url: `https://linux.do/u/${username}` }
  });
  appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), snapshot);
  return snapshot;
}

async function renderRuntime(fetcher: Fetcher, ready = true, enabledSources: readonly Source[] = ['linuxdo']) {
  await saveAccountSessionSnapshot(seedAccount());
  const notify = jest.fn();
  const openUser = async () => undefined;
  const loginNavigation = { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true };
  const hook = await renderHook(
    ({ enabledSources }: { enabledSources: readonly Source[] }) =>
      useAccountRuntime({
        appActive: true,
        enabledSources,
        fetcher,
        loginNavigation,
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser,
        ready,
        screen: 'search',
        webViewBlockMessage: ''
      }),
    { initialProps: { enabledSources }, wrapper: QueryTestWrapper }
  );
  if (ready) await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
  return hook;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('account-session.migration.v1', '1');
  defaultStorageRead = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  networkProxyDescriptor = Object.getOwnPropertyDescriptor(NativeModules, 'NetworkProxyModule');
  jest.spyOn(SecureStore, 'deleteItemAsync').mockResolvedValue(undefined);
  mockWebViewLoads = [];
  mockWebViewInjectJavaScript.mockReset();
  jest.mocked(nativeSecureRandomHex).mockResolvedValue('a'.repeat(32));
  events = [];
  setDiagnosticWriter((line) => {
    events.push(JSON.parse(line) as DiagnosticEvent);
  });
});
afterEach(() => {
  defaultStorageRead.mockRestore();
  setDiagnosticWriter(null);
  jest.mocked(SecureStore.deleteItemAsync).mockRestore();
  if (networkProxyDescriptor) Object.defineProperty(NativeModules, 'NetworkProxyModule', networkProxyDescriptor);
  else delete NativeModules.NetworkProxyModule;
});

describe('LDC website authorization', () => {
  async function renderCreditHosts(
    fetcher: Fetcher = async () => Response.json({ current_user: { id: 7, username: 'alice' } }),
    wireCredit = false
  ) {
    await saveAccountSessionSnapshot(seedAccount());
    const notify = jest.fn();
    let runtime!: ReturnType<typeof useAccountRuntime>;
    let credit!: ReturnType<typeof useLinuxDoCredit>;
    type HostProps = { enabled?: boolean; screen?: 'more' | 'feed'; blockedMessage?: string; appActive?: boolean };
    function Harness({ enabled = true, screen = 'more', blockedMessage = '', appActive = true }: HostProps) {
      runtime = useAccountRuntime({
        appActive,
        enabledSources: enabled ? ['linuxdo'] : [],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: true,
        screen,
        webViewBlockMessage: blockedMessage
      });
      const user = runtime.read.accountSessionViewModels.linuxdo.currentUser;
      credit = useLinuxDoCredit({
        active: wireCredit && runtime.read.sessionsReady && screen === 'more',
        gateway: runtime.read.readGateway,
        userId: user?.id || '',
        username: user?.username || '',
        sessionEpoch: runtime.read.forumSessionEpochs.linuxdo,
        connectSilently: runtime.center.linuxDoCredit.connectSilently,
        connecting: runtime.center.linuxDoCredit.busy
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
    return {
      view,
      runtime: () => runtime,
      credit: () => credit,
      rerender: (props: HostProps) => view.rerender(<Harness {...props} />),
      notify
    };
  }

  function authMessage(status: 'complete' | 'interaction-required', nonce = 'a'.repeat(32)) {
    return {
      nativeEvent: {
        url: 'https://credit.linux.do/home',
        data: JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status })
      }
    };
  }

  it.each([401, 403])(
    'automatically recovers Credit HTTP %s through the real Account gateway and resumes its balance query',
    async (status) => {
      let connected = false;
      const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
        if (url === 'https://linux.do/session/current.json')
          return Response.json({ current_user: { id: 7, username: 'alice' } });
        if (url === 'https://credit.linux.do/api/v1/oauth/user-info')
          return connected
            ? Response.json({
                error_msg: '',
                data: { id: '7', username: 'alice', available_balance: '12.34', pending_balance: '0.10' }
              })
            : new Response(status === 403 ? '<title>Just a moment...</title>' : '', {
                status,
                headers: { 'Content-Type': 'text/html', ...(status === 403 ? { 'cf-mitigated': 'challenge' } : {}) }
              });
        throw new Error(`Unexpected request ${url}`);
      });
      const { view, runtime, credit } = await renderCreditHosts(fetcher, true);
      if (status === 403) {
        await waitFor(() =>
          expect(view.getByTestId('login-webview', { includeHiddenElements: true }).props.source.uri).toBe(
            'https://credit.linux.do/api/v1/oauth/user-info'
          )
        );
        const browser = view.getByTestId('login-webview', { includeHiddenElements: true });
        await fireEvent(browser, 'loadEnd', { nativeEvent: { url: 'https://credit.linux.do/api/v1/oauth/user-info' } });
        const script = mockWebViewInjectJavaScript.mock.calls.at(-1)?.[0] || '';
        const id = Number(/const requestId = (\d+);/.exec(script)?.[1]);
        expect(Number.isFinite(id)).toBe(true);
        await fireEvent(browser, 'message', {
          nativeEvent: {
            url: 'https://credit.linux.do',
            data: JSON.stringify({
              type: 'linuxdo-browser-fetch',
              id,
              url: 'https://credit.linux.do/api/v1/oauth/user-info',
              challenge: true
            })
          }
        });
      }
      await waitFor(() =>
        expect(view.getByTestId('login-webview', { includeHiddenElements: true }).props.source.uri).toBe(
          'https://credit.linux.do/home'
        )
      );
      expect(runtime().center.linuxDoCredit.busy).toBe(true);
      expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false);
      expect(runtime().hosts.surfaces.linuxdo).toBe(false);
      expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data').state).toBe('blocked');
      expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('alice');
      expect(view.queryByText('连接 LDC')).toBeNull();
      expect(credit().error).toBeNull();
      connected = true;
      await fireEvent(view.getByTestId('login-webview', { includeHiddenElements: true }), 'message', {
        nativeEvent: { ...authMessage('complete').nativeEvent, url: 'https://credit.linux.do' }
      });
      await waitFor(() => expect(credit().account?.availableBalance).toBe('12.34'));
      expect(runtime().center.linuxDoCredit.busy).toBe(false);
      expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data').state).toBe('ready');
      await act(async () => runtime().center.linuxDoCredit.connectSilently());
      expect(mockWebViewLoads).toEqual([
        ...(status === 403 ? ['https://credit.linux.do/api/v1/oauth/user-info'] : []),
        'https://credit.linux.do/home'
      ]);
      expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
    }
  );

  it('deduplicates silent connection and stays busy until the unmounted browser hands off cookies and reconciles', async () => {
    const probe = Promise.withResolvers<Response>();
    const fetcher = jest.fn(() => probe.promise);
    const { view, runtime } = await renderCreditHosts(fetcher);
    const balance = ['forum', 'linuxdo', 'account-data', 'ldc-account'];
    appQueryClient.setQueryData(balance, { availableBalance: '1.00' });
    let pending!: Promise<void>;
    await act(async () => {
      pending = runtime().center.linuxDoCredit.connectSilently();
      expect(runtime().center.linuxDoCredit.connectSilently()).toBe(pending);
    });
    const browser = view.getByTestId('login-webview', { includeHiddenElements: true });
    expect(browser.props.injectedJavaScript).toContain('linuxdo-credit-auth');
    expect(fetcher).not.toHaveBeenCalled();
    const handoff = Promise.withResolvers<void>();
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => {
      expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
      return handoff.promise;
    });
    await fireEvent(browser, 'message', authMessage('complete'));
    expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
    expect(runtime().center.linuxDoCredit.busy).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      handoff.resolve();
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(runtime().center.linuxDoCredit.busy).toBe(true);
    await act(async () => {
      probe.resolve(Response.json({ current_user: { id: 7, username: 'alice' } }));
      await pending;
    });
    expect(runtime().center.linuxDoCredit.busy).toBe(false);
    expect(appQueryClient.getQueryState(balance)?.isInvalidated).toBe(true);
  });

  it('ends an interaction-required silent attempt without a popup or retry storm and retains manual authorization', async () => {
    const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
    const { view, runtime, notify } = await renderCreditHosts(fetcher);
    const balance = ['forum', 'linuxdo', 'account-data', 'ldc-account'];
    appQueryClient.setQueryData(balance, { availableBalance: '1.00' });
    let pending!: Promise<void>;
    await act(async () => {
      pending = runtime().center.linuxDoCredit.connectSilently();
    });
    await fireEvent(
      view.getByTestId('login-webview', { includeHiddenElements: true }),
      'message',
      authMessage('interaction-required')
    );
    await act(async () => {
      await pending;
      await runtime().center.linuxDoCredit.connectSilently();
    });
    expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
    expect(runtime().center.linuxDoCredit.busy).toBe(false);
    expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false);
    expect(appQueryClient.getQueryState(balance)?.isInvalidated).toBe(false);
    expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data').state).toBe('ready');
    expect(notify).not.toHaveBeenCalled();
    expect(mockWebViewLoads).toHaveLength(1);
    await act(async () => runtime().center.linuxDoCredit.open());
    expect(view.getByTestId('login-webview', { includeHiddenElements: true }).props.source.uri).toBe(
      'https://credit.linux.do/home'
    );
    expect(view.getByTestId('login-webview', { includeHiddenElements: true }).props.injectedJavaScript).toBeUndefined();
  });

  it.each(['leave', 'disable', 'background', 'switch', 'identity'] as const)(
    'cancels silent authorization on %s and ignores late completion',
    async (exit) => {
      const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
      const { view, runtime, rerender } = await renderCreditHosts(fetcher);
      let pending!: Promise<void>;
      await act(async () => {
        pending = runtime().center.linuxDoCredit.connectSilently();
      });
      const oldPage = view.getByTestId('login-webview', { includeHiddenElements: true });
      if (exit === 'leave') await rerender({ screen: 'feed' });
      if (exit === 'disable') await rerender({ enabled: false });
      if (exit === 'background') await rerender({ appActive: false });
      if (exit === 'switch')
        await act(async () => {
          await runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
        });
      if (exit === 'identity')
        await act(async () => {
          seedAccount('bob');
        });
      await act(async () => {
        oldPage.props.onMessage(authMessage('complete'));
        await pending;
      });
      expect(runtime().center.linuxDoCredit.busy).toBe(false);
      expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false);
      expect(
        view
          .queryAllByTestId('login-webview', { includeHiddenElements: true })
          .some((page) => page.props.source.uri.includes('credit.linux.do'))
      ).toBe(false);
      if (exit === 'disable') {
        expect(fetcher).not.toHaveBeenCalled();
        await rerender({ enabled: true });
        expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data')).toMatchObject({
          state: 'blocked',
          reason: 'identity-pending'
        });
        await act(async () => runtime().center.handleAccountCenterCommand({ type: 'refresh' }));
        expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data').state).toBe('ready');
      }
    }
  );

  it('does not let stale messages or native failures close a new owner silent document', async () => {
    let username = 'alice';
    const fetcher = jest.fn(async () =>
      Response.json({ current_user: { id: username === 'alice' ? 7 : 8, username } })
    );
    const { view, runtime } = await renderCreditHosts(fetcher);
    let previous!: Promise<void>;
    await act(async () => {
      previous = runtime().center.linuxDoCredit.connectSilently();
    });
    const oldPage = view.getByTestId('login-webview', { includeHiddenElements: true });
    username = 'bob';
    await act(async () => {
      seedAccount('bob');
    });
    await act(async () => {
      await previous;
    });
    jest.mocked(nativeSecureRandomHex).mockResolvedValueOnce('b'.repeat(32));
    let current!: Promise<void>;
    await act(async () => {
      current = runtime().center.linuxDoCredit.connectSilently();
    });
    const newPage = view.getByTestId('login-webview', { includeHiddenElements: true });
    await act(async () => {
      oldPage.props.onMessage(authMessage('complete'));
      oldPage.props.onError({ nativeEvent: { description: 'late failure' } });
      oldPage.props.onRenderProcessGone();
    });
    expect(view.getByTestId('login-webview', { includeHiddenElements: true })).toBe(newPage);
    expect(runtime().center.linuxDoCredit.busy).toBe(true);
    await fireEvent(newPage, 'message', authMessage('complete', 'b'.repeat(32)));
    await act(async () => {
      await current;
    });
    expect(runtime().center.linuxDoCredit.busy).toBe(false);
  });

  it('keeps a silent Credit 403 page mounted for passive verification and stops other HTTP failures', async () => {
    const { view, runtime } = await renderCreditHosts();
    let pending!: Promise<void>;
    await act(async () => {
      pending = runtime().center.linuxDoCredit.connectSilently();
    });
    const browser = view.getByTestId('login-webview', { includeHiddenElements: true });
    expect(browser.props.source.uri).toBe('https://credit.linux.do/home');
    await fireEvent(browser, 'httpError', { nativeEvent: { url: 'https://credit.linux.do/home', statusCode: 403 } });
    expect(view.getByTestId('login-webview', { includeHiddenElements: true })).toBe(browser);
    expect(runtime().center.linuxDoCredit.busy).toBe(true);
    await fireEvent(browser, 'httpError', { nativeEvent: { url: 'https://credit.linux.do/home', statusCode: 500 } });
    await act(async () => {
      await pending;
    });
    expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
    expect(runtime().center.linuxDoCredit.busy).toBe(false);
    expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data').state).toBe('ready');
  });

  it.each(['close', 'check'] as const)(
    'keeps the replacement forum WebView cookie barrier until its explicit %s',
    async (finish) => {
      jest.useFakeTimers();
      const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
      const { view, runtime } = await renderCreditHosts(fetcher);
      const handoff = Promise.withResolvers<void>();
      try {
        let silent!: Promise<void>;
        await act(async () => {
          silent = runtime().center.linuxDoCredit.connectSilently();
        });
        jest.mocked(setLinuxDoCookieResponseBarrier).mockClear();
        await act(async () => {
          await runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
        });
        expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.map(([blocked]) => blocked)).toEqual([true]);
        expect(fetcher).not.toHaveBeenCalled();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(100);
          await silent;
        });
        expect(view.getByTestId('login-webview').props.source.uri).toBe('https://linux.do/latest');
        expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.every(([blocked]) => blocked)).toBe(true);
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
        if (finish === 'close')
          jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => handoff.promise);
        await fireEvent.press(view.getByText('检测登录'));
        if (finish === 'close')
          await act(async () => {
            runtime().hosts.closePanels();
            handoff.resolve();
          });
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true)
        );
        expect(view.queryByTestId('login-webview')).toBeNull();
        expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.at(-1)?.[0]).toBe(false);
      } finally {
        handoff.resolve();
        await view.unmount();
        jest.useRealTimers();
      }
    }
  );

  it.each(['close', 'check'] as const)(
    'settles the deferred Credit identity check before a replacement reading verification %s completes',
    async (finish) => {
      jest.useFakeTimers();
      const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
      const { view, runtime } = await renderCreditHosts(fetcher);
      const handoff = Promise.withResolvers<void>();
      const resume = jest.fn(async () => {
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
        return 'completed' as const;
      });
      try {
        let silent!: Promise<void>;
        await act(async () => {
          silent = runtime().center.linuxDoCredit.connectSilently();
        });
        jest.mocked(setLinuxDoCookieResponseBarrier).mockClear();
        await act(async () => {
          await runtime().hosts.showLinuxDoVerification('读取需要验证', {
            queryKey: ['ldc-replacement'],
            isCurrent: () => true,
            resume
          });
        });
        expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.map(([blocked]) => blocked)).toEqual([true]);
        expect(fetcher).not.toHaveBeenCalled();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(100);
          await silent;
        });
        expect(view.getByTestId('login-webview').props.source.uri).toBe('https://cdk.linux.do/');
        if (finish === 'close')
          jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => handoff.promise);
        await fireEvent.press(view.getByText('检测并继续'));
        if (finish === 'close')
          await act(async () => {
            runtime().hosts.closePanels();
            handoff.resolve();
          });
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true)
        );
        if (finish === 'check') await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
        else expect(resume).not.toHaveBeenCalled();
        expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.at(-1)?.[0]).toBe(false);
      } finally {
        handoff.resolve();
        await view.unmount();
        jest.useRealTimers();
      }
    }
  );

  it('releases a replaced Credit ticket without probing when the unfinished forum verification is closed', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
    const { view, runtime } = await renderCreditHosts(fetcher);
    const resume = jest.fn(async () => 'completed' as const);
    try {
      let silent!: Promise<void>;
      await act(async () => {
        silent = runtime().center.linuxDoCredit.connectSilently();
      });
      await act(async () => {
        await runtime().hosts.showLinuxDoVerification('读取需要验证', {
          queryKey: ['ldc-unfinished-replacement'],
          isCurrent: () => true,
          resume
        });
        await jest.advanceTimersByTimeAsync(100);
        await silent;
      });
      await fireEvent.press(view.getByLabelText('关闭'));
      expect(view.queryByTestId('login-webview')).toBeNull();
      await act(async () => jest.advanceTimersByTimeAsync(450));
      expect(fetcher).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(runtime().read.accountSessionViewModels.linuxdo.identityTrust).toBe('unknown');
      expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data')).toMatchObject({
        state: 'blocked',
        reason: 'identity-unavailable'
      });
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  });

  it('bounds a silent page with an independent 30-second deadline and does not retry it automatically', async () => {
    jest.useFakeTimers();
    const { view, runtime } = await renderCreditHosts();
    try {
      let pending!: Promise<void>;
      await act(async () => {
        pending = runtime().center.linuxDoCredit.connectSilently();
      });
      await act(async () => jest.advanceTimersByTimeAsync(29_999));
      expect(view.getByTestId('login-webview', { includeHiddenElements: true })).toBeTruthy();
      await act(async () => jest.advanceTimersByTimeAsync(2));
      await act(async () => {
        await pending;
        await runtime().center.linuxDoCredit.connectSilently();
      });
      expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
      expect(runtime().center.linuxDoCredit.busy).toBe(false);
      expect(mockWebViewLoads).toHaveLength(1);
      expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data').state).toBe('ready');
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  });

  it.each(['failed', 'replaced'] as const)(
    'does not resume reading when its deferred Credit reconciliation is %s',
    async (outcome) => {
      jest.useFakeTimers();
      const fetcher = jest.fn(async () => {
        if (outcome === 'failed') throw new Error('offline');
        return Response.json({ current_user: { id: 7, username: 'alice' } });
      });
      const { view, runtime } = await renderCreditHosts(fetcher);
      const resume = jest.fn(async () => 'completed' as const);
      const handoff = Promise.withResolvers<void>();
      try {
        await act(async () => {
          void runtime().center.linuxDoCredit.connectSilently();
        });
        await act(async () => {
          await runtime().hosts.showLinuxDoVerification('读取需要验证', {
            queryKey: ['ldc-replacement-failure'],
            isCurrent: () => true,
            resume
          });
          await jest.advanceTimersByTimeAsync(100);
        });
        jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => handoff.promise);
        await fireEvent.press(view.getByText('检测并继续'));
        expect(fetcher).not.toHaveBeenCalled();
        if (outcome === 'replaced') {
          await act(async () => {
            await runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
            await jest.advanceTimersByTimeAsync(100);
          });
          jest.mocked(setLinuxDoCookieResponseBarrier).mockClear();
        }
        await act(async () => {
          handoff.resolve();
        });
        expect(resume).not.toHaveBeenCalled();
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
        if (outcome === 'replaced') {
          expect(fetcher).not.toHaveBeenCalled();
          expect(jest.mocked(setLinuxDoCookieResponseBarrier)).not.toHaveBeenCalled();
          await fireEvent.press(view.getByLabelText('关闭'));
          expect(fetcher).not.toHaveBeenCalled();
          await act(async () => {
            await runtime().center.handleAccountCenterCommand({ type: 'refresh' });
          });
          await waitFor(() =>
            expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true)
          );
        } else {
          await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
          expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('alice');
        }
      } finally {
        handoff.resolve();
        await view.unmount();
        jest.useRealTimers();
      }
    }
  );

  it('opens the official page without probing or authorizing and refreshes only LDC after close reconciliation', async () => {
    let currentView: Awaited<ReturnType<typeof renderCreditHosts>>['view'];
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
      expect(currentView.queryByTestId('login-webview')).toBeNull();
      expect(url).toBe('https://linux.do/session/current.json');
      return Response.json({ current_user: { id: 7, username: 'alice' } });
    });
    const { view, runtime } = await renderCreditHosts(fetcher);
    currentView = view;
    const snapshot = appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'));
    const balance = ['forum', 'linuxdo', 'account-data', 'ldc-account', { userId: 'alice' }];
    const transactions = ['forum', 'linuxdo', 'account-data', 'ldc-transactions', { userId: 'alice' }];
    const unrelated = ['forum', 'linuxdo', 'account-data', 'overview', { userId: 'alice' }];
    for (const key of [balance, transactions, unrelated]) appQueryClient.setQueryData(key, { fixture: true });

    await act(async () => runtime().center.linuxDoCredit.open());
    expect(runtime().hosts.surfaces.linuxdoCredit).toBe(true);
    expect(runtime().hosts.surfaces.linuxdo).toBe(true);
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
    expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'))).toEqual(snapshot);
    expect(fetcher).not.toHaveBeenCalled();
    const browser = view.getByTestId('login-webview');
    expect(browser.props.source).toEqual({ uri: 'https://credit.linux.do/home' });
    expect(browser.props.userAgent).toBeTruthy();
    expect(browser.props.injectedJavaScript).toBeUndefined();
    expect(browser.props.onMessage).toBeUndefined();
    for (const host of ['credit.linux.do', 'connect.linux.do', 'linux.do', 'challenges.cloudflare.com']) {
      expect(browser.props.onShouldStartLoadWithRequest({ url: `https://${host}/test` })).toBe(true);
    }
    for (const url of [
      'https://credit.linux.do.evil.test/',
      'http://credit.linux.do/',
      'https://user@credit.linux.do/',
      'https://credit.linux.do:8443/',
      'javascript:alert(1)',
      'https://evil.linux.do/'
    ]) {
      expect(browser.props.onShouldStartLoadWithRequest({ url })).toBe(false);
    }
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: 'https://credit.linux.do/home' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mockWebViewInjectJavaScript).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('完成并刷新'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true));
    expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false);
    expect(appQueryClient.getQueryState(balance)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(transactions)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it('waits for a pending cookie preparation after cancel and never mounts its late document', async () => {
    const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
    const { view, runtime } = await renderCreditHosts(fetcher);
    const preparation = Promise.withResolvers<void>();
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => preparation.promise);
    let opening!: Promise<void>;
    await act(async () => {
      opening = runtime().center.linuxDoCredit.open();
    });
    expect(view.queryByTestId('login-webview')).toBeNull();
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      preparation.resolve();
      await opening;
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(mockWebViewLoads).not.toContain('https://credit.linux.do/home');
  });

  it.each(['close', 'back', 'leave', 'disable', 'switch', 'identity'] as const)(
    'removes the LDC website on %s and does not accept stale page events',
    async (exit) => {
      const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
      const { view, runtime, rerender } = await renderCreditHosts(fetcher);
      await act(async () => runtime().center.linuxDoCredit.open());
      const oldPage = view.getByTestId('login-webview');
      if (exit === 'close') await fireEvent.press(view.getByLabelText('关闭'));
      if (exit === 'back')
        await act(async () => {
          runtime().hosts.closeTopmostSurface();
        });
      if (exit === 'leave') await rerender({ screen: 'feed' });
      if (exit === 'disable') await rerender({ enabled: false });
      if (exit === 'switch')
        await act(async () => {
          await runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
        });
      if (exit === 'identity')
        await act(async () => {
          seedAccount('bob');
        });
      await waitFor(() => expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false));
      expect(
        view.queryAllByTestId('login-webview').some((page) => page.props.source.uri === 'https://credit.linux.do/home')
      ).toBe(false);
      await act(async () => {
        oldPage.props.onLoadStart({ nativeEvent: { url: 'https://credit.linux.do/home', loading: true } });
        oldPage.props.onLoadEnd({ nativeEvent: { url: 'https://credit.linux.do/home' } });
      });
      expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false);
      if (exit === 'disable') expect(fetcher).not.toHaveBeenCalled();
      else if (exit !== 'switch') await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    }
  );

  it('preserves the forum identity and cached LDC data when close reconciliation fails', async () => {
    const fetcher = jest.fn(async () => {
      throw new Error('offline');
    });
    const { view, runtime } = await renderCreditHosts(fetcher);
    const balance = ['forum', 'linuxdo', 'account-data', 'ldc-account', { userId: 'alice' }];
    appQueryClient.setQueryData(balance, { availableBalance: '12.34' });
    await act(async () => runtime().center.linuxDoCredit.open());
    await fireEvent.press(view.getByLabelText('完成并刷新'));
    await waitFor(() => expect(runtime().read.statusBusy).toBe(false));
    expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('alice');
    expect(appQueryClient.getQueryState(balance)?.isInvalidated).toBe(false);
    expect(appQueryClient.getQueryData(balance)).toEqual({ availableBalance: '12.34' });
    expect(view.queryByTestId('login-webview')).toBeNull();
  });

  it('respects the proxy barrier and keeps website failures local to the LDC page', async () => {
    const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
    const { view, runtime, rerender } = await renderCreditHosts(fetcher);
    await rerender({ blockedMessage: '代理尚未就绪' });
    await act(async () => runtime().center.linuxDoCredit.open());
    expect(view.getByText('代理尚未就绪')).toBeTruthy();
    expect(view.queryByTestId('login-webview')).toBeNull();
    await rerender({});
    const browser = view.getByTestId('login-webview');
    await fireEvent(browser, 'error', { nativeEvent: { description: '网络不可用' } });
    expect(view.getByText('LDC 页面加载失败：网络不可用')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('alice');
  });

  it('ignores old website events when closing and reopening in the same React batch', async () => {
    const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
    const { view, runtime } = await renderCreditHosts(fetcher);
    await act(async () => runtime().center.linuxDoCredit.open());
    const oldPage = view.getByTestId('login-webview');
    await act(async () => {
      runtime().hosts.closePanels();
      await runtime().center.linuxDoCredit.open();
    });
    const newPage = view.getByTestId('login-webview');
    expect(newPage).not.toBe(oldPage);
    await act(async () => {
      oldPage.props.onError({ nativeEvent: { description: '上一页迟到的错误' } });
      oldPage.props.onLoadEnd({ nativeEvent: { url: 'https://credit.linux.do/home' } });
    });
    expect(view.queryByText('LDC 页面加载失败：上一页迟到的错误')).toBeNull();
    expect(view.getByTestId('login-webview')).toBe(newPage);
    expect(view.getByText('正在打开 LDC…')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('完成并刷新'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it('stops a timed-out website and remounts only after an explicit refresh', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
    const { view, runtime } = await renderCreditHosts(fetcher);
    try {
      await act(async () => runtime().center.linuxDoCredit.open());
      expect(view.getByTestId('login-webview')).toBeTruthy();
      await act(async () => jest.advanceTimersByTimeAsync(12_001));
      expect(view.getByText('LDC 页面打开超时：请检查网络后重新打开。')).toBeTruthy();
      expect(view.queryByTestId('login-webview')).toBeNull();
      expect(runtime().hosts.surfaces.linuxdoCredit).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      await fireEvent.press(view.getByLabelText('刷新页面'));
      expect(view.getByTestId('login-webview').props.source.uri).toBe('https://credit.linux.do/home');
      expect(mockWebViewLoads.filter((url) => url === 'https://credit.linux.do/home')).toHaveLength(2);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  });
});

describe('local login identity restoration', () => {
  let storageRead: jest.SpyInstance;
  beforeEach(async () => {
    storageRead = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
    jest.mocked(readManagedCookieHeader).mockClear();
    await AsyncStorage.setItem('account-session.migration.v1', '1');
  });
  afterEach(async () => {
    storageRead.mockRestore();
    await AsyncStorage.removeItem('account-session.migration.v1');
  });

  async function startIdentityRuntime(ready = true, enabledSources: readonly Source[] = ['nodeseek', 'linuxdo']) {
    const notify = jest.fn();
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () => new Response('{}'));
    const hook = await renderHook(
      ({ settingsReady, sources = enabledSources }: { settingsReady: boolean; sources?: readonly Source[] }) =>
        useAccountRuntime({
          appActive: true,
          enabledSources: sources,
          fetcher,
          loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
          notify,
          nodeSeekRecoveryThreshold: 1,
          openUser: async () => undefined,
          ready: settingsReady,
          screen: 'search',
          webViewBlockMessage: ''
        }),
      { initialProps: { settingsReady: ready }, wrapper: QueryTestWrapper }
    );
    return { ...hook, notify, fetcher };
  }

  async function retryIdentityRecovery(runtime: ReturnType<typeof useAccountRuntime>) {
    const recovery = await render(runtime.hosts.startupRecovery!, { wrapper: QueryTestWrapper });
    expect(recovery.getByText('本地登录身份读取失败，请重试')).toBeTruthy();
    await fireEvent.press(recovery.getByText('重试启动'));
    await recovery.unmount();
  }

  async function startIdentityHosts(settingsReady = true) {
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const fetcher = async () => new Response('{}');
    const notify = jest.fn();
    function Harness({ trusted = settingsReady }: { trusted?: boolean }) {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['linuxdo'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: trusted,
        screen: 'search',
        webViewBlockMessage: ''
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    return { view, runtime: () => runtime, trust: () => view.rerender(<Harness trusted />) };
  }

  it('starts both local identity reads before trusted settings and skips legacy Native reads', async () => {
    const node = Promise.withResolvers<string | null>();
    const linux = Promise.withResolvers<string | null>();
    storageRead.mockImplementation((key: string) =>
      key === 'nodeseek-user-agent'
        ? node.promise
        : key === 'linuxdo-user-agent'
          ? linux.promise
          : Promise.resolve(null)
    );
    const { result, unmount } = await startIdentityRuntime(false);
    expect(storageRead).toHaveBeenCalledWith('nodeseek-user-agent');
    expect(storageRead).toHaveBeenCalledWith('linuxdo-user-agent');
    expect(readManagedCookieHeader).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(result.current.read.sessionsReady).toBe(false);
    await unmount();
    await act(async () => {
      node.resolve(null);
      linux.resolve(null);
    });
  });

  it('waits for both saved identity reads before publishing ready sessions', async () => {
    const linux = Promise.withResolvers<string | null>();
    storageRead.mockImplementation((key: string) =>
      key === 'linuxdo-user-agent'
        ? linux.promise
        : Promise.resolve(key === 'nodeseek-user-agent' ? 'Saved Node UA' : null)
    );
    const { result } = await startIdentityRuntime();
    await act(async () => undefined);
    expect(result.current.read.sessionsReady).toBe(false);
    await act(async () => linux.resolve('Saved Linux UA'));
    await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
    expect(result.current.read.getNodeSeekUserAgent()).toBe('Saved Node UA');
    expect(result.current.read.getLinuxDoUserAgent()).toBe('Saved Linux UA');
  });

  it.each([null, 'Saved browser UA'])(
    'restores saved identity %p without preparing a default WebView identity',
    async (savedUserAgent) => {
      storageRead.mockImplementation((key: string) =>
        Promise.resolve(key.endsWith('-user-agent') ? savedUserAgent : null)
      );
      const provider = jest.mocked(NativeModules.NetworkProxyModule.getDefaultWebViewUserAgent);
      provider.mockClear();
      const { result } = await startIdentityRuntime();
      await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
      expect(result.current.read.getLinuxDoUserAgent()).toBe(savedUserAgent ?? '');
      expect(provider).not.toHaveBeenCalled();
      expect(readManagedCookieHeader).not.toHaveBeenCalled();
    }
  );

  it('ignores the cancelled restoration from a StrictMode effect restart', async () => {
    const old = Promise.withResolvers<string | null>();
    let localReads = 0;
    storageRead.mockImplementation((key: string) => {
      if (!key.endsWith('-user-agent')) return Promise.resolve(null);
      localReads += 1;
      return localReads <= 2 ? old.promise : Promise.resolve('Current saved UA');
    });
    const fetcher = async () => new Response('{}');
    const notify = jest.fn();
    let runtime!: ReturnType<typeof useAccountRuntime>;
    function Harness() {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['linuxdo'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: true,
        screen: 'search',
        webViewBlockMessage: ''
      });
      return null;
    }
    const renderer = createRoot({ isStrictMode: true });
    try {
      await act(() =>
        renderer.render(
          <QueryTestWrapper>
            <Harness />
          </QueryTestWrapper>
        )
      );
      await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
      await act(async () => old.resolve('Cancelled saved UA'));
      expect(localReads).toBe(4);
      expect(runtime.read.getLinuxDoUserAgent()).toBe('Current saved UA');
      expect(runtime.read.getNodeSeekUserAgent()).toBe('Current saved UA');
    } finally {
      await act(() => renderer.unmount());
    }
  });

  it('blocks failed local identity restoration and retries without a remote refresh', async () => {
    let failing = true;
    storageRead.mockImplementation((key: string) =>
      failing && key === 'linuxdo-user-agent'
        ? Promise.reject(new Error('private storage failure'))
        : Promise.resolve(null)
    );
    const { result, notify, fetcher } = await startIdentityRuntime();
    await waitFor(() => expect(result.current.hosts.startupRecovery).not.toBeNull());
    expect(result.current.read.sessionsReady).toBe(false);
    expect(result.current.read.getLinuxDoUserAgent()).toBe('');
    expect(notify).toHaveBeenCalledWith('本地登录身份读取失败，请重试');
    failing = false;
    await retryIdentityRecovery(result.current);
    await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
    expect(result.current.hosts.startupRecovery).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(readManagedCookieHeader).not.toHaveBeenCalled();
  });

  it('keeps remote account refresh behind failed local restoration', async () => {
    storageRead.mockRejectedValue(new Error('storage unavailable'));
    const { result, fetcher } = await startIdentityRuntime();
    await waitFor(() => expect(result.current.hosts.startupRecovery).not.toBeNull());
    storageRead.mockClear();
    await act(async () => result.current.center.handleAccountCenterCommand({ type: 'refresh' }));
    await waitFor(() => expect(storageRead).toHaveBeenCalledWith('linuxdo-user-agent'));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.read.sessionsReady).toBe(false);
  });

  it('discards unmounted reads and restores only the new mount', async () => {
    const old = Promise.withResolvers<string | null>();
    storageRead.mockImplementation((key: string) =>
      key.endsWith('-user-agent') ? old.promise : Promise.resolve(null)
    );
    const first = await startIdentityRuntime(false);
    await first.unmount();
    storageRead.mockResolvedValue('New saved UA');
    const next = await startIdentityRuntime(false);
    await act(async () => old.resolve('Old saved UA'));
    expect(next.result.current.read.getLinuxDoUserAgent()).toBe('New saved UA');
    expect(next.result.current.read.getNodeSeekUserAgent()).toBe('New saved UA');
    expect(first.notify).not.toHaveBeenCalled();
    expect(readManagedCookieHeader).not.toHaveBeenCalled();
  });

  it('preserves a Native submitted identity when local storage resolves late', async () => {
    const old = Promise.withResolvers<string | null>();
    storageRead.mockImplementation((key: string) =>
      key === 'linuxdo-user-agent' ? old.promise : Promise.resolve(null)
    );
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    try {
      const { view, runtime } = await renderManualLogin(async () => new Response('{}'), false);
      await fireEvent(view.getByTestId('login-webview'), 'message', {
        nativeEvent: {
          url: 'https://linux.do/login',
          data: JSON.stringify({ type: 'linuxdo-webview', userAgent: 'New Native UA' })
        }
      });
      expect(runtime().read.getLinuxDoUserAgent()).toBe('New Native UA');
      await act(async () => old.resolve('Old saved UA'));
      expect(runtime().read.getLinuxDoUserAgent()).toBe('New Native UA');
      expect(write).toHaveBeenCalledWith('linuxdo-user-agent', 'New Native UA');
    } finally {
      write.mockRestore();
    }
  });

  it('preserves saved identity while migrating only enabled legacy snapshots after trusted settings', async () => {
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'linuxdo-user-agent'
          ? 'Saved Linux UA'
          : key === 'linuxdo-clearance'
            ? JSON.stringify({ userAgent: 'Legacy Linux UA' })
            : null
      )
    );
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    try {
      const { result, rerender } = await startIdentityRuntime(false, ['linuxdo']);
      expect(readManagedCookieHeader).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      await rerender({ settingsReady: true });
      await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
      expect(result.current.read.getLinuxDoUserAgent()).toBe('Saved Linux UA');
      expect(write).not.toHaveBeenCalled();
      expect(readManagedCookieHeader).toHaveBeenCalledTimes(1);
      expect(readManagedCookieHeader).toHaveBeenCalledWith('https://linux.do/session/current.json');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
      expect(storageRead).not.toHaveBeenCalledWith('nodeseek-access');
    } finally {
      write.mockRestore();
    }
  });

  it('retains an unconfirmed legacy identity and retries exact Native confirmation', async () => {
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'linuxdo-clearance' ? JSON.stringify({ userAgent: 'Legacy Linux UA' }) : null)
    );
    const native = jest.mocked(readManagedCookieHeader);
    const previous = native.getMockImplementation()!;
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    native.mockResolvedValue({ status: 'unsupported' });
    try {
      const { result } = await startIdentityRuntime(true, ['linuxdo']);
      await waitFor(() => expect(result.current.hosts.startupRecovery).not.toBeNull());
      expect(result.current.read.sessionsReady).toBe(false);
      expect(result.current.read.getLinuxDoUserAgent()).toBe('');
      expect(write).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      native.mockResolvedValue({ status: 'ok', header: '' });
      await retryIdentityRecovery(result.current);
      await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
      expect(result.current.read.getLinuxDoUserAgent()).toBe('Legacy Linux UA');
      expect(write).toHaveBeenCalledWith('linuxdo-user-agent', 'Legacy Linux UA');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
    } finally {
      write.mockRestore();
      native.mockImplementation(previous);
    }
  });

  it('does not delete legacy keys after a failed identity write and allows an explicit retry', async () => {
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'linuxdo-clearance' ? JSON.stringify({ userAgent: 'Legacy Linux UA' }) : null)
    );
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValue(new Error('private storage failure'));
    try {
      const { result } = await startIdentityRuntime(true, ['linuxdo']);
      await waitFor(() => expect(result.current.hosts.startupRecovery).not.toBeNull());
      expect(result.current.read.sessionsReady).toBe(false);
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      write.mockResolvedValue(undefined);
      await retryIdentityRecovery(result.current);
      await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
      expect(result.current.read.getLinuxDoUserAgent()).toBe('Legacy Linux UA');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
    } finally {
      write.mockRestore();
    }
  });

  it('persists the latest Native identity after a pending legacy write before deleting old keys', async () => {
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'linuxdo-clearance' ? JSON.stringify({ userAgent: 'Legacy Linux UA' }) : null)
    );
    const legacyWrite = Promise.withResolvers<void>();
    const nativeWrite = Promise.withResolvers<void>();
    const write = jest
      .spyOn(SecureStore, 'setItemAsync')
      .mockImplementation((_key, value) => (value === 'Legacy Linux UA' ? legacyWrite.promise : nativeWrite.promise));
    try {
      const { view, runtime } = await startIdentityHosts();
      await waitFor(() => expect(write).toHaveBeenCalledWith('linuxdo-user-agent', 'Legacy Linux UA'));
      await act(async () => runtime().hosts.showLinuxDoVerification('登录'));
      await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
      await fireEvent(view.getByTestId('login-webview'), 'message', {
        nativeEvent: {
          url: 'https://linux.do/login',
          data: JSON.stringify({ type: 'linuxdo-webview', userAgent: 'New Native UA' })
        }
      });
      expect(runtime().read.getLinuxDoUserAgent()).toBe('New Native UA');
      await act(async () => legacyWrite.resolve());
      await waitFor(() => expect(write).toHaveBeenCalledWith('linuxdo-user-agent', 'New Native UA'));
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      await act(async () => nativeWrite.resolve());
      await waitFor(() => expect(runtime().read.sessionsReady).toBe(true));
      expect(runtime().read.getLinuxDoUserAgent()).toBe('New Native UA');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
    } finally {
      write.mockRestore();
    }
  });

  it('retries persistence of the latest Native identity before completing a failed legacy restoration', async () => {
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'linuxdo-clearance' ? JSON.stringify({ userAgent: 'Legacy Linux UA' }) : null)
    );
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValue(new Error('storage unavailable'));
    try {
      const { view, runtime, trust } = await startIdentityHosts(false);
      await act(async () => runtime().hosts.showLinuxDoVerification('登录'));
      await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
      await fireEvent(view.getByTestId('login-webview'), 'message', {
        nativeEvent: {
          url: 'https://linux.do/login',
          data: JSON.stringify({ type: 'linuxdo-webview', userAgent: 'New Native UA' })
        }
      });
      await waitFor(() => expect(write).toHaveBeenCalledWith('linuxdo-user-agent', 'New Native UA'));
      await trust();
      await waitFor(() => expect(runtime().hosts.startupRecovery).not.toBeNull());
      expect(runtime().read.sessionsReady).toBe(false);
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      write.mockClear().mockResolvedValue(undefined);
      await retryIdentityRecovery(runtime());
      await waitFor(() => expect(runtime().read.sessionsReady).toBe(true));
      expect(runtime().read.getLinuxDoUserAgent()).toBe('New Native UA');
      expect(write.mock.calls).toEqual([['linuxdo-user-agent', 'New Native UA']]);
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('linuxdo-clearance');
    } finally {
      write.mockRestore();
    }
  });

  it('keeps warm navigation and restored sources ready while a newly enabled identity restores', async () => {
    seedAccount();
    seedNodeSeekAccount();
    const legacyRead = Promise.withResolvers<string | null>();
    storageRead.mockImplementation((key: string) =>
      key === 'nodeseek-access' ? legacyRead.promise : Promise.resolve(null)
    );
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () => new Response('{}'));
    const notify = jest.fn();
    const hook = await renderHook(
      ({ sources }: { sources: readonly Source[] }) =>
        useAccountRuntime({
          appActive: true,
          enabledSources: sources,
          fetcher,
          loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
          notify,
          nodeSeekRecoveryThreshold: 1,
          openUser: async () => undefined,
          ready: true,
          screen: 'search',
          webViewBlockMessage: ''
        }),
      { initialProps: { sources: ['linuxdo'] }, wrapper: QueryTestWrapper }
    );
    try {
      await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
      const linuxPlan = hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level');
      expect(linuxPlan).toMatchObject({ state: 'ready', lane: 'authenticated' });
      await hook.rerender({ sources: ['linuxdo', 'nodeseek'] });
      expect(hook.result.current.read.sessionsReady).toBe(true);
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level')).toEqual(linuxPlan);
      expect(hook.result.current.read.readGateway.getReadPlan('nodeseek', 'account-data')).toMatchObject({
        state: 'blocked',
        reason: 'identity-unavailable'
      });
      await expect(hook.result.current.read.reconcileAccountStatus('nodeseek')).resolves.toMatchObject({
        status: 'unknown'
      });
      await expect(hook.result.current.write.ensureWritableSession('nodeseek')).rejects.toMatchObject({
        reason: 'identity_unavailable'
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      await act(async () => legacyRead.resolve(JSON.stringify({ userAgent: 'Legacy Node UA' })));
      await waitFor(() =>
        expect(hook.result.current.read.readGateway.getReadPlan('nodeseek', 'account-data')).toMatchObject({
          state: 'ready',
          lane: 'authenticated'
        })
      );
      expect(hook.result.current.read.sessionsReady).toBe(true);
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level')).toEqual(linuxPlan);
      await expect(hook.result.current.write.ensureWritableSession('nodeseek')).resolves.toMatchObject({
        source: 'nodeseek',
        identityKey: 'nodeseek:42'
      });
      expect(hook.result.current.read.getNodeSeekUserAgent()).toBe('Legacy Node UA');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      legacyRead.resolve(null);
      write.mockRestore();
      await hook.unmount();
    }
  });

  it('retries only a failed warm source without dropping already restored source access', async () => {
    seedAccount();
    seedNodeSeekAccount();
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'nodeseek-access' ? JSON.stringify({ userAgent: 'Legacy Node UA' }) : null)
    );
    const native = jest.mocked(readManagedCookieHeader);
    const previous = native.getMockImplementation()!;
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    native.mockResolvedValue({ status: 'unsupported' });
    try {
      const hook = await startIdentityRuntime(true, ['linuxdo']);
      await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
      const linuxPlan = hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level');
      await hook.rerender({ settingsReady: true, sources: ['linuxdo', 'nodeseek'] });
      await waitFor(() => expect(hook.result.current.hosts.startupRecovery).not.toBeNull());
      expect(hook.result.current.read.sessionsReady).toBe(true);
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level')).toEqual(linuxPlan);
      expect(hook.result.current.read.readGateway.getReadPlan('nodeseek', 'account-data')).toMatchObject({
        state: 'blocked',
        reason: 'identity-unavailable'
      });
      await expect(hook.result.current.write.ensureWritableSession('linuxdo')).resolves.toMatchObject({
        source: 'linuxdo'
      });
      storageRead.mockClear();
      native.mockResolvedValue({ status: 'ok', header: '' });
      await act(async () => hook.result.current.center.handleAccountCenterCommand({ type: 'refresh' }));
      expect(hook.result.current.read.sessionsReady).toBe(true);
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level')).toEqual(linuxPlan);
      await waitFor(() =>
        expect(hook.result.current.read.readGateway.getReadPlan('nodeseek', 'account-data')).toMatchObject({
          state: 'ready',
          lane: 'authenticated'
        })
      );
      expect(storageRead).not.toHaveBeenCalledWith('linuxdo-user-agent');
      expect(storageRead).not.toHaveBeenCalledWith('nodeseek-user-agent');
      expect(storageRead).not.toHaveBeenCalledWith('linuxdo-clearance');
      expect(hook.fetcher).not.toHaveBeenCalled();
      await hook.unmount();
    } finally {
      write.mockRestore();
      native.mockImplementation(previous);
    }
  });

  it('cancels a disabled warm source before writing its identity or deleting legacy keys', async () => {
    seedAccount();
    seedNodeSeekAccount();
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'nodeseek-access' ? JSON.stringify({ userAgent: 'Legacy Node UA' }) : null)
    );
    const cookieRead = Promise.withResolvers<Awaited<ReturnType<typeof readManagedCookieHeader>>>();
    const native = jest.mocked(readManagedCookieHeader);
    const previous = native.getMockImplementation()!;
    const write = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    native.mockImplementation(() => cookieRead.promise);
    try {
      const hook = await startIdentityRuntime(true, ['linuxdo']);
      await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
      const linuxPlan = hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level');
      await hook.rerender({ settingsReady: true, sources: ['linuxdo', 'nodeseek'] });
      await waitFor(() => expect(native).toHaveBeenCalledTimes(1));
      await hook.rerender({ settingsReady: true, sources: ['linuxdo'] });
      await act(async () => cookieRead.resolve({ status: 'ok', header: '' }));
      expect(hook.result.current.read.sessionsReady).toBe(true);
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'level')).toEqual(linuxPlan);
      expect(hook.result.current.read.readGateway.getReadPlan('nodeseek', 'account-data')).toMatchObject({
        state: 'blocked',
        reason: 'source-disabled'
      });
      expect(hook.result.current.read.getNodeSeekUserAgent()).toBe('');
      expect(write).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      expect(hook.fetcher).not.toHaveBeenCalled();
      await hook.unmount();
    } finally {
      cookieRead.resolve({ status: 'unsupported' });
      write.mockRestore();
      native.mockImplementation(previous);
    }
  });
  it('cancels a disabled source at committed layout before passive migration cleanup', async () => {
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'nodeseek-access' ? JSON.stringify({ userAgent: 'Legacy Node UA' }) : null)
    );
    const cookieRead = Promise.withResolvers<Awaited<ReturnType<typeof readManagedCookieHeader>>>();
    const native = jest.mocked(readManagedCookieHeader);
    const previous = native.getMockImplementation()!;
    native.mockImplementation(() => cookieRead.promise);
    const originalMigration = legacyCookieMigration.migrateLegacyCookieSnapshots;
    let legacyRequest: Parameters<typeof originalMigration>[0] | undefined;
    const migrate = jest.spyOn(legacyCookieMigration, 'migrateLegacyCookieSnapshots').mockImplementation((options) => {
      legacyRequest = options;
      return originalMigration(options);
    });
    let currentInDisabledLayout: boolean | undefined;
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    const fetcher = async () => new Response('{}');
    function Harness({ sources }: { sources: readonly Source[] }) {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: sources,
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: true,
        screen: 'search',
        webViewBlockMessage: ''
      });
      useLayoutEffect(() => {
        if (!sources.includes('nodeseek') && legacyRequest?.enabledSources.includes('nodeseek')) {
          currentInDisabledLayout = legacyRequest.isCurrent();
        }
      }, [sources]);
      return null;
    }
    try {
      const view = await render(<Harness sources={['linuxdo']} />, { wrapper: QueryTestWrapper });
      await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
      await view.rerender(<Harness sources={['linuxdo', 'nodeseek']} />);
      await waitFor(() => expect(native).toHaveBeenCalledTimes(1));
      await view.rerender(<Harness sources={['linuxdo']} />);
      expect(legacyRequest!.isCurrent()).toBe(false);
      expect(currentInDisabledLayout).toBe(false);
      await view.unmount();
    } finally {
      cookieRead.resolve({ status: 'unsupported' });
      native.mockImplementation(previous);
      migrate.mockRestore();
    }
  });
});

async function renderManualLogin(fetcher: Fetcher, awaitIdentity = true) {
  let runtime!: ReturnType<typeof useAccountRuntime>;
  const notify = jest.fn();
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? ['linuxdo'] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen: 'search',
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  seedAccount();
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  if (awaitIdentity) await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
  await act(async () => {
    await runtime.hosts.showLinuxDoVerification('登录');
  });
  await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
  return {
    view,
    runtime: () => runtime,
    change: (props: { active?: boolean; enabled?: boolean }) => view.rerender(<Harness {...props} />)
  };
}

function recordCookieBarriers() {
  const barrier = jest.mocked(setLinuxDoCookieResponseBarrier);
  const previous = barrier.getMockImplementation()!;
  const realBarrier = jest.requireActual<typeof import('@/platform/network/managedCookies')>(
    '@/platform/network/managedCookies'
  ).setLinuxDoCookieResponseBarrier;
  barrier.mockImplementation((blocked, reason, generation, _module, parentTraceId) =>
    realBarrier(blocked, reason, generation, { setLinuxDoCookieResponseBarrier: async () => undefined }, parentTraceId)
  );
  return () => barrier.mockImplementation(previous);
}

async function renderSiteRuntime(
  source: 'nodeseek' | 'linuxdo' | 'yaohuo',
  fetcher: Fetcher,
  screen: 'topic' | 'more' = 'topic'
) {
  let runtime!: ReturnType<typeof useAccountRuntime>;
  const notify = jest.fn();
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? [source] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen,
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
  return {
    view,
    runtime: () => runtime,
    active: (active: boolean) => view.rerender(<Harness active={active} />),
    enabled: (enabled: boolean) => view.rerender(<Harness enabled={enabled} />)
  };
}

function seedNodeSeekAccount() {
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot('nodeseek'),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot('nodeseek'), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { source: 'nodeseek', id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' }
    })
  );
}

function accountClearFixture(site: 'nodeseek' | 'linuxdo' | 'yaohuo') {
  const id = site === 'nodeseek' ? '42' : site === 'linuxdo' ? 'alice' : '7';
  const username = site === 'yaohuo' ? '火友' : 'alice';
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot(site),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot(site), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { source: site, id, username, url: `https://example.test/${id}` }
    })
  );
  const response = () =>
    new Response(
      site === 'linuxdo'
        ? JSON.stringify({ current_user: { id, username } })
        : site === 'nodeseek'
          ? `<html><a class="Username" href="/space/${id}">${username}</a></html>`
          : `<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=${id}">${username}</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>`
    );
  return { id, response };
}

it.each(['nodeseek', 'linuxdo', 'yaohuo', 'nodeimage', 'linuxdo-credit'] as const)(
  'recovers an interrupted %s handoff after a process restart before allowing private access',
  async (entry) => {
    const site = entry === 'nodeimage' ? 'nodeseek' : entry === 'linuxdo-credit' ? 'linuxdo' : entry;
    const { id, response } = accountClearFixture(site);
    await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot(site))!);
    const first = await renderSiteRuntime(site, async () => response(), entry === 'linuxdo-credit' ? 'more' : 'topic');
    await act(async () => {
      if (entry === 'nodeimage') first.runtime().center.nodeImage.key.authorize();
      else if (entry === 'linuxdo-credit') first.runtime().center.linuxDoCredit.open();
      else await first.runtime().center.handleAccountCenterCommand({ type: 'open-login', site });
    });
    await waitFor(() => expect(first.view.getByTestId('login-webview')).toBeTruthy());
    expect(JSON.parse((await AsyncStorage.getItem(`account-session.v1.${site}`))!)).toMatchObject({
      handoffPending: true,
      identity: { id }
    });
    await first.view.unmount();
    appQueryClient.clear();

    let finish!: (response: Response) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const second = await renderSiteRuntime(site, fetcher);
    try {
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      expect(second.runtime().read.accountSessionViewModels[site].currentUser?.id).toBe(id);
      expect(second.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`)).toBe(false);
      expect(second.runtime().read.readGateway.getReadPlan(site, 'account-data').state).toBe('blocked');
      await act(async () => finish(response()));
      await waitFor(() =>
        expect(second.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`)).toBe(true)
      );
      expect(second.runtime().read.forumSessionEpochs[site]).toBe(0);
      expect(JSON.parse((await AsyncStorage.getItem(`account-session.v1.${site}`))!).handoffPending).toBeUndefined();
      await second.enabled(false);
      await second.enabled(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(second.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`)).toBe(true);
      await second.view.unmount();
      appQueryClient.clear();
      const third = await renderSiteRuntime(site, fetcher);
      expect(third.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`)).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await third.view.unmount();
    } finally {
      await second.view.unmount();
    }
  }
);

it.each(['nodeseek', 'linuxdo', 'yaohuo', 'nodeimage'] as const)(
  'keeps an interrupted %s authorization pending after source re-enable until its account is reconciled',
  async (entry) => {
    const site = entry === 'nodeimage' ? 'nodeseek' : entry;
    const { id, response } = accountClearFixture(site);
    const fetcher = jest.fn(async () => response());
    const { view, runtime, enabled } = await renderSiteRuntime(site, fetcher);
    const epoch = runtime().read.forumSessionEpochs[site];
    try {
      await act(async () => {
        if (entry === 'nodeimage') runtime().center.nodeImage.key.authorize();
        else await runtime().center.handleAccountCenterCommand({ type: 'open-login', site });
      });
      await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
      const previousProbes = fetcher.mock.calls.length;
      expect(runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`)).toBe(false);
      await enabled(false);
      await enabled(true);
      expect(fetcher).toHaveBeenCalledTimes(previousProbes);
      expect(runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`)).toBe(false);
      expect(runtime().read.readGateway.getReadPlan(site, 'account-data')).toMatchObject({
        state: 'blocked',
        reason: 'identity-pending'
      });

      await act(async () => runtime().center.handleAccountCenterCommand({ type: 'refresh' }));
      await waitFor(() => expect(runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`)).toBe(true));
      expect(runtime().read.forumSessionEpochs[site]).toBe(epoch);
      expect(runtime().read.accountSessionViewModels[site].currentUser?.id).toBe(id);
      expect(fetcher).toHaveBeenCalledTimes(previousProbes + 1);
    } finally {
      await view.unmount();
    }
  }
);

it.each(['same', 'changed', 'anonymous', 'storage-failed'] as const)(
  'retains an interrupted identity on an unknown recovery and explicitly settles %s without replaying authorization',
  async (outcome) => {
    await saveAccountSessionSnapshot(seedAccount());
    await markAccountSessionHandoffPending('linuxdo');
    appQueryClient.clear();
    let recover = false;
    const fetcher = jest.fn(async () => {
      if (!recover) throw new Error('account unavailable');
      return Response.json({
        current_user:
          outcome === 'anonymous'
            ? null
            : { id: outcome === 'changed' ? 'bob' : 'alice', username: outcome === 'changed' ? 'bob' : 'alice' }
      });
    });
    const { view, runtime } = await renderSiteRuntime('linuxdo', fetcher);
    try {
      await waitFor(() => expect(runtime().read.accountSessionViewModels.linuxdo.lastError).toBeTruthy());
      expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.id).toBe('alice');
      expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(mockWebViewLoads).toEqual([]);
      recover = true;
      const write = jest.spyOn(AsyncStorage, 'setItem');
      const originalWrite = write.getMockImplementation()!;
      if (outcome === 'storage-failed')
        write.mockImplementation(async (key, value) => {
          if (key === 'account-session.v1.linuxdo' && !JSON.parse(value).handoffPending)
            throw new Error('disk unavailable');
          return originalWrite(key, value);
        });
      try {
        await act(async () => runtime().center.handleAccountCenterCommand({ type: 'refresh' }));
        expect(fetcher).toHaveBeenCalledTimes(2);
        if (outcome === 'storage-failed') {
          expect(runtime().read.accountSessionViewModels.linuxdo).toMatchObject({
            identityTrust: 'unknown',
            canWrite: false
          });
          expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
          expect(JSON.parse((await AsyncStorage.getItem('account-session.v1.linuxdo'))!).handoffPending).toBe(true);
        } else {
          expect(runtime().read.forumSessionEpochs.linuxdo).toBe(outcome === 'same' ? 0 : 1);
          expect(
            runtime().read.notificationPrivateAccessAllowed(
              'linuxdo',
              outcome === 'changed' ? 'linuxdo:bob' : 'linuxdo:alice'
            )
          ).toBe(outcome !== 'anonymous');
          expect(
            JSON.parse((await AsyncStorage.getItem('account-session.v1.linuxdo'))!).handoffPending
          ).toBeUndefined();
        }
      } finally {
        write.mockRestore();
      }
    } finally {
      await view.unmount();
    }
  }
);

it('does not mount a login document until its durable marker is saved and preserves the account if saving fails', async () => {
  const { response } = accountClearFixture('nodeseek');
  const { view, runtime } = await renderSiteRuntime('nodeseek', async () => response());
  const write = jest.spyOn(AsyncStorage, 'setItem');
  let fail!: (error: Error) => void;
  write.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      })
  );
  try {
    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'nodeseek' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
    await act(async () => fail(new Error('disk unavailable')));
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(view.getByText('登录会话保存失败，请关闭后重试')).toBeTruthy();
    expect(runtime().read.accountSessionViewModels.nodeseek.currentUser?.id).toBe('42');
  } finally {
    write.mockRestore();
    await view.unmount();
  }
});

it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
  'preserves a newer %s account check when legacy clear cleanup finishes',
  async (site) => {
    const { id, response } = accountClearFixture(site);
    const probe = Promise.withResolvers<Response>();
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(() => probe.promise);
    const nativeClear = jest.fn(async () => true);
    NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies: nativeClear };
    const { view, runtime } = await renderSiteRuntime(site, fetcher);
    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site }));
    const cleanup = Promise.withResolvers<void>();
    jest
      .mocked(SecureStore.deleteItemAsync)
      .mockClear()
      .mockImplementationOnce(() => cleanup.promise);
    await fireEvent.press(view.getByLabelText('清除登录'));
    await waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalled());
    let checking!: ReturnType<ReturnType<typeof useAccountRuntime>['read']['reconcileAccountStatus']>;
    await act(async () => {
      checking = runtime().read.reconcileAccountStatus(site);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await act(async () => {
      cleanup.resolve();
    });
    await waitFor(() =>
      expect(events.some((event) => event.operation === 'clear' && event.phase === 'finish')).toBe(true)
    );
    const duringProbe = runtime().read.accountSessionViewModels[site];
    await act(async () => {
      probe.resolve(response());
      await checking;
    });
    expect(duringProbe).toMatchObject({ currentUser: { id }, isLoggedIn: true, isVerifying: true });
    await waitFor(() =>
      expect(runtime().read.accountSessionViewModels[site]).toMatchObject({
        currentUser: { id },
        isLoggedIn: true,
        isVerifying: false
      })
    );
    expect(events.filter((event) => event.operation === 'clear' && event.phase === 'finish')).toEqual([
      expect.objectContaining({ source: site, outcome: 'stale' })
    ]);
  }
);

it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
  'ignores a late %s clear failure after a newer check confirms the same account',
  async (site) => {
    const { id, response } = accountClearFixture(site);
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () => response());
    const native = Promise.withResolvers<boolean>();
    const nativeClear = jest.fn(() => native.promise);
    NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies: nativeClear };
    const { view, runtime } = await renderSiteRuntime(site, fetcher);
    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site }));
    await fireEvent.press(view.getByLabelText('清除登录'));
    await waitFor(() => expect(nativeClear).toHaveBeenCalledTimes(1));
    await act(async () => {
      await runtime().read.reconcileAccountStatus(site);
    });
    await act(async () => {
      native.reject(new Error('late native clear failure'));
    });
    await waitFor(() =>
      expect(events.some((event) => event.operation === 'clear' && event.phase === 'finish')).toBe(true)
    );
    expect(runtime().read.accountSessionViewModels[site]).toMatchObject({ currentUser: { id }, isLoggedIn: true });
    expect(runtime().read.accountSessionViewModels[site].lastError).toBeUndefined();
    expect(events.filter((event) => event.operation === 'clear' && event.phase === 'finish')).toEqual([
      expect.objectContaining({ source: site, outcome: 'stale' })
    ]);
  }
);

it('supersedes a LinuxDo clear while its native cookie barrier is pending', async () => {
  const { id, response } = accountClearFixture('linuxdo');
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () => response());
  const nativeClear = jest.fn(async () => true);
  NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies: nativeClear };
  const { view, runtime } = await renderSiteRuntime('linuxdo', fetcher);
  await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' }));
  const barrier = Promise.withResolvers<void>();
  const barrierMock = jest.mocked(setLinuxDoCookieResponseBarrier);
  const previous = barrierMock.getMockImplementation()!;
  barrierMock.mockImplementation((blocked, reason, ...args) =>
    reason === 'explicit-clear' ? barrier.promise : previous(blocked, reason, ...args)
  );
  try {
    await fireEvent.press(view.getByLabelText('清除登录'));
    await waitFor(() => expect(barrierMock).toHaveBeenCalledWith(true, 'explicit-clear'));
    await act(async () => {
      await runtime().read.reconcileAccountStatus('linuxdo');
    });
    await act(async () => {
      barrier.resolve();
    });
    expect(nativeClear).not.toHaveBeenCalled();
    expect(runtime().read.accountSessionViewModels.linuxdo).toMatchObject({ currentUser: { id }, isLoggedIn: true });
  } finally {
    barrierMock.mockImplementation(previous);
  }
});

it.each(['pending', 'failed', 'unknown', 'reopened'] as const)(
  'reconciles a closed Yaohuo page before issuing write access after a %s account check',
  async (previousCheck) => {
    appQueryClient.setQueryData(
      accountQueryKeys.snapshot('yaohuo'),
      accountSessionSnapshotFromEvent(createAccountSessionSnapshot('yaohuo'), {
        type: 'session-updated',
        loggedIn: true,
        currentUser: {
          source: 'yaohuo',
          id: '7',
          username: '火友',
          url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7'
        }
      })
    );
    const page =
      '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">火友</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>';
    const pending = Promise.withResolvers<Response>();
    const fetcher = jest
      .fn<ReturnType<Fetcher>, Parameters<Fetcher>>()
      .mockImplementationOnce(() =>
        previousCheck === 'pending' || previousCheck === 'reopened'
          ? pending.promise
          : Promise.reject(new Error('网络暂时不可用'))
      )
      .mockImplementation(async () => {
        if (previousCheck === 'unknown') throw new Error('网络暂时不可用');
        return new Response(page);
      });
    const { view, runtime } = await renderSiteRuntime('yaohuo', fetcher);
    try {
      await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'yaohuo' }));
      await fireEvent.press(view.getByLabelText('关闭'));
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      expect(runtime().hosts.surfaces.yaohuo).toBe(false);
      expect(runtime().read.notificationPrivateAccessAllowed('yaohuo', 'yaohuo:7')).toBe(false);
      if (previousCheck === 'failed' || previousCheck === 'unknown')
        await waitFor(() =>
          expect(
            events.some(
              (event) =>
                event.operation === 'account-reconcile' && event.phase === 'finish' && event.outcome === 'failure'
            )
          ).toBe(true)
        );
      let access!: ReturnType<ReturnType<typeof useAccountRuntime>['write']['ensureWritableSession']>;
      await act(async () => {
        access = runtime().write.ensureWritableSession('yaohuo');
        if (previousCheck === 'reopened')
          await runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'yaohuo' });
        if (previousCheck === 'pending' || previousCheck === 'reopened') pending.resolve(new Response(page));
        if (previousCheck === 'unknown' || previousCheck === 'reopened')
          await expect(access).rejects.toMatchObject({
            reason: previousCheck === 'unknown' ? 'identity_unavailable' : 'stale'
          });
        else await expect(access).resolves.toMatchObject({ source: 'yaohuo', identityKey: 'yaohuo:7' });
      });
      expect(fetcher).toHaveBeenCalledTimes(previousCheck === 'pending' || previousCheck === 'reopened' ? 1 : 2);
      expect(runtime().read.notificationPrivateAccessAllowed('yaohuo', 'yaohuo:7')).toBe(
        previousCheck !== 'unknown' && previousCheck !== 'reopened'
      );
      expect(runtime().read.accountSessionViewModels.yaohuo.isLoggedIn).toBe(true);
    } finally {
      await view.unmount();
    }
  }
);

it.each(['nodeseek', 'yaohuo'] as const)(
  'keeps ordinary %s browsing open after a logged-in page hint until the user checks',
  async (site) => {
    const fetcher = jest.fn(
      async () =>
        new Response(
          site === 'nodeseek'
            ? '<html><a class="Username" href="/space/42">alice</a></html>'
            : '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">火友</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        )
    );
    const { view, runtime } = await renderSiteRuntime(site, fetcher);
    try {
      await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site }));
      const webView = view.getByTestId('login-webview');
      const url = site === 'nodeseek' ? 'https://www.nodeseek.com/' : 'https://www.yaohuo.me/wapindex.aspx?sid=-2';
      await fireEvent(webView, 'loadStart', { nativeEvent: { url, loading: true } });
      await fireEvent(webView, 'loadEnd', { nativeEvent: { url } });
      await fireEvent(webView, 'message', {
        nativeEvent: {
          url: new URL(url).origin,
          data: JSON.stringify({
            type: `${site}-login`,
            documentKey: `${url}:1234`,
            status: 'logged-in',
            hasChallengeMarker: false,
            userAgent: 'WebView fixture agent'
          })
        }
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(runtime().hosts.surfaces[site]).toBe(true);
      expect(view.getByTestId('login-webview')).toBeTruthy();
      expect(mockWebViewLoads).toHaveLength(1);
      await fireEvent.press(view.getByText('检测登录'));
      await waitFor(() => expect(runtime().hosts.surfaces[site]).toBe(false));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(runtime().read.accountSessionViewModels[site].currentUser?.id).toBe(site === 'nodeseek' ? '42' : '7');
    } finally {
      await view.unmount();
    }
  }
);

it('keeps the same NodeSeek window through a rejected exact recovery and closes only after its explicit retry succeeds', async () => {
  seedNodeSeekAccount();
  const fetcher: Fetcher = async () => new Response('<html><a class="Username" href="/space/42">alice</a></html>');
  const { view, runtime } = await renderSiteRuntime('nodeseek', fetcher);
  const pending = Promise.withResolvers<'verification-required'>();
  const resume = jest
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue('completed');
  await act(async () =>
    runtime().hosts.requestNodeSeekVerification('需要验证', {
      queryKey: ['blocked-topic'],
      isCurrent: () => true,
      resume
    })
  );
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  await fireEvent.press(view.getByText('检测并继续'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(view.getByTestId('login-webview')).toBeTruthy();
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(true);
  expect(view.getByLabelText('正在检测…').props.accessibilityState.disabled).toBe(true);
  await act(async () => pending.resolve('verification-required'));
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  expect(runtime().read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(true);
  expect(mockWebViewLoads).toEqual(['https://www.nodeseek.com']);
  await fireEvent.press(view.getByText('检测并继续'));
  expect(resume).toHaveBeenCalledTimes(2);
  expect(runtime().hosts.surfaces.nodeseek).toBe(false);
  await view.unmount();
});

it.each(['reopened', 'background'] as const)('does not let a late NodeSeek recovery close a %s panel', async (exit) => {
  seedNodeSeekAccount();
  const { view, runtime, active } = await renderSiteRuntime(
    'nodeseek',
    async () => new Response('<html><a class="Username" href="/space/42">alice</a></html>')
  );
  const pending = Promise.withResolvers<'completed'>();
  const resume = jest.fn(() => pending.promise);
  await act(async () =>
    runtime().hosts.requestNodeSeekVerification('需要验证', { queryKey: ['old-topic'], isCurrent: () => true, resume })
  );
  await fireEvent.press(view.getByText('检测并继续'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(true);
  if (exit === 'reopened') {
    await fireEvent.press(view.getByLabelText('关闭'));
    await act(async () => runtime().hosts.requestNodeSeekVerification());
  } else {
    await active(false);
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
    await active(true);
  }
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  await act(async () => pending.resolve('completed'));
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(view.getByTestId('login-webview')).toBeTruthy();
  expect(view.queryByLabelText('正在检测…')).toBeNull();
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  await view.unmount();
});

it.each(['complete', 'reopened', 'background'] as const)(
  'closes only the current Yaohuo panel after authoritative identity on %s',
  async (exit) => {
    const pending = Promise.withResolvers<void>();
    const next = Promise.withResolvers<void>();
    let requests = 0;
    const fetcher = jest.fn(async () => {
      await (++requests === 1 ? pending.promise : next.promise);
      return new Response(
        '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">火友</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
      );
    });
    const { view, runtime, active } = await renderSiteRuntime('yaohuo', fetcher);
    await act(async () => runtime().hosts.showYaohuoLogin());
    const onCheck = runtime().hosts.element.props.view.checkYaohuoLoginAndClose;
    await act(async () => {
      onCheck();
      onCheck();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      events.filter((event) => event.source === 'yaohuo' && event.operation === 'check' && event.phase === 'intent')
    ).toHaveLength(1);
    if (exit === 'reopened') {
      await fireEvent.press(view.getByLabelText('关闭'));
      await act(async () => runtime().hosts.showYaohuoLogin());
      await fireEvent.press(view.getByText('检测登录'));
    }
    if (exit === 'background') {
      await active(false);
      await active(true);
    }
    await act(async () => pending.resolve());
    expect(runtime().hosts.surfaces.yaohuo).toBe(exit !== 'complete');
    if (exit === 'reopened') {
      expect(view.getByLabelText('正在检测…').props.accessibilityState.disabled).toBe(true);
      await act(async () => next.resolve());
      expect(runtime().hosts.surfaces.yaohuo).toBe(false);
    }
    if (exit === 'complete') {
      expect(runtime().read.accountSessionViewModels.yaohuo.currentUser?.id).toBe('7');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    await view.unmount();
  }
);

it.each([
  ['origin', 'complete'],
  ['origin', 'detect'],
  ['origin', 'close'],
  ['origin', 'navigate'],
  ['full-url', 'complete']
] as const)('records the visible verification egress through the %s bridge and permits %s', async (bridge, action) => {
  const traceUrl = 'https://linux.do/cdn-cgi/trace';
  const documentUrl = 'https://linux.do/latest';
  // Android WebMessageListener supplies sourceOrigin; the legacy bridge supplies the full document URL.
  const messageUrl = bridge === 'origin' ? 'https://linux.do' : documentUrl;
  const restoreBarrier = recordCookieBarriers();
  const now = jest.spyOn(Date, 'now');
  const pending = Promise.withResolvers<Response>();
  const traceResponse = () => {
    const response = new Response('ip=192.0.2.17\nhttp=h2\n', { headers: { 'content-type': 'text/plain' } });
    Object.defineProperty(response, 'url', { value: traceUrl });
    return response;
  };
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url, init) => {
    if (url === traceUrl) {
      init?.signal?.addEventListener('abort', () => pending.reject(new Error('aborted')), { once: true });
      return pending.promise;
    }
    if (url.endsWith('/session/current.json'))
      return new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }));
    throw new Error(`Unexpected test request: ${url}`);
  });
  let login: Awaited<ReturnType<typeof renderManualLogin>> | undefined;
  try {
    const { view, runtime } = (login = await renderManualLogin(fetcher));
    const webView = view.getByTestId('login-webview');
    await fireEvent(webView, 'message', {
      nativeEvent: {
        url: messageUrl,
        data: JSON.stringify({
          type: 'linuxdo-webview',
          userAgent: 'WebView fixture agent',
          documentKey: `${documentUrl}:1`,
          status: 'logged-in',
          hasChallengeMarker: false
        })
      }
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith(traceUrl, expect.objectContaining({ method: 'GET', credentials: 'omit' }));
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0][1])).toBeUndefined();
    const probe = events.find((event) => event.operation === 'egress-probe' && event.phase === 'intent');
    expect(probe).toMatchObject({ source: 'linuxdo', parentTraceId: expect.stringMatching(/^trace-/) });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ traceId: probe!.parentTraceId, area: 'credential', operation: 'check' })
      ])
    );
    if (action === 'complete') {
      await fireEvent(webView, 'loadStart', { nativeEvent: { url: documentUrl, loading: false } });
      await fireEvent(webView, 'loadStart', { nativeEvent: { url: documentUrl, loading: true } });
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
      expect(events.some((event) => event.traceId === probe!.traceId && event.phase === 'finish')).toBe(false);
      const browserFetch = jest.fn(async () => traceResponse());
      await act(async () => {
        new Function('window', 'location', 'performance', 'fetch', mockWebViewInjectJavaScript.mock.calls[0][0])(
          {
            get top(): unknown {
              return this;
            },
            ReactNativeWebView: {
              postMessage: (data: string) => webView.props.onMessage({ nativeEvent: { url: messageUrl, data } })
            }
          },
          { origin: 'https://linux.do', href: documentUrl },
          { timeOrigin: 1 },
          browserFetch
        );
        pending.resolve(traceResponse());
      });
      expect(browserFetch).toHaveBeenCalledWith(
        traceUrl,
        expect.objectContaining({ method: 'GET', credentials: 'omit' })
      );
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
      await waitFor(() =>
        expect(events.some((event) => event.traceId === probe!.traceId && event.phase === 'finish')).toBe(true)
      );
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/current.json'))).toHaveLength(0);
      expect(events.some((event) => event.verificationAction === 'auto-check')).toBe(false);
      now.mockReturnValue(Date.now() + 1500);
      await fireEvent.press(view.getByText('检测登录'));
      await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
    } else {
      if (action === 'navigate') {
        await act(async () => {
          expect(webView.props.onShouldStartLoadWithRequest({ url: 'https://linux.do/categories' })).toBe(true);
        });
        expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
        expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      }
      await fireEvent.press(action === 'close' ? view.getByLabelText('关闭') : view.getByText('检测登录'));
      await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/current.json'))).toHaveLength(
        action === 'close' ? 0 : 1
      );
    }
    await waitFor(() =>
      expect(events.filter((event) => event.operation === 'egress-probe' && event.phase === 'finish')).toEqual([
        expect.objectContaining({
          traceId: probe!.traceId,
          parentTraceId: probe!.parentTraceId,
          outcome: action === 'complete' ? 'success' : 'canceled',
          ...(action === 'complete'
            ? { isSameEgress: true, probeNativeProtocol: 'h2', probeWebViewProtocol: 'h2' }
            : { probeNativeResult: 'canceled', probeWebViewResult: 'canceled' }),
          ...(action === 'navigate' ? { probeCancelReason: 'navigation' } : {})
        })
      ])
    );
    const checkpoint = events.find(
      (event) =>
        event.traceId === probe!.parentTraceId &&
        event.egressCheckpoint === (action === 'close' ? 'close' : action === 'navigate' ? 'navigation' : 'check')
    );
    expect(checkpoint).toMatchObject({
      egressProbeTraceId: probe!.traceId,
      egressProbeState: action === 'complete' ? 'completed' : 'pending',
      ...(action === 'complete'
        ? { isSameEgress: true, probeNativeResult: 'success', probeWebViewResult: 'success' }
        : {})
    });
    expect(checkpoint!.egressProbeAgeMs).toEqual(expect.any(Number));
    if (action === 'complete') expect(checkpoint!.egressProbeAgeMs).toBeGreaterThanOrEqual(1500);
    const handoff = events.find(
      (event) =>
        event.operation === 'cookie-barrier' &&
        event.cookieBarrierReason === 'surface-close' &&
        event.phase === 'finish'
    );
    expect(handoff).toMatchObject({
      outcome: 'success',
      surfaceGeneration: expect.any(Number),
      ...(action === 'close' ? {} : { parentTraceId: probe!.parentTraceId })
    });
    const checkpointGeneration = checkpoint!.surfaceGeneration;
    if (typeof checkpointGeneration !== 'number') throw new Error('Missing egress checkpoint generation');
    if (action === 'close') expect(handoff!.surfaceGeneration).toBeGreaterThan(checkpointGeneration);
    else expect(checkpoint!.surfaceGeneration).toBe(handoff!.surfaceGeneration);
    expect(JSON.stringify(events)).not.toContain('192.0.2.17');
  } finally {
    pending.resolve(traceResponse());
    await login?.view.unmount();
    restoreBarrier();
    now.mockRestore();
  }
});

it.each(['current', 'stale', 'identity-changed'] as const)(
  'settles %s NodeSeek verification without requiring public readers to log in',
  async (state) => {
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    const fetcher: Fetcher = async () =>
      new Response('<html><meta name="nodeseekAccountState" content="anonymous"></html>', {
        headers: { 'content-type': 'text/html' }
      });
    function Harness() {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['nodeseek'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: true,
        screen: 'topic',
        webViewBlockMessage: ''
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
    await act(async () => {
      if (state === 'identity-changed') {
        appQueryClient.setQueryData(
          accountQueryKeys.snapshot('nodeseek'),
          accountSessionSnapshotFromEvent(createAccountSessionSnapshot('nodeseek'), {
            type: 'session-updated',
            loggedIn: true,
            currentUser: { source: 'nodeseek', id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' }
          })
        );
      }
    });
    const resume = jest.fn(async () => 'completed' as const);
    await act(async () =>
      runtime.hosts.requestNodeSeekVerification('需要验证', {
        queryKey: ['nodeseek-public-topic'],
        isCurrent: () => state !== 'stale',
        resume
      })
    );
    expect(runtime.read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(state === 'identity-changed');
    await fireEvent.press(view.getByText('检测并继续'));
    await waitFor(() => expect(runtime.hosts.surfaces.nodeseek).toBe(false));
    expect(resume).toHaveBeenCalledTimes(state === 'current' ? 1 : 0);
    expect(runtime.read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(false);
    expect(notify).not.toHaveBeenCalledWith('NodeSeek当前未登录。');
    await view.unmount();
  }
);

it.each(['automatic', 'manual'] as const)(
  'returns directly from CDK and retries the original reading body through %s detection and cookie handoff',
  async (detection) => {
    const restoreBarrier = recordCookieBarriers();
    jest.useFakeTimers({ doNotFake: ['performance'] });
    let clock = 0;
    const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
    const traceUrl = 'https://linux.do/cdn-cgi/trace';
    const nativeProbe = Promise.withResolvers<Response>();
    const traceResponse = () => {
      const response = new Response('ip=192.0.2.17\nhttp=h2\n', { headers: { 'content-type': 'text/plain' } });
      Object.defineProperty(response, 'url', { value: traceUrl });
      return response;
    };
    let challenged = true;
    const bodies: string[] = [];
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url, init) => {
      if (url === traceUrl) return nativeProbe.promise;
      if (url.endsWith('/session/csrf')) return new Response(JSON.stringify({ csrf: 'fixture' }));
      if (!url.endsWith('/topics/timings')) throw new Error('Unexpected test request');
      bodies.push(String(init?.body));
      return challenged
        ? new Response('<title>Just a moment...</title>', {
            status: 403,
            headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
          })
        : new Response('');
    });
    seedAccount();
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    function Harness() {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['linuxdo'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: true,
        screen: 'search',
        webViewBlockMessage: ''
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
    const advance = async (milliseconds: number) =>
      act(async () => {
        for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
          clock += 1000;
          await jest.advanceTimersByTimeAsync(1000);
        }
      });
    const releaseHandoff = Promise.withResolvers<void>();
    try {
      const reading = runtime.read.readGateway.reading!;
      const scope = reading.scope();
      const session = reading.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
      expect(reading.scope()).toBe(scope);
      session.visible([2]);
      await advance(10000);
      expect(mockWebViewLoads).toEqual(['https://cdk.linux.do/']);
      expect(bodies).toHaveLength(1);
      expect(reading.state()['12'].readPosts[2]).toBeUndefined();
      const original = events.find((event) => event.operation === 'reading-timings' && event.phase === 'intent')!;
      const accepted = events.find(
        (event) =>
          event.operation === 'check' && event.batchId === original.batchId && event.readingRecoveryState === 'paused'
      )!;
      expect(accepted).toMatchObject({ phase: 'apply', batchId: expect.any(Number) });
      const challenge = view.getByTestId('login-webview');
      await fireEvent(challenge, 'loadStart', {
        nativeEvent: { url: 'https://cdk.linux.do/login', loading: false }
      });
      for (let index = 0; index < 2; index++) {
        await fireEvent(challenge, 'message', {
          nativeEvent: { url: 'https://cdk.linux.do/login?token=secret-fixture', data: 'secret-fixture' }
        });
      }
      await fireEvent(challenge, 'loadEnd', { nativeEvent: { url: 'https://cdk.linux.do/login' } });
      expect(view.getByTestId('login-webview').props.source.uri).toBe('https://cdk.linux.do/');
      await fireEvent(challenge, 'message', {
        nativeEvent: {
          url: 'https://cdk.linux.do',
          data: JSON.stringify({
            type: 'linuxdo-webview',
            documentKey: 'https://cdk.linux.do/login:1',
            status: 'logged-out',
            hasChallengeMarker: false
          })
        }
      });
      const forum = view.getByTestId('login-webview');
      expect(forum.props.source.uri).toBe('https://linux.do/latest');
      expect(bodies).toHaveLength(1);
      expect(events.filter((event) => event.verificationAction === 'message-ignored')).toHaveLength(1);
      expect(events).toContainEqual(
        expect.objectContaining({
          traceId: accepted.traceId,
          verificationAction: 'return-to-forum',
          verificationPage: 'alternate-login'
        })
      );
      await fireEvent(forum, 'loadStart', { nativeEvent: { url: 'https://linux.do/latest', loading: true } });
      const pageMessage = (status: string) =>
        fireEvent(forum, 'message', {
          nativeEvent: {
            url: 'https://linux.do',
            data: JSON.stringify({
              type: 'linuxdo-webview',
              documentKey: 'https://linux.do/latest:1',
              userAgent: 'fixture-agent',
              status,
              hasChallengeMarker: false
            })
          }
        });
      await pageMessage('unknown');
      expect(bodies).toHaveLength(1);
      await fireEvent(forum, 'loadStart', { nativeEvent: { url: 'https://linux.do/latest', loading: true } });
      await fireEvent(forum, 'loadEnd', { nativeEvent: { url: 'https://linux.do/latest' } });
      await pageMessage('logged-in');
      await fireEvent(forum, 'loadStart', { nativeEvent: { url: 'https://linux.do/latest', loading: true } });
      await fireEvent(forum, 'loadEnd', { nativeEvent: { url: 'https://linux.do/latest' } });
      const script = mockWebViewInjectJavaScript.mock.calls.find(([value]) =>
        value.includes('__WZ_EGRESS_PROBE__')
      )![0];
      const browserFetch = jest.fn(async () => traceResponse());
      await act(async () => {
        new Function('window', 'location', 'performance', 'fetch', script)(
          {
            get top(): unknown {
              return this;
            },
            ReactNativeWebView: {
              postMessage: (data: string) => forum.props.onMessage({ nativeEvent: { url: 'https://linux.do', data } })
            }
          },
          { origin: 'https://linux.do', href: 'https://linux.do/latest' },
          { timeOrigin: 1 },
          browserFetch
        );
      });
      expect(browserFetch).toHaveBeenCalledWith(traceUrl, expect.objectContaining({ credentials: 'omit' }));
      expect(fetcher).toHaveBeenCalledWith(traceUrl, expect.objectContaining({ credentials: 'omit' }));
      expect(bodies).toHaveLength(1);
      const handoff = jest.mocked(setLinuxDoCookieResponseBarrier).getMockImplementation()!;
      jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(async (...args) => {
        expect(view.queryByTestId('login-webview')).toBeNull();
        await releaseHandoff.promise;
        await handoff(...args);
      });
      challenged = false;
      if (detection === 'manual') await fireEvent.press(view.getByText('检测并继续'));
      await act(async () => nativeProbe.resolve(traceResponse()));
      expect(view.queryByTestId('login-webview')).toBeNull();
      expect(bodies).toHaveLength(1);
      expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
      expect(events.filter((event) => event.verificationAction === 'auto-check')).toHaveLength(
        detection === 'automatic' ? 1 : 0
      );
      await act(async () => releaseHandoff.resolve());
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(reading.scope()).toBe(scope);
      expect(reading.state()['12'].server.lastReadPostNumber).toBe(1);
      expect(runtime.hosts.linuxDoVerificationVisible).toBe(false);
      expect(notify).toHaveBeenCalledWith('linux.do 阅读记录已同步。');
      expect(events.filter((event) => event.operation === 'reading-timings' && event.phase === 'intent')).toEqual([
        expect.objectContaining({ batchId: original.batchId, attempt: 1, isRecovery: false }),
        expect.objectContaining({ batchId: original.batchId, attempt: 2, isRecovery: true })
      ]);
      const completed = events.find(
        (event) =>
          event.operation === 'check' &&
          event.batchId === original.batchId &&
          event.readingRecoveryState === 'completed'
      )!;
      expect(completed).toMatchObject({ phase: 'apply', traceId: accepted.traceId });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            traceId: completed.traceId,
            batchId: original.batchId,
            readingRecoveryState: 'resuming'
          }),
          expect.objectContaining({
            operation: 'cookie-barrier',
            phase: 'finish',
            parentTraceId: completed.traceId,
            outcome: 'success'
          }),
          expect.objectContaining({
            operation: 'egress-probe',
            phase: 'finish',
            parentTraceId: completed.traceId,
            outcome: detection === 'automatic' ? 'success' : 'canceled'
          })
        ])
      );
      expect(JSON.stringify(events)).not.toMatch(/secret-fixture|192\.0\.2\.17/);
    } finally {
      nativeProbe.resolve(traceResponse());
      releaseHandoff.resolve();
      await view.unmount();
      monotonic.mockRestore();
      jest.useRealTimers();
      restoreBarrier();
    }
  }
);

it.each([
  ['handoff', 'close'],
  ['csrf', 'back'],
  ['timings', 'background'],
  ['handoff', 'source'],
  ['handoff', 'identity']
] as const)('ends reading recovery during %s on %s without late sends or reopened panels', async (stage, exit) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  // Keep restoration pending at mount so reading must wait for its account scope.
  defaultStorageRead.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 50)));
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  let csrf = 0;
  const fetcher: Fetcher = async (url) => {
    if (url.endsWith('/session/csrf')) {
      if (++csrf === 2 && stage === 'csrf') await pending;
      return new Response(JSON.stringify({ csrf: 'fixture' }));
    }
    if (++posts === 1)
      return new Response('<title>Just a moment...</title>', {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
      });
    if (stage === 'timings') await pending;
    return new Response('');
  };
  seedAccount();
  const notify = jest.fn();
  let runtime!: ReturnType<typeof useAccountRuntime>;
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? ['linuxdo'] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen: 'search',
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  try {
    expect(runtime.read.sessionsReady).toBe(false);
    await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
    const session = runtime.read.readGateway.reading!.begin('12');
    session.visible([1]);
    session.active(true);
    await act(async () => {
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(posts).toBe(1);
    await act(async () => {
      clock += 10000;
      await jest.advanceTimersByTimeAsync(10000);
    });
    if (stage === 'handoff') jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => pending);
    await fireEvent.press(view.getByText('检测并继续'));
    expect(view.getByText('可以随时关闭并返回原页面。')).toBeTruthy();
    if (exit === 'close') await fireEvent.press(view.getByLabelText('关闭'));
    if (exit === 'back')
      await act(async () => {
        expect(runtime.hosts.closeTopmostSurface()).toBe('linuxdo-panel-closed');
      });
    if (exit === 'source') await view.rerender(<Harness enabled={false} />);
    if (exit === 'identity')
      await act(async () => {
        seedAccount('bob');
      });
    if (exit === 'background') await view.rerender(<Harness active={false} />);
    await act(async () => {
      release();
    });
    if (exit === 'background') {
      await view.rerender(<Harness />);
      expect(view.getByText(/检测因切到后台而中断/)).toBeTruthy();
      await fireEvent.press(view.getByText('返回原页面'));
    }
    await act(async () => {
      clock += 30000;
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(posts).toBe(stage === 'timings' ? 2 : 1);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(false);
    expect(mockWebViewLoads).toEqual(['https://cdk.linux.do/']);
  } finally {
    release();
    await view.unmount();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it('suppresses canceled query notifications until a new explicit request produces a new error', async () => {
  jest.useFakeTimers();
  const queryKey = ['cancel-recovery-query'];
  let attempts = 0;
  const observer = new QueryObserver(appQueryClient, {
    queryKey,
    retry: false,
    queryFn: async () => {
      ++attempts;
      throw new Error('blocked');
    }
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const hook = await renderRuntime(async () => new Response('{}'));
  const resume = jest.fn(async () => 'verification-required' as const);
  try {
    await act(async () => {
      await observer.refetch();
    });
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('page', { queryKey, resume })).toBe(true);
    });
    await act(async () => {
      hook.result.current.hosts.closeTopmostSurface();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('duplicate', { queryKey, resume })).toBe(false);
    });
    const previousAttempts = attempts;
    await act(async () => {
      await observer.refetch();
    });
    expect(attempts).toBe(previousAttempts + 1);
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('new request', { queryKey, resume })).toBe(true);
    });
    expect(resume).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      hook.result.current.hosts.closePanels();
    });
    await hook.unmount();
    unsubscribe();
    observer.destroy();
    jest.useRealTimers();
  }
});

it('accepts an explicitly current read recovery without an active Query observer', async () => {
  const hook = await renderRuntime(async () => new Response('{}'));
  const resume = jest.fn(async () => 'completed' as const);
  await act(async () => {
    expect(
      await hook.result.current.hosts.showLinuxDoVerification('page', {
        queryKey: ['explicit-detail-refresh'],
        isCurrent: () => true,
        resume
      })
    ).toBe(true);
  });
  expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(true);
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  await hook.unmount();
});

it('accepts fresh server reading after changing the NodeSeek recovery setting', async () => {
  seedAccount();
  const localIdentity = Promise.withResolvers<null>();
  defaultStorageRead.mockReturnValue(localIdentity.promise);
  let lastRead = 20;
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(
    async () => new Response(JSON.stringify({ id: 12, last_read_post_number: lastRead, highest_post_number: 250 }))
  );
  const options = {
    appActive: true,
    enabledSources: ['linuxdo'] as Source[],
    fetcher,
    loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
    notify: jest.fn(),
    openUser: async () => undefined,
    ready: true,
    screen: 'search' as const,
    webViewBlockMessage: ''
  };
  const hook = await renderHook(
    ({ threshold }: { threshold: number }) => useAccountRuntime({ ...options, nodeSeekRecoveryThreshold: threshold }),
    { initialProps: { threshold: 1 }, wrapper: QueryTestWrapper }
  );
  try {
    const reading = hook.result.current.read.readGateway.reading!;
    expect(reading.scope()).toBeNull();
    await act(async () => localIdentity.resolve(null));
    await waitFor(() => {
      expect(hook.result.current.read.sessionsReady).toBe(true);
      expect(reading.scope()).toBe('linuxdo:alice:0');
    });
    await act(async () => {
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
    });
    expect(reading.state()['12'].server.lastReadPostNumber).toBe(20);
    await hook.rerender({ threshold: 2 });
    lastRead = 200;
    await act(async () => {
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
    });
    expect(hook.result.current.read.readGateway.reading!.state()['12'].server.lastReadPostNumber).toBe(200);
    expect(hook.result.current.read.readGateway.reading).toBe(reading);
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => {
      localIdentity.resolve(null);
      await localIdentity.promise;
      await hook.unmount();
    });
  }
});

it.each(['csrf', 'timings'] as const)(
  'preserves in-flight %s and paused reading when its transport changes',
  async (stage) => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    let clock = 0;
    const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const heldRequestPath = stage === 'csrf' ? '/session/csrf' : '/topics/timings';
    const oldFetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) =>
      url.endsWith(heldRequestPath) ? pending : new Response(JSON.stringify({ csrf: 'same-transport-identity' }))
    );
    const nextFetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () => new Response(''));
    const options = {
      enabledSources: ['linuxdo'] as Source[],
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: jest.fn(),
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen: 'search' as const,
      webViewBlockMessage: ''
    };
    seedAccount();
    const hook = await renderHook(
      (props: { fetcher: Fetcher; appActive: boolean }) => useAccountRuntime({ ...options, ...props }),
      { initialProps: { fetcher: oldFetcher, appActive: true }, wrapper: QueryTestWrapper }
    );
    const advance = async (milliseconds: number) => {
      await act(async () => {
        for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
          clock += 1000;
          await jest.advanceTimersByTimeAsync(1000);
        }
      });
    };
    const postBodies = () =>
      [...oldFetcher.mock.calls, ...nextFetcher.mock.calls]
        .filter(([url]) => url.endsWith('/topics/timings'))
        .map(([, init]) => Object.fromEntries(new URLSearchParams(init?.body as string)));
    try {
      await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
      const reading = hook.result.current.read.readGateway.reading!;
      const session = reading.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      await waitFor(() =>
        expect(oldFetcher.mock.calls.find(([url]) => url.endsWith(heldRequestPath))?.[1]?.signal?.aborted).toBe(false)
      );
      const heldSignal = oldFetcher.mock.calls.find(([url]) => url.endsWith(heldRequestPath))?.[1]?.signal;
      session.visible([2]);
      await advance(5000);
      await hook.rerender({ fetcher: nextFetcher, appActive: false });
      expect(heldSignal?.aborted).toBe(false);
      await act(async () => {
        complete(
          stage === 'csrf' ? new Response(JSON.stringify({ csrf: 'same-transport-identity' })) : new Response('')
        );
      });
      expect(postBodies()).toEqual([
        { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
        { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' }
      ]);
      await advance(10000);
      expect(postBodies()).toHaveLength(2);
      session.visible([3]);
      await hook.rerender({ fetcher: nextFetcher, appActive: true });
      await advance(1000);
      await act(async () => session.end());
      expect(postBodies()).toEqual([
        { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
        { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' },
        { topic_id: '12', topic_time: '1000', 'timings[3]': '1000' }
      ]);
      expect(nextFetcher.mock.calls.every(([url]) => url.endsWith('/topics/timings'))).toBe(true);
      expect(reading.state()['12'].anchor).toEqual({ floor: 3 });
    } finally {
      await act(async () => {
        complete(new Response(stage === 'csrf' ? JSON.stringify({ csrf: 'same-transport-identity' }) : ''));
        await pending;
        await hook.unmount();
      });
      monotonic.mockRestore();
      jest.useRealTimers();
    }
  }
);

it.each(
  (['csrf', 'timings'] as const).flatMap((stage) =>
    (['changed', 'anonymous', 'disabled'] as const).map((transition) => ({ stage, transition }))
  )
)('isolates pending reading at $stage when the account becomes $transition', async ({ stage, transition }) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  let held = false;
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
    if (!held && url.endsWith(stage === 'csrf' ? '/session/csrf' : '/topics/timings')) {
      held = true;
      return pending;
    }
    return url.endsWith('/session/csrf') ? new Response(JSON.stringify({ csrf: 'current-token' })) : new Response('');
  });
  let hook: Awaited<ReturnType<typeof renderRuntime>> | undefined;
  const advance = async (milliseconds: number) => {
    await act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  };
  const postBodies = () =>
    fetcher.mock.calls
      .filter(([url]) => url.endsWith('/topics/timings'))
      .map(([, init]) => Object.fromEntries(new URLSearchParams(init?.body as string)));
  try {
    hook = await renderRuntime(fetcher);
    const oldReading = hook.result.current.read.readGateway.reading!;
    const oldScope = oldReading.scope();
    const oldSession = oldReading.begin('12');
    oldSession.visible([1]);
    oldSession.active(true);
    await advance(1000);
    expect(held).toBe(true);
    oldSession.visible([2]);
    await advance(5000);
    const expectedOldPosts = stage === 'timings' ? 1 : 0;
    expect(postBodies()).toHaveLength(expectedOldPosts);
    const heldSignal = fetcher.mock.calls[stage === 'csrf' ? 0 : 1][1]?.signal;

    if (transition === 'disabled') await hook.rerender({ enabledSources: [] });
    else
      await act(async () => {
        if (transition === 'changed') seedAccount('bob');
        else appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), createAccountSessionSnapshot('linuxdo'));
      });
    await waitFor(() => expect(heldSignal?.aborted).toBe(true));
    expect(appQueryClient.getQueryData(discourseReadingQueryKey(oldScope))).toBeUndefined();
    const current = hook.result.current.read.readGateway.reading!;
    expect(current.state()).toEqual({});
    const newSession = current.begin('13');
    newSession.visible([1]);
    newSession.active(true);
    await advance(1000);
    await act(async () => newSession.end());
    expect(postBodies().map((body) => body.topic_id)).toEqual([
      ...(stage === 'timings' ? ['12'] : []),
      ...(transition === 'changed' ? ['13'] : [])
    ]);
    await act(async () => {
      complete(
        stage === 'csrf'
          ? new Response(JSON.stringify({ csrf: 'stale-token' }))
          : new Response(JSON.stringify({ errors: ['登录状态已失效'] }), { status: 401 })
      );
    });
    await advance(30000);
    expect(postBodies()).toHaveLength(expectedOldPosts + (transition === 'changed' ? 1 : 0));
    expect(current.state()['12']).toBeUndefined();
    if (transition === 'changed') {
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('bob');
      expect(current.state()['13'].server.lastReadPostNumber).toBe(1);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/csrf'))).toHaveLength(2);
    } else {
      expect(current.scope()).toBeNull();
      expect(current.state()).toEqual({});
    }
    if (transition === 'disabled') {
      await hook.rerender({ enabledSources: ['linuxdo'] });
      oldSession.visible([3]);
      oldSession.active(true);
      await advance(1000);
      expect(postBodies()).toHaveLength(expectedOldPosts);
      expect(current.state()).toEqual({});
      const resumed = hook.result.current.read.readGateway.reading!.begin('13');
      resumed.visible([1]);
      resumed.active(true);
      await advance(1000);
      await act(async () => resumed.end());
      expect(postBodies().at(-1)?.topic_id).toBe('13');
    }
    await act(async () => oldSession.end());
    expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(false);
  } finally {
    complete(new Response(''));
    await hook?.unmount();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it('pauses reading behind read recovery and resumes without replacing account progress', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  const queryKey = ['reading-recovery-overlay'];
  const observer = new QueryObserver(appQueryClient, {
    queryKey,
    queryFn: async () => ({}),
    initialData: {},
    staleTime: Infinity
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) =>
    url.endsWith('/session/csrf') ? new Response(JSON.stringify({ csrf: 'test' })) : new Response('')
  );
  let mounted: Awaited<ReturnType<typeof renderSiteRuntime>> | undefined;
  const advance = async (milliseconds: number) => {
    await act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  };
  try {
    await saveAccountSessionSnapshot(seedAccount());
    const { view, runtime } = (mounted = await renderSiteRuntime('linuxdo', fetcher));
    const reading = runtime().read.readGateway.reading!;
    const scope = reading.scope();
    const accountBefore = appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'));
    const epochBefore = runtime().read.forumSessionEpochs.linuxdo;
    const plan = runtime().read.readGateway.getReadPlan('linuxdo', 'topic');
    const session = reading.begin('12');
    session.visible([1], { floor: 1 });
    session.active(true);
    await advance(1000);
    expect(reading.state()['12'].readPosts[1]).toBe(true);
    await act(async () => {
      await runtime().hosts.showLinuxDoVerification('读取需要验证', {
        queryKey,
        resume: async () => 'completed'
      });
    });
    expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
    expect(runtime().read.readGateway.getReadPlan('linuxdo', 'topic')).toEqual(plan);
    session.visible([2], { floor: 2 });
    await advance(10000);
    expect(reading.state()['12'].readPosts[2]).toBeUndefined();
    expect(reading.state()['12'].anchor).toEqual({ floor: 1 });
    expect(reading.scope()).toBe(scope);
    await fireEvent.press(view.getByLabelText('关闭'));
    await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
    expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'))).toEqual(accountBefore);
    expect(runtime().read.forumSessionEpochs.linuxdo).toBe(epochBefore);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/current.json'))).toHaveLength(0);
    expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
    expect(runtime().read.readGateway.reading).toBe(reading);
    await advance(1000);
    expect(reading.state()['12'].readPosts[2]).toBe(true);
    await act(async () => session.end());
    expect(
      fetcher.mock.calls
        .filter(([url]) => url.endsWith('/topics/timings'))
        .reduce((total, [, init]) => total + Number(new URLSearchParams(init?.body as string).get('topic_time')), 0)
    ).toBe(2000);
  } finally {
    await mounted?.view.unmount();
    unsubscribe();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it.each(['loading', 'ready'] as const)(
  'preserves the same login page across background and foreground: %s',
  async (phase) => {
    seedAccount();
    const fetcher = jest.fn(async () => new Response('{}'));
    const options = {
      enabledSources: ['linuxdo'] as Source[],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: jest.fn(),
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen: 'search' as const,
      webViewBlockMessage: ''
    };
    let runtime!: ReturnType<typeof useAccountRuntime>;
    function Harness({ appActive }: { appActive: boolean }) {
      runtime = useAccountRuntime({ ...options, appActive });
      return runtime.hosts.element;
    }
    const view = await render(<Harness appActive />, { wrapper: QueryTestWrapper });
    await act(async () => runtime.center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' }));
    const webView = await view.findByTestId('login-webview');
    if (phase === 'ready') await fireEvent(webView, 'loadEnd', { nativeEvent: {} });
    const epoch = runtime.read.forumSessionEpochs.linuxdo;
    const handoffs = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;

    await view.rerender(<Harness appActive={false} />);
    expect(view.getByTestId('login-webview')).toBe(webView);
    await view.rerender(<Harness appActive />);
    expect(view.getByTestId('login-webview')).toBe(webView);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
    expect(runtime.read.forumSessionEpochs.linuxdo).toBe(epoch);
    expect(setLinuxDoCookieResponseBarrier).toHaveBeenCalledTimes(handoffs);
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it.each(['anonymous', 'same', 'changed', 'unknown'] as const)(
  'settles a category HTTP 400 through one concurrent account probe: %s',
  async (outcome) => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (input, init) => {
      if (input.endsWith('/site.json'))
        return new Response(JSON.stringify({ errors: ['分类读取失败'] }), { status: 400 });
      if (input.endsWith('/session/current.json'))
        return browserFetchIntentFromInit(init)?.owner === 'account'
          ? pending
          : new Response(JSON.stringify({ current_user: { username: 'alice' } }));
      if (input.endsWith('/latest')) return new Response('<html></html>');
      throw new Error(`Unexpected test request: ${input}`);
    });
    const probes = () =>
      fetcher.mock.calls.filter(
        ([url, init]) => url.endsWith('/session/current.json') && browserFetchIntentFromInit(init)?.owner === 'account'
      );
    const hook = await renderRuntime(fetcher);
    const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
    try {
      await act(async () => {
        await expect(
          hook.result.current.read.readGateway.getLinuxDoTopicCreationContext({ source: 'linuxdo' })
        ).rejects.toMatchObject({ status: 400 });
      });
      await waitFor(() => expect(probes()).toHaveLength(1));
      await act(async () => {
        hook.result.current.write.requestAccountRecheck('linuxdo', epoch, 'trace-987');
      });
      expect(probes()).toHaveLength(1);
      await waitFor(() =>
        expect(hook.result.current.read.accountSessionViewModels.linuxdo).toMatchObject({
          isLoggedIn: true,
          isVerifying: true
        })
      );
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic-creation-context')).toMatchObject({
        lane: 'authenticated'
      });
      await act(async () => {
        complete(
          outcome === 'unknown'
            ? new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 })
            : new Response(
                JSON.stringify({
                  current_user: outcome === 'anonymous' ? null : { username: outcome === 'changed' ? 'bob' : 'alice' }
                })
              )
        );
      });
      await waitFor(() => expect(hook.result.current.read.accountSessionViewModels.linuxdo.isVerifying).toBe(false));
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.isLoggedIn).toBe(outcome !== 'anonymous');
      expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(
        epoch + (outcome === 'anonymous' || outcome === 'changed' ? 1 : 0)
      );
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic-creation-context')).toMatchObject(
        outcome === 'anonymous' ? { state: 'blocked', reason: 'login-required' } : { lane: 'authenticated' }
      );
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe(
        outcome === 'anonymous' ? undefined : outcome === 'changed' ? 'bob' : 'alice'
      );
      if (outcome === 'unknown')
        expect(hook.result.current.read.accountSessionViewModels.linuxdo.lastError).toBeTruthy();
      expect(probes()).toHaveLength(1);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/site.json'))).toHaveLength(1);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/current.json'))).toHaveLength(2);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'account-reconcile',
            phase: 'intent',
            parentTraceId: expect.stringMatching(/^trace-/)
          }),
          expect.objectContaining({
            operation: 'account-reconcile',
            phase: 'guard',
            reason: 'duplicate',
            parentTraceId: 'trace-987'
          }),
          expect.objectContaining({ operation: 'account-reconcile', phase: 'finish' })
        ])
      );
    } finally {
      await act(async () => complete(new Response(JSON.stringify({ current_user: { username: 'alice' } }))));
    }
  }
);

it.each([
  { source: 'linuxdo', entry: 'topic', status: 403, outcome: 'anonymous' },
  { source: 'linuxdo', entry: 'topic', status: 404, outcome: 'same' },
  { source: 'linuxdo', entry: 'topic', status: 403, outcome: 'changed' },
  { source: 'linuxdo', entry: 'topic', status: 404, outcome: 'unknown' },
  { source: 'linuxdo', entry: 'category', status: 401, outcome: 'expired' },
  { source: 'linuxdo', entry: 'category', status: 403, outcome: 'anonymous' },
  { source: 'linuxdo', entry: 'csrf', status: 403, outcome: 'anonymous' },
  { source: 'linuxdo', entry: 'editable-reply', status: 401, outcome: 'expired' },
  { source: 'linuxdo', entry: 'editable-reply', status: 403, outcome: 'anonymous' },
  { source: 'nodeseek', entry: 'vote', status: 401, outcome: 'expired' },
  { source: 'yaohuo', entry: 'favorite', status: 401, outcome: 'expired' }
] as const)(
  'settles $source $entry HTTP $status through real Account $outcome and restores only a read after login',
  async ({ source, entry, status, outcome }) => {
    const username = source === 'linuxdo' ? `chain-${entry}-${status}-${outcome}` : 'alice';
    const userId = source === 'nodeseek' ? '42' : source === 'yaohuo' ? '7' : username;
    const topicId = source === 'nodeseek' ? '128' : source === 'yaohuo' ? '123' : '900';
    if (source === 'linuxdo') seedAccount(username);
    else accountClearFixture(source);
    const probe = Promise.withResolvers<Response>();
    let restored = false;
    const json = (data: unknown, responseStatus = 200) =>
      new Response(JSON.stringify(data), { status: responseStatus, headers: { 'Content-Type': 'application/json' } });
    const loginFailure = () => json({ errors: ['您需要登录才能执行此操作。'], error_type: 'not_logged_in' }, status);
    const linuxDoTopic = {
      id: 900,
      title: 'Readable topic',
      slug: 'readable',
      created_at: '2026-10-12T00:00:00Z',
      posts_count: 2,
      post_stream: {
        stream: [1001, 1002],
        posts: [
          { id: 1001, post_number: 1, username, cooked: '<p>opening</p>', created_at: '2026-10-12T00:00:00Z' },
          {
            id: 1002,
            post_number: 2,
            username: 'bob',
            cooked: '<p>reply</p>',
            created_at: '2026-10-12T00:01:00Z',
            can_edit: entry === 'editable-reply'
          }
        ]
      }
    };
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (input) => {
      const path = new URL(input).pathname;
      if (source === 'linuxdo') {
        if (path === '/session/current.json')
          return restored ? json({ current_user: { id: userId, username } }) : probe.promise;
        if (path === '/site.json')
          return entry === 'category' && !restored
            ? loginFailure()
            : json({ categories: [{ id: 5, name: 'Recovered category' }] });
        if (path === '/session/csrf.json') return restored ? json({ csrf: 'synthetic' }) : loginFailure();
        if (path === '/posts/1002.json')
          return restored ? json({ can_edit: true, raw: 'restored raw reply' }) : loginFailure();
        if (path === '/search') return json({ topics: [], posts: [], grouped_search_result: {} });
        if (path === '/latest.json')
          return json({
            topic_list: {
              topics: [
                {
                  id: 900,
                  title: 'Readable feed',
                  category_id: 5,
                  created_at: '2026-10-12T00:00:00Z',
                  posts_count: 1
                }
              ]
            }
          });
        if (path === '/t/900.json') return entry === 'topic' && !restored ? loginFailure() : json(linuxDoTopic);
      } else if (source === 'nodeseek') {
        if (path === '/') return new Response('<html><a class="Username" href="/space/42">alice</a></html>');
        if (path === '/api/vote/info/100')
          return restored
            ? json({ id: 100, title: 'Recovered vote', options: [{ id: 1, text: 'yes' }] })
            : new Response('expired', { status: 401 });
        if (path === '/post-128-1')
          return new Response(
            '<html><head><title>Readable topic</title></head><body><a class="post-title" href="/post-128-1">Readable topic</a><div class="content-item" data-comment-id="1"><a href="/space/42">alice</a><article class="post-content"><p>opening <a href="nsapp://vote?id=100">nsapp://vote?id=100</a></p></article></div></body></html>'
          );
      } else {
        if (path === '/wapindex.aspx')
          return new Response(
            '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">alice</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
          );
        if (path === '/bbs/favlist.aspx')
          return restored ? new Response('<div class="listdata"></div>') : new Response('expired', { status: 401 });
        if (path === '/bbs-123.html')
          return new Response(
            '<div class="content">[标题] Readable topic (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>opening</p><!--listE--></div>更多回帖(0)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'
          );
      }
      throw new Error(`Unexpected account-chain request: ${input}`);
    });
    const probes = () =>
      fetcher.mock.calls.filter(([url]) => {
        const path = new URL(url).pathname;
        return source === 'linuxdo'
          ? path === '/session/current.json'
          : source === 'nodeseek'
            ? path === '/'
            : path === '/wapindex.aspx';
      });
    const { view, runtime } = await renderSiteRuntime(source, fetcher);
    const epoch = runtime().read.forumSessionEpochs[source];
    const read = () => {
      const gateway = runtime().read.readGateway;
      if (entry === 'category') return gateway.getFeed({ source, limit: 1 });
      if (entry === 'csrf') return gateway.searchTopics({ source, query: 'AI' });
      return gateway.getTopic({
        source,
        id: topicId,
        ...(source === 'yaohuo'
          ? {
              topic: {
                source,
                id: topicId,
                title: 'Readable topic',
                author: 'alice',
                url: 'https://www.yaohuo.me/bbs-123.html',
                createdAt: '2026-05-20T00:00:00Z',
                replyCount: 0
              }
            }
          : {})
      });
    };
    try {
      let failedRead!: Awaited<ReturnType<typeof read>>;
      await act(async () => {
        if (status === 401) await expect(read()).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
        else failedRead = await read();
      });
      if (status !== 401)
        expect(failedRead).toMatchObject(
          entry === 'topic'
            ? { accessRequirement: { type: 'login' } }
            : entry === 'category'
              ? { items: [{ title: 'Readable feed' }], errors: {} }
              : entry === 'csrf'
                ? { items: [], errors: {} }
                : { id: topicId, title: 'Readable topic' }
        );
      if (status !== 401) {
        await waitFor(() => expect(probes()).toHaveLength(1));
        await act(async () => {
          await read();
        });
        expect(probes()).toHaveLength(1);
        expect(runtime().read.accountSessionViewModels[source]).toMatchObject({ isLoggedIn: true, isVerifying: true });
        await act(async () => {
          probe.resolve(
            outcome === 'unknown'
              ? json({ errors: ['您需要登录才能执行此操作。'] }, 403)
              : json({
                  current_user:
                    outcome === 'anonymous'
                      ? null
                      : {
                          id: outcome === 'changed' ? 'bob' : userId,
                          username: outcome === 'changed' ? 'bob' : username
                        }
                })
          );
        });
      } else expect(probes()).toHaveLength(0);
      await waitFor(() => expect(runtime().read.accountSessionViewModels[source].isVerifying).toBe(false));
      const loggedOut = outcome === 'anonymous' || outcome === 'expired';
      expect(runtime().read.accountSessionViewModels[source]).toMatchObject(
        loggedOut
          ? { status: outcome, isLoggedIn: false, identityTrust: 'none' }
          : { isLoggedIn: true, currentUser: { username: outcome === 'changed' ? 'bob' : username } }
      );
      expect(runtime().read.forumSessionEpochs[source]).toBe(epoch + Number(loggedOut || outcome === 'changed'));
      if (outcome === 'unknown') expect(runtime().read.accountSessionViewModels[source].lastError).toBeTruthy();
      if (loggedOut) {
        const beforeLogin = probes().length;
        await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: source }));
        await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
        expect(probes()).toHaveLength(beforeLogin);
        restored = true;
        await fireEvent.press(view.getByText('检测登录'));
        await waitFor(() => expect(view.queryByTestId('login-webview')).toBeNull());
        expect(runtime().read.accountSessionViewModels[source]).toMatchObject({
          isLoggedIn: true,
          identityTrust: 'confirmed',
          currentUser: { id: userId, username }
        });
        expect(runtime().read.forumSessionEpochs[source]).toBe(epoch + 2);
        expect(probes()).toHaveLength(beforeLogin + 1);
        let recovered!: Awaited<ReturnType<typeof read>>;
        await act(async () => {
          recovered = await read();
        });
        expect(recovered).toMatchObject(
          entry === 'category'
            ? { items: [{ category: 'Recovered category' }], errors: {} }
            : entry === 'csrf'
              ? { items: [], errors: {} }
              : entry === 'editable-reply'
                ? { replies: [{ contentMarkdown: 'restored raw reply' }] }
                : entry === 'vote'
                  ? { polls: [{ id: '100', title: 'Recovered vote' }] }
                  : entry === 'favorite'
                    ? { bookmarked: false, contentHtml: '<p>opening</p>' }
                    : { id: topicId, contentHtml: '<p>opening</p>' }
        );
        expect(probes()).toHaveLength(beforeLogin + 1);
      }
      expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    } finally {
      probe.resolve(json({ current_user: { id: userId, username } }));
      await view.unmount();
    }
  }
);

it.each(['anonymous', 'same', 'unknown'] as const)(
  'reconciles concurrent NodeSeek notification USER NOT FOUND responses without replaying writes: %s',
  async (outcome) => {
    const { response } = accountClearFixture('nodeseek');
    await saveAccountSessionSnapshot(seedAccount());
    accountClearFixture('yaohuo');
    const probe = Promise.withResolvers<Response>();
    let restored = false;
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (input) => {
      const path = new URL(input).pathname;
      if (path === '/') return restored ? response() : probe.promise;
      if (path === '/api/notification/reply-to-me/list')
        return restored ? json({ replyList: [] }) : json({ error: 'USER NOT FOUND' }, 500);
      if (path === '/api/notification/unread-count')
        return restored ? json({ atMe: 0, reply: 0, message: 0 }) : json({ error: 'USER NOT FOUND' }, 500);
      throw new Error(`Unexpected notification account request: ${input}`);
    });
    const { view, runtime } = await renderSiteRuntime('nodeseek', fetcher);
    // Storage restoration may replace seeded objects before any notification request begins.
    const linuxDo = appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'));
    const yaohuo = appQueryClient.getQueryData(accountQueryKeys.snapshot('yaohuo'));
    expect(linuxDo).toMatchObject({ status: 'logged-in', identityTrust: 'confirmed', currentUser: { id: 'alice' } });
    expect(yaohuo).toMatchObject({ status: 'logged-in', identityTrust: 'confirmed', currentUser: { id: '7' } });
    expect(fetcher).not.toHaveBeenCalled();
    const epoch = runtime().read.forumSessionEpochs.nodeseek;
    const otherEpochs = {
      linuxdo: runtime().read.forumSessionEpochs.linuxdo,
      yaohuo: runtime().read.forumSessionEpochs.yaohuo
    };
    const gateway = createNotificationGateway({
      sourceAllowed: (source) => source === 'nodeseek',
      privateAccessAllowed: (source, identity) => runtime().read.notificationPrivateAccessAllowed(source, identity),
      requestSessionEpoch: (source) => runtime().read.forumSessionEpochs[source],
      onSessionExpired: (source, requestEpoch) => runtime().write.onSessionExpired(source, requestEpoch),
      requestAccountRecheck: (source, requestEpoch, trace) =>
        runtime().write.requestAccountRecheck(source, requestEpoch, trace),
      readAccess: (source) =>
        readForegroundNotificationAccess({
          source,
          session: runtime().read.accountSessionViewModels[source],
          fetcher: runtime().read.notificationFetcher,
          userAgent: runtime().read.getNodeSeekUserAgent()
        })
    });
    const probes = () => fetcher.mock.calls.filter(([url]) => new URL(url).pathname === '/');
    const list = () => gateway.listPage('nodeseek', { categoryId: 'replies', expectedIdentityKey: 'nodeseek:42' });
    try {
      await act(async () => {
        await Promise.all([
          expect(list()).rejects.toMatchObject({ reason: 'account-recheck-required' }),
          expect(gateway.readUnreadSnapshot('nodeseek')).rejects.toMatchObject({ reason: 'account-recheck-required' })
        ]);
      });
      await waitFor(() => expect(probes()).toHaveLength(1));
      await waitFor(() =>
        expect(runtime().read.accountSessionViewModels.nodeseek).toMatchObject({
          isLoggedIn: true,
          identityTrust: 'confirmed',
          isVerifying: true,
          currentUser: { id: '42' }
        })
      );
      expect(runtime().read.forumSessionEpochs.nodeseek).toBe(epoch);
      expect(mockWebViewLoads).toEqual([]);
      await act(async () => {
        probe.resolve(
          outcome === 'anonymous'
            ? new Response('<html><head><meta name="nodeseekAccountState" content="anonymous"></head></html>')
            : outcome === 'unknown'
              ? json({ error: 'TEMPORARY_ERROR' }, 500)
              : response()
        );
      });
      await waitFor(() => expect(runtime().read.accountSessionViewModels.nodeseek.isVerifying).toBe(false));
      expect(runtime().read.accountSessionViewModels.nodeseek).toMatchObject(
        outcome === 'anonymous'
          ? { status: 'verified', isLoggedIn: false, isVerified: true, canWrite: false, identityTrust: 'none' }
          : { status: 'logged-in', isLoggedIn: true, identityTrust: 'confirmed', currentUser: { id: '42' } }
      );
      if (outcome === 'anonymous') expect(runtime().read.accountSessionViewModels.nodeseek.currentUser).toBeUndefined();
      if (outcome === 'unknown') expect(runtime().read.accountSessionViewModels.nodeseek.lastError).toBeTruthy();
      expect(runtime().read.forumSessionEpochs.nodeseek).toBe(epoch + Number(outcome === 'anonymous'));
      expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'))).toBe(linuxDo);
      expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('yaohuo'))).toBe(yaohuo);
      expect(runtime().read.forumSessionEpochs).toMatchObject(otherEpochs);
      expect(events.filter((event) => event.operation === 'account-reconcile' && event.phase === 'intent')).toEqual([
        expect.objectContaining({
          source: 'nodeseek',
          accountCheckTrigger: 'read-failure',
          parentTraceId: expect.any(String)
        })
      ]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'nodeseek',
            operation: 'account-reconcile',
            phase: 'guard',
            reason: 'duplicate'
          })
        ])
      );
      expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname !== '/')).toHaveLength(2);
      if (outcome === 'anonymous') {
        await expect(list()).rejects.toThrow('账号状态已变化');
        expect(fetcher).toHaveBeenCalledTimes(3);
        await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'nodeseek' }));
        expect(probes()).toHaveLength(1);
        restored = true;
        await fireEvent.press(view.getByText('检测登录'));
        await waitFor(() => expect(view.queryByTestId('login-webview')).toBeNull());
        expect(runtime().read.accountSessionViewModels.nodeseek).toMatchObject({
          isLoggedIn: true,
          identityTrust: 'confirmed',
          currentUser: { id: '42' }
        });
        expect(runtime().read.forumSessionEpochs.nodeseek).toBe(epoch + 2);
        expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname !== '/')).toHaveLength(2);
        await act(async () => {
          await expect(list()).resolves.toMatchObject({ items: [], hasMore: false });
          await expect(gateway.readUnreadSnapshot('nodeseek')).resolves.toMatchObject({ total: 0 });
        });
        expect(probes()).toHaveLength(2);
      }
      expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    } finally {
      await act(async () => probe.resolve(response()));
      await view.unmount();
    }
  }
);

it.each(['linuxdo', 'nodeseek'] as const)(
  'ignores stale, disabled, anonymous and login-surface %s recheck requests',
  async (source) => {
    accountClearFixture(source);
    const fetcher = jest.fn(async () => new Response('{}'));
    const hook = await renderRuntime(fetcher, true, [source]);
    const epoch = hook.result.current.read.forumSessionEpochs[source];
    const request = hook.result.current.write.requestAccountRecheck;
    await act(async () => {
      request(source, epoch - 1);
    });
    await hook.rerender({ enabledSources: [] });
    await act(async () => {
      request(source, epoch);
    });
    await hook.rerender({ enabledSources: [source] });
    await act(async () => {
      appQueryClient.setQueryData(accountQueryKeys.snapshot(source), createAccountSessionSnapshot(source));
      hook.result.current.write.requestAccountRecheck(source, epoch);
      appQueryClient.setQueryData(accountQueryKeys.snapshot(source), {
        ...createAccountSessionSnapshot(source),
        identityTrust: 'none'
      });
      hook.result.current.write.requestAccountRecheck(source, epoch);
      accountClearFixture(source);
      if (source === 'linuxdo') await hook.result.current.hosts.showLinuxDoVerification('需要验证');
      else await hook.result.current.center.handleAccountCenterCommand({ type: 'open-login', site: source });
      hook.result.current.write.requestAccountRecheck(source, epoch);
    });
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it.each(['linuxdo', 'nodeseek'] as const)(
  'discards a %s recheck result when its source is disabled while the probe is in flight',
  async (source) => {
    accountClearFixture(source);
    let complete!: (response: Response) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    const hook = await renderRuntime(fetcher, true, [source]);
    const epoch = hook.result.current.read.forumSessionEpochs[source];
    await act(async () => {
      hook.result.current.write.requestAccountRecheck(source, epoch);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await hook.rerender({ enabledSources: [] });
    if (source === 'linuxdo') expect(setLinuxDoCookieResponseBarrier).toHaveBeenLastCalledWith(true, 'source-change');
    await act(async () => {
      complete(
        new Response(
          source === 'linuxdo'
            ? JSON.stringify({ current_user: null })
            : '<meta name="nodeseekAccountState" content="anonymous">'
        )
      );
    });
    expect(appQueryClient.getQueryData(accountQueryKeys.snapshot(source))).toMatchObject({
      status: 'logged-in',
      currentUser: { username: 'alice' }
    });
    expect(hook.result.current.read.forumSessionEpochs[source]).toBe(epoch);
  }
);

it('awaits the native cookie handoff before an explicit refresh after login closes', async () => {
  const fetcher = jest.fn(
    async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
  );
  const hook = await renderRuntime(fetcher);
  await act(async () => {
    await hook.result.current.hosts.showLinuxDoVerification('登录');
  });
  let release!: () => void;
  jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.at(-1)?.slice(0, 3)).toEqual([
    false,
    'surface-close',
    expect.any(Number)
  ]);
  expect(fetcher).not.toHaveBeenCalled();
  const callsBeforeDuplicateClose = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls).toHaveLength(callsBeforeDuplicateClose);
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = hook.result.current.center.handleAccountCenterCommand({ type: 'refresh' });
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    release();
    await refresh;
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
});

it.each(['open-login', 'open-login-with-fill'] as const)(
  'opens the real login host for %s during closing and ignores the previous close receipt',
  async (type) => {
    jest.useFakeTimers();
    const fetcher = jest.fn(
      async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
    );
    const { view, runtime } = await renderManualLogin(fetcher);
    const oldHandoff = Promise.withResolvers<void>();
    try {
      jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => oldHandoff.promise);
      await fireEvent.press(view.getByLabelText('关闭'));
      expect(view.queryByTestId('login-webview')).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
        await runtime().center.handleAccountCenterCommand({ type, site: 'linuxdo' });
        await runtime().center.handleAccountCenterCommand({ type, site: 'linuxdo' });
      });
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(350);
      });
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
      expect(view.getByText('linux.do 登录')).toBeTruthy();
      expect(view.getByTestId('login-webview').props.source.uri).toBe(
        type === 'open-login-with-fill' ? LOGIN_FORM_ADAPTERS.linuxdo.loginUrl : 'https://linux.do/latest'
      );
      if (type === 'open-login-with-fill') {
        await fireEvent(view.getByTestId('login-webview'), 'loadEnd', {
          nativeEvent: { url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl }
        });
        expect(mockWebViewInjectJavaScript).toHaveBeenCalledWith(LOGIN_FORM_ADAPTERS.linuxdo.probeScript(2));
      }
      const newPage = view.getByTestId('login-webview');
      const barriers = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
      await act(async () => {
        oldHandoff.resolve();
      });
      expect(view.getByTestId('login-webview')).toBe(newPage);
      expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls).toHaveLength(barriers);
      expect(fetcher).not.toHaveBeenCalled();
      expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
      await fireEvent.press(view.getByText('检测登录'));
      await waitFor(() =>
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true)
      );
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
    } finally {
      oldHandoff.resolve();
      await view.unmount();
      jest.useRealTimers();
    }
  }
);

it.each(['closePanels', 'closeTopmostSurface'] as const)(
  'retains the new credential fill when %s and the login command share one React batch',
  async (close) => {
    jest.useFakeTimers();
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ current_user: null })));
    const { view, runtime } = await renderManualLogin(fetcher);
    try {
      await act(async () => {
        await runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site: 'linuxdo' });
      });
      await act(async () => {
        runtime().hosts[close]();
        await runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site: 'linuxdo' });
      });
      await act(async () => jest.advanceTimersByTimeAsync(450));
      expect(view.getByTestId('login-webview').props.source.uri).toBe(LOGIN_FORM_ADAPTERS.linuxdo.loginUrl);
      await fireEvent(view.getByTestId('login-webview'), 'loadEnd', {
        nativeEvent: { url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl }
      });
      expect(mockWebViewInjectJavaScript).toHaveBeenCalledWith(LOGIN_FORM_ADAPTERS.linuxdo.probeScript(2));
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  }
);

it('clears a visible credential fill before a later verification surface', async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ current_user: null })));
  const { view, runtime } = await renderManualLogin(fetcher);
  try {
    await act(async () => {
      await runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site: 'linuxdo' });
    });
    await fireEvent.press(view.getByLabelText('关闭'));
    await act(async () => jest.advanceTimersByTimeAsync(450));
    await act(async () => runtime().hosts.showLinuxDoVerification('需要验证'));
    await act(async () => jest.advanceTimersByTimeAsync(100));
    expect(view.getByTestId('login-webview').props.source.uri).toBe('https://linux.do/latest');
    await fireEvent(view.getByTestId('login-webview'), 'loadEnd', {
      nativeEvent: { url: 'https://linux.do/latest' }
    });
    expect(mockWebViewInjectJavaScript.mock.calls).toHaveLength(1);
  } finally {
    await view.unmount();
    jest.useRealTimers();
  }
});

it.each(['navigation', 'background', 'disabled', 'verification'] as const)(
  'clears a queued credential fill on %s before a subsequent verification surface',
  async (exit) => {
    jest.useFakeTimers();
    const fetcher = jest.fn(
      async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
    );
    const { view, runtime, change } = await renderManualLogin(fetcher);
    let verification: Promise<boolean> | undefined;
    try {
      await fireEvent.press(view.getByLabelText('关闭'));
      await act(async () => {
        await runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site: 'linuxdo' });
      });
      if (exit === 'navigation') await act(async () => runtime().hosts.closePanels());
      if (exit === 'background') {
        await change({ active: false });
        await change({ active: true });
      }
      if (exit === 'disabled') {
        await change({ enabled: false });
        await change({ enabled: true });
      }
      if (exit === 'verification') {
        await act(async () => {
          verification = runtime().hosts.showLinuxDoVerification('需要验证');
        });
      }
      await act(async () => jest.advanceTimersByTimeAsync(450));
      if (exit !== 'verification') {
        expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
        await act(async () => runtime().hosts.showLinuxDoVerification('需要验证'));
        await act(async () => jest.advanceTimersByTimeAsync(100));
      } else await verification;
      expect(view.getByTestId('login-webview').props.source.uri).toBe('https://linux.do/latest');
      mockWebViewInjectJavaScript.mockClear();
      await fireEvent(view.getByTestId('login-webview'), 'loadEnd', {
        nativeEvent: { url: 'https://linux.do/latest' }
      });
      expect(mockWebViewInjectJavaScript.mock.calls).toHaveLength(1);
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  }
);

it('reopens the login host during closing after a failed cookie handoff', async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ current_user: null })));
  const { view, runtime } = await renderManualLogin(fetcher);
  try {
    jest.mocked(setLinuxDoCookieResponseBarrier).mockRejectedValueOnce(new Error('disk unavailable'));
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' }));
    await act(async () => jest.advanceTimersByTimeAsync(450));
    expect(view.getByText('linux.do 登录')).toBeTruthy();
    expect(view.getByTestId('login-webview').props.source.uri).toBe('https://linux.do/latest');
    expect(fetcher).not.toHaveBeenCalled();
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
  } finally {
    await view.unmount();
    jest.useRealTimers();
  }
});

it('keeps a new credential fill when manual login replaces a queued verification', async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn(
    async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
  );
  const { view, runtime } = await renderManualLogin(fetcher);
  let verification!: Promise<boolean>;
  try {
    await fireEvent.press(view.getByLabelText('关闭'));
    await act(async () => {
      await runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site: 'linuxdo' });
      verification = runtime().hosts.showLinuxDoVerification('需要验证');
      await runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site: 'linuxdo' });
    });
    await expect(verification).resolves.toBe(false);
    await act(async () => jest.advanceTimersByTimeAsync(450));
    expect(view.getByTestId('login-webview').props.source.uri).toBe(LOGIN_FORM_ADAPTERS.linuxdo.loginUrl);
    await fireEvent(view.getByTestId('login-webview'), 'loadEnd', {
      nativeEvent: { url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl }
    });
    expect(mockWebViewInjectJavaScript).toHaveBeenCalledWith(LOGIN_FORM_ADAPTERS.linuxdo.probeScript(2));
  } finally {
    await view.unmount();
    jest.useRealTimers();
  }
});

it('retries a failed close handoff before the account-center refresh and releases private access only afterward', async () => {
  const fetcher = jest.fn(
    async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
  );
  await AsyncStorage.setItem('account-session.migration.v1', '1');
  const hook = await renderRuntime(fetcher, true);
  await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
  seedAccount();
  await act(async () => {
    await hook.result.current.hosts.showLinuxDoVerification('登录');
  });
  jest.mocked(setLinuxDoCookieResponseBarrier).mockRejectedValueOnce(new Error('disk unavailable'));
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(fetcher).not.toHaveBeenCalled();
  await waitFor(() => expect(hook.result.current.read.statusBusy).toBe(false));
  expect(hook.result.current.read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
  const gate = Promise.withResolvers<void>();
  jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => gate.promise);
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = hook.result.current.center.handleAccountCenterCommand({ type: 'refresh' });
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    gate.resolve();
    await refresh;
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(hook.result.current.read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true);
  await AsyncStorage.removeItem('account-session.migration.v1');
});

it('reconciles an initialized login on close without requiring the detection button and waits for cookie handoff', async () => {
  jest.useFakeTimers();
  const identityFetch = jest.fn(async () => Response.json({ current_user: { id: 'alice', username: 'alice' } }));
  const fetcher: Fetcher = async (url) =>
    url === 'https://linux.do/cdn-cgi/trace' ? new Response('ip=192.0.2.17\nhttp=h2\n') : identityFetch();
  const { view, runtime } = await renderManualLogin(fetcher);
  const handoff = Promise.withResolvers<void>();
  const previousEpoch = runtime().read.forumSessionEpochs.linuxdo;
  try {
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => {
      expect(view.queryByTestId('login-webview')).toBeNull();
      return handoff.promise;
    });
    await fireEvent(view.getByTestId('login-webview'), 'message', {
      nativeEvent: {
        url: 'https://linux.do',
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'https://linux.do/latest:1234',
          userAgent: 'WebView fixture agent',
          status: 'logged-in',
          hasChallengeMarker: false,
          hasSessionInitialization: true
        })
      }
    });
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
    expect(identityFetch).not.toHaveBeenCalled();
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);

    await act(async () => handoff.resolve());
    await waitFor(() => expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true));
    expect(identityFetch).toHaveBeenCalledTimes(1);
    expect(runtime().read.accountSessionViewModels.linuxdo).toMatchObject({
      identityTrust: 'confirmed',
      currentUser: { username: 'alice' }
    });
    expect(runtime().read.forumSessionEpochs.linuxdo).toBe(previousEpoch);
  } finally {
    handoff.resolve();
    await view.unmount();
    jest.useRealTimers();
  }
});

it('closes an unfinished login immediately without confirming its identity or releasing private access', async () => {
  jest.useFakeTimers();
  const identityFetch = jest.fn(async () => Response.json({ current_user: { id: 'alice', username: 'alice' } }));
  const fetcher: Fetcher = async (url) =>
    url === 'https://linux.do/cdn-cgi/trace' ? new Response('ip=192.0.2.17\nhttp=h2\n') : identityFetch();
  const { view, runtime } = await renderManualLogin(fetcher);
  try {
    await fireEvent(view.getByTestId('login-webview'), 'message', {
      nativeEvent: {
        url: 'https://linux.do',
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'https://linux.do/latest:1234',
          userAgent: 'WebView fixture agent',
          status: 'logged-in',
          hasChallengeMarker: false,
          hasSessionInitialization: false
        })
      }
    });
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
    await act(async () => jest.advanceTimersByTimeAsync(450));
    expect(identityFetch).not.toHaveBeenCalled();
    expect(runtime().read.accountSessionViewModels.linuxdo).toMatchObject({
      identityTrust: 'unknown',
      currentUser: { username: 'alice' }
    });
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
    expect(runtime().read.readGateway.getReadPlan('linuxdo', 'account-data')).toMatchObject({
      state: 'blocked',
      reason: 'identity-pending'
    });
    expect(runtime().read.readGateway.getReadPlan('linuxdo', 'topic')).toMatchObject({
      state: 'ready',
      lane: 'public',
      transport: 'native-clearance-only'
    });
  } finally {
    await view.unmount();
    jest.useRealTimers();
  }
});

it('retries an unknown identity on close after login initialization already passed', async () => {
  jest.useFakeTimers();
  const fetcher = jest
    .fn(async () => Response.json({ current_user: { id: 'alice', username: 'alice' } }))
    .mockRejectedValueOnce(new Error('offline'));
  const { view, runtime } = await renderManualLogin(fetcher);
  try {
    await fireEvent.press(view.getByText('检测登录'));
    await waitFor(() => expect(view.getByText(/登录状态暂时无法确认/)).toBeTruthy());
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
    await fireEvent.press(view.getByLabelText('关闭'));
    await waitFor(() => expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
    jest.useRealTimers();
  }
});

it('keeps the login page mounted until website initialization and its session cookies can hand off before identity verification', async () => {
  jest.useFakeTimers();
  const identityFetch = jest.fn(async () => Response.json({ current_user: { id: 'alice', username: 'alice' } }));
  const fetcher: Fetcher = async (url) => {
    if (url === 'https://linux.do/session/current.json') return identityFetch();
    if (url === 'https://linux.do/cdn-cgi/trace')
      return new Response('ip=192.0.2.17\nhttp=h2\n', { headers: { 'content-type': 'text/plain' } });
    throw new Error(`Unexpected request ${url}`);
  };
  const { view, runtime } = await renderManualLogin(fetcher);
  const nativeCookies = jest.mocked(readManagedCookieHeader);
  const previousCookieRead = nativeCookies.getMockImplementation()!;
  const handoff = Promise.withResolvers<void>();
  try {
    jest
      .mocked(waitForLinuxDoLoginInitialization)
      .mockImplementationOnce(
        jest.requireActual<typeof import('@/platform/network/linuxDoLoginInitialization')>(
          '@/platform/network/linuxDoLoginInitialization'
        ).waitForLinuxDoLoginInitialization
      );
    nativeCookies.mockResolvedValue({ status: 'ok', header: '_t=fixture-auth' });
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => {
      expect(view.queryByTestId('login-webview')).toBeNull();
      return handoff.promise;
    });
    const webView = view.getByTestId('login-webview');
    const pageMessage = (hasSessionInitialization: boolean) => ({
      nativeEvent: {
        url: 'https://linux.do',
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'https://linux.do/latest:1234',
          userAgent: 'WebView fixture agent',
          status: 'logged-in',
          hasChallengeMarker: false,
          hasSessionInitialization
        })
      }
    });
    await fireEvent(webView, 'message', pageMessage(false));
    await fireEvent.press(view.getByText('检测登录'));
    await act(async () => jest.advanceTimersByTimeAsync(100));
    expect(view.getByText('正在检测…')).toBeTruthy();
    expect(view.getByTestId('login-webview')).toBe(webView);
    expect(identityFetch).not.toHaveBeenCalled();

    await fireEvent(webView, 'message', pageMessage(true));
    await act(async () => jest.advanceTimersByTimeAsync(100));
    expect(view.getByTestId('login-webview')).toBe(webView);
    expect(identityFetch).not.toHaveBeenCalled();

    nativeCookies.mockResolvedValue({ status: 'ok', header: '_t=fixture-auth; _rt=fixture-runtime' });
    await act(async () => jest.advanceTimersByTimeAsync(100));
    await waitFor(() => expect(view.queryByTestId('login-webview')).toBeNull());
    expect(view.getByText('正在检测…')).toBeTruthy();
    expect(identityFetch).not.toHaveBeenCalled();
    await act(async () => handoff.resolve());
    await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
    expect(identityFetch).toHaveBeenCalledTimes(1);
  } finally {
    handoff.resolve();
    await view.unmount();
    nativeCookies.mockImplementation(previousCookieRead);
    jest.useRealTimers();
  }
});

it.each(['alice', 'bob'])(
  'hands off cookies before manual verification of %s and keeps native renewal enabled',
  async (username) => {
    jest.useFakeTimers();
    let release!: () => void;
    const identityHandoff = Promise.withResolvers<void>();
    let blocked = true;
    let cookie = 'A';
    const fetcher = jest.fn(async () => {
      // The native receiver owns response cookies; an open WebView barrier rejects renewal.
      if (!blocked) cookie = 'B';
      return new Response(JSON.stringify({ current_user: { id: username, username } }));
    });
    const { view, runtime } = await renderManualLogin(fetcher);
    try {
      jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(async () => {
        expect(view.queryByTestId('login-webview')).toBeNull();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        blocked = false;
      });
      if (username === 'bob') {
        // Native barrier calls share one worker; the final handoff joins identity-change.
        jest
          .mocked(setLinuxDoCookieResponseBarrier)
          .mockImplementationOnce(() => identityHandoff.promise)
          .mockImplementationOnce(() => identityHandoff.promise);
      }
      await fireEvent.press(view.getByText('检测登录'));
      await waitFor(() => expect(view.queryByTestId('login-webview')).toBeNull());
      expect(view.getByText('正在检测…')).toBeTruthy();
      expect(view.getByLabelText('刷新页面').props.accessibilityState.disabled).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      await act(async () => {
        release();
      });
      if (username === 'bob') {
        expect(view.getByText('正在检测…')).toBeTruthy();
        await act(async () => {
          identityHandoff.resolve();
        });
      }
      await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cookie).toBe('B');
      expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.at(-1)?.[0]).toBe(false);
    } finally {
      release?.();
      identityHandoff.resolve();
      await view.unmount();
      jest.useRealTimers();
    }
  }
);

it.each(['background', 'disabled', 'close', 'failure'] as const)(
  'settles a pending manual cookie handoff on %s without an obsolete identity request',
  async (exit) => {
    jest.useFakeTimers();
    const fetcher = jest.fn(
      async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
    );
    const { view, runtime, change } = await renderManualLogin(fetcher);
    const gate = Promise.withResolvers<void>();
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(async () => {
      await gate.promise;
      if (exit === 'failure') throw new Error('disk unavailable');
    });
    try {
      await fireEvent.press(view.getByText('检测登录'));
      await fireEvent.press(view.getByText('正在检测…'));
      expect(fetcher).not.toHaveBeenCalled();
      if (exit === 'background') await change({ active: false });
      if (exit === 'disabled') await change({ enabled: false });
      if (exit === 'close') await fireEvent.press(view.getByLabelText('关闭'));
      await act(async () => {
        gate.resolve();
      });
      expect(fetcher).toHaveBeenCalledTimes(exit === 'close' ? 1 : 0);
      if (exit === 'background' || exit === 'failure') {
        if (exit === 'background') await change({ active: true });
        if (exit === 'failure') {
          expect(view.getByText(/disk unavailable/)).toBeTruthy();
          await fireEvent.press(view.getByText('重新打开登录页'));
          await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
        }
        await fireEvent.press(view.getByText('检测登录'));
        await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
        expect(fetcher).toHaveBeenCalledTimes(1);
      } else expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
    } finally {
      gate.resolve();
      await view.unmount();
      jest.useRealTimers();
    }
  }
);
