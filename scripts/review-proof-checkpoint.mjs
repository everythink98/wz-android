import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

export const PROOF_DATABASE_FILES = ['files/SQLite/reader-data.db', 'databases/AsyncStorage'].flatMap((file) => [
  file,
  `${file}-wal`,
  `${file}-shm`
]);

const hash = (bytes) => (bytes === null ? null : createHash('sha256').update(bytes).digest('hex'));
const manifestPath = (directory) => path.join(directory, 'checkpoint.json');
const readManifest = (directory) => JSON.parse(readFileSync(manifestPath(directory), 'utf8'));
function saveManifest(directory, manifest) {
  const target = manifestPath(directory);
  writeFileSync(`${target}.tmp`, JSON.stringify(manifest, null, 2));
  renameSync(`${target}.tmp`, target);
}
function readFiles(device) {
  return Object.fromEntries(PROOF_DATABASE_FILES.map((file) => [file, device.read(file)]));
}
function hashes(files) {
  return Object.fromEntries(PROOF_DATABASE_FILES.map((file) => [file, hash(files[file])]));
}
function assertIdentity(actual, expected) {
  if (
    actual.avd !== 'WZ_ReaderStorage_API35_20260910' ||
    actual.package !== 'com.wz.reader' ||
    !actual.uid ||
    !actual.firstInstallTime ||
    !actual.apkSha256 ||
    (expected && !isDeepStrictEqual(actual, expected))
  )
    throw new Error('Proof installation identity changed or is not isolated');
}

