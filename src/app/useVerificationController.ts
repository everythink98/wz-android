import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  buildLinuxDoCookieHeader,
  canStoreLinuxDoAccess,
  canStoreLinuxDoClearance,
  currentLinuxDoAccessGeneration,
  readLinuxDoCookiesFromStores,
  saveLinuxDoAccess,
  sanitizeLinuxDoUserAgent,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import type { Topic, TopicDetail } from '../types';
import { errorMessage } from '../appUtils';
import { linuxDoWebViewProbeScript } from '../loginWebViewScripts';
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

const LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS = 5000;
const LINUXDO_CLEARANCE_DETECT_INTERVAL_MS = 500;
const LINUXDO_PANEL_CLOSE_SETTLE_MS = 350;

type Ref<T> = MutableRefObject<T>;
type LinuxDoWebViewLoginStatus = 'logged-in' | 'logged-out' | 'unknown';

export type LinuxDoReadResumeOutcome = 'completed' | 'failed' | 'verification-required' | 'stale';
type LinuxDoVerificationPhase = 'idle' | 'preparing' | 'awaiting-clearance' | 'checking-clearance' | 'resuming-read' | 'closing';

export type LinuxDoReadRecovery = {
  queryKey: QueryKey;
  resume: () => Promise<LinuxDoReadResumeOutcome>;
};

type ActiveLinuxDoReadRecovery = {
  generation: number;
  recovery: LinuxDoReadRecovery;
};

type ActiveLinuxDoWebViewProbe = {
  id: number;
  webViewSession: number;
  settle: () => void;
};

type QueuedLinuxDoVerification = {
  message: string;
  promise: Promise<boolean>;
  recovery?: LinuxDoReadRecovery;
  resolve: (accepted: boolean) => void;
};

function isActiveRecoveryQuery(recovery: LinuxDoReadRecovery) {
  return appQueryClient.getQueryCache().find({
    queryKey: recovery.queryKey,
    exact: true
  })?.isActive() === true;
}

