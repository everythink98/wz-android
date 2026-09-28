import { type RefObject, useEffect } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { NODESEEK_URL } from '@/domain/forum/sourceUrls';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { AccountHostStyles } from '../accountHostStyles';
import { useLoginWebViewLifecycle } from './useLoginWebViewLifecycle';

export function NodeSeekLoginHost({
  checking,
  credentialAttempt,
  credentialFillPending,
  credentialSaved,
  loginFormMode,
  loading,
  session,
  styles,
  visible,
  webViewBlockMessage,
  webViewRef,
  onCheck,
  onClear,
  onClose,
  onHandleMessage,
  onLoginFormMessage,
  onNavigation,
  onRequestCredentialFill,
  onSetLoading,
  onWebViewState
}: {
  checking: boolean;
  credentialAttempt: number;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  loginFormMode: boolean;
  loading: boolean;
  session: SiteSessionViewModel;
  styles: AccountHostStyles;
  visible: boolean;
  webViewBlockMessage: string;
  webViewRef: RefObject<WebView | null>;
  onCheck: () => void;
  onClear: () => void;
  onClose: () => void;
  onHandleMessage: (event: WebViewMessageEvent) => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onNavigation: (request: LoginNavigationRequest) => boolean;
  onRequestCredentialFill: () => void;
  onSetLoading: (value: boolean) => void;
  onWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout', attempt?: number) => void;
}) {
  const page = useLoginWebViewLifecycle({
    credentialAttempt,
    messagePrefix: 'NodeSeek ',
    loading,
    visible,
    webViewBlockMessage,
    webViewRef,
    onSetLoading,
    onWebViewState
  });

  useEffect(() => {
    if (visible && loginFormMode && !loading && credentialAttempt > 0) {
      webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.nodeseek.probeScript(credentialAttempt));
    }
  }, [credentialAttempt, loading, loginFormMode, visible, webViewRef]);

  return (
    <LoginWebViewModal
      visible={visible}
      title="NodeSeek 登录 / 验证"
      subtitle={session.summaryLabel}
      loading={!webViewBlockMessage && loading}
      loadingText="正在打开 NodeSeek..."
      error={webViewBlockMessage || page.error}
      onClose={onClose}
      actions={
        <View style={styles.actions}>
          <LoginWebViewAction
            testID={page.settled || webViewBlockMessage ? 'nodeseek-login-webview-settled' : undefined}
            icon={ShieldCheck}
            primary
            label={checking ? '检测中' : '检测登录'}
            disabled={checking}
            onPress={onCheck}
          />
          {credentialSaved ? (
            <LoginWebViewAction
              icon={KeyRound}
              label="填入已保存登录信息"
              displayLabel="填入"
              disabled={credentialFillPending}
              onPress={onRequestCredentialFill}
            />
          ) : null}
          <LoginWebViewAction icon={RefreshCw} label="刷新页面" displayLabel="" onPress={page.refresh} />
          <LoginWebViewAction icon={LogOut} label="清除登录" danger onPress={onClear} />
        </View>
      }
    >
      {visible && !webViewBlockMessage && !page.needsRemount ? (
        <WebView
          key={`nodeseek-login-${page.key}`}
          ref={webViewRef}
          source={{ uri: loginFormMode ? LOGIN_FORM_ADAPTERS.nodeseek.loginUrl : NODESEEK_URL }}
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
          onLoadEnd={(event) => {
            page.loadEnd('code' in event.nativeEvent);
            if ('code' in event.nativeEvent) return;
            webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
            if (loginFormMode) {
              webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.nodeseek.probeScript(credentialAttempt));
            }
          }}
          onLoadStart={page.start}
          onMessage={(event) => {
            if (!onLoginFormMessage(event)) onHandleMessage(event);
          }}
          onError={(event) => page.fail(event.nativeEvent.description)}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
          onRenderProcessGone={page.rendererGone}
          onShouldStartLoadWithRequest={onNavigation}
        />
      ) : null}
    </LoginWebViewModal>
  );
}
