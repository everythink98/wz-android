import '@/platform/diagnostics/diagnosticBootstrap';
import { registerRootComponent } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { createEmptyReaderData, type ReaderData } from '@/domain/reader/readerData';
import type { Topic } from '@/domain/forum/models';
import type { ReaderPageRequest } from '@/domain/reader/readerRecordState';
import { readReaderMeta, readReaderSnapshot, utf8Bytes } from '@/platform/storage/readerDatabase';
import * as store from '@/platform/storage/readerDataStore';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';

// Only the isolated Android runner selects this entry; production has no fault switches.
const marker = 'reader-storage-proof-owner';
const at = '2026-09-10T00:00:00.000Z';
function topic(id: number, padding = 0): Topic {
  return {
    source: 'nodeseek',
    id: String(id),
    title: `测试 😀 " \\ ${id}${'资料'.repeat(padding)}`,
    author: 'fixture',
    category: '日常',
    url: `https://www.nodeseek.com/post-${id}-1`,
    createdAt: '2026-05-18T11:34:13.000Z',
    replyCount: 2
  };
}
function fixture(profile: string): ReaderData {
  const data = createEmptyReaderData();
  const count = profile === 'ordinary' ? 123 : profile === 'supported' ? 1000 : 5002;
  const padding = profile === 'large' ? 40 : profile === 'overbytes' ? 150 : 0;
  for (let i = 0; i < count; i++)
    data.history[`nodeseek:${i}`] = { topic: topic(i, padding), savedAt: at, visitCount: i + 1 };
  for (let i = 0; i < (profile === 'supported' ? 5000 : 2); i++)
    data.favorites[`nodeseek:${i}`] = { topic: topic(i), savedAt: '2025-01-01T00:00:00.000Z' };
  data.deletedRecords.history['nodeseek:deleted'] = at;
  return data;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function execute(mode: string, profile: string, token: string, status: (text: string) => void) {
  const started = performance.now();
  const write = (checkpoint: string, details: object = {}) => {
    const file = new File(Paths.cache, 'reader-storage-proof.json');
    file.create({ overwrite: true });
    file.write(
      JSON.stringify({
        ...diagnosticBuildContext(),
        mode,
        profile,
        token,
        checkpoint,
        isDev: __DEV__,
        isHermes: 'HermesInternal' in globalThis,
        elapsedMs: performance.now() - started,
        ...details
      })
    );
    status(checkpoint);
  };
  try {
    if (mode === 'seed') {
      const keys = await AsyncStorage.getAllKeys();
      check(keys.length === 0 || (await AsyncStorage.getItem(marker)) === 'isolated', 'Refusing unowned fixture data');
      const db = await openDatabaseAsync('reader-data.db');
      await db.closeAsync();
      await deleteDatabaseAsync('reader-data.db');
      const data = fixture(profile);
      await AsyncStorage.setMany({
        [marker]: 'isolated',
        'reader-data': JSON.stringify(data),
        'reader-settings': JSON.stringify(data.settings),
        'reader-storage-unrelated': 'preserved'
      });
      write('passed', { bytes: utf8Bytes(JSON.stringify(data)), history: Object.keys(data.history).length });
      return;
    }
    check((await AsyncStorage.getItem(marker)) === 'isolated', 'Missing isolated fixture owner');
    const pause = async () => {
      write('paused');
      await new Promise<void>(() => undefined);
    };
    if (mode === 'before-commit' || mode === 'after-commit') {
      const original = SQLiteDatabase.prototype.execAsync;
      let intercepted = false;
      SQLiteDatabase.prototype.execAsync = async function (sql: string) {
        if (sql === 'COMMIT' && !intercepted) {
          intercepted = true;
          if (mode === 'before-commit') await pause();
          await original.call(this, sql);
          if (mode === 'after-commit') await pause();
          return;
        }
        return original.call(this, sql);
      };
    }
    if (['after-first-delete', 'after-delete', 'cleanup-failure'].includes(mode)) {
      const original = AsyncStorage.removeMany.bind(AsyncStorage);
      AsyncStorage.removeMany = async (keys) => {
        if (mode === 'cleanup-failure') throw new Error('injected cleanup failure');
        if (mode === 'after-first-delete') await AsyncStorage.removeItem(keys[0]);
        else await original(keys);
        await pause();
      };
    }
    const loadStarted = performance.now();
    const state = await store.loadReaderState();
    const loadMs = performance.now() - loadStarted;
    const db = await openDatabaseAsync('reader-data.db', { useNewConnection: true });
    try {
      const expected = fixture(profile);
      if (mode === 'verify-updated') expected.settings.theme = 'dark';
      const actual = await readReaderSnapshot(db);
      check(JSON.stringify(actual) === JSON.stringify(expected), 'Complete migration contents/order mismatch');
      check((await readReaderMeta(db))?.bytes === utf8Bytes(JSON.stringify(expected)), 'Logical byte mismatch');
      check((await AsyncStorage.getItem('reader-storage-unrelated')) === 'preserved', 'Other owner changed');
      const keys = await AsyncStorage.getAllKeys();
      if (mode === 'cleanup-failure') {
        check(
          keys.includes('reader-data') && (await readReaderMeta(db))?.status === 'cleanup_pending',
          'Cleanup retry state lost'
        );
        await store.commitReaderCommand({ type: 'settings', patch: { theme: 'dark' } });
        write('passed', { loadMs, counts: state.counts });
        return;
      }
      check(!keys.includes('reader-data') && !keys.includes('reader-settings'), 'Legacy keys retained');
      check((await readReaderMeta(db))?.status === 'ready', 'Cleanup not committed');
      if (mode !== 'exercise') {
        write('passed', { loadMs, counts: state.counts });
        return;
      }
      const queryStarted = performance.now();
      const request: ReaderPageRequest = {
        collection: 'history',
        sources: ['nodeseek', 'linuxdo', 'yaohuo', 'v2ex'],
        source: 'all',
        category: 'all'
      };
      const ids: string[] = [];
      let firstPageMs = 0;
      do {
        const page = await store.queryReaderPage(request);
        if (!ids.length) firstPageMs = performance.now() - queryStarted;
        ids.push(...page.records.map((record) => ('topic' in record ? record.topic.id : '')));
        request.after = page.next;
      } while (request.after);
      check(
        JSON.stringify(ids) === JSON.stringify(Object.values(expected.history).map((record) => record.topic.id)),
        'Cursor omitted/repeated/reordered rows'
      );
      const queryMs = performance.now() - queryStarted;
      const plans = await db.getAllAsync<{ detail: string }>(
        "EXPLAIN QUERY PLAN SELECT value FROM reader_records WHERE kind='history' ORDER BY time DESC, ordinal ASC LIMIT 51"
      );
      check(
        plans.some((row) => row.detail.includes('reader_order')),
        'Missing indexed ordering'
      );
      await db.execAsync(
        "CREATE TRIGGER proof_fail BEFORE UPDATE ON reader_records WHEN NEW.kind='favorites' BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
      );
      let rejected = false;
      try {
        await store.commitReaderCommand({ type: 'visit', topic: { ...topic(0), title: 'updated' }, at });
      } catch {
        rejected = true;
      }
      check(
        rejected && JSON.stringify(await readReaderSnapshot(db)) === JSON.stringify(expected),
        'Atomic history/favorite rollback failed'
      );
      await db.execAsync('DROP TRIGGER proof_fail');
      await db.execAsync('BEGIN IMMEDIATE');
      const lockStarted = performance.now();
      rejected = false;
      try {
        await store.commitReaderCommand({ type: 'visit', topic: topic(0), at });
      } catch {
        rejected = true;
      }
      const lockMs = performance.now() - lockStarted;
      await db.execAsync('ROLLBACK');
      check(rejected && lockMs >= 2800 && lockMs < 6000, 'Bounded native lock wait failed');
      const writeStarted = performance.now();
      await store.commitReaderCommand({ type: 'visit', topic: topic(0), at });
      const writeMs = performance.now() - writeStarted;
      const changed = await readReaderSnapshot(db);
      check(
        changed.history['nodeseek:0'].visitCount === 2 &&
          changed.favorites['nodeseek:0'].savedAt === expected.favorites['nodeseek:0'].savedAt,
        'Visit/favorite contract changed'
      );
      const exportSnapshot = store.exportReaderDataBackup();
      const laterVisit = store.commitReaderCommand({
        type: 'visit',
        topic: topic(90000),
        at: '2026-09-11T00:00:00.000Z'
      });
      const exported = JSON.parse(await exportSnapshot) as ReaderData;
      check(!exported.history['nodeseek:90000'], 'Export included a later queued write');
      await laterVisit;
      check((await readReaderSnapshot(db)).history['nodeseek:90000'], 'Newer visit was not retained');
      const incoming = createEmptyReaderData();
      incoming.favorites['nodeseek:90001'] = { topic: topic(90001), savedAt: at };
      const importStarted = performance.now();
      const imported = store.importReaderDataBackup(JSON.stringify(incoming));
      const laterDelete = store.commitReaderCommand({
        type: 'delete',
        collection: 'favorites',
        keys: ['nodeseek:90001'],
        at
      });
      await imported;
      const importMs = performance.now() - importStarted;
      await laterDelete;
      const final = await readReaderSnapshot(db);
      check(
        final.history['nodeseek:90000'] &&
          !final.favorites['nodeseek:90001'] &&
          final.deletedRecords.favorites['nodeseek:90001'] === at,
        'Backup overwrote or omitted a queued operation'
      );
      check(
        (await readReaderMeta(db))?.bytes === utf8Bytes(JSON.stringify(final)),
        'Bytes drifted after native backup merge'
      );
      write('passed', {
        loadMs,
        firstPageMs,
        queryMs,
        writeMs,
        importMs,
        lockMs,
        counts: state.counts,
        plans,
        backupQueuePassed: true
      });
    } finally {
      await db.closeAsync();
    }
  } catch (error) {
    write('failed', { error: error instanceof Error ? error.message : String(error) });
  }
}
function ProofApp() {
  const [status, setStatus] = useState('Reader storage proof');
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const match = /^wzreaderproof:\/\/([a-z-]+)\/(ordinary|supported|large|overbytes)\/([a-f0-9]{32})$/.exec(
        url || ''
      );
      if (match) return execute(match[1], match[2], match[3], setStatus);
    });
  }, []);
  return (
    <View>
      <Text>{status}</Text>
    </View>
  );
}
registerRootComponent(ProofApp);
