// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  cancel: (): Promise<void> => Promise.resolve(),
  cancelStreaming: (): Promise<void> => Promise.resolve()
}));

vi.mock('../../node_modules/expo/src/winter/fetch/ExpoFetchModule', () => {
  class NativeResponse {
    addListener() {}
    removeAllListeners() {}
    cancelStreaming() {
      return native.cancelStreaming();
    }
    async startStreaming() {
      return null;
    }
  }
  class NativeRequest {
    async start() {}
    cancel() {
      return native.cancel();
    }
  }
  return { ExpoFetchModule: { NativeResponse, NativeRequest } };
});

import { FetchResponse } from '../../node_modules/expo/src/winter/fetch/FetchResponse';
import { fetch as expoFetch } from '../../node_modules/expo/src/winter/fetch/fetch';

afterEach(() => {
  native.cancel = () => Promise.resolve();
  native.cancelStreaming = () => Promise.resolve();
});

describe('Expo fetch native cancellation', () => {
  it('keeps a failed native stream cancellation owned by the reader cancellation promise', async () => {
    const failure = Object.assign(new Error('native stream cancellation failed'), { code: 'ERR_CANCELED' });
    const nativeCancellation = Promise.reject(failure);
    // The assertion observes the public stream contract; keep a broken implementation from leaking into other tests.
    void nativeCancellation.catch(() => undefined);
    native.cancelStreaming = () => nativeCancellation;
    const response = new FetchResponse(() => undefined);
    const reader = response.body!.getReader();
    await expect(reader.cancel('route left')).rejects.toBe(failure);
  });

  it('finishes an aborted body read without leaking a failed native request cancellation', async () => {
    native.cancel = () =>
      Promise.reject(Object.assign(new Error('native request cancellation failed'), { code: 'ERR_CANCELED' }));
    const controller = new AbortController();
    const response = await expoFetch('https://example.test/content', { signal: controller.signal });
    const reading = response.body!.getReader().read();
    const aborted = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await aborted;
    // Let Node surface any orphaned native Promise to Vitest's unhandled-rejection oracle.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
