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

  it('generates a release manifest with APK hash, package, version, and signer digest', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');

    expect(releaseScript).toContain('release-manifest.json');
    expect(releaseScript).toContain('apkName');
    expect(releaseScript).toContain('sha256');
    expect(releaseScript).toContain('packageName');
    expect(releaseScript).toContain('versionName');
    expect(releaseScript).toContain('versionCode');
    expect(releaseScript).toContain('signerSha256');
    expect(releaseScript).toContain('Signer #1 certificate SHA-256 digest');
  });

  it('keeps APK inspection available before opening the Android installer', () => {
    const plugin = readProjectFile('plugins', 'withApkInstaller.js');

    expect(plugin).toContain('fun inspectApk');
    expect(plugin).toContain('fileSha256');
    expect(plugin).toContain('signerSha256');
    expect(plugin).toContain('GET_SIGNING_CERTIFICATES');
  });

  it('limits media library permissions to photos', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const mediaPlugin = app.expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-media-library');

    expect(mediaPlugin?.[1]?.granularPermissions).toEqual(['photo']);
    expect(app.expo.android.blockedPermissions).toContain('android.permission.READ_MEDIA_AUDIO');
    expect(app.expo.android.blockedPermissions).toContain('android.permission.READ_MEDIA_VIDEO');
  });

  it('keeps TSX tests discoverable when UI tests are added', () => {
    const vitestConfig = readProjectFile('vitest.config.ts');

    expect(vitestConfig).toContain('src/**/*.test.tsx');
  });
});
