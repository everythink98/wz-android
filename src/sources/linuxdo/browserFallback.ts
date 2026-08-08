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
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

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
  directFailure?: { owner: 'account'; reason: 'network_error' }
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
  recoverReadChannel,
  webViewFetcher
}: {
  allowWebViewFallback?: (url: string) => boolean;
  defaultFetcher?: Fetcher;
  recoverReadChannel?: () => Promise<unknown>;
  webViewFetcher: Fetcher;
}): Fetcher {
  const recoverTimedOutRead = async () => {
    if (!recoverReadChannel) throw new LinuxDoDirectFetchTimeoutError('linux.do direct fetch timeout');
    const trace = beginDiagnosticTrace('network', 'channel-recovery', { source: 'linuxdo', reason: 'timeout' });
    try {
      const result = await recoverReadChannel();
      const fields = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      finishDiagnosticTrace(trace, 'success', {
        source: 'linuxdo',
        reason: 'timeout',
        ...(typeof fields.generation === 'number' ? { generation: fields.generation } : {}),
        ...(typeof fields.canceledQueued === 'number' ? { queuedCount: fields.canceledQueued } : {}),
        ...(typeof fields.canceledRunning === 'number' ? { runningCount: fields.canceledRunning } : {})
      });
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { source: 'linuxdo', reason: 'timeout' });
      throw error;
    }
  };
  return registerDiagnosticContextFetcher(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
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
    let response: Response;
    try {
      response = isIdempotentRead
        ? await fetchLinuxDoDirectly(defaultFetcher, url, init)
        : await defaultFetcher(input, init);
    } catch (error) {
      if (error instanceof LinuxDoDirectFetchTimeoutError && !init?.signal?.aborted && url !== LINUXDO_CONNECT_URL) {
        await recoverTimedOutRead();
        response = await defaultFetcher(input, init);
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
          return fetchLinuxDoWebViewOnly(webViewFetcher, url, init, {
            owner: 'account',
            reason: 'network_error'
          });
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
    return response;
  });
}
