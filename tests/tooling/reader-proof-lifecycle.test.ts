// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sqliteParameters } from '../helpers/sqliteParameters';
import { createEmptyReaderData } from '@/domain/reader/readerData';

type Connection = { db: DatabaseSync; proof: boolean; closeAttempts: number };
type Fault = { query: string; error: unknown; skip?: number; afterExecution?: boolean; target?: 'reopened' };
const harness = vi.hoisted(() => ({
  directory: '',
  connections: new Array<Connection>(),
  faults: new Array<Fault>(),
  legacy: new Map<string, string>(),
  nextIsProof: false
}));

vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    openDatabaseAsync: async (name: string) => {
      const connection = {
        db: new DatabaseSync(path.join(harness.directory, name)),
        proof: harness.nextIsProof,
        closeAttempts: 0
      };
      harness.nextIsProof = false;
      harness.connections.push(connection);
      const faultFor = (query: string) => {
        const fault = harness.faults[0];
        const matches =
          fault?.target === 'reopened'
            ? harness.connections.indexOf(connection) > harness.connections.findIndex((value) => value.proof)
            : connection.proof;
        if (!matches || !fault || query !== fault.query) return;
        if (fault.skip) {
          fault.skip--;
          return;
        }
        harness.faults.shift();
        return fault;
      };
      return {
        execAsync: async (sql: string) => {
          const fault = faultFor(sql);
          if (fault?.afterExecution) connection.db.exec(sql);
          if (fault) throw fault.error;
          connection.db.exec(sql);
        },
        runAsync: async (sql: string, ...args: unknown[]) => {
          const fault = faultFor(sql);
          if (fault) throw fault.error;
          return connection.db.prepare(sql).run(...sqliteParameters(args));
        },
        getFirstAsync: async (sql: string, ...args: unknown[]) => {
          const fault = faultFor(sql);
          if (fault) throw fault.error;
          return connection.db.prepare(sql).get(...sqliteParameters(args)) ?? null;
        },
        getAllAsync: async (sql: string, ...args: unknown[]) => {
          const fault = faultFor(sql);
          if (fault) throw fault.error;
          return connection.db.prepare(sql).all(...sqliteParameters(args));
        },
        closeAsync: async () => {
          connection.closeAttempts++;
          const fault = faultFor('close');
          if (fault) throw fault.error;
          connection.db.close();
        }
      };
    }
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => harness.legacy.get(key) ?? null,
    getAllKeys: async () => [...harness.legacy.keys()],
    removeMany: async (keys: string[]) => keys.forEach((key) => harness.legacy.delete(key))
  }
}));

beforeEach(() => {
  vi.resetModules();
  harness.directory = mkdtempSync(path.join(tmpdir(), 'reader-proof-lifecycle-'));
  harness.connections = [];
  harness.faults = [];
  harness.legacy.clear();
  harness.nextIsProof = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of harness.connections) if (connection.db.isOpen) connection.db.close();
  expect(path.dirname(path.resolve(harness.directory))).toBe(path.resolve(tmpdir()));
  rmSync(harness.directory, { recursive: true, force: true });
  vi.resetModules();
});

async function fixture() {
  const data = createEmptyReaderData();
  data.settings.theme = 'dark';
  data.history['v2ex:917'] = {
    topic: {
      source: 'v2ex',
      id: '917',
      title: 'Original fixture record',
      author: 'fixture',
      url: 'https://www.v2ex.com/t/917',
      createdAt: ''
    },
    savedAt: '2026-06-01T00:00:00Z',
    visitCount: 2
  };
  harness.legacy.set('reader-data', JSON.stringify(data));
  harness.legacy.set('reader-settings', JSON.stringify(data.settings));
  const store = await import('@/platform/storage/readerDataStore');
  await store.loadReaderState();
  const original = await store.exportReaderDataBackup();
  const { verifyDeletionBoundaries } = await import('../../dev/reader-storage-proof/deletionBoundaries');
  harness.nextIsProof = true;
  const proofConnection = () => {
    const value = harness.connections.find((connection) => connection.proof);
    if (!value) throw new Error('Expected an acquired proof connection');
    return value;
  };
  return { store, original, verifyDeletionBoundaries, proofConnection };
}

async function failed(operation: Promise<unknown>) {
  const outcome = await operation.then(
    () => ({ kind: 'passed' as const }),
    (error: unknown) => ({ kind: 'failed' as const, error })
  );
  if (outcome.kind !== 'failed') throw new Error('Expected failure');
  return outcome.error;
}

