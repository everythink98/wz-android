const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function apkInstallerModuleSource(packageName) {
  return `package ${packageName}

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class ApkInstallerModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ApkInstallerModule"

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

      val file = File(Uri.parse(uriString).path ?: "")
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
}
`;
}

function apkInstallerPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ApkInstallerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ApkInstallerModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
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

function injectApkInstallerPackage(contents) {
  if (contents.includes('add(ApkInstallerPackage())')) {
    return contents;
  }
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error('无法注入 ApkInstallerPackage：MainApplication 模板不匹配。');
  }
  const next = contents.replace(packageListPattern, (match) => `${match}\n              add(ApkInstallerPackage())`);
  return next;
}

function ensureInstallPermission(manifest) {
  const permissions = manifest.manifest['uses-permission'] || [];
  if (!permissions.some((permission) => permission.$?.['android:name'] === 'android.permission.REQUEST_INSTALL_PACKAGES')) {
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
      'meta-data': [{
        $: {
          'android:name': 'android.support.FILE_PROVIDER_PATHS',
          'android:resource': '@xml/apk_installer_paths'
        }
      }]
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

  config = withDangerousMod(config, ['android', async (config) => {
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
    const xmlDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'ApkInstallerModule.kt'), apkInstallerModuleSource(packageName));
    fs.writeFileSync(path.join(outputDir, 'ApkInstallerPackage.kt'), apkInstallerPackageSource(packageName));
    fs.writeFileSync(path.join(xmlDir, 'apk_installer_paths.xml'), fileProviderPathsSource());
    return config;
  }]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectApkInstallerPackage(config.modResults.contents);
    return config;
  });
};
