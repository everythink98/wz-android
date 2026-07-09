import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import {
  DEFAULT_NODESEEK_ANDROID_USER_AGENT,
  buildCookieHeader,
  canStoreNodeSeekCookieHeader,
  mergeNodeSeekCookies,
  nodeSeekBrowserCookieHeaderForPersistence,
  nodeSeekCsrfTokenFromHtml,
  nodeSeekCredentialUserId,
  nodeSeekLoginCookieNames,
  nodeSeekUserIdFromCookies,
  nodeSeekAccessRecord,
  NODESEEK_ACCESS_STORAGE_KEY,
  NODESEEK_COOKIE_STORAGE_KEY,
  NODESEEK_USER_AGENT_STORAGE_KEY,
  parseNodeSeekDocumentCookie,
  parseNodeSeekAccessRecord,
  removeNodeSeekLoginCookies,
  sanitizeNodeSeekUserAgent,
  summarizeNodeSeekCookies
} from '../nodeseekCookies';
import { readNodeSeekCookiesFromStores } from '../nodeseekCookieBridge';
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
  readLinuxDoCookiesFromStores,
  sanitizeLinuxDoUserAgent,
  currentLinuxDoAccessGeneration,
  saveLinuxDoAccessForGeneration,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { clearCookieUrls } from '../cookieCleanup';
import { NODESEEK_URL, YAOHUO_URL } from '../appUrls';
import type { FeedSource, Source } from '../types';
import type { Fetcher } from '../request';
import { createNodeSeekWebViewFallbackFetcher, isNodeSeekBrowserFetchUrl, isNodeSeekRequestUrl } from '../nodeseekFetchFallback';
import { createLinuxDoWebViewFallbackFetcher, isLinuxDoBrowserFetchUrl, isLinuxDoRequestUrl } from '../linuxdoFetchFallback';
import { browserFetchIntentFromInit, type BrowserFetchIntent } from '../browserFetchIntent';
import { errorMessage } from '../appUtils';
import {
  createSiteSessionViewModels,
  createSiteSessionStates,
  nodeSeekLoginStateLabel,
  reduceSiteSessionState,
  type ScopedSiteSessionEvent,
  type SessionSite,
  type SiteSessionEvent
} from '../siteSessionState';
import {
  createCredentialWriteGate,
  enqueueLatestBrowserFetchRequest,
  enqueueCredentialWriteForGeneration,
  enqueueCredentialWrite,
  isCredentialWriteCurrent,
  preemptActiveBrowserFetchRequest,
  replaceCredentialWrite,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  rejectBrowserFetchRequest,
  requestHeaderValue,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  shouldKeepQueuedBrowserFetchRequest,
  startNextBrowserFetchRequest,
  type CredentialClearOptions,
  type CredentialLoadOptions
} from './sessionControllerHelpers';

const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const NODESEEK_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const LINUXDO_BROWSER_FETCH_TIMEOUT_MS = 15000;
const LINUXDO_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const YAOHUO_COOKIE_URLS = [YAOHUO_URL];
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';

async function readNodeSeekAccessFromStore() {
  const savedAccess = parseNodeSeekAccessRecord(await SecureStore.getItemAsync(NODESEEK_ACCESS_STORAGE_KEY));
  if (savedAccess) {
    return savedAccess;
  }
  const [cookieHeader, userAgent] = await Promise.all([
    SecureStore.getItemAsync(NODESEEK_COOKIE_STORAGE_KEY),
    SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY)
  ]);
  return cookieHeader ? nodeSeekAccessRecord(cookieHeader, userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT) : null;
}

