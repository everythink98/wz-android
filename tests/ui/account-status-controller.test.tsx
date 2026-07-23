import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn()
}));

jest.mock('../../src/sources/sourceGateway', () => ({
  checkLinuxDoLoginAccess: jest.fn(),
  checkYaohuoLogin: jest.fn(),
  getCurrentUserProfile: jest.fn(),
  getUserProfile: jest.fn()
}));

jest.mock('../../src/nodeseekCookies', () => ({
  parseNodeSeekDocumentCookie: (raw: string) => ({ raw }),
  summarizeNodeSeekCookies: ({ raw }: { raw: string }) => ({
    count: raw ? 1 : 0,
    loggedIn: raw.includes('session='),
    names: raw
      ? [raw.includes('session=') ? 'session' : 'cf_clearance']
      : []
  })
}));

jest.mock('../../src/yaohuoCookies', () => ({
  yaohuoCookieMapFromHeader: (raw: string) => ({ raw }),
  summarizeYaohuoCookies: ({ raw }: { raw: string }) => ({
    count: raw ? 1 : 0,
    loggedIn: Boolean(raw),
    names: raw ? ['sid'] : []
  })
}));

jest.mock('../../src/linuxdoCookieBridge', () => ({
  currentLinuxDoAccessGeneration: jest.fn(),
  linuxDoAccessSummary: (access: { cookieHeader?: string } | null) => ({
    hasClearance: Boolean(access?.cookieHeader?.includes('cf_clearance=')),
    loggedIn: Boolean(access?.cookieHeader?.includes('_t='))
  }),
  loadLinuxDoAccess: jest.fn(),
  parseLinuxDoDocumentCookie: (raw: string) => ({ raw }),
  summarizeLinuxDoCookies: ({ raw }: { raw: string }) => ({
    count: raw ? 1 : 0,
    loggedIn: raw.includes('_t='),
    names: raw
      ? [raw.includes('_t=') ? '_t' : raw.includes('_forum_session=') ? '_forum_session' : 'cf_clearance']
      : []
  })
}));

import {
  checkLinuxDoLoginAccess,
  checkYaohuoLogin,
  getCurrentUserProfile,
  getUserProfile
} from '../../src/sources/sourceGateway';
import {
  currentLinuxDoAccessGeneration,
  loadLinuxDoAccess
} from '../../src/linuxdoCookieBridge';
import { useAccountStatusController } from '../../src/app/useAccountStatusController';
import type { XiaoyinsiAuthorizationReadResult } from '../../src/app/useXiaoyinsiAuthController';
import {
  appQueryClient,
  emptyForumCredentialScope,
  forumQueryKeys,
  type ForumCredentialScope
} from '../../src/app/serverState';
import { resetForumSourceQueries, type CredentialLoadOptions } from '../../src/app/sessionControllerHelpers';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../src/siteSessionState';
import type { FeedSource, Source, UserProfile } from '../../src/types';
import { QueryTestWrapper } from './QueryTestWrapper';

const mockGetItem = jest.mocked(SecureStore.getItemAsync);
const mockCheckLinuxDoLogin = jest.mocked(checkLinuxDoLoginAccess);
const mockCheckYaohuoLogin = jest.mocked(checkYaohuoLogin);
const mockGetCurrentUser = jest.mocked(getCurrentUserProfile);
const mockGetUserProfile = jest.mocked(getUserProfile);
const mockCurrentLinuxDoGeneration = jest.mocked(currentLinuxDoAccessGeneration);
const mockLoadLinuxDoAccess = jest.mocked(loadLinuxDoAccess);

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

