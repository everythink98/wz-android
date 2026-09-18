import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { diagnosticProofFixture } from './run-diagnostic-device-proof.mjs';
import { runAgentDevice } from './agent-device-runtime.mjs';
import { proofDeviceForSerial, resumeProofCheckpoint, withProofCheckpoint } from './review-proof-checkpoint.mjs';

// Same dedicated storage AVD and ownership marker as the existing storage proof.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    serial: { type: 'string' },
    output: { type: 'string' },
    apk: { type: 'string' },
    build: { type: 'boolean' },
    acceptance: { type: 'string' },
    'resume-restore': { type: 'boolean' },
    'exercise-failure': { type: 'string' }
  }
});
if (!values.serial || !values.output || (!values['resume-restore'] && Boolean(values.apk) === Boolean(values.build)))
  throw new Error('Use --serial --output and exactly one of --apk / --build');
if (values.acceptance && !['boundaries', 'recovery', 'notification'].includes(values.acceptance))
  throw new Error('Unknown acceptance mode');
if (
  values['exercise-failure'] &&
  (!values.acceptance || !['after-replay', 'app-stop', 'cancel-import'].includes(values['exercise-failure']))
)
  throw new Error('Use --exercise-failure after-replay, app-stop or cancel-import with --acceptance');
if (values['exercise-failure'] === 'cancel-import' && values.acceptance !== 'recovery')
  throw new Error('cancel-import requires recovery acceptance');
if (values['resume-restore'] && (values.apk || values.build || values.acceptance || values['exercise-failure']))
  throw new Error('Resume cannot install or run new acceptance');
const output = path.resolve(values.output);
const relative = path.relative(path.join(root, '.codex-tmp'), output);
if (relative.startsWith('..') || path.isAbsolute(relative) || existsSync(output))
  throw new Error('Use a new receipt file under .codex-tmp');
