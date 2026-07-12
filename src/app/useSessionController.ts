import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import {
  DEFAULT_NODESEEK_ANDROID_USER_AGENT,
  buildCookieHeader,
  buildNodeSeekSetCookieHeaders,
  canStoreNodeSeekCookieHeader,
  mergeNodeSeekCookies,
  nodeSeekBrowserCookieHeaderForPersistence,
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
  summarizeNodeSeekCookies,
  type NodeSeekAccessRecord
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
import { REQUEST_SUPERSEDED_MESSAGE, type Fetcher } from '../request';
import { createNodeSeekWebViewFallbackFetcher, isNodeSeekBrowserFetchUrl, isNodeSeekRequestUrl, type NodeSeekDirectRecoveryEvent } from '../nodeseekFetchFallback';
import { createLinuxDoWebViewFallbackFetcher, isLinuxDoBrowserFetchUrl, isLinuxDoRequestUrl } from '../linuxdoFetchFallback';
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
  enqueueLatestBrowserFetchRequest,
  enqueueCredentialWriteForGeneration,
  enqueueCredentialWrite,
  isCredentialWriteCurrent,
  preemptActiveBrowserFetchRequest,
  replaceCredentialWrite,
  replaceCredentialWriteForGeneration,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  rejectBrowserFetchRequest,
  requestHeaderValue,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  shouldKeepQueuedBrowserFetchRequest,
  startNextBrowserFetchRequest,
  waitForCredentialWrites,
  type CredentialClearOptions,
  type CredentialLoadOptions
} from './sessionControllerHelpers';

const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const NODESEEK_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const NODESEEK_LOGIN_REVOCATION_STORAGE_KEY = 'nodeseek-login-revoked';
const LINUXDO_BROWSER_FETCH_TIMEOUT_MS = 15000;
const LINUXDO_COOKIE_PERSIST_TIMEOUT_MS = 1200;
const YAOHUO_COOKIE_URLS = [YAOHUO_URL];
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';
const YAOHUO_LOGIN_REVOCATION_STORAGE_KEY = 'yaohuo-login-revoked';

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

