package com.wz.reader

import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.reactnativecommunity.webview.RNCWebView
import com.reactnativecommunity.webview.RNCWebViewClient
import java.io.ByteArrayInputStream
import java.lang.reflect.Proxy
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Executes the production export in Chromium and observes RNC's real native message bridge only. */
@RunWith(AndroidJUnit4::class)
class NodeSeekBrowserScriptInstrumentedTest {
  @Test
  fun currentScriptKeepsStrongChallengesSeparateFromGuestAndJson() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val arguments = InstrumentationRegistry.getArguments()
    val mode = arguments.getString("nodeSeekBrowserScriptMode")
    assumeTrue("NodeSeek browser-script proof was not requested", mode != null)
    assertEquals("strong-challenge-v1", mode)
    val expectedHash = arguments.getString("nodeSeekBrowserScriptSha256")
    assertTrue("Pass the newly prepared script SHA", expectedHash?.matches(Regex("[a-f0-9]{64}")) == true)
    val scriptBytes = instrumentation.context.assets.open("nodeseek-browser-script/production-script.js").use { it.readBytes() }
    val manifestBytes = instrumentation.context.assets.open("nodeseek-browser-script/manifest.json").use { it.readBytes() }
    val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
    val scriptHash = sha256(scriptBytes)
    assertEquals(expectedHash, scriptHash)
    assertEquals(scriptHash, manifest.getString("scriptSha256"))
    assertEquals(1, manifest.getInt("schemaVersion"))
    assertEquals(mode, manifest.getString("mode"))
    assertEquals("src/features/account/useHiddenBrowserFetchController.ts", manifest.getString("sourceEntry"))
    val template = scriptBytes.toString(Charsets.UTF_8)
    assertTrue(template.contains("__NODESEEK_BROWSER_FETCH_ID__"))
    assertTrue(template.contains("__NODESEEK_BROWSER_FETCH_OWNER__"))
    val results = JSONArray()
    for ((index, fixture) in fixtures.withIndex()) {
      val id = 4200 + index
      val script = template.replace("__NODESEEK_BROWSER_FETCH_ID__", id.toString())
        .replace("__NODESEEK_BROWSER_FETCH_OWNER__", JSONObject.quote(fixture.owner))
      val loaded = CountDownLatch(1)
      val received = CountDownLatch(1)
      val messages = CopyOnWriteArrayList<Message>()
      val failure = AtomicReference<Throwable?>(null)
      val blockedResources = AtomicInteger()
      val url = "https://www.nodeseek.com/browser-script-proof/" + fixture.name
      lateinit var view: RNCWebView
      instrumentation.runOnMainSync {
        val context = object : BridgeReactContext(instrumentation.targetContext) {
          override fun <T : JavaScriptModule> getJSModule(type: Class<T>): T =
            type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, method, args ->
              if (method.name == "onMessage") {
                try {
                  val event = requireNotNull((args?.get(0) as? ReadableMap)?.getMap("nativeEvent"))
                  messages.add(Message(JSONObject(requireNotNull(event.getString("data"))), requireNotNull(event.getString("url"))))
                } catch (error: Throwable) {
                  failure.compareAndSet(null, error)
                } finally {
                  received.countDown()
                }
              }
              null
            })
        }
        view = object : RNCWebView(ThemedReactContext(context, instrumentation.targetContext, "browser-script-proof", -1)) {
          // The unattached fixture still dispatches the unmodified RNC bridge on the main Looper.
          override fun post(action: Runnable): Boolean = Handler(Looper.getMainLooper()).post(action)
        }
        view.settings.javaScriptEnabled = true
        view.settings.blockNetworkLoads = true
        view.settings.blockNetworkImage = true
        view.setMessagingEnabled(true)
        view.webViewClient = object : RNCWebViewClient() {
          override fun onPageStarted(view: WebView, target: String, icon: Bitmap?) = Unit
          override fun doUpdateVisitedHistory(view: WebView, target: String, reload: Boolean) = Unit
          override fun shouldOverrideUrlLoading(view: WebView, target: String) = true

          // Only this synthetic document is loaded; do not call the Cookie-reading superclass callback.
          override fun onPageFinished(view: WebView, target: String) {
            if (target == url) loaded.countDown()
          }

          override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
            blockedResources.incrementAndGet()
            return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
          }

