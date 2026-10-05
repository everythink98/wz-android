import { describe, expect, it, vi } from 'vitest';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { browserFetchIntentFromInit, withNativeForumReadIntent } from '@/platform/network/browserFetchIntent';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));
vi.mock('@/platform/network/networkProxy', () => ({ recoverReadNetworkRuntime: vi.fn() }));

import { createReadGateway } from './readGateway';

const stardustPayload = {
  success: true,
  records: [
    {
      id: 91,
      member_id: 7,
      peer_id: 8,
      type: 'upvote',
      diff: 1,
      result: 2,
      ref_id: 3,
      created_at: '2026-10-01T17:14:50.000Z',
      comment_id: 4
    }
  ],
  exist_more: false,
  cursor: 91
};

function session(overrides: Partial<SessionRuntimeSnapshot> = {}): SessionRuntimeSnapshot {
  return {
    source: 'nodeseek',
    authenticated: true,
    authSurfaceOpen: false,
    identityKey: 'nodeseek:7',
    identityTrust: 'confirmed',
    sessionEpoch: 4,
    sourceEnabled: true,
    ...overrides
  };
}

describe('managed private account data', () => {
  it('uses managed transport and the business User request owner for income records', async () => {
    const fetcher = vi.fn<Fetcher>(async () => Response.json({ success: true, data: [], total: 0 }));
    const anonymousFetcher = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher,
      nodeSeekUserAgent: () => 'test-UA',
      readSessionRuntimeSnapshot: () => session()
    });
    expect(await gateway.getNodeSeekCredits({ userId: '7' }, { readPlanScope: 'authenticated:4' })).toMatchObject({
      userId: '7',
      entries: [],
      hasMore: false
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(anonymousFetcher).not.toHaveBeenCalled();
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0]?.[1])).toMatchObject({
      owner: 'user',
      priority: 'foreground'
    });
  });

  it('reads the private Stardust keyset ledger with the shared User transport and captured scope', async () => {
    const fetcher = vi.fn<Fetcher>(async () => Response.json(stardustPayload));
    const anonymousFetcher = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: () => session()
    });
    expect(
      await gateway.getNodeSeekStardustCredits({ userId: '7', beforeId: 100 }, { readPlanScope: 'authenticated:4' })
    ).toEqual({
      source: 'nodeseek',
      userId: '7',
      entries: [{ change: 1, balance: 2, reason: '点赞', createdAt: '2026-10-01T17:14:50.000Z' }],
      hasMore: false,
      nextBeforeId: null
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.nodeseek.com/api/stardust/list?count=10&member_id=7&before_id=100',
      expect.any(Object)
    );
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0]?.[1])).toEqual({ owner: 'user', priority: 'foreground' });
    expect(anonymousFetcher).not.toHaveBeenCalled();
  });

  it('assigns the User fallback intent when the Yaohuo overview provider supplies none', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response(
          '<div class="myfile-page"><span class="chip-id">ID:7</span><span class="user-nickname">alice</span></div>'
        )
    );
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: () => session({ source: 'yaohuo', identityKey: 'yaohuo:7' })
    });
    expect(await gateway.getYaohuoAccountOverview({ userId: '7' })).toMatchObject({ source: 'yaohuo', userId: '7' });
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0]?.[1])).toEqual({ owner: 'user', priority: 'foreground' });
  });

  it.each([
    { authenticated: false, identityKey: 'nodeseek:anonymous', identityTrust: 'none' as const },
    { identityTrust: 'unknown' as const },
    { authSurfaceOpen: true },
    { sourceEnabled: false }
  ])('blocks a private board without sending a public fallback: %j', async (state) => {
    const fetcher = vi.fn();
    const anonymousFetcher = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: () => session(state)
    });
    await expect(gateway.getNodeSeekAttendanceBoard({ userId: '7' })).rejects.toBeInstanceOf(Error);
    await expect(gateway.getNodeSeekStardustCredits({ userId: '7' })).rejects.toBeInstanceOf(Error);
    expect(fetcher).not.toHaveBeenCalled();
    expect(anonymousFetcher).not.toHaveBeenCalled();
  });

  it('rejects stale cached scope and a different requested account before sending', async () => {
    const fetcher = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: () => session()
    });
    await expect(gateway.getNodeSeekCredits({ userId: '7' }, { readPlanScope: 'authenticated:3' })).rejects.toThrow(
      '请求已取消'
    );
    await expect(gateway.getNodeSeekCredits({ userId: '8' })).rejects.toThrow('请求已取消');
    await expect(
      gateway.getNodeSeekStardustCredits({ userId: '7' }, { readPlanScope: 'authenticated:3' })
    ).rejects.toThrow('请求已取消');
    await expect(gateway.getNodeSeekStardustCredits({ userId: '8' })).rejects.toThrow('请求已取消');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['coin', 'stardust'] as const)(
    'checks identity again at the final %s transport boundary',
    async (currency) => {
      let current = session();
      const fetcher = vi.fn();
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        nodeSeekUserAgent: () => 'test',
        readSessionRuntimeSnapshot: () => current
      });
      const request =
        currency === 'coin'
          ? gateway.getNodeSeekCredits({ userId: '7' })
          : gateway.getNodeSeekStardustCredits({ userId: '7' });
      current = session({ identityKey: 'nodeseek:8' });
      await expect(request).rejects.toThrow('请求已取消');
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each(
    (['coin', 'stardust'] as const).flatMap((currency) =>
      (['unchanged', 'identity', 'epoch', 'auth-surface', 'source-disabled'] as const).map((change) => ({
        currency,
        change
      }))
    )
  )('checks $currency read eligibility after proxy readiness when changing $change', async ({ currency, change }) => {
    let current = session();
    let sourceEnabled = true;
    const proxyReady = Promise.withResolvers<void>();
    const proxyWaiting = Promise.withResolvers<void>();
    const nativeFetcher = vi.fn<Fetcher>(async () =>
      Response.json(currency === 'coin' ? { success: true, data: [], total: 0 } : stardustPayload)
    );
    const networkProxyFetcher: Fetcher = async (input, init) => {
      proxyWaiting.resolve();
      await proxyReady.promise;
      return nativeFetcher(input, prepareRequestToSend(withNativeForumReadIntent(input, init)));
    };
    const gateway = createReadGateway({
      fetcher: networkProxyFetcher,
      anonymousFetcher: nativeFetcher,
      getEnabledSources: () => (sourceEnabled ? ['nodeseek'] : []),
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: () => current
    });
    const request =
      currency === 'coin'
        ? gateway.getNodeSeekCredits({ userId: '7' }, { readPlanScope: 'authenticated:4' })
        : gateway.getNodeSeekStardustCredits({ userId: '7' }, { readPlanScope: 'authenticated:4' });
    await proxyWaiting.promise;
    expect(nativeFetcher).not.toHaveBeenCalled();
    if (change === 'identity') current = session({ identityKey: 'nodeseek:8' });
    if (change === 'epoch') current = session({ sessionEpoch: 5 });
    if (change === 'auth-surface') current = session({ authSurfaceOpen: true });
    if (change === 'source-disabled') {
      sourceEnabled = false;
      current = session({ sourceEnabled: false });
    }
    proxyReady.resolve();

    if (change === 'unchanged') {
      expect(await request).toMatchObject({ userId: '7' });
      expect(nativeFetcher).toHaveBeenCalledTimes(1);
    } else {
      await expect(request).rejects.toThrow('请求已取消');
      expect(nativeFetcher).not.toHaveBeenCalled();
    }
  });

  it.each(['coin', 'stardust'] as const)(
    'discards a successful private %s response when its account changes during body reading',
    async (currency) => {
      let current = session();
      const fetcher = vi.fn(async () => {
        const response = new Response();
        response.text = async () => {
          current = session({ identityKey: 'nodeseek:8' });
          return JSON.stringify(
            currency === 'coin'
              ? { success: true, data: [[8, 30, '签到', '2026-10-02T01:00:00.000Z']], total: 1 }
              : stardustPayload
          );
        };
        return response;
      });
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        nodeSeekUserAgent: () => 'test',
        readSessionRuntimeSnapshot: () => current
      });
      await expect(
        currency === 'coin'
          ? gateway.getNodeSeekCredits({ userId: '7' })
          : gateway.getNodeSeekStardustCredits({ userId: '7' })
      ).rejects.toThrow('请求已取消');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps Stardust Cloudflare failures in the existing challenge path without public fallback', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('<html>Checking your browser</html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }
        })
    );
    const anonymousFetcher = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: () => session()
    });
    await expect(gateway.getNodeSeekStardustCredits({ userId: '7' })).rejects.toMatchObject({
      source: 'nodeseek',
      reason: 'cloudflare'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(anonymousFetcher).not.toHaveBeenCalled();
  });
});
