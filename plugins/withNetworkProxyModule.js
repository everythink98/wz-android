const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');

const EXPO_VIDEO_VERSION = '3.0.16';
const EXPO_VIDEO_DATA_SOURCE_PATH = path.join(
  'node_modules',
  'expo-video',
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'video',
  'utils',
  'DataSourceUtils.kt'
);
const EXPO_VIDEO_OKHTTP_IMPORT = 'import okhttp3.OkHttpClient';
const EXPO_VIDEO_MANAGED_IMPORT = 'import com.facebook.react.modules.network.OkHttpClientProvider';
const EXPO_VIDEO_CLIENT = '  val client = OkHttpClient.Builder().build()';
const EXPO_VIDEO_MANAGED_CLIENT = '  val client = OkHttpClientProvider.createClient()';
const EXPO_VIDEO_SOURCE_SHA256 = '18a6a000d9da4b16109978156917d98c09c728e12a186a660e7857d488db237a';
const EXPO_VIDEO_PATCHED_SHA256 = '3e599f363e5be89357f7e97f9b3558a6f772ee151a2c7b43605b6f58791ac595';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function patchExpoVideoDataSource(projectRoot) {
  const packageRoot = path.join(projectRoot, 'node_modules', 'expo-video');
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const sourcePath = path.join(projectRoot, EXPO_VIDEO_DATA_SOURCE_PATH);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceHash = sha256(source);
  if (packageJson.version === EXPO_VIDEO_VERSION && sourceHash === EXPO_VIDEO_PATCHED_SHA256) {
    return;
  }
  if (packageJson.version !== EXPO_VIDEO_VERSION || sourceHash !== EXPO_VIDEO_SOURCE_SHA256) {
    throw new Error('Expo Video DataSource 源码与已审核版本不匹配，拒绝生成 Android 工程。');
  }
  const patched = source
    .replace(EXPO_VIDEO_OKHTTP_IMPORT, EXPO_VIDEO_MANAGED_IMPORT)
    .replace(EXPO_VIDEO_CLIENT, EXPO_VIDEO_MANAGED_CLIENT);
  if (sha256(patched) !== EXPO_VIDEO_PATCHED_SHA256) {
    throw new Error('Expo Video DataSource patch 结果不可信，拒绝生成 Android 工程。');
  }
  fs.writeFileSync(sourcePath, patched);
}

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function networkProxyRuntimeSource(packageName) {
  return `package ${packageName}

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebSettings
import com.bumptech.glide.Glide
import com.bumptech.glide.integration.okhttp3.OkHttpUrlLoader
import com.bumptech.glide.load.model.GlideUrl
import com.facebook.react.modules.network.CookieJarContainer
import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.image.okhttp.GlideUrlWrapper
import expo.modules.image.okhttp.GlideUrlWrapperLoader
import java.io.EOFException
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.IDN
import java.net.CookieHandler
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URI
import java.nio.charset.Charset
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import android.util.Log
import android.util.Base64
import okhttp3.ConnectionPool
import okhttp3.CacheControl
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Dispatcher
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient

data class NetworkProxyProfile(
  val protocol: String,
  val host: String,
  val port: Int,
  val username: String?,
  val password: String?
)

internal interface ProxyTlsConnection {
  val socket: Socket
  fun setReadTimeout(timeoutMs: Int)
  fun enableHttpsHostnameVerification()
  fun startHandshake()
  fun outputStream(): OutputStream
  fun inputStream(): InputStream
}

private data class ProxyTarget(val host: String, val port: Int)
private const val BLOCKED_PROXY_PORT = 9
private const val MAX_PROXY_CONNECTIONS = 16
private const val LOG_TAG = "WzNetworkProxy"

private class PlatformProxyTlsConnection(
  private val tlsSocket: SSLSocket
) : ProxyTlsConnection {
  override val socket: Socket
    get() = tlsSocket

  override fun setReadTimeout(timeoutMs: Int) {
    tlsSocket.soTimeout = timeoutMs
  }

  override fun enableHttpsHostnameVerification() {
    val parameters = tlsSocket.sslParameters
    parameters.endpointIdentificationAlgorithm = "HTTPS"
    tlsSocket.sslParameters = parameters
  }

  override fun startHandshake() {
    tlsSocket.startHandshake()
  }

  override fun outputStream(): OutputStream = tlsSocket.getOutputStream()

  override fun inputStream(): InputStream = tlsSocket.getInputStream()
}

private fun createPlatformProxyTlsConnection(
  tunnel: Socket,
  host: String,
  port: Int
): ProxyTlsConnection = PlatformProxyTlsConnection(
  (SSLSocketFactory.getDefault() as SSLSocketFactory)
    .createSocket(tunnel, host, port, true) as SSLSocket
)

internal const val FORUM_MEDIA_SOURCE_HEADER = "X-WZ-Forum-Media-Source"
internal const val FORUM_MEDIA_IDENTITY_HEADER = "X-WZ-Forum-Media-Identity"

private class MediaRequestCookiePolicy(
  private val credentialSource: String?
) {
  private var downgraded = credentialSource == null

  fun allows(source: String?): Boolean {
    if (source == null || source != credentialSource) {
      downgraded = true
      return false
    }
    return !downgraded
  }
}

private object MediaRequestCookieContext {
  private val current = ThreadLocal<MediaRequestCookiePolicy?>()

  fun current(): MediaRequestCookiePolicy? = current.get()

  fun <T> withPolicy(policy: MediaRequestCookiePolicy, block: () -> T): T {
    val previous = current.get()
    current.set(policy)
    return try {
      block()
    } finally {
      if (previous == null) current.remove() else current.set(previous)
    }
  }
}

internal class ForumMediaRequestInterceptor(
  private val sourceForUri: (URI) -> String? = ::managedCookieSource
) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
    val request = chain.request()
    val source = request.header(FORUM_MEDIA_SOURCE_HEADER)
      ?: return chain.proceed(
        if (request.header(FORUM_MEDIA_IDENTITY_HEADER) == null) request else request.newBuilder()
          .removeHeader(FORUM_MEDIA_IDENTITY_HEADER)
          .build()
      )
    val firstTargetSource = sourceForUri(URI(request.url.toString()))
    val policy = MediaRequestCookiePolicy(source.takeIf { it == firstTargetSource })
    val sanitized = request.newBuilder()
      .removeHeader(FORUM_MEDIA_SOURCE_HEADER)
      .removeHeader(FORUM_MEDIA_IDENTITY_HEADER)
      .removeHeader("Cookie")
      .cacheControl(CacheControl.Builder().noStore().build())
      .build()
    return MediaRequestCookieContext.withPolicy(policy) {
      chain.proceed(sanitized)
    }
  }
}

internal class ReadOnlyWebViewCookieHandler(
  private val sourceForUri: (URI) -> String? = ::managedCookieSource,
  private val cookieReader: (String) -> String? = { CookieManager.getInstance().getCookie(it) }
) : CookieHandler() {
  override fun get(uri: URI, headers: Map<String, List<String>>): Map<String, List<String>> {
    val cookieHeader = readCookieHeader(uri)
    return if (cookieHeader.isNullOrBlank()) emptyMap() else mapOf("Cookie" to listOf(cookieHeader))
  }

  override fun put(uri: URI, headers: Map<String, List<String>>) = Unit

  fun readCookieHeader(url: String): String? = readCookieHeader(URI(url))

  private fun readCookieHeader(uri: URI): String? {
    val mediaPolicy = MediaRequestCookieContext.current()
    val source = sourceForUri(uri)
    if (mediaPolicy != null && !mediaPolicy.allows(source)) {
      return null
    }
    source ?: return null
    return try {
      cookieReader(uri.toString())
    } catch (error: Exception) {
      if (mediaPolicy == null) throw error else null
    }
  }
}

internal class ReadOnlyCookieJarContainer(
  private val delegate: CookieJar
) : CookieJarContainer {
  override fun setCookieJar(cookieJar: CookieJar) = Unit

  override fun removeCookieJar() = Unit

  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) =
    delegate.saveFromResponse(url, cookies)

  override fun loadForRequest(url: HttpUrl): List<Cookie> =
    delegate.loadForRequest(url)
}

private fun managedCookieSourceForHost(host: String?): String? {
  val normalizedHost = host?.lowercase(Locale.US) ?: return null
  return when {
    normalizedHost == "nodeseek.com" || normalizedHost.endsWith(".nodeseek.com") -> "nodeseek"
    normalizedHost == "linux.do" || normalizedHost.endsWith(".linux.do") -> "linuxdo"
    normalizedHost == "yaohuo.me" || normalizedHost.endsWith(".yaohuo.me") -> "yaohuo"
    else -> null
  }
}

private fun managedCookieSource(uri: URI): String? =
  if (uri.scheme.equals("https", ignoreCase = true) && uri.rawUserInfo == null) {
    managedCookieSourceForHost(uri.host)
  } else {
    null
  }

private fun isManagedCookieUrl(url: String): Boolean = try {
  managedCookieSource(URI(url)) != null
} catch (_: Exception) {
  false
}

internal fun hasActiveYaohuoLoginCookie(cookieHeader: String?): Boolean =
  cookieHeader.orEmpty()
    .split(";")
    .any { part ->
      val entry = part.trim().split("=", limit = 2)
      entry.size == 2 &&
        entry[0].equals("sidyaohuo", ignoreCase = true) &&
        entry[1].trim().let { it.isNotEmpty() && it != "-2" }
    }

internal data class ManagedLoginCookieClearPlan(
  val urls: List<String>,
  val names: List<String>,
  val expirations: List<Pair<String, String>>
)

internal fun managedLoginCookieClearPlan(source: String): ManagedLoginCookieClearPlan {
  val specification = when (source) {
    "nodeseek" -> Triple(
      listOf("https://www.nodeseek.com/", "https://nodeseek.com/"),
      listOf("nodeseek.com"),
      listOf("session", "connect.sid", "sid")
    )
    "linuxdo" -> Triple(
      listOf("https://linux.do/", "https://www.linux.do/"),
      listOf("linux.do"),
      listOf("_t", "_forum_session")
    )
    "yaohuo" -> Triple(
      listOf("https://www.yaohuo.me/", "https://yaohuo.me/"),
      listOf("yaohuo.me", "www.yaohuo.me"),
      listOf("sidyaohuo", "ASP.NET_SessionId", "GUID")
    )
    else -> throw IllegalArgumentException("不支持的 Cookie 来源")
  }
  val (urls, domains, names) = specification
  val expirations = buildList {
    for (url in urls) {
      for (name in names) {
        val expired = "$name=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"
        add(url to expired)
        val host = URI(url).host
        domains
          .filter { domain -> host == domain || host.endsWith(".$domain") }
          .forEach { domain -> add(url to "$expired; Domain=$domain") }
      }
    }
  }
  return ManagedLoginCookieClearPlan(urls, names, expirations)
}

object NetworkProxyRuntime {
  private val lock = Any()
  private val selector = NetworkProxySelector()
  private val blockedProxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", BLOCKED_PROXY_PORT))
  @Volatile private var localProxy: Proxy? = blockedProxy
  private val connectionPool = ConnectionPool()
  private val dispatcher = Dispatcher()
  private val cookieHandler = ReadOnlyWebViewCookieHandler()
  private val cookieJar = ReadOnlyCookieJarContainer(JavaNetCookieJar(cookieHandler))
  private var installed = false

  fun install(context: Context) {
    synchronized(lock) {
      if (installed) {
        return
      }
      val appContext = context.applicationContext
      selector.setDelegate(ProxySelector.getDefault())
      ProxySelector.setDefault(selector)
      val client = configureManagedClient(OkHttpClientProvider.createClientBuilder(appContext)).build()
      OkHttpClientProvider.setOkHttpClientFactory { client }
      NetworkingModule.setCustomClientBuilder { builder ->
        configureManagedClient(builder)
      }
      installExpoImageClient(appContext, expoImageClient(client))
      installed = true
      Log.i(LOG_TAG, "installed app proxy selector")
    }
  }

  fun setLocalProxyPort(port: Int?) {
    localProxy = if (port == null) {
      Log.i(LOG_TAG, "disabled app proxy")
      null
    } else {
      Log.i(LOG_TAG, "enabled app proxy")
      Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", port))
    }
  }

  fun blockNetworkRequests() {
    localProxy = blockedProxy
    dispatcher.cancelAll()
    connectionPool.evictAll()
    Log.i(LOG_TAG, "blocked app requests while proxy switches")
  }

  internal fun configureManagedClient(builder: OkHttpClient.Builder): OkHttpClient.Builder {
    builder.cookieJar(cookieJar)
    builder.proxySelector(selector)
    builder.connectionPool(connectionPool)
    builder.dispatcher(dispatcher)
    if (builder.interceptors().none { it is ForumMediaRequestInterceptor }) {
      builder.addInterceptor(ForumMediaRequestInterceptor())
    }
    return builder
  }

  internal fun managedCookieHeaderForUrl(url: String): String? =
    cookieHandler.readCookieHeader(url)

  internal fun supportsManagedCookieUrl(url: String): Boolean =
    isManagedCookieUrl(url)

  internal fun clearManagedLoginCookies(source: String): Boolean {
    val plan = managedLoginCookieClearPlan(source)
    val cookieManager = CookieManager.getInstance()
    val completion = CountDownLatch(plan.expirations.size)
    val callbackFailure = AtomicReference<Throwable?>(null)
    val posted = Handler(Looper.getMainLooper()).post {
      for ((url, value) in plan.expirations) {
        try {
          cookieManager.setCookie(url, value) { _ ->
            completion.countDown()
          }
        } catch (error: Throwable) {
          callbackFailure.compareAndSet(null, error)
          completion.countDown()
        }
      }
    }
    if (!posted || !completion.await(5, TimeUnit.SECONDS)) {
      throw IllegalStateException("等待 Cookie 删除完成超时")
    }
    callbackFailure.get()?.let { error ->
      throw IllegalStateException("Cookie 删除回调失败", error)
    }
    cookieManager.flush()
    return plan.urls.all { url ->
      val currentHeader = cookieManager.getCookie(url)
      if (source == "yaohuo") {
        return@all !hasActiveYaohuoLoginCookie(currentHeader)
      }
      val currentNames = currentHeader.orEmpty()
        .split(";")
        .mapNotNull { part ->
          val separator = part.indexOf("=")
          if (separator <= 0) null else part.substring(0, separator).trim()
        }
        .toSet()
      plan.names.none { currentNames.contains(it) }
    }
  }

  fun currentLocalProxy(): Proxy? = localProxy

  fun currentLocalProxyPort(): Int? =
    (localProxy?.address() as? InetSocketAddress)?.port
}

internal fun expoImageClient(client: OkHttpClient): OkHttpClient =
  client.newBuilder().callTimeout(30, TimeUnit.SECONDS).build()

private fun installExpoImageClient(context: Context, client: OkHttpClient) {
  val registry = Glide.get(context).registry
  registry.replace(
    GlideUrl::class.java,
    InputStream::class.java,
    OkHttpUrlLoader.Factory(client)
  )
  registry.replace(
    GlideUrlWrapper::class.java,
    InputStream::class.java,
    GlideUrlWrapperLoader.Factory(client)
  )
}

class NetworkProxySelector : ProxySelector() {
  @Volatile private var delegate: ProxySelector? = null

  fun setDelegate(next: ProxySelector?) {
    delegate = next
  }

  override fun select(uri: URI?): MutableList<Proxy> {
    val targetHost = uri?.host?.lowercase(Locale.US) ?: return mutableListOf(Proxy.NO_PROXY)
    val proxy = NetworkProxyRuntime.currentLocalProxy()
    if (isLocalDevHost(targetHost)) {
      return mutableListOf(Proxy.NO_PROXY)
    }
    if (proxy == null) {
      return delegate?.select(uri)?.toMutableList() ?: mutableListOf(Proxy.NO_PROXY)
    }
    return mutableListOf(proxy)
  }

  override fun connectFailed(uri: URI?, sa: java.net.SocketAddress?, ioe: IOException?) {
    delegate?.connectFailed(uri, sa, ioe)
  }
}

internal class LocalNetworkProxyServer(
  private val upstream: NetworkProxyProfile,
  maxConnections: Int = MAX_PROXY_CONNECTIONS,
  private val socketConnector: (Socket, String, Int) -> Unit = { socket, host, port ->
    socket.connect(InetSocketAddress(host, port), 15_000)
  },
  private val tlsConnectionFactory: (Socket, String, Int) -> ProxyTlsConnection =
    ::createPlatformProxyTlsConnection
) {
  private val serverSocket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
  private val acceptExecutor = Executors.newSingleThreadExecutor()
  private val connectionExecutor = ThreadPoolExecutor(
    maxConnections,
    maxConnections,
    0L,
    TimeUnit.MILLISECONDS,
    SynchronousQueue()
  )
  private val copyExecutor = Executors.newFixedThreadPool(maxConnections * 2)
  private val sockets = ConcurrentHashMap.newKeySet<Socket>()
  private val socketLock = Any()
  @Volatile private var running = true

  val port: Int
    get() = serverSocket.localPort

  fun start() {
    Log.i(LOG_TAG, "local proxy started")
    acceptExecutor.execute {
      while (running) {
        try {
          val client = own(serverSocket.accept())
          try {
            connectionExecutor.execute {
              handleClient(client)
            }
          } catch (_: RejectedExecutionException) {
            try {
              writeProxyError(client.getOutputStream(), 503, "Busy")
            } catch (_: IOException) {
            } finally {
              closeOwned(client)
            }
          }
        } catch (_: SocketException) {
          if (running) {
            break
          }
        } catch (_: IOException) {
          if (running) {
            continue
          }
        }
      }
    }
  }

  fun stop() {
    val ownedSockets = synchronized(socketLock) {
      running = false
      sockets.toList().also { sockets.clear() }
    }
    Log.i(LOG_TAG, "local proxy stopped")
    try {
      serverSocket.close()
    } catch (_: IOException) {
    }
    ownedSockets.forEach { socket ->
      try {
        socket.close()
      } catch (_: IOException) {
      }
    }
    acceptExecutor.shutdownNow()
    connectionExecutor.shutdownNow()
    copyExecutor.shutdownNow()
  }

  private fun <T : Socket> own(socket: T): T {
    synchronized(socketLock) {
      if (!running) {
        socket.close()
        throw SocketException("Proxy server stopped")
      }
      sockets.add(socket)
    }
    return socket
  }

  private fun closeOwned(socket: Socket) {
    try {
      socket.close()
    } catch (_: IOException) {
    } finally {
      sockets.remove(socket)
    }
  }

  private fun connectPlainOwned(host: String, port: Int): Socket {
    val socket = own(Socket())
    try {
      socketConnector(socket, host, port)
      return socket
    } catch (error: Exception) {
      closeOwned(socket)
      throw error
    }
  }

  private fun handleClient(client: Socket) {
    try {
      client.use { local ->
        try {
          local.soTimeout = 30_000
          val header = readHeaderBlock(local.getInputStream())
          val requestLine = header.lineSequence().firstOrNull()?.trim().orEmpty()
          val parts = requestLine.split(" ")
          if (parts.size < 3) {
            writeProxyError(local.getOutputStream(), 400, "Bad Request")
            return
          }
          val method = parts[0].uppercase(Locale.US)
          if (method == "CONNECT") {
            val target = parseHostPort(parts[1], 443)
            val remote = connectToTarget(target)
            try {
              local.getOutputStream().write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n".toByteArray(HEADER_CHARSET))
              local.soTimeout = 0
              pipeBoth(local, remote, copyExecutor)
            } finally {
              closeOwned(remote)
            }
            return
          }

          val target = targetFromHttpRequest(parts[1], header)
          val remote = if (upstream.protocol == "http") {
            connectPlainOwned(upstream.host, upstream.port)
          } else {
            connectViaSocks5(target)
          }
          try {
            val outboundHeader = if (upstream.protocol == "http") {
              headerWithHttpProxyAuthorization(header)
            } else {
              originHeaderForDirectRequest(header, parts, target)
            }
            remote.getOutputStream().write(outboundHeader.toByteArray(HEADER_CHARSET))
            local.soTimeout = 0
            pipeBoth(local, remote, copyExecutor)
          } finally {
            closeOwned(remote)
          }
        } catch (_: IOException) {
          try {
            writeProxyError(local.getOutputStream(), 502, "Proxy Error")
          } catch (_: IOException) {
          }
        } catch (_: IllegalArgumentException) {
          try {
            writeProxyError(local.getOutputStream(), 400, "Bad Request")
          } catch (_: IOException) {
          }
        }
      }
    } finally {
      sockets.remove(client)
    }
  }

  private fun connectToTarget(target: ProxyTarget): Socket =
    if (upstream.protocol == "http") connectViaHttpProxy(target) else connectViaSocks5(target)

  private fun connectViaHttpProxy(target: ProxyTarget): Socket {
    val socket = connectPlainOwned(upstream.host, upstream.port)
    try {
      socket.soTimeout = 15_000
      val builder = StringBuilder()
      builder.append("CONNECT ").append(target.host).append(":").append(target.port).append(" HTTP/1.1\\r\\n")
      builder.append("Host: ").append(target.host).append(":").append(target.port).append("\\r\\n")
      httpProxyAuthorizationHeader()?.let { builder.append(it).append("\\r\\n") }
      builder.append("Proxy-Connection: Keep-Alive\\r\\n\\r\\n")
      socket.getOutputStream().write(builder.toString().toByteArray(HEADER_CHARSET))
      val response = readHeaderBlock(socket.getInputStream())
      val statusLine = response.lineSequence().firstOrNull().orEmpty()
      if (!statusLine.contains(" 200 ")) {
        throw IOException("HTTP proxy rejected CONNECT")
      }
      socket.soTimeout = 0
      return socket
    } catch (error: Exception) {
      closeOwned(socket)
      throw error
    }
  }

  private fun connectViaSocks5(target: ProxyTarget): Socket {
    val socket = connectPlainOwned(upstream.host, upstream.port)
    try {
      socket.soTimeout = 15_000
      val input = socket.getInputStream()
      val output = socket.getOutputStream()
      val hasAuth = !upstream.username.isNullOrEmpty() || !upstream.password.isNullOrEmpty()
      if (hasAuth) {
        output.write(byteArrayOf(0x05, 0x02, 0x00, 0x02))
      } else {
        output.write(byteArrayOf(0x05, 0x01, 0x00))
      }
      output.flush()
      val version = readByte(input)
      val method = readByte(input)
      if (version != 0x05) {
        throw IOException("Invalid SOCKS5 response")
      }
      if (method == 0x02) {
        sendSocks5Auth(output, input)
      } else if (method != 0x00) {
        throw IOException("SOCKS5 proxy rejected authentication")
      }
      sendSocks5Connect(output, target)
      val replyVersion = readByte(input)
      val replyCode = readByte(input)
      readByte(input)
      val addressType = readByte(input)
      if (replyVersion != 0x05 || replyCode != 0x00) {
        throw IOException("SOCKS5 connect failed")
      }
      consumeSocks5Address(input, addressType)
      readByte(input)
      readByte(input)
      socket.soTimeout = 0
      return socket
    } catch (error: Exception) {
      closeOwned(socket)
      throw error
    }
  }

  private fun sendSocks5Auth(output: OutputStream, input: InputStream) {
    val username = (upstream.username ?: "").toByteArray(Charsets.UTF_8)
    val password = (upstream.password ?: "").toByteArray(Charsets.UTF_8)
    if (username.size > 255 || password.size > 255) {
      throw IOException("SOCKS5 credentials are too long")
    }
    output.write(0x01)
    output.write(username.size)
    output.write(username)
    output.write(password.size)
    output.write(password)
    output.flush()
    val version = readByte(input)
    val status = readByte(input)
    if (version != 0x01 || status != 0x00) {
      throw IOException("SOCKS5 authentication failed")
    }
  }

  private fun sendSocks5Connect(output: OutputStream, target: ProxyTarget) {
    output.write(byteArrayOf(0x05, 0x01, 0x00))
    writeSocks5Address(output, target.host)
    output.write((target.port shr 8) and 0xff)
    output.write(target.port and 0xff)
    output.flush()
  }

  private fun writeSocks5Address(output: OutputStream, host: String) {
    val cleanHost = stripIpv6Brackets(host)
    if (IPV4_PATTERN.matches(cleanHost)) {
      output.write(0x01)
      cleanHost.split(".").forEach { part ->
        val octet = part.toInt()
        if (octet !in 0..255) {
          throw IOException("Invalid SOCKS5 IPv4 host")
        }
        output.write(octet)
      }
      return
    }
    if (cleanHost.contains(":")) {
      val address = InetAddress.getByName(cleanHost).address
      if (address.size == 16) {
        output.write(0x04)
        output.write(address)
        return
      }
    }
    val asciiHost = IDN.toASCII(cleanHost).toByteArray(Charsets.UTF_8)
    if (asciiHost.isEmpty() || asciiHost.size > 255) {
      throw IOException("Invalid SOCKS5 host")
    }
    output.write(0x03)
    output.write(asciiHost.size)
    output.write(asciiHost)
  }

  private fun consumeSocks5Address(input: InputStream, addressType: Int) {
    when (addressType) {
      0x01 -> repeat(4) { readByte(input) }
      0x03 -> repeat(readByte(input)) { readByte(input) }
      0x04 -> repeat(16) { readByte(input) }
      else -> throw IOException("Invalid SOCKS5 address type")
    }
  }

  private fun headerWithHttpProxyAuthorization(header: String): String {
    val lines = header.trimEnd().split("\\r\\n")
    val builder = StringBuilder()
    lines.forEachIndexed { index, line ->
      if (index == 0 || !line.startsWith("Proxy-Authorization:", ignoreCase = true)) {
        builder.append(line).append("\\r\\n")
      }
    }
    httpProxyAuthorizationHeader()?.let { builder.append(it).append("\\r\\n") }
    builder.append("\\r\\n")
    return builder.toString()
  }

  private fun originHeaderForDirectRequest(header: String, parts: List<String>, target: ProxyTarget): String {
    val requestPath = originRequestPath(parts[1])
    val lines = header.trimEnd().split("\\r\\n")
    val builder = StringBuilder()
    builder.append(parts[0]).append(" ").append(requestPath).append(" ").append(parts[2]).append("\\r\\n")
    var hasHost = false
    lines.drop(1).forEach { line ->
      if (line.startsWith("Proxy-", ignoreCase = true)) {
        return@forEach
      }
      if (line.startsWith("Host:", ignoreCase = true)) {
        hasHost = true
      }
      builder.append(line).append("\\r\\n")
    }
    if (!hasHost) {
      builder.append("Host: ").append(target.host).append("\\r\\n")
    }
    builder.append("\\r\\n")
    return builder.toString()
  }

  private fun httpProxyAuthorizationHeader(): String? {
    val user = upstream.username ?: ""
    val pass = upstream.password ?: ""
    if (user.isEmpty() && pass.isEmpty()) {
      return null
    }
    val token = Base64.encodeToString((user + ":" + pass).toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    return "Proxy-Authorization: Basic " + token
  }

  fun test() {
    val host = "www.gstatic.com"
    val tunnel = connectToTarget(ProxyTarget(host, 443))
    try {
      verifyTlsHttpConnectivity(tunnel, host)
    } finally {
      closeOwned(tunnel)
    }
  }

  private fun verifyTlsHttpConnectivity(tunnel: Socket, host: String) {
    val connection = tlsConnectionFactory(tunnel, host, 443)
    val tlsSocket = own(connection.socket)
    try {
      connection.setReadTimeout(15_000)
      connection.enableHttpsHostnameVerification()
      connection.startHandshake()
      connection.outputStream().apply {
        write(
          ("GET /generate_204 HTTP/1.1\\r\\n"
            + "Host: " + host + "\\r\\n"
            + "Connection: close\\r\\n\\r\\n").toByteArray(HEADER_CHARSET)
        )
        flush()
      }
      validateProxyHealthResponse(connection.inputStream())
    } finally {
      closeOwned(tlsSocket)
    }
  }
}

private val HEADER_CHARSET: Charset = Charsets.ISO_8859_1
private val IPV4_PATTERN = Regex("^\\\\d{1,3}(\\\\.\\\\d{1,3}){3}$")

private fun readHeaderBlock(input: InputStream): String {
  val buffer = ByteArrayOutputStream()
  var matched = 0
  while (buffer.size() < 64 * 1024) {
    val value = input.read()
    if (value < 0) {
      throw EOFException("Connection closed")
    }
    buffer.write(value)
    matched = when {
      matched == 0 && value == '\\r'.code -> 1
      matched == 1 && value == '\\n'.code -> 2
      matched == 2 && value == '\\r'.code -> 3
      matched == 3 && value == '\\n'.code -> 4
      value == '\\r'.code -> 1
      else -> 0
    }
    if (matched == 4) {
      return buffer.toString(HEADER_CHARSET.name())
    }
  }
  throw IOException("HTTP header too large")
}

internal fun validateProxyHealthResponse(input: InputStream) {
  val statusLine = readHeaderBlock(input).lineSequence().firstOrNull().orEmpty()
  val status = Regex("^HTTP/\\\\d(?:\\\\.\\\\d)?\\\\s+(\\\\d{3})(?:\\\\s|$)")
    .find(statusLine)
    ?.groupValues
    ?.getOrNull(1)
    ?.toIntOrNull()
  if (status != 204) {
    throw IOException("代理连通性验证未返回预期响应")
  }
}

private fun readByte(input: InputStream): Int {
  val value = input.read()
  if (value < 0) {
    throw EOFException("Connection closed")
  }
  return value
}

private fun parseHostPort(value: String, defaultPort: Int): ProxyTarget {
  val clean = value.trim()
  if (clean.startsWith("[")) {
    val close = clean.indexOf(']')
    if (close < 0) {
      throw IllegalArgumentException("Invalid IPv6 host")
    }
    val host = clean.substring(1, close)
    val port = if (clean.length > close + 2 && clean[close + 1] == ':') {
      clean.substring(close + 2).toIntOrNull() ?: defaultPort
    } else {
      defaultPort
    }
    return ProxyTarget(host, port)
  }
  val colon = clean.lastIndexOf(':')
  if (colon > 0 && clean.indexOf(':') == colon) {
    val host = clean.substring(0, colon)
    val port = clean.substring(colon + 1).toIntOrNull() ?: defaultPort
    return ProxyTarget(host, port)
  }
  return ProxyTarget(clean, defaultPort)
}

private fun targetFromHttpRequest(requestTarget: String, header: String): ProxyTarget {
  try {
    val uri = URI(requestTarget)
    val host = uri.host
    if (!host.isNullOrBlank()) {
      val defaultPort = if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
      return ProxyTarget(host, if (uri.port > 0) uri.port else defaultPort)
    }
  } catch (_: Exception) {
  }
  val hostHeader = header.lineSequence()
    .firstOrNull { it.startsWith("Host:", ignoreCase = true) }
    ?.substringAfter(':')
    ?.trim()
    .orEmpty()
  return parseHostPort(hostHeader, 80)
}

private fun originRequestPath(requestTarget: String): String {
  return try {
    val uri = URI(requestTarget)
    val rawPath = if (uri.rawPath.isNullOrEmpty()) "/" else uri.rawPath
    if (uri.rawQuery.isNullOrEmpty()) rawPath else rawPath + "?" + uri.rawQuery
  } catch (_: Exception) {
    requestTarget.ifBlank { "/" }
  }
}

private fun writeProxyError(output: OutputStream, status: Int, message: String) {
  val body = message.toByteArray(Charsets.UTF_8)
  val header = "HTTP/1.1 " + status + " " + message + "\\r\\nConnection: close\\r\\nContent-Length: " + body.size + "\\r\\n\\r\\n"
  output.write(header.toByteArray(HEADER_CHARSET))
  output.write(body)
}

private fun pipeBoth(left: Socket, right: Socket, executor: ExecutorService) {
  right.use { remote ->
    val latch = CountDownLatch(2)
    fun submitCopy(copy: () -> Unit) {
      try {
        executor.execute {
          try {
            copy()
          } finally {
            latch.countDown()
          }
        }
      } catch (_: RejectedExecutionException) {
        latch.countDown()
      }
    }
    submitCopy {
      try {
        copySocket(left.getInputStream(), remote.getOutputStream(), remote)
      } catch (_: Exception) {
      }
    }
    submitCopy {
      try {
        copySocket(remote.getInputStream(), left.getOutputStream(), left)
      } catch (_: Exception) {
      }
    }
    try {
      latch.await()
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }
}

private fun copySocket(input: InputStream, output: OutputStream, outputSocket: Socket) {
  try {
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read <= 0) {
        break
      }
      output.write(buffer, 0, read)
      output.flush()
    }
  } catch (_: IOException) {
  } finally {
    try {
      outputSocket.shutdownOutput()
    } catch (_: IOException) {
    }
  }
}

private fun stripIpv6Brackets(host: String): String =
  if (host.startsWith("[") && host.endsWith("]")) host.substring(1, host.length - 1) else host

private fun isLocalDevHost(host: String): Boolean {
  val clean = stripIpv6Brackets(host).lowercase(Locale.US)
  return clean == "localhost"
    || clean.endsWith(".localhost")
    || clean == "::1"
    || clean == "10.0.2.2"
    || clean.startsWith("127.")
}
`;
}

