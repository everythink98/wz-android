import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  NODESEEK_USER_AGENT_STORAGE_KEY,
  sanitizeNodeSeekUserAgent
} from '../nodeseekSession';
import {
  sanitizeLinuxDoUserAgent,
  LINUXDO_USER_AGENT_STORAGE_KEY
} from '../linuxdoSession';
import { useCommitRefValue } from './useCommittedRef';
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
import { clearManagedLoginCookies } from '../managedCookies';
import {
  LEGACY_COOKIE_SNAPSHOT_KEYS,
  migrateLegacyCookieSnapshots
} from '../legacyCookieSnapshotMigration';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '../diagnostics';
import { appQueryClient, initialForumSessionEpochs } from './serverState';
import {
  createSiteSessionViewModels,
  createSiteSessionStates,
  reduceSiteSessionState,
  type ScopedSiteSessionEvent,
  type SessionSite,
  type SiteSessionEvent
} from '../siteSessionState';
import {
  commitChangedAccountStatusQuery,
  createCredentialWriteGate,
  enqueueBrowserFetchRequest,
  forumSessionEpochsAfterSourceChange,
  replaceCredentialWrite,
  resetForumSourceQueries,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  rejectBrowserFetchRequest,
  requestHeaderValue,
  settleBrowserFetchRequestOnce,
  siteSessionEventInvalidatesForumQueries,
  startNextBrowserFetchRequest,
  type CredentialClearOptions
} from './sessionControllerHelpers';

const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const LINUXDO_BROWSER_FETCH_TIMEOUT_MS = 15000;

