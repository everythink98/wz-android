import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
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
  nonce: { phase: 'unissued' } | { phase: 'issued'; value: string };
  timeout?: ReturnType<typeof setTimeout>;
  completion: Promise<void>;
  resolve: () => void;
};
type CreditAuthDocument = { generation: number; userAgent: string } & (
  { mode: 'manual' } | { mode: 'silent'; nonce: string }
);

type CreditAuthState = {
  opening: { phase: 'idle' } | { phase: 'active'; opening: CreditAuthOpening };
  closing: { phase: 'idle' } | { phase: 'settling'; promise: Promise<void>; mode: CreditAuthMode };
  attempt: { phase: 'unattempted' } | { phase: 'attempted'; owner: string };
  revision: number;
  manualIntent: number;
};
type CreditAuthPage = { phase: 'empty' | 'preparing' } | { phase: 'loading' | 'ready'; document: CreditAuthDocument };

function creditOpening(state: CreditAuthState['opening']) {
  return state.phase === 'active' ? state.opening : null;
}
function creditClosing(state: CreditAuthState['closing']) {
  return state.phase === 'settling' ? state : null;
}
function creditDocument(page: CreditAuthPage) {
  return 'document' in page ? page.document : null;
}
function creditPageLoading(page: CreditAuthPage) {
  return page.phase === 'preparing' || page.phase === 'loading';
}
function creditPage(document: CreditAuthDocument | null, loading: boolean): CreditAuthPage {
  return document ? { phase: loading ? 'loading' : 'ready', document } : { phase: loading ? 'preparing' : 'empty' };
}

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
  const authRef = useRef<CreditAuthState>({
    opening: { phase: 'idle' },
    closing: { phase: 'idle' },
    attempt: { phase: 'unattempted' },
    revision: 0,
    manualIntent: 0
  });
  const screenActiveRef = useCommittedRef(screenActive);
  const appActiveRef = useCommittedRef(appActive);
  const [generation, setGeneration] = useState(0);
  const [page, setPage] = useState<CreditAuthPage>({ phase: 'empty' });
  const document = creditDocument(page);
  const loading = creditPageLoading(page);
  const setDocument = useCallback((next: CreditAuthDocument | null) => {
    setPage((current) => (creditDocument(current) === next ? current : creditPage(next, creditPageLoading(current))));
  }, []);
  const setLoading = useCallback((action: SetStateAction<boolean>) => {
    setPage((current) => {
      const loading = creditPageLoading(current);
      const next = typeof action === 'function' ? action(loading) : action;
      return Object.is(loading, next) ? current : creditPage(creditDocument(current), next);
    });
  }, []);
  const [error, setError] = useState('');
  const [connectionFeedback, setConnectionFeedback] = useState<'idle' | 'connecting'>('idle');
  const busy = connectionFeedback === 'connecting';
  const close = useCallback(
    (reason: AuthSurfaceCloseReason = 'close-button'): Promise<void> => {
      ++authRef.current.manualIntent;
      const opening = creditOpening(authRef.current.opening);
      if (!opening) return creditClosing(authRef.current.closing)?.promise || Promise.resolve();
      authRef.current.opening = { phase: 'idle' };
      opening.controller.abort();
      clearTimeout(opening.timeout);
      const revision = ++authRef.current.revision;
      try {
        webViewRef.current?.stopLoading();
      } finally {
        setDocument(null);
        setLoading(false);
        const reconciliation = finishSurface(reason);
        const closing = Promise.resolve(reconciliation)
          .then((result) => {
            if (
              authRef.current.revision !== revision ||
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
            if (creditClosing(authRef.current.closing)?.promise === closing) {
              authRef.current.closing = { phase: 'idle' };
            }
            if (authRef.current.revision === revision) setConnectionFeedback('idle');
          });
        authRef.current.closing = { phase: 'settling', promise: closing, mode: opening.mode };
      }
      return authRef.current.closing.promise;
    },
    [finishSurface, readRuntime, setDocument, setLoading]
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
          creditOpening(authRef.current.opening) !== opening ||
          opening.controller.signal.aborted ||
          runtime.identityKey !== opening.ticket.identityKey ||
          runtime.sessionEpoch !== opening.ticket.sessionEpoch ||
          runtime.sourceEnabled === false
        )
          return;
        if (opening.mode === 'silent') {
          if (!nonce || !/^[0-9a-f]{32}$/.test(nonce)) throw new Error('Invalid authorization nonce');
          opening.nonce = { phase: 'issued', value: nonce };
          setDocument({ generation: opening.ticket.generation, userAgent, mode: 'silent', nonce });
        } else setDocument({ generation: opening.ticket.generation, userAgent, mode: 'manual' });
      } catch {
        if (creditOpening(authRef.current.opening) !== opening || opening.controller.signal.aborted) return;
        if (opening.mode === 'silent') {
          void close('cancel');
          return;
        }
        setLoading(false);
        setError('LDC 页面准备失败，请刷新重试。');
      }
    },
    [close, getUserAgent, prepareCookieBarrier, readRuntime, setDocument, setLoading]
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
        nonce: { phase: 'unissued' },
        completion,
        resolve
      };
      authRef.current.opening = { phase: 'active', opening };
      setGeneration(opening.ticket.generation);
      ++authRef.current.revision;
      setConnectionFeedback(mode === 'silent' ? 'connecting' : 'idle');
      if (mode === 'silent')
        opening.timeout = setTimeout(() => {
          if (creditOpening(authRef.current.opening) === opening) void close('cancel');
        }, 30_000);
      return { opening, prepared: prepareDocument(opening) };
    },
    [beginSurface, close, prepareDocument]
  );
  const open = useCallback(async () => {
    if (creditOpening(authRef.current.opening)?.mode === 'manual') return;
    const expectedIdentity = readRuntime().identityKey;
    if (
      creditOpening(authRef.current.opening)?.mode === 'silent' ||
      creditClosing(authRef.current.closing)?.mode === 'silent'
    ) {
      const closing = close('switch-surface');
      const closeIntent = authRef.current.manualIntent;
      await closing;
      if (authRef.current.manualIntent !== closeIntent) return;
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
    authRef.current.attempt = { phase: 'attempted', owner: runtime.identityKey + ':' + runtime.sessionEpoch };
    await start('manual').prepared;
  }, [close, notify, prepareSurfaceOpen, readRuntime, screenActiveRef, start]);
  const connectSilently = useCallback((): Promise<void> => {
    const opening = creditOpening(authRef.current.opening);
    if (opening) return opening.mode === 'silent' ? opening.completion : Promise.resolve();
    const closing = creditClosing(authRef.current.closing);
    if (closing) return closing.promise;
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
      (authRef.current.attempt.phase === 'attempted' && authRef.current.attempt.owner === owner)
    )
      return Promise.resolve();
    authRef.current.attempt = { phase: 'attempted', owner };
    return start('silent').opening.completion;
  }, [appActiveRef, canStartSilent, readRuntime, screenActiveRef, start]);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const opening = creditOpening(authRef.current.opening);
      if (opening?.mode !== 'silent' || opening.nonce.phase !== 'issued') return;
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
      const outcome = isLinuxDoCreditAuthMessage(event.nativeEvent.data, event.nativeEvent.url, opening.nonce.value);
      if (outcome) void close(outcome === 'complete' ? 'success' : 'cancel');
    },
    [appActiveRef, close, readRuntime, screenActiveRef]
  );
  const failSilent = useCallback(
    (expectedGeneration: number) => {
      const opening = creditOpening(authRef.current.opening);
      if (opening?.mode === 'silent' && opening.ticket.generation === expectedGeneration) void close('cancel');
    },
    [close]
  );
  const retry = useCallback(() => {
    const previous = creditOpening(authRef.current.opening);
    if (!previous || document || loading || previous.mode !== 'manual') return;
    previous.controller.abort();
    const opening = { ...previous, controller: new AbortController() };
    authRef.current.opening = { phase: 'active', opening };
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
    const opening = creditOpening(authRef.current.opening);
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
      const opening = creditOpening(authRef.current.opening);
      opening?.controller.abort();
      clearTimeout(opening?.timeout);
      opening?.resolve();
      authRef.current.opening = { phase: 'idle' };
      ++authRef.current.revision;
      ++authRef.current.manualIntent;
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
