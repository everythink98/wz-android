import { type RefObject, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { LoginWebViewDiagnosticState } from '../useAccountController';

export function useLoginWebViewLifecycle({
  checking,
  recoveryPending = false,
  credentialAttempt,
  messagePrefix,
  loading,
  visible,
  webViewBlockMessage,
  webViewRef,
  onCheck,
  onSetLoading,
  onWebViewState
}: {
  checking: boolean;
  recoveryPending?: boolean;
  credentialAttempt: number;
  messagePrefix: string;
  loading: boolean;
  visible: boolean;
  webViewBlockMessage: string;
  webViewRef: RefObject<WebView | null>;
  onCheck: () => void;
  onSetLoading: (value: boolean) => void;
  onWebViewState: (state: LoginWebViewDiagnosticState, attempt?: number) => void;
}) {
  const [page, setPage] = useState({ error: '', key: 0, needsRemount: false, settled: false });
  const current = useCommittedRef({ visible: visible && !webViewBlockMessage, key: page.key });
  const documentUrl = useRef('');
  const autoChecked = useRef(false);
  const failed = useRef(false);
  const isCurrent = () => current.current.visible && current.current.key === page.key;
  useEffect(
    () => () => {
      current.current = { visible: false, key: -1 };
    },
    [current]
  );
  useEffect(() => {
    if (visible && !webViewBlockMessage) return;
    documentUrl.current = '';
    if (!visible) autoChecked.current = false;
    failed.current = false;
    setPage((current) => ({ key: current.key + 1, error: '', needsRemount: false, settled: false }));
  }, [visible, webViewBlockMessage]);
  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') autoChecked.current = true;
    });
    return () => subscription.remove();
  }, [visible]);
  useEffect(() => {
    if (!visible || !loading || webViewBlockMessage) return;
    const timeout = setTimeout(() => {
      failed.current = true;
      setPage((current) => ({
        ...current,
        key: current.key + 1,
        settled: true,
        needsRemount: true,
        error: `${messagePrefix}页面打开超时：请检查网络后重新打开。`
      }));
      onWebViewState('timeout', credentialAttempt);
      onSetLoading(false);
    }, 12000);
    return () => clearTimeout(timeout);
  }, [credentialAttempt, messagePrefix, loading, onSetLoading, onWebViewState, visible, webViewBlockMessage]);
  return {
    ...page,
    isCurrent,
    check: () => {
      if (!isCurrent() || checking) return;
      autoChecked.current = true;
      onCheck();
    },
    message: (event: WebViewMessageEvent) => {
      if (
        !recoveryPending ||
        !isCurrent() ||
        checking ||
        webViewBlockMessage ||
        failed.current ||
        autoChecked.current ||
        AppState.currentState !== 'active'
      )
        return;
      try {
        const url = new URL(documentUrl.current);
        const messageUrl = new URL(event.nativeEvent.url);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.port ||
          (url.hostname !== 'nodeseek.com' && url.hostname !== 'www.nodeseek.com') ||
          messageUrl.username ||
          messageUrl.password ||
          messageUrl.origin !== url.origin ||
          (messageUrl.href !== url.href && messageUrl.href !== `${url.origin}/`)
        )
          return;
        const data = JSON.parse(event.nativeEvent.data);
        const prefix = `${url.href}:`;
        const origin =
          typeof data.documentKey === 'string' && data.documentKey.startsWith(prefix)
            ? Number(data.documentKey.slice(prefix.length))
            : NaN;
        if (
          data.type !== 'nodeseek-login' ||
          !Number.isFinite(origin) ||
          origin <= 0 ||
          data.hasChallengeMarker !== false ||
          (data.status !== 'logged-in' && data.status !== 'logged-out')
        )
          return;
        autoChecked.current = true;
        onWebViewState('auto-check', credentialAttempt);
        onCheck();
      } catch {
        // Other bridge messages do not indicate that the login page is ready.
      }
    },
    refresh: () => {
      if (!isCurrent() || checking) return;
      autoChecked.current = true;
      failed.current = false;
      documentUrl.current = '';
      setPage((current) => ({
        error: '',
        key: current.key + Number(current.needsRemount),
        needsRemount: false,
        settled: false
      }));
      onSetLoading(true);
      if (!page.needsRemount) webViewRef.current?.reload();
    },
    start: (url = '', loading = true) => {
      if (!isCurrent()) return;
      if (url !== documentUrl.current || loading) failed.current = false;
      documentUrl.current = url;
      onWebViewState('start', credentialAttempt);
      setPage((current) => ({ ...current, error: '', needsRemount: false, settled: false }));
      onSetLoading(loading);
    },
    loadEnd: (failed: boolean) => {
      if (!isCurrent()) return;
      onSetLoading(false);
      setPage((current) => ({ ...current, settled: true, error: failed ? current.error : '' }));
      if (failed) return;
      onWebViewState('ready', credentialAttempt);
    },
    fail: (description: string) => {
      if (!isCurrent()) return;
      failed.current = true;
      onWebViewState('error', credentialAttempt);
      onSetLoading(false);
      setPage((current) => ({
        ...current,
        settled: true,
        error: `${messagePrefix}页面加载失败：${description || '请检查网络后重试。'}`
      }));
    },
    rendererGone: () => {
      if (!isCurrent()) return;
      failed.current = true;
      onWebViewState('renderer-gone', credentialAttempt);
      onSetLoading(false);
      setPage((current) => ({
        ...current,
        key: current.key + 1,
        settled: true,
        needsRemount: true,
        error: `${messagePrefix}登录页面已停止，请刷新页面重试。`
      }));
    }
  };
}
