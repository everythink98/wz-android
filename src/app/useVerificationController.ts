import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { InteractionManager } from 'react-native';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  buildLinuxDoCookieHeader,
  canAcceptLinuxDoAccessUpdate,
  canStoreLinuxDoAccess,
  canStoreLinuxDoClearance,
  clearLinuxDoSavedClearance,
  clearLinuxDoWebViewClearance,
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
import { topicKey } from '../readerData';
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

const LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS = 5000;
const LINUXDO_CLEARANCE_DETECT_INTERVAL_MS = 500;
const LINUXDO_PANEL_CLOSE_SETTLE_MS = 350;

export type DeferredNavigationTask = ReturnType<typeof InteractionManager.runAfterInteractions>;
type Ref<T> = MutableRefObject<T>;

export function useVerificationController({
  cancelLinuxDoPendingReopenTask,
  changeNodeSeekLoginPanel,
  checkingRequestIdRef,
  closeYaohuoLoginPanel,
  linuxDoClearanceBeforeVerifyRef,
  linuxDoDismissedVerificationTopicKeyRef,
  linuxDoPanelClosingSessionRef,
  linuxDoPanelCloseSettleTimerRef,
  linuxDoPendingReopenTaskRef,
  linuxDoPendingReopenTopicAfterCloseRef,
  linuxDoPendingTopicVerifiedRef,
  linuxDoRequireFreshClearanceRef,
  linuxDoVerifiedRetryTopicKeyRef,
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
  pendingLinuxDoTopicRef,
  reopenExistingTopicScreenRef,
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
  showLinuxDoPanel,
  showLinuxDoPanelRef,
  topicDetail,
  updateLinuxDoSession,
  updateNodeSeekSession
}: {
  cancelLinuxDoPendingReopenTask: () => void;
  changeNodeSeekLoginPanel: (visible: boolean) => void;
  checkingRequestIdRef: Ref<number>;
  closeYaohuoLoginPanel: () => void;
  linuxDoClearanceBeforeVerifyRef: Ref<string | null>;
  linuxDoDismissedVerificationTopicKeyRef: Ref<string | null>;
  linuxDoPanelClosingSessionRef: Ref<number | null>;
  linuxDoPanelCloseSettleTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoPendingReopenTaskRef: Ref<DeferredNavigationTask | null>;
  linuxDoPendingReopenTopicAfterCloseRef: Ref<Topic | null>;
  linuxDoPendingTopicVerifiedRef: Ref<boolean>;
  linuxDoRequireFreshClearanceRef: Ref<boolean>;
  linuxDoVerifiedRetryTopicKeyRef: Ref<string | null>;
  linuxDoWebViewCookieHeader: string;
  linuxDoWebViewCookieHeaderRef: Ref<string>;
  linuxDoWebViewMountTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  linuxDoWebViewRef: Ref<WebView | null>;
  linuxDoWebViewSessionRef: Ref<number>;
  linuxDoWebViewUserAgent: string;
  linuxDoWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  onLoginWebViewFailure: (site: 'linuxdo', attempt: number, reason: LoginWebViewFailureReason) => void;
  openTopicRef: Ref<((topic: Topic, nocache?: boolean) => Promise<void>) | null>;
  pendingLinuxDoTopicRef: Ref<Topic | null>;
  reopenExistingTopicScreenRef: Ref<boolean>;
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
  showLinuxDoPanel: boolean;
  showLinuxDoPanelRef: Ref<boolean>;
  topicDetail: TopicDetail | null;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
  updateNodeSeekSession: (event: SiteSessionEvent) => void;
}) {
  const linuxDoVerificationTraceRef = useRef<DiagnosticTrace | null>(null);
  const linuxDoTerminalWebViewSessionRef = useRef<number | null>(null);

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

  const showNodeSeekVerification = useCallback((message = 'NodeSeek 需要完成 Cloudflare 验证') => {
    const linuxDoTrace = linuxDoVerificationTraceRef.current;
    if (linuxDoTrace) {
      markDiagnosticStage(linuxDoTrace, 'apply', { source: 'linuxdo', state: 'linuxdo-panel-closed' });
      finishLinuxDoVerificationTrace(linuxDoTrace, 'canceled', { reason: 'superseded' });
    }
    changeScreen('more');
    changeNodeSeekLoginPanel(true);
    closeYaohuoLoginPanel();
    setShowLinuxDoPanel(false);
    setShowSettingsPanel(false);
    updateNodeSeekSession({ type: 'verification-required', message });
    notify(message);
  }, [changeNodeSeekLoginPanel, changeScreen, closeYaohuoLoginPanel, finishLinuxDoVerificationTrace, notify, setShowLinuxDoPanel, setShowSettingsPanel, updateNodeSeekSession]);

  const refreshLinuxDoClearanceState = useCallback(async () => {
    const access = await clearLinuxDoSavedClearance();
    await clearLinuxDoWebViewClearance();
    linuxDoWebViewCookieHeaderRef.current = '';
    setLinuxDoWebViewCookieHeader('');
    const summary = linuxDoAccessSummary(access);
    const cookieSummary = summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(access?.cookieHeader || '')).names;
    updateLinuxDoSession(summary.hasClearance || summary.loggedIn
      ? { type: 'verification-succeeded', cookieSummary, loggedIn: summary.loggedIn, at: new Date().toISOString() }
      : { type: 'cleared' });
    resetLinuxDoLevelState();
  }, [linuxDoWebViewCookieHeaderRef, resetLinuxDoLevelState, setLinuxDoWebViewCookieHeader, updateLinuxDoSession]);

  const rememberLinuxDoClearanceBeforeVerify = useCallback(async () => {
    const diagnosticTrace = linuxDoVerificationTraceRef.current || undefined;
    const [savedAccess, webViewCookies] = await Promise.all([
      loadLinuxDoAccess(),
      readLinuxDoCookiesFromStores({ diagnosticTrace }).catch(() => ({}))
    ]);
    const visibleCookies = parseLinuxDoDocumentCookie(linuxDoWebViewCookieHeaderRef.current || linuxDoWebViewCookieHeader);
    const cookies = mergeLinuxDoCookies(parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || ''), webViewCookies, visibleCookies);
    linuxDoClearanceBeforeVerifyRef.current = linuxDoClearanceValue(cookies) || null;
  }, [linuxDoClearanceBeforeVerifyRef, linuxDoWebViewCookieHeader, linuxDoWebViewCookieHeaderRef]);

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

  const closeLinuxDoPanel = useCallback(() => {
    const trace = linuxDoVerificationTraceRef.current;
    if (trace) {
      markDiagnosticStage(trace, 'apply', {
        source: 'linuxdo',
        state: 'linuxdo-panel-closed'
      });
      finishLinuxDoVerificationTrace(trace, 'canceled', { reason: 'canceled' });
    }
    if (linuxDoPanelClosingSessionRef.current !== null) {
      linuxDoWebViewRef.current?.stopLoading();
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPage(false);
      setLinuxDoWebViewError('');
      setShowLinuxDoPanel(false);
      return;
    }
    const nextSession = nextLinuxDoWebViewSession();
    const pendingTopic = pendingLinuxDoTopicRef.current;
    const shouldOpenPendingTopic = Boolean(pendingTopic && linuxDoPendingTopicVerifiedRef.current);
    linuxDoPanelClosingSessionRef.current = nextSession;
    linuxDoPendingReopenTopicAfterCloseRef.current = null;
    cancelLinuxDoPendingReopenTask();
    if (pendingTopic && !shouldOpenPendingTopic) {
      linuxDoDismissedVerificationTopicKeyRef.current = topicKey(pendingTopic);
    }
    if (pendingTopic && shouldOpenPendingTopic) {
      linuxDoDismissedVerificationTopicKeyRef.current = null;
      linuxDoPendingReopenTopicAfterCloseRef.current = pendingTopic;
    }
    linuxDoRequireFreshClearanceRef.current = false;
    checkingRequestIdRef.current += 1;
    if (linuxDoWebViewMountTimerRef.current) {
      clearTimeout(linuxDoWebViewMountTimerRef.current);
      linuxDoWebViewMountTimerRef.current = null;
    }
    linuxDoWebViewRef.current?.stopLoading();
    setMountLinuxDoWebView(false);
    linuxDoWebViewCookieHeaderRef.current = '';
    setLinuxDoWebViewCookieHeader('');
    pendingLinuxDoTopicRef.current = null;
    linuxDoPendingTopicVerifiedRef.current = false;
    setChecking(false);
    setLoadingLinuxDoPageForSession(false, nextSession);
    setLinuxDoWebViewErrorForSession('', nextSession);
    if (!showLinuxDoPanelRef.current) {
      setShowLinuxDoPanel(false);
      linuxDoPanelClosingSessionRef.current = null;
      linuxDoPendingReopenTopicAfterCloseRef.current = null;
      return;
    }
    setShowLinuxDoPanel(false);
  }, [
    cancelLinuxDoPendingReopenTask,
    checkingRequestIdRef,
    finishLinuxDoVerificationTrace,
    linuxDoDismissedVerificationTopicKeyRef,
    linuxDoPanelClosingSessionRef,
    linuxDoPendingReopenTopicAfterCloseRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoRequireFreshClearanceRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    nextLinuxDoWebViewSession,
    pendingLinuxDoTopicRef,
    setChecking,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewError,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPage,
    setLoadingLinuxDoPageForSession,
    setMountLinuxDoWebView,
    setShowLinuxDoPanel,
    showLinuxDoPanelRef
  ]);

  useEffect(() => {
    if (showLinuxDoPanel || linuxDoPanelClosingSessionRef.current === null) {
      return;
    }

    if (linuxDoPanelCloseSettleTimerRef.current) {
      clearTimeout(linuxDoPanelCloseSettleTimerRef.current);
    }
    linuxDoPanelCloseSettleTimerRef.current = setTimeout(() => {
      linuxDoPanelCloseSettleTimerRef.current = null;
      if (showLinuxDoPanelRef.current || linuxDoPanelClosingSessionRef.current === null) {
        return;
      }
      linuxDoPanelClosingSessionRef.current = null;
      const pendingTopic = linuxDoPendingReopenTopicAfterCloseRef.current;
      linuxDoPendingReopenTopicAfterCloseRef.current = null;
      if (!pendingTopic) {
        return;
      }
      linuxDoVerifiedRetryTopicKeyRef.current = topicKey(pendingTopic);
      cancelLinuxDoPendingReopenTask();
      const task = InteractionManager.runAfterInteractions(() => {
        linuxDoPendingReopenTaskRef.current = null;
        reopenExistingTopicScreenRef.current = true;
        changeScreen('topic');
        void openTopicRef.current?.(pendingTopic, true);
      });
      linuxDoPendingReopenTaskRef.current = task;
    }, LINUXDO_PANEL_CLOSE_SETTLE_MS);

    return () => {
      if (linuxDoPanelCloseSettleTimerRef.current) {
        clearTimeout(linuxDoPanelCloseSettleTimerRef.current);
        linuxDoPanelCloseSettleTimerRef.current = null;
      }
    };
  }, [
    cancelLinuxDoPendingReopenTask,
    linuxDoPanelCloseSettleTimerRef,
    linuxDoPanelClosingSessionRef,
    linuxDoPendingReopenTaskRef,
    linuxDoPendingReopenTopicAfterCloseRef,
    linuxDoVerifiedRetryTopicKeyRef,
    openTopicRef,
    reopenExistingTopicScreenRef,
    changeScreen,
    showLinuxDoPanel,
    showLinuxDoPanelRef
  ]);

  const changeLinuxDoPanel = useCallback((visible: boolean) => {
    if (visible) {
      const trace = currentLinuxDoVerificationTrace('open');
      if (linuxDoPanelClosingSessionRef.current !== null) {
        markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'busy' });
        finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'busy' });
        return false;
      }
      markDiagnosticStage(trace, 'guard', { source: 'linuxdo', state: 'open' });
      if (!pendingLinuxDoTopicRef.current) {
        linuxDoRequireFreshClearanceRef.current = false;
        void rememberLinuxDoClearanceBeforeVerify();
      }
      setShowLinuxDoPanel(true);
      resetLinuxDoWebView();
      return true;
    }
    closeLinuxDoPanel();
    return true;
  }, [
    closeLinuxDoPanel,
    currentLinuxDoVerificationTrace,
    finishLinuxDoVerificationTrace,
    linuxDoPanelClosingSessionRef,
    linuxDoRequireFreshClearanceRef,
    pendingLinuxDoTopicRef,
    rememberLinuxDoClearanceBeforeVerify,
    resetLinuxDoWebView,
    setShowLinuxDoPanel
  ]);

  const showLinuxDoVerification = useCallback((message = 'linux.do 需要完成 Cloudflare 验证') => {
    if (linuxDoPanelClosingSessionRef.current !== null) {
      const trace = startLinuxDoVerificationTrace('open');
      markDiagnosticStage(trace, 'guard', {
        source: 'linuxdo',
        state: 'busy'
      });
      finishLinuxDoVerificationTrace(trace, 'blocked', { reason: 'busy' });
      pendingLinuxDoTopicRef.current = null;
      linuxDoPendingTopicVerifiedRef.current = false;
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPage(false);
      notify(message);
      return;
    }
    linuxDoPendingTopicVerifiedRef.current = false;
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    setShowSettingsPanel(false);
    changeLinuxDoPanel(true);
    updateLinuxDoSession({ type: 'verification-started', at: new Date().toISOString() });
    notify(message);
  }, [
    changeLinuxDoPanel,
    changeNodeSeekLoginPanel,
    closeYaohuoLoginPanel,
    linuxDoPanelClosingSessionRef,
    linuxDoPendingTopicVerifiedRef,
    finishLinuxDoVerificationTrace,
    notify,
    pendingLinuxDoTopicRef,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    setShowSettingsPanel,
    startLinuxDoVerificationTrace,
    updateLinuxDoSession
  ]);

  const handleLinuxDoCloudflareForTopic = useCallback(async (topic: Topic, message: string) => {
    const requestTopicKey = topicKey(topic);
    if (linuxDoDismissedVerificationTopicKeyRef.current === requestTopicKey) {
      pendingLinuxDoTopicRef.current = null;
      linuxDoPendingTopicVerifiedRef.current = false;
      linuxDoPendingReopenTopicAfterCloseRef.current = null;
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPage(false);
      notify(message);
      return true;
    }
    if (linuxDoVerifiedRetryTopicKeyRef.current === requestTopicKey) {
      linuxDoVerifiedRetryTopicKeyRef.current = null;
      pendingLinuxDoTopicRef.current = null;
      linuxDoPendingTopicVerifiedRef.current = false;
      linuxDoPendingReopenTopicAfterCloseRef.current = null;
      setMountLinuxDoWebView(false);
      setLoadingLinuxDoPage(false);
      notify(message);
      return true;
    }
    currentLinuxDoVerificationTrace('open');
    linuxDoRequireFreshClearanceRef.current = true;
    await rememberLinuxDoClearanceBeforeVerify();
    await refreshLinuxDoClearanceState();
    pendingLinuxDoTopicRef.current = topic;
    showLinuxDoVerification(message);
    return true;
  }, [
    linuxDoDismissedVerificationTopicKeyRef,
    currentLinuxDoVerificationTrace,
    linuxDoPendingReopenTopicAfterCloseRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoRequireFreshClearanceRef,
    linuxDoVerifiedRetryTopicKeyRef,
    notify,
    pendingLinuxDoTopicRef,
    rememberLinuxDoClearanceBeforeVerify,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    showLinuxDoVerification
  ]);

  const verifyLinuxDoFromTopic = useCallback(async () => {
    currentLinuxDoVerificationTrace('open');
    linuxDoVerifiedRetryTopicKeyRef.current = null;
    linuxDoDismissedVerificationTopicKeyRef.current = null;
    linuxDoRequireFreshClearanceRef.current = true;
    await rememberLinuxDoClearanceBeforeVerify();
    await refreshLinuxDoClearanceState();
    const detail = topicDetail || selectedTopic;
    if (detail?.source === 'linuxdo') {
      pendingLinuxDoTopicRef.current = detail;
    }
    showLinuxDoVerification();
  }, [
    linuxDoDismissedVerificationTopicKeyRef,
    currentLinuxDoVerificationTrace,
    linuxDoRequireFreshClearanceRef,
    linuxDoVerifiedRetryTopicKeyRef,
    pendingLinuxDoTopicRef,
    refreshLinuxDoClearanceState,
    rememberLinuxDoClearanceBeforeVerify,
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
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
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
      if (canStoreLinuxDoClearance(cookies)) {
        return cookies;
      }
      await new Promise((resolve) => setTimeout(resolve, LINUXDO_CLEARANCE_DETECT_INTERVAL_MS));
      cookies = await readCurrentLinuxDoCookies();
    }
    return cookies;
  }, [readCurrentLinuxDoCookies]);

  const checkLinuxDoCookie = useCallback(async () => {
    const trace = currentLinuxDoVerificationTrace('manual');
    markDiagnosticStage(trace, 'credential', {
      source: 'linuxdo',
      state: 'started'
    });
    const requestId = ++checkingRequestIdRef.current;
    const linuxDoWebViewSession = linuxDoWebViewSessionRef.current;
    const isCurrentLinuxDoCheck = () => {
      if (requestId !== checkingRequestIdRef.current) {
        return false;
      }
      if (linuxDoWebViewSession !== linuxDoWebViewSessionRef.current) {
        return false;
      }
      if (!showLinuxDoPanelRef.current) {
        return false;
      }
      return true;
    };
    setChecking(true);
    setLinuxDoWebViewError('');
    try {
      const cookies = await waitForLinuxDoClearance();
      if (!isCurrentLinuxDoCheck()) {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      const summary = summarizeLinuxDoCookies(cookies);
      const cookieHeader = buildLinuxDoCookieHeader(cookies);
      const hasCredential = canStoreLinuxDoAccess(cookies) && Boolean(cookieHeader);
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        count: summary.names.length,
        hasCredential
      });
      if (!canStoreLinuxDoAccess(cookies) || !cookieHeader || !canAcceptLinuxDoAccessUpdate(cookies, linuxDoClearanceBeforeVerifyRef.current, linuxDoRequireFreshClearanceRef.current)) {
        updateLinuxDoSession({
          type: 'verification-required',
          message: '没有检测到新的 linux.do 验证信息。'
        });
        resetLinuxDoLevelState();
        linuxDoPendingTopicVerifiedRef.current = false;
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
      updateLinuxDoSession({
        type: 'verification-succeeded',
        cookieSummary: summary.names,
        loggedIn: summary.loggedIn,
        at: new Date().toISOString()
      });
      setLinuxDoWebViewError('');
      notify(summary.loggedIn ? 'linux.do 登录信息已保存在本机。' : 'linux.do 验证信息已保存在本机。');
      linuxDoClearanceBeforeVerifyRef.current = linuxDoClearanceValue(cookies);
      linuxDoRequireFreshClearanceRef.current = false;
      linuxDoPendingTopicVerifiedRef.current = Boolean(pendingLinuxDoTopicRef.current);
      finishLinuxDoVerificationTrace(trace, 'success', {
        hasCredential: true,
        isLoggedIn: summary.loggedIn
      });
      if (linuxDoPendingTopicVerifiedRef.current) {
        closeLinuxDoPanel();
      }
    } catch (error) {
      if (isCurrentLinuxDoCheck()) {
        linuxDoPendingTopicVerifiedRef.current = false;
        notify(errorMessage(error));
        finishLinuxDoVerificationTrace(trace, 'failure', {
          reason: normalizeDiagnosticReason(error)
        });
      } else {
        finishLinuxDoVerificationTrace(trace, 'stale', { reason: 'stale' });
      }
    } finally {
      if (isCurrentLinuxDoCheck()) {
        setChecking(false);
      }
    }
  }, [
    checkingRequestIdRef,
    closeLinuxDoPanel,
    currentLinuxDoVerificationTrace,
    finishLinuxDoVerificationTrace,
    linuxDoClearanceBeforeVerifyRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoRequireFreshClearanceRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgent,
    linuxDoWebViewUserAgentRef,
    notify,
    pendingLinuxDoTopicRef,
    resetLinuxDoLevelState,
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
    handleLinuxDoCloudflareForTopic,
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
