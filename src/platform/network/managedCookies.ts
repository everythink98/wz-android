import { NativeModules } from 'react-native';
import { errorMessage } from './errors';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

export type ManagedLoginCookieSource = 'linuxdo' | 'nodeseek' | 'yaohuo';

export type CookieBarrierReason =
  'startup' | 'source-change' | 'surface-open' | 'surface-close' | 'identity-change' | 'explicit-clear';

export type ManagedCookieReadResult =
  { status: 'ok'; header: string } | { status: 'unsupported' } | { status: 'error'; message: string };

export type ManagedCookieNativeModule = {
  setLinuxDoCookieResponseBarrier?: (
    blocked: boolean,
    reason: CookieBarrierReason,
    diagnostics: {
      appSessionId: string;
      traceId: string;
      surfaceGeneration: number;
    }
  ) => Promise<void>;
  readManagedCookieHeader?: (exactUrl: string) => Promise<unknown>;
  clearManagedLoginCookies?: (
    source: ManagedLoginCookieSource,
    diagnostics: { appSessionId?: string; traceId?: string }
  ) => Promise<boolean>;
};

export async function setLinuxDoCookieResponseBarrier(
  blocked: boolean,
  reason: CookieBarrierReason,
  surfaceGeneration = 0,
  module: ManagedCookieNativeModule | undefined = NativeModules.NetworkProxyModule
): Promise<void> {
  const fields = { source: 'linuxdo', cookieBarrierReason: reason, surfaceGeneration, isBlocked: blocked } as const;
  const trace = beginDiagnosticTrace('credential', 'cookie-barrier', fields);
  try {
    if (!module?.setLinuxDoCookieResponseBarrier) throw new Error('登录会话交接不可用，请更新安装包后重试');
    await module.setLinuxDoCookieResponseBarrier(blocked, reason, {
      appSessionId: trace.appSessionId,
      traceId: trace.traceId,
      surfaceGeneration
    });
    finishDiagnosticTrace(trace, 'success', fields);
  } catch (error) {
    finishDiagnosticTrace(trace, 'failure', fields);
    throw error;
  }
}

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
  module: ManagedCookieNativeModule | undefined = nativeManagedCookieModule(),
  trace?: DiagnosticTrace
) {
  if (typeof module?.clearManagedLoginCookies !== 'function') {
    throw new Error('当前安装包不支持清除登录 Cookie');
  }
  const cleared = await module.clearManagedLoginCookies(
    source,
    trace ? { appSessionId: trace.appSessionId, traceId: trace.traceId } : {}
  );
  if (!cleared) {
    throw new Error('登录 Cookie 删除未确认');
  }
  return true;
}
