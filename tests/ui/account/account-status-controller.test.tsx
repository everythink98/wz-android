import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/sources/readGateway', () => ({
  checkYaohuoLogin: jest.fn(),
  getCurrentUserProfile: jest.fn()
}));

import { checkYaohuoLogin, getCurrentUserProfile } from '@/sources/readGateway';
import { useAccountStatusController } from '@/features/account/useAccountStatusController';
import { accountQueryKeys, appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { resetForumSourceQueries } from '@/features/account/sessionQueryOwnership';
import {
  createSiteSessionStates,
  createSiteSessionViewModels,
  type AccountSessionSnapshot,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import { sessionSources } from '@/domain/forum/sourceCatalog';
import type { UserProfile } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockCheckYaohuoLogin = jest.mocked(checkYaohuoLogin);
const mockGetCurrentUser = jest.mocked(getCurrentUserProfile);
const mockReadLinuxDoCookieHeader = jest.fn<() => Promise<string | undefined>>();
const mockReadYaohuoCookieHeader = jest.fn<() => Promise<string | undefined>>();

const linuxUser: UserProfile = {
  source: 'linuxdo',
  id: '7',
  username: 'alice',
  url: 'https://linux.do/u/alice',
  topics: []
};

const nodeSeekUser: UserProfile = {
  source: 'nodeseek',
  id: '17',
  username: 'bob',
  url: 'https://www.nodeseek.com/space/17',
  topics: []
};

const nextNodeSeekUser: UserProfile = {
  source: 'nodeseek',
  id: '18',
  username: 'charlie',
  url: 'https://www.nodeseek.com/space/18',
  topics: []
};

const yaohuoUser: UserProfile = {
  source: 'yaohuo',
  id: '31',
  username: 'dave',
  url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=31',
  topics: []
};

type ReadManagedCookieHeader = NonNullable<Parameters<typeof useAccountStatusController>[0]['readManagedCookieHeader']>;

type StatusTestOptions = {
  readNodeSeekCookieHeader?: () => Promise<string | undefined>;
  sessionEpochs?: ForumSessionEpochs;
  sessionViewModels?: SiteSessionViewModels;
};

async function renderStatusController({
  enabledSources = sessionSources,
  enabledSourcesReady = false,
  sessionEpochs = initialForumSessionEpochs,
  fetcher = jest.fn(async () => new Response('{}')),
  linuxDoUserAgentRef = { current: 'safe-agent' },
  nodeSeekUserAgentRef = { current: 'safe-agent' },
  readNodeSeekCookieHeader = jest.fn(async () => undefined),
  notify = jest.fn(),
  onAccountStatusChanged = jest.fn(),
  readManagedCookieHeader = async (exactUrl: string) => {
    if (exactUrl.includes('nodeseek.com')) {
      return {
        status: 'ok' as const,
        header: (await readNodeSeekCookieHeader()) || ''
      };
    }
    if (exactUrl.includes('linux.do')) {
      return {
        status: 'ok' as const,
        header: (await mockReadLinuxDoCookieHeader()) || ''
      };
    }
    return {
      status: 'ok' as const,
      header: (await mockReadYaohuoCookieHeader()) || ''
    };
  },
  sessionViewModels
}: Partial<Parameters<typeof useAccountStatusController>[0]> & StatusTestOptions = {}) {
  if (sessionViewModels) {
    for (const source of sessionSources) {
      const view = sessionViewModels[source];
      appQueryClient.setQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source), {
        site: view.site,
        status: view.status,
        cookieSummary: view.cookieSummary,
        isVerifying: view.isVerifying,
        identityTrust: view.identityTrust,
        ...(view.currentUser ? { currentUser: view.currentUser } : {}),
        ...(view.lastVerifiedAt ? { lastVerifiedAt: view.lastVerifiedAt } : {}),
        ...(view.lastError ? { lastError: view.lastError } : {})
      });
    }
  }
  const commitAccountStatusChange: Parameters<typeof useAccountStatusController>[0]['onAccountStatusChanged'] = (
    source,
    recoveryQueryKey
  ) => {
    onAccountStatusChanged(source, recoveryQueryKey);
    resetForumSourceQueries(source, appQueryClient, recoveryQueryKey);
  };
  const hook = await renderNativeHook(
    ({
      renderedEnabledSources
    }: {
      renderedSessionEpochs: ForumSessionEpochs;
      renderedEnabledSources?: readonly (typeof sessionSources)[number][];
    }) =>
      useAccountStatusController({
        fetcher,
        enabledSources: renderedEnabledSources || enabledSources,
        linuxDoUserAgentRef,
        nodeSeekUserAgentRef,
        notify,
        onAccountStatusChanged: commitAccountStatusChange,
        readManagedCookieHeader,
        enabledSourcesReady
      }),
    {
      initialProps: { renderedSessionEpochs: sessionEpochs, renderedEnabledSources: enabledSources },
      wrapper: QueryTestWrapper
    }
  );
  return {
    hook,
    notify,
    onAccountStatusChanged
  };
}

