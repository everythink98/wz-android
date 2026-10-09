// @vitest-environment node
import { expect, it } from 'vitest';
import { configureEmulatorWebView } from '../../scripts/configure-emulator-webview.mjs';

const owned = '_ --use-cmd-decoder=validating --use-gl=egl\n';
const packageDump = (uid = '10214', version = '157', firstInstall = '2026-07-26 16:51:37') => `
  userId=${uid}
  versionCode=${version} minSdk=24
  versionName=1.3.153
  firstInstallTime=${firstInstall}
  User 0: installed=true hidden=false
`;

function device({
  avd = 'WZ_Pixel_API_35',
  build = 'userdebug',
  qemu = '1',
  file = null,
  kind
}: {
  avd?: string;
  build?: string;
  qemu?: string;
  file?: string | null;
  kind?: string;
} = {}) {
  const mutations: string[][] = [];
  let dump = packageDump();
  let afterDump: string | undefined;
  let fileAfterRead: string | undefined;
  let reads = 0;
  const adb = (...args: string[]) => {
    const command = args.join(' ');
    if (command === 'emu avd name') return `${avd}\r\r\nOK\r\r\n`;
    if (command === 'shell getprop ro.build.type') return build;
    if (command === 'shell getprop ro.kernel.qemu') return qemu;
    if (command === 'shell dumpsys package com.wz.reader') {
      if (reads++ > 0) {
        if (fileAfterRead !== undefined) file = fileAfterRead;
        return afterDump ?? dump;
      }
      return dump;
    }
    if (command.startsWith('shell if [ -L ')) return kind ?? (file === null ? 'absent' : 'file');
    if (command === 'exec-out cat /data/local/tmp/webview-command-line') return file ?? '';
    mutations.push(args);
    if (command.startsWith('shell set -C;')) {
      if (file !== null) throw new Error('Already exists');
      file = owned;
    } else if (command.includes(' | cmp - ')) {
      if (file !== owned) throw new Error('Changed file');
      file = null;
    } else if (!['shell sync', 'shell am force-stop com.wz.reader'].includes(command))
      throw new Error(`Unexpected ADB: ${command}`);
    return '';
  };
  return {
    adb,
    mutations,
    get file() {
      return file;
    },
    setDump(value: string) {
      dump = value;
    },
    changeIdentityAfterRead(value: string) {
      afterDump = value;
    },
    changeFileAfterRead(value: string) {
      fileAfterRead = value;
    }
  };
}

it('refuses physical serials, unfamiliar AVDs and production builds before any mutation', () => {
  for (const [serial, options] of [
    ['phone-123', {}],
    ['emulator-5554', { avd: 'SomeoneElse_API35' }],
    ['emulator-5554', { build: 'user' }],
    ['emulator-5554', { qemu: '0' }]
  ] as const) {
    const fake = device(options);
    expect(() => configureEmulatorWebView({ serial, profile: 'native-egl' }, fake.adb)).toThrow();
    expect(fake.mutations).toEqual([]);
  }
});

it('preserves unfamiliar flag files and reports only their profile', () => {
  for (const file of ['secret-unfamiliar-flags\n', '', `${owned}\n`]) {
    const fake = device({ file });
    for (const profile of ['native-egl', 'default']) {
      expect(() => configureEmulatorWebView({ serial: 'emulator-5554', profile }, fake.adb)).toThrow('unrecognized');
    }
    const result = configureEmulatorWebView({ serial: 'emulator-5554', profile: 'status' }, fake.adb);
    expect(result.profile).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('secret-unfamiliar-flags');
    expect(fake.file).toBe(file);
    expect(fake.mutations).toEqual([]);
  }
});

it('preserves symlinks and other non-regular paths even if their bytes look owned', () => {
  const fake = device({ file: owned, kind: 'unsupported' });
  expect(() => configureEmulatorWebView({ serial: 'emulator-5554', profile: 'default' }, fake.adb)).toThrow(
    'unrecognized'
  );
  expect(fake.file).toBe(owned);
  expect(fake.mutations).toEqual([]);
});

it('never overwrites or deletes unfamiliar flags appearing after the initial read', () => {
  for (const profile of ['native-egl', 'default']) {
    const fake = device({ file: profile === 'native-egl' ? null : owned });
    fake.changeFileAfterRead('other-operator-flags\n');
    expect(() => configureEmulatorWebView({ serial: 'emulator-5554', profile }, fake.adb)).toThrow();
    expect(fake.file).toBe('other-operator-flags\n');
    expect(fake.mutations.some((args) => args.join(' ') === 'shell am force-stop com.wz.reader')).toBe(false);
  }
});

it('applies and restores only its exact flags, stopping the app once per actual change', () => {
  const fake = device();
  const configure = (profile: string) => configureEmulatorWebView({ serial: 'emulator-5554', profile }, fake.adb);
  expect(configure('default').changed).toBe(false);
  expect(configure('native-egl')).toMatchObject({ profile: 'native-egl', changed: true, restartRequired: true });
  expect(fake.file).toBe(owned);
  expect(configure('native-egl').changed).toBe(false);
  expect(configure('status').profile).toBe('native-egl');
  expect(configure('default')).toMatchObject({ profile: 'default', changed: true, restartRequired: true });
  expect(fake.file).toBeNull();
  expect(configure('default').changed).toBe(false);
  expect(fake.mutations.filter((args) => args.join(' ') === 'shell am force-stop com.wz.reader')).toHaveLength(2);
  expect(fake.mutations.filter((args) => args.join(' ') === 'shell sync')).toHaveLength(2);
  expect(fake.mutations).toHaveLength(6);
  for (const stop of [2, 5]) {
    expect(fake.mutations[stop - 1]).toEqual(['shell', 'sync']);
    expect(fake.mutations[stop]).toEqual(['shell', 'am', 'force-stop', 'com.wz.reader']);
  }
});

it('requires a complete installed identity and detects UID, version and installation-time changes', () => {
  const missing = device();
  missing.setDump('Package not found');
  expect(() => configureEmulatorWebView({ serial: 'emulator-5554', profile: 'native-egl' }, missing.adb)).toThrow();
  expect(missing.mutations).toEqual([]);
  for (const changed of [
    packageDump('10215'),
    packageDump('158'),
    packageDump('10214', '157', '2026-10-09 12:00:00')
  ]) {
    const fake = device();
    fake.changeIdentityAfterRead(changed);
    expect(() => configureEmulatorWebView({ serial: 'emulator-5554', profile: 'native-egl' }, fake.adb)).toThrow(
      'identity'
    );
    expect(fake.mutations).toEqual([]);
  }
});
