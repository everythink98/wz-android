import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { proofDeviceForSerial, withProofCheckpoint } from './review-proof-checkpoint.mjs';

const { values } = parseArgs({
  options: {
    serial: { type: 'string' },
    output: { type: 'string' },
    cold: { type: 'boolean' },
    natural: { type: 'boolean' },
    mode: { type: 'string' },
    help: { type: 'boolean' }
  }
});
if (values.help) {
  console.log(`Usage: node scripts/run-notification-background-device-proof.mjs --serial emulator-N --output .codex-tmp/result.json [--cold] [--natural] [--mode success|deadline]
Requires the minified Release Hermes remediation proof APK on the owned ReaderStorage AVD.
Default: warm forced success and deadline. --cold: HOME + am kill, then require a new process.
--natural requires --cold and runs success only, without forcing the job (45-minute maximum).
Natural observation reads receipts, PID and logs; JobScheduler is dumped only before and after observation.`);
  process.exit(0);
}
if (values.mode && !['success', 'deadline'].includes(values.mode)) throw new Error('Unknown background mode');
if (values.natural && (!values.cold || (values.mode && values.mode !== 'success')))
  throw new Error('--natural requires --cold and success mode');
if (!values.serial || !values.output)
  throw new Error('Use --serial and --output with the remediation proof APK installed');
const output = path.resolve(values.output);
const relative = path.relative(path.resolve('.codex-tmp'), output);
if (relative.startsWith('..') || path.isAbsolute(relative) || existsSync(output))
  throw new Error('Use a new output file under .codex-tmp');
