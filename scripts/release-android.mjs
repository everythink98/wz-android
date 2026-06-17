import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');
const args = process.argv.slice(2);
const unsigned = args.includes('--unsigned');
const releaseApkFileName = unsigned ? 'app-arm64-v8a-release-unsigned.apk' : 'app-arm64-v8a-release.apk';
const releaseApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', releaseApkFileName);

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

function requireSigningEnv() {
  const missing = [
    'WZ_ANDROID_KEYSTORE_PATH',
    'WZ_ANDROID_KEYSTORE_PASSWORD',
    'WZ_ANDROID_KEY_ALIAS',
    'WZ_ANDROID_KEY_PASSWORD'
  ].filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`正式 release:android 缺少签名配置：${missing.join(', ')}`);
    console.error('如需无签名包，请使用 npm run release:android:unsigned。');
    process.exit(1);
  }
}

function verifyReleaseApk() {
  if (!existsSync(releaseApkPath)) {
    console.error(`未找到 release APK：${releaseApkPath}`);
    process.exit(1);
  }
}

run('npm', ['test']);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'check:unused']);
run('node', ['scripts/check-version.mjs']);
if (!unsigned) {
  requireSigningEnv();
}

run('node', ['scripts/generate-adaptive-icon.mjs']);
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);

run(
  process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
  [
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
