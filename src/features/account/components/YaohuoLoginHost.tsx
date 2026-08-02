import { type RefObject, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { YAOHUO_URL } from '@/domain/forum/sourceUrls';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { AppButton } from '@/ui/controls/ButtonControls';
import { LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { AccountHostStyles } from '../accountHostStyles';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';
const LOGIN_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export function YaohuoLoginHost({
  checking,
  credentialAttempt,
  credentialFillPending,
  credentialSaved,
  loginFormMode,
  loading,
  prompt,
  session,
  styles,
  visible,
  webViewBlockMessage,
  webViewRef,
  onCheck,
  onClear,
  onClose,
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
  prompt: string;
  session: SiteSessionViewModel;
  styles: AccountHostStyles;
  visible: boolean;
  webViewBlockMessage: string;
  webViewRef: RefObject<WebView | null>;
  onCheck: () => void;
  onClear: () => void;
  onClose: () => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onNavigation: (request: LoginNavigationRequest) => boolean;
  onRequestCredentialFill: () => void;
  onSetLoading: (value: boolean) => void;
  onWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout', attempt?: number) => void;
}) {
  const [error, setError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [needsRemount, setNeedsRemount] = useState(false);

  useEffect(() => {
    if (!visible) {
      setError('');
      setNeedsRemount(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !loading || webViewBlockMessage) return undefined;
    const timeout = setTimeout(() => {
      setNeedsRemount(true);
      onWebViewState('timeout', credentialAttempt);
      onSetLoading(false);
      setError('妖火页面打开超时：请检查模拟器网络后刷新页面。');
    }, LOGIN_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [credentialAttempt, loading, onSetLoading, onWebViewState, visible, webViewBlockMessage]);

  useEffect(() => {
    if (visible && loginFormMode && !loading && credentialAttempt > 0) {
      webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.yaohuo.probeScript(credentialAttempt));
    }
  }, [credentialAttempt, loading, loginFormMode, visible, webViewRef]);

  const refresh = () => {
    setError('');
    onSetLoading(true);
    if (needsRemount) {
      setNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    webViewRef.current?.reload();
  };

  return (
    <LoginWebViewModal
      visible={visible}
      title="妖火登录"
      subtitle={session.summaryLabel}
      loading={!webViewBlockMessage && loading}
      loadingText="正在打开妖火..."
      error={webViewBlockMessage || error}
      onClose={onClose}
      actions={
        <View style={styles.actions}>
          {credentialSaved ? (
            <AppButton label="填入已保存登录信息" disabled={credentialFillPending} onPress={onRequestCredentialFill} />
          ) : null}
          <AppButton label={checking ? '检测中' : '检测登录'} disabled={checking} onPress={onCheck} />
          <AppButton label="清除登录" variant="danger" onPress={onClear} />
          <AppButton label="刷新页面" variant="ghost" onPress={refresh} />
        </View>
      }
    >
      {visible && !webViewBlockMessage ? (
        <View style={styles.flex}>
          {prompt ? <Text style={styles.meta}>{prompt}</Text> : null}
          {!needsRemount ? (
            <WebView
              style={styles.flex}
              key={`yaohuo-login-${webViewKey}`}
              ref={webViewRef}
              source={{
                uri: loginFormMode
                  ? LOGIN_FORM_ADAPTERS.yaohuo.loginUrl
                  : session.isLoggedIn
                    ? YAOHUO_SESSION_URL
                    : YAOHUO_LOGIN_URL
              }}
              javaScriptCanOpenWindowsAutomatically={false}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              onLoadEnd={(event) => {
                onSetLoading(false);
                if ('code' in event.nativeEvent) return;
                onWebViewState('ready', credentialAttempt);
                setError('');
                if (loginFormMode) {
                  webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.yaohuo.probeScript(credentialAttempt));
                }
              }}
              onLoadStart={() => {
                onWebViewState('start', credentialAttempt);
                setError('');
                setNeedsRemount(false);
                onSetLoading(true);
              }}
              onMessage={onLoginFormMessage}
              onError={(event) => {
                onWebViewState('error', credentialAttempt);
                onSetLoading(false);
                setError(`妖火页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后关闭重试。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                onWebViewState('renderer-gone', credentialAttempt);
                onSetLoading(false);
                setNeedsRemount(true);
                setError('妖火登录页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={onNavigation}
            />
          ) : null}
        </View>
      ) : null}
    </LoginWebViewModal>
  );
}
