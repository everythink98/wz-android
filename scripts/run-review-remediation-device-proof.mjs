import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { buildDeviceProof } from './device-proof-build.mjs';
import { runAgentDevice } from './agent-device-runtime.mjs';
import { createStagedProofFiles } from './staged-proof-files.mjs';
import { withProofNotificationPermission } from './review-proof-notification-permission.mjs';
import { proofDeviceForSerial, resumeProofCheckpoint, withProofCheckpoint } from './review-proof-checkpoint.mjs';
import {
  completeContentChainMetrics,
  completeDeepContentMetrics,
  completePendingPollMetrics,
  completeReviewProofResults,
  completeReadingEntryMetrics
} from './review-content-chain-metrics.mjs';

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
  values.apk = buildDeviceProof(root, {
    name: 'review-remediation-proof',
    entryFile: 'dev/review-remediation-proof/index.tsx',
    scheme: 'wzreviewproof'
  }).apk;
  console.log(`Proof APK: ${values.apk}`);
}
const install = () => {
  adb('install', '-r', path.resolve(values.apk));
  if (identity() !== before) throw new Error('Installation identity changed; device changes frozen');
};
let context;

function writeSuccessfulProof(outcome) {
  writeFileSync(
    output,
    JSON.stringify({ ...context, business: outcome.result, restoration: outcome.checkpoint, passed: true }, null, 2)
  );
}

function writeFailedProof(business, error, unconfirmedFiles = []) {
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
        causes: error.errors?.map(String),
        ...(unconfirmedFiles.length ? { unconfirmedFiles } : {})
      },
      null,
      2
    )
  );
}

if (values.acceptance) {
  const mode = values.acceptance;
  const token = randomUUID().replaceAll('-', '');
  const session = `remediation-${mode}-${token}`;
  const deviceFiles = createStagedProofFiles((file) => adb('shell', 'rm', '-f', file));
  let businessResult;
  /** @param {'first' | 'passed'} expectation */
  async function waitForReceipt(expectation = 'first') {
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
        if (expectation === 'first' || receipt.checkpoint === 'passed') return receipt;
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
        /** @type {{ kind: 'none' } | { kind: 'failed', error: unknown }} */
        let replayFailure = { kind: 'none' };
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
                const remote = deviceFiles.register(`/sdcard/Download/${name}`);
                adb('push', file, remote);
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
          const result = await waitForReceipt('passed');
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
          replayFailure = { kind: 'failed', error };
          try {
            writeFileSync(
              `${output}.png`,
              execFileSync('adb', ['-s', values.serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 * 1024 * 1024 })
            );
          } catch (captureError) {
            if (error instanceof Error) Object.assign(error, { captureError: String(captureError) });
          }
          throw error;
        } finally {
          deviceFiles.release(replayFailure);
        }
      }
    });
    writeSuccessfulProof(outcome);
    console.log(`Acceptance ${mode} and database restoration passed. Receipt: ${output}`);
  } catch (error) {
    try {
      const latest = JSON.parse(adb('shell', 'run-as', pkg, 'cat', `cache/acceptance-${mode}.json`));
      if (latest.token === token) businessResult = latest;
    } catch {}
    writeFailedProof(businessResult, error, deviceFiles.unconfirmedFiles());
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
        await withProofNotificationPermission({ adb, pkg }, async (grantNotifications) => {
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
          const readingActions = new Set();
          const deadline = Date.now() + 8 * 60000;
          for (;;) {
            let receipt;
            try {
              receipt = JSON.parse(adb('shell', 'run-as', pkg, 'cat', 'cache/review-remediation-proof.json'));
            } catch {}
            if (receipt?.token === token) {
              writeFileSync(output, JSON.stringify({ ...context, ...receipt }, null, 2));
              if (receipt.checkpoint === 'grant-notifications') grantNotifications();
              const action = receipt.readingAction;
              if (action && !readingActions.has(action.id)) {
                const known = /^(cold|cached)-(1|2)$/.exec(action.id || '');
                const next = known?.[2] === '1' ? 'newest' : 'oldest';
                if (!known || action.to !== next || action.from !== (next === 'newest' ? 'oldest' : 'newest'))
                  throw new Error('Unknown controlled reading action');
                readingActions.add(action.id);
                runAgentDevice([
                  'test',
                  'dev/review-remediation-proof/reading-order.ad',
                  '--retries',
                  '0',
                  '--artifacts-dir',
                  path.join(path.dirname(output), `reading-${action.id}`),
                  '--platform',
                  'android',
                  '--serial',
                  values.serial,
                  '--device',
                  avd.replaceAll('_', ' '),
                  '--session',
                  `remediation-reading-${token}-${action.id}`,
                  '-e',
                  `FROM=${action.from === 'newest' ? '倒序' : '正序'}`,
                  '-e',
                  `TO=${action.to === 'newest' ? '倒序' : '正序'}`,
                  '-e',
                  `FIRST_FLOOR=${action.to === 'newest' ? 40 : 2}`,
                  '-e',
                  `BEFORE=${path.join(path.dirname(output), `reading-${action.id}-before.png`)}`,
                  '-e',
                  `AFTER=${path.join(path.dirname(output), `reading-${action.id}-after.png`)}`
                ]);
                const encoded = Buffer.from(JSON.stringify({ token, id: action.id, passed: true })).toString('base64');
                adb(
                  'shell',
                  'run-as',
                  pkg,
                  'sh',
                  '-c',
                  `'echo ${encoded} | base64 -d > cache/reading-proof-action-${token}.json.tmp && mv cache/reading-proof-action-${token}.json.tmp cache/reading-proof-action-${token}.json'`
                );
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
                  !completeReviewProofResults(receipt.results) ||
                  !completeReadingEntryMetrics(receipt.results) ||
                  !completeContentChainMetrics(receipt.results) ||
                  !completePendingPollMetrics(receipt.results) ||
                  !completeDeepContentMetrics(receipt.results)
                )
                  throw new Error('Incomplete Release Hermes proof');
                console.log(`All ${receipt.results.length} business checks passed; restoring checkpoint.`);
                break;
              }
            }
            if (Date.now() > deadline) throw new Error('Device proof timed out');
            await delay(1000);
          }
        });
        return JSON.parse(readFileSync(output, 'utf8'));
      }
    });
    writeSuccessfulProof(outcome);
    console.log(`Device proof and database restoration passed. Receipt: ${output}`);
  } catch (error) {
    const business = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : undefined;
    writeFailedProof(business, error);
    throw error;
  }
}
if (identity() !== before) throw new Error('Installation identity changed');
