// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyReaderData, topicKey, type ReaderData } from '@/domain/reader/readerData';
import type { Topic } from '@/domain/forum/models';

const harness = vi.hoisted(() => ({
  directory: '',
  connections: [] as { close(): void }[],
  legacy: new Map<string, string>(),
  queries: [] as string[],
  fail: ''
}));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { join } = await import('node:path');
  return {
    openDatabaseAsync: vi.fn(async (name: string) => {
      const db = new DatabaseSync(join(harness.directory, name));
      harness.connections.push(db);
      const parameters = (args: unknown[]) => (Array.isArray(args[0]) ? args[0] : args) as (string | number | null)[];
      const check = (sql: string) => {
        harness.queries.push(sql);
        if (harness.fail && sql.includes(harness.fail)) {
          harness.fail = '';
          throw new Error('injected storage failure');
        }
      };
      return {
        execAsync: async (sql: string) => {
          check(sql);
          db.exec(sql);
        },
        runAsync: async (sql: string, ...args: unknown[]) => {
          check(sql);
          return db.prepare(sql).run(...parameters(args));
        },
        getAllAsync: async (sql: string, ...args: unknown[]) => {
          check(sql);
          return db.prepare(sql).all(...parameters(args));
        },
        getFirstAsync: async (sql: string, ...args: unknown[]) => {
          check(sql);
          return db.prepare(sql).get(...parameters(args)) ?? null;
        },
        closeAsync: async () => {
          db.close();
          harness.connections = harness.connections.filter((item) => item !== db);
        }
      };
    })
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => harness.legacy.get(key) ?? null),
    removeMany: vi.fn(async (keys: string[]) => {
      for (const key of keys) harness.legacy.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...harness.legacy.keys()])
  }
}));

const topic: Topic = {
  source: 'nodeseek',
  id: '1',
  title: '中文 😀 " \\',
  author: 'alice',
  category: '日常',
  url: 'https://www.nodeseek.com/post-1-1',
  createdAt: '2026-05-18T11:34:13.000Z',
  replyCount: 2
};
const at = '2026-09-10T00:00:00.000Z';
const seed = (data: ReaderData) => {
  harness.legacy.set('reader-data', JSON.stringify(data));
  harness.legacy.set('reader-settings', JSON.stringify(data.settings));
};
const reopen = async () => {
  vi.resetModules();
  return import('./readerDataStore');
};
const inspect = <T>(sql: string): T => {
  const db = new DatabaseSync(join(harness.directory, 'reader-data.db'));
  try {
    return db.prepare(sql).get() as T;
  } finally {
    db.close();
  }
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  harness.fail = '';
  harness.queries = [];
  harness.legacy.clear();
  harness.directory = mkdtempSync(join(tmpdir(), 'reader-store-'));
});
afterEach(() => {
  for (const connection of harness.connections) connection.close();
  harness.connections = [];
  rmSync(harness.directory, { recursive: true, force: true });
});

