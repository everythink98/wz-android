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

  it('does not start another operation while busy', async () => {
    const busyRef = { current: true };
    const setBusy = vi.fn();
    const notify = vi.fn();
    const task = vi.fn().mockResolvedValue(undefined);

    const didRun = await runBackupOperation({ busyRef, setBusy, notify, task });

    expect(didRun).toBe(false);
    expect(task).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(busyRef.current).toBe(true);
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
});
