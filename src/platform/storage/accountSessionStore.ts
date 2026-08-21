import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserProfile } from '@/domain/forum/models';
import type { AccountSessionSnapshot, SessionSite } from '@/domain/session/siteSessionState';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';

const STORAGE_KEY_PREFIX = 'account-session.v1.';
const MIGRATION_STORAGE_KEY = 'account-session.migration.v1';
const operations = createKeyedSerialRunner<string>();

type StoredAccountIdentity = Pick<UserProfile, 'avatar' | 'displayName' | 'id' | 'source' | 'url' | 'username'>;
type StoredAccountSessionV1 =
  { version: 1; state: 'authenticated'; identity: StoredAccountIdentity } | { version: 1; state: 'anonymous' };

function storageKey(site: SessionSite) {
  return `${STORAGE_KEY_PREFIX}${site}`;
}

function requiredString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanIdentity(value: unknown, site: SessionSite): StoredAccountIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const identity = value as Partial<StoredAccountIdentity>;
  const id = requiredString(identity.id);
  const username = requiredString(identity.username);
  const url = requiredString(identity.url);
  if (identity.source !== site || !id || !username || !url) return null;
  const displayName = optionalString(identity.displayName);
  const avatar = optionalString(identity.avatar);
  return {
    source: site,
    id,
    username,
    url,
    ...(displayName ? { displayName } : {}),
    ...(avatar ? { avatar } : {})
  };
}

function snapshotFromStored(value: unknown, site: SessionSite): AccountSessionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<StoredAccountSessionV1>;
  if (stored.version !== 1) return null;
  if (stored.state === 'anonymous') {
    return { site, status: 'anonymous', cookieSummary: [], isVerifying: false, identityTrust: 'none' };
  }
  if (stored.state !== 'authenticated') return null;
  const identity = cleanIdentity(stored.identity, site);
  return identity
    ? {
        site,
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        identityTrust: 'confirmed',
        currentUser: { ...identity, topics: [] }
      }
    : null;
}

function recordFromSnapshot(snapshot: AccountSessionSnapshot): StoredAccountSessionV1 | null {
  if (snapshot.status === 'logged-in' && snapshot.identityTrust === 'confirmed') {
    const identity = cleanIdentity(snapshot.currentUser, snapshot.site);
    return identity ? { version: 1, state: 'authenticated', identity } : null;
  }
  return snapshot.identityTrust === 'none' ? { version: 1, state: 'anonymous' } : null;
}

export function loadAccountSessionSnapshot(site: SessionSite) {
  return operations.run(site, async () => {
    try {
      const raw = await AsyncStorage.getItem(storageKey(site));
      return raw ? snapshotFromStored(JSON.parse(raw), site) : null;
    } catch {
      return null;
    }
  });
}

export function saveAccountSessionSnapshot(snapshot: AccountSessionSnapshot) {
  return operations.run(snapshot.site, async () => {
    const record = recordFromSnapshot(snapshot);
    if (!record) return false;
    await AsyncStorage.setItem(storageKey(snapshot.site), JSON.stringify(record));
    return true;
  });
}

export function loadAccountSessionMigrationCompleted() {
  return operations.run(MIGRATION_STORAGE_KEY, async () => {
    try {
      return (await AsyncStorage.getItem(MIGRATION_STORAGE_KEY)) === '1';
    } catch {
      return false;
    }
  });
}

export function markAccountSessionMigrationCompleted() {
  return operations.run(MIGRATION_STORAGE_KEY, () => AsyncStorage.setItem(MIGRATION_STORAGE_KEY, '1'));
}
