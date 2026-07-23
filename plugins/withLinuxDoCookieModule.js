const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function linuxDoCookieModuleSource(packageName) {
  return `package ${packageName}

import android.webkit.CookieManager
import android.webkit.WebSettings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

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
  private val yaohuoCookieUrls = listOf(
    "https://www.yaohuo.me",
    "https://yaohuo.me"
  )

  override fun getName(): String = "LinuxDoCookieModule"

  override fun getConstants(): Map<String, Any> = mapOf(
    "defaultUserAgent" to runCatching { WebSettings.getDefaultUserAgent(reactContext) }.getOrDefault("")
  )

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

  @ReactMethod
  fun getYaohuoCookieHeader(promise: Promise) {
    try {
      val cookieManager = CookieManager.getInstance()
      cookieManager.flush()
      promise.resolve(yaohuoCookieUrls.firstNotNullOfOrNull { url ->
        cookieManager.getCookie(url)?.takeIf { it.isNotBlank() }
      })
    } catch (_: Exception) {
      promise.resolve(null)
    }
  }

  private fun readLinuxDoCookieHeader(): String? {
    return readCookieHeader(linuxDoCookieUrls, setOf("cf_clearance", "_t", "_forum_session"))
  }

  private fun readClearance(): String? {
    return cookieValueFromHeader(readLinuxDoCookieHeader(), "cf_clearance")
  }

  private fun readNodeSeekCookieHeader(): String? {
    return readCookieHeader(
      nodeSeekCookieUrls,
      setOf("cf_clearance", "session", "connect.sid", "sid"),
      true
    )
  }

  @ReactMethod
  fun clearLinuxDoLoginCookies(expected: ReadableMap?, promise: Promise) {
    try {
      promise.resolve(clearLinuxDoLoginCookies(expected))
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  private fun clearLinuxDoLoginCookies(expected: ReadableMap?): Boolean {
    val names = listOf("_t", "_forum_session")
    val expectedValues = mutableMapOf<String, String>()
    for (name in names) {
      if (expected?.hasKey(name) == true) {
        val value = expected.getString(name)
        if (!value.isNullOrBlank()) {
          expectedValues[name] = value
        }
      }
    }
    return try {
      val cookieManager = CookieManager.getInstance()
      val expectedValueChanged = linuxDoCookieUrls.any { url ->
        names.any { name ->
          val expectedValue = expectedValues[name]
          val currentValue = cookieValueFromHeader(cookieManager.getCookie(url), name)
          expectedValue != null && currentValue != null && currentValue != expectedValue
        }
      }
      if (expectedValueChanged) {
        false
      } else {
        for (url in linuxDoCookieUrls) {
          for (name in names) {
            cookieManager.setCookie(url, "$name=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0")
            cookieManager.setCookie(url, "$name=; Domain=linux.do; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0")
            cookieManager.setCookie(url, "$name=; Domain=.linux.do; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0")
          }
        }
        cookieManager.flush()
        linuxDoCookieUrls.all { url ->
          names.all { name -> cookieValueFromHeader(cookieManager.getCookie(url), name) == null }
        }
      }
    } catch (_: Exception) {
      false
    }
  }

  private fun cookieValueFromHeader(cookieHeader: String?, cookieName: String): String? {
    for (part in cookieHeader.orEmpty().split(";")) {
      val pieces = part.trim().split("=", limit = 2)
      if (pieces.size == 2 && pieces[0].trim() == cookieName) {
        return pieces[1].trim().takeIf { it.isNotBlank() }
      }
    }
    return null
  }

  private fun readCookieHeader(
    cookieUrls: List<String>,
    wantedNames: Set<String>,
    ignoreNameCase: Boolean = false
  ): String? {
    val parts = mutableListOf<String>()
    val seen = mutableSetOf<String>()
    val normalizedWantedNames = if (ignoreNameCase) wantedNames.map { it.lowercase() }.toSet() else wantedNames
    return try {
      val cookieManager = CookieManager.getInstance()
      cookieManager.flush()
      for (url in cookieUrls) {
        for (part in cookieManager.getCookie(url).orEmpty().split(";")) {
          val clean = part.trim()
          val separator = clean.indexOf("=")
          if (separator <= 0) {
            continue
          }
          val name = clean.substring(0, separator).trim()
          val value = clean.substring(separator + 1).trim()
          val normalizedName = if (ignoreNameCase) name.lowercase() else name
          if (normalizedWantedNames.contains(normalizedName) && value.isNotBlank() && seen.add(normalizedName)) {
            parts.add("$name=$value")
          }
        }
      }
      parts.joinToString("; ").takeIf { it.isNotBlank() }
    } catch (_: Exception) {
      null
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
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error('无法注入 LinuxDoCookiePackage：MainApplication 模板不匹配。');
  }
  const next = contents.replace(packageListPattern, (match) => `${match}\n              add(LinuxDoCookiePackage())`);
  return next;
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
