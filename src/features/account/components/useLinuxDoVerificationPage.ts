import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { WebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';
import { LINUXDO_URL } from '@/domain/forum/sourceUrls';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { LinuxDoVerificationPageEvent } from '../useVerificationController';
import {
  createLinuxDoVerificationDocument,
  LINUXDO_CHALLENGE_URL as CHALLENGE_URL
} from './linuxDoVerificationDocument';

const FORUM_URL = LINUXDO_URL + '/latest';

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
  const [document] = useState(() => createLinuxDoVerificationDocument(dedicated && !loginFormMode));
  const [pageSnapshot, setPageSnapshot] = useState(document.snapshot);
  const { stage, needsRemount } = pageSnapshot;
  const publishPage = useCallback(() => setPageSnapshot(document.snapshot), [document]);
  const current = useCommittedRef({ key, visible, web });
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
    document.observeVisibility(visible, dedicated, loginFormMode);
    publishPage();
  }, [dedicated, document, loginFormMode, publishPage, visible]);

  useEffect(() => {
    document.resetDocument();
    publishPage();
  }, [document, key, publishPage, visible]);

  useEffect(() => {
    if (!visible || !web || !loadingLinuxDoPage) return;
    const timer = setTimeout(() => {
      record('load-timeout', document.documentUrl, { reason: 'timeout', hasLoadError: true });
      document.requireRemount();
      publishPage();
      onSetLoadingLinuxDoPage(false, key);
      onSetLinuxDoWebViewError('页面打开超时，请检查网络后重新打开。', key, credentialAttempt);
    }, 12_000);
    return () => clearTimeout(timer);
  }, [
    credentialAttempt,
    document,
    key,
    loadingLinuxDoPage,
    onSetLinuxDoWebViewError,
    onSetLoadingLinuxDoPage,
    publishPage,
    record,
    visible,
    web
  ]);

  const openChallenge = () => {
    record('alternate-manual', CHALLENGE_URL);
    document.showChallenge();
    publishPage();
    if (web) onResetLinuxDoWebView();
    else onRetryRecovery?.();
  };
  const refresh = () => {
    if (stage !== 'account') {
      document.showChallenge();
      publishPage();
    }
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
      const started = document.started(url, event?.nativeEvent.loading !== false, stage);
      if (started.logChallengeEntry) record('challenge-open', CHALLENGE_URL);
      record('load-start', url);
      publishPage();
      if (started.clearError) onSetLinuxDoWebViewError('', key, credentialAttempt);
      onSetLoadingLinuxDoPage(event?.nativeEvent.loading !== false, key);
    },
    onLoadEnd: (event) => {
      if (!isCurrent()) return;
      const url = event.nativeEvent.url || document.documentUrl;
      const hasLoadError = document.finished(url, 'code' in event.nativeEvent);
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
      const result = document.challengeMessage(event.nativeEvent.data, url, stage);
      if (result === 'returned') {
        record('return-to-forum', CHALLENGE_URL + 'login');
        onChallengeReturned?.(key);
        publishPage();
        onSetLoadingLinuxDoPage(true, key);
        return;
      }
      if (result === 'ignored-first') record('message-ignored', url);
      if (result !== 'unrelated') return;
      if (!onLoginFormMessage(event)) onHandleLinuxDoMessage(event, key);
    },
    onError: (event) => {
      if (!isCurrent()) return;
      const url = event.nativeEvent.url || document.documentUrl;
      document.failed(url);
      record('load-error', url, { reason: 'network_error', hasLoadError: true });
      onSetLoadingLinuxDoPage(false, key);
      onSetLinuxDoWebViewError('页面加载失败，请检查网络后重新打开。', key, credentialAttempt);
    },
    onHttpError: (event) => {
      if (!isCurrent()) return;
      const { url, statusCode } = event.nativeEvent;
      record('http-error', url, {
        status: statusCode,
        hasLoadError: true,
        isDocumentUrlMatch: document.documentUrl === url
      });
      document.failed(url);
      if (document.documentUrl && document.documentUrl !== url) return;
      onSetLoadingLinuxDoPage(false, key);
      // A 403 may be the interactive challenge itself; keep the site's page usable.
      if (statusCode !== 403) onSetLinuxDoWebViewError(`页面返回 HTTP ${statusCode}，可以重新打开后再试。`, key);
    },
    onRenderProcessGone: () => {
      if (!isCurrent()) return;
      record('renderer-gone', document.documentUrl, { reason: 'renderer_gone', hasLoadError: true });
      document.requireRemount();
      publishPage();
      onSetLoadingLinuxDoPage(false, key);
      onSetLinuxDoWebViewError('验证页面已停止，请重新打开。', key, credentialAttempt);
    }
  };
  return { stage, needsRemount, openChallenge, refresh, webViewProps };
}
