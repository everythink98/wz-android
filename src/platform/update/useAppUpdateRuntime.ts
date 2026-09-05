import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import type { DownloadTask } from 'expo-file-system';
import {
  type AppUpdateInfo,
  type ApkInstaller,
  checkGithubAppUpdate,
  CURRENT_APP_VERSION,
  formatAppUpdateDownloadProgress,
  openApkInstaller,
  verifyDownloadedApk,
  isInvalidApk,
  sameAppUpdate,
  type AppUpdateDownloadProgress
} from './appUpdate';
import {
  type AppUpdateArtifact,
  appUpdateFile,
  createAppUpdateDownload,
  finishAppUpdateDownload,
  inspectAppUpdateArtifact,
  prepareAppUpdateArtifact,
  restoreAppUpdateArtifact,
  saveAppUpdateArtifact
} from './appUpdateDownload';
import { errorMessage } from '@/platform/network/errors';
import type { Fetcher } from '@/platform/network/request';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

export type AppUpdatePhase = 'restoring' | 'idle' | 'checking' | 'downloading' | 'pausing' | 'verifying' | 'installing';
type UseAppUpdateRuntimeOptions = {
  autoCheck?: boolean;
  beforeRequest?: () => Promise<void>;
  fetcher: Fetcher;
  notify: (message: string) => void;
};
type CurrentOperation = () => boolean;
type UpdateTrace = ReturnType<typeof beginDiagnosticTrace>;

// One app-level writer. A rebuilt runtime must wait for the old writer and its metadata saves to settle.
let settledUpdateOperation = Promise.resolve();

