import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import apkSigning from './apk-signing.cjs';

export function findDeviceApkSigner() {
  const buildTools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools');
  const signer = readdirSync(buildTools)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((version) => path.join(buildTools, version, 'lib/apksigner.jar'))
    .find(existsSync);
  if (!signer) throw new Error('Android apksigner unavailable');
  return signer;
}

export function deviceApkSignerSha256(signer, apk) {
  return apkSigning.singleApkSignerSha256(
    execFileSync('java', ['-jar', signer, 'verify', '--print-certs', apk], { encoding: 'utf8', windowsHide: true })
  );
}
