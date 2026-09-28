import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import type { Fetcher } from '@/platform/network/request';
import { QueryTestWrapper } from '../QueryTestWrapper';

jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual<typeof import('@/platform/network/managedCookies')>('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined),
  readManagedCookieHeader: jest.fn(async () => ({ status: 'ok', header: 'session=mock-only' }))
}));

afterEach(async () => {
  await cleanup();
  setDiagnosticWriter(null);
});

// Account observer, reconciliation, identity changes and epochs are real; HTTP/cookies are local mocks.
describe('account identity reconciliation pressure', () => {
  it('coalesces 2000 rechecks across 20 identity changes and ignores 2000 obsolete requests', async () => {
    setDiagnosticWriter(() => {});
    appQueryClient.setQueryData(
      accountQueryKeys.snapshot('linuxdo'),
      accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), {
        type: 'session-updated',
        loggedIn: true,
        currentUser: { source: 'linuxdo', id: 'initial', username: 'initial', url: 'https://linux.do/u/initial' }
      })
    );
    let pending = Promise.withResolvers<Response>();
    let active = 0;
    let peak = 0;
    const fetcher = jest.fn<Fetcher>(async (url) => {
      if (!url.endsWith('/session/current.json')) throw new Error(`Unexpected mock request: ${url}`);
      active++;
      peak = Math.max(peak, active);
      try {
        return await pending.promise;
      } finally {
        active--;
      }
    });
    const notify = jest.fn<(message: string) => void>();
    const loginNavigation = { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true };
    const hook = await renderHook(
      () =>
        useAccountRuntime({
          appActive: true,
          enabledSources: ['linuxdo'],
          fetcher,
          loginNavigation,
          notify,
          nodeSeekRecoveryThreshold: 1,
          openUser: async () => undefined,
          ready: false,
          screen: 'search',
          webViewBlockMessage: ''
        }),
      { wrapper: QueryTestWrapper }
    );
    const initialEpoch = hook.result.current.read.forumSessionEpochs.linuxdo;
    try {
      for (let round = 0; round < 20; round++) {
        pending = Promise.withResolvers<Response>();
        const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
        await act(async () => {
          for (let request = 0; request < 100; request++) {
            hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
          }
        });
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(round + 1));
        expect(active).toBe(1);
        const username = `stress-user-${round}`;
        await act(async () => pending.resolve(new Response(JSON.stringify({ current_user: { username } }))));
        await waitFor(() => {
          expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe(username);
          expect(hook.result.current.read.accountSessionViewModels.linuxdo.isVerifying).toBe(false);
          expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(initialEpoch + round + 1);
        });
        await act(async () => {
          for (let stale = 0; stale < 100; stale++) {
            hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
          }
        });
        expect(fetcher).toHaveBeenCalledTimes(round + 1);
        expect(active).toBe(0);
      }
      expect(peak).toBe(1);
      expect(notify).not.toHaveBeenCalled();
    } finally {
      await act(async () => pending.resolve(new Response(JSON.stringify({ current_user: null }))));
      await hook.unmount();
    }
  });
});
