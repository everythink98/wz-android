// @vitest-environment node
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';

async function fixture(
  failures: {
    prepare?: { error: unknown };
    proofBuild?: { error: unknown };
    coldStop?: { error: unknown };
    stop?: { error: unknown };
    composer?: { error: unknown };
    report?: { error: unknown };
    identityChangesAfterInstall?: boolean;
    identityChangesDuringBuild?: boolean;
    startsAfterInstall?: boolean;
    snapshotBytes?: number;
    snapshotError?: 'ENOBUFS' | 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    incompleteSnapshotReads?: boolean;
  } = {}
) {
  const temporary = path.resolve('.codex-tmp/diagnostic-device-proof-fixture');
  let installs = 0;
  let proofBuilt = false;
  let running = false;
  let stops = 0;
  const launchStates: ('cold' | 'warm')[] = [];
  let snapshot = '';
  let snapshotReads = 0;
  let now = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const delay = vi.fn(async () => {
    now += failures.incompleteSnapshotReads ? 100 : 60_000;
  });
  let report: { restorePassed: boolean } | undefined;
  const exec = vi.fn((command: string, args: readonly string[], options: { maxBuffer?: number } = {}) => {
    if (command === 'git') return 'fixture-revision';
    if (args.join(' ') === 'devices') return 'emulator-7777 device\n';
    if (command.endsWith('aapt2') || command.endsWith('aapt2.exe'))
      return "package: name='com.wz.reader' versionCode='42' versionName='fixture'";
    const operation = args.slice(2).join(' ');
    if (operation === 'shell pm list packages -u') return 'package:android\npackage:com.wz.reader';
    if (operation === 'shell pm path com.wz.reader') return 'package:/data/app/fixture/base.apk';
    if (operation.startsWith('shell sha256sum'))
      return createHash('sha256')
        .update(JSON.stringify({ buildId: 'a'.repeat(32) }))
        .digest('hex');
    if (operation.startsWith('pull ')) return '';
    if (operation === 'emu avd name') return 'WZ_ImageRuntime_Test_API35\nOK\n';
    if (operation === 'shell pidof com.wz.reader') return running ? '12345' : '';
    if (operation === 'shell dumpsys package com.wz.reader')
      return `firstInstallTime=${(installs && failures.identityChangesAfterInstall) || (proofBuilt && failures.identityChangesDuringBuild) ? '2026-01-02' : '2026-01-01'} 00:00:00\nappId=10123\nUser 0: installed=true\n`;
    if (operation.startsWith('install -r ')) {
      installs++;
      running = failures.startsAfterInstall === true;
      return 'Success';
    }
    if (operation.startsWith('shell am start ')) {
      launchStates.push(running ? 'warm' : 'cold');
      if (operation.includes('/.MainActivity') && (failures.snapshotBytes || failures.snapshotError)) {
        const url = args[args.indexOf('-d') + 1];
        snapshot = JSON.stringify({
          proofToken: url.slice(url.lastIndexOf('/') + 1),
          checkpoint: 'ready',
          nativeLines: 'x'.repeat(failures.snapshotBytes ?? 0)
        });
        return '';
      }
      throw false;
    }
    if (operation === 'shell run-as com.wz.reader cat cache/diagnostic-proof.json') {
      snapshotReads++;
      if (failures.incompleteSnapshotReads && snapshotReads === 1)
        throw Object.assign(new Error('Snapshot not written yet'), { code: 'ENOENT' });
      if (failures.incompleteSnapshotReads && snapshotReads === 2) return '{';
      if (failures.snapshotError || Buffer.byteLength(snapshot) > (options.maxBuffer ?? 1024 * 1024))
        throw Object.assign(new Error('SYNTHETIC_PRIVATE_LOG_FRAGMENT'), {
          code: failures.snapshotError ?? 'ENOBUFS',
          stdout: 'SYNTHETIC_PRIVATE_LOG_FRAGMENT',
          stderr: 'SYNTHETIC_PRIVATE_LOG_FRAGMENT',
          cause: 'SYNTHETIC_PRIVATE_LOG_FRAGMENT'
        });
      return snapshot;
    }
    if (operation === 'shell am force-stop com.wz.reader') {
      stops++;
      if (stops === 1 && failures.coldStop) throw failures.coldStop.error;
      if (stops > 1 && failures.stop) throw failures.stop.error;
      running = false;
      return '';
    }
    throw new Error('Unexpected synthetic command: ' + command + ' ' + args.join(' '));
  });
  const spawn = vi.fn((command: string, args: readonly string[]) => {
    if (command.includes('gradlew') && args.includes('-I')) proofBuilt = true;
    if (command.includes('npm') && failures.composer) return { error: failures.composer.error, status: 1 };
    if (command.includes('gradlew') && args.includes('-I') && failures.proofBuild)
      return { error: failures.proofBuild.error, status: 1 };
    return { status: 0 };
  });
  const remove = vi.fn();
  vi.resetModules();
  vi.doMock('node:timers/promises', () => ({ setTimeout: delay }));
  vi.doMock('node:child_process', () => ({ execFileSync: exec, spawnSync: spawn }));
  vi.doMock('node:fs', () => ({
    existsSync: (file: string) => file === path.resolve('android/diagnostic-build.json'),
    mkdirSync: vi.fn(),
    mkdtempSync: () => temporary,
    copyFileSync: vi.fn(),
    readFileSync: () => JSON.stringify({ buildId: 'a'.repeat(32) }),
    rmSync: remove,
    writeFileSync: (file: string, value: string) => {
      if (path.basename(file).startsWith('diagnostic-device-proof-report-')) {
        if (failures.report) throw failures.report.error;
        report = JSON.parse(value);
      }
    }
  }));
  vi.doMock('../../scripts/device-apk-signer.mjs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../scripts/device-apk-signer.mjs')>()),
    findApkSignerJar: () => 'fixture-signer',
    deviceApkSignerSha256: () => 'a'.repeat(64)
  }));
  vi.doMock('../../scripts/device-proof-build.mjs', () => ({
    deviceProofFixture: () => {
      if (failures.prepare) throw failures.prepare.error;
      return { java: 'fixture', manifest: 'fixture', init: 'fixture', buildId: 'a'.repeat(32) };
    }
  }));
  vi.doMock('../../scripts/diagnostic-symbols.mjs', () => ({
    archiveDiagnosticSymbols: () => ({ directory: path.join(temporary, 'symbols') }),
    symbolicateDiagnosticEvent: vi.fn(),
    retraceNativeDiagnosticEvent: vi.fn()
  }));
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  let outputLines: string[];
  let outcome: { kind: 'passed' } | { kind: 'failed'; error: unknown } = { kind: 'passed' };
  try {
    const subject = await import('../../scripts/run-diagnostic-device-proof.mjs');
    await subject.runDiagnosticDeviceProof();
  } catch (error) {
    outcome = { kind: 'failed', error };
  } finally {
    outputLines = output.mock.calls.map(([value]) => String(value));
    output.mockRestore();
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:timers/promises');
    vi.doUnmock('node:fs');
    vi.doUnmock('../../scripts/device-apk-signer.mjs');
    vi.doUnmock('../../scripts/device-proof-build.mjs');
    vi.doUnmock('../../scripts/diagnostic-symbols.mjs');
    vi.resetModules();
    clock.mockRestore();
  }
  return { outcome, exec, spawn, installs, remove, temporary, report, outputLines, launchStates, snapshotReads, delay };
}

