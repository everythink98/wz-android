import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Topic } from '@/domain/forum/models';
import type { ForumNotification } from '@/domain/notifications/models';
import { sourceCatalog, sourceValues } from '@/domain/forum/sourceCatalog';
import {
  createEmptyReaderData,
  MAX_HISTORY_RECORDS,
  sanitizeReaderData,
  topicKey,
  type ReaderData
} from '@/domain/reader/readerData';
import { MAX_BACKUP_JSON_BYTES } from '@/domain/reader/readerBackup';
import type { ReaderPageRequest } from '@/domain/reader/readerRecordState';
import { sortNotifications } from '@/features/notifications/notificationPresentation';
import { advanceNotificationDelivery } from '@/platform/notifications/notificationStore';

// The production store, SQL, transactions and serialization run unchanged; only the Expo bridge is replaced.
const harness = vi.hoisted(() => ({ directory: '', connections: [] as { close(): void }[], calls: 0 }));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { join } = await import('node:path');
  return {
    openDatabaseAsync: async (name: string) => {
      const db = new DatabaseSync(join(harness.directory, name));
      harness.connections.push(db);
      const parameters = (args: unknown[]) => (Array.isArray(args[0]) ? args[0] : args) as (string | number | null)[];
      return {
        execAsync: async (sql: string) => {
          harness.calls++;
          db.exec(sql);
        },
        runAsync: async (sql: string, ...args: unknown[]) => {
          harness.calls++;
          return db.prepare(sql).run(...parameters(args));
        },
        getAllAsync: async (sql: string, ...args: unknown[]) => {
          harness.calls++;
          return db.prepare(sql).all(...parameters(args));
        },
        getFirstAsync: async (sql: string, ...args: unknown[]) => {
          harness.calls++;
          return db.prepare(sql).get(...parameters(args)) ?? null;
        },
        closeAsync: async () => {
          db.close();
          harness.connections = harness.connections.filter((connection) => connection !== db);
        }
      };
    }
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, removeMany: async () => undefined, getAllKeys: async () => [] }
}));

const epoch = Date.UTC(2026, 0, 1);
const date = (index: number) => new Date(epoch + index * 1000).toISOString();
const topic = (index: number, title = `压力样本 ${index} 😀`): Topic => {
  const source = sourceValues[index % sourceValues.length]!;
  return {
    source,
    id: String(index + 1),
    title,
    author: `reader-${index % 100}`,
    category: `分区 ${Math.floor(index / 4) % 3}`,
    categoryId: String(Math.floor(index / 4) % 3),
    url: `${sourceCatalog[source].baseUrl}/t/${index + 1}`,
    createdAt: date(index),
    replyCount: index % 100
  };
};

function dataset(count: number) {
  const data = createEmptyReaderData();
  for (let index = 0; index < count; index++) {
    const item = topic(index);
    const record = { topic: item, savedAt: date(Math.floor(index / 8)), visitCount: 1 };
    data.history[topicKey(item)] = record;
    if (index % 2 === 0) data.favorites[topicKey(item)] = record;
    if (index % 10 === 0) {
      data.followedUsers[topicKey(item)] = {
        user: {
          source: item.source,
          id: item.id,
          username: `reader-${index}`,
          url: `${sourceCatalog[item.source].baseUrl}/u/${index}`,
          topics: []
        },
        followedAt: record.savedAt
      };
    }
  }
  return data;
}

async function measure<T>(name: string, operation: () => T | Promise<T>, samples = 7) {
  await operation();
  const timings: number[] = [];
  const queries: number[] = [];
  let result!: T;
  for (let index = 0; index < samples; index++) {
    const calls = harness.calls;
    const start = performance.now();
    result = await operation();
    timings.push(performance.now() - start);
    queries.push(harness.calls - calls);
  }
  timings.sort((left, right) => left - right);
  queries.sort((left, right) => left - right);
  process.stdout.write(
    'PERF ' +
      JSON.stringify({
        name,
        samples,
        medianMs: Number(timings[Math.floor(samples / 2)]!.toFixed(3)),
        p95Ms: Number(timings[Math.ceil(samples * 0.95) - 1]!.toFixed(3)),
        sqlCalls: queries[Math.floor(samples / 2)]
      }) +
      '\n'
  );
  return result;
}

function closeConnections() {
  for (const connection of harness.connections) connection.close();
  harness.connections = [];
}

