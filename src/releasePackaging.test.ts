import { describe, expect, it } from 'vitest';
import { readOptionalProjectFile, readProjectFile } from './sourceTestUtils';

describe('Android release packaging', () => {
  it('builds only the 64-bit physical-device CPU architecture', () => {
    const packageJson = JSON.parse(readProjectFile('android-app', 'package.json'));
    const script = packageJson.scripts['release:android'];
    const gradle = readProjectFile('android-app', 'scripts', 'android-release-apk.gradle');

    expect(script).toContain('-PreactNativeArchitectures=arm64-v8a');
    expect(script).not.toContain('armeabi-v7a');
    expect(script).toContain('-I ../scripts/android-release-apk.gradle');
    expect(gradle).toContain('include "arm64-v8a"');
    expect(gradle).not.toContain('armeabi-v7a');
  });

  it('keeps formal signing optional and outside generated Android files', () => {
    const gradle = readProjectFile('android-app', 'scripts', 'android-release-apk.gradle');

    expect(gradle).toContain('WZ_ANDROID_KEYSTORE_PATH');
    expect(gradle).toContain('releaseSigningReady');
    expect(gradle).toContain('signingConfig signingConfigs.release');
    expect(gradle).not.toMatch(/storePassword\s+['"][^'"]+['"]/);
    expect(gradle).not.toMatch(/keyPassword\s+['"][^'"]+['"]/);
  });

  it('keeps Android permissions scoped down and release cleartext traffic disabled', () => {
    const appConfig = JSON.parse(readProjectFile('android-app', 'app.json'));
    const mainManifest = readOptionalProjectFile('android-app', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const debugManifests = [
      readOptionalProjectFile('android-app', 'android', 'app', 'src', 'debug', 'AndroidManifest.xml'),
      readOptionalProjectFile('android-app', 'android', 'app', 'src', 'debugOptimized', 'AndroidManifest.xml'),
    ];

    expect(appConfig.expo.plugins).not.toContain('./plugins/withAndroidCleartextTraffic');
    expect(appConfig.expo.android.blockedPermissions).toContain('android.permission.SYSTEM_ALERT_WINDOW');
    if (mainManifest) {
      expect(mainManifest).not.toContain('android:usesCleartextTraffic="true"');
      expect(mainManifest).toMatch(
        /<uses-permission(?=[^>]*android:name="android\.permission\.SYSTEM_ALERT_WINDOW")(?=[^>]*tools:node="remove")[^>]*\/>/,
      );
    }
    for (const manifest of debugManifests) {
      if (!manifest) {
        continue;
      }
      expect(manifest).not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
    }
  });
});
