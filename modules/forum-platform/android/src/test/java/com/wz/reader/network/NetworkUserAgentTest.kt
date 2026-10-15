package com.wz.reader

import android.content.Context
import android.os.Looper
import android.webkit.WebSettings
import com.bumptech.glide.Priority
import com.bumptech.glide.load.Options
import com.bumptech.glide.load.data.DataFetcher
import com.bumptech.glide.load.model.LazyHeaders
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import expo.modules.image.okhttp.GlideUrlWrapper
import expo.modules.image.records.SourceMap
import java.io.IOException
import java.io.InputStream
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, shadows = [NetworkUserAgentTest.UserAgentSettings::class])
@LooperMode(LooperMode.Mode.PAUSED)
class NetworkUserAgentTest {
  private var previousHttpAgent: String? = null

  @Before fun setUp() {
    previousHttpAgent = System.getProperty("http.agent")
    System.setProperty("http.agent", SYSTEM_IDENTITY)
    UserAgentSettings.calls.set(0)
    UserAgentSettings.failure = null
    UserAgentSettings.value = "provider identity"
    ReactNativeFeatureFlagsForTests.setUp()
  }

  @After fun tearDown() {
    if (previousHttpAgent == null) System.clearProperty("http.agent")
    else System.setProperty("http.agent", previousHttpAgent!!)
    UserAgentSettings.failure = null
    shadowOf(Looper.getMainLooper()).idle()
  }

  @Test fun expoImageModelsUseTheProviderWithoutReplacingExplicitIdentities() {
    assertEquals(SYSTEM_IDENTITY, LazyHeaders.Builder().build().headers["User-Agent"])
    for (cached in listOf(false, true)) for (wrapped in listOf(false, true)) {
      for (explicit in listOf(null, "saved browser identity", SYSTEM_IDENTITY)) {
        val sourceHeader = if (cached) FORUM_MEDIA_SOURCE_HEADER.lowercase() else FORUM_MEDIA_SOURCE_HEADER
        val headers = mutableMapOf(sourceHeader to "nodeseek")
        if (explicit != null) headers[if (wrapped) "user-agent" else "User-Agent"] = explicit
        val read = readImage(headers, cached, wrapped)
        assertNull(read.error)
        assertEquals(explicit ?: "provider identity", read.request!!.header("User-Agent"))
        assertEquals(if (explicit == null) 1 else 0, read.providerReads)
        assertNull(read.request.header(FORUM_MEDIA_SOURCE_HEADER))
      }
      val ordinary = readImage(emptyMap(), cached, wrapped)
      assertNull(ordinary.error)
      assertEquals(SYSTEM_IDENTITY, ordinary.request!!.header("User-Agent"))
      assertEquals(0, ordinary.providerReads)
    }
  }

  @Test fun expoImageProviderFailureReachesTheConsumerWithoutTransport() {
    val failure = IllegalStateException("provider unavailable")
    val read = readImage(mapOf(FORUM_MEDIA_SOURCE_HEADER to "nodeseek"), true, true, failure)
    assertNull(read.request)
    assertEquals(1, read.providerReads)
    assertTrue(read.error is IOException)
    assertSame(failure, read.error!!.cause)
  }

  @Test fun bridgeRejectsProviderFailuresRetriesAndResolvesTheCachedIdentity() {
    val module = NetworkProxyModule(BridgeReactContext(RuntimeEnvironment.getApplication()))
    try {
      assertFalse(module.constants.orEmpty().containsKey("defaultWebViewUserAgent"))
      assertEquals(0, UserAgentSettings.calls.get())
      UserAgentSettings.failure = AssertionError("provider unavailable")
      val failure = callBridge(module)
      assertEquals("reject", failure.method)
      assertEquals("E_DEFAULT_USER_AGENT", failure.arguments.first())
      UserAgentSettings.failure = null
      UserAgentSettings.value = " "
      val blank = callBridge(module)
      assertEquals("reject", blank.method)
      assertEquals("E_DEFAULT_USER_AGENT", blank.arguments.first())
      UserAgentSettings.value = "  provider   identity  "
      repeat(2) {
        val result = callBridge(module)
        assertEquals("resolve", result.method)
        assertEquals(listOf("provider identity"), result.arguments)
      }
      assertEquals(3, UserAgentSettings.calls.get())
    } finally {
      module.invalidate()
    }
    val invalidated = callBridge(module)
    assertEquals("reject", invalidated.method)
    assertEquals("E_DEFAULT_USER_AGENT", invalidated.arguments.first())
    assertEquals(3, UserAgentSettings.calls.get())
  }

