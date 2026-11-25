import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React, { createRef } from 'react';
import { AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createAccountHostStyles } from '@/features/account/accountHostStyles';
import type { useLinuxDoCreditAuthController } from '@/features/account/useLinuxDoCreditAuthController';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme, resolveReaderStyleSettings } from '@/ui/theme/tokens';
import { act, fireEvent, render } from '../render';

const mockShouldStartLoadWithLockIdentifier = jest.fn<(shouldStart: boolean, lockIdentifier: number) => void>();
const mockReload = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Check: Icon, CircleAlert: Icon, RefreshCw: Icon, X: Icon };
});

jest.mock('react-native-webview/lib/NativeRNCWebViewModule', () => ({
  __esModule: true,
  default: {
    shouldStartLoadWithLockIdentifier: (shouldStart: boolean, lockIdentifier: number) =>
      mockShouldStartLoadWithLockIdentifier(shouldStart, lockIdentifier)
  }
}));

jest.mock('react-native-webview/lib/RNCWebViewNativeComponent', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const RNCWebView = ReactModule.forwardRef(function MockRNCWebView(
    props: Record<string, unknown>,
    ref: React.ForwardedRef<unknown>
  ) {
    ReactModule.useImperativeHandle(ref, () => ({ nativeTag: 1 }), []);
    return ReactModule.createElement(NativeView, { ...props, testID: 'rnc-native-webview' });
  });
  return {
    __esModule: true,
    default: RNCWebView,
    Commands: {
      goBack: () => undefined,
      goForward: () => undefined,
      reload: () => mockReload(),
      stopLoading: () => undefined,
      injectJavaScript: () => undefined,
      requestFocus: () => undefined,
      postMessage: () => undefined,
      loadUrl: () => undefined,
      clearFormData: () => undefined,
      clearCache: () => undefined,
      clearHistory: () => undefined
    }
  };
});

jest.mock('react-native-webview', () => {
  const ActualAndroidWebView = jest.requireActual<{ default: unknown }>(
    'react-native-webview/lib/WebView.android'
  ).default;
  return {
    __esModule: true,
    default: ActualAndroidWebView,
    WebView: ActualAndroidWebView
  };
});

import { LinuxDoCreditAuthModal } from '@/features/account/components/LinuxDoCreditAuthModal';

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styleSettings = resolveReaderStyleSettings(readerData.settings);
const accountHostStyles = createAccountHostStyles(theme, styleSettings);

function createSyntheticEvent<T extends Record<string, unknown>>(nativeEvent: T) {
  let defaultPrevented = false;
  return {
    nativeEvent,
    persist: jest.fn(),
    preventDefault: jest.fn(() => {
      defaultPrevented = true;
    }),
    isDefaultPrevented: () => defaultPrevented
  };
}

function createNavigationNativeEvent(url: string, overrides: Record<string, unknown> = {}) {
  return {
    url,
    loading: false,
    title: '',
    canGoBack: false,
    canGoForward: false,
    lockIdentifier: 0,
    navigationType: 'other',
    ...overrides
  };
}

function emitMainFrameLoadStart(
  nativeWebView: { props: Record<string, unknown> },
  url: string,
  overrides: Record<string, unknown> = {}
) {
  const handler = nativeWebView.props.onMainFrameLoadStart;
  expect(typeof handler).toBe('function');
  (handler as (event: unknown) => void)(
    createSyntheticEvent(createNavigationNativeEvent(url, { loading: true, ...overrides }))
  );
}

