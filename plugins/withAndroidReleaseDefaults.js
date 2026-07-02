const { withGradleProperties } = require('@expo/config-plugins');

const RELEASE_GRADLE_PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true'
};

function setGradleProperty(properties, key, value) {
  const existing = properties.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: 'property', key, value });
}

module.exports = function withAndroidReleaseDefaults(config) {
  return withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(RELEASE_GRADLE_PROPERTIES)) {
      setGradleProperty(config.modResults, key, value);
    }
    return config;
  });
};
