import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { diagnosticProofFixture } from './run-diagnostic-device-proof.mjs';

// Same dedicated storage AVD and ownership marker as the existing storage proof.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    serial: { type: 'string' },
    output: { type: 'string' },
    apk: { type: 'string' },
    build: { type: 'boolean' }
  }
});
if (!values.serial || !values.output || Boolean(values.apk) === Boolean(values.build))
  throw new Error('Use --serial --output and exactly one of --apk / --build');
const output = path.resolve(values.output);
const relative = path.relative(path.join(root, '.codex-tmp'), output);
if (relative.startsWith('..') || path.isAbsolute(relative) || existsSync(output))
  throw new Error('Use a new receipt file under .codex-tmp');
const adb = (...args) =>
  execFileSync('adb', ['-s', values.serial, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
const avd = adb('emu', 'avd', 'name').split(/\r?\n/u)[0].trim();
if (avd !== 'WZ_ReaderStorage_API35_20260910') throw new Error(`Refusing non-isolated AVD ${avd}`);
const pkg = 'com.wz.reader';
const identity = () => /firstInstallTime=([^\r\n]+)/u.exec(adb('shell', 'dumpsys', 'package', pkg))?.[1]?.trim();
const before = identity();
if (!before) throw new Error('Run the existing isolated reader-storage proof first');
if (values.build) {
  const android = path.join(root, 'android');
  const fixture = mkdtempSync(path.join(root, '.codex-tmp', 'review-remediation-proof-build-'));
  const config = diagnosticProofFixture(android, fixture);
  writeFileSync(
    path.join(fixture, 'AndroidManifest.xml'),
    config.manifest
      .replace('<activity android:name="com.wz.reader.DiagnosticsProofFaultActivity" android:exported="true"/>', '')
      .replace('wzdiag', 'wzreviewproof')
  );
  writeFileSync(
    path.join(fixture, 'init.gradle'),
    config.init.replace('dev/diagnostics-proof/index.tsx', 'dev/review-remediation-proof/index.tsx')
  );
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.ENTRY_FILE;
  for (const name of [
    'WZ_ANDROID_KEYSTORE_PATH',
    'WZ_ANDROID_KEYSTORE_PASSWORD',
    'WZ_ANDROID_KEY_ALIAS',
    'WZ_ANDROID_KEY_PASSWORD'
  ])
    delete env[name];
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
    { cwd: android, env, stdio: 'inherit' }
  );
  values.apk = path.join(fixture, 'review-remediation-proof.apk');
  copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), values.apk);
  console.log(`Proof APK: ${values.apk}`);
}
adb('install', '-r', path.resolve(values.apk));
if (identity() !== before) throw new Error('Installation identity changed; device changes frozen');
const installedPath = adb('shell', 'pm', 'path', pkg).trim().split(/\r?\n/u)[0]?.replace('package:', '');
if (!installedPath?.startsWith('/data/app/')) throw new Error('Missing installed APK');
const context = {
  avd,
  serial: values.serial,
  firstInstallTime: before,
  apkSha256: adb('shell', 'sha256sum', installedPath).trim().split(/\s/u)[0]
};
const token = randomUUID().replaceAll('-', '');
adb('shell', 'am', 'force-stop', pkg);
const permission = 'android.permission.POST_NOTIFICATIONS';
const permissionBefore = /android.permission.POST_NOTIFICATIONS: granted=(true|false)/u.exec(
  adb('shell', 'dumpsys', 'package', pkg)
)?.[1];
if (!permissionBefore) throw new Error('Cannot establish notification permission baseline');
try {
  adb('shell', 'pm', 'revoke', pkg, permission);
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
    `wzreviewproof://run/${token}`
  );
  mkdirSync(path.dirname(output), { recursive: true });
  let count = -1;
  let granted = false;
  const deadline = Date.now() + 8 * 60000;
  for (;;) {
    let receipt;
    try {
      receipt = JSON.parse(adb('shell', 'run-as', pkg, 'cat', 'cache/review-remediation-proof.json'));
    } catch {}
    if (receipt?.token === token) {
      writeFileSync(output, JSON.stringify({ ...context, ...receipt }, null, 2));
      if (receipt.checkpoint === 'grant-notifications' && !granted) {
        adb('shell', 'pm', 'grant', pkg, permission);
        granted = true;
      }
      if (count !== receipt.results.length) {
        count = receipt.results.length;
        console.log(`${receipt.checkpoint}: ${count} device checks`);
      }
      if (receipt.checkpoint === 'failed')
        throw new Error(JSON.stringify(receipt.results.filter((result) => !result.passed)));
      if (receipt.checkpoint === 'passed') {
        if (
          !receipt.isHermes ||
          receipt.isDev !== false ||
          receipt.results.length !== 41 ||
          !receipt.results.every((result) => result.passed)
        )
          throw new Error('Incomplete Release Hermes proof');
        console.log(`All ${receipt.results.length} device checks passed. Receipt: ${output}`);
        break;
      }
    }
    if (Date.now() > deadline) throw new Error('Device proof timed out');
    await delay(1000);
  }
} finally {
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'pm', permissionBefore === 'true' ? 'grant' : 'revoke', pkg, permission);
}
if (identity() !== before) throw new Error('Installation identity changed');
