import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { WebView } from 'react-native-webview';
import type { LoginFormAdapter } from '@/domain/session/loginFormAdapters';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type LoginFormProbe = { attempt: number } & ({ phase: 'bound'; webView: WebView } | { phase: 'retired' });

export function useLoginFormProbe({
  adapter,
  enabled,
  webViewKey,
  webViewRef,
  onRetired
}: {
  adapter: LoginFormAdapter;
  enabled: boolean;
  webViewKey: number;
  webViewRef: RefObject<WebView | null>;
  onRetired?: (attempt: number) => void;
}) {
  const lastProbe = useRef<LoginFormProbe | null>(null);
  const onRetiredRef = useCommittedRef(onRetired);
  const retire = useCallback(() => {
    const probe = lastProbe.current;
    if (probe?.phase !== 'bound') return;
    lastProbe.current = { phase: 'retired', attempt: probe.attempt };
    onRetiredRef.current?.(probe.attempt);
  }, [onRetiredRef]);
  useLayoutEffect(() => retire, [adapter, enabled, retire, webViewKey]);

  const probe = useCallback(
    (url: string, attempt: number) => {
      const webView = webViewRef.current;
      if (!enabled || !webView || attempt <= 0 || lastProbe.current?.attempt === attempt || !adapter.matchesUrl(url))
        return;
      retire();
      lastProbe.current = { phase: 'bound', attempt, webView };
      webView.injectJavaScript(adapter.probeScript(attempt));
    },
    [adapter, enabled, retire, webViewRef]
  );
  const currentDocument = () => {
    const binding = lastProbe.current;
    return () =>
      binding?.phase === 'bound' && binding === lastProbe.current && webViewRef.current === binding.webView
        ? binding.webView
        : null;
  };
  return { currentDocument, probe, retire };
}
