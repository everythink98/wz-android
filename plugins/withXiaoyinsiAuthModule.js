const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function moduleSource(packageName) {
  return `package ${packageName}

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher

class XiaoyinsiAuthModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private const val KEY_ALIAS = "xiaoyinsi.user-api-key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  }

  override fun getName(): String = "XiaoyinsiAuthModule"

  private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun ensureKeyPair() {
    if (keyStore().containsAlias(KEY_ALIAS)) {
      return
    }
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, ANDROID_KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(2048)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
      .setDigests(KeyProperties.DIGEST_SHA1, KeyProperties.DIGEST_SHA256)
      .setRandomizedEncryptionRequired(true)
      .build()
    generator.initialize(spec)
    generator.generateKeyPair()
  }

  @ReactMethod
  fun getPublicKey(promise: Promise) {
    try {
      ensureKeyPair()
      val encoded = keyStore().getCertificate(KEY_ALIAS).publicKey.encoded
      val body = Base64.encodeToString(encoded, Base64.NO_WRAP).chunked(64).joinToString("\\n")
      promise.resolve("-----BEGIN PUBLIC KEY-----\\n$body\\n-----END PUBLIC KEY-----")
    } catch (error: Exception) {
      promise.reject("xiaoyinsi_key_generation_failed", "无法创建小隐寺安全密钥", error)
    }
  }

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
      promise.reject("xiaoyinsi_random_failed", "无法生成小隐寺授权随机值", error)
    }
  }

  @ReactMethod
  fun decrypt(payload: String, promise: Promise) {
    try {
      ensureKeyPair()
      val privateKey = keyStore().getKey(KEY_ALIAS, null)
      val cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding")
      cipher.init(Cipher.DECRYPT_MODE, privateKey)
      val clear = cipher.doFinal(Base64.decode(payload, Base64.DEFAULT))
      promise.resolve(String(clear, Charsets.UTF_8))
    } catch (error: Exception) {
      promise.reject("xiaoyinsi_decrypt_failed", "无法解密小隐寺授权结果", error)
    }
  }

  @ReactMethod
  fun deleteKey(promise: Promise) {
    try {
      val store = keyStore()
      if (store.containsAlias(KEY_ALIAS)) {
        store.deleteEntry(KEY_ALIAS)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("xiaoyinsi_key_delete_failed", "无法删除小隐寺安全密钥", error)
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

class XiaoyinsiAuthPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(XiaoyinsiAuthModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

function injectPackage(contents) {
  if (contents.includes('add(XiaoyinsiAuthPackage())')) {
    return contents;
  }
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error('无法注入 XiaoyinsiAuthPackage：MainApplication 模板不匹配。');
  }
  return contents.replace(packageListPattern, (match) => `${match}\n              add(XiaoyinsiAuthPackage())`);
}

module.exports = function withXiaoyinsiAuthModule(config) {
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
      fs.writeFileSync(path.join(outputDir, 'XiaoyinsiAuthModule.kt'), moduleSource(packageName));
      fs.writeFileSync(path.join(outputDir, 'XiaoyinsiAuthPackage.kt'), packageSource(packageName));
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectPackage(config.modResults.contents);
    return config;
  });
};
