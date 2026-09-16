package com.wz.reader

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import com.caverock.androidsvg.SVG
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SvgRendererInstrumentedTest {
  private val instrumentation
    get() = InstrumentationRegistry.getInstrumentation()

  private fun fixture(): String =
    instrumentation.context.assets.open("svg_renderer/complex-svg-document.svg")
      .bufferedReader()
      .use { it.readText() }

  private class PendingPoster {
    val settled = CountDownLatch(1)
    var result: ReadableMap? = null
    var failure: AssertionError? = null
  }

  private fun enqueuePoster(svg: String, cacheKey: String): PendingPoster {
    val pending = PendingPoster()
    val promise = PromiseImpl(
      { arguments ->
        pending.result = arguments.firstOrNull() as? ReadableMap
        pending.settled.countDown()
      },
      { arguments ->
        pending.failure = AssertionError("SVG poster rejected: " + arguments.joinToString())
        pending.settled.countDown()
      }
    )
    enqueueSvgPosterForTest(
      instrumentation.targetContext,
      Base64.encodeToString(svg.toByteArray(Charsets.UTF_8), Base64.NO_WRAP),
      cacheKey,
      promise
    )
    return pending
  }

  private fun awaitPoster(pending: PendingPoster): ReadableMap {
    assertTrue("SVG poster did not settle", pending.settled.await(35, TimeUnit.SECONDS))
    pending.failure?.let { throw it }
    return checkNotNull(pending.result)
  }

  private fun hasRetainedRenderer(): Boolean {
    var retained = true
    instrumentation.runOnMainSync {
      retained = hasRetainedSvgPosterWebView()
    }
    return retained
  }

  private fun draw(view: WebView, width: Int, height: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    instrumentation.runOnMainSync { view.draw(Canvas(bitmap)) }
    return bitmap
  }

  @Test
  fun currentAndroidSvgFailsButChromiumPosterIsNonEmptyAndReleasesAfterQueuedWork() {
    val svg = fixture()
    val legacyBitmap = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888)
    var legacyFailure: Throwable? = null
    try {
      SVG.getFromString(svg).renderToCanvas(Canvas(legacyBitmap))
    } catch (error: Throwable) {
      legacyFailure = error
    } finally {
      legacyBitmap.recycle()
    }
    assertTrue("fixture must preserve the AndroidSVG 1.4 failure", legacyFailure is NullPointerException)

    val creationsBefore = svgPosterWebViewCreationCount()
    val destructionsBefore = svgPosterWebViewDestructionCount()
    val nonce = System.nanoTime().toString()
    val pending = (0 until 10).map { index ->
      enqueuePoster(svg, "instrumented-" + nonce + "-" + index)
    }
    val posters = pending.map(::awaitPoster)
    assertEquals(
      "poster queue must reuse one WebView while work remains",
      1,
      svgPosterWebViewCreationCount() - creationsBefore
    )
    assertEquals(
      "idle poster renderer must destroy its WebView",
      1,
      svgPosterWebViewDestructionCount() - destructionsBefore
    )
    assertFalse("idle poster renderer must not retain its WebView", hasRetainedRenderer())
    val creationsAfterBatch = svgPosterWebViewCreationCount()
    val destructionsAfterBatch = svgPosterWebViewDestructionCount()
    awaitPoster(enqueuePoster(svg, "instrumented-" + nonce + "-0"))
    assertEquals("poster cache hit must not create a WebView", creationsAfterBatch, svgPosterWebViewCreationCount())
    assertEquals("poster cache hit must not destroy a WebView", destructionsAfterBatch, svgPosterWebViewDestructionCount())
    assertFalse("poster cache hit must not retain a WebView", hasRetainedRenderer())
    posters.forEach { poster ->
      val bitmap = checkNotNull(BitmapFactory.decodeFile(checkNotNull(Uri.parse(poster.getString("uri")).path)))
      try {
        assertEquals(poster.getInt("width"), bitmap.width)
        assertEquals(poster.getInt("height"), bitmap.height)
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        assertTrue("Chromium poster must contain visible pixels", pixels.any { Color.alpha(it) != 0 })
      } finally {
        bitmap.recycle()
      }
    }
  }

  @Test
  fun dynamicSvgAdvancesFramesWithoutExternalNetwork() {
    ServerSocket(0).use { server ->
      server.soTimeout = 500
      val externalUrl = "http://127.0.0.1:" + server.localPort + "/blocked.png"
      val svg = fixture().replace(
        "</svg>",
        "<image href=\"" + externalUrl + "\" width=\"1\" height=\"1\" />" +
          "<script>fetch('" + externalUrl + "')</script></svg>"
      )
      val html = buildSvgPosterHtml(
        Base64.encodeToString(svg.toByteArray(Charsets.UTF_8), Base64.NO_WRAP),
        320,
        180
      )
      val ready = CountDownLatch(1)
      lateinit var view: WebView
      instrumentation.runOnMainSync {
        view = WebView(instrumentation.targetContext).apply {
          settings.javaScriptEnabled = false
          settings.allowFileAccess = false
          settings.allowContentAccess = false
          settings.blockNetworkLoads = true
          settings.blockNetworkImage = true
          webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
              view.postVisualStateCallback(1L, object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                  ready.countDown()
                }
              })
            }
          }
          val widthSpec = View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY)
          val heightSpec = View.MeasureSpec.makeMeasureSpec(180, View.MeasureSpec.EXACTLY)
          measure(widthSpec, heightSpec)
          layout(0, 0, 320, 180)
          loadDataWithBaseURL("https://svg-renderer.invalid/test/", html, "text/html", "UTF-8", null)
        }
      }
      assertTrue("dynamic SVG did not reach a visual state", ready.await(10, TimeUnit.SECONDS))
      Thread.sleep(180)
      val first = draw(view, 320, 180)
      Thread.sleep(300)
      val second = draw(view, 320, 180)
      try {
        val firstPixels = IntArray(320 * 180)
        val secondPixels = IntArray(320 * 180)
        first.getPixels(firstPixels, 0, 320, 0, 0, 320, 180)
        second.getPixels(secondPixels, 0, 320, 0, 0, 320, 180)
        assertTrue("SMIL animation must change pixels", firstPixels.indices.any { firstPixels[it] != secondPixels[it] })
      } finally {
        first.recycle()
        second.recycle()
        instrumentation.runOnMainSync { view.destroy() }
      }
      try {
        server.accept().close()
        fail("untrusted SVG made an external request")
      } catch (_: SocketTimeoutException) {
        Unit
      }
    }
  }
}
