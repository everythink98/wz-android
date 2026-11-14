import { hashKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { sanitizeWebViewUserAgent, diagnosticUserAgentHash } from '@/platform/android/userAgent';
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
import {
  waitForLinuxDoLoginInitialization,
  type LinuxDoLoginPage
} from '@/platform/network/linuxDoLoginInitialization';
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

type PostChallengePhase = 'armed' | 'waiting' | 'consumed';

type PostChallengeCheck =
  | { phase: 'unarmed' }
  | {
      phase: PostChallengePhase;
      webViewKey: number;
      generation: number;
      scope: string;
      documentKey?: string;
    };

type LinuxDoDocumentState = {
  automatic: PostChallengeCheck;
  observation: { phase: 'unobserved' } | { phase: 'observed'; page: LinuxDoLoginPage & { at: number } };
  probe:
    | { phase: 'empty' }
    | { phase: 'active' | 'stopped'; documentKey: string; probe: ReturnType<typeof startCloudflareEgressProbe> };
};

function observedLinuxDoPage(observation: LinuxDoDocumentState['observation']) {
  return observation.phase === 'observed' ? observation.page : null;
}

function probeDocumentKey(probe: LinuxDoDocumentState['probe']) {
  return probe.phase === 'empty' ? undefined : probe.documentKey;
}

type LinuxDoVerificationPhase = 'idle' | 'preparing' | 'awaiting-clearance' | 'checking-clearance';

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
  phase: Exclude<LinuxDoRecoveryPanel['phase'], 'idle'>;
  dedicated: boolean;
  targets: RecoveryTarget[];
  lastCheckTraceId?: string;
};

type LinuxDoCheckOwner = {
  requestId: number;
  generation: number;
  webViewSession: number;
} & ({ kind: 'account' } | { kind: 'recovery'; session: RecoverySession });

type QueuedLinuxDoVerification =
  | { phase: 'empty' }
  | { phase: 'login-pending'; trace: DiagnosticTrace }
  | {
      phase: 'verification-pending';
      trace: DiagnosticTrace;
      message: string;
      promise: Promise<boolean>;
      recovery?: LinuxDoReadRecovery;
      resolve: (accepted: boolean) => void;
    };

