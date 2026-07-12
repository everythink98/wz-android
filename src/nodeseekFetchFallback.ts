import type { Fetcher } from './request';
import { isGoogleSiteSearchUrl } from './googleSearchFallback';
import { isNodeSeekChallengeResponse } from './localNodeseekHelpers';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  registerDiagnosticContextFetcher,
  type DiagnosticReason,
  type DiagnosticTrace
} from './diagnostics';

const NODESEEK_DIRECT_FETCH_TIMEOUT_MS = 8000;
const NODESEEK_DIRECT_RECOVERY_FAILURES = 2;
const NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE = 'NodeSeek direct fetch timeout';
type NodeSeekDirectTimeoutTrigger = 'app-resume' | 'timer';
type NodeSeekAppStateStatus = 'active' | 'background' | 'extension' | 'inactive' | 'unknown';
type NodeSeekAppState = {
  currentState: NodeSeekAppStateStatus | null;
  addEventListener: (event: 'change', listener: (state: NodeSeekAppStateStatus) => void) => { remove: () => void };
};

export type NodeSeekDirectFallbackReason = 'direct-timeout' | 'direct-error';
export type NodeSeekDirectRecoveryEvent = {
  parentTraceId?: string;
  reason: NodeSeekDirectFallbackReason;
  url: string;
};

export function isNodeSeekRequestUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (host === 'nodeseek.com' || host.endsWith('.nodeseek.com'));
  } catch {
    return false;
  }
}

function isNodeSeekGoogleSearchUrl(input: string) {
  return isGoogleSiteSearchUrl(input, 'nodeseek.com');
}

export function isNodeSeekBrowserFetchUrl(input: string) {
  return isNodeSeekRequestUrl(input) || isNodeSeekGoogleSearchUrl(input);
}

function observeNodeSeekRequestAppState(
  appState: NodeSeekAppState | undefined,
  trace: DiagnosticTrace | undefined,
  initialChannel: 'direct' | 'native' | 'webview'
) {
  let channel = initialChannel;
  let previousState: NodeSeekAppStateStatus = appState?.currentState || 'unknown';
  const startedAt = Date.now();
  const subscription = appState && trace ? appState.addEventListener('change', (nextState) => {
    markDiagnosticStage(trace, 'guard', {
      source: 'nodeseek',
      channel,
      previousState,
      nextState,
      ...(channel === 'direct' ? { timeoutMs: NODESEEK_DIRECT_FETCH_TIMEOUT_MS } : {}),
      transportDurationMs: Math.max(0, Date.now() - startedAt)
    });
    previousState = nextState;
  }) : undefined;
  let holdCount = 0;
  const retain = () => {
    if (!subscription) {
      return () => undefined;
    }
    holdCount += 1;
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      holdCount -= 1;
      if (holdCount === 0) {
        subscription.remove();
      }
    };
  };
  return {
    release: retain(),
    retain,
    setChannel: (nextChannel: 'direct' | 'native' | 'webview') => { channel = nextChannel; }
  };
}

