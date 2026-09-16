const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const { androidPackagePath, injectMainApplicationPackage } = require('./androidPackageRegistration');

function svgRendererModuleSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'svg', 'SvgRendererModule.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function svgRendererInstrumentedTestSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'svg', 'SvgRendererInstrumentedTest.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function svgRendererTestSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'svg', 'SvgRendererPolicyTest.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function injectSvgRendererTestSupport(contents) {
  let next = contents;
  if (!next.includes('testImplementation("junit:junit:4.13.2")')) {
    const dependenciesPattern = /dependencies\s*\{/;
    if (!dependenciesPattern.test(next)) {
      throw new Error('无法注入 SVG renderer 原生测试依赖：app build.gradle 模板不匹配。');
    }
    next = next.replace(dependenciesPattern, (match) => `${match}\n    testImplementation("junit:junit:4.13.2")`);
  }
  if (!next.includes('androidTestImplementation("androidx.test:runner:1.7.0")')) {
    const dependenciesPattern = /dependencies\s*\{/;
    if (!dependenciesPattern.test(next)) {
      throw new Error('无法注入 SVG renderer instrumentation 依赖：app build.gradle 模板不匹配。');
    }
    next = next.replace(
      dependenciesPattern,
      (match) =>
        `${match}\n    androidTestImplementation("androidx.test:runner:1.7.0")\n    androidTestImplementation("androidx.test.ext:junit:1.3.0")`
    );
  }
  if (!next.includes('unitTests.returnDefaultValues = true')) {
    const androidPattern = /android\s*\{/;
    if (!androidPattern.test(next)) {
      throw new Error('无法配置 SVG renderer 原生测试：app build.gradle 模板不匹配。');
    }
    next = next.replace(
      androidPattern,
      (match) => `${match}\n    testOptions { unitTests.returnDefaultValues = true }`
    );
  }
  if (!next.includes('testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"')) {
    const defaultConfigPattern = /defaultConfig\s*\{/;
    if (!defaultConfigPattern.test(next)) {
      throw new Error('无法配置 SVG renderer instrumentation runner：app build.gradle 模板不匹配。');
    }
    next = next.replace(
      defaultConfigPattern,
      (match) => `${match}\n        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"`
    );
  }
  return next;
}

module.exports = function withSvgRendererModule(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = injectSvgRendererTestSupport(config.modResults.contents);
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android?.package;
      if (!packageName) {
        return config;
      }
      const outputDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        androidPackagePath(packageName)
      );
      const testOutputDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'test',
        'java',
        androidPackagePath(packageName)
      );
      const testResourceDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'test',
        'resources',
        'svg_renderer'
      );
      const instrumentedTestOutputDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'androidTest',
        'java',
        androidPackagePath(packageName)
      );
      const instrumentedTestAssetDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'androidTest',
        'assets',
        'svg_renderer'
      );
      const fixturePath = path.join(config.modRequest.projectRoot, 'tests', 'fixtures', 'complex-svg-document.svg');
      if (!fs.existsSync(fixturePath)) {
        throw new Error('缺少 SVG renderer 共享 fixture，拒绝生成 Android 工程。');
      }
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(testOutputDir, { recursive: true });
      fs.mkdirSync(testResourceDir, { recursive: true });
      fs.mkdirSync(instrumentedTestOutputDir, { recursive: true });
      fs.mkdirSync(instrumentedTestAssetDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'SvgRendererModule.kt'), svgRendererModuleSource(packageName));
      fs.writeFileSync(path.join(testOutputDir, 'SvgRendererPolicyTest.kt'), svgRendererTestSource(packageName));
      fs.writeFileSync(
        path.join(instrumentedTestOutputDir, 'SvgRendererInstrumentedTest.kt'),
        svgRendererInstrumentedTestSource(packageName)
      );
      fs.copyFileSync(fixturePath, path.join(testResourceDir, 'complex-svg-document.svg'));
      fs.copyFileSync(fixturePath, path.join(instrumentedTestAssetDir, 'complex-svg-document.svg'));
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectMainApplicationPackage(config.modResults.contents, 'SvgRendererPackage');
    return config;
  });
};
