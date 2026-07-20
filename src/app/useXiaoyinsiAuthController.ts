import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { errorMessage, isCanceledRequest } from '../appUtils';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticTrace
} from '../diagnostics';
import type { Fetcher } from '../request';
import type { ScopedSiteSessionEvent, SiteSessionEvent } from '../siteSessionState';
import type { SourceGateway, XiaoyinsiLevelProfile } from '../sources/sourceGateway';
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
} from '../xiaoyinsiAuth';

export type XiaoyinsiAuthPhase =
  | 'idle'
  | 'requesting'
  | 'waiting'
  | 'authorized'
  | 'denied'
  | 'expired'
  | 'cleanup'
  | 'unsupported'
  | 'error';

function statusFromError(error: unknown) {
  return Number(error && typeof error === 'object' ? (error as { status?: unknown }).status : 0) || 0;
}

export function useXiaoyinsiAuthController({
  dispatchSiteSessionEvent,
  fetcher,
  notify,
  sourceGateway
}: {
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  fetcher: Fetcher;
  notify: (message: string) => void;
  sourceGateway: Pick<SourceGateway, 'getLevelProfile'>;
}) {
  const [phase, setPhase] = useState<XiaoyinsiAuthPhase>('idle');
  const [pending, setPending] = useState<XiaoyinsiPendingAuthorization | null>(null);
  const [message, setMessage] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [pollRevision, setPollRevision] = useState(0);
  const [levelBusy, setLevelBusy] = useState(false);
  const [levelError, setLevelError] = useState('');
  const [levelProfile, setLevelProfile] = useState<XiaoyinsiLevelProfile | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const lastPollAtRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollGenerationRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshGenerationRef = useRef(0);
  const levelAbortRef = useRef<AbortController | null>(null);
  const levelGenerationRef = useRef(0);
  const authorizationMutationRef = useRef(false);

  const invalidateAuthorizationRefresh = useCallback(() => {
    refreshGenerationRef.current += 1;
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = null;
    return refreshGenerationRef.current;
  }, []);

  const invalidateLevelRefresh = useCallback(() => {
    levelGenerationRef.current += 1;
    levelAbortRef.current?.abort();
    levelAbortRef.current = null;
    return levelGenerationRef.current;
  }, []);

  const dispatch = useCallback((event: SiteSessionEvent) => {
    dispatchSiteSessionEvent({ ...event, site: 'xiaoyinsi' } as ScopedSiteSessionEvent);
  }, [dispatchSiteSessionEvent]);

  const refreshAuthorization = useCallback(async (parentTrace?: DiagnosticTrace, allowDuringMutation = false) => {
    const ownsTrace = !parentTrace;
    const trace = parentTrace || beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
    const finish = (outcome: Parameters<typeof finishDiagnosticTrace>[1], fields: Parameters<typeof finishDiagnosticTrace>[2] = {}) => {
      if (ownsTrace) {
        finishDiagnosticTrace(trace, outcome, { source: 'xiaoyinsi', ...fields });
      }
    };
    if (!allowDuringMutation && (authorizationMutationRef.current || busyRef.current)) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
      finish('blocked', { reason: 'busy' });
      return false;
    }
    const refreshGeneration = invalidateAuthorizationRefresh();
    const refreshController = new AbortController();
    refreshAbortRef.current = refreshController;
    const isCurrent = () => (
      mountedRef.current
      && !refreshController.signal.aborted
      && refreshGeneration === refreshGenerationRef.current
    );
    const stopIfStale = () => {
      if (isCurrent()) {
        return false;
      }
      const canceled = refreshController.signal.aborted;
      finish(canceled ? 'canceled' : 'stale', { reason: canceled ? 'canceled' : 'stale' });
      return true;
    };
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    try {
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
        dispatch({ type: 'cleared' });
        setPhase(cleanup.complete ? 'idle' : 'cleanup');
        setMessage(cleanup.complete
          ? '撤销后的本机授权材料已清理。'
          : '服务端授权已撤销，但本机安全材料清理未完成，请重试本机清理。');
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
        dispatch({ type: 'authorization-started' });
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
      const credentials = await loadXiaoyinsiCredentials();
      if (stopIfStale()) {
        return false;
      }
      markDiagnosticStage(trace, 'credential', { source: 'xiaoyinsi', store: 'secure-store', hasCredential: Boolean(credentials) });
      if (!credentials) {
        dispatch({ type: 'cleared' });
        setPhase('idle');
        setMessage('');
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'cleared' });
        finish('noop', { reason: 'missing_credential' });
        return false;
      }
      const currentUser = await verifyXiaoyinsiCredentials({
        fetcher: withDiagnosticFetcher(trace, fetcher),
        signal: refreshController.signal
      });
      if (stopIfStale()) {
        return false;
      }
      dispatch({ type: 'login-detected', currentUser, at: new Date().toISOString() });
      setPhase('authorized');
      setMessage('');
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'logged-in' });
      finish('success', { state: 'logged-in' });
      return true;
    } catch (error) {
      if (stopIfStale() || isCanceledRequest(error)) {
        return false;
      }
      if (statusFromError(error) === 401 || statusFromError(error) === 403) {
        dispatch({ type: 'login-expired', message: '小隐寺授权已失效' });
        setPhase('expired');
        setMessage('授权已失效，请重新授权。');
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'expired' });
        finish('blocked', { reason: 'login_required', state: 'expired' });
      } else {
        dispatch({ type: 'check-failed', message: errorMessage(error) });
        setPhase('error');
        setMessage(`无法检测小隐寺授权：${errorMessage(error)}`);
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'error' });
        finish('failure', { reason: normalizeDiagnosticReason(error), state: 'error' });
        return null;
      }
      return false;
    } finally {
      if (refreshAbortRef.current === refreshController) {
        refreshAbortRef.current = null;
      }
    }
  }, [dispatch, fetcher, invalidateAuthorizationRefresh]);

  const restoreExistingAuthorization = useCallback(async (restoredMessage: string, trace?: DiagnosticTrace) => {
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This is an event callback, not a React state updater.
    const restored = await refreshAuthorization(trace, true);
    if (restored && mountedRef.current) {
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This callback runs from authorization events, not inside a React updater.
      setMessage(restoredMessage);
    }
    return restored;
  }, [refreshAuthorization]);

  const refreshLevel = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
    const generation = invalidateLevelRefresh();
    const controller = new AbortController();
    levelAbortRef.current = controller;
    const isCurrent = () => mountedRef.current && !controller.signal.aborted && generation === levelGenerationRef.current;
    setLevelBusy(true);
    setLevelError('');
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    try {
      const profile = await sourceGateway.getLevelProfile({ source: 'xiaoyinsi', signal: controller.signal }, {
        isCurrent,
        trace
      });
      if (!isCurrent()) {
        const canceled = controller.signal.aborted;
        finishDiagnosticTrace(trace, canceled ? 'canceled' : 'stale', {
          source: 'xiaoyinsi',
          reason: canceled ? 'canceled' : 'stale'
        });
        return false;
      }
      setLevelProfile(profile);
      notify('小隐寺等级已更新。');
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'loaded' });
      finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi' });
      return true;
    } catch (error) {
      const canceled = controller.signal.aborted || isCanceledRequest(error);
      if (!mountedRef.current || generation !== levelGenerationRef.current || canceled) {
        finishDiagnosticTrace(trace, canceled ? 'canceled' : 'stale', {
          source: 'xiaoyinsi',
          reason: canceled ? 'canceled' : 'stale'
        });
        return false;
      }
      const reason = normalizeDiagnosticReason(error);
      setLevelError(errorMessage(error));
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'error' });
      finishDiagnosticTrace(
        trace,
        reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked' : 'failure',
        { source: 'xiaoyinsi', reason }
      );
      return false;
    } finally {
      if (generation === levelGenerationRef.current) {
        setLevelBusy(false);
        if (levelAbortRef.current === controller) {
          levelAbortRef.current = null;
        }
      }
    }
  }, [invalidateLevelRefresh, notify, sourceGateway]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshAuthorization();
    return () => {
      mountedRef.current = false;
      pollGenerationRef.current += 1;
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
      invalidateAuthorizationRefresh();
      invalidateLevelRefresh();
    };
  }, [invalidateAuthorizationRefresh, invalidateLevelRefresh, refreshAuthorization]);

  useEffect(() => {
    if (phase === 'authorized') {
      return;
    }
    invalidateLevelRefresh();
    setLevelBusy(false);
    setLevelError('');
    setLevelProfile(null);
  }, [invalidateLevelRefresh, phase]);

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
    if (authorizationMutationRef.current || busyRef.current) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'busy' });
      return null;
    }
    authorizationMutationRef.current = true;
    invalidateAuthorizationRefresh();
    busyRef.current = true;
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    try {
      const cleanupPending = await hasXiaoyinsiRevocationCleanupPending();
      if (!mountedRef.current) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return null;
      }
      if (phase === 'cleanup' || cleanupPending) {
        let cleanup;
        try {
          cleanup = await retryXiaoyinsiRevocationCleanup();
        } catch (error) {
          if (mountedRef.current) {
            setPending(null);
            setPhase('cleanup');
            setMessage(`本机安全材料清理失败，请重试：${errorMessage(error)}`);
            dispatch({ type: 'cleared' });
          }
          finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: normalizeDiagnosticReason(error), state: 'cleanup' });
          return null;
        }
        if (!mountedRef.current) {
          finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
          return null;
        }
        setPending(null);
        dispatch({ type: 'cleared' });
        setPhase(cleanup.complete ? 'idle' : 'cleanup');
        setMessage(cleanup.complete
          ? '本机授权材料已清理，请再次点击授权登录。'
          : '服务端授权已撤销，但本机安全材料清理未完成，请重试本机清理。');
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
      if (!mountedRef.current) {
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
        if (!mountedRef.current) {
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
      setPhase('requesting');
      setMessage('');
      dispatch({ type: 'authorization-started' });
      const created = await beginXiaoyinsiDeviceAuth({ fetcher: withDiagnosticFetcher(trace, fetcher) });
      if (!mountedRef.current) {
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
      if (mountedRef.current) {
        const unsupported = error instanceof XiaoyinsiAuthError && error.code === 'unsupported';
        const restored = await restoreExistingAuthorization('重新授权未开始，原授权仍然有效。', trace);
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
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: unsupported ? 'unsupported-source' : 'error' });
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
    const trace = beginDiagnosticTrace('session', 'check', { source: 'xiaoyinsi', flow: appState === 'active' ? 'foreground' : 'background' });
    if (!pending) {
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'not-loaded' });
      finishDiagnosticTrace(trace, 'noop', { source: 'xiaoyinsi', reason: 'not_ready' });
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
    pollAbortRef.current = pollController;
    busyRef.current = true;
    lastPollAtRef.current = Date.now();
    try {
      const result = await pollXiaoyinsiDeviceAuth({
        fetcher: withDiagnosticFetcher(trace, fetcher),
        signal: pollController.signal
      });
      if (!mountedRef.current || pollController.signal.aborted || pollGeneration !== pollGenerationRef.current) {
        finishDiagnosticTrace(trace, pollController.signal.aborted ? 'canceled' : 'stale', {
          source: 'xiaoyinsi',
          reason: pollController.signal.aborted ? 'canceled' : 'stale'
        });
        return;
      }
      if (result.status === 'authorization_pending') {
        setMessage('等待你在小隐寺授权页确认…');
        setPollRevision((current) => current + 1);
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'pending' });
        finishDiagnosticTrace(trace, 'noop', { source: 'xiaoyinsi', state: 'pending' });
        return;
      }
      setPending(null);
      if (result.status === 'authorized') {
        const verified = await refreshAuthorization(trace, true);
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
        if (restored) {
          finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'permission_denied', state: 'restored' });
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
      if (pollController.signal.aborted || pollGeneration !== pollGenerationRef.current || isCanceledRequest(error)) {
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
    const timer = setTimeout(() => { void runPoll(); }, delay);
    return () => clearTimeout(timer);
  }, [appState, pending, pollRevision, runPoll]);

  const openAuthorizationBrowser = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'open', { source: 'xiaoyinsi', channel: 'native' });
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
    markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
    try {
      await Clipboard.setStringAsync(pending.userCode);
      markDiagnosticStage(trace, 'transport', { source: 'xiaoyinsi', endpoint: 'external', channel: 'native', state: 'start' });
      await Linking.openURL(pending.verificationUriWithRequest);
      setMessage('验证码已复制，请在小隐寺授权页粘贴并确认。');
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'open' });
      finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi', channel: 'native' });
      return true;
    } catch (error) {
      setMessage(`无法打开小隐寺授权页：${errorMessage(error)}`);
      finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: normalizeDiagnosticReason(error) });
      return false;
    }
  }, [pending]);

  const cancelAuthorization = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'clear', { source: 'xiaoyinsi', mode: 'manual' });
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
    try {
      await cancelXiaoyinsiDeviceAuth();
      if (!mountedRef.current) {
        finishDiagnosticTrace(trace, 'stale', { source: 'xiaoyinsi', reason: 'stale' });
        return;
      }
      setPending(null);
      markDiagnosticStage(trace, 'persist', { source: 'xiaoyinsi', store: 'secure-store', state: 'cleared' });
      const restored = await restoreExistingAuthorization('已取消重新授权，原授权仍然有效。', trace);
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
      if (mountedRef.current) {
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
    try {
      const credentials = await loadXiaoyinsiCredentials();
      markDiagnosticStage(trace, 'credential', { source: 'xiaoyinsi', store: 'secure-store', hasCredential: Boolean(credentials) });
      const cleanup = await revokeXiaoyinsiAuthorization({ fetcher: withDiagnosticFetcher(trace, fetcher) });
      if (!mountedRef.current) {
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
      markDiagnosticStage(trace, 'persist', { source: 'xiaoyinsi', store: 'multi-store', state: cleanup.complete ? 'cleared' : 'partial' });
      markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: cleanup.complete ? 'cleared' : 'cleanup' });
      finishDiagnosticTrace(trace, cleanup.complete ? 'success' : 'partial', {
        source: 'xiaoyinsi',
        state: cleanup.complete ? 'cleared' : 'cleanup',
        ...(cleanup.complete ? {} : { reason: 'storage_error' })
      });
      notify(revokedMessage);
      return true;
    } catch (error) {
      setMessage(`撤销失败：${errorMessage(error)}`);
      notify(`小隐寺撤销失败：${errorMessage(error)}`);
      finishDiagnosticTrace(trace, 'failure', { source: 'xiaoyinsi', reason: normalizeDiagnosticReason(error) });
      return false;
    } finally {
      busyRef.current = false;
      authorizationMutationRef.current = false;
    }
  }, [dispatch, fetcher, invalidateAuthorizationRefresh, notify]);

  return useMemo(() => ({
    beginAuthorization,
    cancelAuthorization,
    levelBusy,
    levelError,
    levelProfile,
    message,
    openAuthorizationBrowser,
    pending,
    phase,
    refreshAuthorization,
    refreshLevel,
    revokeAuthorization,
    secondsRemaining
  }), [beginAuthorization, cancelAuthorization, levelBusy, levelError, levelProfile, message, openAuthorizationBrowser, pending, phase, refreshAuthorization, refreshLevel, revokeAuthorization, secondsRemaining]);
}
