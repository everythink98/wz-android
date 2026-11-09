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
  let phase: 'loading' | 'ready' | 'closed' = 'loading';
  return {
    stage: (state: DiagnosticFields['state']) => markDiagnosticStage(trace, 'transport', { ...fields, state }),
    ready: () => {
      if (phase !== 'loading') return;
      phase = 'ready';
      finishDiagnosticTrace(trace, 'success', { ...fields, state: 'player-ready' });
    },
    failed: (error?: unknown) => {
      if (phase === 'closed') return;
      const wasReady = phase === 'ready';
      phase = 'closed';
      finishDiagnosticTrace(wasReady ? createTrace('media', 'player-error') : trace, 'failure', {
        ...fields,
        ...(wasReady ? { parentTraceId: trace.traceId } : {}),
        mediaFailure: imageFailureKind(error),
        terminalReason: 'native-error'
      });
    },
    canceled: () => {
      const wasLoading = phase === 'loading';
      phase = 'closed';
      if (wasLoading) finishDiagnosticTrace(trace, 'canceled', { ...fields, reason: 'canceled' });
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
