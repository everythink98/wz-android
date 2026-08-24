import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { useAppLifecycleRuntime } from '@/app/useAppLifecycleRuntime';
import { fetchWithTimeout, RequestTimeoutError } from '@/platform/network/request';

jest.mock('@/app/useAppDeepLinkNavigation', () => ({
  useAppDeepLinkNavigation: () => jest.fn()
}));

jest.mock('@/app/useInitialForegroundRuntime', () => ({
  useInitialForegroundRuntime: () => ({
    initialForegroundReady: true,
    onCatalogSettled: jest.fn(),
    onFeedInitialContentReady: jest.fn()
  })
}));

describe('App lifecycle request timeout', () => {
  let onAppStateChange: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onAppStateChange = listener;
      return { remove: jest.fn() } as NativeEventSubscription;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('[REG-PROXY-013] counts background wall time toward the existing request deadline', async () => {
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    let outcome: 'pending' | 'timeout' | 'other' = 'pending';
    const request = fetchWithTimeout(
      'https://example.com/stalled',
      {},
      {
        fetcher: jest.fn(
          (_input: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              requestSignal = init?.signal ?? undefined;
              init?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
              });
            })
        ),
        signal: caller.signal,
        timeoutMs: 1_000
      }
    );
    void request.then(
      () => {
        outcome = 'other';
      },
      (error: unknown) => {
        outcome = error instanceof RequestTimeoutError ? 'timeout' : 'other';
      }
    );
    const runtime = await renderHook(() => useAppLifecycleRuntime());

    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(requestSignal?.aborted).toBe(false);

      await act(async () => onAppStateChange?.('background'));
      expect(requestSignal?.aborted).toBe(false);

      await act(async () => {
        jest.advanceTimersByTime(1_000);
        await Promise.resolve();
      });
      await act(async () => onAppStateChange?.('active'));

      expect(outcome).toBe('timeout');
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      caller.abort();
      runtime.unmount();
      await Promise.resolve();
    }
  });

  it('[REG-PROXY-013] keeps the original request when it completes within the wall-clock deadline', async () => {
    let requestSignal: AbortSignal | undefined;
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetcher = jest.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          requestSignal = init?.signal ?? undefined;
          resolveRequest = resolve;
        })
    );
    const runtime = await renderHook(() => useAppLifecycleRuntime());
    const request = fetchWithTimeout('https://example.com/completes-in-background', {}, { fetcher, timeoutMs: 1_000 });

    try {
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => onAppStateChange?.('background'));
      await act(async () => {
        jest.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(requestSignal?.aborted).toBe(false);
      await act(async () => resolveRequest?.(new Response('ok')));
      await expect(request).resolves.toMatchObject({ ok: true });
      await act(async () => onAppStateChange?.('active'));
      await act(async () => {
        jest.advanceTimersByTime(1_000);
        await Promise.resolve();
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(requestSignal?.aborted).toBe(false);
    } finally {
      runtime.unmount();
    }
  });
});
