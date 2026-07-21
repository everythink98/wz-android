import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn()
}));

jest.mock('../../src/sources/sourceGateway', () => ({
  checkLinuxDoLoginAccess: jest.fn(),
  checkYaohuoLogin: jest.fn(),
  getCurrentUserProfile: jest.fn()
}));

jest.mock('../../src/nodeseekCookies', () => ({
  parseNodeSeekDocumentCookie: (raw: string) => ({ raw }),
  summarizeNodeSeekCookies: ({ raw }: { raw: string }) => ({
    count: raw ? 1 : 0,
    loggedIn: Boolean(raw),
    names: raw ? ['session'] : []
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
  clearLinuxDoAccessForGeneration: jest.fn(),
  currentLinuxDoAccessGeneration: jest.fn(),
  linuxDoAccessSummary: (access: { cookieHeader?: string } | null) => ({
    hasClearance: Boolean(access?.cookieHeader),
    loggedIn: Boolean(access?.cookieHeader)
  }),
  loadLinuxDoAccess: jest.fn(),
  parseLinuxDoDocumentCookie: (raw: string) => ({ raw }),
  summarizeLinuxDoCookies: ({ raw }: { raw: string }) => ({
    count: raw ? 1 : 0,
    loggedIn: Boolean(raw),
    names: raw ? ['_t'] : []
  })
}));

import {
  checkLinuxDoLoginAccess,
  checkYaohuoLogin,
  getCurrentUserProfile
} from '../../src/sources/sourceGateway';
import {
  clearLinuxDoAccessForGeneration,
  currentLinuxDoAccessGeneration,
  loadLinuxDoAccess
} from '../../src/linuxdoCookieBridge';
import { useAccountStatusController } from '../../src/app/useAccountStatusController';
import { appQueryClient, emptyForumCredentialScope } from '../../src/app/serverState';
import type { CredentialLoadOptions } from '../../src/app/sessionControllerHelpers';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../src/siteSessionState';
import type { FeedSource, Source, UserProfile } from '../../src/types';
import { QueryTestWrapper } from './QueryTestWrapper';

const mockGetItem = jest.mocked(SecureStore.getItemAsync);
const mockCheckLinuxDoLogin = jest.mocked(checkLinuxDoLoginAccess);
const mockCheckYaohuoLogin = jest.mocked(checkYaohuoLogin);
const mockGetCurrentUser = jest.mocked(getCurrentUserProfile);
const mockClearLinuxDoAccess = jest.mocked(clearLinuxDoAccessForGeneration);
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

const xiaoyinsiUser: UserProfile = {
  source: 'xiaoyinsi',
  id: '23',
  username: 'carol',
  url: 'https://forum.xiaoyinsi.com/u/carol',
  topics: []
};

async function renderStatusController({
  clearYaohuoLoginState = jest.fn(async () => true),
  currentNodeSeekCredentialGeneration = () => 0,
  currentYaohuoCredentialGeneration = () => 0,
  loadNodeSeekCookieForSource = jest.fn(async () => undefined),
  notify = jest.fn(),
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
  const hook = await renderNativeHook(() => useAccountStatusController({
    clearYaohuoLoginState,
    credentialScope: emptyForumCredentialScope,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    fetcher: jest.fn(async () => new Response('{}')),
    linuxDoWebViewCookieHeaderRef: { current: '' },
    linuxDoUserAgentRef: { current: 'safe-agent' },
    loadNodeSeekCookieForSource,
    nodeSeekUserAgentRef: { current: 'safe-agent' },
    notify,
    onLinuxDoExpired,
    readXiaoyinsiAuthorization,
    resetLinuxDoLevelState: jest.fn(),
    saveNodeSeekCookieHeader,
    sessionViewModels,
    setLinuxDoWebViewCookieHeader: jest.fn()
  }), { wrapper: QueryTestWrapper });
  return { hook, notify, onLinuxDoExpired, readXiaoyinsiAuthorization };
}

describe('account status queries', () => {
  beforeEach(() => {
    appQueryClient.clear();
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockCurrentLinuxDoGeneration.mockReturnValue(0);
    mockLoadLinuxDoAccess.mockResolvedValue(null);
    mockCheckLinuxDoLogin.mockResolvedValue({ ok: true, loginRequired: false, message: '' });
    mockCheckYaohuoLogin.mockResolvedValue({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      loginUrl: 'https://www.yaohuo.me/login.aspx',
      message: '未登录',
      reason: undefined
    });
    mockGetCurrentUser.mockResolvedValue(linuxUser);
    mockClearLinuxDoAccess.mockResolvedValue(null);
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

  it('REG-ACCOUNT-008 exposes an expiry even if local credential cleanup is partial', async () => {
    mockGetItem.mockResolvedValueOnce('sid=safe');
    mockCheckYaohuoLogin.mockResolvedValueOnce({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      loginUrl: 'https://www.yaohuo.me/login.aspx',
      message: 'expired',
      reason: 'expired'
    });
    const clearYaohuoLoginState = jest.fn(async () => { throw new Error('cleanup failed'); });
    const { hook, notify } = await renderStatusController({ clearYaohuoLoginState });

    await act(async () => { await hook.result.current.refreshAccountStatus(); });
    await waitFor(() => expect(hook.result.current.accountSessionViewModels.yaohuo).toMatchObject({
      status: 'expired',
      lastError: '妖火登录已失效，本机 Cookie 清理未完成，请重试。'
    }));
    expect(notify).toHaveBeenCalledWith('账号状态部分刷新失败：妖火');
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
    expect(onLinuxDoExpired).toHaveBeenCalledWith('会话已失效');
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
});
