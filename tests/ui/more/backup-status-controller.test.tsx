import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useLayoutEffect } from 'react';
import { createRoot } from 'test-renderer';
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
const mockSaveBackupDocument =
  jest.fn<(...args: unknown[]) => Promise<{ status: 'saved' | 'canceled'; byteCount?: number }>>();

jest.mock(
  '@/platform/storage/backupExport',
  () => ({
    saveBackupDocument: (...args: unknown[]) => mockSaveBackupDocument(...args)
  }),
  { virtual: true }
);

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
    mockSaveBackupDocument.mockResolvedValue({ status: 'saved', byteCount: 2 });
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/backup.json', size: 8 }]
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 8 });
    mockReadAsStringAsync.mockResolvedValue('{broken');
  });
  it.each(['success', 'failure'] as const)(
    'keeps one real backup job through StrictMode and settles its current %s observation',
    async (outcome) => {
      const pending = Promise.withResolvers<Awaited<ReturnType<typeof mockSaveBackupDocument>>>();
      mockSaveBackupDocument.mockReturnValueOnce(pending.promise);
      const notify = jest.fn();
      const latestNotify = jest.fn();
      const exportBackup = jest.fn(async () => '{}');
      const importBackup = jest.fn(async () => undefined);
      let controller!: ReturnType<typeof useBackupStatusController>;
      let result!: Promise<void>;
      let setups = 0;
      function Harness({ notice }: { notice: (message: string) => void }) {
        controller = useBackupStatusController({ notify: notice, importBackup, exportBackup });
        useLayoutEffect(() => {
          setups += 1;
          if (setups === 1) result = controller.exportBackupFile();
        }, []);
        return null;
      }
      const root = createRoot({ isStrictMode: true });
      try {
        await act(async () => root.render(<Harness notice={notify} />));
        expect(setups).toBe(2);
        expect(controller.backupBusy).toBe(true);
        expect(mockSaveBackupDocument).toHaveBeenCalledTimes(1);
        await act(async () => {
          await controller.importBackupFile();
        });
        expect(mockGetDocumentAsync).not.toHaveBeenCalled();
        await act(async () => root.render(<Harness notice={latestNotify} />));
        await act(async () => {
          if (outcome === 'success') pending.resolve({ status: 'saved' });
          else pending.reject(new Error('current backup failure'));
          await result;
        });
        expect(exportBackup).toHaveBeenCalledTimes(1);
        expect(latestNotify).toHaveBeenCalledTimes(1);
        expect(latestNotify).toHaveBeenCalledWith(
          outcome === 'success' ? '备份已保存到所选位置' : 'current backup failure'
        );
        expect(notify).not.toHaveBeenCalled();
        expect(controller.backupBusy).toBe(false);
      } finally {
        pending.resolve({ status: 'canceled' });
        await act(async () => root.unmount());
      }
    }
  );
  it.each(['success', 'failure'] as const)(
    'settles a dispatched import and its cache cleanup without a retired %s notice',
    async (outcome) => {
      const pending = Promise.withResolvers<void>();
      const notify = jest.fn();
      const importBackup = jest.fn(() => pending.promise);
      const hook = await renderHook(() =>
        useBackupStatusController({ notify, importBackup, exportBackup: async () => '{}' })
      );
      let result!: Promise<void>;
      try {
        await act(async () => {
          result = hook.result.current.importBackupFile();
        });
        await waitFor(() => expect(importBackup).toHaveBeenCalledTimes(1));
        await hook.unmount();
        await act(async () => {
          if (outcome === 'success') pending.resolve();
          else pending.reject(new Error('retired import failure'));
          await result;
        });
        expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/backup.json', { idempotent: true });
        expect(notify).not.toHaveBeenCalled();
      } finally {
        pending.resolve();
      }
    }
  );

  it.each(['success', 'failure'] as const)(
    'settles a dispatched document save without a retired %s notice',
    async (outcome) => {
      const pending = Promise.withResolvers<Awaited<ReturnType<typeof mockSaveBackupDocument>>>();
      mockSaveBackupDocument.mockReturnValueOnce(pending.promise);
      const notify = jest.fn();
      const hook = await renderHook(() =>
        useBackupStatusController({ notify, importBackup: async () => undefined, exportBackup: async () => '{}' })
      );
      let result!: Promise<void>;
      try {
        await act(async () => {
          result = hook.result.current.exportBackupFile();
        });
        await waitFor(() => expect(mockSaveBackupDocument).toHaveBeenCalledTimes(1));
        await hook.unmount();
        await act(async () => {
          if (outcome === 'success') pending.resolve({ status: 'saved' });
          else pending.reject(new Error('retired document failure'));
          await result;
        });
        expect(notify).not.toHaveBeenCalled();
      } finally {
        pending.resolve({ status: 'canceled' });
      }
    }
  );
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
  it('saves a consistent snapshot through the system document picker without sharing a temporary file', async () => {
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
    expect(mockSaveBackupDocument).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), '{}');
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('备份已保存到所选位置');
  });
  it('does not report a canceled document picker as a saved backup', async () => {
    mockSaveBackupDocument.mockResolvedValue({ status: 'canceled' });
    const notify = jest.fn();
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup: async () => undefined, exportBackup: async () => '{}' })
    );
    await act(async () => {
      await hook.result.current.exportBackupFile();
    });
    expect(notify).not.toHaveBeenCalled();
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(hook.result.current.backupBusy).toBe(false);
  });
  it('reports document-write failures without a silent sharing fallback', async () => {
    mockSaveBackupDocument.mockRejectedValue(new Error('备份写入失败'));
    const notify = jest.fn();
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup: async () => undefined, exportBackup: async () => '{}' })
    );
    await act(async () => {
      await hook.result.current.exportBackupFile();
    });
    expect(notify).toHaveBeenCalledWith('备份写入失败');
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(hook.result.current.backupBusy).toBe(false);
  });
});
