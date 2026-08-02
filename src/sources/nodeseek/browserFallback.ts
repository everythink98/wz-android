import { cancelRequestTimeoutForFallback, scheduleRequestTimeout, type Fetcher } from '@/platform/network/request';
import {
  isGoogleSiteSearchNavigationUrl,
  isGoogleSiteSearchUrl,
  isSameGoogleSiteSearchUrl
} from '@/sources/searchFallback';
import { isNodeSeekChallengeResponse } from './protocol';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage,
  registerDiagnosticContextFetcher
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { hasNodeSeekAccountEvidenceHtml } from './userParser';

const NODESEEK_DIRECT_FETCH_TIMEOUT_MS = 8000;
const NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE = 'NodeSeek direct fetch timeout';

export function isNodeSeekRequestUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (host === 'nodeseek.com' || host.endsWith('.nodeseek.com'))
    );
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

export function isNodeSeekBrowserNavigationUrl(input: string, initialRequestUrl: string) {
  return isNodeSeekRequestUrl(initialRequestUrl)
    ? isNodeSeekRequestUrl(input)
    : isGoogleSiteSearchNavigationUrl(input, 'nodeseek.com', initialRequestUrl);
}

export function isNodeSeekBrowserResultUrl(input: string, initialRequestUrl: string) {
  return isNodeSeekRequestUrl(initialRequestUrl)
    ? isNodeSeekRequestUrl(input)
    : isSameGoogleSiteSearchUrl(input, 'nodeseek.com', initialRequestUrl);
}

async function fetchNodeSeekDirectly(defaultFetcher: Fetcher, input: string, init?: RequestInit) {
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
        controller.abort();
        reject(new Error(NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE));
      }, NODESEEK_DIRECT_FETCH_TIMEOUT_MS);
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

async function fetchNodeSeekWebViewOnly(webViewFetcher: Fetcher, url: string, init?: RequestInit) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace =
    inheritedTrace ||
    beginDiagnosticTrace('source', 'webview-transport', {
      source: 'nodeseek',
      channel: 'webview'
    });
  markDiagnosticStage(trace, 'transport', { source: 'nodeseek', channel: 'webview', state: 'start' });
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
    const reason = normalizeDiagnosticReason(error);
    markDiagnosticStage(trace, 'transport', { source: 'nodeseek', channel: 'webview', state: 'failure', reason });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : 'failure', {
        source: 'nodeseek',
        channel: 'webview',
        reason
      });
    }
    throw error;
  }
}

export function createNodeSeekWebViewFallbackFetcher({
  allowWebViewFallback = () => true,
  defaultFetcher = fetch,
  webViewFetcher
}: {
  allowWebViewFallback?: (url: string) => boolean;
  defaultFetcher?: Fetcher;
  webViewFetcher: Fetcher;
}): Fetcher {
  return registerDiagnosticContextFetcher(async (input, init) => {
    const url = String(input);
    const accountProbe = browserFetchIntentFromInit(init)?.owner === 'account';
    if (isNodeSeekGoogleSearchUrl(url)) {
      return fetchNodeSeekWebViewOnly(webViewFetcher, url, init);
    }
    if (!isNodeSeekRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    let response: Response;
    try {
      response = await fetchNodeSeekDirectly(defaultFetcher, url, init);
    } catch (error) {
      if (!init?.signal?.aborted && allowWebViewFallback(url)) {
        const diagnosticReason = normalizeDiagnosticReason(error);
        return fetchNodeSeekThroughWebView(
          webViewFetcher,
          url,
          init,
          diagnosticReason === 'unknown' ? 'network_error' : diagnosticReason
        );
      }
      throw error;
    }
    const text = await response.clone().text();
    if (isNodeSeekChallengeResponse(response, text, url)) {
      return allowWebViewFallback(url)
        ? fetchNodeSeekThroughWebView(webViewFetcher, url, init, 'verification_required', response.status)
        : response;
    }
    if (accountProbe && !hasNodeSeekAccountEvidenceHtml(text, url) && allowWebViewFallback(url)) {
      return fetchNodeSeekThroughWebView(webViewFetcher, url, init, 'invalid_response', response.status);
    }
    return response;
  });
}
