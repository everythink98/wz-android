import { useCallback, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AppUpdateInfo,
  checkGithubAppUpdate,
  CURRENT_APP_VERSION,
  formatAppUpdateDownloadProgress,
  installVerifiedApk,
  type ApkInstaller,
  type AppUpdateDownloadProgress
} from '@/platform/update/appUpdate';
import { errorMessage } from '@/platform/network/errors';
import type { Fetcher } from '@/platform/network/request';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';

type CheckAppUpdateOptions = {
  silent?: boolean;
};

type UseAppUpdateControllerOptions = {
  beforeRequest?: () => Promise<void>;
  fetcher: Fetcher;
  notify: (message: string) => void;
};

export function useAppUpdateController({ beforeRequest, fetcher, notify }: UseAppUpdateControllerOptions) {
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateDownloading, setAppUpdateDownloading] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [appUpdateMessage, setAppUpdateMessage] = useState(`当前版本 ${CURRENT_APP_VERSION}`);
  const [appUpdateDownloadProgress, setAppUpdateDownloadProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const appUpdateBusyRef = useRef(false);
  const appUpdateDownloadingRef = useRef(false);

  const checkAppUpdate = useCallback(
    async (options: CheckAppUpdateOptions = {}) => {
      const silent = options.silent === true;
      const trace = beginDiagnosticTrace('update', 'check', { mode: silent ? 'silent' : 'manual' });
      if (appUpdateBusyRef.current || appUpdateDownloadingRef.current) {
        markDiagnosticStage(trace, 'guard', { state: 'busy' });
        finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
        return;
      }
      appUpdateBusyRef.current = true;
      setAppUpdateBusy(true);
      if (!silent) {
        setAppUpdateInfo(null);
        setAppUpdateDownloadProgress(null);
        setAppUpdateMessage('正在检查更新');
      }
      try {
        markDiagnosticStage(trace, 'guard', { state: 'network-ready' });
        await beforeRequest?.();
        const update = await checkGithubAppUpdate(withDiagnosticFetcher(trace, fetcher));
        markDiagnosticStage(trace, 'parse', { state: update ? 'update-available' : 'current' });
        setAppUpdateInfo(update);
        if (update || !silent) {
          const message = update ? `发现新版 ${update.version}` : `已是最新版 ${CURRENT_APP_VERSION}`;
          setAppUpdateMessage(message);
          if (!silent) {
            notify(message);
          }
        }
        markDiagnosticStage(trace, 'apply', { state: 'status-updated' });
        finishDiagnosticTrace(trace, 'success', { state: update ? 'update-available' : 'current' });
      } catch (error) {
        finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
        if (!silent) {
          const message = errorMessage(error);
          setAppUpdateMessage(message);
          notify(message);
        }
      } finally {
        appUpdateBusyRef.current = false;
        setAppUpdateBusy(false);
      }
    },
    [beforeRequest, fetcher, notify]
  );

  const downloadAppUpdate = useCallback(async () => {
    const trace = beginDiagnosticTrace('update', 'download');
    if (!appUpdateInfo || appUpdateBusyRef.current || appUpdateDownloadingRef.current) {
      const busy = appUpdateBusyRef.current || appUpdateDownloadingRef.current;
      markDiagnosticStage(trace, 'guard', { state: busy ? 'busy' : 'missing-update' });
      finishDiagnosticTrace(trace, 'blocked', {
        reason: busy ? 'busy' : 'not_ready'
      });
      return;
    }
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      markDiagnosticStage(trace, 'guard', { state: 'cache-unavailable' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'storage_error' });
      notify('无法访问本机缓存目录。');
      return;
    }
    const target = `${baseDirectory}wz-update.apk`;
    appUpdateDownloadingRef.current = true;
    setAppUpdateDownloading(true);
    let latestProgress = formatAppUpdateDownloadProgress(appUpdateInfo.version, 0, -1);
    let downloadStartedAt = 0;
    let targetPrepared = false;
    setAppUpdateDownloadProgress(latestProgress);
    setAppUpdateMessage(latestProgress.title);
    try {
      markDiagnosticStage(trace, 'guard', { state: 'network-ready' });
      await beforeRequest?.();
      downloadStartedAt = Date.now();
      markDiagnosticStage(trace, 'transport', {
        endpoint: 'github',
        method: 'GET',
        state: 'start'
      });
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      targetPrepared = true;
      const download = FileSystem.createDownloadResumable(appUpdateInfo.apkUrl, target, {}, (progress) => {
        latestProgress = formatAppUpdateDownloadProgress(
          appUpdateInfo.version,
          progress.totalBytesWritten,
          progress.totalBytesExpectedToWrite
        );
        setAppUpdateDownloadProgress(latestProgress);
        setAppUpdateMessage(latestProgress.title);
      });
      const result = await download.downloadAsync();
      if (!result) {
        throw new Error('下载已取消。');
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`下载失败：HTTP ${result.status}`);
      }
      markDiagnosticStage(trace, 'transport', {
        endpoint: 'github',
        method: 'GET',
        state: 'finish',
        status: result.status,
        byteCount: latestProgress.downloadedBytes,
        transportDurationMs: Math.max(0, Date.now() - downloadStartedAt)
      });
      const verifyingProgress: AppUpdateDownloadProgress = {
        ...latestProgress,
        title: '下载完成，正在校验安装包',
        percent: latestProgress.totalBytes === null ? latestProgress.percent : 100,
        percentLabel: latestProgress.totalBytes === null ? latestProgress.percentLabel : '100%'
      };
      setAppUpdateDownloadProgress(verifyingProgress);
      setAppUpdateMessage(verifyingProgress.title);
      markDiagnosticStage(trace, 'parse', { state: 'package-verification' });
      const installer = NativeModules.ApkInstallerModule as ApkInstaller | undefined;
      await installVerifiedApk(installer, result.uri, appUpdateInfo);
      markDiagnosticStage(trace, 'apply', { state: 'installer-opened' });
      setAppUpdateMessage('下载完成，请确认安装');
      notify('下载完成，请确认安装');
      finishDiagnosticTrace(trace, 'success');
    } catch (error) {
      if (targetPrepared) {
        await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      }
      const reason = normalizeDiagnosticReason(error);
      if (downloadStartedAt) {
        markDiagnosticStage(trace, 'transport', {
          endpoint: 'github',
          method: 'GET',
          state: 'failure',
          transportDurationMs: Math.max(0, Date.now() - downloadStartedAt),
          reason
        });
      }
      finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : 'failure', { reason });
      const message = errorMessage(error);
      setAppUpdateMessage(message);
      notify(message);
    } finally {
      appUpdateDownloadingRef.current = false;
      setAppUpdateDownloading(false);
      setAppUpdateDownloadProgress(null);
    }
  }, [appUpdateInfo, beforeRequest, notify]);

  return {
    appUpdateBusy,
    appUpdateDownloading,
    appUpdateDownloadProgress,
    appUpdateInfo,
    appUpdateMessage,
    checkAppUpdate,
    downloadAppUpdate
  };
}
