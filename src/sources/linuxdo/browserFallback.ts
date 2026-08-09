import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import {
  isGoogleSiteSearchNavigationUrl,
  isGoogleSiteSearchUrl,
  isSameGoogleSiteSearchUrl
} from '@/sources/searchFallback';
import { browserFetchIntentFromInit, withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { cancelRequestTimeoutForFallback, scheduleRequestTimeout, type Fetcher } from '@/platform/network/request';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage,
  registerDiagnosticContextFetcher
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { currentReadNetworkRuntimeGeneration } from '@/platform/network/readNetworkRuntime';
import { registerForumReadResponseEvidence } from '@/sources/forumSourceReadAttempt';

export type LinuxDoHiddenBrowserFailureReason =
  'content-too-large' | 'unreadable' | 'script-error' | 'network' | 'renderer' | 'canceled' | 'stale';

const LINUXDO_CURRENT_SESSION_URL = 'https://linux.do/session/current.json';
const LINUXDO_CONNECT_URL = 'https://connect.linux.do/';
const LINUXDO_DIRECT_FETCH_TIMEOUT_MS = 8_000;
const LINUXDO_CONNECT_SESSION_RECOVERY_INTENT = Symbol.for('wz.linuxDoConnectSessionRecoveryIntent');

type LinuxDoConnectSessionRecoveryInit = RequestInit & {
  [LINUXDO_CONNECT_SESSION_RECOVERY_INTENT]?: true;
};

class LinuxDoDirectFetchTimeoutError extends Error {}

async function fetchLinuxDoDirectly(defaultFetcher: Fetcher, input: string, init?: RequestInit) {
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort();
  let cancelTimeout: (() => void) | undefined;
  let timeoutPromise: Promise<never> | undefined;
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    timeoutPromise = new Promise<never>((_resolve, reject) => {
      cancelTimeout = scheduleRequestTimeout(() => {
        reject(new LinuxDoDirectFetchTimeoutError('linux.do direct fetch timeout'));
        controller.abort();
      }, LINUXDO_DIRECT_FETCH_TIMEOUT_MS);
    });
  }
  try {
    const fetchPromise = defaultFetcher(input, { ...init, signal: controller.signal });
    return await (timeoutPromise ? Promise.race([fetchPromise, timeoutPromise]) : fetchPromise);
  } finally {
    cancelTimeout?.();
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

export class LinuxDoHiddenBrowserFailureError extends Error {
  constructor(
    public readonly reason: LinuxDoHiddenBrowserFailureReason,
    message: string
  ) {
    super(message);
  }
}

export function withLinuxDoConnectSessionRecoveryIntent(init: RequestInit): RequestInit {
  return withBrowserFetchIntent(
    {
      ...init,
      [LINUXDO_CONNECT_SESSION_RECOVERY_INTENT]: true
    } as RequestInit,
    {
      owner: 'account',
      priority: 'foreground'
    }
  );
}

function hasLinuxDoConnectSessionRecoveryIntent(init: RequestInit | undefined) {
  return (init as LinuxDoConnectSessionRecoveryInit | undefined)?.[LINUXDO_CONNECT_SESSION_RECOVERY_INTENT] === true;
}

export function isLinuxDoRequestUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' && !url.username && !url.password && (host === 'linux.do' || host.endsWith('.linux.do'))
    );
  } catch {
    return false;
  }
}

export function isLinuxDoGoogleSearchUrl(input: string) {
  return isGoogleSiteSearchUrl(input, 'linux.do');
}

export function isLinuxDoBrowserFetchUrl(input: string) {
  return isLinuxDoRequestUrl(input) || isLinuxDoGoogleSearchUrl(input);
}

export function isLinuxDoBrowserNavigationUrl(input: string, initialRequestUrl: string) {
  return isLinuxDoRequestUrl(initialRequestUrl)
    ? isLinuxDoRequestUrl(input)
    : isGoogleSiteSearchNavigationUrl(input, 'linux.do', initialRequestUrl);
}

export function isLinuxDoBrowserResultUrl(input: string, initialRequestUrl: string) {
  return isLinuxDoRequestUrl(initialRequestUrl)
    ? isLinuxDoRequestUrl(input)
    : isSameGoogleSiteSearchUrl(input, 'linux.do', initialRequestUrl);
}

