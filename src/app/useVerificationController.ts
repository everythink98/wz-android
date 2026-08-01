import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { sanitizeLinuxDoUserAgent } from '../linuxdoSession';
import type { SourceErrorInfo, Topic, TopicDetail } from '../types';
import { errorMessage } from '../appUtils';
import type { Screen } from '../appTypes';
import type { SiteSessionEvent } from '../siteSessionState';
import type { LoginWebViewFailureReason } from './accountCredentialDiagnostics';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '../diagnostics';
import { useCommitRefValue } from './useCommittedRef';
import { shouldOpenLoginWebViewUrl } from '../loginWebViewNavigation';
import { appQueryClient } from './serverState';
import type { AccountReconcileResult } from './useAccountStatusController';
import type { AuthSurfaceCloseReason } from '../authSurfaceCoordinator';

const LINUXDO_PANEL_CLOSE_SETTLE_MS = 350;

type Ref<T> = MutableRefObject<T>;

export type LinuxDoReadResumeOutcome = 'completed' | 'failed' | 'verification-required' | 'stale';
type LinuxDoVerificationPhase =
  'idle' | 'preparing' | 'awaiting-clearance' | 'checking-clearance' | 'resuming-read' | 'closing';

export type LinuxDoReadRecovery = {
  queryKey: QueryKey;
  resume: () => Promise<LinuxDoReadResumeOutcome>;
};

export function useLinuxDoIdentityVerificationPrompt({
  enabled = true,
  error,
  identityPending,
  intentKey,
  showLinuxDoVerification
}: {
  enabled?: boolean;
  error?: SourceErrorInfo;
  identityPending: boolean;
  intentKey: string | null;
  showLinuxDoVerification: (message?: string) => unknown;
}) {
  const handledIntentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!identityPending || !intentKey) {
      handledIntentRef.current = null;
      return;
    }
    if (!enabled) {
      handledIntentRef.current = intentKey;
      return;
    }
    if (error?.kind !== 'verification-required' || handledIntentRef.current === intentKey) {
      return;
    }
    handledIntentRef.current = intentKey;
    void showLinuxDoVerification(error.message);
  }, [enabled, error, identityPending, intentKey, showLinuxDoVerification]);
}

type ActiveLinuxDoReadRecovery = {
  generation: number;
  recovery: LinuxDoReadRecovery;
};

type QueuedLinuxDoVerification = {
  message: string;
  promise: Promise<boolean>;
  recovery?: LinuxDoReadRecovery;
  resolve: (accepted: boolean) => void;
};

