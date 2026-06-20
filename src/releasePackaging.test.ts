import { describe, expect, it } from 'vitest';
import { readOptionalProjectFile, readProjectFile } from './sourceTestUtils';

describe('Android release packaging', () => {
  it('builds only the 64-bit physical-device CPU architecture', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const script = packageJson.scripts['release:android'];
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const gradle = readProjectFile('scripts', 'android-release-apk.gradle');

    expect(script).toBe('node scripts/release-android.mjs');
    expect(releaseScript).toContain("'expo', 'prebuild', '--platform', 'android', '--clean'");
    expect(releaseScript).toContain("'-PreactNativeArchitectures=arm64-v8a'");
    expect(releaseScript).not.toContain('armeabi-v7a');
    expect(releaseScript).toContain("'../scripts/android-release-apk.gradle'");
    expect(gradle).toContain('include "arm64-v8a"');
    expect(gradle).not.toContain('armeabi-v7a');
  });

  it('regenerates Android config before release so app.json version reaches the APK', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const adaptiveIconIndex = releaseScript.indexOf("run('node', ['scripts/generate-adaptive-icon.mjs']);");
    const prebuildIndex = releaseScript.indexOf("run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);");
    const assembleIndex = releaseScript.indexOf("':app:assembleRelease'");

    expect(adaptiveIconIndex).toBeGreaterThanOrEqual(0);
    expect(prebuildIndex).toBeGreaterThanOrEqual(0);
    expect(prebuildIndex).toBeGreaterThan(adaptiveIconIndex);
    expect(assembleIndex).toBeGreaterThan(prebuildIndex);
    expect(releaseScript).not.toContain('if (!fs.existsSync(gradleFile))');
  });

  it('runs release gates before generating Android files', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const testIndex = releaseScript.indexOf("run('npm', ['test']);");
    const typecheckIndex = releaseScript.indexOf("run('npm', ['run', 'typecheck']);");
    const unusedIndex = releaseScript.indexOf("run('npm', ['run', 'check:unused']);");
    const versionIndex = releaseScript.indexOf("run('node', ['scripts/check-version.mjs']);");
    const adaptiveIconIndex = releaseScript.indexOf("run('node', ['scripts/generate-adaptive-icon.mjs']);");

    expect(testIndex).toBeGreaterThanOrEqual(0);
    expect(typecheckIndex).toBe(-1);
    expect(unusedIndex).toBeGreaterThan(testIndex);
    expect(versionIndex).toBeGreaterThan(unusedIndex);
    expect(adaptiveIconIndex).toBeGreaterThan(versionIndex);
  });

  it('requires formal Android signing for release APKs', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const gradle = readProjectFile('scripts', 'android-release-apk.gradle');
    const gitignore = readProjectFile('.gitignore');

    expect(releaseScript).toContain('app-arm64-v8a-release.apk');
    expect(releaseScript).toContain('.env.release.local');
    expect(releaseScript).toContain('WZ_ANDROID_KEYSTORE_PATH');
    expect(releaseScript).toContain("'--no-daemon'");
    expect(releaseScript.indexOf('verifyReleaseSigningEnv();')).toBeLessThan(releaseScript.indexOf("run('npm', ['test']);"));
    expect(releaseScript).toContain('androiddebugkey');
    expect(releaseScript).toContain('debug.keystore');
    expect(releaseScript).not.toContain('app-arm64-v8a-release-unsigned.apk');
    expect(gradle).toContain('WZ_ANDROID_KEYSTORE_PATH');
    expect(gradle).toContain('releaseSigningReady');
    expect(gradle).toContain('throw new GradleException');
    expect(gradle).toContain('androiddebugkey');
    expect(gradle).toContain('debug.keystore');
    const finalizeDslIndex = gradle.indexOf('androidComponents.finalizeDsl');
    const releaseSigningIndex = gradle.indexOf('signingConfig = releaseSigningConfig');
    expect(finalizeDslIndex).toBeGreaterThanOrEqual(0);
    expect(releaseSigningIndex).toBeGreaterThan(finalizeDslIndex);
    expect(gradle).toContain('signingConfig = releaseSigningConfig');
    expect(gradle).not.toMatch(/storePassword\s+['"][^'"]+['"]/);
    expect(gradle).not.toMatch(/keyPassword\s+['"][^'"]+['"]/);
    expect(gitignore).toContain('.env*.local');
  });

  it('keeps Android permissions scoped down and release cleartext traffic disabled', () => {
    const appConfig = JSON.parse(readProjectFile('app.json'));
    const mainManifest = readOptionalProjectFile('android', 'app', 'src', 'main', 'AndroidManifest.xml');

    expect(appConfig.expo.plugins).not.toContain('./plugins/withAndroidCleartextTraffic');
    expect(appConfig.expo.android.blockedPermissions).toContain('android.permission.SYSTEM_ALERT_WINDOW');
    if (mainManifest) {
      expect(mainManifest).not.toContain('android:usesCleartextTraffic="true"');
      expect(mainManifest).toMatch(
        /<uses-permission(?=[^>]*android:name="android\.permission\.SYSTEM_ALERT_WINDOW")(?=[^>]*tools:node="remove")[^>]*\/>/,
      );
    }
  });

  it('keeps APK self-update install support in generated Android config', () => {
    const appConfig = JSON.parse(readProjectFile('app.json'));
    const plugin = readProjectFile('plugins', 'withApkInstaller.js');

    expect(appConfig.expo.plugins).toContain('./plugins/withApkInstaller');
    expect(plugin).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    expect(plugin).toContain('androidx.core.content.FileProvider');
    expect(plugin).toContain('ACTION_MANAGE_UNKNOWN_APP_SOURCES');
  });

  it('fails config plugin injection when the Expo MainApplication template changes', () => {
    const apkInstallerPlugin = readProjectFile('plugins', 'withApkInstaller.js');
    const linuxDoCookiePlugin = readProjectFile('plugins', 'withLinuxDoCookieModule.js');

    expect(apkInstallerPlugin).not.toContain('return contents.replace(');
    expect(linuxDoCookiePlugin).not.toContain('return contents.replace(');
    expect(apkInstallerPlugin).toContain('throw new Error');
    expect(linuxDoCookiePlugin).toContain('throw new Error');
  });
});
