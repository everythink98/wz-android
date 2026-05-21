import { describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, REQUEST_CANCELED_MESSAGE, REQUEST_TIMEOUT_MESSAGE } from './request';

describe('Android request helpers', () => {
  it('passes an abort signal to the fetcher', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));

    await fetchWithTimeout('http://127.0.0.1:3000/api/feed', { headers: { accept: 'application/json' } }, { fetcher });

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/feed', expect.objectContaining({
      headers: { accept: 'application/json' },
      signal: expect.any(AbortSignal)
    }));
  });

  it('rejects with a clear timeout message when a request exceeds the timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));

    const request = fetchWithTimeout('http://127.0.0.1:3000/api/feed', {}, { fetcher, timeoutMs: 1000 });
    const assertion = expect(request).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
    vi.useRealTimers();
  });

  it('rejects with a clear cancel message when the caller aborts the request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));

    const request = fetchWithTimeout('http://127.0.0.1:3000/api/feed', {}, { fetcher, signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
  });
});
