import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export function startupEvents(log) {
  return log.split(/\r?\n/u).flatMap((line) => {
    const json = line.match(/WzStartup\s*:\s*(\{.*\})/u)?.[1];
    if (!json) return [];
    try {
      const event = JSON.parse(json);
      return event.operation === 'startup-timing' &&
        /^[a-f0-9]{32}$/u.test(event.buildId) &&
        /^process-[a-f0-9]{32}$/u.test(event.processSessionId) &&
        typeof event.state === 'string' &&
        Number.isFinite(event.elapsedMs) &&
        event.elapsedMs >= 0
        ? [event]
        : [];
    } catch {
      return [];
    }
  });
}

export function timingSummary(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0 };
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
    worst: sorted.at(-1)
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      serial: { type: 'string' },
      apk: { type: 'string' },
      output: { type: 'string' },
      batches: { type: 'string', default: '3' },
      runs: { type: 'string', default: '10' }
    }
  });
  if (!values.serial || !values.apk || !values.output) throw new Error('Required: --serial --apk --output');
  const batches = Number(values.batches),
    runs = Number(values.runs);
  if (![batches, runs].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 30)) throw new Error('Invalid run count');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.resolve(values.output);
  const relative = path.relative(path.join(root, '.codex-tmp'), output);
  if (relative.startsWith('..') || path.isAbsolute(relative) || existsSync(output))
    throw new Error('Use a new output under .codex-tmp');
  const adb = (...args) =>
    execFileSync('adb', ['-s', values.serial, ...args], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024
    });
  const packageName = 'com.wz.reader';
  const installedPath = adb('shell', 'pm', 'path', packageName)
    .trim()
    .split(/\r?\n/u)[0]
    ?.replace(/^package:/u, '');
  if (!installedPath?.startsWith('/data/app/')) throw new Error('No installed APK');
  const apkSha256 = createHash('sha256').update(readFileSync(values.apk)).digest('hex');
  if (adb('shell', 'sha256sum', installedPath).trim().split(/\s/u)[0] !== apkSha256)
    throw new Error('Installed APK does not match');
  const firstInstall = () => adb('shell', 'dumpsys', 'package', packageName).match(/firstInstallTime=([^\r\n]+)/u)?.[1];
  const firstInstallTime = firstInstall();
  if (!firstInstallTime) throw new Error('Missing installation identity');
  const result = { serial: values.serial, apkSha256, firstInstallTime, samples: [], summaries: [] };
  const processes = new Set();
  const pids = new Set();
  let buildId;
  writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx' });
  for (let batch = 1; batch <= batches; batch++) {
    for (let run = 1; run <= runs; run++) {
      adb('shell', 'am', 'force-stop', packageName);
      await delay(500);
      const launch = adb(
        'shell',
        'am',
        'start',
        '-W',
        '-n',
        `${packageName}/.MainActivity`,
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.LAUNCHER'
      );
      if (!/LaunchState:\s*COLD/u.test(launch)) throw new Error('Expected a process cold start');
      const pid = adb('shell', 'pidof', packageName).trim();
      if (!/^\d+$/u.test(pid)) throw new Error('Missing single app PID');
      if (pids.has(pid)) throw new Error('App PID was reused during the benchmark');
      pids.add(pid);
      let events;
      const deadline = performance.now() + 20_000;
      do {
        events = startupEvents(adb('logcat', '-d', `--pid=${pid}`, '-s', 'WzStartup:I', '*:S'));
        if (events.some((event) => /^feed-(content|empty|error)$/u.test(event.state))) break;
        await delay(500);
      } while (performance.now() < deadline);
      const processIds = new Set(events.map((event) => event.processSessionId));
      if (processIds.size !== 1 || processes.has(events[0]?.processSessionId))
        throw new Error('Process evidence is missing, mixed or reused');
      processes.add(events[0].processSessionId);
      if (new Set(events.map((event) => event.state)).size !== events.length)
        throw new Error('A startup phase was recorded more than once');
      buildId ??= events[0].buildId;
      if (events.some((event) => event.buildId !== buildId)) throw new Error('Build changed during benchmark');
      const phases = Object.fromEntries(events.map((event) => [event.state, event.elapsedMs]));
      if (!Number.isFinite(phases['page-ready'])) throw new Error('Page never became ready');
      if (adb('shell', 'pidof', packageName).trim() !== pid) throw new Error('App exited during startup');
      const sample = {
        batch,
        run,
        pid,
        buildId,
        processSessionId: events[0].processSessionId,
        systemDisplayMs: Number(launch.match(/TotalTime:\s*(\d+)/u)?.[1]),
        phases
      };
      result.samples.push(sample);
      writeFileSync(output, JSON.stringify(result, null, 2));
      console.log(
        `Batch ${batch}/${batches}, run ${run}/${runs}: page ${phases['page-ready']} ms, feed ${phases['feed-content'] ?? 'no content'} ms`
      );
      // Keep sequential live reads spaced out; never overlap two startup request waves.
      await delay(5_000);
    }
    const samples = result.samples.filter((sample) => sample.batch === batch);
    result.summaries.push({
      batch,
      systemDisplayMs: timingSummary(samples.map((s) => s.systemDisplayMs)),
      pageReadyMs: timingSummary(samples.map((s) => s.phases['page-ready'])),
      feedContentMs: timingSummary(samples.map((s) => s.phases['feed-content']))
    });
    if (firstInstall() !== firstInstallTime) throw new Error('Installation identity changed; freeze device');
    writeFileSync(output, JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result.summaries));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
