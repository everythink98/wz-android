import { useCallback, useEffect } from 'react';
import { Check, RefreshCw } from 'lucide-react-native';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { linuxDoCreditAuthScript } from '@/platform/network/linuxDoCreditAuthScript';
import type { AccountHostStyles } from '../accountHostStyles';
import type { useLinuxDoCreditAuthController } from '../useLinuxDoCreditAuthController';
import { useLoginWebViewLifecycle } from './useLoginWebViewLifecycle';

function creditNavigationAllowed({ url: value }: LoginNavigationRequest) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['credit.linux.do', 'connect.linux.do', 'linux.do', 'challenges.cloudflare.com'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function LinuxDoCreditAuthModal({
  panel,
  styles,
  webViewBlockMessage
}: {
  panel: ReturnType<typeof useLinuxDoCreditAuthController>['panel'];
  styles: AccountHostStyles;
  webViewBlockMessage: string;
}) {
  const { close, document, failSilent } = panel;
  useEffect(() => {
    if (document?.mode === 'silent' && webViewBlockMessage) failSilent(document.generation);
  }, [document, failSilent, webViewBlockMessage]);
  const complete = useCallback(() => close('success'), [close]);
  const recordState = useCallback(() => undefined, []);
  const page = useLoginWebViewLifecycle({
    checking: false,
    credentialAttempt: 0,
    messagePrefix: 'LDC ',
    loading: panel.loading && Boolean(panel.document),
    visible: panel.visible,
    webViewBlockMessage,
    webViewRef: panel.webViewRef,
    onCheck: complete,
    onSetLoading: panel.setLoading,
    onWebViewState: recordState
  });
  if (document?.mode === 'silent') {
    return webViewBlockMessage ? null : (
      <View
        pointerEvents="none"
        style={styles.hiddenBrowserWebViewHost}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <WebView
          testID="linuxdo-credit-silent-webview"
          style={styles.hiddenBrowserWebView}
          containerStyle={styles.hiddenBrowserWebView}
          ref={panel.webViewRef}
          source={{ uri: 'https://credit.linux.do/home' }}
          userAgent={document.userAgent}
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          injectedJavaScript={linuxDoCreditAuthScript(document.nonce)}
          onShouldStartLoadWithRequest={creditNavigationAllowed}
          onMessage={panel.handleMessage}
          onError={() => failSilent(document.generation)}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 400 && event.nativeEvent.statusCode !== 403)
              failSilent(document.generation);
          }}
          onRenderProcessGone={() => failSilent(document.generation)}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
        />
      </View>
    );
  }
  return (
    <LoginWebViewModal
      visible={panel.visible}
      title="连接 LDC"
      subtitle="请在官网完成登录或授权，完成后返回刷新"
      loading={!webViewBlockMessage && panel.loading}
      loadingText="正在打开 LDC…"
      error={webViewBlockMessage || panel.error || page.error}
      onClose={() => panel.close()}
      primaryAction={<LoginWebViewAction icon={Check} primary label="完成并刷新" onPress={complete} />}
      refreshAction={
        <LoginWebViewAction
          icon={RefreshCw}
          label="刷新页面"
          displayLabel=""
          disabled={Boolean(webViewBlockMessage) || (!panel.document && panel.loading)}
          onPress={panel.document ? page.refresh : panel.retry}
        />
      }
    >
      {panel.visible && panel.document && !webViewBlockMessage && !page.needsRemount ? (
        <WebView
          key={`${panel.document.generation}:${page.key}`}
          testID="linuxdo-credit-webview"
          style={styles.webView}
          ref={panel.webViewRef}
          source={{ uri: 'https://credit.linux.do/home' }}
          userAgent={panel.document.userAgent}
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={creditNavigationAllowed}
          onLoadStart={(event) => page.start(event.nativeEvent.url, event.nativeEvent.loading !== false)}
          onLoadEnd={(event) => page.loadEnd('code' in event.nativeEvent)}
          onError={(event) => page.fail(event.nativeEvent.description)}
          onHttpError={(event) => {
            if (event.nativeEvent.url === 'https://credit.linux.do/home' && event.nativeEvent.statusCode >= 400)
              page.fail(`HTTP ${event.nativeEvent.statusCode}`);
          }}
          onRenderProcessGone={page.rendererGone}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
        />
      ) : null}
    </LoginWebViewModal>
  );
}
