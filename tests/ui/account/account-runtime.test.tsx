import { seedLinuxDoAccount } from '../seedLinuxDoAccount';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryObserver } from '@tanstack/react-query';
import { createRoot } from 'test-renderer';
import { useLayoutEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import { PortalProvider } from '@gorhom/portal';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { resolveReaderStyleSettings, createTheme } from '@/ui/theme/tokens';
import { NativeModules } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as legacyCookieMigration from '@/platform/storage/legacyCookieSnapshotMigration';
import { markAccountSessionHandoffPending, saveAccountSessionSnapshot } from '@/platform/storage/accountSessionStore';
import * as accountSessionStore from '@/platform/storage/accountSessionStore';
import { credentialVault, emptyCredentialSummaries } from '@/platform/storage/credentialVault';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { useAccountCredentialController } from '@/features/account/useAccountCredentialController';
import { useLinuxDoCredit } from '@/features/more/useLinuxDoCredit';
import { NodeSeekServicesPanel } from '@/features/more/components/NodeSeekServicesPanel';
import { nativeSecureRandomHex } from '@/platform/android/secureRandom';
import { accountQueryKeys, appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { resumeInfiniteQueryPage } from '@/platform/query/useFirstPageInfiniteQuery';
import { DEFAULT_SEARCH_FILTERS } from '@/domain/forum/searchFilters';
import { discourseReadingQueryKey } from '@/platform/query/discourseReadingRuntime';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { readManagedCookieHeader, setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import * as accountRead from '@/sources/accountRead';
import { waitForLinuxDoLoginInitialization } from '@/platform/network/linuxDoLoginInitialization';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { createNotificationGateway } from '@/sources/notificationGateway';
import { readForegroundNotificationAccess } from '@/sources/notificationForegroundAccess';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import type { SearchResponse, Source } from '@/domain/forum/models';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { fireEvent, render } from '../render';
import {
  verificationRecoveryProofModes,
  verifyRecoveryProof
} from '../../../dev/review-remediation-proof/verificationRecoveryProof';

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
        () => ({
          stopLoading: mockWebViewStopLoading,
          injectJavaScript: mockWebViewInjectJavaScript,
          reload: () => undefined,
          postMessage: mockWebViewPostMessage
        }),
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
const mockWebViewPostMessage = jest.fn<void, [string]>();
const mockWebViewStopLoading = jest.fn<void, []>();
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
async function renderRuntime(fetcher: Fetcher, ready = true, enabledSources: readonly Source[] = ['linuxdo']) {
  await saveAccountSessionSnapshot(seedLinuxDoAccount());
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
  mockWebViewPostMessage.mockReset();
  mockWebViewStopLoading.mockReset();
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
    await saveAccountSessionSnapshot(seedLinuxDoAccount());
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

  it.each(['manual', 'silent'] as const)(
    'finishes Credit %s close when the physical stop command throws',
    async (mode) => {
      const { view, runtime } = await renderCreditHosts();
      let settled = mode === 'manual';
      try {
        await act(async () => {
          if (mode === 'manual') await runtime().center.linuxDoCredit.open();
          else
            void runtime()
              .center.linuxDoCredit.connectSilently()
              .then(() => (settled = true));
        });
        const browser = view.getByTestId('login-webview', { includeHiddenElements: true });
        const failure = new Error('controlled physical stop failure');
        mockWebViewStopLoading.mockImplementationOnce(() => {
          throw failure;
        });
        await act(async () => {
          let thrown: unknown;
          try {
            if (mode === 'manual') runtime().hosts.closeTopmostSurface();
            else browser.props.onMessage(authMessage('complete'));
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBe(failure);
        });
        expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
        await waitFor(() => expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false));
        await waitFor(() => expect(settled).toBe(true));
        expect(runtime().center.linuxDoCredit.busy).toBe(false);
        expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('alice');
      } finally {
        await view.unmount();
      }
    }
  );

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
          seedLinuxDoAccount('bob');
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
      seedLinuxDoAccount('bob');
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

  it('preserves the main Credit page HTTP failure after its load-end event', async () => {
    const { view, runtime } = await renderCreditHosts();
    await act(async () => runtime().center.linuxDoCredit.open());
    const browser = view.getByTestId('login-webview', { includeHiddenElements: true });
    const failed = { nativeEvent: { url: 'https://credit.linux.do/home', statusCode: 500 } };
    await fireEvent(browser, 'httpError', failed);
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: failed.nativeEvent.url } });
    expect(view.getByText(/HTTP 500/)).toBeTruthy();
  });

  it('keeps the visible Credit homepage operable without an App error banner on top-level HTTP 403', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () =>
      Response.json({ current_user: { id: 7, username: 'alice' } })
    );
    const { view, runtime } = await renderCreditHosts(fetcher);
    await act(async () => runtime().center.linuxDoCredit.open());
    const browser = view.getByTestId('login-webview');
    const homeUrl = 'https://credit.linux.do/home';
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: homeUrl, loading: true } });
    await fireEvent(browser, 'httpError', { nativeEvent: { url: homeUrl, statusCode: 403 } });
    await fireEvent(browser, 'loadStart', { nativeEvent: { url: homeUrl, loading: true } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: homeUrl } });

    expect(view.getByTestId('login-webview')).toBe(browser);
    expect(view.queryByText('正在打开 LDC…')).toBeNull();
    expect(view.queryByText(/HTTP 403/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('完成并刷新'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false));
  });

  it('shows the visible Credit error banner for non-home HTTP 403 and other HTTP or network failures across POST and redirects', async () => {
    const { view, runtime } = await renderCreditHosts();
    await act(async () => runtime().center.linuxDoCredit.open());
    const browser = view.getByTestId('login-webview');

    const nonHome403 = 'https://credit.linux.do/oauth/callback';
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: nonHome403, loading: true } });
    await fireEvent(browser, 'httpError', { nativeEvent: { url: nonHome403, statusCode: 403 } });
    await fireEvent(browser, 'loadStart', { nativeEvent: { url: nonHome403, loading: true } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: nonHome403 } });
    expect(view.getByText(/HTTP 403/)).toBeTruthy();

    const nonHome500 = 'https://connect.linux.do/oauth2/authorize';
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: nonHome500, loading: true } });
    await fireEvent(browser, 'httpError', { nativeEvent: { url: nonHome500, statusCode: 500 } });
    await fireEvent(browser, 'loadStart', { nativeEvent: { url: nonHome500, loading: true } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: nonHome500 } });
    expect(view.getByText(/HTTP 500/)).toBeTruthy();

    await fireEvent(browser, 'mainFrameLoadStart', {
      nativeEvent: { url: 'https://credit.linux.do/home', loading: true }
    });
    await fireEvent(browser, 'error', { nativeEvent: { description: 'net::ERR_CONNECTION_RESET' } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: 'https://credit.linux.do/home', code: -2 } });
    expect(view.getByText(/net::ERR_CONNECTION_RESET/)).toBeTruthy();
  });

  it('ignores stale authorization page HTTP errors and history callbacks after navigating back to the Credit homepage', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () =>
      Response.json({ current_user: { id: 7, username: 'alice' } })
    );
    const { view, runtime } = await renderCreditHosts(fetcher);
    await act(async () => runtime().center.linuxDoCredit.open());
    const browser = view.getByTestId('login-webview');
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
    const callbackUrl = 'https://credit.linux.do/oauth/callback?code=stale';
    const homeUrl = 'https://credit.linux.do/home';

    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: authUrl, loading: true } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: authUrl } });
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: homeUrl, loading: true } });
    await fireEvent(browser, 'httpError', { nativeEvent: { url: authUrl, statusCode: 403 } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: homeUrl } });
    await fireEvent(browser, 'loadStart', { nativeEvent: { url: authUrl, loading: true } });
    await fireEvent(browser, 'httpError', { nativeEvent: { url: authUrl, statusCode: 403 } });

    expect(view.getByTestId('login-webview')).toBe(browser);
    expect(view.queryByText('正在打开 LDC…')).toBeNull();
    expect(view.queryByText(/HTTP 403/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await fireEvent(browser, 'httpError', { nativeEvent: { url: callbackUrl, statusCode: 500 } });
    expect(view.queryByText(/HTTP 500/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await fireEvent(browser, 'httpError', { nativeEvent: { url: homeUrl, statusCode: 500 } });
    expect(view.queryByText(/HTTP 500/)).toBeNull();
    // A new main-frame load can receive its HTTP response before committing the same URL.
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: homeUrl, loading: true } });
    expect(view.getByText(/HTTP 500/)).toBeTruthy();

    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: homeUrl, loading: true } });
    await fireEvent(browser, 'httpError', { nativeEvent: { url: homeUrl, statusCode: 403 } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: homeUrl } });
    expect(view.queryByText(/HTTP 403/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await fireEvent.press(view.getByLabelText('完成并刷新'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false));
  });

  it('does not let a stale authorization page loadEnd rewind ownership or expose a late HTTP 403 on the homepage', async () => {
    const { view, runtime } = await renderCreditHosts();
    await act(async () => runtime().center.linuxDoCredit.open());
    const browser = view.getByTestId('login-webview');
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
    const homeUrl = 'https://credit.linux.do/home';

    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: authUrl, loading: true } });
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: homeUrl, loading: true } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: authUrl } });
    await fireEvent(browser, 'httpError', { nativeEvent: { url: authUrl, statusCode: 403 } });

    expect(view.getByTestId('login-webview')).toBe(browser);
    expect(view.getByText('正在打开 LDC…')).toBeTruthy();
    expect(view.queryByText(/HTTP 403/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: homeUrl } });
    expect(view.queryByText('正在打开 LDC…')).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();
  });

  it('ignores confirmed retired authorization network errors while keeping current and ambiguous same-URL errors', async () => {
    const { view, runtime } = await renderCreditHosts();
    await act(async () => runtime().center.linuxDoCredit.open());
    const browser = view.getByTestId('login-webview');
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
    const homeUrl = 'https://credit.linux.do/home';

    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: authUrl, loading: true } });
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: homeUrl, loading: true } });
    const loadingStalePreventDefault = jest.fn();
    await fireEvent(browser, 'error', {
      nativeEvent: { url: authUrl, description: 'net::ERR_ABORTED' },
      preventDefault: loadingStalePreventDefault
    });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: authUrl, code: -3 } });

    expect(loadingStalePreventDefault).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('login-webview')).toBe(browser);
    expect(view.getByText('正在打开 LDC…')).toBeTruthy();
    expect(view.queryByText(/ERR_ABORTED/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: homeUrl } });
    expect(view.queryByText('正在打开 LDC…')).toBeNull();

    const settledStalePreventDefault = jest.fn();
    await fireEvent(browser, 'error', {
      nativeEvent: { url: authUrl, description: 'net::ERR_ABORTED' },
      preventDefault: settledStalePreventDefault
    });
    expect(settledStalePreventDefault).toHaveBeenCalledTimes(1);
    expect(view.queryByText(/ERR_ABORTED/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    // Navigating back to previously retired authUrl makes same-URL error ownership ambiguous -> retain native handling.
    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: authUrl, loading: true } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: authUrl } });
    const ambiguousPreventDefault = jest.fn();
    await fireEvent(browser, 'error', {
      nativeEvent: { url: authUrl, description: 'net::ERR_CONNECTION_RESET' },
      preventDefault: ambiguousPreventDefault
    });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: authUrl, code: -2 } });
    expect(ambiguousPreventDefault).not.toHaveBeenCalled();
    expect(view.getByText(/net::ERR_CONNECTION_RESET/)).toBeTruthy();
  });

  it('shows a pre-onLoadStart network error after approving an official Credit authorization navigation', async () => {
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () =>
      Response.json({ current_user: { id: 7, username: 'alice' } })
    );
    const { view, runtime } = await renderCreditHosts(fetcher);
    await act(async () => runtime().center.linuxDoCredit.open());
    const browser = view.getByTestId('login-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';

    await fireEvent(browser, 'mainFrameLoadStart', { nativeEvent: { url: homeUrl, loading: true } });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: homeUrl } });

    expect(browser.props.onShouldStartLoadWithRequest({ url: authUrl, isTopFrame: true })).toBe(true);
    const pendingPreventDefault = jest.fn();
    await fireEvent(browser, 'error', {
      nativeEvent: { url: authUrl, code: -2, description: 'net::ERR_NAME_NOT_RESOLVED' },
      preventDefault: pendingPreventDefault
    });
    await fireEvent(browser, 'loadEnd', { nativeEvent: { url: authUrl, code: -2 } });

    expect(pendingPreventDefault).not.toHaveBeenCalled();
    expect(view.getByText('LDC 页面加载失败：net::ERR_NAME_NOT_RESOLVED')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
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
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
          false
        );
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
          expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
            true
          )
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
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
          true
        );
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
          expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
            true
          )
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
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
          false
        );
        if (outcome === 'replaced') {
          expect(fetcher).not.toHaveBeenCalled();
          expect(jest.mocked(setLinuxDoCookieResponseBarrier)).not.toHaveBeenCalled();
          await fireEvent.press(view.getByLabelText('关闭'));
          expect(fetcher).not.toHaveBeenCalled();
          await act(async () => {
            await runtime().center.handleAccountCenterCommand({ type: 'refresh' });
          });
          await waitFor(() =>
            expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
              true
            )
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
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(false);
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
    await waitFor(() =>
      expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(true)
    );
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

  it('does not dispatch a retired cookie preparation after a replacement runtime starts', async () => {
    const marker = Promise.withResolvers<void>();
    const mark = jest
      .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
      .mockImplementationOnce(() => marker.promise);
    const fetcher = jest.fn(async () => Response.json({ current_user: { id: 7, username: 'alice' } }));
    const first = await renderCreditHosts(fetcher);
    let opening!: Promise<void>;
    await act(async () => {
      opening = first.runtime().center.linuxDoCredit.open();
    });
    expect(first.view.queryByTestId('login-webview')).toBeNull();
    await first.view.unmount();
    const second = await renderCreditHosts(fetcher);
    const barrierCount = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
    try {
      await act(async () => {
        marker.resolve();
        await opening;
      });

      expect(
        jest
          .mocked(setLinuxDoCookieResponseBarrier)
          .mock.calls.slice(barrierCount)
          .map(([blocked, reason]) => [blocked, reason])
      ).not.toContainEqual([true, 'surface-open']);
      expect(second.view.queryByTestId('login-webview')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.at(-1)?.slice(0, 2)).toEqual([false, 'startup']);
    } finally {
      marker.resolve();
      mark.mockRestore();
      await second.view.unmount();
    }
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
          seedLinuxDoAccount('bob');
        });
      await waitFor(() => expect(runtime().hosts.surfaces.linuxdoCredit).toBe(false));
      expect(
        view.queryAllByTestId('login-webview').some((page) => page.props.source.uri === 'https://credit.linux.do/home')
      ).toBe(false);
      await act(async () => {
        oldPage.props.onMainFrameLoadStart({ nativeEvent: { url: 'https://credit.linux.do/home', loading: true } });
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
    const barrier = jest.mocked(setLinuxDoCookieResponseBarrier);
    const defaultBarrier = barrier.getMockImplementation();
    try {
      await rerender({ blockedMessage: '代理尚未就绪' });
      barrier.mockRejectedValueOnce(new Error('controlled Credit preparation failure'));
      await act(async () => runtime().center.linuxDoCredit.open());
      expect(view.getByText('代理尚未就绪')).toBeTruthy();
      expect(view.queryByTestId('login-webview')).toBeNull();
      await rerender({});
      expect(view.getByText('LDC 页面准备失败，请刷新重试。')).toBeTruthy();
      expect(view.queryByTestId('login-webview')).toBeNull();
      expect(view.getByLabelText('刷新页面').props.accessibilityState.disabled).toBe(false);
      await fireEvent.press(view.getByLabelText('刷新页面'));
      const browser = view.getByTestId('login-webview');
      await fireEvent(browser, 'error', { nativeEvent: { description: '网络不可用' } });
      expect(view.getByText('LDC 页面加载失败：网络不可用')).toBeTruthy();
      expect(fetcher).not.toHaveBeenCalled();
      expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('alice');
    } finally {
      barrier.mockReset();
      if (defaultBarrier) barrier.mockImplementation(defaultBarrier);
      await view.unmount();
    }
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
      ({
        settingsReady,
        sources = enabledSources,
        contentSourcesReady = settingsReady
      }: {
        settingsReady: boolean;
        sources?: readonly Source[];
        contentSourcesReady?: boolean;
      }) =>
        useAccountRuntime({
          appActive: true,
          contentSourcesReady,
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

  it('keeps cookie reads on the startup path when restored preferences first enable linux.do', async () => {
    const hook = await startIdentityRuntime(false, []);
    const barrier = jest.mocked(setLinuxDoCookieResponseBarrier);
    expect(barrier).toHaveBeenCalledWith(true, 'startup');
    await hook.rerender({ settingsReady: true, sources: [], contentSourcesReady: false });
    await hook.rerender({ settingsReady: true, sources: ['linuxdo'] });
    expect(barrier).toHaveBeenLastCalledWith(false, 'startup');
    await hook.rerender({ settingsReady: true, sources: [] });
    expect(barrier).toHaveBeenLastCalledWith(true, 'source-change');
  });

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

  it('offers startup retry when a disabled site never returns its saved user agent and ignores its late value', async () => {
    jest.useFakeTimers();
    const old = Promise.withResolvers<string | null>();
    let first = true;
    storageRead.mockImplementation((key: string) => {
      if (key !== 'nodeseek-user-agent') return Promise.resolve(null);
      if (!first) return Promise.resolve('Current user agent');
      first = false;
      return old.promise;
    });
    const hook = await startIdentityRuntime(true, []);
    try {
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      expect(hook.result.current.read.sessionsReady).toBe(false);
      expect(hook.result.current.hosts.startupRecovery).not.toBeNull();
      await retryIdentityRecovery(hook.result.current);
      await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
      await act(async () => old.resolve('Stale user agent'));
      expect(hook.result.current.read.getNodeSeekUserAgent()).toBe('Current user agent');
      expect(hook.fetcher).not.toHaveBeenCalled();
    } finally {
      old.resolve(null);
      await hook.unmount();
      jest.useRealTimers();
    }
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

  it('offers startup retry when persisted account records cannot be read', async () => {
    const marker = 'account-session.migration.v1';
    const read = AsyncStorage.getItem.bind(AsyncStorage);
    let unavailable = true;
    const reader = jest.spyOn(AsyncStorage, 'getItem').mockImplementation((key) => {
      if (unavailable && key === marker) return Promise.reject(new Error('private storage failure'));
      return read(key);
    });
    const hook = await startIdentityRuntime();
    try {
      await waitFor(() => expect(hook.result.current.hosts.startupRecovery).not.toBeNull());
      expect(hook.result.current.read.sessionsReady).toBe(false);
      expect(reader.mock.calls.filter(([key]) => key === marker)).toHaveLength(2);
      expect(await read(marker)).toBe('1');
      unavailable = false;
      const recovery = await render(hook.result.current.hosts.startupRecovery!, { wrapper: QueryTestWrapper });
      try {
        await fireEvent.press(recovery.getByRole('button', { name: '重试启动' }));
        await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
        expect(hook.result.current.hosts.startupRecovery).toBeNull();
        expect(hook.fetcher).not.toHaveBeenCalled();
        expect(readManagedCookieHeader).not.toHaveBeenCalled();
      } finally {
        await recovery.unmount();
      }
    } finally {
      await hook.unmount();
      reader.mockRestore();
    }
  });

  it('offers startup retry when legacy identity confirmation stalls and ignores its late completion', async () => {
    jest.useFakeTimers();
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'linuxdo-clearance' ? JSON.stringify({ userAgent: 'Legacy UA' }) : null)
    );
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof readManagedCookieHeader>>>();
    jest.mocked(readManagedCookieHeader).mockReturnValueOnce(pending.promise);
    const hook = await startIdentityRuntime(true, ['linuxdo']);
    try {
      expect(readManagedCookieHeader).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      expect(hook.result.current.read.sessionsReady).toBe(false);
      expect(hook.result.current.hosts.startupRecovery).not.toBeNull();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      await retryIdentityRecovery(hook.result.current);
      await waitFor(() => expect(hook.result.current.read.sessionsReady).toBe(true));
      await act(async () => pending.resolve({ status: 'ok', header: '' }));
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
      expect(hook.fetcher).not.toHaveBeenCalled();
    } finally {
      pending.resolve({ status: 'unsupported' });
      await hook.unmount();
      jest.useRealTimers();
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

  it('does not restart restored identity from a retained recovery action', async () => {
    storageRead.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(null);
    const { result } = await startIdentityRuntime();
    await waitFor(() => expect(result.current.hosts.startupRecovery).not.toBeNull());
    const retained = await render(result.current.hosts.startupRecovery!, { wrapper: QueryTestWrapper });
    try {
      await fireEvent.press(retained.getByText('重试启动'));
      await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
      storageRead.mockClear();
      await fireEvent.press(retained.getByText('重试启动'));
      expect(result.current.read.sessionsReady).toBe(true);
      expect(storageRead.mock.calls.filter(([key]) => String(key).endsWith('-user-agent'))).toHaveLength(0);
    } finally {
      await retained.unmount();
    }
  });

  it('keeps one pending legacy retry when a retained recovery action is pressed again', async () => {
    storageRead.mockImplementation((key: string) =>
      Promise.resolve(key === 'linuxdo-clearance' ? JSON.stringify({ userAgent: 'Legacy Linux UA' }) : null)
    );
    const native = jest.mocked(readManagedCookieHeader);
    const previous = native.getMockImplementation()!;
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof readManagedCookieHeader>>>();
    native.mockResolvedValueOnce({ status: 'unsupported' }).mockImplementation(() => pending.promise);
    const { result } = await startIdentityRuntime(true, ['linuxdo']);
    await waitFor(() => expect(result.current.hosts.startupRecovery).not.toBeNull());
    const retained = await render(result.current.hosts.startupRecovery!, { wrapper: QueryTestWrapper });
    try {
      await fireEvent.press(retained.getByText('重试启动'));
      await waitFor(() => expect(native).toHaveBeenCalledTimes(2));
      expect(result.current.hosts.startupRecovery).not.toBeNull();
      await fireEvent.press(retained.getByText('重试启动'));
      expect(native).toHaveBeenCalledTimes(2);
      await act(async () => pending.resolve({ status: 'ok', header: '' }));
      await waitFor(() => expect(result.current.read.sessionsReady).toBe(true));
      expect(result.current.read.getLinuxDoUserAgent()).toBe('Legacy Linux UA');
    } finally {
      await act(async () => pending.resolve({ status: 'ok', header: '' }));
      await retained.unmount();
      native.mockImplementation(previous);
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
    seedLinuxDoAccount();
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
    seedLinuxDoAccount();
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
    seedLinuxDoAccount();
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
  seedLinuxDoAccount();
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
  screen: 'topic' | 'more' = 'topic',
  initiallyEnabled = true
) {
  let runtime!: ReturnType<typeof useAccountRuntime>;
  const notify = jest.fn();
  function Harness({
    active = true,
    enabled = true,
    notifyCallback = notify
  }: {
    active?: boolean;
    enabled?: boolean;
    notifyCallback?: (message: string) => void;
  }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? [source] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: notifyCallback,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen,
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  const view = await render(<Harness enabled={initiallyEnabled} />, { wrapper: QueryTestWrapper });
  await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
  return {
    view,
    runtime: () => runtime,
    notify,
    changeNotify: (notifyCallback: (message: string) => void) =>
      view.rerender(<Harness notifyCallback={notifyCallback} />),
    active: (active: boolean) => view.rerender(<Harness active={active} />),
    enabled: (enabled: boolean) => view.rerender(<Harness enabled={enabled} />)
  };
}

it.each(['credential-read', 'probe-message'] as const)(
  'allows a fresh NodeSeek fill after reload invalidates an old %s',
  async (interruption) => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof credentialVault.readForFill>>>();
    const saved = { site: 'nodeseek' as const, account: 'local-fixture', password: 'local-fixture', updatedAt: 1 };
    const read = jest.spyOn(credentialVault, 'readForFill').mockResolvedValue(saved);
    if (interruption === 'credential-read') read.mockReturnValueOnce(pending.promise);
    const summary = jest
      .spyOn(credentialVault, 'getSummary')
      .mockImplementation(async (site) =>
        site === 'nodeseek'
          ? { site, state: 'saved', hasCredential: true, protection: 'device' }
          : emptyCredentialSummaries()[site]
      );
    const { view, runtime, notify } = await renderSiteRuntime('nodeseek', async () => {
      throw new Error('Unexpected request while filling the login form');
    });
    const url = LOGIN_FORM_ADAPTERS.nodeseek.loginUrl;
    const webView = () => view.getByTestId('login-webview');
    const toolbar = () => view.getByLabelText('填入已保存登录信息');
    const completePage = async () => {
      await act(async () => webView().props.onMainFrameLoadStart({ nativeEvent: { url, loading: true } }));
      await act(async () => webView().props.onLoadEnd({ nativeEvent: { url, loading: false } }));
    };
    const emitMessage = (type: 'probe' | 'fill', attempt: number) =>
      act(async () =>
        webView().props.onMessage({
          nativeEvent: {
            url,
            data: JSON.stringify({ type: `login-form-${type}`, site: 'nodeseek', attempt, ok: true, url })
          }
        })
      );
    try {
      await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'nodeseek' }));
      await waitFor(() => expect(webView()).toBeTruthy());
      await completePage();
      await fireEvent.press(toolbar());
      expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(1);
      if (interruption === 'credential-read') await emitMessage('probe', 1);
      const readsBeforeReload = interruption === 'credential-read' ? 1 : 0;
      expect(read).toHaveBeenCalledTimes(readsBeforeReload);

      mockWebViewInjectJavaScript.mockClear();
      await fireEvent.press(view.getByLabelText('刷新页面'));
      await completePage();
      await act(async () => pending.resolve(saved));
      await emitMessage('probe', 1);
      await emitMessage('fill', 1);
      expect(read).toHaveBeenCalledTimes(readsBeforeReload);
      expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(0);
      expect(notify).not.toHaveBeenCalled();

      await fireEvent.press(toolbar());
      expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(1);
      await emitMessage('probe', 2);
      expect(read).toHaveBeenCalledTimes(readsBeforeReload + 1);
      expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(2);
      await emitMessage('fill', 2);
      expect(notify).toHaveBeenCalledWith('已填入保存的登录信息，请完成验证后手动提交。');
    } finally {
      pending.resolve(null);
      read.mockRestore();
      summary.mockRestore();
      await view.unmount();
    }
  }
);

it('discards a linux.do credential read when its login document is replaced', async () => {
  const site = 'linuxdo';
  const url = LOGIN_FORM_ADAPTERS[site].loginUrl;
  const saved = { site, account: 'local-fixture', password: 'local-fixture', updatedAt: 1 } as const;
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof credentialVault.readForFill>>>();
  const read = jest.spyOn(credentialVault, 'readForFill').mockReturnValueOnce(pending.promise).mockResolvedValue(saved);
  const { view, runtime } = await renderSiteRuntime(site, async () => {
    throw new Error('Unexpected request while filling the login form');
  });
  const webView = () => view.getByTestId('login-webview');
  const load = () => act(async () => webView().props.onLoadEnd({ nativeEvent: { url, loading: false } }));
  const probe = (attempt: number) =>
    act(async () =>
      webView().props.onMessage({
        nativeEvent: { url, data: JSON.stringify({ type: 'login-form-probe', site, attempt, ok: true, url }) }
      })
    );
  const fills = () => mockWebViewInjectJavaScript.mock.calls.filter(([script]) => script.includes('login-form-fill'));
  try {
    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site }));
    await waitFor(() => expect(webView()).toBeTruthy());
    await load();
    await probe(1);
    expect(read).toHaveBeenCalledTimes(1);

    const mounted = mockWebViewLoads.length;
    await fireEvent.press(view.getByLabelText('刷新页面'));
    await waitFor(() => expect(mockWebViewLoads).toHaveLength(mounted + 1));
    await load();
    await act(async () => pending.resolve(saved));
    expect(fills().length).toBe(0);

    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site }));
    await waitFor(() => expect(webView()).toBeTruthy());
    await load();
    await probe(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(fills().length).toBe(1);
  } finally {
    pending.resolve(null);
    read.mockRestore();
    await view.unmount();
  }
});

it('keeps the confirmed NodeSeek attendance board when an earlier refresh finishes late', async () => {
  seedNodeSeekAccount();
  let signed = false;
  const record = { id: 91, member_id: 42, day_id: 120, gain: 3, created_at: '2026-10-01T17:14:50.000Z' };
  const unsigned = { source: 'nodeseek' as const, userId: '42', list: [], record: null, order: null, total: 0 };
  const post = jest.fn();
  const { view, runtime } = await renderSiteRuntime(
    'nodeseek',
    async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/attendance/board') {
        return Response.json({
          list: [],
          order: signed ? 1 : null,
          total: signed ? 1 : 0,
          record: signed ? record : null
        });
      }
      if (url.pathname === '/api/attendance' && init?.method === 'POST') {
        post();
        signed = true;
        return Response.json({ success: true });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    },
    'more'
  );
  const key = forumQueryKeys.accountData({
    source: 'nodeseek',
    kind: 'attendance',
    userId: '42',
    sessionEpoch: runtime().read.forumSessionEpochs.nodeseek,
    readPlanScope: runtime().read.readGateway.getReadPlan('nodeseek', 'account-data').cacheScope
  });
  const pending = Promise.withResolvers<typeof unsigned>();
  const read = jest.fn(() => pending.promise);
  appQueryClient.setQueryData(key, unsigned);
  const observer = new QueryObserver(appQueryClient, { queryKey: key, queryFn: read });
  const unsubscribe = observer.subscribe(({ data }) => {
    if (data) runtime().center.nodeSeek.observeBoard(data);
  });
  let refresh: Promise<void> | undefined;
  try {
    await act(async () => {
      refresh = appQueryClient.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => runtime().center.nodeSeek.checkIn(false));
    expect(post).toHaveBeenCalledTimes(1);
    expect(runtime().center.nodeSeek.state.kind).toBe('signed');

    await act(async () => {
      pending.resolve(unsigned);
      await refresh;
    });
    expect(appQueryClient.getQueryData(key)).toMatchObject({ record: { id: '91' } });
    expect(runtime().center.nodeSeek.state.kind).toBe('signed');
  } finally {
    pending.resolve(unsigned);
    unsubscribe();
    appQueryClient.removeQueries({ queryKey: key, exact: true });
    await view.unmount();
  }
});

async function renderStrictSiteRuntime(source: 'nodeseek' | 'linuxdo') {
  const notify = jest.fn();
  let runtime!: ReturnType<typeof useAccountRuntime>;
  let effectRuns = 0;
  function Harness({ notifyCallback }: { notifyCallback: (message: string) => void }) {
    runtime = useAccountRuntime({
      appActive: true,
      enabledSources: [source],
      fetcher: async () => Response.json({}),
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: notifyCallback,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen: 'search',
      webViewBlockMessage: ''
    });
    useLayoutEffect(() => {
      effectRuns += 1;
      if (effectRuns !== 1) return;
      if (source === 'nodeseek') runtime.hosts.requestNodeSeekVerification();
      else void runtime.hosts.showLinuxDoVerification('登录');
    }, []);
    return runtime.hosts.element;
  }
  const settings = createEmptyReaderData().settings;
  const styleValue = { settings: resolveReaderStyleSettings(settings), theme: createTheme(settings) };
  const element = (notifyCallback: (message: string) => void) => (
    <ReaderStyleProvider value={styleValue}>
      <PortalProvider>
        <QueryTestWrapper>
          <Harness notifyCallback={notifyCallback} />
        </QueryTestWrapper>
      </PortalProvider>
    </ReaderStyleProvider>
  );
  const root = createRoot({ isStrictMode: true });
  await act(async () => root.render(element(notify)));
  expect(effectRuns).toBe(2);
  await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
  return {
    runtime: () => runtime,
    notify,
    changeNotify: (callback: (message: string) => void) => act(async () => root.render(element(callback))),
    unmount: () => act(async () => root.unmount())
  };
}

it('removes the saved credential affordance after a partially completed deletion', async () => {
  const site = 'linuxdo';
  const storage = new Map<string, string>();
  const read = jest.mocked(SecureStore.getItemAsync);
  const remove = jest.mocked(SecureStore.deleteItemAsync);
  const savedRead = read.getMockImplementation()!;
  const savedRemove = remove.getMockImplementation()!;
  const save = jest.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (key, value) => {
    storage.set(key, value);
  });
  read.mockImplementation(async (key) => storage.get(key) ?? null);
  remove.mockImplementation(async (key) => {
    if (key === 'site-login-credential.linuxdo.summary') throw new Error('metadata removal failed');
    storage.delete(key);
  });
  let view: Awaited<ReturnType<typeof renderSiteRuntime>>['view'] | undefined;
  try {
    await credentialVault.save(site, { account: 'fixture-user', password: 'fixture-value', allowUnprotected: true });
    const rendered = await renderSiteRuntime(site, async () => {
      throw new Error('Unexpected network access for a local credential deletion');
    });
    view = rendered.view;
    const readSummary = () => rendered.runtime().center.credentials.credentialSummaries.linuxdo;
    await waitFor(() => expect(readSummary().hasCredential).toBe(true));
    await act(async () => {
      await expect(
        rendered.runtime().center.handleAccountCenterCommand({ type: 'delete-credential', site })
      ).rejects.toThrow('metadata removal failed');
    });
    expect(readSummary()).toMatchObject({ hasCredential: false, state: 'invalidated' });
  } finally {
    if (view) await view.unmount();
    save.mockRestore();
    read.mockImplementation(savedRead);
    remove.mockImplementation(savedRemove);
  }
});

describe('credential observer lifetime', () => {
  async function renderStrictCredentials(
    start: (
      value: ReturnType<typeof useAccountCredentialController>,
      probe: (attempt: number, type?: 'probe' | 'fill') => void
    ) => void
  ) {
    let controller!: ReturnType<typeof useAccountCredentialController>;
    let effectRuns = 0;
    const notify = jest.fn();
    const root = createRoot({ isStrictMode: true });
    const probe = (attempt: number, type: 'probe' | 'fill' = 'probe') => {
      const page = root.container.queryAll((node) => node.props.testID === 'login-webview')[0];
      if (!page || typeof page.props.onMessage !== 'function') throw new Error('Expected credential WebView');
      page.props.onMessage({
        nativeEvent: {
          url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl,
          data: JSON.stringify({
            type: `login-form-${type}`,
            site: 'linuxdo',
            attempt,
            ok: true,
            url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl
          })
        }
      });
    };
    function Harness({ notifyCallback }: { notifyCallback: (message: string) => void }) {
      const webViewRef = useRef<WebView>(null);
      controller = useAccountCredentialController({
        changeLinuxDoPanel: () => true,
        changeNodeSeekLoginPanel: () => undefined,
        changeYaohuoLoginPanel: () => undefined,
        notify: notifyCallback,
        refreshAccountStatus: async () => undefined,
        setYaohuoLoginPrompt: () => undefined,
        webViewBlockMessage: ''
      });
      useLayoutEffect(() => {
        effectRuns += 1;
        if (effectRuns === 1) start(controller, probe);
      }, []);
      return (
        <WebView
          ref={webViewRef}
          source={{ uri: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl }}
          onMessage={(event) => {
            const document = webViewRef.current;
            controller.handleCredentialLoginFormMessage(event, () => document);
          }}
        />
      );
    }
    await act(async () => root.render(<Harness notifyCallback={notify} />));
    expect(effectRuns).toBe(2);
    return {
      controller: () => controller,
      notify,
      probe,
      changeNotify: (callback: (message: string) => void) =>
        act(async () => root.render(<Harness notifyCallback={callback} />)),
      unmount: () => act(async () => root.unmount())
    };
  }

  it.each(['success', 'failure', 'replaced'] as const)(
    'continues only the same credential read after StrictMode adopts its %s observation',
    async (outcome) => {
      const pending = Promise.withResolvers<Awaited<ReturnType<typeof credentialVault.readForFill>>>();
      const read = jest.spyOn(credentialVault, 'readForFill').mockReturnValueOnce(pending.promise);
      const summary = jest
        .spyOn(credentialVault, 'getSummary')
        .mockImplementation(async (site) => emptyCredentialSummaries()[site]);
      const harness = await renderStrictCredentials((controller, probe) => {
        controller.openAccountLogin('linuxdo', true);
        probe(1);
      });
      const latestNotify = jest.fn();
      try {
        expect(read).toHaveBeenCalledTimes(1);
        await harness.changeNotify(latestNotify);
        if (outcome === 'replaced') await act(async () => harness.controller().openAccountLogin('linuxdo', true));
        mockWebViewInjectJavaScript.mockClear();
        await act(async () => {
          if (outcome === 'failure') pending.reject(new Error('current credential unavailable'));
          else pending.resolve({ site: 'linuxdo', account: 'local-fixture', password: 'local-fixture', updatedAt: 1 });
        });
        if (outcome === 'success') {
          expect(mockWebViewInjectJavaScript).toHaveBeenCalledTimes(1);
          await act(async () => harness.probe(1, 'fill'));
          expect(latestNotify).toHaveBeenCalledWith('已填入保存的登录信息，请完成验证后手动提交。');
        } else if (outcome === 'failure') {
          expect(mockWebViewInjectJavaScript).not.toHaveBeenCalled();
          expect(latestNotify).toHaveBeenCalledWith('未填入登录信息：current credential unavailable');
        } else {
          expect(mockWebViewInjectJavaScript).not.toHaveBeenCalled();
          expect(latestNotify).not.toHaveBeenCalled();
          expect(harness.controller().pendingCredentialFillSite).toBe('linuxdo');
        }
        expect(harness.notify).not.toHaveBeenCalled();
      } finally {
        pending.resolve(null);
        await harness.unmount();
        read.mockRestore();
        summary.mockRestore();
      }
    }
  );

  it.each(['save', 'delete'] as const)(
    'keeps a dispatched credential %s observable after StrictMode adopts it',
    async (mode) => {
      const pending = Promise.withResolvers<void>();
      const summary = jest
        .spyOn(credentialVault, 'getSummary')
        .mockImplementation(async (site) => emptyCredentialSummaries()[site]);
      const save = jest.spyOn(credentialVault, 'save').mockImplementation(async () => {
        await pending.promise;
        return { site: 'linuxdo', state: 'saved', hasCredential: true, protection: 'device' };
      });
      const remove = jest.spyOn(credentialVault, 'delete').mockReturnValue(pending.promise);
      let command!: Promise<void>;
      const harness = await renderStrictCredentials((controller) => {
        command = controller.handleAccountCenterCommand(
          mode === 'save'
            ? {
                type: 'save-credential',
                site: 'linuxdo',
                account: 'local-fixture',
                password: 'local-fixture',
                allowUnprotected: true
              }
            : { type: 'delete-credential', site: 'linuxdo' }
        );
      });
      const latestNotify = jest.fn();
      try {
        const summaryReads = summary.mock.calls.length;
        await harness.changeNotify(latestNotify);
        expect(summary).toHaveBeenCalledTimes(summaryReads);
        await act(async () => {
          pending.resolve();
          await command;
        });
        expect(latestNotify).toHaveBeenCalledTimes(1);
        expect(harness.notify).not.toHaveBeenCalled();
        expect(harness.controller().credentialSummaries.linuxdo.hasCredential).toBe(mode === 'save');
        expect(mode === 'save' ? save : remove).toHaveBeenCalledTimes(1);
      } finally {
        pending.resolve();
        await harness.unmount();
        summary.mockRestore();
        save.mockRestore();
        remove.mockRestore();
      }
    }
  );

  it.each(['save', 'delete'] as const)(
    'settles a credential %s without notifying after its actual runtime unmounts',
    async (mode) => {
      const pending = Promise.withResolvers<void>();
      const summary = jest
        .spyOn(credentialVault, 'getSummary')
        .mockImplementation(async (site) => emptyCredentialSummaries()[site]);
      const save = jest.spyOn(credentialVault, 'save').mockImplementation(async () => {
        await pending.promise;
        return { site: 'linuxdo', state: 'saved', hasCredential: true, protection: 'device' };
      });
      const remove = jest.spyOn(credentialVault, 'delete').mockReturnValue(pending.promise);
      const { view, runtime, notify } = await renderSiteRuntime('linuxdo', async () => Response.json({}));
      let command!: Promise<void>;
      try {
        await act(async () => {
          command = runtime().center.handleAccountCenterCommand(
            mode === 'save'
              ? {
                  type: 'save-credential',
                  site: 'linuxdo',
                  account: 'local-fixture',
                  password: 'local-fixture',
                  allowUnprotected: true
                }
              : { type: 'delete-credential', site: 'linuxdo' }
          );
        });
        await view.unmount();
        notify.mockClear();
        await act(async () => {
          pending.resolve();
          await command;
        });
        expect(notify).not.toHaveBeenCalled();
      } finally {
        pending.resolve();
        summary.mockRestore();
        save.mockRestore();
        remove.mockRestore();
      }
    }
  );

  it('ignores a late summary failure after the actual runtime unmounts', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof credentialVault.getSummary>>>();
    const summary = jest
      .spyOn(credentialVault, 'getSummary')
      .mockImplementation((site) =>
        site === 'nodeseek' ? pending.promise : Promise.resolve(emptyCredentialSummaries()[site])
      );
    const { view, notify } = await renderSiteRuntime('linuxdo', async () => Response.json({}));
    try {
      await view.unmount();
      notify.mockClear();
      await act(async () => {
        pending.reject(new Error('late summary unavailable'));
      });
      expect(notify).not.toHaveBeenCalled();
    } finally {
      pending.resolve(emptyCredentialSummaries().nodeseek);
      summary.mockRestore();
    }
  });

  it('publishes current partial summaries through the latest callback without restarting the load', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof credentialVault.getSummary>>>();
    const summary = jest
      .spyOn(credentialVault, 'getSummary')
      .mockImplementation((site) =>
        site === 'nodeseek'
          ? pending.promise
          : Promise.resolve(
              site === 'linuxdo'
                ? { site, state: 'saved', hasCredential: true, protection: 'device' }
                : emptyCredentialSummaries()[site]
            )
      );
    const { view, runtime, notify, changeNotify } = await renderSiteRuntime('linuxdo', async () => Response.json({}));
    const latestNotify = jest.fn();
    try {
      const count = summary.mock.calls.length;
      await changeNotify(latestNotify);
      expect(summary).toHaveBeenCalledTimes(count);
      await act(async () => pending.reject(new Error('current summary unavailable')));
      expect(latestNotify).toHaveBeenCalledTimes(1);
      expect(latestNotify).toHaveBeenCalledWith('读取保存的登录信息失败：current summary unavailable');
      expect(notify).not.toHaveBeenCalled();
      expect(runtime().center.credentials.credentialSummaries.linuxdo.hasCredential).toBe(true);
    } finally {
      pending.resolve(emptyCredentialSummaries().nodeseek);
      await view.unmount();
      summary.mockRestore();
    }
  });

  it.each(['success', 'failure'] as const)(
    'ignores a late credential read %s after the actual login runtime unmounts',
    async (outcome) => {
      seedLinuxDoAccount();
      const pending = Promise.withResolvers<Awaited<ReturnType<typeof credentialVault.readForFill>>>();
      const read = jest.spyOn(credentialVault, 'readForFill').mockReturnValue(pending.promise);
      const summary = jest
        .spyOn(credentialVault, 'getSummary')
        .mockImplementation(async (site) => emptyCredentialSummaries()[site]);
      const { view, runtime, notify } = await renderSiteRuntime('linuxdo', async () => Response.json({}), 'more');
      try {
        await act(async () => {
          await runtime().center.handleAccountCenterCommand({ type: 'open-login-with-fill', site: 'linuxdo' });
        });
        await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
        const browser = view.getByTestId('login-webview');
        await fireEvent(browser, 'loadEnd', { nativeEvent: { url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl } });
        await fireEvent(browser, 'message', {
          nativeEvent: {
            url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl,
            data: JSON.stringify({
              type: 'login-form-probe',
              site: 'linuxdo',
              attempt: 1,
              ok: true,
              url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl
            })
          }
        });
        expect(read).toHaveBeenCalledTimes(1);
        await view.unmount();
        notify.mockClear();
        mockWebViewInjectJavaScript.mockClear();
        const summaryReads = summary.mock.calls.length;
        await act(async () => {
          if (outcome === 'failure') pending.reject(new Error('late credential unavailable'));
          else pending.resolve({ site: 'linuxdo', account: 'local-fixture', password: 'local-fixture', updatedAt: 1 });
        });
        expect(notify).not.toHaveBeenCalled();
        expect(mockWebViewInjectJavaScript).not.toHaveBeenCalled();
        expect(summary).toHaveBeenCalledTimes(summaryReads);
      } finally {
        pending.resolve(null);
        summary.mockRestore();
        read.mockRestore();
        await view.unmount();
      }
    }
  );
});

