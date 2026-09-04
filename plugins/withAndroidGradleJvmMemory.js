const { withGradleProperties } = require('expo/config-plugins');

const GRADLE_JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

function setGradleJvmArgs(properties) {
  const existing = properties.find((property) => property.type === 'property' && property.key === 'org.gradle.jvmargs');

  if (existing) {
    existing.value = GRADLE_JVM_ARGS;
  } else {
    properties.push({ type: 'property', key: 'org.gradle.jvmargs', value: GRADLE_JVM_ARGS });
  }

  return properties;
}

module.exports = function withAndroidGradleJvmMemory(config) {
  return withGradleProperties(config, (gradleConfig) => {
    gradleConfig.modResults = setGradleJvmArgs(gradleConfig.modResults);
    return gradleConfig;
  });
};

module.exports.GRADLE_JVM_ARGS = GRADLE_JVM_ARGS;
module.exports.setGradleJvmArgs = setGradleJvmArgs;
