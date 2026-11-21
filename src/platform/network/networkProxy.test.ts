import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));

vi.mock('react-native', () => ({
  NativeModules: {}
}));

import * as SecureStore from 'expo-secure-store';
import { beginDiagnosticTrace, setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import {
  NETWORK_PROXY_STORAGE_KEY,
  activeNetworkRoute,
  applyNetworkProxy,
  createNetworkProxyProfile,
  loadNetworkProxyState,
  networkProxyModuleFromReactNativeImport,
  networkProxySummary,
  networkMode,
  networkProxyWebViewBlockMessage,
  normalizeNetworkProxyState,
  removeNetworkProxyProfile,
  releaseReadNetworkRuntimeGeneration,
  recoverReadNetworkRuntime,
  retainReadNetworkRuntimeGeneration,
  saveNetworkProxyState,
  testEncryptedDns,
  testNetworkProxy,
  validateNetworkProxyProfile,
  type NetworkProxyProfile
} from './networkProxy';
import { getReadNetworkRuntimeSnapshot } from './readNetworkRuntime';

it.each([
  [200, true, '站点验证'],
  [403, true, '站点验证'],
  [503, false, 'HTTP 503']
] as const)(
  'distinguishes a forum response from an open page (%i, challenge %s)',
  async (httpStatus, siteChallenge, message) => {
    const bridge = { testEncryptedDns: async () => ({ ok: true, httpStatus, siteChallenge }) };
    await expect(testEncryptedDns({ provider: 'auto', policy: 'strict' }, bridge)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(message)
    });
  }
);

const socksProfile: NetworkProxyProfile = {
  id: 'tg',
  name: 'TG',
  protocol: 'socks5',
  host: 'proxy.example.com',
  port: 1080,
  username: 'demo-user',
  password: 'demo-password'
};

