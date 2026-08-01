import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  capturedAgentDeviceOutput,
  deviceSelectionArgs,
  isVersionSupported,
  MIN_AGENT_DEVICE_VERSION
} from '../scripts/agent-device-runtime.mjs';
import { runApkSanity, withSmokeSession } from '../scripts/smoke-android.mjs';
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
} from '../scripts/run-device-replay.mjs';
import { loggedOutDeviceName } from '../scripts/run-logged-out-device-replay.mjs';

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release evidence guards', () => {
  it('[REG-TEST-003] keeps logged-out testing outside the App and on an explicit isolated device', () => {
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

  it('[REG-OPS-008] requires the first agent-device version that supports Replay recording and reporters', () => {
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

  it('[REG-OPS-010] keeps successful agent-device diagnostics out of captured JSON', () => {
    const output = capturedAgentDeviceOutput({
      stdout: '{"success":true,"data":{"devices":[]}}',
      stderr: 'warning: backend probe timed out\n'
    });

    expect(parseAgentDeviceList(output)).toEqual([]);
  });

  it('[REG-OPS-011] lets each Replay own its wall-clock budget', () => {
    const runner = readProjectFile('scripts', 'run-device-replay.mjs');
    const fourSourceFeed = readProjectFile('tests', 'device', 'four-source-feed.ad');

    expect(runner).not.toContain("'--timeout', '180000'");
    expect(fourSourceFeed).toContain('context timeout=240000');
  });

  it('[REG-OPS-014] keeps boot and APK sanity on one session and releases it after failure', () => {
    const events: string[] = [];
    const failure = new Error('sanity failed');

    expect(() =>
      withSmokeSession(
        {
          selectedDevice: 'WZ Pixel API 35',
          runAgentDeviceCommand: (args: string[]) => {
            events.push(args.join(' '));
            return '';
          }
        },
        () => {
          events.push('sanity');
          throw failure;
        }
      )
    ).toThrow(failure);
    expect(events).toEqual([
      'boot --session wz-apk-sanity --platform android --device WZ Pixel API 35 --headless',
      'sanity',
      'close --session wz-apk-sanity --platform android'
    ]);
  });

  it('[REG-OPS-004] maps the configured AVD name to the booted device display name', () => {
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

  it('[REG-OPS-007] treats active and atomic-temp recording manifests as occupied scratch', () => {
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

  it('keeps Smoke limited to APK sanity and delegates journeys to Replay', () => {
    const smokeScript = readProjectFile('scripts', 'smoke-android.mjs');

    expect(smokeScript).toContain("['doctor', '--platform', 'android']");
    const bootIndex = smokeScript.indexOf('withSmokeSession({ selectedDevice }, () => {');
    const sanityIndex = smokeScript.indexOf('runApkSanity({ apkPath, device: smokeDevice });');
    expect(bootIndex).toBeGreaterThan(0);
    expect(sanityIndex).toBeGreaterThan(bootIndex);
    expect(smokeScript).toContain("['install', appPackage, apkPath");
    expect(smokeScript).toContain("['logs', 'clear', '--restart'");
    expect(smokeScript).toContain(
      "['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch']"
    );
    expect(smokeScript).toContain('waitFor(\'id="main-tab-feed"\', 60_000, runAgentDeviceCommand);');
    expect(smokeScript).toContain("console.log('APK_SANITY');");
    expect(smokeScript).not.toContain('device-logged-out');
    expect(smokeScript).not.toMatch(/runAgentDevice\(\[['"](?:press|click|fill|type|back|uninstall|reinstall)['"]/);
    expect(smokeScript).not.toContain("'--shutdown'");
    expect(smokeScript).not.toMatch(/['"]pm['"]\s*,\s*['"]clear['"]/);
  });

  it('[REG-OPS-005] captures the first post-install launch before it can fail', () => {
    const marker = 'wz-apk-sanity-first-launch-test';
    const events: string[] = [];
    const runAgentDeviceCommand = (args: string[]) => {
      events.push(`agent:${args.join(' ')}`);
      return args[0] === 'appstate' ? JSON.stringify({ data: { package: 'com.wz.reader' } }) : '';
    };
    const runAdbCommand = (args: string[]) => {
      events.push(`adb:${args.join(' ')}`);
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
    const installIndex = events.findIndex((event) => event.startsWith('agent:install '));
    const timestampIndex = events.findIndex((event) => event.includes('shell date +%s.%3N'));
    const markerIndex = events.findIndex((event) => event.includes('shell log -p i -t WZ_APK_SANITY'));
    const firstOpenIndex = events.findIndex((event) => event.startsWith('agent:open '));
    const dumpIndex = events.findIndex((event) => event.includes('logcat -d -v threadtime -T 1784102400.000'));
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(timestampIndex).toBeGreaterThan(installIndex);
    expect(markerIndex).toBeGreaterThan(timestampIndex);
    expect(firstOpenIndex).toBeGreaterThan(markerIndex);
    expect(events[firstOpenIndex]).not.toContain(' --device ');
    expect(dumpIndex).toBeGreaterThan(firstOpenIndex);
  });

  it('[REG-OPS-006] keeps normal and logged-out Replay journeys deterministic and isolated', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const loggedOutDeviceDir = path.join(rootDir, 'tests', 'device-logged-out');
    const expected = [
      'account-readonly.ad',
      'four-source-feed.ad',
      'library-return.ad',
      'more-readonly.ad',
      'nodeseek-session.ad',
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
    ).toBe(6);
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
    expect(loggedOutReplay).toContain(
      'wait "id=\\"account-site-xiaoyinsi\\" label=\\"小隐寺，未登录，已选择\\"" 60000'
    );
    expect(loggedOutReplay).not.toContain('测试工具');
    expect(loggedOutReplay).toContain('press id="search-source-all"');
    expect(loggedOutReplay).toContain('fill id="search-query" codex');
    expect(loggedOutReplay.match(/press id="search-submit"/g)).toHaveLength(1);
    expect(loggedOutReplay).not.toContain('back --system');
    expect(loggedOutReplay).toContain('press id="main-tab-feed"');
    expect(loggedOutReplay.match(/press id="main-tab-feed"/g)).toHaveLength(1);
    expect(loggedOutReplay).not.toContain('wait label="检测登录"');
    expect(loggedOutReplay).not.toContain('wait label="刷新页面"');

    const nodeSeekReplay = readFileSync(path.join(deviceDir, 'nodeseek-session.ad'), 'utf8');
    expect(nodeSeekReplay).toContain('wait id="nodeseek-login-webview-settled" 60000');
    expect(nodeSeekReplay).toContain('wait label="刷新页面" 10000');
    expect(nodeSeekReplay).toContain('back --system');
    expect(nodeSeekReplay).not.toContain('nodeseek-login-webview-ready');
    expect(nodeSeekReplay).not.toMatch(/role=\\"(?:webview|image)\\"|label="新帖子"/);

    const fourSourceReplay = readFileSync(path.join(deviceDir, 'four-source-feed.ad'), 'utf8').replace(/\r\n/g, '\n');
    expect(fourSourceReplay).toContain(
      'wait "id=\\"feed-outcome-data-all-default\\" || id=\\"feed-outcome-empty-all-default\\" || id=\\"feed-outcome-partial-all-default\\" || id=\\"feed-outcome-error-all-default\\" || id=\\"feed-outcome-auth-all-default\\"" 60000'
    );
    for (const source of ['all', 'v2ex', 'linuxdo', 'nodeseek', 'yaohuo', 'xiaoyinsi']) {
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
    const libraryReplay = readFileSync(path.join(deviceDir, 'library-return.ad'), 'utf8');
    expect(accountReplay).not.toMatch(/服务器代理|问题诊断|备份 \/ 恢复|外观/);
    expect(moreReplay).not.toMatch(/account-site-|查看等级|刷新等级|xiaoyinsi-level-settled/);
    expect(moreReplay).toMatch(/服务器代理[\s\S]*问题诊断[\s\S]*备份 \/ 恢复[\s\S]*外观/);
    expect(libraryReplay).toMatch(/library-favorites-ready[\s\S]*library-users-ready[\s\S]*library-history-ready/);
    expect(libraryReplay).not.toMatch(
      /library-user-first|library-history-first|topic-detail-loaded|user-screen-loaded/
    );
  });

  it('[REG-TEST-002] waits for the catalog-complete aggregate search outcome', () => {
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
      expect(replay.match(/press id="search-submit"/g)).toHaveLength(1);
    }
  });

  it('[REG-TEST-005] accepts either settled Xiaoyinsi level outcome without requiring live data success', () => {
    const accountReplay = readProjectFile('tests', 'device', 'account-readonly.ad');

    expect(accountReplay).toContain(
      [
        'press id="account-site-xiaoyinsi"',
        'wait "id=\\"account-site-xiaoyinsi\\" label=\\"小隐寺，已登录，已选择\\"" 60000',
        'wait "label=\\"查看等级, 点击读取\\"" 60000',
        'press "label=\\"查看等级, 点击读取\\""',
        'wait id="xiaoyinsi-level-settled" 60000',
        'wait label="刷新等级" 60000'
      ].join('\n')
    );
    expect(accountReplay.match(/^(?:press|click|find)\b[^\r\n]*(?:查看等级|刷新等级)[^\r\n]*$/gm) ?? []).toEqual([
      'press "label=\\"查看等级, 点击读取\\""'
    ]);
    expect(accountReplay).not.toMatch(/^(?:wait|sleep|delay)\s+\d+\s*$/m);
    expect(accountReplay).not.toContain('wait text="等级进度"');
  });

  it('[REG-TEST-006] keeps dynamic third-party success out of fixed Replay oracles', () => {
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

  it('[REG-TEST-007] starts independent journeys from their own App tab', () => {
    const targets = {
      'account-readonly.ad': 'more',
      'library-return.ad': 'library',
      'more-readonly.ad': 'more',
      'nodeseek-session.ad': 'more',
      'search-multi-source.ad': 'search'
    } as const;

    for (const [file, tab] of Object.entries(targets)) {
      const replay = readProjectFile('tests', 'device', file);
      expect(replay).toContain(`wait id="main-tab-${tab}" 60000`);
      expect(replay).not.toMatch(/feed-list-ready-|feed-outcome-/);
    }
    expect(readProjectFile('scripts', 'smoke-android.mjs')).not.toContain('feed-list-ready-');
  });

  it('[REG-OPS-009] keeps true logged-out Replay on its explicit isolated device suite', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const loggedOutDeviceDir = path.join(rootDir, 'tests', 'device-logged-out');
    const releaseReplayNames = listReplayFiles(deviceDir).map((file) => path.basename(file));

    expect(releaseReplayNames).toEqual([
      'account-readonly.ad',
      'four-source-feed.ad',
      'library-return.ad',
      'more-readonly.ad',
      'nodeseek-session.ad',
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
    const appControls = readProjectFile('src', 'ui', 'controls', 'AppControls.tsx');
    expect(appControls).toContain('testID={testIDPrefix ? `${testIDPrefix}-${item.value}` : undefined}');
    expect(appControls).toContain("accessibilityLabel={`${item.label}${value === item.value ? '，已选择' : ''}`}");
    const feedScreen = readProjectFile('src', 'features', 'feed', 'FeedScreen.tsx');
    expect(feedScreen).toContain("testID={index === 0 ? 'feed-topic-first' : undefined}");
    expect(feedScreen).toContain("`feed-outcome-${feedOutcomeKind}-${feedSource}-${feedFilter ?? 'default'}`");
    expect(feedScreen).not.toContain('feed-list-ready-');
    expect(feedScreen).toContain('testIDPrefix="feed-source"');
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
    expect(readProjectFile('src', 'features', 'topic', 'TopicScreen.tsx')).toContain(
      "testID={topic ? 'topic-detail-loaded' : undefined}"
    );
    expect(readProjectFile('src', 'features', 'topic', 'TopicScreen.tsx')).toContain('testID="topic-author"');
    const userScreen = readProjectFile('src', 'features', 'user', 'UserScreen.tsx');
    expect(userScreen).toContain("testID={profile && !busy ? 'user-screen-loaded' : undefined}");
    expect(userScreen).toContain("testID={index === 0 ? 'user-topic-first' : undefined}");
    const libraryScreen = readProjectFile('src', 'features', 'library', 'LibraryScreen.tsx');
    expect(libraryScreen).toContain("'library-favorites-ready'");
    expect(libraryScreen).toContain("'library-users-ready'");
    expect(libraryScreen).toContain("'library-history-ready'");
    expect(libraryScreen).toContain("'library-user-first'");
    expect(libraryScreen).toContain("'library-history-first'");
    const accountCenter = readProjectFile('src', 'features', 'more', 'components', 'AccountCenterPanel.tsx');
    expect(accountCenter).toContain('testID={`account-site-${view.site}`}');
    const morePanels = readProjectFile('src', 'features', 'more', 'components', 'MorePanels.tsx');
    expect(morePanels).toContain('webViewSettledForReplay');
    expect(morePanels).toContain("'nodeseek-login-webview-settled'");
    expect(morePanels).not.toContain("'nodeseek-login-webview-ready'");
    expect(morePanels).not.toContain('NODESEEK_REPLAY_READINESS_SCRIPT');
    expect(morePanels).not.toContain('NODESEEK_REPLAY_READY_MESSAGE');
  });

  it('keeps diagnostic logging initialized and wired into the More screen', () => {
    const entry = readProjectFile('index.ts');
    const appRoot = readProjectFile('src', 'app', 'AppRoot.tsx');
    const moreScreen = readProjectFile('src', 'features', 'more', 'MoreScreen.tsx');

    expect(entry).toContain(
      "import { initializeDiagnosticFileLogging } from '@/platform/diagnostics/diagnosticFileStore';"
    );
    expect(entry.indexOf('initializeDiagnosticFileLogging();')).toBeLessThan(
      entry.indexOf('registerRootComponent(App);')
    );
    expect(appRoot).toMatch(
      /useDiagnosticLogController\(\{\s*getCurrentScreen,\s*metadata: diagnosticMetadata,\s*notify\s*\}\)/
    );
    expect(appRoot).toContain('onExportDiagnosticLog: exportDiagnosticLogFile');
    expect(moreScreen).toContain('title="问题诊断"');
    expect(moreScreen).toContain('onPress={onExportDiagnosticLog}');
  });

  it('runs Smoke only after APK signer verification and before writing the release manifest', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const signerIndex = releaseScript.indexOf('verifyExpectedReleaseSigner(signerSha256);');
    const smokeIndex = releaseScript.indexOf("run('npm', ['run', 'smoke:android', '--', smokeApkPath]);");
    const manifestIndex = releaseScript.lastIndexOf('writeReleaseManifest({');

    expect(packageJson.scripts['smoke:android']).toBe('node scripts/smoke-android.mjs');
    expect(smokeIndex).toBeGreaterThan(signerIndex);
    expect(manifestIndex).toBeGreaterThan(smokeIndex);
  });

  it('keeps the published arm64 APK separate from a development-signed emulator Smoke APK', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const releaseHelpers = readProjectFile('scripts', 'release-environment.mjs');
    const releaseGradle = readProjectFile('scripts', 'android-release-apk.gradle');
    const loadEnvIndex = releaseScript.indexOf('const configuredReleaseEnv = loadReleaseEnvFile();');
    const smokeAbiIndex = releaseScript.indexOf(
      'const smokeApkAbi = requestedSmokeApkAbi(releaseEnv.WZ_ANDROID_SMOKE_ABI);'
    );

    expect(releaseScript).not.toContain('process.env.WZ_ANDROID_SMOKE_ABI');
    expect(smokeAbiIndex).toBeGreaterThan(loadEnvIndex);
    expect(releaseScript).toContain("['arm64-v8a', smokeApkAbi]");
    expect(releaseHelpers).toContain("`-PreactNativeArchitectures=${builtAbis.join(',')}`");
    expect(releaseHelpers).toContain("`-PreleaseApkAbis=${builtAbis.join(',')}`");
    expect(releaseScript).toContain('app-${smokeApkAbi}-smoke-dev.apk');
    expect(releaseScript).toContain("path.join(androidDir, 'app', 'debug.keystore')");
    expect(releaseScript).toContain("'sign',");
    expect(releaseScript).toContain('smokeSignerSha256 === expectedReleaseSignerSha256');
    expect(releaseScript).not.toContain('verifyExpectedReleaseSigner(smokeSignerSha256);');
    expect(releaseScript).toContain("run('npm', ['run', 'smoke:android', '--', smokeApkPath]);");
    expect(releaseGradle).toContain('project.findProperty("releaseApkAbis") ?: "arm64-v8a"');
    expect(releaseGradle).toContain('include(*requestedReleaseAbis)');
  });
});
