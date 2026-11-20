import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, DownloadTask, File, Paths, type DownloadProgress } from 'expo-file-system';
import { NativeModules } from 'react-native';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
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

export type AppUpdateArtifact = { update: AppUpdateInfo } & (
  { kind: 'partial'; totalBytes: number | null; downloadedBytes: number } | { kind: 'verified'; bytes: number }
);

function updateDirectory() {
  return new Directory(Paths.document, 'wz-update');
}

export function appUpdateFile(update: AppUpdateInfo, complete = false) {
  return new File(updateDirectory(), `wz-update-${update.versionCode}-${update.sha256}.${complete ? 'apk' : 'part'}`);
}

async function verify(file: File, update: AppUpdateInfo, trace?: DiagnosticTrace) {
  if (trace) markDiagnosticStage(trace, 'parse', { state: 'package-verification', versionCode: update.versionCode });
  try {
    await verifyDownloadedApk(NativeModules.ApkInstallerModule as ApkInstaller | undefined, file.uri, update);
    if (trace) markDiagnosticStage(trace, 'parse', { state: 'verified' });
  } catch (error) {
    if (trace)
      markDiagnosticStage(trace, 'parse', {
        state: 'failure',
        reason: isInvalidApk(error) ? 'invalid_response' : normalizeDiagnosticReason(error)
      });
    throw error;
  }
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
    JSON.stringify({
      format: 1,
      update: artifact.update,
      totalBytes: artifact.kind === 'verified' ? artifact.bytes : artifact.totalBytes
    })
  );
}

export async function inspectAppUpdateArtifact(
  artifact: AppUpdateArtifact,
  trace?: DiagnosticTrace
): Promise<AppUpdateArtifact> {
  const complete = appUpdateFile(artifact.update, true);
  const partial = appUpdateFile(artifact.update);
  const totalBytes = artifact.kind === 'verified' ? artifact.bytes : artifact.totalBytes;
  const file = complete.exists ? complete : partial;
  if (file.exists) {
    try {
      await verify(file, artifact.update, trace);
      if (file === partial) await partial.move(complete);
      return { kind: 'verified', update: artifact.update, bytes: complete.size };
    } catch (error) {
      if (!isInvalidApk(error)) throw error;
      // A short, unparseable .part can still be a valid prefix; a complete or identified wrong APK cannot.
      if (
        file === complete ||
        error instanceof ApkVerificationError ||
        (totalBytes !== null && file.size >= totalBytes)
      )
        file.delete();
    }
  }
  return { kind: 'partial', update: artifact.update, totalBytes, downloadedBytes: partial.exists ? partial.size : 0 };
}

export async function restoreAppUpdateArtifact(): Promise<AppUpdateArtifact | null> {
  const trace = beginDiagnosticTrace('update', 'restore');
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      finishDiagnosticTrace(trace, 'noop', { state: 'missing' });
      return null;
    }
    let artifact: AppUpdateArtifact;
    try {
      const saved: unknown = JSON.parse(raw);
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('format' in saved) ||
        saved.format !== 1 ||
        !('update' in saved) ||
        !('totalBytes' in saved)
      )
        throw new Error('更新记录格式不正确。');
      const update = parseSavedAppUpdate(saved.update);
      const totalBytes = saved.totalBytes;
      if (
        totalBytes !== null &&
        (typeof totalBytes !== 'number' || !Number.isSafeInteger(totalBytes) || totalBytes <= 0)
      ) {
        throw new Error('更新记录大小不正确。');
      }
      artifact = { kind: 'partial', update, totalBytes, downloadedBytes: 0 };
    } catch {
      markDiagnosticStage(trace, 'parse', { state: 'invalid', reason: 'invalid_response' });
      await AsyncStorage.removeItem(STORAGE_KEY);
      pruneUpdateFiles();
      finishDiagnosticTrace(trace, 'partial', { state: 'cleared', reason: 'invalid_response' });
      return null;
    }
    const restored = await inspectAppUpdateArtifact(artifact, trace);
    finishDiagnosticTrace(trace, 'success', {
      state: restored.kind === 'verified' ? 'verified' : 'restored',
      versionCode: restored.update.versionCode,
      downloadedBytes: restored.kind === 'verified' ? restored.bytes : restored.downloadedBytes
    });
    return restored;
  } catch (error) {
    finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
    throw error;
  }
}

export async function prepareAppUpdateArtifact(
  update: AppUpdateInfo,
  trace?: DiagnosticTrace
): Promise<AppUpdateArtifact> {
  const trusted = parseSavedAppUpdate(update);
  const folder = updateDirectory();
  folder.create({ idempotent: true, intermediates: true });
  const complete = appUpdateFile(trusted, true);
  if (!complete.exists) {
    for (const folder of [Paths.cache, Paths.document]) {
      const legacy = new File(folder, complete.name);
      if (!legacy.exists) continue;
      try {
        await verify(legacy, trusted, trace);
        await legacy.move(complete);
        break;
      } catch (error) {
        if (!isInvalidApk(error)) throw error;
      }
    }
  }
  const artifact = await inspectAppUpdateArtifact(
    { kind: 'partial', update: trusted, totalBytes: null, downloadedBytes: 0 },
    trace
  );
  // Keep the previous target usable until the replacement is ready and its identity is durable.
  if (trace) markDiagnosticStage(trace, 'persist', { state: 'started', versionCode: trusted.versionCode });
  await saveAppUpdateArtifact(artifact);
  if (trace) markDiagnosticStage(trace, 'persist', { state: 'persisted' });
  try {
    pruneUpdateFiles(trusted);
  } catch {
    if (trace) markDiagnosticStage(trace, 'persist', { state: 'cleanup-pending', reason: 'storage_error' });
  }
  return artifact;
}

export async function finishAppUpdateDownload(
  artifact: AppUpdateArtifact,
  trace?: DiagnosticTrace
): Promise<AppUpdateArtifact> {
  const partial = appUpdateFile(artifact.update);
  try {
    await verify(partial, artifact.update, trace);
  } catch (error) {
    if (isInvalidApk(error) && partial.exists) partial.delete();
    throw error;
  }
  const complete = appUpdateFile(artifact.update, true);
  await partial.move(complete);
  return { kind: 'verified', update: artifact.update, bytes: complete.size };
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
