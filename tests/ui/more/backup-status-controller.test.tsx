import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import { lazy, Suspense, useLayoutEffect } from 'react';
import { Text } from 'react-native';
import { createRoot } from 'test-renderer';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { exportReaderBackupJson, MAX_BACKUP_JSON_BYTES, parseReaderBackupJson } from '@/domain/reader/readerBackup';
import { useBackupStatusController } from '@/features/more/useBackupStatusController';
import { useDiagnosticLogController } from '@/features/more/useDiagnosticLogController';
import * as diagnosticFiles from '@/platform/diagnostics/diagnosticFileStore';

const mockGetDocumentAsync = jest.fn<
  (...args: unknown[]) => Promise<{
    canceled: boolean;
    assets: { uri: string; size: number }[];
  }>
>();
const mockDeleteAsync = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockReadBackupDocument = jest.fn<(...args: unknown[]) => Promise<string>>();
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

jest.mock('expo', () => {
  const actual = jest.requireActual<typeof import('expo')>('expo');
  return {
    ...actual,
    requireOptionalNativeModule: (name: string) =>
      name === 'BackupExport'
        ? { readBackupDocument: (...args: unknown[]) => mockReadBackupDocument(...args) }
        : actual.requireOptionalNativeModule(name)
  };
});

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  EncodingType: { UTF8: 'utf8' },
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
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
      assets: [{ uri: 'content://documents/backup', size: 8 }]
    });
    mockReadBackupDocument.mockResolvedValue('{broken');
  });
  it('keeps a running backup independent from a simultaneous diagnostic export', async () => {
    const snapshot = Promise.withResolvers<string>();
    const share = Promise.withResolvers<void>();
    const exportLog = jest.spyOn(diagnosticFiles, 'exportDiagnosticLog').mockReturnValue(share.promise);
    const notify = jest.fn();
    const hook = await renderHook(() => ({
      backup: useBackupStatusController({ notify, exportBackup: () => snapshot.promise, importBackup: async () => {} }),
      diagnostics: useDiagnosticLogController({
        notify,
        metadata: { appVersion: 'fixture', versionCode: 1 },
        getCurrentScreen: () => 'more'
      })
    }));
    let save: Promise<void> | undefined;
    let log: Promise<void> | undefined;
    try {
      await act(async () => {
        save = hook.result.current.backup.exportBackupFile();
        log = hook.result.current.diagnostics.exportDiagnosticLogFile();
      });
      expect(hook.result.current.backup.backupOperation).toBe('export');
      expect(hook.result.current.diagnostics.diagnosticBusy).toBe(true);
      expect(exportLog).toHaveBeenCalledTimes(1);
      await act(async () => {
        share.resolve();
        await log;
      });
      expect(hook.result.current.diagnostics.diagnosticBusy).toBe(false);
      expect(hook.result.current.backup.backupOperation).toBe('export');
    } finally {
      await act(async () => {
        share.resolve();
        snapshot.resolve('{}');
        await Promise.all([save, log]);
      });
      await hook.unmount();
      exportLog.mockRestore();
    }
  });

  it.each(['export', 'import'] as const)('settles the %s result when a frozen backup page returns', async (kind) => {
    const save = Promise.withResolvers<Awaited<ReturnType<typeof mockSaveBackupDocument>>>();
    const read = Promise.withResolvers<string>();
    const content = Promise.withResolvers<{ default: () => null }>();
    const DeferredContent = lazy(() => content.promise);
    const notify = jest.fn();
    const importBackup = async (json: string) => {
      parseReaderBackupJson(json);
    };
    if (kind === 'export') mockSaveBackupDocument.mockReturnValueOnce(save.promise);
    else mockReadBackupDocument.mockReturnValueOnce(read.promise);
    let controller!: ReturnType<typeof useBackupStatusController>;
    let operation: Promise<void> | undefined;
    function Controls({ frozen }: { frozen: boolean }) {
      controller = useBackupStatusController({ notify, importBackup, exportBackup: async () => '{}' });
      return frozen ? <DeferredContent /> : <Text>{controller.backupOperation}</Text>;
    }
    const screen = (frozen: boolean) => (
      <Suspense fallback={<Text>page is covered</Text>}>
        <Controls frozen={frozen} />
      </Suspense>
    );
    const view = await render(screen(false));
    try {
      await act(() => {
        operation = kind === 'export' ? controller.exportBackupFile() : controller.importBackupFile();
      });
      const nativeOperation = kind === 'export' ? mockSaveBackupDocument : mockReadBackupDocument;
      await waitFor(() => expect(nativeOperation).toHaveBeenCalledTimes(1));
      expect(view.getByText(kind)).toBeTruthy();
      await view.rerender(screen(true));
      expect(view.getByText('page is covered')).toBeTruthy();
      await act(async () => {
        save.resolve({ status: 'saved', byteCount: 2 });
        read.resolve('[]');
        await operation;
      });
      expect(notify).not.toHaveBeenCalled();
      await view.rerender(screen(false));
      expect(view.getByText('idle')).toBeTruthy();
      expect(notify).toHaveBeenCalledWith(
        kind === 'export' ? '备份已保存到所选位置' : '备份格式不兼容，请使用当前 Android 版本导出的 JSON。'
      );
      await view.rerender(screen(true));
      await view.rerender(screen(false));
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        save.resolve({ status: 'canceled' });
        read.resolve('[]');
        content.resolve({ default: () => null });
        await operation;
      });
      await view.unmount();
    }
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
        expect(controller.backupOperation).toBe('export');
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
        expect(controller.backupOperation).toBe('idle');
      } finally {
        pending.resolve({ status: 'canceled' });
        await act(async () => root.unmount());
      }
    }
  );
  it.each(['success', 'failure'] as const)(
    'settles a dispatched import without a retired %s notice or deleting the selected document',
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
        expect(mockDeleteAsync).not.toHaveBeenCalled();
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
  it('rejects an oversized document without asking the picker to copy it', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'content://documents/large-backup', size: MAX_BACKUP_JSON_BYTES + 1 }]
    });
    const notify = jest.fn();
    const importBackup = jest.fn(async () => undefined);
    const hook = await renderHook(() =>
      useBackupStatusController({ notify, importBackup, exportBackup: async () => '{}' })
    );
    await act(async () => {
      await hook.result.current.importBackupFile();
    });
    expect(mockGetDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ copyToCacheDirectory: false }));
    expect(importBackup).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('备份文件过大'));
  });

  it('reports a rejected import and leaves the selected document untouched', async () => {
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
    expect(mockDeleteAsync).not.toHaveBeenCalled();
    expect(hook.result.current.backupOperation).toBe('idle');
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
    mockReadBackupDocument.mockResolvedValue(json);
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
    expect(hook.result.current.backupOperation).toBe('idle');
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
    expect(hook.result.current.backupOperation).toBe('idle');
  });
});
