package com.wz.reader

import android.webkit.CookieManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

// Only run in WZ_ImageRuntime_Test_API35. All credentials below belong to synthetic origins.
@RunWith(AndroidJUnit4::class)
class ManagedCookieResponsesInstrumentedTest {
  @Test fun observeWebViewTerminalCookieBeforeProcessExit() {
    val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
    val mode = androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("webViewCookieMode")
    org.junit.Assume.assumeTrue(mode in listOf("complete", "error", "cancel"))
    val context = instrumentation.targetContext
    val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 10000 }
    val url = "http://127.0.0.1:${server.localPort}/webview-cookie-$mode"
    val worker = Executors.newSingleThreadExecutor()
    val finish = java.util.concurrent.CountDownLatch(1)
    val releaseBody = java.util.concurrent.CountDownLatch(1)
    val receivedError = java.util.concurrent.atomic.AtomicBoolean(false)
    apply(url, "webview_$mode=A; Max-Age=3600; Path=/; HttpOnly")
    cookies.flush()
    val served = worker.submit {
      server.accept().use { socket ->
        socket.soTimeout = 10000
        val input = socket.getInputStream().bufferedReader()
        while (!input.readLine().isNullOrEmpty()) Unit
        val response = "HTTP/1.1 200 OK\r\nSet-Cookie: webview_$mode=B; Max-Age=3600; Path=/; HttpOnly\r\n" +
          "Content-Type: text/html\r\nContent-Length: ${if (mode == "complete") 2 else 100000}\r\nConnection: close\r\n\r\n{}"
        socket.getOutputStream().write(response.toByteArray()); socket.getOutputStream().flush()
        if (mode != "complete") releaseBody.await(10, TimeUnit.SECONDS)
      }
    }
    lateinit var webView: android.webkit.WebView
    instrumentation.runOnMainSync {
      // Only the unrelated React message transport is stubbed; CookieManager, HTTP,
      // the installed RNCWebView client and its destruction path remain real.
      val reactContext = object : com.facebook.react.bridge.BridgeReactContext(context) {
        override fun <T : com.facebook.react.bridge.JavaScriptModule> getJSModule(type: Class<T>): T =
          type.cast(java.lang.reflect.Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, _, _ -> null })
      }
      webView = com.reactnativecommunity.webview.RNCWebView(
        com.facebook.react.uimanager.ThemedReactContext(reactContext, context, "cookie-proof", -1))
      webView.webViewClient = object : com.reactnativecommunity.webview.RNCWebViewClient() {
        // Exercise the installed client's real Cookie flush, without a React event target.
        init { mLastLoadFailed = true }
        override fun onPageStarted(view: android.webkit.WebView, target: String, icon: android.graphics.Bitmap?) = Unit
        override fun doUpdateVisitedHistory(view: android.webkit.WebView, target: String, reload: Boolean) = Unit
        override fun shouldOverrideUrlLoading(view: android.webkit.WebView, target: String) = false
        override fun onPageFinished(view: android.webkit.WebView, target: String) {
          super.onPageFinished(view, target)
          finish.countDown()
        }
        override fun onReceivedError(view: android.webkit.WebView, code: Int, description: String, target: String) {
          // JS error teardown is asynchronous, after the native callback returns.
          receivedError.set(true)
          view.post { view.stopLoading(); view.destroy(); finish.countDown() }
        }
      }
      webView.loadUrl(url)
    }
    try {
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
      while (!cookies.getCookie(url).orEmpty().contains("webview_$mode=B") && System.nanoTime() < deadline) Thread.sleep(20)
      assertTrue("the WebView must receive the response cookie", cookies.getCookie(url).orEmpty().contains("webview_$mode=B"))
      if (mode == "error") releaseBody.countDown()
      if (mode != "cancel") assertTrue("WebView terminal callback", finish.await(10, TimeUnit.SECONDS))
      if (mode == "cancel") assertEquals("cancel before load completion", 1L, finish.count)
      if (mode == "error") assertTrue("actual network error callback", receivedError.get())
      instrumentation.runOnMainSync { webView.stopLoading(); webView.destroy() }
      assertTrue(context.getSharedPreferences("webview-cookie-proof", 0).edit()
        .putInt("pid", android.os.Process.myPid()).putString("mode", mode).commit())
    } finally {
      releaseBody.countDown(); server.close(); served.get(15, TimeUnit.SECONDS); worker.shutdownNow()
    }
  }

  @Test fun observeWebViewTerminalCookieAfterProcessRestart() {
    val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
    val mode = androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("webViewCookieMode")
    org.junit.Assume.assumeTrue(mode in listOf("complete", "error", "cancel"))
    val preferences = instrumentation.targetContext.getSharedPreferences("webview-cookie-proof", 0)
    assertEquals(mode, preferences.getString("mode", null))
    assertNotEquals(preferences.getInt("pid", -1), android.os.Process.myPid())
    try {
      assertTrue("$mode WebView cookie must persist after the installed WebView is destroyed",
        cookies.getCookie("http://127.0.0.1/").orEmpty().contains("webview_$mode=B"))
    } finally {
      apply("http://127.0.0.1/", "webview_$mode=; Max-Age=0; Path=/")
      cookies.flush(); preferences.edit().clear().commit()
    }
  }

  private fun journalSnapshot(): String {
    val done = java.util.concurrent.CountDownLatch(1)
    val result = java.util.concurrent.atomic.AtomicReference("")
    DiagnosticJournal.snapshot { result.set(it.toString()); done.countDown() }
    assertTrue(done.await(5, TimeUnit.SECONDS))
    return result.get()
  }
  @Test fun persistRenewalBeforeProcessExit() {
    org.junit.Assume.assumeTrue(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("cookieProofStage") == "write")
    val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
    val url = "http://127.0.0.1/session"
    apply(url, "_t=fixture-A; Max-Age=3600; Path=/; HttpOnly")
    val store = ManagedCookieResponses({ cookies.getCookie(it) }, ::writePlatformCookieResponses,
      { ReadNetworkDiagnostics.record(it) }, flusher = { cookies.flush() })
    store.within {
      store.observed(url, "linuxdo", cookies.getCookie(url))
      store.receive(Response.Builder().request(Request.Builder().url(url).build())
        .protocol(Protocol.HTTP_1_1).code(200).message("fixture")
        .addHeader("Set-Cookie", "_t=fixture-B; Max-Age=3600; Path=/; HttpOnly")
        .addHeader("Set-Cookie", "_forum_session=fixture-session; Path=/; HttpOnly").build())
    }
    assertEquals("fixture-B", loginCookieValue(cookies.getCookie(url)))
    assertTrue(context.getSharedPreferences("cookie-process-proof", 0).edit()
      .putInt("pid", android.os.Process.myPid()).commit())
    DiagnosticJournal.recordNetwork(System.currentTimeMillis(), mapOf("operation" to "cookie-response",
      "phase" to "finish", "source" to "linuxdo", "cookieKind" to "login", "cookieAction" to "delete",
      "cookieResult" to "epoch_changed", "cookieEpoch" to 987654,
      "cookie" to "PRIVATE_COOKIE_PROOF", "cookieHash" to "PRIVATE_COOKIE_PROOF"))
    val journal = journalSnapshot()
    assertTrue(journal.contains("persisted"))
    assertTrue(journal.contains("persistent"))
  }

  @Test fun restartedProcessAuthenticatesWithPersistedRenewal() {
    org.junit.Assume.assumeTrue(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("cookieProofStage") == "read")
    val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
    val previousPid = context.getSharedPreferences("cookie-process-proof", 0).getInt("pid", -1)
    assertTrue(previousPid > 0)
    assertNotEquals(previousPid, android.os.Process.myPid())
    androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendStatus(0, android.os.Bundle().apply {
      putInt("cookieProofPreviousPid", previousPid)
      putInt("cookieProofCurrentPid", android.os.Process.myPid())
      putBoolean("sessionCookieRetained", cookies.getCookie("http://127.0.0.1/").orEmpty().contains("_forum_session="))
    })
    val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 10000 }
    val worker = Executors.newSingleThreadExecutor()
    val served = worker.submit {
      server.accept().use { socket ->
        socket.soTimeout = 10000
        val input = socket.getInputStream().bufferedReader()
        var cookie: String? = null
        while (true) {
          val line = input.readLine() ?: break
          if (line.isEmpty()) break
          if (line.startsWith("Cookie:", true)) cookie = line.substringAfter(':').trim()
        }
        val status = if (loginCookieValue(cookie) == "fixture-B") "200 OK" else "401 Unauthorized"
        socket.getOutputStream().write("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
      }
    }
    val store = ManagedCookieResponses({ cookies.getCookie(it) }, ::writePlatformCookieResponses, flusher = { cookies.flush() })
    val client = OkHttpClient.Builder().cookieJar(JavaNetCookieJar(ReadOnlyWebViewCookieHandler(store, { "linuxdo" }) { cookies.getCookie(it) }))
      .addInterceptor(CookieResponseContextInterceptor(store)).addNetworkInterceptor(CookieResponseInterceptor(store)).build()
    try {
      client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/session").build())
        .execute().use { assertEquals(200, it.code) }
      served.get(10, TimeUnit.SECONDS)
      val journal = journalSnapshot()
      assertTrue(journal.contains("987654"))
      assertTrue(journal.contains("epoch_changed"))
      assertFalse(journal.contains("PRIVATE_COOKIE_PROOF"))
    } finally {
      server.close(); worker.shutdownNow()
      client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
      apply("http://127.0.0.1/", "_t=; Max-Age=0; Path=/", "_forum_session=; Max-Age=0; Path=/")
      cookies.flush()
      context.getSharedPreferences("cookie-process-proof", 0).edit().clear().commit()
    }
  }

  private val cookies get() = CookieManager.getInstance()
  private fun apply(url: String, vararg values: String) {
    val batch = writePlatformCookieResponses(url, values.toList())
    assertTrue("platform callbacks must settle", batch.await(5000))
    assertTrue("platform must accept fixture cookies", batch.successful.get())
  }

  @Test fun actualHttpUpdatesAndDeletionSurviveCancellationInThePlatformCookieStore() {
    for (cancel in listOf(false, true)) for (delete in listOf(false, true)) verifyHttpUpdate(cancel, delete)
  }

  private fun verifyHttpUpdate(cancel: Boolean, delete: Boolean) {
    val name = "rotation_${System.nanoTime()}"
    val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    server.soTimeout = 10000
    val url = "http://127.0.0.1:${server.localPort}/session"
    val worker = Executors.newSingleThreadExecutor()
    val requests = worker.submit<List<String?>> {
      (0..1).map { index ->
        server.accept().use { socket ->
          val input = socket.getInputStream().bufferedReader()
          input.readLine()
          var cookie: String? = null
          while (true) {
            val line = input.readLine() ?: break
            if (line.isEmpty()) break
            if (line.startsWith("Cookie:", true)) cookie = line.substringAfter(':').trim()
          }
          val ok = index == 0 || if (delete) !cookie.orEmpty().contains("$name=")
            else cookie.orEmpty().split("; ").contains("$name=B")
          val status = if (ok) "200 OK" else "401 Unauthorized"
          val value = if (delete) "$name=; Max-Age=0" else "$name=B; Max-Age=3600"
          val update = if (index == 0) "Set-Cookie: $value; Path=/; HttpOnly; SameSite=Lax\r\n" else ""
          socket.getOutputStream().write(("HTTP/1.1 $status\r\n${update}Content-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
          cookie
        }
      }
    }
    val store = ManagedCookieResponses({ cookies.getCookie(it) }, ::writePlatformCookieResponses, flusher = { cookies.flush() })
    val handler = ReadOnlyWebViewCookieHandler(store, sourceForUri = { "linuxdo" }) { cookies.getCookie(it) }
    val cancelNext = java.util.concurrent.atomic.AtomicBoolean(cancel)
    val client = OkHttpClient.Builder().cookieJar(JavaNetCookieJar(handler))
      .addInterceptor(CookieResponseContextInterceptor(store))
      .addNetworkInterceptor(CookieResponseInterceptor(store))
      .addNetworkInterceptor { chain ->
        val response = chain.proceed(chain.request())
        if (cancelNext.getAndSet(false)) chain.call().cancel()
        response
      }.build()
    try {
      apply(url, "$name=A; Path=/; HttpOnly")
      val request = Request.Builder().url(url).build()
      if (cancel) runCatching { client.newCall(request).execute().close() }
      else client.newCall(request).execute().use { assertEquals(200, it.code) }
      client.newCall(request).execute().use { assertEquals(200, it.code) }
      val seen = requests.get(10, TimeUnit.SECONDS)
      assertTrue(seen[0].orEmpty().contains("$name=A"))
      assertEquals(!delete, seen[1].orEmpty().contains("$name=B"))
      assertFalse(seen[1].orEmpty().contains("$name=A"))
    } finally {
      server.close(); worker.shutdownNow()
      client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
      apply(url, "$name=; Max-Age=0; Path=/")
    }
  }

  @Test fun rawResponseAttributesAndExpiryFollowAndroidRules() {
    val url = "https://cookie-response.invalid/"
    val other = "https://other-cookie-response.invalid/"
    val name = "attributes_${System.nanoTime()}"
    val store = ManagedCookieResponses({ cookies.getCookie(it) }, ::writePlatformCookieResponses, flusher = { cookies.flush() })
    fun receive(vararg values: String, status: Int = 403) = store.within {
      store.observed(url, "linuxdo", cookies.getCookie(url))
      store.receive(Response.Builder().request(Request.Builder().url(url).build())
        .protocol(Protocol.HTTP_1_1).code(status).message("fixture")
        .apply { values.forEach { addHeader("Set-Cookie", it) } }.build())
    }
    try {
      apply(other, "$name=other; Path=/")
      receive("$name=root; Path=/; Secure; HttpOnly; SameSite=None",
        "$name=private; Domain=cookie-response.invalid; Path=/private; Secure; SameSite=Lax")
      assertTrue(cookies.getCookie(url).orEmpty().contains("$name=root"))
      assertFalse(cookies.getCookie(url).orEmpty().contains("$name=private"))
      assertTrue(cookies.getCookie("https://sub.cookie-response.invalid/private/").orEmpty().contains("$name=private"))
      assertFalse(cookies.getCookie("http://cookie-response.invalid/").orEmpty().contains("$name="))
      receive(status = 401)
      assertTrue(cookies.getCookie(url).orEmpty().contains("$name=root"))
      receive("$name=; Max-Age=0; Path=/; Secure; HttpOnly")
      assertFalse(cookies.getCookie(url).orEmpty().contains("$name="))
      assertTrue(cookies.getCookie("${url}private/").orEmpty().contains("$name=private"))
      assertTrue(cookies.getCookie(other).orEmpty().contains("$name=other"))
    } finally {
      apply(url, "$name=; Max-Age=0; Path=/; Secure", "$name=; Max-Age=0; Domain=cookie-response.invalid; Path=/private; Secure")
      apply(other, "$name=; Max-Age=0; Path=/")
    }
  }
}
