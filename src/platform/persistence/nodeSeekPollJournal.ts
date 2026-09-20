import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

export type NodeSeekPollJournalEntry = {
  localId: string;
  fingerprint: string;
  remoteId: string | null;
};

const KEY_PREFIX = 'wz:composer:nodeseek-polls:';
const DATABASE_NAME = 'composer-journal.db';
let databasePromise: Promise<SQLiteDatabase> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let transactionUncertain = false;

const schema = `
CREATE TABLE nodeseek_poll_journal (
  identity_key TEXT NOT NULL, local_id TEXT NOT NULL, fingerprint TEXT NOT NULL, remote_id TEXT,
  PRIMARY KEY(identity_key, local_id, fingerprint)
);
CREATE TABLE nodeseek_poll_migration (
  identity_key TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('cleanup_pending', 'ready'))
);
PRAGMA user_version = 1;
`;

function storageKey(identityKey: string) {
  const clean = String(identityKey || '').trim();
  if (!clean.startsWith('nodeseek:') || clean.length <= 'nodeseek:'.length || clean !== identityKey)
    throw new Error('NodeSeek 账号身份不正确');
  return `${KEY_PREFIX}${encodeURIComponent(clean)}`;
}

function validEntry(value: unknown): value is NodeSeekPollJournalEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<NodeSeekPollJournalEntry>;
  return (
    typeof entry.localId === 'string' &&
    /^[A-Za-z0-9_-]{8,80}$/.test(entry.localId) &&
    typeof entry.fingerprint === 'string' &&
    /^[a-f0-9]{16}$/.test(entry.fingerprint) &&
    (entry.remoteId === null || (typeof entry.remoteId === 'string' && /^\d+$/.test(entry.remoteId)))
  );
}

function enqueue<T>(operation: () => Promise<T>) {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}

async function transaction<T>(db: SQLiteDatabase, operation: () => Promise<T>) {
  if (transactionUncertain) throw new Error('投票事务状态不明，请重新启动后核对。');
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    const result = await operation();
    await db.execAsync('COMMIT');
    return result;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch (rollback) {
      transactionUncertain = true;
      throw new AggregateError([error, rollback], '投票事务无法确认，已阻止重复创建。');
    }
    throw error;
  }
}

