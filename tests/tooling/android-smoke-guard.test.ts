import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  capturedAgentDeviceOutput,
  deviceSelectionArgs,
  isVersionSupported,
  MIN_AGENT_DEVICE_VERSION
} from '../../scripts/agent-device-runtime.mjs';
import { parseBootedAndroidDevice, runApkSanity, withSmokeSession } from '../../scripts/smoke-android.mjs';
import {
  listReplayFiles,
  matchingAndroidDevices,
  normalizedAndroidDeviceName,
  parseAgentDeviceList,
  parseAndroidRecordingScratchPaths,
  parseAndroidPackageInfo,
  replayRecordingRecoverySession,
  ReplayCleanupError,
  replayDeviceSelectionArgs,
  runReplayBatch
} from '../../scripts/run-device-replay.mjs';
import { loggedOutDeviceName } from '../../scripts/run-logged-out-device-replay.mjs';

const rootDir = path.resolve(__dirname, '../..');
const bootedAndroidDeviceOutput = JSON.stringify({
  success: true,
  data: {
    platform: 'android',
    target: 'mobile',
    device: 'WZ Pixel API 35',
    id: 'emulator-5554',
    kind: 'emulator',
    booted: true
  }
});

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release evidence guards', () => {
  it('keeps logged-out testing outside the App and on an explicit isolated device', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const moreScreen = readProjectFile('src', 'features', 'more', 'MoreScreen.tsx');
    const nativePlugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(moreScreen).not.toContain('devAnonymous');
    expect(moreScreen).not.toContain('title="测试工具"');
    expect(nativePlugin).not.toContain('debugAnonymousAvailable');
    expect(nativePlugin).not.toContain('setManagedAnonymousMode');
    expect(packageJson.scripts['test:device:logged-out']).toBe('node scripts/run-logged-out-device-replay.mjs');
    expect(readProjectFile('scripts', 'run-logged-out-device-replay.mjs')).toContain('WZ_ANDROID_LOGGED_OUT_DEVICE');
    expect(() => loggedOutDeviceName({})).toThrow('必须设置 WZ_ANDROID_LOGGED_OUT_DEVICE');
    expect(() =>
      loggedOutDeviceName({
        WZ_ANDROID_LOGGED_OUT_DEVICE: 'WZ Logged Out API 35',
        WZ_ANDROID_TEST_DEVICE: 'WZ_Logged_Out_API_35'
      })
    ).toThrow('必须与主测试/Smoke 设备不同');
    expect(
      loggedOutDeviceName({
        WZ_ANDROID_LOGGED_OUT_DEVICE: 'WZ_Logged_Out_API_35',
        WZ_ANDROID_TEST_DEVICE: 'WZ_Pixel_API_35'
      })
    ).toBe('WZ_Logged_Out_API_35');
    expect(normalizedAndroidDeviceName(' WZ_Pixel_API_35 ')).toBe('wz pixel api 35');
  });

  it('requires the first agent-device version that supports Replay recording and reporters', () => {
    expect(MIN_AGENT_DEVICE_VERSION).toBe('0.19.0');
    expect(isVersionSupported('0.18.9')).toBe(false);
    expect(isVersionSupported('0.19.0-beta.1')).toBe(false);
    expect(isVersionSupported('0.19.0')).toBe(true);
    expect(isVersionSupported('0.20.0')).toBe(true);
  });

  it('requires one explicitly selected device', () => {
    expect(() => deviceSelectionArgs('')).toThrow('WZ_ANDROID_TEST_DEVICE');
    expect(deviceSelectionArgs('  WZ Pixel API 35  ')).toEqual(['--device', 'WZ Pixel API 35']);
  });

  it('keeps successful agent-device diagnostics out of captured JSON', () => {
    const output = capturedAgentDeviceOutput({
      stdout: '{"success":true,"data":{"devices":[]}}',
      stderr: 'warning: backend probe timed out\n'
    });

    expect(parseAgentDeviceList(output)).toEqual([]);
  });

  it('lets each Replay own its wall-clock budget', () => {
    const runner = readProjectFile('scripts', 'run-device-replay.mjs');
    const fourSourceFeed = readProjectFile('tests', 'device', 'four-source-feed.ad');

    expect(runner).not.toContain("'--timeout', '180000'");
    expect(fourSourceFeed).toContain('context timeout=240000');
  });

  it('selects the explicit targeted Replay directory while retaining APK sanity', () => {
    const smokeScript = readProjectFile('scripts', 'smoke-android.mjs');
    expect(smokeScript).toContain("options: { 'replay-directory': { type: 'string' } }");
    expect(smokeScript).toContain("replayDirectory: path.resolve(rootDir, values['replay-directory'])");
    expect(smokeScript.indexOf('runApkSanity({ apkPath, device: smokeDevice })')).toBeLessThan(
      smokeScript.indexOf('await runDeviceReplay({')
    );
    expect(listReplayFiles(path.join(rootDir, 'tests', 'live')).map((file) => path.basename(file))).toEqual([
      'feed-source-reorder.ad'
    ]);
  });

  it('keeps boot and APK sanity on one session and releases it after failure', () => {
    const events: string[] = [];
    const failure = new Error('sanity failed');

    expect(() =>
      withSmokeSession(
        {
          selectedDevice: 'WZ Pixel API 35',
          runAgentDeviceCommand: (args: string[]) => {
            events.push(args.join(' '));
            return args[0] === 'boot' ? bootedAndroidDeviceOutput : '';
          }
        },
        () => {
          events.push('sanity');
          throw failure;
        }
      )
    ).toThrow(failure);
    expect(events).toEqual([
      'boot --session wz-apk-sanity --platform android --device WZ Pixel API 35 --json',
      'sanity',
      'close --session wz-apk-sanity --platform android'
    ]);
  });

  it('resolves a booted emulator serial to its AVD name before starting Smoke', () => {
    const events: string[] = [];

    withSmokeSession(
      {
        selectedDevice: 'emulator-5554',
        runAdbCommand: (args: string[]) => {
          events.push(`adb:${args.join(' ')}`);
          return 'WZ_Pixel_API_35\nOK\n';
        },
        runAgentDeviceCommand: (args: string[]) => {
          events.push(`agent:${args.join(' ')}`);
          return args[0] === 'boot' ? bootedAndroidDeviceOutput : '';
        }
      },
      () => events.push('sanity')
    );

    expect(events).toEqual([
      'adb:-s emulator-5554 emu avd name',
      'agent:boot --session wz-apk-sanity --platform android --device WZ_Pixel_API_35 --json',
      'sanity',
      'agent:close --session wz-apk-sanity --platform android'
    ]);
  });

  it.each([
    ['blank output', () => ' \n'],
    ['OK only', () => 'OK\n'],
    ['KO response', () => 'KO: raw-avd-payload\n'],
    [
      'ADB failure',
      () => {
        throw new Error('raw-adb-payload');
      }
    ]
  ])('refuses %s before booting an AVD session', (_, resolveAvdName) => {
    let actionCalls = 0;
    let agentCalls = 0;
    let failure: unknown;

    try {
      withSmokeSession(
        {
          selectedDevice: 'emulator-5554',
          runAdbCommand: resolveAvdName,
          runAgentDeviceCommand: () => {
            agentCalls += 1;
            return '';
          }
        },
        () => {
          actionCalls += 1;
        }
      );
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).toBe(
      'Error: BLOCKED_BY_ENV：无法将 Android emulator ID emulator-5554 解析为 AVD 名，未启动 Smoke。'
    );
    expect(String(failure)).not.toContain('raw-avd-payload');
    expect(String(failure)).not.toContain('raw-adb-payload');
    expect(agentCalls).toBe(0);
    expect(actionCalls).toBe(0);
  });

  it('opens the Android Smoke emulator in a visible window', () => {
    const events: string[] = [];

    withSmokeSession(
      {
        selectedDevice: 'WZ Pixel API 35',
        runAgentDeviceCommand: (args: string[]) => {
          events.push(args.join(' '));
          return args[0] === 'boot' ? bootedAndroidDeviceOutput : '';
        }
      },
      () => undefined
    );

    expect(events[0]).not.toContain('--headless');
  });

  it('maps the configured AVD name to the booted device display name', () => {
    const devices = parseAgentDeviceList(
      JSON.stringify({
        success: true,
        data: {
          devices: [{ id: 'emulator-5554', name: 'WZ Pixel API 35', platform: 'android', booted: true }]
        }
      })
    );
    expect(devices).toEqual([{ id: 'emulator-5554', name: 'WZ Pixel API 35', platform: 'android', booted: true }]);
    expect(replayDeviceSelectionArgs(devices[0])).toEqual(['--device', 'WZ Pixel API 35']);
    expect(parseAndroidPackageInfo('versionCode=67 minSdk=24\nversionName=1.3.63\n')).toEqual({
      versionCode: 67,
      versionName: '1.3.63'
    });
    expect(parseBootedAndroidDevice(bootedAndroidDeviceOutput)).toMatchObject({
      id: 'emulator-5554',
      name: 'WZ Pixel API 35',
      platform: 'android',
      booted: true
    });
    expect(() => parseBootedAndroidDevice('{ malformed')).toThrow('未返回可信的 Android 设备身份');
    expect(matchingAndroidDevices(devices, 'WZ_Pixel_API_35')).toEqual(devices);
  });

  it('recovers only recording manifests owned by the current Replay session', () => {
    const sessionName = 'wz-replay-4321-search:test:suite:1-search:attempt-1';
    const manifest = JSON.stringify({
      version: 1,
      sessionName,
      recordingId: 'android-2321-1784023321348',
      deviceId: 'emulator-5554',
      startedAt: 1784023321348,
      showTouches: true,
      current: {
        remotePid: '2321',
        remotePath: '/sdcard/agent-device-recording-1784023321348.mp4',
        startedAt: 1784023321348
      },
      chunks: [{ index: 1, remotePath: '/sdcard/agent-device-recording-1784023321348.mp4' }]
    });

    expect(replayRecordingRecoverySession(manifest, 'emulator-5554', 'wz-replay-4321-search')).toBe(sessionName);
    expect(replayRecordingRecoverySession(manifest, 'emulator-5554', 'wz-replay-9999-search')).toBeUndefined();
    expect(replayRecordingRecoverySession(manifest, 'emulator-5556', 'wz-replay-4321-search')).toBeUndefined();
    expect(replayRecordingRecoverySession('{ malformed', 'emulator-5554', 'wz-replay-4321-search')).toBeUndefined();
  });

  it('treats active and atomic-temp recording manifests as occupied scratch', () => {
    expect(
      parseAndroidRecordingScratchPaths(
        [
          'agent-device-recording-1784023321348.mp4',
          'agent-device-recording-active.json',
          'agent-device-recording-active.json.tmp',
          'screenrecord-user.mp4',
          'agent-device-recording-not-a-timestamp.mp4'
        ].join('\n'),
        '/sdcard'
      )
    ).toEqual([
      '/sdcard/agent-device-recording-1784023321348.mp4',
      '/sdcard/agent-device-recording-active.json',
      '/sdcard/agent-device-recording-active.json.tmp'
    ]);
  });

  it('keeps Smoke on replacement install and delegates journeys to Replay', () => {
    const smokeScript = readProjectFile('scripts', 'smoke-android.mjs');

    expect(smokeScript).toContain("['doctor', '--platform', 'android']");
    const bootIndex = smokeScript.indexOf('withSmokeSession({ selectedDevice }, (smokeDevice) => {');
    const sanityIndex = smokeScript.indexOf('runApkSanity({ apkPath, device: smokeDevice });');
    expect(bootIndex).toBeGreaterThan(0);
    expect(sanityIndex).toBeGreaterThan(bootIndex);
    expect(smokeScript).not.toContain('resolveAndroidDevice');
    expect(smokeScript).toContain('device: smokeDevice');
    expect(smokeScript).toMatch(
      /'install',\s*appPackage,\s*apkPath,\s*'--session',\s*smokeSession,\s*'--platform',\s*'android'/
    );
    expect(smokeScript).toContain("['logs', 'clear', '--restart'");
    expect(smokeScript).toContain(
      "['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch']"
    );
    expect(smokeScript).toContain('waitFor(\'id="main-tab-feed"\', 60_000, runAgentDeviceCommand);');
    expect(smokeScript).toContain("console.log('APK_SANITY');");
    expect(smokeScript).not.toContain('device-logged-out');
    expect(smokeScript).not.toMatch(/runAgentDevice\(\[['"](?:press|click|fill|type|back)['"]/);
    expect(smokeScript).not.toMatch(/\[['"](?:uninstall|reinstall)['"]\s*,/);
    expect(smokeScript).not.toContain("'--shutdown'");
    expect(smokeScript).not.toMatch(/['"]pm['"]\s*,\s*['"]clear['"]/);
  });

  it('freezes before first launch when replacement install changes firstInstallTime', () => {
    const events: string[] = [];
    let packageReads = 0;
    const runAgentDeviceCommand = (args: string[]) => {
      events.push(`agent:${args.join(' ')}`);
      return '';
    };
    const runAdbCommand = (args: string[]) => {
      events.push(`adb:${args.join(' ')}`);
      if (args.includes('dumpsys')) {
        packageReads += 1;
        return packageReads === 1 ? 'firstInstallTime=2026-07-26 16:51:37\n' : 'firstInstallTime=2026-08-20 12:00:00\n';
      }
      return '';
    };
    let failure: unknown;

    try {
      runApkSanity({
        apkPath: 'candidate.apk',
        device: { id: 'emulator-5554', name: 'WZ Pixel API 35' },
        runAdbCommand,
        runAgentDeviceCommand,
        verifySessionLog: () => undefined
      });
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).toMatch(/BLOCKED_BY_ENV.*firstInstallTime/);
    const packageReadIndexes = events.flatMap((event, index) =>
      event.includes('shell dumpsys package com.wz.reader') ? [index] : []
    );
    const installIndex = events.findIndex((event) => event.startsWith('agent:install '));
    expect(packageReadIndexes).toHaveLength(2);
    expect(packageReadIndexes[0]).toBeLessThan(installIndex);
    expect(packageReadIndexes[1]).toBeGreaterThan(installIndex);
    expect(events).not.toEqual(expect.arrayContaining([expect.stringMatching(/agent:(?:open|logs)\b/)]));
    expect(events).not.toEqual(expect.arrayContaining([expect.stringMatching(/shell (?:date|log)\b|logcat\b/)]));
  });

  it('requires one non-empty firstInstallTime before replacement install', () => {
    for (const readPackage of [
      () => 'firstInstallTime=\n',
      () => 'firstInstallTime=2026-07-26 16:51:37\nfirstInstallTime=2026-08-20 12:00:00\n',
      () => {
        throw new Error('raw-dumpsys-payload');
      }
    ]) {
      let installCalls = 0;

      expect(() =>
        runApkSanity({
          apkPath: 'candidate.apk',
          device: { id: 'emulator-5554', name: 'WZ Pixel API 35' },
          runAdbCommand: readPackage,
          runAgentDeviceCommand: () => {
            installCalls += 1;
            return '';
          },
          verifySessionLog: () => undefined
        })
      ).toThrow(/^BLOCKED_BY_ENV：覆盖安装前无法读取 com\.wz\.reader 的 firstInstallTime，已停止 Smoke。$/);
      expect(installCalls).toBe(0);
    }
  });

  it.each([
    ['missing', ''],
    ['duplicate', 'firstInstallTime=2026-07-26 16:51:37\nfirstInstallTime=2026-08-20 12:00:00\n'],
    ['changed', 'firstInstallTime=2026-08-20 12:00:00\n'],
    ['unreadable', new Error('raw-dumpsys-payload')]
  ])('prioritizes %s firstInstallTime over replacement install failure', (_, postInstallOutput) => {
    const events: string[] = [];
    let packageReads = 0;
    let installCalls = 0;
    const runAdbCommand = (args: string[]) => {
      events.push(`adb:${args.join(' ')}`);
      if (args.includes('dumpsys')) {
        packageReads += 1;
        if (packageReads === 1) return 'firstInstallTime=2026-07-26 16:51:37\n';
        if (postInstallOutput instanceof Error) throw postInstallOutput;
        return postInstallOutput;
      }
      return '';
    };
    let failure: unknown;

    try {
      runApkSanity({
        apkPath: 'candidate.apk',
        device: { id: 'emulator-5554', name: 'WZ Pixel API 35' },
        runAdbCommand,
        runAgentDeviceCommand: (args: string[]) => {
          events.push(`agent:${args.join(' ')}`);
          installCalls += 1;
          throw new Error('replacement install failed');
        },
        verifySessionLog: () => undefined
      });
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).toMatch(/BLOCKED_BY_ENV.*firstInstallTime/);
    expect(String(failure)).not.toContain('replacement install failed');
    expect(String(failure)).not.toContain('raw-dumpsys-payload');
    expect(packageReads).toBe(2);
    expect(installCalls).toBe(1);
    expect(events).not.toEqual(expect.arrayContaining([expect.stringMatching(/agent:(?:open|logs)\b/)]));
    expect(events).not.toEqual(expect.arrayContaining([expect.stringMatching(/shell (?:date|log)\b|logcat\b/)]));
  });

  it.each([
    ['missing', 'raw-post-install-payload\n'],
    [
      'duplicate',
      'firstInstallTime=2026-07-26 16:51:37\nfirstInstallTime=2026-07-26 16:51:37\nraw-post-install-payload\n'
    ],
    ['unreadable', new Error('raw-post-install-payload')]
  ])('freezes after a successful replacement install when post-install identity is %s', (_, output) => {
    const events: string[] = [];
    let packageReads = 0;
    let installCalls = 0;
    const runAdbCommand = (args: string[]) => {
      events.push(`adb:${args.join(' ')}`);
      if (!args.includes('dumpsys')) return '';
      packageReads += 1;
      if (packageReads === 1) return 'firstInstallTime=2026-07-26 16:51:37\n';
      if (output instanceof Error) throw output;
      return output;
    };
    let failure: unknown;

    try {
      runApkSanity({
        apkPath: 'candidate.apk',
        device: { id: 'emulator-5554', name: 'WZ Pixel API 35' },
        runAdbCommand,
        runAgentDeviceCommand: (args: string[]) => {
          events.push(`agent:${args.join(' ')}`);
          installCalls += 1;
          return '';
        },
        verifySessionLog: () => undefined
      });
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).toBe(
      'Error: BLOCKED_BY_ENV：覆盖安装后无法读取 com.wz.reader 的 firstInstallTime，已停止 Smoke。'
    );
    expect(String(failure)).not.toContain('raw-post-install-payload');
    expect(packageReads).toBe(2);
    expect(installCalls).toBe(1);
    expect(events).not.toEqual(expect.arrayContaining([expect.stringMatching(/agent:(?:open|logs)\b/)]));
    expect(events).not.toEqual(expect.arrayContaining([expect.stringMatching(/shell (?:date|log)\b|logcat\b/)]));
  });

  it('reports replacement install failure after unchanged firstInstallTime', () => {
    let packageReads = 0;
    let installCalls = 0;
    let failure: unknown;

    try {
      runApkSanity({
        apkPath: 'candidate.apk',
        device: { id: 'emulator-5554', name: 'WZ Pixel API 35' },
        runAdbCommand: (args: string[]) => {
          if (args.includes('dumpsys')) {
            packageReads += 1;
            return 'firstInstallTime=2026-07-26 16:51:37\n';
          }
          return '';
        },
        runAgentDeviceCommand: () => {
          installCalls += 1;
          throw new Error('replacement install failed');
        },
        verifySessionLog: () => undefined
      });
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).toContain('BLOCKED_BY_ENV：覆盖安装失败');
    expect(String(failure)).toContain('replacement install failed');
    expect(packageReads).toBe(2);
    expect(installCalls).toBe(1);
  });

  it('captures the first post-install launch before it can fail', () => {
    const marker = 'wz-apk-sanity-first-launch-test';
    const events: string[] = [];
    const runAgentDeviceCommand = (args: string[]) => {
      events.push(`agent:${args.join(' ')}`);
      return args[0] === 'appstate' ? JSON.stringify({ data: { package: 'com.wz.reader' } }) : '';
    };
    const runAdbCommand = (args: string[]) => {
      events.push(`adb:${args.join(' ')}`);
      if (args.includes('dumpsys')) {
        return 'firstInstallTime=2026-07-26 16:51:37\n';
      }
      if (args.includes('date')) {
        return '1784102400.000\n';
      }
      if (args.includes('logcat')) {
        return [
          `07-15 16:00:00.000  2000  2000 I WZ_APK_SANITY: ${marker}`,
          '07-15 16:00:00.010  1000  1000 I ActivityManager: Start proc 4321:com.wz.reader/u0a123 for top-activity',
          '07-15 16:00:00.020  4321  4321 E AndroidRuntime: FATAL EXCEPTION: main',
          '07-15 16:00:00.021  4321  4321 E AndroidRuntime: Process: com.wz.reader, PID: 4321'
        ].join('\n');
      }
      return '';
    };
    let failure: unknown;

    try {
      runApkSanity({
        apkPath: 'candidate.apk',
        device: { id: 'emulator-5554', name: 'WZ Pixel API 35' },
        marker,
        runAdbCommand,
        runAgentDeviceCommand,
        verifySessionLog: () => undefined
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.some((error) => String(error).includes('Android 崩溃'))).toBe(true);
    const packageReadIndexes = events.flatMap((event, index) =>
      event.includes('shell dumpsys package com.wz.reader') ? [index] : []
    );
    const installIndex = events.findIndex((event) => event.startsWith('agent:install '));
    const timestampIndex = events.findIndex((event) => event.includes('shell date +%s.%3N'));
    const markerIndex = events.findIndex((event) => event.includes('shell log -p i -t WZ_APK_SANITY'));
    const firstOpenIndex = events.findIndex((event) => event.startsWith('agent:open '));
    const appStateIndex = events.findIndex((event) => event.startsWith('agent:appstate '));
    const dumpIndex = events.findIndex((event) => event.includes('logcat -d -v threadtime -T 1784102400.000'));
    expect(packageReadIndexes).toHaveLength(2);
    expect(packageReadIndexes[0]).toBeLessThan(installIndex);
    expect(packageReadIndexes[1]).toBeGreaterThan(installIndex);
    expect(packageReadIndexes[1]).toBeLessThan(timestampIndex);
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(events.filter((event) => event.startsWith('agent:install '))).toHaveLength(1);
    expect(events[installIndex]).toContain('--session wz-apk-sanity');
    expect(timestampIndex).toBeGreaterThan(installIndex);
    expect(markerIndex).toBeGreaterThan(timestampIndex);
    expect(firstOpenIndex).toBeGreaterThan(markerIndex);
    expect(events[firstOpenIndex]).toContain('--device WZ Pixel API 35');
    expect(events[appStateIndex]).toContain('--serial emulator-5554');
    expect(dumpIndex).toBeGreaterThan(firstOpenIndex);
  });

  it('keeps normal and logged-out Replay journeys deterministic and isolated', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const loggedOutDeviceDir = path.join(rootDir, 'tests', 'device-logged-out');
    const expected = [
      'account-readonly.ad',
      'four-source-feed.ad',
      'library-return.ad',
      'more-readonly.ad',
      'nodeseek-session.ad',
      'notifications-readonly.ad',
      'search-multi-source.ad'
    ];
    expect(readdirSync(deviceDir).sort()).toEqual(expected);
    expect(listReplayFiles(deviceDir).map((file) => path.basename(file))).toEqual(expected);
    expect(readdirSync(loggedOutDeviceDir).sort()).toEqual(['logged-out-readonly.ad']);
    expect(listReplayFiles(loggedOutDeviceDir).map((file) => path.basename(file))).toEqual(['logged-out-readonly.ad']);

    for (const replayPath of [
      ...expected.map((file) => path.join(deviceDir, file)),
      path.join(loggedOutDeviceDir, 'logged-out-readonly.ad')
    ]) {
      const replay = readFileSync(replayPath, 'utf8');
      expect(replay).toContain('context platform=android');
      expect(replay).toContain('context retries=0');
      expect(replay).toContain('open ${APP_ID} --relaunch');
      expect(replay).not.toMatch(/^close\s*$/m);
      expect(replay).not.toMatch(/@[a-z]\d+/i);
      expect(replay).not.toMatch(/\b(?:press|click|swipe|longpress)\s+\d+\s+\d+/);
      expect(replay).not.toMatch(/(?:清除登录|退出登录|清空历史|取消收藏|取消关注|删除回复|提交回复|保存 Key|签到)/);
      expect(replay).not.toMatch(/^\s*(?:uninstall|reinstall|settings reset|shutdown)\b/m);
    }
    expect(
      expected.reduce(
        (count, file) =>
          count +
          (readFileSync(path.join(deviceDir, file), 'utf8').match(/open \$\{APP_ID\} --relaunch/g)?.length || 0),
        0
      )
    ).toBe(7);
    const loggedOutReplay = readFileSync(path.join(loggedOutDeviceDir, 'logged-out-readonly.ad'), 'utf8');
    expect(loggedOutReplay.match(/open \$\{APP_ID\} --relaunch/g)).toHaveLength(2);
    expect(
      loggedOutReplay.match(
        /wait "id=\\"account-site-nodeseek\\" label=\\"NodeSeek，未登录，已选择\\" \|\| id=\\"account-site-nodeseek\\" label=\\"NodeSeek，已验证，已选择\\"" 60000/g
      )
    ).toHaveLength(2);
    expect(loggedOutReplay).toContain(
      'wait "id=\\"account-site-linuxdo\\" label=\\"linux.do，匿名可用，已选择\\"" 60000'
    );
    expect(loggedOutReplay).toContain('wait "id=\\"account-site-yaohuo\\" label=\\"妖火，未登录，已选择\\"" 60000');
    expect(loggedOutReplay).not.toContain('测试工具');
    expect(loggedOutReplay).toContain('press id="search-source-all"');
    expect(loggedOutReplay).toContain('fill id="search-query" codex');
    expect(loggedOutReplay.match(/press id="search-submit"/g)).toHaveLength(2);
    expect(loggedOutReplay).toContain('wait id="search-external-linuxdo" 10000');
    expect(loggedOutReplay).toContain('wait id="search-external-nodeseek" 10000');
    expect(loggedOutReplay).toContain('press id="search-source-yaohuo"\nwait label="关闭" 60000');
    expect(loggedOutReplay).toContain('press id="feed-source-yaohuo"');
    expect(loggedOutReplay.match(/press label="关闭"/g)).toHaveLength(3);
    expect(loggedOutReplay.match(/wait 8000/g)).toHaveLength(3);
    expect(loggedOutReplay).not.toContain('back --system');
    expect(loggedOutReplay).toContain('press id="main-tab-feed"');
    expect(loggedOutReplay.match(/press id="main-tab-feed"/g)).toHaveLength(1);
    expect(loggedOutReplay).not.toContain('wait label="检测登录"');
    expect(loggedOutReplay).not.toContain('wait label="刷新页面"');

    const nodeSeekReplay = readFileSync(path.join(deviceDir, 'nodeseek-session.ad'), 'utf8');
    expect(nodeSeekReplay).not.toContain('nodeseek-login-webview-settled');
    expect(nodeSeekReplay).not.toContain('wait label="刷新页面"');
    expect(nodeSeekReplay).not.toContain('back --system');
    expect(nodeSeekReplay).not.toContain('nodeseek-login-webview-ready');
    expect(nodeSeekReplay).not.toMatch(/role=\\"(?:webview|image)\\"|label="新帖子"/);

    const fourSourceReplay = readFileSync(path.join(deviceDir, 'four-source-feed.ad'), 'utf8').replace(/\r\n/g, '\n');
    expect(fourSourceReplay).toContain(
      'wait "id=\\"feed-outcome-data-all-default\\" || id=\\"feed-outcome-empty-all-default\\" || id=\\"feed-outcome-partial-all-default\\" || id=\\"feed-outcome-error-all-default\\" || id=\\"feed-outcome-auth-all-default\\"" 60000'
    );
    for (const source of ['all', 'v2ex', 'linuxdo', 'nodeseek', 'yaohuo']) {
      expect(fourSourceReplay).toContain(`feed-source-${source}`);
    }
    expect(fourSourceReplay).not.toMatch(/feed-topic-first|topic-detail-loaded|scroll down|列表筛选/);

    const multiSourceSearchReplay = readFileSync(path.join(deviceDir, 'search-multi-source.ad'), 'utf8');
    expect(multiSourceSearchReplay).not.toContain('search-page-loaded-');
    expect(multiSourceSearchReplay).toContain('press label="清空搜索关键词"');
    expect(multiSourceSearchReplay).toContain('wait "label=\\"搜索最近记录 AI\\"" 10000');
    expect(multiSourceSearchReplay).not.toContain('press "label=\\"搜索最近记录 AI\\""');
    expect(multiSourceSearchReplay.match(/press id="search-submit"/g)).toHaveLength(1);
    expect(multiSourceSearchReplay).not.toMatch(
      /search-result-first|topic-detail-loaded|user-screen-loaded|back --system/
    );

    const accountReplay = readFileSync(path.join(deviceDir, 'account-readonly.ad'), 'utf8');
    const moreReplay = readFileSync(path.join(deviceDir, 'more-readonly.ad'), 'utf8');
    const notificationsReplay = readFileSync(path.join(deviceDir, 'notifications-readonly.ad'), 'utf8');
    const libraryReplay = readFileSync(path.join(deviceDir, 'library-return.ad'), 'utf8');
    expect(accountReplay).not.toMatch(/服务器代理|问题诊断|备份 \/ 恢复|外观/);
    expect(moreReplay).not.toMatch(/account-site-|查看等级|刷新等级|linuxdo-level-settled/);
    expect(moreReplay).toMatch(
      /内容源[\s\S]*content-source-drag-v2ex[\s\S]*服务器代理[\s\S]*问题诊断[\s\S]*备份 \/ 恢复[\s\S]*外观/
    );
    expect(moreReplay).toContain('press "label=\\"展开内容源\\""');
    for (const title of ['问题诊断', '备份 / 恢复', '外观']) {
      expect(moreReplay).toContain(`find "label=\\"展开${title}\\"" click`);
    }
    expect(moreReplay).not.toMatch(/^find "(?:内容源|问题诊断|备份 \/ 恢复|外观)" click$/m);
    for (const label of ['V2EX', 'linux.do', 'NodeSeek', '妖火']) {
      expect(moreReplay).toContain(`wait "label=\\"${label} 内容源开关\\"" 10000`);
    }
    expect(moreReplay).toMatch(
      /find "label=\\"展开外观\\"" click\s+scroll down\s+wait label="主题" 10000\s+wait label="字号" 10000/
    );
    expect(notificationsReplay).toContain('find "消息通知" click');
    for (const source of ['all', 'nodeseek', 'linuxdo', 'yaohuo']) {
      expect(notificationsReplay).toContain(`notification-source-${source}`);
      for (const outcome of ['data', 'empty', 'partial', 'error', 'auth']) {
        expect(notificationsReplay).toContain(`notification-outcome-${outcome}-${source}`);
      }
    }
    expect(notificationsReplay).not.toMatch(/全部标记为已读|全部已读|Android 消息通知/);
    expect(libraryReplay).toMatch(/library-favorites-ready[\s\S]*library-users-ready[\s\S]*library-history-ready/);
    expect(libraryReplay).not.toMatch(
      /library-user-first|library-history-first|topic-detail-loaded|user-screen-loaded/
    );
  });

  it('waits for the catalog-complete aggregate search outcome', () => {
    const loggedOutReplay = readFileSync(
      path.join(rootDir, 'tests', 'device-logged-out', 'logged-out-readonly.ad'),
      'utf8'
    );
    const multiSourceSearchReplay = readFileSync(
      path.join(rootDir, 'tests', 'device', 'search-multi-source.ad'),
      'utf8'
    );

    for (const replay of [loggedOutReplay, multiSourceSearchReplay]) {
      expect(replay).toContain('wait id="search-all-sources-settled" 60000');
      expect(replay).not.toMatch(/search-result-first|search-outcome-/);
      const aggregatePhase = replay.split('wait id="search-all-sources-settled" 60000')[0];
      expect(aggregatePhase.match(/press id="search-submit"/g)).toHaveLength(1);
    }
  });

  it('keeps transient account probe failures out of fixed Replay success requirements', () => {
    const accountReplay = readProjectFile('tests', 'device', 'account-readonly.ad');
    const nodeSeekReplay = readProjectFile('tests', 'device', 'nodeseek-session.ad');

    for (const [site, label] of [
      ['nodeseek', 'NodeSeek'],
      ['linuxdo', 'linux.do'],
      ['yaohuo', '妖火']
    ]) {
      const terminalSelector = `id=\\"account-site-${site}\\" label=\\"${label}，已登录，已选择\\" || id=\\"account-site-${site}\\" label=\\"${label}，本次核对失败，可重试，已选择\\"`;
      expect(accountReplay).toContain(`wait "${terminalSelector}" 60000`);
      if (site === 'nodeseek') expect(nodeSeekReplay).toContain(`wait "${terminalSelector}" 60000`);
    }

    expect(accountReplay).not.toMatch(/(?:press|click|find)\b[^\r\n]*刷新账号状态/);
    expect(nodeSeekReplay).toContain('wait "label=\\"检测或重新登录\\" || label=\\"登录并填入\\"" 10000');
    expect(nodeSeekReplay).not.toMatch(/nodeseek-login-webview-settled|press label="检测或重新登录"|刷新页面/);
  });

  it('keeps dynamic LinuxDo level transport out of fixed Replay', () => {
    const accountReplay = readProjectFile('tests', 'device', 'account-readonly.ad');

    expect(accountReplay).toContain(
      [
        'press id="account-site-linuxdo"',
        'wait "id=\\"account-site-linuxdo\\" label=\\"linux.do，已登录，已选择\\" || id=\\"account-site-linuxdo\\" label=\\"linux.do，本次核对失败，可重试，已选择\\"" 60000',
        'wait "text=\\"linux.do 等级\\"" 10000'
      ].join('\n')
    );
    expect(accountReplay).not.toMatch(/^(?:press|click|find)\b[^\r\n]*(?:查看等级|刷新等级)[^\r\n]*$/m);
    expect(accountReplay).not.toMatch(/linuxdo-level-settled|刷新等级/);
    expect(accountReplay).not.toMatch(/^(?:wait|sleep|delay)\s+\d+\s*$/m);
    expect(accountReplay).not.toContain('wait text="等级进度"');
  });

  it('keeps dynamic third-party success out of fixed Replay oracles', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const replayFiles = [
      ...listReplayFiles(deviceDir),
      ...listReplayFiles(path.join(rootDir, 'tests', 'device-logged-out'))
    ];
    const forbidden =
      /feed-topic-first|search-result-first|topic-detail-loaded|user-screen-loaded|role=\\"image\\" label=\\"logo\\"|label="新帖子"/;

    for (const replayFile of replayFiles) {
      expect(readFileSync(replayFile, 'utf8')).not.toMatch(forbidden);
    }

    const feedReplay = readProjectFile('tests', 'device', 'four-source-feed.ad');
    const loggedOutReplay = readProjectFile('tests', 'device-logged-out', 'logged-out-readonly.ad');
    for (const replay of [feedReplay, loggedOutReplay]) {
      expect(replay).toContain('feed-outcome-data-all-default');
      expect(replay).toContain('feed-outcome-empty-all-default');
      expect(replay).toContain('feed-outcome-partial-all-default');
      expect(replay).toContain('feed-outcome-error-all-default');
      expect(replay).toContain('feed-outcome-auth-all-default');
    }
  });

  it('starts independent journeys from their own App tab', () => {
    const targets = {
      'account-readonly.ad': 'more',
      'library-return.ad': 'library',
      'more-readonly.ad': 'more',
      'nodeseek-session.ad': 'more',
      'notifications-readonly.ad': 'more',
      'search-multi-source.ad': 'search'
    } as const;

    for (const [file, tab] of Object.entries(targets)) {
      const replay = readProjectFile('tests', 'device', file);
      expect(replay).toContain(`wait id="main-tab-${tab}" 60000`);
      expect(replay).not.toMatch(/feed-list-ready-|feed-outcome-/);
    }
    expect(readProjectFile('scripts', 'smoke-android.mjs')).not.toContain('feed-list-ready-');
  });

  it('keeps true logged-out Replay on its explicit isolated device suite', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const loggedOutDeviceDir = path.join(rootDir, 'tests', 'device-logged-out');
    const releaseReplayNames = listReplayFiles(deviceDir).map((file) => path.basename(file));

    expect(releaseReplayNames).toEqual([
      'account-readonly.ad',
      'four-source-feed.ad',
      'library-return.ad',
      'more-readonly.ad',
      'nodeseek-session.ad',
      'notifications-readonly.ad',
      'search-multi-source.ad'
    ]);
    expect(listReplayFiles(loggedOutDeviceDir).map((file) => path.basename(file))).toEqual(['logged-out-readonly.ad']);
    expect(readProjectFile('scripts', 'smoke-android.mjs')).not.toContain('device-logged-out');
    expect(readProjectFile('scripts', 'run-logged-out-device-replay.mjs')).toContain(
      "path.join(rootDir, 'tests', 'device-logged-out')"
    );
  });

  it('continues independent Replay files and reports all failures together', async () => {
    const attempted: string[] = [];
    let failure: unknown;

    try {
      await runReplayBatch(['first.ad', 'broken.ad', 'last.ad'], async (replayFile: string) => {
        attempted.push(replayFile);
        if (replayFile !== 'first.ad') {
          throw new Error(`${replayFile} failed`);
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(attempted).toEqual(['first.ad', 'broken.ad', 'last.ad']);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect((failure as Error).message).toContain('broken.ad');
    expect((failure as Error).message).toContain('last.ad');
  });

  it('stops before the next Replay when cleanup cannot restore isolation', async () => {
    const attempted: string[] = [];
    let failure: unknown;

    try {
      await runReplayBatch(['first.ad', 'cleanup-broken.ad', 'must-not-run.ad'], async (replayFile: string) => {
        attempted.push(replayFile);
        if (replayFile === 'cleanup-broken.ad') {
          throw new ReplayCleanupError(replayFile, new Error('recorder still running'));
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(attempted).toEqual(['first.ad', 'cleanup-broken.ad']);
    expect(failure).toBeInstanceOf(ReplayCleanupError);
    expect((failure as Error).message).toContain('cleanup-broken.ad');
  });

  it('requires explicit APK identity and writes Replay evidence only below ignored tmp', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const replayScript = readProjectFile('scripts', 'run-device-replay.mjs');

    expect(packageJson.scripts['test:device']).toBe('node scripts/run-device-replay.mjs');
    expect(replayScript).toContain('WZ_ANDROID_TEST_APK');
    expect(replayScript).toContain("['-s', deviceId, 'shell', 'pm', 'path', appPackage]");
    expect(replayScript).toContain("['-s', deviceId, 'pull', installedApkPath, localInstalledApk]");
    expect(replayScript).toContain('expectedSha256 !== installedSha256');
    expect(replayScript).toContain("path.join(rootDir, 'tmp', 'agent-device')");
    expect(replayScript).toContain('for (const replayFile of replayFiles)');
    expect(replayScript).toMatch(/'test',\s*replayFile/);
    expect(replayScript).toMatch(/'--retries',\s*'0'/);
    expect(replayScript).toMatch(/'--reporter',\s*`junit:\$\{junitPath\}`/);
    expect(replayScript).toMatch(/'--session',\s*replaySession/);
    expect(replayScript).toContain('assertNoExistingAgentDeviceRecording(device.id)');
    expect(replayScript).toContain('androidRecordingScratchPaths(device.id)');
    expect(replayScript).toContain('recoverOwnedReplayRecording(device, replaySession)');
    expect(replayScript).toMatch(/'record',\s*'stop'/);
    expect(replayScript).not.toContain('closeDefaultReplaySession');
    expect(replayScript).not.toContain("'shell', 'kill'");
    expect(replayScript).not.toContain('rm -f /sdcard/agent-device-recording-');
    expect(replayScript).not.toContain('stopNewLocalAgentDeviceDaemons');
    expect(replayScript).toContain("console.log('DEVICE_REPLAY_PASS');");
  });

  it('keeps stable selectors on the read-only navigation paths', () => {
    expect(readProjectFile('src', 'app', 'AppNavigator.tsx')).toContain('tabBarButtonTestID: `main-tab-${item.value}`');
    const selectionControls = readProjectFile('src', 'ui', 'controls', 'SelectionControls.tsx');
    expect(selectionControls).toContain('testID={testIDPrefix ? `${testIDPrefix}-${item.value}` : undefined}');
    expect(selectionControls).toContain(
      "accessibilityLabel={`${item.label}${value === item.value ? '，已选择' : ''}`}"
    );
    expect(selectionControls).not.toContain('react-native-reanimated');
    expect(selectionControls).not.toContain('<Animated.View');
    const feedScreen = readProjectFile('src', 'features', 'feed', 'FeedScreen.tsx');
    expect(feedScreen).toContain("testID={index === 0 ? 'feed-topic-first' : undefined}");
    expect(feedScreen).toContain("`feed-outcome-${feedOutcomeKind}-${feedSource}-${feedFilter ?? 'default'}`");
    expect(feedScreen).not.toContain('feed-list-ready-');
    expect(feedScreen).toContain('testID: `feed-source-${item.value}`');
    const searchScreen = readProjectFile('src', 'features', 'search', 'SearchScreen.tsx');
    expect(searchScreen).toContain('testID="search-query"');
    expect(searchScreen).toContain('testID="search-submit"');
    expect(searchScreen).toContain('testIDPrefix="search-source"');
    expect(searchScreen).toContain('search-overview-source-');
    expect(searchScreen).toContain('search-page-loaded-');
    expect(searchScreen).toContain('搜索最近记录');
    expect(searchScreen).not.toContain('search-outcome-');
    expect(searchScreen).not.toContain('search-result-first');
    expect(searchScreen).toContain("'search-all-sources-settled'");
    expect(searchScreen).toContain("'search-complete'");
    expect(readProjectFile('src', 'features', 'topic', 'components', 'TopicContentList.tsx')).toContain(
      "testID={topic ? 'topic-detail-loaded' : undefined}"
    );
    expect(readProjectFile('src', 'features', 'topic', 'components', 'TopicContentList.tsx')).toContain(
      'testID="topic-author"'
    );
    const libraryScreen = readProjectFile('src', 'features', 'library', 'LibraryScreen.tsx');
    expect(libraryScreen).toContain("'library-favorites-ready'");
    expect(libraryScreen).toContain("'library-users-ready'");
    expect(libraryScreen).toContain("'library-history-ready'");
    expect(libraryScreen).toContain("'library-user-first'");
    expect(libraryScreen).toContain("'library-history-first'");
    const accountCenter = readProjectFile('src', 'features', 'more', 'components', 'AccountCenterPanel.tsx');
    expect(accountCenter).toContain('testID={`account-site-${view.site}`}');
    const nodeSeekLoginHost = readProjectFile('src', 'features', 'account', 'components', 'NodeSeekLoginHost.tsx');
    expect(nodeSeekLoginHost).toContain('settledForReplay');
    expect(nodeSeekLoginHost).toContain("'nodeseek-login-webview-settled'");
    expect(nodeSeekLoginHost).not.toContain("'nodeseek-login-webview-ready'");
    expect(nodeSeekLoginHost).not.toContain('NODESEEK_REPLAY_READINESS_SCRIPT');
    expect(nodeSeekLoginHost).not.toContain('NODESEEK_REPLAY_READY_MESSAGE');
  });

  it('keeps diagnostic logging initialized and wired into the More screen', () => {
    const entry = readProjectFile('index.ts');
    const moreRoute = readProjectFile('src', 'features', 'more', 'MoreRoute.tsx');
    const utilityPanels = readProjectFile('src', 'features', 'more', 'components', 'MoreUtilityPanels.tsx');

    expect(entry).toContain(
      "import { initializeDiagnosticFileLogging } from '@/platform/diagnostics/diagnosticFileStore';"
    );
    const bootstrapCalls = (source: string) => {
      const calls: string[] = [];
      const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      runInNewContext(code, {
        exports: {},
        require: (name: string) =>
          name === 'expo'
            ? { registerRootComponent: () => calls.push('register') }
            : name.endsWith('/diagnosticFileStore')
              ? { initializeDiagnosticFileLogging: () => calls.push('diagnostics') }
              : name.endsWith('/notificationSystem')
                ? { installMessageNotificationHandler: () => calls.push('notifications') }
                : {}
      });
      return calls;
    };
    const expected = ['diagnostics', 'notifications', 'register'];
    expect(bootstrapCalls(entry)).toEqual(expected);
    expect(bootstrapCalls(entry.replace('initializeDiagnosticFileLogging();', ''))).not.toEqual(expected);
    expect(
      bootstrapCalls(
        entry
          .replace('initializeDiagnosticFileLogging();', '')
          .replace('registerRootComponent(App);', 'registerRootComponent(App); initializeDiagnosticFileLogging();')
      )
    ).not.toEqual(expected);
    expect(moreRoute).toMatch(
      /useDiagnosticLogController\(\{\s*getCurrentScreen: runtime\.diagnostics\.getCurrentScreen,\s*metadata: runtime\.diagnostics\.metadata,\s*notify: runtime\.notify\s*\}\)/
    );
    expect(moreRoute).toContain('exportLog: exportDiagnosticLogFile');
    expect(utilityPanels).toContain('title="问题诊断"');
    expect(utilityPanels).toContain('onPress={runtime.diagnostics.exportLog}');
  });

  it('runs Smoke only after APK signer verification and before writing the release manifest', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const signerIndex = releaseScript.indexOf('verifyExpectedReleaseSigner(signerSha256);');
    const smokeIndex = releaseScript.search(/run\('npm',\s*\[\s*'run',\s*'smoke:android'/);
    const manifestIndex = releaseScript.lastIndexOf('writeReleaseManifest({');

    expect(packageJson.scripts['smoke:android']).toBe('node scripts/smoke-android.mjs');
    expect(smokeIndex).toBeGreaterThan(signerIndex);
    expect(manifestIndex).toBeGreaterThan(smokeIndex);
  });

  it('loads the emulator Smoke ABI from release env and signs its development APK', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const loadEnvIndex = releaseScript.indexOf('const configuredReleaseEnv = loadReleaseEnvFile();');
    const smokeAbiIndex = releaseScript.indexOf(
      'const smokeApkAbi = requestedSmokeApkAbi(releaseEnv.WZ_ANDROID_SMOKE_ABI);'
    );

    expect(releaseScript).not.toContain('process.env.WZ_ANDROID_SMOKE_ABI');
    expect(smokeAbiIndex).toBeGreaterThan(loadEnvIndex);
    expect(releaseScript).toContain("['arm64-v8a', smokeApkAbi]");
    expect(releaseScript).toContain("path.join(androidDir, 'app', 'debug.keystore')");
    expect(releaseScript).toContain("'sign',");
    expect(releaseScript).toMatch(/run\('npm',\s*\[\s*'run',\s*'smoke:android',\s*'--',\s*smokeApkPath/);
  });
});
