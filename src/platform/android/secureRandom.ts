import { NativeModules, Platform } from 'react-native';

type NativeSecureRandomModule = {
  randomHex?: (byteCount: number) => Promise<string>;
};

function nativeModule() {
  return NativeModules.SecureRandomModule as NativeSecureRandomModule | undefined;
}

export function nativeSecureRandomHex(byteCount: number) {
  const method = nativeModule()?.randomHex;
  if (Platform.OS !== 'android' || typeof method !== 'function') {
    throw new Error('当前安装包不支持安全随机数，请更新后重试。');
  }
  return method.call(nativeModule(), byteCount);
}