describe('account status queries', () => {
  beforeEach(async () => {
    appQueryClient.clear();
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockReadLinuxDoCookieHeader.mockResolvedValue(undefined);
    mockReadYaohuoCookieHeader.mockResolvedValue(undefined);
    mockCheckYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      loginUrl: 'https://www.yaohuo.me/login.aspx',
      message: '未登录',
      reason: 'expired'
    });
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'nodeseek' ? (null as never) : linuxUser));
  });

  it('[REG-PERF-019] restores the last confirmed identity without probing the account endpoint', async () => {
    await AsyncStorage.multiSet([
      ['account-session.migration.v1', '1'],
      [
        'account-session.v1.nodeseek',
        JSON.stringify({
          version: 1,
          state: 'authenticated',
          identity: {
            source: 'nodeseek',
            id: '17',
            username: 'bob',
            url: 'https://www.nodeseek.com/space/17'
          }
        })
      ]
    ]);

    const { hook } = await renderStatusController({ enabledSourcesReady: true });

    await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      identityTrust: 'confirmed',
      currentUser: { id: '17', username: 'bob' }
    });
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockCheckYaohuoLogin).not.toHaveBeenCalled();
  });

  it('[REG-PERF-019] probes only migration candidates and marks the one-time migration complete', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const readNodeSeekCookieHeader = jest.fn(async () => 'session=candidate');
    const first = await renderStatusController({
      enabledSources: ['nodeseek'],
      enabledSourcesReady: true,
      readNodeSeekCookieHeader
    });

    await waitFor(() => expect(first.hook.result.current.hydrated).toBe(true));
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('account-session.migration.v1')).toBe('1');
    expect(await AsyncStorage.getItem('account-session.v1.nodeseek')).toContain('"state":"authenticated"');
  });

  it('[REG-ACCOUNT-044] bounds only one-time migration and releases its probe before sessions are ready', async () => {
    jest.useFakeTimers();
    const readNodeSeekCookieHeader = jest.fn(async () => 'session=candidate');
    mockGetCurrentUser.mockImplementationOnce(
      async ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('migration canceled')), { once: true });
        })
    );

    try {
      const { hook } = await renderStatusController({
        enabledSources: ['nodeseek'],
        enabledSourcesReady: true,
        readNodeSeekCookieHeader
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
      expect(hook.result.current.hydrated).toBe(false);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hook.result.current.hydrated).toBe(true);
      expect(hook.result.current.statusBusy).toBe(false);
      expect(await AsyncStorage.getItem('account-session.migration.v1')).toBe('1');

      mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
      await act(async () => {
        await hook.result.current.reconcileAccountStatus('nodeseek');
        await jest.runOnlyPendingTimersAsync();
      });
      expect(mockGetCurrentUser).toHaveBeenCalledTimes(2);
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        identityTrust: 'confirmed',
        currentUser: nodeSeekUser,
        isVerifying: false
      });
    } finally {
      jest.useRealTimers();
    }
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('[REG-SOURCE-010] probes only enabled sources and treats disabled reconciliation as stale', async () => {
    const { hook } = await renderStatusController({
      enabledSources: ['nodeseek']
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus({ silent: true });
    });

    expect(mockGetCurrentUser).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek' }));
    expect(mockGetCurrentUser).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'linuxdo' }));
    expect(mockCheckYaohuoLogin).not.toHaveBeenCalled();
    await expect(hook.result.current.reconcileAccountStatus('linuxdo')).resolves.toEqual({ status: 'stale' });
  });

  it('[REG-SOURCE-010] starts all-disabled without probes or an identity barrier', async () => {
    const { hook } = await renderStatusController({ enabledSources: [] });

    await act(async () => {
      await hook.result.current.refreshAccountStatus({ silent: true });
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockCheckYaohuoLogin).not.toHaveBeenCalled();
  });

  it('[REG-PERF-014] leaves initial hydration probes to the foreground-ready batch', async () => {
    const { hook } = await renderStatusController({
      enabledSources: []
    });

    await act(async () => {
      hook.rerender({
        renderedEnabledSources: ['nodeseek'],
        renderedSessionEpochs: initialForumSessionEpochs
      });
      await Promise.resolve();
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current.refreshAccountStatus({ silent: true });
    });

    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentUser).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek' }));
  });

  it('[REG-SOURCE-010] ignores an enabled-source reorder with unchanged membership', async () => {
    const { hook } = await renderStatusController({ enabledSources: ['linuxdo', 'nodeseek'] });
    await act(async () => {
      await hook.result.current.refreshAccountStatus({ silent: true });
    });
    jest.clearAllMocks();

    await act(async () => {
      hook.rerender({
        renderedEnabledSources: ['nodeseek', 'linuxdo'],
        renderedSessionEpochs: initialForumSessionEpochs
      });
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockCheckYaohuoLogin).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-010] aborts a disabled probe without reconciling automatically after re-enable', async () => {
    const firstCookie = Promise.withResolvers<string | undefined>();
    const readNodeSeekCookieHeader = jest
      .fn<() => Promise<string | undefined>>()
      .mockImplementationOnce(async () => firstCookie.promise);
    const { hook, onAccountStatusChanged } = await renderStatusController({
      enabledSources: ['nodeseek'],
      readNodeSeekCookieHeader
    });
    let probe!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;

    await act(async () => {
      probe = hook.result.current.reconcileAccountStatus('nodeseek');
      await Promise.resolve();
    });
    await waitFor(() => expect(readNodeSeekCookieHeader).toHaveBeenCalledTimes(1));

    await act(async () => {
      hook.rerender({ renderedSessionEpochs: initialForumSessionEpochs, renderedEnabledSources: [] });
      firstCookie.resolve(undefined);
      await probe;
    });
    expect(onAccountStatusChanged).not.toHaveBeenCalled();

    await act(async () => {
      hook.rerender({ renderedSessionEpochs: initialForumSessionEpochs, renderedEnabledSources: ['nodeseek'] });
      await Promise.resolve();
    });
    expect(readNodeSeekCookieHeader).toHaveBeenCalledTimes(1);
  });

  it('[REG-SOURCE-010] preserves the trusted identity without reconciling automatically after re-enable', async () => {
    const readNodeSeekCookieHeader = jest
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('session=trusted');
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'nodeseek' ? nodeSeekUser : linuxUser));
    const { hook } = await renderStatusController({
      enabledSources: ['nodeseek'],
      readNodeSeekCookieHeader
    });

    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        identityTrust: 'confirmed'
      })
    );

    await act(async () => {
      hook.rerender({ renderedSessionEpochs: initialForumSessionEpochs, renderedEnabledSources: [] });
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        identityTrust: 'confirmed'
      })
    );

    await act(async () => {
      hook.rerender({ renderedSessionEpochs: initialForumSessionEpochs, renderedEnabledSources: ['nodeseek'] });
      await Promise.resolve();
    });
    expect(readNodeSeekCookieHeader).toHaveBeenCalledTimes(1);
    expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('confirmed');
  });

  it('[REG-SOURCE-010] re-enable does not reconcile or cancel active reads', async () => {
    const directResult = Promise.withResolvers<string>();
    const aggregateResult = Promise.withResolvers<string>();
    const directAbort = jest.fn();
    const aggregateAbort = jest.fn();
    const { hook } = await renderStatusController({
      enabledSources: [],
      readNodeSeekCookieHeader: jest.fn(async () => undefined)
    });
    const directRequest = appQueryClient
      .fetchQuery({
        queryKey: ['forum', 'nodeseek', 'feed', { reenabled: true }],
        queryFn: async ({ signal }) => {
          signal.addEventListener('abort', directAbort, { once: true });
          return directResult.promise;
        }
      })
      .catch(() => undefined);
    const aggregateRequest = appQueryClient
      .fetchQuery({
        queryKey: ['forum', 'all', 'feed', { reenabled: true }],
        queryFn: async ({ signal }) => {
          signal.addEventListener('abort', aggregateAbort, { once: true });
          return aggregateResult.promise;
        }
      })
      .catch(() => undefined);
    await Promise.resolve();

    await act(async () => {
      hook.rerender({
        renderedSessionEpochs: initialForumSessionEpochs,
        renderedEnabledSources: ['nodeseek']
      });
      await Promise.resolve();
    });

    expect(directAbort).not.toHaveBeenCalled();
    expect(aggregateAbort).not.toHaveBeenCalled();

    directResult.resolve('stale source result');
    aggregateResult.resolve('current aggregate result');
    await act(async () => {
      await Promise.all([directRequest, aggregateRequest]);
    });
  });

  it('[REG-FEED-010] does not cancel a safe aggregate read when the startup identity probes begin', async () => {
    const aggregateResult = Promise.withResolvers<string>();
    const aggregateAbort = jest.fn();
    const aggregateRequest = appQueryClient
      .fetchQuery({
        queryKey: ['forum', 'all', 'feed', { bootstrap: true }],
        queryFn: async ({ signal }) => {
          signal.addEventListener('abort', aggregateAbort, { once: true });
          return aggregateResult.promise;
        }
      })
      .catch(() => undefined);
    const cookieResult = Promise.withResolvers<string | undefined>();
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => cookieResult.promise)
    });
    expect(
      Object.values(hook.result.current.accountSessionViewModels).every(
        (session) => session.identityTrust === 'unknown'
      )
    ).toBe(true);
    let reconciliation!: ReturnType<typeof hook.result.current.refreshAccountStatus>;

    await act(async () => {
      reconciliation = hook.result.current.refreshAccountStatus({ silent: true });
      await Promise.resolve();
    });

    aggregateResult.resolve('safe aggregate');
    cookieResult.resolve(undefined);
    await act(async () => {
      await Promise.all([aggregateRequest, reconciliation]);
    });

    expect(aggregateAbort).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-044] keeps explicit account reconciliation active past the Feed aggregate budget', async () => {
    jest.useFakeTimers();
    const nodeSeekCookie = Promise.withResolvers<string | undefined>();
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => nodeSeekCookie.promise)
    });
    let reconciliation!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;
    let settled = false;

    try {
      await act(async () => {
        reconciliation = hook.result.current.reconcileAccountStatus('nodeseek');
        void reconciliation.then(() => {
          settled = true;
        });
        await Promise.resolve();
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
        await Promise.resolve();
      });
      expect(settled).toBe(false);
      expect(appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot('nodeseek'))).toMatchObject({
        identityTrust: 'unknown',
        isVerifying: true,
        lastError: undefined
      });

      nodeSeekCookie.resolve('session=safe');
      let result!: Awaited<typeof reconciliation>;
      await act(async () => {
        result = await reconciliation;
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1);
      });

      expect(result.status).toBe('same');
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        identityTrust: 'confirmed',
        isVerifying: false,
        currentUser: nodeSeekUser
      });
      expect(hook.result.current.accountSessionViewModels.nodeseek.lastError).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-ACCOUNT-044] lets three-site refresh publish fast sites while one protocol runs past five seconds', async () => {
    jest.useFakeTimers();
    const nodeSeekCookie = Promise.withResolvers<string | undefined>();
    mockReadLinuxDoCookieHeader.mockResolvedValue('_t=safe');
    mockReadYaohuoCookieHeader.mockResolvedValue('sidyaohuo=safe');
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'nodeseek' ? nodeSeekUser : linuxUser));
    mockCheckYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: true,
      loginRequired: false,
      loginUrl: '',
      message: undefined,
      reason: undefined,
      currentUser: yaohuoUser
    });
    const { hook, notify } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => nodeSeekCookie.promise)
    });
    let refresh!: ReturnType<typeof hook.result.current.refreshAccountStatus>;
    let settled = false;

    try {
      await act(async () => {
        refresh = hook.result.current.refreshAccountStatus();
        void refresh.then(() => {
          settled = true;
        });
        await Promise.resolve();
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });

      expect(settled).toBe(false);
      expect(hook.result.current.accountSessionViewModels.nodeseek.isVerifying).toBe(true);
      for (const source of ['linuxdo', 'yaohuo'] as const) {
        expect(hook.result.current.accountSessionViewModels[source].identityTrust).toBe('confirmed');
      }
      expect(notify).not.toHaveBeenCalled();

      nodeSeekCookie.resolve('session=safe');
      await act(async () => {
        await refresh;
        await jest.runOnlyPendingTimersAsync();
      });

      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        identityTrust: 'confirmed',
        currentUser: nodeSeekUser,
        isVerifying: false
      });
      expect(notify).toHaveBeenCalledWith('账号状态已刷新');
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-PERF-019] keeps private reads active while a confirmed identity is checked', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });
    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('confirmed'));

    const privateResult = Promise.withResolvers<string>();
    const privateAbort = jest.fn();
    const privateRequest = appQueryClient
      .fetchQuery({
        queryKey: ['forum', 'nodeseek', 'feed', { settled: true }],
        queryFn: async ({ signal }) => {
          signal.addEventListener('abort', privateAbort, { once: true });
          return privateResult.promise;
        }
      })
      .catch(() => undefined);

    await act(async () => {
      hook.result.current.beginAccountIdentityCheck('nodeseek');
      await Promise.resolve();
    });
    expect(privateAbort).not.toHaveBeenCalled();
    privateResult.resolve('current private read');
    await privateRequest;
  });

  it('REG-ACCOUNT-001 keeps successful sites when one identity query fails', async () => {
    mockReadLinuxDoCookieHeader.mockResolvedValue('_t=safe');
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (source === 'nodeseek') throw new Error('NodeSeek offline');
      return linuxUser;
    });
    const readNodeSeekCookieHeader = jest.fn(async () => 'session=safe');
    const { hook, notify } = await renderStatusController({ readNodeSeekCookieHeader });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        status: 'logged-in',
        currentUser: linuxUser
      });
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        identityTrust: 'unknown',
        status: 'anonymous',
        lastError: 'NodeSeek offline'
      });
      expect(hook.result.current.accountSessionViewModels.yaohuo.status).toBe('anonymous');
    });
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：NodeSeek');
  });

  it('[REG-LINUXDO-005] keeps a cold-start Cookie candidate non-authenticated when identity is unknown', async () => {
    mockReadLinuxDoCookieHeader.mockResolvedValue('cf_clearance=verification; _t=stale-session');
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (source === 'linuxdo') throw new Error('linux.do 状态暂时无法确认');
      return null as never;
    });
    const states = createSiteSessionStates({
      linuxdo: {
        site: 'linuxdo',
        status: 'verified',
        cookieSummary: ['cf_clearance', '_t'],
        isVerifying: false
      }
    });
    const sessionViewModels = createSiteSessionViewModels(states);
    const { hook } = await renderStatusController({
      sessionViewModels: {
        ...sessionViewModels,
        linuxdo: {
          ...sessionViewModels.linuxdo,
          identityTrust: 'unknown',
          summaryLabel: '账号状态尚未核对'
        }
      }
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        identityTrust: 'unknown',
        status: 'verified',
        isLoggedIn: false,
        summaryLabel: '本次核对失败，可重试',
        lastError: 'linux.do 状态暂时无法确认'
      })
    );
  });

  it('[REG-LINUXDO-007] exposes a typed Account challenge without settling the identity barrier', async () => {
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (source === 'linuxdo') {
        throw Object.assign(new Error('linux.do 需要完成 Cloudflare 验证'), {
          source: 'linuxdo',
          kind: 'verification-required',
          reason: 'cloudflare',
          verificationRequired: true
        });
      }
      return null as never;
    });
    const { hook } = await renderStatusController();
    let result: Awaited<ReturnType<typeof hook.result.current.reconcileAccountStatus>> | undefined;

    await act(async () => {
      result = await hook.result.current.reconcileAccountStatus('linuxdo');
    });

    expect(result).toMatchObject({
      status: 'unknown',
      errorInfo: {
        kind: 'verification-required',
        verificationRequired: true
      }
    });
  });

  it('[REG-ACCOUNT-042] commits the linux.do current user to the stable snapshot in one response', async () => {
    mockReadLinuxDoCookieHeader.mockResolvedValue('cf_clearance=verification; _t=active-session');
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'linuxdo' ? linuxUser : (null as never)));
    const { hook } = await renderStatusController({ enabledSources: ['linuxdo'] });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        status: 'logged-in',
        currentUser: linuxUser,
        identityTrust: 'confirmed',
        canWrite: true
      })
    );
    expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'))).toMatchObject({
      currentUser: linuxUser,
      identityTrust: 'confirmed'
    });
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'linuxdo',
        discourseAuth: { linuxdo: { userAgent: 'safe-agent' } }
      })
    );
  });

  it('[REG-ACCOUNT-042] commits the changed snapshot before advancing the source scope', async () => {
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'nodeseek' ? nodeSeekUser : linuxUser));
    const committedSnapshots: AccountSessionSnapshot[] = [];
    const onAccountStatusChanged = jest.fn(() => {
      const snapshot = appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot('nodeseek'));
      if (snapshot) committedSnapshots.push(snapshot);
    });
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe'),
      onAccountStatusChanged
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nodeSeekUser)
    );

    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'nodeseek' ? nextNodeSeekUser : linuxUser));
    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });

    expect(onAccountStatusChanged).toHaveBeenCalledWith('nodeseek', undefined);
    expect(committedSnapshots.at(-1)).toMatchObject({ currentUser: nextNodeSeekUser, identityTrust: 'confirmed' });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nextNodeSeekUser)
    );
  });

  it('[REG-ACCOUNT-042] commits the canonical snapshot before reconciliation resolves', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const sourceFeedKey = forumQueryKeys.feed({
      feedFilter: 'postTime',
      scope: initialForumSessionEpochs,
      source: 'nodeseek'
    });
    const sourceCategoriesKey = forumQueryKeys.categories('nodeseek', initialForumSessionEpochs);
    const aggregateFeedKey = forumQueryKeys.feed({
      scope: initialForumSessionEpochs,
      source: 'all'
    });
    appQueryClient.setQueryData(sourceFeedKey, { private: true });
    appQueryClient.setQueryData(sourceCategoriesKey, { private: true });
    appQueryClient.setQueryData(aggregateFeedKey, { safe: true });
    const { hook, onAccountStatusChanged } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });

    const settled = await act(async () =>
      hook.result.current.reconcileAccountStatus('nodeseek').then((result) => ({
        result,
        snapshotAtResolution: appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot('nodeseek'))
      }))
    );

    expect(settled.result.status).toBe('same');
    expect(onAccountStatusChanged).not.toHaveBeenCalled();
    expect(appQueryClient.getQueryData(sourceFeedKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(sourceCategoriesKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(aggregateFeedKey)).toEqual({ safe: true });
    expect(settled.snapshotAtResolution).toMatchObject({
      status: 'logged-in',
      currentUser: nodeSeekUser,
      identityTrust: 'confirmed'
    });
  });

  it('[REG-ACCOUNT-035] rejects confirmed trust without a logged-in current user', async () => {
    appQueryClient.setQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot('nodeseek'), {
      site: 'nodeseek',
      status: 'anonymous',
      cookieSummary: [],
      isVerifying: false,
      identityTrust: 'confirmed'
    });
    const { hook } = await renderStatusController();

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'anonymous',
      identityTrust: 'unknown',
      canWrite: false
    });
    expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toBeUndefined();
  });

  it('[REG-ACCOUNT-035] rejects none trust paired with a logged-in current user', async () => {
    appQueryClient.setQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot('nodeseek'), {
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: ['session'],
      isVerifying: false,
      currentUser: nodeSeekUser,
      identityTrust: 'none'
    });
    const { hook } = await renderStatusController();

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'logged-in',
      currentUser: nodeSeekUser,
      identityTrust: 'unknown',
      canWrite: false
    });
  });

  it('[REG-ACCOUNT-035] makes an authoritative terminal identity win over a late probe', async () => {
    const identity = Promise.withResolvers<UserProfile>();
    mockGetCurrentUser.mockImplementationOnce(async () => identity.promise);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });
    let probe!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;

    await act(async () => {
      probe = hook.result.current.reconcileAccountStatus('nodeseek');
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalledTimes(1));
    await act(async () => {
      expect(hook.result.current.applyAccountSessionEvent({ site: 'nodeseek', type: 'cleared' })).toBe(true);
      identity.resolve(nodeSeekUser);
      await probe;
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'anonymous',
        identityTrust: 'none'
      })
    );
  });

  it('[REG-SOURCE-010] ignores authoritative terminal commits after a source is disabled', async () => {
    const { hook } = await renderStatusController({ enabledSources: [] });

    expect(hook.result.current.applyAccountSessionEvent({ site: 'nodeseek', type: 'cleared' })).toBe(false);
    expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('unknown');
  });

  it('[REG-ACCOUNT-035] clears the prior probe error when authoritative identity settles', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(new Error('offline before clear'));
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });

    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek.lastError).toBe('offline before clear')
    );

    await act(async () => {
      hook.result.current.applyAccountSessionEvent({ site: 'nodeseek', type: 'cleared' });
    });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek.lastError).toBeUndefined());
  });

  it('[REG-ACCOUNT-035] keeps the confirmed identity while a closing-surface check runs or fails', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(nodeSeekUser);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });
    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('confirmed'));

    await act(async () => {
      hook.result.current.beginAccountIdentityCheck('nodeseek', 7);
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        identityTrust: 'confirmed',
        isVerifying: true
      })
    );

    const closingIdentity = Promise.withResolvers<UserProfile>();
    mockGetCurrentUser.mockImplementationOnce(async () => closingIdentity.promise);
    let closingProbe!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;
    await act(async () => {
      closingProbe = hook.result.current.reconcileAccountStatus('nodeseek', { surfaceGeneration: 7 });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        identityTrust: 'confirmed',
        isVerifying: true
      })
    );

    await act(async () => {
      closingIdentity.reject(new Error('offline after surface close'));
      await closingProbe;
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        identityTrust: 'confirmed',
        isVerifying: false
      })
    );
  });

  it('[REG-ACCOUNT-035] releases stale verification workflow state after canonical identity settles', async () => {
    appQueryClient.setQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot('nodeseek'), {
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: [],
      isVerifying: false,
      currentUser: nodeSeekUser,
      identityTrust: 'unknown',
      lastError: '旧验证流程'
    });

    mockGetCurrentUser.mockResolvedValueOnce(nodeSeekUser);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });
    expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('unknown');

    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'logged-in',
        identityTrust: 'confirmed',
        currentUser: nodeSeekUser
      })
    );
  });

  it('[REG-PERF-019] keeps the last confirmed identity trusted while a manual check is running or fails', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(nodeSeekUser);
    const onAccountStatusChanged = jest.fn();
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe'),
      onAccountStatusChanged
    });
    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('confirmed'));
    onAccountStatusChanged.mockClear();

    const failedIdentity = Promise.withResolvers<UserProfile>();
    mockGetCurrentUser.mockImplementationOnce(async () => failedIdentity.promise);
    let failedProbe!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;
    await act(async () => {
      failedProbe = hook.result.current.reconcileAccountStatus('nodeseek');
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        identityTrust: 'confirmed',
        canWrite: true,
        isVerifying: true
      })
    );

    await act(async () => {
      failedIdentity.reject(new Error('offline'));
      await failedProbe;
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        identityTrust: 'confirmed',
        canWrite: true,
        lastError: 'offline'
      })
    );
    expect(onAccountStatusChanged).not.toHaveBeenCalled();

    const retryIdentity = Promise.withResolvers<UserProfile>();
    mockGetCurrentUser.mockImplementationOnce(async () => retryIdentity.promise);
    let retry!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;
    await act(async () => {
      retry = hook.result.current.reconcileAccountStatus('nodeseek');
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        identityTrust: 'confirmed',
        canWrite: true,
        isVerifying: true
      })
    );

    await act(async () => {
      retryIdentity.resolve(nodeSeekUser);
      await retry;
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        identityTrust: 'confirmed',
        canWrite: true
      })
    );
  });

  it('[REG-ACCOUNT-031] reports an explicitly confirmed anonymous session without changing scope', async () => {
    mockGetCurrentUser.mockRejectedValue(
      Object.assign(new Error('未登录'), {
        loginRequired: true,
        reason: 'expired',
        source: 'nodeseek'
      })
    );
    const { hook, onAccountStatusChanged } = await renderStatusController({
      readManagedCookieHeader: jest.fn(async () => ({ status: 'ok' as const, header: '' }))
    });
    let result: Awaited<ReturnType<typeof hook.result.current.reconcileAccountStatus>> | undefined;

    await act(async () => {
      result = await hook.result.current.reconcileAccountStatus('nodeseek');
    });

    expect(result).toMatchObject({ status: 'anonymous' });
    expect(onAccountStatusChanged).not.toHaveBeenCalled();
  });

  it('[REG-PERF-019] does not publish an anonymous result detected inside an open login surface', async () => {
    mockGetCurrentUser.mockRejectedValue(
      Object.assign(new Error('未登录'), { loginRequired: true, reason: 'expired', source: 'nodeseek' })
    );
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session'],
          isVerifying: false,
          currentUser: nodeSeekUser
        }
      })
    );
    const { hook, onAccountStatusChanged } = await renderStatusController({
      readManagedCookieHeader: jest.fn(async () => ({ status: 'ok' as const, header: '' })),
      sessionViewModels: sessions
    });

    await expect(
      hook.result.current.reconcileAccountStatus('nodeseek', { publishAnonymous: false })
    ).resolves.toMatchObject({ status: 'anonymous' });

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      currentUser: nodeSeekUser,
      identityTrust: 'confirmed'
    });
    expect(onAccountStatusChanged).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('account-session.v1.nodeseek')).toBeNull();
  });

  it('[REG-ACCOUNT-026] lets the linux.do current-session response decide identity when a candidate cookie has no _t', async () => {
    const readManagedCookieHeader = jest.fn(async () => ({
      status: 'ok' as const,
      header: '_forum_session=current-session'
    }));
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'linuxdo' ? linuxUser : (null as never)));
    const { hook } = await renderStatusController({ readManagedCookieHeader });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        status: 'logged-in',
        currentUser: linuxUser
      })
    );
    expect(readManagedCookieHeader).toHaveBeenCalledWith('https://linux.do/session/current.json');
    expect(mockGetCurrentUser).toHaveBeenCalledWith(
      expect.not.objectContaining({
        cookieHeader: expect.anything()
      })
    );
  });

  it('REG-ACCOUNT-002 isolates an exact CookieManager read failure from the other sites', async () => {
    const { hook, notify } = await renderStatusController({
      readManagedCookieHeader: jest.fn(async (exactUrl: string) =>
        exactUrl.includes('yaohuo.me')
          ? { status: 'error' as const, message: 'CookieManager unavailable' }
          : { status: 'ok' as const, header: '' }
      )
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.yaohuo.lastError).toBe('CookieManager unavailable');
      expect(hook.result.current.accountSessionViewModels.nodeseek.status).toBe('anonymous');
    });
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：妖火');
  });

  it('[REG-ACCOUNT-026] projects a confirmed Yaohuo logout as anonymous without invoking a clear command', async () => {
    mockReadYaohuoCookieHeader.mockResolvedValueOnce('sid=safe');
    mockCheckYaohuoLogin.mockResolvedValueOnce({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      loginUrl: 'https://www.yaohuo.me/login.aspx',
      message: 'expired',
      reason: 'expired'
    });
    const { hook, notify } = await renderStatusController();

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.yaohuo).toMatchObject({
        status: 'anonymous',
        isLoggedIn: false
      })
    );
    expect(notify).toHaveBeenCalledWith('账号状态已刷新');
  });

  it('REG-ACCOUNT-008 never forwards an exact CookieManager header into the Account verifier', async () => {
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'nodeseek' ? nodeSeekUser : linuxUser));
    const readNodeSeekCookieHeader = jest.fn(async () => 'session=safe');
    const { hook, notify } = await renderStatusController({
      readNodeSeekCookieHeader
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'logged-in',
        currentUser: nodeSeekUser
      })
    );
    expect(mockGetCurrentUser).toHaveBeenCalledWith(
      expect.not.objectContaining({
        nodeSeekCookie: expect.anything()
      })
    );
    expect(notify).toHaveBeenCalledWith('账号状态已刷新');
  });

  it('[REG-ACCOUNT-026] lets the NodeSeek current-session response decide identity when the candidate has no known login cookie name', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const readNodeSeekCookieHeader = jest.fn(async () => 'cf_clearance=current-verification');
    const { hook } = await renderStatusController({ readNodeSeekCookieHeader });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'logged-in',
        currentUser: nodeSeekUser
      })
    );
    expect(mockGetCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek'
      })
    );
    expect(mockGetCurrentUser).not.toHaveBeenCalledWith(
      expect.objectContaining({
        nodeSeekCookie: expect.any(String)
      })
    );
  });

  it('[REG-ACCOUNT-026] projects a confirmed NodeSeek logout without deleting login cookies', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(
      Object.assign(new Error('NodeSeek 登录已失效'), {
        source: 'nodeseek',
        kind: 'login-expired',
        loginRequired: true,
        reason: 'expired'
      })
    );
    const readNodeSeekCookieHeader = jest.fn(async () => 'session=expired');
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'verified',
        isLoggedIn: false
      })
    );
  });

  it('[REG-ACCOUNT-026] cannot invoke a failing NodeSeek logout command during status refresh', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(
      Object.assign(new Error('NodeSeek 登录已失效'), {
        source: 'nodeseek',
        kind: 'login-expired',
        loginRequired: true,
        reason: 'expired'
      })
    );
    const { hook, notify } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=expired')
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'verified',
        isLoggedIn: false
      })
    );
    expect(notify).toHaveBeenLastCalledWith('账号状态已刷新');
  });

  it('[REG-ACCOUNT-026] keeps confirmed logout detection separate from Cookie deletion', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(
      Object.assign(new Error('NodeSeek 登录已失效'), {
        source: 'nodeseek',
        kind: 'login-expired',
        loginRequired: true,
        reason: 'expired'
      })
    );
    const states = createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: ['session'],
        isVerifying: false,
        currentUser: nodeSeekUser
      }
    });
    const { hook, notify } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=expired'),
      sessionViewModels: createSiteSessionViewModels(states)
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'verified',
        isLoggedIn: false
      })
    );
    expect(notify).toHaveBeenLastCalledWith('账号状态已刷新');
  });

  it('REG-ACCOUNT-008 projects a linux.do anonymous response without mutating workflow state', async () => {
    mockReadLinuxDoCookieHeader.mockResolvedValue('_t=safe');
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (source === 'linuxdo') {
        throw Object.assign(new Error('会话已失效'), {
          source: 'linuxdo',
          kind: 'login-expired',
          loginRequired: true,
          reason: 'expired'
        });
      }
      return null as never;
    });
    const { hook } = await renderStatusController();

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        status: 'anonymous',
        isLoggedIn: false
      })
    );
  });

  it('[REG-ACCOUNT-031] drops a superseded surface probe before it can send or commit stale identity', async () => {
    const firstCookieRead = Promise.withResolvers<{ status: 'ok'; header: string }>();
    const readManagedCookieHeader = jest
      .fn<ReadManagedCookieHeader>()
      .mockImplementationOnce(async () => firstCookieRead.promise)
      .mockResolvedValue({ status: 'ok', header: 'session=current' });
    mockGetCurrentUser.mockResolvedValue(nextNodeSeekUser);
    const { hook, onAccountStatusChanged } = await renderStatusController({ readManagedCookieHeader });
    let staleProbe!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;

    await act(async () => {
      staleProbe = hook.result.current.reconcileAccountStatus('nodeseek', { surfaceGeneration: 1 });
      await Promise.resolve();
    });
    await waitFor(() => expect(readManagedCookieHeader).toHaveBeenCalledTimes(1));

    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek', { surfaceGeneration: 2 });
      firstCookieRead.resolve({ status: 'ok', header: 'session=stale' });
      await staleProbe;
    });

    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(onAccountStatusChanged).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nextNodeSeekUser)
    );
  });

  it('[REG-ACCOUNT-031] invalidates a closing probe when a newer login surface opens', async () => {
    const firstCookieRead = Promise.withResolvers<{ status: 'ok'; header: string }>();
    const readManagedCookieHeader = jest
      .fn<ReadManagedCookieHeader>()
      .mockImplementationOnce(async () => firstCookieRead.promise);
    mockGetCurrentUser.mockResolvedValue(nextNodeSeekUser);
    const { hook, onAccountStatusChanged } = await renderStatusController({ readManagedCookieHeader });
    let closingProbe!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;

    await act(async () => {
      closingProbe = hook.result.current.reconcileAccountStatus('nodeseek', {
        surfaceGeneration: 1
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(readManagedCookieHeader).toHaveBeenCalledTimes(1));

    await act(async () => {
      hook.result.current.beginAccountIdentityCheck('nodeseek', 2);
      firstCookieRead.resolve({ status: 'ok', header: 'session=stale' });
      await closingProbe;
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(onAccountStatusChanged).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        identityTrust: 'unknown',
        isVerifying: true
      })
    );
  });

  it('[REG-ACCOUNT-031] deduplicates concurrent reconciliation for the same source', async () => {
    const storedCookie = Promise.withResolvers<string | undefined>();
    const readNodeSeekCookieHeader = jest.fn(async () => storedCookie.promise);
    const { hook } = await renderStatusController({ readNodeSeekCookieHeader });
    let first!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;

    await act(async () => {
      first = hook.result.current.reconcileAccountStatus('nodeseek');
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.statusBusy).toBe(true));
    let second!: ReturnType<typeof hook.result.current.reconcileAccountStatus>;
    await act(async () => {
      second = hook.result.current.reconcileAccountStatus('nodeseek');
      await Promise.resolve();
    });
    expect(readNodeSeekCookieHeader).toHaveBeenCalledTimes(1);

    await act(async () => {
      storedCookie.resolve(undefined);
      await Promise.all([first, second]);
    });
  });

  it('[REG-ACCOUNT-042] keeps the Account snapshot stable when only the forum epoch changes', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'logged-in',
        currentUser: nodeSeekUser
      })
    );

    await act(async () => {
      hook.rerender({
        renderedSessionEpochs: { ...initialForumSessionEpochs, nodeseek: 2 }
      });
      await Promise.resolve();
    });

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'logged-in',
      isLoggedIn: true,
      currentUser: nodeSeekUser,
      identityTrust: 'confirmed'
    });
  });

  it('[REG-ACCOUNT-020] hydrates a verified Yaohuo self id before projecting the account', async () => {
    const readManagedCookieHeader = jest.fn(async () => ({
      status: 'ok' as const,
      header: 'sidyaohuo=safe'
    }));
    mockCheckYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: true,
      loginRequired: false,
      loginUrl: '',
      message: undefined,
      reason: undefined,
      currentUser: {
        source: 'yaohuo',
        id: '31',
        username: '31',
        url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=31',
        topics: []
      }
    });
    const fetcher = jest.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=31&siteid=1000') {
        return new Response('<div class="content">昵称:dave</div>');
      }
      throw new Error(`unexpected ${input}`);
    });
    const { hook } = await renderStatusController({ fetcher, readManagedCookieHeader });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.yaohuo.currentUser).toMatchObject({
        source: 'yaohuo',
        id: '31',
        username: 'dave',
        url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=31',
        topics: []
      })
    );
    expect(readManagedCookieHeader).toHaveBeenCalledWith('https://www.yaohuo.me/wapindex.aspx?sid=-2');
    expect(mockCheckYaohuoLogin).toHaveBeenCalledWith(
      expect.not.objectContaining({
        yaohuoCookie: expect.anything()
      })
    );
    expect(mockGetCurrentUser).not.toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yaohuo'
      })
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=31&siteid=1000',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('[REG-ACCOUNT-025] keeps a verified Yaohuo identity when optional profile enrichment fails', async () => {
    mockReadYaohuoCookieHeader.mockResolvedValue('sidyaohuo=safe');
    mockCheckYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: true,
      loginRequired: false,
      loginUrl: '',
      message: undefined,
      reason: undefined,
      currentUser: {
        source: 'yaohuo',
        id: '31',
        username: '31',
        url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=31',
        topics: []
      }
    });
    const fetcher = jest.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=31&siteid=1000') {
        return new Response('profile unavailable', { status: 503 });
      }
      throw new Error(`unexpected ${input}`);
    });
    const { hook, notify } = await renderStatusController({ fetcher });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.yaohuo).toMatchObject({
        status: 'logged-in',
        currentUser: {
          source: 'yaohuo',
          id: '31',
          username: '31'
        },
        lastError: 'HTTP 503'
      })
    );
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：妖火');
  });

  it('[REG-ACCOUNT-019] preserves each site last confirmed identity on ordinary refresh failures', async () => {
    let failing = false;
    mockReadYaohuoCookieHeader.mockResolvedValue('sid=safe');
    mockReadLinuxDoCookieHeader.mockResolvedValue('_t=safe');
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (failing && source === 'nodeseek') throw new Error('NodeSeek offline');
      if (failing && source === 'linuxdo') throw new Error('linux.do offline');
      return source === 'nodeseek' ? nodeSeekUser : linuxUser;
    });
    mockCheckYaohuoLogin.mockImplementation(async () => {
      if (failing)
        return {
          source: 'yaohuo',
          ok: false,
          loginRequired: false,
          loginUrl: '',
          message: '妖火状态暂时无法确认。',
          reason: 'unknown'
        };
      return {
        source: 'yaohuo',
        ok: true,
        loginRequired: false,
        loginUrl: '',
        message: undefined,
        reason: undefined,
        currentUser: yaohuoUser
      };
    });
    const { hook, notify } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nodeSeekUser);
      expect(hook.result.current.accountSessionViewModels.linuxdo.currentUser).toEqual(linuxUser);
      expect(hook.result.current.accountSessionViewModels.yaohuo.currentUser).toEqual(yaohuoUser);
    });

    failing = true;
    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        currentUser: nodeSeekUser,
        status: 'logged-in',
        lastError: 'NodeSeek offline'
      });
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        currentUser: linuxUser,
        status: 'logged-in',
        lastError: 'linux.do offline'
      });
      expect(hook.result.current.accountSessionViewModels.yaohuo).toMatchObject({
        currentUser: yaohuoUser,
        status: 'logged-in',
        lastError: '妖火状态暂时无法确认。'
      });
    });
    expect(notify).toHaveBeenLastCalledWith('账号状态部分刷新失败：NodeSeek、linux.do、妖火');
  });

  it('[REG-ACCOUNT-024] never clears NodeSeek login cookies for an ordinary HTTP 404', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(
      Object.assign(new Error('HTTP 404'), {
        status: 404
      })
    );
    const states = createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: ['session'],
        isVerifying: false,
        currentUser: nodeSeekUser
      }
    });
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=current'),
      sessionViewModels: createSiteSessionViewModels(states)
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'logged-in',
        currentUser: nodeSeekUser,
        lastError: 'HTTP 404'
      })
    );
  });
});
