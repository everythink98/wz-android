import { cancelRequestTimeoutForFallback, withAbortableTimeout, type Fetcher } from '@/platform/network/request';
import { extractNodeSeekEmbeddedData, isNodeSeekChallengeResponse } from './protocol';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  diagnosticRequestFields,
  finishDiagnosticTrace,
  markDiagnosticStage
} from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticReason,
  type DiagnosticFields,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { canContainCloudflareChallengePage } from '@/platform/network/cloudflareChallenge';
import { currentReadNetworkRuntimeGeneration } from '@/platform/network/readNetworkRuntime';
import { hasNodeSeekAccountEvidenceHtml, nodeSeekCurrentUserFromConfig } from './userParser';
import {
  forumRecoveryDiagnosticFields,
  recordForumRecoveryDecision,
  registerForumReadResponseEvidence
} from '@/sources/forumSourceReadAttempt';
import { isNodeSeekHost } from '@/domain/forum/sourceCatalog';

const NODESEEK_DIRECT_FETCH_TIMEOUT_MS = 8000;
const NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE = 'NodeSeek direct fetch timeout';

type NodeSeekEvidenceWindow = Readonly<{
  epoch: number;
  latestConfirmedDirectOrdinal: number;
}>;

type NodeSeekRecoveringEvidence = {
  phase: 'recovering';
  window: NodeSeekEvidenceWindow;
  qualifiedCount: number;
};

type NodeSeekRecoveryEvidence =
  { phase: 'collecting'; window: NodeSeekEvidenceWindow; qualifiedCount: number } | NodeSeekRecoveringEvidence;

export function isNodeSeekRequestUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && isNodeSeekHost(url.hostname);
  } catch {
    return false;
  }
}

export function isNodeSeekBrowserRequestPair(input: string, initialRequestUrl: string) {
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
    ...diagnosticRequestFields(init),
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
      ...diagnosticRequestFields(init),
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
      ...diagnosticRequestFields(init),
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
  let recoveryEvidence: NodeSeekRecoveryEvidence = {
    phase: 'collecting',
    window: { epoch: 0, latestConfirmedDirectOrdinal: 0 },
    qualifiedCount: 0
  };
  let requestOrdinal = 0;
  const settleRecovery = (owner: NodeSeekRecoveringEvidence, outcome: 'succeeded' | 'failed') => {
    if (recoveryEvidence.phase !== 'recovering' || recoveryEvidence !== owner) return;
    recoveryEvidence = {
      phase: 'collecting',
      window: owner.window,
      qualifiedCount: outcome === 'succeeded' ? 0 : owner.qualifiedCount
    };
  };
  const recordQualifiedFallback = async (
    reason: 'timeout' | 'network_error',
    ordinal: number,
    expectedWindow: NodeSeekEvidenceWindow,
    expectedGeneration: number,
    diagnosticFields: DiagnosticFields
  ) => {
    const current = recoveryEvidence;
    const fields = {
      ...diagnosticFields,
      evidenceKind: 'fallback',
      ordinal,
      generation: expectedGeneration,
      evidenceEpoch: current.window.epoch,
      threshold
    } as const;
    if (expectedWindow !== current.window || ordinal <= current.window.latestConfirmedDirectOrdinal) {
      recordForumRecoveryDecision('nodeseek', 'superseded', fields);
      return;
    }
    if (!recoverReadChannel) {
      recordForumRecoveryDecision('nodeseek', 'unavailable', fields);
      return;
    }
    const qualifiedCount = current.qualifiedCount + 1;
    if (qualifiedCount < threshold) {
      recoveryEvidence = { phase: 'collecting', window: current.window, qualifiedCount };
      recordForumRecoveryDecision('nodeseek', 'threshold', { ...fields, qualifiedCount });
      return;
    }
    recordForumRecoveryDecision('nodeseek', 'commit', { ...fields, qualifiedCount });
    const recovering: NodeSeekRecoveringEvidence = {
      phase: 'recovering',
      window: { ...current.window, epoch: current.window.epoch + 1 },
      qualifiedCount
    };
    recoveryEvidence = recovering;
    const trace = beginDiagnosticTrace('network', 'rotate-read-runtime', {
      ...diagnosticFields,
      source: 'nodeseek',
      reason
    });
    try {
      await recoverReadChannel(expectedGeneration, trace);
      settleRecovery(recovering, 'succeeded');
    } catch (error) {
      settleRecovery(recovering, 'failed');
      recordForumRecoveryDecision('nodeseek', 'failed', { ...fields, reason: normalizeDiagnosticReason(error) });
      // Native owns the terminal event once the trace crosses the bridge.
    }
  };
  return async (input, init) => {
    const recoveryFields = forumRecoveryDiagnosticFields(init);
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const isIdempotentRead = method === 'GET' || method === 'HEAD';
    const ordinal = ++requestOrdinal;
    const owner = browserFetchIntentFromInit(init)?.owner;
    const accountProbe = owner === 'account' || owner === 'account-overview';
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
          const expectedWindow = recoveryEvidence.window;
          registerForumReadResponseEvidence(init, fallbackResponse, {
            commit: () =>
              recordQualifiedFallback(reason, ordinal, expectedWindow, requestStartGeneration, recoveryFields),
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
    if (
      accountProbe &&
      response.ok &&
      canContainCloudflareChallengePage(response.headers) &&
      !(owner === 'account-overview'
        ? nodeSeekCurrentUserFromConfig(extractNodeSeekEmbeddedData(text))
        : hasNodeSeekAccountEvidenceHtml(text, url)) &&
      allowWebViewFallback(url)
    ) {
      return fetchNodeSeekThroughWebView(webViewFetcher, url, init, 'invalid_response', response.status);
    }
    if (response.ok) {
      registerForumReadResponseEvidence(init, response, {
        commit: async () => {
          if (ordinal > recoveryEvidence.window.latestConfirmedDirectOrdinal) {
            const window = { epoch: recoveryEvidence.window.epoch + 1, latestConfirmedDirectOrdinal: ordinal };
            recoveryEvidence = { phase: 'collecting', window, qualifiedCount: 0 };
            recordForumRecoveryDecision('nodeseek', 'direct-reset', {
              ...recoveryFields,
              evidenceKind: 'direct',
              ordinal,
              evidenceEpoch: window.epoch,
              generation: requestStartGeneration
            });
          }
        },
        kind: 'direct',
        ordinal,
        source: 'nodeseek'
      });
    }
    return response;
  };
}
