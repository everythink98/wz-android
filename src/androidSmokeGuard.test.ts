import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { deviceSelectionArgs, isVersionSupported, libraryOutcomeFromCompletionAttrs, MIN_AGENT_DEVICE_VERSION, READ_ONLY_PRESS_TARGETS, searchOutcomeFromCompletionAttrs, searchQueryIsPreserved } from '../scripts/smoke-android.mjs';

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release smoke guards', () => {
  it('requires a supported installed agent-device version', () => {
    expect(MIN_AGENT_DEVICE_VERSION).toBe('0.14.0');
    expect(isVersionSupported('0.13.9')).toBe(false);
    expect(isVersionSupported('0.14.0-beta.1')).toBe(false);
    expect(isVersionSupported('0.14.0')).toBe(true);
    expect(isVersionSupported('0.19.0')).toBe(true);
  });

  it('requires one explicitly selected smoke device', () => {
    expect(() => deviceSelectionArgs('')).toThrow('WZ_ANDROID_SMOKE_DEVICE');
    expect(deviceSelectionArgs('  WZ_Pixel_API_35  ')).toEqual(['--device', 'WZ_Pixel_API_35']);
  });

  it('allows only read-only navigation targets and no destructive device commands', () => {
    const smokeScript = readProjectFile('scripts', 'smoke-android.mjs');

    expect(READ_ONLY_PRESS_TARGETS).toEqual([
      'id="main-tab-search"',
      'id="main-tab-library"',
      'id="main-tab-more"',
      'label="展开问题诊断"',
      'id="main-tab-feed"',
      'id="search-submit"',
      'id="search-result-first"',
      'id="library-favorite-first"',
      'id="feed-topic-first"',
      'id="topic-author"',
      'id="user-topic-first"',
      'label="返回"'
    ]);
    expect(smokeScript).toContain("['doctor', '--platform', 'android']");
    const bootIndex = smokeScript.indexOf('bootSelectedDevice();');
    const installIndex = smokeScript.indexOf("['install', appPackage, apkPath");
    expect(bootIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(bootIndex);
    expect(smokeScript).toContain("['boot', '--platform', 'android', '--device', selectedDevice, '--headless']");
    expect(smokeScript).toContain("['install', appPackage, apkPath, '--platform', 'android', ...deviceSelectionArgs()]");
    const bootstrapOpenIndex = smokeScript.indexOf("['open', appPackage, '--session', smokeSession, '--platform', 'android', ...deviceSelectionArgs()]");
    const clearLogsIndex = smokeScript.indexOf("['logs', 'clear', '--restart'");
    const coldStartIndex = smokeScript.indexOf("['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch']");
    expect(bootstrapOpenIndex).toBeGreaterThan(bootIndex);
    expect(clearLogsIndex).toBeGreaterThan(bootstrapOpenIndex);
    expect(installIndex).toBeGreaterThan(clearLogsIndex);
    expect(coldStartIndex).toBeGreaterThan(installIndex);
    expect(smokeScript).not.toContain("...deviceSelectionArgs(), '--relaunch'");
    const coldStartGraceIndex = smokeScript.indexOf("['wait', '60000', '--session', smokeSession, '--platform', 'android']");
    const coldStartReadyIndex = smokeScript.indexOf("waitFor('id=\"feed-topic-first\"', 60_000);");
    expect(coldStartGraceIndex).toBeGreaterThan(coldStartIndex);
    expect(coldStartReadyIndex).toBeGreaterThan(coldStartGraceIndex);
    expect(smokeScript).not.toContain("['wait', 'stable'");
    expect(smokeScript).not.toContain("'--settle'");
    expect(smokeScript).toContain("'--timeout', '60000'");
    expect(smokeScript).toContain("['logs', 'stop'");
    expect(smokeScript).toContain("['close', '--session', smokeSession");
    expect(smokeScript).toContain("['fill', 'id=\"search-query\"', 'vps'");
    expect(smokeScript).toContain("['keyboard', 'dismiss'");
    expect(smokeScript).toContain("['is', 'visible', 'id=\"search-result-first\"'");
    expect(smokeScript).toContain("['back', '--system'");
    const moreIndex = smokeScript.indexOf("pressReadOnly('id=\"main-tab-more\"');");
    const diagnosticIndex = smokeScript.indexOf("pressReadOnly('label=\"展开问题诊断\"');");
    const diagnosticButtonIndex = smokeScript.indexOf("waitFor('label=\"生成并分享诊断日志\"');");
    const feedIndex = smokeScript.indexOf("pressReadOnly('id=\"main-tab-feed\"');", moreIndex);
    expect(diagnosticIndex).toBeGreaterThan(moreIndex);
    expect(diagnosticButtonIndex).toBeGreaterThan(diagnosticIndex);
    expect(feedIndex).toBeGreaterThan(diagnosticButtonIndex);
    expect(smokeScript).not.toContain("pressReadOnly('label=\"生成并分享诊断日志\"');");
    expect(smokeScript).not.toContain("['scroll', 'down'");
    expect(smokeScript).not.toMatch(/runAgentDevice\(\[['"](?:uninstall|reinstall)['"]/);
    expect(smokeScript).not.toContain("'--shutdown'");
    expect(smokeScript).not.toMatch(/['"]pm['"]\s*,\s*['"]clear['"]/);
  });

  it('accepts only an explicitly classified completed search outcome', () => {
    expect(searchOutcomeFromCompletionAttrs('{"label":"搜索结果，已完成，有可打开结果"}')).toBe('result');
    expect(searchOutcomeFromCompletionAttrs('{"label":"搜索结果，已完成，结构化回退"}')).toBe('fallback');
    expect(searchOutcomeFromCompletionAttrs('{"label":"搜索结果，已完成，缺少结构化结果"}')).toBeNull();
    expect(searchOutcomeFromCompletionAttrs('{"label":"搜索结果，已完成"}')).toBeNull();
  });

  it('checks that search state survives opening and returning from a topic', () => {
    expect(searchQueryIsPreserved('{"label":"codex","value":"codex"}', 'codex')).toBe(true);
    expect(searchQueryIsPreserved('{"label":"other","value":"other"}', 'codex')).toBe(false);
    expect(searchQueryIsPreserved('snapshot unchanged since previous read', 'codex')).toBe(false);
  });

  it('classifies a loaded library result and explicit empty state', () => {
    expect(libraryOutcomeFromCompletionAttrs('{"label":"收藏列表，已加载，有收藏"}')).toBe('result');
    expect(libraryOutcomeFromCompletionAttrs('{"label":"收藏列表，已加载，没有收藏"}')).toBe('empty');
    expect(libraryOutcomeFromCompletionAttrs('{"label":"收藏列表，正在加载"}')).toBeNull();
    expect(libraryOutcomeFromCompletionAttrs('snapshot unchanged since previous read')).toBeNull();
  });

  it('fails instead of skipping required read-only navigation journeys', () => {
    const smokeScript = readProjectFile('scripts', 'smoke-android.mjs');

    expect(smokeScript).toContain('搜索只返回 error/auth/empty，未完成搜索→详情只读验收。');
    expect(smokeScript).toContain('本机没有可用于只读 smoke 的收藏，无法验证收藏→详情→用户→返回。');
    expect(smokeScript).toContain("waitFor('id=\"user-topic-first\"', 60_000);");
    expect(smokeScript).not.toContain('跳过 User→Topic');
    expect(smokeScript).not.toContain('跳过收藏→详情');
  });

  it('keeps stable selectors on the read-only navigation path', () => {
    expect(readProjectFile('src', 'app', 'AppNavigator.tsx')).toContain('tabBarButtonTestID: `main-tab-${item.value}`');
    expect(readProjectFile('src', 'screens', 'FeedScreen.tsx')).toContain("testID={index === 0 ? 'feed-topic-first' : undefined}");
    const searchScreen = readProjectFile('src', 'screens', 'SearchScreen.tsx');
    expect(searchScreen).toContain('testID="search-query"');
    expect(searchScreen).toContain('testID="search-submit"');
    expect(searchScreen).toContain("'search-result-first'");
    expect(searchScreen).toContain("'search-complete'");
    expect(searchScreen).toContain("'搜索结果，已完成，有可打开结果'");
    expect(searchScreen).toContain("'搜索结果，已完成，结构化回退'");
    expect(searchScreen).toContain('search-outcome-error-');
    expect(readProjectFile('src', 'screens', 'topic', 'TopicScreenBody.tsx')).toContain("testID={topic ? 'topic-detail-loaded' : undefined}");
    expect(readProjectFile('src', 'screens', 'topic', 'TopicScreenBody.tsx')).toContain('testID="topic-author"');
    const userScreen = readProjectFile('src', 'screens', 'UserScreen.tsx');
    expect(userScreen).toContain("testID={profile && !busy ? 'user-screen-loaded' : undefined}");
    expect(userScreen).toContain("testID={index === 0 ? 'user-topic-first' : undefined}");
    const libraryScreen = readProjectFile('src', 'screens', 'LibraryScreen.tsx');
    expect(libraryScreen).toContain("'library-favorites-ready'");
    expect(libraryScreen).toContain("'library-favorites-empty'");
    expect(libraryScreen).toContain("'library-favorite-first'");
    expect(libraryScreen).toContain("'收藏列表，已加载，有收藏'");
    expect(libraryScreen).toContain("'收藏列表，已加载，没有收藏'");
    expect(libraryScreen).toContain("filteredRecords.length ? '收藏列表，已加载，有收藏'");
    expect(libraryScreen).toContain("!filteredRecords.length ? 'library-favorites-empty'");
  });

  it('keeps diagnostic logging initialized and wired into the Release More screen', () => {
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

  it('runs smoke only after APK signer verification and before writing the release manifest', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const signerIndex = releaseScript.indexOf('verifyExpectedReleaseSigner(signerSha256);');
    const smokeIndex = releaseScript.indexOf("run('npm', ['run', 'smoke:android', '--', smokeApkPath]);");
    const manifestIndex = releaseScript.indexOf('writeReleaseManifest({ sha256, signerSha256 });');

    expect(packageJson.scripts['smoke:android']).toBe('node scripts/smoke-android.mjs');
    expect(smokeIndex).toBeGreaterThan(signerIndex);
    expect(manifestIndex).toBeGreaterThan(smokeIndex);
  });

  it('keeps the published arm64 APK separate from a development-signed emulator smoke APK', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const releaseGradle = readProjectFile('scripts', 'android-release-apk.gradle');
    const loadEnvIndex = releaseScript.indexOf('loadReleaseEnvFile();');
    const smokeAbiIndex = releaseScript.indexOf('const smokeApkAbi = requestedSmokeApkAbi(process.env.WZ_ANDROID_SMOKE_ABI);');

    expect(releaseScript).toContain("process.env.WZ_ANDROID_SMOKE_ABI");
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
