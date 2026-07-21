import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  buildLinuxDoCookieHeader,
  canAcceptLinuxDoAccessUpdate,
  canStoreLinuxDoAccess,
  canStoreLinuxDoClearance,
  canStoreLinuxDoLogin,
  clearLinuxDoAccessForGeneration,
  clearLinuxDoClearance,
  currentLinuxDoAccessGeneration,
  linuxDoAccessSummary,
  linuxDoClearanceValue,
  loadLinuxDoAccess,
  mergeLinuxDoCookies,
  parseLinuxDoDocumentCookie,
  readLinuxDoCookiesFromStores,
  saveLinuxDoAccess,
  sanitizeLinuxDoUserAgent,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import type { Topic, TopicDetail } from '../types';
import { errorMessage } from '../appUtils';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT } from '../loginWebViewScripts';
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
  linuxDoClearanceBeforeVerifyRef,
  linuxDoPanelClosingSessionRef,
  linuxDoPanelCloseSettleTimerRef,
  linuxDoRequireFreshClearanceRef,
  linuxDoWebViewCookieHeader,
  linuxDoWebViewCookieHeaderRef,
  linuxDoWebViewMountTimerRef,
  linuxDoWebViewRef,
  linuxDoWebViewSessionRef,
  linuxDoWebViewUserAgent,
  linuxDoWebViewUserAgentRef,
  notify,
  onLoginWebViewFailure,
  openTopicRef,
  resetLinuxDoLevelState,
  selectedTopic,
  setChecking,
  setLinuxDoWebViewCookieHeader,
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
  linuxDoClearanceBeforeVerifyRef: Ref<string | null>;
  linuxDoPanelClosingSessionRef: Ref<number | null>;
  linuxDoPanelCloseSettleTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoRequireFreshClearanceRef: Ref<boolean>;
  linuxDoWebViewCookieHeader: string;
  linuxDoWebViewCookieHeaderRef: Ref<string>;
  linuxDoWebViewMountTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewRef: Ref<WebView | null>;
  linuxDoWebViewSessionRef: Ref<number>;
  linuxDoWebViewUserAgent: string;
  linuxDoWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  onLoginWebViewFailure: (site: 'linuxdo', attempt: number, reason: LoginWebViewFailureReason) => void;
  openTopicRef: Ref<((topic: Topic, refresh?: boolean) => Promise<unknown>) | null>;
  resetLinuxDoLevelState: () => void;
  selectedTopic: Topic | null;
  setChecking: Dispatch<SetStateAction<boolean>>;
  setLinuxDoWebViewCookieHeader: Dispatch<SetStateAction<string>>;
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
  const linuxDoAutomaticResumeUsedRef = useRef(false);
  const linuxDoActiveCheckRef = useRef<number | null>(null);
  const linuxDoClearanceResetGenerationRef = useRef<number | null>(null);
  const linuxDoClearanceBaselineAvailableRef = useRef(false);
  const linuxDoLastAutomaticCheckKeyRef = useRef<string | null>(null);
  const linuxDoWebViewLoginStatusRef = useRef<LinuxDoWebViewLoginStatus>('unknown');
  const queuedLinuxDoVerificationRef = useRef<{ message: string; recovery?: LinuxDoReadRecovery } | null>(null);
  const checkLinuxDoCookieRef = useRef<(() => Promise<void>) | null>(null);
  const showLinuxDoVerificationRef = useRef<((message?: string, recovery?: LinuxDoReadRecovery) => Promise<void>) | null>(null);

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

  const refreshLinuxDoClearanceState = useCallback(async (activeRecovery?: ActiveLinuxDoReadRecovery) => {
    const access = await clearLinuxDoClearance();
    if (access === undefined) {
      return false;
    }
    linuxDoWebViewCookieHeaderRef.current = '';
    setLinuxDoWebViewCookieHeader('');
    const summary = linuxDoAccessSummary(access);
    const cookieSummary = summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(access?.cookieHeader || '')).names;
    const recoveryQueryKey = activeRecovery
      && linuxDoReadRecoveryRef.current === activeRecovery
      && isActiveRecoveryQuery(activeRecovery.recovery)
      ? activeRecovery.recovery.queryKey
      : undefined;
    updateLinuxDoSession(summary.hasClearance || summary.loggedIn
      ? {
        type: 'session-updated',
        cookieSummary,
        hasVerification: summary.hasClearance,
        loggedIn: summary.loggedIn,
        ...(recoveryQueryKey ? { recoveryQueryKey } : {}),
        at: new Date().toISOString()
      }
      : { type: 'cleared', ...(recoveryQueryKey ? { recoveryQueryKey } : {}) });
    resetLinuxDoLevelState();
    return true;
  }, [linuxDoWebViewCookieHeaderRef, resetLinuxDoLevelState, setLinuxDoWebViewCookieHeader, updateLinuxDoSession]);

  const rememberLinuxDoClearanceBeforeVerify = useCallback(async () => {
    const diagnosticTrace = linuxDoVerificationTraceRef.current || undefined;
    const [savedAccess, webViewCookies] = await Promise.all([
      loadLinuxDoAccess(),
      readLinuxDoCookiesFromStores({ diagnosticTrace }).catch(() => ({}))
    ]);
    const visibleCookies = parseLinuxDoDocumentCookie(linuxDoWebViewCookieHeaderRef.current || linuxDoWebViewCookieHeader);
    const cookies = mergeLinuxDoCookies(parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || ''), webViewCookies, visibleCookies);
    return linuxDoClearanceValue(cookies) || null;
  }, [linuxDoWebViewCookieHeader, linuxDoWebViewCookieHeaderRef]);

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
    linuxDoLastAutomaticCheckKeyRef.current = null;
    if (linuxDoWebViewMountTimerRef.current) {
      clearTimeout(linuxDoWebViewMountTimerRef.current);
      linuxDoWebViewMountTimerRef.current = null;
    }
    linuxDoWebViewRef.current?.stopLoading();
    setMountLinuxDoWebView(false);
    linuxDoWebViewCookieHeaderRef.current = '';
    setLinuxDoWebViewCookieHeader('');
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
    setLinuxDoWebViewCookieHeader,
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
    linuxDoAutomaticResumeUsedRef.current = false;
    linuxDoClearanceResetGenerationRef.current = null;
    linuxDoLastAutomaticCheckKeyRef.current = null;
    invalidateLinuxDoCheck();
    if (cancelCurrentRecovery) {
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
    linuxDoRequireFreshClearanceRef.current = false;
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
    setLinuxDoWebViewCookieHeader('');
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
        return;
      }
      void showLinuxDoVerificationRef.current?.(queued.message, queued.recovery);
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
    linuxDoRequireFreshClearanceRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    nextLinuxDoWebViewSession,
    setLinuxDoWebViewCookieHeader,
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
        const generation = ++linuxDoVerificationGenerationRef.current;
        invalidateLinuxDoCheck();
        linuxDoReadRecoveryRef.current = null;
        linuxDoAutomaticResumeUsedRef.current = false;
        linuxDoClearanceResetGenerationRef.current = null;
        linuxDoLastAutomaticCheckKeyRef.current = null;
        linuxDoVerificationPhaseRef.current = 'preparing';
        linuxDoRequireFreshClearanceRef.current = false;
        linuxDoClearanceBaselineAvailableRef.current = false;
        linuxDoClearanceBeforeVerifyRef.current = null;
        void rememberLinuxDoClearanceBeforeVerify().then((clearance) => {
          if (
            linuxDoVerificationGenerationRef.current === generation
            && !linuxDoReadRecoveryRef.current
            && !linuxDoClearanceBaselineAvailableRef.current
            && linuxDoVerificationPhaseRef.current !== 'closing'
            && linuxDoVerificationPhaseRef.current !== 'idle'
          ) {
            linuxDoClearanceBeforeVerifyRef.current = clearance;
            linuxDoClearanceBaselineAvailableRef.current = true;
          }
        }).catch(() => {
          if (
            linuxDoVerificationGenerationRef.current === generation
            && !linuxDoReadRecoveryRef.current
            && !linuxDoClearanceBaselineAvailableRef.current
            && linuxDoVerificationPhaseRef.current !== 'closing'
            && linuxDoVerificationPhaseRef.current !== 'idle'
          ) {
            linuxDoClearanceBeforeVerifyRef.current = null;
            linuxDoClearanceBaselineAvailableRef.current = false;
            markDiagnosticStage(trace, 'credential', {
              source: 'linuxdo',
              state: 'baseline-unavailable',
              reason: 'storage_error'
            });
          }
        });
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
    linuxDoClearanceBeforeVerifyRef,
    linuxDoPanelClosingSessionRef,
    linuxDoRequireFreshClearanceRef,
    rememberLinuxDoClearanceBeforeVerify,
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
      return;
    }
    if (linuxDoPanelClosingSessionRef.current !== null) {
      const previousQueuedRecovery = queuedLinuxDoVerificationRef.current?.recovery;
      if (previousQueuedRecovery && previousQueuedRecovery !== recovery) {
        linuxDoCanceledRecoveriesRef.current.add(previousQueuedRecovery);
      }
      queuedLinuxDoVerificationRef.current = { message, recovery };
      notify(message);
      return;
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
      linuxDoAutomaticResumeUsedRef.current = false;
      linuxDoClearanceResetGenerationRef.current = null;
      linuxDoLastAutomaticCheckKeyRef.current = null;
      const trace = startLinuxDoVerificationTrace('open');
      linuxDoRequireFreshClearanceRef.current = true;
      const abandonPreparation = (outcome: 'failure' | 'stale', reason: 'stale' | 'storage_error') => {
        if (linuxDoReadRecoveryRef.current !== activeRecovery) {
          return false;
        }
        linuxDoReadRecoveryRef.current = null;
        linuxDoAutomaticResumeUsedRef.current = false;
        linuxDoClearanceResetGenerationRef.current = null;
        linuxDoLastAutomaticCheckKeyRef.current = null;
        linuxDoRequireFreshClearanceRef.current = false;
        linuxDoClearanceBaselineAvailableRef.current = false;
        linuxDoClearanceBeforeVerifyRef.current = null;
        linuxDoVerificationPhaseRef.current = 'idle';
        finishLinuxDoVerificationTrace(trace, outcome, { reason });
        return true;
      };
      const failPreparation = () => {
        const recoveryIsCurrent = isActiveRecoveryQuery(recovery);
        const abandoned = abandonPreparation(
          recoveryIsCurrent ? 'failure' : 'stale',
          recoveryIsCurrent ? 'storage_error' : 'stale'
        );
        if (abandoned && recoveryIsCurrent) {
          notify('linux.do 验证准备失败，请重试。');
        }
      };
      let clearanceBeforeVerify: string | null;
      try {
        clearanceBeforeVerify = await rememberLinuxDoClearanceBeforeVerify();
      } catch {
        failPreparation();
        return;
      }
      if (linuxDoReadRecoveryRef.current !== activeRecovery) {
        return;
      }
      if (!isActiveRecoveryQuery(recovery)) {
        abandonPreparation('stale', 'stale');
        return;
      }
      linuxDoClearanceBeforeVerifyRef.current = clearanceBeforeVerify;
      linuxDoClearanceBaselineAvailableRef.current = true;
      let clearanceReset: boolean;
      try {
        clearanceReset = await refreshLinuxDoClearanceState(activeRecovery);
      } catch {
        failPreparation();
        return;
      }
      if (linuxDoReadRecoveryRef.current !== activeRecovery) {
        return;
      }
      if (!clearanceReset) {
        failPreparation();
        return;
      }
      if (!isActiveRecoveryQuery(recovery)) {
        abandonPreparation('stale', 'stale');
        return;
      }
      linuxDoClearanceResetGenerationRef.current = generation;
    }
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    setShowSettingsPanel(false);
    if (!changeLinuxDoPanel(true)) {
      return;
    }
    updateLinuxDoSession({ type: 'verification-started', at: new Date().toISOString() });
    notify(message);
  }, [
    changeLinuxDoPanel,
    changeNodeSeekLoginPanel,
    closeYaohuoLoginPanel,
    finishLinuxDoVerificationTrace,
    invalidateLinuxDoCheck,
    linuxDoClearanceBeforeVerifyRef,
    linuxDoPanelClosingSessionRef,
    linuxDoRequireFreshClearanceRef,
    notify,
    refreshLinuxDoClearanceState,
    rememberLinuxDoClearanceBeforeVerify,
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
        linuxDoWebViewLoginStatusRef.current = data.status === 'logged-in' || data.status === 'logged-out'
          ? data.status
          : 'unknown';
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
        setLinuxDoWebViewCookieHeader(data.cookie);
        const activeRecovery = linuxDoReadRecoveryRef.current;
        if (
          activeRecovery
          && linuxDoVerificationPhaseRef.current === 'awaiting-clearance'
          && !linuxDoAutomaticResumeUsedRef.current
          && linuxDoActiveCheckRef.current === null
        ) {
          const automaticCheckKey = [
            webViewKey ?? linuxDoWebViewSessionRef.current,
            activeRecovery.generation,
            data.documentKey || '',
            data.status || '',
            data.cookie
          ].join(':');
          if (linuxDoLastAutomaticCheckKeyRef.current !== automaticCheckKey) {
            linuxDoLastAutomaticCheckKeyRef.current = automaticCheckKey;
            void checkLinuxDoCookieRef.current?.();
          }
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
  }, [
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgentRef,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewErrorForSession,
    setLinuxDoWebViewUserAgent,
    showLinuxDoPanelRef
  ]);

  const probeLinuxDoPage = useCallback(async () => {
    linuxDoWebViewLoginStatusRef.current = 'unknown';
    const trace = linuxDoVerificationTraceRef.current;
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'linuxdo',
        channel: 'webview',
        state: 'started'
      });
    }
    linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (trace && linuxDoVerificationTraceRef.current === trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'linuxdo',
        channel: 'webview',
        state: 'complete'
      });
    }
  }, [linuxDoWebViewRef]);

  const readCurrentLinuxDoCookies = useCallback(async () => {
    await probeLinuxDoPage();
    const diagnosticTrace = linuxDoVerificationTraceRef.current || undefined;
    const [savedAccess, nativeCookies] = await Promise.all([
      loadLinuxDoAccess(),
      readLinuxDoCookiesFromStores({ diagnosticTrace })
    ]);
    const linuxDoDocumentCookieHeader = linuxDoWebViewCookieHeaderRef.current || linuxDoWebViewCookieHeader;
    return mergeLinuxDoCookies(
      parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || ''),
      nativeCookies,
      parseLinuxDoDocumentCookie(linuxDoDocumentCookieHeader)
    );
  }, [linuxDoWebViewCookieHeader, linuxDoWebViewCookieHeaderRef, probeLinuxDoPage]);

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
        let message = 'linux.do 登录已失效，请重新登录。';
        try {
          const expectedAccess = await loadLinuxDoAccess();
          if (!isCurrentLinuxDoCheck() || currentLinuxDoAccessGeneration() !== accessGeneration) {
            finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
            return;
          }
          const remainingAccess = await clearLinuxDoAccessForGeneration(accessGeneration, expectedAccess?.cookieHeader);
          if (!isCurrentLinuxDoCheck() || currentLinuxDoAccessGeneration() !== accessGeneration) {
            finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
            return;
          }
          const remainingHeader = remainingAccess?.cookieHeader || '';
          linuxDoWebViewCookieHeaderRef.current = remainingHeader;
          setLinuxDoWebViewCookieHeader(remainingHeader);
        } catch (error) {
          if (!isCurrentLinuxDoCheck() || currentLinuxDoAccessGeneration() !== accessGeneration) {
            finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
            return;
          }
          message = 'linux.do 登录已失效，本机 Cookie 清理未完成，请重试。';
          markDiagnosticStage(trace, 'persist', {
            source: 'linuxdo',
            state: 'partial',
            reason: normalizeDiagnosticReason(error)
          });
        }
        resetLinuxDoLevelState();
        updateLinuxDoSession({ type: 'login-expired', message });
        setLinuxDoWebViewError(message);
        notify(message);
        linuxDoVerificationPhaseRef.current = 'awaiting-clearance';
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'login_required' });
        return;
      }
      const summary = summarizeLinuxDoCookies(cookies);
      const cookieHeader = buildLinuxDoCookieHeader(cookies);
      const hasCredential = canStoreLinuxDoAccess(cookies) && Boolean(cookieHeader);
      const hasAcceptableCredential = (
        linuxDoClearanceBaselineAvailableRef.current
          ? canAcceptLinuxDoAccessUpdate(
            cookies,
            linuxDoClearanceBeforeVerifyRef.current,
            linuxDoRequireFreshClearanceRef.current
          )
          : canStoreLinuxDoLogin(cookies)
      ) || Boolean(activeRecovery && linuxDoClearanceResetGenerationRef.current === activeRecovery.generation);
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
        resetLinuxDoLevelState();
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
      resetLinuxDoLevelState();
      setLinuxDoWebViewError('');
      linuxDoClearanceBeforeVerifyRef.current = linuxDoClearanceValue(cookies);
      linuxDoClearanceBaselineAvailableRef.current = true;
      linuxDoRequireFreshClearanceRef.current = false;
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
        loggedIn: summary.loggedIn,
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
        linuxDoAutomaticResumeUsedRef.current = true;
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
          loggedIn: summary.loggedIn,
          at: new Date().toISOString()
        });
        notify(summary.loggedIn ? 'linux.do 登录信息已保存，页面已恢复。' : 'linux.do 验证成功，页面已恢复。');
        finishLinuxDoVerificationTrace(trace, 'success', {
          hasCredential: true,
          isLoggedIn: summary.loggedIn
        });
        linuxDoReadRecoveryRef.current = null;
        closeLinuxDoPanel(false);
        return;
      }
      notify(summary.loggedIn ? 'linux.do 登录信息已保存在本机。' : 'linux.do 验证信息已保存在本机。');
      finishLinuxDoVerificationTrace(trace, 'success', {
        hasCredential: true,
        isLoggedIn: summary.loggedIn
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
    linuxDoClearanceBeforeVerifyRef,
    linuxDoRequireFreshClearanceRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgent,
    linuxDoWebViewUserAgentRef,
    notify,
    resetLinuxDoLevelState,
    setChecking,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewError,
    showLinuxDoPanelRef,
    updateLinuxDoSession,
    waitForLinuxDoClearance
  ]);
  useCommitRefValue(checkLinuxDoCookieRef, checkLinuxDoCookie);

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
    linuxDoLastAutomaticCheckKeyRef.current = null;
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
    refreshLinuxDoClearanceState,
    rememberLinuxDoClearanceBeforeVerify,
    resetLinuxDoWebView,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPageForSession,
    showLinuxDoVerification,
    showNodeSeekVerification,
    stopLinuxDoVerificationForInactiveApp,
    verifyLinuxDoFromTopic
  };
}
