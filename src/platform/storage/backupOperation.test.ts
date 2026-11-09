import { describe, expect, it, vi } from 'vitest';
import { runBackupOperation } from './backupOperation';

describe('backup operation runner', () => {
  it('runs one operation and resets busy state afterwards', async () => {
    const busyRef = { current: false };
    const setBusy = vi.fn();
    const notify = vi.fn();
    const task = vi.fn().mockResolvedValue(undefined);

    const didRun = await runBackupOperation({ busyRef, setBusy, notify, task });

    expect(didRun).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(setBusy).toHaveBeenNthCalledWith(1, true);
    expect(setBusy).toHaveBeenNthCalledWith(2, false);
    expect(busyRef.current).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies errors and resets busy state', async () => {
    const busyRef = { current: false };
    const setBusy = vi.fn();
    const notify = vi.fn();
    const task = vi.fn().mockRejectedValue(new Error('backup failed'));

    const didRun = await runBackupOperation({ busyRef, setBusy, notify, task });

    expect(didRun).toBe(false);
    expect(notify).toHaveBeenCalledWith('backup failed');
    expect(setBusy).toHaveBeenNthCalledWith(1, true);
    expect(setBusy).toHaveBeenNthCalledWith(2, false);
    expect(busyRef.current).toBe(false);
  });

  it('keeps the active permit when an overlapping operation is rejected', async () => {
    const busyRef = { current: false };
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const setBusy = vi.fn();
    const notify = vi.fn();
    const task = vi.fn(async () => {
      entered.resolve();
      await release.promise;
    });
    const first = runBackupOperation({ busyRef, setBusy, notify, task });
    await entered.promise;
    const nextTask = vi.fn().mockResolvedValue(undefined);
    try {
      await expect(runBackupOperation({ busyRef, setBusy, notify, task: nextTask })).resolves.toBe(false);
      expect(nextTask).not.toHaveBeenCalled();
      expect(busyRef.current).toBe(true);
      expect(setBusy.mock.calls).toEqual([[true]]);
    } finally {
      release.resolve();
      await first;
    }
    expect(busyRef.current).toBe(false);
    await expect(runBackupOperation({ busyRef, setBusy, notify, task: nextTask })).resolves.toBe(true);
    expect(nextTask).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