type LinuxDoCloseHandoff = {
  closing: { phase: 'idle' } | { phase: 'closing'; session: number };
  request: QueuedLinuxDoVerification;
  timer: ReturnType<typeof setTimeout> | null;
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
  linuxDoWebViewMountTimerRef,
  linuxDoWebViewRef,
  linuxDoWebViewSessionRef,
  isLinuxDoSurfaceVisible,
  notify,
  onQueuedLinuxDoLoginCanceled = () => undefined,
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
  linuxDoWebViewMountTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewRef: Ref<WebView | null>;
  linuxDoWebViewSessionRef: Ref<number>;
  isLinuxDoSurfaceVisible: () => boolean;
  notify: (message: string) => void;
  onQueuedLinuxDoLoginCanceled?: () => void;
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
  const linuxDoDocumentRef = useRef<LinuxDoDocumentState>({
    automatic: { phase: 'unarmed' },
    observation: { phase: 'unobserved' },
    probe: { phase: 'empty' }
  });
  const linuxDoInitializationConfirmedRef = useRef(false);
  const linuxDoTerminalWebViewSessionRef = useRef<number | null>(null);
  const recoverySessionRef = useRef<RecoverySession | null>(null);
  const canceledQueriesRef = useRef(new WeakMap<object, number | undefined>());
  const linuxDoCanceledRecoveriesRef = useRef(new WeakSet<LinuxDoReadRecovery>());
  const linuxDoActiveCheckRef = useRef<LinuxDoCheckOwner | null>(null);
  const checkLinuxDoCookieRef = useRef<() => Promise<void>>(async () => undefined);
  const linuxDoCloseRef = useRef<LinuxDoCloseHandoff>({
    closing: { phase: 'idle' },
    request: { phase: 'empty' },
    timer: null
  });
  const onQueuedLinuxDoLoginCanceledRef = useRef(onQueuedLinuxDoLoginCanceled);
  useCommitRefValue(onQueuedLinuxDoLoginCanceledRef, onQueuedLinuxDoLoginCanceled);
  const changeLinuxDoPanelRef = useRef<(visible: boolean) => boolean>(() => false);
  const showLinuxDoVerificationRef = useRef<
    ((message?: string, recovery?: LinuxDoReadRecovery) => Promise<boolean>) | null
  >(null);

  const cancelLinuxDoEgressProbe = useCallback(
    (reason: NonNullable<DiagnosticFields['egressCheckpoint']>, forgetDocument = true) => {
      const automatic = linuxDoDocumentRef.current.automatic;
      const current = linuxDoDocumentRef.current.probe;
      // The expected CDK -> forum navigation precedes binding the returned document.
      if (
        automatic.phase !== 'unarmed' &&
        (reason !== 'navigation' ||
          current.phase !== 'empty' ||
          linuxDoDocumentRef.current.observation.phase === 'observed')
      )
        automatic.phase = 'consumed';
      const trace = linuxDoVerificationTraceRef.current;
      const snapshot = current.phase === 'empty' ? undefined : current.probe.snapshot();
      const page = observedLinuxDoPage(linuxDoDocumentRef.current.observation);
      if (trace && (reason === 'check' || current.phase === 'active')) {
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
      if (current.phase === 'active') current.probe.cancel(reason);
      linuxDoDocumentRef.current.probe =
        forgetDocument || current.phase === 'empty' ? { phase: 'empty' } : { ...current, phase: 'stopped' };
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
      const queued = linuxDoCloseRef.current.request;
      if (queued.phase !== 'empty')
        finishDiagnosticTrace(queued.trace, 'canceled', { source: 'linuxdo', reason: 'canceled' });
      if (queued.phase === 'verification-pending') {
        if (queued.recovery) cancelRecoveryTarget({ recovery: queued.recovery });
        queued.resolve(false);
      }
      linuxDoCloseRef.current.request = { phase: 'empty' };
      if (linuxDoVerificationTraceRef.current) {
        finishDiagnosticTrace(linuxDoVerificationTraceRef.current, 'canceled', {
          source: 'linuxdo',
          reason: 'canceled'
        });
        linuxDoVerificationTraceRef.current = null;
      }
      if (linuxDoWebViewMountTimerRef.current) clearTimeout(linuxDoWebViewMountTimerRef.current);
      if (linuxDoCloseRef.current.timer) clearTimeout(linuxDoCloseRef.current.timer);
    },
    [cancelLinuxDoEgressProbe, cancelRecoveryTarget, checkingRequestIdRef, linuxDoWebViewMountTimerRef]
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
    const automatic = linuxDoDocumentRef.current.automatic;
    const page = observedLinuxDoPage(linuxDoDocumentRef.current.observation);
    const probe = linuxDoDocumentRef.current.probe;
    if (
      automatic.phase !== 'armed' ||
      !page ||
      page.pageStatus === 'unknown' ||
      page.hasChallengeMarker !== false ||
      (probe.phase !== 'empty' && (probe.phase === 'stopped' || probe.documentKey !== page.documentKey))
    )
      return;
    automatic.documentKey = page.documentKey;
    automatic.phase = 'waiting';
    // A diagnostic failure or timeout is still a completion, never a business verdict.
    void ((probe.phase === 'empty' ? undefined : probe.probe.settled) || Promise.resolve()).then(() => {
      if (automatic.phase === 'waiting') automatic.phase = 'armed';
      const currentPage = observedLinuxDoPage(linuxDoDocumentRef.current.observation);
      if (
        linuxDoDocumentRef.current.automatic !== automatic ||
        automatic.phase === 'consumed' ||
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
      automatic.phase = 'consumed';
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
        (linuxDoDocumentRef.current.automatic.phase !== 'unarmed' &&
          linuxDoDocumentRef.current.automatic.webViewKey === webViewKey) ||
        linuxDoActiveCheckRef.current !== null ||
        (recoverySessionRef.current && recoverySessionRef.current.phase !== 'web')
      )
        return;
      linuxDoDocumentRef.current.automatic = {
        webViewKey,
        generation: linuxDoVerificationGenerationRef.current,
        scope: getRecoveryScope(),
        phase: 'armed'
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
      linuxDoDocumentRef.current.observation = { phase: 'unobserved' };
      if (reason !== 'check') linuxDoInitializationConfirmedRef.current = false;
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

  const invalidateLinuxDoCheck = useCallback(() => {
    checkingRequestIdRef.current += 1;
    linuxDoActiveCheckRef.current = null;
    setChecking(false);
  }, [checkingRequestIdRef, setChecking]);

  const beginLinuxDoDocumentNavigation = useCallback(
    (webViewKey: number) => {
      if (webViewKey !== linuxDoWebViewSessionRef.current || !isLinuxDoSurfaceVisible() || !canOpenLinuxDoPanel())
        return;
      cancelLinuxDoEgressProbe('navigation', false);
      linuxDoDocumentRef.current.observation = { phase: 'unobserved' };
      linuxDoInitializationConfirmedRef.current = false;
      if (linuxDoActiveCheckRef.current !== null) {
        invalidateLinuxDoCheck();
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        const trace = linuxDoVerificationTraceRef.current;
        if (trace) finishLinuxDoVerificationTrace(trace, 'canceled', { reason: 'stale' });
      }
    },
    [
      cancelLinuxDoEgressProbe,
      canOpenLinuxDoPanel,
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      isLinuxDoSurfaceVisible,
      linuxDoWebViewSessionRef
    ]
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
      linuxDoCloseRef.current.closing.phase === 'closing' ||
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

  const closeLinuxDoPanel = useCallback(
    (cancelCurrentRecovery = true, reason: AuthSurfaceCloseReason = 'close-button', authoritativeResult = false) => {
      const session = recoverySessionRef.current;
      if (!isLinuxDoSurfaceVisible() && !session && linuxDoCloseRef.current.closing.phase === 'idle') return;
      const page = observedLinuxDoPage(linuxDoDocumentRef.current.observation);
      // The page permits cookie handoff; Account still confirms identity after unmount.
      const initializedDocument =
        page?.pageStatus === 'logged-in' && page.hasSessionInitialization === true && page.hasChallengeMarker === false;
      if (
        !authoritativeResult &&
        reason !== 'authoritative-recovery' &&
        reason !== 'source-disabled' &&
        !linuxDoInitializationConfirmedRef.current &&
        !initializedDocument
      )
        reason = 'initialization-incomplete';
      cancelLinuxDoEgressProbe('close');
      if (session && cancelCurrentRecovery) {
        session.targets.filter((target) => target.outcome !== 'completed').forEach(cancelRecoveryTarget);
        if (session.targets.some((target) => 'kind' in target.recovery && target.outcome !== 'completed'))
          notify('本次阅读同步已停止，未确认的请求不会重发。');
      }
      recoverySessionRef.current = null;
      if (linuxDoCloseRef.current.closing.phase === 'idle') {
        publishRecovery();
        linuxDoVerificationGenerationRef.current += 1;
        invalidateLinuxDoCheck();
      }
      if (cancelCurrentRecovery) {
        const queuedRecovery = linuxDoCloseRef.current.request;
        if (queuedRecovery.phase !== 'empty')
          finishDiagnosticTrace(queuedRecovery.trace, 'canceled', {
            source: 'linuxdo',
            reason: 'canceled',
            closeReason: reason
          });
        if (queuedRecovery.phase === 'verification-pending') {
          if (queuedRecovery.recovery) cancelRecoveryTarget({ recovery: queuedRecovery.recovery });
          queuedRecovery.resolve(false);
        } else if (queuedRecovery.phase === 'login-pending') onQueuedLinuxDoLoginCanceledRef.current();
        linuxDoCloseRef.current.request = { phase: 'empty' };
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
      if (linuxDoCloseRef.current.closing.phase === 'closing') {
        try {
          linuxDoWebViewRef.current?.stopLoading();
        } finally {
          setMountLinuxDoWebView(false);
          setLoadingLinuxDoPage(false);
          setLinuxDoWebViewError('');
        }
        return;
      }
      const wasVisible = isLinuxDoSurfaceVisible();
      const nextSession = nextLinuxDoWebViewSession('close');
      linuxDoCloseRef.current.closing = { phase: 'closing', session: nextSession };
      if (linuxDoWebViewMountTimerRef.current) {
        clearTimeout(linuxDoWebViewMountTimerRef.current);
        linuxDoWebViewMountTimerRef.current = null;
      }
      if (linuxDoCloseRef.current.timer) {
        clearTimeout(linuxDoCloseRef.current.timer);
        linuxDoCloseRef.current.timer = null;
      }
      const settleClosingPanel = () => {
        if (
          linuxDoCloseRef.current.closing.phase !== 'closing' ||
          linuxDoCloseRef.current.closing.session !== nextSession ||
          isLinuxDoSurfaceVisible()
        ) {
          return;
        }
        linuxDoCloseRef.current.closing = { phase: 'idle' };
        linuxDoVerificationPhaseRef.current = 'idle';
        const queued = linuxDoCloseRef.current.request;
        linuxDoCloseRef.current.request = { phase: 'empty' };
        if (queued.phase === 'empty') {
          return;
        }
        if (queued.phase === 'login-pending') {
          const opened = changeLinuxDoPanelRef.current(true);
          finishDiagnosticTrace(queued.trace, opened ? 'success' : 'blocked', {
            source: 'linuxdo',
            state: opened ? 'open' : 'disabled',
            isRecovery: false,
            ...(opened ? {} : { reason: 'source_disabled' })
          });
          if (!opened) onQueuedLinuxDoLoginCanceledRef.current();
          return;
        }
        if (
          queued.recovery &&
          (linuxDoCanceledRecoveriesRef.current.has(queued.recovery) || !isActiveRecoveryQuery(queued.recovery))
        ) {
          finishDiagnosticTrace(queued.trace, 'stale', { source: 'linuxdo', reason: 'stale' });
          queued.resolve(false);
          return;
        }
        const showQueued = showLinuxDoVerificationRef.current;
        if (!showQueued) {
          finishDiagnosticTrace(queued.trace, 'blocked', { source: 'linuxdo', reason: 'not_ready' });
          queued.resolve(false);
          return;
        }
        markDiagnosticStage(queued.trace, 'apply', { source: 'linuxdo', state: 'resuming' });
        void showQueued(queued.message, queued.recovery).then(
          (accepted) => {
            finishDiagnosticTrace(queued.trace, accepted ? 'success' : 'blocked', {
              source: 'linuxdo',
              state: accepted ? 'open' : 'read-blocked',
              isRecovery: Boolean(queued.recovery),
              ...(accepted ? {} : { reason: 'not_ready' })
            });
            queued.resolve(accepted);
          },
          (error) => {
            finishDiagnosticTrace(queued.trace, 'failure', {
              source: 'linuxdo',
              reason: normalizeDiagnosticReason(error)
            });
            queued.resolve(false);
          }
        );
      };

      try {
        linuxDoWebViewRef.current?.stopLoading();
      } finally {
        setMountLinuxDoWebView(false);
        setLoadingLinuxDoPageForSession(false, nextSession);
        setLinuxDoWebViewErrorForSession('', nextSession);
        if (wasVisible) {
          onLinuxDoSurfaceClosed({ authoritativeResult, reason });
          linuxDoCloseRef.current.timer = setTimeout(() => {
            linuxDoCloseRef.current.timer = null;
            settleClosingPanel();
          }, LINUXDO_PANEL_CLOSE_SETTLE_MS);
        } else {
          settleClosingPanel();
        }
      }
    },
    [
      cancelLinuxDoEgressProbe,
      cancelRecoveryTarget,
      publishRecovery,
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      isLinuxDoSurfaceVisible,
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
        if (linuxDoCloseRef.current.closing.phase === 'closing') {
          const queued = linuxDoCloseRef.current.request;
          if (queued.phase === 'verification-pending') {
            finishDiagnosticTrace(queued.trace, 'canceled', { source: 'linuxdo', reason: 'superseded' });
            if (queued.recovery) cancelRecoveryTarget({ recovery: queued.recovery });
            queued.resolve(false);
          }
          linuxDoCloseRef.current.request = {
            phase: 'login-pending',
            trace:
              queued.phase === 'login-pending'
                ? queued.trace
                : beginDiagnosticTrace('webview', 'open', {
                    source: 'linuxdo',
                    state: 'queued',
                    isRecovery: false
                  })
          };
          markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'queued' });
          return true;
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
      onBeforeLinuxDoSurfaceOpened,
      onLinuxDoSurfaceOpened,
      resetLinuxDoWebView
    ]
  );
  useCommitRefValue(changeLinuxDoPanelRef, changeLinuxDoPanel);

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
      if (linuxDoCloseRef.current.closing.phase === 'closing') {
        const previousQueued = linuxDoCloseRef.current.request;
        if (previousQueued.phase === 'verification-pending' && previousQueued.recovery === recovery) {
          markDiagnosticStage(previousQueued.trace, 'guard', {
            source: 'linuxdo',
            reason: 'duplicate',
            state: 'queued'
          });
          previousQueued.message = message;
          notify(message);
          return previousQueued.promise;
        }
        if (previousQueued.phase !== 'empty')
          finishDiagnosticTrace(previousQueued.trace, 'canceled', { source: 'linuxdo', reason: 'superseded' });
        if (previousQueued.phase === 'verification-pending') {
          if (previousQueued.recovery) cancelRecoveryTarget({ recovery: previousQueued.recovery });
          previousQueued.resolve(false);
        } else if (previousQueued.phase === 'login-pending') onQueuedLinuxDoLoginCanceledRef.current();
        let resolveQueued!: (accepted: boolean) => void;
        const queuedPromise = new Promise<boolean>((resolve) => {
          resolveQueued = resolve;
        });
        linuxDoCloseRef.current.request = {
          phase: 'verification-pending',
          trace: beginDiagnosticTrace('webview', 'recover', {
            source: 'linuxdo',
            state: 'queued',
            isRecovery: Boolean(recovery)
          }),
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
          hasSessionInitialization?: unknown;
        };
        if (
          data.type === 'linuxdo-webview' &&
          linuxDoDocumentRef.current.probe.phase === 'stopped' &&
          data.documentKey === linuxDoDocumentRef.current.probe.documentKey
        )
          return;
        const isEgressDocument =
          canOpenLinuxDoPanel() &&
          webViewKey !== undefined &&
          /^https:\/\/linux\.do(?:\/|$)/.test(event.nativeEvent.url);
        if (data.type === 'linuxdo-egress-probe') {
          if (
            isEgressDocument &&
            data.documentKey === probeDocumentKey(linuxDoDocumentRef.current.probe) &&
            linuxDoDocumentRef.current.probe.phase !== 'stopped'
          ) {
            const currentProbe = linuxDoDocumentRef.current.probe;
            if (currentProbe.phase !== 'empty') currentProbe.probe.receive(data);
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
              ? { userAgentHash: diagnosticUserAgentHash(sanitizeWebViewUserAgent(data.userAgent)) }
              : {})
          });
        }
        if (data.type === 'linuxdo-webview' && typeof data.userAgent === 'string') {
          const userAgent = sanitizeWebViewUserAgent(data.userAgent);
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
          if (
            fetcher &&
            webView &&
            hasDocumentKey &&
            documentKey !== probeDocumentKey(linuxDoDocumentRef.current.probe)
          ) {
            cancelLinuxDoEgressProbe('navigation');
            const parentTrace = currentLinuxDoVerificationTrace('open');
            linuxDoDocumentRef.current.probe = {
              phase: 'active',
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
            linuxDoDocumentRef.current.observation = {
              phase: 'observed',
              page: {
                documentKey,
                pageStatus,
                hasChallengeMarker,
                hasSessionInitialization: data.hasSessionInitialization === true,
                at: Date.now()
              }
            };
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
      if (session.phase !== 'web' || !canOpenLinuxDoPanel() || linuxDoActiveCheckRef.current !== null) return;
      const check: LinuxDoCheckOwner = {
        kind: 'recovery',
        session,
        requestId: ++checkingRequestIdRef.current,
        generation: linuxDoVerificationGenerationRef.current,
        webViewSession: linuxDoWebViewSessionRef.current
      };
      linuxDoActiveCheckRef.current = check;
      const current = () =>
        recoverySessionRef.current === check.session &&
        (session.phase === 'web' || session.phase === 'checking') &&
        linuxDoActiveCheckRef.current === check &&
        checkingRequestIdRef.current === check.requestId &&
        linuxDoWebViewSessionRef.current === check.webViewSession &&
        check.generation === linuxDoVerificationGenerationRef.current &&
        session.scope === getRecoveryScope() &&
        (session.phase === 'checking' || isLinuxDoSurfaceVisible()) &&
        canOpenLinuxDoPanel();
      const trace = currentLinuxDoVerificationTrace('manual');
      session.lastCheckTraceId = trace.traceId;
      setChecking(true);
      setLinuxDoWebViewError('');
      try {
        if (
          !(await waitForLinuxDoLoginInitialization(
            () => observedLinuxDoPage(linuxDoDocumentRef.current.observation),
            current
          )) ||
          !current()
        )
          return;
        linuxDoInitializationConfirmedRef.current = true;
        session.phase = 'checking';
        publishRecovery();
        check.webViewSession = nextLinuxDoWebViewSession('check');
        if (linuxDoWebViewMountTimerRef.current) {
          clearTimeout(linuxDoWebViewMountTimerRef.current);
          linuxDoWebViewMountTimerRef.current = null;
        }
        linuxDoWebViewRef.current?.stopLoading();
        setMountLinuxDoWebView(false);
        setLoadingLinuxDoPage(false);
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
        if (session.phase === 'web') {
          setLinuxDoWebViewError(errorMessage(error));
          finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'identity_pending' });
          return;
        }
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
        if (linuxDoActiveCheckRef.current === check) {
          linuxDoActiveCheckRef.current = null;
          setChecking(false);
        }
      }
    },
    [
      awaitLinuxDoCookieHandoff,
      awaitLinuxDoWebViewUnmount,
      canOpenLinuxDoPanel,
      checkingRequestIdRef,
      cancelRecoveryTarget,
      closeLinuxDoPanel,
      currentLinuxDoVerificationTrace,
      finishLinuxDoVerificationTrace,
      getRecoveryScope,
      isLinuxDoSurfaceVisible,
      linuxDoWebViewSessionRef,
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
    const automatic = linuxDoDocumentRef.current.automatic;
    if (automatic.phase !== 'unarmed') automatic.phase = 'consumed';
    const session = recoverySessionRef.current;
    if (session) return checkRecovery(session);
    if (!canOpenLinuxDoPanel() || !isLinuxDoSurfaceVisible()) return;
    if (linuxDoActiveCheckRef.current !== null) {
      return;
    }
    const check: LinuxDoCheckOwner = {
      kind: 'account',
      requestId: ++checkingRequestIdRef.current,
      generation: linuxDoVerificationGenerationRef.current,
      webViewSession: linuxDoWebViewSessionRef.current
    };
    linuxDoActiveCheckRef.current = check;
    const trace = currentLinuxDoVerificationTrace('manual');
    markDiagnosticStage(trace, 'credential', {
      source: 'linuxdo',
      state: 'started'
    });
    const isCurrentLinuxDoCheck = () => {
      if (!canOpenLinuxDoPanel()) return false;
      if (linuxDoActiveCheckRef.current !== check) {
        return false;
      }
      if (check.requestId !== checkingRequestIdRef.current) {
        return false;
      }
      if (check.webViewSession !== linuxDoWebViewSessionRef.current) {
        return false;
      }
      if (!isLinuxDoSurfaceVisible()) {
        return false;
      }
      if (check.generation !== linuxDoVerificationGenerationRef.current) {
        return false;
      }
      if (linuxDoCloseRef.current.closing.phase === 'closing' || linuxDoVerificationPhaseRef.current === 'idle') {
        return false;
      }
      return true;
    };
    setChecking(true);
    linuxDoVerificationPhaseRef.current = 'checking-clearance';
    setLinuxDoWebViewError('');
    try {
      if (
        !(await waitForLinuxDoLoginInitialization(
          () => observedLinuxDoPage(linuxDoDocumentRef.current.observation),
          isCurrentLinuxDoCheck
        )) ||
        !isCurrentLinuxDoCheck()
      )
        return;
      linuxDoInitializationConfirmedRef.current = true;
      check.webViewSession = nextLinuxDoWebViewSession('check');
      if (linuxDoWebViewMountTimerRef.current) {
        clearTimeout(linuxDoWebViewMountTimerRef.current);
        linuxDoWebViewMountTimerRef.current = null;
      }
      linuxDoWebViewRef.current?.stopLoading();
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPage(false);
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
      if (linuxDoActiveCheckRef.current === check) {
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
    if (linuxDoCloseRef.current.request.phase === 'login-pending') {
      finishDiagnosticTrace(linuxDoCloseRef.current.request.trace, 'canceled', {
        source: 'linuxdo',
        reason: 'canceled',
        state: 'background'
      });
      linuxDoCloseRef.current.request = { phase: 'empty' };
      const trace = linuxDoVerificationTraceRef.current;
      if (trace) finishLinuxDoVerificationTrace(trace, 'canceled', { reason: 'canceled' });
      onQueuedLinuxDoLoginCanceledRef.current();
    }
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
