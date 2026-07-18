import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from './cloudflareChallenge';
import { isGoogleSiteSearchUrl } from './googleSearchFallback';
import type { Fetcher } from './request';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  registerDiagnosticContextFetcher
} from './diagnostics';

export type LinuxDoHiddenBrowserFailureReason = 'content-too-large' | 'unreadable' | 'script-error' | 'network' | 'renderer' | 'canceled' | 'stale';

export class LinuxDoHiddenBrowserFailureError extends Error {
  constructor(public readonly reason: LinuxDoHiddenBrowserFailureReason, message: string) {
    super(message);
  }
}

export function isLinuxDoRequestUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (host === 'linux.do' || host.endsWith('.linux.do'));
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

async function fetchLinuxDoThroughWebView(
  webViewFetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  directStatus: number
) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace = inheritedTrace || beginDiagnosticTrace('source', 'transport-fallback', {
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
      reason === 'canceled'
      || reason === 'stale'
      || reason === 'superseded'
      || (error instanceof LinuxDoHiddenBrowserFailureError && error.reason === 'content-too-large')
    ) {
      throw error;
    }
    throw new LinuxDoCloudflareError();
  }
}

async function fetchLinuxDoWebViewOnly(webViewFetcher: Fetcher, url: string, init?: RequestInit) {
  const inheritedTrace = diagnosticTraceForRequest(init);
  const trace = inheritedTrace || beginDiagnosticTrace('source', 'webview-transport', {
    source: 'linuxdo',
    channel: 'webview'
  });
  markDiagnosticStage(trace, 'transport', { source: 'linuxdo', channel: 'webview', state: 'start' });
  try {
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
    markDiagnosticStage(trace, 'transport', { source: 'linuxdo', channel: 'webview', state: 'failure', reason });
    if (!inheritedTrace) {
      finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : 'failure', {
        source: 'linuxdo',
        channel: 'webview',
        reason
      });
    }
    throw error;
  }
}

export function createLinuxDoWebViewFallbackFetcher({
  defaultFetcher = fetch,
  webViewFetcher
}: {
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
    const response = await defaultFetcher(input, init);
    if (!isLinuxDoRequestUrl(url) || method !== 'GET') {
      return response;
    }
    if (isCloudflareChallengeResponse(response)) {
      return fetchLinuxDoThroughWebView(webViewFetcher, url, init, response.status);
    }
    const contentType = response.headers.get('content-type') || '';
    const shouldInspectBody = !response.ok && /html/i.test(contentType);
    if (shouldInspectBody && isCloudflareChallengeResponse({
      status: response.status,
      headers: response.headers,
      bodyText: await response.clone().text()
    })) {
      return fetchLinuxDoThroughWebView(webViewFetcher, url, init, response.status);
    }
    return response;
  });
}
