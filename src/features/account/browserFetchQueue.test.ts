import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserFetchQueue,
  forumBrowserResponse,
  requestHeaderValue,
  shouldHandleBrowserHttpError,
  type BrowserFetchQueueRequest
} from './browserFetchQueue';

function createQueue(overrides: Partial<Parameters<typeof createBrowserFetchQueue<BrowserFetchQueueRequest>>[0]> = {}) {
  return createBrowserFetchQueue<BrowserFetchQueueRequest>({
    canStart: () => true,
    onActiveRequest: vi.fn(),
    stopLoading: vi.fn(),
    timeoutMs: 15_000,
    timeoutMessage: 'timeout',
    ...overrides
  });
}

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
  beforeEach(() => vi.useFakeTimers());
  it('reads request headers case-insensitively across supported shapes', () => {
    expect(requestHeaderValue({ Cookie: 'a=1' }, 'cookie')).toBe('a=1');
    expect(requestHeaderValue([['USER-AGENT', 'agent']], 'user-agent')).toBe('agent');
    expect(requestHeaderValue(new Headers({ Accept: 'text/html' }), 'accept')).toBe('text/html');
    expect(requestHeaderValue(undefined, 'accept')).toBeUndefined();
  });

  it('removes a challenge body and marks the response explicitly', async () => {
    const response = forumBrowserResponse('<html>private page</html>', true);

    expect(response.status).toBe(403);
    expect(response.headers.get('cf-mitigated')).toBe('challenge');
    await expect(response.text()).resolves.toBe('');
  });

  it('keeps the final NodeSeek browser document URL on the synthetic response', () => {
    const response = forumBrowserResponse(
      '<html>page five</html>',
      false,
      undefined,
      'https://www.nodeseek.com/post-42-5'
    );

    expect(response.url).toBe('https://www.nodeseek.com/post-42-5');
  });

  it('classifies linux.do browser responses by body type', () => {
    expect(forumBrowserResponse('{"ok":true}', false).headers.get('content-type')).toBe('application/json');
    expect(forumBrowserResponse('<html></html>', false).headers.get('content-type')).toBe('text/html');
    expect(forumBrowserResponse('{}', false, 503).status).toBe(503);
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

  it('settles once and removes the active timer and abort listener', () => {
    const signal = new AbortController();
    const remove = vi.spyOn(signal.signal, 'removeEventListener');
    const request = createRequest(1, { abortSignal: signal.signal });
    const queue = createQueue();
    const settle = vi.fn();
    queue.enqueue(request);

    expect(queue.complete(1, settle)).toBe(true);
    expect(queue.complete(1, settle)).toBe(false);
    signal.abort();
    vi.advanceTimersByTime(15_000);

    expect(settle).toHaveBeenCalledExactlyOnceWith(request);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(request.reject).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('orders queued browser work by priority and FIFO within a priority', () => {
    const onActiveRequest = vi.fn();
    const queue = createQueue({ onActiveRequest });
    queue.enqueue(createRequest(0));
    queue.enqueue(createRequest(1, { browserFetchIntent: { owner: 'feed', priority: 'background' } }));
    queue.enqueue(createRequest(2, { browserFetchIntent: { owner: 'topic', priority: 'foreground' } }));
    queue.enqueue(createRequest(3, { browserFetchIntent: { owner: 'search', priority: 'foreground' } }));
    queue.enqueue(createRequest(4, { browserFetchIntent: { owner: 'write', priority: 'write' } }));

    for (const id of [0, 4, 2, 3, 1]) {
      expect(queue.active?.id).toBe(id);
      queue.complete(id, () => undefined);
    }
    expect(onActiveRequest.mock.calls.flatMap(([request]) => (request ? [request.id] : []))).toEqual([0, 4, 2, 3, 1]);
  });

  it('exposes the active browser owner without leaking queue internals', () => {
    const request = createRequest(1, { browserFetchIntent: { owner: 'account', priority: 'background' } });
    const queue = createQueue();
    queue.enqueue(request);
    expect(queue.active).toEqual({ id: 1, url: request.url, userAgent: undefined, owner: 'account' });
    expect(queue.active).not.toHaveProperty('browserFetchIntent');
    expect(queue.active).not.toHaveProperty('reject');
  });

  it('never preempts an active browser request when higher priority work arrives', () => {
    const onActiveRequest = vi.fn();
    const queue = createQueue({ onActiveRequest });
    queue.enqueue(createRequest(1));
    queue.enqueue(createRequest(2, { browserFetchIntent: { owner: 'write', priority: 'write' } }));
    expect(queue.active?.id).toBe(1);
    expect(onActiveRequest).toHaveBeenCalledTimes(1);
    queue.complete(1, () => undefined);
    expect(queue.active?.id).toBe(2);
  });

  it('starts timeout only after a queued request becomes active', () => {
    const first = createRequest(1);
    const second = createRequest(2);
    const queue = createQueue();
    queue.enqueue(first);
    queue.enqueue(second);
    vi.advanceTimersByTime(14_000);
    expect(first.reject).not.toHaveBeenCalled();
    expect(second.reject).not.toHaveBeenCalled();

    queue.complete(1, () => undefined);
    vi.advanceTimersByTime(14_999);
    expect(second.reject).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(second.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'timeout' }));
    expect(queue.active).toBeNull();
  });

  it('skips an aborted queued request and starts the next eligible one', () => {
    const signal = new AbortController();
    const canceled = createRequest(2, { abortSignal: signal.signal });
    const queue = createQueue();
    queue.enqueue(createRequest(1));
    queue.enqueue(canceled);
    queue.enqueue(createRequest(3));
    signal.abort();
    expect(queue.active?.id).toBe(1);
    queue.complete(1, () => undefined);
    expect(canceled.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: '请求已取消' }));
    expect(queue.active?.id).toBe(3);
  });

  it('does not expose legacy Cookie headers to the mounted hidden WebView', () => {
    const request = { ...createRequest(1), cookie: 'PRIVATE_COOKIE_HEADER' };
    const queue = createQueue();
    queue.enqueue(request);
    expect(queue.active).toEqual({ id: 1, url: request.url, userAgent: undefined });
    expect(queue.active).not.toHaveProperty('cookie');
  });

  it('rejects queued work without stopping the active renderer', () => {
    const active = createRequest(1);
    const queued = createRequest(2);
    const stopLoading = vi.fn();
    const queue = createQueue({ stopLoading });
    queue.enqueue(active);
    queue.enqueue(queued);
    expect(queue.cancel(2, 'canceled')).toBe(true);
    expect(queue.cancel(2, 'canceled')).toBe(false);
    expect(queue.active?.id).toBe(1);
    expect(stopLoading).not.toHaveBeenCalled();
    expect(queued.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'canceled' }));
  });

  it('releases the renderer and starts the next request after active failure', () => {
    const active = createRequest(1);
    const stopLoading = vi.fn();
    const queue = createQueue({ stopLoading });
    queue.enqueue(active);
    queue.enqueue(createRequest(2));
    queue.cancel(1, new Error('renderer gone'));
    expect(stopLoading).toHaveBeenCalledTimes(1);
    expect(active.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'renderer gone' }));
    expect(queue.active?.id).toBe(2);
  });

  it('settles a failed cancel and starts the next request even when stopLoading throws', () => {
    const signal = new AbortController();
    const active = createRequest(1, { abortSignal: signal.signal });
    const queued = createRequest(2);
    const failure = new Error('renderer command failed');
    const stopLoading = vi.fn().mockImplementationOnce(() => {
      throw failure;
    });
    const queue = createQueue({ stopLoading });
    queue.enqueue(active);
    queue.enqueue(queued);

    expect(() => queue.cancel(1, 'canceled')).toThrow(failure);
    signal.abort();
    expect(active.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'canceled' }));
    expect(queued.reject).not.toHaveBeenCalled();
    expect(queue.active?.id).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    expect(stopLoading).toHaveBeenCalledTimes(1);
    expect(queue.cancel(1, 'canceled')).toBe(false);
  });

  it('detaches and settles all retired work without starting another renderer', () => {
    const controllers = [new AbortController(), new AbortController()];
    const requests = controllers.map((signal, index) => createRequest(index + 1, { abortSignal: signal.signal }));
    const stopLoading = vi.fn();
    const queue = createQueue({ stopLoading });
    requests.forEach((request) => queue.enqueue(request));
    for (const request of requests) vi.mocked(request.reject).mockImplementation(() => expect(queue.active).toBeNull());

    queue.dispose();
    queue.dispose();
    controllers.forEach((controller) => controller.abort());
    expect(stopLoading).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    for (const request of requests)
      expect(request.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: '请求已取消' }));
    const late = createRequest(3);
    queue.enqueue(late);
    expect(late.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: '请求已取消' }));
    expect(queue.active).toBeNull();
  });

  it('settles detached requests even when stopping the renderer throws', () => {
    const active = createRequest(1);
    const queued = createRequest(2);
    const failure = new Error('renderer command failed');
    const queue = createQueue({
      stopLoading: () => {
        throw failure;
      }
    });
    queue.enqueue(active);
    queue.enqueue(queued);
    expect(() => queue.dispose()).toThrow(failure);
    expect(active.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: '请求已取消' }));
    expect(queued.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: '请求已取消' }));
    expect(queue.active).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['scope-revoked', 'before-send-rejected'] as const)(
    'does not publish an invalidated request before transport: %s',
    (reason) => {
      let admitted = true;
      const onActiveRequest = vi.fn();
      const denied = createRequest(1, {
        beforeSend: () => {
          if (reason === 'before-send-rejected') throw new Error('final guard rejected');
          admitted = false;
        }
      });
      const queue = createQueue({ canStart: (request) => request.id !== 1 || admitted, onActiveRequest });
      queue.enqueue(denied);
      queue.enqueue(createRequest(2));
      expect(denied.reject).toHaveBeenCalledOnce();
      expect(onActiveRequest.mock.calls.some(([request]) => request?.id === 1)).toBe(false);
      expect(queue.active?.id).toBe(2);
    }
  );

  it('keeps reentrant work queued until the previous native stop returns', () => {
    const onActiveRequest = vi.fn();
    const stopLoading = vi.fn<() => void>(() => {
      queue.enqueue(createRequest(3, { browserFetchIntent: { owner: 'write', priority: 'write' } }));
      expect(queue.active).toBeNull();
    });
    const queue = createQueue({ stopLoading, onActiveRequest });
    queue.enqueue(createRequest(1));
    queue.enqueue(createRequest(2));
    queue.cancel(1, 'canceled');
    expect(queue.active?.id).toBe(3);
    expect(onActiveRequest.mock.calls.flatMap(([request]) => (request ? [request.id] : []))).toEqual([1, 3]);
  });
});