async function fetchLinuxDoThroughWebView(
  webViewFetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  directStatus: number
) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace =
    inheritedTrace ||
    beginDiagnosticTrace('source', 'transport-fallback', {
      source: 'linuxdo',
      reason: 'verification_required'
    });
  markDiagnosticStage(trace, 'transport', {
    source: 'linuxdo',
    channel: 'direct',
    state: 'fallback',
    reason: 'verification_required',
    status: directStatus
  });
  try {
    cancelRequestTimeoutForFallback(init);
    const response = await webViewFetcher(url, init);
    markDiagnosticStage(trace, 'transport', {
      source: 'linuxdo',
      channel: 'webview',
      state: 'finish',
      status: response.status
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, response.ok ? 'success' : 'failure', {
        source: 'linuxdo',
        channel: 'webview',
        ...(response.ok ? {} : { reason: 'http_error' })
      });
    }
    return response;
  } catch (error) {
    const reason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', {
      source: 'linuxdo',
      channel: 'webview',
      state: 'failure',
      reason
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : 'failure', {
        source: 'linuxdo',
        channel: 'webview',
        reason
      });
    }
    if (
      reason === 'canceled' ||
      reason === 'stale' ||
      reason === 'superseded' ||
      (error instanceof LinuxDoHiddenBrowserFailureError && error.reason === 'content-too-large')
    ) {
      throw error;
    }
    throw new LinuxDoCloudflareError();
  }
}

async function fetchLinuxDoWebViewOnly(
  webViewFetcher: Fetcher,
  url: string,
  init?: RequestInit,
  directFailure?: { owner?: 'account'; reason: 'network_error' | 'timeout' }
) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace =
    inheritedTrace ||
    beginDiagnosticTrace('source', directFailure ? 'transport-fallback' : 'webview-transport', {
      source: 'linuxdo',
      channel: directFailure ? 'direct' : 'webview',
      ...directFailure
    });
  if (directFailure) {
    markDiagnosticStage(trace, 'transport', {
      source: 'linuxdo',
      channel: 'direct',
      state: 'fallback',
      ...directFailure
    });
  }
  markDiagnosticStage(trace, 'transport', {
    source: 'linuxdo',
    channel: 'webview',
    state: 'start',
    ...(directFailure ? { owner: directFailure.owner } : {})
  });
  try {
    cancelRequestTimeoutForFallback(init);
    const response = await webViewFetcher(url, init);
    markDiagnosticStage(trace, 'transport', {
      source: 'linuxdo',
      channel: 'webview',
      state: 'finish',
      ...(directFailure ? { owner: directFailure.owner } : {}),
      status: response.status
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, response.ok ? 'success' : 'failure', {
        source: 'linuxdo',
        channel: 'webview',
        ...(directFailure ? { owner: directFailure.owner } : {}),
        ...(response.ok ? {} : { reason: 'http_error' })
      });
    }
    return response;
  } catch (error) {
    const reason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', {
      source: 'linuxdo',
      channel: 'webview',
      state: 'failure',
      reason,
      ...(directFailure ? { owner: directFailure.owner } : {})
    });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : 'failure', {
        source: 'linuxdo',
        channel: 'webview',
        reason,
        ...(directFailure ? { owner: directFailure.owner } : {})
      });
    }
    throw error;
  }
}

