import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueBrowserFetchRequest,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  rejectBrowserFetchRequest,
  requestHeaderValue,
  settleBrowserFetchRequestOnce,
  shouldHandleBrowserHttpError,
  startNextBrowserFetchRequest,
  type BrowserFetchQueueRequest
} from './browserFetchQueue';

const ref = <T>(current: T) => ({ current });

function createRequest(id: number, overrides: Partial<BrowserFetchQueueRequest> = {}): BrowserFetchQueueRequest {
  return {
    id,
    url: `https://linux.do/request/${id}`,
    reject: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('browser fetch queue', () => {
  it('reads request headers case-insensitively across supported shapes', () => {
    expect(requestHeaderValue({ Cookie: 'a=1' }, 'cookie')).toBe('a=1');
    expect(requestHeaderValue([['USER-AGENT', 'agent']], 'user-agent')).toBe('agent');
    expect(requestHeaderValue(new Headers({ Accept: 'text/html' }), 'accept')).toBe('text/html');
    expect(requestHeaderValue(undefined, 'accept')).toBeUndefined();
  });

  it('removes a challenge body and marks the response explicitly', async () => {
    const response = nodeSeekBrowserResponse('<html>private page</html>', true);

    expect(response.status).toBe(403);
    expect(response.headers.get('cf-mitigated')).toBe('challenge');
    await expect(response.text()).resolves.toBe('');
  });

  it('classifies linux.do browser responses by body type', () => {
    expect(linuxDoBrowserResponse('{"ok":true}').headers.get('content-type')).toBe('application/json');
    expect(linuxDoBrowserResponse('<html></html>').headers.get('content-type')).toBe('text/html');
    expect(linuxDoBrowserResponse('{}', 503).status).toBe(503);
  });

  it('handles document errors but ignores static resources and off-site frames', () => {
    const allowed = (url: string) => new URL(url).hostname === 'linux.do';

    expect(shouldHandleBrowserHttpError('https://linux.do/t/42', 'https://linux.do/t/42/', allowed)).toBe(true);
    expect(shouldHandleBrowserHttpError('https://linux.do/t/42', 'https://linux.do/latest', allowed)).toBe(true);
    expect(shouldHandleBrowserHttpError('https://linux.do/t/42', 'https://linux.do/assets/app.js', allowed)).toBe(
      false
    );
    expect(shouldHandleBrowserHttpError('https://linux.do/t/42', 'https://cdn.example/app.js', allowed)).toBe(false);
  });

  it('settles a request once and removes its timer and abort listener', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const abortHandler = vi.fn();
    controller.signal.addEventListener('abort', abortHandler);
    const request = {
      timeout: setTimeout(() => undefined, 1000),
      abortSignal: controller.signal,
      abortHandler
    };
    const settle = vi.fn();

    expect(settleBrowserFetchRequestOnce(request, settle)).toBe(true);
    expect(settleBrowserFetchRequestOnce(request, settle)).toBe(false);
    controller.abort();

    expect(settle).toHaveBeenCalledTimes(1);
    expect(abortHandler).not.toHaveBeenCalled();
    expect(request.timeout).toBeUndefined();
    expect(request.abortHandler).toBeUndefined();
  });

  it('orders queued browser work by priority and FIFO within a priority', () => {
    const queueRef = ref<BrowserFetchQueueRequest[]>([]);
    const background = createRequest(1, {
      browserFetchIntent: { owner: 'feed', priority: 'background' }
    });
    const foregroundA = createRequest(2, {
      browserFetchIntent: { owner: 'topic', priority: 'foreground' }
    });
    const foregroundB = createRequest(3, {
      browserFetchIntent: { owner: 'search', priority: 'foreground' }
    });
    const write = createRequest(4, {
      browserFetchIntent: { owner: 'write', priority: 'write' }
    });

    enqueueBrowserFetchRequest({ queueRef, request: background });
    enqueueBrowserFetchRequest({ queueRef, request: foregroundA });
    enqueueBrowserFetchRequest({ queueRef, request: foregroundB });
    enqueueBrowserFetchRequest({ queueRef, request: write });

    expect(queueRef.current.map(({ id }) => id)).toEqual([4, 2, 3, 1]);
  });

  it('[REG-ACCOUNT-037] exposes the active browser request owner without leaking queue internals', () => {
    vi.useFakeTimers();
    const request = createRequest(1, {
      browserFetchIntent: { owner: 'account', priority: 'background' }
    });
    const setActiveRequest = vi.fn();

    startNextBrowserFetchRequest({
      currentRef: ref<BrowserFetchQueueRequest | null>(null),
      queueRef: ref([request]),
      setActiveRequest,
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      rejectCurrent: vi.fn()
    });

    expect(setActiveRequest).toHaveBeenCalledWith({
      id: 1,
      url: request.url,
      userAgent: undefined,
      owner: 'account'
    });
    expect(setActiveRequest.mock.calls[0][0]).not.toHaveProperty('browserFetchIntent');
  });

  it('never preempts an active browser request when higher priority work arrives', () => {
    vi.useFakeTimers();
    const active = createRequest(1);
    const currentRef = ref<BrowserFetchQueueRequest | null>(active);
    const queueRef = ref<BrowserFetchQueueRequest[]>([
      createRequest(2, {
        browserFetchIntent: { owner: 'write', priority: 'write' }
      })
    ]);
    const setActiveRequest = vi.fn();

    startNextBrowserFetchRequest({
      currentRef,
      queueRef,
      setActiveRequest,
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      rejectCurrent: vi.fn()
    });

    expect(currentRef.current).toBe(active);
    expect(queueRef.current).toHaveLength(1);
    expect(setActiveRequest).not.toHaveBeenCalled();
  });

  it('starts timeout only after a queued request becomes active', () => {
    vi.useFakeTimers();
    const first = createRequest(1);
    const second = createRequest(2);
    const currentRef = ref<BrowserFetchQueueRequest | null>(null);
    const queueRef = ref([first, second]);
    const rejectCurrent = vi.fn();
    const startNext = () =>
      startNextBrowserFetchRequest({
        currentRef,
        queueRef,
        setActiveRequest: vi.fn(),
        timeoutMs: 15_000,
        timeoutMessage: 'timeout',
        rejectCurrent
      });

    startNext();
    vi.advanceTimersByTime(14_000);
    expect(rejectCurrent).not.toHaveBeenCalled();

    currentRef.current = null;
    settleBrowserFetchRequestOnce(first, () => undefined);
    startNext();
    vi.advanceTimersByTime(14_999);
    expect(rejectCurrent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rejectCurrent).toHaveBeenCalledWith(second, 'timeout');
  });

  it('skips an aborted queued request and starts the next eligible one', () => {
    vi.useFakeTimers();
    const aborted = new AbortController();
    aborted.abort();
    const first = createRequest(1, { abortSignal: aborted.signal });
    const second = createRequest(2);
    const currentRef = ref<BrowserFetchQueueRequest | null>(null);
    const queueRef = ref([first, second]);
    const setActiveRequest = vi.fn();

    startNextBrowserFetchRequest({
      currentRef,
      queueRef,
      setActiveRequest,
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      rejectCurrent: vi.fn()
    });

    expect(first.reject).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '请求已取消'
      })
    );
    expect(currentRef.current).toBe(second);
    expect(setActiveRequest).toHaveBeenCalledWith({
      id: 2,
      url: second.url,
      userAgent: undefined
    });
  });

  it('does not expose legacy Cookie headers to the mounted hidden WebView', () => {
    vi.useFakeTimers();
    const request = {
      ...createRequest(1),
      cookie: 'PRIVATE_COOKIE_HEADER'
    };
    const currentRef = ref<BrowserFetchQueueRequest | null>(null);
    const queueRef = ref([request]);
    const setActiveRequest = vi.fn();

    startNextBrowserFetchRequest({
      currentRef,
      queueRef,
      setActiveRequest,
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      rejectCurrent: vi.fn()
    });

    expect(setActiveRequest).toHaveBeenCalledWith({
      id: 1,
      url: request.url,
      userAgent: undefined
    });
    expect(setActiveRequest.mock.calls[0][0]).not.toHaveProperty('cookie');
  });

  it('rejects queued work without stopping the active renderer', () => {
    const active = createRequest(1);
    const queued = createRequest(2);
    const currentRef = ref<BrowserFetchQueueRequest | null>(active);
    const queueRef = ref([queued]);
    const stopLoading = vi.fn();
    const startNext = vi.fn();

    rejectBrowserFetchRequest({
      request: queued,
      message: 'canceled',
      currentRef,
      queueRef,
      setActiveRequest: vi.fn(),
      startNext,
      webViewRef: ref({ stopLoading })
    });

    expect(currentRef.current).toBe(active);
    expect(stopLoading).not.toHaveBeenCalled();
    expect(queued.reject).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'canceled'
      })
    );
    expect(startNext).toHaveBeenCalledTimes(1);
  });

  it('releases the renderer and starts the next request after active failure', () => {
    const active = createRequest(1);
    const currentRef = ref<BrowserFetchQueueRequest | null>(active);
    const queueRef = ref<BrowserFetchQueueRequest[]>([]);
    const stopLoading = vi.fn();
    const setActiveRequest = vi.fn();
    const startNext = vi.fn();

    rejectBrowserFetchRequest({
      request: active,
      message: new Error('renderer gone'),
      currentRef,
      queueRef,
      setActiveRequest,
      startNext,
      webViewRef: ref({ stopLoading })
    });

    expect(stopLoading).toHaveBeenCalledTimes(1);
    expect(currentRef.current).toBeNull();
    expect(setActiveRequest).toHaveBeenCalledWith(null);
    expect(startNext).toHaveBeenCalledTimes(1);
  });
});
