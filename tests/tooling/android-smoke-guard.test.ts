import { copyFileSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  deviceSelectionArgs,
  isVersionSupported,
  runAgentDevice,
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
  runReplayBatch
} from '../../scripts/run-device-replay.mjs';
import { loggedOutDeviceName } from '../../scripts/run-logged-out-device-replay.mjs';
import { runSensitiveReplay, sensitiveReplayErrorCode, sensitiveReplayPlan } from '../../scripts/sensitive-replay.mjs';

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

function smokeTransportFixture() {
  const marker = 'smoke-controlled-launch';
  const agentCalls: string[][] = [];
  const adbCalls: string[][] = [];
  return {
    agentCalls,
    adbCalls,
    options: {
      apkPath: 'candidate.apk',
      device: { id: 'emulator-5554', name: 'WZ Pixel API 35' },
      marker,
      runAdbCommand: (args: string[]) => {
        adbCalls.push(args);
        if (args.includes('dumpsys')) return 'firstInstallTime=2026-07-26 16:51:37\n';
        if (args.includes('date')) return '1784102400.000\n';
        if (args.includes('pidof')) return '4321';
        if (args.includes('logcat')) {
          return [
            `07-15 16:00:00.000  2000  2000 I WZ_APK_SANITY: ${marker}`,
            '07-15 16:00:00.010  1000  1000 I ActivityManager: Start proc 4321:com.wz.reader/u0a123 for top-activity'
          ].join('\n');
        }
        return '';
      },
      runAgentDeviceCommand: (args: string[]) => {
        agentCalls.push(args);
        return args[0] === 'appstate' ? JSON.stringify({ data: { package: 'com.wz.reader' } }) : '';
      },
      verifySessionLog: () => undefined
    }
  };
}