function networkProxyModuleSource(packageName) {
  return `package ${packageName}

import android.webkit.WebSettings
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock

internal fun awaitWebViewProxyOperation(
  timeoutMessage: String,
  timeoutMs: Long = 10_000,
  onTimeoutOrLateCompletion: () -> Unit = {},
  onLateCompletion: () -> Unit = onTimeoutOrLateCompletion,
  start: ((() -> Unit) -> Unit)
) {
  val latch = CountDownLatch(1)
  val timedOut = AtomicBoolean(false)
  start {
    if (timedOut.get()) {
      onLateCompletion()
    }
    latch.countDown()
  }
  val completed = try {
    latch.await(timeoutMs, TimeUnit.MILLISECONDS)
  } catch (error: InterruptedException) {
    timedOut.set(true)
    onTimeoutOrLateCompletion()
    Thread.currentThread().interrupt()
    throw error
  }
  if (!completed) {
    timedOut.set(true)
    onTimeoutOrLateCompletion()
    throw IllegalStateException(timeoutMessage)
  }
}

internal class SerializedWebViewProxyOperations {
  private val lock = ReentrantLock(true)

  fun <T> run(operation: () -> T): T {
    lock.lock()
    return try {
      operation()
    } finally {
      lock.unlock()
    }
  }
}

internal class InvalidatableResourceSlot<T : Any>(
  private val releaseRejected: (T) -> Unit
) {
  private val lock = Any()
  private var invalidated = false
  private var active: T? = null

  fun register(next: T): Boolean {
    val accepted = synchronized(lock) {
      if (invalidated) {
        false
      } else {
        active = next
        true
      }
    }
    if (!accepted) {
      releaseRejected(next)
    }
    return accepted
  }

  fun clear(expected: T) {
    synchronized(lock) {
      if (active === expected) {
        active = null
      }
    }
  }

  fun invalidate(): T? = synchronized(lock) {
    invalidated = true
    active.also { active = null }
  }
}

internal class OwnedProxyServerRegistry {
  private val lock = Any()
  private var latestOwner = 0L
  private var activeOwner: Long? = null
  private var server: LocalNetworkProxyServer? = null
  private var stateGeneration = 0L

  fun register(owner: Long) {
    synchronized(lock) {
      if (owner > latestOwner) {
        latestOwner = owner
      }
    }
  }

  fun ifLatestOwner(owner: Long, onLatest: () -> Unit): Boolean = synchronized(lock) {
    if (owner != latestOwner) {
      return@synchronized false
    }
    onLatest()
    true
  }

  fun begin(owner: Long, onBegin: () -> Unit): LocalNetworkProxyServer? = synchronized(lock) {
    check(owner == latestOwner) { "代理 bridge 已失效" }
    val previous = server
    activeOwner = owner
    server = null
    onBegin()
    stateGeneration += 1
    previous
  }

  fun commit(owner: Long, next: LocalNetworkProxyServer?, onCommit: () -> Unit): Boolean = synchronized(lock) {
    if (activeOwner != owner || latestOwner != owner) {
      return@synchronized false
    }
    server = next
    onCommit()
    stateGeneration += 1
    true
  }

  fun release(owner: Long, onRelease: () -> Unit): LocalNetworkProxyServer? = synchronized(lock) {
    if (activeOwner != owner) {
      return@synchronized null
    }
    val previous = server
    server = null
    activeOwner = null
    onRelease()
    stateGeneration += 1
    previous
  }

  fun requireCurrent(owner: Long) {
    synchronized(lock) {
      check(activeOwner == owner && latestOwner == owner) { "代理 bridge 已失效" }
    }
  }

  fun generation(): Long = synchronized(lock) { stateGeneration }
}

internal fun restoreWebViewProxyIfStateChanged(
  registry: OwnedProxyServerRegistry,
  expectedGeneration: Long,
  restore: () -> Unit
) {
  if (registry.generation() != expectedGeneration) {
    restore()
  }
}

class NetworkProxyModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val worker = Executors.newSingleThreadExecutor()
  private val owner = ownerIds.incrementAndGet()
  private val probes = InvalidatableResourceSlot<LocalNetworkProxyServer> { probe -> probe.stop() }

  init {
    proxyServers.register(owner)
  }

  override fun getName(): String = "NetworkProxyModule"

  override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
    "defaultWebViewUserAgent" to runCatching {
      WebSettings.getDefaultUserAgent(reactContext)
    }.getOrDefault("")
  )

  @ReactMethod
  fun applyProxy(profile: ReadableMap?, promise: Promise) {
    worker.execute {
      var transitionStarted = false
      var nextServer: LocalNetworkProxyServer? = null
      try {
        val appliedPort = webViewProxyOperations.run {
          val parsed = profile?.let { parseProfile(it) }
          NetworkProxyRuntime.install(reactContext)
          beginTransition()
          transitionStarted = true
          if (parsed == null) {
            clearWebViewProxy()
            if (!commitServer(null)) {
              throw IllegalStateException("代理 bridge 已被替换")
            }
            synchronizeWebViewProxyWithRuntime()
            null
          } else {
            val server = LocalNetworkProxyServer(parsed)
            nextServer = server
            server.start()
            applyWebViewProxy(server.port)
            if (!commitServer(server)) {
              throw IllegalStateException("代理 bridge 已被替换")
            }
            synchronizeWebViewProxyWithRuntime()
            server.port
          }
        }
        promise.resolve(statusMap(true, appliedPort))
      } catch (error: Exception) {
        if (transitionStarted) {
          releaseOwnedServer()
          restoreWebViewProxyFromRuntime()
        }
        nextServer?.stop()
        promise.reject("proxy_apply_failed", error.message ?: "代理启动失败", error)
      }
    }
  }

  @ReactMethod
  fun readManagedCookieHeader(exactUrl: String, promise: Promise) {
    try {
      if (!NetworkProxyRuntime.supportsManagedCookieUrl(exactUrl)) {
        promise.resolve(Arguments.createMap().apply {
          putString("status", "unsupported")
        })
        return
      }
      promise.resolve(Arguments.createMap().apply {
        putString("status", "ok")
        putString("header", NetworkProxyRuntime.managedCookieHeaderForUrl(exactUrl).orEmpty())
      })
    } catch (error: Exception) {
      promise.reject("cookie_read_failed", "无法读取当前 WebView Cookie", error)
    }
  }

  @ReactMethod
  fun clearManagedLoginCookies(source: String, promise: Promise) {
    worker.execute {
      try {
        promise.resolve(NetworkProxyRuntime.clearManagedLoginCookies(source))
      } catch (error: Exception) {
        promise.reject("cookie_clear_failed", "无法清除登录 Cookie", error)
      }
    }
  }

  @ReactMethod
  fun testProxy(profile: ReadableMap, promise: Promise) {
    worker.execute {
      try {
        val probe = LocalNetworkProxyServer(parseProfile(profile))
        if (!probes.register(probe)) {
          throw IllegalStateException("代理 bridge 已销毁")
        }
        try {
          probe.test()
        } finally {
          probes.clear(probe)
          probe.stop()
        }
        promise.resolve(statusMap(true, null))
      } catch (error: Exception) {
        promise.reject("proxy_test_failed", error.message ?: "代理测试失败", error)
      }
    }
  }

  private fun parseProfile(profile: ReadableMap): NetworkProxyProfile {
    val protocol = profile.getString("protocol") ?: "http"
    val host = profile.getString("host")?.trim().orEmpty()
    val port = if (profile.hasKey("port")) profile.getDouble("port").toInt() else 0
    val username = if (profile.hasKey("username")) profile.getString("username")?.trim() else null
    val password = if (profile.hasKey("password")) profile.getString("password") else null
    if (protocol != "http" && protocol != "socks5") {
      throw IllegalArgumentException("代理类型不正确")
    }
    if (host.isBlank()) {
      throw IllegalArgumentException("服务器不能为空")
    }
    if (port < 1 || port > 65535) {
      throw IllegalArgumentException("端口必须是 1-65535")
    }
    return NetworkProxyProfile(protocol, host, port, username?.ifBlank { null }, password?.ifBlank { null })
  }

  private fun applyWebViewProxy(port: Int) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      throw UnsupportedOperationException("当前 WebView 不支持应用内代理")
    }
    webViewProxyOperations.run {
      proxyServers.requireCurrent(owner)
      awaitWebViewProxySet(port)
    }
  }

  private fun awaitWebViewProxySet(port: Int) {
    awaitWebViewProxyOperation(
      "WebView 代理设置超时",
      onTimeoutOrLateCompletion = ::restoreWebViewProxyFromRuntime
    ) { complete ->
      ProxyController.getInstance().setProxyOverride(webViewProxyConfig(port), { runnable -> runnable.run() }) {
        complete()
      }
    }
  }

  private fun webViewProxyConfig(port: Int) = ProxyConfig.Builder()
    .addProxyRule("http://127.0.0.1:" + port)
    .addBypassRule("localhost")
    .addBypassRule("*.localhost")
    .addBypassRule("127.*")
    .addBypassRule("10.0.2.2")
    .addBypassRule("[::1]")
    .bypassSimpleHostnames()
    .build()

  private fun clearWebViewProxy() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      return
    }
    webViewProxyOperations.run {
      proxyServers.requireCurrent(owner)
      awaitWebViewProxyClear()
    }
  }

  private fun awaitWebViewProxyClear() {
    awaitWebViewProxyOperation(
      "WebView 代理清除超时",
      onTimeoutOrLateCompletion = ::restoreWebViewProxyFromRuntime
    ) { complete ->
      ProxyController.getInstance().clearProxyOverride({ runnable -> runnable.run() }) {
        complete()
      }
    }
  }

  private fun synchronizeWebViewProxyWithRuntime() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      return
    }
    webViewProxyOperations.run {
      proxyServers.requireCurrent(owner)
      val port = NetworkProxyRuntime.currentLocalProxyPort()
      if (port == null) {
        awaitWebViewProxyClear()
      } else {
        awaitWebViewProxySet(port)
      }
    }
  }

  private fun restoreWebViewProxyFromRuntime() {
    try {
      webViewProxyRestoreExecutor.execute {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
          return@execute
        }
        try {
          webViewProxyOperations.run {
            val generation = proxyServers.generation()
            val port = NetworkProxyRuntime.currentLocalProxyPort()
            if (port == null) {
              awaitWebViewProxyOperation(
                "WebView 代理恢复超时",
                onLateCompletion = {
                  restoreWebViewProxyIfStateChanged(proxyServers, generation, ::restoreWebViewProxyFromRuntime)
                }
              ) { complete ->
                ProxyController.getInstance().clearProxyOverride({ runnable -> runnable.run() }) {
                  complete()
                }
              }
            } else {
              awaitWebViewProxyOperation(
                "WebView 代理恢复超时",
                onLateCompletion = {
                  restoreWebViewProxyIfStateChanged(proxyServers, generation, ::restoreWebViewProxyFromRuntime)
                }
              ) { complete ->
                ProxyController.getInstance().setProxyOverride(webViewProxyConfig(port), { runnable -> runnable.run() }) {
                  complete()
                }
              }
            }
          }
        } catch (_: Exception) {
        }
      }
    } catch (_: Exception) {
    }
  }

  private fun statusMap(ok: Boolean, port: Int?) = Arguments.createMap().apply {
    putBoolean("ok", ok)
    if (port != null) {
      putDouble("port", port.toDouble())
    }
  }

  private fun beginTransition() {
    val previous = webViewProxyOperations.run {
      proxyServers.begin(owner) {
        NetworkProxyRuntime.blockNetworkRequests()
      }
    }
    previous?.stop()
  }

  private fun commitServer(next: LocalNetworkProxyServer?): Boolean = webViewProxyOperations.run {
    proxyServers.commit(owner, next) {
      NetworkProxyRuntime.setLocalProxyPort(next?.port)
    }
  }

  private fun releaseOwnedServer() {
    val previous = webViewProxyOperations.run {
      proxyServers.release(owner) {
        NetworkProxyRuntime.blockNetworkRequests()
      }
    }
    previous?.stop()
  }

  override fun invalidate() {
    val activeProbe = probes.invalidate()
    worker.shutdownNow()
    activeProbe?.stop()
    releaseOwnedServer()
    restoreWebViewProxyFromRuntime()
    super.invalidate()
  }

  companion object {
    private val ownerIds = AtomicLong()
    private val proxyServers = OwnedProxyServerRegistry()
    private val webViewProxyOperations = SerializedWebViewProxyOperations()
    private val webViewProxyRestoreExecutor = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "WzWebViewProxyRestore").apply { isDaemon = true }
    }
  }
}
`;
}

function networkProxyPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class NetworkProxyPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(NetworkProxyModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

function networkProxyRuntimeTestSource(packageName) {
  return `package ${packageName}

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.InetAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import com.bumptech.glide.load.model.Headers
import expo.modules.image.okhttp.GlideUrlWithCustomCacheKey
import okhttp3.Cache
import okhttp3.Cookie
import okhttp3.Interceptor
import okhttp3.JavaNetCookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkProxyRuntimeTest {
  private fun responseFor(request: Request): Response = Response.Builder()
    .request(request)
    .protocol(Protocol.HTTP_1_1)
    .code(200)
    .message("OK")
    .body("".toResponseBody())
    .build()

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
              write("HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n".toByteArray(Charsets.US_ASCII))
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
        .url("http://media.test:\${server.localPort}/private.png")
        .header(FORUM_MEDIA_SOURCE_HEADER, "nodeseek")
        .header("X-WZ-Forum-Media-Identity", "nodeseek:41")
        .header("Cookie", "must-not-be-forwarded")
        .build()).execute().close()
      client.newCall(Request.Builder()
        .url("http://media.test:\${server.localPort}/ordinary.png")
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
        "\${identity}:https://www.nodeseek.com/uploads/private.png"
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
              "/start" -> "HTTP/1.1 302 Found\\r\\nLocation: http://external.test:\${server.localPort}/away\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n"
              "/away" -> "HTTP/1.1 302 Found\\r\\nLocation: http://same.test:\${server.localPort}/final\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n"
              else -> "HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n"
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
        .url("http://same.test:\${server.localPort}/start")
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
            val body = "network-\${index + 1}"
            socket.getOutputStream().apply {
              write((
                "HTTP/1.1 200 OK\\r\\n" +
                  "Cache-Control: public, max-age=3600\\r\\n" +
                  "Content-Length: \${body.toByteArray().size}\\r\\n" +
                  "Connection: close\\r\\n\\r\\n" +
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
      val request = Request.Builder().url("http://media.test:\${server.localPort}$path")
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
  fun regTopic032ExpoImageHasAFiniteCallTimeoutWithoutChangingTheBaseClient() {
    val base = OkHttpClient.Builder().build()
    val image = expoImageClient(base)

    assertEquals(0, base.callTimeoutMillis)
    assertEquals(30_000, image.callTimeoutMillis)
    assertSame(base.cookieJar, image.cookieJar)
    assertSame(base.proxySelector, image.proxySelector)
    assertSame(base.dispatcher, image.dispatcher)
    assertSame(base.connectionPool, image.connectionPool)
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
    assertEquals(1, reapplied.interceptors.count { it is ForumMediaRequestInterceptor })
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
      validateProxyHealthResponse(ByteArrayInputStream("HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\n\\r\\n".toByteArray()))
    }

    validateProxyHealthResponse(ByteArrayInputStream("HTTP/1.1 204 No Content\\r\\nContent-Length: 0\\r\\n\\r\\n".toByteArray()))
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
          write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n".toByteArray())
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
            "HTTP/1.1 204 No Content\\r\\nContent-Length: 0\\r\\n\\r\\n".toByteArray()
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
      assertTrue(requestText.startsWith("GET /generate_204 HTTP/1.1\\r\\n"))
      assertTrue(requestText.contains("Host: www.gstatic.com\\r\\n"))
      assertTrue(requestText.endsWith("Connection: close\\r\\n\\r\\n"))
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
          write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n".toByteArray())
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
        write("CONNECT example.invalid:443 HTTP/1.1\\r\\nHost: example.invalid:443\\r\\n\\r\\n".toByteArray())
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
          write("HTTP/1.1 200 Connection Established\\r\\n".toByteArray())
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
  fun rejectsClientsBeyondTheConnectionLimit() {
    val server = LocalNetworkProxyServer(
      NetworkProxyProfile("http", "127.0.0.1", 1, null, null),
      maxConnections = 1
    )
    server.start()
    val first = Socket("127.0.0.1", server.port)
    val second = Socket("127.0.0.1", server.port)
    try {
      first.getOutputStream().write("G".toByteArray())
      Thread.sleep(100)

      second.soTimeout = 2_000
      val response = second.getInputStream().bufferedReader().readText()

      assertTrue("connections beyond the limit must be rejected locally", response.contains("503 Busy"))
    } finally {
      first.close()
      second.close()
      server.stop()
    }
  }
}
`;
}

function injectNetworkProxyPackage(contents) {
  if (contents.includes('add(NetworkProxyPackage())')) {
    return contents;
  }
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error('无法注入 NetworkProxyPackage：MainApplication 模板不匹配。');
  }
  return contents.replace(packageListPattern, (match) => `${match}\n              add(NetworkProxyPackage())`);
}

