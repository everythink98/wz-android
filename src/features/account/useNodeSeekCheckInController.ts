import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { buildNodeSeekAttendanceRequest } from '@/sources/nodeseek/actionRequest';
import { runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { errorMessage } from '@/platform/network/errors';
import type { Fetcher } from '@/platform/network/request';
import { forumMutationKeys } from '@/platform/query/serverState';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnostics';
import {
  WritableSessionBlockedError,
  type WritableSessionReconcileResult,
  type WritableSessionTicket
} from '@/domain/session/writableSessionGate';

type AttendanceVariables = {
  ticket: WritableSessionTicket;
  trace: DiagnosticTrace;
};

class AttendanceError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly serverConfirmed = false
  ) {
    super(message);
  }
}

export function useNodeSeekCheckInController({
  ensureWritableSession,
  fetcher,
  isWritableSessionTicketCurrent,
  nodeSeekUserAgentRef,
  notify,
  reconcileWritableSession
}: {
  ensureWritableSession: (source: 'nodeseek') => Promise<WritableSessionTicket>;
  fetcher: Fetcher;
  isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  reconcileWritableSession: (source: 'nodeseek') => Promise<WritableSessionReconcileResult>;
}) {
  const mutation = useMutation<unknown, unknown, AttendanceVariables>({
    mutationKey: forumMutationKeys.topic('nodeseek', 'global'),
    scope: { id: 'forum:nodeseek:topic:global' },
    mutationFn: async ({ ticket, trace }) => {
      if (!isWritableSessionTicketCurrent(ticket)) {
        throw new AttendanceError('登录状态已变化，请重试', 'stale');
      }
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        state: 'ready',
        hasCredential: true,
        credentialSource: 'managed-cookie-jar'
      });
      try {
        await runNodeSeekAction({
          fetcher: withDiagnosticFetcher(trace, fetcher),
          request: buildNodeSeekAttendanceRequest({ random: false }),
          userAgent: nodeSeekUserAgentRef.current
        });
      } catch (error) {
        if (isWritableSessionTicketCurrent(ticket)) {
          const kind = sourceErrorFromUnknown('nodeseek', error).kind;
          if (kind === 'login-required' || kind === 'login-expired' || kind === 'verification-required') {
            await reconcileWritableSession('nodeseek').catch(() => ({ status: 'unknown' as const }));
          }
        }
        const message = errorMessage(error);
        notify(message);
        throw new AttendanceError(message, normalizeDiagnosticReason(error));
      }
      markDiagnosticStage(trace, 'transport', { source: 'nodeseek', state: 'confirmed', serverConfirmed: true });
      if (!isWritableSessionTicketCurrent(ticket)) {
        throw new AttendanceError('登录状态已变化，请重试', 'stale', true);
      }
      return true;
    },
    onSuccess: (_result, { ticket, trace }) => {
      if (!isWritableSessionTicketCurrent(ticket)) {
        finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale', serverConfirmed: true });
        return;
      }
      notify('签到请求已提交');
      finishDiagnosticTrace(trace, 'success', { source: 'nodeseek', serverConfirmed: true });
    },
    onError: (error, { ticket, trace }) => {
      const current = isWritableSessionTicketCurrent(ticket);
      const failure =
        error instanceof AttendanceError
          ? error
          : new AttendanceError(errorMessage(error), normalizeDiagnosticReason(error));
      if (current && !(error instanceof AttendanceError)) notify(failure.message);
      finishDiagnosticTrace(trace, current ? (failure.reason === 'stale' ? 'stale' : 'failure') : 'stale', {
        source: 'nodeseek',
        reason: current ? failure.reason : 'stale',
        ...(failure.serverConfirmed ? { serverConfirmed: true } : {})
      });
    }
  });

  const checkIn = useCallback(async () => {
    const trace = beginDiagnosticTrace('session', 'attendance', { source: 'nodeseek' });
    try {
      const ticket = await ensureWritableSession('nodeseek');
      await mutation.mutateAsync({ ticket, trace });
    } catch (error) {
      if (error instanceof WritableSessionBlockedError) {
        notify(error.message);
        finishDiagnosticTrace(trace, 'blocked', { source: 'nodeseek', reason: error.reason });
      }
    }
  }, [ensureWritableSession, mutation.mutateAsync, notify]);

  return { busy: mutation.isPending, checkIn };
}
