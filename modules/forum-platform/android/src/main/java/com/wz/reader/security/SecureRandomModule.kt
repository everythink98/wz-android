package com.wz.reader

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
