import * as SecureStore from 'expo-secure-store';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import type { SessionSite } from '@/domain/session/siteSessionState';
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

type SecureStorePort = Pick<typeof SecureStore, 'deleteItemAsync' | 'getItemAsync'>;

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
  isCurrent,
  userAgentTarget
}: {
  exactUrl: string;
  legacyKeys: readonly string[];
  readManagedCookieHeader: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  secureStore: SecureStorePort;
  isCurrent: () => boolean;
  userAgentTarget?: { legacyKey: string; restore: (userAgent: string) => Promise<void> };
}) {
  const snapshots = await Promise.all(legacyKeys.map((key) => secureStore.getItemAsync(key)));
  if (!isCurrent()) return 'cancelled' as const;
  if (!snapshots.some((snapshot) => snapshot !== null)) return 'absent' as const;
  const read = await readManagedCookieHeader(exactUrl);
  if (!isCurrent()) return 'cancelled' as const;
  if (read.status !== 'ok') {
    return 'retained' as const;
  }
  if (userAgentTarget) {
    const userAgent = legacyUserAgent(snapshots[legacyKeys.indexOf(userAgentTarget.legacyKey)] ?? null);
    if (userAgent) {
      await userAgentTarget.restore(userAgent);
    }
  }
  if (!isCurrent()) return 'cancelled' as const;
  await Promise.all(legacyKeys.map((key) => secureStore.deleteItemAsync(key)));
  return 'migrated' as const;
}

export async function migrateLegacyCookieSnapshots({
  enabledSources,
  isCurrent,
  restoreUserAgent,
  readManagedCookieHeader = readManagedCookieHeaderFromNative,
  secureStore = SecureStore
}: {
  enabledSources: readonly SessionSite[];
  isCurrent: () => boolean;
  restoreUserAgent: (site: 'nodeseek' | 'linuxdo', userAgent: string) => Promise<void>;
  readManagedCookieHeader?: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  secureStore?: SecureStorePort;
}) {
  const [nodeseek, linuxdo, yaohuo] = await Promise.all([
    enabledSources.includes('nodeseek')
      ? migrateSource({
          exactUrl: `${sourceCatalog.nodeseek.baseUrl}/`,
          legacyKeys: [NODESEEK_ACCESS_STORAGE_KEY, NODESEEK_COOKIE_STORAGE_KEY],
          readManagedCookieHeader,
          secureStore,
          isCurrent,
          userAgentTarget: {
            legacyKey: NODESEEK_ACCESS_STORAGE_KEY,
            restore: (userAgent) => restoreUserAgent('nodeseek', userAgent)
          }
        })
      : Promise.resolve('skipped' as const),
    enabledSources.includes('linuxdo')
      ? migrateSource({
          exactUrl: `${sourceCatalog.linuxdo.baseUrl}/session/current.json`,
          legacyKeys: [LINUXDO_ACCESS_STORAGE_KEY],
          readManagedCookieHeader,
          secureStore,
          isCurrent,
          userAgentTarget: {
            legacyKey: LINUXDO_ACCESS_STORAGE_KEY,
            restore: (userAgent) => restoreUserAgent('linuxdo', userAgent)
          }
        })
      : Promise.resolve('skipped' as const),
    enabledSources.includes('yaohuo')
      ? migrateSource({
          exactUrl: `${sourceCatalog.yaohuo.baseUrl}/wapindex.aspx?sid=-2`,
          legacyKeys: [YAOHUO_COOKIE_STORAGE_KEY],
          readManagedCookieHeader,
          secureStore,
          isCurrent
        })
      : Promise.resolve('skipped' as const)
  ]);
  return { linuxdo, nodeseek, yaohuo };
}
