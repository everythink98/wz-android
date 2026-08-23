const { CodeGenerator, withGradleProperties, withSettingsGradle } = require('@expo/config-plugins');

const RELEASE_GRADLE_PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true'
};

const REACT_NATIVE_SOURCE_BUILD = `includeBuild('../node_modules/react-native') {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android"))
      .using(project(":packages:react-native:ReactAndroid"))
    substitute(module("com.facebook.react:react-native"))
      .using(project(":packages:react-native:ReactAndroid"))
  }
}`;

function setGradleProperty(properties, key, value) {
  const existing = properties.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: 'property', key, value });
}

module.exports = function withAndroidReleaseDefaults(config) {
  config = withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(RELEASE_GRADLE_PROPERTIES)) {
      setGradleProperty(config.modResults, key, value);
    }
    return config;
  });

  return withSettingsGradle(config, (config) => {
    config.modResults.contents = CodeGenerator.mergeContents({
      src: config.modResults.contents,
      newSrc: REACT_NATIVE_SOURCE_BUILD,
      tag: 'wz-react-native-source-build',
      anchor: /includeBuild\(expoAutolinking\.reactNativeGradlePlugin\)/,
      offset: 1,
      comment: '//'
    }).contents;
    return config;
  });
};
