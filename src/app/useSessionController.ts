import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
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
  type YaohuoNativeCookie
} from '../yaohuoCookies';
import {
  linuxDoAccessSummary,
  linuxDoClearanceValue,
  loadLinuxDoAccess,
  parseLinuxDoDocumentCookie,
  sanitizeLinuxDoUserAgent,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { clearCookieUrls } from '../cookieCleanup';
import { NODESEEK_URL, YAOHUO_URL } from '../appUrls';
import type { FeedSource, Source } from '../types';
import type { Fetcher } from '../request';
import { createNodeSeekWebViewFallbackFetcher, isNodeSeekRequestUrl } from '../nodeseekFetchFallback';
import { createLinuxDoWebViewFallbackFetcher, isLinuxDoRequestUrl } from '../linuxdoFetchFallback';
import { errorMessage } from '../appUtils';

const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const LINUXDO_BROWSER_FETCH_TIMEOUT_MS = 15000;
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
};

type MutableRef<T> = { current: T };
type WebViewStopRef = { current: { stopLoading: () => void } | null };

function yaohuoCookieMapFromHeader(cookieHeader: string) {
  const cookies: Record<string, YaohuoNativeCookie> = {};
  for (const setCookieHeader of buildYaohuoSetCookieHeaders(cookieHeader)) {
    const cookiePart = setCookieHeader.split(';', 1)[0] || '';
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (name && value) {
      cookies[name] = { name, value, domain: 'yaohuo.me' };
    }
  }
  return cookies;
}

function requestHeaderValue(headers: HeadersInit | undefined, name: string) {
  const target = name.toLowerCase();
  if (!headers) {
    return undefined;
  }
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) || undefined;
  }
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === target);
    return pair ? String(pair[1]) : undefined;
  }
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
  return typeof value === 'string' ? value : undefined;
}

function nodeSeekBrowserResponse(html: string, challenge: boolean, httpErrorStatus?: number) {
  const status = challenge ? 403 : httpErrorStatus || 200;
  const headerValues: Record<string, string> = {
    'content-type': 'text/html'
  };
  if (challenge) {
    headerValues['cf-mitigated'] = 'challenge';
  }
  if (typeof Response !== 'undefined') {
    return new Response(html, {
      status,
      headers: headerValues
    });
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (headerName: string) => headerValues[headerName.toLowerCase()] || null
    },
    text: () => Promise.resolve(html)
  } as Response;
}