export function useAppUpdateRuntime({ autoCheck = false, beforeRequest, fetcher, notify }: UseAppUpdateRuntimeOptions) {
  const [phase, setPhase] = useState<AppUpdatePhase>('restoring');
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [artifact, setArtifact] = useState<AppUpdateArtifact | null>(null);
  const [appUpdateMessage, setAppUpdateMessage] = useState(`当前版本 ${CURRENT_APP_VERSION}`);
  const [appUpdateDownloadProgress, setAppUpdateDownloadProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const phaseRef = useRef<AppUpdatePhase>('restoring');
  const artifactRef = useRef<AppUpdateArtifact | null>(null);
  const availableRef = useRef<AppUpdateInfo | null>(null);
  const taskRef = useRef<DownloadTask | null>(null);
  const operationRef = useRef(0);
  const mountedRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const autoCheckStartedRef = useRef(false);
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const transition = useCallback((next: AppUpdatePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const applyArtifact = useCallback((next: AppUpdateArtifact | null) => {
    artifactRef.current = next;
    setArtifact(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const token = ++operationRef.current;
    transition('restoring');
    const recovery = settledUpdateOperation.then(() => {
      if (!mountedRef.current || token !== operationRef.current) return null;
      return restoreAppUpdateArtifact();
    });
    settledUpdateOperation = recovery.then(
      () => undefined,
      () => undefined
    );
    void recovery
      .then((restored) => {
        if (!mountedRef.current || token !== operationRef.current) return;
        applyArtifact(restored);
        if (restored) setAppUpdateMessage(restored.ready ? '安装包已就绪，可再次安装' : '下载进度已保留，可继续下载');
      })
      .catch((error) => {
        if (mountedRef.current && token === operationRef.current) setAppUpdateMessage(errorMessage(error));
      })
      .finally(() => {
        if (mountedRef.current && token === operationRef.current) transition('idle');
      });
    return () => {
      mountedRef.current = false;
      const task = taskRef.current;
      if (task) {
        const stopped = task.state === 'active' ? task.pauseAsync() : Promise.resolve();
        void stopped.catch(() => undefined);
      }
    };
  }, [applyArtifact, transition]);

  const runOperation = useCallback(
    async (
      initialPhase: AppUpdatePhase,
      operation: 'check' | 'download' | 'install',
      action: (current: CurrentOperation, trace: UpdateTrace) => Promise<void>,
      silent = false
    ) => {
      if (!mountedRef.current || phaseRef.current !== 'idle') return;
      const token = ++operationRef.current;
      const current = () => mountedRef.current && token === operationRef.current;
      pauseRequestedRef.current = false;
      transition(initialPhase);
      const trace = beginDiagnosticTrace('update', operation);
      const execution = settledUpdateOperation.then(async () => {
        if (current()) await action(current, trace);
      });
      settledUpdateOperation = execution.catch(() => undefined);
      try {
        await execution;
        finishDiagnosticTrace(trace, current() ? 'success' : 'canceled');
      } catch (error) {
        finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
        if (current() && !silent) {
          const saved = artifactRef.current;
          const recovery =
            operation === 'check' || !saved
              ? ''
              : saved.ready
                ? '，安装包已保留，可再次安装'
                : saved.downloadedBytes > 0
                  ? '，进度已保留，可继续下载'
                  : '，可重新下载';
          const message = `${errorMessage(error)}${recovery}`;
          setAppUpdateMessage(message);
          notifyRef.current(message);
        }
      } finally {
        if (current()) {
          taskRef.current?.release();
          taskRef.current = null;
          setAppUpdateDownloadProgress(null);
          transition('idle');
        }
      }
    },
    [transition]
  );

  const checkAppUpdate = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      await runOperation(
        'checking',
        'check',
        async (current, trace) => {
          await beforeRequest?.();
          if (!current()) return;
          const update = await checkGithubAppUpdate(withDiagnosticFetcher(trace, fetcher));
          if (!current()) return;
          availableRef.current = update;
          setAppUpdateInfo(update);
          const message = update ? `发现新版 ${update.version}` : `已是最新版 ${CURRENT_APP_VERSION}`;
          if (!artifactRef.current || !silent) setAppUpdateMessage(message);
          if (!silent) notifyRef.current(message);
        },
        silent
      );
    },
    [beforeRequest, fetcher, runOperation]
  );

  const installArtifact = useCallback(
    async (target: AppUpdateArtifact, current: CurrentOperation, trace: UpdateTrace) => {
      transition('verifying');
      const installer = NativeModules.ApkInstallerModule as ApkInstaller | undefined;
      const file = appUpdateFile(target.update, true);
      try {
        await verifyDownloadedApk(installer, file.uri, target.update);
      } catch (error) {
        if (current() && isInvalidApk(error)) {
          if (file.exists) file.delete();
          applyArtifact({ ...target, ready: false, downloadedBytes: 0 });
        }
        throw error;
      }
      if (!current()) return;
      transition('installing');
      await openApkInstaller(installer, file.uri);
      if (!current()) return;
      markDiagnosticStage(trace, 'apply', { state: 'installer-opened' });
      setAppUpdateMessage('已打开安装确认，可随时回来再次安装');
      notifyRef.current('已打开安装确认');
    },
    [applyArtifact, transition]
  );

  const transfer = useCallback(
    async (target: AppUpdateArtifact, current: CurrentOperation, trace: UpdateTrace) => {
      let latest = target;
      let pendingSave = Promise.resolve();
      let saveError: unknown;
      try {
        if (!target.ready) {
          if (!pauseRequestedRef.current) await beforeRequest?.();
          if (!current()) return;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (pauseRequestedRef.current) break;
            transition('downloading');
            const task = createAppUpdateDownload(latest, (data) => {
              if (!current() || phaseRef.current !== 'downloading' || taskRef.current !== task) return;
              const progress = formatAppUpdateDownloadProgress(
                target.update.version,
                data.bytesWritten,
                data.totalBytes
              );
              setAppUpdateDownloadProgress(progress);
              if (progress.totalBytes !== latest.totalBytes) {
                latest = { ...latest, totalBytes: progress.totalBytes };
                const snapshot = latest;
                pendingSave = pendingSave
                  .then(() => saveAppUpdateArtifact(snapshot))
                  .catch((error) => {
                    saveError = error;
                  });
              }
            });
            taskRef.current = task;
            markDiagnosticStage(trace, 'transport', { endpoint: 'github', method: 'GET', state: 'start' });
            try {
              const result = await (task.state === 'paused' ? task.resumeAsync() : task.downloadAsync());
              if (!current()) return;
              if (!result) break;
              await pendingSave;
              transition('verifying');
              setAppUpdateMessage('下载完成，正在校验安装包');
              latest = await finishAppUpdateDownload(latest);
              if (saveError) throw saveError;
              break;
            } catch (error) {
              if (!current()) return;
              const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
              if (
                attempt === 0 &&
                ['ERR_DOWNLOAD_RANGE', 'ERR_DOWNLOAD_RANGE_NOT_SATISFIABLE'].includes(String(code))
              ) {
                latest = await inspectAppUpdateArtifact(latest);
                if (latest.ready) break;
                const partial = appUpdateFile(latest.update);
                if (partial.exists) partial.delete();
                latest = { ...latest, totalBytes: null, downloadedBytes: 0 };
                await pendingSave;
                await saveAppUpdateArtifact(latest);
                setAppUpdateMessage('断点已失效，正在重新下载');
              } else {
                throw error;
              }
            } finally {
              task.release();
              if (taskRef.current === task) taskRef.current = null;
            }
          }
        }
      } finally {
        await pendingSave;
        if (current()) {
          const partial = appUpdateFile(latest.update);
          latest = {
            ...latest,
            downloadedBytes: latest.ready ? latest.downloadedBytes : partial.exists ? partial.size : 0
          };
          applyArtifact(latest);
        }
      }
      if (!current()) return;
      if (!latest.ready) {
        setAppUpdateMessage('下载已暂停，进度已保留');
        return;
      }
      setAppUpdateMessage('安装包已就绪，可安装');
      if (AppState.currentState === 'active' && !pauseRequestedRef.current)
        await installArtifact(latest, current, trace);
    },
    [applyArtifact, beforeRequest, installArtifact, transition]
  );

  const startAppUpdateDownload = useCallback(async () => {
    const update = availableRef.current;
    if (!update) return;
    await runOperation('downloading', 'download', async (current, trace) => {
      const existing = artifactRef.current;
      if (!current()) return;
      const target =
        sameAppUpdate(existing?.update, update) && existing ? existing : await prepareAppUpdateArtifact(update);
      if (!current()) return;
      applyArtifact(target);
      await transfer(target, current, trace);
    });
  }, [applyArtifact, runOperation, transfer]);

  const resumeAppUpdateDownload = useCallback(async () => {
    const target = artifactRef.current;
    if (!target || target.ready) return;
    await runOperation('downloading', 'download', async (current, trace) => {
      const restored = await inspectAppUpdateArtifact(target);
      if (current()) await transfer(restored, current, trace);
    });
  }, [runOperation, transfer]);

  const pauseAppUpdateDownload = useCallback(async () => {
    if (phaseRef.current !== 'downloading') return;
    pauseRequestedRef.current = true;
    transition('pausing');
    const task = taskRef.current;
    if (task?.state === 'active') {
      try {
        await task.pauseAsync();
      } catch (error) {
        if (mountedRef.current) setAppUpdateMessage(errorMessage(error));
      }
    }
  }, [transition]);

  const installAppUpdate = useCallback(async () => {
    const target = artifactRef.current;
    if (!target?.ready) return;
    await runOperation('verifying', 'install', (current, trace) => installArtifact(target, current, trace));
  }, [installArtifact, runOperation]);

  useEffect(() => {
    if (!autoCheck || phase !== 'idle' || autoCheckStartedRef.current) return;
    autoCheckStartedRef.current = true;
    void checkAppUpdate({ silent: true });
  }, [autoCheck, checkAppUpdate, phase]);

  return {
    phase,
    artifact,
    appUpdateBusy: phase !== 'idle',
    appUpdateDownloading: phase === 'downloading' || phase === 'pausing',
    appUpdateDownloadProgress,
    appUpdateInfo,
    appUpdateMessage,
    checkAppUpdate,
    startAppUpdateDownload,
    pauseAppUpdateDownload,
    resumeAppUpdateDownload,
    installAppUpdate
  };
}
