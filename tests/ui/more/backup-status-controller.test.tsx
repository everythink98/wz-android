import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { exportReaderBackupJson } from '@/domain/reader/readerBackup';
import { useBackupStatusController } from '@/features/more/useBackupStatusController';

const mockGetDocumentAsync = jest.fn<
  (...args: unknown[]) => Promise<{
    canceled: boolean;
    assets: { uri: string; size: number }[];
  }>
>();
const mockDeleteAsync = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockGetInfoAsync = jest.fn<
  (...args: unknown[]) => Promise<{
    exists: boolean;
    isDirectory: boolean;
    size: number;
  }>
>();
const mockReadAsStringAsync = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockWriteAsStringAsync = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockIsSharingAvailableAsync = jest.fn<() => Promise<boolean>>();
const mockShareAsync = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args)
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  EncodingType: { UTF8: 'utf8' },
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
  writeAsStringAsync: (...args: unknown[]) => mockWriteAsStringAsync(...args)
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsSharingAvailableAsync(),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args)
}));

describe('Backup status controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockIsSharingAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/backup.json', size: 8 }]
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 8 });
    mockReadAsStringAsync.mockResolvedValue('{broken');
  });
  it('reports a rejected import and removes only the picker cache copy', async () => {
    const notify = jest.fn();
    const importBackup = jest.fn(async () => {
      throw new Error('备份格式不兼容');
    });
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup, exportBackup: async () => '{}' })
    );
    await act(async () => {
      await hook.result.current.importBackupFile();
    });
    expect(importBackup).toHaveBeenCalledWith('{broken');
    expect(notify).toHaveBeenCalledWith('备份格式不兼容');
    expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/backup.json', { idempotent: true });
    expect(hook.result.current.backupBusy).toBe(false);
  });
  it('canceled picker does not call storage, notify, or delete other files', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });
    const notify = jest.fn(),
      importBackup = jest.fn(async () => undefined);
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup, exportBackup: async () => '{}' })
    );
    await act(async () => {
      await hook.result.current.importBackupFile();
    });
    expect(importBackup).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });
  it('hands the complete file to the storage owner for merge against latest committed data', async () => {
    const json = exportReaderBackupJson(createEmptyReaderData());
    mockReadAsStringAsync.mockResolvedValue(json);
    const notify = jest.fn(),
      importBackup = jest.fn(async () => undefined);
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup, exportBackup: async () => '{}' })
    );
    await act(async () => {
      await hook.result.current.importBackupFile();
    });
    expect(importBackup).toHaveBeenCalledWith(json);
    expect(notify).toHaveBeenCalledWith('备份已恢复，本机资料已合并');
  });
  it('waits for a consistent storage export before creating and sharing a temporary file', async () => {
    const exported = Promise.withResolvers<string>();
    const notify = jest.fn();
    const exportBackup = jest.fn(() => exported.promise);
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup: async () => undefined, exportBackup })
    );
    let result: Promise<void>;
    await act(async () => {
      result = hook.result.current.exportBackupFile();
    });
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
    expect(mockIsSharingAvailableAsync).not.toHaveBeenCalled();
    await act(async () => {
      exported.resolve('{}');
      await result;
    });
    expect(exportBackup).toHaveBeenCalledTimes(1);
    const uri = mockWriteAsStringAsync.mock.calls[0]?.[0];
    expect(mockShareAsync).toHaveBeenCalledWith(uri, { mimeType: 'application/json' });
    expect(mockDeleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  });
  it('cleans up the temporary export even when sharing fails', async () => {
    mockShareAsync.mockRejectedValue(new Error('用户取消了系统分享'));
    const notify = jest.fn();
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup: async () => undefined, exportBackup: async () => '{}' })
    );
    await act(async () => {
      await hook.result.current.exportBackupFile();
    });
    expect(notify).toHaveBeenCalledWith('用户取消了系统分享');
    expect(mockDeleteAsync).toHaveBeenCalledWith(mockWriteAsStringAsync.mock.calls[0]?.[0], { idempotent: true });
    expect(hook.result.current.backupBusy).toBe(false);
  });
});
