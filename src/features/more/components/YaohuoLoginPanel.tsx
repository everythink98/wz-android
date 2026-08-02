import { type RefObject, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { MoreScreenStyles } from '../styles';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { YAOHUO_URL } from '@/domain/forum/sourceUrls';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from '@/ui/controls/ButtonControls';
import { LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';
const LOGIN_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export function YaohuoLoginPanel({
  accountExpanded,
  checking,
  credentialAttempt,
  credentialFillPending,
  credentialSaved,
  yaohuoSession,
  loginFormMode,
  loadingYaohuoLoginPage,
  showYaohuoLoginPanel,
  styles,
  theme,
  yaohuoLoginPrompt,
  yaohuoWebViewRef,
  webViewBlockMessage,
  onCheckYaohuoLogin,
  onClearYaohuoLogin,
  handleYaohuoLoginNavigation,
  onLoginFormMessage,
  onRequestCredentialFill,
  onWebViewState,
  onSetLoadingYaohuoLoginPage,
  onShowYaohuoLoginPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  credentialAttempt: number;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  yaohuoSession: SiteSessionViewModel;
  loginFormMode: boolean;
  loadingYaohuoLoginPage: boolean;
  showYaohuoLoginPanel: boolean;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  yaohuoLoginPrompt: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  webViewBlockMessage: string;
  onCheckYaohuoLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onRequestCredentialFill: () => void;
  onWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout', attempt?: number) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
}) {
  const [webViewError, setWebViewError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewNeedsRemount, setWebViewNeedsRemount] = useState(false);

  useEffect(() => {
    if (!showYaohuoLoginPanel) {
      setWebViewError('');
      setWebViewNeedsRemount(false);
    }
  }, [showYaohuoLoginPanel]);

  useEffect(() => {
    if (!showYaohuoLoginPanel || !loadingYaohuoLoginPage || webViewBlockMessage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setWebViewNeedsRemount(true);
      onWebViewState('timeout', credentialAttempt);
      onSetLoadingYaohuoLoginPage(false);
      setWebViewError('妖火页面打开超时：请检查模拟器网络后刷新页面。');
    }, LOGIN_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [
    credentialAttempt,
    loadingYaohuoLoginPage,
    onSetLoadingYaohuoLoginPage,
    onWebViewState,
    showYaohuoLoginPanel,
    webViewBlockMessage
  ]);

  useEffect(() => {
    if (showYaohuoLoginPanel && loginFormMode && !loadingYaohuoLoginPage && credentialAttempt > 0) {
      yaohuoWebViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.yaohuo.probeScript(credentialAttempt));
    }
  }, [credentialAttempt, loadingYaohuoLoginPage, loginFormMode, showYaohuoLoginPanel, yaohuoWebViewRef]);

  const refreshWebView = () => {
    setWebViewError('');
    onSetLoadingYaohuoLoginPage(true);
    if (webViewNeedsRemount) {
      setWebViewNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    yaohuoWebViewRef.current?.reload();
  };

  return (
    <>
      <LoginWebViewModal
        visible={showYaohuoLoginPanel}
        title="妖火登录"
        subtitle={yaohuoSession.summaryLabel}
        loading={!webViewBlockMessage && loadingYaohuoLoginPage}
        loadingText="正在打开妖火..."
        error={webViewBlockMessage || webViewError}
        styles={styles}
        theme={theme}
        onClose={() => onShowYaohuoLoginPanelChange(false)}
        actions={
          <View style={styles.actions}>
            {credentialSaved ? (
              <AppButton
                label="填入已保存登录信息"
                styles={styles}
                disabled={credentialFillPending}
                onPress={onRequestCredentialFill}
              />
            ) : null}
            <AppButton
              label={checking ? '检测中' : '检测登录'}
              styles={styles}
              disabled={checking}
              onPress={onCheckYaohuoLogin}
            />
            <AppButton label="清除登录" variant="danger" styles={styles} onPress={onClearYaohuoLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={refreshWebView} />
          </View>
        }
      >
        {showYaohuoLoginPanel && accountExpanded && !webViewBlockMessage ? (
          <View style={styles.flex}>
            {yaohuoLoginPrompt ? <Text style={styles.meta}>{yaohuoLoginPrompt}</Text> : null}
            {!webViewNeedsRemount ? (
              <WebView
                style={styles.flex}
                key={`yaohuo-login-${webViewKey}`}
                ref={yaohuoWebViewRef}
                source={{
                  uri: loginFormMode
                    ? LOGIN_FORM_ADAPTERS.yaohuo.loginUrl
                    : yaohuoSession.isLoggedIn
                      ? YAOHUO_SESSION_URL
                      : YAOHUO_LOGIN_URL
                }}
                javaScriptCanOpenWindowsAutomatically={false}
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                setSupportMultipleWindows={false}
                onLoadEnd={(event) => {
                  onSetLoadingYaohuoLoginPage(false);
                  if ('code' in event.nativeEvent) {
                    return;
                  }
                  onWebViewState('ready', credentialAttempt);
                  setWebViewError('');
                  if (loginFormMode) {
                    yaohuoWebViewRef.current?.injectJavaScript(
                      LOGIN_FORM_ADAPTERS.yaohuo.probeScript(credentialAttempt)
                    );
                  }
                }}
                onLoadStart={() => {
                  onWebViewState('start', credentialAttempt);
                  setWebViewError('');
                  setWebViewNeedsRemount(false);
                  onSetLoadingYaohuoLoginPage(true);
                }}
                onMessage={(event) => {
                  onLoginFormMessage(event);
                }}
                onError={(event) => {
                  onWebViewState('error', credentialAttempt);
                  onSetLoadingYaohuoLoginPage(false);
                  setWebViewError(
                    `妖火页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`
                  );
                }}
                renderError={() => <View style={styles.webViewErrorPlaceholder} />}
                onRenderProcessGone={() => {
                  onWebViewState('renderer-gone', credentialAttempt);
                  onSetLoadingYaohuoLoginPage(false);
                  setWebViewNeedsRemount(true);
                  setWebViewError('妖火登录页面已停止，请刷新页面重试。');
                }}
                onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}
              />
            ) : null}
          </View>
        ) : null}
      </LoginWebViewModal>
    </>
  );
}
