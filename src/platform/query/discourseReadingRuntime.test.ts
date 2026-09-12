import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createDiscourseReadingRuntime, discourseReadingQueryKey, type ReadingBatch } from './discourseReadingRuntime';
import { readingResumeAnchor } from '@/domain/forum/discourseReading';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  let clock = 0;
  let identity = 'alice';
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const send = vi.fn<(batch: ReadingBatch, scope: string, signal: AbortSignal) => Promise<void>>(async () => undefined);
  const runtime = createDiscourseReadingRuntime({
    queryClient,
    scope: () => identity,
    send,
    now: () => clock
  });
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      clock += Math.min(1000, ms - elapsed);
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - elapsed));
    }
  };
  return {
    runtime,
    queryClient,
    send,
    advance,
    switchAccount: () => {
      identity = 'bob';
      runtime.sessionChanged();
    }
  };
}

describe('Discourse reading lifecycle', () => {
  it('reuses the read-floor map until a new floor is read and preserves earlier snapshots', async () => {
    const { runtime, queryClient, send, advance } = setup();
    send.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const ownKeys = vi.fn((target: Record<number, true>) => Reflect.ownKeys(target));
    const readPosts = new Proxy<Record<number, true>>(
      Object.freeze(Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [index + 1, true as const]))),
      { ownKeys }
    );
    const original = {
      server: { topicId: '1', lastReadPostNumber: 10000, highestPostNumber: 10002 },
      visited: true,
      highestKnown: 10000,
      localVersion: 0,
      requestSequence: 0,
      anchor: { floor: 5000 },
      readPosts
    };
    queryClient.setQueryData(discourseReadingQueryKey('alice'), { '1': original });
    const session = runtime.begin('1');
    session.visible([5000], { floor: 5000 });
    session.active(true);
    ownKeys.mockClear();
    await advance(6000);
    expect(ownKeys).not.toHaveBeenCalled();
    expect(runtime.state()['1']).toBe(original);

    session.visible([5000], { floor: 5000, offset: 20 });
    await advance(1000);
    expect(ownKeys).not.toHaveBeenCalled();
    expect(runtime.state()['1'].readPosts).toBe(readPosts);
    expect(original.anchor).toEqual({ floor: 5000 });

    session.visible([10001, 10002], { floor: 10001 });
    await advance(1000);
    expect(runtime.state()['1'].readPosts).not.toBe(readPosts);
    expect(runtime.state()['1'].readPosts[10001]).toBe(true);
    expect(runtime.state()['1'].readPosts[10002]).toBe(true);
    expect(readPosts[10001]).toBeUndefined();
    expect(readPosts[10002]).toBeUndefined();
    runtime.dispose();
  });

  it('preserves unsent reading against a rollback, then accepts a fresh confirmed rollback', async () => {
    const { runtime, advance } = setup();
    runtime.observe({ topicId: '1', lastReadPostNumber: 100, highestPostNumber: 200 }, runtime.startRequest());
    const session = runtime.begin('1');
    session.visible([40]);
    session.active(true);
    await advance(2000);
    runtime.observe({ topicId: '1', lastReadPostNumber: null }, runtime.startRequest());
    expect(readingResumeAnchor(runtime.state()['1'])).toEqual({ floor: 40 });
    session.end();
    await advance(1000);
    runtime.observe({ topicId: '1', lastReadPostNumber: null }, runtime.startRequest());
    expect(readingResumeAnchor(runtime.state()['1'])).toBeUndefined();
    expect(runtime.state()['1'].visited).toBe(true);
    runtime.dispose();
  });

  it('resumes from foreground without backfilling time and pauses after three minutes without interaction', async () => {
    const { runtime, send, advance } = setup();
    const session = runtime.begin('1');
    session.visible([1]);
    session.active(true);
    await advance(1000);
    runtime.foreground(false);
    await advance(120000);
    runtime.foreground(true);
    await advance(190000);
    session.active(false);
    await advance(1000);
    expect(send.mock.calls.reduce((sum, [batch]) => sum + batch.topicTime, 0)).toBe(180000);
    runtime.dispose();
  });

  it('bounds safe retries by Retry-After and batch age while preserving local reading', async () => {
    const { runtime, send, advance } = setup();
    send.mockRejectedValue(Object.assign(new Error('rate limited'), { safeToRetry: true, retryAfterMs: 120000 }));
    const session = runtime.begin('1');
    session.visible([1]);
    session.active(true);
    await advance(1000);
    session.end();
    await advance(130000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(runtime.state()['1'].readPosts[1]).toBe(true);
    expect(runtime.state()['1'].visited).toBe(false);
    runtime.dispose();
  });

  it('holds every account batch during Retry-After and clears the cooldown when switching accounts', async () => {
    const { runtime, send, advance, switchAccount } = setup();
    send.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { safeToRetry: true, retryAfterMs: 60000 }));
    const session = runtime.begin('1');
    session.visible([1]);
    session.active(true);
    await advance(1000);
    session.visible([2]);
    await advance(5000);
    expect(send).toHaveBeenCalledTimes(1);
    runtime.foreground(false);
    await advance(60000);
    expect(send).toHaveBeenCalledTimes(1);
    runtime.foreground(true);
    await advance(1000);
    expect(send.mock.calls.length).toBeGreaterThan(1);

    send.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { safeToRetry: true, retryAfterMs: 60000 }));
    session.end();
    await advance(1000);
    switchAccount();
    const before = send.mock.calls.length;
    const next = runtime.begin('2');
    next.visible([1]);
    next.active(true);
    await advance(1000);
    expect(send).toHaveBeenCalledTimes(before + 1);
    expect(send.mock.calls.at(-1)?.[1]).toBe('bob');
    runtime.dispose();
  });

  it('keeps newer batches independent when an unsent failure has no Retry-After', async () => {
    const { runtime, send, advance } = setup();
    send.mockRejectedValueOnce(Object.assign(new Error('not sent'), { safeToRetry: true }));
    const first = runtime.begin('1');
    first.visible([1]);
    first.active(true);
    await advance(1000);
    first.end();
    const next = runtime.begin('2');
    next.visible([1]);
    next.active(true);
    await advance(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].topicId).toBe('2');
    runtime.dispose();
  });

  it('keeps the last viewport after acknowledgement and ignores an older response', async () => {
    const { runtime, advance } = setup();
    runtime.observe({ topicId: '1', lastReadPostNumber: 100, highestPostNumber: 200 }, runtime.startRequest());
    const old = runtime.startRequest();
    const session = runtime.begin('1');
    session.visible([40], { floor: 40, rowKey: 'reply:40', offset: 12 });
    session.active(true);
    await advance(2000);
    session.end();
    runtime.observe({ topicId: '1', lastReadPostNumber: 20 }, old);
    expect(readingResumeAnchor(runtime.state()['1'])).toEqual({ floor: 40, rowKey: 'reply:40', offset: 12 });
    expect(runtime.state()['1'].server.lastReadPostNumber).toBe(100);
    runtime.observe({ topicId: '1', lastReadPostNumber: 180 }, runtime.startRequest());
    expect(readingResumeAnchor(runtime.state()['1'])).toEqual({ floor: 181 });
    runtime.dispose();
  });

  it('counts visible floors once and retains new time collected during an in-flight batch', async () => {
    const { runtime, send, advance } = setup();
    let complete!: () => void;
    send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const session = runtime.begin('1');
    session.visible([1, 1, 100], { floor: 100 });
    session.active(true);
    await advance(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ topicTime: 1000, timings: { 1: 1000, 100: 1000 } });
    await advance(10000);
    complete();
    await advance(1000);
    session.end();
    await advance(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ topicTime: 11000, timings: { 1: 11000, 100: 11000 } });
    expect(runtime.state()['1'].readPosts[50]).toBeUndefined();
    runtime.dispose();
  });

  it('does not count brief visibility, background time, or a previous account', async () => {
    const { runtime, send, advance, switchAccount } = setup();
    const session = runtime.begin('1');
    session.visible([1]);
    session.active(true);
    await advance(500);
    session.visible([]);
    await advance(1000);
    expect(send).not.toHaveBeenCalled();
    session.visible([4]);
    await advance(1000);
    runtime.foreground(false);
    const before = send.mock.calls.length;
    await advance(10000);
    expect(send).toHaveBeenCalledTimes(before);
    switchAccount();
    runtime.foreground(true);
    await advance(2000);
    expect(runtime.state()).toEqual({});
    expect(send).toHaveBeenCalledTimes(before);
    runtime.dispose();
  });

  it('does not retry an ambiguous failure and never exceeds the server batch ceiling', async () => {
    const { runtime, send, advance } = setup();
    send.mockRejectedValueOnce(new Error('response lost'));
    const session = runtime.begin('1');
    session.visible([1]);
    session.active(true);
    await advance(65000);
    session.end();
    await advance(1000);
    expect(send.mock.calls.every(([batch]) => batch.topicTime <= 60000 && batch.timings[1] <= 60000)).toBe(true);
    expect(send.mock.calls.filter(([batch]) => batch.topicTime === 1000)).toHaveLength(1);
    expect(runtime.state()['1'].visited).toBe(true);
    runtime.dispose();
  });
});
