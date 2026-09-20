// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyReaderData, MAX_HISTORY_RECORDS, topicKey, type ReaderData } from '@/domain/reader/readerData';
import type { Topic, UserDetails } from '@/domain/forum/models';

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
  vi.useRealTimers();
  for (const connection of harness.connections) connection.close();
  harness.connections = [];
  rmSync(harness.directory, { recursive: true, force: true });
});

describe('reader data storage authority', () => {
  it.each(['exported', 'empty'] as const)(
    'retains untimed source topics after merging an %s backup and reopening',
    async (backup) => {
      // sourceUserRead.test.ts owns the parser contract that missing source dates stay unknown.
      const profile: UserDetails = {
        source: 'nodeseek',
        id: '48872',
        username: 'alice',
        url: 'https://www.nodeseek.com/space/48872'
      };
      const untimed: Topic = {
        ...topic,
        id: '101',
        url: 'https://www.nodeseek.com/post-101-1',
        createdAt: '',
        lastReplyAt: '',
        replyCount: 0
      };
      const store = await reopen();
      await store.loadReaderState();
      await store.commitReaderCommand({ type: 'visit', topic: untimed, at });
      await store.commitReaderCommand({ type: 'favorite', topic: untimed, enabled: true, at });
      await store.commitReaderCommand({ type: 'follow', user: { ...profile, topics: [untimed] }, enabled: true, at });
      const json =
        backup === 'exported' ? await store.exportReaderDataBackup() : JSON.stringify(createEmptyReaderData());
      if (backup === 'exported') {
        const exported: ReaderData = JSON.parse(json);
        expect(exported.favorites['nodeseek:101'].topic.createdAt).toBe('');
        expect(exported.history['nodeseek:101'].topic.createdAt).toBe('');
        expect(exported.followedUsers['nodeseek:48872'].user.topics[0].createdAt).toBe('');
      }
      await store.importReaderDataBackup(json);
      expect((await (await reopen()).loadReaderState()).counts).toEqual({ favorites: 1, history: 1, followedUsers: 1 });
      for (const kind of ['favorites', 'history'] as const) {
        const row = inspect<{ value: string }>(
          `SELECT value FROM reader_records WHERE kind='${kind}' AND key='nodeseek:101'`
        );
        expect(JSON.parse(row.value)).toMatchObject({ savedAt: at, topic: { createdAt: '', replyCount: 0 } });
      }
      const followed = inspect<{ value: string }>(
        "SELECT value FROM reader_records WHERE kind='followedUsers' AND key='nodeseek:48872'"
      );
      expect(JSON.parse(followed.value).user.topics).toMatchObject([{ createdAt: '' }]);
      expect(await store.readHistoryReplyBaseline('nodeseek:101')).toEqual({ replyCount: 0 });
    }
  );

  it('distinguishes missing, zero and known reply baselines without inferring a floor from a count', async () => {
    const store = await reopen();
    await store.loadReaderState();
    expect(await store.readHistoryReplyBaseline(topicKey(topic))).toBeUndefined();
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, replyCount: 0 }, at });
    expect(await store.readHistoryReplyBaseline(topicKey(topic))).toEqual({ replyCount: 0 });
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, replyCount: 2, replyWatermark: 7 }, at });
    expect(await store.readHistoryReplyBaseline(topicKey(topic))).toEqual({ replyCount: 2, replyWatermark: 7 });
    const backup = await store.exportReaderDataBackup();
    await store.importReaderDataBackup(backup);
    expect(await store.readHistoryReplyBaseline(topicKey(topic))).toEqual({ replyCount: 2, replyWatermark: 7 });
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, replyCount: undefined }, at });
    expect(await store.readHistoryReplyBaseline(topicKey(topic))).toEqual({});
  });

  it('settles a hung legacy settings read after three seconds and ignores its late value', async () => {
    vi.useFakeTimers();
    const data = createEmptyReaderData();
    data.history[topicKey(topic)] = { topic, savedAt: at };
    seed(data);
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    let resolveSettings!: (value: string) => void;
    vi.mocked(storage.getItem).mockImplementationOnce(async () => JSON.stringify(data));
    vi.mocked(storage.getItem).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve;
        })
    );
    const store = await reopen();
    let restored: Awaited<ReturnType<typeof store.loadReaderState>> | undefined;
    const loading = store.loadReaderState().then((state) => {
      restored = state;
    });
    await vi.advanceTimersByTimeAsync(3_000);
    try {
      expect(restored?.counts.history).toBe(1);
      expect(restored?.settings).toEqual(data.settings);
    } finally {
      resolveSettings(JSON.stringify({ ...data.settings, fontScale: 1.8 }));
      await loading;
    }
    expect((await store.loadReaderState()).settings).toEqual(data.settings);
  });

  it.each(['removeMany', 'getAllKeys'] as const)(
    'releases committed data when legacy %s hangs without a late database write',
    async (method) => {
      vi.useFakeTimers();
      seed(createEmptyReaderData());
      const storage = (await import('@react-native-async-storage/async-storage')).default;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (method === 'removeMany') vi.mocked(storage.removeMany).mockImplementationOnce(() => pending);
      else
        vi.mocked(storage.getAllKeys).mockImplementationOnce(async () => {
          await pending;
          return [];
        });
      const store = await reopen();
      let restored = false;
      const loading = store.loadReaderState().then(() => {
        restored = true;
      });
      await vi.advanceTimersByTimeAsync(3_000);
      try {
        expect(restored).toBe(true);
        expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'cleanup_pending' });
        await store.commitReaderCommand({ type: 'visit', topic, at });
      } finally {
        release();
        await loading;
      }
      expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'cleanup_pending' });
      expect((await store.loadReaderState()).counts.history).toBe(1);
      await (await reopen()).loadReaderState();
      expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'ready' });
    }
  );
  it.each(['favorites', 'history', 'followedUsers'] as const)(
    'does not resurrect deleted %s after importing excess markers and reopening',
    async (collection) => {
      const local = createEmptyReaderData();
      local.deletedRecords[collection][topicKey(topic)] = '2026-06-02T00:00:00Z';
      seed(local);
      const store = await reopen();
      await store.loadReaderState();
      const incoming = createEmptyReaderData();
      if (collection === 'followedUsers')
        incoming.followedUsers[topicKey(topic)] = {
          user: { source: topic.source, id: topic.id, username: 'alice', url: '', topics: [] },
          followedAt: '2026-06-01T00:00:00Z'
        };
      else incoming[collection][topicKey(topic)] = { topic, savedAt: '2026-06-01T00:00:00Z' };
      for (let index = 0; index < 1000; index++) {
        incoming.deletedRecords[collection][`nodeseek:other-${index}`] = '2026-07-01T00:00:00Z';
      }
      await store.importReaderDataBackup(JSON.stringify(incoming));
      const restored = await reopen();
      await restored.loadReaderState();
      const backup = JSON.parse(await restored.exportReaderDataBackup()) as ReaderData;
      expect(backup[collection][topicKey(topic)]).toBeUndefined();
      expect(Object.keys(backup.deletedRecords[collection])).toHaveLength(1000);
    }
  );

  it('keeps only canonical summaries through favorite, follow, delete and refavorite commands', async () => {
    const store = await reopen();
    await store.loadReaderState();
    const item = {
      ...topic,
      contentHtml: '<p>not stored</p>',
      displayTimeText: '今天',
      authorLevelLabel: 'Lv2',
      accessRequirement: { type: 'level' as const, label: '需等级', detail: 'Lv2' },
      token: 'PRIVATE_TOKEN'
    };
    const user = {
      source: 'linuxdo' as const,
      id: 'alice',
      username: 'alice',
      url: '',
      topics: [],
      levelLabel: 'Lv2',
      token: 'PRIVATE_TOKEN'
    };
    await store.commitReaderCommand({ type: 'favorite', topic: item, enabled: true, at });
    await store.commitReaderCommand({ type: 'follow', user, enabled: true, at });
    await store.commitReaderCommand({ type: 'visit', topic: item, at });
    const first = JSON.parse(await store.exportReaderDataBackup());
    expect(first.favorites['nodeseek:1'].topic).not.toHaveProperty('contentHtml');
    expect(first.favorites['nodeseek:1'].topic.accessRequirement).toEqual(item.accessRequirement);
    expect(first.favorites['nodeseek:1'].topic.authorLevelLabel).toBe('Lv2');
    expect(first.history['nodeseek:1'].topic).not.toHaveProperty('displayTimeText');
    expect(first.followedUsers['linuxdo:alice'].user).toMatchObject({
      id: 'alice',
      url: 'https://linux.do/u/alice',
      levelLabel: 'Lv2'
    });
    expect(JSON.stringify(first)).not.toContain('PRIVATE_TOKEN');
    const later = '2026-09-11T00:00:00.000Z';
    await store.commitReaderCommand({ type: 'favorite', topic, enabled: false, at: later });
    await store.commitReaderCommand({ type: 'follow', user, enabled: false, at: later });
    const deleted = JSON.parse(await store.exportReaderDataBackup());
    expect(deleted.deletedRecords.favorites['nodeseek:1']).toBe(later);
    expect(deleted.deletedRecords.followedUsers['linuxdo:alice']).toBe(later);
    expect(deleted.followedUsers).toEqual({});
    const newest = '2026-09-12T00:00:00.000Z';
    await store.commitReaderCommand({ type: 'favorite', topic, enabled: true, at: newest });
    const restored = JSON.parse(await store.exportReaderDataBackup());
    expect(restored.favorites['nodeseek:1'].savedAt).toBe(newest);
    expect(restored.deletedRecords.favorites['nodeseek:1']).toBeUndefined();
  });

  it('caps new history at the canonical limit and serializes import then clear without restoring deleted entries', async () => {
    const data = createEmptyReaderData();
    for (let index = 0; index < MAX_HISTORY_RECORDS; index++)
      data.history[`nodeseek:${index}`] = {
        topic: { ...topic, id: String(index) },
        savedAt: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString()
      };
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, id: 'newest' }, at });
    const saved = JSON.parse(await store.exportReaderDataBackup());
    expect(Object.keys(saved.history)).toHaveLength(MAX_HISTORY_RECORDS);
    expect(saved.history['nodeseek:0']).toBeUndefined();
    expect(saved.history['nodeseek:newest'].visitCount).toBe(1);
    const imported = store.importReaderDataBackup(JSON.stringify(saved));
    const cleared = store.commitReaderCommand({ type: 'clear-history', at: '2026-09-13T00:00:00.000Z' });
    await Promise.all([imported, cleared]);
    expect((await store.loadReaderState()).counts.history).toBe(0);
  });

  it('clears full history with bounded SQL work while retaining the same deletion window after reopen', async () => {
    const data = createEmptyReaderData();
    for (let i = 0; i < MAX_HISTORY_RECORDS; i++)
      data.history[`nodeseek:${i}`] = {
        topic: { ...topic, id: String(i), url: `https://www.nodeseek.com/post-${i}-1` },
        savedAt: at
      };
    data.favorites['nodeseek:kept'] = {
      topic: { ...topic, id: 'kept', url: 'https://www.nodeseek.com/post-kept-1' },
      savedAt: at
    };
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    harness.queries = [];
    const change = await store.commitReaderCommand({ type: 'clear-history', at });
    const work = harness.queries.length;
    expect(change.membership).toHaveLength(MAX_HISTORY_RECORDS);
    expect(change.counts).toEqual({ history: 0 });
    const reopened = await reopen();
    const saved: ReaderData = JSON.parse(await reopened.exportReaderDataBackup());
    expect(saved.history).toEqual({});
    expect(saved.favorites).toEqual(data.favorites);
    const expectedKeys = Object.keys(data.history).sort().slice(0, 1000);
    expect(Object.keys(saved.deletedRecords.history)).toEqual(expectedKeys);
    expect(Object.values(saved.deletedRecords.history).every((value) => value === at)).toBe(true);
    expect(inspect<{ bytes: number }>('SELECT bytes FROM reader_meta').bytes).toBe(
      Buffer.byteLength(JSON.stringify(saved), 'utf8')
    );
    expect(work).toBeLessThan(1000);
  });

  it('rolls back a failed bulk deletion and preserves duplicate, missing and existing tombstone semantics', async () => {
    const data = createEmptyReaderData();
    for (let i = 0; i < 103; i++)
      data.history[`nodeseek:${i}`] = {
        topic: { ...topic, id: String(i), url: `https://www.nodeseek.com/post-${i}-1` },
        savedAt: at
      };
    data.deletedRecords.history['nodeseek:1'] = '2026-09-09T00:00:00.000Z';
    data.deletedRecords.history['nodeseek:2'] = at;
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    const keys = ['nodeseek:missing', 'nodeseek:2', ...Object.keys(data.history).reverse(), 'nodeseek:2'];
    harness.fail = 'INSERT INTO reader_deleted';
    await expect(store.commitReaderCommand({ type: 'delete', collection: 'history', keys, at })).rejects.toThrow(
      'injected'
    );
    expect(JSON.parse(await (await reopen()).exportReaderDataBackup())).toEqual(data);
    const current = await reopen();
    const change = await current.commitReaderCommand({ type: 'delete', collection: 'history', keys, at });
    expect(change.membership).toHaveLength(103);
    const saved: ReaderData = JSON.parse(await current.exportReaderDataBackup());
    expect(saved.history).toEqual({});
    expect(saved.deletedRecords.history).toEqual(Object.fromEntries(Object.keys(data.history).map((key) => [key, at])));
    expect(inspect<{ bytes: number }>('SELECT bytes FROM reader_meta').bytes).toBe(
      Buffer.byteLength(JSON.stringify(saved), 'utf8')
    );
  });
  it('completes a visited topic summary without changing its visit count or exporting account reading fields', async () => {
    const store = await reopen();
    await store.loadReaderState();
    const item = { ...topic, source: 'linuxdo' as const };
    await store.commitReaderCommand({ type: 'visit', topic: item, at });
    await store.commitReaderCommand({
      type: 'topic-summary',
      topic: {
        ...item,
        title: 'loaded',
        replyCount: 9,
        reading: { topicId: item.id, lastReadPostNumber: 8, highestPostNumber: 10 }
      }
    });
    const saved = JSON.parse(await store.exportReaderDataBackup()).history['linuxdo:1'];
    expect(saved).toMatchObject({ savedAt: at, visitCount: 1, topic: { title: 'loaded', replyCount: 9 } });
    expect(saved.topic).not.toHaveProperty('reading');
  });

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

  it.each(['2026-05-18T11:34:13.000Z', ''])(
    'migrates complete records with publication date %j and keeps unrelated legacy keys',
    async (createdAt) => {
      const data = createEmptyReaderData();
      const item = { ...topic, createdAt };
      data.history[topicKey(item)] = { topic: item, savedAt: at, visitCount: 12 };
      data.favorites[topicKey(item)] = { topic: { ...item, title: '独立收藏快照' }, savedAt: '2025-01-01T00:00:00Z' };
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
    }
  );

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

  it('persists sanitized backup records and merges local data, settings and identity deletion markers', async () => {
    const local = createEmptyReaderData();
    local.history[topicKey(topic)] = { topic, savedAt: at };
    const ids = ['sidney', 'session-user', 'proxy-reader', 'token-owner'];
    for (const id of ids) {
      local.followedUsers[`v2ex:${id}`] = {
        user: { source: 'v2ex', id, username: id, url: `https://www.v2ex.com/member/${id}`, topics: [] },
        followedAt: '2026-01-01T00:00:00.000Z'
      };
    }
    seed(local);
    const store = await reopen();
    await store.loadReaderState();
    const unsafeTopic = {
      ...topic,
      id: '42',
      authorId: '7',
      url: 'https://user:pass@www.nodeseek.com/post-42-9?unknown_credential=fake-topic#reply',
      authorUrl: 'https://user:pass@www.nodeseek.com/space/7?unknown_credential=fake-author#profile',
      authorAvatar: 'https://user:pass@cdn.example.com/avatar.png?X-Amz-Signature=fake-amz#profile',
      authorization: 'fake-authorization'
    };
    const incoming = {
      ...createEmptyReaderData(),
      favorites: {
        'nodeseek:42': { topic: unsafeTopic, savedAt: at },
        'linuxdo:1': {
          topic: { ...topic, source: 'linuxdo', url: 'https://linux.do/t/slug/1?session=fake-session&safe=1' },
          savedAt: at
        }
      },
      followedUsers: {
        'linuxdo:88': {
          user: {
            source: 'linuxdo',
            id: '88',
            username: 'alice',
            url: 'https://user:pass@linux.do/u/wrong?unknown_credential=fake-profile#profile',
            avatar: 'https://user:pass@cdn.example.com/user.png?Signature=fake-user#profile',
            topics: []
          },
          followedAt: at
        }
      },
      deletedRecords: {
        ...createEmptyReaderData().deletedRecords,
        followedUsers: Object.fromEntries(ids.map((id) => [`v2ex:${id}`, at])),
        subscriptions: { 'v2ex:create': at }
      },
      settings: {
        theme: 'dark',
        contentSources: [{ source: 'linuxdo', enabled: false }],
        token: 'fake-token',
        trackedKeywords: ['linux'],
        blockedKeywords: ['广告'],
        blockedUsers: ['spammer'],
        blockedCategories: ['v2ex:create']
      },
      subscriptions: { 'v2ex:create': { source: 'v2ex', id: 'create' } },
      secret: 'fake-secret'
    };
    await store.importReaderDataBackup(JSON.stringify(incoming));
    const restored = await reopen();
    expect((await restored.loadReaderState()).counts).toEqual({ favorites: 2, history: 1, followedUsers: 1 });
    const { readReaderSnapshot } = await import('./readerDatabase');
    const { openDatabaseAsync } = await import('expo-sqlite');
    const db = await openDatabaseAsync('reader-data.db');
    const saved = await readReaderSnapshot(db);
    await db.closeAsync();

    expect(saved.history).toEqual(local.history);
    expect(saved.favorites['nodeseek:42'].topic).toMatchObject({
      url: 'https://www.nodeseek.com/post-42-1',
      authorUrl: 'https://www.nodeseek.com/space/7',
      authorAvatar: 'https://cdn.example.com/avatar.png'
    });
    expect(saved.favorites['linuxdo:1'].topic.url).toBe('https://linux.do/t/1');
    expect(saved.followedUsers['linuxdo:88'].user).toMatchObject({
      url: 'https://linux.do/u/alice',
      avatar: 'https://cdn.example.com/user.png'
    });
    expect(saved.deletedRecords.followedUsers).toEqual(incoming.deletedRecords.followedUsers);
    expect(saved.settings).toEqual({
      ...local.settings,
      theme: 'dark',
      contentSources: [
        { source: 'linuxdo', enabled: false },
        { source: 'v2ex', enabled: true },
        { source: 'nodeseek', enabled: true },
        { source: 'yaohuo', enabled: true }
      ]
    });
    expect(JSON.stringify(saved)).not.toMatch(/fake-|authorization|subscriptions/);
  });

  it.each(['{broken', '{"version":1}'])('rejects invalid backup %s without changing committed data', async (json) => {
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({ type: 'favorite', topic, enabled: true, at });
    const before = await store.exportReaderDataBackup();
    await expect(async () => store.importReaderDataBackup(json)).rejects.toThrow();
    expect(await (await reopen()).exportReaderDataBackup()).toBe(before);
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