const checkpointDevice = proofDeviceForSerial(values.serial);
const { adb, avd, package: pkg } = checkpointDevice;
const identity = () => checkpointDevice.identity().firstInstallTime;
const before = identity();
const checkpointDirectory = path.join(root, '.codex-tmp', 'review-remediation-checkpoints', avd);
if (values['resume-restore']) {
  const checkpoint = await resumeProofCheckpoint({ directory: checkpointDirectory, device: checkpointDevice });
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ checkpoint, ...checkpointDevice.identity() }, null, 2));
  console.log(`Checkpoint restored: ${output}`);
  process.exit(0);
}
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
const install = () => {
  adb('install', '-r', path.resolve(values.apk));
  if (identity() !== before) throw new Error('Installation identity changed; device changes frozen');
};
let context;
if (values.acceptance) {
  const mode = values.acceptance;
  const token = randomUUID().replaceAll('-', '');
  const session = `remediation-${mode}-${token}`;
  const deviceFiles = [];
  let businessResult;
  async function waitForReceipt(completed = false) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      let receipt;
      try {
        receipt = JSON.parse(adb('shell', 'run-as', pkg, 'cat', `cache/acceptance-${mode}.json`));
      } catch {}
      if (receipt?.token === token) {
        businessResult = receipt;
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, JSON.stringify({ ...context, ...receipt }, null, 2));
        if (receipt.checkpoint === 'failed') throw new Error(`Acceptance failed: ${mode}; see ${output}`);
        if (!completed || receipt.checkpoint === 'passed') return receipt;
      }
      await delay(500);
    }
    throw new Error(`Acceptance timed out: ${mode}`);
  }
  try {
    const outcome = await withProofCheckpoint({
      directory: checkpointDirectory,
      device: checkpointDevice,
      prepare: install,
      run: async () => {
        context = { ...checkpointDevice.identity(), serial: values.serial };
        let replayError;
        try {
          adb('shell', 'am', 'force-stop', pkg);
          adb(
            'shell',
            'am',
            'start',
            '-n',
            `${pkg}/.MainActivity`,
            '-f',
            '0x10008000',
            '-a',
            'android.intent.action.VIEW',
            '-d',
            `wzreviewproof://${mode}/${token}`
          );
          await waitForReceipt();
          if (values['exercise-failure'] === 'app-stop') {
            checkpointDevice.stop();
            throw new Error('Controlled App interruption');
          }
          if (mode !== 'boundaries') {
            const environment = [];
            if (mode === 'recovery') {
              for (const kind of ['valid', 'invalid']) {
                const name = `acc-${token.slice(0, 8)}-${kind}.json`;
                const file = path.join(path.dirname(output), name);
                writeFileSync(file, adb('shell', 'run-as', pkg, 'cat', `cache/acceptance-${kind}.json`), {
                  flag: 'wx'
                });
                deviceFiles.push(`/sdcard/Download/${name}`);
                adb('push', file, deviceFiles.at(-1));
                environment.push('-e', `${kind.toUpperCase()}_FILE=${name}`);
              }
            }
            let replay = `dev/review-remediation-proof/${mode}.ad`;
            if (values['exercise-failure'] === 'cancel-import') {
              const canceled = readFileSync(path.join(root, replay), 'utf8').replace(
                'press text="${INVALID_FILE}"',
                'back'
              );
              replay = `${output}.ad`;
              writeFileSync(replay, canceled, { flag: 'wx' });
            }
            runAgentDevice([
              'test',
              replay,
              '--retries',
              '0',
              '--artifacts-dir',
              path.join(path.dirname(output), session),
              '--platform',
              'android',
              '--serial',
              values.serial,
              '--device',
              avd.replaceAll('_', ' '),
              '--session',
              session,
              ...environment
            ]);
          }
          const result = await waitForReceipt(true);
          businessResult = result;
          if (
            !result.isHermes ||
            result.isDev !== false ||
            (mode === 'boundaries' && (result.results?.length !== 27 || !result.restored))
          )
            throw new Error('Incomplete acceptance evidence');
          if (values['exercise-failure'] === 'after-replay')
            throw new Error('Controlled failure after business replay');
          return result;
        } catch (error) {
          replayError = error;
          try {
            writeFileSync(
              `${output}.png`,
              execFileSync('adb', ['-s', values.serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 * 1024 * 1024 })
            );
          } catch (captureError) {
            error.captureError = String(captureError);
          }
          throw error;
        } finally {
          try {
            for (const file of deviceFiles) adb('shell', 'rm', '-f', file);
          } catch (cleanupError) {
            if (replayError)
              throw new AggregateError([replayError, cleanupError], 'Replay and staged-file cleanup failed');
            throw cleanupError;
          }
        }
      }
    });
    writeFileSync(
      output,
      JSON.stringify({ ...context, business: outcome.result, restoration: outcome.checkpoint, passed: true }, null, 2)
    );
    console.log(`Acceptance ${mode} and database restoration passed. Receipt: ${output}`);
  } catch (error) {
    try {
      const latest = JSON.parse(adb('shell', 'run-as', pkg, 'cat', `cache/acceptance-${mode}.json`));
      if (latest.token === token) businessResult = latest;
    } catch {}
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(
      output,
      JSON.stringify(
        {
          ...context,
          business: businessResult,
          restoration: error.checkpoint,
          passed: false,
          error: String(error),
          causes: error.errors?.map(String)
        },
        null,
        2
      )
    );
    throw error;
  }
} else {
  try {
    const outcome = await withProofCheckpoint({
      directory: checkpointDirectory,
      device: checkpointDevice,
      prepare: install,
      run: async () => {
        context = { ...checkpointDevice.identity(), serial: values.serial };
        const token = randomUUID().replaceAll('-', '');
        adb('shell', 'am', 'force-stop', pkg);
        const permission = 'android.permission.POST_NOTIFICATIONS';
        const permissionBefore = /android.permission.POST_NOTIFICATIONS: granted=(true|false)/u.exec(
          adb('shell', 'dumpsys', 'package', pkg)
        )?.[1];
        if (!permissionBefore) throw new Error('Cannot establish notification permission baseline');
        let businessError;
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
                console.log(`All ${receipt.results.length} business checks passed; restoring checkpoint.`);
                break;
              }
            }
            if (Date.now() > deadline) throw new Error('Device proof timed out');
            await delay(1000);
          }
        } catch (error) {
          businessError = error;
          throw error;
        } finally {
          try {
            adb('shell', 'am', 'force-stop', pkg);
            adb('shell', 'pm', permissionBefore === 'true' ? 'grant' : 'revoke', pkg, permission);
          } catch (cleanupError) {
            if (businessError)
              throw new AggregateError([businessError, cleanupError], 'Proof and permission cleanup failed');
            throw cleanupError;
          }
        }
        return JSON.parse(readFileSync(output, 'utf8'));
      }
    });
    writeFileSync(
      output,
      JSON.stringify({ ...context, business: outcome.result, restoration: outcome.checkpoint, passed: true }, null, 2)
    );
    console.log(`Device proof and database restoration passed. Receipt: ${output}`);
  } catch (error) {
    const business = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : undefined;
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(
      output,
      JSON.stringify(
        {
          ...context,
          business,
          restoration: error.checkpoint,
          passed: false,
          error: String(error),
          causes: error.errors?.map(String)
        },
        null,
        2
      )
    );
    throw error;
  }
}
if (identity() !== before) throw new Error('Installation identity changed');
