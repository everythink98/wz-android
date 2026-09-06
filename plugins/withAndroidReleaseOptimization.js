const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

function enableReleaseOptimization(contents) {
  const optimized = contents.replaceAll('proguard-android.txt', 'proguard-android-optimize.txt');
  if (!optimized.includes('proguard-android-optimize.txt')) {
    throw new Error('Android default ProGuard configuration was not found. Check the Expo template.');
  }
  return optimized;
}

module.exports = function withAndroidReleaseOptimization(config) {
  config = withAppBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = enableReleaseOptimization(gradleConfig.modResults.contents);
    return gradleConfig;
  });
  return withGradleProperties(config, (gradleConfig) => {
    const key = 'android.r8.optimizedResourceShrinking';
    gradleConfig.modResults = gradleConfig.modResults.filter(
      (property) => property.type !== 'property' || property.key !== key
    );
    gradleConfig.modResults.push({ type: 'property', key, value: 'true' });
    return gradleConfig;
  });
};

module.exports.enableReleaseOptimization = enableReleaseOptimization;