describe('Android release evidence guards', () => {
  it('keeps logged-out testing outside the App and on an explicit isolated device', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const moreScreen = readProjectFile('src', 'features', 'more', 'MoreScreen.tsx');
    const nativePlugin =
      readProjectFile('plugins', 'withForumPlatform.js') +
      readProjectFile(
        'modules',
        'forum-platform',
        'android',
        'src',
        'main',
        'java',
        'com',
        'wz',
        'reader',
        'network',
        'NetworkProxyRuntime.kt'
      ) +
      readProjectFile(
        'modules',
        'forum-platform',
        'android',
        'src',
        'main',
        'java',
        'com',
        'wz',
        'reader',
        'network',
        'NetworkProxyModule.kt'
      );

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

  it.runIf(process.platform === 'win32')(
    'captures only stdout from the Windows Node CLI with unchanged arguments',
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'agent-device-command-'));
      const originalPath = process.env.PATH;
      try {
        const bin = path.join(directory, 'node_modules', 'agent-device', 'bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(path.join(directory, 'agent-device.ps1'), "throw 'Do not launch a PowerShell shim'");
        writeFileSync(
          path.join(bin, 'agent-device.mjs'),
          'process.stderr.write("warning: backend probe timed out\\n"); process.stdout.write(JSON.stringify(process.argv.slice(2)))'
        );
        process.env.PATH = directory;
        const args = ['--device', 'WZ Pixel API 35', '带空格 " 引号'];
        expect(JSON.parse(runAgentDevice(args, { capture: true, echoCapture: false }))).toEqual(args);
      } finally {
        process.env.PATH = originalPath;
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it('lets each Replay own its wall-clock budget', () => {
    const runner = readProjectFile('scripts', 'run-device-replay.mjs');
    const feedSourceControls = readProjectFile('tests', 'device', 'feed-source-controls.ad');

    expect(runner).not.toContain("'--timeout', '180000'");
    expect(feedSourceControls).toContain('context timeout=240000');
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

  it.each([undefined, null, false, 0, ''])('retains business %s when Smoke session cleanup fails', (business) => {
    const closeError = new Error('session close failed');
    let failure: unknown;
    try {
      withSmokeSession(
        {
          selectedDevice: 'WZ Pixel API 35',
          runAgentDeviceCommand: (args: string[]) => {
            if (args[0] === 'close') throw closeError;
            return bootedAndroidDeviceOutput;
          }
        },
        () => {
          throw business;
        }
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    if (failure instanceof AggregateError) expect(failure.errors).toEqual([business, closeError]);
  });

  it.each([undefined, null, false, 0, ''])('preserves business %s when Smoke session cleanup succeeds', (business) => {
    const commands: string[] = [];
    let caught = false;
    try {
      withSmokeSession(
        {
          selectedDevice: 'WZ Pixel API 35',
          runAgentDeviceCommand: (args: string[]) => {
            commands.push(args[0]);
            return bootedAndroidDeviceOutput;
          }
        },
        () => {
          throw business;
        }
      );
    } catch (error) {
      caught = true;
      expect(error).toBe(business);
    }

    expect(caught).toBe(true);
    expect(commands).toEqual(['boot', 'close']);
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
    expect(deviceSelectionArgs(devices[0].name)).toEqual(['--device', 'WZ Pixel API 35']);
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

  it.each([undefined, null, false, 0, ''])(
    'blocks first launch after replacement install throws %s',
    (installError) => {
      const fixture = smokeTransportFixture();
      let failure: unknown;
      try {
        runApkSanity({
          ...fixture.options,
          runAgentDeviceCommand: (args: string[]) => {
            const output = fixture.options.runAgentDeviceCommand(args);
            if (args[0] === 'install') throw installError;
            return output;
          }
        });
      } catch (error) {
        failure = error;
      }

      expect(fixture.adbCalls.filter((args) => args.includes('dumpsys'))).toHaveLength(2);
      expect(fixture.agentCalls.map((args) => args[0])).toEqual(['install']);
      expect(failure).toBeInstanceOf(Error);
      if (failure instanceof Error) {
        expect(failure.message).toContain('BLOCKED_BY_ENV：覆盖安装失败');
        expect(failure.cause).toBe(installError);
      }
    }
  );

  it('stops and verifies the log stream even when the terminal marker fails', () => {
    const fixture = smokeTransportFixture();
    const markerError = new Error('end marker failed');
    const cleanup: string[] = [];
    let failure: unknown;
    try {
      runApkSanity({
        ...fixture.options,
        runAgentDeviceCommand: (args: string[]) => {
          const output = fixture.options.runAgentDeviceCommand(args);
          if (args[0] === 'logs' && args[1] === 'mark' && args[2] === 'wz-apk-sanity-end') {
            cleanup.push('mark');
            throw markerError;
          }
          if (args[0] === 'logs' && args[1] === 'stop') cleanup.push('stop');
          return output;
        },
        verifySessionLog: () => {
          cleanup.push('verify');
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(cleanup).toEqual(['mark', 'stop', 'verify']);
    expect(failure).toBeInstanceOf(AggregateError);
    if (failure instanceof AggregateError) expect(failure.errors).toEqual([markerError]);
  });

  it('retains each terminal log cleanup failure while attempting every step', () => {
    const fixture = smokeTransportFixture();
    const markerError = new Error('end marker failed');
    const stopError = new Error('log stop failed');
    const verificationError = new Error('log read failed');
    let failure: unknown;
    try {
      runApkSanity({
        ...fixture.options,
        runAgentDeviceCommand: (args: string[]) => {
          const output = fixture.options.runAgentDeviceCommand(args);
          if (args[0] === 'logs' && args[1] === 'mark' && args[2] === 'wz-apk-sanity-end') throw markerError;
          if (args[0] === 'logs' && args[1] === 'stop') throw stopError;
          return output;
        },
        verifySessionLog: () => {
          throw verificationError;
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    if (failure instanceof AggregateError) expect(failure.errors).toEqual([markerError, stopError, verificationError]);
  });

  it('keeps normal and logged-out Replay journeys deterministic and isolated', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const loggedOutDeviceDir = path.join(rootDir, 'tests', 'device-logged-out');
    const expected = [
      'account-readonly.ad',
      'feed-gesture-priority.ad',
      'feed-source-controls.ad',
      'library-return.ad',
      'more-readonly.ad',
      'nodeseek-session.ad',
      'notifications-readonly.ad',
      'search-multi-source.ad'
    ];
    expect(
      readdirSync(deviceDir)
        .filter((file) => file.endsWith('.ad'))
        .sort()
    ).toEqual(expected);
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
    ).toBe(8);
    const loggedOutReplay = readFileSync(path.join(loggedOutDeviceDir, 'logged-out-readonly.ad'), 'utf8');
    expect(loggedOutReplay.match(/open \$\{APP_ID\} --relaunch/g)).toHaveLength(2);
    expect(loggedOutReplay.match(/wait "text=\\"已登录 0\/3\\"/g)).toHaveLength(2);
    expect(loggedOutReplay).toContain('press label="刷新账号"');
    expect(loggedOutReplay).not.toContain('刷新账号状态');
    expect(loggedOutReplay).toContain('press "id=\\"main-tab-more\\" || label=\\"关闭\\""');
    expect(
      loggedOutReplay.match(
        /wait "id=\\"account-site-nodeseek\\" label=\\"NodeSeek，未登录，已选择\\" \|\| id=\\"account-site-nodeseek\\" label=\\"NodeSeek，已验证，已选择\\"" 60000/g
      )
    ).toHaveLength(2);
    expect(loggedOutReplay).toContain(
      'wait "id=\\"account-site-linuxdo\\" label=\\"linux.do，匿名可用，已选择\\" || id=\\"account-site-linuxdo\\" label=\\"linux.do，已验证，已选择\\" || id=\\"account-site-linuxdo\\" label=\\"linux.do，需要验证，已选择\\"" 60000'
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

    const feedSourceReplay = readFileSync(path.join(deviceDir, 'feed-source-controls.ad'), 'utf8').replace(
      /\r\n/g,
      '\n'
    );
    expect(feedSourceReplay).toContain(
      'wait "id=\\"feed-outcome-data-all-default\\" || id=\\"feed-outcome-empty-all-default\\" || id=\\"feed-outcome-partial-all-default\\" || id=\\"feed-outcome-error-all-default\\" || id=\\"feed-outcome-auth-all-default\\"" 60000'
    );
    for (const source of ['all', 'v2ex', 'linuxdo', 'nodeseek', 'yaohuo']) {
      expect(feedSourceReplay).toContain(`feed-source-${source}`);
    }
    expect(feedSourceReplay).not.toMatch(/feed-topic-first|topic-detail-loaded|scroll down|列表筛选/);

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
    expect(moreReplay).not.toMatch(/查看等级|刷新等级|linuxdo-level-settled/);
    for (const site of ['nodeseek', 'linuxdo', 'yaohuo']) {
      expect(moreReplay).toContain(
        `press id="account-site-${site}"\npress label="站点设置"\nwait id="account-site-settings" 10000`
      );
    }
    expect(moreReplay.match(/press label="站点设置"/g)).toHaveLength(6);
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
      /find "label=\\"展开外观\\"" click\s+scroll down 0\.3\s+wait label="主题" 10000\s+wait label="字号" 10000/
    );
    expect(notificationsReplay).toContain('press id="main-tab-notifications"');
    expect(libraryReplay).toContain('press "role=button label=\\"收藏\\""');
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
    const forbidden = /search-result-first|user-screen-loaded|role=\\"image\\" label=\\"logo\\"|label="新帖子"/;

    for (const replayFile of replayFiles) {
      expect(readFileSync(replayFile, 'utf8')).not.toMatch(forbidden);
      // Native scrolling/navigation needs loaded Feed/Topic content; outcome replays also accept errors/empty data.
      if (path.basename(replayFile) !== 'feed-gesture-priority.ad') {
        expect(readFileSync(replayFile, 'utf8')).not.toMatch(/feed-topic-first|topic-detail-loaded/);
      }
    }

    const feedReplay = readProjectFile('tests', 'device', 'feed-source-controls.ad');
    const loggedOutReplay = readProjectFile('tests', 'device-logged-out', 'logged-out-readonly.ad');
    for (const replay of [feedReplay, loggedOutReplay]) {
      expect(replay).toContain('feed-outcome-data-all-default');
      expect(replay).toContain('feed-outcome-empty-all-default');
      expect(replay).toContain('feed-outcome-partial-all-default');
      expect(replay).toContain('feed-outcome-error-all-default');
      expect(replay).toContain('feed-outcome-auth-all-default');
    }
  });

  it('binds the ongoing reading proof app before screenshots without restarting it', () => {
    const replay = readProjectFile('dev', 'review-remediation-proof', 'reading-order.ad');
    const commands = replay
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('context '));
    const opens = commands.filter((line) => line.startsWith('open '));
    expect(opens).toEqual(['open com.wz.reader']);
    const openIndex = commands.indexOf(opens[0]);
    const screenshots = commands.flatMap((line, index) => (line.startsWith('screenshot ') ? [index] : []));
    expect(screenshots).toHaveLength(2);
    expect(screenshots.every((index) => index > openIndex)).toBe(true);
    expect(commands.some((line) => line.startsWith('close'))).toBe(false);
    const selectIndex = commands.findIndex((line) => line.startsWith('press '));
    expect(commands.slice(selectIndex - 1, selectIndex + 1)).toEqual([
      'wait label="${TO}" 10000',
      'press label="${TO}"'
    ]);
    expect(commands.slice(selectIndex + 1)).toEqual(['wait label="#${FIRST_FLOOR}" 15000', 'screenshot "${AFTER}"']);
  });

  it('starts independent journeys from their own App tab', () => {
    const targets = {
      'account-readonly.ad': 'more',
      'library-return.ad': 'more',
      'more-readonly.ad': 'more',
      'nodeseek-session.ad': 'more',
      'notifications-readonly.ad': 'notifications',
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
      'feed-gesture-priority.ad',
      'feed-source-controls.ad',
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

  it.each(
    (['default', 'logged-out'] as const).flatMap((suite) =>
      (['success', 'selector-failure', 'cleanup-failure'] as const).map((outcome) => ({ suite, outcome }))
    )
  )(
    'runs $suite Replay without sensitive captures, recording or raw backend errors on $outcome',
    async ({ suite, outcome }) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'wz-sensitive-replay-'));
      const apkPath = path.join(directory, 'candidate.apk');
      writeFileSync(apkPath, 'controlled APK');
      const artifacts = path.join(rootDir, 'tmp', 'agent-device');
      const files = new Map<string, string>();
      const canary = 'PRIVATE_PROXY_CANARY.invalid:38473';
      const sensitive =
        suite === 'logged-out' ? ['logged-out-readonly'] : ['account-readonly', 'more-readonly', 'nodeseek-session'];
      const failureJourney = suite === 'logged-out' ? 'logged-out-readonly' : 'more-readonly';
      const testCalls: string[] = [];
      const atomicCalls: {
        args: string[];
        capture: unknown;
        echoCapture: unknown;
        inheritedCapture: boolean;
        timeout: number | undefined;
      }[] = [];
      const config = JSON.parse(readProjectFile('app.json')).expo;
      vi.resetModules();
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        return {
          ...actual,
          mkdirSync: (target: string, options?: Parameters<typeof mkdirSync>[1]) =>
            target.startsWith(artifacts) ? undefined : actual.mkdirSync(target, options),
          writeFileSync: (target: string, data: string) => {
            if (target.startsWith(artifacts)) files.set(target, String(data));
            else actual.writeFileSync(target, data);
          }
        };
      });
      vi.doMock('node:child_process', () => ({
        spawnSync: (command: string, args: string[]) => {
          if (command === 'git') return { status: 0, stdout: args[0] === 'rev-parse' ? 'revision' : '' };
          if (command !== 'adb') throw new Error('Unexpected controlled command');
          if (args.includes('dumpsys'))
            return { status: 0, stdout: `versionCode=${config.android.versionCode}\nversionName=${config.version}\n` };
          if (args.includes('path')) return { status: 0, stdout: 'package:/data/app/controlled/base.apk\n' };
          if (args.includes('pull')) copyFileSync(apkPath, args[args.indexOf('pull') + 2]);
          return { status: args.includes('cat') ? 1 : 0, stdout: '' };
        }
      }));
      vi.doMock('../../scripts/agent-device-runtime.mjs', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../../scripts/agent-device-runtime.mjs')>()),
        assertAgentDeviceVersion: () => '0.20.6',
        runAgentDevice: (
          args: string[],
          options?: { capture?: boolean; echoCapture?: boolean; env?: NodeJS.ProcessEnv; timeout?: number }
        ) => {
          if (args[0] === 'test') {
            const name = path.basename(args[1], '.ad');
            testCalls.push(name);
            const artifactDirectory = args[args.indexOf('--artifacts-dir') + 1];
            if (sensitive.includes(name)) files.set(path.join(artifactDirectory, 'recording.mp4'), canary);
            const reporter = args.find((arg) => arg.startsWith('junit:'));
            if (reporter) files.set(reporter.slice(6), '<testsuite tests="1" failures="0"/>');
            return '';
          }
          atomicCalls.push({
            args,
            capture: options?.capture,
            echoCapture: options?.echoCapture,
            inheritedCapture: Object.hasOwn(options?.env || {}, 'AGENT_DEVICE_EXEC_TRACE'),
            timeout: options?.timeout
          });
          if (
            (outcome === 'selector-failure' &&
              args[0] === 'wait' &&
              args[1] === (suite === 'logged-out' ? '8000' : 'text="使用代理"')) ||
            (outcome === 'cleanup-failure' &&
              args[0] === 'close' &&
              args[args.indexOf('--session') + 1].endsWith(`-${failureJourney}`))
          ) {
            throw Object.assign(new Error(canary), {
              stdout: JSON.stringify({ success: false, error: { code: 'ELEMENT_NOT_FOUND', message: canary } })
            });
          }
          return JSON.stringify({ success: true, data: { targetEvidence: canary } });
        }
      }));
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.stubEnv('AGENT_DEVICE_EXEC_TRACE', 'PRIVATE_TRACE_CANARY');
      let failure: unknown;
      try {
        const { runDeviceReplay: controlledReplay } = await import('../../scripts/run-device-replay.mjs');
        try {
          await controlledReplay({
            apkPath,
            selectedDevice: 'Controlled device',
            device: { id: 'controlled-device', name: 'Controlled device' },
            ...(suite === 'logged-out' ? { replayDirectory: path.join(rootDir, 'tests', 'device-logged-out') } : {})
          });
        } catch (error) {
          failure = error;
        }
        expect(testCalls).toEqual(
          suite === 'logged-out'
            ? []
            : outcome === 'cleanup-failure'
              ? ['feed-gesture-priority', 'feed-source-controls', 'library-return']
              : [
                  'feed-gesture-priority',
                  'feed-source-controls',
                  'library-return',
                  'notifications-readonly',
                  'search-multi-source'
                ]
        );
        for (const name of outcome === 'cleanup-failure' ? sensitive.slice(0, 2) : sensitive) {
          const calls = atomicCalls.filter(({ args }) => args[args.indexOf('--session') + 1]?.endsWith(`-${name}`));
          expect(calls.length).toBeGreaterThan(2);
          expect(calls.at(-1)?.args[0]).toBe('close');
          expect(calls.every(({ capture, echoCapture }) => capture === true && echoCapture === false)).toBe(true);
          expect(calls.every(({ inheritedCapture }) => !inheritedCapture)).toBe(true);
          expect(calls.every(({ timeout }) => typeof timeout === 'number' && timeout > 0 && timeout <= 240000)).toBe(
            true
          );
          expect(calls.every(({ args }) => args.includes('--no-record') && args.includes('--json'))).toBe(true);
          expect(calls.every(({ args }) => files.get(args[args.indexOf('--config') + 1]) === '{}\n')).toBe(true);
          expect(
            calls.every(
              ({ args }) =>
                !args.some((arg) =>
                  ['test', 'replay', 'snapshot', 'screenshot', 'record', '--out', '--record-video'].includes(arg)
                )
            )
          ).toBe(true);
          expect(files.has(path.join(artifacts, `${name}.junit.xml`))).toBe(true);
        }
        expect([...files.keys()].some((file) => /\.(?:png|mp4)$|overflow|divergence/.test(file))).toBe(false);
        expect([...files.values()].join('\n')).not.toContain(canary);
        expect(String(failure)).not.toContain(canary);
        expect(failure instanceof AggregateError).toBe(outcome === 'selector-failure');
        if (outcome === 'cleanup-failure') expect((failure as Error).name).toBe('ReplayCleanupError');
        expect(files.get(path.join(artifacts, `${failureJourney}.junit.xml`))).toContain(
          `failures="${outcome === 'success' ? 0 : 1}"`
        );
      } finally {
        log.mockRestore();
        vi.unstubAllEnvs();
        vi.doUnmock('node:fs');
        vi.doUnmock('node:child_process');
        vi.doUnmock('../../scripts/agent-device-runtime.mjs');
        vi.resetModules();
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it.each([
    '\nscreenshot private.png',
    '\npress label="${UNKNOWN}"',
    '\ncontext recordVideo=true',
    '\nenv SECRET=private',
    '\nfill label="账号" private',
    '\nfill id="search-query" PRIVATE_INPUT_CANARY',
    '\nfill id="account-site-linuxdo" codex',
    '\nfill text="search-query" codex',
    '\nkeyboard show',
    '\nwait 9000'
  ])('rejects unsupported sensitive script content before the first device action: %s', (extra) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wz-sensitive-plan-'));
    const replayFile = path.join(directory, 'more-readonly.ad');
    const run = vi.fn();
    try {
      writeFileSync(replayFile, `${readProjectFile('tests/device/more-readonly.ad')}${extra}\n`);
      const result = runSensitiveReplay({
        replayFile,
        replaySession: 'controlled',
        deviceName: 'Controlled device',
        appPackage: 'com.wz.reader',
        artifactsDir: directory,
        junitPath: path.join(directory, 'result.xml'),
        runAgentDevice: run,
        cwd: rootDir
      });
      expect(result.error?.message).toContain('INVALID_SCRIPT');
      expect(run).not.toHaveBeenCalled();
      expect(readFileSync(path.join(directory, 'result.xml'), 'utf8')).toContain('failures="1"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves the authored sensitive selectors, ordering and timeout without accepting arbitrary error codes', () => {
    const plan = sensitiveReplayPlan(readProjectFile('tests/device/account-readonly.ad'), 'com.wz.reader');
    expect(plan.timeout).toBe(240000);
    expect(plan.steps[0]).toEqual(['open', 'com.wz.reader', '--relaunch']);
    expect(plan.steps[6]).toEqual([
      'wait',
      'id="account-site-nodeseek" label="NodeSeek，已登录，已选择" || id="account-site-nodeseek" label="NodeSeek，本次核对失败，可重试，已选择"',
      '60000'
    ]);
    const more = sensitiveReplayPlan(readProjectFile('tests/device/more-readonly.ad'), 'com.wz.reader');
    expect(more.steps).toContainEqual(['find', 'label="展开备份 / 恢复"', 'click']);
    expect(more.steps).toContainEqual(['wait', 'stable', '1500', '15000']);
    const loggedOut = sensitiveReplayPlan(
      readProjectFile('tests/device-logged-out/logged-out-readonly.ad'),
      'com.wz.reader'
    );
    expect(loggedOut.timeout).toBe(240000);
    expect(loggedOut.steps.filter(([command]) => command === 'open')).toHaveLength(2);
    expect(
      loggedOut.steps.filter((step, index) => {
        if (step[0] !== 'wait' || !step[1].startsWith('text="已登录 0/3"')) return false;
        expect(loggedOut.steps[index - 1]).toEqual(['wait', 'id="my-account"', '10000']);
        return true;
      })
    ).toHaveLength(2);
    expect(loggedOut.steps).not.toContainEqual(['press', 'label="展开账号中心"']);
    expect(loggedOut.steps).not.toContainEqual(['press', 'label="收起账号中心"']);
    expect(loggedOut.steps.filter(([command]) => command === 'fill')).toEqual([['fill', 'id="search-query"', 'codex']]);
    expect(loggedOut.steps.filter(([command]) => command === 'keyboard')).toEqual([
      ['keyboard', 'dismiss'],
      ['keyboard', 'dismiss']
    ]);
    expect(loggedOut.steps.filter(([command, value]) => command === 'wait' && value === '8000')).toHaveLength(3);
    expect(sensitiveReplayErrorCode({ stdout: JSON.stringify({ error: { code: 'PRIVATE_VALUE_CANARY' } }) })).toBe(
      'COMMAND_FAILED'
    );
  });

  it('bounds atomic waits by the remaining journey deadline and closes once without retrying', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wz-sensitive-deadline-'));
    const replayFile = path.join(directory, 'account-readonly.ad');
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const run = vi.fn((args: string[]) => {
      if (args[0] === 'open') now = 239990;
      if (args[0] === 'wait') {
        expect(args[2]).toBe('10');
        now = 240001;
        return JSON.stringify({ success: false, error: { code: 'TIMEOUT' } });
      }
      return JSON.stringify({ success: true });
    });
    try {
      writeFileSync(replayFile, readProjectFile('tests/device/account-readonly.ad'));
      const result = runSensitiveReplay({
        replayFile,
        replaySession: 'controlled',
        deviceName: 'Controlled device',
        appPackage: 'com.wz.reader',
        artifactsDir: directory,
        junitPath: path.join(directory, 'result.xml'),
        runAgentDevice: run,
        cwd: rootDir
      });
      expect(result.error?.message).toContain('TIMEOUT');
      expect(run.mock.calls.map(([args]) => args[0])).toEqual(['open', 'wait', 'close']);
      expect(readFileSync(path.join(directory, 'result.xml'), 'utf8')).toContain('unreached step 3');
    } finally {
      clock.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('bounds the fixed logged-out delay by the remaining deadline without changing its command shape', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wz-sensitive-delay-'));
    const replayFile = path.join(directory, 'logged-out-readonly.ad');
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const run = vi.fn((args: string[]) => {
      if (args[0] === 'open') now = 239990;
      if (args[0] === 'wait') {
        expect(args.slice(0, 2)).toEqual(['wait', '10']);
        now = 240001;
      }
      return JSON.stringify({ success: true });
    });
    try {
      writeFileSync(
        replayFile,
        'context platform=android\ncontext timeout=240000\ncontext retries=0\nenv APP_ID=com.wz.reader\n' +
          'open ${APP_ID} --relaunch\nwait 8000\nkeyboard dismiss\n'
      );
      const result = runSensitiveReplay({
        replayFile,
        replaySession: 'controlled',
        deviceName: 'Controlled device',
        appPackage: 'com.wz.reader',
        artifactsDir: directory,
        junitPath: path.join(directory, 'result.xml'),
        runAgentDevice: run,
        cwd: rootDir
      });
      expect(result.error?.message).toContain('TIMEOUT');
      expect(run.mock.calls.map(([args]) => args[0])).toEqual(['open', 'wait', 'close']);
    } finally {
      clock.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
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

  it.each([undefined, null, false, 0, '', new Error('controlled Replay failure')])(
    'retains Replay failure %s and stops on every recording cleanup failure',
    async (thrown) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'wz-replay-outcome-'));
      const apkPath = path.join(directory, 'candidate.apk');
      const replayDirectory = path.join(directory, 'replays');
      const prefix = path.basename(directory);
      const names = [`${prefix}-first`, `${prefix}-last`];
      mkdirSync(replayDirectory);
      writeFileSync(apkPath, 'controlled APK identity');
      for (const name of names) writeFileSync(path.join(replayDirectory, `${name}.ad`), 'context timeout=1000\n');
      const config = JSON.parse(readProjectFile('app.json')).expo;
      let activeSession: string | undefined;
      const attempted: string[] = [];
      const stops: string[] = [];
      let scenario: 'body' | 'cleanup' | 'both' | 'success' = 'success';
      const cleanupError = new Error('controlled recording stop failure');
      vi.resetModules();
      vi.doMock('node:child_process', () => ({
        spawnSync: (command: string, args: string[]) => {
          if (command === 'git') return { status: 0, stdout: args[0] === 'rev-parse' ? 'revision' : '' };
          if (command !== 'adb') throw new Error(`Unexpected command: ${command}`);
          if (args.includes('dumpsys')) {
            return { status: 0, stdout: `versionCode=${config.android.versionCode}\nversionName=${config.version}\n` };
          }
          if (args.includes('path')) return { status: 0, stdout: 'package:/data/app/controlled/base.apk\n' };
          if (args.includes('pull')) {
            copyFileSync(apkPath, args[args.indexOf('pull') + 2]);
            return { status: 0, stdout: '' };
          }
          if (args.includes('cat')) {
            return activeSession && args[args.length - 1].startsWith('/sdcard/')
              ? {
                  status: 0,
                  stdout: JSON.stringify({
                    version: 1,
                    deviceId: 'controlled-device',
                    sessionName: `${activeSession}:test:1`,
                    recordingId: 'controlled-recording',
                    current: { remotePath: '/sdcard/agent-device-recording-123.mp4' }
                  })
                }
              : { status: 1, stdout: '' };
          }
          if (args.includes('ps') || args.includes('ls')) return { status: 0, stdout: '' };
          throw new Error(`Unexpected adb command: ${args.join(' ')}`);
        }
      }));
      vi.doMock('../../scripts/agent-device-runtime.mjs', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../../scripts/agent-device-runtime.mjs')>()),
        assertAgentDeviceVersion: () => '0.20.6',
        runAgentDevice: (args: string[]) => {
          if (args[0] === 'test') {
            attempted.push(path.basename(args[1], '.ad'));
            activeSession = args[args.indexOf('--session') + 1];
            if (scenario === 'body' || scenario === 'both') throw thrown;
            return '';
          }
          if (args[0] === 'record' && args[1] === 'stop') {
            stops.push(args[args.indexOf('--session') + 1]);
            if (scenario === 'cleanup') throw thrown;
            if (scenario === 'both') throw cleanupError;
            activeSession = undefined;
            return '';
          }
          throw new Error(`Unexpected agent-device command: ${args.join(' ')}`);
        }
      }));
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const { runDeviceReplay: runControlledReplay, ReplayCleanupError: CleanupError } =
          await import('../../scripts/run-device-replay.mjs');
        for (const current of ['body', 'cleanup', 'both', 'success'] as const) {
          scenario = current;
          activeSession = undefined;
          attempted.length = 0;
          stops.length = 0;
          let result: { kind: 'passed' } | { kind: 'failed'; error: unknown } = { kind: 'passed' };
          try {
            await runControlledReplay({
              apkPath,
              selectedDevice: 'Controlled device',
              device: { id: 'controlled-device', name: 'Controlled device' },
              replayDirectory
            });
          } catch (error) {
            result = { kind: 'failed', error };
          }
          expect(attempted, current).toEqual(current === 'cleanup' || current === 'both' ? [names[0]] : names);
          expect(stops, current).toHaveLength(attempted.length);
          if (current === 'success') {
            expect(result).toEqual({ kind: 'passed' });
          } else {
            expect(result.kind, current).toBe('failed');
            if (result.kind !== 'failed') throw new Error(`${current} incorrectly passed`);
            if (current === 'body') {
              if (!(result.error instanceof AggregateError)) throw new Error('Missing Replay failures');
              expect(result.error.errors.map((error: Error) => error.message)).toEqual([
                thrown instanceof Error ? thrown.message : String(thrown),
                thrown instanceof Error ? thrown.message : String(thrown)
              ]);
              if (thrown instanceof Error) {
                expect(result.error.errors[0]).toBe(thrown);
                expect(result.error.errors[1]).toBe(thrown);
              }
            } else {
              if (!(result.error instanceof CleanupError)) throw new Error('Missing cleanup failure');
              if (current === 'cleanup') expect(result.error.cause).toBe(thrown);
              else {
                if (!(result.error.cause instanceof AggregateError)) throw new Error('Missing combined causes');
                expect(result.error.cause.errors).toHaveLength(2);
                expect(result.error.cause.errors[0]).toBe(thrown);
                expect(result.error.cause.errors[1]).toBe(cleanupError);
              }
            }
          }
        }
      } finally {
        log.mockRestore();
        vi.doUnmock('node:child_process');
        vi.doUnmock('../../scripts/agent-device-runtime.mjs');
        vi.resetModules();
        rmSync(directory, { recursive: true, force: true });
        for (const name of names)
          rmSync(path.join(rootDir, 'tmp', 'agent-device', name), { recursive: true, force: true });
      }
    }
  );

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

  it('keeps diagnostic logging initialized and wired into the More screen', () => {
    const entry = readProjectFile('index.ts');
    const moreRoute = readProjectFile('src', 'features', 'more', 'MoreRoute.tsx');
    const utilityPanels = readProjectFile('src', 'features', 'more', 'components', 'MoreUtilityPanels.tsx');

    const bootstrapImport = "import '@/platform/diagnostics/diagnosticBootstrap';";
    const bootstrap = readProjectFile('src', 'platform', 'diagnostics', 'diagnosticBootstrap.ts');
    const bootstrapCalls = (source: string) => {
      const calls: string[] = [];
      const execute = (input: string) => {
        const code = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
        runInNewContext(code, {
          exports: {},
          require: (name: string) => {
            if (name.endsWith('/diagnosticBootstrap')) {
              execute(bootstrap);
              return {};
            }
            if (name === './App') {
              calls.push('app-import');
              return {};
            }
            if (name === 'expo') return { registerRootComponent: () => calls.push('register') };
            if (name.endsWith('/diagnosticFileStore'))
              return { initializeDiagnosticFileLogging: () => calls.push('diagnostics') };
            if (name.endsWith('/startupTiming'))
              return {
                setStartupTimingRecorder: () => calls.push('timing-installed'),
                recordStartupPhase: (phase: string) => calls.push(phase)
              };
            if (name.endsWith('/notificationSystem'))
              return { installMessageNotificationHandler: () => calls.push('notifications') };
            return {};
          }
        });
      };
      execute(source);
      return calls;
    };
    const expected = ['diagnostics', 'timing-installed', 'js-entry', 'app-import', 'notifications', 'register'];
    expect(bootstrapCalls(entry)).toEqual(expected);
    expect(bootstrapCalls(entry.replace(bootstrapImport, ''))).not.toEqual(expected);
    expect(
      bootstrapCalls(
        entry
          .replace(bootstrapImport, '')
          .replace("import App from './App';", `import App from './App'; ${bootstrapImport}`)
      )
    ).not.toEqual(expected);
    expect(moreRoute).toMatch(
      /useDiagnosticLogController\(\{\s*getCurrentScreen: runtime\.diagnostics\.getCurrentScreen,\s*metadata: runtime\.diagnostics\.metadata,\s*notify: runtime\.notify\s*\}\)/
    );
    expect(moreRoute).toContain('exportLog: exportDiagnosticLogFile');
    expect(utilityPanels).toContain('title="问题诊断"');
    expect(utilityPanels).toContain('onPress={runtime.diagnostics.exportLog}');
  });
});
