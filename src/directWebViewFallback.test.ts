import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDirectRecoveryFetcher, type DirectTransportSource } from './directWebViewFallback';
import { createLinuxDoWebViewFallbackFetcher } from './linuxdoFetchFallback';
import { createNodeSeekWebViewFallbackFetcher } from './nodeseekFetchFallback';
import type { Fetcher } from './request';

function ok() {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}

function stalled(init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
}

describe('generic direct transport recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each<DirectTransportSource>(['yaohuo', 'v2ex'])(
    'recovers and retries one %s read directly after eight seconds',
    async (source) => {
      let calls = 0;
      const defaultFetcher = vi.fn((_input: string, init?: RequestInit) => {
        calls += 1;
        return calls === 1 ? stalled(init) : Promise.resolve(ok());
      });
      const recoverNetworkConnectionPool = vi.fn(async () => undefined);
      const fetcher = createDirectRecoveryFetcher({
        defaultFetcher,
        isDirectRequestUrl: () => true,
        recoverNetworkConnectionPool,
        source
      });

      const request = fetcher(`https://${source}.example/read`);
      await vi.advanceTimersByTimeAsync(8_000);

      await expect(request).resolves.toBeInstanceOf(Response);
      expect(defaultFetcher).toHaveBeenCalledTimes(2);
      expect(recoverNetworkConnectionPool).toHaveBeenCalledWith(expect.objectContaining({
        source,
        reason: 'direct-timeout'
      }));
    }
  );

  it.each([
    {
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/api/account/credit',
      create: (defaultFetcher: Fetcher, recoverNetworkConnectionPool: () => Promise<void>, webViewFetcher: Fetcher) => (
        createNodeSeekWebViewFallbackFetcher({ defaultFetcher, recoverNetworkConnectionPool, webViewFetcher })
      )
    },
    {
      source: 'linuxdo',
      url: 'https://linux.do/posts',
      create: (defaultFetcher: Fetcher, recoverNetworkConnectionPool: () => Promise<void>, webViewFetcher: Fetcher) => (
        createLinuxDoWebViewFallbackFetcher({ defaultFetcher, recoverNetworkConnectionPool, webViewFetcher })
      )
    },
    ...(['v2ex', 'yaohuo'] as const).map((source) => ({
      source,
      url: `https://${source}.example/write`,
      create: (defaultFetcher: Fetcher, recoverNetworkConnectionPool: () => Promise<void>, _webViewFetcher: Fetcher) => createDirectRecoveryFetcher({
        defaultFetcher,
        isDirectRequestUrl: () => true,
        recoverNetworkConnectionPool,
        source
      })
    }))
  ])('$source non-read methods use the raw direct transport exactly once', async ({ create, url }) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const defaultFetcher = vi.fn(async () => { throw new TypeError('Network request failed'); });
      const recoverNetworkConnectionPool = vi.fn(async () => undefined);
      const webViewFetcher = vi.fn(async () => ok());
      const fetcher = create(defaultFetcher, recoverNetworkConnectionPool, webViewFetcher);

      await expect(fetcher(url, { method })).rejects.toThrow('Network request failed');
      expect(defaultFetcher).toHaveBeenCalledTimes(1);
      expect(recoverNetworkConnectionPool).not.toHaveBeenCalled();
      expect(webViewFetcher).not.toHaveBeenCalled();
    }
  });

  it('does not treat an HTTP error as a broken transport', async () => {
    const defaultFetcher = vi.fn(async () => new Response('verification required', { status: 403 }));
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const fetcher = createDirectRecoveryFetcher({
      defaultFetcher,
      isDirectRequestUrl: () => true,
      recoverNetworkConnectionPool,
      source: 'yaohuo'
    });

    await expect(fetcher('https://www.yaohuo.me/read')).resolves.toMatchObject({ status: 403 });
    expect(defaultFetcher).toHaveBeenCalledTimes(1);
    expect(recoverNetworkConnectionPool).not.toHaveBeenCalled();
  });
});
