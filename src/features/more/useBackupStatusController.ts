import { useCallback, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { safeFileName } from '@/platform/storage/backupFiles';
import { readBackupFileText } from '@/platform/storage/backupImportFile';
import { runBackupOperation } from '@/platform/storage/backupOperation';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

export function useBackupStatusController({
  notify,
  importBackup,
  exportBackup
}: {
  notify: (message: string) => void;
  importBackup: (json: string) => Promise<void>;
  exportBackup: () => Promise<string>;
}) {
  const backupBusyRef = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);

  const shareTextFile = useCallback(async (fileName: string, content: string, mimeType: string) => {
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      throw new Error('无法生成备份文件，请检查文件权限。');
    }
    const uri = `${baseDirectory}${fileName}`;
    const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;
    try {
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Share capability is loaded only during export.
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType });
      } else {
        throw new Error('当前设备不支持分享备份文件。');
      }
    } finally {
      if (shouldDeleteFile) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
    }
  }, []);

  const exportBackupFile = useCallback(async () => {
    const trace = beginDiagnosticTrace('backup', 'export');
    if (backupBusyRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    let failureReason: DiagnosticReason = 'unknown';
    const completed = await runBackupOperation({
      busyRef: backupBusyRef,
      notify,
      setBusy: setBackupBusy,
      task: async () => {
        try {
          markDiagnosticStage(trace, 'guard', { state: 'waiting-for-save' });
          const content = await exportBackup();
          markDiagnosticStage(trace, 'persist', { byteCount: new TextEncoder().encode(content).byteLength });
          await shareTextFile(safeFileName('forum-reader-backup', 'json'), content, 'application/json');
          markDiagnosticStage(trace, 'apply', { state: 'share-completed' });
          notify('备份文件已生成');
        } catch (error) {
          failureReason = normalizeDiagnosticReason(error);
          markDiagnosticStage(trace, failureReason === 'invalid_response' ? 'parse' : 'persist', {
            state: 'failure',
            reason: failureReason
          });
          throw error;
        }
      }
    });
    finishDiagnosticTrace(trace, completed ? 'success' : 'failure', completed ? {} : { reason: failureReason });
  }, [notify, exportBackup, shareTextFile]);

  const importBackupFile = useCallback(async () => {
    const trace = beginDiagnosticTrace('backup', 'import');
    if (backupBusyRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    let canceled = false;
    let failureReason: DiagnosticReason = 'unknown';
    const completed = await runBackupOperation({
      busyRef: backupBusyRef,
      notify,
      setBusy: setBackupBusy,
      task: async () => {
        try {
          markDiagnosticStage(trace, 'guard', { state: 'document-picker' });
          const result = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
            type: ['application/json', 'text/json', '*/*']
          });
          if (result.canceled || !result.assets?.[0]?.uri) {
            canceled = true;
            return;
          }
          const pickedAsset = result.assets[0];
          const pickedUri = pickedAsset.uri;
          try {
            const content = await readBackupFileText(pickedAsset);
            markDiagnosticStage(trace, 'parse', { byteCount: new TextEncoder().encode(content).byteLength });
            markDiagnosticStage(trace, 'apply', { state: 'merge-started' });
            await importBackup(content);
            notify('备份已恢复，本机资料已合并');
          } finally {
            if (FileSystem.cacheDirectory && pickedUri.startsWith(FileSystem.cacheDirectory)) {
              await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);
            }
          }
        } catch (error) {
          failureReason = normalizeDiagnosticReason(error);
          markDiagnosticStage(trace, failureReason === 'invalid_response' ? 'parse' : 'persist', {
            state: 'failure',
            reason: failureReason
          });
          throw error;
        }
      }
    });
    finishDiagnosticTrace(
      trace,
      canceled ? 'canceled' : completed ? 'success' : 'failure',
      canceled ? { reason: 'canceled' } : completed ? {} : { reason: failureReason }
    );
  }, [notify, importBackup]);

  return {
    backupBusy,
    exportBackupFile,
    importBackupFile
  };
}
