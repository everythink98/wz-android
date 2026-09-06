import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { enableReleaseOptimization } = require('../../plugins/withAndroidReleaseOptimization') as {
  enableReleaseOptimization: (contents: string) => string;
};

describe('Android release optimization plugin', () => {
  it('switches the default rules idempotently while preserving application keep rules', () => {
    const original = 'proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"';
    const optimized = 'proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"';

    expect(enableReleaseOptimization(original)).toBe(optimized);
    expect(enableReleaseOptimization(optimized)).toBe(optimized);
    expect(() => enableReleaseOptimization('proguardFiles "custom-rules.pro"')).toThrow('Expo template');
  });
});
