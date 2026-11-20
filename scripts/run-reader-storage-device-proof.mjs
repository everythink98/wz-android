import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { installDeviceApk } from './device-apk-install.mjs';
import { buildDeviceProof } from './device-proof-build.mjs';
import { proofDeviceForSerial } from './review-proof-checkpoint.mjs';

const { values } = parseArgs({
  options: {
    serial: { type: 'string' },
    output: { type: 'string' },
    apk: { type: 'string' },
    build: { type: 'boolean' },
    'journal-only': { type: 'boolean' },
    'sidecar-only': { type: 'boolean' },
    'seed-only': { type: 'string' }
  }
});
const option = (name) => values[name.slice(2)];
const serial = option('--serial');
const output = option('--output');
if (!serial || !output) throw new Error('--serial and --output are required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativeOutput = path.relative(path.join(root, '.codex-tmp'), path.resolve(output));
if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput) || existsSync(output))
  throw new Error('Use a new output file under .codex-tmp');
if (values.build && values.apk) throw new Error('Choose --build or --apk');
if ([values['journal-only'], values['sidecar-only'], values['seed-only']].filter(Boolean).length > 1)
  throw new Error('Choose --journal-only, --sidecar-only or --seed-only');
if (values['seed-only'] && !['ordinary', 'supported', 'large', 'overbytes'].includes(values['seed-only']))
  throw new Error('Unsupported fixture profile');
const api = Number(
  execFileSync('adb', ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
);
const device = proofDeviceForSerial(serial, api);
const { adb, package: pkg } = device;
const identity = () => device.identity();
const before = identity();
if (values.build) {
  values.apk = buildDeviceProof(root, {
    name: 'reader-storage-proof',
    entryFile: 'dev/reader-storage-proof/index.tsx',
    scheme: 'wzreaderproof'
  }).apk;
  console.log(`Proof APK: ${values.apk}`);
}
const installation = values.apk && installDeviceApk({ adb, pkg, apk: path.resolve(values.apk), expected: before });
const installedIdentity = identity();
if (!isDeepStrictEqual({ ...installedIdentity, apkSha256: before.apkSha256 }, before))
  throw new Error('Installation identity changed; device changes frozen');
if (installation && installedIdentity.apkSha256 !== installation.apkSha256)
  throw new Error('Installed proof APK checksum mismatch');
const results = [];
mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
const context = {
  ...installedIdentity,
  serial,
  api: String(api)
};
async function launch(mode, profile, checkpoint = 'passed') {
  adb('shell', 'am', 'force-stop', pkg);
  const token = randomUUID().replaceAll('-', '');
  adb(
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    `${pkg}/.MainActivity`,
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `wzreaderproof://${mode}/${profile}/${token}`
  );
  const pid = adb('shell', 'pidof', pkg).trim();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    let receipt;
    try {
      receipt = JSON.parse(adb('shell', 'run-as', pkg, 'cat', 'cache/reader-storage-proof.json'));
    } catch {}
    if (receipt?.token === token) {
      results.push({ ...receipt, pid });
      writeFileSync(output, JSON.stringify({ ...context, results }, null, 2));
      if (receipt.checkpoint !== checkpoint || receipt.isDev !== false || receipt.isHermes !== true)
        throw new Error(`Proof ${mode}/${profile} failed: ${JSON.stringify(receipt)}`);
      console.log(`${context.api} ${mode}/${profile}: ${checkpoint} (${Math.round(receipt.elapsedMs)} ms), PID ${pid}`);
      return receipt;
    }
    await delay(500);
  }
  throw new Error(`Proof ${mode}/${profile} timed out`);
}
if (values['journal-only']) {
  const exercise = await launch('poll-journal-exercise', 'ordinary');
  const reopened = await launch('poll-journal-reopen', 'ordinary');
  if (
    !exercise.processSessionId ||
    exercise.processSessionId === reopened.processSessionId ||
    exercise.buildId !== reopened.buildId
  )
    throw new Error('Poll proof did not reopen in a new process of the same build');
} else if (values['sidecar-only']) {
  for (const mode of ['settings-hang', 'cleanup-remove-hang', 'cleanup-keys-hang']) {
    await launch('seed', 'ordinary');
    await launch(mode, 'ordinary');
    await launch(mode === 'settings-hang' ? 'verify-updated' : 'verify', 'ordinary');
  }
} else if (values['seed-only']) {
  await launch('seed', option('--seed-only'));
} else {
  for (const profile of ['ordinary', 'supported', 'large', 'overbytes']) {
    await launch('seed', profile);
    await launch('migrate', profile);
    await launch('verify', profile);
  }
  for (const phase of ['before-commit', 'after-commit', 'after-first-delete', 'after-delete']) {
    await launch('seed', 'large');
    await launch(phase, 'large', 'paused');
    await launch('verify', 'large');
  }
  await launch('seed', 'ordinary');
  await launch('cleanup-failure', 'ordinary');
  await launch('verify-updated', 'ordinary');
  for (const profile of ['ordinary', 'large']) {
    await launch('seed', profile);
    await launch('exercise', profile);
  }
}
adb('shell', 'am', 'force-stop', pkg);
if (!isDeepStrictEqual(identity(), installedIdentity)) throw new Error('Installation identity changed');
console.log(`Saved ${results.length} real Android receipts to ${output}`);
