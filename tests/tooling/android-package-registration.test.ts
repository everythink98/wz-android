import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { androidPackagePath, injectMainApplicationPackage } = require('../../plugins/androidPackageRegistration') as {
  androidPackagePath: (packageName: string) => string;
  injectMainApplicationPackage: (contents: string, packageClass: string) => string;
};
const rootDir = path.resolve(__dirname, '../..');
const mainApplication = `class MainApplication : Application(), ReactApplication {
  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
    this,
    object : DefaultReactNativeHost(this) {
      override fun getPackages(): List<ReactPackage> =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here.
        }
    }
  )
}`;

describe('Android package registration owner', () => {
  it('maps package names to the current platform path', () => {
    expect(androidPackagePath('com.wz.reader')).toBe(['com', 'wz', 'reader'].join(path.sep));
  });

  it('injects the existing MainApplication text exactly once', () => {
    const injected = injectMainApplicationPackage(mainApplication, 'NetworkProxyPackage');

    expect(injected).toBe(
      mainApplication.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(NetworkProxyPackage())'
      )
    );
    expect(injectMainApplicationPackage(injected, 'NetworkProxyPackage')).toBe(injected);
  });

  it('fails closed with the concrete package name when the template drifts', () => {
    expect(() => injectMainApplicationPackage('class MainApplication', 'SvgRendererPackage')).toThrow(
      '无法注入 SvgRendererPackage：MainApplication 模板不匹配。'
    );
  });

  it.each([
    ['withApkInstaller.js', 'ApkInstallerPackage'],
    ['withForumSearchCustomTab.js', 'ForumSearchCustomTabPackage'],
    ['withSecureRandomModule.js', 'SecureRandomPackage'],
    ['withNotificationDigestModule.js', 'NotificationDigestPackage'],
    ['withNetworkProxyModule.js', 'NetworkProxyPackage'],
    ['withPreviewRegionImageNative.js', 'PreviewRegionImagePackage'],
    ['withSvgRendererModule.js', 'SvgRendererPackage']
  ])('%s delegates registration for %s', (pluginFile, packageClass) => {
    const plugin = readFileSync(path.join(rootDir, 'plugins', pluginFile), 'utf8');

    expect(plugin).toMatch(
      new RegExp(`injectMainApplicationPackage\\(\\s*config\\.modResults\\.contents,\\s*'${packageClass}'\\s*\\)`)
    );
    expect(plugin).not.toContain(`add(${packageClass}())`);
  });
});
