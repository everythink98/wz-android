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
  const device = {
    stop: () => {
      stopped = true;
    },
    identity: () => ({ ...identity }),
    read: (file: string) => (existsSync(path.join(remote, file)) ? readFileSync(path.join(remote, file)) : null),
    write: (file: string, bytes: Buffer) => {
      expect(stopped).toBe(true);
      writeFileSync(path.join(remote, file), bytes);
    },
    remove: (file: string) => {
      expect(stopped).toBe(true);
      rmSync(path.join(remote, file), { force: true });
    }
  };
  return {
    directory: path.join(root, 'checkpoint'),
    remote,
    device,
    identity,
    start: () => {
      stopped = false;
    }
  };
}

describe('isolated device proof checkpoint', () => {
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
      return 'WZ_ReaderStorage_API35_20260910\n';
    });
    try {
      const device = proofDeviceForSerial('emulator-fixture');
      let failure: unknown;
      try {
        device.write('files/SQLite/reader-data.db', Buffer.from('original'));
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

  it('restores the original database bytes after a business failure', async () => {
    const context = fixture();
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

  it.each([false, true])('resumes a partial restore only without later changes: conflict=%s', async (conflict) => {
    const context = fixture();
    const write = context.device.write;
    let count = 0;
    context.device.write = (file, bytes) => {
      if (++count === 2) throw new Error('restore interrupted');
      write(file, bytes);
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
    await expect(withProofCheckpoint({ ...context, run: async () => undefined })).rejects.toThrow('Pending checkpoint');
    context.device.write = write;
    if (conflict) {
      writeFileSync(path.join(context.remote, 'databases/AsyncStorage'), 'later manual data');
      await expect(resumeProofCheckpoint(context)).rejects.toThrow('conflict');
      expect(readFileSync(path.join(context.remote, 'databases/AsyncStorage'), 'utf8')).toBe('later manual data');
    } else {
      expect((await resumeProofCheckpoint(context)).phase).toBe('restored');
    }
  });

  it('blocks a prior running checkpoint instead of overwriting later data', async () => {
    const context = fixture();
    await withProofCheckpoint({ ...context, run: async () => undefined });
    const file = path.join(context.directory, 'checkpoint.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...manifest, phase: 'running' }));
    await expect(withProofCheckpoint({ ...context, run: async () => undefined })).rejects.toThrow('Pending checkpoint');
    await expect(resumeProofCheckpoint(context)).rejects.toThrow('Only an interrupted restoring');
  });

  it('freezes restore writes if installation identity changes', async () => {
    const context = fixture();
    const original = context.device.write;
    let writes = 0;
    context.device.write = (file, bytes) => {
      writes++;
      original(file, bytes);
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

  it.each(['corrupt-backup', 'false-write-acknowledgement'])('rejects unsafe restore evidence: %s', async (failure) => {
    const context = fixture();
    let writes = 0;
    const write = context.device.write;
    context.device.write = (file, bytes) => {
      writes++;
      if (failure !== 'false-write-acknowledgement') write(file, bytes);
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
    await expect(withProofCheckpoint({ ...context, run: async () => undefined })).rejects.toThrow('Pending checkpoint');
  });
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
