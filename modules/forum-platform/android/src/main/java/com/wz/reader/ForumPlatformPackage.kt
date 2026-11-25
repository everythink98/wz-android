package com.wz.reader

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.wz.reader.composer.ComposerKeyboardHostManager

class ForumPlatformPackage : BaseReactPackage() {
  private class Bridge(
    val type: Class<out NativeModule>,
    val create: (ReactApplicationContext) -> NativeModule,
  )

  private val bridges = mapOf(
    "ApkInstallerModule" to Bridge(ApkInstallerModule::class.java, ::ApkInstallerModule),
    "ForumSearchCustomTabModule" to Bridge(ForumSearchCustomTabModule::class.java, ::ForumSearchCustomTabModule),
    "SecureRandomModule" to Bridge(SecureRandomModule::class.java, ::SecureRandomModule),
    "NotificationDigestModule" to Bridge(NotificationDigestModule::class.java, ::NotificationDigestModule),
  )

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    bridges[name]?.create?.invoke(reactContext)

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    bridges.mapValues { (name, bridge) -> ReactModuleInfo(name, bridge.type.name, false, false, false, false) }
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(
      PreviewRegionImageViewManager(),
      ComposerKeyboardHostManager(),
      SearchHistoryIconViewManager(),
      SearchHistoryFrameViewManager(),
    )
}
