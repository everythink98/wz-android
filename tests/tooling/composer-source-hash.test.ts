import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { composerSourceHash } from '../../scripts/run-composer-device-proof.mjs';

it('invalidates a proof APK when native code, resources or its build input changes, without hashing native build output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wz-composer-hash-'));
  const write = (file: string, contents = '') => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  try {
    for (const directory of ['src', 'plugins', 'patches', 'dev/composer-proof'])
      mkdirSync(path.join(root, directory), { recursive: true });
    for (const name of ['forum-platform', 'forum-content-selection']) {
      mkdirSync(path.join(root, 'modules', name, 'android/src/main'), { recursive: true });
      write(`modules/${name}/android/build.gradle`);
      write(`modules/${name}/expo-module.config.json`, '{}');
    }
    for (const file of [
      'tests/ui/composerSubmissionFixture.tsx',
      'tests/ui/composerMessageFixture.tsx',
      'tests/ui/topicCreationFixture.tsx',
      'tests/helpers/topicCreationTransport.ts',
      'tests/helpers/topicEditingTransport.ts',
      'tests/helpers/accountSessions.ts',
      'modules/forum-platform/android/consumer-rules.pro',
      'scripts/device-proof-build.mjs',
      'scripts/release-environment.mjs',
      'package-lock.json',
      'app.json'
    ])
      write(file);
    let previous = composerSourceHash(root);
    for (const file of [
      'modules/forum-platform/android/src/main/Example.kt',
      'modules/forum-platform/android/src/main/AndroidManifest.xml',
      'modules/forum-platform/android/src/main/res/xml/provider.xml',
      'modules/forum-content-selection/android/src/main/Selection.kt',
      'scripts/device-proof-build.mjs'
    ]) {
      write(file, 'changed build input');
      const next = composerSourceHash(root);
      expect(next).not.toBe(previous);
      previous = next;
    }
    write('modules/forum-platform/android/build/generated/output.kt', 'generated');
    write('modules/forum-platform/android/src/test/ExampleTest.kt', 'test-only');
    expect(composerSourceHash(root)).toBe(previous);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
