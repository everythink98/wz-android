import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aapt2FromApkSigner, deviceApkSignerSha256, findApkSignerJar, parseApkBadging } from './device-apk-signer.mjs';

export function inspectDeviceApk(apk) {
  const signer = findApkSignerJar();
  if (!signer) throw new Error('Android apksigner unavailable');
  const badging = execFileSync(aapt2FromApkSigner(signer), ['dump', 'badging', apk], {
    encoding: 'utf8',
    windowsHide: true
  });
  const metadata = parseApkBadging(badging);
  const certificate = deviceApkSignerSha256(signer, apk);
  // AGP omits versionCode in the instrumentation manifest. PackageManager treats it as 0.
  if (
    !metadata ||
    !Number.isSafeInteger(metadata.versionCode) ||
    (metadata.versionCode === 0 && metadata.package !== 'com.wz.reader.test') ||
    !certificate
  )
    throw new Error('Missing APK package, versionCode or signer; installation frozen');
  return {
    package: metadata.package,
    versionCode: metadata.versionCode,
    certificate,
    apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex')
  };
}

export function readInstalledDeviceApk(adb, pkg, phase = '') {
  let dump = '';
  try {
    dump = adb('shell', 'dumpsys', 'package', pkg);
  } catch {
    // Avoid attaching dumpsys output to errors returned by the proof runners.
  }
  const times = [...dump.matchAll(/^[ \t]*firstInstallTime=([^\r\n]*)$/gmu)];
  const firstInstallTime = times[0]?.[1].trim();
  if (times.length !== 1 || !firstInstallTime)
    throw new Error(`BLOCKED_BY_ENV：覆盖安装${phase}无法读取 ${pkg} 的 firstInstallTime，已停止设备变更。`);
  const uid = /^[ \t]*(?:appId|userId)=(\d+)\b/mu.exec(dump)?.[1];
  const user = /^[ \t]*User 0:([^\r\n]*)/mu.exec(dump)?.[1] ?? '';
  if (!uid || !/\binstalled=true\b/u.test(user) || /\b(?:hidden|suspended)=true\b/u.test(user))
    throw new Error('Incomplete installation identity (UID or User 0); device changes frozen');
  const paths = adb('shell', 'pm', 'path', pkg).trim().split(/\r?\n/u);
  const apkPath = /^package:(\/data\/app\/[^\s]+\/base\.apk)$/u.exec(paths[0])?.[1];
  if (!apkPath || paths.length !== 1) throw new Error('Expected one installed base APK; device changes frozen');
  const apkSha256 = adb('shell', 'sha256sum', apkPath).trim().split(/\s/u)[0];
  if (!/^[a-f0-9]{64}$/u.test(apkSha256)) throw new Error('Missing installed APK SHA-256; device changes frozen');
  return { uid, firstInstallTime, apkPath, apkSha256 };
}

function checkInstallation(actual, expected) {
  if (actual.firstInstallTime !== expected.firstInstallTime || actual.uid !== expected.uid)
    throw new Error('BLOCKED_BY_ENV：Installation identity changed (UID / firstInstallTime); device changes frozen');
  if (actual.apkSha256 !== expected.apkSha256) throw new Error('Installed APK SHA-256 mismatch; device changes frozen');
}

function checkExpectedInstallation(actual, expected) {
  if (expected === null && actual) throw new Error('A new installation appeared; device changes frozen');
  if (!expected) return;
  if (!actual) throw new Error('Expected installation disappeared; device changes frozen');
  checkInstallation(actual, expected);
}

export function readIsolatedDeviceApk(adb, pkg) {
  const packages = adb('shell', 'pm', 'list', 'packages', '-u')
    .trim()
    .split(/[\r\n]+/u);
  if (!packages.includes('package:android') || packages.some((name) => !/^package:[\w.]+$/u.test(name)))
    throw new Error('Unknown package installation state');
  return packages.includes(`package:${pkg}`) ? readInstalledDeviceApk(adb, pkg, '前') : null;
}

/**
 * Only dedicated instrumentation devices admit an initial install. A package with retained data
 * is still known to PackageManager and must pass the ordinary replacement checks.
 * @param {{
 *   adb: (...args: string[]) => string, pkg: string, apk: string, previousApk?: string,
 *   expected?: Pick<ReturnType<typeof readInstalledDeviceApk>, 'uid' | 'firstInstallTime' | 'apkSha256'> | null,
 *   allowNew?: boolean, inspectApk?: typeof inspectDeviceApk, install?: () => unknown
 * }} options
 */
export function installDeviceApk({
  adb,
  pkg,
  apk,
  previousApk,
  expected,
  allowNew = false,
  inspectApk = inspectDeviceApk,
  install = () => adb('install', '-r', apk)
}) {
  const readBeforeInstall = () => (allowNew ? readIsolatedDeviceApk(adb, pkg) : readInstalledDeviceApk(adb, pkg, '前'));
  const before = readBeforeInstall();
  checkExpectedInstallation(before, expected);
  const candidate = inspectApk(apk);
  if (candidate.package !== pkg) throw new Error('APK package mismatch; installation frozen');
  if (before) {
    const scratch = previousApk ? undefined : mkdtempSync(path.join(os.tmpdir(), 'wz-device-apk-'));
    try {
      const copy = previousApk ?? path.join(scratch, 'previous.apk');
      adb('pull', before.apkPath, copy);
      const previous = inspectApk(copy);
      if (previous.apkSha256 !== before.apkSha256) throw new Error('Installed APK changed during preflight');
      if (previous.package !== pkg || candidate.versionCode < previous.versionCode)
        throw new Error('APK package mismatch or downgrade; installation frozen');
      if (previous.certificate !== candidate.certificate) throw new Error('APK signer mismatch; installation frozen');
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  }
  checkExpectedInstallation(readBeforeInstall(), before);
  try {
    install();
  } catch (error) {
    if (before) {
      const after = readInstalledDeviceApk(adb, pkg, '后');
      checkInstallation(after, before);
    }
    throw new Error(`BLOCKED_BY_ENV：覆盖安装失败。${error instanceof Error ? ` ${error.message}` : ''}`, {
      cause: error
    });
  }
  const after = readInstalledDeviceApk(adb, pkg, '后');
  checkInstallation(after, { ...(before ?? after), apkSha256: candidate.apkSha256 });
  return { ...after, certificate: candidate.certificate };
}
