import { describe, expect, it, vi } from 'vitest';
import { runBackupOperation, type BackupOperationGate } from './backupOperation';

describe('backup operation runner', () => {
  it('runs one operation and resets busy state afterwards', async () => {
    const gate: BackupOperationGate = { current: { phase: 'idle' } };
    const observer = { signal: new AbortController().signal };
    const setBusy = vi.fn();
    const notify = vi.fn();
    const task = vi.fn().mockResolvedValue(undefined);

    const didRun = await runBackupOperation({ gate, observer, setBusy, notify, task });

    expect(didRun).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(setBusy).toHaveBeenNthCalledWith(1, true);
    expect(setBusy).toHaveBeenNthCalledWith(2, false);
    expect(gate.current.phase).toBe('idle');
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies errors and resets busy state', async () => {
    const gate: BackupOperationGate = { current: { phase: 'idle' } };
    const observer = { signal: new AbortController().signal };
    const setBusy = vi.fn();
    const notify = vi.fn();
    const task = vi.fn().mockRejectedValue(new Error('backup failed'));

    const didRun = await runBackupOperation({ gate, observer, setBusy, notify, task });

    expect(didRun).toBe(false);
    expect(notify).toHaveBeenCalledWith('backup failed');
    expect(setBusy).toHaveBeenNthCalledWith(1, true);
    expect(setBusy).toHaveBeenNthCalledWith(2, false);
    expect(gate.current.phase).toBe('idle');
  });

  it('keeps the active permit when an overlapping operation is rejected', async () => {
    const gate: BackupOperationGate = { current: { phase: 'idle' } };
    const observer = { signal: new AbortController().signal };
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const setBusy = vi.fn();
    const notify = vi.fn();
    const task = vi.fn(async () => {
      entered.resolve();
      await release.promise;
    });
    const first = runBackupOperation({ gate, observer, setBusy, notify, task });
    await entered.promise;
    const nextTask = vi.fn().mockResolvedValue(undefined);
    try {
      await expect(runBackupOperation({ gate, observer, setBusy, notify, task: nextTask })).resolves.toBe(false);
      expect(nextTask).not.toHaveBeenCalled();
      expect(gate.current.phase).toBe('running');
      expect(setBusy.mock.calls).toEqual([[true]]);
    } finally {
      release.resolve();
      await first;
    }
    expect(gate.current.phase).toBe('idle');
    await expect(runBackupOperation({ gate, observer, setBusy, notify, task: nextTask })).resolves.toBe(true);
    expect(nextTask).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
