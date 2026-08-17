import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isCancelledError } from '@tanstack/react-query';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { errorMessage, isCanceledRequest } from '@/platform/network/errors';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { rejectUnauthorizedResponse, REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import type { ScopedSiteSessionEvent, SiteSessionEvent } from '@/domain/session/siteSessionState';
import type { XiaoyinsiAuthPhase, XiaoyinsiAuthorizationReadResult } from '@/domain/session/accountCenter';
import {
  beginXiaoyinsiDeviceAuth,
  cancelXiaoyinsiDeviceAuth,
  deviceAuthCountdown,
  hasXiaoyinsiRevocationCleanupPending,
  loadXiaoyinsiCredentials,
  loadXiaoyinsiPendingAuthorization,
  nextXiaoyinsiPollDelay,
  pollXiaoyinsiDeviceAuth,
  retryXiaoyinsiRevocationCleanup,
  revokeXiaoyinsiAuthorization,
  verifyXiaoyinsiCredentials,
  XiaoyinsiAuthError,
  type XiaoyinsiPendingAuthorization
} from '@/sources/xiaoyinsi/auth';

type XiaoyinsiAuthorizationCheckResult = XiaoyinsiAuthorizationReadResult & {
  reason?: string;
};

function linkAbortSignals(...signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const activeSignals = [...new Set(signals.filter((signal): signal is AbortSignal => Boolean(signal)))];
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return {
    dispose: () => activeSignals.forEach((signal) => signal.removeEventListener('abort', abort)),
    signal: controller.signal
  };
}

function isXiaoyinsiLoginExpiredError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { kind?: unknown; loginRequired?: unknown };
  return candidate.loginRequired === true || candidate.kind === 'login-expired';
}

function isRawUnauthorized(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { reason?: unknown }).reason === 'http-401');
}

