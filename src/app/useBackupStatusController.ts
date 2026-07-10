import { useCallback, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { ReaderData } from '../readerData';
import { exportReaderBackupJson, importReaderBackupJson } from '../readerBackup';
import { safeFileName } from '../backupFiles';
import { readBackupFileText } from '../backupImportFile';
import { runBackupOperation } from '../backupOperation';

export function useBackupStatusController({
  notify,
  readerDataRef,
  replaceReaderData,
  waitForReaderDataSave
}: {
  notify: (message: string) => void;
  readerDataRef: { current: ReaderData };
  replaceReaderData: (nextValue: ReaderData) => Promise<void>;
  waitForReaderDataSave: () => Promise<void>;
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
    await runBackupOperation({
      busyRef: backupBusyRef,
      notify,
      setBusy: setBackupBusy,
      task: async () => {
        await waitForReaderDataSave();
        const content = exportReaderBackupJson(readerDataRef.current);
        await shareTextFile(safeFileName('forum-reader-backup', 'json'), content, 'application/json');
        notify('备份文件已生成');
      }
    });
  }, [notify, readerDataRef, shareTextFile, waitForReaderDataSave]);

  const importBackupFile = useCallback(async () => {
    await runBackupOperation({
      busyRef: backupBusyRef,
      notify,
      setBusy: setBackupBusy,
      task: async () => {
        const result = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          type: ['application/json', 'text/json', '*/*']
        });
        if (result.canceled || !result.assets?.[0]?.uri) {
          return;
        }
        const pickedAsset = result.assets[0];
        const pickedUri = pickedAsset.uri;
        try {
          const content = await readBackupFileText(pickedAsset);
          const merged = importReaderBackupJson(readerDataRef.current, content);
          await replaceReaderData(merged);
          notify('备份已恢复，本机资料已合并');
        } finally {
          if (FileSystem.cacheDirectory && pickedUri.startsWith(FileSystem.cacheDirectory)) {
            await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);
          }
        }
      }
    });
  }, [notify, readerDataRef, replaceReaderData]);

  return {
    backupBusy,
    exportBackupFile,
    importBackupFile
  };
}
