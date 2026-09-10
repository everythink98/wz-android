import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { diagnosticProofFixture } from './run-diagnostic-device-proof.mjs';

const { values } = parseArgs({
  options: {
    serial: { type: 'string' },
    output: { type: 'string' },
    apk: { type: 'string' },
    build: { type: 'boolean' },
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
if (values['seed-only'] && !['ordinary', 'supported', 'large', 'overbytes'].includes(values['seed-only']))
  throw new Error('Unsupported fixture profile');
const adb = (...values) =>
  execFileSync('adb', ['-s', serial, ...values], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
const avd = adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim();
if (!/^WZ_ReaderStorage_API(30|35)_20260910$/.test(avd)) throw new Error(`Refusing non-isolated AVD ${avd}`);
const pkg = 'com.wz.reader';
const identity = () => /firstInstallTime=([^\r\n]+)/.exec(adb('shell', 'dumpsys', 'package', pkg))?.[1]?.trim();
const before = identity();
if (values.build) {
  const android = path.join(root, 'android');
  const fixture = mkdtempSync(path.join(root, '.codex-tmp', 'reader-storage-proof-build-'));
  const config = diagnosticProofFixture(android, fixture);
  writeFileSync(
    path.join(fixture, 'AndroidManifest.xml'),
    config.manifest
      .replace('<activity android:name="com.wz.reader.DiagnosticsProofFaultActivity" android:exported="true"/>', '')
      .replace('wzdiag', 'wzreaderproof')
  );
  writeFileSync(
    path.join(fixture, 'init.gradle'),
    config.init.replace('dev/diagnostics-proof/index.tsx', 'dev/reader-storage-proof/index.tsx')
  );
  execFileSync(
    'java',
    [
      '-jar',
      'gradle/wrapper/gradle-wrapper.jar',
      '--no-daemon',
      '--max-workers=2',
      '-PreactNativeArchitectures=x86_64',
      '-I',
      path.join(fixture, 'init.gradle'),
      ':app:assembleRelease'
    ],
    { cwd: android, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' }
  );
  values.apk = path.join(fixture, 'reader-storage-proof.apk');
  copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), values.apk);
  console.log(`Proof APK: ${values.apk}`);
}
if (values.apk) {
  adb('install', '-r', path.resolve(option('--apk')));
  if (before && identity() !== before) throw new Error('Installation identity changed; device changes frozen');
}
const results = [];
mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
const installedPath = adb('shell', 'pm', 'path', pkg).trim().split(/\r?\n/)[0]?.replace('package:', '');
if (!installedPath?.startsWith('/data/app/')) throw new Error('Missing installed proof APK');
const context = {
  avd,
  serial,
  api: adb('shell', 'getprop', 'ro.build.version.sdk').trim(),
  firstInstallTime: identity(),
  apkSha256: adb('shell', 'sha256sum', installedPath).trim().split(/\s/)[0]
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
if (values['seed-only']) {
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
if (identity() !== context.firstInstallTime) throw new Error('Installation identity changed');
console.log(`Saved ${results.length} real Android receipts to ${output}`);
