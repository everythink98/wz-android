import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const savedProxyState = {
  enabled: true,
  activeId: 'proxy-1',
  profiles: [{
    id: 'proxy-1',
    name: 'Proxy',
    protocol: 'socks5' as const,
    host: 'proxy.example.com',
    port: 1080
  }]
};

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getNetworkProxyStatus: vi.fn(),
  recoverNetworkConnectionPool: vi.fn(),
  saveNetworkProxyState: vi.fn(),
  setApplyError: vi.fn(),
  setApplyStatus: vi.fn(),
  stateIndex: 0
}));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useLayoutEffect: (effect: () => void) => { effect(); },
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: () => {
    const index = mocks.stateIndex++;
    const states = [
      [savedProxyState, vi.fn()],
      [true, vi.fn()],
      ['applied', mocks.setApplyStatus],
      ['', mocks.setApplyError],
      [0, vi.fn()]
    ] as const;
    return states[index];
  }
}));

vi.mock('../networkProxy', () => ({
  activeNetworkProxyProfile: (state: typeof savedProxyState) => state.profiles.find((profile) => profile.id === state.activeId) || null,
  applyNetworkProxy: vi.fn(),
  createEmptyNetworkProxyState: () => ({ enabled: false, activeId: null, profiles: [] }),
  createNetworkProxyProfile: (profile: typeof savedProxyState.profiles[number]) => profile,
  getNetworkProxyStatus: mocks.getNetworkProxyStatus,
  loadNetworkProxyState: vi.fn(),
  MAX_NETWORK_PROXY_PROFILES: 10,
  networkProxySummary: () => 'SOCKS5',
  recoverNetworkConnectionPool: mocks.recoverNetworkConnectionPool,
  removeNetworkProxyProfile: vi.fn(),
  saveNetworkProxyState: mocks.saveNetworkProxyState,
  testNetworkProxy: vi.fn(),
  validateNetworkProxyProfile: () => ({})
}));

import { setDiagnosticWriter } from '../diagnostics';
import { useNetworkProxyController } from './useNetworkProxyController';

beforeEach(() => {
  mocks.stateIndex = 0;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.saveNetworkProxyState.mockImplementation(async (state) => state);
  setDiagnosticWriter(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('network proxy native health guard', () => {
  it('coalesces concurrent connection-pool recovery across forum sources', async () => {
    const nativeRecovery = Promise.withResolvers<void>();
    mocks.recoverNetworkConnectionPool.mockReturnValueOnce(nativeRecovery.promise);
    const controller = useNetworkProxyController({ notify: vi.fn() });

    const linuxDoRecovery = controller.recoverNetworkConnectionPool({
      source: 'linuxdo',
      reason: 'direct-timeout',
      url: 'https://linux.do/latest.json'
    });
    const yaohuoRecovery = controller.recoverNetworkConnectionPool({
      source: 'yaohuo',
      reason: 'direct-timeout',
      url: 'https://www.yaohuo.me/bbs/'
    });

    await vi.waitFor(() => expect(mocks.recoverNetworkConnectionPool).toHaveBeenCalledTimes(1));
    nativeRecovery.resolve();
    await expect(Promise.all([linuxDoRecovery, yaohuoRecovery])).resolves.toEqual([undefined, undefined]);

    await controller.recoverNetworkConnectionPool({
      source: 'v2ex',
      reason: 'direct-error',
      url: 'https://www.v2ex.com/recent'
    });
    expect(mocks.recoverNetworkConnectionPool).toHaveBeenCalledTimes(2);
  });

  it('expires a hung native recovery so a later recovery can start', async () => {
    vi.useFakeTimers();
    const hungRecovery = Promise.withResolvers<void>();
    mocks.recoverNetworkConnectionPool
      .mockReturnValueOnce(hungRecovery.promise)
      .mockResolvedValueOnce(undefined);
    const controller = useNetworkProxyController({ notify: vi.fn() });

    const firstRecovery = controller.recoverNetworkConnectionPool({
      source: 'linuxdo',
      reason: 'direct-timeout',
      url: 'https://linux.do/latest.json'
    });
    const rejection = expect(firstRecovery).rejects.toThrow('请求超时');
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;

    await expect(controller.recoverNetworkConnectionPool({
      source: 'v2ex',
      reason: 'direct-error',
      url: 'https://www.v2ex.com/recent'
    })).resolves.toBeUndefined();
    expect(mocks.recoverNetworkConnectionPool).toHaveBeenCalledTimes(2);
    hungRecovery.resolve();
  });

  it('marks the applied proxy failed and blocks fetch when the native listener has died', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.getNetworkProxyStatus.mockResolvedValueOnce({
      ok: false,
      message: '本机代理监听异常，网络已阻断'
    });
    const controller = useNetworkProxyController({ notify: vi.fn() });

    await expect(controller.networkProxyFetcher('https://example.com')).rejects.toThrow('本机代理监听异常，网络已阻断');

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.setApplyStatus).toHaveBeenCalledWith('failed');
    expect(mocks.setApplyError).toHaveBeenCalledWith('本机代理监听异常，网络已阻断');
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'proxy', operation: 'guard', phase: 'finish', outcome: 'blocked' })
    ]));
  });

  it('does not let a stale health response fail a newer proxy transition', async () => {
    const health = Promise.withResolvers<{ ok: false; message: string }>();
    mocks.getNetworkProxyStatus.mockReturnValueOnce(health.promise);
    const controller = useNetworkProxyController({ notify: vi.fn() });
    const request = controller.networkProxyFetcher('https://example.com');
    await vi.waitFor(() => expect(mocks.getNetworkProxyStatus).toHaveBeenCalledTimes(1));

    await controller.upsertProxyProfile({
      ...savedProxyState.profiles[0],
      name: 'New Proxy'
    });
    health.resolve({ ok: false, message: '旧监听器已失效' });

    await expect(request).rejects.not.toThrow('旧监听器已失效');
    expect(mocks.setApplyStatus).not.toHaveBeenCalledWith('failed');
  });
});
