import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));

vi.mock('react-native', () => ({
  NativeModules: {}
}));

import * as SecureStore from 'expo-secure-store';
import {
  NETWORK_PROXY_STORAGE_KEY,
  applyNetworkProxy,
  createNetworkProxyProfile,
  networkProxyModuleFromReactNativeImport,
  networkProxySummary,
  normalizeNetworkProxyState,
  removeNetworkProxyProfile,
  recoverNodeSeekNetwork,
  saveNetworkProxyState,
  testNetworkProxy,
  validateNetworkProxyProfile,
  type NetworkProxyProfile
} from './networkProxy';

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
    expect(validateNetworkProxyProfile({
      id: 'http',
      name: 'HTTP',
      protocol: 'http',
      host: 'proxy.example.com',
      port: 8080
    })).toEqual({});
    expect(validateNetworkProxyProfile(socksProfile)).toEqual({});
    expect(createNetworkProxyProfile({
      name: 'No Password',
      protocol: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: '',
      password: ''
    })).toHaveProperty('password', undefined);
  });

  it('rejects invalid hosts and ports before saving', () => {
    expect(validateNetworkProxyProfile({
      name: '',
      protocol: 'socks5',
      host: 'https://proxy.example.com/path',
      port: 70000
    })).toMatchObject({
      name: '请填写名称',
      host: '服务器只填 IP 或域名',
      port: '端口必须是 1-65535'
    });
    expect(validateNetworkProxyProfile({
      name: 'Bad IP',
      protocol: 'socks5',
      host: '999.999.999.999',
      port: 1080
    })).toMatchObject({
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

  it('exposes a best-effort NodeSeek network recovery hook from the native module', async () => {
    const recover = vi.fn().mockResolvedValue({ ok: true });
    const module = networkProxyModuleFromReactNativeImport({
      NativeModules: { NetworkProxyModule: { recoverNodeSeekNetwork: recover } }
    });

    await expect(recoverNodeSeekNetwork(module)).resolves.toEqual({ ok: true });

    expect(recover).toHaveBeenCalledTimes(1);
  });
});