function isActiveRecoveryQuery(recovery: LinuxDoReadRecovery) {
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
  changeNodeSeekLoginPanel,
  checkingRequestIdRef,
  closeYaohuoLoginPanel,
  linuxDoPanelClosingSessionRef,
  linuxDoPanelCloseSettleTimerRef,
  linuxDoWebViewMountTimerRef,
  linuxDoWebViewRef,
  linuxDoWebViewSessionRef,
  linuxDoWebViewUserAgentRef,
  linuxDoIdentityPending = false,
  notify,
  onBeforeLinuxDoSurfaceOpened = () => undefined,
  onLoginWebViewFailure,
  onLinuxDoRecoveryBarrierChanged = () => undefined,
  onLinuxDoSurfaceClosed = () => undefined,
  onLinuxDoSurfaceOpened = () => undefined,
  openTopicRef,
  reconcileAccountStatus,
  selectedTopic,
  setChecking,
  setLinuxDoWebViewError,
  setLinuxDoWebViewKey,
  setLinuxDoWebViewUserAgent,
  setLoadingLinuxDoPage,
  setMountLinuxDoWebView,
  changeScreen,
  setShowLinuxDoPanel,
  setShowSettingsPanel,
  showLinuxDoPanelRef,
  topicDetail,
  updateLinuxDoSession,
  updateNodeSeekSession
}: {
  changeNodeSeekLoginPanel: (visible: boolean, closeReason?: AuthSurfaceCloseReason) => void;
  checkingRequestIdRef: Ref<number>;
  closeYaohuoLoginPanel: (reason?: AuthSurfaceCloseReason) => void;
  linuxDoPanelClosingSessionRef: Ref<number | null>;
  linuxDoPanelCloseSettleTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewMountTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewRef: Ref<WebView | null>;
  linuxDoWebViewSessionRef: Ref<number>;
  linuxDoWebViewUserAgentRef: Ref<string>;
  linuxDoIdentityPending?: boolean;
  notify: (message: string) => void;
  onBeforeLinuxDoSurfaceOpened?: () => void;
  onLoginWebViewFailure: (site: 'linuxdo', attempt: number, reason: LoginWebViewFailureReason) => void;
  onLinuxDoRecoveryBarrierChanged?: (active: boolean) => void;
  onLinuxDoSurfaceClosed?: (options: { authoritativeResult: boolean; reason: AuthSurfaceCloseReason }) => void;
  onLinuxDoSurfaceOpened?: () => void;
  openTopicRef: Ref<((topic: Topic, refresh?: boolean) => Promise<unknown>) | null>;
  reconcileAccountStatus: (source: 'linuxdo') => Promise<AccountReconcileResult>;
  selectedTopic: Topic | null;
  setChecking: Dispatch<SetStateAction<boolean>>;
  setLinuxDoWebViewError: Dispatch<SetStateAction<string>>;
  setLinuxDoWebViewKey: Dispatch<SetStateAction<number>>;
  setLinuxDoWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setLoadingLinuxDoPage: Dispatch<SetStateAction<boolean>>;
  setMountLinuxDoWebView: Dispatch<SetStateAction<boolean>>;
  changeScreen: (screen: Screen) => void;
  setShowLinuxDoPanel: Dispatch<SetStateAction<boolean>>;
  setShowSettingsPanel: Dispatch<SetStateAction<boolean>>;
  showLinuxDoPanelRef: Ref<boolean>;
  topicDetail: TopicDetail | null;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
  updateNodeSeekSession: (event: SiteSessionEvent) => void;
}) {
  const linuxDoVerificationTraceRef = useRef<DiagnosticTrace | null>(null);
  const linuxDoVerificationPhaseRef = useRef<LinuxDoVerificationPhase>('idle');
  const linuxDoVerificationGenerationRef = useRef(0);
  const linuxDoTerminalWebViewSessionRef = useRef<number | null>(null);
  const linuxDoReadRecoveryRef = useRef<ActiveLinuxDoReadRecovery | null>(null);
  const linuxDoCanceledRecoveriesRef = useRef(new WeakSet<LinuxDoReadRecovery>());
  const linuxDoActiveCheckRef = useRef<number | null>(null);
  const queuedLinuxDoVerificationRef = useRef<QueuedLinuxDoVerification | null>(null);
  const showLinuxDoVerificationRef = useRef<
    ((message?: string, recovery?: LinuxDoReadRecovery) => Promise<boolean>) | null
  >(null);

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
        (value && showLinuxDoPanelRef.current ? currentLinuxDoVerificationTrace('open') : null);
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
      onLoginWebViewFailure,
      setLinuxDoWebViewError,
      showLinuxDoPanelRef
    ]
  );

  const resetLinuxDoWebView = useCallback(() => {
    if (linuxDoPanelClosingSessionRef.current !== null) {
      return;
    }
    const trace =
      linuxDoVerificationTraceRef.current ||
      (showLinuxDoPanelRef.current ? currentLinuxDoVerificationTrace('open') : null);
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
    linuxDoWebViewMountTimerRef.current = setTimeout(() => {
      linuxDoWebViewMountTimerRef.current = null;
      if (linuxDoWebViewSessionRef.current !== nextSession || !showLinuxDoPanelRef.current) {
        return;
      }
      setMountLinuxDoWebView(true);
    }, 80);
  }, [
    checkingRequestIdRef,
    currentLinuxDoVerificationTrace,
    linuxDoPanelClosingSessionRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    nextLinuxDoWebViewSession,
    setChecking,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPageForSession,
    setMountLinuxDoWebView,
    showLinuxDoPanelRef
  ]);

  const invalidateLinuxDoCheck = useCallback(() => {
    checkingRequestIdRef.current += 1;
    linuxDoActiveCheckRef.current = null;
    setChecking(false);
  }, [checkingRequestIdRef, setChecking]);

  const closeLinuxDoPanel = useCallback(
    (cancelCurrentRecovery = true, reason: AuthSurfaceCloseReason = 'close-button', authoritativeResult = false) => {
      if (!showLinuxDoPanelRef.current && linuxDoPanelClosingSessionRef.current === null) {
        return;
      }
      const activeRecovery = linuxDoReadRecoveryRef.current;
      if (cancelCurrentRecovery && activeRecovery) {
        linuxDoCanceledRecoveriesRef.current.add(activeRecovery.recovery);
      }
      linuxDoVerificationGenerationRef.current += 1;
      linuxDoVerificationPhaseRef.current = 'closing';
      linuxDoReadRecoveryRef.current = null;
      invalidateLinuxDoCheck();
      if (cancelCurrentRecovery) {
        const queuedRecovery = queuedLinuxDoVerificationRef.current;
        if (queuedRecovery?.recovery) {
          linuxDoCanceledRecoveriesRef.current.add(queuedRecovery.recovery);
        }
        queuedRecovery?.resolve(false);
        queuedLinuxDoVerificationRef.current = null;
        onLinuxDoRecoveryBarrierChanged(false);
      }
      const trace = linuxDoVerificationTraceRef.current;
      if (trace) {
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          state: 'linuxdo-panel-closed'
        });
        if (!authoritativeResult) {
          finishLinuxDoVerificationTrace(trace, 'canceled', { reason });
        }
      }
      if (linuxDoPanelClosingSessionRef.current !== null) {
        linuxDoWebViewRef.current?.stopLoading();
        setMountLinuxDoWebView(false);
        setLoadingLinuxDoPage(false);
        setLinuxDoWebViewError('');
        showLinuxDoPanelRef.current = false;
        setShowLinuxDoPanel(false);
        return;
      }
      const wasVisible = showLinuxDoPanelRef.current;
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
      showLinuxDoPanelRef.current = false;
      setShowLinuxDoPanel(false);
      if (wasVisible) {
        onLinuxDoSurfaceClosed({ authoritativeResult, reason });
      }

      const settleClosingPanel = () => {
        if (linuxDoPanelClosingSessionRef.current !== nextSession || showLinuxDoPanelRef.current) {
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
          onLinuxDoRecoveryBarrierChanged(false);
          queued.resolve(false);
          return;
        }
        const showQueued = showLinuxDoVerificationRef.current;
        if (!showQueued) {
          onLinuxDoRecoveryBarrierChanged(false);
          queued.resolve(false);
          return;
        }
        void showQueued(queued.message, queued.recovery).then(queued.resolve, () => {
          onLinuxDoRecoveryBarrierChanged(false);
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
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      linuxDoPanelCloseSettleTimerRef,
      linuxDoPanelClosingSessionRef,
      linuxDoWebViewMountTimerRef,
      linuxDoWebViewRef,
      nextLinuxDoWebViewSession,
      onLinuxDoRecoveryBarrierChanged,
      onLinuxDoSurfaceClosed,
      setLinuxDoWebViewError,
      setLinuxDoWebViewErrorForSession,
      setLoadingLinuxDoPage,
      setLoadingLinuxDoPageForSession,
      setMountLinuxDoWebView,
      setShowLinuxDoPanel,
      showLinuxDoPanelRef
    ]
  );

  const showNodeSeekVerification = useCallback(
    (message = 'NodeSeek 需要完成 Cloudflare 验证') => {
      closeLinuxDoPanel(true, 'switch-surface');
      changeScreen('more');
      changeNodeSeekLoginPanel(true);
      closeYaohuoLoginPanel('switch-surface');
      setShowSettingsPanel(false);
      updateNodeSeekSession({ type: 'verification-required', message });
      notify(message);
      return true;
    },
    [
      changeNodeSeekLoginPanel,
      changeScreen,
      closeLinuxDoPanel,
      closeYaohuoLoginPanel,
      notify,
      setShowSettingsPanel,
      updateNodeSeekSession
    ]
  );

  const changeLinuxDoPanel = useCallback(
    (visible: boolean) => {
      if (visible) {
        const trace = currentLinuxDoVerificationTrace('open');
        if (linuxDoPanelClosingSessionRef.current !== null) {
          markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'busy' });
          finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'busy' });
          return false;
        }
        onBeforeLinuxDoSurfaceOpened();
        markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'open' });
        if (linuxDoVerificationPhaseRef.current !== 'preparing') {
          const previousRecovery = linuxDoReadRecoveryRef.current;
          if (previousRecovery) {
            linuxDoCanceledRecoveriesRef.current.add(previousRecovery.recovery);
          }
          linuxDoVerificationGenerationRef.current += 1;
          invalidateLinuxDoCheck();
          linuxDoReadRecoveryRef.current = null;
          linuxDoVerificationPhaseRef.current = 'preparing';
        }
        const wasVisible = showLinuxDoPanelRef.current;
        showLinuxDoPanelRef.current = true;
        setShowLinuxDoPanel(true);
        if (!wasVisible) {
          onLinuxDoSurfaceOpened();
        }
        onLinuxDoRecoveryBarrierChanged(false);
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        resetLinuxDoWebView();
        return true;
      }
      closeLinuxDoPanel();
      return true;
    },
    [
      closeLinuxDoPanel,
      currentLinuxDoVerificationTrace,
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      linuxDoPanelClosingSessionRef,
      onBeforeLinuxDoSurfaceOpened,
      onLinuxDoRecoveryBarrierChanged,
      onLinuxDoSurfaceOpened,
      resetLinuxDoWebView,
      setShowLinuxDoPanel,
      showLinuxDoPanelRef
    ]
  );

  const showLinuxDoVerification = useCallback(
    async (message = 'linux.do 需要完成 Cloudflare 验证', recovery?: LinuxDoReadRecovery) => {
      if (recovery && (linuxDoCanceledRecoveriesRef.current.has(recovery) || !isActiveRecoveryQuery(recovery))) {
        return false;
      }
      if (linuxDoPanelClosingSessionRef.current !== null) {
        const previousQueued = queuedLinuxDoVerificationRef.current;
        if (previousQueued && previousQueued.recovery === recovery) {
          previousQueued.message = message;
          notify(message);
          return previousQueued.promise;
        }
        if (previousQueued?.recovery) {
          linuxDoCanceledRecoveriesRef.current.add(previousQueued.recovery);
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
        const previousRecovery = linuxDoReadRecoveryRef.current;
        if (previousRecovery && previousRecovery.recovery !== recovery) {
          linuxDoCanceledRecoveriesRef.current.add(previousRecovery.recovery);
        }
        const generation = ++linuxDoVerificationGenerationRef.current;
        invalidateLinuxDoCheck();
        linuxDoVerificationPhaseRef.current = 'preparing';
        const activeRecovery = { generation, recovery };
        linuxDoReadRecoveryRef.current = activeRecovery;
        const trace = startLinuxDoVerificationTrace('open');
        if (linuxDoReadRecoveryRef.current !== activeRecovery) {
          return false;
        }
        if (!isActiveRecoveryQuery(recovery)) {
          linuxDoReadRecoveryRef.current = null;
          linuxDoVerificationPhaseRef.current = 'idle';
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          return false;
        }
      }
      changeNodeSeekLoginPanel(false, 'switch-surface');
      closeYaohuoLoginPanel('switch-surface');
      setShowSettingsPanel(false);
      if (!changeLinuxDoPanel(true)) {
        return false;
      }
      updateLinuxDoSession({ type: 'verification-started', at: new Date().toISOString() });
      notify(message);
      return true;
    },
    [
      changeLinuxDoPanel,
      changeNodeSeekLoginPanel,
      closeYaohuoLoginPanel,
      finishLinuxDoVerificationTrace,
      invalidateLinuxDoCheck,
      linuxDoPanelClosingSessionRef,
      notify,
      setShowSettingsPanel,
      startLinuxDoVerificationTrace,
      updateLinuxDoSession
    ]
  );
  useCommitRefValue(showLinuxDoVerificationRef, showLinuxDoVerification);

  const verifyLinuxDoFromTopic = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (detail?.source === 'linuxdo' && !linuxDoIdentityPending) {
      await openTopicRef.current?.(detail, true);
      return;
    }
    await showLinuxDoVerification();
  }, [openTopicRef, linuxDoIdentityPending, selectedTopic, showLinuxDoVerification, topicDetail]);

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
      if (!showLinuxDoPanelRef.current) {
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
              data.type === 'linuxdo-webview' && typeof data.userAgent === 'string' ? 'webview' : 'default'
          });
        }
        if (data.type === 'linuxdo-webview') {
          setLinuxDoWebViewErrorForSession('', webViewKey);
        }
        if (data.type === 'linuxdo-webview' && typeof data.userAgent === 'string') {
          const userAgent = sanitizeLinuxDoUserAgent(data.userAgent);
          if (userAgent) {
            linuxDoWebViewUserAgentRef.current = userAgent;
            setLinuxDoWebViewUserAgent(userAgent);
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
      linuxDoWebViewSessionRef,
      linuxDoWebViewUserAgentRef,
      setLinuxDoWebViewErrorForSession,
      setLinuxDoWebViewUserAgent,
      showLinuxDoPanelRef
    ]
  );

  const checkLinuxDoCookie = useCallback(async () => {
    if (linuxDoActiveCheckRef.current !== null) {
      return;
    }
    const requestId = ++checkingRequestIdRef.current;
    linuxDoActiveCheckRef.current = requestId;
    const flowGeneration = linuxDoVerificationGenerationRef.current;
    const activeRecovery = linuxDoReadRecoveryRef.current;
    const trace = currentLinuxDoVerificationTrace('manual');
    markDiagnosticStage(trace, 'credential', {
      source: 'linuxdo',
      state: 'started'
    });
    const linuxDoWebViewSession = linuxDoWebViewSessionRef.current;
    const isCurrentLinuxDoCheck = () => {
      if (linuxDoActiveCheckRef.current !== requestId) {
        return false;
      }
      if (requestId !== checkingRequestIdRef.current) {
        return false;
      }
      if (linuxDoWebViewSession !== linuxDoWebViewSessionRef.current) {
        return false;
      }
      if (!showLinuxDoPanelRef.current) {
        return false;
      }
      if (flowGeneration !== linuxDoVerificationGenerationRef.current) {
        return false;
      }
      if (activeRecovery !== linuxDoReadRecoveryRef.current) {
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
      const result = await reconcileAccountStatus('linuxdo');
      if (!isCurrentLinuxDoCheck()) {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      if (result.status === 'stale') {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
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
        const message = 'linux.do 当前为未登录状态，请登录后再检测。';
        setLinuxDoWebViewError(message);
        notify(message);
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'login_required' });
        return;
      }
      updateLinuxDoSession({
        type: 'verification-succeeded',
        loggedIn: true,
        currentUser: result.session.currentUser,
        cookieSummary: result.session.cookieSummary,
        at: new Date().toISOString()
      });
      setLinuxDoWebViewError('');
      const recovery = activeRecovery?.recovery;
      const recoveryIsCurrent = Boolean(
        recovery &&
        activeRecovery &&
        linuxDoReadRecoveryRef.current === activeRecovery &&
        isActiveRecoveryQuery(recovery)
      );
      if (recovery && activeRecovery) {
        if (!recoveryIsCurrent) {
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          linuxDoReadRecoveryRef.current = null;
          closeLinuxDoPanel(false, 'authoritative-recovery', true);
          return;
        }
        linuxDoReadRecoveryRef.current = null;
        closeLinuxDoPanel(false, 'authoritative-recovery', true);
        const closedGeneration = linuxDoVerificationGenerationRef.current;
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          state: 'resuming-read'
        });
        linuxDoVerificationPhaseRef.current = 'resuming-read';
        let outcome: LinuxDoReadResumeOutcome;
        try {
          outcome = await recovery.resume();
        } catch (error) {
          if (linuxDoVerificationGenerationRef.current !== closedGeneration) {
            finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
            return;
          }
          const message = `登录身份已确认，但原页面恢复失败：${errorMessage(error)}`;
          updateLinuxDoSession({ type: 'check-failed', message });
          notify(message);
          finishLinuxDoVerificationTrace(trace, 'failure', {
            reason: normalizeDiagnosticReason(error)
          });
          return;
        }
        if (linuxDoVerificationGenerationRef.current !== closedGeneration) {
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          return;
        }
        if (outcome === 'verification-required') {
          const message = '验证仍未生效，请继续完成验证后点击检测状态。';
          updateLinuxDoSession({ type: 'verification-required', message });
          finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'verification_required' });
          if (isActiveRecoveryQuery(recovery)) {
            onLinuxDoRecoveryBarrierChanged(true);
            void showLinuxDoVerification(message, recovery);
          }
          return;
        }
        if (outcome === 'stale') {
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          return;
        }
        if (outcome === 'failed') {
          const message = '登录身份已确认，但原页面恢复失败，请返回原页面重试。';
          updateLinuxDoSession({ type: 'check-failed', message });
          notify(message);
          finishLinuxDoVerificationTrace(trace, 'failure', { reason: 'refresh_failed' });
          return;
        }
        notify('linux.do 身份已确认，页面已恢复。');
        finishLinuxDoVerificationTrace(trace, 'success', {
          hasCredential: true,
          isLoggedIn: true
        });
        return;
      }
      closeLinuxDoPanel(false, 'authoritative-recovery', true);
      notify('linux.do 登录身份已确认。');
      finishLinuxDoVerificationTrace(trace, 'success', {
        hasCredential: true,
        isLoggedIn: true
      });
    } catch (error) {
      if (isCurrentLinuxDoCheck()) {
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
    checkingRequestIdRef,
    closeLinuxDoPanel,
    currentLinuxDoVerificationTrace,
    finishLinuxDoVerificationTrace,
    linuxDoWebViewSessionRef,
    notify,
    onLinuxDoRecoveryBarrierChanged,
    reconcileAccountStatus,
    setChecking,
    setLinuxDoWebViewError,
    showLinuxDoVerification,
    showLinuxDoPanelRef,
    updateLinuxDoSession
  ]);
  const stopLinuxDoVerificationForInactiveApp = useCallback(() => {
    if (!showLinuxDoPanelRef.current) {
      return;
    }
    const trace = linuxDoVerificationTraceRef.current;
    if (trace) {
      markDiagnosticStage(trace, 'apply', {
        source: 'linuxdo',
        state: 'linuxdo-panel-closed'
      });
      finishLinuxDoVerificationTrace(trace, 'canceled', { reason: 'canceled' });
    }
    checkingRequestIdRef.current += 1;
    linuxDoActiveCheckRef.current = null;
    linuxDoWebViewSessionRef.current += 1;
    setLinuxDoWebViewKey(linuxDoWebViewSessionRef.current);
    if (linuxDoWebViewMountTimerRef.current) {
      clearTimeout(linuxDoWebViewMountTimerRef.current);
      linuxDoWebViewMountTimerRef.current = null;
    }
    linuxDoWebViewRef.current?.stopLoading();
    setMountLinuxDoWebView(false);
    setLoadingLinuxDoPage(false);
    setChecking(false);
  }, [
    checkingRequestIdRef,
    finishLinuxDoVerificationTrace,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    setChecking,
    setLinuxDoWebViewKey,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    showLinuxDoPanelRef
  ]);

  return {
    changeLinuxDoPanel,
    checkLinuxDoCookie,
    closeLinuxDoPanel,
    handleLinuxDoMessage,
    resetLinuxDoWebView,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPageForSession,
    showLinuxDoVerification,
    showNodeSeekVerification,
    stopLinuxDoVerificationForInactiveApp,
    verifyLinuxDoFromTopic
  };
}
