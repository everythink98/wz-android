import * as SecureStore from 'expo-secure-store';
import { NativeModules } from 'react-native';

export const NETWORK_PROXY_STORAGE_KEY = 'network-proxy-settings';
export const MAX_NETWORK_PROXY_PROFILES = 10;

export type NetworkProxyProtocol = 'http' | 'socks5';

export type NetworkProxyProfile = {
  id: string;
  name: string;
  protocol: NetworkProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export type NetworkProxyState = {
  enabled: boolean;
  activeId: string | null;
  profiles: NetworkProxyProfile[];
};

export type NetworkProxyStatus = {
  ok: boolean;
  port?: number;
  latencyMs?: number;
  message?: string;
};

export type NativeNetworkProxyModule = {
  applyProxy?: (profile: NetworkProxyProfile | null) => Promise<NetworkProxyStatus>;
  getStatus?: () => Promise<NetworkProxyStatus>;
  recoverNetworkConnectionPool?: () => Promise<NetworkProxyStatus>;
  /** @deprecated Kept for compatibility with previously generated native builds. */
  recoverNodeSeekNetwork?: () => Promise<NetworkProxyStatus>;
  testProxy?: (profile: NetworkProxyProfile) => Promise<NetworkProxyStatus>;
};

export function createEmptyNetworkProxyState(): NetworkProxyState {
  return {
    enabled: false,
    activeId: null,
    profiles: []
  };
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanProtocol(value: unknown): NetworkProxyProtocol {
  return value === 'socks5' ? 'socks5' : 'http';
}

function cleanPort(value: unknown) {
  const port = typeof value === 'number' ? value : Number(String(value || '').trim());
  return Number.isInteger(port) ? port : 0;
}

function isInvalidIpv4Literal(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
    && value.split('.').some((part) => Number(part) > 255);
}

function cleanProfile(value: unknown): NetworkProxyProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const input = value as Partial<NetworkProxyProfile>;
  const profile = {
    id: cleanText(input.id),
    name: cleanText(input.name),
    protocol: cleanProtocol(input.protocol),
    host: cleanText(input.host),
    port: cleanPort(input.port),
    username: cleanText(input.username) || undefined,
    password: typeof input.password === 'string' ? input.password : undefined
  };
  return profile.id ? profile : null;
}

export function normalizeNetworkProxyState(value: unknown): NetworkProxyState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyNetworkProxyState();
  }
  const input = value as Partial<NetworkProxyState>;
  const seen = new Set<string>();
  const profiles = (Array.isArray(input.profiles) ? input.profiles : [])
    .map(cleanProfile)
    .filter((profile): profile is NetworkProxyProfile => Boolean(profile))
    .filter((profile) => {
      if (seen.has(profile.id)) {
        return false;
      }
      seen.add(profile.id);
      return true;
    })
    .slice(0, MAX_NETWORK_PROXY_PROFILES);
  const activeId = cleanText(input.activeId);
  const hasActive = activeId && profiles.some((profile) => profile.id === activeId);
  return {
    enabled: Boolean(input.enabled && hasActive),
    activeId: hasActive ? activeId : null,
    profiles
  };
}

function parseStoredNetworkProxyState(raw: string): NetworkProxyState {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('代理设置存储格式无效');
  }
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== 'boolean'
    || (input.activeId !== null && typeof input.activeId !== 'string')
    || !Array.isArray(input.profiles)
    || input.profiles.length > MAX_NETWORK_PROXY_PROFILES) {
    throw new Error('代理设置存储格式无效');
  }
  const profiles = input.profiles.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('代理设置存储格式无效');
    }
    const profile = value as Record<string, unknown>;
    if (typeof profile.id !== 'string'
      || typeof profile.name !== 'string'
      || (profile.protocol !== 'http' && profile.protocol !== 'socks5')
      || typeof profile.host !== 'string'
      || typeof profile.port !== 'number'
      || !Number.isInteger(profile.port)
      || (profile.username !== undefined && typeof profile.username !== 'string')
      || (profile.password !== undefined && typeof profile.password !== 'string')) {
      throw new Error('代理设置存储格式无效');
    }
    const clean = cleanProfile(profile);
    if (!clean || hasNetworkProxyProfileErrors(clean)) {
      throw new Error('代理设置存储格式无效');
    }
    return clean;
  });
  const ids = new Set(profiles.map(({ id }) => id));
  const activeId = cleanText(input.activeId);
  if (ids.size !== profiles.length
    || (activeId && !ids.has(activeId))
    || (input.enabled && !activeId)) {
    throw new Error('代理设置存储格式无效');
  }
  return {
    enabled: input.enabled,
    activeId: activeId || null,
    profiles
  };
}

