package com.wz.reader

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.wz.reader.composer.ComposerKeyboardHostManager

class ForumPlatformPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      "ApkInstallerModule" -> ApkInstallerModule(reactContext)
      "ForumSearchCustomTabModule" -> ForumSearchCustomTabModule(reactContext)
      "SecureRandomModule" -> SecureRandomModule(reactContext)
      "NotificationDigestModule" -> NotificationDigestModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      "ApkInstallerModule" to ApkInstallerModule::class.java,
      "ForumSearchCustomTabModule" to ForumSearchCustomTabModule::class.java,
      "SecureRandomModule" to SecureRandomModule::class.java,
      "NotificationDigestModule" to NotificationDigestModule::class.java,
    ).mapValues { (name, module) -> ReactModuleInfo(name, module.name, false, false, false, false) }
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(PreviewRegionImageViewManager(), ComposerKeyboardHostManager())
}
