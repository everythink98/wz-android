import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
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
import type { LoginFormMessageHandler } from '../credentialFillSession';
import type { LoginWebViewDiagnosticState } from '../useAccountController';
import { useLoginFormProbe } from './useLoginFormProbe';
import { useLoginWebViewLifecycle } from './useLoginWebViewLifecycle';

type LoadedLoginDocument = { key: number; url: string };

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
  onLoginFormDocumentRetired,
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
  onLoginFormDocumentRetired?: (attempt: number) => void;
  onLoginFormMessage: LoginFormMessageHandler;
  onNavigation: (request: LoginNavigationRequest) => boolean;
  onRequestCredentialFill: () => void;
  onSetLoading: (value: boolean) => void;
  onWebViewState: (state: LoginWebViewDiagnosticState, attempt?: number) => void;
}) {
  const adapter = LOGIN_FORM_ADAPTERS[site];
  const sourceUri = loginFormMode
    ? adapter.loginUrl
    : site === 'nodeseek'
      ? NODESEEK_URL
      : session.isLoggedIn
        ? YAOHUO_URL + '/wapindex.aspx?sid=-2'
        : YAOHUO_URL + '/waplogin.aspx?siteid=1000';
  const [loadedDocument, setLoadedDocument] = useState<LoadedLoginDocument | null>(null);
  const currentDocument = useRef<LoadedLoginDocument | null>(null);
  const mainFrame = useRef<{ key: number; url: string } | null>(null);
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
  const {
    currentDocument: currentForm,
    probe,
    retire
  } = useLoginFormProbe({
    adapter,
    enabled: visible && !webViewBlockMessage && loginFormMode,
    webViewKey: page.key,
    webViewRef,
    onRetired: onLoginFormDocumentRetired
  });

  const retireDocument = useCallback(
    (url = '') => {
      mainFrame.current = { key: page.key, url };
      const retired = currentDocument.current;
      if (!retired) return;
      currentDocument.current = null;
      setLoadedDocument(null);
      retire();
    },
    [page.key, retire]
  );
  useEffect(() => {
    const document = currentDocument.current;
    if (document && (!visible || webViewBlockMessage || document.key !== page.key)) retireDocument();
  }, [page.key, retireDocument, visible, webViewBlockMessage]);

  useEffect(() => {
    if (!loading && loadedDocument?.key === page.key && loadedDocument === currentDocument.current)
      probe(loadedDocument.url, credentialAttempt);
  }, [credentialAttempt, loadedDocument, loading, page.key, probe]);

  const refresh = () => {
    if (!page.isCurrent() || checking) return;
    retireDocument();
    page.refresh();
  };

  return (
    <LoginWebViewModal
      visible={visible}
      title={site === 'nodeseek' ? 'NodeSeek 登录 / 验证' : '妖火登录'}
      subtitle={session.summaryLabel}
      loading={!webViewBlockMessage && loading && !checking}
      loadingText="正在打开登录页面…"
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
          onPress={page.needsRemount ? refresh : page.check}
        />
      }
      refreshAction={
        <LoginWebViewAction icon={RefreshCw} label="刷新页面" displayLabel="" disabled={checking} onPress={refresh} />
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
            style={styles.webView}
            key={`${site}-login-${page.key}`}
            ref={webViewRef}
            source={{ uri: sourceUri }}
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            injectedJavaScript={site === 'nodeseek' ? NODESEEK_LOGIN_PROBE_SCRIPT : undefined}
            onLoadEnd={(event) => {
              if (!page.isCurrent()) return;
              const { url } = event.nativeEvent;
              const frame = mainFrame.current;
              if (frame?.key === page.key && frame.url && url && frame.url.split('#', 1)[0] !== url.split('#', 1)[0])
                return;
              const failed = 'code' in event.nativeEvent;
              page.loadEnd(failed);
              const current = currentDocument.current;
              if (failed || !url || (current?.key === page.key && current.url === url)) return;
              const document = { key: page.key, url };
              currentDocument.current = document;
              setLoadedDocument(document);
            }}
            onMainFrameLoadStart={(event) => {
              if (page.isCurrent()) retireDocument(event.nativeEvent.url);
            }}
            onLoadStart={(event) => {
              if (!page.isCurrent()) return;
              const loading = event?.nativeEvent.loading !== false;
              if (loading) retireDocument(event?.nativeEvent.url);
              page.start(event?.nativeEvent.url, loading);
            }}
            onMessage={(event) => {
              if (!page.isCurrent()) return;
              if (onLoginFormMessage(event, currentForm())) return;
              if (site === 'nodeseek') onHandleMessage?.(event);
              page.message(event);
            }}
            onError={(event) => {
              if (!page.isCurrent()) return;
              page.fail(event.nativeEvent.description);
              retireDocument();
            }}
            renderError={() => <View style={styles.webViewErrorPlaceholder} />}
            onRenderProcessGone={() => {
              if (!page.isCurrent()) return;
              page.rendererGone();
              retireDocument();
            }}
            onShouldStartLoadWithRequest={onNavigation}
          />
        </View>
      ) : null}
    </LoginWebViewModal>
  );
}
