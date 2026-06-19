import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');
const releaseApkFileName = 'app-arm64-v8a-release.apk';
const releaseApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', releaseApkFileName);
const releaseEnvPath = path.join(rootDir, '.env.release.local');
const requiredSigningEnv = [
  'WZ_ANDROID_KEYSTORE_PATH',
  'WZ_ANDROID_KEYSTORE_PASSWORD',
  'WZ_ANDROID_KEY_ALIAS',
  'WZ_ANDROID_KEY_PASSWORD'
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function verifyReleaseApk() {
  if (!existsSync(releaseApkPath)) {
    console.error(`未找到 release APK：${releaseApkPath}`);
    process.exit(1);
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadReleaseEnvFile() {
  if (!existsSync(releaseEnvPath)) {
    return;
  }
  for (const line of readFileSync(releaseEnvPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separator).trim();
    if (/^[A-Z0-9_]+$/.test(name)) {
      process.env[name] = parseEnvValue(trimmed.slice(separator + 1));
    }
  }
}

function verifyReleaseSigningEnv() {
  const missing = requiredSigningEnv.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`正式发布缺少签名环境变量：${missing.join(', ')}`);
    process.exit(1);
  }
  const debugDefaults = [];
  if (process.env.WZ_ANDROID_KEY_ALIAS === 'androiddebugkey') {
    debugDefaults.push('WZ_ANDROID_KEY_ALIAS=androiddebugkey');
  }
  if (path.basename(process.env.WZ_ANDROID_KEYSTORE_PATH || '').toLowerCase() === 'debug.keystore') {
    debugDefaults.push('WZ_ANDROID_KEYSTORE_PATH=debug.keystore');
  }
  if (process.env.WZ_ANDROID_KEYSTORE_PASSWORD === 'android') {
    debugDefaults.push('WZ_ANDROID_KEYSTORE_PASSWORD=android');
  }
  if (process.env.WZ_ANDROID_KEY_PASSWORD === 'android') {
    debugDefaults.push('WZ_ANDROID_KEY_PASSWORD=android');
  }
  if (debugDefaults.length) {
    console.error(`正式发布不能使用 Android debug 签名默认值：${debugDefaults.join(', ')}`);
    process.exit(1);
  }
}

loadReleaseEnvFile();
verifyReleaseSigningEnv();

run('npm', ['test']);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'check:unused']);
run('node', ['scripts/check-version.mjs']);

run('node', ['scripts/generate-adaptive-icon.mjs']);
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);

run(
  process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
  [
    '--no-daemon',
    ':app:clean',
    ':app:assembleRelease',
    '-I',
    '../scripts/android-release-apk.gradle',
    '-PnewArchEnabled=true',
    '-PreactNativeArchitectures=arm64-v8a',
    '-Pandroid.enableShrinkResourcesInReleaseBuilds=true',
    '-Pandroid.enableMinifyInReleaseBuilds=true',
    '-PEX_DEV_CLIENT_NETWORK_INSPECTOR=false'
  ],
  { cwd: androidDir }
);

verifyReleaseApk();
