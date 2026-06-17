import {
  isCloudflareChallengeResponse
} from './linuxdoCookieBridge';
import type { Fetcher } from './request';

export function isLinuxDoRequestUrl(input: string) {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === 'linux.do' || host.endsWith('.linux.do');
  } catch {
    return false;
  }
}

export function createLinuxDoWebViewFallbackFetcher({
  defaultFetcher = fetch,
  webViewFetcher
}: {
  defaultFetcher?: Fetcher;
  webViewFetcher: Fetcher;
}): Fetcher {
  return async (input, init) => {
    const url = String(input);
    const response = await defaultFetcher(input, init);
    if (!isLinuxDoRequestUrl(url)) {
      return response;
    }
    const text = await response.clone().text();
    if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
      return webViewFetcher(url, init);
    }
    return response;
  };
}
