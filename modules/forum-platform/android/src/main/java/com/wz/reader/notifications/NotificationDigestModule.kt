package com.wz.reader

import android.app.NotificationManager
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationBehaviorRecord
import expo.modules.notifications.notifications.model.NotificationContent
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.presentation.builders.ExpoNotificationBuilder
import expo.modules.notifications.notifications.triggers.ChannelAwareTrigger
import expo.modules.notifications.service.delegates.SharedPreferencesNotificationCategoriesStore
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.util.concurrent.Executors

internal class NotificationDigestExecutor {
  private val executor = Executors.newSingleThreadExecutor()

  fun execute(onRejected: (Exception) -> Unit, operation: () -> Unit) {
    try {
      executor.execute { operation() }
    } catch (error: Exception) {
      onRejected(error)
    }
  }

  fun shutdown() {
    executor.shutdown()
  }
}

class NotificationDigestModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private const val CHANNEL_ID = "message-notifications"
    private const val NOTIFICATION_COLOR = "#1677FF"
  }

  private val executor = NotificationDigestExecutor()

  override fun getName(): String = "NotificationDigestModule"

  private fun enqueue(promise: Promise, code: String, message: String, operation: () -> Unit) {
    executor.execute(
      onRejected = { error -> promise.reject(code, message, error) }
    ) {
      try {
        operation()
      } catch (error: Exception) {
        promise.reject(code, message, error)
      }
    }
  }

  @ReactMethod
  fun present(identifier: String, title: String, body: String, source: String, promise: Promise) {
    enqueue(promise, "notification_digest_present_failed", "无法展示消息通知") {
      require(identifier.startsWith("wz-message-")) { "invalid notification identifier" }
      val content = NotificationContent.Builder()
        .setTitle(title)
        .setText(body)
        .setBody(JSONObject().put("source", source))
        .setColor(Color.parseColor(NOTIFICATION_COLOR))
        .setAutoDismiss(true)
        .build()
      val notification = Notification(NotificationRequest(identifier, content, ChannelAwareTrigger(CHANNEL_ID)))
      val androidNotification = runBlocking {
        ExpoNotificationBuilder(
          reactContext,
          notification,
          SharedPreferencesNotificationCategoriesStore(reactContext)
        ).apply {
          setAllowedBehavior(
            NotificationBehaviorRecord(
              shouldShowBanner = true,
              shouldShowList = true,
              shouldPlaySound = true
            )
          )
        }.build()
      }
      val notificationManager = NotificationManagerCompat.from(reactContext)
      check(notificationManager.areNotificationsEnabled()) { "notifications disabled" }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channelManager = reactContext.getSystemService(NotificationManager::class.java)
        check(channelManager.getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE) {
          "notification channel disabled"
        }
      }
      notificationManager.notify(identifier, 0, androidNotification)
      promise.resolve(identifier)
    }
  }

  @ReactMethod
  fun dismiss(identifier: String, promise: Promise) {
    enqueue(promise, "notification_digest_dismiss_failed", "无法撤销消息通知") {
      require(identifier.startsWith("wz-message-")) { "invalid notification identifier" }
      NotificationManagerCompat.from(reactContext).cancel(identifier, 0)
      promise.resolve(null)
    }
  }

  override fun invalidate() {
    executor.shutdown()
    super.invalidate()
  }
}
