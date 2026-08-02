import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import {
  isGoogleSiteSearchNavigationUrl,
  isGoogleSiteSearchUrl,
  isSameGoogleSiteSearchUrl
} from '@/sources/searchFallback';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { cancelRequestTimeoutForFallback, type Fetcher } from '@/platform/network/request';
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

export class LinuxDoHiddenBrowserFailureError extends Error {
  constructor(
    public readonly reason: LinuxDoHiddenBrowserFailureReason,
    message: string
  ) {
    super(message);
  }
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
  webViewFetcher
}: {
  allowWebViewFallback?: (url: string) => boolean;
  defaultFetcher?: Fetcher;
  webViewFetcher: Fetcher;
}): Fetcher {
  return registerDiagnosticContextFetcher(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    if (isLinuxDoGoogleSearchUrl(url)) {
      if (method !== 'GET') {
        return defaultFetcher(input, init);
      }
      return fetchLinuxDoWebViewOnly(webViewFetcher, url, init);
    }
    let response: Response;
    try {
      response = await defaultFetcher(input, init);
    } catch (error) {
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
