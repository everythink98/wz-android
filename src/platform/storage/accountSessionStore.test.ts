import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountSessionSnapshot } from '@/domain/session/siteSessionState';
import {
  loadAccountSessionMigrationCompleted,
  loadAccountSessionSnapshot,
  markAccountSessionMigrationCompleted,
  saveAccountSessionSnapshot
} from './accountSessionStore';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      __store: store
    }
  };
});

const asyncStorage = AsyncStorage as typeof AsyncStorage & { __store: Map<string, string> };

describe('account session store', () => {
  beforeEach(() => {
    asyncStorage.__store.clear();
    vi.clearAllMocks();
  });

  it('[REG-PERF-019] restores only the non-sensitive identity from a confirmed session', async () => {
    const snapshot: AccountSessionSnapshot = {
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: ['session=<REDACTED>'],
      isVerifying: false,
      identityTrust: 'confirmed',
      currentUser: {
        source: 'nodeseek',
        id: '42',
        username: 'alice',
        displayName: 'Alice',
        avatar: 'https://img.example/avatar.png',
        url: 'https://www.nodeseek.com/space/42',
        bio: 'remote profile data',
        topics: []
      }
    };

    await saveAccountSessionSnapshot(snapshot);

    await expect(loadAccountSessionSnapshot('nodeseek')).resolves.toEqual({
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: [],
      isVerifying: false,
      identityTrust: 'confirmed',
      currentUser: {
        source: 'nodeseek',
        id: '42',
        username: 'alice',
        displayName: 'Alice',
        avatar: 'https://img.example/avatar.png',
        url: 'https://www.nodeseek.com/space/42',
        topics: []
      }
    });
    const stored = [...asyncStorage.__store.values()].join('');
    expect(stored).not.toContain('session=<REDACTED>');
    expect(stored).not.toContain('remote profile data');
  });

  it('[REG-PERF-019] stores confirmed anonymous but ignores unknown observations', async () => {
    const unknown: AccountSessionSnapshot = {
      site: 'linuxdo',
      status: 'anonymous',
      cookieSummary: ['candidate'],
      isVerifying: false,
      identityTrust: 'unknown'
    };

    await expect(saveAccountSessionSnapshot(unknown)).resolves.toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    await saveAccountSessionSnapshot({ ...unknown, identityTrust: 'none' });
    await expect(loadAccountSessionSnapshot('linuxdo')).resolves.toMatchObject({
      site: 'linuxdo',
      status: 'anonymous',
      identityTrust: 'none'
    });
  });

  it('[REG-PERF-019] isolates a damaged source record from healthy siblings', async () => {
    asyncStorage.__store.set('account-session.v1.nodeseek', '{bad json');
    await saveAccountSessionSnapshot({
      site: 'yaohuo',
      status: 'anonymous',
      cookieSummary: [],
      isVerifying: false,
      identityTrust: 'none'
    });

    await expect(loadAccountSessionSnapshot('nodeseek')).resolves.toBeNull();
    await expect(loadAccountSessionSnapshot('yaohuo')).resolves.toMatchObject({ identityTrust: 'none' });
    expect(asyncStorage.__store.get('account-session.v1.nodeseek')).toBe('{bad json');
  });

  it('[REG-PERF-019] exposes one global migration marker without per-source recovery state', async () => {
    await expect(loadAccountSessionMigrationCompleted()).resolves.toBe(false);

    await markAccountSessionMigrationCompleted();

    await expect(loadAccountSessionMigrationCompleted()).resolves.toBe(true);
    expect([...asyncStorage.__store.keys()]).toEqual(['account-session.migration.v1']);
  });
});
