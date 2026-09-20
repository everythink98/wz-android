const { withMainApplication } = require('@expo/config-plugins');
const { injectMainApplicationPackage } = require('./androidPackageRegistration');

module.exports = function withSvgRendererModule(config) {
  return withMainApplication(config, (config) => {
    config.modResults.contents = injectMainApplicationPackage(
      config.modResults.contents,
      'com.wz.reader.SvgRendererPackage'
    );
    return config;
  });
};