export function createLinuxDoWebViewFallbackFetcher({
  allowWebViewFallback = () => true,
  defaultFetcher = fetch,
  readNetworkRuntimeGeneration = currentReadNetworkRuntimeGeneration,
  recoverReadChannel,
  webViewFetcher
}: {
  allowWebViewFallback?: (url: string) => boolean;
  defaultFetcher?: Fetcher;
  readNetworkRuntimeGeneration?: () => number;
  recoverReadChannel?: (expectedGeneration: number, trace: DiagnosticTrace) => Promise<unknown>;
  webViewFetcher: Fetcher;
}): Fetcher {
  let evidenceEpoch = 0;
  let latestConfirmedDirectOrdinal = 0;
  let requestOrdinal = 0;
  const recordQualifiedReadFallback = async (
    reason: 'network_error' | 'timeout',
    ordinal: number,
    expectedEvidenceEpoch: number,
    expectedGeneration: number
  ) => {
    if (expectedEvidenceEpoch !== evidenceEpoch || ordinal <= latestConfirmedDirectOrdinal) return;
    if (!recoverReadChannel) return;
    evidenceEpoch += 1;
    const trace = beginDiagnosticTrace('network', 'rotate-read-runtime', { source: 'linuxdo', reason });
    try {
      await recoverReadChannel(expectedGeneration, trace);
    } catch {
      // Native owns the terminal event once the trace crosses the bridge.
    }
  };
  return registerDiagnosticContextFetcher(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const ordinal = ++requestOrdinal;
    if (hasLinuxDoConnectSessionRecoveryIntent(init) && url === LINUXDO_CONNECT_URL && method === 'GET') {
      if (!allowWebViewFallback(url)) {
        throw new LinuxDoHiddenBrowserFailureError('renderer', 'linux.do 页面读取当前不可用');
      }
      return fetchLinuxDoWebViewOnly(webViewFetcher, url, init);
    }
    if (isLinuxDoGoogleSearchUrl(url)) {
      if (method !== 'GET') {
        return defaultFetcher(input, init);
      }
      return fetchLinuxDoWebViewOnly(webViewFetcher, url, init);
    }
    const isIdempotentRead = isLinuxDoRequestUrl(url) && (method === 'GET' || method === 'HEAD');
    const requestStartGeneration = readNetworkRuntimeGeneration();
    let qualifiedFallback = false;
    let response: Response;
    try {
      response = isIdempotentRead
        ? await fetchLinuxDoDirectly(defaultFetcher, url, init)
        : await defaultFetcher(input, init);
    } catch (error) {
      if (
        error instanceof LinuxDoDirectFetchTimeoutError &&
        !init?.signal?.aborted &&
        url !== LINUXDO_CONNECT_URL &&
        allowWebViewFallback(url)
      ) {
        response = await fetchLinuxDoWebViewOnly(webViewFetcher, url, init, { reason: 'timeout' });
        if (response.ok) {
          qualifiedFallback = true;
          const expectedEvidenceEpoch = evidenceEpoch;
          registerForumReadResponseEvidence(init, response, {
            commit: () =>
              recordQualifiedReadFallback('timeout', ordinal, expectedEvidenceEpoch, requestStartGeneration),
            kind: 'fallback',
            ordinal,
            source: 'linuxdo'
          });
        }
      } else {
        const intent = browserFetchIntentFromInit(init);
        if (
          url === LINUXDO_CURRENT_SESSION_URL &&
          method === 'GET' &&
          intent?.owner === 'account' &&
          intent.priority === 'background' &&
          normalizeDiagnosticReason(error) === 'network_error' &&
          allowWebViewFallback(url)
        ) {
          const fallbackResponse = await fetchLinuxDoWebViewOnly(webViewFetcher, url, init, {
            owner: 'account',
            reason: 'network_error'
          });
          if (fallbackResponse.ok) {
            const expectedEvidenceEpoch = evidenceEpoch;
            registerForumReadResponseEvidence(init, fallbackResponse, {
              commit: () =>
                recordQualifiedReadFallback('network_error', ordinal, expectedEvidenceEpoch, requestStartGeneration),
              kind: 'fallback',
              ordinal,
              source: 'linuxdo'
            });
          }
          return fallbackResponse;
        }
        throw error;
      }
    }
    if (!isLinuxDoRequestUrl(url) || method !== 'GET') {
      return response;
    }
    if (isCloudflareChallengeResponse(response)) {
      return allowWebViewFallback(url)
        ? fetchLinuxDoThroughWebView(webViewFetcher, url, init, response.status)
        : response;
    }
    const contentType = response.headers.get('content-type') || '';
    const shouldInspectBody = !response.ok && /html/i.test(contentType);
    if (
      shouldInspectBody &&
      isCloudflareChallengeResponse({
        status: response.status,
        headers: response.headers,
        bodyText: await response.clone().text()
      })
    ) {
      return allowWebViewFallback(url)
        ? fetchLinuxDoThroughWebView(webViewFetcher, url, init, response.status)
        : response;
    }
    if (response.ok && !qualifiedFallback) {
      registerForumReadResponseEvidence(init, response, {
        commit: async () => {
          if (ordinal > latestConfirmedDirectOrdinal) {
            latestConfirmedDirectOrdinal = ordinal;
            evidenceEpoch += 1;
          }
        },
        kind: 'direct',
        ordinal,
        source: 'linuxdo'
      });
    }
    return response;
  });
}
