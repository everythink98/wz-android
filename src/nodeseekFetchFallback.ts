import type { Fetcher } from './request';
import { isGoogleSiteSearchUrl } from './googleSearchFallback';
import { isNodeSeekChallengeResponse } from './localNodeseekHelpers';

const NODESEEK_DIRECT_FETCH_TIMEOUT_MS = 8000;
const NODESEEK_DIRECT_RECOVERY_FAILURES = 2;
const NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE = 'NodeSeek direct fetch timeout';

export type NodeSeekDirectFallbackReason = 'direct-timeout' | 'direct-error';
export type NodeSeekDirectRecoveryEvent = {
  reason: NodeSeekDirectFallbackReason;
  url: string;
};

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
        reject(new Error(NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE));
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
  webViewFetcher,
  recoverNodeSeekNetwork
}: {
  defaultFetcher?: Fetcher;
  webViewFetcher: Fetcher;
  recoverNodeSeekNetwork?: (event: NodeSeekDirectRecoveryEvent) => Promise<unknown> | unknown;
}): Fetcher {
  let directFailureCount = 0;
  let recoveryInFlight = false;

  const resetDirectFailures = () => {
    directFailureCount = 0;
  };

  const scheduleRecovery = (event: NodeSeekDirectRecoveryEvent) => {
    if (!recoverNodeSeekNetwork || recoveryInFlight) {
      return;
    }
    recoveryInFlight = true;
    void Promise.resolve(recoverNodeSeekNetwork(event))
      .catch(() => undefined)
      .finally(() => {
        recoveryInFlight = false;
      });
  };

  const recordDirectFallbackSuccess = async (response: Response, reason: NodeSeekDirectFallbackReason, url: string) => {
    const text = await response.clone().text();
    if (isNodeSeekChallengeResponse(response, text, url)) {
      return response;
    }
    directFailureCount += 1;
    if (directFailureCount >= NODESEEK_DIRECT_RECOVERY_FAILURES) {
      directFailureCount = 0;
      scheduleRecovery({ reason, url });
    }
    return response;
  };

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
        const reason = error instanceof Error && error.message === NODESEEK_DIRECT_FETCH_TIMEOUT_MESSAGE
          ? 'direct-timeout'
          : 'direct-error';
        return recordDirectFallbackSuccess(await webViewFetcher(url, init), reason, url);
      }
      throw error;
    }
    const text = await response.clone().text();
    resetDirectFailures();
    if (isNodeSeekChallengeResponse(response, text, url)) {
      return webViewFetcher(url, init);
    }
    return response;
  };
}
