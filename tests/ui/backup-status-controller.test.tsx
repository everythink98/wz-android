import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { createEmptyReaderData } from '../../src/readerData';
import { exportReaderBackupJson } from '../../src/readerBackup';
import { useBackupStatusController } from '../../src/app/useBackupStatusController';

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
      assets: [{ uri: 'file:///cache/broken-backup.json', size: 8 }]
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 8 });
    mockReadAsStringAsync.mockResolvedValue('{broken');
  });

  it('does not replace current reader data when a picked backup is invalid', async () => {
    const current = createEmptyReaderData();
    current.settings.theme = 'dark';
    const readerDataRef = { current };
    const notify = jest.fn<(message: string) => void>();
    const replaceReaderData = jest.fn(async () => undefined);
    const hook = await renderHook(() =>
      useBackupStatusController({
        notify,
        readerDataRef,
        replaceReaderData,
        waitForReaderDataSave: jest.fn(async () => undefined)
      })
    );

    await act(async () => {
      await hook.result.current.importBackupFile();
    });

    expect(replaceReaderData).not.toHaveBeenCalled();
    expect(readerDataRef.current).toBe(current);
    expect(readerDataRef.current.settings.theme).toBe('dark');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/broken-backup.json', { idempotent: true });
    expect(hook.result.current.backupBusy).toBe(false);
  });

  it('treats a canceled document picker as a no-op without notifying or replacing data', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });
    const readerDataRef = { current: createEmptyReaderData() };
    const notify = jest.fn<(message: string) => void>();
    const replaceReaderData = jest.fn(async () => undefined);
    const hook = await renderHook(() =>
      useBackupStatusController({
        notify,
        readerDataRef,
        replaceReaderData,
        waitForReaderDataSave: jest.fn(async () => undefined)
      })
    );

    await act(async () => {
      await hook.result.current.importBackupFile();
    });

    expect(replaceReaderData).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(mockDeleteAsync).not.toHaveBeenCalled();
    expect(hook.result.current.backupBusy).toBe(false);
  });

  it('merges a valid picked backup and deletes only the picker cache copy', async () => {
    const current = createEmptyReaderData();
    current.history['v2ex:local'] = {
      topic: {
        source: 'v2ex',
        id: 'local',
        title: '本机历史',
        author: 'alice',
        url: 'https://www.v2ex.com/t/local',
        createdAt: '2026-07-13T00:00:00.000Z',
        replyCount: 0
      },
      savedAt: '2026-07-14T00:00:00.000Z'
    };
    const imported = createEmptyReaderData();
    imported.history['linuxdo:remote'] = {
      topic: {
        source: 'linuxdo',
        id: 'remote',
        title: '备份历史',
        author: 'bob',
        url: 'https://linux.do/t/remote',
        createdAt: '2026-07-13T00:00:00.000Z',
        replyCount: 1
      },
      savedAt: '2026-07-14T01:00:00.000Z'
    };
    imported.settings.theme = 'dark';
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/valid-backup.json', size: 512 }]
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 512 });
    mockReadAsStringAsync.mockResolvedValue(exportReaderBackupJson(imported));
    const notify = jest.fn<(message: string) => void>();
    const replaceReaderData = jest.fn(async () => undefined);
    const hook = await renderHook(() =>
      useBackupStatusController({
        notify,
        readerDataRef: { current },
        replaceReaderData,
        waitForReaderDataSave: jest.fn(async () => undefined)
      })
    );

    await act(async () => {
      await hook.result.current.importBackupFile();
    });

    expect(replaceReaderData).toHaveBeenCalledWith(
      'backup-imported',
      expect.objectContaining({
        history: expect.objectContaining({
          'v2ex:local': expect.any(Object),
          'linuxdo:remote': expect.any(Object)
        }),
        settings: expect.objectContaining({ theme: 'dark' })
      })
    );
    expect(notify).toHaveBeenCalledWith('备份已恢复，本机资料已合并');
    expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/valid-backup.json', { idempotent: true });
  });

  it('waits for pending data saves, shares an export and cleans up its temporary file', async () => {
    const readerDataRef = { current: createEmptyReaderData() };
    const notify = jest.fn<(message: string) => void>();
    const waitForReaderDataSave = jest.fn(async () => undefined);
    const hook = await renderHook(() =>
      useBackupStatusController({
        notify,
        readerDataRef,
        replaceReaderData: jest.fn(async () => undefined),
        waitForReaderDataSave
      })
    );

    await act(async () => {
      await hook.result.current.exportBackupFile();
    });

    expect(waitForReaderDataSave).toHaveBeenCalledTimes(1);
    expect(mockWriteAsStringAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/forum-reader-backup-.+\.json$/),
      expect.any(String),
      { encoding: 'utf8' }
    );
    const exportedUri = mockWriteAsStringAsync.mock.calls[0]?.[0];
    expect(mockShareAsync).toHaveBeenCalledWith(exportedUri, { mimeType: 'application/json' });
    expect(mockDeleteAsync).toHaveBeenCalledWith(exportedUri, { idempotent: true });
    expect(notify).toHaveBeenCalledWith('备份文件已生成');
  });

  it('reports an export sharing failure and still removes the temporary file', async () => {
    mockShareAsync.mockRejectedValue(new Error('用户取消了系统分享'));
    const notify = jest.fn<(message: string) => void>();
    const hook = await renderHook(() =>
      useBackupStatusController({
        notify,
        readerDataRef: { current: createEmptyReaderData() },
        replaceReaderData: jest.fn(async () => undefined),
        waitForReaderDataSave: jest.fn(async () => undefined)
      })
    );

    await act(async () => {
      await hook.result.current.exportBackupFile();
    });

    const exportedUri = mockWriteAsStringAsync.mock.calls[0]?.[0];
    expect(notify).toHaveBeenCalledWith('用户取消了系统分享');
    expect(notify).not.toHaveBeenCalledWith('备份文件已生成');
    expect(mockDeleteAsync).toHaveBeenCalledWith(exportedUri, { idempotent: true });
    expect(hook.result.current.backupBusy).toBe(false);
  });
});
