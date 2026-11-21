import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { sanitizeWebViewUserAgent } from '@/platform/android/userAgent';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import {
  prepareRequestToSend,
  RequestCanceledError,
  withRequestBeforeSend,
  type Fetcher
} from '@/platform/network/request';
import {
  createNodeSeekWebViewFallbackFetcher,
  isNodeSeekRequestUrl,
  isNodeSeekBrowserRequestPair
} from '@/sources/nodeseek/browserFallback';
import {
  createLinuxDoWebViewFallbackFetcher,
  isLinuxDoRequestUrl,
  isLinuxDoBrowserRequestPair,
  LinuxDoHiddenBrowserFailureError,
  type LinuxDoHiddenBrowserFailureReason
} from '@/sources/linuxdo/browserFallback';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { browserFetchIntentFromInit, type BrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { clearManagedLoginCookies } from '@/platform/network/managedCookies';
import { recoverReadNetworkRuntime } from '@/platform/network/networkProxy';
import { LEGACY_COOKIE_SNAPSHOT_KEYS } from '@/platform/storage/legacyCookieSnapshotMigration';
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  isCredentialWriteCurrent,
  replaceCredentialWrite
} from '@/platform/storage/credentialWriteGate';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { appQueryClient } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ScopedSiteSessionEvent, SessionSite, SiteSessionEvent } from '@/domain/session/siteSessionState';
import {
  createBrowserFetchQueue,
  forumBrowserResponse,
  requestHeaderValue,
  type BrowserFetchQueueRequest
} from './browserFetchQueue';
import { forumSessionEpochsAfterSourceChange, resetForumSourceQueries } from './sessionQueryOwnership';

const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const LINUXDO_BROWSER_FETCH_TIMEOUT_MS = 15000;

export type NodeSeekBrowserFetchRequest = {
  id: number;
  url: string;
  userAgent?: string;
  owner?: BrowserFetchIntent['owner'];
};

export type LinuxDoBrowserFetchRequest = {
  id: number;
  url: string;
  userAgent?: string;
  owner?: BrowserFetchIntent['owner'];
};

type PendingBrowserFetchRequest = BrowserFetchQueueRequest & {
  diagnosticTrace: DiagnosticTrace;
  diagnosticOwnsTrace: boolean;
  resolve: (response: Response) => void;
  credentialGeneration: number;
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
  const reason = message.includes('前台读取替换')
    ? 'superseded'
    : message.includes('外部地址')
      ? 'unsupported'
      : message.includes('进程已停止')
        ? 'renderer_gone'
        : normalizeDiagnosticReason(error);
  const outcome =
    reason === 'canceled'
      ? 'canceled'
      : reason === 'stale' || reason === 'superseded'
        ? 'stale'
        : reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied'
          ? 'blocked'
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
  isChallenge: boolean
) {
  markDiagnosticStage(trace, 'parse', {
    source,
    channel: 'webview',
    status,
    contentLength,
    isChallenge
  });
  if (ownsTrace) {
    finishDiagnosticTrace(trace, isChallenge ? 'blocked' : status >= 400 ? 'failure' : 'success', {
      source,
      channel: 'webview',
      status,
      ...(isChallenge ? { reason: 'verification_required' } : status >= 400 ? { reason: 'http_error' } : {})
    });
  }
}

