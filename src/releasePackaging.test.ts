import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release packaging guards', () => {
  it('keeps release checks before Android files are regenerated', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const testIndex = releaseScript.indexOf("run('npm', ['test']);");
    const unusedIndex = releaseScript.indexOf("run('npm', ['run', 'check:unused']);");
    const versionIndex = releaseScript.indexOf("run('node', ['scripts/check-version.mjs', '--release']);");
    const prebuildIndex = releaseScript.indexOf("run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);");

    expect(testIndex).toBeGreaterThanOrEqual(0);
    expect(unusedIndex).toBeGreaterThan(testIndex);
    expect(versionIndex).toBeGreaterThan(unusedIndex);
    expect(prebuildIndex).toBeGreaterThan(versionIndex);
  });

  it('requires a clean worktree before release and after generating the tracked icon', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const firstGuard = releaseScript.indexOf("assertCleanWorktree({ rootDir, phase: '发布前' });");
    const tests = releaseScript.indexOf("run('npm', ['test']);");
    const icon = releaseScript.indexOf("run('node', ['scripts/generate-adaptive-icon.mjs']);");
    const secondGuard = releaseScript.indexOf("assertCleanWorktree({ rootDir, phase: 'adaptive icon 生成后' });");
    const prebuild = releaseScript.indexOf("run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);");

    expect(firstGuard).toBeGreaterThanOrEqual(0);
    expect(firstGuard).toBeLessThan(tests);
    expect(secondGuard).toBeGreaterThan(icon);
    expect(secondGuard).toBeLessThan(prebuild);
    expect(releaseScript).toContain("run('node', ['scripts/check-version.mjs', '--release']);");
  });

  it('keeps version truth in config instead of duplicating it in stable docs', () => {
    const versionCheck = readProjectFile('scripts', 'check-version.mjs');

    expect(versionCheck).toContain('version !== appVersion');
    expect(versionCheck).toContain('Number.isInteger(versionCode)');
    expect(versionCheck).not.toContain("readText('README.md')");
    expect(versionCheck).not.toContain("readText('memory', 'project.md')");
  });

  it('keeps the published APK arm64-only and development signing limited to the smoke APK', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const gradle = readProjectFile('scripts', 'android-release-apk.gradle');

    expect(releaseScript).toContain('app-arm64-v8a-release.apk');
    expect(releaseScript).toContain('.env.release.local');
    expect(releaseScript).toContain('verifyReleaseSigningEnv();');
    expect(releaseScript).toContain('androiddebugkey');
    expect(releaseScript).toContain('debug.keystore');
    expect(releaseScript).toContain("const releaseApkFileName = 'app-arm64-v8a-release.apk'");
    expect(releaseScript).toContain("const releaseApkAbis = [...new Set(['arm64-v8a', smokeApkAbi])]");
    expect(releaseScript).toContain('app-${smokeApkAbi}-smoke-dev.apk');
    expect(releaseScript).toContain('signDevelopmentSmokeApk(builtSmokeApkPath, smokeApkPath);');
    expect(releaseScript).toContain('smokeSignerSha256 === expectedReleaseSignerSha256');
    expect(releaseScript).not.toContain('verifyExpectedReleaseSigner(smokeSignerSha256);');
    expect(releaseScript).toContain("`-PreactNativeArchitectures=${releaseApkAbis.join(',')}`");
    expect(releaseScript).toContain("`-PreleaseApkAbis=${releaseApkAbis.join(',')}`");
    expect(releaseScript).not.toContain('armeabi-v7a');
    expect(gradle).toContain('project.findProperty("releaseApkAbis") ?: "arm64-v8a"');
    expect(gradle).toContain('include(*requestedReleaseAbis)');
    expect(gradle).not.toContain('armeabi-v7a');
  });

  it('generates a release manifest with APK hash, package, version, and signer digest', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');

    expect(releaseScript).toContain('release-manifest.json');
    expect(releaseScript).toContain('apkName');
    expect(releaseScript).toContain('sha256');
    expect(releaseScript).toContain('packageName');
    expect(releaseScript).toContain('versionName');
    expect(releaseScript).toContain('versionCode');
    expect(releaseScript).toContain('signerSha256');
    expect(releaseScript).toContain('Signer #1 certificate');
    expect(releaseScript).toContain('V\\d+(?:\\.\\d+)? Signer: certificate');
  });

  it('pins the expected release signer digest before writing the manifest', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');

    expect(app.expo.extra.releaseSignerSha256).toBe('6cb2f2a6034e18b7b82315e46e515b909817b9a211ee0f02c3c39224ef5bdd66');
    expect(app.expo.extra.releaseTrustAnchorSha256).toBe('6cb2f2a6034e18b7b82315e46e515b909817b9a211ee0f02c3c39224ef5bdd66');
    expect(releaseScript).toContain('expectedReleaseSignerSha256');
    expect(releaseScript).toContain('verifyExpectedReleaseSigner(signerSha256);');
  });

  it('verifies the APK signer lineage against the immutable trust anchor', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const lineageInspector = readProjectFile('scripts', 'InspectApkLineage.java');

    expect(releaseScript).toContain('expectedReleaseTrustAnchorSha256');
    expect(releaseScript).toContain('verifyReleaseSignerLineage(releaseApkPath, signerSha256);');
    expect(lineageInspector).toContain('result.isVerified()');
    expect(lineageInspector).toContain('result.getSigningCertificateLineage()');
    expect(lineageInspector).toContain('getCertificatesInLineage()');
    expect(releaseScript).toContain('WZ_ANDROID_SIGNING_LINEAGE_PATH');
    expect(releaseScript).toContain("'--lineage', lineagePath");
    expect(releaseScript).toContain('signReleaseApkWithLineage(releaseApkPath);');
    expect(releaseScript).toContain('signReleaseApkWithLineage(builtSmokeApkPath);');
  });

  it('does not print apksigner certificate output after a successful check', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');

    expect(releaseScript).toMatch(/if \(result\.status !== 0\) \{\s+if \(result\.stdout\) \{/);
  });

  it('keeps release minify and resource shrinking enabled by default', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const plugin = readProjectFile('plugins', 'withAndroidReleaseDefaults.js');

    expect(app.expo.plugins).toContain('./plugins/withAndroidReleaseDefaults');
    expect(plugin).toContain('withGradleProperties');
    expect(plugin).toContain("'android.enableMinifyInReleaseBuilds': 'true'");
    expect(plugin).toContain("'android.enableShrinkResourcesInReleaseBuilds': 'true'");
  });

  it('keeps APK inspection available before opening the Android installer', () => {
    const plugin = readProjectFile('plugins', 'withApkInstaller.js');

    expect(plugin).toContain('fun inspectApk');
    expect(plugin).toContain('fileSha256');
    expect(plugin).toContain('signerSha256');
    expect(plugin).toContain('GET_SIGNING_CERTIFICATES');
  });

  it('returns one current signer and its verified rotation history on every supported Android version', () => {
    const plugin = readProjectFile('plugins', 'withApkInstaller.js');

    expect(plugin).toContain('PackageManager.GET_SIGNATURES');
    expect(plugin).toContain('packageInfo.signatures?.singleOrNull()');
    expect(plugin).toContain('signingInfo.hasMultipleSigners()');
    expect(plugin).toContain('signingInfo.signingCertificateHistory');
    expect(plugin).toContain('signerHistorySha256.last()');
    expect(plugin).toContain('result.putArray("signerHistorySha256", signerHistory)');
    expect(plugin).toContain('result.putBoolean("signerHistoryVerified", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)');
    expect(plugin).not.toContain('apk_signature_unsupported');
  });

  it('documents the release trust anchor as immutable across signer rotations', () => {
    const runbook = readProjectFile('docs', 'operator-runbook.md');

    expect(runbook).toContain('releaseTrustAnchorSha256');
    expect(runbook).toMatch(/releaseTrustAnchorSha256[^\n]*(?:不可|禁止)[^\n]*(?:修改|轮换)/);
  });

  it('keeps the Android network proxy module enabled', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(app.expo.plugins).toContain('./plugins/withNetworkProxyModule');
    expect(plugin).toContain('NetworkProxyModule');
    expect(plugin).toContain('NetworkProxyPackage');
    expect(plugin).toContain('LocalNetworkProxyServer');
    expect(plugin).toContain('ProxyController');
    expect(plugin).toContain('OkHttpClientProvider.setOkHttpClientFactory');
    expect(plugin).toContain('NetworkingModule.setCustomClientBuilder');
    expect(plugin).toContain('fun recoverNetworkConnectionPool(promise: Promise)');
    expect(plugin).toContain('fun recoverNetworkConnectionPool()');
    expect(plugin).toContain('fun recoverNodeSeekNetwork(promise: Promise)');
    expect(plugin).toContain('fun recoverNodeSeekNetwork()');
    const recoverBody = plugin.slice(
      plugin.indexOf('private fun recoverConnectionPool'),
      plugin.indexOf('fun recoverNetworkConnectionPool(promise: Promise)')
    );
    expect(recoverBody).not.toContain('worker.execute');
    expect(plugin).toContain('connectionPool = ConnectionPool()');
    expect(plugin).toContain('evictAll()');
    expect(plugin).toContain('private fun replaceLocalProxy(next: Proxy?)');
    expect(plugin).toContain('replaceLocalProxy(next)');
    expect(plugin).toContain('replaceLocalProxy(blockedProxy)');
    expect(plugin).toContain('rotateConnectionPoolLocked()');
    expect(plugin).not.toContain('cancelAll()');
    expect(plugin).not.toContain('builder.dispatcher');
    expect(plugin).toContain('androidx.webkit:webkit:1.14.0');
  });

  it('keeps network proxy failures closed instead of falling back to direct network', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');
    const startIndex = plugin.indexOf('createdServer.start()');
    const blockIndex = plugin.indexOf('blockServer()', startIndex);
    const applyIndex = plugin.indexOf('applyWebViewProxy(createdServer.port)');
    const disableIndex = plugin.indexOf('if (profile == null)');
    const clearDisabledWebViewIndex = plugin.indexOf('clearWebViewProxy()', disableIndex);
    const restoreDirectRuntimeIndex = plugin.indexOf('replaceServer(null)', disableIndex);

    expect(plugin).toContain('fun blockNetworkRequests()');
    expect(plugin).toContain('private fun blockServer(');
    expect(plugin).toContain('message: String? = null,');
    expect(plugin).toContain('discardCandidate: LocalNetworkProxyServer? = null');
    expect(plugin).toContain('blockServer()');
    expect(plugin.match(/local\.soTimeout = 0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(plugin).not.toContain('latch.await(5, TimeUnit.MINUTES)');
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeGreaterThan(startIndex);
    expect(applyIndex).toBeGreaterThan(blockIndex);
    expect(clearDisabledWebViewIndex).toBeGreaterThan(disableIndex);
    expect(clearDisabledWebViewIndex).toBeLessThan(restoreDirectRuntimeIndex);
    expect(plugin).not.toContain('replaceServer(null)\n          try {\n            clearWebViewProxy()');
    expect(plugin).toContain('private const val BLOCKED_WEBVIEW_PROXY_PORT = 9');
    expect(plugin).toContain('private fun blockWebViewRequests()');
    expect(plugin.match(/blockWebViewRequests\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(plugin).not.toContain('blockServer("代理启动失败，网络已阻断")\n          try {\n            clearWebViewProxy()');
  });

  it('blocks app network from process startup until JavaScript explicitly applies proxy state', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(plugin).toContain('@Volatile private var localProxy: Proxy? = blockedProxy');
    expect(plugin).toContain('fun isBlockingRequests(): Boolean = localProxy === blockedProxy');
  });

  it('does not write request targets or upstream proxy addresses to Android logs', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(plugin).not.toContain('select proxy for ');
    expect(plugin).not.toContain('tunnel CONNECT ');
    expect(plugin).not.toContain('proxy " + method');
    expect(plugin).not.toContain('upstream=');
    expect(plugin).not.toContain('local proxy listening on 127.0.0.1:');
  });

  it('fails closed and exposes a diagnostic status when the local proxy listener dies', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(plugin).toContain('onFatal: (LocalNetworkProxyServer, String) -> Unit');
    expect(plugin).toContain('reportFatal("本机代理监听异常，网络已阻断")');
    expect(plugin).toContain('private fun failServer(failed: LocalNetworkProxyServer, message: String)');
    expect(plugin).toContain('private var candidateServer: LocalNetworkProxyServer? = null');
    expect(plugin).toContain('server === failed || candidateServer === failed');
    expect(plugin).not.toContain('server === failed || server == null');
    expect(plugin.indexOf('stageServer(createdServer)')).toBeLessThan(plugin.indexOf('createdServer.start()'));
    expect(plugin).toContain('blockServer("代理启动失败，网络已阻断", nextServer)');
    expect(plugin).toMatch(/failServer[\s\S]*NetworkProxyRuntime\.blockNetworkRequests\(\)/);
    expect(plugin).toContain('fun getStatus(promise: Promise)');
    expect(plugin).toContain('putString("message", message)');
  });

  it('reads proxy health synchronously instead of queueing behind long proxy tests', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');
    const getStatusBody = plugin.slice(
      plugin.indexOf('fun getStatus(promise: Promise)'),
      plugin.indexOf('private fun parseProfile')
    );

    expect(getStatusBody).toContain('val status = statusSnapshot()');
    expect(getStatusBody).toContain('promise.resolve(statusMap(status.ok, status.port, status.message))');
    expect(getStatusBody).not.toContain('worker.execute');
  });

  it('rejects invalid IPv4 literals before encoding SOCKS5 addresses', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(plugin).toContain('Invalid SOCKS5 IPv4 host');
    expect(plugin).not.toContain('output.write(part.toInt() and 0xff)');
  });

  it('keeps local Android development hosts direct even when a system proxy exists', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');
    const localHostIndex = plugin.indexOf('if (isLocalDevHost(targetHost))');
    const noProxyIndex = plugin.indexOf('return mutableListOf(Proxy.NO_PROXY)', localHostIndex);
    const delegateIndex = plugin.indexOf('delegate?.select(uri)', localHostIndex);

    expect(localHostIndex).toBeGreaterThanOrEqual(0);
    expect(noProxyIndex).toBeGreaterThan(localHostIndex);
    expect(delegateIndex).toBeGreaterThan(noProxyIndex);
  });

  it('keeps the phone system proxy available when the app proxy is disabled', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');
    const disabledIndex = plugin.indexOf('if (proxy == null)');
    const delegateIndex = plugin.indexOf('delegate?.select(uri)', disabledIndex);

    expect(disabledIndex).toBeGreaterThanOrEqual(0);
    expect(delegateIndex).toBeGreaterThan(disabledIndex);
  });

  it('limits media library permissions to photos', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const mediaPlugin = app.expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-media-library');

    expect(mediaPlugin?.[1]?.granularPermissions).toEqual(['photo']);
    expect(app.expo.android.blockedPermissions).toContain('android.permission.READ_MEDIA_AUDIO');
    expect(app.expo.android.blockedPermissions).toContain('android.permission.READ_MEDIA_VIDEO');
  });

  it('keeps SecureStore and expo-video native config plugins enabled', () => {
    const app = JSON.parse(readProjectFile('app.json'));

    expect(app.expo.plugins).toContain('expo-secure-store');
    expect(app.expo.plugins).toContain('expo-video');
  });

  it('pins react-native-render-html to the reviewed version', () => {
    const pkg = JSON.parse(readProjectFile('package.json'));
    const lock = JSON.parse(readProjectFile('package-lock.json'));

    expect(pkg.dependencies['react-native-render-html']).toBe('6.3.4');
    expect(lock.packages[''].dependencies['react-native-render-html']).toBe('6.3.4');
  });

  it('keeps TSX tests discoverable when UI tests are added', () => {
    const vitestConfig = readProjectFile('vitest.config.ts');

    expect(vitestConfig).toContain('src/**/*.test.tsx');
  });
});
