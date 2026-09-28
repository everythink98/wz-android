package com.wz.reader

import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ForumPlatformPackageTest {
  @Test
  fun registersBothNativeViewsWithoutReplacingTheExistingImageView() {
    ReactNativeFeatureFlagsForTests.setUp()
    val context = BridgeReactContext(android.content.ContextWrapper(null))
    assertEquals(
      listOf("WzPreviewRegionImage", "WzComposerKeyboardHost"),
      ForumPlatformPackage().createViewManagers(context).map { it.getName() },
    )
  }

  @Test
  fun exposesEachExistingBridgeOnceWithoutEagerInitialization() {
    val modules = ForumPlatformPackage().getReactModuleInfoProvider().getReactModuleInfos()
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
    }
    assertEquals("WzPreviewRegionImage", PreviewRegionImageViewManager().getName())
  }
}
