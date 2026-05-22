import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android release packaging', () => {
  it('builds only the 64-bit physical-device CPU architecture', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'android-app', 'package.json'), 'utf8'));
    const script = packageJson.scripts['release:android'];
    const gradle = readFileSync(join(process.cwd(), 'android-app', 'scripts', 'android-release-apk.gradle'), 'utf8');

    expect(script).toContain('-PreactNativeArchitectures=arm64-v8a');
    expect(script).not.toContain('armeabi-v7a');
    expect(script).toContain('-I ../scripts/android-release-apk.gradle');
    expect(gradle).toContain('include "arm64-v8a"');
    expect(gradle).not.toContain('armeabi-v7a');
  });

  it('keeps formal signing optional and outside generated Android files', () => {
    const gradle = readFileSync(join(process.cwd(), 'android-app', 'scripts', 'android-release-apk.gradle'), 'utf8');

    expect(gradle).toContain('WZ_ANDROID_KEYSTORE_PATH');
    expect(gradle).toContain('releaseSigningReady');
    expect(gradle).toContain('signingConfig signingConfigs.release');
    expect(gradle).not.toMatch(/storePassword\s+['"][^'"]+['"]/);
    expect(gradle).not.toMatch(/keyPassword\s+['"][^'"]+['"]/);
  });
});
