import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');
const releaseApkFileName = 'app-arm64-v8a-release.apk';
const releaseApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', releaseApkFileName);
const supportedSmokeApkAbis = new Set(['arm64-v8a', 'x86_64']);
const developmentKeystorePath = path.join(androidDir, 'app', 'debug.keystore');
const releaseManifestFileName = 'release-manifest.json';
const releaseManifestPath = path.join(path.dirname(releaseApkPath), releaseManifestFileName);
const releaseEnvPath = path.join(rootDir, '.env.release.local');
const appConfig = JSON.parse(readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
const expectedReleaseSignerSha256 = cleanSha256(appConfig.expo?.extra?.releaseSignerSha256);
const requiredSigningEnv = [
  'WZ_ANDROID_KEYSTORE_PATH',
  'WZ_ANDROID_KEYSTORE_PASSWORD',
  'WZ_ANDROID_KEY_ALIAS',
  'WZ_ANDROID_KEY_PASSWORD'
];
const requiredSmokeEnv = ['WZ_ANDROID_SMOKE_DEVICE', 'WZ_ANDROID_SMOKE_ABI'];
const windowsNodeCliCommands = new Map([
  ['npm', 'npm-cli.js'],
  ['npx', 'npx-cli.js']
]);

function requestedSmokeApkAbi(value) {
  const abi = String(value || 'arm64-v8a').trim();
  if (!supportedSmokeApkAbis.has(abi)) {
    console.error(`WZ_ANDROID_SMOKE_ABI 仅支持：${[...supportedSmokeApkAbis].join(', ')}`);
    process.exit(1);
  }
  return abi;
}

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

function runCapture(command, args, options = {}) {
  const executable = commandForCurrentPlatform(command, args);
  const result = spawnSync(executable.command, executable.args, {
    cwd: rootDir,
    encoding: 'utf8',
    ...options
  });

  if (result.error) {
    console.error(`命令启动失败：${command} ${args.join(' ')}\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function verifyReleaseApk(apkPath) {
  if (!existsSync(apkPath)) {
    console.error(`未找到 release APK：${apkPath}`);
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

function verifyReleaseApkSignature(apkPath) {
  const apkSignerJar = findApkSignerJar();
  if (!apkSignerJar) {
    console.error('未找到 apksigner，请确认 ANDROID_HOME 或 ANDROID_SDK_ROOT 指向 Android SDK。');
    process.exit(1);
  }
  const output = runCapture('java', ['-jar', apkSignerJar, 'verify', '--verbose', '--print-certs', apkPath]);
  const signerSha256 = /(?:Signer #1 certificate|V\d+(?:\.\d+)? Signer: certificate) SHA-256 digest:\s*([a-fA-F0-9:]+)/.exec(output)?.[1]?.replace(/:/g, '').toLowerCase();
  if (!signerSha256 || !/^[a-f0-9]{64}$/.test(signerSha256)) {
    console.error('无法从 apksigner 输出读取签名 SHA-256。');
    process.exit(1);
  }
  return signerSha256;
}

function signDevelopmentSmokeApk(inputPath, outputPath) {
  const apkSignerJar = findApkSignerJar();
  if (!apkSignerJar || !existsSync(developmentKeystorePath)) {
    console.error('未找到 Android debug keystore 或 apksigner，无法生成开发签名 smoke APK。');
    process.exit(1);
  }
  run('java', [
    '-jar', apkSignerJar,
    'sign',
    '--ks', developmentKeystorePath,
    '--ks-key-alias', 'androiddebugkey',
    '--ks-pass', 'pass:android',
    '--key-pass', 'pass:android',
    '--out', outputPath,
    inputPath
  ]);
}

function cleanSha256(value) {
  const clean = String(value || '').replace(/:/g, '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(clean) ? clean : '';
}

function verifyExpectedReleaseSigner(signerSha256) {
  if (!expectedReleaseSignerSha256) {
    console.error('app.json 缺少固定的正式签名 SHA-256：expo.extra.releaseSignerSha256。');
    process.exit(1);
  }
  if (signerSha256 !== expectedReleaseSignerSha256) {
    console.error(`release APK 签名不是已固定的正式签名：${signerSha256}`);
    process.exit(1);
  }
}

function releaseApkSha256() {
  return createHash('sha256').update(readFileSync(releaseApkPath)).digest('hex');
}

function printReleaseApkSha256(sha256) {
  console.log(`release APK SHA-256: ${sha256}`);
}

function writeReleaseManifest({ sha256, signerSha256 }) {
  const manifest = {
    apkName: releaseApkFileName,
    sha256,
    packageName: appConfig.expo.android.package,
    versionName: appConfig.expo.version,
    versionCode: appConfig.expo.android.versionCode,
    signerSha256
  };
  writeFileSync(releaseManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`release manifest: ${releaseManifestPath}`);
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

function verifySmokeEnv() {
  const missing = requiredSmokeEnv.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`发布 smoke 缺少环境变量：${missing.join(', ')}`);
    process.exit(1);
  }
}

loadReleaseEnvFile();
verifyReleaseSigningEnv();
verifySmokeEnv();
const smokeApkAbi = requestedSmokeApkAbi(process.env.WZ_ANDROID_SMOKE_ABI);
const releaseApkAbis = [...new Set(['arm64-v8a', smokeApkAbi])];
const builtSmokeApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', `app-${smokeApkAbi}-release.apk`);
const smokeApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', `app-${smokeApkAbi}-smoke-dev.apk`);

run('npm', ['test']);
run('npm', ['run', 'test:docs']);
run('npm', ['run', 'check:docs']);
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
    `-PreactNativeArchitectures=${releaseApkAbis.join(',')}`,
    `-PreleaseApkAbis=${releaseApkAbis.join(',')}`,
    '-Pandroid.enableShrinkResourcesInReleaseBuilds=true',
    '-Pandroid.enableMinifyInReleaseBuilds=true',
    '-PEX_DEV_CLIENT_NETWORK_INSPECTOR=false'
  ],
  { cwd: androidDir }
);

verifyReleaseApk(releaseApkPath);
const signerSha256 = verifyReleaseApkSignature(releaseApkPath);
verifyExpectedReleaseSigner(signerSha256);
verifyReleaseApk(builtSmokeApkPath);
const builtSmokeSignerSha256 = verifyReleaseApkSignature(builtSmokeApkPath);
verifyExpectedReleaseSigner(builtSmokeSignerSha256);
signDevelopmentSmokeApk(builtSmokeApkPath, smokeApkPath);
verifyReleaseApk(smokeApkPath);
const smokeSignerSha256 = verifyReleaseApkSignature(smokeApkPath);
if (smokeSignerSha256 === expectedReleaseSignerSha256) {
  console.error('smoke APK 仍是正式签名，拒绝安装到开发模拟器。');
  process.exit(1);
}
run('npm', ['run', 'smoke:android', '--', smokeApkPath]);
const sha256 = releaseApkSha256();
writeReleaseManifest({ sha256, signerSha256 });
printReleaseApkSha256(sha256);
