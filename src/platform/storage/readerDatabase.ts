import type { SQLiteDatabase } from 'expo-sqlite';
import { sourceValues } from '@/domain/forum/sourceCatalog';
import {
  createEmptyReaderData,
  MAX_DELETED_RECORDS,
  MAX_HISTORY_RECORDS,
  topicKey,
  topicSummary,
  userKey,
  userSummary,
  sanitizeReaderSettings,
  type ReaderData,
  type ReaderSettings,
  type TopicRecord,
  type FollowedUserRecord
} from '@/domain/reader/readerData';
import { MAX_BACKUP_JSON_BYTES } from '@/domain/reader/readerBackup';
import {
  createEmptyReaderState,
  readerCollections,
  type ReaderChange,
  type ReaderCollection,
  type ReaderCommand,
  type ReaderPageRequest,
  type ReaderState
} from '@/domain/reader/readerRecordState';

export type ReaderSql = Pick<SQLiteDatabase, 'execAsync' | 'getAllAsync' | 'getFirstAsync' | 'runAsync'>;
export type StoredReaderRecord = TopicRecord | FollowedUserRecord;
export interface ReaderMeta {
  status: 'cleanup_pending' | 'ready';
  settings: string;
  bytes: number;
  nextOrdinal: number;
}
type RecordRow = { kind: ReaderCollection; key: string; value: string; time: number; ordinal: number; bytes: number };
type CountRow = { kind: ReaderCollection; records: number; deleted: number };

export const readerSchema = `
CREATE TABLE IF NOT EXISTS reader_meta (
  id INTEGER PRIMARY KEY CHECK(id = 1), status TEXT NOT NULL,
  settings TEXT NOT NULL, bytes INTEGER NOT NULL, nextOrdinal INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reader_counts (kind TEXT PRIMARY KEY, records INTEGER NOT NULL, deleted INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reader_records (
  kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL,
  categoryKey TEXT NOT NULL, categoryLabel TEXT NOT NULL,
  time INTEGER NOT NULL, ordinal INTEGER NOT NULL, bytes INTEGER NOT NULL,
  PRIMARY KEY(kind, key)
);
CREATE INDEX IF NOT EXISTS reader_order ON reader_records(kind, time DESC, ordinal ASC);
CREATE INDEX IF NOT EXISTS reader_source_order ON reader_records(kind, source, time DESC, ordinal ASC);
CREATE INDEX IF NOT EXISTS reader_category_order ON reader_records(kind, categoryKey, time DESC, ordinal ASC);
CREATE INDEX IF NOT EXISTS reader_category_label ON reader_records(kind, categoryLabel, time DESC, ordinal ASC);
CREATE TABLE IF NOT EXISTS reader_deleted (
  kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  time INTEGER NOT NULL, ordinal INTEGER NOT NULL, bytes INTEGER NOT NULL,
  PRIMARY KEY(kind, key)
);
CREATE INDEX IF NOT EXISTS reader_deleted_order ON reader_deleted(kind, time DESC, ordinal ASC);
PRAGMA user_version = 1;
`;

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export async function readReaderMeta(sql: ReaderSql) {
  return sql.getFirstAsync<ReaderMeta>('SELECT status, settings, bytes, nextOrdinal FROM reader_meta WHERE id = 1');
}

export async function readReaderSnapshot(sql: ReaderSql): Promise<ReaderData> {
  const meta = await readReaderMeta(sql);
  if (!meta) throw new Error('本机资料尚未完成迁移。');
  const data = createEmptyReaderData();
  data.settings = JSON.parse(meta.settings);
  for (const row of await sql.getAllAsync<RecordRow>('SELECT kind, key, value FROM reader_records ORDER BY ordinal')) {
    (data[row.kind] as Record<string, StoredReaderRecord>)[row.key] = JSON.parse(row.value);
  }
  for (const row of await sql.getAllAsync<RecordRow>('SELECT kind, key, value FROM reader_deleted ORDER BY ordinal')) {
    data.deletedRecords[row.kind][row.key] = JSON.parse(row.value);
  }
  return data;
}

export async function readReaderBootstrap(sql: ReaderSql): Promise<ReaderState> {
  const meta = await readReaderMeta(sql);
  if (!meta || !['ready', 'cleanup_pending'].includes(meta.status)) throw new Error('本机资料状态不完整，未重置。');
  const state = createEmptyReaderState();
  state.settings = JSON.parse(meta.settings);
  const counts = await sql.getAllAsync<CountRow>('SELECT kind, records FROM reader_counts');
  if (
    counts.length !== readerCollections.length ||
    readerCollections.some((kind) => !counts.some((row) => row.kind === kind))
  ) {
    throw new Error('本机资料计数不完整，未重置。');
  }
  for (const row of counts) {
    state.counts[row.kind] = row.records;
  }
  // Payloads are deliberately absent from the normal startup query.
  const actual = { favorites: 0, history: 0, followedUsers: 0 };
  for (const row of await sql.getAllAsync<{ kind: ReaderCollection; key: string }>(
    'SELECT kind, key FROM reader_records'
  )) {
    if (!readerCollections.includes(row.kind)) throw new Error('本机资料集合无法识别，未重置。');
    (state[row.kind] as Record<string, unknown>)[row.key] = true;
    actual[row.kind]++;
  }
  if (readerCollections.some((kind) => actual[kind] !== state.counts[kind]))
    throw new Error('本机资料数量核对失败，未重置。');
  return state;
}

