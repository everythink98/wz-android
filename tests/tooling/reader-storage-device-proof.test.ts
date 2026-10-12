// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildDeviceProof } from '../../scripts/device-proof-build.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('../../scripts/device-proof-build.mjs', () => ({ buildDeviceProof: vi.fn() }));
vi.mock('node:util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:util')>()),
  parseArgs: vi.fn()
}));

const directories: string[] = [];
afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const parent = path.resolve('.codex-tmp');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, 'storage-device-tooling-'));
  directories.push(directory);
  const sdk = path.join(directory, 'sdk');
  const signer = path.join(sdk, 'build-tools/36.0.0/lib/apksigner.jar');
  mkdirSync(path.dirname(signer), { recursive: true });
  writeFileSync(signer, 'fixture signer');
  const aapt = path.join(path.dirname(path.dirname(signer)), process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
  writeFileSync(aapt, 'fixture aapt');
  vi.stubEnv('ANDROID_HOME', sdk);
  const apk = path.join(directory, 'proof.apk');
  const bytes = Buffer.from('installed fixture APK');
  writeFileSync(apk, bytes);
  vi.mocked(buildDeviceProof).mockReturnValue({ apk, buildId: 'a'.repeat(32) });
  const digest = createHash('sha256').update(bytes).digest('hex');
  const output = path.join(directory, 'receipt.json');
  vi.mocked(parseArgs).mockReturnValue({
    values: { serial: 'emulator-fixture', output, apk, 'seed-only': 'ordinary' },
    positionals: []
  });
  const state = {
    avd: 'WZ_ReaderStorage_API30_20260910',
    sdk: '30',
    apkPath: '/data/app/~~fixture/com.wz.reader-fixture/base.apk',
    hash: digest,
    uid: '10167',
    packageUid: '10167',
    firstInstallTime: '2026-09-10 04:02:17',
    installed: true,
    activity: 'com.wz.reader/com.wz.reader.MainActivity',
    signerMismatch: false,
    candidatePackage: 'com.wz.reader',
    candidateVersion: 158,
    candidateBadging: true,
    uidAfterInstall: '10167',
    scratch: '',
    token: '',
    installs: 0,
    launches: 0
  };
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === 'java')
      return `Signer #1 certificate SHA-256 digest: ${(state.signerMismatch && args?.at(-1) === apk ? 'b' : 'a').repeat(64)}`;
    if (command === aapt) {
      if (args?.at(-1) === apk && !state.candidateBadging) return '';
      return `package: name='${args?.at(-1) === apk ? state.candidatePackage : 'com.wz.reader'}' versionCode='${args?.at(-1) === apk ? state.candidateVersion : 155}' versionName='fixture'`;
    }
    const operation = args?.slice(2).join(' ');
    if (operation === 'emu avd name') return `${state.avd}\nOK\n`;
    if (operation === 'shell getprop ro.build.version.sdk') return state.sdk;
    if (operation === 'shell pm path com.wz.reader') return state.apkPath ? `package:${state.apkPath}\n` : '';
    if (operation === 'shell dumpsys package com.wz.reader')
      return `${state.sdk === '30' ? 'userId' : 'appId'}=${state.packageUid}\nfirstInstallTime=${state.firstInstallTime}\nUser 0: installed=${state.installed} hidden=false\n`;
    if (operation === 'shell run-as com.wz.reader id -u') return state.uid;
    if (operation?.startsWith('shell sha256sum ')) return `${state.hash}  ${state.apkPath}`;
    if (operation?.startsWith('shell cmd package resolve-activity ')) return state.activity;
    if (operation?.startsWith('pull ')) {
      const destination = args?.at(-1);
      if (!destination) throw new Error('Missing pull target');
      state.scratch = path.dirname(destination);
      writeFileSync(destination, bytes);
      return '';
    }
    if (operation?.startsWith('install -r ')) {
      state.installs++;
      state.uid = state.packageUid = state.uidAfterInstall;
      return 'Success';
    }
    if (operation === 'shell am force-stop com.wz.reader') return '';
    if (operation?.startsWith('shell am start ')) {
      state.launches++;
      state.token = operation.split('/').at(-1) || '';
      return '';
    }
    if (operation === 'shell pidof com.wz.reader') return '123';
    if (operation === 'shell run-as com.wz.reader cat cache/reader-storage-proof.json')
      return JSON.stringify({ token: state.token, checkpoint: 'passed', isDev: false, isHermes: true, elapsedMs: 1 });
    throw new Error(`Unexpected fixture command: ${command} ${operation}`);
  });
  return { state, output };
}

