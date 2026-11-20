import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import apkSigning from './apk-signing.cjs';

export function findApkSignerJar() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const buildTools = path.join(sdk, 'build-tools');
  if (!existsSync(buildTools)) return null;
  return (
    readdirSync(buildTools, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      .map(({ name }) => path.join(buildTools, name, 'lib', 'apksigner.jar'))
      .find(existsSync) ?? null
  );
}

export function deviceApkSignerSha256(signer, apk) {
  return apkSigning.singleApkSignerSha256(
    execFileSync('java', ['-jar', signer, 'verify', '--print-certs', apk], { encoding: 'utf8', windowsHide: true })
  );
}

export function aapt2FromApkSigner(signer) {
  return path.join(path.dirname(path.dirname(signer)), process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
}

export function parseApkBadging(badging) {
  const packages = [...badging.matchAll(/^package: name='([^']+)' versionCode='(\d*)'(?: versionName='([^']*)')?/gmu)];
  if (packages.length !== 1) return null;
  const [, name, versionCode, versionName] = packages[0];
  const abis = [...badging.matchAll(/^native-code:[ \t]*(.*)$/gmu)].flatMap(([, line]) =>
    [...line.matchAll(/'([^']+)'/gu)].map(([, abi]) => abi)
  );
  return { package: name, versionCode: Number(versionCode), versionName, abis };
}
