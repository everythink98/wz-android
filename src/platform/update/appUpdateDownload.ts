import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, DownloadTask, File, Paths, type DownloadProgress } from 'expo-file-system';
import { NativeModules } from 'react-native';
import {
  ApkVerificationError,
  type ApkInstaller,
  type AppUpdateInfo,
  isInvalidApk,
  parseSavedAppUpdate,
  verifyDownloadedApk
} from './appUpdate';

const STORAGE_KEY = 'app-update-download';
const UPDATE_FILE = /^wz-update-\d+-[a-f0-9]{64}\.(apk|part)$/i;

export type AppUpdateArtifact = {
  update: AppUpdateInfo;
  totalBytes: number | null;
  downloadedBytes: number;
  ready: boolean;
};

function updateDirectory() {
  return new Directory(Paths.document, 'wz-update');
}

export function appUpdateFile(update: AppUpdateInfo, complete = false) {
  return new File(updateDirectory(), `wz-update-${update.versionCode}-${update.sha256}.${complete ? 'apk' : 'part'}`);
}

async function verify(file: File, update: AppUpdateInfo) {
  await verifyDownloadedApk(NativeModules.ApkInstallerModule as ApkInstaller | undefined, file.uri, update);
}

function pruneUpdateFiles(keep?: AppUpdateInfo) {
  const folder = updateDirectory();
  const keepUris = keep ? [appUpdateFile(keep).uri, appUpdateFile(keep, true).uri] : [];
  if (folder.exists) {
    for (const file of folder.list()) {
      if (file instanceof File && UPDATE_FILE.test(file.name) && !keepUris.includes(file.uri)) file.delete();
    }
  }
  for (const folder of [Paths.cache, Paths.document]) {
    for (const file of folder.list()) {
      if (file instanceof File && (file.name === 'wz-update.apk' || UPDATE_FILE.test(file.name))) file.delete();
    }
  }
}

export async function saveAppUpdateArtifact(artifact: AppUpdateArtifact) {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ format: 1, update: artifact.update, totalBytes: artifact.totalBytes })
  );
}

export async function inspectAppUpdateArtifact(artifact: AppUpdateArtifact): Promise<AppUpdateArtifact> {
  const complete = appUpdateFile(artifact.update, true);
  const partial = appUpdateFile(artifact.update);
  const file = complete.exists ? complete : partial;
  if (file.exists) {
    try {
      await verify(file, artifact.update);
      if (file === partial) await partial.move(complete);
      return { ...artifact, ready: true, downloadedBytes: complete.size, totalBytes: complete.size };
    } catch (error) {
      if (!isInvalidApk(error)) throw error;
      // A short, unparseable .part can still be a valid prefix; a complete or identified wrong APK cannot.
      if (
        file === complete ||
        error instanceof ApkVerificationError ||
        (artifact.totalBytes !== null && file.size >= artifact.totalBytes)
      )
        file.delete();
    }
  }
  return { ...artifact, ready: false, downloadedBytes: partial.exists ? partial.size : 0 };
}

export async function restoreAppUpdateArtifact(): Promise<AppUpdateArtifact | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let artifact: AppUpdateArtifact;
  try {
    const saved = JSON.parse(raw);
    if (saved?.format !== 1) throw new Error('更新记录格式不正确。');
    const update = parseSavedAppUpdate(saved.update);
    const totalBytes = saved.totalBytes;
    if (totalBytes !== null && (!Number.isSafeInteger(totalBytes) || totalBytes <= 0)) {
      throw new Error('更新记录大小不正确。');
    }
    artifact = { update, totalBytes, downloadedBytes: 0, ready: false };
  } catch {
    await AsyncStorage.removeItem(STORAGE_KEY);
    pruneUpdateFiles();
    return null;
  }
  return inspectAppUpdateArtifact(artifact);
}

export async function prepareAppUpdateArtifact(update: AppUpdateInfo): Promise<AppUpdateArtifact> {
  const trusted = parseSavedAppUpdate(update);
  const folder = updateDirectory();
  folder.create({ idempotent: true, intermediates: true });
  let artifact: AppUpdateArtifact = { update: trusted, totalBytes: null, downloadedBytes: 0, ready: false };
  // Persist the selected identity before starting any native writer or replacing an older task.
  await saveAppUpdateArtifact(artifact);
  const complete = appUpdateFile(trusted, true);
  if (!complete.exists) {
    for (const folder of [Paths.cache, Paths.document]) {
      const legacy = new File(folder, complete.name);
      if (!legacy.exists) continue;
      try {
        await verify(legacy, trusted);
        await legacy.move(complete);
        break;
      } catch (error) {
        if (!isInvalidApk(error)) throw error;
      }
    }
  }
  pruneUpdateFiles(trusted);
  artifact = await inspectAppUpdateArtifact(artifact);
  return artifact;
}

export async function finishAppUpdateDownload(artifact: AppUpdateArtifact) {
  const partial = appUpdateFile(artifact.update);
  try {
    await verify(partial, artifact.update);
  } catch (error) {
    if (isInvalidApk(error) && partial.exists) partial.delete();
    throw error;
  }
  const complete = appUpdateFile(artifact.update, true);
  await partial.move(complete);
  const ready = { ...artifact, ready: true, downloadedBytes: complete.size, totalBytes: complete.size };
  return ready;
}

export function createAppUpdateDownload(artifact: AppUpdateArtifact, onProgress: (progress: DownloadProgress) => void) {
  const file = appUpdateFile(artifact.update);
  const offset = file.exists ? file.size : 0;
  const options = { headers: { 'Accept-Encoding': 'identity' }, onProgress };
  if (offset > 0) {
    // ponytail: Android 57.0.6 uses a byte offset; revalidate the native contract when upgrading Expo.
    return DownloadTask.fromSavable(
      { url: artifact.update.apkUrl, fileUri: file.uri, isDirectory: false, resumeData: String(offset) },
      options
    );
  }
  return File.createDownloadTask(artifact.update.apkUrl, file, options);
}