async function connect() {
  const db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  try {
    await db.execAsync('PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (!version?.user_version)
      await transaction(db, async () => {
        const current = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
        if (!current?.user_version) await db.execAsync(schema);
        else if (current.user_version !== 1) throw new Error('投票事务版本无法识别，未修改原记录。');
      });
    else if (version.user_version !== 1) throw new Error('投票事务版本无法识别，未修改原记录。');
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    if (
      ['nodeseek_poll_journal', 'nodeseek_poll_migration'].some((name) => !tables.some((table) => table.name === name))
    )
      throw new Error('投票事务数据库不完整，已阻止重复创建。');
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

function database() {
  if (transactionUncertain) return Promise.reject(new Error('投票事务状态不明，请重新启动后核对。'));
  databasePromise ??= connect().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

async function readLegacyEntries(identityKey: string) {
  const raw = await AsyncStorage.getItem(storageKey(identityKey));
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 32 ||
    !parsed.every(validEntry) ||
    new Set(parsed.map((entry) => entry.localId)).size !== parsed.length
  ) {
    throw new Error('NodeSeek 投票事务记录已损坏，已阻止重复创建投票');
  }
  return parsed;
}

async function readEntries(db: SQLiteDatabase, identityKey: string) {
  const entries = await db.getAllAsync<NodeSeekPollJournalEntry>(
    'SELECT local_id AS localId, fingerprint, remote_id AS remoteId FROM nodeseek_poll_journal WHERE identity_key=? ORDER BY rowid DESC',
    identityKey
  );
  if (!entries.every(validEntry)) throw new Error('投票事务记录已损坏，已阻止重复创建。');
  return entries;
}

async function readEntry(db: SQLiteDatabase, identityKey: string, localId: string, fingerprint?: string) {
  const entry = await db.getFirstAsync<NodeSeekPollJournalEntry>(
    `SELECT local_id AS localId, fingerprint, remote_id AS remoteId FROM nodeseek_poll_journal
     WHERE identity_key=? AND local_id=?${fingerprint === undefined ? ' ORDER BY rowid DESC LIMIT 1' : ' AND fingerprint=?'}`,
    ...(fingerprint === undefined ? [identityKey, localId] : [identityKey, localId, fingerprint])
  );
  if (entry && !validEntry(entry)) throw new Error('投票事务记录已损坏，已阻止重复创建。');
  return entry;
}

async function accountDatabase(identityKey: string) {
  const key = storageKey(identityKey);
  const db = await database();
  let migration = await db.getFirstAsync<{ status: string }>(
    'SELECT status FROM nodeseek_poll_migration WHERE identity_key=?',
    identityKey
  );
  let expected: NodeSeekPollJournalEntry[] | undefined;
  if (!migration) {
    expected = await readLegacyEntries(identityKey);
    await transaction(db, async () => {
      // Another connection may have finished this account while legacy storage was read.
      migration = await db.getFirstAsync<{ status: string }>(
        'SELECT status FROM nodeseek_poll_migration WHERE identity_key=?',
        identityKey
      );
      if (migration) return;
      if ((await readEntries(db, identityKey)).length) throw new Error('投票事务迁移记录缺失，未重置原记录。');
      for (const entry of expected!) {
        await db.runAsync(
          'INSERT INTO nodeseek_poll_journal(identity_key, local_id, fingerprint, remote_id) VALUES (?, ?, ?, ?)',
          identityKey,
          entry.localId,
          entry.fingerprint,
          entry.remoteId
        );
      }
      await db.runAsync(
        "INSERT INTO nodeseek_poll_migration(identity_key, status) VALUES (?, 'cleanup_pending')",
        identityKey
      );
      migration = { status: 'cleanup_pending' };
    });
  }
  if (!migration || !['ready', 'cleanup_pending'].includes(migration.status))
    throw new Error('投票事务迁移状态不正确，已阻止重复创建。');
  if (migration.status === 'cleanup_pending') {
    const verification = await connect();
    try {
      const entries = await readEntries(verification, identityKey);
      if (
        expected?.some(
          (entry) =>
            !entries.some(
              (actual) =>
                actual.localId === entry.localId &&
                actual.fingerprint === entry.fingerprint &&
                (entry.remoteId === null || actual.remoteId === entry.remoteId)
            )
        )
      ) {
        throw new Error('投票事务迁移核对失败，未清理旧记录。');
      }
    } finally {
      await verification.closeAsync();
    }
    try {
      await AsyncStorage.removeItem(key);
      if ((await AsyncStorage.getItem(key)) !== null) throw new Error('投票旧记录清理尚未完成。');
      await transaction(db, () =>
        db.runAsync("UPDATE nodeseek_poll_migration SET status='ready' WHERE identity_key=?", identityKey)
      );
    } catch {
      // The committed database is authoritative; cleanup is retried on the next access.
    }
  }
  return db;
}

export function readNodeSeekPollJournalEntry(identityKey: string, localId: string, fingerprint?: string) {
  return enqueue(async () => {
    const db = await accountDatabase(identityKey);
    return readEntry(db, identityKey, localId, fingerprint);
  });
}

export function saveNodeSeekPollJournalEntry(identityKey: string, entry: NodeSeekPollJournalEntry) {
  return enqueue(async () => {
    if (!validEntry(entry)) throw new Error('NodeSeek 投票事务记录不正确');
    const db = await accountDatabase(identityKey);
    await transaction(db, async () => {
      const previous = await readEntry(db, identityKey, entry.localId, entry.fingerprint);
      if (previous?.remoteId && entry.remoteId && previous.remoteId !== entry.remoteId)
        throw new Error('同一投票意图出现冲突的远端 id，未覆盖原记录。');
      await db.runAsync(
        `INSERT INTO nodeseek_poll_journal(identity_key, local_id, fingerprint, remote_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(identity_key, local_id, fingerprint) DO UPDATE SET remote_id=COALESCE(remote_id, excluded.remote_id)`,
        identityKey,
        entry.localId,
        entry.fingerprint,
        entry.remoteId
      );
    });
  });
}

export function claimNodeSeekPollJournalEntry(identityKey: string, intent: Omit<NodeSeekPollJournalEntry, 'remoteId'>) {
  return enqueue(async () => {
    if (!validEntry({ ...intent, remoteId: null })) throw new Error('NodeSeek 投票事务记录不正确');
    const db = await accountDatabase(identityKey);
    return transaction(db, async () => {
      const existing = await readEntry(db, identityKey, intent.localId, intent.fingerprint);
      if (existing) return { claimed: false, entry: existing };
      await db.runAsync(
        'INSERT INTO nodeseek_poll_journal(identity_key, local_id, fingerprint, remote_id) VALUES (?, ?, ?, NULL)',
        identityKey,
        intent.localId,
        intent.fingerprint
      );
      return { claimed: true, entry: { ...intent, remoteId: null } };
    });
  });
}

export function releaseNodeSeekPollJournalEntry(
  identityKey: string,
  intent: Omit<NodeSeekPollJournalEntry, 'remoteId'>
) {
  return enqueue(async () => {
    if (!validEntry({ ...intent, remoteId: null })) throw new Error('NodeSeek 投票事务记录不正确');
    const db = await accountDatabase(identityKey);
    await transaction(db, () =>
      db.runAsync(
        'DELETE FROM nodeseek_poll_journal WHERE identity_key=? AND local_id=? AND fingerprint=? AND remote_id IS NULL',
        identityKey,
        intent.localId,
        intent.fingerprint
      )
    );
  });
}
