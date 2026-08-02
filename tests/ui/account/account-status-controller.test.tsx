import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

jest.mock('@/sources/readGateway', () => ({
  checkYaohuoLogin: jest.fn(),
  getCurrentUserProfile: jest.fn(),
  getUserProfile: jest.fn()
}));

import { checkYaohuoLogin, getCurrentUserProfile, getUserProfile } from '@/sources/readGateway';
import { useAccountStatusController } from '@/features/account/useAccountStatusController';
import { useIdentityVerificationPrompt } from '@/ui/hooks/useIdentityVerificationPrompt';
import type { XiaoyinsiAuthorizationReadResult } from '@/domain/session/accountCenter';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { commitChangedAccountStatusQuery } from '@/features/account/sessionControllerHelpers';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { UserProfile } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';

const mockCheckYaohuoLogin = jest.mocked(checkYaohuoLogin);
const mockGetCurrentUser = jest.mocked(getCurrentUserProfile);
const mockGetUserProfile = jest.mocked(getUserProfile);
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

const xiaoyinsiUser: UserProfile = {
  source: 'xiaoyinsi',
  id: '23',
  username: 'carol',
  url: 'https://forum.xiaoyinsi.com/u/carol',
  topics: []
};

type ReadXiaoyinsiAuthorization = (
  trace?: Parameters<Parameters<typeof useAccountStatusController>[0]['readXiaoyinsiAuthorization']>[0],
  options?: { signal?: AbortSignal }
) => Promise<XiaoyinsiAuthorizationReadResult>;
type AccountStatusChanged = Parameters<typeof useAccountStatusController>[0]['onAccountStatusChanged'];
type ReadManagedCookieHeader = NonNullable<Parameters<typeof useAccountStatusController>[0]['readManagedCookieHeader']>;

type StatusTestOptions = {
  readNodeSeekCookieHeader?: () => Promise<string | undefined>;
};

async function renderStatusController({
  sessionEpochs = initialForumSessionEpochs,
  readNodeSeekCookieHeader = jest.fn(async () => undefined),
  notify = jest.fn(),
  onAccountStatusChanged = jest.fn(),
  onAccountIdentityRuntimeChanged = jest.fn(),
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
  readXiaoyinsiAuthorization = jest.fn(async () => ({
    authenticated: false,
    sessionEvent: {
      type: 'cookie-loaded' as const,
      loggedIn: false,
      currentUser: null,
      at: '2026-07-20T00:00:00.000Z'
    }
  })),
  sessionViewModels = createSiteSessionViewModels(createSiteSessionStates())
}: Partial<Parameters<typeof useAccountStatusController>[0]> & StatusTestOptions = {}) {
  const hook = await renderNativeHook(
    ({ renderedSessionEpochs }: { renderedSessionEpochs: ForumSessionEpochs }) => {
      const [effectiveSessionEpochs, setEffectiveSessionEpochs] = useState(renderedSessionEpochs);
      const effectiveSessionEpochsRef = useRef(renderedSessionEpochs);
      const externalSessionEpochsRef = useRef(renderedSessionEpochs);
      useEffect(() => {
        if (externalSessionEpochsRef.current === renderedSessionEpochs) {
          return;
        }
        externalSessionEpochsRef.current = renderedSessionEpochs;
        effectiveSessionEpochsRef.current = renderedSessionEpochs;
        setEffectiveSessionEpochs(renderedSessionEpochs);
      }, [renderedSessionEpochs]);
      const commitAccountStatusChange = useCallback<AccountStatusChanged>((source, recoveryQueryKey, session) => {
        onAccountStatusChanged(source, recoveryQueryKey, session);
        const nextScope = commitChangedAccountStatusQuery(
          source,
          effectiveSessionEpochsRef.current,
          recoveryQueryKey,
          appQueryClient
        );
        effectiveSessionEpochsRef.current = nextScope;
        setEffectiveSessionEpochs(nextScope);
      }, []);
      return useAccountStatusController({
        sessionEpochs: effectiveSessionEpochs,
        fetcher: jest.fn(async () => new Response('{}')),
        linuxDoUserAgentRef: { current: 'safe-agent' },
        nodeSeekUserAgentRef: { current: 'safe-agent' },
        notify,
        onAccountStatusChanged: commitAccountStatusChange,
        onAccountIdentityRuntimeChanged,
        readManagedCookieHeader,
        readXiaoyinsiAuthorization,
        sessionViewModels
      });
    },
    {
      initialProps: { renderedSessionEpochs: sessionEpochs },
      wrapper: QueryTestWrapper
    }
  );
  return {
    hook,
    notify,
    onAccountIdentityRuntimeChanged,
    onAccountStatusChanged,
    readXiaoyinsiAuthorization
  };
}

