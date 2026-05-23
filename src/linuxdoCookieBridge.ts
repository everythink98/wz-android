import CookieManager from '@react-native-cookies/cookies';
import * as SecureStore from 'expo-secure-store';
import { NativeModules } from 'react-native';

export interface LinuxDoNativeCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface LinuxDoAccess {
  cookieHeader: string;
  savedAt: string;
  source: 'webview';
  userAgent?: string;
}

type LinuxDoCookieModule = { getClearance?: () => Promise<string | null> };
type LinuxDoCookieStoreReader = () => Promise<Record<string, LinuxDoNativeCookie>>;

const LINUXDO_ACCESS_STORAGE_KEY = 'linuxdo-clearance';
const LINUXDO_COOKIE_URLS = ['https://linux.do/latest', 'https://linux.do', 'https://www.linux.do/latest', 'https://www.linux.do'];
const LINUXDO_COOKIE_READ_TIMEOUT_MS = 1500;

export function sanitizeLinuxDoUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/;\s*wv(?=[;)])/i, '')
    .replace(/\s*Version\/4\.0\s*/i, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export const DEFAULT_LINUXDO_ANDROID_USER_AGENT = sanitizeLinuxDoUserAgent(
  'Mozilla/5.0 (Linux; Android 15; sdk_gphone64_x86_64 Build/AP31.240322.027; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36'
);

async function linuxDoAndroidCookieModule() {
  return linuxDoCookieModuleFromReactNativeImport({ NativeModules });
}

export function linuxDoCookieModuleFromReactNativeImport(mod: any): LinuxDoCookieModule | undefined {
  const nativeModules = mod?.NativeModules || mod?.default?.NativeModules;
  return nativeModules?.LinuxDoCookieModule as LinuxDoCookieModule | undefined;
}

function isLinuxDoDomain(domain?: string) {
  const clean = String(domain || '').replace(/^\./, '').toLowerCase();
  return clean === '' || clean === 'linux.do' || clean.endsWith('.linux.do');
}

export function mergeLinuxDoCookies(...maps: Array<Record<string, LinuxDoNativeCookie> | undefined>) {
  const merged: Record<string, LinuxDoNativeCookie> = {};
  for (const map of maps) {
    for (const [key, cookie] of Object.entries(map || {})) {
      const name = cookie.name || key;
      if (name === 'cf_clearance' && cookie.value && isLinuxDoDomain(cookie.domain)) {
        merged[name] = { ...cookie, name };
      }
    }
  }
  return merged;
}

export function canStoreLinuxDoClearance(cookies: Record<string, LinuxDoNativeCookie>) {
  const cookie = cookies.cf_clearance;
  return Boolean(cookie?.value && isLinuxDoDomain(cookie.domain));
}

export function buildLinuxDoCookieHeader(cookies: Record<string, LinuxDoNativeCookie>) {
  const cookie = cookies.cf_clearance;
  if (!cookie?.value || !isLinuxDoDomain(cookie.domain)) {
    return '';
  }
  return `cf_clearance=${cookie.value}`;
}

export function summarizeLinuxDoCookies(cookies: Record<string, LinuxDoNativeCookie>) {
  const names = Object.keys(cookies).filter((name) => name === 'cf_clearance').sort();
  return {
    names,
    hasClearance: names.includes('cf_clearance')
  };
}

export function parseLinuxDoDocumentCookie(cookieHeader?: string) {
  const parsed: Record<string, LinuxDoNativeCookie> = {};
  for (const segment of String(cookieHeader || '').split(';')) {
    const clean = segment.trim();
    const separator = clean.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = clean.slice(0, separator).trim();
    const value = clean.slice(separator + 1).trim();
    if (name === 'cf_clearance' && value) {
      parsed.cf_clearance = { name, value, domain: 'linux.do' };
    }
  }
  return parsed;
}

export function linuxDoClearanceCookieFromValue(value?: string | null): Record<string, LinuxDoNativeCookie> {
  const clean = String(value || '').trim();
  if (!clean) {
    return {};
  }
  return {
    cf_clearance: { name: 'cf_clearance', value: clean, domain: 'linux.do' }
  };
}

const CHALLENGE_BODY_MARKERS = [
  'just a moment',
  'checking your browser',
  'cf-browser-verification',
  'challenge-running',
  'challenge-platform',
  'cf-turnstile',
  'cf_chl_',
  'needs to review the security',
  'attention required',
  'enable javascript and cookies',
  '请稍候',
  '正在检查'
];

export function isCloudflareChallengeBody(body: string) {
  const text = body.toLowerCase();
  return CHALLENGE_BODY_MARKERS.some((marker) => text.includes(marker));
}

export function isCloudflareChallengeResponse(response: Pick<Response, 'status' | 'headers'> & { bodyText?: string }) {
  const mitigated = response.headers?.get?.('cf-mitigated') || response.headers?.get?.('CF-Mitigated');
  if (mitigated && /challenge/i.test(mitigated)) {
    return true;
  }
  if (typeof response.bodyText === 'string') {
    return isCloudflareChallengeBody(response.bodyText);
  }
  return false;
}

async function withLinuxDoCookieReadTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number) {
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

async function readLinuxDoCookiesFromCookieManager() {
  await CookieManager.flush();
  const cookieMaps = await Promise.all(LINUXDO_COOKIE_URLS.map((url) => CookieManager.get(url)));
  return mergeLinuxDoCookies(...cookieMaps as Array<Record<string, LinuxDoNativeCookie>>);
}

export async function readLinuxDoCookiesFromStores({
  readAndroidStore = readLinuxDoClearanceFromAndroidWebViewStore,
  readCookieManagerStore = readLinuxDoCookiesFromCookieManager,
  timeoutMs = LINUXDO_COOKIE_READ_TIMEOUT_MS
}: {
  readAndroidStore?: LinuxDoCookieStoreReader;
  readCookieManagerStore?: LinuxDoCookieStoreReader;
  timeoutMs?: number;
} = {}) {
  const androidStoreCookies = await withLinuxDoCookieReadTimeout(readAndroidStore(), {}, timeoutMs);
  if (canStoreLinuxDoClearance(androidStoreCookies)) {
    return androidStoreCookies;
  }
  const cookieManagerCookies = await withLinuxDoCookieReadTimeout(readCookieManagerStore(), {}, timeoutMs);
  return mergeLinuxDoCookies(androidStoreCookies, cookieManagerCookies);
}

export async function readLinuxDoCookiesFromWebView() {
  return readLinuxDoCookiesFromStores();
}

export async function readLinuxDoClearanceFromAndroidWebViewStore() {
  const module = await linuxDoAndroidCookieModule();
  if (!module?.getClearance) {
    return {};
  }
  try {
    const value = await module.getClearance();
    return linuxDoClearanceCookieFromValue(value);
  } catch {
    return {};
  }
}

export async function saveLinuxDoAccess(cookieHeader: string, userAgent?: string) {
  const cleanUserAgent = sanitizeLinuxDoUserAgent(userAgent);
  const access: LinuxDoAccess = {
    cookieHeader,
    savedAt: new Date().toISOString(),
    source: 'webview',
    ...(cleanUserAgent ? { userAgent: cleanUserAgent } : {})
  };
  await SecureStore.setItemAsync(LINUXDO_ACCESS_STORAGE_KEY, JSON.stringify(access));
  return access;
}

export async function loadLinuxDoAccess() {
  const raw = await SecureStore.getItemAsync(LINUXDO_ACCESS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LinuxDoAccess>;
    return parsed.cookieHeader ? parsed as LinuxDoAccess : null;
  } catch {
    return null;
  }
}

export async function clearLinuxDoAccess() {
  await SecureStore.deleteItemAsync(LINUXDO_ACCESS_STORAGE_KEY);
  await Promise.all(LINUXDO_COOKIE_URLS.map((url) => CookieManager.clearByName(url, 'cf_clearance').catch(() => false)));
}

export function linuxDoAccessSummary(access: LinuxDoAccess | null) {
  return {
    hasClearance: Boolean(access?.cookieHeader),
    savedAt: access?.savedAt
  };
}
