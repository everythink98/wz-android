import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');

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