const snapshotRows = 'SELECT kind, key, value FROM reader_records ORDER BY ordinal';
const replaceRows = 'DELETE FROM reader_records; DELETE FROM reader_deleted;';

it('verifies all twenty-seven deletion boundaries on real SQLite and restores the original fixture', async () => {
  const test = await fixture();
  const initialConnections = harness.connections.length;
  const verification = test.verifyDeletionBoundaries();
  await expect(verification).resolves.toHaveLength(27);
  const results = await verification;
  expect(results.every((result) => result.present === result.day > 2)).toBe(true);
  expect(await test.store.exportReaderDataBackup()).toBe(test.original);
  expect(test.proofConnection().closeAttempts).toBe(1);
  const owned = harness.connections.slice(initialConnections);
  expect(owned.length).toBe(10);
  expect(owned.every((connection) => !connection.db.isOpen)).toBe(true);
});

it('closes the acquired connection when the original snapshot read fails', async () => {
  const test = await fixture();
  harness.faults.push({ query: snapshotRows, error: 0 });
  expect(await failed(test.verifyDeletionBoundaries())).toBe(0);
  expect(test.proofConnection().closeAttempts).toBe(1);
  expect(await test.store.exportReaderDataBackup()).toBe(test.original);
});

it('attempts close after restoration fails and retains the original, restoration and close errors', async () => {
  const test = await fixture();
  const restoration = new Error('Restore failed');
  vi.spyOn(test.store, 'importReaderDataBackup').mockRejectedValueOnce(0);
  harness.faults.push({ query: replaceRows, skip: 1, error: restoration }, { query: 'close', error: undefined });
  const error = await failed(test.verifyDeletionBoundaries());
  expect(test.proofConnection().closeAttempts).toBe(1);
  if (!(error instanceof AggregateError)) throw new Error('Expected every cause');
  expect(error.errors).toEqual([0, restoration, undefined]);
});

it('retains write and rollback acknowledgement failures after restoring the actual SQLite contents', async () => {
  const test = await fixture();
  const write = new Error('Write failed');
  const rollback = new Error('Rollback acknowledgement failed');
  harness.faults.push(
    { query: replaceRows, error: write },
    { query: 'ROLLBACK', afterExecution: true, error: rollback }
  );
  const error = await failed(test.verifyDeletionBoundaries());
  if (!(error instanceof AggregateError)) throw new Error('Expected both transaction causes');
  expect(error.errors).toEqual([write, rollback]);
  expect(await test.store.exportReaderDataBackup()).toBe(test.original);
  expect(test.proofConnection().closeAttempts).toBe(1);
});

it('closes the connection if restoration verification fails', async () => {
  const test = await fixture();
  const verification = new Error('Restore readback failed');
  harness.faults.push({ query: snapshotRows, skip: 1, error: verification });
  expect(await failed(test.verifyDeletionBoundaries())).toBe(verification);
  expect(test.proofConnection().closeAttempts).toBe(1);
  expect(await test.store.exportReaderDataBackup()).toBe(test.original);
});

it('retains the body error when restoration succeeds but closing fails', async () => {
  const test = await fixture();
  const body = new Error('Import failed');
  vi.spyOn(test.store, 'importReaderDataBackup').mockRejectedValueOnce(body);
  harness.faults.push({ query: 'close', error: false });
  const error = await failed(test.verifyDeletionBoundaries());
  if (!(error instanceof AggregateError)) throw new Error('Expected body and close causes');
  expect(error.errors).toEqual([body, false]);
  expect(await test.store.exportReaderDataBackup()).toBe(test.original);
  expect(test.proofConnection().closeAttempts).toBe(1);
});

it('retains reopened verification and close failures while restoring the original contents', async () => {
  const test = await fixture();
  const read = new Error('Independent read failed');
  harness.faults.push(
    { query: snapshotRows, target: 'reopened', error: read },
    { query: 'close', target: 'reopened', error: false }
  );
  const error = await failed(test.verifyDeletionBoundaries());
  if (!(error instanceof AggregateError)) throw new Error('Expected read and close causes');
  expect(error.errors).toEqual([read, false]);
  expect(test.proofConnection().closeAttempts).toBe(1);
  expect(await test.store.exportReaderDataBackup()).toBe(test.original);
});
