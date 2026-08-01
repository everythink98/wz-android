import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceCredentialWriteGeneration,
  cancelForumSourceQueries,
  commitChangedAccountStatusQuery,
  createCredentialWriteGate,
  enqueueBrowserFetchRequest,
  enqueueCredentialWrite,
  enqueueCredentialWriteForGeneration,
  forumSessionEpochsAfterSourceChange,
  linuxDoBrowserResponse,
  nodeSeekBrowserResponse,
  rejectBrowserFetchRequest,
  removeUnconfirmedForumSourceQueries,
  replaceCredentialWrite,
  requestHeaderValue,
  resetForumSourceQueries,
  runBestEffortTask,
  settleBrowserFetchRequestOnce,
  shouldHandleBrowserHttpError,
  siteSessionEventInvalidatesForumQueries,
  startNextBrowserFetchRequest,
  takeNodeSeekVerificationRetry,
  type BrowserFetchQueueRequest
} from './sessionControllerHelpers';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from './serverState';

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

describe('session controller helpers', () => {
  it('invalidates forum queries only for definitive identity transitions', () => {
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'session-updated',
        loggedIn: true
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'login-detected'
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'login-expired'
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'cleared'
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'verification-started'
      })
    ).toBe(false);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'check-failed',
        message: 'offline'
      })
    ).toBe(false);
  });

  it('increments only the changed source epoch', () => {
    expect(
      forumSessionEpochsAfterSourceChange({ ...initialForumSessionEpochs, linuxdo: 2, nodeseek: 3 }, 'linuxdo')
    ).toEqual({
      ...initialForumSessionEpochs,
      linuxdo: 3,
      nodeseek: 3
    });
  });

  it('removes source and all queries without touching another source', async () => {
    const client = new QueryClient();
    client.setQueryData(['forum', 'linuxdo', 'feed'], 'linux');
    client.setQueryData(['forum', 'all', 'feed'], 'all');
    client.setQueryData(['forum', 'nodeseek', 'feed'], 'node');

    resetForumSourceQueries('linuxdo', client);
    await Promise.resolve();

    expect(client.getQueryData(['forum', 'linuxdo', 'feed'])).toBeUndefined();
    expect(client.getQueryData(['forum', 'all', 'feed'])).toBeUndefined();
    expect(client.getQueryData(['forum', 'nodeseek', 'feed'])).toBe('node');
  });

  it('[REG-ACCOUNT-031] cancels dirty-source and aggregate reads without evicting their last trusted data', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const sourceKey = ['forum', 'nodeseek', 'topic', { topicId: '1' }] as const;
    const aggregateKey = ['forum', 'all', 'feed', { page: 1 }] as const;
    const otherKey = ['forum', 'linuxdo', 'topic', { topicId: '2' }] as const;
    const sourceAbort = vi.fn();
    const aggregateAbort = vi.fn();
    const otherAbort = vi.fn();
    const pendingRead =
      (onAbort: () => void) =>
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              onAbort();
              reject(new Error('aborted'));
            },
            { once: true }
          );
        });

    client.setQueryData(sourceKey, 'trusted NodeSeek topic');
    client.setQueryData(aggregateKey, 'trusted aggregate');
    client.setQueryData(otherKey, 'trusted linux.do topic');
    void client.fetchQuery({ queryKey: sourceKey, queryFn: pendingRead(sourceAbort), staleTime: 0 });
    void client.fetchQuery({ queryKey: aggregateKey, queryFn: pendingRead(aggregateAbort), staleTime: 0 });
    void client.fetchQuery({ queryKey: otherKey, queryFn: pendingRead(otherAbort), staleTime: 0 });
    await Promise.resolve();

    await cancelForumSourceQueries('nodeseek', client);

    expect(sourceAbort).toHaveBeenCalledTimes(1);
    expect(aggregateAbort).toHaveBeenCalledTimes(1);
    expect(otherAbort).not.toHaveBeenCalled();
    expect(client.getQueryData(sourceKey)).toBe('trusted NodeSeek topic');
    expect(client.getQueryData(aggregateKey)).toBe('trusted aggregate');
    expect(client.getQueryData(otherKey)).toBe('trusted linux.do topic');
    await client.cancelQueries();
  });
  it('[REG-FEED-010] removes unconfirmed source data without touching account or safe aggregate queries', () => {
    const client = new QueryClient();
    const sourceFeed = ['forum', 'nodeseek', 'feed'] as const;
    const account = ['forum', 'nodeseek', 'account-status'] as const;
    const probe = ['forum', 'nodeseek', 'account-status-probe'] as const;
    const aggregate = ['forum', 'all', 'feed'] as const;
    const otherSource = ['forum', 'linuxdo', 'feed'] as const;
    client.setQueryData(sourceFeed, 'untrusted');
    client.setQueryData(account, 'canonical');
    client.setQueryData(probe, 'probe');
    client.setQueryData(aggregate, 'safe');
    client.setQueryData(otherSource, 'other');

    removeUnconfirmedForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(sourceFeed)).toBeUndefined();
    expect(client.getQueryData(account)).toBe('canonical');
    expect(client.getQueryData(probe)).toBe('probe');
    expect(client.getQueryData(aggregate)).toBe('safe');
    expect(client.getQueryData(otherSource)).toBe('other');
  });
  it('preserves only the exact active recovery query when requested', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const recoveryKey = ['forum', 'linuxdo', 'level', { epoch: 0 }] as const;
    client.setQueryData(recoveryKey, { username: 'alice' });
    client.setQueryData(['forum', 'linuxdo', 'feed'], ['old']);
    const observer = new QueryObserver(client, {
      queryKey: recoveryKey,
      queryFn: async () => ({ username: 'alice' })
    });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      expect(resetForumSourceQueries('linuxdo', client, recoveryKey)).toBe(true);
      expect(client.getQueryData(recoveryKey)).toEqual({ username: 'alice' });
      expect(client.getQueryData(['forum', 'linuxdo', 'feed'])).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });
  it('atomically seeds the changed account result under the incremented epoch', () => {
    const client = new QueryClient();
    const probeKey = ['forum', 'linuxdo', 'account-status-probe', { epoch: 4, generation: 9 }] as const;
    const account = {
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        currentUser: { id: '42', username: 'alice' }
      }
    };
    client.setQueryData(probeKey, account);

    const next = commitChangedAccountStatusQuery(
      'linuxdo',
      { ...initialForumSessionEpochs, linuxdo: 4 },
      probeKey,
      client
    );

    expect(next.linuxdo).toBe(5);
    expect(
      client.getQueryData(
        forumQueryKeys.accountStatus({
          sessionEpochs: next,
          source: 'linuxdo'
        })
      )
    ).toEqual(account);
    expect(client.getQueryData(probeKey)).toBeUndefined();
  });

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

  it('takes a pending NodeSeek recovery owner exactly once', () => {
    const retry = {
      type: 'search' as const,
      recovery: {
        queryKey: ['search', 'nodeseek'],
        resume: vi.fn(async () => 'completed' as const)
      }
    };
    const retryRef = ref<typeof retry | null>(retry);

    expect(takeNodeSeekVerificationRetry(retryRef)).toBe(retry);
    expect(takeNodeSeekVerificationRetry(retryRef)).toBeNull();
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

  it('bounds best-effort follow-up work and swallows its failure', async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => undefined);
    const timed = runBestEffortTask(() => never, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(timed).resolves.toBeUndefined();
    await expect(
      runBestEffortTask(async () => {
        throw new Error('best effort failed');
      }, 100)
    ).resolves.toBeUndefined();
  });

  it('serializes credential writes for one generation', async () => {
    const gate = createCredentialWriteGate();
    const first = Promise.withResolvers<void>();
    const order: string[] = [];
    const firstWrite = enqueueCredentialWrite(gate, async () => {
      order.push('first:start');
      await first.promise;
      order.push('first:end');
      return 'first';
    });
    const secondWrite = enqueueCredentialWrite(gate, () => {
      order.push('second');
      return 'second';
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['first:start']);
    first.resolve();

    await expect(firstWrite).resolves.toBe('first');
    await expect(secondWrite).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('invalidates queued and in-flight credential writes after a replacement', async () => {
    const gate = createCredentialWriteGate();
    const first = Promise.withResolvers<void>();
    const oldWrite = enqueueCredentialWrite(gate, async ({ isCurrent }) => {
      await first.promise;
      return isCurrent() ? 'old' : 'stale';
    });
    const queuedOld = enqueueCredentialWriteForGeneration(gate, gate.generation, () => 'queued-old');
    const replacement = replaceCredentialWrite(gate, () => 'new');
    first.resolve();

    await expect(oldWrite).resolves.toBeUndefined();
    await expect(queuedOld).resolves.toBeUndefined();
    await expect(replacement).resolves.toBe('new');
  });

  it('does not run work submitted for a stale explicit generation', async () => {
    const gate = createCredentialWriteGate();
    const staleGeneration = gate.generation;
    advanceCredentialWriteGeneration(gate);
    const task = vi.fn(() => 'must-not-run');

    await expect(enqueueCredentialWriteForGeneration(gate, staleGeneration, task)).resolves.toBeUndefined();
    expect(task).not.toHaveBeenCalled();
  });
});
