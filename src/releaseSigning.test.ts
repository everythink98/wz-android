import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const temporaryProjects: string[] = [];
const require = createRequire(import.meta.url);
const { singleApkSignerSha256 } = require('../scripts/apk-signing.cjs') as {
  singleApkSignerSha256: (output: string) => string;
};

function createReleaseProject() {
  const project = mkdtempSync(path.join(tmpdir(), 'wz-release-signing-'));
  temporaryProjects.push(project);
  mkdirSync(path.join(project, 'scripts'));
  copyFileSync(path.join(projectRoot, 'scripts', 'release-android.mjs'), path.join(project, 'scripts', 'release-android.mjs'));
  copyFileSync(path.join(projectRoot, 'scripts', 'apk-signing.cjs'), path.join(project, 'scripts', 'apk-signing.cjs'));
  writeFileSync(path.join(project, 'app.json'), JSON.stringify({
    expo: {
      version: '1.0.0',
      android: { package: 'com.example.app', versionCode: 1 },
      extra: { releaseSignerSha256: 'a'.repeat(64) }
    }
  }));
  return project;
}

function runRelease(project: string, keystorePath: string) {
  return spawnSync(process.execPath, ['scripts/release-android.mjs'], {
    cwd: project,
    encoding: 'utf8',
    env: {
      ...process.env,
      WZ_ANDROID_KEYSTORE_PATH: keystorePath,
      WZ_ANDROID_KEYSTORE_PASSWORD: 'release-store-password',
      WZ_ANDROID_KEY_ALIAS: 'release-key',
      WZ_ANDROID_KEY_PASSWORD: 'release-key-password',
      WZ_ANDROID_SMOKE_DEVICE: 'test-device',
      WZ_ANDROID_SMOKE_ABI: 'invalid-abi'
    }
  });
}

afterEach(() => {
  for (const project of temporaryProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe('Android release signing preflight', () => {
  it('[REG-UPDATE-004] accepts exactly one current signer and rejects a second signer', () => {
    const official = 'ab'.repeat(32);
    const other = 'cd'.repeat(32);

    expect(singleApkSignerSha256(`Signer #1 certificate SHA-256 digest: ${official}`)).toBe(official);
    expect(singleApkSignerSha256([
      `Signer #1 certificate SHA-256 digest: ${official}`,
      `Signer #2 certificate SHA-256 digest: ${other}`
    ].join('\n'))).toBe('');
  });

  it('[REG-OPS-013] rejects a missing repository-relative keystore before other release work', () => {
    const project = createReleaseProject();

    const result = runRelease(project, 'signing/release.jks');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path.join(project, 'signing', 'release.jks'));
    expect(result.stderr).toContain('keystore 不存在');
    expect(result.stderr).not.toContain('WZ_ANDROID_SMOKE_ABI');
  });

  it('rejects a directory used as the release keystore', () => {
    const project = createReleaseProject();
    mkdirSync(path.join(project, 'signing'));

    const result = runRelease(project, 'signing');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('keystore 不是普通文件');
    expect(result.stderr).not.toContain('WZ_ANDROID_SMOKE_ABI');
  });
});
