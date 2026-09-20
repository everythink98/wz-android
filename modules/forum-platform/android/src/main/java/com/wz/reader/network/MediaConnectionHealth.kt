package com.wz.reader

import java.io.IOException
import java.net.InetAddress
import java.net.Socket
import java.util.WeakHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocketFactory
import okhttp3.Connection
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okio.AsyncTimeout

/** Owns connection health, independently of image mounts and individual Call cancellation. */
internal class MediaConnectionHealth(private val base: OkHttpClient) {
  private val rawSockets = WeakHashMap<Socket, Socket>()
  private val delegate = base.sslSocketFactory
  private val tls = object : SSLSocketFactory() {
    override fun getDefaultCipherSuites() = delegate.defaultCipherSuites
    override fun getSupportedCipherSuites() = delegate.supportedCipherSuites
    override fun createSocket(raw: Socket, host: String, port: Int, autoClose: Boolean): Socket =
      delegate.createSocket(raw, host, port, autoClose).also { ssl ->
        synchronized(rawSockets) { rawSockets[ssl] = raw }
      }
    override fun createSocket() = delegate.createSocket()
    override fun createSocket(host: String, port: Int) = delegate.createSocket(host, port)
    override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int) =
      delegate.createSocket(host, port, local, localPort)
    override fun createSocket(host: InetAddress, port: Int) = delegate.createSocket(host, port)
    override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int) =
      delegate.createSocket(host, port, local, localPort)
  }

  fun configure(builder: OkHttpClient.Builder): OkHttpClient.Builder = builder
    // A lost pong is detected in <= 8s, leaving scheduling slack inside the 10s controlled budget.
    .pingInterval(4, TimeUnit.SECONDS)
    .sslSocketFactory(tls, requireNotNull(base.x509TrustManager))

  fun startHeaders(connection: Connection, onClosed: () -> Unit): AsyncTimeout? {
    if (connection.protocol() !in listOf(Protocol.HTTP_2, Protocol.H2_PRIOR_KNOWLEDGE)) return null
    val socket = connection.socket()
    val raw = synchronized(rawSockets) { rawSockets[socket] } ?: socket
    return object : AsyncTimeout() {
      override fun timedOut() {
        // Do not call Call.cancel(), HTTP/2 GOAWAY or SSLSocket.close(): each can wait for the
        // blocked writer. Closing the original TCP socket wakes that writer and OkHttp's reader.
        val closed = synchronized(raw) {
          if (raw.isClosed) false else {
            try { raw.close() } catch (_: IOException) { }
            true
          }
        }
        if (closed) onClosed()
      }
    }.apply {
      timeout(4, TimeUnit.SECONDS)
      enter()
    }
  }
}
