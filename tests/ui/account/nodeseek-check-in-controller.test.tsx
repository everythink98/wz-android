import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Profiler } from 'react';

jest.mock('@/sources/nodeseek/actionClient', () => ({
  runNodeSeekAction: jest.fn()
}));

import { runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { useNodeSeekCheckInController } from '@/features/account/useNodeSeekCheckInController';
import { appQueryClient } from '@/platform/query/serverState';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import {
  type WritableSessionTicket,
  validateWritableSessionTicket,
  type WritableSessionSnapshot
} from '@/domain/session/writableSessionGate';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { NetworkProxyState } from '@/platform/network/networkProxy';
import type { NodeSeekAttendanceBoard } from '@/domain/forum/accountData';
import { prepareRequestToSend } from '@/platform/network/request';

const mockLoadProxy = jest.fn<() => Promise<NetworkProxyState>>();
jest.mock('@/platform/network/networkProxy', () => ({
  ...jest.requireActual<typeof import('@/platform/network/networkProxy')>('@/platform/network/networkProxy'),
  loadNetworkProxyState: () => mockLoadProxy(),
  applyNetworkProxy: async () => ({ ok: true })
}));

const mockRunNodeSeekAction = jest.mocked(runNodeSeekAction);
const ticket: WritableSessionTicket = {
  source: 'nodeseek',
  identityKey: 'nodeseek:7',
  sessionEpoch: 3
};

function attendanceBoard(signed = false, dayId = 120): NodeSeekAttendanceBoard {
  return {
    source: 'nodeseek',
    userId: '7',
    list: [{ id: '101', memberId: '8', dayId, gain: 3, createdAt: '2026-10-01T12:00:00.000Z', memberName: 'Bob' }],
    record: signed ? { id: '100', memberId: '7', dayId, gain: 7, createdAt: '2026-10-01T12:00:00.000Z' } : null,
    order: signed ? 8 : null,
    total: signed ? 8 : 0
  };
}

function attendanceBoardForUser(userId: string, signed = false): NodeSeekAttendanceBoard {
  const board = attendanceBoard(signed);
  return { ...board, userId, record: board.record ? { ...board.record, memberId: userId } : null };
}

async function renderController(
  options: {
    current?: (candidate: WritableSessionTicket) => boolean;
    fetcher?: typeof fetch;
    notify?: (message: string) => void;
    onSessionExpired?: (source: 'nodeseek', requestSessionEpoch: number) => void;
    ensureWritableSession?: (source: 'nodeseek') => Promise<WritableSessionTicket>;
    readAttendance?: (ticket: WritableSessionTicket) => Promise<NodeSeekAttendanceBoard>;
    currentSessionTicket?: WritableSessionTicket | null;
    onConfirmed?: (ticket: WritableSessionTicket, current?: number) => void;
  } = {}
) {
  const notify = options.notify || jest.fn();
  const onSessionExpired = options.onSessionExpired || jest.fn();
  const ensureWritableSession = options.ensureWritableSession || jest.fn(async () => ticket);
  const readAttendance =
    options.readAttendance ||
    jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockResolvedValueOnce(attendanceBoard())
      .mockResolvedValue(attendanceBoard(true));
  const onConfirmed = options.onConfirmed || jest.fn();
  const onCommit = jest.fn();
  const hook = await renderHook(
    () =>
      useNodeSeekCheckInController({
        currentSessionTicket: options.currentSessionTicket === undefined ? ticket : options.currentSessionTicket,
        ensureWritableSession,
        fetcher: options.fetcher || fetch,
        isWritableSessionTicketCurrent: options.current || (() => true),
        nodeSeekUserAgentRef: { current: 'WZ Test' },
        notify,
        onSessionExpired,
        onConfirmed,
        readAttendance
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={appQueryClient}>
          <Profiler id="check-in-controller" onRender={onCommit}>
            {children}
          </Profiler>
        </QueryClientProvider>
      )
    }
  );
  return { hook, notify, onSessionExpired, ensureWritableSession, readAttendance, onConfirmed, onCommit };
}

describe('NodeSeek account check-in controller', () => {
  it.each(['identity', 'epoch', 'source-disabled', 'auth-surface', 'unchanged'])(
    'rechecks attendance after proxy preparation (%s)',
    async (change) => {
      mockRunNodeSeekAction.mockImplementation(
        jest.requireActual<typeof import('@/sources/nodeseek/actionClient')>('@/sources/nodeseek/actionClient')
          .runNodeSeekAction
      );
      const loaded = Promise.withResolvers<NetworkProxyState>();
      mockLoadProxy.mockReturnValue(loaded.promise);
      const snapshot: WritableSessionSnapshot = {
        ...ticket,
        authenticated: true,
        authSurfaceOpen: false,
        identityTrust: 'confirmed',
        sourceEnabled: true
      };
      const baseFetcher = jest.fn(async () => new Response('{"success":true}'));
      const proxy = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
      const { hook, notify } = await renderController({
        fetcher: (input, init) => proxy.result.current.networkProxyFetcher(String(input), init),
        current: () => validateWritableSessionTicket(ticket, snapshot)
      });
      let pending!: Promise<void>;
      await act(async () => {
        pending = hook.result.current.checkIn();
      });
      await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));
      if (change === 'identity') snapshot.identityKey = 'nodeseek:bob';
      if (change === 'epoch') snapshot.sessionEpoch++;
      if (change === 'source-disabled') snapshot.sourceEnabled = false;
      if (change === 'auth-surface') snapshot.authSurfaceOpen = true;
      await act(async () => {
        loaded.resolve({ enabled: false, activeId: null, profiles: [] });
        await pending;
      });
      expect(baseFetcher).toHaveBeenCalledTimes(change === 'unchanged' ? 1 : 0);
      if (change !== 'unchanged') expect(notify).not.toHaveBeenCalled();
    }
  );

  beforeEach(() => {
    appQueryClient.clear();
    mockRunNodeSeekAction.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    setDiagnosticWriter(null);
  });

  it('submits attendance once for synchronous repeated taps', async () => {
    const session = Promise.withResolvers<WritableSessionTicket>();
    const ensureWritableSession = jest.fn(async () => session.promise);
    const firstTransport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => firstTransport.promise);
    const { hook } = await renderController({ ensureWritableSession });
    let first!: Promise<void>;
    let second!: Promise<void>;

    await act(async () => {
      first = hook.result.current.checkIn();
      second = hook.result.current.checkIn(true);
      await Promise.resolve();
    });
    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      session.resolve(ticket);
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));
    await act(async () => {
      firstTransport.resolve({ success: true });
      await first;
      await second;
    });

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ path: '/api/attendance?random=false' }) })
    );
    expect(hook.result.current.busy).toBe(false);
  });

  it('keeps the fixed NodeSeek global mutation identity outside Topic', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    const { hook } = await renderController();

    await act(async () => {
      await hook.result.current.checkIn();
    });

    const attendance = appQueryClient.getMutationCache().getAll().at(-1);
    expect(attendance?.options.mutationKey).toEqual(['forum', 'nodeseek', 'mutation', 'topic', 'global']);
    expect(attendance?.options.scope).toBeUndefined();
  });

  it.each([false, true])(
    'submits the selected random mode (%s) and reads the reward from the board',
    async (random) => {
      mockRunNodeSeekAction.mockResolvedValueOnce({ success: true, current: 50, message: '签到成功' });
      const { hook, readAttendance, notify, onConfirmed } = await renderController();

      await act(async () => {
        await hook.result.current.checkIn(random);
      });

      expect(mockRunNodeSeekAction).toHaveBeenCalledWith(
        expect.objectContaining({ request: expect.objectContaining({ path: `/api/attendance?random=${random}` }) })
      );
      expect(readAttendance).toHaveBeenCalledTimes(2);
      expect(onConfirmed).toHaveBeenCalledWith(ticket, 50);
      expect(hook.result.current.state).toEqual({
        kind: 'signed',
        record: attendanceBoard(true).record,
        order: 8
      });
      expect(notify).toHaveBeenCalledWith('今日已签到，获得 7 鸡腿');
    }
  );

  it('uses the current signed record without submitting attendance again', async () => {
    const readAttendance = jest.fn(async () => attendanceBoard(true));
    const { hook, ensureWritableSession, onConfirmed } = await renderController({ readAttendance });

    await act(async () => {
      await hook.result.current.checkIn(true);
      await hook.result.current.checkIn(false);
    });

    expect(readAttendance).toHaveBeenCalledTimes(1);
    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(hook.result.current.state.kind).toBe('signed');
  });

  it('does not submit when the read-only preflight fails', async () => {
    const readAttendance = jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockRejectedValue(new Error('签到状态读取失败'));
    const { hook, notify, onSessionExpired } = await renderController({ readAttendance });

    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(hook.result.current.state).toEqual({ kind: 'idle' });
    expect(notify).toHaveBeenCalledWith('签到状态读取失败');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('automatically confirms the reward after a transient read failure without submitting again', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true, current: 50 });
    const readAttendance = jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockResolvedValueOnce(attendanceBoard())
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(attendanceBoard(true));
    const { hook, ensureWritableSession, notify } = await renderController({ readAttendance });
    await act(async () => {
      await hook.result.current.checkIn(true);
    });

    expect(hook.result.current.state.kind).toBe('signed');
    expect(notify).toHaveBeenCalledWith('今日已签到，获得 7 鸡腿');
    expect(readAttendance).toHaveBeenCalledTimes(3);
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('confirms a temporarily invisible record using GET only (success=%s)', async (success) => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: success || undefined });
    const readAttendance = jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockResolvedValueOnce(attendanceBoard())
      .mockResolvedValueOnce(attendanceBoard())
      .mockResolvedValueOnce(attendanceBoard())
      .mockResolvedValueOnce(attendanceBoard(true));
    const { hook } = await renderController({ readAttendance });
    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(hook.result.current.state.kind).toBe('signed');
    expect(readAttendance).toHaveBeenCalledTimes(4);
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: '401', error: Object.assign(new Error('登录状态已失效'), { reason: 'http-401', status: 401 }) },
    { label: '403', error: Object.assign(new Error('无权限'), { status: 403 }) },
    { label: '429', error: Object.assign(new Error('请求过多'), { status: 429 }) },
    {
      label: 'verification',
      error: Object.assign(new Error('需要验证'), { verificationRequired: true, reason: 'cloudflare' })
    },
    {
      label: 'invalid-protocol',
      error: Object.assign(new Error('签到数据格式不正确'), { reason: 'invalid_response' })
    },
    { label: 'stale', error: Object.assign(new Error('旧请求'), { reason: 'stale' }) },
    { label: 'canceled', error: Object.assign(new Error('请求已取消'), { reason: 'canceled' }) }
  ])('does not retry a blocked reward read ($label)', async ({ error }) => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    const readAttendance = jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockResolvedValueOnce(attendanceBoard())
      .mockRejectedValue(error);
    const { hook } = await renderController({ readAttendance });
    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(readAttendance).toHaveBeenCalledTimes(2);
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toEqual({ kind: 'confirmed-pending' });
  });

  it.each(['owner-change', 'unmount'])('stops retrying a reward read during backoff after %s', async (change) => {
    jest.useFakeTimers();
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    let current = true;
    const readAttendance = jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockResolvedValueOnce(attendanceBoard())
      .mockRejectedValue(new Error('Network request failed'));
    const options = {
      current: () => current,
      currentSessionTicket: ticket as WritableSessionTicket | null,
      readAttendance
    };
    const { hook, notify } = await renderController(options);
    let pending!: Promise<void>;
    await act(async () => {
      pending = hook.result.current.checkIn();
    });
    expect(readAttendance).toHaveBeenCalledTimes(2);
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      await hook.result.current.checkIn(true);
      if (change === 'unmount') await hook.unmount();
      else {
        current = false;
        options.currentSessionTicket = null;
        await hook.rerender(undefined);
      }
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
      await pending;
    });

    expect(readAttendance).toHaveBeenCalledTimes(2);
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('blocks both modes after three failed reward reads without submitting again', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true, current: 50 });
    const readAttendance = jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockResolvedValueOnce(attendanceBoard())
      .mockRejectedValue(new Error('Network request failed'));
    const { hook, ensureWritableSession, notify } = await renderController({ readAttendance });

    await act(async () => {
      await hook.result.current.checkIn();
    });
    expect(hook.result.current.state).toEqual({ kind: 'confirmed-pending' });
    expect(notify).toHaveBeenCalledWith('签到成功，收益暂时无法读取');
    await act(async () => {
      await hook.result.current.checkIn(true);
      await hook.result.current.checkIn(false);
    });
    expect(hook.result.current.state).toEqual({ kind: 'confirmed-pending' });
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
    expect(readAttendance).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])('reconciles a possibly sent network failure by reading only (signed=%s)', async (signed) => {
    mockRunNodeSeekAction.mockImplementation(
      jest.requireActual<typeof import('@/sources/nodeseek/actionClient')>('@/sources/nodeseek/actionClient')
        .runNodeSeekAction
    );
    const fetcher = jest.fn<typeof fetch>(async (_input, init) => {
      prepareRequestToSend(init);
      throw new Error('响应丢失');
    });
    const readAttendance = jest
      .fn<() => Promise<NodeSeekAttendanceBoard>>()
      .mockResolvedValueOnce(attendanceBoard())
      .mockResolvedValue(attendanceBoard(signed));
    const { hook, ensureWritableSession, onConfirmed, onSessionExpired } = await renderController({
      fetcher,
      readAttendance
    });

    await act(async () => {
      await hook.result.current.checkIn(true);
    });
    expect(hook.result.current.state.kind).toBe(signed ? 'signed' : 'result-unknown');
    await act(async () => {
      await hook.result.current.checkIn(false);
      await hook.result.current.refresh(ticket);
      await hook.result.current.checkIn(true);
    });

    expect(hook.result.current.state.kind).toBe(signed ? 'signed' : 'result-unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(readAttendance).toHaveBeenCalledTimes(signed ? 3 : 5);
    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not treat a response without explicit success as a confirmed reward', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ current: 50, message: '签到成功' });
    const readAttendance = jest.fn(async () => attendanceBoard());
    const { hook, onConfirmed } = await renderController({ readAttendance });

    await act(async () => {
      await hook.result.current.checkIn();
      await hook.result.current.checkIn(true);
    });

    expect(hook.result.current.state).toEqual({ kind: 'result-unknown' });
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(readAttendance).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])('does not commit unchanged cached attendance again (signed=%s)', async (signed) => {
    const { hook, onCommit, readAttendance } = await renderController();
    const board = attendanceBoard(signed);
    onCommit.mockClear();
    await act(async () => hook.result.current.observeBoard(board, ticket));
    expect(onCommit).toHaveBeenCalledTimes(1);
    onCommit.mockClear();

    await act(async () => hook.result.current.observeBoard(board, { ...ticket }));
    await act(async () => hook.result.current.observeBoard(attendanceBoard(signed), { ...ticket }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(readAttendance).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
  });

  it.each(['gain', 'day', 'record-id', 'created-at', 'order'] as const)(
    'commits changed attendance content (%s)',
    async (change) => {
      const { hook, onCommit } = await renderController();
      await act(async () => hook.result.current.observeBoard(attendanceBoard(true), ticket));
      onCommit.mockClear();
      const board = attendanceBoard(true, change === 'day' ? 121 : 120);
      if (!board.record) throw new Error('Signed attendance fixture requires a record');
      if (change === 'gain') board.record.gain = 9;
      if (change === 'record-id') board.record.id = '102';
      if (change === 'created-at') board.record.createdAt = '2026-10-01T13:00:00.000Z';
      if (change === 'order') board.order = 9;

      await act(async () => hook.result.current.observeBoard(board, { ...ticket }));

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(hook.result.current.state).toEqual({ kind: 'signed', record: board.record, order: board.order });
    }
  );

  it('commits a changed server day even when observed attendance stays idle', async () => {
    const { hook, onCommit } = await renderController();
    await act(async () => hook.result.current.observeBoard(attendanceBoard(), ticket));
    onCommit.mockClear();

    await act(async () => hook.result.current.observeBoard(attendanceBoard(false, 121), ticket));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toEqual({ kind: 'idle' });
    onCommit.mockClear();
    await act(async () => hook.result.current.observeBoard(attendanceBoard(false, 121), { ...ticket }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each(['identity', 'epoch'] as const)('commits attendance again for a changed owner (%s)', async (change) => {
    let currentTicket = ticket;
    const options = {
      currentSessionTicket: ticket,
      current: (candidate: WritableSessionTicket) =>
        candidate.identityKey === currentTicket.identityKey && candidate.sessionEpoch === currentTicket.sessionEpoch
    };
    const { hook, onCommit } = await renderController(options);
    await act(async () => hook.result.current.observeBoard(attendanceBoard(true), ticket));
    currentTicket = {
      ...ticket,
      identityKey: change === 'identity' ? 'nodeseek:8' : ticket.identityKey,
      sessionEpoch: change === 'epoch' ? ticket.sessionEpoch + 1 : ticket.sessionEpoch
    };
    options.currentSessionTicket = currentTicket;
    await act(async () => hook.rerender(undefined));
    expect(hook.result.current.state).toEqual({ kind: 'idle' });
    onCommit.mockClear();
    const board = attendanceBoardForUser(change === 'identity' ? '8' : '7', true);

    await act(async () => hook.result.current.observeBoard(board, currentTicket));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toEqual({ kind: 'signed', record: board.record, order: board.order });
  });

  it('updates observed signed records and accepts an unsigned record after a signed day', async () => {
    const { hook, ensureWritableSession, readAttendance } = await renderController();

    await act(async () => {
      hook.result.current.observeBoard(attendanceBoard(true), ticket);
    });
    expect(hook.result.current.state.kind).toBe('signed');
    await act(async () => {
      hook.result.current.observeBoard(attendanceBoard(), ticket);
    });

    expect(hook.result.current.state).toEqual({ kind: 'idle' });
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(ensureWritableSession).not.toHaveBeenCalled();
    expect(readAttendance).not.toHaveBeenCalled();
  });

  it('keeps an unknown result locked on an observed unsigned board and unlocks only for a signed record', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ message: '结果未知' });
    const readAttendance = jest.fn(async () => attendanceBoard());
    const { hook } = await renderController({ readAttendance });

    await act(async () => {
      await hook.result.current.checkIn();
      hook.result.current.observeBoard(attendanceBoard(), ticket);
      await hook.result.current.checkIn(true);
    });
    expect(hook.result.current.state).toEqual({ kind: 'result-unknown' });
    await act(async () => {
      hook.result.current.observeBoard(attendanceBoard(true), ticket);
    });

    expect(hook.result.current.state.kind).toBe('signed');
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
  });

  it('hides an old owner reward after the session epoch changes and ignores a mismatched board', async () => {
    let epoch = ticket.sessionEpoch;
    const options = {
      current: () => epoch === ticket.sessionEpoch,
      currentSessionTicket: ticket
    };
    const { hook } = await renderController(options);
    await act(async () => {
      hook.result.current.observeBoard({ ...attendanceBoard(true), userId: '8' }, ticket);
    });
    expect(hook.result.current.state).toEqual({ kind: 'idle' });
    await act(async () => {
      hook.result.current.observeBoard(attendanceBoard(true), ticket);
    });
    expect(hook.result.current.state.kind).toBe('signed');
    epoch++;
    options.currentSessionTicket = { ...ticket, sessionEpoch: epoch };
    await act(async () => {
      await hook.rerender(undefined);
    });

    expect(hook.result.current.state).toEqual({ kind: 'idle' });
  });

  it('stops before the attendance action when the owner changes during preflight', async () => {
    let current = true;
    const readAttendance = jest.fn(async () => {
      current = false;
      return attendanceBoard();
    });
    const { hook, notify } = await renderController({ current: () => current, readAttendance });

    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(hook.result.current.state).toEqual({ kind: 'idle' });
  });

  it('records a late confirmed attendance as stale', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    let current = true;
    mockRunNodeSeekAction.mockImplementationOnce(async () => {
      current = false;
      return { success: true };
    });
    const notify = jest.fn();
    const { hook } = await renderController({ current: () => current, notify });

    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(notify).not.toHaveBeenCalled();
    const finishes = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'session' && event.operation === 'attendance' && event.phase === 'finish');
    expect(finishes).toEqual([expect.objectContaining({ outcome: 'stale', reason: 'stale', serverConfirmed: true })]);
  });

  it.each([false, true])(
    'unlocks a pending result only after a proven new server day (confirmed=%s)',
    async (confirmed) => {
      mockRunNodeSeekAction.mockResolvedValue({ success: confirmed || undefined });
      const readAttendance = jest
        .fn<() => Promise<NodeSeekAttendanceBoard>>()
        .mockResolvedValueOnce(attendanceBoard())
        .mockResolvedValueOnce(attendanceBoard())
        .mockResolvedValueOnce(attendanceBoard())
        .mockResolvedValueOnce(attendanceBoard())
        .mockResolvedValueOnce(attendanceBoard(false, 121))
        .mockResolvedValueOnce(attendanceBoard(true, 121));
      const { hook } = await renderController({ readAttendance });
      await act(async () => {
        await hook.result.current.checkIn();
        hook.result.current.observeBoard({ ...attendanceBoard(false, 121), list: [] }, ticket);
        hook.result.current.observeBoard(
          {
            ...attendanceBoard(false, 121),
            list: [...attendanceBoard(false, 121).list, ...attendanceBoard(false, 120).list]
          },
          ticket
        );
        hook.result.current.observeBoard(attendanceBoard(false, 120), ticket);
      });
      expect(hook.result.current.state.kind).toBe(confirmed ? 'confirmed-pending' : 'result-unknown');
      await act(async () => {
        hook.result.current.observeBoard(attendanceBoard(false, 121), ticket);
      });
      expect(hook.result.current.state).toEqual({ kind: 'idle' });
      expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
      await act(async () => {
        await hook.result.current.checkIn(true);
      });
      expect(hook.result.current.state.kind).toBe('signed');
      expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(2);
      expect(readAttendance).toHaveBeenCalledTimes(6);
    }
  );

  it.each([
    { signed: false, status: 200 },
    { signed: true, status: 200 },
    { signed: false, status: 503 }
  ])(
    'reads back an explicit server refusal before a safe manual retry (HTTP $status, signed=$signed)',
    async ({ signed, status }) => {
      mockRunNodeSeekAction.mockImplementation(
        jest.requireActual<typeof import('@/sources/nodeseek/actionClient')>('@/sources/nodeseek/actionClient')
          .runNodeSeekAction
      );
      const fetcher = jest
        .fn<typeof fetch>()
        .mockImplementationOnce(async (_input, init) => {
          prepareRequestToSend(init);
          return new Response('{"success":false,"message":"签到被拒绝"}', { status });
        })
        .mockImplementationOnce(async (_input, init) => {
          prepareRequestToSend(init);
          return new Response('{"success":true}');
        });
      const readAttendance = jest
        .fn<() => Promise<NodeSeekAttendanceBoard>>()
        .mockResolvedValueOnce(attendanceBoard())
        .mockResolvedValueOnce(attendanceBoard(signed))
        .mockResolvedValueOnce(attendanceBoard())
        .mockResolvedValueOnce(attendanceBoard(true));
      const { hook } = await renderController({ fetcher, readAttendance });
      await act(async () => {
        await hook.result.current.checkIn();
      });
      expect(hook.result.current.state.kind).toBe(signed ? 'signed' : 'idle');
      await act(async () => {
        await hook.result.current.checkIn(true);
      });
      expect(hook.result.current.state.kind).toBe('signed');
      expect(fetcher).toHaveBeenCalledTimes(signed ? 1 : 2);
      expect(readAttendance).toHaveBeenCalledTimes(signed ? 2 : 4);
    }
  );

  it.each([408, 409])('keeps an ambiguous HTTP %s attendance result locked after dispatch', async (status) => {
    mockRunNodeSeekAction.mockImplementation(
      jest.requireActual<typeof import('@/sources/nodeseek/actionClient')>('@/sources/nodeseek/actionClient')
        .runNodeSeekAction
    );
    const fetcher = jest.fn<typeof fetch>(async (_input, init) => {
      prepareRequestToSend(init);
      return new Response('{}', { status });
    });
    const readAttendance = jest.fn(async () => attendanceBoard());
    const { hook } = await renderController({ fetcher, readAttendance });
    await act(async () => {
      await hook.result.current.checkIn();
      await hook.result.current.checkIn(true);
    });
    expect(hook.result.current.state).toEqual({ kind: 'result-unknown' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readAttendance).toHaveBeenCalledTimes(4);
  });

  it('allows a new owner to submit while the old owner transport remains pending', async () => {
    const nextTicket = { ...ticket, identityKey: 'nodeseek:8', sessionEpoch: 4 };
    let activeTicket = ticket;
    const firstTransport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction
      .mockImplementationOnce(async () => firstTransport.promise)
      .mockResolvedValueOnce({ success: true });
    const options = {
      currentSessionTicket: ticket,
      current: (candidate: WritableSessionTicket) =>
        candidate.identityKey === activeTicket.identityKey && candidate.sessionEpoch === activeTicket.sessionEpoch,
      ensureWritableSession: jest.fn(async () => activeTicket),
      readAttendance: jest
        .fn<(candidate: WritableSessionTicket) => Promise<NodeSeekAttendanceBoard>>()
        .mockResolvedValueOnce(attendanceBoard())
        .mockResolvedValueOnce(attendanceBoardForUser('8'))
        .mockResolvedValueOnce(attendanceBoardForUser('8', true))
    };
    const { hook, notify } = await renderController(options);
    let first!: Promise<void>;
    await act(async () => {
      first = hook.result.current.checkIn();
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));
    activeTicket = nextTicket;
    options.currentSessionTicket = nextTicket;
    await act(async () => {
      await hook.rerender(undefined);
    });
    expect(hook.result.current.busy).toBe(false);
    await act(async () => {
      await hook.result.current.checkIn(true);
    });
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(2);
    expect(hook.result.current.state.kind).toBe('signed');
    await act(async () => {
      firstTransport.resolve({ success: true });
      await first;
    });
    expect(hook.result.current.state.kind).toBe('signed');
    expect(hook.result.current.busy).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale session preparation release the new owner lock', async () => {
    const nextTicket = { ...ticket, identityKey: 'nodeseek:8', sessionEpoch: 4 };
    let activeTicket = ticket;
    const firstSession = Promise.withResolvers<WritableSessionTicket>();
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const options = {
      currentSessionTicket: ticket,
      current: (candidate: WritableSessionTicket) =>
        candidate.identityKey === activeTicket.identityKey && candidate.sessionEpoch === activeTicket.sessionEpoch,
      ensureWritableSession: jest
        .fn<() => Promise<WritableSessionTicket>>()
        .mockReturnValueOnce(firstSession.promise)
        .mockResolvedValue(nextTicket),
      readAttendance: jest
        .fn<() => Promise<NodeSeekAttendanceBoard>>()
        .mockResolvedValueOnce(attendanceBoardForUser('8'))
        .mockResolvedValueOnce(attendanceBoardForUser('8', true))
    };
    const { hook } = await renderController(options);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = hook.result.current.checkIn();
    });
    activeTicket = nextTicket;
    options.currentSessionTicket = nextTicket;
    await act(async () => {
      await hook.rerender(undefined);
      second = hook.result.current.checkIn(true);
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));
    await act(async () => {
      firstSession.resolve(ticket);
      await first;
    });
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      await hook.result.current.checkIn(false);
      transport.resolve({ success: true });
      await second;
    });
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(options.ensureWritableSession).toHaveBeenCalledTimes(2);
    expect(hook.result.current.busy).toBe(false);
  });

  it('expires attendance once on raw HTTP 401 without replaying it', async () => {
    const fetcher = jest.fn(async () => new Response('<html>login</html>', { status: 401 }));
    mockRunNodeSeekAction.mockImplementationOnce(async ({ fetcher: request }) => {
      await request!('https://www.nodeseek.com/api/attendance');
      return { success: true };
    });
    const onSessionExpired = jest.fn();
    const { hook } = await renderController({ fetcher, onSessionExpired });

    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledWith('nodeseek', ticket.sessionEpoch);
  });

  it('expires only the preflight owner on raw HTTP 401 without submitting attendance', async () => {
    const unauthorized = Object.assign(new Error('登录状态已失效'), { status: 401, reason: 'http-401' });
    const readAttendance = jest.fn<() => Promise<NodeSeekAttendanceBoard>>().mockRejectedValue(unauthorized);
    const { hook, onSessionExpired } = await renderController({ readAttendance });

    await act(async () => {
      await hook.result.current.checkIn(true);
    });

    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledWith('nodeseek', ticket.sessionEpoch);
  });

  it.each([
    ['ordinary', new Error('签到网络失败')],
    ['permission-denied', Object.assign(new Error('当前账号不能签到'), { status: 403 })]
  ])('leaves identity unchanged for %s attendance failure', async (_kind, error) => {
    mockRunNodeSeekAction.mockRejectedValueOnce(error);
    const notify = jest.fn();
    const { hook, onSessionExpired } = await renderController({ notify });

    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(error.message);
  });
});
