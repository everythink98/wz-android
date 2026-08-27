const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const { androidPackagePath, injectMainApplicationPackage } = require('./androidPackageRegistration');

function forumSearchCustomTabModuleSource(packageName) {
  return `package ${packageName}

import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

internal fun isAllowedForumSearchUrl(urlString: String): Boolean {
  val url = runCatching { URI(urlString) }.getOrNull() ?: return false
  val rawQuery = url.rawQuery ?: return false
  if (!rawQuery.startsWith("q=") || rawQuery.contains("&")) return false
  val query = runCatching {
    URLDecoder.decode(rawQuery.removePrefix("q="), StandardCharsets.UTF_8.name())
  }.getOrNull() ?: return false
  val scopedQuery = listOf("site:linux.do ", "site:nodeseek.com ").any { prefix ->
    query.startsWith(prefix) && query.removePrefix(prefix).isNotBlank()
  }
  return url.scheme == "https" &&
    url.host == "www.google.com" &&
    url.port == -1 &&
    url.userInfo == null &&
    url.rawPath == "/search" &&
    url.fragment == null &&
    scopedQuery
}

class ForumSearchCustomTabModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ForumSearchCustomTabModule"

  @ReactMethod
  fun open(urlString: String, promise: Promise) {
    if (!isAllowedForumSearchUrl(urlString)) {
      promise.reject("invalid_url", "外部搜索地址无效")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    val provider = CustomTabsClient.getPackageName(activity, null)
    if (provider == null) {
      promise.resolve(false)
      return
    }
    val openAppIntent = Intent(reactContext, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    val pendingIntent = PendingIntent.getActivity(
      reactContext,
      7301,
      openAppIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag
    )
    val customTab = CustomTabsIntent.Builder()
      .setShowTitle(true)
      .addMenuItem("在阅坛中打开当前主题", pendingIntent)
      .build()
    customTab.intent.setPackage(provider)
    try {
      customTab.launchUrl(activity, Uri.parse(urlString))
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      promise.resolve(false)
    }
  }
}
`;
}

function forumSearchCustomTabPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ForumSearchCustomTabPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ForumSearchCustomTabModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

function forumSearchCustomTabTestSource(packageName) {
  return `package ${packageName}

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForumSearchCustomTabUrlTest {
  @Test
  fun acceptsOnlyScopedGoogleSearchUrls() {
    assertTrue(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+codex"))
    assertTrue(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Anodeseek.com+codex"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=codex"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+"))
    assertFalse(isAllowedForumSearchUrl("https://attacker@www.google.com/search?q=site%3Alinux.do+codex"))
    assertFalse(isAllowedForumSearchUrl("https://example.com/search?q=site%3Alinux.do+codex"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+codex&start=10"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+%"))
  }
}
`;
}

function ensureCustomTabsQuery(manifest) {
  const queries = manifest.manifest.queries || [];
  const query = queries[0] || {};
  const intents = query.intent || [];
  const actionName = 'android.support.customtabs.action.CustomTabsService';
  if (!intents.some((intent) => intent.action?.some((action) => action.$?.['android:name'] === actionName))) {
    intents.push({ action: [{ $: { 'android:name': actionName } }] });
  }
  query.intent = intents;
  if (!queries.length) queries.push(query);
  manifest.manifest.queries = queries;
}

function withForumSearchCustomTab(config) {
  config = withAndroidManifest(config, (config) => {
    ensureCustomTabsQuery(config.modResults);
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android?.package;
      if (!packageName) return config;
      const packagePath = androidPackagePath(packageName);
      const outputDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', packagePath);
      const testOutputDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'test', 'java', packagePath);
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(testOutputDir, { recursive: true });
      fs.writeFileSync(
        path.join(outputDir, 'ForumSearchCustomTabModule.kt'),
        forumSearchCustomTabModuleSource(packageName)
      );
      fs.writeFileSync(
        path.join(outputDir, 'ForumSearchCustomTabPackage.kt'),
        forumSearchCustomTabPackageSource(packageName)
      );
      fs.writeFileSync(
        path.join(testOutputDir, 'ForumSearchCustomTabUrlTest.kt'),
        forumSearchCustomTabTestSource(packageName)
      );
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectMainApplicationPackage(
      config.modResults.contents,
      'ForumSearchCustomTabPackage'
    );
    return config;
  });
}

module.exports = withForumSearchCustomTab;
module.exports.forumSearchCustomTabModuleSource = forumSearchCustomTabModuleSource;
module.exports.ensureCustomTabsQuery = ensureCustomTabsQuery;