  private data class ImageRead(val request: Request?, val error: Exception?, val providerReads: Int)

  private fun readImage(
    headers: Map<String, String>,
    cached: Boolean,
    wrapped: Boolean,
    providerFailure: Exception? = null
  ): ImageRead {
    val received = AtomicReference<Request?>()
    val failure = AtomicReference<Exception?>()
    val done = CountDownLatch(1)
    val reads = AtomicInteger()
    val client = OkHttpClient.Builder()
      .addInterceptor(ForumMediaRequestInterceptor(defaultUserAgent = {
        reads.incrementAndGet()
        if (providerFailure != null) throw providerFailure
        "provider identity"
      }))
      .addInterceptor { chain ->
        received.set(chain.request())
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
          .code(200).message("OK").body("image".toResponseBody()).build()
      }.build()
    val source = SourceMap(
      uri = "https://www.nodeseek.com/image.png",
      headers = headers,
      cacheKey = if (cached) "media-session:image" else null
    )
    val model = source.createGlideModelProvider(RuntimeEnvironment.getApplication())!!.getGlideModel() as GlideUrlWrapper
    val load = if (wrapped) CloseSafeGlideUrlWrapperLoader(client) { _, _, _, _ -> }
      .buildLoadData(model, 10, 10, Options())
    else CloseSafeGlideUrlLoader(client).buildLoadData(model.glideUrl, 10, 10, Options())
    val fetcher = requireNotNull(load).fetcher
    try {
      fetcher.loadData(Priority.NORMAL, object : DataFetcher.DataCallback<InputStream> {
        override fun onDataReady(data: InputStream?) {
          done.countDown()
        }
        override fun onLoadFailed(error: Exception) {
          failure.set(error)
          done.countDown()
        }
      })
      assertTrue("Glide must settle its consumer", done.await(5, TimeUnit.SECONDS))
      return ImageRead(received.get(), failure.get(), reads.get())
    } finally {
      fetcher.cleanup()
      client.dispatcher.executorService.shutdownNow()
      client.connectionPool.evictAll()
    }
  }

  private data class BridgeResult(val method: String, val arguments: List<Any?>)

  private fun callBridge(module: NetworkProxyModule): BridgeResult {
    val done = CountDownLatch(1)
    val result = AtomicReference<BridgeResult>()
    val calls = AtomicInteger()
    val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
      if (method.name == "resolve" || method.name == "reject") {
        calls.incrementAndGet()
        result.set(BridgeResult(method.name, args.orEmpty().toList()))
        done.countDown()
      }
      null
    } as Promise
    module.getDefaultWebViewUserAgent(promise)
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while (!done.await(5, TimeUnit.MILLISECONDS) && System.nanoTime() < deadline) shadowOf(Looper.getMainLooper()).idle()
    assertEquals("the Promise must settle exactly once", 1, calls.get())
    return result.get()
  }

  @Implements(WebSettings::class)
  class UserAgentSettings {
    companion object {
      val calls = AtomicInteger()
      var value = "provider identity"
      var failure: AssertionError? = null

      @JvmStatic @Implementation fun getDefaultUserAgent(context: Context): String {
        assertSame(Looper.getMainLooper(), Looper.myLooper())
        calls.incrementAndGet()
        failure?.let { throw it }
        return value
      }
    }
  }

  companion object {
    private const val SYSTEM_IDENTITY = "Dalvik/system-identity"
  }
}
