import { useCallback, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { AppUpdateInfo, checkGithubAppUpdate, CURRENT_APP_VERSION } from '../appUpdate';
import { errorMessage } from '../appUtils';

type ApkInstallerModule = {
  installApk?: (uri: string) => Promise<boolean>;
};

export function useAppUpdateController({ notify }: { notify: (message: string) => void }) {
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateDownloading, setAppUpdateDownloading] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [appUpdateMessage, setAppUpdateMessage] = useState(`当前版本 ${CURRENT_APP_VERSION}`);
  const appUpdateBusyRef = useRef(false);
  const appUpdateDownloadingRef = useRef(false);

  const checkAppUpdate = useCallback(async () => {
    if (appUpdateBusyRef.current) {
      return;
    }
    appUpdateBusyRef.current = true;
    setAppUpdateBusy(true);
    setAppUpdateInfo(null);
    setAppUpdateMessage('正在检查更新');
    try {
      const update = await checkGithubAppUpdate();
      setAppUpdateInfo(update);
      const message = update ? `发现新版 ${update.version}` : `已是最新版 ${CURRENT_APP_VERSION}`;
      setAppUpdateMessage(message);
      notify(message);
    } catch (error) {
      const message = errorMessage(error);
      setAppUpdateMessage(message);
      notify(message);
    } finally {
      appUpdateBusyRef.current = false;
      setAppUpdateBusy(false);
    }
  }, [notify]);

  const downloadAppUpdate = useCallback(async () => {
    if (!appUpdateInfo || appUpdateDownloadingRef.current) {
      return;
    }
    if (Platform.OS !== 'android') {
      notify('仅 Android 支持安装 APK。');
      return;
    }
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      notify('无法访问本机缓存目录。');
      return;
    }
    appUpdateDownloadingRef.current = true;
    setAppUpdateDownloading(true);
    setAppUpdateMessage(`正在下载 ${appUpdateInfo.version}`);
    try {
      const target = `${baseDirectory}wz-${appUpdateInfo.version}.apk`;
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      const result = await FileSystem.downloadAsync(appUpdateInfo.apkUrl, target);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`下载失败：HTTP ${result.status}`);
      }
      const installer = NativeModules.ApkInstallerModule as ApkInstallerModule | undefined;
      if (!installer?.installApk) {
        throw new Error('当前安装包不支持打开安装确认。');
      }
      await installer.installApk(result.uri);
      setAppUpdateMessage('下载完成，请确认安装');
      notify('下载完成，请确认安装');
    } catch (error) {
      const message = errorMessage(error);
      setAppUpdateMessage(message);
      notify(message);
    } finally {
      appUpdateDownloadingRef.current = false;
      setAppUpdateDownloading(false);
    }
  }, [appUpdateInfo, notify]);

  return {
    appUpdateBusy,
    appUpdateDownloading,
    appUpdateInfo,
    appUpdateMessage,
    checkAppUpdate,
    downloadAppUpdate
  };
}
