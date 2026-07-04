import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  enqueueCredentialWrite,
  enqueueLatestBrowserFetchRequest,
  isCredentialWriteCurrent,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  replaceCredentialWrite,
  rejectBrowserFetchRequest,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  shouldHandleBrowserHttpError,
  startNextBrowserFetchRequest,
  takeNodeSeekVerificationRetry,
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

  it('runs credential writes in order for the same generation', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];

    await Promise.all([
      enqueueCredentialWrite(gate, async () => {
        writes.push('first');
      }),
      enqueueCredentialWrite(gate, async () => {
        writes.push('second');
      })
    ]);

    expect(writes).toEqual(['first', 'second']);
  });

  it('invalidates stale credential writes after a clear generation starts', async () => {
    const gate = createCredentialWriteGate();
    const releaseFirstWrite = Promise.withResolvers<void>();
    const writes: string[] = [];
    const staleGeneration = gate.generation;
    const firstWrite = enqueueCredentialWrite(gate, async ({ isCurrent }) => {
      await releaseFirstWrite.promise;
      if (isCurrent()) {
        writes.push('stale-save');
      }
    });

    const clearWrite = enqueueCredentialWrite(gate, async () => {
      writes.push('clear');
    }, { advanceGeneration: true });

    expect(isCredentialWriteCurrent(gate, staleGeneration)).toBe(false);
    releaseFirstWrite.resolve();
    await Promise.all([firstWrite, clearWrite]);

    expect(writes).toEqual(['clear']);
  });

  it('does not let async work started before a clear enqueue a fresh credential write later', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];
    const staleGeneration = gate.generation;

    advanceCredentialWriteGeneration(gate);
    await enqueueCredentialWriteForGeneration(gate, staleGeneration, () => {
      writes.push('stale-save');
    });

    expect(writes).toEqual([]);
  });

  it('skips conditional clears after a newer credential generation exists', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];
    const staleGeneration = gate.generation;

    await enqueueCredentialWrite(gate, () => {
      writes.push('new-save');
    }, { advanceGeneration: true });
    await enqueueCredentialWriteForGeneration(gate, staleGeneration, () => {
      writes.push('stale-clear');
    });

    expect(writes).toEqual(['new-save']);
  });

  it('advances credential generation when replacing credentials', async () => {
    const gate = createCredentialWriteGate();
    const writes: string[] = [];
    const staleGeneration = gate.generation;

    await replaceCredentialWrite(gate, () => {
      writes.push('new-login');
    });
    await enqueueCredentialWriteForGeneration(gate, staleGeneration, () => {
      writes.push('stale-clear');
    });

    expect(writes).toEqual(['new-login']);
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

  it('starts browser fetch timeout after a queued request becomes active', async () => {
    vi.useFakeTimers();
    try {
      const queued = {
        id: 1,
        url: 'https://www.nodeseek.com/post-1-1',
        deadlineMs: Date.now() - 1,
        reject: vi.fn()
      };
      const currentRef = { current: null };
      const queueRef = { current: [queued] };
      const setActiveRequest = vi.fn();
      const rejectCurrent = vi.fn((request: typeof queued, message: string) => {
        request.reject(new Error(message));
      });

      startNextBrowserFetchRequest({
        currentRef,
        queueRef,
        setActiveRequest,
        timeoutMs: 15000,
        timeoutMessage: 'timeout',
        rejectCurrent
      });

      expect(currentRef.current).toBe(queued);
      expect(queued.reject).not.toHaveBeenCalled();
      expect(setActiveRequest).toHaveBeenCalledWith({
        id: 1,
        url: 'https://www.nodeseek.com/post-1-1',
        cookie: undefined,
        userAgent: undefined
      });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(rejectCurrent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(rejectCurrent).toHaveBeenCalledWith(queued, 'timeout');
      expect(queued.reject).toHaveBeenCalledWith(new Error('timeout'));
    } finally {
      vi.useRealTimers();
    }
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

  it('can reject an active browser fetch request without stopping a gone WebView renderer', () => {
    const active = {
      id: 1,
      url: 'https://www.nodeseek.com/post-1-1',
      reject: vi.fn()
    };
    const currentRef = { current: active };
    const queueRef = { current: [] };
    const setActiveRequest = vi.fn();
    const startNext = vi.fn();
    const webViewRef = { current: { stopLoading: vi.fn() } };

    rejectBrowserFetchRequest({
      request: active,
      message: 'NodeSeek 页面读取进程已停止',
      currentRef,
      queueRef,
      setActiveRequest,
      startNext,
      webViewRef,
      skipStopLoading: true
    });

    expect(webViewRef.current.stopLoading).not.toHaveBeenCalled();
    expect(currentRef.current).toBeNull();
    expect(active.reject).toHaveBeenCalledTimes(1);
    expect(active.reject).toHaveBeenCalledWith(new Error('NodeSeek 页面读取进程已停止'));
    expect(setActiveRequest).toHaveBeenCalledWith(null);
    expect(startNext).toHaveBeenCalledTimes(1);
  });

  it('keeps only the latest queued browser fetch request', () => {
    const first = {
      id: 1,
      url: 'https://linux.do/t/1',
      reject: vi.fn()
    };
    const second = {
      id: 2,
      url: 'https://linux.do/t/2',
      reject: vi.fn()
    };
    const latest = {
      id: 3,
      url: 'https://linux.do/t/3',
      reject: vi.fn()
    };
    const queueRef = { current: [first, second] };

    enqueueLatestBrowserFetchRequest({
      queueRef,
      request: latest,
      message: '请求已取消'
    });

    expect(queueRef.current).toEqual([latest]);
    expect(first.reject).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(second.reject).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(latest.reject).not.toHaveBeenCalled();
  });

  it('clears browser challenge response bodies even if a script sends page HTML', async () => {
    await expect(nodeSeekBrowserResponse('<html>challenge</html>', true).text()).resolves.toBe('');
    await expect(linuxDoBrowserResponse('<html>challenge</html>', true).text()).resolves.toBe('');
  });

  it('takes a pending NodeSeek topic verification retry only once', () => {
    const topic = { source: 'nodeseek' as const, id: '42' };
    const searchRetryRef = { current: null };
    const topicRetryRef = { current: topic };

    expect(takeNodeSeekVerificationRetry(searchRetryRef, topicRetryRef)).toEqual({
      type: 'topic',
      topic
    });
    expect(takeNodeSeekVerificationRetry(searchRetryRef, topicRetryRef)).toBeNull();
  });

  it('keeps existing NodeSeek search verification retry ahead of topic retry', () => {
    const retry = vi.fn();
    const topic = { source: 'nodeseek' as const, id: '42' };
    const searchRetryRef = { current: retry };
    const topicRetryRef = { current: topic };

    expect(takeNodeSeekVerificationRetry(searchRetryRef, topicRetryRef)).toEqual({
      type: 'search',
      retry
    });
    expect(searchRetryRef.current).toBeNull();
    expect(topicRetryRef.current).toBeNull();
  });

  it('handles document HTTP errors after allowed redirects', () => {
    const isAllowed = (url: string) => new URL(url).hostname.endsWith('nodeseek.com');

    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://www.nodeseek.com/post-1-1/',
      isAllowed
    )).toBe(true);
    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://www.nodeseek.com/login',
      isAllowed
    )).toBe(true);
  });

  it('ignores off-site and static resource HTTP errors in hidden browser pages', () => {
    const isAllowed = (url: string) => new URL(url).hostname.endsWith('nodeseek.com');

    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://example.com/login',
      isAllowed
    )).toBe(false);
    expect(shouldHandleBrowserHttpError(
      'https://www.nodeseek.com/post-1-1',
      'https://www.nodeseek.com/assets/missing.png',
      isAllowed
    )).toBe(false);
  });

  it('does not read the current NodeSeek profile while loading credentials', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/useSessionController.ts'), 'utf8');

    expect(source).not.toContain('getNodeSeekCurrentUserProfile');
    expect(source).not.toContain('restoreNodeSeekIdentityForAccess');
  });

  it('starts account refresh silently without using stale NodeSeek page state', () => {
    const appRootSource = readFileSync(path.join(process.cwd(), 'src/app/AppRoot.tsx'), 'utf8');
    const refreshSource = readFileSync(path.join(process.cwd(), 'src/app/useBackupStatusController.ts'), 'utf8');

    expect(appRootSource).toContain('refreshAccountStatus({ silent: true })');
    expect(appRootSource).not.toContain('nodeSeekUserId: webLoginUserId');
    expect(refreshSource).toContain('captureNodeSeekUserId');
    expect(refreshSource).toContain('nodeSeekUserId: nodeSeekCredentialUserId');
  });
});
