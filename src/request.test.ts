import { describe, expect, it, vi } from 'vitest';
import {
  fetchWithTimeout,
  REQUEST_CANCELED_MESSAGE,
  REQUEST_SUPERSEDED_MESSAGE,
  REQUEST_TIMEOUT_MESSAGE,
  withOperationDeadline
} from './request';


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

  it('does not call the fetcher when its signal is already canceled', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => new Response('{}'));
    controller.abort();

    await expect(fetchWithTimeout('https://example.com/feed.json', {}, {
      fetcher,
      signal: controller.signal
    })).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    expect(fetcher).not.toHaveBeenCalled();
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

  it('bounds a whole multi-stage operation instead of restarting the budget for each request', async () => {
    vi.useFakeTimers();
    const stages: AbortSignal[] = [];

    try {
      const operation = withOperationDeadline(async (signal) => {
        stages.push(signal);
        await new Promise<void>((resolve) => setTimeout(resolve, 700));
        stages.push(signal);
        await new Promise<void>(() => undefined);
        return 'late';
      }, { timeoutMs: 1000 });

      await vi.advanceTimersByTimeAsync(999);
      expect(stages).toHaveLength(2);
      expect(stages[0]?.aborted).toBe(false);

      const assertion = expect(operation).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(1);

      await assertion;
      expect(stages[0]?.aborted).toBe(true);
      expect(stages[1]).toBe(stages[0]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps caller cancellation distinct from an operation deadline', async () => {
    const controller = new AbortController();
    let childSignal: AbortSignal | undefined;
    const operation = withOperationDeadline(async (signal) => {
      childSignal = signal;
      return new Promise<never>(() => undefined);
    }, { signal: controller.signal, timeoutMs: 30_000 });

    await Promise.resolve();
    controller.abort();

    await expect(operation).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    expect(childSignal?.aborted).toBe(true);
  });

  it('does not start an operation when its caller is already canceled', async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => 'unexpected');
    controller.abort();

    await expect(withOperationDeadline(operation, {
      signal: controller.signal,
      timeoutMs: 1000
    })).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    expect(operation).not.toHaveBeenCalled();
  });

  it('does not rewrite a superseded operation as a cancellation', async () => {
    await expect(withOperationDeadline(async () => {
      throw new Error(REQUEST_SUPERSEDED_MESSAGE);
    }, { timeoutMs: 1000 })).rejects.toThrow(REQUEST_SUPERSEDED_MESSAGE);
  });

  it('counts only foreground-active time toward an operation deadline', async () => {
    vi.useFakeTimers();
    type AppStateStatus = 'active' | 'background' | 'extension' | 'inactive' | 'unknown';
    const listeners = new Set<(state: AppStateStatus) => void>();
    const appState = {
      currentState: 'active' as AppStateStatus | null,
      addEventListener: vi.fn((_event: 'change', listener: (state: AppStateStatus) => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      })
    };
    const emit = (state: AppStateStatus) => {
      appState.currentState = state;
      for (const listener of [...listeners]) listener(state);
    };

    try {
      let settled = false;
      const outcome = withOperationDeadline(async () => new Promise<never>(() => undefined), {
        appState,
        timeoutMs: 1000
      }).finally(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(400);
      emit('background');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(false);

      emit('active');
      await vi.advanceTimersByTimeAsync(599);
      expect(settled).toBe(false);
      const assertion = expect(outcome).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(listeners).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
