package com.wz.reader

import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.security.KeyStore
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import javax.net.SocketFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import okio.ByteString.Companion.toByteString
import org.conscrypt.Conscrypt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AppEncryptedDnsTest {
  @get:Rule val cache = TemporaryFolder()
  private val answer = InetAddress.getByAddress(byteArrayOf(192.toByte(), 0, 2, 10))
  private val alternateAnswer = InetAddress.getByAddress(byteArrayOf(192.toByte(), 0, 2, 11))

  @Test fun bundledTlsSendsThePublicEchNameInTheClientHello() {
    val trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply {
      init(null as KeyStore?)
    }.trustManagers.filterIsInstance<X509ExtendedTrustManager>().single()
    val tls = SSLContext.getInstance("TLS", Conscrypt.newProvider()).apply {
      init(null, arrayOf(DohEchTrustManager(trust)), null)
    }
    // Test-only X25519 public key with outer.example as the ECH public name.
    val config = Base64.getDecoder().decode("AED+DQA8AQAgACCFIPAJiTCnVHSLfdy0PvdaDb86DSY4GvTrpKmOqptOagAEAAEAAQANb3V0ZXIuZXhhbXBsZQAA")
    val loopback = InetAddress.getLoopbackAddress()
    val hello = ServerSocket(0, 1, loopback).use { server ->
      server.soTimeout = 3_000
      val record = CompletableFuture.supplyAsync {
        server.accept().use { peer ->
          peer.soTimeout = 3_000
          val input = DataInputStream(peer.getInputStream())
          assertEquals(22, input.readUnsignedByte())
          input.readUnsignedShort()
          val payload = ByteArray(input.readUnsignedShort())
          input.readFully(payload)
          payload.toString(Charsets.ISO_8859_1)
        }
      }
      Socket(loopback, server.localPort).use { raw ->
        (tls.socketFactory.createSocket(raw, "inner.example", 443, true) as SSLSocket).use { socket ->
          socket.soTimeout = 3_000
          Conscrypt.setEchConfigList(socket, config)
          assertThrows(IOException::class.java) { socket.startHandshake() }
        }
      }
      record.get(3, TimeUnit.SECONDS)
    }
    assertTrue(hello.contains("outer.example"))
    assertFalse(hello.contains("inner.example"))
  }

  @Test fun nativeEchQueriesUseTheConfiguredDohAndKeepValidatedAddresses() {
    val echConfig = byteArrayOf(0, 3, 1, 2, 3)
    withProvider({ request -> dnsResponse(request, echConfig = echConfig) }, includeIpv6 = { false }, enableEch = true) {
        resolver, server, systemLookups ->
      val records = CompletableFuture<List<Dns.Record>>()
      resolver.newCall(Dns.Request("forum.test")).enqueue(object : Dns.Callback {
        override fun onRecords(call: Dns.Call, last: Boolean, values: List<Dns.Record>) {
          if (last) records.complete(values)
        }

        override fun onFailure(call: Dns.Call, e: IOException) {
          records.completeExceptionally(e)
        }
      })
      val result = records.get(5, TimeUnit.SECONDS)
      assertEquals(listOf(answer), result.filterIsInstance<Dns.Record.IpAddress>().map { it.address })
      assertEquals(echConfig.toByteString(), result.filterIsInstance<Dns.Record.ServiceMetadata>().single().echConfigList)
      assertEquals(echConfig.toByteString(), resolver.echFor("forum.test", answer, 443))
      assertEquals(null, resolver.echFor("other.test", answer, 443))
      assertEquals(null, resolver.echFor("forum.test", alternateAnswer, 443))
      assertEquals(null, resolver.echFor("forum.test", answer, 8443))
      assertEquals(listOf(answer), resolver.lookup("forum.test"))
      assertEquals(2, server.requestCount)
      assertEquals(0, systemLookups.get())
      resolver.reset()
      assertEquals(null, resolver.echFor("forum.test", answer, 443))
    }
  }

  @Test fun concurrentQueriesAndHttpFreshnessUseOnePairUntilNetworkChanges() {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    withProvider({ request ->
      entered.countDown()
      check(release.await(5, TimeUnit.SECONDS))
      dnsResponse(request)
    }) { resolver, server, _ ->
      val callers = Executors.newFixedThreadPool(4)
      try {
        val lookups = (1..4).map { callers.submit<List<InetAddress>> { resolver.lookup("forum.test") } }
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        release.countDown()
        lookups.forEach { assertEquals(listOf(answer), it.get(5, TimeUnit.SECONDS)) }
        assertEquals(listOf(answer), resolver.lookup("forum.test"))
        assertEquals(2, server.requestCount)
        resolver.reset()
        assertEquals(listOf(answer), resolver.lookup("forum.test"))
        assertEquals(4, server.requestCount)
      } finally {
        release.countDown()
        callers.shutdownNow()
      }
    }
  }

  @Test fun fallbackIsLimitedToUnavailableDohAndStrictModeReportsProxyConflict() {
    withProvider({ MockResponse().setResponseCode(503) }, fallback = true) { resolver, _, platformLookups ->
      assertEquals(listOf(answer), resolver.lookup("forum.test"))
      assertEquals(1, platformLookups.get())
    }
    withProvider({ request -> dnsResponse(request, rcode = 3) }, fallback = true) { resolver, _, platformLookups ->
      assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("forum.test") }
      assertEquals(0, platformLookups.get())
    }
    withProvider({ MockResponse().setResponseCode(503) }) { resolver, _, platformLookups ->
      assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("forum.test") }
      assertThrows(EncryptedDnsFailure::class.java) {
        resolver.systemProxy { Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved("proxy.test", 8080)) }
      }
      assertEquals(0, platformLookups.get())
    }
  }

  @Test fun automaticDnsUsesTheFirstUsableProbeAndKeepsAWorkingReplacementUntilTheNetworkChanges() {
    val standbyProbe = CountDownLatch(1)
    val releaseStandby = CountDownLatch(1)
    val primaryAvailable = AtomicBoolean(true)
    val standbyAvailable = AtomicBoolean(true)
    val primaryQueries = ConcurrentLinkedQueue<String>()
    val standbyQueries = ConcurrentLinkedQueue<String>()
    withAutomaticProviders(
      primary = { request ->
        primaryQueries.add(questionName(request))
        if (primaryAvailable.get()) dnsResponse(request) else MockResponse().setResponseCode(503).addHeader("Retry-After", "120")
      },
      standby = { request ->
        val name = questionName(request)
        standbyQueries.add(name)
        if (name == "example.com") {
          standbyProbe.countDown()
          releaseStandby.await(3, TimeUnit.SECONDS)
        }
        if (standbyAvailable.get()) dnsResponse(request) else MockResponse().setResponseCode(503)
      }
    ) { resolver, observations, platformN ->
      try {
        assertEquals(listOf(answer), resolver.lookup("first.test"))
        assertTrue(standbyProbe.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("example.com"), standbyQueries.toList())
        assertEquals(DnsRouteResult.ENCRYPTED to "dnspod", observations.last())

        primaryAvailable.set(false)
        releaseStandby.countDown()
        assertEquals(listOf(answer), resolver.lookup("after-failure.test"))
        assertEquals(DnsRouteResult.ENCRYPTED to "cloudflare", observations.last())
        assertEquals(listOf(answer), resolver.lookup("next.test"))
        assertEquals(listOf("example.com", "first.test", "after-failure.test"), primaryQueries.toList())
        assertEquals(listOf("example.com", "after-failure.test", "next.test"), standbyQueries.toList())

        primaryAvailable.set(true)
        standbyAvailable.set(false)
        resolver.reset()
        assertEquals(listOf(answer), resolver.lookup("next-network.test"))
        assertEquals(DnsRouteResult.ENCRYPTED to "dnspod", observations.last())
        assertEquals(0, platformN.get())
      } finally {
        releaseStandby.countDown()
      }
    }
  }

  @Test fun automaticDnsDoesNotRetryAnAuthoritativeNegativeAnswer() {
    withAutomaticProviders(
      primary = { request -> dnsResponse(request, rcode = if (questionName(request) == "example.com") 0 else 3) },
      standby = { MockResponse().setResponseCode(503) },
      fallback = true
    ) { resolver, observations, platformN ->
      assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("missing.test") }
      assertEquals(DnsRouteResult.DNS_FAILURE to null, observations.last())
      assertEquals(0, platformN.get())
    }
  }

  @Test fun automaticDnsPicksAnOpenRouteForEachForumAndReusesItUntilItFails() {
    val probed = ConcurrentLinkedQueue<Pair<String, InetAddress>>()
    val noDirectPageOnPrimary = AtomicBoolean(true)
    val now = AtomicLong()
    withAutomaticProviders(
      primary = { request -> dnsResponse(request) },
      standby = { request -> dnsResponse(request, ipv4 = alternateAnswer) },
      monotonicMillis = now::get,
      probeForum = { url, dns ->
        val address = dns.lookup(url.host).single()
        probed.add(url.host to address)
        val primary = address == answer
        val opened = if (url.host == "linux.do") !primary || !noDirectPageOnPrimary.get() else primary
        ForumDohProbe(if (opened) ForumDohReachability.OPEN else ForumDohReachability.RESPONDED, address)
      }
    ) { resolver, observations, platformN ->
      assertEquals(listOf(alternateAnswer), resolver.lookup("linux.do"))
      val failure = requireNotNull(resolver.forumTunnelFailure("linux.do", 443))
      assertEquals(DnsRouteResult.ENCRYPTED to "cloudflare", observations.last())
      assertEquals(listOf(answer), resolver.lookup("www.v2ex.com"))
      val previous = probed.count { it == ("linux.do" to alternateAnswer) }
      now.set(TimeUnit.MINUTES.toMillis(10))
      assertEquals(listOf(alternateAnswer), resolver.lookup("linux.do"))
      assertEquals(previous, probed.count { it == ("linux.do" to alternateAnswer) })

      noDirectPageOnPrimary.set(false)
      assertTrue(failure())
      assertEquals(listOf(answer), resolver.lookup("linux.do"))
      assertEquals(DnsRouteResult.ENCRYPTED to "dnspod", observations.last())
      val replacementProbes = probed.size
      assertTrue(failure())
      assertEquals(listOf(answer), resolver.lookup("linux.do"))
      assertEquals(replacementProbes, probed.size)
      val lateFailure = requireNotNull(resolver.forumTunnelFailure("linux.do", 443))
      resolver.reset()
      noDirectPageOnPrimary.set(true)
      assertEquals(listOf(alternateAnswer), resolver.lookup("linux.do"))
      assertFalse(lateFailure())
      assertEquals(0, platformN.get())
    }
  }

  @Test fun aGeneralProbeFailureDoesNotVetoAWorkingForumRoute() {
    val provider: (RecordedRequest) -> MockResponse = { request ->
      dnsResponse(request, rcode = if (questionName(request) == "example.com") 3 else 0)
    }
    withAutomaticProviders(provider, provider, probeForum = { _, _ -> ForumDohProbe(ForumDohReachability.OPEN) }) {
      resolver, _, platformLookups ->
      assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("first.test") }
      assertEquals(listOf(answer), resolver.lookup("linux.do"))
      assertEquals(0, platformLookups.get())
    }
  }

  @Test fun aSlowerResolverCanWinForumSelectionAndRemainSelected() {
    val probes = AtomicInteger()
    withAutomaticProviders(
      primary = { dnsResponse(it) },
      standby = { dnsResponse(it, ipv4 = alternateAnswer).setBodyDelay(1_650, TimeUnit.MILLISECONDS) },
      probeForum = { url, dns ->
        probes.incrementAndGet()
        val address = dns.lookup(url.host).single()
        val reachability = if (address == alternateAnswer) ForumDohReachability.OPEN else ForumDohReachability.UNREACHABLE
        ForumDohProbe(reachability, address)
      }
    ) { resolver, observations, platformLookups ->
      assertEquals(listOf(alternateAnswer), resolver.lookup("linux.do"))
      val firstProbes = probes.get()
      assertEquals(listOf(alternateAnswer), resolver.lookup("linux.do"))
      assertEquals(firstProbes, probes.get())
      assertEquals(DnsRouteResult.ENCRYPTED to "cloudflare", observations.last())
      assertEquals(0, platformLookups.get())
    }
  }

  @Test fun automaticDnsProbesIdenticalForumRoutesOnlyOnce() {
    val attempts = AtomicInteger()
    withAutomaticProviders(
      primary = { request -> dnsResponse(request) },
      standby = { request -> dnsResponse(request) },
      probeForum = { _, _ ->
        attempts.incrementAndGet()
        ForumDohProbe(ForumDohReachability.RESPONDED)
      }
    ) { resolver, _, _ ->
      assertEquals(listOf(answer), resolver.lookup("linux.do"))
      assertEquals(1, attempts.get())
    }
  }

  @Test fun aRouteThatReachedTlsIsPreferredWhenNoForumSentAnHttpResponse() {
    withAutomaticProviders(
      primary = { dnsResponse(it) },
      standby = { dnsResponse(it, ipv4 = alternateAnswer).setBodyDelay(120, TimeUnit.MILLISECONDS) },
      probeForum = { url, dns ->
        val address = dns.lookup(url.host).single()
        ForumDohProbe(if (address == alternateAnswer) ForumDohReachability.TCP_CONNECTED else ForumDohReachability.UNREACHABLE)
      }
    ) { resolver, _, _ ->
      assertEquals(listOf(alternateAnswer), resolver.lookup("linux.do"))
    }
  }

  @Test fun aChallengeOrHttpErrorIsNotAnOpenForum() {
    fun result(code: Int, challenge: Boolean = false): Boolean = Response.Builder()
      .request(Request.Builder().url("https://linux.do/").get().build())
      .protocol(Protocol.HTTP_2).code(code).message("fixture")
      .apply { if (challenge) header("cf-mitigated", "challenge") }
      .build().forumDohResponse().open

    assertTrue(result(200))
    assertFalse(result(200, challenge = true))
    assertFalse(result(403, challenge = true))
    assertFalse(result(503))
  }

  @Test fun manualAutoTestUsesTheHttpResponseAlreadyReceivedFromTheSelectedAddress() {
    val requests = AtomicInteger()
    val page = ForumDohResponse(403, true)
    withAutomaticProviders({ dnsResponse(it) }, { dnsResponse(it) }, probeForum = { _, _ ->
      requests.incrementAndGet()
      ForumDohProbe(ForumDohReachability.RESPONDED, answer, page)
    }) { resolver, _, _ ->
      assertEquals(page, resolver.measureForumSelection("https://linux.do/".toHttpUrl()))
      assertEquals(1, requests.get())
    }
  }

  @Test fun aFailedDirectGetSwitchesResolverBeforeSendingWhilePostIsNotRetried() {
    val certificate = HeldCertificate.Builder().addSubjectAlternativeName("linux.do").build()
    val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
    val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
    val loopback = InetAddress.getByName("127.0.0.1")
    MockWebServer().use { site ->
      site.useHttps(serverTls.sslSocketFactory(), false)
      site.enqueue(MockResponse().setBody("from alternate"))
      site.start(loopback, 0)
      val attempts = ConcurrentLinkedQueue<InetAddress>()
      val sockets = object : SocketFactory() {
        override fun createSocket(): Socket = object : Socket() {
          override fun connect(endpoint: SocketAddress, timeout: Int) {
            val selected = (endpoint as InetSocketAddress).address
            attempts.add(selected)
            if (selected == answer) throw ConnectException("unreachable primary")
            check(selected == alternateAnswer)
            super.connect(InetSocketAddress(loopback, site.port), timeout)
          }
        }
        override fun createSocket(host: String, port: Int): Socket = error("Expected an unconnected socket")
        override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket =
          error("Expected an unconnected socket")
        override fun createSocket(host: InetAddress, port: Int): Socket = error("Expected an unconnected socket")
        override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket =
          error("Expected an unconnected socket")
      }
      withAutomaticProviders(
        primary = { request -> dnsResponse(request) },
        standby = { request -> dnsResponse(request, ipv4 = alternateAnswer) },
        probeForum = { url, dns ->
          val address = dns.lookup(url.host).single()
          ForumDohProbe(if (address == answer) ForumDohReachability.OPEN else ForumDohReachability.RESPONDED, address)
        }
      ) { resolver, _, platformN ->
        val client = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).dns(resolver).socketFactory(sockets)
          .sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager)
          .addInterceptor(resolver::interceptForumRequest).build()
        val request = Request.Builder().url("https://linux.do/").get().build()
        client.newCall(request).execute().use { assertEquals("from alternate", it.body.string()) }
        assertEquals(listOf(answer, alternateAnswer), attempts.toList())
        assertEquals(1, site.requestCount)

        resolver.reset()
        client.connectionPool.evictAll()
        attempts.clear()
        val post = request.newBuilder().post("fixture".toRequestBody()).build()
        assertThrows(IOException::class.java) { client.newCall(post).execute() }
        assertEquals(listOf(answer), attempts.toList())
        assertEquals(1, site.requestCount)
        assertEquals(0, platformN.get())
      }
    }
  }

  @Test fun automaticDnsOnlyUsesPlaintextWhenAllProvidersAreUnavailableAndPolicyAllowsIt() {
    for (fallback in listOf(false, true)) {
      val queries = ConcurrentLinkedQueue<String>()
      val unavailable: (RecordedRequest) -> MockResponse = { request ->
        queries.add(questionName(request))
        MockResponse().setResponseCode(503)
      }
      withAutomaticProviders(unavailable, unavailable, fallback) { resolver, observations, platformN ->
        if (fallback) {
          assertEquals(listOf(answer), resolver.lookup("forum.test"))
          assertEquals(DnsRouteResult.SYSTEM_DNS to null, observations.last())
        } else {
          assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("forum.test") }
          assertEquals(DnsRouteResult.DNS_FAILURE to null, observations.last())
        }
        assertEquals(listOf("example.com", "example.com"), queries.toList())
        assertEquals(if (fallback) 1 else 0, platformN.get())
      }
    }
  }

  @Test fun switchingNetworksWhileTheProviderIsBusyDiscardsItsResult() {
    val entered = CountDownLatch(2)
    val release = CountDownLatch(1)
    withProvider({ request ->
      if (entered.count > 0) {
        entered.countDown()
        check(release.await(8, TimeUnit.SECONDS))
      }
      dnsResponse(request)
    }, fallback = true) { resolver, server, platform ->
      val caller = Executors.newSingleThreadExecutor()
      try {
        val previous = caller.submit<List<InetAddress>> { resolver.lookup("forum.test") }
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        resolver.reset()
        assertEquals(listOf(answer), resolver.lookup("forum.test"))
        release.countDown()
        assertThrows(ExecutionException::class.java) { previous.get(5, TimeUnit.SECONDS) }
        assertEquals(listOf(answer), resolver.lookup("forum.test"))
        assertEquals(4, server.requestCount)
        assertEquals(0, platform.get())
      } finally {
        release.countDown()
        caller.shutdownNow()
      }
    }
  }

  @Test fun aSystemProxyAddressResolvedOnThePreviousNetworkIsDiscarded() {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val platform = object : Dns {
      override fun lookup(hostname: String): List<InetAddress> {
        entered.countDown()
        check(release.await(5, TimeUnit.SECONDS))
        return listOf(answer)
      }
    }
    val config = EncryptedDnsConfig(listOf(EncryptedDnsServer("https://resolver.test/dns-query".toHttpUrl(), emptyList())), true)
    val proxy = Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved("system-proxy.test", 8080))
    val results = mutableListOf<DnsRouteResult>()
    AppEncryptedDns(config, null, platform, onResult = { result, _ -> results.add(result) }).use { resolver ->
      val caller = Executors.newSingleThreadExecutor()
      try {
        val previous = caller.submit<Proxy?> { resolver.systemProxy { proxy } }
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        resolver.reset()
        release.countDown()
        assertThrows(ExecutionException::class.java) { previous.get(5, TimeUnit.SECONDS) }
        assertTrue(results.isEmpty())
        assertEquals(InetSocketAddress(answer, 8080), resolver.systemProxy { proxy }?.address())
        assertEquals(listOf(DnsRouteResult.SYSTEM_PROXY), results)
      } finally {
        release.countDown()
        caller.shutdownNow()
      }
    }
  }

  @Test fun anInvalidProviderCertificateNeverFallsBack() {
    withProvider({ request -> dnsResponse(request) }, fallback = true, trustProvider = false) { resolver, server, platformLookups ->
      val error = assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("forum.test") }
      assertEquals(DnsRouteResult.TLS_FAILURE.description, error.message)
      assertEquals(0, server.requestCount)
      assertEquals(0, platformLookups.get())
    }
  }

  @Test fun aRefusedBootstrapUsesTheSecondAddressInStrictMode() {
    withProvider({ request -> dnsResponse(request) }, bootstrap = listOf("127.0.0.2", "127.0.0.1")) {
      resolver, server, platformLookups ->
      assertEquals(listOf(answer), resolver.lookup("forum.test"))
      assertEquals(2, server.requestCount)
      assertEquals(0, platformLookups.get())
    }
  }

  @Test fun answersWithoutHttpFreshnessUseTheDnsTtlAndRespectHttpAgeAndNoStore() {
    for ((header, expectedRequests) in listOf(null to 2, "Age: 65" to 4, "Cache-Control: no-store" to 4)) {
      withProvider({ request ->
        dnsResponse(request, bothFamilies = true).removeHeader("Cache-Control").apply {
          if (header != null) addHeader(header)
        }
      }) { resolver, server, _ ->
        repeat(2) { assertEquals(2, resolver.lookup("forum.test").size) }
        assertEquals(header, expectedRequests, server.requestCount)
      }
    }
  }

  @Test fun aMissingAddressFamilyUsesTheShorterLifetimeOfItsSoaRecord() {
    for ((minimum, requests) in listOf(60 to 2, 1 to 3)) {
      withProvider({ request ->
        dnsResponse(request, soaMinimum = minimum).removeHeader("Cache-Control").setHeader("Age", "2")
      }) { resolver, server, _ ->
        repeat(2) { assertEquals(listOf(answer), resolver.lookup("forum.test")) }
        assertEquals(requests, server.requestCount)
      }
    }
  }

  @Test fun aRateLimitedProviderWaitsUntilRetryAfterOrNetworkChange() {
    var elapsed = 100L
    withProvider({ MockResponse().setResponseCode(429).setHeader("Retry-After", "120") },
      fallback = true, monotonicMillis = { elapsed }) {
      resolver, server, platformLookups ->
      assertEquals(listOf(answer), resolver.lookup("one.test"))
      val limitedRequests = server.requestCount
      assertTrue(limitedRequests in 1..2)
      elapsed += 119_999
      assertEquals(listOf(answer), resolver.lookup("two.test"))
      assertEquals(limitedRequests, server.requestCount)
      assertEquals(2, platformLookups.get())
      elapsed++
      assertEquals(listOf(answer), resolver.lookup("two.test"))
      val renewed = server.requestCount
      assertTrue(renewed > limitedRequests)
      resolver.reset()
      assertEquals(listOf(answer), resolver.lookup("three.test"))
      assertTrue(server.requestCount > renewed)
    }
  }

  @Test fun aProviderTimeoutWhileReadingABodyCanUseSystemDns() {
    withProvider({ request -> dnsResponse(request).setBodyDelay(5, TimeUnit.SECONDS) }, fallback = true) {
      resolver, _, platformLookups ->
      assertEquals(listOf(answer), resolver.lookup("forum.test"))
      assertEquals(1, platformLookups.get())
    }
  }

  @Test fun theCacheDirectoryIsReclaimedOnStartupResetAndClose() {
    val directory = cache.newFolder()
    val abandoned = File(directory, "dns-492f91a1-6734-463c-af88-35690c9a1493")
    assertTrue(abandoned.mkdir())
    File(abandoned, "journal").writeText("old DNS cache")
    withProvider({ request -> dnsResponse(request) }, cacheDirectory = directory) { resolver, _, _ ->
      repeat(2) {
        resolver.lookup("forum.test")
        assertFalse(abandoned.exists())
        assertEquals(1, directory.listFiles()!!.size)
        resolver.reset()
      }
      resolver.close()
      assertTrue(directory.listFiles()!!.isEmpty())
    }
  }

  @Test fun ipv4OnlyQueriesSkipAaaaAndAChangedNetworkCanUseIpv6() {
    var ipv6 = false
    withProvider({ request -> dnsResponse(request, bothFamilies = true) }, includeIpv6 = { ipv6 }) { resolver, server, _ ->
      assertEquals(listOf(answer), resolver.lookup("forum.test"))
      assertEquals(1, server.requestCount)
      ipv6 = true
      resolver.reset()
      assertEquals(2, resolver.lookup("forum.test").size)
      assertEquals(3, server.requestCount)
    }
  }

  @Test fun ipv6QueriesAreKeptForDualStackIpv6OnlyVpnAndUnknownLinks() {
    val v4 = InetAddress.getByName("192.0.2.1")
    val v6 = InetAddress.getByName("2001:db8::1")
    val linkLocal = InetAddress.getByName("fe80::1")
    assertFalse(includeIpv6Dns(listOf(v4, linkLocal), false))
    assertTrue(includeIpv6Dns(listOf(v4, v6), false))
    assertTrue(includeIpv6Dns(listOf(v6), false))
    assertTrue(includeIpv6Dns(listOf(v4), true))
    assertTrue(includeIpv6Dns(listOf(v4), null))
    assertTrue(includeIpv6Dns(emptyList(), false))
  }

  @Test fun aRetryDateUsesTheProvidersClockWhileFreshAnswersRemainAvailable() {
    var elapsed = 10L
    var limited = false
    withProvider({ request ->
      if (!limited) dnsResponse(request)
      else MockResponse().setResponseCode(503).setHeader("Date", "Mon, 21 Nov 2016 12:00:00 GMT")
        .setHeader("Retry-After", "Mon, 21 Nov 2016 12:02:00 GMT")
    }, monotonicMillis = { elapsed }) { resolver, server, system ->
      assertEquals(listOf(answer), resolver.lookup("warm.test"))
      limited = true
      assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("cold.test") }
      val requests = server.requestCount
      elapsed += 119_999
      assertEquals(listOf(answer), resolver.lookup("warm.test"))
      assertThrows(EncryptedDnsFailure::class.java) { resolver.lookup("cold.test") }
      assertEquals(requests, server.requestCount)
      elapsed++
      limited = false
      assertEquals(listOf(answer), resolver.lookup("cold.test"))
      assertEquals(0, system.get())
    }
  }

  private fun withProvider(
    serve: (RecordedRequest) -> MockResponse,
    fallback: Boolean = false,
    trustProvider: Boolean = true,
    bootstrap: List<String> = listOf("127.0.0.1"),
    cacheDirectory: File = cache.newFolder(),
    includeIpv6: () -> Boolean = { true },
    enableEch: Boolean = false,
    monotonicMillis: () -> Long = { TimeUnit.NANOSECONDS.toMillis(System.nanoTime()) },
    check: (AppEncryptedDns, MockWebServer, AtomicInteger) -> Unit
  ) {
    val certificate = HeldCertificate.Builder().addSubjectAlternativeName("resolver.test").build()
    val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
    val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
    val platformLookups = AtomicInteger()
    val platform = object : Dns {
      override fun lookup(hostname: String): List<InetAddress> {
        platformLookups.incrementAndGet()
        return listOf(answer)
      }
    }
    MockWebServer().use { server ->
      server.useHttps(serverTls.sslSocketFactory(), false)
      server.dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
          assertEquals(null, request.getHeader("Cookie"))
          assertEquals(null, request.getHeader("Authorization"))
          return serve(request)
        }
      }
      server.start(InetAddress.getByName("127.0.0.1"), 0)
      val endpoint = server.url("/dns-query").newBuilder().host("resolver.test").build()
      val config = EncryptedDnsConfig(listOf(EncryptedDnsServer(endpoint, bootstrap.map(InetAddress::getByName))), fallback)
      AppEncryptedDns(config, cacheDirectory, platform, includeIpv6 = includeIpv6, enableEch = enableEch,
        monotonicMillis = monotonicMillis, clientBuilder = {
        OkHttpClient.Builder().apply {
          if (trustProvider) sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager)
        }
      }).use { check(it, server, platformLookups) }
    }
  }

  private fun withAutomaticProviders(
    primary: (RecordedRequest) -> MockResponse,
    standby: (RecordedRequest) -> MockResponse,
    fallback: Boolean = false,
    probeForum: ((HttpUrl, Dns) -> ForumDohProbe)? = null,
    monotonicMillis: () -> Long = { TimeUnit.NANOSECONDS.toMillis(System.nanoTime()) },
    check: (AppEncryptedDns, ConcurrentLinkedQueue<Pair<DnsRouteResult, String?>>, AtomicInteger) -> Unit
  ) {
    val certificate = HeldCertificate.Builder().addSubjectAlternativeName("resolver.test").build()
    val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
    val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
    val loopback = InetAddress.getByName("127.0.0.1")
    val systemN = AtomicInteger()
    val platform = object : Dns {
      override fun lookup(hostname: String): List<InetAddress> {
        systemN.incrementAndGet()
        return listOf(answer)
      }
    }
    val observations = ConcurrentLinkedQueue<Pair<DnsRouteResult, String?>>()
    fun MockWebServer.startDns(id: String, serve: (RecordedRequest) -> MockResponse): EncryptedDnsServer {
      useHttps(serverTls.sslSocketFactory(), false)
      dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse = serve(request)
      }
      start(loopback, 0)
      return EncryptedDnsServer(url("/dns-query").newBuilder().host("resolver.test").build(), listOf(loopback), id)
    }
    MockWebServer().use { first ->
      MockWebServer().use { second ->
        val config = EncryptedDnsConfig(listOf(first.startDns("dnspod", primary), second.startDns("cloudflare", standby)), fallback)
        AppEncryptedDns(config, cache.newFolder(), platform, includeIpv6 = { false },
          onResult = { result, provider -> observations.add(result to provider) },
          probeForum = probeForum,
          monotonicMillis = monotonicMillis,
          clientBuilder = { OkHttpClient.Builder().sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager) }
        ).use { resolver -> check(resolver, observations, systemN) }
      }
    }
  }

  private fun questionName(request: RecordedRequest): String {
    val query = Base64.getUrlDecoder().decode(requireNotNull(request.requestUrl?.queryParameter("dns")))
    val labels = mutableListOf<String>()
    var offset = 12
    while (query[offset] != 0.toByte()) {
      val length = query[offset++].toInt()
      labels.add(String(query, offset, length, Charsets.US_ASCII))
      offset += length
    }
    return labels.joinToString(".")
  }

  private fun dnsResponse(request: RecordedRequest, rcode: Int = 0, bothFamilies: Boolean = false,
    soaMinimum: Int? = null, echConfig: ByteArray? = null, ipv4: InetAddress = answer): MockResponse {
    val query = Base64.getUrlDecoder().decode(requireNotNull(request.requestUrl?.queryParameter("dns")))
    val type = query[query.size - 3].toInt()
    val hasAnswer = rcode == 0 && (type == 1 || bothFamilies || (type == 65 && echConfig != null))
    query[2] = 0x81.toByte()
    query[3] = (0x80 or rcode).toByte()
    query[7] = if (hasAnswer) 1 else 0
    if (!hasAnswer && soaMinimum != null) query[9] = 1
    val response = Buffer().write(query)
    if (hasAnswer) {
      val bytes = when (type) {
        1 -> ipv4.address
        65 -> requireNotNull(echConfig).let { config ->
          Buffer().writeShort(1).writeByte(0).writeShort(5).writeShort(config.size).write(config).readByteArray()
        }
        else -> InetAddress.getByName("2001:db8::1").address
      }
      response.writeShort(0xc00c).writeShort(type).writeShort(1)
        .writeInt(60).writeShort(bytes.size).write(bytes)
    } else if (soaMinimum != null) {
      response.writeShort(0xc00c).writeShort(6).writeShort(1).writeInt(60).writeShort(24)
        .writeShort(0xc00c).writeShort(0xc00c).writeInt(1).writeInt(60).writeInt(60).writeInt(60).writeInt(soaMinimum)
    }
    return MockResponse().setHeader("Content-Type", "application/dns-message")
      .setHeader("Cache-Control", "max-age=60").setBody(response)
  }
}
