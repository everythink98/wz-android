// @vitest-environment node
import path from 'node:path';
import { expect, it, vi } from 'vitest';

async function fixture(
  failures: {
    stop?: { error: unknown };
    composer?: { error: unknown };
    report?: { error: unknown };
    identityChangesAfterInstall?: boolean;
  } = {}
) {
  const temporary = path.resolve('.codex-tmp/diagnostic-device-proof-fixture');
  let installs = 0;
  let report: { restorePassed: boolean } | undefined;
  const exec = vi.fn((command: string, args: readonly string[]) => {
    if (command === 'git') return 'fixture-revision';
    if (args.join(' ') === 'devices') return 'emulator-7777 device\n';
    const operation = args.slice(2).join(' ');
    if (operation === 'emu avd name') return 'WZ_ImageRuntime_Test_API35\nOK\n';
    if (operation === 'shell pidof com.wz.reader') return '';
    if (operation === 'shell dumpsys package com.wz.reader')
      return `firstInstallTime=${installs && failures.identityChangesAfterInstall ? '2026-01-02' : '2026-01-01'} 00:00:00\n`;
    if (operation.startsWith('install -r ')) {
      installs++;
      return 'Success';
    }
    if (operation.startsWith('shell am start ')) throw false;
    if (operation === 'shell am force-stop com.wz.reader') {
      if (failures.stop) throw failures.stop.error;
      return '';
    }
    throw new Error('Unexpected synthetic command: ' + command + ' ' + args.join(' '));
  });
  const spawn = vi.fn((command: string) =>
    command.includes('npm') && failures.composer ? { error: failures.composer.error, status: 1 } : { status: 0 }
  );
  const remove = vi.fn();
  vi.resetModules();
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
  vi.doMock('../../scripts/device-proof-build.mjs', () => ({
    deviceProofFixture: () => ({ java: 'fixture', manifest: 'fixture', init: 'fixture', buildId: 'a'.repeat(32) })
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
    vi.doUnmock('node:fs');
    vi.doUnmock('../../scripts/device-proof-build.mjs');
    vi.doUnmock('../../scripts/diagnostic-symbols.mjs');
    vi.resetModules();
  }
  return { outcome, exec, spawn, installs, remove, temporary, report, outputLines };
}

it('restores the ordinary entry after a failure to stop the proof app', async () => {
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

it('retains a falsy primary and every independent cleanup failure in attempt order', async () => {
  const composer = new Error('Composer restoration failed');
  const result = await fixture({ stop: { error: undefined }, composer: { error: composer }, report: { error: 0 } });
  expect(result.installs).toBe(1);
  expect(result.remove).toHaveBeenCalledOnce();
  if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof AggregateError))
    throw new Error('Expected all failures');
  const causes = result.outcome.error.errors;
  expect(causes).toHaveLength(4);
  [false, undefined, composer, 0].forEach((error, index) => expect(causes[index]).toBe(error));
});
