package com.wz.reader

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapRegionDecoder
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ScrollView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.ceil

@RunWith(AndroidJUnit4::class)
class TopicShareCaptureInstrumentedTest {
  private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

  private fun findView(root: View, testId: String): View? =
    if (root.getTag(com.facebook.react.R.id.react_test_id) == testId) root
    else if (root is ViewGroup) (0 until root.childCount).firstNotNullOfOrNull { findView(root.getChildAt(it), testId) }
    else null

  private fun awaitView(activity: android.app.Activity, testId: String): View {
    val deadline = SystemClock.elapsedRealtime() + 40_000
    while (SystemClock.elapsedRealtime() < deadline) {
      var view: View? = null
      instrumentation.runOnMainSync { view = findView(activity.window.decorView, testId) }
      view?.let { return it }
      SystemClock.sleep(25)
    }
    error("Missing $testId")
  }

  private fun click(label: String) {
    fun find(node: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? =
      if (node?.text?.toString()?.equals(label, ignoreCase = true) == true ||
        node?.contentDescription?.toString()?.equals(label, ignoreCase = true) == true) node
      else if (node != null) (0 until node.childCount).firstNotNullOfOrNull { find(node.getChild(it)) }
      else null
    val deadline = SystemClock.elapsedRealtime() + 20_000
    while (SystemClock.elapsedRealtime() < deadline) {
      var node = find(instrumentation.uiAutomation.rootInActiveWindow)
      while (node != null && !node.isClickable) node = node.parent
      if (node?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) == true) return
      SystemClock.sleep(25)
    }
    error("Cannot click $label")
  }

  @Suppress("DEPRECATION")
  @Test fun realFabricScrollViewAndExpoImageCaptureThroughTheJsBridge() {
    val context = instrumentation.targetContext
    val receipt = File(context.cacheDir, "topic-share-capture-proof.json")
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    var file: File? = null
    try {
      awaitView(activity, "long-capture-ready")
      val scroll = awaitView(activity, "long-capture-content") as ScrollView
      lateinit var content: ViewGroup
      var sourceWidth = 0
      var sourceHeight = 0
      val markers = mutableListOf<Pair<Rect, Int>>()
      instrumentation.runOnMainSync {
        content = scroll.getChildAt(0) as ViewGroup
        sourceWidth = content.width
        sourceHeight = content.height
        assertTrue(sourceHeight > 32_000)
        for ((testId, color) in listOf("long-capture-head" to android.graphics.Color.RED,
          "long-capture-image" to android.graphics.Color.BLUE, "long-capture-tail" to android.graphics.Color.GREEN)) {
          val marker = checkNotNull(findView(content, testId))
          val rect = Rect(0, 0, marker.width, marker.height)
          content.offsetDescendantRectToMyCoords(marker, rect)
          markers.add(rect to color)
        }
        scroll.scrollTo(0, 4096)
      }
      click("Capture")
      awaitView(activity, "long-capture-complete")
      val captured = File(android.net.Uri.parse(org.json.JSONObject(receipt.readText()).getString("uri")).path!!)
      file = captured
      assertEquals(File(context.cacheDir, "topic-share-captures").canonicalFile, captured.parentFile!!.canonicalFile)
      val decoder = checkNotNull(BitmapRegionDecoder.newInstance(captured.absolutePath, false))
      try {
        val scale = minOf(sourceWidth, 1080).toDouble() / sourceWidth
        assertEquals(minOf(sourceWidth, 1080), decoder.width)
        assertEquals(ceil(sourceHeight * scale).toInt(), decoder.height)
        for ((rect, color) in markers) {
          val x = (rect.centerX() * scale).toInt()
          val y = (rect.centerY() * scale).toInt()
          val pixel = checkNotNull(decoder.decodeRegion(Rect(x, y, x + 1, y + 1), null))
          try { assertEquals("marker $rect", color, pixel.getPixel(0, 0)) } finally { pixel.recycle() }
        }
      } finally { decoder.recycle() }
      instrumentation.runOnMainSync {
        assertEquals(4096, scroll.scrollY)
        assertEquals(sourceWidth, content.width)
        assertEquals(sourceHeight, content.height)
      }
      click("Release")
      awaitView(activity, "long-capture-released")
      assertFalse(captured.exists())
      instrumentation.sendStatus(0, android.os.Bundle().apply {
        putString("stream", "\nLONG_CAPTURE_BRIDGE source=${sourceWidth}x$sourceHeight markers=3 file=released scroll=unchanged\n")
      })
    } finally {
      file?.delete()
      receipt.delete()
      instrumentation.runOnMainSync { activity.finish() }
    }
  }

