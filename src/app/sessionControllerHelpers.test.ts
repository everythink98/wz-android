import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { effect(); },
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let current = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [current, (next: T | ((value: T) => T)) => {
      current = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
    }];
  }
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    clearByName: vi.fn(),
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    setFromResponse: vi.fn(async () => true)
  }
}));
vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined)
}));
vi.mock('react-native', () => ({ NativeModules: { LinuxDoCookieModule: {} } }));
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  enqueueCredentialWrite,
  enqueueLatestBrowserFetchRequest,
  isCredentialWriteCurrent,
  nodeSeekBrowserResponse,
  preemptActiveBrowserFetchRequest,
  replaceCredentialWrite,
  rejectBrowserFetchRequest,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  shouldHandleBrowserHttpError,
  shouldKeepQueuedBrowserFetchRequest,
  shouldPreemptBrowserFetchRequest,
  startNextBrowserFetchRequest,
  takeNodeSeekVerificationRetry,
  type BrowserFetchQueueRequest,
  type BrowserFetchRequestCleanupTarget
} from './sessionControllerHelpers';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from '../diagnostics';
import type { Fetcher } from '../request';
import { useSessionController } from './useSessionController';

afterEach(() => {
  setDiagnosticWriter(null);
});

function createTestSessionController(defaultFetcher: Fetcher = vi.fn(), setWebLoginUserId = vi.fn()) {
  return useSessionController({
    defaultFetcher,
    linuxDoBrowserWebViewRef: { current: null },
    linuxDoClearanceBeforeVerifyRef: { current: null },
    linuxDoWebViewCookieHeaderRef: { current: '' },
    linuxDoWebViewUserAgentRef: { current: '' },
    nodeSeekBrowserWebViewRef: { current: null },
    nodeSeekWebViewCookieHeaderRef: { current: '' },
    nodeSeekWebViewUserAgentRef: { current: '' },
    notify: vi.fn(),
    setLinuxDoWebViewCookieHeader: vi.fn(),
    setLinuxDoWebViewUserAgent: vi.fn(),
    setNodeSeekWebViewUserAgent: vi.fn(),
    setWebLoginUserId,
    webLoginDetectedRef: { current: false }
  });
}

