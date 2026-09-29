import { type RefObject, useEffect } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { NODESEEK_URL, YAOHUO_URL } from '@/domain/forum/sourceUrls';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { AccountHostStyles } from '../accountHostStyles';
import type { LoginWebViewDiagnosticState } from '../useAccountController';
import { useLoginWebViewLifecycle } from './useLoginWebViewLifecycle';

export function SiteLoginHost({
  site,
  recoveryPending = false,
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
  onHandleMessage,
  onLoginFormMessage,
  onNavigation,
  onRequestCredentialFill,
  onSetLoading,
  onWebViewState
}: {
  site: 'nodeseek' | 'yaohuo';
  recoveryPending?: boolean;
  checking: boolean;
  credentialAttempt: number;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  loginFormMode: boolean;
  loading: boolean;
  prompt?: string;
  session: SiteSessionViewModel;
  styles: AccountHostStyles;
  visible: boolean;
  webViewBlockMessage: string;
  webViewRef: RefObject<WebView | null>;
  onCheck: () => void;
  onClear: () => void;
  onClose: () => void;
  onHandleMessage?: (event: WebViewMessageEvent) => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onNavigation: (request: LoginNavigationRequest) => boolean;
  onRequestCredentialFill: () => void;
  onSetLoading: (value: boolean) => void;
  onWebViewState: (state: LoginWebViewDiagnosticState, attempt?: number) => void;
}) {
  const adapter = LOGIN_FORM_ADAPTERS[site];
  const page = useLoginWebViewLifecycle({
    checking,
    recoveryPending,
    onCheck,
    credentialAttempt,
    messagePrefix: site === 'nodeseek' ? 'NodeSeek ' : '妖火',
    loading,
    visible,
    webViewBlockMessage,
    webViewRef,
    onSetLoading,
    onWebViewState
  });

  useEffect(() => {
    if (visible && loginFormMode && !loading && credentialAttempt > 0) {
      webViewRef.current?.injectJavaScript(adapter.probeScript(credentialAttempt));
    }
  }, [adapter, credentialAttempt, loading, loginFormMode, visible, webViewRef]);

  return (
    <LoginWebViewModal
      visible={visible}
      title={site === 'nodeseek' ? 'NodeSeek 登录 / 验证' : '妖火登录'}
      subtitle={session.summaryLabel}
      loading={!webViewBlockMessage && (loading || checking)}
      loadingText={checking ? '正在确认登录状态…' : '正在打开登录页面…'}
      error={webViewBlockMessage || page.error}
      onClose={onClose}
      primaryAction={
        <LoginWebViewAction
          testID={
            site === 'nodeseek' && (page.settled || webViewBlockMessage) ? 'nodeseek-login-webview-settled' : undefined
          }
          icon={ShieldCheck}
          primary
          label={
            checking
              ? '正在检测…'
              : page.needsRemount
                ? '重新打开登录页'
                : site === 'nodeseek' && recoveryPending
                  ? '检测并继续'
                  : '检测登录'
          }
          loading={checking}
          onPress={page.needsRemount ? page.refresh : page.check}
        />
      }
      refreshAction={
        <LoginWebViewAction
          icon={RefreshCw}
          label="刷新页面"
          displayLabel=""
          disabled={checking}
          onPress={page.refresh}
        />
      }
      footer={prompt ? <Text style={styles.verificationHint}>{prompt}</Text> : undefined}
      actions={
        <>
          {credentialSaved ? (
            <LoginWebViewAction
              icon={KeyRound}
              label="填入已保存登录信息"
              displayLabel="填入"
              disabled={checking || credentialFillPending || page.needsRemount}
              onPress={onRequestCredentialFill}
            />
          ) : null}
          <LoginWebViewAction icon={LogOut} label="清除登录" danger disabled={checking} onPress={onClear} />
        </>
      }
    >
      {visible && !webViewBlockMessage && !page.needsRemount ? (
        <View style={styles.flex} pointerEvents={checking ? 'none' : 'auto'}>
          <WebView
            style={styles.flex}
            key={`${site}-login-${page.key}`}
            ref={webViewRef}
            source={{
              uri: loginFormMode
                ? adapter.loginUrl
                : site === 'nodeseek'
                  ? NODESEEK_URL
                  : session.isLoggedIn
                    ? YAOHUO_URL + '/wapindex.aspx?sid=-2'
                    : YAOHUO_URL + '/waplogin.aspx?siteid=1000'
            }}
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            injectedJavaScript={site === 'nodeseek' ? NODESEEK_LOGIN_PROBE_SCRIPT : undefined}
            onLoadEnd={(event) => {
              if (!page.isCurrent()) return;
              page.loadEnd('code' in event.nativeEvent);
              if ('code' in event.nativeEvent) return;
              if (loginFormMode) {
                webViewRef.current?.injectJavaScript(adapter.probeScript(credentialAttempt));
              }
            }}
            onLoadStart={(event) => page.start(event?.nativeEvent.url, event?.nativeEvent.loading !== false)}
            onMessage={(event) => {
              if (!page.isCurrent() || onLoginFormMessage(event)) return;
              if (site === 'nodeseek') onHandleMessage?.(event);
              page.message(event);
            }}
            onError={(event) => page.fail(event.nativeEvent.description)}
            renderError={() => <View style={styles.webViewErrorPlaceholder} />}
            onRenderProcessGone={page.rendererGone}
            onShouldStartLoadWithRequest={onNavigation}
          />
        </View>
      ) : null}
    </LoginWebViewModal>
  );
}
