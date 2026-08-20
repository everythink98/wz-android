const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function moduleSource(packageName) {
  return `package ${packageName}

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.SecureRandom

class SecureRandomModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "SecureRandomModule"

  @ReactMethod
  fun randomHex(byteCount: Int, promise: Promise) {
    try {
      if (byteCount !in 1..128) {
        throw IllegalArgumentException("invalid byte count")
      }
      val bytes = ByteArray(byteCount)
      SecureRandom().nextBytes(bytes)
      promise.resolve(bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) })
    } catch (error: Exception) {
      promise.reject("secure_random_failed", "无法生成安全随机值", error)
    }
  }
}
`;
}

function packageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SecureRandomPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(SecureRandomModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

function injectPackage(contents) {
  if (contents.includes('add(SecureRandomPackage())')) {
    return contents;
  }
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error('无法注入 SecureRandomPackage：MainApplication 模板不匹配。');
  }
  return contents.replace(packageListPattern, (match) => `${match}\n              add(SecureRandomPackage())`);
}

module.exports = function withSecureRandomModule(config) {
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
        packagePath(packageName)
      );
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'SecureRandomModule.kt'), moduleSource(packageName));
      fs.writeFileSync(path.join(outputDir, 'SecureRandomPackage.kt'), packageSource(packageName));
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectPackage(config.modResults.contents);
    return config;
  });
};
