import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { saveBackupDocument } from '@/platform/storage/backupExport';
import { safeFileName } from '@/platform/storage/backupFiles';
import { readBackupFileText } from '@/platform/storage/backupImportFile';
import { runBackupOperation } from '@/platform/storage/backupOperation';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

export function useBackupStatusController({
  notify,
  importBackup,
  exportBackup
}: {
  notify: (message: string) => void;
  importBackup: (json: string) => Promise<void>;
  exportBackup: () => Promise<string>;
}) {
  const lifetimeRef = useRef(new AbortController());
  const gate = useRef({ current: false, owner: lifetimeRef.current.signal }).current;
  const notifyRef = useCommittedRef(notify);
  const [backupBusy, setBackupBusy] = useState(false);

  useLayoutEffect(() => {
    if (lifetimeRef.current.signal.aborted) lifetimeRef.current = new AbortController();
    const lifetime = lifetimeRef.current;
    if (gate.current) gate.owner = lifetime.signal;
    return () => lifetime.abort();
  }, [gate]);

  const exportBackupFile = useCallback(async () => {
    if (lifetimeRef.current.signal.aborted) return;
    const trace = beginDiagnosticTrace('backup', 'export');
    if (gate.current) {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    let failureReason: DiagnosticReason = 'unknown';
    let canceled = false;
    gate.owner = lifetimeRef.current.signal;
    const isCurrent = () => !gate.owner.aborted && lifetimeRef.current.signal === gate.owner;
    const report = (message: string) => {
      if (isCurrent()) notifyRef.current(message);
    };
    const completed = await runBackupOperation({
      busyRef: gate,
      notify: report,
      setBusy: (value) => {
        if (isCurrent()) setBackupBusy(value);
      },
      task: async () => {
        try {
          markDiagnosticStage(trace, 'guard', { state: 'waiting-for-save' });
          const content = await exportBackup();
          markDiagnosticStage(trace, 'persist', { byteCount: new TextEncoder().encode(content).byteLength });
          const result = await saveBackupDocument(safeFileName('forum-reader-backup', 'json'), content);
          canceled = result.status === 'canceled';
          if (canceled) return;
          markDiagnosticStage(trace, 'apply', { state: 'saved' });
          report('备份已保存到所选位置');
        } catch (error) {
          failureReason = normalizeDiagnosticReason(error);
          markDiagnosticStage(trace, failureReason === 'invalid_response' ? 'parse' : 'persist', {
            state: 'failure',
            reason: failureReason
          });
          throw error;
        }
      }
    });
    finishDiagnosticTrace(
      trace,
      canceled ? 'canceled' : completed ? 'success' : 'failure',
      canceled ? { reason: 'canceled' } : completed ? {} : { reason: failureReason }
    );
  }, [gate, notifyRef, exportBackup]);

  const importBackupFile = useCallback(async () => {
    if (lifetimeRef.current.signal.aborted) return;
    const trace = beginDiagnosticTrace('backup', 'import');
    if (gate.current) {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    let canceled = false;
    let failureReason: DiagnosticReason = 'unknown';
    gate.owner = lifetimeRef.current.signal;
    const isCurrent = () => !gate.owner.aborted && lifetimeRef.current.signal === gate.owner;
    const report = (message: string) => {
      if (isCurrent()) notifyRef.current(message);
    };
    const completed = await runBackupOperation({
      busyRef: gate,
      notify: report,
      setBusy: (value) => {
        if (isCurrent()) setBackupBusy(value);
      },
      task: async () => {
        try {
          markDiagnosticStage(trace, 'guard', { state: 'document-picker' });
          const result = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
            type: ['application/json', 'text/json', '*/*']
          });
          if (result.canceled || !result.assets?.[0]?.uri) {
            canceled = true;
            return;
          }
          const pickedAsset = result.assets[0];
          const pickedUri = pickedAsset.uri;
          try {
            const content = await readBackupFileText(pickedAsset);
            markDiagnosticStage(trace, 'parse', { byteCount: new TextEncoder().encode(content).byteLength });
            markDiagnosticStage(trace, 'apply', { state: 'merge-started' });
            await importBackup(content);
            report('备份已恢复，本机资料已合并');
          } finally {
            if (FileSystem.cacheDirectory && pickedUri.startsWith(FileSystem.cacheDirectory)) {
              await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);
            }
          }
        } catch (error) {
          failureReason = normalizeDiagnosticReason(error);
          markDiagnosticStage(trace, failureReason === 'invalid_response' ? 'parse' : 'persist', {
            state: 'failure',
            reason: failureReason
          });
          throw error;
        }
      }
    });
    finishDiagnosticTrace(
      trace,
      canceled ? 'canceled' : completed ? 'success' : 'failure',
      canceled ? { reason: 'canceled' } : completed ? {} : { reason: failureReason }
    );
  }, [gate, notifyRef, importBackup]);

  return {
    backupBusy,
    exportBackupFile,
    importBackupFile
  };
}