it.each(['prepare', 'proofBuild'] as const)(
  'handles a %s failure before installation without acquiring device cleanup authority',
  async (stage) => {
    const failure = new Error('Proof setup failed');
    const result = await fixture({ [stage]: { error: failure } });
    expect(result.spawn.mock.calls.filter(([command]) => command.includes('gradlew'))).toHaveLength(
      stage === 'prepare' ? 0 : 2
    );
    expect(result.spawn.mock.calls.filter(([command]) => command.includes('npm'))).toHaveLength(
      stage === 'prepare' ? 0 : 1
    );
    expect(result.installs).toBe(0);
    expect(result.exec.mock.calls.some(([, args]) => /^(install |shell am )/u.test(args.slice(2).join(' ')))).toBe(
      false
    );
    expect(result.remove).toHaveBeenCalledWith(result.temporary, { recursive: true, force: true });
    expect(result.report?.restorePassed).toBe(true);
    if (result.outcome.kind !== 'failed') throw new Error('Expected setup failure');
    expect(result.outcome.error).toBe(failure);
  }
);

it('starts the first proof from a cold process even when installation restarted the app', async () => {
  const result = await fixture({ startsAfterInstall: true });
  expect(result.launchStates).toEqual(['cold']);
  expect(result.outcome).toEqual({ kind: 'failed', error: false });
  expect(result.report?.restorePassed).toBe(true);
});

it('restores the ordinary entry without launching when the initial cold stop fails', async () => {
  const coldStop = new Error('Initial stop failed');
  const result = await fixture({ coldStop: { error: coldStop } });
  expect(result.launchStates).toEqual([]);
  expect(result.outcome).toEqual({ kind: 'failed', error: coldStop });
  expect(result.installs).toBe(2);
  expect(result.report?.restorePassed).toBe(true);
});

it('restores the ordinary entry after a failure to stop the proof app during cleanup', async () => {
  const stop = new Error('Stop failed');
  const result = await fixture({ stop: { error: stop } });
  expect(result.spawn.mock.calls.filter(([command]) => command.includes('gradlew'))).toHaveLength(2);
  expect(result.installs).toBe(2);
  if (result.outcome.kind !== 'failed') throw new Error('Expected failure');
  if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected both causes');
  expect(result.outcome.error.errors).toHaveLength(2);
  expect(result.outcome.error.errors[0]).toBe(false);
  expect(result.outcome.error.errors[1]).toBe(stop);
});

