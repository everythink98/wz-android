import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/sources/nodeseek/actionClient', () => ({
  runNodeSeekAction: jest.fn()
}));

import { runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { useNodeSeekCheckInController } from '@/features/account/useNodeSeekCheckInController';
import { appQueryClient } from '@/platform/query/serverState';
import { setDiagnosticWriter, type DiagnosticEvent } from '@/platform/diagnostics/diagnostics';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';

const mockRunNodeSeekAction = jest.mocked(runNodeSeekAction);
const ticket: WritableSessionTicket = {
  source: 'nodeseek',
  identityKey: 'nodeseek:alice',
  sessionEpoch: 3
};

async function renderController(
  options: {
    current?: () => boolean;
    notify?: (message: string) => void;
    reconcile?: () => Promise<{ status: 'unknown' }>;
  } = {}
) {
  const notify = options.notify || jest.fn();
  const reconcileWritableSession = jest.fn(options.reconcile || (async () => ({ status: 'unknown' as const })));
  const hook = await renderHook(
    () =>
      useNodeSeekCheckInController({
        ensureWritableSession: async () => ticket,
        fetcher: fetch,
        isWritableSessionTicketCurrent: options.current || (() => true),
        nodeSeekUserAgentRef: { current: 'WZ Test' },
        notify,
        reconcileWritableSession
      }),
    {
      wrapper: ({ children }) => <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
    }
  );
  return { hook, notify, reconcileWritableSession };
}

describe('NodeSeek account check-in controller', () => {
  beforeEach(() => {
    appQueryClient.clear();
    mockRunNodeSeekAction.mockReset();
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('serializes the global attendance mutation without a handwritten queue', async () => {
    const firstTransport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction
      .mockImplementationOnce(async () => firstTransport.promise)
      .mockResolvedValueOnce({ success: true });
    const { hook } = await renderController();
    let first!: Promise<void>;
    let second!: Promise<void>;

    await act(async () => {
      first = hook.result.current.checkIn();
      second = hook.result.current.checkIn();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));
    await act(async () => {
      firstTransport.resolve({ success: true });
      await first;
      await second;
    });

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(2);
  });

  it('[REG-WRITE-015] keeps the fixed NodeSeek global mutation identity outside Topic', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    const { hook } = await renderController();

    await act(async () => {
      await hook.result.current.checkIn();
    });

    const attendance = appQueryClient.getMutationCache().getAll().at(-1);
    expect(attendance?.options.mutationKey).toEqual(['forum', 'nodeseek', 'mutation', 'topic', 'global']);
    expect(attendance?.options.scope).toEqual({ id: 'forum:nodeseek:topic:global' });
  });

  it('[REG-WRITE-023] records a late confirmed attendance as stale', async () => {
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

  it.each([
    ['ordinary', new Error('签到网络失败')],
    ['permission-denied', Object.assign(new Error('当前账号不能签到'), { status: 403 })]
  ])('[REG-WRITE-024] leaves identity unchanged for %s attendance failure', async (_kind, error) => {
    mockRunNodeSeekAction.mockRejectedValueOnce(error);
    const notify = jest.fn();
    const { hook, reconcileWritableSession } = await renderController({ notify });

    await act(async () => {
      await hook.result.current.checkIn();
    });

    expect(reconcileWritableSession).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(error.message);
  });
});
