import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_CANCELED_MESSAGE } from '@/platform/network/request';
import { readWithinAggregateSourceBudget } from './readAggregation';
import { beginDiagnosticTrace, setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';

describe('readWithinAggregateSourceBudget', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
    vi.useRealTimers();
  });

  it('shares one absolute preparation deadline across network readiness and provider identity', async () => {
    vi.useFakeTimers();
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const trace = beginDiagnosticTrace('feed', 'load', { source: 'all' });
    let finishIdentity!: () => void;
    const identity = new Promise<void>((resolve) => {
      finishIdentity = resolve;
    });
    let identitySignal: AbortSignal | undefined;
    const prepare = vi.fn((signal: AbortSignal) => {
      identitySignal = signal;
      return identity;
    });
    const read = vi.fn(async () => 'unexpected');
    const start = Date.now();
    const request = readWithinAggregateSourceBudget('nodeseek', undefined, read, {
      preparation: {
        deadline: start + 10_000,
        beforeRequest: () => new Promise<void>((resolve) => setTimeout(resolve, 7_400))
      },
      prepare,
      trace
    });
    const rejected = expect(request).rejects.toMatchObject({ reason: 'preparation_timeout', retryable: true });
    await vi.advanceTimersByTimeAsync(7_400);
    expect(prepare).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_599);
    expect(identitySignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(identitySignal?.aborted).toBe(true);
    finishIdentity();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'guard', source: 'nodeseek', state: 'network-ready', latencyMs: 7_400 }),
        expect.objectContaining({
          phase: 'guard',
          source: 'nodeseek',
          reason: 'preparation_timeout',
          latencyMs: 10_000
        })
      ])
    );
    expect(events.some((event) => event.phase === 'transport')).toBe(false);
  });

  it('keeps an active source reading when a different source reaches the shared preparation deadline', async () => {
    vi.useFakeTimers();
    const preparation = { deadline: Date.now() + 10_000 };
    const activeRead = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('fresh'), 4_000)));
    const active = readWithinAggregateSourceBudget('v2ex', undefined, activeRead, {
      preparation,
      prepare: () => new Promise<void>((resolve) => setTimeout(resolve, 7_400))
    });
    let finishSlowPreparation!: () => void;
    const slowRead = vi.fn(async () => 'unexpected');
    const slow = readWithinAggregateSourceBudget('nodeseek', undefined, slowRead, {
      preparation,
      prepare: () =>
        new Promise<void>((resolve) => {
          finishSlowPreparation = resolve;
        })
    });
    const rejected = expect(slow).rejects.toMatchObject({ reason: 'preparation_timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(activeRead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_400);
    await expect(active).resolves.toBe('fresh');
    finishSlowPreparation();
    await vi.advanceTimersByTimeAsync(0);
    expect(slowRead).not.toHaveBeenCalled();
  });

  it('starts each child budget after its own preparation without delaying ready sources', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    const preparation = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const delayedRead = vi.fn(async () => 'nodeseek');
    const pending = readWithinAggregateSourceBudget('nodeseek', undefined, delayedRead, { prepare: () => preparation });
    const immediate = readWithinAggregateSourceBudget('v2ex', undefined, async () => 'v2ex');
    await expect(immediate).resolves.toBe('v2ex');
    await vi.advanceTimersByTimeAsync(6_000);
    expect(delayedRead).not.toHaveBeenCalled();
    ready();
    await expect(pending).resolves.toBe('nodeseek');
    expect(delayedRead).toHaveBeenCalledTimes(1);
  });

  it('cancels pending preparation without starting a child request', async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => 'unexpected');
    const pending = readWithinAggregateSourceBudget('linuxdo', controller.signal, read, {
      prepare: () => new Promise(() => {})
    });
    const canceled = expect(pending).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    controller.abort();
    await canceled;
    expect(read).not.toHaveBeenCalled();
  });

  it('does not start a child read when preparation settles in the same tick as cancellation', async () => {
    const controller = new AbortController();
    const preparation = Promise.withResolvers<void>();
    const prepare = vi.fn(() => preparation.promise);
    const read = vi.fn(async () => 'unexpected');
    const pending = readWithinAggregateSourceBudget('linuxdo', controller.signal, read, { prepare });
    const canceled = expect(pending).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));

    preparation.resolve();
    controller.abort();

    await canceled;
    expect(read).not.toHaveBeenCalled();
  });

  it('does not prepare a provider when canceled readiness settles late', async () => {
    const controller = new AbortController();
    const readiness = Promise.withResolvers<void>();
    const beforeRequest = vi.fn(() => readiness.promise);
    const prepare = vi.fn(async () => undefined);
    const read = vi.fn(async () => 'unexpected');
    const pending = readWithinAggregateSourceBudget('linuxdo', controller.signal, read, {
      preparation: { deadline: Date.now() + 10_000, beforeRequest },
      prepare
    });
    const canceled = expect(pending).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    await vi.waitFor(() => expect(beforeRequest).toHaveBeenCalledTimes(1));
    controller.abort();
    await canceled;

    readiness.resolve();
    await Promise.resolve();

    expect(prepare).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['readiness', 'provider'] as const)('releases the preparation budget after %s fails', async (stage) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const failure = new Error(`${stage} failed`);
    const read = vi.fn(async () => 'unexpected');
    const prepare = vi.fn(async () => {
      throw failure;
    });
    const pending = readWithinAggregateSourceBudget('linuxdo', controller.signal, read, {
      preparation: {
        deadline: Date.now() + 10_000,
        beforeRequest: async () => {
          if (stage === 'readiness') throw failure;
        }
      },
      prepare
    });

    await expect(pending).rejects.toBe(failure);

    expect(read).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(stage === 'provider' ? 1 : 0);
    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0]?.[1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a child read when the parent is already aborted', async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => 'unexpected');
    controller.abort();

    await expect(readWithinAggregateSourceBudget('v2ex', controller.signal, read)).rejects.toThrow(
      REQUEST_CANCELED_MESSAGE
    );
    expect(read).not.toHaveBeenCalled();
  });
});
