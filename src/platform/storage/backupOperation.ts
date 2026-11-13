import { errorMessage } from '@/platform/network/errors';

type BackupObserver = { signal: AbortSignal };
export type BackupOperationGate = {
  current: { phase: 'idle' } | { phase: 'running'; observer: BackupObserver };
};

export async function runBackupOperation({
  gate,
  observer,
  notify,
  setBusy,
  task
}: {
  gate: BackupOperationGate;
  observer: BackupObserver;
  notify: (message: string) => void;
  setBusy: (value: boolean) => void;
  task: () => Promise<void>;
}) {
  if (gate.current.phase === 'running') {
    return false;
  }
  gate.current = { phase: 'running', observer };
  setBusy(true);
  try {
    await task();
    return true;
  } catch (error) {
    notify(errorMessage(error));
    return false;
  } finally {
    gate.current = { phase: 'idle' };
    setBusy(false);
  }
}
