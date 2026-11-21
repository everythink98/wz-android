package com.wz.reader

import android.os.Build
import androidx.annotation.Keep
import java.io.IOException
import java.net.InetAddress
import java.net.Socket
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager
import okhttp3.Dns
import okhttp3.OkHttpClient
import okio.ByteString
import org.conscrypt.Conscrypt
import org.conscrypt.ConscryptNetworkSecurityPolicy
import org.conscrypt.DomainEncryptionMode

// Conscrypt wraps extended managers on real sockets and loses their ECH policy. Its Android
// engine discovers these callbacks by name and passes the handshake context to the platform trust manager.
internal class DohEchTrustManager(private val trust: X509ExtendedTrustManager) : X509TrustManager {
  @Keep fun getNetworkSecurityPolicy() = policy
  override fun getAcceptedIssuers(): Array<X509Certificate> = trust.acceptedIssuers
  override fun checkClientTrusted(chain: Array<X509Certificate>, auth: String) = trust.checkClientTrusted(chain, auth)
  override fun checkServerTrusted(chain: Array<X509Certificate>, auth: String) {
    throw CertificateException("Missing TLS handshake context")
  }
  @Keep fun checkClientTrusted(chain: Array<X509Certificate>, auth: String, engine: SSLEngine) =
    trust.checkClientTrusted(chain, auth, engine)
  @Keep fun checkServerTrusted(chain: Array<X509Certificate>, auth: String, engine: SSLEngine) =
    trust.checkServerTrusted(chain, auth, engine)

  companion object {
    private val policy: ConscryptNetworkSecurityPolicy = object : ConscryptNetworkSecurityPolicy() {
      override fun getDomainEncryptionMode(hostname: String?) = DomainEncryptionMode.REQUIRED
    }
  }
}

internal fun List<Dns.Record>.echForAddress(host: String, address: InetAddress): ByteString? {
  if (none { it is Dns.Record.IpAddress && it.hostname == host && it.address == address }) return null
  return filterIsInstance<Dns.Record.ServiceMetadata>().firstOrNull { it.hostname == host }?.echConfigList
}

internal open class LayeredTlsSocketFactory(protected val delegate: SSLSocketFactory) : SSLSocketFactory() {
  override fun getDefaultCipherSuites() = delegate.defaultCipherSuites
  override fun getSupportedCipherSuites() = delegate.supportedCipherSuites
  override fun createSocket(raw: Socket, host: String, port: Int, autoClose: Boolean): Socket =
    delegate.createSocket(raw, host, port, autoClose)
  override fun createSocket() = delegate.createSocket()
  override fun createSocket(host: String, port: Int) = delegate.createSocket(host, port)
  override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int) =
    delegate.createSocket(host, port, local, localPort)
  override fun createSocket(host: InetAddress, port: Int) = delegate.createSocket(host, port)
  override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int) =
    delegate.createSocket(host, port, local, localPort)
}

// Android 17's OkHttp adapter passes the route's ECH config to the platform itself.
internal fun OkHttpClient.withDohTls(configFor: (String, InetAddress, Int) -> ByteString?): OkHttpClient {
  if (Build.VERSION.SDK_INT !in 24..36) return this
  val trust = requireNotNull(x509TrustManager)
  val bundled by lazy {
    val platformTrust = trust as? X509ExtendedTrustManager ?: throw IOException("无法保留当前 TLS 的站点证书校验")
    SSLContext.getInstance("TLS", Conscrypt.newProvider()).apply {
      init(null, arrayOf(DohEchTrustManager(platformTrust)), null)
    }.socketFactory
  }
  val factory = object : LayeredTlsSocketFactory(sslSocketFactory) {
    override fun createSocket(raw: Socket, host: String, port: Int, autoClose: Boolean): Socket {
      val config = if (raw.port == port) configFor(host, raw.inetAddress, port) else null
      if (config == null) return super.createSocket(raw, host, port, autoClose)
      val socket = bundled.createSocket(raw, host, port, autoClose) as SSLSocket
      try {
        Conscrypt.setHostname(socket, host)
        Conscrypt.setEchConfigList(socket, config.toByteArray())
        return socket
      } catch (error: Exception) {
        socket.close()
        throw IOException("无法应用站点的 ECH 配置", error)
      }
    }
  }
  return newBuilder().sslSocketFactory(factory, trust).build()
}
