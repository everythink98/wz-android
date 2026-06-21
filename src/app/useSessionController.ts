import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import {
  DEFAULT_NODESEEK_ANDROID_USER_AGENT,
  buildCookieHeader,
  canStoreNodeSeekCookieHeader,
  mergeNodeSeekCookies,
  parseNodeSeekDocumentCookie,
  removeNodeSeekLoginCookies,
  sanitizeNodeSeekUserAgent,
  summarizeNodeSeekCookies
} from '../nodeseekCookies';
import { readNodeSeekCookiesFromWebView } from '../nodeseekCookieBridge';
import {
  buildYaohuoSetCookieHeaders,
  summarizeYaohuoCookies,
  yaohuoCookieMapFromHeader
} from '../yaohuoCookies';
import {
  buildLinuxDoCookieHeader,
  canStoreLinuxDoAccess,
  linuxDoAccessSummary,
  linuxDoClearanceValue,
  loadLinuxDoAccess,
  mergeLinuxDoCookies,
  parseLinuxDoDocumentCookie,
  readLinuxDoCookiesFromWebView,
  sanitizeLinuxDoUserAgent,
  saveLinuxDoAccess,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { clearCookieUrls } from '../cookieCleanup';
import { NODESEEK_URL, YAOHUO_URL } from '../appUrls';
import type { FeedSource, Source } from '../types';
import type { Fetcher } from '../request';
import { createNodeSeekWebViewFallbackFetcher, isNodeSeekRequestUrl } from '../nodeseekFetchFallback';
import { createLinuxDoWebViewFallbackFetcher, isLinuxDoRequestUrl } from '../linuxdoFetchFallback';
import { errorMessage } from '../appUtils';
import {
  createSiteSessionViewModels,
  createSiteSessionStates,
  reduceSiteSessionState,
  type ScopedSiteSessionEvent,
  type SessionSite,
  type SiteSessionEvent
} from '../siteSessionState';
import {
  createCredentialWriteGate,
  enqueueCredentialWrite,
  isCredentialWriteCurrent,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  rejectBrowserFetchRequest,
  requestHeaderValue,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  startNextBrowserFetchRequest
} from './sessionControllerHelpers';

const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const NODESEEK_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const LINUXDO_BROWSER_FETCH_TIMEOUT_MS = 15000;
const LINUXDO_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const YAOHUO_COOKIE_URLS = [YAOHUO_URL, 'https://www.yaohuo.me', 'http://yaohuo.me', 'http://www.yaohuo.me'];
const COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';
const NODESEEK_USER_AGENT_STORAGE_KEY = 'nodeseek-user-agent';
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';

export type NodeSeekBrowserFetchRequest = {
  id: number;
  url: string;
  cookie?: string;
  userAgent?: string;
};

type PendingNodeSeekBrowserFetchRequest = NodeSeekBrowserFetchRequest & {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  httpErrorStatus?: number;
  settled?: boolean;
};

export type LinuxDoBrowserFetchRequest = {
  id: number;
  url: string;
  cookie?: string;
  userAgent?: string;
};

type PendingLinuxDoBrowserFetchRequest = LinuxDoBrowserFetchRequest & {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  httpErrorStatus?: number;
  settled?: boolean;
};

type MutableRef<T> = { current: T };
type WebViewStopRef = { current: { stopLoading: () => void } | null };

export function useSessionController({
  linuxDoBrowserFetchCurrentRef,
  linuxDoBrowserFetchIdRef,
  linuxDoBrowserFetchQueueRef,
  linuxDoBrowserWebViewRef,
  linuxDoClearanceBeforeVerifyRef,
  linuxDoWebViewCookieHeaderRef,
  linuxDoWebViewUserAgentRef,
  nodeSeekBrowserFetchCurrentRef,
  nodeSeekBrowserFetchIdRef,
  nodeSeekBrowserFetchQueueRef,
  nodeSeekBrowserWebViewRef,
  nodeSeekWebViewCookieHeaderRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  rejectLinuxDoBrowserFetchRef,
  rejectNodeSeekBrowserFetchRef,
  setLinuxDoBrowserFetchRequest,
  setLinuxDoWebViewCookieHeader,
  setLinuxDoWebViewUserAgent,
  setNodeSeekBrowserFetchRequest,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  webLoginDetectedRef,
  webLoginUserId
}: {
  linuxDoBrowserFetchCurrentRef: MutableRef<PendingLinuxDoBrowserFetchRequest | null>;
  linuxDoBrowserFetchIdRef: MutableRef<number>;
  linuxDoBrowserFetchQueueRef: MutableRef<PendingLinuxDoBrowserFetchRequest[]>;
  linuxDoBrowserWebViewRef: WebViewStopRef;
  linuxDoClearanceBeforeVerifyRef: MutableRef<string | null>;
  linuxDoWebViewCookieHeaderRef: MutableRef<string>;
  linuxDoWebViewUserAgentRef: MutableRef<string>;
  nodeSeekBrowserFetchCurrentRef: MutableRef<PendingNodeSeekBrowserFetchRequest | null>;
  nodeSeekBrowserFetchIdRef: MutableRef<number>;
  nodeSeekBrowserFetchQueueRef: MutableRef<PendingNodeSeekBrowserFetchRequest[]>;
  nodeSeekBrowserWebViewRef: WebViewStopRef;
  nodeSeekWebViewCookieHeaderRef: MutableRef<string>;
  nodeSeekWebViewUserAgentRef: MutableRef<string>;
  notify: (message: string) => void;
  rejectLinuxDoBrowserFetchRef: MutableRef<((request: PendingLinuxDoBrowserFetchRequest, message: string) => void) | null>;
  rejectNodeSeekBrowserFetchRef: MutableRef<((request: PendingNodeSeekBrowserFetchRequest, message: string) => void) | null>;
  setLinuxDoBrowserFetchRequest: Dispatch<SetStateAction<LinuxDoBrowserFetchRequest | null>>;
  setLinuxDoWebViewCookieHeader: Dispatch<SetStateAction<string>>;
  setLinuxDoWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setNodeSeekBrowserFetchRequest: Dispatch<SetStateAction<NodeSeekBrowserFetchRequest | null>>;
  setNodeSeekWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setWebLoginUserId: Dispatch<SetStateAction<number | null>>;
  webLoginDetectedRef: MutableRef<boolean>;
  webLoginUserId: number | null;
}) {
  const nodeSeekCredentialGateRef = useRef(createCredentialWriteGate());
  const yaohuoCredentialGateRef = useRef(createCredentialWriteGate());
  const [siteSessionStates, setSiteSessionStates] = useState(() => createSiteSessionStates());
  const siteSessionViewModels = useMemo(() => createSiteSessionViewModels(siteSessionStates), [siteSessionStates]);
  const loginState = useMemo(() => {
    const nodeSeekSession = siteSessionViewModels.nodeseek;
    if (webLoginUserId) {
      return `网页已确认登录：用户 ${webLoginUserId}`;
    }
    if (nodeSeekSession.status === 'anonymous' && nodeSeekSession.cookieSummary.length === 0) {
      return '未检测到 NodeSeek 验证信息';
    }
    if (nodeSeekSession.isLoggedIn) {
      return nodeSeekSession.cookieSummary.length === 0 ? '已保存 NodeSeek 登录 Cookie' : `已检测登录 Cookie：${nodeSeekSession.cookieSummary.join(', ')}`;
    }
    if (nodeSeekSession.cookieSummary.length === 0) {
      return '已保存 NodeSeek 验证信息';
    }
    return `已检测验证 Cookie：${nodeSeekSession.cookieSummary.join(', ')}`;
  }, [siteSessionViewModels.nodeseek, webLoginUserId]);

  const yaohuoLoginState = useMemo(() => {
    const yaohuoSession = siteSessionViewModels.yaohuo;
    if (yaohuoSession.isLoggedIn) {
      return yaohuoSession.cookieSummary.length ? `已登录：${yaohuoSession.cookieSummary.join(', ')}` : '已登录';
    }
    if (yaohuoSession.cookieSummary.length) {
      return `未登录，已检测 ${yaohuoSession.cookieSummary.length} 个 Cookie：${yaohuoSession.cookieSummary.join(', ')}`;
    }
    return '未登录';
  }, [siteSessionViewModels.yaohuo]);

  const dispatchSiteSessionEvent = useCallback((event: ScopedSiteSessionEvent) => {
    setSiteSessionStates((current) => ({
      ...current,
      [event.site]: reduceSiteSessionState(current[event.site], event)
    }));
  }, []);

  const updateNodeSeekSession = useCallback((event: SiteSessionEvent) => {
    dispatchSiteSessionEvent({ ...event, site: 'nodeseek' });
  }, [dispatchSiteSessionEvent]);

  const updateLinuxDoSession = useCallback((event: SiteSessionEvent) => {
    dispatchSiteSessionEvent({ ...event, site: 'linuxdo' });
  }, [dispatchSiteSessionEvent]);

  const updateYaohuoSession = useCallback((event: SiteSessionEvent) => {
    dispatchSiteSessionEvent({ ...event, site: 'yaohuo' });
  }, [dispatchSiteSessionEvent]);

  useEffect(() => {
    void (async () => {
      const nodeSeekGeneration = nodeSeekCredentialGateRef.current.generation;
      const yaohuoGeneration = yaohuoCredentialGateRef.current.generation;
      const [savedCookie, savedNodeSeekUserAgent, savedYaohuoCookie, linuxDoAccess] = await Promise.all([
        SecureStore.getItemAsync(COOKIE_STORAGE_KEY),
        SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY),
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
        loadLinuxDoAccess()
      ]);
      const nodeSeekReadCurrent = isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, nodeSeekGeneration);
      const yaohuoReadCurrent = isCredentialWriteCurrent(yaohuoCredentialGateRef.current, yaohuoGeneration);
      if (nodeSeekReadCurrent && savedNodeSeekUserAgent) {
        const userAgent = sanitizeNodeSeekUserAgent(savedNodeSeekUserAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (nodeSeekReadCurrent && savedCookie) {
        const savedCookies = parseNodeSeekDocumentCookie(savedCookie);
        const summary = summarizeNodeSeekCookies(savedCookies);
        updateNodeSeekSession(siteEventWithCookieFacts('nodeseek', summary.names, canStoreNodeSeekCookieHeader(savedCookies), summary.loggedIn));
        notify(summary.loggedIn ? '已找到本机保存的 NodeSeek 登录 Cookie。' : '已找到本机保存的 NodeSeek 验证信息。');
      }
      if (yaohuoReadCurrent && savedYaohuoCookie) {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(savedYaohuoCookie));
        updateYaohuoSession(siteEventWithCookieFacts('yaohuo', yaohuoSummary.names, false, yaohuoSummary.loggedIn));
        notify('已找到本机保存的妖火 Cookie。');
      }
      const linuxDoSummary = linuxDoAccessSummary(linuxDoAccess);
      const linuxDoCookies = parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '');
      linuxDoClearanceBeforeVerifyRef.current = linuxDoClearanceValue(linuxDoCookies) || null;
      updateLinuxDoSession(siteEventWithCookieFacts('linuxdo', summarizeLinuxDoCookies(linuxDoCookies).names, linuxDoSummary.hasClearance, linuxDoSummary.loggedIn));
      if (linuxDoAccess?.userAgent) {
        const userAgent = sanitizeLinuxDoUserAgent(linuxDoAccess.userAgent);
        if (userAgent) {
          linuxDoWebViewUserAgentRef.current = userAgent;
          setLinuxDoWebViewUserAgent(userAgent);
        }
      }
    })()
      .catch((error) => notify(errorMessage(error)));
  }, [
    linuxDoClearanceBeforeVerifyRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    setLinuxDoWebViewUserAgent,
    setNodeSeekWebViewUserAgent,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession
  ]);

  const loadYaohuoCookieForSource = useCallback(async (source: FeedSource | Source) => {
    if (source !== 'all' && source !== 'yaohuo') {
      return undefined;
    }
    const generation = yaohuoCredentialGateRef.current.generation;
    const cookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    if (!isCredentialWriteCurrent(yaohuoCredentialGateRef.current, generation)) {
      return undefined;
    }
    const summary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookie || ''));
    updateYaohuoSession(siteEventWithCookieFacts('yaohuo', summary.names, false, summary.loggedIn));
    return cookie || undefined;
  }, [updateYaohuoSession]);

  const saveNodeSeekCookieHeader = useCallback(async (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    { verifiedByPage = false, isCurrent = () => true }: { verifiedByPage?: boolean; isCurrent?: () => boolean } = {}
  ) => {
    const summary = summarizeNodeSeekCookies(cookies);
    const cookieHeader = buildCookieHeader(cookies);
    const saved = await enqueueCredentialWrite(nodeSeekCredentialGateRef.current, async ({ isCurrent: isWriteCurrent }) => {
      const stillCurrent = () => isCurrent() && isWriteCurrent();
      if (!stillCurrent()) {
        return '';
      }
      if (canStoreNodeSeekCookieHeader(cookies, verifiedByPage) && cookieHeader) {
        await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, cookieHeader);
        await SecureStore.setItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY, nodeSeekWebViewUserAgentRef.current || DEFAULT_NODESEEK_ANDROID_USER_AGENT);
        if (!stillCurrent()) {
          return '';
        }
        updateNodeSeekSession(siteEventWithCookieFacts('nodeseek', summary.names, true, summary.loggedIn));
        return cookieHeader;
      }
      if (!stillCurrent()) {
        return '';
      }
      updateNodeSeekSession({
        type: summary.loggedIn ? 'login-detected' : 'verification-required',
        ...(summary.names.length ? { cookieSummary: summary.names } : {}),
        ...(summary.loggedIn ? { at: new Date().toISOString() } : {})
      });
      return '';
    });
    return saved || '';
  }, [nodeSeekWebViewUserAgentRef, updateNodeSeekSession]);

  const loadNodeSeekCookieForSource = useCallback(async (source: FeedSource | Source) => {
    if (source !== 'all' && source !== 'nodeseek') {
      return undefined;
    }
    const generation = nodeSeekCredentialGateRef.current.generation;
    const cookies = await readNodeSeekCookiesFromWebView();
    const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
    const webViewCookieHeader = await saveNodeSeekCookieHeader(mergeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie || ''), cookies));
    if (!isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)) {
      return undefined;
    }
    if (webViewCookieHeader) {
      return webViewCookieHeader;
    }
    if (savedCookie) {
      const savedCookies = parseNodeSeekDocumentCookie(savedCookie);
      const summary = summarizeNodeSeekCookies(savedCookies);
      updateNodeSeekSession(siteEventWithCookieFacts('nodeseek', summary.names, canStoreNodeSeekCookieHeader(savedCookies), summary.loggedIn));
      return savedCookie;
    }
    updateNodeSeekSession({ type: 'cleared' });
    return undefined;
  }, [saveNodeSeekCookieHeader, updateNodeSeekSession]);

  const startNextNodeSeekBrowserFetch = useCallback(() => {
    startNextBrowserFetchRequest({
      currentRef: nodeSeekBrowserFetchCurrentRef,
      queueRef: nodeSeekBrowserFetchQueueRef,
      setActiveRequest: setNodeSeekBrowserFetchRequest,
      timeoutMs: NODESEEK_BROWSER_FETCH_TIMEOUT_MS,
      timeoutMessage: 'NodeSeek 页面读取超时',
      rejectCurrent: (request, message) => rejectNodeSeekBrowserFetchRef.current?.(request, message)
    });
  }, [nodeSeekBrowserFetchCurrentRef, nodeSeekBrowserFetchQueueRef, rejectNodeSeekBrowserFetchRef, setNodeSeekBrowserFetchRequest]);

  const rejectNodeSeekBrowserFetch = useCallback((request: PendingNodeSeekBrowserFetchRequest, message: string) => {
    rejectBrowserFetchRequest({
      request,
      message,
      currentRef: nodeSeekBrowserFetchCurrentRef,
      queueRef: nodeSeekBrowserFetchQueueRef,
      setActiveRequest: setNodeSeekBrowserFetchRequest,
      startNext: startNextNodeSeekBrowserFetch,
      webViewRef: nodeSeekBrowserWebViewRef
    });
  }, [nodeSeekBrowserFetchCurrentRef, nodeSeekBrowserFetchQueueRef, nodeSeekBrowserWebViewRef, setNodeSeekBrowserFetchRequest, startNextNodeSeekBrowserFetch]);
  rejectNodeSeekBrowserFetchRef.current = rejectNodeSeekBrowserFetch;

  const nodeSeekFetchWithWebView: Fetcher = useCallback((input, init) => {
    const url = String(input);
    if (!isNodeSeekRequestUrl(url)) {
      return fetch(input, init);
    }
    return new Promise<Response>((resolve, reject) => {
      let request: PendingNodeSeekBrowserFetchRequest;
      const id = ++nodeSeekBrowserFetchIdRef.current;
      const cookie = requestHeaderValue(init?.headers, 'cookie');
      const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
      request = {
        id,
        url,
        cookie,
        userAgent,
        resolve,
        reject,
        abortSignal: init?.signal || undefined
      };
      request.abortHandler = () => {
        rejectNodeSeekBrowserFetch(request, '请求已取消');
      };
      if (request.abortSignal) {
        if (request.abortSignal.aborted) {
          rejectNodeSeekBrowserFetch(request, '请求已取消');
          return;
        }
        request.abortSignal.addEventListener('abort', request.abortHandler, { once: true });
      }
      nodeSeekBrowserFetchQueueRef.current.push(request);
      startNextNodeSeekBrowserFetch();
    });
  }, [nodeSeekBrowserFetchIdRef, nodeSeekBrowserFetchQueueRef, rejectNodeSeekBrowserFetch, startNextNodeSeekBrowserFetch]);

  const completeNodeSeekBrowserFetch = useCallback(async (data: {
    id?: number;
    url?: string;
    html?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
  }) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    if (!data.url || !isNodeSeekRequestUrl(data.url)) {
      rejectNodeSeekBrowserFetch(current, 'NodeSeek 页面跳转到外部地址，已停止读取');
      return;
    }
    nodeSeekBrowserWebViewRef.current?.stopLoading();
    nodeSeekBrowserFetchCurrentRef.current = null;
    setNodeSeekBrowserFetchRequest(null);
    const userAgent = sanitizeNodeSeekUserAgent(data.userAgent);
    if (userAgent) {
      nodeSeekWebViewUserAgentRef.current = userAgent;
      setNodeSeekWebViewUserAgent(userAgent);
    }
    if (typeof data.cookie === 'string') {
      nodeSeekWebViewCookieHeaderRef.current = data.cookie;
    }
    const settled = settleBrowserFetchRequestOnce(current, () => {
      current.resolve(nodeSeekBrowserResponse(data.html || '', Boolean(data.challenge), current.httpErrorStatus));
    });
    if (!settled) {
      return;
    }
    startNextNodeSeekBrowserFetch();
    if (typeof data.cookie === 'string') {
      void runBestEffortTask(async () => {
        await CookieManager.flush();
        const nativeCookies = await readNodeSeekCookiesFromWebView();
        await saveNodeSeekCookieHeader(mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(data.cookie || '')));
      }, NODESEEK_COOKIE_PERSIST_TIMEOUT_MS);
    }
  }, [
    nodeSeekBrowserFetchCurrentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    rejectNodeSeekBrowserFetch,
    saveNodeSeekCookieHeader,
    setNodeSeekBrowserFetchRequest,
    setNodeSeekWebViewUserAgent,
    startNextNodeSeekBrowserFetch
  ]);

  const failNodeSeekBrowserFetchById = useCallback((requestId: number, message: string) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (current?.id === requestId) {
      rejectNodeSeekBrowserFetch(current, message);
    }
  }, [nodeSeekBrowserFetchCurrentRef, rejectNodeSeekBrowserFetch]);

  const startNextLinuxDoBrowserFetch = useCallback(() => {
    startNextBrowserFetchRequest({
      currentRef: linuxDoBrowserFetchCurrentRef,
      queueRef: linuxDoBrowserFetchQueueRef,
      setActiveRequest: setLinuxDoBrowserFetchRequest,
      timeoutMs: LINUXDO_BROWSER_FETCH_TIMEOUT_MS,
      timeoutMessage: 'linux.do 页面读取超时',
      rejectCurrent: (request, message) => rejectLinuxDoBrowserFetchRef.current?.(request, message)
    });
  }, [linuxDoBrowserFetchCurrentRef, linuxDoBrowserFetchQueueRef, rejectLinuxDoBrowserFetchRef, setLinuxDoBrowserFetchRequest]);

  const rejectLinuxDoBrowserFetch = useCallback((request: PendingLinuxDoBrowserFetchRequest, message: string) => {
    rejectBrowserFetchRequest({
      request,
      message,
      currentRef: linuxDoBrowserFetchCurrentRef,
      queueRef: linuxDoBrowserFetchQueueRef,
      setActiveRequest: setLinuxDoBrowserFetchRequest,
      startNext: startNextLinuxDoBrowserFetch,
      webViewRef: linuxDoBrowserWebViewRef
    });
  }, [linuxDoBrowserFetchCurrentRef, linuxDoBrowserFetchQueueRef, linuxDoBrowserWebViewRef, setLinuxDoBrowserFetchRequest, startNextLinuxDoBrowserFetch]);
  rejectLinuxDoBrowserFetchRef.current = rejectLinuxDoBrowserFetch;

  const linuxDoFetchWithWebView: Fetcher = useCallback((input, init) => {
    const url = String(input);
    if (!isLinuxDoRequestUrl(url)) {
      return fetch(input, init);
    }
    return new Promise<Response>((resolve, reject) => {
      let request: PendingLinuxDoBrowserFetchRequest;
      const id = ++linuxDoBrowserFetchIdRef.current;
      const cookie = requestHeaderValue(init?.headers, 'cookie');
      const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
      request = {
        id,
        url,
        cookie,
        userAgent,
        resolve,
        reject,
        abortSignal: init?.signal || undefined
      };
      request.abortHandler = () => {
        rejectLinuxDoBrowserFetch(request, '请求已取消');
      };
      if (request.abortSignal) {
        if (request.abortSignal.aborted) {
          rejectLinuxDoBrowserFetch(request, '请求已取消');
          return;
        }
        request.abortSignal.addEventListener('abort', request.abortHandler, { once: true });
      }
      linuxDoBrowserFetchQueueRef.current.push(request);
      startNextLinuxDoBrowserFetch();
    });
  }, [linuxDoBrowserFetchIdRef, linuxDoBrowserFetchQueueRef, rejectLinuxDoBrowserFetch, startNextLinuxDoBrowserFetch]);

  const nodeSeekFetchWithWebViewFallback = useMemo(() => createNodeSeekWebViewFallbackFetcher({
    defaultFetcher: fetch,
    webViewFetcher: nodeSeekFetchWithWebView
  }), [nodeSeekFetchWithWebView]);

  const forumFetchWithWebViewFallback = useMemo(() => createLinuxDoWebViewFallbackFetcher({
    defaultFetcher: nodeSeekFetchWithWebViewFallback,
    webViewFetcher: linuxDoFetchWithWebView
  }), [linuxDoFetchWithWebView, nodeSeekFetchWithWebViewFallback]);

  const completeLinuxDoBrowserFetch = useCallback(async (data: {
    id?: number;
    url?: string;
    body?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
  }) => {
    const current = linuxDoBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    if (!data.url || !isLinuxDoRequestUrl(data.url)) {
      rejectLinuxDoBrowserFetch(current, 'linux.do 页面跳转到外部地址，已停止读取');
      return;
    }
    linuxDoBrowserWebViewRef.current?.stopLoading();
    linuxDoBrowserFetchCurrentRef.current = null;
    setLinuxDoBrowserFetchRequest(null);
    const userAgent = sanitizeLinuxDoUserAgent(data.userAgent);
    if (userAgent) {
      linuxDoWebViewUserAgentRef.current = userAgent;
      setLinuxDoWebViewUserAgent(userAgent);
    }
    if (typeof data.cookie === 'string') {
      linuxDoWebViewCookieHeaderRef.current = data.cookie;
      setLinuxDoWebViewCookieHeader(data.cookie);
    }
    const settled = settleBrowserFetchRequestOnce(current, () => {
      current.resolve(linuxDoBrowserResponse(data.body || '', Boolean(data.challenge), current.httpErrorStatus));
    });
    if (!settled) {
      return;
    }
    startNextLinuxDoBrowserFetch();
    if (!data.challenge && typeof data.cookie === 'string') {
      void runBestEffortTask(async () => {
        await CookieManager.flush();
        const [savedAccess, nativeCookies] = await Promise.all([
          loadLinuxDoAccess(),
          readLinuxDoCookiesFromWebView()
        ]);
        const cookies = mergeLinuxDoCookies(
          parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || ''),
          nativeCookies,
          parseLinuxDoDocumentCookie(data.cookie || '')
        );
        const cookieHeader = buildLinuxDoCookieHeader(cookies);
        if (canStoreLinuxDoAccess(cookies) && cookieHeader) {
          await saveLinuxDoAccess(cookieHeader, linuxDoWebViewUserAgentRef.current || userAgent || undefined);
          const summary = summarizeLinuxDoCookies(cookies);
          updateLinuxDoSession({
            type: 'verification-succeeded',
            cookieSummary: summary.names,
            loggedIn: summary.loggedIn,
            at: new Date().toISOString()
          });
        }
      }, LINUXDO_COOKIE_PERSIST_TIMEOUT_MS);
    } else if (typeof data.cookie === 'string') {
      void runBestEffortTask(async () => {
        await CookieManager.flush();
      }, LINUXDO_COOKIE_PERSIST_TIMEOUT_MS);
    }
  }, [
    linuxDoBrowserFetchCurrentRef,
    linuxDoBrowserWebViewRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewUserAgentRef,
    rejectLinuxDoBrowserFetch,
    setLinuxDoBrowserFetchRequest,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewUserAgent,
    startNextLinuxDoBrowserFetch,
    updateLinuxDoSession
  ]);

  const failLinuxDoBrowserFetchById = useCallback((requestId: number, message: string) => {
    const current = linuxDoBrowserFetchCurrentRef.current;
    if (current?.id === requestId) {
      rejectLinuxDoBrowserFetch(current, message);
    }
  }, [linuxDoBrowserFetchCurrentRef, rejectLinuxDoBrowserFetch]);

  const restoreSavedYaohuoCookiesToWebView = useCallback(async () => {
    await enqueueCredentialWrite(yaohuoCredentialGateRef.current, async ({ isCurrent }) => {
      const cookieHeader = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      if (!isCurrent()) {
        return;
      }
      if (!cookieHeader) {
        updateYaohuoSession({ type: 'cleared' });
        return;
      }
      const summary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookieHeader));
      updateYaohuoSession(siteEventWithCookieFacts('yaohuo', summary.names, false, summary.loggedIn));
      const headers = buildYaohuoSetCookieHeaders(cookieHeader);
      for (const url of YAOHUO_COOKIE_URLS) {
        for (const header of headers) {
          if (!isCurrent()) {
            return;
          }
          await CookieManager.setFromResponse(url, header);
        }
      }
      if (headers.length && isCurrent()) {
        await CookieManager.flush();
      }
    });
  }, [updateYaohuoSession]);

  const saveYaohuoCookieHeader = useCallback(async (
    cookieHeader: string,
    { isCurrent = () => true }: { isCurrent?: () => boolean } = {}
  ) => {
    const saved = await enqueueCredentialWrite(yaohuoCredentialGateRef.current, async ({ isCurrent: isWriteCurrent }) => {
      if (!isCurrent() || !isWriteCurrent()) {
        return false;
      }
      await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, cookieHeader);
      return isCurrent() && isWriteCurrent();
    });
    return saved === true;
  }, []);

  const clearStoredYaohuoLoginState = useCallback(async () => {
    await enqueueCredentialWrite(yaohuoCredentialGateRef.current, () => SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY), { advanceGeneration: true });
    updateYaohuoSession({ type: 'cleared' });
  }, [updateYaohuoSession]);

  const clearStoredNodeSeekLoginState = useCallback(async () => {
    await enqueueCredentialWrite(nodeSeekCredentialGateRef.current, async () => {
      await SecureStore.deleteItemAsync(COOKIE_STORAGE_KEY);
      await SecureStore.deleteItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY);
    }, { advanceGeneration: true });
    webLoginDetectedRef.current = false;
    nodeSeekWebViewCookieHeaderRef.current = '';
    updateNodeSeekSession({ type: 'cleared' });
    setWebLoginUserId(null);
    nodeSeekWebViewUserAgentRef.current = DEFAULT_NODESEEK_ANDROID_USER_AGENT;
    setNodeSeekWebViewUserAgent(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  }, [
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    updateNodeSeekSession,
    webLoginDetectedRef
  ]);

  const clearYaohuoLoginState = useCallback(async () => {
    await clearStoredYaohuoLoginState();
    await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);
  }, [clearStoredYaohuoLoginState]);

  const clearNodeSeekLoginState = useCallback(async () => {
    await clearStoredNodeSeekLoginState();
    await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
  }, [clearStoredNodeSeekLoginState]);

  const clearNodeSeekLoginCookiesOnly = useCallback(async () => {
    webLoginDetectedRef.current = false;
    setWebLoginUserId(null);
    updateNodeSeekSession({ type: 'login-expired', message: 'NodeSeek 登录已失效' });
    const verification = await enqueueCredentialWrite(nodeSeekCredentialGateRef.current, async () => {
      const cookieHeader = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
      const verificationCookies = removeNodeSeekLoginCookies(parseNodeSeekDocumentCookie(cookieHeader || ''));
      const verificationHeader = buildCookieHeader(verificationCookies);
      if (!canStoreNodeSeekCookieHeader(verificationCookies) || !verificationHeader) {
        return null;
      }
      await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, verificationHeader);
      return {
        header: verificationHeader,
        summary: summarizeNodeSeekCookies(verificationCookies)
      };
    }, { advanceGeneration: true });
    if (verification) {
      nodeSeekWebViewCookieHeaderRef.current = verification.header;
      await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
      updateNodeSeekSession({
        type: 'verification-succeeded',
        cookieSummary: verification.summary.names,
        loggedIn: false,
        at: new Date().toISOString()
      });
      return;
    }
    await clearNodeSeekLoginState();
  }, [
    clearNodeSeekLoginState,
    nodeSeekWebViewCookieHeaderRef,
    setWebLoginUserId,
    updateNodeSeekSession,
    webLoginDetectedRef
  ]);

  return {
    clearNodeSeekLoginCookiesOnly,
    clearNodeSeekLoginState,
    clearStoredNodeSeekLoginState,
    clearStoredYaohuoLoginState,
    clearYaohuoLoginState,
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    dispatchSiteSessionEvent,
    forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loginState,
    restoreSavedYaohuoCookiesToWebView,
    saveNodeSeekCookieHeader,
    saveYaohuoCookieHeader,
    siteSessionStates,
    siteSessionViewModels,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession,
    yaohuoLoginState
  };
}

function siteEventWithCookieFacts(site: SessionSite, cookieSummary: string[], hasVerification: boolean, loggedIn: boolean, at = new Date().toISOString()): ScopedSiteSessionEvent {
  return {
    site,
    type: 'cookie-loaded',
    cookieSummary,
    hasVerification,
    loggedIn,
    at
  };
}
