package com.wz.reader

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.content.Intent
import android.net.Uri
import android.widget.ImageView
import android.widget.LinearLayout
import android.view.ViewGroup
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.drawee.controller.BaseControllerListener
import com.facebook.drawee.view.SimpleDraweeView
import com.facebook.imagepipeline.image.ImageInfo
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.fresco.FrescoModule
import expo.modules.image.okhttp.GlideUrlWrapper
import expo.modules.image.okhttp.GlideUrlWithCustomCacheKey
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ServerSocket
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NetworkImageRuntimeInstrumentedTest {
  @Test
  fun mountedFrescoAndGlideRecoverFromStaleHttp2WithoutRestart() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val initialized = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
    while ((!FrescoModule.hasBeenInitialized() || NetworkProxyRuntime.currentLocalProxy() != null) && System.nanoTime() < initialized) Thread.sleep(100)
    assertTrue(FrescoModule.hasBeenInitialized())
    assertNull(NetworkProxyRuntime.currentLocalProxy())
    val png = ByteArrayOutputStream().also { output ->
      Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888).apply {
        eraseColor(Color.MAGENTA); compress(Bitmap.CompressFormat.PNG, 100, output); recycle()
      }
    }.toByteArray()
    try {
      for (scenario in listOf("drop", "blocked", "retired")) Http2ImageFaultFixture(blockWrites = scenario == "blocked", tls = true, imageBytes = png).use { fixture ->
        val blocked = scenario == "blocked"
        fixture.warmAndDrop()
        val generation = NetworkProxyRuntime.currentReadNetworkGeneration()
        lateinit var container: LinearLayout
        lateinit var fresco: SimpleDraweeView
        lateinit var glide: ImageView
        val done = CountDownLatch(2)
        val failures = AtomicInteger()
        val displayed = AtomicInteger()
        val start = System.nanoTime()
        try {
          instrumentation.runOnMainSync {
            container = LinearLayout(activity)
            fresco = SimpleDraweeView(activity); glide = ImageView(activity)
            container.addView(fresco, LinearLayout.LayoutParams(100, 100))
            container.addView(glide, LinearLayout.LayoutParams(100, 100))
            activity.addContentView(container, ViewGroup.LayoutParams(-1, -1))
            fresco.controller = Fresco.newDraweeControllerBuilder().setUri(Uri.parse(fixture.url("/fresco.png")))
              .setControllerListener(object : BaseControllerListener<ImageInfo>() {
                override fun onFinalImageSet(id: String?, info: ImageInfo?, animatable: android.graphics.drawable.Animatable?) { if (info != null) displayed.incrementAndGet(); done.countDown() }
                override fun onFailure(id: String?, error: Throwable?) { failures.incrementAndGet(); done.countDown() }
              }).build()
            val source: expo.modules.image.records.Source = expo.modules.image.records.SourceMap(uri = fixture.url("/glide.png"))
            val model = source.createGlideModelProvider(context)!!.getGlideModel() as GlideUrlWrapper
            Glide.with(activity).load(if (blocked) model else model.glideUrl)
              .diskCacheStrategy(com.bumptech.glide.load.engine.DiskCacheStrategy.NONE).skipMemoryCache(true)
              .listener(object : RequestListener<Drawable> {
                override fun onLoadFailed(error: GlideException?, model: Any?, target: Target<Drawable>, first: Boolean): Boolean { failures.incrementAndGet(); done.countDown(); return false }
                override fun onResourceReady(resource: Drawable, model: Any, target: Target<Drawable>?, source: DataSource, first: Boolean): Boolean { displayed.incrementAndGet(); done.countDown(); return false }
              }).into(glide)
          }
          fixture.assertWriteFaultObserved()
          if (scenario == "retired") {
            fixture.awaitStalledImages(2)
            NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
          }
          val remaining = 15_000 - TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
          assertTrue("real Fresco/Glide images must display inside 15s", remaining > 0 && done.await(remaining, TimeUnit.MILLISECONDS))
          if (scenario == "retired") {
            assertEquals("both consumers must receive a failure, not silent cancellation", 2, failures.get())
            assertEquals(0, displayed.get())
            fixture.assertNoReplay()
          } else {
            assertEquals(0, failures.get()); assertEquals(2, displayed.get())
            instrumentation.runOnMainSync { assertNotNull(glide.drawable) }
            fixture.assertFreshConnection(start)
            assertEquals("recovery must not replace the runtime", generation, NetworkProxyRuntime.currentReadNetworkGeneration())
          }
          instrumentation.sendStatus(0, android.os.Bundle().apply {
            putString("stream", "\nHTTP2_IMAGES scenario=" + scenario + " displayed=" + displayed.get() + " failures=" + failures.get() + " elapsedMs=" + TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) + "\n")
          })
        } finally {
          instrumentation.runOnMainSync { fresco.controller = null; Glide.with(activity).clear(glide); (container.parent as? ViewGroup)?.removeView(container) }
        }
      }
    } finally { instrumentation.runOnMainSync { activity.finish() } }
  }

  @Test
  fun diagnosticMarkersDoNotSplitConcurrentImageJobs() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val png = ByteArrayOutputStream().also { output ->
      Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888).apply {
        eraseColor(Color.MAGENTA); compress(Bitmap.CompressFormat.PNG, 100, output); recycle()
      }
    }.toByteArray()
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val workers = Executors.newCachedThreadPool()
    val requests = AtomicInteger()
    val decodes = AtomicInteger()
    val fixtureOption = com.bumptech.glide.load.Option.memory<Boolean>("wz.diagnostic-identity-fixture", false)
    Glide.get(context).registry.prepend(java.io.InputStream::class.java, Bitmap::class.java,
      object : com.bumptech.glide.load.ResourceDecoder<java.io.InputStream, Bitmap> {
        override fun handles(source: java.io.InputStream, options: com.bumptech.glide.load.Options) = options.get(fixtureOption) == true
        override fun decode(source: java.io.InputStream, width: Int, height: Int, options: com.bumptech.glide.load.Options): com.bumptech.glide.load.engine.Resource<Bitmap>? {
          decodes.incrementAndGet()
          val bitmap = android.graphics.BitmapFactory.decodeStream(source) ?: return null
          return com.bumptech.glide.load.resource.bitmap.BitmapResource.obtain(bitmap, Glide.get(context).bitmapPool)
        }
      })
    workers.execute {
      try {
        while (!server.isClosed) {
          val socket = server.accept()
          workers.execute {
            socket.use {
              try {
                val reader = socket.getInputStream().bufferedReader()
                while (!reader.readLine().isNullOrEmpty()) Unit
                requests.incrementAndGet()
                Thread.sleep(500) // Keep the first job in flight while the second consumer attaches.
                val header = "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: " + png.size + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
                socket.getOutputStream().apply { write(header.toByteArray()); write(png); flush() }
              } catch (_: IOException) { } catch (_: InterruptedException) { }
            }
          }
        }
      } catch (_: IOException) { }
    }
    val targets = mutableListOf<Target<Bitmap>>()
    val splitJobs = mutableListOf<String>()
    try {
      for (wrapped in listOf(false, true)) for (customCacheKey in listOf(false, true))
      for (variant in listOf("same", "referer", "epoch", "uri", "size", "transform", "cancel")) {
        val url = "http://127.0.0.1:" + server.localPort + "/identity-" + wrapped + "-" + customCacheKey + "-" + variant + ".png"
        fun model(attempt: Int): Any {
          val uri = url + if (variant == "uri" && attempt == 2) "?version=2" else ""
          val epoch = if (variant == "epoch" && attempt == 2) "42" else "41"
          val source: expo.modules.image.records.Source = expo.modules.image.records.SourceMap(uri = uri, cacheKey = if (customCacheKey) "epoch-" + epoch + ":" + uri else null,
            headers = mapOf("Referer" to if (variant == "referer" && attempt == 2) "https://media.test/other" else "https://media.test/topic", "X-WZ-Forum-Media-Identity" to "fixture:" + epoch,
              "X-WZ-Image-Trace" to "trace-" + attempt, "X-WZ-Image-Ref" to "media-" + attempt,
              "X-WZ-Image-Session" to "session-fixture-" + attempt))
          val result = source.createGlideModelProvider(context)!!.getGlideModel() as GlideUrlWrapper
          if (wrapped) result.progressListener = expo.modules.image.events.OkHttpProgressListener(
            java.lang.ref.WeakReference<expo.modules.image.ExpoImageViewWrapper>(null))
          return if (wrapped) result else result.glideUrl
        }
        val models = listOf(model(1), model(2))
        val finished = CountDownLatch(2)
        val failures = AtomicInteger()
        val resources = arrayOfNulls<Bitmap>(2)
        val requestStart = requests.get()
        val decodeStart = decodes.get()
        instrumentation.runOnMainSync {
          models.forEachIndexed { index, model ->
            val request = Glide.with(activity).asBitmap().load(model).override(if (variant == "size" && index == 1) 24 else 48, 48)
              .diskCacheStrategy(com.bumptech.glide.load.engine.DiskCacheStrategy.NONE).skipMemoryCache(true)
              .set(fixtureOption, true)
            if (variant == "transform" && index == 1) request.centerCrop()
            targets.add(request.into(object : com.bumptech.glide.request.target.CustomTarget<Bitmap>(48, 48) {
                override fun onResourceReady(resource: Bitmap, transition: com.bumptech.glide.request.transition.Transition<in Bitmap>?) {
                  resources[index] = resource; finished.countDown()
                }
                override fun onLoadFailed(errorDrawable: Drawable?) { failures.incrementAndGet(); finished.countDown() }
                override fun onLoadCleared(placeholder: Drawable?) = Unit
              }))
          }
          if (variant == "cancel") { Glide.with(activity).clear(targets[0]); finished.countDown() }
        }
        assertTrue("both image consumers must finish", finished.await(15, TimeUnit.SECONDS))
        assertEquals(0, failures.get())
        val label = "wrapped=" + wrapped + " customCacheKey=" + customCacheKey + " variant=" + variant
        instrumentation.sendStatus(0, android.os.Bundle().apply {
          putString("stream", "\nIMAGE_IDENTITY " + label + " network=" + (requests.get() - requestStart) + " decode=" + (decodes.get() - decodeStart) + " equal=" + (models[0] == models[1]) + "\n")
        })
        val shared = variant == "same" || variant == "cancel"
        val expected = if (shared) 1 else 2
        val sameModel = variant in listOf("same", "size", "transform", "cancel")
        if (requests.get() - requestStart != expected || decodes.get() - decodeStart != expected ||
          (models[0] == models[1]) != sameModel || (sameModel && models[0].hashCode() != models[1].hashCode()) ||
          (variant != "cancel" && (resources[0] === resources[1]) != shared) || resources[1] == null) {
          splitJobs.add(label + " network=" + (requests.get() - requestStart) + " decode=" + (decodes.get() - decodeStart))
        }
        instrumentation.runOnMainSync { targets.forEach { Glide.with(activity).clear(it) }; targets.clear() }
      }
      assertTrue("image jobs must share diagnostics-only changes and isolate real request changes: " + splitJobs.joinToString(), splitJobs.isEmpty())
    } finally {
      instrumentation.runOnMainSync { targets.forEach { Glide.with(activity).clear(it) }; activity.finish() }
      server.close(); workers.shutdownNow(); assertTrue(workers.awaitTermination(5, TimeUnit.SECONDS))
    }
  }

  @Test
  fun mountedImagesAndSvgRecoverAfterRuntimeRetirement() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val initializedDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
    while (!FrescoModule.hasBeenInitialized() && System.nanoTime() < initializedDeadline) Thread.sleep(100)
    assertTrue("the production RN pipeline must initialize", FrescoModule.hasBeenInitialized())
    while (NetworkProxyRuntime.currentLocalProxy() != null && System.nanoTime() < initializedDeadline) Thread.sleep(100)
    assertNull("the isolated app must finish applying its default proxy state", NetworkProxyRuntime.currentLocalProxy())
    val pipeline = Fresco.getImagePipeline()
    val png = ByteArrayOutputStream().also { output ->
      Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888).apply {
        eraseColor(Color.MAGENTA); compress(Bitmap.CompressFormat.PNG, 100, output); recycle()
      }
    }.toByteArray()
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val workers = Executors.newCachedThreadPool()
    val requests = AtomicInteger()
    val cancelRequestStarted = CountDownLatch(1)
    workers.execute {
      try {
        while (!server.isClosed) {
          val socket = server.accept()
          workers.execute {
            socket.use {
              try {
                val reader = socket.getInputStream().bufferedReader()
                val path = reader.readLine().orEmpty()
                while (!reader.readLine().isNullOrEmpty()) Unit
                requests.incrementAndGet()
                if (path.contains("slow-cancel")) cancelRequestStarted.countDown()
                if (path.contains("slow")) Thread.sleep(700)
                val svg = path.contains("svg")
                val bytes = if (svg) "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"48\" height=\"48\"><rect width=\"48\" height=\"48\" fill=\"red\"/></svg>".toByteArray() else png
                val type = if (svg) "image/svg+xml" else "image/png"
                val header = "HTTP/1.1 200 OK\r\nContent-Type: $type\r\nContent-Length: " + bytes.size + "\r\nCache-Control: max-age=3600\r\nConnection: close\r\n\r\n"
                socket.getOutputStream().apply { write(header.toByteArray()); write(bytes); flush() }
              } catch (_: IOException) { } catch (_: InterruptedException) { }
            }
          }
        }
      } catch (_: IOException) { }
    }
    val base = "http://127.0.0.1:" + server.localPort
    lateinit var container: LinearLayout
    lateinit var emoji: SimpleDraweeView
    lateinit var picture: ImageView
    lateinit var preview: ImageView
    instrumentation.runOnMainSync {
      container = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
      emoji = SimpleDraweeView(activity)
      picture = ImageView(activity)
      preview = ImageView(activity)
      container.addView(emoji, LinearLayout.LayoutParams(48, 48))
      container.addView(picture, LinearLayout.LayoutParams(180, 180))
      container.addView(preview, LinearLayout.LayoutParams(360, 360))
      activity.addContentView(container, ViewGroup.LayoutParams(-1, -1))
    }
    var imageAttempt = 0
    fun load(path: String): List<DataSource> {
      val completed = CountDownLatch(3)
      val failures = AtomicInteger()
      val cacheSources = mutableListOf<DataSource>()
      instrumentation.runOnMainSync {
        emoji.controller = Fresco.newDraweeControllerBuilder().setUri(Uri.parse(base + path + "-emoji.png"))
          .setOldController(emoji.controller).setControllerListener(object : BaseControllerListener<ImageInfo>() {
            override fun onFinalImageSet(id: String?, imageInfo: ImageInfo?, animatable: android.graphics.drawable.Animatable?) { completed.countDown() }
            override fun onFailure(id: String?, throwable: Throwable?) { failures.incrementAndGet(); completed.countDown() }
          }).build()
        for ((index, view) in listOf(picture, preview).withIndex()) {
          val url = base + path + "-" + index + ".png"
          val source: expo.modules.image.records.Source = expo.modules.image.records.SourceMap(uri = url, cacheKey = url,
            headers = mapOf("X-WZ-Image-Trace" to "trace-" + (++imageAttempt), "X-WZ-Image-Ref" to "media-91830", "X-WZ-Image-Session" to "session-test-91830"))
          val model = (source.createGlideModelProvider(context)!!.getGlideModel() as GlideUrlWrapper).glideUrl
          Glide.with(activity).load(if (index == 0) GlideUrlWrapper(model) else model)
            .listener(object : RequestListener<Drawable> {
              override fun onLoadFailed(error: GlideException?, model: Any?, target: Target<Drawable>, first: Boolean): Boolean { failures.incrementAndGet(); completed.countDown(); return false }
              override fun onResourceReady(resource: Drawable, model: Any, target: Target<Drawable>?, source: DataSource, first: Boolean): Boolean { cacheSources.add(source); completed.countDown(); return false }
            }).into(view)
        }
      }
      assertTrue("mounted image callbacks must complete", completed.await(15, TimeUnit.SECONDS))
      assertEquals(0, failures.get())
      instrumentation.runOnMainSync { assertNotNull(picture.drawable); assertNotNull(preview.drawable) }
      return cacheSources
    }
    fun rotateAndDrain() {
      val before = NetworkProxyRuntime.imageClientForTests()
      NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
      while (!before.dispatcher.executorService.isShutdown && System.nanoTime() < deadline) Thread.sleep(25)
      assertTrue("old executor must close", before.dispatcher.executorService.isShutdown)
      assertSame(pipeline, Fresco.getImagePipeline())
    }
    try {
      load("/initial")
      rotateAndDrain()
      load("/after-first")
      val cachedRequests = requests.get()
      instrumentation.runOnMainSync {
        emoji.controller = null
        Glide.with(activity).clear(picture); Glide.with(activity).clear(preview)
      }
      val remountedSources = load("/after-first")
      assertEquals("memory cache must keep its identity", cachedRequests, requests.get())
      assertEquals("new diagnostics must not turn recycled memory hits into decodes", listOf(DataSource.MEMORY_CACHE, DataSource.MEMORY_CACHE), remountedSources)
      instrumentation.runOnMainSync {
        container.removeView(emoji); container.addView(emoji, 0)
        Glide.with(activity).clear(picture); Glide.with(activity).clear(preview)
        emoji.controller = Fresco.newDraweeControllerBuilder().setUri(Uri.parse(base + "/slow-cancel.png")).build()
      }
      assertTrue(cancelRequestStarted.await(5, TimeUnit.SECONDS))
      instrumentation.runOnMainSync { emoji.controller = null }
      rotateAndDrain()
      load("/after-recycle-retry")
      for (slow in listOf(false, true)) {
        val done = CountDownLatch(1)
        val result = AtomicReference<ReadableMap>()
        val rejected = AtomicInteger()
        SvgRendererModule(BridgeReactContext(context)).fetchSvgDocument(
          base + if (slow) "/slow.svg" else "/document.svg", JavaOnlyMap(), if (slow) 50.0 else 5000.0,
          PromiseImpl({ args -> result.set(args.firstOrNull() as? ReadableMap); done.countDown() }, { _ -> rejected.incrementAndGet(); done.countDown() }))
        assertTrue(done.await(10, TimeUnit.SECONDS))
        if (slow) assertEquals(1, rejected.get()) else { assertEquals(0, rejected.get()); assertNotNull(result.get()?.getString("base64")) }
      }
      rotateAndDrain()
    } finally {
      instrumentation.runOnMainSync { Glide.with(activity).clear(picture); Glide.with(activity).clear(preview); emoji.controller = null; (container.parent as? ViewGroup)?.removeView(container); activity.finish() }
      server.close(); workers.shutdownNow(); assertTrue(workers.awaitTermination(5, TimeUnit.SECONDS))
    }
  }
}
