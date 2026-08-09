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
  applyNetworkProxy,
  canStartNetworkContent,
  createNetworkProxyProfile,
  loadNetworkProxyState,
  networkProxyModuleFromReactNativeImport,
  networkProxySummary,
  networkProxyWebViewBlockMessage,
  normalizeNetworkProxyState,
  removeNetworkProxyProfile,
  releaseReadNetworkRuntimeGeneration,
  recoverReadNetworkRuntime,
  retainReadNetworkRuntimeGeneration,
  saveNetworkProxyState,
  testNetworkProxy,
  validateNetworkProxyProfile,
  type NetworkProxyProfile
} from './networkProxy';
import { getReadNetworkRuntimeSnapshot } from './readNetworkRuntime';

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

  it('stores proxy settings only in SecureStore', async () => {
    await saveNetworkProxyState({
      enabled: true,
      activeId: socksProfile.id,
      profiles: [socksProfile]
    });

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      NETWORK_PROXY_STORAGE_KEY,
      expect.stringContaining('demo-password')
    );
  });

  it('[REG-PROXY-001] rejects a corrupted saved proxy value instead of silently allowing direct traffic', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('{broken-json');

    await expect(loadNetworkProxyState()).rejects.toThrow('代理配置已损坏');
  });

  it('[REG-PROXY-004] keeps WebViews blocked throughout enabled and disabled proxy transitions', () => {
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

  it('starts route content only after the persisted proxy decision is settled', () => {
    expect(canStartNetworkContent({ applyStatus: 'loading', enabled: false, loaded: false })).toBe(false);
    expect(canStartNetworkContent({ applyStatus: 'applying', enabled: true, loaded: true })).toBe(false);
    expect(canStartNetworkContent({ applyStatus: 'disabled', enabled: false, loaded: true })).toBe(true);
    expect(canStartNetworkContent({ applyStatus: 'applied', enabled: true, loaded: true })).toBe(true);
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

  it('[REG-PROXY-010] keeps read-channel recovery single-flight across sources for one generation', async () => {
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

  it('[REG-PROXY-010] rejects an invalid expected generation before crossing the Native recovery seam', async () => {
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

  it('[REG-PROXY-010] reuses the initiating recovery trace across Native publication and JS state apply', async () => {
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

  it('[REG-PROXY-010] keeps the generation retryable when native publication fails', async () => {
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

  it('[REG-PROXY-010] keeps a published recovery successful when only the diagnostic apply ack fails', async () => {
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

    await expect(recoverReadNetworkRuntime('xiaoyinsi', before.generation, { module })).resolves.toEqual(result);
    expect(getReadNetworkRuntimeSnapshot()).toEqual({
      generation: result.generation,
      triggerSource: 'xiaoyinsi'
    });
  });

  it('[REG-PROXY-010] retains and releases a generation for a healthy long-lived media owner', async () => {
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

  it('[REG-PROXY-010] rejects a native success claim that did not publish a newer generation', async () => {
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
