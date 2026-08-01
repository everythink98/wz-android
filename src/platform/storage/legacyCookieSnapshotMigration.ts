import * as SecureStore from 'expo-secure-store';
import { NODESEEK_USER_AGENT_STORAGE_KEY } from '@/platform/android/nodeSeekUserAgent';
import { LINUXDO_USER_AGENT_STORAGE_KEY } from '@/sources/linuxdo/session';
import {
  readManagedCookieHeader as readManagedCookieHeaderFromNative,
  type ManagedCookieReadResult
} from '@/platform/network/managedCookies';

const NODESEEK_ACCESS_STORAGE_KEY = 'nodeseek-access';
const NODESEEK_COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';
const LINUXDO_ACCESS_STORAGE_KEY = 'linuxdo-clearance';
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';

export const LEGACY_COOKIE_SNAPSHOT_KEYS = [
  NODESEEK_ACCESS_STORAGE_KEY,
  NODESEEK_COOKIE_STORAGE_KEY,
  LINUXDO_ACCESS_STORAGE_KEY,
  YAOHUO_COOKIE_STORAGE_KEY
] as const;

type SecureStorePort = Pick<typeof SecureStore, 'deleteItemAsync' | 'getItemAsync' | 'setItemAsync'>;

function legacyUserAgent(raw: string | null) {
  if (!raw) {
    return '';
  }
  try {
    const parsed = JSON.parse(raw) as { userAgent?: unknown };
    return typeof parsed.userAgent === 'string' ? parsed.userAgent.trim() : '';
  } catch {
    return '';
  }
}

async function migrateSource({
  exactUrl,
  legacyKeys,
  readManagedCookieHeader,
  secureStore,
  userAgentTarget
}: {
  exactUrl: string;
  legacyKeys: readonly string[];
  readManagedCookieHeader: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  secureStore: SecureStorePort;
  userAgentTarget?: { legacyKey: string; storageKey: string };
}) {
  const read = await readManagedCookieHeader(exactUrl);
  if (read.status !== 'ok') {
    return 'retained' as const;
  }
  if (userAgentTarget) {
    const userAgent = legacyUserAgent(await secureStore.getItemAsync(userAgentTarget.legacyKey));
    if (userAgent) {
      await secureStore.setItemAsync(userAgentTarget.storageKey, userAgent);
    }
  }
  await Promise.all(legacyKeys.map((key) => secureStore.deleteItemAsync(key)));
  return 'migrated' as const;
}

export async function migrateLegacyCookieSnapshots({
  readManagedCookieHeader = readManagedCookieHeaderFromNative,
  secureStore = SecureStore
}: {
  readManagedCookieHeader?: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  secureStore?: SecureStorePort;
} = {}) {
  const [nodeseek, linuxdo, yaohuo] = await Promise.all([
    migrateSource({
      exactUrl: 'https://www.nodeseek.com/',
      legacyKeys: [NODESEEK_ACCESS_STORAGE_KEY, NODESEEK_COOKIE_STORAGE_KEY],
      readManagedCookieHeader,
      secureStore,
      userAgentTarget: {
        legacyKey: NODESEEK_ACCESS_STORAGE_KEY,
        storageKey: NODESEEK_USER_AGENT_STORAGE_KEY
      }
    }),
    migrateSource({
      exactUrl: 'https://linux.do/session/current.json',
      legacyKeys: [LINUXDO_ACCESS_STORAGE_KEY],
      readManagedCookieHeader,
      secureStore,
      userAgentTarget: {
        legacyKey: LINUXDO_ACCESS_STORAGE_KEY,
        storageKey: LINUXDO_USER_AGENT_STORAGE_KEY
      }
    }),
    migrateSource({
      exactUrl: 'https://www.yaohuo.me/wapindex.aspx?sid=-2',
      legacyKeys: [YAOHUO_COOKIE_STORAGE_KEY],
      readManagedCookieHeader,
      secureStore
    })
  ]);
  return { linuxdo, nodeseek, yaohuo };
}
