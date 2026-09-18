package com.wz.reader

import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Protocol
import org.junit.Assert.*
import org.junit.Test

class ManagedCookieResponsesTest {
  @Test fun platformCallbacksDoNotBlockOtherHttpRequestsFromBeingSent() {
    val batch = CookieResponseBatch(1)
    val writing = java.util.concurrent.CountDownLatch(1)
    val received = java.util.concurrent.CountDownLatch(1)
    val store = ManagedCookieResponses({ "_t=A" }, { _, _ -> writing.countDown(); batch }, timeoutMs = 10000)
    val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 5000 }
    val workers = Executors.newFixedThreadPool(3)
    val client = OkHttpClient.Builder()
      .cookieJar(JavaNetCookieJar(ReadOnlyWebViewCookieHandler(store, { "linuxdo" }) { "_t=A" }))
      .addInterceptor(CookieResponseContextInterceptor(store))
      .addNetworkInterceptor(CookieResponseInterceptor(store)).build()
    try {
      val first = workers.submit { store.within {
        store.observed(url, "linuxdo", "_t=A"); store.receive(response("_t=B"))
      } }
      assertTrue(writing.await(5, TimeUnit.SECONDS))
      val served = workers.submit { server.accept().use { socket ->
        socket.soTimeout = 5000
        val input = socket.getInputStream().bufferedReader()
        while (!input.readLine().isNullOrEmpty()) { }
        received.countDown()
        socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
      } }
      val next = workers.submit { client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/").build())
        .execute().use { assertEquals(200, it.code) } }
      assertTrue("the network must send before the platform callback settles", received.await(5, TimeUnit.SECONDS))
      batch.complete(true, 0)
      first.get(5, TimeUnit.SECONDS); next.get(5, TimeUnit.SECONDS); served.get(5, TimeUnit.SECONDS)
    } finally {
      batch.complete(true, 0); server.close(); workers.shutdownNow()
      client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
    }
  }

  @Test fun concurrentSessionAndLoginUpdatesReachTheNextAuthenticatedRequest() {
    for (loginFirst in listOf(false, true)) {
      val current = java.util.concurrent.ConcurrentHashMap<String, String>().apply {
        put("_t", "A"); put("_forum_session", "A")
      }
      fun header() = current.entries.sortedBy { it.key }.joinToString("; ") { "${it.key}=${it.value}" }
      val store = ManagedCookieResponses({ header() }, { _, values ->
        CookieResponseBatch(values.size).also { batch -> values.forEach {
          val pair = it.substringBefore(';').split('=', limit = 2)
          current[pair[0]] = pair[1]; batch.complete(true)
        } }
      })
      val client = OkHttpClient.Builder()
        .cookieJar(JavaNetCookieJar(ReadOnlyWebViewCookieHandler(store, { "linuxdo" }) { header() }))
        .addInterceptor(CookieResponseContextInterceptor(store))
        .addNetworkInterceptor(CookieResponseInterceptor(store)).build()
      val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 5000 }
      val workers = Executors.newFixedThreadPool(3)
      val firstDone = java.util.concurrent.CountDownLatch(1)
      val authenticatedHeader = AtomicReference("")
      val names = if (loginFirst) listOf("_t", "_forum_session") else listOf("_forum_session", "_t")
      fun readRequest(socket: java.net.Socket): String {
        socket.soTimeout = 5000
        val input = socket.getInputStream().bufferedReader()
        var cookie = ""
        while (true) {
          val line = input.readLine() ?: break
          if (line.isEmpty()) break
          if (line.startsWith("Cookie:", true)) cookie = line.substringAfter(':').trim()
        }
        return cookie
      }
      val served = workers.submit {
        val first = server.accept()
        readRequest(first)
        val second = server.accept()
        readRequest(second)
        listOf(first, second).forEachIndexed { index, socket -> socket.use {
          it.getOutputStream().write(("HTTP/1.1 200 OK\r\nSet-Cookie: ${names[index]}=B; Path=/; HttpOnly\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
          if (index == 0) assertTrue(firstDone.await(5, TimeUnit.SECONDS))
        } }
        server.accept().use { socket ->
          val cookie = readRequest(socket)
          authenticatedHeader.set(cookie)
          // Model a server grace period; actual sent credentials, not immediate expiry, are the oracle.
          val valid = cookie.split("; ").any { it == "_t=A" || it == "_t=B" }
          socket.getOutputStream().write(("HTTP/1.1 ${if (valid) "200 OK" else "401 Unauthorized"}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
        }
      }
      val request = Request.Builder().url("http://127.0.0.1:${server.localPort}/session").build()
      try {
        val reads = (0..1).map { workers.submit {
          client.newCall(request).execute().use { assertEquals(200, it.code) }
          firstDone.countDown()
        } }
        reads.forEach { it.get(10, TimeUnit.SECONDS) }
        client.newCall(request).execute().use { assertEquals("both response orders must preserve authentication", 200, it.code) }
        served.get(5, TimeUnit.SECONDS)
        assertEquals("both response orders must retain the next credentials even during server grace",
          setOf("_t=B", "_forum_session=B"), authenticatedHeader.get().split("; ").toSet())
      } finally {
        firstDone.countDown(); server.close(); workers.shutdownNow()
        client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
      }
    }
  }

  @Test fun unrelatedPlatformCookieChangeDoesNotDiscardLoginRenewal() {
    var current = "_t=A; cf_clearance=A"
    val store = ManagedCookieResponses({ current }, { _, values ->
      current = values.single().substringBefore(';') + "; cf_clearance=B"
      CookieResponseBatch(1).also { it.complete(true) }
    })
    store.within {
      store.observed(url, "linuxdo", current)
      current = "_t=A; cf_clearance=B"
      store.receive(response("_t=B; Path=/"))
    }
    assertEquals("_t=B; cf_clearance=B", current)
  }

  @Test fun enabledStartupDoesNotInvalidateAnAlreadyRunningRenewal() {
    var current = "_t=A"
    val store = ManagedCookieResponses({ current }, { _, values ->
      current = values.single(); CookieResponseBatch(1).also { it.complete(true) }
    })
    store.within {
      store.observed(url, "linuxdo", current)
      store.setBarrier(false, "startup")
      store.receive(response("_t=B"))
    }
    assertEquals("_t=B", current)
  }

  private val url = "https://linux.do/session/current.json"
  @Test fun observesClearanceHandoffAndActualRequestWithoutExportingCookieValues() {
    val events = mutableListOf<Map<String, Any>>()
    var current = "_t=private-login; cf_clearance=private-before"
    val store = ManagedCookieResponses({ current }, { _, values ->
      CookieResponseBatch(values.size).also { batch -> values.forEach { batch.complete(true) } }
    }, report = { events.add(it) })
    store.setBarrier(true, "surface-open")
    current = "_t=private-login; cf_clearance=private-after"
    store.setBarrier(false, "surface-close")
    store.within {
      store.observed(url, "linuxdo", null)
      store.sending(Request.Builder().url(url).header("Cookie", "_t=private-login; cf_clearance=private-before")
        .header("User-Agent", "fixture-agent").build(), null)
      store.sending(Request.Builder().url(url).header("Cookie", current).build(), null)
      store.sending(Request.Builder().url(url).build(), null)
      store.sending(Request.Builder().url("https://linux.do/site.json")
        .header("Cookie", "_t=private-login; _t=private-duplicate").build(), null)
    }
    assertTrue(events.any { it["cookieBarrierReason"] == "surface-close" && it["didCfClearanceChange"] == true })
    val sent = events.filter { it["operation"] == "cookie-request" }
    assertEquals(listOf(false, true, false, false), sent.map { it["isCfClearanceCurrent"] })
    assertEquals(listOf(true, true, false, false), sent.map { it["hasCfClearance"] })
    assertEquals(listOf(1, 1, 0, 2), sent.map { it["loginCookieCount"] })
    assertEquals(listOf(1, 1, 1, 1), sent.map { it["storedLoginCookieCount"] })
    assertEquals(listOf(true, true, false, false), sent.map { it["isLoginCookieCurrent"] })
    assertEquals("site-config", sent.last()["cookieEndpoint"])
    assertEquals("%08x".format("fixture-agent".hashCode()), sent[0]["userAgentHash"])
    assertFalse(events.toString().contains("private-"))
    assertEquals("clearance", cookieResponseItem(Request.Builder().url(url).build(), "cf_clearance=x", 0)["cookieKind"])
    assertEquals("bot-management", cookieResponseItem(Request.Builder().url(url).build(), "__cf_bm=x", 0)["cookieKind"])
  }

  private fun response(vararg values: String, status: Int = 200): Response = Response.Builder()
    .request(Request.Builder().url(url).build()).protocol(Protocol.HTTP_1_1).code(status).message("fixture")
    .apply { values.forEach { addHeader("Set-Cookie", it) } }.build()

  @Test fun preservesRawAttributesAndAcceptsServerExpiryOnFailedResponses() {
    val written = mutableListOf<String>()
    val store = ManagedCookieResponses({ "_t=A" }, { exactUrl, values ->
      assertEquals(url, exactUrl)
      written.addAll(values)
      CookieResponseBatch(values.size).also { batch -> values.forEach { batch.complete(true) } }
    })
    val updates = arrayOf("_t=B; Path=/; Secure; HttpOnly; SameSite=None", "old=; Max-Age=0; Path=/", "new=1; Domain=linux.do; Path=/private")
    store.within {
      store.observed(url, "linuxdo", "_t=A")
      store.receive(response(*updates, status = 403))
      store.receive(response(status = 401))
    }
    assertEquals(updates.toList(), written)
  }

  @Test fun deniesAnonymousOtherSourceAndRedirectDowngrades() {
    var writes = 0
    val store = ManagedCookieResponses({ "_t=A" }, { _, _ -> writes++; CookieResponseBatch(1).also { it.complete(true) } })
    store.within { store.receive(response("_t=B")) }
    store.within { store.observed(url, "nodeseek", "_t=A"); store.receive(response("_t=B")) }
    store.within {
      store.observed(url, "linuxdo", "_t=A")
      store.observed("https://example.com/", null, null)
      store.observed(url, "linuxdo", "_t=A")
      store.receive(response("_t=B"))
    }
    assertEquals(0, writes)
  }

  @Test fun accountHandoffRejectsLateResponsesBeforeAndAfterNewLogin() {
    var current = "_t=A"
    var writes = 0
    val store = ManagedCookieResponses({ current }, { _, _ -> writes++; CookieResponseBatch(1).also { it.complete(true) } })
    store.within {
      store.observed(url, "linuxdo", current)
      store.setBarrier(true)
      store.setBarrier(false)
      store.receive(response("_t=old"))
    }
    store.within {
      store.observed(url, "linuxdo", current)
      store.setBarrier(true)
      current = "_t=new-account"
      store.receive(response("_t=old"))
      store.setBarrier(false)
      store.receive(response("_t=old"))
    }
    assertEquals(0, writes)
  }

  @Test fun sameAccountResponsesApplyInArrivalOrder() {
    var current = "_t=A"
    val written = mutableListOf<String>()
    val store = ManagedCookieResponses({ current }, { _, values ->
      written.addAll(values); current = values.last()
      CookieResponseBatch(1).also { it.complete(true) }
    })
    store.within {
      store.observed(url, "linuxdo", current)
      store.within {
        store.observed(url, "linuxdo", current)
        store.receive(response("_t=B"))
      }
      store.receive(response("_t=late"))
    }
    assertEquals(listOf("_t=B", "_t=late"), written)
  }

  @Test fun platformTimeoutKeepsBarrierClosedUntilCallbacksSettle() {
    val batch = CookieResponseBatch(1)
    val results = mutableListOf<Map<String, Any>>()
    val completions = mutableListOf<() -> Unit>()
    var writes = 0
    var flushes = 0
    val store = ManagedCookieResponses({ "_t=A" }, { _, _ ->
      if (writes++ == 0) batch else CookieResponseBatch(1).also { it.complete(true) }
    }, { results.add(it) }, 1, { flushes++ }, { completions.add(it) })
    store.within {
      store.observed(url, "linuxdo", "_t=A")
      store.receive(response("_t=B"))
    }
    assertTrue(results.any { it["cookieResult"] == "callback_timeout" })
    assertThrows(java.io.IOException::class.java) { store.setBarrier(false) }
    batch.complete(false)
    assertEquals("callbacks only schedule; they never wait on the writer lock", 0, flushes)
    completions.single().invoke()
    assertEquals(1, flushes)
    store.within {
      store.observed(url, "linuxdo", "_t=A")
      store.receive(response("_t=still-blocked"))
    }
    assertEquals("a failed handoff must stay blocked until explicitly retried", 1, writes)
    store.setBarrier(false)
    store.within {
      store.observed(url, "linuxdo", "_t=A")
      store.receive(response("_t=C"))
    }
    assertEquals("a settled close must not permanently block future responses", 2, writes)
  }

  @Test fun timeoutRecoversWithoutAnAccountBarrierAndFlushFailureRetriesOnAnEmptyResponse() {
    val delayed = CookieResponseBatch(1)
    var writes = 0
    var flushes = 0
    val events = mutableListOf<Map<String, Any>>()
    val store = ManagedCookieResponses({ "_t=B" }, { _, _ ->
      if (writes++ == 0) delayed else CookieResponseBatch(1).also { it.complete(true) }
    }, { events.add(it) }, 1, {
      if (flushes++ == 0) throw java.io.IOException("synthetic disk failure")
    })
    fun receive(vararg cookies: String) = store.within {
      store.observed(url, "linuxdo", "_t=B"); store.receive(response(*cookies))
    }
    receive("_t=B; Max-Age=3600; Path=/")
    assertTrue(delayed.abandoned.get())
    delayed.complete(true)
    receive()
    assertTrue(events.any { it["cookieResult"] == "flush_failed" })
    assertFalse(events.any { it["cookieResult"] == "persisted" })
    receive()
    assertTrue(events.any { it["cookieResult"] == "persisted" })
    receive("_t=C; Max-Age=3600; Path=/")
    assertEquals(2, writes)
    assertEquals(3, flushes)
  }

  @Test fun platformRejectionAndServerDeletionRemainDistinctAndDoNotPoisonFutureWrites() {
    val events = mutableListOf<Map<String, Any>>()
    var writes = 0
    val store = ManagedCookieResponses({ null }, { _, values ->
      CookieResponseBatch(values.size).also { batch -> values.forEach { batch.complete(++writes != 1) } }
    }, { events.add(it) })
    repeat(2) { store.within {
      store.observed(url, "linuxdo", null)
      store.receive(response("_t=; Max-Age=0; Path=/"))
    } }
    val items = events.filter { it["cookieResult"] == "settled" }
    assertEquals(listOf("rejected", "accepted"), items.map { it["cookieAccepted"] })
    assertTrue(items.all { it["cookieKind"] == "login" && it["cookieAction"] == "delete" })
    assertFalse(events.toString().contains("Max-Age"))
  }

  @Test fun diagnosticReadFailureDoesNotLoseRenewalAndWebViewHandoffFlushes() {
    var current = "_t=A"
    var flushes = 0
    val store = ManagedCookieResponses({ throw java.io.IOException("synthetic observation failure") }, { _, values ->
      current = values.single().substringBefore(';')
      CookieResponseBatch(1).also { it.complete(true) }
    }, flusher = { flushes++ })
    store.within {
      store.observed(url, "linuxdo", "_t=A")
      store.receive(response("_t=B; Max-Age=3600; Path=/"))
    }
    assertEquals("_t=B", current)
    assertEquals(1, flushes)
    store.setBarrier(true, "surface-open")
    store.setBarrier(false, "surface-close")
    assertEquals(2, flushes)
  }

  @Test fun failedWebViewFlushKeepsNativeResponsesBlockedUntilHandoffRetries() {
    var failFlush = true
    var writes = 0
    val store = ManagedCookieResponses({ "_t=A" }, { _, _ ->
      writes++; CookieResponseBatch(1).also { it.complete(true) }
    }, flusher = { if (failFlush) throw java.io.IOException("synthetic disk failure") })
    store.setBarrier(true, "surface-open")
    assertThrows(java.io.IOException::class.java) { store.setBarrier(false, "surface-close") }
    store.within { store.observed(url, "linuxdo", "_t=A"); store.receive(response("_t=B")) }
    assertEquals(0, writes)
    failFlush = false
    store.setBarrier(false, "surface-close")
    store.within { store.observed(url, "linuxdo", "_t=A"); store.receive(response("_t=B")) }
    assertEquals(1, writes)
  }

  @Test fun cancellationBeforeResponseHeadersCannotWriteCookies() {
    var writes = 0
    val store = ManagedCookieResponses({ "_t=A" }, { _, _ ->
      writes++; CookieResponseBatch(1).also { it.complete(true) }
    })
    val client = OkHttpClient.Builder()
      .cookieJar(JavaNetCookieJar(ReadOnlyWebViewCookieHandler(store, { "linuxdo" }) { "_t=A" }))
      .addInterceptor(CookieResponseContextInterceptor(store))
      .addNetworkInterceptor(CookieResponseInterceptor(store)).build()
    try {
      val call = client.newCall(Request.Builder().url("http://127.0.0.1:1/").build())
      call.cancel()
      assertThrows(java.io.IOException::class.java) { call.execute().close() }
      assertEquals(0, writes)
    } finally {
      client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
    }
  }

  @Test fun receivedCookieUpdatesSurviveConsumerCancellation() {
    for (update in listOf("_t=B; Path=/", "_t=; Max-Age=0; Path=/")) {
      val current = AtomicReference("_t=A")
      val seen = mutableListOf<String?>()
      var flushes = 0
      val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 5000 }
      val worker = Executors.newSingleThreadExecutor()
      val served = worker.submit {
        repeat(2) { index -> server.accept().use { socket ->
          socket.soTimeout = 5000
          val input = socket.getInputStream().bufferedReader()
          var cookie: String? = null
          while (true) {
            val line = input.readLine() ?: break
            if (line.isEmpty()) break
            if (line.startsWith("Cookie:", true)) cookie = line.substringAfter(':').trim()
          }
          seen.add(cookie)
          val headers = if (index == 0) "Set-Cookie: $update\r\n" else ""
          socket.getOutputStream().write(("HTTP/1.1 200 OK\r\n${headers}Content-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
        } }
      }
      val store = ManagedCookieResponses({ current.get() }, { _, values ->
        current.set(values.single().substringBefore(';'))
        CookieResponseBatch(1).also { it.complete(true) }
      }, flusher = { flushes++ })
      val cancel = java.util.concurrent.atomic.AtomicBoolean(true)
      val client = OkHttpClient.Builder()
        .cookieJar(JavaNetCookieJar(ReadOnlyWebViewCookieHandler(store, { "linuxdo" }) { current.get() }))
        .addInterceptor(CookieResponseContextInterceptor(store))
        .addNetworkInterceptor(CookieResponseInterceptor(store))
        .addNetworkInterceptor { chain ->
          val response = chain.proceed(chain.request())
          if (cancel.getAndSet(false)) chain.call().cancel()
          response
        }.build()
      try {
        val request = Request.Builder().url("http://127.0.0.1:${server.localPort}/session").build()
        runCatching { client.newCall(request).execute().close() }
        client.newCall(request).execute().close()
        served.get(5, TimeUnit.SECONDS)
        assertEquals(listOf("_t=A", update.substringBefore(';')), seen)
        assertEquals(1, flushes)
      } finally {
        server.close(); worker.shutdownNow()
        client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
      }
    }
  }

  @Test fun cronetFallbackUsesTheUpdatedPlatformCookieAndRejectsStaleScope() {
    var current = "_t=A"
    val store = ManagedCookieResponses({ current }, { _, values -> current = values.last(); CookieResponseBatch(1).also { it.complete(true) } })
    store.within {
      store.observed(url, "linuxdo", current)
      store.receive(response("_t=B", status = 403))
      val fallback = store.fallbackRequest(Request.Builder().url(url).header("Cookie", "_t=A").build())
      assertEquals("_t=B", fallback.header("Cookie"))
      store.receive(response("_t=C"))
      assertEquals("_t=C", current)
      store.setBarrier(true)
      assertNull(store.fallbackRequest(fallback).header("Cookie"))
      store.receive(response("_t=stale"))
      assertEquals("_t=C", current)
    }
  }

  @Test fun imageFallbackWrapsTheReceiverSoEveryTransportResponseIsSavedOnlyOnce() {
    val store = ManagedCookieResponses({ null }, { _, _ -> CookieResponseBatch(1).also { it.complete(true) } })
    val client = expoImageClient(OkHttpClient.Builder()
      .addNetworkInterceptor(CookieResponseInterceptor(store)).build())
    assertTrue(client.networkInterceptors.indexOfFirst { it is ForumMediaCloudflareFallbackInterceptor } <
      client.networkInterceptors.indexOfFirst { it is CookieResponseInterceptor })
  }

  @Test fun serverRotationIsUsedByTheNextActualRequest() {
    val current = AtomicReference("_t=A")
    val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    val worker = Executors.newSingleThreadExecutor()
    val seen = mutableListOf<String?>()
    worker.execute {
      repeat(4) { index ->
        server.accept().use { socket ->
          val reader = socket.getInputStream().bufferedReader()
          reader.readLine()
          var cookie: String? = null
          while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
            if (line.startsWith("Cookie:", true)) cookie = line.substringAfter(':').trim()
          }
          seen.add(cookie)
          val status = if (cookie == "_t=${'A' + index}" || cookie == "_t=${'A' + maxOf(0, index - 1)}") "200 OK" else "401 Unauthorized"
          val update = if (index < 3) "Set-Cookie: _t=${'B' + index}; Path=/; HttpOnly; SameSite=Lax\r\n" else ""
          socket.getOutputStream().write(("HTTP/1.1 $status\r\n" + update +
            "Content-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
        }
      }
    }
    val responses = ManagedCookieResponses(reader = { current.get() }, writer = { _, values ->
      CookieResponseBatch(values.size).also { batch ->
        values.forEach { current.set(it.substringBefore(';')); batch.complete(true) }
      }
    })
    val handler = ReadOnlyWebViewCookieHandler(responses, sourceForUri = { "linuxdo" }) { current.get() }
    val client = OkHttpClient.Builder().cookieJar(JavaNetCookieJar(handler))
      .addInterceptor(CookieResponseContextInterceptor(responses))
      .addNetworkInterceptor(CookieResponseInterceptor(responses)).build()
    try {
      val request = Request.Builder().url("http://127.0.0.1:${server.localPort}/session").build()
      repeat(4) { client.newCall(request).execute().use { assertEquals("rotated login must survive the next request", 200, it.code) } }
      assertEquals(listOf("_t=A", "_t=B", "_t=C", "_t=D"), seen)
    } finally {
      server.close()
      worker.shutdownNow()
      assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS))
      client.dispatcher.executorService.shutdown()
      client.connectionPool.evictAll()
    }
  }

  @Test fun failedMediaCookieReadCannotReuseThePreviousRedirectPermission() {
    val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    server.soTimeout = 5000
    val exactUrl = "http://127.0.0.1:${server.localPort}/image"
    val worker = Executors.newSingleThreadExecutor()
    val served = worker.submit {
      repeat(2) { index -> server.accept().use { socket ->
        val input = socket.getInputStream().bufferedReader()
        while (!input.readLine().isNullOrEmpty()) { }
        val status = if (index == 0) "302 Found" else "403 Forbidden"
        val headers = if (index == 0) "Location: $exactUrl\r\n" else "Set-Cookie: _t=stale; Path=/\r\n"
        socket.getOutputStream().write(("HTTP/1.1 $status\r\n${headers}Content-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
      } }
    }
    var writes = 0
    var reads = 0
    val store = ManagedCookieResponses({ "_t=A" }, { _, _ -> writes++; CookieResponseBatch(1).also { it.complete(true) } })
    val handler = ReadOnlyWebViewCookieHandler(store, sourceForUri = { "linuxdo" }) {
      if (++reads == 2) throw java.io.IOException("platform fixture failure")
      "_t=A"
    }
    val client = OkHttpClient.Builder().cookieJar(JavaNetCookieJar(handler))
      .addInterceptor(ForumMediaRequestInterceptor { "linuxdo" })
      .addInterceptor(CookieResponseContextInterceptor(store))
      .addNetworkInterceptor(CookieResponseInterceptor(store)).build()
    try {
      val request = Request.Builder().url(exactUrl).header(FORUM_MEDIA_SOURCE_HEADER, "linuxdo").build()
      client.newCall(request).execute().use { assertEquals(403, it.code) }
      served.get(5, TimeUnit.SECONDS)
      assertEquals(2, reads)
      assertEquals("anonymous response after failed Cookie read must not write", 0, writes)
    } finally {
      server.close(); worker.shutdownNow()
      client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
    }
  }
}
