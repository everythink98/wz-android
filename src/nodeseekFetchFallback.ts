import type { Fetcher } from './request';
import { isGoogleSiteSearchUrl } from './googleSearchFallback';
import { isNodeSeekChallengeResponse } from './localNodeseekHelpers';

const NODESEEK_DIRECT_FETCH_TIMEOUT_MS = 8000;

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

async function fetchNodeSeekDirectly(defaultFetcher: Fetcher, input: string, init?: RequestInit) {
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutPromise: Promise<never> | undefined;
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('NodeSeek direct fetch timeout'));
      }, NODESEEK_DIRECT_FETCH_TIMEOUT_MS);
    });
  }
  try {
    const fetchPromise = defaultFetcher(input, { ...init, signal: controller.signal });
    return await (timeoutPromise ? Promise.race([fetchPromise, timeoutPromise]) : fetchPromise);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

export function createNodeSeekWebViewFallbackFetcher({
  defaultFetcher = fetch,
  webViewFetcher
}: {
  defaultFetcher?: Fetcher;
  webViewFetcher: Fetcher;
}): Fetcher {
  return async (input, init) => {
    const url = String(input);
    if (isNodeSeekGoogleSearchUrl(url)) {
      return webViewFetcher(url, init);
    }
    if (!isNodeSeekRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    let response: Response;
    try {
      response = await fetchNodeSeekDirectly(defaultFetcher, url, init);
    } catch (error) {
      if (!init?.signal?.aborted) {
        return webViewFetcher(url, init);
      }
      throw error;
    }
    const text = await response.clone().text();
    if (isNodeSeekChallengeResponse(response, text, url)) {
      return webViewFetcher(url, init);
    }
    return response;
  };
}
