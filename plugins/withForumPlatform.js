const { AndroidConfig, withGradleProperties, withMainActivity, withMainApplication } = require('@expo/config-plugins');
const { injectMainApplicationPackage } = require('./androidPackageRegistration');

module.exports = function withForumPlatform(config) {
  config = withGradleProperties(config, (config) => {
    AndroidConfig.BuildProperties.updateAndroidBuildProperty(config.modResults, 'expo.webp.animated', 'true');
    return config;
  });
  config = withMainApplication(config, (config) => {
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
  return withMainActivity(config, (config) => {
    const hook = 'com.wz.reader.ReaderTypeface.register(resources)';
    const { contents } = config.modResults;
    if (contents.includes(hook)) return config;
    const superCall = /^([ \t]*)super\.onCreate\(null\)$/m;
    if (!superCall.test(contents)) throw new Error('无法注册阅坛字体：MainActivity 模板不匹配。');
    config.modResults.contents = contents.replace(superCall, (match, indent) => indent + hook + '\n' + match);
    return config;
  });
};
