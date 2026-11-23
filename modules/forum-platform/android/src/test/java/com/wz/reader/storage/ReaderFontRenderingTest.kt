package com.wz.reader

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE, application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReaderFontRenderingTest {
  @get:Rule val folder = TemporaryFolder()

  @Test
  fun rendersDistinctVariableWeights() {
    val font = File("src/main/res/font/noto_sans_sc.ttf")
    val ink = inkByWeight(font, "论坛字重阅读与排版")
    assertTrue("Expected increasing ink weight, got $ink", ink.zipWithNext().all { (a, b) -> a < b })
  }

  @Test
  fun preservesAndroidBoldFallbackForAStaticFont() {
    val font = folder.newFile("Roboto-Regular.ttf")
    checkNotNull(javaClass.getResourceAsStream("/fonts/Roboto-Regular.ttf")).use { source ->
      font.outputStream().use { output -> source.copyTo(output) }
    }
    val ink = inkByWeight(font, "Reading typography")
    assertEquals(ink[0], ink[1])
    assertTrue("Expected synthesized bold to add ink, got $ink", ink[3] > ink[0])
  }

  private fun inkByWeight(font: File, text: String): List<Int> {
    val typeface = checkNotNull(ReaderFontFiles.readTypeface(font)) { "Could not open ${font.absolutePath}" }
    return listOf(400, 500, 600, 700).map { weight ->
      val bitmap = Bitmap.createBitmap(1024, 100, Bitmap.Config.ARGB_8888)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 64f
        this.typeface = Typeface.create(typeface, weight, false)
      }
      Canvas(bitmap).drawText(text, 0f, 78f, paint)
      val pixels = IntArray(bitmap.width * bitmap.height)
      bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
      bitmap.recycle()
      pixels.sumOf { it ushr 24 }
    }
  }
}
