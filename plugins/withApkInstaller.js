const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const { androidPackagePath, injectMainApplicationPackage } = require('./androidPackageRegistration');

function apkInstallerModuleSource(packageName) {
  return `package ${packageName}

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.Locale

@Suppress("UNUSED_PARAMETER")
internal fun <T> singleCurrentApkSigner(
  currentSigners: Array<T>?,
  signingCertificateHistory: Array<T>?
): T? = currentSigners?.singleOrNull()

class ApkInstallerModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ApkInstallerModule"

  @ReactMethod
  fun inspectApk(uriString: String, promise: Promise) {
    try {
      val file = apkFileFromUri(uriString)
      if (!file.exists()) {
        promise.reject("apk_missing", "APK 文件不存在。")
        return
      }
      val packageInfo = apkPackageInfo(file)
      if (packageInfo == null) {
        promise.reject("apk_invalid", "APK 文件无法识别。")
        return
      }
      val signerSha256 = apkSignerSha256(packageInfo)
      if (signerSha256 == null) {
        promise.reject("apk_signature_missing", "APK 签名无法识别。")
        return
      }
      val result = Arguments.createMap()
      result.putString("sha256", fileSha256(file))
      result.putString("packageName", packageInfo.packageName)
      result.putString("versionName", packageInfo.versionName ?: "")
      result.putDouble("versionCode", apkVersionCode(packageInfo).toDouble())
      result.putString("signerSha256", signerSha256)
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("apk_inspect_failed", error.message ?: "无法校验 APK。", error)
    }
  }

  @ReactMethod
  fun installApk(uriString: String, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !reactContext.packageManager.canRequestPackageInstalls()) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + reactContext.packageName))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(intent)
        promise.reject("install_permission", "请允许阅坛安装未知应用后重试。")
        return
      }

      val file = apkFileFromUri(uriString)
      if (!file.exists()) {
        promise.reject("apk_missing", "APK 文件不存在。")
        return
      }

      val apkUri = FileProvider.getUriForFile(reactContext, reactContext.packageName + ".apk_installer_provider", file)
      val intent = Intent(Intent.ACTION_VIEW)
      intent.setDataAndType(apkUri, "application/vnd.android.package-archive")
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("install_failed", error.message ?: "无法打开安装确认。", error)
    }
  }

  private fun apkFileFromUri(uriString: String): File =
    File(Uri.parse(uriString).path ?: "")

  @Suppress("DEPRECATION")
  private fun apkPackageInfo(file: File): PackageInfo? {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return reactContext.packageManager.getPackageArchiveInfo(file.absolutePath, flags)
  }

  @Suppress("DEPRECATION")
  private fun apkVersionCode(packageInfo: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      packageInfo.longVersionCode
    } else {
      packageInfo.versionCode.toLong()
    }

  @Suppress("DEPRECATION")
  private fun apkSignerSha256(packageInfo: PackageInfo): String? {
    val signature = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = packageInfo.signingInfo ?: return null
      singleCurrentApkSigner(signingInfo.apkContentsSigners, signingInfo.signingCertificateHistory)
    } else {
      singleCurrentApkSigner(packageInfo.signatures, null)
    } ?: return null
    return sha256Hex(signature.toByteArray())
  }

  private fun fileSha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) {
          break
        }
        digest.update(buffer, 0, read)
      }
    }
    return bytesToHex(digest.digest())
  }

  private fun sha256Hex(bytes: ByteArray): String =
    bytesToHex(MessageDigest.getInstance("SHA-256").digest(bytes))

  private fun bytesToHex(bytes: ByteArray): String {
    val builder = StringBuilder(bytes.size * 2)
    for (byte in bytes) {
      builder.append(String.format(Locale.US, "%02x", byte.toInt() and 0xff))
    }
    return builder.toString()
  }
}
`;
}

function apkInstallerPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class ApkInstallerPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == "ApkInstallerModule") ApkInstallerModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      "ApkInstallerModule" to ReactModuleInfo(
        "ApkInstallerModule",
        ApkInstallerModule::class.java.name,
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

function apkInstallerTestSource(packageName) {
  return `package ${packageName}

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApkInstallerSignerTest {
  @Test
  fun acceptsOnlyOneCurrentSigner() {
    assertEquals("current", singleCurrentApkSigner(arrayOf("current"), arrayOf("old", "current")))
    assertNull(singleCurrentApkSigner(emptyArray<String>(), arrayOf("old")))
    assertNull(singleCurrentApkSigner(arrayOf("current", "other"), arrayOf("old")))
  }
}
`;
}

function fileProviderPathsSource() {
  return `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <cache-path name="cache" path="." />
  <files-path name="files" path="." />
</paths>
`;
}

function ensureInstallPermission(manifest) {
  const permissions = manifest.manifest['uses-permission'] || [];
  if (
    !permissions.some((permission) => permission.$?.['android:name'] === 'android.permission.REQUEST_INSTALL_PACKAGES')
  ) {
    permissions.push({ $: { 'android:name': 'android.permission.REQUEST_INSTALL_PACKAGES' } });
  }
  manifest.manifest['uses-permission'] = permissions;
}

function ensureFileProvider(manifest, packageName) {
  const application = manifest.manifest.application?.[0];
  if (!application) {
    return;
  }
  const providers = application.provider || [];
  const authority = `${packageName}.apk_installer_provider`;
  if (!providers.some((provider) => provider.$?.['android:authorities'] === authority)) {
    providers.push({
      $: {
        'android:name': 'androidx.core.content.FileProvider',
        'android:authorities': authority,
        'android:exported': 'false',
        'android:grantUriPermissions': 'true'
      },
      'meta-data': [
        {
          $: {
            'android:name': 'android.support.FILE_PROVIDER_PATHS',
            'android:resource': '@xml/apk_installer_paths'
          }
        }
      ]
    });
  }
  application.provider = providers;
}

module.exports = function withApkInstaller(config) {
  config = withAndroidManifest(config, (config) => {
    const packageName = config.android?.package;
    if (packageName) {
      ensureInstallPermission(config.modResults);
      ensureFileProvider(config.modResults, packageName);
    }
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
      const xmlDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      const testDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'test',
        'java',
        androidPackagePath(packageName)
      );
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'ApkInstallerModule.kt'), apkInstallerModuleSource(packageName));
      fs.writeFileSync(path.join(outputDir, 'ApkInstallerPackage.kt'), apkInstallerPackageSource(packageName));
      fs.writeFileSync(path.join(testDir, 'ApkInstallerSignerTest.kt'), apkInstallerTestSource(packageName));
      fs.writeFileSync(path.join(xmlDir, 'apk_installer_paths.xml'), fileProviderPathsSource());
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectMainApplicationPackage(config.modResults.contents, 'ApkInstallerPackage');
    return config;
  });
};
