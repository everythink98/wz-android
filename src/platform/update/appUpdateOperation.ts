import type { DownloadTask } from 'expo-file-system';
import type { AppUpdateDownloadProgress } from './appUpdate';

export function createAppUpdateProgress(initial: AppUpdateDownloadProgress | null = null) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: AppUpdateDownloadProgress | null) {
      if (
        current?.title === next?.title &&
        current?.downloadedBytes === next?.downloadedBytes &&
        current?.totalBytes === next?.totalBytes
      )
        return;
      current = next;
      listeners.forEach((listener) => listener());
    }
  };
}
export type AppUpdateProgressSource = Pick<ReturnType<typeof createAppUpdateProgress>, 'getSnapshot' | 'subscribe'>;

export type AppUpdatePhase = 'restoring' | 'idle' | 'checking' | 'downloading' | 'pausing' | 'verifying' | 'installing';
type RunningPhase = Exclude<AppUpdatePhase, 'restoring' | 'idle'>;
type Work =
  | { phase: 'restoring' | 'idle'; identity: object }
  | { phase: RunningPhase; identity: object; intent: 'continue' | 'pause' };
type Binding = 'attached' | 'detached';
type Task = { kind: 'none' } | { kind: 'owned'; identity: object; task: DownloadTask };

export function createAppUpdateOperations() {
  let work: Work = { phase: 'restoring', identity: {} };
  let binding: Binding = 'attached';
  let resource: Task = { kind: 'none' };
  const current = (identity: object) => binding === 'attached' && work.identity === identity;
  const ticket = (identity: object) => ({
    current: () => current(identity),
    get pauseRequested() {
      return work.identity === identity && 'intent' in work && work.intent === 'pause';
    },
    stage(phase: RunningPhase) {
      if (current(identity) && 'intent' in work) work = { ...work, phase };
    },
    created(task: DownloadTask) {
      resource = { kind: 'owned', identity, task };
    },
    acceptsProgress(task: DownloadTask) {
      return (
        current(identity) &&
        work.phase === 'downloading' &&
        resource.kind === 'owned' &&
        resource.identity === identity &&
        resource.task === task
      );
    },
    released(task: DownloadTask) {
      task.release();
      if (resource.kind === 'owned' && resource.task === task) resource = { kind: 'none' };
    },
    finished() {
      if (!current(identity)) return false;
      if (resource.kind === 'owned' && resource.identity === identity) {
        resource.task.release();
        resource = { kind: 'none' };
      }
      work = { phase: 'idle', identity };
      return true;
    }
  });
  return {
    get phase() {
      return work.phase;
    },
    restore() {
      binding = 'attached';
      const identity = {};
      work = { phase: 'restoring', identity };
      return ticket(identity);
    },
    retire() {
      binding = 'detached';
      return resource.kind === 'owned' ? resource.task : null;
    },
    begin(kind: 'check' | 'download' | 'install') {
      if (binding === 'detached' || work.phase !== 'idle') return null;
      const identity = {};
      work = {
        phase: kind === 'check' ? 'checking' : kind === 'download' ? 'downloading' : 'verifying',
        identity,
        intent: 'continue'
      };
      return ticket(identity);
    },
    pause() {
      if (binding === 'detached' || work.phase !== 'downloading') return null;
      const identity = work.identity;
      work = { ...work, phase: 'pausing', intent: 'pause' };
      return {
        task: resource.kind === 'owned' && resource.identity === identity ? resource.task : null,
        failed() {
          if (!current(identity) || work.phase !== 'pausing') return false;
          // Keep the pause intent so completion leaves the package ready for manual installation.
          work = { ...work, phase: 'downloading' };
          return true;
        }
      };
    }
  };
}

export type AppUpdateOperation = NonNullable<ReturnType<ReturnType<typeof createAppUpdateOperations>['begin']>>;
