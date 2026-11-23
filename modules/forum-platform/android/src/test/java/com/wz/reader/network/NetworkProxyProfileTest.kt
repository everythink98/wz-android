package com.wz.reader

import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import android.system.ErrnoException
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.NetworkInfo
import android.system.OsConstants
import android.os.Looper
import com.bumptech.glide.Priority
import com.bumptech.glide.load.data.DataFetcher
import com.bumptech.glide.load.model.GlideUrl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import java.io.IOException
import java.io.DataInputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNetworkCapabilities
import org.robolectric.shadows.ShadowNetworkInfo
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class NetworkProxyProfileTest {
  @Test fun socketFailuresPreferBoundedPlatformErrnoWithoutExportingFunctionNames() {
    val client = NetworkProxyRuntime.configureManagedClient(okhttp3.OkHttpClient.Builder()).build()
    val call = client.newCall(okhttp3.Request.Builder().url("https://linux.do/private-token").build())
    val listener = client.eventListenerFactory.create(call)
    val cases = listOf(
      Triple(OsConstants.ECONNRESET, "ECONNRESET", "reset"),
      Triple(OsConstants.ECONNABORTED, "ECONNABORTED", "aborted"),
      Triple(OsConstants.EBADF, "EBADF", "closed"),
      Triple(OsConstants.ENOTCONN, "ENOTCONN", "closed"),
      Triple(OsConstants.ECONNREFUSED, "ECONNREFUSED", "refused"),
      Triple(OsConstants.ENETUNREACH, "ENETUNREACH", "unreachable"),
      Triple(OsConstants.EHOSTUNREACH, "EHOSTUNREACH", "unreachable"),
      Triple(OsConstants.ETIMEDOUT, "ETIMEDOUT", "timeout"),
      Triple(OsConstants.EPIPE, "EPIPE", "broken_pipe"),
      Triple(OsConstants.EACCES, "other", "other")
    )
    for ((errno, expectedErrno, expectedFailure) in cases) {
      val error = java.net.SocketException("Connection refused PRIVATE_WRAPPER").apply {
        initCause(ErrnoException("PRIVATE_HOST_AND_TOKEN", errno))
      }
      listener.connectFailed(call, InetSocketAddress.createUnresolved("private.example", 443), Proxy.NO_PROXY, null, error)
      val fields = DiagnosticJournal.safeNetworkFields(NetworkProxyRuntime.readNetworkDiagnosticEvents().last().fields)
      assertEquals(expectedErrno, fields["socketErrno"])
      assertEquals(expectedFailure, fields["socketFailure"])
      assertFalse(fields.toString().contains("PRIVATE"))
      assertFalse(fields.toString().contains("private.example"))
    }
    var deep: Throwable = ErrnoException("PRIVATE_DEEP", OsConstants.ECONNRESET)
    repeat(8) { deep = IOException("PRIVATE_WRAPPER", deep) }
    listener.callFailed(call, deep as IOException)
    val fields = DiagnosticJournal.safeNetworkFields(NetworkProxyRuntime.readNetworkDiagnosticEvents().last().fields)
    assertEquals("other", fields["socketFailure"])
    assertNull(fields["socketErrno"])
  }
  private lateinit var module: NetworkProxyModule
  private val passwords = listOf(" ", null, "", " padded ", "\u2003")

  @Before fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    module = NetworkProxyModule(BridgeReactContext(RuntimeEnvironment.getApplication()))
  }

  @After fun tearDown() {
    module.invalidate()
  }

  @Test fun invalidatedBridgeRejectsNewWorkerOperationsThroughTheirPromises() {
    module.invalidate()
    val rejected = mutableListOf<String>()
    val promise = java.lang.reflect.Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) {
      _, method, args -> if (method.name == "reject") rejected.add(args!![0] as String)
      null
    } as Promise
    module.applyProxy(null, promise)
    module.recoverForumReadChannel("linuxdo", 0.0, "fixture", promise)
    module.setLinuxDoCookieResponseBarrier(true, "startup", JavaOnlyMap(), promise)
    module.clearManagedLoginCookies("linuxdo", JavaOnlyMap(), promise)
    module.getDefaultWebViewUserAgent(promise)
    assertEquals(listOf("proxy_apply_failed", "forum_read_channel_recovery_failed", "cookie_barrier_failed",
      "cookie_clear_failed", "E_DEFAULT_USER_AGENT"), rejected)
  }

  @Test fun invalidatingTheBridgeSettlesAnAlreadyQueuedOperation() {
    val started = java.util.concurrent.CountDownLatch(1)
    val release = java.util.concurrent.CountDownLatch(1)
    fun rejection(action: (String) -> Unit): Promise = java.lang.reflect.Proxy.newProxyInstance(
      Promise::class.java.classLoader, arrayOf(Promise::class.java)
    ) { _, method, args -> if (method.name == "reject") action(args!![0] as String); null } as Promise
    module.recoverForumReadChannel("linuxdo", -1.0, "fixture", rejection {
      started.countDown()
      try { release.await(5, TimeUnit.SECONDS) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    })
    try {
      assertTrue(started.await(5, TimeUnit.SECONDS))
      val queued = CompletableFuture<String>()
      module.applyProxy(null, rejection { queued.complete(it) })
      module.invalidate()
      assertEquals("proxy_apply_failed", queued.get(2, TimeUnit.SECONDS))
    } finally {
      release.countDown()
    }
  }

  @Test fun glideDropsOwnershipOnTheMainThreadAndCancelsTheSocketOnAWorker() {
    val canceledOn = CompletableFuture<Thread>()
    val client = OkHttpClient()
    val factory = Call.Factory { request ->
      object : Call by client.newCall(request) {
        override fun enqueue(responseCallback: Callback) = Unit
        override fun cancel() { canceledOn.complete(Thread.currentThread()) }
      }
    }
    val url = GlideUrl("https://example.invalid/image", com.bumptech.glide.load.model.Headers { emptyMap() })
    val fetcher = CloseSafeGlideStreamFetcher(factory, url)
    val main = Looper.getMainLooper().thread
    assertEquals(main, Thread.currentThread())
    fetcher.loadData(Priority.NORMAL, object : DataFetcher.DataCallback<InputStream> {
      override fun onDataReady(data: InputStream?) = Unit
      override fun onLoadFailed(error: Exception) = throw error
    })
    fetcher.cancel()
    assertFalse(main === canceledOn.get(2, TimeUnit.SECONDS))
  }

  @Test fun networkSettingsShowTheAppsDefaultTransportBeforeAndAfterVpn() {
    val manager = RuntimeEnvironment.getApplication().getSystemService(ConnectivityManager::class.java)
    shadowOf(manager).setActiveNetworkInfo(ShadowNetworkInfo.newInstance(
      NetworkInfo.DetailedState.CONNECTED, ConnectivityManager.TYPE_WIFI, 0, true, NetworkInfo.State.CONNECTED))
    val caps = ShadowNetworkCapabilities.newInstance()
    shadowOf(caps).addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
    val observed = mutableListOf<Any?>()
    val promise = java.lang.reflect.Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) {
      _, method, args -> if (method.name == "resolve") observed.add(args?.firstOrNull())
      null
    } as Promise
    shadowOf(manager).setNetworkCapabilities(manager.activeNetwork, caps)
    module.getSystemNetworkType(promise)
    shadowOf(caps).addTransportType(NetworkCapabilities.TRANSPORT_VPN)
    shadowOf(manager).setNetworkCapabilities(manager.activeNetwork, caps)
    module.getSystemNetworkType(promise)
    shadowOf(manager).setActiveNetworkInfo(null)
    module.getSystemNetworkType(promise)
    assertEquals(listOf("wifi", "vpn", "offline"), observed)
  }

  @Test fun managedRequestsReachEveryForumThroughTheSelectedHttpOrSocksProxy() {
    val hosts = listOf("linux.do", "www.nodeseek.com", "www.v2ex.com", "www.yaohuo.me")
    for (protocol in listOf("http", "socks5")) {
      ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).use { upstream ->
        upstream.soTimeout = 3000
        val worker = Executors.newSingleThreadExecutor()
        val relay = LocalNetworkProxyServer(NetworkProxyProfile(protocol, "127.0.0.1", upstream.localPort, null, null))
        try {
          relay.start()
          NetworkProxyRuntime.setLocalProxyPort(relay.port)
          val client = NetworkProxyRuntime.configureManagedClient(okhttp3.OkHttpClient.Builder())
            .dns(object : okhttp3.Dns {
              override fun lookup(hostname: String): List<InetAddress> {
                check(hostname == "127.0.0.1") { "the managed request attempted direct DNS" }
                return listOf(InetAddress.getByName(hostname))
              }
            })
            .callTimeout(3, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
          for (host in hosts) {
            val observed = worker.submit<String> {
              upstream.accept().use { socket ->
                socket.soTimeout = 3000
                val input = socket.getInputStream()
                val output = socket.getOutputStream()
                if (protocol == "http") {
                  val line = input.readHeaderLines().first()
                  output.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n".toByteArray())
                  line.substringAfter("CONNECT ").substringBefore(' ')
                } else {
                  assertArrayEquals(byteArrayOf(5, 1, 0), input.readExactly(3))
                  output.write(byteArrayOf(5, 0))
                  assertArrayEquals(byteArrayOf(5, 1, 0, 3), input.readExactly(4))
                  val name = String(input.readExactly(input.read()), Charsets.US_ASCII)
                  val port = DataInputStream(input).readUnsignedShort()
                  output.write(byteArrayOf(5, 5, 0, 1, 0, 0, 0, 0, 0, 0))
                  "$name:$port"
                }
              }
            }
            val request = okhttp3.Request.Builder().url("https://$host/").build()
            org.junit.Assert.assertThrows(IOException::class.java) { client.newCall(request).execute().close() }
            assertEquals("$protocol must receive the website destination", "$host:443", observed.get(3, TimeUnit.SECONDS))
          }
        } finally {
          NetworkProxyRuntime.blockNetworkRequests()
          relay.stop()
          worker.shutdownNow()
        }
      }
    }
  }

  @Test fun profileMappingPreservesAbsentNullEmptyAndWhitespacePasswords() {
    for (protocol in listOf("http", "socks5")) {
      val absent = JavaOnlyMap.of("protocol", protocol, "host", "127.0.0.1", "port", 8080)
      assertNull(parseProfile(absent).password)
      for ((index, password) in passwords.withIndex()) {
        val mapped = parseProfile(profileMap(protocol, 8080, "reader", password))
        assertEquals("$protocol password case $index", password, mapped.password)
      }
    }
  }

  @Test fun httpProxyPasswordsReachConnectAndForwardAuthorizationBytes() {
    for (method in listOf("CONNECT", "GET")) {
      for (username in listOf(null, "reader")) for (password in passwords) {
        val target = if (method == "CONNECT") "example.invalid:443" else "http://example.invalid/probe"
        exchange("http", username, password, "$method $target HTTP/1.1", if (method == "CONNECT") 200 else 204) { socket ->
          val lines = socket.getInputStream().readHeaderLines()
          assertEquals("$method $target HTTP/1.1", lines.first())
          val credentials = (username.orEmpty() + ":" + password.orEmpty()).toByteArray(Charsets.UTF_8)
          val actual = lines.singleOrNull { it.startsWith("Proxy-Authorization:", ignoreCase = true) }
          if (username.isNullOrEmpty() && password.isNullOrEmpty()) {
            assertNull("absent credentials must not enable HTTP authentication", actual)
          } else {
            assertEquals("Proxy-Authorization: Basic " + Base64.getEncoder().encodeToString(credentials), actual)
          }
          socket.getOutputStream().apply {
            write((if (method == "CONNECT") "HTTP/1.1 200 Connection Established\r\n\r\n"
              else "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
            flush()
          }
        }
      }
    }
  }

  @Test fun socks5ProxyPasswordsReachAuthenticationSelectionAndUtf8Bytes() {
    for (username in listOf(null, "reader")) for (password in passwords) {
      exchange("socks5", username, password, "CONNECT example.invalid:443 HTTP/1.1", 200) { socket ->
        val input = socket.getInputStream()
        val output = socket.getOutputStream()
        val authenticated = !username.isNullOrEmpty() || !password.isNullOrEmpty()
        val greeting = input.readExactly(2)
        assertArrayEquals(
          if (authenticated) byteArrayOf(5, 2, 0, 2) else byteArrayOf(5, 1, 0),
          greeting + input.readExactly(greeting[1].toInt() and 0xff)
        )
        output.write(byteArrayOf(5, (if (authenticated) 2 else 0).toByte()))
        output.flush()
        if (authenticated) {
          assertEquals(1, input.read())
          assertArrayEquals(username.orEmpty().toByteArray(Charsets.UTF_8), input.readExactly(input.read()))
          assertArrayEquals(password.orEmpty().toByteArray(Charsets.UTF_8), input.readExactly(input.read()))
          output.write(byteArrayOf(1, 0))
          output.flush()
        }
        val host = "example.invalid".toByteArray(Charsets.UTF_8)
        val connect = byteArrayOf(5, 1, 0, 3, host.size.toByte()) + host + byteArrayOf(1, 0xbb.toByte())
        assertArrayEquals(connect, input.readExactly(connect.size))
        output.write(byteArrayOf(5, 0, 0, 1, 127, 0, 0, 1, 0, 0))
        output.flush()
      }
    }
  }

  private fun profileMap(protocol: String, port: Int, username: String?, password: String?) = JavaOnlyMap.of(
    "protocol", protocol, "host", "127.0.0.1", "port", port, "username", username, "password", password
  )

  private fun parseProfile(profile: ReadableMap): NetworkProxyProfile =
    NetworkProxyModule::class.java.getDeclaredMethod("parseProfile", ReadableMap::class.java).apply {
      isAccessible = true
    }.invoke(module, profile) as NetworkProxyProfile

  private fun exchange(
    protocol: String,
    username: String?,
    password: String?,
    requestLine: String,
    expectedStatus: Int,
    upstream: (Socket) -> Unit
  ) {
    ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { listener ->
      listener.soTimeout = 2_000
      val server = LocalNetworkProxyServer(parseProfile(profileMap(protocol, listener.localPort, username, password)))
      val executor = Executors.newSingleThreadExecutor()
      try {
        server.start()
        val response = executor.submit<List<String>> {
          Socket("127.0.0.1", server.port).use { client ->
            client.soTimeout = 2_000
            client.getOutputStream().apply {
              write("$requestLine\r\nHost: example.invalid\r\n\r\n".toByteArray())
              flush()
            }
            client.getInputStream().readHeaderLines()
          }
        }
        listener.accept().use { socket ->
          socket.soTimeout = 2_000
          upstream(socket)
        }
        assertTrue(response.get(3, TimeUnit.SECONDS).first().startsWith("HTTP/1.1 $expectedStatus "))
      } finally {
        server.stop()
        executor.shutdownNow()
        assertTrue("the local client worker must stop", executor.awaitTermination(3, TimeUnit.SECONDS))
      }
    }
  }

  private fun InputStream.readExactly(size: Int): ByteArray {
    assertTrue("the proxy must send the expected field", size >= 0)
    return ByteArray(size).also { DataInputStream(this).readFully(it) }
  }

  private fun InputStream.readHeaderLines(): List<String> {
    val reader = bufferedReader(Charsets.ISO_8859_1)
    return buildList {
      while (true) {
        val line = reader.readLine() ?: error("proxy closed before completing its headers")
        if (line.isEmpty()) break
        add(line)
      }
    }
  }
}
