import { describe, expect, it, vi } from 'vitest';
import {
  cancelRequestTimeoutForFallback,
  fetchWithTimeout,
  prepareRequestToSend,
  rejectUnauthorizedResponse,
  withAbortableTimeout,
  withRequestBeforeSend,
  RequestCanceledError,
  REQUEST_CANCELED_MESSAGE,
  RequestTimeoutError
} from './request';

const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试';

describe('Android request helpers', () => {
  it('keeps a timed-out write unsent when asynchronous transport preparation settles later', async () => {
    const prepared = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const dispatch = { mayHaveSent: false };
    const transport = vi.fn(async () => new Response('{}'));
    const fetcher = withRequestBeforeSend(
      async (_input, init) => {
        try {
          await prepared.promise;
          prepareRequestToSend(init);
          return await transport();
        } finally {
          finished.resolve();
        }
      },
      () => undefined,
      dispatch
    );
    await expect(
      fetchWithTimeout('https://example.invalid/write', { method: 'POST' }, { fetcher, timeoutMs: 1 })
    ).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(dispatch.mayHaveSent).toBe(false);
    prepared.resolve();
    await finished.promise;
    expect(transport).not.toHaveBeenCalled();
    expect(dispatch.mayHaveSent).toBe(false);
  });

  it('marks a write as possibly sent only after the final transport guard and strips local metadata', async () => {
    const dispatch = { mayHaveSent: false };
    let current = true;
    let pending: RequestInit | undefined;
    const request = withRequestBeforeSend(
      async (_input, init) => {
        pending = init;
        return new Response('{}');
      },
      () => {
        if (!current) throw new Error('stale');
      },
      dispatch
    );
    await request('https://example.invalid/write', { method: 'POST', body: 'payload' });
    expect(dispatch.mayHaveSent).toBe(false);
    current = false;
    expect(() => prepareRequestToSend(pending)).toThrow('stale');
    expect(dispatch.mayHaveSent).toBe(false);
    current = true;
    expect(prepareRequestToSend(pending)).toEqual({ method: 'POST', body: 'payload' });
    expect(dispatch.mayHaveSent).toBe(true);
  });

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

  it('retains a body-only LINUX DO verification response on a forum write', async () => {
    const fetcher = rejectUnauthorizedResponse(
      async () =>
        new Response('<title>Just a moment...</title>', { status: 401, headers: { 'content-type': 'text/html' } })
    );
    await expect(fetcher('https://linux.do/posts.json', { method: 'POST' })).rejects.toMatchObject({
      verificationRequired: true,
      status: 401
    });
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

describe('abortable observation ownership', () => {
  it.each(['caller-first', 'deadline-first'] as const)('preserves the first cancellation cause: %s', async (order) => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const pending = Promise.withResolvers<string>();
    const canceled = new Error('caller canceled');
    const timedOut = new Error('observation deadline');
    let activeSignal: AbortSignal | undefined;
    const request = withAbortableTimeout(
      (signal) => {
        activeSignal = signal;
        return pending.promise;
      },
      { signal: parent.signal, timeoutMs: 100, canceledError: () => canceled, timeoutError: () => timedOut }
    );
    const rejected = expect(request).rejects.toBe(order === 'caller-first' ? canceled : timedOut);
    try {
      await vi.advanceTimersByTimeAsync(0);
      if (order === 'caller-first') parent.abort();
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      if (order === 'deadline-first') parent.abort();
      pending.resolve('late underlying result');
      await pending.promise;
      expect(activeSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await expect(request).rejects.toBe(order === 'caller-first' ? canceled : timedOut);
    } finally {
      pending.resolve('cleanup');
      await Promise.allSettled([request, pending.promise]);
      vi.useRealTimers();
    }
  });

  it.each(['resolve', 'throw'] as const)(
    'releases its timer and parent listener after an operation %s',
    async (outcome) => {
      vi.useFakeTimers();
      const parent = new AbortController();
      const add = vi.spyOn(parent.signal, 'addEventListener');
      const remove = vi.spyOn(parent.signal, 'removeEventListener');
      const failure = new Error('synchronous preparation failure');
      let activeSignal: AbortSignal | undefined;
      try {
        const request = withAbortableTimeout(
          (signal) => {
            activeSignal = signal;
            if (outcome === 'throw') throw failure;
            return Promise.resolve('ready');
          },
          { signal: parent.signal, timeoutMs: 100 }
        );
        if (outcome === 'throw') await expect(request).rejects.toBe(failure);
        else await expect(request).resolves.toBe('ready');
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
        expect(vi.getTimerCount()).toBe(0);
        parent.abort();
        expect(activeSignal?.aborted).toBe(false);
      } finally {
        add.mockRestore();
        remove.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it('keeps caller cancellation after fallback consumes its outer timeout', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const pending = Promise.withResolvers<Response>();
    const fetcher = vi.fn((_input: string, init?: RequestInit) => {
      cancelRequestTimeoutForFallback(init);
      cancelRequestTimeoutForFallback(init);
      return pending.promise;
    });
    const request = fetchWithTimeout(
      'https://example.invalid/fallback',
      {},
      { fetcher, signal: parent.signal, timeoutMs: 100 }
    );
    const rejected = expect(request).rejects.toBeInstanceOf(RequestCanceledError);
    try {
      await vi.advanceTimersByTimeAsync(200);
      expect(vi.getTimerCount()).toBe(0);
      parent.abort();
      await rejected;
      pending.resolve(new Response('late fallback'));
      await pending.promise;
      await expect(request).rejects.toBeInstanceOf(RequestCanceledError);
    } finally {
      pending.resolve(new Response('cleanup'));
      await Promise.allSettled([request, pending.promise]);
      vi.useRealTimers();
    }
  });
});

describe('composed dispatch proof', () => {
  it.each(['success', 'sync-throw'] as const)(
    'marks every nested observer after final prepare: %s',
    async (outcome) => {
      const outer = { mayHaveSent: false };
      const inner = { mayHaveSent: false };
      let sends = 0;
      const failure = new Error('synchronous transport failure after prepare');
      const transport = withRequestBeforeSend(
        (_input, init) => {
          const prepared = prepareRequestToSend(init);
          expect(Reflect.ownKeys(prepared!)).not.toContain(Symbol.for('wz.requestDispatchState'));
          sends++;
          if (outcome === 'sync-throw') throw failure;
          return Promise.resolve(new Response('ok'));
        },
        () => {},
        outer
      );
      const guarded = withRequestBeforeSend(
        withRequestBeforeSend(transport, () => {}),
        () => {},
        inner
      );
      if (outcome === 'sync-throw')
        await expect(guarded('https://example.invalid/proof', { method: 'POST' })).rejects.toBe(failure);
      else
        await expect(guarded('https://example.invalid/proof', { method: 'POST' })).resolves.toMatchObject({ ok: true });
      expect(sends).toBe(1);
      expect(outer.mayHaveSent).toBe(true);
      expect(inner.mayHaveSent).toBe(true);
    }
  );

  it('keeps every observer unsent when transport preparation throws synchronously before prepare', async () => {
    const outer = { mayHaveSent: false };
    const inner = { mayHaveSent: false };
    const failure = new Error('synchronous preparation failure');
    const transport = withRequestBeforeSend(
      () => {
        throw failure;
      },
      () => {},
      outer
    );
    const guarded = withRequestBeforeSend(transport, () => {}, inner);
    await expect(guarded('https://example.invalid/proof', { method: 'POST' })).rejects.toBe(failure);
    expect([outer.mayHaveSent, inner.mayHaveSent]).toEqual([false, false]);
  });

  it.each(['signal', 'inner-guard', 'outer-guard'] as const)(
    'does not mark any observer when prepare rejects: %s',
    async (block) => {
      const outer = { mayHaveSent: false };
      const inner = { mayHaveSent: false };
      const controller = new AbortController();
      let admission = true;
      let pending: RequestInit | undefined;
      const order: string[] = [];
      const transport = withRequestBeforeSend(
        async (_input, init) => {
          pending = init;
          return new Response('queued');
        },
        () => {
          order.push('outer');
          if (!admission && block === 'outer-guard') throw new Error('outer stale');
        },
        outer
      );
      const guarded = withRequestBeforeSend(
        transport,
        () => {
          order.push('inner');
          if (!admission && block === 'inner-guard') throw new Error('inner stale');
        },
        inner
      );
      await guarded('https://example.invalid/proof', { method: 'POST', signal: controller.signal });
      order.length = 0;
      admission = false;
      if (block === 'signal') controller.abort();
      expect(() => prepareRequestToSend(pending)).toThrow(
        block === 'signal' ? '请求已取消' : block === 'inner-guard' ? 'inner stale' : 'outer stale'
      );
      expect(order).toEqual(block === 'signal' ? [] : block === 'inner-guard' ? ['inner'] : ['inner', 'outer']);
      expect([outer.mayHaveSent, inner.mayHaveSent]).toEqual([false, false]);
    }
  );

  it('keeps reused dispatch observers monotonic across a later rejected request', async () => {
    const outer = { mayHaveSent: false };
    const inner = { mayHaveSent: false };
    let current = true;
    let sends = 0;
    const transport = withRequestBeforeSend(
      async (_input, init) => {
        prepareRequestToSend(init);
        sends++;
        return new Response('ok');
      },
      () => {
        if (!current) throw new Error('stale');
      },
      outer
    );
    const guarded = withRequestBeforeSend(transport, () => {}, inner);
    await guarded('https://example.invalid/proof', { method: 'POST' });
    current = false;
    await expect(guarded('https://example.invalid/proof', { method: 'POST' })).rejects.toThrow('stale');
    expect(sends).toBe(1);
    expect([outer.mayHaveSent, inner.mayHaveSent]).toEqual([true, true]);
  });
});