describe('LinuxDoCreditAuthModal WebView navigation and error seam', () => {
  const initialAppState = AppState.currentState;

  beforeEach(() => {
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    mockShouldStartLoadWithLockIdentifier.mockReset();
    mockReload.mockReset();
  });

  afterEach(() => {
    AppState.currentState = initialAppState;
    jest.restoreAllMocks();
  });

  async function renderModal() {
    const close = jest.fn(async () => undefined);
    const retry = jest.fn();
    const failSilent = jest.fn();
    const handleMessage = jest.fn();
    const webViewRef = createRef<WebView>();
    function Harness({ generation }: { generation: number }) {
      const panel: ReturnType<typeof useLinuxDoCreditAuthController>['panel'] = {
        close,
        document: { generation, mode: 'manual', userAgent: 'test-agent' },
        error: '',
        generation,
        preparing: false,
        retry,
        visible: true,
        webViewRef,
        handleMessage,
        failSilent
      };
      return (
        <ReaderStyleProvider value={{ settings: styleSettings, theme }}>
          <LinuxDoCreditAuthModal panel={panel} styles={accountHostStyles} webViewBlockMessage="" />
        </ReaderStyleProvider>
      );
    }
    const view = await render(<Harness generation={1} />);
    return { view, close, replaceDocument: () => view.rerender(<Harness generation={2} />) };
  }

  it('opts into Android onMainFrameLoadStart while leaving onLoadStart unchanged for other WebViews', async () => {
    const { view } = await renderModal();
    const modalNativeWebView = view.getByTestId('rnc-native-webview');
    expect(modalNativeWebView.props.hasOnMainFrameLoadStart).toBe(true);
    expect(typeof modalNativeWebView.props.onMainFrameLoadStart).toBe('function');
    expect(modalNativeWebView.props.androidNavigationAllowedOrigins).toEqual([
      'https://credit.linux.do',
      'https://connect.linux.do',
      'https://linux.do',
      'https://challenges.cloudflare.com'
    ]);
    await view.unmount();

    const onLoadStart = jest.fn();
    const onNavigationStateChange = jest.fn();
    const plain = await render(
      <WebView
        source={{ uri: 'https://credit.linux.do/home' }}
        onLoadStart={onLoadStart}
        onNavigationStateChange={onNavigationStateChange}
      />
    );
    const plainNativeWebView = plain.getByTestId('rnc-native-webview');
    expect(plainNativeWebView.props.hasOnMainFrameLoadStart).toBe(false);
    expect(plainNativeWebView.props.androidNavigationAllowedOrigins).toBeUndefined();

    const historyEvent = createSyntheticEvent(
      createNavigationNativeEvent('https://credit.linux.do/home', { loading: true })
    );
    await act(async () => {
      plainNativeWebView.props.onLoadingStart(historyEvent);
    });
    expect(onLoadStart).toHaveBeenCalledWith(historyEvent);
    expect(onNavigationStateChange).toHaveBeenCalledWith(historyEvent.nativeEvent);
    await plain.unmount();
  });

  it.each<{
    history: 'subframe' | 'retired main frame' | 'settled main frame';
    error: 'HTTP error' | 'network error';
    next: 'start' | 'finish';
  }>([
    { history: 'subframe', error: 'HTTP error', next: 'start' },
    { history: 'retired main frame', error: 'HTTP error', next: 'finish' },
    { history: 'settled main frame', error: 'HTTP error', next: 'start' },
    { history: 'subframe', error: 'network error', next: 'start' },
    { history: 'retired main frame', error: 'network error', next: 'start' },
    { history: 'settled main frame', error: 'network error', next: 'start' }
  ])('settles a new POST with $history history and $error before $next', async ({ history, error, next }) => {
    const { view } = await renderModal();
    const webView = view.getByTestId('rnc-native-webview');
    const target = 'https://connect.linux.do/form';
    const currentUrl = history === 'settled main frame' ? target : 'https://credit.linux.do/home';
    await act(async () => {
      if (history === 'retired main frame') emitMainFrameLoadStart(webView, target);
      emitMainFrameLoadStart(webView, currentUrl);
      webView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(currentUrl)));
      if (history === 'subframe') {
        webView.props.onShouldStartLoadWithRequest(
          createSyntheticEvent(createNavigationNativeEvent(target, { isTopFrame: false, lockIdentifier: 1 }))
        );
      }
    });

    if (error === 'HTTP error') {
      await act(async () => {
        webView.props.onHttpError(
          createSyntheticEvent({ ...createNavigationNativeEvent(target), statusCode: 500, description: 'Failed' })
        );
        if (next === 'start') emitMainFrameLoadStart(webView, target);
        webView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(target)));
      });
      expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();
    } else {
      const networkError = createSyntheticEvent({
        ...createNavigationNativeEvent(target),
        code: -2,
        description: 'net::ERR_NAME_NOT_RESOLVED'
      });
      await act(async () => {
        webView.props.onLoadingError(networkError);
        emitMainFrameLoadStart(webView, target);
      });
      expect(networkError.isDefaultPrevented()).toBe(false);
      expect(view.getByText('LDC 页面加载失败：net::ERR_NAME_NOT_RESOLVED')).toBeTruthy();
    }
  });

  it('ignores late errors and renderer exit from a replaced WebView instance', async () => {
    const { view, replaceDocument } = await renderModal();
    const old = view.getByTestId('rnc-native-webview');
    const oldError = old.props.onLoadingError;
    const oldRendererExit = old.props.onRenderProcessGone;
    const home = 'https://credit.linux.do/home';

    await replaceDocument();
    const current = view.getByTestId('rnc-native-webview');
    await act(async () => {
      emitMainFrameLoadStart(current, home);
      current.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(home)));
    });

    const late = createSyntheticEvent({
      ...createNavigationNativeEvent(home),
      code: -2,
      description: 'net::ERR_NAME_NOT_RESOLVED'
    });
    await act(async () => {
      oldError(late);
      oldRendererExit(createSyntheticEvent({ didCrash: false }));
    });
    expect(late.isDefaultPrevented()).toBe(true);
    expect(view.queryByText(/页面加载失败|页面已停止/)).toBeNull();
    expect(view.getByTestId('rnc-native-webview')).toBe(current);
  });

  it('leaves an unattributed network error with an unrecognized URL to native handling', async () => {
    const { view } = await renderModal();
    const webView = view.getByTestId('rnc-native-webview');
    const error = createSyntheticEvent({
      ...createNavigationNativeEvent('about:blank'),
      code: -1,
      description: 'net::ERR_FAILED'
    });
    await act(async () => {
      webView.props.onLoadingError(error);
    });
    expect(error.isDefaultPrevented()).toBe(false);
    expect(view.getByText('LDC 页面加载失败：net::ERR_FAILED')).toBeTruthy();
  });

  it.each(['direct', 'android-finish-before-error'] as const)(
    'shows a pre-onLoadStart network error after approving top-level GET auth navigation (%s)',
    async (order) => {
      const { view } = await renderModal();
      const nativeWebView = view.getByTestId('rnc-native-webview');
      const homeUrl = 'https://credit.linux.do/home';
      const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';

      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, homeUrl);
        nativeWebView.props.onLoadingStart(
          createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true }))
        );
        nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      });
      expect(view.queryByText('正在打开 LDC…')).toBeNull();

      await act(async () => {
        nativeWebView.props.onShouldStartLoadWithRequest(
          createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 1 }))
        );
      });
      expect(mockShouldStartLoadWithLockIdentifier).toHaveBeenCalledWith(true, 1);

      const dnsError = createSyntheticEvent({
        ...createNavigationNativeEvent(authUrl),
        code: -2,
        description: 'net::ERR_NAME_NOT_RESOLVED'
      });
      await act(async () => {
        if (order === 'android-finish-before-error') {
          nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
        }
        nativeWebView.props.onLoadingError(dnsError);
      });

      expect(view.getByText('LDC 页面加载失败：net::ERR_NAME_NOT_RESOLVED')).toBeTruthy();
      expect(dnsError.isDefaultPrevented()).toBe(false);
      expect(nativeWebView.parent?.children).toHaveLength(2);

      // Chromium error-page commit may follow onReceivedError with doUpdateVisitedHistory (loading: false).
      await act(async () => {
        nativeWebView.props.onLoadingStart(
          createSyntheticEvent(createNavigationNativeEvent(authUrl, { loading: false }))
        );
      });
      expect(view.getByText('LDC 页面加载失败：net::ERR_NAME_NOT_RESOLVED')).toBeTruthy();

      // Refreshing clears the previous error and still surfaces a repeated pre-onLoadStart DNS error on reload.
      await fireEvent.press(view.getByLabelText('刷新页面'));
      expect(mockReload).toHaveBeenCalledTimes(1);
      expect(view.queryByText(/ERR_NAME_NOT_RESOLVED/)).toBeNull();

      const retryError = createSyntheticEvent({
        ...createNavigationNativeEvent(authUrl),
        code: -2,
        description: 'net::ERR_CONNECTION_REFUSED'
      });
      await act(async () => {
        nativeWebView.props.onLoadingError(retryError);
      });
      expect(view.getByText('LDC 页面加载失败：net::ERR_CONNECTION_REFUSED')).toBeTruthy();
      expect(retryError.isDefaultPrevented()).toBe(false);
    }
  );

  it.each(['direct', 'android-finish-before-error'] as const)(
    'shows early network and HTTP errors on POST submissions without shouldOverrideUrlLoading (%s)',
    async (order) => {
      const { view } = await renderModal();
      const nativeWebView = view.getByTestId('rnc-native-webview');
      const homeUrl = 'https://credit.linux.do/home';
      const postAuthUrl = 'https://connect.linux.do/oauth2/authorize';
      const post404Url = 'https://credit.linux.do/api/v1/oauth/submit';
      const post500Url = 'https://credit.linux.do/oauth/callback';

      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, homeUrl);
        nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      });
      expect(view.queryByText('正在打开 LDC…')).toBeNull();

      // POST navigation emits onPageStarted (onMainFrameLoadStart) without shouldOverrideUrlLoading.
      const postNetworkError = createSyntheticEvent({
        ...createNavigationNativeEvent(postAuthUrl),
        code: -6,
        description: 'net::ERR_CONNECTION_REFUSED'
      });
      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, postAuthUrl);
        if (order === 'android-finish-before-error') {
          nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(postAuthUrl)));
        }
        nativeWebView.props.onLoadingError(postNetworkError);
      });
      expect(view.getByText('LDC 页面加载失败：net::ERR_CONNECTION_REFUSED')).toBeTruthy();
      expect(postNetworkError.isDefaultPrevented()).toBe(false);
      expect(nativeWebView.parent?.children).toHaveLength(2);
      expect(mockShouldStartLoadWithLockIdentifier).not.toHaveBeenCalled();

      // POST returning HTTP 404 followed by doUpdateVisitedHistory (onLoadStart) and onPageFinished.
      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, post404Url);
        nativeWebView.props.onHttpError(
          createSyntheticEvent({
            ...createNavigationNativeEvent(post404Url),
            statusCode: 404,
            description: 'Not Found'
          })
        );
        nativeWebView.props.onLoadingStart(
          createSyntheticEvent(createNavigationNativeEvent(post404Url, { loading: true }))
        );
        nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(post404Url)));
      });
      expect(view.getByText('LDC 页面加载失败：HTTP 404')).toBeTruthy();

      // POST returning HTTP 500 followed by doUpdateVisitedHistory and onPageFinished.
      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, post500Url);
        nativeWebView.props.onHttpError(
          createSyntheticEvent({
            ...createNavigationNativeEvent(post500Url),
            statusCode: 500,
            description: 'Internal Server Error'
          })
        );
        nativeWebView.props.onLoadingStart(
          createSyntheticEvent(createNavigationNativeEvent(post500Url, { loading: true }))
        );
        nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(post500Url)));
      });
      expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

      // Current document offline network failure.
      const offlineError = createSyntheticEvent({
        ...createNavigationNativeEvent(homeUrl),
        code: -2,
        description: 'net::ERR_INTERNET_DISCONNECTED'
      });
      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, homeUrl);
        if (order === 'android-finish-before-error') {
          nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
        }
        nativeWebView.props.onLoadingError(offlineError);
      });
      expect(view.getByText('LDC 页面加载失败：net::ERR_INTERNET_DISCONNECTED')).toBeTruthy();
      expect(offlineError.isDefaultPrevented()).toBe(false);
    }
  );

  it('shows errors on redirects without shouldOverrideUrlLoading with or without a second onMainFrameLoadStart', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const hopUrl = 'https://credit.linux.do/oauth/login';
    const redirect403Url = 'https://connect.linux.do/oauth2/authorize?redirect=1';
    const redirectDnsUrl = 'https://connect.linux.do/oauth2/authorize?redirect=dns';
    const redirect500Url = 'https://credit.linux.do/oauth/callback?redirect=500';

    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });

    // 1. Redirect emits onMainFrameLoadStart(target) without shouldOverrideUrlLoading -> HTTP 403.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, redirect403Url);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(redirect403Url),
          statusCode: 403,
          description: 'Forbidden'
        })
      );
      nativeWebView.props.onLoadingStart(
        createSyntheticEvent(createNavigationNativeEvent(redirect403Url, { loading: true }))
      );
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(redirect403Url)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 403')).toBeTruthy();

    // 2. In-flight 302 redirect fails DNS before emitting a second onMainFrameLoadStart (finish-before-error).
    const redirectDnsError = createSyntheticEvent({
      ...createNavigationNativeEvent(redirectDnsUrl),
      code: -2,
      description: 'net::ERR_NAME_NOT_RESOLVED'
    });
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, hopUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(redirectDnsUrl)));
      nativeWebView.props.onLoadingError(redirectDnsError);
    });
    expect(view.getByText('LDC 页面加载失败：net::ERR_NAME_NOT_RESOLVED')).toBeTruthy();
    expect(redirectDnsError.isDefaultPrevented()).toBe(false);

    // 3. In-flight 302 redirect returns HTTP 500 without a second onMainFrameLoadStart.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, hopUrl);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(redirect500Url),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
      nativeWebView.props.onLoadingStart(
        createSyntheticEvent(createNavigationNativeEvent(redirect500Url, { loading: true }))
      );
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(redirect500Url)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

    // 4. In-flight 302 redirect back to /home returning HTTP 403 stays suppressed and settles cleanly.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, hopUrl);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(homeUrl),
          statusCode: 403,
          description: 'Forbidden'
        })
      );
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText(/HTTP 403/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();
    expect(view.queryByText('正在打开 LDC…')).toBeNull();
  });

  it('prevents stale history callbacks (onLoadStart / doUpdateVisitedHistory) from advancing main-frame state or clearing errors', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const spaHistoryUrl = 'https://credit.linux.do/oauth/push-state';
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';

    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText('正在打开 LDC…')).toBeNull();

    // History callback alone must not advance current document or re-enter loading.
    await act(async () => {
      nativeWebView.props.onLoadingStart(
        createSyntheticEvent(createNavigationNativeEvent(spaHistoryUrl, { loading: true }))
      );
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(spaHistoryUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
    });
    expect(view.queryByText('正在打开 LDC…')).toBeNull();
    expect(view.queryByText(/HTTP 500/)).toBeNull();

    // Stale history callback for an interrupted unsettled document must not clear a current main-frame HTTP error or rewind ownership.
    const interruptedUrl = 'https://credit.linux.do/oauth/interrupted';
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, interruptedUrl);
      emitMainFrameLoadStart(nativeWebView, authUrl);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(authUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
      nativeWebView.props.onLoadingStart(
        createSyntheticEvent(createNavigationNativeEvent(interruptedUrl, { loading: true }))
      );
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(authUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

    // And a late error on the interrupted unsettled document stays confirmed retired (preventDefault) despite the stale history callback.
    const staleInterruptedError = createSyntheticEvent({
      ...createNavigationNativeEvent(interruptedUrl),
      code: -3,
      description: 'net::ERR_ABORTED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(staleInterruptedError);
    });
    expect(staleInterruptedError.isDefaultPrevented()).toBe(true);
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();
  });

  it('preserves pre-start HTTP errors across commit-time onMainFrameLoadStart and clears them on a subsequent navigation or refresh', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
    const postUrl = 'https://credit.linux.do/oauth/callback';

    // 1. Initial load: onHttpError(500) -> commit-time onMainFrameLoadStart -> onLoadStart -> onLoadEnd.
    await act(async () => {
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(homeUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

    // Subsequent genuine navigation to the same URL (started is now true) clears the previous error.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText(/HTTP 500/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    // 2. Refresh reload: onHttpError(502) -> commit-time onMainFrameLoadStart -> onLoadEnd.
    await fireEvent.press(view.getByLabelText('刷新页面'));
    await act(async () => {
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(homeUrl),
          statusCode: 502,
          description: 'Bad Gateway'
        })
      );
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 502')).toBeTruthy();

    // 3. Approved GET navigation (including same-URL re-navigation): onHttpError(403) -> commit-time onMainFrameLoadStart -> onLoadEnd.
    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 1 }))
      );
      emitMainFrameLoadStart(nativeWebView, authUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 2 }))
      );
      nativeWebView.props.onHttpError(
        createSyntheticEvent({ ...createNavigationNativeEvent(authUrl), statusCode: 403, description: 'Forbidden' })
      );
      emitMainFrameLoadStart(nativeWebView, authUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(authUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 403')).toBeTruthy();

    // 4. POST / redirect without shouldOverrideUrlLoading: pre-start onHttpError(500) -> commit-time onMainFrameLoadStart -> onLoadEnd.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await act(async () => {
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(postUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
      emitMainFrameLoadStart(nativeWebView, postUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(postUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(postUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

    // Pressing refresh clears the error and succeeds on reload.
    await fireEvent.press(view.getByLabelText('刷新页面'));
    expect(view.queryByText(/HTTP 500/)).toBeNull();
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, postUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(postUrl)));
    });
    expect(view.queryByText(/页面加载失败/)).toBeNull();
  });

  it('preserves pre-start network errors when error-page commit emits onMainFrameLoadStart after onLoadEnd -> onError', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';

    // 1. Initial load: pre-error onLoadEnd -> onError -> onLoadEnd(code) -> late error-page onMainFrameLoadStart.
    const initialOfflineError = createSyntheticEvent({
      ...createNavigationNativeEvent(homeUrl),
      code: -6,
      description: 'net::ERR_CONNECTION_REFUSED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      nativeWebView.props.onLoadingError(initialOfflineError);
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(
        createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: false }))
      );
    });
    expect(initialOfflineError.isDefaultPrevented()).toBe(false);
    expect(view.getByText('LDC 页面加载失败：net::ERR_CONNECTION_REFUSED')).toBeTruthy();

    // Subsequent genuine navigation to the same URL clears the error once it loads.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText(/ERR_CONNECTION_REFUSED/)).toBeNull();

    // 2. Approved GET navigation: pre-error onLoadEnd -> onError -> onLoadEnd(code) -> late error-page onMainFrameLoadStart.
    const authError = createSyntheticEvent({
      ...createNavigationNativeEvent(authUrl),
      code: -2,
      description: 'net::ERR_NAME_NOT_RESOLVED'
    });
    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 1 }))
      );
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
      nativeWebView.props.onLoadingError(authError);
      emitMainFrameLoadStart(nativeWebView, authUrl);
    });
    expect(authError.isDefaultPrevented()).toBe(false);
    expect(view.getByText('LDC 页面加载失败：net::ERR_NAME_NOT_RESOLVED')).toBeTruthy();
  });

  it.each(['direct', 'android-finish-before-error'] as const)(
    'surfaces HTTP 500 and network errors when POST -> 302 redirects back to a previously settled /home before a second onMainFrameLoadStart (%s)',
    async (order) => {
      const { view } = await renderModal();
      const nativeWebView = view.getByTestId('rnc-native-webview');
      const homeUrl = 'https://credit.linux.do/home';
      const authorizeUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
      const approveUrl = 'https://connect.linux.do/oauth2/approve';

      // Settle /home, then navigate to connect.linux.do/oauth2/authorize and settle it.
      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, homeUrl);
        nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
        emitMainFrameLoadStart(nativeWebView, authorizeUrl);
        nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authorizeUrl)));
      });
      expect(view.queryByText(/页面加载失败/)).toBeNull();

      // 1. POST /approve -> 302 back to previously settled /home returning HTTP 500 before any second onMainFrameLoadStart(/home).
      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, approveUrl);
        nativeWebView.props.onHttpError(
          createSyntheticEvent({
            ...createNavigationNativeEvent(homeUrl),
            statusCode: 500,
            description: 'Internal Server Error'
          })
        );
        nativeWebView.props.onLoadingStart(
          createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true }))
        );
        nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      });
      expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

      // 2. POST /approve -> 302 back to previously settled /home failing with ERR_CONNECTION_REFUSED before a second onMainFrameLoadStart(/home).
      const redirectRefusedError = createSyntheticEvent({
        ...createNavigationNativeEvent(homeUrl),
        code: -6,
        description: 'net::ERR_CONNECTION_REFUSED'
      });
      await act(async () => {
        emitMainFrameLoadStart(nativeWebView, approveUrl);
        if (order === 'android-finish-before-error') {
          nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
        }
        nativeWebView.props.onLoadingError(redirectRefusedError);
      });
      expect(redirectRefusedError.isDefaultPrevented()).toBe(false);
      expect(nativeWebView.parent?.children).toHaveLength(2);
      expect(view.getByText('LDC 页面加载失败：net::ERR_CONNECTION_REFUSED')).toBeTruthy();
    }
  );

  it('shows pre-onLoadStart HTTP 403 and 500 on approved non-home navigation while keeping homepage 403 suppressed', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
    const callbackUrl = 'https://credit.linux.do/oauth/callback?code=abc';

    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });

    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 1 }))
      );
      nativeWebView.props.onHttpError(
        createSyntheticEvent({ ...createNavigationNativeEvent(authUrl), statusCode: 403, description: 'Forbidden' })
      );
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(authUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 403')).toBeTruthy();

    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(callbackUrl, { isTopFrame: true, lockIdentifier: 2 }))
      );
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(callbackUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(callbackUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(homeUrl, { isTopFrame: true, lockIdentifier: 3 }))
      );
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({ ...createNavigationNativeEvent(homeUrl), statusCode: 403, description: 'Forbidden' })
      );
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText(/HTTP 403/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();
  });

  it('preserves pre-onLoadStart HTTP errors across onLoadStart on initial load, refresh reload, and same-URL re-navigation', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';

    // 1. Initial CREDIT_HOME_URL load: onHttpError(500) precedes onLoadStart(loading: true) -> onLoadEnd.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(homeUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

    // 2. Refresh reload: onHttpError(500) precedes onLoadStart(loading: true) -> onLoadEnd.
    await fireEvent.press(view.getByLabelText('刷新页面'));
    expect(view.queryByText(/HTTP 500/)).toBeNull();
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(homeUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 500')).toBeTruthy();

    // 3. Same-URL re-navigation on authUrl: onHttpError(403) precedes onLoadStart(loading: true) -> onLoadEnd.
    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 1 }))
      );
      emitMainFrameLoadStart(nativeWebView, authUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(authUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 2 }))
      );
      nativeWebView.props.onHttpError(
        createSyntheticEvent({ ...createNavigationNativeEvent(authUrl), statusCode: 403, description: 'Forbidden' })
      );
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(authUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 403')).toBeTruthy();
  });

  it('prevents a stale late network error from showing a banner or pushing a loaded homepage into WebView error state', async () => {
    const { view, close } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
    const homeUrl = 'https://credit.linux.do/home';

    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 1 }))
      );
      emitMainFrameLoadStart(nativeWebView, authUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(authUrl, { loading: true })));
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(homeUrl, { isTopFrame: true, lockIdentifier: 2 }))
      );
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText('正在打开 LDC…')).toBeNull();
    expect(nativeWebView.parent?.children).toHaveLength(1);

    const staleError = createSyntheticEvent({
      ...createNavigationNativeEvent(authUrl),
      code: -3,
      description: 'net::ERR_ABORTED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(staleError);
    });

    // Real WebView.android must stay in IDLE (only nativeWebView child, no renderError / default error view).
    expect(nativeWebView.parent?.children).toHaveLength(1);
    expect(staleError.isDefaultPrevented()).toBe(true);
    expect(view.queryByText(/ERR_ABORTED/)).toBeNull();
    expect(view.queryByText(/页面加载失败/)).toBeNull();
    expect(view.queryByText(/Error loading page/i)).toBeNull();
    expect(view.getByTestId('rnc-native-webview')).toBe(nativeWebView);

    await fireEvent.press(view.getByLabelText('完成并刷新'));
    expect(close).toHaveBeenCalledWith('success');
  });

  it('keeps sub-resource errors, sub-frame requests, disallowed hosts, superseded navigations, and refreshed pending URLs isolated', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const homeUrl = 'https://credit.linux.do/home';
    const iframeUrl = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile';
    const subResourceUrl = 'https://credit.linux.do/assets/turnstile.js';
    const blockedUrl = 'https://evil.example/oauth';
    const authUrl1 = 'https://connect.linux.do/oauth2/authorize?client_id=old';
    const authUrl2 = 'https://linux.do/session/sso?return_path=ldc';

    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(iframeUrl, { isTopFrame: false, lockIdentifier: 1 }))
      );
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(blockedUrl, { isTopFrame: true, lockIdentifier: 2 }))
      );
    });
    expect(mockShouldStartLoadWithLockIdentifier).toHaveBeenNthCalledWith(1, true, 1);
    expect(mockShouldStartLoadWithLockIdentifier).toHaveBeenNthCalledWith(2, false, 2);

    // Sub-resource SSL failure does not disturb the active document.
    await act(async () => {
      nativeWebView.props.onLoadingSubResourceError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(subResourceUrl),
          code: -11,
          description: 'SSL error: The certificate authority is not trusted'
        })
      );
    });
    expect(nativeWebView.parent?.children).toHaveLength(1);
    expect(view.queryByText(/页面加载失败/)).toBeNull();

    const iframeError = createSyntheticEvent({
      ...createNavigationNativeEvent(iframeUrl),
      code: -2,
      description: 'net::ERR_BLOCKED_BY_CLIENT'
    });
    await act(async () => {
      nativeWebView.props.onLoadingSubResourceError(iframeError);
      nativeWebView.props.onHttpError(
        createSyntheticEvent({
          ...createNavigationNativeEvent(iframeUrl),
          statusCode: 500,
          description: 'Internal Server Error'
        })
      );
    });
    expect(nativeWebView.parent?.children).toHaveLength(1);
    expect(view.queryByText(/ERR_BLOCKED_BY_CLIENT/)).toBeNull();
    expect(view.queryByText(/HTTP 500/)).toBeNull();

    const blockedError = createSyntheticEvent({
      ...createNavigationNativeEvent(blockedUrl),
      code: -1,
      description: 'net::ERR_FAILED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(blockedError);
    });
    expect(nativeWebView.parent?.children).toHaveLength(1);
    expect(blockedError.isDefaultPrevented()).toBe(true);
    expect(view.queryByText(/ERR_FAILED/)).toBeNull();

    await act(async () => {
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl1, { isTopFrame: true, lockIdentifier: 3 }))
      );
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl2, { isTopFrame: true, lockIdentifier: 4 }))
      );
    });
    const supersededError = createSyntheticEvent({
      ...createNavigationNativeEvent(authUrl1),
      code: -3,
      description: 'net::ERR_ABORTED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(supersededError);
    });
    expect(nativeWebView.parent?.children).toHaveLength(1);
    expect(supersededError.isDefaultPrevented()).toBe(true);
    expect(view.queryByText(/ERR_ABORTED/)).toBeNull();

    await fireEvent.press(view.getByLabelText('刷新页面'));
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    const abandonedError = createSyntheticEvent({
      ...createNavigationNativeEvent(authUrl2),
      code: -3,
      description: 'net::ERR_ABORTED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(abandonedError);
    });
    expect(nativeWebView.parent?.children).toHaveLength(1);
    expect(abandonedError.isDefaultPrevented()).toBe(true);
    expect(view.queryByText(/ERR_ABORTED/)).toBeNull();
  });

  it('keeps the current LDC page when load completion arrives just before its deadline', async () => {
    jest.useFakeTimers();
    let view: Awaited<ReturnType<typeof renderModal>>['view'] | undefined;
    try {
      ({ view } = await renderModal());
      const current = view.getByTestId('rnc-native-webview');
      const homeUrl = 'https://credit.linux.do/home';
      await act(async () => emitMainFrameLoadStart(current, homeUrl));
      expect(view.getByText('正在打开 LDC…')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(11_999);
        current.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
        jest.advanceTimersByTime(1);
      });
      expect(view.queryByText(/页面打开超时/)).toBeNull();
      expect(view.getByTestId('rnc-native-webview')).toBeTruthy();
    } finally {
      if (view) await view.unmount();
      jest.useRealTimers();
    }
  });

  it('gives the next LDC document a fresh deadline when it starts before completion is rendered', async () => {
    jest.useFakeTimers();
    let view: Awaited<ReturnType<typeof renderModal>>['view'] | undefined;
    try {
      ({ view } = await renderModal());
      const current = view.getByTestId('rnc-native-webview');
      const homeUrl = 'https://credit.linux.do/home';
      const nextUrl = 'https://linux.do/latest';
      await act(async () => emitMainFrameLoadStart(current, homeUrl));
      await act(async () => {
        jest.advanceTimersByTime(11_999);
        current.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
        emitMainFrameLoadStart(current, nextUrl);
        jest.advanceTimersByTime(1);
      });
      expect(view.queryByText(/页面打开超时/)).toBeNull();
      expect(view.getByText('正在打开 LDC…')).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(11_999));
      expect(view.getByText(/页面打开超时/)).toBeTruthy();
      expect(view.queryByTestId('rnc-native-webview')).toBeNull();
    } finally {
      if (view) await view.unmount();
      jest.useRealTimers();
    }
  });

  it('keeps the loading indicator for an in-flight same-URL refresh until its current WebView finishes', async () => {
    const { view } = await renderModal();
    const homeUrl = 'https://credit.linux.do/home';
    const previous = view.getByTestId('rnc-native-webview');
    const finishPrevious = previous.props.onLoadingFinish;
    await act(async () => emitMainFrameLoadStart(previous, homeUrl));
    await fireEvent.press(view.getByLabelText('刷新页面'));
    expect(view.getByText('正在打开 LDC…')).toBeTruthy();
    await act(async () => finishPrevious(createSyntheticEvent(createNavigationNativeEvent(homeUrl))));
    expect(view.getByText('正在打开 LDC…')).toBeTruthy();

    const current = view.getByTestId('rnc-native-webview');
    await act(async () => {
      emitMainFrameLoadStart(current, homeUrl);
      current.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
    });
    expect(view.queryByText('正在打开 LDC…')).toBeNull();
  });

  it('retains native error handling when same-URL ownership cannot be proven retired or when isTopFrame is unknown', async () => {
    const { view } = await renderModal();
    const nativeWebView = view.getByTestId('rnc-native-webview');
    const authUrl = 'https://connect.linux.do/oauth2/authorize?client_id=ldc';
    const homeUrl = 'https://credit.linux.do/home';
    const legacyUrl = 'https://linux.do/session/sso?legacy=1';

    // 1. A -> B -> A: authUrl is in retired history AND is currently active -> error is ambiguous, do NOT preventDefault.
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, authUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      emitMainFrameLoadStart(nativeWebView, authUrl);
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(nativeWebView.parent?.children).toHaveLength(1);

    const ambiguousSameUrlError = createSyntheticEvent({
      ...createNavigationNativeEvent(authUrl),
      code: -2,
      description: 'net::ERR_CONNECTION_ABORTED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(ambiguousSameUrlError);
    });
    expect(ambiguousSameUrlError.isDefaultPrevented()).toBe(false);
    expect(nativeWebView.parent?.children).toHaveLength(2);
    expect(view.getByText('LDC 页面加载失败：net::ERR_CONNECTION_ABORTED')).toBeTruthy();

    // 2. Same-URL subframe while main frame is homeUrl -> cannot prove error is subframe, retain native handling.
    await fireEvent.press(view.getByLabelText('刷新页面'));
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(homeUrl, { isTopFrame: false, lockIdentifier: 5 }))
      );
    });
    expect(nativeWebView.parent?.children).toHaveLength(1);

    const sameUrlSubframeAmbiguousError = createSyntheticEvent({
      ...createNavigationNativeEvent(homeUrl),
      code: -1,
      description: 'net::ERR_FAILED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(sameUrlSubframeAmbiguousError);
    });
    expect(sameUrlSubframeAmbiguousError.isDefaultPrevented()).toBe(false);
    expect(nativeWebView.parent?.children).toHaveLength(2);
    expect(view.getByText('LDC 页面加载失败：net::ERR_FAILED')).toBeTruthy();

    // 3. Legacy shouldOverrideUrlLoading with unknown isTopFrame (undefined) must not retire an existing pending main-frame request,
    //    and an unretired error for that URL retains native error handling rather than suppressing it.
    await fireEvent.press(view.getByLabelText('刷新页面'));
    await act(async () => {
      emitMainFrameLoadStart(nativeWebView, homeUrl);
      nativeWebView.props.onLoadingStart(createSyntheticEvent(createNavigationNativeEvent(homeUrl, { loading: true })));
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(homeUrl)));
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(authUrl, { isTopFrame: true, lockIdentifier: 6 }))
      );
      nativeWebView.props.onShouldStartLoadWithRequest(
        createSyntheticEvent(createNavigationNativeEvent(legacyUrl, { lockIdentifier: 7 }))
      );
    });
    // authUrl is still pending (not retired by unknown-frame legacyUrl), so its HTTP 403 still reports.
    await act(async () => {
      nativeWebView.props.onHttpError(
        createSyntheticEvent({ ...createNavigationNativeEvent(authUrl), statusCode: 403, description: 'Forbidden' })
      );
      nativeWebView.props.onLoadingFinish(createSyntheticEvent(createNavigationNativeEvent(authUrl)));
    });
    expect(view.getByText('LDC 页面加载失败：HTTP 403')).toBeTruthy();

    const legacyError = createSyntheticEvent({
      ...createNavigationNativeEvent(legacyUrl),
      code: -2,
      description: 'net::ERR_NAME_NOT_RESOLVED'
    });
    await act(async () => {
      nativeWebView.props.onLoadingError(legacyError);
    });
    expect(legacyError.isDefaultPrevented()).toBe(false);
    expect(view.getByText('LDC 页面加载失败：net::ERR_NAME_NOT_RESOLVED')).toBeTruthy();
  });
});
