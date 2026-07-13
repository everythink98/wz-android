import { isGoogleSiteSearchUrl } from './googleSearchFallback';
import { isNodeSeekChallengeResponse } from './localNodeseekHelpers';
import type { Fetcher } from './request';
import {
  createDirectWebViewFallbackFetcher,
  type DirectTransportAppState,
  type DirectTransportFallbackReason,
  type DirectTransportRecoveryEvent
} from './directWebViewFallback';

export type NodeSeekDirectFallbackReason = DirectTransportFallbackReason;
export type NodeSeekDirectRecoveryEvent = DirectTransportRecoveryEvent;

export function isNodeSeekRequestUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (host === 'nodeseek.com' || host.endsWith('.nodeseek.com'));
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

async function isNodeSeekChallenge(response: Response, url: string) {
  return isNodeSeekChallengeResponse(response, await response.clone().text(), url);
}

export function createNodeSeekWebViewFallbackFetcher({
  appState,
  defaultFetcher = fetch,
  recoverNetworkConnectionPool,
  recoverNodeSeekNetwork,
  webViewFetcher
}: {
  appState?: DirectTransportAppState;
  defaultFetcher?: Fetcher;
  recoverNetworkConnectionPool?: (event: DirectTransportRecoveryEvent) => Promise<unknown> | unknown;
  /** @deprecated Use recoverNetworkConnectionPool. */
  recoverNodeSeekNetwork?: (event: NodeSeekDirectRecoveryEvent) => Promise<unknown> | unknown;
  webViewFetcher: Fetcher;
}): Fetcher {
  return createDirectWebViewFallbackFetcher({
    appState,
    defaultFetcher,
    inspectChallenge: isNodeSeekChallenge,
    isDirectRequestUrl: isNodeSeekRequestUrl,
    isWebViewOnlyUrl: isNodeSeekGoogleSearchUrl,
    recoverNetworkConnectionPool: recoverNetworkConnectionPool || recoverNodeSeekNetwork,
    source: 'nodeseek',
    webViewFetcher
  });
}
