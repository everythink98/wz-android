import { NativeModules } from 'react-native';
import { errorMessage } from './errors';

export type ManagedLoginCookieSource = 'linuxdo' | 'nodeseek' | 'yaohuo';

export type ManagedCookieReadResult =
  { status: 'ok'; header: string } | { status: 'unsupported' } | { status: 'error'; message: string };

export type ManagedCookieNativeModule = {
  readManagedCookieHeader?: (exactUrl: string) => Promise<unknown>;
  clearManagedLoginCookies?: (source: ManagedLoginCookieSource) => Promise<boolean>;
};

export function managedCookieHeaderOrThrow(result: ManagedCookieReadResult) {
  if (result.status === 'ok') return result.header;
  throw new Error(result.status === 'unsupported' ? '当前安装包不支持读取 WebView Cookie' : result.message);
}

function nativeManagedCookieModule() {
  return NativeModules?.NetworkProxyModule as ManagedCookieNativeModule | undefined;
}

export async function readManagedCookieHeader(
  exactUrl: string,
  module: ManagedCookieNativeModule | undefined = nativeManagedCookieModule()
): Promise<ManagedCookieReadResult> {
  if (typeof module?.readManagedCookieHeader !== 'function') {
    return { status: 'unsupported' };
  }
  try {
    const result = await module.readManagedCookieHeader(exactUrl);
    if (!result || typeof result !== 'object') {
      return { status: 'error', message: 'WebView Cookie 读取结果无效' };
    }
    const value = result as { status?: unknown; header?: unknown; message?: unknown };
    if (value.status === 'unsupported') {
      return { status: 'unsupported' };
    }
    if (value.status === 'ok' && (value.header === undefined || typeof value.header === 'string')) {
      return { status: 'ok', header: value.header || '' };
    }
    return {
      status: 'error',
      message: typeof value.message === 'string' && value.message ? value.message : 'WebView Cookie 读取结果无效'
    };
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }
}

export async function clearManagedLoginCookies(
  source: ManagedLoginCookieSource,
  module: ManagedCookieNativeModule | undefined = nativeManagedCookieModule()
) {
  if (typeof module?.clearManagedLoginCookies !== 'function') {
    throw new Error('当前安装包不支持清除登录 Cookie');
  }
  const cleared = await module.clearManagedLoginCookies(source);
  if (!cleared) {
    throw new Error('登录 Cookie 删除未确认');
  }
  return true;
}
