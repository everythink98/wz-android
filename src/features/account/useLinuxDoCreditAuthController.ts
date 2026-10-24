import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import type { AuthSurfaceCloseReason, AuthSurfaceTicket } from '@/domain/session/authSurfaceCoordinator';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import { nativeSecureRandomHex } from '@/platform/android/secureRandom';
import { isLinuxDoCreditAuthMessage } from '@/platform/network/linuxDoCreditAuthScript';
import { appQueryClient } from '@/platform/query/serverState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type CreditAuthMode = 'manual' | 'silent';
type CreditAuthOpening = {
  ticket: AuthSurfaceTicket;
  controller: AbortController;
  mode: CreditAuthMode;
  nonce: string | null;
  timeout?: ReturnType<typeof setTimeout>;
  completion: Promise<void>;
  resolve: () => void;
};
type CreditAuthDocument = { generation: number; userAgent: string } & (
  { mode: 'manual' } | { mode: 'silent'; nonce: string }
);

export function useLinuxDoCreditAuthController({
  appActive,
  beginSurface,
  canStartSilent,
  finishSurface,
  getUserAgent,
  notify,
  prepareCookieBarrier,
  prepareSurfaceOpen,
  readRuntime,
  screenActive,
  surfaceVisible
}: {
  appActive: boolean;
  beginSurface: (mode: CreditAuthMode) => AuthSurfaceTicket;
  canStartSilent: () => boolean;
  finishSurface: (reason: AuthSurfaceCloseReason) => Promise<AccountReconcileResult> | null;
  getUserAgent: () => string;
  notify: (message: string) => void;
  prepareCookieBarrier: () => Promise<void>;
  prepareSurfaceOpen: () => void;
  readRuntime: () => SessionRuntimeSnapshot;
  screenActive: boolean;
  surfaceVisible: boolean;
}) {
  const webViewRef = useRef<WebView>(null);
  const openingRef = useRef<CreditAuthOpening | null>(null);
  const closingRef = useRef<Promise<void> | null>(null);
  const closingModeRef = useRef<CreditAuthMode | null>(null);
  const revisionRef = useRef(0);
  const manualIntentRef = useRef(0);
  const attemptedOwnerRef = useRef<string | null>(null);
  const screenActiveRef = useCommittedRef(screenActive);
  const appActiveRef = useCommittedRef(appActive);
  const [generation, setGeneration] = useState(0);
  const [document, setDocument] = useState<CreditAuthDocument | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(
    (reason: AuthSurfaceCloseReason = 'close-button'): Promise<void> => {
      ++manualIntentRef.current;
      const opening = openingRef.current;
      if (!opening) return closingRef.current || Promise.resolve();
      openingRef.current = null;
      opening.controller.abort();
      clearTimeout(opening.timeout);
      const revision = ++revisionRef.current;
      webViewRef.current?.stopLoading();
      setDocument(null);
      setLoading(false);
      const reconciliation = finishSurface(reason);
      const closing = Promise.resolve(reconciliation)
        .then((result) => {
          if (
            revisionRef.current !== revision ||
            !result ||
            (result.status !== 'same' && result.status !== 'changed') ||
            (opening.mode === 'silent' && reason !== 'success')
          )
            return;
          const runtime = readRuntime();
          if (
            runtime.sourceEnabled === false ||
            runtime.authSurfaceOpen ||
            runtime.identityKey !== siteSessionIdentityKey(result.session)
          )
            return;
          void appQueryClient.invalidateQueries({
            predicate: ({ queryKey }) =>
              queryKey[0] === 'forum' &&
              queryKey[1] === 'linuxdo' &&
              queryKey[2] === 'account-data' &&
              (queryKey[3] === 'ldc-account' || queryKey[3] === 'ldc-transactions')
          });
        })
        .catch(() => undefined)
        .finally(() => {
          opening.resolve();
          if (closingRef.current === closing) {
            closingRef.current = null;
            closingModeRef.current = null;
          }
          if (revisionRef.current === revision) setBusy(false);
        });
      closingRef.current = closing;
      closingModeRef.current = opening.mode;
      return closing;
    },
    [finishSurface, readRuntime]
  );
  const prepareDocument = useCallback(
    async (opening: CreditAuthOpening) => {
      setError('');
      setLoading(true);
      try {
        const [, userAgent, nonce] = await Promise.all([
          prepareCookieBarrier(),
          resolveWebViewUserAgent(getUserAgent(), opening.controller.signal),
          opening.mode === 'silent' ? nativeSecureRandomHex(16) : Promise.resolve(null)
        ]);
        const runtime = readRuntime();
        if (
          openingRef.current !== opening ||
          opening.controller.signal.aborted ||
          runtime.identityKey !== opening.ticket.identityKey ||
          runtime.sessionEpoch !== opening.ticket.sessionEpoch ||
          runtime.sourceEnabled === false
        )
          return;
        if (opening.mode === 'silent') {
          if (!nonce || !/^[0-9a-f]{32}$/.test(nonce)) throw new Error('Invalid authorization nonce');
          opening.nonce = nonce;
          setDocument({ generation: opening.ticket.generation, userAgent, mode: 'silent', nonce });
        } else setDocument({ generation: opening.ticket.generation, userAgent, mode: 'manual' });
      } catch {
        if (openingRef.current !== opening || opening.controller.signal.aborted) return;
        if (opening.mode === 'silent') {
          void close('cancel');
          return;
        }
        setLoading(false);
        setError('LDC 页面准备失败，请刷新重试。');
      }
    },
    [close, getUserAgent, prepareCookieBarrier, readRuntime]
  );
  const start = useCallback(
    (mode: CreditAuthMode) => {
      let resolve: () => void = () => undefined;
      const completion = new Promise<void>((done) => {
        resolve = done;
      });
      const opening: CreditAuthOpening = {
        ticket: beginSurface(mode),
        controller: new AbortController(),
        mode,
        nonce: null,
        completion,
        resolve
      };
      openingRef.current = opening;
      setGeneration(opening.ticket.generation);
      ++revisionRef.current;
      setBusy(mode === 'silent');
      if (mode === 'silent')
        opening.timeout = setTimeout(() => {
          if (openingRef.current === opening) void close('cancel');
        }, 30_000);
      return { opening, prepared: prepareDocument(opening) };
    },
    [beginSurface, close, prepareDocument]
  );
  const open = useCallback(async () => {
    if (openingRef.current?.mode === 'manual') return;
    const expectedIdentity = readRuntime().identityKey;
    if (openingRef.current?.mode === 'silent' || closingModeRef.current === 'silent') {
      const closing = close('switch-surface');
      const closeIntent = manualIntentRef.current;
      await closing;
      if (manualIntentRef.current !== closeIntent) return;
    }
    const runtime = readRuntime();
    if (
      !screenActiveRef.current ||
      runtime.sourceEnabled === false ||
      !runtime.authenticated ||
      runtime.identityTrust !== 'confirmed' ||
      runtime.identityKey !== expectedIdentity
    ) {
      notify('请先登录 linux.do，再连接 LDC。');
      return;
    }
    prepareSurfaceOpen();
    attemptedOwnerRef.current = runtime.identityKey + ':' + runtime.sessionEpoch;
    await start('manual').prepared;
  }, [close, notify, prepareSurfaceOpen, readRuntime, screenActiveRef, start]);
  const connectSilently = useCallback((): Promise<void> => {
    if (openingRef.current)
      return openingRef.current.mode === 'silent' ? openingRef.current.completion : Promise.resolve();
    if (closingRef.current) return closingRef.current;
    const runtime = readRuntime();
    const owner = runtime.identityKey + ':' + runtime.sessionEpoch;
    if (
      !appActiveRef.current ||
      !screenActiveRef.current ||
      runtime.sourceEnabled === false ||
      !runtime.authenticated ||
      runtime.identityTrust !== 'confirmed' ||
      runtime.authSurfaceOpen ||
      !canStartSilent() ||
      attemptedOwnerRef.current === owner
    )
      return Promise.resolve();
    attemptedOwnerRef.current = owner;
    return start('silent').opening.completion;
  }, [appActiveRef, canStartSilent, readRuntime, screenActiveRef, start]);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const opening = openingRef.current;
      if (opening?.mode !== 'silent' || !opening.nonce) return;
      const runtime = readRuntime();
      if (
        opening.controller.signal.aborted ||
        !screenActiveRef.current ||
        !appActiveRef.current ||
        runtime.sourceEnabled === false ||
        runtime.identityKey !== opening.ticket.identityKey ||
        runtime.sessionEpoch !== opening.ticket.sessionEpoch
      )
        return;
      const outcome = isLinuxDoCreditAuthMessage(event.nativeEvent.data, event.nativeEvent.url, opening.nonce);
      if (outcome) void close(outcome === 'complete' ? 'success' : 'cancel');
    },
    [appActiveRef, close, readRuntime, screenActiveRef]
  );
  const failSilent = useCallback(
    (expectedGeneration: number) => {
      if (openingRef.current?.mode === 'silent' && openingRef.current.ticket.generation === expectedGeneration)
        void close('cancel');
    },
    [close]
  );
  const retry = useCallback(() => {
    const previous = openingRef.current;
    if (!previous || document || loading || previous.mode !== 'manual') return;
    previous.controller.abort();
    const opening = { ...previous, controller: new AbortController() };
    openingRef.current = opening;
    void prepareDocument(opening);
  }, [document, loading, prepareDocument]);
  useLayoutEffect(() => {
    const runtime = readRuntime();
    if (runtime.sourceEnabled === false) {
      void close('source-disabled');
      return;
    }
    if (!screenActive) {
      void close('navigation-away');
      return;
    }
    const opening = openingRef.current;
    if (opening?.mode === 'silent' && !appActive) {
      void close('cancel');
      return;
    }
    if (
      opening &&
      (runtime.identityKey !== opening.ticket.identityKey || runtime.sessionEpoch !== opening.ticket.sessionEpoch)
    )
      void close('cancel');
  });
  useEffect(
    () => () => {
      const opening = openingRef.current;
      opening?.controller.abort();
      clearTimeout(opening?.timeout);
      opening?.resolve();
      openingRef.current = null;
      ++revisionRef.current;
      ++manualIntentRef.current;
    },
    []
  );
  return {
    open,
    connectSilently,
    busy,
    panel: {
      close,
      document,
      error,
      generation,
      loading,
      retry,
      setLoading,
      visible: surfaceVisible,
      webViewRef,
      handleMessage,
      failSilent
    }
  };
}
