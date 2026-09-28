package com.wz.reader

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
    val openAppIntent = Intent().setClassName(reactContext, reactContext.packageName + ".MainActivity").apply {
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
