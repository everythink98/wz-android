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
    const prebuildIndex = releaseScript.indexOf("run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);");
    const assembleIndex = releaseScript.indexOf("':app:assembleRelease'");

    expect(prebuildIndex).toBeGreaterThanOrEqual(0);
    expect(assembleIndex).toBeGreaterThan(prebuildIndex);
    expect(releaseScript).not.toContain('if (!fs.existsSync(gradleFile))');
  });

  it('keeps formal signing optional and outside generated Android files', () => {
    const gradle = readProjectFile('scripts', 'android-release-apk.gradle');

    expect(gradle).toContain('WZ_ANDROID_KEYSTORE_PATH');
    expect(gradle).toContain('releaseSigningReady');
    expect(gradle).toContain('signingConfig signingConfigs.release');
    expect(gradle).not.toMatch(/storePassword\s+['"][^'"]+['"]/);
    expect(gradle).not.toMatch(/keyPassword\s+['"][^'"]+['"]/);
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
});
