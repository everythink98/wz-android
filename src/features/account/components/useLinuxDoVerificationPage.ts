import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { WebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';
import { LINUXDO_URL } from '@/domain/forum/sourceUrls';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { LinuxDoVerificationPageEvent } from '../useVerificationController';

const FORUM_URL = LINUXDO_URL + '/latest';
const CHALLENGE_URL = 'https://cdk.linux.do/';

function verificationPage(url: string): LinuxDoVerificationPageEvent['verificationPage'] {
  try {
    const { origin, pathname } = new URL(url);
    if (origin === 'https://cdk.linux.do') return pathname === '/login' ? 'alternate-login' : 'alternate';
    if (origin === LINUXDO_URL) {
      if (pathname === '/challenge') return 'challenge';
      return pathname === '/login' ? 'login' : 'forum';
    }
  } catch {
    // Classify only; raw navigation URLs never enter diagnostics.
  }
  return 'other';
}

export type LinuxDoVerificationPageProps = {
  credentialAttempt: number;
  loginFormMode: boolean;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  loadingLinuxDoPage: boolean;
  showLinuxDoPanel: boolean;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent, webViewKey?: number) => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onResetLinuxDoWebView: () => void;
  onRetryRecovery?: () => void;
  onSetLinuxDoWebViewError: (value: string, webViewKey?: number, credentialAttempt?: number) => void;
  onSetLoadingLinuxDoPage: (value: boolean, webViewKey?: number) => void;
  onVerificationPageEvent?: (event: LinuxDoVerificationPageEvent, webViewKey: number) => void;
  onChallengeReturned?: (webViewKey: number) => void;
  onDocumentNavigation?: (webViewKey: number) => void;
};