function injectNetworkProxyInstall(contents) {
  if (contents.includes('NetworkProxyRuntime.install(applicationContext)')) {
    return contents;
  }
  const loadPattern = /(\n\s*)loadReactNative\(this\)/;
  if (!loadPattern.test(contents)) {
    throw new Error('无法注入 NetworkProxyRuntime：MainApplication 模板不匹配。');
  }
  return contents.replace(loadPattern, (match, indent) => `${indent}NetworkProxyRuntime.install(applicationContext)${match}`);
}

function injectWebkitDependency(contents) {
  if (contents.includes('androidx.webkit:webkit')) {
    return contents;
  }
  const dependenciesPattern = /dependencies\s*\{/;
  if (!dependenciesPattern.test(contents)) {
    throw new Error('无法注入 androidx.webkit 依赖：app build.gradle 模板不匹配。');
  }
  return contents.replace(dependenciesPattern, (match) => `${match}\n    implementation("androidx.webkit:webkit:1.14.0")`);
}

function injectNetworkProxyTestSupport(contents) {
  let next = contents;
  if (!next.includes('testImplementation("junit:junit:4.13.2")')) {
    const dependenciesPattern = /dependencies\s*\{/;
    if (!dependenciesPattern.test(next)) {
      throw new Error('无法注入代理原生测试依赖：app build.gradle 模板不匹配。');
    }
    next = next.replace(dependenciesPattern, (match) => `${match}\n    testImplementation("junit:junit:4.13.2")`);
  }
  if (!next.includes('unitTests.returnDefaultValues = true')) {
    const androidPattern = /android\s*\{/;
    if (!androidPattern.test(next)) {
      throw new Error('无法配置代理原生测试：app build.gradle 模板不匹配。');
    }
    next = next.replace(androidPattern, (match) => `${match}\n    testOptions { unitTests.returnDefaultValues = true }`);
  }
  return next;
}

function withNetworkProxyModule(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = injectNetworkProxyTestSupport(injectWebkitDependency(config.modResults.contents));
    return config;
  });

  config = withDangerousMod(config, ['android', async (config) => {
    const packageName = config.android?.package;
    if (!packageName) {
      return config;
    }
    patchExpoVideoDataSource(config.modRequest.projectRoot);
    const outputDir = path.join(
      config.modRequest.platformProjectRoot,
      'app',
      'src',
      'main',
      'java',
      packagePath(packageName)
    );
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'NetworkProxyRuntime.kt'), networkProxyRuntimeSource(packageName));
    fs.writeFileSync(path.join(outputDir, 'NetworkProxyModule.kt'), networkProxyModuleSource(packageName));
    fs.writeFileSync(path.join(outputDir, 'NetworkProxyPackage.kt'), networkProxyPackageSource(packageName));
    const testOutputDir = path.join(
      config.modRequest.platformProjectRoot,
      'app',
      'src',
      'test',
      'java',
      packagePath(packageName)
    );
    fs.mkdirSync(testOutputDir, { recursive: true });
    fs.writeFileSync(path.join(testOutputDir, 'NetworkProxyRuntimeTest.kt'), networkProxyRuntimeTestSource(packageName));
    return config;
  }]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectNetworkProxyInstall(injectNetworkProxyPackage(config.modResults.contents));
    return config;
  });
}

module.exports = withNetworkProxyModule;
module.exports.patchExpoVideoDataSource = patchExpoVideoDataSource;
