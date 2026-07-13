import {
  REQUEST_CANCELED_MESSAGE,
  REQUEST_SUPERSEDED_MESSAGE,
  type Fetcher
} from './request';
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

const DEFAULT_DIRECT_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_RECOVERY_FAILURES = 2;
type DirectTimeoutTrigger = 'app-resume' | 'timer';
type TransportChannel = 'direct' | 'native' | 'webview';

export type DirectTransportSource = 'linuxdo' | 'nodeseek' | 'v2ex' | 'yaohuo';
export type DirectTransportFallbackReason = 'direct-timeout' | 'direct-error';
export type DirectTransportFailureStrategy = 'recover-and-retry-direct' | 'webview-fallback';
export type DirectTransportRecoveryEvent = {
  parentTraceId?: string;
  reason: DirectTransportFallbackReason;
  source: DirectTransportSource;
  url: string;
};
export type DirectTransportAppStateStatus = 'active' | 'background' | 'extension' | 'inactive' | 'unknown';
export type DirectTransportAppState = {
  currentState: DirectTransportAppStateStatus | null;
  addEventListener: (
    event: 'change',
    listener: (state: DirectTransportAppStateStatus) => void
  ) => { remove: () => void };
};

type DirectWebViewFallbackOptions = {
  appState?: DirectTransportAppState;
  defaultFetcher?: Fetcher;
  directFailureStrategy?: DirectTransportFailureStrategy;
  directTimeoutMs?: number;
  inspectChallenge: (response: Response, url: string) => boolean | Promise<boolean>;
  isDirectRequestUrl: (url: string) => boolean;
  isWebViewOnlyUrl: (url: string) => boolean;
  recoverNetworkConnectionPool?: (event: DirectTransportRecoveryEvent) => Promise<unknown> | unknown;
  recoveryFailures?: number;
  source: DirectTransportSource;
  webViewFetcher: Fetcher;
};

type DirectRecoveryFetcherOptions = Pick<
  DirectWebViewFallbackOptions,
  | 'appState'
  | 'defaultFetcher'
  | 'directTimeoutMs'
  | 'isDirectRequestUrl'
  | 'recoverNetworkConnectionPool'
  | 'source'
>;

function isSilentRequestInterruption(error: unknown) {
  return error instanceof Error
    && (error.message === REQUEST_CANCELED_MESSAGE || error.message === REQUEST_SUPERSEDED_MESSAGE);
}

function observeRequestAppState(
  appState: DirectTransportAppState | undefined,
  trace: DiagnosticTrace | undefined,
  source: DirectTransportSource,
  timeoutMs: number,
  initialChannel: TransportChannel
) {
  let channel = initialChannel;
  let previousState: DirectTransportAppStateStatus = appState?.currentState || 'unknown';
  const startedAt = Date.now();
  const subscription = appState && trace ? appState.addEventListener('change', (nextState) => {
    markDiagnosticStage(trace, 'guard', {
      source,
      channel,
      previousState,
      nextState,
      ...(channel === 'direct' ? { timeoutMs } : {}),
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
    setChannel: (nextChannel: TransportChannel) => { channel = nextChannel; }
  };
}

async function fetchDirectly(
  defaultFetcher: Fetcher,
  input: string,
  init: RequestInit | undefined,
  appState: DirectTransportAppState | undefined,
  source: DirectTransportSource,
  timeoutMs: number
) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + timeoutMs;
  const trace = diagnosticTraceForRequest(init);
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort();
  let appStateSubscription: { remove: () => void } | undefined;
  let previousAppState: DirectTransportAppStateStatus = appState?.currentState || 'unknown';
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutExpired = false;
  let rejectTimeout: ((error: Error) => void) | undefined;
  let timeoutPromise: Promise<never> | undefined;

  const transportDurationMs = () => Math.max(0, Date.now() - startedAt);
  const timeoutMessage = `${source} direct fetch timeout`;
  const expire = (trigger: DirectTimeoutTrigger) => {
    if (timeoutExpired) {
      return;
    }
    timeoutExpired = true;
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source,
        channel: 'direct',
        state: 'timeout',
        reason: 'timeout',
        trigger,
        timeoutMs,
        transportDurationMs: transportDurationMs()
      });
    }
    rejectTimeout?.(new Error(timeoutMessage));
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
      source,
      channel: 'direct',
      state: 'start',
      timeoutMs
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
    if (parentSignal?.aborted) {
      throw Object.assign(new Error('Request canceled'), { name: 'AbortError' });
    }
    const fetchPromise = defaultFetcher(input, { ...init, signal: controller.signal });
    const response = await (timeoutPromise ? Promise.race([fetchPromise, timeoutPromise]) : fetchPromise);
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source,
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
        source,
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

async function fetchThroughWebView(
  source: DirectTransportSource,
  webViewFetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  reason: DiagnosticReason,
  directStatus?: number
) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace = inheritedTrace || beginDiagnosticTrace('source', 'transport-fallback', { source, reason });
  markDiagnosticStage(trace, 'transport', {
    source,
    channel: 'direct',
    state: 'fallback',
    reason,
    ...(directStatus === undefined ? {} : { status: directStatus })
  });
  try {
    const response = await webViewFetcher(url, init);
    markDiagnosticStage(trace, 'transport', {
      source,
      channel: 'webview',
      state: 'finish',
      status: response.status
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, response.ok ? 'success' : 'failure', {
        source,
        channel: 'webview',
        ...(response.ok ? {} : { reason: 'http_error' })
      });
    }
    return response;
  } catch (error) {
    const fallbackReason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', {
      source,
      channel: 'webview',
      state: 'failure',
      reason: fallbackReason
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(
        trace,
        fallbackReason === 'canceled' ? 'canceled' : fallbackReason === 'superseded' ? 'stale' : 'failure',
        { source, channel: 'webview', reason: fallbackReason }
      );
    }
    throw error;
  }
}

