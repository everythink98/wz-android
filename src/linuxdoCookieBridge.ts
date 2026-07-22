import CookieManager from '@react-native-cookies/cookies';
import * as SecureStore from 'expo-secure-store';
import { NativeModules } from 'react-native';
import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from './androidWebViewUserAgent';
import { createCredentialWriteGate, enqueueCredentialWriteForGeneration, replaceCredentialWrite } from './app/sessionControllerHelpers';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  type DiagnosticTrace
} from './diagnostics';

interface LinuxDoNativeCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

interface LinuxDoAccess {
  cookieHeader: string;
  savedAt: string;
  source: 'webview';
  userAgent?: string;
}

type LinuxDoCookieModule = {
  getClearance?: () => Promise<string | null>;
  getLinuxDoCookieHeader?: () => Promise<string | null>;
  clearLinuxDoLoginCookies?: (expected?: Partial<Record<typeof LINUXDO_LOGIN_COOKIE_NAMES[number], string>>) => Promise<boolean>;
  clearLinuxDoClearanceCookies?: () => Promise<boolean>;
};
type LinuxDoCookieStoreReader = () => Promise<Record<string, LinuxDoNativeCookie>>;

const LINUXDO_ACCESS_STORAGE_KEY = 'linuxdo-clearance';
const LINUXDO_COOKIE_URLS = ['https://linux.do/latest', 'https://linux.do', 'https://www.linux.do/latest', 'https://www.linux.do'];
const LINUXDO_COOKIE_READ_TIMEOUT_MS = 1500;
const LINUXDO_ACCESS_COOKIE_NAMES = ['cf_clearance', '_t', '_forum_session'] as const;
const LINUXDO_LOGIN_COOKIE_NAMES = ['_t', '_forum_session'] as const;
const linuxDoAccessWriteGate = createCredentialWriteGate();
let linuxDoDevAnonymousOverride = false;

export function setLinuxDoDevAnonymousOverride(enabled: boolean) {
  linuxDoDevAnonymousOverride = enabled;
}

