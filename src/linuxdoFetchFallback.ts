import {
  isCloudflareChallengeResponse
} from './linuxdoCookieBridge';
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
    if (isCloudflareChallengeResponse(response)) {
      return webViewFetcher(url, init);
    }
    const contentType = response.headers.get('content-type') || '';
    const shouldInspectBody = !response.ok && /html/i.test(contentType);
    if (shouldInspectBody && isCloudflareChallengeResponse({
      status: response.status,
      headers: response.headers,
      bodyText: await response.clone().text()
    })) {
      return webViewFetcher(url, init);
    }
    return response;
  };
}
