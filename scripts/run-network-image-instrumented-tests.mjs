import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android');
const expectedAvd = 'WZ_ImageRuntime_Test_API35';
const connected = execFileSync('adb', ['devices'], { encoding: 'utf8' })
  .split(/\r?\n/u)
  .map((line) => line.trim().split(/\s+/u))
  .filter(([serial, state]) => /^emulator-\d+$/u.test(serial) && state === 'device')
  .map(([serial]) => serial);
const matches = connected.filter((serial) =>
  execFileSync('adb', ['-s', serial, 'emu', 'avd', 'name'], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .some((line) => line.trim() === expectedAvd)
);
if (matches.length !== 1) throw new Error(`Expected exactly one connected ${expectedAvd}; found ${matches.length}.`);
const [serial] = matches;
const scratchRoot = path.join(root, '.codex-tmp');
mkdirSync(scratchRoot, { recursive: true });
const fixture = mkdtempSync(path.join(scratchRoot, 'network-image-test-'));
const initScript = path.join(fixture, 'init.gradle');

function gradle(args) {
  const wrapper = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const result = spawnSync(wrapper, [...args, '-PreactNativeArchitectures=x86_64', '--max-workers=4', '--no-daemon'], {
    cwd: android,
    env: { ...process.env, NODE_ENV: 'production' },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Gradle failed: ${result.status}`);
}

try {
  mkdirSync(path.join(fixture, 'res', 'xml'), { recursive: true });
  writeFileSync(
    path.join(fixture, 'res', 'xml', 'image_runtime_test_network_config.xml'),
    '<network-security-config><base-config cleartextTrafficPermitted="false"/>' +
      '<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain>' +
      '<domain includeSubdomains="false">localhost</domain></domain-config></network-security-config>'
  );
  writeFileSync(
    path.join(fixture, 'AndroidManifest.xml'),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">' +
      '<application android:networkSecurityConfig="@xml/image_runtime_test_network_config"/></manifest>'
  );
  // Only this invocation overlays the local fixture; app.json and production manifests stay unchanged.
  const relativeFixture = path.relative(android, fixture).replaceAll('\\', '/').replaceAll("'", "\\'");
  writeFileSync(
    initScript,
    `beforeProject { p ->
  p.plugins.withId('com.android.application') {
    def config = p.extensions.getByName('android')
    config.testBuildType = 'release'
    def fixture = new File(p.rootDir, '${relativeFixture}')
    config.sourceSets.getByName('release').manifest.srcFile(new File(fixture, 'AndroidManifest.xml'))
    config.sourceSets.getByName('release').res.srcDir(new File(fixture, 'res'))
  }
}
`
  );
  gradle([
    '-I',
    process.platform === 'win32' ? `"${initScript}"` : initScript,
    ':app:assembleRelease',
    ':app:assembleReleaseAndroidTest',
    '-Pandroid.enableMinifyInReleaseBuilds=false',
    '-Pandroid.enableShrinkResourcesInReleaseBuilds=false'
  ]);
  for (const apk of ['release/app-release.apk', 'androidTest/release/app-release-androidTest.apk']) {
    execFileSync('adb', ['-s', serial, 'install', '-r', path.join(android, 'app', 'build', 'outputs', 'apk', apk)], {
      stdio: 'inherit'
    });
  }
  const result = execFileSync(
    'adb',
    [
      '-s',
      serial,
      'shell',
      'am',
      'instrument',
      '-w',
      '-r',
      '-e',
      'class',
      'com.wz.reader.NetworkImageRuntimeInstrumentedTest',
      'com.wz.reader.test/androidx.test.runner.AndroidJUnitRunner'
    ],
    { encoding: 'utf8', timeout: 120_000 }
  );
  process.stdout.write(result);
  if (!/OK \([1-9]\d* tests?\)/u.test(result))
    throw new Error('Image instrumentation did not pass a nonzero test count.');
} finally {
  if (path.dirname(path.resolve(fixture)) !== path.resolve(scratchRoot))
    throw new Error('Invalid fixture cleanup path.');
  rmSync(fixture, { recursive: true, force: true });
  // Never leave a loopback-enabled test APK in the normal release output location.
  gradle([':app:assembleRelease']);
}
