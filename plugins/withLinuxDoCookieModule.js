const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function linuxDoCookieModuleSource(packageName) {
  return `package ${packageName}

import android.database.sqlite.SQLiteDatabase
import android.webkit.CookieManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class LinuxDoCookieModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val linuxDoCookieUrls = listOf(
    "https://linux.do/latest",
    "https://linux.do",
    "https://www.linux.do/latest",
    "https://www.linux.do"
  )
  private val nodeSeekCookieUrls = listOf(
    "https://www.nodeseek.com",
    "https://nodeseek.com"
  )

  override fun getName(): String = "LinuxDoCookieModule"

  @ReactMethod
  fun getClearance(promise: Promise) {
    try {
      promise.resolve(readClearance())
    } catch (_: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getLinuxDoCookieHeader(promise: Promise) {
    try {
      promise.resolve(readLinuxDoCookieHeader())
    } catch (_: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getNodeSeekCookieHeader(promise: Promise) {
    try {
      promise.resolve(readNodeSeekCookieHeader())
    } catch (_: Exception) {
      promise.resolve(null)
    }
  }

  private fun readLinuxDoCookieHeader(): String? {
    val cookieManagerValue = readLinuxDoCookieHeaderFromCookieManager()
    if (!cookieManagerValue.isNullOrBlank()) {
      return cookieManagerValue
    }

    val dataDir = File(reactContext.applicationInfo.dataDir)
    val candidates = listOf(
      File(dataDir, "app_webview/Default/Cookies"),
      File(dataDir, "app_webview/Cookies")
    )
    for (candidate in candidates) {
      val value = readLinuxDoCookieHeaderFrom(candidate)
      if (!value.isNullOrBlank()) {
        return value
      }
    }
    return null
  }

  private fun readLinuxDoCookieHeaderFromCookieManager(): String? {
    return try {
      val cookieManager = CookieManager.getInstance()
      cookieManager.flush()
      for (url in linuxDoCookieUrls) {
        val value = cookieManager.getCookie(url)
        if (!value.isNullOrBlank()) {
          return value
        }
      }
      null
    } catch (_: Exception) {
      null
    }
  }

  private fun readClearance(): String? {
    val cookieManagerValue = readClearanceFromCookieManager()
    if (!cookieManagerValue.isNullOrBlank()) {
      return cookieManagerValue
    }

    val dataDir = File(reactContext.applicationInfo.dataDir)
    val candidates = listOf(
      File(dataDir, "app_webview/Default/Cookies"),
      File(dataDir, "app_webview/Cookies")
    )
    for (candidate in candidates) {
      val value = readClearanceFrom(candidate)
      if (!value.isNullOrBlank()) {
        return value
      }
    }
    return null
  }

  private fun readClearanceFromCookieManager(): String? {
    return try {
      val cookieManager = CookieManager.getInstance()
      cookieManager.flush()
      for (url in linuxDoCookieUrls) {
        val value = clearanceFromCookieHeader(cookieManager.getCookie(url))
        if (!value.isNullOrBlank()) {
          return value
        }
      }
      null
    } catch (_: Exception) {
      null
    }
  }

  private fun readNodeSeekCookieHeader(): String? {
    val cookieManagerValue = readNodeSeekCookieHeaderFromCookieManager()
    if (!cookieManagerValue.isNullOrBlank()) {
      return cookieManagerValue
    }

    val dataDir = File(reactContext.applicationInfo.dataDir)
    val candidates = listOf(
      File(dataDir, "app_webview/Default/Cookies"),
      File(dataDir, "app_webview/Cookies")
    )
    for (candidate in candidates) {
      val value = readNodeSeekCookieHeaderFrom(candidate)
      if (!value.isNullOrBlank()) {
        return value
      }
    }
    return null
  }

  private fun readNodeSeekCookieHeaderFromCookieManager(): String? {
    return try {
      val cookieManager = CookieManager.getInstance()
      cookieManager.flush()
      for (url in nodeSeekCookieUrls) {
        val value = cookieManager.getCookie(url)
        if (!value.isNullOrBlank()) {
          return value
        }
      }
      null
    } catch (_: Exception) {
      null
    }
  }

  private fun clearanceFromCookieHeader(cookieHeader: String?): String? {
    for (part in cookieHeader.orEmpty().split(";")) {
      val clean = part.trim()
      if (clean.startsWith("cf_clearance=")) {
        return clean.removePrefix("cf_clearance=").takeIf { it.isNotBlank() }
      }
    }
    return null
  }

  private fun readLinuxDoCookieHeaderFrom(cookieDb: File): String? {
    if (!cookieDb.exists()) {
      return null
    }
    var database: SQLiteDatabase? = null
    return try {
      database = SQLiteDatabase.openDatabase(cookieDb.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
      database.rawQuery(
        """
        SELECT name, value
        FROM cookies
        WHERE value != ''
          AND name IN ('cf_clearance', '_t', '_forum_session')
          AND (host_key = 'linux.do' OR host_key = '.linux.do' OR host_key LIKE '%.linux.do')
        ORDER BY last_update_utc DESC
        """.trimIndent(),
        emptyArray()
      ).use { cursor ->
        val parts = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        while (cursor.moveToNext()) {
          val name = cursor.getString(0)
          val value = cursor.getString(1)
          if (!name.isNullOrBlank() && !value.isNullOrBlank() && seen.add(name)) {
            parts.add("$name=$value")
          }
        }
        parts.joinToString("; ").takeIf { it.isNotBlank() }
      }
    } catch (_: Exception) {
      null
    } finally {
      database?.close()
    }
  }

  private fun readClearanceFrom(cookieDb: File): String? {
    if (!cookieDb.exists()) {
      return null
    }
    var database: SQLiteDatabase? = null
    return try {
      database = SQLiteDatabase.openDatabase(cookieDb.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
      database.rawQuery(
        """
        SELECT value
        FROM cookies
        WHERE name = ?
          AND value != ''
          AND (host_key = 'linux.do' OR host_key = '.linux.do' OR host_key LIKE '%.linux.do')
        ORDER BY last_update_utc DESC
        LIMIT 1
        """.trimIndent(),
        arrayOf("cf_clearance")
      ).use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } catch (_: Exception) {
      null
    } finally {
      database?.close()
    }
  }

  private fun readNodeSeekCookieHeaderFrom(cookieDb: File): String? {
    if (!cookieDb.exists()) {
      return null
    }
    var database: SQLiteDatabase? = null
    return try {
      database = SQLiteDatabase.openDatabase(cookieDb.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
      database.rawQuery(
        """
        SELECT name, value
        FROM cookies
        WHERE value != ''
          AND (host_key = 'nodeseek.com' OR host_key = '.nodeseek.com' OR host_key LIKE '%.nodeseek.com')
        ORDER BY last_update_utc DESC
        """.trimIndent(),
        emptyArray()
      ).use { cursor ->
        val parts = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        while (cursor.moveToNext()) {
          val name = cursor.getString(0)
          val value = cursor.getString(1)
          if (!name.isNullOrBlank() && !value.isNullOrBlank() && seen.add(name)) {
            parts.add("$name=$value")
          }
        }
        parts.joinToString("; ").takeIf { it.isNotBlank() }
      }
    } catch (_: Exception) {
      null
    } finally {
      database?.close()
    }
  }
}
`;
}

function linuxDoCookiePackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LinuxDoCookiePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(LinuxDoCookieModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

function injectLinuxDoCookiePackage(contents) {
  if (contents.includes('add(LinuxDoCookiePackage())')) {
    return contents;
  }
  return contents.replace(
    /PackageList\(this\)\.packages\.apply\s*\{/,
    (match) => `${match}\n              add(LinuxDoCookiePackage())`
  );
}

module.exports = function withLinuxDoCookieModule(config) {
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
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'LinuxDoCookieModule.kt'), linuxDoCookieModuleSource(packageName));
    fs.writeFileSync(path.join(outputDir, 'LinuxDoCookiePackage.kt'), linuxDoCookiePackageSource(packageName));
    return config;
  }]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectLinuxDoCookiePackage(config.modResults.contents);
    return config;
  });
};
