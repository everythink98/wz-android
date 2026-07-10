import CookieManager from '@react-native-cookies/cookies';
import { NativeModules } from 'react-native';
import {
  buildCookieHeader,
  mergeNodeSeekCookies,
  parseNodeSeekDocumentCookie,
  type NativeCookie
} from './nodeseekCookies';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  type DiagnosticTrace
} from './diagnostics';

type NodeSeekCookieModule = { getNodeSeekCookieHeader?: () => Promise<string | null> };
type NodeSeekCookieStoreReader = () => Promise<Record<string, NativeCookie>>;

const NODESEEK_COOKIE_URLS = ['https://www.nodeseek.com', 'https://nodeseek.com'];
const NODESEEK_COOKIE_READ_TIMEOUT_MS = 1500;

async function nodeSeekAndroidCookieModule() {
  return nodeSeekCookieModuleFromReactNativeImport({ NativeModules });
}

function nodeSeekCookieModuleFromReactNativeImport(mod: any): NodeSeekCookieModule | undefined {
  const nativeModules = mod?.NativeModules || mod?.default?.NativeModules;
  // LinuxDoCookieModule owns the shared Android WebView CookieManager bridge; NodeSeek reuses it here.
  return nativeModules?.LinuxDoCookieModule as NodeSeekCookieModule | undefined;
}

type CookieStoreReadStatus = 'success' | 'empty' | 'timeout' | 'error';

async function withNodeSeekCookieReadTimeout<T extends Record<string, unknown>>(promise: Promise<T>, fallback: T, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ value, status: Object.keys(value).length ? 'success' : 'empty' } as const),
        () => ({ value: fallback, status: 'error' } as const)
      ),
      new Promise<{ value: T; status: CookieStoreReadStatus }>((resolve) => {
        timer = setTimeout(() => resolve({ value: fallback, status: 'timeout' }), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function readNodeSeekCookiesFromCookieManager() {
  await CookieManager.flush();
  const cookieMaps = await Promise.all(NODESEEK_COOKIE_URLS.map((url) => CookieManager.get(url)));
  return mergeNodeSeekCookies(...cookieMaps as Array<Record<string, NativeCookie>>);
}

async function readNodeSeekCookiesFromAndroidWebViewStore() {
  const module = await nodeSeekAndroidCookieModule();
  if (!module?.getNodeSeekCookieHeader) {
    return {};
  }
  return parseNodeSeekDocumentCookie(await module.getNodeSeekCookieHeader() || '');
}

export async function readNodeSeekCookiesFromStores({
  diagnosticTrace,
  readAndroidStore = readNodeSeekCookiesFromAndroidWebViewStore,
  readCookieManagerStore = readNodeSeekCookiesFromCookieManager,
  timeoutMs = NODESEEK_COOKIE_READ_TIMEOUT_MS
}: {
  diagnosticTrace?: DiagnosticTrace;
  readAndroidStore?: NodeSeekCookieStoreReader;
  readCookieManagerStore?: NodeSeekCookieStoreReader;
  timeoutMs?: number;
} = {}) {
  const ownsTrace = !diagnosticTrace;
  const trace = diagnosticTrace || beginDiagnosticTrace('credential', 'cookie-store-read', { source: 'nodeseek' });
  const [androidStore, cookieManagerStore] = await Promise.all([
    withNodeSeekCookieReadTimeout(readAndroidStore(), {}, timeoutMs),
    withNodeSeekCookieReadTimeout(readCookieManagerStore(), {}, timeoutMs)
  ]);
  for (const [store, result] of [
    ['android-webview', androidStore],
    ['cookie-manager', cookieManagerStore]
  ] as const) {
    markDiagnosticStage(trace, 'credential', {
      source: 'nodeseek',
      store,
      state: result.status,
      hasCredential: Object.keys(result.value).length > 0
    });
  }
  const cookies = mergeNodeSeekCookies(androidStore.value, cookieManagerStore.value);
  const failedStatuses = [androidStore.status, cookieManagerStore.status].filter((status) => status === 'timeout' || status === 'error');
  if (failedStatuses.length) {
    const outcome = Object.keys(cookies).length ? 'partial' : 'failure';
    const reason = failedStatuses.includes('timeout') ? 'timeout' : 'storage_error';
    if (ownsTrace) {
      finishDiagnosticTrace(trace, outcome, { source: 'nodeseek', reason });
    } else {
      hintDiagnosticOutcome(trace, 'partial', { source: 'nodeseek', reason });
    }
  } else if (ownsTrace) {
    finishDiagnosticTrace(trace, 'success', { source: 'nodeseek', hasCredential: Object.keys(cookies).length > 0 });
  }
  return cookies;
}

export { buildCookieHeader };
