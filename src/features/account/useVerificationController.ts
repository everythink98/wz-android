import { hashKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { sanitizeLinuxDoUserAgent, diagnosticUserAgentHash } from '@/platform/android/linuxDoUserAgent';
import { errorMessage } from '@/platform/network/errors';
import type { SiteSessionEvent } from '@/domain/session/siteSessionState';
import type { LoginWebViewFailureReason } from './credentialDiagnostics';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { shouldOpenLoginWebViewUrl } from '@/platform/network/loginWebViewNavigation';
import { appQueryClient } from '@/platform/query/serverState';
import type {
  AccountReconcileResult,
  LinuxDoVerificationRecovery as LinuxDoReadRecovery,
  LinuxDoReadResumeOutcome
} from '@/domain/session/sessionContracts';
import type { AuthSurfaceCloseReason } from '@/domain/session/authSurfaceCoordinator';

const LINUXDO_PANEL_CLOSE_SETTLE_MS = 350;

type Ref<T> = RefObject<T>;

type LinuxDoVerificationPhase =
  'idle' | 'preparing' | 'awaiting-clearance' | 'checking-clearance' | 'resuming-read' | 'closing';

type RecoveryTarget = {
  id: string;
  recovery: LinuxDoReadRecovery;
  outcome: 'pending' | LinuxDoReadResumeOutcome;
  error?: string;
};

export type LinuxDoRecoveryPanel = {
  phase: 'idle' | 'web' | 'checking' | 'result';
  dedicated: boolean;
  results: { kind: 'page' | 'reading'; outcome: RecoveryTarget['outcome']; error?: string }[];
};

type RecoverySession = {
  scope: string;
  phase: LinuxDoRecoveryPanel['phase'];
  dedicated: boolean;
  targets: RecoveryTarget[];
};

type QueuedLinuxDoVerification = {
  message: string;
  promise: Promise<boolean>;
  recovery?: LinuxDoReadRecovery;
  resolve: (accepted: boolean) => void;
};

function isActiveRecoveryQuery(recovery: LinuxDoReadRecovery) {
  if ('kind' in recovery) return recovery.isCurrent();
  if (recovery.isCurrent) return recovery.isCurrent();
  return (
    appQueryClient
      .getQueryCache()
      .find({
        queryKey: recovery.queryKey,
        exact: true
      })
      ?.isActive() === true
  );
}

export function useVerificationController({
  canOpenLinuxDoPanel = () => true,
  awaitLinuxDoCookieHandoff = async () => undefined,
  awaitLinuxDoWebViewUnmount = async () => undefined,
  handoffLinuxDoCookies = awaitLinuxDoCookieHandoff,
  getRecoveryScope = () => '',
  onRecoveryStateChanged = () => undefined,
  changeNodeSeekLoginPanel,
  checkingRequestIdRef,
  closeYaohuoLoginPanel,
  commitLinuxDoWebViewUserAgent,
  linuxDoPanelClosingSessionRef,
  linuxDoPanelCloseSettleTimerRef,
  linuxDoWebViewMountTimerRef,
  linuxDoWebViewRef,
  linuxDoWebViewSessionRef,
  isLinuxDoSurfaceVisible,
  notify,
  onBeforeLinuxDoSurfaceOpened = () => undefined,
  onLoginWebViewFailure,
  onLinuxDoSurfaceClosed = () => undefined,
  onLinuxDoSurfaceOpened = () => undefined,
  prepareLinuxDoCookieResponseBarrier,
  reconcileAccountStatus,
  setChecking,
  setLinuxDoWebViewError,
  setLinuxDoWebViewKey,
  setLoadingLinuxDoPage,
  setMountLinuxDoWebView,
  updateLinuxDoSession,
  updateNodeSeekSession
}: {
  canOpenLinuxDoPanel?: () => boolean;
  awaitLinuxDoCookieHandoff?: () => Promise<void>;
  awaitLinuxDoWebViewUnmount?: () => Promise<void>;
  handoffLinuxDoCookies?: () => Promise<void>;
  getRecoveryScope?: () => string;
  onRecoveryStateChanged?: (panel: LinuxDoRecoveryPanel) => void;
  changeNodeSeekLoginPanel: (visible: boolean, closeReason?: AuthSurfaceCloseReason) => void;
  checkingRequestIdRef: Ref<number>;
  closeYaohuoLoginPanel: (reason?: AuthSurfaceCloseReason) => void;
  commitLinuxDoWebViewUserAgent: (userAgent: string) => void;
  linuxDoPanelClosingSessionRef: Ref<number | null>;
  linuxDoPanelCloseSettleTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewMountTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewRef: Ref<WebView | null>;
  linuxDoWebViewSessionRef: Ref<number>;
  isLinuxDoSurfaceVisible: () => boolean;
  notify: (message: string) => void;
  onBeforeLinuxDoSurfaceOpened?: () => void;
  onLoginWebViewFailure: (site: 'linuxdo', attempt: number, reason: LoginWebViewFailureReason) => void;
  onLinuxDoSurfaceClosed?: (options: { authoritativeResult: boolean; reason: AuthSurfaceCloseReason }) => void;
  onLinuxDoSurfaceOpened?: (options: { accountBarrier: boolean }) => void;
  prepareLinuxDoCookieResponseBarrier?: () => Promise<void>;
  reconcileAccountStatus: (source: 'linuxdo') => Promise<AccountReconcileResult>;
  setChecking: Dispatch<SetStateAction<boolean>>;
  setLinuxDoWebViewError: Dispatch<SetStateAction<string>>;
  setLinuxDoWebViewKey: Dispatch<SetStateAction<number>>;
  setLoadingLinuxDoPage: Dispatch<SetStateAction<boolean>>;
  setMountLinuxDoWebView: Dispatch<SetStateAction<boolean>>;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
  updateNodeSeekSession: (event: SiteSessionEvent) => void;
}) {
  const linuxDoVerificationTraceRef = useRef<DiagnosticTrace | null>(null);
  const linuxDoVerificationPhaseRef = useRef<LinuxDoVerificationPhase>('idle');
  const linuxDoVerificationGenerationRef = useRef(0);
  const linuxDoTerminalWebViewSessionRef = useRef<number | null>(null);
  const recoverySessionRef = useRef<RecoverySession | null>(null);
  const canceledQueriesRef = useRef(new WeakMap<object, number | undefined>());
  const linuxDoCanceledRecoveriesRef = useRef(new WeakSet<LinuxDoReadRecovery>());
  const linuxDoActiveCheckRef = useRef<number | null>(null);
  const queuedLinuxDoVerificationRef = useRef<QueuedLinuxDoVerification | null>(null);
  const showLinuxDoVerificationRef = useRef<
    ((message?: string, recovery?: LinuxDoReadRecovery) => Promise<boolean>) | null
  >(null);

  const publishRecovery = useCallback(() => {
    const session = recoverySessionRef.current;
    onRecoveryStateChanged({
      phase: session?.phase || 'idle',
      dedicated: session?.dedicated || false,
      results:
        session?.targets.map(({ recovery, outcome, error }) => ({
          kind: 'kind' in recovery ? 'reading' : 'page',
          outcome,
          error
        })) || []
    });
  }, [onRecoveryStateChanged]);

  const cancelRecoveryTarget = useCallback((target: { recovery: LinuxDoReadRecovery }) => {
    linuxDoCanceledRecoveriesRef.current.add(target.recovery);
    if ('kind' in target.recovery) target.recovery.cancel();
    else {
      const query = appQueryClient.getQueryCache().find({ queryKey: target.recovery.queryKey, exact: true });
      if (query) canceledQueriesRef.current.set(query, query.state?.errorUpdatedAt);
      void appQueryClient.cancelQueries({ queryKey: target.recovery.queryKey, exact: true });
    }
  }, []);

  useEffect(
    () => () => {
      ++linuxDoVerificationGenerationRef.current;
      recoverySessionRef.current?.targets
        .filter((target) => target.outcome !== 'completed')
        .forEach(cancelRecoveryTarget);
      recoverySessionRef.current = null;
      ++checkingRequestIdRef.current;
      const queued = queuedLinuxDoVerificationRef.current;
      if (queued?.recovery) cancelRecoveryTarget({ recovery: queued.recovery });
      queuedLinuxDoVerificationRef.current?.resolve(false);
      queuedLinuxDoVerificationRef.current = null;
      if (linuxDoWebViewMountTimerRef.current) clearTimeout(linuxDoWebViewMountTimerRef.current);
      if (linuxDoPanelCloseSettleTimerRef.current) clearTimeout(linuxDoPanelCloseSettleTimerRef.current);
    },
    [cancelRecoveryTarget, checkingRequestIdRef, linuxDoWebViewMountTimerRef, linuxDoPanelCloseSettleTimerRef]
  );

  const validateRecoveryTargets = useCallback(
    (session: RecoverySession) => {
      for (const target of session.targets) {
        if (target.outcome !== 'pending' && target.outcome !== 'verification-required') continue;
        const recovery = target.recovery;
        if (
          session.scope !== getRecoveryScope() ||
          !isActiveRecoveryQuery(recovery) ||
          ('kind' in recovery && recovery.isExpired?.())
        ) {
          target.outcome = 'stale';
          target.error = 'kind' in recovery ? '待同步阅读记录已过期或失效，本次未补发。' : '原页面已离开或账号已变化。';
          cancelRecoveryTarget(target);
        }
      }
      return session.targets.some(
        (target) => target.outcome === 'pending' || target.outcome === 'verification-required'
      );
    },
    [cancelRecoveryTarget, getRecoveryScope]
  );

  const finishLinuxDoVerificationTrace = useCallback(
    (trace: DiagnosticTrace, outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (linuxDoVerificationTraceRef.current !== trace) {
        return;
      }
      finishDiagnosticTrace(trace, outcome, { source: 'linuxdo', ...fields });
      linuxDoVerificationTraceRef.current = null;
    },
    []
  );

  const startLinuxDoVerificationTrace = useCallback((mode: 'open' | 'manual') => {
    const previousTrace = linuxDoVerificationTraceRef.current;
    if (previousTrace) {
      finishDiagnosticTrace(previousTrace, 'stale', {
        source: 'linuxdo',
        reason: 'superseded'
      });
    }
    const trace = beginDiagnosticTrace('credential', 'check', {
      source: 'linuxdo',
      mode
    });
    linuxDoVerificationTraceRef.current = trace;
    return trace;
  }, []);

  const currentLinuxDoVerificationTrace = useCallback(
    (mode: 'open' | 'manual' = 'manual') => {
      return linuxDoVerificationTraceRef.current || startLinuxDoVerificationTrace(mode);
    },
    [startLinuxDoVerificationTrace]
  );

  const nextLinuxDoWebViewSession = useCallback(() => {
    const nextSession = linuxDoWebViewSessionRef.current + 1;
    linuxDoWebViewSessionRef.current = nextSession;
    setLinuxDoWebViewKey(nextSession);
    return nextSession;
  }, [linuxDoWebViewSessionRef, setLinuxDoWebViewKey]);

  const setLoadingLinuxDoPageForSession = useCallback(
    (value: boolean, webViewKey?: number) => {
      if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
        return;
      }
      setLoadingLinuxDoPage(value);
      const trace = linuxDoVerificationTraceRef.current;
      if (!value && trace) {
        markDiagnosticStage(trace, 'transport', { source: 'linuxdo', channel: 'webview', state: 'ready' });
      }
    },
    [linuxDoWebViewSessionRef, setLoadingLinuxDoPage]
  );

  const setLinuxDoWebViewErrorForSession = useCallback(
    (value: string, webViewKey?: number, credentialAttempt = 0) => {
      if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
        return;
      }
      setLinuxDoWebViewError(value);
      const session = webViewKey ?? linuxDoWebViewSessionRef.current;
      if (value && linuxDoTerminalWebViewSessionRef.current === session) {
        return;
      }
      const trace =
        linuxDoVerificationTraceRef.current ||
        (value && isLinuxDoSurfaceVisible() ? currentLinuxDoVerificationTrace('open') : null);
      if (value) {
        linuxDoTerminalWebViewSessionRef.current = session;
        const reason: LoginWebViewFailureReason = value.includes('已停止')
          ? 'renderer_gone'
          : value.includes('超时')
            ? 'timeout'
            : 'network_error';
        if (trace) {
          markDiagnosticStage(trace, 'transport', { source: 'linuxdo', channel: 'webview', state: 'failure', reason });
          finishLinuxDoVerificationTrace(trace, 'failure', { reason });
        }
        onLoginWebViewFailure('linuxdo', credentialAttempt, reason);
      }
    },
    [
      currentLinuxDoVerificationTrace,
      finishLinuxDoVerificationTrace,
      linuxDoWebViewSessionRef,
      isLinuxDoSurfaceVisible,
      onLoginWebViewFailure,
      setLinuxDoWebViewError
    ]
  );

  const resetLinuxDoWebView = useCallback(() => {
    if (
      !canOpenLinuxDoPanel() ||
      linuxDoPanelClosingSessionRef.current !== null ||
      (recoverySessionRef.current && recoverySessionRef.current.phase !== 'web')
    )
      return;
    const session = recoverySessionRef.current;
    if (session && !validateRecoveryTargets(session)) {
      session.phase = 'result';
      nextLinuxDoWebViewSession();
      linuxDoWebViewRef.current?.stopLoading();
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPageForSession(false);
      void awaitLinuxDoWebViewUnmount().then(() => {
        if (recoverySessionRef.current === session && isLinuxDoSurfaceVisible())
          onLinuxDoSurfaceClosed({ authoritativeResult: true, reason: 'authoritative-recovery' });
      });
      publishRecovery();
      return;
    }
    const trace =
      linuxDoVerificationTraceRef.current ||
      (isLinuxDoSurfaceVisible() ? currentLinuxDoVerificationTrace('open') : null);
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'linuxdo',
        channel: 'webview',
        state: 'reset'
      });
    }
    const nextSession = nextLinuxDoWebViewSession();
    checkingRequestIdRef.current += 1;
    linuxDoActiveCheckRef.current = null;
    if (linuxDoWebViewMountTimerRef.current) {
      clearTimeout(linuxDoWebViewMountTimerRef.current);
      linuxDoWebViewMountTimerRef.current = null;
    }
    linuxDoWebViewRef.current?.stopLoading();
    setMountLinuxDoWebView(false);
    setChecking(false);
    setLoadingLinuxDoPageForSession(true, nextSession);
    setLinuxDoWebViewErrorForSession('', nextSession);
    const mount = () => {
      if (linuxDoWebViewSessionRef.current !== nextSession || !isLinuxDoSurfaceVisible()) return;
      linuxDoWebViewMountTimerRef.current = setTimeout(() => {
        linuxDoWebViewMountTimerRef.current = null;
        if (linuxDoWebViewSessionRef.current !== nextSession || !isLinuxDoSurfaceVisible()) return;
        setMountLinuxDoWebView(true);
      }, 80);
    };
    if (prepareLinuxDoCookieResponseBarrier) {
      void prepareLinuxDoCookieResponseBarrier().then(mount, () => {
        setLoadingLinuxDoPageForSession(false, nextSession);
        setLinuxDoWebViewErrorForSession('登录会话交接未完成，请点击刷新页面重试。', nextSession);
      });
    } else mount();
  }, [
    awaitLinuxDoWebViewUnmount,
    canOpenLinuxDoPanel,
    onLinuxDoSurfaceClosed,
    publishRecovery,
    validateRecoveryTargets,
    checkingRequestIdRef,
    currentLinuxDoVerificationTrace,
    linuxDoPanelClosingSessionRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    isLinuxDoSurfaceVisible,
    nextLinuxDoWebViewSession,
    prepareLinuxDoCookieResponseBarrier,
    setChecking,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPageForSession,
    setMountLinuxDoWebView
  ]);

  const invalidateLinuxDoCheck = useCallback(() => {
    checkingRequestIdRef.current += 1;
    linuxDoActiveCheckRef.current = null;
    setChecking(false);
  }, [checkingRequestIdRef, setChecking]);

  const closeLinuxDoPanel = useCallback(
    (cancelCurrentRecovery = true, reason: AuthSurfaceCloseReason = 'close-button', authoritativeResult = false) => {
      const session = recoverySessionRef.current;
      if (!isLinuxDoSurfaceVisible() && !session && linuxDoPanelClosingSessionRef.current === null) return;
      if (session && cancelCurrentRecovery) {
        session.targets.filter((target) => target.outcome !== 'completed').forEach(cancelRecoveryTarget);
        if (session.targets.some((target) => 'kind' in target.recovery && target.outcome !== 'completed'))
          notify('本次阅读同步已停止，未确认的请求不会重发。');
      }
      recoverySessionRef.current = null;
      if (linuxDoPanelClosingSessionRef.current === null) {
        publishRecovery();
        linuxDoVerificationGenerationRef.current += 1;
        linuxDoVerificationPhaseRef.current = 'closing';
        invalidateLinuxDoCheck();
      }
      if (cancelCurrentRecovery) {
        const queuedRecovery = queuedLinuxDoVerificationRef.current;
        if (queuedRecovery?.recovery) {
          cancelRecoveryTarget({ recovery: queuedRecovery.recovery });
        }
        queuedRecovery?.resolve(false);
        queuedLinuxDoVerificationRef.current = null;
      }
      const trace = linuxDoVerificationTraceRef.current;
      if (trace) {
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          state: 'linuxdo-panel-closed'
        });
        if (!authoritativeResult) {
          finishLinuxDoVerificationTrace(trace, 'canceled', { reason: 'canceled', closeReason: reason });
        }
      }
      if (linuxDoPanelClosingSessionRef.current !== null) {
        linuxDoWebViewRef.current?.stopLoading();
        setMountLinuxDoWebView(false);
        setLoadingLinuxDoPage(false);
        setLinuxDoWebViewError('');
        return;
      }
      const wasVisible = isLinuxDoSurfaceVisible();
      const nextSession = nextLinuxDoWebViewSession();
      linuxDoPanelClosingSessionRef.current = nextSession;
      if (linuxDoWebViewMountTimerRef.current) {
        clearTimeout(linuxDoWebViewMountTimerRef.current);
        linuxDoWebViewMountTimerRef.current = null;
      }
      if (linuxDoPanelCloseSettleTimerRef.current) {
        clearTimeout(linuxDoPanelCloseSettleTimerRef.current);
        linuxDoPanelCloseSettleTimerRef.current = null;
      }
      linuxDoWebViewRef.current?.stopLoading();
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPageForSession(false, nextSession);
      setLinuxDoWebViewErrorForSession('', nextSession);
      if (wasVisible) {
        onLinuxDoSurfaceClosed({ authoritativeResult, reason });
      }

      const settleClosingPanel = () => {
        if (linuxDoPanelClosingSessionRef.current !== nextSession || isLinuxDoSurfaceVisible()) {
          return;
        }
        linuxDoPanelClosingSessionRef.current = null;
        linuxDoVerificationPhaseRef.current = 'idle';
        const queued = queuedLinuxDoVerificationRef.current;
        queuedLinuxDoVerificationRef.current = null;
        if (!queued) {
          return;
        }
        if (
          queued.recovery &&
          (linuxDoCanceledRecoveriesRef.current.has(queued.recovery) || !isActiveRecoveryQuery(queued.recovery))
        ) {
          queued.resolve(false);
          return;
        }
        const showQueued = showLinuxDoVerificationRef.current;
        if (!showQueued) {
          queued.resolve(false);
          return;
        }
        void showQueued(queued.message, queued.recovery).then(queued.resolve, () => {
          queued.resolve(false);
        });
      };

      if (!wasVisible) {
        settleClosingPanel();
        return;
      }
      linuxDoPanelCloseSettleTimerRef.current = setTimeout(() => {
        linuxDoPanelCloseSettleTimerRef.current = null;
        settleClosingPanel();
      }, LINUXDO_PANEL_CLOSE_SETTLE_MS);
    },
    [
      cancelRecoveryTarget,
      publishRecovery,
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      isLinuxDoSurfaceVisible,
      linuxDoPanelCloseSettleTimerRef,
      linuxDoPanelClosingSessionRef,
      linuxDoWebViewMountTimerRef,
      linuxDoWebViewRef,
      nextLinuxDoWebViewSession,
      onLinuxDoSurfaceClosed,
      notify,
      setLinuxDoWebViewError,
      setLinuxDoWebViewErrorForSession,
      setLoadingLinuxDoPage,
      setLoadingLinuxDoPageForSession,
      setMountLinuxDoWebView
    ]
  );

  const showNodeSeekVerification = useCallback(
    (message = 'NodeSeek 需要完成 Cloudflare 验证') => {
      closeLinuxDoPanel(true, 'switch-surface');
      changeNodeSeekLoginPanel(true);
      closeYaohuoLoginPanel('switch-surface');
      updateNodeSeekSession({ type: 'verification-required', message });
      notify(message);
      return true;
    },
    [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeYaohuoLoginPanel, notify, updateNodeSeekSession]
  );

  const changeLinuxDoPanel = useCallback(
    (visible: boolean) => {
      if (visible) {
        const trace = currentLinuxDoVerificationTrace('open');
        if (!canOpenLinuxDoPanel()) {
          markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'disabled' });
          finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'source_disabled' });
          return false;
        }
        if (linuxDoPanelClosingSessionRef.current !== null) {
          markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'busy' });
          finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'busy' });
          return false;
        }
        onBeforeLinuxDoSurfaceOpened();
        markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'open' });
        if (linuxDoVerificationPhaseRef.current !== 'preparing') {
          const session = recoverySessionRef.current;
          session?.targets.filter((target) => target.outcome !== 'completed').forEach(cancelRecoveryTarget);
          recoverySessionRef.current = null;
          publishRecovery();
          linuxDoVerificationGenerationRef.current += 1;
          invalidateLinuxDoCheck();
        }
        const wasVisible = isLinuxDoSurfaceVisible();
        if (!wasVisible) {
          onLinuxDoSurfaceOpened({ accountBarrier: !recoverySessionRef.current });
        }
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        resetLinuxDoWebView();
        return true;
      }
      closeLinuxDoPanel();
      return true;
    },
    [
      cancelRecoveryTarget,
      publishRecovery,
      closeLinuxDoPanel,
      canOpenLinuxDoPanel,
      currentLinuxDoVerificationTrace,
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      isLinuxDoSurfaceVisible,
      linuxDoPanelClosingSessionRef,
      onBeforeLinuxDoSurfaceOpened,
      onLinuxDoSurfaceOpened,
      resetLinuxDoWebView
    ]
  );

  const showLinuxDoVerification = useCallback(
    async (message = 'linux.do 需要完成 Cloudflare 验证', recovery?: LinuxDoReadRecovery) => {
      if (!canOpenLinuxDoPanel()) return false;
      if (!recovery && recoverySessionRef.current) return true;
      if (recovery) {
        if (linuxDoCanceledRecoveriesRef.current.has(recovery) || !isActiveRecoveryQuery(recovery)) return false;
        if ('kind' in recovery && recovery.isExpired?.()) {
          recovery.cancel();
          linuxDoCanceledRecoveriesRef.current.add(recovery);
          notify('待同步阅读记录已过期或失效，本次未补发。');
          return false;
        }
        const id = 'kind' in recovery ? 'reading:' + recovery.batchId : hashKey(recovery.queryKey);
        if (!('kind' in recovery)) {
          const query = appQueryClient.getQueryCache().find({ queryKey: recovery.queryKey, exact: true });
          if (
            query &&
            canceledQueriesRef.current.has(query) &&
            canceledQueriesRef.current.get(query) === query.state?.errorUpdatedAt
          )
            return false;
          if (query) canceledQueriesRef.current.delete(query);
        }
        const session = recoverySessionRef.current;
        if (session) {
          if (!session.targets.some((target) => target.id === id)) {
            session.targets.push({ id, recovery, outcome: 'pending' });
            publishRecovery();
          }
          return true;
        }
      }
      if (linuxDoPanelClosingSessionRef.current !== null) {
        const previousQueued = queuedLinuxDoVerificationRef.current;
        if (previousQueued && previousQueued.recovery === recovery) {
          previousQueued.message = message;
          notify(message);
          return previousQueued.promise;
        }
        if (previousQueued?.recovery) {
          cancelRecoveryTarget({ recovery: previousQueued.recovery });
        }
        previousQueued?.resolve(false);
        let resolveQueued!: (accepted: boolean) => void;
        const queuedPromise = new Promise<boolean>((resolve) => {
          resolveQueued = resolve;
        });
        queuedLinuxDoVerificationRef.current = {
          message,
          promise: queuedPromise,
          recovery,
          resolve: resolveQueued
        };
        notify(message);
        return queuedPromise;
      }
      if (recovery) {
        recoverySessionRef.current = {
          scope: getRecoveryScope(),
          phase: 'web',
          dedicated: !isLinuxDoSurfaceVisible(),
          targets: [
            {
              id: 'kind' in recovery ? 'reading:' + recovery.batchId : hashKey(recovery.queryKey),
              recovery,
              outcome: 'pending'
            }
          ]
        };
        publishRecovery();
        ++linuxDoVerificationGenerationRef.current;
        invalidateLinuxDoCheck();
        linuxDoVerificationPhaseRef.current = 'preparing';
        startLinuxDoVerificationTrace('open');
        // Attaching recovery to manual login must preserve its current document.
        if (isLinuxDoSurfaceVisible()) return true;
      }
      changeNodeSeekLoginPanel(false, 'switch-surface');
      closeYaohuoLoginPanel('switch-surface');
      if (!changeLinuxDoPanel(true)) {
        return false;
      }
      if (!recovery) {
        updateLinuxDoSession({ type: 'verification-started', at: new Date().toISOString() });
      }
      notify(message);
      return true;
    },
    [
      changeLinuxDoPanel,
      cancelRecoveryTarget,
      getRecoveryScope,
      publishRecovery,
      canOpenLinuxDoPanel,
      isLinuxDoSurfaceVisible,
      currentLinuxDoVerificationTrace,
      changeNodeSeekLoginPanel,
      closeYaohuoLoginPanel,
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      linuxDoPanelClosingSessionRef,
      notify,
      startLinuxDoVerificationTrace,
      updateLinuxDoSession
    ]
  );
  useCommitRefValue(showLinuxDoVerificationRef, showLinuxDoVerification);

  const handleLinuxDoMessage = useCallback(
    (event: WebViewMessageEvent, webViewKey?: number) => {
      if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
        const trace = linuxDoVerificationTraceRef.current;
        if (trace) {
          markDiagnosticStage(trace, 'guard', {
            source: 'linuxdo',
            isCurrent: false,
            reason: 'stale'
          });
        }
        return;
      }
      if (!isLinuxDoSurfaceVisible()) {
        return;
      }
      if (!shouldOpenLoginWebViewUrl(event.nativeEvent.url, ['linux.do'])) {
        return;
      }
      try {
        const data = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          userAgent?: string;
        };
        const trace = linuxDoVerificationTraceRef.current;
        if (trace) {
          markDiagnosticStage(trace, 'parse', {
            source: 'linuxdo',
            messageRecognized: data.type === 'linuxdo-webview',
            userAgentSource:
              data.type === 'linuxdo-webview' && typeof data.userAgent === 'string' ? 'webview' : 'unknown',
            ...(data.type === 'linuxdo-webview' && typeof data.userAgent === 'string'
              ? { userAgentHash: diagnosticUserAgentHash(sanitizeLinuxDoUserAgent(data.userAgent)) }
              : {})
          });
        }
        if (data.type === 'linuxdo-webview' && typeof data.userAgent === 'string') {
          const userAgent = sanitizeLinuxDoUserAgent(data.userAgent);
          if (userAgent) {
            commitLinuxDoWebViewUserAgent(userAgent);
          }
        }
      } catch {
        const trace = linuxDoVerificationTraceRef.current;
        if (trace) {
          markDiagnosticStage(trace, 'parse', {
            source: 'linuxdo',
            messageRecognized: false,
            reason: 'invalid_response'
          });
        }
        // Ignore unrelated messages from the page.
      }
    },
    [commitLinuxDoWebViewUserAgent, linuxDoWebViewSessionRef, isLinuxDoSurfaceVisible, setLinuxDoWebViewErrorForSession]
  );

  const retryLinuxDoRecovery = useCallback(() => {
    const session = recoverySessionRef.current;
    if (!session || session.phase !== 'result' || !canOpenLinuxDoPanel()) return;
    if (validateRecoveryTargets(session)) {
      session.phase = 'web';
      onBeforeLinuxDoSurfaceOpened();
      onLinuxDoSurfaceOpened({ accountBarrier: false });
      resetLinuxDoWebView();
    }
    publishRecovery();
  }, [
    canOpenLinuxDoPanel,
    onBeforeLinuxDoSurfaceOpened,
    onLinuxDoSurfaceOpened,
    publishRecovery,
    resetLinuxDoWebView,
    validateRecoveryTargets
  ]);

  const checkRecovery = useCallback(
    async (session: RecoverySession) => {
      if (session.phase !== 'web' || !canOpenLinuxDoPanel()) return;
      session.phase = 'checking';
      const generation = linuxDoVerificationGenerationRef.current;
      const current = () =>
        recoverySessionRef.current === session &&
        session.phase === 'checking' &&
        generation === linuxDoVerificationGenerationRef.current &&
        session.scope === getRecoveryScope() &&
        canOpenLinuxDoPanel();
      const trace = currentLinuxDoVerificationTrace('manual');
      publishRecovery();
      setChecking(true);
      nextLinuxDoWebViewSession();
      if (linuxDoWebViewMountTimerRef.current) {
        clearTimeout(linuxDoWebViewMountTimerRef.current);
        linuxDoWebViewMountTimerRef.current = null;
      }
      linuxDoWebViewRef.current?.stopLoading();
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPage(false);
      setLinuxDoWebViewError('');
      try {
        validateRecoveryTargets(session);
        await awaitLinuxDoWebViewUnmount();
        if (!current()) return;
        onLinuxDoSurfaceClosed({ authoritativeResult: true, reason: 'authoritative-recovery' });
        await awaitLinuxDoCookieHandoff();
        if (!current()) return;
        markDiagnosticStage(trace, 'apply', { source: 'linuxdo', state: 'resuming-read' });
        // Snapshot this check's targets; notifications arriving later wait for another explicit check.
        for (const target of [...session.targets]) {
          if (!current()) return;
          validateRecoveryTargets(session);
          if (target.outcome !== 'pending' && target.outcome !== 'verification-required') continue;
          try {
            const outcome = await target.recovery.resume();
            if (!current()) return;
            target.outcome = outcome;
            if (outcome === 'failed') {
              if ('kind' in target.recovery) target.error = target.recovery.failureMessage;
              else {
                const error = appQueryClient.getQueryCache().find({ queryKey: target.recovery.queryKey, exact: true })
                  ?.state?.error;
                if (error) target.error = errorMessage(error);
              }
            }
          } catch (error) {
            if (!current()) return;
            target.outcome = 'failed';
            target.error = errorMessage(error);
          }
          publishRecovery();
        }
        if (!current()) return;
        if (session.targets.every((target) => target.outcome === 'completed')) {
          const hasPage = session.targets.some((target) => !('kind' in target.recovery));
          const hasReading = session.targets.some((target) => 'kind' in target.recovery);
          closeLinuxDoPanel(false, 'authoritative-recovery', true);
          notify(
            hasPage && hasReading
              ? 'linux.do 页面已恢复，阅读记录已同步。'
              : hasReading
                ? 'linux.do 阅读记录已同步。'
                : 'linux.do 验证已通过，页面已恢复。'
          );
          finishLinuxDoVerificationTrace(trace, 'success');
        } else {
          session.phase = 'result';
          publishRecovery();
          const blocked = session.targets.some((target) => target.outcome === 'verification-required');
          finishLinuxDoVerificationTrace(trace, blocked ? 'blocked' : 'failure', {
            reason: blocked ? 'verification_required' : 'refresh_failed'
          });
        }
      } catch (error) {
        if (!current()) return;
        for (const target of session.targets) {
          if (target.outcome !== 'pending' && target.outcome !== 'verification-required') continue;
          target.outcome = 'failed';
          target.error = `会话交接失败：${errorMessage(error)}`;
          cancelRecoveryTarget(target);
        }
        session.phase = 'result';
        publishRecovery();
        finishLinuxDoVerificationTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      } finally {
        if (recoverySessionRef.current === session) setChecking(false);
      }
    },
    [
      awaitLinuxDoCookieHandoff,
      awaitLinuxDoWebViewUnmount,
      canOpenLinuxDoPanel,
      cancelRecoveryTarget,
      closeLinuxDoPanel,
      currentLinuxDoVerificationTrace,
      finishLinuxDoVerificationTrace,
      getRecoveryScope,
      linuxDoWebViewMountTimerRef,
      linuxDoWebViewRef,
      nextLinuxDoWebViewSession,
      notify,
      onLinuxDoSurfaceClosed,
      publishRecovery,
      setChecking,
      setLinuxDoWebViewError,
      setLoadingLinuxDoPage,
      setMountLinuxDoWebView,
      validateRecoveryTargets
    ]
  );

  const checkLinuxDoCookie = useCallback(async () => {
    const session = recoverySessionRef.current;
    if (session) return checkRecovery(session);
    if (!canOpenLinuxDoPanel() || !isLinuxDoSurfaceVisible()) return;
    if (linuxDoActiveCheckRef.current !== null) {
      return;
    }
    const requestId = ++checkingRequestIdRef.current;
    linuxDoActiveCheckRef.current = requestId;
    const flowGeneration = linuxDoVerificationGenerationRef.current;
    const trace = currentLinuxDoVerificationTrace('manual');
    markDiagnosticStage(trace, 'credential', {
      source: 'linuxdo',
      state: 'started'
    });
    const linuxDoWebViewSession = nextLinuxDoWebViewSession();
    if (linuxDoWebViewMountTimerRef.current) {
      clearTimeout(linuxDoWebViewMountTimerRef.current);
      linuxDoWebViewMountTimerRef.current = null;
    }
    linuxDoWebViewRef.current?.stopLoading();
    setMountLinuxDoWebView(false);
    setLoadingLinuxDoPage(false);
    const isCurrentLinuxDoCheck = () => {
      if (!canOpenLinuxDoPanel()) return false;
      if (linuxDoActiveCheckRef.current !== requestId) {
        return false;
      }
      if (requestId !== checkingRequestIdRef.current) {
        return false;
      }
      if (linuxDoWebViewSession !== linuxDoWebViewSessionRef.current) {
        return false;
      }
      if (!isLinuxDoSurfaceVisible()) {
        return false;
      }
      if (flowGeneration !== linuxDoVerificationGenerationRef.current) {
        return false;
      }
      if (linuxDoVerificationPhaseRef.current === 'closing' || linuxDoVerificationPhaseRef.current === 'idle') {
        return false;
      }
      return true;
    };
    setChecking(true);
    linuxDoVerificationPhaseRef.current = 'checking-clearance';
    setLinuxDoWebViewError('');
    try {
      await awaitLinuxDoWebViewUnmount();
      if (!isCurrentLinuxDoCheck()) return;
      await handoffLinuxDoCookies();
      if (!isCurrentLinuxDoCheck()) return;
      const result = await reconcileAccountStatus('linuxdo');
      if (!isCurrentLinuxDoCheck()) {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      if (result.status === 'stale') {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      // Committing a changed identity can advance the native epoch. Join that handoff
      // before releasing the Account business barrier, even though the page is already gone.
      await handoffLinuxDoCookies();
      if (!isCurrentLinuxDoCheck()) return;
      if (result.status === 'unknown') {
        const message = `linux.do 登录状态暂时无法确认：${result.error}`;
        setLinuxDoWebViewError(message);
        notify(message);
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'identity_pending' });
        return;
      }
      const loginConfirmed = result.session.status === 'logged-in' && Boolean(result.session.currentUser?.id);
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        hasCredential: loginConfirmed,
        isLoggedIn: loginConfirmed
      });
      if (!loginConfirmed) {
        const message = 'linux.do 当前为未登录状态，请刷新页面登录后再检测。';
        setLinuxDoWebViewError(message);
        notify(message);
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'login_required' });
        return;
      }
      setLinuxDoWebViewError('');
      closeLinuxDoPanel(false, 'authoritative-recovery', true);
      notify('linux.do 登录身份已确认。');
      finishLinuxDoVerificationTrace(trace, 'success', {
        hasCredential: true,
        isLoggedIn: true
      });
    } catch (error) {
      if (isCurrentLinuxDoCheck()) {
        setLinuxDoWebViewError(`登录会话交接或检测失败：${errorMessage(error)}，请重试检测或刷新页面。`);
        notify(errorMessage(error));
        finishLinuxDoVerificationTrace(trace, 'failure', {
          reason: normalizeDiagnosticReason(error)
        });
      } else {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
      }
    } finally {
      if (linuxDoActiveCheckRef.current === requestId) {
        const remainsCurrent = isCurrentLinuxDoCheck();
        linuxDoActiveCheckRef.current = null;
        if (remainsCurrent && linuxDoVerificationPhaseRef.current === 'checking-clearance') {
          linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        }
        if (remainsCurrent) {
          setChecking(false);
        }
      }
    }
  }, [
    canOpenLinuxDoPanel,
    checkRecovery,
    awaitLinuxDoWebViewUnmount,
    handoffLinuxDoCookies,
    checkingRequestIdRef,
    closeLinuxDoPanel,
    currentLinuxDoVerificationTrace,
    finishLinuxDoVerificationTrace,
    isLinuxDoSurfaceVisible,
    linuxDoWebViewSessionRef,
    nextLinuxDoWebViewSession,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    setMountLinuxDoWebView,
    setLoadingLinuxDoPage,
    notify,
    reconcileAccountStatus,
    setChecking,
    setLinuxDoWebViewError,
    showLinuxDoVerification,
    updateLinuxDoSession
  ]);
  const cancelLinuxDoCheckForInactiveApp = useCallback(() => {
    const session = recoverySessionRef.current;
    if (session?.phase === 'checking') {
      ++linuxDoVerificationGenerationRef.current;
      recoverySessionRef.current = {
        ...session,
        phase: 'result',
        targets: session.targets.map((target) =>
          target.outcome === 'completed'
            ? target
            : {
                ...target,
                outcome: 'failed',
                error: '检测因切到后台而中断；未确认的阅读请求不会重发。'
              }
        )
      };
      recoverySessionRef.current.targets
        .filter((target) => target.outcome !== 'completed')
        .forEach(cancelRecoveryTarget);
      if (isLinuxDoSurfaceVisible())
        onLinuxDoSurfaceClosed({ authoritativeResult: true, reason: 'authoritative-recovery' });
      setChecking(false);
      publishRecovery();
      const trace = linuxDoVerificationTraceRef.current;
      if (trace) finishLinuxDoVerificationTrace(trace, 'canceled', { reason: 'canceled' });
    }
    if (!isLinuxDoSurfaceVisible() || linuxDoActiveCheckRef.current === null) {
      return;
    }
    invalidateLinuxDoCheck();
    linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
    const trace = linuxDoVerificationTraceRef.current;
    if (trace) {
      finishLinuxDoVerificationTrace(trace, 'canceled', { reason: 'canceled' });
    }
  }, [
    cancelRecoveryTarget,
    finishLinuxDoVerificationTrace,
    invalidateLinuxDoCheck,
    isLinuxDoSurfaceVisible,
    onLinuxDoSurfaceClosed,
    publishRecovery,
    setChecking
  ]);

  return {
    retryLinuxDoRecovery,
    changeLinuxDoPanel,
    checkLinuxDoCookie,
    closeLinuxDoPanel,
    handleLinuxDoMessage,
    resetLinuxDoWebView,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPageForSession,
    showLinuxDoVerification,
    showNodeSeekVerification,
    cancelLinuxDoCheckForInactiveApp
  };
}
