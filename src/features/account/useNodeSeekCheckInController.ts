import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { NodeSeekAttendanceBoard, NodeSeekCheckInState } from '@/domain/forum/accountData';
import { isRecord } from '@/domain/forum/html';
import { buildNodeSeekAttendanceRequest } from '@/sources/nodeseek/actionRequest';
import { runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { errorMessage } from '@/platform/network/errors';
import {
  rejectUnauthorizedResponse,
  withRequestBeforeSend,
  type Fetcher,
  type RequestDispatchState
} from '@/platform/network/request';
import { forumMutationKeys } from '@/platform/query/serverState';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticReason,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import { WritableSessionBlockedError, type WritableSessionTicket } from '@/domain/session/writableSessionGate';

type AttendanceVariables = {
  random: boolean;
  ticket: WritableSessionTicket;
  trace: DiagnosticTrace;
  signal: AbortSignal;
};
type AttendanceResult = {
  state: NodeSeekCheckInState;
  serverConfirmed: boolean;
  serverDayId: number | null;
  reason?: DiagnosticReason;
};
type ScopedAttendanceState = {
  ticket: WritableSessionTicket;
  state: NodeSeekCheckInState;
  serverDayId: number | null;
};
type AttendanceOperation = { ticket: WritableSessionTicket | null; cancellation: AbortController };
const IDLE: NodeSeekCheckInState = { kind: 'idle' };

class AttendanceError extends Error {
  constructor(
    message: string,
    readonly reason: DiagnosticReason,
    readonly serverConfirmed = false
  ) {
    super(message);
  }
}

function sameTicket(left: WritableSessionTicket, right: WritableSessionTicket) {
  return (
    left.source === right.source && left.identityKey === right.identityKey && left.sessionEpoch === right.sessionEpoch
  );
}

function sameAttendanceState(left: NodeSeekCheckInState, right: NodeSeekCheckInState) {
  if (left.kind !== right.kind) return false;
  if (left.kind !== 'signed' || right.kind !== 'signed') return true;
  return (
    left.order === right.order &&
    left.record.id === right.record.id &&
    left.record.memberId === right.record.memberId &&
    left.record.dayId === right.record.dayId &&
    left.record.gain === right.record.gain &&
    left.record.createdAt === right.record.createdAt
  );
}

function signedState(board: NodeSeekAttendanceBoard): NodeSeekCheckInState {
  return board.record ? { kind: 'signed', record: board.record, order: board.order } : IDLE;
}

function attendanceDay(board: NodeSeekAttendanceBoard) {
  if (board.record) return board.record.dayId;
  const firstDay = board.list[0]?.dayId;
  return firstDay !== undefined && board.list.every((entry) => entry.dayId === firstDay) ? firstDay : null;
}

function canRetryAttendanceRead(error: unknown) {
  if (
    !isRecord(error) ||
    error.verificationRequired ||
    error.loginRequired ||
    (error.kind !== undefined && error.kind !== 'ordinary')
  )
    return false;
  const reason = normalizeDiagnosticReason(error);
  const status = Number(error.status ?? error.statusCode);
  if ([401, 403, 429].includes(status) || error.reason === 'cloudflare') {
    return false;
  }
  return (
    reason === 'network_error' ||
    reason === 'timeout' ||
    ((status === 408 || status >= 500) && (reason === 'http_error' || reason === 'unknown'))
  );
}

function waitForAttendanceRead(signal: AbortSignal, delayMs: number) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    if (signal.aborted) finish();
    else signal.addEventListener('abort', finish, { once: true });
  });
}

