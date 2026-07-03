import type { Fetcher } from './request';
import { isNodeSeekChallengeResponse } from './localNodeseekHelpers';

const NODESEEK_POST_DIRECT_FETCH_TIMEOUT_MS = 8000;

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
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return (host === 'google.com' || host.endsWith('.google.com'))
      && url.pathname.replace(/\/+$/, '') === '/search'
      && (url.searchParams.get('q') || '').toLowerCase().includes('nodeseek.com');
  } catch {
    return false;
  }
}

export function isNodeSeekBrowserFetchUrl(input: string) {
  return isNodeSeekRequestUrl(input) || isNodeSeekGoogleSearchUrl(input);
}

function isNodeSeekPostUrl(input: string) {
  try {
    const url = new URL(input);
    return isNodeSeekRequestUrl(input) && /^\/post-\d+-\d+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function fetchNodeSeekPostDirectly(defaultFetcher: Fetcher, input: string, init?: RequestInit) {
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    timeout = setTimeout(() => controller.abort(), NODESEEK_POST_DIRECT_FETCH_TIMEOUT_MS);
  }
  try {
    return await defaultFetcher(input, { ...init, signal: controller.signal });
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
    if (!isNodeSeekRequestUrl(url)) {
      return defaultFetcher(input, init);
    }
    let response: Response;
    try {
      response = isNodeSeekPostUrl(url)
        ? await fetchNodeSeekPostDirectly(defaultFetcher, url, init)
        : await defaultFetcher(input, init);
    } catch (error) {
      if (isNodeSeekPostUrl(url) && !init?.signal?.aborted) {
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