describe('native cookie barrier notification ownership', () => {
  function holdNextNativeBarrier() {
    const native = Promise.withResolvers<void>();
    const dispatch = jest.fn(() => native.promise);
    let reason: string | undefined;
    const actual = jest.requireActual<typeof import('@/platform/network/managedCookies')>(
      '@/platform/network/managedCookies'
    ).setLinuxDoCookieResponseBarrier;
    jest
      .mocked(setLinuxDoCookieResponseBarrier)
      .mockImplementationOnce((blocked, nextReason, generation, _module, parentTraceId) => {
        reason = nextReason;
        return actual(blocked, nextReason, generation, { setLinuxDoCookieResponseBarrier: dispatch }, parentTraceId);
      });
    return { native, dispatch, reason: () => reason };
  }

  it('ignores a startup barrier failure after the runtime unmounts', async () => {
    const held = holdNextNativeBarrier();
    const current = await renderSiteRuntime('linuxdo', async () => Response.json({}));
    expect(held.dispatch).toHaveBeenCalledTimes(1);
    expect(held.reason()).toBe('startup');
    await current.view.unmount();
    current.notify.mockClear();
    try {
      await act(async () => {
        held.native.reject(new Error('retired startup barrier failure'));
      });
      expect(current.notify).not.toHaveBeenCalled();
      expect(events.filter((event) => event.operation === 'cookie-barrier' && event.phase === 'finish')).toEqual([
        expect.objectContaining({ outcome: 'failure', cookieBarrierReason: 'startup' })
      ]);
    } finally {
      held.native.resolve();
    }
  });

  it('ignores the first startup barrier failure after StrictMode rebuilds its effect', async () => {
    const held = holdNextNativeBarrier();
    const current = await renderStrictSiteRuntime('linuxdo');
    try {
      expect(held.dispatch).toHaveBeenCalledTimes(1);
      expect(held.reason()).toBe('startup');
      current.notify.mockClear();
      await act(async () => {
        held.native.reject(new Error('retired StrictMode startup barrier failure'));
      });
      expect(current.notify).not.toHaveBeenCalled();
    } finally {
      held.native.resolve();
      await current.unmount();
    }
  });

  it('ignores a source-change barrier failure after a newer source effect replaces it', async () => {
    const current = await renderSiteRuntime('linuxdo', async () => Response.json({}));
    const held = holdNextNativeBarrier();
    try {
      await current.enabled(false);
      expect(held.dispatch).toHaveBeenCalledTimes(1);
      expect(held.reason()).toBe('source-change');
      await current.enabled(true);
      current.notify.mockClear();
      await act(async () => {
        held.native.reject(new Error('superseded source barrier failure'));
      });
      expect(current.notify).not.toHaveBeenCalled();
    } finally {
      held.native.resolve();
      await current.view.unmount();
    }
  });

  it('notifies once and retains Native diagnostics when the current startup barrier fails', async () => {
    const held = holdNextNativeBarrier();
    const current = await renderSiteRuntime('linuxdo', async () => Response.json({}));
    try {
      current.notify.mockClear();
      await act(async () => {
        held.native.reject(new Error('current startup barrier failure'));
      });
      expect(current.notify).toHaveBeenCalledTimes(1);
      expect(current.notify).toHaveBeenCalledWith('登录会话交接未完成，请刷新账号页面重试。');
      expect(events.filter((event) => event.operation === 'cookie-barrier' && event.phase === 'finish')).toEqual([
        expect.objectContaining({ outcome: 'failure', cookieBarrierReason: 'startup' })
      ]);
    } finally {
      held.native.resolve();
      await current.view.unmount();
    }
  });

  it('uses the latest notifier without issuing another cookie barrier for a callback change', async () => {
    const barrier = holdNextNativeBarrier();
    const current = await renderSiteRuntime('linuxdo', async () => Response.json({}));
    const calls = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
    const nextNotify = jest.fn();
    try {
      await current.changeNotify(nextNotify);
      expect(jest.mocked(setLinuxDoCookieResponseBarrier)).toHaveBeenCalledTimes(calls);
      current.notify.mockClear();
      await act(async () => {
        barrier.native.reject(new Error('current callback barrier failure'));
      });
      expect(nextNotify).toHaveBeenCalledTimes(1);
      expect(nextNotify).toHaveBeenCalledWith('登录会话交接未完成，请刷新账号页面重试。');
      expect(current.notify).not.toHaveBeenCalled();
    } finally {
      barrier.native.resolve();
      await current.view.unmount();
    }
  });
});

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

