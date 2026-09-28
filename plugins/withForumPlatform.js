const { withMainApplication } = require('@expo/config-plugins');
const { injectMainApplicationPackage } = require('./androidPackageRegistration');

module.exports = function withForumPlatform(config) {
  return withMainApplication(config, (config) => {
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
