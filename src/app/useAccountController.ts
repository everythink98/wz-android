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
import { checkYaohuoLogin, getLinuxDoLevelProfile, type LinuxDoLevelProfile } from '../sources/sourceGateway';
import type { Fetcher } from '../request';
import type { SiteSessionEvent } from '../siteSessionState';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '../loginWebViewScripts';
import type { CredentialClearOptions } from './sessionControllerHelpers';
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
type LoginWebViewDiagnosticState = 'start' | 'ready' | 'error' | 'renderer-gone';

export function useAccountController({
  checkingRequestIdRef,
  clearNodeSeekLoginState,
  clearYaohuoLoginState,
  currentYaohuoCredentialGeneration,
  forumFetchWithWebViewFallback,
  linuxDoLevelRequestIdRef,
  linuxDoWebViewUserAgentRef,
  nodeSeekLoginPanelRequestRef,
  nodeSeekWebViewCookieHeaderRef,
  nodeSeekWebViewUserAgentRef,
  notify,
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
  yaohuoWebViewRef
}: {
  checkingRequestIdRef: Ref<number>;
  clearNodeSeekLoginState: () => Promise<void>;
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  currentYaohuoCredentialGeneration: () => number;
  forumFetchWithWebViewFallback: Fetcher;
  linuxDoLevelRequestIdRef: Ref<number>;
  linuxDoWebViewUserAgentRef: Ref<string>;
  nodeSeekLoginPanelRequestRef: Ref<number>;
  nodeSeekWebViewCookieHeaderRef: Ref<string>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  resetLinuxDoLevelState: () => void;
  resetLinuxDoWebView: () => void;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { verifiedByPage?: boolean; isCurrent?: () => boolean; resetCurrentUser?: boolean; userId?: number | null; csrfToken?: string | null; diagnosticTrace?: DiagnosticTrace }
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
  yaohuoWebViewRef: Ref<WebView | null>;
}) {
  const nodeSeekWebLoginUserIdRef = useRef<number | null>(null);
  const nodeSeekWebLoginCsrfTokenRef = useRef('');
  const nodeSeekLoginTraceRef = useRef<{ trace: DiagnosticTrace; panelRequestId: number } | null>(null);
  const wasNodeSeekLoginPanelVisibleRef = useRef(false);
  const yaohuoLoginTraceRef = useRef<{ trace: DiagnosticTrace; panelRequestId: number } | null>(null);
  const wasYaohuoLoginPanelVisibleRef = useRef(false);
  const observedYaohuoLoginPanelRequestRef = useRef(yaohuoLoginPanelRequestRef.current);

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

  const recordNodeSeekLoginWebViewState = useCallback((state: LoginWebViewDiagnosticState) => {
    const trace = currentNodeSeekLoginTrace('open');
    if (state === 'error' || state === 'renderer-gone') {
      const reason = state === 'renderer-gone' ? 'renderer_gone' : 'network_error';
      markDiagnosticStage(trace, 'transport', { source: 'nodeseek', channel: 'webview', state: 'failure', reason });
      finishNodeSeekLoginTrace(trace, 'failure', { reason });
      return;
    }
    markDiagnosticStage(trace, 'transport', {
      source: 'nodeseek',
      channel: 'webview',
      state: state === 'start' ? 'started' : 'ready'
    });
  }, [currentNodeSeekLoginTrace, finishNodeSeekLoginTrace]);

  const recordYaohuoLoginWebViewState = useCallback((state: LoginWebViewDiagnosticState) => {
    const trace = currentYaohuoLoginTrace('open');
    if (state === 'error' || state === 'renderer-gone') {
      const reason = state === 'renderer-gone' ? 'renderer_gone' : 'network_error';
      markDiagnosticStage(trace, 'transport', { source: 'yaohuo', channel: 'webview', state: 'failure', reason });
      finishYaohuoLoginTrace(trace, 'failure', { reason });
      return;
    }
    markDiagnosticStage(trace, 'transport', {
      source: 'yaohuo',
      channel: 'webview',
      state: state === 'start' ? 'started' : 'ready'
    });
  }, [currentYaohuoLoginTrace, finishYaohuoLoginTrace]);

  const handleLoginMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        loggedIn?: boolean;
        userId?: number | null;
        csrfToken?: string;
        userAgent?: string;
        cookie?: string;
      };
      if (data.type === 'nodeseek-login') {
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
      if (data.type === 'nodeseek-login' && typeof data.csrfToken === 'string') {
        nodeSeekWebLoginCsrfTokenRef.current = data.csrfToken.trim();
      }
      if (data.type === 'nodeseek-login' && data.loggedIn) {
        webLoginDetectedRef.current = true;
        if (Number.isInteger(data.userId)) {
          nodeSeekWebLoginUserIdRef.current = data.userId || null;
          setWebLoginUserId(data.userId || null);
        } else {
          nodeSeekWebLoginUserIdRef.current = null;
          setWebLoginUserId(null);
        }
      } else if (data.type === 'nodeseek-login' && data.loggedIn === false) {
        nodeSeekWebLoginUserIdRef.current = null;
        nodeSeekWebLoginCsrfTokenRef.current = '';
        webLoginDetectedRef.current = false;
        updateNodeSeekSession({ type: 'login-expired', message: 'NodeSeek 登录已失效' });
        setWebLoginUserId(null);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, [
    currentNodeSeekLoginTrace,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    nodeSeekWebLoginCsrfTokenRef,
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
    nodeSeekWebLoginUserIdRef.current = null;
    nodeSeekWebLoginCsrfTokenRef.current = '';
    webLoginDetectedRef.current = false;
    webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (nodeSeekLoginTraceRef.current?.trace === trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'nodeseek',
        channel: 'webview',
        state: 'complete'
      });
    }
  }, [currentNodeSeekLoginTrace, webLoginDetectedRef, webViewRef]);

  const readCurrentNodeSeekCookies = useCallback(async (diagnosticTrace?: DiagnosticTrace) => {
    await probeLoginPage();
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
        resetCurrentUser: true,
        userId: nodeSeekWebLoginUserIdRef.current,
        csrfToken: nodeSeekWebLoginCsrfTokenRef.current || undefined,
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
  }, [currentNodeSeekLoginTrace, finishNodeSeekLoginTrace, notify, readCurrentNodeSeekCookies, saveNodeSeekCookieHeader, webLoginDetectedRef]);

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
    const requestId = ++checkingRequestIdRef.current;
    const yaohuoGeneration = currentYaohuoCredentialGeneration();
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
      const cookieMaps = await Promise.all(YAOHUO_COOKIE_URLS.map(async (url) => CookieManager.get(url)));
      if (requestId !== checkingRequestIdRef.current) {
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
      if (requestId !== checkingRequestIdRef.current) {
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
          await clearYaohuoLoginState({ generation: yaohuoGeneration });
          if (requestId !== checkingRequestIdRef.current) {
            finishTrace('stale', { reason: 'stale' });
            return;
          }
          markDiagnosticStage(trace, 'apply', {
            source: 'yaohuo',
            generation: yaohuoGeneration,
            hasCredential: false,
            state: 'applied'
          });
        } else {
          updateYaohuoSession({ type: 'verification-required', message: yaohuoLoginCheck.message || '妖火需要完成访问验证' });
        }
        notify(yaohuoLoginCheck.message || '妖火登录已失效，请重新登录。');
        finishTrace('blocked', {
          reason: yaohuoLoginCheck.loginRequired ? 'login_required' : 'verification_required'
        });
        return;
      }
      markDiagnosticStage(trace, 'persist', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        hasCredential: true,
        state: 'started'
      });
      const saved = await saveYaohuoCookieHeader(cookieHeader, {
        generation: yaohuoGeneration,
        isCurrent: () => requestId === checkingRequestIdRef.current,
        diagnosticTrace: trace
      });
      if (!saved) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      if (requestId !== checkingRequestIdRef.current) {
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
      if (requestId !== checkingRequestIdRef.current) {
        finishTrace('stale', { reason: 'stale' });
        return;
      }
      if (isYaohuoLoginRequiredError(error)) {
        if (isYaohuoLoginExpiredError(error)) {
          markDiagnosticStage(trace, 'credential', {
            source: 'yaohuo',
            generation: yaohuoGeneration,
            state: 'expired'
          });
          await clearYaohuoLoginState({ generation: yaohuoGeneration });
          if (requestId !== checkingRequestIdRef.current) {
            finishTrace('stale', { reason: 'stale' });
            return;
          }
          notify('妖火登录已失效，请重新登录。');
        } else {
          notify(errorMessage(error));
        }
        finishTrace('blocked', { reason: 'login_required' });
        return;
      }
      notify(errorMessage(error));
      finishTrace('failure', { reason: normalizeDiagnosticReason(error) });
    } finally {
      if (yaohuoLoginTraceRef.current?.trace === trace) {
        finishTrace(requestId === checkingRequestIdRef.current ? 'failure' : 'stale', {
          reason: requestId === checkingRequestIdRef.current ? 'unknown' : 'stale'
        });
      }
      if (requestId === checkingRequestIdRef.current) {
        setChecking(false);
      }
    }
  }, [checkingRequestIdRef, clearYaohuoLoginState, currentYaohuoCredentialGeneration, currentYaohuoLoginTrace, finishYaohuoLoginTrace, forumFetchWithWebViewFallback, notify, saveYaohuoCookieHeader, setChecking, updateYaohuoSession]);

  const clearLogin = useCallback(async () => {
    await clearNodeSeekLoginState();
    webViewRef.current?.reload();
    notify('已清除本机保存的 NodeSeek Cookie。');
  }, [clearNodeSeekLoginState, notify, webViewRef]);

  const clearYaohuoLogin = useCallback(async () => {
    await clearYaohuoLoginState();
    yaohuoWebViewRef.current?.reload();
    notify('已清除本机保存的妖火 Cookie。');
  }, [clearYaohuoLoginState, notify, yaohuoWebViewRef]);

  const clearLinuxDoCookie = useCallback(async () => {
    const access = await clearLinuxDoAccess();
    const summary = linuxDoAccessSummary(access);
    const cookieSummary = summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(access?.cookieHeader || '')).names;
    updateLinuxDoSession(summary.hasClearance
      ? { type: 'verification-succeeded', cookieSummary, loggedIn: false, at: new Date().toISOString() }
      : { type: 'cleared' });
    resetLinuxDoLevelState();
    resetLinuxDoWebView();
    notify(summary.hasClearance ? '已清除 linux.do 登录信息，保留访问验证。' : '已清除本机保存的 linux.do 登录信息。');
  }, [notify, resetLinuxDoLevelState, resetLinuxDoWebView, updateLinuxDoSession]);

  const refreshLinuxDoLevel = useCallback(async () => {
    const requestId = ++linuxDoLevelRequestIdRef.current;
    setLinuxDoLevelBusy(true);
    setLinuxDoLevelError('');
    try {
      const access = await loadLinuxDoAccess();
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
      if (requestId !== linuxDoLevelRequestIdRef.current) {
        return;
      }
      setLinuxDoLevelProfile(profile);
      notify('linux.do 等级已更新。');
    } catch (error) {
      if (requestId !== linuxDoLevelRequestIdRef.current) {
        return;
      }
      if (isLinuxDoCloudflareError(error)) {
        setLinuxDoLevelProfile(null);
        setLinuxDoLevelError('linux.do 等级读取需要完成 Cloudflare 验证');
        showLinuxDoVerification('linux.do 等级读取需要完成 Cloudflare 验证');
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
    setLinuxDoLevelBusy,
    setLinuxDoLevelError,
    setLinuxDoLevelProfile,
    showLinuxDoVerification
  ]);

  return {
    checkLogin,
    checkYaohuoCookie,
    clearLinuxDoCookie,
    clearLogin,
    clearYaohuoLogin,
    handleLoginMessage,
    recordNodeSeekLoginWebViewState,
    recordYaohuoLoginWebViewState,
    rememberVisibleNodeSeekCookies,
    refreshLinuxDoLevel
  };
}
