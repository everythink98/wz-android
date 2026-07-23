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
  sanitizeNodeSeekUserAgent,
  summarizeNodeSeekCookies
} from '../nodeseekCookies';
import { readNodeSeekCookiesFromStores } from '../nodeseekCookieBridge';
import { summarizeYaohuoCookies, yaohuoCookieMapFromHeader } from '../yaohuoCookies';
import {
  buildLinuxDoCookieHeader,
  canStoreLinuxDoAccess,
  linuxDoAccessSummary,
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
import { useCommitRefValue } from './useCommittedRef';
import { NODESEEK_URL, YAOHUO_URL } from '../appUrls';
import type { FeedSource, Source } from '../types';
import type { Fetcher } from '../request';
import { createNodeSeekWebViewFallbackFetcher, isNodeSeekBrowserFetchUrl, isNodeSeekRequestUrl } from '../nodeseekFetchFallback';
import {
  createLinuxDoWebViewFallbackFetcher,
  isLinuxDoBrowserFetchUrl,
  isLinuxDoRequestUrl,
  LinuxDoHiddenBrowserFailureError,
  type LinuxDoHiddenBrowserFailureReason
} from '../linuxdoFetchFallback';
import { LinuxDoCloudflareError } from '../cloudflareChallenge';
import { browserFetchIntentFromInit, type BrowserFetchIntent } from '../browserFetchIntent';
import { errorMessage } from '../appUtils';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '../diagnostics';
import { appQueryClient, emptyForumCredentialScope } from './serverState';
import {
  createSiteSessionViewModels,
  createSiteSessionStates,
  reduceSiteSessionState,
  type ScopedSiteSessionEvent,
  type SessionSite,
  type SiteSessionEvent
} from '../siteSessionState';
import {
  commitExpiredAccountStatusQuery,
  createCredentialWriteGate,
  enqueueBrowserFetchRequest,
  enqueueCredentialWriteForGeneration,
  forumCredentialScopeAfterSourceChange,
  isCredentialWriteCurrent,
  replaceCredentialWrite,
  resetForumSourceQueries,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  rejectBrowserFetchRequest,
  requestHeaderValue,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  siteSessionEventInvalidatesForumQueries,
  startNextBrowserFetchRequest,
  type CredentialClearOptions,
  type CredentialLoadOptions
} from './sessionControllerHelpers';

const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const NODESEEK_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const LINUXDO_BROWSER_FETCH_TIMEOUT_MS = 15000;
const LINUXDO_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const YAOHUO_COOKIE_URLS = [YAOHUO_URL, 'https://yaohuo.me'];
const YAOHUO_LOGIN_COOKIE_NAMES = ['sidyaohuo', 'ASP.NET_SessionId', 'GUID'];
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';

async function runYaohuoLogoutTransaction({
  currentGeneration,
  options,
  removeStoredState,
  reportSessionState
}: {
  currentGeneration: () => number;
  options: CredentialClearOptions;
  removeStoredState: (options: CredentialClearOptions, applySessionState: boolean) => Promise<boolean>;
  reportSessionState: (event: SiteSessionEvent) => void;
}) {
  let cleanupGeneration: number | undefined;
  try {
    const removed = await removeStoredState(options, false);
    if (!removed) {
      return false;
    }
    cleanupGeneration = currentGeneration();
    const cleared = await clearCookieUrls(
      CookieManager,
      YAOHUO_COOKIE_URLS,
      YAOHUO_LOGIN_COOKIE_NAMES,
      () => currentGeneration() === cleanupGeneration,
      { domains: ['yaohuo.me'] }
    );
    if (!cleared) {
      return false;
    }
    reportSessionState(options.expiredMessage?.trim()
      ? {
        type: 'login-expired',
        message: options.expiredMessage.trim(),
        ...(options.recoveryQueryKey ? { recoveryQueryKey: options.recoveryQueryKey } : {})
      }
      : { type: 'cleared' });
    return true;
  } catch (error) {
    if (cleanupGeneration !== undefined && currentGeneration() !== cleanupGeneration) {
      return false;
    }
    const expiredMessage = options.expiredMessage?.trim();
    reportSessionState(expiredMessage
      ? {
        type: 'login-expired',
        message: `${expiredMessage} 本机 Cookie 清理未完成，请重试。`,
        ...(options.recoveryQueryKey ? { recoveryQueryKey: options.recoveryQueryKey } : {})
      }
      : { type: 'check-failed', message: '妖火登录清理未完成，请重试。' });
    throw error;
  }
}

async function runNodeSeekLogoutTransaction({
  applyClearedState,
  currentGeneration,
  options,
  removeStoredState,
  reportSessionState
}: {
  applyClearedState: () => void;
  currentGeneration: () => number;
  options: CredentialClearOptions;
  removeStoredState: (applySessionState: boolean, options: CredentialClearOptions) => Promise<boolean>;
  reportSessionState: (event: SiteSessionEvent) => void;
}) {
  let cleanupGeneration: number | undefined;
  try {
    const cleared = await removeStoredState(false, options);
    if (!cleared) {
      return false;
    }
    cleanupGeneration = currentGeneration();
    const webViewCleared = await clearCookieUrls(
      CookieManager,
      NODESEEK_COOKIE_URLS,
      nodeSeekLoginCookieNames,
      () => currentGeneration() === cleanupGeneration,
      { domains: ['nodeseek.com'] }
    );
    if (!webViewCleared) {
      return false;
    }
    applyClearedState();
    return true;
  } catch (error) {
    if (cleanupGeneration !== undefined && currentGeneration() !== cleanupGeneration) {
      return false;
    }
    reportSessionState({ type: 'check-failed', message: 'NodeSeek 登录清理未完成，请重试。' });
    throw error;
  }
}

async function readNodeSeekAccessFromStore() {
  const rawAccess = await SecureStore.getItemAsync(NODESEEK_ACCESS_STORAGE_KEY);
  const savedAccess = parseNodeSeekAccessRecord(rawAccess);
  if (savedAccess) {
    return savedAccess;
  }
  if (rawAccess) {
    throw new Error('NodeSeek 登录配置已损坏，请重新登录。');
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
  userAgent?: string;
};

type PendingNodeSeekBrowserFetchRequest = NodeSeekBrowserFetchRequest & {
  cookie?: string;
  diagnosticTrace: DiagnosticTrace;
  diagnosticOwnsTrace: boolean;
  diagnosticActive?: boolean;
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
  userAgent?: string;
};

type PendingLinuxDoBrowserFetchRequest = LinuxDoBrowserFetchRequest & {
  cookie?: string;
  diagnosticTrace: DiagnosticTrace;
  diagnosticOwnsTrace: boolean;
  diagnosticActive?: boolean;
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

function diagnosticBrowserIntent(intent?: BrowserFetchIntent) {
  return {
    ...(intent?.owner ? { owner: intent.owner } : {}),
    ...(intent?.priority ? { priority: intent.priority } : {})
  };
}

function finishBrowserFetchFailure(trace: DiagnosticTrace, ownsTrace: boolean, source: SessionSite, error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const reason = message.includes('前台读取替换') ? 'superseded'
    : message.includes('外部地址') ? 'unsupported'
      : message.includes('进程已停止') ? 'renderer_gone'
        : normalizeDiagnosticReason(error);
  const outcome = reason === 'canceled' ? 'canceled'
    : reason === 'stale' || reason === 'superseded' ? 'stale'
      : reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied' ? 'blocked'
        : 'failure';
  markDiagnosticStage(trace, 'transport', { source, channel: 'webview', state: 'failure', reason });
  if (ownsTrace) {
    finishDiagnosticTrace(trace, outcome, { source, channel: 'webview', reason });
  }
}

function finishBrowserFetchSuccess(
  trace: DiagnosticTrace,
  ownsTrace: boolean,
  source: SessionSite,
  status: number,
  contentLength: number,
  hasCredential: boolean,
  isChallenge: boolean
) {
  markDiagnosticStage(trace, 'parse', {
    source,
    channel: 'webview',
    status,
    contentLength,
    hasCredential,
    isChallenge
  });
  if (ownsTrace) {
    finishDiagnosticTrace(
      trace,
      isChallenge ? 'blocked' : status >= 400 ? 'failure' : 'success',
      {
        source,
        channel: 'webview',
        status,
        ...(isChallenge ? { reason: 'verification_required' } : status >= 400 ? { reason: 'http_error' } : {})
      }
    );
  }
}

export function useSessionController({
  defaultFetcher = fetch,
  linuxDoBrowserWebViewRef,
  linuxDoWebViewCookieHeaderRef,
  linuxDoWebViewUserAgentRef,
  nodeSeekBrowserWebViewRef,
  nodeSeekWebViewCookieHeaderRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  setLinuxDoWebViewUserAgent,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  webLoginDetectedRef
}: {
  defaultFetcher?: Fetcher;
  linuxDoBrowserWebViewRef: WebViewStopRef;
  linuxDoWebViewCookieHeaderRef: MutableRef<string>;
  linuxDoWebViewUserAgentRef: MutableRef<string>;
  nodeSeekBrowserWebViewRef: WebViewStopRef;
  nodeSeekWebViewCookieHeaderRef: MutableRef<string>;
  nodeSeekWebViewUserAgentRef: MutableRef<string>;
  notify: (message: string) => void;
  setLinuxDoWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setNodeSeekWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setWebLoginUserId: Dispatch<SetStateAction<number | null>>;
  webLoginDetectedRef: MutableRef<boolean>;
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
  const [forumCredentialScope, setForumCredentialScope] = useState(emptyForumCredentialScope);
  const forumCredentialScopeRef = useRef(emptyForumCredentialScope);
  const siteSessionViewModels = useMemo(() => createSiteSessionViewModels(siteSessionStates), [siteSessionStates]);

  const invalidateForumSourceQueryScope = useCallback((
    site: SessionSite,
    recoveryQueryKey?: readonly unknown[]
  ) => {
    const preservedRecovery = resetForumSourceQueries(
      site,
      appQueryClient,
      recoveryQueryKey
    );
    if (!preservedRecovery) {
      const nextScope = forumCredentialScopeAfterSourceChange(forumCredentialScopeRef.current, site);
      forumCredentialScopeRef.current = nextScope;
      setForumCredentialScope(nextScope);
    }
  }, []);

  const commitAccountStatusExpiry = useCallback((site: SessionSite, recoveryQueryKey: readonly unknown[]) => {
    const nextScope = commitExpiredAccountStatusQuery(
      site,
      forumCredentialScopeRef.current,
      recoveryQueryKey,
      appQueryClient
    );
    forumCredentialScopeRef.current = nextScope;
    setForumCredentialScope(nextScope);
  }, []);

  const dispatchSiteSessionEvent = useCallback((event: ScopedSiteSessionEvent) => {
    const trace = beginDiagnosticTrace('session', 'state-transition', {
      source: event.site,
      eventType: event.type
    });
    if (siteSessionEventInvalidatesForumQueries(event)) {
      const recoveryQueryKey = 'recoveryQueryKey' in event ? event.recoveryQueryKey : undefined;
      invalidateForumSourceQueryScope(event.site, recoveryQueryKey);
    }
    if (event.site === 'nodeseek' && (
      event.type === 'login-expired'
      || event.type === 'cleared'
      || event.type === 'verification-required'
      || event.type === 'verification-started'
      || (event.type === 'cookie-loaded' && event.loggedIn === false)
      || (event.type === 'session-updated' && event.loggedIn !== true)
      || (event.type === 'verification-succeeded' && event.loggedIn !== true)
    )) {
      setWebLoginUserId(null);
    }
    setSiteSessionStates((current) => {
      const previous = current[event.site];
      const next = reduceSiteSessionState(previous, event);
      markDiagnosticStage(trace, 'apply', {
        source: event.site,
        eventType: event.type,
        previousState: previous.status,
        nextState: next.status,
        hasCredential: next.cookieSummary.length > 0
      });
      finishDiagnosticTrace(trace, 'success', { source: event.site, state: next.status });
      return {
        ...current,
        [event.site]: next
      };
    });
  }, [invalidateForumSourceQueryScope, setWebLoginUserId]);

  const updateNodeSeekSession = useCallback((event: SiteSessionEvent) => {
    dispatchSiteSessionEvent({ ...event, site: 'nodeseek' });
  }, [dispatchSiteSessionEvent]);

  const updateLinuxDoSession = useCallback((event: SiteSessionEvent) => {
    dispatchSiteSessionEvent({ ...event, site: 'linuxdo' });
  }, [dispatchSiteSessionEvent]);

  const updateYaohuoSession = useCallback((event: SiteSessionEvent) => {
    dispatchSiteSessionEvent({ ...event, site: 'yaohuo' });
  }, [dispatchSiteSessionEvent]);

  const publishLinuxDoCookieHeader = useCallback((cookieHeader: string) => {
    linuxDoWebViewCookieHeaderRef.current = cookieHeader;
  }, [linuxDoWebViewCookieHeaderRef]);

  const publishNodeSeekCookieHeader = useCallback((cookieHeader: string) => {
    nodeSeekWebViewCookieHeaderRef.current = cookieHeader;
  }, [nodeSeekWebViewCookieHeaderRef]);

  useEffect(() => {
    const trace = beginDiagnosticTrace('credential', 'load-stored');
    void (async () => {
      const nodeSeekGeneration = nodeSeekCredentialGateRef.current.generation;
      const yaohuoGeneration = yaohuoCredentialGateRef.current.generation;
      const linuxDoGeneration = currentLinuxDoAccessGeneration();
      const [nodeSeekResult, yaohuoResult, linuxDoResult] = await Promise.allSettled([
        readNodeSeekAccessFromStore(),
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
        loadLinuxDoAccess()
      ]);
      const nodeSeekReadCurrent = isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, nodeSeekGeneration);
      const yaohuoReadCurrent = isCredentialWriteCurrent(yaohuoCredentialGateRef.current, yaohuoGeneration);
      const linuxDoReadCurrent = currentLinuxDoAccessGeneration() === linuxDoGeneration;
      const failedSites: Array<'nodeseek' | 'linuxdo' | 'yaohuo'> = [];
      const savedNodeSeekAccess = nodeSeekResult.status === 'fulfilled' ? nodeSeekResult.value : null;
      const savedYaohuoCookie = yaohuoResult.status === 'fulfilled' ? yaohuoResult.value : null;
      const linuxDoAccess = linuxDoResult.status === 'fulfilled' ? linuxDoResult.value : null;
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        store: 'secure-store',
        generation: nodeSeekGeneration,
        isCurrent: nodeSeekReadCurrent,
        state: nodeSeekResult.status === 'rejected' ? 'error' : 'loaded',
        hasCredential: Boolean(savedNodeSeekAccess?.cookieHeader),
        ...(nodeSeekResult.status === 'rejected' ? { reason: 'storage_error' } : {})
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        store: 'secure-store',
        generation: yaohuoGeneration,
        isCurrent: yaohuoReadCurrent,
        state: yaohuoResult.status === 'rejected' ? 'error' : 'loaded',
        hasCredential: Boolean(savedYaohuoCookie),
        ...(yaohuoResult.status === 'rejected' ? { reason: 'storage_error' } : {})
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        store: 'secure-store',
        generation: linuxDoGeneration,
        isCurrent: linuxDoReadCurrent,
        state: linuxDoResult.status === 'rejected' ? 'error' : 'loaded',
        hasCredential: Boolean(linuxDoAccess?.cookieHeader),
        ...(linuxDoResult.status === 'rejected' ? { reason: 'storage_error' } : {})
      });
      if (nodeSeekResult.status === 'rejected' && nodeSeekReadCurrent) {
        failedSites.push('nodeseek');
        updateNodeSeekSession({ type: 'check-failed', message: '读取本机 NodeSeek 登录信息失败' });
      }
      if (nodeSeekResult.status === 'fulfilled' && nodeSeekReadCurrent) {
        setWebLoginUserId(savedNodeSeekAccess?.userId || null);
      }
      if (nodeSeekResult.status === 'fulfilled' && nodeSeekReadCurrent && savedNodeSeekAccess?.cookieHeader) {
        publishNodeSeekCookieHeader(savedNodeSeekAccess.cookieHeader);
        const savedCookies = parseNodeSeekDocumentCookie(savedNodeSeekAccess.cookieHeader);
        const summary = summarizeNodeSeekCookies(savedCookies);
        updateNodeSeekSession(siteCredentialObserved('nodeseek', summary.names, canStoreNodeSeekCookieHeader(savedCookies)));
        notify(summary.loggedIn ? '已找到本机保存的 NodeSeek 登录凭据，正在验证当前会话。' : '已找到本机保存的 NodeSeek 验证信息。');
      }
      if (yaohuoResult.status === 'rejected' && yaohuoReadCurrent) {
        failedSites.push('yaohuo');
        updateYaohuoSession({ type: 'check-failed', message: '读取本机妖火登录信息失败' });
      } else if (yaohuoReadCurrent && savedYaohuoCookie) {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(savedYaohuoCookie));
        updateYaohuoSession(siteCredentialObserved('yaohuo', yaohuoSummary.names, false));
        notify('已找到本机保存的妖火 Cookie。');
      }
      if (linuxDoResult.status === 'rejected' && linuxDoReadCurrent) {
        failedSites.push('linuxdo');
        updateLinuxDoSession({ type: 'check-failed', message: '读取本机 linux.do 登录信息失败' });
      } else if (linuxDoResult.status === 'fulfilled' && linuxDoReadCurrent) {
        if (linuxDoAccess?.cookieHeader) {
          publishLinuxDoCookieHeader(linuxDoAccess.cookieHeader);
        }
        const linuxDoSummary = linuxDoAccessSummary(linuxDoAccess);
        const linuxDoCookies = parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '');
        updateLinuxDoSession(siteCredentialObserved('linuxdo', summarizeLinuxDoCookies(linuxDoCookies).names, linuxDoSummary.hasClearance));
      }
      if (failedSites.length > 0) {
        finishDiagnosticTrace(trace, 'partial', { reason: 'storage_error', count: failedSites.length });
        const labels = { nodeseek: 'NodeSeek', linuxdo: 'linux.do', yaohuo: '妖火' } as const;
        notify(`读取本机保存的登录信息失败：${failedSites.map((site) => labels[site]).join('、')}`);
      } else {
        finishDiagnosticTrace(trace, 'success');
      }
    })()
      .catch((error) => {
        finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
        notify(errorMessage(error));
      });
  }, [
    notify,
    publishLinuxDoCookieHeader,
    publishNodeSeekCookieHeader,
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
    const trace = options?.diagnosticTrace || beginDiagnosticTrace('credential', 'load', { source: 'yaohuo', generation });
    const ownsTrace = !options?.diagnosticTrace;
    options?.captureGeneration?.(generation);
    try {
      const cookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      const current = isCredentialWriteCurrent(yaohuoCredentialGateRef.current, generation);
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        store: 'secure-store',
        generation,
        isCurrent: current,
        hasCredential: Boolean(cookie)
      });
      if (!current) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
        }
        return undefined;
      }
      const summary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookie || ''));
      updateYaohuoSession(siteCredentialObserved('yaohuo', summary.names, false));
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'success', { source: 'yaohuo', hasCredential: Boolean(cookie) });
      }
      return cookie || undefined;
    } catch (error) {
      if (!isCredentialWriteCurrent(yaohuoCredentialGateRef.current, generation)) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
        }
        return undefined;
      }
      markDiagnosticStage(trace, 'credential', { source: 'yaohuo', store: 'secure-store', state: 'error', reason: 'storage_error' });
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'failure', { source: 'yaohuo', reason: 'storage_error' });
      }
      throw error;
    }
  }, [updateYaohuoSession]);

  const saveNodeSeekCookieHeader = useCallback(async (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    { verifiedByPage = false, isCurrent = () => true, generation, resetCurrentUser = false, userId, csrfToken, diagnosticTrace }: { verifiedByPage?: boolean; isCurrent?: () => boolean; generation?: number; resetCurrentUser?: boolean; userId?: number | null; csrfToken?: string | null; diagnosticTrace?: DiagnosticTrace } = {}
  ) => {
    const trace = diagnosticTrace || beginDiagnosticTrace('credential', 'save', {
      source: 'nodeseek',
      hasCredential: Object.keys(cookies).length > 0,
      ...(generation === undefined ? {} : { generation })
    });
    const ownsTrace = !diagnosticTrace;
    const summary = summarizeNodeSeekCookies(cookies);
    const cookieHeader = buildCookieHeader(cookies);
    let skippedAsStale = false;
    const task = async ({ isCurrent: isWriteCurrent }: { isCurrent: () => boolean }) => {
      const stillCurrent = () => isCurrent() && isWriteCurrent();
      if (!stillCurrent()) {
        skippedAsStale = true;
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
          skippedAsStale = true;
          return '';
        }
        if (effectiveUserId !== undefined) {
          setWebLoginUserId(effectiveUserId || null);
        }
        publishNodeSeekCookieHeader(cookieHeader);
        updateNodeSeekSession({
          type: generation === undefined ? 'session-updated' : 'cookie-loaded',
          cookieSummary: summary.names,
          hasVerification: true,
          ...(generation === undefined || verifiedByPage ? { loggedIn: verifiedByPage } : {}),
          ...(verifiedByPage && resetCurrentUser ? { currentUser: null } : {})
        });
        return cookieHeader;
      }
      if (!stillCurrent()) {
        skippedAsStale = true;
        return '';
      }
      updateNodeSeekSession(verifiedByPage ? {
        type: 'login-detected',
        ...(summary.names.length ? { cookieSummary: summary.names } : {}),
        at: new Date().toISOString()
      } : siteCredentialObserved('nodeseek', summary.names, false));
      return '';
    };
    try {
      const saved = generation === undefined
        ? await replaceCredentialWrite(nodeSeekCredentialGateRef.current, task)
        : await enqueueCredentialWriteForGeneration(nodeSeekCredentialGateRef.current, generation, task);
      const hasCredential = Boolean(saved);
      markDiagnosticStage(trace, 'persist', {
        source: 'nodeseek',
        store: 'secure-store',
        hasCredential
      });
      if (!hasCredential && (skippedAsStale || (generation !== undefined && !isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)))) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
      } else if (ownsTrace) {
        finishDiagnosticTrace(trace, hasCredential ? 'success' : 'noop', {
          source: 'nodeseek',
          hasCredential,
          ...(!hasCredential ? { reason: 'missing_credential' } : {})
        });
      }
      return saved || '';
    } catch (error) {
      markDiagnosticStage(trace, 'persist', { source: 'nodeseek', store: 'secure-store', state: 'error', reason: 'storage_error' });
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'failure', { source: 'nodeseek', reason: 'storage_error' });
      }
      throw error;
    }
  }, [nodeSeekWebViewUserAgentRef, publishNodeSeekCookieHeader, updateNodeSeekSession]);

  const startNextNodeSeekBrowserFetch = useCallback(() => {
    startNextBrowserFetchRequest({
      canStart: (request) => request.credentialGeneration === undefined
        || request.credentialGeneration === nodeSeekCredentialGateRef.current.generation,
      currentRef: nodeSeekBrowserFetchCurrentRef,
      queueRef: nodeSeekBrowserFetchQueueRef,
      setActiveRequest: setNodeSeekBrowserFetchRequest,
      timeoutMs: NODESEEK_BROWSER_FETCH_TIMEOUT_MS,
      timeoutMessage: 'NodeSeek 页面读取超时',
      rejectCurrent: (request, message) => rejectNodeSeekBrowserFetchRef.current?.(request, message)
    });
    const active = nodeSeekBrowserFetchCurrentRef.current;
    if (active && !active.diagnosticActive) {
      active.diagnosticActive = true;
      markDiagnosticStage(active.diagnosticTrace, 'transport', {
        source: 'nodeseek',
        channel: 'webview',
        state: 'active',
        queueLength: nodeSeekBrowserFetchQueueRef.current.length
      });
    }
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
  useCommitRefValue(rejectNodeSeekBrowserFetchRef, rejectNodeSeekBrowserFetch);

  const nodeSeekFetchWithWebView: Fetcher = useCallback(async (input, init) => {
    const url = String(input);
    if (!isNodeSeekRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    const cookie = requestHeaderValue(init?.headers, 'cookie');
    const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
    await CookieManager.flush().catch(() => undefined);
    return new Promise<Response>((resolve, reject) => {
      let request: PendingNodeSeekBrowserFetchRequest;
      const id = ++nodeSeekBrowserFetchIdRef.current;
      const browserFetchIntent = browserFetchIntentFromInit(init);
      const inheritedTrace = diagnosticTraceForRequest(init);
      const diagnosticTrace = inheritedTrace || beginDiagnosticTrace('webview', 'browser-fetch', {
        source: 'nodeseek',
        channel: 'webview',
        ...diagnosticBrowserIntent(browserFetchIntent)
      });
      request = {
        id,
        url,
        cookie,
        userAgent,
        diagnosticTrace,
        diagnosticOwnsTrace: !inheritedTrace,
        resolve,
        reject: (error) => {
          finishBrowserFetchFailure(diagnosticTrace, !inheritedTrace, 'nodeseek', error);
          reject(error);
        },
        credentialGeneration: nodeSeekCredentialGateRef.current.generation,
        browserFetchIntent,
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
      enqueueBrowserFetchRequest({
        queueRef: nodeSeekBrowserFetchQueueRef,
        request
      });
      markDiagnosticStage(diagnosticTrace, 'guard', {
        source: 'nodeseek',
        channel: 'webview',
        state: 'queued',
        queueLength: nodeSeekBrowserFetchQueueRef.current.length
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
    const credentialGeneration = current.credentialGeneration ?? nodeSeekCredentialGateRef.current.generation;
    const credentialIsCurrent = credentialGeneration === nodeSeekCredentialGateRef.current.generation;
    if (!credentialIsCurrent) {
      rejectNodeSeekBrowserFetch(current, '请求已取消');
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
    if (credentialIsCurrent && userAgent) {
      nodeSeekWebViewUserAgentRef.current = userAgent;
      setNodeSeekWebViewUserAgent(userAgent);
    }
    const cookieHeaderForPersistence = credentialIsCurrent && typeof data.cookie === 'string'
      ? nodeSeekBrowserCookieHeaderForPersistence(data.url, data.cookie)
      : '';
    const browserCookies = cookieHeaderForPersistence
      ? mergeNodeSeekCookies(
        parseNodeSeekDocumentCookie(current.cookie),
        parseNodeSeekDocumentCookie(nodeSeekWebViewCookieHeaderRef.current),
        parseNodeSeekDocumentCookie(cookieHeaderForPersistence)
      )
      : {};
    const browserCookieHeader = buildCookieHeader(browserCookies);
    if (browserCookieHeader) {
      publishNodeSeekCookieHeader(browserCookieHeader);
    }
    const settled = settleBrowserFetchRequestOnce(current, () => {
      const challenge = Boolean(data.challenge);
      const status = challenge ? 403 : data.httpErrorStatus || current.httpErrorStatus || 200;
      finishBrowserFetchSuccess(
        current.diagnosticTrace,
        current.diagnosticOwnsTrace,
        'nodeseek',
        status,
        (data.html || '').length,
        Boolean(cookieHeaderForPersistence),
        challenge
      );
      current.resolve(nodeSeekBrowserResponse(data.html || '', Boolean(data.challenge), data.httpErrorStatus || current.httpErrorStatus));
    });
    if (!settled) {
      return;
    }
    startNextNodeSeekBrowserFetch();
    if (cookieHeaderForPersistence) {
      void runBestEffortTask(async () => {
        await CookieManager.flush();
        const nativeCookies = await readNodeSeekCookiesFromStores();
        await saveNodeSeekCookieHeader(mergeNodeSeekCookies(
          browserCookies,
          nativeCookies,
          parseNodeSeekDocumentCookie(cookieHeaderForPersistence)
        ), {
          generation: credentialGeneration,
          csrfToken: nodeSeekCsrfTokenFromHtml(data.html || '')
        });
      }, NODESEEK_COOKIE_PERSIST_TIMEOUT_MS);
    }
  }, [
    nodeSeekBrowserFetchCurrentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    publishNodeSeekCookieHeader,
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
      canStart: (request) => request.credentialGeneration === undefined
        || request.credentialGeneration === currentLinuxDoAccessGeneration(),
      currentRef: linuxDoBrowserFetchCurrentRef,
      queueRef: linuxDoBrowserFetchQueueRef,
      setActiveRequest: setLinuxDoBrowserFetchRequest,
      timeoutMs: LINUXDO_BROWSER_FETCH_TIMEOUT_MS,
      timeoutMessage: 'linux.do 页面读取超时',
      rejectCurrent: (request, message) => rejectLinuxDoBrowserFetchRef.current?.(request, message)
    });
    const active = linuxDoBrowserFetchCurrentRef.current;
    if (active && !active.diagnosticActive) {
      active.diagnosticActive = true;
      markDiagnosticStage(active.diagnosticTrace, 'transport', {
        source: 'linuxdo',
        channel: 'webview',
        state: 'active',
        queueLength: linuxDoBrowserFetchQueueRef.current.length
      });
    }
  }, [linuxDoBrowserFetchCurrentRef, linuxDoBrowserFetchQueueRef, rejectLinuxDoBrowserFetchRef, setLinuxDoBrowserFetchRequest]);

  const rejectLinuxDoBrowserFetch = useCallback((request: PendingLinuxDoBrowserFetchRequest, message: string | Error, options: { skipStopLoading?: boolean } = {}) => {
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
  useCommitRefValue(rejectLinuxDoBrowserFetchRef, rejectLinuxDoBrowserFetch);

  const linuxDoFetchWithWebView: Fetcher = useCallback(async (input, init) => {
    const url = String(input);
    if (!isLinuxDoBrowserFetchUrl(url)) {
      return defaultFetcher(input, init);
    }
    await CookieManager.flush().catch(() => undefined);
    return new Promise<Response>((resolve, reject) => {
      let request: PendingLinuxDoBrowserFetchRequest;
      const id = ++linuxDoBrowserFetchIdRef.current;
      const cookie = requestHeaderValue(init?.headers, 'cookie');
      const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
      const browserFetchIntent = browserFetchIntentFromInit(init);
      const inheritedTrace = diagnosticTraceForRequest(init);
      const diagnosticTrace = inheritedTrace || beginDiagnosticTrace('webview', 'browser-fetch', {
        source: 'linuxdo',
        channel: 'webview',
        ...diagnosticBrowserIntent(browserFetchIntent)
      });
      request = {
        id,
        url,
        cookie,
        userAgent,
        diagnosticTrace,
        diagnosticOwnsTrace: !inheritedTrace,
        resolve,
        reject: (error) => {
          finishBrowserFetchFailure(diagnosticTrace, !inheritedTrace, 'linuxdo', error);
          reject(error);
        },
        credentialGeneration: currentLinuxDoAccessGeneration(),
        browserFetchIntent,
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
      enqueueBrowserFetchRequest({
        queueRef: linuxDoBrowserFetchQueueRef,
        request
      });
      markDiagnosticStage(diagnosticTrace, 'guard', {
        source: 'linuxdo',
        channel: 'webview',
        state: 'queued',
        queueLength: linuxDoBrowserFetchQueueRef.current.length
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
    const trace = options?.diagnosticTrace || beginDiagnosticTrace('credential', 'load', { source: 'nodeseek', generation });
    const ownsTrace = !options?.diagnosticTrace;
    options?.captureGeneration?.(generation);
    try {
      const cookies = await readNodeSeekCookiesFromStores({ diagnosticTrace: trace });
      const savedAccess = await readNodeSeekAccessFromStore();
      const savedCookies = parseNodeSeekDocumentCookie(savedAccess?.cookieHeader || '');
      const nodeSeekCookies = mergeNodeSeekCookies(savedCookies, cookies);
      const userId = nodeSeekCredentialUserId(cookies, savedCookies, savedAccess?.userId);
      const webViewCookieHeader = await saveNodeSeekCookieHeader(nodeSeekCookies, { generation, userId, diagnosticTrace: trace });
      if (!isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return undefined;
      }
      const credential = webViewCookieHeader || savedAccess?.cookieHeader || '';
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        store: 'multi-store',
        generation,
        isCurrent: true,
        hasCredential: Boolean(credential)
      });
      if (credential) {
        if (!webViewCookieHeader) {
          const summary = summarizeNodeSeekCookies(savedCookies);
          updateNodeSeekSession(siteCredentialObserved('nodeseek', summary.names, canStoreNodeSeekCookieHeader(savedCookies)));
        }
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'success', { source: 'nodeseek', hasCredential: true });
        }
        return credential;
      }
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'success', { source: 'nodeseek', hasCredential: false });
      }
      return undefined;
    } catch (error) {
      if (!isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return undefined;
      }
      markDiagnosticStage(trace, 'credential', { source: 'nodeseek', store: 'multi-store', state: 'error', reason: 'storage_error' });
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'failure', { source: 'nodeseek', reason: 'storage_error' });
      }
      throw error;
    }
  }, [saveNodeSeekCookieHeader, updateNodeSeekSession]);

  const completeLinuxDoBrowserFetch = useCallback(async (data: {
    id?: number;
    url?: string;
    body?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
    error?: string;
    failureReason?: LinuxDoHiddenBrowserFailureReason;
  }) => {
    const current = linuxDoBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    if (!data.url || !isLinuxDoBrowserFetchUrl(data.url)) {
      rejectLinuxDoBrowserFetch(current, 'linux.do 页面跳转到外部地址，已停止读取');
      return;
    }
    const credentialGeneration = current.credentialGeneration ?? currentLinuxDoAccessGeneration();
    const credentialIsCurrent = credentialGeneration === currentLinuxDoAccessGeneration();
    if (!credentialIsCurrent) {
      rejectLinuxDoBrowserFetch(current, '请求已取消');
      return;
    }
    const isLinuxDoPage = isLinuxDoRequestUrl(data.url);
    if (data.error) {
      rejectLinuxDoBrowserFetch(
        current,
        data.failureReason ? new LinuxDoHiddenBrowserFailureError(data.failureReason, data.error) : data.error
      );
      return;
    }
    linuxDoBrowserWebViewRef.current?.stopLoading();
    linuxDoBrowserFetchCurrentRef.current = null;
    setLinuxDoBrowserFetchRequest(null);
    const userAgent = sanitizeLinuxDoUserAgent(data.userAgent);
    if (credentialIsCurrent && isLinuxDoPage && userAgent) {
      linuxDoWebViewUserAgentRef.current = userAgent;
      setLinuxDoWebViewUserAgent(userAgent);
    }
    const browserCookies = credentialIsCurrent && isLinuxDoPage && typeof data.cookie === 'string'
      ? mergeLinuxDoCookies(
        parseLinuxDoDocumentCookie(current.cookie || ''),
        parseLinuxDoDocumentCookie(linuxDoWebViewCookieHeaderRef.current),
        parseLinuxDoDocumentCookie(data.cookie)
      )
      : {};
    const browserCookieHeader = buildLinuxDoCookieHeader(browserCookies);
    if (browserCookieHeader) {
      publishLinuxDoCookieHeader(browserCookieHeader);
    }
    const settled = settleBrowserFetchRequestOnce(current, () => {
      const challenge = Boolean(data.challenge);
      const status = current.httpErrorStatus || (challenge ? 403 : 200);
      finishBrowserFetchSuccess(
        current.diagnosticTrace,
        current.diagnosticOwnsTrace,
        'linuxdo',
        status,
        (data.body || '').length,
        credentialIsCurrent && typeof data.cookie === 'string' && Boolean(data.cookie),
        challenge
      );
      if (challenge) {
        current.reject(new LinuxDoCloudflareError());
        return;
      }
      current.resolve(linuxDoBrowserResponse(data.body || '', current.httpErrorStatus));
    });
    if (!settled) {
      return;
    }
    startNextLinuxDoBrowserFetch();
    if (credentialIsCurrent && !data.challenge && isLinuxDoPage && typeof data.cookie === 'string') {
      void runBestEffortTask(async () => {
        await CookieManager.flush();
        const [savedAccess, nativeCookies] = await Promise.all([
          loadLinuxDoAccess(),
          readLinuxDoCookiesFromStores()
        ]);
        const cookies = mergeLinuxDoCookies(
          parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || ''),
          browserCookies,
          nativeCookies,
          parseLinuxDoDocumentCookie(data.cookie || '')
        );
        const cookieHeader = buildLinuxDoCookieHeader(cookies);
        if (canStoreLinuxDoAccess(cookies) && cookieHeader) {
          const saved = await saveLinuxDoAccessForGeneration(credentialGeneration, cookieHeader, linuxDoWebViewUserAgentRef.current || userAgent || undefined);
          const summary = summarizeLinuxDoCookies(cookies);
          if (saved && credentialGeneration === currentLinuxDoAccessGeneration()) {
            publishLinuxDoCookieHeader(cookieHeader);
            updateLinuxDoSession({
              type: 'cookie-loaded',
              cookieSummary: summary.names,
              hasVerification: summary.hasClearance,
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
    publishLinuxDoCookieHeader,
    rejectLinuxDoBrowserFetch,
    setLinuxDoBrowserFetchRequest,
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

  const markLinuxDoBrowserFetchHttpError = useCallback((requestId: number, statusCode?: number) => {
    if (linuxDoBrowserFetchCurrentRef.current?.id === requestId) {
      if (statusCode === undefined) {
        delete linuxDoBrowserFetchCurrentRef.current.httpErrorStatus;
      } else {
        linuxDoBrowserFetchCurrentRef.current.httpErrorStatus = statusCode;
      }
    }
  }, []);

  const saveYaohuoCookieHeader = useCallback(async (
    cookieHeader: string,
    { isCurrent = () => true, generation, diagnosticTrace }: { isCurrent?: () => boolean; generation?: number; diagnosticTrace?: DiagnosticTrace } = {}
  ) => {
    const trace = diagnosticTrace || beginDiagnosticTrace('credential', 'save', {
      source: 'yaohuo',
      hasCredential: Boolean(cookieHeader),
      ...(generation === undefined ? {} : { generation })
    });
    const ownsTrace = !diagnosticTrace;
    const task = async ({ isCurrent: isWriteCurrent }: { isCurrent: () => boolean }) => {
      if (!isCurrent() || !isWriteCurrent()) {
        return false;
      }
      await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, cookieHeader);
      return isCurrent() && isWriteCurrent();
    };
    try {
      const saved = generation === undefined
        ? await replaceCredentialWrite(yaohuoCredentialGateRef.current, task)
        : await enqueueCredentialWriteForGeneration(yaohuoCredentialGateRef.current, generation, task);
      const current = saved === true;
      markDiagnosticStage(trace, 'persist', {
        source: 'yaohuo',
        store: 'secure-store',
        hasCredential: current
      });
      if (ownsTrace) {
        finishDiagnosticTrace(trace, current ? 'success' : 'stale', {
          source: 'yaohuo',
          hasCredential: current,
          ...(!current ? { reason: 'stale' } : {})
        });
      }
      return current;
    } catch (error) {
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'failure', { source: 'yaohuo', reason: 'storage_error' });
      }
      throw error;
    }
  }, []);

  const clearStoredYaohuoLoginState = useCallback(async (options: CredentialClearOptions = {}, applySessionState = true) => {
    const trace = beginDiagnosticTrace('credential', 'clear', {
      source: 'yaohuo',
      ...(options.generation === undefined ? {} : { generation: options.generation })
    });
    try {
      const cleared = options.generation !== undefined && !options.force
        ? await enqueueCredentialWriteForGeneration(yaohuoCredentialGateRef.current, options.generation, async () => {
          await SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
          return true;
        })
        : await replaceCredentialWrite(yaohuoCredentialGateRef.current, async () => {
          await SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
          return true;
        });
      if (cleared !== undefined) {
        markDiagnosticStage(trace, 'persist', { source: 'yaohuo', store: 'secure-store', state: 'cleared' });
        if (applySessionState) {
          updateYaohuoSession(options.expiredMessage?.trim()
            ? {
              type: 'login-expired',
              message: options.expiredMessage.trim(),
              ...(options.recoveryQueryKey ? { recoveryQueryKey: options.recoveryQueryKey } : {})
            }
            : { type: 'cleared' });
        }
        finishDiagnosticTrace(trace, 'success');
        return true;
      }
      finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
      return false;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
      throw error;
    }
  }, [updateYaohuoSession]);

  const applyNodeSeekClearedState = useCallback(() => {
    webLoginDetectedRef.current = false;
    publishNodeSeekCookieHeader('');
    updateNodeSeekSession({ type: 'cleared' });
    setWebLoginUserId(null);
    nodeSeekWebViewUserAgentRef.current = DEFAULT_NODESEEK_ANDROID_USER_AGENT;
    setNodeSeekWebViewUserAgent(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  }, [
    nodeSeekWebViewUserAgentRef,
    publishNodeSeekCookieHeader,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    updateNodeSeekSession,
    webLoginDetectedRef
  ]);

  const clearStoredNodeSeekLoginState = useCallback(async (
    applySessionState = true,
    options: CredentialClearOptions = {}
  ) => {
    const trace = beginDiagnosticTrace('credential', 'clear', {
      source: 'nodeseek',
      ...(options.generation === undefined ? {} : { generation: options.generation })
    });
    try {
      const task = async () => {
        await deleteNodeSeekAccessFromStore();
        return true;
      };
      const cleared = options.generation !== undefined && !options.force
        ? await enqueueCredentialWriteForGeneration(nodeSeekCredentialGateRef.current, options.generation, task)
        : await replaceCredentialWrite(nodeSeekCredentialGateRef.current, task);
      if (cleared !== true) {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return false;
      }
      markDiagnosticStage(trace, 'persist', { source: 'nodeseek', store: 'secure-store', state: 'cleared' });
      if (applySessionState) {
        applyNodeSeekClearedState();
      }
      finishDiagnosticTrace(trace, 'success');
      return true;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
      throw error;
    }
  }, [applyNodeSeekClearedState]);

  const currentNodeSeekCredentialGeneration = useCallback(() => nodeSeekCredentialGateRef.current.generation, []);
  const currentYaohuoCredentialGeneration = useCallback(() => yaohuoCredentialGateRef.current.generation, []);

  const removeYaohuoLoginState = useCallback((options: CredentialClearOptions = {}) => (
    runYaohuoLogoutTransaction({
      currentGeneration: currentYaohuoCredentialGeneration,
      options,
      removeStoredState: clearStoredYaohuoLoginState,
      reportSessionState: updateYaohuoSession
    })
  ), [clearStoredYaohuoLoginState, currentYaohuoCredentialGeneration, updateYaohuoSession]);

  const clearNodeSeekLoginState = useCallback((options: CredentialClearOptions = {}) => (
    runNodeSeekLogoutTransaction({
      applyClearedState: applyNodeSeekClearedState,
      currentGeneration: currentNodeSeekCredentialGeneration,
      options,
      removeStoredState: clearStoredNodeSeekLoginState,
      reportSessionState: updateNodeSeekSession
    })
  ), [applyNodeSeekClearedState, clearStoredNodeSeekLoginState, currentNodeSeekCredentialGeneration, updateNodeSeekSession]);

  return {
    clearNodeSeekLoginState,
    clearStoredNodeSeekLoginState,
    clearStoredYaohuoLoginState,
    clearYaohuoLoginState: removeYaohuoLoginState,
    commitAccountStatusExpiry,
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    dispatchSiteSessionEvent,
    forumFetchWithWebViewFallback,
    forumCredentialScope,
    hiddenBrowserFetchRequests: {
      linuxDo: linuxDoBrowserFetchRequest,
      nodeSeek: nodeSeekBrowserFetchRequest
    },
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    saveNodeSeekCookieHeader,
    saveYaohuoCookieHeader,
    siteSessionStates,
    siteSessionViewModels,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession
  };
}

function siteCredentialObserved(site: SessionSite, cookieSummary: string[], hasVerification: boolean, at = new Date().toISOString()): ScopedSiteSessionEvent {
  return {
    site,
    type: 'cookie-loaded',
    cookieSummary,
    hasVerification,
    at
  };
}
