import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import type { Fetcher } from '@/platform/network/request';
import type { Source } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';

jest.mock('@/features/account/AccountHosts', () => ({ AccountHosts: () => null }));
jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined),
  readManagedCookieHeader: jest.fn(async () => ({ status: 'ok', header: 'test-session=fixture' }))
}));

let events: DiagnosticEvent[] = [];
function seedAccount(username = 'alice') {
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot('linuxdo'),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { source: 'linuxdo', id: username, username, url: `https://linux.do/u/${username}`, topics: [] }
    })
  );
}

async function renderRuntime(fetcher: Fetcher) {
  seedAccount();
  const notify = jest.fn();
  const openUser = async () => undefined;
  const loginNavigation = { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true };
  return renderHook(
    ({ enabledSources }: { enabledSources: readonly Source[] }) =>
      useAccountRuntime({
        appActive: true,
        enabledSources,
        fetcher,
        loginNavigation,
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser,
        ready: false,
        screen: 'search',
        webViewBlockMessage: ''
      }),
    { initialProps: { enabledSources: ['linuxdo'] }, wrapper: QueryTestWrapper }
  );
}

beforeEach(() => {
  events = [];
  setDiagnosticWriter((line) => {
    events.push(JSON.parse(line) as DiagnosticEvent);
  });
});
afterEach(() => setDiagnosticWriter(null));

it.each(['anonymous', 'same', 'changed', 'unknown'] as const)(
  'settles concurrent login contradictions through one account probe: %s',
  async (outcome) => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (input) => {
      if (input.includes('/session/current.json')) return pending;
      if (input.includes('/session/csrf')) return new Response(JSON.stringify({ csrf: 'token' }));
      return new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 });
    });
    const hook = await renderRuntime(fetcher);
    const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
    await act(async () => {
      await expect(
        hook.result.current.read.readGateway.searchTopics({ source: 'linuxdo', query: 'AI' })
      ).rejects.toMatchObject({ reason: 'account-recheck-required' });
      hook.result.current.write.requestAccountRecheck('linuxdo', epoch, 'trace-987');
    });
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([url]) => url.includes('/session/current.json'))).toHaveLength(1)
    );
    await waitFor(() =>
      expect(hook.result.current.read.accountSessionViewModels.linuxdo).toMatchObject({
        isLoggedIn: true,
        isVerifying: true
      })
    );
    expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'search')).toMatchObject({
      lane: 'authenticated'
    });
    await act(async () => {
      complete(
        outcome === 'unknown'
          ? new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 })
          : new Response(
              JSON.stringify({
                current_user: outcome === 'anonymous' ? null : { username: outcome === 'changed' ? 'bob' : 'alice' }
              })
            )
      );
    });
    await waitFor(() => expect(hook.result.current.read.accountSessionViewModels.linuxdo.isVerifying).toBe(false));
    expect(hook.result.current.read.accountSessionViewModels.linuxdo.isLoggedIn).toBe(outcome !== 'anonymous');
    expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(
      epoch + (outcome === 'anonymous' || outcome === 'changed' ? 1 : 0)
    );
    expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'search')).toMatchObject({
      lane: outcome === 'anonymous' ? 'public' : 'authenticated'
    });
    if (outcome === 'changed')
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('bob');
    if (outcome === 'unknown') expect(hook.result.current.read.accountSessionViewModels.linuxdo.lastError).toBeTruthy();
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/session/current.json'))).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'account-reconcile',
          phase: 'intent',
          parentTraceId: expect.stringMatching(/^trace-/)
        }),
        expect.objectContaining({
          operation: 'account-reconcile',
          phase: 'guard',
          reason: 'duplicate',
          parentTraceId: 'trace-987'
        }),
        expect.objectContaining({ operation: 'account-reconcile', phase: 'finish' })
      ])
    );
  }
);

it('ignores stale, disabled, anonymous and login-surface recheck requests', async () => {
  const fetcher = jest.fn(async () => new Response('{}'));
  const hook = await renderRuntime(fetcher);
  const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
  const request = hook.result.current.write.requestAccountRecheck;
  await act(async () => {
    request('linuxdo', epoch - 1);
  });
  await hook.rerender({ enabledSources: [] });
  await act(async () => {
    request('linuxdo', epoch);
  });
  await hook.rerender({ enabledSources: ['linuxdo'] });
  await act(async () => {
    appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), createAccountSessionSnapshot('linuxdo'));
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
    appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), {
      ...createAccountSessionSnapshot('linuxdo'),
      identityTrust: 'none'
    });
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
    seedAccount();
    hook.result.current.hosts.showLinuxDoVerification('需要验证');
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it('discards a recheck result when its source is disabled while the probe is in flight', async () => {
  let complete!: (response: Response) => void;
  const fetcher = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      })
  );
  const hook = await renderRuntime(fetcher);
  const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
  await act(async () => {
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await hook.rerender({ enabledSources: [] });
  expect(setLinuxDoCookieResponseBarrier).toHaveBeenLastCalledWith(true, 'source-change');
  await act(async () => {
    complete(new Response(JSON.stringify({ current_user: null })));
  });
  expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'))).toMatchObject({
    status: 'logged-in',
    currentUser: { username: 'alice' }
  });
  expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(epoch);
});

it('awaits the native cookie handoff before probing after login closes', async () => {
  const fetcher = jest.fn(
    async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
  );
  const hook = await renderRuntime(fetcher);
  await act(async () => {
    await hook.result.current.hosts.showLinuxDoVerification('登录');
  });
  let release!: () => void;
  jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(setLinuxDoCookieResponseBarrier).toHaveBeenLastCalledWith(false, 'surface-close', expect.any(Number));
  expect(fetcher).not.toHaveBeenCalled();
  const callsBeforeDuplicateClose = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls).toHaveLength(callsBeforeDuplicateClose);
  await act(async () => {
    release();
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
});