describe('reader storage proof installation boundary', () => {
  it.each([
    { name: 'missing APK', change: { apkPath: '' } },
    { name: 'missing first install time', change: { firstInstallTime: '' } },
    { name: 'uninstalled user', change: { installed: false } },
    { name: 'unreadable APK hash', change: { hash: 'sha256sum: missing APK' } },
    { name: 'changed APK during preflight', change: { hash: 'b'.repeat(64) } },
    { name: 'mismatched UID', change: { uid: '99999' } },
    { name: 'missing Activity', change: { activity: 'No activity found' } },
    { name: 'wrong actual SDK', change: { sdk: '35' } },
    { name: 'wrong signer', change: { signerMismatch: true } },
    { name: 'another APK package with the same signer', change: { candidatePackage: 'com.other.reader' } },
    { name: 'APK downgrade', change: { candidateVersion: 154 } },
    { name: 'missing APK metadata', change: { candidateBadging: false } }
  ])('refuses $name before installing or launching a fixture', async ({ change }) => {
    const { state } = fixture();
    Object.assign(state, change);
    await expect(import('../../scripts/run-reader-storage-device-proof.mjs')).rejects.toThrow();
    expect(state.installs).toBe(0);
    expect(state.launches).toBe(0);
    if (state.scratch) expect(existsSync(state.scratch)).toBe(false);
  });

  it('applies the same package boundary to an artifact returned by the builder', async () => {
    const { state, output } = fixture();
    state.candidatePackage = 'com.other.reader';
    vi.mocked(parseArgs).mockReturnValue({
      values: { serial: 'emulator-fixture', output, build: true, 'seed-only': 'ordinary' },
      positionals: []
    });
    await expect(import('../../scripts/run-reader-storage-device-proof.mjs')).rejects.toThrow();
    expect(buildDeviceProof).toHaveBeenCalledTimes(1);
    expect(state.installs).toBe(0);
    expect(state.launches).toBe(0);
  });

  it('freezes fixture launches if a replacement changes the installation UID', async () => {
    const { state } = fixture();
    state.uidAfterInstall = '10168';
    await expect(import('../../scripts/run-reader-storage-device-proof.mjs')).rejects.toThrow('identity');
    expect(state.installs).toBe(1);
    expect(state.launches).toBe(0);
  });

  it.each([30, 35])(
    'replaces a matching API%s installation once and retains the explicit seed-only receipt',
    async (api) => {
      const { state, output } = fixture();
      state.avd = `WZ_ReaderStorage_API${api}_20260910`;
      state.sdk = String(api);
      await import('../../scripts/run-reader-storage-device-proof.mjs');
      expect(state.installs).toBe(1);
      expect(state.launches).toBe(1);
      expect(existsSync(output)).toBe(true);
      expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
        avd: state.avd,
        api: state.sdk,
        uid: state.uid,
        firstInstallTime: state.firstInstallTime,
        apkSha256: state.hash,
        results: [{ checkpoint: 'passed', token: state.token }]
      });
      expect(
        vi.mocked(execFileSync).mock.calls.some(([, args]) => args?.includes('uninstall') || args?.includes('clear'))
      ).toBe(false);
      expect(existsSync(state.scratch)).toBe(false);
    }
  );
});
