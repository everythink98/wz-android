import { type RefObject, useEffect, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { NODESEEK_URL } from '@/domain/forum/sourceUrls';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { AppButton } from '@/ui/controls/ButtonControls';
import { LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { AccountHostStyles } from '../accountHostStyles';

const LOGIN_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

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
  const [error, setError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [needsRemount, setNeedsRemount] = useState(false);
  const [settledForReplay, setSettledForReplay] = useState(false);

  useEffect(() => {
    if (!visible) {
      setError('');
      setNeedsRemount(false);
      setSettledForReplay(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !loading || webViewBlockMessage) return undefined;
    const timeout = setTimeout(() => {
      setSettledForReplay(true);
      setNeedsRemount(true);
      onWebViewState('timeout', credentialAttempt);
      onSetLoading(false);
      setError('NodeSeek 页面打开超时：请检查模拟器网络后刷新页面。');
    }, LOGIN_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [credentialAttempt, loading, onSetLoading, onWebViewState, visible, webViewBlockMessage]);

  useEffect(() => {
    if (visible && loginFormMode && !loading && credentialAttempt > 0) {
      webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.nodeseek.probeScript(credentialAttempt));
    }
  }, [credentialAttempt, loading, loginFormMode, visible, webViewRef]);

  const refresh = () => {
    setError('');
    setSettledForReplay(false);
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
      title="NodeSeek 登录 / 验证"
      subtitle={session.summaryLabel}
      loading={!webViewBlockMessage && loading}
      loadingText="正在打开 NodeSeek..."
      error={webViewBlockMessage || error}
      onClose={onClose}
      actions={
        <View style={styles.actions}>
          {credentialSaved ? (
            <AppButton label="填入已保存登录信息" disabled={credentialFillPending} onPress={onRequestCredentialFill} />
          ) : null}
          <AppButton
            testID={settledForReplay || webViewBlockMessage ? 'nodeseek-login-webview-settled' : undefined}
            label={checking ? '检测中' : '检测登录'}
            disabled={checking}
            onPress={onCheck}
          />
          <AppButton label="清除登录" variant="danger" onPress={onClear} />
          <AppButton label="刷新页面" variant="ghost" onPress={refresh} />
        </View>
      }
    >
      {visible && !webViewBlockMessage && !needsRemount ? (
        <WebView
          key={`nodeseek-login-${webViewKey}`}
          ref={webViewRef}
          source={{ uri: loginFormMode ? LOGIN_FORM_ADAPTERS.nodeseek.loginUrl : NODESEEK_URL }}
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
          onLoadEnd={(event) => {
            onSetLoading(false);
            setSettledForReplay(true);
            if ('code' in event.nativeEvent) return;
            onWebViewState('ready', credentialAttempt);
            setError('');
            webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
            if (loginFormMode) {
              webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.nodeseek.probeScript(credentialAttempt));
            }
          }}
          onLoadStart={() => {
            onWebViewState('start', credentialAttempt);
            setError('');
            setNeedsRemount(false);
            setSettledForReplay(false);
            onSetLoading(true);
          }}
          onMessage={(event) => {
            if (!onLoginFormMessage(event)) onHandleMessage(event);
          }}
          onError={(event) => {
            onWebViewState('error', credentialAttempt);
            onSetLoading(false);
            setSettledForReplay(true);
            setError(`NodeSeek 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后关闭重试。'}`);
          }}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
          onRenderProcessGone={() => {
            onWebViewState('renderer-gone', credentialAttempt);
            onSetLoading(false);
            setSettledForReplay(true);
            setNeedsRemount(true);
            setError('NodeSeek 登录页面已停止，请刷新页面重试。');
          }}
          onShouldStartLoadWithRequest={onNavigation}
        />
      ) : null}
    </LoginWebViewModal>
  );
}
