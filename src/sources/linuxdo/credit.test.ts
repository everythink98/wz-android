import { describe, expect, it, vi } from 'vitest';
import { LinuxDoCreditError } from '@/domain/forum/linuxDoCredit';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { RequestCanceledError, type Fetcher } from '@/platform/network/request';
import { getLinuxDoCreditAccount, getLinuxDoCreditTransactions } from './credit';

const account = {
  id: '42',
  username: 'alice',
  available_balance: '9007199254740993.01',
  pending_balance: '0.10'
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ error_msg: '', data }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function fetchCredit(response: Response | Error, forumUser: Record<string, unknown> = { id: 42, username: 'alice' }) {
  return vi.fn<Fetcher>().mockImplementation(async (url) => {
    if (url === 'https://linux.do/session/current.json') return Response.json({ current_user: forumUser });
    if (response instanceof Error) throw response;
    return response.clone();
  });
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: '123456789012345678',
    order_name: '服务订单',
    payer_user_id: '42',
    payee_user_id: '99',
    payer_username: 'alice',
    payee_username: 'bob',
    amount: '10.25',
    type: 'payment',
    status: 'success',
    created_at: '2026-10-22T12:00:00+08:00',
    payee_transfer_status: 'completed',
    ...overrides
  };
}

function fetchTransactions(orders: unknown[], { page = 1, total = orders.length } = {}) {
  return vi.fn<Fetcher>().mockImplementation(async (url) => {
    if (url === 'https://linux.do/session/current.json')
      return Response.json({ current_user: { id: 42, username: 'alice' } });
    if (url.endsWith('/oauth/user-info')) return json(account);
    return json({ page, page_size: 20, total, orders });
  });
}

