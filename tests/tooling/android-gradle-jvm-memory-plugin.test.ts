import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const withAndroidGradleJvmMemory = require('../../plugins/withAndroidGradleJvmMemory');

describe('Android Gradle JVM memory plugin', () => {
  it.each([undefined, '-Xmx2048m'])(
    'sets the prebuild JVM limits from %s without losing other properties',
    async (value) => {
      const app = require('../../app.json').expo;
      expect(app.plugins).toContain('./plugins/withAndroidGradleJvmMemory');
      const preserved = { type: 'property', key: 'android.useAndroidX', value: 'true' };
      const properties = [preserved, ...(value ? [{ type: 'property', key: 'org.gradle.jvmargs', value }] : [])];
      const config = withAndroidGradleJvmMemory({ name: 'test', slug: 'test' });
      const first = await config.mods.android.gradleProperties({ ...config, modResults: properties });
      const second = await config.mods.android.gradleProperties(first);

      expect(second.modResults).toEqual([
        preserved,
        { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m -XX:MaxMetaspaceSize=1024m' }
      ]);
    }
  );
});
