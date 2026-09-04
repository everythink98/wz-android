const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const { androidPackagePath, injectMainApplicationPackage } = require('./androidPackageRegistration');

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

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SecureRandomPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == "SecureRandomModule") SecureRandomModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      "SecureRandomModule" to ReactModuleInfo(
        "SecureRandomModule",
        SecureRandomModule::class.java.name,
        false,
        false,
        false,
        false,
      )
    )
  }
}
`;
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
        androidPackagePath(packageName)
      );
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'SecureRandomModule.kt'), moduleSource(packageName));
      fs.writeFileSync(path.join(outputDir, 'SecureRandomPackage.kt'), packageSource(packageName));
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectMainApplicationPackage(config.modResults.contents, 'SecureRandomPackage');
    return config;
  });
};
