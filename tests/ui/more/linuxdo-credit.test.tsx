import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createAppQueryClient } from '@/platform/query/serverState';
import { LinuxDoCreditError, type LinuxDoCreditEntry } from '@/domain/forum/linuxDoCredit';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { useLinuxDoCredit, type LinuxDoCreditGateway } from '@/features/more/useLinuxDoCredit';

const clients: ReturnType<typeof createAppQueryClient>[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});
const account = { userId: '7', username: 'alice', availableBalance: '10.25', pendingBalance: '0.00' };
function entry(id: string): LinuxDoCreditEntry {
  return {
    id,
    title: `记录 ${id}`,
    amount: '1.25',
    direction: 'expense',
    status: 'success',
    type: 'payment',
    createdAt: '2026-10-22T08:00:00Z',
    counterparty: 'store',
    settlementPending: false
  };
}
async function setup(transactions = true, active = true) {
  const client = createAppQueryClient();
  clients.push(client);
  const getAccount = jest.fn<LinuxDoCreditGateway['getLinuxDoCreditAccount']>(async () => account);
  const connectSilently = jest.fn<() => void | Promise<void>>();
  const getTransactions = jest.fn<LinuxDoCreditGateway['getLinuxDoCreditTransactions']>(async ({ page }) => ({
    userId: '7',
    entries: [entry(String(page))],
    page,
    total: 2,
    nextPage: page === 1 ? 2 : null
  }));
  const gateway: LinuxDoCreditGateway = {
    getReadPlan: () => ({
      state: 'ready',
      lane: 'authenticated',
      transport: 'managed-session',
      cacheScope: 'authenticated:0'
    }),
    getLinuxDoCreditAccount: getAccount,
    getLinuxDoCreditTransactions: getTransactions
  };
  const hook = await renderHook(
    ({
      active,
      userId,
      sessionEpoch,
      connecting = false
    }: {
      active: boolean;
      userId: string;
      sessionEpoch: number;
      connecting?: boolean;
    }) =>
      useLinuxDoCredit({
        active,
        gateway,
        userId,
        username: userId,
        sessionEpoch,
        transactions,
        connectSilently,
        connecting
      }),
    {
      initialProps: { active, userId: 'alice', sessionEpoch: 0 },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    }
  );
  return { ...hook, client, gateway, getAccount, getTransactions, connectSilently };
}

describe('LDC account and transaction ownership', () => {
  it('loads only the balance in the profile and sends nothing while inactive', async () => {
    const hook = await setup(false, false);
    expect(hook.getAccount).not.toHaveBeenCalled();
    await hook.rerender({ active: true, userId: 'alice', sessionEpoch: 0 });
    await waitFor(() => expect(hook.result.current.account?.availableBalance).toBe('10.25'));
    expect(hook.getTransactions).not.toHaveBeenCalled();
  });

  it('paginates explicitly and refreshes from the first page without keeping an old tail', async () => {
    const hook = await setup();
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1));
    expect(hook.getTransactions).toHaveBeenCalledTimes(1);
    await act(async () => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(2));
    expect(hook.result.current.hasMore).toBe(false);
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1));
    expect(hook.getTransactions.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 1]);
  });

  it('hides cached balance and records when a refresh discovers another Credit owner', async () => {
    const hook = await setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    hook.getAccount.mockRejectedValue(new LinuxDoCreditError('identity-mismatch', '账号不一致'));
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.account).toBeUndefined());
    expect(hook.result.current.entries).toEqual([]);
    expect(hook.result.current.hasMore).toBe(false);
    expect(hook.getTransactions).toHaveBeenCalledTimes(1);
  });

  it('does not retain another forum account data across owner and epoch changes', async () => {
    const hook = await setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    hook.getAccount.mockImplementation(() => new Promise(() => undefined));
    await hook.rerender({ active: true, userId: 'bob', sessionEpoch: 1 });
    expect(hook.result.current.account).toBeUndefined();
    expect(hook.result.current.entries).toEqual([]);
    expect(hook.getTransactions).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight read when leaving the owning screen', async () => {
    const hook = await setup(false, false);
    let signal: AbortSignal | undefined;
    hook.getAccount.mockImplementation((request) => {
      signal = request.signal;
      return new Promise(() => undefined);
    });
    await hook.rerender({ active: true, userId: 'alice', sessionEpoch: 0 });
    await waitFor(() => expect(signal).toBeDefined());
    await hook.rerender({ active: false, userId: 'alice', sessionEpoch: 0 });
    await waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it.each<LinuxDoCreditError['kind']>(['authorization-required', 'verification-required'])(
    'settles a %s read before requesting silent connection and keeps that command outside query cancellation',
    async (kind) => {
      const hook = await setup(false, false);
      const error = new LinuxDoCreditError(kind, '请恢复 LDC 会话');
      hook.getAccount.mockRejectedValue(error);
      hook.connectSilently.mockImplementation(() => new Promise(() => undefined));
      await hook.rerender({ active: true, userId: 'alice', sessionEpoch: 0 });
      await waitFor(() => expect(hook.connectSilently).toHaveBeenCalledTimes(1));
      expect(hook.result.current.busy).toBe(false);
      expect(hook.result.current.error).toBe(error);
      expect(hook.getAccount).toHaveBeenCalledTimes(1);

      await hook.rerender({ active: false, userId: 'alice', sessionEpoch: 0, connecting: true });
      expect(hook.result.current.busy).toBe(true);
      expect(hook.result.current.error).toBeNull();
      expect(hook.connectSilently).toHaveBeenCalledTimes(1);
      await hook.rerender({ active: false, userId: 'alice', sessionEpoch: 0 });
      expect(hook.result.current.error).toBe(error);
      expect(hook.connectSilently).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    new LinuxDoCreditError('identity-mismatch', '账号不一致'),
    new LinuxDoCloudflareError(),
    new Error('网络连接失败')
  ])('leaves other failures for their explicit recovery action: %s', async (error) => {
    const hook = await setup(false, false);
    hook.getAccount.mockRejectedValue(error);
    await hook.rerender({ active: true, userId: 'alice', sessionEpoch: 0 });
    await waitFor(() => expect(hook.result.current.error).toBe(error));
    expect(hook.connectSilently).not.toHaveBeenCalled();
    await hook.rerender({ active: true, userId: 'alice', sessionEpoch: 0, connecting: true });
    expect(hook.result.current.error).toBe(error);
    expect(hook.connectSilently).not.toHaveBeenCalled();
  });
});
