import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  archiveDiagnosticSymbols,
  retraceNativeDiagnosticEvent,
  symbolicateDiagnosticEvent
} from './diagnostic-symbols.mjs';

const expectedAvd = 'WZ_ImageRuntime_Test_API35';
const packageName = 'com.wz.reader';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function selectDiagnosticProofSerial(devices, avdName) {
  const matches = devices
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([serial, state]) => /^emulator-\d+$/u.test(serial) && state === 'device')
    .map(([serial]) => serial)
    .filter((serial) =>
      avdName(serial)
        .split(/\r?\n/u)
        .some((name) => name.trim() === expectedAvd)
    );
  if (matches.length !== 1) throw new Error(`Expected exactly one connected ${expectedAvd}; found ${matches.length}.`);
  return matches[0];
}

export function diagnosticProofFixture(android, fixture) {
  const relative = path.relative(android, fixture).replaceAll('\\', '/').replaceAll("'", "\\'");
  const buildId = randomUUID().replaceAll('-', '');
  return {
    buildId,
    manifest:
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">' +
      '<application android:debuggable="true" tools:replace="android:debuggable" tools:ignore="HardcodedDebugMode">' +
      '<activity android:name="com.wz.reader.DiagnosticsProofFaultActivity" android:exported="true"/>' +
      '<activity android:name="com.wz.reader.MainActivity"><intent-filter>' +
      '<action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/>' +
      '<category android:name="android.intent.category.BROWSABLE"/><data android:scheme="wzdiag"/>' +
      '</intent-filter></activity></application></manifest>',
    java: `package com.wz.reader;
public final class DiagnosticsProofFaultActivity extends android.app.Activity {
  @Override public void onCreate(android.os.Bundle state) {
    super.onCreate(state);
    throw new IllegalStateException("PRIVATE_TEST_PAYLOAD");
  }
}
`,
    init: `beforeProject { p ->
  p.plugins.withId('com.android.application') {
    def config = p.extensions.getByName('android')
    def fixture = new File(p.rootDir, '${relative}')
    config.sourceSets.getByName('release').manifest.srcFile(new File(fixture, 'AndroidManifest.xml'))
    config.sourceSets.getByName('release').java.srcDir(new File(fixture, 'java'))
    p.afterEvaluate {
      p.extensions.getByName('react').entryFile.set(new File(p.rootDir.parentFile, 'dev/diagnostics-proof/index.tsx'))
      config.defaultConfig.buildConfigField('String', 'DIAGNOSTIC_BUILD_ID', '"${buildId}"')
    }
  }
}
`
  };
}

