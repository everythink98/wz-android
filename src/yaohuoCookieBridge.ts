import CookieManager from '@react-native-cookies/cookies';
import { NativeModules } from 'react-native';
import {
  buildYaohuoCookieHeader,
  mergeYaohuoCookies,
  sanitizeYaohuoCookieHeader,
  type YaohuoNativeCookie
} from './yaohuoCookies';

type YaohuoCookieModule = { getYaohuoCookieHeader?: () => Promise<string | null> };
type YaohuoCookieHeaderReader = () => Promise<string | null | undefined>;

const YAOHUO_COOKIE_URLS = ['https://www.yaohuo.me', 'https://yaohuo.me'];

function yaohuoCookieModuleFromReactNativeImport(mod: any): YaohuoCookieModule | undefined {
  const nativeModules = mod?.NativeModules || mod?.default?.NativeModules;
  return nativeModules?.LinuxDoCookieModule as YaohuoCookieModule | undefined;
}

async function readAndroidWebViewStore() {
  const module = yaohuoCookieModuleFromReactNativeImport({ NativeModules });
  return module?.getYaohuoCookieHeader?.();
}

async function readCookieManagerStore() {
  await CookieManager.flush();
  const cookieMaps = await Promise.all(YAOHUO_COOKIE_URLS.map((url) => CookieManager.get(url)));
  return buildYaohuoCookieHeader(mergeYaohuoCookies(
    ...cookieMaps as Array<Record<string, YaohuoNativeCookie>>
  ));
}

export async function readYaohuoCookieHeaderFromStores({
  readAndroidStore = readAndroidWebViewStore,
  readCookieManagerStore: readFallbackStore = readCookieManagerStore
}: {
  readAndroidStore?: YaohuoCookieHeaderReader;
  readCookieManagerStore?: YaohuoCookieHeaderReader;
} = {}) {
  const nativeHeader = sanitizeYaohuoCookieHeader(await readAndroidStore().catch(() => ''));
  if (nativeHeader) {
    return nativeHeader;
  }
  return sanitizeYaohuoCookieHeader(await readFallbackStore().catch(() => ''));
}
