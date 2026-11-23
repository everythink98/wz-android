// @vitest-environment node
import { sqliteParameters } from '../../../tests/helpers/sqliteParameters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyReaderData, MAX_HISTORY_RECORDS, topicKey, type ReaderData } from '@/domain/reader/readerData';
import type { Topic, UserDetails } from '@/domain/forum/models';
import type { ReaderCommand } from '@/domain/reader/readerRecordState';

const harness = vi.hoisted(() => ({
  directory: '',
  connections: [] as { close(): void }[],
  legacy: new Map<string, string>(),
  queries: [] as string[],
  pagePlans: [] as string[][],
  fail: new Array<string>(),
  closeFailure: undefined as Error | undefined
}));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { join } = await import('node:path');
  return {
    openDatabaseAsync: vi.fn(async (name: string) => {
      const db = new DatabaseSync(join(harness.directory, name));
      harness.connections.push(db);
      const check = (sql: string) => {
        harness.queries.push(sql);
        if (harness.fail[0] && sql.includes(harness.fail[0])) {
          harness.fail.shift();
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
          return db.prepare(sql).run(...sqliteParameters(args));
        },
        getAllAsync: async (sql: string, ...args: unknown[]) => {
          check(sql);
          if (sql.startsWith('SELECT value, time, ordinal')) {
            harness.pagePlans.push(
              db
                .prepare(`EXPLAIN QUERY PLAN ${sql}`)
                .all(...sqliteParameters(args))
                .map((row) => String(row.detail))
            );
          }
          return db.prepare(sql).all(...sqliteParameters(args));
        },
        getFirstAsync: async (sql: string, ...args: unknown[]) => {
          check(sql);
          return db.prepare(sql).get(...sqliteParameters(args)) ?? null;
        },
        closeAsync: async () => {
          if (harness.closeFailure) {
            const error = harness.closeFailure;
            harness.closeFailure = undefined;
            throw error;
          }
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
const changeStoredValue = (sql: string, value: string) => {
  const db = new DatabaseSync(join(harness.directory, 'reader-data.db'));
  try {
    db.prepare(sql).run(value);
  } finally {
    db.close();
  }
};

it('keeps source edits scoped to their named sites after a previous settings transaction rolls back', async () => {
  const store = await reopen();
  await store.loadReaderState();
  harness.fail.push('UPDATE reader_meta');
  const results = await Promise.allSettled([
    store.commitReaderCommand({
      type: 'settings',
      patch: { kind: 'set-source-enabled', source: 'v2ex', enabled: false }
    }),
    store.commitReaderCommand({
      type: 'settings',
      patch: { kind: 'set-source-enabled', source: 'linuxdo', enabled: false }
    }),
    store.commitReaderCommand({ type: 'settings', patch: { kind: 'move-source', source: 'linuxdo', offset: -1 } }),
    store.commitReaderCommand({
      type: 'settings',
      patch: {
        kind: 'drop-source',
        source: 'v2ex',
        target: 'yaohuo',
        fromOrder: ['linuxdo', 'v2ex', 'nodeseek', 'yaohuo']
      }
    }),
    store.commitReaderCommand({
      type: 'settings',
      patch: {
        kind: 'drop-source',
        source: 'v2ex',
        target: 'nodeseek',
        fromOrder: ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']
      }
    })
  ]);

  expect(results.map(({ status }) => status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
  expect((await (await reopen()).loadReaderSettings()).contentSources).toEqual([
    { source: 'linuxdo', enabled: false },
    { source: 'nodeseek', enabled: true },
    { source: 'yaohuo', enabled: true },
    { source: 'v2ex', enabled: true }
  ]);
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  harness.fail = [];
  harness.closeFailure = undefined;
  harness.queries = [];
  harness.pagePlans = [];
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
  it.each(['regular', 'recovery'] as const)('normalizes each imported avatar once during %s import', async (mode) => {
    const store = await reopen();
    if (mode === 'regular') await store.loadReaderState();
    const data = createEmptyReaderData();
    for (let i = 1; i <= 64; i++) {
      const item = { ...topic, id: String(i), authorAvatar: 'https://cdn.example.com/avatar.png?private=discard' };
      data.history[topicKey(item)] = { topic: item, savedAt: at };
    }
    const normalized = vi.spyOn(URL.prototype, 'username', 'set');
    try {
      const state = await store.importReaderDataBackup(JSON.stringify(data), mode === 'recovery');
      expect(state.counts.history).toBe(64);
      const row = inspect<{ value: string }>(
        "SELECT value FROM reader_records WHERE kind='history' AND key='nodeseek:1'"
      );
      expect(JSON.parse(row.value).topic.authorAvatar).toBe('https://cdn.example.com/avatar.png');
      expect(normalized).toHaveBeenCalledTimes(64);
    } finally {
      normalized.mockRestore();
    }
  });

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

  it.each(['rejected', 'timed-out'])(
    'preserves legacy data after a %s settings read and restores the settings on retry',
    async (failure) => {
      if (failure === 'timed-out') vi.useFakeTimers();
      const data = createEmptyReaderData();
      data.settings.fontScale = 1.2;
      data.history[topicKey(topic)] = { topic, savedAt: at };
      seed(data);
      const settings: ReaderData['settings'] = { ...data.settings, fontScale: 1.3, theme: 'dark' };
      settings.contentSources = settings.contentSources.map((item) => ({
        ...item,
        enabled: item.source !== 'linuxdo'
      }));
      harness.legacy.set('reader-settings', JSON.stringify(settings));
      const storage = (await import('@react-native-async-storage/async-storage')).default;
      let resolveSettings: ((value: string) => void) | undefined;
      vi.mocked(storage.getItem).mockImplementationOnce(async () => JSON.stringify(data));
      if (failure === 'rejected') vi.mocked(storage.getItem).mockRejectedValueOnce(new Error('settings read failed'));
      else
        vi.mocked(storage.getItem).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSettings = resolve;
            })
        );
      const store = await reopen();
      const loading = store.loadReaderState().then(
        () => undefined,
        (error: unknown) => error
      );
      if (failure === 'timed-out') await vi.advanceTimersByTimeAsync(3_000);
      const error = await loading;
      resolveSettings?.(JSON.stringify({ ...settings, fontScale: 1.1 }));
      expect(error).toMatchObject({ message: failure === 'rejected' ? 'settings read failed' : '旧资料存储读取超时' });
      expect(harness.legacy.size).toBe(2);
      expect(inspect('SELECT count(*) AS count FROM reader_meta')).toEqual({ count: 0 });
      expect(await store.loadReaderState()).toMatchObject({ counts: { history: 1 }, settings });
      expect(harness.legacy.size).toBe(0);
      expect((await (await reopen()).loadReaderState()).settings).toEqual(settings);
    }
  );

  it.each([null, '{broken', '[]'])(
    'keeps the established source defaults for missing or malformed legacy settings: %j',
    async (settings) => {
      const data = createEmptyReaderData();
      data.settings.fontScale = 1.2;
      data.settings.contentSources[0].enabled = false;
      seed(data);
      if (settings === null) harness.legacy.delete('reader-settings');
      else harness.legacy.set('reader-settings', settings);
      expect((await (await reopen()).loadReaderState()).settings).toEqual({
        ...data.settings,
        contentSources: createEmptyReaderData().settings.contentSources
      });
      expect(harness.legacy.size).toBe(0);
    }
  );

  it('releases startup and queued reads when the legacy payload read stalls', async () => {
    vi.useFakeTimers();
    const data = createEmptyReaderData();
    data.history[topicKey(topic)] = { topic, savedAt: at };
    seed(data);
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    const pending = Promise.withResolvers<string>();
    vi.mocked(storage.getItem).mockImplementationOnce(() => pending.promise);
    const store = await reopen();
    const loadingFailed = vi.fn();
    const settingsLoaded = vi.fn();
    const loading = store.loadReaderState().catch(loadingFailed);
    const queued = store.loadReaderSettings().then(settingsLoaded);
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(loadingFailed).toHaveBeenCalledWith(expect.objectContaining({ message: '旧资料存储读取超时' }));
      expect(settingsLoaded).toHaveBeenCalledWith(data.settings);
    } finally {
      pending.resolve(JSON.stringify(data));
      await Promise.all([loading, queued]);
    }
    expect(harness.legacy.size).toBe(2);
    expect((await store.loadReaderState()).counts.history).toBe(1);
  });

  it('merges readable legacy records and settings when importing after a temporary migration fault', async () => {
    const local = createEmptyReaderData();
    local.history[topicKey(topic)] = { topic, savedAt: at };
    local.settings.fontScale = 1.3;
    seed(local);
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(storage.getItem)
      .mockResolvedValueOnce(JSON.stringify(local))
      .mockRejectedValueOnce(new Error('settings unavailable'));
    const store = await reopen();
    await expect(store.loadReaderState()).rejects.toThrow('settings unavailable');
    const imported = { ...topic, id: '2' };
    const backup = JSON.stringify({
      version: 2,
      favorites: { [topicKey(imported)]: { topic: imported, savedAt: at } }
    });
    vi.mocked(storage.getItem).mockRejectedValueOnce(new Error('payload temporarily unavailable'));
    await expect(store.importReaderDataBackup(backup, true)).rejects.toThrow('payload temporarily unavailable');
    expect(harness.legacy.size).toBe(2);
    await expect(store.importReaderDataBackup(backup, true)).resolves.toMatchObject({
      history: { [topicKey(topic)]: true },
      favorites: { [topicKey(imported)]: true },
      settings: { fontScale: 1.3 }
    });
    expect(harness.legacy.size).toBe(0);
    expect((await (await reopen()).loadReaderState()).counts).toEqual({ favorites: 1, history: 1, followedUsers: 0 });
  });

  it('preserves legacy keys when the main data read fails and retries without a committed marker', async () => {
    const data = createEmptyReaderData();
    data.settings.fontScale = 1.2;
    seed(data);
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(storage.getItem).mockRejectedValueOnce(new Error('main read failed'));
    const store = await reopen();
    await expect(store.loadReaderState()).rejects.toThrow('main read failed');
    expect(harness.legacy.size).toBe(2);
    expect(inspect('SELECT count(*) AS count FROM reader_meta')).toEqual({ count: 0 });
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
          user: {
            source: topic.source,
            id: topic.id,
            username: 'alice',
            url: 'https://www.nodeseek.com/space/1',
            topics: []
          },
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
    harness.fail = ['INSERT INTO reader_deleted'];
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
    harness.fail = ['INSERT INTO reader_records'];
    const store = await reopen();
    await expect(store.loadReaderState()).rejects.toThrow('injected');
    expect(harness.legacy.size).toBe(2);
    expect(inspect('SELECT count(*) AS count FROM reader_meta')).toEqual({ count: 0 });
    await expect(store.loadReaderState()).resolves.toMatchObject({ counts: { history: 1 } });
  });

  it.each(['null', '[]', '"not settings"'])(
    'rejects committed settings encoded as %s during startup',
    async (value) => {
      await (await reopen()).loadReaderState();
      changeStoredValue('UPDATE reader_meta SET settings=? WHERE id=1', value);

      const restarted = await reopen();
      await expect(restarted.loadReaderSettings()).rejects.toThrow('本机资料设置格式无效');
      await expect(restarted.loadReaderState()).rejects.toThrow('本机资料设置格式无效');
      expect(inspect('SELECT settings FROM reader_meta')).toEqual({ settings: value });
    }
  );

  it('restores omitted fields from the reader defaults for an older SQLite settings object', async () => {
    await (await reopen()).loadReaderState();
    changeStoredValue('UPDATE reader_meta SET settings=? WHERE id=1', '{"fontScale":1.3}');

    const expected = { ...createEmptyReaderData().settings, fontFamily: 'system', fontScale: 1.3, uiFontScale: 1.3 };
    const restarted = await reopen();
    await expect(restarted.loadReaderSettings()).resolves.toEqual(expected);
    await expect(restarted.loadReaderState()).resolves.toMatchObject({ settings: expected });
  });

  it('commits migrated typography from an old reader-data snapshot without reader-settings', async () => {
    harness.legacy.set(
      'reader-data',
      JSON.stringify({ ...createEmptyReaderData(), settings: { fontScale: 1.3, fontFamily: 'serif' } })
    );
    const store = await reopen();
    await expect(store.loadReaderState()).resolves.toMatchObject({
      settings: { fontScale: 1.3, fontFamily: 'system', uiFontFamily: 'app', uiFontScale: 1.3 }
    });
    expect(harness.legacy.has('reader-data')).toBe(false);
    await expect((await reopen()).loadReaderSettings()).resolves.toMatchObject({
      fontScale: 1.3,
      fontFamily: 'system',
      uiFontScale: 1.3
    });
  });

  it('inherits a complete old backup on a fresh SQLite database and preserves an explicit UI size on reimport', async () => {
    const oldBackup = JSON.stringify({
      ...createEmptyReaderData(),
      settings: {
        listDensity: 'standard',
        theme: 'light',
        fontScale: 1.3,
        lineHeight: 'standard',
        contentWidth: 'standard',
        fontFamily: 'sans'
      }
    });
    const store = await reopen();
    await expect(store.importReaderDataBackup(oldBackup)).resolves.toMatchObject({
      settings: { fontScale: 1.3, uiFontScale: 1.3, fontFamily: 'system' }
    });
    await store.commitReaderCommand({ type: 'settings', patch: { uiFontScale: 1 } });
    await expect(store.importReaderDataBackup(oldBackup)).resolves.toMatchObject({
      settings: { fontScale: 1.3, uiFontScale: 1, fontFamily: 'system' }
    });
  });

  it.each(['invalid JSON', '{"topic":{},"savedAt":"2026-09-10T00:00:00.000Z"}'])(
    'keeps the legacy copy while pending migration verification finds an invalid committed history payload %s',
    async (value) => {
      const original = createEmptyReaderData();
      original.history[topicKey(topic)] = { topic, savedAt: at };
      seed(original);
      harness.fail = ['BEGIN DEFERRED'];
      await expect((await reopen()).loadReaderState()).rejects.toThrow('injected');
      expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'cleanup_pending' });
      changeStoredValue("UPDATE reader_records SET value=? WHERE kind='history'", value);

      const restarted = await reopen();
      await expect(restarted.loadReaderState()).rejects.toThrow();
      expect(harness.legacy.get('reader-data')).toBe(JSON.stringify(original));
      expect(harness.legacy.get('reader-settings')).toBe(JSON.stringify(original.settings));
      expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'cleanup_pending' });
    }
  );

  it.each(['cold records', 'cold settings', 'ordinary records'] as const)(
    'keeps committed data and any legacy copy when %s finds invalid stored history',
    async (mode) => {
      const original = createEmptyReaderData();
      original.history[topicKey(topic)] = { topic, savedAt: at };
      seed(original);
      const cold = mode !== 'ordinary records';
      if (cold) {
        harness.fail = ['BEGIN DEFERRED'];
        await expect((await reopen()).loadReaderState()).rejects.toThrow('injected');
      } else {
        await (await reopen()).loadReaderState();
      }
      const invalid = '{"topic":{},"savedAt":"2026-09-10T00:00:00.000Z"}';
      changeStoredValue("UPDATE reader_records SET value=? WHERE kind='history'", invalid);

      const restarted = await reopen();
      if (cold) await expect(restarted.loadReaderState()).rejects.toThrow('完整迁移');
      const incoming = createEmptyReaderData();
      incoming.settings.fontScale = 1.3;
      const backup = mode === 'cold settings' ? { version: 2, settings: { fontScale: 1.3 } } : incoming;

      await expect(restarted.importReaderDataBackup(JSON.stringify(backup), cold)).rejects.toThrow('完整迁移');
      expect(
        inspect("SELECT status, settings, value FROM reader_meta JOIN reader_records WHERE kind='history'")
      ).toEqual({
        status: cold ? 'cleanup_pending' : 'ready',
        settings: JSON.stringify(original.settings),
        value: invalid
      });
      expect(harness.legacy.get('reader-data')).toBe(cold ? JSON.stringify(original) : undefined);
      expect(harness.legacy.get('reader-settings')).toBe(cold ? JSON.stringify(original.settings) : undefined);
    }
  );

  it('rejects a full export if stored records cannot be represented faithfully', async () => {
    const original = createEmptyReaderData();
    original.history[topicKey(topic)] = { topic, savedAt: at };
    seed(original);
    await (await reopen()).loadReaderState();
    const invalid = '{"topic":{},"savedAt":"2026-09-10T00:00:00.000Z"}';
    changeStoredValue("UPDATE reader_records SET value=? WHERE kind='history'", invalid);
    const ready = await reopen();
    await expect(ready.loadReaderState()).resolves.toMatchObject({ counts: { history: 1 } });

    await expect(ready.exportReaderDataBackup()).rejects.toThrow('完整迁移');
    expect(inspect("SELECT value FROM reader_records WHERE kind='history'")).toEqual({ value: invalid });
  });

  it.each(['history', 'favorites', 'followedUsers'] as const)(
    'rejects an invalid stored %s record as a Library read error',
    async (collection) => {
      const original = createEmptyReaderData();
      const key = topicKey(topic);
      original.history[key] = { topic, savedAt: at };
      original.favorites[key] = { topic, savedAt: at };
      original.followedUsers[key] = {
        user: {
          source: 'nodeseek',
          id: topic.id,
          username: 'alice',
          url: 'https://www.nodeseek.com/space/1',
          topics: []
        },
        followedAt: at
      };
      seed(original);
      await (await reopen()).loadReaderState();
      changeStoredValue(`UPDATE reader_records SET value=? WHERE kind='${collection}'`, 'null');
      const ready = await reopen();
      await expect(ready.loadReaderState()).resolves.toMatchObject({ counts: { [collection]: 1 } });

      await expect(
        ready.queryReaderPage({ collection, sources: ['nodeseek'], source: 'all', category: 'all' })
      ).rejects.toThrow('完整迁移');
      expect(inspect(`SELECT value FROM reader_records WHERE kind='${collection}'`)).toEqual({ value: 'null' });
    }
  );

  it('isolates malformed rows from another source and the healthy preceding page', async () => {
    const original = createEmptyReaderData();
    for (let id = 1; id <= 51; id++) {
      const item = { ...topic, id: String(id) };
      original.history[topicKey(item)] = { topic: item, savedAt: at };
    }
    const other = { ...topic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1' };
    original.history[topicKey(other)] = { topic: other, savedAt: at };
    seed(original);
    const ready = await reopen();
    await ready.loadReaderState();
    const change = "UPDATE reader_records SET value=? WHERE kind='history' AND key='nodeseek:51'";
    changeStoredValue(change, '{}');
    const request = { collection: 'history', sources: ['nodeseek'], source: 'all', category: 'all' } as const;

    const first = await ready.queryReaderPage(request);
    expect(first.records).toHaveLength(50);
    expect(first.next).toBeDefined();
    await expect(ready.queryReaderPage({ ...request, sources: ['v2ex'] })).resolves.toEqual({
      records: [original.history[topicKey(other)]]
    });
    const next = { ...request, after: first.next };
    await expect(ready.queryReaderPage(next)).rejects.toThrow('完整迁移');
    expect(inspect("SELECT value FROM reader_records WHERE key='nodeseek:51'")).toEqual({ value: '{}' });

    changeStoredValue(change, JSON.stringify(original.history['nodeseek:51']));
    await expect(ready.queryReaderPage(next)).resolves.toEqual({ records: [original.history['nodeseek:51']] });
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

  it('rechecks live settings on one cold connection per background round and closes it on failure', async () => {
    const data = createEmptyReaderData();
    seed(data);
    const store = await reopen();
    await expect(
      store.withReaderSettings(async (read) => {
        expect((await read()).fontScale).toBe(data.settings.fontScale);
        data.settings.fontScale = 1.2;
        seed(data);
        expect((await read()).fontScale).toBe(1.2);
        throw new Error('background round failed');
      })
    ).rejects.toThrow('background round failed');
    expect(harness.queries.filter((sql) => sql === 'PRAGMA user_version')).toHaveLength(1);
    expect(harness.connections).toHaveLength(0);
    expect(harness.legacy.size).toBe(2);
  });

  it('keeps cold settings reads temporary and shares the initialized owner with queued readers', async () => {
    const data = createEmptyReaderData();
    data.settings.fontScale = 1.2;
    data.history[topicKey(topic)] = { topic, savedAt: at };
    seed(data);
    const store = await reopen();

    expect(await store.loadReaderSettings()).toEqual(data.settings);
    expect(harness.connections).toHaveLength(0);
    expect(harness.legacy.size).toBe(2);
    expect(inspect('SELECT count(*) AS count FROM reader_meta')).toEqual({ count: 0 });

    const [state, settings, page] = await Promise.all([
      store.loadReaderState(),
      store.loadReaderSettings(),
      store.queryReaderPage({ collection: 'history', sources: ['nodeseek'], source: 'all', category: 'all' })
    ]);
    expect(state.counts.history).toBe(1);
    expect(settings).toEqual(data.settings);
    expect(page.records).toMatchObject([{ topic }]);
    expect(harness.connections).toHaveLength(1);
    expect(harness.legacy.size).toBe(0);
  });

  it('allows foreground settings writes during a background round and preserves the foreground connection', async () => {
    const store = await reopen();
    await store.withReaderSettings(async (read) => {
      await read();
      await store.commitReaderCommand({ type: 'settings', patch: { fontScale: 1.2 } });
      expect((await read()).fontScale).toBe(1.2);
    });
    expect(harness.connections).toHaveLength(1);
    const checks = () => harness.queries.filter((sql) => sql === 'PRAGMA user_version').length;
    const before = checks();
    await store.withReaderSettings(async (read) => expect((await read()).fontScale).toBe(1.2));
    expect(checks()).toBe(before);
    expect(harness.connections).toHaveLength(1);
  });

  it.each(['settings', 'history'] as const)(
    'rejects queued and subsequent %s reads after an uncertain write and reopens committed data',
    async (kind) => {
      const data = createEmptyReaderData();
      data.settings.contentSources = data.settings.contentSources.map((item) => ({
        ...item,
        enabled: item.source !== 'nodeseek'
      }));
      data.history[topicKey(topic)] = { topic: { ...topic, replyWatermark: 7 }, savedAt: at };
      seed(data);
      const store = await reopen();
      await store.loadReaderState();
      const read = (owner: typeof store) =>
        kind === 'settings'
          ? owner.loadReaderSettings().then((settings) => settings.contentSources)
          : owner.readHistoryReplyBaseline(topicKey(topic));
      const committed = await read(store);
      harness.fail = ['COMMIT', 'ROLLBACK'];
      const failedWrite = store.commitReaderCommand(
        kind === 'settings'
          ? { type: 'settings', patch: { contentSources: [{ source: 'nodeseek', enabled: true }] } }
          : { type: 'visit', topic: { ...topic, replyCount: 20, replyWatermark: 30 }, at }
      );
      const [write, queuedRead] = await Promise.allSettled([failedWrite, read(store)]);
      expect(write).toMatchObject({ status: 'rejected', reason: { message: '本机资料事务无法确认，已停止修改。' } });
      expect(queuedRead).toMatchObject({
        status: 'rejected',
        reason: { message: '本机资料事务状态不明，请重新启动后恢复。' }
      });
      expect(harness.queries.slice(harness.queries.lastIndexOf('ROLLBACK') + 1)).toEqual([]);
      const queries = [...harness.queries];
      await expect(read(store)).rejects.toThrow('事务状态不明');
      await expect(store.loadReaderState()).rejects.toThrow('事务状态不明');
      expect(harness.queries).toEqual(queries);
      for (const connection of harness.connections) connection.close();
      harness.connections = [];
      const next = await reopen();
      expect(await read(next)).toEqual(committed);
      expect(JSON.parse(await next.exportReaderDataBackup())).toEqual(data);
    }
  );

  it.each(['backup export', 'library page'] as const)(
    'publishes a store freeze from a %s and keeps committed data for the next process',
    async (entry) => {
      const data = createEmptyReaderData();
      data.settings.fontScale = 1.25;
      data.history[topicKey(topic)] = { topic: { ...topic, replyWatermark: 5 }, savedAt: at };
      seed(data);
      const store = await reopen();
      await store.loadReaderState();
      const read = () =>
        entry === 'backup export'
          ? store.exportReaderDataBackup()
          : store.queryReaderPage({ collection: 'history', source: 'all', sources: ['nodeseek'], category: 'all' });
      const listener = vi.fn();
      const unsubscribed = vi.fn();
      const unsubscribe = store.subscribeReaderStorageFreeze(listener);
      store.subscribeReaderStorageFreeze(unsubscribed)();

      harness.fail = ['COMMIT'];
      await expect(read()).rejects.toThrow('injected storage failure');
      expect(listener).not.toHaveBeenCalled();
      await expect(read()).resolves.toBeDefined();

      harness.fail = ['COMMIT', 'ROLLBACK'];
      await expect(read()).rejects.toBeInstanceOf(AggregateError);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(unsubscribed).not.toHaveBeenCalled();
      const late = vi.fn();
      store.subscribeReaderStorageFreeze(late)();
      expect(late).toHaveBeenCalledTimes(1);
      unsubscribe();

      const queries = [...harness.queries];
      await expect(store.importReaderDataBackup(JSON.stringify(data), true)).rejects.toThrow('事务状态不明');
      await expect(store.commitReaderCommand({ type: 'settings', patch: { fontScale: 1.5 } })).rejects.toThrow(
        '事务状态不明'
      );
      expect(harness.queries).toEqual(queries);

      for (const connection of harness.connections) connection.close();
      harness.connections = [];
      const next = await reopen();
      const nextListener = vi.fn();
      next.subscribeReaderStorageFreeze(nextListener)();
      expect(nextListener).not.toHaveBeenCalled();
      expect(JSON.parse(await next.exportReaderDataBackup())).toEqual(data);
    }
  );

  it.each(['migration', 'cleanup'] as const)(
    'stops direct reads and recovery SQL when %s freezes the first database lifecycle',
    async (phase) => {
      const data = createEmptyReaderData();
      data.history[topicKey(topic)] = { topic, savedAt: at };
      seed(data);
      if (phase === 'migration') harness.fail = ['COMMIT', 'ROLLBACK'];
      else {
        const storage = (await import('@react-native-async-storage/async-storage')).default;
        vi.mocked(storage.removeMany).mockImplementationOnce(async (keys) => {
          for (const key of keys) harness.legacy.delete(key);
          harness.fail = ['COMMIT', 'ROLLBACK'];
        });
      }
      const store = await reopen();
      await expect(store.readHistoryReplyBaseline(topicKey(topic))).rejects.toThrow('事务');
      expect(harness.queries.slice(harness.queries.lastIndexOf('ROLLBACK') + 1)).toEqual([]);
      const queries = [...harness.queries];
      await expect(store.loadReaderSettings()).rejects.toThrow('事务状态不明');
      await expect(store.readHistoryReplyBaseline(topicKey(topic))).rejects.toThrow('事务状态不明');
      await expect(store.importReaderDataBackup(JSON.stringify(data), true)).rejects.toThrow('事务状态不明');
      expect(harness.queries).toEqual(queries);
      for (const connection of harness.connections) connection.close();
      harness.connections = [];
      const next = await reopen();
      expect(await next.loadReaderSettings()).toEqual(data.settings);
      expect(await next.readHistoryReplyBaseline(topicKey(topic))).toEqual({ replyCount: topic.replyCount });
      expect(JSON.parse(await next.exportReaderDataBackup())).toEqual(data);
    }
  );

  it('normal bootstrap queries keys and counts without selecting complete record payloads', async () => {
    const store = await reopen();
    await store.loadReaderState();
    harness.queries = [];
    await (await reopen()).loadReaderState();
    expect(harness.queries.filter((sql) => /SELECT .*value.*FROM reader_records/i.test(sql))).toEqual([]);
  });

  it('reads the unfiltered first page in a single query without counting records', async () => {
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
    expect(page.records).toMatchObject([{ topic: { id: topic.id } }]);
    expect(harness.queries.filter((sql) => /^SELECT/i.test(sql))).toHaveLength(1);
  });

  it('seeks both cursor ranges in the existing index and preserves deleted-boundary paging', async () => {
    const data = createEmptyReaderData();
    for (let index = 0; index < 151; index++) {
      const item = { ...topic, id: String(index) };
      data.history[topicKey(item)] = { topic: item, savedAt: at };
    }
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    const request = {
      collection: 'history',
      sources: ['nodeseek', 'linuxdo', 'yaohuo', 'v2ex'],
      source: 'all',
      category: 'all'
    } satisfies import('@/domain/reader/readerRecordState').ReaderPageRequest;
    const first = await store.queryReaderPage(request);
    expect(first.records.map((record) => 'topic' in record && record.topic.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => String(index))
    );
    expect(first.next).toBeDefined();
    await store.commitReaderCommand({
      type: 'delete',
      collection: 'history',
      keys: ['nodeseek:49', 'nodeseek:51'],
      at
    });
    harness.pagePlans = [];
    harness.queries = [];
    const next = await store.queryReaderPage({ ...request, after: first.next });
    expect(next.records.map((record) => 'topic' in record && record.topic.id)).toEqual(
      Array.from({ length: 51 }, (_, index) => String(index + 50)).filter((id) => id !== '51')
    );
    const plan = harness.pagePlans.flat();
    expect(plan.some((detail) => detail.includes('reader_order') && detail.includes('time=? AND ordinal>?'))).toBe(
      true
    );
    expect(plan.some((detail) => detail.includes('reader_order') && detail.includes('time<?'))).toBe(true);
    expect(harness.queries).toHaveLength(3); // BEGIN, page, COMMIT.
  });

  it('updates history and existing favorite summary atomically while preserving favorite time', async () => {
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({ type: 'favorite', topic, enabled: true, at });
    await store.commitReaderCommand({ type: 'visit', topic: { ...topic, replyCount: 10 }, at: '2026-09-11T00:00:00Z' });
    let snapshot = JSON.parse(await store.exportReaderDataBackup());
    expect(snapshot.favorites['nodeseek:1'].savedAt).toBe(at);
    expect(snapshot.favorites['nodeseek:1'].topic.replyCount).toBe(10);
    harness.fail = ['COMMIT'];
    await expect(
      store.commitReaderCommand({ type: 'visit', topic: { ...topic, replyCount: 20 }, at: '2026-09-12T00:00:00Z' })
    ).rejects.toThrow();
    snapshot = JSON.parse(await store.exportReaderDataBackup());
    expect(snapshot.history['nodeseek:1'].visitCount).toBe(1);
    expect(snapshot.favorites['nodeseek:1'].topic.replyCount).toBe(10);
  });

  it('reads each prior record once per mutation, including records confirmed missing', async () => {
    const store = await reopen();
    await store.loadReaderState();
    const user: UserDetails = {
      source: 'nodeseek',
      id: '1',
      username: 'alice',
      url: 'https://www.nodeseek.com/space/1'
    };
    const commands: { command: ReaderCommand; reads: number }[] = [
      { command: { type: 'favorite', topic, enabled: true, at }, reads: 2 },
      { command: { type: 'follow', user, enabled: true, at }, reads: 2 },
      { command: { type: 'visit', topic, at }, reads: 3 },
      { command: { type: 'topic-summary', topic: { ...topic, replyCount: 10 } }, reads: 2 },
      { command: { type: 'favorite', topic, enabled: false, at }, reads: 2 },
      { command: { type: 'follow', user, enabled: false, at }, reads: 2 },
      { command: { type: 'favorite', topic, enabled: false, at }, reads: 1 },
      { command: { type: 'follow', user, enabled: false, at }, reads: 1 },
      { command: { type: 'favorite', topic, enabled: true, at }, reads: 2 },
      { command: { type: 'follow', user, enabled: true, at }, reads: 2 },
      { command: { type: 'visit', topic, at }, reads: 3 }
    ];
    for (const { command, reads } of commands) {
      harness.queries = [];
      await store.commitReaderCommand(command);
      expect(harness.queries.filter((sql) => sql.startsWith('SELECT * FROM reader_'))).toHaveLength(reads);
      const snapshot = await store.exportReaderDataBackup();
      expect(inspect<{ bytes: number }>('SELECT bytes FROM reader_meta').bytes).toBe(Buffer.byteLength(snapshot));
    }
    const saved: ReaderData = JSON.parse(await (await reopen()).exportReaderDataBackup());
    expect(saved.history[topicKey(topic)]).toMatchObject({ topic, savedAt: at, visitCount: 2 });
    expect(saved.favorites[topicKey(topic)]).toMatchObject({ topic, savedAt: at });
    expect(saved.followedUsers['nodeseek:1'].user.id).toBe('1');
    expect(saved.deletedRecords).toEqual(createEmptyReaderData().deletedRecords);
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
    harness.fail = ['INSERT INTO reader_records'];
    const imported = store.importReaderDataBackup(JSON.stringify(incoming));
    const later = store.commitReaderCommand({ type: 'visit', topic: { ...topic, id: '3' }, at });
    await expect(imported).rejects.toThrow('injected storage failure');
    await later;
    const final = JSON.parse(await store.exportReaderDataBackup());
    expect(Object.keys(final.favorites)).toEqual(['nodeseek:1']);
    expect(Object.keys(final.history)).toEqual(['nodeseek:3']);
  });

  it.each(['complete', 'pending'] as const)(
    'retains a verified cold backup after %s legacy cleanup and accepts later writes',
    async (cleanup) => {
      const incoming = createEmptyReaderData();
      incoming.settings.fontScale = 1.3;
      incoming.history[topicKey(topic)] = { topic, savedAt: at };
      harness.legacy.set('reader-data', '{unreadable');
      const storage = (await import('@react-native-async-storage/async-storage')).default;
      if (cleanup === 'pending') vi.mocked(storage.removeMany).mockRejectedValueOnce(new Error('cleanup failed'));
      const store = await reopen();

      await expect(store.importReaderDataBackup(JSON.stringify(incoming), true)).resolves.toMatchObject({
        settings: { fontScale: 1.3 },
        counts: { history: 1 }
      });
      expect(harness.connections).toHaveLength(1);
      expect(inspect('SELECT status FROM reader_meta')).toEqual({
        status: cleanup === 'pending' ? 'cleanup_pending' : 'ready'
      });
      await store.commitReaderCommand({ type: 'visit', topic: { ...topic, id: '2' }, at });
      expect((await store.loadReaderState()).counts.history).toBe(2);
      expect(await store.loadReaderSettings()).toEqual(incoming.settings);
      const exported = await store.exportReaderDataBackup();
      expect(harness.connections).toHaveLength(1);
      expect(await (await reopen()).exportReaderDataBackup()).toBe(exported);
      expect(harness.legacy.size).toBe(0);
    }
  );

  it('rejects cold backup recovery when cleanup cannot confirm its transaction and reopens committed data', async () => {
    const incoming = createEmptyReaderData();
    incoming.settings.fontScale = 1.3;
    incoming.history[topicKey(topic)] = { topic, savedAt: at };
    harness.legacy.set('reader-data', '{unreadable');
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(storage.removeMany).mockImplementationOnce(async (keys) => {
      for (const key of keys) harness.legacy.delete(key);
      harness.fail = ['COMMIT', 'ROLLBACK'];
    });
    const store = await reopen();

    await expect(store.importReaderDataBackup(JSON.stringify(incoming), true)).rejects.toThrow('事务状态不明');
    expect(harness.connections).toHaveLength(0);
    expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'cleanup_pending' });
    expect(harness.queries.slice(harness.queries.lastIndexOf('ROLLBACK') + 1)).toEqual([]);
    const queries = [...harness.queries];
    await expect(store.loadReaderSettings()).rejects.toThrow('事务状态不明');
    await expect(store.readHistoryReplyBaseline(topicKey(topic))).rejects.toThrow('事务状态不明');
    await expect(store.importReaderDataBackup(JSON.stringify(incoming), true)).rejects.toThrow('事务状态不明');
    expect(harness.queries).toEqual(queries);

    const next = await reopen();
    expect((await next.loadReaderState()).settings.fontScale).toBe(1.3);
    expect(JSON.parse(await next.exportReaderDataBackup())).toEqual(incoming);
    expect(inspect('SELECT status FROM reader_meta')).toEqual({ status: 'ready' });
  });

  it('preserves cold recovery write and connection-close failures together', async () => {
    const incoming = createEmptyReaderData();
    incoming.history[topicKey(topic)] = { topic, savedAt: at };
    const closeFailure = new Error('injected close failure');
    harness.fail = ['INSERT INTO reader_records'];
    harness.closeFailure = closeFailure;
    const store = await reopen();

    const failure: unknown = await store.importReaderDataBackup(JSON.stringify(incoming), true).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error('Missing storage failure details');
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toMatchObject({ message: 'injected storage failure' });
    expect(failure.errors[1]).toBe(closeFailure);
    expect(inspect('SELECT count(*) AS count FROM reader_meta')).toEqual({ count: 0 });
  });

  it.each(['favorites', 'history'] as const)(
    'reads the complete local %s taxonomy beyond the first page',
    async (collection) => {
      const data = createEmptyReaderData();
      for (let i = 0; i < 51; i++)
        data[collection][`nodeseek:${i}`] = {
          topic: { ...topic, id: String(i), categoryId: 'dev', category: 'Dev' },
          savedAt: at
        };
      data[collection]['nodeseek:51'] = {
        topic: { ...topic, id: '51', categoryId: 'trade', category: '交易' },
        savedAt: at
      };
      seed(data);
      const store = await reopen();
      await store.loadReaderState();
      const request = { collection, sources: ['nodeseek'] as const, source: 'all' as const, category: 'all' };
      const first = await store.queryReaderPage(request);
      expect(first.records).toHaveLength(50);
      expect(first.records.every((record) => 'topic' in record && record.topic.categoryId === 'dev')).toBe(true);

      await expect(store.queryReaderCategories(request)).resolves.toEqual([
        { source: 'nodeseek', id: 'dev', name: 'Dev' },
        { source: 'nodeseek', id: 'trade', name: '交易' }
      ]);
      const second = await store.queryReaderPage({ ...request, after: first.next });
      expect(second.records.some((record) => 'topic' in record && record.topic.categoryId === 'trade')).toBe(true);
    }
  );

  it('keeps identical category ids from different enabled sources and excludes disabled sources', async () => {
    const data = createEmptyReaderData();
    for (const source of ['nodeseek', 'linuxdo', 'yaohuo'] as const)
      data.history[`${source}:1`] = {
        topic: { ...topic, source, categoryId: 'dev', category: 'Dev' },
        savedAt: at
      };
    data.history['nodeseek:2'] = {
      topic: { ...topic, id: '2', categoryId: 'dev', category: 'Dev' },
      savedAt: at
    };
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    const request = { collection: 'history' as const, sources: ['nodeseek', 'linuxdo'] as const };

    await expect(store.queryReaderCategories(request)).resolves.toEqual([
      { source: 'linuxdo', id: 'dev', name: 'Dev' },
      { source: 'nodeseek', id: 'dev', name: 'Dev' }
    ]);
    await expect(store.queryReaderCategories({ ...request, sources: ['linuxdo', 'nodeseek'] })).resolves.toEqual([
      { source: 'linuxdo', id: 'dev', name: 'Dev' },
      { source: 'nodeseek', id: 'dev', name: 'Dev' }
    ]);
  });

  it('uses stored category labels or ids without including empty identities or another collection', async () => {
    const data = createEmptyReaderData();
    const topics = [
      { ...topic, id: '1', categoryId: 'dev', category: '' },
      { ...topic, id: '2', categoryId: 'dev', category: 'Dev' },
      { ...topic, id: '3', categoryId: 'id-only', category: '' },
      { ...topic, id: '4', categoryId: undefined, category: '日常' },
      { ...topic, id: '5', categoryId: undefined, category: '' }
    ];
    for (const value of topics) data.history[topicKey(value)] = { topic: value, savedAt: at };
    data.favorites['nodeseek:6'] = {
      topic: { ...topic, id: '6', categoryId: 'favorite-only', category: '收藏类别' },
      savedAt: at
    };
    seed(data);
    const store = await reopen();
    await store.loadReaderState();

    await expect(store.queryReaderCategories({ collection: 'history', sources: ['nodeseek'] })).resolves.toEqual([
      { source: 'nodeseek', id: 'dev', name: 'Dev' },
      { source: 'nodeseek', id: 'id-only', name: 'id-only' },
      { source: 'nodeseek', id: '日常', name: '日常' }
    ]);
  });

  it('does not query category metadata for followed users or when every source is disabled', async () => {
    const store = await reopen();
    await store.loadReaderState();
    await store.commitReaderCommand({ type: 'visit', topic, at });
    harness.queries = [];

    await expect(store.queryReaderCategories({ collection: 'followedUsers', sources: ['nodeseek'] })).resolves.toEqual(
      []
    );
    await expect(store.queryReaderCategories({ collection: 'history', sources: [] })).resolves.toEqual([]);
    expect(harness.queries.some((sql) => /FROM reader_records/.test(sql))).toBe(false);
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
    harness.queries = [];
    const two = await store.queryReaderPage({ ...request, after: one.next });
    const three = await store.queryReaderPage({ ...request, after: two.next });
    expect(harness.queries.filter((sql) => /COUNT\s*\(|FROM reader_counts/i.test(sql))).toEqual([]);
    expect([one.records.length, two.records.length, three.records.length]).toEqual([50, 50, 23]);
    expect(three.next).toBeUndefined();
    const records = [...one.records, ...two.records, ...three.records];
    expect(records.map((record) => ('topic' in record ? record.topic.id : ''))).toEqual(
      Array.from({ length: 123 }, (_, i) => String(i))
    );
  });

  it('restores exported over-cap history to a fresh database and shrinks only after explicit deletions', async () => {
    const data = createEmptyReaderData();
    for (let i = 0; i < 5002; i++)
      data.history[`nodeseek:${i}`] = {
        topic: { ...topic, id: String(i) },
        savedAt: new Date(1_700_000_000_000 + i).toISOString()
      };
    seed(data);
    const store = await reopen();
    expect((await store.loadReaderState()).counts.history).toBe(5002);
    const exported = await store.exportReaderDataBackup();
    const sourceDirectory = harness.directory;
    harness.directory = join(sourceDirectory, 'fresh-install');
    mkdirSync(harness.directory);
    try {
      const fresh = await reopen();
      expect((await fresh.loadReaderState()).counts.history).toBe(0);
      expect((await fresh.importReaderDataBackup(exported)).counts.history).toBe(5002);
      expect(JSON.parse(await fresh.exportReaderDataBackup()).history).toEqual(JSON.parse(exported).history);
      await fresh.commitReaderCommand({ type: 'visit', topic: { ...topic, id: 'new' }, at });
      expect((await fresh.loadReaderState()).counts.history).toBe(5002);
      await fresh.commitReaderCommand({
        type: 'delete',
        collection: 'history',
        keys: ['nodeseek:1', 'nodeseek:2'],
        at
      });
      await fresh.commitReaderCommand({ type: 'visit', topic: { ...topic, id: 'another' }, at });
      expect((await fresh.loadReaderState()).counts.history).toBe(5000);
    } finally {
      harness.directory = sourceDirectory;
    }
  });

  it('imports partial settings without reading or replacing record payloads', async () => {
    const data = createEmptyReaderData();
    data.settings.listDensity = 'compact';
    data.history[topicKey(topic)] = { topic, savedAt: at, visitCount: 3 };
    data.deletedRecords.favorites['nodeseek:7'] = at;
    seed(data);
    const store = await reopen();
    await store.loadReaderState();
    harness.queries = [];
    const result = await store.importReaderDataBackup(
      JSON.stringify({
        version: 2,
        settings: { theme: 'dark', listDensity: 'invalid' }
      })
    );
    expect(result.settings).toMatchObject({ theme: 'dark', listDensity: 'compact' });
    expect(
      harness.queries.filter((sql) =>
        /SELECT kind, key, value|(?:INSERT INTO|DELETE FROM|UPDATE) reader_(?:records|deleted)\b/i.test(sql)
      )
    ).toEqual([]);
    const persisted = JSON.parse(await (await reopen()).exportReaderDataBackup());
    expect(persisted.history[topicKey(topic)].visitCount).toBe(3);
    expect(persisted.deletedRecords.favorites['nodeseek:7']).toBe(at);
    expect(persisted.settings).toEqual(result.settings);
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