export function useLinuxDoVerificationPage({
  dedicated,
  web,
  credentialAttempt,
  loginFormMode,
  linuxDoWebViewKey: key,
  linuxDoWebViewRef,
  loadingLinuxDoPage,
  showLinuxDoPanel: visible,
  handleLinuxDoNavigation,
  onHandleLinuxDoMessage,
  onLoginFormMessage,
  onResetLinuxDoWebView,
  onRetryRecovery,
  onSetLinuxDoWebViewError,
  onSetLoadingLinuxDoPage,
  onVerificationPageEvent,
  onChallengeReturned,
  onDocumentNavigation
}: LinuxDoVerificationPageProps & { dedicated: boolean; web: boolean }) {
  const [stage, setStage] = useState<'account' | 'challenge' | 'returning'>(
    dedicated && !loginFormMode ? 'challenge' : 'account'
  );
  const [needsRemount, setNeedsRemount] = useState(false);
  const current = useCommittedRef({ key, visible, web });
  const documentUrl = useRef('');
  const failedUrl = useRef<string | null>(null);
  const ignoredMessage = useRef(false);
  const returned = useRef(false);
  const entryLogged = useRef(false);
  const wasVisible = useRef(false);
  const isCurrent = () => current.current.key === key && current.current.visible && current.current.web;
  const record = useCallback(
    (
      action: LinuxDoVerificationPageEvent['verificationAction'],
      url: string,
      fields: Partial<LinuxDoVerificationPageEvent> = {}
    ) =>
      onVerificationPageEvent?.(
        { ...fields, verificationAction: action, verificationPage: verificationPage(url) },
        key
      ),
    [key, onVerificationPageEvent]
  );

  useEffect(() => {
    if (!visible || loginFormMode || !wasVisible.current) {
      setStage(visible && dedicated && !loginFormMode ? 'challenge' : 'account');
    }
    wasVisible.current = visible;
  }, [dedicated, loginFormMode, visible]);

  useEffect(() => {
    documentUrl.current = '';
    failedUrl.current = null;
    ignoredMessage.current = false;
    returned.current = false;
    entryLogged.current = false;
    setNeedsRemount(false);
  }, [key, visible]);

  useEffect(() => {
    if (!visible || !web || !loadingLinuxDoPage) return;
    const timer = setTimeout(() => {
      record('load-timeout', documentUrl.current, { reason: 'timeout', hasLoadError: true });
      setNeedsRemount(true);
      onSetLoadingLinuxDoPage(false, key);
      onSetLinuxDoWebViewError('页面打开超时，请检查网络后重新打开。', key, credentialAttempt);
    }, 12_000);
    return () => clearTimeout(timer);
  }, [
    credentialAttempt,
    key,
    loadingLinuxDoPage,
    onSetLinuxDoWebViewError,
    onSetLoadingLinuxDoPage,
    record,
    visible,
    web
  ]);

  const openChallenge = () => {
    record('alternate-manual', CHALLENGE_URL);
    setStage('challenge');
    if (web) onResetLinuxDoWebView();
    else onRetryRecovery?.();
  };
  const refresh = () => {
    if (stage !== 'account') setStage('challenge');
    onResetLinuxDoWebView();
  };
  const webViewProps: WebViewProps = {
    source: {
      uri: loginFormMode ? LOGIN_FORM_ADAPTERS.linuxdo.loginUrl : stage === 'challenge' ? CHALLENGE_URL : FORUM_URL
    },
    onShouldStartLoadWithRequest: (request) => {
      const allowed = handleLinuxDoNavigation(request);
      if (allowed && request.isTopFrame !== false && isCurrent()) onDocumentNavigation?.(key);
      return allowed;
    },
    onLoadProgress: (event) => {
      if (isCurrent() && event.nativeEvent.progress >= 0.8) onSetLoadingLinuxDoPage(false, key);
    },
    onLoadStart: (event) => {
      if (!isCurrent()) return;
      const url = event?.nativeEvent.url || '';
      // Android can deliver a new document's HTTP error before its history/start callback.
      const earlyHttpError = failedUrl.current === url && documentUrl.current !== url;
      if (!earlyHttpError && (documentUrl.current !== url || event?.nativeEvent.loading !== false))
        failedUrl.current = null;
      documentUrl.current = url;
      if (event?.nativeEvent.loading !== false) ignoredMessage.current = false;
      if (stage === 'challenge' && !entryLogged.current) {
        entryLogged.current = true;
        record('challenge-open', CHALLENGE_URL);
      }
      record('load-start', url);
      setNeedsRemount(false);
      if (!failedUrl.current) onSetLinuxDoWebViewError('', key, credentialAttempt);
      onSetLoadingLinuxDoPage(event?.nativeEvent.loading !== false, key);
    },
    onLoadEnd: (event) => {
      if (!isCurrent()) return;
      const url = event.nativeEvent.url || documentUrl.current;
      const hasLoadError = failedUrl.current === url || 'code' in event.nativeEvent;
      record('load-end', url, { hasLoadError });
      onSetLoadingLinuxDoPage(false, key);
      if (!hasLoadError) onSetLinuxDoWebViewError('', key, credentialAttempt);
      // CDK relies on native success-only injection, not Android's synthetic error finish.
      if (stage === 'challenge') return;
      linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
      if (loginFormMode)
        linuxDoWebViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.linuxdo.probeScript(credentialAttempt));
    },
    onMessage: (event) => {
      if (!isCurrent()) return;
      const url = event.nativeEvent.url || '';
      if (stage === 'challenge' || url === 'https://cdk.linux.do' || url.startsWith(CHALLENGE_URL)) {
        // Android emits a finish before a network error; require a real document probe instead.
        if (
          stage === 'challenge' &&
          !returned.current &&
          documentUrl.current === CHALLENGE_URL + 'login' &&
          (url === 'https://cdk.linux.do' || url === CHALLENGE_URL + 'login')
        ) {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            const prefix = CHALLENGE_URL + 'login:';
            const timeOrigin =
              typeof message.documentKey === 'string' && message.documentKey.startsWith(prefix)
                ? Number(message.documentKey.slice(prefix.length))
                : 0;
            if (
              message.type === 'linuxdo-webview' &&
              message.hasChallengeMarker === false &&
              Number.isFinite(timeOrigin) &&
              timeOrigin > 0 &&
              failedUrl.current !== CHALLENGE_URL + 'login'
            ) {
              returned.current = true;
              record('return-to-forum', CHALLENGE_URL + 'login');
              onChallengeReturned?.(key);
              setStage('returning');
              onSetLoadingLinuxDoPage(true, key);
              return;
            }
          } catch {
            // Foreign page messages never enter account state.
          }
        }
        if (!ignoredMessage.current) {
          ignoredMessage.current = true;
          record('message-ignored', url);
        }
        return;
      }
      if (!onLoginFormMessage(event)) onHandleLinuxDoMessage(event, key);
    },
    onError: (event) => {
      if (!isCurrent()) return;
      failedUrl.current = event.nativeEvent.url || documentUrl.current;
      record('load-error', failedUrl.current, { reason: 'network_error', hasLoadError: true });
      onSetLoadingLinuxDoPage(false, key);
      onSetLinuxDoWebViewError('页面加载失败，请检查网络后重新打开。', key, credentialAttempt);
    },
    onHttpError: (event) => {
      if (!isCurrent()) return;
      const { url, statusCode } = event.nativeEvent;
      record('http-error', url, {
        status: statusCode,
        hasLoadError: true,
        isDocumentUrlMatch: documentUrl.current === url
      });
      failedUrl.current = url;
      if (documentUrl.current && documentUrl.current !== url) return;
      onSetLoadingLinuxDoPage(false, key);
      // A 403 may be the interactive challenge itself; keep the site's page usable.
      if (statusCode !== 403) onSetLinuxDoWebViewError(`页面返回 HTTP ${statusCode}，可以重新打开后再试。`, key);
    },
    onRenderProcessGone: () => {
      if (!isCurrent()) return;
      record('renderer-gone', documentUrl.current, { reason: 'renderer_gone', hasLoadError: true });
      setNeedsRemount(true);
      onSetLoadingLinuxDoPage(false, key);
      onSetLinuxDoWebViewError('验证页面已停止，请重新打开。', key, credentialAttempt);
    }
  };
  return { stage, needsRemount, openChallenge, refresh, webViewProps };
}
