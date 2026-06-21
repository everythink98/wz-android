import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release packaging guards', () => {
  it('keeps release checks before Android files are regenerated', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const testIndex = releaseScript.indexOf("run('npm', ['test']);");
    const unusedIndex = releaseScript.indexOf("run('npm', ['run', 'check:unused']);");
    const versionIndex = releaseScript.indexOf("run('node', ['scripts/check-version.mjs']);");
    const prebuildIndex = releaseScript.indexOf("run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);");

    expect(testIndex).toBeGreaterThanOrEqual(0);
    expect(unusedIndex).toBeGreaterThan(testIndex);
    expect(versionIndex).toBeGreaterThan(unusedIndex);
    expect(prebuildIndex).toBeGreaterThan(versionIndex);
  });

  it('keeps release APK signing and arm64-only output guarded', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const gradle = readProjectFile('scripts', 'android-release-apk.gradle');

    expect(releaseScript).toContain('app-arm64-v8a-release.apk');
    expect(releaseScript).toContain('.env.release.local');
    expect(releaseScript).toContain('verifyReleaseSigningEnv();');
    expect(releaseScript).toContain('androiddebugkey');
    expect(releaseScript).toContain('debug.keystore');
    expect(releaseScript).toContain("'-PreactNativeArchitectures=arm64-v8a'");
    expect(releaseScript).not.toContain('armeabi-v7a');
    expect(gradle).toContain('include "arm64-v8a"');
    expect(gradle).not.toContain('armeabi-v7a');
  });

  it('keeps TSX tests discoverable when UI tests are added', () => {
    const vitestConfig = readProjectFile('vitest.config.ts');

    expect(vitestConfig).toContain('src/**/*.test.tsx');
  });
});
