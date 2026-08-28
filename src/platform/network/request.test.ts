import { describe, expect, it, vi } from 'vitest';
import {
  cancelRequestTimeoutForFallback,
  fetchWithTimeout,
  rejectUnauthorizedResponse,
  RequestCanceledError,
  REQUEST_CANCELED_MESSAGE,
  RequestTimeoutError
} from './request';

const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试';

describe('Android request helpers', () => {
  it('rejects a raw HTTP 401 before adapter parsing but preserves other responses', async () => {
    const unauthorized = rejectUnauthorizedResponse(
      vi.fn(async () => new Response('<html>login</html>', { status: 401 }))
    );

    await expect(unauthorized('https://example.com/private')).rejects.toMatchObject({
      status: 401,
      reason: 'http-401'
    });

    for (const status of [403, 429]) {
      const response = new Response('<html>challenge</html>', { status });
      await expect(
        rejectUnauthorizedResponse(vi.fn(async () => response))('https://example.com/private')
      ).resolves.toBe(response);
    }
  });

  it('always enables the native read-only cookie jar without changing the request', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));

    await fetchWithTimeout(
      'https://example.com/account',
      {
        method: 'POST',
        credentials: 'include',
        headers: { Cookie: 'session=explicit' },
        body: 'payload'
      },
      { fetcher }
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/account',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { Cookie: 'session=explicit' },
        body: 'payload',
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('passes an abort signal to the fetcher', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));

    await fetchWithTimeout('https://example.com/feed.json', { headers: { accept: 'application/json' } }, { fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/feed.json',
      expect.objectContaining({
        headers: { accept: 'application/json' },
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('rejects with a clear timeout message when a request exceeds the timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );

    try {
      const request = fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, timeoutMs: 1000 });
      const assertion = expect(request).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(1000);

      await assertion;
      await expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
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
      await expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets fallback scheduling replace the outer request timeout', async () => {
    vi.useFakeTimers();
    let resolveFallback!: (response: Response) => void;
    const fetcher = vi.fn((_input: string, init?: RequestInit) => {
      cancelRequestTimeoutForFallback(init);
      return new Promise<Response>((resolve) => {
        resolveFallback = resolve;
      });
    });

    try {
      const request = fetchWithTimeout('https://example.com/feed', {}, { fetcher, timeoutMs: 1000 });
      let settled = false;
      void request.finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(2000);
      expect(settled).toBe(false);

      resolveFallback(new Response('ok'));
      await expect(request).resolves.toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with a clear cancel message when the caller aborts the request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );

    const request = fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    await expect(request).rejects.toBeInstanceOf(RequestCanceledError);
  });

  it('rejects with a cancel message even when the native fetch ignores abort', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const request = fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    await expect(request).rejects.toBeInstanceOf(RequestCanceledError);
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
      await expect(
        fetchWithTimeout('https://example.com/feed.json', {}, { fetcher, signal, timeoutMs: 1000 })
      ).rejects.toThrow('sync failure');

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(signal.removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
