import { describe, expect, it, vi } from 'vitest';
import {
  rejectBrowserFetchRequest,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  startNextBrowserFetchRequest,
  type BrowserFetchRequestCleanupTarget
} from './sessionControllerHelpers';

describe('session controller helpers', () => {
  it('settles a browser fetch request only once', () => {
    const timeout = setTimeout(() => undefined, 10_000);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const request: BrowserFetchRequestCleanupTarget & { settled?: boolean } = { timeout };
    const settle = vi.fn();

    const first = settleBrowserFetchRequestOnce(request, settle);
    const second = settleBrowserFetchRequestOnce(request, settle);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(request.timeout).toBeUndefined();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);

    clearTimeoutSpy.mockRestore();
  });

  it('removes abort listeners and handler references after settling', () => {
    const abortSignal = {
      removeEventListener: vi.fn()
    } as unknown as AbortSignal;
    const abortHandler = vi.fn();
    const request: BrowserFetchRequestCleanupTarget = { abortHandler, abortSignal };

    settleBrowserFetchRequestOnce(request, vi.fn());

    expect(abortSignal.removeEventListener).toHaveBeenCalledWith('abort', abortHandler);
    expect(request.abortHandler).toBeUndefined();
  });

  it('does not wait indefinitely for best-effort follow-up work', async () => {
    vi.useFakeTimers();
    try {
      const task = vi.fn(() => new Promise<void>(() => undefined));
      const done = runBestEffortTask(task, 100);
      let completed = false;
      void done.then(() => {
        completed = true;
      });

      await vi.advanceTimersByTimeAsync(99);
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await done;

      expect(completed).toBe(true);
      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows best-effort follow-up failures', async () => {
    await expect(runBestEffortTask(() => {
      throw new Error('persist failed');
    }, 100)).resolves.toBeUndefined();
  });

  it('starts the next non-aborted browser fetch request', () => {
    const rejected = vi.fn();
    const active = {
      id: 2,
      url: 'https://linux.do/t/1',
      reject: vi.fn()
    };
    const currentRef = { current: null };
    const queueRef = {
      current: [
        {
          id: 1,
          url: 'https://linux.do/aborted',
          abortSignal: { aborted: true },
          reject: rejected
        },
        active
      ]
    };
    const setActiveRequest = vi.fn();

    startNextBrowserFetchRequest({
      currentRef,
      queueRef,
      setActiveRequest,
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      rejectCurrent: vi.fn()
    });

    expect(rejected).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(currentRef.current).toBe(active);
    expect(setActiveRequest).toHaveBeenCalledWith({
      id: 2,
      url: 'https://linux.do/t/1',
      cookie: undefined,
      userAgent: undefined
    });
  });

  it('rejects a queued browser fetch request without touching the active request', () => {
    const active = {
      id: 1,
      url: 'https://linux.do/t/1',
      reject: vi.fn()
    };
    const queued = {
      id: 2,
      url: 'https://linux.do/t/2',
      reject: vi.fn()
    };
    const currentRef = { current: active };
    const queueRef = { current: [queued] };
    const setActiveRequest = vi.fn();
    const startNext = vi.fn();

    rejectBrowserFetchRequest({
      request: queued,
      message: '取消',
      currentRef,
      queueRef,
      setActiveRequest,
      startNext
    });

    expect(currentRef.current).toBe(active);
    expect(queueRef.current).toEqual([]);
    expect(queued.reject).toHaveBeenCalledWith(new Error('取消'));
    expect(setActiveRequest).not.toHaveBeenCalled();
    expect(startNext).toHaveBeenCalledTimes(1);
  });
});