  @Suppress("DEPRECATION")
  @Test fun singleLongPngIncludesAllRowsAndKeepsEveryBitmapUnder256Rows() = runBlocking(Dispatchers.IO) {
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val directory = File(context.cacheDir, "topic-share-pixels-proof-${System.nanoTime()}")
    fun color(y: Int): Int = (0xff000000L or ((y - y % 4).toLong() shl 8) or 0x31L).toInt()
    try {
      for ((sourceWidth, sourceHeight) in listOf(1080 to 40_001, 1440 to 40_000, 1440 to 40_001)) {
        lateinit var scroll: ScrollView
        val width = 1080
        val scale = width.toDouble() / sourceWidth
        val height = ceil(sourceHeight * scale).toInt()
        val draws = AtomicInteger()
        instrumentation.runOnMainSync {
          val content = object : View(context) {
            private val paint = Paint().apply { isAntiAlias = false }
            override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
              setMeasuredDimension(sourceWidth, sourceHeight)
            }
            override fun onDraw(canvas: Canvas) {
              if (!canvas.isHardwareAccelerated) draws.incrementAndGet()
              val clip = canvas.clipBounds
              // Four source rows have integer edges after the 0.75x scale.
              for (y in maxOf(0, clip.top / 4 * 4) until minOf(sourceHeight, clip.bottom) step 4) {
                paint.color = color(y)
                canvas.drawRect(0f, y.toFloat(), sourceWidth.toFloat(), minOf(y + 4, sourceHeight).toFloat(), paint)
              }
            }
          }
          scroll = ScrollView(context).apply {
            addView(content, FrameLayout.LayoutParams(sourceWidth, sourceHeight))
            isFillViewport = false
          }
          activity.setContentView(scroll, ViewGroup.LayoutParams(sourceWidth, 200))
          scroll.measure(View.MeasureSpec.makeMeasureSpec(sourceWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY))
          scroll.layout(0, 0, sourceWidth, 200)
          scroll.scrollTo(0, 4096)
        }
        var allocations = 0
        val result = captureTopicShareContent(scroll, directory, {}, createBitmap = { bitmapWidth, bitmapHeight ->
          allocations++
          assertEquals(width, bitmapWidth)
          assertTrue(bitmapHeight in 1..256)
          Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
        })
        assertEquals(1, allocations)
        assertEquals(width, result.width)
        assertEquals(height, result.height)
        assertTrue(draws.get() >= (height + 255) / 256)
        val decoder = checkNotNull(BitmapRegionDecoder.newInstance(result.file.absolutePath, false))
        try {
          assertEquals(width, decoder.width)
          assertEquals(height, decoder.height)
          val rows = listOf(0, 1, 255, 256, 257, 511, 512, 31_999, 32_000, height - 2, height - 1).filter { it < height }
          for (top in rows) {
            val bitmap = checkNotNull(decoder.decodeRegion(Rect(0, top, width, top + 1), null))
            try {
              val sourceY = ((top + 0.5) / scale).toInt()
              for (x in 0 until width) {
                assertEquals("sourceWidth=$sourceWidth pixel $x,$top", color(sourceY), bitmap.getPixel(x, 0))
              }
            } finally { bitmap.recycle() }
          }
        } finally { decoder.recycle() }
        instrumentation.runOnMainSync {
          assertEquals(4096, scroll.scrollY)
          assertEquals(sourceWidth, scroll.getChildAt(0).width)
          assertEquals(sourceHeight, scroll.getChildAt(0).height)
        }
        assertEquals(listOf(result.file), directory.listFiles()!!.toList())
        assertTrue(result.file.delete())
      }
    } finally {
      directory.deleteRecursively()
      instrumentation.runOnMainSync { activity.finish() }
    }
  }

  @Test fun cancellationDiskFailureAndChangingLayoutDiscardThePartialPng() = runBlocking(Dispatchers.IO) {
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val directory = File(context.cacheDir, "topic-share-failure-proof-${System.nanoTime()}")
    try {
      for (mode in listOf("cancel", "disk", "layout")) {
        val draws = AtomicInteger()
        lateinit var scroll: ScrollView
        instrumentation.runOnMainSync {
          val content = object : View(context) {
            override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
              setMeasuredDimension(67, 1025)
            }
            override fun onDraw(canvas: Canvas) {
              canvas.drawColor(android.graphics.Color.BLUE)
              if (!canvas.isHardwareAccelerated && draws.incrementAndGet() == 2 && mode == "layout") {
                layout(left, top, right, bottom + 1)
              }
            }
          }
          scroll = ScrollView(context).apply { addView(content, FrameLayout.LayoutParams(67, 1025)) }
          activity.setContentView(scroll, ViewGroup.LayoutParams(67, 200))
          scroll.measure(View.MeasureSpec.makeMeasureSpec(67, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY))
          scroll.layout(0, 0, 67, 200)
        }
        val failure = try {
          captureTopicShareContent(scroll, directory,
            checkActive = { if (mode == "cancel" && draws.get() >= 2) throw IOException("canceled") },
            openOutput = { file ->
              val output = file.outputStream()
              object : OutputStream() {
                override fun write(value: Int) {
                  if (mode == "disk" && draws.get() >= 2) throw IOException("disk full")
                  output.write(value)
                }
                override fun close() { output.close() }
              }
            })
          null
        } catch (error: Exception) { error }
        assertNotNull("$mode must fail", failure)
        assertTrue("$mode must fail after drawing has started", draws.get() >= 2)
        assertEquals(when (mode) {
          "cancel" -> "canceled"
          "disk" -> "disk full"
          else -> "分享图片正文已变化，请重试。"
        }, failure?.message)
        assertTrue(directory.isDirectory)
        assertEquals(0, directory.listFiles()!!.size)
      }
    } finally {
      directory.deleteRecursively()
      instrumentation.runOnMainSync { activity.finish() }
    }
  }
}
