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
}

const LINUXDO_ACCESS_STORAGE_KEY = 'linuxdo-clearance';
const LINUXDO_COOKIE_URLS = ['https://linux.do', 'https://www.linux.do'];

async function cookieManager() {
  const mod = await dynamicImport('@react-native-cookies/cookies');
  return mod.default;
}

async function secureStore() {
  return dynamicImport('expo-secure-store');
}

function dynamicImport(specifier: string): Promise<any> {
  return new Function('specifier', 'return import(specifier)')(specifier);
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

export async function readLinuxDoCookiesFromWebView() {
  const CookieManager = await cookieManager();
  await CookieManager.flush();
  const cookieMaps = await Promise.all(LINUXDO_COOKIE_URLS.map((url) => CookieManager.get(url)));
  return mergeLinuxDoCookies(...cookieMaps as Array<Record<string, LinuxDoNativeCookie>>);
}

export async function saveLinuxDoAccess(cookieHeader: string) {
  const access: LinuxDoAccess = {
    cookieHeader,
    savedAt: new Date().toISOString(),
    source: 'webview'
  };
  const SecureStore = await secureStore();
  await SecureStore.setItemAsync(LINUXDO_ACCESS_STORAGE_KEY, JSON.stringify(access));
  return access;
}

export async function loadLinuxDoAccess() {
  let SecureStore: { getItemAsync: (key: string) => Promise<string | null> };
  try {
    SecureStore = await secureStore();
  } catch {
    return null;
  }
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
  const CookieManager = await cookieManager();
  const SecureStore = await secureStore();
  await SecureStore.deleteItemAsync(LINUXDO_ACCESS_STORAGE_KEY);
  await Promise.all(LINUXDO_COOKIE_URLS.map((url) => CookieManager.clearByName(url, 'cf_clearance').catch(() => false)));
}

export function linuxDoAccessSummary(access: LinuxDoAccess | null) {
  return {
    hasClearance: Boolean(access?.cookieHeader),
    savedAt: access?.savedAt
  };
}
