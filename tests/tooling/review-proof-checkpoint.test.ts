// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawn } from 'node:child_process';
import {
  proofDeviceForSerial,
  resumeProofCheckpoint,
  withProofCheckpoint
} from '../../scripts/review-proof-checkpoint.mjs';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn()
}));

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wz-proof-checkpoint-'));
  directories.push(root);
  const remote = path.join(root, 'device');
  mkdirSync(path.join(remote, 'files/SQLite'), { recursive: true });
  mkdirSync(path.join(remote, 'databases'), { recursive: true });
  const reader = new DatabaseSync(path.join(remote, 'files/SQLite/reader-data.db'));
  reader.exec(
    "CREATE TABLE reader_meta (id PRIMARY KEY, settings); INSERT INTO reader_meta VALUES(1, 'original'); CREATE TABLE reader_counts(kind); CREATE TABLE reader_records(kind, key, value); CREATE TABLE reader_deleted(kind, key, value);"
  );
  reader.close();
  const storage = new DatabaseSync(path.join(remote, 'databases/AsyncStorage'));
  storage.exec(
    "CREATE TABLE Storage(key PRIMARY KEY, value); INSERT INTO Storage VALUES('reader-storage-proof-owner', 'isolated'), ('notifications', 'original'), ('unrelated-key', 'keep');"
  );
  storage.close();
  const identity = {
    avd: 'WZ_ReaderStorage_API35_20260910',
    package: 'com.wz.reader',
    uid: '10123',
    firstInstallTime: '2026-09-10',
    apkSha256: 'fixture-apk'
  };
  let stopped = false;
  const modes = new Map([
    ['files/SQLite/reader-data.db', '600'],
    ['databases/AsyncStorage', '660']
  ]);
  const device = {
    stop: () => {
      stopped = true;
    },
    identity: () => ({ ...identity }),
    read: (file: string) => (existsSync(path.join(remote, file)) ? readFileSync(path.join(remote, file)) : null),
    mode: (file: string) => (existsSync(path.join(remote, file)) ? modes.get(file) || '600' : null),
    write: (file: string, bytes: Buffer, mode?: string) => {
      expect(stopped).toBe(true);
      writeFileSync(path.join(remote, file), bytes);
      // A pushed staging file otherwise carries the transport's permissions.
      modes.set(file, mode ?? '666');
    },
    remove: (file: string) => {
      expect(stopped).toBe(true);
      rmSync(path.join(remote, file), { force: true });
      modes.delete(file);
    }
  };
  return {
    directory: path.join(root, 'checkpoint'),
    remote,
    device,
    identity,
    modes,
    start: () => {
      stopped = false;
    }
  };
}

