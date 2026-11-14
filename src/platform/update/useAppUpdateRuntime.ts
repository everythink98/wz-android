import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import { createAppUpdateOperations, type AppUpdateOperation, type AppUpdatePhase } from './appUpdateOperation';
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

export type { AppUpdatePhase } from './appUpdateOperation';

type UseAppUpdateRuntimeOptions = {
  autoCheck?: boolean;
  beforeRequest?: () => Promise<void>;
  fetcher: Fetcher;
  notify: (message: string) => void;
};
type UpdateTrace = ReturnType<typeof beginDiagnosticTrace>;

// One app-level writer. A rebuilt runtime must wait for the old writer and its metadata saves to settle.
let settledUpdateOperation = Promise.resolve();

export function useAppUpdateRuntime({ autoCheck = false, beforeRequest, fetcher, notify }: UseAppUpdateRuntimeOptions) {
  const [operations] = useState(createAppUpdateOperations);
  const [phase, setPhase] = useState<AppUpdatePhase>(operations.phase);
  const publishPhase = useCallback(() => setPhase(operations.phase), [operations]);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [artifact, setArtifact] = useState<AppUpdateArtifact | null>(null);
  const [appUpdateMessage, setAppUpdateMessage] = useState(`当前版本 ${CURRENT_APP_VERSION}`);
  const [appUpdateDownloadProgress, setAppUpdateDownloadProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const artifactRef = useRef<AppUpdateArtifact | null>(null);
  const availableRef = useRef<AppUpdateInfo | null>(null);
  const autoCheckStartedRef = useRef(false);
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const applyArtifact = useCallback((next: AppUpdateArtifact | null) => {
    artifactRef.current = next;
    setArtifact(next);
  }, []);

  useEffect(() => {
    const operation = operations.restore();
    publishPhase();
    const recovery = settledUpdateOperation.then(() => {
      if (!operation.current()) return null;
      return restoreAppUpdateArtifact();
    });
    settledUpdateOperation = recovery.then(
      () => undefined,
      () => undefined
    );
    void recovery
      .then((restored) => {
        if (!operation.current()) return;
        applyArtifact(restored);
        if (restored)
          setAppUpdateMessage(restored.kind === 'verified' ? '安装包已就绪，可再次安装' : '下载进度已保留，可继续下载');
      })
      .catch((error) => {
        if (operation.current()) setAppUpdateMessage(errorMessage(error));
      })
      .finally(() => {
        if (operation.finished()) publishPhase();
      });
    return () => {
      const task = operations.retire();
      if (task) {
        const stopped = task.state === 'active' ? task.pauseAsync() : Promise.resolve();
        void stopped.catch(() => undefined);
      }
    };
  }, [applyArtifact, operations, publishPhase]);

  const runOperation = useCallback(
    async (
      operation: 'check' | 'download' | 'install',
      action: (request: AppUpdateOperation, trace: UpdateTrace) => Promise<void>,
      silent = false
    ) => {
      const request = operations.begin(operation);
      if (!request) return;
      publishPhase();
      const trace = beginDiagnosticTrace('update', operation);
      const execution = settledUpdateOperation.then(async () => {
        if (request.current()) await action(request, trace);
      });
      settledUpdateOperation = execution.catch(() => undefined);
      try {
        await execution;
        finishDiagnosticTrace(trace, request.current() ? 'success' : 'canceled', {
          ...(operation === 'download'
            ? {
                state: artifactRef.current?.kind === 'verified' ? 'verified' : 'paused',
                downloadedBytes:
                  artifactRef.current?.kind === 'verified'
                    ? artifactRef.current.bytes
                    : artifactRef.current?.downloadedBytes || 0
              }
            : {})
        });
      } catch (error) {
        finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
        if (request.current() && !silent) {
          const saved = artifactRef.current;
          const recovery =
            operation === 'check' || !saved
              ? ''
              : saved.kind === 'verified'
                ? '，安装包已保留，可再次安装'
                : saved.downloadedBytes > 0
                  ? '，进度已保留，可继续下载'
                  : '，可重新下载';
          const message = `${errorMessage(error)}${recovery}`;
          setAppUpdateMessage(message);
          notifyRef.current(message);
        }
      } finally {
        if (request.finished()) {
          setAppUpdateDownloadProgress(null);
          publishPhase();
        }
      }
    },
    [operations, publishPhase]
  );

  const checkAppUpdate = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      await runOperation(
        'check',
        async (request, trace) => {
          await beforeRequest?.();
          if (!request.current()) return;
          const update = await checkGithubAppUpdate(withDiagnosticFetcher(trace, fetcher));
          if (!request.current()) return;
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
    async (
      target: Extract<AppUpdateArtifact, { kind: 'verified' }>,
      request: AppUpdateOperation,
      trace: UpdateTrace
    ) => {
      request.stage('verifying');
      publishPhase();
      const installer = NativeModules.ApkInstallerModule as ApkInstaller | undefined;
      const file = appUpdateFile(target.update, true);
      markDiagnosticStage(trace, 'parse', { state: 'package-verification', versionCode: target.update.versionCode });
      try {
        await verifyDownloadedApk(installer, file.uri, target.update);
        markDiagnosticStage(trace, 'parse', { state: 'verified' });
      } catch (error) {
        markDiagnosticStage(trace, 'parse', {
          state: 'failure',
          reason: isInvalidApk(error) ? 'invalid_response' : normalizeDiagnosticReason(error)
        });
        if (request.current() && isInvalidApk(error)) {
          if (file.exists) file.delete();
          applyArtifact({ kind: 'partial', update: target.update, totalBytes: target.bytes, downloadedBytes: 0 });
        }
        throw error;
      }
      if (!request.current()) return;
      request.stage('installing');
      publishPhase();
      await openApkInstaller(installer, file.uri);
      if (!request.current()) return;
      markDiagnosticStage(trace, 'apply', { state: 'installer-opened' });
      setAppUpdateMessage('已打开安装确认，可随时回来再次安装');
      notifyRef.current('已打开安装确认');
    },
    [applyArtifact, publishPhase]
  );

  const transfer = useCallback(
    async (target: AppUpdateArtifact, request: AppUpdateOperation, trace: UpdateTrace) => {
      let latest = target;
      let pendingSave = Promise.resolve();
      let saveError: unknown;
      try {
        if (target.kind === 'partial') {
          if (!request.pauseRequested) await beforeRequest?.();
          if (!request.current()) return;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (request.pauseRequested || latest.kind === 'verified') break;
            request.stage('downloading');
            publishPhase();
            const task = createAppUpdateDownload(latest, (data) => {
              if (!request.acceptsProgress(task) || latest.kind !== 'partial') return;
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
                    markDiagnosticStage(trace, 'persist', { state: 'failure', reason: 'storage_error' });
                    saveError = error;
                  });
              }
            });
            request.created(task);
            markDiagnosticStage(trace, 'transport', {
              endpoint: 'github',
              method: 'GET',
              state: task.state === 'paused' ? 'resuming' : 'start',
              downloadedBytes: latest.downloadedBytes,
              retryCount: attempt
            });
            try {
              const result = await (task.state === 'paused' ? task.resumeAsync() : task.downloadAsync());
              if (!request.current()) return;
              if (!result) break;
              await pendingSave;
              request.stage('verifying');
              publishPhase();
              setAppUpdateMessage('下载完成，正在校验安装包');
              latest = await finishAppUpdateDownload(latest, trace);
              if (saveError) throw saveError;
              break;
            } catch (error) {
              if (!request.current()) return;
              const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
              if (
                attempt === 0 &&
                ['ERR_DOWNLOAD_RANGE', 'ERR_DOWNLOAD_RANGE_NOT_SATISFIABLE'].includes(String(code))
              ) {
                latest = await inspectAppUpdateArtifact(latest, trace);
                if (latest.kind === 'verified') break;
                const partial = appUpdateFile(latest.update);
                if (partial.exists) partial.delete();
                latest = { ...latest, totalBytes: null, downloadedBytes: 0 };
                markDiagnosticStage(trace, 'transport', {
                  state: 'full-download-retry',
                  retryCount: 1,
                  downloadedBytes: 0
                });
                await pendingSave;
                await saveAppUpdateArtifact(latest);
                setAppUpdateMessage('断点已失效，正在重新下载');
              } else {
                throw error;
              }
            } finally {
              request.released(task);
            }
          }
        }
      } finally {
        await pendingSave;
        if (request.current()) {
          const partial = appUpdateFile(latest.update);
          if (latest.kind === 'partial') latest = { ...latest, downloadedBytes: partial.exists ? partial.size : 0 };
          applyArtifact(latest);
        }
      }
      if (!request.current()) return;
      if (latest.kind === 'partial') {
        setAppUpdateMessage('下载已暂停，进度已保留');
        return;
      }
      setAppUpdateMessage('安装包已就绪，可安装');
      if (AppState.currentState === 'active' && !request.pauseRequested) await installArtifact(latest, request, trace);
    },
    [applyArtifact, beforeRequest, installArtifact, publishPhase]
  );

  const startAppUpdateDownload = useCallback(async () => {
    const update = availableRef.current;
    if (!update) return;
    await runOperation('download', async (request, trace) => {
      const existing = artifactRef.current;
      if (!request.current()) return;
      const target =
        sameAppUpdate(existing?.update, update) && existing ? existing : await prepareAppUpdateArtifact(update, trace);
      if (!request.current()) return;
      applyArtifact(target);
      await transfer(target, request, trace);
    });
  }, [applyArtifact, runOperation, transfer]);

  const resumeAppUpdateDownload = useCallback(async () => {
    const target = artifactRef.current;
    if (!target || target.kind === 'verified') return;
    await runOperation('download', async (request, trace) => {
      const restored = await inspectAppUpdateArtifact(target, trace);
      if (request.current()) await transfer(restored, request, trace);
    });
  }, [runOperation, transfer]);

  const pauseAppUpdateDownload = useCallback(async () => {
    const pause = operations.pause();
    if (!pause) return;
    publishPhase();
    const trace = beginDiagnosticTrace('update', 'pause');
    const task = pause.task;
    if (task?.state === 'active') {
      try {
        await task.pauseAsync();
      } catch (error) {
        finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
        if (operations.attached) setAppUpdateMessage(errorMessage(error));
      }
    }
    finishDiagnosticTrace(trace, 'success', { state: 'paused' });
  }, [operations, publishPhase]);

  const installAppUpdate = useCallback(async () => {
    const target = artifactRef.current;
    if (target?.kind !== 'verified') return;
    await runOperation('install', (request, trace) => installArtifact(target, request, trace));
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