export function useVerificationController({
  changeNodeSeekLoginPanel,
  checkingRequestIdRef,
  closeYaohuoLoginPanel,
  linuxDoPanelClosingSessionRef,
  linuxDoPanelCloseSettleTimerRef,
  linuxDoWebViewCookieHeaderRef,
  linuxDoWebViewMountTimerRef,
  linuxDoWebViewRef,
  linuxDoWebViewSessionRef,
  linuxDoWebViewUserAgent,
  linuxDoWebViewUserAgentRef,
  notify,
  onLoginWebViewFailure,
  openTopicRef,
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
  changeNodeSeekLoginPanel: (visible: boolean) => void;
  checkingRequestIdRef: Ref<number>;
  closeYaohuoLoginPanel: () => void;
  linuxDoPanelClosingSessionRef: Ref<number | null>;
  linuxDoPanelCloseSettleTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewCookieHeaderRef: Ref<string>;
  linuxDoWebViewMountTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewRef: Ref<WebView | null>;
  linuxDoWebViewSessionRef: Ref<number>;
  linuxDoWebViewUserAgent: string;
  linuxDoWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  onLoginWebViewFailure: (site: 'linuxdo', attempt: number, reason: LoginWebViewFailureReason) => void;
  openTopicRef: Ref<((topic: Topic, refresh?: boolean) => Promise<unknown>) | null>;
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
  const linuxDoWebViewLoginStatusRef = useRef<LinuxDoWebViewLoginStatus>('unknown');
  const linuxDoWebViewProbeIdRef = useRef(0);
  const linuxDoActiveWebViewProbeRef = useRef<ActiveLinuxDoWebViewProbe | null>(null);
  const queuedLinuxDoVerificationRef = useRef<QueuedLinuxDoVerification | null>(null);
  const showLinuxDoVerificationRef = useRef<((message?: string, recovery?: LinuxDoReadRecovery) => Promise<boolean>) | null>(null);

  const finishLinuxDoVerificationTrace = useCallback((
    trace: DiagnosticTrace,
    outcome: DiagnosticOutcome,
    fields: DiagnosticFields = {}
  ) => {
    if (linuxDoVerificationTraceRef.current !== trace) {
      return;
    }
    finishDiagnosticTrace(trace, outcome, { source: 'linuxdo', ...fields });
    linuxDoVerificationTraceRef.current = null;
  }, []);

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

  const currentLinuxDoVerificationTrace = useCallback((mode: 'open' | 'manual' = 'manual') => {
    return linuxDoVerificationTraceRef.current || startLinuxDoVerificationTrace(mode);
  }, [startLinuxDoVerificationTrace]);

  const nextLinuxDoWebViewSession = useCallback(() => {
    const nextSession = linuxDoWebViewSessionRef.current + 1;
    linuxDoWebViewSessionRef.current = nextSession;
    setLinuxDoWebViewKey(nextSession);
    return nextSession;
  }, [linuxDoWebViewSessionRef, setLinuxDoWebViewKey]);

  const setLoadingLinuxDoPageForSession = useCallback((value: boolean, webViewKey?: number) => {
    if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
      return;
    }
    if (value) {
      linuxDoActiveWebViewProbeRef.current?.settle();
      linuxDoActiveWebViewProbeRef.current = null;
      linuxDoWebViewLoginStatusRef.current = 'unknown';
    }
    setLoadingLinuxDoPage(value);
    const trace = linuxDoVerificationTraceRef.current;
    if (!value && trace) {
      markDiagnosticStage(trace, 'transport', { source: 'linuxdo', channel: 'webview', state: 'ready' });
    }
  }, [linuxDoWebViewSessionRef, setLoadingLinuxDoPage]);

  const setLinuxDoWebViewErrorForSession = useCallback((value: string, webViewKey?: number, credentialAttempt = 0) => {
    if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
      return;
    }
    setLinuxDoWebViewError(value);
    const session = webViewKey ?? linuxDoWebViewSessionRef.current;
    if (value && linuxDoTerminalWebViewSessionRef.current === session) {
      return;
    }
    const trace = linuxDoVerificationTraceRef.current
      || (value && showLinuxDoPanelRef.current ? currentLinuxDoVerificationTrace('open') : null);
    if (value) {
      linuxDoTerminalWebViewSessionRef.current = session;
      const reason: LoginWebViewFailureReason = value.includes('已停止') ? 'renderer_gone' : value.includes('超时') ? 'timeout' : 'network_error';
      if (trace) {
        markDiagnosticStage(trace, 'transport', { source: 'linuxdo', channel: 'webview', state: 'failure', reason });
        finishLinuxDoVerificationTrace(trace, 'failure', { reason });
      }
      onLoginWebViewFailure('linuxdo', credentialAttempt, reason);
    }
  }, [currentLinuxDoVerificationTrace, finishLinuxDoVerificationTrace, linuxDoWebViewSessionRef, onLoginWebViewFailure, setLinuxDoWebViewError, showLinuxDoPanelRef]);

  const resetLinuxDoWebView = useCallback(() => {
    if (linuxDoPanelClosingSessionRef.current !== null) {
      return;
    }
    const trace = linuxDoVerificationTraceRef.current
      || (showLinuxDoPanelRef.current ? currentLinuxDoVerificationTrace('open') : null);
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
    linuxDoWebViewCookieHeaderRef.current = '';
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
    linuxDoWebViewCookieHeaderRef,
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
    linuxDoActiveWebViewProbeRef.current?.settle();
    linuxDoActiveWebViewProbeRef.current = null;
    setChecking(false);
  }, [checkingRequestIdRef, setChecking]);

  const closeLinuxDoPanel = useCallback((
    cancelCurrentRecovery = true,
    reason: 'canceled' | 'superseded' = 'canceled'
  ) => {
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
    }
    const trace = linuxDoVerificationTraceRef.current;
    if (trace) {
      markDiagnosticStage(trace, 'apply', {
        source: 'linuxdo',
        state: 'linuxdo-panel-closed'
      });
      finishLinuxDoVerificationTrace(trace, 'canceled', { reason });
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
    linuxDoWebViewCookieHeaderRef.current = '';
    setLoadingLinuxDoPageForSession(false, nextSession);
    setLinuxDoWebViewErrorForSession('', nextSession);
    showLinuxDoPanelRef.current = false;
    setShowLinuxDoPanel(false);

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
      if (queued.recovery && (
        linuxDoCanceledRecoveriesRef.current.has(queued.recovery)
        || !isActiveRecoveryQuery(queued.recovery)
      )) {
        queued.resolve(false);
        return;
      }
      const showQueued = showLinuxDoVerificationRef.current;
      if (!showQueued) {
        queued.resolve(false);
        return;
      }
      void showQueued(queued.message, queued.recovery).then(
        queued.resolve,
        () => queued.resolve(false)
      );
    };

    if (!wasVisible) {
      settleClosingPanel();
      return;
    }
    linuxDoPanelCloseSettleTimerRef.current = setTimeout(() => {
      linuxDoPanelCloseSettleTimerRef.current = null;
      settleClosingPanel();
    }, LINUXDO_PANEL_CLOSE_SETTLE_MS);
  }, [
    finishLinuxDoVerificationTrace,
    invalidateLinuxDoCheck,
    linuxDoPanelCloseSettleTimerRef,
    linuxDoPanelClosingSessionRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    nextLinuxDoWebViewSession,
    setLinuxDoWebViewError,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPage,
    setLoadingLinuxDoPageForSession,
    setMountLinuxDoWebView,
    setShowLinuxDoPanel,
    showLinuxDoPanelRef
  ]);

  const showNodeSeekVerification = useCallback((message = 'NodeSeek 需要完成 Cloudflare 验证') => {
    closeLinuxDoPanel(true, 'superseded');
    changeScreen('more');
    changeNodeSeekLoginPanel(true);
    closeYaohuoLoginPanel();
    setShowSettingsPanel(false);
    updateNodeSeekSession({ type: 'verification-required', message });
    notify(message);
  }, [changeNodeSeekLoginPanel, changeScreen, closeLinuxDoPanel, closeYaohuoLoginPanel, notify, setShowSettingsPanel, updateNodeSeekSession]);

  const changeLinuxDoPanel = useCallback((visible: boolean) => {
    if (visible) {
      const trace = currentLinuxDoVerificationTrace('open');
      if (linuxDoPanelClosingSessionRef.current !== null) {
        markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'busy' });
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'busy' });
        return false;
      }
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
      showLinuxDoPanelRef.current = true;
      setShowLinuxDoPanel(true);
      linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
      resetLinuxDoWebView();
      return true;
    }
    closeLinuxDoPanel();
    return true;
  }, [
    closeLinuxDoPanel,
    currentLinuxDoVerificationTrace,
    finishLinuxDoVerificationTrace,
    invalidateLinuxDoCheck,
    linuxDoPanelClosingSessionRef,
    resetLinuxDoWebView,
    setShowLinuxDoPanel,
    showLinuxDoPanelRef
  ]);

  const showLinuxDoVerification = useCallback(async (
    message = 'linux.do 需要完成 Cloudflare 验证',
    recovery?: LinuxDoReadRecovery
  ) => {
    if (recovery && (
      linuxDoCanceledRecoveriesRef.current.has(recovery)
      || !isActiveRecoveryQuery(recovery)
    )) {
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
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    setShowSettingsPanel(false);
    if (!changeLinuxDoPanel(true)) {
      return false;
    }
    updateLinuxDoSession({ type: 'verification-started', at: new Date().toISOString() });
    notify(message);
    return true;
  }, [
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
  ]);
  useCommitRefValue(showLinuxDoVerificationRef, showLinuxDoVerification);

  const verifyLinuxDoFromTopic = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (detail?.source === 'linuxdo') {
      await openTopicRef.current?.(detail, true);
      return;
    }
    await showLinuxDoVerification();
  }, [
    openTopicRef,
    selectedTopic,
    showLinuxDoVerification,
    topicDetail
  ]);

  const handleLinuxDoMessage = useCallback((event: WebViewMessageEvent, webViewKey?: number) => {
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
        probeId?: number;
        documentKey?: string;
        status?: LinuxDoWebViewLoginStatus;
        loggedIn?: boolean;
        userAgent?: string;
        cookie?: string;
      };
      const trace = linuxDoVerificationTraceRef.current;
      if (trace) {
        markDiagnosticStage(trace, 'parse', {
          source: 'linuxdo',
          messageRecognized: data.type === 'linuxdo-webview',
          hasCredential: data.type === 'linuxdo-webview' && typeof data.cookie === 'string',
          userAgentSource: data.type === 'linuxdo-webview' && typeof data.userAgent === 'string' ? 'webview' : 'default'
        });
      }
      if (data.type === 'linuxdo-webview') {
        const activeProbe = linuxDoActiveWebViewProbeRef.current;
        const documentKey = typeof data.documentKey === 'string' ? data.documentKey : '';
        const documentKeySeparator = documentKey.lastIndexOf(':');
        const documentUrl = documentKeySeparator > 0
          ? documentKey.slice(0, documentKeySeparator)
          : '';
        const documentTimeOriginValue = documentKeySeparator > 0
          ? documentKey.slice(documentKeySeparator + 1)
          : '';
        const documentTimeOrigin = Number(documentTimeOriginValue);
        const probeMatches = Boolean(
          activeProbe
          && data.probeId === activeProbe.id
          && activeProbe.webViewSession === linuxDoWebViewSessionRef.current
          && documentTimeOriginValue.length > 0
          && Number.isFinite(documentTimeOrigin)
          && documentUrl
          && shouldOpenLoginWebViewUrl(documentUrl, ['linux.do'])
        );
        if (probeMatches && activeProbe) {
          linuxDoWebViewLoginStatusRef.current = data.status === 'logged-in' || data.status === 'logged-out'
            ? data.status
            : 'unknown';
          linuxDoActiveWebViewProbeRef.current = null;
          activeProbe.settle();
        }
        setLinuxDoWebViewErrorForSession('', webViewKey);
      }
      if (data.type === 'linuxdo-webview' && typeof data.userAgent === 'string') {
        const userAgent = sanitizeLinuxDoUserAgent(data.userAgent);
        if (userAgent) {
          linuxDoWebViewUserAgentRef.current = userAgent;
          setLinuxDoWebViewUserAgent(userAgent);
        }
      }
      if (data.type === 'linuxdo-webview' && typeof data.cookie === 'string') {
        linuxDoWebViewCookieHeaderRef.current = data.cookie;
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
  }, [
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgentRef,
    setLinuxDoWebViewErrorForSession,
    setLinuxDoWebViewUserAgent,
    showLinuxDoPanelRef
  ]);

  const probeLinuxDoPage = useCallback(async () => {
    linuxDoWebViewLoginStatusRef.current = 'unknown';
    const webView = linuxDoWebViewRef.current;
    if (!webView) {
      return;
    }
    linuxDoActiveWebViewProbeRef.current?.settle();
    linuxDoActiveWebViewProbeRef.current = null;
    const probeId = linuxDoWebViewProbeIdRef.current + 1;
    linuxDoWebViewProbeIdRef.current = probeId;
    let resolveProbe: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let isSettled = false;
    const activeProbe: ActiveLinuxDoWebViewProbe = {
      id: probeId,
      webViewSession: linuxDoWebViewSessionRef.current,
      settle: () => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        if (timeout !== null) {
          clearTimeout(timeout);
          timeout = null;
        }
        resolveProbe();
      }
    };
    linuxDoActiveWebViewProbeRef.current = activeProbe;
    const trace = linuxDoVerificationTraceRef.current;
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'linuxdo',
        channel: 'webview',
        state: 'started'
      });
    }
    timeout = setTimeout(() => {
      if (linuxDoActiveWebViewProbeRef.current === activeProbe) {
        linuxDoActiveWebViewProbeRef.current = null;
      }
      activeProbe.settle();
    }, LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS);
    try {
      webView.injectJavaScript(linuxDoWebViewProbeScript(probeId));
      await settled;
    } finally {
      if (linuxDoActiveWebViewProbeRef.current === activeProbe) {
        linuxDoActiveWebViewProbeRef.current = null;
      }
      activeProbe.settle();
      if (trace && linuxDoVerificationTraceRef.current === trace) {
        markDiagnosticStage(trace, 'transport', {
          source: 'linuxdo',
          channel: 'webview',
          state: 'complete'
        });
      }
    }
  }, [linuxDoWebViewRef, linuxDoWebViewSessionRef]);

  const readCurrentLinuxDoCookies = useCallback(async () => {
    await probeLinuxDoPage();
    const diagnosticTrace = linuxDoVerificationTraceRef.current || undefined;
    return readLinuxDoCookiesFromStores({ diagnosticTrace });
  }, [probeLinuxDoPage]);

  const waitForLinuxDoClearance = useCallback(async () => {
    const deadline = Date.now() + LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS;
    let cookies = await readCurrentLinuxDoCookies();
    while (Date.now() < deadline) {
      if (linuxDoWebViewLoginStatusRef.current === 'logged-out' || canStoreLinuxDoClearance(cookies)) {
        return cookies;
      }
      await new Promise((resolve) => setTimeout(resolve, LINUXDO_CLEARANCE_DETECT_INTERVAL_MS));
      cookies = await readCurrentLinuxDoCookies();
    }
    return cookies;
  }, [readCurrentLinuxDoCookies]);

  const checkLinuxDoCookie = useCallback(async () => {
    if (linuxDoActiveCheckRef.current !== null) {
      return;
    }
    const requestId = ++checkingRequestIdRef.current;
    linuxDoActiveCheckRef.current = requestId;
    const flowGeneration = linuxDoVerificationGenerationRef.current;
    const accessGeneration = currentLinuxDoAccessGeneration();
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
      const cookies = await waitForLinuxDoClearance();
      if (!isCurrentLinuxDoCheck()) {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      if (linuxDoWebViewLoginStatusRef.current === 'logged-out') {
        if (currentLinuxDoAccessGeneration() !== accessGeneration) {
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          return;
        }
        const message = 'linux.do 登录已失效，请重新登录。';
        updateLinuxDoSession({ type: 'login-expired', message });
        setLinuxDoWebViewError(message);
        notify(message);
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'login_required' });
        return;
      }
      const loginConfirmed = linuxDoWebViewLoginStatusRef.current === 'logged-in';
      const summary = summarizeLinuxDoCookies(cookies);
      const cookieHeader = buildLinuxDoCookieHeader(cookies);
      const hasCredential = canStoreLinuxDoAccess(cookies) && Boolean(cookieHeader);
      const hasAcceptableCredential = hasCredential;
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        count: summary.names.length,
        hasCredential
      });
      if (!canStoreLinuxDoAccess(cookies) || !cookieHeader || !hasAcceptableCredential) {
        updateLinuxDoSession({
          type: 'verification-required',
          message: '没有检测到新的 linux.do 验证信息。'
        });
        notify('没有检测到新的 linux.do 验证信息。请完成验证后再试。');
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'missing_credential' });
        return;
      }
      markDiagnosticStage(trace, 'persist', {
        source: 'linuxdo',
        state: 'started',
        hasCredential: true
      });
      const savedAccess = await saveLinuxDoAccess(cookieHeader, linuxDoWebViewUserAgentRef.current || linuxDoWebViewUserAgent || undefined);
      if (!savedAccess) {
        finishLinuxDoVerificationTrace(trace, isCurrentLinuxDoCheck() ? 'failure' : 'stale', {
          reason: isCurrentLinuxDoCheck() ? 'storage_error' : 'stale'
        });
        return;
      }
      if (!isCurrentLinuxDoCheck()) {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      markDiagnosticStage(trace, 'persist', {
        source: 'linuxdo',
        state: 'saved',
        hasCredential: true
      });
      setLinuxDoWebViewError('');
      const recovery = activeRecovery?.recovery;
      const recoveryIsCurrent = Boolean(
        recovery
        && activeRecovery
        && linuxDoReadRecoveryRef.current === activeRecovery
        && isActiveRecoveryQuery(recovery)
      );
      updateLinuxDoSession({
        type: 'session-updated',
        cookieSummary: summary.names,
        hasVerification: summary.hasClearance,
        loggedIn: loginConfirmed,
        ...(recoveryIsCurrent && recovery ? { recoveryQueryKey: recovery.queryKey } : {}),
        at: new Date().toISOString()
      });
      if (recovery && activeRecovery) {
        if (!recoveryIsCurrent) {
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          linuxDoReadRecoveryRef.current = null;
          closeLinuxDoPanel(false);
          return;
        }
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          state: 'resuming-read'
        });
        linuxDoVerificationPhaseRef.current = 'resuming-read';
        const outcome = await recovery.resume();
        if (!isCurrentLinuxDoCheck() || linuxDoReadRecoveryRef.current !== activeRecovery) {
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          return;
        }
        if (outcome === 'verification-required') {
          updateLinuxDoSession({
            type: 'verification-required',
            message: '验证仍未生效，请继续完成验证后点击检测状态。'
          });
          setLinuxDoWebViewError('验证仍未生效，请继续完成验证后点击检测状态。');
          notify('linux.do 验证仍未生效，请继续验证后点击检测状态。');
          linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
          finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'verification_required' });
          return;
        }
        if (outcome === 'stale') {
          finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
          linuxDoReadRecoveryRef.current = null;
          closeLinuxDoPanel(false);
          return;
        }
        if (outcome === 'failed') {
          const message = '验证信息已保存，但原页面恢复失败，请点击检测状态重试。';
          updateLinuxDoSession({ type: 'verification-required', message });
          setLinuxDoWebViewError(message);
          notify(message);
          linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
          finishLinuxDoVerificationTrace(trace, 'failure', { reason: 'refresh_failed' });
          return;
        }
        updateLinuxDoSession({
          type: 'verification-succeeded',
          cookieSummary: summary.names,
          loggedIn: loginConfirmed,
          at: new Date().toISOString()
        });
        notify(loginConfirmed ? 'linux.do 登录信息已保存，页面已恢复。' : 'linux.do 验证成功，页面已恢复。');
        finishLinuxDoVerificationTrace(trace, 'success', {
          hasCredential: true,
          isLoggedIn: loginConfirmed
        });
        linuxDoReadRecoveryRef.current = null;
        closeLinuxDoPanel(false);
        return;
      }
      notify(loginConfirmed ? 'linux.do 登录信息已保存在本机。' : 'linux.do 验证信息已保存在本机。');
      finishLinuxDoVerificationTrace(trace, 'success', {
        hasCredential: true,
        isLoggedIn: loginConfirmed
      });
      linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
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
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgent,
    linuxDoWebViewUserAgentRef,
    notify,
    setChecking,
    setLinuxDoWebViewError,
    showLinuxDoPanelRef,
    updateLinuxDoSession,
    waitForLinuxDoClearance
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
