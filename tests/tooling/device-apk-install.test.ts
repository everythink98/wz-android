import { describe, expect, it, vi } from 'vitest';
import { installDeviceApk } from '../../scripts/device-apk-install.mjs';

const pkg = 'com.wz.reader.test';
const apk = 'instrumentation.apk';
const metadata = { package: pkg, versionCode: 0, certificate: 'a'.repeat(64), apkSha256: 'b'.repeat(64) };

function fixture(packageList = 'package:android', known = false) {
  let installed = known;
  const adb = vi.fn((...args: string[]) => {
    if (args.join(' ') === 'shell pm list packages -u') return packageList;
    if (args.includes('dumpsys'))
      return installed ? 'userId=10042\nfirstInstallTime=2026-09-10 12:34:56\nUser 0: installed=true\n' : '';
    if (args.includes('path')) return 'package:/data/app/example/base.apk';
    if (args.includes('sha256sum')) return metadata.apkSha256;
    if (args.join(' ') === `install -r ${apk}`) {
      installed = true;
      return 'Success';
    }
    throw new Error(`Unexpected command ${args[0]}`);
  });
  return { adb, pkg, apk, inspectApk: () => metadata };
}

describe('first installation on isolated instrumentation AVDs', () => {
  it('admits an absent test package only with an explicit fresh-install policy and a readable package list', () => {
    const ordinary = fixture();
    expect(() => installDeviceApk(ordinary)).toThrow(/firstInstallTime/);
    expect(ordinary.adb.mock.calls.some(([command]) => command === 'install')).toBe(false);

    const isolated = fixture();
    expect(installDeviceApk({ ...isolated, allowNew: true })).toMatchObject({
      uid: '10042',
      apkSha256: metadata.apkSha256
    });
    expect(isolated.adb.mock.calls.filter(([command]) => command === 'install')).toEqual([['install', '-r', apk]]);
  });

  it.each(['', 'Failure [service not available]', 'package:example.without.platform'])(
    'freezes when PackageManager cannot establish absence (%s)',
    (packages) => {
      const device = fixture(packages);
      expect(() => installDeviceApk({ ...device, allowNew: true })).toThrow(/package installation state/);
      expect(device.adb.mock.calls.some(([command]) => command === 'install')).toBe(false);
    }
  );

  it('requires an installed identity when the package is still known with retained data', () => {
    const device = fixture(`package:android\npackage:${pkg}`);
    expect(() => installDeviceApk({ ...device, allowNew: true })).toThrow(/firstInstallTime/);
    expect(device.adb.mock.calls.some(([command]) => command === 'install')).toBe(false);
  });

  it('freezes when a package appears after a build started with an empty slot', () => {
    const device = fixture(`package:android\npackage:${pkg}`, true);
    expect(() => installDeviceApk({ ...device, allowNew: true, expected: null })).toThrow(/installation appeared/);
    expect(device.adb.mock.calls.some(([command]) => command === 'install')).toBe(false);
  });
});

describe('identity immediately before installation', () => {
  const previousApk = 'previous.apk';
  const previous = { ...metadata, apkSha256: 'c'.repeat(64) };

  function packageSlot(occupied: boolean) {
    let current = occupied ? { uid: '10042', firstInstallTime: 'initial', sha256: previous.apkSha256 } : null;
    const adb = vi.fn((...args: string[]) => {
      if (args.join(' ') === 'shell pm list packages -u')
        return ['package:android', ...(current ? [`package:${pkg}`] : [])].join('\n');
      if (args.includes('dumpsys'))
        return current
          ? `userId=${current.uid}\nfirstInstallTime=${current.firstInstallTime}\nUser 0: installed=true\n`
          : '';
      if (args.includes('path')) return 'package:/data/app/example/base.apk';
      if (args.includes('sha256sum')) return current?.sha256 || '';
      if (args[0] === 'pull') return '';
      if (args[0] === 'install') {
        current = { ...(current ?? { uid: '10042', firstInstallTime: 'initial' }), sha256: metadata.apkSha256 };
        return 'Success';
      }
      throw new Error(`Unexpected command ${args[0]}`);
    });
    return {
      adb,
      replaceAfterInspection() {
        current = { uid: '10057', firstInstallTime: 'replacement', sha256: previous.apkSha256 };
      },
      changeApkAfterInspection() {
        if (current) current = { ...current, sha256: 'd'.repeat(64) };
      }
    };
  }

  it.each(['identity', 'APK'] as const)('refuses the write if the %s changed during signer verification', (changed) => {
    const slot = packageSlot(true);
    const inspectApk = (file: string) => {
      if (file === apk) return metadata;
      if (changed === 'identity') slot.replaceAfterInspection();
      else slot.changeApkAfterInspection();
      return previous;
    };
    expect(() => installDeviceApk({ adb: slot.adb, pkg, apk, previousApk, inspectApk })).toThrow(
      changed === 'identity' ? /Installation identity changed/ : /APK SHA-256 mismatch/
    );
    expect(slot.adb.mock.calls.some(([command]) => command === 'install')).toBe(false);
  });

  it('refuses the first install if a package appeared in the empty slot during candidate verification', () => {
    const slot = packageSlot(false);
    const inspectApk = () => {
      slot.replaceAfterInspection();
      return metadata;
    };
    expect(() => installDeviceApk({ adb: slot.adb, pkg, apk, inspectApk, allowNew: true, expected: null })).toThrow(
      /installation appeared/
    );
    expect(slot.adb.mock.calls.some(([command]) => command === 'install')).toBe(false);
  });
});