describe('account status queries', () => {
  beforeEach(() => {
    appQueryClient.clear();
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
    mockGetUserProfile.mockResolvedValue(yaohuoUser);
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
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
        (session) => session.identityTrust === 'pending'
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

  it('[REG-FEED-011] keeps aggregate identity bootstrap pending until all four probes settle', async () => {
    const firstNodeSeekCookie = Promise.withResolvers<string | undefined>();
    const secondNodeSeekCookie = Promise.withResolvers<string | undefined>();
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest
        .fn<() => Promise<string | undefined>>()
        .mockImplementationOnce(async () => firstNodeSeekCookie.promise)
        .mockImplementationOnce(async () => secondNodeSeekCookie.promise)
    });
    expect(hook.result.current.identityReconciliationPending).toBe(true);
    let refresh!: ReturnType<typeof hook.result.current.refreshAccountStatus>;

    await act(async () => {
      refresh = hook.result.current.refreshAccountStatus({ silent: true });
      await Promise.resolve();
    });

    expect(hook.result.current.identityReconciliationPending).toBe(true);
    firstNodeSeekCookie.resolve(undefined);
    await act(async () => {
      await refresh;
    });
    expect(hook.result.current.identityReconciliationPending).toBe(false);

    await act(async () => {
      refresh = hook.result.current.refreshAccountStatus({ silent: true });
      await Promise.resolve();
    });
    expect(hook.result.current.identityReconciliationPending).toBe(true);
    secondNodeSeekCookie.resolve(undefined);
    await act(async () => {
      await refresh;
    });
    expect(hook.result.current.identityReconciliationPending).toBe(false);
  });

  it('[REG-FEED-010] still cancels private reads when a confirmed source later becomes pending', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });
    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });
    expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('confirmed');

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
    await waitFor(() => expect(privateAbort).toHaveBeenCalledTimes(1));
    privateResult.resolve('stale private read');
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
    const { hook } = await renderStatusController({
      sessionViewModels: createSiteSessionViewModels(states)
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        status: 'verified',
        isLoggedIn: false,
        lastError: 'linux.do 状态暂时无法确认'
      })
    );
    expect(hook.result.current.accountIdentityChecks.linuxdo).toEqual({
      checking: false,
      pending: true,
      error: {
        kind: 'ordinary',
        message: 'linux.do 状态暂时无法确认'
      }
    });
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
    expect(hook.result.current.accountIdentityChecks.linuxdo).toMatchObject({
      checking: false,
      pending: true,
      error: {
        kind: 'verification-required',
        verificationRequired: true
      }
    });
  });

  it('[REG-ACCOUNT-019] projects the linux.do current user from one authoritative session response', async () => {
    mockReadLinuxDoCookieHeader.mockResolvedValue('cf_clearance=verification; _t=active-session');
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'linuxdo' ? linuxUser : (null as never)));
    const { hook } = await renderStatusController();

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        status: 'logged-in',
        currentUser: linuxUser
      })
    );
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(2);
    expect(mockGetCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'linuxdo',
        discourseAuth: { linuxdo: { userAgent: 'safe-agent' } }
      })
    );
  });

  it('[REG-ACCOUNT-031] stages a changed identity until the source scope transaction commits it', async () => {
    mockGetCurrentUser.mockImplementation(async ({ source }) => (source === 'nodeseek' ? nodeSeekUser : linuxUser));
    const onAccountStatusChanged = jest.fn();
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

    expect(onAccountStatusChanged).toHaveBeenCalledWith(
      'nodeseek',
      expect.any(Array),
      expect.objectContaining({ currentUser: nextNodeSeekUser, status: 'logged-in' })
    );
    expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nextNodeSeekUser);
  });

  it('[REG-ACCOUNT-035] commits the runtime identity before reconciliation resolves', async () => {
    const runtime = {
      identityKey: 'nodeseek:anonymous',
      pending: false
    };
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const onAccountIdentityRuntimeChanged = jest.fn(
      (
        _source: 'nodeseek' | 'linuxdo' | 'yaohuo' | 'xiaoyinsi',
        update: { identityKey?: string; pending: boolean }
      ) => {
        runtime.pending = update.pending;
        if (update.identityKey) {
          runtime.identityKey = update.identityKey;
        }
      }
    );
    const sourceFeedKey = forumQueryKeys.feed({
      feedFilter: 'postTime',
      scope: initialForumSessionEpochs,
      source: 'nodeseek'
    });
    const sourceCategoriesKey = forumQueryKeys.categories('nodeseek', initialForumSessionEpochs);
    const aggregateFeedKey = forumQueryKeys.feed({
      identityBarriers: ['nodeseek'],
      scope: initialForumSessionEpochs,
      source: 'all'
    });
    appQueryClient.setQueryData(sourceFeedKey, { private: true });
    appQueryClient.setQueryData(sourceCategoriesKey, { private: true });
    appQueryClient.setQueryData(aggregateFeedKey, { safe: true });
    const { hook, onAccountStatusChanged } = await renderStatusController({
      onAccountIdentityRuntimeChanged,
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe')
    });

    const settled = await act(async () =>
      hook.result.current.reconcileAccountStatus('nodeseek').then((result) => ({
        result,
        runtimeAtResolution: { ...runtime }
      }))
    );

    expect(settled.result.status).toBe('same');
    expect(onAccountStatusChanged).not.toHaveBeenCalled();
    expect(appQueryClient.getQueryData(sourceFeedKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(sourceCategoriesKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(aggregateFeedKey)).toEqual({ safe: true });
    expect(settled.runtimeAtResolution).toEqual({
      identityKey: 'nodeseek:17',
      pending: false
    });
    expect(onAccountIdentityRuntimeChanged).toHaveBeenNthCalledWith(1, 'nodeseek', { pending: true });
    expect(onAccountIdentityRuntimeChanged).toHaveBeenLastCalledWith('nodeseek', {
      identityKey: 'nodeseek:17',
      pending: false
    });
  });

  it('[REG-ACCOUNT-035] releases stale verification workflow state after canonical identity settles', async () => {
    appQueryClient.setQueryData(
      forumQueryKeys.accountStatus({
        sessionEpochs: initialForumSessionEpochs,
        source: 'nodeseek'
      }),
      {
        session: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: [],
          isVerifying: false,
          currentUser: nodeSeekUser
        }
      }
    );
    const workflowStates = createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'verification-required',
        cookieSummary: [],
        isVerifying: false,
        lastError: '旧验证流程'
      }
    });

    mockGetCurrentUser.mockResolvedValueOnce(nodeSeekUser);
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe'),
      sessionViewModels: createSiteSessionViewModels(workflowStates)
    });
    expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('pending');

    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'logged-in',
      identityTrust: 'confirmed',
      currentUser: nodeSeekUser
    });
  });

  it('[REG-ACCOUNT-031] keeps the last confirmed identity read-only while a surface is open or reconciliation is unknown', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(nodeSeekUser);
    const onAccountStatusChanged = jest.fn();
    const { hook } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe'),
      onAccountStatusChanged
    });
    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    onAccountStatusChanged.mockClear();

    await act(async () => {
      hook.result.current.beginAccountIdentityCheck('nodeseek');
    });
    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      currentUser: nodeSeekUser,
      identityTrust: 'pending',
      canWrite: false
    });

    mockGetCurrentUser.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      currentUser: nodeSeekUser,
      identityTrust: 'pending',
      canWrite: false,
      lastError: 'offline'
    });
    expect(onAccountStatusChanged).not.toHaveBeenCalled();

    mockGetCurrentUser.mockResolvedValueOnce(nodeSeekUser);
    await act(async () => {
      await hook.result.current.reconcileAccountStatus('nodeseek');
    });

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      currentUser: nodeSeekUser,
      identityTrust: 'confirmed',
      canWrite: true
    });
  });

  it('[REG-ACCOUNT-031] treats anonymous to anonymous reconciliation as unchanged', async () => {
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

    expect(result).toMatchObject({ status: 'same' });
    expect(onAccountStatusChanged).not.toHaveBeenCalled();
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
    const { hook, notify, readXiaoyinsiAuthorization } = await renderStatusController({
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
    expect(readXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
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
    const { hook, notify, readXiaoyinsiAuthorization } = await renderStatusController({
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
    expect(readXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
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
    expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nextNodeSeekUser);
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
    expect(hook.result.current.accountSessionViewModels.nodeseek.identityTrust).toBe('pending');
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

  it('[REG-ACCOUNT-016] derives the Xiaoyinsi account view from Query data instead of the workflow session', async () => {
    const states = createSiteSessionStates({
      xiaoyinsi: {
        site: 'xiaoyinsi',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: xiaoyinsiUser
      }
    });
    const readXiaoyinsiAuthorization = jest.fn(async () => ({
      authenticated: false,
      sessionEvent: {
        type: 'cookie-loaded' as const,
        loggedIn: false,
        currentUser: null,
        at: '2026-07-20T00:00:00.000Z'
      }
    }));
    const { hook } = await renderStatusController({
      readXiaoyinsiAuthorization,
      sessionViewModels: createSiteSessionViewModels(states)
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.xiaoyinsi.status).toBe('anonymous'));
    expect(hook.result.current.accountSessionViewModels.xiaoyinsi.currentUser).toBeUndefined();
    expect(readXiaoyinsiAuthorization).toHaveBeenCalledWith(expect.any(Object), {
      signal: expect.any(Object)
    });
  });

  it('[REG-ACCOUNT-019] does not clear an independently confirmed source during Xiaoyinsi logout', async () => {
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (source === 'linuxdo') {
        throw Object.assign(new Error('未登录'), {
          source: 'linuxdo',
          kind: 'login-expired',
          loginRequired: true,
          reason: 'expired'
        });
      }
      return null as never;
    });
    const xiaoyinsiFeedKey = ['forum', 'xiaoyinsi', 'feed'] as const;
    const allFeedKey = ['forum', 'all', 'feed'] as const;
    const linuxDoFeedKey = ['forum', 'linuxdo', 'feed'] as const;
    appQueryClient.setQueryData(xiaoyinsiFeedKey, { private: true });
    appQueryClient.setQueryData(allFeedKey, { mixed: true });
    appQueryClient.setQueryData(linuxDoFeedKey, { untouched: true });
    appQueryClient.setQueryData(
      forumQueryKeys.accountStatus({
        sessionEpochs: initialForumSessionEpochs,
        source: 'linuxdo'
      }),
      {
        session: createSiteSessionStates().linuxdo
      }
    );
    const states = createSiteSessionStates({
      xiaoyinsi: {
        site: 'xiaoyinsi',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: xiaoyinsiUser
      }
    });
    const { hook } = await renderStatusController({
      readXiaoyinsiAuthorization: jest.fn(async () => ({
        authenticated: false,
        sessionEvent: { type: 'login-expired' as const, message: '小隐寺授权已失效' }
      })),
      sessionViewModels: createSiteSessionViewModels(states)
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
        status: 'anonymous',
        isLoggedIn: false
      })
    );
    expect(appQueryClient.getQueryData(xiaoyinsiFeedKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(allFeedKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(linuxDoFeedKey)).toEqual({ untouched: true });
  });

  it('[REG-ACCOUNT-016] projects an unauthenticated Xiaoyinsi Account result without workflow mutation', async () => {
    const { hook } = await renderStatusController({
      readXiaoyinsiAuthorization: jest.fn(async () => ({
        authenticated: false,
        sessionEvent: { type: 'login-expired' as const, message: '小隐寺授权已失效' }
      }))
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
      status: 'anonymous',
      isLoggedIn: false
    });
  });

  it('[REG-ACCOUNT-019] does not carry an old logged-in Account result into an ordinary new credential scope', async () => {
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
      status: 'anonymous',
      isLoggedIn: false
    });
    expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toBeUndefined();
  });

  it('[REG-ACCOUNT-017] preserves the last confirmed Xiaoyinsi identity when refresh fails', async () => {
    const readXiaoyinsiAuthorization = jest
      .fn<ReadXiaoyinsiAuthorization>()
      .mockResolvedValueOnce({
        authenticated: true,
        sessionEvent: {
          type: 'cookie-loaded' as const,
          loggedIn: true,
          currentUser: xiaoyinsiUser,
          at: '2026-07-20T00:00:00.000Z'
        }
      })
      .mockResolvedValueOnce({
        authenticated: null,
        sessionEvent: {
          type: 'check-failed' as const,
          message: '小隐寺状态暂时无法确认',
          at: '2026-07-20T00:01:00.000Z'
        }
      });
    const { hook, notify } = await renderStatusController({ readXiaoyinsiAuthorization });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
        status: 'logged-in',
        currentUser: xiaoyinsiUser
      })
    );

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() =>
      expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
        status: 'logged-in',
        currentUser: xiaoyinsiUser,
        lastError: '小隐寺状态暂时无法确认'
      })
    );
    expect(notify).toHaveBeenLastCalledWith('账号状态部分刷新失败：小隐寺');
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
    const { hook } = await renderStatusController({ readManagedCookieHeader });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.yaohuo.currentUser).toEqual(yaohuoUser));
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
    expect(mockGetUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yaohuo',
        id: '31'
      })
    );
    expect(mockGetUserProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({
        yaohuoCookie: expect.anything()
      })
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
    mockGetUserProfile.mockRejectedValue(new Error('profile unavailable'));
    const { hook, notify } = await renderStatusController();

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
        lastError: 'profile unavailable'
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
    const readXiaoyinsiAuthorization = jest.fn<ReadXiaoyinsiAuthorization>(async () =>
      failing
        ? {
            authenticated: null,
            sessionEvent: { type: 'check-failed', message: '小隐寺 offline' }
          }
        : {
            authenticated: true,
            sessionEvent: {
              type: 'cookie-loaded',
              loggedIn: true,
              currentUser: xiaoyinsiUser,
              at: '2026-07-20T00:00:00.000Z'
            }
          }
    );
    const { hook, notify } = await renderStatusController({
      readNodeSeekCookieHeader: jest.fn(async () => 'session=safe'),
      readXiaoyinsiAuthorization
    });

    await act(async () => {
      await hook.result.current.refreshAccountStatus();
    });
    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nodeSeekUser);
      expect(hook.result.current.accountSessionViewModels.linuxdo.currentUser).toEqual(linuxUser);
      expect(hook.result.current.accountSessionViewModels.yaohuo.currentUser).toEqual(yaohuoUser);
      expect(hook.result.current.accountSessionViewModels.xiaoyinsi.currentUser).toEqual(xiaoyinsiUser);
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
      expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
        currentUser: xiaoyinsiUser,
        status: 'logged-in',
        lastError: '小隐寺 offline'
      });
    });
    expect(notify).toHaveBeenLastCalledWith('账号状态部分刷新失败：NodeSeek、linux.do、妖火、小隐寺');
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

