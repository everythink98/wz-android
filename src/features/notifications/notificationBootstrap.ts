export type NotificationPermissionState = 'checking' | 'granted' | 'denied' | 'unavailable';
type Storage = { kind: 'unrestored' } | { kind: 'restored' } | { kind: 'failed'; message: string };
type Feedback = { kind: 'clear' } | { kind: 'failed'; message: string };
type Work = { kind: 'idle' } | { kind: 'running'; promise: Promise<void> };

export function createNotificationBootstrap() {
  let storage: Storage = { kind: 'unrestored' };
  let permission: NotificationPermissionState = 'checking';
  let feedback: Feedback = { kind: 'clear' };
  let work: Work = { kind: 'idle' };
  let snapshot: Readonly<{
    ready: boolean;
    storageError: string;
    permissionError: string;
    permission: NotificationPermissionState;
  }> = { ready: false, storageError: '', permissionError: '', permission };
  return {
    get pending() {
      return work.kind === 'running' ? work.promise : undefined;
    },
    get restored() {
      return storage.kind === 'restored';
    },
    get granted() {
      return permission === 'granted';
    },
    get snapshot() {
      const ready = storage.kind === 'restored';
      const storageError = storage.kind === 'failed' ? storage.message : '';
      const permissionError = feedback.kind === 'failed' ? feedback.message : '';
      if (
        snapshot.ready !== ready ||
        snapshot.storageError !== storageError ||
        snapshot.permissionError !== permissionError ||
        snapshot.permission !== permission
      )
        snapshot = { ready, storageError, permissionError, permission };
      return snapshot;
    },
    restoredStorage() {
      storage = { kind: 'restored' };
    },
    failedStorage() {
      storage = { kind: 'failed', message: '通知存储读取失败，请重试；原设置和通知记录已保留。' };
    },
    observedPermission(granted: boolean) {
      permission = granted ? 'granted' : 'denied';
      feedback = { kind: 'clear' };
    },
    requestedPermission(granted: boolean) {
      permission = granted ? 'granted' : 'denied';
    },
    failedPermission() {
      permission = 'unavailable';
      feedback = { kind: 'failed', message: '系统通知权限读取失败，请重试；站内消息仍可使用。' };
    },
    run(perform: () => Promise<void>) {
      if (work.kind === 'running') return work.promise;
      const result = Promise.withResolvers<void>();
      work = { kind: 'running', promise: result.promise };
      const finish = () => {
        if (work.kind === 'running' && work.promise === result.promise) work = { kind: 'idle' };
      };
      void perform().then(
        () => {
          finish();
          result.resolve();
        },
        (error) => {
          finish();
          result.reject(error);
        }
      );
      return result.promise;
    }
  };
}
