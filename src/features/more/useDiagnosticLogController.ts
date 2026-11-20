import { useCallback } from 'react';
import { exportDiagnosticLog, type DiagnosticExportMetadata } from '@/platform/diagnostics/diagnosticFileStore';
import { markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useDocumentOperation } from './useDocumentOperation';

export function useDiagnosticLogController({
  getCurrentScreen,
  metadata,
  notify
}: {
  getCurrentScreen: () => DiagnosticExportMetadata['currentScreen'];
  metadata: DiagnosticExportMetadata;
  notify: (message: string) => void;
}) {
  const { operation, run } = useDocumentOperation('diagnostic', notify);
  const metadataRef = useCommittedRef(metadata);
  const exportDiagnosticLogFile = useCallback(
    () =>
      run('export', async (trace) => {
        markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
        await exportDiagnosticLog({ ...metadataRef.current, currentScreen: getCurrentScreen() });
        markDiagnosticStage(trace, 'apply', { state: 'share-completed' });
        return '诊断日志已生成';
      }),
    [getCurrentScreen, metadataRef, run]
  );
  return { diagnosticBusy: operation !== 'idle', exportDiagnosticLogFile };
}