async function renderStatusController({
  credentialScope = emptyForumCredentialScope,
  currentNodeSeekCredentialGeneration = () => 0,
  currentYaohuoCredentialGeneration = () => 0,
  loadNodeSeekCookieForSource = jest.fn(async () => undefined),
  notify = jest.fn(),
  onAccountStatusExpired = jest.fn((source: Source, recoveryQueryKey: readonly unknown[]) => {
    resetForumSourceQueries(source, appQueryClient, recoveryQueryKey);
  }),
  onLinuxDoExpired = jest.fn(),
  readXiaoyinsiAuthorization = jest.fn(async () => ({
    authenticated: false,
    sessionEvent: {
      type: 'cookie-loaded' as const,
      loggedIn: false,
      currentUser: null,
      at: '2026-07-20T00:00:00.000Z'
    }
  })),
  saveNodeSeekCookieHeader = jest.fn(async () => ''),
  sessionViewModels = createSiteSessionViewModels(createSiteSessionStates())
}: Partial<Parameters<typeof useAccountStatusController>[0]> = {}) {
  const hook = await renderNativeHook(({
    renderedCredentialScope
  }: { renderedCredentialScope: ForumCredentialScope }) => useAccountStatusController({
    credentialScope: renderedCredentialScope,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    fetcher: jest.fn(async () => new Response('{}')),
    linuxDoUserAgentRef: { current: 'safe-agent' },
    loadNodeSeekCookieForSource,
    nodeSeekUserAgentRef: { current: 'safe-agent' },
    notify,
    onAccountStatusExpired,
    onLinuxDoExpired,
    readXiaoyinsiAuthorization,
    resetLinuxDoLevelState: jest.fn(),
    saveNodeSeekCookieHeader,
    sessionViewModels
  }), {
    initialProps: { renderedCredentialScope: credentialScope },
    wrapper: QueryTestWrapper
  });
  return { hook, notify, onLinuxDoExpired, readXiaoyinsiAuthorization };
}

