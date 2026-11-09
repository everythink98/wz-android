import { createSqliteExecutor } from './sqliteExecutor';
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
import type { Topic } from '@/domain/forum/models';
import { isRecord } from '@/domain/forum/html';
import { createTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import {
  readerSchema,
  readReaderBootstrap,
  readReaderCategories,
  readReaderMeta,
  readReaderPage,
  readReaderSnapshot,
  ReaderTransaction
} from './readerDatabase';

const DATABASE_NAME = 'reader-data.db';
const LEGACY_KEYS = ['reader-data', 'reader-settings'];
type ReaderConnectionOwner = { kind: 'cold' } | { kind: 'retained'; db: SQLiteDatabase };
let connection: ReaderConnectionOwner = { kind: 'cold' };
const { enqueue, transaction, assertUsable } = createSqliteExecutor(
  '本机资料事务状态不明，请重新启动后恢复。',
  '本机资料事务无法确认，已停止修改。'
);

async function connect() {
  assertUsable();
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
    return closeAfterFailure(db, error);
  }
}

async function closeAfterFailure(db: SQLiteDatabase, error: unknown): Promise<never> {
  try {
    await db.closeAsync();
  } catch (closeError) {
    throw new AggregateError([error, closeError], '本机资料操作失败，且连接无法关闭。');
  }
  throw error;
}

async function withTemporaryDatabase<T>(read: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await connect();
  let result: T;
  try {
    result = await read(db);
  } catch (error) {
    return closeAfterFailure(db, error);
  }
  await db.closeAsync();
  return result;
}

function retainDatabase(db: SQLiteDatabase) {
  assertUsable();
  connection = { kind: 'retained', db };
  return db;
}

async function boundedLegacyIo<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('旧资料存储读取超时')), 3_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readLegacySettings(): Promise<ReaderSettings | null> {
  const trace = createTrace('reader-data', 'load-settings');
  const raw = await boundedLegacyIo(AsyncStorage.getItem('reader-settings')).catch((error) => {
    finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
    throw error;
  });
  try {
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
    await boundedLegacyIo(
      (async () => {
        await AsyncStorage.removeMany(LEGACY_KEYS);
        const remaining = await AsyncStorage.getAllKeys();
        if (LEGACY_KEYS.some((key) => remaining.includes(key))) throw new Error('旧资料清理尚未完成。');
      })()
    );
    // Only the owner queue may mark ready; a late legacy operation never reaches SQLite.
    await transaction(db, true, () => db.runAsync("UPDATE reader_meta SET status='ready' WHERE id=1"));
    finishDiagnosticTrace(trace, 'success', { state: 'ready', elapsedMs: performance.now() - started });
  } catch (error) {
    finishDiagnosticTrace(trace, 'partial', {
      state: 'cleanup-pending',
      elapsedMs: performance.now() - started,
      reason: normalizeDiagnosticReason(error)
    });
    assertUsable();
  }
}

async function verifyCommitted(expected?: import('@/domain/reader/readerData').ReaderData) {
  await withTemporaryDatabase((db) =>
    transaction(db, false, async () => {
      await readReaderBootstrap(db);
      if (expected && JSON.stringify(await readReaderSnapshot(db)) !== JSON.stringify(expected)) {
        throw new Error('已提交资料核对失败，未清理旧资料。');
      }
    })
  );
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
    return closeAfterFailure(db, error);
  }
}

async function database() {
  assertUsable();
  if (connection.kind === 'retained') return connection.db;
  // Public operations share the executor queue, so no second opener can overlap initialization.
  return retainDatabase(await initializeDatabase());
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

export function queryReaderCategories(request: Pick<ReaderPageRequest, 'collection' | 'sources'>) {
  return enqueue(async () => {
    const db = await database();
    return transaction(db, false, () => readReaderCategories(db, request));
  });
}

export function readHistoryReplyBaseline(
  key: string
): Promise<Pick<Topic, 'replyCount' | 'replyWatermark'> | undefined> {
  return enqueue(async () => {
    const db = await database();
    assertUsable();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM reader_records WHERE kind='history' AND key=?",
      key
    );
    if (!row) return undefined;
    const record: import('@/domain/reader/readerData').TopicRecord = JSON.parse(row.value);
    const { replyCount, replyWatermark } = record.topic;
    return {
      replyCount: Number.isSafeInteger(replyCount) && replyCount! >= 0 ? replyCount : undefined,
      replyWatermark: Number.isSafeInteger(replyWatermark) && replyWatermark! >= 0 ? replyWatermark : undefined
    };
  });
}

export function exportReaderDataBackup() {
  return enqueue(async () => {
    const db = await database();
    return exportReaderBackupJson(await transaction(db, false, () => readReaderSnapshot(db)));
  });
}

function mergeBackup(db: SQLiteDatabase, parsed: ReturnType<typeof parseReaderBackupJson>) {
  return transaction(db, true, async () => {
    const meta = await readReaderMeta(db);
    const current = meta ? await readReaderSnapshot(db) : createEmptyReaderData();
    const merged = mergeReaderData(current, parsed);
    const writer = meta ? await ReaderTransaction.open(db) : await ReaderTransaction.initialize(db, merged.settings);
    await writer.replaceBackupSnapshot(merged);
    await writer.finish();
    return readReaderBootstrap(db);
  });
}

async function recoverBackup(parsed: ReturnType<typeof parseReaderBackupJson>) {
  // This branch owns the connection until committed readback and cleanup permit retention.
  const db = await connect();
  try {
    const state = await mergeBackup(db, parsed);
    await verifyCommitted();
    await cleanupLegacy(db);
    retainDatabase(db);
    return state;
  } catch (error) {
    return closeAfterFailure(db, error);
  }
}

export function importReaderDataBackup(json: string, recovery = false) {
  const parsed = parseReaderBackupJson(json);
  return enqueue(async () => {
    // Explicit recovery may replace unreadable legacy data, never a corrupt committed database.
    if (recovery && connection.kind === 'cold') return recoverBackup(parsed);
    return mergeBackup(await database(), parsed);
  });
}

async function readSettings(db: SQLiteDatabase) {
  assertUsable();
  const meta = await readReaderMeta(db);
  if (meta) {
    if (!['ready', 'cleanup_pending'].includes(meta.status)) throw new Error('本机资料状态不完整。');
    return sanitizeReaderSettings(JSON.parse(meta.settings));
  }
  return (await readLegacySettings()) ?? createEmptyReaderData().settings;
}

export function loadReaderSettings() {
  // Headless startup borrows retained authority or owns a temporary connection, without migrating payloads.
  return enqueue(() =>
    connection.kind === 'retained' ? readSettings(connection.db) : withTemporaryDatabase(readSettings)
  );
}