function nodeImageControls(key: ReturnType<typeof useAccountRuntime>['center']['nodeImage']['key']) {
  const settings = createEmptyReaderData().settings;
  const theme = createTheme(settings);
  return (
    <ReaderStyleProvider value={{ settings: resolveReaderStyleSettings(settings), theme }}>
      <NodeSeekServicesPanel
        theme={theme}
        apiKeyAuthorized={key.authorized}
        apiKeyBusy={key.busy}
        apiKeySaved={key.saved}
        recoveryThreshold={1}
        onAuthorizeApiKey={key.authorize}
        onClearApiKey={key.clear}
        onRecoveryThresholdChange={() => undefined}
        onSaveApiKey={key.save}
      />
    </ReaderStyleProvider>
  );
}

it.each(['verified', 'legacy'] as const)(
  'keeps the NodeImage authorization indicator scoped to the current account for a %s local key',
  async (kind) => {
    seedNodeSeekAccount();
    await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot('nodeseek'))!);
    defaultStorageRead.mockImplementation(async (key: string) => {
      if (key !== 'nodeimage-api-key') return null;
      return kind === 'legacy'
        ? 'synthetic-retained-key'
        : JSON.stringify({
            version: 1,
            apiKey: 'synthetic-retained-key',
            ownership: { kind: 'verified', identityKey: 'nodeseek:42' }
          });
    });
    let member: { id: number; name: string } | null = { id: 42, name: 'alice' };
    const hook = await renderRuntime(
      async () =>
        new Response(
          member
            ? `<html><a class="Username" href="/space/${member.id}">${member.name}</a></html>`
            : '<html><head><meta name="nodeseekAccountState" content="anonymous"></head></html>'
        ),
      true,
      ['nodeseek']
    );
    await waitFor(() => expect(hook.result.current.center.nodeImage.key.saved).toBe(true));
    const panel = () => nodeImageControls(hook.result.current.center.nodeImage.key);
    const view = await render(panel());
    const label = (authorized: boolean) => `NodeImage 授权，${authorized ? '已授权' : '未授权'}`;
    const initialAuthorization = kind === 'verified';
    expect(view.getByLabelText(label(initialAuthorization))).toBeTruthy();
    await fireEvent.press(view.getByLabelText(label(initialAuthorization)));

    for (const next of [{ id: 57, name: 'bob' }, { id: 42, name: 'alice' }, null]) {
      member = next;
      await act(async () => {
        await expect(hook.result.current.read.reconcileAccountStatus('nodeseek')).resolves.toMatchObject({
          status: next ? 'changed' : 'anonymous'
        });
      });
      expect(hook.result.current.read.accountSessionViewModels.nodeseek.currentUser?.id).toBe(
        next ? String(next.id) : undefined
      );
      await view.rerender(panel());
      const authorized = kind === 'verified' && next?.id === 42;
      expect(view.getByLabelText(label(authorized))).toBeTruthy();
      expect(view.queryByLabelText(label(!authorized))).toBeNull();
      expect(view.getByLabelText('清除 Key')).toBeTruthy();
      if (!authorized) await expect(hook.result.current.write.ensureNodeImageApiKey()).resolves.toBeNull();
    }
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  }
);

