import { type RefObject, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { LoginWebViewDiagnosticState } from '../useAccountController';

type AutomaticCheckPhase = 'available' | 'consumed' | 'failed' | 'failed-consumed';

type LoginPage = {
  error: string;
  key: number;
  stage: 'unsettled' | 'settled' | 'remount-required';
};

const AUTOMATIC_CHECK_TRANSITIONS = {
  available: { consume: 'consumed', fail: 'failed', clearFailure: 'available' },
  consumed: { consume: 'consumed', fail: 'failed-consumed', clearFailure: 'consumed' },
  failed: { consume: 'failed-consumed', fail: 'failed', clearFailure: 'available' },
  'failed-consumed': { consume: 'failed-consumed', fail: 'failed-consumed', clearFailure: 'consumed' }
} as const satisfies Record<AutomaticCheckPhase, Record<'consume' | 'fail' | 'clearFailure', AutomaticCheckPhase>>;

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
  const [page, setPage] = useState<LoginPage>({ error: '', key: 0, stage: 'unsettled' });
  const current = useCommittedRef({ visible: visible && !webViewBlockMessage, key: page.key });
  const documentStateRef = useRef<{ phase: AutomaticCheckPhase; url: string }>({ phase: 'available', url: '' });
  const isCurrent = () => current.current.visible && current.current.key === page.key;
  useEffect(
    () => () => {
      current.current = { visible: false, key: -1 };
    },
    [current]
  );
  useEffect(() => {
    if (visible && !webViewBlockMessage) return;
    documentStateRef.current.url = '';
    documentStateRef.current.phase = visible
      ? AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].clearFailure
      : 'available';
    setPage((current) => ({ key: current.key + 1, error: '', stage: 'unsettled' }));
  }, [visible, webViewBlockMessage]);
  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active')
        documentStateRef.current.phase = AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].consume;
    });
    return () => subscription.remove();
  }, [visible]);
  useEffect(() => {
    if (!visible || !loading || webViewBlockMessage) return;
    const timeout = setTimeout(() => {
      documentStateRef.current.phase = AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].fail;
      setPage((current) => ({
        ...current,
        key: current.key + 1,
        stage: 'remount-required',
        error: `${messagePrefix}页面打开超时：请检查网络后重新打开。`
      }));
      onWebViewState('timeout', credentialAttempt);
      onSetLoading(false);
    }, 12000);
    return () => clearTimeout(timeout);
  }, [credentialAttempt, messagePrefix, loading, onSetLoading, onWebViewState, visible, webViewBlockMessage]);
  return {
    error: page.error,
    key: page.key,
    needsRemount: page.stage === 'remount-required',
    settled: page.stage !== 'unsettled',
    isCurrent,
    check: () => {
      if (!isCurrent() || checking) return;
      documentStateRef.current.phase = AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].consume;
      onCheck();
    },
    message: (event: WebViewMessageEvent) => {
      if (
        !recoveryPending ||
        !isCurrent() ||
        checking ||
        webViewBlockMessage ||
        documentStateRef.current.phase !== 'available' ||
        AppState.currentState !== 'active'
      )
        return;
      try {
        const url = new URL(documentStateRef.current.url);
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
        documentStateRef.current.phase = AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].consume;
        onWebViewState('auto-check', credentialAttempt);
        onCheck();
      } catch {
        // Other bridge messages do not indicate that the login page is ready.
      }
    },
    refresh: () => {
      if (!isCurrent() || checking) return;
      documentStateRef.current.phase = 'consumed';
      documentStateRef.current.url = '';
      setPage((current) => ({
        error: '',
        key: current.key + Number(current.stage === 'remount-required'),
        stage: 'unsettled'
      }));
      onSetLoading(true);
      if (page.stage !== 'remount-required') webViewRef.current?.reload();
    },
    start: (url = '', loading = true) => {
      if (!isCurrent()) return;
      if (url !== documentStateRef.current.url || loading)
        documentStateRef.current.phase = AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].clearFailure;
      documentStateRef.current.url = url;
      onWebViewState('start', credentialAttempt);
      setPage((current) => ({ ...current, error: '', stage: 'unsettled' }));
      onSetLoading(loading);
    },
    loadEnd: (failed: boolean) => {
      if (!isCurrent()) return;
      onSetLoading(false);
      setPage((current) => ({
        ...current,
        stage: current.stage === 'remount-required' ? 'remount-required' : 'settled',
        error: failed ? current.error : ''
      }));
      if (failed) return;
      onWebViewState('ready', credentialAttempt);
    },
    fail: (description: string) => {
      if (!isCurrent()) return;
      documentStateRef.current.phase = AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].fail;
      onWebViewState('error', credentialAttempt);
      onSetLoading(false);
      setPage((current) => ({
        ...current,
        stage: current.stage === 'remount-required' ? 'remount-required' : 'settled',
        error: `${messagePrefix}页面加载失败：${description || '请检查网络后重试。'}`
      }));
    },
    rendererGone: () => {
      if (!isCurrent()) return;
      documentStateRef.current.phase = AUTOMATIC_CHECK_TRANSITIONS[documentStateRef.current.phase].fail;
      onWebViewState('renderer-gone', credentialAttempt);
      onSetLoading(false);
      setPage((current) => ({
        ...current,
        key: current.key + 1,
        stage: 'remount-required',
        error: `${messagePrefix}登录页面已停止，请刷新页面重试。`
      }));
    }
  };
}
