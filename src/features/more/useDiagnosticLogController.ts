import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { runBackupOperation, type BackupOperationGate } from '@/platform/storage/backupOperation';
import { exportDiagnosticLog, type DiagnosticExportMetadata } from '@/platform/diagnostics/diagnosticFileStore';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

export function useDiagnosticLogController({
  getCurrentScreen,
  metadata,
  notify
}: {
  getCurrentScreen: () => DiagnosticExportMetadata['currentScreen'];
  metadata: DiagnosticExportMetadata;
  notify: (message: string) => void;
}) {
  const lifetimeRef = useRef(new AbortController());
  const gate = useRef<BackupOperationGate>({ current: { phase: 'idle' } }).current;
  const notifyRef = useCommittedRef(notify);
  const metadataRef = useCommittedRef(metadata);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);

  useLayoutEffect(() => {
    if (lifetimeRef.current.signal.aborted) lifetimeRef.current = new AbortController();
    const lifetime = lifetimeRef.current;
    if (gate.current.phase === 'running') gate.current.observer.signal = lifetime.signal;
    return () => lifetime.abort();
  }, [gate]);

  const exportDiagnosticLogFile = useCallback(async () => {
    if (lifetimeRef.current.signal.aborted) return;
    const trace = beginDiagnosticTrace('diagnostic', 'export');
    if (gate.current.phase === 'running') {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    let failureReason: DiagnosticReason = 'unknown';
    const observer = { signal: lifetimeRef.current.signal };
    const isCurrent = () => !observer.signal.aborted && lifetimeRef.current.signal === observer.signal;
    const report = (message: string) => {
      if (isCurrent()) notifyRef.current(message);
    };
    const completed = await runBackupOperation({
      gate,
      observer,
      notify: report,
      setBusy: (value) => {
        if (isCurrent()) setDiagnosticBusy(value);
      },
      task: async () => {
        try {
          markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
          await exportDiagnosticLog({
            ...metadataRef.current,
            currentScreen: getCurrentScreen()
          });
          markDiagnosticStage(trace, 'apply', { state: 'share-completed' });
          report('诊断日志已生成');
        } catch (error) {
          failureReason = normalizeDiagnosticReason(error);
          throw error;
        }
      }
    });
    finishDiagnosticTrace(trace, completed ? 'success' : 'failure', completed ? {} : { reason: failureReason });
  }, [gate, getCurrentScreen, notifyRef]);

  return {
    diagnosticBusy,
    exportDiagnosticLogFile
  };
}
