import { cancelRequestTimeoutForFallback, withAbortableTimeout, type Fetcher } from '@/platform/network/request';
import { isNodeSeekChallengeResponse } from './protocol';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage,
  registerDiagnosticContextFetcher
} from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticReason,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { currentReadNetworkRuntimeGeneration } from '@/platform/network/readNetworkRuntime';
import { hasNodeSeekAccountEvidenceHtml } from './userParser';
import { registerForumReadResponseEvidence } from '@/sources/forumSourceReadAttempt';
import { isNodeSeekHost } from '@/domain/forum/sourceCatalog';

const NODESEEK_DIRECT_FETCH_TIMEOUT_MS = 8000;
const NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE = 'NodeSeek direct fetch timeout';

export function isNodeSeekRequestUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && isNodeSeekHost(url.hostname);
  } catch {
    return false;
  }
}

export function isNodeSeekBrowserFetchUrl(input: string) {
  return isNodeSeekRequestUrl(input);
}

export function isNodeSeekBrowserNavigationUrl(input: string, initialRequestUrl: string) {
  return isNodeSeekRequestUrl(initialRequestUrl) && isNodeSeekRequestUrl(input);
}

export function isNodeSeekBrowserResultUrl(input: string, initialRequestUrl: string) {
  return isNodeSeekRequestUrl(initialRequestUrl) && isNodeSeekRequestUrl(input);
}

async function fetchNodeSeekDirectly(defaultFetcher: Fetcher, input: string, init?: RequestInit) {
  return withAbortableTimeout((signal) => defaultFetcher(input, { ...init, signal }), {
    signal: init?.signal,
    timeoutMs: NODESEEK_DIRECT_FETCH_TIMEOUT_MS,
    timeoutError: () => new Error(NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE)
  });
}

async function fetchNodeSeekThroughWebView(
  webViewFetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  reason: DiagnosticReason,
  directStatus?: number
) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace =
    inheritedTrace ||
    beginDiagnosticTrace('source', 'transport-fallback', {
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
    cancelRequestTimeoutForFallback(init);
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
      finishDiagnosticTrace(trace, fallbackReason === 'canceled' ? 'canceled' : 'failure', {
        source: 'nodeseek',
        channel: 'webview',
        reason: fallbackReason
      });
    }
    throw error;
  }
}

export function createNodeSeekWebViewFallbackFetcher({
  allowWebViewFallback = () => true,
  defaultFetcher = fetch,
  readNetworkRuntimeGeneration = currentReadNetworkRuntimeGeneration,
  recoveryThreshold = 1,
  recoverReadChannel,
  webViewFetcher
}: {
  allowWebViewFallback?: (url: string) => boolean;
  defaultFetcher?: Fetcher;
  readNetworkRuntimeGeneration?: () => number;
  recoveryThreshold?: number;
  recoverReadChannel?: (expectedGeneration: number, trace: DiagnosticTrace) => Promise<unknown>;
  webViewFetcher: Fetcher;
}): Fetcher {
  const threshold = Math.max(1, Math.min(5, Math.round(recoveryThreshold)));
  let qualifiedFallbacks = 0;
  let evidenceEpoch = 0;
  let latestConfirmedDirectOrdinal = 0;
  let requestOrdinal = 0;
  const recordQualifiedFallback = async (
    reason: 'timeout' | 'network_error',
    ordinal: number,
    expectedEvidenceEpoch: number,
    expectedGeneration: number
  ) => {
    if (expectedEvidenceEpoch !== evidenceEpoch || ordinal <= latestConfirmedDirectOrdinal) return;
    if (!recoverReadChannel || ++qualifiedFallbacks < threshold) return;
    evidenceEpoch += 1;
    const trace = beginDiagnosticTrace('network', 'rotate-read-runtime', { source: 'nodeseek', reason });
    try {
      await recoverReadChannel(expectedGeneration, trace);
      qualifiedFallbacks = 0;
    } catch {
      // Native owns the terminal event once the trace crosses the bridge.
    }
  };
  return registerDiagnosticContextFetcher(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const isIdempotentRead = method === 'GET' || method === 'HEAD';
    const ordinal = ++requestOrdinal;
    const accountProbe = browserFetchIntentFromInit(init)?.owner === 'account';
    if (!isNodeSeekRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    const requestStartGeneration = readNetworkRuntimeGeneration();
    let response: Response;
    try {
      response = isIdempotentRead
        ? await fetchNodeSeekDirectly(defaultFetcher, url, init)
        : await defaultFetcher(input, init);
    } catch (error) {
      if (isIdempotentRead && !init?.signal?.aborted && allowWebViewFallback(url)) {
        const diagnosticReason = normalizeDiagnosticReason(error);
        const reason = diagnosticReason === 'unknown' ? 'network_error' : diagnosticReason;
        const fallbackResponse = await fetchNodeSeekThroughWebView(webViewFetcher, url, init, reason);
        if (fallbackResponse.ok && (reason === 'timeout' || reason === 'network_error')) {
          const expectedEvidenceEpoch = evidenceEpoch;
          registerForumReadResponseEvidence(init, fallbackResponse, {
            commit: () => recordQualifiedFallback(reason, ordinal, expectedEvidenceEpoch, requestStartGeneration),
            kind: 'fallback',
            ordinal,
            source: 'nodeseek'
          });
        }
        return fallbackResponse;
      }
      throw error;
    }
    if (!isIdempotentRead) return response;
    const text = await response.clone().text();
    if (isNodeSeekChallengeResponse(response, text, url)) {
      return allowWebViewFallback(url)
        ? fetchNodeSeekThroughWebView(webViewFetcher, url, init, 'verification_required', response.status)
        : response;
    }
    if (accountProbe && !hasNodeSeekAccountEvidenceHtml(text, url) && allowWebViewFallback(url)) {
      return fetchNodeSeekThroughWebView(webViewFetcher, url, init, 'invalid_response', response.status);
    }
    if (response.ok) {
      registerForumReadResponseEvidence(init, response, {
        commit: async () => {
          if (ordinal > latestConfirmedDirectOrdinal) {
            latestConfirmedDirectOrdinal = ordinal;
            evidenceEpoch += 1;
            qualifiedFallbacks = 0;
          }
        },
        kind: 'direct',
        ordinal,
        source: 'nodeseek'
      });
    }
    return response;
  });
}
