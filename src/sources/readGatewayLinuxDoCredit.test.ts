import { describe, expect, it, vi } from 'vitest';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import type { Fetcher } from '@/platform/network/request';
import { LinuxDoCreditError } from '@/domain/forum/linuxDoCredit';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));
vi.mock('@/platform/network/networkProxy', () => ({ recoverReadNetworkRuntime: vi.fn() }));
import { createReadGateway } from './readGateway';

function session(overrides: Partial<SessionRuntimeSnapshot> = {}): SessionRuntimeSnapshot {
  return {
    source: 'linuxdo',
    authenticated: true,
    authSurfaceOpen: false,
    identityKey: 'linuxdo:alice',
    identityTrust: 'confirmed',
    sessionEpoch: 4,
    sourceEnabled: true,
    ...overrides
  };
}
const account = {
  error_msg: '',
  data: { id: '7', username: 'alice', available_balance: '123456789012345.67', pending_balance: '1.20' }
};
const options = { userId: 'alice', username: 'alice' };
function withForumIdentity(credit: Fetcher): Fetcher {
  return (url, init) =>
    url === 'https://linux.do/session/current.json'
      ? Promise.resolve(Response.json({ current_user: { id: 7, username: 'alice' } }))
      : credit(url, init);
}
function setup(fetcher: Fetcher, current = () => session()) {
  const onSessionExpired = vi.fn();
  const requestAccountRecheck = vi.fn();
  const gateway = createReadGateway({
    fetcher,
    anonymousFetcher: vi.fn(),
    nodeSeekUserAgent: () => 'NS-UA',
    linuxDoUserAgent: () => 'L-UA',
    readSessionRuntimeSnapshot: current,
    onSessionExpired,
    requestAccountRecheck
  });
  return { gateway, onSessionExpired, requestAccountRecheck };
}

describe('LinuxDo Credit managed reads', () => {
  it('keeps an expired Credit session separate from the forum account', async () => {
    const { gateway, onSessionExpired, requestAccountRecheck } = setup(
      withForumIdentity(async () => Response.json({ error_msg: '未登录', data: null }, { status: 401 }))
    );
    await expect(gateway.getLinuxDoCreditAccount(options)).rejects.toMatchObject({ kind: 'authorization-required' });
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(requestAccountRecheck).not.toHaveBeenCalled();
  });

  it('still expires the forum session for a forum 401', async () => {
    const { gateway, onSessionExpired } = setup(async () => Response.json({}, { status: 401 }));
    await expect(gateway.getUserDetails({ source: 'linuxdo', id: 'alice', username: 'alice' })).rejects.toThrow();
    expect(onSessionExpired).toHaveBeenCalledWith('linuxdo', 4);
  });

  it('keeps forum and Credit verification errors distinct for their recovery buttons', async () => {
    const challenge = () => new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
    const forum = setup(async () => challenge());
    await expect(forum.gateway.getLinuxDoCreditAccount(options)).rejects.toBeInstanceOf(LinuxDoCloudflareError);
    const credit = setup(withForumIdentity(async () => challenge()));
    await expect(credit.gateway.getLinuxDoCreditAccount(options)).rejects.toMatchObject({
      name: 'LinuxDoCreditError',
      kind: 'verification-required'
    });
    expect(forum.onSessionExpired).not.toHaveBeenCalled();
    expect(credit.onSessionExpired).not.toHaveBeenCalled();
  });

  it.each([
    { authenticated: false, identityKey: 'linuxdo:anonymous', identityTrust: 'none' as const },
    { identityTrust: 'unknown' as const },
    { authSurfaceOpen: true },
    { sourceEnabled: false },
    { identityKey: 'linuxdo:bob' }
  ])('sends nothing for an unavailable owner: %j', async (state) => {
    const fetcher = vi.fn<Fetcher>();
    const { gateway } = setup(fetcher, () => session(state));
    await expect(gateway.getLinuxDoCreditAccount(options)).rejects.toThrow();
    await expect(gateway.getLinuxDoCreditTransactions({ ...options, page: 1 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks the requested cache scope and preserves the exact available balance', async () => {
    const fetcher = vi.fn<Fetcher>(withForumIdentity(async () => Response.json(account)));
    const { gateway } = setup(fetcher);
    await expect(gateway.getLinuxDoCreditAccount(options, { readPlanScope: 'authenticated:3' })).rejects.toThrow(
      '请求已取消'
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(await gateway.getLinuxDoCreditAccount(options, { readPlanScope: 'authenticated:4' })).toMatchObject({
      availableBalance: '123456789012345.67'
    });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('User-Agent')).toBe('L-UA');
  });

  it('rejects a different Credit owner without requesting their transactions', async () => {
    const fetcher = vi.fn<Fetcher>(
      withForumIdentity(async () => Response.json({ ...account, data: { ...account.data, username: 'bob' } }))
    );
    const { gateway, onSessionExpired } = setup(fetcher);
    await expect(gateway.getLinuxDoCreditTransactions({ ...options, page: 1 })).rejects.toBeInstanceOf(
      LinuxDoCreditError
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not request transactions after the forum owner changes during the Credit identity read', async () => {
    let current = session();
    const fetcher = vi.fn<Fetcher>(
      withForumIdentity(async () => {
        current = session({ identityKey: 'linuxdo:bob', sessionEpoch: 5 });
        return Response.json(account);
      })
    );
    const { gateway } = setup(fetcher, () => current);
    await expect(gateway.getLinuxDoCreditTransactions({ ...options, page: 1 })).rejects.toThrow('请求已取消');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports a forum 401 encountered while verifying the LDC owner', async () => {
    const { gateway, onSessionExpired } = setup(async () => Response.json({}, { status: 401 }));
    await expect(gateway.getLinuxDoCreditAccount(options)).rejects.toThrow();
    expect(onSessionExpired).toHaveBeenCalledWith('linuxdo', 4);
  });

  it('rejects an old Credit session even when a different forum user reuses its username', async () => {
    const fetcher = vi.fn<Fetcher>(async (url) =>
      url === 'https://linux.do/session/current.json'
        ? Response.json({ current_user: { id: 8, username: 'alice' } })
        : Response.json(account)
    );
    const { gateway, onSessionExpired } = setup(fetcher);
    await expect(gateway.getLinuxDoCreditTransactions({ ...options, page: 1 })).rejects.toMatchObject({
      kind: 'identity-mismatch'
    });
    expect(fetcher.mock.calls.some(([url]) => url.includes('/order/transactions'))).toBe(false);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});