export function validateNetworkProxyProfile(profile: Partial<NetworkProxyProfile>) {
  const errors: Partial<Record<keyof NetworkProxyProfile, string>> = {};
  const name = cleanText(profile.name);
  const host = cleanText(profile.host);
  const port = cleanPort(profile.port);
  const username = cleanText(profile.username);
  const password = typeof profile.password === 'string' ? profile.password : '';
  if (!name) {
    errors.name = '请填写名称';
  } else if (name.length > 32) {
    errors.name = '名称不能超过 32 个字';
  }
  if (profile.protocol !== 'http' && profile.protocol !== 'socks5') {
    errors.protocol = '请选择代理类型';
  }
  if (!host) {
    errors.host = '请填写服务器';
  } else if (isInvalidIpv4Literal(host)) {
    errors.host = '服务器 IP 格式不正确';
  } else if (/^https?:\/\//i.test(host) || host.includes('/') || host.includes('@')) {
    errors.host = '服务器只填 IP 或域名';
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = '端口必须是 1-65535';
  }
  if (username.length > 255) {
    errors.username = '用户名不能超过 255 个字';
  }
  if (password.length > 255) {
    errors.password = '密码不能超过 255 个字';
  }
  return errors;
}

export function hasNetworkProxyProfileErrors(profile: Partial<NetworkProxyProfile>) {
  return Object.keys(validateNetworkProxyProfile(profile)).length > 0;
}

export function activeNetworkProxyProfile(state: NetworkProxyState) {
  return state.activeId ? state.profiles.find((profile) => profile.id === state.activeId) || null : null;
}

export function removeNetworkProxyProfile(state: NetworkProxyState, id: string) {
  const deletingActive = state.activeId === id;
  return normalizeNetworkProxyState({
    enabled: deletingActive ? false : state.enabled,
    activeId: deletingActive ? null : state.activeId,
    profiles: state.profiles.filter((profile) => profile.id !== id)
  });
}

export function networkProxySummary(state: NetworkProxyState, applyError = '') {
  const active = activeNetworkProxyProfile(state);
  if (applyError) {
    return '代理异常';
  }
  if (!state.enabled || !active) {
    return '未启用';
  }
  return `${active.protocol === 'socks5' ? 'SOCKS5' : 'HTTP'} · ${active.host}:${active.port}`;
}

export function networkProxyModuleFromReactNativeImport(mod: any): NativeNetworkProxyModule | undefined {
  const nativeModules = mod?.NativeModules || mod?.default?.NativeModules;
  return nativeModules?.NetworkProxyModule as NativeNetworkProxyModule | undefined;
}

function networkProxyNativeModule() {
  return networkProxyModuleFromReactNativeImport({ NativeModules });
}

export async function loadNetworkProxyState() {
  const raw = await SecureStore.getItemAsync(NETWORK_PROXY_STORAGE_KEY);
  if (raw === null) {
    return createEmptyNetworkProxyState();
  }
  return parseStoredNetworkProxyState(raw);
}

export async function saveNetworkProxyState(state: NetworkProxyState) {
  const clean = normalizeNetworkProxyState(state);
  await SecureStore.setItemAsync(NETWORK_PROXY_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export async function applyNetworkProxy(profile: NetworkProxyProfile | null, module = networkProxyNativeModule()) {
  if (!module?.applyProxy) {
    if (profile) {
      throw new Error('当前安装包不支持服务器代理。');
    }
    return { ok: true } satisfies NetworkProxyStatus;
  }
  const result = await module.applyProxy(profile);
  if (!result?.ok) {
    throw new Error(result?.message || '代理启动失败');
  }
  return result;
}

export async function getNetworkProxyStatus(module = networkProxyNativeModule()) {
  if (!module?.getStatus) {
    return {
      ok: false,
      message: '当前安装包不支持代理状态检查。'
    } satisfies NetworkProxyStatus;
  }
  const result = await module.getStatus();
  return result?.ok
    ? result
    : {
        ok: false,
        message: result?.message || '代理异常，网络已阻断。'
      } satisfies NetworkProxyStatus;
}

export async function recoverNetworkConnectionPool(module = networkProxyNativeModule()) {
  if (!module?.recoverNetworkConnectionPool && !module?.recoverNodeSeekNetwork) {
    return { ok: true } satisfies NetworkProxyStatus;
  }
  const result = module.recoverNetworkConnectionPool
    ? await module.recoverNetworkConnectionPool()
    : await module.recoverNodeSeekNetwork!();
  if (!result?.ok) {
    throw new Error(result?.message || '请求通道恢复失败');
  }
  return result;
}

/** @deprecated Use recoverNetworkConnectionPool. */
export async function recoverNodeSeekNetwork(module = networkProxyNativeModule()) {
  return recoverNetworkConnectionPool(module);
}

export async function testNetworkProxy(profile: NetworkProxyProfile, module = networkProxyNativeModule()) {
  if (hasNetworkProxyProfileErrors(profile)) {
    throw new Error('请先补全代理配置。');
  }
  if (!module?.testProxy) {
    throw new Error('当前安装包不支持测试代理。');
  }
  const startedAt = Date.now();
  const result = await module.testProxy(profile);
  if (!result?.ok) {
    throw new Error(result?.message || '代理测试失败');
  }
  return {
    ...result,
    latencyMs: Number.isFinite(result.latencyMs) ? Math.max(0, Math.round(result.latencyMs || 0)) : Math.max(0, Date.now() - startedAt)
  };
}

export function createNetworkProxyProfile(input: Partial<NetworkProxyProfile>): NetworkProxyProfile {
  return {
    id: input.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanText(input.name),
    protocol: cleanProtocol(input.protocol),
    host: cleanText(input.host),
    port: cleanPort(input.port),
    username: cleanText(input.username) || undefined,
    password: typeof input.password === 'string' && input.password ? input.password : undefined
  };
}
