import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '../..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('Android release packaging guards', () => {
  it('uses the same complete verification entrypoint in CI and release', () => {
    const pkg = JSON.parse(readProjectFile('package.json'));
    const ciWorkflow = readProjectFile('.github', 'workflows', 'ci.yml');
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const verifySteps = String(pkg.scripts.verify).split(/\s*&&\s*/);
    const verifyIndex = releaseScript.indexOf("run('npm', ['run', 'verify']);");
    const prebuildIndex = releaseScript.indexOf(
      "run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install']);"
    );

    expect(verifySteps).toEqual(
      expect.arrayContaining([
        'npm run lint',
        'npm run format:check',
        'npm run check:architecture',
        'npm run test:architecture',
        'npm test',
        'npm run test:ui',
        'npm run test:docs',
        'npm run check:docs',
        'npm run typecheck',
        'npm run check:unused',
        'node scripts/check-version.mjs'
      ])
    );
    expect(pkg.scripts.test).toMatch(/^vitest run\b/);
    expect(pkg.scripts.test).toContain('--sequence.shuffle');
    expect(pkg.scripts['test:ui']).toMatch(/^jest\b/);
    expect(pkg.scripts['test:ui']).toContain('--randomize');
    expect(pkg.scripts['test:ui']).toContain('--showSeed');
    const reactCheck = String(pkg.scripts['check:react']).split(/\s+/);
    expect(reactCheck).toEqual(
      expect.arrayContaining([
        'react-doctor@0.9.3',
        '--no-warnings',
        '--no-telemetry',
        '--no-dead-code',
        '--no-supply-chain',
        '--blocking',
        'error'
      ])
    );
    expect(ciWorkflow).toContain('- run: npm run verify');
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(prebuildIndex).toBeGreaterThan(verifyIndex);
  });

  it('backs the Android appearance setting with Expo SystemUI', () => {
    const pkg = JSON.parse(readProjectFile('package.json'));
    const appConfig = JSON.parse(readProjectFile('app.json'));

    expect(appConfig.expo.userInterfaceStyle).toBe('light');
    expect(pkg.dependencies['expo-system-ui']).toBeDefined();
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
    const releaseHelpers = readProjectFile('scripts', 'release-environment.mjs');
    const gradle = readProjectFile('scripts', 'android-release-apk.gradle');

    expect(releaseScript).toContain('app-arm64-v8a-release.apk');
    expect(releaseScript).toContain('.env.release.local');
    expect(releaseScript).toContain('verifyReleaseSigningEnv(configuredReleaseEnv)');
    expect(releaseScript).toContain('androiddebugkey');
    expect(releaseScript).toContain('debug.keystore');
    expect(releaseScript).toContain("const releaseApkFileName = 'app-arm64-v8a-release.apk'");
    expect(releaseScript).toContain("const releaseApkAbis = [...new Set(['arm64-v8a', smokeApkAbi])]");
    expect(releaseScript).toContain('app-${smokeApkAbi}-smoke-dev.apk');
    expect(releaseScript).toContain('signDevelopmentSmokeApk(builtSmokeApkPath, smokeApkPath);');
    expect(releaseScript).toContain('smokeSignerSha256 === expectedReleaseSignerSha256');
    expect(releaseScript).not.toContain('verifyExpectedReleaseSigner(smokeSignerSha256);');
    expect(releaseHelpers).toContain("`-PreactNativeArchitectures=${builtAbis.join(',')}`");
    expect(releaseHelpers).toContain("`-PreleaseApkAbis=${builtAbis.join(',')}`");
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
    expect(releaseScript).toContain('singleApkSignerSha256(output)');
  });

  it('records Java provenance through the validated parser', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');

    expect(releaseScript).toMatch(/parseJavaVersionOutput\(\s*runCapture\('java', \['-version'\], \{/);
    expect(releaseScript).toContain("failureMessage: '无法读取可信的 Java 版本。'");
    expect(releaseScript).toContain('if (!failureMessage) {');
    expect(releaseScript).not.toContain("firstOutputLine(runCapture('java', ['-version']), 'Java')");
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

  it('compresses native libraries and Hermes while keeping release shrinking enabled', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const buildProperties = app.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    );

    expect(buildProperties?.[1]?.android).toMatchObject({
      buildReactNativeFromSource: true,
      enableMinifyInReleaseBuilds: true,
      enableShrinkResourcesInReleaseBuilds: true,
      useLegacyPackaging: true,
      enableBundleCompression: true
    });
    expect(app.expo.plugins).toContain('./plugins/withAndroidReleaseOptimization');
  });

  it('persists the Gradle JVM limits through Expo prebuild', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const plugin = readProjectFile('plugins', 'withAndroidGradleJvmMemory.js');

    expect(app.expo.plugins).toContain('./plugins/withAndroidGradleJvmMemory');
    expect(plugin).toContain("const GRADLE_JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m'");
    expect(plugin).toContain('withGradleProperties');
  });

  it('keeps the RN fetch implementation and reviewed Expo version exceptions explicit', () => {
    const pkg = JSON.parse(readProjectFile('package.json'));

    expect(readProjectFile('.env').trim()).toBe('EXPO_PUBLIC_USE_RN_FETCH=1');
    expect(pkg.expo.install.exclude).toEqual([
      '@react-native-async-storage/async-storage',
      '@react-native-community/datetimepicker',
      '@react-native-community/slider',
      '@shopify/flash-list',
      'react-native-gesture-handler',
      'react-native-pager-view',
      'react-native-safe-area-context',
      'react-native-screens',
      'react-native-svg',
      'react-native-webview',
      'react-native-worklets'
    ]);
  });

  it('packages the patched React Android implementation from source', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const pkg = JSON.parse(readProjectFile('package.json'));
    const reactNativePatch = readProjectFile('patches', 'react-native+0.86.3.patch');
    const buildProperties = app.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    );

    expect(buildProperties?.[1]?.android?.buildReactNativeFromSource).toBe(true);
    expect(pkg.expo.autolinking.android.buildFromSource).toEqual(expect.arrayContaining(['expo-image', 'expo-video']));
    expect(reactNativePatch).toContain('ReactAndroid/src/main/java');
    expect(reactNativePatch).toContain('jsiDir.invariantSeparatorsPath');
    expect(reactNativePatch).toContain('node_modules/react-native/settings.gradle.kts');
    expect(reactNativePatch).toContain('+project(":packages").projectDir = file(System.getProperty("java.io.tmpdir"))');
    expect(reactNativePatch).not.toContain('ReactAndroid/build.gradle.kts');
    expect(reactNativePatch).not.toContain('compileOnly(');
  });

  it.each([
    ['withApkInstaller.js', 'ApkInstaller'],
    ['withForumSearchCustomTab.js', 'ForumSearchCustomTab'],
    ['withSecureRandomModule.js', 'SecureRandom'],
    ['withNotificationDigestModule.js', 'NotificationDigest'],
    ['withNetworkProxyModule.js', 'NetworkProxy'],
    ['withSvgRendererModule.js', 'SvgRenderer']
  ])('generates %s with the RN 0.86 lazy package API', (pluginFile, owner) => {
    const plugin = readProjectFile('plugins', pluginFile);

    expect(plugin).toContain(`class ${owner}Package : BaseReactPackage()`);
    expect(plugin).toContain(
      'override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule?'
    );
    expect(plugin).toContain('override fun getReactModuleInfoProvider(): ReactModuleInfoProvider');
    expect(plugin).not.toContain('override fun createNativeModules(');
  });

  it('packages the Custom Tabs API with its direct AndroidX dependency', () => {
    const plugin = readProjectFile('plugins', 'withForumSearchCustomTab.js');

    expect(plugin).toContain('androidx.browser:browser:1.10.0');
  });

  it('generates the exact Android digest presentation bridge', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const plugin = readProjectFile('plugins', 'withNotificationDigestModule.js');

    expect(app.expo.plugins).toContain('./plugins/withNotificationDigestModule');
    for (const required of [
      "path.join(outputDir, 'NotificationDigestModule.kt')",
      "path.join(outputDir, 'NotificationDigestPackage.kt')",
      "path.join(testOutputDir, 'NotificationDigestExecutorTest.kt')",
      'ExpoNotificationBuilder(',
      'check(notificationManager.areNotificationsEnabled())',
      'getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE',
      '.notify(identifier, 0, androidNotification)',
      '.cancel(identifier, 0)'
    ]) {
      expect(plugin).toContain(required);
    }
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
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(app.expo.plugins).toContain('./plugins/withNetworkProxyModule');
    for (const required of [
      'NetworkProxyModule',
      'NetworkProxyPackage',
      'OkHttpClientProvider.setOkHttpClientFactory',
      'NetworkingModule.setCustomClientBuilder',
      'fun readManagedCookieHeader(exactUrl: String, promise: Promise)',
      'fun clearManagedLoginCookies(source: String, promise: Promise)',
      'WebSettings.getDefaultUserAgent(reactContext)',
      "path.join(testOutputDir, 'NetworkProxyRuntimeTest.kt')"
    ]) {
      expect(plugin).toContain(required);
    }
    for (const forbidden of [
      'debugAnonymousAvailable',
      'setManagedAnonymousMode',
      'anonymousCookieSources',
      'filterAnonymousCookieHeader'
    ]) {
      expect(plugin).not.toContain(forbidden);
    }
    const moduleSource = plugin.slice(
      plugin.indexOf('function networkProxyModuleSource'),
      plugin.indexOf('function networkProxyPackageSource')
    );
    expect(moduleSource).toContain('import android.webkit.WebSettings');
    expect(moduleSource).toContain('WebSettings.getDefaultUserAgent(reactContext)');
    expect(app.expo.plugins).not.toContain('./plugins/withLinuxDoCookieModule');
    expect(
      plugin.slice(
        plugin.indexOf('fun readManagedCookieHeader(exactUrl: String, promise: Promise)'),
        plugin.indexOf('fun clearManagedLoginCookies(source: String, promise: Promise)')
      )
    ).not.toContain('flush()');
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
    expect(clearCookieFlow.indexOf('await(5, TimeUnit.SECONDS)')).toBeLessThan(
      clearCookieFlow.indexOf('cookieManager.flush()')
    );
    expect(clearCookieFlow.indexOf('cookieManager.flush()')).toBeLessThan(
      clearCookieFlow.indexOf('cookieManager.getCookie(url)')
    );
    expect(packageJson.expo?.autolinking?.android?.buildFromSource).toContain('expo-video');
    for (const required of [
      'OkHttpClientProvider.setOkHttpClientFactory { currentGeneration.mediaClient }',
      'NetworkingModule.setCustomClientBuilder { builder ->',
      'imageClientPublisher = { client -> installExpoImageClientOnMainThread(appContext, client) }',
      'GlideUrlWrapperLoader.Factory(client)',
      'org.chromium.net:cronet-bundled:500.0.2',
      'com.google.net.cronet:cronet-okhttp:0.1.1',
      'exclude group: "com.squareup.okhttp3", module: "okhttp"',
      'exclude group: "com.squareup.okio", module: "okio"',
      'exclude group: "org.chromium.net", module: "cronet-api"',
      'RedirectStrategy.withoutRedirects()',
      'CronetProxyOptions.ALL_PROXIES_FAILED_BEHAVIOR_DISALLOW_DIRECT',
      'androidx.webkit:webkit:1.17.0',
      'testImplementation("junit:junit:4.13.2")'
    ]) {
      expect(plugin).toContain(required);
    }
    for (const forbidden of ['-ignorewarnings', '-dontwarn android.**']) {
      expect(plugin).not.toContain(forbidden);
    }
  });

  it('keeps preview region decoding in its own Android package', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const networkPlugin = readProjectFile('plugins', 'withNetworkProxyModule.js');
    const previewPlugin = readProjectFile('plugins', 'withPreviewRegionImageNative.js');

    expect(app.expo.plugins).toContain('./plugins/withPreviewRegionImageNative');
    expect(networkPlugin).not.toContain('PreviewRegionImage');
    for (const required of [
      'BitmapRegionDecoder',
      'Build.VERSION.SDK_INT >= Build.VERSION_CODES.S',
      'UIManagerHelper.getEventDispatcher(reactContext)',
      'SourceSizeEvent(UIManagerHelper.getSurfaceId(this), id, size)',
      'Handler(Looper.getMainLooper())',
      'PreviewRegionImagePackage',
      'PreviewRegionImageViewManager',
      "path.join(outputDir, 'PreviewRegionImageView.kt')",
      "path.join(testOutputDir, 'PreviewRegionImageMathTest.kt')"
    ]) {
      expect(previewPlugin).toContain(required);
    }
    expect(previewPlugin).not.toContain('RCTEventEmitter');
    expect(previewPlugin).not.toContain('override fun createNativeModules(');
  });

  it('generates the isolated single-WebView SVG poster renderer', () => {
    const app = JSON.parse(readProjectFile('app.json'));
    const plugin = readProjectFile('plugins', 'withSvgRendererModule.js');

    expect(app.expo.plugins).toContain('./plugins/withSvgRendererModule');
    for (const required of [
      'class SvgRendererModule',
      'fun renderPoster(svgBase64: String, cacheKey: String, timeoutMs: Double, promise: Promise)',
      'fun fetchSvgDocument(url: String, headers: ReadableMap, timeoutMs: Double, promise: Promise)',
      'boundedSvgBytes(body.source())',
      'val call = NetworkProxyRuntime.forumImageClient().newCall(request)',
      'blockNetworkLoads = true',
      'javaScriptEnabled = false',
      'allowFileAccess = false',
      'allowContentAccess = false',
      "default-src 'none'",
      'fs.copyFileSync(',
      "'SvgRendererPolicyTest.kt'",
      "'SvgRendererInstrumentedTest.kt'",
      'testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"',
      'androidTestImplementation("androidx.test:runner:1.7.0")'
    ]) {
      expect(plugin).toContain(required);
    }
    for (const forbidden of [
      'private val client by lazy { NetworkProxyRuntime.forumImageClient() }',
      'addJavascriptInterface',
      'allowFileAccessFromFileURLs',
      'allowUniversalAccessFromFileURLs',
      'databaseEnabled',
      'shouldOverrideUrlLoading(view: WebView, url: String)'
    ]) {
      expect(plugin).not.toContain(forbidden);
    }
  });

  it('keeps native proxy lifecycle logs free of destinations and upstream addresses', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(plugin).toContain('Log.i(LOG_TAG, "local proxy started")');
    expect(plugin).not.toContain('select proxy for ');
    expect(plugin).not.toContain('tunnel CONNECT ');
    expect(plugin).not.toContain('upstream=');
    expect(plugin).not.toContain(' via " + upstream');
    expect(plugin).not.toContain('enabled app proxy on 127.0.0.1:');
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
    const mediaPlugin = app.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-media-library'
    );

    expect(mediaPlugin?.[1]?.granularPermissions).toEqual(['photo']);
    expect(app.expo.android.blockedPermissions).toEqual(['android.permission.SYSTEM_ALERT_WINDOW']);
  });

  it('keeps SecureStore backup config without adding an unowned Expo Video capability', () => {
    const app = JSON.parse(readProjectFile('app.json'));

    expect(app.expo.plugins).toContainEqual(['expo-secure-store', { configureAndroidBackup: true }]);
    expect(app.expo.plugins.some((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-video')).toBe(false);
  });

  it('keeps the development tools button out of product hit testing', () => {
    const app = JSON.parse(readProjectFile('app.json'));

    expect(app.expo.plugins).toContainEqual(['expo-dev-client', { toolsButton: false }]);
  });

  it('owns the locked Expo Video source changes through patch-package', () => {
    const pkg = JSON.parse(readProjectFile('package.json'));
    const lock = JSON.parse(readProjectFile('package-lock.json'));
    const patch = readProjectFile('patches', 'expo-video+57.0.3.patch');
    const dataSource = readProjectFile(
      'node_modules',
      'expo-video',
      'android',
      'src',
      'main',
      'java',
      'expo',
      'modules',
      'video',
      'utils',
      'DataSourceUtils.kt'
    );
    const registry = readProjectFile(
      'node_modules',
      'expo-video',
      'android',
      'src',
      'main',
      'java',
      'expo',
      'modules',
      'video',
      'utils',
      'ReadNetworkVideoClientRegistry.kt'
    );
    const networkPlugin = readProjectFile('plugins', 'withNetworkProxyModule.js');

    expect(pkg.dependencies['expo-video']).toBe('~57.0.3');
    expect(lock.packages['node_modules/expo-video'].version).toBe('57.0.3');
    expect(String(pkg.scripts.postinstall).split(/\s*&&\s*/)).toEqual(
      expect.arrayContaining(['patch-package', 'npm run build:composer'])
    );
    expect(patch).toContain('DataSourceUtils.kt');
    expect(patch).toContain('ReadNetworkVideoClientRegistry.kt');
    expect(dataSource).toContain('ReadNetworkVideoClientRegistry.clientForGeneration');
    expect(dataSource).toContain('?: OkHttpClientProvider.createClient()');
    expect(dataSource).toContain('filterKeys { key -> key != READ_NETWORK_GENERATION_HEADER }');
    expect(registry).toContain('object ReadNetworkVideoClientRegistry');
    expect(registry).toContain('clients.remove(generation, client)');
    expect(networkPlugin).not.toContain('patchExpoVideoDataSource');
    expect(networkPlugin).not.toContain('EXPO_VIDEO_SOURCE_SHA256');
  });

  it('pins react-native-render-html to the reviewed version', () => {
    const pkg = JSON.parse(readProjectFile('package.json'));
    const lock = JSON.parse(readProjectFile('package-lock.json'));

    expect(pkg.dependencies['react-native-render-html']).toBe('6.3.4');
    expect(lock.packages[''].dependencies['react-native-render-html']).toBe('6.3.4');
  });

  it('keeps TSX tests discoverable when UI tests are added', () => {
    const vitestConfig = readProjectFile('vitest.config.mts');

    expect(vitestConfig).toContain('src/**/*.test.tsx');
  });
});
