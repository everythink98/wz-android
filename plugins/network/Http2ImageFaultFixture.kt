package com.wz.reader

import java.io.Closeable
import java.io.IOException
import java.io.FilterOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import javax.net.SocketFactory
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import org.junit.Assert.*

/** A real HTTP/2 peer behind a TCP relay. DROP keeps TCP open, including after stream cancellation. */
internal class Http2ImageFaultFixture(
  private val blockWrites: Boolean = false,
  private val tls: Boolean = false,
  imageBytes: ByteArray? = null
) : Closeable {
  private val loopback = InetAddress.getByName("127.0.0.1")
  private val server = MockWebServer()
  private val relay = ServerSocket(0, 50, loopback)
  private val workers = Executors.newCachedThreadPool()
  private val sockets = Collections.synchronizedList(mutableListOf<Socket>())
  private val clientSockets = Collections.synchronizedList(mutableListOf<Socket>())
  private val dropOld = AtomicBoolean()
  private val dropAll = AtomicBoolean()
  private val connections = AtomicInteger()
  private val firstReplacementAt = AtomicLong()
  private val acquired = Collections.synchronizedList(mutableListOf<Connection>())
  private val healthyAcquired = Collections.synchronizedList(mutableListOf<Connection>())
  private val field = NetworkProxyRuntime::class.java.getDeclaredField("baseClientTemplate").apply { isAccessible = true }
  private val original = field.get(NetworkProxyRuntime) as OkHttpClient
  private val activeCalls = Collections.synchronizedList(mutableListOf<Call>())
  private val createdSockets = AtomicInteger()
  private val writesBlocked = CountDownLatch(1)
  val png: ByteArray = imageBytes ?: java.util.Base64.getDecoder().decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XQAAAAASUVORK5CYII="
  )

  init {
    val protocols = if (tls) listOf(Protocol.HTTP_2, Protocol.HTTP_1_1) else listOf(Protocol.H2_PRIOR_KNOWLEDGE)
    server.protocols = protocols
    val certificate = HeldCertificate.Builder().commonName("image-fixture").addSubjectAlternativeName("127.0.0.1").build()
    if (tls) server.useHttps(HandshakeCertificates.Builder().heldCertificate(certificate).build().sslSocketFactory(), false)
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        val response = MockResponse().setHeader("Content-Type", "image/png")
          .setHeader("Cache-Control", "no-store").setBody(Buffer().write(png))
        if (request.path == "/slow.png") response.setHeadersDelay(12, TimeUnit.SECONDS)
        if (request.path == "/large.png") response.setBody(Buffer().write(ByteArray(33 * 1024) { 7 }))
          .throttleBody(1024, 1, TimeUnit.SECONDS)
        return response
      }
    }
    server.start(loopback, 0)
    workers.execute {
      try {
        while (!relay.isClosed) {
          val incoming = relay.accept()
          val number = connections.incrementAndGet()
          if (number == 2) firstReplacementAt.set(System.nanoTime())
          val outgoing = Socket(loopback, server.port)
          sockets.add(incoming); sockets.add(outgoing)
          for ((from, to) in listOf(incoming to outgoing, outgoing to incoming)) workers.execute {
            try {
              val buffer = ByteArray(8192)
              val input = from.getInputStream()
              val output = to.getOutputStream()
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (!dropAll.get() && (number != 1 || !dropOld.get())) { output.write(buffer, 0, count); output.flush() }
              }
            } catch (_: IOException) { }
            finally { from.close(); to.close() }
          }
        }
      } catch (_: IOException) { }
    }
    val builder = original.newBuilder().protocols(protocols)
    if (tls) {
      val trusted = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
      builder.sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager)
    }
    if (blockWrites) builder.socketFactory(object : SocketFactory() {
      override fun createSocket(): Socket {
        val number = createdSockets.incrementAndGet()
        return object : Socket() {
          private val closed = CountDownLatch(1)
          override fun getOutputStream() = object : FilterOutputStream(super.getOutputStream()) {
            override fun write(bytes: ByteArray, offset: Int, length: Int) {
              if (number == 1 && dropOld.get()) {
                writesBlocked.countDown()
                closed.await()
                throw SocketException("fixture socket closed during blocked write")
              }
              out.write(bytes, offset, length)
            }
          }
          override fun close() { closed.countDown(); super.close() }
        }.also { clientSockets.add(it) }
      }
      override fun createSocket(host: String, port: Int): Socket = throw UnsupportedOperationException()
      override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket = throw UnsupportedOperationException()
      override fun createSocket(host: InetAddress, port: Int): Socket = throw UnsupportedOperationException()
      override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket = throw UnsupportedOperationException()
    })
    field.set(NetworkProxyRuntime, builder
      .eventListener(object : EventListener() {
        override fun connectionAcquired(call: Call, connection: Connection) {
          if (call.request().url.port == relay.localPort) acquired.add(connection)
          else if (call.request().url.port == server.port) healthyAcquired.add(connection)
        }
      }).build())
    NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
  }

  fun url(path: String) = (if (tls) "https" else "http") + "://127.0.0.1:" + relay.localPort + path

  fun call(path: String, factory: Call.Factory = NetworkProxyRuntime.imageCallFactory): Call =
    factory.newCall(Request.Builder().url(url(path)).build()).also { activeCalls.add(it) }

  fun warmAndDrop() {
    call("/warm.png").execute().use { assertArrayEquals(png, it.body!!.bytes()) }
    assertEquals(1, connections.get())
    dropOld.set(true)
  }

  fun assertExplicitDisconnect() {
    warmAndDrop()
    synchronized(sockets) { sockets.forEach { it.close() } }
    val start = System.nanoTime()
    call("/reset.png").execute().use { assertArrayEquals(png, it.body!!.bytes()) }
    val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
    assertTrue("explicit connection loss needs no recovery timer; elapsed=" + elapsed, elapsed < 2_000)
    assertEquals(2, connections.get())
    println("HTTP2_RESET elapsedMs=" + elapsed + " connections=" + connections.get())
  }

  fun assertHealthySlowResponses() {
    call("/warm.png").execute().use { it.body!!.bytes() }
    val old = acquired.last()
    call("/slow.png").execute().use { assertArrayEquals(png, it.body!!.bytes()) }
    assertSame("a responsive connection with slow headers stays reusable", old, acquired.last())
    val start = System.nanoTime()
    call("/large.png").execute().use { assertEquals(33 * 1024, it.body!!.bytes().size) }
    val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
    assertTrue("the test must actually exceed the former 30s complete-call limit", elapsed > 30_000)
    assertSame(old, acquired.last())
    assertEquals(1, connections.get())
    println("HTTP2_PROGRESS elapsedMs=" + elapsed + " bytes=" + (33 * 1024) + " connections=" + connections.get())
  }

  fun assertOfflineTerminates() {
    warmAndDrop()
    dropAll.set(true)
    val done = CountDownLatch(1)
    val terminals = AtomicInteger()
    call("/offline.png").enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) { terminals.incrementAndGet(); done.countDown() }
      override fun onResponse(call: Call, response: Response) { response.close(); terminals.addAndGet(100); done.countDown() }
    })
    assertTrue("unavailable network must terminate within its finite transport budget", done.await(25, TimeUnit.SECONDS))
    assertEquals(1, terminals.get())
    val attempts = connections.get()
    Thread.sleep(1500)
    assertEquals("no retry after the final failure", attempts, connections.get())
    assertTrue("recovery must not keep creating fresh routes", attempts <= 2)
    println("HTTP2_OFFLINE connections=" + attempts + " terminals=" + terminals.get())
  }

  fun assertRetiredRuntimeDoesNotReplay() {
    warmAndDrop()
    val done = CountDownLatch(1)
    val successes = AtomicInteger()
    val retired = call("/retired.png")
    retired.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) { done.countDown() }
      override fun onResponse(call: Call, response: Response) { response.close(); successes.incrementAndGet(); done.countDown() }
    })
    await("request must first acquire the stale connection") { acquired.size == 2 }
    NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
    assertTrue(done.await(12, TimeUnit.SECONDS))
    assertEquals("retired image context must not silently send a recovery request", 0, successes.get())
    assertFalse("Fresco must receive a failure instead of interpreting this as consumer cancellation", retired.isCanceled())
    assertNoReplay()
  }

  fun awaitStalledImages(count: Int) = await("all images must acquire the old connection") { acquired.size >= count + 1 }

  fun assertNoReplay() = assertEquals("only the warm request may reach the server", 1, server.requestCount)

  fun assertWriteFaultObserved() {
    if (blockWrites) assertTrue("the platform must actually enter the blocked raw write", writesBlocked.await(2, TimeUnit.SECONDS))
  }

  fun assertFreshConnection(start: Long? = null) {
    // OkHttp may race two TCP connects, then close the redundant candidate before acquiring it.
    assertTrue("replacement dialing is bounded", connections.get() in 2..3)
    assertEquals("consumers share one acquired replacement", 2, acquired.toSet().size)
    assertNotSame(acquired.first(), acquired.last())
    if (start != null) {
      val elapsed = TimeUnit.NANOSECONDS.toMillis(firstReplacementAt.get() - start)
      assertTrue("replacement connection must start inside 10s; elapsed=" + elapsed, elapsed in 0..9_999)
    }
  }

  fun assertRecoveryAfterReopen() {
    warmAndDrop()
    val healthyDone = CountDownLatch(1)
    val healthySucceeded = AtomicBoolean()
    val healthy = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder()
      .url((if (tls) "https" else "http") + "://127.0.0.1:" + server.port + "/slow.png").build())
    activeCalls.add(healthy)
    healthy.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) { healthyDone.countDown() }
      override fun onResponse(call: Call, response: Response) {
        response.use { healthySucceeded.set(it.body!!.bytes().contentEquals(png)) }
        healthyDone.countDown()
      }
    })
    await("independent healthy media connection must overlap recovery") { healthyAcquired.isNotEmpty() }
    val old = acquired.first()
    val initial = call("/canceled.png")
    val canceled = CountDownLatch(1)
    initial.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) { canceled.countDown() }
      override fun onResponse(call: Call, response: Response) { response.close(); canceled.countDown() }
    })
    await("old connection acquired before cancellation") { acquired.size >= 2 }
    assertSame(old, acquired.last())
    if (blockWrites) assertTrue(writesBlocked.await(2, TimeUnit.SECONDS))
    initial.cancel()
    if (!blockWrites) assertTrue(canceled.await(2, TimeUnit.SECONDS))
    val completed = CountDownLatch(2)
    val failures = Collections.synchronizedList(mutableListOf<Throwable>())
    val start = System.nanoTime()
    for ((index, factory) in listOf(NetworkProxyRuntime.imageCallFactory, NetworkProxyRuntime.frescoCallFactory).withIndex()) {
      call("/reopened-" + index + ".png", factory).enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) { failures.add(error); completed.countDown() }
        override fun onResponse(call: Call, response: Response) {
          try { response.use { assertArrayEquals(png, it.body!!.bytes()) } }
          catch (error: Throwable) { failures.add(error) }
          finally { completed.countDown() }
        }
      })
    }
    assertTrue("two reopened images must recover within 15s; connections=" + connections.get(), completed.await(15, TimeUnit.SECONDS))
    assertEquals("transport recovery must remain inside the original image calls: " + failures, 0, failures.size)
    assertTrue("cancel completion must not remain trapped in a blocked writer", canceled.await(2, TimeUnit.SECONDS))
    val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
    val connectMs = TimeUnit.NANOSECONDS.toMillis(firstReplacementAt.get() - start)
    assertTrue("fresh connection must begin within 10s; elapsed=" + connectMs, connectMs in 0..9_999)
    assertFreshConnection()
    val fresh = acquired.last()
    assertNotSame(old, fresh)
    call("/after.png").execute().use { assertArrayEquals(png, it.body!!.bytes()) }
    assertSame("dead connection must never be selected again", fresh, acquired.last())
    assertTrue(healthyDone.await(15, TimeUnit.SECONDS))
    assertTrue("another healthy media connection must finish without cancellation", healthySucceeded.get())
    assertFalse(healthy.isCanceled())
    assertEquals(1, healthyAcquired.toSet().size)
    println("HTTP2_RECOVERY tls=" + tls + " blockedWrite=" + blockWrites + " connectMs=" + connectMs + " elapsedMs=" + elapsed + " connections=" + connections.get() + " calls=" + activeCalls.size + " serverRequests=" + server.requestCount)
  }

  private fun await(message: String, condition: () -> Boolean) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
    while (!condition() && System.nanoTime() < deadline) Thread.sleep(10)
    assertTrue(message, condition())
  }

  override fun close() {
    activeCalls.forEach { it.cancel() }
    // Failure cleanup must unblock synthetic client writes too, without interrupting OkHttp workers.
    synchronized(clientSockets) { clientSockets.forEach { it.close() } }
    synchronized(acquired) { acquired.forEach { it.socket().close() } }
    relay.close()
    synchronized(sockets) { sockets.forEach { it.close() } }
    workers.shutdownNow()
    server.close()
    val retired = NetworkProxyRuntime.imageClientForTests()
    field.set(NetworkProxyRuntime, original)
    NetworkProxyRuntime.recoverForumReadChannel("linuxdo")
    await("all calls, bodies and runtime leases must release") { retired.dispatcher.executorService.isShutdown }
    assertTrue(workers.awaitTermination(3, TimeUnit.SECONDS))
  }
}