describe('session controller helpers', () => {
  it('records a session transition without cookie facts or raw errors', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();

    controller.dispatchSiteSessionEvent({
      site: 'nodeseek',
      type: 'verification-required',
      message: 'private cookie=secret raw error'
    });

    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'state-transition');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'nodeseek', eventType: 'verification-required' }),
      expect.objectContaining({
        phase: 'apply',
        previousState: 'anonymous',
        nextState: 'verification-required',
        hasCredential: false
      }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', state: 'verification-required' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/private|cookie|secret|raw error/);
  });

  it('invalidates only definitive non-login NodeSeek identity transitions', () => {
    const setWebLoginUserId = vi.fn();
    const controller = createTestSessionController(vi.fn(), setWebLoginUserId);

    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'check-failed', message: 'offline' });
    expect(setWebLoginUserId).not.toHaveBeenCalled();

    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'login-expired' });
    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'cookie-loaded', loggedIn: false });
    controller.dispatchSiteSessionEvent({ site: 'nodeseek', type: 'verification-succeeded', loggedIn: false, at: '2026-07-10T00:00:00.000Z' });
    expect(setWebLoginUserId).toHaveBeenCalledTimes(3);
    expect(setWebLoginUserId).toHaveBeenNthCalledWith(1, null);
  });

  it('records an externally superseded credential save as stale without a generation argument', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();

    await controller.saveNodeSeekCookieHeader({
      session: { name: 'session', value: 'private-cookie-value' }
    }, { isCurrent: () => false });

    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ area, operation, source }) => area === 'credential' && operation === 'save' && source === 'nodeseek');
    expect(events.at(-1)).toMatchObject({ phase: 'finish', outcome: 'stale', reason: 'stale' });
    expect(JSON.stringify(events)).not.toMatch(/private-cookie-value|session=/);
  });

  it('records WebView credential restore and clear with one terminal event each', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController();

    await controller.restoreSavedYaohuoCookiesToWebView();
    await controller.clearNodeSeekLoginState();

    const events = lines.map((line) => JSON.parse(line));
    for (const operation of ['restore-webview', 'clear']) {
      const operationEvents = events.filter((event) => event.operation === operation);
      expect(operationEvents[0]).toMatchObject({ phase: 'intent' });
      expect(operationEvents.filter((event) => event.phase === 'finish')).toHaveLength(1);
      expect(operationEvents.at(-1)).toMatchObject({ outcome: 'success' });
    }
    expect(JSON.stringify(events.filter((event) => ['restore-webview', 'clear'].includes(event.operation))))
      .not.toMatch(/cookieHeader|private|session=/);
  });

  it('keeps a hidden WebView request trace safe from URL, HTML, and cookie data', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html>private challenge body</html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const url = 'https://www.nodeseek.com/post-private-query-1';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => {
      expect(lines.some((line) => {
        const event = JSON.parse(line);
        return event.area === 'webview' && event.operation === 'browser-fetch';
      })).toBe(true);
    });
    await controller.completeNodeSeekBrowserFetch({
      id: 1,
      url,
      html: '<html>private rendered body</html>',
      cookie: 'session=private-cookie'
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);

    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ area, operation }) => area === 'webview' && operation === 'browser-fetch');
    expect(events.map(({ phase }) => phase)).toEqual(['intent', 'guard', 'transport', 'parse', 'finish']);
    expect(events.at(-2)).toMatchObject({
      channel: 'webview',
      status: 200,
      hasCredential: true,
      isChallenge: false
    });
    expect(events.at(-1)).toMatchObject({ outcome: 'success' });
    expect(JSON.stringify(events)).not.toMatch(/private-query|rendered body|private-cookie|google\.com|nodeseek\.com|session=/);
  });

  it('keeps the hidden WebView queue on its caller trace without an early terminal event', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const trace = beginDiagnosticTrace('topic', 'open');
    const fetcher = withDiagnosticFetcher(trace, controller.forumFetchWithWebViewFallback);
    const url = 'https://www.nodeseek.com/post-private-query-2';

    const responsePromise = fetcher(url, {});
    await vi.waitFor(() => {
      expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true);
    });
    expect(lines.map((line) => JSON.parse(line)).filter((event) => event.traceId === trace.traceId && event.phase === 'finish')).toHaveLength(0);

    await controller.completeNodeSeekBrowserFetch({
      id: 1,
      url,
      html: '<html>private rendered body</html>',
      cookie: 'session=private-cookie'
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);
    expect(lines.map((line) => JSON.parse(line)).filter((event) => event.traceId === trace.traceId && event.phase === 'finish')).toHaveLength(0);

    finishDiagnosticTrace(trace, 'success');
    const events = lines.map((line) => JSON.parse(line)).filter((event) => event.traceId === trace.traceId);
    expect(new Set(events.map((event) => event.traceId))).toEqual(new Set([trace.traceId]));
    expect(events.filter(({ phase }) => phase === 'intent')).toHaveLength(1);
    expect(events.filter(({ phase }) => phase === 'finish')).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'guard', channel: 'webview', state: 'queued' }),
      expect.objectContaining({ phase: 'parse', channel: 'webview', status: 200 })
    ]));
  });

  it('rejects a confirmed linux.do WebView challenge as a typed verification error', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response(
      '<html><div class="cf-turnstile"></div></html>',
      { status: 429, headers: { 'cf-mitigated': 'challenge' } }
    )));
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => {
      expect(lines.some((line) => {
        const event = JSON.parse(line);
        return event.source === 'linuxdo' && event.channel === 'webview' && event.state === 'queued';
      })).toBe(true);
    });
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      challenge: true
    });

    await expect(responsePromise).rejects.toMatchObject({
      source: 'linuxdo',
      reason: 'cloudflare',
      verificationRequired: true
    });
  });

  it('keeps an oversized linux.do WebView body as an explicit transport failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    })));
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      challenge: false,
      error: 'linux.do 页面内容过大，已停止读取',
      failureReason: 'content-too-large'
    });

    await expect(responsePromise).rejects.toMatchObject({
      reason: 'content-too-large',
      message: 'linux.do 页面内容过大，已停止读取'
    });
  });

  it('records hidden linux.do cookie persistence as cookie-loaded, not verification success', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = createTestSessionController(vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    })));
    const url = 'https://linux.do/latest.json';

    const responsePromise = controller.forumFetchWithWebViewFallback(url);
    await vi.waitFor(() => expect(lines.some((line) => JSON.parse(line).state === 'queued')).toBe(true));
    await controller.completeLinuxDoBrowserFetch({
      id: 1,
      url,
      body: '{"topic_list":{"topics":[]}}',
      challenge: false,
      cookie: 'cf_clearance=private-value'
    });
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });

    await vi.waitFor(() => expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'state-transition' && event.eventType === 'cookie-loaded';
    })).toBe(true));
    expect(lines.some((line) => {
      const event = JSON.parse(line);
      return event.operation === 'state-transition' && event.eventType === 'verification-succeeded';
    })).toBe(false);
  });

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

  it('preempts an active background browser fetch with a foreground request', () => {
    const active: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const incoming: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/post-2-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };
    const currentRef: { current: BrowserFetchQueueRequest | null } = { current: active };
    const rejectCurrent = vi.fn((request: BrowserFetchQueueRequest) => {
      if (currentRef.current?.id === request.id) {
        currentRef.current = null;
      }
    });

    const preempted = preemptActiveBrowserFetchRequest({
      currentRef,
      request: incoming,
      message: '请求已被新的前台读取替换',
      rejectCurrent
    });

    expect(preempted).toBe(true);
    expect(rejectCurrent).toHaveBeenCalledWith(active, '请求已被新的前台读取替换');
    expect(currentRef.current).toBeNull();
  });

  it('starts the incoming foreground request instead of a stale queued read after preemption', () => {
    const active: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const staleQueuedRead: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/page-2',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const incoming: BrowserFetchQueueRequest = {
      id: 3,
      url: 'https://www.nodeseek.com/post-3-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };
    const currentRef = { current: active };
    const queueRef = { current: [staleQueuedRead] };
    const setActiveRequest = vi.fn();
    const rejectCurrent = (request: BrowserFetchQueueRequest, message: string) => {
      rejectBrowserFetchRequest({
        request,
        message,
        currentRef,
        queueRef,
        setActiveRequest,
        startNext: () => startNextBrowserFetchRequest({
          currentRef,
          queueRef,
          setActiveRequest,
          timeoutMs: 15000,
          timeoutMessage: 'timeout',
          rejectCurrent: vi.fn()
        })
      });
    };

    enqueueLatestBrowserFetchRequest({
      queueRef,
      request: incoming,
      message: '请求已取消',
      shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
    });
    preemptActiveBrowserFetchRequest({
      currentRef,
      request: incoming,
      message: '请求已被新的前台读取替换',
      rejectCurrent
    });

    expect(staleQueuedRead.reject).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(active.reject).toHaveBeenCalledWith(new Error('请求已被新的前台读取替换'));
    expect(currentRef.current).toBe(incoming);
    expect(setActiveRequest).toHaveBeenLastCalledWith({
      id: 3,
      url: 'https://www.nodeseek.com/post-3-1',
      cookie: undefined,
      userAgent: undefined
    });
  });

  it('does not let ordinary reads preempt a NodeSeek write request', () => {
    const writeRequest: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/api/comment/reply',
      browserFetchIntent: { owner: 'write', priority: 'write', cancelable: false },
      reject: vi.fn()
    };
    const foregroundRead: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/post-2-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };

    expect(shouldPreemptBrowserFetchRequest(writeRequest, foregroundRead)).toBe(false);
  });

  it('keeps queued NodeSeek writes when a newer read request replaces stale reads', () => {
    const queuedWrite: BrowserFetchQueueRequest = {
      id: 1,
      url: 'https://www.nodeseek.com/api/comment/reply',
      browserFetchIntent: { owner: 'write', priority: 'write', cancelable: false },
      reject: vi.fn()
    };
    const staleRead: BrowserFetchQueueRequest = {
      id: 2,
      url: 'https://www.nodeseek.com/',
      browserFetchIntent: { owner: 'feed', priority: 'background', cancelable: true },
      reject: vi.fn()
    };
    const latestRead: BrowserFetchQueueRequest = {
      id: 3,
      url: 'https://www.nodeseek.com/post-3-1',
      browserFetchIntent: { owner: 'topic', priority: 'foreground', cancelable: true },
      reject: vi.fn()
    };
    const queueRef = { current: [queuedWrite, staleRead] };

    enqueueLatestBrowserFetchRequest({
      queueRef,
      request: latestRead,
      message: '请求已取消',
      shouldKeepQueuedRequest: shouldKeepQueuedBrowserFetchRequest
    });

    expect(queueRef.current).toEqual([queuedWrite, latestRead]);
    expect(queuedWrite.reject).not.toHaveBeenCalled();
    expect(staleRead.reject).toHaveBeenCalledWith(new Error('请求已取消'));
    expect(latestRead.reject).not.toHaveBeenCalled();
  });

  it('releases the queued browser fetch after a renderer crash rejects the active one', () => {
    vi.useFakeTimers();
    try {
      const active: BrowserFetchQueueRequest = {
        id: 1,
        url: 'https://www.nodeseek.com/post-1-1',
        reject: vi.fn()
      };
      const queued: BrowserFetchQueueRequest = {
        id: 2,
        url: 'https://www.nodeseek.com/post-2-1',
        reject: vi.fn()
      };
      const currentRef = { current: active };
      const queueRef = { current: [queued] };
      const setActiveRequest = vi.fn();
      const rejectCurrent = vi.fn((request: BrowserFetchQueueRequest, message: string) => {
        request.reject(new Error(message));
      });
      const startNext = () => startNextBrowserFetchRequest({
        currentRef,
        queueRef,
        setActiveRequest,
        timeoutMs: 15000,
        timeoutMessage: 'timeout',
        rejectCurrent
      });
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
      expect(active.reject).toHaveBeenCalledWith(new Error('NodeSeek 页面读取进程已停止'));
      expect(currentRef.current).toBe(queued);
      expect(queueRef.current).toEqual([]);
      expect(setActiveRequest).toHaveBeenLastCalledWith({
        id: 2,
        url: 'https://www.nodeseek.com/post-2-1',
        cookie: undefined,
        userAgent: undefined
      });
    } finally {
      vi.useRealTimers();
    }
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
    const refreshSource = readFileSync(path.join(process.cwd(), 'src/app/useAccountStatusController.ts'), 'utf8');

    expect(appRootSource).toContain('refreshAccountStatus({ silent: true })');
    expect(appRootSource).not.toContain('nodeSeekUserId: webLoginUserId');
    expect(refreshSource).toContain('captureNodeSeekUserId');
    expect(refreshSource).toContain('nodeSeekUserId: nodeSeekCredentialUserId');
  });
});
