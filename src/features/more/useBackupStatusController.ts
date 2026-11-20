import { useCallback } from 'react';
import { markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { saveBackupDocument } from '@/platform/storage/backupExport';
import { safeFileName } from '@/platform/storage/backupFiles';
import { pickBackupFileText } from '@/platform/storage/backupImportFile';
import { useDocumentOperation } from './useDocumentOperation';

export function useBackupStatusController({
  notify,
  importBackup,
  exportBackup
}: {
  notify: (message: string) => void;
  importBackup: (json: string) => Promise<void>;
  exportBackup: () => Promise<string>;
}) {
  const { operation, run } = useDocumentOperation('backup', notify);
  const exportBackupFile = useCallback(
    () =>
      run('export', async (trace) => {
        markDiagnosticStage(trace, 'guard', { state: 'waiting-for-save' });
        const content = await exportBackup();
        markDiagnosticStage(trace, 'persist', { state: 'started' });
        const result = await saveBackupDocument(safeFileName('forum-reader-backup', 'json'), content);
        if (result.status === 'canceled') return null;
        markDiagnosticStage(trace, 'apply', { state: 'saved', byteCount: result.byteCount });
        return '备份已保存到所选位置';
      }),
    [exportBackup, run]
  );
  const importBackupFile = useCallback(
    () =>
      run('import', async (trace) => {
        markDiagnosticStage(trace, 'guard', { state: 'document-picker' });
        const content = await pickBackupFileText();
        if (content === null) return null;
        markDiagnosticStage(trace, 'parse', { byteCount: new TextEncoder().encode(content).byteLength });
        markDiagnosticStage(trace, 'apply', { state: 'merge-started' });
        await importBackup(content);
        return '备份已恢复，本机资料已合并';
      }),
    [importBackup, run]
  );
  return { backupOperation: operation, exportBackupFile, importBackupFile };
}
