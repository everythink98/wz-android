// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const harness = vi.hoisted(() => ({
  directory: '',
  connections: [] as { close(): void }[],
  legacy: new Map<string, string>(),
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
    setItem: vi.fn(async (key: string, value: string) => {
      harness.legacy.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      harness.legacy.delete(key);
    })
  }
}));

const identity = 'nodeseek:fixture';
const fingerprint = '0123456789abcdef';
const entry = (localId: string, remoteId: string | null = '301') => ({ localId, fingerprint, remoteId });
const legacyKey = (account = identity) => `wz:composer:nodeseek-polls:${encodeURIComponent(account)}`;
const load = () => import('./nodeSeekPollJournal');
const inspect = () => {
  const db = new DatabaseSync(join(harness.directory, 'composer-journal.db'));
  harness.connections.push(db);
  return db;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  harness.legacy.clear();
  harness.fail = '';
  harness.directory = mkdtempSync(join(tmpdir(), 'wz-poll-journal-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  harness.connections.forEach((db) => db.close());
  harness.connections = [];
  rmSync(harness.directory, { recursive: true, force: true });
});

describe('NodeSeek poll journal', () => {
  it('runs the Android proof through real action and dispatch seams and reopens the in-flight claim without transport', async () => {
    const network = vi.fn(() => {
      throw new Error('Device proof must not access an external network');
    });
    vi.stubGlobal('fetch', network);
    const proof = await import('../../../dev/reader-storage-proof/pollJournal');
    const token = '1234567890abcdef1234567890abcdef';
    await expect(proof.exercisePollActionTransport(token)).resolves.toEqual({
      transportAttempts: 4,
      durableClaimObservedBeforeSend: true,
      knownResultPersisted: true,
      crossAccountIsolated: true,
      unsentReleased: true,
      explicitRejectionReleased: true,
      unconfirmedResponseRetained: true,
      networkOutsideTransaction: true,
      pendingAtCheckpoint: true
    });
    await expect(proof.verifyReopenedPollActionTransport(token)).rejects.toThrow('new JS process');
    expect(inspect().prepare('SELECT local_id, remote_id FROM nodeseek_poll_journal ORDER BY local_id').all()).toEqual([
      { local_id: 'poll_action_known', remote_id: '901' },
      { local_id: 'poll_action_pending', remote_id: null },
      { local_id: 'poll_action_unknown', remote_id: null }
    ]);
    // Host evidence covers fresh modules/connections; only the device runner proves an actual process interruption.
    vi.resetModules();
    const reopened = await import('../../../dev/reader-storage-proof/pollJournal');
    await expect(reopened.verifyReopenedPollActionTransport(token)).resolves.toEqual({
      pendingTransportRetained: true,
      unconfirmedResponseRetained: true,
      knownRemoteId: '901',
      retryTransports: 0,
      releasedIntentsReusable: true
    });
    expect(network).not.toHaveBeenCalled();
  });

  it('makes the device reopen oracle fail when an in-flight durable claim is missing', async () => {
    const network = vi.fn(() => {
      throw new Error('Device proof must not access an external network');
    });
    vi.stubGlobal('fetch', network);
    const proof = await import('../../../dev/reader-storage-proof/pollJournal');
    const token = 'abcdef1234567890abcdef1234567890';
    await proof.exercisePollActionTransport(token);
    inspect().prepare("DELETE FROM nodeseek_poll_journal WHERE local_id='poll_action_pending'").run();
    vi.resetModules();
    const reopened = await import('../../../dev/reader-storage-proof/pollJournal');
    await expect(reopened.verifyReopenedPollActionTransport(token)).rejects.toThrow('lost a transport claim');
    expect(network).not.toHaveBeenCalled();
  });

  it('retains both remotely created polls when separate Topics save concurrently', async () => {
    const store = await load();
    const polls = [entry('poll_parallel_001'), entry('poll_parallel_002', '302')];
    await Promise.all(polls.map((poll) => store.saveNodeSeekPollJournalEntry(identity, poll)));
    for (const poll of polls) {
      await expect(store.readNodeSeekPollJournalEntry(identity, poll.localId)).resolves.toEqual(poll);
    }
  });

  it('claims one intent once and keeps distinct accounts, local ids, and edited fingerprints independent', async () => {
    const store = await load();
    const intent = entry('poll_intent_0001', null);
    const claims = await Promise.all([
      store.claimNodeSeekPollJournalEntry(identity, intent),
      store.claimNodeSeekPollJournalEntry(identity, intent)
    ]);
    expect(claims.map((claim) => claim.claimed)).toEqual([true, false]);
    await expect(store.claimNodeSeekPollJournalEntry('nodeseek:other', intent)).resolves.toMatchObject({
      claimed: true
    });
    await expect(
      store.claimNodeSeekPollJournalEntry(identity, { ...intent, localId: 'poll_intent_0002' })
    ).resolves.toMatchObject({ claimed: true });
    await expect(
      store.claimNodeSeekPollJournalEntry(identity, { ...intent, fingerprint: 'fedcba9876543210' })
    ).resolves.toMatchObject({ claimed: true });
    await store.saveNodeSeekPollJournalEntry(identity, { ...intent, remoteId: '501' });
    await store.saveNodeSeekPollJournalEntry(identity, intent);
    await store.releaseNodeSeekPollJournalEntry(identity, intent);
    await expect(store.claimNodeSeekPollJournalEntry(identity, intent)).resolves.toMatchObject({
      claimed: false,
      entry: { remoteId: '501' }
    });
    await expect(store.saveNodeSeekPollJournalEntry(identity, { ...intent, remoteId: '502' })).rejects.toThrow('冲突');
  });

  it('releases only a definitely unsent pending intent and keeps known older polls after more than 32 writes', async () => {
    const store = await load();
    const intent = entry('poll_unsent_0001', null);
    await store.claimNodeSeekPollJournalEntry(identity, intent);
    await store.releaseNodeSeekPollJournalEntry(identity, intent);
    await expect(store.claimNodeSeekPollJournalEntry(identity, intent)).resolves.toMatchObject({ claimed: true });
    for (let index = 0; index < 35; index++) {
      await store.saveNodeSeekPollJournalEntry(identity, entry(`poll_many_${index}`, String(600 + index)));
    }
    await expect(store.readNodeSeekPollJournalEntry(identity, 'poll_many_0', fingerprint)).resolves.toEqual(
      entry('poll_many_0', '600')
    );
  });

  it('commits legacy known and unknown entries before deleting just that account key', async () => {
    const legacy = [entry('poll_legacy_001'), entry('poll_legacy_002', null)];
    harness.legacy.set(legacyKey(), JSON.stringify(legacy));
    harness.legacy.set(legacyKey('nodeseek:other'), '{broken');
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(storage.removeItem).mockImplementationOnce(async (key) => {
      const db = inspect();
      expect(db.prepare('SELECT COUNT(*) AS count FROM nodeseek_poll_journal').get()).toEqual({ count: 2 });
      expect(db.prepare('SELECT status FROM nodeseek_poll_migration').get()).toEqual({ status: 'cleanup_pending' });
      harness.legacy.delete(key);
    });
    const store = await load();
    await expect(store.readNodeSeekPollJournalEntry(identity, legacy[0]!.localId)).resolves.toEqual(legacy[0]);
    await expect(store.claimNodeSeekPollJournalEntry(identity, legacy[1]!)).resolves.toMatchObject({
      claimed: false,
      entry: { remoteId: null }
    });
    expect(harness.legacy.has(legacyKey())).toBe(false);
    expect(harness.legacy.get(legacyKey('nodeseek:other'))).toBe('{broken');
    expect(inspect().prepare('SELECT status FROM nodeseek_poll_migration').get()).toEqual({ status: 'ready' });
  });

  it.each(['{broken', '{}', '[{}]', JSON.stringify([entry('poll_dup_0001'), entry('poll_dup_0001')])])(
    'keeps corrupt legacy data and blocks account writes: %s',
    async (raw) => {
      harness.legacy.set(legacyKey(), raw);
      const store = await load();
      await expect(store.claimNodeSeekPollJournalEntry(identity, entry('poll_blocked_001'))).rejects.toThrow();
      expect(harness.legacy.get(legacyKey())).toBe(raw);
      expect(inspect().prepare('SELECT COUNT(*) AS count FROM nodeseek_poll_journal').get()).toEqual({ count: 0 });
      await expect(
        store.claimNodeSeekPollJournalEntry('nodeseek:other', entry('poll_other_001'))
      ).resolves.toMatchObject({
        claimed: true
      });
    }
  );

  it('rolls back failed legacy migration and retries the original data on a fresh connection', async () => {
    const original = JSON.stringify([entry('poll_migration_01')]);
    harness.legacy.set(legacyKey(), original);
    harness.fail = 'INSERT INTO nodeseek_poll_migration';
    await expect((await load()).readNodeSeekPollJournalEntry(identity, 'poll_migration_01')).rejects.toThrow();
    expect(harness.legacy.get(legacyKey())).toBe(original);
    expect(inspect().prepare('SELECT COUNT(*) AS count FROM nodeseek_poll_journal').get()).toEqual({ count: 0 });
    vi.resetModules();
    await expect((await load()).readNodeSeekPollJournalEntry(identity, 'poll_migration_01')).resolves.toEqual(
      entry('poll_migration_01')
    );
  });

  it('keeps the committed journal authoritative after legacy cleanup fails and never reimports stale data', async () => {
    harness.legacy.set(legacyKey(), JSON.stringify([entry('poll_cleanup_001', null)]));
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(storage.removeItem).mockRejectedValueOnce(new Error('cleanup unavailable'));
    const store = await load();
    await expect(store.readNodeSeekPollJournalEntry(identity, 'poll_cleanup_001')).resolves.toEqual(
      entry('poll_cleanup_001', null)
    );
    expect(harness.legacy.has(legacyKey())).toBe(true);
    await store.saveNodeSeekPollJournalEntry(identity, entry('poll_cleanup_001', '999'));
    vi.resetModules();
    await expect((await load()).readNodeSeekPollJournalEntry(identity, 'poll_cleanup_001')).resolves.toEqual(
      entry('poll_cleanup_001', '999')
    );
    expect(harness.legacy.has(legacyKey())).toBe(false);
  });

  it('does not clear legacy storage when the independent committed-data verification fails', async () => {
    const original = JSON.stringify([entry('poll_verify_0001')]);
    harness.legacy.set(legacyKey(), original);
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    const remove = vi.mocked(storage.removeItem);
    const store = await load();
    const { openDatabaseAsync } = await import('expo-sqlite');
    const open = vi.mocked(openDatabaseAsync);
    open.mockImplementationOnce(open.getMockImplementation()!).mockRejectedValueOnce(new Error('verification failed'));
    await expect(store.readNodeSeekPollJournalEntry(identity, 'poll_verify_0001')).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(harness.legacy.get(legacyKey())).toBe(original);
  });

  it('blocks a corrupt committed intent without falling back to a legacy snapshot', async () => {
    const store = await load();
    await store.saveNodeSeekPollJournalEntry(identity, entry('poll_corrupt_001'));
    harness.legacy.set(legacyKey(), JSON.stringify([entry('poll_corrupt_001')]));
    inspect().exec("UPDATE nodeseek_poll_journal SET remote_id='invalid'");
    await expect(store.claimNodeSeekPollJournalEntry(identity, entry('poll_corrupt_001'))).rejects.toThrow('损坏');
    await expect(store.readNodeSeekPollJournalEntry(identity, 'poll_corrupt_001')).rejects.toThrow('损坏');
    await expect(store.saveNodeSeekPollJournalEntry(identity, entry('poll_corrupt_001'))).rejects.toThrow('损坏');
    expect(harness.legacy.has(legacyKey())).toBe(true);
  });

  it('retains pending and known entries when another module opens its own connection', async () => {
    const first = await load();
    await first.claimNodeSeekPollJournalEntry(identity, entry('poll_reopen_001', null));
    await first.saveNodeSeekPollJournalEntry(identity, entry('poll_reopen_002'));
    vi.resetModules();
    const second = await load();
    await expect(second.claimNodeSeekPollJournalEntry(identity, entry('poll_reopen_001'))).resolves.toMatchObject({
      claimed: false,
      entry: { remoteId: null }
    });
    await expect(second.claimNodeSeekPollJournalEntry(identity, entry('poll_reopen_002'))).resolves.toMatchObject({
      claimed: false,
      entry: { remoteId: '301' }
    });
    expect(inspect().prepare('SELECT COUNT(*) AS count FROM nodeseek_poll_journal').get()).toEqual({ count: 2 });
  });

  it('allows only one connection to claim a new intent while another writer competes', async () => {
    const first = await load();
    await first.readNodeSeekPollJournalEntry(identity, 'poll_warm_0001');
    vi.resetModules();
    const second = await load();
    await second.readNodeSeekPollJournalEntry(identity, 'poll_warm_0001');
    // The synchronous test engine cannot release a writer during busy_timeout; a loser may reject safely.
    harness.connections.forEach((db) => (db as DatabaseSync).exec('PRAGMA busy_timeout = 1'));
    const intent = entry('poll_compete_001', null);
    const results = await Promise.allSettled([
      first.claimNodeSeekPollJournalEntry(identity, intent),
      second.claimNodeSeekPollJournalEntry(identity, intent)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled' && result.value.claimed)).toHaveLength(1);
    await expect(second.claimNodeSeekPollJournalEntry(identity, intent)).resolves.toMatchObject({ claimed: false });
    expect(inspect().prepare('SELECT COUNT(*) AS count FROM nodeseek_poll_journal').get()).toEqual({ count: 1 });
  });

  it('freezes further journal access when a failed commit cannot be rolled back', async () => {
    const store = await load();
    await store.claimNodeSeekPollJournalEntry(identity, entry('poll_before_0001', null));
    const { openDatabaseAsync } = await import('expo-sqlite');
    const db = await vi.mocked(openDatabaseAsync).mock.results[0]!.value;
    const exec = db.execAsync.bind(db);
    vi.spyOn(db, 'execAsync').mockImplementation(async (sql) => {
      if (sql === 'COMMIT' || sql === 'ROLLBACK') throw new Error('transaction unavailable');
      return exec(sql);
    });
    await expect(store.claimNodeSeekPollJournalEntry(identity, entry('poll_uncertain_01'))).rejects.toThrow('无法确认');
    await expect(store.readNodeSeekPollJournalEntry(identity, 'poll_before_0001')).rejects.toThrow('状态不明');
    await expect(store.claimNodeSeekPollJournalEntry(identity, entry('poll_blocked_001'))).rejects.toThrow('状态不明');
    expect(inspect().prepare('SELECT COUNT(*) AS count FROM nodeseek_poll_journal').get()).toEqual({ count: 1 });
  });
});
