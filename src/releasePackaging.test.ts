import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android release packaging', () => {
  it('builds only physical-device CPU architectures', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'android-app', 'package.json'), 'utf8'));
    const script = packageJson.scripts['release:android'];

    expect(script).toContain('-PreactNativeArchitectures=armeabi-v7a,arm64-v8a');
    expect(script).toContain('-I ../scripts/android-release-apk.gradle');
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
