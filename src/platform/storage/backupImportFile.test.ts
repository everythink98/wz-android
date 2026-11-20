import { describe, expect, it, vi } from 'vitest';
import { MAX_BACKUP_JSON_BYTES } from '@/domain/reader/readerBackup';
import { pickBackupFileText } from './backupImportFile';

const native = vi.hoisted(() => ({ readBackupDocument: vi.fn() }));
const pick = vi.hoisted(() => vi.fn());
vi.mock('expo', () => ({ requireOptionalNativeModule: () => native }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: pick }));

describe('backup import file reader', () => {
  it('rejects oversized picker metadata before opening the document', async () => {
    native.readBackupDocument.mockClear();
    pick.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'content://documents/backup', size: MAX_BACKUP_JSON_BYTES + 1 }]
    });
    await expect(pickBackupFileText()).rejects.toThrow('备份文件过大');
    expect(native.readBackupDocument).not.toHaveBeenCalled();
  });

  it.each([undefined, 64])('bounds the actual document read when the provider reports %s bytes', async (size) => {
    const uri = 'content://documents/backup';
    pick.mockResolvedValueOnce({ canceled: false, assets: [{ uri, size }] });
    native.readBackupDocument.mockResolvedValueOnce('{"version":2}');
    await expect(pickBackupFileText()).resolves.toBe('{"version":2}');
    expect(native.readBackupDocument).toHaveBeenLastCalledWith(uri, MAX_BACKUP_JSON_BYTES);
  });
});
