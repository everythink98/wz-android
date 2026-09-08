import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  diagnosticProofFixture,
  selectDiagnosticProofSerial,
  verifyDiagnosticProof
} from '../../scripts/run-diagnostic-device-proof.mjs';

const require = createRequire(import.meta.url);
const { SourceMapGenerator } = require('source-map');
const fixtures: string[] = [];
afterEach(() => fixtures.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const buildId = 'a'.repeat(32);
const prior = `process-${'b'.repeat(32)}`;
const current = `process-${'c'.repeat(32)}`;
const appSessionId = 'session-proof-aaaa';
const pendingTraceId = 'trace-2';
const line = (event: Record<string, unknown>) =>
  `${JSON.stringify({ buildId, processSessionId: prior, appSessionId, ...event })}\n`;

function evidence(mode: 'java' | 'js' | 'renderer' | 'promise') {
  const operation = mode === 'java' ? 'native-crash' : mode === 'promise' ? 'unhandled-rejection' : 'js-error';
  const fault = line({
    operation,
    traceId: mode === 'java' ? `native-${'d'.repeat(32)}` : 'trace-3',
    phase: 'finish',
    ...(mode === 'java' ? { appSessionId: prior } : {}),
    isFatal: mode !== 'promise',
    stackFormat: 'rn-parsed',
    stack:
      mode === 'java'
        ? 'java.lang.IllegalStateException\n    at a.b.a([source]:12)'
        : 'Error\n    at [frame] ([bundle]:1:100)'
  });
  const pending = ['intent', 'apply']
    .map((phase) => line({ operation: 'startup', traceId: pendingTraceId, phase }))
    .join('');
  const ready = {
    buildId,
    processSessionId: prior,
    appSessionId,
    pendingTraceId,
    isHermes: true,
    isDev: false,
    health: { available: true }
  };
  const after = {
    ...ready,
    processSessionId: current,
    appSessionId: 'session-restart-bbbb',
    jsLines: pending + (mode === 'promise' ? fault : ''),
    crashLines: mode === 'promise' ? '' : fault,
    nativeLines: line({
      operation: 'previous-exit',
      processSessionId: current,
      previousProcessSessionId: prior,
      state: 'available',
      exitReason: mode === 'promise' ? 'user-stopped' : 'crash'
    })
  };
  return { mode, ready, after };
}

function symbols() {
  const directory = mkdtempSync(path.join(tmpdir(), 'wz-diagnostic-proof-'));
  fixtures.push(directory);
  const map = new SourceMapGenerator({ file: 'index.android.bundle' });
  map.addMapping({
    generated: { line: 1, column: 100 },
    original: { line: 20, column: 2 },
    source: 'dev/diagnostics-proof/index.tsx',
    name: 'diagnosticProofFault'
  });
  const sourceMap = map.toString();
  writeFileSync(path.join(directory, 'index.android.bundle.map'), sourceMap);
  const mapping = [
    '# compiler: R8',
    'com.wz.reader.DiagnosticsProofFaultActivity -> a.b:',
    '# {"id":"sourceFile","fileName":"DiagnosticsProofFaultActivity.java"}',
    '    12:12:void onCreate(android.os.Bundle):5:5 -> a',
    ''
  ].join('\n');
  writeFileSync(path.join(directory, 'mapping.txt'), mapping);
  writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      buildId,
      sourceMapSha256: createHash('sha256').update(sourceMap).digest('hex'),
      mappingSha256: createHash('sha256').update(mapping).digest('hex')
    })
  );
  return directory;
}

