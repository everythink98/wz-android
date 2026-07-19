import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined)
}));

jest.mock('../../src/xiaoyinsiAuth', () => {
  class XiaoyinsiAuthError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    XiaoyinsiAuthError,
    beginXiaoyinsiDeviceAuth: jest.fn(),
    cancelXiaoyinsiDeviceAuth: jest.fn(async () => undefined),
    deviceAuthCountdown: (expiresAt: number, now = Date.now()) => Math.max(0, Math.ceil((expiresAt - now) / 1_000)),
    hasXiaoyinsiRevocationCleanupPending: jest.fn(async () => false),
    loadXiaoyinsiCredentials: jest.fn(),
    loadXiaoyinsiPendingAuthorization: jest.fn(),
    nextXiaoyinsiPollDelay: (appState: string, now: number, lastPollAt: number | null, intervalMs: number) => (
      appState === 'active' ? lastPollAt === null ? 0 : Math.max(0, lastPollAt + intervalMs - now) : null
    ),
    pollXiaoyinsiDeviceAuth: jest.fn(),
    retryXiaoyinsiRevocationCleanup: jest.fn(async () => ({
      complete: true,
      apiKeyDeleted: true,
      pendingDeleted: true,
      pendingNeutralized: true,
      keystoreDeleted: true,
      cleanupMarkerPersisted: false
    })),
    revokeXiaoyinsiAuthorization: jest.fn(async () => ({
      complete: true,
      apiKeyDeleted: true,
      pendingDeleted: true,
      pendingNeutralized: true,
      keystoreDeleted: true,
      cleanupMarkerPersisted: false
    })),
    verifyXiaoyinsiCredentials: jest.fn()
  };
});

jest.mock('../../src/localXiaoyinsi', () => ({
  getXiaoyinsiLevelProfile: jest.fn()
}));

import * as XiaoyinsiAuth from '../../src/xiaoyinsiAuth';
import * as LocalXiaoyinsi from '../../src/localXiaoyinsi';
import { useXiaoyinsiAuthController } from '../../src/app/useXiaoyinsiAuthController';
import { setDiagnosticWriter, type DiagnosticEvent } from '../../src/diagnostics';

const mockBegin = jest.mocked(XiaoyinsiAuth.beginXiaoyinsiDeviceAuth);
const mockCancel = jest.mocked(XiaoyinsiAuth.cancelXiaoyinsiDeviceAuth);
const mockHasCleanup = jest.mocked(XiaoyinsiAuth.hasXiaoyinsiRevocationCleanupPending);
const mockLoadCredentials = jest.mocked(XiaoyinsiAuth.loadXiaoyinsiCredentials);
const mockLoadPending = jest.mocked(XiaoyinsiAuth.loadXiaoyinsiPendingAuthorization);
const mockPoll = jest.mocked(XiaoyinsiAuth.pollXiaoyinsiDeviceAuth);
const mockRevoke = jest.mocked(XiaoyinsiAuth.revokeXiaoyinsiAuthorization);
const mockRetryCleanup = jest.mocked(XiaoyinsiAuth.retryXiaoyinsiRevocationCleanup);
const mockVerify = jest.mocked(XiaoyinsiAuth.verifyXiaoyinsiCredentials);
const mockGetLevelProfile = jest.mocked(LocalXiaoyinsi.getXiaoyinsiLevelProfile);

const levelProfile = {
  username: 'alice',
  currentLevel: 1,
  targetLevel: 2,
  source: 'summary' as const,
  estimate: true,
  note: '按 Discourse 信任等级规则和本机读取到的统计估算。',
  requirements: [],
  activity: {
    daysVisited: 12,
    topicsEntered: 40,
    postsReadCount: 180,
    timeRead: 7200,
    likesGiven: 4,
    likesReceived: 3,
    postCount: 8,
    topicCount: 2
  },
  achievedCount: 0,
  totalCount: 0,
  fetchedAt: '2026-07-19T00:00:00.000Z'
};

const completeCleanup = {
  complete: true,
  apiKeyDeleted: true,
  pendingDeleted: true,
  pendingNeutralized: true,
  keystoreDeleted: true,
  cleanupMarkerPersisted: false
};

const partialCleanup = {
  complete: false,
  apiKeyDeleted: false,
  pendingDeleted: true,
  pendingNeutralized: true,
  keystoreDeleted: true,
  cleanupMarkerPersisted: true
};

const pending = {
  deviceCode: 'd'.repeat(64),
  userCode: 'ABCD-2345',
  verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
  verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=safe',
  nonce: 'e'.repeat(64),
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
  intervalMs: 5_000
};