it('shows the current NodeImage authorization when a matching source is re-enabled', async () => {
  seedNodeSeekAccount();
  await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot('nodeseek'))!);
  defaultStorageRead.mockImplementation(async (key: string) =>
    key === 'nodeimage-api-key'
      ? JSON.stringify({
          version: 1,
          apiKey: 'synthetic-retained-key',
          ownership: { kind: 'verified', identityKey: 'nodeseek:42' }
        })
      : null
  );
  const fetcher = jest.fn(async () => Response.json({}));
  const hook = await renderRuntime(fetcher, true, ['nodeseek']);
  await waitFor(() => expect(hook.result.current.center.nodeImage.key.authorized).toBe(true));
  const panel = () => nodeImageControls(hook.result.current.center.nodeImage.key);
  const view = await render(panel());
  try {
    expect(view.getByLabelText('NodeImage 授权，已授权')).toBeTruthy();
    await hook.rerender({ enabledSources: [] });
    expect(
      hook.result.current.read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')
    ).toBe(false);
    await hook.rerender({ enabledSources: ['nodeseek'] });
    expect(
      hook.result.current.read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')
    ).toBe(true);
    await view.rerender(panel());
    expect(view.getByLabelText('NodeImage 授权，已授权')).toBeTruthy();
    expect(view.queryByLabelText('NodeImage 授权，未授权')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    await hook.unmount();
  }
});

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
      expect(second.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(
        false
      );
      expect(second.runtime().read.readGateway.getReadPlan(site, 'account-data').state).toBe('blocked');
      await act(async () => finish(response()));
      await waitFor(() =>
        expect(second.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(
          true
        )
      );
      expect(second.runtime().read.forumSessionEpochs[site]).toBe(0);
      expect(JSON.parse((await AsyncStorage.getItem(`account-session.v1.${site}`))!).handoffPending).toBeUndefined();
      await second.enabled(false);
      await second.enabled(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(second.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(
        true
      );
      await second.view.unmount();
      appQueryClient.clear();
      const third = await renderSiteRuntime(site, fetcher);
      expect(third.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(
        true
      );
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
      expect(runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(false);
      await enabled(false);
      await enabled(true);
      expect(fetcher).toHaveBeenCalledTimes(previousProbes);
      expect(runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(false);
      expect(runtime().read.readGateway.getReadPlan(site, 'account-data')).toMatchObject({
        state: 'blocked',
        reason: 'identity-pending'
      });

      await act(async () => runtime().center.handleAccountCenterCommand({ type: 'refresh' }));
      await waitFor(() =>
        expect(runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(true)
      );
      expect(runtime().read.forumSessionEpochs[site]).toBe(epoch);
      expect(runtime().read.accountSessionViewModels[site].currentUser?.id).toBe(id);
      expect(fetcher).toHaveBeenCalledTimes(previousProbes + 1);
    } finally {
      await view.unmount();
    }
  }
);

it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
  're-enables %s with a disabled cold-start handoff pending until the user refreshes',
  async (site) => {
    const { id, response } = accountClearFixture(site);
    const key = `account-session.v1.${site}`;
    await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot(site))!);
    const first = await renderSiteRuntime(site, async () => response(), 'more');
    try {
      await act(async () => first.runtime().center.handleAccountCenterCommand({ type: 'open-login', site }));
      await waitFor(() => expect(first.view.getByTestId('login-webview')).toBeTruthy());
      await first.enabled(false);
      expect(JSON.parse((await AsyncStorage.getItem(key))!)).toMatchObject({ handoffPending: true, identity: { id } });
    } finally {
      await first.view.unmount();
    }
    appQueryClient.clear();

    const fetcher = jest.fn(async () => response());
    const restored = await renderSiteRuntime(site, fetcher, 'more', false);
    try {
      expect(fetcher).not.toHaveBeenCalled();
      expect(restored.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(
        false
      );
      await restored.enabled(true);
      expect(restored.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(
        false
      );
      expect(restored.runtime().read.readGateway.getReadPlan(site, 'account-data')).toMatchObject({
        state: 'blocked',
        reason: 'identity-pending'
      });
      expect(JSON.parse((await AsyncStorage.getItem(key))!)).toMatchObject({ handoffPending: true, identity: { id } });
      expect(restored.view.queryByTestId('login-webview')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      await act(async () => restored.runtime().center.handleAccountCenterCommand({ type: 'refresh' }));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(restored.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')).toBe(
        true
      );
      expect(JSON.parse((await AsyncStorage.getItem(key))!).handoffPending).toBeUndefined();
    } finally {
      await restored.view.unmount();
    }
  }
);

it.each(['same', 'changed', 'anonymous', 'storage-failed'] as const)(
  'retains an interrupted identity on an unknown recovery and explicitly settles %s without replaying authorization',
  async (outcome) => {
    await saveAccountSessionSnapshot(seedLinuxDoAccount());
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
      expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
        false
      );
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
          expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
            false
          );
          expect(JSON.parse((await AsyncStorage.getItem('account-session.v1.linuxdo'))!).handoffPending).toBe(true);
        } else {
          expect(runtime().read.forumSessionEpochs.linuxdo).toBe(outcome === 'same' ? 0 : 1);
          expect(
            runtime().read.notificationPrivateAccessAllowed(
              'linuxdo',
              outcome === 'changed' ? 'linuxdo:bob' : 'linuxdo:alice',
              'foreground-read'
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

it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
  'blocks %s native clear while its handoff marker is pending or failed',
  async (site) => {
    const { id } = accountClearFixture(site);
    await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot(site))!);
    const nativeClear = jest.fn(async () => true);
    NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies: nativeClear };
    const fetcher = jest.fn(async () => new Response('', { status: 401 }));
    const first = await renderSiteRuntime(site, fetcher);
    const marker = Promise.withResolvers<void>();
    const write = jest.spyOn(AsyncStorage, 'setItem').mockReturnValueOnce(marker.promise);
    try {
      await act(async () => first.runtime().center.handleAccountCenterCommand({ type: 'open-login', site }));
      await waitFor(() => expect(write).toHaveBeenCalled());
      await fireEvent.press(first.view.getByLabelText('清除登录'));
      expect(nativeClear).not.toHaveBeenCalled();
      await act(async () => marker.reject(new Error('disk unavailable')));
      expect(first.notify).toHaveBeenCalledWith('登录会话保存失败，请关闭后重试');
      await fireEvent.press(first.view.getByLabelText('清除登录'));
      expect(nativeClear).not.toHaveBeenCalled();

      await first.view.unmount();
      appQueryClient.clear();
      const restarted = await renderSiteRuntime(site, fetcher);
      try {
        expect(
          restarted.runtime().read.notificationPrivateAccessAllowed(site, `${site}:${id}`, 'foreground-read')
        ).toBe(true);
        expect(fetcher).not.toHaveBeenCalled();
      } finally {
        await restarted.view.unmount();
      }
    } finally {
      marker.resolve();
      write.mockRestore();
      await first.view.unmount();
    }
  }
);

it('recovers a new login after clearing the account in the still-open login page', async () => {
  const site = 'nodeseek';
  accountClearFixture(site);
  await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot(site))!);
  const nativeClear = jest.fn(async () => true);
  NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies: nativeClear };
  const first = await renderSiteRuntime(site, async () => new Response('', { status: 401 }));
  try {
    await act(async () => first.runtime().center.handleAccountCenterCommand({ type: 'open-login', site }));
    await waitFor(() => expect(first.view.getByTestId('login-webview')).toBeTruthy());
    await fireEvent.press(first.view.getByLabelText('清除登录'));
    await waitFor(async () => {
      expect(JSON.parse((await AsyncStorage.getItem(`account-session.v1.${site}`))!)).toMatchObject({
        state: 'anonymous',
        handoffPending: true
      });
    });
    expect(nativeClear).toHaveBeenCalledTimes(1);
    expect(first.view.getByTestId('login-webview')).toBeTruthy();
  } finally {
    await first.view.unmount();
  }

  appQueryClient.clear();
  const fetcher = jest.fn(async () => new Response('<html><a class="Username" href="/space/84">bob</a></html>'));
  const restarted = await renderSiteRuntime(site, fetcher);
  try {
    await waitFor(() =>
      expect(restarted.runtime().read.notificationPrivateAccessAllowed(site, 'nodeseek:84', 'foreground-read')).toBe(
        true
      )
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem(`account-session.v1.${site}`))!)).toMatchObject({
      state: 'authenticated',
      identity: { id: '84' }
    });
    expect(JSON.parse((await AsyncStorage.getItem(`account-session.v1.${site}`))!)).not.toHaveProperty(
      'handoffPending'
    );
  } finally {
    await restarted.view.unmount();
  }
});

