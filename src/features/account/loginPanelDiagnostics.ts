import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import type { LoginWebViewFailureReason } from './credentialDiagnostics';

export type LoginTransportState = 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout' | 'auto-check';
type Source = 'nodeseek' | 'yaohuo';
type TraceSlot = { kind: 'idle' } | { kind: 'active'; trace: DiagnosticTrace; requestId: number };
type Terminal = { kind: 'open' } | { kind: 'failed'; requestId: number };
type ObservedPanel = { kind: 'hidden' } | { kind: 'visible'; requestId: number };

export function createLoginPanelDiagnostics(source: Source) {
  let traceSlot: TraceSlot = { kind: 'idle' };
  let terminal: Terminal = { kind: 'open' };
  let observed: ObservedPanel = { kind: 'hidden' };

  const finish = (
    trace: DiagnosticTrace,
    outcome: Parameters<typeof finishDiagnosticTrace>[1],
    fields: Record<string, unknown> = {}
  ) => {
    if (traceSlot.kind !== 'active' || traceSlot.trace !== trace) return;
    finishDiagnosticTrace(trace, outcome, { source, ...fields });
    traceSlot = { kind: 'idle' };
  };
  const currentTrace = (requestId: number, mode: 'open' | 'manual') => {
    if (traceSlot.kind === 'active' && traceSlot.requestId === requestId) return traceSlot.trace;
    if (traceSlot.kind === 'active') finishDiagnosticTrace(traceSlot.trace, 'stale', { source, reason: 'superseded' });
    const trace = beginDiagnosticTrace('credential', 'check', { source, mode });
    traceSlot = { kind: 'active', trace, requestId };
    return trace;
  };

  return {
    finish,
    currentTrace,
    observePanel(visible: boolean, requestId: number) {
      const opened =
        visible && (observed.kind === 'hidden' || (source === 'yaohuo' && observed.requestId !== requestId));
      if (opened) markDiagnosticStage(currentTrace(requestId, 'open'), 'guard', { source, state: 'open' });
      else if (!visible && observed.kind === 'visible' && traceSlot.kind === 'active')
        finish(traceSlot.trace, 'canceled', { reason: 'canceled' });
      observed = visible ? { kind: 'visible', requestId } : { kind: 'hidden' };
    },
    recordWebView(
      requestId: number,
      state: LoginTransportState,
      attempt: number,
      onFailure: (site: Source, attempt: number, reason: LoginWebViewFailureReason) => void
    ) {
      if (terminal.kind === 'failed' && terminal.requestId === requestId) {
        if (state === 'start') terminal = { kind: 'open' };
        else return;
      }
      const trace = currentTrace(requestId, 'open');
      if (state === 'auto-check') {
        markDiagnosticStage(trace, 'parse', { source, channel: 'webview', verificationAction: 'auto-check' });
        return;
      }
      if (state === 'error' || state === 'renderer-gone' || state === 'timeout') {
        terminal = { kind: 'failed', requestId };
        const reason = state === 'renderer-gone' ? 'renderer_gone' : state === 'timeout' ? 'timeout' : 'network_error';
        markDiagnosticStage(trace, 'transport', { source, channel: 'webview', state: 'failure', reason });
        finish(trace, 'failure', { reason });
        onFailure(source, attempt, reason);
        return;
      }
      markDiagnosticStage(trace, 'transport', {
        source,
        channel: 'webview',
        state: state === 'start' ? 'started' : 'ready'
      });
    }
  };
}
