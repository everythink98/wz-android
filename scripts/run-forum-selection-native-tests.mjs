import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'unit' && mode !== 'instrumented') {
  throw new Error('Usage: node scripts/run-forum-selection-native-tests.mjs <unit|instrumented>');
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = path.join(projectRoot, 'android');
const gradleWrapper = path.join(androidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (!existsSync(gradleWrapper)) {
  throw new Error('Missing generated Android project. Run `npx expo prebuild --platform android` first.');
}

const gradleArgs = [
  mode === 'unit' ? ':forum-content-selection:testDebugUnitTest' : ':forum-content-selection:connectedDebugAndroidTest',
  '--no-daemon'
];
const childEnvironment = { ...process.env };

if (mode === 'instrumented') {
  const expectedAvd = 'WZ_ForumSelection_Test_API35';
  const connected = execFileSync('adb', ['devices'], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map(([serial]) => serial);
  const matches = connected.filter((serial) => {
    if (!/^emulator-\d+$/u.test(serial)) return false;
    const avdName = execFileSync('adb', ['-s', serial, 'emu', 'avd', 'name'], { encoding: 'utf8' })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line && line !== 'OK');
    return avdName === expectedAvd;
  });
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one connected ${expectedAvd} AVD; found ${matches.length}.`);
  }
  childEnvironment.ANDROID_SERIAL = matches[0];
  gradleArgs.push('--rerun', '-PreactNativeArchitectures=x86_64');
}

const result = spawnSync(gradleWrapper, gradleArgs, {
  cwd: androidRoot,
  env: childEnvironment,
  shell: process.platform === 'win32',
  stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (mode === 'instrumented') {
  const resultsRoot = path.join(
    projectRoot,
    'modules',
    'forum-content-selection',
    'android',
    'build',
    'outputs',
    'androidTest-results',
    'connected',
    'debug'
  );
  const resultFiles = existsSync(resultsRoot)
    ? readdirSync(resultsRoot, { recursive: true })
        .map((entry) => path.join(resultsRoot, entry.toString()))
        .filter((entry) => entry.endsWith('.xml'))
    : [];
  const testCount = resultFiles.reduce((total, resultFile) => {
    const report = readFileSync(resultFile, 'utf8');
    const match = report.match(/<testsuite\b[^>]*\btests="(\d+)"/u);
    return total + Number(match?.[1] || 0);
  }, 0);
  if (testCount === 0) throw new Error('Forum selection instrumentation completed without running any tests.');
}
