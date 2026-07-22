import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { capturedAgentDeviceOutput, deviceSelectionArgs, isVersionSupported, MIN_AGENT_DEVICE_VERSION } from '../scripts/agent-device-runtime.mjs';
import { runApkSanity } from '../scripts/smoke-android.mjs';
import {
  listReplayFiles,
  matchingAndroidDevices,
  parseAgentDeviceList,
  parseAndroidRecordingScratchPaths,
  parseAndroidPackageInfo,
  replayRecordingRecoverySession,
  ReplayCleanupError,
  replayDeviceSelectionArgs,
  runReplayBatch
} from '../scripts/run-device-replay.mjs';

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release evidence guards', () => {
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

  it('[REG-OPS-004] maps the configured AVD name to the booted device display name', () => {
    const devices = parseAgentDeviceList(JSON.stringify({
      success: true,
      data: {
        devices: [
          { id: 'emulator-5554', name: 'WZ Pixel API 35', platform: 'android', booted: true }
        ]
      }
    }));
    expect(devices).toEqual([
      { id: 'emulator-5554', name: 'WZ Pixel API 35', platform: 'android', booted: true }
    ]);
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
    expect(parseAndroidRecordingScratchPaths([
      'agent-device-recording-1784023321348.mp4',
      'agent-device-recording-active.json',
      'agent-device-recording-active.json.tmp',
      'screenrecord-user.mp4',
      'agent-device-recording-not-a-timestamp.mp4'
    ].join('\n'), '/sdcard')).toEqual([
      '/sdcard/agent-device-recording-1784023321348.mp4',
      '/sdcard/agent-device-recording-active.json',
      '/sdcard/agent-device-recording-active.json.tmp'
    ]);
  });

  it('keeps Smoke limited to APK sanity and delegates journeys to Replay', () => {
    const smokeScript = readProjectFile('scripts', 'smoke-android.mjs');

    expect(smokeScript).toContain("['doctor', '--platform', 'android']");
    const bootIndex = smokeScript.indexOf('bootSelectedDevice();');
    const sanityIndex = smokeScript.indexOf('runApkSanity({ apkPath, device });');
    expect(bootIndex).toBeGreaterThan(0);
    expect(sanityIndex).toBeGreaterThan(bootIndex);
    expect(smokeScript).toContain("['install', appPackage, apkPath");
    expect(smokeScript).toContain("['logs', 'clear', '--restart'");
    expect(smokeScript).toContain("['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch']");
    expect(smokeScript).toContain("waitFor('id=\"feed-list-ready-all\"', 60_000, runAgentDeviceCommand);");
    expect(smokeScript).toContain("console.log('APK_SANITY');");
    expect(smokeScript).toContain("excludedReplayFileNames: ['anonymous-readonly.ad']");
    expect(smokeScript).not.toMatch(/runAgentDevice\(\[['"](?:press|click|fill|type|back|uninstall|reinstall)['"]/);
    expect(smokeScript).not.toContain("'--shutdown'");
    expect(smokeScript).not.toMatch(/['"]pm['"]\s*,\s*['"]clear['"]/);
  });

  it('[REG-OPS-005] captures the first post-install launch before it can fail', () => {
    const marker = 'wz-apk-sanity-first-launch-test';
    const events: string[] = [];
    const runAgentDeviceCommand = (args: string[]) => {
      events.push(`agent:${args.join(' ')}`);
      return args[0] === 'appstate'
        ? JSON.stringify({ data: { package: 'com.wz.reader' } })
        : '';
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
    expect(dumpIndex).toBeGreaterThan(firstOpenIndex);
  });

  it('[REG-OPS-006] keeps the eight tracked Replay journeys deterministic and lets the test harness stop video', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const expected = [
      'anonymous-readonly.ad',
      'feed-topic-return.ad',
      'four-source-feed.ad',
      'library-return.ad',
      'more-readonly.ad',
      'nodeseek-session.ad',
      'search-multi-source.ad',
      'search-topic-user-return.ad'
    ];
    expect(readdirSync(deviceDir).sort()).toEqual(expected);
    expect(listReplayFiles(deviceDir).map((file) => path.basename(file))).toEqual(expected);

    for (const file of expected) {
      const replay = readFileSync(path.join(deviceDir, file), 'utf8');
      expect(replay).toContain('context platform=android');
      expect(replay).toContain('context retries=0');
      expect(replay).toContain('open ${APP_ID} --relaunch');
      expect(replay).not.toMatch(/^close\s*$/m);
      expect(replay).not.toMatch(/@[a-z]\d+/i);
      expect(replay).not.toMatch(/\b(?:press|click|swipe|longpress)\s+\d+\s+\d+/);
      expect(replay).not.toMatch(/(?:清除登录|退出登录|清空历史|取消收藏|取消关注|删除回复|提交回复|保存 Key|签到)/);
      expect(replay).not.toMatch(/^\s*(?:uninstall|reinstall|settings reset|shutdown)\b/m);
    }
    const anonymousReadonlyReplay = readFileSync(path.join(deviceDir, 'anonymous-readonly.ad'), 'utf8');
    expect(anonymousReadonlyReplay.match(/open \$\{APP_ID\} --relaunch/g)).toHaveLength(2);
    expect(anonymousReadonlyReplay.match(/wait "id=\\"account-site-nodeseek\\" label=\\"NodeSeek，已登录，已选择\\"" 60000/g)).toHaveLength(2);
    expect(anonymousReadonlyReplay).toContain('press label="展开测试工具"');
    expect(anonymousReadonlyReplay).toContain('wait "text=\\"只影响本次运行，不删除 Cookie。重启后恢复。\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press label="NodeSeek"');
    expect(anonymousReadonlyReplay).toContain('wait "text=\\"已开启 1 项\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press label="linux.do"');
    expect(anonymousReadonlyReplay).toContain('wait "text=\\"已开启 2 项\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press label="小隐寺"');
    expect(anonymousReadonlyReplay).toContain('wait "text=\\"已开启 3 项\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press label="妖火"');
    expect(anonymousReadonlyReplay).toContain('wait "text=\\"已开启 4 项\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press id="search-source-nodeseek"');
    expect(anonymousReadonlyReplay).toContain('wait "id=\\"search-source-nodeseek\\" label=\\"NodeSeek，已选择\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press id="search-source-linuxdo"');
    expect(anonymousReadonlyReplay).toContain('wait "id=\\"search-source-linuxdo\\" label=\\"linux.do，已选择\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press id="search-source-xiaoyinsi"');
    expect(anonymousReadonlyReplay).toContain('wait "id=\\"search-source-xiaoyinsi\\" label=\\"小隐寺，已选择\\"" 10000');
    expect(anonymousReadonlyReplay).toContain('press id="search-source-yaohuo"');
    expect(anonymousReadonlyReplay).toContain('fill id="search-query" codex');
    expect(anonymousReadonlyReplay).toContain('press id="search-submit"');
    expect(anonymousReadonlyReplay).toContain('wait label="检测登录" 60000');
    expect(anonymousReadonlyReplay).toContain('wait label="刷新页面" 10000');
    expect(anonymousReadonlyReplay.match(/is visible id="search-result-first"/g)).toHaveLength(3);
    expect(anonymousReadonlyReplay).toContain('press id="main-tab-feed"');
    expect(anonymousReadonlyReplay).toContain('wait id="feed-list-ready-all" 60000');
    expect(anonymousReadonlyReplay).toContain('press id="feed-source-nodeseek"');
    expect(anonymousReadonlyReplay).toContain('wait id="feed-list-ready-nodeseek" 60000');
    expect(anonymousReadonlyReplay).toContain('press id="feed-source-linuxdo"');
    expect(anonymousReadonlyReplay).toContain('wait id="feed-list-ready-linuxdo" 60000');
    expect(anonymousReadonlyReplay).toContain('press id="feed-source-xiaoyinsi"');
    expect(anonymousReadonlyReplay).toContain('wait id="feed-list-ready-xiaoyinsi" 60000');
    expect(anonymousReadonlyReplay).toContain('press id="feed-source-yaohuo"');
    expect(anonymousReadonlyReplay.match(/wait id="feed-topic-first" 10000/g)).toHaveLength(4);
    expect(anonymousReadonlyReplay.match(/wait label="检测登录" 60000/g)).toHaveLength(2);

    const nodeSeekReplay = readFileSync(path.join(deviceDir, 'nodeseek-session.ad'), 'utf8');
    expect(nodeSeekReplay).toContain('wait "role=\\"webview\\" label=\\"NodeSeek\\"" 15000');
    expect(nodeSeekReplay).toContain('wait "role=\\"image\\" label=\\"logo\\"" 15000');
    expect(nodeSeekReplay).toContain('wait label="新帖子" 15000');
    expect(nodeSeekReplay).not.toContain('is visible "role=\\"webview\\" label=\\"NodeSeek\\""');
    expect(nodeSeekReplay).not.toContain('is visible "role=\\"image\\" label=\\"logo\\""');
    expect(nodeSeekReplay).not.toContain('is visible label="新帖子"');
    expect(nodeSeekReplay).toContain('back --system');
    expect(nodeSeekReplay).not.toContain('nodeseek-login-webview-ready');
    expect(nodeSeekReplay).not.toMatch(/^wait 15000$/m);

    const fourSourceReplay = readFileSync(path.join(deviceDir, 'four-source-feed.ad'), 'utf8').replace(/\r\n/g, '\n');
    expect(fourSourceReplay).toContain([
      'wait id="feed-list-ready-nodeseek" 60000',
      'wait id="feed-topic-first" 10000',
      'scroll down',
      'scroll down',
      'wait label="回到顶部" 10000',
      'press label="列表筛选"',
      'press text="新评论"',
      'wait id="feed-list-ready-nodeseek" 60000',
      'wait id="feed-topic-first" 10000'
    ].join('\n'));

    const multiSourceSearchReplay = readFileSync(path.join(deviceDir, 'search-multi-source.ad'), 'utf8');
    expect(multiSourceSearchReplay).toContain('press id="search-overview-source-v2ex"');
    expect(multiSourceSearchReplay).not.toContain('search-page-loaded-');
    expect(multiSourceSearchReplay).toContain('press label="清空搜索关键词"');
    expect(multiSourceSearchReplay).toContain('wait "label=\\"搜索最近记录 AI\\"" 10000');
    expect(multiSourceSearchReplay).toContain('press "label=\\"搜索最近记录 AI\\""');
    expect(multiSourceSearchReplay.match(/is visible id="search-result-first"/g)).toHaveLength(5);
    expect(multiSourceSearchReplay.match(/press id="search-result-first"/g)).toHaveLength(4);
    expect(multiSourceSearchReplay.match(/wait id="topic-detail-loaded" 60000/g)).toHaveLength(4);
    expect(multiSourceSearchReplay.match(/back --system/g)).toHaveLength(4);
  });

  it('[REG-TEST-002] waits for search results instead of a stale completion marker', () => {
    const anonymousReadonlyReplay = readFileSync(path.join(rootDir, 'tests', 'device', 'anonymous-readonly.ad'), 'utf8');
    const multiSourceSearchReplay = readFileSync(path.join(rootDir, 'tests', 'device', 'search-multi-source.ad'), 'utf8');
    const topicReturnReplay = readFileSync(path.join(rootDir, 'tests', 'device', 'search-topic-user-return.ad'), 'utf8');

    expect(anonymousReadonlyReplay.match(/wait id="search-result-first" 60000/g) ?? []).toHaveLength(3);
    expect(anonymousReadonlyReplay).not.toContain('wait id="search-complete" 60000');
    expect(anonymousReadonlyReplay).toContain('wait text="未登录搜索，结果可能不完整。" 10000');
    expect(anonymousReadonlyReplay).toContain('wait "text=\\"未登录搜索使用 Google，结果可能不完整。\\"" 10000');
    expect(multiSourceSearchReplay).toContain('wait "id=\\"search-overview-source-v2ex\\" enabled=true" 60000');
    expect(multiSourceSearchReplay.match(/wait id="search-result-first" 60000/g) ?? []).toHaveLength(5);
    expect(topicReturnReplay.match(/wait id="search-result-first" 60000/g) ?? []).toHaveLength(1);
  });

  it('[REG-OPS-009] keeps the development-only anonymous Replay out of release APK smoke', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const releaseReplayNames = listReplayFiles(deviceDir, ['anonymous-readonly.ad'])
      .map((file) => path.basename(file));

    expect(releaseReplayNames).toEqual([
      'feed-topic-return.ad',
      'four-source-feed.ad',
      'library-return.ad',
      'more-readonly.ad',
      'nodeseek-session.ad',
      'search-multi-source.ad',
      'search-topic-user-return.ad'
    ]);
    expect(readProjectFile('scripts', 'smoke-android.mjs')).toContain(
      "excludedReplayFileNames: ['anonymous-readonly.ad']"
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
    expect(replayScript).toContain("'test', replayFile");
    expect(replayScript).toContain("'--retries', '0'");
    expect(replayScript).toContain("'--reporter', `junit:${junitPath}`");
    expect(replayScript).toContain("'--session', replaySession");
    expect(replayScript).toContain('assertNoExistingAgentDeviceRecording(device.id)');
    expect(replayScript).toContain('androidRecordingScratchPaths(device.id)');
    expect(replayScript).toContain('recoverOwnedReplayRecording(device, replaySession)');
    expect(replayScript).toContain("'record', 'stop'");
    expect(replayScript).not.toContain('closeDefaultReplaySession');
    expect(replayScript).not.toContain("'shell', 'kill'");
    expect(replayScript).not.toContain('rm -f /sdcard/agent-device-recording-');
    expect(replayScript).not.toContain('stopNewLocalAgentDeviceDaemons');
    expect(replayScript).toContain("console.log('DEVICE_REPLAY_PASS');");
  });

  it('keeps stable selectors on the read-only navigation paths', () => {
    expect(readProjectFile('src', 'app', 'AppNavigator.tsx')).toContain('tabBarButtonTestID: `main-tab-${item.value}`');
    const appControls = readProjectFile('src', 'components', 'AppControls.tsx');
    expect(appControls).toContain('testID={testIDPrefix ? `${testIDPrefix}-${item.value}` : undefined}');
    expect(appControls).toContain("accessibilityLabel={`${item.label}${value === item.value ? '，已选择' : ''}`}");
    const feedScreen = readProjectFile('src', 'screens', 'FeedScreen.tsx');
    expect(feedScreen).toContain("testID={index === 0 ? 'feed-topic-first' : undefined}");
    expect(feedScreen).toContain("testID={!busy ? `feed-list-ready-${feedSource}` : undefined}");
    expect(feedScreen).toContain('testIDPrefix="feed-source"');
    const searchScreen = readProjectFile('src', 'screens', 'SearchScreen.tsx');
    expect(searchScreen).toContain('testID="search-query"');
    expect(searchScreen).toContain('testID="search-submit"');
    expect(searchScreen).toContain('testIDPrefix="search-source"');
    expect(searchScreen).toContain('search-overview-source-');
    expect(searchScreen).toContain('search-page-loaded-');
    expect(searchScreen).toContain('搜索最近记录');
    expect(searchScreen).toContain("'search-result-first'");
    expect(searchScreen).toContain("'search-complete'");
    expect(readProjectFile('src', 'screens', 'topic', 'TopicScreenBody.tsx')).toContain("testID={topic ? 'topic-detail-loaded' : undefined}");
    expect(readProjectFile('src', 'screens', 'topic', 'TopicScreenBody.tsx')).toContain('testID="topic-author"');
    const userScreen = readProjectFile('src', 'screens', 'UserScreen.tsx');
    expect(userScreen).toContain("testID={profile && !busy ? 'user-screen-loaded' : undefined}");
    expect(userScreen).toContain("testID={index === 0 ? 'user-topic-first' : undefined}");
    const libraryScreen = readProjectFile('src', 'screens', 'LibraryScreen.tsx');
    expect(libraryScreen).toContain("'library-favorites-ready'");
    expect(libraryScreen).toContain("'library-users-ready'");
    expect(libraryScreen).toContain("'library-history-ready'");
    expect(libraryScreen).toContain("'library-user-first'");
    expect(libraryScreen).toContain("'library-history-first'");
    const accountCenter = readProjectFile('src', 'screens', 'more', 'AccountCenterPanel.tsx');
    expect(accountCenter).toContain('testID={`account-site-${view.site}`}');
    const morePanels = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
    expect(morePanels).toContain('NODESEEK_REPLAY_READINESS_SCRIPT');
    expect(morePanels).toContain('event.nativeEvent.data === NODESEEK_REPLAY_READY_MESSAGE');
    expect(morePanels.match(/setWebViewReadyForReplay\(true\)/g)).toHaveLength(1);
    expect(morePanels.slice(
      morePanels.indexOf('onLoadEnd={(event) =>'),
      morePanels.indexOf('onLoadProgress={(event) =>')
    )).not.toContain('setWebViewReadyForReplay(true)');
    const loginWebViewScripts = readProjectFile('src', 'loginWebViewScripts.ts');
    expect(loginWebViewScripts).toContain('host === "nodeseek.com" || host.endsWith(".nodeseek.com")');
    expect(loginWebViewScripts).toContain('document.readyState !== "loading" && bodyText.length > 0');
  });

  it('keeps diagnostic logging initialized and wired into the More screen', () => {
    const entry = readProjectFile('index.ts');
    const appRoot = readProjectFile('src', 'app', 'AppRoot.tsx');
    const moreScreen = readProjectFile('src', 'screens', 'MoreScreen.tsx');

    expect(entry).toContain("import { initializeDiagnosticFileLogging } from './src/diagnosticFileStore';");
    expect(entry.indexOf('initializeDiagnosticFileLogging();')).toBeLessThan(entry.indexOf('registerRootComponent(App);'));
    expect(appRoot).toContain('useDiagnosticLogController({ getCurrentScreen, metadata: diagnosticMetadata, notify })');
    expect(appRoot).toContain('onExportDiagnosticLog: exportDiagnosticLogFile');
    expect(moreScreen).toContain('title="问题诊断"');
    expect(moreScreen).toContain('onPress={onExportDiagnosticLog}');
  });

  it('runs Smoke only after APK signer verification and before writing the release manifest', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const signerIndex = releaseScript.indexOf('verifyExpectedReleaseSigner(signerSha256);');
    const smokeIndex = releaseScript.indexOf("run('npm', ['run', 'smoke:android', '--', smokeApkPath]);");
    const manifestIndex = releaseScript.indexOf('writeReleaseManifest({ sha256, signerSha256 });');

    expect(packageJson.scripts['smoke:android']).toBe('node scripts/smoke-android.mjs');
    expect(smokeIndex).toBeGreaterThan(signerIndex);
    expect(manifestIndex).toBeGreaterThan(smokeIndex);
  });

  it('keeps the published arm64 APK separate from a development-signed emulator Smoke APK', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const releaseGradle = readProjectFile('scripts', 'android-release-apk.gradle');
    const loadEnvIndex = releaseScript.indexOf('loadReleaseEnvFile();');
    const smokeAbiIndex = releaseScript.indexOf('const smokeApkAbi = requestedSmokeApkAbi(process.env.WZ_ANDROID_SMOKE_ABI);');

    expect(releaseScript).toContain('process.env.WZ_ANDROID_SMOKE_ABI');
    expect(smokeAbiIndex).toBeGreaterThan(loadEnvIndex);
    expect(releaseScript).toContain("['arm64-v8a', smokeApkAbi]");
    expect(releaseScript).toContain("`-PreactNativeArchitectures=${releaseApkAbis.join(',')}`");
    expect(releaseScript).toContain("`-PreleaseApkAbis=${releaseApkAbis.join(',')}`");
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
