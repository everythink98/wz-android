import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apkSigning from './apk-signing.cjs';

const usage =
  'Usage: node scripts/run-network-image-instrumented-tests.mjs [--platform-exports | --platform-export-ui | --platform-file-faults | --svg-only]';
if (process.argv.length === 3 && process.argv[2] === '--help') {
  console.log(usage);
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android');
const expectedAvd = 'WZ_ImageRuntime_Test_API35';
const svgOnly = process.argv.includes('--svg-only');
const platformExportUi = process.argv.includes('--platform-export-ui');
const platformExports = platformExportUi || process.argv.includes('--platform-exports');
const platformFileFaults = process.argv.includes('--platform-file-faults');
const platformProof = platformExports || platformFileFaults;
if (
  process.argv.length > 3 ||
  process.argv
    .slice(2)
    .some(
      (arg) => !['--platform-exports', '--platform-export-ui', '--platform-file-faults', '--svg-only'].includes(arg)
    )
)
  throw new Error(usage);
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
const proofBuildId = randomUUID().replaceAll('-', '');
const initScript = path.join(fixture, 'init.gradle');
let restoreImagePermission = false;

function gradle(args) {
  const wrapper = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const result = spawnSync(
    wrapper,
    [
      ...args,
      '-I',
      '../tests/native/forum-platform.gradle',
      '-PreactNativeArchitectures=x86_64',
      '--max-workers=4',
      '--no-daemon'
    ],
    {
      cwd: android,
      env: Object.fromEntries(
        Object.entries({ ...process.env, NODE_ENV: 'production' }).filter(
          ([name]) => !name.startsWith('WZ_ANDROID_KEY')
        )
      ),
      shell: process.platform === 'win32',
      stdio: 'inherit'
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Gradle failed: ${result.status}`);
}

try {
  mkdirSync(path.join(fixture, 'res', 'xml'), { recursive: true });
  writeFileSync(
    path.join(fixture, 'res', 'xml', 'image_runtime_test_network_config.xml'),
    '<network-security-config><base-config cleartextTrafficPermitted="false"/>' +
      '<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain>' +
      (platformFileFaults ? '' : '<domain includeSubdomains="false">localhost</domain>') +
      '</domain-config></network-security-config>'
  );
  writeFileSync(
    path.join(fixture, 'AndroidManifest.xml'),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">' +
      '<application android:networkSecurityConfig="@xml/image_runtime_test_network_config">' +
      (platformProof
        ? '<activity android:name="com.wz.reader.MainActivity"><intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="wzreviewproof"/></intent-filter></activity>'
        : '') +
      '</application></manifest>'
  );
  // Only this invocation overlays the local fixture; app.json and production manifests stay unchanged.
  const relativeFixture = path.relative(android, fixture).replaceAll('\\', '/').replaceAll("'", "\\'");
  writeFileSync(
    initScript,
    `beforeProject { p ->
  p.plugins.withId('com.android.application') {
    def config = p.extensions.getByName('android')
    config.testBuildType = 'release'
    p.extensions.getByName('androidComponents').finalizeDsl { dsl ->
      dsl.defaultConfig.buildConfigField('String', 'DIAGNOSTIC_BUILD_ID', '"${proofBuildId}"')
    }
    def fixture = new File(p.rootDir, '${relativeFixture}')
    config.sourceSets.getByName('release').manifest.srcFile(new File(fixture, 'AndroidManifest.xml'))
    config.sourceSets.getByName('release').res.srcDir(new File(fixture, 'res'))
    ${platformProof ? "p.afterEvaluate { p.extensions.getByName('react').entryFile.set(new File(p.rootDir.parentFile, 'dev/review-remediation-proof/index.tsx')) }" : ''}
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
  const builtApk = path.join(android, 'app/build/outputs/apk/release/app-release.apk');
  if (
    !readFileSync(
      path.join(android, 'app/build/generated/source/buildConfig/release/com/wz/reader/BuildConfig.java'),
      'utf8'
    ).includes(proofBuildId)
  )
    throw new Error('Proof build identity override was not applied');
  console.log(
    `IMAGE_PROOF_APK buildId=${proofBuildId} sha256=${createHash('sha256').update(readFileSync(builtApk)).digest('hex')} mode=${platformFileFaults ? 'platform-file-faults' : platformExports ? 'platform-exports' : svgOnly ? 'svg' : 'network-svg'} avd=${expectedAvd}`
  );
  const pkg = 'com.wz.reader';
  const installedAt = () =>
    /firstInstallTime=([^\r\n]+)/
      .exec(execFileSync('adb', ['-s', serial, 'shell', 'dumpsys', 'package', pkg], { encoding: 'utf8' }))?.[1]
      ?.trim();
  const before = installedAt();
  const buildTools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools');
  const signer = readdirSync(buildTools)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((version) => path.join(buildTools, version, 'lib/apksigner.jar'))
    .find(existsSync);
  if (!signer) throw new Error('Android apksigner unavailable');
  const certificate = (apk) =>
    apkSigning.singleApkSignerSha256(
      execFileSync('java', ['-jar', signer, 'verify', '--print-certs', apk], { encoding: 'utf8', windowsHide: true })
    );
  if (before) {
    const installed = execFileSync('adb', ['-s', serial, 'shell', 'pm', 'path', pkg], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/)[0]
      .replace(/^package:/, '');
    const previous = path.join(fixture, 'previous.apk');
    execFileSync('adb', ['-s', serial, 'pull', installed, previous], { stdio: 'ignore' });
    const next = path.join(android, 'app/build/outputs/apk/release/app-release.apk');
    if (!certificate(next) || certificate(next) !== certificate(previous))
      throw new Error('APK signer mismatch; installation frozen');
  }
  for (const apk of ['release/app-release.apk', 'androidTest/release/app-release-androidTest.apk']) {
    execFileSync('adb', ['-s', serial, 'install', '-r', path.join(android, 'app', 'build', 'outputs', 'apk', apk)], {
      stdio: 'inherit'
    });
  }
  if (before && installedAt() !== before) throw new Error('Installation identity changed; device changes frozen');
  if (platformExports) {
    const packageState = execFileSync('adb', ['-s', serial, 'shell', 'dumpsys', 'package', 'com.wz.reader'], {
      encoding: 'utf8'
    });
    restoreImagePermission = !/android\.permission\.READ_MEDIA_IMAGES: granted=true/.test(packageState);
    if (restoreImagePermission)
      execFileSync('adb', [
        '-s',
        serial,
        'shell',
        'pm',
        'grant',
        'com.wz.reader',
        'android.permission.READ_MEDIA_IMAGES'
      ]);
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
      'proofBuildId',
      proofBuildId,
      '-e',
      'class',
      platformFileFaults
        ? [
            'com.wz.reader.PlatformFileFaultInstrumentedTest#backupWriterRejectsProviderIoAndQuotaErrorsAfterPartialWrites',
            'com.wz.reader.PlatformFileFaultInstrumentedTest#managedImageDownloadPropagatesProviderEnospcAndRemovesItsPart',
            'com.wz.reader.PlatformFileFaultInstrumentedTest#backupWriterRejectsAnAlreadyReportedReliableDescriptorErrorAtClose',
            'com.wz.reader.PlatformExportInstrumentedTest#realBackupBridgeRejectsProviderWriteFailuresAndReleasesItsPendingOperation'
          ].join(',')
        : platformExports
          ? platformExportUi
            ? 'com.wz.reader.PlatformExportInstrumentedTest'
            : 'com.wz.reader.ImageDownloadInstrumentedTest,com.wz.reader.PlatformExportInstrumentedTest'
          : svgOnly
            ? 'com.wz.reader.SvgRendererInstrumentedTest'
            : 'com.wz.reader.NetworkImageRuntimeInstrumentedTest,com.wz.reader.ManagedCookieResponsesInstrumentedTest,com.wz.reader.SvgRendererInstrumentedTest',
      'com.wz.reader.test/androidx.test.runner.AndroidJUnitRunner'
    ],
    { encoding: 'utf8', timeout: platformProof ? 300_000 : 180_000 }
  );
  process.stdout.write(result);
  if (!/OK \([1-9]\d* tests?\)/u.test(result))
    throw new Error('Image instrumentation did not pass a nonzero test count.');
  if (!platformProof && !svgOnly) {
    for (const [stage, method] of [
      ['write', 'persistRenewalBeforeProcessExit'],
      ['read', 'restartedProcessAuthenticatesWithPersistedRenewal']
    ]) {
      // This synthetic origin and process interruption belong exclusively to the isolated AVD.
      execFileSync('adb', ['-s', serial, 'shell', 'am', 'force-stop', 'com.wz.reader']);
      const proof = execFileSync(
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
          'cookieProofStage',
          stage,
          '-e',
          'class',
          `com.wz.reader.ManagedCookieResponsesInstrumentedTest#${method}`,
          'com.wz.reader.test/androidx.test.runner.AndroidJUnitRunner'
        ],
        { encoding: 'utf8', timeout: 60_000 }
      );
      process.stdout.write(proof);
      if (!/OK \(1 test\)/u.test(proof)) throw new Error(`Cookie restart proof ${stage} failed.`);
    }
    const webViewFailures = [];
    for (const mode of ['complete', 'error', 'cancel']) {
      for (const method of [
        'observeWebViewTerminalCookieBeforeProcessExit',
        'observeWebViewTerminalCookieAfterProcessRestart'
      ]) {
        execFileSync('adb', ['-s', serial, 'shell', 'am', 'force-stop', 'com.wz.reader']);
        const proof = execFileSync(
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
            'webViewCookieMode',
            mode,
            '-e',
            'class',
            `com.wz.reader.ManagedCookieResponsesInstrumentedTest#${method}`,
            'com.wz.reader.test/androidx.test.runner.AndroidJUnitRunner'
          ],
          { encoding: 'utf8', timeout: 60_000 }
        );
        process.stdout.write(proof);
        if (!/OK \(1 test\)/u.test(proof)) webViewFailures.push(`${mode}: ${method}`);
      }
    }
    if (webViewFailures.length) throw new Error(`WebView cookie restart proof failed: ${webViewFailures.join(', ')}.`);
  }
} finally {
  if (restoreImagePermission)
    execFileSync('adb', [
      '-s',
      serial,
      'shell',
      'pm',
      'revoke',
      'com.wz.reader',
      'android.permission.READ_MEDIA_IMAGES'
    ]);
  if (path.dirname(path.resolve(fixture)) !== path.resolve(scratchRoot))
    throw new Error('Invalid fixture cleanup path.');
  rmSync(fixture, { recursive: true, force: true });
  // Never leave a loopback-enabled test APK in the normal release output location.
  gradle([':app:assembleRelease']);
}
