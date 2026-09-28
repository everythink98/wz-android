package com.wz.reader

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.facebook.react.modules.fresco.FrescoModule
import expo.modules.image.okhttp.GlideUrlWrapper
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NetworkImagePressureInstrumentedTest {
  @Test
  fun largeDecodedImagesRemainCorrectAcrossTwentyRecycledWindows() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val views = mutableListOf<ImageView>()
    var container: LinearLayout? = null
    var startPss = 0L
    var peakPss = 0L
    var peakBitmapBytes = 0
    try {
      awaitImageRuntimeProof(instrumentation, activity)
      val initialized = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
      while ((!FrescoModule.hasBeenInitialized() || NetworkProxyRuntime.currentLocalProxy() != null) && System.nanoTime() < initialized) Thread.sleep(100)
      assertTrue(FrescoModule.hasBeenInitialized()); assertNull(NetworkProxyRuntime.currentLocalProxy())
      val png = ByteArrayOutputStream().also { output ->
        val bitmap = Bitmap.createBitmap(4096, 2048, Bitmap.Config.ARGB_8888)
        try { bitmap.eraseColor(Color.MAGENTA); assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) }
        finally { bitmap.recycle() }
      }.toByteArray()
      okhttp3.mockwebserver.MockWebServer().use { server ->
        server.start(InetAddress.getByName("127.0.0.1"), 0)
        val base = "http://127.0.0.1:${server.port}"
        instrumentation.runOnMainSync {
          container = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
          repeat(8) { slot ->
            val view = ImageView(activity)
            views.add(view)
            container!!.addView(view, LinearLayout.LayoutParams(if (slot == 0) 400 else 128, if (slot == 0) 200 else 64))
          }
          activity.addContentView(container, ViewGroup.LayoutParams(-1, -1))
        }
        startPss = android.os.Debug.getPss()
        peakPss = startPss
        // Native Expo model/Glide software decode working set; not App frame-time evidence.
        repeat(20) { round ->
          repeat(8) {
            server.enqueue(okhttp3.mockwebserver.MockResponse().setHeader("Content-Type", "image/png")
              .setHeader("Cache-Control", "no-store").setBody(okio.Buffer().write(png)))
          }
          val completed = CountDownLatch(8)
          val displayed = AtomicInteger()
          val failures = AtomicInteger()
          val invalid = AtomicReference<String>()
          val bitmapBytes = AtomicInteger()
          val started = System.nanoTime()
          instrumentation.runOnMainSync {
            views.forEach { Glide.with(activity).clear(it) }
            views.forEachIndexed { slot, view ->
              val width = if (slot == 0) 2048 else 512
              val height = width / 2
              val source: expo.modules.image.records.Source = expo.modules.image.records.SourceMap(
                uri = "$base/large-$round-$slot.png")
              val model = source.createGlideModelProvider(context)!!.getGlideModel() as GlideUrlWrapper
              Glide.with(activity).asBitmap().load(model).override(width, height).disallowHardwareConfig()
                .diskCacheStrategy(com.bumptech.glide.load.engine.DiskCacheStrategy.NONE).skipMemoryCache(true)
                .listener(object : RequestListener<Bitmap> {
                  override fun onLoadFailed(error: GlideException?, model: Any?, target: Target<Bitmap>, first: Boolean): Boolean {
                    failures.incrementAndGet(); completed.countDown(); return false
                  }
                  override fun onResourceReady(resource: Bitmap, model: Any, target: Target<Bitmap>?, source: DataSource, first: Boolean): Boolean {
                    if (resource.width != width || resource.height != height || resource.getPixel(width / 2, height / 2) != Color.MAGENTA)
                      invalid.compareAndSet(null, "round=$round slot=$slot size=${resource.width}x${resource.height}")
                    bitmapBytes.addAndGet(resource.allocationByteCount)
                    displayed.incrementAndGet(); completed.countDown(); return false
                  }
                }).into(view)
            }
          }
          assertTrue("large-image callbacks must settle", completed.await(60, TimeUnit.SECONDS))
          assertEquals(0, failures.get()); assertEquals(8, displayed.get()); assertNull(invalid.get())
          instrumentation.runOnMainSync { views.forEach { assertNotNull(it.drawable) } }
          val elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
          val pss = android.os.Debug.getPss()
          peakPss = maxOf(peakPss, pss); peakBitmapBytes = maxOf(peakBitmapBytes, bitmapBytes.get())
          assertEquals((round + 1) * 8, server.requestCount)
          instrumentation.sendStatus(0, android.os.Bundle().apply {
            putString("stream", "\nLARGE_IMAGE_WINDOW round=$round displayed=${displayed.get()} elapsedMs=$elapsedMs bitmapAllocationBytes=${bitmapBytes.get()} pssKb=$pss requests=${server.requestCount}\n")
          })
        }
        assertEquals(160, server.requestCount)
      }
    } finally {
      instrumentation.runOnMainSync {
        views.forEach { Glide.with(activity).clear(it) }
        (container?.parent as? ViewGroup)?.removeView(container)
        activity.finish()
      }
    }
    instrumentation.waitForIdleSync()
    instrumentation.sendStatus(0, android.os.Bundle().apply {
      putString("stream", "\nLARGE_IMAGE_STRESS pid=${android.os.Process.myPid()} rounds=20 decoded=160 source=4096x2048 preview=2048x1024 body=512x256 softwareBitmap=true pssStartKb=$startPss sampledPssPeakKb=$peakPss pssAfterReleaseKb=${android.os.Debug.getPss()} peakWindowBitmapAllocationBytes=$peakBitmapBytes\n")
    })
  }

}
