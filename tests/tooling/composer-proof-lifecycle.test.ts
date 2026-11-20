// @vitest-environment node
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

async function runFixture(
  failures: {
    close?: { error: unknown };
    ime?: { error: unknown };
    animation?: { error: unknown };
    persist?: { error: unknown };
  } = {}
) {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const source = path.resolve('scripts/run-composer-device-proof.mjs');
  const apk = path.resolve('.codex-tmp/composer-lifecycle-fixture.apk');
  const bytes = Buffer.from('synthetic fixture bytes');
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==',
    'base64'
  );
  const launchFailure = new Error('fixture launch failed');
  let artifact: { sourceHash: string; apkHash: string; buildId: string } | undefined;
  let report: { results: { error?: string }[] } | undefined;
  let animation = '1';
  const exec = vi.fn((_command: string, args: readonly string[]) => {
    if (_command.endsWith('aapt2') || _command.endsWith('aapt2.exe'))
      return "package: name='com.wz.reader' versionCode='42' versionName='fixture'";
    const command = args.slice(2).join(' ');
    if (command.startsWith('shell sha256sum')) return createHash('sha256').update(bytes).digest('hex');
    if (args.includes('screencap')) return image;
    if (command === 'emu avd name') return 'WZ_ComposerInsets_0916\nOK\n';
    if (command === 'shell dumpsys package com.wz.reader')
      return 'firstInstallTime=2026-01-01 00:00:00\nappId=10123\nUser 0: installed=true\n';
    if (command === 'shell settings get secure default_input_method') return 'fixture.RealIME';
    if (command === 'shell settings get global window_animation_scale') return animation;
    if (command === 'shell pm path com.wz.reader') return 'package:/data/app/fixture/base.apk';
    if (command.startsWith('shell am start')) throw launchFailure;
    if (command === 'shell ime set fixture.RealIME' && failures.ime) throw failures.ime.error;
    if (command.startsWith('shell settings put global window_animation_scale ')) {
      const value = args.at(-1)!;
      if (value === '1' && failures.animation) throw failures.animation.error;
      animation = value;
    }
    if (command.includes('run-as')) return '{}';
    return '';
  });
  const agent = vi.fn((args: readonly string[]) => {
    if (args[0] === 'close' && failures.close) throw failures.close.error;
    return '';
  });
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ execFileSync: exec }));
  vi.doMock('node:fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    existsSync: () => false,
    mkdirSync: vi.fn(),
    readdirSync: () => [],
    readFileSync: (file: string, encoding?: string) =>
      file === `${apk}.json` ? JSON.stringify(artifact) : encoding ? bytes.toString() : bytes,
    writeFileSync: (file: string, value: string) => {
      if (file.endsWith('results.json')) {
        if (failures.persist) throw failures.persist.error;
        report = JSON.parse(value);
      }
    }
  }));
  vi.doMock('../../scripts/agent-device-runtime.mjs', () => ({ runAgentDevice: agent }));
  vi.doMock('../../scripts/device-apk-signer.mjs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../scripts/device-apk-signer.mjs')>()),
    findApkSignerJar: () => 'fixture-signer',
    deviceApkSignerSha256: () => 'a'.repeat(64)
  }));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  let outcome: { kind: 'passed' } | { kind: 'failed'; error: unknown } = { kind: 'passed' };
  let exitCode: typeof process.exitCode;
  try {
    process.argv = [process.execPath, 'inactive-fixture'];
    const subject = await import('../../scripts/run-composer-device-proof.mjs');
    artifact = {
      sourceHash: subject.composerSourceHash(),
      apkHash: createHash('sha256').update(bytes).digest('hex'),
      buildId: 'fixture-build'
    };
    const scenario = subject.composerCases.find((value) => 'stress' in value && value.stress === 'ime-fast')!;
    vi.resetModules();
    process.argv = [
      process.execPath,
      source,
      '--serial',
      'emulator-fixture',
      '--output',
      path.resolve('.codex-tmp/composer-lifecycle-output'),
      '--apk',
      apk,
      '--cases',
      scenario.id
    ];
    await import('../../scripts/run-composer-device-proof.mjs');
    exitCode = process.exitCode;
  } catch (error) {
    outcome = { kind: 'failed', error };
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    log.mockRestore();
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs');
    vi.doUnmock('../../scripts/agent-device-runtime.mjs');
    vi.doUnmock('../../scripts/device-apk-signer.mjs');
    vi.resetModules();
  }
  return { outcome, exec, agent, animation, report, exitCode, launchFailure };
}

it('restores window animation even when restoring the real IME fails', async () => {
  const failure = new Error('IME restoration failed');
  const result = await runFixture({ ime: { error: failure } });
  expect(
    result.exec.mock.calls.some(
      ([, args]) => args.slice(2).join(' ') === 'shell settings put global window_animation_scale 1'
    )
  ).toBe(true);
  expect(result.outcome).toEqual({ kind: 'failed', error: failure });
  if (result.outcome.kind !== 'failed') throw new Error('Expected IME restoration failure');
  expect(result.outcome.error).toBe(failure);
});

it('retains every cleanup failure including falsy throws', async () => {
  const close = new Error('session close failed');
  const result = await runFixture({ close: { error: close }, ime: { error: false }, animation: { error: undefined } });
  if (result.outcome.kind !== 'failed') throw new Error('Expected failures');
  if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected all cleanup causes');
  const causes = result.outcome.error.errors;
  expect(causes).toHaveLength(3);
  [close, false, undefined].forEach((error, index) => expect(causes[index]).toBe(error));
});

it('preserves a primary persistence failure alongside every independent cleanup failure', async () => {
  const close = new Error('session close failed');
  const animation = new Error('window restoration failed');
  const result = await runFixture({
    persist: { error: false },
    close: { error: close },
    ime: { error: undefined },
    animation: { error: animation }
  });
  if (result.outcome.kind !== 'failed') throw new Error('Expected failures');
  if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected primary and cleanup causes');
  const causes = result.outcome.error.errors;
  expect(causes).toHaveLength(4);
  [false, close, undefined, animation].forEach((error, index) => expect(causes[index]).toBe(error));
});

it.each([null, undefined])('preserves a %s session-close failure while restoring both settings', async (error) => {
  const result = await runFixture({ close: { error } });
  expect(result.outcome).toEqual({ kind: 'failed', error });
  expect(result.animation).toBe('1');
  expect(
    result.exec.mock.calls.filter(([, args]) => args.slice(2).join(' ') === 'shell ime set fixture.RealIME')
  ).toHaveLength(1);
});

it('accepts an already absent owned session while restoring both settings', async () => {
  const result = await runFixture({ close: { error: { stderr: 'SESSION_NOT_FOUND' } } });
  expect(result.outcome).toEqual({ kind: 'passed' });
  expect(result.animation).toBe('1');
  expect(result.exitCode).toBe(1);
});

it('keeps the failed scenario receipt and restores every borrowed setting exactly once', async () => {
  const result = await runFixture();
  expect(result.outcome).toEqual({ kind: 'passed' });
  expect(result.exitCode).toBe(1);
  expect(result.report?.results).toHaveLength(1);
  expect(result.report?.results[0].error).toBe(result.launchFailure.message);
  expect(result.animation).toBe('1');
  expect(result.agent).toHaveBeenCalledOnce();
  expect(
    result.exec.mock.calls.filter(([, args]) => args.slice(2).join(' ') === 'shell ime set fixture.RealIME')
  ).toHaveLength(1);
});
