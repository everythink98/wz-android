import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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
  readLinuxDoCookiesFromWebView,
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

const LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS = 5000;
const LINUXDO_CLEARANCE_DETECT_INTERVAL_MS = 500;
const LINUXDO_PANEL_CLOSE_SETTLE_MS = 350;

type DeferredNavigationTask = ReturnType<typeof InteractionManager.runAfterInteractions>;
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
  setScreen,
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
  setScreen: Dispatch<SetStateAction<Screen>>;
  setShowLinuxDoPanel: Dispatch<SetStateAction<boolean>>;
  setShowSettingsPanel: Dispatch<SetStateAction<boolean>>;
  showLinuxDoPanel: boolean;
  showLinuxDoPanelRef: Ref<boolean>;
  topicDetail: TopicDetail | null;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
  updateNodeSeekSession: (event: SiteSessionEvent) => void;
}) {
  const showNodeSeekVerification = useCallback((message = 'NodeSeek 需要完成 Cloudflare 验证') => {
    setScreen('more');
    changeNodeSeekLoginPanel(true);
    closeYaohuoLoginPanel();
    setShowLinuxDoPanel(false);
    setShowSettingsPanel(false);
    updateNodeSeekSession({ type: 'verification-required', message });
    notify(message);
  }, [changeNodeSeekLoginPanel, closeYaohuoLoginPanel, notify, setScreen, setShowLinuxDoPanel, setShowSettingsPanel, updateNodeSeekSession]);

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
    const [savedAccess, webViewCookies] = await Promise.all([
      loadLinuxDoAccess(),
      readLinuxDoCookiesFromWebView().catch(() => ({}))
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
  }, [linuxDoWebViewSessionRef, setLoadingLinuxDoPage]);

  const setLinuxDoWebViewErrorForSession = useCallback((value: string, webViewKey?: number) => {
    if (webViewKey !== undefined && webViewKey !== linuxDoWebViewSessionRef.current) {
      return;
    }
    setLinuxDoWebViewError(value);
  }, [linuxDoWebViewSessionRef, setLinuxDoWebViewError]);

  const resetLinuxDoWebView = useCallback(() => {
    if (linuxDoPanelClosingSessionRef.current !== null) {
      return;
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
        setScreen('topic');
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
    setScreen,
    showLinuxDoPanel,
    showLinuxDoPanelRef
  ]);

  const changeLinuxDoPanel = useCallback((visible: boolean) => {
    if (visible) {
      if (linuxDoPanelClosingSessionRef.current !== null) {
        return;
      }
      if (!pendingLinuxDoTopicRef.current) {
        linuxDoRequireFreshClearanceRef.current = false;
        void rememberLinuxDoClearanceBeforeVerify();
      }
      setShowLinuxDoPanel(true);
      resetLinuxDoWebView();
      return;
    }
    closeLinuxDoPanel();
  }, [
    closeLinuxDoPanel,
    linuxDoPanelClosingSessionRef,
    linuxDoRequireFreshClearanceRef,
    pendingLinuxDoTopicRef,
    rememberLinuxDoClearanceBeforeVerify,
    resetLinuxDoWebView,
    setShowLinuxDoPanel
  ]);

  const showLinuxDoVerification = useCallback((message = 'linux.do 需要完成 Cloudflare 验证') => {
    if (linuxDoPanelClosingSessionRef.current !== null) {
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
    notify,
    pendingLinuxDoTopicRef,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    setShowSettingsPanel,
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
    linuxDoRequireFreshClearanceRef.current = true;
    await rememberLinuxDoClearanceBeforeVerify();
    await refreshLinuxDoClearanceState();
    pendingLinuxDoTopicRef.current = topic;
    showLinuxDoVerification(message);
    return true;
  }, [
    linuxDoDismissedVerificationTopicKeyRef,
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
    linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }, [linuxDoWebViewRef]);

  const readCurrentLinuxDoCookies = useCallback(async () => {
    await probeLinuxDoPage();
    const [savedAccess, nativeCookies] = await Promise.all([
      loadLinuxDoAccess(),
      readLinuxDoCookiesFromWebView()
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
        return;
      }
      const summary = summarizeLinuxDoCookies(cookies);
      const cookieHeader = buildLinuxDoCookieHeader(cookies);
      if (!canStoreLinuxDoAccess(cookies) || !cookieHeader || !canAcceptLinuxDoAccessUpdate(cookies, linuxDoClearanceBeforeVerifyRef.current, linuxDoRequireFreshClearanceRef.current)) {
        updateLinuxDoSession({
          type: 'verification-required',
          message: '没有检测到新的 linux.do 验证信息。'
        });
        resetLinuxDoLevelState();
        linuxDoPendingTopicVerifiedRef.current = false;
        notify('没有检测到新的 linux.do 验证信息。请完成验证后再试。');
        return;
      }
      await saveLinuxDoAccess(cookieHeader, linuxDoWebViewUserAgentRef.current || linuxDoWebViewUserAgent || undefined);
      if (!isCurrentLinuxDoCheck()) {
        return;
      }
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
      if (linuxDoPendingTopicVerifiedRef.current) {
        closeLinuxDoPanel();
      }
    } catch (error) {
      if (isCurrentLinuxDoCheck()) {
        linuxDoPendingTopicVerifiedRef.current = false;
        notify(errorMessage(error));
      }
    } finally {
      if (isCurrentLinuxDoCheck()) {
        setChecking(false);
      }
    }
  }, [
    checkingRequestIdRef,
    closeLinuxDoPanel,
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