describe('LDC account and transaction reads', () => {
  it('rejects a reused username whose forum ID differs from the Credit session', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockImplementation(async (url) =>
        url === 'https://linux.do/session/current.json'
          ? Response.json({ current_user: { id: 99, username: 'alice' } })
          : json(account)
      );
    await expect(getLinuxDoCreditAccount({ userId: 'alice', username: 'alice', fetcher })).rejects.toMatchObject({
      kind: 'identity-mismatch'
    });
  });

  it('stops at the forum boundary when the logged-in owner has changed', async () => {
    const fetcher = fetchCredit(json(account), { id: 99, username: 'bob' });
    await expect(getLinuxDoCreditAccount({ userId: 'alice', username: 'alice', fetcher })).rejects.toMatchObject({
      kind: 'identity-mismatch'
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://linux.do/session/current.json']);
  });

  it.each([42, '42'])('accepts a precise forum user ID represented as %j', async (id) => {
    const fetcher = fetchCredit(json(account), { id, username: 'alice' });
    await expect(getLinuxDoCreditAccount({ userId: 'alice', username: 'alice', fetcher })).resolves.toMatchObject({
      userId: '42'
    });
  });

  it.each([undefined, null, 42.5, Number.MAX_SAFE_INTEGER + 1, '042', '4e1'])(
    'refuses an invalid forum user ID before accessing Credit: %s',
    async (id) => {
      const fetcher = fetchCredit(json(account), { id, username: 'alice' });
      await expect(getLinuxDoCreditAccount({ userId: 'alice', username: 'alice', fetcher })).rejects.toMatchObject({
        kind: 'unavailable'
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('preserves main-forum authorization and challenge failures for their own recovery flow', async () => {
    const expired = Object.assign(new Error('expired'), { source: 'linuxdo', status: 401, reason: 'http-401' });
    const managed401 = vi.fn<Fetcher>().mockRejectedValue(expired);
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher: managed401 })).rejects.toBe(expired);
    expect(managed401).toHaveBeenCalledTimes(1);
    const raw401 = vi.fn<Fetcher>().mockResolvedValue(new Response('', { status: 401 }));
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher: raw401 })).rejects.toMatchObject({
      source: 'linuxdo',
      status: 401
    });
    const rawChallenge = vi
      .fn<Fetcher>()
      .mockResolvedValue(
        new Response('<title>Just a moment</title>', { status: 403, headers: { 'Content-Type': 'text/html' } })
      );
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher: rawChallenge })).rejects.toBeInstanceOf(
      LinuxDoCloudflareError
    );
    const managedChallenge = new LinuxDoCloudflareError();
    const managed = vi.fn<Fetcher>().mockRejectedValue(managedChallenge);
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher: managed })).rejects.toBe(managedChallenge);
  });

  it('preserves decimal balances and verifies the forum ID before reading Credit with the supplied user agent', async () => {
    const fetcher = fetchCredit(json(account));
    await expect(
      getLinuxDoCreditAccount({ userId: '42', username: 'alice', userAgent: 'webview-test', fetcher })
    ).resolves.toEqual({
      userId: '42',
      username: 'alice',
      availableBalance: '9007199254740993.01',
      pendingBalance: '0.10'
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://credit.linux.do/api/v1/oauth/user-info',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'webview-test'
        }
      })
    );
  });

  it('accepts the current username-based forum identity only when the explicit username matches', async () => {
    const fetcher = fetchCredit(json(account));
    await expect(getLinuxDoCreditAccount({ userId: 'alice', username: 'alice', fetcher })).resolves.toMatchObject({
      userId: '42'
    });
    await expect(getLinuxDoCreditAccount({ userId: 'alice', fetcher })).rejects.toMatchObject({
      kind: 'identity-mismatch'
    });
    const numericUsername = fetchCredit(json({ ...account, username: '12345' }), { id: 42, username: '12345' });
    await expect(
      getLinuxDoCreditAccount({ userId: '12345', username: '12345', fetcher: numericUsername })
    ).resolves.toMatchObject({ userId: '42', username: '12345' });
  });

  it.each([
    { id: '99', username: 'alice' },
    { id: '42', username: 'bob' },
    { id: '-42', username: 'alice' }
  ])('blocks a different account before reading transactions: %j', async (identity) => {
    const fetcher = fetchCredit(json({ ...account, ...identity }));
    await expect(
      getLinuxDoCreditTransactions({ userId: '42', username: 'alice', page: 1, fetcher })
    ).rejects.toMatchObject({ kind: 'identity-mismatch' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps Credit authorization errors separate from forum session failures', async () => {
    const fetcher = fetchCredit(json(null, 401));
    const result = getLinuxDoCreditAccount({ userId: '42', fetcher });
    await expect(result).rejects.toBeInstanceOf(LinuxDoCreditError);
    await expect(result).rejects.toMatchObject({ kind: 'authorization-required' });
    await expect(result).rejects.not.toHaveProperty('reason');
  });

  it('distinguishes Cloudflare verification from ordinary forbidden responses', async () => {
    const challenge = fetchCredit(
      new Response('<title>Just a moment</title>', { status: 403, headers: { 'Content-Type': 'text/html' } })
    );
    const forbidden = fetchCredit(
      new Response(JSON.stringify({ error_msg: '账号存在风险', error_code: 'RISK_BLOCKED' }), { status: 403 })
    );
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher: challenge })).rejects.toMatchObject({
      kind: 'verification-required'
    });
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher: forbidden })).rejects.toMatchObject({
      kind: 'unavailable'
    });
    const managedChallenge = fetchCredit(new LinuxDoCloudflareError());
    const result = getLinuxDoCreditAccount({ userId: '42', fetcher: managedChallenge });
    await expect(result).rejects.toMatchObject({ kind: 'verification-required' });
    await expect(result).rejects.not.toHaveProperty('reason');
  });

  it.each([undefined, null, 1.23, 'NaN', '1.001', '1e3', '01.50', '1000000000000000000.00'])(
    'rejects an invalid balance without inventing zero: %s',
    async (available_balance) => {
      const fetcher = fetchCredit(json({ ...account, available_balance }));
      await expect(getLinuxDoCreditAccount({ userId: '42', fetcher })).rejects.toMatchObject({ kind: 'unavailable' });
    }
  );

  it.each([
    { data: account },
    { error_msg: 'upstream failure', data: account },
    { error_msg: '', data: { ...account, id: 42 } },
    { error_msg: '', data: null }
  ])('rejects malformed success envelopes: %j', async (envelope) => {
    const fetcher = fetchCredit(new Response(JSON.stringify(envelope)));
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('checks account identity on each page and follows the server total', async () => {
    const fetcher = fetchTransactions([order()], { page: 2, total: 41 });
    await expect(getLinuxDoCreditTransactions({ userId: '42', fetcher, page: 2 })).resolves.toMatchObject({
      userId: '42',
      page: 2,
      total: 41,
      nextPage: 3,
      entries: [{ id: '123456789012345678', amount: '10.25', direction: 'expense', counterparty: 'bob' }]
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://linux.do/session/current.json',
      'https://credit.linux.do/api/v1/oauth/user-info',
      'https://credit.linux.do/api/v1/order/transactions'
    ]);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ page: 2, page_size: 20 })
    });
    const empty = fetchTransactions([]);
    await expect(getLinuxDoCreditTransactions({ userId: '42', fetcher: empty, page: 1 })).resolves.toMatchObject({
      entries: [],
      total: 0,
      nextPage: null
    });
  });

  it.each([
    { type: 'receive', payee_user_id: '42', payer_user_id: '99', expected: 'income' },
    { type: 'community', payee_user_id: '42', payer_user_id: '0', amount: '-2.01', expected: 'expense' },
    { type: 'community', payee_user_id: '42', payer_user_id: '0', amount: '0', expected: 'neutral' },
    { type: 'online', payee_user_id: '42', payer_user_id: '99', expected: 'income' },
    { type: 'distribute', payee_user_id: '42', payer_user_id: '99', expected: 'income' },
    { type: 'transfer', expected: 'expense' },
    { type: 'red_envelope_receive', payee_user_id: '42', payer_user_id: '99', expected: 'income' },
    { type: 'red_envelope_refund', payee_user_id: '42', payer_user_id: '0', expected: 'income' },
    { type: 'red_envelope_send', expected: 'expense' },
    { status: 'disputing', expected: 'expense' },
    { status: 'refused', expected: 'expense' },
    { status: 'refund', expected: 'neutral' },
    { status: 'pending', expected: 'neutral' },
    { status: 'failed', expected: 'neutral' },
    { status: 'expired', expected: 'neutral' },
    { type: 'test', expected: 'neutral' },
    { type: 'future-type', expected: 'neutral' },
    { status: 'future-status', expected: 'neutral' }
  ])('derives direction from actual transaction semantics: %j', async ({ expected, ...fields }) => {
    const fetcher = fetchTransactions([order(fields)]);
    const result = await getLinuxDoCreditTransactions({ userId: '42', fetcher, page: 1 });
    expect(result.entries[0]?.direction).toBe(expected);
    expect(result.entries[0]?.amount).toBe(fields.amount ?? '10.25');
  });

  it('distinguishes delayed settlement from an unpaid order and keeps original order amounts', async () => {
    const fetcher = fetchTransactions([
      order({ type: 'receive', payer_user_id: '99', payee_user_id: '42', payee_transfer_status: 'pending' }),
      order({ id: '2', status: 'pending', payee_transfer_status: 'pending' })
    ]);
    const result = await getLinuxDoCreditTransactions({ userId: '42', fetcher, page: 1 });
    expect(result.entries.map(({ settlementPending, amount }) => ({ settlementPending, amount }))).toEqual([
      { settlementPending: true, amount: '10.25' },
      { settlementPending: false, amount: '10.25' }
    ]);
  });

  it('refuses unrelated private entries and malformed pagination', async () => {
    const unrelated = fetchTransactions([order({ payer_user_id: '88' })]);
    await expect(getLinuxDoCreditTransactions({ userId: '42', fetcher: unrelated, page: 1 })).rejects.toMatchObject({
      kind: 'identity-mismatch'
    });
    const wrongPage = fetchTransactions([], { page: 2 });
    await expect(getLinuxDoCreditTransactions({ userId: '42', fetcher: wrongPage, page: 1 })).rejects.toMatchObject({
      kind: 'unavailable'
    });
  });

  it.each([{ amount: 0.1 }, { id: '01' }, { created_at: 'invalid' }, { payee_transfer_status: 'unknown' }])(
    'rejects malformed transaction fields: %j',
    async (fields) => {
      const fetcher = fetchTransactions([order(fields)]);
      await expect(getLinuxDoCreditTransactions({ userId: '42', fetcher, page: 1 })).rejects.toMatchObject({
        kind: 'unavailable'
      });
    }
  );

  it('does not send requests for an already canceled owner', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<Fetcher>();
    await expect(getLinuxDoCreditAccount({ userId: '42', fetcher, signal: controller.signal })).rejects.toBeInstanceOf(
      RequestCanceledError
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops before the next request when the owner cancels after identity verification', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => {
      controller.abort();
      return json(account);
    });
    await expect(
      getLinuxDoCreditTransactions({ userId: '42', fetcher, page: 1, signal: controller.signal })
    ).rejects.toBeInstanceOf(RequestCanceledError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