export interface ReaderPage {
  records: StoredReaderRecord[];
  total: number;
  visibleTotal: number;
  next?: { time: number; ordinal: number };
}

export async function readReaderPage(sql: ReaderSql, request: ReaderPageRequest): Promise<ReaderPage> {
  if (!request.sources.length) return { records: [], total: 0, visibleTotal: 0 };
  const allSources = sourceValues.every((source) => request.sources.includes(source));
  const where = ['kind = ?'];
  const params: (string | number)[] = [request.collection];
  if (!allSources) {
    where.push(`source IN (${request.sources.map(() => '?').join(',')})`);
    params.push(...request.sources);
  }
  const visibleTotal = allSources
    ? (
        await sql.getFirstAsync<{ records: number }>(
          'SELECT records FROM reader_counts WHERE kind = ?',
          request.collection
        )
      )?.records || 0
    : (
        await sql.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM reader_records WHERE ${where.join(' AND ')}`,
          params
        )
      )?.count || 0;
  if (request.source !== 'all') {
    where.push('source = ?');
    params.push(request.source);
  }
  if (request.collection !== 'followedUsers' && request.category !== 'all') {
    where.push('(categoryKey = ? OR categoryLabel = ?)');
    params.push(request.category, request.category);
  }
  const total =
    request.source === 'all' && (request.category === 'all' || request.collection === 'followedUsers')
      ? visibleTotal
      : (
          await sql.getFirstAsync<{ count: number }>(
            `SELECT COUNT(*) AS count FROM reader_records WHERE ${where.join(' AND ')}`,
            params
          )
        )?.count || 0;
  if (request.after) {
    where.push('(time < ? OR (time = ? AND ordinal > ?))');
    params.push(request.after.time, request.after.time, request.after.ordinal);
  }
  const rows = await sql.getAllAsync<RecordRow>(
    `SELECT value, time, ordinal FROM reader_records WHERE ${where.join(' AND ')} ORDER BY time DESC, ordinal ASC LIMIT 51`,
    params
  );
  const page = rows.slice(0, 50);
  const last = page[page.length - 1];
  return {
    records: page.map((row) => JSON.parse(row.value)),
    total,
    visibleTotal,
    ...(rows.length > 50 && last ? { next: { time: last.time, ordinal: last.ordinal } } : {})
  };
}

// One transaction owns both record changes and their byte/count deltas.
export class ReaderTransaction {
  readonly change: ReaderChange = { membership: [], counts: {}, changed: [] };
  private readonly changed = new Set<ReaderCollection>();
  private readonly membership = new Map<string, ReaderChange['membership'][number]>();
  private readonly dirtyCounts = new Set<ReaderCollection>();
  private readonly original: ReaderMeta;
  private constructor(
    private sql: ReaderSql,
    private meta: ReaderMeta,
    private counts: Record<ReaderCollection, CountRow>
  ) {
    this.original = { ...meta };
  }

  static async open(sql: ReaderSql) {
    const meta = await readReaderMeta(sql);
    if (!meta) throw new Error('本机资料尚未完成迁移。');
    const rows = await sql.getAllAsync<CountRow>('SELECT kind, records, deleted FROM reader_counts');
    return new ReaderTransaction(
      sql,
      meta,
      Object.fromEntries(rows.map((row) => [row.kind, row])) as Record<ReaderCollection, CountRow>
    );
  }

  static async initialize(sql: ReaderSql, settings: ReaderSettings) {
    const empty = { ...createEmptyReaderData(), settings };
    await sql.runAsync(
      'INSERT INTO reader_meta(id,status,settings,bytes,nextOrdinal) VALUES(1,?,?,?,1)',
      'cleanup_pending',
      JSON.stringify(settings),
      utf8Bytes(JSON.stringify(empty))
    );
    for (const kind of readerCollections)
      await sql.runAsync('INSERT INTO reader_counts(kind,records,deleted) VALUES(?,0,0)', kind);
    return ReaderTransaction.open(sql);
  }

  private mark(kind: ReaderCollection, key: string, present: boolean) {
    this.changed.add(kind);
    this.membership.set(`${kind}/${key}`, { collection: kind, key, present });
  }

  private async row(kind: ReaderCollection, key: string, deleted = false) {
    return this.sql.getFirstAsync<RecordRow>(
      `SELECT * FROM ${deleted ? 'reader_deleted' : 'reader_records'} WHERE kind = ? AND key = ?`,
      kind,
      key
    );
  }

  private async put(kind: ReaderCollection, key: string, value: StoredReaderRecord | string, deleted = false) {
    const old = await this.row(kind, key, deleted);
    const json = JSON.stringify(value);
    if (old?.value === json) return;
    const bytes = utf8Bytes(JSON.stringify(key)) + 1 + utf8Bytes(json);
    const column = deleted ? 'deleted' : 'records';
    this.meta.bytes += bytes - (old?.bytes || 0) + (!old && this.counts[kind][column] > 0 ? 1 : 0);
    if (!old) {
      this.counts[kind][column]++;
      this.dirtyCounts.add(kind);
    }
    const ordinal = old?.ordinal ?? this.meta.nextOrdinal++;
    if (deleted) {
      await this.sql.runAsync(
        `INSERT INTO reader_deleted(kind,key,value,time,ordinal,bytes) VALUES(?,?,?,?,?,?)
        ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,time=excluded.time,bytes=excluded.bytes`,
        kind,
        key,
        json,
        Date.parse(value as string),
        ordinal,
        bytes
      );
    } else {
      const record = value as StoredReaderRecord;
      const item = 'topic' in record ? record.topic : record.user;
      const time = Date.parse('savedAt' in record ? record.savedAt : record.followedAt);
      const category = 'topic' in record ? record.topic.categoryId || record.topic.category || '' : '';
      const label = 'topic' in record ? record.topic.category || '' : '';
      await this.sql.runAsync(
        `INSERT INTO reader_records(kind,key,value,source,categoryKey,categoryLabel,time,ordinal,bytes)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET
        value=excluded.value,source=excluded.source,categoryKey=excluded.categoryKey,categoryLabel=excluded.categoryLabel,time=excluded.time,bytes=excluded.bytes`,
        kind,
        key,
        json,
        item.source,
        `${item.source}:${category}`,
        label,
        time,
        ordinal,
        bytes
      );
      this.mark(kind, key, true);
    }
  }

  private async remove(kind: ReaderCollection, key: string, deleted = false) {
    const row = await this.row(kind, key, deleted);
    if (!row) return false;
    const column = deleted ? 'deleted' : 'records';
    this.meta.bytes -= row.bytes + (this.counts[kind][column] > 1 ? 1 : 0);
    this.counts[kind][column]--;
    this.dirtyCounts.add(kind);
    await this.sql.runAsync(
      `DELETE FROM ${deleted ? 'reader_deleted' : 'reader_records'} WHERE kind = ? AND key = ?`,
      kind,
      key
    );
    if (!deleted) this.mark(kind, key, false);
    return true;
  }

  private async trim(kind: ReaderCollection, limit: number, deleted = false) {
    const excess = this.counts[kind][deleted ? 'deleted' : 'records'] - limit;
    if (excess <= 0) return;
    const rows = await this.sql.getAllAsync<{ key: string }>(
      `SELECT key FROM ${deleted ? 'reader_deleted' : 'reader_records'} WHERE kind = ? ORDER BY time ASC, ordinal DESC LIMIT ?`,
      kind,
      excess
    );
    for (const row of rows) await this.remove(kind, row.key, deleted);
  }

  async apply(command: ReaderCommand) {
    if (command.type === 'settings') {
      this.setSettings(sanitizeReaderSettings({ ...JSON.parse(this.meta.settings), ...command.patch }));
      return;
    }
    if (command.type === 'visit') {
      const topic = topicSummary(command.topic);
      const key = topicKey(topic);
      const existing = await this.row('history', key);
      const previous: TopicRecord | undefined = existing ? JSON.parse(existing.value) : undefined;
      const limit = Math.max(MAX_HISTORY_RECORDS, this.counts.history.records);
      await this.put('history', key, {
        ...previous,
        topic,
        savedAt: command.at,
        visitCount: (previous?.visitCount || 0) + 1
      });
      await this.remove('history', key, true);
      const favorite = await this.row('favorites', key);
      if (favorite) await this.put('favorites', key, { ...JSON.parse(favorite.value), topic });
      await this.trim('history', limit);
      return;
    }
    if (command.type === 'favorite' || command.type === 'follow') {
      const kind = command.type === 'favorite' ? 'favorites' : 'followedUsers';
      const record: StoredReaderRecord =
        command.type === 'favorite'
          ? { topic: topicSummary(command.topic), savedAt: command.at }
          : { user: userSummary(command.user), followedAt: command.at };
      const key = 'topic' in record ? topicKey(record.topic) : userKey(record.user);
      const existing = await this.row(kind, key);
      if (command.enabled) {
        if (!existing) await this.put(kind, key, record);
        await this.remove(kind, key, true);
      } else if (await this.remove(kind, key)) {
        await this.put(kind, key, command.at, true);
        await this.trim(kind, MAX_DELETED_RECORDS, true);
      }
      return;
    }
    const kind = command.type === 'clear-history' ? 'history' : command.collection;
    const keys =
      command.type === 'clear-history'
        ? (await this.sql.getAllAsync<{ key: string }>('SELECT key FROM reader_records WHERE kind = ?', kind)).map(
            (row) => row.key
          )
        : [...new Set(command.keys)];
    let removed = false;
    for (const key of keys) {
      if (await this.remove(kind, key)) {
        removed = true;
        await this.put(kind, key, command.at, true);
      }
    }
    if (removed) await this.trim(kind, MAX_DELETED_RECORDS, true);
  }

  setSettings(settings: ReaderSettings) {
    const json = JSON.stringify(settings);
    if (json === this.meta.settings) return;
    this.meta.bytes += utf8Bytes(json) - utf8Bytes(this.meta.settings);
    this.meta.settings = json;
    this.change.settings = settings;
  }

  async seed(snapshot: ReaderData) {
    if (readerCollections.some((kind) => this.counts[kind].records || this.counts[kind].deleted)) {
      throw new Error('拒绝覆盖已存在的迁移资料。');
    }
    for (const kind of readerCollections) {
      for (const deleted of [false, true]) {
        const entries = Object.entries(deleted ? snapshot.deletedRecords[kind] : snapshot[kind]);
        for (let offset = 0; offset < entries.length; offset += 50) {
          const batch = entries.slice(offset, offset + 50);
          const params: (string | number)[] = [];
          for (const [key, value] of batch) {
            const json = JSON.stringify(value);
            const bytes = utf8Bytes(JSON.stringify(key)) + 1 + utf8Bytes(json);
            const ordinal = this.meta.nextOrdinal++;
            if (deleted) {
              params.push(kind, key, json, Date.parse(value as string), ordinal, bytes);
            } else {
              const record = value as StoredReaderRecord;
              const item = 'topic' in record ? record.topic : record.user;
              const category = 'topic' in record ? record.topic.categoryId || record.topic.category || '' : '';
              const label = 'topic' in record ? record.topic.category || '' : '';
              params.push(
                kind,
                key,
                json,
                item.source,
                `${item.source}:${category}`,
                label,
                Date.parse('savedAt' in record ? record.savedAt : record.followedAt),
                ordinal,
                bytes
              );
            }
          }
          const columns = deleted
            ? 'kind,key,value,time,ordinal,bytes'
            : 'kind,key,value,source,categoryKey,categoryLabel,time,ordinal,bytes';
          const placeholders = `(${Array.from({ length: deleted ? 6 : 9 }, () => '?').join(',')})`;
          await this.sql.runAsync(
            `INSERT INTO ${deleted ? 'reader_deleted' : 'reader_records'}(${columns}) VALUES ${batch.map(() => placeholders).join(',')}`,
            params
          );
        }
        this.counts[kind][deleted ? 'deleted' : 'records'] = entries.length;
        this.dirtyCounts.add(kind);
      }
    }
    this.meta.bytes = utf8Bytes(JSON.stringify(snapshot));
  }

  async replaceBackupSnapshot(snapshot: ReaderData) {
    await this.sql.execAsync('DELETE FROM reader_records; DELETE FROM reader_deleted;');
    for (const kind of readerCollections) {
      this.counts[kind].records = 0;
      this.counts[kind].deleted = 0;
    }
    this.meta.nextOrdinal = 1;
    this.setSettings(snapshot.settings);
    await this.seed(snapshot);
  }

  async finish(migration = false) {
    if (!migration && this.meta.bytes > Math.max(MAX_BACKUP_JSON_BYTES, this.original.bytes)) {
      throw new Error('本机资料超过备份容量，请减少历史记录后重试。');
    }
    if (JSON.stringify(this.meta) !== JSON.stringify(this.original)) {
      await this.sql.runAsync(
        'UPDATE reader_meta SET settings=?,bytes=?,nextOrdinal=? WHERE id=1',
        this.meta.settings,
        this.meta.bytes,
        this.meta.nextOrdinal
      );
    }
    for (const kind of this.dirtyCounts) {
      await this.sql.runAsync(
        'UPDATE reader_counts SET records=?,deleted=? WHERE kind=?',
        this.counts[kind].records,
        this.counts[kind].deleted,
        kind
      );
    }
    this.change.changed = [...this.changed];
    this.change.membership = [...this.membership.values()];
    for (const kind of this.changed) this.change.counts[kind] = this.counts[kind].records;
    return this.change;
  }
}
