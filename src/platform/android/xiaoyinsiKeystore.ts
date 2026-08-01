import { NativeModules, Platform } from 'react-native';

export type XiaoyinsiKeystore = {
  getPublicKey: () => Promise<string>;
  randomHex: (byteCount: number) => Promise<string>;
  decrypt: (payload: string) => Promise<string>;
  deleteKey: () => Promise<boolean>;
};

type NativeXiaoyinsiAuthModule = {
  getPublicKey?: () => Promise<string>;
  randomHex?: (byteCount: number) => Promise<string>;
  decrypt?: (payload: string) => Promise<string>;
  deleteKey?: () => Promise<boolean>;
};

function nativeModule() {
  return NativeModules.XiaoyinsiAuthModule as NativeXiaoyinsiAuthModule | undefined;
}

function requireMethod<K extends keyof NativeXiaoyinsiAuthModule>(name: K) {
  const method = nativeModule()?.[name];
  if (Platform.OS !== 'android' || typeof method !== 'function') {
    throw new Error('当前安装包不支持小隐寺安全授权，请更新后重试。');
  }
  return method.bind(nativeModule()) as NonNullable<NativeXiaoyinsiAuthModule[K]>;
}

export function nativeSecureRandomHex(byteCount: number) {
  return requireMethod('randomHex')(byteCount);
}

export const xiaoyinsiKeystore: XiaoyinsiKeystore = {
  getPublicKey: () => requireMethod('getPublicKey')(),
  randomHex: nativeSecureRandomHex,
  decrypt: (payload) => requireMethod('decrypt')(payload),
  deleteKey: () => requireMethod('deleteKey')()
};
