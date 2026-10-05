import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { createAppQueryClient } from '@/platform/query/serverState';
import { useAccountOverview, type AccountOverviewGateway } from '@/features/more/useAccountOverview';
import { projectTestAccountSessions } from '../../helpers/accountSessions';

const clients: ReturnType<typeof createAppQueryClient>[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

function profile(source: SessionSite, id: string) {
  return { source, id, username: id, url: `https://account.invalid/${source}/${id}`, topicCount: 1, replyCount: 3 };
}

function session(site: SessionSite, id = '42') {
  return projectTestAccountSessions(
    createSiteSessionStates({
      [site]: { site, status: 'logged-in', cookieSummary: [], isVerifying: false, currentUser: profile(site, id) }
    })
  )[site];
}

function setup() {
  const client = createAppQueryClient();
  clients.push(client);
  const getUserDetails = jest.fn<AccountOverviewGateway['getUserDetails']>(async ({ source, id }) => {
    if (source === 'v2ex') throw new Error('Not an account-center source');
    return profile(source, id);
  });
  const getOverview = jest
    .fn<AccountOverviewGateway['getNodeSeekAccountOverview']>()
    .mockResolvedValueOnce({ source: 'nodeseek', userId: '42', profile: profile('nodeseek', '42'), coin: 5 })
    .mockResolvedValue({ source: 'nodeseek', userId: '42', profile: profile('nodeseek', '42'), coin: 8 });
  const getBoard = jest.fn<AccountOverviewGateway['getNodeSeekAttendanceBoard']>(async ({ userId }) => ({
    source: 'nodeseek',
    userId,
    list: [],
    record: null,
    order: null,
    total: 0
  }));
  const gateway: AccountOverviewGateway = {
    getReadPlan: () => ({
      state: 'ready',
      lane: 'authenticated',
      transport: 'managed-session',
      cacheScope: 'authenticated:0'
    }),
    getUserDetails,
    getNodeSeekAccountOverview: getOverview,
    getNodeSeekAttendanceBoard: getBoard,
    getYaohuoAccountOverview: jest.fn<AccountOverviewGateway['getYaohuoAccountOverview']>()
  };
  const render = () =>
    renderHook(
      ({ active, site }: { active: boolean; site: SessionSite }) =>
        useAccountOverview({
          active,
          site,
          gateway,
          session: session(site),
          sessionEpochs: initialForumSessionEpochs
        }),
      {
        initialProps: { active: true, site: 'nodeseek' },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        )
      }
    );
  return { client, getUserDetails, getOverview, getBoard, render };
}

describe('Account center cached reads', () => {
  it('loads each site once, keeps data through switches and foreground returns, and updates only on refresh', async () => {
    const { client, getUserDetails, getOverview, getBoard, render } = setup();
    const hook = await render();
    await waitFor(() => expect(hook.result.current.overview).toMatchObject({ coin: 5 }));
    await hook.rerender({ active: true, site: 'linuxdo' });
    await waitFor(() => expect(hook.result.current.profile?.source).toBe('linuxdo'));
    await hook.rerender({ active: true, site: 'nodeseek' });
    await hook.rerender({ active: false, site: 'nodeseek' });
    await hook.rerender({ active: true, site: 'nodeseek' });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    expect(hook.result.current.overview).toMatchObject({ coin: 5 });
    expect(getUserDetails).toHaveBeenCalledTimes(2);
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getBoard).toHaveBeenCalledTimes(1);
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.overview).toMatchObject({ coin: 8 }));
    expect(getUserDetails).toHaveBeenCalledTimes(3);
    expect(getOverview).toHaveBeenCalledTimes(2);
    expect(getBoard).toHaveBeenCalledTimes(2);
    await hook.unmount();
    client.clear();
    focusManager.setFocused(undefined);
  });

  it('retains private data after a long unmounted visit and honors explicit write invalidation', async () => {
    const { client, getUserDetails, getOverview, getBoard, render } = setup();
    const hook = await render();
    await waitFor(() => expect(hook.result.current.overview).toMatchObject({ coin: 5 }));
    jest.useFakeTimers();
    try {
      await hook.unmount();
      await act(async () => jest.advanceTimersByTime(6 * 60 * 1000));
    } finally {
      jest.useRealTimers();
    }
    const next = await render();
    expect(next.result.current.overview).toMatchObject({ coin: 5 });
    expect(getUserDetails).toHaveBeenCalledTimes(1);
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getBoard).toHaveBeenCalledTimes(1);
    await act(async () => client.invalidateQueries({ queryKey: ['forum', 'nodeseek', 'account-data', 'overview'] }));
    await waitFor(() => expect(next.result.current.overview).toMatchObject({ coin: 8 }));
    expect(getBoard).toHaveBeenCalledTimes(1);
    await next.unmount();
    client.clear();
  });
});
