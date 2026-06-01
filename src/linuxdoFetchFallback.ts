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

function responseFromConsumedBody(response: Response, bodyText: string) {
  if (typeof Response !== 'undefined') {
    return new Response(bodyText, {
      status: response.status,
      headers: response.headers
    });
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: () => Promise.resolve(bodyText)
  } as Response;
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
    const text = await response.text();
    if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
      return webViewFetcher(url, init);
    }
    return responseFromConsumedBody(response, text);
  };
}
