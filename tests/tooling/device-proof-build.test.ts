// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDeviceProof } from '../../scripts/device-proof-build.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('builds a normal proof with its own entry and identity, without signing credentials or a crash activity', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wz proof build-'));
  directories.push(root);
  const output = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
  vi.stubEnv('ENTRY_FILE', 'unexpected-entry.ts');
  vi.stubEnv('WZ_ANDROID_KEYSTORE_PASSWORD', 'fixture-secret');
  vi.mocked(execFileSync).mockImplementation(() => {
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, 'proof-apk');
    return Buffer.alloc(0);
  });
  const { apk, buildId } = buildDeviceProof(root, {
    name: 'composer-proof',
    entryFile: 'dev/composer-proof/index.tsx',
    scheme: 'wzcomposerproof'
  });
  const directory = path.dirname(apk);
  const manifest = readFileSync(path.join(directory, 'AndroidManifest.xml'), 'utf8');
  const init = readFileSync(path.join(directory, 'init.gradle'), 'utf8');
  expect(manifest).toContain('android:scheme="wzcomposerproof"');
  expect(manifest).not.toContain('DiagnosticsProofFaultActivity');
  expect(init).toContain('dev/composer-proof/index.tsx');
  expect(init).toContain(buildId);
  expect(init).not.toContain('diagnostics-proof');
  expect(readFileSync(apk, 'utf8')).toBe('proof-apk');
  expect(execFileSync).toHaveBeenCalledWith(
    'java',
    expect.arrayContaining(['-I', path.join(directory, 'init.gradle'), ':app:assembleRelease', '--no-daemon']),
    expect.objectContaining({
      cwd: path.join(root, 'android'),
      env: expect.objectContaining({ NODE_ENV: 'production' })
    })
  );
  const options = vi.mocked(execFileSync).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
  expect(options.env).not.toHaveProperty('ENTRY_FILE');
  expect(options.env).not.toHaveProperty('WZ_ANDROID_KEYSTORE_PASSWORD');
  expect(process.env.ENTRY_FILE).toBe('unexpected-entry.ts');
});