async function writeNodeSeekAccessToStore(cookieHeader: string, userAgent?: string, userId?: number | null) {
  const savedAccess = userId === undefined ? await readNodeSeekAccessFromStore() : null;
  await SecureStore.setItemAsync(NODESEEK_ACCESS_STORAGE_KEY, JSON.stringify(nodeSeekAccessRecord(
    cookieHeader,
    userAgent,
    userId === undefined ? savedAccess?.userId : userId
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
  cookie?: string;
  userAgent?: string;
};

type PendingLinuxDoBrowserFetchRequest = LinuxDoBrowserFetchRequest & {
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

async function readNodeSeekLoginRevocation() {
  return await SecureStore.getItemAsync(NODESEEK_LOGIN_REVOCATION_STORAGE_KEY) === '1';
}

function nodeSeekAccessWithoutLogin(access: Awaited<ReturnType<typeof readNodeSeekAccessFromStore>>): NodeSeekAccessRecord | null {
  if (!access) {
    return null;
  }
  const cookieHeader = buildCookieHeader(removeNodeSeekLoginCookies(parseNodeSeekDocumentCookie(access.cookieHeader)));
  if (!cookieHeader) {
    return null;
  }
  const { userId: _userId, ...verificationAccess } = access;
  return { ...verificationAccess, cookieHeader };
}

function cookieValuesForCleanup(cookies: Record<string, { name?: string; value?: string }>) {
  return Object.entries(cookies).reduce<Record<string, string>>((values, [key, cookie]) => {
    const name = cookie.name || key;
    if (name && cookie.value) {
      values[name] = cookie.value;
    }
    return values;
  }, {});
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
  linuxDoClearanceBeforeVerifyRef,
  linuxDoWebViewCookieHeaderRef,
  linuxDoWebViewUserAgentRef,
  nodeSeekBrowserWebViewRef,
  nodeSeekWebViewCookieHeaderRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  recoverNodeSeekNetwork,
  setLinuxDoWebViewCookieHeader,
  setLinuxDoWebViewUserAgent,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  webLoginDetectedRef
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
  recoverNodeSeekNetwork?: (event: NodeSeekDirectRecoveryEvent) => Promise<unknown> | unknown;
  setLinuxDoWebViewCookieHeader: Dispatch<SetStateAction<string>>;
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
  const nodeSeekCredentialSnapshotIdRef = useRef(0);
  const linuxDoCredentialSnapshotIdRef = useRef(0);
  const yaohuoCredentialGateRef = useRef(createCredentialWriteGate());
  const nodeSeekLoginRevokedRef = useRef<boolean | null>(null);
  const yaohuoLoginRevokedRef = useRef<boolean | null>(null);
  const [siteSessionStates, setSiteSessionStates] = useState(() => createSiteSessionStates());
  const siteSessionViewModels = useMemo(() => createSiteSessionViewModels(siteSessionStates), [siteSessionStates]);

  const dispatchSiteSessionEvent = useCallback((event: ScopedSiteSessionEvent) => {
    const trace = beginDiagnosticTrace('session', 'state-transition', {
      source: event.site,
      eventType: event.type
    });
    if (event.site === 'nodeseek' && (
      event.type === 'login-expired'
      || event.type === 'cleared'
      || event.type === 'verification-required'
      || event.type === 'verification-started'
      || (event.type === 'cookie-loaded' && event.loggedIn !== true)
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
  }, [setWebLoginUserId]);

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
    const trace = beginDiagnosticTrace('credential', 'load-stored');
    void (async () => {
      const nodeSeekGeneration = nodeSeekCredentialGateRef.current.generation;
      const yaohuoGeneration = yaohuoCredentialGateRef.current.generation;
      const linuxDoGeneration = currentLinuxDoAccessGeneration();
      const [nodeSeekAccessResult, yaohuoCookieResult, linuxDoAccessResult] = await Promise.allSettled([
        Promise.all([readNodeSeekAccessFromStore(), readNodeSeekLoginRevocation()]),
        Promise.all([
          SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
          SecureStore.getItemAsync(YAOHUO_LOGIN_REVOCATION_STORAGE_KEY)
        ]),
        loadLinuxDoAccess()
      ]);
      const rawNodeSeekAccess = nodeSeekAccessResult.status === 'fulfilled' ? nodeSeekAccessResult.value[0] : null;
      const nodeSeekLoginRevoked = nodeSeekLoginRevokedRef.current === true
        || (nodeSeekAccessResult.status === 'fulfilled' && nodeSeekAccessResult.value[1]);
      const savedNodeSeekAccess = nodeSeekLoginRevoked ? nodeSeekAccessWithoutLogin(rawNodeSeekAccess) : rawNodeSeekAccess;
      const rawYaohuoCookie = yaohuoCookieResult.status === 'fulfilled' ? yaohuoCookieResult.value[0] : null;
      const yaohuoLoginRevoked = yaohuoLoginRevokedRef.current === true
        || (yaohuoCookieResult.status === 'fulfilled' && yaohuoCookieResult.value[1] === '1');
      const savedYaohuoCookie = yaohuoLoginRevoked ? null : rawYaohuoCookie;
      const linuxDoAccess = linuxDoAccessResult.status === 'fulfilled' ? linuxDoAccessResult.value : null;
      const failedStoreCount = [nodeSeekAccessResult, yaohuoCookieResult, linuxDoAccessResult]
        .filter((result) => result.status === 'rejected').length;
      const nodeSeekReadCurrent = isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, nodeSeekGeneration);
      const yaohuoReadCurrent = isCredentialWriteCurrent(yaohuoCredentialGateRef.current, yaohuoGeneration);
      const linuxDoReadCurrent = linuxDoGeneration === currentLinuxDoAccessGeneration();
      if (nodeSeekAccessResult.status === 'fulfilled' && nodeSeekReadCurrent) {
        nodeSeekLoginRevokedRef.current = nodeSeekLoginRevoked;
      }
      if (yaohuoCookieResult.status === 'fulfilled' && yaohuoReadCurrent) {
        yaohuoLoginRevokedRef.current = yaohuoLoginRevoked;
      }
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        store: 'secure-store',
        generation: nodeSeekGeneration,
        ...(nodeSeekAccessResult.status === 'rejected'
          ? { state: 'error', reason: 'storage_error' }
          : { isCurrent: nodeSeekReadCurrent, hasCredential: Boolean(savedNodeSeekAccess?.cookieHeader) })
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        store: 'secure-store',
        generation: yaohuoGeneration,
        ...(yaohuoCookieResult.status === 'rejected'
          ? { state: 'error', reason: 'storage_error' }
          : { isCurrent: yaohuoReadCurrent, hasCredential: Boolean(savedYaohuoCookie) })
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        store: 'secure-store',
        generation: linuxDoGeneration,
        ...(linuxDoAccessResult.status === 'rejected'
          ? { state: 'error', reason: 'storage_error' }
          : { isCurrent: linuxDoReadCurrent, hasCredential: Boolean(linuxDoAccess?.cookieHeader) })
      });
      if (nodeSeekAccessResult.status === 'fulfilled' && nodeSeekReadCurrent && savedNodeSeekAccess?.userAgent) {
        const userAgent = sanitizeNodeSeekUserAgent(savedNodeSeekAccess.userAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (nodeSeekAccessResult.status === 'fulfilled' && nodeSeekReadCurrent) {
        setWebLoginUserId(savedNodeSeekAccess?.userId || null);
      }
      if (nodeSeekReadCurrent && savedNodeSeekAccess?.cookieHeader) {
        const savedCookies = parseNodeSeekDocumentCookie(savedNodeSeekAccess.cookieHeader);
        const summary = summarizeNodeSeekCookies(savedCookies);
        updateNodeSeekSession(siteEventWithCookieFacts('nodeseek', summary.names, canStoreNodeSeekCookieHeader(savedCookies), summary.loggedIn));
        notify(summary.loggedIn ? '已找到本机保存的 NodeSeek 登录 Cookie。' : '已找到本机保存的 NodeSeek 验证信息。');
      } else if (nodeSeekReadCurrent && nodeSeekLoginRevoked) {
        updateNodeSeekSession({ type: 'login-expired', message: 'NodeSeek 登录已失效' });
      }
      if (yaohuoReadCurrent && savedYaohuoCookie) {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(savedYaohuoCookie));
        updateYaohuoSession(siteEventWithCookieFacts('yaohuo', yaohuoSummary.names, false, yaohuoSummary.loggedIn));
        notify('已找到本机保存的妖火 Cookie。');
      } else if (yaohuoReadCurrent && yaohuoLoginRevoked) {
        updateYaohuoSession({ type: 'login-expired', message: '妖火登录已失效' });
      }
      if (linuxDoAccessResult.status === 'fulfilled' && linuxDoReadCurrent) {
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
      }
      if (failedStoreCount) {
        notify('部分账号登录状态读取失败，请稍后刷新。');
      }
      finishDiagnosticTrace(trace, failedStoreCount ? 'partial' : 'success');
    })()
      .catch((error) => {
        finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
        notify(errorMessage(error));
      });
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
    let generation = yaohuoCredentialGateRef.current.generation;
    const trace = options?.diagnosticTrace || beginDiagnosticTrace('credential', 'load', { source: 'yaohuo', generation });
    const ownsTrace = !options?.diagnosticTrace;
    try {
      generation = await waitForCredentialWrites(yaohuoCredentialGateRef.current);
      options?.captureGeneration?.(generation);
      const [storedCookie, storedRevocation] = await Promise.all([
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
        SecureStore.getItemAsync(YAOHUO_LOGIN_REVOCATION_STORAGE_KEY)
      ]);
      const current = isCredentialWriteCurrent(yaohuoCredentialGateRef.current, generation);
      const loginRevoked = yaohuoLoginRevokedRef.current === true || storedRevocation === '1';
      const cookie = loginRevoked ? null : storedCookie;
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
      yaohuoLoginRevokedRef.current = loginRevoked;
      if (loginRevoked) {
        updateYaohuoSession({ type: 'login-expired', message: '妖火登录已失效' });
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'success', { source: 'yaohuo', hasCredential: false, state: 'expired' });
        }
        return undefined;
      }
      const summary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookie || ''));
      updateYaohuoSession(siteEventWithCookieFacts('yaohuo', summary.names, false, summary.loggedIn));
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'success', { source: 'yaohuo', hasCredential: Boolean(cookie) });
      }
      return cookie || undefined;
    } catch (error) {
      markDiagnosticStage(trace, 'credential', { source: 'yaohuo', store: 'secure-store', state: 'error', reason: 'storage_error' });
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'failure', { source: 'yaohuo', reason: 'storage_error' });
      }
      throw error;
    }
  }, [updateYaohuoSession]);

  const saveNodeSeekCookieHeader = useCallback(async (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    { verifiedByPage = false, isCurrent = () => true, generation, resetCurrentUser = false, snapshotId, userId, diagnosticTrace }: { verifiedByPage?: boolean; isCurrent?: () => boolean; generation?: number; resetCurrentUser?: boolean; snapshotId?: number; userId?: number | null; diagnosticTrace?: DiagnosticTrace } = {}
  ) => {
    const trace = diagnosticTrace || beginDiagnosticTrace('credential', 'save', {
      source: 'nodeseek',
      hasCredential: Object.keys(cookies).length > 0,
      ...(generation === undefined ? {} : { generation })
    });
    const ownsTrace = !diagnosticTrace;
    const rawSummary = summarizeNodeSeekCookies(cookies);
    const credentialSnapshotId = snapshotId ?? (
      generation === undefined || isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)
        ? ++nodeSeekCredentialSnapshotIdRef.current
        : nodeSeekCredentialSnapshotIdRef.current
    );
    let skippedAsStale = false;
    const task = async ({ isCurrent: isWriteCurrent }: { isCurrent: () => boolean }) => {
      const stillCurrent = () => isCurrent()
        && isWriteCurrent()
        && credentialSnapshotId === nodeSeekCredentialSnapshotIdRef.current;
      if (!stillCurrent()) {
        skippedAsStale = true;
        return '';
      }
      let loginRevoked = nodeSeekLoginRevokedRef.current;
      if (loginRevoked === null) {
        loginRevoked = await readNodeSeekLoginRevocation();
        if (!stillCurrent()) {
          skippedAsStale = true;
          return '';
        }
        nodeSeekLoginRevokedRef.current = loginRevoked;
      }
      const acceptsVerifiedLogin = verifiedByPage && rawSummary.loggedIn;
      const effectiveCookies = loginRevoked && !acceptsVerifiedLogin ? removeNodeSeekLoginCookies(cookies) : cookies;
      const summary = summarizeNodeSeekCookies(effectiveCookies);
      const cookieHeader = buildCookieHeader(effectiveCookies);
      if (canStoreNodeSeekCookieHeader(effectiveCookies, verifiedByPage) && cookieHeader) {
        const cookieUserId = nodeSeekUserIdFromCookies(effectiveCookies);
        const effectiveUserId = summary.loggedIn
          ? userId === undefined ? cookieUserId || null : userId
          : null;
        await writeNodeSeekAccessToStore(
          cookieHeader,
          nodeSeekWebViewUserAgentRef.current || DEFAULT_NODESEEK_ANDROID_USER_AGENT,
          effectiveUserId
        );
        if (!stillCurrent()) {
          skippedAsStale = true;
          return '';
        }
        if (acceptsVerifiedLogin) {
          await SecureStore.deleteItemAsync(NODESEEK_LOGIN_REVOCATION_STORAGE_KEY);
          if (!stillCurrent()) {
            skippedAsStale = true;
            return '';
          }
          nodeSeekLoginRevokedRef.current = false;
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
        skippedAsStale = true;
        return '';
      }
      updateNodeSeekSession({
        type: summary.loggedIn ? 'login-detected' : 'verification-required',
        ...(summary.names.length ? { cookieSummary: summary.names } : {}),
        ...(summary.loggedIn ? { at: new Date().toISOString() } : {})
      });
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
      enqueueLatestBrowserFetchRequest({
        queueRef: nodeSeekBrowserFetchQueueRef,
        request,
        message: REQUEST_SUPERSEDED_MESSAGE,
        shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
      });
      markDiagnosticStage(diagnosticTrace, 'guard', {
        source: 'nodeseek',
        channel: 'webview',
        state: 'queued',
        queueLength: nodeSeekBrowserFetchQueueRef.current.length
      });
      preemptActiveBrowserFetchRequest({
        currentRef: nodeSeekBrowserFetchCurrentRef,
        request,
        message: REQUEST_SUPERSEDED_MESSAGE,
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
      const generation = current.credentialGeneration ?? nodeSeekCredentialGateRef.current.generation;
      void runBestEffortTask(async () => {
        await waitForCredentialWrites(nodeSeekCredentialGateRef.current);
        if (!isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)) {
          return;
        }
        const snapshotId = ++nodeSeekCredentialSnapshotIdRef.current;
        await CookieManager.flush();
        const nativeCookies = await readNodeSeekCookiesFromStores();
        if (snapshotId !== nodeSeekCredentialSnapshotIdRef.current) {
          return;
        }
        await saveNodeSeekCookieHeader(mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(cookieHeaderForPersistence)), {
          generation,
          snapshotId
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
      enqueueLatestBrowserFetchRequest({
        queueRef: linuxDoBrowserFetchQueueRef,
        request,
        message: REQUEST_SUPERSEDED_MESSAGE
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
    appState: AppState,
    defaultFetcher,
    recoverNodeSeekNetwork,
    webViewFetcher: nodeSeekFetchWithWebView
  }), [defaultFetcher, nodeSeekFetchWithWebView, recoverNodeSeekNetwork]);

  const forumFetchWithWebViewFallback = useMemo(() => createLinuxDoWebViewFallbackFetcher({
    defaultFetcher: nodeSeekFetchWithWebViewFallback,
    webViewFetcher: linuxDoFetchWithWebView
  }), [linuxDoFetchWithWebView, nodeSeekFetchWithWebViewFallback]);

  const loadNodeSeekCookieForSource = useCallback(async (source: FeedSource | Source, options?: CredentialLoadOptions) => {
    if (source !== 'all' && source !== 'nodeseek') {
      return undefined;
    }
    let generation = nodeSeekCredentialGateRef.current.generation;
    let snapshotId = 0;
    const trace = options?.diagnosticTrace || beginDiagnosticTrace('credential', 'load', { source: 'nodeseek', generation });
    const ownsTrace = !options?.diagnosticTrace;
    try {
      generation = await waitForCredentialWrites(nodeSeekCredentialGateRef.current);
      options?.captureGeneration?.(generation);
      snapshotId = ++nodeSeekCredentialSnapshotIdRef.current;
      const [cookies, rawSavedAccess, storedRevocation] = await Promise.all([
        readNodeSeekCookiesFromStores({ diagnosticTrace: trace }),
        readNodeSeekAccessFromStore(),
        readNodeSeekLoginRevocation()
      ]);
      if (!isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return undefined;
      }
      const loginRevoked = nodeSeekLoginRevokedRef.current === true || storedRevocation;
      nodeSeekLoginRevokedRef.current = loginRevoked;
      const savedAccess = loginRevoked ? nodeSeekAccessWithoutLogin(rawSavedAccess) : rawSavedAccess;
      const currentCookies = loginRevoked ? removeNodeSeekLoginCookies(cookies) : cookies;
      const savedCookies = parseNodeSeekDocumentCookie(savedAccess?.cookieHeader || '');
      const nodeSeekCookies = mergeNodeSeekCookies(savedCookies, currentCookies);
      const userId = loginRevoked ? null : nodeSeekCredentialUserId(currentCookies, savedCookies, savedAccess?.userId);
      const snapshotIsLatest = snapshotId === nodeSeekCredentialSnapshotIdRef.current;
      const webViewCookieHeader = snapshotIsLatest
        ? await saveNodeSeekCookieHeader(nodeSeekCookies, { generation, snapshotId, userId, diagnosticTrace: trace })
        : '';
      if (!isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, generation)) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
        }
        return undefined;
      }
      const credential = webViewCookieHeader || buildCookieHeader(nodeSeekCookies) || savedAccess?.cookieHeader || '';
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        store: 'multi-store',
        generation,
        isCurrent: snapshotIsLatest,
        hasCredential: Boolean(credential)
      });
      if (credential) {
        if (snapshotIsLatest && !webViewCookieHeader) {
          const summary = summarizeNodeSeekCookies(savedCookies);
          updateNodeSeekSession(siteEventWithCookieFacts('nodeseek', summary.names, canStoreNodeSeekCookieHeader(savedCookies), summary.loggedIn));
        }
        options?.captureNodeSeekUserId?.(userId);
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'success', { source: 'nodeseek', hasCredential: true });
        }
        return credential;
      }
      if (snapshotIsLatest) {
        updateNodeSeekSession({ type: 'cleared' });
      }
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'success', { source: 'nodeseek', hasCredential: false });
      }
      return undefined;
    } catch (error) {
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
      const challenge = Boolean(data.challenge);
      const status = challenge ? 403 : current.httpErrorStatus || 200;
      finishBrowserFetchSuccess(
        current.diagnosticTrace,
        current.diagnosticOwnsTrace,
        'linuxdo',
        status,
        (data.body || '').length,
        typeof data.cookie === 'string' && Boolean(data.cookie),
        challenge
      );
      current.resolve(linuxDoBrowserResponse(data.body || '', Boolean(data.challenge), current.httpErrorStatus));
    });
    if (!settled) {
      return;
    }
    startNextLinuxDoBrowserFetch();
    if (!data.challenge && isLinuxDoPage && typeof data.cookie === 'string') {
      const generation = current.credentialGeneration ?? currentLinuxDoAccessGeneration();
      const snapshotId = ++linuxDoCredentialSnapshotIdRef.current;
      void runBestEffortTask(async () => {
        await CookieManager.flush();
        const [savedAccess, nativeCookies] = await Promise.all([
          loadLinuxDoAccess(),
          readLinuxDoCookiesFromStores()
        ]);
        if (snapshotId !== linuxDoCredentialSnapshotIdRef.current
          || generation !== currentLinuxDoAccessGeneration()) {
          return;
        }
        const cookies = mergeLinuxDoCookies(
          parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || ''),
          nativeCookies,
          parseLinuxDoDocumentCookie(data.cookie || '')
        );
        const cookieHeader = buildLinuxDoCookieHeader(cookies);
        if (canStoreLinuxDoAccess(cookies) && cookieHeader) {
          const saved = await saveLinuxDoAccessForGeneration(
            generation,
            cookieHeader,
            linuxDoWebViewUserAgentRef.current || userAgent || undefined
          );
          const summary = summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(saved?.cookieHeader || ''));
          if (saved
            && snapshotId === linuxDoCredentialSnapshotIdRef.current
            && generation === currentLinuxDoAccessGeneration()) {
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

  const restoreSavedYaohuoCookiesToWebView = useCallback(async ({
    isCurrent: isRequestCurrent = () => true
  }: { isCurrent?: () => boolean } = {}) => {
    const trace = beginDiagnosticTrace('credential', 'restore-webview', { source: 'yaohuo' });
    try {
      const restored = await enqueueCredentialWrite(yaohuoCredentialGateRef.current, async ({ isCurrent }) => {
        const stillCurrent = () => isCurrent() && isRequestCurrent();
        if (!stillCurrent()) {
          return false;
        }
        const [storedCookie, storedRevocation] = await Promise.all([
          SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
          SecureStore.getItemAsync(YAOHUO_LOGIN_REVOCATION_STORAGE_KEY)
        ]);
        const loginRevoked = yaohuoLoginRevokedRef.current === true || storedRevocation === '1';
        const cookieHeader = loginRevoked ? null : storedCookie;
        markDiagnosticStage(trace, 'credential', {
          source: 'yaohuo',
          store: 'secure-store',
          hasCredential: Boolean(cookieHeader)
        });
        if (!stillCurrent()) {
          return false;
        }
        yaohuoLoginRevokedRef.current = loginRevoked;
        if (loginRevoked) {
          updateYaohuoSession({ type: 'login-expired', message: '妖火登录已失效' });
          return true;
        }
        if (!cookieHeader) {
          updateYaohuoSession({ type: 'cleared' });
          return true;
        }
        const summary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookieHeader));
        updateYaohuoSession(siteEventWithCookieFacts('yaohuo', summary.names, false, summary.loggedIn));
        const headers = buildYaohuoSetCookieHeaders(cookieHeader);
        markDiagnosticStage(trace, 'apply', { source: 'yaohuo', channel: 'webview', state: 'start' });
        for (const url of YAOHUO_COOKIE_URLS) {
          for (const header of headers) {
            if (!stillCurrent()) {
              return false;
            }
            if (!await CookieManager.setFromResponse(url, header)) {
              throw new Error('Cookie 写入失败');
            }
          }
        }
        if (headers.length && stillCurrent()) {
          await CookieManager.flush();
        }
        return stillCurrent();
      });
      finishDiagnosticTrace(trace, restored ? 'success' : 'stale', restored ? {} : { reason: 'stale' });
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, [updateYaohuoSession]);

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
      if (!isCurrent() || !isWriteCurrent()) {
        return false;
      }
      await SecureStore.deleteItemAsync(YAOHUO_LOGIN_REVOCATION_STORAGE_KEY);
      if (!isCurrent() || !isWriteCurrent()) {
        return false;
      }
      yaohuoLoginRevokedRef.current = false;
      return true;
    };
    try {
      const saved = generation === undefined
        ? await replaceCredentialWrite(yaohuoCredentialGateRef.current, task)
        : await replaceCredentialWriteForGeneration(yaohuoCredentialGateRef.current, generation, task);
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

  const restoreSavedNodeSeekCookiesToWebView = useCallback(async () => {
    const trace = beginDiagnosticTrace('credential', 'restore-webview', { source: 'nodeseek' });
    try {
      const restored = await enqueueCredentialWrite(nodeSeekCredentialGateRef.current, async ({ isCurrent }) => {
        const [rawAccess, storedRevocation] = await Promise.all([
          readNodeSeekAccessFromStore(),
          readNodeSeekLoginRevocation()
        ]);
        if (!isCurrent()) {
          return false;
        }
        const loginRevoked = nodeSeekLoginRevokedRef.current === true || storedRevocation;
        nodeSeekLoginRevokedRef.current = loginRevoked;
        const access = loginRevoked ? nodeSeekAccessWithoutLogin(rawAccess) : rawAccess;
        const cookieHeader = access?.cookieHeader || '';
        const headers = buildNodeSeekSetCookieHeaders(cookieHeader);
        markDiagnosticStage(trace, 'credential', {
          source: 'nodeseek',
          store: 'secure-store',
          hasCredential: Boolean(headers.length)
        });
        for (const url of NODESEEK_COOKIE_URLS) {
          for (const header of headers) {
            if (!isCurrent()) {
              return false;
            }
            if (!await CookieManager.setFromResponse(url, header)) {
              throw new Error('Cookie 写入失败');
            }
          }
        }
        if (headers.length && isCurrent()) {
          await CookieManager.flush();
        }
        if (!isCurrent()) {
          return false;
        }
        nodeSeekWebViewCookieHeaderRef.current = cookieHeader;
        const userAgent = sanitizeNodeSeekUserAgent(access?.userAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
        return true;
      });
      finishDiagnosticTrace(trace, restored ? 'success' : 'stale', restored ? {} : { reason: 'stale' });
      return restored === true;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { source: 'nodeseek', reason: normalizeDiagnosticReason(error) });
      return false;
    }
  }, [nodeSeekWebViewCookieHeaderRef, nodeSeekWebViewUserAgentRef, setNodeSeekWebViewUserAgent]);

  const clearYaohuoLoginState = useCallback(async (options: CredentialClearOptions = {}) => {
    const trace = beginDiagnosticTrace('credential', 'clear', {
      source: 'yaohuo',
      ...(options.generation === undefined ? {} : { generation: options.generation })
    });
    const isRequestCurrent = options.isCurrent || (() => true);
    const isAutomaticClear = options.generation !== undefined && !options.force;
    let ownedClearGeneration: number | undefined;
    let webViewCleanupStarted = false;
    try {
      const task = async ({ isCurrent }: { isCurrent: () => boolean }) => {
        let revocationPersistenceError: unknown;
        if (!isCurrent() || !isRequestCurrent()) {
          return false;
        }
        if (isAutomaticClear) {
          updateYaohuoSession({ type: 'login-expired', message: '妖火登录已失效' });
          yaohuoLoginRevokedRef.current = true;
          try {
            await SecureStore.setItemAsync(YAOHUO_LOGIN_REVOCATION_STORAGE_KEY, '1');
          } catch (error) {
            revocationPersistenceError = error;
          }
          if (!isCurrent()) {
            return false;
          }
          if (!isRequestCurrent()) {
            return false;
          }
        }
        const previousCookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
        if (!isCurrent()) {
          return false;
        }
        if (!isRequestCurrent()) {
          return false;
        }
        const restorePreviousCookie = async (restoreWebView: boolean) => {
          if (!previousCookie || !isCurrent()) {
            return;
          }
          await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, previousCookie);
          if (!restoreWebView || !isCurrent()) {
            return;
          }
          for (const url of YAOHUO_COOKIE_URLS) {
            for (const header of buildYaohuoSetCookieHeaders(previousCookie)) {
              if (!await CookieManager.setFromResponse(url, header)) {
                throw new Error('Cookie 写入失败');
              }
            }
          }
          await CookieManager.flush();
        };
        await SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
        if (!isCurrent()) {
          return false;
        }
        if (!isRequestCurrent()) {
          await restorePreviousCookie(false);
          return false;
        }
        markDiagnosticStage(trace, 'persist', { source: 'yaohuo', store: 'secure-store', state: 'cleared' });
        try {
          webViewCleanupStarted = true;
          const expectedValues = isAutomaticClear
            ? cookieValuesForCleanup(yaohuoCookieMapFromHeader(previousCookie || ''))
            : undefined;
          const clearedSnapshot = await clearCookieUrls(
            CookieManager,
            YAOHUO_COOKIE_URLS,
            expectedValues ? Object.keys(expectedValues) : undefined,
            expectedValues
          );
          if (!clearedSnapshot) {
            return false;
          }
        } catch (error) {
          if (!isAutomaticClear || !isRequestCurrent()) {
            await restorePreviousCookie(true);
          }
          throw error;
        }
        if (!isCurrent()) {
          return false;
        }
        if (!isRequestCurrent()) {
          await restorePreviousCookie(true);
          return false;
        }
        markDiagnosticStage(trace, 'apply', { source: 'yaohuo', store: 'cookie-manager', state: 'cleared' });
        if (revocationPersistenceError) {
          throw revocationPersistenceError;
        }
        updateYaohuoSession({ type: 'cleared' });
        return true;
      };
      const conditionalClearCurrent = options.generation !== undefined
        && !options.force
        && isCredentialWriteCurrent(yaohuoCredentialGateRef.current, options.generation);
      const clear = options.generation !== undefined && !options.force
        ? replaceCredentialWriteForGeneration(yaohuoCredentialGateRef.current, options.generation, task)
        : replaceCredentialWrite(yaohuoCredentialGateRef.current, task);
      if (conditionalClearCurrent || options.generation === undefined || options.force) {
        ownedClearGeneration = yaohuoCredentialGateRef.current.generation;
      }
      const cleared = await clear;
      if (cleared !== true) {
        if (webViewCleanupStarted
          && ownedClearGeneration !== undefined
          && !isCredentialWriteCurrent(yaohuoCredentialGateRef.current, ownedClearGeneration)) {
          await restoreSavedYaohuoCookiesToWebView().catch(() => undefined);
        }
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return false;
      }
      finishDiagnosticTrace(trace, 'success');
      return true;
    } catch (error) {
      const automaticClearStillOwned = ownedClearGeneration !== undefined
        && isCredentialWriteCurrent(yaohuoCredentialGateRef.current, ownedClearGeneration)
        && isRequestCurrent();
      if (ownedClearGeneration !== undefined && !automaticClearStillOwned) {
        if (webViewCleanupStarted) {
          await restoreSavedYaohuoCookiesToWebView().catch(() => undefined);
        }
        finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
        return false;
      }
      if (automaticClearStillOwned) {
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          generation: ownedClearGeneration ?? 0,
          state: 'expired'
        });
        updateYaohuoSession({ type: 'login-expired', message: '妖火登录已失效' });
      }
      finishDiagnosticTrace(trace, 'failure', { source: 'yaohuo', reason: 'storage_error' });
      throw error;
    }
  }, [restoreSavedYaohuoCookiesToWebView, updateYaohuoSession]);

  const clearNodeSeekLoginState = useCallback(async () => {
    const trace = beginDiagnosticTrace('credential', 'clear', { source: 'nodeseek' });
    let ownedClearGeneration: number | undefined;
    let webViewCleanupStarted = false;
    try {
      const clear = replaceCredentialWrite(nodeSeekCredentialGateRef.current, async ({ isCurrent }) => {
        nodeSeekLoginRevokedRef.current = true;
        let revocationPersistenceError: unknown;
        try {
          await SecureStore.setItemAsync(NODESEEK_LOGIN_REVOCATION_STORAGE_KEY, '1');
        } catch (error) {
          revocationPersistenceError = error;
        }
        if (!isCurrent()) {
          return false;
        }
        webLoginDetectedRef.current = false;
        setWebLoginUserId(null);
        updateNodeSeekSession({ type: 'cleared' });
        await deleteNodeSeekAccessFromStore();
        if (!isCurrent()) {
          return false;
        }
        markDiagnosticStage(trace, 'persist', { source: 'nodeseek', store: 'secure-store', state: 'cleared' });
        webViewCleanupStarted = true;
        await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
        if (!isCurrent()) {
          return false;
        }
        markDiagnosticStage(trace, 'apply', { source: 'nodeseek', store: 'cookie-manager', state: 'cleared' });
        nodeSeekWebViewCookieHeaderRef.current = '';
        nodeSeekWebViewUserAgentRef.current = DEFAULT_NODESEEK_ANDROID_USER_AGENT;
        setNodeSeekWebViewUserAgent(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
        if (revocationPersistenceError) {
          throw revocationPersistenceError;
        }
        return true;
      });
      ownedClearGeneration = nodeSeekCredentialGateRef.current.generation;
      const cleared = await clear;
      if (!cleared
        && webViewCleanupStarted
        && !isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, ownedClearGeneration)) {
        await restoreSavedNodeSeekCookiesToWebView();
      }
      finishDiagnosticTrace(trace, cleared ? 'success' : 'stale', cleared ? {} : { reason: 'stale' });
      return cleared === true;
    } catch (error) {
      if (ownedClearGeneration !== undefined
        && !isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, ownedClearGeneration)) {
        if (webViewCleanupStarted) {
          await restoreSavedNodeSeekCookiesToWebView();
        }
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return false;
      }
      finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
      throw error;
    }
  }, [
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    restoreSavedNodeSeekCookiesToWebView,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    updateNodeSeekSession,
    webLoginDetectedRef
  ]);

  const currentNodeSeekCredentialGeneration = useCallback(() => nodeSeekCredentialGateRef.current.generation, []);
  const currentYaohuoCredentialGeneration = useCallback(() => yaohuoCredentialGateRef.current.generation, []);

  const clearNodeSeekLoginCookiesOnly = useCallback(async (options: CredentialClearOptions = {}) => {
    const trace = beginDiagnosticTrace('credential', 'clear-login-only', {
      source: 'nodeseek',
      ...(options.generation === undefined ? {} : { generation: options.generation })
    });
    const isRequestCurrent = options.isCurrent || (() => true);
    let ownedClearGeneration: number | undefined;
    let webViewCleanupStarted = false;
    try {
      const task = async ({ isCurrent }: { isCurrent: () => boolean }) => {
        const stillCurrent = () => isCurrent() && isRequestCurrent();
        if (!stillCurrent()) {
          return undefined;
        }
        webLoginDetectedRef.current = false;
        setWebLoginUserId(null);
        updateNodeSeekSession({ type: 'login-expired', message: 'NodeSeek 登录已失效' });
        nodeSeekLoginRevokedRef.current = true;
        let revocationPersistenceError: unknown;
        try {
          await SecureStore.setItemAsync(NODESEEK_LOGIN_REVOCATION_STORAGE_KEY, '1');
        } catch (error) {
          revocationPersistenceError = error;
        }
        if (!stillCurrent()) {
          return undefined;
        }
        const access = await readNodeSeekAccessFromStore();
        if (!stillCurrent()) {
          return undefined;
        }
        const accessCookies = parseNodeSeekDocumentCookie(access?.cookieHeader || '');
        const expectedCookieValues = cookieValuesForCleanup(accessCookies);
        const verificationCookies = removeNodeSeekLoginCookies(accessCookies);
        const verificationHeader = buildCookieHeader(verificationCookies);
        if (!canStoreNodeSeekCookieHeader(verificationCookies) || !verificationHeader) {
          await deleteNodeSeekAccessFromStore();
          if (!stillCurrent()) {
            return undefined;
          }
          webViewCleanupStarted = true;
          const clearedSnapshot = await clearCookieUrls(
            CookieManager,
            NODESEEK_COOKIE_URLS,
            Object.keys(expectedCookieValues),
            expectedCookieValues
          );
          if (!clearedSnapshot) {
            return undefined;
          }
          if (!stillCurrent()) {
            return undefined;
          }
          nodeSeekWebViewCookieHeaderRef.current = '';
          nodeSeekWebViewUserAgentRef.current = DEFAULT_NODESEEK_ANDROID_USER_AGENT;
          setNodeSeekWebViewUserAgent(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
          if (revocationPersistenceError) {
            throw revocationPersistenceError;
          }
          updateNodeSeekSession({ type: 'cleared' });
          markDiagnosticStage(trace, 'persist', { source: 'nodeseek', store: 'multi-store', state: 'cleared' });
          return { hasCredential: false };
        }
        await writeNodeSeekAccessToStore(verificationHeader, access?.userAgent || nodeSeekWebViewUserAgentRef.current || DEFAULT_NODESEEK_ANDROID_USER_AGENT, null);
        if (!stillCurrent()) {
          return undefined;
        }
        webViewCleanupStarted = true;
        const expectedLoginValues = Object.fromEntries(Object.entries(expectedCookieValues)
          .filter(([name]) => nodeSeekLoginCookieNames.includes(name as typeof nodeSeekLoginCookieNames[number])));
        const clearedSnapshot = await clearCookieUrls(
          CookieManager,
          NODESEEK_COOKIE_URLS,
          [...nodeSeekLoginCookieNames],
          expectedLoginValues
        );
        if (!clearedSnapshot) {
          return undefined;
        }
        if (!stillCurrent()) {
          return undefined;
        }
        nodeSeekWebViewCookieHeaderRef.current = verificationHeader;
        const summary = summarizeNodeSeekCookies(verificationCookies);
        if (revocationPersistenceError) {
          throw revocationPersistenceError;
        }
        updateNodeSeekSession({
          type: 'verification-succeeded',
          cookieSummary: summary.names,
          loggedIn: false,
          at: new Date().toISOString()
        });
        markDiagnosticStage(trace, 'persist', { source: 'nodeseek', store: 'multi-store', state: 'login-cleared' });
        return {
          hasCredential: true
        };
      };
      const conditionalClearCurrent = options.generation !== undefined
        && !options.force
        && isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, options.generation);
      const clear = options.generation !== undefined && !options.force
        ? replaceCredentialWriteForGeneration(nodeSeekCredentialGateRef.current, options.generation, task)
        : replaceCredentialWrite(nodeSeekCredentialGateRef.current, task);
      if (conditionalClearCurrent || options.generation === undefined || options.force) {
        ownedClearGeneration = nodeSeekCredentialGateRef.current.generation;
      }
      const result = await clear;
      if (!result) {
        if (webViewCleanupStarted
          && ownedClearGeneration !== undefined
          && !isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, ownedClearGeneration)) {
          await restoreSavedNodeSeekCookiesToWebView();
        }
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      finishDiagnosticTrace(trace, 'success', { hasCredential: result.hasCredential });
      return result;
    } catch (error) {
      if (ownedClearGeneration !== undefined
        && !isCredentialWriteCurrent(nodeSeekCredentialGateRef.current, ownedClearGeneration)) {
        if (webViewCleanupStarted) {
          await restoreSavedNodeSeekCookiesToWebView();
        }
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return;
      }
      finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
      throw error;
    }
  }, [
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    restoreSavedNodeSeekCookiesToWebView,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    updateNodeSeekSession,
    webLoginDetectedRef
  ]);

  return {
    clearNodeSeekLoginCookiesOnly,
    clearNodeSeekLoginState,
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
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    restoreSavedYaohuoCookiesToWebView,
    saveNodeSeekCookieHeader,
    saveYaohuoCookieHeader,
    siteSessionStates,
    siteSessionViewModels,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession
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