export function useSessionController({
  commitLinuxDoWebViewUserAgent,
  commitNodeSeekWebViewUserAgent,
  defaultFetcher,
  forumSessionEpochsRef,
  linuxDoBrowserWebViewRef,
  nodeSeekBrowserWebViewRef,
  nodeSeekRecoveryThreshold,
  notify,
  onSiteSessionEvent
}: {
  commitLinuxDoWebViewUserAgent: (userAgent: string) => void;
  commitNodeSeekWebViewUserAgent: (userAgent: string) => void;
  defaultFetcher: Fetcher;
  forumSessionEpochsRef: MutableRef<ForumSessionEpochs>;
  linuxDoBrowserWebViewRef: WebViewStopRef;
  nodeSeekBrowserWebViewRef: WebViewStopRef;
  nodeSeekRecoveryThreshold: number;
  notify: (message: string) => void;
  onSiteSessionEvent?: (event: ScopedSiteSessionEvent) => void;
}) {
  const nodeSeekBrowserFetchIdRef = useRef(0);
  const linuxDoBrowserFetchIdRef = useRef(0);
  const [nodeSeekBrowserFetchRequest, setNodeSeekBrowserFetchRequest] = useState<NodeSeekBrowserFetchRequest | null>(
    null
  );
  const [linuxDoBrowserFetchRequest, setLinuxDoBrowserFetchRequest] = useState<LinuxDoBrowserFetchRequest | null>(null);
  const nodeSeekCredentialGateRef = useRef(createCredentialWriteGate());
  const linuxDoCredentialGateRef = useRef(createCredentialWriteGate());
  const yaohuoCredentialGateRef = useRef(createCredentialWriteGate());
  const [forumSessionEpochs, setForumSessionEpochs] = useState(forumSessionEpochsRef.current);
  const browserLifetimeRef = useRef(new AbortController());
  const browserWebViewRefs = useCommittedRef({
    linuxDo: linuxDoBrowserWebViewRef,
    nodeSeek: nodeSeekBrowserWebViewRef
  });
  const createBrowserQueues = useCallback(
    () => ({
      nodeSeek: createBrowserFetchQueue<PendingBrowserFetchRequest>({
        canStart: (request) =>
          !browserLifetimeRef.current.signal.aborted &&
          request.credentialGeneration === nodeSeekCredentialGateRef.current.generation,
        onActiveRequest: setNodeSeekBrowserFetchRequest,
        onQueued: (request, queueLength) =>
          markDiagnosticStage(request.diagnosticTrace, 'guard', {
            source: 'nodeseek',
            channel: 'webview',
            state: 'queued',
            queueLength
          }),
        onStarted: (request, queueLength) =>
          markDiagnosticStage(request.diagnosticTrace, 'transport', {
            source: 'nodeseek',
            channel: 'webview',
            state: 'active',
            queueLength
          }),
        stopLoading: () => browserWebViewRefs.current.nodeSeek.current?.stopLoading(),
        timeoutMs: NODESEEK_BROWSER_FETCH_TIMEOUT_MS,
        timeoutMessage: 'NodeSeek 页面读取超时'
      }),
      linuxDo: createBrowserFetchQueue<PendingBrowserFetchRequest>({
        canStart: (request) =>
          !browserLifetimeRef.current.signal.aborted &&
          request.credentialGeneration === linuxDoCredentialGateRef.current.generation,
        onActiveRequest: setLinuxDoBrowserFetchRequest,
        onQueued: (request, queueLength) =>
          markDiagnosticStage(request.diagnosticTrace, 'guard', {
            source: 'linuxdo',
            channel: 'webview',
            state: 'queued',
            queueLength
          }),
        onStarted: (request, queueLength) =>
          markDiagnosticStage(request.diagnosticTrace, 'transport', {
            source: 'linuxdo',
            channel: 'webview',
            state: 'active',
            queueLength
          }),
        stopLoading: () => browserWebViewRefs.current.linuxDo.current?.stopLoading(),
        timeoutMs: LINUXDO_BROWSER_FETCH_TIMEOUT_MS,
        timeoutMessage: 'linux.do 页面读取超时'
      })
    }),
    [browserWebViewRefs]
  );
  const [browserQueuesRef] = useState(() => ({ current: createBrowserQueues() }));
  useEffect(() => {
    if (browserLifetimeRef.current.signal.aborted) {
      browserLifetimeRef.current = new AbortController();
      browserQueuesRef.current = createBrowserQueues();
      setNodeSeekBrowserFetchRequest(null);
      setLinuxDoBrowserFetchRequest(null);
    }
    const lifetime = browserLifetimeRef.current;
    const queues = browserQueuesRef.current;
    return () => {
      lifetime.abort();
      const failures: unknown[] = [];
      try {
        queues.nodeSeek.dispose();
      } catch (error) {
        failures.push(error);
      }
      try {
        queues.linuxDo.dispose();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, '隐藏浏览器请求清理失败');
    };
  }, [browserWebViewRefs, createBrowserQueues]);
  const ownBrowserFetch = useCallback(
    (fetcher: Fetcher): Fetcher =>
      (input, init) => {
        const lifetime = browserLifetimeRef.current.signal;
        return withRequestBeforeSend(fetcher, () => {
          if (lifetime.aborted) throw new RequestCanceledError();
        })(input, init);
      },
    []
  );

  const commitAccountStatusChange = useCallback((site: SessionSite) => {
    resetForumSourceQueries(site, appQueryClient);
    const nextScope = forumSessionEpochsAfterSourceChange(forumSessionEpochsRef.current, site);
    forumSessionEpochsRef.current = nextScope;
    setForumSessionEpochs(nextScope);
  }, []);

  const dispatchSiteSessionEvent = useCallback(
    (event: ScopedSiteSessionEvent) => {
      const trace = beginDiagnosticTrace('session', 'state-transition', {
        source: event.site,
        eventType: event.type
      });
      onSiteSessionEvent?.(event);
      markDiagnosticStage(trace, 'apply', {
        source: event.site,
        eventType: event.type,
        state: 'published'
      });
      finishDiagnosticTrace(trace, 'success', { source: event.site, state: 'published' });
    },
    [onSiteSessionEvent]
  );

  const updateNodeSeekSession = useCallback(
    (event: SiteSessionEvent) => {
      dispatchSiteSessionEvent({ ...event, site: 'nodeseek' });
    },
    [dispatchSiteSessionEvent]
  );

  const updateLinuxDoSession = useCallback(
    (event: SiteSessionEvent) => {
      dispatchSiteSessionEvent({ ...event, site: 'linuxdo' });
    },
    [dispatchSiteSessionEvent]
  );

  const updateYaohuoSession = useCallback(
    (event: SiteSessionEvent) => {
      dispatchSiteSessionEvent({ ...event, site: 'yaohuo' });
    },
    [dispatchSiteSessionEvent]
  );

  const nodeSeekFetchWithWebView: Fetcher = useCallback(
    async (input, init) => {
      const url = String(input);
      if (!isNodeSeekRequestUrl(url)) {
        return defaultFetcher(input, init);
      }
      const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
      return new Promise<Response>((resolve, reject) => {
        const id = ++nodeSeekBrowserFetchIdRef.current;
        const browserFetchIntent = browserFetchIntentFromInit(init);
        const inheritedTrace = diagnosticTraceForRequest(init);
        const diagnosticTrace =
          inheritedTrace ||
          beginDiagnosticTrace('webview', 'browser-fetch', {
            source: 'nodeseek',
            channel: 'webview',
            ...diagnosticBrowserIntent(browserFetchIntent)
          });
        const request: PendingBrowserFetchRequest = {
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
          beforeSend: () => {
            prepareRequestToSend(init);
          },
          abortSignal: init?.signal || undefined
        };
        browserQueuesRef.current.nodeSeek.enqueue(request);
      });
    },
    [defaultFetcher]
  );

  const completeNodeSeekBrowserFetch = useCallback(
    async (data: {
      id?: number;
      url?: string;
      html?: string;
      userAgent?: string;
      challenge?: boolean;
      error?: string;
      httpErrorStatus?: number;
    }) => {
      browserQueuesRef.current.nodeSeek.complete(data.id, (current) => {
        if (!data.url || !isNodeSeekBrowserRequestPair(data.url, current.url))
          throw new Error('NodeSeek 页面跳转到外部地址，已停止读取');
        if (current.credentialGeneration !== nodeSeekCredentialGateRef.current.generation)
          throw new Error('请求已取消');
        if (data.error) throw new Error(data.error);
        const userAgent = sanitizeWebViewUserAgent(data.userAgent);
        if (userAgent) commitNodeSeekWebViewUserAgent(userAgent);
        const challenge = Boolean(data.challenge);
        const status = challenge ? 403 : data.httpErrorStatus || current.httpErrorStatus || 200;
        finishBrowserFetchSuccess(
          current.diagnosticTrace,
          current.diagnosticOwnsTrace,
          'nodeseek',
          status,
          (data.html || '').length,
          challenge
        );
        current.resolve(
          forumBrowserResponse(data.html || '', challenge, data.httpErrorStatus || current.httpErrorStatus, data.url)
        );
      });
    },
    [commitNodeSeekWebViewUserAgent]
  );

  const failNodeSeekBrowserFetchById = useCallback(
    (requestId: number, message: string, options: { skipStopLoading?: boolean } = {}) => {
      browserQueuesRef.current.nodeSeek.cancel(requestId, message, options);
    },
    []
  );

  const markNodeSeekBrowserFetchHttpError = useCallback((requestId: number, statusCode?: number) => {
    browserQueuesRef.current.nodeSeek.markHttpError(requestId, statusCode);
  }, []);

  const cancelLinuxDoBrowserHandoff = useCallback(() => {
    advanceCredentialWriteGeneration(linuxDoCredentialGateRef.current);
    const queue = browserQueuesRef.current.linuxDo;
    if (queue.active) queue.cancel(queue.active.id, '账号页面交接，请求已取消');
  }, []);

  const linuxDoFetchWithWebView: Fetcher = useCallback(
    async (input, init) => {
      const url = String(input);
      if (!isLinuxDoRequestUrl(url)) {
        return defaultFetcher(input, init);
      }
      return new Promise<Response>((resolve, reject) => {
        const id = ++linuxDoBrowserFetchIdRef.current;
        const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
        const browserFetchIntent = browserFetchIntentFromInit(init);
        const inheritedTrace = diagnosticTraceForRequest(init);
        const diagnosticTrace =
          inheritedTrace ||
          beginDiagnosticTrace('webview', 'browser-fetch', {
            source: 'linuxdo',
            channel: 'webview',
            ...diagnosticBrowserIntent(browserFetchIntent)
          });
        const request: PendingBrowserFetchRequest = {
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
          beforeSend: () => {
            prepareRequestToSend(init);
          },
          abortSignal: init?.signal || undefined
        };
        browserQueuesRef.current.linuxDo.enqueue(request);
      });
    },
    [defaultFetcher]
  );

  const nodeSeekFetchWithWebViewFallback = useMemo(
    () =>
      ownBrowserFetch(
        createNodeSeekWebViewFallbackFetcher({
          defaultFetcher,
          recoveryThreshold: nodeSeekRecoveryThreshold,
          recoverReadChannel: (expectedGeneration, trace) =>
            recoverReadNetworkRuntime('nodeseek', expectedGeneration, { trace }),
          webViewFetcher: ownBrowserFetch(nodeSeekFetchWithWebView)
        })
      ),
    [defaultFetcher, nodeSeekFetchWithWebView, nodeSeekRecoveryThreshold, ownBrowserFetch]
  );

  const forumFetchWithWebViewFallback = useMemo(
    () =>
      ownBrowserFetch(
        createLinuxDoWebViewFallbackFetcher({
          defaultFetcher: nodeSeekFetchWithWebViewFallback,
          recoverReadChannel: (expectedGeneration, trace) =>
            recoverReadNetworkRuntime('linuxdo', expectedGeneration, { trace }),
          webViewFetcher: ownBrowserFetch(linuxDoFetchWithWebView)
        })
      ),
    [linuxDoFetchWithWebView, nodeSeekFetchWithWebViewFallback, ownBrowserFetch]
  );

  const completeLinuxDoBrowserFetch = useCallback(
    async (data: {
      id?: number;
      url?: string;
      body?: string;
      userAgent?: string;
      challenge?: boolean;
      error?: string;
      failureReason?: LinuxDoHiddenBrowserFailureReason;
    }) => {
      browserQueuesRef.current.linuxDo.complete(data.id, (current) => {
        if (!data.url || !isLinuxDoBrowserRequestPair(data.url, current.url))
          throw new Error('linux.do 页面跳转到外部地址，已停止读取');
        if (current.credentialGeneration !== linuxDoCredentialGateRef.current.generation) throw new Error('请求已取消');
        if (data.error)
          throw data.failureReason
            ? new LinuxDoHiddenBrowserFailureError(data.failureReason, data.error)
            : new Error(data.error);
        const userAgent = sanitizeWebViewUserAgent(data.userAgent);
        if (isLinuxDoRequestUrl(data.url) && userAgent) commitLinuxDoWebViewUserAgent(userAgent);
        const challenge = Boolean(data.challenge);
        const status = current.httpErrorStatus || (challenge ? 403 : 200);
        finishBrowserFetchSuccess(
          current.diagnosticTrace,
          current.diagnosticOwnsTrace,
          'linuxdo',
          status,
          (data.body || '').length,
          challenge
        );
        if (challenge) current.reject(new LinuxDoCloudflareError());
        else current.resolve(forumBrowserResponse(data.body || '', false, current.httpErrorStatus, data.url));
      });
    },
    [commitLinuxDoWebViewUserAgent]
  );

  const failLinuxDoBrowserFetchById = useCallback(
    (requestId: number, message: string, options: { skipStopLoading?: boolean } = {}) => {
      browserQueuesRef.current.linuxDo.cancel(requestId, message, options);
    },
    []
  );

  const markLinuxDoBrowserFetchHttpError = useCallback((requestId: number, statusCode?: number) => {
    browserQueuesRef.current.linuxDo.markHttpError(requestId, statusCode);
  }, []);

  const clearManagedLoginState = useCallback(
    async (source: 'linuxdo' | 'nodeseek' | 'yaohuo', isAccountCurrent: () => boolean = () => true) => {
      const trace = beginDiagnosticTrace('credential', 'clear', { source });
      const gate =
        source === 'nodeseek'
          ? nodeSeekCredentialGateRef.current
          : source === 'linuxdo'
            ? linuxDoCredentialGateRef.current
            : yaohuoCredentialGateRef.current;
      const sessionEpoch = forumSessionEpochsRef.current[source];
      const generation = gate.generation + 1;
      const isCurrent = () =>
        isCredentialWriteCurrent(gate, generation) &&
        forumSessionEpochsRef.current[source] === sessionEpoch &&
        isAccountCurrent();
      try {
        if (!isAccountCurrent()) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
          return false;
        }
        const cleared = await replaceCredentialWrite(gate, async () => {
          if (!isCurrent()) return false;
          await clearManagedLoginCookies(source, undefined, trace);
          return isCurrent();
        });
        if (!cleared || !isCurrent()) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
          return false;
        }
        const legacyKeys =
          source === 'nodeseek'
            ? LEGACY_COOKIE_SNAPSHOT_KEYS.slice(0, 2)
            : source === 'linuxdo'
              ? LEGACY_COOKIE_SNAPSHOT_KEYS.slice(2, 3)
              : LEGACY_COOKIE_SNAPSHOT_KEYS.slice(3);
        const cleanup = await Promise.allSettled(legacyKeys.map((key) => SecureStore.deleteItemAsync(key)));
        if (!isCurrent()) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
          return false;
        }
        const legacyCleanupFailed = cleanup.some((result) => result.status === 'rejected');
        const event: SiteSessionEvent = { type: 'cleared' };
        dispatchSiteSessionEvent({ ...event, site: source });
        finishDiagnosticTrace(trace, legacyCleanupFailed ? 'partial' : 'success', {
          source,
          ...(legacyCleanupFailed ? { reason: 'storage_error' } : {})
        });
        if (legacyCleanupFailed) {
          notify('登录 Cookie 已清除，但旧版本机快照清理未完成。');
        }
        return true;
      } catch (error) {
        if (!isCurrent()) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
          return false;
        }
        const message = `${source === 'nodeseek' ? 'NodeSeek' : source === 'linuxdo' ? 'linux.do' : '妖火'} 登录清理未完成，请重试。`;
        dispatchSiteSessionEvent({ type: 'check-failed', message, site: source });
        finishDiagnosticTrace(trace, 'failure', {
          source,
          reason: normalizeDiagnosticReason(error)
        });
        throw error;
      }
    },
    [dispatchSiteSessionEvent, forumSessionEpochsRef, notify]
  );

  const clearNodeSeekLoginState = useCallback(
    (isCurrent?: () => boolean) => clearManagedLoginState('nodeseek', isCurrent),
    [clearManagedLoginState]
  );
  const clearLinuxDoLoginState = useCallback(
    (isCurrent?: () => boolean) => clearManagedLoginState('linuxdo', isCurrent),
    [clearManagedLoginState]
  );
  const clearYaohuoLoginState = useCallback(
    (isCurrent?: () => boolean) => clearManagedLoginState('yaohuo', isCurrent),
    [clearManagedLoginState]
  );

  return {
    cancelLinuxDoBrowserHandoff,
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
    nodeSeekFetchWithWebViewFallback,
    forumSessionEpochs,
    hiddenBrowserFetchRequests: {
      linuxDo: linuxDoBrowserFetchRequest,
      nodeSeek: nodeSeekBrowserFetchRequest
    },
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession
  };
}
