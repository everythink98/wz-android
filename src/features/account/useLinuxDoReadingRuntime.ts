import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import type { LinuxDoReadingRecovery, RequestAccountRecheck } from '@/domain/session/sessionContracts';
import { createDiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';
import { createLinuxDoReadingSender } from '@/sources/linuxdo/reading';
import type { Fetcher } from '@/platform/network/request';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

export function useLinuxDoReadingRuntime({
  appActive,
  verificationVisible,
  fetcher,
  snapshot,
  userAgent,
  onSessionExpired,
  requestAccountRecheck,
  requestVerification
}: {
  appActive: boolean;
  verificationVisible: boolean;
  fetcher: Fetcher;
  snapshot: () => SessionRuntimeSnapshot;
  userAgent: () => string;
  onSessionExpired: (epoch: number) => void;
  requestAccountRecheck: RequestAccountRecheck;
  requestVerification: (recovery: LinuxDoReadingRecovery) => void;
}) {
  const queryClient = useQueryClient();
  const dependencies = useCommittedRef({
    fetcher,
    snapshot,
    userAgent,
    onSessionExpired,
    requestAccountRecheck,
    requestVerification
  });
  const runtime = useMemo(() => {
    const scope = () => {
      const value = dependencies.current.snapshot();
      return value.sourceEnabled !== false &&
        value.authenticated &&
        value.identityTrust === 'confirmed' &&
        value.identityKey
        ? `${value.identityKey}:${value.sessionEpoch}`
        : null;
    };
    const send = createLinuxDoReadingSender({
      fetcher: (input, init) => dependencies.current.fetcher(input, init),
      scope: () => (dependencies.current.snapshot().authSurfaceOpen ? null : scope()),
      userAgent: () => dependencies.current.userAgent()
    });
    return createDiscourseReadingRuntime({
      queryClient,
      scope,
      onVerificationRequired: (recovery) => dependencies.current.requestVerification(recovery),
      send: async (batch, identity, signal, context) => {
        const { beforePost, ...diagnostics } = context;
        const trace = beginDiagnosticTrace('source', 'reading-timings', {
          source: 'linuxdo',
          ...diagnostics,
          isRecovery: context.recovery
        });
        try {
          await send(batch, identity, signal, trace, context.recovery, beforePost);
          finishDiagnosticTrace(trace, 'success');
        } catch (error) {
          const cf = error as {
            status?: number;
            retryAfterMs?: number;
            hasCfMitigatedChallenge?: boolean;
            hasCfChallengeBody?: boolean;
            cfRay?: string;
          };
          finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
            reason: normalizeDiagnosticReason(error),
            status: cf.status,
            retryAfterMs: cf.retryAfterMs,
            hasCfMitigatedChallenge: cf.hasCfMitigatedChallenge,
            hasCfChallengeBody: cf.hasCfChallengeBody,
            cfRay: cf.cfRay
          });
          if (scope() === identity) {
            const failure = error as { status?: number; reason?: string };
            const current = dependencies.current;
            if (failure?.status === 401) current.onSessionExpired(current.snapshot().sessionEpoch);
            else if (failure?.reason === 'account-recheck-required')
              current.requestAccountRecheck('linuxdo', current.snapshot().sessionEpoch, trace.traceId);
          }
          throw error;
        }
      }
    });
  }, [dependencies, queryClient]);
  useLayoutEffect(() => {
    // Account/source refs are committed before this hook; render-time snapshots may still be stale.
    runtime.sessionChanged();
  });
  const canRead = appActive && !verificationVisible && !snapshot().authSurfaceOpen;
  useLayoutEffect(() => runtime.setAppActive(appActive), [appActive, runtime]);
  useEffect(() => {
    runtime.foreground(canRead);
  }, [canRead, runtime]);
  useEffect(() => () => runtime.dispose(), [runtime]);
  return runtime;
}
