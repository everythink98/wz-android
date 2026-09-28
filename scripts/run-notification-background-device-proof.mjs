import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { proofDeviceForSerial, withProofCheckpoint } from './review-proof-checkpoint.mjs';

export function backgroundProofLimits(values) {
  const cycles = Number(values.cycles ?? 1);
  const minutes = Number(values['timeout-minutes'] ?? (values.natural ? cycles * 15 + 30 : cycles * 3 + 2));
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 8)
    throw new Error('--cycles must be an integer between 1 and 8');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180 || (values.natural && minutes < cycles * 15))
    throw new Error('--timeout-minutes must be 1..180 and allow at least fifteen minutes per natural cycle');
  return { cycles, timeoutMs: minutes * 60000 };
}

export function backgroundCycleReceipt(value, token, run) {
  if (value?.token !== token) return null;
  if (!Number.isSafeInteger(value.run) || value.run < 0) throw new Error('Missing periodic run sequence');
  if (value.checkpoint === 'failed') throw new Error(JSON.stringify(value));
  if (value.run > run) throw new Error('Missed a periodic run; cannot reuse a later receipt');
  return value.run === run && value.checkpoint === 'passed' ? value : null;
}

export function backgroundJobRegistration(snapshot) {
  const jobs = ownedJobs(snapshot.jobs);
  if (jobs.length !== 1) throw new Error(`Expected one isolated WorkManager job, got ${jobs.length}`);
  const block = snapshot.jobs
    .slice(jobs[0].index)
    .split(/^  JOB #/mu)
    .slice(0, 2)
    .join('  JOB #');
  const remaining = /Run time: earliest=\+([\da-z]+)/u.exec(block)?.[1];
  const delayMs = remaining && duration(remaining);
  if (!delayMs || delayMs < 14 * 60000 || delayMs > 15 * 60000)
    throw new Error('Registration did not create a fresh fifteen-minute job epoch');
  return { ...snapshot, jobId: jobs[0][1], earliestEpochMs: snapshot.deviceEpochMs + delayMs };
}

export async function initializeBackgroundProofEpoch({ cleanup, snapshot }) {
  // A force-stopped package can have no JobScheduler entry while WorkManager
  // still persists an old task. Launching cleanup restores then unregisters only
  // wz-isolated-headless-proof before the new registration's fifteen-minute epoch.
  await cleanup();
  if (ownedJobs(snapshot().jobs).length)
    throw new Error('An existing WorkManager job remained after isolated proof cleanup');
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
export function nativeCompletion(log, processId, cutoff, done) {
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
  const scheduled = events.filter(
    (event) =>
      event.tag === 'BackgroundTaskScheduler' &&
      event.message === "Enqueuing worker with identifier EXPO_BACKGROUND_WORKER and '15' minutes delay." &&
      event.at >= done.finishedAt &&
      event.at <= worker.at
  );
  const enqueued = events.filter(
    (event) =>
      event.tag === 'WM-WorkerWrapper' &&
      /^Setting status to enqueued for [a-f0-9-]{36}$/u.test(event.message) &&
      event.at >= worker.at
  );
  const completedWorkId = /\bid=([a-f0-9-]{36})/u.exec(worker.message)?.[1];
  const nextWorkId = enqueued[0]?.message.split(' ').at(-1);
  const handoff =
    scheduled.length === 1 && enqueued.length === 1 && completedWorkId && nextWorkId !== completedWorkId
      ? { scheduled: scheduled[0], enqueued: enqueued[0], completedWorkId, nextWorkId }
      : null;
  return { taskId, workerStarted: workerStarts[0], started, task, finished, worker, handoff };
}
export function verifyJobHistory(snapshot, jobId, registration, native, done, natural = false) {
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
  let handoff;
  let previous = -Infinity;
  for (const event of events) {
    if (event.earliest < previous) throw new Error('Job history is not chronological');
    previous = event.earliest;
    if (event.kind === 'START') {
      if (event.earliest < registration.deviceEpochMs) throw new Error('Job attempt predates this registration epoch');
      if (natural && event.latest < registration.earliestEpochMs)
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
      } else if (event.reason === 'canceled') {
        // WorkManager APPEND may retire the completed one-time Job via cancel()
        // while its successful WorkerWrapper schedules the next period. Accept
        // only a final stop coincident with that native success, never an early
        // execution cancellation or an unproven replacement.
        if (
          stop ||
          active !== 0 ||
          event !== events.at(-1) ||
          !native.handoff ||
          event.earliest > native.worker.at ||
          event.latest < native.worker.at
        )
          throw new Error('Canceled job lacks a completed native handoff');
        const next = backgroundJobRegistration(snapshot);
        const anchorWidth = snapshot.deviceEpochAfterMs - snapshot.deviceEpochMs;
        if (next.jobId === jobId || next.earliestEpochMs + anchorWidth < native.handoff.scheduled.at + 15 * 60000)
          throw new Error('Canceled job lacks a fresh fifteen-minute successor');
        handoff = { ...native.handoff, nextJobId: next.jobId, nextEarliestEpochMs: next.earliestEpochMs };
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
  return { start, stop, events, ...(handoff ? { handoff } : {}) };
}

async function main() {
  const { values } = parseArgs({
    options: {
      serial: { type: 'string' },
      output: { type: 'string' },
      cold: { type: 'boolean' },
      natural: { type: 'boolean' },
      mode: { type: 'string' },
      cycles: { type: 'string' },
      'timeout-minutes': { type: 'string' },
      help: { type: 'boolean' }
    }
  });
  if (values.help) {
    console.log(`Usage: node scripts/run-notification-background-device-proof.mjs --serial emulator-N --output .codex-tmp/result.json [--cold] [--natural] [--mode success|deadline] [--cycles 2] [--timeout-minutes 50]
Requires the minified Release Hermes remediation proof APK on the owned ReaderStorage AVD.
Default: warm forced success and deadline. --cold: HOME + am kill, then require a new process.
--natural requires --cold and runs success only, without forcing the job.
--cycles observes repeated executions of one registration (1..8, default 1).
--timeout-minutes bounds the complete observation, at most 180 minutes; natural default is 15 * cycles + 30.
Each completed cycle checkpoints its JS/native/job evidence before observing the next periodic job.
Natural observation reads receipts, PID and logs; JobScheduler is dumped only at cycle boundaries.`);
    process.exit(0);
  }
  if (values.mode && !['success', 'deadline'].includes(values.mode)) throw new Error('Unknown background mode');
  if (values.natural && (!values.cold || (values.mode && values.mode !== 'success')))
    throw new Error('--natural requires --cold and success mode');
  if (!values.serial || !values.output)
    throw new Error('Use --serial and --output with the remediation proof APK installed');
  const limits = backgroundProofLimits(values);
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
  const evidence = { cold: Boolean(values.cold), natural: Boolean(values.natural), ...limits, results, timeline };
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
  async function receipt(token, checkpoint, timeoutMs = 20000, observeBackground = false, run) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = currentReceipt();
      if (observeBackground) {
        const state = backgroundState();
        timeline.push({
          stage: 'observing',
          ...state,
          checkpoint: value?.checkpoint,
          observedRun: value?.run,
          waitingForRun: run
        });
        save({ passed: false });
        if (!state.launcherForeground || state.stopped !== 'false')
          throw new Error('Background observation interrupted');
        if (state.pid) {
          const log = nativeLog(state.pid);
          if (values.cold && /Cannot initialize app loader|ClassNotFoundException|FATAL EXCEPTION/u.test(log)) {
            writeFileSync(`${output}.native-failure.log`, log);
            throw new Error('Native background initialization failed; see native-failure.log');
          }
        }
      }
      if (value?.token === token) {
        if (run !== undefined) {
          const complete = backgroundCycleReceipt(value, token, run);
          if (complete) return complete;
        }
        if (value.checkpoint === 'failed') throw new Error(JSON.stringify(value));
        if (run === undefined && value.checkpoint === checkpoint) return value;
      }
      await delay(observeBackground && values.natural ? 15000 : 500);
    }
    throw new Error(
      `Background proof did not reach ${checkpoint}${run === undefined ? '' : ` for cycle ${run}`} before the observation deadline`
    );
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
          const observationDeadline = Date.now() + limits.timeoutMs;
          adb('shell', 'pm', 'grant', pkg, permission);
          await initializeBackgroundProofEpoch({
            cleanup: () => open('cleanup', randomUUID().replaceAll('-', ''), 'cleaned'),
            snapshot: () => jobSnapshot('before-registration')
          });
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
            let registration = backgroundJobRegistration(jobSnapshot(`${mode}-registered`));
            let jobId = registration.jobId;
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
            for (let cycle = 1; cycle <= limits.cycles; cycle += 1) {
              if (Date.now() >= observationDeadline) throw new Error('Background observation deadline reached');
              if (!values.natural) {
                adb('shell', 'cmd', 'jobscheduler', 'run', '-f', pkg, jobId);
                if (values.cold && cycle === 1) {
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
                    const history =
                      /\bJob history:\s*\r?\n([\s\S]*?)\r?\nPending queue:/u.exec(binding.jobs)?.[1] ?? '';
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
                `${mode} cycle ${cycle}/${limits.cycles}: ${values.natural ? 'natural' : 'forced'} ${values.cold ? 'cold-start registration' : 'warm'}, registered ${registeredUtc}, job ${jobId}`
              );
              const done = await receipt(
                token,
                'passed',
                Math.min(
                  observationDeadline - Date.now(),
                  values.natural ? limits.timeoutMs : mode === 'deadline' ? 75000 : 20000
                ),
                true,
                cycle
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
              writeFileSync(`${output}.${mode}-${cycle}.native.log`, nativeLog(processId));
              await delay(250);
              const completed = jobSnapshot(`${mode}-${cycle}-completed`);
              results.at(-1).jobHistory = verifyJobHistory(
                completed,
                jobId,
                registration,
                completion,
                done,
                values.natural
              );
              save({ identity: device.identity(), results, passed: false });
              console.log(
                `${mode} cycle ${cycle}/${limits.cycles}: ${done.elapsedMs} ms, fully background, native headless finished`
              );
              if (cycle < limits.cycles) {
                registration = backgroundJobRegistration(completed);
                jobId = registration.jobId;
              }
            }
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
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
