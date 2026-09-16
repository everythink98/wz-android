const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const { androidPackagePath, injectMainApplicationPackage } = require('./androidPackageRegistration');

function networkProxyRuntimeSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'network', 'NetworkProxyRuntime.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function networkProxyModuleSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'network', 'NetworkProxyModule.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function networkProxyPackageSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'network', 'NetworkProxyPackage.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function networkProxyRuntimeTestSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'network', 'NetworkProxyRuntimeTest.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function injectNetworkProxyInstall(contents) {
  if (contents.includes('NetworkProxyRuntime.install(applicationContext)')) {
    return contents;
  }
  const loadPattern = /(\n\s*)loadReactNative\(this\)/;
  if (!loadPattern.test(contents)) {
    throw new Error('无法注入 NetworkProxyRuntime：MainApplication 模板不匹配。');
  }
  return contents.replace(
    loadPattern,
    (match, indent) => `${indent}NetworkProxyRuntime.install(applicationContext)${match}`
  );
}

function injectWebkitDependency(contents) {
  if (contents.includes('androidx.webkit:webkit')) {
    return contents;
  }
  const dependenciesPattern = /dependencies\s*\{/;
  if (!dependenciesPattern.test(contents)) {
    throw new Error('无法注入 androidx.webkit 依赖：app build.gradle 模板不匹配。');
  }
  return contents.replace(
    dependenciesPattern,
    (match) => `${match}\n    implementation("androidx.webkit:webkit:1.17.0")`
  );
}

function injectCronetDependencies(contents) {
  const bundled = 'org.chromium.net:cronet-bundled:500.0.2';
  const okhttp = 'com.google.net.cronet:cronet-okhttp:0.1.1';
  if (contents.includes(bundled) && contents.includes(okhttp)) {
    return contents;
  }
  if (contents.includes(bundled) || contents.includes(okhttp)) {
    throw new Error('Cronet 依赖只注入了一部分，拒绝继续生成 Android 工程。');
  }
  const dependenciesPattern = /dependencies\s*\{/;
  if (!dependenciesPattern.test(contents)) {
    throw new Error('无法注入 Cronet 依赖：app build.gradle 模板不匹配。');
  }
  return contents.replace(
    dependenciesPattern,
    (match) => `${match}
    implementation("org.chromium.net:cronet-bundled:500.0.2")
    implementation("com.google.net.cronet:cronet-okhttp:0.1.1") {
        exclude group: "com.squareup.okhttp3", module: "okhttp"
        exclude group: "com.squareup.okio", module: "okio"
        exclude group: "org.chromium.net", module: "cronet-api"
    }`
  );
}

function injectCronetProguardRules(contents) {
  const rules = [
    '# Cronet 500 optional platform APIs absent from compileSdk 36.',
    '-dontwarn android.app.privatecompute.PccSandboxManager',
    '-dontwarn android.net.http.Proxy$HttpConnectCallback',
    '-dontwarn android.net.http.Proxy',
    '-dontwarn android.net.http.ProxyOptions'
  ];
  const present = rules.slice(1).map((rule) => contents.includes(rule));
  if (present.every(Boolean)) {
    return contents;
  }
  if (present.some(Boolean)) {
    throw new Error('Cronet R8 规则只注入了一部分，拒绝继续生成 Android 工程。');
  }
  return `${contents.trimEnd()}\n\n${rules.join('\n')}\n`;
}

function injectNetworkProxyTestSupport(contents) {
  let next = contents;
  for (const configuration of ['testImplementation', 'androidTestImplementation']) {
    for (const artifact of ['mockwebserver', 'okhttp-tls']) {
      const dependency = `${configuration}("com.squareup.okhttp3:${artifact}:4.12.0")`;
      if (!next.includes(dependency))
        next = next.replace(/dependencies\s*\{/, (match) => `${match}\n    ${dependency}`);
    }
  }
  if (!next.includes('testImplementation("junit:junit:4.13.2")')) {
    const dependenciesPattern = /dependencies\s*\{/;
    if (!dependenciesPattern.test(next)) {
      throw new Error('无法注入代理原生测试依赖：app build.gradle 模板不匹配。');
    }
    next = next.replace(dependenciesPattern, (match) => `${match}\n    testImplementation("junit:junit:4.13.2")`);
  }
  if (!next.includes('unitTests.returnDefaultValues = true')) {
    const androidPattern = /android\s*\{/;
    if (!androidPattern.test(next)) {
      throw new Error('无法配置代理原生测试：app build.gradle 模板不匹配。');
    }
    next = next.replace(
      androidPattern,
      (match) => `${match}\n    testOptions { unitTests.returnDefaultValues = true }`
    );
  }
  return next;
}

function networkImageRuntimeInstrumentedTestSource(packageName) {
  return fs
    .readFileSync(path.join(__dirname, 'network', 'NetworkImageRuntimeInstrumentedTest.kt'), 'utf8')
    .replace(/^package com\.wz\.reader/m, `package ${packageName}`);
}

function withNetworkProxyModule(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = injectNetworkProxyTestSupport(
      injectCronetDependencies(injectWebkitDependency(config.modResults.contents))
    );
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android?.package;
      if (!packageName) {
        return config;
      }
      const proguardPath = path.join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      fs.writeFileSync(proguardPath, injectCronetProguardRules(fs.readFileSync(proguardPath, 'utf8')));
      const outputDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        androidPackagePath(packageName)
      );
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'NetworkProxyRuntime.kt'), networkProxyRuntimeSource(packageName));
      fs.writeFileSync(
        path.join(outputDir, 'MediaConnectionHealth.kt'),
        fs
          .readFileSync(path.join(__dirname, 'network', 'MediaConnectionHealth.kt'), 'utf8')
          .replace('package com.wz.reader', `package ${packageName}`)
      );
      fs.writeFileSync(
        path.join(outputDir, 'ManagedCookieResponses.kt'),
        fs
          .readFileSync(path.join(__dirname, 'network', 'ManagedCookieResponses.kt'), 'utf8')
          .replace('package com.wz.reader', `package ${packageName}`)
      );
      fs.writeFileSync(path.join(outputDir, 'NetworkProxyModule.kt'), networkProxyModuleSource(packageName));
      fs.writeFileSync(path.join(outputDir, 'NetworkProxyPackage.kt'), networkProxyPackageSource(packageName));
      const testOutputDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'test',
        'java',
        androidPackagePath(packageName)
      );
      fs.mkdirSync(testOutputDir, { recursive: true });
      fs.writeFileSync(
        path.join(testOutputDir, 'ManagedCookieResponsesTest.kt'),
        fs
          .readFileSync(path.join(__dirname, 'network', 'ManagedCookieResponsesTest.kt'), 'utf8')
          .replace('package com.wz.reader', `package ${packageName}`)
      );
      fs.writeFileSync(
        path.join(testOutputDir, 'NetworkProxyRuntimeTest.kt'),
        networkProxyRuntimeTestSource(packageName)
      );
      const instrumentedDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'androidTest',
        'java',
        androidPackagePath(packageName)
      );
      fs.mkdirSync(instrumentedDir, { recursive: true });
      for (const destination of [testOutputDir, instrumentedDir]) {
        fs.writeFileSync(
          path.join(destination, 'Http2ImageFaultFixture.kt'),
          fs
            .readFileSync(path.join(__dirname, 'network', 'Http2ImageFaultFixture.kt'), 'utf8')
            .replace('package com.wz.reader', `package ${packageName}`)
        );
      }
      fs.writeFileSync(
        path.join(instrumentedDir, 'ManagedCookieResponsesInstrumentedTest.kt'),
        fs
          .readFileSync(path.join(__dirname, 'network', 'ManagedCookieResponsesInstrumentedTest.kt'), 'utf8')
          .replace('package com.wz.reader', `package ${packageName}`)
      );
      fs.writeFileSync(
        path.join(instrumentedDir, 'NetworkImageRuntimeInstrumentedTest.kt'),
        networkImageRuntimeInstrumentedTestSource(packageName)
      );
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectNetworkProxyInstall(
      injectMainApplicationPackage(config.modResults.contents, 'NetworkProxyPackage')
    );
    return config;
  });
}

module.exports = withNetworkProxyModule;
module.exports.injectCronetProguardRules = injectCronetProguardRules;
