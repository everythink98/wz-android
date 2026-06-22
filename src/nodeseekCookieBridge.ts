import CookieManager from '@react-native-cookies/cookies';
import { NativeModules } from 'react-native';
import {
  buildCookieHeader,
  mergeNodeSeekCookies,
  parseNodeSeekDocumentCookie,
  type NativeCookie
} from './nodeseekCookies';

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

async function withNodeSeekCookieReadTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } catch {
    return fallback;
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
  try {
    return parseNodeSeekDocumentCookie(await module.getNodeSeekCookieHeader() || '');
  } catch {
    return {};
  }
}

export async function readNodeSeekCookiesFromStores({
  readAndroidStore = readNodeSeekCookiesFromAndroidWebViewStore,
  readCookieManagerStore = readNodeSeekCookiesFromCookieManager,
  timeoutMs = NODESEEK_COOKIE_READ_TIMEOUT_MS
}: {
  readAndroidStore?: NodeSeekCookieStoreReader;
  readCookieManagerStore?: NodeSeekCookieStoreReader;
  timeoutMs?: number;
} = {}) {
  const [androidStoreCookies, cookieManagerCookies] = await Promise.all([
    withNodeSeekCookieReadTimeout(readAndroidStore(), {}, timeoutMs),
    withNodeSeekCookieReadTimeout(readCookieManagerStore(), {}, timeoutMs)
  ]);
  return mergeNodeSeekCookies(androidStoreCookies, cookieManagerCookies);
}

export { buildCookieHeader };
