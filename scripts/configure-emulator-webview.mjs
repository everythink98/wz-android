import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const flagPath = '/data/local/tmp/webview-command-line';
const flags = '_ --use-cmd-decoder=validating --use-gl=egl';
const ownedContent = `${flags}\n`;
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

function installationIdentity(dump) {
  const uid = dump.match(/^\s*(?:userId|appId)=(\d+)/m)?.[1];
  const versionCode = dump.match(/^\s*versionCode=(\d+)/m)?.[1];
  const versionName = dump.match(/^\s*versionName=([^\r\n]+)/m)?.[1]?.trim();
  const firstInstallTime = dump.match(/^\s*firstInstallTime=([^\r\n]+)/m)?.[1]?.trim();
  check(
    /User 0:.*installed=true/.test(dump) &&
      Number(uid) >= 10000 &&
      Number(versionCode) > 0 &&
      versionName &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(firstInstallTime ?? ''),
    'Incomplete installed com.wz.reader identity; stop device changes'
  );
  return { uid, versionCode, versionName, firstInstallTime };
}

function assertSameIdentity(before, after) {
  check(JSON.stringify(before) === JSON.stringify(after), 'Installation identity changed; stop device changes');
}

export function configureEmulatorWebView({ serial, profile }, adb) {
  check(/^emulator-\d+$/.test(serial ?? ''), 'An explicit emulator-* serial is required');
  check(['native-egl', 'default', 'status'].includes(profile), 'Use native-egl, default or status');
  const avd = String(adb('emu', 'avd', 'name'))
    .trim()
    .split(/\r?\n/)[0]
    .trim();
  check(avd === 'WZ_Pixel_API_35', 'Refusing an unfamiliar AVD');
  const build = String(adb('shell', 'getprop', 'ro.build.type')).trim();
  check(['userdebug', 'eng'].includes(build), 'Refusing a production Android build');
  check(String(adb('shell', 'getprop', 'ro.kernel.qemu')).trim() === '1', 'Target is not an Android emulator');
  const readIdentity = () => installationIdentity(String(adb('shell', 'dumpsys', 'package', 'com.wz.reader')));
  const before = readIdentity();
  const readProfile = () => {
    const kind = String(
      adb(
        'shell',
        `if [ -L ${flagPath} ]; then printf unsupported; elif [ ! -e ${flagPath} ]; then printf absent; elif [ -f ${flagPath} ]; then printf file; else printf unsupported; fi`
      )
    ).trim();
    if (kind === 'absent') return 'default';
    if (kind === 'file' && String(adb('exec-out', 'cat', flagPath)) === ownedContent) return 'native-egl';
    return 'unknown';
  };
  const previousProfile = readProfile();
  check(profile === 'status' || previousProfile !== 'unknown', 'Refusing an unrecognized WebView flag file');
  assertSameIdentity(before, readIdentity());
  const changed = profile !== 'status' && profile !== previousProfile;
  if (changed) {
    // Noclobber and a remote byte comparison preserve flags another operator added.
    if (profile === 'native-egl') adb('shell', `set -C; printf '%s\n' '${flags}' > ${flagPath}`);
    else adb('shell', `printf '%s\n' '${flags}' | cmp - ${flagPath} && rm ${flagPath}`);
    check(readProfile() === profile, 'WebView configuration did not converge; stop device changes');
    assertSameIdentity(before, readIdentity());
    adb('shell', 'sync');
    adb('shell', 'am', 'force-stop', 'com.wz.reader');
  }
  const after = readIdentity();
  assertSameIdentity(before, after);
  return {
    serial,
    avd,
    profile: profile === 'status' ? previousProfile : profile,
    previousProfile,
    changed,
    restartRequired: changed,
    identityBefore: before,
    identityAfter: after
  };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { serial: { type: 'string' }, help: { type: 'boolean' } }
  });
  if (values.help) {
    console.log('Usage: node scripts/configure-emulator-webview.mjs native-egl|default|status --serial emulator-5554');
    return;
  }
  check(positionals.length === 1, 'Specify native-egl, default or status and --serial emulator-*');
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const executable = sdk ? path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
  const adb = (...args) => {
    try {
      return execFileSync(executable, ['-s', values.serial, ...args], {
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      throw new Error('ADB operation failed; re-run status before further device changes');
    }
  };
  const result = configureEmulatorWebView({ serial: values.serial, profile: positionals[0] }, adb);
  console.log(JSON.stringify(result, null, 2));
  if (result.restartRequired) console.log('配置已变更，com.wz.reader 已停止。请重新打开 App。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'WebView configuration failed');
    process.exitCode = 1;
  }
}
