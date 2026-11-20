import { requireOptionalNativeModule } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { assertBackupJsonSize, MAX_BACKUP_JSON_BYTES } from '@/domain/reader/readerBackup';

export async function pickBackupFileText() {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: false,
    type: ['application/json', 'text/json', '*/*']
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset?.uri) return null;
  assertBackupJsonSize(asset.size);
  const module = requireOptionalNativeModule<{
    readBackupDocument(uri: string, maxBytes: number): Promise<string>;
  }>('BackupExport');
  if (!module?.readBackupDocument) throw new Error('当前安装包不支持读取备份，请更新后重试。');
  return module.readBackupDocument(asset.uri, MAX_BACKUP_JSON_BYTES);
}