async function fetchNodeSeekDirectly(defaultFetcher: Fetcher, input: string, init?: RequestInit, appState?: NodeSeekAppState) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + NODESEEK_DIRECT_FETCH_TIMEOUT_MS;
  const trace = diagnosticTraceForRequest(init);
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort();
  let appStateSubscription: { remove: () => void } | undefined;
  let previousAppState: NodeSeekAppStateStatus = appState?.currentState || 'unknown';
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutExpired = false;
  let rejectTimeout: ((error: Error) => void) | undefined;
  let timeoutPromise: Promise<never> | undefined;

  const transportDurationMs = () => Math.max(0, Date.now() - startedAt);
  const expire = (trigger: NodeSeekDirectTimeoutTrigger) => {
    if (timeoutExpired) {
      return;
    }
    timeoutExpired = true;
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'nodeseek',
        channel: 'direct',
        state: 'timeout',
        reason: 'timeout',
        trigger,
        timeoutMs: NODESEEK_DIRECT_FETCH_TIMEOUT_MS,
        transportDurationMs: transportDurationMs()
      });
    }
    rejectTimeout?.(new Error(NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE));
    controller.abort();
  };
  const scheduleTimeout = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      expire('app-resume');
      return;
    }
    timeout = setTimeout(() => expire('timer'), remainingMs);
  };

  if (trace) {
    markDiagnosticStage(trace, 'transport', {
      source: 'nodeseek',
      channel: 'direct',
      state: 'start',
      timeoutMs: NODESEEK_DIRECT_FETCH_TIMEOUT_MS
    });
  }
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
      if (!appState || previousAppState === 'active' || previousAppState === 'unknown') {
        scheduleTimeout();
      }
    });
    appStateSubscription = appState?.addEventListener('change', (next) => {
      previousAppState = next;
      if (next !== 'active') {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        return;
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(scheduleTimeout, 0);
    });
  }
  try {
    const fetchPromise = defaultFetcher(input, { ...init, signal: controller.signal });
    const response = await (timeoutPromise ? Promise.race([fetchPromise, timeoutPromise]) : fetchPromise);
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source: 'nodeseek',
        channel: 'direct',
        state: 'finish',
        status: response.status,
        transportDurationMs: transportDurationMs()
      });
    }
    return response;
  } catch (error) {
    if (trace && !timeoutExpired) {
      markDiagnosticStage(trace, 'transport', {
        source: 'nodeseek',
        channel: 'direct',
        state: 'failure',
        reason: normalizeDiagnosticReason(error),
        transportDurationMs: transportDurationMs()
      });
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    appStateSubscription?.remove();
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function fetchNodeSeekThroughWebView(
  webViewFetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  reason: DiagnosticReason,
  directStatus?: number
) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace = inheritedTrace || beginDiagnosticTrace('source', 'transport-fallback', {
    source: 'nodeseek',
    reason
  });
  markDiagnosticStage(trace, 'transport', {
    source: 'nodeseek',
    channel: 'direct',
    state: 'fallback',
    reason,
    ...(directStatus === undefined ? {} : { status: directStatus })
  });
  try {
    const response = await webViewFetcher(url, init);
    markDiagnosticStage(trace, 'transport', {
      source: 'nodeseek',
      channel: 'webview',
      state: 'finish',
      status: response.status
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, response.ok ? 'success' : 'failure', {
        source: 'nodeseek',
        channel: 'webview',
        ...(response.ok ? {} : { reason: 'http_error' })
      });
    }
    return response;
  } catch (error) {
    const fallbackReason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', {
      source: 'nodeseek',
      channel: 'webview',
      state: 'failure',
      reason: fallbackReason
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, fallbackReason === 'canceled' ? 'canceled' : fallbackReason === 'superseded' ? 'stale' : 'failure', {
        source: 'nodeseek',
        channel: 'webview',
        reason: fallbackReason
      });
    }
    throw error;
  }
}

async function fetchNodeSeekWebViewOnly(webViewFetcher: Fetcher, url: string, init?: RequestInit) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace = inheritedTrace || beginDiagnosticTrace('source', 'webview-transport', {
    source: 'nodeseek',
    channel: 'webview'
  });
  markDiagnosticStage(trace, 'transport', { source: 'nodeseek', channel: 'webview', state: 'start' });
  try {
    const response = await webViewFetcher(url, init);
    markDiagnosticStage(trace, 'transport', {
      source: 'nodeseek',
      channel: 'webview',
      state: 'finish',
      status: response.status
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, response.ok ? 'success' : 'failure', {
        source: 'nodeseek',
        channel: 'webview',
        ...(response.ok ? {} : { reason: 'http_error' })
      });
    }
    return response;
  } catch (error) {
    const reason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', { source: 'nodeseek', channel: 'webview', state: 'failure', reason });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : reason === 'superseded' ? 'stale' : 'failure', {
        source: 'nodeseek',
        channel: 'webview',
        reason
      });
    }
    throw error;
  }
}