const device = proofDeviceForSerial(values.serial);
const { adb, package: pkg } = device;
const permission = 'android.permission.POST_NOTIFICATIONS';
const grantedBefore = /android.permission.POST_NOTIFICATIONS: granted=(true|false)/u.exec(
  adb('shell', 'dumpsys', 'package', pkg)
)?.[1];
if (!grantedBefore) throw new Error('Cannot establish notification permission baseline');
const results = [];
const timeline = [];
const modes = values.mode ? [values.mode] : values.natural ? ['success'] : ['success', 'deadline'];
const evidence = { cold: Boolean(values.cold), natural: Boolean(values.natural), results, timeline };
mkdirSync(path.dirname(output), { recursive: true });
function save(value) {
  writeFileSync(output, JSON.stringify({ ...evidence, ...value }, null, 2));
}
function currentReceipt() {
  try {
    return JSON.parse(adb('shell', 'run-as', pkg, 'cat', 'cache/background-proof.json'));
  } catch {
    return null;
  }
}
function pid() {
  try {
    return adb('shell', 'pidof', pkg).trim();
  } catch (error) {
    if (error.status === 1 && !String(error.stdout ?? '').trim() && !String(error.stderr ?? '').trim()) return '';
    throw error;
  }
}
function backgroundState() {
  const activity = adb('shell', 'dumpsys', 'activity', 'activities');
  return {
    utc: new Date().toISOString(),
    pid: pid(),
    stopped: /User 0:[^\r\n]*stopped=(true|false)/u.exec(adb('shell', 'dumpsys', 'package', pkg))?.[1],
    launcherForeground: activity
      .split(/\r?\n/u)
      .some((line) => line.includes('topResumedActivity') && line.includes('launcher'))
  };
}
function nativeLog(processId) {
  return adb(
    'shell',
    'logcat',
    '-d',
    '--pid',
    processId,
    '-v',
    'epoch',
    '-t',
    '3000',
    '-s',
    'TaskService:V',
    'BackgroundTaskScheduler:V',
    'BackgroundTaskWork:V',
    'WM-WorkerWrapper:V',
    'Expo:V',
    'System.err:V',
    'AndroidRuntime:V',
    '*:S'
  );
}
function jobSnapshot(label) {
  const hostBefore = Date.now();
  const deviceEpochMs = Number(adb('shell', 'date', '+%s%3N').trim());
  const uptime = adb('shell', 'cat', '/proc/uptime').trim();
  const jobs = adb('shell', 'dumpsys', 'jobscheduler');
  const deviceEpochAfterMs = Number(adb('shell', 'date', '+%s%3N').trim());
  if (
    !Number.isSafeInteger(deviceEpochMs) ||
    deviceEpochMs <= 0 ||
    !Number.isSafeInteger(deviceEpochAfterMs) ||
    deviceEpochAfterMs < deviceEpochMs ||
    deviceEpochAfterMs - deviceEpochMs > 5000
  )
    throw new Error('JobScheduler device epoch anchor is invalid');
  const file = `${output}.${label}.jobs.txt`;
  writeFileSync(file, jobs);
  timeline.push({ stage: label, hostBefore, deviceEpochMs, deviceEpochAfterMs, uptime, hostAfter: Date.now(), file });
  return { jobs, deviceEpochMs, deviceEpochAfterMs };
}
function duration(text) {
  let total = 0;
  let parsed = '';
  for (const match of text.matchAll(/(\d+)(ms|d|h|m|s)/gu)) {
    total += Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
    parsed += match[0];
  }
  if (!parsed || parsed !== text) throw new Error(`Unrecognized JobScheduler duration: ${text}`);
  return total;
}
function ownedJobs(jobs) {
  return [...jobs.matchAll(/^  JOB #u\d+a\d+\/(\d+):[^\r\n]*com\.wz\.reader\/androidx\.work/gmu)];
}
function nativeCompletion(log, processId, cutoff, done) {
  if (
    ![done.startedAt, done.finishedAt, done.elapsedMs].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    done.startedAt < cutoff ||
    done.finishedAt < done.startedAt ||
    done.finishedAt - done.startedAt < done.elapsedMs
  )
    throw new Error('Invalid JS completion timestamps');
  const events = log.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+\.\d+)\s+(\d+)\s+\d+\s+[VDIWEAF]\s+([^:]+):\s*(.*)$/u.exec(line);
    return match && match[2] === processId && Number(match[1]) * 1000 >= cutoff
      ? [{ at: Math.round(Number(match[1]) * 1000), tag: match[3].trim(), message: match[4] }]
      : [];
  });
  const starts = events.filter(
    (event) => event.tag === 'TaskService' && /^Started headless task \d+ /u.test(event.message)
  );
  const tasks = events.filter(
    (event) =>
      event.tag === 'TaskService' &&
      event.message.startsWith("Finished task 'wz-isolated-headless-proof' with eventId '")
  );
  if (!starts.length || !tasks.length) return null;
  if (starts.length !== 1 || tasks.length !== 1) throw new Error('Multiple native tasks contaminate this proof epoch');
  const taskId = /^Started headless task (\d+) /u.exec(starts[0].message)[1];
  const finishes = events.filter(
    (event) => event.tag === 'TaskService' && event.message.startsWith(`Finished headless task ${taskId} `)
  );
  const workers = events.filter(
    (event) =>
      event.tag === 'WM-WorkerWrapper' &&
      event.message.startsWith('Worker result SUCCESS for Work [') &&
      event.message.includes('expo.modules.backgroundtask.BackgroundTaskWork')
  );
  const workerStarts = events.filter(
    (event) => event.tag === 'BackgroundTaskWork' && event.message === 'doWork: Running worker'
  );
  if (!finishes.length || !workers.length) return null;
  if (finishes.length !== 1 || workers.length !== 1 || workerStarts.length !== 1)
    throw new Error('Multiple native completions contaminate this proof epoch');
  const [started, task, finished, worker] = [starts[0], tasks[0], finishes[0], workers[0]];
  if (
    workerStarts[0].at > started.at ||
    started.at > done.startedAt ||
    task.at < started.at ||
    finished.at < task.at ||
    worker.at < task.at ||
    done.startedAt < cutoff ||
    done.finishedAt > task.at
  )
    throw new Error('JS/task/headless/worker completion order differs');
  return { taskId, workerStarted: workerStarts[0], started, task, finished, worker };
}
function verifyJobHistory(snapshot, jobId, registration, native, done) {
  if (
    !Number.isSafeInteger(snapshot.deviceEpochMs) ||
    snapshot.deviceEpochMs <= 0 ||
    !Number.isSafeInteger(snapshot.deviceEpochAfterMs) ||
    snapshot.deviceEpochAfterMs < snapshot.deviceEpochMs ||
    snapshot.deviceEpochAfterMs - snapshot.deviceEpochMs > 5000
  )
    throw new Error('Job history time anchor is not bounded');
  const history = /\bJob history:\s*\r?\n([\s\S]*?)\r?\nPending queue:/u.exec(snapshot.jobs)?.[1];
  if (!history) throw new Error('Missing completed job history');
  const events = history
    .split(/\r?\n/u)
    .flatMap((line) => {
      const match =
        /^\s*-([\da-z]+)\s+(START|STOP)(?:-P)?:\s+#u\d+a\d+\/(\d+)\s+com\.wz\.reader\/androidx\.work\.impl\.background\.systemjob\.SystemJobService(?:\s+(.*))?$/u.exec(
          line
        );
      if (!match || match[3] !== jobId) return [];
      const ago = duration(match[1]);
      return [
        {
          kind: match[2],
          reason: match[4] ?? '',
          earliest: snapshot.deviceEpochMs - ago,
          latest: snapshot.deviceEpochAfterMs - ago
        }
      ];
    })
    .filter((event) => event.latest >= registration.deviceEpochMs);
  let active = 0;
  let start;
  let stop;
  let previous = -Infinity;
  for (const event of events) {
    if (event.earliest < previous) throw new Error('Job history is not chronological');
    previous = event.earliest;
    if (event.kind === 'START') {
      if (event.earliest < registration.deviceEpochMs) throw new Error('Job attempt predates this registration epoch');
      if (values.natural && event.latest < registration.earliestEpochMs)
        throw new Error('Natural job ran before its registered earliest time');
      if (active === 0) start = event;
      active += 1;
    } else {
      active -= 1;
      if (active < 0) throw new Error('Job history starts with an unmatched stop');
      if (event.reason === 'app called jobFinished') {
        if (stop || active !== 0 || event !== events.at(-1))
          throw new Error('Normal job completion is not the unique final stop');
        stop = event;
      } else if (event.reason !== 'cancelled while waiting for bind') {
        throw new Error('Job history contains a cancellation after binding or an unknown stop');
      }
    }
  }
  // Android may overlap a replacement START with a cancelled bind. That cancellation
  // occurs before service.startJob, so only the remaining normal attempt can own
  // this unique worker. Do not generalize this to cancellations after execution.
  if (
    start?.kind !== 'START' ||
    !stop ||
    active !== 0 ||
    start.earliest > native.workerStarted.at ||
    start.earliest > native.started.at ||
    start.earliest > done.startedAt ||
    stop.latest < Math.max(native.finished.at, native.worker.at)
  )
    throw new Error('Job history does not enclose this JS/native task and normal finish');
  return { start, stop, events };
}
async function receipt(token, checkpoint, timeoutMs = 20000, observeBackground = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = currentReceipt();
    if (observeBackground) {
      const state = backgroundState();
      timeline.push({ stage: 'observing', ...state, checkpoint: value?.checkpoint });
      save({ passed: false });
      if (!state.launcherForeground || state.stopped !== 'false') throw new Error('Background observation interrupted');
      if (state.pid) {
        const log = nativeLog(state.pid);
        if (values.cold && /Cannot initialize app loader|ClassNotFoundException|FATAL EXCEPTION/u.test(log)) {
          writeFileSync(`${output}.native-failure.log`, log);
          throw new Error('Native background initialization failed; see native-failure.log');
        }
      }
    }
    if (value?.token === token) {
      if (value.checkpoint === 'failed') throw new Error(JSON.stringify(value));
      if (value.checkpoint === checkpoint) return value;
    }
    await delay(observeBackground && values.natural ? 15000 : 500);
  }
  throw new Error(`Background proof did not reach ${checkpoint}`);
}
async function open(mode, token, checkpoint) {
  device.stop();
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
    `wzreviewproof://background/${mode}/${token}`
  );
  return receipt(token, checkpoint);
}
let businessError;
try {
  const outcome = await withProofCheckpoint({
    directory: path.resolve('.codex-tmp', 'review-remediation-checkpoints', device.avd),
    device,
    run: async () => {
      let registered = false;
      try {
        adb('shell', 'pm', 'grant', pkg, permission);
        const baselineJobs = ownedJobs(jobSnapshot('before-registration').jobs);
        if (baselineJobs.length)
          throw new Error('An existing WorkManager job must be cleaned before this isolated epoch');
        for (const mode of modes) {
          const token = randomUUID().replaceAll('-', '');
          registered = true;
          const ready = await open(mode, token, 'ready');
          if (!ready.isHermes || ready.isDev !== false) throw new Error('Not a Release Hermes proof');
          const oldPid = pid();
          const registeredUtc = new Date().toISOString();
          adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
          let background = backgroundState();
          for (let attempt = 0; attempt < 20 && !background.launcherForeground; attempt += 1) {
            await delay(100);
            background = backgroundState();
          }
          if (!background.launcherForeground || background.stopped !== 'false')
            throw new Error('Launcher is not in the foreground');
          const registration = jobSnapshot(`${mode}-registered`);
          const jobs = ownedJobs(registration.jobs);
          if (jobs.length !== 1) throw new Error(`Expected one isolated WorkManager job, got ${jobs.length}`);
          const jobId = jobs[0][1];
          const block = registration.jobs
            .slice(jobs[0].index)
            .split(/^  JOB #/mu)
            .slice(0, 2)
            .join('  JOB #');
          const remaining = /Run time: earliest=\+([\da-z]+)/u.exec(block)?.[1];
          const delayMs = remaining && duration(remaining);
          if (!delayMs || delayMs < 14 * 60000 || delayMs > 15 * 60000)
            throw new Error('Registration did not create a fresh fifteen-minute job epoch');
          registration.earliestEpochMs = registration.deviceEpochMs + delayMs;
          if (values.cold) {
            if (currentReceipt()?.checkpoint !== 'ready') throw new Error('Task ran before the cold handoff');
            // HOME can finish before ActivityManager drops the old process's foreground importance.
            // Retry am kill during that handoff; never force-stop a scheduled background task.
            for (let attempt = 0; attempt < 20; attempt += 1) {
              const currentPid = pid();
              if (!currentPid) break;
              if (currentPid !== oldPid) throw new Error('Process changed before the cold handoff');
              adb('shell', 'am', 'kill', pkg);
              await delay(250);
            }
            const cold = backgroundState();
            timeline.push({ stage: 'cold', ...cold, oldPid, jobId, registeredUtc });
            save({ passed: false });
            if (cold.pid || cold.stopped !== 'false' || !cold.launcherForeground)
              throw new Error('am kill did not leave an unstopped cold process');
          }
          if (!values.natural) {
            adb('shell', 'cmd', 'jobscheduler', 'run', '-f', pkg, jobId);
            if (values.cold) {
              await delay(2000);
              const processId = pid();
              // WorkManager may reschedule its persisted job while the cold Service is binding.
              // Only that explicitly observed pre-worker cancellation permits one forced retry.
              if (
                processId &&
                currentReceipt()?.checkpoint === 'ready' &&
                !nativeLog(processId).includes('doWork: Running worker')
              ) {
                const binding = jobSnapshot(`${mode}-forced-binding`);
                const history = /\bJob history:\s*\r?\n([\s\S]*?)\r?\nPending queue:/u.exec(binding.jobs)?.[1] ?? '';
                const last = history
                  .split(/\r?\n/u)
                  .filter((line) => line.includes(`/${jobId} ${pkg}/androidx.work.`))
                  .at(-1);
                if (
                  last?.includes('STOP:') &&
                  last.endsWith('cancelled while waiting for bind') &&
                  ownedJobs(binding.jobs).some((job) => job[1] === jobId)
                ) {
                  timeline.push({
                    stage: 'forced-bind-retry',
                    jobId,
                    pid: processId,
                    utc: new Date().toISOString(),
                    reason: last.trim()
                  });
                  adb('shell', 'cmd', 'jobscheduler', 'run', '-f', pkg, jobId);
                }
              }
            }
          }
          console.log(
            `${mode}: ${values.natural ? 'natural' : 'forced'} ${values.cold ? 'cold' : 'warm'}, registered ${registeredUtc}, job ${jobId}`
          );
          const done = await receipt(
            token,
            'passed',
            values.natural ? 45 * 60000 : mode === 'deadline' ? 75000 : 20000,
            true
          );
          const processId = pid();
          if (!processId || (!values.cold && processId !== oldPid))
            throw new Error('Missing process or warm process identity changed');
          if (
            done.buildId !== ready.buildId ||
            !done.isHermes ||
            done.isDev !== false ||
            done.states.some((state) => state !== 'background')
          )
            throw new Error('Proof identity or full-background evidence differs');
          if (values.cold && (processId === oldPid || done.processSessionId === ready.processSessionId))
            throw new Error('Cold task did not create a new process');
          results.push({ ...done, pid: processId, oldPid, jobId, registeredUtc, nativeFinished: false });
          save({ identity: device.identity(), results, passed: false });
          let completion = null;
          for (let attempt = 0; attempt < 20 && !completion; attempt += 1) {
            completion = nativeCompletion(nativeLog(processId), processId, registration.deviceEpochMs, done);
            if (!completion) await delay(250);
          }
          const afterActivity = adb('shell', 'dumpsys', 'activity', 'activities');
          if (
            !completion ||
            pid() !== processId ||
            !afterActivity
              .split(/\r?\n/u)
              .some((line) => line.includes('topResumedActivity') && line.includes('launcher'))
          )
            throw new Error('Missing native finish, stable process or full-background evidence');
          results.at(-1).nativeFinished = true;
          results.at(-1).nativeCompletion = completion;
          writeFileSync(`${output}.${mode}.native.log`, nativeLog(processId));
          await delay(250);
          const completed = jobSnapshot(`${mode}-completed`);
          results.at(-1).jobHistory = verifyJobHistory(completed, jobId, registration, completion, done);
          save({ identity: device.identity(), results, passed: false });
          console.log(`${mode}: ${done.elapsedMs} ms, fully background, native headless finished`);
          await open('cleanup', randomUUID().replaceAll('-', ''), 'cleaned');
          registered = false;
          if (ownedJobs(jobSnapshot(`${mode}-cleaned`).jobs).length)
            throw new Error('Owned WorkManager job remained after cleanup');
        }
        return results;
      } catch (error) {
        businessError = error;
        const processId = pid();
        if (processId) writeFileSync(`${output}.native-failure.log`, nativeLog(processId));
        jobSnapshot('observation-failed');
        throw error;
      } finally {
        const failures = [];
        try {
          if (registered) await open('cleanup', randomUUID().replaceAll('-', ''), 'cleaned');
        } catch (error) {
          failures.push(error);
        }
        try {
          device.stop();
          adb('shell', 'pm', grantedBefore === 'true' ? 'grant' : 'revoke', pkg, permission);
        } catch (error) {
          failures.push(error);
        }
        if (failures.length)
          throw new AggregateError(
            [...(businessError ? [businessError] : []), ...failures],
            'Background proof cleanup failed'
          );
      }
    }
  });
  save({ identity: device.identity(), results, restoration: outcome.checkpoint, passed: true });
} catch (error) {
  save({
    results,
    passed: false,
    restoration: error.checkpoint,
    error: String(error),
    causes: error.errors?.map(String)
  });
  throw error;
}
