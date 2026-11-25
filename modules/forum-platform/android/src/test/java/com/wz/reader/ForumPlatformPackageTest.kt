package com.wz.reader

import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class ForumPlatformPackageTest {
  @Test
  fun registersEachNativeViewWithoutReplacingTheExistingImageView() {
    ReactNativeFeatureFlagsForTests.setUp()
    val context = BridgeReactContext(android.content.ContextWrapper(null))
    assertEquals(
      listOf("WzPreviewRegionImage", "WzComposerKeyboardHost", "WzSearchHistoryIcon", "WzSearchHistoryFrame"),
      ForumPlatformPackage().createViewManagers(context).map { it.getName() },
    )
  }

  @Test
  fun exposesEachExistingBridgeOnceWithoutEagerInitialization() {
    ReactNativeFeatureFlagsForTests.setUp()
    val context = BridgeReactContext(android.content.ContextWrapper(null))
    val platform = ForumPlatformPackage()
    val modules = platform.getReactModuleInfoProvider().getReactModuleInfos()
    assertEquals(
      setOf("ApkInstallerModule", "ForumSearchCustomTabModule", "SecureRandomModule", "NotificationDigestModule"),
      modules.keys,
    )
    modules.forEach { (name, info) ->
      assertEquals(name, info.name)
      assertEquals("com.wz.reader.$name", info.className)
      assertFalse(info.needsEagerInit)
      assertFalse(info.canOverrideExistingModule)
      assertFalse(info.isCxxModule)
      assertFalse(info.isTurboModule)
      val module = requireNotNull(platform.getModule(name, context))
      try {
        assertEquals(name, module.name)
        assertEquals(info.className, module.javaClass.name)
      } finally {
        module.invalidate()
      }
    }
    assertNull(platform.getModule("unregistered", context))
  }
}
