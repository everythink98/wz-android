import type { Fetcher } from './request';

export function isNodeSeekRequestUrl(input: string) {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === 'nodeseek.com' || host.endsWith('.nodeseek.com');
  } catch {
    return false;
  }
}

function isNodeSeekSearchUrl(input: string) {
  try {
    const url = new URL(input);
    return isNodeSeekRequestUrl(input) && url.pathname.replace(/\/+$/, '') === '/search';
  } catch {
    return false;
  }
}

function isNodeSeekCloudflareResponse(response: Response, bodyText: string) {
  return response.headers.get('cf-mitigated') === 'challenge'
    || /cf-turnstile|challenge-platform/i.test(bodyText)
    || /<title>\s*(?:just a moment|请稍候)/i.test(bodyText)
    || /正在进行安全验证|安全服务防护恶意自动程序/i.test(bodyText)
    || (response.status === 403 && /just a moment|cloudflare|请稍候/i.test(bodyText));
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

export function createNodeSeekWebViewFallbackFetcher({
  defaultFetcher = fetch,
  webViewFetcher
}: {
  defaultFetcher?: Fetcher;
  webViewFetcher: Fetcher;
}): Fetcher {
  return async (input, init) => {
    const url = String(input);
    if (isNodeSeekSearchUrl(url)) {
      return webViewFetcher(url, init);
    }
    const response = await defaultFetcher(input, init);
    if (!isNodeSeekRequestUrl(url)) {
      return response;
    }
    const text = await response.text();
    if (isNodeSeekCloudflareResponse(response, text)) {
      return webViewFetcher(url, init);
    }
    return responseFromConsumedBody(response, text);
  };
}