describe('isolated device proof checkpoint', () => {
  it.each([false, true])(
    'restores the poll journal and its sidecars, including an absent baseline: exists=%s',
    async (exists) => {
      const context = fixture();
      const file = 'files/SQLite/composer-journal.db';
      if (exists) {
        const journal = new DatabaseSync(path.join(context.remote, file));
        journal.exec(
          "CREATE TABLE nodeseek_poll_journal(identity_key, local_id, fingerprint, remote_id); CREATE TABLE nodeseek_poll_migration(identity_key, status); INSERT INTO nodeseek_poll_journal VALUES('nodeseek:original', 'original', 'original', '7'); INSERT INTO nodeseek_poll_migration VALUES('nodeseek:original', 'ready'); PRAGMA user_version=1;"
        );
        journal.close();
      }
      const original = context.device.read(file);
      await expect(
        withProofCheckpoint({
          ...context,
          run: async () => {
            context.start();
            writeFileSync(path.join(context.remote, file), 'fixture journal');
            writeFileSync(path.join(context.remote, `${file}-wal`), 'fixture WAL');
            writeFileSync(path.join(context.remote, `${file}-shm`), 'fixture SHM');
            throw new Error('business failed');
          }
        })
      ).rejects.toThrow('business failed');
      expect(context.device.read(file)).toEqual(original);
      expect(context.device.read(`${file}-wal`)).toBeNull();
      expect(context.device.read(`${file}-shm`)).toBeNull();
    }
  );
  it('keeps transfer and remote cleanup failures while always removing local scratch', () => {
    const transfer = new Error('transfer failed');
    const cleanup = new Error('remote cleanup failed');
    let scratch = '';
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes('push')) {
        scratch = path.dirname(args[3]);
        directories.push(scratch);
        throw transfer;
      }
      if (args?.includes('rm')) throw cleanup;
      return args?.includes('getprop') ? '35\n' : 'WZ_ReaderStorage_API35_20260910\n';
    });
    try {
      const device = proofDeviceForSerial('emulator-fixture');
      let failure: unknown;
      try {
        device.write('files/SQLite/reader-data.db', Buffer.from('original'), '600');
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([transfer, cleanup]);
      expect(scratch).not.toBe('');
      expect(existsSync(scratch)).toBe(false);
    } finally {
      vi.mocked(execFileSync).mockReset();
    }
  });

  it.each([false, true])(
    'sets and verifies staged permissions before replacing the database: mismatch=%s',
    (mismatch) => {
      const bytes = Buffer.from('original');
      vi.mocked(execFileSync).mockImplementation((_command, args) => {
        if (args?.includes('getprop')) return '35\n';
        if (args?.includes('emu')) return 'WZ_ReaderStorage_API35_20260910\n';
        if (args?.includes('cat')) return bytes;
        if (args?.includes('stat')) return mismatch ? '666\n' : '600\n';
        return '';
      });
      try {
        const device = proofDeviceForSerial('emulator-fixture');
        const write = () => device.write('files/SQLite/reader-data.db', bytes, '600');
        if (mismatch) expect(write).toThrow('staged file mode');
        else expect(write).not.toThrow();
        const operations = vi.mocked(execFileSync).mock.calls.map(([, args]) => args?.slice(2).join(' '));
        expect(operations).toContain(
          'shell run-as com.wz.reader chmod 600 files/SQLite/reader-data.db.wz-proof-restore'
        );
        const stat = operations.indexOf(
          'shell run-as com.wz.reader stat -c %a files/SQLite/reader-data.db.wz-proof-restore'
        );
        const move = operations.indexOf(
          'shell run-as com.wz.reader mv files/SQLite/reader-data.db.wz-proof-restore files/SQLite/reader-data.db'
        );
        if (mismatch) expect(move).toBe(-1);
        else expect(move).toBeGreaterThan(stat);
      } finally {
        vi.mocked(execFileSync).mockReset();
      }
    }
  );

  it.each([
    'none',
    'missing',
    'symlink',
    'other',
    'invalid',
    'predicate-transport',
    'bad-predicate',
    'stat-transport'
  ] as const)('distinguishes an absent mode from unsafe or failed reads: %s', (failure) => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes('getprop')) return '35\n';
      if (args?.includes('emu')) return 'WZ_ReaderStorage_API35_20260910\n';
      if (args?.includes('exec-out') && args.includes('sh')) {
        if (failure === 'predicate-transport') throw Object.assign(new Error('device offline'), { status: 1 });
        if (failure === 'bad-predicate') return 'run-as failed';
        return ['missing', 'symlink', 'other'].includes(failure) ? failure : 'regular';
      }
      if (args?.includes('stat')) {
        if (failure === 'stat-transport') throw Object.assign(new Error('stat transport failed'), { status: 1 });
        if (failure === 'none') return '600\n';
        return '0600\n';
      }
      return '';
    });
    try {
      const device = proofDeviceForSerial('emulator-fixture');
      if (failure === 'missing') expect(device.mode('files/SQLite/reader-data.db')).toBeNull();
      else if (failure === 'none') expect(device.mode('files/SQLite/reader-data.db')).toBe('600');
      else expect(() => device.mode('files/SQLite/reader-data.db')).toThrow();
      if (failure === 'symlink') expect(() => device.read('files/SQLite/reader-data.db')).toThrow('symbolic link');
    } finally {
      vi.mocked(execFileSync).mockReset();
    }
  });

  it.each([30, 35])('restores the original database bytes and modes after a business failure on API%s', async (api) => {
    const context = fixture();
    context.identity.avd = `WZ_ReaderStorage_API${api}_20260910`;
    const original = context.device.read('files/SQLite/reader-data.db');
    await expect(
      withProofCheckpoint({
        ...context,
        run: async () => {
          context.start();
          writeFileSync(path.join(context.remote, 'files/SQLite/reader-data.db'), 'broken fixture');
          throw new Error('business failed');
        }
      })
    ).rejects.toThrow('business failed');
    expect(context.device.read('files/SQLite/reader-data.db')?.equals(original!)).toBe(true);
    expect(context.device.mode('files/SQLite/reader-data.db')).toBe('600');
    expect(context.device.mode('databases/AsyncStorage')).toBe('660');
    expect(context.device.mode('files/SQLite/reader-data.db-wal')).toBeNull();
  });

  it.each([
    { api: undefined, avd: 'WZ_ReaderStorage_API35_20260910', sdk: 35, accepted: true },
    { api: 30, avd: 'WZ_ReaderStorage_API30_20260910', sdk: 30, accepted: true },
    { api: undefined, avd: 'WZ_ReaderStorage_API30_20260910', sdk: 30, accepted: false },
    { api: 30, avd: 'WZ_ReaderStorage_API30_20260910', sdk: 35, accepted: false },
    { api: 35, avd: 'WZ_Pixel_API_35', sdk: 35, accepted: false },
    { api: 31, avd: 'WZ_ReaderStorage_API31_20260910', sdk: 31, accepted: false }
  ])('requires the exact isolated AVD and actual SDK: $avd/$sdk (requested $api)', ({ api, avd, sdk, accepted }) => {
    vi.mocked(execFileSync).mockImplementation((_command, args) =>
      args?.includes('getprop') ? String(sdk) : `${avd}\nOK\n`
    );
    try {
      if (accepted) expect(proofDeviceForSerial('emulator-fixture', api).avd).toBe(avd);
      else expect(() => proofDeviceForSerial('emulator-fixture', api)).toThrow();
    } finally {
      vi.mocked(execFileSync).mockReset();
    }
  });

  it('restores all storage keys and removes only sidecars created by this run', async () => {
    const context = fixture();
    const storageBefore = context.device.read('databases/AsyncStorage')!;
    writeFileSync(path.join(context.remote, 'unrelated'), 'keep');
    const result = await withProofCheckpoint({
      ...context,
      run: async () => {
        context.start();
        const storage = new DatabaseSync(path.join(context.remote, 'databases/AsyncStorage'));
        storage.exec("UPDATE Storage SET value='changed' WHERE key='notifications'");
        storage.close();
        writeFileSync(path.join(context.remote, 'files/SQLite/reader-data.db-wal'), 'created during proof');
        return 'business passed';
      }
    });
    expect(result.result).toBe('business passed');
    expect(result.checkpoint).toMatchObject({ phase: 'restored' });
    expect(context.device.read('databases/AsyncStorage')?.equals(storageBefore)).toBe(true);
    expect(context.device.read('files/SQLite/reader-data.db-wal')).toBeNull();
    expect(readFileSync(path.join(context.remote, 'unrelated'), 'utf8')).toBe('keep');
  });

  it.each(['owner', 'identity', 'backup'] as const)(
    'refuses business writes when %s validation fails',
    async (failure) => {
      const context = fixture();
      if (failure === 'owner') {
        const storage = new DatabaseSync(path.join(context.remote, 'databases/AsyncStorage'));
        storage.exec("DELETE FROM Storage WHERE key='reader-storage-proof-owner'");
        storage.close();
      }
      if (failure === 'identity') context.identity.avd = 'WZ_Pixel_API_35';
      if (failure === 'backup') {
        mkdirSync(context.directory, { recursive: true });
        writeFileSync(path.join(context.directory, 'baseline'), 'not a directory');
      }
      let writes = 0;
      await expect(
        withProofCheckpoint({
          ...context,
          run: async () => {
            writes++;
          }
        })
      ).rejects.toThrow();
      expect(writes).toBe(0);
    }
  );

  it('rejects concurrent runners without disturbing the owner', async () => {
    const context = fixture();
    const pending = Promise.withResolvers<void>();
    let entered = false;
    const first = withProofCheckpoint({
      ...context,
      run: async () => {
        entered = true;
        await pending.promise;
      }
    });
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      await expect(
        withProofCheckpoint({
          ...context,
          run: async () => {
            throw new Error('must not run');
          }
        })
      ).rejects.toThrow('locked');
    } finally {
      pending.resolve();
      await first;
    }
  });

  it.each(['none', 'bytes', 'mode'] as const)(
    'resumes a partial restore only without later byte or mode changes: conflict=%s',
    async (conflict) => {
      const context = fixture();
      const write = context.device.write;
      let count = 0;
      context.device.write = (file, bytes, mode) => {
        if (++count === 2) throw new Error('restore interrupted');
        write(file, bytes, mode);
      };
      await expect(
        withProofCheckpoint({
          ...context,
          run: async () => {
            writeFileSync(path.join(context.remote, 'files/SQLite/reader-data.db'), 'changed reader');
            writeFileSync(path.join(context.remote, 'databases/AsyncStorage'), 'changed storage');
            throw new Error('business failed');
          }
        })
      ).rejects.toMatchObject({
        errors: [
          expect.objectContaining({ message: 'business failed' }),
          expect.objectContaining({ message: 'restore interrupted' })
        ]
      });
      await expect(withProofCheckpoint({ ...context, run: async () => undefined })).rejects.toThrow(
        'Pending checkpoint'
      );
      context.device.write = write;
      if (conflict !== 'none') {
        if (conflict === 'bytes')
          writeFileSync(path.join(context.remote, 'databases/AsyncStorage'), 'later manual data');
        else context.modes.set('databases/AsyncStorage', '640');
        const before = context.device.read('databases/AsyncStorage');
        const mode = context.device.mode('databases/AsyncStorage');
        await expect(resumeProofCheckpoint(context)).rejects.toThrow('conflict');
        expect(context.device.read('databases/AsyncStorage')).toEqual(before);
        expect(context.device.mode('databases/AsyncStorage')).toBe(mode);
      } else {
        expect((await resumeProofCheckpoint(context)).phase).toBe('restored');
        expect(context.device.mode('files/SQLite/reader-data.db')).toBe('600');
        expect(context.device.mode('databases/AsyncStorage')).toBe('660');
      }
    }
  );

  it('blocks a prior running checkpoint instead of overwriting later data', async () => {
    const context = fixture();
    await withProofCheckpoint({ ...context, run: async () => undefined });
    const file = path.join(context.directory, 'checkpoint.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...manifest, phase: 'running' }));
    await expect(withProofCheckpoint({ ...context, run: async () => undefined })).rejects.toThrow('Pending checkpoint');
    await expect(resumeProofCheckpoint(context)).rejects.toThrow('Only an interrupted restoring');
  });

  it.each(['legacy', 'missing-baseline', 'missing-current', 'absent-file', 'invalid-mode', 'mixed-state'] as const)(
    'refuses an unrecorded permission state before any restore writes: %s',
    async (failure) => {
      const context = fixture();
      const file = 'files/SQLite/reader-data.db';
      const write = context.device.write;
      context.device.write = () => {
        throw new Error('restore interrupted');
      };
      await expect(
        withProofCheckpoint({
          ...context,
          run: async () => {
            writeFileSync(path.join(context.remote, file), 'changed reader');
            context.modes.set(file, '660');
          }
        })
      ).rejects.toThrow('restore interrupted');
      context.device.write = write;
      const manifestPath = path.join(context.directory, 'checkpoint.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (failure === 'legacy') {
        manifest.version = 1;
        delete manifest.baselineModes;
        delete manifest.restoreFromModes;
      }
      if (failure === 'missing-baseline') delete manifest.baselineModes[file];
      if (failure === 'missing-current') delete manifest.restoreFromModes[file];
      if (failure === 'absent-file') manifest.baselineModes[`${file}-wal`] = '600';
      if (failure === 'invalid-mode') manifest.baselineModes[file] = '0600';
      if (failure === 'mixed-state') context.modes.set(file, '600');
      writeFileSync(manifestPath, JSON.stringify(manifest));
      const writes = vi.spyOn(context.device, 'write');
      const removals = vi.spyOn(context.device, 'remove');
      const stopped = vi.spyOn(context.device, 'stop');
      const originalBytes = context.device.read(file);
      const originalMode = context.device.mode(file);
      await expect(resumeProofCheckpoint(context)).rejects.toThrow(failure === 'mixed-state' ? 'conflict' : 'modes');
      expect(writes).not.toHaveBeenCalled();
      expect(removals).not.toHaveBeenCalled();
      if (failure !== 'mixed-state') expect(stopped).not.toHaveBeenCalled();
      expect(context.device.read(file)).toEqual(originalBytes);
      expect(context.device.mode(file)).toBe(originalMode);
    }
  );

  it('starts a new checkpoint after an already restored legacy checkpoint', async () => {
    const context = fixture();
    await withProofCheckpoint({ ...context, run: async () => undefined });
    const file = path.join(context.directory, 'checkpoint.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(
      file,
      JSON.stringify({ ...manifest, version: 1, baselineModes: undefined, restoreFromModes: undefined })
    );
    await expect(withProofCheckpoint({ ...context, run: async () => 'new acceptance' })).resolves.toMatchObject({
      result: 'new acceptance',
      checkpoint: { phase: 'restored' }
    });
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2);
  });

  it('freezes restore writes if installation identity changes', async () => {
    const context = fixture();
    const original = context.device.write;
    let writes = 0;
    context.device.write = (file, bytes, mode) => {
      writes++;
      original(file, bytes, mode);
    };
    await expect(
      withProofCheckpoint({
        ...context,
        run: async () => {
          context.identity.uid = 'new-install';
        }
      })
    ).rejects.toThrow('identity');
    expect(writes).toBe(0);
  });
  it('stops again after installation and verifies the backup before business writes', async () => {
    const context = fixture();
    let stops = 0;
    const stop = context.device.stop;
    context.device.stop = () => {
      stops++;
      stop();
    };
    await withProofCheckpoint({
      ...context,
      prepare: async () => {
        context.start();
        context.identity.apkSha256 = 'new-build';
      },
      run: async () => {
        expect(stops).toBe(2);
      }
    });
  });

  it.each(['corrupt-backup', 'false-write-acknowledgement', 'false-mode-acknowledgement'])(
    'rejects unsafe restore evidence: %s',
    async (failure) => {
      const context = fixture();
      let writes = 0;
      const write = context.device.write;
      context.device.write = (file, bytes, mode) => {
        writes++;
        if (failure !== 'false-write-acknowledgement')
          write(file, bytes, failure === 'false-mode-acknowledgement' ? undefined : mode);
      };
      await expect(
        withProofCheckpoint({
          ...context,
          run: async () => {
            writeFileSync(path.join(context.remote, 'files/SQLite/reader-data.db'), 'business changes');
            if (failure === 'corrupt-backup')
              writeFileSync(path.join(context.directory, 'baseline/files/SQLite/reader-data.db'), 'corrupted backup');
          }
        })
      ).rejects.toThrow(failure === 'corrupt-backup' ? 'checksum' : 'readback');
      if (failure === 'corrupt-backup') expect(writes).toBe(0);
      await expect(withProofCheckpoint({ ...context, run: async () => undefined })).rejects.toThrow(
        'Pending checkpoint'
      );
    }
  );
  it('releases the OS lease after a killed owner while preserving the pending checkpoint rule', async () => {
    const context = fixture();
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { createServer } from 'node:net'; const server = createServer(); server.listen({host:'127.0.0.1', port:42187, exclusive:true}, () => process.send('ready'));"
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
    );
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`Lease child exited before readiness: ${code}`)));
      });
      await expect(withProofCheckpoint({ ...context, run: async () => undefined })).rejects.toThrow('locked');
    } finally {
      child.kill('SIGKILL');
      await closed;
    }
    await withProofCheckpoint({ ...context, run: async () => undefined });
  });
});