export function useNodeSeekCheckInController({
  currentSessionTicket,
  ensureWritableSession,
  fetcher,
  isWritableSessionTicketCurrent,
  nodeSeekUserAgentRef,
  notify,
  onConfirmed,
  onSessionExpired,
  readAttendance
}: {
  currentSessionTicket: WritableSessionTicket | null;
  ensureWritableSession: (source: 'nodeseek') => Promise<WritableSessionTicket>;
  fetcher: Fetcher;
  isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onConfirmed?: (ticket: WritableSessionTicket, current?: number) => void;
  onSessionExpired: (source: 'nodeseek', requestSessionEpoch: number) => void;
  readAttendance: (ticket: WritableSessionTicket) => Promise<NodeSeekAttendanceBoard>;
}) {
  const sessionTicketRef = useRef(currentSessionTicket);
  sessionTicketRef.current = currentSessionTicket;
  const mountedRef = useRef(true);
  const operationRef = useRef<AttendanceOperation | null>(null);
  const [busyOperation, setBusyOperation] = useState<AttendanceOperation | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current?.cancellation.abort();
    };
  }, []);
  useEffect(() => {
    const operation = operationRef.current;
    const currentTicket = sessionTicketRef.current;
    if (operation?.ticket && (!currentTicket || !sameTicket(operation.ticket, currentTicket))) {
      operation.cancellation.abort();
    }
  }, [currentSessionTicket?.identityKey, currentSessionTicket?.sessionEpoch]);
  const [scopedState, setScopedState] = useState<ScopedAttendanceState | null>(null);
  const scopedStateRef = useRef<ScopedAttendanceState | null>(null);
  const commit = useCallback(
    (ticket: WritableSessionTicket, state: NodeSeekCheckInState, serverDayId: number | null) => {
      const previous = scopedStateRef.current;
      if (
        previous &&
        sameTicket(previous.ticket, ticket) &&
        previous.serverDayId === serverDayId &&
        sameAttendanceState(previous.state, state)
      )
        return;
      const next = { ticket, state, serverDayId };
      scopedStateRef.current = next;
      setScopedState(next);
    },
    []
  );
  const assertCurrent = useCallback(
    (ticket: WritableSessionTicket, serverConfirmed = false, signal?: AbortSignal) => {
      if (!mountedRef.current || signal?.aborted || !isWritableSessionTicketCurrent(ticket)) {
        throw new AttendanceError('登录状态已变化，请重试', 'stale', serverConfirmed);
      }
    },
    [isWritableSessionTicketCurrent]
  );
  const readBoard = useCallback(
    async (ticket: WritableSessionTicket, signal?: AbortSignal) => {
      assertCurrent(ticket, false, signal);
      const board = await readAttendance(ticket);
      assertCurrent(ticket, false, signal);
      if (`nodeseek:${board.userId}` !== ticket.identityKey) {
        throw new AttendanceError('签到状态与当前账号不一致', 'stale');
      }
      return board;
    },
    [assertCurrent, readAttendance]
  );
  const expireIfUnauthorized = useCallback(
    (error: unknown, ticket: WritableSessionTicket) => {
      if (isRecord(error) && error.reason === 'http-401' && isWritableSessionTicketCurrent(ticket)) {
        onSessionExpired('nodeseek', ticket.sessionEpoch);
      }
    },
    [isWritableSessionTicketCurrent, onSessionExpired]
  );
  const reconcile = async (
    ticket: WritableSessionTicket,
    serverConfirmed: boolean,
    serverDayId: number | null,
    signal: AbortSignal,
    reason: DiagnosticReason = 'unconfirmed'
  ): Promise<AttendanceResult> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      assertCurrent(ticket, serverConfirmed, signal);
      if (attempt > 0) {
        await waitForAttendanceRead(signal, attempt * 200);
        assertCurrent(ticket, serverConfirmed, signal);
      }
      try {
        const board = await readBoard(ticket, signal);
        const today = attendanceDay(board);
        if (board.record) return { state: signedState(board), serverConfirmed, serverDayId: today };
        if (serverDayId !== null && today !== null && serverDayId !== today) {
          return { state: IDLE, serverConfirmed, serverDayId: today };
        }
      } catch (error) {
        expireIfUnauthorized(error, ticket);
        assertCurrent(ticket, serverConfirmed, signal);
        reason = normalizeDiagnosticReason(error);
        if (!canRetryAttendanceRead(error)) break;
      }
    }
    return {
      state: { kind: serverConfirmed ? 'confirmed-pending' : 'result-unknown' },
      serverConfirmed,
      serverDayId,
      reason
    };
  };
  const authenticatedFetcher = rejectUnauthorizedResponse(fetcher);
  const mutation = useMutation<AttendanceResult, unknown, AttendanceVariables>({
    mutationKey: forumMutationKeys.topic('nodeseek', 'global'),
    mutationFn: async ({ random, ticket, trace, signal }) => {
      const board = await readBoard(ticket, signal);
      const serverDayId = attendanceDay(board);
      if (board.record) return { state: signedState(board), serverConfirmed: false, serverDayId };
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        state: 'ready',
        hasCredential: true,
        credentialSource: 'managed-cookie-jar'
      });
      const dispatchState: RequestDispatchState = { mayHaveSent: false };
      let result: unknown;
      try {
        result = await runNodeSeekAction({
          fetcher: withRequestBeforeSend(
            withDiagnosticFetcher(trace, authenticatedFetcher),
            () => assertCurrent(ticket),
            dispatchState
          ),
          request: buildNodeSeekAttendanceRequest({ random }),
          signal,
          userAgent: nodeSeekUserAgentRef.current
        });
      } catch (error) {
        expireIfUnauthorized(error, ticket);
        assertCurrent(ticket);
        if (!dispatchState.mayHaveSent || (isRecord(error) && error.reason === 'http-401')) {
          throw new AttendanceError(errorMessage(error), normalizeDiagnosticReason(error));
        }
        if (isRecord(error) && error.serverRejected === true) {
          try {
            const latestBoard = await readBoard(ticket, signal);
            if (latestBoard.record) {
              return {
                state: signedState(latestBoard),
                serverConfirmed: false,
                serverDayId: attendanceDay(latestBoard)
              };
            }
          } catch (readError) {
            expireIfUnauthorized(readError, ticket);
            assertCurrent(ticket);
          }
          throw new AttendanceError(errorMessage(error), normalizeDiagnosticReason(error));
        }
        return reconcile(ticket, false, serverDayId, signal, normalizeDiagnosticReason(error));
      }
      if (!isRecord(result) || result.success !== true) return reconcile(ticket, false, serverDayId, signal);
      markDiagnosticStage(trace, 'transport', { source: 'nodeseek', state: 'confirmed', serverConfirmed: true });
      assertCurrent(ticket, true);
      const current =
        typeof result.current === 'number' && Number.isFinite(result.current) ? result.current : undefined;
      onConfirmed?.(ticket, current);
      return reconcile(ticket, true, serverDayId, signal);
    },
    onSuccess: ({ state, serverConfirmed, serverDayId, reason }, { ticket, trace }) => {
      if (!mountedRef.current || !isWritableSessionTicketCurrent(ticket)) {
        finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale', serverConfirmed });
        return;
      }
      commit(ticket, state, serverDayId);
      if (state.kind === 'signed') notify(`今日已签到，获得 ${state.record.gain} 鸡腿`);
      else if (state.kind === 'confirmed-pending') notify('签到成功，收益暂时无法读取');
      else if (state.kind === 'result-unknown') notify('签到结果暂未确认，请稍后查看，勿重复提交');
      else notify('已进入新签到日，请重新选择签到方式');
      finishDiagnosticTrace(trace, state.kind === 'signed' ? 'success' : 'partial', {
        source: 'nodeseek',
        ...(serverConfirmed ? { serverConfirmed: true } : {}),
        ...(state.kind !== 'signed' ? { reason: reason ?? 'unconfirmed' } : {})
      });
    },
    onError: (error, { ticket, trace }) => {
      expireIfUnauthorized(error, ticket);
      const current = mountedRef.current && isWritableSessionTicketCurrent(ticket);
      const failure =
        error instanceof AttendanceError
          ? error
          : new AttendanceError(errorMessage(error), normalizeDiagnosticReason(error));
      if (current && failure.reason !== 'stale') notify(failure.message);
      finishDiagnosticTrace(trace, current ? (failure.reason === 'stale' ? 'stale' : 'failure') : 'stale', {
        source: 'nodeseek',
        reason: current ? failure.reason : 'stale',
        ...(failure.serverConfirmed ? { serverConfirmed: true } : {})
      });
    }
  });

  const isCurrentOperation = useCallback(
    (operation: AttendanceOperation) => {
      const currentTicket = sessionTicketRef.current;
      return operation.ticket
        ? Boolean(
            currentTicket &&
            sameTicket(operation.ticket, currentTicket) &&
            isWritableSessionTicketCurrent(operation.ticket)
          )
        : currentTicket === null;
    },
    [isWritableSessionTicketCurrent]
  );
  const beginOperation = useCallback(() => {
    if (operationRef.current && isCurrentOperation(operationRef.current)) return null;
    operationRef.current?.cancellation.abort();
    const operation = { ticket: sessionTicketRef.current, cancellation: new AbortController() };
    operationRef.current = operation;
    setBusyOperation(operation);
    return operation;
  }, [isCurrentOperation]);
  const finishOperation = useCallback((operation: AttendanceOperation) => {
    if (operationRef.current !== operation) return;
    operationRef.current = null;
    if (mountedRef.current) setBusyOperation(null);
  }, []);

  const checkIn = useCallback(
    async (random = false) => {
      const previous = scopedStateRef.current;
      if (previous && previous.state.kind !== 'idle' && isWritableSessionTicketCurrent(previous.ticket)) return;
      const operation = beginOperation();
      if (!operation) return;
      const trace = beginDiagnosticTrace('session', 'attendance', { source: 'nodeseek' });
      let mutationStarted = false;
      try {
        const ticket = await ensureWritableSession('nodeseek');
        if (operationRef.current !== operation) {
          finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
          return;
        }
        operation.ticket = ticket;
        setBusyOperation({ ...operation });
        mutationStarted = true;
        await mutation.mutateAsync({ random, ticket, trace, signal: operation.cancellation.signal });
      } catch (error) {
        if (!mutationStarted) {
          if (operationRef.current !== operation || !isCurrentOperation(operation)) {
            finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
            return;
          }
          notify(errorMessage(error));
          finishDiagnosticTrace(trace, error instanceof WritableSessionBlockedError ? 'blocked' : 'failure', {
            source: 'nodeseek',
            reason: normalizeDiagnosticReason(error)
          });
        }
      } finally {
        finishOperation(operation);
      }
    },
    [
      beginOperation,
      finishOperation,
      isCurrentOperation,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      mutation.mutateAsync,
      notify
    ]
  );

  const observeBoard = useCallback(
    (board: NodeSeekAttendanceBoard, ticket: WritableSessionTicket) => {
      if (!isWritableSessionTicketCurrent(ticket) || `nodeseek:${board.userId}` !== ticket.identityKey) return;
      const previous = scopedStateRef.current;
      const previousScope = previous && sameTicket(previous.ticket, ticket) ? previous : null;
      const previousState = previousScope?.state ?? IDLE;
      const today = attendanceDay(board);
      const changedDay = previousScope?.serverDayId != null && today !== null && previousScope.serverDayId !== today;
      if (board.record) commit(ticket, signedState(board), today);
      else if (previousState.kind === 'idle' || previousState.kind === 'signed' || changedDay) {
        commit(ticket, IDLE, today);
      }
    },
    [commit, isWritableSessionTicketCurrent]
  );
  const refresh = useCallback(
    async (ticket: WritableSessionTicket) => {
      if (!isWritableSessionTicketCurrent(ticket)) return;
      const operation = beginOperation();
      if (!operation) return;
      operation.ticket = ticket;
      setBusyOperation({ ...operation });
      try {
        observeBoard(await readBoard(ticket, operation.cancellation.signal), ticket);
      } catch (error) {
        expireIfUnauthorized(error, ticket);
        if (isWritableSessionTicketCurrent(ticket)) notify(errorMessage(error));
      } finally {
        finishOperation(operation);
      }
    },
    [
      beginOperation,
      finishOperation,
      observeBoard,
      isWritableSessionTicketCurrent,
      readBoard,
      expireIfUnauthorized,
      notify
    ]
  );
  const state =
    scopedState &&
    currentSessionTicket &&
    sameTicket(scopedState.ticket, currentSessionTicket) &&
    isWritableSessionTicketCurrent(scopedState.ticket)
      ? scopedState.state
      : IDLE;
  const busy = busyOperation ? isCurrentOperation(busyOperation) : false;
  return { busy, checkIn, state, refresh, observeBoard };
}
