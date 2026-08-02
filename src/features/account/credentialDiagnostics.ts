import type { CredentialSummaries, CredentialSummary } from '@/platform/storage/credentialVault';
import type { CredentialSite } from '@/domain/session/sessionContracts';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

const sites = ['nodeseek', 'linuxdo', 'yaohuo'] as const satisfies readonly CredentialSite[];

export type LoginWebViewFailureReason = 'network_error' | 'renderer_gone' | 'timeout';
export type CredentialFillTraceState = { site: CredentialSite; attempt: number; trace: DiagnosticTrace };

export type CredentialSummaryLoadResult =
  | { ok: true; summaries: CredentialSummaries }
  | { ok: false; stale: true }
  | { ok: false; error: unknown; summaries: Partial<CredentialSummaries> };

export async function loadCredentialSummariesWithTrace(
  loadSummary: (site: CredentialSite) => Promise<CredentialSummary>,
  options: { generation?: number; isCurrent?: () => boolean } = {}
): Promise<CredentialSummaryLoadResult> {
  const generation = options.generation ?? 0;
  const trace = beginDiagnosticTrace('credential', 'load-summary', {
    source: 'all',
    store: 'secure-store',
    generation
  });
  const results = await Promise.all(
    sites.map(async (site) => {
      try {
        const summary = await loadSummary(site);
        markDiagnosticStage(trace, 'credential', {
          site,
          store: 'secure-store',
          state: 'loaded',
          hasCredential: summary.hasCredential,
          isInvalidated: summary.state === 'invalidated'
        });
        return { ok: true as const, summary };
      } catch (error) {
        markDiagnosticStage(trace, 'credential', {
          site,
          store: 'secure-store',
          state: 'failure',
          reason: 'storage_error'
        });
        return { ok: false as const, error };
      }
    })
  );
  const failures = results.filter((result) => !result.ok);
  if (options.isCurrent && !options.isCurrent()) {
    finishDiagnosticTrace(trace, 'stale', { source: 'all', reason: 'stale', generation });
    return { ok: false, stale: true };
  }
  if (failures.length) {
    const summaries = Object.fromEntries(
      results.flatMap((result) => (result.ok ? [[result.summary.site, result.summary] as const] : []))
    ) as Partial<CredentialSummaries>;
    finishDiagnosticTrace(trace, 'partial', {
      source: 'all',
      reason: 'storage_error',
      partialErrorCount: failures.length
    });
    return { ok: false, error: failures[0].error, summaries };
  }
  const summaries = Object.fromEntries(
    results.map((result) => {
      const summary = result.ok ? result.summary : null;
      return [summary!.site, summary!];
    })
  ) as CredentialSummaries;
  finishDiagnosticTrace(trace, 'success', {
    source: 'all',
    count: results.length,
    validCount: results.filter((result) => result.ok && result.summary.hasCredential).length
  });
  return { ok: true, summaries };
}

export function finishCredentialFillTraceForWebViewFailure(
  current: CredentialFillTraceState | null,
  site: CredentialSite,
  attempt: number,
  reason: LoginWebViewFailureReason
) {
  if (!current || current.site !== site || current.attempt !== attempt) {
    return false;
  }
  markDiagnosticStage(current.trace, 'transport', {
    site,
    channel: 'webview',
    state: 'failure',
    reason
  });
  finishDiagnosticTrace(current.trace, 'failure', { site, reason });
  return true;
}