export function sanitizeLinuxDoUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export const DEFAULT_LINUXDO_ANDROID_USER_AGENT = sanitizeLinuxDoUserAgent(DEFAULT_ANDROID_WEBVIEW_USER_AGENT);

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
      if (LINUXDO_ACCESS_COOKIE_NAMES.includes(name as typeof LINUXDO_ACCESS_COOKIE_NAMES[number]) && cookie.value && isLinuxDoDomain(cookie.domain)) {
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

export function linuxDoClearanceValue(cookies: Record<string, LinuxDoNativeCookie>) {
  const cookie = cookies.cf_clearance;
  return cookie?.value && isLinuxDoDomain(cookie.domain) ? cookie.value : '';
}

export function hasFreshLinuxDoClearance(cookies: Record<string, LinuxDoNativeCookie>, previousClearance?: string | null) {
  const current = linuxDoClearanceValue(cookies);
  return Boolean(current && current !== (previousClearance || ''));
}

export function canAcceptLinuxDoAccessUpdate(cookies: Record<string, LinuxDoNativeCookie>, previousClearance?: string | null, requireFreshClearance = true) {
  if (requireFreshClearance) {
    return hasFreshLinuxDoClearance(cookies, previousClearance);
  }
  return hasFreshLinuxDoClearance(cookies, previousClearance) || canStoreLinuxDoLogin(cookies);
}

export function canStoreLinuxDoAccess(cookies: Record<string, LinuxDoNativeCookie>) {
  return canStoreLinuxDoClearance(cookies);
}

export function canStoreLinuxDoLogin(cookies: Record<string, LinuxDoNativeCookie>) {
  const cookie = cookies._t;
  return Boolean(cookie?.value && isLinuxDoDomain(cookie.domain));
}

export function buildLinuxDoCookieHeader(cookies: Record<string, LinuxDoNativeCookie>) {
  return LINUXDO_ACCESS_COOKIE_NAMES.map((name) => {
    const cookie = cookies[name];
    return cookie?.value && isLinuxDoDomain(cookie.domain) ? `${name}=${cookie.value}` : '';
  }).filter(Boolean).join('; ');
}

export function removeLinuxDoLoginCookies(cookies: Record<string, LinuxDoNativeCookie>) {
  const loginNames = new Set<string>(LINUXDO_LOGIN_COOKIE_NAMES);
  return Object.fromEntries(Object.entries(cookies).filter(([name]) => !loginNames.has(name)));
}

function removeLinuxDoClearanceCookie(cookies: Record<string, LinuxDoNativeCookie>) {
  return Object.fromEntries(Object.entries(cookies).filter(([name]) => name !== 'cf_clearance'));
}

export function summarizeLinuxDoCookies(cookies: Record<string, LinuxDoNativeCookie>) {
  const names = Object.keys(cookies).filter((name) => LINUXDO_ACCESS_COOKIE_NAMES.includes(name as typeof LINUXDO_ACCESS_COOKIE_NAMES[number])).sort();
  return {
    names,
    hasClearance: names.includes('cf_clearance'),
    loggedIn: canStoreLinuxDoLogin(cookies)
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
    if (LINUXDO_ACCESS_COOKIE_NAMES.includes(name as typeof LINUXDO_ACCESS_COOKIE_NAMES[number]) && value) {
      parsed[name] = { name, value, domain: 'linux.do' };
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

type CookieStoreReadStatus = 'success' | 'empty' | 'timeout' | 'error';

async function withLinuxDoCookieReadTimeout<T extends Record<string, unknown>>(promise: Promise<T>, fallback: T, timeoutMs: number) {
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

async function readLinuxDoCookiesFromCookieManager() {
  await CookieManager.flush();
  const cookieMaps = await Promise.all(LINUXDO_COOKIE_URLS.map((url) => CookieManager.get(url)));
  return mergeLinuxDoCookies(...cookieMaps as Array<Record<string, LinuxDoNativeCookie>>);
}

export async function readLinuxDoCookiesFromStores({
  diagnosticTrace,
  readAndroidStore = readLinuxDoClearanceFromAndroidWebViewStore,
  readCookieManagerStore = readLinuxDoCookiesFromCookieManager,
  timeoutMs = LINUXDO_COOKIE_READ_TIMEOUT_MS
}: {
  diagnosticTrace?: DiagnosticTrace;
  readAndroidStore?: LinuxDoCookieStoreReader;
  readCookieManagerStore?: LinuxDoCookieStoreReader;
  timeoutMs?: number;
} = {}) {
  const ownsTrace = !diagnosticTrace;
  const trace = diagnosticTrace || beginDiagnosticTrace('credential', 'cookie-store-read', { source: 'linuxdo' });
  const [androidStore, cookieManagerStore] = await Promise.all([
    withLinuxDoCookieReadTimeout(readAndroidStore(), {}, timeoutMs),
    withLinuxDoCookieReadTimeout(readCookieManagerStore(), {}, timeoutMs)
  ]);
  for (const [store, result] of [
    ['android-webview', androidStore],
    ['cookie-manager', cookieManagerStore]
  ] as const) {
    markDiagnosticStage(trace, 'credential', {
      source: 'linuxdo',
      store,
      state: result.status,
      hasCredential: Object.keys(result.value).length > 0
    });
  }
  const cookies = mergeLinuxDoCookies(androidStore.value, cookieManagerStore.value);
  const failedStatuses = [androidStore.status, cookieManagerStore.status].filter((status) => status === 'timeout' || status === 'error');
  if (failedStatuses.length) {
    const outcome = Object.keys(cookies).length ? 'partial' : 'failure';
    const reason = failedStatuses.includes('timeout') ? 'timeout' : 'storage_error';
    if (ownsTrace) {
      finishDiagnosticTrace(trace, outcome, { source: 'linuxdo', reason });
    } else {
      hintDiagnosticOutcome(trace, 'partial', { source: 'linuxdo', reason });
    }
  } else if (ownsTrace) {
    finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', hasCredential: Object.keys(cookies).length > 0 });
  }
  return cookies;
}

async function readLinuxDoClearanceFromAndroidWebViewStore() {
  const module = await linuxDoAndroidCookieModule();
  if (module?.getLinuxDoCookieHeader) {
    return parseLinuxDoDocumentCookie(await module.getLinuxDoCookieHeader() || '');
  }
  if (!module?.getClearance) {
    return {};
  }
  const value = await module.getClearance();
  return linuxDoClearanceCookieFromValue(value);
}

function linuxDoAccessFromHeader(cookieHeader: string, userAgent?: string): LinuxDoAccess {
  const cleanUserAgent = sanitizeLinuxDoUserAgent(userAgent);
  return {
    cookieHeader,
    savedAt: new Date().toISOString(),
    source: 'webview',
    ...(cleanUserAgent ? { userAgent: cleanUserAgent } : {})
  };
}

async function writeLinuxDoAccess(access: LinuxDoAccess, isCurrent: () => boolean) {
  if (!isCurrent()) {
    return null;
  }
  await SecureStore.setItemAsync(LINUXDO_ACCESS_STORAGE_KEY, JSON.stringify(access));
  return isCurrent() ? access : null;
}

async function readStoredLinuxDoAccess() {
  const raw = await SecureStore.getItemAsync(LINUXDO_ACCESS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  let parsed: Partial<LinuxDoAccess>;
  try {
    parsed = JSON.parse(raw) as Partial<LinuxDoAccess>;
  } catch {
    throw new Error('linux.do 登录配置已损坏，请重新登录。');
  }
  if (
    typeof parsed.cookieHeader !== 'string'
    || !parsed.cookieHeader.trim()
    || (parsed.source !== undefined && parsed.source !== 'webview')
  ) {
    throw new Error('linux.do 登录配置已损坏，请重新登录。');
  }
  return {
    cookieHeader: parsed.cookieHeader,
    savedAt: typeof parsed.savedAt === 'string' && parsed.savedAt ? parsed.savedAt : new Date(0).toISOString(),
    source: 'webview' as const,
    ...(typeof parsed.userAgent === 'string' && sanitizeLinuxDoUserAgent(parsed.userAgent)
      ? { userAgent: sanitizeLinuxDoUserAgent(parsed.userAgent) }
      : {})
  };
}

function linuxDoLoginCookieValues(cookieHeader?: string) {
  const cookies = parseLinuxDoDocumentCookie(cookieHeader || '');
  return Object.fromEntries(LINUXDO_LOGIN_COOKIE_NAMES
    .map((name) => [name, cookies[name]?.value || ''])
    .filter(([, value]) => value)) as Partial<Record<typeof LINUXDO_LOGIN_COOKIE_NAMES[number], string>>;
}

function linuxDoLoginCookiesMatch(currentHeader: string | undefined, expectedHeader?: string) {
  if (!expectedHeader) {
    return true;
  }
  const current = linuxDoLoginCookieValues(currentHeader);
  const expected = linuxDoLoginCookieValues(expectedHeader);
  return LINUXDO_LOGIN_COOKIE_NAMES.every((name) => current[name] === expected[name]);
}

async function clearLinuxDoLoginCookiesFromWebView(expectedHeader?: string) {
  const module = await linuxDoAndroidCookieModule();
  if (module?.clearLinuxDoLoginCookies) {
    await module.clearLinuxDoLoginCookies(linuxDoLoginCookieValues(expectedHeader)).catch(() => false);
  }
  await CookieManager.flush().catch(() => undefined);
}

async function saveLinuxDoAccessWithGate(cookieHeader: string, userAgent?: string) {
  const access = linuxDoAccessFromHeader(cookieHeader, userAgent);
  return replaceCredentialWrite(linuxDoAccessWriteGate, async ({ isCurrent }) => {
    return writeLinuxDoAccess(access, isCurrent);
  });
}

export async function saveLinuxDoAccess(cookieHeader: string, userAgent?: string) {
  return saveLinuxDoAccessWithGate(cookieHeader, userAgent);
}

export function currentLinuxDoAccessGeneration() {
  return linuxDoAccessWriteGate.generation;
}

export async function saveLinuxDoAccessForGeneration(generation: number, cookieHeader: string, userAgent?: string) {
  const access = linuxDoAccessFromHeader(cookieHeader, userAgent);
  return enqueueCredentialWriteForGeneration(linuxDoAccessWriteGate, generation, async ({ isCurrent }) => {
    return writeLinuxDoAccess(access, isCurrent);
  });
}

export async function loadLinuxDoAccess() {
  if (linuxDoDevAnonymousOverride) {
    return null;
  }
  const generation = linuxDoAccessWriteGate.generation;
  let access: LinuxDoAccess | null;
  try {
    access = await readStoredLinuxDoAccess();
  } catch (error) {
    if (generation !== linuxDoAccessWriteGate.generation) {
      return null;
    }
    throw error;
  }
  if (generation !== linuxDoAccessWriteGate.generation) {
    return null;
  }
  return access;
}

async function clearLinuxDoAccessWithWriter(
  writer: (task: ({ isCurrent }: { isCurrent: () => boolean }) => Promise<{ access: LinuxDoAccess | null; cleared: boolean }>) => Promise<{ access: LinuxDoAccess | null; cleared: boolean } | undefined>,
  expectedHeader?: string
) {
  const result = await writer(async ({ isCurrent }) => {
    const savedAccess = await readStoredLinuxDoAccess();
    if (!isCurrent()) {
      return { access: null, cleared: false };
    }
    if (!linuxDoLoginCookiesMatch(savedAccess?.cookieHeader, expectedHeader)) {
      return { access: savedAccess, cleared: false };
    }
    const remainingHeader = buildLinuxDoCookieHeader(removeLinuxDoLoginCookies(parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || '')));
    if (remainingHeader) {
      const access = await writeLinuxDoAccess(linuxDoAccessFromHeader(remainingHeader, savedAccess?.userAgent), isCurrent);
      return { access, cleared: Boolean(access) };
    }
    await SecureStore.deleteItemAsync(LINUXDO_ACCESS_STORAGE_KEY);
    return { access: null, cleared: isCurrent() };
  });
  if (result?.cleared) {
    await clearLinuxDoLoginCookiesFromWebView(expectedHeader);
  }
  return result ? result.access : loadLinuxDoAccess();
}

export async function clearLinuxDoAccess() {
  return clearLinuxDoAccessWithWriter(
    (task) => replaceCredentialWrite(linuxDoAccessWriteGate, task)
  );
}

export async function clearLinuxDoAccessForGeneration(generation: number, expectedHeader?: string) {
  return clearLinuxDoAccessWithWriter(
    (task) => enqueueCredentialWriteForGeneration(linuxDoAccessWriteGate, generation, task),
    expectedHeader
  );
}

export async function clearLinuxDoSavedAccess() {
  await replaceCredentialWrite(linuxDoAccessWriteGate, () => SecureStore.deleteItemAsync(LINUXDO_ACCESS_STORAGE_KEY));
}

export async function clearLinuxDoWebViewClearance() {
  await Promise.all(LINUXDO_COOKIE_URLS.map((url) => CookieManager.clearByName(url, 'cf_clearance').catch(() => false)));
  const module = await linuxDoAndroidCookieModule();
  if (module?.clearLinuxDoClearanceCookies) {
    await module.clearLinuxDoClearanceCookies().catch(() => false);
  }
  await CookieManager.flush().catch(() => undefined);
}

export async function clearLinuxDoClearance() {
  return replaceCredentialWrite(linuxDoAccessWriteGate, async ({ isCurrent }) => {
    const savedAccess = await readStoredLinuxDoAccess();
    if (!isCurrent()) {
      return null;
    }
    const remainingHeader = buildLinuxDoCookieHeader(removeLinuxDoClearanceCookie(parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || '')));
    let access: LinuxDoAccess | null = null;
    if (remainingHeader) {
      access = await writeLinuxDoAccess(linuxDoAccessFromHeader(remainingHeader, savedAccess?.userAgent), isCurrent);
    } else {
      await SecureStore.deleteItemAsync(LINUXDO_ACCESS_STORAGE_KEY);
    }
    await clearLinuxDoWebViewClearance();
    return isCurrent() ? access : null;
  });
}

export function linuxDoAccessSummary(access: LinuxDoAccess | null) {
  const cookies = parseLinuxDoDocumentCookie(access?.cookieHeader || '');
  return {
    hasClearance: canStoreLinuxDoClearance(cookies),
    loggedIn: canStoreLinuxDoLogin(cookies),
    savedAt: access?.savedAt
  };
}
