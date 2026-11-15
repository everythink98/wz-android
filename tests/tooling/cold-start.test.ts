import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { startupEvents, timingSummary } from '../../scripts/check-cold-start.mjs';

describe('cold startup evidence', () => {
  it('parses only complete timing events with a process identity', () => {
    const event = {
      operation: 'startup-timing',
      buildId: 'a'.repeat(32),
      processSessionId: `process-${'b'.repeat(32)}`,
      state: 'page-ready',
      elapsedMs: 125
    };
    expect(startupEvents(`noise\nI WzStartup: ${JSON.stringify(event)}\nI WzStartup: {broken`)).toEqual([event]);
    expect(startupEvents(`I WzStartup: ${JSON.stringify({ ...event, elapsedMs: -1 })}`)).toEqual([]);
  });
  it('does not turn missing content into a zero-time success', () => {
    expect(timingSummary([undefined, 100, 200, 300, 400])).toEqual({ count: 4, median: 250, p90: 400, worst: 400 });
    expect(timingSummary([undefined])).toEqual({ count: 0 });
  });
});

it.each([
  'complete',
  'delayed-terminal',
  'empty',
  'error',
  'warm',
  'pending-feed',
  'exited-process',
  'reused-process',
  'reused-pid',
  'changed-build',
  'changed-installation'
] as const)('freezes cold-start evidence for %s', async (scenario) => {
  const parent = path.resolve('.codex-tmp/cold-start-tests');
  mkdirSync(parent, { recursive: true });
  const owned = mkdtempSync(path.join(parent, 'owned-'));
  const apk = path.join(owned, 'fixture.apk');
  const output = path.join(owned, 'result.json');
  const bytes = Buffer.from('controlled cold-start APK');
  writeFileSync(apk, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const calls: string[][] = [];
  let launches = 0;
  let installationReads = 0;
  let logReads = 0;
  let clock = 0;
  const originalArgv = process.argv;
  vi.resetModules();
  vi.doMock('node:child_process', () => ({
    execFileSync: (command: string, args: string[]) => {
      if (command !== 'adb' || args[0] !== '-s' || args[1] !== 'controlled-emulator')
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      calls.push(args);
      if (args.includes('path')) return 'package:/data/app/controlled/base.apk\n';
      if (args.includes('sha256sum')) return `${digest}  /data/app/controlled/base.apk\n`;
      if (args.includes('dumpsys')) {
        installationReads += 1;
        return `firstInstallTime=${scenario === 'changed-installation' && installationReads > 1 ? 'changed' : 'original'}\n`;
      }
      if (args.includes('force-stop')) return '';
      if (args.includes('start')) {
        launches += 1;
        logReads = 0;
        return `LaunchState: ${scenario === 'warm' ? 'WARM' : 'COLD'}\nTotalTime: 42\n`;
      }
      if (args.includes('pidof'))
        return String(
          scenario === 'reused-pid' ? 1001 : 1000 + launches + (scenario === 'exited-process' && logReads ? 1 : 0)
        );
      if (args.includes('logcat')) {
        logReads += 1;
        const processSessionId = `process-${String(scenario === 'reused-process' ? 1 : launches).padStart(32, '0')}`;
        const buildId = (scenario === 'changed-build' && launches > 1 ? 'b' : 'a').repeat(32);
        const outcome = scenario === 'empty' ? 'feed-empty' : scenario === 'error' ? 'feed-error' : 'feed-content';
        return [
          'page-ready',
          outcome,
          ...(scenario === 'pending-feed' || (scenario === 'delayed-terminal' && logReads < 3) ? [] : ['feed-terminal'])
        ]
          .map(
            (state, index) =>
              `I WzStartup : ${JSON.stringify({ operation: 'startup-timing', buildId, processSessionId, state, elapsedMs: 10 + index })}`
          )
          .join('\n');
      }
      throw new Error(`Unexpected adb command: ${args.join(' ')}`);
    }
  }));
  vi.doMock('node:timers/promises', () => ({
    setTimeout: async (ms: number) => {
      clock += ms;
    }
  }));
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    process.argv = [
      process.execPath,
      path.resolve('scripts/check-cold-start.mjs'),
      '--serial',
      'controlled-emulator',
      '--apk',
      apk,
      '--output',
      output,
      '--batches',
      '2',
      '--runs',
      '2'
    ];
    const running = import('../../scripts/check-cold-start.mjs');
    const succeeds =
      scenario === 'complete' || scenario === 'delayed-terminal' || scenario === 'empty' || scenario === 'error';
    if (succeeds) await running;
    else {
      await expect(running).rejects.toThrow(
        scenario === 'warm'
          ? 'Expected a process cold start'
          : scenario === 'pending-feed'
            ? 'Feed never reached its terminal state'
            : scenario === 'exited-process'
              ? 'App exited during startup'
              : scenario === 'reused-pid'
                ? 'App PID was reused during the benchmark'
                : scenario === 'reused-process'
                  ? 'Process evidence is missing, mixed or reused'
                  : scenario === 'changed-build'
                    ? 'Build changed during benchmark'
                    : 'Installation identity changed; freeze device'
      );
    }
    const saved = JSON.parse(readFileSync(output, 'utf8'));
    expect(saved.apkSha256).toBe(digest);
    expect(saved.firstInstallTime).toBe('original');
    if (succeeds) {
      expect(saved.samples).toHaveLength(4);
      expect(saved.summaries).toHaveLength(2);
      expect(new Set(saved.samples.map((sample: { processSessionId: string }) => sample.processSessionId)).size).toBe(
        4
      );
      expect(saved.summaries.map((summary: { pageReadyMs: { count: number } }) => summary.pageReadyMs.count)).toEqual([
        2, 2
      ]);
      expect(
        saved.summaries.map((summary: { feedTerminalMs: { count: number; median: number } }) => summary.feedTerminalMs)
      ).toEqual([
        { count: 2, median: 12, p90: 12, worst: 12 },
        { count: 2, median: 12, p90: 12, worst: 12 }
      ]);
      expect(
        saved.summaries.map((summary: { feedContentMs: { count: number } }) => summary.feedContentMs.count)
      ).toEqual(scenario === 'empty' || scenario === 'error' ? [0, 0] : [2, 2]);
      expect(logReads).toBe(scenario === 'delayed-terminal' ? 3 : 1);
    } else {
      const firstRunFailed = scenario === 'warm' || scenario === 'pending-feed' || scenario === 'exited-process';
      expect(saved.samples).toHaveLength(scenario === 'changed-installation' ? 2 : firstRunFailed ? 0 : 1);
      expect(saved.summaries).toEqual([]);
      expect(launches).toBe(firstRunFailed ? 1 : 2);
      if (scenario === 'pending-feed') expect(clock).toBe(35_500);
    }
    if (scenario === 'warm') {
      expect(saved.rejectedLaunch).toEqual({ batch: 1, run: 1, launch: 'LaunchState: WARM\nTotalTime: 42\n' });
      expect(logReads).toBe(0);
      expect(calls.filter((args) => args.includes('force-stop'))).toHaveLength(1);
    } else expect(saved).not.toHaveProperty('rejectedLaunch');
    expect(calls.filter((args) => args.includes('start'))).toHaveLength(launches);
  } finally {
    process.argv = originalArgv;
    now.mockRestore();
    log.mockRestore();
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:timers/promises');
    vi.resetModules();
    rmSync(owned, { recursive: true, force: true });
  }
});
