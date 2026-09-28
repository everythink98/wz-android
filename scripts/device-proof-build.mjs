import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unsignedReleaseChildEnv } from './release-environment.mjs';

export function deviceProofFixture(android, fixture, { entryFile, scheme, javaFault = false }) {
  const relative = path.relative(android, fixture).replaceAll('\\', '/').replaceAll("'", "\\'");
  const buildId = randomUUID().replaceAll('-', '');
  return {
    buildId,
    manifest:
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">' +
      '<application android:debuggable="true" tools:replace="android:debuggable" tools:ignore="HardcodedDebugMode">' +
      (javaFault
        ? '<activity android:name="com.wz.reader.DiagnosticsProofFaultActivity" android:exported="true"/>'
        : '') +
      '<activity android:name="com.wz.reader.MainActivity"><intent-filter>' +
      '<action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/>' +
      `<category android:name="android.intent.category.BROWSABLE"/><data android:scheme="${scheme}"/>` +
      '</intent-filter></activity></application></manifest>',
    java: javaFault
      ? `package com.wz.reader;
public final class DiagnosticsProofFaultActivity extends android.app.Activity {
  @Override public void onCreate(android.os.Bundle state) {
    super.onCreate(state);
    throw new IllegalStateException("PRIVATE_TEST_PAYLOAD");
  }
}
`
      : undefined,
    init: `beforeProject { p ->
  p.plugins.withId('com.android.application') {
    def config = p.extensions.getByName('android')
    def fixture = new File(p.rootDir, '${relative}')
    config.sourceSets.getByName('release').manifest.srcFile(new File(fixture, 'AndroidManifest.xml'))
    config.sourceSets.getByName('release').java.srcDir(new File(fixture, 'java'))
    p.afterEvaluate {
      p.extensions.getByName('react').entryFile.set(new File(p.rootDir.parentFile, '${entryFile}'))
      config.defaultConfig.buildConfigField('String', 'DIAGNOSTIC_BUILD_ID', '"${buildId}"')
    }
  }
}
`
  };
}

export function buildDeviceProof(root, { name, entryFile, scheme }) {
  const android = path.join(root, 'android');
  const scratch = path.join(root, '.codex-tmp');
  mkdirSync(scratch, { recursive: true });
  const fixture = mkdtempSync(path.join(scratch, `${name}-build-`));
  const config = deviceProofFixture(android, fixture, { entryFile, scheme });
  writeFileSync(path.join(fixture, 'AndroidManifest.xml'), config.manifest);
  writeFileSync(path.join(fixture, 'init.gradle'), config.init);
  execFileSync(
    'java',
    [
      '-jar',
      'gradle/wrapper/gradle-wrapper.jar',
      '--no-daemon',
      '--max-workers=2',
      '-PreactNativeArchitectures=x86_64',
      '-I',
      path.join(fixture, 'init.gradle'),
      ':app:assembleRelease'
    ],
    {
      cwd: android,
      env: unsignedReleaseChildEnv(process.env, { NODE_ENV: 'production' }),
      stdio: 'inherit',
      windowsHide: true
    }
  );
  const apk = path.join(fixture, `${name}.apk`);
  copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), apk);
  return { apk, buildId: config.buildId };
}
