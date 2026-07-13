import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import CookieManager from '@react-native-cookies/cookies';
import { type WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  mergeNodeSeekCookies,
  parseNodeSeekDocumentCookie,
  sanitizeNodeSeekUserAgent,
  summarizeNodeSeekCookies
} from '../nodeseekCookies';
import { readNodeSeekCookiesFromStores } from '../nodeseekCookieBridge';
import {
  buildYaohuoCookieHeader,
  canStoreYaohuoCookieHeader,
  mergeYaohuoCookies,
  summarizeYaohuoCookies,
  type YaohuoNativeCookie
} from '../yaohuoCookies';
import {
  clearLinuxDoAccess,
  currentLinuxDoAccessGeneration,
  linuxDoAccessSummary,
  loadLinuxDoAccess,
  parseLinuxDoDocumentCookie,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { YAOHUO_URL } from '../appUrls';
import {
  errorMessage,
  isLinuxDoCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError
} from '../appUtils';
import {
  checkYaohuoLogin,
  getLinuxDoLevelProfile,
  isLinuxDoLoginExpiredError,
  type LinuxDoLevelProfile
} from '../sources/sourceGateway';
import type { Fetcher } from '../request';
import type { SiteSessionEvent } from '../siteSessionState';
import { nodeSeekLoginProbeScript } from '../loginWebViewScripts';
import {
  createWebViewMessageSession,
  parseTrustedWebViewMessage,
  type WebViewMessageSession
} from '../webViewMessageGuard';
import type { CredentialClearOptions } from './sessionControllerHelpers';
import type { LoginWebViewFailureReason } from './accountCredentialDiagnostics';
import { clearExpiredLinuxDoLogin } from './topicActionHelpers';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '../diagnostics';

const YAOHUO_COOKIE_URLS = [YAOHUO_URL];

type Ref<T> = MutableRefObject<T>;
export type LoginWebViewDiagnosticState = 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout';

const NODESEEK_LOGIN_MESSAGE_ORIGINS = [
  'https://www.nodeseek.com',
  'https://nodeseek.com'
];

export function useAccountController({
  checkingRequestIdRef,
  clearNodeSeekLoginCookiesOnly,
  clearNodeSeekLoginState,
  clearYaohuoLoginState,
  currentNodeSeekCredentialGeneration,
  currentYaohuoCredentialGeneration,
  forumFetchWithWebViewFallback,
  linuxDoLevelRequestIdRef,
  linuxDoWebViewUserAgentRef,
  nodeSeekLoginPanelRequestRef,
  nodeSeekCurrentUserId,
  nodeSeekWebViewCookieHeaderRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  onLoginWebViewFailure,
  resetLinuxDoLevelState,
  resetLinuxDoWebView,
  saveNodeSeekCookieHeader,
  saveYaohuoCookieHeader,
  setChecking,
  setLinuxDoLevelBusy,
  setLinuxDoLevelError,
  setLinuxDoLevelProfile,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  showLinuxDoVerification,
  showLoginPanelRef,
  showYaohuoLoginPanel,
  updateLinuxDoSession,
  updateNodeSeekSession,
  updateYaohuoSession,
  webLoginDetectedRef,
  webViewRef,
  yaohuoLoginPanelRequestRef,
  yaohuoCredentialSuppressedRef,
  yaohuoWebViewRef
}: {
  checkingRequestIdRef: Ref<number>;
  clearNodeSeekLoginCookiesOnly: (options?: CredentialClearOptions) => Promise<unknown>;
  clearNodeSeekLoginState: () => Promise<boolean | void>;
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<boolean | void>;
  currentNodeSeekCredentialGeneration: () => number;
  currentYaohuoCredentialGeneration: () => number;
  forumFetchWithWebViewFallback: Fetcher;
  linuxDoLevelRequestIdRef: Ref<number>;
  linuxDoWebViewUserAgentRef: Ref<string>;
  nodeSeekLoginPanelRequestRef: Ref<number>;
  nodeSeekCurrentUserId: string | number | null;
  nodeSeekWebViewCookieHeaderRef: Ref<string>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  onLoginWebViewFailure: (site: 'nodeseek' | 'yaohuo', attempt: number, reason: LoginWebViewFailureReason) => void;
  resetLinuxDoLevelState: () => void;
  resetLinuxDoWebView: () => void;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { verifiedByPage?: boolean; isCurrent?: () => boolean; resetCurrentUser?: boolean; userId?: number | null; diagnosticTrace?: DiagnosticTrace }
  ) => Promise<string>;
  saveYaohuoCookieHeader: (cookieHeader: string, options?: { isCurrent?: () => boolean; generation?: number; diagnosticTrace?: DiagnosticTrace }) => Promise<boolean>;
  setChecking: Dispatch<SetStateAction<boolean>>;
  setLinuxDoLevelBusy: Dispatch<SetStateAction<boolean>>;
  setLinuxDoLevelError: Dispatch<SetStateAction<string>>;
  setLinuxDoLevelProfile: Dispatch<SetStateAction<LinuxDoLevelProfile | null>>;
  setNodeSeekWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setWebLoginUserId: Dispatch<SetStateAction<number | null>>;
  showLinuxDoVerification: (message?: string) => void;
  showLoginPanelRef: Ref<boolean>;
  showYaohuoLoginPanel: boolean;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
  updateNodeSeekSession: (event: SiteSessionEvent) => void;
  updateYaohuoSession: (event: SiteSessionEvent) => void;
  webLoginDetectedRef: Ref<boolean>;
  webViewRef: Ref<WebView | null>;
  yaohuoLoginPanelRequestRef: Ref<number>;
  yaohuoCredentialSuppressedRef: Ref<boolean>;
  yaohuoWebViewRef: Ref<WebView | null>;
}) {
  const nodeSeekWebLoginUserIdRef = useRef<number | null>(null);
  const nodeSeekLoginPageStatusRef = useRef<'unknown' | 'logged-in' | 'logged-out'>('unknown');
  const nodeSeekLoginTraceRef = useRef<{ trace: DiagnosticTrace; panelRequestId: number } | null>(null);
  const nodeSeekTerminalRequestRef = useRef<number | null>(null);
  const wasNodeSeekLoginPanelVisibleRef = useRef(false);
  const yaohuoLoginTraceRef = useRef<{ trace: DiagnosticTrace; panelRequestId: number } | null>(null);
  const yaohuoTerminalRequestRef = useRef<number | null>(null);
  const wasYaohuoLoginPanelVisibleRef = useRef(false);
  const observedYaohuoLoginPanelRequestRef = useRef(yaohuoLoginPanelRequestRef.current);
  const nodeSeekMessageSessionRef = useRef<{
    panelRequestId: number;
    session: WebViewMessageSession;
  }>({
    panelRequestId: nodeSeekLoginPanelRequestRef.current,
    session: createWebViewMessageSession('nodeseek-login')
  });

  const currentNodeSeekMessageSession = useCallback(() => {
    const panelRequestId = nodeSeekLoginPanelRequestRef.current;
    if (nodeSeekMessageSessionRef.current.panelRequestId !== panelRequestId) {
      nodeSeekMessageSessionRef.current = {
        panelRequestId,
        session: createWebViewMessageSession('nodeseek-login')
      };
    }
    return nodeSeekMessageSessionRef.current.session;
  }, [nodeSeekLoginPanelRequestRef]);
  const nodeSeekProbeScript = nodeSeekLoginProbeScript(currentNodeSeekMessageSession());

  const finishNodeSeekLoginTrace = useCallback((
    trace: DiagnosticTrace,
    outcome: DiagnosticOutcome,
    fields: DiagnosticFields = {}
  ) => {
    if (nodeSeekLoginTraceRef.current?.trace !== trace) {
      return;
    }
    finishDiagnosticTrace(trace, outcome, { source: 'nodeseek', ...fields });
    nodeSeekLoginTraceRef.current = null;
  }, []);

  const currentNodeSeekLoginTrace = useCallback((mode: 'open' | 'manual' = 'manual') => {
    const panelRequestId = nodeSeekLoginPanelRequestRef.current;
    const current = nodeSeekLoginTraceRef.current;
    if (current?.panelRequestId === panelRequestId) {
      return current.trace;
    }
    if (current) {
      finishDiagnosticTrace(current.trace, 'stale', {
        source: 'nodeseek',
        reason: 'superseded'
      });
    }
    const trace = beginDiagnosticTrace('credential', 'check', {
      source: 'nodeseek',
      mode
    });
    nodeSeekLoginTraceRef.current = { trace, panelRequestId };
    return trace;
  }, [nodeSeekLoginPanelRequestRef]);

  const finishYaohuoLoginTrace = useCallback((
    trace: DiagnosticTrace,
    outcome: DiagnosticOutcome,
    fields: DiagnosticFields = {}
  ) => {
    if (yaohuoLoginTraceRef.current?.trace !== trace) {
      return;
    }
    finishDiagnosticTrace(trace, outcome, { source: 'yaohuo', ...fields });
    yaohuoLoginTraceRef.current = null;
  }, []);

  const currentYaohuoLoginTrace = useCallback((mode: 'open' | 'manual' = 'manual') => {
    const panelRequestId = yaohuoLoginPanelRequestRef.current;
    const current = yaohuoLoginTraceRef.current;
    if (current?.panelRequestId === panelRequestId) {
      return current.trace;
    }
    if (current) {
      finishDiagnosticTrace(current.trace, 'stale', {
        source: 'yaohuo',
        reason: 'superseded'
      });
    }
    const trace = beginDiagnosticTrace('credential', 'check', {
      source: 'yaohuo',
      mode
    });
    yaohuoLoginTraceRef.current = { trace, panelRequestId };
    return trace;
  }, [yaohuoLoginPanelRequestRef]);

  useEffect(() => {
    const visible = showLoginPanelRef.current;
    if (visible && !wasNodeSeekLoginPanelVisibleRef.current) {
      const trace = currentNodeSeekLoginTrace('open');
      markDiagnosticStage(trace, 'guard', {
        source: 'nodeseek',
        state: 'open'
      });
    } else if (!visible && wasNodeSeekLoginPanelVisibleRef.current) {
      const trace = nodeSeekLoginTraceRef.current?.trace;
      if (trace) {
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          state: 'login-panel-closed'
        });
        finishNodeSeekLoginTrace(trace, 'canceled', { reason: 'canceled' });
      }
    }
    wasNodeSeekLoginPanelVisibleRef.current = visible;
  });

  useEffect(() => {
    const panelRequestId = yaohuoLoginPanelRequestRef.current;
    const openedOrReplaced = showYaohuoLoginPanel && (
      !wasYaohuoLoginPanelVisibleRef.current
      || observedYaohuoLoginPanelRequestRef.current !== panelRequestId
    );
    if (openedOrReplaced) {
      const trace = currentYaohuoLoginTrace('open');
      markDiagnosticStage(trace, 'guard', {
        source: 'yaohuo',
        state: 'open'
      });
    } else if (!showYaohuoLoginPanel && wasYaohuoLoginPanelVisibleRef.current) {
      const trace = yaohuoLoginTraceRef.current?.trace;
      if (trace) {
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          state: 'yaohuo-panel-closed'
        });
        finishYaohuoLoginTrace(trace, 'canceled', { reason: 'canceled' });
      }
    }
    observedYaohuoLoginPanelRequestRef.current = panelRequestId;
    wasYaohuoLoginPanelVisibleRef.current = showYaohuoLoginPanel;
  });

  const recordNodeSeekLoginWebViewState = useCallback((state: LoginWebViewDiagnosticState, attempt = 0) => {
    const requestId = nodeSeekLoginPanelRequestRef.current;
    if (state === 'start') {
      nodeSeekMessageSessionRef.current = {
        panelRequestId: requestId,
        session: createWebViewMessageSession('nodeseek-login')
      };
    }
    if (state === 'start' && nodeSeekTerminalRequestRef.current === requestId) {
      nodeSeekTerminalRequestRef.current = null;
    } else if (nodeSeekTerminalRequestRef.current === requestId) {
      return;
    }
    const trace = currentNodeSeekLoginTrace('open');
    if (state === 'error' || state === 'renderer-gone' || state === 'timeout') {
      nodeSeekTerminalRequestRef.current = requestId;
      const reason: LoginWebViewFailureReason = state === 'renderer-gone' ? 'renderer_gone' : state === 'timeout' ? 'timeout' : 'network_error';
      markDiagnosticStage(trace, 'transport', { source: 'nodeseek', channel: 'webview', state: 'failure', reason });
      finishNodeSeekLoginTrace(trace, 'failure', { reason });
      onLoginWebViewFailure('nodeseek', attempt, reason);
      return;
    }
    markDiagnosticStage(trace, 'transport', {
      source: 'nodeseek',
      channel: 'webview',
      state: state === 'start' ? 'started' : 'ready'
    });
  }, [currentNodeSeekLoginTrace, finishNodeSeekLoginTrace, nodeSeekLoginPanelRequestRef, onLoginWebViewFailure]);

  const recordYaohuoLoginWebViewState = useCallback((state: LoginWebViewDiagnosticState, attempt = 0) => {
    const requestId = yaohuoLoginPanelRequestRef.current;
    if (state === 'start' && yaohuoTerminalRequestRef.current === requestId) {
      yaohuoTerminalRequestRef.current = null;
    } else if (yaohuoTerminalRequestRef.current === requestId) {
      return;
    }
    const trace = currentYaohuoLoginTrace('open');
    if (state === 'error' || state === 'renderer-gone' || state === 'timeout') {
      yaohuoTerminalRequestRef.current = requestId;
      const reason: LoginWebViewFailureReason = state === 'renderer-gone' ? 'renderer_gone' : state === 'timeout' ? 'timeout' : 'network_error';
      markDiagnosticStage(trace, 'transport', { source: 'yaohuo', channel: 'webview', state: 'failure', reason });
      finishYaohuoLoginTrace(trace, 'failure', { reason });
      onLoginWebViewFailure('yaohuo', attempt, reason);
      return;
    }
    markDiagnosticStage(trace, 'transport', {
      source: 'yaohuo',
      channel: 'webview',
      state: state === 'start' ? 'started' : 'ready'
    });
  }, [currentYaohuoLoginTrace, finishYaohuoLoginTrace, onLoginWebViewFailure]);

  const handleLoginMessage = useCallback((event: WebViewMessageEvent) => {
    const data = parseTrustedWebViewMessage(event.nativeEvent, {
      allowedTypes: ['nodeseek-login'],
      trustedOrigins: NODESEEK_LOGIN_MESSAGE_ORIGINS,
      ...currentNodeSeekMessageSession()
    }) as ({
      type: 'nodeseek-login';
      loggedIn?: boolean;
      userId?: number | null;
      userAgent?: string;
      cookie?: string;
    } & Record<string, unknown>) | null;
    if (!data) {
      return;
    }
    if (
      typeof data.loggedIn !== 'boolean'
      || typeof data.userAgent !== 'string'
      || typeof data.cookie !== 'string'
    ) {
      return;
    }
    try {
      if (data.type === 'nodeseek-login') {
        if (nodeSeekTerminalRequestRef.current !== nodeSeekLoginPanelRequestRef.current) {
          const trace = currentNodeSeekLoginTrace('open');
          markDiagnosticStage(trace, 'transport', {
            source: 'nodeseek',
            channel: 'webview',
            state: 'ready'
          });
          markDiagnosticStage(trace, 'parse', {
            source: 'nodeseek',
            messageRecognized: true,
            hasCredential: typeof data.cookie === 'string',
            isLoggedIn: Boolean(data.loggedIn),
            userAgentSource: typeof data.userAgent === 'string' ? 'webview' : 'default'
          });
        }
      }
      if (data.type === 'nodeseek-login' && typeof data.userAgent === 'string') {
        const userAgent = sanitizeNodeSeekUserAgent(data.userAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (data.type === 'nodeseek-login' && typeof data.cookie === 'string') {
        nodeSeekWebViewCookieHeaderRef.current = data.cookie;
      }
      if (data.type === 'nodeseek-login' && data.loggedIn) {
        nodeSeekLoginPageStatusRef.current = 'logged-in';
        webLoginDetectedRef.current = true;
        if (Number.isInteger(data.userId)) {
          nodeSeekWebLoginUserIdRef.current = data.userId || null;
          setWebLoginUserId(data.userId || null);
        } else {
          nodeSeekWebLoginUserIdRef.current = null;
          setWebLoginUserId(null);
        }
      } else if (data.type === 'nodeseek-login' && data.loggedIn === false) {
        nodeSeekLoginPageStatusRef.current = 'logged-out';
        nodeSeekWebLoginUserIdRef.current = null;
        webLoginDetectedRef.current = false;
        updateNodeSeekSession({ type: 'login-expired', message: 'NodeSeek 登录已失效' });
        setWebLoginUserId(null);
        void clearNodeSeekLoginCookiesOnly({
          generation: currentNodeSeekCredentialGeneration()
        }).catch(() => undefined);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, [
    currentNodeSeekLoginTrace,
    currentNodeSeekMessageSession,
    clearNodeSeekLoginCookiesOnly,
    currentNodeSeekCredentialGeneration,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    nodeSeekWebLoginUserIdRef,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    updateNodeSeekSession,
    webLoginDetectedRef
  ]);

  const probeLoginPage = useCallback(async () => {
    const trace = currentNodeSeekLoginTrace('manual');
    markDiagnosticStage(trace, 'transport', {
      source: 'nodeseek',
      channel: 'webview',
      state: 'started'
    });
    nodeSeekLoginPageStatusRef.current = 'unknown';
    webLoginDetectedRef.current = false;
    webViewRef.current?.injectJavaScript(nodeSeekLoginProbeScript(currentNodeSeekMessageSession()));
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (nodeSeekLoginTraceRef.current?.trace === trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'nodeseek',
        channel: 'webview',
        state: 'complete'
      });
    }
  }, [currentNodeSeekLoginTrace, currentNodeSeekMessageSession, webLoginDetectedRef, webViewRef]);

  const readCurrentNodeSeekCookies = useCallback(async (diagnosticTrace?: DiagnosticTrace) => {
    await probeLoginPage();
    if (nodeSeekLoginPageStatusRef.current === 'logged-out') {
      return null;
    }
    await CookieManager.flush();
    const nativeCookies = await readNodeSeekCookiesFromStores({ diagnosticTrace });
    const nodeSeekDocumentCookieHeader = nodeSeekWebViewCookieHeaderRef.current;
    return mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(nodeSeekDocumentCookieHeader));
  }, [nodeSeekWebViewCookieHeaderRef, probeLoginPage]);

  const rememberCurrentNodeSeekCookies = useCallback(async ({ silent = false, isCurrent = () => true }: { silent?: boolean; isCurrent?: () => boolean } = {}) => {
    const trace = currentNodeSeekLoginTrace('manual');
    try {
      const cookies = await readCurrentNodeSeekCookies(trace);
      if (!isCurrent()) {
        finishNodeSeekLoginTrace(trace, 'stale', { reason: 'stale' });
        return false;
      }
      if (!cookies) {
        finishNodeSeekLoginTrace(trace, 'blocked', { reason: 'login_required' });
        return false;
      }
      const summary = summarizeNodeSeekCookies(cookies);
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        count: summary.names.length,
        hasCredential: summary.names.length > 0,
        isLoggedIn: summary.loggedIn
      });
      markDiagnosticStage(trace, 'persist', {
        source: 'nodeseek',
        state: 'started',
        hasCredential: summary.names.length > 0
      });
      const cookieHeader = await saveNodeSeekCookieHeader(cookies, {
        verifiedByPage: webLoginDetectedRef.current,
        isCurrent,
        resetCurrentUser: nodeSeekCurrentUserId !== null
          && nodeSeekWebLoginUserIdRef.current !== null
          && String(nodeSeekWebLoginUserIdRef.current) !== String(nodeSeekCurrentUserId),
        userId: nodeSeekWebLoginUserIdRef.current,
        diagnosticTrace: trace
      });
      if (cookieHeader) {
        if (!isCurrent()) {
          finishNodeSeekLoginTrace(trace, 'stale', { reason: 'stale' });
          return false;
        }
        markDiagnosticStage(trace, 'persist', {
          source: 'nodeseek',
          state: 'saved',
          hasCredential: true
        });
        if (!silent) {
          notify(summary.loggedIn ? '已检测到 NodeSeek 登录 Cookie，已保存在本机。' : '已检测到 NodeSeek 验证信息，已保存在本机。');
        }
        finishNodeSeekLoginTrace(trace, 'success', {
          hasCredential: true,
          isLoggedIn: summary.loggedIn
        });
        return true;
      }
      if (!isCurrent()) {
        finishNodeSeekLoginTrace(trace, 'stale', { reason: 'stale' });
        return false;
      }
      if (!silent) {
        notify('没有检测到明确的 NodeSeek Cookie。请完成验证或登录后再试。');
      }
      finishNodeSeekLoginTrace(trace, 'blocked', { reason: 'missing_credential' });
      return false;
    } catch (error) {
      finishNodeSeekLoginTrace(trace, 'failure', {
        reason: normalizeDiagnosticReason(error)
      });
      throw error;
    }
  }, [currentNodeSeekLoginTrace, finishNodeSeekLoginTrace, nodeSeekCurrentUserId, notify, readCurrentNodeSeekCookies, saveNodeSeekCookieHeader, webLoginDetectedRef]);

  const checkLogin = useCallback(async () => {
    const trace = currentNodeSeekLoginTrace('manual');
    const requestId = ++checkingRequestIdRef.current;
    setChecking(true);
    try {
      await rememberCurrentNodeSeekCookies({ isCurrent: () => requestId === checkingRequestIdRef.current && showLoginPanelRef.current });
    } catch (error) {
      if (requestId === checkingRequestIdRef.current) {
        notify(errorMessage(error));
      } else {
        finishNodeSeekLoginTrace(trace, 'stale', { reason: 'stale' });
      }
    } finally {
      if (requestId === checkingRequestIdRef.current) {
        setChecking(false);
      }
    }
  }, [checkingRequestIdRef, currentNodeSeekLoginTrace, finishNodeSeekLoginTrace, notify, rememberCurrentNodeSeekCookies, setChecking, showLoginPanelRef]);

  const rememberVisibleNodeSeekCookies = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = nodeSeekLoginPanelRequestRef.current;
    return rememberCurrentNodeSeekCookies({
      silent,
      isCurrent: () => showLoginPanelRef.current && nodeSeekLoginPanelRequestRef.current === requestId
    });
  }, [nodeSeekLoginPanelRequestRef, rememberCurrentNodeSeekCookies, showLoginPanelRef]);

  const checkYaohuoCookie = useCallback(async () => {
    const trace = currentYaohuoLoginTrace('manual');
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      finishYaohuoLoginTrace(trace, outcome, fields);
    };
    if (yaohuoCredentialSuppressedRef.current) {
      markDiagnosticStage(trace, 'guard', {
        source: 'yaohuo',
        state: 'disabled'
      });
      notify('妖火临时匿名测试已开启，请关闭测试后再检测登录。');
      finishTrace('blocked', { state: 'disabled' });
      return;
    }
    const requestId = ++checkingRequestIdRef.current;
    const isCheckCurrent = () => requestId === checkingRequestIdRef.current
      && !yaohuoCredentialSuppressedRef.current;
    const yaohuoGeneration = currentYaohuoCredentialGeneration();
    let ownedYaohuoGeneration = yaohuoGeneration;
    const isCredentialFlowCurrent = () => isCheckCurrent()
      && currentYaohuoCredentialGeneration() === ownedYaohuoGeneration;
    const clearExpiredYaohuoCredential = async () => {
      if (!isCredentialFlowCurrent()) {
        return false;
      }
      try {
        const clear = clearYaohuoLoginState({ generation: yaohuoGeneration, isCurrent: isCheckCurrent });
        ownedYaohuoGeneration = currentYaohuoCredentialGeneration();
        const cleared = await clear;
        return cleared === true && isCredentialFlowCurrent();
      } catch {
        markDiagnosticStage(trace, 'credential', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          state: 'error',
          reason: 'storage_error'
        });
        return false;
      }
    };
    markDiagnosticStage(trace, 'guard', {
      source: 'yaohuo',
      state: 'open'
    });
    setChecking(true);
    try {
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        state: 'started'
      });
      await CookieManager.flush();
      if (!isCredentialFlowCurrent()) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      const cookieMaps = await Promise.all(YAOHUO_COOKIE_URLS.map(async (url) => CookieManager.get(url)));
      if (!isCredentialFlowCurrent()) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      const typedCookies = mergeYaohuoCookies(...cookieMaps as Array<Record<string, YaohuoNativeCookie>>);
      const summary = summarizeYaohuoCookies(typedCookies);
      const cookieHeader = buildYaohuoCookieHeader(typedCookies);
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        count: summary.names.length,
        hasCredential: Boolean(cookieHeader),
        isLoggedIn: summary.loggedIn
      });
      if (!summary.loggedIn || !canStoreYaohuoCookieHeader(typedCookies) || !cookieHeader) {
        updateYaohuoSession({
          type: summary.names.length ? 'verification-required' : 'cleared',
          ...(summary.names.length ? { message: '没有检测到明确的妖火登录 Cookie。' } : {})
        });
        notify('没有检测到明确的妖火登录 Cookie。请确认已经登录后再试。');
        finishTrace('blocked', { reason: 'missing_credential' });
        return;
      }
      markDiagnosticStage(trace, 'transport', {
        source: 'yaohuo',
        channel: 'direct',
        state: 'started'
      });
      const yaohuoLoginCheck = await checkYaohuoLogin({ yaohuoCookie: cookieHeader, yaohuoFetcher: forumFetchWithWebViewFallback });
      if (!isCredentialFlowCurrent()) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      markDiagnosticStage(trace, 'transport', {
        source: 'yaohuo',
        channel: 'direct',
        state: 'complete'
      });
      if (yaohuoLoginCheck.loginRequired || !yaohuoLoginCheck.ok) {
        if (yaohuoLoginCheck.reason === 'expired') {
          markDiagnosticStage(trace, 'credential', {
            source: 'yaohuo',
            generation: yaohuoGeneration,
            state: 'expired'
          });
          updateYaohuoSession({ type: 'login-expired', message: yaohuoLoginCheck.message || '妖火登录已失效，请重新登录。' });
          const cleared = await clearExpiredYaohuoCredential();
          if (!isCredentialFlowCurrent()) {
            finishTrace('stale', { reason: 'stale' });
            return;
          }
          if (cleared) {
            markDiagnosticStage(trace, 'apply', {
              source: 'yaohuo',
              generation: yaohuoGeneration,
              hasCredential: false,
              state: 'applied'
            });
          }
        } else {
          updateYaohuoSession({ type: 'verification-required', message: yaohuoLoginCheck.message || '妖火需要完成访问验证' });
        }
        notify(yaohuoLoginCheck.message || '妖火登录已失效，请重新登录。');
        finishTrace('blocked', {
          reason: yaohuoLoginCheck.reason === 'verification'
            ? 'verification_required'
            : yaohuoLoginCheck.loginRequired ? 'login_required' : 'verification_required'
        });
        return;
      }
      markDiagnosticStage(trace, 'persist', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        hasCredential: true,
        state: 'started'
      });
      const save = saveYaohuoCookieHeader(cookieHeader, {
        isCurrent: isCheckCurrent,
        generation: yaohuoGeneration,
        diagnosticTrace: trace
      });
      ownedYaohuoGeneration = currentYaohuoCredentialGeneration();
      const saved = await save;
      if (!saved) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      if (!isCredentialFlowCurrent()) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      markDiagnosticStage(trace, 'persist', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        hasCredential: true,
        state: 'saved'
      });
      updateYaohuoSession({
        type: 'login-detected',
        cookieSummary: summary.names,
        ...('currentUser' in yaohuoLoginCheck ? { currentUser: yaohuoLoginCheck.currentUser } : {}),
        at: new Date().toISOString()
      });
      markDiagnosticStage(trace, 'apply', {
        source: 'yaohuo',
        hasCredential: true,
        isLoggedIn: true,
        state: 'status-updated'
      });
      notify('已检测到妖火登录 Cookie，已保存在本机。');
      finishTrace('success', {
        hasCredential: true,
        isLoggedIn: true
      });
    } catch (error) {
      if (!isCredentialFlowCurrent()) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      if (isYaohuoLoginRequiredError(error)) {
        const expired = isYaohuoLoginExpiredError(error);
        if (expired) {
          const message = errorMessage(error);
          markDiagnosticStage(trace, 'credential', {
            source: 'yaohuo',
            generation: yaohuoGeneration,
            state: 'expired'
          });
          updateYaohuoSession({ type: 'login-expired', message });
          await clearExpiredYaohuoCredential();
          if (!isCredentialFlowCurrent()) {
            finishTrace('stale', { reason: 'stale' });
            return;
          }
          notify(message);
        } else {
          const message = errorMessage(error);
          updateYaohuoSession({ type: 'verification-required', message });
          notify(message);
        }
        finishTrace('blocked', { reason: expired ? 'login_required' : 'verification_required' });
        return;
      }
      notify(errorMessage(error));
      finishTrace('failure', { reason: normalizeDiagnosticReason(error) });
    } finally {
      if (yaohuoLoginTraceRef.current?.trace === trace) {
        finishTrace(isCredentialFlowCurrent() ? 'failure' : 'stale', {
          reason: isCredentialFlowCurrent() ? 'unknown' : 'stale'
        });
      }
      if (requestId === checkingRequestIdRef.current) {
        setChecking(false);
      }
    }
  }, [checkingRequestIdRef, clearYaohuoLoginState, currentYaohuoCredentialGeneration, currentYaohuoLoginTrace, finishYaohuoLoginTrace, forumFetchWithWebViewFallback, notify, saveYaohuoCookieHeader, setChecking, updateYaohuoSession, yaohuoCredentialSuppressedRef]);

  const clearLogin = useCallback(async () => {
    try {
      const cleared = await clearNodeSeekLoginState();
      if (cleared === false) {
        return;
      }
      webViewRef.current?.reload();
      notify('已清除本机保存的 NodeSeek Cookie。');
    } catch {
      notify('NodeSeek 登录信息清理失败，请稍后重试。');
    }
  }, [clearNodeSeekLoginState, notify, webViewRef]);

  const clearYaohuoLogin = useCallback(async () => {
    if (yaohuoCredentialSuppressedRef.current) {
      notify('妖火临时匿名测试已开启，请关闭测试后再清除登录。');
      return;
    }
    try {
      const cleared = await clearYaohuoLoginState();
      if (cleared === false) {
        return;
      }
      yaohuoWebViewRef.current?.reload();
      notify('已清除本机保存的妖火 Cookie。');
    } catch {
      notify('妖火登录信息清理失败，请稍后重试。');
    }
  }, [clearYaohuoLoginState, notify, yaohuoCredentialSuppressedRef, yaohuoWebViewRef]);

  const clearLinuxDoCookie = useCallback(async () => {
    let cleanupGeneration: number | undefined;
    try {
      const cleanup = clearLinuxDoAccess();
      cleanupGeneration = currentLinuxDoAccessGeneration();
      const access = await cleanup;
      if (cleanupGeneration !== currentLinuxDoAccessGeneration()) {
        return;
      }
      const summary = linuxDoAccessSummary(access);
      const cookieSummary = summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(access?.cookieHeader || '')).names;
      updateLinuxDoSession(summary.hasClearance
        ? { type: 'verification-succeeded', cookieSummary, loggedIn: false, at: new Date().toISOString() }
        : { type: 'cleared' });
      resetLinuxDoLevelState();
      resetLinuxDoWebView();
      notify(summary.hasClearance ? '已清除 linux.do 登录信息，保留访问验证。' : '已清除本机保存的 linux.do 登录信息。');
    } catch {
      if (cleanupGeneration !== undefined && cleanupGeneration !== currentLinuxDoAccessGeneration()) {
        return;
      }
      notify('linux.do 登录信息清理失败，请稍后重试。');
    }
  }, [notify, resetLinuxDoLevelState, resetLinuxDoWebView, updateLinuxDoSession]);

  const refreshLinuxDoLevel = useCallback(async () => {
    const requestId = ++linuxDoLevelRequestIdRef.current;
    const accessGeneration = currentLinuxDoAccessGeneration();
    let accessCookieHeader: string | undefined;
    setLinuxDoLevelBusy(true);
    setLinuxDoLevelError('');
    try {
      const access = await loadLinuxDoAccess();
      if (accessGeneration !== currentLinuxDoAccessGeneration()) {
        return;
      }
      accessCookieHeader = access?.cookieHeader;
      if (!access?.cookieHeader || !linuxDoAccessSummary(access).loggedIn) {
        setLinuxDoLevelProfile(null);
        setLinuxDoLevelError('请先完成 linux.do 登录 / 验证。');
        return;
      }
      const profile = await getLinuxDoLevelProfile({
        cookieHeader: access.cookieHeader,
        userAgent: access.userAgent || linuxDoWebViewUserAgentRef.current,
        fetcher: forumFetchWithWebViewFallback
      });
      if (
        requestId !== linuxDoLevelRequestIdRef.current
        || accessGeneration !== currentLinuxDoAccessGeneration()
      ) {
        return;
      }
      setLinuxDoLevelProfile(profile);
      notify('linux.do 等级已更新。');
    } catch (error) {
      if (
        requestId !== linuxDoLevelRequestIdRef.current
        || accessGeneration !== currentLinuxDoAccessGeneration()
      ) {
        return;
      }
      if (isLinuxDoCloudflareError(error)) {
        setLinuxDoLevelProfile(null);
        setLinuxDoLevelError('linux.do 等级读取需要完成 Cloudflare 验证');
        showLinuxDoVerification('linux.do 等级读取需要完成 Cloudflare 验证');
        return;
      }
      if (isLinuxDoLoginExpiredError(error)) {
        try {
          const cleared = await clearExpiredLinuxDoLogin({
            error,
            generation: accessGeneration,
            cookieHeader: accessCookieHeader,
            resetLinuxDoLevelState,
            updateLinuxDoSession
          });
          if (!cleared || requestId !== linuxDoLevelRequestIdRef.current) {
            return;
          }
        } catch {
          if (requestId !== linuxDoLevelRequestIdRef.current) {
            return;
          }
        }
        setLinuxDoLevelProfile(null);
        setLinuxDoLevelError(errorMessage(error));
        return;
      }
      setLinuxDoLevelError(errorMessage(error));
    } finally {
      if (requestId === linuxDoLevelRequestIdRef.current) {
        setLinuxDoLevelBusy(false);
      }
    }
  }, [
    forumFetchWithWebViewFallback,
    linuxDoLevelRequestIdRef,
    linuxDoWebViewUserAgentRef,
    notify,
    resetLinuxDoLevelState,
    setLinuxDoLevelBusy,
    setLinuxDoLevelError,
    setLinuxDoLevelProfile,
    showLinuxDoVerification,
    updateLinuxDoSession
  ]);

  return {
    checkLogin,
    checkYaohuoCookie,
    clearLinuxDoCookie,
    clearLogin,
    clearYaohuoLogin,
    handleLoginMessage,
    nodeSeekLoginProbeScript: nodeSeekProbeScript,
    recordNodeSeekLoginWebViewState,
    recordYaohuoLoginWebViewState,
    rememberVisibleNodeSeekCookies,
    refreshLinuxDoLevel
  };
}