describe('reader data storage authority', () => {
  it('does not trim grandfathered deletion markers when deletion changes no record', async () => {
    const data = createEmptyReaderData();
    for (let i = 0; i < 1002; i++) data.deletedRecords.history[`nodeseek:${i}`] = at;
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    harness.queries = [];
    await store.commitReaderCommand({ type: 'delete', collection: 'history', keys: ['nodeseek:absent'], at });
    await store.commitReaderCommand({ type: 'clear-history', at });
    expect(harness.queries.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    expect(JSON.parse(await store.exportReaderDataBackup())).toEqual(data);
  });

  it('migrates complete records in order, keeps other owners, then never reads legacy keys again', async () => {
    const data = createEmptyReaderData();
    data.history[topicKey(topic)] = { topic, savedAt: at, visitCount: 12 };
    data.favorites[topicKey(topic)] = { topic: { ...topic, title: '独立收藏快照' }, savedAt: '2025-01-01T00:00:00Z' };
    data.deletedRecords.history['nodeseek:deleted'] = at;
    seed(data);
    harness.legacy.set('session-marker', 'preserved');
    const store = await reopen();
    const state = await store.loadReaderState();
    expect(state.history).toEqual({ 'nodeseek:1': true });
    expect(JSON.parse(await store.exportReaderDataBackup())).toEqual(data);
    expect([...harness.legacy.keys()]).toEqual(['session-marker']);
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(storage.getItem).mockClear();
    await (await reopen()).loadReaderState();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'ready' });
  });

  it('rolls back a failed migration and retains both legacy keys for retry', async () => {
    const data = createEmptyReaderData();
    data.history[topicKey(topic)] = { topic, savedAt: at };
    seed(data);
    harness.fail = 'INSERT INTO reader_records';
    const store = await reopen();
    await expect(store.loadReaderState()).rejects.toThrow('injected');
    expect(harness.legacy.size).toBe(2);
    expect(inspect('SELECT count(*) AS count FROM reader_meta')).toEqual({ count: 0 });
    await expect(store.loadReaderState()).resolves.toMatchObject({ counts: { history: 1 } });
  });

  it('rejects an unsupported record instead of dropping it and announcing migration success', async () => {
    const data = createEmptyReaderData();
    data.history['wrong-key'] = { topic, savedAt: at };
    seed(data);
    const store = await reopen();
    await expect(store.loadReaderState()).rejects.toThrow('完整迁移');
    expect(harness.legacy.size).toBe(2);
  });

  it('uses committed data after partial cleanup and retries cleanup once next process', async () => {
    seed(createEmptyReaderData());
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(storage.removeMany).mockImplementationOnce(async () => {
      harness.legacy.delete('reader-data');
      throw new Error('cleanup failed');
    });
    const store = await reopen();
    await store.loadReaderState();
    expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'cleanup_pending' });
    await store.commitReaderCommand({ type: 'visit', topic, at });
    await store.loadReaderState();
    expect(storage.removeMany).toHaveBeenCalledTimes(1);
    const next = await reopen();
    await expect(next.loadReaderState()).resolves.toMatchObject({ counts: { history: 1 } });
    expect(harness.legacy.size).toBe(0);
    expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'ready' });
  });

  it('reads current database settings in a fresh background lifecycle after legacy cleanup', async () => {
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({
      type: 'settings',
      patch: { fontScale: 1.2, contentSources: [{ source: 'nodeseek', enabled: false }] }
    });
    expect(
      (await (await reopen()).loadReaderSettings()).contentSources.find((item) => item.source === 'nodeseek')?.enabled
    ).toBe(false);
    expect(harness.legacy.size).toBe(0);
  });

  it('normal bootstrap queries keys and counts without selecting complete record payloads', async () => {
    const store = await reopen();
    await store.loadReaderState();
    harness.queries = [];
    await (await reopen()).loadReaderState();
    expect(harness.queries.filter((sql) => /SELECT .*value.*FROM reader_records/i.test(sql))).toEqual([]);
  });

  it('uses maintained totals for the unfiltered page without scanning records to count twice', async () => {
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({ type: 'visit', topic, at });
    harness.queries = [];
    const page = await store.queryReaderPage({
      collection: 'history',
      sources: ['nodeseek', 'linuxdo', 'yaohuo', 'v2ex'],
      source: 'all',
      category: 'all'
    });
    expect(page).toMatchObject({ total: 1, visibleTotal: 1 });
    expect(harness.queries.some((sql) => /COUNT\(/.test(sql))).toBe(false);
  });

  it('updates history and existing favorite summary atomically while preserving favorite time', async () => {
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({ type: 'favorite', topic, enabled: true, at });
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, replyCount: 10 }, at: '2026-09-11T00:00:00Z' });
    let snapshot = JSON.parse(await store.exportReaderDataBackup());
    expect(snapshot.favorites['nodeseek:1'].savedAt).toBe(at);
    expect(snapshot.favorites['nodeseek:1'].topic.replyCount).toBe(10);
    harness.fail = 'COMMIT';
    await expect(
      store.commitReaderCommand({ type: 'visit', topic: { ...topic, replyCount: 20 }, at: '2026-09-12T00:00:00Z' })
    ).rejects.toThrow();
    snapshot = JSON.parse(await store.exportReaderDataBackup());
    expect(snapshot.history['nodeseek:1'].visitCount).toBe(1);
    expect(snapshot.favorites['nodeseek:1'].topic.replyCount).toBe(10);
  });

  it('queues export and import among writes without overwriting later commands', async () => {
    const store = await reopen();
    await store.loadReaderState();
    const first = store.commitReaderCommand({ type: 'visit', topic, at });
    const exported = store.exportReaderDataBackup();
    const second = store.commitReaderCommand({ type: 'visit', topic: { ...topic, id: '2' }, at });
    await first;
    expect(Object.keys(JSON.parse(await exported).history)).toEqual(['nodeseek:1']);
    await second;
    const incoming = createEmptyReaderData();
    incoming.favorites['nodeseek:3'] = { topic: { ...topic, id: '3' }, savedAt: at };
    const imported = store.importReaderDataBackup(JSON.stringify(incoming));
    const deleted = store.commitReaderCommand({ type: 'delete', collection: 'favorites', keys: ['nodeseek:3'], at });
    await imported;
    await deleted;
    const final = JSON.parse(await store.exportReaderDataBackup());
    expect(Object.keys(final.history)).toHaveLength(2);
    expect(final.favorites).toEqual({});
    expect(final.deletedRecords.favorites['nodeseek:3']).toBe(at);
  });

  it('rolls back a failed bulk backup import before applying later queued writes', async () => {
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({ type: 'favorite', topic, enabled: true, at });
    const incoming = createEmptyReaderData();
    incoming.history['nodeseek:2'] = { topic: { ...topic, id: '2' }, savedAt: at };
    harness.fail = 'INSERT INTO reader_records';
    const imported = store.importReaderDataBackup(JSON.stringify(incoming));
    const later = store.commitReaderCommand({ type: 'visit', topic: { ...topic, id: '3' }, at });
    await expect(imported).rejects.toThrow('injected storage failure');
    await later;
    const final = JSON.parse(await store.exportReaderDataBackup());
    expect(Object.keys(final.favorites)).toEqual(['nodeseek:1']);
    expect(Object.keys(final.history)).toEqual(['nodeseek:3']);
  });

  it('paginates tied timestamps with stable cursors and filters category fallback', async () => {
    const data = createEmptyReaderData();
    for (let i = 0; i < 123; i++) data.history[`nodeseek:${i}`] = { topic: { ...topic, id: String(i) }, savedAt: at };
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    const request = {
      collection: 'history' as const,
      sources: ['nodeseek'] as const,
      source: 'all' as const,
      category: '日常'
    };
    const one = await store.queryReaderPage(request);
    const two = await store.queryReaderPage({ ...request, after: one.next });
    const three = await store.queryReaderPage({ ...request, after: two.next });
    expect([one.records.length, two.records.length, three.records.length]).toEqual([50, 50, 23]);
    expect(one.total).toBe(123);
    expect(three.next).toBeUndefined();
    const records = [...one.records, ...two.records, ...three.records];
    expect(records.map((record) => ('topic' in record ? record.topic.id : ''))).toEqual(
      Array.from({ length: 123 }, (_, i) => String(i))
    );
  });

  it('retains over-cap migrated history and shrinks the effective limit only after explicit deletions', async () => {
    const data = createEmptyReaderData();
    for (let i = 0; i < 5002; i++)
      data.history[`nodeseek:${i}`] = {
        topic: { ...topic, id: String(i) },
        savedAt: new Date(1_700_000_000_000 + i).toISOString()
      };
    seed(data);
    const store = await reopen();
    expect((await store.loadReaderState()).counts.history).toBe(5002);
    expect(Object.keys(JSON.parse(await store.exportReaderDataBackup()).history)).toHaveLength(5002);
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, id: 'new' }, at });
    expect((await store.loadReaderState()).counts.history).toBe(5002);
    await store.commitReaderCommand({ type: 'delete', collection: 'history', keys: ['nodeseek:1', 'nodeseek:2'], at });
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, id: 'another' }, at });
    expect((await store.loadReaderState()).counts.history).toBe(5000);
  });

  it('maintains exact UTF-8 JSON bytes through a deterministic random operation sequence', async () => {
    const store = await reopen();
    await store.loadReaderState();
    let random = 42;
    for (let i = 0; i < 120; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const item = { ...topic, id: `${random % 13}😀"\\` };
      const op = random % 4;
      await store.commitReaderCommand(
        op === 0
          ? { type: 'visit', topic: item, at }
          : op === 1
            ? { type: 'favorite', topic: item, enabled: true, at }
            : op === 2
              ? { type: 'delete', collection: 'history', keys: [topicKey(item)], at }
              : { type: 'favorite', topic: item, enabled: false, at }
      );
      const { readReaderSnapshot } = await import('./readerDatabase');
      const { openDatabaseAsync } = await import('expo-sqlite');
      const db = await openDatabaseAsync('reader-data.db');
      const actual = Buffer.byteLength(JSON.stringify(await readReaderSnapshot(db)), 'utf8');
      await db.closeAsync();
      expect(inspect<{ bytes: number }>('SELECT bytes FROM reader_meta').bytes).toBe(actual);
    }
  });
});
