const { withMainApplication } = require('@expo/config-plugins');
const { injectMainApplicationPackage } = require('./androidPackageRegistration');

function injectNetworkProxyInstall(contents) {
  if (contents.includes('com.wz.reader.NetworkProxyRuntime.install(applicationContext)')) {
    return contents;
  }
  const loadPattern = /(\n\s*)loadReactNative\(this\)/;
  if (!loadPattern.test(contents)) {
    throw new Error('无法注入 NetworkProxyRuntime：MainApplication 模板不匹配。');
  }
  return contents.replace(
    loadPattern,
    (match, indent) => `${indent}com.wz.reader.NetworkProxyRuntime.install(applicationContext)${match}`
  );
}

module.exports = function withNetworkProxyModule(config) {
  return withMainApplication(config, (config) => {
    config.modResults.contents = injectNetworkProxyInstall(
      injectMainApplicationPackage(config.modResults.contents, 'com.wz.reader.NetworkProxyPackage')
    );
    return config;
  });
};