export type NodeSeekBrowserFetchRequest = {
  id: number;
  url: string;
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
  linuxDoWebViewUserAgentRef,
  nodeSeekBrowserWebViewRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  setLinuxDoWebViewUserAgent,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  webLoginDetectedRef
}: {
  defaultFetcher?: Fetcher;
  linuxDoBrowserWebViewRef: WebViewStopRef;
  linuxDoWebViewUserAgentRef: MutableRef<string>;
  nodeSeekBrowserWebViewRef: WebViewStopRef;
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
  const linuxDoCredentialGateRef = useRef(createCredentialWriteGate());
  const yaohuoCredentialGateRef = useRef(createCredentialWriteGate());
  const [siteSessionStates, setSiteSessionStates] = useState(() => createSiteSessionStates());
  const [forumSessionEpochs, setForumSessionEpochs] = useState(initialForumSessionEpochs);
  const forumSessionEpochsRef = useRef(initialForumSessionEpochs);
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
      const nextScope = forumSessionEpochsAfterSourceChange(forumSessionEpochsRef.current, site);
      forumSessionEpochsRef.current = nextScope;
      setForumSessionEpochs(nextScope);
    }
  }, []);

  const commitAccountStatusChange = useCallback((site: SessionSite, recoveryQueryKey: readonly unknown[]) => {
    const nextScope = commitChangedAccountStatusQuery(
      site,
      forumSessionEpochsRef.current,
      recoveryQueryKey,
      appQueryClient
    );
    forumSessionEpochsRef.current = nextScope;
    setForumSessionEpochs(nextScope);
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

  useEffect(() => {
    const trace = beginDiagnosticTrace('credential', 'migrate-cookie-snapshots');
    void (async () => {
      const migration = await migrateLegacyCookieSnapshots();
      const [nodeSeekUserAgent, linuxDoUserAgent] = await Promise.all([
        SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY),
        SecureStore.getItemAsync(LINUXDO_USER_AGENT_STORAGE_KEY)
      ]);
      const cleanNodeSeekUserAgent = sanitizeNodeSeekUserAgent(nodeSeekUserAgent || '');
      if (cleanNodeSeekUserAgent) {
        nodeSeekWebViewUserAgentRef.current = cleanNodeSeekUserAgent;
        setNodeSeekWebViewUserAgent(cleanNodeSeekUserAgent);
      }
      const cleanLinuxDoUserAgent = sanitizeLinuxDoUserAgent(linuxDoUserAgent || '');
      if (cleanLinuxDoUserAgent) {
        linuxDoWebViewUserAgentRef.current = cleanLinuxDoUserAgent;
        setLinuxDoWebViewUserAgent(cleanLinuxDoUserAgent);
      }
      finishDiagnosticTrace(trace, 'success', {
        migratedCount: Object.values(migration).filter((status) => status === 'migrated').length
      });
    })()
      .catch((error) => {
        finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
        notify(`旧登录快照迁移失败：${errorMessage(error)}`);
      });
  }, [
    linuxDoWebViewUserAgentRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    setLinuxDoWebViewUserAgent,
    setNodeSeekWebViewUserAgent
  ]);

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
      void SecureStore.setItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY, userAgent).catch(() => undefined);
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
        false,
        challenge
      );
      current.resolve(nodeSeekBrowserResponse(data.html || '', Boolean(data.challenge), data.httpErrorStatus || current.httpErrorStatus));
    });
    if (!settled) {
      return;
    }
    startNextNodeSeekBrowserFetch();
  }, [
    nodeSeekBrowserFetchCurrentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewUserAgentRef,
    rejectNodeSeekBrowserFetch,
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
        || request.credentialGeneration === linuxDoCredentialGateRef.current.generation,
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
    return new Promise<Response>((resolve, reject) => {
      let request: PendingLinuxDoBrowserFetchRequest;
      const id = ++linuxDoBrowserFetchIdRef.current;
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
        userAgent,
        diagnosticTrace,
        diagnosticOwnsTrace: !inheritedTrace,
        resolve,
        reject: (error) => {
          finishBrowserFetchFailure(diagnosticTrace, !inheritedTrace, 'linuxdo', error);
          reject(error);
        },
        credentialGeneration: linuxDoCredentialGateRef.current.generation,
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

  const completeLinuxDoBrowserFetch = useCallback(async (data: {
    id?: number;
    url?: string;
    body?: string;
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
    const credentialGeneration = current.credentialGeneration ?? linuxDoCredentialGateRef.current.generation;
    const credentialIsCurrent = credentialGeneration === linuxDoCredentialGateRef.current.generation;
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
      void SecureStore.setItemAsync(LINUXDO_USER_AGENT_STORAGE_KEY, userAgent).catch(() => undefined);
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
        false,
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
  }, [
    linuxDoBrowserFetchCurrentRef,
    linuxDoBrowserWebViewRef,
    linuxDoWebViewUserAgentRef,
    rejectLinuxDoBrowserFetch,
    setLinuxDoBrowserFetchRequest,
    setLinuxDoWebViewUserAgent,
    startNextLinuxDoBrowserFetch
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

  const clearManagedLoginState = useCallback(async (
    source: 'linuxdo' | 'nodeseek' | 'yaohuo',
    options: CredentialClearOptions = {}
  ) => {
    const trace = beginDiagnosticTrace('credential', 'clear', { source });
    const gate = source === 'nodeseek'
      ? nodeSeekCredentialGateRef.current
      : source === 'linuxdo'
        ? linuxDoCredentialGateRef.current
        : yaohuoCredentialGateRef.current;
    try {
      const cleared = await replaceCredentialWrite(gate, async ({ isCurrent }) => {
        await clearManagedLoginCookies(source);
        return isCurrent();
      });
      if (!cleared) {
        finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
        return false;
      }
      const legacyKeys = source === 'nodeseek'
        ? LEGACY_COOKIE_SNAPSHOT_KEYS.slice(0, 2)
        : source === 'linuxdo'
          ? LEGACY_COOKIE_SNAPSHOT_KEYS.slice(2, 3)
          : LEGACY_COOKIE_SNAPSHOT_KEYS.slice(3);
      const cleanup = await Promise.allSettled(
        legacyKeys.map((key) => SecureStore.deleteItemAsync(key))
      );
      const legacyCleanupFailed = cleanup.some((result) => result.status === 'rejected');
      const event: SiteSessionEvent = options.expiredMessage?.trim()
        ? {
          type: 'login-expired',
          message: options.expiredMessage.trim(),
          ...(options.recoveryQueryKey ? { recoveryQueryKey: options.recoveryQueryKey } : {})
        }
        : { type: 'cleared' };
      if (source === 'nodeseek') {
        webLoginDetectedRef.current = false;
        setWebLoginUserId(null);
        updateNodeSeekSession(event);
      } else if (source === 'linuxdo') {
        updateLinuxDoSession(event);
      } else {
        updateYaohuoSession(event);
      }
      finishDiagnosticTrace(trace, legacyCleanupFailed ? 'partial' : 'success', {
        source,
        ...(legacyCleanupFailed ? { reason: 'storage_error' } : {})
      });
      if (legacyCleanupFailed) {
        notify('登录 Cookie 已清除，但旧版本机快照清理未完成。');
      }
      return true;
    } catch (error) {
      const message = `${source === 'nodeseek' ? 'NodeSeek' : source === 'linuxdo' ? 'linux.do' : '妖火'} 登录清理未完成，请重试。`;
      if (source === 'nodeseek') {
        updateNodeSeekSession({ type: 'check-failed', message });
      } else if (source === 'linuxdo') {
        updateLinuxDoSession({ type: 'check-failed', message });
      } else {
        updateYaohuoSession({ type: 'check-failed', message });
      }
      finishDiagnosticTrace(trace, 'failure', {
        source,
        reason: normalizeDiagnosticReason(error)
      });
      throw error;
    }
  }, [
    notify,
    setWebLoginUserId,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession,
    webLoginDetectedRef
  ]);

  const clearNodeSeekLoginState = useCallback(
    (options?: CredentialClearOptions) => clearManagedLoginState('nodeseek', options),
    [clearManagedLoginState]
  );
  const clearLinuxDoLoginState = useCallback(
    (options?: CredentialClearOptions) => clearManagedLoginState('linuxdo', options),
    [clearManagedLoginState]
  );
  const clearYaohuoLoginState = useCallback(
    (options?: CredentialClearOptions) => clearManagedLoginState('yaohuo', options),
    [clearManagedLoginState]
  );

  return {
    clearNodeSeekLoginState,
    clearLinuxDoLoginState,
    clearYaohuoLoginState,
    commitAccountStatusChange,
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    dispatchSiteSessionEvent,
    forumFetchWithWebViewFallback,
    forumSessionEpochs,
    hiddenBrowserFetchRequests: {
      linuxDo: linuxDoBrowserFetchRequest,
      nodeSeek: nodeSeekBrowserFetchRequest
    },
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    siteSessionStates,
    siteSessionViewModels,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession
  };
}