it('does not reuse a closed login marker failure for the next dedicated reading surface', async () => {
  jest.useFakeTimers();
  seedLinuxDoAccount();
  const { view, runtime } = await renderSiteRuntime('linuxdo', async () => Response.json({ current_user: null }));
  const marker = jest
    .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
    .mockRejectedValueOnce(new Error('disk unavailable'));
  try {
    await act(async () => {
      await runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
    });
    expect(view.getByText('登录会话保存失败，请关闭后重试')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('关闭'));
    await act(async () => jest.advanceTimersByTimeAsync(450));
    await act(async () => {
      await runtime().hosts.showLinuxDoVerification('读取需要验证', {
        queryKey: ['next-reading'],
        isCurrent: () => true,
        resume: async () => 'completed' as const
      });
    });
    await act(async () => jest.advanceTimersByTimeAsync(100));
    expect(view.getByTestId('login-webview')).toBeTruthy();
  } finally {
    marker.mockRestore();
    await view.unmount();
    jest.useRealTimers();
  }
});

it('does not mount a login document until its durable marker is saved and preserves the account if saving fails', async () => {
  const { response } = accountClearFixture('nodeseek');
  const { view, runtime, notify } = await renderSiteRuntime('nodeseek', async () => response());
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
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
    await act(async () => fail(new Error('disk unavailable')));
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(view.getByText('登录会话保存失败，请关闭后重试')).toBeTruthy();
    expect(notify).toHaveBeenCalledWith('登录会话保存失败，请关闭后重试');
    expect(runtime().read.accountSessionViewModels.nodeseek.currentUser?.id).toBe('42');
  } finally {
    write.mockRestore();
    await view.unmount();
  }
});

it('does not publish a durable marker failure after its runtime unmounts', async () => {
  const { response } = accountClearFixture('nodeseek');
  const { view, runtime, notify } = await renderSiteRuntime('nodeseek', async () => response());
  const marker = Promise.withResolvers<void>();
  const write = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(() => marker.promise);
  try {
    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'nodeseek' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    await view.unmount();
    notify.mockClear();

    await act(async () => {
      marker.reject(new Error('retired marker write failed'));
    });

    expect(notify).not.toHaveBeenCalled();
    expect(runtime().read.accountSessionViewModels.nodeseek.currentUser?.id).toBe('42');
  } finally {
    marker.resolve();
    write.mockRestore();
  }
});

it('continues the same visible surface when StrictMode adopts its pending durable marker', async () => {
  const marker = Promise.withResolvers<void>();
  const mark = jest
    .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
    .mockImplementationOnce(() => marker.promise);
  const current = await renderStrictSiteRuntime('nodeseek');
  try {
    expect(mark).toHaveBeenCalledTimes(1);
    expect(current.runtime().hosts.surfaces.nodeseek).toBe(true);
    expect(current.runtime().hosts.element.props.authSurfaceBlockMessages?.nodeseek).toBe('正在保存登录交接状态…');
    expect(mockWebViewLoads).toEqual([]);

    await act(async () => {
      marker.resolve();
    });

    expect(current.runtime().hosts.surfaces.nodeseek).toBe(true);
    expect(current.runtime().hosts.element.props.authSurfaceBlockMessages?.nodeseek).toBe('');
    expect(mockWebViewLoads).toContain('https://www.nodeseek.com');
    expect(mark).toHaveBeenCalledTimes(1);
  } finally {
    marker.resolve();
    await current.unmount();
    mark.mockRestore();
  }
});

it('reports an adopted durable marker failure once and keeps ordinary callback changes in the same owner', async () => {
  const marker = Promise.withResolvers<void>();
  const mark = jest
    .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
    .mockImplementationOnce(() => marker.promise);
  const current = await renderStrictSiteRuntime('nodeseek');
  const nextNotify = jest.fn();
  try {
    current.notify.mockClear();
    await current.changeNotify(nextNotify);
    await act(async () => {
      marker.reject(new Error('adopted marker write failed'));
    });

    expect(current.notify).not.toHaveBeenCalled();
    expect(nextNotify).toHaveBeenCalledTimes(1);
    expect(nextNotify).toHaveBeenCalledWith('登录会话保存失败，请关闭后重试');
    expect(current.runtime().hosts.element.props.authSurfaceBlockMessages?.nodeseek).toBe(
      '登录会话保存失败，请关闭后重试'
    );
    const laterNotify = jest.fn();
    await current.changeNotify(laterNotify);
    expect(laterNotify).not.toHaveBeenCalled();
    expect(mark).toHaveBeenCalledTimes(1);
  } finally {
    marker.resolve();
    await current.unmount();
    mark.mockRestore();
  }
});

