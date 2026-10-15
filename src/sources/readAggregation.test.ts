import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_CANCELED_MESSAGE } from '@/platform/network/request';
import { readWithinAggregateSourceBudget } from './readAggregation';

describe('readWithinAggregateSourceBudget', () => {
  afterEach(() => vi.useRealTimers());

  it('starts each child budget after its own preparation without delaying ready sources', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    const preparation = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const delayedRead = vi.fn(async () => 'nodeseek');
    const pending = readWithinAggregateSourceBudget('nodeseek', undefined, delayedRead, () => preparation);
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
    const pending = readWithinAggregateSourceBudget('linuxdo', controller.signal, read, () => new Promise(() => {}));
    const canceled = expect(pending).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    controller.abort();
    await canceled;
    expect(read).not.toHaveBeenCalled();
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
