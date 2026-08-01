import { errorMessage } from '@/platform/network/errors';

type BackupBusyRef = { current: boolean };

export async function runBackupOperation({
  busyRef,
  notify,
  setBusy,
  task
}: {
  busyRef: BackupBusyRef;
  notify: (message: string) => void;
  setBusy: (value: boolean) => void;
  task: () => Promise<void>;
}) {
  if (busyRef.current) {
    return false;
  }
  busyRef.current = true;
  setBusy(true);
  try {
    await task();
    return true;
  } catch (error) {
    notify(errorMessage(error));
    return false;
  } finally {
    busyRef.current = false;
    setBusy(false);
  }
}