async function writeNodeSeekAccessToStore(cookieHeader: string, userAgent?: string, userId?: number | null, csrfToken?: string | null) {
  const savedAccess = userId === undefined || csrfToken === undefined ? await readNodeSeekAccessFromStore() : null;
  await SecureStore.setItemAsync(NODESEEK_ACCESS_STORAGE_KEY, JSON.stringify(nodeSeekAccessRecord(
    cookieHeader,
    userAgent,
    userId === undefined ? savedAccess?.userId : userId,
    csrfToken === undefined ? savedAccess?.csrfToken : csrfToken
  )));
  await SecureStore.deleteItemAsync(NODESEEK_COOKIE_STORAGE_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY).catch(() => undefined);
}

async function deleteNodeSeekAccessFromStore() {
  await SecureStore.deleteItemAsync(NODESEEK_ACCESS_STORAGE_KEY);
  await SecureStore.deleteItemAsync(NODESEEK_COOKIE_STORAGE_KEY);
  await SecureStore.deleteItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY);
}

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
  credentialGeneration?: number;
  browserFetchIntent?: BrowserFetchIntent;
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
  credentialGeneration?: number;
  browserFetchIntent?: BrowserFetchIntent;
  settled?: boolean;
};

type MutableRef<T> = { current: T };
type WebViewStopRef = { current: { stopLoading: () => void } | null };

