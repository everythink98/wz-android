import { describe, expect, it, vi } from 'vitest';
import { LEGACY_COOKIE_SNAPSHOT_KEYS, migrateLegacyCookieSnapshots } from './legacyCookieSnapshotMigration';
import { LINUXDO_USER_AGENT_STORAGE_KEY } from '@/platform/android/linuxDoUserAgent';

vi.mock('react-native', () => ({
  NativeModules: {}
}));
vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));

function secureStore(entries: Record<string, string | null> = {}) {
  return {
    deleteItemAsync: vi.fn(async (key: string) => {
      delete entries[key];
    }),
    getItemAsync: vi.fn(async (key: string) => entries[key] ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      entries[key] = value;
    })
  };
}

describe('legacy Cookie snapshot migration', () => {
  it('[REG-ACCOUNT-031] deletes only App snapshots after every exact native read succeeds', async () => {
    const store = secureStore({
      'nodeseek-access': JSON.stringify({
        cookieHeader: 'session=private',
        source: 'webview',
        userAgent: 'Node UA'
      }),
      'nodeseek-cookie': 'session=older',
      'linuxdo-clearance': JSON.stringify({
        cookieHeader: '_t=private',
        source: 'webview',
        userAgent: 'Linux UA'
      }),
      'yaohuo-cookie-header': 'sidyaohuo=private'
    });
    const readManagedCookieHeader = vi.fn(async (_url: string) => ({
      status: 'ok' as const,
      header: ''
    }));

    await expect(
      migrateLegacyCookieSnapshots({
        readManagedCookieHeader,
        secureStore: store
      })
    ).resolves.toEqual({
      linuxdo: 'migrated',
      nodeseek: 'migrated',
      yaohuo: 'migrated'
    });

    expect(readManagedCookieHeader.mock.calls.map(([url]) => url)).toEqual([
      'https://www.nodeseek.com/',
      'https://linux.do/session/current.json',
      'https://www.yaohuo.me/wapindex.aspx?sid=-2'
    ]);
    expect(store.deleteItemAsync.mock.calls.map(([key]) => key).sort()).toEqual(
      [...LEGACY_COOKIE_SNAPSHOT_KEYS].sort()
    );
    expect(store.setItemAsync).toHaveBeenCalledWith('nodeseek-user-agent', 'Node UA');
    expect(store.setItemAsync).toHaveBeenCalledWith(LINUXDO_USER_AGENT_STORAGE_KEY, 'Linux UA');
  });

  it('[REG-ACCOUNT-031] retains the affected snapshot when exact native read is unsupported or fails', async () => {
    const store = secureStore({
      'nodeseek-access': '{"cookieHeader":"session=private"}',
      'linuxdo-clearance': '{"cookieHeader":"_t=private"}',
      'yaohuo-cookie-header': 'sidyaohuo=private'
    });
    const readManagedCookieHeader = vi.fn(async (url: string) => {
      if (url.includes('nodeseek')) {
        return { status: 'unsupported' as const };
      }
      if (url.includes('linux.do')) {
        return { status: 'error' as const, message: 'native failed' };
      }
      return { status: 'ok' as const, header: 'sidyaohuo=current' };
    });

    await expect(
      migrateLegacyCookieSnapshots({
        readManagedCookieHeader,
        secureStore: store
      })
    ).resolves.toEqual({
      linuxdo: 'retained',
      nodeseek: 'retained',
      yaohuo: 'migrated'
    });

    expect(store.deleteItemAsync).toHaveBeenCalledTimes(1);
    expect(store.deleteItemAsync).toHaveBeenCalledWith('yaohuo-cookie-header');
  });

  it('does not copy malformed or empty legacy User-Agent values', async () => {
    const store = secureStore({
      'nodeseek-access': '{bad json',
      'linuxdo-clearance': JSON.stringify({
        cookieHeader: '_t=private',
        userAgent: '   '
      })
    });

    await migrateLegacyCookieSnapshots({
      readManagedCookieHeader: vi.fn(async (_url: string) => ({ status: 'ok' as const, header: '' })),
      secureStore: store
    });

    expect(store.setItemAsync).not.toHaveBeenCalled();
  });
});