function linuxDoBrowserResponse(body: string, challenge: boolean, httpErrorStatus?: number) {
  const status = challenge ? 403 : httpErrorStatus || 200;
  const isJson = /^\s*[{[]/.test(body);
  const headerValues: Record<string, string> = {
    'content-type': isJson ? 'application/json' : 'text/html'
  };
  if (challenge) {
    headerValues['cf-mitigated'] = 'challenge';
  }
  if (typeof Response !== 'undefined') {
    return new Response(body, {
      status,
      headers: headerValues
    });
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (headerName: string) => headerValues[headerName.toLowerCase()] || null
    },
    text: () => Promise.resolve(body)
  } as Response;
}

function cleanupNodeSeekBrowserFetchRequest(request: PendingNodeSeekBrowserFetchRequest) {
  if (request.timeout) {
    clearTimeout(request.timeout);
    request.timeout = undefined;
  }
  if (request.abortSignal && request.abortHandler) {
    request.abortSignal.removeEventListener('abort', request.abortHandler);
  }
}

function cleanupLinuxDoBrowserFetchRequest(request: PendingLinuxDoBrowserFetchRequest) {
  if (request.timeout) {
    clearTimeout(request.timeout);
    request.timeout = undefined;
  }
  if (request.abortSignal && request.abortHandler) {
    request.abortSignal.removeEventListener('abort', request.abortHandler);
  }
}

export function useSessionController({
  cookieNames,
  hasNodeSeekCookie,
  hasNodeSeekLoginCookie,
  hasYaohuoCookie,
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
  setCookieNames,
  setHasLinuxDoClearance,
  setHasLinuxDoLogin,
  setHasNodeSeekCookie,
  setHasNodeSeekLoginCookie,
  setHasYaohuoCookie,
  setLinuxDoBrowserFetchRequest,
  setLinuxDoCookieNames,
  setLinuxDoWebViewCookieHeader,
  setLinuxDoWebViewUserAgent,
  setNodeSeekBrowserFetchRequest,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  setYaohuoCookieNames,
  setYaohuoLoginCookieHeader,
  webLoginDetectedRef,
  webLoginUserId,
  yaohuoCookieNames
}: {
  cookieNames: string[];
  hasNodeSeekCookie: boolean;
  hasNodeSeekLoginCookie: boolean;
  hasYaohuoCookie: boolean;
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
  setCookieNames: Dispatch<SetStateAction<string[]>>;
  setHasLinuxDoClearance: Dispatch<SetStateAction<boolean>>;
  setHasLinuxDoLogin: Dispatch<SetStateAction<boolean>>;
  setHasNodeSeekCookie: Dispatch<SetStateAction<boolean>>;
  setHasNodeSeekLoginCookie: Dispatch<SetStateAction<boolean>>;
  setHasYaohuoCookie: Dispatch<SetStateAction<boolean>>;
  setLinuxDoBrowserFetchRequest: Dispatch<SetStateAction<LinuxDoBrowserFetchRequest | null>>;
  setLinuxDoCookieNames: Dispatch<SetStateAction<string[]>>;
  setLinuxDoWebViewCookieHeader: Dispatch<SetStateAction<string>>;
  setLinuxDoWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setNodeSeekBrowserFetchRequest: Dispatch<SetStateAction<NodeSeekBrowserFetchRequest | null>>;
  setNodeSeekWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setWebLoginUserId: Dispatch<SetStateAction<number | null>>;
  setYaohuoCookieNames: Dispatch<SetStateAction<string[]>>;
  setYaohuoLoginCookieHeader: Dispatch<SetStateAction<string>>;
  webLoginDetectedRef: MutableRef<boolean>;
  webLoginUserId: number | null;
  yaohuoCookieNames: string[];
}) {
  const loginState = useMemo(() => {
    if (webLoginUserId) {
      return `网页已确认登录：用户 ${webLoginUserId}`;
    }
    if (!hasNodeSeekCookie && cookieNames.length === 0) {
      return '未检测到 NodeSeek 验证信息';
    }
    if (hasNodeSeekLoginCookie) {
      return cookieNames.length === 0 ? '已保存 NodeSeek 登录 Cookie' : `已检测登录 Cookie：${cookieNames.join(', ')}`;
    }
    if (cookieNames.length === 0) {
      return '已保存 NodeSeek 验证信息';
    }
    return `已检测验证 Cookie：${cookieNames.join(', ')}`;
  }, [cookieNames, hasNodeSeekCookie, hasNodeSeekLoginCookie, webLoginUserId]);

  const yaohuoLoginState = useMemo(() => {
    if (hasYaohuoCookie) {
      return yaohuoCookieNames.length ? `已登录：${yaohuoCookieNames.join(', ')}` : '已登录';
    }
    if (yaohuoCookieNames.length) {
      return `未登录，已检测 ${yaohuoCookieNames.length} 个 Cookie：${yaohuoCookieNames.join(', ')}`;
    }
    return '未登录';
  }, [hasYaohuoCookie, yaohuoCookieNames]);

  useEffect(() => {
    void (async () => {
      const [savedCookie, savedNodeSeekUserAgent, savedYaohuoCookie, linuxDoAccess] = await Promise.all([
        SecureStore.getItemAsync(COOKIE_STORAGE_KEY),
        SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY),
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
        loadLinuxDoAccess()
      ]);
      if (savedNodeSeekUserAgent) {
        const userAgent = sanitizeNodeSeekUserAgent(savedNodeSeekUserAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (savedCookie) {
        const summary = summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie));
        setHasNodeSeekCookie(true);
        setHasNodeSeekLoginCookie(summary.loggedIn);
        setCookieNames(summary.names);
        notify(summary.loggedIn ? '已找到本机保存的 NodeSeek 登录 Cookie。' : '已找到本机保存的 NodeSeek 验证信息。');
      }
      if (savedYaohuoCookie) {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(savedYaohuoCookie));
        setHasYaohuoCookie(yaohuoSummary.loggedIn);
        setYaohuoCookieNames(yaohuoSummary.names);
        setYaohuoLoginCookieHeader(savedYaohuoCookie);
        notify('已找到本机保存的妖火 Cookie。');
      }
      const linuxDoSummary = linuxDoAccessSummary(linuxDoAccess);
      const linuxDoCookies = parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '');
      linuxDoClearanceBeforeVerifyRef.current = linuxDoClearanceValue(linuxDoCookies) || null;
      setHasLinuxDoClearance(linuxDoSummary.hasClearance);
      setHasLinuxDoLogin(linuxDoSummary.loggedIn);
      setLinuxDoCookieNames(summarizeLinuxDoCookies(linuxDoCookies).names);
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
    setCookieNames,
    setHasLinuxDoClearance,
    setHasLinuxDoLogin,
    setHasNodeSeekCookie,
    setHasNodeSeekLoginCookie,
    setHasYaohuoCookie,
    setLinuxDoCookieNames,
    setLinuxDoWebViewUserAgent,
    setNodeSeekWebViewUserAgent,
    setYaohuoCookieNames,
    setYaohuoLoginCookieHeader
  ]);

  const loadYaohuoCookieForSource = useCallback(async (source: FeedSource | Source) => {
    if (source !== 'all' && source !== 'yaohuo') {
      return undefined;
    }
    const cookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    const summary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookie || ''));
    setHasYaohuoCookie(summary.loggedIn);
    return cookie || undefined;
  }, [setHasYaohuoCookie]);

  const saveNodeSeekCookieHeader = useCallback(async (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    { verifiedByPage = false, isCurrent = () => true }: { verifiedByPage?: boolean; isCurrent?: () => boolean } = {}
  ) => {
    const summary = summarizeNodeSeekCookies(cookies);
    const cookieHeader = buildCookieHeader(cookies);
    if (!isCurrent()) {
      return '';
    }
    if (canStoreNodeSeekCookieHeader(cookies, verifiedByPage) && cookieHeader) {
      await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, cookieHeader);
      await SecureStore.setItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY, nodeSeekWebViewUserAgentRef.current || DEFAULT_NODESEEK_ANDROID_USER_AGENT);
      if (!isCurrent()) {
        return '';
      }
      setCookieNames(summary.names);
      setHasNodeSeekLoginCookie(summary.loggedIn);
      setHasNodeSeekCookie(true);
      return cookieHeader;
    }
    if (!isCurrent()) {
      return '';
    }
    setCookieNames(summary.names);
    setHasNodeSeekLoginCookie(summary.loggedIn);
    return '';
  }, [nodeSeekWebViewUserAgentRef, setCookieNames, setHasNodeSeekCookie, setHasNodeSeekLoginCookie]);

  const loadNodeSeekCookieForSource = useCallback(async (source: FeedSource | Source) => {
    if (source !== 'all' && source !== 'nodeseek') {
      return undefined;
    }
    const cookies = await readNodeSeekCookiesFromWebView();
    const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
    const webViewCookieHeader = await saveNodeSeekCookieHeader(mergeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie || ''), cookies));
    if (webViewCookieHeader) {
      return webViewCookieHeader;
    }
    if (savedCookie) {
      const savedCookies = parseNodeSeekDocumentCookie(savedCookie);
      const summary = summarizeNodeSeekCookies(savedCookies);
      setCookieNames(summary.names);
      setHasNodeSeekCookie(true);
      setHasNodeSeekLoginCookie(summary.loggedIn);
      return savedCookie;
    }
    setHasNodeSeekCookie(false);
    setHasNodeSeekLoginCookie(false);
    return undefined;
  }, [saveNodeSeekCookieHeader, setCookieNames, setHasNodeSeekCookie, setHasNodeSeekLoginCookie]);

  const startNextNodeSeekBrowserFetch = useCallback(() => {
    if (nodeSeekBrowserFetchCurrentRef.current) {
      return;
    }
    let next: PendingNodeSeekBrowserFetchRequest | null = null;
    while (nodeSeekBrowserFetchQueueRef.current.length) {
      const candidate = nodeSeekBrowserFetchQueueRef.current.shift() || null;
      if (!candidate) {
        continue;
      }
      if (candidate.abortSignal?.aborted) {
        cleanupNodeSeekBrowserFetchRequest(candidate);
        candidate.reject(new Error('请求已取消'));
        continue;
      }
      next = candidate;
      break;
    }
    if (next) {
      next.timeout = setTimeout(() => {
        rejectNodeSeekBrowserFetchRef.current?.(next, 'NodeSeek 页面读取超时');
      }, NODESEEK_BROWSER_FETCH_TIMEOUT_MS);
    }
    nodeSeekBrowserFetchCurrentRef.current = next;
    setNodeSeekBrowserFetchRequest(next ? {
      id: next.id,
      url: next.url,
      cookie: next.cookie,
      userAgent: next.userAgent
    } : null);
  }, [nodeSeekBrowserFetchCurrentRef, nodeSeekBrowserFetchQueueRef, rejectNodeSeekBrowserFetchRef, setNodeSeekBrowserFetchRequest]);

  const rejectNodeSeekBrowserFetch = useCallback((request: PendingNodeSeekBrowserFetchRequest, message: string) => {
    const queuedIndex = nodeSeekBrowserFetchQueueRef.current.findIndex((item) => item.id === request.id);
    if (queuedIndex >= 0) {
      nodeSeekBrowserFetchQueueRef.current.splice(queuedIndex, 1);
    }
    if (nodeSeekBrowserFetchCurrentRef.current?.id === request.id) {
      nodeSeekBrowserWebViewRef.current?.stopLoading();
      nodeSeekBrowserFetchCurrentRef.current = null;
      setNodeSeekBrowserFetchRequest(null);
    }
    cleanupNodeSeekBrowserFetchRequest(request);
    request.reject(new Error(message));
    startNextNodeSeekBrowserFetch();
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

  const completeNodeSeekBrowserFetch = useCallback((data: {
    id?: number;
    html?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
  }) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    cleanupNodeSeekBrowserFetchRequest(current);
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
      void CookieManager.flush().then(async () => {
        const nativeCookies = await readNodeSeekCookiesFromWebView();
        await saveNodeSeekCookieHeader(mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(data.cookie || '')));
      }).catch(() => undefined);
    }
    current.resolve(nodeSeekBrowserResponse(data.html || '', Boolean(data.challenge), current.httpErrorStatus));
    startNextNodeSeekBrowserFetch();
  }, [
    nodeSeekBrowserFetchCurrentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
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
    if (linuxDoBrowserFetchCurrentRef.current) {
      return;
    }
    let next: PendingLinuxDoBrowserFetchRequest | null = null;
    while (linuxDoBrowserFetchQueueRef.current.length) {
      const candidate = linuxDoBrowserFetchQueueRef.current.shift() || null;
      if (!candidate) {
        continue;
      }
      if (candidate.abortSignal?.aborted) {
        cleanupLinuxDoBrowserFetchRequest(candidate);
        candidate.reject(new Error('请求已取消'));
        continue;
      }
      next = candidate;
      break;
    }
    if (next) {
      next.timeout = setTimeout(() => {
        rejectLinuxDoBrowserFetchRef.current?.(next, 'linux.do 页面读取超时');
      }, LINUXDO_BROWSER_FETCH_TIMEOUT_MS);
    }
    linuxDoBrowserFetchCurrentRef.current = next;
    setLinuxDoBrowserFetchRequest(next ? {
      id: next.id,
      url: next.url,
      cookie: next.cookie,
      userAgent: next.userAgent
    } : null);
  }, [linuxDoBrowserFetchCurrentRef, linuxDoBrowserFetchQueueRef, rejectLinuxDoBrowserFetchRef, setLinuxDoBrowserFetchRequest]);

  const rejectLinuxDoBrowserFetch = useCallback((request: PendingLinuxDoBrowserFetchRequest, message: string) => {
    const queuedIndex = linuxDoBrowserFetchQueueRef.current.findIndex((item) => item.id === request.id);
    if (queuedIndex >= 0) {
      linuxDoBrowserFetchQueueRef.current.splice(queuedIndex, 1);
    }
    if (linuxDoBrowserFetchCurrentRef.current?.id === request.id) {
      linuxDoBrowserWebViewRef.current?.stopLoading();
      linuxDoBrowserFetchCurrentRef.current = null;
      setLinuxDoBrowserFetchRequest(null);
    }
    cleanupLinuxDoBrowserFetchRequest(request);
    request.reject(new Error(message));
    startNextLinuxDoBrowserFetch();
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

  const completeLinuxDoBrowserFetch = useCallback((data: {
    id?: number;
    body?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
  }) => {
    const current = linuxDoBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    cleanupLinuxDoBrowserFetchRequest(current);
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
      void CookieManager.flush().catch(() => undefined);
    }
    current.resolve(linuxDoBrowserResponse(data.body || '', Boolean(data.challenge), current.httpErrorStatus));
    startNextLinuxDoBrowserFetch();
  }, [
    linuxDoBrowserFetchCurrentRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewUserAgentRef,
    setLinuxDoBrowserFetchRequest,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewUserAgent,
    startNextLinuxDoBrowserFetch
  ]);

  const failLinuxDoBrowserFetchById = useCallback((requestId: number, message: string) => {
    const current = linuxDoBrowserFetchCurrentRef.current;
    if (current?.id === requestId) {
      rejectLinuxDoBrowserFetch(current, message);
    }
  }, [linuxDoBrowserFetchCurrentRef, rejectLinuxDoBrowserFetch]);

  const restoreSavedYaohuoCookiesToWebView = useCallback(async () => {
    const cookieHeader = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    if (!cookieHeader) {
      setYaohuoLoginCookieHeader('');
      setYaohuoCookieNames([]);
      return;
    }
    setYaohuoLoginCookieHeader(cookieHeader);
    const summary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookieHeader));
    setHasYaohuoCookie(summary.loggedIn);
    setYaohuoCookieNames(summary.names);
    const headers = buildYaohuoSetCookieHeaders(cookieHeader);
    for (const url of YAOHUO_COOKIE_URLS) {
      for (const header of headers) {
        await CookieManager.setFromResponse(url, header);
      }
    }
    if (headers.length) {
      await CookieManager.flush();
    }
  }, [setHasYaohuoCookie, setYaohuoCookieNames, setYaohuoLoginCookieHeader]);

  const clearStoredYaohuoLoginState = useCallback(async () => {
    await SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    setHasYaohuoCookie(false);
    setYaohuoLoginCookieHeader('');
    setYaohuoCookieNames([]);
  }, [setHasYaohuoCookie, setYaohuoCookieNames, setYaohuoLoginCookieHeader]);

  const clearStoredNodeSeekLoginState = useCallback(async () => {
    await SecureStore.deleteItemAsync(COOKIE_STORAGE_KEY);
    await SecureStore.deleteItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY);
    webLoginDetectedRef.current = false;
    nodeSeekWebViewCookieHeaderRef.current = '';
    setHasNodeSeekCookie(false);
    setHasNodeSeekLoginCookie(false);
    setCookieNames([]);
    setWebLoginUserId(null);
    nodeSeekWebViewUserAgentRef.current = DEFAULT_NODESEEK_ANDROID_USER_AGENT;
    setNodeSeekWebViewUserAgent(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  }, [
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    setCookieNames,
    setHasNodeSeekCookie,
    setHasNodeSeekLoginCookie,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
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
    const cookieHeader = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
    const verificationCookies = removeNodeSeekLoginCookies(parseNodeSeekDocumentCookie(cookieHeader || ''));
    const verificationHeader = buildCookieHeader(verificationCookies);
    webLoginDetectedRef.current = false;
    setWebLoginUserId(null);
    setHasNodeSeekLoginCookie(false);
    if (canStoreNodeSeekCookieHeader(verificationCookies) && verificationHeader) {
      await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, verificationHeader);
      nodeSeekWebViewCookieHeaderRef.current = verificationHeader;
      await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
      setHasNodeSeekCookie(true);
      setCookieNames(summarizeNodeSeekCookies(verificationCookies).names);
      return;
    }
    await clearNodeSeekLoginState();
  }, [
    clearNodeSeekLoginState,
    nodeSeekWebViewCookieHeaderRef,
    setCookieNames,
    setHasNodeSeekCookie,
    setHasNodeSeekLoginCookie,
    setWebLoginUserId,
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
    forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loginState,
    restoreSavedYaohuoCookiesToWebView,
    saveNodeSeekCookieHeader,
    yaohuoLoginState
  };
}
