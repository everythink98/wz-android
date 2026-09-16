package com.wz.reader

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NetworkProxyPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == "NetworkProxyModule") NetworkProxyModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      "NetworkProxyModule" to ReactModuleInfo(
        "NetworkProxyModule",
        NetworkProxyModule::class.java.name,
        false,
        false,
        false,
        false,
      )
    )
  }
}