describe('account status queries', () => {
  beforeEach(() => {
    appQueryClient.clear();
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockCurrentLinuxDoGeneration.mockReturnValue(0);
    mockLoadLinuxDoAccess.mockResolvedValue(null);
    mockCheckLinuxDoLogin.mockResolvedValue({ ok: true, loginRequired: false, message: '', currentUser: linuxUser });
    mockCheckYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      loginUrl: 'https://www.yaohuo.me/login.aspx',
      message: '未登录',
      reason: undefined
    });
    mockGetCurrentUser.mockResolvedValue(linuxUser);
    mockGetUserProfile.mockResolvedValue(yaohuoUser);
  });

  afterEach(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('REG-ACCOUNT-001 keeps successful sites when one identity query fails', async () => {
    mockLoadLinuxDoAccess.mockResolvedValue({
      cookieHeader: '_t=safe',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview',
      userAgent: 'safe-agent'
    });
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (source === 'nodeseek') throw new Error('NodeSeek offline');
      return linuxUser;
    });
    const loadNodeSeekCookieForSource = jest.fn(async () => 'session=safe');
    const { hook, notify } = await renderStatusController({ loadNodeSeekCookieForSource });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
        status: 'logged-in', currentUser: linuxUser
      });
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
        status: 'anonymous', lastError: 'NodeSeek offline'
      });
      expect(hook.result.current.accountSessionViewModels.yaohuo.status).toBe('anonymous');
    });
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：NodeSeek');
  });

  it('[REG-LINUXDO-005] keeps a cold-start Cookie candidate non-authenticated when identity is unknown', async () => {
    mockLoadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'cf_clearance=verification; _t=stale-session',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview',
      userAgent: 'safe-agent'
    });
    mockCheckLinuxDoLogin.mockResolvedValue({
      ok: false,
      loginRequired: false,
      message: 'linux.do 状态暂时无法确认'
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

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
      status: 'verified',
      isLoggedIn: false,
      lastError: 'linux.do 状态暂时无法确认'
    }));
  });

  it('[REG-ACCOUNT-019] projects the linux.do current user from one authoritative session response', async () => {
    mockLoadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'cf_clearance=verification; _t=active-session',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview',
      userAgent: 'safe-agent'
    });
    mockCheckLinuxDoLogin.mockResolvedValue({
      ok: true,
      loginRequired: false,
      message: '登录可用',
      currentUser: linuxUser
    });
    mockGetCurrentUser.mockRejectedValue(new Error('second current-session request must not run'));
    const { hook } = await renderStatusController();

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
      status: 'logged-in',
      currentUser: linuxUser
    }));
    expect(mockGetCurrentUser).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'linuxdo' }));
  });

  it('[REG-ACCOUNT-026] lets the linux.do current-session response decide identity when a candidate cookie has no _t', async () => {
    mockLoadLinuxDoAccess.mockResolvedValue({
      cookieHeader: '_forum_session=current-session',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview',
      userAgent: 'safe-agent'
    });
    mockCheckLinuxDoLogin.mockResolvedValue({
      ok: true,
      loginRequired: false,
      message: '登录可用',
      currentUser: linuxUser
    });
    const { hook } = await renderStatusController();

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
      status: 'logged-in',
      currentUser: linuxUser
    }));
    expect(mockCheckLinuxDoLogin).toHaveBeenCalledWith(expect.objectContaining({
      cookieHeader: '_forum_session=current-session'
    }));
  });

  it('REG-ACCOUNT-002 isolates a credential-store failure from the other sites', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('secure store unavailable'));
    const { hook, notify, readXiaoyinsiAuthorization } = await renderStatusController();

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.yaohuo.lastError).toBe('secure store unavailable');
      expect(hook.result.current.accountSessionViewModels.nodeseek.status).toBe('anonymous');
    });
    expect(readXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：妖火');
  });

  it('[REG-ACCOUNT-026] exposes confirmed Yaohuo expiry without invoking a logout command', async () => {
    mockGetItem.mockResolvedValueOnce('sid=safe');
    mockCheckYaohuoLogin.mockResolvedValueOnce({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      loginUrl: 'https://www.yaohuo.me/login.aspx',
      message: 'expired',
      reason: 'expired'
    });
    const { hook, notify } = await renderStatusController();

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.yaohuo).toMatchObject({
      status: 'expired',
      lastError: '妖火登录已失效'
    }));
    expect(notify).toHaveBeenCalledWith('账号状态已刷新');
  });

  it('REG-ACCOUNT-008 keeps a confirmed NodeSeek identity when persisting it fails', async () => {
    mockGetCurrentUser.mockImplementation(async ({ source }) => source === 'nodeseek' ? nodeSeekUser : linuxUser);
    const loadNodeSeekCookieForSource = jest.fn(async () => 'session=safe');
    const saveNodeSeekCookieHeader = jest.fn(async () => { throw new Error('identity persistence failed'); });
    const { hook, notify, readXiaoyinsiAuthorization } = await renderStatusController({
      loadNodeSeekCookieForSource,
      saveNodeSeekCookieHeader
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'logged-in',
      currentUser: nodeSeekUser,
      lastError: 'identity persistence failed'
    }));
    expect(readXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：NodeSeek');
  });

  it('[REG-ACCOUNT-026] lets the NodeSeek current-session response decide identity when the candidate has no known login cookie name', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const loadNodeSeekCookieForSource = jest.fn(async () => 'cf_clearance=current-verification');
    const { hook } = await renderStatusController({ loadNodeSeekCookieForSource });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'logged-in',
      currentUser: nodeSeekUser
    }));
    expect(mockGetCurrentUser).toHaveBeenCalledWith(expect.objectContaining({
      source: 'nodeseek',
      nodeSeekCookie: 'cf_clearance=current-verification'
    }));
  });

  it('[REG-ACCOUNT-026] exposes a confirmed NodeSeek login expiry without deleting login cookies', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(Object.assign(new Error('NodeSeek 登录已失效'), {
      source: 'nodeseek',
      kind: 'login-expired',
      loginRequired: true,
      reason: 'expired'
    }));
    const loadNodeSeekCookieForSource = jest.fn(async () => 'session=expired');
    const { hook } = await renderStatusController({
      loadNodeSeekCookieForSource
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'expired',
      isLoggedIn: false,
      lastError: 'NodeSeek 登录已失效'
    }));
  });

  it('[REG-ACCOUNT-026] cannot invoke a failing NodeSeek logout command during status refresh', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(Object.assign(new Error('NodeSeek 登录已失效'), {
      source: 'nodeseek',
      kind: 'login-expired',
      loginRequired: true,
      reason: 'expired'
    }));
    const { hook, notify } = await renderStatusController({
      loadNodeSeekCookieForSource: jest.fn(async () => 'session=expired')
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'expired',
      isLoggedIn: false,
      lastError: 'NodeSeek 登录已失效'
    }));
    expect(notify).toHaveBeenLastCalledWith('账号状态已刷新');
  });

  it('[REG-ACCOUNT-026] resets the expired source cache without coupling reset to credential deletion', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(Object.assign(new Error('NodeSeek 登录已失效'), {
      source: 'nodeseek',
      kind: 'login-expired',
      loginRequired: true,
      reason: 'expired'
    }));
    const onAccountStatusExpired = jest.fn((source: Source, recoveryQueryKey: readonly unknown[]) => {
      resetForumSourceQueries(source, appQueryClient, recoveryQueryKey);
    });
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
      loadNodeSeekCookieForSource: jest.fn(async () => 'session=expired'),
      onAccountStatusExpired,
      sessionViewModels: createSiteSessionViewModels(states)
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'expired',
      isLoggedIn: false,
      lastError: 'NodeSeek 登录已失效'
    }));
    expect(onAccountStatusExpired).toHaveBeenCalledWith('nodeseek', expect.any(Array));
    expect(notify).toHaveBeenLastCalledWith('账号状态已刷新');
  });

  it('REG-ACCOUNT-008 ends an explicit linux.do expiry with login-expired only', async () => {
    mockLoadLinuxDoAccess.mockResolvedValue({
      cookieHeader: '_t=safe',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview',
      userAgent: 'safe-agent'
    });
    mockCheckLinuxDoLogin.mockResolvedValue({ ok: false, loginRequired: true, message: '会话已失效' });
    const { hook, onLinuxDoExpired } = await renderStatusController();

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    expect(onLinuxDoExpired).toHaveBeenCalledTimes(1);
    expect(onLinuxDoExpired).toHaveBeenCalledWith(
      '会话已失效',
      forumQueryKeys.accountStatus({
        credentialScope: emptyForumCredentialScope,
        source: 'linuxdo'
      })
    );
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({
      status: 'expired', lastError: '会话已失效'
    }));
  });

  it('REG-ACCOUNT-009 does not send credentials that became stale while storage was loading', async () => {
    let generation = 0;
    const storedCookie = Promise.withResolvers<string | undefined>();
    const loadNodeSeekCookieForSource: Parameters<typeof useAccountStatusController>[0]['loadNodeSeekCookieForSource'] = jest.fn(async (
      _source: FeedSource | Source,
      options?: CredentialLoadOptions
    ) => {
      options?.captureGeneration?.(generation);
      return storedCookie.promise;
    });
    const { hook } = await renderStatusController({
      currentNodeSeekCredentialGeneration: () => generation,
      loadNodeSeekCookieForSource
    });
    let refresh!: Promise<void>;

    await act(async () => {
      refresh = hook.result.current.refreshAccountStatus();
      await Promise.resolve();
    });
    await waitFor(() => expect(loadNodeSeekCookieForSource).toHaveBeenCalledTimes(1));
    generation = 1;
    await act(async () => {
      storedCookie.resolve('session=old');
      await refresh;
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek' }));
    expect(hook.result.current.accountSessionViewModels.nodeseek.status).toBe('anonymous');
    expect(hook.result.current.accountSessionViewModels.nodeseek.lastError).toBeUndefined();
  });

  it('deduplicates a concurrent manual refresh through the four query keys', async () => {
    const storedCookie = Promise.withResolvers<string | undefined>();
    const loadNodeSeekCookieForSource = jest.fn(async () => storedCookie.promise);
    const { hook, readXiaoyinsiAuthorization } = await renderStatusController({ loadNodeSeekCookieForSource });
    let first!: Promise<void>;

    await act(async () => {
      first = hook.result.current.refreshAccountStatus();
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.statusBusy).toBe(true));
    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    expect(loadNodeSeekCookieForSource).toHaveBeenCalledTimes(1);

    await act(async () => {
      storedCookie.resolve(undefined);
      await first;
    });
    expect(readXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
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

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.xiaoyinsi.status).toBe('anonymous'));
    expect(hook.result.current.accountSessionViewModels.xiaoyinsi.currentUser).toBeUndefined();
    expect(readXiaoyinsiAuthorization).toHaveBeenCalledWith(expect.any(Object), {
      signal: expect.any(Object)
    });
  });

  it('[REG-ACCOUNT-019] clears only Xiaoyinsi and all-source caches when its account proof expires', async () => {
    const xiaoyinsiFeedKey = ['forum', 'xiaoyinsi', 'feed'] as const;
    const allFeedKey = ['forum', 'all', 'feed'] as const;
    const linuxDoFeedKey = ['forum', 'linuxdo', 'feed'] as const;
    appQueryClient.setQueryData(xiaoyinsiFeedKey, { private: true });
    appQueryClient.setQueryData(allFeedKey, { mixed: true });
    appQueryClient.setQueryData(linuxDoFeedKey, { untouched: true });
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

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
      status: 'expired',
      isLoggedIn: false
    }));
    expect(appQueryClient.getQueryData(xiaoyinsiFeedKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(allFeedKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(linuxDoFeedKey)).toEqual({ untouched: true });
  });

  it('[REG-ACCOUNT-016] commits the Xiaoyinsi expired Account result before invalidating its source scope', async () => {
    const committedResults: unknown[] = [];
    const onAccountStatusExpired = jest.fn((source: Source, recoveryQueryKey: readonly unknown[]) => {
      committedResults.push(recoveryQueryKey
        ? appQueryClient.getQueryData(recoveryQueryKey)
        : undefined);
      resetForumSourceQueries(source, appQueryClient, recoveryQueryKey);
    });
    const { hook } = await renderStatusController({
      onAccountStatusExpired,
      readXiaoyinsiAuthorization: jest.fn(async () => ({
        authenticated: false,
        sessionEvent: { type: 'login-expired' as const, message: '小隐寺授权已失效' }
      }))
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    expect(onAccountStatusExpired).toHaveBeenCalledWith('xiaoyinsi', expect.any(Array));
    expect(committedResults).toEqual([expect.objectContaining({
      session: expect.objectContaining({ status: 'expired', currentUser: undefined })
    })]);
  });

  it('[REG-ACCOUNT-019] does not carry an old logged-in Account result into an ordinary new credential scope', async () => {
    mockGetCurrentUser.mockResolvedValue(nodeSeekUser);
    const { hook } = await renderStatusController({
      loadNodeSeekCookieForSource: jest.fn(async () => 'session=safe')
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'logged-in',
      currentUser: nodeSeekUser
    }));

    await act(async () => {
      hook.rerender({
        renderedCredentialScope: { ...emptyForumCredentialScope, nodeseek: 1 }
      });
    });

    expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'anonymous',
      isLoggedIn: false
    });
    expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toBeUndefined();
  });

  it('[REG-ACCOUNT-017] preserves the last confirmed Xiaoyinsi identity when refresh fails', async () => {
    const readXiaoyinsiAuthorization = jest.fn<ReadXiaoyinsiAuthorization>()
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

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
      status: 'logged-in',
      currentUser: xiaoyinsiUser
    }));

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({
      status: 'logged-in',
      currentUser: xiaoyinsiUser,
      lastError: '小隐寺状态暂时无法确认'
    }));
    expect(notify).toHaveBeenLastCalledWith('账号状态部分刷新失败：小隐寺');
  });

  it('[REG-ACCOUNT-020] hydrates a verified Yaohuo self id before projecting the account', async () => {
    mockGetItem.mockImplementation(async (key) => key === 'yaohuo-cookie-header' ? 'sidyaohuo=safe' : null);
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
    const { hook } = await renderStatusController();

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.yaohuo.currentUser).toEqual(yaohuoUser));
    expect(mockCheckYaohuoLogin).toHaveBeenCalledWith(expect.objectContaining({
      yaohuoCookie: 'sidyaohuo=safe'
    }));
    expect(mockGetCurrentUser).not.toHaveBeenCalledWith(expect.objectContaining({
      source: 'yaohuo'
    }));
    expect(mockGetUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'yaohuo',
      id: '31',
      yaohuoCookie: 'sidyaohuo=safe'
    }));
  });

  it('[REG-ACCOUNT-025] keeps a verified Yaohuo identity when optional profile enrichment fails', async () => {
    mockGetItem.mockImplementation(async (key) => key === 'yaohuo-cookie-header' ? 'sidyaohuo=safe' : null);
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

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.yaohuo).toMatchObject({
      status: 'logged-in',
      currentUser: {
        source: 'yaohuo',
        id: '31',
        username: '31'
      },
      lastError: 'profile unavailable'
    }));
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：妖火');
  });

  it('[REG-ACCOUNT-019] preserves each site last confirmed identity on ordinary refresh failures', async () => {
    let failing = false;
    mockGetItem.mockResolvedValue('sid=safe');
    mockLoadLinuxDoAccess.mockResolvedValue({
      cookieHeader: '_t=safe',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview',
      userAgent: 'safe-agent'
    });
    mockGetCurrentUser.mockImplementation(async ({ source }) => {
      if (failing && source === 'nodeseek') throw new Error('NodeSeek offline');
      return source === 'nodeseek' ? nodeSeekUser : linuxUser;
    });
    mockCheckLinuxDoLogin.mockImplementation(async () => failing
      ? { ok: false, loginRequired: false, message: 'linux.do offline' }
      : { ok: true, loginRequired: false, message: '', currentUser: linuxUser });
    mockCheckYaohuoLogin.mockImplementation(async () => {
      if (failing) return {
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
    const readXiaoyinsiAuthorization = jest.fn<ReadXiaoyinsiAuthorization>(async () => failing
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
      });
    const { hook, notify } = await renderStatusController({
      loadNodeSeekCookieForSource: jest.fn(async () => 'session=safe'),
      readXiaoyinsiAuthorization
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.nodeseek.currentUser).toEqual(nodeSeekUser);
      expect(hook.result.current.accountSessionViewModels.linuxdo.currentUser).toEqual(linuxUser);
      expect(hook.result.current.accountSessionViewModels.yaohuo.currentUser).toEqual(yaohuoUser);
      expect(hook.result.current.accountSessionViewModels.xiaoyinsi.currentUser).toEqual(xiaoyinsiUser);
    });

    failing = true;
    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => {
      expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({ currentUser: nodeSeekUser, status: 'logged-in', lastError: 'NodeSeek offline' });
      expect(hook.result.current.accountSessionViewModels.linuxdo).toMatchObject({ currentUser: linuxUser, status: 'logged-in', lastError: 'linux.do offline' });
      expect(hook.result.current.accountSessionViewModels.yaohuo).toMatchObject({ currentUser: yaohuoUser, status: 'logged-in', lastError: '妖火状态暂时无法确认。' });
      expect(hook.result.current.accountSessionViewModels.xiaoyinsi).toMatchObject({ currentUser: xiaoyinsiUser, status: 'logged-in', lastError: '小隐寺 offline' });
    });
    expect(notify).toHaveBeenLastCalledWith('账号状态部分刷新失败：NodeSeek、linux.do、妖火、小隐寺');
  });

  it('[REG-ACCOUNT-024] never clears NodeSeek login cookies for an ordinary HTTP 404', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(Object.assign(new Error('HTTP 404'), {
      status: 404
    }));
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
      loadNodeSeekCookieForSource: jest.fn(async () => 'session=current'),
      sessionViewModels: createSiteSessionViewModels(states)
    });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });

    await waitFor(() => expect(hook.result.current.accountSessionViewModels.nodeseek).toMatchObject({
      status: 'logged-in',
      currentUser: nodeSeekUser,
      lastError: 'HTTP 404'
    }));
  });
});
