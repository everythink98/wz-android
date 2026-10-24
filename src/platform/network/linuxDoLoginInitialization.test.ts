import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForLinuxDoLoginInitialization, type LinuxDoLoginPage } from './linuxDoLoginInitialization';
import { readManagedCookieHeader } from './managedCookies';

vi.mock('./managedCookies', async (original) => ({
  ...(await original<typeof import('./managedCookies')>()),
  readManagedCookieHeader: vi.fn()
}));
vi.mock('react-native', () => ({ NativeModules: {} }));

let page: LinuxDoLoginPage | null;
let current: boolean;
const run = () =>
  waitForLinuxDoLoginInitialization(
    () => page,
    () => current
  );
beforeEach(() => {
  vi.useFakeTimers();
  current = true;
  page = {
    documentKey: 'https://linux.do/latest:1',
    pageStatus: 'logged-in',
    hasChallengeMarker: false,
    hasSessionInitialization: false
  };
  vi.mocked(readManagedCookieHeader)
    .mockReset()
    .mockResolvedValue({ status: 'ok', header: '_t=PRIVATE; _rt=OLD_PRIVATE' });
});
afterEach(() => vi.useRealTimers());

describe('linux.do page initialization handoff', () => {
  it('keeps an initialized login page open until its visible challenge is gone', async () => {
    page!.hasSessionInitialization = true;
    page!.hasChallengeMarker = true;
    const done = vi.fn();
    const result = run().then(done);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).not.toHaveBeenCalled();
    expect(readManagedCookieHeader).not.toHaveBeenCalled();
    page!.hasChallengeMarker = false;
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(done).toHaveBeenCalledWith(true);
  });

  it('waits for this document’s successful initialization and its HttpOnly cookie even if an old cookie exists', async () => {
    const done = vi.fn();
    const result = run().then(done);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).not.toHaveBeenCalled();
    expect(readManagedCookieHeader).not.toHaveBeenCalled();
    page!.hasSessionInitialization = true;
    vi.mocked(readManagedCookieHeader).mockResolvedValue({ status: 'ok', header: '_t=PRIVATE' });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).not.toHaveBeenCalled();
    vi.mocked(readManagedCookieHeader).mockResolvedValue({ status: 'ok', header: '_t=PRIVATE; _rt=NEW_PRIVATE' });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(done).toHaveBeenCalledWith(true);
    expect(readManagedCookieHeader).toHaveBeenCalledWith('https://linux.do/');
  });

  it('allows an initialized guest page without requiring a login cookie', async () => {
    page!.pageStatus = 'logged-out';
    vi.mocked(readManagedCookieHeader).mockResolvedValue({ status: 'ok', header: 'cf_clearance=PRIVATE' });
    await expect(run()).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not use a completed old document or a canceled read to release the page', async () => {
    page!.hasSessionInitialization = true;
    const read = Promise.withResolvers<Awaited<ReturnType<typeof readManagedCookieHeader>>>();
    vi.mocked(readManagedCookieHeader).mockReturnValue(read.promise);
    const result = run();
    page = { ...page!, documentKey: 'https://linux.do/latest:2' };
    read.resolve({ status: 'ok', header: '_t=PRIVATE; _rt=PRIVATE' });
    await expect(result).resolves.toBe(false);
    const canceledRead = Promise.withResolvers<Awaited<ReturnType<typeof readManagedCookieHeader>>>();
    vi.mocked(readManagedCookieHeader).mockReturnValueOnce(canceledRead.promise);
    const canceledResult = run();
    current = false;
    canceledRead.resolve({ status: 'ok', header: '_t=PRIVATE; _rt=PRIVATE' });
    await expect(canceledResult).resolves.toBe(false);
    await expect(run()).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out without treating an old cookie or elapsed time as completion', async () => {
    const result = expect(run()).rejects.toThrow('初始化尚未完成');
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });

  it('bounds a pending native cookie read by the original initialization deadline', async () => {
    const read = Promise.withResolvers<Awaited<ReturnType<typeof readManagedCookieHeader>>>();
    vi.mocked(readManagedCookieHeader).mockReturnValue(read.promise);
    const completed = vi.fn();
    const failed = vi.fn();
    const result = run().then(completed, failed);
    await vi.advanceTimersByTimeAsync(5_000);
    page!.hasSessionInitialization = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(readManagedCookieHeader).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(9_899);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('初始化尚未完成') })
    );
    await result;
    expect(vi.getTimerCount()).toBe(0);

    read.resolve({ status: 'ok', header: '_t=PRIVATE; _rt=PRIVATE' });
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
  });

  it('keeps a failed native cookie read distinct from a guest session', async () => {
    page!.hasSessionInitialization = true;
    vi.mocked(readManagedCookieHeader).mockResolvedValue({ status: 'unsupported' });
    await expect(run()).rejects.toThrow('不支持读取');
    expect(vi.getTimerCount()).toBe(0);
  });
});
