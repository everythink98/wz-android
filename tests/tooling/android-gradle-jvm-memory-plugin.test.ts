import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { GRADLE_JVM_ARGS, setGradleJvmArgs } = require('../../plugins/withAndroidGradleJvmMemory') as {
  GRADLE_JVM_ARGS: string;
  setGradleJvmArgs: (
    properties: { type: string; key?: string; value?: string }[]
  ) => { type: string; key?: string; value?: string }[];
};

describe('Android Gradle JVM memory plugin', () => {
  it('raises the generated Gradle daemon limits without duplicating the property', () => {
    const properties = [{ type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m' }];

    setGradleJvmArgs(properties);
    setGradleJvmArgs(properties);

    expect(properties).toEqual([{ type: 'property', key: 'org.gradle.jvmargs', value: GRADLE_JVM_ARGS }]);
  });
});