async function acquireLease(directory) {
  mkdirSync(directory, { recursive: true });
  // One dedicated AVD: an OS-owned lease also releases after a killed runner.
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', (cause) => reject(new Error('Checkpoint runner is locked (local port 42187)', { cause })));
    server.listen({ host: '127.0.0.1', port: 42187, exclusive: true }, resolve);
  });
  return () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function logicalSnapshot(directory, files) {
  const scratch = mkdtempSync(path.join(directory, 'readback-'));
  try {
    for (const file of PROOF_DATABASE_FILES) {
      if (files[file] === null) continue;
      const target = path.join(scratch, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, files[file]);
    }
    const reader = new DatabaseSync(path.join(scratch, PROOF_DATABASE_FILES[0]), { readOnly: true });
    let tables;
    try {
      tables = [
        reader.prepare('SELECT * FROM reader_meta ORDER BY id').all(),
        reader.prepare('SELECT * FROM reader_counts ORDER BY kind').all(),
        reader.prepare('SELECT * FROM reader_records ORDER BY kind, key').all(),
        reader.prepare('SELECT * FROM reader_deleted ORDER BY kind, key').all()
      ];
    } finally {
      reader.close();
    }
    const storage = new DatabaseSync(path.join(scratch, 'databases/AsyncStorage'), { readOnly: true });
    try {
      const entries = storage.prepare('SELECT key, value FROM Storage ORDER BY key').all();
      if (entries.find((entry) => entry.key === 'reader-storage-proof-owner')?.value !== 'isolated') {
        throw new Error('Refusing data without the isolated fixture owner');
      }
      return hash(Buffer.from(JSON.stringify({ tables, entries })));
    } finally {
      storage.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function restore(directory, device, manifest) {
  if (
    manifest.version !== 1 ||
    manifest.phase !== 'restoring' ||
    !isDeepStrictEqual(Object.keys(manifest.baseline).sort(), [...PROOF_DATABASE_FILES].sort())
  ) {
    throw new Error('Invalid or non-resumable checkpoint');
  }
  assertIdentity(device.identity(), manifest.identity);
  device.stop();
  assertIdentity(device.identity(), manifest.identity);
  const current = hashes(readFiles(device));
  const originals = {};
  for (const file of PROOF_DATABASE_FILES) {
    if (current[file] !== manifest.baseline[file] && current[file] !== manifest.restoreFrom[file]) {
      throw new Error(`Checkpoint conflict; refusing to overwrite ${file}`);
    }
    originals[file] = manifest.baseline[file] === null ? null : readFileSync(path.join(directory, 'baseline', file));
    if (hash(originals[file]) !== manifest.baseline[file])
      throw new Error(`Checkpoint backup checksum failed: ${file}`);
  }
  for (const file of PROOF_DATABASE_FILES) {
    if (originals[file] === null) device.remove(file);
    else device.write(file, originals[file]);
  }
  const restored = readFiles(device);
  if (
    !isDeepStrictEqual(hashes(restored), manifest.baseline) ||
    logicalSnapshot(directory, restored) !== manifest.logicalHash
  )
    throw new Error('Checkpoint readback differs from baseline');
  manifest.phase = 'restored';
  saveManifest(directory, manifest);
  return { phase: 'restored', logicalHash: manifest.logicalHash, token: manifest.token };
}

export async function resumeProofCheckpoint({ directory, device }) {
  const release = await acquireLease(directory);
  try {
    const manifest = readManifest(directory);
    if (manifest.phase !== 'restoring') throw new Error('Only an interrupted restoring checkpoint can resume');
    return restore(directory, device, manifest);
  } finally {
    await release();
  }
}

export async function withProofCheckpoint({ directory, device, prepare = () => {}, run }) {
  const release = await acquireLease(directory);
  try {
    if (existsSync(manifestPath(directory)) && readManifest(directory).phase !== 'restored') {
      throw new Error('Pending checkpoint blocks new acceptance; preserve it for inspection');
    }
    const previousIdentity = device.identity();
    assertIdentity(previousIdentity);
    device.stop();
    if (prepare) await prepare();
    device.stop();
    const identity = device.identity();
    assertIdentity(identity, { ...previousIdentity, apkSha256: identity.apkSha256 });
    assertIdentity(device.identity(), identity);
    const originals = readFiles(device);
    const logicalHash = logicalSnapshot(directory, originals);
    const manifest = {
      version: 1,
      token: randomUUID(),
      identity,
      phase: 'running',
      baseline: hashes(originals),
      logicalHash
    };
    for (const file of PROOF_DATABASE_FILES) {
      if (originals[file] === null) continue;
      const target = path.join(directory, 'baseline', file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, originals[file]);
      if (hash(readFileSync(target)) !== manifest.baseline[file])
        throw new Error('Checkpoint backup verification failed');
    }
    saveManifest(directory, manifest);
    let result;
    let businessError;
    let cleanupError;
    let checkpoint;
    try {
      result = await run();
    } catch (error) {
      businessError = error;
    }
    try {
      assertIdentity(device.identity(), identity);
      device.stop();
      assertIdentity(device.identity(), identity);
      manifest.restoreFrom = hashes(readFiles(device));
      manifest.phase = 'restoring';
      saveManifest(directory, manifest);
      checkpoint = restore(directory, device, manifest);
    } catch (error) {
      cleanupError = error;
    }
    if (businessError || cleanupError) {
      const error =
        businessError && cleanupError
          ? new AggregateError([businessError, cleanupError], 'Device proof and checkpoint restoration both failed')
          : businessError || cleanupError;
      error.checkpoint = checkpoint || { phase: manifest.phase };
      throw error;
    }
    return { result, checkpoint };
  } finally {
    await release();
  }
}

// ADB transport is shared by storage acceptance and the deterministic Gallery runner.
export function proofDeviceForSerial(serial) {
  const adb = (...args) =>
    execFileSync('adb', ['-s', serial, ...args], {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  const pkg = 'com.wz.reader';
  const avd = adb('emu', 'avd', 'name').split(/\r?\n/u)[0].trim();
  if (avd !== 'WZ_ReaderStorage_API35_20260910') throw new Error(`Refusing non-isolated AVD ${avd}`);
  const fixedFile = (file) => {
    if (!PROOF_DATABASE_FILES.includes(file)) throw new Error('Not a checkpoint database file');
    return file;
  };
  return {
    adb,
    avd,
    package: pkg,
    identity: () => {
      const installed = adb('shell', 'pm', 'path', pkg).trim().split(/\r?\n/u)[0]?.replace('package:', '');
      if (!installed?.startsWith('/data/app/')) throw new Error('Missing installed APK');
      return {
        avd: adb('emu', 'avd', 'name').split(/\r?\n/u)[0].trim(),
        package: pkg,
        uid: adb('shell', 'run-as', pkg, 'id', '-u').trim(),
        firstInstallTime: /firstInstallTime=([^\r\n]+)/u.exec(adb('shell', 'dumpsys', 'package', pkg))?.[1]?.trim(),
        apkSha256: adb('shell', 'sha256sum', installed).trim().split(/\s/u)[0]
      };
    },
    stop: () => {
      adb('shell', 'am', 'force-stop', pkg);
      if (
        adb('shell', 'ps', '-A', '-o', 'NAME')
          .split(/\r?\n/u)
          .some((name) => name.trim() === pkg || name.trim().startsWith(`${pkg}:`))
      )
        throw new Error('App is still running; checkpoint writes refused');
    },
    read: (file) => {
      fixedFile(file);
      try {
        adb('shell', 'run-as', pkg, 'test', '-f', file);
      } catch (error) {
        if (error.status === 1) return null;
        throw error;
      }
      return execFileSync('adb', ['-s', serial, 'exec-out', 'run-as', pkg, 'cat', file], {
        timeout: 60000,
        maxBuffer: 128 * 1024 * 1024
      });
    },
    write: (file, bytes) => {
      fixedFile(file);
      const scratch = mkdtempSync(path.join(os.tmpdir(), 'wz-checkpoint-write-'));
      const source = path.join(scratch, 'data');
      const remote = `/data/local/tmp/wz-checkpoint-${randomUUID()}`;
      const errors = [];
      try {
        writeFileSync(source, bytes);
        adb('push', source, remote);
        adb('shell', 'run-as', pkg, 'cp', remote, `${file}.wz-proof-restore`);
      } catch (error) {
        errors.push(error);
      }
      try {
        adb('shell', 'rm', '-f', remote);
      } catch (error) {
        errors.push(error);
      }
      try {
        rmSync(scratch, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Checkpoint transfer and cleanup failed');
      const staged = execFileSync('adb', ['-s', serial, 'exec-out', 'run-as', pkg, 'cat', `${file}.wz-proof-restore`], {
        timeout: 60000,
        maxBuffer: 128 * 1024 * 1024
      });
      if (!staged.equals(bytes)) throw new Error('Checkpoint transport checksum failed');
      adb('shell', 'run-as', pkg, 'mv', `${file}.wz-proof-restore`, file);
    },
    remove: (file) => adb('shell', 'run-as', pkg, 'rm', '-f', fixedFile(file))
  };
}