export function createNodeSeekWebViewFallbackFetcher({
  appState,
  defaultFetcher = fetch,
  webViewFetcher,
  recoverNodeSeekNetwork
}: {
  appState?: NodeSeekAppState;
  defaultFetcher?: Fetcher;
  webViewFetcher: Fetcher;
  recoverNodeSeekNetwork?: (event: NodeSeekDirectRecoveryEvent) => Promise<unknown> | unknown;
}): Fetcher {
  let directFailureCount = 0;
  let directSuccessGeneration = 0;
  let recoveryInFlight = false;

  const resetDirectFailures = () => {
    directFailureCount = 0;
    directSuccessGeneration += 1;
  };

  const scheduleRecovery = (event: NodeSeekDirectRecoveryEvent) => {
    if (!recoverNodeSeekNetwork || recoveryInFlight) {
      return undefined;
    }
    recoveryInFlight = true;
    const recovery = Promise.resolve()
      .then(() => recoverNodeSeekNetwork(event))
      .catch(() => undefined)
      .finally(() => {
        recoveryInFlight = false;
      });
    void recovery;
    return recovery;
  };

  const recordDirectFallbackSuccess = async (
    response: Response,
    reason: NodeSeekDirectFallbackReason,
    url: string,
    init: RequestInit | undefined,
    failureGeneration: number,
    lifecycle: ReturnType<typeof observeNodeSeekRequestAppState>
  ) => {
    const text = await response.clone().text();
    if (isNodeSeekChallengeResponse(response, text, url)) {
      return response;
    }
    if (failureGeneration !== directSuccessGeneration) {
      return response;
    }
    directFailureCount += 1;
    if (directFailureCount >= NODESEEK_DIRECT_RECOVERY_FAILURES) {
      directFailureCount = 0;
      const trace = diagnosticTraceForRequest(init);
      directSuccessGeneration += 1;
      const recovery = scheduleRecovery({
        reason,
        url,
        ...(trace ? { parentTraceId: trace.traceId } : {})
      });
      if (recovery && trace) {
        markDiagnosticStage(trace, 'transport', {
          source: 'nodeseek',
          channel: 'direct',
          state: 'recovery-mode',
          attempt: NODESEEK_DIRECT_RECOVERY_FAILURES,
          reason: reason === 'direct-timeout' ? 'timeout' : 'network_error'
        });
      }
      if (recovery) {
        lifecycle.setChannel('native');
        const releaseRecovery = lifecycle.retain();
        void recovery.finally(releaseRecovery);
      }
    }
    return response;
  };

  return registerDiagnosticContextFetcher(async (input, init) => {
    const url = String(input);
    if (isNodeSeekGoogleSearchUrl(url)) {
      const lifecycle = observeNodeSeekRequestAppState(appState, diagnosticTraceForRequest(init), 'webview');
      try {
        return await fetchNodeSeekWebViewOnly(webViewFetcher, url, init);
      } finally {
        lifecycle.release();
      }
    }
    if (!isNodeSeekRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    const lifecycle = observeNodeSeekRequestAppState(appState, diagnosticTraceForRequest(init), 'direct');
    try {
      let response: Response;
      try {
        response = await fetchNodeSeekDirectly(defaultFetcher, url, init, appState);
      } catch (error) {
        if (!init?.signal?.aborted) {
          const failureGeneration = directSuccessGeneration;
          const reason = error instanceof Error && error.message === NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE
            ? 'direct-timeout'
            : 'direct-error';
          const diagnosticReason = normalizeDiagnosticReason(error);
          lifecycle.setChannel('webview');
          return await recordDirectFallbackSuccess(await fetchNodeSeekThroughWebView(
            webViewFetcher,
            url,
            init,
            diagnosticReason === 'unknown' ? 'network_error' : diagnosticReason
          ), reason, url, init, failureGeneration, lifecycle);
        }
        throw error;
      }
      const text = await response.clone().text();
      resetDirectFailures();
      if (isNodeSeekChallengeResponse(response, text, url)) {
        lifecycle.setChannel('webview');
        return await fetchNodeSeekThroughWebView(webViewFetcher, url, init, 'verification_required', response.status);
      }
      return response;
    } finally {
      lifecycle.release();
    }
  });
}
