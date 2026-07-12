import { useCallback, useRef, useState } from 'react';
import { runBackupOperation } from '../backupOperation';
import { exportDiagnosticLog, type DiagnosticExportMetadata } from '../diagnosticFileStore';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticReason
} from '../diagnostics';

export function useDiagnosticLogController({
  getCurrentScreen,
  metadata,
  notify
}: {
  getCurrentScreen: () => DiagnosticExportMetadata['currentScreen'];
  metadata: DiagnosticExportMetadata;
  notify: (message: string) => void;
}) {
  const diagnosticBusyRef = useRef(false);
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);

  const exportDiagnosticLogFile = useCallback(async () => {
    if (diagnosticBusyRef.current) {
      const trace = beginDiagnosticTrace('diagnostic', 'export');
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    let trace: ReturnType<typeof beginDiagnosticTrace> | undefined;
    let failureReason: DiagnosticReason = 'unknown';
    const completed = await runBackupOperation({
      busyRef: diagnosticBusyRef,
      notify,
      setBusy: setDiagnosticBusy,
      task: async () => {
        try {
          await exportDiagnosticLog({
            ...metadataRef.current,
            currentScreen: getCurrentScreen()
          }, {
            onSnapshotReady: () => {
              trace = beginDiagnosticTrace('diagnostic', 'export');
              markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
            }
          });
          if (trace) {
            markDiagnosticStage(trace, 'apply', { state: 'share-completed' });
          }
          notify('诊断日志已生成');
        } catch (error) {
          trace ||= beginDiagnosticTrace('diagnostic', 'export');
          failureReason = normalizeDiagnosticReason(error);
          throw error;
        }
      }
    });
    trace ||= beginDiagnosticTrace('diagnostic', 'export');
    finishDiagnosticTrace(trace, completed ? 'success' : 'failure', completed ? {} : { reason: failureReason });
  }, [getCurrentScreen, notify]);

  return {
    diagnosticBusy,
    exportDiagnosticLogFile
  };
}
