import type { XiaoyinsiAuthorizationReadResult } from '@/domain/session/accountCenter';
import { siteSessionStateFromEvents, type AccountStatusObservation } from '@/domain/session/siteSessionState';
import { isCanceledRequest } from '@/platform/network/errors';
import { REQUEST_CANCELED_MESSAGE } from '@/platform/network/request';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

export async function readXiaoyinsiAccountStatus({
  readAuthorization,
  signal
}: {
  readAuthorization: (
    trace?: DiagnosticTrace,
    options?: { signal?: AbortSignal }
  ) => Promise<XiaoyinsiAuthorizationReadResult>;
  signal: AbortSignal;
}): Promise<AccountStatusObservation> {
  const trace = beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
  try {
    const result = await readAuthorization(trace, { signal });
    if (!result.sessionEvent) throw new Error(REQUEST_CANCELED_MESSAGE);
    if (result.authenticated === null) {
      throw new Error(
        result.sessionEvent.type === 'check-failed'
          ? result.sessionEvent.message || '小隐寺状态暂时无法确认'
          : '小隐寺状态暂时无法确认'
      );
    }
    finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi' });
    const event =
      result.authenticated === false
        ? {
            type: 'cookie-loaded' as const,
            loggedIn: false,
            currentUser: null,
            at: new Date().toISOString()
          }
        : result.sessionEvent;
    return { session: siteSessionStateFromEvents('xiaoyinsi', [event]) };
  } catch (error) {
    const canceled = signal.aborted || isCanceledRequest(error);
    finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
      source: 'xiaoyinsi',
      reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
    });
    throw error;
  }
}