          override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
              failure.compareAndSet(null, AssertionError("Synthetic document load failed: " + error.errorCode))
              loaded.countDown()
              received.countDown()
            }
          }

          override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            failure.compareAndSet(null, AssertionError("Synthetic WebView renderer stopped"))
            loaded.countDown()
            received.countDown()
            return true
          }
        }
        view.loadDataWithBaseURL(url, fixture.document(), "text/html", "UTF-8", null)
      }
      try {
        assertTrue(fixture.name + ": document did not load", loaded.await(10, TimeUnit.SECONDS))
        failure.get()?.let { throw AssertionError(fixture.name + ": load callback failed", it) }
        instrumentation.runOnMainSync {
          view.evaluateJavascript(script, null)
          view.evaluateJavascript(script, null)
        }
        assertTrue(fixture.name + ": no RNC bridge message", received.await(10, TimeUnit.SECONDS))
        SystemClock.sleep(600)
        failure.get()?.let { throw AssertionError(fixture.name + ": bridge callback failed", it) }
        assertEquals(fixture.name + ": duplicate settlement", 1, messages.size)
        val message = messages.single()
        assertEquals("https", URI(message.origin).scheme)
        assertEquals("www.nodeseek.com", URI(message.origin).host)
        val payload = message.payload
        assertEquals("nodeseek-browser-fetch", payload.getString("type"))
        assertEquals(id, payload.getInt("id"))
        assertEquals(url, payload.getString("url"))
        assertFalse(fixture.name + ": script returned error", payload.has("error"))
        assertEquals(fixture.outcome == Outcome.CHALLENGE, payload.getBoolean("challenge"))
        val html = payload.getString("html")
        when (fixture.outcome) {
          Outcome.CHALLENGE -> assertEquals("", html)
          Outcome.ANONYMOUS -> {
            assertTrue(html.contains("nodeseekAccountState"))
            assertTrue(html.contains("anonymous"))
            assertFalse(html.contains("Public topic"))
          }
          Outcome.JSON -> assertEquals(JSON_BODY, html)
        }
        results.put(JSONObject().put("fixture", fixture.name).put("owner", fixture.owner)
          .put("outcome", fixture.outcome.name).put("messages", messages.size)
          .put("blockedResources", blockedResources.get()))
      } finally {
        instrumentation.runOnMainSync { view.stopLoading(); view.destroy() }
      }
    }
    assertEquals(6, results.length())
    instrumentation.sendStatus(0, Bundle().apply {
      putString("stream", "\nNODESEEK_BROWSER_SCRIPT " + JSONObject()
        .put("mode", mode).put("cases", results).put("scriptSha256", scriptHash)
        .put("manifestSha256", sha256(manifestBytes)).put("sourceSha256", manifest.getString("sourceSha256"))
        .put("scope", "actual-webview-script-to-native-payload").toString() + "\n")
    })
  }

  private enum class Outcome { CHALLENGE, ANONYMOUS, JSON }
  private data class Message(val payload: JSONObject, val origin: String)
  private data class Fixture(
    val name: String,
    val owner: String,
    val title: String,
    val body: String,
    val outcome: Outcome
  ) {
    fun document() = "<!doctype html><html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'\">" +
      "<title>" + title + "</title><script>window.__config__={user:null};</script></head><body>" +
      body + "</body></html>"
  }

  private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }

  companion object {
    private const val PUBLIC = "<ul class=\"post-list\"><li class=\"post-list-item\">Public topic</li></ul>"
    private const val JSON_BODY = "{\"fixture\":\"Just a moment cf-turnstile challenge-platform\",\"user\":null}"
    private val fixtures = listOf(
      Fixture("title-public-null", "account", "Just a moment...", PUBLIC, Outcome.CHALLENGE),
      Fixture("turnstile-public-null", "account", "", "<div class=\"cf-turnstile\"></div>" + PUBLIC, Outcome.CHALLENGE),
      Fixture("title-overview-null", "account-overview", "Just a moment...", "<main>Checking this request</main>", Outcome.CHALLENGE),
      Fixture("legitimate-guest-null", "account", "", PUBLIC, Outcome.ANONYMOUS),
      Fixture("guest-jsd-null", "account", "",
        "<script src=\"/cdn-cgi/challenge-platform/scripts/jsd/main.js\"></script>" + PUBLIC, Outcome.ANONYMOUS),
      Fixture("json-over-title", "account", "Just a moment...", "<pre>" + JSON_BODY + "</pre>", Outcome.JSON)
    )
  }
}

