import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { WebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';
import { LINUXDO_URL } from '@/domain/forum/sourceUrls';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { LinuxDoForumDocumentEvent, LinuxDoVerificationPageEvent } from '../useVerificationController';
import type { LoginFormMessageHandler } from '../credentialFillSession';
import { useLoginFormProbe } from './useLoginFormProbe';
import { useWebViewLoadDeadline } from './useWebViewLoadDeadline';
import {
  createLinuxDoVerificationDocument,
  LINUXDO_CHALLENGE_URL as CHALLENGE_URL
} from './linuxDoVerificationDocument';

const FORUM_URL = LINUXDO_URL + '/latest';

function isForumDocument(url: string) {
  return url === LINUXDO_URL || url.startsWith(LINUXDO_URL + '/');
}

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
  onLoginFormMessage: LoginFormMessageHandler;
  onLoginFormDocumentRetired?: (attempt: number) => void;
  onResetLinuxDoWebView: () => void;
  onRetryRecovery?: () => void;
  onSetLinuxDoWebViewError: (value: string, webViewKey?: number, credentialAttempt?: number) => void;
  onSetLoadingLinuxDoPage: (value: boolean, webViewKey?: number) => void;
  onVerificationPageEvent?: (event: LinuxDoVerificationPageEvent, webViewKey: number) => void;
  onForumDocument?: (webViewKey: number, event: LinuxDoForumDocumentEvent) => void;
  onDocumentNavigation?: (webViewKey: number) => void;
};

