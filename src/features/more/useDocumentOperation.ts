import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { errorMessage } from '@/platform/network/errors';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type Operation = 'export' | 'import';
export type DocumentOperation = Operation | 'idle';

export function useDocumentOperation(area: 'backup' | 'diagnostic', notify: (message: string) => void) {
  const [{ operation, notice }, setView] = useState<{ operation: DocumentOperation; notice: string | null }>({
    operation: 'idle',
    notice: null
  });
  const inFlight = useRef(false);
  const observing = useRef(true);
  const notifyRef = useCommittedRef(notify);
  useLayoutEffect(() => {
    observing.current = true;
    return () => {
      observing.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (notice === null) return;
    setView((current) => ({ ...current, notice: null }));
    notifyRef.current(notice);
  }, [notice, notifyRef]);

  const run = useCallback(
    async (kind: Operation, task: (trace: DiagnosticTrace) => Promise<string | null>) => {
      if (!observing.current) return;
      const trace = beginDiagnosticTrace(area, kind);
      if (inFlight.current) {
        markDiagnosticStage(trace, 'guard', { state: 'busy' });
        finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
        return;
      }
      inFlight.current = true;
      setView((current) => ({ ...current, operation: kind }));
      let outcomeNotice: string | null | undefined;
      try {
        outcomeNotice = await task(trace);
        if (outcomeNotice === null) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        } else {
          finishDiagnosticTrace(trace, 'success');
        }
      } catch (error) {
        const reason = normalizeDiagnosticReason(error);
        if (area === 'backup') {
          markDiagnosticStage(trace, reason === 'invalid_response' ? 'parse' : 'persist', { state: 'failure', reason });
        }
        outcomeNotice = errorMessage(error);
        finishDiagnosticTrace(trace, 'failure', { reason });
      } finally {
        inFlight.current = false;
        setView({ operation: 'idle', notice: outcomeNotice ?? null });
      }
    },
    [area]
  );
  return { operation, run };
}