async function fetchWebViewOnly(
  source: DirectTransportSource,
  webViewFetcher: Fetcher,
  url: string,
  init?: RequestInit
) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace = inheritedTrace || beginDiagnosticTrace('source', 'webview-transport', {
    source,
    channel: 'webview'
  });
  markDiagnosticStage(trace, 'transport', { source, channel: 'webview', state: 'start' });
  try {
    const response = await webViewFetcher(url, init);
    markDiagnosticStage(trace, 'transport', {
      source,
      channel: 'webview',
      state: 'finish',
      status: response.status
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, response.ok ? 'success' : 'failure', {
        source,
        channel: 'webview',
        ...(response.ok ? {} : { reason: 'http_error' })
      });
    }
    return response;
  } catch (error) {
    const reason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', { source, channel: 'webview', state: 'failure', reason });
    if (!inheritedTrace) {
      finishDiagnosticTrace(
        trace,
        reason === 'canceled' ? 'canceled' : reason === 'superseded' ? 'stale' : 'failure',
        { source, channel: 'webview', reason }
      );
    }
    throw error;
  }
}

export function createDirectWebViewFallbackFetcher({
  appState,
  defaultFetcher = fetch,
  directFailureStrategy = 'webview-fallback',
  directTimeoutMs = DEFAULT_DIRECT_FETCH_TIMEOUT_MS,
  inspectChallenge,
  isDirectRequestUrl,
  isWebViewOnlyUrl,
  recoverNetworkConnectionPool,
  recoveryFailures = DEFAULT_RECOVERY_FAILURES,
  source,
  webViewFetcher
}: DirectWebViewFallbackOptions): Fetcher {
  let directFailureCount = 0;
  let directSuccessGeneration = 0;
  let directRecoveryInFlight: Promise<void> | null = null;
  let recoveryInFlight = false;

  const resetDirectFailures = () => {
    directFailureCount = 0;
    directSuccessGeneration += 1;
  };

  const scheduleRecovery = (event: DirectTransportRecoveryEvent) => {
    if (!recoverNetworkConnectionPool || recoveryInFlight) {
      return undefined;
    }
    recoveryInFlight = true;
    const recovery = Promise.resolve()
      .then(() => recoverNetworkConnectionPool(event))
      .catch(() => undefined)
      .finally(() => {
        recoveryInFlight = false;
      });
    void recovery;
    return recovery;
  };

  const recoverDirectChannel = (event: DirectTransportRecoveryEvent) => {
    if (!recoverNetworkConnectionPool) {
      return null;
    }
    if (!directRecoveryInFlight) {
      const recovery = Promise.resolve()
        .then(() => recoverNetworkConnectionPool(event))
        .then(() => undefined);
      directRecoveryInFlight = recovery;
      void recovery.then(
        () => {
          if (directRecoveryInFlight === recovery) {
            directRecoveryInFlight = null;
          }
        },
        () => {
          if (directRecoveryInFlight === recovery) {
            directRecoveryInFlight = null;
          }
        }
      );
    }
    return directRecoveryInFlight;
  };

  const retryDirectAfterRecovery = async (
    originalError: unknown,
    reason: DirectTransportFallbackReason,
    url: string,
    init: RequestInit | undefined,
    lifecycle: ReturnType<typeof observeRequestAppState>
  ) => {
    const trace = diagnosticTraceForRequest(init);
    const recovery = recoverDirectChannel({
      source,
      reason,
      url,
      ...(trace ? { parentTraceId: trace.traceId } : {})
    });
    if (!recovery) {
      throw originalError;
    }
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source,
        channel: 'native',
        state: 'recovery-mode',
        attempt: 1,
        reason: reason === 'direct-timeout' ? 'timeout' : 'network_error'
      });
    }
    lifecycle.setChannel('native');
    const releaseRecovery = lifecycle.retain();
    try {
      await recovery;
    } catch (error) {
      if (trace) {
        markDiagnosticStage(trace, 'transport', {
          source,
          channel: 'native',
          state: 'failure',
          reason: normalizeDiagnosticReason(error)
        });
      }
    } finally {
      releaseRecovery();
    }
    lifecycle.setChannel('direct');
    if (trace) {
      markDiagnosticStage(trace, 'transport', {
        source,
        channel: 'direct',
        state: 'retry',
        attempt: 2
      });
    }
    return fetchDirectly(defaultFetcher, url, init, appState, source, directTimeoutMs);
  };

  const recordDirectFallbackSuccess = async (
    response: Response,
    reason: DirectTransportFallbackReason,
    url: string,
    init: RequestInit | undefined,
    failureGeneration: number,
    lifecycle: ReturnType<typeof observeRequestAppState>
  ) => {
    if (await inspectChallenge(response, url)) {
      return response;
    }
    if (failureGeneration !== directSuccessGeneration) {
      return response;
    }
    directFailureCount += 1;
    if (directFailureCount >= recoveryFailures) {
      directFailureCount = 0;
      const trace = diagnosticTraceForRequest(init);
      directSuccessGeneration += 1;
      const recovery = scheduleRecovery({
        source,
        reason,
        url,
        ...(trace ? { parentTraceId: trace.traceId } : {})
      });
      if (recovery && trace) {
        markDiagnosticStage(trace, 'transport', {
          source,
          channel: 'direct',
          state: 'recovery-mode',
          attempt: recoveryFailures,
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
    const method = (init?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return defaultFetcher(input, init);
    }
    const url = String(input);
    if (isWebViewOnlyUrl(url)) {
      const lifecycle = observeRequestAppState(appState, diagnosticTraceForRequest(init), source, directTimeoutMs, 'webview');
      try {
        return await fetchWebViewOnly(source, webViewFetcher, url, init);
      } finally {
        lifecycle.release();
      }
    }
    if (!isDirectRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    const lifecycle = observeRequestAppState(appState, diagnosticTraceForRequest(init), source, directTimeoutMs, 'direct');
    try {
      let response: Response;
      try {
        response = await fetchDirectly(defaultFetcher, url, init, appState, source, directTimeoutMs);
      } catch (error) {
        if (init?.signal?.aborted || isSilentRequestInterruption(error)) {
          throw error;
        }
        const failureGeneration = directSuccessGeneration;
        const diagnosticReason = normalizeDiagnosticReason(error);
        const reason: DirectTransportFallbackReason = diagnosticReason === 'timeout'
          ? 'direct-timeout'
          : 'direct-error';
        if (directFailureStrategy === 'recover-and-retry-direct') {
          response = await retryDirectAfterRecovery(error, reason, url, init, lifecycle);
        } else {
          lifecycle.setChannel('webview');
          return await recordDirectFallbackSuccess(
            await fetchThroughWebView(
              source,
              webViewFetcher,
              url,
              init,
              diagnosticReason === 'unknown' ? 'network_error' : diagnosticReason
            ),
            reason,
            url,
            init,
            failureGeneration,
            lifecycle
          );
        }
      }
      resetDirectFailures();
      if (await inspectChallenge(response, url)) {
        lifecycle.setChannel('webview');
        return await fetchThroughWebView(source, webViewFetcher, url, init, 'verification_required', response.status);
      }
      return response;
    } finally {
      lifecycle.release();
    }
  });
}

export function createDirectRecoveryFetcher({
  defaultFetcher = fetch,
  ...options
}: DirectRecoveryFetcherOptions): Fetcher {
  return createDirectWebViewFallbackFetcher({
    ...options,
    defaultFetcher,
    directFailureStrategy: 'recover-and-retry-direct',
    inspectChallenge: () => false,
    isWebViewOnlyUrl: () => false,
    webViewFetcher: defaultFetcher
  });
}
