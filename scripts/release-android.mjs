import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import apkSigning from './apk-signing.cjs';
import {
  RELEASE_SIGNING_ENV_NAMES,
  assertCleanReleaseCheckout,
  assertReleaseNode22,
  parseJavaVersionOutput,
  releaseEnvironment,
  resolveReleaseKeystorePath,
  restorePackageJsonAfterPrebuild,
  runReleaseBuildStages,
  unsignedReleaseChildEnv
} from './release-environment.mjs';

const { singleApkSignerSha256 } = apkSigning;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');
const packageJsonPath = path.join(rootDir, 'package.json');
const releaseApkFileName = 'app-arm64-v8a-release.apk';
const releaseApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', releaseApkFileName);
const supportedSmokeApkAbis = new Set(['arm64-v8a', 'x86_64']);
const developmentKeystorePath = path.join(androidDir, 'app', 'debug.keystore');
const releaseManifestFileName = 'release-manifest.json';
const releaseManifestPath = path.join(path.dirname(releaseApkPath), releaseManifestFileName);
const releaseEnvPath = path.join(rootDir, '.env.release.local');
const appConfig = JSON.parse(readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
const expectedReleaseSignerSha256 = cleanSha256(appConfig.expo?.extra?.releaseSignerSha256);
const requiredSigningEnv = [...RELEASE_SIGNING_ENV_NAMES];
const requiredSmokeEnv = ['WZ_ANDROID_SMOKE_DEVICE', 'WZ_ANDROID_SMOKE_ABI'];
const windowsNodeCliCommands = new Map([
  ['npm', 'npm-cli.js'],
  ['npx', 'npx-cli.js']
]);
let ordinaryChildEnv = unsignedReleaseChildEnv(process.env, {});

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
    env: ordinaryChildEnv,
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
  const { failureMessage, ...spawnOptions } = options;
  const executable = commandForCurrentPlatform(command, args);
  const result = spawnSync(executable.command, executable.args, {
    cwd: rootDir,
    encoding: 'utf8',
    env: ordinaryChildEnv,
    ...spawnOptions
  });

  if (result.error) {
    if (failureMessage) {
      failReleasePreflight(new Error(failureMessage));
    }
    console.error(`命令启动失败：${command} ${args.join(' ')}\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) {
      if (!failureMessage) {
        process.stdout.write(result.stdout);
      }
    }
    if (result.stderr) {
      if (!failureMessage) {
        process.stderr.write(result.stderr);
      }
    }
    if (failureMessage) {
      failReleasePreflight(new Error(failureMessage));
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
  return (
    readdirSync(buildToolsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(buildToolsDir, entry.name, 'lib', 'apksigner.jar'))
      .filter((candidate) => existsSync(candidate))
      .sort((left, right) =>
        path
          .basename(path.dirname(path.dirname(right)))
          .localeCompare(path.basename(path.dirname(path.dirname(left))), undefined, { numeric: true })
      )[0] || null
  );
}

function verifyReleaseApkSignature(apkPath) {
  const apkSignerJar = findApkSignerJar();
  if (!apkSignerJar) {
    console.error('未找到 apksigner，请确认 ANDROID_HOME 或 ANDROID_SDK_ROOT 指向 Android SDK。');
    process.exit(1);
  }
  const output = runCapture('java', ['-jar', apkSignerJar, 'verify', '--verbose', '--print-certs', apkPath]);
  const signerSha256 = singleApkSignerSha256(output);
  if (!signerSha256 || !/^[a-f0-9]{64}$/.test(signerSha256)) {
    console.error('无法从 apksigner 输出读取唯一 APK signer 的 SHA-256。');
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
    '-jar',
    apkSignerJar,
    'sign',
    '--ks',
    developmentKeystorePath,
    '--ks-key-alias',
    'androiddebugkey',
    '--ks-pass',
    'pass:android',
    '--key-pass',
    'pass:android',
    '--out',
    outputPath,
    inputPath
  ]);
}

function cleanSha256(value) {
  const clean = String(value || '')
    .replace(/:/g, '')
    .trim()
    .toLowerCase();
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

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function releaseApkSha256() {
  return fileSha256(releaseApkPath);
}

function printReleaseApkSha256(sha256) {
  console.log(`release APK SHA-256: ${sha256}`);
}

function writeReleaseManifest({
  sha256,
  signerSha256,
  gitSha,
  packageLockSha256,
  npmVersion,
  javaVersion,
  gradleVersion,
  builtAbis
}) {
  const manifest = {
    apkName: releaseApkFileName,
    sha256,
    packageName: appConfig.expo.android.package,
    versionName: appConfig.expo.version,
    versionCode: appConfig.expo.android.versionCode,
    signerSha256,
    gitSha,
    packageLockSha256,
    nodeVersion: process.versions.node,
    npmVersion,
    javaVersion,
    gradleVersion,
    builtAbis
  };
  writeFileSync(releaseManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`release manifest: ${releaseManifestPath}`);
}

function loadReleaseEnvFile() {
  const fileContents = existsSync(releaseEnvPath) ? readFileSync(releaseEnvPath, 'utf8') : '';
  return releaseEnvironment(process.env, fileContents);
}

function verifyReleaseSigningEnv(releaseEnv) {
  const missing = requiredSigningEnv.filter((name) => !releaseEnv[name]);
  if (missing.length) {
    console.error(`正式发布缺少签名环境变量：${missing.join(', ')}`);
    process.exit(1);
  }
  let keystorePath = '';
  try {
    keystorePath = resolveReleaseKeystorePath(rootDir, releaseEnv.WZ_ANDROID_KEYSTORE_PATH);
  } catch (error) {
    failReleasePreflight(error);
  }
  const verified = { ...releaseEnv, WZ_ANDROID_KEYSTORE_PATH: keystorePath };
  const debugDefaults = [];
  if (verified.WZ_ANDROID_KEY_ALIAS === 'androiddebugkey') {
    debugDefaults.push('WZ_ANDROID_KEY_ALIAS=androiddebugkey');
  }
  if (path.basename(verified.WZ_ANDROID_KEYSTORE_PATH || '').toLowerCase() === 'debug.keystore') {
    debugDefaults.push('WZ_ANDROID_KEYSTORE_PATH=debug.keystore');
  }
  if (verified.WZ_ANDROID_KEYSTORE_PASSWORD === 'android') {
    debugDefaults.push('WZ_ANDROID_KEYSTORE_PASSWORD=android');
  }
  if (verified.WZ_ANDROID_KEY_PASSWORD === 'android') {
    debugDefaults.push('WZ_ANDROID_KEY_PASSWORD=android');
  }
  if (debugDefaults.length) {
    console.error(`正式发布不能使用 Android debug 签名默认值：${debugDefaults.join(', ')}`);
    process.exit(1);
  }
  return verified;
}

function verifySmokeEnv(releaseEnv) {
  const missing = requiredSmokeEnv.filter((name) => !releaseEnv[name]);
  if (missing.length) {
    console.error(`发布 smoke 缺少环境变量：${missing.join(', ')}`);
    process.exit(1);
  }
}

function failReleasePreflight(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function cleanGitSha() {
  const status = runCapture('git', ['status', '--porcelain=v1', '--untracked-files=normal']);
  try {
    assertCleanReleaseCheckout(status);
  } catch (error) {
    failReleasePreflight(error);
  }
  const sha = runCapture('git', ['rev-parse', 'HEAD']).trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(sha)) {
    failReleasePreflight(new Error('无法读取可信的 Git revision。'));
  }
  return sha;
}

function firstOutputLine(output, tool) {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  if (!line) {
    failReleasePreflight(new Error(`无法读取 ${tool} 版本。`));
  }
  return line;
}

function gradleWrapperVersion() {
  const wrapper = readFileSync(path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');
  const version = /gradle-([0-9][^-\\/]*)-(?:bin|all)\.zip/.exec(wrapper)?.[1];
  if (!version) {
    failReleasePreflight(new Error('无法读取 Gradle wrapper 版本。'));
  }
  return version;
}

const configuredReleaseEnv = loadReleaseEnvFile();
ordinaryChildEnv = unsignedReleaseChildEnv(process.env, configuredReleaseEnv);
try {
  assertReleaseNode22(process.versions.node);
} catch (error) {
  failReleasePreflight(error);
}
const gitSha = cleanGitSha();
const releaseEnv = verifyReleaseSigningEnv(configuredReleaseEnv);
const packageLockSha256 = fileSha256(path.join(rootDir, 'package-lock.json'));
const npmVersion = firstOutputLine(runCapture('npm', ['--version']), 'npm');
let javaVersion;
try {
  javaVersion = parseJavaVersionOutput(
    runCapture('java', ['-version'], {
      failureMessage: '无法读取可信的 Java 版本。'
    })
  );
} catch (error) {
  failReleasePreflight(error);
}
run('node', ['scripts/check-version.mjs', '--require-previous-release']);
verifySmokeEnv(releaseEnv);
const smokeApkAbi = requestedSmokeApkAbi(releaseEnv.WZ_ANDROID_SMOKE_ABI);
const releaseApkAbis = [...new Set(['arm64-v8a', smokeApkAbi])];
const builtSmokeApkPath = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  `app-${smokeApkAbi}-release.apk`
);
const smokeApkPath = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  `app-${smokeApkAbi}-smoke-dev.apk`
);

run('npm', ['run', 'verify']);

const packageJsonBeforePrebuild = readFileSync(packageJsonPath, 'utf8');
const restorePackageJsonOnPrebuildFailure = () => {
  writeFileSync(packageJsonPath, packageJsonBeforePrebuild);
};
process.once('exit', restorePackageJsonOnPrebuildFailure);
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install']);
process.removeListener('exit', restorePackageJsonOnPrebuildFailure);
try {
  restorePackageJsonAfterPrebuild(packageJsonPath, packageJsonBeforePrebuild);
} catch (error) {
  failReleasePreflight(error);
}
const gradleVersion = gradleWrapperVersion();

runReleaseBuildStages({
  androidDir,
  builtAbis: releaseApkAbis,
  ordinaryEnv: ordinaryChildEnv,
  releaseEnv,
  run
});

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
writeReleaseManifest({
  sha256,
  signerSha256,
  gitSha,
  packageLockSha256,
  npmVersion,
  javaVersion,
  gradleVersion,
  builtAbis: releaseApkAbis
});
printReleaseApkSha256(sha256);
