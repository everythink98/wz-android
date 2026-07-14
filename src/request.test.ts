import { describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, REQUEST_CANCELED_MESSAGE } from './request';

const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试';

describe('Android request helpers', () => {
  it('passes an abort signal to the fetcher', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));

    await fetchWithTimeout('https://example.com/feed.json', { headers: { accept: 'application/json' } }, { fetcher });

    expect(fetcher).toHaveBeenCalledWith('https://example.com/feed.json', expect.objectContaining({
      headers: { accept: 'application/json' },
      signal: expect.any(AbortSignal)
    }));
  });

  it('rejects with a clear timeout message when a request exceeds the timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));

    try {
      const request = fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, timeoutMs: 1000 });
      const assertion = expect(request).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(1000);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with a timeout even when the native fetch ignores abort', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));

    try {
      const request = fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, timeoutMs: 1000 });
      let rejectedMessage = '';
      request.catch((error: unknown) => {
        rejectedMessage = error instanceof Error ? error.message : String(error);
      });

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();

      expect(rejectedMessage).toBe(REQUEST_TIMEOUT_MESSAGE);
      await expect(request).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with a clear cancel message when the caller aborts the request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));

    const request = fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
  });

  it('rejects with a cancel message even when the native fetch ignores abort', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const request = fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
  });

  it('cleans timers and abort listeners when the fetcher throws synchronously', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as AbortSignal;
    const fetcher = vi.fn(() => {
      throw new Error('sync failure');
    });

    try {
      await expect(fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, signal, timeoutMs: 1000 })).rejects.toThrow('sync failure');

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(signal.removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
