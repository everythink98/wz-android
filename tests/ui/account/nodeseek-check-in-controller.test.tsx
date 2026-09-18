import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

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

const mockLoadProxy = jest.fn<() => Promise<NetworkProxyState>>();
jest.mock('@/platform/network/networkProxy', () => ({
  ...jest.requireActual<typeof import('@/platform/network/networkProxy')>('@/platform/network/networkProxy'),
  loadNetworkProxyState: () => mockLoadProxy(),
  applyNetworkProxy: async () => ({ ok: true })
}));

const mockRunNodeSeekAction = jest.mocked(runNodeSeekAction);
const ticket: WritableSessionTicket = {
  source: 'nodeseek',
  identityKey: 'nodeseek:alice',
  sessionEpoch: 3
};

async function renderController(
  options: {
    current?: () => boolean;
    fetcher?: typeof fetch;
    notify?: (message: string) => void;
    onSessionExpired?: (source: 'nodeseek', requestSessionEpoch: number) => void;
  } = {}
) {
  const notify = options.notify || jest.fn();
  const onSessionExpired = options.onSessionExpired || jest.fn();
  const hook = await renderHook(
    () =>
      useNodeSeekCheckInController({
        ensureWritableSession: async () => ticket,
        fetcher: options.fetcher || fetch,
        isWritableSessionTicketCurrent: options.current || (() => true),
        nodeSeekUserAgentRef: { current: 'WZ Test' },
        notify,
        onSessionExpired
      }),
    {
      wrapper: ({ children }) => <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
    }
  );
  return { hook, notify, onSessionExpired };
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

  it('keeps the fixed NodeSeek global mutation identity outside Topic', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    const { hook } = await renderController();

    await act(async () => {
      await hook.result.current.checkIn();
    });

    const attendance = appQueryClient.getMutationCache().getAll().at(-1);
    expect(attendance?.options.mutationKey).toEqual(['forum', 'nodeseek', 'mutation', 'topic', 'global']);
    expect(attendance?.options.scope).toEqual({ id: 'forum:nodeseek:topic:global' });
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