it('ignores an adopted durable marker after a new preparation replaces it', async () => {
  const oldMarker = Promise.withResolvers<void>();
  const newMarker = Promise.withResolvers<void>();
  const mark = jest
    .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
    .mockImplementationOnce(() => oldMarker.promise)
    .mockImplementationOnce(() => newMarker.promise);
  const current = await renderStrictSiteRuntime('nodeseek');
  try {
    await act(async () => {
      current.runtime().hosts.closePanels();
      current.runtime().hosts.requestNodeSeekVerification();
    });
    current.notify.mockClear();
    await act(async () => {
      oldMarker.reject(new Error('replaced marker write failed'));
    });
    expect(current.notify).not.toHaveBeenCalled();
    expect(current.runtime().hosts.element.props.authSurfaceBlockMessages?.nodeseek).toBe('正在保存登录交接状态…');

    await act(async () => {
      newMarker.reject(new Error('current marker write failed'));
    });
    expect(current.notify).toHaveBeenCalledTimes(1);
    expect(current.notify).toHaveBeenCalledWith('登录会话保存失败，请关闭后重试');
    expect(mark).toHaveBeenCalledTimes(2);
  } finally {
    oldMarker.resolve();
    newMarker.resolve();
    await current.unmount();
    mark.mockRestore();
  }
});

it.each(['retained', 'replaced'] as const)(
  'dispatches only the current %s cookie preparation after StrictMode adopts its logical surface',
  async (mode) => {
    const marker = Promise.withResolvers<void>();
    const mark = jest
      .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
      .mockImplementationOnce(() => marker.promise);
    const barrierCallsBefore = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
    const current = await renderStrictSiteRuntime('linuxdo');
    try {
      if (mode === 'replaced')
        await act(async () => {
          await current.runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
        });
      expect(
        jest
          .mocked(setLinuxDoCookieResponseBarrier)
          .mock.calls.slice(barrierCallsBefore)
          .filter(([, reason]) => reason === 'surface-open')
      ).toHaveLength(0);
      await act(async () => {
        marker.resolve();
      });
      await waitFor(() => expect(mockWebViewLoads).toContain('https://linux.do/latest'));

      const openings = jest
        .mocked(setLinuxDoCookieResponseBarrier)
        .mock.calls.slice(barrierCallsBefore)
        .filter(([, reason]) => reason === 'surface-open');
      expect(openings).toHaveLength(1);
      expect(openings[0]?.slice(0, 3)).toEqual([true, 'surface-open', 1]);
      expect(current.runtime().hosts.surfaces.linuxdo).toBe(true);
      expect(mark).toHaveBeenCalledTimes(1);
    } finally {
      marker.resolve();
      await current.unmount();
      mark.mockRestore();
    }
  }
);

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

it('keeps the linux.do WebView retired during an explicit clear and offers a reopen after failure', async () => {
  const pending = Promise.withResolvers<boolean>();
  const clear = jest.fn(() => pending.promise);
  NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies: clear };
  const { view, runtime } = await renderSiteRuntime('linuxdo', async () => accountClearFixture('linuxdo').response());
  await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' }));
  await fireEvent.press(view.getByLabelText('清除登录'));
  await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(view.queryByTestId('login-webview', { includeHiddenElements: true })).toBeNull();
  await act(async () => pending.reject(new Error('本机清除失败')));
  expect(await view.findByLabelText('重新打开登录页')).toBeTruthy();
});

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
      expect(runtime().read.notificationPrivateAccessAllowed('yaohuo', 'yaohuo:7', 'foreground-read')).toBe(false);
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
      expect(runtime().read.notificationPrivateAccessAllowed('yaohuo', 'yaohuo:7', 'foreground-read')).toBe(
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
    const probe = fetcher.getMockImplementation()!;
    const attachedAtProbe: boolean[] = [];
    fetcher.mockImplementation(() => {
      attachedAtProbe.push(view.queryByTestId('login-webview') !== null);
      return probe();
    });
    const storage = jest.spyOn(AsyncStorage, 'setItem');
    const write = storage.getMockImplementation()!;
    const attachedAtHandoffCommit: boolean[] = [];
    storage.mockImplementation(async (key, value) => {
      if (key === 'account-session.v1.' + site && !JSON.parse(value).handoffPending) {
        attachedAtHandoffCommit.push(view.queryByTestId('login-webview') !== null);
      }
      return write(key, value);
    });
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
      await waitFor(() => expect(attachedAtHandoffCommit).toEqual([false]));
      expect(attachedAtProbe).toEqual([true, false]);
      expect(runtime().read.accountSessionViewModels[site].currentUser?.id).toBe(site === 'nodeseek' ? '42' : '7');
    } finally {
      storage.mockRestore();
      await view.unmount();
    }
  }
);

it('keeps the same NodeSeek window through a rejected exact recovery and closes only after its explicit retry succeeds', async () => {
  seedNodeSeekAccount();
  await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot('nodeseek'))!);
  const accountResponse = () => new Response('<html><a class="Username" href="/space/42">alice</a></html>');
  const closingProbe = Promise.withResolvers<Response>();
  const fetcher = jest
    .fn<ReturnType<Fetcher>, Parameters<Fetcher>>()
    .mockImplementationOnce(async () => accountResponse())
    .mockImplementationOnce(async () => accountResponse());
  const { view, runtime } = await renderSiteRuntime('nodeseek', fetcher);
  let webViewAttachedAtClosingProbe = true;
  fetcher.mockImplementation(() => {
    webViewAttachedAtClosingProbe = view.queryByTestId('login-webview') !== null;
    return closingProbe.promise;
  });
  const loadDisk = async () => JSON.parse((await AsyncStorage.getItem('account-session.v1.nodeseek'))!);
  const pending = Promise.withResolvers<'verification-required'>();
  const recoveryLanes: string[] = [];
  const transientResume = jest.fn(async () => 'completed' as const);
  const resume = jest
    .fn()
    .mockImplementationOnce(() => {
      const plan = runtime().read.readGateway.getReadPlan('nodeseek', 'topic');
      if (plan.state === 'ready') recoveryLanes.push(plan.lane);
      return pending.promise;
    })
    .mockImplementation(async () => {
      const plan = runtime().read.readGateway.getReadPlan('nodeseek', 'topic');
      if (plan.state === 'ready') recoveryLanes.push(plan.lane);
      return 'completed';
    });
  await act(async () =>
    runtime().hosts.requestNodeSeekVerification('需要验证', {
      queryKey: ['blocked-topic'],
      isCurrent: () => true,
      resume
    })
  );
  await act(async () =>
    runtime().hosts.requestNodeSeekVerification('临时公开读取也需要验证', {
      queryKey: ['public:omit', 'blocked-topic'],
      isCurrent: () => true,
      resume: transientResume
    })
  );
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
  await fireEvent.press(view.getByText('检测并继续'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(transientResume).not.toHaveBeenCalled();
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(view.getByTestId('login-webview')).toBeTruthy();
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(true);
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'settled-session')).toBe(false);
  await expect(runtime().write.ensureWritableSession('nodeseek')).rejects.toMatchObject({ reason: 'identity_pending' });
  expect((await loadDisk()).handoffPending).toBe(true);
  await expect(accountSessionStore.loadAccountSessionSnapshot('nodeseek')).resolves.toMatchObject({
    identityTrust: 'unknown'
  });
  expect(view.getByLabelText('正在检测…').props.accessibilityState.disabled).toBe(true);
  const mark = jest
    .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
    .mockRejectedValue(new Error('new marker unavailable'));
  try {
    await act(async () => pending.resolve('verification-required'));
    expect(mark).not.toHaveBeenCalled();
    expect(runtime().hosts.element.props.authSurfaceBlockMessages?.nodeseek).toBe('');
    expect(view.getByTestId('login-webview')).toBeTruthy();
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
    expect((await loadDisk()).handoffPending).toBe(true);
    expect(runtime().hosts.surfaces.nodeseek).toBe(true);
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
    expect(runtime().read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(true);
    expect(mockWebViewLoads).toEqual(['https://www.nodeseek.com']);
    await fireEvent.press(view.getByText('检测并继续'));
    expect(resume).toHaveBeenCalledTimes(2);
    expect(recoveryLanes).toEqual(['authenticated', 'authenticated']);
    expect(runtime().hosts.surfaces.nodeseek).toBe(false);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(webViewAttachedAtClosingProbe).toBe(false);
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect((await loadDisk()).handoffPending).toBe(true);
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
    await act(async () => closingProbe.resolve(accountResponse()));
    await waitFor(() =>
      expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'settled-session')).toBe(true)
    );
    expect((await loadDisk()).handoffPending).toBeUndefined();
    await expect(runtime().write.ensureWritableSession('nodeseek')).resolves.toMatchObject({
      identityKey: 'nodeseek:42'
    });

    await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site: 'nodeseek' }));
    await waitFor(() =>
      expect(runtime().hosts.element.props.authSurfaceBlockMessages?.nodeseek).toBe('登录会话保存失败，请关闭后重试')
    );
    expect(mark).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('login-webview')).toBeNull();
  } finally {
    closingProbe.resolve(accountResponse());
    mark.mockRestore();
    await view.unmount();
  }
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
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(true);
  if (exit === 'reopened') {
    await fireEvent.press(view.getByLabelText('关闭'));
    await act(async () => runtime().hosts.requestNodeSeekVerification());
  } else {
    await active(false);
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
    await active(true);
  }
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
  await act(async () => pending.resolve('completed'));
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(view.getByTestId('login-webview')).toBeTruthy();
  expect(view.queryByLabelText('正在检测…')).toBeNull();
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42', 'foreground-read')).toBe(false);
  await view.unmount();
});

