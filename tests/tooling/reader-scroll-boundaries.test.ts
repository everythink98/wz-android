// @vitest-environment node
import { expect, it, vi } from 'vitest';

async function runFixture({
  expandedByRunner = true,
  body = new Error('snapshot failed'),
  remote,
  expand,
  appearance
}: {
  expandedByRunner?: boolean;
  body?: unknown;
  remote?: { error: unknown };
  expand?: { error: unknown };
  appearance?: { error: unknown };
} = {}) {
  const originalArgv = process.argv;
  let snapshots = 0;
  const exec = vi.fn((_command: string, args: readonly string[]) => {
    if (args.includes('emu')) return 'WZ_Pixel_API_35\nOK\n';
    if (args.includes('rm') && remote) throw remote.error;
    return '';
  });
  const device = vi.fn((args: readonly string[]) => {
    if (args[0] === 'snapshot') {
      if (snapshots++ === 0)
        return JSON.stringify({ data: { nodes: [{ label: expandedByRunner ? '展开外观' : '收起外观' }] } });
      throw body;
    }
    if (args[1] === 'label="展开外观"' && expand) throw expand.error;
    if (args[1] === 'label="收起外观"' && appearance) throw appearance.error;
    return '';
  });
  vi.resetModules();
  vi.stubEnv('ANDROID_SERIAL', 'emulator-5554');
  vi.stubEnv('ANDROID_HOME', 'fixture-sdk');
  vi.doMock('node:child_process', () => ({ execFileSync: exec }));
  vi.doMock('../../scripts/agent-device-runtime.mjs', () => ({
    prepareDeviceEvidence: vi.fn(),
    runAgentDevice: device
  }));
  vi.doMock('../../scripts/touch-trace.mjs', () => ({ compileTouchTrace: vi.fn(), touchTraceTimes: vi.fn() }));
  let outcome: { kind: 'passed' } | { kind: 'failed'; error: unknown } = { kind: 'passed' };
  try {
    process.argv = [process.execPath, 'scripts/check-reader-scroll-boundaries.mjs', 'fixture', 'fixture-output'];
    await import('../../scripts/check-reader-scroll-boundaries.mjs');
  } catch (error) {
    outcome = { kind: 'failed', error };
  } finally {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.doUnmock('node:child_process');
    vi.doUnmock('../../scripts/agent-device-runtime.mjs');
    vi.doUnmock('../../scripts/touch-trace.mjs');
    vi.resetModules();
  }
  return { outcome, exec, device, body };
}

it('retains collapse responsibility when the runner expansion command fails', async () => {
  const failure = new Error('appearance expansion');
  const result = await runFixture({ expand: { error: failure } });
  const remote = result.exec.mock.calls.findIndex(([, args]) => args.includes('rm'));
  const collapse = result.device.mock.calls.findIndex(([args]) => args[1] === 'label="收起外观"');
  expect(remote).toBeGreaterThanOrEqual(0);
  expect(collapse).toBeGreaterThanOrEqual(0);
  expect(result.exec.mock.invocationCallOrder[remote]).toBeLessThan(result.device.mock.invocationCallOrder[collapse]);
  if (result.outcome.kind !== 'failed') throw new Error('Expected expansion failure');
  expect(result.outcome.error).toBe(failure);
});

it('collapses runner-owned appearance even when removing its remote trace fails', async () => {
  const remote = new Error('remote cleanup');
  const result = await runFixture({ remote: { error: remote } });
  expect(result.device.mock.calls.some(([args]) => args[1] === 'label="收起外观"')).toBe(true);
  if (result.outcome.kind !== 'failed') throw new Error('Expected failures');
  if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected all causes');
  expect(result.outcome.error.errors).toEqual([result.body, remote]);
});

it('retains the body and both cleanup errors, including falsy thrown values', async () => {
  const result = await runFixture({ body: null, remote: { error: false }, appearance: { error: undefined } });
  expect(result.exec.mock.calls.some(([, args]) => args.includes('rm'))).toBe(true);
  expect(result.device.mock.calls.some(([args]) => args[1] === 'label="收起外观"')).toBe(true);
  if (result.outcome.kind !== 'failed') throw new Error('Expected failures');
  if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected all causes');
  expect(result.outcome.error.errors).toEqual([null, false, undefined]);
});

it('preserves user-owned appearance and the exact body failure when cleanup succeeds', async () => {
  const body = new Error('snapshot failed');
  const result = await runFixture({ expandedByRunner: false, body });
  expect(result.exec.mock.calls.some(([, args]) => args.includes('rm'))).toBe(true);
  expect(result.device.mock.calls.some(([args]) => args[1] === 'label="收起外观"')).toBe(false);
  expect(result.outcome).toEqual({ kind: 'failed', error: body });
});
