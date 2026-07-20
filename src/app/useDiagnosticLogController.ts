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
import { useCommittedRef } from './useCommittedRef';

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
  const metadataRef = useCommittedRef(metadata);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);

  const exportDiagnosticLogFile = useCallback(async () => {
    const trace = beginDiagnosticTrace('diagnostic', 'export');
    if (diagnosticBusyRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    let failureReason: DiagnosticReason = 'unknown';
    const completed = await runBackupOperation({
      busyRef: diagnosticBusyRef,
      notify,
      setBusy: setDiagnosticBusy,
      task: async () => {
        try {
          markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
          await exportDiagnosticLog({
            ...metadataRef.current,
            currentScreen: getCurrentScreen()
          });
          markDiagnosticStage(trace, 'apply', { state: 'share-completed' });
          notify('诊断日志已生成');
        } catch (error) {
          failureReason = normalizeDiagnosticReason(error);
          throw error;
        }
      }
    });
    finishDiagnosticTrace(trace, completed ? 'success' : 'failure', completed ? {} : { reason: failureReason });
  }, [getCurrentScreen, notify]);

  return {
    diagnosticBusy,
    exportDiagnosticLogFile
  };
}