it('reads a multi-megabyte valid snapshot and reaches the native fault action', async () => {
  const result = await fixture({ snapshotBytes: 2 * 1024 * 1024 });
  expect(result.outcome).toEqual({ kind: 'failed', error: false });
  expect(result.exec.mock.calls.some(([, args]) => args.includes('com.wz.reader/.DiagnosticsProofFaultActivity'))).toBe(
    true
  );
  expect(result.snapshotReads).toBe(1);
  expect(result.report?.restorePassed).toBe(true);
});

it.each(['ENOBUFS', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'] as const)(
  'reports %s immediately without exposing subprocess output and restores the ordinary entry',
  async (snapshotError) => {
    const result = await fixture({ snapshotError });
    if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof Error))
      throw new Error('Expected safe overflow failure');
    expect(result.outcome.error.message).toBe('Diagnostic snapshot exceeded the bounded subprocess output limit.');
    for (const key of ['cause', 'stdout', 'stderr']) expect(result.outcome.error).not.toHaveProperty(key);
    expect(result.outputLines.join('')).not.toContain('SYNTHETIC_PRIVATE_LOG_FRAGMENT');
    expect(result.snapshotReads).toBe(1);
    expect(result.delay).not.toHaveBeenCalled();
    expect(result.installs).toBe(2);
    expect(result.report?.restorePassed).toBe(true);
  }
);

it('keeps polling a missing or partially written snapshot until valid JSON arrives', async () => {
  const result = await fixture({ snapshotBytes: 2 * 1024 * 1024, incompleteSnapshotReads: true });
  expect(result.outcome).toEqual({ kind: 'failed', error: false });
  expect(result.snapshotReads).toBe(3);
  expect(result.delay).toHaveBeenCalledTimes(2);
  expect(result.report?.restorePassed).toBe(true);
});

it('retains the original failure when the ordinary entry cannot be rebuilt', async () => {
  const composer = new Error('Composer restoration failed');
  const result = await fixture({ composer: { error: composer } });
  expect(result.installs).toBe(1);
  expect(result.remove).toHaveBeenCalledOnce();
  if (result.outcome.kind !== 'failed') throw new Error('Expected failure');
  if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected both causes');
  expect(result.outcome.error.errors).toHaveLength(2);
  expect(result.outcome.error.errors[0]).toBe(false);
  expect(result.outcome.error.errors[1]).toBe(composer);
});

it('removes only its owned temporary directory when report persistence fails', async () => {
  const report = new Error('Report write failed');
  const result = await fixture({ report: { error: report } });
  expect(result.remove).toHaveBeenCalledWith(result.temporary, { recursive: true, force: true });
  expect(result.outputLines.some((line) => line.includes('"status":"FAILED"'))).toBe(true);
  if (result.outcome.kind !== 'failed') throw new Error('Expected failure');
  if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected both causes');
  expect(result.outcome.error.errors).toHaveLength(2);
  expect(result.outcome.error.errors[0]).toBe(false);
  expect(result.outcome.error.errors[1]).toBe(report);
});

it('preserves a falsy primary error after successful ordinary restoration', async () => {
  const result = await fixture();
  expect(result.outcome).toEqual({ kind: 'failed', error: false });
  expect(result.report?.restorePassed).toBe(true);
  expect(result.installs).toBe(2);
  expect(result.remove).toHaveBeenCalledWith(result.temporary, { recursive: true, force: true });
});

it('keeps device mutations frozen after an installation identity anomaly', async () => {
  const result = await fixture({ identityChangesAfterInstall: true });
  expect(result.installs).toBe(1);
  expect(
    result.exec.mock.calls.some(([, args]) => args.slice(2).join(' ') === 'shell am force-stop com.wz.reader')
  ).toBe(false);
  expect(result.spawn.mock.calls.filter(([command]) => command.includes('gradlew'))).toHaveLength(2);
  expect(result.report?.restorePassed).toBe(false);
  expect(result.remove).toHaveBeenCalledOnce();
  if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof Error))
    throw new Error('Expected identity failure');
  expect(result.outcome.error.message).toMatch(/Installation identity changed/);
});

it('detects a replaced installation during the proof build before changing the device', async () => {
  const result = await fixture({ identityChangesDuringBuild: true });
  expect(result.installs).toBe(0);
  expect(result.launchStates).toEqual([]);
  expect(result.outcome).toMatchObject({
    kind: 'failed',
    error: expect.objectContaining({ message: expect.stringContaining('identity') })
  });
});

it.each(['launch', 'cold-stop'] as const)(
  'retains a falsy %s primary and every independent cleanup failure in attempt order',
  async (stage) => {
    const composer = new Error('Composer restoration failed');
    const result = await fixture({
      ...(stage === 'cold-stop' ? { coldStop: { error: false } } : {}),
      stop: { error: undefined },
      composer: { error: composer },
      report: { error: 0 }
    });
    expect(result.installs).toBe(1);
    expect(result.remove).toHaveBeenCalledOnce();
    if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof AggregateError))
      throw new Error('Expected all failures');
    const causes = result.outcome.error.errors;
    expect(causes).toHaveLength(4);
    [false, undefined, composer, 0].forEach((error, index) => expect(causes[index]).toBe(error));
  }
);