describe('linux.do foreground identity prompt', () => {
  it('[REG-LINUXDO-007] opens once for typed CF and does not reopen after the user closes the same intent', async () => {
    const showLinuxDoVerification = jest.fn();
    const challenge = {
      kind: 'verification-required' as const,
      message: 'linux.do 需要完成 Cloudflare 验证',
      verificationRequired: true
    };
    const hook = await renderNativeHook(
      (props: { error?: typeof challenge; identityPending: boolean; intentKey: string | null }) =>
        useIdentityVerificationPrompt({
          ...props,
          showVerification: showLinuxDoVerification
        }),
      {
        initialProps: {
          error: challenge,
          identityPending: true,
          intentKey: 'topic:linuxdo:42'
        }
      }
    );

    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    await act(async () => {
      hook.rerender({ error: undefined, identityPending: true, intentKey: 'topic:linuxdo:42' });
    });
    await act(async () => {
      hook.rerender({ error: challenge, identityPending: true, intentKey: 'topic:linuxdo:42' });
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.rerender({ error: undefined, identityPending: false, intentKey: null });
    });
    await act(async () => {
      hook.rerender({ error: challenge, identityPending: true, intentKey: 'feed:linuxdo' });
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(2));
  });

  it('[REG-LINUXDO-007] ignores ordinary Account failures and absent foreground intents', async () => {
    const showLinuxDoVerification = jest.fn();
    const hook = await renderNativeHook(
      (props: { error?: { kind: 'ordinary'; message: string }; intentKey: string | null }) =>
        useIdentityVerificationPrompt({
          error: props.error,
          identityPending: true,
          intentKey: props.intentKey,
          showVerification: showLinuxDoVerification
        }),
      {
        initialProps: {
          error: { kind: 'ordinary', message: 'Network request failed' },
          intentKey: 'topic:linuxdo:42'
        }
      }
    );

    await act(async () => {
      hook.rerender({
        error: undefined,
        intentKey: null
      });
    });
    expect(showLinuxDoVerification).not.toHaveBeenCalled();
  });

  it.each(['write', 'AI', 'background'])(
    '[REG-LINUXDO-007] does not auto-open for a %s Account result',
    async (reason) => {
      const showLinuxDoVerification = jest.fn();
      const challenge = {
        kind: 'verification-required' as const,
        message: 'linux.do 需要完成 Cloudflare 验证',
        verificationRequired: true
      };
      const hook = await renderNativeHook(
        (props: { enabled: boolean; error?: typeof challenge; intentKey: string | null }) =>
          useIdentityVerificationPrompt({
            enabled: props.enabled,
            error: props.error,
            identityPending: true,
            intentKey: props.intentKey,
            showVerification: showLinuxDoVerification
          }),
        {
          initialProps: {
            enabled: false,
            error: undefined,
            intentKey: `topic:linuxdo:blocked-${reason}`
          }
        }
      );

      await waitFor(() => expect(showLinuxDoVerification).not.toHaveBeenCalled());
      await act(async () => {
        hook.rerender({
          enabled: true,
          error: challenge,
          intentKey: `topic:linuxdo:blocked-${reason}`
        });
      });
      expect(showLinuxDoVerification).not.toHaveBeenCalled();
    }
  );
});
