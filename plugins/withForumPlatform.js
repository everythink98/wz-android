const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const { injectMainApplicationPackage } = require('./androidPackageRegistration');

function withForumNetworkSecurity(config) {
  const resource = 'wz_network_security';
  config = withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.$['android:networkSecurityConfig'] = `@xml/${resource}`;
    return config;
  });
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const sourceRoot = path.join(config.modRequest.platformProjectRoot, 'app', 'src');
      for (const sourceSet of ['main', 'debug', 'debugOptimized']) {
        const directory = path.join(sourceRoot, sourceSet, 'res', 'xml');
        // Android uses this resource in place of the manifest's cleartext flag.
        const cleartext = sourceSet === 'main' ? '' : ' cleartextTrafficPermitted="true"';
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, `${resource}.xml`),
          `<network-security-config><base-config${cleartext}><domainEncryption mode="enabled" /></base-config></network-security-config>\n`
        );
      }
      return config;
    }
  ]);
}

module.exports = function withForumPlatform(config) {
  return withMainApplication(withForumNetworkSecurity(config), (config) => {
    let contents = config.modResults.contents;
    for (const name of ['ForumPlatformPackage', 'NetworkProxyPackage', 'SvgRendererPackage'])
      contents = injectMainApplicationPackage(contents, `com.wz.reader.${name}`);
    if (!contents.includes('com.wz.reader.NetworkProxyRuntime.install(applicationContext)')) {
      const loadPattern = /(\n\s*)loadReactNative\(this\)/;
      if (!loadPattern.test(contents)) throw new Error('无法注入 NetworkProxyRuntime：MainApplication 模板不匹配。');
      contents = contents.replace(
        loadPattern,
        (match, indent) => `${indent}com.wz.reader.NetworkProxyRuntime.install(applicationContext)${match}`
      );
    }
    config.modResults.contents = contents;
    return config;
  });
};
