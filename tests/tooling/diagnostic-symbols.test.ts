import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  archiveDiagnosticSymbols,
  retraceNativeDiagnosticEvent,
  symbolicateDiagnosticEvent
} from '../../scripts/diagnostic-symbols.mjs';

const require = createRequire(import.meta.url);
const { SourceMapGenerator } = require('source-map');
const plugin = require('../../plugins/withDiagnosticJournal');
const fixtures: string[] = [];
afterEach(() => fixtures.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function archivedFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'wz-diagnostic-symbols-'));
  fixtures.push(root);
  const androidDir = path.join(root, 'android');
  const sourceMapDirectory = path.join(androidDir, 'app/build/generated/sourcemaps/react/release');
  const mappingDirectory = path.join(androidDir, 'app/build/outputs/mapping/release');
  mkdirSync(sourceMapDirectory, { recursive: true });
  mkdirSync(mappingDirectory, { recursive: true });
  const buildId = 'a'.repeat(32);
  writeFileSync(path.join(androidDir, 'diagnostic-build.json'), JSON.stringify({ buildId }));
  const map = new SourceMapGenerator({ file: 'index.android.bundle' });
  map.addMapping({
    generated: { line: 1, column: 91826 },
    original: { line: 1, column: 1 },
    source: 'wrong.ts',
    name: 'wrong'
  });
  map.addMapping({
    generated: { line: 1, column: 91827 },
    original: { line: 12, column: 4 },
    source: 'app.ts',
    name: 'loadTopic'
  });
  writeFileSync(path.join(sourceMapDirectory, 'index.android.bundle.map'), map.toString());
  writeFileSync(
    path.join(mappingDirectory, 'mapping.txt'),
    [
      '# compiler: R8',
      'com.wz.reader.CrashOrigin -> a.b:',
      '# {"id":"sourceFile","fileName":"CrashOrigin.kt"}',
      '    1:1:void cause():42:42 -> a',
      '    1:1:void outer():99 -> a',
      ''
    ].join('\n')
  );
  const apk = path.join(root, 'test.apk');
  writeFileSync(apk, 'apk');
  const { directory } = archiveDiagnosticSymbols({
    rootDir: root,
    androidDir,
    apkPaths: [apk],
    gitSha: 'b'.repeat(40)
  });
  return { root, directory, buildId };
}

describe('diagnostic build evidence', () => {
  it('registers before application initialization and keeps the build identity stable on repeated injection', () => {
    const template =
      'PackageList(this).packages.apply {\n}\noverride fun onCreate() {\n super.onCreate()\n loadReactNative(this)\n}';
    const first = plugin.injectDiagnosticStartup(template);
    expect(plugin.injectDiagnosticStartup(first)).toBe(first);
    expect(first.indexOf('DiagnosticJournal.install(this)')).toBeLessThan(first.indexOf('loadReactNative(this)'));
    const gradle = plugin.injectDiagnosticBuildId('android { defaultConfig { } }', 'a'.repeat(32));
    expect(plugin.injectDiagnosticBuildId(gradle, 'a'.repeat(32))).toBe(gradle);
    expect(() => plugin.injectDiagnosticBuildId('defaultConfig {}', 'PRIVATE_INVALID')).toThrow();
  });

  it('archives exact symbols and restores a bytecode offset without changing the column', () => {
    const { directory, buildId } = archivedFixture();
    const stack = 'TypeError\n    at [frame] (address at [bundle]:1:91827)';
    expect(symbolicateDiagnosticEvent({ buildId, stack }, directory)).toContain('loadTopic (app.ts:12:4)');
    expect(
      symbolicateDiagnosticEvent(
        { buildId, stack: stack.replace('address at ', ''), stackFormat: 'rn-parsed' },
        directory
      )
    ).toContain('app.ts:12:4');
    expect(symbolicateDiagnosticEvent({ buildId, stack: stack.replace('address at ', '') }, directory)).toContain(
      'wrong.ts:1:1'
    );
    expect(() => symbolicateDiagnosticEvent({ buildId: 'c'.repeat(32), stack }, directory)).toThrow('does not match');
    expect(JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')).apks[0].sha256).toMatch(
      /^[a-f0-9]{64}$/
    );
    writeFileSync(path.join(directory, 'index.android.bundle.map'), 'damaged');
    expect(() => symbolicateDiagnosticEvent({ buildId, stack }, directory)).toThrow('checksum');
  });

  it('uses official Retrace to recover class, source line and inlined frames from a sanitized native stack', () => {
    const { directory, buildId } = archivedFixture();
    const stack =
      'java.lang.IllegalStateException\n    at a.b.a([source]:1)\n    at android.app.Activity.performCreate([source]:9000)';
    const restored = retraceNativeDiagnosticEvent({ buildId, stack }, directory);
    expect(restored).toContain('com.wz.reader.CrashOrigin.cause(CrashOrigin.kt:42)');
    expect(restored).toContain('com.wz.reader.CrashOrigin.outer(CrashOrigin.kt:99)');
    expect(restored).toContain('android.app.Activity.performCreate');
    expect(() => retraceNativeDiagnosticEvent({ buildId: 'c'.repeat(32), stack }, directory)).toThrow('does not match');
    writeFileSync(path.join(directory, 'mapping.txt'), 'damaged');
    expect(() => retraceNativeDiagnosticEvent({ buildId, stack }, directory)).toThrow('checksum');
  });

  it('continues past older sessions and reports every skipped build while symbolizing matching JS and native events', () => {
    const { directory, buildId, root } = archivedFixture();
    const old = 'c'.repeat(32);
    const log = path.join(root, 'synthetic-export.jsonl');
    const stack = 'Error\n    at [frame] (address at [bundle]:1:91827)';
    writeFileSync(
      log,
      [
        { operation: 'js-error', buildId: old, stack },
        { operation: 'native-crash', buildId: old, stack: 'a.b' },
        { operation: 'unhandled-rejection', stack },
        { operation: 'js-error', buildId, stack },
        { operation: 'native-crash', buildId, stack: 'java.lang.IllegalStateException\n    at a.b.a([source]:1)' }
      ]
        .map((event) => JSON.stringify(event))
        .join('\n')
    );
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), 'scripts/symbolicate-diagnostic.mjs'), '--log', log, '--symbols', directory],
      { encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('loadTopic (app.ts:12:4)');
    expect(result.stdout).toContain('CrashOrigin.cause(CrashOrigin.kt:42)');
    const summary = JSON.parse(result.stderr.trim());
    expect(summary).toMatchObject({ buildId, symbolicated: 2, skipped: 3, skippedBuilds: { [old]: 2, unknown: 1 } });
  });
});
