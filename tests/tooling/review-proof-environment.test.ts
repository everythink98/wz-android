import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireReviewProofEnvironment,
  finishReviewProofEnvironment
} from '../../dev/review-remediation-proof/environment';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('review proof environment ownership', () => {
  it('blocks network while capturing and releases ownership after a capture rejection', async () => {
    const fetch = vi.fn(async () => new Response('uncontrolled fetch reached'));
    vi.stubGlobal('fetch', fetch);
    let rejectCapture: (error: Error) => void = () => {
      throw new Error('Capture has not started');
    };
    const capture = new Promise<string>((_resolve, reject) => {
      rejectCapture = reject;
    });
    const restore = vi.fn();
    const pending = acquireReviewProofEnvironment(() => capture, restore);
    const error = new Error('capture failed');
    try {
      await expect(globalThis.fetch('https://invalid.example')).rejects.toThrow('Uncontrolled network denied');
    } finally {
      rejectCapture(error);
      await expect(pending).rejects.toBe(error);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(fetch);
    const retry = await acquireReviewProofEnvironment(async () => 'retry', vi.fn());
    await retry.release();
  });

  it('rejects a second environment before it can capture or replace the active blocker', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const first = await acquireReviewProofEnvironment(async () => 'first', vi.fn());
    const blocker = globalThis.fetch;
    const capture = vi.fn(async () => 'second');
    let second: Awaited<ReturnType<typeof acquireReviewProofEnvironment>> | undefined;
    try {
      await expect(
        acquireReviewProofEnvironment(capture, vi.fn()).then((value) => {
          second = value;
        })
      ).rejects.toThrow('already owned');
      expect(capture).not.toHaveBeenCalled();
      expect(globalThis.fetch).toBe(blocker);
    } finally {
      await second?.release();
      await first.release();
    }
    expect(globalThis.fetch).toBe(fetch);
  });

  it('preserves the body error together with a restoration failure', async () => {
    const body = new Error('body failed');
    const cleanup = new Error('cleanup failed');
    const release = vi.fn(async () => {
      throw cleanup;
    });
    const failure = await finishReviewProofEnvironment({ release }, { kind: 'failed', error: body }).catch(
      (error: unknown) => error
    );
    if (!(failure instanceof AggregateError)) throw new Error('Missing combined proof failure');
    expect(failure.errors).toEqual([body, cleanup]);
  });

  it('blocks uncontrolled HTTP until release and restores the captured value only once', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    let completeRestore: () => void = () => {
      throw new Error('Restoration has not started');
    };
    const restore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeRestore = resolve;
        })
    );
    const environment = await acquireReviewProofEnvironment(async () => 'original value', restore);

    await expect(globalThis.fetch('https://invalid.example')).rejects.toThrow('Uncontrolled network denied');
    expect(fetch).not.toHaveBeenCalled();
    const firstRelease = environment.release();
    expect(globalThis.fetch).toBe(fetch);
    expect(environment.release()).toBe(firstRelease);
    await Promise.resolve();
    expect(restore).toHaveBeenCalledExactlyOnceWith('original value');
    const captureDuringRestore = vi.fn(async () => 'overlap');
    await expect(acquireReviewProofEnvironment(captureDuringRestore, vi.fn())).rejects.toThrow('already owned');
    expect(captureDuringRestore).not.toHaveBeenCalled();
    completeRestore();
    await firstRelease;
    await environment.release();
    expect(restore).toHaveBeenCalledTimes(1);
    const next = await acquireReviewProofEnvironment(async () => 'next', vi.fn());
    await next.release();
  });

  it('restores fetch even when restoring a missing storage baseline fails', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const error = new Error('restore failed');
    const restore = vi.fn(async () => {
      throw error;
    });
    const environment = await acquireReviewProofEnvironment(async () => null, restore);

    await expect(environment.release()).rejects.toBe(error);
    expect(globalThis.fetch).toBe(fetch);
    await expect(environment.release()).rejects.toBe(error);
    expect(restore).toHaveBeenCalledExactlyOnceWith(null);
  });
});