export function useSessionController({
  defaultFetcher = fetch,
  linuxDoBrowserWebViewRef,
  linuxDoClearanceBeforeVerifyRef,
  linuxDoWebViewCookieHeaderRef,
  linuxDoWebViewUserAgentRef,
  nodeSeekBrowserWebViewRef,
  nodeSeekWebViewCookieHeaderRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  setLinuxDoWebViewCookieHeader,
  setLinuxDoWebViewUserAgent,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  webLoginDetectedRef,
  webLoginUserId
}: {
  defaultFetcher?: Fetcher;
  linuxDoBrowserWebViewRef: WebViewStopRef;
  linuxDoClearanceBeforeVerifyRef: MutableRef<string | null>;
  linuxDoWebViewCookieHeaderRef: MutableRef<string>;
  linuxDoWebViewUserAgentRef: MutableRef<string>;
  nodeSeekBrowserWebViewRef: WebViewStopRef;
  nodeSeekWebViewCookieHeaderRef: MutableRef<string>;
  nodeSeekWebViewUserAgentRef: MutableRef<string>;
  notify: (message: string) => void;
  setLinuxDoWebViewCookieHeader: Dispatch<SetStateAction<string>>;
  setLinuxDoWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setNodeSeekWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setWebLoginUserId: Dispatch<SetStateAction<number | null>>;
  webLoginDetectedRef: MutableRef<boolean>;
  webLoginUserId: number | null;
}) {
  const nodeSeekBrowserFetchIdRef = useRef(0);
  const nodeSeekBrowserFetchCurrentRef = useRef<PendingNodeSeekBrowserFetchRequest | null>(null);
  const nodeSeekBrowserFetchQueueRef = useRef<PendingNodeSeekBrowserFetchRequest[]>([]);
  const rejectNodeSeekBrowserFetchRef = useRef<((request: PendingNodeSeekBrowserFetchRequest, message: string) => void) | null>(null);
  const linuxDoBrowserFetchIdRef = useRef(0);
  const linuxDoBrowserFetchCurrentRef = useRef<PendingLinuxDoBrowserFetchRequest | null>(null);
  const linuxDoBrowserFetchQueueRef = useRef<PendingLinuxDoBrowserFetchRequest[]>([]);
  const rejectLinuxDoBrowserFetchRef = useRef<((request: PendingLinuxDoBrowserFetchRequest, message: string) => void) | null>(null);
  const [nodeSeekBrowserFetchRequest, setNodeSeekBrowserFetchRequest] = useState<NodeSeekBrowserFetchRequest | null>(null);
  const [linuxDoBrowserFetchRequest, setLinuxDoBrowserFetchRequest] = useState<LinuxDoBrowserFetchRequest | null>(null);
  const nodeSeekCredentialGateRef = useRef(createCredentialWriteGate());
  const yaohuoCredentialGateRef = useRef(createCredentialWriteGate());
  const [siteSessionStates, setSiteSessionStates] = useState(() => createSiteSessionStates());
  const siteSessionViewModels = useMemo(() => createSiteSessionViewModels(siteSessionStates), [siteSessionStates]);
  const loginState = useMemo(() => {
    return nodeSeekLoginStateLabel(siteSessionViewModels.nodeseek, webLoginUserId);
  }, [siteSessionViewModels.nodeseek, webLoginUserId]);

  const yaohuoLoginState = siteSessionViewModels.yaohuo.summaryLabel;

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
      const [savedNodeSeekAccess, savedYaohuoCookie, linuxDoAccess] = await Promise.all([
        readNodeSeekAccessFromStore(),
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
        loadLinuxDoAccess()
      ]);
      const nodeSeekReadCurrent = isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, nodeSeekGeneration);
      const yaohuoReadCurrent = isCredentialWriteCurrent(yaohuoCredentialGateRef.current, yaohuoGeneration);
      if (nodeSeekReadCurrent && savedNodeSeekAccess?.userAgent) {
        const userAgent = sanitizeNodeSeekUserAgent(savedNodeSeekAccess.userAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (nodeSeekReadCurrent) {
        setWebLoginUserId(savedNodeSeekAccess?.userId || null);
      }
      if (nodeSeekReadCurrent && savedNodeSeekAccess?.cookieHeader) {
        const savedCookies = parseNodeSeekDocumentCookie(savedNodeSeekAccess.cookieHeader);
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
    setWebLoginUserId,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession
  ]);

  const loadYaohuoCookieForSource = useCallback(async (source: FeedSource | Source, options?: CredentialLoadOptions) => {
    if (source !== 'all' && source !== 'yaohuo') {
      return undefined;
    }
    const generation = yaohuoCredentialGateRef.current.generation;
    options?.captureGeneration?.(generation);
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
    { verifiedByPage = false, isCurrent = () => true, generation, resetCurrentUser = false, userId, csrfToken }: { verifiedByPage?: boolean; isCurrent?: () => boolean; generation?: number; resetCurrentUser?: boolean; userId?: number | null; csrfToken?: string | null } = {}
  ) => {
    const summary = summarizeNodeSeekCookies(cookies);
    const cookieHeader = buildCookieHeader(cookies);
    const task = async ({ isCurrent: isWriteCurrent }: { isCurrent: () => boolean }) => {
      const stillCurrent = () => isCurrent() && isWriteCurrent();
      if (!stillCurrent()) {
        return '';
      }
      if (canStoreNodeSeekCookieHeader(cookies, verifiedByPage) && cookieHeader) {
        const cookieUserId = nodeSeekUserIdFromCookies(cookies);
        const effectiveUserId = userId === undefined ? summary.loggedIn ? cookieUserId : null : userId;
        const effectiveCsrfToken = csrfToken === undefined ? summary.loggedIn ? undefined : null : csrfToken;
        await writeNodeSeekAccessToStore(
          cookieHeader,
          nodeSeekWebViewUserAgentRef.current || DEFAULT_NODESEEK_ANDROID_USER_AGENT,
          effectiveUserId,
          effectiveCsrfToken
        );
        if (!stillCurrent()) {
          return '';
        }
        if (effectiveUserId !== undefined) {
          setWebLoginUserId(effectiveUserId || null);
        }
        updateNodeSeekSession({
          type: 'cookie-loaded',
          cookieSummary: summary.names,
          hasVerification: true,
          loggedIn: summary.loggedIn,
          ...(summary.loggedIn && resetCurrentUser ? { currentUser: null } : {})
        });
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
    };
    const saved = generation === undefined
      ? await replaceCredentialWrite(nodeSeekCredentialGateRef.current, task)
      : await enqueueCredentialWriteForGeneration(nodeSeekCredentialGateRef.current, generation, task);
    return saved || '';
  }, [nodeSeekWebViewUserAgentRef, updateNodeSeekSession]);

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

  const rejectNodeSeekBrowserFetch = useCallback((request: PendingNodeSeekBrowserFetchRequest, message: string, options: { skipStopLoading?: boolean } = {}) => {
    rejectBrowserFetchRequest({
      request,
      message,
      currentRef: nodeSeekBrowserFetchCurrentRef,
      queueRef: nodeSeekBrowserFetchQueueRef,
      setActiveRequest: setNodeSeekBrowserFetchRequest,
      startNext: startNextNodeSeekBrowserFetch,
      webViewRef: nodeSeekBrowserWebViewRef,
      skipStopLoading: options.skipStopLoading
    });
  }, [nodeSeekBrowserFetchCurrentRef, nodeSeekBrowserFetchQueueRef, nodeSeekBrowserWebViewRef, setNodeSeekBrowserFetchRequest, startNextNodeSeekBrowserFetch]);
  rejectNodeSeekBrowserFetchRef.current = rejectNodeSeekBrowserFetch;

  const nodeSeekFetchWithWebView: Fetcher = useCallback(async (input, init) => {
    const url = String(input);
    if (!isNodeSeekRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    const cookie = requestHeaderValue(init?.headers, 'cookie');
    const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
    return new Promise<Response>((resolve, reject) => {
      let request: PendingNodeSeekBrowserFetchRequest;
      const id = ++nodeSeekBrowserFetchIdRef.current;
      request = {
        id,
        url,
        cookie,
        userAgent,
        resolve,
        reject,
        credentialGeneration: nodeSeekCredentialGateRef.current.generation,
        browserFetchIntent: browserFetchIntentFromInit(init),
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
      enqueueLatestBrowserFetchRequest({
        queueRef: nodeSeekBrowserFetchQueueRef,
        request,
        message: '请求已取消',
        shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
      });
      preemptActiveBrowserFetchRequest({
        currentRef: nodeSeekBrowserFetchCurrentRef,
        request,
        message: '请求已被新的前台读取替换',
        rejectCurrent: rejectNodeSeekBrowserFetch
      });
      startNextNodeSeekBrowserFetch();
    });
  }, [defaultFetcher, nodeSeekBrowserFetchIdRef, nodeSeekBrowserFetchCurrentRef, nodeSeekBrowserFetchQueueRef, rejectNodeSeekBrowserFetch, startNextNodeSeekBrowserFetch]);

  const completeNodeSeekBrowserFetch = useCallback(async (data: {
    id?: number;
    url?: string;
    html?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
    error?: string;
    httpErrorStatus?: number;
  }) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    if (!data.url || !isNodeSeekBrowserFetchUrl(data.url)) {
      rejectNodeSeekBrowserFetch(current, 'NodeSeek 页面跳转到外部地址，已停止读取');
      return;
    }
    if (data.error) {
      rejectNodeSeekBrowserFetch(current, data.error);
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
    const cookieHeaderForPersistence = typeof data.cookie === 'string'
      ? nodeSeekBrowserCookieHeaderForPersistence(data.url, data.cookie)
      : '';
    if (cookieHeaderForPersistence) {
      nodeSeekWebViewCookieHeaderRef.current = cookieHeaderForPersistence;
    }
    const settled = settleBrowserFetchRequestOnce(current, () => {
      current.resolve(nodeSeekBrowserResponse(data.html || '', Boolean(data.challenge), data.httpErrorStatus || current.httpErrorStatus));
    });
    if (!settled) {
      return;
    }
    startNextNodeSeekBrowserFetch();
    if (cookieHeaderForPersistence) {
      const generation = current.credentialGeneration ?? nodeSeekCredentialGateRef.current.generation;
      void runBestEffortTask(async () => {
        await CookieManager.flush();
        const nativeCookies = await readNodeSeekCookiesFromStores();
        await saveNodeSeekCookieHeader(mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(cookieHeaderForPersistence)), {
          generation,
          csrfToken: nodeSeekCsrfTokenFromHtml(data.html || '')
        });
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

  const failNodeSeekBrowserFetchById = useCallback((requestId: number, message: string, options: { skipStopLoading?: boolean } = {}) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (current?.id === requestId) {
      rejectNodeSeekBrowserFetch(current, message, options);
    }
  }, [nodeSeekBrowserFetchCurrentRef, rejectNodeSeekBrowserFetch]);

  const markNodeSeekBrowserFetchHttpError = useCallback((requestId: number, statusCode: number) => {
    if (nodeSeekBrowserFetchCurrentRef.current?.id === requestId) {
      nodeSeekBrowserFetchCurrentRef.current.httpErrorStatus = statusCode;
    }
  }, []);

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

  const rejectLinuxDoBrowserFetch = useCallback((request: PendingLinuxDoBrowserFetchRequest, message: string, options: { skipStopLoading?: boolean } = {}) => {
    rejectBrowserFetchRequest({
      request,
      message,
      currentRef: linuxDoBrowserFetchCurrentRef,
      queueRef: linuxDoBrowserFetchQueueRef,
      setActiveRequest: setLinuxDoBrowserFetchRequest,
      startNext: startNextLinuxDoBrowserFetch,
      webViewRef: linuxDoBrowserWebViewRef,
      skipStopLoading: options.skipStopLoading
    });
  }, [linuxDoBrowserFetchCurrentRef, linuxDoBrowserFetchQueueRef, linuxDoBrowserWebViewRef, setLinuxDoBrowserFetchRequest, startNextLinuxDoBrowserFetch]);
  rejectLinuxDoBrowserFetchRef.current = rejectLinuxDoBrowserFetch;

  const linuxDoFetchWithWebView: Fetcher = useCallback((input, init) => {
    const url = String(input);
    if (!isLinuxDoBrowserFetchUrl(url)) {
      return defaultFetcher(input, init);
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
        credentialGeneration: currentLinuxDoAccessGeneration(),
        browserFetchIntent: browserFetchIntentFromInit(init),
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
      enqueueLatestBrowserFetchRequest({
        queueRef: linuxDoBrowserFetchQueueRef,
        request,
        message: '请求已取消'
      });
      startNextLinuxDoBrowserFetch();
    });
  }, [defaultFetcher, linuxDoBrowserFetchIdRef, linuxDoBrowserFetchQueueRef, rejectLinuxDoBrowserFetch, startNextLinuxDoBrowserFetch]);

  const nodeSeekFetchWithWebViewFallback = useMemo(() => createNodeSeekWebViewFallbackFetcher({
    defaultFetcher,
    webViewFetcher: nodeSeekFetchWithWebView
  }), [defaultFetcher, nodeSeekFetchWithWebView]);

  const forumFetchWithWebViewFallback = useMemo(() => createLinuxDoWebViewFallbackFetcher({
    defaultFetcher: nodeSeekFetchWithWebViewFallback,
    webViewFetcher: linuxDoFetchWithWebView
  }), [linuxDoFetchWithWebView, nodeSeekFetchWithWebViewFallback]);

  const loadNodeSeekCookieForSource = useCallback(async (source: FeedSource | Source, options?: CredentialLoadOptions) => {
    if (source !== 'all' && source !== 'nodeseek') {
      return undefined;
    }
    const generation = nodeSeekCredentialGateRef.current.generation;
    options?.captureGeneration?.(generation);
    const cookies = await readNodeSeekCookiesFromStores();
    const savedAccess = await readNodeSeekAccessFromStore();
    const savedCookies = parseNodeSeekDocumentCookie(savedAccess?.cookieHeader || '');
    const nodeSeekCookies = mergeNodeSeekCookies(savedCookies, cookies);
    const userId = nodeSeekCredentialUserId(cookies, savedCookies, savedAccess?.userId);
    const webViewCookieHeader = await saveNodeSeekCookieHeader(nodeSeekCookies, { generation, userId });
    if (!isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)) {
      return undefined;
    }
    if (webViewCookieHeader) {
      options?.captureNodeSeekUserId?.(userId);
      return isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation) ? webViewCookieHeader : undefined;
    }
    if (savedAccess?.cookieHeader) {
      const savedCookies = parseNodeSeekDocumentCookie(savedAccess.cookieHeader);
      const summary = summarizeNodeSeekCookies(savedCookies);
      updateNodeSeekSession(siteEventWithCookieFacts('nodeseek', summary.names, canStoreNodeSeekCookieHeader(savedCookies), summary.loggedIn));
      options?.captureNodeSeekUserId?.(userId);
      return isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation) ? savedAccess.cookieHeader : undefined;
    }
    updateNodeSeekSession({ type: 'cleared' });
    return undefined;
  }, [saveNodeSeekCookieHeader, updateNodeSeekSession]);

  const completeLinuxDoBrowserFetch = useCallback(async (data: {
    id?: number;
    url?: string;
    body?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
    error?: string;
  }) => {
    const current = linuxDoBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    if (!data.url || !isLinuxDoBrowserFetchUrl(data.url)) {
      rejectLinuxDoBrowserFetch(current, 'linux.do 页面跳转到外部地址，已停止读取');
      return;
    }
    const isLinuxDoPage = isLinuxDoRequestUrl(data.url);
    if (data.error) {
      rejectLinuxDoBrowserFetch(current, data.error);
      return;
    }
    linuxDoBrowserWebViewRef.current?.stopLoading();
    linuxDoBrowserFetchCurrentRef.current = null;
    setLinuxDoBrowserFetchRequest(null);
    const userAgent = sanitizeLinuxDoUserAgent(data.userAgent);
    if (isLinuxDoPage && userAgent) {
      linuxDoWebViewUserAgentRef.current = userAgent;
      setLinuxDoWebViewUserAgent(userAgent);
    }
    if (isLinuxDoPage && typeof data.cookie === 'string') {
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
    if (!data.challenge && isLinuxDoPage && typeof data.cookie === 'string') {
      const generation = current.credentialGeneration ?? currentLinuxDoAccessGeneration();
      void runBestEffortTask(async () => {
        await CookieManager.flush();
        const [savedAccess, nativeCookies] = await Promise.all([
          loadLinuxDoAccess(),
          readLinuxDoCookiesFromStores()
        ]);
        const cookies = mergeLinuxDoCookies(
          parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || ''),
          nativeCookies,
          parseLinuxDoDocumentCookie(data.cookie || '')
        );
        const cookieHeader = buildLinuxDoCookieHeader(cookies);
        if (canStoreLinuxDoAccess(cookies) && cookieHeader) {
          await saveLinuxDoAccessForGeneration(generation, cookieHeader, linuxDoWebViewUserAgentRef.current || userAgent || undefined);
          const summary = summarizeLinuxDoCookies(cookies);
          if (generation === currentLinuxDoAccessGeneration()) {
            updateLinuxDoSession({
              type: 'verification-succeeded',
              cookieSummary: summary.names,
              loggedIn: summary.loggedIn,
              at: new Date().toISOString()
            });
          }
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

  const failLinuxDoBrowserFetchById = useCallback((requestId: number, message: string, options: { skipStopLoading?: boolean } = {}) => {
    const current = linuxDoBrowserFetchCurrentRef.current;
    if (current?.id === requestId) {
      rejectLinuxDoBrowserFetch(current, message, options);
    }
  }, [linuxDoBrowserFetchCurrentRef, rejectLinuxDoBrowserFetch]);

  const markLinuxDoBrowserFetchHttpError = useCallback((requestId: number, statusCode: number) => {
    if (linuxDoBrowserFetchCurrentRef.current?.id === requestId) {
      linuxDoBrowserFetchCurrentRef.current.httpErrorStatus = statusCode;
    }
  }, []);

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
    { isCurrent = () => true, generation }: { isCurrent?: () => boolean; generation?: number } = {}
  ) => {
    const task = async ({ isCurrent: isWriteCurrent }: { isCurrent: () => boolean }) => {
      if (!isCurrent() || !isWriteCurrent()) {
        return false;
      }
      await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, cookieHeader);
      return isCurrent() && isWriteCurrent();
    };
    const saved = generation === undefined
      ? await replaceCredentialWrite(yaohuoCredentialGateRef.current, task)
      : await enqueueCredentialWriteForGeneration(yaohuoCredentialGateRef.current, generation, task);
    return saved === true;
  }, []);

  const clearStoredYaohuoLoginState = useCallback(async (options: CredentialClearOptions = {}) => {
    const cleared = options.generation !== undefined && !options.force
      ? await enqueueCredentialWriteForGeneration(yaohuoCredentialGateRef.current, options.generation, () => SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY))
      : await replaceCredentialWrite(yaohuoCredentialGateRef.current, () => SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY));
    if (cleared !== undefined) {
      updateYaohuoSession({ type: 'cleared' });
      return true;
    }
    return false;
  }, [updateYaohuoSession]);

  const clearStoredNodeSeekLoginState = useCallback(async () => {
    await replaceCredentialWrite(nodeSeekCredentialGateRef.current, async () => {
      await deleteNodeSeekAccessFromStore();
    });
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

  const currentNodeSeekCredentialGeneration = useCallback(() => nodeSeekCredentialGateRef.current.generation, []);
  const currentYaohuoCredentialGeneration = useCallback(() => yaohuoCredentialGateRef.current.generation, []);

  const clearYaohuoLoginState = useCallback(async (options: CredentialClearOptions = {}) => {
    const cleared = await clearStoredYaohuoLoginState(options);
    if (cleared) {
      await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);
    }
  }, [clearStoredYaohuoLoginState]);

  const clearNodeSeekLoginState = useCallback(async () => {
    await clearStoredNodeSeekLoginState();
    await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
  }, [clearStoredNodeSeekLoginState]);

  const clearNodeSeekLoginCookiesOnly = useCallback(async (options: CredentialClearOptions = {}) => {
    const task = async () => {
      const access = await readNodeSeekAccessFromStore();
      const verificationCookies = removeNodeSeekLoginCookies(parseNodeSeekDocumentCookie(access?.cookieHeader || ''));
      const verificationHeader = buildCookieHeader(verificationCookies);
      if (!canStoreNodeSeekCookieHeader(verificationCookies) || !verificationHeader) {
        return null;
      }
      await writeNodeSeekAccessToStore(verificationHeader, access?.userAgent || nodeSeekWebViewUserAgentRef.current || DEFAULT_NODESEEK_ANDROID_USER_AGENT, null, null);
      return {
        header: verificationHeader,
        summary: summarizeNodeSeekCookies(verificationCookies)
      };
    };
    const verification = options.generation !== undefined && !options.force
      ? await enqueueCredentialWriteForGeneration(nodeSeekCredentialGateRef.current, options.generation, task)
      : await replaceCredentialWrite(nodeSeekCredentialGateRef.current, task);
    if (verification === undefined) {
      return;
    }
    webLoginDetectedRef.current = false;
    setWebLoginUserId(null);
    updateNodeSeekSession({ type: 'login-expired', message: 'NodeSeek 登录已失效' });
    if (verification) {
      nodeSeekWebViewCookieHeaderRef.current = verification.header;
      await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS, [...nodeSeekLoginCookieNames]);
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
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    dispatchSiteSessionEvent,
    forumFetchWithWebViewFallback,
    hiddenBrowserFetchRequests: {
      linuxDo: linuxDoBrowserFetchRequest,
      nodeSeek: nodeSeekBrowserFetchRequest
    },
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loginState,
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
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