async function checkXiaoyinsiAuthorization({
  fetcher,
  sessionEventType = 'cookie-loaded',
  signal,
  trace
}: {
  fetcher: Fetcher;
  sessionEventType?: 'cookie-loaded' | 'session-updated';
  signal?: AbortSignal;
  trace: DiagnosticTrace;
}): Promise<XiaoyinsiAuthorizationCheckResult> {
  try {
    if (signal?.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    const credentials = await loadXiaoyinsiCredentials();
    if (signal?.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    markDiagnosticStage(trace, 'credential', {
      source: 'xiaoyinsi',
      store: 'secure-store',
      hasCredential: Boolean(credentials)
    });
    if (!credentials) {
      return {
        authenticated: false,
        reason: 'missing_credential',
        sessionEvent: {
          type: sessionEventType,
          cookieSummary: [],
          loggedIn: false,
          currentUser: null,
          at: new Date().toISOString()
        }
      };
    }
    const currentUser = await verifyXiaoyinsiCredentials({
      fetcher: withDiagnosticFetcher(trace, rejectUnauthorizedResponse(fetcher)),
      signal
    });
    if (signal?.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    return {
      authenticated: true,
      sessionEvent: {
        type: sessionEventType,
        loggedIn: true,
        currentUser,
        at: new Date().toISOString()
      }
    };
  } catch (error) {
    if (signal?.aborted || isCancelledError(error) || isCanceledRequest(error)) {
      throw error;
    }
    if (isRawUnauthorized(error)) {
      return {
        authenticated: false,
        reason: 'login_required',
        sessionEvent: { type: 'login-expired', message: '小隐寺授权已失效' }
      };
    }
    return {
      authenticated: null,
      reason: normalizeDiagnosticReason(error),
      sessionEvent: { type: 'check-failed', message: errorMessage(error) }
    };
  }
}

export function useXiaoyinsiAuthController({
  dispatchSiteSessionEvent,
  enabled = true,
  fetcher,
  notify
}: {
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  enabled?: boolean;
  fetcher: Fetcher;
  notify: (message: string) => void;
}) {
  const [phase, setPhase] = useState<XiaoyinsiAuthPhase>('idle');
  const [pending, setPending] = useState<XiaoyinsiPendingAuthorization | null>(null);
  const [message, setMessage] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [pollRevision, setPollRevision] = useState(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const lastPollAtRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollGenerationRef = useRef(0);
  const refreshGenerationRef = useRef(0);
  const authorizationMutationRef = useRef(false);
  const enabledRef = useRef(enabled);
  const enabledAbortRef = useRef(new AbortController());
  useCommitRefValue(enabledRef, enabled);

  const invalidateAuthorizationRefresh = useCallback(() => {
    refreshGenerationRef.current += 1;
    return refreshGenerationRef.current;
  }, []);

  const dispatch = useCallback(
    (event: SiteSessionEvent) => {
      dispatchSiteSessionEvent({ ...event, site: 'xiaoyinsi' } as ScopedSiteSessionEvent);
    },
    [dispatchSiteSessionEvent]
  );

  const runAuthorizationRefresh = useCallback(
    async (
      parentTrace?: DiagnosticTrace,
      options: {
        allowDuringMutation?: boolean;
        sessionEventType?: 'cookie-loaded' | 'session-updated';
        signal?: AbortSignal;
      } = {},
      publishSessionEvent: (event: SiteSessionEvent) => void = () => undefined
    ) => {
      const { allowDuringMutation = false, sessionEventType = 'cookie-loaded', signal } = options;
      const ownsTrace = !parentTrace;
      const trace = parentTrace || beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
      const finish = (
        outcome: Parameters<typeof finishDiagnosticTrace>[1],
        fields: Parameters<typeof finishDiagnosticTrace>[2] = {}
      ) => {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, outcome, { source: 'xiaoyinsi', ...fields });
        }
      };
      if (!enabledRef.current) {
        markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'disabled' });
        finish('blocked', { reason: 'source_disabled' });
        return false;
      }
      if (!allowDuringMutation && (authorizationMutationRef.current || busyRef.current)) {
        markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
        finish('blocked', { reason: 'busy' });
        return false;
      }
      const operation = linkAbortSignals(signal, enabledAbortRef.current.signal);
      const refreshGeneration = invalidateAuthorizationRefresh();
      const isCurrent = () =>
        mountedRef.current &&
        enabledRef.current &&
        !operation.signal.aborted &&
        refreshGeneration === refreshGenerationRef.current;
      const stopIfStale = () => {
        if (isCurrent()) {
          return false;
        }
        const canceled = operation.signal.aborted;
        finish(canceled ? 'canceled' : 'stale', { reason: canceled ? 'canceled' : 'stale' });
        return true;
      };
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
      try {
        if (stopIfStale()) {
          return false;
        }
        const cleanupPending = await hasXiaoyinsiRevocationCleanupPending();
        if (stopIfStale()) {
          return false;
        }
        if (cleanupPending) {
          const cleanup = await retryXiaoyinsiRevocationCleanup();
          if (stopIfStale()) {
            return false;
          }
          setPending(null);
          publishSessionEvent({ type: 'cleared' });
          setPhase(cleanup.complete ? 'idle' : 'cleanup');
          setMessage(
            cleanup.complete
              ? '撤销后的本机授权材料已清理。'
              : '服务端授权已撤销，但本机安全材料清理未完成，请重试本机清理。'
          );
          markDiagnosticStage(trace, 'persist', {
            source: 'xiaoyinsi',
            store: 'multi-store',
            state: cleanup.complete ? 'cleared' : 'partial'
          });
          markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: cleanup.complete ? 'cleared' : 'cleanup' });
          finish(cleanup.complete ? 'success' : 'partial', {
            state: cleanup.complete ? 'cleared' : 'cleanup',
            ...(cleanup.complete ? {} : { reason: 'storage_error' })
          });
          return cleanup.complete ? false : null;
        }
        const savedPending = await loadXiaoyinsiPendingAuthorization();
        if (stopIfStale()) {
          return false;
        }
        if (savedPending && savedPending.expiresAt > Date.now()) {
          setPending(savedPending);
          setPhase('waiting');
          publishSessionEvent({ type: 'authorization-started' });
          markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'pending' });
          finish('noop', { state: 'pending' });
          return false;
        }
        if (savedPending) {
          await cancelXiaoyinsiDeviceAuth().catch(() => undefined);
          if (stopIfStale()) {
            return false;
          }
        }
        setPending(null);
        const result = await checkXiaoyinsiAuthorization({
          fetcher,
          sessionEventType,
          signal: operation.signal,
          trace
        });
        if (stopIfStale()) {
          return false;
        }
        if (result.sessionEvent) {
          publishSessionEvent(result.sessionEvent);
        }
        if (result.authenticated) {
          setPhase('authorized');
          setMessage('');
          markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'logged-in' });
          finish('success', { state: 'logged-in' });
          return true;
        }
        if (result.authenticated === null) {
          setPhase('error');
          setMessage(
            `无法检测小隐寺授权：${result.sessionEvent?.type === 'check-failed' ? result.sessionEvent.message : '未知错误'}`
          );
          markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'error' });
          finish('failure', { reason: result.reason || 'unknown', state: 'error' });
          return null;
        }
        if (result.sessionEvent?.type === 'login-expired') {
          setPhase('expired');
          setMessage('授权已失效，请重新授权。');
          markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'expired' });
          finish('blocked', { reason: 'login_required', state: 'expired' });
          return false;
        }
        setPhase('idle');
        setMessage('');
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'cleared' });
        finish('noop', { reason: 'missing_credential' });
        return false;
      } catch (error) {
        if (stopIfStale() || isCancelledError(error) || isCanceledRequest(error)) {
          return false;
        }
        if (isXiaoyinsiLoginExpiredError(error)) {
          publishSessionEvent({ type: 'login-expired', message: '小隐寺授权已失效' });
          setPhase('expired');
          setMessage('授权已失效，请重新授权。');
          markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'expired' });
          finish('blocked', { reason: 'login_required', state: 'expired' });
        } else {
          publishSessionEvent({ type: 'check-failed', message: errorMessage(error) });
          setPhase('error');
          setMessage(`无法检测小隐寺授权：${errorMessage(error)}`);
          markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'error' });
          finish('failure', { reason: normalizeDiagnosticReason(error), state: 'error' });
          return null;
        }
        return false;
      } finally {
        operation.dispose();
      }
    },
    [fetcher, invalidateAuthorizationRefresh]
  );

  const refreshAuthorization = useCallback(
    (
      parentTrace?: DiagnosticTrace,
      options: {
        allowDuringMutation?: boolean;
        sessionEventType?: 'cookie-loaded' | 'session-updated';
        signal?: AbortSignal;
      } = {}
    ) => {
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Imperative authorization event callback, never passed to a React state setter.
      return runAuthorizationRefresh(parentTrace, options, dispatch);
    },
    [dispatch, runAuthorizationRefresh]
  );

  const readAuthorization = useCallback(
    async (
      parentTrace?: DiagnosticTrace,
      options: { signal?: AbortSignal } = {}
    ): Promise<XiaoyinsiAuthorizationReadResult> => {
      const ownsTrace = !parentTrace;
      const trace = parentTrace || beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
      if (!enabledRef.current) {
        markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'disabled' });
        if (ownsTrace) finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'source_disabled' });
        return { authenticated: null };
      }
      const operation = linkAbortSignals(options.signal, enabledAbortRef.current.signal);
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
      try {
        if (operation.signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
        const result = await checkXiaoyinsiAuthorization({ fetcher, signal: operation.signal, trace });
        if (operation.signal.aborted || !enabledRef.current) throw new Error(REQUEST_CANCELED_MESSAGE);
        const state = result.authenticated
          ? 'logged-in'
          : result.authenticated === null
            ? 'error'
            : result.sessionEvent?.type === 'login-expired'
              ? 'expired'
              : 'cleared';
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state });
        if (ownsTrace) {
          finishDiagnosticTrace(
            trace,
            result.authenticated
              ? 'success'
              : result.authenticated === null
                ? 'failure'
                : state === 'expired'
                  ? 'blocked'
                  : 'noop',
            { source: 'xiaoyinsi', ...(result.reason ? { reason: result.reason } : {}), state }
          );
        }
        return result;
      } catch (error) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'canceled', { source: 'xiaoyinsi', reason: 'canceled' });
        }
        throw error;
      } finally {
        operation.dispose();
      }
    },
    [fetcher]
  );

  const restoreExistingAuthorization = useCallback(
    async (restoredMessage: string, trace?: DiagnosticTrace) => {
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This is an event callback, not a React state updater.
      const restored = await refreshAuthorization(trace, { allowDuringMutation: true });
      if (restored && mountedRef.current && enabledRef.current) {
        // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This callback runs from authorization events, not inside a React updater.
        setMessage(restoredMessage);
      }
      return restored;
    },
    [refreshAuthorization]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      enabledAbortRef.current.abort();
      pollGenerationRef.current += 1;
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
      invalidateAuthorizationRefresh();
    };
  }, [invalidateAuthorizationRefresh]);

  useLayoutEffect(() => {
    if (enabled) {
      if (enabledAbortRef.current.signal.aborted) {
        enabledAbortRef.current = new AbortController();
      }
      return;
    }
    enabledAbortRef.current.abort();
    pollGenerationRef.current += 1;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    invalidateAuthorizationRefresh();
  }, [enabled, invalidateAuthorizationRefresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- AppState invokes this event listener; React does not replay it as an updater.
      setAppState(nextState);
      if (nextState === 'active') {
        lastPollAtRef.current = null;
        setPollRevision((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!pending) {
      setSecondsRemaining(0);
      return;
    }
    const update = () => setSecondsRemaining(deviceAuthCountdown(pending.expiresAt));
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [pending]);

  const beginAuthorization = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'request', { source: 'xiaoyinsi', mode: 'manual' });
    if (!enabledRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'disabled' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'source_disabled' });
      return null;
    }
    if (authorizationMutationRef.current || busyRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'busy' });
      return null;
    }
    authorizationMutationRef.current = true;
    invalidateAuthorizationRefresh();
    busyRef.current = true;
    const operationSignal = enabledAbortRef.current.signal;
    const isCurrent = () => mountedRef.current && enabledRef.current && !operationSignal.aborted;
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    try {
      const cleanupPending = await hasXiaoyinsiRevocationCleanupPending();
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return null;
      }
      if (phase === 'cleanup' || cleanupPending) {
        let cleanup;
        try {
          cleanup = await retryXiaoyinsiRevocationCleanup();
        } catch (error) {
          if (isCurrent()) {
            setPending(null);
            setPhase('cleanup');
            setMessage(`本机安全材料清理失败，请重试：${errorMessage(error)}`);
            dispatch({ type: 'cleared' });
          }
          finishDiagnosticTrace(trace, 'failure', {
            source: 'xiaoyinsi',
            reason: normalizeDiagnosticReason(error),
            state: 'cleanup'
          });
          return null;
        }
        if (!isCurrent()) {
          finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
          return null;
        }
        setPending(null);
        dispatch({ type: 'cleared' });
        setPhase(cleanup.complete ? 'idle' : 'cleanup');
        setMessage(
          cleanup.complete
            ? '本机授权材料已清理，请再次点击授权登录。'
            : '服务端授权已撤销，但本机安全材料清理未完成，请重试本机清理。'
        );
        markDiagnosticStage(trace, 'persist', {
          source: 'xiaoyinsi',
          store: 'multi-store',
          state: cleanup.complete ? 'cleared' : 'partial'
        });
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: cleanup.complete ? 'cleared' : 'cleanup' });
        finishDiagnosticTrace(trace, cleanup.complete ? 'success' : 'partial', {
          source: 'xiaoyinsi',
          state: cleanup.complete ? 'cleared' : 'cleanup',
          ...(cleanup.complete ? {} : { reason: 'storage_error' })
        });
        return null;
      }
      const saved = await loadXiaoyinsiPendingAuthorization();
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return null;
      }
      if (saved && saved.expiresAt > Date.now()) {
        setPending(saved);
        setPhase('waiting');
        setMessage('');
        dispatch({ type: 'authorization-started' });
        lastPollAtRef.current = null;
        setPollRevision((current) => current + 1);
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'pending' });
        finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi', state: 'pending' });
        return saved;
      }
      if (phase === 'error') {
        const restored = await restoreExistingAuthorization('现有授权已恢复。', trace);
        if (!isCurrent()) {
          finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
          return null;
        }
        if (restored) {
          finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi', state: 'restored' });
          return null;
        }
        if (restored === null) {
          finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: 'refresh_failed' });
          return null;
        }
      }
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return null;
      }
      setPhase('requesting');
      setMessage('');
      dispatch({ type: 'authorization-started' });
      const created = await beginXiaoyinsiDeviceAuth({
        fetcher: withDiagnosticFetcher(trace, fetcher),
        signal: operationSignal
      });
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return created;
      }
      setPending(created);
      setPhase('waiting');
      lastPollAtRef.current = null;
      setPollRevision((current) => current + 1);
      markDiagnosticStage(trace, 'persist', { source: 'xiaoyinsi', store: 'secure-store', state: 'persisted' });
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'pending' });
      finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi', state: 'pending' });
      return created;
    } catch (error) {
      if (isCurrent()) {
        const unsupported = error instanceof XiaoyinsiAuthError && error.code === 'unsupported';
        const restored = await restoreExistingAuthorization('重新授权未开始，原授权仍然有效。', trace);
        if (!isCurrent()) {
          finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
          return null;
        }
        if (restored) {
          finishDiagnosticTrace(trace, 'partial', {
            source: 'xiaoyinsi',
            reason: unsupported ? 'unsupported' : normalizeDiagnosticReason(error),
            state: 'restored'
          });
          return null;
        }
        if (restored === null) {
          finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: 'refresh_failed' });
          return null;
        }
        setPhase(unsupported ? 'unsupported' : 'error');
        setMessage(unsupported ? error.message : `无法开始小隐寺授权：${errorMessage(error)}`);
        dispatch({ type: 'cleared' });
        markDiagnosticStage(trace, 'apply', {
          source: 'xiaoyinsi',
          state: unsupported ? 'unsupported-source' : 'error'
        });
        finishDiagnosticTrace(trace, unsupported ? 'blocked' : 'failure', {
          source: 'xiaoyinsi',
          reason: unsupported ? 'unsupported' : normalizeDiagnosticReason(error)
        });
      } else {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
      }
      return null;
    } finally {
      busyRef.current = false;
      authorizationMutationRef.current = false;
    }
  }, [dispatch, fetcher, invalidateAuthorizationRefresh, phase, restoreExistingAuthorization]);

  const runPoll = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'check', {
      source: 'xiaoyinsi',
      flow: appState === 'active' ? 'foreground' : 'background'
    });
    if (!pending) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'not-loaded' });
      finishDiagnosticTrace(trace, 'noop', { source: 'xiaoyinsi', reason: 'not_ready' });
      return;
    }
    if (!enabledRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'disabled' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'source_disabled' });
      return;
    }
    if (authorizationMutationRef.current || busyRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'busy' });
      return;
    }
    if (appState !== 'active') {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'pending' });
      finishDiagnosticTrace(trace, 'noop', { source: 'xiaoyinsi', reason: 'not_ready' });
      return;
    }
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    const pollGeneration = pollGenerationRef.current;
    const pollController = new AbortController();
    const isCurrent = () =>
      mountedRef.current &&
      enabledRef.current &&
      !pollController.signal.aborted &&
      pollGeneration === pollGenerationRef.current;
    const stopIfStale = () => {
      if (isCurrent()) return false;
      finishDiagnosticTrace(trace, pollController.signal.aborted ? 'canceled' : 'stale', {
        source: 'xiaoyinsi',
        reason: pollController.signal.aborted ? 'canceled' : 'stale'
      });
      return true;
    };
    pollAbortRef.current = pollController;
    busyRef.current = true;
    lastPollAtRef.current = Date.now();
    try {
      const result = await pollXiaoyinsiDeviceAuth({
        fetcher: withDiagnosticFetcher(trace, fetcher),
        signal: pollController.signal
      });
      if (stopIfStale()) return;
      if (result.status === 'authorization_pending') {
        setMessage('等待你在小隐寺授权页确认…');
        setPollRevision((current) => current + 1);
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'pending' });
        finishDiagnosticTrace(trace, 'noop', { source: 'xiaoyinsi', state: 'pending' });
        return;
      }
      setPending(null);
      if (result.status === 'authorized') {
        const verified = await refreshAuthorization(trace, {
          allowDuringMutation: true,
          sessionEventType: 'session-updated'
        });
        if (stopIfStale()) return;
        if (verified) {
          notify('小隐寺授权成功。');
          finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi', state: 'logged-in' });
        } else {
          finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: 'refresh_failed' });
        }
        return;
      }
      if (result.status === 'access_denied') {
        const restored = await restoreExistingAuthorization('已拒绝重新授权，原授权仍然有效。', trace);
        if (stopIfStale()) return;
        if (restored) {
          finishDiagnosticTrace(trace, 'blocked', {
            source: 'xiaoyinsi',
            reason: 'permission_denied',
            state: 'restored'
          });
          return;
        }
        if (restored === null) {
          finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: 'refresh_failed' });
          return;
        }
        setPhase('denied');
        setMessage('你已拒绝小隐寺授权。');
        dispatch({ type: 'cleared' });
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'cleared' });
        finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'permission_denied' });
        return;
      }
      if (result.status === 'expired_token' || result.status === 'idle') {
        const restored = await restoreExistingAuthorization('重新授权已过期，原授权仍然有效。', trace);
        if (stopIfStale()) return;
        if (restored) {
          finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'timeout', state: 'restored' });
          return;
        }
        if (restored === null) {
          finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: 'refresh_failed' });
          return;
        }
        setPhase('expired');
        setMessage('验证码已过期，请重新授权。');
        dispatch({ type: 'cleared' });
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'expired' });
        finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'timeout', state: 'expired' });
      }
    } catch (error) {
      if (
        !enabledRef.current ||
        pollController.signal.aborted ||
        pollGeneration !== pollGenerationRef.current ||
        isCanceledRequest(error)
      ) {
        finishDiagnosticTrace(trace, 'canceled', { source: 'xiaoyinsi', reason: 'canceled' });
      } else if (mountedRef.current) {
        setMessage(`授权检测失败，将继续重试：${errorMessage(error)}`);
        setPollRevision((current) => current + 1);
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'retry' });
        finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: normalizeDiagnosticReason(error) });
      } else {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
      }
    } finally {
      if (pollAbortRef.current === pollController) {
        pollAbortRef.current = null;
      }
      busyRef.current = false;
    }
  }, [appState, dispatch, fetcher, notify, pending, refreshAuthorization, restoreExistingAuthorization]);

  useEffect(() => {
    if (!pending) {
      return;
    }
    const delay = nextXiaoyinsiPollDelay(appState, Date.now(), lastPollAtRef.current, pending.intervalMs);
    if (delay === null) {
      return;
    }
    const timer = setTimeout(() => {
      void runPoll();
    }, delay);
    return () => clearTimeout(timer);
  }, [appState, pending, pollRevision, runPoll]);

  const openAuthorizationBrowser = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'open', { source: 'xiaoyinsi', channel: 'native' });
    if (!enabledRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'disabled' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'source_disabled' });
      return false;
    }
    if (authorizationMutationRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'busy' });
      return false;
    }
    if (!pending) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'not-loaded' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'not_ready' });
      return false;
    }
    const operationSignal = enabledAbortRef.current.signal;
    const isCurrent = () => mountedRef.current && enabledRef.current && !operationSignal.aborted;
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    try {
      await Clipboard.setStringAsync(pending.userCode);
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return false;
      }
      markDiagnosticStage(trace, 'transport', {
        source: 'xiaoyinsi',
        endpoint: 'external',
        channel: 'native',
        state: 'start'
      });
      await Linking.openURL(pending.verificationUriWithRequest);
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return false;
      }
      setMessage('验证码已复制，请在小隐寺授权页粘贴并确认。');
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'open' });
      finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi', channel: 'native' });
      return true;
    } catch (error) {
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return false;
      }
      setMessage(`无法打开小隐寺授权页：${errorMessage(error)}`);
      finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: normalizeDiagnosticReason(error) });
      return false;
    }
  }, [pending]);

  const cancelAuthorization = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'clear', { source: 'xiaoyinsi', mode: 'manual' });
    if (!enabledRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'disabled' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'source_disabled' });
      return;
    }
    if (authorizationMutationRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'busy' });
      return;
    }
    authorizationMutationRef.current = true;
    invalidateAuthorizationRefresh();
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    pollGenerationRef.current += 1;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    const operationSignal = enabledAbortRef.current.signal;
    const isCurrent = () => mountedRef.current && enabledRef.current && !operationSignal.aborted;
    try {
      await cancelXiaoyinsiDeviceAuth();
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return;
      }
      setPending(null);
      markDiagnosticStage(trace, 'persist', { source: 'xiaoyinsi', store: 'secure-store', state: 'cleared' });
      const restored = await restoreExistingAuthorization('已取消重新授权，原授权仍然有效。', trace);
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return;
      }
      if (restored) {
        finishDiagnosticTrace(trace, 'canceled', { source: 'xiaoyinsi', reason: 'canceled', state: 'restored' });
        return;
      }
      if (restored === null) {
        finishDiagnosticTrace(trace, 'partial', { source: 'xiaoyinsi', reason: 'refresh_failed' });
        return;
      }
      setPhase('idle');
      setMessage('已取消授权。');
      dispatch({ type: 'cleared' });
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'cleared' });
      finishDiagnosticTrace(trace, 'canceled', { source: 'xiaoyinsi', reason: 'canceled' });
    } catch (error) {
      if (isCurrent()) {
        setMessage(`无法取消小隐寺授权：${errorMessage(error)}`);
        lastPollAtRef.current = null;
        setPollRevision((current) => current + 1);
      }
      finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: normalizeDiagnosticReason(error) });
    } finally {
      authorizationMutationRef.current = false;
    }
  }, [dispatch, invalidateAuthorizationRefresh, restoreExistingAuthorization]);

  const revokeAuthorization = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'delete', { source: 'xiaoyinsi', mode: 'manual' });
    if (!enabledRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'disabled' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'source_disabled' });
      return false;
    }
    if (authorizationMutationRef.current || busyRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'busy' });
      return false;
    }
    authorizationMutationRef.current = true;
    invalidateAuthorizationRefresh();
    pollGenerationRef.current += 1;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    busyRef.current = true;
    const operationSignal = enabledAbortRef.current.signal;
    const isCurrent = () => mountedRef.current && enabledRef.current && !operationSignal.aborted;
    try {
      const credentials = await loadXiaoyinsiCredentials();
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return false;
      }
      markDiagnosticStage(trace, 'credential', {
        source: 'xiaoyinsi',
        store: 'secure-store',
        hasCredential: Boolean(credentials)
      });
      const cleanup = await revokeXiaoyinsiAuthorization({
        fetcher: withDiagnosticFetcher(trace, fetcher),
        signal: operationSignal
      });
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return true;
      }
      const revokedMessage = cleanup.complete
        ? '已撤销小隐寺授权。'
        : '服务端授权已撤销，但本机安全材料清理未完成，请重试本机清理。';
      setPending(null);
      setPhase(cleanup.complete ? 'idle' : 'cleanup');
      setMessage(revokedMessage);
      dispatch({ type: 'cleared' });
      markDiagnosticStage(trace, 'persist', {
        source: 'xiaoyinsi',
        store: 'multi-store',
        state: cleanup.complete ? 'cleared' : 'partial'
      });
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: cleanup.complete ? 'cleared' : 'cleanup' });
      finishDiagnosticTrace(trace, cleanup.complete ? 'success' : 'partial', {
        source: 'xiaoyinsi',
        state: cleanup.complete ? 'cleared' : 'cleanup',
        ...(cleanup.complete ? {} : { reason: 'storage_error' })
      });
      notify(revokedMessage);
      return true;
    } catch (error) {
      if (!isCurrent()) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return false;
      }
      setMessage(`撤销失败：${errorMessage(error)}`);
      notify(`小隐寺撤销失败：${errorMessage(error)}`);
      finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: normalizeDiagnosticReason(error) });
      return false;
    } finally {
      busyRef.current = false;
      authorizationMutationRef.current = false;
    }
  }, [dispatch, fetcher, invalidateAuthorizationRefresh, notify]);

  return useMemo(
    () => ({
      beginAuthorization,
      cancelAuthorization,
      message,
      openAuthorizationBrowser,
      pending,
      phase,
      readAuthorization,
      refreshAuthorization,
      revokeAuthorization,
      secondsRemaining
    }),
    [
      beginAuthorization,
      cancelAuthorization,
      message,
      openAuthorizationBrowser,
      pending,
      phase,
      readAuthorization,
      refreshAuthorization,
      revokeAuthorization,
      secondsRemaining
    ]
  );
}