beforeEach(() => {
  vi.resetModules();
  harness.calls = 0;
  harness.directory = mkdtempSync(join(tmpdir(), 'wz-data-stress-'));
});
afterEach(() => {
  closeConnections();
  rmSync(harness.directory, { recursive: true, force: true });
});

describe('production data stress (host SQLite timings, not Android frame or bridge timings)', () => {
  it.each([0, 1, 49, 50, 51, 100, 1000, 5000])(
    'preserves cursor boundaries, source/category filters and counts with %i tied records',
    async (count) => {
      const data = sanitizeReaderData(dataset(count));
      for (const records of [data.history, data.favorites]) {
        for (const record of Object.values(records)) record.savedAt = date(0);
      }
      for (const record of Object.values(data.followedUsers)) record.followedAt = date(0);
      const store = await import('@/platform/storage/readerDataStore');
      await store.loadReaderState();
      await store.importReaderDataBackup(JSON.stringify(data));
      const before = await store.exportReaderDataBackup();
      for (const collection of ['history', 'favorites', 'followedUsers'] as const) {
        for (const sources of [sourceValues, ['linuxdo', 'nodeseek'] as const, []]) {
          const all = Object.values(data[collection]).filter((record) =>
            sources.some((source) => source === ('topic' in record ? record.topic.source : record.user.source))
          );
          for (const filter of [
            { source: 'all', category: 'all' },
            { source: 'linuxdo', category: 'all' },
            { source: 'all', category: 'linuxdo:1' },
            { source: 'all', category: '分区 1' }
          ] satisfies Pick<ReaderPageRequest, 'source' | 'category'>[]) {
            const expected = all.filter((record) => {
              const source = 'topic' in record ? record.topic.source : record.user.source;
              if (filter.source !== 'all' && filter.source !== source) return false;
              return (
                collection === 'followedUsers' ||
                filter.category === 'all' ||
                ('topic' in record &&
                  (filter.category === `${source}:${record.topic.categoryId}` ||
                    filter.category === record.topic.category))
              );
            });
            const request: ReaderPageRequest = { collection, sources: [...sources], ...filter };
            const actual: typeof expected = [];
            let pages = 0;
            do {
              const page = await store.queryReaderPage(request);
              const offset = pages * 50;
              expect(page.records).toEqual(expected.slice(offset, offset + 50));
              expect(page.total).toBe(expected.length);
              expect(page.visibleTotal).toBe(all.length);
              if (expected.length > offset + 50) {
                expect(page.next?.time).toBe(Date.parse(date(0)));
                if (request.after) expect(page.next?.ordinal).toBeGreaterThan(request.after.ordinal);
              } else expect(page.next).toBeUndefined();
              actual.push(...page.records);
              request.after = page.next;
              pages++;
              expect(pages).toBeLessThanOrEqual(Math.ceil(count / 50) + 1);
            } while (request.after);
            expect(actual).toEqual(expected);
          }
        }
      }
      expect(await store.exportReaderDataBackup()).toBe(before);
    },
    30_000
  );
  it.each([100, 1000, MAX_HISTORY_RECORDS])(
    'preserves all three collections, stable filtered pages and backups with %i history records',
    async (count) => {
      const data = dataset(count);
      const json = JSON.stringify(data);
      let store = await import('@/platform/storage/readerDataStore');
      await store.loadReaderState();
      await measure(`reader.merge-import.${count}`, () => store.importReaderDataBackup(json), 5);
      closeConnections();
      vi.resetModules();
      store = await import('@/platform/storage/readerDataStore');
      const reopenStarted = performance.now();
      await store.loadReaderState();
      process.stdout.write(
        `PERF ${JSON.stringify({ name: `reader.reopen.${count}`, samples: 1, elapsedMs: Number((performance.now() - reopenStarted).toFixed(3)) })}\n`
      );
      const state = await measure(`reader.bootstrap.${count}`, () => store.loadReaderState());
      expect(state.counts).toEqual({ history: count, favorites: count / 2, followedUsers: count / 10 });
      for (const collection of ['history', 'favorites', 'followedUsers'] as const) {
        const records = Object.values(data[collection]);
        const expected = records.toSorted(
          (left, right) =>
            Date.parse('savedAt' in right ? right.savedAt : right.followedAt) -
            Date.parse('savedAt' in left ? left.savedAt : left.followedAt)
        );
        const request: ReaderPageRequest = { collection, sources: sourceValues, source: 'all', category: 'all' };
        const collected: string[] = [];
        do {
          const page = await store.queryReaderPage(request);
          expect(page.records.length).toBeLessThanOrEqual(50);
          expect(page.total).toBe(records.length);
          collected.push(...page.records.map((record) => ('topic' in record ? record.topic.id : record.user.id)));
          request.after = page.next;
        } while (request.after);
        expect(collected).toEqual(expected.map((record) => ('topic' in record ? record.topic.id : record.user.id)));
        expect(new Set(collected).size).toBe(records.length);
        await measure(`reader.first-page.${collection}.${count}`, () =>
          store.queryReaderPage({ ...request, after: undefined })
        );
        if (collection !== 'followedUsers') {
          const categories = await measure(`reader.categories.${collection}.${count}`, () =>
            store.queryReaderCategories({ collection, sources: sourceValues })
          );
          const expectedCategories = sourceValues
            .toSorted()
            .flatMap((source) =>
              ['0', '1', '2']
                .filter((id) =>
                  records.some(
                    (record) => 'topic' in record && record.topic.source === source && record.topic.categoryId === id
                  )
                )
                .map((id) => ({ source, id, name: `分区 ${id}` }))
            );
          expect(categories).toEqual(expectedCategories);
        }
      }
      for (const source of sourceValues) {
        const filtered = await measure(`reader.filter.${source}.${count}`, () =>
          store.queryReaderPage({ collection: 'history', sources: sourceValues, source, category: '分区 1' })
        );
        const expected = Object.values(data.history).filter(
          (record) => record.topic.source === source && record.topic.category === '分区 1'
        );
        expect(filtered.total).toBe(expected.length);
        expect(filtered.visibleTotal).toBe(count);
        expect(
          filtered.records.every(
            (record) => 'topic' in record && record.topic.source === source && record.topic.category === '分区 1'
          )
        ).toBe(true);
      }
      const exported = await measure(`reader.export.${count}`, () => store.exportReaderDataBackup(), 5);
      const restored: ReaderData = JSON.parse(exported);
      expect(Object.keys(restored.history).sort()).toEqual(Object.keys(data.history).sort());
      expect(Object.keys(restored.favorites).sort()).toEqual(Object.keys(data.favorites).sort());
      expect(Object.keys(restored.followedUsers).sort()).toEqual(Object.keys(data.followedUsers).sort());
      for (const index of [0, count - 1]) {
        expect(restored.history[topicKey(topic(index))]).toMatchObject({
          savedAt: data.history[topicKey(topic(index))]!.savedAt,
          visitCount: 1,
          topic: { title: topic(index).title, replyCount: index % 100 }
        });
      }
      process.stdout.write(
        `PERF ${JSON.stringify({ name: `reader.backup.${count}`, bytes: Buffer.byteLength(exported) })}\n`
      );
    },
    60_000
  );

  it('serializes bursts of visits at the history limit and clears every record without resurrection', async () => {
    const store = await import('@/platform/storage/readerDataStore');
    const data = dataset(MAX_HISTORY_RECORDS);
    await store.importReaderDataBackup(JSON.stringify(data));
    const burstSize = 100;
    const samples = 5;
    const burstQueries: number[] = [];
    await measure(
      'reader.100-concurrent-visits.at-5000',
      async () => {
        const calls = harness.calls;
        await Promise.all(
          Array.from({ length: burstSize }, () =>
            store.commitReaderCommand({ type: 'visit', topic: topic(0), at: date(100_000) })
          )
        );
        burstQueries.push(harness.calls - calls);
      },
      samples
    );
    expect(burstQueries.slice(1)).toEqual(Array(samples).fill(800));
    const exported: ReaderData = JSON.parse(await store.exportReaderDataBackup());
    expect(exported.history[topicKey(topic(0))]!.visitCount).toBe(1 + burstSize * (samples + 1));
    expect(Object.keys(exported.history)).toHaveLength(MAX_HISTORY_RECORDS);
    const started = performance.now();
    const calls = harness.calls;
    const cleared = await store.commitReaderCommand({ type: 'clear-history', at: date(200_000) });
    process.stdout.write(
      `PERF ${JSON.stringify({ name: 'reader.clear.5000', samples: 1, elapsedMs: Number((performance.now() - started).toFixed(3)), sqlCalls: harness.calls - calls })}\n`
    );
    expect(cleared.membership).toHaveLength(MAX_HISTORY_RECORDS);
    closeConnections();
    vi.resetModules();
    const reopened = await import('@/platform/storage/readerDataStore');
    expect((await reopened.loadReaderState()).counts).toEqual({ history: 0, favorites: 2500, followedUsers: 500 });
    const after: ReaderData = JSON.parse(await reopened.exportReaderDataBackup());
    expect(Object.keys(after.deletedRecords.history)).toHaveLength(1000);
    expect(after.history).toEqual({});
  }, 60_000);

  it('rolls back a merge exceeding 5 MiB and accepts subsequent writes in the same queue', async () => {
    const store = await import('@/platform/storage/readerDataStore');
    const data = createEmptyReaderData();
    for (let index = 0; index < 1280; index++) {
      const item = topic(index, '界'.repeat(1200));
      data.favorites[topicKey(item)] = { topic: item, savedAt: date(index) };
    }
    const json = JSON.stringify(data);
    expect(Buffer.byteLength(json)).toBeGreaterThan(MAX_BACKUP_JSON_BYTES * 0.9);
    expect(Buffer.byteLength(json)).toBeLessThan(MAX_BACKUP_JSON_BYTES);
    await store.importReaderDataBackup(json);
    const before = await store.exportReaderDataBackup();
    const incoming = createEmptyReaderData();
    for (let index = 1280; index < 1450; index++) {
      const item = topic(index, '界'.repeat(1200));
      incoming.favorites[topicKey(item)] = { topic: item, savedAt: date(index) };
    }
    await measure(
      'reader.capacity-rejected-merge',
      async () => {
        await expect(store.importReaderDataBackup(JSON.stringify(incoming))).rejects.toThrow('超过备份容量');
      },
      5
    );
    expect(await store.exportReaderDataBackup()).toBe(before);
    await store.commitReaderCommand({ type: 'settings', patch: { theme: 'dark' } });
    closeConnections();
    vi.resetModules();
    const reopened = await import('@/platform/storage/readerDataStore');
    expect((await reopened.loadReaderState()).counts.favorites).toBe(1280);
    expect((await reopened.loadReaderState()).settings.theme).toBe('dark');
  }, 60_000);

  it.each([1000, 10_000, 50_000])(
    'sorts %i mixed-time notifications without losing stable unknown-time ordering',
    async (count) => {
      const items: ForumNotification[] = Array.from({ length: count }, (_, position) => {
        const index = (position * 7919) % count;
        return {
          source: 'nodeseek',
          id: String(index),
          kind: 'reply',
          actor: { name: 'reader' },
          title: `消息 ${index}`,
          createdAt: index % 17 ? date(index % 97) : null,
          unread: true,
          target: { type: 'information' }
        };
      });
      const sorted = await measure(`notifications.sort.${count}`, () => sortNotifications(items));
      expect(new Set(sorted.map((item) => item.id)).size).toBe(count);
      const known = sorted.filter((item) => item.createdAt !== null);
      expect(sorted.slice(known.length)).toEqual(items.filter((item) => item.createdAt === null));
      const positions = new Map(items.map((item, index) => [item.id, index]));
      for (let index = 1; index < known.length; index++) {
        const previous = known[index - 1]!;
        const current = known[index]!;
        expect(Date.parse(previous.createdAt!)).toBeGreaterThanOrEqual(Date.parse(current.createdAt!));
        if (previous.createdAt === current.createdAt)
          expect(positions.get(previous.id)!).toBeLessThan(positions.get(current.id)!);
      }
    }
  );

  it('keeps delivery state bounded over 1000 overlapping scans and silences repeated scans', async () => {
    const scan = () => {
      let state = advanceNotificationDelivery(undefined, 'nodeseek:load', []).state;
      let delivered = 0;
      for (let round = 0; round < 1000; round++) {
        const ids = Array.from({ length: 60 }, (_, index) => String(round * 40 + index));
        const advanced = advanceNotificationDelivery(state, 'nodeseek:load', [...ids, ...ids.slice(0, 5)]);
        delivered += advanced.newIds.length;
        state = advanced.state;
      }
      return { state, delivered };
    };
    const { state, delivered } = await measure('notifications.delivery.1000-rounds', scan);
    expect(delivered).toBe(40_020);
    expect(state.deliveredIds).toHaveLength(200);
    expect(new Set(state.deliveredIds).size).toBe(200);
    expect(advanceNotificationDelivery(state, 'nodeseek:load', state.deliveredIds).newIds).toEqual([]);
    expect(advanceNotificationDelivery(state, 'nodeseek:other', state.deliveredIds).newIds).toEqual([]);
  });
});