it('cancels an exact NodeSeek page when verification closes before its response', async () => {
  seedNodeSeekAccount();
  await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot('nodeseek'))!);
  const blockedSearch = Promise.withResolvers<Response>();
  let transportSignal: AbortSignal | null | undefined;
  const fetcher: Fetcher = async (url, init) => {
    if (new URL(url).pathname === '/search') {
      transportSignal = init?.signal;
      return blockedSearch.promise;
    }
    return new Response('<html><a class="Username" href="/space/42">alice</a></html>');
  };
  const { view, runtime } = await renderSiteRuntime('nodeseek', fetcher);
  const query = 'needle';
  const gateway = runtime().read.readGateway;
  const plan = gateway.getReadPlan('nodeseek', 'search');
  const queryKey = forumQueryKeys.search({
    source: 'nodeseek',
    lane: 'pages',
    query,
    readPlanScope: plan.cacheScope,
    sort: 'relevance',
    filter: DEFAULT_SEARCH_FILTERS.nodeseek,
    scope: runtime().read.forumSessionEpochs
  });
  const oldPage: SearchResponse = { errors: {}, items: [], hasMore: true, nextPage: 2 };
  appQueryClient.setQueryData(queryKey, { pages: [oldPage], pageParams: [1] });
  let recoveryRead: ReturnType<typeof resumeInfiniteQueryPage<SearchResponse, number>> | undefined;
  try {
    await act(async () =>
      runtime().hosts.requestNodeSeekVerification('需要验证', {
        queryKey,
        isCurrent: () => true,
        resume: async (signal) => {
          recoveryRead = resumeInfiniteQueryPage<SearchResponse, number>(
            appQueryClient,
            {
              queryKey,
              enabled: true,
              initialPageParam: 1,
              getNextPageParam: (page) => page.nextPage ?? undefined,
              queryFn: ({ pageParam, signal }) =>
                gateway.searchTopics({ source: 'nodeseek', query, page: pageParam, signal }, { plan })
            },
            { kind: 'next', pageParam: 2 },
            () => gateway.getReadPlan('nodeseek', 'search').cacheScope === plan.cacheScope,
            signal
          );
          const outcome = await recoveryRead;
          return outcome.kind === 'success' ? 'completed' : outcome.kind;
        }
      })
    );
    await fireEvent.press(view.getByText('检测并继续'));
    await waitFor(() => expect(transportSignal).toBeTruthy());
    await fireEvent.press(view.getByLabelText('关闭'));
    await waitFor(() =>
      expect(runtime().read.readGateway.getReadPlan('nodeseek', 'search').cacheScope).toBe(plan.cacheScope)
    );

    const wasAborted = transportSignal?.aborted;
    let result;
    await act(async () => {
      blockedSearch.resolve(
        new Response(
          '<ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-202-1">needle result</a></div></li></ul>'
        )
      );
      result = await recoveryRead;
    });
    const cached = appQueryClient.getQueryData<{ pages: SearchResponse[] }>(queryKey);
    expect({ wasAborted, result, pages: cached?.pages }).toEqual({
      wasAborted: true,
      result: { kind: 'stale' },
      pages: [oldPage]
    });
  } finally {
    blockedSearch.resolve(new Response('<ul class="post-list"></ul>'));
    await view.unmount();
  }
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
      expect(runtime().read.notificationPrivateAccessAllowed('yaohuo', 'yaohuo:7', 'settled-session')).toBe(false);
      await act(async () => next.resolve());
      await waitFor(() =>
        expect(runtime().read.notificationPrivateAccessAllowed('yaohuo', 'yaohuo:7', 'settled-session')).toBe(true)
      );
      expect(runtime().read.accountSessionViewModels.yaohuo.currentUser?.id).toBe('7');
      expect(fetcher).toHaveBeenCalledTimes(2);
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
    seedLinuxDoAccount();
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
  seedLinuxDoAccount();
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
    expect(view.getByText('验证结果正在交回原请求，请稍候。')).toBeTruthy();
    if (exit === 'close') await fireEvent.press(view.getByLabelText('关闭'));
    if (exit === 'back')
      await act(async () => {
        expect(runtime.hosts.closeTopmostSurface()).toBe('linuxdo-panel-closed');
      });
    if (exit === 'source') await view.rerender(<Harness enabled={false} />);
    if (exit === 'identity')
      await act(async () => {
        seedLinuxDoAccount('bob');
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

it.each(verificationRecoveryProofModes)(
  'initializes the device recovery proof before %s',
  async (mode) => {
    const initialization = jest.mocked(waitForLinuxDoLoginInitialization);
    const previousInitialization = initialization.getMockImplementation()!;
    const nativeCookies = jest.mocked(readManagedCookieHeader);
    const previousCookieRead = nativeCookies.getMockImplementation()!;
    const existingCookieRead = jest.fn(async () => {
      throw new Error('The proof must not read existing device cookies');
    });
    NativeModules.NetworkProxyModule = {
      ...NativeModules.NetworkProxyModule,
      readManagedCookieHeader: existingCookieRead
    };
    let unmount: (() => Promise<void>) | undefined;
    try {
      initialization.mockImplementation(
        jest.requireActual<typeof import('@/platform/network/linuxDoLoginInitialization')>(
          '@/platform/network/linuxDoLoginInitialization'
        ).waitForLinuxDoLoginInitialization
      );
      nativeCookies.mockImplementation(
        jest.requireActual<typeof import('@/platform/network/managedCookies')>('@/platform/network/managedCookies')
          .readManagedCookieHeader
      );
      await verifyRecoveryProof(mode, {
        hook: async (useValue) => {
          const view = await renderHook(useValue);
          unmount = () => view.unmount();
          return () => view.result.current;
        },
        unmount: async () => {
          const cleanup = unmount;
          unmount = undefined;
          await cleanup?.();
        },
        until: (test) => waitFor(() => expect(test()).toBeTruthy(), { timeout: 20_000 })
      });
      expect(existingCookieRead).not.toHaveBeenCalled();
      expect(NativeModules.NetworkProxyModule.readManagedCookieHeader).toBe(existingCookieRead);
    } finally {
      await unmount?.();
      initialization.mockImplementation(previousInitialization);
      nativeCookies.mockImplementation(previousCookieRead);
    }
  },
  45_000
);

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
  seedLinuxDoAccount();
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

function setupReadingClock() {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  const advance = async (milliseconds: number) => {
    await act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  };
  return { advance, monotonic };
}

it.each(['csrf', 'timings'] as const)(
  'preserves in-flight %s and paused reading when its transport changes',
  async (stage) => {
    const { advance, monotonic } = setupReadingClock();
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
    seedLinuxDoAccount();
    const hook = await renderHook(
      (props: { fetcher: Fetcher; appActive: boolean }) => useAccountRuntime({ ...options, ...props }),
      { initialProps: { fetcher: oldFetcher, appActive: true }, wrapper: QueryTestWrapper }
    );
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
  const { advance, monotonic } = setupReadingClock();
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
        if (transition === 'changed') seedLinuxDoAccount('bob');
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
  const { advance, monotonic } = setupReadingClock();
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
  try {
    await saveAccountSessionSnapshot(seedLinuxDoAccount());
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
        resume: async () => 'completed' as const
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
    seedLinuxDoAccount();
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
  { source: 'linuxdo', entry: 'category', status: 401, outcome: 'anonymous' },
  { source: 'linuxdo', entry: 'category', status: 403, outcome: 'anonymous' },
  { source: 'linuxdo', entry: 'csrf', status: 403, outcome: 'anonymous' },
  { source: 'linuxdo', entry: 'editable-reply', status: 401, outcome: 'anonymous' },
  { source: 'linuxdo', entry: 'editable-reply', status: 403, outcome: 'anonymous' },
  { source: 'nodeseek', entry: 'vote', status: 401, outcome: 'expired' },
  { source: 'yaohuo', entry: 'favorite', status: 401, outcome: 'expired' }
] as const)(
  'preserves account ownership for $source $entry HTTP $status with outcome $outcome',
  async ({ source, entry, status, outcome }) => {
    const username = source === 'linuxdo' ? `chain-${entry}-${status}-${outcome}` : 'alice';
    const userId = source === 'nodeseek' ? '42' : source === 'yaohuo' ? '7' : username;
    const topicId = source === 'nodeseek' ? '128' : source === 'yaohuo' ? '123' : '900';
    if (source === 'linuxdo') seedLinuxDoAccount(username);
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
      if (entry === 'editable-reply') {
        await act(async () => {
          await expect(read()).resolves.toMatchObject({
            id: topicId,
            replies: [{ commentId: 1002, canEdit: true }]
          });
        });
        expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/posts/1002.json'))).toHaveLength(0);
        expect(probes()).toHaveLength(0);
        expect(runtime().read.forumSessionEpochs.linuxdo).toBe(epoch);
        return;
      }
      let failedRead!: Awaited<ReturnType<typeof read>>;
      if (source === 'linuxdo' && status === 401) probe.resolve(json({ current_user: null }));
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
      } else expect(probes()).toHaveLength(source === 'linuxdo' ? 1 : 0);
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
        const expectedLoginProbes = beforeLogin + (source === 'linuxdo' ? 1 : 2);
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
        await waitFor(() => expect(probes()).toHaveLength(expectedLoginProbes));
        let recovered!: Awaited<ReturnType<typeof read>>;
        await act(async () => {
          recovered = await read();
        });
        expect(recovered).toMatchObject(
          entry === 'category'
            ? { items: [{ category: 'Recovered category' }], errors: {} }
            : entry === 'csrf'
              ? { items: [], errors: {} }
              : entry === 'vote'
                ? { polls: [{ id: '100', title: 'Recovered vote' }] }
                : entry === 'favorite'
                  ? { bookmarked: false, contentHtml: '<p>opening</p>' }
                  : { id: topicId, contentHtml: '<p>opening</p>' }
        );
        expect(probes()).toHaveLength(expectedLoginProbes);
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
    await saveAccountSessionSnapshot(seedLinuxDoAccount());
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
      privateAccessAllowed: (source, identity) =>
        runtime().read.notificationPrivateAccessAllowed(source, identity, 'foreground-read'),
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
        expect(probes()).toHaveLength(3);
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

it('settles standalone website verification as anonymous after the main site confirms logout', async () => {
  await saveAccountSessionSnapshot(seedLinuxDoAccount());
  const fetcher = jest.fn(async () => Response.json({ current_user: null }));
  const { view, runtime, notify } = await renderSiteRuntime('linuxdo', fetcher);
  try {
    await act(async () => {
      await runtime().center.handleAccountCenterCommand({ type: 'open-linuxdo-verification' });
    });
    await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
    await fireEvent.press(view.getByText('检测并继续'));
    await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
    expect(notify).toHaveBeenCalledWith('linux.do 主站可访问，当前未登录。');
    expect(runtime().read.accountSessionViewModels.linuxdo).toMatchObject({
      identityTrust: 'none',
      isLoggedIn: false,
      isVerifying: false
    });
    expect(runtime().read.forumSessionEpochs.linuxdo).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem('account-session.v1.linuxdo'))!).handoffPending).toBeUndefined()
    );
  } finally {
    await view.unmount();
  }
});

it.each(['server-error', 'partial'] as const)(
  'keeps the prior account on an inconclusive standalone verification result (%s)',
  async (failure) => {
    await saveAccountSessionSnapshot(seedLinuxDoAccount());
    const { view, runtime, notify } = await renderSiteRuntime('linuxdo', async () => new Response('', { status: 503 }));
    const observation = jest.spyOn(accountRead, 'readAccountStatus');
    try {
      if (failure === 'partial') {
        observation.mockResolvedValueOnce({ session: createAccountSessionSnapshot('linuxdo'), failed: true });
      }
      await act(async () => {
        await runtime().center.handleAccountCenterCommand({ type: 'open-linuxdo-verification' });
      });
      await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
      await fireEvent.press(view.getByText('检测并继续'));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('主站访问暂时无法确认')));
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
      expect(runtime().read.accountSessionViewModels.linuxdo.currentUser?.id).toBe('alice');
      expect(runtime().read.forumSessionEpochs.linuxdo).toBe(0);
    } finally {
      observation.mockRestore();
      await view.unmount();
    }
  }
);

it.each(['open-login', 'open-login-with-fill', 'open-linuxdo-verification'] as const)(
  'opens the real login host for %s during closing and ignores the previous close receipt',
  async (type) => {
    jest.useFakeTimers();
    const fetcher = jest.fn(
      async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
    );
    const { view, runtime } = await renderManualLogin(fetcher);
    const oldHandoff = Promise.withResolvers<void>();
    const verification = type === 'open-linuxdo-verification';
    const command = verification ? ({ type } as const) : ({ type, site: 'linuxdo' } as const);
    try {
      jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => oldHandoff.promise);
      await fireEvent.press(view.getByLabelText('关闭'));
      expect(view.queryByTestId('login-webview')).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
        await runtime().center.handleAccountCenterCommand(command);
        await runtime().center.handleAccountCenterCommand(command);
      });
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(350);
      });
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
      expect(view.getByText(verification ? 'linux.do 安全验证' : 'linux.do 登录')).toBeTruthy();
      expect(view.getByTestId('login-webview').props.source.uri).toBe(
        verification
          ? 'https://cdk.linux.do/'
          : type === 'open-login-with-fill'
            ? LOGIN_FORM_ADAPTERS.linuxdo.loginUrl
            : 'https://linux.do/latest'
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
      expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
        false
      );
      await fireEvent.press(view.getByText(verification ? '检测并继续' : '检测登录'));
      await waitFor(() =>
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
          true
        )
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
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(false);
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
  seedLinuxDoAccount();
  await act(async () => {
    await hook.result.current.hosts.showLinuxDoVerification('登录');
  });
  jest.mocked(setLinuxDoCookieResponseBarrier).mockRejectedValueOnce(new Error('disk unavailable'));
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(fetcher).not.toHaveBeenCalled();
  await waitFor(() => expect(hook.result.current.read.statusBusy).toBe(false));
  expect(hook.result.current.read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
    false
  );
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
  expect(hook.result.current.read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
    true
  );
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
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(false);

    await act(async () => handoff.resolve());
    await waitFor(() =>
      expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(true)
    );
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
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(false);
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
    expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(false);
    await fireEvent.press(view.getByLabelText('关闭'));
    await waitFor(() =>
      expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(true)
    );
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

