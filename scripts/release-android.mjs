import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

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
const windowsNodeCliCommands = new Map([
  ['npm', 'npm-cli.js'],
  ['npx', 'npx-cli.js']
]);

function commandForCurrentPlatform(command, args) {
  const nodeCli = windowsNodeCliCommands.get(command);
  if (process.platform !== 'win32' || !nodeCli) {
    return { command, args };
  }
  return {
    command: process.execPath,
    args: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', nodeCli), ...args]
  };
}

function run(command, args, options = {}) {
  const executable = commandForCurrentPlatform(command, args);
  const result = spawnSync(executable.command, executable.args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options
  });

  if (result.error) {
    console.error(`命令启动失败：${command} ${args.join(' ')}\n${result.error.message}`);
    process.exit(1);
  }
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

function findApkSignerJar() {
  const androidSdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!androidSdkDir) {
    return null;
  }
  const buildToolsDir = path.join(androidSdkDir, 'build-tools');
  if (!existsSync(buildToolsDir)) {
    return null;
  }
  return readdirSync(buildToolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(buildToolsDir, entry.name, 'lib', 'apksigner.jar'))
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => path.basename(path.dirname(path.dirname(right))).localeCompare(path.basename(path.dirname(path.dirname(left))), undefined, { numeric: true }))
    [0] || null;
}

function verifyReleaseApkSignature() {
  const apkSignerJar = findApkSignerJar();
  if (!apkSignerJar) {
    console.error('未找到 apksigner，请确认 ANDROID_HOME 或 ANDROID_SDK_ROOT 指向 Android SDK。');
    process.exit(1);
  }
  run('java', ['-jar', apkSignerJar, 'verify', '--verbose', '--print-certs', releaseApkPath]);
}

function printReleaseApkSha256() {
  const sha256 = createHash('sha256').update(readFileSync(releaseApkPath)).digest('hex');
  console.log(`release APK SHA-256: ${sha256}`);
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
run('npm', ['run', 'check:unused']);
run('node', ['scripts/check-version.mjs']);

run('node', ['scripts/generate-adaptive-icon.mjs']);
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);

run(
  'java',
  [
    '-jar',
    'gradle/wrapper/gradle-wrapper.jar',
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
verifyReleaseApkSignature();
printReleaseApkSha256();
