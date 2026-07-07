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
    const versionIndex = releaseScript.indexOf("run('node', ['scripts/check-version.mjs']);");
    const prebuildIndex = releaseScript.indexOf("run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);");

    expect(testIndex).toBeGreaterThanOrEqual(0);
    expect(unusedIndex).toBeGreaterThan(testIndex);
    expect(versionIndex).toBeGreaterThan(unusedIndex);
    expect(prebuildIndex).toBeGreaterThan(versionIndex);
  });

  it('keeps release APK signing and arm64-only output guarded', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const gradle = readProjectFile('scripts', 'android-release-apk.gradle');

    expect(releaseScript).toContain('app-arm64-v8a-release.apk');
    expect(releaseScript).toContain('.env.release.local');
    expect(releaseScript).toContain('verifyReleaseSigningEnv();');
    expect(releaseScript).toContain('androiddebugkey');
    expect(releaseScript).toContain('debug.keystore');
    expect(releaseScript).toContain("'-PreactNativeArchitectures=arm64-v8a'");
    expect(releaseScript).not.toContain('armeabi-v7a');
    expect(gradle).toContain('include "arm64-v8a"');
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
    expect(releaseScript).toContain('V2 Signer: certificate');
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
    expect(plugin).toContain('androidx.webkit:webkit:1.14.0');
  });

  it('keeps network proxy failures closed instead of falling back to direct network', () => {
    const plugin = readProjectFile('plugins', 'withNetworkProxyModule.js');
    const startIndex = plugin.indexOf('nextServer.start()');
    const blockIndex = plugin.indexOf('blockServer()', startIndex);
    const applyIndex = plugin.indexOf('applyWebViewProxy(nextServer.port)');

    expect(plugin).toContain('fun blockNetworkRequests()');
    expect(plugin).toContain('private fun blockServer()');
    expect(plugin).toContain('blockServer()');
    expect(plugin.match(/local\.soTimeout = 0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(plugin).not.toContain('latch.await(5, TimeUnit.MINUTES)');
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeGreaterThan(startIndex);
    expect(applyIndex).toBeGreaterThan(blockIndex);
    expect(plugin).not.toContain('replaceServer(null)\n          try {\n            clearWebViewProxy()');
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
