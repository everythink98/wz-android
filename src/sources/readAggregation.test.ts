import { describe, expect, it, vi } from 'vitest';
import { REQUEST_CANCELED_MESSAGE } from '@/platform/network/request';
import { readWithinAggregateSourceBudget } from './readAggregation';

describe('readWithinAggregateSourceBudget', () => {
  it('[REG-FEED-014] does not start a child read when the parent is already aborted', async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => 'unexpected');
    controller.abort();

    await expect(readWithinAggregateSourceBudget('v2ex', controller.signal, read)).rejects.toThrow(
      REQUEST_CANCELED_MESSAGE
    );
    expect(read).not.toHaveBeenCalled();
  });
});
