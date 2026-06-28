import { useCallback, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { AppUpdateInfo, checkGithubAppUpdate, CURRENT_APP_VERSION, formatAppUpdateDownloadProgress, installVerifiedApk, type ApkInstaller, type AppUpdateDownloadProgress } from '../appUpdate';
import { errorMessage } from '../appUtils';

type CheckAppUpdateOptions = {
  silent?: boolean;
};

export function useAppUpdateController({ notify }: { notify: (message: string) => void }) {
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateDownloading, setAppUpdateDownloading] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [appUpdateMessage, setAppUpdateMessage] = useState(`当前版本 ${CURRENT_APP_VERSION}`);
  const [appUpdateDownloadProgress, setAppUpdateDownloadProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const appUpdateBusyRef = useRef(false);
  const appUpdateDownloadingRef = useRef(false);

  const checkAppUpdate = useCallback(async (options: CheckAppUpdateOptions = {}) => {
    const silent = options.silent === true;
    if (appUpdateBusyRef.current || appUpdateDownloadingRef.current) {
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
      const update = await checkGithubAppUpdate();
      setAppUpdateInfo(update);
      if (update || !silent) {
        const message = update ? `发现新版 ${update.version}` : `已是最新版 ${CURRENT_APP_VERSION}`;
        setAppUpdateMessage(message);
        if (!silent) {
          notify(message);
        }
      }
    } catch (error) {
      if (!silent) {
        const message = errorMessage(error);
        setAppUpdateMessage(message);
        notify(message);
      }
    } finally {
      appUpdateBusyRef.current = false;
      setAppUpdateBusy(false);
    }
  }, [notify]);

  const downloadAppUpdate = useCallback(async () => {
    if (!appUpdateInfo || appUpdateDownloadingRef.current) {
      return;
    }
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      notify('无法访问本机缓存目录。');
      return;
    }
    appUpdateDownloadingRef.current = true;
    setAppUpdateDownloading(true);
    let latestProgress = formatAppUpdateDownloadProgress(appUpdateInfo.version, 0, -1);
    setAppUpdateDownloadProgress(latestProgress);
    setAppUpdateMessage(latestProgress.title);
    try {
      const target = `${baseDirectory}wz-${appUpdateInfo.version}.apk`;
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      const download = FileSystem.createDownloadResumable(appUpdateInfo.apkUrl, target, {}, (progress) => {
        latestProgress = formatAppUpdateDownloadProgress(appUpdateInfo.version, progress.totalBytesWritten, progress.totalBytesExpectedToWrite);
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
      const verifyingProgress: AppUpdateDownloadProgress = {
        ...latestProgress,
        title: '下载完成，正在校验安装包',
        percent: latestProgress.totalBytes === null ? latestProgress.percent : 100,
        percentLabel: latestProgress.totalBytes === null ? latestProgress.percentLabel : '100%'
      };
      setAppUpdateDownloadProgress(verifyingProgress);
      setAppUpdateMessage(verifyingProgress.title);
      const installer = NativeModules.ApkInstallerModule as ApkInstaller | undefined;
      await installVerifiedApk(installer, result.uri, appUpdateInfo);
      setAppUpdateMessage('下载完成，请确认安装');
      notify('下载完成，请确认安装');
    } catch (error) {
      const message = errorMessage(error);
      setAppUpdateMessage(message);
      notify(message);
    } finally {
      appUpdateDownloadingRef.current = false;
      setAppUpdateDownloading(false);
      setAppUpdateDownloadProgress(null);
    }
  }, [appUpdateInfo, notify]);

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
