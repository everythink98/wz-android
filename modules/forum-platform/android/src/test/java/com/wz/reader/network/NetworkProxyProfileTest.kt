package com.wz.reader

import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import java.io.DataInputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class NetworkProxyProfileTest {
  private lateinit var module: NetworkProxyModule
  private val passwords = listOf(" ", null, "", " padded ", "\u2003")

  @Before fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    module = NetworkProxyModule(BridgeReactContext(RuntimeEnvironment.getApplication()))
  }

  @After fun tearDown() {
    module.invalidate()
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
