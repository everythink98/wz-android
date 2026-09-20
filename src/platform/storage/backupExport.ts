import { requireOptionalNativeModule } from 'expo';
import { assertBackupJsonSize } from '@/domain/reader/readerBackup';

export type BackupSaveResult = { status: 'saved'; byteCount: number } | { status: 'canceled' };

export async function saveBackupDocument(fileName: string, json: string): Promise<BackupSaveResult> {
  assertBackupJsonSize(json);
  const module = requireOptionalNativeModule<{
    saveBackupDocument(fileName: string, json: string): Promise<BackupSaveResult>;
  }>('BackupExport');
  if (!module) throw new Error('当前安装包不支持保存备份，请更新后重试。');
  return module.saveBackupDocument(fileName, json);
}