async function renderController(dispatchSiteSessionEvent = jest.fn(), notify = jest.fn()) {
  const fetcher = jest.fn(async () => new Response('{}'));
  return {
    dispatchSiteSessionEvent,
    hook: await renderHook(() => useXiaoyinsiAuthController({
      dispatchSiteSessionEvent,
      fetcher,
      notify
    })),
    notify
  };
}

describe('小隐寺授权 controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasCleanup.mockResolvedValue(false);
    mockLoadCredentials.mockResolvedValue(undefined);
    mockLoadPending.mockResolvedValue(undefined);
    mockPoll.mockImplementation(() => new Promise(() => undefined));
    mockRetryCleanup.mockResolvedValue(completeCleanup);
    mockRevoke.mockResolvedValue(completeCleanup);
    mockGetLevelProfile.mockResolvedValue(levelProfile);
    mockVerify.mockResolvedValue({
      source: 'xiaoyinsi',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://forum.xiaoyinsi.com/u/alice',
      topics: []
    });
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active', writable: true });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    setDiagnosticWriter(null);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('恢复进程回收前的待授权状态，并只在系统浏览器打开服务器 URI', async () => {
    mockLoadPending.mockResolvedValue(pending);
    const { dispatchSiteSessionEvent, hook } = await renderController();

    await waitFor(() => expect(hook.result.current.phase).toBe('waiting'));
    expect(dispatchSiteSessionEvent).toHaveBeenCalledWith({ site: 'xiaoyinsi', type: 'authorization-started' });

    await act(async () => {
      await hook.result.current.openAuthorizationBrowser();
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABCD-2345');
    expect(Linking.openURL).toHaveBeenCalledWith(pending.verificationUriWithRequest);
  });

  it('[REG-XIAOYINSI-005] 重新授权进程被回收后优先恢复验证码，而不是回退到旧 Token', async () => {
    mockLoadCredentials.mockResolvedValue({ apiKey: 'old-key', clientId: 'old-client' });
    mockLoadPending.mockResolvedValue(pending);

    const { hook, dispatchSiteSessionEvent } = await renderController();

    await waitFor(() => expect(hook.result.current.phase).toBe('waiting'));
    expect(hook.result.current.pending).toEqual(pending);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).toHaveBeenLastCalledWith({ site: 'xiaoyinsi', type: 'authorization-started' });
  });

  it('[REG-XIAOYINSI-005] 重新授权开始后忽略迟到的旧 session 复核结果', async () => {
    let resolveVerify!: (profile: Awaited<ReturnType<typeof XiaoyinsiAuth.verifyXiaoyinsiCredentials>>) => void;
    mockLoadCredentials.mockResolvedValue({ apiKey: 'old-key', clientId: 'old-client' });
    mockVerify.mockImplementationOnce(() => new Promise((resolve) => { resolveVerify = resolve; }));
    mockBegin.mockResolvedValueOnce(pending);
    const { hook, dispatchSiteSessionEvent } = await renderController();
    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));

    await act(async () => {
      await hook.result.current.beginAuthorization();
    });
    expect(hook.result.current.phase).toBe('waiting');

    await act(async () => {
      resolveVerify({
        source: 'xiaoyinsi',
        id: 'alice',
        username: 'alice',
        displayName: 'Alice',
        url: 'https://forum.xiaoyinsi.com/u/alice',
        topics: []
      });
    });

    expect(hook.result.current.phase).toBe('waiting');
    expect(hook.result.current.pending).toEqual(pending);
    expect(dispatchSiteSessionEvent).toHaveBeenLastCalledWith({ site: 'xiaoyinsi', type: 'authorization-started' });
  });

  it('[REG-XIAOYINSI-005] 撤销完成后忽略迟到的旧 session 复核结果', async () => {
    let resolveVerify!: (profile: Awaited<ReturnType<typeof XiaoyinsiAuth.verifyXiaoyinsiCredentials>>) => void;
    mockLoadCredentials.mockResolvedValue({ apiKey: 'old-key', clientId: 'old-client' });
    mockVerify.mockImplementationOnce(() => new Promise((resolve) => { resolveVerify = resolve; }));
    const { hook, dispatchSiteSessionEvent } = await renderController();
    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));

    await act(async () => {
      await hook.result.current.revokeAuthorization();
    });
    expect(hook.result.current.phase).toBe('idle');

    await act(async () => {
      resolveVerify({
        source: 'xiaoyinsi',
        id: 'alice',
        username: 'alice',
        displayName: 'Alice',
        url: 'https://forum.xiaoyinsi.com/u/alice',
        topics: []
      });
    });

    expect(hook.result.current.phase).toBe('idle');
    expect(dispatchSiteSessionEvent).toHaveBeenLastCalledWith({ site: 'xiaoyinsi', type: 'cleared' });
  });

  it('收到 authorized 后先校验 session/current，再标记登录成功', async () => {
    mockLoadPending.mockResolvedValueOnce({ ...pending, intervalMs: 60_000 }).mockResolvedValue(undefined);
    mockLoadCredentials.mockResolvedValue(undefined);
    mockPoll.mockImplementationOnce(async () => {
      mockLoadCredentials.mockResolvedValue({ apiKey: 'key', clientId: 'client' });
      return {
        status: 'authorized',
        credentials: { apiKey: 'key', clientId: 'client' }
      };
    });
    const { dispatchSiteSessionEvent, hook, notify } = await renderController();

    await waitFor(() => expect(hook.result.current.phase).toBe('authorized'));
    expect(mockVerify).toHaveBeenCalled();
    expect(dispatchSiteSessionEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      site: 'xiaoyinsi',
      type: 'login-detected',
      currentUser: expect.objectContaining({ username: 'alice' })
    }));
    expect(dispatchSiteSessionEvent.mock.calls.at(-1)?.[0]).not.toHaveProperty('cookieSummary');
    expect(notify).toHaveBeenCalledWith('小隐寺授权成功。');
  });

  it('[REG-XIAOYINSI-013] uses the saved User API authorization to refresh the current account level', async () => {
    mockLoadCredentials.mockResolvedValue({ apiKey: 'key', clientId: 'client' });
    const { hook, notify } = await renderController();
    await waitFor(() => expect(hook.result.current.phase).toBe('authorized'));

    await act(async () => {
      await hook.result.current.refreshLevel();
    });

    expect(mockGetLevelProfile).toHaveBeenCalledWith(expect.objectContaining({
      credentials: { apiKey: 'key', clientId: 'client' }
    }));
    expect(hook.result.current.levelProfile).toEqual(levelProfile);
    expect(hook.result.current.levelError).toBe('');
    expect(notify).toHaveBeenCalledWith('小隐寺等级已更新。');
  });

  const terminalCases: Array<[
    'access_denied' | 'expired_token',
    'denied' | 'expired',
    string
  ]> = [
    ['access_denied', 'denied', '你已拒绝小隐寺授权。'],
    ['expired_token', 'expired', '验证码已过期，请重新授权。']
  ];

  it.each(terminalCases)('把 %s 显示为明确终态', async (status, expectedPhase, expectedMessage) => {
    mockLoadPending.mockResolvedValueOnce({ ...pending, intervalMs: 1 }).mockResolvedValue(undefined);
    mockPoll.mockResolvedValueOnce({ status });

    const { hook } = await renderController();

    await waitFor(() => expect(hook.result.current.phase).toBe(expectedPhase));
    expect(hook.result.current.message).toBe(expectedMessage);
  });

  it('取消待授权状态并保留明确的未授权结果', async () => {
    mockLoadPending.mockResolvedValue(pending);
    const { hook } = await renderController();
    await waitFor(() => expect(hook.result.current.phase).toBe('waiting'));
    mockLoadPending.mockResolvedValue(undefined);

    await act(async () => {
      await hook.result.current.cancelAuthorization();
    });

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.message).toBe('已取消授权。');
  });

  it('[REG-XIAOYINSI-005] 取消时中止正在轮询的授权，迟到的 authorized 不得重新登录', async () => {
    let resolvePoll!: (result: { status: 'authorized'; credentials: { apiKey: string; clientId: string } }) => void;
    let pollSignal: AbortSignal | undefined;
    mockLoadPending.mockResolvedValue(pending);
    mockPoll.mockImplementationOnce((dependencies) => {
      pollSignal = dependencies?.signal;
      return new Promise((resolve) => { resolvePoll = resolve; });
    });
    const { hook, notify } = await renderController();
    await waitFor(() => expect(mockPoll).toHaveBeenCalledTimes(1));
    mockLoadPending.mockResolvedValue(undefined);

    await act(async () => {
      await hook.result.current.cancelAuthorization();
    });
    mockLoadCredentials.mockResolvedValue({ apiKey: 'late-key', clientId: 'client' });
    await act(async () => {
      resolvePoll({ status: 'authorized', credentials: { apiKey: 'late-key', clientId: 'client' } });
    });

    expect(pollSignal?.aborted).toBe(true);
    expect(hook.result.current.phase).toBe('idle');
    expect(mockVerify).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('小隐寺授权成功。');
  });

  it('后台暂停轮询，回到前台后立即恢复', async () => {
    let appStateListener: ((state: string) => void) | undefined;
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background', writable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
    mockLoadPending.mockResolvedValue({ ...pending, intervalMs: 60_000 });
    const { hook } = await renderController();

    await waitFor(() => expect(hook.result.current.phase).toBe('waiting'));
    expect(mockPoll).not.toHaveBeenCalled();
    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() => expect(mockPoll).toHaveBeenCalledTimes(1));
  });

  it('轮询网络错误保持等待并安排重试', async () => {
    mockLoadPending.mockResolvedValue({ ...pending, intervalMs: 60_000 });
    mockPoll.mockRejectedValueOnce(new Error('network request failed'));
    const { hook } = await renderController();

    await waitFor(() => expect(hook.result.current.message).toContain('授权检测失败，将继续重试'));
    expect(hook.result.current.phase).toBe('waiting');
    expect(hook.result.current.pending).toBeTruthy();
  });

  it('重新授权无法开始时复核并保留仍有效的原授权', async () => {
    mockLoadCredentials.mockResolvedValue({ apiKey: 'old-key', clientId: 'old-client' });
    mockBegin.mockRejectedValueOnce(new XiaoyinsiAuth.XiaoyinsiAuthError('unsupported', '站点暂不支持 App 授权'));
    const { hook, dispatchSiteSessionEvent } = await renderController();
    await waitFor(() => expect(hook.result.current.phase).toBe('authorized'));

    await act(async () => {
      await hook.result.current.beginAuthorization();
    });

    expect(hook.result.current.phase).toBe('authorized');
    expect(hook.result.current.message).toBe('重新授权未开始，原授权仍然有效。');
    expect(dispatchSiteSessionEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      site: 'xiaoyinsi',
      type: 'login-detected'
    }));
  });

  it('[REG-XIAOYINSI-005] 服务端撤销成功但本机清理不完整时仍退出登录并明确警告', async () => {
    mockLoadCredentials.mockResolvedValue({ apiKey: 'old-key', clientId: 'old-client' });
    mockRevoke.mockResolvedValueOnce(partialCleanup);
    const { hook, dispatchSiteSessionEvent, notify } = await renderController();
    await waitFor(() => expect(hook.result.current.phase).toBe('authorized'));

    await act(async () => {
      await hook.result.current.revokeAuthorization();
    });

    expect(hook.result.current.phase).toBe('cleanup');
    expect(hook.result.current.message).toContain('服务端授权已撤销');
    expect(dispatchSiteSessionEvent).toHaveBeenLastCalledWith({ site: 'xiaoyinsi', type: 'cleared' });
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('本机安全材料清理未完成'));

    mockRetryCleanup.mockResolvedValueOnce(completeCleanup);
    await act(async () => {
      await hook.result.current.beginAuthorization();
    });

    expect(mockRetryCleanup).toHaveBeenCalledTimes(1);
    expect(mockBegin).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe('idle');
  });

  it('[REG-XIAOYINSI-005] 重启时先重试撤销清理，不得恢复旧 Device Code', async () => {
    mockHasCleanup.mockResolvedValue(true);
    mockRetryCleanup.mockResolvedValueOnce(partialCleanup);
    mockLoadPending.mockResolvedValue(pending);
    const first = await renderController();

    await waitFor(() => expect(first.hook.result.current.phase).toBe('cleanup'));
    expect(mockLoadPending).not.toHaveBeenCalled();
    await first.hook.unmount();

    mockRetryCleanup.mockResolvedValueOnce(completeCleanup);
    const second = await renderController();
    await waitFor(() => expect(mockRetryCleanup).toHaveBeenCalledTimes(2));

    expect(second.hook.result.current.phase).toBe('idle');
    expect(mockLoadPending).not.toHaveBeenCalled();
    expect(second.dispatchSiteSessionEvent).toHaveBeenLastCalledWith({ site: 'xiaoyinsi', type: 'cleared' });
    await second.hook.unmount();
  });

  it('授权 payload 到达但 session 复核失败时退出授权中状态', async () => {
    mockLoadPending.mockResolvedValueOnce({ ...pending, intervalMs: 1 }).mockResolvedValue(undefined);
    mockPoll.mockImplementationOnce(async () => {
      mockLoadCredentials.mockResolvedValue({ apiKey: 'key', clientId: 'client' });
      return { status: 'authorized', credentials: { apiKey: 'key', clientId: 'client' } };
    });
    mockVerify.mockRejectedValueOnce(new Error('network request failed'));
    const { hook, dispatchSiteSessionEvent } = await renderController();

    await waitFor(() => expect(hook.result.current.phase).toBe('error'));
    expect(dispatchSiteSessionEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      site: 'xiaoyinsi',
      type: 'check-failed'
    }));
  });

  it('授权诊断只记录阶段，不记录 Token、验证码、nonce 或授权 URL 查询参数', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mockBegin.mockResolvedValueOnce(pending);
    const { hook } = await renderController();
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    lines.length = 0;

    await act(async () => {
      await hook.result.current.beginAuthorization();
    });

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining(['intent', 'guard', 'persist', 'apply', 'finish']));
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(1);
    expect(lines.join('')).not.toMatch(/old-key|user-api-secret|ABCD-2345|e{32,}|request=safe|user-api-key\/activate/i);
  });

});