export function useLinuxDoVerificationPage({
  dedicated,
  mounted,
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
  onLoginFormDocumentRetired,
  onResetLinuxDoWebView,
  onRetryRecovery,
  onSetLinuxDoWebViewError,
  onSetLoadingLinuxDoPage,
  onVerificationPageEvent,
  onForumDocument,
  onDocumentNavigation
}: LinuxDoVerificationPageProps & { dedicated: boolean; web: boolean; mounted: boolean }) {
  const [document] = useState(() => createLinuxDoVerificationDocument(dedicated && !loginFormMode));
  const [pageSnapshot, setPageSnapshot] = useState(document.snapshot);
  const { stage, needsRemount } = pageSnapshot;
  const publishPage = useCallback(() => setPageSnapshot(document.snapshot), [document]);
  const current = useCommittedRef({ key, visible, web });
  const isCurrent = () =>
    current.current.key === key && current.current.visible && current.current.web && !document.snapshot.needsRemount;
  const form = useLoginFormProbe({
    adapter: LOGIN_FORM_ADAPTERS.linuxdo,
    enabled: visible && mounted && web && !needsRemount && loginFormMode,
    webViewKey: key,
    webViewRef: linuxDoWebViewRef,
    onRetired: onLoginFormDocumentRetired
  });
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

  const updateDeadline = useWebViewLoadDeadline({
    enabled: visible && web && mounted && !needsRemount,
    loading: loadingLinuxDoPage,
    webViewKey: key,
    onTimeout: () => {
      record('load-timeout', document.documentUrl, { reason: 'timeout', hasLoadError: true });
      document.requireRemount();
      publishPage();
      onSetLoadingLinuxDoPage(false, key);
      onSetLinuxDoWebViewError('页面打开超时，请检查网络后重新打开。', key, credentialAttempt);
    }
  });
  const setLoading = (value: boolean) => {
    updateDeadline(key, value);
    onSetLoadingLinuxDoPage(value, key);
  };

  const openChallenge = () => {
    updateDeadline(key, false);
    form.retire();
    record('alternate-manual', CHALLENGE_URL);
    document.showChallenge();
    publishPage();
    if (web) onResetLinuxDoWebView();
    else onRetryRecovery?.();
  };
  const refresh = () => {
    updateDeadline(key, false);
    form.retire();
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
      if (!isCurrent()) return false;
      const allowed = handleLinuxDoNavigation(request);
      if (allowed && request.isTopFrame !== false) {
        form.retire();
        onDocumentNavigation?.(key);
        if (isForumDocument(request.url)) onForumDocument?.(key, 'navigation');
      }
      return allowed;
    },
    onMainFrameLoadStart: () => {
      if (isCurrent()) form.retire();
    },
    onLoadProgress: (event) => {
      if (isCurrent() && event.nativeEvent.progress >= 0.8) setLoading(false);
    },
    onLoadStart: (event) => {
      if (!isCurrent()) return;
      const url = event?.nativeEvent.url || '';
      if (isForumDocument(url)) onForumDocument?.(key, 'navigation');
      const started = document.started(url, event?.nativeEvent.loading !== false, stage);
      if (started.logChallengeEntry) record('challenge-open', CHALLENGE_URL);
      record('load-start', url);
      publishPage();
      if (started.clearError) onSetLinuxDoWebViewError('', key, credentialAttempt);
      setLoading(event?.nativeEvent.loading !== false);
    },
    onLoadEnd: (event) => {
      if (!isCurrent()) return;
      const url = event.nativeEvent.url || document.documentUrl;
      const hasLoadError = document.finished(url, 'code' in event.nativeEvent);
      record('load-end', url, { hasLoadError });
      setLoading(false);
      if (!hasLoadError) onSetLinuxDoWebViewError('', key, credentialAttempt);
      // CDK relies on native success-only injection, not Android's synthetic error finish.
      if (stage === 'challenge') return;
      linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
      if (!hasLoadError) form.probe(url, credentialAttempt);
    },
    onMessage: (event) => {
      if (!isCurrent()) return;
      const url = event.nativeEvent.url || '';
      const result =
        isForumDocument(document.documentUrl) && isForumDocument(url)
          ? 'unrelated'
          : document.challengeMessage(event.nativeEvent.data, url, stage);
      if (result === 'returned') {
        record('return-to-forum', CHALLENGE_URL + 'login');
        onForumDocument?.(key, 'challenge-return');
        publishPage();
        setLoading(true);
        return;
      }
      if (result === 'ignored-first') record('message-ignored', url);
      if (result !== 'unrelated') return;
      if (!onLoginFormMessage(event, form.currentDocument())) onHandleLinuxDoMessage(event, key);
    },
    onError: (event) => {
      if (!isCurrent()) return;
      form.retire();
      const url = event.nativeEvent.url || document.documentUrl;
      document.failed(url);
      const description = event.nativeEvent.description ?? '';
      const reason = /ERR_(?:NAME_NOT_RESOLVED|DNS_)/.test(description)
        ? 'dns_error'
        : /ERR_(?:SSL_|CERT_)/.test(description)
          ? 'tls_error'
          : 'network_error';
      record('load-error', url, { reason, hasLoadError: true });
      document.requireRemount();
      publishPage();
      setLoading(false);
      const closed = /\bERR_CONNECTION_(?:CLOSED|RESET)\b/.test(description);
      onSetLinuxDoWebViewError(
        closed
          ? '网页连接已关闭。请重新打开，如果仍然失败，请切换网络后再试。'
          : '页面加载失败，请检查网络后重新打开。',
        key,
        credentialAttempt
      );
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
      setLoading(false);
      // A 403 may be the interactive challenge itself; keep the site's page usable.
      if (statusCode !== 403) onSetLinuxDoWebViewError(`页面返回 HTTP ${statusCode}，可以重新打开后再试。`, key);
    },
    onRenderProcessGone: () => {
      if (!isCurrent()) return;
      form.retire();
      record('renderer-gone', document.documentUrl, { reason: 'renderer_gone', hasLoadError: true });
      document.requireRemount();
      publishPage();
      setLoading(false);
      onSetLinuxDoWebViewError('验证页面已停止，请重新打开。', key, credentialAttempt);
    }
  };
  return { stage, needsRemount, openChallenge, refresh, webViewProps };
}
