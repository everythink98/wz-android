package com.wz.reader

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.InetAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import com.bumptech.glide.Priority
import com.bumptech.glide.load.Options
import com.bumptech.glide.load.data.DataFetcher
import com.bumptech.glide.load.model.GlideUrl
import com.bumptech.glide.load.model.Headers
import expo.modules.image.okhttp.GlideUrlWrapper
import expo.modules.image.okhttp.GlideUrlWithCustomCacheKey
import expo.modules.video.ReadNetworkVideoClientRegistry
import okhttp3.Cache
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Cookie
import okhttp3.Interceptor
import okhttp3.JavaNetCookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.ForwardingSource
import okio.Timeout
import okio.buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkProxyRuntimeTest {
  @Test
  fun publicReadRetriesUseLatestClearanceWithoutAccountCookies() {
    for (source in listOf("linuxdo", "nodeseek")) {
      ServerSocket(0, 50, InetAddress.getByName("127.0.0.1")).use { server ->
        server.soTimeout = 5000
        val executor = Executors.newSingleThreadExecutor()
        val requests = executor.submit<List<Map<String, String>>> {
          (0..2).map {
            server.accept().use { socket ->
              val reader = socket.getInputStream().bufferedReader()
              reader.readLine()
              val headers = mutableMapOf<String, String>()
              while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
                headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
              }
              val status = if (headers["cookie"] == "cf_clearance=fresh") "200 OK" else "403 Forbidden"
              socket.getOutputStream().apply {
                write(("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
                flush()
              }
              headers
            }
          }
        }
        var stored = "session=account; _t=account"
        val client = OkHttpClient.Builder()
          .cookieJar(okhttp3.CookieJar.NO_COOKIES)
          .addInterceptor(ForumReadRequestInterceptor())
          .addNetworkInterceptor(ForumReadClearanceInterceptor({ source }, { stored }))
          .build()
        val request = Request.Builder().url("http://127.0.0.1:${server.localPort}/t/42.json")
          .header(FORUM_READ_SOURCE_HEADER, source)
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
          .header("X-WZ-Forum-Read-Cookie-Policy", "clearance-only")
          .header("Cookie", "session=caller-must-not-bypass")
          .build()
        try {
          client.newCall(request).execute().use { assertEquals(403, it.code) }
          stored += "; cf_clearance=fresh"
          client.newCall(request).execute().use { assertEquals(200, it.code) }
          stored = "cf_clearance=rejected; session=account"
          client.newCall(request).execute().use { assertEquals(403, it.code) }
          val sent = requests.get(5, TimeUnit.SECONDS)
          assertEquals(listOf(null, "cf_clearance=fresh", "cf_clearance=rejected"), sent.map { it["cookie"] })
          assertTrue(sent.all { headers -> headers.keys.none { it.startsWith("x-wz-") } })
        } finally {
          server.close()
          executor.shutdownNow()
          client.connectionPool.evictAll()
        }
      }
    }
  }

  @Test
  fun clearanceReadsDropCookiesAcrossRedirectsAndNeverRestoreThemOnReturn() {
    ServerSocket(0, 50, InetAddress.getByName("127.0.0.1")).use { server ->
      server.soTimeout = 5000
      val executor = Executors.newSingleThreadExecutor()
      val recorded = executor.submit<List<String?>> {
        (0..2).map { index ->
          server.accept().use { socket ->
            val reader = socket.getInputStream().bufferedReader()
            reader.readLine()
            var cookie: String? = null
            while (true) {
              val line = reader.readLine() ?: break
              if (line.isEmpty()) break
              if (line.startsWith("Cookie:", true)) cookie = line.substringAfter(':').trim()
            }
            val response = when (index) {
              0 -> "302 Found\r\nLocation: http://external.test:${server.localPort}/away"
              1 -> "302 Found\r\nLocation: http://same.test:${server.localPort}/return"
              else -> "200 OK"
            }
            socket.getOutputStream().apply {
              write("HTTP/1.1 $response\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
              flush()
            }
            cookie
          }
        }
      }
      val reads = mutableListOf<String>()
      val client = OkHttpClient.Builder()
        .dns(object : okhttp3.Dns {
          override fun lookup(hostname: String) = listOf(InetAddress.getByName("127.0.0.1"))
        })
        .cookieJar(JavaNetCookieJar(ReadOnlyWebViewCookieHandler(sourceForUri = { "nodeseek" }) {
          "session=account; cf_clearance=stale"
        }))
        .addInterceptor(ForumReadRequestInterceptor())
        .addNetworkInterceptor(ForumReadClearanceInterceptor(
          { if (it.host == "same.test") "nodeseek" else null },
          { url -> reads.add(url); "session=account; cf_clearance=fresh" }
        ))
        .build()
      try {
        client.newCall(Request.Builder().url("http://same.test:${server.localPort}/start")
          .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
          .header(FORUM_READ_COOKIE_POLICY_HEADER, "clearance-only").build()).execute().close()
        assertEquals(listOf("cf_clearance=fresh", null, null), recorded.get(5, TimeUnit.SECONDS))
        assertEquals(1, reads.size)
      } finally {
        server.close()
        executor.shutdownNow()
        client.connectionPool.evictAll()
      }
    }
  }

  @Test
  fun clearancePolicyRejectsUnsupportedSourcesOriginsAndMethodsWithoutReadingCookies() {
    val cases = listOf(
      Triple("linuxdo", "https://nodeseek.com/t/1", "GET"),
      Triple("linuxdo", "http://linux.do/t/1", "GET"),
      Triple("linuxdo", "https://evillinux.do/t/1", "GET"),
      Triple("v2ex", "https://www.v2ex.com/t/1", "GET"),
      Triple("yaohuo", "https://yaohuo.me/t/1", "GET"),
      Triple("linuxdo", "https://linux.do/t/1", "POST")
    )
    for ((source, url, method) in cases) {
      var sent: Request? = null
      val client = OkHttpClient.Builder()
        .addInterceptor(ForumReadRequestInterceptor())
        .addInterceptor(ForumReadClearanceInterceptor(cookieReader = { error("Must not read account cookies") }))
        .addInterceptor { chain ->
          sent = chain.request()
          Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body("".toResponseBody()).build()
        }.build()
      client.newCall(Request.Builder().url(url)
        .method(method, if (method == "POST") "".toRequestBody() else null)
        .header(FORUM_READ_SOURCE_HEADER, source)
        .header(FORUM_READ_COOKIE_POLICY_HEADER, "clearance-only")
        .header("Cookie", "session=caller").build()).execute().close()
      assertNull(sent!!.header("Cookie"))
      assertNull(sent!!.header(FORUM_READ_COOKIE_POLICY_HEADER))
    }
  }

  @Test
  fun staleHttp2ImagesRecoverOnNewConnectionAfterCancelAndReopen() =
    Http2ImageFaultFixture().use { it.assertRecoveryAfterReopen() }

  @Test
  fun blockedHttp2WriterCannotTrapCancellationOrConnectionRecovery() =
    Http2ImageFaultFixture(blockWrites = true).use { it.assertRecoveryAfterReopen() }

  @Test
  fun blockedTlsHttp2WriterClosesRawSocketBeforeTlsShutdown() =
    Http2ImageFaultFixture(blockWrites = true, tls = true).use { it.assertRecoveryAfterReopen() }

  @Test
  fun explicitHttp2DisconnectRecoversWithoutWaitingForHealthTimer() =
    Http2ImageFaultFixture().use { it.assertExplicitDisconnect() }

  @Test
  fun healthyHttp2SlowHeadersAndContinuousBodyKeepTheirConnection() =
    Http2ImageFaultFixture().use { it.assertHealthySlowResponses() }

  @Test
  fun unavailableHttp2NetworkEndsWithoutUnboundedTransportRetries() =
    Http2ImageFaultFixture().use { it.assertOfflineTerminates() }

  @Test
  fun retiredRuntimeCannotReplayStaleHttp2ImageContext() =
    Http2ImageFaultFixture().use { it.assertRetiredRuntimeDoesNotReplay() }

  private class ControllableGlideCall(private val request: Request) : Call {
    private var callback: Callback? = null
    private val canceled = AtomicBoolean(false)
    private val executed = AtomicBoolean(false)

    override fun request(): Request = request

    override fun execute(): Response = throw UnsupportedOperationException("Only async execution is supported")

    override fun enqueue(responseCallback: Callback) {
      check(executed.compareAndSet(false, true))
      callback = responseCallback
    }

    override fun cancel() {
      canceled.set(true)
    }

    override fun isExecuted(): Boolean = executed.get()

    override fun isCanceled(): Boolean = canceled.get()

    override fun timeout(): Timeout = Timeout.NONE

    override fun clone(): Call = ControllableGlideCall(request)

    fun respond(code: Int, body: okhttp3.ResponseBody) {
      requireNotNull(callback).onResponse(
        this,
        Response.Builder()
          .request(request)
          .protocol(Protocol.HTTP_1_1)
          .code(code)
          .message(if (code in 200..299) "OK" else "Failure")
          .body(body)
          .build()
      )
    }

    fun fail(error: IOException) {
      requireNotNull(callback).onFailure(this, error)
    }
  }

  private class ControllableGlideCallFactory : Call.Factory {
    lateinit var latest: ControllableGlideCall

    override fun newCall(request: Request): Call = ControllableGlideCall(request).also { latest = it }
  }

  private class CloseCountingResponseBody(private val contents: String) : okhttp3.ResponseBody() {
    val closeCount = AtomicInteger()
    private val trackedSource = object : ForwardingSource(Buffer().writeUtf8(contents)) {
      override fun close() {
        closeCount.incrementAndGet()
        super.close()
      }
    }.buffer()

    override fun contentType() = null

    override fun contentLength(): Long = contents.toByteArray().size.toLong()

    override fun source() = trackedSource
  }

  private class ThrowingAcquisitionResponseBody(
    private val contents: String,
    private val failurePoint: String
  ) : okhttp3.ResponseBody() {
    val closeCount = AtomicInteger()
    private val trackedSource = Buffer().writeUtf8(contents)

    override fun contentType() = null

    override fun contentLength(): Long {
      if (failurePoint == "contentLength") throw IOException("content length failed")
      return contents.toByteArray().size.toLong()
    }

    override fun source() = if (failurePoint == "byteStream") {
      throw IOException("byte stream failed")
    } else {
      trackedSource
    }

    override fun close() {
      closeCount.incrementAndGet()
      trackedSource.close()
    }
  }

  private class RecordingGlideCallback(
    private val failureObserved: (() -> Unit)? = null
  ) : DataFetcher.DataCallback<InputStream> {
    val readyCount = AtomicInteger()
    val failureCount = AtomicInteger()
    var data: InputStream? = null

    override fun onDataReady(data: InputStream?) {
      this.data = data
      readyCount.incrementAndGet()
    }

    override fun onLoadFailed(error: Exception) {
      failureObserved?.invoke()
      failureCount.incrementAndGet()
    }
  }

  private fun testGlideUrl(): GlideUrl = object : GlideUrl(
    "https://images.example.test/a.webp",
    object : Headers { override fun getHeaders() = emptyMap<String, String>() }
  ) {
    override fun toStringUrl() = "https://images.example.test/a.webp"
  }

  private fun closeSafeGlideFetcher(factory: Call.Factory): DataFetcher<InputStream> = requireNotNull(
    CloseSafeGlideUrlLoader(factory).buildLoadData(testGlideUrl(), 100, 100, Options())
  ).fetcher

  private class BlockingWriteSocket(private val writesStarted: CountDownLatch) : Socket() {
    private val closedState = AtomicBoolean(false)
    private val closed = CountDownLatch(1)
    private val emittedInput = AtomicBoolean(false)
    private val input = object : InputStream() {
      override fun read(): Int {
        if (emittedInput.compareAndSet(false, true)) return 1
        closed.await()
        throw SocketException("socket closed")
      }

      override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        val value = read()
        buffer[offset] = value.toByte()
        return 1
      }
    }
    private val output = object : OutputStream() {
      override fun write(value: Int) {
        writesStarted.countDown()
        closed.await()
        throw SocketException("socket closed")
      }

      override fun write(buffer: ByteArray, offset: Int, length: Int) {
        if (length == 0) return
        write(buffer[offset].toInt())
      }
    }

    override fun getInputStream() = input

    override fun getOutputStream() = output

    override fun setSoTimeout(timeout: Int) = Unit

    override fun shutdownOutput() = Unit

    override fun close() {
      if (closedState.compareAndSet(false, true)) closed.countDown()
    }

    override fun isClosed() = closedState.get()
  }

  private fun responseFor(request: Request): Response = Response.Builder()
    .request(request)
    .protocol(Protocol.HTTP_1_1)
    .code(200)
    .message("OK")
    .body("".toResponseBody())
    .build()

  @Test
  fun regTopic074CancelAfter200ClosesOwnedBodyBeforeCleanup() {
    val factory = ControllableGlideCallFactory()
    val callback = RecordingGlideCallback()
    val body = CloseCountingResponseBody("image")
    val fetcher = closeSafeGlideFetcher(factory)
    fetcher.loadData(Priority.NORMAL, callback)

    factory.latest.respond(200, body)

    assertEquals(1, callback.readyCount.get())
    assertEquals(0, callback.failureCount.get())
    assertEquals("a successful response stays readable until cancel or cleanup", 0, body.closeCount.get())

    fetcher.cancel()
    fetcher.cleanup()

    assertTrue(factory.latest.isCanceled())
    assertEquals("cancel must own and close the accepted response exactly once", 1, body.closeCount.get())
  }

  @Test
  fun regTopic074SuccessfulBodyAcquisitionFailuresCloseExactlyOnce() {
    listOf("byteStream", "contentLength").forEach { failurePoint ->
      val factory = ControllableGlideCallFactory()
      val body = ThrowingAcquisitionResponseBody("image", failurePoint)
      val closeCountAtFailure = AtomicInteger(-1)
      val callback = RecordingGlideCallback { closeCountAtFailure.set(body.closeCount.get()) }
      val fetcher = closeSafeGlideFetcher(factory)
      fetcher.loadData(Priority.NORMAL, callback)

      factory.latest.respond(200, body)

      assertEquals("a failed acquisition never exposes response data", 0, callback.readyCount.get())
      assertEquals("a failed acquisition reports one Glide failure", 1, callback.failureCount.get())
      assertEquals("the body closes before Glide observes acquisition failure", 1, closeCountAtFailure.get())
      fetcher.cancel()
      fetcher.cleanup()
      assertEquals("the failed acquisition body stays closed exactly once", 1, body.closeCount.get())
    }
  }

  @Test
  fun regTopic074Late200AfterCancelClosesWithoutCallback() {
    val factory = ControllableGlideCallFactory()
    val callback = RecordingGlideCallback()
    val body = CloseCountingResponseBody("late-image")
    val fetcher = closeSafeGlideFetcher(factory)
    fetcher.loadData(Priority.NORMAL, callback)

    fetcher.cancel()
    factory.latest.respond(200, body)
    fetcher.cleanup()

    assertTrue(factory.latest.isCanceled())
    assertEquals(0, callback.readyCount.get())
    assertEquals(0, callback.failureCount.get())
    assertEquals("a response arriving after cancel must be closed exactly once", 1, body.closeCount.get())
  }

  @Test
  fun regTopic074Late200AfterCleanupClosesWithoutCallback() {
    val factory = ControllableGlideCallFactory()
    val callback = RecordingGlideCallback()
    val body = CloseCountingResponseBody("cleanup-late-image")
    val fetcher = closeSafeGlideFetcher(factory)
    fetcher.loadData(Priority.NORMAL, callback)

    fetcher.cleanup()
    factory.latest.respond(200, body)
    fetcher.cancel()

    assertEquals(0, callback.readyCount.get())
    assertEquals(0, callback.failureCount.get())
    assertEquals("a response arriving after cleanup must be closed exactly once", 1, body.closeCount.get())
  }

  @Test
  fun regTopic074FailureAfterCancelDoesNotCallback() {
    val factory = ControllableGlideCallFactory()
    val callback = RecordingGlideCallback()
    val fetcher = closeSafeGlideFetcher(factory)
    fetcher.loadData(Priority.NORMAL, callback)

    fetcher.cancel()
    factory.latest.fail(IOException("canceled call failed"))
    fetcher.cleanup()

    assertTrue(factory.latest.isCanceled())
    assertEquals(0, callback.readyCount.get())
    assertEquals(0, callback.failureCount.get())
  }

  @Test
  fun regTopic074CleanupAndCancelAreIdempotentInEitherOrder() {
    val cleanupFirstFactory = ControllableGlideCallFactory()
    val cleanupFirstCallback = RecordingGlideCallback()
    val cleanupFirstBody = CloseCountingResponseBody("cleanup-first")
    val cleanupFirstFetcher = closeSafeGlideFetcher(cleanupFirstFactory)
    cleanupFirstFetcher.loadData(Priority.NORMAL, cleanupFirstCallback)
    cleanupFirstFactory.latest.respond(200, cleanupFirstBody)

    assertEquals(0, cleanupFirstBody.closeCount.get())
    cleanupFirstFetcher.cleanup()
    cleanupFirstFetcher.cleanup()
    cleanupFirstFetcher.cancel()
    assertEquals(1, cleanupFirstBody.closeCount.get())

    val cancelFirstFactory = ControllableGlideCallFactory()
    val cancelFirstCallback = RecordingGlideCallback()
    val cancelFirstBody = CloseCountingResponseBody("cancel-first")
    val cancelFirstFetcher = closeSafeGlideFetcher(cancelFirstFactory)
    cancelFirstFetcher.loadData(Priority.NORMAL, cancelFirstCallback)
    cancelFirstFactory.latest.respond(200, cancelFirstBody)

    cancelFirstFetcher.cancel()
    cancelFirstFetcher.cancel()
    cancelFirstFetcher.cleanup()
    assertEquals(1, cancelFirstBody.closeCount.get())
  }

  @Test
  fun regTopic074Non2xxClosesBeforeReportingFailure() {
    val factory = ControllableGlideCallFactory()
    val body = CloseCountingResponseBody("denied")
    val closeCountAtFailure = AtomicInteger(-1)
    val callback = RecordingGlideCallback { closeCountAtFailure.set(body.closeCount.get()) }
    val fetcher = closeSafeGlideFetcher(factory)
    fetcher.loadData(Priority.NORMAL, callback)

    factory.latest.respond(403, body)

    assertEquals(0, callback.readyCount.get())
    assertEquals(1, callback.failureCount.get())
    assertEquals(1, closeCountAtFailure.get())
    assertEquals("a non-success response is closed before Glide observes failure", 1, body.closeCount.get())
    fetcher.cancel()
    fetcher.cleanup()
    assertEquals(1, body.closeCount.get())
  }

  @Test
  fun regTopic074ExpoWrapperUsesCloseSafeFetcherAndPreservesProgress() {
    val factory = ControllableGlideCallFactory()
    val callback = RecordingGlideCallback()
    val progress = mutableListOf<Triple<Long, Long, Boolean>>()
    val model = GlideUrlWrapper(testGlideUrl())
    val loadData = requireNotNull(
      CloseSafeGlideUrlWrapperLoader(factory) { observedModel, bytesRead, contentLength, done ->
        assertSame(model, observedModel)
        progress.add(Triple(bytesRead, contentLength, done))
      }.buildLoadData(model, 100, 100, Options())
    )

    assertSame(model.glideUrl, loadData.sourceKey)
    assertTrue(loadData.fetcher is CloseSafeGlideStreamFetcher)
    loadData.fetcher.loadData(Priority.NORMAL, callback)
    val body = CloseCountingResponseBody("image")
    factory.latest.respond(200, body)

    assertEquals("image", callback.data?.readBytes()?.toString(Charsets.UTF_8))
    assertEquals(
      listOf(Triple(5L, 5L, false), Triple(5L, 5L, true)),
      progress
    )
    loadData.fetcher.cleanup()
    assertEquals(1, body.closeCount.get())
  }

  @Test
  fun regTopic064OnlyCloudflareImageChallengesUseOneFallbackResponse() {
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val served = CountDownLatch(1)
    val executor = Executors.newSingleThreadExecutor()
    executor.execute {
      try {
        repeat(4) {
          server.accept().use { socket ->
            val reader = socket.getInputStream().bufferedReader()
            val requestLine = reader.readLine().orEmpty()
            while (!reader.readLine().isNullOrEmpty()) Unit
            val path = requestLine.split(" ").getOrNull(1).orEmpty()
            val status = if (path == "/rate") "429 Too Many Requests" else "403 Forbidden"
            val challengeHeader = if (path == "/challenge" || path == "/write") {
              "Cf-Mitigated: challenge\r\n"
            } else {
              ""
            }
            socket.getOutputStream().apply {
              write(
                (
                  "HTTP/1.1 $status\r\n${challengeHeader}Content-Type: text/html\r\n" +
                    "Content-Length: 0\r\nConnection: close\r\n\r\n"
                ).toByteArray(Charsets.US_ASCII)
              )
              flush()
            }
          }
        }
      } finally {
        served.countDown()
      }
    }
    val fallbackCount = AtomicInteger()
    val client = OkHttpClient.Builder()
      .addNetworkInterceptor(ForumMediaCloudflareFallbackInterceptor { request, _ ->
        fallbackCount.incrementAndGet()
        responseFor(request).newBuilder()
          .header("Content-Type", "image/webp")
          .body("cronet-image".toResponseBody())
          .build()
      })
      .build()

    fun request(path: String, write: Boolean = false): Response {
      val builder = Request.Builder().url("http://127.0.0.1:${server.localPort}$path")
      if (write) builder.post(ByteArray(0).toRequestBody())
      return client.newCall(builder.build()).execute()
    }

    try {
      request("/challenge").use {
        assertEquals(200, it.code)
        assertEquals("cronet-image", it.body?.string())
      }
      request("/ordinary").use { assertEquals(403, it.code) }
      request("/rate").use { assertEquals(429, it.code) }
      request("/write", write = true).use { assertEquals(403, it.code) }

      assertTrue(served.await(5, TimeUnit.SECONDS))
      assertEquals(1, fallbackCount.get())
    } finally {
      server.close()
      executor.shutdownNow()
    }
  }

  @Test
  fun regTopic064FallbackFailureOrSecondChallengeKeepsTheOriginalResponse() {
    val originalRequest = Request.Builder().url("https://images.example.test/a.webp").build()
    val original = Response.Builder()
      .request(originalRequest)
      .protocol(Protocol.HTTP_1_1)
      .code(403)
      .message("Forbidden")
      .header("Cf-Mitigated", "challenge")
      .body("original-challenge".toResponseBody())
      .build()
    val secondChallenge = original.newBuilder()
      .body("cronet-challenge".toResponseBody())
      .build()

    assertSame(
      original,
      recoverCloudflareMediaChallenge(originalRequest, original) { _, _ ->
        throw IOException("cronet unavailable")
      }
    )
    assertSame(
      original,
      recoverCloudflareMediaChallenge(originalRequest, original) { _, _ ->
        throw NoClassDefFoundError("cronet native provider unavailable")
      }
    )
    assertSame(
      original,
      recoverCloudflareMediaChallenge(originalRequest, original) { _, _ -> secondChallenge }
    )
  }

  @Test
  fun regTopic041MediaIdentityMarkerIsInternalOnlyWhileSourcePolicyStillApplies() {
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val receivedHeaders = mutableListOf<Map<String, String>>()
    val served = CountDownLatch(1)
    val executor = Executors.newSingleThreadExecutor()
    executor.execute {
      try {
        repeat(2) {
          server.accept().use { socket ->
            val reader = socket.getInputStream().bufferedReader()
            reader.readLine()
            val headers = mutableMapOf<String, String>()
            while (true) {
              val line = reader.readLine() ?: break
              if (line.isEmpty()) break
              val separator = line.indexOf(':')
              if (separator > 0) {
                headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
              }
            }
            receivedHeaders.add(headers)
            socket.getOutputStream().apply {
              write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
              flush()
            }
          }
        }
      } finally {
        served.countDown()
      }
    }
    val sourceForUri: (java.net.URI) -> String? = { uri ->
      if (uri.host == "media.test") "nodeseek" else null
    }
    val handler = ReadOnlyWebViewCookieHandler(sourceForUri = sourceForUri) { "session=live" }
    val client = OkHttpClient.Builder()
      .dns(object : okhttp3.Dns {
        override fun lookup(hostname: String) = listOf(InetAddress.getByName("127.0.0.1"))
      })
      .cookieJar(JavaNetCookieJar(handler))
      .addInterceptor(ForumMediaRequestInterceptor(sourceForUri))
      .build()

    try {
      client.newCall(Request.Builder()
        .url("http://media.test:${server.localPort}/private.png")
        .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
        .header("X-WZ-Forum-Media-Identity", "nodeseek:41")
        .header("Cookie", "must-not-be-forwarded")
        .build()).execute().close()
      client.newCall(Request.Builder()
        .url("http://media.test:${server.localPort}/ordinary.png")
        .header("X-WZ-Forum-Media-Identity", "orphaned-identity")
        .build()).execute().close()

      assertTrue(served.await(5, TimeUnit.SECONDS))
      val markedHeaders = receivedHeaders[0]
      assertNull(markedHeaders[FORUM_MEDIA_SOURCE_HEADER.lowercase()])
      assertNull(markedHeaders["x-wz-forum-media-identity"])
      assertEquals("session=live", markedHeaders["cookie"])
      assertEquals("no-store", markedHeaders["cache-control"])
      val ordinaryHeaders = receivedHeaders[1]
      assertNull(ordinaryHeaders["x-wz-forum-media-identity"])
      assertEquals("session=live", ordinaryHeaders["cookie"])
      assertNull(ordinaryHeaders["cache-control"])
    } finally {
      server.close()
      executor.shutdownNow()
    }
  }

  @Test
  fun regTopic041SessionEpochParticipatesInExpoImageModelEquality() {
    fun model(identity: String): GlideUrlWithCustomCacheKey {
      val headers = object : Headers {
        override fun getHeaders() = mapOf(
          FORUM_MEDIA_SOURCE_HEADER to "nodeseek",
          FORUM_MEDIA_IDENTITY_HEADER to identity
        )
      }
      return GlideUrlWithCustomCacheKey(
        "https://www.nodeseek.com/uploads/private.png",
        headers,
        "${identity}:https://www.nodeseek.com/uploads/private.png"
      )
    }

    assertEquals(model("nodeseek:41"), model("nodeseek:41"))
    assertNotEquals(model("nodeseek:41"), model("nodeseek:42"))
  }

  @Test
  fun regTopic029MediaCookiesAreMonotonicallyDowngradedAcrossAnActualRedirectChain() {
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val requests = mutableListOf<Triple<String, String?, String?>>()
    val served = CountDownLatch(1)
    val executor = Executors.newSingleThreadExecutor()
    executor.execute {
      try {
        repeat(3) {
          server.accept().use { socket ->
            val reader = socket.getInputStream().bufferedReader()
            val path = reader.readLine().split(" ")[1]
            val headers = mutableMapOf<String, String>()
            while (true) {
              val line = reader.readLine() ?: break
              if (line.isEmpty()) break
              val separator = line.indexOf(':')
              if (separator > 0) {
                headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
              }
            }
            requests.add(Triple(path, headers[FORUM_MEDIA_SOURCE_HEADER.lowercase()], headers["cookie"]))
            val response = when (path) {
              "/start" -> "HTTP/1.1 302 Found\r\nLocation: http://external.test:${server.localPort}/away\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
              "/away" -> "HTTP/1.1 302 Found\r\nLocation: http://same.test:${server.localPort}/final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
              else -> "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            }
            socket.getOutputStream().apply {
              write(response.toByteArray(Charsets.US_ASCII))
              flush()
            }
          }
        }
      } finally {
        served.countDown()
      }
    }
    val sourceForUri: (java.net.URI) -> String? = { uri ->
      if (uri.host == "same.test") "nodeseek" else null
    }
    val cookieReads = mutableListOf<String>()
    val handler = ReadOnlyWebViewCookieHandler(sourceForUri = sourceForUri) { url ->
      cookieReads.add(url)
      "session=live"
    }
    val client = OkHttpClient.Builder()
      .dns(object : okhttp3.Dns {
        override fun lookup(hostname: String) = listOf(InetAddress.getByName("127.0.0.1"))
      })
      .cookieJar(JavaNetCookieJar(handler))
      .addInterceptor(ForumMediaRequestInterceptor(sourceForUri))
      .build()

    try {
      val response = client.newCall(Request.Builder()
        .url("http://same.test:${server.localPort}/start")
        .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
        .header("Cookie", "must-not-be-forwarded")
        .build()).execute()
      response.use { assertEquals(200, it.code) }
      assertTrue(served.await(5, TimeUnit.SECONDS))
      assertEquals(listOf(
        Triple("/start", null, "session=live"),
        Triple("/away", null, null),
        Triple("/final", null, null)
      ), requests)
      assertEquals(1, cookieReads.size)
    } finally {
      server.close()
      executor.shutdownNow()
    }
  }

  @Test
  fun regTopic029CrossForumAnonymousAndInvalidMediaStillProceedWithoutCookies() {
    for (source in listOf("linuxdo", "anonymous", "invalid-source")) {
      var proceeded = false
      var readCount = 0
      val handler = ReadOnlyWebViewCookieHandler {
        readCount += 1
        "session=must-not-leak"
      }
      val client = OkHttpClient.Builder()
        .addInterceptor(ForumMediaRequestInterceptor())
        .addInterceptor(Interceptor { chain ->
          proceeded = true
          assertTrue(handler.get(java.net.URI("https://www.nodeseek.com/media.png"), emptyMap()).isEmpty())
          responseFor(chain.request())
        })
        .build()

      client.newCall(Request.Builder()
        .url("https://www.nodeseek.com/media.png")
        .header(FORUM_MEDIA_SOURCE_HEADER, source)
        .build()).execute().close()

      assertTrue(proceeded)
      assertEquals(0, readCount)
    }
  }

  @Test
  fun regTopic029ManagedMediaCookieReadFailuresFailClosed() {
    val handler = ReadOnlyWebViewCookieHandler {
      throw IllegalStateException("cookie reader unavailable")
    }
    val client = OkHttpClient.Builder()
      .addInterceptor(ForumMediaRequestInterceptor())
      .addInterceptor(Interceptor { chain ->
        assertTrue(handler.get(java.net.URI("https://www.nodeseek.com/media.png"), emptyMap()).isEmpty())
        responseFor(chain.request())
      })
      .build()

    client.newCall(Request.Builder()
      .url("https://www.nodeseek.com/media.png")
      .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
      .build()).execute().close()
  }

  @Test
  fun regTopic029UnmarkedRequestsKeepOrdinaryCookieBehavior() {
    var proceeded = false
    var readCount = 0
    val handler = ReadOnlyWebViewCookieHandler {
      readCount += 1
      "session=ordinary"
    }
    val client = OkHttpClient.Builder()
      .addInterceptor(ForumMediaRequestInterceptor())
      .addInterceptor(Interceptor { chain ->
        proceeded = true
        assertEquals(
          mapOf("Cookie" to listOf("session=ordinary")),
          handler.get(java.net.URI(chain.request().url.toString()), emptyMap())
        )
        responseFor(chain.request())
      })
      .build()

    client.newCall(Request.Builder()
      .url("https://www.nodeseek.com/api/account")
      .build()).execute().close()

    assertTrue(proceeded)
    assertEquals(1, readCount)
  }

  @Test
  fun regTopic037MarkedMediaNeverReadsOrWritesSharedHttpCache() {
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val requests = mutableListOf<Pair<String, String?>>()
    val served = CountDownLatch(1)
    val executor = Executors.newSingleThreadExecutor()
    executor.execute {
      try {
        repeat(4) { index ->
          server.accept().use { socket ->
            val reader = socket.getInputStream().bufferedReader()
            val path = reader.readLine().split(" ")[1]
            val headers = mutableMapOf<String, String>()
            while (true) {
              val line = reader.readLine() ?: break
              if (line.isEmpty()) break
              val separator = line.indexOf(':')
              if (separator > 0) {
                headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
              }
            }
            requests.add(path to headers["cookie"])
            val body = "network-${index + 1}"
            socket.getOutputStream().apply {
              write((
                "HTTP/1.1 200 OK\r\n" +
                  "Cache-Control: public, max-age=3600\r\n" +
                  "Content-Length: ${body.toByteArray().size}\r\n" +
                  "Connection: close\r\n\r\n" +
                  body
              ).toByteArray(Charsets.US_ASCII))
              flush()
            }
          }
        }
      } finally {
        served.countDown()
      }
    }
    val sourceForUri: (java.net.URI) -> String? = { uri ->
      if (uri.host == "media.test") "nodeseek" else null
    }
    val cacheDirectory = Files.createTempDirectory("wz-media-cache").toFile()
    val cache = Cache(cacheDirectory, 1024L * 1024L)
    val handler = ReadOnlyWebViewCookieHandler(sourceForUri = sourceForUri) { "session=live" }
    val client = OkHttpClient.Builder()
      .dns(object : okhttp3.Dns {
        override fun lookup(hostname: String) = listOf(InetAddress.getByName("127.0.0.1"))
      })
      .cache(cache)
      .cookieJar(JavaNetCookieJar(handler))
      .addInterceptor(ForumMediaRequestInterceptor(sourceForUri))
      .build()
    fun read(path: String, marker: String?): String {
      val request = Request.Builder().url("http://media.test:${server.localPort}$path")
      if (marker != null) request.header(FORUM_MEDIA_SOURCE_HEADER, marker)
      return client.newCall(request.build()).execute().use { it.body?.string().orEmpty() }
    }

    try {
      assertEquals("network-1", read("/legacy", null))
      assertEquals("network-2", read("/legacy", "linuxdo"))
      assertEquals("network-3", read("/fresh", "nodeseek"))
      assertEquals("network-4", read("/fresh", null))
      assertTrue(served.await(5, TimeUnit.SECONDS))
      assertEquals(listOf(
        "/legacy" to "session=live",
        "/legacy" to null,
        "/fresh" to "session=live",
        "/fresh" to "session=live"
      ), requests)
    } finally {
      cache.close()
      server.close()
      executor.shutdownNow()
      cacheDirectory.deleteRecursively()
    }
  }

  @Test
  fun regPerf010ExpoImageUsesPhaseTimeoutsWithoutACompleteCallDeadline() {
    val base = OkHttpClient.Builder().build()
    val image = expoImageClient(base)

    assertEquals(0, base.callTimeoutMillis)
    assertEquals(0, image.callTimeoutMillis)
    assertEquals(15_000, image.connectTimeoutMillis)
    assertEquals(30_000, image.readTimeoutMillis)
    assertSame(base.cookieJar, image.cookieJar)
    assertSame(base.proxySelector, image.proxySelector)
    assertSame(base.dispatcher, image.dispatcher)
    assertSame(base.connectionPool, image.connectionPool)
    assertEquals(0, base.networkInterceptors.count { it is ForumMediaCloudflareFallbackInterceptor })
    assertEquals(1, image.networkInterceptors.count { it is ForumMediaCloudflareFallbackInterceptor })
  }

  @Test
  fun regAccount033YaohuoAnonymousCookiesDoNotBlockLoginCookieCleanup() {
    assertFalse(hasActiveYaohuoLoginCookie("ASP.NET_SessionId=anonymous; GUID=visitor"))
    assertFalse(hasActiveYaohuoLoginCookie("ASP.NET_SessionId=anonymous; GUID=visitor; sidyaohuo=-2"))
    assertTrue(hasActiveYaohuoLoginCookie("sidyaohuo=logged-in-session"))
    assertTrue(hasActiveYaohuoLoginCookie("sidyaohuo=-2; sidyaohuo=logged-in-session"))
  }

  @Test
  fun regAccount034YaohuoClearCoversLegacyWwwDomainCookies() {
    val expirations = managedLoginCookieClearPlan("yaohuo").expirations
    assertTrue(
      expirations.contains(
        "https://www.yaohuo.me/" to
          "sidyaohuo=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Domain=www.yaohuo.me"
      )
    )
    assertFalse(
      expirations.contains(
        "https://yaohuo.me/" to
          "sidyaohuo=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Domain=www.yaohuo.me"
      )
    )
  }

  @Test
  fun regLinuxdo009ExplicitClearCoversConnectSessionCookies() {
    val plan = managedLoginCookieClearPlan("linuxdo")
    val expired = "auth.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"

    assertTrue(plan.urls.contains("https://connect.linux.do/"))
    assertTrue(plan.names.contains("auth.session-token"))
    assertTrue(plan.expirations.contains("https://connect.linux.do/" to expired))
    assertTrue(
      plan.expirations.contains(
        "https://connect.linux.do/" to "$expired; Domain=connect.linux.do"
      )
    )
  }

  @Test
  fun readOnlyCookieJarLoadsTheExactManagedUrlWithoutPersistingResponses() {
    val reads = mutableListOf<String>()
    val handler = ReadOnlyWebViewCookieHandler { url ->
      reads.add(url)
      "cf_clearance=clearance; _cfuvid=visitor; future_cookie=future"
    }
    val jar = JavaNetCookieJar(handler)
    val url = "https://www.nodeseek.com/post-1-1?mode=latest".toHttpUrl()

    assertEquals(
      listOf("cf_clearance", "_cfuvid", "future_cookie"),
      jar.loadForRequest(url).map { it.name }
    )

    jar.saveFromResponse(
      url,
      listOf(Cookie.Builder()
        .name("response_cookie")
        .value("must-not-persist")
        .hostOnlyDomain("www.nodeseek.com")
        .build())
    )

    assertEquals(
      listOf("cf_clearance", "_cfuvid", "future_cookie"),
      jar.loadForRequest(url).map { it.name }
    )
    assertEquals(listOf(url.toString(), url.toString()), reads)
  }

  @Test
  fun readOnlyCookieJarDoesNotReadCookiesForUnmanagedHosts() {
    var readCount = 0
    val jar = JavaNetCookieJar(ReadOnlyWebViewCookieHandler {
      readCount += 1
      "session=must-not-leak"
    })

    assertTrue(jar.loadForRequest("https://example.com/private".toHttpUrl()).isEmpty())
    assertTrue(jar.loadForRequest("https://evilnodeseek.com/private".toHttpUrl()).isEmpty())
    assertTrue(jar.loadForRequest("http://www.nodeseek.com/private".toHttpUrl()).isEmpty())
    assertTrue(jar.loadForRequest("https://user:pass@www.nodeseek.com/private".toHttpUrl()).isEmpty())
    assertEquals(0, readCount)
  }

  @Test
  fun readOnlyCookieJarPropagatesManagedCookieReadFailures() {
    val jar = JavaNetCookieJar(ReadOnlyWebViewCookieHandler {
      throw IllegalStateException("cookie reader unavailable")
    })

    assertThrows(IllegalStateException::class.java) {
      jar.loadForRequest("https://www.nodeseek.com/private".toHttpUrl())
    }
  }

  @Test
  fun managedClientsShareCookieProxyDispatcherAndConnectionPoolState() {
    val first = NetworkProxyRuntime.configureManagedClient(okhttp3.OkHttpClient.Builder()).build()
    val second = NetworkProxyRuntime.configureManagedClient(okhttp3.OkHttpClient.Builder()).build()
    val reapplied = NetworkProxyRuntime.configureManagedClient(first.newBuilder()).build()

    assertTrue(first.cookieJar is com.facebook.react.modules.network.CookieJarContainer)
    assertSame(first.cookieJar, second.cookieJar)
    assertSame(first.proxySelector, second.proxySelector)
    assertSame(first.dispatcher, second.dispatcher)
    assertSame(first.connectionPool, second.connectionPool)
    assertEquals(1, reapplied.interceptors.count { it is ForumReadRequestInterceptor })
    assertEquals(1, reapplied.networkInterceptors.count { it is ForumReadClearanceInterceptor })
    assertEquals(1, reapplied.interceptors.count { it is ForumMediaRequestInterceptor })
  }

  @Test
  fun regProxy012CancelsOnlyExplicitlyOwnedReadRequests() {
    listOf(
      "nodeseek" to "https://www.nodeseek.com/read",
      "linuxdo" to "https://api.linux.do/read",
      "yaohuo" to "https://www.yaohuo.me/read",
      "v2ex" to "https://www.v2ex.com/read"
    ).forEach { (source, url) ->
      assertFalse(isForumReadChannelRequest(source, Request.Builder().url(url).head().build()))
      assertTrue(
        isForumReadChannelRequest(
          source,
          Request.Builder()
            .url(url)
            .head()
            .header(FORUM_READ_SOURCE_HEADER, source)
            .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
            .build()
        )
      )
    }
    assertFalse(isForumReadChannelRequest("nodeseek", Request.Builder().url("https://evilnodeseek.com/read").build()))
    assertFalse(
      isForumReadChannelRequest(
        "nodeseek",
        Request.Builder()
          .url("https://www.nodeseek.com/write")
          .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
          .post(ByteArray(0).toRequestBody())
          .build()
      )
    )
    listOf("health", "retained").forEach { cancelClass ->
      assertFalse(
        isForumReadChannelRequest(
          "nodeseek",
          Request.Builder()
            .url("https://www.nodeseek.com/api/account/status")
            .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
            .header(FORUM_READ_CANCEL_CLASS_HEADER, cancelClass)
            .build()
        )
      )
    }
    assertFalse(
      isForumReadChannelRequest(
        "nodeseek",
        Request.Builder()
          .url("https://linux.do/latest.json")
          .header(FORUM_READ_SOURCE_HEADER, "linuxdo")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
          .build()
      )
    )
    assertTrue(
      isForumReadChannelRequest(
        "nodeseek",
        Request.Builder()
          .url("https://www.nodeseek.com/post-1-1")
          .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
          .build()
      )
    )
    assertTrue(
      isForumReadChannelRequest(
        "nodeseek",
        Request.Builder()
          .url("https://cdn.example.com/private-image.png")
          .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
          .build()
      )
    )
    assertFalse(
      isForumReadChannelRequest(
        "nodeseek",
        Request.Builder()
          .url("https://cdn.example.com/upload")
          .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
          .post(ByteArray(0).toRequestBody())
          .build()
      )
    )
    assertThrows(IllegalArgumentException::class.java) {
      forumReadChannelHostSuffix("arbitrary-host")
    }
  }

  @Test
  fun regProxy010ReadIntentHeadersAreStrippedAndHealthRequestsRemainRetained() {
    val captured = mutableListOf<Request>()
    val client = OkHttpClient.Builder()
      .addInterceptor(ForumReadRequestInterceptor())
      .addInterceptor { chain ->
        captured.add(chain.request())
        responseFor(chain.request())
      }
      .build()

    listOf("content", "health").forEach { cancelClass ->
      client.newCall(
        Request.Builder()
          .url("https://www.nodeseek.com/" + cancelClass)
          .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, cancelClass)
          .build()
      ).execute().close()
    }

    assertEquals(2, captured.size)
    captured.forEach { request ->
      assertNull(request.header(FORUM_READ_SOURCE_HEADER))
      assertNull(request.header(FORUM_READ_CANCEL_CLASS_HEADER))
      assertEquals("nodeseek", request.tag(ForumReadRequestTag::class.java)?.source)
    }
    assertTrue(isForumReadChannelRequest("nodeseek", captured[0]))
    assertFalse(isForumReadChannelRequest("nodeseek", captured[1]))
  }


  private fun awaitImageRuntimeRetirement(client: OkHttpClient) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while (!client.dispatcher.executorService.isShutdown && System.nanoTime() < deadline) Thread.sleep(25)
    assertTrue("response resources must eventually release the runtime", client.dispatcher.executorService.isShutdown)
  }

  private fun withImageServer(received: MutableList<String>? = null, action: (String) -> Unit) {
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val executor = Executors.newCachedThreadPool()
    executor.execute {
      try {
        while (!server.isClosed) {
          val socket = server.accept()
          executor.execute {
            socket.use {
              try {
                val reader = socket.getInputStream().bufferedReader()
                val path = reader.readLine().orEmpty()
                while (true) {
                  val header = reader.readLine()
                  if (header.isNullOrEmpty()) break
                  received?.add(header)
                }
                if (path.contains("slow")) Thread.sleep(350)
                val length = if (path.contains("broken")) 50 else 5
                socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: " + length + "\r\nConnection: close\r\n\r\nimage").toByteArray())
              } catch (_: IOException) { } catch (_: InterruptedException) { }
            }
          }
        }
      } catch (_: SocketException) { }
    }
    try { action("http://127.0.0.1:" + server.localPort) }
    finally { server.close(); executor.shutdownNow(); assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS)) }
  }

  @Test
  fun ordinaryRequestsKeepDiagnosticIdentityAndNeverSendMarkersToServer() {
    val received = java.util.Collections.synchronizedList(mutableListOf<String>())
    withImageServer(received) { url ->
      val client = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder()).build()
      val request = Request.Builder().url(url)
        .header("X-WZ-Diagnostic-Session", "session-test-91830")
        .header("X-WZ-Diagnostic-Trace", "trace-91830")
        .header("X-WZ-Diagnostic-Request", "request-91830").build()
      client.newCall(request).execute().use { response ->
        assertEquals("image", response.body!!.string())
        assertEquals("request-91830", response.request.tag(RequestDiagnosticTag::class.java)?.requestId)
        assertNull(response.request.header("X-WZ-Diagnostic-Trace"))
      }
      client.newCall(request.newBuilder().header("X-WZ-Diagnostic-Request", "request-91831").build())
        .execute().use { it.body!!.string() }
      assertFalse(received.any { it.contains("X-WZ-Diagnostic", ignoreCase = true) })
      val events = NetworkProxyRuntime.readNetworkDiagnosticEvents().filter { it.fields["traceId"] == "trace-91830" }
      assertEquals(setOf("request-91830", "request-91831"), events.map { it.fields["requestId"] }.toSet())
      assertTrue(events.all { it.fields["appSessionId"] == "session-test-91830" })
      assertEquals(2, events.count { it.fields["phase"] == "call-start" })
      assertEquals(2, events.count { it.fields["phase"] == "call-end" })
      client.newCall(request.newBuilder().header("X-WZ-Diagnostic-Request", "private-token").build())
        .execute().use { assertNull(it.request.tag(RequestDiagnosticTag::class.java)) }
      assertFalse(received.any { it.contains("private-token") || it.contains("X-WZ-Diagnostic", ignoreCase = true) })
    }
  }

  @Test
  fun imageDiagnosticsCorrelateConsumersAndStripPrivateMarkersBeforeTransport() {
    val received = java.util.Collections.synchronizedList(mutableListOf<String>())
    withImageServer(received) { url ->
      val request = Request.Builder().url(url)
        .header("X-WZ-Image-Trace", "trace-91827")
        .header("X-WZ-Image-Ref", "media-91827")
        .header("X-WZ-Image-Session", "session-test-91827")
        .build()
      NetworkProxyRuntime.frescoCallFactory.newCall(request).execute().use { assertEquals("image", it.body!!.string()) }
      NetworkProxyRuntime.imageCallFactory.newCall(request.newBuilder()
        .tag(ImageRequestPurpose::class.java, ImageRequestPurpose.SVG_PROBE).build())
        .execute().use { assertEquals("image", it.body!!.string()) }
      assertFalse(received.any { it.contains("X-WZ-Image", ignoreCase = true) })
      val events = NetworkProxyRuntime.readNetworkDiagnosticEvents().filter { it.fields["imageTraceId"] == "trace-91827" }
      assertEquals(setOf("fresco", "svg-probe"), events.map { it.fields["imageConsumer"] }.toSet())
      assertEquals(2, events.count { it.fields["phase"] == "image-lease-released" })
      assertEquals(2, events.count { it.fields["phase"] == "response-headers" && it.fields["imageContentType"] == "image" })
      assertTrue(events.any { it.fields["phase"] == "response-body-end" && it.fields["byteCount"] == 5L })
      assertTrue(events.all { it.fields["mediaRef"] == "media-91827" && it.fields["imageSessionId"] == "session-test-91827" })
    }
    val invalid = imageDiagnosticRequest(Request.Builder().url("https://example.com/")
      .header("X-WZ-Image-Trace", "secret-url-cookie").header("X-WZ-Image-Ref", "secret").build(), true)
    assertNull(invalid.tag(ImageDiagnosticTag::class.java)!!.traceId)
    assertNull(invalid.tag(ImageDiagnosticTag::class.java)!!.mediaRef)
  }

  @Test
  fun glideDiagnosticMetadataReachesBothLoadersWithoutBecomingRequestHeaders() {
    for (wrapped in listOf(false, true)) {
      val model = object : expo.modules.image.okhttp.GlideUrlWithDiagnosticHeaders(
        "https://images.example.test/a.png", object : Headers { override fun getHeaders() = emptyMap<String, String>() },
        mapOf("x-wz-image-trace" to "trace-91829", "X-WZ-Image-Ref" to "media-91829", "X-WZ-Image-Session" to "session-test-91829")
      ) { override fun toStringUrl() = "https://images.example.test/a.png" }
      val factory = ControllableGlideCallFactory()
      val fetcher = if (wrapped) CloseSafeGlideUrlWrapperLoader(factory).buildLoadData(GlideUrlWrapper(model), 48, 48, Options()).fetcher
        else CloseSafeGlideUrlLoader(factory).buildLoadData(model, 48, 48, Options()).fetcher
      fetcher.loadData(Priority.NORMAL, RecordingGlideCallback())
      val request = factory.latest.request()
      assertNull(request.header("X-WZ-Image-Trace"))
      assertNull(request.header("X-WZ-Image-Ref"))
      assertNull(request.header("X-WZ-Image-Session"))
      val normalized = imageDiagnosticRequest(request, true)
      assertEquals(ImageDiagnosticTag("trace-91829", "media-91829", "session-test-91829", "glide"), normalized.tag(ImageDiagnosticTag::class.java))
      fetcher.cancel(); fetcher.cleanup()
    }
  }

  @Test
  fun rejectedImageExecutionRecordsOneFailureAndReleasesItsLease() {
    val client = NetworkProxyRuntime.imageClientForTests()
    val generation = NetworkProxyRuntime.currentReadNetworkGeneration()
    client.dispatcher.executorService.shutdown()
    try {
      val done = CountDownLatch(1)
      val call = NetworkProxyRuntime.frescoCallFactory.newCall(Request.Builder().url("https://example.com/image")
        .header("X-WZ-Image-Trace", "trace-91828").build())
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) { done.countDown() }
        override fun onResponse(call: Call, response: Response) { response.close(); done.countDown() }
      })
      assertTrue(done.await(5, TimeUnit.SECONDS))
      val events = NetworkProxyRuntime.readNetworkDiagnosticEvents().filter { it.fields["imageTraceId"] == "trace-91828" }
      val failed = events.single { it.fields["phase"] == "image-call-failed" }
      assertEquals("executor_rejected", failed.fields["imageFailure"])
      assertEquals(generation, failed.fields["generation"])
      assertEquals(1, events.count { it.fields["phase"] == "image-lease-released" })
    } finally { NetworkProxyRuntime.recoverForumReadChannel("linuxdo") }
  }

  @Test
  fun preparedImageCallsExecuteOnCurrentRuntimeAndClonesExecuteIndependently() = withImageServer { url ->
    for (factory in listOf(NetworkProxyRuntime.imageCallFactory, NetworkProxyRuntime.frescoCallFactory)) {
      val before = NetworkProxyRuntime.imageClientForTests()
      val call = factory.newCall(Request.Builder().url(url).build())
      assertFalse(call.isExecuted())
      NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
      awaitImageRuntimeRetirement(before)
      call.execute().use { assertEquals("image", it.body!!.string()) }
      assertTrue(call.isExecuted())
      assertThrows(IllegalStateException::class.java) { call.execute() }
      call.clone().execute().use { assertEquals("image", it.body!!.string()) }
    }
  }

  @Test
  fun responseStreamLeaseSurvivesHeadersAndTwoRotationsUntilEofOrClose() = withImageServer { url ->
    for (closeOnly in listOf(false, true)) {
      val before = NetworkProxyRuntime.imageClientForTests()
      val call = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder().url(url).build())
      val response = AtomicReference<Response>()
      val headers = CountDownLatch(1)
      val callbacks = AtomicInteger()
      call.enqueue(object : Callback {
        override fun onResponse(call: Call, value: Response) { callbacks.incrementAndGet(); response.set(value); headers.countDown() }
        override fun onFailure(call: Call, error: IOException) { callbacks.incrementAndGet(); headers.countDown() }
      })
      assertTrue(headers.await(5, TimeUnit.SECONDS))
      val body = requireNotNull(response.get()).body!!
      try {
        NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
        NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
        Thread.sleep(650)
        assertFalse(before.dispatcher.executorService.isShutdown)
        if (closeOnly) { call.cancel(); assertFalse(before.dispatcher.executorService.isShutdown); body.close() }
        else assertEquals("image", body.string())
        awaitImageRuntimeRetirement(before)
        assertEquals(1, callbacks.get())
      } finally { body.close(); body.close() }
    }
  }

  @Test
  fun imageReadFailureAndPreExecutionCancelReleaseWithoutDuplicateCallbacks() = withImageServer { url ->
    val before = NetworkProxyRuntime.imageClientForTests()
    val broken = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder().url(url + "/broken").build())
    val response = broken.execute()
    NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
    assertThrows(IOException::class.java) { response.body!!.string() }
    response.close()
    val canceled = NetworkProxyRuntime.frescoCallFactory.newCall(Request.Builder().url(url).build())
    canceled.cancel()
    assertTrue(canceled.isCanceled())
    assertThrows(IOException::class.java) { canceled.execute() }
    canceled.clone().execute().close()
    awaitImageRuntimeRetirement(before)
  }

  @Test
  fun imageCallsPreserveCustomTimeoutAndDeadlineAcrossDeferredExecution() = withImageServer { url ->
    for (deadline in listOf(false, true)) {
      val call = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder().url(url + "/slow").build())
      if (deadline) call.timeout().deadline(75, TimeUnit.MILLISECONDS)
      else call.timeout().timeout(75, TimeUnit.MILLISECONDS)
      NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
      assertThrows(IOException::class.java) { call.execute().close() }
    }
  }

  @Test
  fun imageOwnershipCancellationIncludesStreamsButKeepsOtherSourcesAlive() = withImageServer { url ->
    val before = NetworkProxyRuntime.imageClientForTests()
    val same = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder().url(url)
      .header(FORUM_MEDIA_SOURCE_HEADER, "linuxdo").build())
    val other = NetworkProxyRuntime.frescoCallFactory.newCall(Request.Builder().url(url)
      .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek").build())
    val sameResponse = same.execute()
    val otherResponse = other.execute()
    try {
      NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
      assertTrue(same.isCanceled())
      assertFalse(other.isCanceled())
      Thread.sleep(500)
      assertFalse(before.dispatcher.executorService.isShutdown)
      assertEquals("image", otherResponse.body!!.string())
    } finally { sameResponse.close(); otherResponse.close() }
    awaitImageRuntimeRetirement(before)
  }

  @Test
  fun switchingCancelsRegisteredImageBeforeDispatcherEnqueueWithoutLosingItsLease() = withImageServer { url ->
    val field = NetworkProxyRuntime::class.java.getDeclaredField("baseClientTemplate").apply { isAccessible = true }
    val original = field.get(NetworkProxyRuntime) as OkHttpClient
    val started = CountDownLatch(1)
    val proceed = CountDownLatch(1)
    val terminal = CountDownLatch(1)
    val callbacks = AtomicInteger()
    val executor = Executors.newSingleThreadExecutor()
    field.set(NetworkProxyRuntime, original.newBuilder().eventListener(object : okhttp3.EventListener() {
      override fun callStart(call: Call) { started.countDown(); check(proceed.await(5, TimeUnit.SECONDS)) }
    }).build())
    NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
    val before = NetworkProxyRuntime.imageClientForTests()
    val call = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder().url(url)
      .header(FORUM_MEDIA_SOURCE_HEADER, "linuxdo").build())
    try {
      val enqueued = executor.submit {
        call.enqueue(object : Callback {
          override fun onFailure(call: Call, error: IOException) { callbacks.incrementAndGet(); terminal.countDown() }
          override fun onResponse(call: Call, response: Response) { response.close(); callbacks.addAndGet(100); terminal.countDown() }
        })
      }
      assertTrue(started.await(5, TimeUnit.SECONDS))
      assertEquals(0, before.dispatcher.runningCallsCount())
      NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
      assertTrue(call.isCanceled())
      call.cancel()
      Thread.sleep(500)
      assertFalse("cancel cannot retire a call still entering enqueue", before.dispatcher.executorService.isShutdown)
      proceed.countDown()
      enqueued.get(5, TimeUnit.SECONDS)
      assertTrue(terminal.await(5, TimeUnit.SECONDS))
      assertEquals(1, callbacks.get())
      awaitImageRuntimeRetirement(before)
    } finally {
      proceed.countDown(); call.cancel(); executor.shutdownNow()
      field.set(NetworkProxyRuntime, original)
      NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
    }
  }

  @Test
  fun retainedGlideLoaderLoadsUncachedImageAfterRetirement() = withImageServer { url ->
    val before = NetworkProxyRuntime.imageClientForTests()
    val loader = CloseSafeGlideUrlLoader(NetworkProxyRuntime.imageCallFactory)
    val wrapperLoader = CloseSafeGlideUrlWrapperLoader(NetworkProxyRuntime.imageCallFactory)
    NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
    awaitImageRuntimeRetirement(before)
    val model = object : GlideUrl(url, object : Headers { override fun getHeaders() = emptyMap<String, String>() }) {
      override fun toStringUrl() = url
    }
    val fetchers = listOf(
      loader.buildLoadData(model, 100, 100, Options()).fetcher,
      wrapperLoader.buildLoadData(GlideUrlWrapper(model), 100, 100, Options()).fetcher
    )
    for (fetcher in fetchers) {
      val completed = CountDownLatch(1)
      val result = AtomicReference<String>()
      val failure = AtomicReference<Exception>()
      try {
        fetcher.loadData(Priority.NORMAL, object : DataFetcher.DataCallback<InputStream> {
          override fun onDataReady(data: InputStream?) {
            try { result.set(data?.bufferedReader()?.readText()) } finally { completed.countDown() }
          }
          override fun onLoadFailed(error: Exception) { failure.set(error); completed.countDown() }
        })
        assertTrue(completed.await(5, TimeUnit.SECONDS))
        assertNull("retained production loader failed: " + failure.get(), failure.get())
        assertEquals("image", result.get())
      } finally { fetcher.cleanup() }
    }
  }

  @Test
  fun regProxy010PublishesFreshRuntimeBeforeCanceledOldCallReleases() {
    val expectedGeneration = NetworkProxyRuntime.currentReadNetworkGeneration()
    val before = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder()).build()
    val mediaBefore = NetworkProxyRuntime.configureMediaClient(OkHttpClient.Builder()).build()
    val imageBefore = NetworkProxyRuntime.imageClientForTests()
    val dispatcher = before.dispatcher
    val previousMaxRequests = dispatcher.maxRequests
    val previousMaxRequestsPerHost = dispatcher.maxRequestsPerHost
    val started = CountDownLatch(3)
    val release = CountDownLatch(1)
    val completed = CountDownLatch(6)
    val forumClient = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder())
      .addInterceptor { chain ->
        started.countDown()
        release.await(5, TimeUnit.SECONDS)
        responseFor(chain.request())
      }
      .build()
    val activeMediaClient = NetworkProxyRuntime.configureMediaClient(OkHttpClient.Builder())
      .addInterceptor { chain ->
        started.countDown()
        release.await(5, TimeUnit.SECONDS)
        responseFor(chain.request())
      }
      .build()
    val calls = listOf(
      forumClient.newCall(
        Request.Builder()
          .url("https://www.nodeseek.com/running")
          .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
          .build()
      ),
      forumClient.newCall(
        Request.Builder()
          .url("https://www.nodeseek.com/queued")
          .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "content")
          .build()
      ),
      activeMediaClient.newCall(
        Request.Builder()
          .url("https://cdn.example.com/running-image.png")
          .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
          .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
          .build()
      ),
      forumClient.newCall(
        Request.Builder()
          .url("https://www.nodeseek.com/write")
          .post(ByteArray(0).toRequestBody())
          .build()
      ),
      forumClient.newCall(Request.Builder().url("https://linux.do/unrelated").build()),
      forumClient.newCall(
        Request.Builder()
          .url("https://www.nodeseek.com/api/account/status")
          .header(FORUM_READ_SOURCE_HEADER, "nodeseek")
          .header(FORUM_READ_CANCEL_CLASS_HEADER, "health")
          .build()
      )
    )
    val callback = object : Callback {
      override fun onFailure(call: Call, error: IOException) {
        completed.countDown()
      }

      override fun onResponse(call: Call, response: Response) {
        response.close()
        completed.countDown()
      }
    }

    try {
      dispatcher.maxRequests = 3
      dispatcher.maxRequestsPerHost = 1
      calls.forEach { call -> call.enqueue(callback) }
      assertTrue(started.await(5, TimeUnit.SECONDS))

      val recovery = NetworkProxyRuntime.recoverForumReadChannel("nodeseek", expectedGeneration)
      val after = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder()).build()
      val mediaAfter = NetworkProxyRuntime.configureMediaClient(OkHttpClient.Builder()).build()
      val imageAfter = NetworkProxyRuntime.imageClientForTests()

      assertTrue(recovery.rotated)
      assertEquals(expectedGeneration, recovery.previousGeneration)
      assertEquals(expectedGeneration + 1L, recovery.generation)
      assertEquals(1, recovery.canceledQueued)
      assertEquals(2, recovery.canceledRunning)
      assertTrue(calls[0].isCanceled())
      assertTrue(calls[1].isCanceled())
      assertTrue(calls[2].isCanceled())
      assertFalse(calls[3].isCanceled())
      assertFalse(calls[4].isCanceled())
      assertFalse(calls[5].isCanceled())
      assertSame(before.cookieJar, after.cookieJar)
      assertNotSame(before.proxySelector, after.proxySelector)
      assertNotSame(before.dispatcher, after.dispatcher)
      assertNotSame(before.connectionPool, after.connectionPool)
      assertNotSame(mediaBefore.connectionPool, mediaAfter.connectionPool)
      assertNotSame(imageBefore, imageAfter)

      release.countDown()
      assertTrue(completed.await(5, TimeUnit.SECONDS))
      val drainDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
      while (!dispatcher.executorService.isShutdown && System.nanoTime() < drainDeadline) {
        Thread.sleep(25)
      }
      assertTrue("retired runtime must drain after its late calls release", dispatcher.executorService.isShutdown)
      val afterLateRelease = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder()).build()
      assertSame(after.dispatcher, afterLateRelease.dispatcher)
      assertSame(after.connectionPool, afterLateRelease.connectionPool)
    } finally {
      release.countDown()
      calls.forEach { call -> call.cancel() }
      dispatcher.maxRequests = previousMaxRequests
      dispatcher.maxRequestsPerHost = previousMaxRequestsPerHost
    }
  }

  @Test
  fun regProxy010KeepsHealthyVideoRuntimeAliveUntilItsOwnerReleasesTheLease() {
    val expectedGeneration = NetworkProxyRuntime.currentReadNetworkGeneration()
    val leasedClient = ReadNetworkVideoClientRegistry.clientForGeneration(expectedGeneration.toString())
    assertNotNull(leasedClient)
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val mediaClient = NetworkProxyRuntime.configureMediaClient(OkHttpClient.Builder())
      .addInterceptor { chain ->
        started.countDown()
        release.await(5, TimeUnit.SECONDS)
        responseFor(chain.request())
      }
      .build()
    val oldDispatcher = mediaClient.dispatcher
    val completed = CountDownLatch(1)
    val videoCall = mediaClient.newCall(
      Request.Builder()
        .url("https://cdn.example.com/healthy-video.mp4")
        .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
        .header(FORUM_MEDIA_KIND_HEADER, "video")
        .header("Accept", "video/mp4,video/*,*/*;q=0.8")
        .build()
    )
    assertTrue(NetworkProxyRuntime.retainReadNetworkGeneration(expectedGeneration).retained)
    try {
      videoCall.enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
          completed.countDown()
        }

        override fun onResponse(call: Call, response: Response) {
          response.close()
          completed.countDown()
        }
      })
      assertTrue(started.await(5, TimeUnit.SECONDS))

      val recovery = NetworkProxyRuntime.recoverForumReadChannel("nodeseek", expectedGeneration)
      assertTrue(recovery.rotated)
      assertSame(
        "the retained player generation must still resolve its exact client after publication",
        leasedClient,
        ReadNetworkVideoClientRegistry.clientForGeneration(expectedGeneration.toString())
      )
      assertNotSame(
        leasedClient,
        ReadNetworkVideoClientRegistry.clientForGeneration(recovery.generation.toString())
      )
      assertFalse(videoCall.isCanceled())
      assertEquals(0, recovery.canceledQueued)
      assertEquals(0, recovery.canceledRunning)
      release.countDown()
      assertTrue(completed.await(5, TimeUnit.SECONDS))
      Thread.sleep(500)
      assertFalse("a retained healthy player still owns the old runtime", oldDispatcher.executorService.isShutdown)

      assertTrue(NetworkProxyRuntime.releaseReadNetworkGeneration(expectedGeneration))
      val drainDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
      while (!oldDispatcher.executorService.isShutdown && System.nanoTime() < drainDeadline) {
        Thread.sleep(25)
      }
      assertTrue("the old runtime retires after its healthy player is released", oldDispatcher.executorService.isShutdown)
      assertNull(ReadNetworkVideoClientRegistry.clientForGeneration(expectedGeneration.toString()))
    } finally {
      release.countDown()
      videoCall.cancel()
      NetworkProxyRuntime.releaseReadNetworkGeneration(expectedGeneration)
    }
  }

  @Test
  fun regProxy010RejectsAStaleGenerationWhenANewVideoOwnerAcquiresItsLease() {
    val staleGeneration = NetworkProxyRuntime.currentReadNetworkGeneration()
    val recovery = NetworkProxyRuntime.recoverForumReadChannel("nodeseek", staleGeneration)
    assertTrue(recovery.rotated)

    val staleLease = NetworkProxyRuntime.retainReadNetworkGeneration(staleGeneration)
    assertFalse(staleLease.retained)
    assertEquals(recovery.generation, staleLease.generation)

    val currentLease = NetworkProxyRuntime.retainReadNetworkGeneration(staleLease.generation)
    assertTrue(currentLease.retained)
    assertEquals(recovery.generation, currentLease.generation)
    assertTrue(NetworkProxyRuntime.releaseReadNetworkGeneration(currentLease.generation))
  }

  @Test
  fun regProxy010TreatsAnActiveCronetBodyAsOutstandingRuntimeWork() {
    val expectedGeneration = NetworkProxyRuntime.currentReadNetworkGeneration()
    val activeBodies = AtomicInteger(1)
    val retireCalls = AtomicInteger(0)
    val retiredWithCancellation = AtomicBoolean(true)
    val transport = object : CronetMediaTransportHandle {
      override val generation = expectedGeneration * 1_000_000L

      override fun execute(request: Request, outerCall: Call): Response? = null

      override fun activeCallsCount(): Int = activeBodies.get()

      override fun retire(cancelActive: Boolean) {
        retiredWithCancellation.set(cancelActive)
        retireCalls.incrementAndGet()
      }
    }
    assertTrue(NetworkProxyRuntime.installCronetMediaTransportForTests(expectedGeneration, transport))
    val oldDispatcher = NetworkProxyRuntime.configureMediaClient(OkHttpClient.Builder()).build().dispatcher

    val recovery = NetworkProxyRuntime.recoverForumReadChannel("nodeseek", expectedGeneration)
    assertTrue(recovery.rotated)
    Thread.sleep(500)
    assertFalse("an open Cronet body must keep its runtime alive", oldDispatcher.executorService.isShutdown)
    assertEquals(0, retireCalls.get())

    activeBodies.set(0)
    val drainDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while (!oldDispatcher.executorService.isShutdown && System.nanoTime() < drainDeadline) {
      Thread.sleep(25)
    }
    assertTrue("the runtime retires after its Cronet body closes", oldDispatcher.executorService.isShutdown)
    assertEquals(1, retireCalls.get())
    assertFalse("normal generation retirement must not cancel an active Cronet call", retiredWithCancellation.get())
  }

  @Test
  fun regProxy010RejectsInvalidRecoveryTraceAndGenerationValues() {
    assertEquals("trace-42", requireReadNetworkTraceIdentity("trace-42"))
    listOf("", " trace-42 ", "trace-0", "trace-01", "trace-12345678901", "native/raw", "xyz").forEach { value ->
      assertThrows(IllegalArgumentException::class.java) {
        requireReadNetworkTraceIdentity(value)
      }
    }
    val generationBeforeInvalidTrace = NetworkProxyRuntime.currentReadNetworkGeneration()
    assertThrows(IllegalArgumentException::class.java) {
      NetworkProxyRuntime.recoverForumReadChannel("nodeseek", generationBeforeInvalidTrace, " trace-42 ")
    }
    assertEquals(generationBeforeInvalidTrace, NetworkProxyRuntime.currentReadNetworkGeneration())
    assertEquals(42L, requireReadNetworkGeneration(42.0))
    listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0, 1.5, Double.MAX_VALUE).forEach { value ->
      assertThrows(IllegalArgumentException::class.java) {
        requireReadNetworkGeneration(value)
      }
    }
  }

  @Test
  fun regProxy010RecordsIntentBeforePublishingTheRuntime() {
    val traceIdentity = "abc12345"
    val before = NetworkProxyRuntime.readNetworkDiagnosticEvents().size

    NetworkProxyRuntime.recoverForumReadChannel(
      "nodeseek",
      NetworkProxyRuntime.currentReadNetworkGeneration(),
      traceIdentity
    )

    val phases = NetworkProxyRuntime.readNetworkDiagnosticEvents()
      .drop(before)
      .filter { event -> event.fields["traceIdentity"] == traceIdentity }
      .map { event -> event.fields["phase"] }
    assertEquals(listOf("intent", "publish", "cancel"), phases.take(3))
  }

  @Test
  fun regProxy010RecordsTheTerminalOnlyAfterJsApplyIsAcknowledgedAndTheOldRuntimeDrains() {
    val traceIdentity = "trace-4242"
    val before = NetworkProxyRuntime.readNetworkDiagnosticEvents().size
    val previousGeneration = NetworkProxyRuntime.currentReadNetworkGeneration()
    val recovery = NetworkProxyRuntime.recoverForumReadChannel(
      "nodeseek",
      previousGeneration,
      traceIdentity
    )
    assertTrue(recovery.rotated)

    Thread.sleep(500)
    assertFalse(NetworkProxyRuntime.readNetworkDiagnosticEvents().drop(before).any { event ->
      event.fields["traceIdentity"] == traceIdentity && event.fields["phase"] == "finish"
    })
    assertTrue(
      NetworkProxyRuntime.acknowledgeReadNetworkRuntimeApply(
        traceIdentity,
        recovery.previousGeneration,
        recovery.generation
      )
    )

    val finishDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while (
      NetworkProxyRuntime.readNetworkDiagnosticEvents().drop(before).none { event ->
        event.fields["traceIdentity"] == traceIdentity && event.fields["phase"] == "finish"
      } && System.nanoTime() < finishDeadline
    ) {
      Thread.sleep(25)
    }
    val terminal = NetworkProxyRuntime.readNetworkDiagnosticEvents().drop(before).filter { event ->
      event.fields["traceIdentity"] == traceIdentity && event.fields["phase"] == "finish"
    }
    assertEquals(1, terminal.size)
    assertEquals("retired", terminal.single().fields["outcome"])
  }

  @Test
  fun regProxy010UnsupportedSourceStillRecordsOneTerminalAfterIntent() {
    val traceIdentity = "deadbeef"
    val before = NetworkProxyRuntime.readNetworkDiagnosticEvents().size

    assertThrows(IllegalArgumentException::class.java) {
      NetworkProxyRuntime.recoverForumReadChannel(
        "private-invalid-source",
        NetworkProxyRuntime.currentReadNetworkGeneration(),
        traceIdentity
      )
    }

    val events = NetworkProxyRuntime.readNetworkDiagnosticEvents()
      .drop(before)
      .filter { event -> event.fields["traceIdentity"] == traceIdentity }
    assertEquals(listOf("intent", "finish"), events.map { event -> event.fields["phase"] })
    assertEquals("failure", events.last().fields["outcome"])
    assertFalse(events.any { event -> event.fields["source"] == "private-invalid-source" })
  }

  @Test
  fun regProxy010UsesGenerationCasAcrossConcurrentSources() {
    val expectedGeneration = NetworkProxyRuntime.currentReadNetworkGeneration()
    val ready = CountDownLatch(2)
    val start = CountDownLatch(1)
    val executor = Executors.newFixedThreadPool(2)
    try {
      val recoveries = listOf("nodeseek", "linuxdo").map { source ->
        executor.submit<ForumReadChannelRecovery> {
          ready.countDown()
          start.await()
          NetworkProxyRuntime.recoverForumReadChannel(source, expectedGeneration)
        }
      }
      assertTrue(ready.await(2, TimeUnit.SECONDS))
      start.countDown()
      val results = recoveries.map { recovery -> recovery.get(5, TimeUnit.SECONDS) }
      val rotated = results.single { result -> result.rotated }
      val stale = results.single { result -> !result.rotated }

      assertEquals(expectedGeneration, stale.previousGeneration)
      assertEquals(rotated.generation, stale.generation)
      assertEquals(expectedGeneration + 1L, rotated.generation)
      assertEquals(rotated.generation, NetworkProxyRuntime.currentReadNetworkGeneration())
    } finally {
      start.countDown()
      executor.shutdownNow()
    }
  }

  @Test
  fun imageLoaderInstallationWaitsForMainThreadCompletion() {
    val postedAction = AtomicReference<(() -> Unit)?>()
    val published = AtomicBoolean(false)
    val executor = Executors.newSingleThreadExecutor()
    try {
      val result = executor.submit {
        awaitImageLoaderInstallation(
          false,
          postToMainThread = { action ->
            postedAction.set(action)
            true
          },
          publish = { published.set(true) }
        )
      }
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
      while (postedAction.get() == null && System.nanoTime() < deadline) Thread.sleep(10)
      assertNotNull(postedAction.get())
      assertFalse(result.isDone)

      postedAction.get()!!.invoke()

      result.get(5, TimeUnit.SECONDS)
      assertTrue(published.get())
    } finally {
      executor.shutdownNow()
    }
  }

  @Test
  fun readNetworkDiagnosticsContainPhasesWithoutUrlsIpsOrCookies() {
    val secretPath = "private-topic-secret-91827"
    val client = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder())
      .addInterceptor { chain -> responseFor(chain.request()) }
      .build()

    client.newCall(
      Request.Builder()
        .url("https://www.nodeseek.com/" + secretPath)
        .header("Cookie", "session=must-not-leak")
        .build()
    ).execute().close()

    val diagnostics = NetworkProxyRuntime.readNetworkDiagnosticEvents()
    assertTrue(diagnostics.any { event -> event.fields["phase"] == "call-start" })
    assertTrue(diagnostics.any { event -> event.fields["phase"] == "call-end" })
    assertTrue(diagnostics.any { event -> event.fields["dispatcherId"] is String })
    val serialized = diagnostics.toString()
    assertFalse(serialized.contains(secretPath))
    assertFalse(serialized.contains("must-not-leak"))
    assertFalse(diagnostics.any { event -> event.fields.keys.any { key -> key.contains("url", true) || key == "ip" } })
  }

  @Test
  fun presenceDiagnosticsUseTheActuallySentHeaders() {
    val client = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder()).build()
    val initial = Request.Builder().url("https://linux.do/topics/timings")
      .header("X-Requested-With", "XMLHttpRequest")
      .header("X-WZ-Diagnostic-Session", "session-presence-test")
      .header("X-WZ-Diagnostic-Trace", "trace-981")
      .header("X-WZ-Diagnostic-Request", "request-981").build()
    val call = client.newCall(initial)
    val listener = client.eventListenerFactory.create(call)
    listener.requestHeadersEnd(call, initial.newBuilder().header("Discourse-Present", "true").build())
    listener.requestHeadersEnd(call, initial)
    listener.requestHeadersEnd(call, initial.newBuilder().url("https://connect.linux.do/").build())
    val fields = NetworkProxyRuntime.readNetworkDiagnosticEvents()
      .filter { it.fields["phase"] == "request-headers-end" && it.fields["requestId"] == "request-981" }
      .map { DiagnosticJournal.safeNetworkFields(it.fields) }
    assertEquals(listOf(true, false, null), fields.map { it["hasDiscoursePresent"] })
    assertTrue(fields.all { it["traceId"] == "trace-981" })
  }

  @Test
  fun reactNativeCannotReplaceOrRemoveTheReadOnlyCookieJar() {
    val url = "https://www.nodeseek.com/private".toHttpUrl()
    val container = ReadOnlyCookieJarContainer(
      JavaNetCookieJar(ReadOnlyWebViewCookieHandler { "session=live" })
    )

    container.setCookieJar(okhttp3.CookieJar.NO_COOKIES)
    container.removeCookieJar()

    assertEquals(listOf("session"), container.loadForRequest(url).map { it.name })
  }

  @Test
  fun startsBlockedUntilPersistedProxyStateIsApplied() {
    val proxy = NetworkProxyRuntime.currentLocalProxy()

    assertNotNull("native startup must fail closed", proxy)
    assertEquals(Proxy.Type.HTTP, proxy?.type())
    assertEquals(9, (proxy?.address() as InetSocketAddress).port)
  }

  @Test
  fun invalidationClaimsTheActiveProbeAndRejectsLateRegistration() {
    val released = mutableListOf<Any>()
    val probes = InvalidatableResourceSlot<Any> { released.add(it) }
    val active = Any()
    val late = Any()

    assertTrue(probes.register(active))
    assertSame(active, probes.invalidate())
    assertFalse(probes.register(late))
    assertEquals(listOf(late), released)
    assertNull(probes.invalidate())
  }

  @Test
  fun webViewProxyOperationFailsWhenItsCallbackNeverArrives() {
    val completion = AtomicReference<(() -> Unit)?>()
    val restoreCalls = AtomicInteger()
    val error = assertThrows(IllegalStateException::class.java) {
      awaitWebViewProxyOperation(
        "WebView 代理清除超时",
        10,
        onTimeoutOrLateCompletion = { restoreCalls.incrementAndGet() }
      ) { complete ->
        completion.set(complete)
      }
    }

    assertEquals("WebView 代理清除超时", error.message)
    assertEquals("timeout must immediately restore the fail-closed WebView state", 1, restoreCalls.get())

    completion.get()?.invoke()

    assertEquals("a late platform completion must restore the current WebView state again", 2, restoreCalls.get())
  }

  @Test
  fun interruptedWebViewWaitAlsoRestoresAfterALateCompletion() {
    val completion = AtomicReference<(() -> Unit)?>()
    val operationStarted = CountDownLatch(1)
    val interrupted = AtomicBoolean(false)
    val restoreCalls = AtomicInteger()
    val waiter = Thread {
      try {
        awaitWebViewProxyOperation(
          "WebView 代理设置被中断",
          10_000,
          onTimeoutOrLateCompletion = { restoreCalls.incrementAndGet() }
        ) { complete ->
          completion.set(complete)
          operationStarted.countDown()
        }
      } catch (_: InterruptedException) {
        interrupted.set(true)
      }
    }
    waiter.start()
    assertTrue("the WebView operation must start", operationStarted.await(2, TimeUnit.SECONDS))

    waiter.interrupt()
    waiter.join(2_000)

    assertTrue("interrupting bridge teardown must release the wait", interrupted.get())
    assertEquals("interrupt must immediately restore the current WebView state", 1, restoreCalls.get())

    completion.get()?.invoke()

    assertEquals("a completion after bridge teardown must restore the current state again", 2, restoreCalls.get())
  }

  @Test
  fun serializedWebViewOperationsPreventAnOlderRestoreFromWinning() {
    val operations = SerializedWebViewProxyOperations()
    val runtimePort = AtomicInteger(1)
    val webViewPort = AtomicInteger(0)
    val oldRestoreRead = CountDownLatch(1)
    val releaseOldRestore = CountDownLatch(1)
    val newSyncEntered = CountDownLatch(1)
    val executor = Executors.newFixedThreadPool(2)
    try {
      val oldRestore = executor.submit {
        operations.run {
          val oldPort = runtimePort.get()
          oldRestoreRead.countDown()
          releaseOldRestore.await()
          webViewPort.set(oldPort)
        }
      }
      assertTrue(oldRestoreRead.await(2, TimeUnit.SECONDS))
      runtimePort.set(2)
      val newSync = executor.submit {
        operations.run {
          newSyncEntered.countDown()
          webViewPort.set(runtimePort.get())
        }
      }

      assertFalse("a newer bridge must wait for the older WebView operation", newSyncEntered.await(100, TimeUnit.MILLISECONDS))
      releaseOldRestore.countDown()
      oldRestore.get(2, TimeUnit.SECONDS)
      newSync.get(2, TimeUnit.SECONDS)

      assertEquals("the final WebView state must match the latest runtime", 2, webViewPort.get())
    } finally {
      releaseOldRestore.countDown()
      executor.shutdownNow()
    }
  }

  @Test
  fun staleBridgeCannotWriteWebViewAfterTheNewBridgeHasSynchronized() {
    val operations = SerializedWebViewProxyOperations()
    val registry = OwnedProxyServerRegistry()
    val webViewPort = AtomicInteger(0)
    registry.register(1)
    registry.begin(1) {}
    registry.register(2)
    registry.begin(2) {}
    registry.commit(2, null) {}
    operations.run {
      registry.requireCurrent(2)
      webViewPort.set(2)
    }

    assertThrows(IllegalStateException::class.java) {
      operations.run {
        registry.requireCurrent(1)
        webViewPort.set(1)
      }
    }

    assertEquals("a stale normal operation must not overwrite the newer WebView state", 2, webViewPort.get())
  }

  @Test
  fun lateWebViewRecoveryRetriesOnlyAfterARealProxyStateChange() {
    val registry = OwnedProxyServerRegistry()
    val retryCalls = AtomicInteger()
    val completionWithoutChange = AtomicReference<(() -> Unit)?>()
    val stableGeneration = registry.generation()
    assertThrows(IllegalStateException::class.java) {
      awaitWebViewProxyOperation(
        "WebView 代理恢复超时",
        10,
        onLateCompletion = {
          restoreWebViewProxyIfStateChanged(registry, stableGeneration) { retryCalls.incrementAndGet() }
        }
      ) { complete ->
        completionWithoutChange.set(complete)
      }
    }
    completionWithoutChange.get()?.invoke()
    assertEquals("a late recovery for the same state must not schedule itself again", 0, retryCalls.get())

    val completionAfterChange = AtomicReference<(() -> Unit)?>()
    val oldGeneration = registry.generation()
    assertThrows(IllegalStateException::class.java) {
      awaitWebViewProxyOperation(
        "WebView 代理恢复超时",
        10,
        onLateCompletion = {
          restoreWebViewProxyIfStateChanged(registry, oldGeneration) { retryCalls.incrementAndGet() }
        }
      ) { complete ->
        completionAfterChange.set(complete)
      }
    }
    registry.register(1)
    registry.begin(1) {}
    completionAfterChange.get()?.invoke()

    assertEquals("a late recovery must re-read state after a genuine transition", 1, retryCalls.get())
  }

  @Test
  fun newerBridgeRegistrationInvalidatesAnOlderCommit() {
    val registry = OwnedProxyServerRegistry()
    val oldServer = LocalNetworkProxyServer(NetworkProxyProfile("http", "127.0.0.1", 1, null, null))
    try {
      registry.register(1)
      registry.begin(1) {}
      registry.register(2)

      assertFalse("an older bridge must not publish after a newer bridge exists", registry.commit(1, oldServer) {})
    } finally {
      oldServer.stop()
    }
  }

  @Test
  fun olderBridgeCannotReleaseTheNewerBridgeServer() {
    val registry = OwnedProxyServerRegistry()
    val oldServer = LocalNetworkProxyServer(NetworkProxyProfile("http", "127.0.0.1", 1, null, null))
    val newServer = LocalNetworkProxyServer(NetworkProxyProfile("http", "127.0.0.1", 1, null, null))
    var staleReleaseBlockedNetwork = false
    try {
      registry.register(1)
      registry.begin(1) {}
      assertTrue(registry.commit(1, oldServer) {})

      registry.register(2)
      assertThrows(IllegalStateException::class.java) {
        registry.begin(1) {}
      }
      assertSame(oldServer, registry.begin(2) {})
      assertTrue(registry.commit(2, newServer) {})

      assertNull(registry.release(1) { staleReleaseBlockedNetwork = true })
      assertFalse("a stale bridge must not alter the active runtime", staleReleaseBlockedNetwork)
      assertSame(newServer, registry.release(2) {})
    } finally {
      oldServer.stop()
      newServer.stop()
    }
  }

  @Test
  fun connectivityProbeRequiresTheExpectedHttpResponse() {
    assertThrows(java.io.IOException::class.java) {
      validateProxyHealthResponse(ByteArrayInputStream(ByteArray(0)))
    }
    assertThrows(java.io.IOException::class.java) {
      validateProxyHealthResponse(ByteArrayInputStream("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".toByteArray()))
    }

    validateProxyHealthResponse(ByteArrayInputStream("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n".toByteArray()))
  }

  @Test
  fun successfulConnectTunnelStillPerformsTlsHostnameAndHttpVerification() {
    val upstreamListener = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val upstreamExecutor = Executors.newSingleThreadExecutor()
    val events = mutableListOf<String>()
    val request = ByteArrayOutputStream()
    upstreamExecutor.execute {
      val accepted = upstreamListener.accept()
      try {
        val reader = accepted.getInputStream().bufferedReader()
        while (!reader.readLine().isNullOrEmpty()) {
        }
        accepted.getOutputStream().apply {
          write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
          flush()
        }
      } finally {
        accepted.close()
      }
    }
    val probe = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", upstreamListener.localPort, null, null),
      tlsConnectionFactory = { tunnel, host, port ->
        events.add("factory:" + host + ":" + port)
        object : ProxyTlsConnection {
          override val socket = tunnel

          override fun setReadTimeout(timeoutMs: Int) {
            events.add("timeout:" + timeoutMs)
          }

          override fun enableHttpsHostnameVerification() {
            events.add("hostname")
          }

          override fun startHandshake() {
            events.add("handshake")
          }

          override fun outputStream() = request.also { events.add("output") }

          override fun inputStream() = ByteArrayInputStream(
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n".toByteArray()
          ).also { events.add("input") }
        }
      }
    )
    try {
      probe.test()

      assertEquals(
        listOf("factory:www.gstatic.com:443", "timeout:15000", "hostname", "handshake", "output", "input"),
        events
      )
      val requestText = request.toString(Charsets.ISO_8859_1.name())
      assertTrue(requestText.startsWith("GET /generate_204 HTTP/1.1\r\n"))
      assertTrue(requestText.contains("Host: www.gstatic.com\r\n"))
      assertTrue(requestText.endsWith("Connection: close\r\n\r\n"))
    } finally {
      probe.stop()
      upstreamListener.close()
      upstreamExecutor.shutdownNow()
    }
  }

  @Test
  fun stopInterruptsAnUpstreamConnectionAttempt() {
    val connectStarted = CountDownLatch(1)
    val observedClosed = CountDownLatch(1)
    val probeFinished = CountDownLatch(1)
    val probeExecutor = Executors.newSingleThreadExecutor()
    val probe = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", 1, null, null),
      socketConnector = { socket, _, _ ->
        connectStarted.countDown()
        while (!socket.isClosed) {
          Thread.sleep(5)
        }
        observedClosed.countDown()
        throw SocketException("closed by proxy stop")
      }
    )
    try {
      probeExecutor.execute {
        try {
          probe.test()
        } catch (_: Exception) {
        } finally {
          probeFinished.countDown()
        }
      }
      assertTrue("the local connector must begin", connectStarted.await(2, TimeUnit.SECONDS))

      probe.stop()

      assertTrue("stop must close a socket while connect is still blocked", observedClosed.await(2, TimeUnit.SECONDS))
      assertTrue("closing the connecting socket must release the probe", probeFinished.await(2, TimeUnit.SECONDS))
    } finally {
      probe.stop()
      probeExecutor.shutdownNow()
    }
  }

  @Test
  fun stopClosesAcceptedClientSockets() {
    val server = LocalNetworkProxyServer(NetworkProxyProfile("http", "127.0.0.1", 1, null, null))
    server.start()
    val client = Socket("127.0.0.1", server.port)
    try {
      client.getOutputStream().write("G".toByteArray())
      Thread.sleep(100)

      server.stop()
      client.soTimeout = 2_000
      val closed = try {
        client.getInputStream().read() == -1
      } catch (_: SocketException) {
        true
      }

      assertTrue("stopping the proxy must close accepted client sockets", closed)
    } finally {
      client.close()
      server.stop()
    }
  }

  @Test
  fun regProxy007StopOverlapsConnectionWorkerCleanupWithoutBackgroundFailure() {
    val connectorStarted = CountDownLatch(1)
    val connectorReleased = CountDownLatch(1)
    val stopFinished = CountDownLatch(1)
    val connectionWorker = AtomicReference<Thread?>()
    val backgroundFailure = AtomicReference<Throwable?>(null)
    val previousUncaughtHandler = Thread.getDefaultUncaughtExceptionHandler()
    val stopExecutor = Executors.newSingleThreadExecutor()
    val server = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", 1, null, null),
      socketConnector = { socket, _, _ ->
        connectionWorker.set(Thread.currentThread())
        connectorStarted.countDown()
        while (!socket.isClosed) {
          try {
            Thread.sleep(5)
          } catch (_: InterruptedException) {
            if (!socket.isClosed) throw SocketException("connector interrupted before stop")
            Thread.currentThread().interrupt()
          }
        }
        connectorReleased.countDown()
        throw SocketException("closed by proxy stop")
      }
    )
    Thread.setDefaultUncaughtExceptionHandler { _, error ->
      backgroundFailure.compareAndSet(null, error)
    }
    server.start()
    val client = Socket("127.0.0.1", server.port)
    try {
      client.getOutputStream().apply {
        write("GET http://example.invalid/ HTTP/1.1\r\nHost: example.invalid\r\n\r\n".toByteArray())
        flush()
      }
      assertTrue("the connection worker must begin", connectorStarted.await(2, TimeUnit.SECONDS))

      stopExecutor.execute {
        try {
          server.stop()
        } catch (error: Throwable) {
          backgroundFailure.compareAndSet(null, error)
        } finally {
          stopFinished.countDown()
        }
      }

      assertTrue("stop must release the active connection worker", connectorReleased.await(2, TimeUnit.SECONDS))
      assertTrue("stop must finish while the worker unwinds", stopFinished.await(2, TimeUnit.SECONDS))
      val worker = requireNotNull(connectionWorker.get())
      worker.join(2_000)
      assertFalse("the connection worker must terminate before cleanup is asserted", worker.isAlive)
      client.soTimeout = 2_000
      val clientClosed = try {
        client.getInputStream().read() == -1
      } catch (_: SocketException) {
        true
      }
      assertTrue("stop must close the accepted client", clientClosed)
      assertNull("worker cleanup must not escape a background exception", backgroundFailure.get())
    } finally {
      client.close()
      server.stop()
      stopExecutor.shutdownNow()
      Thread.setDefaultUncaughtExceptionHandler(previousUncaughtHandler)
    }
  }

  @Test
  fun stopClosesUpstreamSocketsForEstablishedTunnels() {
    val upstreamListener = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val upstreamExecutor = Executors.newSingleThreadExecutor()
    val upstreamSocket = AtomicReference<Socket?>()
    val upstreamClosed = CountDownLatch(1)
    upstreamExecutor.execute {
      val accepted = upstreamListener.accept()
      upstreamSocket.set(accepted)
      try {
        val reader = accepted.getInputStream().bufferedReader()
        while (!reader.readLine().isNullOrEmpty()) {
        }
        accepted.getOutputStream().apply {
          write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
          flush()
        }
        try {
          if (reader.read() == -1) {
            upstreamClosed.countDown()
          }
        } catch (_: SocketException) {
          upstreamClosed.countDown()
        }
      } finally {
        accepted.close()
      }
    }
    val server = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", upstreamListener.localPort, null, null)
    )
    server.start()
    val client = Socket("127.0.0.1", server.port)
    try {
      client.soTimeout = 2_000
      client.getOutputStream().apply {
        write("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n".toByteArray())
        flush()
      }
      val reader = client.getInputStream().bufferedReader()
      assertTrue(reader.readLine().contains("200 Connection Established"))
      while (!reader.readLine().isNullOrEmpty()) {
      }

      server.stop()

      assertTrue("stopping the proxy must close its upstream tunnel socket", upstreamClosed.await(2, TimeUnit.SECONDS))
    } finally {
      client.close()
      server.stop()
      upstreamSocket.get()?.close()
      upstreamListener.close()
      upstreamExecutor.shutdownNow()
    }
  }

  @Test
  fun failedUpstreamHandshakeClosesSocketImmediately() {
    val upstreamListener = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val upstreamExecutor = Executors.newSingleThreadExecutor()
    val upstreamClosed = CountDownLatch(1)
    upstreamExecutor.execute {
      val accepted = upstreamListener.accept()
      try {
        val reader = accepted.getInputStream().bufferedReader()
        while (!reader.readLine().isNullOrEmpty()) {
        }
        accepted.getOutputStream().apply {
          write("HTTP/1.1 200 Connection Established\r\n".toByteArray())
          flush()
        }
        accepted.shutdownOutput()
        try {
          if (reader.read() == -1) {
            upstreamClosed.countDown()
          }
        } catch (_: SocketException) {
          upstreamClosed.countDown()
        }
      } finally {
        accepted.close()
      }
    }
    val probe = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", upstreamListener.localPort, null, null)
    )
    try {
      assertThrows(java.io.IOException::class.java) {
        probe.test()
      }

      assertTrue(
        "a failed upstream handshake must release its socket without waiting for server shutdown",
        upstreamClosed.await(2, TimeUnit.SECONDS)
      )
    } finally {
      probe.stop()
      upstreamListener.close()
      upstreamExecutor.shutdownNow()
    }
  }

  @Test
  fun regProxy007RejectsUnsafeLocalRelayTargets() {
    fun request(line: String, host: String): String =
      line + "\r\nHost: " + host + "\r\n\r\n"

    assertEquals(
      ProxyTarget("example.invalid", 443),
      parseLocalProxyRequest(request(
        "CONNECT example.invalid:443 HTTP/1.1",
        "example.invalid:443"
      )).target
    )
    assertEquals(
      ProxyTarget("8.8.8.8", 80),
      parseLocalProxyRequest(request(
        "GET http://8.8.8.8/path HTTP/1.1",
        "8.8.8.8"
      )).target
    )

    val unsafe = listOf(
      request("CONNECT example.invalid:444 HTTP/1.1", "example.invalid:444"),
      request("CONNECT example.invalid HTTP/1.1", "example.invalid"),
      request("GET https://example.invalid/ HTTP/1.1", "example.invalid"),
      request("GET http://example.invalid:8080/ HTTP/1.1", "example.invalid:8080"),
      request("GET http://user@example.invalid/ HTTP/1.1", "example.invalid"),
      request("GET http:///missing-host HTTP/1.1", ""),
      request("GET http://example.invalid/ HTTP/2", "example.invalid"),
      request("GET  http://example.invalid/ HTTP/1.1", "example.invalid"),
      request("GET http://example.invalid/ HTTP/1.1", "different.invalid"),
      "POST http://example.invalid/ HTTP/1.1\r\nHost: example.invalid\r\nTransfer-Encoding: chunked\r\n\r\n",
      "POST http://example.invalid/ HTTP/1.1\r\nHost: example.invalid\r\nContent-Length: 4\r\nContent-Length: 4\r\n\r\n",
      "POST http://example.invalid/ HTTP/1.1\r\nHost: example.invalid\r\nContent-Length: 4, 4\r\n\r\n",
      request("GET http://localhost/ HTTP/1.1", "localhost"),
      request("GET http://127.0.0.1/ HTTP/1.1", "127.0.0.1"),
      request("GET http://001.1.1.1/ HTTP/1.1", "001.1.1.1"),
      request("GET http://017.1.1.1/ HTTP/1.1", "017.1.1.1"),
      request("GET http://0177.0.0.1/ HTTP/1.1", "0177.0.0.1"),
      request("GET http://0x7f000001/ HTTP/1.1", "0x7f000001"),
      request("GET http://0x7f.0x0.0x0.0x1/ HTTP/1.1", "0x7f.0x0.0x0.0x1"),
      request("GET http://10.0.0.1/ HTTP/1.1", "10.0.0.1"),
      request("GET http://172.16.0.1/ HTTP/1.1", "172.16.0.1"),
      request("GET http://192.168.0.1/ HTTP/1.1", "192.168.0.1"),
      request("GET http://169.254.1.1/ HTTP/1.1", "169.254.1.1"),
      request("GET http://224.0.0.1/ HTTP/1.1", "224.0.0.1"),
      request("CONNECT [::]:443 HTTP/1.1", "[::]:443"),
      request("CONNECT [::1]:443 HTTP/1.1", "[::1]:443"),
      request("CONNECT [fe80::1]:443 HTTP/1.1", "[fe80::1]:443"),
      request("CONNECT [fc00::1]:443 HTTP/1.1", "[fc00::1]:443"),
      request("CONNECT [ff02::1]:443 HTTP/1.1", "[ff02::1]:443"),
      request(
        "CONNECT bad" + 0.toChar() + ".invalid:443 HTTP/1.1",
        "bad.invalid:443"
      )
    )

    unsafe.forEach { header ->
      assertThrows(IllegalArgumentException::class.java) {
        parseLocalProxyRequest(header)
      }
    }
  }

  @Test
  fun regProxy007RejectsIpv4EmbeddedIpv6Targets() {
    fun request(authority: String): String =
      "CONNECT " + authority + " HTTP/1.1\r\nHost: " + authority + "\r\n\r\n"

    assertEquals(
      ProxyTarget("2001:db8::1", 443),
      parseLocalProxyRequest(request("[2001:db8::1]:443")).target
    )

    listOf(
      "[::127.0.0.1]:443",
      "[::10.0.0.1]:443",
      "[::8.8.8.8]:443",
      "[::ffff:127.0.0.1]:443",
      "[::ffff:10.0.0.1]:443",
      "[::ffff:8.8.8.8]:443",
      "[0:0:0:0:0:ffff:7f00:1]:443"
    ).forEach { authority ->
      assertThrows(IllegalArgumentException::class.java) {
        parseLocalProxyRequest(request(authority))
      }
    }
  }

  @Test
  fun regProxy007FormatsIpv6AuthorityForHttpUpstreamConnect() {
    val received = AtomicReference("")
    val upstreamListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val upstreamExecutor = Executors.newSingleThreadExecutor()
    upstreamExecutor.execute {
      upstreamListener.accept().use { accepted ->
        received.set(readHeaderBlock(accepted.getInputStream()))
        accepted.getOutputStream().apply {
          write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
          flush()
        }
      }
    }
    val server = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", upstreamListener.localPort, null, null)
    )
    server.start()
    try {
      Socket("127.0.0.1", server.port).use { client ->
        client.soTimeout = 2_000
        client.getOutputStream().apply {
          write(
            (
              "CONNECT [2001:db8::1]:443 HTTP/1.1\r\n"
                + "Host: [2001:db8::1]:443\r\n\r\n"
            ).toByteArray()
          )
          flush()
        }
        assertTrue(readHeaderBlock(client.getInputStream()).startsWith("HTTP/1.1 200 "))
      }
      assertTrue(received.get().startsWith("CONNECT [2001:db8::1]:443 HTTP/1.1\r\n"))
      assertTrue(received.get().contains("Host: [2001:db8::1]:443\r\n"))
    } finally {
      server.stop()
      upstreamListener.close()
      upstreamExecutor.shutdownNow()
    }
  }

  @Test
  fun regProxy007EnforcesThe64KiBHeaderLimit() {
    val prefix = "GET http://example.invalid/ HTTP/1.1\r\nHost: example.invalid\r\nX-Fill: "
    val suffix = "\r\n\r\n"
    val fillSize = 64 * 1024 -
      prefix.toByteArray(Charsets.ISO_8859_1).size -
      suffix.toByteArray(Charsets.ISO_8859_1).size
    val exact = prefix + "a".repeat(fillSize) + suffix
    val oversized = prefix + "a".repeat(fillSize + 1) + suffix

    assertEquals(64 * 1024, exact.toByteArray(Charsets.ISO_8859_1).size)
    assertEquals(exact, readHeaderBlock(ByteArrayInputStream(exact.toByteArray(Charsets.ISO_8859_1))))
    assertThrows(java.io.IOException::class.java) {
      readHeaderBlock(ByteArrayInputStream(oversized.toByteArray(Charsets.ISO_8859_1)))
    }
  }

  @Test
  fun regProxy007DoesNotForwardAPipelinedSecondTarget() {
    val received = AtomicReference("")
    val upstreamListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val upstreamExecutor = Executors.newSingleThreadExecutor()
    upstreamExecutor.execute {
      upstreamListener.accept().use { accepted ->
        accepted.soTimeout = 500
        val input = accepted.getInputStream()
        val firstHeader = readHeaderBlock(input)
        val extra = ByteArrayOutputStream()
        try {
          while (true) {
            val value = input.read()
            if (value < 0) break
            extra.write(value)
          }
        } catch (_: SocketTimeoutException) {
        }
        received.set(firstHeader + extra.toString(Charsets.ISO_8859_1.name()))
        accepted.getOutputStream().apply {
          write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
          flush()
        }
      }
    }
    val server = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", upstreamListener.localPort, null, null)
    )
    server.start()
    val client = Socket("127.0.0.1", server.port)
    try {
      client.soTimeout = 2_000
      client.getOutputStream().apply {
        write((
          "POST http://example.invalid/ HTTP/1.1\r\n" +
          "Host: example.invalid\r\n" +
          "Connection: keep-alive\r\n" +
          "Proxy-Connection: keep-alive\r\n" +
          "Keep-Alive: timeout=5\r\n" +
          "Content-Length: 4\r\n\r\n" +
          "body" +
          "GET http://127.0.0.1/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        ).toByteArray())
        flush()
      }
      client.getInputStream().readBytes()

      assertTrue(received.get().contains("example.invalid"))
      assertTrue(received.get().endsWith("\r\n\r\nbody"))
      assertTrue(received.get().contains("Connection: close\r\n"))
      assertTrue(received.get().contains("Proxy-Connection: close\r\n"))
      assertFalse(received.get().contains("keep-alive", ignoreCase = true))
      assertFalse(received.get().contains("127.0.0.1"))
    } finally {
      client.close()
      server.stop()
      upstreamListener.close()
      upstreamExecutor.shutdownNow()
    }
  }

  @Test
  fun completedHttpRequestsKeepTheConnectionOpenUntilTheBinaryResponseDrains() {
    for (requestBody in listOf("", "body")) {
      val body = ByteArray(65537) { index -> (index % 251).toByte() }
      val upstreamListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
      val upstreamExecutor = Executors.newSingleThreadExecutor()
      val upstreamResponse = upstreamExecutor.submit {
        upstreamListener.accept().use { accepted ->
          accepted.soTimeout = 2_000
          val input = accepted.getInputStream()
          readHeaderBlock(input)
          for (character in requestBody) assertEquals(character.code, input.read())
          val output = accepted.getOutputStream()
          output.write((
            "HTTP/1.1 200 OK\r\nContent-Length: " + body.size + "\r\nConnection: close\r\n\r\n"
          ).toByteArray(Charsets.US_ASCII))
          output.write(body, 0, body.size - 1)
          output.flush()
          // An ordinary HTTP server can abort a pending response when the request socket ends.
          accepted.soTimeout = 100
          try {
            if (input.read() == -1) return@submit
            throw AssertionError("Unexpected bytes after Content-Length")
          } catch (_: SocketTimeoutException) {
            output.write(body.last().toInt())
          }
        }
      }
      val server = LocalNetworkProxyServer(
        NetworkProxyProfile("http", "127.0.0.1", upstreamListener.localPort, null, null)
      )
      server.start()
      try {
        Socket("127.0.0.1", server.port).use { client ->
          client.soTimeout = 2_000
          val method = if (requestBody.isEmpty()) "GET" else "POST"
          client.getOutputStream().write((
            method + " http://example.invalid/apk HTTP/1.1\r\nHost: example.invalid\r\n" +
              "Content-Length: " + requestBody.length + "\r\nConnection: close\r\n\r\n" + requestBody
          ).toByteArray(Charsets.US_ASCII))
          val input = client.getInputStream()
          assertTrue(readHeaderBlock(input).startsWith("HTTP/1.1 200 "))
          assertArrayEquals("The entire response must survive request completion", body, input.readBytes())
        }
        upstreamResponse.get(2, TimeUnit.SECONDS)
      } finally {
        server.stop()
        upstreamListener.close()
        upstreamExecutor.shutdownNow()
      }
    }
  }

  @Test
  fun regProxy007RejectedCopySubmissionClosesTunnel() {
    val leftListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val rightListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val leftPeer = Socket("127.0.0.1", leftListener.localPort)
    val left = leftListener.accept()
    val rightPeer = Socket("127.0.0.1", rightListener.localPort)
    val right = rightListener.accept()
    val copyExecutor = java.util.concurrent.ThreadPoolExecutor(
      1,
      1,
      0L,
      TimeUnit.MILLISECONDS,
      java.util.concurrent.SynchronousQueue<Runnable>()
    )
    val runner = Executors.newSingleThreadExecutor()
    val finished = CountDownLatch(1)
    runner.execute {
      try {
        pipeBoth(left, right, copyExecutor, 10_000)
      } finally {
        finished.countDown()
      }
    }
    try {
      assertTrue("a rejected copy direction must release the tunnel", finished.await(2, TimeUnit.SECONDS))
      assertTrue("a rejected copy direction must close the client socket", left.isClosed)
      assertTrue("a rejected copy direction must close the upstream socket", right.isClosed)
    } finally {
      leftPeer.close()
      rightPeer.close()
      left.close()
      right.close()
      leftListener.close()
      rightListener.close()
      copyExecutor.shutdownNow()
      runner.shutdownNow()
    }
  }

  @Test
  fun regProxy008BlockedWritesCannotOutliveTheSharedIdleDeadline() {
    val writesStarted = CountDownLatch(2)
    val left = BlockingWriteSocket(writesStarted)
    val right = BlockingWriteSocket(writesStarted)
    val copyExecutor = Executors.newFixedThreadPool(2)
    val runner = Executors.newSingleThreadExecutor()
    val finished = CountDownLatch(1)
    runner.execute {
      try {
        pipeBoth(left, right, copyExecutor, 100)
      } finally {
        finished.countDown()
      }
    }
    try {
      assertTrue("both copy directions must enter write", writesStarted.await(2, TimeUnit.SECONDS))
      assertTrue("blocked writes must not outlive the tunnel deadline", finished.await(2, TimeUnit.SECONDS))
      assertTrue("the idle deadline must close the client socket", left.isClosed)
      assertTrue("the idle deadline must close the upstream socket", right.isClosed)
    } finally {
      left.close()
      right.close()
      copyExecutor.shutdownNow()
      runner.shutdownNow()
    }
  }

  @Test
  fun regProxy007OneWayActivityKeepsTunnelAliveUntilBothDirectionsAreIdle() {
    val leftListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val rightListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val leftPeer = Socket("127.0.0.1", leftListener.localPort)
    val left = leftListener.accept()
    val rightPeer = Socket("127.0.0.1", rightListener.localPort)
    val right = rightListener.accept()
    val copyExecutor = Executors.newFixedThreadPool(2)
    val runner = Executors.newSingleThreadExecutor()
    val finished = CountDownLatch(1)
    runner.execute {
      try {
        pipeBoth(left, right, copyExecutor, 400)
      } finally {
        finished.countDown()
      }
    }
    try {
      leftPeer.soTimeout = 2_000
      repeat(10) { value ->
        rightPeer.getOutputStream().apply {
          write(value)
          flush()
        }
        assertEquals(value, leftPeer.getInputStream().read())
        Thread.sleep(50)
      }

      assertFalse(
        "one-way activity must keep the tunnel open",
        finished.await(100, TimeUnit.MILLISECONDS)
      )
      assertTrue(
        "the tunnel must close after both directions become idle",
        finished.await(2, TimeUnit.SECONDS)
      )
      assertTrue("shared idle timeout must close the client socket", left.isClosed)
      assertTrue("shared idle timeout must close the upstream socket", right.isClosed)
    } finally {
      leftPeer.close()
      rightPeer.close()
      left.close()
      right.close()
      leftListener.close()
      rightListener.close()
      copyExecutor.shutdownNow()
      runner.shutdownNow()
    }
  }

  @Test
  fun regProxy007IdleTunnelClosesBothSockets() {
    val upstreamListener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val upstreamExecutor = Executors.newSingleThreadExecutor()
    val upstreamClosed = CountDownLatch(1)
    upstreamExecutor.execute {
      upstreamListener.accept().use { accepted ->
        accepted.soTimeout = 2_000
        val reader = accepted.getInputStream().bufferedReader()
        while (!reader.readLine().isNullOrEmpty()) {
        }
        accepted.getOutputStream().apply {
          write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
          flush()
        }
        try {
          if (reader.read() == -1) {
            upstreamClosed.countDown()
          }
        } catch (_: SocketException) {
          upstreamClosed.countDown()
        }
      }
    }
    val server = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", upstreamListener.localPort, null, null),
      idleTimeoutMs = 100
    )
    server.start()
    val client = Socket("127.0.0.1", server.port)
    try {
      client.soTimeout = 2_000
      client.getOutputStream().apply {
        write("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n".toByteArray())
        flush()
      }
      val reader = client.getInputStream().bufferedReader()
      assertTrue(reader.readLine().contains("200 Connection Established"))
      while (!reader.readLine().isNullOrEmpty()) {
      }
      val clientClosed = try {
        reader.read() == -1
      } catch (_: SocketException) {
        true
      } catch (_: SocketTimeoutException) {
        false
      }

      assertTrue("idle timeout must close the client tunnel", clientClosed)
      assertTrue("idle timeout must close the upstream tunnel", upstreamClosed.await(2, TimeUnit.SECONDS))
    } finally {
      client.close()
      server.stop()
      upstreamListener.close()
      upstreamExecutor.shutdownNow()
    }
  }

  @Test
  fun regProxy007RejectsThe17thConnection() {
    val connectionStarted = CountDownLatch(16)
    val releaseConnections = CountDownLatch(1)
    val server = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", 1, null, null),
      socketConnector = { _, _, _ ->
        connectionStarted.countDown()
        releaseConnections.await()
        throw SocketException("released test connection")
      }
    )
    server.start()
    val held = (1..16).map {
      Socket("127.0.0.1", server.port).also { client ->
        client.getOutputStream().apply {
          write("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n".toByteArray())
          flush()
        }
      }
    }
    var overflow: Socket? = null
    try {
      assertTrue("all sixteen connection workers must be occupied", connectionStarted.await(10, TimeUnit.SECONDS))

      overflow = Socket("127.0.0.1", server.port)
      overflow.soTimeout = 2_000
      val response = overflow.getInputStream().bufferedReader().readText()

      assertTrue("the seventeenth connection must be rejected locally", response.contains("503 Busy"))
    } finally {
      releaseConnections.countDown()
      held.forEach(Socket::close)
      overflow?.close()
      server.stop()
    }
  }
}
