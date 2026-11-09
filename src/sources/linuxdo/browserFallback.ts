import {
  cloudflareChallengeDiagnostics,
  isCloudflareChallengeResponse,
  LinuxDoCloudflareError
} from '@/platform/network/cloudflareChallenge';
import { browserFetchIntentFromInit, withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { cancelRequestTimeoutForFallback, withAbortableTimeout, type Fetcher } from '@/platform/network/request';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  diagnosticRequestFields,
  finishDiagnosticTrace,
  markDiagnosticStage
} from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import { currentReadNetworkRuntimeGeneration } from '@/platform/network/readNetworkRuntime';
import {
  forumRecoveryDiagnosticFields,
  recordForumRecoveryDecision,
  registerForumReadResponseEvidence
} from '@/sources/forumSourceReadAttempt';
import { LINUXDO_BASE_URL } from './protocol';

export type LinuxDoHiddenBrowserFailureReason =
  'content-too-large' | 'unreadable' | 'script-error' | 'network' | 'renderer' | 'canceled' | 'stale';

const LINUXDO_CURRENT_SESSION_URL = `${LINUXDO_BASE_URL}/session/current.json`;
const LINUXDO_CONNECT_URL = 'https://connect.linux.do/';
const LINUXDO_DIRECT_FETCH_TIMEOUT_MS = 8_000;
const LINUXDO_CONNECT_SESSION_RECOVERY_INTENT = Symbol.for('wz.linuxDoConnectSessionRecoveryIntent');

type LinuxDoConnectSessionRecoveryInit = RequestInit & {
  [LINUXDO_CONNECT_SESSION_RECOVERY_INTENT]?: true;
};

type LinuxDoEvidenceWindow = Readonly<{
  epoch: number;
  latestConfirmedDirectOrdinal: number;
}>;

type LinuxDoReadTransport = { channel: 'direct'; response: Response } | { channel: 'webview'; response: Response };

class LinuxDoDirectFetchTimeoutError extends Error {}

async function fetchLinuxDoDirectly(defaultFetcher: Fetcher, input: string, init?: RequestInit) {
  return withAbortableTimeout((signal) => defaultFetcher(input, { ...init, signal }), {
    signal: init?.signal,
    timeoutMs: LINUXDO_DIRECT_FETCH_TIMEOUT_MS,
    timeoutError: () => new LinuxDoDirectFetchTimeoutError('linux.do direct fetch timeout')
  });
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

export function isLinuxDoBrowserRequestPair(input: string, initialRequestUrl: string) {
  return isLinuxDoRequestUrl(initialRequestUrl) && isLinuxDoRequestUrl(input);
}

async function fetchLinuxDoThroughWebView(
  webViewFetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  directResponse: Response,
  directBody: string
) {
  const evidence = cloudflareChallengeDiagnostics(directResponse, directBody);
  const challenge = Object.assign(new LinuxDoCloudflareError(directResponse), evidence);
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace =
    inheritedTrace ||
    beginDiagnosticTrace('source', 'transport-fallback', {
      source: 'linuxdo',
      reason: 'verification_required'
    });
  markDiagnosticStage(trace, 'transport', {
    ...diagnosticRequestFields(init),
    source: 'linuxdo',
    channel: 'direct',
    state: 'fallback',
    reason: 'verification_required',
    ...evidence
  });
  return fetchTracedLinuxDoWebView(webViewFetcher, url, init, { trace, ownsTrace: !inheritedTrace, challenge });
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
      ...diagnosticRequestFields(init),
      source: 'linuxdo',
      channel: 'direct',
      state: 'fallback',
      ...directFailure
    });
  }
  markDiagnosticStage(trace, 'transport', {
    ...diagnosticRequestFields(init),
    source: 'linuxdo',
    channel: 'webview',
    state: 'start',
    ...(directFailure ? { owner: directFailure.owner } : {})
  });
  return fetchTracedLinuxDoWebView(webViewFetcher, url, init, {
    trace,
    ownsTrace: !inheritedTrace,
    ownerFields: directFailure ? { owner: directFailure.owner } : {}
  });
}

