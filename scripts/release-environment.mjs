import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const RELEASE_SIGNING_ENV_NAMES = Object.freeze([
  'WZ_ANDROID_KEYSTORE_PATH',
  'WZ_ANDROID_KEYSTORE_PASSWORD',
  'WZ_ANDROID_KEY_ALIAS',
  'WZ_ANDROID_KEY_PASSWORD'
]);

const RELEASE_SIGNING_ENV_NAME_SET = new Set(RELEASE_SIGNING_ENV_NAMES);
const RELEASE_ENV_NAMES = new Set([...RELEASE_SIGNING_ENV_NAMES, 'WZ_ANDROID_SMOKE_DEVICE', 'WZ_ANDROID_SMOKE_ABI']);

function parseEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function releaseEnvironment(inherited, fileContents = '') {
  const release = {};
  for (const name of RELEASE_ENV_NAMES) {
    if (typeof inherited[name] === 'string') {
      release[name] = inherited[name];
    }
  }
  for (const line of fileContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    const name = separator > 0 ? trimmed.slice(0, separator).trim() : '';
    if (RELEASE_ENV_NAMES.has(name)) {
      release[name] = parseEnvValue(trimmed.slice(separator + 1));
    }
  }
  return release;
}

export function unsignedReleaseChildEnv(inherited, release) {
  /** @type {Record<string, string | undefined>} */
  const child = {};
  for (const [name, value] of Object.entries({ ...inherited, ...release })) {
    if (!RELEASE_SIGNING_ENV_NAME_SET.has(name.toUpperCase())) {
      child[name] = value;
    }
  }
  return child;
}

export function signingReleaseChildEnv(unsigned, release) {
  const child = unsignedReleaseChildEnv(unsigned, {});
  for (const name of RELEASE_SIGNING_ENV_NAMES) {
    if (typeof release[name] === 'string') {
      child[name] = release[name];
    }
  }
  return child;
}

export function assertReleaseNode22(version) {
  if (!/^22(?:\.|$)/.test(String(version))) {
    throw new Error(`正式发布要求 Node 22，当前为 ${version || 'unknown'}。`);
  }
}

export function assertCleanReleaseCheckout(status) {
  if (String(status).trim()) {
    throw new Error('正式发布要求 clean Git checkout；当前存在未提交改动。');
  }
}

export function parseJavaVersionOutput(output) {
  const matches = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:openjdk|java) version "[^"\r\n]+"(?: .*)?$/.test(line));
  if (matches.length !== 1) {
    throw new Error('无法读取可信的 Java 版本。');
  }
  return matches[0];
}

export function resolveReleaseKeystorePath(rootDir, configuredPath) {
  const keystorePath = path.resolve(rootDir, String(configuredPath || ''));
  let isFile;
  try {
    isFile = statSync(keystorePath).isFile();
  } catch {
    throw new Error(`keystore 不存在：${keystorePath}`);
  }
  if (!isFile) {
    throw new Error(`keystore 不是普通文件：${keystorePath}`);
  }
  return keystorePath;
}

export function restorePackageJsonAfterPrebuild(packageJsonPath, originalContents) {
  try {
    const originalPackage = JSON.parse(originalContents);
    const generatedPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const originalHasIos = Object.prototype.hasOwnProperty.call(originalPackage?.scripts || {}, 'ios');
    if (!originalHasIos && generatedPackage?.scripts?.ios === 'expo run:ios') {
      delete generatedPackage.scripts.ios;
    }
    if (!isDeepStrictEqual(generatedPackage, originalPackage)) {
      throw new Error('Expo prebuild 修改了 package.json，且变化不止默认 ios script。');
    }
  } finally {
    writeFileSync(packageJsonPath, originalContents);
  }
}

export function runReleaseBuildStages({ androidDir, builtAbis, ordinaryEnv, releaseEnv, run }) {
  const commonArgs = [
    '-PnewArchEnabled=true',
    `-PreactNativeArchitectures=${builtAbis.join(',')}`,
    '-Pandroid.enableShrinkResourcesInReleaseBuilds=true',
    '-Pandroid.enableMinifyInReleaseBuilds=true',
    '-PEX_DEV_CLIENT_NETWORK_INSPECTOR=false'
  ];
  run(
    'java',
    [
      '-jar',
      'gradle/wrapper/gradle-wrapper.jar',
      '--no-daemon',
      ':app:clean',
      ':app:testReleaseUnitTest',
      ':app:compileReleaseKotlin',
      ...commonArgs
    ],
    { cwd: androidDir, env: ordinaryEnv }
  );
  run(
    'java',
    [
      '-jar',
      'gradle/wrapper/gradle-wrapper.jar',
      '--no-daemon',
      ':app:assembleRelease',
      '-I',
      '../scripts/android-release-apk.gradle',
      ...commonArgs,
      `-PreleaseApkAbis=${builtAbis.join(',')}`
    ],
    { cwd: androidDir, env: signingReleaseChildEnv(ordinaryEnv, releaseEnv) }
  );
}
