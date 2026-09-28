import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { injectMainApplicationPackage } = require('../../plugins/androidPackageRegistration') as {
  injectMainApplicationPackage: (contents: string, packageClass: string) => string;
};
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
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}`;

describe('Android package registration owner', () => {
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

  it('registers native packages once and installs diagnostics before the network and React through Expo mods', async () => {
    const plugins = require('../../app.json').expo.plugins;
    const config = plugins
      .filter(
        (plugin: unknown) => plugin === './plugins/withForumPlatform' || plugin === './plugins/withDiagnosticJournal'
      )
      .reduce((value: object, plugin: string) => require(`../../${plugin}`)(value), { name: 'test', slug: 'test' });
    const first = await config.mods.android.mainApplication({
      ...config,
      modResults: { language: 'kt', contents: mainApplication }
    });
    const second = await config.mods.android.mainApplication(first);

    expect(second.modResults.contents).toBe(first.modResults.contents);
    const contents = second.modResults.contents;
    for (const name of ['ForumPlatformPackage', 'NetworkProxyPackage', 'SvgRendererPackage', 'DiagnosticsPackage'])
      expect(contents.split(`add(com.wz.reader.${name}())`)).toHaveLength(2);
    const startup = [
      'super.onCreate()',
      'com.wz.reader.DiagnosticJournal.install(this,',
      'com.wz.reader.NetworkProxyRuntime.install(applicationContext)',
      'loadReactNative(this)'
    ];
    for (const [index, call] of startup.entries()) {
      expect(contents.split(call)).toHaveLength(2);
      if (index) expect(contents.indexOf(startup[index - 1])).toBeLessThan(contents.indexOf(call));
    }
  });

  it('fails closed when the network startup template drifts', async () => {
    const config = require('../../plugins/withForumPlatform')({ name: 'test', slug: 'test' });
    await expect(
      config.mods.android.mainApplication({
        ...config,
        modResults: { language: 'kt', contents: mainApplication.replace('loadReactNative(this)', '') }
      })
    ).rejects.toThrow('无法注入 NetworkProxyRuntime：MainApplication 模板不匹配。');
  });
});
