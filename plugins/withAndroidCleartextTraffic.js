const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$ = {
        ...application.$,
        'android:usesCleartextTraffic': 'true'
      };
    }
    return config;
  });
};
