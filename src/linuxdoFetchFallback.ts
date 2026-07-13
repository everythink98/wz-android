import { isCloudflareChallengeResponse } from './cloudflareChallenge';
import {
  createDirectWebViewFallbackFetcher,
  type DirectTransportAppState,
  type DirectTransportRecoveryEvent
} from './directWebViewFallback';
import { isGoogleSiteSearchUrl } from './googleSearchFallback';
import type { Fetcher } from './request';

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

async function isLinuxDoChallenge(response: Response) {
  if (isCloudflareChallengeResponse(response)) {
    return true;
  }
  const contentType = response.headers.get('content-type') || '';
  return !response.ok && /html/i.test(contentType) && isCloudflareChallengeResponse({
    status: response.status,
    headers: response.headers,
    bodyText: await response.clone().text()
  });
}

export function createLinuxDoWebViewFallbackFetcher({
  appState,
  defaultFetcher = fetch,
  recoverNetworkConnectionPool,
  webViewFetcher
}: {
  appState?: DirectTransportAppState;
  defaultFetcher?: Fetcher;
  recoverNetworkConnectionPool?: (event: DirectTransportRecoveryEvent) => Promise<unknown> | unknown;
  webViewFetcher: Fetcher;
}): Fetcher {
  return createDirectWebViewFallbackFetcher({
    appState,
    defaultFetcher,
    directFailureStrategy: 'recover-and-retry-direct',
    inspectChallenge: isLinuxDoChallenge,
    isDirectRequestUrl: isLinuxDoRequestUrl,
    isWebViewOnlyUrl: isLinuxDoGoogleSearchUrl,
    recoverNetworkConnectionPool,
    source: 'linuxdo',
    webViewFetcher
  });
}
