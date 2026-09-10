import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import {
  createEmptyReaderData,
  mergeReaderData,
  sanitizeReaderSettings,
  validateStoredReaderData,
  type ReaderSettings
} from '@/domain/reader/readerData';
import { exportReaderBackupJson, parseReaderBackupJson } from '@/domain/reader/readerBackup';
import type { ReaderCommand, ReaderPageRequest } from '@/domain/reader/readerRecordState';
import { isRecord } from '@/domain/forum/html';
import { createTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import {
  readerSchema,
  readReaderBootstrap,
  readReaderMeta,
  readReaderPage,
  readReaderSnapshot,
  ReaderTransaction
} from './readerDatabase';

const DATABASE_NAME = 'reader-data.db';
const LEGACY_KEYS = ['reader-data', 'reader-settings'];
let databasePromise: Promise<SQLiteDatabase> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let transactionUncertain = false;

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}

async function connect() {
  const db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  try {
    await db.execAsync('PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (version && version.user_version > 1) throw new Error('本机资料版本较新，未修改原资料。');
    if (!version?.user_version) await db.execAsync(readerSchema);
    else {
      const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
      if (
        ['reader_meta', 'reader_counts', 'reader_records', 'reader_deleted'].some(
          (name) => !tables.some((table) => table.name === name)
        )
      ) {
        throw new Error('本机数据库不完整，未回退或重置资料。');
      }
    }
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

// All statements on this connection belong to the owner queue. BEGIN IMMEDIATE
// reserves the writer before reading; no unrelated async query can join it.
async function transaction<T>(db: SQLiteDatabase, write: boolean, task: () => Promise<T>): Promise<T> {
  if (transactionUncertain) throw new Error('本机资料事务状态不明，请重新启动后恢复。');
  await db.execAsync(write ? 'BEGIN IMMEDIATE' : 'BEGIN DEFERRED');
  try {
    const value = await task();
    await db.execAsync('COMMIT');
    return value;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch (rollback) {
      transactionUncertain = true;
      throw new AggregateError([error, rollback], '本机资料事务无法确认，已停止修改。');
    }
    throw error;
  }
}

async function readLegacySettings(): Promise<ReaderSettings | null> {
  const trace = createTrace('reader-data', 'load-settings');
  try {
    const raw = await AsyncStorage.getItem('reader-settings');
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const valid = isRecord(parsed);
    finishDiagnosticTrace(trace, valid ? 'success' : raw === null ? 'noop' : 'partial', {
      state: valid ? 'restored' : raw === null ? 'missing' : 'fallback'
    });
    return valid ? sanitizeReaderSettings(parsed) : null;
  } catch (error) {
    finishDiagnosticTrace(trace, 'partial', { state: 'fallback', reason: normalizeDiagnosticReason(error) });
    return null;
  }
}

async function cleanupLegacy(db: SQLiteDatabase) {
  const started = performance.now();
  const trace = createTrace('reader-data', 'migration-cleanup');
  try {
    await AsyncStorage.removeMany(LEGACY_KEYS);
    const remaining = await AsyncStorage.getAllKeys();
    if (LEGACY_KEYS.some((key) => remaining.includes(key))) throw new Error('旧资料清理尚未完成。');
    await transaction(db, true, () => db.runAsync("UPDATE reader_meta SET status='ready' WHERE id=1"));
    finishDiagnosticTrace(trace, 'success', { state: 'ready', elapsedMs: performance.now() - started });
  } catch (error) {
    finishDiagnosticTrace(trace, 'partial', {
      state: 'cleanup-pending',
      elapsedMs: performance.now() - started,
      reason: normalizeDiagnosticReason(error)
    });
  }
}

async function verifyCommitted(expected?: import('@/domain/reader/readerData').ReaderData) {
  const connection = await connect();
  try {
    await transaction(connection, false, async () => {
      await readReaderBootstrap(connection);
      if (expected && JSON.stringify(await readReaderSnapshot(connection)) !== JSON.stringify(expected)) {
        throw new Error('已提交资料核对失败，未清理旧资料。');
      }
    });
  } finally {
    await connection.closeAsync();
  }
}

async function initializeDatabase() {
  const db = await connect();
  try {
    const meta = await readReaderMeta(db);
    if (meta && !['ready', 'cleanup_pending'].includes(meta.status)) throw new Error('本机资料状态不完整，未重置。');
    if (!meta) {
      const started = performance.now();
      const trace = createTrace('reader-data', 'migrate');
      try {
        // Migration has no total timeout: a large but valid transaction must finish.
        const [raw, settings] = await Promise.all([AsyncStorage.getItem('reader-data'), readLegacySettings()]);
        const data = raw === null ? createEmptyReaderData() : validateStoredReaderData(JSON.parse(raw));
        data.settings = settings ?? {
          ...data.settings,
          contentSources: createEmptyReaderData().settings.contentSources
        };
        await transaction(db, true, async () => {
          const writer = await ReaderTransaction.initialize(db, data.settings);
          await writer.seed(data);
          await writer.finish(true);
          const actual = await readReaderSnapshot(db);
          if (JSON.stringify(actual) !== JSON.stringify(data)) throw new Error('资料迁移核对失败，未清理旧资料。');
        });
        await verifyCommitted(data);
        finishDiagnosticTrace(trace, 'success', { state: 'cleanup-pending', elapsedMs: performance.now() - started });
      } catch (error) {
        finishDiagnosticTrace(trace, 'failure', {
          elapsedMs: performance.now() - started,
          reason: normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
    if (!meta || meta.status === 'cleanup_pending') {
      if (meta) await verifyCommitted();
      await cleanupLegacy(db);
    }
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

function database() {
  databasePromise ??= initializeDatabase().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

export function loadReaderState() {
  return enqueue(async () => {
    recordStartupPhase('reader-start');
    const trace = createTrace('reader-data', 'restore');
    try {
      const db = await database();
      const state = await transaction(db, false, () => readReaderBootstrap(db));
      recordStartupPhase('reader-read');
      finishDiagnosticTrace(trace, 'success', {
        state: 'restored',
        count: state.counts.favorites + state.counts.history + state.counts.followedUsers
      });
      return state;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { state: 'recovery-mode', reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  });
}

export function commitReaderCommand(command: ReaderCommand) {
  return enqueue(async () => {
    const db = await database();
    return transaction(db, true, async () => {
      const writer = await ReaderTransaction.open(db);
      await writer.apply(command);
      return writer.finish();
    });
  });
}

export function queryReaderPage(request: ReaderPageRequest) {
  return enqueue(async () => {
    const db = await database();
    return transaction(db, false, () => readReaderPage(db, request));
  });
}

export function readHistoryReplyCount(key: string) {
  return enqueue(async () => {
    const db = await database();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM reader_records WHERE kind='history' AND key=?",
      key
    );
    if (!row) return 0;
    const record: import('@/domain/reader/readerData').TopicRecord = JSON.parse(row.value);
    return record.topic.replyCount || 0;
  });
}

export function exportReaderDataBackup() {
  return enqueue(async () => {
    const db = await database();
    return exportReaderBackupJson(await transaction(db, false, () => readReaderSnapshot(db)));
  });
}

export function importReaderDataBackup(json: string, recovery = false) {
  const parsed = parseReaderBackupJson(json);
  return enqueue(async () => {
    // Explicit backup recovery may replace unreadable legacy data, never a corrupt
    // committed database. Opening/schema errors still preserve recovery protection.
    const db = recovery && !databasePromise ? await connect() : await database();
    try {
      const state = await transaction(db, true, async () => {
        const meta = await readReaderMeta(db);
        const current = meta ? await readReaderSnapshot(db) : createEmptyReaderData();
        const merged = mergeReaderData(current, parsed);
        const writer = meta
          ? await ReaderTransaction.open(db)
          : await ReaderTransaction.initialize(db, merged.settings);
        await writer.replaceBackupSnapshot(merged);
        await writer.finish();
        return readReaderBootstrap(db);
      });
      if (recovery && !databasePromise) {
        await verifyCommitted();
        await cleanupLegacy(db);
        databasePromise = Promise.resolve(db);
      }
      return state;
    } catch (error) {
      if (!databasePromise) await db.closeAsync();
      throw error;
    }
  });
}

export function loadReaderSettings() {
  return enqueue(async () => {
    // Headless notification startup reads the authority without migrating payloads.
    const owned = databasePromise !== undefined;
    const db = owned ? await databasePromise! : await connect();
    try {
      const meta = await readReaderMeta(db);
      if (meta) {
        if (!['ready', 'cleanup_pending'].includes(meta.status)) throw new Error('本机资料状态不完整。');
        return sanitizeReaderSettings(JSON.parse(meta.settings));
      }
      return (await readLegacySettings()) ?? createEmptyReaderData().settings;
    } finally {
      if (!owned) await db.closeAsync();
    }
  });
}
