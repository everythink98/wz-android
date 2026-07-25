import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release packaging guards', () => {
  it('uses the same complete verification entrypoint in CI and release', () => {
    const pkg = JSON.parse(readProjectFile('package.json'));
    const ciWorkflow = readProjectFile('.github', 'workflows', 'ci.yml');
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const verifyIndex = releaseScript.indexOf("run('npm', ['run', 'verify']);");
    const prebuildIndex = releaseScript.indexOf("run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);");

    expect(pkg.scripts.verify).toBe('npm test && npm run test:ui && npm run test:docs && npm run check:docs && npm run typecheck && npm run check:unused && node scripts/check-version.mjs');
    expect(ciWorkflow).toContain('- run: npm run verify');
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(prebuildIndex).toBeGreaterThan(verifyIndex);
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
    expect(releaseScript).toContain('expectedReleaseSignerSha256');
    expect(releaseScript).toContain('verifyExpectedReleaseSigner(signerSha256);');
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

  it('keeps the Android network proxy and narrow managed-Cookie boundary enabled', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(app.expo.plugins).toContain('./plugins/withNetworkProxyModule');
    expect(plugin).toContain('NetworkProxyModule');
    expect(plugin).toContain('NetworkProxyPackage');
    expect(plugin).toContain('LocalNetworkProxyServer');
    expect(plugin).toContain('ProxyController');
    expect(plugin).toContain('OkHttpClientProvider.setOkHttpClientFactory');
    expect(plugin).toContain('NetworkingModule.setCustomClientBuilder');
    expect(plugin).toContain('ReadOnlyWebViewCookieHandler');
    expect(plugin).toContain('JavaNetCookieJar');
    expect(plugin).toContain('configureManagedClient');
    expect(plugin).toContain('fun readManagedCookieHeader(exactUrl: String, promise: Promise)');
    expect(plugin).toContain('fun clearManagedLoginCookies(source: String, promise: Promise)');
    expect(plugin).not.toContain('debugAnonymousAvailable');
    expect(plugin).not.toContain('setManagedAnonymousMode');
    expect(plugin).not.toContain('anonymousCookieSources');
    expect(plugin).not.toContain('filterAnonymousCookieHeader');
    expect(plugin).toContain('fun managedCookieHeaderForUrl(url: String)');
    expect(plugin).toContain('WebSettings.getDefaultUserAgent(reactContext)');
    const moduleSource = plugin.slice(
      plugin.indexOf('function networkProxyModuleSource'),
      plugin.indexOf('function networkProxyPackageSource')
    );
    expect(moduleSource).toContain('import android.webkit.WebSettings');
    expect(moduleSource).toContain('WebSettings.getDefaultUserAgent(reactContext)');
    expect(app.expo.plugins).not.toContain('./plugins/withLinuxDoCookieModule');
    expect(plugin.slice(
      plugin.indexOf('fun readManagedCookieHeader(exactUrl: String, promise: Promise)'),
      plugin.indexOf('fun clearManagedLoginCookies(source: String, promise: Promise)')
    )).not.toContain('flush()');
    const clearCookiePlan = plugin.slice(
      plugin.indexOf('internal data class ManagedLoginCookieClearPlan'),
      plugin.indexOf('object NetworkProxyRuntime')
    );
    const clearCookieFlow = plugin.slice(
      plugin.indexOf('internal fun clearManagedLoginCookies(source: String): Boolean'),
      plugin.indexOf('fun currentLocalProxy(): Proxy?')
    );
    expect(clearCookiePlan).toContain('listOf("yaohuo.me", "www.yaohuo.me")');
    expect(clearCookiePlan).toContain('add(url to "$expired; Domain=$domain")');
    expect(clearCookiePlan).not.toContain('Domain=.$domain');
    expect(clearCookieFlow).toContain('managedLoginCookieClearPlan(source)');
    expect(clearCookieFlow).toContain('for ((url, value) in plan.expirations)');
    expect(clearCookieFlow).toContain('Handler(Looper.getMainLooper())');
    expect(clearCookieFlow).toContain('CountDownLatch');
    expect(clearCookieFlow).toContain('await(5, TimeUnit.SECONDS)');
    expect(clearCookieFlow.indexOf('await(5, TimeUnit.SECONDS)'))
      .toBeLessThan(clearCookieFlow.indexOf('cookieManager.flush()'));
    expect(clearCookieFlow.indexOf('cookieManager.flush()'))
      .toBeLessThan(clearCookieFlow.indexOf('cookieManager.getCookie(url)'));
    expect(plugin).toContain('installExpoImageClient');
    expect(plugin).toContain('OkHttpClientProvider.setOkHttpClientFactory { client }');
    expect(plugin).toContain('installExpoImageClient(appContext, client)');
    expect(plugin).toContain('GlideUrlWrapperLoader.Factory(client)');
    expect(plugin).not.toContain('internal fun createManagedClient');
    expect(plugin).not.toContain('recoverNodeSeekNetwork');
    expect(plugin).toContain('private val connectionPool = ConnectionPool()');
    expect(plugin).toContain('evictAll()');
    expect(plugin).toContain('dispatcher.cancelAll()');
    expect(plugin.match(/dispatcher\.cancelAll\(\)/g)).toHaveLength(1);
    expect(plugin.match(/connectionPool\.evictAll\(\)/g)).toHaveLength(1);
    expect(plugin).toContain('builder.dispatcher(dispatcher)');
    expect(plugin).toContain('androidx.webkit:webkit:1.14.0');
    expect(plugin).toContain('testImplementation("junit:junit:4.13.2")');
    expect(plugin).toContain("fs.writeFileSync(path.join(testOutputDir, 'NetworkProxyRuntimeTest.kt')");
  });

  it('keeps network proxy failures closed instead of falling back to direct network', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');
    const applyFlow = plugin.slice(plugin.indexOf('fun applyProxy('), plugin.indexOf('fun testProxy('));
    const serializedTransitionIndex = applyFlow.indexOf('val appliedPort = webViewProxyOperations.run {');
    const blockIndex = applyFlow.indexOf('beginTransition()');
    const startIndex = applyFlow.indexOf('server.start()');
    const applyIndex = applyFlow.indexOf('applyWebViewProxy(server.port)');
    const commitIndex = applyFlow.indexOf('commitServer(server)');
    const finalSyncIndex = applyFlow.indexOf('synchronizeWebViewProxyWithRuntime()', commitIndex);

    expect(plugin).toContain('fun blockNetworkRequests()');
    expect(plugin).toContain('@Volatile private var localProxy: Proxy? = blockedProxy');
    expect(plugin).toContain('internal class SerializedWebViewProxyOperations');
    expect(plugin).toContain('private val webViewProxyOperations = SerializedWebViewProxyOperations()');
    expect(plugin).toContain('proxyServers.requireCurrent(owner)');
    expect(plugin).toContain('restoreWebViewProxyIfStateChanged(proxyServers, generation');
    expect(plugin).toContain('"WebView 代理清除超时",\n      onTimeoutOrLateCompletion = ::restoreWebViewProxyFromRuntime');
    expect(plugin.match(/local\.soTimeout = 0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(plugin).not.toContain('latch.await(5, TimeUnit.MINUTES)');
    expect(serializedTransitionIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeGreaterThan(serializedTransitionIndex);
    expect(startIndex).toBeGreaterThan(blockIndex);
    expect(applyIndex).toBeGreaterThan(startIndex);
    expect(commitIndex).toBeGreaterThan(applyIndex);
    expect(finalSyncIndex).toBeGreaterThan(commitIndex);
    expect(plugin).not.toContain('replaceServer(null)\n          try {\n            clearWebViewProxy()');
  });

  it('[REG-PROXY-004] keeps native proxy lifecycle logs free of destinations and upstream addresses', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(plugin).toContain('Log.i(LOG_TAG, "local proxy started")');
    expect(plugin).not.toContain('select proxy for ');
    expect(plugin).not.toContain('tunnel CONNECT ');
    expect(plugin).not.toContain('upstream=');
    expect(plugin).not.toContain(' via " + upstream');
    expect(plugin).not.toContain('enabled app proxy on 127.0.0.1:');
  });

  it('[REG-PROXY-005] keeps the production connectivity probe wired through TLS, hostname and HTTP validation', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(plugin).toContain('verifyTlsHttpConnectivity(tunnel, host)');
    expect(plugin).toContain('val connection = tlsConnectionFactory(tunnel, host, 443)');
    expect(plugin).toContain('parameters.endpointIdentificationAlgorithm = "HTTPS"');
    expect(plugin).toContain('tlsSocket.startHandshake()');
    expect(plugin).toContain('GET /generate_204 HTTP/1.1');
    expect(plugin).toContain('validateProxyHealthResponse(connection.inputStream())');
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

    expect(app.expo.plugins).toContainEqual(['expo-secure-store', { configureAndroidBackup: true }]);
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