export function verifyDiagnosticProof({ mode, ready, after, symbolsDirectory }) {
  if (![ready, after].every((value) => value.isHermes === true && value.isDev === false))
    throw new Error('Proof did not run in Release Hermes.');
  if (!/^[a-f0-9]{32}$/u.test(ready.buildId) || after.buildId !== ready.buildId)
    throw new Error('Proof build identity mismatch.');
  if (
    !/^process-[a-f0-9]{32}$/u.test(ready.processSessionId) ||
    !/^process-[a-f0-9]{32}$/u.test(after.processSessionId) ||
    ready.processSessionId === after.processSessionId
  )
    throw new Error('Proof did not restart into a different process.');
  if (
    ![ready, after].every((value) => /^session-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/u.test(value.appSessionId)) ||
    ready.appSessionId === after.appSessionId ||
    !/^trace-[1-9][0-9]*$/u.test(ready.pendingTraceId)
  )
    throw new Error('Proof JS app session or pending operation identity is invalid.');
  if (after.health?.available !== true) throw new Error('Native diagnostic storage unavailable.');
  const channels = ['jsLines', 'nativeLines', 'crashLines'];
  const all = Object.fromEntries(
    channels.map((channel) => {
      if (typeof after[channel] !== 'string') throw new Error('Diagnostic snapshot channel missing.');
      if (after[channel].includes('PRIVATE_TEST_PAYLOAD')) throw new Error('Diagnostic private payload leaked.');
      return [
        channel,
        after[channel]
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      ];
    })
  );
  const persisted = Object.values(all)
    .flat()
    .filter((event) => event.buildId === ready.buildId && event.processSessionId === ready.processSessionId);
  const pending = persisted.filter((event) => event.traceId === ready.pendingTraceId && event.operation === 'startup');
  if (
    !pending.some((event) => event.phase === 'intent') ||
    !pending.some((event) => event.phase === 'apply') ||
    pending.some((event) => event.appSessionId !== ready.appSessionId || !['intent', 'apply'].includes(event.phase))
  )
    throw new Error(`Missing or completed ${mode} pending operation before the fault.`);
  const operation = mode === 'java' ? 'native-crash' : mode === 'promise' ? 'unhandled-rejection' : 'js-error';
  const event = all[mode === 'promise' ? 'jsLines' : 'crashLines'].find(
    (event) =>
      event.buildId === ready.buildId &&
      event.processSessionId === ready.processSessionId &&
      event.operation === operation &&
      event.phase === 'finish' &&
      event.isFatal === (mode !== 'promise')
  );
  if (!event) throw new Error(`Missing retained ${mode} fault evidence.`);
  if (mode !== 'java' && event.appSessionId !== ready.appSessionId) throw new Error('Fault JS app session mismatch.');
  // Fatal events can be copied into both the crash snapshot and the regular journal.
  const faultEventCount = new Set(
    persisted
      .filter((event) => event.operation === operation)
      .map((event) => JSON.stringify(event, Object.keys(event).sort()))
  ).size;
  if (faultEventCount !== 1) throw new Error(`Expected exactly one distinct ${mode} exception record.`);
  const previousExit = all.nativeLines.find(
    (event) =>
      event.buildId === ready.buildId &&
      event.operation === 'previous-exit' &&
      event.processSessionId === after.processSessionId &&
      event.previousProcessSessionId === ready.processSessionId &&
      event.state === 'available' &&
      (mode === 'promise'
        ? event.exitReason === 'user-stopped'
        : mode === 'java'
          ? event.exitReason === 'crash'
          : [
              'crash',
              'native-crash',
              'anr',
              'low-memory',
              'resource-limit',
              'user-stopped',
              'self-exit',
              'signal',
              'other'
            ].includes(event.exitReason))
  );
  if (!previousExit) throw new Error(`Missing attributed ${mode} previous-exit evidence.`);
  const symbolicatedStack =
    mode === 'java'
      ? retraceNativeDiagnosticEvent(event, symbolsDirectory)
      : symbolicateDiagnosticEvent(event, symbolsDirectory);
  const proofSource =
    mode === 'java'
      ? /DiagnosticsProofFaultActivity\.onCreate\(DiagnosticsProofFaultActivity\.java:[1-9][0-9]*\)/u
      : /dev[/\\]diagnostics-proof[/\\]index\.tsx:\d+:\d+/u;
  if (!proofSource.test(symbolicatedStack)) throw new Error(`The ${mode} stack did not resolve to the proof source.`);
  return {
    mode,
    buildId: ready.buildId,
    appSessionId: ready.appSessionId,
    pendingTraceId: ready.pendingTraceId,
    lastPendingPhase: 'apply',
    faultEventCount,
    faultProcessSessionId: ready.processSessionId,
    restartProcessSessionId: after.processSessionId,
    previousExit: previousExit.exitReason,
    symbolicatedStack
  };
}

