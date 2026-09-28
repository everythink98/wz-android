import { type RefObject, useEffect } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { YAOHUO_URL } from '@/domain/forum/sourceUrls';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { AccountHostStyles } from '../accountHostStyles';
import { useLoginWebViewLifecycle } from './useLoginWebViewLifecycle';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';

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
  const page = useLoginWebViewLifecycle({
    credentialAttempt,
    messagePrefix: '妖火',
    loading,
    visible,
    webViewBlockMessage,
    webViewRef,
    onSetLoading,
    onWebViewState
  });

  useEffect(() => {
    if (visible && loginFormMode && !loading && credentialAttempt > 0) {
      webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.yaohuo.probeScript(credentialAttempt));
    }
  }, [credentialAttempt, loading, loginFormMode, visible, webViewRef]);

  return (
    <LoginWebViewModal
      visible={visible}
      title="妖火登录"
      subtitle={session.summaryLabel}
      loading={!webViewBlockMessage && loading}
      loadingText="正在打开妖火..."
      error={webViewBlockMessage || page.error}
      onClose={onClose}
      actions={
        <View style={styles.actions}>
          <LoginWebViewAction
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
      {visible && !webViewBlockMessage ? (
        <View style={styles.flex}>
          {prompt ? <Text style={styles.meta}>{prompt}</Text> : null}
          {!page.needsRemount ? (
            <WebView
              style={styles.flex}
              key={`yaohuo-login-${page.key}`}
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
                page.loadEnd('code' in event.nativeEvent);
                if ('code' in event.nativeEvent) return;
                if (loginFormMode) {
                  webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.yaohuo.probeScript(credentialAttempt));
                }
              }}
              onLoadStart={page.start}
              onMessage={onLoginFormMessage}
              onError={(event) => page.fail(event.nativeEvent.description)}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={page.rendererGone}
              onShouldStartLoadWithRequest={onNavigation}
            />
          ) : null}
        </View>
      ) : null}
    </LoginWebViewModal>
  );
}
