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
import { startCloudflareEgressProbe } from '@/platform/network/cloudflareEgressDiagnostics';
import type { Fetcher } from '@/platform/network/request';
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

export type LinuxDoVerificationPageEvent = Required<Pick<DiagnosticFields, 'verificationPage' | 'verificationAction'>> &
  Partial<Pick<DiagnosticFields, 'status' | 'hasLoadError' | 'isDocumentUrlMatch' | 'reason'>>;

type RecoverySession = {
  scope: string;
  phase: LinuxDoRecoveryPanel['phase'];
  dedicated: boolean;
  targets: RecoveryTarget[];
  lastCheckTraceId?: string;
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

function markReadingRecovery(
  trace: DiagnosticTrace | null,
  recovery: LinuxDoReadRecovery,
  state: DiagnosticFields['readingRecoveryState']
) {
  if (trace && 'kind' in recovery) {
    markDiagnosticStage(trace, 'apply', { source: 'linuxdo', batchId: recovery.batchId, readingRecoveryState: state });
  }
}

export function useVerificationController({
  fetcher,
  getLinuxDoSurfaceGeneration = () => undefined,
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
  fetcher?: Fetcher;
  getLinuxDoSurfaceGeneration?: () => number | undefined;
  canOpenLinuxDoPanel?: () => boolean;
  awaitLinuxDoCookieHandoff?: () => Promise<void>;
  awaitLinuxDoWebViewUnmount?: () => Promise<void>;
  handoffLinuxDoCookies?: (parentTraceId?: string) => Promise<void>;
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
  onLinuxDoSurfaceClosed?: (options: {
    authoritativeResult: boolean;
    reason: AuthSurfaceCloseReason;
    parentTraceId?: string;
  }) => void;
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
  const getLinuxDoSurfaceGenerationRef = useRef(getLinuxDoSurfaceGeneration);
  useCommitRefValue(getLinuxDoSurfaceGenerationRef, getLinuxDoSurfaceGeneration);
  const linuxDoVerificationPhaseRef = useRef<LinuxDoVerificationPhase>('idle');
  const linuxDoVerificationGenerationRef = useRef(0);
  const linuxDoEgressSequenceRef = useRef(0);
  const linuxDoEgressProbeRef = useRef<{
    documentKey: string;
    probe: ReturnType<typeof startCloudflareEgressProbe>;
    stopped?: boolean;
  } | null>(null);
  const linuxDoPageObservationRef = useRef<{
    documentKey: string;
    pageStatus: 'logged-in' | 'logged-out' | 'unknown';
    hasChallengeMarker?: boolean;
    at: number;
  } | null>(null);
  const linuxDoTerminalWebViewSessionRef = useRef<number | null>(null);
  const recoverySessionRef = useRef<RecoverySession | null>(null);
  const canceledQueriesRef = useRef(new WeakMap<object, number | undefined>());
  const linuxDoCanceledRecoveriesRef = useRef(new WeakSet<LinuxDoReadRecovery>());
  const linuxDoActiveCheckRef = useRef<number | null>(null);
  const postChallengeCheckRef = useRef<{
    webViewKey: number;
    generation: number;
    scope: string;
    documentKey?: string;
    waiting: boolean;
    consumed: boolean;
  } | null>(null);
  const checkLinuxDoCookieRef = useRef<() => Promise<void>>(async () => undefined);
  const queuedLinuxDoVerificationRef = useRef<QueuedLinuxDoVerification | null>(null);
  const showLinuxDoVerificationRef = useRef<
    ((message?: string, recovery?: LinuxDoReadRecovery) => Promise<boolean>) | null
  >(null);

  const cancelLinuxDoEgressProbe = useCallback(
    (reason: NonNullable<DiagnosticFields['egressCheckpoint']>, forgetDocument = true) => {
      const automatic = postChallengeCheckRef.current;
      const current = linuxDoEgressProbeRef.current;
      // The expected CDK -> forum navigation precedes binding the returned document.
      if (automatic && (reason !== 'navigation' || current || linuxDoPageObservationRef.current))
        automatic.consumed = true;
      const trace = linuxDoVerificationTraceRef.current;
      const snapshot = current?.probe.snapshot();
      const page = linuxDoPageObservationRef.current;
      if (trace && (reason === 'check' || (current && !current.stopped))) {
        markDiagnosticStage(trace, 'guard', {
          source: 'linuxdo',
          surfaceGeneration: getLinuxDoSurfaceGenerationRef.current(),
          egressCheckpoint: reason,
          egressProbeState: snapshot ? (snapshot.completedAt === undefined ? 'pending' : 'completed') : 'not-started',
          ...(snapshot
            ? {
                ...snapshot.fields,
                egressProbeTraceId: snapshot.traceId,
                egressProbeAgeMs: Math.max(0, Date.now() - snapshot.startedAt)
              }
            : {}),
          ...(page
            ? {
                pageStatus: page.pageStatus,
                hasChallengeMarker: page.hasChallengeMarker,
                pageObservationAgeMs: Math.max(0, Date.now() - page.at)
              }
            : {})
        });
      }
      if (current && !current.stopped) current.probe.cancel(reason);
      linuxDoEgressProbeRef.current = forgetDocument || !current ? null : { ...current, stopped: true };
    },
    []
  );

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
      target.recovery.cancel?.();
      const query = appQueryClient.getQueryCache().find({ queryKey: target.recovery.queryKey, exact: true });
      if (query) canceledQueriesRef.current.set(query, query.state?.errorUpdatedAt);
      void appQueryClient.cancelQueries({ queryKey: target.recovery.queryKey, exact: true });
    }
  }, []);

  useEffect(
    () => () => {
      cancelLinuxDoEgressProbe('unmount');
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
    [
      cancelLinuxDoEgressProbe,
      cancelRecoveryTarget,
      checkingRequestIdRef,
      linuxDoWebViewMountTimerRef,
      linuxDoPanelCloseSettleTimerRef
    ]
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
          markReadingRecovery(linuxDoVerificationTraceRef.current, recovery, 'stale');
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
      mode,
      parentTraceId: recoverySessionRef.current?.lastCheckTraceId,
      surfaceGeneration: getLinuxDoSurfaceGenerationRef.current()
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

  const tryLinuxDoPostChallengeCheck = useCallback(() => {
    const automatic = postChallengeCheckRef.current;
    const page = linuxDoPageObservationRef.current;
    const probe = linuxDoEgressProbeRef.current;
    if (
      !automatic ||
      automatic.consumed ||
      automatic.waiting ||
      !page ||
      page.pageStatus === 'unknown' ||
      page.hasChallengeMarker !== false ||
      (probe && (probe.stopped || probe.documentKey !== page.documentKey))
    )
      return;
    automatic.documentKey = page.documentKey;
    automatic.waiting = true;
    // A diagnostic failure or timeout is still a completion, never a business verdict.
    void (probe?.probe.settled || Promise.resolve()).then(() => {
      automatic.waiting = false;
      const currentPage = linuxDoPageObservationRef.current;
      if (
        postChallengeCheckRef.current !== automatic ||
        automatic.consumed ||
        automatic.webViewKey !== linuxDoWebViewSessionRef.current ||
        automatic.generation !== linuxDoVerificationGenerationRef.current ||
        automatic.scope !== getRecoveryScope() ||
        !isLinuxDoSurfaceVisible() ||
        !canOpenLinuxDoPanel() ||
        (recoverySessionRef.current && recoverySessionRef.current.phase !== 'web') ||
        !currentPage ||
        currentPage.documentKey !== automatic.documentKey ||
        currentPage.pageStatus === 'unknown' ||
        currentPage.hasChallengeMarker !== false
      )
        return;
      automatic.consumed = true;
      markDiagnosticStage(currentLinuxDoVerificationTrace('manual'), 'guard', {
        source: 'linuxdo',
        channel: 'webview',
        verificationAction: 'auto-check',
        verificationPage: 'forum',
        webViewKey: automatic.webViewKey
      });
      void checkLinuxDoCookieRef.current();
    });
  }, [
    canOpenLinuxDoPanel,
    currentLinuxDoVerificationTrace,
    getRecoveryScope,
    isLinuxDoSurfaceVisible,
    linuxDoWebViewSessionRef
  ]);

  const armLinuxDoPostChallengeCheck = useCallback(
    (webViewKey: number) => {
      if (
        webViewKey !== linuxDoWebViewSessionRef.current ||
        !isLinuxDoSurfaceVisible() ||
        !canOpenLinuxDoPanel() ||
        postChallengeCheckRef.current?.webViewKey === webViewKey ||
        linuxDoActiveCheckRef.current !== null ||
        (recoverySessionRef.current && recoverySessionRef.current.phase !== 'web')
      )
        return;
      postChallengeCheckRef.current = {
        webViewKey,
        generation: linuxDoVerificationGenerationRef.current,
        scope: getRecoveryScope(),
        waiting: false,
        consumed: false
      };
      tryLinuxDoPostChallengeCheck();
    },
    [
      canOpenLinuxDoPanel,
      getRecoveryScope,
      isLinuxDoSurfaceVisible,
      linuxDoWebViewSessionRef,
      tryLinuxDoPostChallengeCheck
    ]
  );

  const recordLinuxDoVerificationPageEvent = useCallback(
    (event: LinuxDoVerificationPageEvent, webViewKey: number) => {
      if (!isLinuxDoSurfaceVisible() && !recoverySessionRef.current) return;
      const isCurrent = webViewKey === linuxDoWebViewSessionRef.current;
      const trace = isCurrent ? currentLinuxDoVerificationTrace('open') : linuxDoVerificationTraceRef.current;
      if (!trace) return;
      markDiagnosticStage(trace, isCurrent ? 'transport' : 'guard', {
        ...event,
        source: 'linuxdo',
        channel: 'webview',
        webViewKey,
        isCurrent,
        surfaceGeneration: getLinuxDoSurfaceGenerationRef.current()
      });
    },
    [currentLinuxDoVerificationTrace, isLinuxDoSurfaceVisible, linuxDoWebViewSessionRef]
  );

  const nextLinuxDoWebViewSession = useCallback(
    (reason: 'check' | 'close' | 'refresh') => {
      cancelLinuxDoEgressProbe(reason);
      linuxDoPageObservationRef.current = null;
      const nextSession = linuxDoWebViewSessionRef.current + 1;
      linuxDoWebViewSessionRef.current = nextSession;
      setLinuxDoWebViewKey(nextSession);
      return nextSession;
    },
    [cancelLinuxDoEgressProbe, linuxDoWebViewSessionRef, setLinuxDoWebViewKey]
  );

  const setLoadingLinuxDoPageForSession = useCallback(
    (value: boolean, webViewKey?: number) => {
      if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
        return;
      }
      // Android emits loading starts for same-document history updates too.
      setLoadingLinuxDoPage(value);
      const trace = linuxDoVerificationTraceRef.current;
      if (!value && trace) {
        markDiagnosticStage(trace, 'transport', { source: 'linuxdo', channel: 'webview', state: 'ready' });
      }
    },
    [linuxDoWebViewSessionRef, setLoadingLinuxDoPage]
  );

  const beginLinuxDoDocumentNavigation = useCallback(
    (webViewKey: number) => {
      if (webViewKey !== linuxDoWebViewSessionRef.current || !isLinuxDoSurfaceVisible() || !canOpenLinuxDoPanel())
        return;
      cancelLinuxDoEgressProbe('navigation', false);
      linuxDoPageObservationRef.current = null;
    },
    [cancelLinuxDoEgressProbe, canOpenLinuxDoPanel, isLinuxDoSurfaceVisible, linuxDoWebViewSessionRef]
  );

  const setLinuxDoWebViewErrorForSession = useCallback(
    (value: string, webViewKey?: number, credentialAttempt = 0) => {
      if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
        return;
      }
      if (value) cancelLinuxDoEgressProbe('webview-error', false);
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
      cancelLinuxDoEgressProbe,
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
      nextLinuxDoWebViewSession('refresh');
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
    const nextSession = nextLinuxDoWebViewSession('refresh');
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
      cancelLinuxDoEgressProbe('close');
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
      const nextSession = nextLinuxDoWebViewSession('close');
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
      cancelLinuxDoEgressProbe,
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
          const index = session.targets.findIndex((target) => target.id === id);
          if (index < 0) {
            session.targets.push({ id, recovery, outcome: 'pending' });
            markReadingRecovery(currentLinuxDoVerificationTrace('open'), recovery, 'paused');
            publishRecovery();
          } else if (!('kind' in recovery) && !isActiveRecoveryQuery(session.targets[index].recovery)) {
            cancelRecoveryTarget(session.targets[index]);
            // Replace the target object so a late check cannot overwrite this attempt.
            session.targets[index] = { id, recovery, outcome: 'pending' };
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
        markReadingRecovery(startLinuxDoVerificationTrace('open'), recovery, 'paused');
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
          documentKey?: string;
          status?: unknown;
          hasChallengeMarker?: unknown;
        };
        if (
          data.type === 'linuxdo-webview' &&
          linuxDoEgressProbeRef.current?.stopped &&
          data.documentKey === linuxDoEgressProbeRef.current.documentKey
        )
          return;
        const isEgressDocument =
          canOpenLinuxDoPanel() &&
          webViewKey !== undefined &&
          /^https:\/\/linux\.do(?:\/|$)/.test(event.nativeEvent.url);
        if (data.type === 'linuxdo-egress-probe') {
          if (
            isEgressDocument &&
            data.documentKey === linuxDoEgressProbeRef.current?.documentKey &&
            !linuxDoEgressProbeRef.current?.stopped
          ) {
            linuxDoEgressProbeRef.current?.probe.receive(data);
          }
          return;
        }
        const pageStatus = data.status === 'logged-in' || data.status === 'logged-out' ? data.status : 'unknown';
        const hasChallengeMarker = typeof data.hasChallengeMarker === 'boolean' ? data.hasChallengeMarker : undefined;
        const trace = linuxDoVerificationTraceRef.current;
        if (trace) {
          markDiagnosticStage(trace, 'parse', {
            source: 'linuxdo',
            messageRecognized: data.type === 'linuxdo-webview',
            ...(data.type === 'linuxdo-webview' ? { pageStatus, hasChallengeMarker } : {}),
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
          const documentKey = data.documentKey;
          const webView = linuxDoWebViewRef.current;
          const clockSeparator = typeof documentKey === 'string' ? documentKey.lastIndexOf(':') : -1;
          const documentUrl = typeof documentKey === 'string' ? documentKey.slice(0, clockSeparator) : '';
          const documentClock = typeof documentKey === 'string' ? documentKey.slice(clockSeparator + 1) : '';
          // Android's WebMessageListener reports the sender origin; the legacy bridge reports its full URL.
          const hasDocumentKey =
            isEgressDocument &&
            typeof documentKey === 'string' &&
            documentKey.length <= 2048 &&
            /^https:\/\/linux\.do\//.test(documentUrl) &&
            (event.nativeEvent.url === 'https://linux.do' ||
              event.nativeEvent.url === 'https://linux.do/' ||
              event.nativeEvent.url === documentUrl) &&
            /^\d+(?:\.\d+)?$/.test(documentClock) &&
            Number.isFinite(Number(documentClock));
          if (fetcher && webView && !hasDocumentKey && trace) {
            markDiagnosticStage(trace, 'guard', { source: 'linuxdo', channel: 'webview', reason: 'invalid_response' });
          }
          if (fetcher && webView && hasDocumentKey && documentKey !== linuxDoEgressProbeRef.current?.documentKey) {
            cancelLinuxDoEgressProbe('navigation');
            const parentTrace = currentLinuxDoVerificationTrace('open');
            linuxDoEgressProbeRef.current = {
              documentKey,
              probe: startCloudflareEgressProbe({
                fetcher,
                userAgent,
                documentKey,
                parentTraceId: parentTrace.traceId,
                probeId: `${parentTrace.traceId}-egress-${++linuxDoEgressSequenceRef.current}`,
                injectJavaScript: (script) => webView.injectJavaScript(script)
              })
            };
          }
          if (hasDocumentKey) {
            linuxDoPageObservationRef.current = { documentKey, pageStatus, hasChallengeMarker, at: Date.now() };
            tryLinuxDoPostChallengeCheck();
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
    [
      canOpenLinuxDoPanel,
      cancelLinuxDoEgressProbe,
      commitLinuxDoWebViewUserAgent,
      currentLinuxDoVerificationTrace,
      fetcher,
      linuxDoWebViewRef,
      linuxDoWebViewSessionRef,
      isLinuxDoSurfaceVisible,
      tryLinuxDoPostChallengeCheck
    ]
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
      session.lastCheckTraceId = trace.traceId;
      publishRecovery();
      setChecking(true);
      nextLinuxDoWebViewSession('check');
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
        onLinuxDoSurfaceClosed({
          authoritativeResult: true,
          reason: 'authoritative-recovery',
          parentTraceId: trace.traceId
        });
        await awaitLinuxDoCookieHandoff();
        if (!current()) return;
        markDiagnosticStage(trace, 'apply', { source: 'linuxdo', state: 'resuming-read' });
        // Snapshot this check's targets; notifications arriving later wait for another explicit check.
        for (const target of [...session.targets]) {
          if (!current()) return;
          validateRecoveryTargets(session);
          if (target.outcome !== 'pending' && target.outcome !== 'verification-required') continue;
          markReadingRecovery(trace, target.recovery, 'resuming');
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
          markReadingRecovery(
            trace,
            target.recovery,
            target.outcome === 'verification-required' ? 'blocked' : target.outcome
          );
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
          markReadingRecovery(trace, target.recovery, 'failed');
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
    if (postChallengeCheckRef.current) postChallengeCheckRef.current.consumed = true;
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
    const linuxDoWebViewSession = nextLinuxDoWebViewSession('check');
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
      await handoffLinuxDoCookies(trace.traceId);
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
      await handoffLinuxDoCookies(trace.traceId);
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
  useCommitRefValue(checkLinuxDoCookieRef, checkLinuxDoCookie);

  const cancelLinuxDoCheckForInactiveApp = useCallback(() => {
    cancelLinuxDoEgressProbe('background');
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
    cancelLinuxDoEgressProbe,
    cancelRecoveryTarget,
    finishLinuxDoVerificationTrace,
    invalidateLinuxDoCheck,
    isLinuxDoSurfaceVisible,
    onLinuxDoSurfaceClosed,
    publishRecovery,
    setChecking
  ]);

  return {
    armLinuxDoPostChallengeCheck,
    beginLinuxDoDocumentNavigation,
    recordLinuxDoVerificationPageEvent,
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