async function waitFor(label, read, accept, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do {
    const value = read();
    if (accept(value)) return value;
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}.`);
}

export async function runDiagnosticDeviceProof() {
  const android = path.join(root, 'android');
  const execute = (args) =>
    execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  const serial = selectDiagnosticProofSerial(execute(['devices']), (device) =>
    execute(['-s', device, 'emu', 'avd', 'name'])
  );
  const adb = (...args) => execute(['-s', serial, ...args]);
  const pid = () => {
    try {
      return adb('shell', 'pidof', packageName).trim();
    } catch {
      return '';
    }
  };
  if (pid()) throw new Error('Close the app on the isolated AVD before starting this proof.');
  if (!existsSync(path.join(android, 'diagnostic-build.json')))
    throw new Error('Fresh diagnostic prebuild is required.');
  const scratchRoot = path.join(root, '.codex-tmp');
  mkdirSync(scratchRoot, { recursive: true });
  const fixture = mkdtempSync(path.join(scratchRoot, 'diagnostic-device-proof-'));
  const reportPath = path.join(scratchRoot, `diagnostic-device-proof-report-${randomUUID()}.json`);
  const productionApk = path.join(android, 'app/build/outputs/apk/release/app-release.apk');
  const gradle = (args) => {
    const wrapper = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    const result = spawnSync(
      wrapper,
      [...args, '-PreactNativeArchitectures=x86_64', '--max-workers=4', '--no-daemon'],
      {
        cwd: android,
        env: { ...process.env, NODE_ENV: 'production' },
        shell: process.platform === 'win32',
        stdio: 'inherit'
      }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Gradle failed: ${result.status}`);
  };
  const installedIdentity = () => {
    const dump = adb('shell', 'dumpsys', 'package', packageName);
    return /firstInstallTime=([^\r\n]+)/u.exec(dump)?.[1]?.trim();
  };
  const initialIdentity = installedIdentity();
  let built = false;
  let installed = false;
  let deviceChangesFrozen = false;
  let proofPassed = false;
  let restorePassed = false;
  let symbols;
  const results = [];
  try {
    const contents = diagnosticProofFixture(android, fixture);
    mkdirSync(path.join(fixture, 'java'), { recursive: true });
    writeFileSync(path.join(fixture, 'java', 'DiagnosticsProofFaultActivity.java'), contents.java);
    writeFileSync(path.join(fixture, 'AndroidManifest.xml'), contents.manifest);
    const init = path.join(fixture, 'init.gradle');
    writeFileSync(init, contents.init);
    built = true;
    gradle(['-I', process.platform === 'win32' ? `"${init}"` : init, ':app:assembleRelease']);
    const proofApk = path.join(fixture, 'diagnostic-proof-release.apk');
    copyFileSync(productionApk, proofApk);
    // Archive this proof APK's actual R8 mapping and Hermes map under its independent build identity.
    const symbolInput = path.join(fixture, 'symbols-input');
    for (const artifact of [
      'app/build/generated/sourcemaps/react/release/index.android.bundle.map',
      'app/build/outputs/mapping/release/mapping.txt'
    ]) {
      mkdirSync(path.dirname(path.join(symbolInput, artifact)), { recursive: true });
      copyFileSync(path.join(android, artifact), path.join(symbolInput, artifact));
    }
    writeFileSync(path.join(symbolInput, 'diagnostic-build.json'), JSON.stringify({ buildId: contents.buildId }));
    const { directory } = archiveDiagnosticSymbols({
      rootDir: fixture,
      androidDir: symbolInput,
      apkPaths: [proofApk],
      gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    });
    symbols = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    adb('install', '-r', proofApk);
    installed = true;
    if (initialIdentity && installedIdentity() !== initialIdentity) {
      deviceChangesFrozen = true;
      throw new Error('Installation identity changed; device changes frozen.');
    }
    const readSnapshot = () => {
      try {
        return JSON.parse(adb('shell', 'run-as', packageName, 'cat', 'cache/diagnostic-proof.json'));
      } catch {
        return null;
      }
    };
    const launch = async (mode, checkpoint = 'ready') => {
      const token = randomUUID().replaceAll('-', '');
      adb(
        'shell',
        'am',
        'start',
        '-n',
        `${packageName}/.MainActivity`,
        '-a',
        'android.intent.action.VIEW',
        '-d',
        `wzdiag://${mode}/${token}`
      );
      return waitFor(
        `${mode} ${checkpoint} snapshot`,
        readSnapshot,
        (value) => value?.proofToken === token && value?.checkpoint === checkpoint
      );
    };
    for (const mode of ['java', 'js', 'renderer', 'promise']) {
      process.stdout.write(`Diagnostic proof: ${mode}\n`);
      const ready = await launch(mode === 'java' ? 'export' : mode, mode === 'promise' ? 'settled' : 'ready');
      if (mode === 'java') adb('shell', 'am', 'start', '-n', `${packageName}/.DiagnosticsProofFaultActivity`);
      if (mode === 'promise') adb('shell', 'am', 'force-stop', packageName);
      await waitFor(`${mode} process exit`, pid, (value) => value === '');
      // ActivityManager exit attribution is collected after the crashed process has gone away.
      const after = await launch('export');
      results.push(verifyDiagnosticProof({ mode, ready, after, symbolsDirectory: directory }));
      adb('shell', 'am', 'force-stop', packageName);
    }
    proofPassed = true;
  } finally {
    try {
      if (installed && !deviceChangesFrozen) adb('shell', 'am', 'force-stop', packageName);
      // Restore the ordinary entry so no test-only crash surface remains in the release output or AVD.
      if (built) {
        const composer = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:composer'], {
          cwd: root,
          shell: process.platform === 'win32',
          stdio: 'inherit'
        });
        if (composer.error) throw composer.error;
        if (composer.status !== 0) throw new Error('Composer build failed while restoring the production entry.');
        gradle([':app:assembleRelease']);
        if (installed && !deviceChangesFrozen) adb('install', '-r', productionApk);
      }
      restorePassed = !deviceChangesFrozen;
    } finally {
      const status = proofPassed && restorePassed ? 'PASS' : 'FAILED';
      writeFileSync(
        reportPath,
        `${JSON.stringify({ status, serial, symbols, scenarios: results, restorePassed }, null, 2)}\n`
      );
      process.stdout.write(
        `${JSON.stringify({
          status,
          serial,
          reportPath,
          scenarios: results.map(({ mode, buildId, previousExit }) => ({ mode, buildId, previousExit }))
        })}\n`
      );
      if (path.dirname(path.resolve(fixture)) !== path.resolve(scratchRoot))
        throw new Error('Invalid proof cleanup path.');
      rmSync(fixture, { recursive: true, force: true });
    }
  }
  return { reportPath, scenarios: results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    process.stderr.write('This runner takes no arguments; only the dedicated AVD is supported.\n');
    process.exitCode = 1;
  } else
    runDiagnosticDeviceProof().catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
