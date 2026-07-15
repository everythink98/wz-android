import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { deviceSelectionArgs, isVersionSupported, MIN_AGENT_DEVICE_VERSION } from '../scripts/agent-device-runtime.mjs';
import {
  androidRecordingScratchCleanupArgs,
  listReplayFiles,
  matchingAndroidDevices,
  parseAgentDeviceList,
  parseAndroidAgentDeviceRecorders,
  parseAndroidPackageInfo,
  ReplayCleanupError,
  replayDeviceSelectionArgs,
  runReplayBatch
} from '../scripts/run-device-replay.mjs';

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release evidence guards', () => {
  it('requires a supported installed agent-device version', () => {
    expect(MIN_AGENT_DEVICE_VERSION).toBe('0.14.0');
    expect(isVersionSupported('0.13.9')).toBe(false);
    expect(isVersionSupported('0.14.0-beta.1')).toBe(false);
    expect(isVersionSupported('0.14.0')).toBe(true);
    expect(isVersionSupported('0.19.0')).toBe(true);
  });

  it('requires one explicitly selected device', () => {
    expect(() => deviceSelectionArgs('')).toThrow('WZ_ANDROID_TEST_DEVICE');
    expect(deviceSelectionArgs('  WZ Pixel API 35  ')).toEqual(['--device', 'WZ Pixel API 35']);
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

  it('limits device-side recording cleanup to agent-device scratch files', () => {
    expect(androidRecordingScratchCleanupArgs('emulator-5554')).toEqual([
      '-s',
      'emulator-5554',
      'shell',
      'rm -f /sdcard/agent-device-recording-*.mp4 /sdcard/agent-device-recording-active.json /sdcard/agent-device-recording-active.json.tmp /data/local/tmp/agent-device-recording-*.mp4 /data/local/tmp/agent-device-recording-active.json /data/local/tmp/agent-device-recording-active.json.tmp'
    ]);
    expect(parseAndroidAgentDeviceRecorders([
      ' 2321 screenrecord --bit-rate 8000000 /sdcard/agent-device-recording-1784023321348.mp4',
      ' 2322 screenrecord /sdcard/user-recording.mp4',
      ' 2323 screenrecord /data/local/tmp/agent-device-recording-1784023323941.mp4',
      ' 2324 unrelated /sdcard/agent-device-recording-1784023332676.mp4'
    ].join('\n'))).toEqual([
      { pid: '2321', remotePath: '/sdcard/agent-device-recording-1784023321348.mp4' },
      { pid: '2323', remotePath: '/data/local/tmp/agent-device-recording-1784023323941.mp4' }
    ]);
  });

  it('keeps Smoke limited to APK sanity and delegates journeys to Replay', () => {
    const smokeScript = readProjectFile('scripts', 'smoke-android.mjs');

    expect(smokeScript).toContain("['doctor', '--platform', 'android']");
    const bootIndex = smokeScript.indexOf('bootSelectedDevice();');
    const installIndex = smokeScript.indexOf("['install', appPackage, apkPath");
    expect(bootIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(bootIndex);
    expect(smokeScript).toContain("['logs', 'clear', '--restart'");
    expect(smokeScript).toContain("['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch']");
    expect(smokeScript).toContain("waitFor('id=\"feed-list-ready-all\"', 60_000);");
    expect(smokeScript).toContain("console.log('APK_SANITY');");
    expect(smokeScript).toContain('await runDeviceReplay({ apkPath, selectedDevice });');
    expect(smokeScript).not.toMatch(/runAgentDevice\(\[['"](?:press|click|fill|type|back|uninstall|reinstall)['"]/);
    expect(smokeScript).not.toContain("'--shutdown'");
    expect(smokeScript).not.toMatch(/['"]pm['"]\s*,\s*['"]clear['"]/);
  });

  it('keeps the seven tracked Replay journeys deterministic and read-only', () => {
    const deviceDir = path.join(rootDir, 'tests', 'device');
    const expected = [
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
      expect(replay.trimEnd()).toMatch(/close$/);
      expect(replay).not.toMatch(/@[a-z]\d+/i);
      expect(replay).not.toMatch(/\b(?:press|click|swipe|longpress)\s+\d+\s+\d+/);
      expect(replay).not.toMatch(/(?:清除登录|退出登录|清空历史|取消收藏|取消关注|删除回复|提交回复|保存 Key|签到)/);
      expect(replay).not.toMatch(/^\s*(?:uninstall|reinstall|settings reset|shutdown)\b/m);
    }
    const nodeSeekReplay = readFileSync(path.join(deviceDir, 'nodeseek-session.ad'), 'utf8');
    expect(nodeSeekReplay).toContain('wait 15000');
    expect(nodeSeekReplay).toContain('is visible id="nodeseek-login-webview-ready"');
    expect(nodeSeekReplay).toContain('back --system');
    expect(nodeSeekReplay).not.toContain('wait id="nodeseek-login-webview-ready"');
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
    expect(replayScript).toContain('closeDefaultReplaySession');
    expect(replayScript).toContain("['close', '--platform', 'android']");
    expect(replayScript).toContain('cleanupAgentDeviceRecordingScratch(device.id)');
    expect(replayScript).toContain('localDaemonPidsBefore');
    expect(replayScript).toContain('stopNewLocalAgentDeviceDaemons(localDaemonPidsBefore)');
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
    expect(morePanels).toContain("testID={webViewReadyForReplay ? 'nodeseek-login-webview-ready' : undefined}");
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