async function fetchTracedLinuxDoWebView(
  webViewFetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  {
    trace,
    ownsTrace,
    ownerFields = {},
    challenge
  }: {
    trace: DiagnosticTrace;
    ownsTrace: boolean;
    ownerFields?: { owner?: 'account' };
    challenge?: LinuxDoCloudflareError;
  }
) {
  try {
    cancelRequestTimeoutForFallback(init);
    const response = await webViewFetcher(url, init);
    markDiagnosticStage(trace, 'transport', {
      ...diagnosticRequestFields(init),
      source: 'linuxdo',
      channel: 'webview',
      state: 'finish',
      ...ownerFields,
      status: response.status
    });
    if (ownsTrace) {
      finishDiagnosticTrace(trace, response.ok ? 'success' : 'failure', {
        source: 'linuxdo',
        channel: 'webview',
        ...ownerFields,
        ...(response.ok ? {} : { reason: 'http_error' })
      });
    }
    return response;
  } catch (error) {
    const reason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', {
      ...diagnosticRequestFields(init),
      source: 'linuxdo',
      channel: 'webview',
      state: 'failure',
      reason,
      ...ownerFields
    });
    if (ownsTrace) {
      finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : 'failure', {
        source: 'linuxdo',
        channel: 'webview',
        reason,
        ...ownerFields
      });
    }
    if (
      !challenge ||
      (typeof error === 'object' &&
        error !== null &&
        'reason' in error &&
        (error.reason === 'private-access-stale' || error.reason === 'source-disabled')) ||
      reason === 'canceled' ||
      reason === 'stale' ||
      reason === 'superseded' ||
      (error instanceof LinuxDoHiddenBrowserFailureError && error.reason === 'content-too-large')
    ) {
      throw error;
    }
    throw challenge;
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
  let evidenceWindow: LinuxDoEvidenceWindow = { epoch: 0, latestConfirmedDirectOrdinal: 0 };
  let requestOrdinal = 0;
  const recordQualifiedReadFallback = async (
    reason: 'network_error' | 'timeout',
    ordinal: number,
    expectedWindow: LinuxDoEvidenceWindow,
    expectedGeneration: number,
    diagnosticFields: DiagnosticFields
  ) => {
    const fields = {
      ...diagnosticFields,
      evidenceKind: 'fallback',
      ordinal,
      generation: expectedGeneration,
      evidenceEpoch: evidenceWindow.epoch
    } as const;
    if (expectedWindow !== evidenceWindow || ordinal <= evidenceWindow.latestConfirmedDirectOrdinal) {
      recordForumRecoveryDecision('linuxdo', 'superseded', fields);
      return;
    }
    if (!recoverReadChannel) {
      recordForumRecoveryDecision('linuxdo', 'unavailable', fields);
      return;
    }
    recordForumRecoveryDecision('linuxdo', 'commit', fields);
    evidenceWindow = { ...evidenceWindow, epoch: evidenceWindow.epoch + 1 };
    const trace = beginDiagnosticTrace('network', 'rotate-read-runtime', {
      ...diagnosticFields,
      source: 'linuxdo',
      reason
    });
    try {
      await recoverReadChannel(expectedGeneration, trace);
    } catch (error) {
      recordForumRecoveryDecision('linuxdo', 'failed', { ...fields, reason: normalizeDiagnosticReason(error) });
      // Native owns the terminal event once the trace crosses the bridge.
    }
  };
  return async (input, init) => {
    const recoveryFields = forumRecoveryDiagnosticFields(init);
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const ordinal = ++requestOrdinal;
    if (hasLinuxDoConnectSessionRecoveryIntent(init) && url === LINUXDO_CONNECT_URL && method === 'GET') {
      if (!allowWebViewFallback(url)) {
        throw new LinuxDoHiddenBrowserFailureError('renderer', 'linux.do 页面读取当前不可用');
      }
      return fetchLinuxDoWebViewOnly(webViewFetcher, url, init);
    }
    const isIdempotentRead = isLinuxDoRequestUrl(url) && (method === 'GET' || method === 'HEAD');
    const requestStartGeneration = readNetworkRuntimeGeneration();
    let transport: LinuxDoReadTransport;
    try {
      transport = {
        channel: 'direct',
        response: isIdempotentRead
          ? await fetchLinuxDoDirectly(defaultFetcher, url, init)
          : await defaultFetcher(input, init)
      };
    } catch (error) {
      if (
        error instanceof LinuxDoDirectFetchTimeoutError &&
        !init?.signal?.aborted &&
        url !== LINUXDO_CONNECT_URL &&
        allowWebViewFallback(url)
      ) {
        const response = await fetchLinuxDoWebViewOnly(webViewFetcher, url, init, { reason: 'timeout' });
        transport = { channel: 'webview', response };
        if (response.ok) {
          const expectedWindow = evidenceWindow;
          registerForumReadResponseEvidence(init, response, {
            commit: () =>
              recordQualifiedReadFallback('timeout', ordinal, expectedWindow, requestStartGeneration, recoveryFields),
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
            const expectedWindow = evidenceWindow;
            registerForumReadResponseEvidence(init, fallbackResponse, {
              commit: () =>
                recordQualifiedReadFallback(
                  'network_error',
                  ordinal,
                  expectedWindow,
                  requestStartGeneration,
                  recoveryFields
                ),
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
    const { response } = transport;
    if (!isLinuxDoRequestUrl(url) || method !== 'GET') {
      return response;
    }
    if (isCloudflareChallengeResponse(response)) {
      return allowWebViewFallback(url)
        ? fetchLinuxDoThroughWebView(
            webViewFetcher,
            url,
            init,
            response,
            await response
              .clone()
              .text()
              .catch(() => '')
          )
        : response;
    }
    const contentType = response.headers.get('content-type') || '';
    const shouldInspectBody = !response.ok && /html/i.test(contentType);
    const bodyText = shouldInspectBody ? await response.clone().text() : '';
    if (
      shouldInspectBody &&
      isCloudflareChallengeResponse({
        status: response.status,
        headers: response.headers,
        bodyText
      })
    ) {
      return allowWebViewFallback(url)
        ? fetchLinuxDoThroughWebView(webViewFetcher, url, init, response, bodyText)
        : response;
    }
    if (response.ok && transport.channel === 'direct') {
      registerForumReadResponseEvidence(init, response, {
        commit: async () => {
          if (ordinal > evidenceWindow.latestConfirmedDirectOrdinal) {
            evidenceWindow = { epoch: evidenceWindow.epoch + 1, latestConfirmedDirectOrdinal: ordinal };
            recordForumRecoveryDecision('linuxdo', 'direct-reset', {
              ...recoveryFields,
              evidenceKind: 'direct',
              ordinal,
              evidenceEpoch: evidenceWindow.epoch,
              generation: requestStartGeneration
            });
          }
        },
        kind: 'direct',
        ordinal,
        source: 'linuxdo'
      });
    }
    return response;
  };
}
