package com.wz.reader

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.view.View
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.ThemedReactContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SearchHistoryArtworkTest {
  @Test
  fun historyIconsShareColoredPixelsWithoutApplyingAViewTint() {
    val application = RuntimeEnvironment.getApplication()
    val context = ThemedReactContext(BridgeReactContext(application), application, "Search", 1)
    val manager = SearchHistoryIconViewManager()
    val color = Color.rgb(118, 122, 128)
    val props = ReactStylesDiffMap(JavaOnlyMap.of("icon", "history", "color", color))

    val first = manager.createView(3, context, props, null, null)
    val second = manager.createView(5, context, props, null, null)
    val original = (first.drawable as BitmapDrawable).bitmap

    assertNull(first.imageTintList)
    assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO, first.importantForAccessibility)
    assertEquals(color, opaquePixel(original))
    assertSame(original, (second.drawable as BitmapDrawable).bitmap)

    val otherColor = Color.rgb(160, 163, 168)
    manager.updateProperties(second, ReactStylesDiffMap(JavaOnlyMap.of("color", otherColor)))
    val revised = (second.drawable as BitmapDrawable).bitmap
    assertNotSame(original, revised)
    assertEquals(otherColor, opaquePixel(revised))
    assertEquals(color, opaquePixel(original))
  }

  @Test
  fun rowFramesKeepRoundOuterCornersAndSquareJoins() {
    val application = RuntimeEnvironment.getApplication()
    val context = ThemedReactContext(BridgeReactContext(application), application, "Search", 1)
    val manager = SearchHistoryFrameViewManager()
    val surface = Color.rgb(245, 245, 245)
    val line = Color.rgb(175, 175, 175)
    val ends = listOf(true to false, false to false, false to true, true to true)
    ends.forEach { (top, bottom) ->
      val props = ReactStylesDiffMap(JavaOnlyMap.of(
        "surfaceColor", surface, "lineColor", line, "lineWidth", 2.0,
        "cornerRadius", 12.0, "roundTop", top, "roundBottom", bottom,
      ))
      val view = manager.createView(7, context, props, null, null)
      view.layout(0, 0, 120, 64)
      val image = Bitmap.createBitmap(120, 64, Bitmap.Config.ARGB_8888)
      view.draw(Canvas(image))

      assertEquals(if (top) Color.TRANSPARENT else line, image.getPixel(0, 0))
      assertEquals(if (bottom) Color.TRANSPARENT else line, image.getPixel(0, 63))
      assertEquals(line, image.getPixel(60, 0))
      assertEquals(surface, image.getPixel(60, 32))
      assertEquals(if (bottom) line else surface, image.getPixel(60, 63))
      assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO, view.importantForAccessibility)
    }
  }

  private fun opaquePixel(bitmap: Bitmap): Int {
    val pixels = IntArray(bitmap.width * bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    return pixels.first { Color.alpha(it) == 255 }
  }
}
