import {
  beginDiagnosticTrace,
  createTrace,
  finishDiagnosticTrace,
  markDiagnosticStage
} from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';
import { imageFailureKind } from './imageLoadDiagnostics';

export function playerLoadDiagnosticAttempt(uri: string, mediaKind: 'audio' | 'video', generation: number) {
  const fields = { mediaRef: diagnosticRef('media', uri), mediaKind, generation } as const;
  const trace = beginDiagnosticTrace('media', 'player-load', fields);
  let settled = false;
  let failed = false;
  let canceled = false;
  return {
    stage: (state: DiagnosticFields['state']) => markDiagnosticStage(trace, 'transport', { ...fields, state }),
    ready: () => {
      if (canceled || failed) return;
      settled = true;
      finishDiagnosticTrace(trace, 'success', { ...fields, state: 'player-ready' });
    },
    failed: (error?: unknown) => {
      if (failed || canceled) return;
      failed = true;
      finishDiagnosticTrace(settled ? createTrace('media', 'player-error') : trace, 'failure', {
        ...fields,
        ...(settled ? { parentTraceId: trace.traceId } : {}),
        mediaFailure: imageFailureKind(error),
        terminalReason: 'native-error'
      });
      settled = true;
    },
    canceled: () => {
      canceled = true;
      finishDiagnosticTrace(trace, 'canceled', { ...fields, reason: 'canceled' });
    }
  };
}

export function recordMediaBudgetTimeout(requestIdentity: string, mediaKind: 'audio' | 'video', timeoutMs: number) {
  finishDiagnosticTrace(createTrace('media', 'media-budget'), 'failure', {
    mediaRef: diagnosticRef('media', requestIdentity),
    mediaKind,
    timeoutMs,
    reason: 'timeout'
  });
}
