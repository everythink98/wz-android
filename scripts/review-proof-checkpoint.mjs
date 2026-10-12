import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

export const PROOF_DATABASE_FILES = [
  'files/SQLite/reader-data.db',
  'databases/AsyncStorage',
  'files/SQLite/composer-journal.db'
].flatMap((file) => [file, `${file}-wal`, `${file}-shm`]);

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
const validMode = (mode) => typeof mode === 'string' && /^(?:0|[1-7][0-7]{0,3})$/u.test(mode);
function validFileModes(fileHashes, modes) {
  const keys = [...PROOF_DATABASE_FILES].sort();
  return (
    isDeepStrictEqual(Object.keys(fileHashes || {}).sort(), keys) &&
    isDeepStrictEqual(Object.keys(modes || {}).sort(), keys) &&
    PROOF_DATABASE_FILES.every((file) =>
      fileHashes[file] === null
        ? modes[file] === null
        : /^[a-f0-9]{64}$/u.test(fileHashes[file]) && validMode(modes[file])
    )
  );
}
function readModes(device, files) {
  const modes = Object.fromEntries(PROOF_DATABASE_FILES.map((file) => [file, device.mode(file)]));
  if (!validFileModes(hashes(files), modes)) throw new Error('Checkpoint file modes are missing or invalid');
  return modes;
}
function assertIdentity(actual, expected) {
  if (
    !/^WZ_ReaderStorage_API(?:30|35)_20260910$/u.test(actual.avd) ||
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
      let journal = null;
      if (files['files/SQLite/composer-journal.db'] !== null) {
        const composer = new DatabaseSync(path.join(scratch, 'files/SQLite/composer-journal.db'), { readOnly: true });
        try {
          journal = {
            version: composer.prepare('PRAGMA user_version').get(),
            polls: composer
              .prepare('SELECT * FROM nodeseek_poll_journal ORDER BY identity_key, local_id, fingerprint')
              .all(),
            migrations: composer.prepare('SELECT * FROM nodeseek_poll_migration ORDER BY identity_key').all()
          };
        } finally {
          composer.close();
        }
      }
      return hash(Buffer.from(JSON.stringify({ tables, entries, journal })));
    } finally {
      storage.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function restore(directory, device, manifest) {
  if (
    manifest.version !== 2 ||
    manifest.phase !== 'restoring' ||
    !validFileModes(manifest.baseline, manifest.baselineModes) ||
    !validFileModes(manifest.restoreFrom, manifest.restoreFromModes)
  ) {
    throw new Error('Invalid or non-resumable checkpoint; recorded file modes are required');
  }
  assertIdentity(device.identity(), manifest.identity);
  device.stop();
  assertIdentity(device.identity(), manifest.identity);
  const currentFiles = readFiles(device);
  const current = hashes(currentFiles);
  const currentModes = readModes(device, currentFiles);
  const originals = {};
  for (const file of PROOF_DATABASE_FILES) {
    if (
      !(current[file] === manifest.baseline[file] && currentModes[file] === manifest.baselineModes[file]) &&
      !(current[file] === manifest.restoreFrom[file] && currentModes[file] === manifest.restoreFromModes[file])
    ) {
      throw new Error(`Checkpoint conflict; refusing to overwrite ${file}`);
    }
    originals[file] = manifest.baseline[file] === null ? null : readFileSync(path.join(directory, 'baseline', file));
    if (hash(originals[file]) !== manifest.baseline[file])
      throw new Error(`Checkpoint backup checksum failed: ${file}`);
  }
  for (const file of PROOF_DATABASE_FILES) {
    if (originals[file] === null) device.remove(file);
    else device.write(file, originals[file], manifest.baselineModes[file]);
  }
  const restored = readFiles(device);
  if (
    !isDeepStrictEqual(hashes(restored), manifest.baseline) ||
    !isDeepStrictEqual(readModes(device, restored), manifest.baselineModes) ||
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
    const baselineModes = readModes(device, originals);
    const logicalHash = logicalSnapshot(directory, originals);
    const manifest = {
      version: 2,
      token: randomUUID(),
      identity,
      phase: 'running',
      baseline: hashes(originals),
      baselineModes,
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
      const restoreFromFiles = readFiles(device);
      manifest.restoreFrom = hashes(restoreFromFiles);
      manifest.restoreFromModes = readModes(device, restoreFromFiles);
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
export function proofDeviceForSerial(serial, api = 35) {
  const adb = (...args) =>
    execFileSync('adb', ['-s', serial, ...args], {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  const pkg = 'com.wz.reader';
  const environment = () => {
    const avd = adb('emu', 'avd', 'name').split(/\r?\n/u)[0].trim();
    if (
      ![30, 35].includes(api) ||
      avd !== `WZ_ReaderStorage_API${api}_20260910` ||
      adb('shell', 'getprop', 'ro.build.version.sdk').trim() !== String(api)
    )
      throw new Error(`Refusing non-isolated AVD or mismatched SDK: ${avd}`);
    return avd;
  };
  const avd = environment();
  const fixedFile = (file) => {
    if (!PROOF_DATABASE_FILES.includes(file)) throw new Error('Not a checkpoint database file');
    return file;
  };
  const fileExists = (file) => {
    fixedFile(file);
    const kind = adb(
      'exec-out',
      'run-as',
      pkg,
      'sh',
      '-c',
      `if test -L '${file}'; then echo symlink; elif test -f '${file}'; then echo regular; elif test -e '${file}'; then echo other; else echo missing; fi`
    ).trim();
    if (kind === 'symlink') throw new Error('Refusing a checkpoint symbolic link');
    if (kind === 'regular') return true;
    if (kind === 'missing') return false;
    throw new Error('Checkpoint file type could not be verified');
  };
  return {
    adb,
    avd,
    package: pkg,
    identity: () => {
      environment();
      const installed = adb('shell', 'pm', 'path', pkg).trim().split(/\r?\n/u)[0]?.replace('package:', '');
      if (!/^\/data\/app\/[^\s]+\/base\.apk$/u.test(installed)) throw new Error('Missing installed APK');
      const dump = adb('shell', 'dumpsys', 'package', pkg);
      const uid = adb('shell', 'run-as', pkg, 'id', '-u').trim();
      const packageUid = /^\s*(?:appId|userId)=(\d+)\b/mu.exec(dump)?.[1];
      const firstInstallTime = /firstInstallTime=([^\r\n]+)/u.exec(dump)?.[1]?.trim();
      const user = /^\s*User 0:([^\r\n]*)/mu.exec(dump)?.[1] || '';
      const apkSha256 = adb('shell', 'sha256sum', installed).trim().split(/\s/u)[0];
      const activity = adb(
        'shell',
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.LAUNCHER',
        pkg
      );
      if (
        !/^\d+$/u.test(uid) ||
        uid !== packageUid ||
        !firstInstallTime ||
        !/\binstalled=true\b/u.test(user) ||
        /\b(?:hidden|suspended)=true\b/u.test(user) ||
        !/^[a-f0-9]{64}$/u.test(apkSha256) ||
        !/^com\.wz\.reader\/(?:\.|com\.wz\.reader\.)MainActivity\s*$/mu.test(activity)
      )
        throw new Error('Incomplete installed proof identity or missing MainActivity; device changes frozen');
      return {
        avd,
        package: pkg,
        uid,
        firstInstallTime,
        apkSha256
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
      if (!fileExists(file)) return null;
      return execFileSync('adb', ['-s', serial, 'exec-out', 'run-as', pkg, 'cat', file], {
        timeout: 60000,
        maxBuffer: 128 * 1024 * 1024
      });
    },
    mode: (file) => {
      if (!fileExists(file)) return null;
      const mode = adb('shell', 'run-as', pkg, 'stat', '-c', '%a', file).trim();
      if (!validMode(mode)) throw new Error('Invalid checkpoint file mode');
      return mode;
    },
    write: (file, bytes, mode) => {
      fixedFile(file);
      if (!validMode(mode)) throw new Error('Invalid checkpoint file mode');
      const scratch = mkdtempSync(path.join(os.tmpdir(), 'wz-checkpoint-write-'));
      const source = path.join(scratch, 'data');
      const remote = `/data/local/tmp/wz-checkpoint-${randomUUID()}`;
      const errors = [];
      try {
        writeFileSync(source, bytes);
        adb('push', source, remote);
        adb('shell', 'run-as', pkg, 'cp', remote, `${file}.wz-proof-restore`);
        adb('shell', 'run-as', pkg, 'chmod', mode, `${file}.wz-proof-restore`);
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
      if (adb('shell', 'run-as', pkg, 'stat', '-c', '%a', `${file}.wz-proof-restore`).trim() !== mode)
        throw new Error('Checkpoint staged file mode differs from baseline');
      adb('shell', 'run-as', pkg, 'mv', `${file}.wz-proof-restore`, file);
    },
    remove: (file) => adb('shell', 'run-as', pkg, 'rm', '-f', fixedFile(file))
  };
}