describe('manual linux.do login with attached read recovery', () => {
  async function renderLinuxDoAccountHosts(
    fetcher: Fetcher,
    initial: 'anonymous' | 'logged-in' | 'unknown',
    enabledSources: readonly Source[] = ['v2ex', 'linuxdo']
  ) {
    if (initial === 'logged-in') {
      await saveAccountSessionSnapshot(seedLinuxDoAccount('alice'));
    } else if (initial === 'anonymous') {
      const anonymous = {
        ...createAccountSessionSnapshot('linuxdo'),
        status: 'anonymous' as const,
        identityTrust: 'none' as const
      };
      appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), anonymous);
      await saveAccountSessionSnapshot(anonymous);
    } else {
      appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), createAccountSessionSnapshot('linuxdo'));
    }
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    function Harness({ sources = enabledSources }: { sources?: readonly Source[] }) {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: sources,
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
      await runtime.center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
    });
    await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
    return {
      view,
      runtime: () => runtime,
      notify,
      rerender: (sources: readonly Source[]) => view.rerender(<Harness sources={sources} />)
    };
  }

  it.each(['persistence', 'delayed persistence', 'reopen'] as const)(
    'keeps the handoff barrier during %s',
    async (scenario) => {
      jest.useFakeTimers();
      const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
        if (url === 'https://linux.do/session/current.json')
          return Response.json({ current_user: { id: 42, username: 'alice' } });
        throw new Error(`Unexpected request ${url}`);
      });
      const { view, runtime } = await renderLinuxDoAccountHosts(fetcher, 'logged-in');
      const originalSave = AsyncStorage.setItem;
      const storageWrite = Promise.withResolvers<void>();
      const saveStarted = jest.fn();
      const save = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
        if (key === 'account-session.v1.linuxdo' && !JSON.parse(value).handoffPending) {
          if (scenario === 'persistence') throw new Error('read-only store');
          if (scenario === 'delayed persistence') {
            saveStarted();
            await storageWrite.promise;
          }
        }
        return originalSave(key, value);
      });
      const resume = jest.fn(async () => 'verification-required' as const);
      try {
        await act(async () => {
          await runtime().hosts.showLinuxDoVerification('继续读取', {
            kind: 'reading',
            batchId: 9,
            isCurrent: () => true,
            cancel: jest.fn(),
            resume
          });
        });
        await fireEvent.press(view.getByText('检测并继续'));
        if (scenario === 'delayed persistence') await waitFor(() => expect(saveStarted).toHaveBeenCalledTimes(1));
        else await waitFor(() => expect(view.getByText('重新验证')).toBeTruthy());
        if (scenario === 'reopen') {
          expect(resume).toHaveBeenCalledTimes(1);
          await fireEvent.press(view.getByText('重新验证'));
          await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
        } else {
          expect(resume).not.toHaveBeenCalled();
        }
        expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
          false
        );
        await expect(runtime().write.ensureWritableSession('linuxdo')).rejects.toBeDefined();
        expect(JSON.parse((await AsyncStorage.getItem('account-session.v1.linuxdo'))!).handoffPending).toBe(true);
        if (scenario === 'delayed persistence') {
          await act(async () => storageWrite.resolve());
          await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
          expect(runtime().read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice', 'foreground-read')).toBe(
            true
          );
        }
      } finally {
        storageWrite.resolve();
        save.mockRestore();
        await view.unmount();
        jest.useRealTimers();
      }
    }
  );

  it.each(['topic', 'feed', 'aggregate-feed'] as const)(
    'resumes an attached public %s read once when a confirmed anonymous user stays anonymous',
    async (kind) => {
      jest.useFakeTimers();
      const order: string[] = [];
      const postCalls: string[] = [];
      const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url, init) => {
        if ((init?.method || 'GET').toUpperCase() !== 'GET') postCalls.push(url);
        if (url === 'https://linux.do/session/current.json') {
          order.push('verify-account');
          return new Response('', { status: 404 });
        }
        throw new Error(`Unexpected request ${url}`);
      });
      const { view, runtime } = await renderLinuxDoAccountHosts(fetcher, 'anonymous');
      try {
        const epochs = runtime().read.forumSessionEpochs;
        const plan =
          kind === 'topic'
            ? runtime().read.readGateway.getReadPlan('linuxdo', 'topic')
            : runtime().read.readGateway.getReadPlan('linuxdo', 'feed');
        expect(plan).toMatchObject({ state: 'ready', lane: 'public', cacheScope: 'public:omit' });
        const queryKey =
          kind === 'topic'
            ? forumQueryKeys.topic({
                source: 'linuxdo',
                topicId: '777',
                scope: epochs,
                readPlanScope: plan.cacheScope
              })
            : kind === 'feed'
              ? forumQueryKeys.feed({
                  source: 'linuxdo',
                  scope: epochs,
                  readPlanScope: plan.cacheScope
                })
              : forumQueryKeys.feed({
                  source: 'all',
                  enabledSourcesKey: 'v2ex,linuxdo',
                  scope: epochs,
                  readPlanScope: `v2ex:public:omit,linuxdo:${plan.cacheScope}`
                });
        const cancel = jest.fn();
        const resume = jest.fn(async () => {
          order.push('resume-read');
          return 'completed' as const;
        });
        await act(async () => {
          expect(
            await runtime().hosts.showLinuxDoVerification('公开读取需要验证', {
              queryKey,
              isCurrent: () => true,
              cancel,
              resume
            })
          ).toBe(true);
        });
        jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(async (blocked, reason) => {
          expect(blocked).toBe(false);
          expect(reason).toBe('surface-close');
          order.push('handoff-cookies');
        });
        await fireEvent.press(view.getByText('检测并继续'));
        await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));

        expect(order).toEqual(['handoff-cookies', 'verify-account', 'resume-read']);
        expect(runtime().read.forumSessionEpochs.linuxdo).toBe(epochs.linuxdo);
        expect(resume).toHaveBeenCalledTimes(1);
        expect(cancel).not.toHaveBeenCalled();
        expect(postCalls).toEqual([]);
        expect(JSON.parse((await AsyncStorage.getItem('account-session.v1.linuxdo'))!).handoffPending).toBeUndefined();
      } finally {
        await view.unmount();
        jest.useRealTimers();
      }
    }
  );

  it.each([
    'account-switch',
    'logged-in-to-anonymous',
    'identity-still-unknown',
    'leaving-original-page',
    'stale-webview-callback'
  ] as const)('does not resume attached reads or replay writes on %s from manual linux.do login', async (scenario) => {
    jest.useFakeTimers();
    const postCalls: string[] = [];
    const deferredVerify = Promise.withResolvers<Response>();
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url, init) => {
      if ((init?.method || 'GET').toUpperCase() !== 'GET') postCalls.push(url);
      if (url === 'https://linux.do/session/current.json') {
        if (scenario === 'stale-webview-callback') return deferredVerify.promise;
        if (scenario === 'account-switch') return Response.json({ current_user: { id: 88, username: 'bob' } });
        if (scenario === 'logged-in-to-anonymous' || scenario === 'leaving-original-page')
          return new Response('', { status: 404 });
        return new Response('server unavailable', { status: 503 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const initial =
      scenario === 'account-switch' || scenario === 'logged-in-to-anonymous'
        ? 'logged-in'
        : scenario === 'identity-still-unknown'
          ? 'unknown'
          : 'anonymous';
    const { view, runtime } = await renderLinuxDoAccountHosts(fetcher, initial);
    try {
      const epochs = runtime().read.forumSessionEpochs;
      let pageCurrent = true;
      const cancel = jest.fn();
      const resume = jest.fn(async () => 'completed' as const);
      await act(async () => {
        await runtime().hosts.showLinuxDoVerification('读取需要验证', {
          queryKey: forumQueryKeys.topic({
            source: 'linuxdo',
            topicId: '888',
            scope: epochs,
            readPlanScope: 'public:omit'
          }),
          isCurrent: () => pageCurrent,
          cancel,
          resume
        });
      });
      if (scenario === 'leaving-original-page') pageCurrent = false;
      const oldWebView = view.getByTestId('login-webview');
      await fireEvent.press(view.getByText('检测并继续'));
      if (scenario === 'stale-webview-callback') {
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        await fireEvent.press(view.getByLabelText('关闭'));
        await act(async () => {
          oldWebView.props.onMessage({
            nativeEvent: {
              url: 'https://linux.do/latest',
              data: JSON.stringify({
                type: 'linuxdo-webview',
                documentKey: 'https://linux.do/latest:9999',
                status: 'logged-out',
                hasChallengeMarker: false,
                userAgent: 'late-agent'
              })
            }
          });
          deferredVerify.resolve(new Response('', { status: 404 }));
        });
      }
      await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
      expect(resume).not.toHaveBeenCalled();
      expect(postCalls).toEqual([]);
    } finally {
      deferredVerify.resolve(new Response('', { status: 404 }));
      await view.unmount();
      jest.useRealTimers();
    }
  });
});

describe('NodeImage mount-gated authorization timers and interruptions', () => {
  async function renderNodeSeekRuntime(fetcher: Fetcher, initialBlockMessage = '') {
    const { response } = accountClearFixture('nodeseek');
    await saveAccountSessionSnapshot(appQueryClient.getQueryData(accountQueryKeys.snapshot('nodeseek'))!);
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    function Harness({ blockedMessage = initialBlockMessage }: { blockedMessage?: string }) {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['nodeseek'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: true,
        screen: 'more',
        webViewBlockMessage: blockedMessage
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness blockedMessage={initialBlockMessage} />, { wrapper: QueryTestWrapper });
    await waitFor(() => expect(runtime.read.sessionsReady).toBe(true));
    return {
      view,
      runtime: () => runtime,
      response,
      setBlockedMessage: (blockedMessage: string) => view.rerender(<Harness blockedMessage={blockedMessage} />)
    };
  }

  function sendNodeImageMessage(
    webView: { props: { injectedJavaScript?: string; onMessage?: (event: unknown) => void } },
    sourceUrl: string,
    documentUrl: string,
    type: string,
    data: Record<string, unknown> = {}
  ) {
    const nonce = webView.props.injectedJavaScript?.match(/const nonce = "([0-9a-f]{32})";/)?.[1];
    if (!nonce) throw new Error('NodeImage nonce missing from WebView');
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({ ...data, documentUrl, nonce, type }),
        url: sourceUrl
      }
    });
  }

  it('does not time out stage 1 during global proxy block and mounts normally after unblock', async () => {
    const { response } = accountClearFixture('nodeseek');
    const fetcher = jest.fn(async () => response());
    const { view, runtime, setBlockedMessage } = await renderNodeSeekRuntime(fetcher, '代理状态切换中');
    try {
      jest.useFakeTimers();
      await act(async () => {
        runtime().center.nodeImage.key.authorize();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(view.getByText('代理状态切换中')).toBeTruthy();
      expect(view.queryByTestId('login-webview')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(30_001);
        await Promise.resolve();
      });
      expect(view.getByText('代理状态切换中')).toBeTruthy();
      expect(view.queryByText(/NodeImage 登录态检查超时/)).toBeNull();

      await act(async () => {
        await setBlockedMessage('');
        await Promise.resolve();
      });
      expect(view.getByTestId('login-webview').props.source).toEqual({ uri: 'https://www.nodeimage.com/' });
      expect(view.queryByText(/NodeImage 登录态检查超时/)).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(29_999);
        await Promise.resolve();
      });
      expect(view.getByTestId('login-webview')).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(view.queryByTestId('login-webview')).toBeNull();
      expect(view.getByText(/本次未发起 NodeSeek Connect/)).toBeTruthy();
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  });

  it('does not time out stage 1 during pending NodeSeek handoff marker block and mounts after save completes', async () => {
    const { response } = accountClearFixture('nodeseek');
    const fetcher = jest.fn(async () => response());
    const { view, runtime } = await renderNodeSeekRuntime(fetcher, '');
    const handoffDeferred = Promise.withResolvers<void>();
    const handoffSpy = jest
      .spyOn(accountSessionStore, 'markAccountSessionHandoffPending')
      .mockImplementation(() => handoffDeferred.promise);
    try {
      jest.useFakeTimers();
      await act(async () => {
        runtime().center.nodeImage.key.authorize();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(view.getByText('正在保存登录交接状态…')).toBeTruthy();
      expect(view.queryByTestId('login-webview')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(30_001);
        await Promise.resolve();
      });
      expect(view.getByText('正在保存登录交接状态…')).toBeTruthy();
      expect(view.queryByText(/NodeImage 登录态检查超时/)).toBeNull();

      await act(async () => {
        handoffDeferred.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(view.getByTestId('login-webview').props.source).toEqual({ uri: 'https://www.nodeimage.com/' });
      expect(view.queryByText(/NodeImage 登录态检查超时/)).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(29_999);
        await Promise.resolve();
      });
      expect(view.getByTestId('login-webview')).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(view.queryByTestId('login-webview')).toBeNull();
      expect(view.getByText(/本次未发起 NodeSeek Connect/)).toBeTruthy();
    } finally {
      handoffDeferred.resolve();
      handoffSpy.mockRestore();
      await view.unmount();
      jest.useRealTimers();
    }
  });

  it.each(['connect-started', 'verify-mounted'] as const)(
    'retains unknown-result state without remounting after mid-flow proxy block during %s',
    async (stage) => {
      const { response } = accountClearFixture('nodeseek');
      const fetcher = jest.fn(async () => response());
      const { view, runtime, setBlockedMessage } = await renderNodeSeekRuntime(fetcher, '');
      const setItemSpy = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
      try {
        jest.useFakeTimers();
        await act(async () => {
          runtime().center.nodeImage.key.authorize();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        const stage1WebView = view.getByTestId('login-webview');
        await act(async () => {
          sendNodeImageMessage(
            stage1WebView,
            'https://www.nodeimage.com',
            'https://www.nodeimage.com/',
            'nodeimage-session-expired',
            { status: 401 }
          );
          await Promise.resolve();
        });
        const stage2WebView = view.getByTestId('login-webview');
        expect(stage2WebView.props.source).toEqual({ uri: 'https://www.nodeseek.com/connect?target=NodeImage' });
        await act(async () => {
          sendNodeImageMessage(
            stage2WebView,
            'https://www.nodeseek.com',
            'https://www.nodeseek.com/connect?target=NodeImage',
            'nodeimage-connect-ready'
          );
          await Promise.resolve();
        });
        expect(mockWebViewPostMessage).toHaveBeenCalledTimes(1);

        let interruptedWebView = stage2WebView;
        if (stage === 'verify-mounted') {
          await act(async () => {
            sendNodeImageMessage(
              stage2WebView,
              'https://www.nodeseek.com',
              'https://www.nodeseek.com/connect?target=NodeImage',
              'nodeimage-auth-data',
              { data: 'auth-data', sign: 'auth-sign', wtf: 'auth-wtf' }
            );
            await Promise.resolve();
          });
          interruptedWebView = view.getByTestId('login-webview');
          expect(interruptedWebView.props.source).toEqual({ uri: 'https://www.nodeimage.com/' });
        }

        await act(async () => {
          await setBlockedMessage('代理状态切换中');
          jest.advanceTimersByTime(1_000);
          await Promise.resolve();
        });
        expect(view.queryByTestId('login-webview')).toBeNull();
        expect(view.getByText('代理状态切换中')).toBeTruthy();

        await act(async () => {
          await setBlockedMessage('');
          await Promise.resolve();
        });
        expect(view.queryByTestId('login-webview')).toBeNull();
        expect(
          view.getByText(stage === 'connect-started' ? /可能已占用一次连接额度/ : /API Key 结果未知/)
        ).toBeTruthy();
        expect(view.queryByText(/超时/)).toBeNull();

        await act(async () => {
          jest.advanceTimersByTime(60_001);
          await Promise.resolve();
        });
        expect(view.queryByText(/超时/)).toBeNull();

        await act(async () => {
          if (stage === 'connect-started') {
            sendNodeImageMessage(
              interruptedWebView,
              'https://www.nodeseek.com',
              'https://www.nodeseek.com/connect?target=NodeImage',
              'nodeimage-connect-ready'
            );
          } else {
            sendNodeImageMessage(
              interruptedWebView,
              'https://www.nodeimage.com',
              'https://www.nodeimage.com/',
              'nodeimage-api-key',
              { apiKey: 'late-key-after-block' }
            );
          }
          await Promise.resolve();
        });
        expect(mockWebViewPostMessage).toHaveBeenCalledTimes(1);
        expect(setItemSpy).not.toHaveBeenCalled();
      } finally {
        setItemSpy.mockRestore();
        await view.unmount();
        jest.useRealTimers();
      }
    }
  );
});
