import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestCanceledError } from '@/platform/network/request';
import type { DiscourseEmojiUrlMap } from './reactions';
import { retryEmojiCatalog } from './retryEmojiCatalog';

describe('emoji catalog retry resources', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects an already canceled catalog without starting a read', async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => ({}));
    controller.abort();

    await expect(retryEmojiCatalog(read, controller.signal)).rejects.toBeInstanceOf(RequestCanceledError);

    expect(read).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)(
    'cancels a signal-ignoring read immediately and ignores its late %s',
    async (outcome) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const added = vi.spyOn(controller.signal, 'addEventListener');
      const removed = vi.spyOn(controller.signal, 'removeEventListener');
      const response = Promise.withResolvers<DiscourseEmojiUrlMap>();
      const read = vi.fn(() => response.promise);
      const pending = retryEmojiCatalog(read, controller.signal);
      const canceled = expect(pending).rejects.toBeInstanceOf(RequestCanceledError);

      controller.abort();
      await canceled;
      if (outcome === 'success') response.resolve({ heart: 'https://linux.do/late-heart.png' });
      else response.reject(new Error('late failure'));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(read).toHaveBeenCalledTimes(1);
      expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0]?.[1]);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('releases a waiting retry timer and its abort listener when canceled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const read = vi.fn(async () => {
      throw new Error('offline');
    });
    const pending = retryEmojiCatalog(read, controller.signal);
    const canceled = expect(pending).rejects.toBeInstanceOf(RequestCanceledError);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await canceled;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(read).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0]?.[1]);
  });

  it('preserves a provider cancellation error and stops retrying without aborting its signal', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const failure = new RequestCanceledError();
    const read = vi.fn(async () => {
      throw failure;
    });

    await expect(retryEmojiCatalog(read, controller.signal)).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(controller.signal.aborted).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases its abort listener after success and keeps the successful result after a later abort', async () => {
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const urls = { heart: 'https://linux.do/heart.png' };
    const read = vi.fn(async () => urls);
    const pending = retryEmojiCatalog(read, controller.signal);

    await expect(pending).resolves.toBe(urls);
    controller.abort();
    await expect(pending).resolves.toBe(urls);

    expect(read).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0]?.[1]);
  });
});