describe('isolated diagnostic device proof', () => {
  it('selects only the dedicated online AVD and rejects missing or ambiguous matches', () => {
    const devices =
      'List of devices attached\nmain-phone device\nemulator-5554 device\nemulator-5556 device\nemulator-5558 offline\n';
    const names = { 'emulator-5554': 'User_Main_API35\nOK', 'emulator-5556': 'WZ_ImageRuntime_Test_API35\nOK' };
    expect(selectDiagnosticProofSerial(devices, (serial: keyof typeof names) => names[serial])).toBe('emulator-5556');
    expect(() => selectDiagnosticProofSerial(devices, () => 'User_Main_API35')).toThrow(/exactly one/);
    expect(() => selectDiagnosticProofSerial(devices, () => 'WZ_ImageRuntime_Test_API35')).toThrow(/exactly one/);
  });

  it('confines the alternate entry, debuggable manifest and Java crash activity to a temporary release overlay', () => {
    const fixture = diagnosticProofFixture('C:/src/wz-android/android', 'C:/src/wz-android/.codex-tmp/proof-123');
    expect(fixture.init).toContain('afterEvaluate');
    expect(fixture.init).toContain('dev/diagnostics-proof/index.tsx');
    expect(fixture.init).toContain("getByName('release')");
    expect(fixture.buildId).toMatch(/^[a-f0-9]{32}$/);
    expect(fixture.init).toContain(`'"${fixture.buildId}"'`);
    expect(fixture.manifest).toContain('android:debuggable="true"');
    expect(fixture.manifest).toContain('DiagnosticsProofFaultActivity');
    expect(fixture.java).toContain('throw new IllegalStateException("PRIVATE_TEST_PAYLOAD")');
    expect(readFileSync(path.join(process.cwd(), 'index.ts'), 'utf8')).not.toContain('diagnostics-proof');
  });

  it.each(['java', 'js', 'renderer', 'promise'] as const)(
    'proves %s retention in a different process with matching symbols',
    (mode) => {
      const result = verifyDiagnosticProof({ ...evidence(mode), symbolsDirectory: symbols() });
      expect(result.mode).toBe(mode);
      expect(result.previousExit).toBe(mode === 'promise' ? 'user-stopped' : 'crash');
      expect(result).toMatchObject({ appSessionId, pendingTraceId, lastPendingPhase: 'apply', faultEventCount: 1 });
      if (mode !== 'java') expect(result.symbolicatedStack).toContain('dev/diagnostics-proof/index.tsx:20:2');
      else
        expect(result.symbolicatedStack).toContain(
          'DiagnosticsProofFaultActivity.onCreate(DiagnosticsProofFaultActivity.java:5)'
        );
    }
  );

  it('requires the exact archived R8 mapping before accepting the Java fault source', () => {
    const input = { ...evidence('java'), symbolsDirectory: symbols() };
    writeFileSync(path.join(input.symbolsDirectory, 'mapping.txt'), 'damaged');
    expect(() => verifyDiagnosticProof(input)).toThrow(/checksum/);
    input.symbolsDirectory = symbols();
    const manifestPath = path.join(input.symbolsDirectory, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, buildId: 'e'.repeat(32) }));
    expect(() => verifyDiagnosticProof(input)).toThrow(/does not match/);
  });

  it('rejects missing or completed pre-fault operations and mismatched JS sessions', () => {
    const input = { ...evidence('js'), symbolsDirectory: symbols() };
    expect(() =>
      verifyDiagnosticProof({
        ...input,
        after: { ...input.after, jsLines: line({ operation: 'startup', traceId: pendingTraceId, phase: 'intent' }) }
      })
    ).toThrow(/pending operation/);
    expect(() =>
      verifyDiagnosticProof({
        ...input,
        after: {
          ...input.after,
          jsLines: input.after.jsLines + line({ operation: 'startup', traceId: pendingTraceId, phase: 'finish' })
        }
      })
    ).toThrow(/pending operation/);
    expect(() =>
      verifyDiagnosticProof({
        ...input,
        after: { ...input.after, jsLines: input.after.jsLines.replaceAll(appSessionId, 'session-wrong-cccc') }
      })
    ).toThrow(/pending operation/);
    expect(() =>
      verifyDiagnosticProof({
        ...input,
        after: { ...input.after, crashLines: input.after.crashLines.replaceAll(appSessionId, 'session-wrong-cccc') }
      })
    ).toThrow(/fault.*session/i);
  });

  it('allows the same fault copied across persistent channels but rejects a second exception record', () => {
    const input = { ...evidence('renderer'), symbolsDirectory: symbols() };
    input.after.jsLines += input.after.crashLines;
    expect(verifyDiagnosticProof(input).faultEventCount).toBe(1);
    input.after.jsLines += input.after.crashLines.replace('trace-3', 'trace-4');
    expect(() => verifyDiagnosticProof(input)).toThrow(/exactly one/);
  });

  it('rejects stale sessions, missing crash evidence, incorrect exit attribution and a mismatched build', () => {
    const input = { ...evidence('java'), symbolsDirectory: symbols() };
    expect(() => verifyDiagnosticProof({ ...input, after: { ...input.after, processSessionId: prior } })).toThrow(
      /restart/
    );
    expect(() => verifyDiagnosticProof({ ...input, after: { ...input.after, crashLines: '' } })).toThrow(/fault/);
    expect(() =>
      verifyDiagnosticProof({
        ...input,
        after: { ...input.after, nativeLines: input.after.nativeLines.replace(prior, `process-${'d'.repeat(32)}`) }
      })
    ).toThrow(/previous-exit/);
    expect(() => verifyDiagnosticProof({ ...input, after: { ...input.after, buildId: 'd'.repeat(32) } })).toThrow(
      /build/
    );
  });

  it('retains the actual system exit reason when Android later kills a process with a fatal JS error', () => {
    const input = { ...evidence('js'), symbolsDirectory: symbols() };
    input.after.nativeLines = input.after.nativeLines.replace(
      '"exitReason":"crash"',
      '"exitReason":"other","exitReasonCode":9'
    );
    expect(verifyDiagnosticProof(input).previousExit).toBe('other');
  });

  it('rejects private payload leakage, dev mode, unavailable storage and non-proof symbol mappings', () => {
    const input = { ...evidence('promise'), symbolsDirectory: symbols() };
    expect(() =>
      verifyDiagnosticProof({
        ...input,
        after: { ...input.after, jsLines: input.after.jsLines + line({ message: 'PRIVATE_TEST_PAYLOAD' }) }
      })
    ).toThrow(/private/);
    expect(() => verifyDiagnosticProof({ ...input, ready: { ...input.ready, isDev: true } })).toThrow(/Release Hermes/);
    expect(() => verifyDiagnosticProof({ ...input, after: { ...input.after, health: { available: false } } })).toThrow(
      /storage/
    );
    expect(() =>
      verifyDiagnosticProof({
        ...input,
        after: { ...input.after, jsLines: input.after.jsLines.replace('[bundle]:1:100', '[bundle]:1:0') }
      })
    ).toThrow(/proof source/);
  });
});
