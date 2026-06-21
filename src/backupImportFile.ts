import * as FileSystem from 'expo-file-system/legacy';
import { assertBackupJsonSize } from './readerBackup';

export type BackupFileAsset = {
  uri: string;
  size?: number | null;
};

export async function readBackupFileText(asset: BackupFileAsset) {
  assertBackupJsonSize(asset.size);
  const info = await FileSystem.getInfoAsync(asset.uri);
  if (!info.exists || info.isDirectory) {
    throw new Error('备份文件不存在，请重新选择。');
  }
  if (typeof info.size !== 'number') {
    throw new Error('备份文件大小无法确认，请重新选择文件。');
  }
  assertBackupJsonSize(info.size);
  return FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
}