describe('network proxy settings', () => {
  beforeEach(() => {
    vi.mocked(SecureStore.getItemAsync).mockReset();
    vi.mocked(SecureStore.setItemAsync).mockReset();
  });

  it('restores automatic DoH with all public presets and keeps strict mode across the native boundary', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(
      JSON.stringify({
        enabled: false,
        activeId: null,
        mode: 'doh',
        profiles: [],
        encryptedDns: { provider: 'auto', policy: 'strict' }
      })
    );
    const restored = await loadNetworkProxyState();
    const applyProxy = vi.fn(async () => ({ ok: true }));
    await applyNetworkProxy(activeNetworkRoute(restored), { applyProxy });
    expect(applyProxy).toHaveBeenCalledWith({
      allowFallback: false,
      providers: [
        expect.objectContaining({ id: 'dnspod', endpoint: 'https://doh.pub/dns-query' }),
        expect.objectContaining({ id: 'cloudflare', endpoint: 'https://cloudflare-dns.com/dns-query' }),
        expect.objectContaining({ id: 'google', endpoint: 'https://dns.google/dns-query' }),
        expect.objectContaining({ id: 'dnssb', endpoint: 'https://doh.dns.sb/dns-query' }),
        expect.objectContaining({ id: '360', endpoint: 'https://doh.360.cn/dns-query' }),
        expect.objectContaining({ id: '18bit', endpoint: 'https://doh.18bit.cn/dns-query' }),
        expect.objectContaining({ id: 'onedns', endpoint: 'https://doh.onedns.net/dns-query' }),
        expect.objectContaining({ id: 'cfluxdo', endpoint: 'https://edge.1molchuan.top/linuxdo' })
      ]
    });
  });

  it.each([
    ['dnspod', 'https://doh.pub/dns-query', []],
    [
      'cloudflare',
      'https://cloudflare-dns.com/dns-query',
      ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001']
    ],
    ['google', 'https://dns.google/dns-query', ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844']],
    ['dnssb', 'https://doh.dns.sb/dns-query', []],
    ['360', 'https://doh.360.cn/dns-query', []],
    ['18bit', 'https://doh.18bit.cn/dns-query', []],
    ['onedns', 'https://doh.onedns.net/dns-query', []],
    [
      'cfluxdo',
      'https://edge.1molchuan.top/linuxdo',
      ['156.239.232.8', '156.239.232.72', '203.168.131.145', '103.199.103.204']
    ]
  ] as const)(
    'restores the %s DoH route without losing the legacy proxy profile',
    async (provider, endpoint, bootstrap) => {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(
        JSON.stringify({ enabled: true, activeId: socksProfile.id, profiles: [socksProfile] })
      );
      const legacy = await loadNetworkProxyState();
      expect(networkMode(legacy)).toBe('proxy');
      expect(activeNetworkRoute(legacy)).toEqual(socksProfile);
      const settings = await saveNetworkProxyState({
        ...legacy,
        enabled: false,
        mode: 'doh',
        encryptedDns: { provider, policy: 'strict' }
      });
      vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(JSON.stringify(settings));
      const restored = await loadNetworkProxyState();
      expect(networkMode(restored)).toBe('doh');
      expect(activeNetworkRoute(restored)).toEqual({
        endpoint,
        bootstrap,
        allowFallback: false
      });
      expect(restored.profiles).toEqual([socksProfile]);
      expect(restored.activeId).toBe(socksProfile.id);
    }
  );

  it('validates HTTP and SOCKS5 proxy profiles with optional credentials', () => {
    expect(
      validateNetworkProxyProfile({
        id: 'http',
        name: 'HTTP',
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080
      })
    ).toEqual({});
    expect(validateNetworkProxyProfile(socksProfile)).toEqual({});
    expect(
      createNetworkProxyProfile({
        name: 'No Password',
        protocol: 'socks5',
        host: 'proxy.example.com',
        port: 1080,
        username: '',
        password: ''
      })
    ).toHaveProperty('password', undefined);
  });

  it('rejects invalid hosts and ports before saving', () => {
    expect(
      validateNetworkProxyProfile({
        name: '',
        protocol: 'socks5',
        host: 'https://proxy.example.com/path',
        port: 70000
      })
    ).toMatchObject({
      name: '请填写名称',
      host: '服务器只填 IP 或域名',
      port: '端口必须是 1-65535'
    });
    expect(
      validateNetworkProxyProfile({
        name: 'Bad IP',
        protocol: 'socks5',
        host: '999.999.999.999',
        port: 1080
      })
    ).toMatchObject({
      host: '服务器 IP 格式不正确'
    });
  });

  it('turns proxy off when deleting the active profile', () => {
    const state = {
      enabled: true,
      activeId: socksProfile.id,
      profiles: [socksProfile]
    };

    const next = removeNetworkProxyProfile(state, socksProfile.id);

    expect(next.enabled).toBe(false);
    expect(next.activeId).toBeNull();
    expect(next.profiles).toEqual([]);
    expect(networkProxySummary(next)).toBe('未启用');
  });

  it('does not leave enabled state without an active profile', () => {
    const state = normalizeNetworkProxyState({
      enabled: true,
      activeId: 'missing',
      profiles: [socksProfile]
    });

    expect(state.enabled).toBe(false);
    expect(state.activeId).toBeNull();
  });

  it.each(['demo-password', ' ', '  demo-password  '])(
    'preserves password %j through SecureStore and Native apply/probe',
    async (password) => {
      const profile = createNetworkProxyProfile({ ...socksProfile, password });
      const state = {
        enabled: true,
        activeId: profile.id,
        profiles: [profile]
      };
      await saveNetworkProxyState(state);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(NETWORK_PROXY_STORAGE_KEY, JSON.stringify(state));
      vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(JSON.stringify(state));
      const restored = (await loadNetworkProxyState()).profiles[0];
      expect(restored).toEqual(profile);
      const applyProxy = vi.fn().mockResolvedValue({ ok: true });
      const testProxy = vi.fn().mockResolvedValue({ ok: true });
      const module = { applyProxy, testProxy };

      await applyNetworkProxy(restored, module);
      await testNetworkProxy(restored, module);
      expect(applyProxy).toHaveBeenCalledWith(expect.objectContaining({ password }));
      expect(testProxy).toHaveBeenCalledWith(expect.objectContaining({ password }));
    }
  );

  it('rejects a corrupted saved proxy value instead of silently allowing direct traffic', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('{broken-json');

    await expect(loadNetworkProxyState()).rejects.toThrow('代理配置已损坏');
  });

  it.each([
    '',
    'null',
    '[]',
    '{}',
    JSON.stringify({ enabled: 'true', activeId: null, profiles: [] }),
    JSON.stringify({ enabled: true, activeId: 'missing', profiles: [] }),
    JSON.stringify({ enabled: true, activeId: 'tg', profiles: [{ ...socksProfile, protocol: 'broken' }] }),
    JSON.stringify({ enabled: true, activeId: 'tg', profiles: [{ ...socksProfile, port: '1080' }] }),
    JSON.stringify({ enabled: true, activeId: 'tg', profiles: [socksProfile, socksProfile] })
  ])('rejects malformed persisted configuration %s without overwriting it', async (raw) => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(raw);
    await expect(loadNetworkProxyState()).rejects.toThrow('代理配置已损坏');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('distinguishes a first launch and explicit disable from corrupt configuration', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
    await expect(loadNetworkProxyState()).resolves.toEqual({ enabled: false, activeId: null, profiles: [] });
    for (const enabled of [true, false]) {
      const saved = { enabled, activeId: socksProfile.id, profiles: [socksProfile] };
      vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(JSON.stringify(saved));
      await expect(loadNetworkProxyState()).resolves.toEqual(saved);
    }
  });

  it('keeps WebViews blocked throughout enabled and disabled proxy transitions', () => {
    expect(
      networkProxyWebViewBlockMessage({
        applyError: '',
        applyStatus: 'applying',
        enabled: true,
        loaded: true
      })
    ).not.toBe('');
    expect(
      networkProxyWebViewBlockMessage({
        applyError: '',
        applyStatus: 'applying',
        enabled: false,
        loaded: true
      })
    ).not.toBe('');
    expect(
      networkProxyWebViewBlockMessage({
        applyError: '',
        applyStatus: 'disabled',
        enabled: false,
        loaded: true
      })
    ).toBe('');
  });

  it('blocks enabled proxy mode when the native module is missing', async () => {
    await expect(applyNetworkProxy(socksProfile, undefined)).rejects.toThrow('当前安装包不支持服务器代理。');
    await expect(applyNetworkProxy(null, undefined)).resolves.toEqual({ ok: true });
  });

  it('uses the native module returned by React Native dynamic imports', async () => {
    const applyProxy = vi.fn().mockResolvedValue({ ok: true, port: 8123 });
    const testProxy = vi.fn().mockResolvedValue({ ok: true, latencyMs: 123 });
    const module = networkProxyModuleFromReactNativeImport({
      default: { NativeModules: { NetworkProxyModule: { applyProxy, testProxy } } }
    });

    await expect(applyNetworkProxy(socksProfile, module)).resolves.toEqual({ ok: true, port: 8123 });
    await expect(testNetworkProxy(socksProfile, module)).resolves.toEqual({ ok: true, latencyMs: 123 });
    expect(applyProxy).toHaveBeenCalledWith(socksProfile);
    expect(testProxy).toHaveBeenCalledWith(socksProfile);
  });

  it('keeps read-channel recovery single-flight across sources for one generation', async () => {
    const before = getReadNetworkRuntimeSnapshot();
    const recover = vi.fn(async (_source: string, expectedGeneration: number) => ({
      ok: true,
      rotated: true,
      previousGeneration: expectedGeneration,
      generation: expectedGeneration + 1,
      canceledQueued: 1,
      canceledRunning: 1
    }));
    const acknowledgeReadNetworkRuntimeApply = vi.fn(async () => true);
    const module = { acknowledgeReadNetworkRuntimeApply, recoverForumReadChannel: recover };

    await expect(
      Promise.all([
        recoverReadNetworkRuntime('nodeseek', before.generation, { module }),
        recoverReadNetworkRuntime('nodeseek', before.generation, { module }),
        recoverReadNetworkRuntime('linuxdo', before.generation, { module })
      ])
    ).resolves.toEqual([
      expect.objectContaining({ generation: before.generation + 1 }),
      expect.objectContaining({ generation: before.generation + 1 }),
      expect.objectContaining({ generation: before.generation + 1 })
    ]);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith('nodeseek', before.generation, expect.stringMatching(/^trace-/));
    expect(getReadNetworkRuntimeSnapshot()).toEqual({
      generation: before.generation + 1,
      triggerSource: 'nodeseek'
    });
    expect(acknowledgeReadNetworkRuntimeApply).toHaveBeenCalledWith(
      expect.stringMatching(/^trace-/),
      before.generation,
      before.generation + 1
    );
  });

  it('rejects an invalid expected generation before crossing the Native recovery seam', async () => {
    const before = getReadNetworkRuntimeSnapshot();
    const recoverForumReadChannel = vi.fn();
    const module = {
      acknowledgeReadNetworkRuntimeApply: vi.fn(async () => true),
      recoverForumReadChannel
    };

    await expect(recoverReadNetworkRuntime('nodeseek', -1, { module })).rejects.toThrow(
      '读取网络运行时 generation 无效'
    );
    await expect(recoverReadNetworkRuntime('linuxdo', before.generation + 1, { module })).rejects.toThrow(
      '读取网络运行时 generation 无效'
    );

    expect(recoverForumReadChannel).not.toHaveBeenCalled();
    expect(getReadNetworkRuntimeSnapshot()).toEqual(before);
  });

  it('reuses the initiating recovery trace across Native publication and JS state apply', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('network', 'rotate-read-runtime', {
      source: 'nodeseek',
      reason: 'timeout'
    });
    const before = getReadNetworkRuntimeSnapshot();
    const recover = vi.fn(async (_source: string, expectedGeneration: number, _traceId: string) => ({
      ok: true,
      rotated: true,
      previousGeneration: expectedGeneration,
      generation: expectedGeneration + 1,
      canceledQueued: 0,
      canceledRunning: 1
    }));
    const acknowledgeReadNetworkRuntimeApply = vi.fn(async () => {
      const events = lines.map((line) => JSON.parse(line));
      expect(events.at(-1)?.phase).toBe('apply');
      return true;
    });

    try {
      await recoverReadNetworkRuntime('nodeseek', before.generation, {
        module: { acknowledgeReadNetworkRuntimeApply, recoverForumReadChannel: recover },
        trace
      });

      expect(recover).toHaveBeenCalledWith('nodeseek', before.generation, trace.traceId);
      const events = lines.map((line) => JSON.parse(line));
      expect(new Set(events.map((event) => event.traceId))).toEqual(new Set([trace.traceId]));
      expect(events.map((event) => event.phase)).toEqual(['intent', 'apply']);
      expect(acknowledgeReadNetworkRuntimeApply).toHaveBeenCalledWith(
        trace.traceId,
        before.generation,
        before.generation + 1
      );
    } finally {
      setDiagnosticWriter(null);
    }
  });

  it('keeps the generation retryable when native publication fails', async () => {
    const before = getReadNetworkRuntimeSnapshot();
    const recover = vi
      .fn()
      .mockRejectedValueOnce(new Error('Glide publication failed'))
      .mockImplementationOnce(async (source: string, expectedGeneration: number) => ({
        ok: true,
        rotated: true,
        previousGeneration: expectedGeneration,
        generation: expectedGeneration + 1,
        canceledQueued: 0,
        canceledRunning: 0,
        source
      }));
    const module = { acknowledgeReadNetworkRuntimeApply: vi.fn(async () => true), recoverForumReadChannel: recover };

    await expect(recoverReadNetworkRuntime('yaohuo', before.generation, { module })).rejects.toThrow(
      'Glide publication failed'
    );
    expect(getReadNetworkRuntimeSnapshot()).toEqual(before);
    await expect(recoverReadNetworkRuntime('yaohuo', before.generation, { module })).resolves.toEqual(
      expect.objectContaining({ generation: before.generation + 1 })
    );
    expect(recover).toHaveBeenNthCalledWith(1, 'yaohuo', before.generation, expect.stringMatching(/^trace-/));
    expect(recover).toHaveBeenNthCalledWith(2, 'yaohuo', before.generation, expect.stringMatching(/^trace-/));
  });

  it('keeps a published recovery successful when only the diagnostic apply ack fails', async () => {
    const before = getReadNetworkRuntimeSnapshot();
    const result = {
      ok: true,
      rotated: true,
      previousGeneration: before.generation,
      generation: before.generation + 1,
      canceledQueued: 0,
      canceledRunning: 0
    };
    const module = {
      acknowledgeReadNetworkRuntimeApply: vi.fn(async () => {
        throw new Error('diagnostic bridge unavailable');
      }),
      recoverForumReadChannel: vi.fn(async () => result)
    };

    await expect(recoverReadNetworkRuntime('linuxdo', before.generation, { module })).resolves.toEqual(result);
    expect(getReadNetworkRuntimeSnapshot()).toEqual({
      generation: result.generation,
      triggerSource: 'linuxdo'
    });
  });

  it('retains and releases a generation for a healthy long-lived media owner', async () => {
    const retain = vi.fn(async (generation: number) => ({ generation, retained: true }));
    const release = vi.fn(async () => true);
    const module = {
      retainReadNetworkGeneration: retain,
      releaseReadNetworkGeneration: release
    };

    await expect(retainReadNetworkRuntimeGeneration(7, module)).resolves.toEqual({ generation: 7, retained: true });
    await expect(releaseReadNetworkRuntimeGeneration(7, module)).resolves.toBe(true);
    expect(retain).toHaveBeenCalledWith(7);
    expect(release).toHaveBeenCalledWith(7);
    await expect(retainReadNetworkRuntimeGeneration(-1, module)).resolves.toBeNull();
    await expect(releaseReadNetworkRuntimeGeneration(Number.NaN, module)).resolves.toBe(false);

    retain.mockResolvedValueOnce({ generation: 8, retained: false });
    await expect(retainReadNetworkRuntimeGeneration(7, module)).resolves.toEqual({ generation: 8, retained: false });
  });

  it('rejects a native success claim that did not publish a newer generation', async () => {
    const before = getReadNetworkRuntimeSnapshot();
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const module = {
      acknowledgeReadNetworkRuntimeApply: vi.fn(async () => true),
      recoverForumReadChannel: vi.fn(async () => ({
        ok: true,
        rotated: false,
        previousGeneration: before.generation,
        generation: before.generation,
        canceledQueued: 0,
        canceledRunning: 0
      }))
    };

    try {
      await expect(recoverReadNetworkRuntime('v2ex', before.generation, { module })).rejects.toThrow(
        '读取网络运行时自愈失败'
      );
      expect(getReadNetworkRuntimeSnapshot()).toEqual(before);
      const events = lines.map((line) => JSON.parse(line));
      expect(events.map((event) => event.phase)).toEqual(['intent', 'finish']);
      expect(events.at(-1)).toEqual(expect.objectContaining({ outcome: 'failure', reason: 'invalid_response' }));
    } finally {
      setDiagnosticWriter(null);
    }
  });
});
