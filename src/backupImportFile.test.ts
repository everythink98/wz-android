import * as FileSystem from 'expo-file-system/legacy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBackupFileText } from './backupImportFile';
import { MAX_BACKUP_JSON_BYTES } from './readerBackup';

vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8' },
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn()
}));

describe('backup import file reader', () => {
  beforeEach(() => {
    vi.mocked(FileSystem.getInfoAsync).mockReset();
    vi.mocked(FileSystem.readAsStringAsync).mockReset();
  });

  it('rejects oversized picked files before reading text', async () => {
    await expect(readBackupFileText({
      uri: 'file:///cache/too-large.json',
      size: MAX_BACKUP_JSON_BYTES + 1
    })).rejects.toThrow('备份文件过大');

    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('rejects oversized cached files before reading text when picked size is missing', async () => {
    vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({
      exists: true,
      isDirectory: false,
      modificationTime: 1,
      size: MAX_BACKUP_JSON_BYTES + 1,
      uri: 'file:///cache/too-large.json'
    });

    await expect(readBackupFileText({
      uri: 'file:///cache/too-large.json'
    })).rejects.toThrow('备份文件过大');

    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('rejects files when cached size is unavailable before reading text', async () => {
    vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({
      exists: true,
      isDirectory: false,
      modificationTime: 1,
      size: undefined,
      uri: 'file:///cache/unknown-size.json'
    } as unknown as Awaited<ReturnType<typeof FileSystem.getInfoAsync>>);

    await expect(readBackupFileText({
      uri: 'file:///cache/unknown-size.json'
    })).rejects.toThrow('备份文件大小无法确认');

    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('reads normal backup files as UTF-8 text', async () => {
    vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({
      exists: true,
      isDirectory: false,
      modificationTime: 1,
      size: 64,
      uri: 'file:///cache/backup.json'
    });
    vi.mocked(FileSystem.readAsStringAsync).mockResolvedValue('{"version":2}');

    await expect(readBackupFileText({
      uri: 'file:///cache/backup.json',
      size: 64
    })).resolves.toBe('{"version":2}');

    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('file:///cache/backup.json', { encoding: FileSystem.EncodingType.UTF8 });
  });
});
