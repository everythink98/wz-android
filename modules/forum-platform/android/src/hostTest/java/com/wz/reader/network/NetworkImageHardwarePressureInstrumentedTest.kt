package com.wz.reader

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.drawable.BitmapDrawable
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.PixelCopy
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.load.resource.bitmap.Downsampler
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import expo.modules.image.okhttp.GlideUrlWrapper
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NetworkImageHardwarePressureInstrumentedTest {
  @Test
  fun hardwareBitmapsDisplayAndReleaseAcrossFormatsErrorsAndCanceledRequests() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    assertTrue("HARDWARE_UNAVAILABLE: this owner requires API 30+", android.os.Build.VERSION.SDK_INT >= 30)
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val views = mutableListOf<ImageView>()
    var container: LinearLayout? = null
    val server = MockWebServer()
    var serverStarted = false
    val canceledRequests = CountDownLatch(3)
    val releaseCanceled = CountDownLatch(1)
    val canceledCallbacks = AtomicInteger()
    val colors = intArrayOf(Color.RED, Color.GREEN, Color.BLUE, Color.WHITE)
    val formats = listOf("jpeg" to Bitmap.CompressFormat.JPEG, "png" to Bitmap.CompressFormat.PNG,
      "webp" to Bitmap.CompressFormat.WEBP_LOSSLESS)
    var peakPssKb = 0
    var peakBitmapBytes = 0L
    var startMemory = ""

    fun memory(): String {
      val info = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }
      peakPssKb = maxOf(peakPssKb, info.totalPss)
      return "pssKb=${info.totalPss} graphicsKb=${info.getMemoryStat("summary.graphics") ?: "unavailable"}" +
        " nativeHeapBytes=${Debug.getNativeHeapAllocatedSize()} fdCount=${File("/proc/self/fd").list()?.size ?: -1}"
    }

    fun matchesColor(actual: Int, expected: Int): Boolean = Color.alpha(actual) == 255 &&
      listOf(0, 8, 16).all { shift -> kotlin.math.abs((actual shr shift and 255) - (expected shr shift and 255)) <= 12 }

    fun colorSamples(samples: List<IntArray>): String = samples.mapIndexed { slot, pixels ->
      "slot=$slot format=${formats[slot % 3].first} [${pixels.joinToString(",") { Integer.toHexString(it) }}]"
    }.joinToString("; ")

    fun screenPixels(expectedColors: List<IntArray>) {
      val laidOutFrame = CountDownLatch(1)
      instrumentation.runOnMainSync {
        container!!.viewTreeObserver.registerFrameCommitCallback { laidOutFrame.countDown() }
        container!!.invalidate()
      }
      assertTrue("proof views must finish layout before sampling their bounds", laidOutFrame.await(10, TimeUnit.SECONDS))
      val bounds = Rect()
      val samplePoints = mutableListOf<Pair<Int, Int>>()
      instrumentation.runOnMainSync {
        val origin = IntArray(2).also { container!!.getLocationInWindow(it) }
        bounds.set(origin[0], origin[1], origin[0] + container!!.width, origin[1] + container!!.height)
        views.forEach { view ->
          val location = IntArray(2).also { view.getLocationInWindow(it) }
          for ((x, y) in listOf(1 to 1, 3 to 1, 1 to 3, 3 to 3)) {
            samplePoints.add(location[0] - origin[0] + view.width * x / 4 to location[1] - origin[1] + view.height * y / 4)
          }
        }
      }
      val pixels = Bitmap.createBitmap(bounds.width(), bounds.height(), Bitmap.Config.ARGB_8888)
      try {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var matchingFrames = 0
        var attempts = 0
        var lastSamples = ""
        while (System.nanoTime() < deadline) {
          val frame = CountDownLatch(1)
          var splashState = ""
          instrumentation.runOnMainSync {
            assertTrue("HARDWARE_UNAVAILABLE: window must use hardware acceleration", container!!.isHardwareAccelerated)
            val overlays = mutableListOf<String>()
            fun inspect(view: android.view.View) {
              if (view.javaClass.simpleName.contains("Splash")) overlays.add("${view.javaClass.simpleName}:alpha=${view.alpha}:shown=${view.isShown}")
              if (view is ViewGroup) repeat(view.childCount) { inspect(view.getChildAt(it)) }
            }
            inspect(activity.window.decorView)
            splashState = overlays.joinToString(",")
            container!!.viewTreeObserver.registerFrameCommitCallback { frame.countDown() }
            views.forEach { it.invalidate() }
            container!!.invalidate()
          }
          assertTrue("hardware frame must commit before PixelCopy", frame.await(10, TimeUnit.SECONDS))
          val copied = CountDownLatch(1)
          val result = AtomicInteger(-1)
          PixelCopy.request(activity.window, bounds, pixels, { code -> result.set(code); copied.countDown() }, Handler(Looper.getMainLooper()))
          assertTrue("PixelCopy callback must settle", copied.await(10, TimeUnit.SECONDS))
          assertEquals("PixelCopy must read the displayed window", PixelCopy.SUCCESS, result.get())
          val actual = samplePoints.map { (x, y) -> pixels.getPixel(x, y) }.chunked(4).map { it.toIntArray() }
          val matches = actual.indices.all { slot -> actual[slot].indices.all { quadrant ->
            matchesColor(actual[slot][quadrant], expectedColors[slot][quadrant])
          } }
          attempts++
          lastSamples = "actual=${colorSamples(actual)} expected=${colorSamples(expectedColors)} splash=[$splashState]"
          if (attempts == 1 && !matches) instrumentation.sendStatus(0, android.os.Bundle().apply {
            putString("stream", "\nHARDWARE_IMAGE_SCREEN_PENDING $lastSamples\n")
          })
          // The RN proof can mount before the white startup splash finishes fading out.
          // Keep the original color tolerance and require two independently committed matching frames.
          matchingFrames = if (matches) matchingFrames + 1 else 0
          if (matchingFrames == 2) return
        }
        fail("screen pixels must settle on two committed frames; attempts=$attempts $lastSamples")
      } finally { pixels.recycle() }
    }

    fun clearAndVerify(bitmaps: List<Bitmap>) {
      instrumentation.runOnMainSync {
        views.forEach { Glide.with(activity).clear(it); assertNull(it.drawable) }
      }
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
      var recycled = false
      while (!recycled && System.nanoTime() < deadline) {
        instrumentation.runOnMainSync { recycled = bitmaps.all { it.isRecycled } }
        if (!recycled) Thread.sleep(10)
      }
      assertTrue("clearing uncached HARDWARE resources must recycle every owned Bitmap", recycled)
      screenPixels(views.map { IntArray(4) { Color.BLACK } })
    }

    try {
      awaitImageRuntimeProof(instrumentation, activity)
      val encoded = formats.associate { (name, format) ->
        val bitmap = Bitmap.createBitmap(2048, 1024, Bitmap.Config.ARGB_8888)
        try {
          val canvas = Canvas(bitmap)
          val paint = Paint()
          colors.forEachIndexed { index, color ->
            paint.color = color
            val left = (index % 2) * 1024f
            val top = (index / 2) * 512f
            canvas.drawRect(left, top, left + 1024, top + 512, paint)
          }
          name to ByteArrayOutputStream().also { assertTrue(bitmap.compress(format, 100, it)) }.toByteArray()
        } finally { bitmap.recycle() }
      }
      server.dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
          val path = request.path.orEmpty()
          val format = path.substringAfterLast('.')
          if (path.startsWith("/cancel-")) {
            canceledRequests.countDown()
            if (!releaseCanceled.await(30, TimeUnit.SECONDS)) return MockResponse().setResponseCode(504)
          }
          val body = if (path.startsWith("/broken-")) byteArrayOf(0, 1, 2, 3) else requireNotNull(encoded[format])
          return MockResponse().setHeader("Content-Type", "image/$format").setHeader("Cache-Control", "no-store")
            .setBody(okio.Buffer().write(body))
        }
      }
      server.start(InetAddress.getByName("127.0.0.1"), 0)
      serverStarted = true
      val base = "http://127.0.0.1:${server.port}"
      instrumentation.runOnMainSync {
        val width = minOf(256, activity.window.decorView.width / 2, activity.window.decorView.height / 4)
        assertTrue("proof window must be laid out", width >= 64)
        container = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        repeat(3) {
          val row = LinearLayout(activity)
          repeat(2) {
            val view = ImageView(activity).apply { scaleType = ImageView.ScaleType.FIT_XY; setBackgroundColor(Color.BLACK) }
            views.add(view)
            row.addView(view, LinearLayout.LayoutParams(width, width / 2))
          }
          container!!.addView(row, LinearLayout.LayoutParams(width * 2, width / 2))
        }
        // Keep sample points away from edge-to-edge status/navigation bars on the proof Activity.
        activity.addContentView(container, FrameLayout.LayoutParams(width * 2, width * 3 / 2, Gravity.CENTER))
      }

      fun load(slot: Int, path: String, listener: RequestListener<Bitmap>): Target<Bitmap> {
        val source: expo.modules.image.records.Source = expo.modules.image.records.SourceMap(uri = "$base/$path")
        val model = source.createGlideModelProvider(context)!!.getGlideModel() as GlideUrlWrapper
        // Glide 5.0.5 defaults ALLOW_HARDWARE_CONFIG to false; this owner explicitly opts in.
        // Exercise hardware capability through the Expo model/transport, not the app's default request policy.
        return Glide.with(activity).asBitmap().load(model).override(1024, 512).dontTransform()
          .set(Downsampler.ALLOW_HARDWARE_CONFIG, true)
          .diskCacheStrategy(DiskCacheStrategy.NONE).skipMemoryCache(true).listener(listener).into(views[slot])
      }

      fun loadWindow(prefix: String): List<Bitmap> {
        val completed = CountDownLatch(6)
        val failures = AtomicReference<String>()
        val resources = arrayOfNulls<Bitmap>(6)
        instrumentation.runOnMainSync {
          views.indices.forEach { slot ->
            load(slot, "$prefix-$slot.${formats[slot % 3].first}", object : RequestListener<Bitmap> {
              override fun onLoadFailed(error: GlideException?, model: Any?, target: Target<Bitmap>, first: Boolean): Boolean {
                failures.compareAndSet(null, "$prefix slot=$slot error=${error?.javaClass?.simpleName}"); completed.countDown(); return false
              }
              override fun onResourceReady(resource: Bitmap, model: Any, target: Target<Bitmap>?, source: DataSource, first: Boolean): Boolean {
                resources[slot] = resource; completed.countDown(); return false
              }
            })
          }
        }
        assertTrue("format loads must settle", completed.await(30, TimeUnit.SECONDS))
        assertNull(failures.get())
        val bitmaps = resources.map { requireNotNull(it) }
        instrumentation.runOnMainSync {
          bitmaps.forEachIndexed { slot, bitmap ->
            assertEquals("HARDWARE_DECODE_REQUIRED: ${formats[slot % 3].first} decoded as ${bitmap.config}", Bitmap.Config.HARDWARE, bitmap.config)
            assertEquals(1024, bitmap.width); assertEquals(512, bitmap.height)
            assertSame("the decoded hardware bitmap must be attached to its visible view", bitmap, (views[slot].drawable as BitmapDrawable).bitmap)
          }
        }
        val decodedColors = bitmaps.map { bitmap ->
          // Read back the actual HARDWARE resource, independently of the window's splash/overlays.
          val readable = requireNotNull(bitmap.copy(Bitmap.Config.ARGB_8888, false))
          try {
            val samples = listOf(1 to 1, 3 to 1, 1 to 3, 3 to 3).map { (x, y) ->
              readable.getPixel(readable.width * x / 4, readable.height * y / 4)
            }.toIntArray()
            samples
          } finally { readable.recycle() }
        }
        if (prefix == "window-0") instrumentation.sendStatus(0, android.os.Bundle().apply {
          putString("stream", "\nHARDWARE_IMAGE_DECODED_COLORS ${colorSamples(decodedColors)}\n")
        })
        decodedColors.forEachIndexed { slot, samples ->
          assertTrue("decoded slot=$slot quadrants must match fixture: ${colorSamples(decodedColors)}",
            samples.indices.all { matchesColor(samples[it], colors[it]) })
        }
        screenPixels(decodedColors)
        peakBitmapBytes = maxOf(peakBitmapBytes, bitmaps.sumOf { it.allocationByteCount.toLong() })
        return bitmaps
      }

      startMemory = memory()
      repeat(20) { round ->
        val started = System.nanoTime()
        val bitmaps = loadWindow("window-$round")
        val sampledMemory = memory()
        assertEquals((round + 1) * 6, server.requestCount)
        clearAndVerify(bitmaps)
        instrumentation.sendStatus(0, android.os.Bundle().apply {
          putString("stream", "\nHARDWARE_IMAGE_WINDOW round=$round hardware=6 displayed=6 recycled=6 pixelCopy=display-and-clear elapsedMs=${TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)} $sampledMemory\n")
        })
      }
      val failed = CountDownLatch(3)
      val unexpectedSuccess = AtomicInteger()
      instrumentation.runOnMainSync {
        formats.forEachIndexed { slot, (format, _) ->
          load(slot, "broken-$slot.$format", object : RequestListener<Bitmap> {
            override fun onLoadFailed(error: GlideException?, model: Any?, target: Target<Bitmap>, first: Boolean): Boolean { failed.countDown(); return false }
            override fun onResourceReady(resource: Bitmap, model: Any, target: Target<Bitmap>?, source: DataSource, first: Boolean): Boolean { unexpectedSuccess.incrementAndGet(); failed.countDown(); return false }
          })
        }
      }
      assertTrue("all three corrupt formats must fail", failed.await(30, TimeUnit.SECONDS))
      assertEquals(0, unexpectedSuccess.get())
      instrumentation.runOnMainSync { views.forEach { assertNull(it.drawable) } }
      val canceledTargets = mutableListOf<Target<Bitmap>>()
      instrumentation.runOnMainSync {
        formats.forEachIndexed { slot, (format, _) ->
          canceledTargets.add(load(slot, "cancel-$slot.$format", object : RequestListener<Bitmap> {
            override fun onLoadFailed(error: GlideException?, model: Any?, target: Target<Bitmap>, first: Boolean): Boolean { canceledCallbacks.incrementAndGet(); return false }
            override fun onResourceReady(resource: Bitmap, model: Any, target: Target<Bitmap>?, source: DataSource, first: Boolean): Boolean { canceledCallbacks.incrementAndGet(); return false }
          }))
        }
      }
      assertTrue("all canceled requests must reach the real HTTP transport", canceledRequests.await(10, TimeUnit.SECONDS))
      instrumentation.runOnMainSync {
        canceledTargets.forEach { target ->
          val request = requireNotNull(target.request)
          Glide.with(activity).clear(target)
          assertTrue(request.isCleared)
          assertNull(target.request)
        }
        views.forEach { assertNull(it.drawable) }
      }
      releaseCanceled.countDown()
      val recovered = loadWindow("recovery")
      assertEquals("canceled listeners must not settle into reused views", 0, canceledCallbacks.get())
      assertEquals(132, server.requestCount)
      clearAndVerify(recovered)
    } finally {
      releaseCanceled.countDown()
      instrumentation.runOnMainSync {
        views.forEach { Glide.with(activity).clear(it) }
        (container?.parent as? ViewGroup)?.removeView(container)
        activity.finish()
      }
      if (serverStarted) server.shutdown()
    }
    instrumentation.waitForIdleSync()
    instrumentation.sendStatus(0, android.os.Bundle().apply {
      putString("stream", "\nHARDWARE_IMAGE_STRESS pid=${android.os.Process.myPid()} rounds=20 formats=JPEG,PNG,WebP hardwareDecoded=126 decodedReadbacks=126 pixelCopyVerified=126 recycled=126 corruptFailures=3 canceled=3 requests=132 start=[$startMemory] afterRelease=[${memory()}] sampledPssPeakKb=$peakPssKb peakWindowBitmapAllocationBytes=$peakBitmapBytes scope=hardware-bitmap-and-window-buffer hardwarePolicy=explicit-test-opt-in productDefaultHardware=not-verified physicalCodec=not-verified graphicsAccounting=process-wide\n")
    })
  }
}
