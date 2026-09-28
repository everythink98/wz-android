import { type RefObject, useEffect, useState } from 'react';
import type { WebView } from 'react-native-webview';

export function useLoginWebViewLifecycle({
  credentialAttempt,
  messagePrefix,
  loading,
  visible,
  webViewBlockMessage,
  webViewRef,
  onSetLoading,
  onWebViewState
}: {
  credentialAttempt: number;
  messagePrefix: string;
  loading: boolean;
  visible: boolean;
  webViewBlockMessage: string;
  webViewRef: RefObject<WebView | null>;
  onSetLoading: (value: boolean) => void;
  onWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout', attempt?: number) => void;
}) {
  const [page, setPage] = useState({ error: '', key: 0, needsRemount: false, settled: false });
  useEffect(() => {
    if (visible) return;
    setPage((current) => ({ ...current, error: '', needsRemount: false, settled: false }));
  }, [visible]);
  useEffect(() => {
    if (!visible || !loading || webViewBlockMessage) return;
    const timeout = setTimeout(() => {
      setPage((current) => ({
        ...current,
        settled: true,
        needsRemount: true,
        error: `${messagePrefix}页面打开超时：请检查模拟器网络后刷新页面。`
      }));
      onWebViewState('timeout', credentialAttempt);
      onSetLoading(false);
    }, 12000);
    return () => clearTimeout(timeout);
  }, [credentialAttempt, messagePrefix, loading, onSetLoading, onWebViewState, visible, webViewBlockMessage]);
  return {
    ...page,
    refresh: () => {
      setPage((current) => ({
        error: '',
        key: current.key + Number(current.needsRemount),
        needsRemount: false,
        settled: false
      }));
      onSetLoading(true);
      if (!page.needsRemount) webViewRef.current?.reload();
    },
    start: () => {
      onWebViewState('start', credentialAttempt);
      setPage((current) => ({ ...current, error: '', needsRemount: false, settled: false }));
      onSetLoading(true);
    },
    loadEnd: (failed: boolean) => {
      onSetLoading(false);
      setPage((current) => ({ ...current, settled: true, error: failed ? current.error : '' }));
      if (failed) return;
      onWebViewState('ready', credentialAttempt);
    },
    fail: (description: string) => {
      onWebViewState('error', credentialAttempt);
      onSetLoading(false);
      setPage((current) => ({
        ...current,
        settled: true,
        error: `${messagePrefix}页面加载失败：${description || '请检查模拟器网络后关闭重试。'}`
      }));
    },
    rendererGone: () => {
      onWebViewState('renderer-gone', credentialAttempt);
      onSetLoading(false);
      setPage((current) => ({
        ...current,
        settled: true,
        needsRemount: true,
        error: `${messagePrefix}登录页面已停止，请刷新页面重试。`
      }));
    }
  };
}
